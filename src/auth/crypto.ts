import { scryptSync } from 'node:crypto';
import { fail } from '../http';
const enc = new TextEncoder();
// OWASP-listed scrypt configuration; native Workers support confirmed in production.
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 5;
const PASSWORD_PREFIX = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}`;
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), n => n.toString(16).padStart(2, '0')).join('');
function unhex(s: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(s.match(/../g) ?? [], x => parseInt(x, 16)); }
export function randomToken(prefix = ''): string { return prefix + hex(crypto.getRandomValues(new Uint8Array(32))); }
export async function digest(text: string): Promise<string> { return hex(await crypto.subtle.digest('SHA-256', enc.encode(text))); }
export async function tokenHash(token: string, pepper: string): Promise<string> {
  if (!pepper || pepper.length < 32 || pepper.startsWith('replace-')) fail(503, 'secrets_not_configured');
  const key = await crypto.subtle.importKey('raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(token)));
}
function derive(password: string, salt: Uint8Array<ArrayBuffer>): string {
  return hex(scryptSync(password, salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 32 * 1024 * 1024 }));
}
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 14 || password.length > 256) fail(400, 'password_length_14_to_256');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${PASSWORD_PREFIX}$${hex(salt)}$${derive(password, salt)}`;
}
export async function constantEqual(a: string, b: string): Promise<boolean> {
  // Fixed length digests avoid comparing raw secrets or early string termination.
  const x = unhex(await digest(a)); const y = unhex(await digest(b));
  return crypto.subtle.timingSafeEqual(x, y);
}
export async function verifyPassword(password: string, record?: string): Promise<boolean> {
  const fallback = `${PASSWORD_PREFIX}$${'00'.repeat(16)}$${'00'.repeat(32)}`;
  // Whitelist costs before deriving so malformed stored records cannot select excessive work.
  const valid = typeof record === 'string' && /^scrypt\$16384\$8\$5\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(record);
  const [, , , , salt, expected] = (valid ? record : fallback).split('$');
  const actual = derive(password, unhex(salt));
  return (await constantEqual(actual, expected)) && valid;
}
