import { describe, expect, it } from 'vitest';

import { getAgentToolContributions } from '#/agent/toolRegistry/toolContribution';
import { GitHubGetAuthenticatedUserTool } from '#/agent/tools/github/githubGetAuthenticatedUserTool';
import { GitHubGetPullRequestTool } from '#/agent/tools/github/githubGetPullRequestTool';
import { GitHubListIssuesTool } from '#/agent/tools/github/githubListIssuesTool';
import { GitHubListPullRequestsTool } from '#/agent/tools/github/githubListPullRequestsTool';
import { GitHubListRepositoriesTool } from '#/agent/tools/github/githubListRepositoriesTool';
import { GitHubListWorkflowRunsTool } from '#/agent/tools/github/githubListWorkflowRunsTool';
import { GitHubError } from '#/app/github/errors';
import type { IGitHubService } from '#/app/github/github';
import type {
  GitHubIssue,
  GitHubPullRequest,
  GitHubPullRequestSummary,
  GitHubRepository,
  GitHubUser,
  GitHubWorkflowRun,
} from '#/app/github/types';
import type { RunnableToolExecution, ToolExecution } from '#/tool/toolContract';

import { stubFlag } from '../../../app/flag/stubs';
import { executeTool } from '../../../tools/fixtures/execute-tool';

const SECRET_TOKEN = 'gho_0123456789abcdefghijklmnopqrstuvwxyz';

const REPOSITORY: GitHubRepository = {
  id: 1,
  name: 'hello-world',
  fullName: 'octocat/hello-world',
  private: false,
  htmlUrl: 'https://github.com/octocat/hello-world',
  defaultBranch: 'main',
  description: 'My first repository',
};

const USER: GitHubUser = {
  login: 'octocat',
  id: 583231,
  name: 'The Octocat',
  htmlUrl: 'https://github.com/octocat',
  type: 'User',
};

const ISSUE: GitHubIssue = {
  number: 7,
  title: 'Found a bug',
  state: 'open',
  htmlUrl: 'https://github.com/octocat/hello-world/issues/7',
  author: 'octocat',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  labels: ['bug'],
  isPullRequest: false,
};

const PULL_REQUEST: GitHubPullRequestSummary = {
  number: 3,
  title: 'Fix the readme',
  state: 'open',
  draft: false,
  htmlUrl: 'https://github.com/octocat/hello-world/pull/3',
  author: 'hubot',
  createdAt: '2024-02-01T00:00:00Z',
  updatedAt: '2024-02-02T00:00:00Z',
  headRef: 'fix-readme',
  baseRef: 'main',
};

const PULL_REQUEST_DETAIL: GitHubPullRequest = {
  ...PULL_REQUEST,
  body: 'Fixes the typo.',
  merged: false,
  mergeable: true,
  additions: 12,
  deletions: 4,
  changedFiles: 2,
  commits: 1,
};

const WORKFLOW_RUN: GitHubWorkflowRun = {
  id: 99,
  name: 'build',
  status: 'completed',
  conclusion: 'failure',
  event: 'push',
  htmlUrl: 'https://github.com/octocat/hello-world/actions/runs/99',
  headBranch: 'main',
  headSha: 'abc123',
  createdAt: '2024-03-01T00:00:00Z',
  updatedAt: '2024-03-01T00:05:00Z',
};

class FakeGitHubService implements IGitHubService {
  declare readonly _serviceBrand: undefined;

  readonly calls: string[] = [];
  failure: GitHubError | undefined;

  async status(): Promise<never> {
    this.calls.push('status');
    throw new Error('status is not used by the tools.');
  }

  async startDeviceFlow(): Promise<never> {
    this.calls.push('startDeviceFlow');
    throw new Error('startDeviceFlow is not used by the tools.');
  }

  async pollDeviceFlow(): Promise<never> {
    this.calls.push('pollDeviceFlow');
    throw new Error('pollDeviceFlow is not used by the tools.');
  }

  async disconnect(): Promise<never> {
    this.calls.push('disconnect');
    throw new Error('disconnect is not used by the tools.');
  }

  async getAuthenticatedUser(): Promise<GitHubUser> {
    this.calls.push('getAuthenticatedUser');
    this.throwFailure();
    return USER;
  }

  async listRepositories(): Promise<GitHubRepository[]> {
    this.calls.push('listRepositories');
    this.throwFailure();
    return [REPOSITORY];
  }

  async listIssues(): Promise<GitHubIssue[]> {
    this.calls.push('listIssues');
    this.throwFailure();
    return [ISSUE];
  }

  async listPullRequests(): Promise<GitHubPullRequestSummary[]> {
    this.calls.push('listPullRequests');
    this.throwFailure();
    return [PULL_REQUEST];
  }

  async getPullRequest(): Promise<GitHubPullRequest> {
    this.calls.push('getPullRequest');
    this.throwFailure();
    return PULL_REQUEST_DETAIL;
  }

  async listWorkflowRuns(): Promise<GitHubWorkflowRun[]> {
    this.calls.push('listWorkflowRuns');
    this.throwFailure();
    return [WORKFLOW_RUN];
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

function notConnected(): GitHubError {
  return new GitHubError(
    'github.not_connected',
    `GitHub is not connected. Token ${SECRET_TOKEN} must not be shown.`,
  );
}

describe('GitHub tools', () => {
  it('registers every tool with a name, a description, and an input schema', () => {
    const contributions = getAgentToolContributions();
    const names = contributions.map((contribution) => contribution.options.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'GitHubListRepositories',
        'GitHubListIssues',
        'GitHubListPullRequests',
        'GitHubGetPullRequest',
        'GitHubListWorkflowRuns',
        'GitHubGetAuthenticatedUser',
      ]),
    );

    const service = new FakeGitHubService();
    const flags = stubFlag(true);
    const tools = [
      new GitHubListRepositoriesTool(service, flags),
      new GitHubListIssuesTool(service, flags),
      new GitHubListPullRequestsTool(service, flags),
      new GitHubGetPullRequestTool(service, flags),
      new GitHubListWorkflowRunsTool(service, flags),
      new GitHubGetAuthenticatedUserTool(service, flags),
    ];

    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toMatchObject({ type: 'object', additionalProperties: false });
    }
  });

  it('lists repositories', async () => {
    const service = new FakeGitHubService();
    const tool = new GitHubListRepositoriesTool(service, stubFlag(true));

    const result = await executeTool(tool, context('github_repos', { limit: 10 }));

    expect(result.isError ?? false).toBe(false);
    const output = outputString(result);
    expect(output).toContain('repositories: 1');
    expect(output).toContain('repository: octocat/hello-world');
    expect(service.calls).toEqual(['listRepositories']);
  });

  it('lists issues', async () => {
    const service = new FakeGitHubService();
    const tool = new GitHubListIssuesTool(service, stubFlag(true));

    const result = await executeTool(
      tool,
      context('github_issues', { repository: 'octocat/hello-world', state: 'open' }),
    );

    expect(result.isError ?? false).toBe(false);
    const output = outputString(result);
    expect(output).toContain('issues: 1');
    expect(output).toContain('issue: 7');
    expect(output).toContain('title: Found a bug');
  });

  it('lists pull requests', async () => {
    const service = new FakeGitHubService();
    const tool = new GitHubListPullRequestsTool(service, stubFlag(true));

    const result = await executeTool(
      tool,
      context('github_pulls', { repository: 'octocat/hello-world' }),
    );

    expect(result.isError ?? false).toBe(false);
    const output = outputString(result);
    expect(output).toContain('pull_requests: 1');
    expect(output).toContain('pull_request: 3');
    expect(output).toContain('head: fix-readme');
  });

  it('reads one pull request', async () => {
    const service = new FakeGitHubService();
    const tool = new GitHubGetPullRequestTool(service, stubFlag(true));

    const result = await executeTool(
      tool,
      context('github_pull', { repository: 'octocat/hello-world', number: 3 }),
    );

    expect(result.isError ?? false).toBe(false);
    const output = outputString(result);
    expect(output).toContain('pull_request: 3');
    expect(output).toContain('additions: 12');
    expect(output).toContain('changed_files: 2');
  });

  it('lists workflow runs', async () => {
    const service = new FakeGitHubService();
    const tool = new GitHubListWorkflowRunsTool(service, stubFlag(true));

    const result = await executeTool(
      tool,
      context('github_runs', { repository: 'octocat/hello-world' }),
    );

    expect(result.isError ?? false).toBe(false);
    const output = outputString(result);
    expect(output).toContain('workflow_runs: 1');
    expect(output).toContain('conclusion: failure');
    expect(output).toContain('head_sha: abc123');
  });

  it('reads the authenticated account', async () => {
    const service = new FakeGitHubService();
    const tool = new GitHubGetAuthenticatedUserTool(service, stubFlag(true));

    const result = await executeTool(tool, context('github_user', {}));

    expect(result.isError ?? false).toBe(false);
    const output = outputString(result);
    expect(output).toContain('login: octocat');
    expect(output).toContain('url: https://github.com/octocat');
  });
});

describe('GitHub tools fail closed', () => {
  it('reports a missing authorization without calling GitHub', async () => {
    const service = new FakeGitHubService();
    service.failure = notConnected();
    const flags = stubFlag(true);

    const results = await Promise.all([
      executeTool(
        new GitHubListRepositoriesTool(service, flags),
        context('github_repos_offline', {}),
      ),
      executeTool(
        new GitHubListIssuesTool(service, flags),
        context('github_issues_offline', { repository: 'octocat/hello-world' }),
      ),
      executeTool(
        new GitHubListPullRequestsTool(service, flags),
        context('github_pulls_offline', { repository: 'octocat/hello-world' }),
      ),
      executeTool(
        new GitHubGetPullRequestTool(service, flags),
        context('github_pull_offline', { repository: 'octocat/hello-world', number: 3 }),
      ),
      executeTool(
        new GitHubListWorkflowRunsTool(service, flags),
        context('github_runs_offline', { repository: 'octocat/hello-world' }),
      ),
      executeTool(
        new GitHubGetAuthenticatedUserTool(service, flags),
        context('github_user_offline', {}),
      ),
    ]);

    for (const result of results) {
      expect(result.isError).toBe(true);
      const output = outputString(result);
      expect(output).toContain('github.not_connected');
      expect(output).not.toContain(SECRET_TOKEN);
    }
  });

  it('refuses to run while the experimental flag is off', async () => {
    const service = new FakeGitHubService();
    const flags = stubFlag(false);

    const result = await executeTool(
      new GitHubListRepositoriesTool(service, flags),
      context('github_repos_flag_off', {}),
    );

    expect(result.isError).toBe(true);
    expect(outputString(result)).toContain('github-connector experimental flag is off');
    expect(service.calls).toEqual([]);
  });
});

describe('GitHub tool approval rules', () => {
  it('matches the repository subject for repository scoped tools', () => {
    const service = new FakeGitHubService();
    const flags = stubFlag(true);
    const tool = new GitHubListIssuesTool(service, flags);

    const execution = runnableExecution(
      tool.resolveExecution({ repository: 'octocat/hello-world' }),
    );

    expect(execution.approvalRule).toBe('GitHubListIssues');
    expect(execution.matchesRule?.('github:octocat/*')).toBe(true);
    expect(execution.matchesRule?.('github:other/*')).toBe(false);
  });

  it('matches a fixed subject for the account tools', () => {
    const service = new FakeGitHubService();
    const flags = stubFlag(true);
    const repositories = runnableExecution(
      new GitHubListRepositoriesTool(service, flags).resolveExecution({}),
    );
    const user = runnableExecution(
      new GitHubGetAuthenticatedUserTool(service, flags).resolveExecution({}),
    );

    expect(repositories.matchesRule?.('github:repositories')).toBe(true);
    expect(repositories.matchesRule?.('github:user')).toBe(false);
    expect(user.matchesRule?.('github:user')).toBe(true);
  });
});
