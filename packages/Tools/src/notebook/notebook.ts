import { z } from 'zod';

import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import type { AgentTool } from '@hilbras/omnicode-engine/tool/toolContract';

export const NOTEBOOK_MAX_BYTES = 5 * 1024 * 1024;
export const NOTEBOOK_MAX_CELLS = 5_000;
export const NOTEBOOK_MAX_SOURCE_CHARS = 200_000;
export const NOTEBOOK_READ_MAX_CHARS = 30_000;

export const notebookCellTypeSchema = z.enum(['code', 'markdown', 'raw']);
export type NotebookCellType = z.infer<typeof notebookCellTypeSchema>;

export const notebookCellSchema = z
  .object({
    cell_type: notebookCellTypeSchema,
    source: z.union([z.string(), z.array(z.string())]),
    metadata: z.record(z.string(), z.unknown()).optional(),
    execution_count: z.number().int().nullable().optional(),
    outputs: z.array(z.unknown()).optional(),
    id: z.string().optional(),
  })
  .passthrough();

export const notebookSchema = z
  .object({
    nbformat: z.literal(4),
    nbformat_minor: z.number().int().nonnegative(),
    metadata: z.record(z.string(), z.unknown()),
    cells: z.array(notebookCellSchema).max(NOTEBOOK_MAX_CELLS),
  })
  .passthrough();

export type NotebookCell = z.infer<typeof notebookCellSchema> & Record<string, unknown>;
export interface NotebookDocument {
  readonly nbformat: 4;
  readonly nbformat_minor: number;
  readonly metadata: Record<string, unknown>;
  readonly cells: readonly NotebookCell[];
  readonly [key: string]: unknown;
}

export function parseNotebook(text: string): NotebookDocument {
  const raw: unknown = JSON.parse(text);
  return notebookSchema.parse(raw) as NotebookDocument;
}

export function serializeNotebook(document: NotebookDocument): string {
  notebookSchema.parse(document);
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function cellSource(cell: NotebookCell): string {
  return typeof cell.source === 'string' ? cell.source : cell.source.join('');
}

export function summarizeNotebook(document: NotebookDocument, maxChars = NOTEBOOK_READ_MAX_CHARS): string {
  const lines = [
    `nbformat: ${String(document.nbformat)}.${String(document.nbformat_minor)}`,
    `cells: ${String(document.cells.length)}`,
  ];
  let remaining = Math.max(0, maxChars - lines.join('\n').length - 2);
  for (const [index, cell] of document.cells.entries()) {
    const source = cellSource(cell);
    const header = `--- cell ${String(index)} [${cell.cell_type}]${cell.id === undefined ? '' : ` id=${cell.id}`} ---\n`;
    if (remaining <= header.length) {
      lines.push('...[notebook output truncated]');
      break;
    }
    const body = source.length + 1 > remaining - header.length ? `${source.slice(0, Math.max(0, remaining - header.length - 1))}…` : source;
    lines.push(`${header}${body}`);
    remaining -= header.length + body.length + 1;
  }
  return lines.join('\n');
}

export function insertNotebookCell(
  document: NotebookDocument,
  input: { readonly index?: number; readonly cellType: NotebookCellType; readonly source: string },
): { document: NotebookDocument; index: number } {
  if (document.cells.length >= NOTEBOOK_MAX_CELLS) {
    throw new Error(`Notebook cell limit reached (max ${String(NOTEBOOK_MAX_CELLS)}).`);
  }
  const index = input.index ?? document.cells.length;
  if (index < 0 || index > document.cells.length) {
    throw new Error(`Cell index ${String(index)} is out of range 0..${String(document.cells.length)}.`);
  }
  const cell: NotebookCell = {
    cell_type: input.cellType,
    source: input.source,
    metadata: {},
    ...(input.cellType === 'code' ? { execution_count: null, outputs: [] } : {}),
  };
  const cells = document.cells.slice();
  cells.splice(index, 0, cell);
  return { document: { ...document, cells }, index };
}

export function replaceNotebookCell(
  document: NotebookDocument,
  input: {
    readonly index: number;
    readonly source?: string;
    readonly cellType?: NotebookCellType;
  },
): NotebookDocument {
  const current = document.cells[input.index];
  if (current === undefined) {
    throw new Error(`Cell index ${String(input.index)} is out of range.`);
  }
  if (input.source === undefined && input.cellType === undefined) {
    throw new Error('replace requires source or cell_type.');
  }
  const nextType = input.cellType ?? current.cell_type;
  const updated: NotebookCell = {
    ...current,
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.cellType === undefined ? {} : { cell_type: input.cellType }),
  };
  if (nextType === 'code' && updated.outputs === undefined) {
    updated.outputs = [];
  }
  if (nextType !== 'code') {
    delete updated.execution_count;
    delete updated.outputs;
  }
  const cells = document.cells.slice();
  cells[input.index] = updated;
  return { ...document, cells };
}

export function deleteNotebookCell(
  document: NotebookDocument,
  index: number,
): { document: NotebookDocument; removed: NotebookCell } {
  const removed = document.cells[index];
  if (removed === undefined) {
    throw new Error(`Cell index ${String(index)} is out of range.`);
  }
  const cells = document.cells.slice();
  cells.splice(index, 1);
  return { document: { ...document, cells }, removed };
}

export const NotebookEditInputSchema = z
  .object({
    action: z.enum(['read', 'insert', 'replace', 'delete']).describe('Notebook operation.'),
    path: z.string().min(1).describe('Path to an .ipynb notebook.'),
    index: z.number().int().nonnegative().optional().describe('Zero-based cell index.'),
    cell_type: notebookCellTypeSchema.optional().describe('Cell type for insert or replace.'),
    source: z
      .string()
      .max(NOTEBOOK_MAX_SOURCE_CHARS)
      .optional()
      .describe('Cell source for insert or replace.'),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'insert' && value.source === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'insert requires source.' });
    }
    if (value.action === 'insert' && value.cell_type === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'insert requires cell_type.' });
    }
    if (value.action === 'replace' && value.source === undefined && value.cell_type === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'replace requires source or cell_type.' });
    }
    if ((value.action === 'replace' || value.action === 'delete') && value.index === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${value.action} requires index.` });
    }
  });

export type NotebookEditInput = z.infer<typeof NotebookEditInputSchema>;

export interface INotebookEditTool extends AgentTool<NotebookEditInput> {
  readonly _serviceBrand: undefined;
}
export const INotebookEditTool = createDecorator<INotebookEditTool>('notebookEditTool');
