import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

import type {
  GitHubConnectResult,
  GitHubConnectionStatus,
  GitHubDeviceFlowStart,
  GitHubDisconnectResult,
  GitHubIssue,
  GitHubPullRequest,
  GitHubPullRequestSummary,
  GitHubRepository,
  GitHubUser,
  GitHubWorkflowRun,
} from './types';

export interface GitHubListOptions {
  readonly limit?: number;
}

export interface GitHubIssueListOptions extends GitHubListOptions {
  readonly state?: 'open' | 'closed' | 'all';
}

export interface GitHubPullRequestListOptions extends GitHubListOptions {
  readonly state?: 'open' | 'closed' | 'all';
}

export interface GitHubDeviceFlowPollOptions {
  readonly signal?: AbortSignal;
}

export interface IGitHubService {
  readonly _serviceBrand: undefined;

  status(): Promise<GitHubConnectionStatus>;
  startDeviceFlow(): Promise<GitHubDeviceFlowStart>;
  pollDeviceFlow(
    flowId: string,
    options?: GitHubDeviceFlowPollOptions,
  ): Promise<GitHubConnectResult>;
  disconnect(): Promise<GitHubDisconnectResult>;
  getAuthenticatedUser(): Promise<GitHubUser>;
  listRepositories(options?: GitHubListOptions): Promise<GitHubRepository[]>;
  listIssues(repository: string, options?: GitHubIssueListOptions): Promise<GitHubIssue[]>;
  listPullRequests(
    repository: string,
    options?: GitHubPullRequestListOptions,
  ): Promise<GitHubPullRequestSummary[]>;
  getPullRequest(repository: string, number: number): Promise<GitHubPullRequest>;
  listWorkflowRuns(repository: string, options?: GitHubListOptions): Promise<GitHubWorkflowRun[]>;
}

export const IGitHubService: ServiceIdentifier<IGitHubService> =
  createDecorator<IGitHubService>('githubService');
