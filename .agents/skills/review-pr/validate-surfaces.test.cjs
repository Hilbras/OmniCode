const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MIN_CITED_GUARDS,
  MUST_NOT_EXIST,
  extractPathTokens,
  readSurfaces,
  validateSurfaces,
} = require("./validate-surfaces.cjs");

const GUIDES = ["packages/a/test", "packages/b/test", "apps/c/test", "packages/d/test"];
const GUARD_FILES = [
  "packages/a/test/one.test.ts",
  "packages/b/test/two.test.ts",
  "apps/c/test/three.test.ts",
  "packages/d/test/four.test.ts",
];

function makeRoot(paths) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-pr-surfaces-"));
  for (const entry of paths) {
    const target = path.join(root, entry);
    fs.mkdirSync(entry.includes(".") ? path.dirname(target) : target, { recursive: true });
    if (entry.includes(".")) fs.writeFileSync(target, "// fixture\n");
  }
  return root;
}

const MISSING_GUIDES = ["packages/missing/test", "apps/missing/test"];

function syntheticRows(guides = GUIDES) {
  return Array.from({ length: 8 }, (_, index) => {
    const guide = guides[index % guides.length];
    const guard = GUARD_FILES[index % GUARD_FILES.length];
    return `| 人群 ${index} | \`${guide}\` | 变化 | \`${guard}\` |`;
  });
}

function fixture({
  rows,
  history,
  heading = "## 人群与 surface 清单",
  triggers = "## 触发线索",
} = {}) {
  const body = rows ?? syntheticRows();
  const historyRows = history ?? [`| 例 | 人群 0 | \`${GUARD_FILES[0]}\` |`];
  return [
    "# 按本仓库重建",
    "",
    heading,
    "",
    "| 人群 | 入口与契约 | 对他们是破坏性变更 | 守卫 |",
    "|---|---|---|---|",
    ...body,
    "",
    "## 历史案例",
    "",
    "| 回归 | 人群 | 守卫 |",
    "|---|---|---|",
    ...historyRows,
    "",
    triggers,
    "",
    "- 改 `packages/a/test/**` → 第一行。",
    "",
  ].join("\n");
}

test("the committed checklist validates against the real tree", () => {
  assert.deepEqual(validateSurfaces(readSurfaces()), []);
});

test("a complete synthetic checklist validates when its paths exist", () => {
  const root = makeRoot([...GUIDES, ...GUARD_FILES]);
  assert.deepEqual(validateSurfaces(fixture(), { root }), []);
});

test("flags a cited path that does not exist", () => {
  const root = makeRoot([...GUARD_FILES]);
  const problems = validateSurfaces(fixture({ rows: syntheticRows(MISSING_GUIDES) }), { root });
  assert.ok(
    problems.some((problem) =>
      problem.includes(`cited path does not exist: ${MISSING_GUIDES[0]}`),
    ),
    `expected a missing-path problem, got ${JSON.stringify(problems)}`,
  );
});

test("flags a path that is cited as absent but exists", () => {
  const root = makeRoot([...GUIDES, ...GUARD_FILES, ...MUST_NOT_EXIST]);
  const problems = validateSurfaces(fixture(), { root });
  assert.ok(
    problems.some((problem) =>
      problem.includes(`path is cited as absent but exists: ${MUST_NOT_EXIST[0]}`),
    ),
    `expected an unexpected-path problem, got ${JSON.stringify(problems)}`,
  );
});

test("flags a missing required marker", () => {
  const root = makeRoot([...GUIDES, ...GUARD_FILES]);
  const problems = validateSurfaces(fixture({ triggers: "## 别的东西" }), { root });
  assert.ok(problems.some((problem) => problem.includes("missing required marker: ## 触发线索")));
});

test("flags a table row with the wrong number of cells", () => {
  const root = makeRoot([...GUIDES, ...GUARD_FILES]);
  const rows = [
    `| CLI 用户 | \`packages/a/test\` | 参数改名 |`,
    ...Array.from({ length: 8 }, (_, index) => {
      const guide = GUIDES[index % GUIDES.length];
      const guard = GUARD_FILES[index % GUARD_FILES.length];
      return `| 人群 ${index} | \`${guide}\` | 变化 | \`${guard}\` |`;
    }),
  ];
  const problems = validateSurfaces(fixture({ rows }), { root });
  assert.ok(problems.some((problem) => problem.includes("row has 3 cells, expected 4")));
});

test("flags a table row with an empty cell", () => {
  const root = makeRoot([...GUIDES, ...GUARD_FILES]);
  const rows = [
    `| CLI 用户 |  | 参数改名 | \`packages/a/test/one.test.ts\` |`,
    ...Array.from({ length: 8 }, (_, index) => {
      const guide = GUIDES[index % GUIDES.length];
      const guard = GUARD_FILES[index % GUARD_FILES.length];
      return `| 人群 ${index} | \`${guide}\` | 变化 | \`${guard}\` |`;
    }),
  ];
  const problems = validateSurfaces(fixture({ rows }), { root });
  assert.ok(problems.some((problem) => problem.includes("row has an empty cell")));
});

test("flags a history row with the wrong number of cells", () => {
  const root = makeRoot([...GUIDES, ...GUARD_FILES]);
  const problems = validateSurfaces(fixture({ history: ["| 例 | 人群 0 |"] }), { root });
  assert.ok(
    problems.some((problem) => problem.includes("row has 2 cells, expected 3")),
    `expected a history-shape problem, got ${JSON.stringify(problems)}`,
  );
});

test("flags a checklist that cites too few guards", () => {
  const root = makeRoot([...GUIDES, ...GUARD_FILES]);
  const rows = [
    `| CLI 用户 | \`packages/a/test\` | 参数改名 | \`packages/a/test/one.test.ts\` |`,
  ];
  const problems = validateSurfaces(fixture({ rows }), { root });
  assert.ok(
    problems.some((problem) =>
      problem.includes(`expected at least ${MIN_CITED_GUARDS}`),
    ),
  );
});

test("extracts paths and ignores commands, globs and non-paths", () => {
  const tokens = extractPathTokens(
    [
      "`pnpm check:generated`",
      "`packages/engine/src/**`",
      "`config.toml`",
      "`packages/SDK/src/index.ts`",
      "`apps/omnicode-cli/test/e2e/pty-tui.e2e.test.ts`",
      "`packages/engine/docs/wire-manifest.d.ts:12`",
      "`@hilbras/omnicode-sdk`",
    ].join("\n"),
  );
  assert.deepEqual(tokens, [
    "apps/omnicode-cli/test/e2e/pty-tui.e2e.test.ts",
    "packages/SDK/src/index.ts",
    "packages/engine/docs/wire-manifest.d.ts",
  ]);
});
