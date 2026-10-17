/**
 * Tests for the CLI telemetry bootstrap helpers, focusing on the
 * `omnicode web` / `omnicode server run` host wiring added in `cli/telemetry.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initializeTelemetry: vi.fn(),
  createOmnicodeDeviceId: vi.fn(() => 'device-123'),
  resolveOmnicodeHome: vi.fn(() => '/home/.omnicode'),
  resolveConfigPath: vi.fn(() => '/home/.omnicode/config.toml'),
  loadRuntimeConfigSafe: vi.fn(
    (): {
      config: { defaultModel?: string; telemetry?: boolean };
      fileError: Error | undefined;
    } => ({
      config: { defaultModel: 'omnicode-k2', telemetry: true },
      fileError: undefined,
    }),
  ),
  getCachedAccessToken: vi.fn(async () => 'tok'),
}));

vi.mock('@hilbras/omnicode-telemetry', () => ({
  initializeTelemetry: mocks.initializeTelemetry,
  setTelemetryContext: vi.fn(),
  track: vi.fn(),
  withTelemetryContext: vi.fn(),
}));

vi.mock('@hilbras/omnicode-auth', async (importOriginal) => {
  // Spread the real module: the SDK's v2 client pulls omnicode-core into the
  // import graph, which subclasses OmnicodeOAuthToolkit from this package.
  const actual = await importOriginal<typeof import('@hilbras/omnicode-auth')>();
  return {
    ...actual,
    createOmnicodeDeviceId: mocks.createOmnicodeDeviceId,
    OMNICODE_PROVIDER_NAME: 'managed:omnicode',
  };
});

vi.mock('@hilbras/kernel-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hilbras/kernel-api')>();
  return {
    ...actual,
    resolveOmnicodeHome: mocks.resolveOmnicodeHome,
    resolveConfigPath: mocks.resolveConfigPath,
    loadRuntimeConfigSafe: mocks.loadRuntimeConfigSafe,
    OmnicodeAuthFacade: vi.fn(function () {
      return { getCachedAccessToken: mocks.getCachedAccessToken };
    }),
  };
});

describe('initializeServerTelemetry', () => {
  beforeEach(() => {
    mocks.initializeTelemetry.mockClear();
    mocks.loadRuntimeConfigSafe.mockClear();
    mocks.loadRuntimeConfigSafe.mockReturnValue({
      config: { defaultModel: 'omnicode-k2', telemetry: true },
      fileError: undefined,
    });
  });

  it('configures the sink with ui_mode="web" and the CLI product identity', async () => {
    const { initializeServerTelemetry } = await import('#/cli/telemetry');
    const client = initializeServerTelemetry({ version: '1.2.3' });
    expect(mocks.initializeTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: 'omnicode-cli',
        version: '1.2.3',
        uiMode: 'web',
        model: 'omnicode-k2',
        enabled: true,
        deviceId: 'device-123',
        homeDir: '/home/.omnicode',
      }),
    );
    // The returned client wraps the module functions so core + the host share
    // the same underlying client.
    expect(client).toEqual(
      expect.objectContaining({
        track: expect.any(Function),
        withContext: expect.any(Function),
        setContext: expect.any(Function),
      }),
    );
    // The first dynamic import pulls in the whole SDK/oauth chain (~3s idle,
    // more under full-suite transform contention) — give it headroom past the
    // 5s default timeout.
  }, 20000);

  it('disables telemetry when config.toml sets telemetry = false', async () => {
    mocks.loadRuntimeConfigSafe.mockReturnValue({
      config: { defaultModel: 'omnicode-k2', telemetry: false },
      fileError: undefined,
    });
    const { initializeServerTelemetry } = await import('#/cli/telemetry');
    initializeServerTelemetry({ version: '1.2.3' });

    expect(mocks.initializeTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('degrades to enabled with no model when config is unreadable', async () => {
    mocks.loadRuntimeConfigSafe.mockReturnValue({
      config: {},
      fileError: new Error('bad toml'),
    });
    const { initializeServerTelemetry } = await import('#/cli/telemetry');
    initializeServerTelemetry({ version: '1.2.3' });

    expect(mocks.initializeTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, model: undefined }),
    );
  });
});
