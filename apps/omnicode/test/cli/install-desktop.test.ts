import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OmnicodeRegionProfile } from '@hilbras/omnicode-auth';

import { registerInstallDesktopCommand } from '#/cli/sub/install-desktop';

const mocks = vi.hoisted(() => ({
  openUrl: vi.fn(),
  currentOmnicodeProfile: vi.fn(() => ({ siteBase: 'https://example.com' }) as unknown as OmnicodeRegionProfile),
}));

vi.mock('#/utils/open-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/utils/open-url')>();
  return { ...actual, openUrl: mocks.openUrl };
});

vi.mock('#/utils/region', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/utils/region')>();
  return { ...actual, currentOmnicodeProfile: mocks.currentOmnicodeProfile };
});

describe('omnicode install-desktop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the region-derived desktop app page URL and opens it in the browser', async () => {
    const program = new Command('omnicode');
    registerInstallDesktopCommand(program);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await program.parseAsync(['node', 'omnicode', 'install-desktop']);

    expect(write).toHaveBeenCalledWith('https://example.com/code\n');
    expect(mocks.openUrl).toHaveBeenCalledWith('https://example.com/code', expect.any(Function));
  });

  it('keeps install-app working as a hidden alias', async () => {
    const program = new Command('omnicode');
    registerInstallDesktopCommand(program);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await program.parseAsync(['node', 'omnicode', 'install-app']);

    expect(write).toHaveBeenCalledWith('https://example.com/code\n');
    expect(mocks.openUrl).toHaveBeenCalledWith('https://example.com/code', expect.any(Function));
  });
});
