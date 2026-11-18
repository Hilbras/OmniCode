import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncDescriptor } from '@hilbras/omnicode-base/di/descriptors';
import { DisposableStore } from '@hilbras/omnicode-base/di/lifecycle';
import { TestInstantiationService } from '@hilbras/omnicode-base/di/test';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentInterruptionReminderService } from '#/agent/interruptionReminder/interruptionReminder';
import { AgentInterruptionReminderService } from '#/agent/interruptionReminder/interruptionReminderService';
import { TurnEnded } from '#/agent/loop/turnOps';
import { IAgentScopeContext, makeAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IAgentStateService } from '#/agent/state/agentState';
import { AgentStateService } from '#/agent/state/agentStateService';
import { IEventBus, type ISessionEventBus } from '#/app/event/eventBus';
import { EventBusService } from '#/app/event/eventBusService';
import { IAgentReminderService } from '#/features/reminder/reminderService';
import type { ReminderNotification } from '#/features/reminder/types';
import { IEventDispatcher } from '#/state/eventDispatcher';

import { createReminderStub } from '../../features/reminder/stubs';

describe('AgentInterruptionReminderService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let dispatch: ReturnType<typeof vi.fn>;
  let notify: ReturnType<typeof vi.fn<(content: string, notification: ReminderNotification) => void>>;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.set(IEventBus, new SyncDescriptor(EventBusService));
    ix.set(IAgentStateService, new AgentStateService());
    dispatch = vi.fn();
    notify = vi.fn();
    ix.stub(IEventDispatcher, { dispatch } as unknown as IEventDispatcher);
    const scope = makeAgentScopeContext({ agentId: 'main', agentScope: 'test' });
    ix.stub(IAgentScopeContext, scope);
    (ix.get(IEventBus) as ISessionEventBus).activateAgent(scope.agentContext);
    ix.stub(IAgentReminderService, createReminderStub({ notify }));
    ix.stub(IAgentContextMemoryService, { get: () => [] } as unknown as IAgentContextMemoryService);
    ix.set(
      IAgentInterruptionReminderService,
      new SyncDescriptor(AgentInterruptionReminderService),
    );
    ix.get(IAgentInterruptionReminderService);
  });

  afterEach(() => disposables.dispose());

  function publish(event: TurnEnded): void {
    const agentContext = ix.get(IAgentScopeContext).agentContext;
    ix.get(IEventBus).publish(event, agentContext);
  }

  it('records a durable interruption reminder when the user cancels a turn', () => {
    publish(
      new TurnEnded({
        agentId: 'main',
        turnId: 4,
        reason: 'cancelled',
        interruptReason: 'user_cancelled',
      }),
    );

    expect(notify).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [event] = dispatch.mock.calls[0] as [unknown];
    expect(event).toMatchObject({
      type: 'interruptionReminder.recorded',
      agentId: 'main',
      turnId: 4,
    });
  });

  it('does not record or notify for a completed turn', () => {
    publish(new TurnEnded({ agentId: 'main', turnId: 4, reason: 'completed' }));

    expect(notify).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
