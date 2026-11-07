export type VercelFetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export type VercelSleep = (delayMs: number, signal?: AbortSignal) => Promise<void>;

export interface VercelClientOptions {
  readonly fetchImpl?: VercelFetchImpl;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly sleep?: VercelSleep;
}

export type VercelScopeType = 'user' | 'team';

export interface VercelAccount {
  readonly id: string;
  readonly type: VercelScopeType;
  readonly slug?: string;
  readonly name?: string;
}

export interface VercelScope {
  readonly type: VercelScopeType;
  readonly id: string;
  readonly slug?: string;
  readonly name?: string;
}

export interface VercelCredential {
  readonly accessToken: string;
  readonly userId: string;
  readonly username: string;
  readonly email?: string;
  readonly scope: VercelScope;
  readonly accounts: readonly VercelAccount[];
  readonly scopes: readonly string[];
  readonly expiresAt?: number;
}

export interface VercelConnectionStatus {
  readonly configured: boolean;
  readonly connected: boolean;
  readonly accountId?: string;
  readonly accountType?: VercelScopeType;
  readonly accountSlug?: string;
  readonly accountName?: string;
  readonly username?: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: number;
  readonly expired: boolean;
}

export interface VercelConnectResult {
  readonly connected: boolean;
  readonly status: VercelConnectionStatus;
  readonly message: string;
}

export interface VercelDisconnectResult {
  readonly disconnected: boolean;
  readonly message: string;
}

export interface VercelUser {
  readonly id: string;
  readonly username: string;
  readonly email?: string;
  readonly name?: string;
  readonly defaultTeamId?: string;
}

export interface VercelTeam {
  readonly id: string;
  readonly slug: string;
  readonly name?: string;
}

export interface VercelProject {
  readonly id: string;
  readonly name: string;
  readonly accountId: string;
  readonly framework?: string;
  readonly nodeVersion?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly url: string;
}

export interface VercelDeployment {
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly accountId: string;
  readonly target: string;
  readonly state: string;
  readonly url: string;
  readonly alias: readonly string[];
  readonly createdAt?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly source?: string;
}

export interface VercelDeploymentEvent {
  readonly type: string;
  readonly text: string;
  readonly level?: string;
  readonly createdAt?: number;
}
