import { describe, expect, it } from 'vitest';

import { getAgentToolContributions } from '#/agent/toolRegistry/toolContribution';
import { VercelGetAuthenticatedUserTool } from '#/agent/tools/vercel/vercelGetAuthenticatedUserTool';
import { VercelGetDeploymentEventsTool } from '#/agent/tools/vercel/vercelGetDeploymentEventsTool';
import { VercelGetDeploymentTool } from '#/agent/tools/vercel/vercelGetDeploymentTool';
import { VercelListDeploymentsTool } from '#/agent/tools/vercel/vercelListDeploymentsTool';
import { VercelListProjectsTool } from '#/agent/tools/vercel/vercelListProjectsTool';
import { VercelError } from '#/app/vercel/errors';
import type {
  VercelDeployment,
  VercelDeploymentEvent,
  VercelProject,
  VercelUser,
} from '#/app/vercel/types';
import type { IVercelService } from '#/app/vercel/vercel';
import type { RunnableToolExecution, ToolExecution } from '#/tool/toolContract';

import { stubFlag } from '../../../app/flag/stubs';
import { executeTool } from '../../../tools/fixtures/execute-tool';

const SECRET_TOKEN = 'AbCdEf0123456789ghijklmn';

const USER: VercelUser = {
  id: 'user_1',
  username: 'ada',
  email: 'ada@example.test',
  name: 'Ada Lovelace',
  defaultTeamId: 'team_1',
};

const PROJECT: VercelProject = {
  id: 'prj_1',
  name: 'my-app',
  accountId: 'team_1',
  framework: 'nextjs',
  nodeVersion: '20',
  url: 'https://vercel.com/acme/my-app',
};

const DEPLOYMENT: VercelDeployment = {
  id: 'dpl_1',
  name: 'my-app',
  projectId: 'prj_1',
  accountId: 'team_1',
  target: 'production',
  state: 'ERROR',
  url: 'my-app-acme.vercel.app',
  alias: ['my-app-acme.vercel.app'],
  createdAt: 1_700_000_000_000,
  errorCode: 'BUILD_FAILED',
  errorMessage: 'Command "npm run build" failed.',
  source: 'cli',
};

const EVENT: VercelDeploymentEvent = {
  type: 'stderr',
  text: 'Error: build failed',
  level: 'error',
  createdAt: 1_700_000_005_000,
};

class FakeVercelService implements IVercelService {
  declare readonly _serviceBrand: undefined;

  readonly calls: string[] = [];
  failure: VercelError | undefined;

  async status(): Promise<never> {
    this.calls.push('status');
    throw new Error('status is not used by the tools.');
  }

  async connect(): Promise<never> {
    this.calls.push('connect');
    throw new Error('connect is not used by the tools.');
  }

  async disconnect(): Promise<never> {
    this.calls.push('disconnect');
    throw new Error('disconnect is not used by the tools.');
  }

  async getAuthenticatedUser(): Promise<VercelUser> {
    this.calls.push('getAuthenticatedUser');
    this.throwFailure();
    return USER;
  }

  async listProjects(): Promise<VercelProject[]> {
    this.calls.push('listProjects');
    this.throwFailure();
    return [PROJECT];
  }

  async listDeployments(): Promise<VercelDeployment[]> {
    this.calls.push('listDeployments');
    this.throwFailure();
    return [DEPLOYMENT];
  }

  async getDeployment(): Promise<VercelDeployment> {
    this.calls.push('getDeployment');
    this.throwFailure();
    return DEPLOYMENT;
  }

  async getDeploymentEvents(): Promise<VercelDeploymentEvent[]> {
    this.calls.push('getDeploymentEvents');
    this.throwFailure();
    return [EVENT];
  }

  private throwFailure(): void {
    if (this.failure !== undefined) throw this.failure;
  }
}

function context<Input>(toolCallId: string, args: Input) {
  return {
    turnId: 0,
    toolCallId,
    args,
    signal: new AbortController().signal,
  };
}

function outputString(result: { readonly output: string | readonly unknown[] }): string {
  expect(typeof result.output).toBe('string');
  return result.output as string;
}

function runnableExecution(execution: ToolExecution): RunnableToolExecution {
  if (execution.isError === true) {
    throw new TypeError('expected a runnable tool execution');
  }
  return execution;
}

function notConfigured(): VercelError {
  return new VercelError(
    'vercel.not_configured',
    `The Vercel connector is not configured. Token ${SECRET_TOKEN} must not be shown.`,
  );
}

describe('Vercel tools', () => {
  it('registers every tool with a name, a description, and an input schema', () => {
    const contributions = getAgentToolContributions();
    const names = contributions.map((contribution) => contribution.options.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'VercelListProjects',
        'VercelListDeployments',
        'VercelGetDeployment',
        'VercelGetDeploymentEvents',
        'VercelGetAuthenticatedUser',
      ]),
    );

    const service = new FakeVercelService();
    const flags = stubFlag(true);
    const tools = [
      new VercelListProjectsTool(service, flags),
      new VercelListDeploymentsTool(service, flags),
      new VercelGetDeploymentTool(service, flags),
      new VercelGetDeploymentEventsTool(service, flags),
      new VercelGetAuthenticatedUserTool(service, flags),
    ];

    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toMatchObject({ type: 'object', additionalProperties: false });
    }
  });

  it('lists projects', async () => {
    const service = new FakeVercelService();
    const tool = new VercelListProjectsTool(service, stubFlag(true));

    const result = await executeTool(tool, context('vercel_projects', { limit: 10 }));

    expect(result.isError ?? false).toBe(false);
    const output = outputString(result);
    expect(output).toContain('projects: 1');
    expect(output).toContain('project: my-app');
    expect(output).toContain('framework: nextjs');
    expect(service.calls).toEqual(['listProjects']);
  });

  it('lists deployments', async () => {
    const service = new FakeVercelService();
    const tool = new VercelListDeploymentsTool(service, stubFlag(true));

    const result = await executeTool(
      tool,
      context('vercel_deployments', { project: 'my-app', target: 'production' }),
    );

    expect(result.isError ?? false).toBe(false);
    const output = outputString(result);
    expect(output).toContain('deployments: 1');
    expect(output).toContain('deployment: dpl_1');
    expect(output).toContain('state: ERROR');
  });

  it('reads one deployment', async () => {
    const service = new FakeVercelService();
    const tool = new VercelGetDeploymentTool(service, stubFlag(true));

    const result = await executeTool(tool, context('vercel_deployment', { deployment: 'dpl_1' }));

    expect(result.isError ?? false).toBe(false);
    const output = outputString(result);
    expect(output).toContain('deployment: dpl_1');
    expect(output).toContain('error: BUILD_FAILED');
  });

  it('reads the build logs of a deployment', async () => {
    const service = new FakeVercelService();
    const tool = new VercelGetDeploymentEventsTool(service, stubFlag(true));

    const result = await executeTool(
      tool,
      context('vercel_deployment_events', { deployment: 'dpl_1' }),
    );

    expect(result.isError ?? false).toBe(false);
    const output = outputString(result);
    expect(output).toContain('events: 1');
    expect(output).toContain('text: Error: build failed');
  });

  it('reads the authenticated account', async () => {
    const service = new FakeVercelService();
    const tool = new VercelGetAuthenticatedUserTool(service, stubFlag(true));

    const result = await executeTool(tool, context('vercel_user', {}));

    expect(result.isError ?? false).toBe(false);
    const output = outputString(result);
    expect(output).toContain('username: ada');
    expect(output).toContain('default_team: team_1');
  });
});

describe('Vercel tools fail closed', () => {
  it('reports a missing token without calling Vercel', async () => {
    const service = new FakeVercelService();
    service.failure = notConfigured();
    const flags = stubFlag(true);

    const results = await Promise.all([
      executeTool(new VercelListProjectsTool(service, flags), context('vercel_projects_off', {})),
      executeTool(
        new VercelListDeploymentsTool(service, flags),
        context('vercel_deployments_off', { project: 'my-app' }),
      ),
      executeTool(
        new VercelGetDeploymentTool(service, flags),
        context('vercel_deployment_off', { deployment: 'dpl_1' }),
      ),
      executeTool(
        new VercelGetDeploymentEventsTool(service, flags),
        context('vercel_events_off', { deployment: 'dpl_1' }),
      ),
      executeTool(
        new VercelGetAuthenticatedUserTool(service, flags),
        context('vercel_user_off', {}),
      ),
    ]);

    for (const result of results) {
      expect(result.isError).toBe(true);
      const output = outputString(result);
      expect(output).toContain('vercel.not_configured');
      expect(output).not.toContain(SECRET_TOKEN);
    }
  });

  it('refuses to run while the experimental flag is off', async () => {
    const service = new FakeVercelService();
    const flags = stubFlag(false);

    const result = await executeTool(
      new VercelListProjectsTool(service, flags),
      context('vercel_projects_flag_off', {}),
    );

    expect(result.isError).toBe(true);
    expect(outputString(result)).toContain('vercel-connector experimental flag is off');
    expect(service.calls).toEqual([]);
  });
});

describe('Vercel tool approval rules', () => {
  it('matches the project subject for project scoped tools', () => {
    const service = new FakeVercelService();
    const flags = stubFlag(true);
    const tool = new VercelListDeploymentsTool(service, flags);

    const execution = runnableExecution(tool.resolveExecution({ project: 'my-app' }));

    expect(execution.approvalRule).toBe('VercelListDeployments');
    expect(execution.matchesRule?.('vercel:my-app')).toBe(true);
    expect(execution.matchesRule?.('vercel:other-app')).toBe(false);
  });

  it('matches the deployment subject for deployment scoped tools', () => {
    const service = new FakeVercelService();
    const flags = stubFlag(true);
    const tool = new VercelGetDeploymentTool(service, flags);

    const execution = runnableExecution(tool.resolveExecution({ deployment: 'dpl_1' }));

    expect(execution.approvalRule).toBe('VercelGetDeployment');
    expect(execution.matchesRule?.('vercel:deployment:dpl_1')).toBe(true);
    expect(execution.matchesRule?.('vercel:deployment:dpl_2')).toBe(false);
  });

  it('matches a fixed subject for the account tools', () => {
    const service = new FakeVercelService();
    const flags = stubFlag(true);
    const projects = runnableExecution(
      new VercelListProjectsTool(service, flags).resolveExecution({}),
    );
    const user = runnableExecution(
      new VercelGetAuthenticatedUserTool(service, flags).resolveExecution({}),
    );

    expect(projects.matchesRule?.('vercel:projects')).toBe(true);
    expect(projects.matchesRule?.('vercel:user')).toBe(false);
    expect(user.matchesRule?.('vercel:user')).toBe(true);
  });
});
