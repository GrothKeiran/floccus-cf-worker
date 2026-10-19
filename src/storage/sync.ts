import type { Env, Lease, Principal, Snapshot, State } from '../types';
import { fail } from '../http';
import { digest } from '../auth/crypto';
export const LEASE_MS = 15 * 60_000;
export async function state(env: Env, p: Principal): Promise<State> {
  const value = await env.DB.prepare('SELECT * FROM sync_state WHERE user_id=?').bind(p.userId).first<State>();
  return value ?? fail(401, 'unauthorized');
}
export async function lease(env: Env, p: Principal): Promise<Lease> {
  const row = await env.DB.prepare('SELECT * FROM sync_locks WHERE user_id=? AND credential_id=? AND expires_at>?')
    .bind(p.userId, p.credentialId, Date.now()).first<Lease>();
  return row ?? fail(423, 'lock_required');
}
export async function acquire(env: Env, p: Principal): Promise<void> {
  const now = Date.now(); const generation = crypto.randomUUID();
  const row = await env.DB.prepare(`INSERT INTO sync_locks(user_id,credential_id,generation,base_version,expires_at,updated_at)
    SELECT ?,?,?,version,?,? FROM sync_state WHERE user_id=?
    ON CONFLICT(user_id) DO UPDATE SET credential_id=excluded.credential_id,
      generation=CASE WHEN sync_locks.expires_at<=? THEN excluded.generation ELSE sync_locks.generation END,
      base_version=CASE WHEN sync_locks.expires_at<=? THEN excluded.base_version ELSE sync_locks.base_version END,
      expires_at=excluded.expires_at,updated_at=excluded.updated_at
    WHERE sync_locks.expires_at<=? OR (sync_locks.credential_id=excluded.credential_id AND sync_locks.updated_at<=?)
    RETURNING generation`).bind(p.userId, p.credentialId, generation, now + LEASE_MS, now, p.userId, now, now, now, now - 90_000).first();
  if (!row) fail(423, 'resource_locked');
}
function guard(env: Env, p: Principal, l: Lease, id: string): D1PreparedStatement {
  return env.DB.prepare(`INSERT INTO transaction_guards(id,ok)
    SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM sync_locks l JOIN sync_state s ON s.user_id=l.user_id
      JOIN credentials c ON c.id=l.credential_id
      WHERE l.user_id=? AND l.credential_id=? AND l.generation=? AND l.expires_at>?
        AND s.version=? AND l.base_version=?) THEN 1 ELSE 0 END`)
    .bind(id, p.userId, p.credentialId, l.generation, Date.now(), l.base_version, l.base_version);
}
async function guarded(env: Env, stmts: D1PreparedStatement[]): Promise<void> {
  try { await env.DB.batch(stmts); }
  catch (e) {
    if (String(e).includes('CHECK constraint failed')) fail(412, 'stale_sync_retry');
    throw e;
  }
}
export async function release(env: Env, p: Principal): Promise<void> {
  const row = await env.DB.prepare('SELECT * FROM sync_locks WHERE user_id=?').bind(p.userId).first<Lease>();
  if (!row) return;
  if (row.credential_id !== p.credentialId) fail(423, 'not_lock_owner');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM staging WHERE user_id=? AND credential_id=? AND generation=?').bind(p.userId, p.credentialId, row.generation),
    env.DB.prepare('DELETE FROM sync_locks WHERE user_id=? AND credential_id=? AND generation=?').bind(p.userId, p.credentialId, row.generation),
  ]);
}
export async function stage(env: Env, p: Principal, body: string): Promise<void> {
  const l = await lease(env, p); const id = crypto.randomUUID(); const etag = `"${await digest(body)}"`;
  await guarded(env, [guard(env, p, l, id),
    env.DB.prepare(`INSERT INTO staging(user_id,credential_id,generation,base_version,body,etag,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET credential_id=excluded.credential_id,generation=excluded.generation,base_version=excluded.base_version,
      body=excluded.body,etag=excluded.etag,updated_at=excluded.updated_at`).bind(p.userId, p.credentialId, l.generation, l.base_version, body, etag, Date.now()),
    env.DB.prepare('DELETE FROM transaction_guards WHERE id=?').bind(id),
  ]);
}
export async function commit(env: Env, p: Principal, l: Lease, body: string, snapshot: Snapshot): Promise<void> {
  const current = await state(env, p); const etag = `"${await digest(body)}"`;
  // Retry after a lost MOVE/PUT response: unchanged bytes do not create another revision.
  if (current.etag === etag) {
    await lease(env, p);
    return;
  }
  const storedCount = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM nodes WHERE user_id=?) +
    (SELECT COUNT(*) FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM nodes n WHERE n.user_id=? AND n.node_id=json_extract(j.value,'$.id'))) AS n`)
    .bind(p.userId, JSON.stringify(snapshot.nodes), p.userId).first<{ n: number }>();
  if ((storedCount?.n ?? 0) > 50_001) fail(422, 'history_node_limit');
  if (snapshot.highestId < current.highest_id) fail(412, 'highest_id_regression');
  const id = crypto.randomUUID(); const now = Date.now(); const version = l.base_version + 1;
  const nodes = JSON.stringify(snapshot.nodes);
  // D1's value size limit is 2 MB; bound derived JSON independently of input XML size.
  if (new TextEncoder().encode(nodes).length > 1_500_000) fail(413, 'derived_snapshot_too_large');
  await guarded(env, [
    guard(env, p, l, id),
    env.DB.prepare(`INSERT INTO transaction_guards(id,ok) SELECT ?,CASE WHEN NOT EXISTS(
      SELECT 1 FROM nodes n JOIN json_each(?) j ON n.node_id=json_extract(j.value,'$.id')
      WHERE n.user_id=? AND (n.deleted=1 OR n.type!=json_extract(j.value,'$.type'))
    ) THEN 1 ELSE 0 END`).bind(id + ':nodes', nodes, p.userId),
    env.DB.prepare(`UPDATE nodes SET deleted=1,version=?,updated_at=? WHERE user_id=? AND deleted=0
      AND node_id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?))`).bind(version, now, p.userId, nodes),
    env.DB.prepare(`INSERT INTO nodes(user_id,node_id,parent_id,type,title,url,position,created_at,updated_at,version,deleted)
      SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.parent'),json_extract(value,'$.type'),json_extract(value,'$.title'),
        json_extract(value,'$.url'),json_extract(value,'$.position'),?,?,?,0 FROM json_each(?) WHERE 1
      ON CONFLICT(user_id,node_id) DO UPDATE SET
        version=CASE WHEN nodes.parent_id IS NOT excluded.parent_id OR nodes.title!=excluded.title OR nodes.url IS NOT excluded.url
          OR nodes.position!=excluded.position THEN excluded.version ELSE nodes.version END,
        updated_at=CASE WHEN nodes.parent_id IS NOT excluded.parent_id OR nodes.title!=excluded.title OR nodes.url IS NOT excluded.url
          OR nodes.position!=excluded.position THEN excluded.updated_at ELSE nodes.updated_at END,
        parent_id=excluded.parent_id,title=excluded.title,url=excluded.url,position=excluded.position
      WHERE nodes.parent_id IS NOT excluded.parent_id OR nodes.title!=excluded.title OR nodes.url IS NOT excluded.url OR nodes.position!=excluded.position`)
      .bind(p.userId, now, now, version, nodes),
    env.DB.prepare('UPDATE sync_state SET body=?,etag=?,highest_id=?,version=?,updated_at=? WHERE user_id=?')
      .bind(body, etag, snapshot.highestId, version, now, p.userId),
    env.DB.prepare('UPDATE sync_locks SET base_version=? WHERE user_id=? AND generation=?').bind(version, p.userId, l.generation),
    env.DB.prepare("INSERT INTO audit_logs(user_id,event,created_at) VALUES(?,'snapshot_committed',?)").bind(p.userId, now),
    env.DB.prepare('DELETE FROM transaction_guards WHERE id IN (?,?)').bind(id, id + ':nodes'),
  ]);
}
