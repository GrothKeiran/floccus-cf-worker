import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = new URL(process.env.SYNC_URL || 'http://127.0.0.1:8787');
if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('HTTPS required');
const [command, argument] = process.argv.slice(2);
const statePath = resolve('.cache/client/session.json');
async function saved() {
  const s = JSON.parse(await readFile(statePath, 'utf8'));
  if (s.origin !== base.origin) throw new Error('Session belongs to a different server. Login again.');
  return s.token;
}
async function request(path, method = 'GET', body, token) {
  const res = await fetch(new URL(path, base), { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error' });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.status === 204 ? {} : res.json();
}
function password() {
  if (!process.env.FLOCCUS_PASSWORD) throw new Error('Read the password into FLOCCUS_PASSWORD (do not put passwords in command arguments).');
  return process.env.FLOCCUS_PASSWORD;
}
let result;
switch (command) {
  case 'create-user':
    if (!process.env.ADMIN_TOKEN) throw new Error('ADMIN_TOKEN is required');
    result = await request('/api/admin/users', 'POST', { username: argument, password: password() }, process.env.ADMIN_TOKEN); break;
  case 'reset-password':
    if (!process.env.ADMIN_TOKEN) throw new Error('ADMIN_TOKEN is required');
    result = await request('/api/admin/reset-password', 'POST', { username: argument, password: password() }, process.env.ADMIN_TOKEN); break;
  case 'login': {
    const login = await request('/api/login', 'POST', { username: argument, password: password() });
    await mkdir(resolve('.cache/client'), { recursive: true, mode: 0o700 });
    await writeFile(statePath, JSON.stringify({ origin: base.origin, token: login.accessToken }), { mode: 0o600 });
    result = { loggedIn: true, expiresAt: login.expiresAt, sessionFile: statePath }; break;
  }
  case 'device': result = await request('/api/devices', 'POST', { label: argument }, await saved()); break;
  case 'devices': result = await request('/api/devices', 'GET', undefined, await saved()); break;
  case 'revoke':
    if (!argument) throw new Error('Credential ID required');
    result = await request('/api/devices/' + encodeURIComponent(argument), 'DELETE', undefined, await saved()); break;
  case 'me': result = await request('/api/me', 'GET', undefined, await saved()); break;
  case 'logout': result = await request('/api/logout', 'POST', undefined, await saved()); await rm(statePath, {force: true}); break;
  case 'delete-account':
    if (argument !== 'DELETE') throw new Error('Explicit confirmation required: delete-account DELETE');
    result = await request('/api/account', 'DELETE', { confirm: 'DELETE' }, await saved()); await rm(statePath, {force: true}); break;
  case 'export': {
    const data = await request('/api/export', 'GET', undefined, await saved());
    await mkdir('backups', { recursive: true, mode: 0o700 });
    const name = resolve('backups', 'account-' + new Date().toISOString().replaceAll(':', '-') + '.json');
    await writeFile(name, JSON.stringify(data, null, 2), { mode: 0o600 });
    if (data.state.body) await writeFile(name.replace(/\.json$/, '.xbel'), data.state.body, { mode: 0o600 });
    result = { exportedTo: name }; break;
  }
  default: console.error('Commands: create-user NAME | login NAME | device LABEL | devices | revoke ID | me | export | logout | reset-password NAME | delete-account DELETE'); process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
