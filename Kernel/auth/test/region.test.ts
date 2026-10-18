import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_OMNICODE_OAUTH_HOST } from '#/constants';
import { OMNICODE_OAUTH_KEY } from '#/managed-omnicode';
import { DEFAULT_OMNICODE_BASE_URL } from '#/managed-usage';
import {
  OMNICODE_REGION_MARKER_FILENAME,
  OMNICODE_REGION_PROFILES,
  omnicodeRegionLoginHosts,
  omnicodeRegionProfile,
  omnicodeRegionSchema,
  resolveOmnicodeRegion,
  resolveOmnicodeRemoteControlAuth,
} from '#/region';

import { createTempWorkDir, type TempDirHandle } from './helpers';

describe('OMNICODE_REGION_PROFILES', () => {
  it('keeps the mainland-cn profile aligned with the shared defaults', () => {
    expect(OMNICODE_REGION_PROFILES['mainland-cn'].oauthHost).toBe(DEFAULT_OMNICODE_OAUTH_HOST);
    expect(OMNICODE_REGION_PROFILES['mainland-cn'].baseUrl).toBe(DEFAULT_OMNICODE_BASE_URL);
    expect(OMNICODE_REGION_PROFILES['mainland-cn'].relayOrigin).toBe('https://code-rc.omnicode.com');
  });

  it('omnicodeRegionProfile returns the requested profile', () => {
    expect(omnicodeRegionProfile('global').oauthHost).toBe('https://auth.omnicode.ai');
    expect(omnicodeRegionProfile('global').relayOrigin).toBe('https://code-rc.omnicode.ai');
    expect(omnicodeRegionProfile('global').telemetryEndpoint).toBeUndefined();
    expect(omnicodeRegionProfile('mainland-cn').telemetryEndpoint).toBe(
      'https://telemetry-logs.omnicode.com/v1/event',
    );
    expect(omnicodeRegionProfile('mainland-cn')).toBe(OMNICODE_REGION_PROFILES['mainland-cn']);
  });
});

describe('resolveOmnicodeRegion', () => {
  let workDir: TempDirHandle | undefined;

  afterEach(async () => {
    await workDir?.cleanup();
    workDir = undefined;
  });

  async function markerDir(contents?: string): Promise<string> {
    workDir = await createTempWorkDir();
    if (contents !== undefined) {
      await writeFile(join(workDir.path, OMNICODE_REGION_MARKER_FILENAME), contents, 'utf-8');
    }
    return workDir.path;
  }

  it('defaults to mainland-cn when nothing points anywhere', async () => {
    expect(resolveOmnicodeRegion({ env: {}, homeDir: await markerDir() })).toBe('mainland-cn');
  });

  it('resolves a known env oauth host, OMNICODE_OAUTH_HOST first', () => {
    expect(resolveOmnicodeRegion({ env: { OMNICODE_OAUTH_HOST: 'https://auth.omnicode.ai' } })).toBe(
      'global',
    );
    expect(resolveOmnicodeRegion({ env: { OMNICODE_AUTH_HOST: 'https://auth.omnicode.ai' } })).toBe(
      'global',
    );
    expect(
      resolveOmnicodeRegion({
        env: {
          OMNICODE_OAUTH_HOST: 'https://auth.omnicode.com',
          OMNICODE_AUTH_HOST: 'https://auth.omnicode.ai',
        },
      }),
    ).toBe('mainland-cn');
  });

  it('treats an unknown env host as a custom environment and falls back to cn', async () => {
    // ...even when the persisted login or marker says otherwise: the custom
    // env overrides every endpoint anyway.
    expect(
      resolveOmnicodeRegion({
        env: { OMNICODE_OAUTH_HOST: 'https://auth.internal.example.com' },
        configuredOAuthHost: 'https://auth.omnicode.ai',
        homeDir: await markerDir('global\n'),
      }),
    ).toBe('mainland-cn');
  });

  it('resolves the persisted login host, tolerating trailing slashes', () => {
    expect(resolveOmnicodeRegion({ env: {}, configuredOAuthHost: 'https://auth.omnicode.ai/' })).toBe(
      'global',
    );
    expect(resolveOmnicodeRegion({ env: {}, configuredOAuthHost: 'https://auth.omnicode.com' })).toBe('mainland-cn');
  });

  it('ignores an unrecognized persisted host and continues down the chain', async () => {
    expect(
      resolveOmnicodeRegion({
        env: {},
        configuredOAuthHost: 'https://auth.legacy.example.com',
        homeDir: await markerDir('global'),
      }),
    ).toBe('global');
  });

  it('reads the install-channel marker when nothing else decides', async () => {
    expect(resolveOmnicodeRegion({ env: {}, homeDir: await markerDir('global\n') })).toBe('global');
    expect(resolveOmnicodeRegion({ env: {}, homeDir: await markerDir('  mainland-cn  ') })).toBe('mainland-cn');
  });

  it('ignores a malformed or missing marker', async () => {
    expect(resolveOmnicodeRegion({ env: {}, homeDir: await markerDir('apac') })).toBe('mainland-cn');
    expect(resolveOmnicodeRegion({ env: {}, homeDir: await markerDir('') })).toBe('mainland-cn');
  });

  it('skips the marker entirely when readMarker is false', async () => {
    expect(
      resolveOmnicodeRegion({ env: {}, homeDir: await markerDir('global'), readMarker: false }),
    ).toBe('mainland-cn');
  });

  it('honors OMNICODE_HOME when homeDir is not passed explicitly', async () => {
    const dir = await markerDir('global');
    expect(resolveOmnicodeRegion({ env: { OMNICODE_HOME: dir } })).toBe('global');
  });

  it('env beats persisted login beats marker', async () => {
    const dir = await markerDir('global');
    expect(
      resolveOmnicodeRegion({
        env: { OMNICODE_OAUTH_HOST: 'https://auth.omnicode.com' },
        configuredOAuthHost: 'https://auth.omnicode.ai',
        homeDir: dir,
      }),
    ).toBe('mainland-cn');
    expect(
      resolveOmnicodeRegion({
        env: {},
        configuredOAuthHost: 'https://auth.omnicode.ai',
        homeDir: dir,
      }),
    ).toBe('global');
  });

  it('treats the persisted default-slot key as explicit mainland-cn, beating the marker', async () => {
    const dir = await markerDir('global');
    expect(
      resolveOmnicodeRegion({ env: {}, configuredOAuthKey: OMNICODE_OAUTH_KEY, homeDir: dir }),
    ).toBe('mainland-cn');
  });

  it('still follows the marker when no key or host is persisted', async () => {
    expect(resolveOmnicodeRegion({ env: {}, homeDir: await markerDir('global') })).toBe('global');
  });

  it('lets an unknown scoped key fall through to the marker', async () => {
    const dir = await markerDir('global');
    const key = 'oauth/omnicode-env-0123456789abcdef';
    expect(
      resolveOmnicodeRegion({
        env: {},
        configuredOAuthKey: key,
        homeDir: dir,
      }),
    ).toBe('global');
    expect(resolveOmnicodeRemoteControlAuth({ env: {}, configuredOAuthKey: key, homeDir: dir })).toEqual({
      region: 'global',
      oauthKey: key,
      relayOrigin: 'https://code-rc.omnicode.com',
    });
  });

  it('resolves a recognized persisted host before consulting the key', () => {
    expect(
      resolveOmnicodeRegion({
        env: {},
        configuredOAuthHost: 'https://auth.omnicode.ai',
        configuredOAuthKey: OMNICODE_OAUTH_KEY,
      }),
    ).toBe('global');
    expect(
      resolveOmnicodeRemoteControlAuth({
        env: {},
        configuredOAuthHost: 'https://auth.omnicode.ai',
        configuredOAuthKey: 'oauth/omnicode-env-0123456789abcdef',
      }).relayOrigin,
    ).toBe('https://code-rc.omnicode.ai');
  });
});

describe('omnicodeRegionLoginHosts', () => {
  it('returns both profile hosts, mainland-cn included (explicit beats stale config)', () => {
    expect(omnicodeRegionLoginHosts('mainland-cn', {})).toEqual({
      oauthHost: 'https://auth.omnicode.com',
      baseUrl: 'https://api.omnicode.com/coding/v1',
    });
    expect(omnicodeRegionLoginHosts('global', {})).toEqual({
      oauthHost: 'https://auth.omnicode.ai',
      baseUrl: 'https://api.omnicode.ai/coding/v1',
    });
  });

  it('yields to env overrides', () => {
    expect(omnicodeRegionLoginHosts('global', { OMNICODE_OAUTH_HOST: 'https://auth.x.com' })).toBe(
      undefined,
    );
    expect(omnicodeRegionLoginHosts('global', { OMNICODE_OAUTH_HOST: 'https://auth.x.com' })).toBe(
      undefined,
    );
    expect(
      omnicodeRegionLoginHosts('global', { OMNICODE_BASE_URL: 'https://api.x.com/coding/v1' }),
    ).toBe(undefined);
  });
});

describe('omnicodeRegionSchema', () => {
  it('parses valid regions and rejects others', () => {
    expect(omnicodeRegionSchema.parse('mainland-cn')).toBe('mainland-cn');
    expect(omnicodeRegionSchema.parse('global')).toBe('global');
    expect(omnicodeRegionSchema.safeParse('apac').success).toBe(false);
  });
});
