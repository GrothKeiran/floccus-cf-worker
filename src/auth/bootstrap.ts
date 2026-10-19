import type { Env } from '../types';
import { fail, json, jsonBody } from '../http';
import { accountStatements, limit } from './service';
import { constantEqual, hashPassword } from './crypto';

function configuration(env: Env): { username: string; password: string } | null {
  const username = env.BOOTSTRAP_USERNAME?.trim().toLowerCase();
  const password = env.BOOTSTRAP_PASSWORD;
  if (!username || !/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username) || !password || password.length < 14 || password.length > 256 || password.startsWith('replace-')) return null;
  return { username, password };
}
async function initialized(env: Env): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT
    EXISTS(SELECT 1 FROM bootstrap_state WHERE id=1) OR EXISTS(SELECT 1 FROM users LIMIT 1) AS initialized`).first<{ initialized: number }>();
  return row?.initialized === 1;
}
export async function setupRoutes(req: Request, env: Env, path: string): Promise<Response | null> {
  if (path === '/api/setup/status' && req.method === 'GET') {
    return json({ initialized: await initialized(env), bootstrapConfigured: configuration(env) !== null });
  }
  if (path !== '/api/setup' || req.method !== 'POST') return null;
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
  await limit(env, `setup:${ip}`, 5);
  // The endpoint cannot be used as password reset or to add users to an existing DB.
  if (await initialized(env)) fail(409, 'setup_already_completed');
  const configured = configuration(env);
  if (!configured) fail(503, 'bootstrap_not_configured');
  const body = await jsonBody(req);
  if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.username.length > 64 || body.password.length > 256) fail(400, 'invalid_credentials');
  const username = body.username.trim().toLowerCase();
  const nameMatches = await constantEqual(username, configured.username);
  const passwordMatches = await constantEqual(body.password, configured.password);
  if (!nameMatches || !passwordMatches) fail(401, 'unauthorized');
  const hash = await hashPassword(body.password);
  const id = crypto.randomUUID(); const guardId = 'bootstrap:' + crypto.randomUUID(); const now = Date.now();
  try {
    await env.DB.batch([
      // This transactional guard resolves races across isolates, not just within one process.
      env.DB.prepare(`INSERT INTO transaction_guards(id,ok) SELECT ?,CASE WHEN
        NOT EXISTS(SELECT 1 FROM bootstrap_state WHERE id=1) AND NOT EXISTS(SELECT 1 FROM users LIMIT 1)
        THEN 1 ELSE 0 END`).bind(guardId),
      ...accountStatements(env, id, username, hash, now, 'bootstrap_completed'),
      env.DB.prepare('INSERT INTO bootstrap_state(id,user_id,completed_at) VALUES(1,?,?)').bind(id, now),
      env.DB.prepare('DELETE FROM transaction_guards WHERE id=?').bind(guardId),
    ]);
  } catch (error) {
    if (/CHECK constraint failed|UNIQUE constraint failed: (bootstrap_state\.id|users\.username)/.test(String(error))) fail(409, 'setup_already_completed');
    throw error;
  }
  return json({ initialized: true, username }, 201);
}
