import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import type { IDisposable } from '@hilbras/omnicode-base/di/lifecycle';
import type { Event } from '@hilbras/omnicode-base/event';
import type { AgentProfileContribution } from './agentProfileContribution';

export interface AgentProfileRegistration {
  readonly sourceId: string;
  readonly priority: number;
  readonly workspaceKey?: string;
  readonly contribution: AgentProfileContribution;
}

export interface AgentProfileRegistryChange {
  readonly sourceId: string;
  readonly workspaceKey?: string;
}

export interface IAgentProfileRegistry {
  readonly _serviceBrand: undefined;

  readonly onDidChange: Event<AgentProfileRegistryChange>;

  entries(): readonly AgentProfileRegistration[];
  register(registration: AgentProfileRegistration): IDisposable;
}

export const IAgentProfileRegistry: ServiceIdentifier<IAgentProfileRegistry> =
  createDecorator<IAgentProfileRegistry>('agentProfileRegistry');
