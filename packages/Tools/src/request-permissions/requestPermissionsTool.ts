import { toInputJsonSchema } from '@hilbras/omnicode-engine/tool/input-schema';
import type { ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';
import { registerAgentToolService } from '@hilbras/omnicode-engine/agent/toolRegistry/toolContribution';
import { IAgentProfileService } from '@hilbras/omnicode-engine/agent/profile/profile';
import { IAgentPermissionRulesService } from '@hilbras/omnicode-engine/agent/permissionRules/permissionRules';
import { planPermissionEscalation } from '@hilbras/omnicode-engine/agent/permissionRules/permissionEscalation';

import {
  IRequestPermissionsTool,
  RequestPermissionsInputSchema,
  type RequestPermissionsInput,
} from './request-permissions';

const DESCRIPTION =
  'Request additional permission rules for this session. Each rule is intersected with the ' +
  'active profile allowlist and refused if it would weaken an existing deny. Rules with ' +
  'project or user scope are out of band and cannot be set here.';

export class RequestPermissionsTool implements IRequestPermissionsTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'RequestPermissions';
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(RequestPermissionsInputSchema);

  constructor(
    @IAgentProfileService private readonly profile: IAgentProfileService,
    @IAgentPermissionRulesService private readonly rules: IAgentPermissionRulesService,
  ) {}

  resolveExecution(args: RequestPermissionsInput): ToolExecution {
    return {
      description: `Requesting ${String(args.rules.length)} permission rule(s)`,
      approvalRule: this.name,
      execute: async () => {
        const plan = planPermissionEscalation({
          requested: args.rules.map((rule) => ({
            decision: rule.decision,
            scope: rule.scope,
            pattern: rule.pattern,
            ...(rule.reason === undefined ? {} : { reason: rule.reason }),
          })),
          allowedTools: this.profile.getActiveToolNames() ?? [],
          existingRules: this.rules.rules,
        });
        if (plan.accepted.length > 0) this.rules.addRules(plan.accepted);

        const lines: string[] = [];
        if (plan.accepted.length > 0) {
          lines.push(`Granted: ${plan.accepted.map((rule) => rule.pattern).join(', ')}`);
        }
        for (const rejection of plan.rejected) {
          lines.push(`Refused ${rejection.rule.pattern}: ${rejection.reason} — ${rejection.detail}`);
        }
        return {
          output: lines.join('\n'),
          isError: plan.accepted.length === 0,
        };
      },
    };
  }
}

registerAgentToolService(IRequestPermissionsTool, RequestPermissionsTool, {
  name: 'RequestPermissions',
  domain: 'permissions',
});
