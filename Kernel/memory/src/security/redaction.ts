import { redactSecretString } from '@hilbras/omnicode-core/human/credentials/redaction';

const REDACTION_MARKER = '[REDACTED]';

const PEM_PRIVATE_KEY =
  /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)* PRIVATE KEY-----/g;
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
const SSH_PRIVATE_KEY = /\bPuTTY-User-Key-File-\d[\s\S]*?END SSH2 ENCRYPTED PRIVATE KEY\b/g;

const ADDITIONAL_PATTERNS: readonly RegExp[] = [PEM_PRIVATE_KEY, AWS_ACCESS_KEY, SSH_PRIVATE_KEY];

export interface RedactionOutcome {
  readonly content: string;
  readonly redacted: boolean;
  readonly redactionCount: number;
}

function applyAdditionalPatterns(content: string): string {
  let out = content;
  for (const pattern of ADDITIONAL_PATTERNS) {
    out = out.replaceAll(pattern, REDACTION_MARKER);
  }
  return out;
}

function countChangedSegments(before: string, after: string): number {
  if (before === after) return 0;
  const left = before.split(/(\s+)/);
  const right = after.split(/(\s+)/);
  let changed = 0;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) changed += 1;
  }
  return Math.max(changed, 1);
}

export function redactMemoryContent(content: string): RedactionOutcome {
  const redacted = applyAdditionalPatterns(redactSecretString(content));
  return {
    content: redacted,
    redacted: redacted !== content,
    redactionCount: countChangedSegments(content, redacted),
  };
}