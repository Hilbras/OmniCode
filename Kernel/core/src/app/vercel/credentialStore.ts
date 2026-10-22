import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';

import type { VercelCredential } from './types';

export interface IVercelCredentialStore {
  readonly _serviceBrand: undefined;

  read(): Promise<VercelCredential | undefined>;
  write(credential: VercelCredential): Promise<void>;
  clear(): Promise<void>;
}

export const IVercelCredentialStore: ServiceIdentifier<IVercelCredentialStore> =
  createDecorator<IVercelCredentialStore>('vercelCredentialStore');

export const VERCEL_CREDENTIALS_SCOPE = 'credentials/vercel';
export const VERCEL_CREDENTIAL_KEY = 'account';

export class VercelCredentialStore implements IVercelCredentialStore {
  declare readonly _serviceBrand: undefined;

  constructor(@IAtomicDocumentStore private readonly docs: IAtomicDocumentStore) {}

  async read(): Promise<VercelCredential | undefined> {
    try {
      return await this.docs.get<VercelCredential>(VERCEL_CREDENTIALS_SCOPE, VERCEL_CREDENTIAL_KEY);
    } catch {
      return undefined;
    }
  }

  write(credential: VercelCredential): Promise<void> {
    return this.docs.set(VERCEL_CREDENTIALS_SCOPE, VERCEL_CREDENTIAL_KEY, credential);
  }

  clear(): Promise<void> {
    return this.docs.delete(VERCEL_CREDENTIALS_SCOPE, VERCEL_CREDENTIAL_KEY);
  }
}

registerScopedService(
  LifecycleScope.App,
  IVercelCredentialStore,
  VercelCredentialStore,
  ScopeActivation.OnDemand,
  'vercel',
);
