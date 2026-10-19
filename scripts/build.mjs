import { build } from 'esbuild';
await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', target: 'es2022', platform: 'browser', external: ['node:*'], outfile: '.cache/build/worker.mjs', sourcemap: true });
