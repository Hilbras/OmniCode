import { createHash } from 'node:crypto';

export type CanonicalCommandKind = 'simple' | 'shell-wrapper' | 'opaque';

export interface CanonicalCommand {
  readonly canonical: string;
  readonly kind: CanonicalCommandKind;
}

const SAFE_ENV_PREFIX = /^(?:CI|NODE_ENV|NO_COLOR|FORCE_COLOR|TERM|LANG|LC_[A-Za-z0-9_]+)=/;
const SHELL_META = /[|&;<>()`$]/u;
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', '/bin/bash', '/bin/sh', '/bin/zsh', '/usr/bin/bash', '/usr/bin/sh']);

/**
 * Canonical argv for a simple command, or `undefined` when the command is
 * opaque (metacharacters, unbalanced quotes, or empty). Shell wrappers such as
 * `bash -lc` are unwrapped, so the returned tokens are what an exec-policy
 * prefix should contain.
 */
export function canonicalCommandTokens(command: string): string[] | undefined {
  const trimmed = command.trim();
  if (trimmed.length === 0) return undefined;
  const tokens = tokenize(trimmed);
  if (tokens === undefined || SHELL_META.test(trimmed)) return undefined;
  let index = 0;
  while (index < tokens.length && SAFE_ENV_PREFIX.test(tokens[index]!)) index += 1;
  const remaining = tokens.slice(index);
  if (
    remaining.length >= 3 &&
    SHELLS.has(remaining[0]!) &&
    (remaining[1] === '-c' || remaining[1] === '-lc')
  ) {
    return canonicalCommandTokens(remaining.slice(2).join(' '));
  }
  return remaining.length > 0 ? remaining : undefined;
}

export function canonicalizeCommand(command: string): CanonicalCommand {
  const trimmed = command.trim();
  if (trimmed.length === 0) return { canonical: '', kind: 'opaque' };
  const tokens = tokenize(trimmed);
  if (tokens === undefined || SHELL_META.test(trimmed)) {
    return { canonical: `opaque:${sha256(trimmed)}`, kind: 'opaque' };
  }
  let index = 0;
  while (index < tokens.length && SAFE_ENV_PREFIX.test(tokens[index]!)) index += 1;
  const remaining = tokens.slice(index);
  if (remaining.length >= 3 && SHELLS.has(remaining[0]!) && (remaining[1] === '-c' || remaining[1] === '-lc')) {
    return { canonical: canonicalizeCommand(remaining.slice(2).join(' ')).canonical, kind: 'shell-wrapper' };
  }
  return { canonical: remaining.map(quoteToken).join(' '), kind: 'simple' };
}

function tokenize(command: string): string[] | undefined {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaping = false;
  for (const char of command) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (escaping || quote !== undefined) return undefined;
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function quoteToken(token: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(token) ? token : `'${token.replace(/'/g, `'\\''`)}'`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
