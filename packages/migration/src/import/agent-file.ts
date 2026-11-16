import { relative, sep } from 'node:path';

import { readTextFile } from './files.js';
import { parseFrontmatter, readAttribute, readListAttribute } from './frontmatter.js';
import type { ImportedAgent, ImportWarning } from './schema.js';

function toSourcePath(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join('/');
}

export async function readAgentFile(input: {
  readonly root: string;
  readonly filePath: string;
  readonly fallbackName: string;
  readonly warnings: ImportWarning[];
}): Promise<ImportedAgent | undefined> {
  const sourcePath = toSourcePath(input.root, input.filePath);

  let text: string;
  try {
    text = await readTextFile(input.filePath);
  } catch {
    input.warnings.push({
      code: 'unreadable-file',
      message: `could not read ${sourcePath}`,
      sourcePath,
    });
    return undefined;
  }

  const parsed = parseFrontmatter(text);
  if (!parsed.ok) {
    input.warnings.push({
      code: 'malformed-frontmatter',
      message: `${sourcePath}: ${parsed.reason}`,
      sourcePath,
    });
    return undefined;
  }

  const name = readAttribute(parsed.attributes, 'name') ?? input.fallbackName;
  if (name.trim() === '') {
    input.warnings.push({
      code: 'missing-name',
      message: `agent has no usable name: ${sourcePath}`,
      sourcePath,
    });
    return undefined;
  }

  const agent: ImportedAgent = {
    name,
    instructions: parsed.body.trim(),
    sourcePath,
  };
  const description = readAttribute(parsed.attributes, 'description');
  if (description !== undefined) agent.description = description;
  const tools = readListAttribute(parsed.attributes, 'tools');
  if (tools !== undefined) agent.tools = tools;
  const model = readAttribute(parsed.attributes, 'model');
  if (model !== undefined) agent.model = model;

  return agent;
}
