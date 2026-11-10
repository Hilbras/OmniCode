import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  createOmnicodeHarness,
  type Event,
  type OmnicodeError,
  type SkillActivatedEvent,
  type SkillSummary,
  type AgentProfileSummary,
  type ConnectorEntry,
  type ConnectorKind,
  type ConnectorStatus,
} from '#/index';
import type { SDKRpcClientBase } from '#/rpc';

import { makeTempDir, removeTempDirs, waitForSDKEvent } from './session-runtime-helpers';
import { TEST_IDENTITY } from './test-identity';

const { Session } = await import('#/index');

const tempDirs: string[] = [];

const CONFIG_ENV_PATTERN =
  /^(OMNICODE_MODEL_|OMNICODE_LOOP_|OMNICODE_MCP_|OMNICODE_WEB_|OMNICODE_IMAGE_|OMNICODE_BACKGROUND_|OMNICODE_MODEL_CATALOG_)/;

/** Keep ambient env from injecting providers/models into the v2 engine. */
function scrubConfigEnv(): () => void {
  const saved: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && CONFIG_ENV_PATTERN.test(key)) {
      saved[key] = value;
      delete process.env[key];
    }
  }
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      process.env[key] = value;
    }
  };
}

afterEach(async () => {
  await removeTempDirs(tempDirs);
  vi.unstubAllEnvs();
});

describe('Session skills', () => {
  it('submits multiple skills with a prompt as one grouped turn', async () => {
    const restoreEnv = scrubConfigEnv();
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-skills-home-');
    const workDir = await makeTempDir(tempDirs, 'omnicode-sdk-skills-work-');
    await writeSkill(workDir, 'review', [
      '---',
      'name: review',
      'description: Review code',
      '---',
      '',
      'Review the requested file.',
    ]);
    await writeSkill(workDir, 'security', [
      '---',
      'name: security',
      'description: Check security',
      '---',
      '',
      'Check the requested file for security issues.',
    ]);
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_sdk_multi_skill', workDir });
      const events: Event[] = [];
      const unsubscribe = session.onEvent((event) => {
        events.push(event);
      });
      const ended = waitForSDKEvent(session, (event) => event.type === 'turn.ended');

      await session.promptWithSkills('Review this change.', [
        { name: 'review' },
        { name: 'security' },
      ]);
      await ended;
      unsubscribe();

      const activations = events.filter(
        (event): event is Extract<Event, { type: 'skill.activated' }> =>
          event.type === 'skill.activated',
      );
      expect(activations.map((event) => event.skillName)).toEqual(['review', 'security']);
      expect(events.filter((event) => event.type === 'turn.started')).toHaveLength(1);
    } finally {
      await harness.close();
      restoreEnv();
    }
  });

  it('lists session skills without exposing content', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-skills-home-');
    const workDir = await makeTempDir(tempDirs, 'omnicode-sdk-skills-work-');
    await writeSkill(workDir, 'review', [
      '---',
      'name: review',
      'description: Review code',
      'disable_model_invocation: true',
      '---',
      '',
      'Review the requested file.',
    ]);
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_sdk_skill_list', workDir });

      const skills = await session.listSkills();
      const listed = skills.find((skill) => skill.name === 'review');

      expect(listed).toMatchObject({
        name: 'review',
        description: 'Review code',
        source: 'project',
        disableModelInvocation: true,
      });
      expect(listed?.path.endsWith('/.omnicode/skills/review/SKILL.md')).toBe(true);
      expect(JSON.stringify(skills)).not.toContain('Review the requested file.');
    } finally {
      await harness.close();
    }
  });

  it('activates a skill through core and emits the public skill event', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-skills-home-');
    const workDir = await makeTempDir(tempDirs, 'omnicode-sdk-skills-work-');
    await writeSkill(workDir, 'review', [
      '---',
      'name: review',
      'description: Review code',
      '---',
      '',
      'Review the requested file.',
    ]);
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_sdk_skill_activate', workDir });
      const events: Event[] = [];
      const unsubscribe = session.onEvent((event) => {
        events.push(event);
      });
      const activated = waitForSDKEvent(session, (event) => event.type === 'skill.activated');
      const metaUpdated = waitForSDKEvent(
        session,
        (event) => event.type === 'session.meta.updated',
      );
      const ended = waitForSDKEvent(session, (event) => event.type === 'turn.ended');

      await session.activateSkill(' review ', ' src/app.ts ');
      const activatedEvent = await activated;
      const metaEvent = await metaUpdated;
      await ended;
      unsubscribe();

      expect(activatedEvent).toMatchObject({
        type: 'skill.activated',
        sessionId: session.id,
        agentId: 'main',
        skillName: 'review',
        skillArgs: 'src/app.ts',
        trigger: 'user-slash',
        skillSource: 'project',
      });
      expect(JSON.stringify(activatedEvent)).not.toContain('Review the requested file.');
      expect(events.findIndex((event) => event.type === 'skill.activated')).toBeGreaterThanOrEqual(
        0,
      );
      expect(events.findIndex((event) => event.type === 'turn.started')).toBeGreaterThan(
        events.findIndex((event) => event.type === 'skill.activated'),
      );
      expect(metaEvent).toMatchObject({
        type: 'session.meta.updated',
        sessionId: session.id,
        agentId: 'main',
        title: '/review src/app.ts',
        patch: {
          title: '/review src/app.ts',
          isCustomTitle: false,
          lastPrompt: '/review src/app.ts',
        },
      });
    } finally {
      await harness.close();
    }
  });

  it('resolves user brand skills from OMNICODE_HOME, not the OS home', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-skills-home-');
    const processHome = await makeTempDir(tempDirs, 'omnicode-sdk-skills-process-home-');
    const workDir = await makeTempDir(tempDirs, 'omnicode-sdk-skills-work-');
    vi.stubEnv('HOME', processHome);
    vi.stubEnv('OMNICODE_HOME', homeDir);
    await writeLegacyUserSkill(processHome, 'sdk-real-home-only', 'SDK real home skill');
    await writeBrandUserSkill(homeDir, 'sdk-sandbox-only', 'SDK sandbox skill');
    const harness = createOmnicodeHarness({ identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_sdk_skill_env_home', workDir });
      const names = new Set((await session.listSkills()).map((skill) => skill.name));

      expect(names.has('sdk-real-home-only')).toBe(false);
      expect(names.has('sdk-sandbox-only')).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it('rejects empty names before calling RPC and rejects after close', async () => {
    const activateSkill = vi.fn(async () => {});
    const closeSession = vi.fn(async (_input: { readonly sessionId: string }) => {});
    const clearSessionHandlers = vi.fn();
    const listSkills = vi.fn(async () => []);
    const session = new Session({
      id: 'ses_skill_validation',
      workDir: '/tmp/work',
      rpc: {
        activateSkill,
        closeSession,
        clearSessionHandlers,
        listSkills,
      } as unknown as SDKRpcClientBase,
    });

    await expect(session.activateSkill('   ')).rejects.toMatchObject({
      name: 'OmnicodeError',
      code: 'skill.name_empty',
    } satisfies Partial<OmnicodeError>);
    expect(activateSkill).not.toHaveBeenCalled();

    await session.close();
    expect(closeSession).toHaveBeenCalledWith({ sessionId: session.id });
    expect(clearSessionHandlers).toHaveBeenCalledWith(session.id);
    await expect(session.listSkills()).rejects.toMatchObject({
      name: 'OmnicodeError',
      code: 'session.closed',
    } satisfies Partial<OmnicodeError>);
    await expect(session.activateSkill('review')).rejects.toMatchObject({
      name: 'OmnicodeError',
      code: 'session.closed',
    } satisfies Partial<OmnicodeError>);
  });

  it('finalizes local close state when the core close RPC fails', async () => {
    const closeSession = vi.fn(async (_input: { readonly sessionId: string }) => {
      throw new Error('flush failed');
    });
    const clearSessionHandlers = vi.fn();
    const listSkills = vi.fn(async () => []);
    const activateSkill = vi.fn(async () => {});
    const session = new Session({
      id: 'ses_close_failed',
      workDir: '/tmp/work',
      rpc: {
        activateSkill,
        closeSession,
        clearSessionHandlers,
        listSkills,
      } as unknown as SDKRpcClientBase,
    });

    await expect(session.close()).rejects.toThrow('flush failed');
    await expect(session.close()).resolves.toBeUndefined();
    expect(closeSession).toHaveBeenCalledTimes(1);
    expect(clearSessionHandlers).toHaveBeenCalledWith(session.id);
    await expect(session.listSkills()).rejects.toMatchObject({
      name: 'OmnicodeError',
      code: 'session.closed',
    } satisfies Partial<OmnicodeError>);
  });

  it('exposes public skill event and summary types', () => {
    expectTypeOf<SkillSummary['name']>().toEqualTypeOf<string>();
    expectTypeOf<SkillActivatedEvent['skillName']>().toEqualTypeOf<string>();
  });
});

describe('OmnicodeHarness workspace skills', () => {
  it('returns project skills when no session exists', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-workspace-skills-home-');
    const workDir = await makeTempDir(tempDirs, 'omnicode-sdk-workspace-skills-work-');
    await writeSkill(workDir, 'workspace-review', [
      '---',
      'name: workspace-review',
      'description: Review workspace changes',
      '---',
      '',
      'Inspect every changed file.',
    ]);
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const skills = await harness.listWorkspaceSkills(workDir);

      expect(skills.find((skill) => skill.name === 'workspace-review')).toMatchObject({
        name: 'workspace-review',
        description: 'Review workspace changes',
        source: 'project',
      });
      expect(harness.sessions.size).toBe(0);
    } finally {
      await harness.close();
    }
  });

  it('offers a first-party provider connect action only in a trusted workspace', async () => {
    vi.stubEnv('OMNICODE_EXPERIMENTAL_GITHUB_CONNECTOR', '1');
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-connector-provider-home-');
    const workDir = await makeTempDir(tempDirs, 'omnicode-sdk-connector-provider-work-');
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const untrusted = await harness.listWorkspaceConnectors(workDir);
      const github = untrusted.find((connector) => connector.id === 'github');
      expect(github?.kind).toBe('service');
      expect(github?.status).toBe('needs-trust');
      expect(github?.actions).not.toContain('connect-github');

      await harness.trustWorkspace(workDir);
      const trusted = await harness.listWorkspaceConnectors(workDir);
      const trustedGithub = trusted.find((connector) => connector.id === 'github');
      expect(trustedGithub?.actions).toContain('connect-github');
    } finally {
      await harness.close();
      vi.unstubAllEnvs();
    }
  });

  it('preserves the core error when workDir is empty', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-workspace-skills-home-');
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await expect(harness.listWorkspaceSkills('   ')).rejects.toMatchObject({
        name: 'OmnicodeError',
        code: 'request.work_dir_required',
        message: 'listWorkspaceSkills requires workDir',
      } satisfies Partial<OmnicodeError>);
    } finally {
      await harness.close();
    }
  });

  it('preserves the core error when workDir is not a string', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-workspace-skills-home-');
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await expect(harness.listWorkspaceSkills(null as never)).rejects.toMatchObject({
        name: 'OmnicodeError',
        code: 'request.work_dir_required',
        message: 'listWorkspaceSkills requires workDir',
      } satisfies Partial<OmnicodeError>);
    } finally {
      await harness.close();
    }
  });
});

describe('OmnicodeHarness workspace agent profiles', () => {
  it('exposes the public profile summary type', () => {
    expectTypeOf<AgentProfileSummary['name']>().toEqualTypeOf<string>();
    expectTypeOf<AgentProfileSummary['description']>().toEqualTypeOf<string | undefined>();
  });

  it('returns workspace-scoped profile summaries without creating a session', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-profile-home-');
    const firstWorkDir = await makeTempDir(tempDirs, 'omnicode-sdk-profile-first-');
    const secondWorkDir = await makeTempDir(tempDirs, 'omnicode-sdk-profile-second-');
    await writeAgentProfile(
      firstWorkDir,
      'first-profile',
      'First profile',
      'Use for first-workspace tasks.',
    );
    await writeAgentProfile(
      secondWorkDir,
      'second-profile',
      'Second profile',
      'Use for second-workspace tasks.',
    );
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const first = await harness.listWorkspaceAgentProfiles(firstWorkDir);
      const second = await harness.listWorkspaceAgentProfiles(secondWorkDir);

      expect(first).toContainEqual({
        name: 'first-profile',
        description: 'First profile',
        whenToUse: 'Use for first-workspace tasks.',
      });
      expect(first.some((profile) => profile.name === 'second-profile')).toBe(false);
      expect(second.some((profile) => profile.name === 'first-profile')).toBe(false);
      expect(second).toContainEqual({
        name: 'second-profile',
        description: 'Second profile',
        whenToUse: 'Use for second-workspace tasks.',
      });
      expect(harness.sessions.size).toBe(0);
    } finally {
      await harness.close();
    }
  });

  it('preserves the core error when workDir is empty', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-profile-home-');
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await expect(harness.listWorkspaceAgentProfiles('   ')).rejects.toMatchObject({
        name: 'OmnicodeError',
        code: 'request.work_dir_required',
        message: 'listWorkspaceAgentProfiles requires workDir',
      } satisfies Partial<OmnicodeError>);
    } finally {
      await harness.close();
    }
  });
});

describe('OmnicodeHarness workspace connectors', () => {
  it('exposes the public connector entry type', () => {
    expectTypeOf<ConnectorEntry['id']>().toEqualTypeOf<string>();
    expectTypeOf<ConnectorEntry['kind']>().toEqualTypeOf<ConnectorKind>();
    expectTypeOf<ConnectorEntry['status']>().toEqualTypeOf<ConnectorStatus>();
  });

  it('lists the workspace MCP servers with their kind, status, scope and actions', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-connector-home-');
    const workDir = await makeTempDir(tempDirs, 'omnicode-sdk-connector-work-');
    await writeMcpJson(join(homeDir, 'mcp.json'), {
      'user-server': { transport: 'stdio', command: 'user-command' },
    });
    await writeMcpJson(join(workDir, '.omnicode', 'mcp.json'), {
      'workspace-server': { transport: 'stdio', command: 'workspace-command' },
    });
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await harness.trustWorkspace(workDir);
      const connectors = await harness.listWorkspaceConnectors(workDir);

      expect(connectors).toContainEqual({
        id: 'mcp:user-server',
        kind: 'mcp',
        name: 'user-server',
        description: 'stdio',
        scope: 'user',
        status: 'active',
        capabilities: ['tools'],
        actions: ['open-mcp'],
      });
      expect(connectors).toContainEqual({
        id: 'mcp:workspace-server',
        kind: 'mcp',
        name: 'workspace-server',
        description: 'stdio',
        scope: 'workspace',
        status: 'active',
        capabilities: ['tools'],
        actions: ['open-mcp'],
      });
      expect(harness.sessions.size).toBe(0);
    } finally {
      await harness.close();
    }
  });

  it('lists a first-party platform as unavailable while its experimental flag is off', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-connector-service-home-');
    const workDir = await makeTempDir(tempDirs, 'omnicode-sdk-connector-service-work-');
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const connectors = await harness.listWorkspaceConnectors(workDir);

      const github = connectors.find((connector) => connector.id === 'github');
      expect(github?.kind).toBe('service');
      expect(github?.status).toBe('unavailable');
      expect(github?.actions).toEqual([]);
      expect(connectors.some((connector) => connector.status === 'active')).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it('reports the GitHub connection state without exposing token material', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-github-status-home-');
    const workDir = await makeTempDir(tempDirs, 'omnicode-sdk-github-status-work-');
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const status = await harness.getGitHubStatus();

      expect(status).toMatchObject({ configured: false, connected: false, scopes: [] });
      expect(JSON.stringify(status)).not.toContain('token');
    } finally {
      await harness.close();
    }
  });

  it('keeps a GitHub connection across sessions', async () => {
    vi.stubEnv('OMNICODE_EXPERIMENTAL_GITHUB_CONNECTOR', '1');
    vi.stubEnv('OMNICODE_GITHUB_CLIENT_ID', 'Iv1.0testclientid000000');
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-github-persist-home-');
    const workDir = await makeTempDir(tempDirs, 'omnicode-sdk-github-persist-work-');
    const credentials = join(homeDir, 'credentials', 'github');
    await mkdir(credentials, { recursive: true });
    await writeFile(
      join(credentials, 'account'),
      JSON.stringify({
        accessToken: 'gho_persisted_token',
        tokenType: 'bearer',
        scopes: ['repo'],
        login: 'octocat',
        repositoryAccess: 'all',
        repositories: [],
      }),
    );

    const first = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });
    try {
      const status = await first.getGitHubStatus();
      expect(status).toMatchObject({ configured: true, connected: true, accountLogin: 'octocat' });
    } finally {
      await first.close();
    }

    const second = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });
    try {
      const status = await second.getGitHubStatus();
      expect(status.connected).toBe(true);
      expect(status.accountLogin).toBe('octocat');
      expect(JSON.stringify(status)).not.toContain('gho_persisted_token');
    } finally {
      await second.close();
      vi.unstubAllEnvs();
    }
  });

  it('refuses to start a GitHub device flow while no client id is configured', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-github-flow-home-');
    const workDir = await makeTempDir(tempDirs, 'omnicode-sdk-github-flow-work-');
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await expect(harness.startGitHubDeviceFlow()).rejects.toMatchObject({
        code: 'github.not_configured',
      });
    } finally {
      await harness.close();
    }
  });

  it('reports the Vercel connection state without exposing token material', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-vercel-status-home-');
    const workDir = await makeTempDir(tempDirs, 'omnicode-sdk-vercel-status-work-');
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const status = await harness.getVercelStatus();

      expect(status).toMatchObject({ configured: false, connected: false, scopes: [] });
      expect(JSON.stringify(status)).not.toContain('token');
    } finally {
      await harness.close();
    }
  });

  it('refuses to connect Vercel while no token is configured', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-vercel-connect-home-');
    const workDir = await makeTempDir(tempDirs, 'omnicode-sdk-vercel-connect-work-');
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await expect(harness.connectVercel()).rejects.toMatchObject({
        code: 'vercel.not_configured',
      });
    } finally {
      await harness.close();
    }
  });

  it('keeps another workspace out of the listing', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-connector-scope-home-');
    const firstWorkDir = await makeTempDir(tempDirs, 'omnicode-sdk-connector-scope-first-');
    const secondWorkDir = await makeTempDir(tempDirs, 'omnicode-sdk-connector-scope-second-');
    await writeMcpJson(join(homeDir, 'mcp.json'), {
      'user-server': { transport: 'stdio', command: 'user-command' },
    });
    await writeMcpJson(join(firstWorkDir, '.omnicode', 'mcp.json'), {
      'first-server': { transport: 'stdio', command: 'first-command' },
    });
    await writeMcpJson(join(secondWorkDir, '.omnicode', 'mcp.json'), {
      'second-server': { transport: 'stdio', command: 'second-command' },
    });
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await harness.trustWorkspace(firstWorkDir);
      await harness.trustWorkspace(secondWorkDir);

      const first = await harness.listWorkspaceConnectors(firstWorkDir);
      const second = await harness.listWorkspaceConnectors(secondWorkDir);

      expect(first.map((connector) => connector.id)).toContain('mcp:first-server');
      expect(first.map((connector) => connector.id)).not.toContain('mcp:second-server');
      expect(second.map((connector) => connector.id)).toContain('mcp:second-server');
      expect(second.map((connector) => connector.id)).not.toContain('mcp:first-server');
      expect(first.map((connector) => connector.id)).toContain('mcp:user-server');
      expect(second.map((connector) => connector.id)).toContain('mcp:user-server');
    } finally {
      await harness.close();
    }
  });

  it('hides workspace-scoped servers from an untrusted workspace', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-connector-trust-home-');
    const workDir = await makeTempDir(tempDirs, 'omnicode-sdk-connector-trust-work-');
    await writeMcpJson(join(homeDir, 'mcp.json'), {
      'user-server': { transport: 'stdio', command: 'user-command' },
    });
    await writeMcpJson(join(workDir, '.omnicode', 'mcp.json'), {
      'workspace-server': { transport: 'stdio', command: 'workspace-command' },
    });
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const connectors = await harness.listWorkspaceConnectors(workDir);

      expect(connectors.map((connector) => connector.id)).toContain('mcp:user-server');
      expect(connectors.map((connector) => connector.id)).not.toContain('mcp:workspace-server');
    } finally {
      await harness.close();
    }
  });

  it('preserves the core error when workDir is empty', async () => {
    const homeDir = await makeTempDir(tempDirs, 'omnicode-sdk-connector-empty-home-');
    const harness = createOmnicodeHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await expect(harness.listWorkspaceConnectors('   ')).rejects.toMatchObject({
        name: 'OmnicodeError',
        code: 'request.work_dir_required',
        message: 'listWorkspaceConnectors requires workDir',
      } satisfies Partial<OmnicodeError>);
    } finally {
      await harness.close();
    }
  });
});

async function writeMcpJson(
  filePath: string,
  servers: Readonly<Record<string, { transport: 'stdio'; command: string }>>,
): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, JSON.stringify({ mcpServers: servers }, undefined, 2));
}

async function writeAgentProfile(
  workDir: string,
  name: string,
  description: string,
  whenToUse: string,
): Promise<void> {
  const dir = join(workDir, '.omnicode', 'agents');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${name}.md`),
    [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      `whenToUse: ${whenToUse}`,
      '---',
      '',
      'Complete the task carefully.',
    ].join('\n'),
  );
}

async function writeSkill(workDir: string, name: string, lines: readonly string[]): Promise<void> {
  const dir = join(workDir, '.omnicode', 'skills', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), lines.join('\n'));
}

async function writeLegacyUserSkill(
  userHomeDir: string,
  name: string,
  description: string,
): Promise<void> {
  await writeSkillFile(join(userHomeDir, '.omnicode', 'skills', name), name, description);
}

async function writeBrandUserSkill(
  brandHomeDir: string,
  name: string,
  description: string,
): Promise<void> {
  await writeSkillFile(join(brandHomeDir, 'skills', name), name, description);
}

async function writeSkillFile(dir: string, name: string, description: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    ['---', `name: ${name}`, `description: ${description}`, '---', '', `${description}.`].join(
      '\n',
    ),
  );
}
