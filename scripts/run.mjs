import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const cache = join(root, '.cache');
const env = { ...process.env, TMPDIR: join(cache, 'tmp'), TMP: join(cache, 'tmp'), TEMP: join(cache, 'tmp'),
  XDG_CACHE_HOME: join(cache, 'xdg'), XDG_CONFIG_HOME: join(cache, 'config'), XDG_DATA_HOME: join(cache, 'data'),
  WRANGLER_LOG_PATH: join(cache, 'wrangler', 'logs'), WRANGLER_SEND_METRICS: 'false',
  npm_config_cache: join(cache, 'npm'), VITEST_CACHE_DIR: join(cache, 'vitest') };
for (const key of ['TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'WRANGLER_LOG_PATH']) mkdirSync(env[key], { recursive: true });
const [bin, ...args] = process.argv.slice(2);
const bins = { wrangler: 'wrangler/bin/wrangler.js', vitest: 'vitest/vitest.mjs', tsc: 'typescript/bin/tsc' };
if (!bins[bin]) throw new Error('Unknown project tool');
const child = spawnSync(process.execPath, [join(root, 'node_modules', bins[bin]), ...args], { cwd: root, env, stdio: 'inherit' });
process.exit(child.status ?? 1);
