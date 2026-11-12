import { z } from 'zod';

import { registerConfigSection } from '#/app/config/configSectionContributions';

export const EXEC_POLICY_SECTION = 'execPolicy';

/**
 * Names the on-disk exec-policy file. The section is deliberately path-only:
 * the policy body lives in a file so it can be audited and diffed as config.
 * An invalid section is dropped by the config service with a warning
 * diagnostic (surfaced in the TUI and stderr), leaving the exec-policy pass
 * inert; the hard `config.invalid` failure is reserved for a configured
 * policy file that fails to load at composition (`loadExecPolicyFromConfig`).
 */
export const ExecPolicyConfigSchema = z.object({ path: z.string().min(1) }).strict();

export type ExecPolicyConfig = z.infer<typeof ExecPolicyConfigSchema>;

registerConfigSection(EXEC_POLICY_SECTION, ExecPolicyConfigSchema);
