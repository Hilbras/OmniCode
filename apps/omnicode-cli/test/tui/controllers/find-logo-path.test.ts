import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findLogoPath } from '#/tui/controllers/connectors';

describe('findLogoPath', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'omnicode-logo-'));
  });

  afterEach(async () => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves the logo from the bundled layout (package dist → ../public)', () => {
    const dist = join(dir, 'pkg', 'dist');
    mkdirSync(dist, { recursive: true });
    mkdirSync(join(dir, 'pkg', 'public'), { recursive: true });
    writeFileSync(join(dir, 'pkg', 'public', 'icon.png'), '');
    const moduleUrl = pathToFileURL(join(dist, 'main.mjs')).href;
    expect(findLogoPath(moduleUrl)).toBe(join(dir, 'pkg', 'public', 'icon.png'));
  });

  it('resolves the logo from the dev layout (src/tui/controllers → ../../../public)', () => {
    const controllers = join(dir, 'app', 'src', 'tui', 'controllers');
    mkdirSync(controllers, { recursive: true });
    mkdirSync(join(dir, 'app', 'public'), { recursive: true });
    writeFileSync(join(dir, 'app', 'public', 'icon.png'), '');
    const moduleUrl = pathToFileURL(join(controllers, 'connectors.ts')).href;
    expect(findLogoPath(moduleUrl)).toBe(join(dir, 'app', 'public', 'icon.png'));
  });

  it('resolves the real asset from this checkout without depending on the cwd', () => {
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      // The default import.meta.url resolution — the dev candidate must find
      // the shipped copy under apps/omnicode-cli/public.
      expect(findLogoPath().endsWith('public/icon.png')).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('throws when no layout provides the logo', () => {
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      const moduleUrl = pathToFileURL(join(dir, 'nowhere', 'main.mjs')).href;
      expect(() => findLogoPath(moduleUrl)).toThrow('OmniCode logo not found');
    } finally {
      process.chdir(originalCwd);
    }
  });
});
