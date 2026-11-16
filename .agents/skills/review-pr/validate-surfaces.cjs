// Validates the review-pr surface checklist against the real tree.
//
// The checklist's failure mode is rot: it names entry points, contract files and
// guard tests, and a rename anywhere in the repo turns those names into false
// facts that a reviewer would trust. This validator extracts every path-shaped
// token from the checklist, resolves it against the repository, and reports the
// ones that no longer exist, so `pnpm check:guards` (via `check:skills`) fails
// instead of letting the checklist drift.
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SURFACES_PATH = path.join(__dirname, "surfaces.md");

const REQUIRED_MARKERS = [
  "按本仓库重建",
  "## 人群与 surface 清单",
  "## 历史案例",
  "## 触发线索",
];

// Each table is checked for its own column count, since the checklist carries two:
// the audience inventory (人群 | 入口与契约 | 破坏性变更 | 守卫) and the regression
// ledger (回归 | 人群 | 守卫).
const TABLE_SHAPES = new Map([
  ["## 人群与 surface 清单", 4],
  ["## 历史案例", 3],
]);

const TABLE_HEADER_FIRST_CELLS = ["人群", "回归"];

// The checklist is only useful if it still carries a real set of guards. This is a
// gut check against the file being emptied rather than kept accurate.
const MIN_CITED_GUARDS = 8;

// Named in the checklist because it does NOT exist: the ported version described a
// tree with an IDE extension here. Two-sided on purpose — the cite is skipped by the
// existence check, and the validator fails if such a path ever appears, which would
// mean the cautionary note has gone stale.
const MUST_NOT_EXIST = ["apps/vscode"];

function looksLikeRepoPath(token) {
  if (token === "") return false;
  // Commands, globs, prose with spaces, URLs and env assignments are not paths.
  if (/[\s*?=]/.test(token)) return false;
  if (!token.includes("/")) return false;
  if (token.startsWith("-") || token.startsWith("http") || token.startsWith("@")) {
    return false;
  }
  return true;
}

function normalizePathToken(token) {
  return token
    .replace(/:\d+(-\d+)?$/, "")
    .replace(/\/+$/, "");
}

function extractPathTokens(markdown) {
  const tokens = new Set();
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
    const raw = match[1].trim();
    if (!looksLikeRepoPath(raw)) continue;
    tokens.add(normalizePathToken(raw));
  }
  return [...tokens].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function sections(markdown) {
  const byHeading = new Map();
  let current = "";
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      current = line.trim();
      byHeading.set(current, []);
      continue;
    }
    if (current !== "") byHeading.get(current).push(line);
  }
  return byHeading;
}

function tableRows(lines) {
  return lines
    .filter((line) => line.trimStart().startsWith("|"))
    .filter((line) => !/^\|\s*-{2,}/.test(line.trim()))
    .filter(
      (line) =>
        !TABLE_HEADER_FIRST_CELLS.some((cell) =>
          new RegExp(`^\\|\\s*${cell}\\s*\\|`).test(line.trim()),
        ),
    );
}

function checkTableShape(markdown, problems) {
  const byHeading = sections(markdown);
  for (const [heading, expectedCells] of TABLE_SHAPES) {
    const lines = byHeading.get(heading);
    if (lines === undefined) {
      problems.push(`missing table section: ${heading}`);
      continue;
    }
    const rows = tableRows(lines);
    if (rows.length === 0) problems.push(`no rows in ${heading}`);
    for (const row of rows) {
      const cells = row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
      if (cells.length !== expectedCells) {
        problems.push(
          `row has ${cells.length} cells, expected ${expectedCells}: ${row.slice(0, 70)}`,
        );
      }
      if (cells.some((cell) => cell.trim() === "")) {
        problems.push(`row has an empty cell: ${row.slice(0, 70)}`);
      }
    }
  }
}

function validateSurfaces(markdown, { root = REPO_ROOT } = {}) {
  const problems = [];

  for (const marker of REQUIRED_MARKERS) {
    if (!markdown.includes(marker)) problems.push(`missing required marker: ${marker}`);
  }

  checkTableShape(markdown, problems);

  const tokens = extractPathTokens(markdown);
  for (const token of MUST_NOT_EXIST) {
    if (fs.existsSync(path.join(root, token))) {
      problems.push(`path is cited as absent but exists: ${token}`);
    }
  }
  for (const token of tokens) {
    if (MUST_NOT_EXIST.includes(token)) continue;
    if (!fs.existsSync(path.join(root, token))) {
      problems.push(`cited path does not exist: ${token}`);
    }
  }

  const guardTokens = tokens.filter(
    (token) => token.includes("/test") || token.endsWith(".test.ts") || token.endsWith(".mjs"),
  );
  if (guardTokens.length < MIN_CITED_GUARDS) {
    problems.push(
      `only ${guardTokens.length} guard paths cited, expected at least ${MIN_CITED_GUARDS}`,
    );
  }

  return problems;
}

function readSurfaces() {
  return fs.readFileSync(SURFACES_PATH, "utf8");
}

module.exports = {
  MIN_CITED_GUARDS,
  MUST_NOT_EXIST,
  REPO_ROOT,
  REQUIRED_MARKERS,
  SURFACES_PATH,
  TABLE_SHAPES,
  extractPathTokens,
  looksLikeRepoPath,
  normalizePathToken,
  readSurfaces,
  validateSurfaces,
};
