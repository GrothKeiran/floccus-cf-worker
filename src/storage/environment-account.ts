import type { Env } from '../types';
import { fail } from '../http';
import { hashPassword, verifyPassword } from '../auth/crypto';
interface ManagedUser { user_id: string | null; username: string | null; password_hash: string | null }
interface Account { username: string; password: string }
async function managedUser(env: Env): Promise<ManagedUser | null> {
  return env.DB.prepare(`SELECT e.user_id,u.username,u.password_hash FROM environment_account e
    LEFT JOIN users u ON u.id=e.user_id WHERE e.id=1`).first<ManagedUser>();
}
async function bindManagedUser(env: Env, account: Account): Promise<ManagedUser> {
  let managed = await managedUser(env);
  if (!managed) {
    const bootstrap = await env.DB.prepare('SELECT user_id FROM bootstrap_state WHERE id=1').first<{ user_id: string | null }>();
    let user = bootstrap?.user_id
      ? await env.DB.prepare('SELECT id,password_hash FROM users WHERE id=?').bind(bootstrap.user_id).first<{ id: string; password_hash: string }>()
      : null;
    if (!user) {
      // Legacy installations may not identify their original account. Require
      // matching existing credentials once instead of choosing an arbitrary user.
      user = await env.DB.prepare('SELECT id,password_hash FROM users WHERE username=?').bind(account.username).first<{ id: string; password_hash: string }>();
      if (!await verifyPassword(account.password, user?.password_hash) || !user) fail(409, 'environment_account_unbound');
    }
    await env.DB.prepare(`INSERT OR IGNORE INTO environment_account(id,user_id,updated_at)
      SELECT 1,id,? FROM users WHERE id=? AND password_hash=?`).bind(Date.now(), user.id, user.password_hash).run();
    managed = await managedUser(env);
  }
  // Keep the singleton after deletion. It must never adopt another user's data.
  if (!managed?.user_id || !managed.username || !managed.password_hash) fail(409, 'environment_account_deleted');
  return managed;
}
export async function synchronizeEnvironmentAccount(env: Env, account: Account): Promise<boolean> {
  const managed = await bindManagedUser(env, account);
  const passwordMatches = await verifyPassword(account.password, managed.password_hash!);
  if (managed.username === account.username && passwordMatches) return false;
  const hash = passwordMatches ? managed.password_hash! : await hashPassword(account.password);
  const guard = 'environment:' + crypto.randomUUID(); const now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO transaction_guards(id,ok) SELECT ?,CASE WHEN EXISTS(
        SELECT 1 FROM environment_account e JOIN users u ON u.id=e.user_id
        WHERE e.id=1 AND e.user_id=? AND u.username=? AND u.password_hash=?) THEN 1 ELSE 0 END`)
        .bind(guard, managed.user_id, managed.username, managed.password_hash),
      env.DB.prepare('UPDATE users SET username=?,password_hash=? WHERE id=?').bind(account.username, hash, managed.user_id),
      env.DB.prepare('DELETE FROM credentials WHERE user_id=?').bind(managed.user_id),
      env.DB.prepare('DELETE FROM staging WHERE user_id=?').bind(managed.user_id),
      env.DB.prepare('UPDATE environment_account SET updated_at=? WHERE id=1').bind(now),
      env.DB.prepare("INSERT INTO audit_logs(user_id,event,created_at) VALUES(?,'environment_account_updated',?)").bind(managed.user_id, now),
      env.DB.prepare('DELETE FROM transaction_guards WHERE id=?').bind(guard),
    ]);
    return true;
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed: users.username')) fail(409, 'username_unavailable');
    if (String(error).includes('CHECK constraint failed')) {
      // Same-config concurrent requests are idempotent; different updates do not
      // silently overwrite a more recent transaction based on stale authority.
      const current = await managedUser(env);
      if (current?.user_id === managed.user_id && current.username === account.username &&
        await verifyPassword(account.password, current.password_hash ?? undefined)) return false;
      fail(409, 'environment_account_changed_retry');
    }
    throw error;
  }
}
