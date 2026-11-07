import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import { IFlagService } from '#/app/flag/flag';
import { GITHUB_FLAG_ID } from '#/app/github/flag';
import { IGitHubService } from '#/app/github/github';
import { toInputJsonSchema } from '#/tool/input-schema';
import { matchesGlobRuleSubject } from '#/tool/rule-match';
import { type ToolExecution } from '#/tool/toolContract';

import GITHUB_GET_PULL_REQUEST_DESCRIPTION from './github-get-pull-request.md?raw';
import {
  formatGitHubPullRequest,
  GITHUB_TOOL_DOMAIN,
  githubFlagEnabled,
  githubFlagOffMessage,
  githubToolErrorMessage,
  GitHubGetPullRequestInputSchema,
  type GitHubGetPullRequestInput,
  IGitHubGetPullRequestTool,
} from './githubTools';

export class GitHubGetPullRequestTool implements IGitHubGetPullRequestTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'GitHubGetPullRequest' as const;
  readonly description = GITHUB_GET_PULL_REQUEST_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(GitHubGetPullRequestInputSchema);

  constructor(
    @IGitHubService private readonly github: IGitHubService,
    @IFlagService private readonly flags: IFlagService,
  ) {}

  resolveExecution(args: GitHubGetPullRequestInput): ToolExecution {
    return {
      description: `Reading GitHub pull request ${args.repository}#${String(args.number)}`,
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, `github:${args.repository}`),
      execute: async () => {
        if (!githubFlagEnabled(this.flags)) {
          return { output: githubFlagOffMessage(), isError: true };
        }
        try {
          const pullRequest = await this.github.getPullRequest(args.repository, args.number);
          return { output: formatGitHubPullRequest(pullRequest), isError: false };
        } catch (error) {
          return { output: githubToolErrorMessage(error), isError: true };
        }
      },
    };
  }
}

registerAgentToolService(IGitHubGetPullRequestTool, GitHubGetPullRequestTool, {
  name: 'GitHubGetPullRequest',
  domain: GITHUB_TOOL_DOMAIN,
  when: (accessor) => accessor.get(IFlagService).enabled(GITHUB_FLAG_ID),
});
