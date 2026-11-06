import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const isWindows = process.platform === 'win32';
const ffmpegExe = isWindows ? 'ffmpeg.exe' : 'ffmpeg';
const serverExe = isWindows ? 'omnicode.exe' : 'omnicode';
const unpacked = resolve(root, 'release', isWindows ? 'win-unpacked' : 'linux-unpacked');

if (!existsSync(unpacked)) {
  console.error(`Packaged app not found at ${unpacked}. Run electron-builder first.`);
  process.exit(1);
}

const server = resolve(unpacked, 'resources', 'server', serverExe);
if (!existsSync(server)) {
  console.error(`Bundled server binary missing at ${server}.`);
  process.exit(1);
}

const ffmpeg = resolve(unpacked, 'resources', 'ffmpeg', ffmpegExe);
if (!existsSync(ffmpeg)) {
  console.error(`Bundled ffmpeg missing at ${ffmpeg}.`);
  process.exit(1);
}

const duplicate = resolve(unpacked, 'resources', 'app.asar.unpacked', 'node_modules', 'ffmpeg-static');
if (existsSync(duplicate)) {
  const mb = Math.round(statSync(resolve(duplicate, ffmpegExe)).size / 1048576);
  console.error(`Duplicate ffmpeg shipped at ${duplicate} (${mb} MB).`);
  console.error('ffmpeg-static must stay a devDependency so it is not packed into app.asar.unpacked.');
  process.exit(1);
}