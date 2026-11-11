# packages/tree-sitter-bash — Agent Guide

Read the root `AGENTS.md` first. This is a leaf package.

## Role and non-goals

Pure-TypeScript bash parser for agent-side command permission analysis. Its
named node types match tree-sitter-bash 0.25.0 one-to-one, while offsets are
UTF-16 and parsing is budgeted and never throws.

Non-goals: it does not execute commands, decide permissions, resolve paths, or
model shell semantics. It produces a syntax tree only.

## Entry points and modules

Root `@hilbras/omnicode-tree-sitter-bash` (`src/index.ts`) re-exports `node`,
`budget`, `parse`, and `grammar`.

```ts
import { parse } from '@hilbras/omnicode-tree-sitter-bash';
const result = parse('git status && rm -rf /');
if (result.ok) {
  result.rootNode;
  result.hasError;
}
```

Public surface:

- `parse(source, options?)` → `{ ok: true, rootNode, hasError }` or
  `{ ok: false, reason: 'aborted' }`.
- `ParseOptions`: `timeoutMs` (default 50 ms, `Infinity` disables the time
  check) and `maxNodes` (default 50,000).
- `SyntaxNode`: `type`, `text`, UTF-16 `startIndex`/`endIndex`, `isNamed`,
  `parent`, `children`, `namedChildren`; `descendantsOfType`.
- `ParseBudget`, `Aborted`, grammar tables.

Modules: `parse.ts` (entry and last-resort recovery), `parser.ts` (recursive
descent), `lexer.ts` (scanning/substitutions/heredocs), `node.ts` (immutable
tree model), `budget.ts`, `grammar.ts` (operators/keywords/variables).

## Layering rules
- Leaf law: no `@hilbras/omnicode-*` imports.
- No runtime deps; `tree-sitter-bash`/`web-tree-sitter` are dev-only for tests.
- No native addons or wasm at runtime.
## Local constraints
- Offsets are UTF-16; `node.text === source.slice(startIndex, endIndex)` always.
- `parse` never throws: budget → aborted; malformed → `ok: true, hasError`;
  internal bug → `program` root with one `ERROR` child. `Aborted` never escapes.
- `SyntaxNodeBuilder` enforces containment, source order, non-overlap, one
  parent; those invariants are structural tests.
- Depth caps: substitution 150, parse 500, lexer scan 1024; degrade locally with
  `hasError`, never overflow.
- Known deviations are fixture + registry + README anchor; fix all three.
- Reference is tree-sitter-bash 0.25.0; review before upgrading.
- Long scan loops must call `budget.progress()`.

## Tests
Test root: `packages/tree-sitter-bash/test/`; `test` script exists; project:
`tree-sitter-bash`.
```bash
pnpm --filter @hilbras/omnicode-tree-sitter-bash test
pnpm --filter @hilbras/omnicode-tree-sitter-bash exec vitest run test/parse.test.ts
pnpm --filter @hilbras/omnicode-tree-sitter-bash typecheck
```
- `differential.test.ts` compares fixtures and the official corpus with the real
  wasm parser byte-for-byte; `@known-diff` samples must still differ and match
  their stored dump.
- `fuzz.test.ts` is deterministic; scale with `TS_BASH_FUZZ_SCALE=N`.
- `performance.test.ts` is an order-of-magnitude smoke test, not an absolute
  benchmark floor.

## Local traps

- The README "Known differences" text is enforced by `readmeAnchor`; editing one
  side alone fails the suite.
- Changing a known deviation to match the reference must remove its fixture,
  registry entry, and corpus `known-diffs.txt` entry at the same time.
- `test/fixtures/` is source data, not generated output; keep stored dumps
  exact.
- The parser's catch-all recovery is intentional but can hide an internal bug;
  fuzz/integrity tests, not production exceptions, are the detection point.

## Belongs here vs neighbours

- Permission classification and command policy: `engine`.
- Process execution and filesystem access: `Kaos`.
- Shell quoting for remote execution: `Kaos`, not the parser.
