import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import type { IAgentScopeHandle } from '@hilbras/omnicode-base/di/scope';
import type { Event } from '@hilbras/omnicode-base/event';
import type { AgentContext } from '#/agent/agentContext/agentContext';
import type { PermissionMode } from '#/agent/permissionPolicy/types';
import type { BindAgentInput } from '#/agent/profile/profile';

export interface AgentScopeCreatedEvent {
  readonly context: AgentContext;
  readonly handle: IAgentScopeHandle;
}

export const MAIN_AGENT_ID = 'main';

export interface CreateAgentOptions {
  readonly agentId?: string;
  readonly binding?: BindAgentInput;
  readonly runtimeId?: string;
  readonly forkedFrom?: string;
  readonly labels?: Readonly<Record<string, string>>;
}

export interface ForkAgentOptions {
  readonly agentId?: string;
  readonly binding?: Partial<BindAgentInput>;
  readonly labels?: Readonly<Record<string, string>>;
}

export interface AgentListFilter {
  readonly prefix?: string;
}

export interface IAgentLifecycleService {
  readonly _serviceBrand: undefined;

  readonly onDidCreate: Event<AgentContext>;
  readonly onDidCreateScope: Event<AgentScopeCreatedEvent>;
  readonly onWillClose: Event<AgentContext>;
  readonly onDidClose: Event<AgentContext>;

  create(opts?: CreateAgentOptions): Promise<AgentContext>;

  fork(source: AgentContext, opts?: ForkAgentOptions): Promise<AgentContext>;

  get(agentId: string): AgentContext | undefined;
  list(filter?: AgentListFilter): readonly AgentContext[];
  broadcastPermissionMode(mode: PermissionMode): void;
  remove(agent: AgentContext): Promise<void>;

  handleOf(agentId: string): IAgentScopeHandle | undefined;

  adopt(handle: IAgentScopeHandle): AgentContext;
}

export const IAgentLifecycleService: ServiceIdentifier<IAgentLifecycleService> =
  createDecorator<IAgentLifecycleService>('agentLifecycleService');
