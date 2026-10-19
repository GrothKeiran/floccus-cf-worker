import type { Bindings } from './types';
export class HttpError extends Error {
  constructor(public status: number, public code: string, message = code) { super(message); }
}
export function fail(status: number, code: string, message?: string): never { throw new HttpError(status, code, message); }
export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, { status, headers });
}
export async function textBody(req: Request, limit: number): Promise<string> {
  if (Number(req.headers.get('Content-Length')) > limit) fail(413, 'body_too_large');
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); fail(413, 'body_too_large'); }
    chunks.push(value);
  }
  const all = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(all); } catch { return fail(400, 'invalid_utf8'); }
}
export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) fail(415, 'json_required');
  try {
    const value: unknown = JSON.parse(await textBody(req, 8192));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_json');
    return value as Record<string, unknown>;
  } catch (e) { if (e instanceof HttpError) throw e; return fail(400, 'invalid_json'); }
}
export function secureTransport(req: Request, env: Bindings): void {
  const u = new URL(req.url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && env.ALLOW_INSECURE_LOCALHOST === 'true')) fail(426, 'https_required');
}
export function numberConfig(value: string | undefined, fallback: number, max: number): number {
  const n = Number(value ?? fallback);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}
export function securityHeaders(response: Response, adminPage = false): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', adminPage
    ? "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    : "default-src 'none'; frame-ancestors 'none'");
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  return new Response(response.body, { status: response.status, headers });
}
