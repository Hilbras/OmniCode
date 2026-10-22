import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

export type ConnectorKind = 'mcp' | 'plugin' | 'service';

export type ConnectorScope = 'user' | 'workspace';

export type ConnectorStatus =
  | 'active'
  | 'inactive'
  | 'needs-auth'
  | 'needs-trust'
  | 'not-configured'
  | 'unavailable'
  | 'expired'
  | 'error';

export type ConnectorCapability = 'tools' | 'skills' | 'commands' | 'hooks';

export type ConnectorAction =
  | 'open-mcp'
  | 'open-plugins'
  | 'connect-github'
  | 'disconnect-github'
  | 'connect-vercel'
  | 'disconnect-vercel';

export interface ConnectorEntry {
  readonly id: string;
  readonly kind: ConnectorKind;
  readonly name: string;
  readonly description?: string;
  readonly scope: ConnectorScope;
  readonly status: ConnectorStatus;
  readonly capabilities: readonly ConnectorCapability[];
  readonly actions: readonly ConnectorAction[];
}

export interface ConnectorQuery {
  readonly cwd?: string;
  readonly workspaceTrusted?: boolean;
}

export interface IConnectorCatalogService {
  readonly _serviceBrand: undefined;

  listConnectors(query?: ConnectorQuery): Promise<readonly ConnectorEntry[]>;
}

export const IConnectorCatalogService: ServiceIdentifier<IConnectorCatalogService> =
  createDecorator<IConnectorCatalogService>('connectorCatalogService');
