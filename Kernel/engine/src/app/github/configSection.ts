import { z } from 'zod';

import { type EnvBindings, envBindings, stripEnvBoundFields } from '#/app/config/config';
import { registerConfigSection } from '#/app/config/configSectionContributions';

export const GITHUB_SECTION = 'github';

export const DEFAULT_GITHUB_SCOPES: readonly string[] = ['repo', 'workflow'];

export const GitHubSectionSchema = z.object({
  clientId: z.string().min(1).optional(),
  scopes: z.array(z.string().min(1)).optional(),
});

export type GitHubSection = z.infer<typeof GitHubSectionSchema>;

export const GITHUB_CLIENT_ID_ENV = 'OMNICODE_GITHUB_CLIENT_ID';
export const GITHUB_SCOPES_ENV = 'OMNICODE_GITHUB_SCOPES';

function parseScopesEnv(raw: string): string[] | undefined {
  const scopes = raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  return scopes.length > 0 ? scopes : undefined;
}

export const githubEnvBindings: EnvBindings<GitHubSection> = envBindings(GitHubSectionSchema, {
  clientId: { env: GITHUB_CLIENT_ID_ENV },
  scopes: { env: GITHUB_SCOPES_ENV, parse: parseScopesEnv },
});

export const stripGitHubEnv = stripEnvBoundFields(githubEnvBindings);

registerConfigSection(GITHUB_SECTION, GitHubSectionSchema, {
  env: githubEnvBindings,
  stripEnv: stripGitHubEnv,
});
