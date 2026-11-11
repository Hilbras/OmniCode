#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create as createFont } from 'fontkit';
import subsetFont from 'subset-font';
import { compress } from 'woff2-encoder';

const FONT_DIR = fileURLToPath(new URL('../packages/app-ui/src/assets/fonts/', import.meta.url));
const FONT_SOURCES = [
  {
    name: 'Noto Sans SC Variable',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
    sourceSha256: 'a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da',
    output: 'NotoSansSC[wght].woff2',
    outputSha256: '43c2f58299a21aaa962886e536c9e69f3c284f6cb6be39c57ce54a89d05205aa',
  },
  {
    name: 'Schibsted Grotesk Variable',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/schibstedgrotesk/SchibstedGrotesk%5Bwght%5D.ttf',
    sourceSha256: '6ceeadf6be8e1fd7687011c7fa38ed0edd1abe967a0b73d97caec183552e823d',
    output: 'SchibstedGrotesk[wght].woff2',
    outputSha256: '2b3e47ab920343dfac1030548c09056f857bde58054202a2e64faef75dbb506a',
  },
  {
    name: 'Schibsted Grotesk Variable Italic',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/schibstedgrotesk/SchibstedGrotesk-Italic%5Bwght%5D.ttf',
    sourceSha256: 'b49fedb6f3a2ff9b43e13351888641505dc8e5f300941e597eecbc3f52ba357b',
    output: 'SchibstedGrotesk-Italic[wght].woff2',
    outputSha256: 'da16fdbb94a068ef75d1a27b5b136234bf0930e51ec24e8bf05ac1964e968d6c',
  },
];
const LOCK_DIR = fileURLToPath(
  new URL('../packages/app-ui/src/assets/fonts/.font-preparation.lock', import.meta.url),
);
const LOCK_STALE_MS = 10 * 60 * 1000;
const LOCK_WAIT_MS = 2 * 60 * 1000;

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function fontPath(font) {
  return fileURLToPath(new URL(`../packages/app-ui/src/assets/fonts/${font.output}`, import.meta.url));
}

async function hasPreparedFont(font) {
  try {
    return sha256(await readFile(fontPath(font))) === font.outputSha256;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function hasPreparedFonts() {
  return (await Promise.all(FONT_SOURCES.map(hasPreparedFont))).every(Boolean);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock() {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      await mkdir(LOCK_DIR);
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }

    if (await hasPreparedFonts()) return false;

    try {
      const lock = await stat(LOCK_DIR);
      if (Date.now() - lock.mtimeMs > LOCK_STALE_MS) {
        await rm(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      continue;
    }

    await sleep(250);
  }
  throw new Error(`Timed out waiting for the font preparation lock: ${LOCK_DIR}`);
}

async function downloadSource(font) {
  // The sources ride raw.githubusercontent.com, which rate-limits (429) and
  // blips (5xx) under shared CI egress — retry with backoff before failing
  // the whole install. The window must outlast a raw-CDN rate-limit reset:
  // ~3 minutes of retries total.
  const delays = [2000, 5000, 15000, 30000, 60000, 60000];
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(font.url);
    } catch (error) {
      if (attempt >= delays.length) {
        throw new Error(`Could not download ${font.name} from ${font.url}`, { cause: error });
      }
    }
    if (response !== undefined && response.ok) {
      const source = new Uint8Array(await response.arrayBuffer());
      const actual = sha256(source);
      if (actual !== font.sourceSha256) {
        throw new Error(`${font.name} source checksum mismatch: expected ${font.sourceSha256}, got ${actual}`);
      }
      return source;
    }
    if (response !== undefined && response.status !== 429 && response.status < 500) {
      throw new Error(`Could not download ${font.name}: HTTP ${response.status} ${response.statusText}`);
    }
    if (attempt >= delays.length) {
      throw new Error(
        `Could not download ${font.name}: HTTP ${response?.status} ${response?.statusText}`,
      );
    }
    await sleep(delays[attempt]);
  }
}

const sourceCache = new Map();

async function loadFontSource(font) {
  const cached = sourceCache.get(font.name);
  if (cached !== undefined) return cached;
  process.stdout.write(`[fonts] Downloading ${font.name}...`);
  const source = await downloadSource(font);
  sourceCache.set(font.name, source);
  return source;
}

async function prepareFont(font) {
  if (await hasPreparedFont(font)) return;

  const outputPath = fontPath(font);
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    const source = await loadFontSource(font);
    process.stdout.write(`[fonts] Converting ${font.name} to WOFF2…\n`);
    const output = await compress(source);
    const actual = sha256(output);
    if (actual !== font.outputSha256) {
      throw new Error(`${font.name} output checksum mismatch: expected ${font.outputSha256}, got ${actual}`);
    }
    await writeFile(temporaryPath, output);
    await rename(temporaryPath, outputPath);
    process.stdout.write(`[fonts] Prepared ${outputPath}\n`);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

const CJK_SOURCE = FONT_SOURCES[0];
const CJK_SLICE_DIR = fileURLToPath(
  new URL('../packages/app-ui/src/assets/fonts/noto-sc/', import.meta.url),
);
const CJK_SLICE_CSS = fileURLToPath(
  new URL('../packages/app-ui/src/assets/fonts/noto-sc.css', import.meta.url),
);
const CJK_SLICE_MANIFEST = join(CJK_SLICE_DIR, 'manifest.json');
const CJK_SLICE_VERSION = 1;
const CJK_SLICE_MAX_CODEPOINTS = 250;

function toUnicodeRange(codepoints) {
  const ranges = [];
  let start = codepoints[0];
  let end = codepoints[0];
  for (let index = 1; index < codepoints.length; index++) {
    const cp = codepoints[index];
    if (cp === end + 1) {
      end = cp;
      continue;
    }
    ranges.push(formatRange(start, end));
    start = cp;
    end = cp;
  }
  if (start !== undefined) ranges.push(formatRange(start, end));
  return ranges.join(', ');
}

function formatRange(start, end) {
  const from = `U+${start.toString(16).toUpperCase()}`;
  return start === end ? from : `${from}-${end.toString(16).toUpperCase()}`;
}

async function cjkSlicesAreCurrent() {
  try {
    const manifest = JSON.parse(await readFile(CJK_SLICE_MANIFEST, 'utf8'));
    return (
      manifest.version === CJK_SLICE_VERSION &&
      manifest.sourceSha256 === CJK_SOURCE.sourceSha256 &&
      manifest.maxCodepoints === CJK_SLICE_MAX_CODEPOINTS
    );
  } catch {
    return false;
  }
}

async function prepareCjkSlices() {
  if (await cjkSlicesAreCurrent()) return;

  const source = Buffer.from(await loadFontSource(CJK_SOURCE));
  const codepoints = [...createFont(source).characterSet].sort((a, b) => a - b);
  const chunks = [];
  for (const codepoint of codepoints) {
    const current = chunks[chunks.length - 1];
    if (current === undefined || current.length >= CJK_SLICE_MAX_CODEPOINTS) chunks.push([codepoint]);
    else current.push(codepoint);
  }

  process.stdout.write(`[fonts] Slicing ${CJK_SOURCE.name} into ${chunks.length} ranges...\n`);
  await rm(CJK_SLICE_DIR, { recursive: true, force: true });
  await mkdir(CJK_SLICE_DIR, { recursive: true });

  const faces = [];
  for (let index = 0; index < chunks.length; index++) {
    const slice = chunks[index];
    const file = `NotoSansSC-${String(index).padStart(3, '0')}.woff2`;
    const subset = await subsetFont(source, String.fromCodePoint(...slice), {
      targetFormat: 'woff2',
    });
    await writeFile(join(CJK_SLICE_DIR, file), subset);
    faces.push(
      [
        '@font-face {',
        `  font-family: "${CJK_SOURCE.name}";`,
        '  font-style: normal;',
        '  font-display: swap;',
        '  font-weight: 100 900;',
        `  src: url("./noto-sc/${file}") format("woff2-variations");`,
        `  unicode-range: ${toUnicodeRange(slice)};`,
        '}',
        '',
      ].join('\n'),
    );
  }

  await writeFile(CJK_SLICE_CSS, `/* Generated by scripts/prepare-fonts.mjs. */\n${faces.join('\n')}`);
  await writeFile(
    CJK_SLICE_MANIFEST,
    `${JSON.stringify(
      {
        version: CJK_SLICE_VERSION,
        sourceSha256: CJK_SOURCE.sourceSha256,
        maxCodepoints: CJK_SLICE_MAX_CODEPOINTS,
        slices: faces.length,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`[fonts] Wrote ${faces.length} CJK slices\n`);
}
async function prepare() {
  await mkdir(FONT_DIR, { recursive: true });
  if (!(await hasPreparedFonts())) {
    const ownsLock = await acquireLock();
    if (!ownsLock) return;

    try {
      for (const font of FONT_SOURCES) await prepareFont(font);
    } finally {
      await rm(LOCK_DIR, { recursive: true, force: true });
    }
  }
  await prepareCjkSlices();
}

await prepare();
