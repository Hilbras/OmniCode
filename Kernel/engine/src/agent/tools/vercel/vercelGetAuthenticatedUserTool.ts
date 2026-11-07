import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import { IFlagService } from '#/app/flag/flag';
import { VERCEL_FLAG_ID } from '#/app/vercel/flag';
import { IVercelService } from '#/app/vercel/vercel';
import { toInputJsonSchema } from '#/tool/input-schema';
import { matchesGlobRuleSubject } from '#/tool/rule-match';
import { type ToolExecution } from '#/tool/toolContract';

import VERCEL_GET_AUTHENTICATED_USER_DESCRIPTION from './vercel-get-authenticated-user.md?raw';
import {
  formatVercelUser,
  VERCEL_TOOL_DOMAIN,
  vercelFlagEnabled,
  vercelFlagOffMessage,
  vercelToolErrorMessage,
  type VercelGetAuthenticatedUserInput,
  IVercelGetAuthenticatedUserTool,
  VercelGetAuthenticatedUserInputSchema,
} from './vercelTools';

export class VercelGetAuthenticatedUserTool implements IVercelGetAuthenticatedUserTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'VercelGetAuthenticatedUser' as const;
  readonly description = VERCEL_GET_AUTHENTICATED_USER_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(
    VercelGetAuthenticatedUserInputSchema,
  );

  constructor(
    @IVercelService private readonly vercel: IVercelService,
    @IFlagService private readonly flags: IFlagService,
  ) {}

  resolveExecution(_args: VercelGetAuthenticatedUserInput): ToolExecution {
    return {
      description: 'Reading the authenticated Vercel account',
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, 'vercel:user'),
      execute: async () => {
        if (!vercelFlagEnabled(this.flags)) {
          return { output: vercelFlagOffMessage(), isError: true };
        }
        try {
          const user = await this.vercel.getAuthenticatedUser();
          return { output: formatVercelUser(user), isError: false };
        } catch (error) {
          return { output: vercelToolErrorMessage(error), isError: true };
        }
      },
    };
  }
}

registerAgentToolService(IVercelGetAuthenticatedUserTool, VercelGetAuthenticatedUserTool, {
  name: 'VercelGetAuthenticatedUser',
  domain: VERCEL_TOOL_DOMAIN,
  when: (accessor) => accessor.get(IFlagService).enabled(VERCEL_FLAG_ID),
});
