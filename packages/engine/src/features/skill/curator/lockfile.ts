import { createHash } from 'node:crypto';

import { z } from 'zod';

import { Error2 } from '#/errors';
import type { SkillDefinition, SkillSource } from '#/features/skill/catalog/types';
import { normalizeSkillName } from '#/features/skill/catalog/types';

import { SkillCuratorErrors } from './errors';

export const MAX_CURATED_SET_NAME_LENGTH = 64;
const CURATED_SET_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export interface CuratedSetEntry {
  readonly name: string;
  readonly fingerprint: string;
  readonly source: SkillSource;
  readonly path: string;
}

export interface CuratedSetLockfile {
  readonly version: 1;
  readonly name: string;
  readonly createdAt: number;
  readonly entries: Readonly<Record<string, CuratedSetEntry>>;
}

export interface CuratedSetChange {
  readonly name: string;
  readonly lockfileFingerprint: string;
  readonly currentFingerprint: string;
}

export interface CuratedSetDiff {
  /** In the lockfile but not in the catalog. */
  readonly missing: readonly string[];
  /** In both, but the skill content changed since the set was saved. */
  readonly changed: readonly CuratedSetChange[];
  /** In the catalog but not in the lockfile. */
  readonly extra: readonly string[];
}

const atSchema = z.number().int().finite().nonnegative();

const curatedSetEntrySchema = z.object({
  name: z.string().min(1),
  fingerprint: z.string().min(1),
  source: z.enum(['project', 'user', 'extra', 'builtin']),
  path: z.string().min(1),
});

const curatedSetLockfileSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  createdAt: atSchema,
  entries: z.record(z.string(), curatedSetEntrySchema),
});

/**
 * Set names become file names under the curator root; the pattern excludes
 * separators and dotfiles so a name can never escape the sets directory or
 * hide as a control file.
 */
export function assertCuratedSetName(name: string): string {
  if (
    name.length === 0 ||
    name.length > MAX_CURATED_SET_NAME_LENGTH ||
    !CURATED_SET_NAME_PATTERN.test(name)
  ) {
    throw new Error2(
      SkillCuratorErrors.codes.SKILL_CURATOR_SET_NAME_INVALID,
      `Curated set name must match ${CURATED_SET_NAME_PATTERN.source} and be at most ${String(MAX_CURATED_SET_NAME_LENGTH)} characters, got ${JSON.stringify(name)}`,
      { details: { name } },
    );
  }
  return name;
}

export function isValidCuratedSetName(name: string): boolean {
  try {
    assertCuratedSetName(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Trust is deliberately not persisted: a lockfile is a document, and a
 * document that could claim "trusted" would let curator state raise skill
 * trust. Consumers derive trust from `source` via `skillTrust` at read time,
 * the same way activation does.
 */
export type CuratedSetSkillRef = Pick<SkillDefinition, 'name' | 'source' | 'path' | 'content'>;

/**
 * The fingerprint covers skill identity and content, not location: a skill
 * that moved but kept its content is provenance drift (recorded in `path`),
 * not content drift. This is what "changed" means in a set diff.
 */
export function curatedSkillFingerprint(skill: CuratedSetSkillRef): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        name: normalizeSkillName(skill.name),
        content: skill.content,
      }),
    )
    .digest('hex');
}

export function buildCuratedSetLockfile(
  name: string,
  skills: readonly CuratedSetSkillRef[],
  createdAt: number,
): CuratedSetLockfile {
  assertCuratedSetName(name);
  if (!Number.isInteger(createdAt) || createdAt < 0) {
    throw new Error2(
      SkillCuratorErrors.codes.SKILL_CURATOR_OPTIONS_INVALID,
      `createdAt must be a non-negative integer, got ${String(createdAt)}`,
      { details: { createdAt } },
    );
  }
  const entries: Record<string, CuratedSetEntry> = {};
  for (const skill of skills) {
    const key = normalizeSkillName(skill.name);
    entries[key] = {
      name: skill.name,
      fingerprint: curatedSkillFingerprint(skill),
      source: skill.source,
      path: skill.path,
    };
  }
  return { version: 1, name, createdAt, entries };
}

export function parseCuratedSetLockfile(input: unknown): CuratedSetLockfile {
  const parsed = curatedSetLockfileSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error2(
      SkillCuratorErrors.codes.SKILL_CURATOR_STATE_INVALID,
      `Invalid curated set lockfile: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
      { details: { issueCount: parsed.error.issues.length } },
    );
  }
  return parsed.data;
}

export function diffCuratedSet(
  lockfile: CuratedSetLockfile,
  skills: readonly CuratedSetSkillRef[],
): CuratedSetDiff {
  const missing: string[] = [];
  const changed: CuratedSetChange[] = [];
  const current = new Map<string, CuratedSetSkillRef>();
  for (const skill of skills) {
    current.set(normalizeSkillName(skill.name), skill);
  }
  for (const [key, entry] of Object.entries(lockfile.entries)) {
    const skill = current.get(key);
    if (skill === undefined) {
      missing.push(entry.name);
      continue;
    }
    const actual = curatedSkillFingerprint(skill);
    if (actual !== entry.fingerprint) {
      changed.push({ name: entry.name, lockfileFingerprint: entry.fingerprint, currentFingerprint: actual });
    }
  }
  const extra: string[] = [];
  for (const [key, skill] of current) {
    if (lockfile.entries[key] === undefined) extra.push(skill.name);
  }
  return {
    missing: missing.toSorted((a, b) => a.localeCompare(b)),
    changed: changed.toSorted((a, b) => a.name.localeCompare(b.name)),
    extra: extra.toSorted((a, b) => a.localeCompare(b)),
  };
}
