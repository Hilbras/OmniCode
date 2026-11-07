import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const GITHUB_FLAG_ID = 'github-connector';
export const GITHUB_FLAG_ENV = 'OMNICODE_EXPERIMENTAL_GITHUB_CONNECTOR';

export const githubFlag: FlagDefinitionInput = {
  id: GITHUB_FLAG_ID,
  title: 'GitHub connector',
  description:
    'Enable the GitHub connector: OAuth device-flow authorization, persisted credentials, and agent-callable GitHub read tools.',
  env: GITHUB_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(githubFlag);
