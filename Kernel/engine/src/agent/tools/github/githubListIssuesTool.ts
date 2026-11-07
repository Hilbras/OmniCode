import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import { IFlagService } from '#/app/flag/flag';
import { GITHUB_FLAG_ID } from '#/app/github/flag';
import { IGitHubService } from '#/app/github/github';
import { toInputJsonSchema } from '#/tool/input-schema';
import { matchesGlobRuleSubject } from '#/tool/rule-match';
import { type ToolExecution } from '#/tool/toolContract';

import GITHUB_LIST_ISSUES_DESCRIPTION from './github-list-issues.md?raw';
import {
  formatGitHubIssues,
  GITHUB_TOOL_DOMAIN,
  githubFlagEnabled,
  githubFlagOffMessage,
  githubToolErrorMessage,
  GitHubListIssuesInputSchema,
  type GitHubListIssuesInput,
  IGitHubListIssuesTool,
} from './githubTools';

export class GitHubListIssuesTool implements IGitHubListIssuesTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'GitHubListIssues' as const;
  readonly description = GITHUB_LIST_ISSUES_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(GitHubListIssuesInputSchema);

  constructor(
    @IGitHubService private readonly github: IGitHubService,
    @IFlagService private readonly flags: IFlagService,
  ) {}

  resolveExecution(args: GitHubListIssuesInput): ToolExecution {
    return {
      description: `Listing GitHub issues of ${args.repository}`,
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, `github:${args.repository}`),
      execute: async () => {
        if (!githubFlagEnabled(this.flags)) {
          return { output: githubFlagOffMessage(), isError: true };
        }
        try {
          const issues = await this.github.listIssues(args.repository, {
            state: args.state ?? 'open',
            limit: args.limit ?? 30,
          });
          return { output: formatGitHubIssues(issues), isError: false };
        } catch (error) {
          return { output: githubToolErrorMessage(error), isError: true };
        }
      },
    };
  }
}

registerAgentToolService(IGitHubListIssuesTool, GitHubListIssuesTool, {
  name: 'GitHubListIssues',
  domain: GITHUB_TOOL_DOMAIN,
  when: (accessor) => accessor.get(IFlagService).enabled(GITHUB_FLAG_ID),
});
