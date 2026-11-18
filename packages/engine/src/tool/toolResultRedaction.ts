import type { ContentPart } from '#human/llm/message';

import type { ToolResult } from './toolContract';

export type RedactionKind =
  | 'private_key'
  | 'aws_access_key'
  | 'api_key'
  | 'github_token'
  | 'slack_token'
  | 'gitlab_token'
  | 'jwt'
  | 'bearer_token';

interface RedactionRule {
  readonly kind: RedactionKind;
  readonly pattern: RegExp;
}

const RULES: readonly RedactionRule[] = [
  {
    kind: 'private_key',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  { kind: 'aws_access_key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'api_key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'github_token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { kind: 'slack_token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'gitlab_token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  {
    kind: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  { kind: 'bearer_token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/g },
];

export function isToolOutputRedactionDisabled(): boolean {
  return process.env['OMNICODE_TOOL_OUTPUT_REDACTION'] === '0';
}

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const rule of RULES) {
    redacted = redacted.replace(rule.pattern, `[redacted:${rule.kind}]`);
  }
  return redacted;
}

export function redactToolOutput(output: ToolResult['output']): ToolResult['output'] {
  if (isToolOutputRedactionDisabled()) return output;
  if (typeof output === 'string') return redactSecrets(output);
  return output.map((part): ContentPart =>
    part.type === 'text' ? { ...part, text: redactSecrets(part.text) } : part,
  );
}
