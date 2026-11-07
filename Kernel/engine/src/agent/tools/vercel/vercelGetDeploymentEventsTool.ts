import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import { IFlagService } from '#/app/flag/flag';
import { VERCEL_FLAG_ID } from '#/app/vercel/flag';
import { IVercelService } from '#/app/vercel/vercel';
import { toInputJsonSchema } from '#/tool/input-schema';
import { matchesGlobRuleSubject } from '#/tool/rule-match';
import { type ToolExecution } from '#/tool/toolContract';

import VERCEL_GET_DEPLOYMENT_EVENTS_DESCRIPTION from './vercel-get-deployment-events.md?raw';
import {
  formatVercelDeploymentEvents,
  VERCEL_TOOL_DOMAIN,
  vercelFlagEnabled,
  vercelFlagOffMessage,
  vercelToolErrorMessage,
  type VercelGetDeploymentEventsInput,
  IVercelGetDeploymentEventsTool,
  VercelGetDeploymentEventsInputSchema,
} from './vercelTools';

export class VercelGetDeploymentEventsTool implements IVercelGetDeploymentEventsTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'VercelGetDeploymentEvents' as const;
  readonly description = VERCEL_GET_DEPLOYMENT_EVENTS_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(
    VercelGetDeploymentEventsInputSchema,
  );

  constructor(
    @IVercelService private readonly vercel: IVercelService,
    @IFlagService private readonly flags: IFlagService,
  ) {}

  resolveExecution(args: VercelGetDeploymentEventsInput): ToolExecution {
    return {
      description: `Reading the Vercel build logs of ${args.deployment}`,
      approvalRule: this.name,
      matchesRule: (ruleArgs) =>
        matchesGlobRuleSubject(ruleArgs, `vercel:deployment:${args.deployment}`),
      execute: async () => {
        if (!vercelFlagEnabled(this.flags)) {
          return { output: vercelFlagOffMessage(), isError: true };
        }
        try {
          const events = await this.vercel.getDeploymentEvents(args.deployment, {
            limit: args.limit ?? 30,
          });
          return { output: formatVercelDeploymentEvents(events), isError: false };
        } catch (error) {
          return { output: vercelToolErrorMessage(error), isError: true };
        }
      },
    };
  }
}

registerAgentToolService(IVercelGetDeploymentEventsTool, VercelGetDeploymentEventsTool, {
  name: 'VercelGetDeploymentEvents',
  domain: VERCEL_TOOL_DOMAIN,
  when: (accessor) => accessor.get(IFlagService).enabled(VERCEL_FLAG_ID),
});
