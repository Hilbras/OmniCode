import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import type { Event } from '@hilbras/omnicode-base/event';
import type { RuntimeBinding } from '#/runtime/runtime';

export interface IAgentRuntimeBindingService {
  readonly _serviceBrand: undefined;
  readonly current: RuntimeBinding;
  readonly onDidChange: Event<RuntimeBinding>;
  get(): RuntimeBinding;
  set(binding: RuntimeBinding): RuntimeBinding;
  switch(runtimeId: string): RuntimeBinding;
}

export const IAgentRuntimeBindingService: ServiceIdentifier<IAgentRuntimeBindingService> = createDecorator<IAgentRuntimeBindingService>('agentRuntimeBindingService');

export interface IAgentRuntimeBindingSeed {
  readonly _serviceBrand: undefined;
  readonly binding: RuntimeBinding;
}

export const IAgentRuntimeBindingSeed: ServiceIdentifier<IAgentRuntimeBindingSeed> = createDecorator<IAgentRuntimeBindingSeed>('agentRuntimeBindingSeed');
