import { adminRoutes } from './admin/page';
import { setupRoutes } from './auth/bootstrap';
import type { Env } from './types';
import { authRoutes, limit } from './auth/service';
import { HttpError, fail, json, secureTransport, securityHeaders } from './http';
import { webdav } from './protocol/webdav';
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let path = '';
    try {
      path = new URL(req.url).pathname;
      secureTransport(req, env);
      if (path === '/' && req.method === 'GET') return securityHeaders(new Response(null, { status: 302, headers: { Location: '/admin' } }));
      const page = adminRoutes(req, path);
      if (page) return securityHeaders(page, true);
      if (path === '/health' && req.method === 'GET') return securityHeaders(json({ status: 'ok', service: 'floccus-cf-worker', protocol: 'webdav-xbel', version: '0.2.0' }));
      if (path === '/health/ready' && req.method === 'GET') {
        if (!env.TOKEN_PEPPER || env.TOKEN_PEPPER.length < 32 || !env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32 || env.TOKEN_PEPPER.startsWith('replace-') || env.ADMIN_TOKEN.startsWith('replace-')) fail(503, 'secrets_not_configured');
        await env.DB.prepare('SELECT version FROM sync_state LIMIT 1').first();
        await env.DB.prepare('SELECT id FROM bootstrap_state LIMIT 1').first();
        return securityHeaders(json({ status: 'ready' }));
      }
      if (!path.startsWith('/api/') && !path.startsWith('/dav/')) fail(404, 'not_found');
      if (path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.headers.get('Origin');
        if (origin && origin !== new URL(req.url).origin) fail(403, 'origin_not_allowed');
      }
      const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
      await limit(env, `ip:${ip}`, 1800);
      let response: Response;
      if (path.startsWith('/dav/')) response = await webdav(req, env, path);
      else response = await setupRoutes(req, env, path) ?? await authRoutes(req, env, path) ?? fail(404, 'not_found');
      return securityHeaders(response);
    } catch (e) {
      const error = e instanceof HttpError ? e : new HttpError(500, 'internal_error');
      // No Authorization, URL query strings, bodies, password hashes or stack traces in logs.
      if (error.status === 500) console.error(JSON.stringify({ event: 'request_failed', requestId: req.headers.get('CF-Ray') ?? crypto.randomUUID() }));
      const headers: Record<string, string> = {};
      if (error.status === 401 && path.startsWith('/dav/')) headers['WWW-Authenticate'] = 'Basic realm="Floccus", charset="UTF-8"';
      if (error.status === 429) headers['Retry-After'] = '60';
      return securityHeaders(json({ error: error.code }, error.status, headers));
    }
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM credentials WHERE expires_at IS NOT NULL AND expires_at<?').bind(now),
      env.DB.prepare('DELETE FROM sync_locks WHERE expires_at<?').bind(now),
      env.DB.prepare('DELETE FROM staging WHERE updated_at<?').bind(now - 86_400_000),
      env.DB.prepare('DELETE FROM rate_limits WHERE bucket<?').bind(now - 86_400_000),
      env.DB.prepare('DELETE FROM audit_logs WHERE created_at<?').bind(now - 30 * 86_400_000),
    ]);
  },
} satisfies ExportedHandler<Env>;
