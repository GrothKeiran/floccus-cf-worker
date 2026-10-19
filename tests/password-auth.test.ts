import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { FILE, bookmark, harness, xbel } from './harness';
const INITIAL = '初始Password:26!'; // 14 chars, UTF-8, colon; deliberately shorter than an app token.
const NEXT = 'Changed-account-password-2026!';
const basic = (username = 'owner', password = INITIAL) => 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
const chrome = { 'User-Agent': 'Chrome-test', 'CF-Connecting-IP': '192.0.2.60' };
const firefox = { ...chrome, 'User-Agent': 'Firefox-test' };
describe('账户密码直接用于 Floccus WebDAV', () => {
  let h: Awaited<ReturnType<typeof harness>>;
  let userId: string; let session: string; let app: string; let admin: string;
  beforeAll(async () => { h = await harness({ USERNAME: 'owner', PASSWORD: INITIAL }, { migrate: false, legacySecrets: false }); });
  afterAll(async () => { await h?.close(); });
  test('空 D1 只配置两个变量，/init 后同一个 PASSWORD 即可认证', async () => {
    expect(INITIAL).toHaveLength(14);
    expect((await h.request('/init', 'GET', undefined, undefined, { Accept: 'application/json' })).status).toBe(200);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic(), chrome)).status).toBe(204);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('OWNER'), chrome)).status).toBe(204);
    userId = (await h.db.prepare('SELECT id FROM users').first<string>('id'))!;
    admin = (await h.db.prepare("SELECT value FROM app_settings WHERE key='admin_token'").first<string>('value'))!;
    const login = await h.request('/api/login', 'POST', JSON.stringify({ username: 'owner', password: INITIAL }));
    session = (await login.json() as { accessToken: string }).accessToken;
  });
  test('错误密码与未知用户名拒绝；Basic UTF-8 和最短合法密码不会被 token 长度规则挡住', async () => {
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('owner', 'Wrong-password-2026!'), chrome)).status).toBe(401);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('unknown-user'), chrome)).status).toBe(401);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('owner', 'too-short'), chrome)).status).toBe(401);
  });
  test('同密码不同浏览器上下文各有身份，不能抢锁或删除对方锁，temp/MOVE 正常提交', async () => {
    expect((await h.request(FILE + '.lock', 'PUT', 'lock', basic(), chrome)).status).toBe(201);
    expect((await h.request(FILE + '.lock', 'PUT', 'lock', basic(), firefox)).status).toBe(423);
    expect((await h.request(FILE + '.lock', 'DELETE', undefined, basic(), firefox)).status).toBe(423);
    const body = xbel(bookmark(1, '同一个环境密码同步成功'));
    expect((await h.request(FILE + '.temp', 'PUT', body, basic(), chrome)).status).toBe(201);
    expect((await h.request(FILE + '.temp', 'MOVE', undefined, basic(), { ...chrome, Destination: 'https://sync.test' + FILE, Overwrite: 'T' })).status).toBe(204);
    expect((await h.request(FILE + '.lock', 'DELETE', undefined, basic(), chrome)).status).toBe(204);
    expect(await (await h.request(FILE, 'GET', undefined, basic(), firefox)).text()).toBe(body);
    expect(await h.db.prepare("SELECT COUNT(*) AS n FROM credentials WHERE auth_mode='password'").first('n')).toBe(2);
    expect((await h.request(FILE + '.lock', 'PUT', 'lock', basic(), firefox)).status).toBe(201);
    expect((await h.request(FILE + '.lock', 'DELETE', undefined, basic(), firefox)).status).toBe(204);
  });
  test('用户隔离：另一个账号看不到前一个账号的文件，错误用户名不复用成功缓存', async () => {
    const created = await h.request('/api/admin/users', 'POST', JSON.stringify({ username: 'other-user', password: NEXT }), 'Bearer ' + admin);
    expect(created.status).toBe(201);
    expect((await h.request(FILE, 'GET', undefined, basic('other-user', NEXT), chrome)).status).toBe(404);
    expect((await h.request(FILE, 'GET', undefined, basic('other-user'), chrome)).status).toBe(401);
  });
  test('可选应用密码继续有效；内部上下文不出现在设备列表，不能通过设备撤销 API 管理', async () => {
    const created = await h.request('/api/devices', 'POST', JSON.stringify({ label: 'optional-device' }), 'Bearer ' + session);
    expect(created.status).toBe(201);
    app = (await created.json() as { applicationPassword: string }).applicationPassword;
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('owner', app), chrome)).status).toBe(204);
    const listed = await (await h.request('/api/devices', 'GET', undefined, 'Bearer ' + session)).json() as { id: string; label: string }[];
    expect(listed.map(row => row.label)).toEqual(['optional-device']);
    const internalId = await h.db.prepare("SELECT id FROM credentials WHERE user_id=? AND auth_mode='password' LIMIT 1").bind(userId).first<string>('id');
    expect((await h.request('/api/devices/' + internalId, 'DELETE', undefined, 'Bearer ' + session)).status).toBe(204);
    expect(await h.db.prepare('SELECT id FROM credentials WHERE id=?').bind(internalId).first('id')).toBe(internalId);
  });
  test('内部身份不会占用50个显式凭证配额，按天到期且不持久化账户密码快速验证器', async () => {
    const row = await h.db.prepare('SELECT password_hash FROM users WHERE id=?').bind(userId).first<string>('password_hash');
    expect(row).toMatch(/^scrypt\$16384\$8\$5\$/);
    const pepper = await h.db.prepare("SELECT value FROM app_settings WHERE key='token_pepper'").first<string>('value');
    const quickHash = createHmac('sha256', pepper!).update(INITIAL).digest('hex');
    const internal = (await h.db.prepare("SELECT * FROM credentials WHERE user_id=? AND auth_mode='password'").bind(userId).all()).results;
    expect(internal.every(row => Number(row.expires_at) > Date.now() && Number(row.expires_at) <= Date.now() + 86_400_000)).toBe(true);
    const serialized = JSON.stringify(internal);
    expect(serialized).not.toContain(INITIAL); expect(serialized).not.toContain(quickHash);
    const n = (await h.db.prepare("SELECT COUNT(*) AS n FROM credentials WHERE user_id=? AND auth_mode='token'").bind(userId).first<number>('n'))!;
    const filler = Array.from({ length: 49 - n }, (_, i) => h.db.prepare("INSERT INTO credentials(id,user_id,kind,label,token_hash,created_at) VALUES(?,?,'device','quota',?,?)").bind('quota-' + i, userId, 'quota-hash-' + i, Date.now()));
    await h.db.batch(filler);
    expect((await h.request('/api/devices', 'POST', JSON.stringify({ label: 'last-slot' }), 'Bearer ' + session)).status).toBe(201);
    expect((await h.request('/api/devices', 'POST', JSON.stringify({ label: 'overflow' }), 'Bearer ' + session)).status).toBe(422);
    await h.db.prepare("DELETE FROM credentials WHERE label IN ('quota','last-slot')").run();
  });
  test('内部上下文独立限额，已有上下文不被驱逐，也不会无限创建凭证', async () => {
    const n = (await h.db.prepare("SELECT COUNT(*) AS n FROM credentials WHERE user_id=? AND auth_mode='password'").bind(userId).first<number>('n'))!;
    for (let i = n; i < 32; i++) expect((await h.request('/dav/', 'OPTIONS', undefined, basic(), { ...chrome, 'User-Agent': 'context-' + i })).status).toBe(204);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic(), { ...chrome, 'User-Agent': 'overflow-context' })).status).toBe(429);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic(), chrome)).status).toBe(204);
    expect(await h.db.prepare("SELECT COUNT(*) AS n FROM credentials WHERE user_id=? AND auth_mode='password'").bind(userId).first('n')).toBe(32);
  });
  test('过期上下文重建仍受32个活跃身份限制，正常续期不改变锁身份', async () => {
    const id = await h.db.prepare("SELECT id FROM credentials WHERE user_id=? AND auth_mode='password' ORDER BY created_at LIMIT 1").bind(userId).first<string>('id');
    await h.db.prepare('UPDATE credentials SET expires_at=0 WHERE id=?').bind(id).run();
    const replacement = { ...chrome, 'User-Agent': 'replacement-context' };
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic(), replacement)).status).toBe(204);
    // The earliest context was Chrome; renewing it must not produce a 33rd active identity.
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic(), chrome)).status).toBe(429);
    await h.db.prepare("DELETE FROM credentials WHERE user_id=? AND auth_mode='password' AND id!=? AND expires_at>?").bind(userId, id, Date.now()).run();
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic(), chrome)).status).toBe(204);
    await h.db.prepare('UPDATE credentials SET expires_at=? WHERE id=?').bind(Date.now() + 60_000, id).run();
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic(), chrome)).status).toBe(204);
    expect(Number(await h.db.prepare('SELECT expires_at FROM credentials WHERE id=?').bind(id).first('expires_at'))).toBeGreaterThan(Date.now() + 3_600_000);
  });
  test('密码重置立即使旧密码和成功缓存失效；旧应用密码、会话和同步锁一同撤销', async () => {
    expect((await h.request(FILE + '.lock', 'PUT', 'lock', basic(), chrome)).status).toBe(201);
    expect((await h.request('/api/admin/reset-password', 'POST', JSON.stringify({ username: 'owner', password: NEXT }), 'Bearer ' + admin)).status).toBe(200);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic(), chrome)).status).toBe(401);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('owner', app), chrome)).status).toBe(401);
    expect((await h.request('/api/me', 'GET', undefined, 'Bearer ' + session)).status).toBe(401);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM sync_locks WHERE user_id=?').bind(userId).first('n')).toBe(0);
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('owner', NEXT), chrome)).status).toBe(204);
    expect((await h.request(FILE, 'GET', undefined, basic('owner', NEXT), chrome)).status).toBe(200);
  });
  test('错误密码验证限流；只限未缓存的验证，不限正常缓存同步序列', async () => {
    const headers = { ...chrome, 'CF-Connecting-IP': '192.0.2.80' };
    let response!: Response;
    for (let i = 0; i < 21; i++) { response = await h.request('/dav/', 'OPTIONS', undefined, basic('rate-test-user', 'Wrong-password-2026!'), headers); if (response.status === 429) break; }
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('60');
    expect((await h.request('/dav/', 'OPTIONS', undefined, basic('owner', NEXT), headers)).status).toBe(204);
  });
  test('已有 v0.3 数据库自动 ALTER 升级，不重建账号或破坏旧应用密码', async () => {
    const old = await harness({ USERNAME: 'legacy-user', PASSWORD: NEXT }, { migrate: false });
    try {
      await old.db.prepare('CREATE TABLE d1_migrations(name TEXT UNIQUE)').run();
      for (const name of ['0001_initial.sql', '0002_bootstrap.sql', '0003_app_settings.sql']) {
        for (const sql of (await readFile('migrations/' + name, 'utf8')).split(';').map(s => s.trim()).filter(Boolean)) await old.db.prepare(sql).run();
        await old.db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(name).run();
      }
      const storedHash = await h.db.prepare('SELECT password_hash FROM users WHERE id=?').bind(userId).first<string>('password_hash');
      const pepper = 'test-pepper-' + 'b'.repeat(64);
      await old.db.batch([
        old.db.prepare('INSERT INTO users VALUES(?,?,?,?)').bind('old-user', 'legacy-user', storedHash, Date.now()),
        old.db.prepare('INSERT INTO sync_state(user_id,updated_at) VALUES(?,?)').bind('old-user', Date.now()),
        old.db.prepare("INSERT INTO credentials VALUES(?,?,'device','old-device',?,NULL,?)").bind('old-device', 'old-user', createHmac('sha256', pepper).update(app).digest('hex'), Date.now()),
      ]);
      expect((await old.request('/health/ready')).status).toBe(503);
      expect((await old.request('/init', 'GET', undefined, undefined, { Accept: 'application/json' })).status).toBe(200);
      expect((await old.request('/dav/', 'OPTIONS', undefined, basic('legacy-user', NEXT), chrome)).status).toBe(204);
      expect((await old.request('/dav/', 'OPTIONS', undefined, basic('legacy-user', app), chrome)).status).toBe(204);
      expect(await old.db.prepare('SELECT id FROM users').first('id')).toBe('old-user');
      expect(await old.db.prepare("SELECT auth_mode FROM credentials WHERE id='old-device'").first('auth_mode')).toBe('token');
      expect((await old.request('/health/ready')).status).toBe(200);
    } finally { await old.close(); }
  });
});
