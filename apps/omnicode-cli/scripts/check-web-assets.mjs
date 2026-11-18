// Verify the prebuilt web bundle is present before packaging.
//
// The shipped web UI is built in the code-app repo (apps/web) and its bundle is
// synced into apps/omnicode-cli/dist-web and committed (746 files, ~37 MB). The
// in-tree apps/omnicode-web is a separate React surface. This script cannot
// regenerate the bundle; it only checks that the committed copy is in place, so
// a packaging run never silently ships a CLI without the web UI.

import { readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(appRoot, 'dist-web');

async function assertWebAssets() {
  try {
    const info = await stat(resolve(target, 'index.html'));
    if (!info.isFile()) {
      throw new Error('index.html is not a file');
    }
  } catch {
    throw new Error(
      `未找到已提交的 web 产物 ${target}/index.html。web 产物由 code-app 仓同步（见根 AGENTS.md），` +
        '请从该仓运行 `OMNICODE_REPO=<此 checkout> pnpm run sync:web` 并提交 dist-web。',
    );
  }
}

await assertWebAssets();
const files = await readdir(target, { recursive: true });
console.log(`Web assets OK: ${target} (${files.length} entries, synced from code-app)`);
