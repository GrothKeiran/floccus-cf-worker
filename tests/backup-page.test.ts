import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runInNewContext } from 'node:vm';
import { ADMIN, PASSWORD, bookmark, harness, write, xbel } from './harness';
type Handler = (event: { preventDefault(): void }) => unknown;
class Element {
  value = ''; textContent = ''; hidden = false; disabled = false; href = ''; download = '';
  handlers = new Map<string, Handler>();
  classList = { toggle: (_name: string, _value: boolean) => {} };
  addEventListener(name: string, handler: Handler) { this.handlers.set(name, handler); }
  async fire(name: string) { await this.handlers.get(name)?.({ preventDefault() {} }); }
  append(_element: Element) {}
  remove() {}
  click() {}
}
// Execute the served browser script against the real workerd/D1 API. The DOM
// and download APIs are deliberately small test doubles, not a browser UI test.
async function backupPage(h: Awaited<ReturnType<typeof harness>>, gate?: { entered(): void; wait: Promise<void> }) {
  const html = await (await h.request('/admin')).text();
  const js = await (await h.request('/admin/app.js')).text();
  const elements = new Map<string, Element>();
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(); element.hidden = /\bhidden\b/.test(match[0]); element.disabled = /\bdisabled\b/.test(match[0]); elements.set(match[1], element);
  }
  const get = (id: string) => { const element = elements.get(id); if (!element) throw new Error('Missing DOM element: ' + id); return element; };
  const requests: { path: string; method: string; auth?: string }[] = [];
  const downloads: { name: string; blob: Blob }[] = [];
  const blobs = new Map<string, Blob>();
  const context = {
    document: { getElementById: get, body: new Element(), createElement(tag: string) {
      if (tag !== 'a') throw new Error('Unexpected element ' + tag);
      const element = new Element(); element.click = () => { downloads.push({ name: element.download, blob: blobs.get(element.href)! }); }; return element;
    } },
    Blob, URL: { createObjectURL(blob: Blob) { const id = 'blob:test/' + blobs.size; blobs.set(id, blob); return id; }, revokeObjectURL(id: string) { blobs.delete(id); } },
    setTimeout(callback: () => void) { callback(); },
    async fetch(path: string, options: { method: string; body?: string; headers: Record<string, string>; credentials: string; redirect: string; cache: string }) {
      expect(options.credentials).toBe('omit'); expect(options.redirect).toBe('error'); expect(options.cache).toBe('no-store');
      requests.push({ path, method: options.method, auth: options.headers.Authorization });
      const response = await h.request(path, options.method, options.body, options.headers.Authorization, options.headers);
      if (path === '/api/export' && gate) { gate.entered(); await gate.wait; }
      return response;
    },
  };
  await runInNewContext(js, context);
  async function login(username = 'alice', password = PASSWORD) {
    get('username').value = username; get('password').value = password; await get('login-form').fire('submit');
  }
  return { get, login, requests, downloads, html, js, context };
}
describe('精简书签备份页面', () => {
  let h: Awaited<ReturnType<typeof harness>>;
  let empty: Awaited<ReturnType<typeof harness>>;
  beforeAll(async () => {
    h = await harness(); empty = await harness({ USERNAME: 'owner', PASSWORD }, { migrate: false, legacySecrets: false });
    const alice = await h.account('alice'); const bob = await h.account('bob');
    expect((await write(h, (await alice.device()).basic, xbel(bookmark(1, 'Alice备份内容')))).status).toBe(201);
    expect((await write(h, (await bob.device()).basic, xbel(bookmark(1, 'Bob私有内容')))).status).toBe(201);
  });
  afterAll(async () => { await h?.close(); await empty?.close(); });
  test('页面仅保留登录和导出，不含设备表单、应用密码功能或自动建号调用', async () => {
    const ui = await backupPage(h);
    expect(ui.html).toMatch(/id="password"[^>]+minlength="5"/);
    expect(ui.html).toContain('书签备份'); expect(ui.html).toContain('下载备份 JSON');
    expect(ui.html).not.toMatch(/生成应用密码|设备列表|设备名称|device-form|device-list|application-password/);
    expect(ui.js).not.toMatch(/\/api\/devices|\/api\/setup['"]|localStorage|sessionStorage|innerHTML|eval\(/);
    expect(ui.html + ui.js).not.toContain(PASSWORD); expect(ui.html + ui.js).not.toContain(ADMIN);
    const response = await h.request('/admin');
    expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await (await h.request('/admin', 'HEAD')).text()).toBe('');
  });
  test('错误登录清空密码，不生成文件；匿名不能导出', async () => {
    const ui = await backupPage(h); await ui.login('alice', 'Wrong-backup-password-2026!');
    expect(ui.get('password').value).toBe(''); expect(ui.get('login-panel').hidden).toBe(false);
    expect(ui.get('message').textContent).toContain('账号或密码错误'); expect(ui.downloads).toHaveLength(0);
    expect((await h.request('/api/export')).status).toBe(401);
  });
  test('真实登录后下载当前用户JSON备份，不泄漏他人书签、密码或令牌', async () => {
    const ui = await backupPage(h); await ui.login();
    expect(ui.get('account-panel').hidden).toBe(false); expect(ui.get('account-name').textContent).toBe('alice');
    expect(ui.get('password').value).toBe('');
    await ui.get('export').fire('click'); expect(ui.downloads).toHaveLength(1);
    expect(ui.downloads[0].name).toMatch(/^floccus-backup-.*\.json$/);
    const text = await ui.downloads[0].blob.text(); const data = JSON.parse(text);
    expect(data.formatVersion).toBe(1); expect(data.state.body).toContain('Alice备份内容'); expect(data.nodes).toHaveLength(2);
    expect(text).not.toContain('Bob私有内容'); expect(text).not.toContain(PASSWORD);
    expect(text).not.toMatch(/password_hash|token_hash|accessToken/);
    expect(ui.requests.some(r => r.path.startsWith('/api/devices'))).toBe(false);
  });
  test('退出立即清除本页会话，同时撤销服务端会话', async () => {
    const ui = await backupPage(h); await ui.login();
    const token = ui.requests.find(r => r.path === '/api/me')!.auth;
    await ui.get('logout').fire('click');
    expect(ui.get('account-panel').hidden).toBe(true); expect(ui.get('account-name').textContent).toBe('');
    expect((await h.request('/api/me', 'GET', undefined, token)).status).toBe(401);
    await ui.get('export').fire('click'); expect(ui.downloads).toHaveLength(0);
  });
  test('会话失效时导出失败并返回登录界面，不下载错误JSON', async () => {
    const ui = await backupPage(h); await ui.login();
    const token = ui.requests.find(r => r.path === '/api/me')!.auth;
    await h.request('/api/logout', 'POST', undefined, token);
    await ui.get('export').fire('click');
    expect(ui.downloads).toHaveLength(0); expect(ui.get('login-panel').hidden).toBe(false);
    expect(ui.get('account-panel').hidden).toBe(true); expect(ui.get('message').textContent).toContain('会话已过期');
  });
  test('导出进行中退出，不会继续下载旧会话的数据', async () => {
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const ui = await backupPage(h, { entered, wait }); await ui.login();
    const exporting = ui.get('export').fire('click'); await started;
    await ui.get('logout').fire('click'); release(); await exporting;
    expect(ui.downloads).toHaveLength(0); expect(ui.get('account-panel').hidden).toBe(true);
  });
  test('未初始化时提示前往 init，页面不自动建表或创建账号', async () => {
    const ui = await backupPage(empty);
    expect(ui.get('login-button').disabled).toBe(true); expect(ui.get('setup-note').textContent).toContain('/init');
    await ui.login('owner'); expect(ui.requests.map(r => r.path)).toEqual(['/api/setup/status']);
    expect(await empty.db.prepare("SELECT name FROM sqlite_master WHERE name='users'").first()).toBeNull();
  });
});
