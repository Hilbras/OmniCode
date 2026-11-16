import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { relative, sep } from 'node:path';

export function toSourcePath(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join('/');
}

export async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

export async function readTextFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8');
}

export async function listDirectory(dirPath: string): Promise<Dirent[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
}

export type JsonReadResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: 'unreadable-file' | 'malformed-json'; readonly message: string };

export async function readJsonFile(filePath: string): Promise<JsonReadResult> {
  let text: string;
  try {
    text = await readTextFile(filePath);
  } catch {
    return { ok: false, reason: 'unreadable-file', message: `could not read ${filePath}` };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: 'malformed-json', message: `${filePath}: ${detail}` };
  }
}
