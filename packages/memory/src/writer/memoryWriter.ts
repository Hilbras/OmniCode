import { z } from 'zod';

import { redactMemoryContent } from '#/security/redaction';
import { analyzeMemoryContent } from '#/security/suspicion';

export type MemoryWriterCategory = 'fact' | 'preference';

export interface MemoryWriterSaveOperation {
  readonly op: 'save';
  readonly subject: string;
  readonly content: string;
  readonly quote: string;
  readonly category: MemoryWriterCategory;
}

export interface MemoryWriterForgetOperation {
  readonly op: 'forget';
  readonly subject: string;
  readonly quote?: string;
}

export type MemoryWriterOperation = MemoryWriterSaveOperation | MemoryWriterForgetOperation;

export interface MemoryWriterTurn {
  readonly userMessage: string;
  readonly assistantMessage?: string;
  readonly profile?: readonly { readonly subject: string; readonly content: string }[];
}

export type WriterRejectionReason =
  | 'unsupported_op'
  | 'invalid_subject'
  | 'empty_content'
  | 'too_long'
  | 'no_quote'
  | 'quote_not_in_turn'
  | 'secret'
  | 'suspicious'
  | 'duplicate';

export interface WriterRejection {
  readonly operation: unknown;
  readonly reason: WriterRejectionReason;
}

export interface WriterValidation {
  readonly accepted: readonly MemoryWriterSaveOperation[];
  readonly forget: readonly MemoryWriterForgetOperation[];
  readonly rejected: readonly WriterRejection[];
}

const SUBJECT_PATTERN = /^[a-z0-9][a-z0-9._-]{1,80}$/;
const MAX_CONTENT_CHARS = 240;
const MAX_QUOTE_CHARS = 500;
const MAX_OPERATIONS = 8;

const saveSchema = z.object({
  op: z.literal('save'),
  subject: z.string(),
  content: z.string(),
  quote: z.string(),
  category: z.enum(['fact', 'preference']).optional(),
});

function operationsOf(parsed: unknown): unknown[] | undefined {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const operations = (parsed as { readonly operations?: unknown }).operations;
  return Array.isArray(operations) ? operations : undefined;
}

function compact(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim();
}

export function parseWriterResponse(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.search(/[[{]/);
  if (start === -1) return undefined;
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (end <= start) return undefined;
  try {
    return JSON.parse(body.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

export function validateWriterOperations(
  turn: MemoryWriterTurn,
  parsed: unknown,
): WriterValidation {
  const operations = operationsOf(parsed);
  if (operations === undefined) return { accepted: [], forget: [], rejected: [] };

  const accepted: MemoryWriterSaveOperation[] = [];
  const forget: MemoryWriterForgetOperation[] = [];
  const rejected: WriterRejection[] = [];
  const seen = new Set<string>();
  const normalizedUser = compact(turn.userMessage);

  for (const operation of operations.slice(0, MAX_OPERATIONS)) {
    const record = operation as Record<string, unknown>;
    if (record['op'] === 'none') continue;
    if (record['op'] === 'forget') {
      if (typeof record['subject'] === 'string' && SUBJECT_PATTERN.test(record['subject'])) {
        forget.push({ op: 'forget', subject: record['subject'] });
      } else {
        rejected.push({ operation, reason: 'invalid_subject' });
      }
      continue;
    }
    if (record['op'] !== 'save') {
      rejected.push({ operation, reason: 'unsupported_op' });
      continue;
    }
    const parsedSave = saveSchema.safeParse(record);
    if (!parsedSave.success) {
      rejected.push({ operation, reason: 'unsupported_op' });
      continue;
    }
    const save = parsedSave.data;
    if (!SUBJECT_PATTERN.test(save.subject)) {
      rejected.push({ operation, reason: 'invalid_subject' });
      continue;
    }
    const content = compact(save.content);
    if (content.length === 0) {
      rejected.push({ operation, reason: 'empty_content' });
      continue;
    }
    if (content.length > MAX_CONTENT_CHARS) {
      rejected.push({ operation, reason: 'too_long' });
      continue;
    }
    const quote = compact(save.quote);
    if (quote.length === 0) {
      rejected.push({ operation, reason: 'no_quote' });
      continue;
    }
    if (quote.length > MAX_QUOTE_CHARS || !normalizedUser.includes(quote)) {
      rejected.push({ operation, reason: 'quote_not_in_turn' });
      continue;
    }
    if (redactMemoryContent(content).redacted) {
      rejected.push({ operation, reason: 'secret' });
      continue;
    }
    if (analyzeMemoryContent(content).suspicious) {
      rejected.push({ operation, reason: 'suspicious' });
      continue;
    }
    const key = `${save.subject}:${content.toLowerCase()}`;
    if (seen.has(key)) {
      rejected.push({ operation, reason: 'duplicate' });
      continue;
    }
    seen.add(key);
    accepted.push({
      op: 'save',
      subject: save.subject,
      content,
      quote,
      category: save.category ?? 'fact',
    });
  }

  return { accepted, forget, rejected };
}
