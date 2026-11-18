import { describe, expect, it } from 'vitest';

import {
  type LaunchCommand,
  openFileCommandFor,
  openInAppCommandFor,
  revealFileCommandFor,
} from '../src/lib/fileLaunch';

function decodePowerShell(cmd: LaunchCommand): string {
  const encoded = cmd.args[cmd.args.length - 1] ?? '';
  return Buffer.from(encoded, 'base64').toString('utf16le');
}

describe('fileLaunch', () => {
  describe('win32 launch uses argv, not cmd', () => {
    it('opens a file through PowerShell with a literal path', () => {
      const cmd = openFileCommandFor('C:\\ws\\a&b.txt', undefined, {}, 'win32');
      expect(cmd.command).toBe('powershell.exe');
      expect(decodePowerShell(cmd)).toBe("Invoke-Item -LiteralPath 'C:\\ws\\a&b.txt'");
      expect('shell' in cmd).toBe(false);
    });

    it('keeps an editor path with spaces as one argv token', () => {
      const cmd = openFileCommandFor(
        'C:\\ws\\x y.txt',
        7,
        { OMNICODE_EDITOR: '"C:\\Program Files\\Code\\code.exe"' },
        'win32',
      );
      expect(cmd.command).toBe('powershell.exe');
      expect(decodePowerShell(cmd)).toBe(
        "& 'C:\\Program Files\\Code\\code.exe' 'C:\\ws\\x y.txt:7'",
      );
    });

    it('opens VS Code with -g through PowerShell', () => {
      const cmd = openInAppCommandFor('vscode', 'C:\\ws\\a&b.ts', { line: 3 }, 'win32');
      expect(cmd.command).toBe('powershell.exe');
      expect(decodePowerShell(cmd)).toBe("& 'code' '-g' 'C:\\ws\\a&b.ts:3'");
    });

    it('passes editor arguments as argv on POSIX', () => {
      const cmd = openFileCommandFor('/ws/a b.txt', 2, { EDITOR: 'code --wait' }, 'linux');
      expect(cmd).toEqual({ command: 'code', args: ['--wait', '/ws/a b.txt:2'] });
    });
  });

  describe('win32 explorer /select, quoting', () => {
    it('revealFileCommandFor quotes only the path and uses verbatim arguments', () => {
      const cmd = revealFileCommandFor('C:\\some dir\\sub\\file.txt', 'win32');
      expect(cmd.command).toBe('explorer.exe');
      expect(cmd.args).toEqual(['/select,"C:\\some dir\\sub\\file.txt"']);
      expect(cmd.windowsVerbatimArguments).toBe(true);
    });

    it('openInAppCommandFor (finder) quotes only the path and uses verbatim arguments', () => {
      const cmd = openInAppCommandFor(
        'finder',
        'C:\\some dir\\sub\\file.txt',
        { isDirectory: false },
        'win32',
      );
      expect(cmd.command).toBe('explorer.exe');
      expect(cmd.args).toEqual(['/select,"C:\\some dir\\sub\\file.txt"']);
      expect(cmd.windowsVerbatimArguments).toBe(true);
    });

    it('openInAppCommandFor (finder) opens directories without /select,', () => {
      const cmd = openInAppCommandFor(
        'finder',
        'C:\\some dir\\sub',
        { isDirectory: true },
        'win32',
      );
      expect(cmd.command).toBe('explorer.exe');
      expect(cmd.args).toEqual(['C:\\some dir\\sub']);
      expect(cmd.windowsVerbatimArguments).toBeUndefined();
    });

    it('drops a trailing backslash so it cannot escape the closing quote', () => {
      const cmd = revealFileCommandFor('C:\\some dir\\sub\\', 'win32');
      expect(cmd.args).toEqual(['/select,"C:\\some dir\\sub"']);
    });

    it('paths without spaces keep the same quoting', () => {
      const cmd = revealFileCommandFor('C:\\proj\\file.txt', 'win32');
      expect(cmd.args).toEqual(['/select,"C:\\proj\\file.txt"']);
      expect(cmd.windowsVerbatimArguments).toBe(true);
    });
  });
});
