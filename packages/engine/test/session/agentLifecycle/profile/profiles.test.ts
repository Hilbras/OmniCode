import { describe, expect, it } from 'vitest';

import { getAgentProfileContributions } from '#/app/agentProfileCatalog/contribution';
import '#/session/agentLifecycle/profile/profiles';

function profile(name: string) {
  const found = getAgentProfileContributions().find((p) => p.name === name);
  expect(found, `builtin profile "${name}" is registered`).toBeDefined();
  return found!;
}

describe('builtin agent profiles', () => {
  it('wires the tower control tools into the default profile', () => {
    const agent = profile('agent');
    expect(agent.tools).toContain('TowerInit');
    expect(agent.tools).toContain('TowerStatus');
    expect(agent.tools).toContain('TowerTeardown');
  });

  it('wires the memory tools into the default and coder profiles', () => {
    for (const name of ['agent', 'coder']) {
      const selected = profile(name);
      expect(selected.tools).toContain('memory_search');
      expect(selected.tools).toContain('memory_save');
      expect(selected.tools).toContain('memory_forget');
    }
    expect(profile('explore').tools).toContain('memory_search');
    expect(profile('explore').tools).not.toContain('memory_save');
  });

  it('caps the default profile delegation at non-spawning profiles', () => {
    const agent = profile('agent');
    expect(agent.subagents).toEqual(['coder', 'explore', 'plan']);
  });
});
