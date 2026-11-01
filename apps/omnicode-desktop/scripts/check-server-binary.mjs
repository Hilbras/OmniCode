import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const target = `${process.platform}-${process.arch}`;
const exe = process.platform === 'win32' ? 'omnicode.exe' : 'omnicode';
const binary = resolve(import.meta.dirname, '..', '..', 'omnicode', 'dist-native', 'bin', target, exe);

if (!existsSync(binary)) {
  console.error(`Omnicode server binary not found at ${binary}.`);
  console.error('Run `pnpm -C apps/omnicode-desktop run build:server` on this platform first.');
  process.exit(1);
}
