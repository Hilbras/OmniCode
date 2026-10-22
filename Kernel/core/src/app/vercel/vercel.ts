import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

import type {
  VercelConnectResult,
  VercelConnectionStatus,
  VercelDeployment,
  VercelDeploymentEvent,
  VercelDisconnectResult,
  VercelProject,
  VercelUser,
} from './types';

export interface VercelListOptions {
  readonly limit?: number;
}

export interface VercelProjectListOptions extends VercelListOptions {
  readonly search?: string;
}

export interface VercelDeploymentListOptions extends VercelListOptions {
  readonly target?: 'production' | 'preview';
}

export interface IVercelService {
  readonly _serviceBrand: undefined;

  status(): Promise<VercelConnectionStatus>;
  connect(token?: string): Promise<VercelConnectResult>;
  disconnect(): Promise<VercelDisconnectResult>;
  getAuthenticatedUser(): Promise<VercelUser>;
  listProjects(options?: VercelProjectListOptions): Promise<VercelProject[]>;
  listDeployments(
    project: string,
    options?: VercelDeploymentListOptions,
  ): Promise<VercelDeployment[]>;
  getDeployment(deploymentId: string): Promise<VercelDeployment>;
  getDeploymentEvents(
    deploymentId: string,
    options?: VercelListOptions,
  ): Promise<VercelDeploymentEvent[]>;
}

export const IVercelService: ServiceIdentifier<IVercelService> =
  createDecorator<IVercelService>('vercelService');
