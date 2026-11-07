import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import { IFlagService } from '#/app/flag/flag';
import { GITHUB_FLAG_ID } from '#/app/github/flag';
import { IGitHubService } from '#/app/github/github';
import { toInputJsonSchema } from '#/tool/input-schema';
import { matchesGlobRuleSubject } from '#/tool/rule-match';
import { type ToolExecution } from '#/tool/toolContract';

import GITHUB_LIST_PULL_REQUESTS_DESCRIPTION from './github-list-pull-requests.md?raw';
import {
  formatGitHubPullRequests,
  GITHUB_TOOL_DOMAIN,
  githubFlagEnabled,
  githubFlagOffMessage,
  githubToolErrorMessage,
  GitHubListPullRequestsInputSchema,
  type GitHubListPullRequestsInput,
  IGitHubListPullRequestsTool,
} from './githubTools';

export class GitHubListPullRequestsTool implements IGitHubListPullRequestsTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'GitHubListPullRequests' as const;
  readonly description = GITHUB_LIST_PULL_REQUESTS_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(
    GitHubListPullRequestsInputSchema,
  );

  constructor(
    @IGitHubService private readonly github: IGitHubService,
    @IFlagService private readonly flags: IFlagService,
  ) {}

  resolveExecution(args: GitHubListPullRequestsInput): ToolExecution {
    return {
      description: `Listing GitHub pull requests of ${args.repository}`,
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, `github:${args.repository}`),
      execute: async () => {
        if (!githubFlagEnabled(this.flags)) {
          return { output: githubFlagOffMessage(), isError: true };
        }
        try {
          const pullRequests = await this.github.listPullRequests(args.repository, {
            state: args.state ?? 'open',
            limit: args.limit ?? 30,
          });
          return { output: formatGitHubPullRequests(pullRequests), isError: false };
        } catch (error) {
          return { output: githubToolErrorMessage(error), isError: true };
        }
      },
    };
  }
}

registerAgentToolService(IGitHubListPullRequestsTool, GitHubListPullRequestsTool, {
  name: 'GitHubListPullRequests',
  domain: GITHUB_TOOL_DOMAIN,
  when: (accessor) => accessor.get(IFlagService).enabled(GITHUB_FLAG_ID),
});
