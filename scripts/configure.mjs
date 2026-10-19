import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (!existsSync('wrangler.toml')) copyFileSync('wrangler.example.toml', 'wrangler.toml');
const uuid = process.argv[2];
if (uuid) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid) || /^0{8}-/.test(uuid)) throw new Error('Supply the actual D1 database UUID');
  const file = readFileSync('wrangler.toml', 'utf8').replace(/database_id = "[^"]+"/, `database_id = "${uuid}"`);
  writeFileSync('wrangler.toml', file); console.log('Updated DB binding in wrangler.toml');
} else {
  const current = readFileSync('wrangler.toml', 'utf8');
  if (!current.includes('00000000-0000-0000-0000-000000000000')) throw new Error('Database already configured; refusing to create a duplicate.');
  const result = spawnSync(process.execPath, ['scripts/run.mjs', 'wrangler', 'd1', 'create', 'floccus-bookmarks'], { encoding: 'utf8' });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  if (result.status !== 0) process.exit(result.status ?? 1);
  const match = result.stdout.match(/(?:database_id["']?\s*[:=]\s*["'])([a-f\d-]{36})/i);
  if (!match) throw new Error('D1 may have been created but UUID could not be parsed. Use npm run configure -- ACTUAL_UUID shown above; do not create another database.');
  writeFileSync('wrangler.toml', current.replace('00000000-0000-0000-0000-000000000000', match[1]));
  console.log('Saved the newly created D1 UUID to wrangler.toml');
}
