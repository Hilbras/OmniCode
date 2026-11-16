import { z } from 'zod';

export const IMPORT_SOURCES = ['claude-code', 'codex', 'qwen'] as const;

export const ImportedSourceSchema = z.enum(IMPORT_SOURCES);
export type ImportedSource = z.infer<typeof ImportedSourceSchema>;

const NoNulSchema = z.string().refine((value) => !value.includes('\0'), {
  message: 'must not contain NUL bytes',
});

const NameSchema = NoNulSchema.refine((value) => value.trim().length > 0, {
  message: 'name must not be empty',
});

const PathSchema = NoNulSchema.refine((value) => value.trim().length > 0, {
  message: 'sourcePath must not be empty',
});

export const ImportWarningCodeSchema = z.enum([
  'unreadable-file',
  'malformed-json',
  'malformed-toml',
  'malformed-frontmatter',
  'invalid-entry',
  'unrecognized-entry',
  'missing-name',
  'duplicate-name',
]);
export type ImportWarningCode = z.infer<typeof ImportWarningCodeSchema>;

export const ImportWarningSchema = z.object({
  code: ImportWarningCodeSchema,
  message: NoNulSchema,
  sourcePath: PathSchema,
});
export type ImportWarning = z.infer<typeof ImportWarningSchema>;

export const ImportedSettingValueSchema = z.union([
  NoNulSchema,
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type ImportedSettingValue = z.infer<typeof ImportedSettingValueSchema>;

export const ImportedSettingsSchema = z.record(NoNulSchema, ImportedSettingValueSchema);
export type ImportedSettings = z.infer<typeof ImportedSettingsSchema>;

export const ImportedMcpServerSchema = z.object({
  command: NoNulSchema.optional(),
  args: z.array(NoNulSchema).optional(),
  url: NoNulSchema.optional(),
  env: z.record(NoNulSchema, NoNulSchema).optional(),
  sourcePath: PathSchema,
});
export type ImportedMcpServer = z.infer<typeof ImportedMcpServerSchema>;

export const ImportedAgentSchema = z.object({
  name: NameSchema,
  description: NoNulSchema.optional(),
  instructions: NoNulSchema,
  tools: z.array(NameSchema).optional(),
  model: NoNulSchema.optional(),
  sourcePath: PathSchema,
});
export type ImportedAgent = z.infer<typeof ImportedAgentSchema>;

export const ImportedSkillSchema = z.object({
  name: NameSchema,
  description: NoNulSchema.optional(),
  body: NoNulSchema,
  files: z.array(PathSchema).optional(),
  sourcePath: PathSchema,
});
export type ImportedSkill = z.infer<typeof ImportedSkillSchema>;

export const ImportedConfigSchema = z.object({
  source: ImportedSourceSchema,
  settings: ImportedSettingsSchema,
  mcpServers: z.record(NameSchema, ImportedMcpServerSchema).optional(),
  sourcePath: PathSchema,
});
export type ImportedConfig = z.infer<typeof ImportedConfigSchema>;

export const ImportBundleSchema = z.object({
  source: ImportedSourceSchema,
  root: PathSchema,
  agents: z.array(ImportedAgentSchema),
  skills: z.array(ImportedSkillSchema),
  config: ImportedConfigSchema,
  warnings: z.array(ImportWarningSchema),
});
export type ImportBundle = z.infer<typeof ImportBundleSchema>;
