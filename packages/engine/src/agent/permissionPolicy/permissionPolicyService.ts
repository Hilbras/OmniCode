import { IInstantiationService } from "@hilbras/omnicode-base/di/instantiation";
import { Service } from "@hilbras/omnicode-base/di/service";
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IConfigService } from '#/app/config/config';
import { EXEC_POLICY_SECTION, type ExecPolicyConfig } from '#/agent/permissionPolicy/execPolicy/configSection';
import { loadExecPolicyFromConfig } from '#/agent/permissionPolicy/execPolicy/execPolicyLoader';
import type { ResolvedToolExecutionHookContext } from '#/agent/toolExecutor/toolHooks';
import { AutoModeAskUserQuestionDenyPermissionPolicyService } from '#/agent/permissionPolicy/policies/auto-mode-ask-user-question-deny';
import { AutoModeClassifierPermissionPolicyService } from '#/agent/permissionPolicy/policies/auto-mode-classifier';
import { DangerousCommandAskPermissionPolicyService } from '#/agent/permissionPolicy/policies/dangerous-command-ask';
import { DefaultToolApprovePermissionPolicyService } from '#/agent/permissionPolicy/policies/default-tool-approve';
import { ExecPolicyPermissionPolicyService } from '#/agent/permissionPolicy/policies/exec-policy-rule';
import { FallbackAskPermissionPolicyService } from '#/agent/permissionPolicy/policies/fallback-ask';
import { GitControlPathAccessAskPermissionPolicyService } from '#/agent/permissionPolicy/policies/git-control-path-access-ask';
import { GitCwdWriteApprovePermissionPolicyService } from '#/agent/permissionPolicy/policies/git-cwd-write-approve';
import { SensitiveFileAccessAskPermissionPolicyService } from '#/agent/permissionPolicy/policies/sensitive-file-access-ask';
import { SessionApprovalHistoryPermissionPolicyService } from '#/agent/permissionPolicy/policies/session-approval-history';
import { UserConfiguredAllowPermissionPolicyService } from '#/agent/permissionPolicy/policies/user-configured-allow';
import { UserConfiguredAskPermissionPolicyService } from '#/agent/permissionPolicy/policies/user-configured-ask';
import { UserConfiguredDenyPermissionPolicyService } from '#/agent/permissionPolicy/policies/user-configured-deny';
import { YoloModeApprovePermissionPolicyService } from '#/agent/permissionPolicy/policies/yolo-mode-approve';
import {
  IAgentPermissionPolicyService,
  type PermissionPolicyEvaluation,
} from './permissionPolicy';
import type { PermissionPolicy } from "./types";
import type { ExecPolicy } from '#/agent/permissionPolicy/execPolicy/execPolicy';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';

export class AgentPermissionPolicyService
  extends Service
  implements IAgentPermissionPolicyService
{
  declare readonly _serviceBrand: undefined;

  private readonly policies: readonly PermissionPolicy[];
  private readonly execPolicy: ExecPolicyPermissionPolicyService;

  constructor(
    @IInstantiationService private readonly instantiation: IInstantiationService,
    @IBootstrapService bootstrap: IBootstrapService,
    @IConfigService config: IConfigService,
  ) {
    super();
    this.execPolicy = this.instantiation.createInstance(ExecPolicyPermissionPolicyService);
    this.policies = [
      this.instantiation.createInstance(AutoModeAskUserQuestionDenyPermissionPolicyService),
      this.instantiation.createInstance(UserConfiguredDenyPermissionPolicyService),
      ...(bootstrap.args.nonInteractive
        ? []
        : [this.instantiation.createInstance(DangerousCommandAskPermissionPolicyService)]),
      this.instantiation.createInstance(SensitiveFileAccessAskPermissionPolicyService),
      this.instantiation.createInstance(GitControlPathAccessAskPermissionPolicyService),
      this.execPolicy,
      this.instantiation.createInstance(AutoModeClassifierPermissionPolicyService),
      this.instantiation.createInstance(SessionApprovalHistoryPermissionPolicyService),
      this.instantiation.createInstance(UserConfiguredAskPermissionPolicyService),
      this.instantiation.createInstance(UserConfiguredAllowPermissionPolicyService),
      this.instantiation.createInstance(YoloModeApprovePermissionPolicyService),
      this.instantiation.createInstance(DefaultToolApprovePermissionPolicyService),
      this.instantiation.createInstance(GitCwdWriteApprovePermissionPolicyService),
      this.instantiation.createInstance(FallbackAskPermissionPolicyService),
    ];
    this.composeExecPolicy(bootstrap, config);
  }

  /**
   * Composition of the exec-policy pass: the `execPolicy` config section names
   * the policy file, and the file is loaded here so a load failure (including a
   * failing or shadowed example) fails agent creation as a `config.invalid`
   * error instead of silently running with no exec policy.
   */
  private composeExecPolicy(bootstrap: IBootstrapService, config: IConfigService): void {
    const configured = config.get<ExecPolicyConfig | undefined>(EXEC_POLICY_SECTION);
    const configuredPath = typeof configured?.path === 'string' ? configured.path : undefined;
    if (configuredPath === undefined) return;
    this.setExecPolicy(loadExecPolicyFromConfig(configuredPath, bootstrap.homeDir, bootstrap.osHomeDir));
  }

  /** Installs or clears the exec policy used by the rule pass in the chain. */
  setExecPolicy(policy: ExecPolicy | undefined): void {
    this.execPolicy.setPolicy(policy);
  }

  async evaluate(
    context: ResolvedToolExecutionHookContext,
  ): Promise<PermissionPolicyEvaluation | undefined> {
    for (const policy of this.policies) {
      const result = await policy.evaluate(context);
      if (result !== undefined) return { policyName: policy.name, result };
    }
    return undefined;
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentPermissionPolicyService,
  AgentPermissionPolicyService,
  ScopeActivation.OnScopeCreated,
  'permissionPolicy',
);
