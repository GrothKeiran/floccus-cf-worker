import type { Env, Principal } from '../types';
import { fail, json, jsonBody } from '../http';
import { constantEqual, hashPassword, randomToken, tokenHash, verifyPassword } from './crypto';
const DAY = 86_400_000;
export async function limit(env: Env, key: string, maximum: number, windowMs = 60_000): Promise<void> {
  const bucket = Math.floor(Date.now() / windowMs) * windowMs;
  const k = await tokenHash(`rate:${key}`, env.TOKEN_PEPPER);
  const row = await env.DB.prepare(`INSERT INTO rate_limits(key,bucket,count) VALUES(?,?,1)
    ON CONFLICT(key,bucket) DO UPDATE SET count=count+1 RETURNING count`).bind(k, bucket).first<{ count: number }>();
  if (!row || row.count > maximum) fail(429, 'rate_limited');
}
export async function audit(env: Env, userId: string | null, event: string): Promise<void> {
  await env.DB.prepare('INSERT INTO audit_logs(user_id,event,created_at) VALUES(?,?,?)').bind(userId, event, Date.now()).run();
}
export async function admin(req: Request, env: Env): Promise<void> {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32 || env.ADMIN_TOKEN.startsWith('replace-')) fail(503, 'admin_not_configured');
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  if (!await constantEqual(token, env.ADMIN_TOKEN)) fail(401, 'unauthorized');
}
export async function authenticate(req: Request, env: Env, kind: 'session' | 'device'): Promise<Principal> {
  let token = ''; let username: string | null = null;
  const authorization = req.headers.get('Authorization') ?? '';
  if (authorization.length > 4096) fail(401, 'unauthorized');
  if (kind === 'session' && authorization.startsWith('Bearer ')) token = authorization.slice(7);
  if (kind === 'device' && authorization.startsWith('Basic ')) {
    try {
      const basic = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(atob(authorization.slice(6)), c => c.charCodeAt(0)));
      const colon = basic.indexOf(':');
      if (colon < 1) fail(401, 'unauthorized');
      username = basic.slice(0, colon); token = basic.slice(colon + 1);
    } catch { fail(401, 'unauthorized'); }
  }
  if (token.length < 32 || token.length > 256) fail(401, 'unauthorized');
  const row = await env.DB.prepare(`SELECT c.id,c.user_id,u.username FROM credentials c JOIN users u ON u.id=c.user_id
    WHERE c.token_hash=? AND c.kind=? AND (c.expires_at IS NULL OR c.expires_at>?)`)
    .bind(await tokenHash(token, env.TOKEN_PEPPER), kind, Date.now()).first<{ id: string; user_id: string; username: string }>();
  if (!row || (kind === 'device' && username?.toLowerCase() !== row.username.toLowerCase())) fail(401, 'unauthorized');
  return { userId: row.user_id, credentialId: row.id, kind };
}
export async function issueCredential(env: Env, userId: string, kind: 'session' | 'device', label: string, authority: { passwordHash?: string; sessionId?: string } = {}): Promise<{ id: string; token: string; expiresAt: number | null }> {
  const id = crypto.randomUUID(); const token = randomToken(kind === 'device' ? 'app_' : 'ses_');
  const expiresAt = kind === 'session' ? Date.now() + DAY : null;
  const inserted = await env.DB.prepare(`INSERT INTO credentials(id,user_id,kind,label,token_hash,expires_at,created_at)
    SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM credentials WHERE user_id=? AND (expires_at IS NULL OR expires_at>?))<50
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=COALESCE(?,password_hash))
      AND (? IS NULL OR EXISTS(SELECT 1 FROM credentials WHERE id=? AND user_id=? AND kind='session' AND expires_at>?)) RETURNING id`)
    .bind(id, userId, kind, label, await tokenHash(token, env.TOKEN_PEPPER), expiresAt, Date.now(), userId, Date.now(), userId, authority.passwordHash ?? null, authority.sessionId ?? null, authority.sessionId ?? null, userId, Date.now()).first();
  if (!inserted) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id=? AND (expires_at IS NULL OR expires_at>?)').bind(userId, Date.now()).first<{ n: number }>();
    if ((count?.n ?? 0) >= 50) fail(422, 'credential_limit');
    fail(401, 'authority_changed');
  }
  return { id, token, expiresAt };
}
export function accountStatements(env: Env, id: string, username: string, hash: string, now: number, event: 'account_created' | 'bootstrap_completed' = 'account_created'): D1PreparedStatement[] {
  return [
    env.DB.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)').bind(id, username, hash, now),
    env.DB.prepare('INSERT INTO sync_state(user_id,updated_at) VALUES(?,?)').bind(id, now),
    env.DB.prepare(`INSERT INTO nodes(user_id,node_id,parent_id,type,title,url,position,created_at,updated_at,version) VALUES(?,0,NULL,'folder','root',NULL,0,?,?,0)`).bind(id, now, now),
    env.DB.prepare('INSERT INTO audit_logs(user_id,event,created_at) VALUES(?,?,?)').bind(id, event, now),
  ];
}
async function createUser(req: Request, env: Env): Promise<Response> {
  const body = await jsonBody(req);
  const username = String(body.username ?? '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username)) fail(400, 'invalid_username');
  const hash = await hashPassword(body.password as string);
  const id = crypto.randomUUID(); const now = Date.now();
  try {
    await env.DB.batch(accountStatements(env, id, username, hash, now));
  } catch (e) {
    if (String(e).includes('UNIQUE constraint failed: users.username')) fail(409, 'username_unavailable');
    throw e;
  }
  return json({ id, username }, 201);
}
export async function authRoutes(req: Request, env: Env, path: string): Promise<Response | null> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
  if ((path === '/api/admin/users' || path === '/api/register') && req.method === 'POST') {
    await limit(env, `create:${ip}`, 5);
    if (path === '/api/admin/users') await admin(req, env);
    else if (env.ALLOW_REGISTRATION !== 'true') fail(403, 'registration_disabled');
    return createUser(req, env);
  }
  if (path === '/api/login' && req.method === 'POST') {
    await limit(env, `login-ip:${ip}`, 15);
    const body = await jsonBody(req);
    const username = String(body.username ?? '').toLowerCase();
    const password = body.password;
    if (typeof password !== 'string' || password.length > 256 || username.length > 64) fail(400, 'invalid_credentials');
    await limit(env, `login-name:${username}`, 10);
    const user = await env.DB.prepare('SELECT id,password_hash FROM users WHERE username=?').bind(username).first<{ id: string; password_hash: string }>();
    if (!await verifyPassword(password, user?.password_hash)) { await audit(env, null, 'login_failed'); fail(401, 'unauthorized'); }
    const credential = await issueCredential(env, user!.id, 'session', 'management', { passwordHash: user!.password_hash });
    await audit(env, user!.id, 'login');
    return json({ accessToken: credential.token, expiresAt: credential.expiresAt });
  }
  if (path === '/api/admin/reset-password' && req.method === 'POST') {
    await limit(env, `reset:${ip}`, 5); await admin(req, env);
    const body = await jsonBody(req); const username = String(body.username ?? '').toLowerCase();
    const hash = await hashPassword(body.password as string);
    const user = await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(username).first<{ id: string }>();
    if (!user) fail(404, 'not_found');
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(hash, user.id),
      env.DB.prepare('DELETE FROM credentials WHERE user_id=?').bind(user.id),
      env.DB.prepare('DELETE FROM staging WHERE user_id=?').bind(user.id),
      env.DB.prepare("INSERT INTO audit_logs(user_id,event,created_at) VALUES(?,'admin_password_reset',?)").bind(user.id, Date.now()),
    ]);
    return json({ reset: true, allCredentialsRevoked: true });
  }
  if (!path.startsWith('/api/')) return null;
  const p = await authenticate(req, env, 'session');
  await limit(env, `management:${p.userId}`, 120);
  if (path === '/api/me' && req.method === 'GET') {
    const user = await env.DB.prepare('SELECT id,username,created_at FROM users WHERE id=?').bind(p.userId).first();
    return json(user);
  }
  if (path === '/api/logout' && req.method === 'POST') {
    await env.DB.prepare('DELETE FROM credentials WHERE id=? AND user_id=?').bind(p.credentialId, p.userId).run();
    return new Response(null, { status: 204 });
  }
  if (path === '/api/devices' && req.method === 'POST') {
    const body = await jsonBody(req); const label = body.label;
    if (typeof label !== 'string' || !label.trim() || label.length > 100) fail(400, 'invalid_label');
    const credential = await issueCredential(env, p.userId, 'device', label, { sessionId: p.credentialId });
    await audit(env, p.userId, 'device_created');
    return json({ id: credential.id, applicationPassword: credential.token }, 201);
  }
  if (path === '/api/devices' && req.method === 'GET') {
    const rows = await env.DB.prepare("SELECT id,label,created_at FROM credentials WHERE user_id=? AND kind='device'").bind(p.userId).all();
    return json(rows.results);
  }
  if (/^\/api\/devices\/[^/]+$/.test(path) && req.method === 'DELETE') {
    await env.DB.prepare("DELETE FROM credentials WHERE user_id=? AND id=? AND kind='device'").bind(p.userId, path.split('/').pop()).run();
    await audit(env, p.userId, 'device_revoked');
    return new Response(null, { status: 204 });
  }
  if (path === '/api/export' && req.method === 'GET') {
    const state = await env.DB.prepare('SELECT * FROM sync_state WHERE user_id=?').bind(p.userId).first();
    const nodes = await env.DB.prepare('SELECT * FROM nodes WHERE user_id=? ORDER BY node_id').bind(p.userId).all();
    return json({ formatVersion: 1, state, nodes: nodes.results }, 200, { 'Content-Disposition': 'attachment; filename="floccus-export.json"' });
  }
  if (path === '/api/account' && req.method === 'DELETE') {
    const body = await jsonBody(req);
    if (body.confirm !== 'DELETE') fail(400, 'confirmation_required');
    await env.DB.prepare('DELETE FROM users WHERE id=?').bind(p.userId).run();
    return new Response(null, { status: 204 });
  }
  return null;
}
