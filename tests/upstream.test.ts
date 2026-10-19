/* These tests execute pinned, unmodified upstream WebDav/Tree/Caching/Scanner/Diff/strategies.
 * Only browser permission/storage host services, logging, and unused backend branches are shimmed.
 */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { FILE, harness } from './harness';
let h: Awaited<ReturnType<typeof harness>>;
let upstream: any;
let account: Awaited<ReturnType<typeof h.account>>;
const originalFetch = globalThis.fetch;
const originalSelf = (globalThis as any).self;
const settings = { preserveOrder: true, hashFn: 'sha256', syncTags: false };
const wire: { method: string; path: string; status: number; body?: string }[] = [];
beforeAll(async () => {
  h = await harness(); account = await h.account('upstream');
  (globalThis as any).self = { location: { protocol: 'chrome-extension:' } };
  upstream = await import(/* @vite-ignore */ pathToFileURL(resolve('.cache/upstream/floccus-test.mjs')).href);
  globalThis.fetch = async (input: any, init: any) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://sync.test') throw new Error('Unexpected upstream network request');
    const r = await h.mf.dispatchFetch(url.href, init);
    const bytes = await r.arrayBuffer();
    const response = new Response([204, 205, 304].includes(r.status) || init?.method === 'HEAD' ? null : bytes, { status: r.status, headers: Object.fromEntries(r.headers) });
    wire.push({ method: init?.method ?? 'GET', path: url.pathname, status: response.status, ...(init?.method === 'PUT' && !url.pathname.endsWith('.lock') ? { body: String(init.body) } : {}) });
    return response;
  };
});
afterAll(async () => {
  globalThis.fetch = originalFetch; (globalThis as any).self = originalSelf;
  await writeFile('.cache/protocol-trace.json', JSON.stringify(wire, null, 2));
  await h?.close();
});
async function adapter(label: string) {
  const d = await account.device(label);
  const a = new upstream.WebDav({ ...upstream.WebDav.getDefaultValues(), url: 'https://sync.test/dav/', username: account.username, password: d.applicationPassword, failsafe: false });
  a.setHashSettings(settings); return a;
}
function bm(parentId: number, title: string, url = 'https://example.com/' + encodeURIComponent(title)) {
  return new upstream.Bookmark({ parentId, title, url, location: upstream.ItemLocation.SERVER });
}
test('固定源码身份及官方适配器首次上传/读取/编辑/删除/排序/重复同步', async () => {
  const meta = JSON.parse(await readFile('.cache/upstream/verified.json', 'utf8'));
  expect(meta).toMatchObject({ version: '5.11.1', commit: 'c8ec55ee5e731206c6f2b34c48e8b4def47d0d5a', unmodified: true });
  const a = await adapter('real Chrome adapter');
  try {
    expect(await a.onSyncStart()).toBe(false);
    const folderId = await a.createFolder(new upstream.Folder({ parentId: 0, title: '顶部书签栏', location: upstream.ItemLocation.SERVER }));
    const first = await a.createBookmark(bm(folderId, '中文示例一'));
    const second = await a.createBookmark(bm(folderId, '示例二'));
    await a.onSyncComplete();
    expect(wire.some(r => r.method === 'PUT' && r.path === FILE + '.temp' && r.status === 201)).toBe(true);
    expect(wire.some(r => r.method === 'PROPFIND' && r.path === FILE + '.temp' && r.status === 207)).toBe(true);
    expect(wire.some(r => r.method === 'MOVE' && r.status === 204)).toBe(true);
    const b = await adapter('real Firefox adapter');
    await b.onSyncStart();
    const tree = await b.getBookmarksTree();
    expect(tree.children[0].title).toBe('顶部书签栏');
    expect(tree.children[0].children.map((n: any) => n.title)).toEqual(['中文示例一', '示例二']);
    await b.updateBookmark(new upstream.Bookmark({ id: first, parentId: folderId, title: '已修改', url: 'https://changed.example/', location: upstream.ItemLocation.SERVER }));
    await b.orderFolder(folderId, [{ type: 'bookmark', id: second }, { type: 'bookmark', id: first }]);
    await b.onSyncComplete();
    await a.onSyncStart();
    expect((await a.getBookmarksTree()).children[0].children.map((n: any) => n.title)).toEqual(['示例二', '已修改']);
    await a.removeBookmark(new upstream.Bookmark({ id: second, parentId: folderId, location: upstream.ItemLocation.SERVER, title: '示例二', url: 'https://example.com/' }));
    await a.onSyncComplete();
    const before = wire.filter(r => r.method === 'MOVE').length;
    await a.onSyncStart(); await a.getBookmarksTree(); await a.onSyncComplete();
    expect(wire.filter(r => r.method === 'MOVE')).toHaveLength(before);
    expect(await h.db.prepare('SELECT deleted FROM nodes WHERE user_id=? AND node_id=?').bind(account.userId, second).first('deleted')).toBe(1);
  } catch (e) { await a.onSyncFail(); throw e; }
});
test('官方适配器真实锁冲突与上传中断恢复', async () => {
  const a = await adapter('locking A'); const b = await adapter('locking B');
  try {
    await a.onSyncStart();
    await expect(b.onSyncStart()).rejects.toBeDefined();
    await a.onSyncFail();
    await b.onSyncStart();
    await b.createBookmark(bm(0, '网络恢复后添加'));
    const prev = globalThis.fetch;
    let failed = false;
    globalThis.fetch = async (url: any, init: any) => {
      if (!failed && init?.method === 'MOVE') { failed = true; throw new Error('simulated connection loss before commit'); }
      return prev(url, init);
    };
    try { await expect(b.onSyncComplete()).rejects.toBeDefined(); } finally { globalThis.fetch = prev; }
    await b.onSyncFail();
    await b.onSyncStart();
    const tree = await b.getBookmarksTree();
    expect(tree.children.some((n: any) => n.title === '网络恢复后添加')).toBe(false);
    await b.createBookmark(bm(0, '网络恢复后添加'));
    await b.onSyncComplete();
    const get = await h.request(FILE, 'GET', undefined, (await account.device()).basic);
    expect(await get.text()).toContain('网络恢复后添加');
    await b.onSyncStart();
    await b.createBookmark(bm(0, '提交成功但响应丢失'));
    let lost = false;
    globalThis.fetch = async (url: any, init: any) => {
      const response = await prev(url, init);
      if (!lost && init?.method === 'MOVE') { lost = true; throw new Error('simulated lost MOVE response after successful commit'); }
      return response;
    };
    try { await expect(b.onSyncComplete()).rejects.toBeDefined(); } finally { globalThis.fetch = prev; }
    await b.onSyncFail();
    await b.onSyncStart();
    expect((await b.getBookmarksTree()).children.filter((n: any) => n.title === '提交成功但响应丢失')).toHaveLength(1);
    await b.onSyncComplete();

  } finally { await a.onSyncFail(); await b.onSyncFail(); }
});
test('官方 Merge/Default 同步引擎：双客户端首次合并、离线并发编辑、移动与删除传播', async () => {
  // Independent user/file: never reset cached mappings to hide a sync failure.
  const engineAccount = await h.account('engine');
  const makeClient = async (name: string) => {
    const d = await engineAccount.device(name);
    const server = new upstream.WebDav({ ...upstream.WebDav.getDefaultValues(), url: 'https://sync.test/dav/', username: engineAccount.username, password: d.applicationPassword, failsafe: false });
    server.setHashSettings(settings);
    class LocalTree extends upstream.Caching {
      constructor() { super({}); this.location = upstream.ItemLocation.LOCAL; this.resetCache(); }
      getData() { return {}; }
    }
    const local = new LocalTree();
    const mappings = new upstream.Mappings({ setMappings: async () => {} }, {
      folders: { LocalToServer: {}, ServerToLocal: {} }, bookmarks: { LocalToServer: {}, ServerToLocal: {} },
    });
    return { server, local, mappings, cache: new upstream.Folder({ id: 0, title: 'root', location: upstream.ItemLocation.LOCAL }) };
  };
  const a = await makeClient('engine Chrome'); const b = await makeClient('engine Firefox');
  const run = async (c: any) => {
    try {
      await c.server.onSyncStart();
      const Strategy = c.cache.children.length ? upstream.DefaultSync : upstream.MergeSync;
      const process = new Strategy(c.mappings, c.local, c.server, async () => {});
      process.setCacheTree(c.cache.clone());
      await process.sync();
      await c.server.onSyncComplete();
      c.cache = (await c.local.getBookmarksTree()).clone();
    } catch (e) { await c.server.onSyncFail(); throw e; }
  };
  const folder = await a.local.createFolder(new upstream.Folder({ parentId: 0, title: '书签栏', location: upstream.ItemLocation.LOCAL }));
  await a.local.createBookmark(new upstream.Bookmark({ parentId: folder, title: '原始', url: 'https://shared.example/', location: upstream.ItemLocation.LOCAL }));
  await run(a); await run(b);
  expect((await b.local.getBookmarksTree()).children[0].children[0].title).toBe('原始');
  // Both clients edit the same baseline offline. Local/master wins per upstream strategy, not server timestamps.
  const aNode = (await a.local.getBookmarksTree()).children[0].children[0];
  const bNode = (await b.local.getBookmarksTree()).children[0].children[0];
  await a.local.updateBookmark(new upstream.Bookmark({ ...aNode, title: '设备A编辑' }));
  await b.local.updateBookmark(new upstream.Bookmark({ ...bNode, title: '设备B编辑' }));
  await run(a); await run(b); await run(a);
  expect((await a.local.getBookmarksTree()).children[0].children[0].title).toBe('设备B编辑');
  const bFolder = (await b.local.getBookmarksTree()).children[0];
  await b.local.updateFolder(new upstream.Folder({ ...bFolder, title: '已更名' }));
  await b.local.updateBookmark(new upstream.Bookmark({ ...bNode, title: '设备B编辑', parentId: 0 }));
  await run(b); await run(a);
  expect((await a.local.getBookmarksTree()).children.some((n: any) => n.type === 'bookmark' && n.title === '设备B编辑')).toBe(true);
  const toDelete = (await a.local.getBookmarksTree()).children.find((n: any) => n.type === 'bookmark');
  await a.local.removeBookmark(toDelete);
  await run(a); await run(b);
  expect((await b.local.getBookmarksTree()).children.some((n: any) => n.type === 'bookmark')).toBe(false);
  const remainingFolder = (await a.local.getBookmarksTree()).children.find((n: any) => n.type === 'folder');
  await a.local.removeFolder(remainingFolder);
  await run(a); await run(b);
  expect((await b.local.getBookmarksTree()).children).toHaveLength(0);
});
