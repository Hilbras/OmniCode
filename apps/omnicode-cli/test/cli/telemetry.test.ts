/**
 * Tests for the CLI telemetry bootstrap helpers, focusing on the
 * `omnicode web` / `omnicode server run` host wiring added in `cli/telemetry.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initializeTelemetry: vi.fn(),
  configureOtlpRuntime: vi.fn(),
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
  configureOtlpRuntime: mocks.configureOtlpRuntime,
  DEFAULT_OTLP_FLUSH_INTERVAL_MS: 30_000,
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

vi.mock('@hilbras/omnicode-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hilbras/omnicode-api')>();
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
    // The first dynamic import pulls in the whole SDK/oauth chain (~3s idle).
    // On a cold transform cache it has been measured at ~17s, and every test in
    // this file pays it when it runs alone (a filtered run loads the graph
    // cold), so each one gets an explicit budget far above that rather than
    // relying on a previous test having warmed the module graph.
  }, 60_000);

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
  }, 60_000);

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
  }, 60_000);
});

describe('configureCliOtlpTelemetry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.configureOtlpRuntime.mockClear();
  });

  it('keeps OTLP off when no endpoint is configured', async () => {
    const { configureCliOtlpTelemetry } = await import('#/cli/telemetry');
    vi.stubEnv('OMNICODE_OTLP_ENDPOINT', '');
    configureCliOtlpTelemetry();
    expect(mocks.configureOtlpRuntime).not.toHaveBeenCalled();

    vi.stubEnv('OMNICODE_OTLP_ENDPOINT', undefined as unknown as string);
    configureCliOtlpTelemetry();
    expect(mocks.configureOtlpRuntime).not.toHaveBeenCalled();
  }, 60_000);

  it('configures the runtime with the CLI service name and per-send endpoint/token resolvers', async () => {
    const { configureCliOtlpTelemetry } = await import('#/cli/telemetry');
    vi.stubEnv('OMNICODE_OTLP_ENDPOINT', 'http://collector.lan:4318');
    vi.stubEnv('OMNICODE_OTLP_TOKEN', 'tok-1');
    configureCliOtlpTelemetry();

    expect(mocks.configureOtlpRuntime).toHaveBeenCalledTimes(1);
    const options = mocks.configureOtlpRuntime.mock.calls[0]?.[0] as {
      serviceName: string;
      endpoint: () => string | undefined;
      getAccessToken: () => string | null;
      flushIntervalMs: number;
    };
    expect(options.serviceName).toBe('omnicode-cli');
    expect(options.endpoint()).toBe('http://collector.lan:4318');
    expect(options.getAccessToken()).toBe('tok-1');
    expect(options.flushIntervalMs).toBe(30_000);

    vi.stubEnv('OMNICODE_OTLP_TOKEN', '');
    vi.stubEnv('OMNICODE_OTLP_ENDPOINT', 'https://collector2.lan:4318');
    expect(options.getAccessToken()).toBeNull();
    expect(options.endpoint()).toBe('https://collector2.lan:4318');
  }, 60_000);

  it('honours a valid flush interval override and ignores junk', async () => {
    const { configureCliOtlpTelemetry } = await import('#/cli/telemetry');
    vi.stubEnv('OMNICODE_OTLP_ENDPOINT', 'http://collector.lan:4318');
    vi.stubEnv('OMNICODE_OTLP_FLUSH_INTERVAL_MS', '5000');
    configureCliOtlpTelemetry();
    expect(mocks.configureOtlpRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ flushIntervalMs: 5000 }),
    );

    vi.stubEnv('OMNICODE_OTLP_FLUSH_INTERVAL_MS', 'nope');
    configureCliOtlpTelemetry();
    expect(mocks.configureOtlpRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({ flushIntervalMs: 30_000 }),
    );
  }, 60_000);

  it('stays off for a malformed or non-http endpoint', async () => {
    const { configureCliOtlpTelemetry } = await import('#/cli/telemetry');
    vi.stubEnv('OMNICODE_OTLP_ENDPOINT', 'not-a-url');
    configureCliOtlpTelemetry();
    expect(mocks.configureOtlpRuntime).not.toHaveBeenCalled();

    vi.stubEnv('OMNICODE_OTLP_ENDPOINT', 'ftp://collector.lan');
    configureCliOtlpTelemetry();
    expect(mocks.configureOtlpRuntime).not.toHaveBeenCalled();
  }, 60_000);
});
