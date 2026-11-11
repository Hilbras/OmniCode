import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';

import { HostFileSystem } from '@hilbras/omnicode-engine/os/backends/node-local/hostFsService';
import type { ExecutableToolResult, ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import {
  LSP_BACKEND,
  analyzeSymbols,
  computeDiagnostics,
  findReferences,
  hoverSymbol,
  inferLanguage,
  runLspQuery,
  tokenAtPosition,
} from '#/code-intelligence/lsp/lsp';
import { LspTool } from '#/code-intelligence/lsp/lspTool';
import { makeTestRuntime } from '../helpers/testRuntime';

const SOURCE = `// Greets a person by name.
// Second doc line.
export function greet(name: string): string {
  return \`Hello \${name}\`;
}

const count = 1;
class Widget {
  greet(): void {}
}

greet('world');
`;

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-lsp-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function executable(execution: ToolExecution): Extract<ToolExecution, { execute: unknown }> {
  if (!('execute' in execution)) throw new Error('expected an executable tool result');
  return execution;
}

function output(result: ExecutableToolResult): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

describe('lsp deterministic fallback', () => {
  it('infers languages from file extensions', () => {
    expect(inferLanguage('a.ts')).toBe('typescript');
    expect(inferLanguage('a.tsx')).toBe('typescriptreact');
    expect(inferLanguage('a.ipynb')).toBe('json');
    expect(inferLanguage('Makefile')).toBe('plaintext');
  });

  it('extracts deterministic symbol declarations with positions', () => {
    const symbols = analyzeSymbols(SOURCE);
    expect(symbols.map((symbol) => symbol.name)).toEqual(['greet', 'count', 'Widget', 'greet']);
    expect(symbols[0]).toMatchObject({ kind: 'function', line: 3, exported: true });
    expect(symbols[0]?.column).toBeGreaterThan(1);
    expect(analyzeSymbols(SOURCE, 1)).toHaveLength(1);
  });

  it('finds bounded references and marks the definition', () => {
    const references = findReferences(SOURCE, 'greet');
    expect(references.length).toBeGreaterThanOrEqual(3);
    expect(references.filter((reference) => reference.isDefinition)).toHaveLength(2);
    expect(findReferences(SOURCE, 'greet', 1)).toHaveLength(1);
    expect(() => findReferences(SOURCE, 'not a name')).toThrow('Invalid symbol name');
  });

  it('resolves a token at a position', () => {
    expect(tokenAtPosition(SOURCE, { line: 12, column: 3 })).toBe('greet');
    expect(tokenAtPosition(SOURCE, { line: 999, column: 1 })).toBeUndefined();
  });

  it('returns hover information with preceding documentation', () => {
    const hover = hoverSymbol(SOURCE, { symbol: 'greet' });
    expect(hover).toMatchObject({ name: 'greet', kind: 'function', line: 3 });
    expect(hover?.documentation).toContain('Greets a person by name.');
    expect(hoverSymbol(SOURCE, { symbol: 'missing' })).toBeUndefined();
  });

  it('reports unbalanced delimiters and invalid JSON', () => {
    const diagnostics = computeDiagnostics('function x() {\n', 'x.ts');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('unbalanced-delimiter');
    expect(computeDiagnostics('const x = "}";', 'x.ts')).toEqual([]);
    const json = computeDiagnostics('{"a":}', 'x.json');
    expect(json[0]?.code).toBe('invalid-json');
  });

  it('returns structured query results with the fallback backend marker', () => {
    const result = runLspQuery({ action: 'symbols', path: 'a.ts', text: SOURCE, limit: 2 });
    expect(result.backend).toBe(LSP_BACKEND);
    expect(result.language).toBe('typescript');
    expect(result.symbols).toHaveLength(2);
    expect(runLspQuery({ action: 'hover', path: 'a.ts', text: SOURCE, symbol: 'greet' }).hover).toMatchObject(
      { name: 'greet' },
    );
  });
});

describe('LspTool', () => {
  it('serves symbols and references from a real file', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'sample.ts'), SOURCE, 'utf8');
    const tr = makeTestRuntime({ fs: new HostFileSystem(), workDir: dir });
    const tool = new LspTool(tr.runtimeService, tr.workspaceCtx);
    const symbols = await executable(
      tool.resolveExecution({ action: 'symbols', path: 'sample.ts' }),
    ).execute(tr.context);
    expect(output(symbols)).toContain('"backend": "deterministic-fallback"');
    expect(output(symbols)).toContain('"name": "greet"');
    const references = await executable(
      tool.resolveExecution({ action: 'references', path: 'sample.ts', symbol: 'greet' }),
    ).execute(tr.context);
    expect(output(references)).toContain('"references"');
  });

  it('reports missing files as errors', async () => {
    const dir = await tempDir();
    const tr = makeTestRuntime({ fs: new HostFileSystem(), workDir: dir });
    const tool = new LspTool(tr.runtimeService, tr.workspaceCtx);
    const missing = await executable(
      tool.resolveExecution({ action: 'symbols', path: 'missing.ts' }),
    ).execute(tr.context);
    expect(missing.isError).toBe(true);
  });
});
