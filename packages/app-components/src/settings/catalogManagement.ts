// Shared plumbing for the Settings → Skills / Subagents / MCP Servers panels:
// error text, save-to-disk for exports, and create-form validation.
import type {
  AppCatalogCreateInput,
  AppCatalogDownload,
} from '@hilbras/app-core/api';

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Save an exported archive/JSON through a throwaway object URL. */
export function saveDownload(file: AppCatalogDownload): void {
  const url = URL.createObjectURL(file.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function emptyCreateInput(): AppCatalogCreateInput {
  return { name: '', description: '', content: '', whenToUse: '' };
}

const CATALOG_NAME_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export function validateCreateInput(input: AppCatalogCreateInput): 'name' | 'description' | 'content' | undefined {
  if (!CATALOG_NAME_PATTERN.test(input.name.trim())) return 'name';
  if (input.description.trim() === '') return 'description';
  if (input.content.trim() === '') return 'content';
  return undefined;
}

export function sourceTone(source: string): 'neutral' | 'info' | 'success' {
  if (source === 'user') return 'success';
  if (source === 'project') return 'info';
  return 'neutral';
}
