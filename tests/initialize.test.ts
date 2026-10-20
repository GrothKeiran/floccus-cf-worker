import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { harness, PASSWORD } from './harness';
const INIT_PASSWORD = 'Only-two-settings-password-2026!';
let fresh: Awaited<ReturnType<typeof harness>>;
let invalid: Awaited<ReturnType<typeof harness>>;
let legacy: Awaited<ReturnType<typeof harness>>;
let missingPepper: Awaited<ReturnType<typeof harness>>;
let app = '';
let userId = '';
let previousKeys = '';
const initHeaders = { Accept: 'application/json' };
beforeAll(async () => {
  fresh = await harness({ USERNAME: 'owner', PASSWORD: INIT_PASSWORD }, { migrate: false, legacySecrets: false });
  invalid = await harness({ USERNAME: 'owner', PASSWORD: 'tiny' }, { migrate: false, legacySecrets: false });
  legacy = await harness({ USERNAME: 'alice', PASSWORD });
  missingPepper = await harness({ USERNAME: 'alice', PASSWORD });
});
afterAll(async () => { await fresh?.close(); await invalid?.close(); await legacy?.close(); await missingPepper?.close(); });
describe('仅两个变量与空 D1 的完整初始化', () => {
  test('空库可读取状态，未初始化时给出清晰提示，不需要手工 Secret 或 SQL', async () => {
    expect(await (await fresh.request('/api/setup/status')).json()).toEqual({ initialized: false, bootstrapConfigured: true, databaseInitialized: false });
    const notReady = await fresh.request('/health/ready');
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toEqual({ error: 'database_not_initialized' });
    expect((await fresh.request('/admin')).status).toBe(200);
  });
  test('错误配置不创建表；初始化不接受 URL 注入其他账号', async () => {
    const response = await invalid.request('/init', 'GET', undefined, undefined, initHeaders);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'initial_password_length_invalid' });
    expect(await invalid.db.prepare("SELECT name FROM sqlite_master WHERE name='users'").first()).toBeNull();
    expect((await fresh.request('/init', 'POST', undefined, undefined, { Origin: 'https://evil.test' })).status).toBe(403);
  });
  test('并发访问 /init 自动建全部表、内部密钥、迁移记录，并只初始化一个配置账号', async () => {
    const results = await Promise.all([
      fresh.request('/init?USERNAME=intruder&PASSWORD=wrong', 'GET', undefined, undefined, initHeaders),
      fresh.request('/init', 'GET', undefined, undefined, initHeaders),
    ]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    const bodies = await Promise.all(results.map(result => result.json() as Promise<{ ready: boolean; accountCreated: boolean }>));
    expect(bodies.every(result => result.ready)).toBe(true);
    expect(bodies.filter(result => result.accountCreated)).toHaveLength(1);
    const user = await fresh.db.prepare('SELECT id,username,password_hash FROM users').first<{ id: string; username: string; password_hash: string }>();
    expect(user!.username).toBe('owner'); userId = user!.id;
    expect(user!.password_hash).toMatch(/^scrypt\$16384\$8\$5\$/);
    expect(user!.password_hash).not.toContain(INIT_PASSWORD);
    expect(await fresh.db.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(1);
    expect(await fresh.db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').first('n')).toBe(5);
    const keys = (await fresh.db.prepare("SELECT key,value FROM app_settings WHERE key IN ('admin_token','token_pepper') ORDER BY key").all()).results;
    expect(keys).toHaveLength(2); previousKeys = JSON.stringify(keys);
    expect(keys.every(row => /^[a-f0-9]{64}$/.test(String(row.value)))).toBe(true);
    expect((await fresh.request('/health/ready')).status).toBe(200);
  });
  test('变量中的账号密码确实可登录，设备凭证流程保持可用，内部密钥不回传', async () => {
    const login = await fresh.request('/api/login', 'POST', JSON.stringify({ username: 'owner', password: INIT_PASSWORD }));
    expect(login.status).toBe(200);
    const session = (await login.json() as { accessToken: string }).accessToken;
    const device = await fresh.request('/api/devices', 'POST', JSON.stringify({ label: 'first-browser' }), `Bearer ${session}`);
    expect(device.status).toBe(201);
    app = (await device.json() as { applicationPassword: string }).applicationPassword;
    expect((await fresh.request('/dav/', 'OPTIONS', undefined, 'Basic ' + Buffer.from('owner:' + app).toString('base64'))).status).toBe(204);
    const html = await (await fresh.request('/init')).text();
    expect(html).toContain('初始化完成');
    expect(html).not.toContain(INIT_PASSWORD);
    for (const row of JSON.parse(previousKeys)) expect(html).not.toContain(row.value);
  });
  test('重复初始化不更换密钥、密码、账号或已有书签状态', async () => {
    await fresh.db.prepare('UPDATE sync_state SET version=23,body=? WHERE user_id=?').bind('existing-snapshot', userId).run();
    const oldHash = await fresh.db.prepare('SELECT password_hash FROM users').first('password_hash');
    const result = await fresh.request('/init', 'GET', undefined, undefined, initHeaders);
    expect(await result.json()).toEqual({ ready: true, accountCreated: false, accountUpdated: false });
    expect(await fresh.db.prepare('SELECT password_hash FROM users').first('password_hash')).toBe(oldHash);
    expect(await fresh.db.prepare('SELECT version FROM sync_state WHERE user_id=?').bind(userId).first('version')).toBe(23);
    const keys = (await fresh.db.prepare("SELECT key,value FROM app_settings WHERE key IN ('admin_token','token_pepper') ORDER BY key").all()).results;
    expect(JSON.stringify(keys)).toBe(previousKeys);
  });
  test('重启修改两个变量后 init 更新原账号，保留数据并撤销旧设备密码', async () => {
    await fresh.restart({ USERNAME: 'another-owner', PASSWORD: 'Changed-environment-password-2026!' }, false);
    expect((await fresh.request('/init', 'GET', undefined, undefined, initHeaders)).status).toBe(200);
    expect((await fresh.request('/api/login', 'POST', JSON.stringify({ username: 'owner', password: INIT_PASSWORD }))).status).toBe(401);
    expect((await fresh.request('/api/login', 'POST', JSON.stringify({ username: 'another-owner', password: 'Changed-environment-password-2026!' }))).status).toBe(200);
    expect(await fresh.db.prepare('SELECT id FROM users').first('id')).toBe(userId);
    expect(await fresh.db.prepare('SELECT version FROM sync_state WHERE user_id=?').bind(userId).first('version')).toBe(23);
    expect((await fresh.request('/dav/', 'OPTIONS', undefined, 'Basic ' + Buffer.from('owner:' + app).toString('base64'))).status).toBe(401);
  });
  test('旧部署先访问 /init 会保留旧 pepper，移除额外 Secrets 后旧应用密码继续有效', async () => {
    const account = await legacy.account(); const oldDevice = await account.device();
    expect((await legacy.request('/init', 'GET', undefined, undefined, initHeaders)).status).toBe(200);
    await legacy.restart({ USERNAME: 'alice', PASSWORD }, false);
    expect((await legacy.request('/dav/', 'OPTIONS', undefined, oldDevice.basic)).status).toBe(204);
    expect((await legacy.request('/api/login', 'POST', JSON.stringify({ username: 'alice', password: PASSWORD }))).status).toBe(200);
  });
  test('旧 pepper 未迁入 D1 就被移除时，不生成替代密钥破坏旧凭证', async () => {
    const account = await missingPepper.account(); await account.device();
    await missingPepper.restart({ USERNAME: 'alice', PASSWORD }, false);
    const result = await missingPepper.request('/init', 'GET', undefined, undefined, initHeaders);
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: 'legacy_pepper_required' });
  });
});
