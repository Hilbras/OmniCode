/**
 * Exec-policy rules: a data-only, load-time-checked description of which
 * command prefixes are allowed, prompted, or forbidden.
 *
 * Rules are declarative on purpose. The file that carries them is config, not
 * code, so a compromised workspace cannot smuggle logic into the approval
 * path — only literals, alternatives, and a small set of well-known keys.
 *
 * Matching is deliberately conservative:
 *
 * - A command is split into a resolved executable plus its argument prefix.
 *   Alternatives (`git status | git diff`) each carry their own prefix.
 * - Both sides are canonicalized the same way (NFD, case fold, NFC) so macOS
 *   filenames and mixed-case Windows paths match the spelling a human wrote.
 * - A command that could not be tokenized as a simple invocation (shell
 *   metacharacters, unbalanced quotes) matches only an explicit
 *   `opaque: <decision>` rule; it never falls through to an allow.
 * - The most specific matching rule wins: alternatives beat prefix-only, and a
 *   longer prefix beats a shorter one; the same specificity resolves to the
 *   first declared rule, so `forbidden` written first stays sticky.
 *
 * Loading rejects ambiguity rather than guessing: malformed entries and
 * `examples` that contradict their own rule are load errors, so a policy that
 * would silently not match fails before it is used.
 */

import type { IBashParserService } from '#/app/bashParser/bashParser';
import { canonicalizeCommand } from '../commandCanonicalization';

export type ExecDecision = 'allow' | 'prompt' | 'prompt-user' | 'forbidden';

const DECISIONS: ReadonlySet<string> = new Set<ExecDecision>([
  'allow',
  'prompt',
  'prompt-user',
  'forbidden',
]);

export interface ExecRuleSpec {
  /** One entry per alternative; a string is a prefix, an array is an exact argv. */
  readonly prefix: string | readonly (string | readonly string[])[];
  /** Alternative exact argv shapes, when the prefix alone is too loose. */
  readonly alternatives?: readonly (readonly string[])[];
  readonly decision: ExecDecision;
  /** Optional network/host restriction carried with an allow. */
  readonly hosts?: readonly string[];
  /** True when a broader rule must not narrow this one (e.g. deny of `sudo`). */
  readonly sticky?: boolean;
  readonly examples?: readonly ExecRuleExample[];
  readonly note?: string;
}

export interface ExecRuleExample {
  readonly command: string;
  readonly matches: boolean;
}

export interface ExecPolicyFile {
  readonly version: 1;
  readonly rules: readonly ExecRuleSpec[];
  /** Decision for commands that cannot be parsed as a simple invocation. */
  readonly opaque?: ExecDecision;
}

export interface CompiledExecRule {
  readonly decision: ExecDecision;
  readonly sticky: boolean;
  readonly hosts: readonly string[];
  readonly spec: ExecRuleSpec;
  /** Longest alternative argv length, used for specificity. */
  readonly alternativeDepth: number;
  readonly prefixArgv: readonly string[];
  readonly alternatives: readonly (readonly string[])[];
}

export interface ExecPolicy {
  readonly rules: readonly CompiledExecRule[];
  readonly opaque: ExecDecision;
}

export class ExecPolicyLoadError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'ExecPolicyLoadError';
  }
}

/** NFD + case fold + NFC; the same normalization on both sides of a match. */
export function canonicalTokenText(value: string): string {
  return value.normalize('NFD').toLowerCase().normalize('NFC');
}

export function loadExecPolicy(source: unknown, path = 'exec-policy'): ExecPolicy {
  if (!isRecord(source)) throw new ExecPolicyLoadError(path, 'policy must be an object');
  if (source['version'] !== 1) throw new ExecPolicyLoadError(path, 'version must be 1');
  const rawRules = source['rules'];
  if (!Array.isArray(rawRules)) throw new ExecPolicyLoadError(path, 'rules must be an array');

  const opaque = source['opaque'] === undefined ? 'forbidden' : asDecision(source['opaque'], path, 'opaque');
  const rules = rawRules.map((raw, index) => compileRule(raw, `${path}.rules[${index}]`));
  const policy: ExecPolicy = { rules, opaque };
  rules.forEach((rule, index) => verifyExamples(rule, `${path}.rules[${index}]`, opaque, policy));
  return policy;
}

/** Deny-by-default policy: every command is forbidden until a rule allows it. */
export const EMPTY_EXEC_POLICY: ExecPolicy = { rules: [], opaque: 'forbidden' };

export interface ExecMatchResult {
  readonly decision: ExecDecision;
  readonly rule?: CompiledExecRule;
  readonly reason: 'rule' | 'opaque' | 'default';
}

export function matchExecPolicy(
  command: string,
  policy: ExecPolicy,
  options: { readonly parser?: IBashParserService } = {},
): ExecMatchResult {
  const argv = resolveArgv(command, options.parser);
  if (argv === undefined) {
    return { decision: policy.opaque, reason: 'opaque' };
  }
  if (argv.length === 0) return { decision: policy.opaque, reason: 'opaque' };
  const normalized = argv.map(canonicalTokenText);
  const executable = normalized[0]!;

  let best: { rule: CompiledExecRule; specificity: number } | undefined;
  for (const rule of policy.rules) {
    const specificity = matchSpecificity(rule, executable, normalized);
    if (specificity === undefined) continue;
    if (best === undefined) {
      best = { rule, specificity };
      continue;
    }
    if (specificity > best.specificity) {
      best = { rule, specificity };
      continue;
    }
    if (specificity === best.specificity && rule.sticky && !best.rule.sticky) {
      best = { rule, specificity };
    }
  }

  if (best !== undefined) return { decision: best.rule.decision, rule: best.rule, reason: 'rule' };
  return { decision: 'prompt-user', reason: 'default' };
}

function resolveArgv(command: string, parser: IBashParserService | undefined): string[] | undefined {
  if (hasShellMetacharacters(command)) return undefined;
  const canonical = canonicalizeCommand(command);
  if (canonical.kind === 'opaque' || canonical.canonical.length === 0) return undefined;
  const argv = splitCanonical(canonical.canonical);
  if (parser === undefined) return argv;
  // The parser is the authority on whether this is a simple invocation; a
  // parse error also means opaque.
  const parsed = parser.parse(command, { timeoutMs: 500, maxNodes: 4_000 });
  if (!parsed.ok || parsed.hasError) return undefined;
  return argv;
}

function hasShellMetacharacters(command: string): boolean {
  return /[|&;<>()`$(\n]/u.test(command);
}

/** The canonicalizer may single-quote a token; that quoting never survives here. */
function splitCanonical(canonical: string): string[] {
  return canonical.split(/\s+/u).filter((token) => token.length > 0);
}

function compileRule(raw: unknown, path: string): CompiledExecRule {
  if (!isRecord(raw)) throw new ExecPolicyLoadError(path, 'rule must be an object');
  const decision = asDecision(raw['decision'], path, 'decision');
  const prefixArgv = normalizePrefix(raw['prefix'], path);
  const alternatives = normalizeAlternatives(raw['alternatives'], path);
  if (prefixArgv === undefined && alternatives.length === 0) {
    throw new ExecPolicyLoadError(path, 'rule needs prefix or alternatives');
  }
  if (alternatives.length > 0 && prefixArgv === undefined) {
    for (const alternative of alternatives) {
      if (alternative.length === 0) throw new ExecPolicyLoadError(path, 'empty alternative');
    }
  }
  const hosts = raw['hosts'];
  if (hosts !== undefined && (!Array.isArray(hosts) || hosts.some((host) => typeof host !== 'string'))) {
    throw new ExecPolicyLoadError(path, 'hosts must be strings');
  }
  const examples = normalizeExamples(raw['examples'], path);
  const spec: ExecRuleSpec = {
    prefix: (raw['prefix'] as ExecRuleSpec['prefix']) ?? [],
    decision,
    ...(alternatives.length > 0 ? { alternatives } : {}),
    ...(hosts !== undefined ? { hosts: hosts as string[] } : {}),
    ...(raw['sticky'] === true ? { sticky: true } : {}),
    ...(examples !== undefined ? { examples } : {}),
    ...(typeof raw['note'] === 'string' ? { note: raw['note'] } : {}),
  };
  return {
    decision,
    sticky: raw['sticky'] === true,
    hosts: (hosts as string[] | undefined)?.map(canonicalTokenText) ?? [],
    spec,
    alternativeDepth: alternatives.reduce((max, argv) => Math.max(max, argv.length), 0),
    prefixArgv: prefixArgv?.map(canonicalTokenText) ?? [],
    alternatives: alternatives.map((argv) => argv.map(canonicalTokenText)),
  };
}

function normalizePrefix(prefix: unknown, path: string): string[] | undefined {
  if (prefix === undefined) return undefined;
  if (typeof prefix === 'string') return prefix.trim().length === 0 ? undefined : splitCanonical(prefix);
  if (Array.isArray(prefix)) {
    const tokens: string[] = [];
    for (const entry of prefix) {
      if (typeof entry === 'string') {
        tokens.push(...splitCanonical(entry));
      } else if (Array.isArray(entry)) {
        // One entry per alternative; normalized by flattenPrefixAlternatives.
        tokens.push(...entry.map((part) => String(part)));
      } else {
        throw new ExecPolicyLoadError(path, 'prefix entries must be strings or arrays');
      }
    }
    return tokens.length === 0 ? undefined : tokens;
  }
  throw new ExecPolicyLoadError(path, 'prefix must be a string or array');
}

function normalizeAlternatives(value: unknown, path: string): string[][] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ExecPolicyLoadError(path, 'alternatives must be an array');
  return value.map((entry) => {
    if (!Array.isArray(entry) || entry.some((part) => typeof part !== 'string')) {
      throw new ExecPolicyLoadError(path, 'each alternative must be a string array');
    }
    return (entry as string[]).flatMap((part) => splitCanonical(part));
  });
}

function normalizeExamples(value: unknown, path: string): ExecRuleExample[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ExecPolicyLoadError(path, 'examples must be an array');
  return value.map((entry) => {
    if (!isRecord(entry) || typeof entry['command'] !== 'string' || typeof entry['matches'] !== 'boolean') {
      throw new ExecPolicyLoadError(path, 'example needs command and matches');
    }
    return { command: entry['command'], matches: entry['matches'] };
  });
}

function verifyExamples(
  rule: CompiledExecRule,
  path: string,
  opaque: ExecDecision,
  policy: ExecPolicy,
): void {
  for (const example of rule.spec.examples ?? []) {
    const argv = resolveArgv(example.command, undefined);
    const self = argv === undefined ? undefined : matchSpecificity(rule, canonicalTokenText(argv[0] ?? ''), argv.map(canonicalTokenText));
    if (example.matches) {
      if (self === undefined) {
        throw new ExecPolicyLoadError(path, `example "${example.command}" does not match its rule`);
      }
      const winner = matchExecPolicy(example.command, { ...policy, opaque });
      if (winner.rule !== rule) {
        throw new ExecPolicyLoadError(path, `example "${example.command}" is shadowed by another rule`);
      }
    } else if (self !== undefined) {
      throw new ExecPolicyLoadError(path, `example "${example.command}" matches but is marked not-matching`);
    }
  }
}

function matchSpecificity(
  rule: CompiledExecRule,
  executable: string,
  argv: readonly string[],
): number | undefined {
  for (const alternative of rule.alternatives) {
    if (alternative.length > argv.length) continue;
    if (startsWith(argv, alternative)) {
      return 1_000 + alternative.length;
    }
  }
  if (rule.prefixArgv.length > 0 && startsWith(argv, rule.prefixArgv)) {
    if (rule.prefixArgv[0] !== executable) return undefined;
    return rule.prefixArgv.length;
  }
  return undefined;
}

function startsWith(argv: readonly string[], prefix: readonly string[]): boolean {
  if (prefix.length === 0 || prefix.length > argv.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (argv[index] !== prefix[index]) return false;
  }
  return true;
}

function asDecision(value: unknown, path: string, field: string): ExecDecision {
  if (typeof value !== 'string' || !DECISIONS.has(value)) {
    throw new ExecPolicyLoadError(path, `${field} must be one of ${[...DECISIONS].join(', ')}`);
  }
  return value as ExecDecision;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
