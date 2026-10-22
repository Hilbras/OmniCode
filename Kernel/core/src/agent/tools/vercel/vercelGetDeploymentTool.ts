import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import { IFlagService } from '#/app/flag/flag';
import { VERCEL_FLAG_ID } from '#/app/vercel/flag';
import { IVercelService } from '#/app/vercel/vercel';
import { toInputJsonSchema } from '#/tool/input-schema';
import { matchesGlobRuleSubject } from '#/tool/rule-match';
import { type ToolExecution } from '#/tool/toolContract';

import VERCEL_GET_DEPLOYMENT_DESCRIPTION from './vercel-get-deployment.md?raw';
import {
  formatVercelDeployment,
  VERCEL_TOOL_DOMAIN,
  vercelFlagEnabled,
  vercelFlagOffMessage,
  vercelToolErrorMessage,
  type VercelGetDeploymentInput,
  IVercelGetDeploymentTool,
  VercelGetDeploymentInputSchema,
} from './vercelTools';

export class VercelGetDeploymentTool implements IVercelGetDeploymentTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'VercelGetDeployment' as const;
  readonly description = VERCEL_GET_DEPLOYMENT_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(VercelGetDeploymentInputSchema);

  constructor(
    @IVercelService private readonly vercel: IVercelService,
    @IFlagService private readonly flags: IFlagService,
  ) {}

  resolveExecution(args: VercelGetDeploymentInput): ToolExecution {
    return {
      description: `Reading the Vercel deployment ${args.deployment}`,
      approvalRule: this.name,
      matchesRule: (ruleArgs) =>
        matchesGlobRuleSubject(ruleArgs, `vercel:deployment:${args.deployment}`),
      execute: async () => {
        if (!vercelFlagEnabled(this.flags)) {
          return { output: vercelFlagOffMessage(), isError: true };
        }
        try {
          const deployment = await this.vercel.getDeployment(args.deployment);
          return { output: formatVercelDeployment(deployment), isError: false };
        } catch (error) {
          return { output: vercelToolErrorMessage(error), isError: true };
        }
      },
    };
  }
}

registerAgentToolService(IVercelGetDeploymentTool, VercelGetDeploymentTool, {
  name: 'VercelGetDeployment',
  domain: VERCEL_TOOL_DOMAIN,
  when: (accessor) => accessor.get(IFlagService).enabled(VERCEL_FLAG_ID),
});
