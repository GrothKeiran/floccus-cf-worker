import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ADMIN, PASSWORD, harness } from './harness';
const INITIAL = 'A-new-bootstrap-password-2026!';
let h: Awaited<ReturnType<typeof harness>>;
let disabled: Awaited<ReturnType<typeof harness>>;
let existing: Awaited<ReturnType<typeof harness>>;
let original: Awaited<ReturnType<typeof h.account>>;
let session = '';
let deviceId = '';
let applicationPassword = '';
const setup = (username = 'owner', password = INITIAL) => JSON.stringify({ username, password });
beforeAll(async () => {
  h = await harness({ BOOTSTRAP_USERNAME: 'owner', BOOTSTRAP_PASSWORD: INITIAL });
  disabled = await harness();
  existing = await harness({ BOOTSTRAP_USERNAME: 'alice', BOOTSTRAP_PASSWORD: INITIAL });
  original = await existing.account();
});
afterAll(async () => { await h?.close(); await disabled?.close(); await existing?.close(); });

describe('一次性网页初始化', () => {
  test('未配置时不建号，静态网页和状态接口不暴露秘密', async () => {
    const state = await disabled.request('/api/setup/status');
    expect(await state.json()).toEqual({ initialized: false, bootstrapConfigured: false, databaseInitialized: true });
    expect((await disabled.request('/api/setup', 'POST', setup())).status).toBe(503);
    expect(await disabled.db.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(0);
    const response = await h.request('/admin');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect(response.headers.get('Content-Security-Policy')).not.toContain('unsafe-inline');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain('/admin/app.js');
    expect(html).not.toContain(INITIAL);
    expect(html).not.toContain(ADMIN);
    const js = await (await h.request('/admin/app.js')).text();
    expect(js).not.toMatch(/localStorage|sessionStorage|innerHTML|eval\(/);
    expect(js).not.toContain(INITIAL);
    expect((await h.request('/admin/app.css')).headers.get('Content-Type')).toContain('text/css');
    expect((await h.mf.dispatchFetch('https://sync.test/', { redirect: 'manual' })).headers.get('Location')).toBe('/admin');
  });
  test('错误初始化凭证与跨站 POST 不能建号', async () => {
    expect((await h.request('/api/setup', 'POST', setup('owner', 'wrong-password-123456'))).status).toBe(401);
    expect((await h.request('/api/setup', 'POST', setup(), undefined, { Origin: 'https://evil.test' })).status).toBe(403);
    expect((await h.request('/api/login', 'POST', setup(), undefined, { Origin: 'null' })).status).toBe(403);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(0);
  });
  test('并发首次初始化只成功一次，账号、根节点、同步状态原子创建', async () => {
    const results = await Promise.all([h.request('/api/setup', 'POST', setup()), h.request('/api/setup', 'POST', setup())]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(1);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM bootstrap_state').first('n')).toBe(1);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM nodes WHERE node_id=0').first('n')).toBe(1);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM sync_state').first('n')).toBe(1);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM transaction_guards').first('n')).toBe(0);
    const hash = await h.db.prepare('SELECT password_hash FROM users').first<string>('password_hash');
    expect(hash).toMatch(/^scrypt\$16384\$8\$5\$/);
    expect(hash).not.toContain(INITIAL);
    expect(await (await h.request('/api/setup/status')).json()).toEqual({ initialized: true, bootstrapConfigured: true, databaseInitialized: true });
  });
  test('初始化后可登录并签发独立设备密码，账户密码仍不能用于 DAV', async () => {
    const response = await h.request('/api/login', 'POST', setup());
    expect(response.status).toBe(200);
    session = (await response.json() as { accessToken: string }).accessToken;
    const created = await h.request('/api/devices', 'POST', JSON.stringify({ label: '<img src=x onerror=alert(1)>浏览器' }), `Bearer ${session}`);
    expect(created.status).toBe(201);
    const result = await created.json() as { id: string; applicationPassword: string };
    deviceId = result.id; applicationPassword = result.applicationPassword;
    expect(applicationPassword).toMatch(/^app_[a-f0-9]{64}$/);
    const auth = 'Basic ' + Buffer.from('owner:' + applicationPassword).toString('base64');
    expect((await h.request('/dav/', 'OPTIONS', undefined, auth)).status).toBe(204);
    expect((await h.request('/dav/', 'OPTIONS', undefined, 'Basic ' + Buffer.from('owner:' + INITIAL).toString('base64'))).status).toBe(401);
    const listed = JSON.stringify(await (await h.request('/api/devices', 'GET', undefined, `Bearer ${session}`)).json());
    expect(listed).toContain('浏览器');
    expect(listed).not.toContain(applicationPassword);
    expect(listed).not.toContain('token_hash');
  });
  test('已有账户不会被初始环境密码覆盖，重复初始化也不重置书签或设备', async () => {
    const before = await h.db.prepare('SELECT password_hash FROM users').first('password_hash');
    expect((await h.request('/api/setup', 'POST', setup())).status).toBe(409);
    expect(await h.db.prepare('SELECT password_hash FROM users').first('password_hash')).toBe(before);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM credentials WHERE id=?').bind(deviceId).first('n')).toBe(1);
    expect((await existing.request('/api/setup', 'POST', setup('alice'))).status).toBe(409);
    expect((await existing.request('/api/login', 'POST', JSON.stringify({ username: 'alice', password: INITIAL }))).status).toBe(401);
    expect((await existing.request('/api/me', 'GET', undefined, `Bearer ${original.session}`)).status).toBe(200);
    expect((await existing.request('/api/login', 'POST', JSON.stringify({ username: 'alice', password: PASSWORD }))).status).toBe(200);
  });
  test('网页使用的撤销/退出 API 立即使相应凭证失效', async () => {
    expect((await h.request('/api/devices/' + deviceId, 'DELETE', undefined, `Bearer ${session}`)).status).toBe(204);
    const auth = 'Basic ' + Buffer.from('owner:' + applicationPassword).toString('base64');
    expect((await h.request('/dav/', 'OPTIONS', undefined, auth)).status).toBe(401);
    expect((await h.request('/api/logout', 'POST', undefined, `Bearer ${session}`)).status).toBe(204);
    expect((await h.request('/api/me', 'GET', undefined, `Bearer ${session}`)).status).toBe(401);
  });
  test('删除初始账号仍保留完成标记，不会重新创建账号', async () => {
    await h.db.prepare('DELETE FROM users').run();
    expect(await h.db.prepare('SELECT user_id FROM bootstrap_state WHERE id=1').first('user_id')).toBeNull();
    expect((await (await h.request('/api/setup/status')).json() as { initialized: boolean }).initialized).toBe(true);
    expect((await h.request('/api/setup', 'POST', setup())).status).toBe(409);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(0);
  });
});
