import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { currentOmnicodeRegion, refreshOmnicodeRegion, regionForBareLogin } from '#/utils/region';

const originalEnv = { ...process.env };

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'omnicode-region-test-'));
  process.env['OMNICODE_HOME'] = home;
  delete process.env['OMNICODE_OAUTH_HOST'];
  delete process.env['OMNICODE_OAUTH_HOST'];
  delete process.env['OMNICODE_REGION_MARKER'];
  refreshOmnicodeRegion();
});

afterEach(() => {
  process.env = { ...originalEnv };
  refreshOmnicodeRegion();
  rmSync(home, { recursive: true, force: true });
});

describe('currentOmnicodeRegion', () => {
  it('follows the install-channel marker before the first login', () => {
    writeFileSync(join(home, 'region'), 'global\n');
    expect(refreshOmnicodeRegion()).toBe('global');
    expect(currentOmnicodeRegion()).toBe('global');
  });

  it('ignores the marker when OMNICODE_REGION_MARKER=off (embedded server)', () => {
    writeFileSync(join(home, 'region'), 'global\n');
    process.env['OMNICODE_REGION_MARKER'] = 'off';
    expect(refreshOmnicodeRegion()).toBe('mainland-cn');
  });

  it('still honors a persisted global login when the marker is opted out', () => {
    writeFileSync(join(home, 'region'), 'global\n');
    writeFileSync(
      join(home, 'config.toml'),
      [
        '[providers."managed:omnicode"]',
        'type = "omnicode"',
        '',
        '[providers."managed:omnicode".oauth]',
        'storage = "file"',
        'key = "oauth/omnicode-env-0123456789abcdef"',
        'oauthHost = "https://auth.omnicode.ai"',
        '',
      ].join('\n'),
    );
    process.env['OMNICODE_REGION_MARKER'] = 'off';
    expect(refreshOmnicodeRegion()).toBe('global');
  });
});

describe('regionForBareLogin', () => {
  it('follows the resolved region for a fresh install (no persisted ref)', () => {
    expect(regionForBareLogin(undefined)).toBe('mainland-cn');
    writeFileSync(join(home, 'region'), 'global\n');
    refreshOmnicodeRegion();
    expect(regionForBareLogin(undefined)).toBe('global');
  });

  it('re-pins mainland-cn for the default slot', () => {
    expect(regionForBareLogin({ key: 'oauth/omnicode' })).toBe('mainland-cn');
  });

  it('keeps the configured environment for a scoped slot without a persisted host', () => {
    expect(regionForBareLogin({ key: 'oauth/omnicode-env-0123456789abcdef' })).toBeUndefined();
  });

  it('keeps the persisted environment for a global login', () => {
    expect(
      regionForBareLogin({
        key: 'oauth/omnicode-env-0123456789abcdef',
        oauthHost: 'https://auth.omnicode.ai',
      }),
    ).toBeUndefined();
  });
});
