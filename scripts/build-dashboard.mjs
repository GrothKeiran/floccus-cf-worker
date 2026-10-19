import './cache-env.mjs';
import { build } from 'esbuild';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
// Schema and migrations are embedded in worker.mjs and applied by /init.
await rm(resolve(output, 'schema.sql'), { force: true });
const sums = [];
for (const name of ['worker.mjs', 'THIRD_PARTY_LICENSES.txt']) {
  const data = await readFile(resolve(output, name));
  sums.push(`${createHash('sha256').update(data).digest('hex')}  ${name}`);
}
await writeFile(resolve(output, 'SHA256SUMS'), sums.join('\n') + '\n');
console.log('Dashboard release files: .cache/dashboard/{worker.mjs,THIRD_PARTY_LICENSES.txt,SHA256SUMS}');
