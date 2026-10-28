// npm entry (`dist/main.mjs`). Turns on Node's on-disk compile cache before
// loading the CLI bundle (`dist/cli.mjs`), so repeat starts skip re-compiling
// it. The cache is keyed by file content, so upgrades never reuse stale code;
// `NODE_DISABLE_COMPILE_CACHE=1` opts out and `NODE_COMPILE_CACHE` moves it.
import { enableCompileCache } from 'node:module';

enableCompileCache();

await import(new URL('./cli.mjs', import.meta.url).href);
