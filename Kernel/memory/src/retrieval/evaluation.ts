export interface RelevanceJudgement {
  readonly memoryId: string;
  readonly relevant: boolean;
}

export interface RankingMetrics {
  readonly queries: number;
  readonly recallAtK: number;
  readonly precisionAtK: number;
  readonly meanReciprocalRank: number;
  readonly noResult: number;
}

export function recallAtK(ranked: readonly string[], expected: ReadonlySet<string>, k: number): number {
  const top = new Set(ranked.slice(0, k));
  let found = 0;
  for (const id of expected) {
    if (top.has(id)) found += 1;
  }
  return found / expected.size;
}

export function precisionAtK(ranked: readonly string[], expected: ReadonlySet<string>, k: number): number {
  const top = ranked.slice(0, k);
  if (top.length === 0) return 0;
  let relevant = 0;
  for (const id of top) {
    if (expected.has(id)) relevant += 1;
  }
  return relevant / top.length;
}

export function reciprocalRank(ranked: readonly string[], expected: ReadonlySet<string>): number {
  for (let index = 0; index < ranked.length; index += 1) {
    const id = ranked[index];
    if (id !== undefined && expected.has(id)) return 1 / (index + 1);
  }
  return 0;
}

export function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface EvaluationCase {
  readonly query: string;
  readonly ranked: readonly RelevanceJudgement[];
}

export function evaluate(cases: readonly EvaluationCase[], k: number): RankingMetrics {
  if (k < 1) throw new RangeError(`evaluation cutoff must be positive, got ${k}`);
  const recalls: number[] = [];
  const precisions: number[] = [];
  const ranks: number[] = [];
  let noResult = 0;
  for (const entry of cases) {
    const expected = new Set(
      entry.ranked.filter((judgement) => judgement.relevant).map((judgement) => judgement.memoryId),
    );
    if (expected.size === 0) {
      throw new Error(
        `evaluation case has no relevant memory, which would score recall as a perfect 1.0: ${entry.query}`,
      );
    }
    const ordered = entry.ranked.map((judgement) => judgement.memoryId);
    if (ordered.length === 0) noResult += 1;
    recalls.push(recallAtK(ordered, expected, k));
    precisions.push(precisionAtK(ordered, expected, k));
    ranks.push(reciprocalRank(ordered, expected));
  }
  return {
    queries: cases.length,
    recallAtK: average(recalls),
    precisionAtK: average(precisions),
    meanReciprocalRank: average(ranks),
    noResult,
  };
}
export interface LabelledMemory {
  readonly corpusId: string;
  readonly subject: string;
  readonly content: string;
  readonly category: 'fact' | 'preference';
  readonly sourceType: 'repository_file' | 'user_statement';
  readonly origin: 'application' | 'user';
  readonly global: boolean;
}

export const EVAL_CORPUS: readonly LabelledMemory[] = [
  { corpusId: 'build-tool', subject: 'build.bundler', content: 'the cli is bundled with tsup and the output goes to dist/', category: 'fact', sourceType: 'repository_file', origin: 'application', global: false },
  { corpusId: 'test-runner', subject: 'testing.runner', content: 'unit tests run under vitest with coverage reported to reports/latest', category: 'fact', sourceType: 'repository_file', origin: 'application', global: false },
  { corpusId: 'lint-script', subject: 'linting.command', content: 'linting runs oxlint with the type aware ruleset', category: 'fact', sourceType: 'repository_file', origin: 'application', global: false },
  { corpusId: 'commit-style', subject: 'vcs.commitStyle', content: 'the user prefers concise commit messages in the imperative mood', category: 'preference', sourceType: 'user_statement', origin: 'user', global: true },
  { corpusId: 'release-tag', subject: 'release.tagging', content: 'releases are tagged with a leading v and published from the main branch', category: 'fact', sourceType: 'repository_file', origin: 'application', global: false },
  { corpusId: 'db-lock', subject: 'storage.locking', content: 'the embedded store takes an exclusive lock so only one process writes it', category: 'fact', sourceType: 'repository_file', origin: 'application', global: false },
  { corpusId: 'schema-migration', subject: 'storage.migrations', content: 'schema versions are recorded in the store and migrated forward on open', category: 'fact', sourceType: 'repository_file', origin: 'application', global: false },
  { corpusId: 'search-index', subject: 'search.index', content: 'the global search index is sharded across sixteen minidb instances', category: 'fact', sourceType: 'repository_file', origin: 'application', global: false },
  { corpusId: 'cache-policy', subject: 'runtime.cache', content: 'the telemetry buffer flushes every five hundred milliseconds', category: 'fact', sourceType: 'repository_file', origin: 'application', global: false },
  { corpusId: 'permission-model', subject: 'security.permissions', content: 'a tool approval rule is required before any write outside the workspace', category: 'fact', sourceType: 'repository_file', origin: 'application', global: false },
];

export const EVAL_QUERIES: readonly { readonly query: string; readonly corpusId: string }[] = [
  { query: 'how do we bundle the cli', corpusId: 'build-tool' },
  { query: 'what runs the unit tests', corpusId: 'test-runner' },
  { query: 'which linter do we use', corpusId: 'lint-script' },
  { query: 'how should I write commit messages', corpusId: 'commit-style' },
  { query: 'how are releases tagged', corpusId: 'release-tag' },
  { query: 'can two processes write the store at once', corpusId: 'db-lock' },
  { query: 'what happens when the schema version changes', corpusId: 'schema-migration' },
  { query: 'how many shards does the search index use', corpusId: 'search-index' },
  { query: 'telemetry flush interval', corpusId: 'cache-policy' },
  { query: 'when do we need approval for writes', corpusId: 'permission-model' },
];
