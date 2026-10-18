import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureOmnicodeHome, resolveConfigPath, resolveOmnicodeHome } from '#/app/bootstrap/bootstrap';

describe('bootstrap path helpers', () => {
  describe('resolveOmnicodeHome', () => {
    it('uses explicit homeDir when provided', () => {
      expect(resolveOmnicodeHome('/tmp/omnicode')).toBe('/tmp/omnicode');
    });

    it('falls back to OMNICODE_HOME env', () => {
      const prev = process.env['OMNICODE_HOME'];
      process.env['OMNICODE_HOME'] = '/env/omnicode';
      try {
        expect(resolveOmnicodeHome()).toBe('/env/omnicode');
      } finally {
        if (prev === undefined) delete process.env['OMNICODE_HOME'];
        else process.env['OMNICODE_HOME'] = prev;
      }
    });
  });

  describe('resolveConfigPath', () => {
    it('uses explicit configPath when provided', () => {
      expect(resolveConfigPath({ configPath: '/x/config.toml' })).toBe('/x/config.toml');
    });

    it('joins homeDir with config.toml', () => {
      expect(resolveConfigPath({ homeDir: '/tmp/omnicode' })).toBe('/tmp/omnicode/config.toml');
    });
  });

  describe('ensureOmnicodeHome', () => {
    let dir: string | undefined;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('creates the directory with 0700 permissions', () => {
      dir = join(mkdtempSync(join(tmpdir(), 'omnicode-home-')), 'nested');
      ensureOmnicodeHome(dir);
      expect(existsSync(dir)).toBe(true);
    });
  });
});
