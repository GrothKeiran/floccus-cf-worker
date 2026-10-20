import { adminRoutes } from './admin/page';
import { initPage } from './admin/init';
import { setupRoutes } from './auth/bootstrap';
import type { Bindings } from './types';
import { authRoutes, limit } from './auth/service';
import { HttpError, fail, json, secureTransport, securityHeaders } from './http';
import { webdav } from './protocol/webdav';
import { initializationStatus, initializeDatabase } from './storage/initialize';
import { runtimeEnv } from './storage/runtime';
import { cleanup, scheduleMaintenance } from './storage/maintenance';
export default {
  async fetch(req: Request, bindings: Bindings, ctx: ExecutionContext): Promise<Response> {
    let path = '';
    try {
      path = new URL(req.url).pathname;
      secureTransport(req, bindings);
      if ((path.startsWith('/api/') || path === '/init') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.headers.get('Origin');
        if (origin && origin !== new URL(req.url).origin) fail(403, 'origin_not_allowed');
      }
      if (path === '/init' && ['GET', 'POST'].includes(req.method)) {
        const result = await initializeDatabase(bindings, req.headers.get('CF-Connecting-IP') ?? 'local');
        return securityHeaders(req.headers.get('Accept')?.includes('application/json') ? json(result) : initPage(), true);
      }
      if (path === '/' && req.method === 'GET') return securityHeaders(new Response(null, { status: 302, headers: { Location: '/admin' } }));
      const page = adminRoutes(req, path);
      if (page) return securityHeaders(page, true);
      if (path === '/health' && req.method === 'GET') return securityHeaders(json({ status: 'ok', service: 'floccus-cf-worker', protocol: 'webdav-xbel', version: '0.5.2' }));
      if (path === '/api/setup/status' && req.method === 'GET') return securityHeaders(json(await initializationStatus(bindings)));
      const env = await runtimeEnv(bindings);
      if (path === '/health/ready' && req.method === 'GET') {
        if (!(await initializationStatus(bindings)).databaseInitialized) fail(503, 'database_not_initialized');
        await env.DB.prepare('SELECT version FROM sync_state LIMIT 1').first();
        return securityHeaders(json({ status: 'ready' }));
      }
      if (!path.startsWith('/api/') && !path.startsWith('/dav/')) fail(404, 'not_found');
      scheduleMaintenance(env.DB, ctx);
      await limit(env, `ip:${req.headers.get('CF-Connecting-IP') ?? 'local'}`, 1800);
      const response = path.startsWith('/dav/') ? await webdav(req, env, path)
        : await setupRoutes(req, env, path) ?? await authRoutes(req, env, path) ?? fail(404, 'not_found');
      return securityHeaders(response);
    } catch (e) {
      const error = e instanceof HttpError ? e : new HttpError(500, 'internal_error');
      if (error.status === 500) console.error(JSON.stringify({ event: 'request_failed', requestId: req.headers.get('CF-Ray') ?? crypto.randomUUID() }));
      if (path === '/init' && !req.headers.get('Accept')?.includes('application/json')) return securityHeaders(initPage(error.code, error.status), true);
      const headers: Record<string, string> = {};
      if (error.status === 401 && path.startsWith('/dav/')) headers['WWW-Authenticate'] = 'Basic realm="Floccus", charset="UTF-8"';
      if (error.status === 429) headers['Retry-After'] = '60';
      return securityHeaders(json({ error: error.code }, error.status, headers));
    }
  },
  async scheduled(_controller: ScheduledController, bindings: Bindings): Promise<void> { await cleanup(bindings.DB); },
} satisfies ExportedHandler<Bindings>;
