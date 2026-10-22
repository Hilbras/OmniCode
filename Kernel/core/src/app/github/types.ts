export type GitHubFetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export type GitHubSleep = (delayMs: number, signal?: AbortSignal) => Promise<void>;

export interface GitHubClientOptions {
  readonly fetchImpl?: GitHubFetchImpl;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly sleep?: GitHubSleep;
}

export type GitHubRepositoryAccess = 'none' | 'selected' | 'all';

export interface GitHubCredential {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenType: string;
  readonly expiresAt?: number;
  readonly scopes: readonly string[];
  readonly login: string;
  readonly repositoryAccess: GitHubRepositoryAccess;
  readonly repositories: readonly string[];
}

export interface GitHubConnectionStatus {
  readonly configured: boolean;
  readonly connected: boolean;
  readonly accountLogin?: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: number;
  readonly expired: boolean;
  readonly repositoryAccess: GitHubRepositoryAccess;
  readonly repositories: readonly string[];
}

export interface GitHubDeviceFlowStart {
  readonly flowId: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete?: string;
  readonly expiresInSeconds: number;
  readonly intervalSeconds: number;
  readonly scopes: readonly string[];
}

export interface GitHubDeviceCodeResponse {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete?: string;
  readonly expiresInSeconds: number;
  readonly intervalSeconds: number;
  readonly scopes: readonly string[];
}

export type GitHubConnectResult =
  | { readonly kind: 'pending' }
  | { readonly kind: 'slow_down' }
  | { readonly kind: 'connected'; readonly status: GitHubConnectionStatus };

export interface GitHubDisconnectResult {
  readonly disconnected: boolean;
  readonly providerRevoked: boolean;
  readonly message: string;
}

export interface GitHubUser {
  readonly login: string;
  readonly id: number;
  readonly name?: string;
  readonly htmlUrl: string;
  readonly type?: string;
}

export interface GitHubRepository {
  readonly id: number;
  readonly name: string;
  readonly fullName: string;
  readonly private: boolean;
  readonly htmlUrl: string;
  readonly defaultBranch?: string;
  readonly description?: string;
}

export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly htmlUrl: string;
  readonly author: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly labels: readonly string[];
  readonly isPullRequest: boolean;
}

export interface GitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly draft: boolean;
  readonly htmlUrl: string;
  readonly author: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly headRef: string;
  readonly baseRef: string;
}

export interface GitHubPullRequest extends GitHubPullRequestSummary {
  readonly body?: string;
  readonly merged: boolean;
  readonly mergeable?: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly commits: number;
}

export interface GitHubWorkflowRun {
  readonly id: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion?: string;
  readonly event: string;
  readonly htmlUrl: string;
  readonly headBranch: string;
  readonly headSha: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
