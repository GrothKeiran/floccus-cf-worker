import type { Env } from '../types';
import { fail, json, jsonBody } from '../http';
import { limit } from './service';
import { constantEqual } from './crypto';
import { accountInitialized, createInitialAccount, initialAccount, initializationStatus } from '../storage/initialize';

// Kept for clients of v0.2.0; new deployments simply visit /init.
export async function setupRoutes(req: Request, env: Env, path: string): Promise<Response | null> {
  if (path === '/api/setup/status' && req.method === 'GET') return json(await initializationStatus(env));
  if (path !== '/api/setup' || req.method !== 'POST') return null;
  await limit(env, `setup:${req.headers.get('CF-Connecting-IP') ?? 'local'}`, 5);
  if (await accountInitialized(env.DB)) fail(409, 'setup_already_completed');
  const configured = initialAccount(env);
  if (!configured) fail(503, 'bootstrap_not_configured');
  const body = await jsonBody(req);
  if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.username.length > 64 || body.password.length > 256) fail(400, 'invalid_credentials');
  const username = body.username.trim().toLowerCase();
  const nameMatches = await constantEqual(username, configured.username);
  const passwordMatches = await constantEqual(body.password, configured.password);
  if (!nameMatches || !passwordMatches) fail(401, 'unauthorized');
  if (!await createInitialAccount(env, username, body.password)) fail(409, 'setup_already_completed');
  return json({ initialized: true, username }, 201);
}
