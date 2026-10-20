import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, readdir, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
export const ADMIN = 'test-admin-' + 'a'.repeat(64);
export const PASSWORD = 'A-long-test-password-2026!';
export async function harness(bindings: Record<string, string> = {}, options: { migrate?: boolean; legacySecrets?: boolean } = {}) {
  await mkdir('.cache/build', { recursive: true });
  await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', external: ['node:*'], target: 'es2022', outfile: '.cache/build/worker.mjs' });
  const persistRoot = resolve('.cache/miniflare', crypto.randomUUID());
  const settings = (active = bindings, includeLegacy = options.legacySecrets !== false) => convertV4MiniflareOptions({ modules: true, scriptPath: resolve('.cache/build/worker.mjs'),
    compatibilityDate: '2026-10-18', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'],
    bindings: { ...(!includeLegacy ? {} : { ADMIN_TOKEN: ADMIN, TOKEN_PEPPER: 'test-pepper-' + 'b'.repeat(64) }), ALLOW_REGISTRATION: 'false', ALLOW_INSECURE_LOCALHOST: 'true', ...active },
    defaultPersistRoot: persistRoot,
  });
  const mf = new Miniflare(settings());
  let db = await mf.getD1Database('DB');
  if (options.migrate !== false) await db.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run();
  for (const name of (options.migrate === false ? [] : await readdir('migrations')).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
    const migration = await readFile('migrations/' + name, 'utf8');
    for (const sql of migration.replace(/^\s*--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
    await db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(name).run();
  }
  const trace: { method: string; path: string; status: number }[] = [];
  async function request(path: string, method = 'GET', body?: string, auth?: string, headers: Record<string, string> = {}) {
    const res = await mf.dispatchFetch('https://sync.test' + path, {
      method, body, headers: { ...(auth ? { Authorization: auth } : {}), ...(body && method !== 'PUT' ? { 'Content-Type': 'application/json' } : {}), ...headers },
    });
    trace.push({ method, path, status: res.status });
    return res;
  }
  async function account(username = 'alice') {
    const create = await request('/api/admin/users', 'POST', JSON.stringify({ username, password: PASSWORD }), `Bearer ${ADMIN}`, { 'CF-Connecting-IP': '192.0.2.1' });
    if (create.status !== 201) throw new Error(`create ${create.status}: ${await create.text()}`);
    const user = await create.json() as { id: string };
    const login = await request('/api/login', 'POST', JSON.stringify({ username, password: PASSWORD }));
    if (login.status !== 200) throw new Error(`login ${login.status}: ${await login.text()}`);
    const session = (await login.json() as { accessToken: string }).accessToken;
    async function device(label = 'Chrome') {
      const r = await request('/api/devices', 'POST', JSON.stringify({ label }), `Bearer ${session}`);
      if (r.status !== 201) throw new Error(`device ${r.status}: ${await r.text()}`);
      const c = await r.json() as { id: string; applicationPassword: string };
      return { ...c, basic: `Basic ${Buffer.from(username + ':' + c.applicationPassword).toString('base64')}` };
    }
    return { username, userId: user.id, session, device };
  }
  return { mf, get db() { return db; }, request, account, trace, restart: async (next = bindings, includeLegacy = options.legacySecrets !== false) => { await mf.setOptions(settings(next, includeLegacy)); db = await mf.getD1Database('DB'); }, close: async () => { await mf.dispose(); await rm(persistRoot, { recursive: true, force: true }); } };
}
export const FILE = '/dav/bookmarks.xbel';
export function xbel(content: string, highestId = 10): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xbel PUBLIC "+//IDN python.org//DTD XML Bookmark Exchange Language 1.0//EN//XML" "http://pyxml.sourceforge.net/topics/dtds/xbel.dtd">\n<xbel version="1.0">\n<!--- highestId :${highestId}: for Floccus bookmark sync browser extension -->\n${content}\n</xbel>`;
}
export function bookmark(id: number, title = '示例', url = 'https://example.com/'): string {
  return `<bookmark id="${id}" href="${url}"><title>${title}</title></bookmark>`;
}
export async function write(h: Awaited<ReturnType<typeof harness>>, basic: string, body: string) {
  const lock = await h.request(FILE + '.lock', 'PUT', 'lock', basic);
  if (lock.status !== 201) throw new Error('lock ' + lock.status);
  const res = await h.request(FILE, 'PUT', body, basic);
  await h.request(FILE + '.lock', 'DELETE', undefined, basic);
  return res;
}
