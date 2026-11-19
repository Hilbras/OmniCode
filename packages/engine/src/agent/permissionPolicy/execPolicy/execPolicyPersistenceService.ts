import { Disposable } from '@hilbras/omnicode-base/di/lifecycle';
import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { ILogService, type ILogger } from '@hilbras/omnicode-base/log/log';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { IEventBus } from '#/app/event/eventBus';

import { PermissionApprovalResolved } from '#/agent/toolApproval/toolApprovalService';

import { IExecPolicyWriterService } from './execPolicyWriter';

export interface IExecPolicyPersistenceService {
  readonly _serviceBrand: undefined;
}

export const IExecPolicyPersistenceService = createDecorator<IExecPolicyPersistenceService>(
  'execPolicyPersistenceService',
);

export class ExecPolicyPersistenceService
  extends Disposable
  implements IExecPolicyPersistenceService
{
  declare readonly _serviceBrand: undefined;
  private readonly log: ILogger;

  constructor(
    @IEventBus eventBus: IEventBus,
    @IExecPolicyWriterService private readonly writer: IExecPolicyWriterService,
    @ILogService log: ILogService,
  ) {
    super();
    this.log = log.child({ permissionPolicy: 'execPolicyPersistence' });
    this._register(
      eventBus.subscribe(PermissionApprovalResolved, (event) => {
        if (event.decision !== 'approved' || event.scope !== 'always') return;
        if (event.display.kind !== 'command') return;
        void this.persist(event.display.command, event.display.suggestedRule);
      }),
    );
  }

  private async persist(
    command: string,
    suggested: { readonly prefix: readonly string[]; readonly display: string } | undefined,
  ): Promise<void> {
    try {
      const result = await this.writer.appendAllowPrefix(command, suggested);
      if (!result.ok) this.log.info('exec policy rule not persisted', { reason: result.reason });
    } catch (error) {
      this.log.info('exec policy rule not persisted', {
        reason: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IExecPolicyPersistenceService,
  ExecPolicyPersistenceService,
  ScopeActivation.OnScopeCreated,
  'execPolicyPersistence',
);
