import type { Bindings, Env } from '../types';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../auth/policy';
import { fail } from '../http';
import { accountStatements, limit } from '../auth/service';
import { synchronizeEnvironmentAccount } from './environment-account';
import { constantEqual, hashPassword, randomToken } from '../auth/crypto';
import { migrations } from './schema';
import { clearRuntimeCache, runtimeEnv, validKey } from './runtime';

interface InitialConfiguration { account: { username: string; password: string } | null; error: string | null }
function initialConfiguration(bindings: Bindings): InitialConfiguration {
  const modern = bindings.USERNAME !== undefined || bindings.PASSWORD !== undefined;
  const rawUsername = modern ? bindings.USERNAME : bindings.BOOTSTRAP_USERNAME;
  const password = modern ? bindings.PASSWORD : bindings.BOOTSTRAP_PASSWORD;
  const invalid = (error: string): InitialConfiguration => ({ account: null, error });
  if (rawUsername === undefined || rawUsername === '') return invalid('initial_username_missing');
  if (typeof rawUsername !== 'string') return invalid('initial_username_invalid');
  const username = rawUsername.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username)) return invalid('initial_username_invalid');
  if (password === undefined || password === '') return invalid('initial_password_missing');
  if (typeof password !== 'string') return invalid('initial_password_invalid_type');
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return invalid('initial_password_length_invalid');
  if (password.startsWith('replace-')) return invalid('initial_password_placeholder');
  return { account: { username, password }, error: null };
}
export function initialAccount(bindings: Bindings): { username: string; password: string } | null {
  return initialConfiguration(bindings).account;
}
async function exists(db: D1Database, sql: string): Promise<boolean> {
  try { return !!await db.prepare(sql).first(); }
  catch (error) { if (String(error).includes('no such table')) return false; throw error; }
}
export async function accountInitialized(db: D1Database): Promise<boolean> {
  return await exists(db, 'SELECT id FROM users LIMIT 1') || await exists(db, 'SELECT id FROM bootstrap_state WHERE id=1');
}
export async function initializationStatus(bindings: Bindings): Promise<{ initialized: boolean; bootstrapConfigured: boolean; databaseInitialized: boolean }> {
  if (!bindings.DB) fail(503, 'database_binding_required');
  const initialized = await accountInitialized(bindings.DB);
  let databaseInitialized = false;
  try {
    await bindings.DB.prepare('SELECT id FROM bootstrap_state LIMIT 1').first();
    const keys = (await bindings.DB.prepare("SELECT key,value FROM app_settings WHERE key IN ('token_pepper','admin_token')").all<{ key: string; value: string }>()).results;
    const stored = new Map(keys.map(row => [row.key, row.value]));
    databaseInitialized = validKey(bindings.ADMIN_TOKEN ?? stored.get('admin_token')) && validKey(bindings.TOKEN_PEPPER ?? stored.get('token_pepper'));
    databaseInitialized = databaseInitialized && !!await bindings.DB.prepare('SELECT name FROM d1_migrations WHERE name=?').bind(migrations[migrations.length - 1].name).first();
  } catch (error) { if (!String(error).includes('no such table')) throw error; }
  return { initialized, bootstrapConfigured: initialAccount(bindings) !== null, databaseInitialized };
}
async function applySchema(db: D1Database): Promise<void> {
  await db.prepare('CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run();
  const applied = new Set((await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>()).results.map(row => row.name));
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    try {
      // The unique migration name is also a cross-isolate transaction guard.
      await db.batch([db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(migration.name), ...migration.statements.map(sql => db.prepare(sql))]);
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed: d1_migrations.name') && await db.prepare('SELECT name FROM d1_migrations WHERE name=?').bind(migration.name).first()) continue;
      throw error;
    }
  }
}
async function seedKeys(bindings: Bindings): Promise<Env> {
  const rows = (await bindings.DB.prepare("SELECT key,value FROM app_settings WHERE key IN ('admin_token','token_pepper')").all<{ key: string; value: string }>()).results;
  const stored = new Map(rows.map(row => [row.key, row.value]));
  // A legacy token digest cannot be recovered if its old pepper was discarded.
  if (!stored.has('token_pepper') && !validKey(bindings.TOKEN_PEPPER) && await exists(bindings.DB, 'SELECT id FROM credentials LIMIT 1')) fail(503, 'legacy_pepper_required');
  const inserts: D1PreparedStatement[] = [];
  for (const [key, supplied] of [['admin_token', bindings.ADMIN_TOKEN], ['token_pepper', bindings.TOKEN_PEPPER]] as const) {
    if (supplied !== undefined && !validKey(supplied)) fail(503, 'secrets_not_configured');
    const previous = stored.get(key);
    if (supplied && previous && !await constantEqual(supplied, previous)) fail(503, 'secret_configuration_conflict');
    inserts.push(bindings.DB.prepare('INSERT OR IGNORE INTO app_settings(key,value,created_at) VALUES(?,?,?)').bind(key, supplied ?? randomToken(), Date.now()));
  }
  await bindings.DB.batch(inserts);
  clearRuntimeCache(bindings.DB);
  return runtimeEnv(bindings);
}
export async function createInitialAccount(env: Env, username: string, password: string): Promise<boolean> {
  if (await accountInitialized(env.DB)) return false;
  const hash = await hashPassword(password); const id = crypto.randomUUID(); const guard = 'bootstrap:' + crypto.randomUUID(); const now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO transaction_guards(id,ok) SELECT ?,CASE WHEN
        NOT EXISTS(SELECT 1 FROM bootstrap_state WHERE id=1) AND NOT EXISTS(SELECT 1 FROM users LIMIT 1) THEN 1 ELSE 0 END`).bind(guard),
      ...accountStatements(env, id, username, hash, now, 'bootstrap_completed'),
      env.DB.prepare('INSERT INTO bootstrap_state(id,user_id,completed_at) VALUES(1,?,?)').bind(id, now),
      env.DB.prepare('DELETE FROM transaction_guards WHERE id=?').bind(guard),
    ]);
    return true;
  } catch (error) {
    if (/CHECK constraint failed|UNIQUE constraint failed: (bootstrap_state\.id|users\.username)/.test(String(error))) return false;
    throw error;
  }
}
export async function initializeDatabase(bindings: Bindings, ip = 'local'): Promise<{ ready: true; accountCreated: boolean; accountUpdated: boolean }> {
  if (!bindings.DB) fail(503, 'database_binding_required');
  const configuration = initialConfiguration(bindings);
  const account = configuration.account;
  const managedConfiguration = bindings.USERNAME !== undefined || bindings.PASSWORD !== undefined;
  if (!account && (managedConfiguration || !await accountInitialized(bindings.DB))) fail(503, configuration.error ?? 'username_password_not_configured');
  await applySchema(bindings.DB);
  const env = await seedKeys(bindings);
  await limit(env, `init-ip:${ip}`, 20);
  await limit(env, 'init-global', 60);
  // Permanently retain an initialized marker for legacy databases too.
  await env.DB.prepare('INSERT OR IGNORE INTO bootstrap_state(id,user_id,completed_at) SELECT 1,NULL,? WHERE EXISTS(SELECT 1 FROM users LIMIT 1)').bind(Date.now()).run();
  const accountCreated = account ? await createInitialAccount(env, account.username, account.password) : false;
  const accountUpdated = account && managedConfiguration ? await synchronizeEnvironmentAccount(env, account) : false;
  return { ready: true, accountCreated, accountUpdated };
}
