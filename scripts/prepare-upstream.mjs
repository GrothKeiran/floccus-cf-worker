import './cache-env.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
const sha = 'c8ec55ee5e731206c6f2b34c48e8b4def47d0d5a';
const root = resolve('.cache/upstream/floccus');
function git(args) { const p = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }); if (p.status) throw new Error(p.stderr); return p.stdout.trim(); }
if (!existsSync(join(root, '.git'))) {
  mkdirSync(root, { recursive: true }); git(['init']); git(['remote', 'add', 'origin', 'https://github.com/floccusaddon/floccus.git']);
  git(['fetch', '--depth', '1', 'origin', sha]); git(['checkout', '--detach', 'FETCH_HEAD']);
}
if (git(['rev-parse', 'HEAD']) !== sha || git(['status', '--porcelain', '--untracked-files=no'])) throw new Error('Upstream checkout differs from pinned unmodified source; inspect .cache/upstream/floccus');
const version = JSON.parse(readFileSync(join(root, 'package.json'))).version;
const entry = `export {default as WebDav} from './floccus/src/lib/adapters/WebDav';
export {default as Caching} from './floccus/src/lib/adapters/Caching';
export {default as DefaultSync} from './floccus/src/lib/strategies/Default';
export {default as MergeSync} from './floccus/src/lib/strategies/Merge';
export {default as Mappings} from './floccus/src/lib/Mappings';
export * from './floccus/src/lib/Tree';`;
writeFileSync('.cache/upstream/entry.ts', entry);
const stubs = {
  logger: 'export default class Logger { static log() {} }',
  browser: "export default { permissions: {contains: async()=>true}, storage: {local: {get: async()=>({isOrion:false})}} }",
  capacitor: "export const CapacitorHttp={request:async()=>{throw new Error('Native HTTP is not part of browser-mode tests')}};",
  html: "export default {serialize(){throw new Error('HTML not supported in XBEL tests')},deserialize(){throw new Error('HTML not supported in XBEL tests')}};",
  nextcloud: 'export default class NextcloudBookmarksAdapter {}',
};
await build({ entryPoints: ['.cache/upstream/entry.ts'], bundle: true, format: 'esm', platform: 'node', target: 'node22',
  outfile: '.cache/upstream/floccus-test.mjs', define: { IS_BROWSER: 'true', DEBUG: 'false' },
  plugins: [{ name: 'browser-host-only-shims', setup(b) {
    b.onResolve({ filter: /Logger$|browser-api$|@capacitor\/core$|serializers\/Html$|adapters\/NextcloudBookmarks$/ }, args => {
      let key;
      if (args.path.endsWith('Logger')) key = 'logger';
      else if (args.path.endsWith('browser-api')) key = 'browser';
      else if (args.path === '@capacitor/core') key = 'capacitor';
      else if (args.path.endsWith('serializers/Html')) key = 'html';
      else if (args.path.endsWith('adapters/NextcloudBookmarks')) key = 'nextcloud';
      return { path: key, namespace: 'host-shim' };
    });
    b.onLoad({ filter: /.*/, namespace: 'host-shim' }, args => ({ contents: stubs[args.path], loader: 'js' }));
  } }],
});
writeFileSync('.cache/upstream/verified.json', JSON.stringify({ version, commit: sha, unmodified: true }, null, 2));
console.log(`Prepared unmodified Floccus ${version} @ ${sha}; adapter/serializer/tree/diff/merge code is real upstream code.`);
