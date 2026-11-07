import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import { IFlagService } from '#/app/flag/flag';
import { VERCEL_FLAG_ID } from '#/app/vercel/flag';
import { IVercelService } from '#/app/vercel/vercel';
import { toInputJsonSchema } from '#/tool/input-schema';
import { matchesGlobRuleSubject } from '#/tool/rule-match';
import { type ToolExecution } from '#/tool/toolContract';

import VERCEL_LIST_DEPLOYMENTS_DESCRIPTION from './vercel-list-deployments.md?raw';
import {
  formatVercelDeployments,
  VERCEL_TOOL_DOMAIN,
  vercelFlagEnabled,
  vercelFlagOffMessage,
  vercelToolErrorMessage,
  type VercelListDeploymentsInput,
  IVercelListDeploymentsTool,
  VercelListDeploymentsInputSchema,
} from './vercelTools';

export class VercelListDeploymentsTool implements IVercelListDeploymentsTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'VercelListDeployments' as const;
  readonly description = VERCEL_LIST_DEPLOYMENTS_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(
    VercelListDeploymentsInputSchema,
  );

  constructor(
    @IVercelService private readonly vercel: IVercelService,
    @IFlagService private readonly flags: IFlagService,
  ) {}

  resolveExecution(args: VercelListDeploymentsInput): ToolExecution {
    return {
      description: `Listing Vercel deployments of ${args.project}`,
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, `vercel:${args.project}`),
      execute: async () => {
        if (!vercelFlagEnabled(this.flags)) {
          return { output: vercelFlagOffMessage(), isError: true };
        }
        try {
          const deployments = await this.vercel.listDeployments(args.project, {
            limit: args.limit ?? 30,
            target: args.target,
          });
          return { output: formatVercelDeployments(deployments), isError: false };
        } catch (error) {
          return { output: vercelToolErrorMessage(error), isError: true };
        }
      },
    };
  }
}

registerAgentToolService(IVercelListDeploymentsTool, VercelListDeploymentsTool, {
  name: 'VercelListDeployments',
  domain: VERCEL_TOOL_DOMAIN,
  when: (accessor) => accessor.get(IFlagService).enabled(VERCEL_FLAG_ID),
});
