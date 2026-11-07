import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const VERCEL_FLAG_ID = 'vercel-connector';
export const VERCEL_FLAG_ENV = 'OMNICODE_EXPERIMENTAL_VERCEL_CONNECTOR';

export const vercelFlag: FlagDefinitionInput = {
  id: VERCEL_FLAG_ID,
  title: 'Vercel connector',
  description:
    'Enable the Vercel connector: bearer access token authorization, persisted credentials, and agent-callable Vercel read tools.',
  env: VERCEL_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(vercelFlag);
