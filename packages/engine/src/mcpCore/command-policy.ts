import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, isAbsolute, resolve, relative, sep } from 'node:path';

import { Error2 } from '#/errors';
import { ErrorCodes } from '#/errors';

export interface ResolveMcpCommandOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly workspaceRoot?: string;
  readonly allowWorkspaceCommand?: boolean;
  readonly platform?: NodeJS.Platform;
}

export async function resolveMcpCommand(
  command: string,
  options: ResolveMcpCommandOptions,
): Promise<string> {
  if (command.trim().length === 0 || /[\0\r\n]/u.test(command)) {
    throw new Error2(ErrorCodes.MCP_STARTUP_FAILED, 'MCP command must be a non-empty executable path');
  }
  if (command.includes('/') || command.includes('\\')) {
    const candidate = isAbsolute(command) ? command : resolve(options.cwd, command);
    await assertExecutable(candidate, command);
    assertWorkspacePolicy(candidate, options);
    return candidate;
  }

  const pathEntries = (options.env['PATH'] ?? options.env['Path'] ?? '')
    .split(delimiter)
    .filter((entry) => entry.length > 0 && !isInside(entry, options.cwd));
  const platform = options.platform ?? process.platform;
  const extensions =
    platform === 'win32'
      ? (options.env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM').split(';').filter((entry) => entry.length > 0)
      : [''];

  for (const entry of pathEntries) {
    const directory = isAbsolute(entry) ? entry : resolve(options.cwd, entry);
    for (const extension of extensions) {
      const candidate = resolve(directory, `${command}${extension}`);
      if (await isExecutable(candidate)) {
        assertWorkspacePolicy(candidate, options);
        return candidate;
      }
    }
  }

  throw new Error2(ErrorCodes.MCP_STARTUP_FAILED, `MCP command not found on trusted PATH: ${command}`);
}

function assertWorkspacePolicy(candidate: string, options: ResolveMcpCommandOptions): void {
  if (options.allowWorkspaceCommand === true) return;
  const root = options.workspaceRoot ?? options.cwd;
  if (isInside(candidate, root)) {
    throw new Error2(
      ErrorCodes.MCP_STARTUP_FAILED,
      `MCP command resolves inside the workspace; set allowWorkspaceCommand deliberately: ${candidate}`,
      { details: { command: candidate, workspaceRoot: root } },
    );
  }
}

function isInside(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

async function assertExecutable(candidate: string, command: string): Promise<void> {
  if (!(await isExecutable(candidate))) {
    throw new Error2(ErrorCodes.MCP_STARTUP_FAILED, `MCP command is not executable: ${command}`);
  }
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
