import { describe, expect, it } from 'vitest';

import { mergeMcpServerConfig, McpServerConfigSchema } from '#/mcpCore/config-schema';

describe('mergeMcpServerConfig', () => {
  it('keeps fields the incoming config does not mention', () => {
    const stored = {
      transport: 'stdio',
      command: 'npx',
      env: { TOKEN: 'abc' },
      cwd: '/srv',
      enabled: true,
      toolTimeoutMs: 5000,
    } as const;

    const merged = mergeMcpServerConfig(stored, {
      transport: 'stdio',
      command: 'uvx',
    });

    expect(merged).toMatchObject({
      command: 'uvx',
      env: { TOKEN: 'abc' },
      cwd: '/srv',
      enabled: true,
      toolTimeoutMs: 5000,
    });
  });

  it('replaces a map that the incoming config does send', () => {
    const stored = {
      transport: 'stdio',
      command: 'npx',
      env: { TOKEN: 'abc' },
    } as const;

    const merged = mergeMcpServerConfig(stored, {
      transport: 'stdio',
      command: 'npx',
      env: {},
    });

    expect(merged).toMatchObject({ env: {} });
  });

  it('ignores an explicitly undefined value', () => {
    const stored = {
      transport: 'stdio',
      command: 'npx',
      cwd: '/srv',
    } as const;

    const merged = mergeMcpServerConfig(stored, {
      transport: 'stdio',
      command: 'npx',
      cwd: undefined,
    });

    expect(merged).toMatchObject({ cwd: '/srv' });
  });
});

describe('McpServerConfigSchema', () => {
  it('rejects an executor that is not implemented', () => {
    const parsed = McpServerConfigSchema.safeParse({
      transport: 'stdio',
      command: 'npx',
      executor: 'kaos',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts the local executor and the env inheritance switch', () => {
    const parsed = McpServerConfigSchema.safeParse({
      transport: 'stdio',
      command: 'npx',
      executor: 'local',
      inheritEnv: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a remote server that opts into a private network', () => {
    const parsed = McpServerConfigSchema.safeParse({
      transport: 'http',
      url: 'https://10.0.0.5/mcp',
      allowPrivateNetwork: true,
    });
    expect(parsed.success).toBe(true);
  });
});
