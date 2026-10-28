/**
 * A deliberately small synonym table for terms that appear in both short form
 * and long form in coding conversations. It is not a thesaurus: every entry
 * exists because a real query missed a real record, and every entry expands the
 * index as well as the query so the two sides stay symmetric.
 *
 * Entries are raw words; `indexTerms` stems them, so `repositories` finds
 * `repo` through `repository` without a second entry.
 */
const GROUPS: readonly (readonly string[])[] = [
  ['repo', 'repository'],
  ['db', 'database'],
  ['config', 'configuration'],
  ['auth', 'authentication', 'authorization'],
  ['docs', 'doc', 'documentation'],
  ['dep', 'deps', 'dependency', 'dependencies'],
  ['env', 'environment'],
  ['dir', 'directory', 'folder'],
  ['pkg', 'package'],
  ['cmd', 'command'],
  ['impl', 'implementation'],
  ['perf', 'performance'],
  ['func', 'function'],
  ['spec', 'test', 'testing'],
  ['ci', 'pipeline'],
  ['k8s', 'kubernetes'],
];

const GROUP_OF: ReadonlyMap<string, readonly string[]> = new Map(
  GROUPS.flatMap((group) => group.map((term) => [term, group] as const)),
);

/** Every other member of the term's group; empty when the term is unknown. */
export function synonymsOf(term: string): readonly string[] {
  const group = GROUP_OF.get(term);
  return group === undefined ? [] : group.filter((candidate) => candidate !== term);
}

export const SYNONYM_GROUPS = GROUPS;
