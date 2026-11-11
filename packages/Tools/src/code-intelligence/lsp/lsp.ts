import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import type { AgentTool } from '@hilbras/omnicode-engine/tool/toolContract';

export const LSP_MAX_BYTES = 1024 * 1024;
export const LSP_DEFAULT_LIMIT = 100;
export const LSP_MAX_LIMIT = 500;
export const LSP_BACKEND = 'deterministic-fallback';

export const lspActionSchema = z.enum(['symbols', 'references', 'diagnostics', 'hover']);
export type LspAction = z.infer<typeof lspActionSchema>;

export const lspPositionSchema = z.object({
  line: z.number().int().positive().describe('1-based line number.'),
  column: z.number().int().positive().describe('1-based column number.'),
});
export type LspPosition = z.infer<typeof lspPositionSchema>;

export const LspInputSchema = z
  .object({
    action: lspActionSchema,
    path: z.string().min(1).describe('File to inspect.'),
    symbol: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Identifier for references or hover.'),
    position: lspPositionSchema.optional().describe('Source position for references or hover.'),
    limit: z
      .number()
      .int()
      .positive()
      .max(LSP_MAX_LIMIT)
      .optional()
      .describe('Maximum structured results to return; defaults to 100.'),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'references' && value.symbol === undefined && value.position === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'references requires symbol or position.',
      });
    }
    if (value.action === 'hover' && value.symbol === undefined && value.position === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'hover requires symbol or position.' });
    }
  });

export type LspInput = z.infer<typeof LspInputSchema>;

export type LspSymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'namespace'
  | 'variable'
  | 'method'
  | 'property'
  | 'import'
  | 'unknown';

export interface LspSymbol {
  readonly name: string;
  readonly kind: LspSymbolKind;
  readonly line: number;
  readonly column: number;
  readonly signature: string;
  readonly exported: boolean;
}

export interface LspLocation {
  readonly line: number;
  readonly column: number;
  readonly text: string;
  readonly isDefinition: boolean;
}

export interface LspDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

export interface LspHover {
  readonly name: string;
  readonly kind: LspSymbolKind;
  readonly line: number;
  readonly column: number;
  readonly signature: string;
  readonly documentation?: string;
}

interface DeclarationRule {
  readonly kind: LspSymbolKind;
  readonly pattern: RegExp;
  readonly nameGroup: number;
}

const DECLARATION_RULES: readonly DeclarationRule[] = [
  {
    kind: 'function',
    pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
    nameGroup: 1,
  },
  {
    kind: 'class',
    pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    nameGroup: 1,
  },
  {
    kind: 'interface',
    pattern: /^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/,
    nameGroup: 1,
  },
  {
    kind: 'type',
    pattern: /^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/,
    nameGroup: 1,
  },
  {
    kind: 'enum',
    pattern: /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/,
    nameGroup: 1,
  },
  {
    kind: 'namespace',
    pattern: /^\s*(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+([A-Za-z_$][\w$]*)/,
    nameGroup: 1,
  },
  {
    kind: 'function',
    pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/,
    nameGroup: 1,
  },
  {
    kind: 'variable',
    pattern: /^\s*(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
    nameGroup: 1,
  },
  {
    kind: 'method',
    pattern: /^\s*(?:(?:public|private|protected|static|async|readonly|override|abstract)\s+)*(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::[^={]+)?\{/,
    nameGroup: 1,
  },
  {
    kind: 'function',
    pattern: /^\s*(?:export\s+)?(?:async\s+)?def\s+([A-Za-z_][\w]*)/,
    nameGroup: 1,
  },
  {
    kind: 'class',
    pattern: /^\s*class\s+([A-Za-z_][\w]*)/,
    nameGroup: 1,
  },
  {
    kind: 'function',
    pattern: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/,
    nameGroup: 1,
  },
  {
    kind: 'import',
    pattern: /^\s*import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/,
    nameGroup: 1,
  },
];

const METHOD_NAME_EXCLUSIONS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'with',
  'function',
  'constructor',
  'return',
]);

const HOVER_PREVIOUS_LINES = 8;

export function inferLanguage(path: string): string {
  const lower = path.toLowerCase();
  const suffix = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  const mapping: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    json: 'json',
    ipynb: 'json',
    md: 'markdown',
  };
  return mapping[suffix] ?? 'plaintext';
}

export function analyzeSymbols(
  text: string,
  limit = LSP_DEFAULT_LIMIT,
): LspSymbol[] {
  const result: LspSymbol[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (result.length >= limit) break;
    const symbol = matchDeclaration(line, index + 1);
    if (symbol !== undefined) result.push(symbol);
  }
  return result;
}

function matchDeclaration(line: string, lineNumber: number): LspSymbol | undefined {
  for (const rule of DECLARATION_RULES) {
    const match = rule.pattern.exec(line);
    if (match === null) continue;
    const name = match[rule.nameGroup];
    if (name === undefined || name.length === 0) continue;
    if (rule.kind === 'method' && METHOD_NAME_EXCLUSIONS.has(name)) continue;
    const rawColumn = match[0].indexOf(name);
    const signature = line.trim().slice(0, 300);
    return {
      name,
      kind: rule.kind,
      line: lineNumber,
      column: rawColumn + 1,
      signature,
      exported: /^\s*export\b/.test(line),
    };
  }
  return undefined;
}

export function findReferences(
  text: string,
  query: string,
  limit = LSP_DEFAULT_LIMIT,
): LspLocation[] {
  if (!/^[A-Za-z_$][\w$]*$/.test(query)) {
    throw new Error(`Invalid symbol name: ${query}`);
  }
  const symbols = analyzeSymbols(text, LSP_MAX_LIMIT);
  const definitions = new Set(symbols.filter((symbol) => symbol.name === query).map((symbol) => `${String(symbol.line)}:${String(symbol.column)}`));
  const pattern = new RegExp(`(?<![A-Za-z0-9_$])${query.replace(/[$]/g, '\\$')}(?![A-Za-z0-9_$])`, 'g');
  const result: LspLocation[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (result.length >= limit) break;
    for (const match of line.matchAll(pattern)) {
      const column = (match.index ?? 0) + 1;
      result.push({
        line: index + 1,
        column,
        text: line.trim().slice(0, 200),
        isDefinition: definitions.has(`${String(index + 1)}:${String(column)}`),
      });
      if (result.length >= limit) break;
    }
  }
  return result;
}

export function tokenAtPosition(
  text: string,
  position: LspPosition,
): string | undefined {
  const line = text.split(/\r?\n/)[position.line - 1];
  if (line === undefined) return undefined;
  let index = Math.min(Math.max(0, position.column - 1), Math.max(0, line.length - 1));
  if (!isIdentifierChar(line[index])) {
    while (index >= 0 && !isIdentifierChar(line[index])) index -= 1;
    if (index < 0) {
      index = position.column - 1;
      while (index < line.length && !isIdentifierChar(line[index])) index += 1;
    }
  }
  if (index < 0 || index >= line.length || !isIdentifierChar(line[index])) return undefined;
  let start = index;
  while (start > 0 && isIdentifierChar(line[start - 1])) start -= 1;
  let end = index + 1;
  while (end < line.length && isIdentifierChar(line[end])) end += 1;
  return line.slice(start, end);
}

function isIdentifierChar(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_$]/.test(value);
}

export function hoverSymbol(
  text: string,
  input: { readonly symbol?: string; readonly position?: LspPosition },
): LspHover | undefined {
  const name = input.symbol ?? (input.position === undefined ? undefined : tokenAtPosition(text, input.position));
  if (name === undefined) return undefined;
  const lines = text.split(/\r?\n/);
  const symbols = analyzeSymbols(text, LSP_MAX_LIMIT);
  const declaration = symbols.find((symbol) => symbol.name === name);
  if (declaration === undefined) {
    let reference: LspLocation | undefined;
    try {
      reference = findReferences(text, name, 1)[0];
    } catch {
      return undefined;
    }
    if (reference === undefined) return undefined;
    return {
      name,
      kind: 'unknown',
      line: reference.line,
      column: reference.column,
      signature: reference.text,
    };
  }
  const documentation = precedingDocumentation(lines, declaration.line - 1);
  return {
    name: declaration.name,
    kind: declaration.kind,
    line: declaration.line,
    column: declaration.column,
    signature: declaration.signature,
    ...(documentation === undefined ? {} : { documentation }),
  };
}

function precedingDocumentation(lines: readonly string[], lineIndex: number): string | undefined {
  const collected: string[] = [];
  for (let index = lineIndex - 1; index >= 0 && collected.length < HOVER_PREVIOUS_LINES; index -= 1) {
    const line = lines[index]?.trim() ?? '';
    if (line.length === 0) break;
    if (line.startsWith('//') || line.startsWith('///') || line.startsWith('*') || line.startsWith('/*') || line.startsWith('#')) {
      collected.unshift(line.replace(/^\/{2,3}\s?|^\/\*\s?|^\*\s?|^#\s?/, ''));
      continue;
    }
    break;
  }
  const text = collected.join('\n').trim();
  return text.length === 0 ? undefined : text.slice(0, 500);
}

export function computeDiagnostics(
  text: string,
  path: string,
  max = 50,
): LspDiagnostic[] {
  const diagnostics: LspDiagnostic[] = [];
  const language = inferLanguage(path);
  if (language === 'json') {
    try {
      JSON.parse(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const position = message.match(/position\s+(\d+)/i);
      const offset = position?.[1] === undefined ? 0 : Number(position[1]);
      const location = locationOfOffset(text, offset);
      diagnostics.push({
        severity: 'error',
        code: 'invalid-json',
        message,
        line: location.line,
        column: location.column,
      });
    }
    return diagnostics;
  }
  if (!isBracketCheckedLanguage(language)) return diagnostics;
  return [...diagnostics, ...balanceDiagnostics(text, max - diagnostics.length)];
}

function isBracketCheckedLanguage(language: string): boolean {
  return new Set([
    'typescript',
    'typescriptreact',
    'javascript',
    'javascriptreact',
    'json',
    'go',
    'rust',
    'java',
    'c',
    'cpp',
    'csharp',
  ]).has(language);
}

function balanceDiagnostics(text: string, max: number): LspDiagnostic[] {
  const diagnostics: LspDiagnostic[] = [];
  const stack: Array<{ char: string; line: number; column: number }> = [];
  let line = 1;
  let column = 1;
  let state: 'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment' = 'code';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const next = text[index + 1];
    if (char === '\n') {
      line += 1;
      column = 1;
      if (state === 'single' || state === 'double' || state === 'line-comment') state = 'code';
      continue;
    }
    if (state === 'line-comment') {
      column += 1;
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'code';
        index += 1;
        column += 2;
        continue;
      }
      column += 1;
      continue;
    }
    if (state !== 'code') {
      if ((state === 'single' && char === "'") || (state === 'double' && char === '"') || (state === 'template' && char === '`')) {
        state = 'code';
      } else if (char === '\\') {
        index += 1;
        column += 2;
        continue;
      }
      column += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      state = 'line-comment';
      index += 1;
      column += 2;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block-comment';
      index += 1;
      column += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      state = char === "'" ? 'single' : char === '"' ? 'double' : 'template';
      column += 1;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      stack.push({ char, line, column });
    } else if (char === ')' || char === ']' || char === '}') {
      const opener = stack.pop();
      if (opener === undefined || matchingClose(opener.char) !== char) {
        if (diagnostics.length < max) {
          diagnostics.push({
            severity: 'error',
            code: 'unbalanced-delimiter',
            message: `Unmatched closing delimiter '${char}'.`,
            line,
            column,
          });
        }
      }
    }
    column += 1;
  }
  for (const opener of stack.reverse()) {
    if (diagnostics.length >= max) break;
    diagnostics.push({
      severity: 'error',
      code: 'unbalanced-delimiter',
      message: `Unclosed delimiter '${opener.char}'.`,
      line: opener.line,
      column: opener.column,
    });
  }
  return diagnostics;
}

function matchingClose(opener: string): string {
  return opener === '(' ? ')' : opener === '[' ? ']' : '}';
}

function locationOfOffset(text: string, offset: number): { line: number; column: number } {
  const bounded = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, bounded);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

export interface LspQueryResult {
  readonly backend: typeof LSP_BACKEND;
  readonly action: LspAction;
  readonly path: string;
  readonly language: string;
  readonly symbol?: string;
  readonly position?: LspPosition;
  readonly symbols?: readonly LspSymbol[];
  readonly references?: readonly LspLocation[];
  readonly diagnostics?: readonly LspDiagnostic[];
  readonly hover?: LspHover | null;
}

export function runLspQuery(input: {
  readonly action: LspAction;
  readonly path: string;
  readonly text: string;
  readonly symbol?: string;
  readonly position?: LspPosition;
  readonly limit?: number;
}): LspQueryResult {
  const limit = Math.max(1, Math.min(input.limit ?? LSP_DEFAULT_LIMIT, LSP_MAX_LIMIT));
  const base = {
    backend: LSP_BACKEND,
    action: input.action,
    path: input.path,
    language: inferLanguage(input.path),
    ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
    ...(input.position === undefined ? {} : { position: input.position }),
  } as const;
  if (input.action === 'symbols') {
    return { ...base, symbols: analyzeSymbols(input.text, limit) };
  }
  if (input.action === 'diagnostics') {
    return { ...base, diagnostics: computeDiagnostics(input.text, input.path, limit) };
  }
  const name =
    input.symbol ??
    (input.position === undefined ? undefined : tokenAtPosition(input.text, input.position));
  if (name === undefined) {
    throw new Error(`${input.action} requires a symbol or a position over an identifier.`);
  }
  if (input.action === 'references') {
    return { ...base, references: findReferences(input.text, name, limit) };
  }
  return { ...base, hover: hoverSymbol(input.text, { symbol: name }) ?? null };
}

export interface ILspTool extends AgentTool<LspInput> {
  readonly _serviceBrand: undefined;
}
export const ILspTool = createDecorator<ILspTool>('lspTool');
