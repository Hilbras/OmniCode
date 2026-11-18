import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import path from 'node:path';

export interface LaunchCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments?: boolean;
}

export function openFileCommandFor(
  absolutePath: string,
  line?: number,
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): LaunchCommand {
  const editor = resolveEditorCommand(env);
  if (editor !== undefined) {
    const [editorCommand, ...editorArgs] = splitCommandLine(editor);
    if (editorCommand !== undefined) {
      const target =
        supportsLineTarget(editorCommand) && line !== undefined
          ? `${absolutePath}:${line}`
          : absolutePath;
      return launchCommandFor(editorCommand, [...editorArgs, target], platform);
    }
  }

  switch (platform) {
    case 'darwin':
      return { command: 'open', args: [absolutePath] };
    case 'win32':
      return powershellCommand(`Invoke-Item -LiteralPath ${psLiteral(absolutePath)}`);
    default:
      return { command: 'xdg-open', args: [absolutePath] };
  }
}

export function revealFileCommandFor(
  absolutePath: string,
  platform: NodeJS.Platform = process.platform,
): LaunchCommand {
  switch (platform) {
    case 'darwin':
      return { command: 'open', args: ['-R', absolutePath] };
    case 'win32':
      return {
        command: 'explorer.exe',
        args: [explorerSelectArg(absolutePath)],
        windowsVerbatimArguments: true,
      };
    default:
      return { command: 'xdg-open', args: [path.dirname(absolutePath)] };
  }
}

export type OpenInAppId = 'finder' | 'cursor' | 'vscode' | 'iterm' | 'terminal';

export const OPEN_IN_APP_IDS: readonly OpenInAppId[] = [
  'finder',
  'cursor',
  'vscode',
  'iterm',
  'terminal',
];

export interface OpenInAppOptions {
  readonly line?: number;
  readonly isDirectory?: boolean;
}

export function openInAppCommandFor(
  appId: OpenInAppId,
  absolutePath: string,
  options: OpenInAppOptions = {},
  platform: NodeJS.Platform = process.platform,
): LaunchCommand {
  switch (appId) {
    case 'vscode':
      return openInVsCodeLike('code', absolutePath, options.line, platform);
    case 'cursor':
      return openInVsCodeLike('cursor', absolutePath, options.line, platform);
    case 'finder':
      return openInFinder(absolutePath, options.isDirectory, platform);
    case 'iterm':
      return openInMacApp('iTerm', absolutePath, platform);
    case 'terminal':
      return openInMacApp('Terminal', absolutePath, platform);
  }
}

export function getAvailableOpenInApps(
  platform: NodeJS.Platform = process.platform,
): readonly OpenInAppId[] {
  return OPEN_IN_APP_IDS.filter((appId) => isOpenInAppAvailable(appId, platform));
}

function isOpenInAppAvailable(appId: OpenInAppId, platform: NodeJS.Platform): boolean {
  switch (appId) {
    case 'finder':
    case 'terminal':
      return platform === 'darwin';
    case 'iterm':
      if (platform !== 'darwin') return false;
      return (
        existsSync('/Applications/iTerm.app') ||
        existsSync(`${process.env['HOME'] ?? ''}/Applications/iTerm.app`)
      );
    case 'vscode':
      return commandExists('code', platform);
    case 'cursor':
      return commandExists('cursor', platform);
  }
}

function commandExists(command: string, platform: NodeJS.Platform): boolean {
  const pathValue = process.env['PATH'];
  if (pathValue === undefined || pathValue.length === 0) return false;
  const extensions =
    platform === 'win32'
      ? (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ext) => ext.length > 0)
      : [''];
  for (const directory of pathValue.split(path.delimiter)) {
    if (directory.length === 0 || !path.isAbsolute(directory)) continue;
    for (const extension of extensions) {
      try {
        accessSync(
          path.join(directory, `${command}${extension}`),
          platform === 'win32' ? constants.F_OK : constants.X_OK,
        );
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

function openInVsCodeLike(
  binary: string,
  absolutePath: string,
  line: number | undefined,
  platform: NodeJS.Platform,
): LaunchCommand {
  const target = line !== undefined ? `${absolutePath}:${line}` : absolutePath;
  const args = line !== undefined ? ['-g', target] : [target];
  return launchCommandFor(binary, args, platform);
}

function launchCommandFor(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform,
): LaunchCommand {
  if (platform !== 'win32') return { command, args };
  return powershellCommand(psCall(command, args));
}

function psLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function psCall(command: string, args: readonly string[]): string {
  return ['&', psLiteral(command), ...args.map((arg) => psLiteral(arg))].join(' ');
}

function powershellCommand(script: string): LaunchCommand {
  return {
    command: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
  };
}

export function splitCommandLine(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  for (const char of value) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

function openInFinder(
  absolutePath: string,
  isDirectory: boolean | undefined,
  platform: NodeJS.Platform,
): LaunchCommand {
  switch (platform) {
    case 'darwin':
      return isDirectory
        ? { command: 'open', args: [absolutePath] }
        : { command: 'open', args: ['-R', absolutePath] };
    case 'win32':
      return isDirectory
        ? { command: 'explorer.exe', args: [absolutePath] }
        : {
            command: 'explorer.exe',
            args: [explorerSelectArg(absolutePath)],
            windowsVerbatimArguments: true,
          };
    default:
      return {
        command: 'xdg-open',
        args: [isDirectory ? absolutePath : path.dirname(absolutePath)],
      };
  }
}

function openInMacApp(
  appName: string,
  absolutePath: string,
  platform: NodeJS.Platform,
): LaunchCommand {
  if (platform === 'darwin') {
    return { command: 'open', args: ['-a', appName, absolutePath] };
  }
  return openFileCommandFor(absolutePath, undefined, process.env, platform);
}

export async function launchDetached(cmd: LaunchCommand): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const child = spawn(cmd.command, cmd.args, {
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: cmd.windowsVerbatimArguments,
    });
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve();
    });
  });
}

function resolveEditorCommand(env: Record<string, string | undefined>): string | undefined {
  for (const key of ['OMNICODE_EDITOR', 'VISUAL', 'EDITOR']) {
    const value = env[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function supportsLineTarget(command: string): boolean {
  return /(?:^|[\\/])(code|cursor|windsurf)(?:\.cmd|\.exe)?$/i.test(command);
}

function explorerSelectArg(absolutePath: string): string {
  const trimmed = absolutePath.replace(/\\+$/, '');
  return `/select,"${trimmed}"`;
}
