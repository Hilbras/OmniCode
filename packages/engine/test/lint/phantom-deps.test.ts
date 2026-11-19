import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  analyzeWorkspace,
  extractBareSpecifiers,
  packageNameOf,
} from '../../../../scripts/check-phantom-deps.mjs';

function fixture(files: Record<string, string>, yaml = "packages:\n  - 'packages/*'\n"): string {
  const root = mkdtempSync(join(tmpdir(), 'phantom-deps-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), yaml);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function manifest(deps: Record<string, string> = {}): string {
  return JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: deps });
}

describe('extractBareSpecifiers', () => {
  it('finds static imports, type imports, exports and dynamic imports with lines', () => {
    const text = [
      "import x from 'alpha';",
      "import type { T } from '@scope/beta/sub';",
      "export { y } from 'gamma';",
      "const m = await import('delta');",
      "const r = require('epsilon');",
    ].join('\n');
    expect(extractBareSpecifiers(text).map((s) => [s.specifier, s.line])).toEqual([
      ['alpha', 1],
      ['@scope/beta/sub', 2],
      ['gamma', 3],
      ['delta', 4],
      ['epsilon', 5],
    ]);
  });

  it('ignores relative paths, internal aliases, node builtins and template placeholders', () => {
    const text = [
      "import a from './local';",
      "import b from '#/own/module';",
      "import c from 'node:fs';",
      "import d from 'fs';",
      "import e from '${DYNAMIC}';",
    ].join('\n');
    expect(extractBareSpecifiers(text).map((s) => s.specifier)).toEqual([
      './local', '#/own/module', 'node:fs', 'fs',
    ]);
    expect(extractBareSpecifiers(text).map((s) => packageNameOf(s.specifier))).toEqual([
      undefined, undefined, undefined, undefined,
    ]);
  });

  it('does not treat a member call named import as an import', () => {
    expect(extractBareSpecifiers("ObjC.import('AppKit');")).toEqual([]);
  });
});

describe('analyzeWorkspace', () => {
  it('flags a runtime import that is not declared in package.json (fail on base)', () => {
    const root = fixture({
      'packages/demo/package.json': manifest(),
      'packages/demo/src/main.ts': "import { pathe } from 'pathe';\n",
    });
    try {
      const { violations } = analyzeWorkspace(root);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({
        name: 'pathe', kind: 'phantom', dir: 'packages/demo', line: 1,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes once the dependency is declared', () => {
    const root = fixture({
      'packages/demo/package.json': manifest({ pathe: '^1.0.0' }),
      'packages/demo/src/main.ts': "import { pathe } from 'pathe';\n",
    });
    try {
      expect(analyzeWorkspace(root).violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts a root-provided tool via the allowlist and rejects a stale entry', () => {
    const root = fixture({
      'packages/demo/package.json': manifest(),
      'packages/demo/src/main.ts': "import { fn } from 'root-tool';\n",
    });
    try {
      expect(analyzeWorkspace(root, { 'root-tool': 'provided by the root workspace' }).violations)
        .toEqual([]);
      expect(analyzeWorkspace(root, {
        'root-tool': 'provided by the root workspace',
        'gone-tool': 'no longer used',
      }).violations).toMatchObject([{ name: 'gone-tool', kind: 'stale-allowlist' }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not flag a package importing itself through its public name', () => {
    const root = fixture({
      'packages/demo/package.json': JSON.stringify({
        name: '@scope/demo', version: '1.0.0', dependencies: {},
      }),
      'packages/demo/src/main.ts': "export * from '@scope/demo/sub';\n",
    });
    try {
      expect(analyzeWorkspace(root).violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps nested packages separate instead of charging imports to the parent', () => {
    const root = fixture({
      'packages/shell/package.json': manifest(),
      'packages/shell/src/index.ts': "export const x = 1;\n",
      'packages/shell/child/package.json': JSON.stringify({
        name: 'child', version: '1.0.0', dependencies: {},
      }),
      'packages/shell/child/src/index.ts': "import { z } from 'zod';\n",
    }, "packages:\n  - 'packages/*'\n  - 'packages/shell/child'\n");
    try {
      const { violations, packages } = analyzeWorkspace(root);
      expect(packages).toBe(2);
      expect(violations).toMatchObject([{ dir: 'packages/shell/child', name: 'zod' }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
