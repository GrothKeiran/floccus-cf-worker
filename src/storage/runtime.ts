import type { Bindings, Env } from '../types';
import { fail } from '../http';
const cached = new WeakMap<D1Database, { expires: number; admin: string; pepper: string }>();
export function validKey(value: string | undefined): value is string { return !!value && value.length >= 32 && !value.startsWith('replace-'); }
export function clearRuntimeCache(db: D1Database): void { cached.delete(db); }
export async function runtimeEnv(bindings: Bindings): Promise<Env> {
  if (!bindings.DB) fail(503, 'database_binding_required');
  if ((bindings.ADMIN_TOKEN !== undefined && !validKey(bindings.ADMIN_TOKEN)) || (bindings.TOKEN_PEPPER !== undefined && !validKey(bindings.TOKEN_PEPPER))) fail(503, 'secrets_not_configured');
  // Existing installations can keep their explicit Secrets during the transition.
  if (validKey(bindings.ADMIN_TOKEN) && validKey(bindings.TOKEN_PEPPER)) return { ...bindings, ADMIN_TOKEN: bindings.ADMIN_TOKEN, TOKEN_PEPPER: bindings.TOKEN_PEPPER };
  let keys = cached.get(bindings.DB);
  if (!keys || keys.expires <= Date.now()) {
    let rows: { key: string; value: string }[];
    try { rows = (await bindings.DB.prepare("SELECT key,value FROM app_settings WHERE key IN ('admin_token','token_pepper')").all<{ key: string; value: string }>()).results; }
    catch (error) { if (String(error).includes('no such table')) fail(503, 'database_not_initialized'); throw error; }
    const values = new Map(rows.map(row => [row.key, row.value]));
    const admin = values.get('admin_token'); const pepper = values.get('token_pepper');
    if (!validKey(admin) || !validKey(pepper)) fail(503, 'database_not_initialized');
    keys = { admin, pepper, expires: Date.now() + 300_000 }; cached.set(bindings.DB, keys);
  }
  return { ...bindings, ADMIN_TOKEN: bindings.ADMIN_TOKEN ?? keys.admin, TOKEN_PEPPER: bindings.TOKEN_PEPPER ?? keys.pepper };
}
