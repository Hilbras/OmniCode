import { describe, expect, it } from 'vitest';

import { getAgentToolContributions } from '#/agent/toolRegistry/toolContribution';

describe('the built-in tool contributions', () => {
  it('registers the connector tools through the package entry point', async () => {
    await import('#/index');

    const names = getAgentToolContributions().map((contribution) => contribution.options.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'GitHubGetAuthenticatedUser',
        'GitHubGetPullRequest',
        'GitHubListIssues',
        'GitHubListPullRequests',
        'GitHubListRepositories',
        'GitHubListWorkflowRuns',
        'VercelGetAuthenticatedUser',
        'VercelGetDeployment',
        'VercelGetDeploymentEvents',
        'VercelListDeployments',
        'VercelListProjects',
      ]),
    );
  });

  it('gates the connector tools behind their experimental flag', async () => {
    await import('#/index');

    const connectors = getAgentToolContributions().filter(
      (contribution) =>
        contribution.options.name.startsWith('GitHub') ||
        contribution.options.name.startsWith('Vercel'),
    );

    expect(connectors).not.toHaveLength(0);
    for (const contribution of connectors) {
      expect(contribution.options.when).toBeDefined();
    }
  });
});
