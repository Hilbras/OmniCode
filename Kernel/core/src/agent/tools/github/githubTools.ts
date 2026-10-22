import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { IFlagService } from '#/app/flag/flag';
import { isGitHubError, redactGitHubSecrets } from '#/app/github/errors';
import { GITHUB_FLAG_ID } from '#/app/github/flag';
import type {
  GitHubIssue,
  GitHubPullRequest,
  GitHubPullRequestSummary,
  GitHubRepository,
  GitHubUser,
  GitHubWorkflowRun,
} from '#/app/github/types';
import type { AgentTool } from '#/tool/toolContract';

export const GITHUB_TOOL_DOMAIN = 'github';

export const GitHubRepositoryInputSchema = z
  .string()
  .min(3)
  .describe('Repository in the "owner/name" form, for example "octocat/hello-world".');

export const GitHubListRepositoriesInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(30)
    .describe('Maximum number of repositories to return.')
    .optional(),
});
export type GitHubListRepositoriesInput = z.infer<typeof GitHubListRepositoriesInputSchema>;
export interface IGitHubListRepositoriesTool extends AgentTool<GitHubListRepositoriesInput> {
  readonly _serviceBrand: undefined;
}
export const IGitHubListRepositoriesTool = createDecorator<IGitHubListRepositoriesTool>(
  'githubListRepositoriesTool',
);

export const GitHubListIssuesInputSchema = z.object({
  repository: GitHubRepositoryInputSchema,
  state: z
    .enum(['open', 'closed', 'all'])
    .default('open')
    .describe('Which issues to return.')
    .optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(30)
    .describe('Maximum number of issues to return.')
    .optional(),
});
export type GitHubListIssuesInput = z.infer<typeof GitHubListIssuesInputSchema>;
export interface IGitHubListIssuesTool extends AgentTool<GitHubListIssuesInput> {
  readonly _serviceBrand: undefined;
}
export const IGitHubListIssuesTool = createDecorator<IGitHubListIssuesTool>('githubListIssuesTool');

export const GitHubListPullRequestsInputSchema = z.object({
  repository: GitHubRepositoryInputSchema,
  state: z
    .enum(['open', 'closed', 'all'])
    .default('open')
    .describe('Which pull requests to return.')
    .optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(30)
    .describe('Maximum number of pull requests to return.')
    .optional(),
});
export type GitHubListPullRequestsInput = z.infer<typeof GitHubListPullRequestsInputSchema>;
export interface IGitHubListPullRequestsTool extends AgentTool<GitHubListPullRequestsInput> {
  readonly _serviceBrand: undefined;
}
export const IGitHubListPullRequestsTool = createDecorator<IGitHubListPullRequestsTool>(
  'githubListPullRequestsTool',
);

export const GitHubGetPullRequestInputSchema = z.object({
  repository: GitHubRepositoryInputSchema,
  number: z.number().int().positive().describe('Pull request number, for example 42.'),
});
export type GitHubGetPullRequestInput = z.infer<typeof GitHubGetPullRequestInputSchema>;
export interface IGitHubGetPullRequestTool extends AgentTool<GitHubGetPullRequestInput> {
  readonly _serviceBrand: undefined;
}
export const IGitHubGetPullRequestTool = createDecorator<IGitHubGetPullRequestTool>(
  'githubGetPullRequestTool',
);

export const GitHubListWorkflowRunsInputSchema = z.object({
  repository: GitHubRepositoryInputSchema,
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(30)
    .describe('Maximum number of workflow runs to return.')
    .optional(),
});
export type GitHubListWorkflowRunsInput = z.infer<typeof GitHubListWorkflowRunsInputSchema>;
export interface IGitHubListWorkflowRunsTool extends AgentTool<GitHubListWorkflowRunsInput> {
  readonly _serviceBrand: undefined;
}
export const IGitHubListWorkflowRunsTool = createDecorator<IGitHubListWorkflowRunsTool>(
  'githubListWorkflowRunsTool',
);

export const GitHubGetAuthenticatedUserInputSchema = z.object({});
export type GitHubGetAuthenticatedUserInput = z.infer<typeof GitHubGetAuthenticatedUserInputSchema>;
export interface IGitHubGetAuthenticatedUserTool extends AgentTool<GitHubGetAuthenticatedUserInput> {
  readonly _serviceBrand: undefined;
}
export const IGitHubGetAuthenticatedUserTool = createDecorator<IGitHubGetAuthenticatedUserTool>(
  'githubGetAuthenticatedUserTool',
);

export function githubFlagOffMessage(): string {
  return `The ${GITHUB_FLAG_ID} experimental flag is off, so GitHub tools are unavailable.`;
}

export function githubToolErrorMessage(error: unknown): string {
  if (isGitHubError(error)) {
    return `${error.code}: ${redactGitHubSecrets(error.message)}`;
  }
  return redactGitHubSecrets(error instanceof Error ? error.message : String(error));
}

export function githubFlagEnabled(flags: IFlagService): boolean {
  return flags.enabled(GITHUB_FLAG_ID);
}

export function formatGitHubUser(user: GitHubUser): string {
  return [
    `login: ${user.login}`,
    `id: ${String(user.id)}`,
    `name: ${user.name ?? 'unknown'}`,
    `type: ${user.type ?? 'unknown'}`,
    `url: ${user.htmlUrl}`,
  ].join('\n');
}

export function formatGitHubRepository(repository: GitHubRepository): string {
  return [
    `repository: ${repository.fullName}`,
    `visibility: ${repository.private ? 'private' : 'public'}`,
    `default_branch: ${repository.defaultBranch ?? 'unknown'}`,
    `url: ${repository.htmlUrl}`,
    `description: ${repository.description ?? 'none'}`,
  ].join('\n');
}

export function formatGitHubRepositories(repositories: readonly GitHubRepository[]): string {
  if (repositories.length === 0) return 'repositories: 0\nNo repositories found.';
  return [
    `repositories: ${String(repositories.length)}`,
    ...repositories.map(formatGitHubRepository),
  ].join('\n');
}

export function formatGitHubIssue(issue: GitHubIssue): string {
  return [
    `issue: ${String(issue.number)}`,
    `title: ${issue.title}`,
    `state: ${issue.state}`,
    `author: ${issue.author}`,
    `labels: ${issue.labels.length === 0 ? 'none' : issue.labels.join(', ')}`,
    `is_pull_request: ${issue.isPullRequest ? 'true' : 'false'}`,
    `created_at: ${issue.createdAt}`,
    `updated_at: ${issue.updatedAt}`,
    `url: ${issue.htmlUrl}`,
  ].join('\n');
}

export function formatGitHubIssues(issues: readonly GitHubIssue[]): string {
  if (issues.length === 0) return 'issues: 0\nNo issues found.';
  return ['issues: ' + String(issues.length), ...issues.map(formatGitHubIssue)].join('\n');
}

export function formatGitHubPullRequestSummary(pullRequest: GitHubPullRequestSummary): string {
  return [
    `pull_request: ${String(pullRequest.number)}`,
    `title: ${pullRequest.title}`,
    `state: ${pullRequest.state}`,
    `draft: ${pullRequest.draft ? 'true' : 'false'}`,
    `author: ${pullRequest.author}`,
    `head: ${pullRequest.headRef}`,
    `base: ${pullRequest.baseRef}`,
    `created_at: ${pullRequest.createdAt}`,
    `updated_at: ${pullRequest.updatedAt}`,
    `url: ${pullRequest.htmlUrl}`,
  ].join('\n');
}

export function formatGitHubPullRequests(
  pullRequests: readonly GitHubPullRequestSummary[],
): string {
  if (pullRequests.length === 0) return 'pull_requests: 0\nNo pull requests found.';
  return [
    `pull_requests: ${String(pullRequests.length)}`,
    ...pullRequests.map(formatGitHubPullRequestSummary),
  ].join('\n');
}

export function formatGitHubPullRequest(pullRequest: GitHubPullRequest): string {
  return [
    formatGitHubPullRequestSummary(pullRequest),
    `merged: ${pullRequest.merged ? 'true' : 'false'}`,
    `mergeable: ${pullRequest.mergeable === undefined ? 'unknown' : String(pullRequest.mergeable)}`,
    `additions: ${String(pullRequest.additions)}`,
    `deletions: ${String(pullRequest.deletions)}`,
    `changed_files: ${String(pullRequest.changedFiles)}`,
    `commits: ${String(pullRequest.commits)}`,
  ].join('\n');
}

export function formatGitHubWorkflowRun(run: GitHubWorkflowRun): string {
  return [
    `run: ${String(run.id)}`,
    `name: ${run.name}`,
    `status: ${run.status}`,
    `conclusion: ${run.conclusion ?? 'none'}`,
    `event: ${run.event}`,
    `branch: ${run.headBranch}`,
    `head_sha: ${run.headSha}`,
    `created_at: ${run.createdAt}`,
    `updated_at: ${run.updatedAt}`,
    `url: ${run.htmlUrl}`,
  ].join('\n');
}

export function formatGitHubWorkflowRuns(runs: readonly GitHubWorkflowRun[]): string {
  if (runs.length === 0) return 'workflow_runs: 0\nNo workflow runs found.';
  return [`workflow_runs: ${String(runs.length)}`, ...runs.map(formatGitHubWorkflowRun)].join('\n');
}
