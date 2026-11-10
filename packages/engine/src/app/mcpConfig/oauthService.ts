import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { ILogService } from '@hilbras/omnicode-base/log/log';
import { IAgentIdentity } from '#/app/agentIdentity/agentIdentity';
import { LifecycleScope } from '#/app/scopes';
import { McpOAuthService } from '#/mcpCore/oauth/service';

import { IMcpOAuthStore } from './oauthStore';

export const IMcpOAuthService: ServiceIdentifier<McpOAuthService> =
  createDecorator<McpOAuthService>('mcpOAuthService');

export class AppMcpOAuthService extends McpOAuthService {
  constructor(
    @IMcpOAuthStore store: IMcpOAuthStore,
    @IAgentIdentity identity: IAgentIdentity,
    @ILogService log: ILogService,
  ) {
    super({
      store,
      resolveClientName: () => identity.current().slug,
      log,
    });
    void identity
      .resolved()
      .then(() => {
        const sweep = this.sweepProactiveRefresh();
        this.trackBackgroundTask(sweep);
        return sweep;
      })
      .catch((error: unknown) => {
        log.warn(`mcp oauth proactive-refresh sweep failed: ${String(error)}`);
      });
  }
}

registerScopedService(
  LifecycleScope.App,
  IMcpOAuthService,
  AppMcpOAuthService,
  ScopeActivation.OnDemand,
  'mcpConfig',
);
