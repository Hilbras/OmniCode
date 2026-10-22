import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import { IFlagService } from '#/app/flag/flag';
import { VERCEL_FLAG_ID } from '#/app/vercel/flag';
import { IVercelService } from '#/app/vercel/vercel';
import { toInputJsonSchema } from '#/tool/input-schema';
import { matchesGlobRuleSubject } from '#/tool/rule-match';
import { type ToolExecution } from '#/tool/toolContract';

import VERCEL_LIST_PROJECTS_DESCRIPTION from './vercel-list-projects.md?raw';
import {
  formatVercelProjects,
  VERCEL_TOOL_DOMAIN,
  vercelFlagEnabled,
  vercelFlagOffMessage,
  vercelToolErrorMessage,
  type VercelListProjectsInput,
  IVercelListProjectsTool,
  VercelListProjectsInputSchema,
} from './vercelTools';

export class VercelListProjectsTool implements IVercelListProjectsTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'VercelListProjects' as const;
  readonly description = VERCEL_LIST_PROJECTS_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(VercelListProjectsInputSchema);

  constructor(
    @IVercelService private readonly vercel: IVercelService,
    @IFlagService private readonly flags: IFlagService,
  ) {}

  resolveExecution(args: VercelListProjectsInput): ToolExecution {
    return {
      description: 'Listing Vercel projects',
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, 'vercel:projects'),
      execute: async () => {
        if (!vercelFlagEnabled(this.flags)) {
          return { output: vercelFlagOffMessage(), isError: true };
        }
        try {
          const projects = await this.vercel.listProjects({
            limit: args.limit ?? 30,
            search: args.search,
          });
          return { output: formatVercelProjects(projects), isError: false };
        } catch (error) {
          return { output: vercelToolErrorMessage(error), isError: true };
        }
      },
    };
  }
}

registerAgentToolService(IVercelListProjectsTool, VercelListProjectsTool, {
  name: 'VercelListProjects',
  domain: VERCEL_TOOL_DOMAIN,
  when: (accessor) => accessor.get(IFlagService).enabled(VERCEL_FLAG_ID),
});
