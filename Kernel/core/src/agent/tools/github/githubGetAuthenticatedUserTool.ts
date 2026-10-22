import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import { IFlagService } from '#/app/flag/flag';
import { GITHUB_FLAG_ID } from '#/app/github/flag';
import { IGitHubService } from '#/app/github/github';
import { toInputJsonSchema } from '#/tool/input-schema';
import { matchesGlobRuleSubject } from '#/tool/rule-match';
import { type ToolExecution } from '#/tool/toolContract';

import GITHUB_GET_AUTHENTICATED_USER_DESCRIPTION from './github-get-authenticated-user.md?raw';
import {
  formatGitHubUser,
  GITHUB_TOOL_DOMAIN,
  githubFlagEnabled,
  githubFlagOffMessage,
  githubToolErrorMessage,
  GitHubGetAuthenticatedUserInputSchema,
  type GitHubGetAuthenticatedUserInput,
  IGitHubGetAuthenticatedUserTool,
} from './githubTools';

export class GitHubGetAuthenticatedUserTool implements IGitHubGetAuthenticatedUserTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'GitHubGetAuthenticatedUser' as const;
  readonly description = GITHUB_GET_AUTHENTICATED_USER_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(
    GitHubGetAuthenticatedUserInputSchema,
  );

  constructor(
    @IGitHubService private readonly github: IGitHubService,
    @IFlagService private readonly flags: IFlagService,
  ) {}

  resolveExecution(_args: GitHubGetAuthenticatedUserInput): ToolExecution {
    return {
      description: 'Reading the authenticated GitHub account',
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, 'github:user'),
      execute: async () => {
        if (!githubFlagEnabled(this.flags)) {
          return { output: githubFlagOffMessage(), isError: true };
        }
        try {
          const user = await this.github.getAuthenticatedUser();
          return { output: formatGitHubUser(user), isError: false };
        } catch (error) {
          return { output: githubToolErrorMessage(error), isError: true };
        }
      },
    };
  }
}

registerAgentToolService(IGitHubGetAuthenticatedUserTool, GitHubGetAuthenticatedUserTool, {
  name: 'GitHubGetAuthenticatedUser',
  domain: GITHUB_TOOL_DOMAIN,
  when: (accessor) => accessor.get(IFlagService).enabled(GITHUB_FLAG_ID),
});
