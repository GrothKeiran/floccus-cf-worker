import type { Env, Principal, Lease } from '../types';
import { fail, numberConfig, textBody } from '../http';
import { authenticate, limit } from '../auth/service';
import { parseXbel } from '../domain/xbel';
import { acquire, commit, lease, release, stage, state } from '../storage/sync';
const FILE = '/dav/bookmarks.xbel';
const LOCK = FILE + '.lock'; const TEMP = FILE + '.temp';
const METHODS = 'OPTIONS, GET, HEAD, PROPFIND, PUT, MOVE, DELETE';
const escapeXml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function properties(path: string, size: number, etag: string, modified: number, collection = false): string {
  return `<d:response><d:href>${escapeXml(path)}</d:href><d:propstat><d:prop><d:resourcetype>${collection ? '<d:collection/>' : ''}</d:resourcetype><d:getcontentlength>${size}</d:getcontentlength><d:getetag>${escapeXml(etag)}</d:getetag><d:getlastmodified>${new Date(modified).toUTCString()}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
}
function preconditions(req: Request, etag: string | null): void {
  const match = req.headers.get('If-Match'); const none = req.headers.get('If-None-Match');
  if (match && (match === '*' ? !etag : match !== etag)) fail(412, 'etag_mismatch');
  if (none && (none === '*' ? !!etag : none === etag)) fail(412, 'etag_mismatch');
}
async function content(env: Env, p: Principal, path: string): Promise<{ body: string; etag: string; time: number }> {
  if (path === LOCK) {
    const l = await env.DB.prepare('SELECT * FROM sync_locks WHERE user_id=? AND expires_at>?').bind(p.userId, Date.now()).first<Lease>();
    if (!l) fail(404, 'not_found');
    return { body: '<html><body>I am a lock file</body></html>', etag: `"${l.generation}"`, time: l.updated_at };
  }
  if (path === TEMP) {
    const l = await lease(env, p);
    const s = await env.DB.prepare('SELECT body,etag,updated_at FROM staging WHERE user_id=? AND credential_id=? AND generation=?')
      .bind(p.userId, p.credentialId, l.generation).first<{ body: string; etag: string; updated_at: number }>();
    if (!s) fail(404, 'not_found');
    return { body: s.body, etag: s.etag, time: s.updated_at };
  }
  const s = await state(env, p);
  if (s.body === null || !s.etag) fail(404, 'not_found');
  return { body: s.body, etag: s.etag, time: s.updated_at };
}
export async function webdav(req: Request, env: Env, path: string): Promise<Response> {
  if (![FILE, LOCK, TEMP, '/dav/'].includes(path)) fail(404, 'not_found');
  const p = await authenticate(req, env, 'device');
  await limit(env, `dav:${p.userId}`, 1200);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { Allow: METHODS, DAV: '1' } });
  if (path === '/dav/') {
    if (req.method === 'PROPFIND') {
      const depth = req.headers.get('Depth') ?? '0';
      if (!['0', '1'].includes(depth)) fail(403, 'finite_depth_required');
      const s = await state(env, p);
      const prop = properties('/dav/', 0, '', s.updated_at, true) + (depth === '1' && s.body !== null ? properties(FILE, new TextEncoder().encode(s.body).length, s.etag!, s.updated_at) : '');
      return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${prop}</d:multistatus>`, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8', DAV: '1' } });
    }
    return new Response(null, { status: 405, headers: { Allow: 'OPTIONS, PROPFIND' } });
  }
  if (['GET', 'HEAD', 'PROPFIND'].includes(req.method)) {
    const c = await content(env, p, path); const bytes = new TextEncoder().encode(c.body).length;
    if (req.method === 'PROPFIND') {
      if (!['0', null].includes(req.headers.get('Depth'))) fail(403, 'finite_depth_required');
      return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${properties(path, bytes, c.etag, c.time)}</d:multistatus>`, { status: 207, headers: { 'Content-Type': 'application/xml; charset=utf-8', DAV: '1' } });
    }
    if (req.headers.get('If-None-Match') === c.etag) return new Response(null, { status: 304, headers: { ETag: c.etag } });
    return new Response(req.method === 'HEAD' ? null : c.body, { headers: { 'Content-Type': path === LOCK ? 'text/html; charset=utf-8' : 'application/xml; charset=utf-8', 'Content-Length': String(bytes), ETag: c.etag, 'Last-Modified': new Date(c.time).toUTCString() } });
  }
  if (req.method === 'PUT') {
    if (path === LOCK) {
      await textBody(req, 1024); await acquire(env, p);
      return new Response(null, { status: 201 });
    }
    const l = await lease(env, p);
    const body = await textBody(req, numberConfig(env.MAX_BODY_BYTES, 524288, 1_000_000));
    const snapshot = parseXbel(body, numberConfig(env.MAX_NODES, 5000, 10000));
    if (path === TEMP) await stage(env, p, body);
    else { preconditions(req, (await state(env, p)).etag); await commit(env, p, l, body, snapshot); }
    return new Response(null, { status: 201 });
  }
  if (req.method === 'MOVE') {
    if (path !== TEMP) fail(405, 'only_temp_can_move');
    let destination: URL;
    try { destination = new URL(req.headers.get('Destination') ?? ''); } catch { return fail(400, 'invalid_destination'); }
    if (destination.origin !== new URL(req.url).origin || destination.pathname !== FILE || destination.search || destination.hash || destination.username || destination.password) fail(403, 'invalid_destination');
    const l = await lease(env, p);
    const c = await content(env, p, TEMP);
    const s = await state(env, p);
    preconditions(req, s.etag);
    if (req.headers.get('Overwrite') === 'F' && s.body !== null) fail(412, 'destination_exists');
    const staged = await env.DB.prepare('SELECT base_version FROM staging WHERE user_id=? AND generation=?').bind(p.userId, l.generation).first<{ base_version: number }>();
    if (staged?.base_version !== s.version && s.etag !== c.etag) fail(412, 'stale_stage_retry');
    await commit(env, p, l, c.body, parseXbel(c.body, numberConfig(env.MAX_NODES, 5000, 10000)));
    return new Response(null, { status: 204 });
  }
  if (req.method === 'DELETE') {
    if (path === LOCK) await release(env, p);
    else if (path === TEMP) {
      const l = await lease(env, p);
      await env.DB.prepare('DELETE FROM staging WHERE user_id=? AND credential_id=? AND generation=?').bind(p.userId, p.credentialId, l.generation).run();
    } else fail(405, 'replace_snapshot_or_delete_account');
    return new Response(null, { status: 204 });
  }
  return new Response(null, { status: 405, headers: { Allow: METHODS } });
}
