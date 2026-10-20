import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHmac } from 'node:crypto';
import { FILE, PASSWORD as LEGACY_PASSWORD, bookmark, harness, write, xbel } from './harness';
const FIRST = 'Environment-first-password-2026!';
const SECOND = 'Environment-second-password-2026!';
const THIRD = 'Environment-third-password-2026!';
const headers = { Accept: 'application/json' };
const basic = (username: string, password: string) => 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
describe('通过 Worker 环境变量维护原账号', () => {
  let h: Awaited<ReturnType<typeof harness>>;
  let legacy: Awaited<ReturnType<typeof harness>>;
  let userId: string; let storedState: unknown; let storedNodes: unknown;
  let session: string; let app: string; let lastHash: string;
  async function initialize(target = h) { return target.request('/init', 'GET', undefined, undefined, headers); }
  async function credentials(username: string, password: string) {
    const login = await h.request('/api/login', 'POST', JSON.stringify({ username, password }));
    expect(login.status).toBe(200); session = (await login.json() as { accessToken: string }).accessToken;
    const created = await h.request('/api/devices', 'POST', JSON.stringify({ label: 'test-device' }), 'Bearer ' + session);
    expect(created.status).toBe(201); app = (await created.json() as { applicationPassword: string }).applicationPassword;
  }
  beforeAll(async () => {
    h = await harness({ USERNAME: 'owner', PASSWORD: FIRST }, { migrate: false, legacySecrets: false });
    legacy = await harness({ USERNAME: 'unknown-owner', PASSWORD: SECOND });
  });
  afterAll(async () => { await h?.close(); await legacy?.close(); });
  test('首次初始化建立持久账号关联，不公开内部ID或密码', async () => {
    const response = await initialize(); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ready: true, accountCreated: true, accountUpdated: false });
    userId = (await h.db.prepare('SELECT id FROM users').first<string>('id'))!;
    expect(await h.db.prepare('SELECT user_id FROM environment_account WHERE id=1').first('user_id')).toBe(userId);
    lastHash = (await h.db.prepare('SELECT password_hash FROM users').first<string>('password_hash'))!;
    await credentials('owner', FIRST);
    expect((await write(h, basic('owner', app), xbel(bookmark(1, '保留书签'), 1))).status).toBe(201);
    storedState = await h.db.prepare('SELECT * FROM sync_state WHERE user_id=?').bind(userId).first();
    storedNodes = (await h.db.prepare('SELECT * FROM nodes WHERE user_id=? ORDER BY node_id').bind(userId).all()).results;
    const html = await (await h.request('/init')).text(); expect(html).not.toContain(FIRST); expect(html).not.toContain(userId);
  });
  test('配置不变重复 init 不换盐、不撤销原会话和应用密码', async () => {
    expect(await (await initialize()).json()).toEqual({ ready: true, accountCreated: false, accountUpdated: false });
    expect(await h.db.prepare('SELECT password_hash FROM users WHERE id=?').bind(userId).first('password_hash')).toBe(lastHash);
    expect((await h.request('/api/me', 'GET', undefined, 'Bearer ' + session)).status).toBe(200);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('owner', app))).status).toBe(204);
  });
  test('仅改用户名：部署后 init 才生效，保留用户ID和全部书签，撤销旧会话与锁', async () => {
    expect((await h.request(FILE + '.lock', 'PUT', 'lock', basic('owner', app))).status).toBe(201);
    expect((await h.request(FILE + '.temp', 'PUT', xbel(bookmark(2), 2), basic('owner', app))).status).toBe(201);
    await h.restart({ USERNAME: 'renamed-owner', PASSWORD: FIRST }, false);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('owner', FIRST))).status).toBe(204);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('renamed-owner', FIRST))).status).toBe(401);
    expect(await (await initialize()).json()).toEqual({ ready: true, accountCreated: false, accountUpdated: true });
    expect(await h.db.prepare('SELECT id FROM users WHERE username=?').bind('renamed-owner').first('id')).toBe(userId);
    expect(await h.db.prepare('SELECT password_hash FROM users WHERE id=?').bind(userId).first('password_hash')).toBe(lastHash);
    expect(await h.db.prepare('SELECT * FROM sync_state WHERE user_id=?').bind(userId).first()).toEqual(storedState);
    expect((await h.db.prepare('SELECT * FROM nodes WHERE user_id=? ORDER BY node_id').bind(userId).all()).results).toEqual(storedNodes);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id=?').bind(userId).first('n')).toBe(0);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM sync_locks').first('n')).toBe(0);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM staging').first('n')).toBe(0);
    expect((await h.request('/api/me', 'GET', undefined, 'Bearer ' + session)).status).toBe(401);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('owner', FIRST))).status).toBe(401);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('renamed-owner', app))).status).toBe(401);
    expect((await h.request(FILE, 'GET', undefined, basic('renamed-owner', FIRST))).status).toBe(200);
  });
  test('仅改密码：新 scrypt 哈希生效，旧密码成功缓存不能绕过撤销', async () => {
    await credentials('renamed-owner', FIRST);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('renamed-owner', FIRST))).status).toBe(204);
    await h.restart({ USERNAME: 'renamed-owner', PASSWORD: SECOND }, false);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('renamed-owner', FIRST))).status).toBe(204);
    expect(await (await initialize()).json()).toEqual({ ready: true, accountCreated: false, accountUpdated: true });
    const hash = await h.db.prepare('SELECT password_hash FROM users WHERE id=?').bind(userId).first<string>('password_hash');
    expect(hash).toMatch(/^scrypt\$16384\$8\$5\$/); expect(hash).not.toBe(lastHash); lastHash = hash!;
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('renamed-owner', FIRST))).status).toBe(401);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('renamed-owner', app))).status).toBe(401);
    expect((await h.request('/api/me', 'GET', undefined, 'Bearer ' + session)).status).toBe(401);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('renamed-owner', SECOND))).status).toBe(204);
    expect(await h.db.prepare('SELECT * FROM sync_state WHERE user_id=?').bind(userId).first()).toEqual(storedState);
  });
  test('同时改用户名和密码、并发 init 只更新一次，重复请求不撤销新凭证', async () => {
    await h.restart({ USERNAME: 'final-owner', PASSWORD: THIRD }, false);
    const responses = await Promise.all([initialize(), initialize()]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    const results = await Promise.all(responses.map(r => r.json() as Promise<{ accountUpdated: boolean }>));
    expect(results.filter(r => r.accountUpdated)).toHaveLength(1);
    expect(await h.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE event='environment_account_updated'").first('n')).toBe(3);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM transaction_guards').first('n')).toBe(0);
    expect(await h.db.prepare('SELECT id FROM users').first('id')).toBe(userId);
    await credentials('final-owner', THIRD);
    expect(await (await initialize()).json()).toEqual({ ready: true, accountCreated: false, accountUpdated: false });
    expect((await h.request('/api/me', 'GET', undefined, 'Bearer ' + session)).status).toBe(200);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('final-owner', app))).status).toBe(204);
  });
  test('用户名冲突事务回滚，不改他人账号、不撤销原凭证、不删除原同步锁', async () => {
    const admin = await h.db.prepare("SELECT value FROM app_settings WHERE key='admin_token'").first<string>('value');
    expect((await h.request('/api/admin/users', 'POST', JSON.stringify({ username: 'other-user', password: FIRST }), 'Bearer ' + admin)).status).toBe(201);
    expect((await h.request(FILE + '.lock', 'PUT', 'lock', basic('final-owner', app))).status).toBe(201);
    const users = (await h.db.prepare('SELECT * FROM users ORDER BY id').all()).results;
    const credentialsBefore = (await h.db.prepare('SELECT * FROM credentials ORDER BY id').all()).results;
    await h.restart({ USERNAME: 'other-user', PASSWORD: SECOND }, false);
    const result = await initialize(); expect(result.status).toBe(409); expect(await result.json()).toEqual({ error: 'username_unavailable' });
    expect((await h.db.prepare('SELECT * FROM users ORDER BY id').all()).results).toEqual(users);
    expect((await h.db.prepare('SELECT * FROM credentials ORDER BY id').all()).results).toEqual(credentialsBefore);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM sync_locks WHERE user_id=?').bind(userId).first('n')).toBe(1);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM transaction_guards').first('n')).toBe(0);
    expect((await h.request(FILE + '.lock', 'DELETE', undefined, basic('final-owner', app))).status).toBe(204);
  });
  test('已有库的非法或不完整环境配置拒绝应用，原账号和凭证不变', async () => {
    for (const next of [{ USERNAME: 'final-owner', PASSWORD: 'short' }, { USERNAME: 'final-owner' }, { PASSWORD: THIRD }]) {
      await h.restart(next, false); const result = await initialize();
      expect(result.status).toBe(503); expect(await result.json()).toEqual({ error: 'username_password_not_configured' });
    }
    expect((await h.request('/api/me', 'GET', undefined, 'Bearer ' + session)).status).toBe(200);
    expect(await h.db.prepare('SELECT username FROM users WHERE id=?').bind(userId).first('username')).toBe('final-owner');
  });
  test('请求体和URL参数不能修改账号；只读取受信任的Worker配置', async () => {
    await h.restart({ USERNAME: 'final-owner', PASSWORD: THIRD }, false);
    const result = await h.request('/init?USERNAME=intruder&PASSWORD=ignored', 'POST', JSON.stringify({ username: 'intruder', password: FIRST }), undefined, headers);
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ ready: true, accountCreated: false, accountUpdated: false });
    expect(await h.db.prepare('SELECT username FROM users WHERE id=?').bind(userId).first('username')).toBe('final-owner');
  });
  test('删除账号后保留关联标记，不重建或改用其他用户', async () => {
    await h.db.prepare('DELETE FROM users WHERE id=?').bind(userId).run();
    expect(await h.db.prepare('SELECT user_id FROM environment_account WHERE id=1').first('user_id')).toBeNull();
    await h.restart({ USERNAME: 'other-user', PASSWORD: FIRST }, false);
    const result = await initialize(); expect(result.status).toBe(409); expect(await result.json()).toEqual({ error: 'environment_account_deleted' });
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(1);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('other-user', FIRST))).status).toBe(204);
  });
  test('旧库不随意选择用户：先凭原账号确认关联，再允许环境变量改名改密码', async () => {
    const a = await legacy.account('alice'); const b = await legacy.account('bob'); const d = await a.device();
    const rejected = await initialize(legacy); expect(rejected.status).toBe(409); expect(await rejected.json()).toEqual({ error: 'environment_account_unbound' });
    expect(await legacy.db.prepare('SELECT COUNT(*) AS n FROM environment_account').first('n')).toBe(0);
    expect((await legacy.request('/dav/', 'OPTIONS', undefined, d.basic)).status).toBe(204);
    await legacy.restart({ USERNAME: 'alice', PASSWORD: LEGACY_PASSWORD });
    expect(await (await initialize(legacy)).json()).toEqual({ ready: true, accountCreated: false, accountUpdated: false });
    expect(await legacy.db.prepare('SELECT user_id FROM environment_account').first('user_id')).toBe(a.userId);
    expect((await legacy.request('/dav/', 'OPTIONS', undefined, d.basic)).status).toBe(204);
    await legacy.restart({ USERNAME: 'renamed-alice', PASSWORD: SECOND });
    expect(await (await initialize(legacy)).json()).toEqual({ ready: true, accountCreated: false, accountUpdated: true });
    expect(await legacy.db.prepare('SELECT id FROM users WHERE username=?').bind('renamed-alice').first('id')).toBe(a.userId);
    expect(await legacy.db.prepare('SELECT id FROM users WHERE username=?').bind('bob').first('id')).toBe(b.userId);
    expect((await legacy.request('/dav/', 'OPTIONS', undefined, d.basic)).status).toBe(401);
  });
  test('未配置现代变量时仅应用迁移，旧兼容变量不会覆盖已有账号', async () => {
    await legacy.restart({ BOOTSTRAP_USERNAME: 'unrelated', BOOTSTRAP_PASSWORD: FIRST });
    expect(await (await initialize(legacy)).json()).toEqual({ ready: true, accountCreated: false, accountUpdated: false });
    expect((await legacy.request('/dav/', 'OPTIONS', undefined, basic('renamed-alice', SECOND))).status).toBe(204);
  });
  test('初始化限流保护昂贵密码操作，达到上限时不更新账号', async () => {
    const isolated = await harness({ USERNAME: 'limited-owner', PASSWORD: FIRST }, { migrate: false, legacySecrets: false });
    try {
      expect((await initialize(isolated)).status).toBe(200);
      await isolated.restart({ USERNAME: 'limited-owner', PASSWORD: SECOND }, false);
      const pepper = await isolated.db.prepare("SELECT value FROM app_settings WHERE key='token_pepper'").first<string>('value');
      const key = createHmac('sha256', pepper!).update('rate:init-ip:192.0.2.130').digest('hex');
      const bucket = Math.floor(Date.now() / 60_000) * 60_000;
      for (const at of [bucket, bucket + 60_000]) await isolated.db.prepare('INSERT INTO rate_limits(key,bucket,count) VALUES(?,?,20) ON CONFLICT(key,bucket) DO UPDATE SET count=20').bind(key, at).run();
      const response = await isolated.request('/init', 'GET', undefined, undefined, { ...headers, 'CF-Connecting-IP': '192.0.2.130' }); expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('60');
      expect((await isolated.request('/dav/', 'OPTIONS', undefined, basic('limited-owner', FIRST))).status).toBe(204);
      expect((await isolated.request('/dav/', 'OPTIONS', undefined, basic('limited-owner', SECOND))).status).toBe(401);
    } finally { await isolated.close(); }
  });
});
