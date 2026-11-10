import type { Command } from 'commander';

import { omnicodeCodeOfficialInstallUrl } from '#/constant/app';
import { openUrl } from '#/utils/open-url';

function openDesktopAppPage(): void {
  const url = omnicodeCodeOfficialInstallUrl();
  process.stdout.write(`${url}\n`);
  openUrl(url, () => {
    process.stderr.write('Could not open a browser. Open the URL printed above manually.\n');
    process.exitCode = 1;
  });
}

export function registerInstallDesktopCommand(program: Command): void {
  program
    .command('install-desktop')
    .description('Print the Omnicode desktop app page and open it in your browser.')
    .action(openDesktopAppPage);

  program.command('install-app', { hidden: true }).action(openDesktopAppPage);
}
