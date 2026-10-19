import './cache-env.mjs';
import { build } from 'esbuild';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '.cache/dashboard');
await mkdir(output, { recursive: true });
const built = await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  external: ['node:*'],
  outfile: resolve(output, 'worker.mjs'),
  sourcemap: false,
  metafile: true,
  legalComments: 'eof',
});
// Include complete notices in the pasteable file, not just in the source repo.
const packages = new Set(Object.keys(built.metafile.inputs).flatMap(path => {
  const match = path.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/);
  return match ? [match[1]] : [];
}));
const projectLicense = await readFile(resolve(root, 'LICENSE'), 'utf8');
const licenses = ['Project license\n' + projectLicense];
for (const name of [...packages].sort()) {
  const folder = resolve(root, 'node_modules', name);
  const pkg = JSON.parse(await readFile(resolve(folder, 'package.json'), 'utf8'));
  let text;
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'license.txt']) {
    try { text = await readFile(resolve(folder, file), 'utf8'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!text && name === '@nodable/entities' && pkg.version === '3.1.0') {
    text = await readFile(resolve(root, 'licenses/nodable-entities-MIT.txt'), 'utf8');
  }
  if (!text) throw new Error('Missing distribution license for ' + name);
  licenses.push(`${name}@${pkg.version}\n${text}`);
}
const notices = licenses.join('\n\n----------------------------------------\n\n');
await writeFile(resolve(output, 'THIRD_PARTY_LICENSES.txt'), notices);
await appendFile(resolve(output, 'worker.mjs'), '\n/*!\n' + notices.replaceAll('*/', '* /') + '\n*/\n');
// A dashboard SQL import also records the initial migration, so a later move
// to Wrangler does not try to create the same tables a second time.
const initial = await readFile(resolve(root, 'migrations/0001_initial.sql'), 'utf8');
const tracking = `
-- Wrangler migration metadata: only run after ALL statements above succeed.
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO d1_migrations (name) VALUES ('0001_initial.sql');
`;
await writeFile(resolve(output, 'schema.sql'), projectLicense.split('\n').map(line => '-- ' + line).join('\n') + '\n-- For a NEW, EMPTY D1 database only. Do not re-run on an existing database.\n' + initial + tracking);
const sums = [];
for (const name of ['worker.mjs', 'schema.sql', 'THIRD_PARTY_LICENSES.txt']) {
  const data = await readFile(resolve(output, name));
  sums.push(`${createHash('sha256').update(data).digest('hex')}  ${name}`);
}
await writeFile(resolve(output, 'SHA256SUMS'), sums.join('\n') + '\n');
console.log('Dashboard release files: .cache/dashboard/{worker.mjs,schema.sql,THIRD_PARTY_LICENSES.txt,SHA256SUMS}');
