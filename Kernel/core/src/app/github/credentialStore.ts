import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';

import type { GitHubCredential } from './types';

export interface IGitHubCredentialStore {
  readonly _serviceBrand: undefined;

  read(): Promise<GitHubCredential | undefined>;
  write(credential: GitHubCredential): Promise<void>;
  clear(): Promise<void>;
}

export const IGitHubCredentialStore: ServiceIdentifier<IGitHubCredentialStore> =
  createDecorator<IGitHubCredentialStore>('githubCredentialStore');

export const GITHUB_CREDENTIALS_SCOPE = 'credentials/github';
export const GITHUB_CREDENTIAL_KEY = 'account';

export class GitHubCredentialStore implements IGitHubCredentialStore {
  declare readonly _serviceBrand: undefined;

  constructor(@IAtomicDocumentStore private readonly docs: IAtomicDocumentStore) {}

  async read(): Promise<GitHubCredential | undefined> {
    try {
      return await this.docs.get<GitHubCredential>(GITHUB_CREDENTIALS_SCOPE, GITHUB_CREDENTIAL_KEY);
    } catch {
      return undefined;
    }
  }

  write(credential: GitHubCredential): Promise<void> {
    return this.docs.set(GITHUB_CREDENTIALS_SCOPE, GITHUB_CREDENTIAL_KEY, credential);
  }

  clear(): Promise<void> {
    return this.docs.delete(GITHUB_CREDENTIALS_SCOPE, GITHUB_CREDENTIAL_KEY);
  }
}

registerScopedService(
  LifecycleScope.App,
  IGitHubCredentialStore,
  GitHubCredentialStore,
  ScopeActivation.OnDemand,
  'github',
);
