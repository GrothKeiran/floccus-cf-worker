import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ADMIN, PASSWORD, FILE, bookmark, harness, write, xbel } from './harness';
let h: Awaited<ReturnType<typeof harness>>;
let a: Awaited<ReturnType<typeof h.account>>;
let d: Awaited<ReturnType<typeof a.device>>;
beforeAll(async () => { h = await harness(); a = await h.account(); d = await a.device(); });
afterAll(async () => h?.close());
async function reset() {
  await h.db.prepare('DELETE FROM sync_locks').run();
  await h.db.prepare('DELETE FROM staging').run();
}
describe('认证与账户管理（真实 workerd + D1）', () => {
  test('健康、就绪、HTTPS 与默认关闭注册', async () => {
    expect((await h.request('/health')).status).toBe(200);
    expect((await h.request('/health/ready')).status).toBe(200);
    expect((await h.mf.dispatchFetch('http://evil.test/health')).status).toBe(426);
    expect((await h.request('/api/register', 'POST', '{}')).status).toBe(403);
    expect((await h.request('/api/admin/users', 'POST', '{}', 'Bearer incorrect')).status).toBe(401);
  });
  test('scrypt 密码验证、错误认证、原密码不得用于 DAV', async () => {
    const row = await h.db.prepare('SELECT password_hash FROM users WHERE id=?').bind(a.userId).first<{ password_hash: string }>();
    expect(row!.password_hash).toMatch(/^scrypt\$16384\$8\$5\$/);
    expect(row!.password_hash).not.toContain(PASSWORD);
    expect((await h.request('/api/login', 'POST', JSON.stringify({ username: 'alice', password: 'incorrect' }))).status).toBe(401);
    expect((await h.request(FILE)).status).toBe(401);
    expect((await h.request(FILE, 'GET', undefined, 'Basic !!!')).status).toBe(401);
    expect((await h.request(FILE, 'GET', undefined, `Basic ${Buffer.from('alice:' + PASSWORD).toString('base64')}`)).status).toBe(401);
  });
  test('过期会话拒绝访问，凭证原子上限不超过50', async () => {
    const login = await h.request('/api/login', 'POST', JSON.stringify({ username: 'alice', password: PASSWORD }));
    const { accessToken } = await login.json() as { accessToken: string };
    await h.db.prepare("UPDATE credentials SET expires_at=0 WHERE user_id=? AND label='management' AND id!=?").bind(a.userId, (await h.db.prepare("SELECT id FROM credentials WHERE user_id=? AND kind='session' ORDER BY created_at LIMIT 1").bind(a.userId).first('id'))).run();
    expect((await h.request('/api/me', 'GET', undefined, `Bearer ${accessToken}`)).status).toBe(401);
    // SQL fixture fills the remaining credential slots; no real secrets are exposed.
    const existing = await h.db.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id=? AND (expires_at IS NULL OR expires_at>?)').bind(a.userId, Date.now()).first<number>('n');
    const ids = Array.from({ length: 50 - Number(existing) }, (_, i) => 'quota-' + i);
    await h.db.prepare(`INSERT INTO credentials(id,user_id,kind,label,token_hash,created_at)
      SELECT value,?,'device','quota',value,0 FROM json_each(?)`).bind(a.userId, JSON.stringify(ids)).run();
    expect((await h.request('/api/devices', 'POST', JSON.stringify({ label: 'over quota' }), `Bearer ${a.session}`)).status).toBe(422);
    await h.db.prepare("DELETE FROM credentials WHERE user_id=? AND label='quota'").bind(a.userId).run();
  });
  test('会话失效与设备凭证撤销立即生效', async () => {
    const login = await h.request('/api/login', 'POST', JSON.stringify({ username: 'alice', password: PASSWORD }));
    const { accessToken } = await login.json() as { accessToken: string };
    expect((await h.request('/api/me', 'GET', undefined, `Bearer ${accessToken}`)).status).toBe(200);
    expect((await h.request('/api/logout', 'POST', undefined, `Bearer ${accessToken}`)).status).toBe(204);
    expect((await h.request('/api/me', 'GET', undefined, `Bearer ${accessToken}`)).status).toBe(401);
    const revoked = await a.device('to revoke');
    await h.request('/api/devices/' + revoked.id, 'DELETE', undefined, `Bearer ${a.session}`);
    expect((await h.request(FILE, 'GET', undefined, revoked.basic)).status).toBe(401);
  });
});
describe('WebDAV 原子快照同步', () => {
  test('首次同步、UTF-8 字节数、PROPFIND、条件读取', async () => {
    expect((await h.request(FILE, 'GET', undefined, d.basic)).status).toBe(404);
    const body = xbel(`<folder id="1"><title>书签栏</title>${bookmark(2)}</folder>`, 2);
    const r = await write(h, d.basic, body);
    expect(await r.text()).toBe(''); expect(r.status).toBe(201);
    const get = await h.request(FILE, 'GET', undefined, d.basic);
    expect(await get.text()).toBe(body);
    const bytes = Buffer.byteLength(body);
    const head = await h.request(FILE, 'HEAD', undefined, d.basic);
    expect(head.headers.get('Content-Length')).toBe(String(bytes)); expect(await head.text()).toBe('');
    const prop = await h.request(FILE, 'PROPFIND', undefined, d.basic, { Depth: '0' });
    expect(prop.status).toBe(207); expect(await prop.text()).toContain(`<d:getcontentlength>${bytes}</d:getcontentlength>`);
    expect((await h.request(FILE, 'GET', undefined, d.basic, { 'If-None-Match': get.headers.get('ETag')! })).status).toBe(304);
  });
  test('后续编辑、移动、重命名、重排，创建时间保持', async () => {
    const before = await h.db.prepare('SELECT created_at FROM nodes WHERE user_id=? AND node_id=2').bind(a.userId).first();
    const body = xbel(`<folder id="1"><title>重命名</title></folder><folder id="3"><title>移动目标</title>${bookmark(2, '已编辑', 'https://example.org/new')}${bookmark(4, '新建')}</folder>`, 4);
    expect((await write(h, d.basic, body)).status).toBe(201);
    const node = await h.db.prepare('SELECT * FROM nodes WHERE user_id=? AND node_id=2').bind(a.userId).first();
    expect(node).toMatchObject({ parent_id: 3, title: '已编辑', position: 0, url: 'https://example.org/new', created_at: before!.created_at });
    const reorder = xbel(`<folder id="3"><title>移动目标</title>${bookmark(4, '新建')}${bookmark(2, '已编辑', 'https://example.org/new')}</folder><folder id="1"><title>重命名</title></folder>`, 4);
    expect((await write(h, d.basic, reorder)).status).toBe(201);
    expect(await h.db.prepare('SELECT position FROM nodes WHERE user_id=? AND node_id=2').bind(a.userId).first('position')).toBe(1);
  });
  test('临时上传不改变正式内容，MOVE 后才提交，重试不增加版本', async () => {
    await reset();
    const original = await (await h.request(FILE, 'GET', undefined, d.basic)).text();
    const body = xbel(`<folder id="1"><title>更名2</title></folder><folder id="3"><title>目标</title>${bookmark(4)}${bookmark(2)}</folder>`, 4);
    expect((await h.request(FILE + '.lock', 'PUT', 'lock', d.basic)).status).toBe(201);
    expect((await h.request(FILE + '.temp', 'PUT', body, d.basic)).status).toBe(201);
    expect(await (await h.request(FILE, 'GET', undefined, d.basic)).text()).toBe(original);
    const headers = { Destination: 'https://sync.test' + FILE, Overwrite: 'T' };
    expect((await h.request(FILE + '.temp', 'MOVE', undefined, d.basic, headers)).status).toBe(204);
    const version = await h.db.prepare('SELECT version FROM sync_state WHERE user_id=?').bind(a.userId).first('version');
    expect((await h.request(FILE + '.temp', 'MOVE', undefined, d.basic, headers)).status).toBe(204);
    expect(await h.db.prepare('SELECT version FROM sync_state WHERE user_id=?').bind(a.userId).first('version')).toBe(version);
    await reset();
  });
  test('两个设备原子抢锁，锁持有者以外不得写入或释放', async () => {
    await reset(); const other = await a.device('Firefox');
    const results = await Promise.all([h.request(FILE + '.lock', 'PUT', 'lock', d.basic), h.request(FILE + '.lock', 'PUT', 'lock', other.basic)]);
    expect(results.map(x => x.status).sort()).toEqual([201, 423]);
    const loser = results[0].status === 201 ? other : d;
    expect((await h.request(FILE, 'PUT', xbel('', 4), loser.basic)).status).toBe(423);
    expect((await h.request(FILE + '.lock', 'DELETE', undefined, loser.basic)).status).toBe(423);
    await reset();
  });
  test('官方两分钟续租与过期 generation 隔离', async () => {
    await reset();
    expect((await h.request(FILE + '.lock', 'PUT', 'lock', d.basic)).status).toBe(201);
    const first = await h.db.prepare('SELECT generation FROM sync_locks WHERE user_id=?').bind(a.userId).first('generation');
    expect((await h.request(FILE + '.lock', 'PUT', 'lock', d.basic)).status).toBe(423);
    await h.db.prepare('UPDATE sync_locks SET updated_at=updated_at-120000 WHERE user_id=?').bind(a.userId).run();
    expect((await h.request(FILE + '.lock', 'PUT', 'lock', d.basic)).status).toBe(201);
    expect(await h.db.prepare('SELECT generation FROM sync_locks WHERE user_id=?').bind(a.userId).first('generation')).toBe(first);
    await h.request(FILE + '.temp', 'PUT', xbel('', 4), d.basic);
    await h.db.prepare('UPDATE sync_locks SET expires_at=0 WHERE user_id=?').bind(a.userId).run();
    expect((await h.request(FILE + '.lock', 'PUT', 'lock', d.basic)).status).toBe(201);
    expect(await h.db.prepare('SELECT generation FROM sync_locks WHERE user_id=?').bind(a.userId).first('generation')).not.toBe(first);
    expect((await h.request(FILE + '.temp', 'MOVE', undefined, d.basic, { Destination: 'https://sync.test' + FILE })).status).toBe(404);
    await reset();
  });
  test('删除整个文件夹生成子树墓碑，旧 ID 不得复活', async () => {
    expect((await write(h, d.basic, xbel('<folder id="1"><title>仅保留</title></folder>', 4))).status).toBe(201);
    const rows = await h.db.prepare('SELECT node_id,deleted FROM nodes WHERE user_id=? AND node_id IN (2,3,4)').bind(a.userId).all();
    expect(rows.results).toHaveLength(3); expect(rows.results.every(x => x.deleted === 1)).toBe(true);
    const r = await write(h, d.basic, xbel(`<folder id="1"><title>仅保留</title>${bookmark(2)}</folder>`, 4));
    expect(r.status).toBe(412);
    expect(await h.db.prepare('SELECT deleted FROM nodes WHERE user_id=? AND node_id=2').bind(a.userId).first('deleted')).toBe(1);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM transaction_guards').first('n')).toBe(0);
  });
  test('跨用户隔离、无效父级与循环 ID、恶意 URL、XXE', async () => {
    const b = await h.account('bob'); const bd = await b.device();
    expect((await h.request(FILE, 'GET', undefined, bd.basic)).status).toBe(404);
    expect((await h.request('/api/devices/' + d.id, 'DELETE', undefined, `Bearer ${b.session}`)).status).toBe(204);
    expect((await h.request(FILE, 'GET', undefined, d.basic)).status).toBe(200);
    const bad = [xbel(bookmark(5, 'evil', 'javascript:alert(1)'), 5), xbel('<folder id="5"><title>x</title><folder id="5"><title>cycle</title></folder></folder>', 5), xbel('<folder id="-1"><title>invalid</title></folder>', 5), xbel('<bookmark id="5" href="https://example.org"><title>x</title><folder id="6"><title>child</title></folder></bookmark>', 6), xbel(bookmark(5), 5).replace('<xbel', '<!DOCTYPE xbel [<!ENTITY e SYSTEM "file:///etc/passwd">]><xbel')];
    for (const body of bad) expect((await write(h, bd.basic, body)).status).toBe(422);
  });
  test('无效 JSON、超大流、错误条件、外部 MOVE，不破坏正式快照', async () => {
    expect((await h.request('/api/devices', 'POST', '{', `Bearer ${a.session}`)).status).toBe(400);
    await h.request(FILE + '.lock', 'PUT', 'lock', d.basic);
    expect((await h.request(FILE + '.temp', 'PUT', 'x'.repeat(524289), d.basic)).status).toBe(413);
    expect((await h.request(FILE, 'PUT', xbel('', 4), d.basic, { 'If-Match': '"wrong"' })).status).toBe(412);
    expect((await h.request(FILE + '.temp', 'MOVE', undefined, d.basic, { Destination: 'https://attacker.test' + FILE })).status).toBe(403);
    expect((await h.request(FILE, 'DELETE', undefined, d.basic)).status).toBe(405);
    await reset();
  });
  test('1200 条书签初次导入、单节点编辑与全量后续同步', async () => {
    const large = await h.account('large'); const ld = await large.device();
    const body = xbel(Array.from({ length: 1200 }, (_, i) => bookmark(i + 1, '条目' + i)).join(''), 1200);
    expect((await write(h, ld.basic, body)).status).toBe(201);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM nodes WHERE user_id=? AND deleted=0').bind(large.userId).first('n')).toBe(1201);
    expect((await write(h, ld.basic, body.replace('条目0<', '已更新<'))).status).toBe(201);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM nodes WHERE user_id=? AND version=2').bind(large.userId).first('n')).toBe(1);
  });
  test('D1 batch 中后续语句失败会回滚之前写入', async () => {
    const before = await h.db.prepare('SELECT version FROM sync_state WHERE user_id=?').bind(a.userId).first('version');
    await expect(h.db.batch([
      h.db.prepare('UPDATE sync_state SET version=version+100 WHERE user_id=?').bind(a.userId),
      h.db.prepare('INSERT INTO transaction_guards(id,ok) VALUES(?,0)').bind('must-rollback'),
    ])).rejects.toThrow();
    expect(await h.db.prepare('SELECT version FROM sync_state WHERE user_id=?').bind(a.userId).first('version')).toBe(before);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM transaction_guards').first('n')).toBe(0);
  });
  test('过期锁不能提交，D1 事务回滚与原子版本检查', async () => {
    await h.request(FILE + '.lock', 'PUT', 'lock', d.basic);
    await h.db.prepare('UPDATE sync_locks SET expires_at=0').run();
    expect((await h.request(FILE, 'PUT', xbel('', 4), d.basic)).status).toBe(423);
    await reset();
    await h.request(FILE + '.lock', 'PUT', 'lock', d.basic);
    await h.request(FILE + '.temp', 'PUT', xbel('<folder id="1"><title>旧数据</title></folder>', 4), d.basic);
    await h.db.prepare('UPDATE sync_state SET version=version+1 WHERE user_id=?').bind(a.userId).run();
    expect((await h.request(FILE + '.temp', 'MOVE', undefined, d.basic, { Destination: 'https://sync.test' + FILE })).status).toBe(412);
    await reset();
  });
});
describe('恢复、删除和限流', () => {
  test('导出包含墓碑，账户删除级联清除全部数据', async () => {
    const exp = await h.request('/api/export', 'GET', undefined, `Bearer ${a.session}`);
    const value = await exp.json() as { nodes: { deleted: number }[] };
    expect(value.nodes.some(x => x.deleted === 1)).toBe(true);
    const c = await h.account('charlie'); const cd = await c.device();
    await write(h, cd.basic, xbel(bookmark(1), 1));
    expect((await h.request('/api/account', 'DELETE', JSON.stringify({ confirm: 'DELETE' }), `Bearer ${c.session}`)).status).toBe(204);
    expect((await h.request(FILE, 'GET', undefined, cd.basic)).status).toBe(401);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM nodes WHERE user_id=?').bind(c.userId).first('n')).toBe(0);
  });
  test('管理员恢复撤销所有会话/应用密码，不能查看密码', async () => {
    const r = await h.request('/api/admin/reset-password', 'POST', JSON.stringify({ username: 'alice', password: 'A-new-long-recovery-password!' }), `Bearer ${ADMIN}`);
    expect(r.status).toBe(200);
    expect((await h.request('/api/me', 'GET', undefined, `Bearer ${a.session}`)).status).toBe(401);
    expect((await h.request(FILE, 'GET', undefined, d.basic)).status).toBe(401);
  });
  test('密码验证限流返回 Retry-After', async () => {
    let result: Response | undefined;
    for (let i = 0; i < 12; i++) result = await h.request('/api/login', 'POST', JSON.stringify({ username: 'no-user', password: 'wrong' }));
    expect(result!.status).toBe(429); expect(result!.headers.get('Retry-After')).toBe('60');
  });
});
