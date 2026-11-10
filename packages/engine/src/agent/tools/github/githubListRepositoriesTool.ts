import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import { IFlagService } from '#/app/flag/flag';
import { GITHUB_FLAG_ID } from '#/app/github/flag';
import { IGitHubService } from '#/app/github/github';
import { toInputJsonSchema } from '#/tool/input-schema';
import { matchesGlobRuleSubject } from '#/tool/rule-match';
import { type ToolExecution } from '#/tool/toolContract';

import GITHUB_LIST_REPOSITORIES_DESCRIPTION from './github-list-repositories.md?raw';
import {
  formatGitHubRepositories,
  GITHUB_TOOL_DOMAIN,
  githubFlagEnabled,
  githubFlagOffMessage,
  githubToolErrorMessage,
  GitHubListRepositoriesInputSchema,
  type GitHubListRepositoriesInput,
  IGitHubListRepositoriesTool,
} from './githubTools';

export class GitHubListRepositoriesTool implements IGitHubListRepositoriesTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'GitHubListRepositories' as const;
  readonly description = GITHUB_LIST_REPOSITORIES_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(
    GitHubListRepositoriesInputSchema,
  );

  constructor(
    @IGitHubService private readonly github: IGitHubService,
    @IFlagService private readonly flags: IFlagService,
  ) {}

  resolveExecution(args: GitHubListRepositoriesInput): ToolExecution {
    return {
      description: 'Listing GitHub repositories',
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, 'github:repositories'),
      execute: async () => {
        if (!githubFlagEnabled(this.flags)) {
          return { output: githubFlagOffMessage(), isError: true };
        }
        try {
          const repositories = await this.github.listRepositories({
            limit: args.limit ?? 30,
          });
          return { output: formatGitHubRepositories(repositories), isError: false };
        } catch (error) {
          return { output: githubToolErrorMessage(error), isError: true };
        }
      },
    };
  }
}

registerAgentToolService(IGitHubListRepositoriesTool, GitHubListRepositoriesTool, {
  name: 'GitHubListRepositories',
  domain: GITHUB_TOOL_DOMAIN,
  when: (accessor) => accessor.get(IFlagService).enabled(GITHUB_FLAG_ID),
});
