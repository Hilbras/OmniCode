import { describe, expect, it } from 'vitest';

import { getAgentProfileContributions } from '#/app/agentProfileCatalog/contribution';
import '#/session/agentLifecycle/profile/profiles';

function toolsOf(name: string): readonly string[] {
  const profile = getAgentProfileContributions().find((candidate) => candidate.name === name);
  expect(profile).toBeDefined();
  return profile?.tools ?? [];
}

describe('builtin profile tool allowlists', () => {
  it('lets the default agent see the file-restore and computer-use tools', () => {
    const tools = toolsOf('agent');
    for (const name of [
      'RestoreFile',
      'ComputerScreenshot',
      'ComputerClick',
      'ComputerType',
      'ComputerKey',
      'ComputerApplication',
    ]) {
      expect(tools).toContain(name);
    }
  });

  it('lets the coder subagent restore files but not drive the desktop', () => {
    const tools = toolsOf('coder');
    expect(tools).toContain('RestoreFile');
    expect(tools).not.toContain('ComputerScreenshot');
  });
});
