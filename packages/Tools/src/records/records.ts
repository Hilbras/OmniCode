import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import type { AgentTool } from '@hilbras/omnicode-engine/tool/toolContract';

import {
  DEFAULT_ARTIFACT_MAX_CHARS,
  DEFAULT_SOURCE_EXCERPT_CHARS,
  MAX_ARTIFACT_CHARS,
  MAX_SOURCE_EXCERPT_CHARS,
  RECORD_NAME_MAX_CHARS,
  RECORD_NOTE_MAX_CHARS,
} from './recordStore';

const mediaTypeSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/)
  .optional();

export const ArtifactRecordInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(RECORD_NAME_MAX_CHARS)
    .describe('Human-readable artifact name.'),
  content: z
    .string()
    .max(MAX_ARTIFACT_CHARS)
    .describe('Bounded textual artifact content.'),
  media_type: mediaTypeSchema.describe('Optional media type such as text/markdown.'),
  note: z.string().max(RECORD_NOTE_MAX_CHARS).optional().describe('Optional provenance note.'),
  max_chars: z
    .number()
    .int()
    .positive()
    .max(MAX_ARTIFACT_CHARS)
    .optional()
    .describe(`Maximum retained chars; defaults to ${String(DEFAULT_ARTIFACT_MAX_CHARS)}.`),
});
export type ArtifactRecordInput = z.infer<typeof ArtifactRecordInputSchema>;

export const SourceRecordInputSchema = z
  .object({
    path: z.string().min(1).describe('Source file to record an excerpt from.'),
    start_line: z.number().int().positive().optional().describe('1-based first line; defaults to 1.'),
    end_line: z.number().int().positive().optional().describe('1-based last line, inclusive.'),
    note: z.string().max(RECORD_NOTE_MAX_CHARS).optional().describe('Optional provenance note.'),
    max_chars: z
      .number()
      .int()
      .positive()
      .max(MAX_SOURCE_EXCERPT_CHARS)
      .optional()
      .describe(`Maximum retained excerpt chars; defaults to ${String(DEFAULT_SOURCE_EXCERPT_CHARS)}.`),
  })
  .superRefine((value, ctx) => {
    if (value.end_line !== undefined && value.start_line !== undefined && value.end_line < value.start_line) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'end_line must be >= start_line.' });
    }
  });
export type SourceRecordInput = z.infer<typeof SourceRecordInputSchema>;

export interface IArtifactRecordTool extends AgentTool<ArtifactRecordInput> {
  readonly _serviceBrand: undefined;
}
export const IArtifactRecordTool = createDecorator<IArtifactRecordTool>('artifactRecordTool');

export interface ISourceRecordTool extends AgentTool<SourceRecordInput> {
  readonly _serviceBrand: undefined;
}
export const ISourceRecordTool = createDecorator<ISourceRecordTool>('sourceRecordTool');
