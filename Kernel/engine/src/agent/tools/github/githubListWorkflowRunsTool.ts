import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import { IFlagService } from '#/app/flag/flag';
import { GITHUB_FLAG_ID } from '#/app/github/flag';
import { IGitHubService } from '#/app/github/github';
import { toInputJsonSchema } from '#/tool/input-schema';
import { matchesGlobRuleSubject } from '#/tool/rule-match';
import { type ToolExecution } from '#/tool/toolContract';

import GITHUB_LIST_WORKFLOW_RUNS_DESCRIPTION from './github-list-workflow-runs.md?raw';
import {
  formatGitHubWorkflowRuns,
  GITHUB_TOOL_DOMAIN,
  githubFlagEnabled,
  githubFlagOffMessage,
  githubToolErrorMessage,
  GitHubListWorkflowRunsInputSchema,
  type GitHubListWorkflowRunsInput,
  IGitHubListWorkflowRunsTool,
} from './githubTools';

export class GitHubListWorkflowRunsTool implements IGitHubListWorkflowRunsTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'GitHubListWorkflowRuns' as const;
  readonly description = GITHUB_LIST_WORKFLOW_RUNS_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(
    GitHubListWorkflowRunsInputSchema,
  );

  constructor(
    @IGitHubService private readonly github: IGitHubService,
    @IFlagService private readonly flags: IFlagService,
  ) {}

  resolveExecution(args: GitHubListWorkflowRunsInput): ToolExecution {
    return {
      description: `Listing GitHub workflow runs of ${args.repository}`,
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, `github:${args.repository}`),
      execute: async () => {
        if (!githubFlagEnabled(this.flags)) {
          return { output: githubFlagOffMessage(), isError: true };
        }
        try {
          const runs = await this.github.listWorkflowRuns(args.repository, {
            limit: args.limit ?? 30,
          });
          return { output: formatGitHubWorkflowRuns(runs), isError: false };
        } catch (error) {
          return { output: githubToolErrorMessage(error), isError: true };
        }
      },
    };
  }
}

registerAgentToolService(IGitHubListWorkflowRunsTool, GitHubListWorkflowRunsTool, {
  name: 'GitHubListWorkflowRuns',
  domain: GITHUB_TOOL_DOMAIN,
  when: (accessor) => accessor.get(IFlagService).enabled(GITHUB_FLAG_ID),
});
