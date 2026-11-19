import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getAgentProfileContributions } from '#/app/agentProfileCatalog/contribution';
import type { AgentProfileContext } from '#/app/agentProfileCatalog/agentProfileCatalog';
import '#/session/agentLifecycle/profile/profiles';

const goldenDir = join(import.meta.dirname, 'goldens');

const context: AgentProfileContext = {
  cwd: '/workspace/project',
  cwdListing: 'src/\npackage.json\ntsconfig.json',
  agentsMd: '# Project rules\n- run pnpm test before handing off',
  additionalDirsInfo: '/workspace/shared (read-only)',
  osKind: 'Linux',
  shellName: 'bash',
  shellPath: '/bin/bash',
  skills: '- review: review one change\n- security: check for security issues',
  pluginSections: '## Connectors\nUse /connectors to bind a chat channel.',
  productName: 'OmniCode',
  replyStyleGuide: 'Answer in the language the user wrote in.',
  notifyUserActive: true,
  memoryActive: true,
};

function profile(name: string) {
  const found = getAgentProfileContributions().find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`builtin profile "${name}" is not registered`);
  return found;
}

describe('rendered system prompt goldens', () => {
  it('pins the rendered system prompt of the default agent profile', async () => {
    const rendered = profile('agent').renderSystemPrompt(context);

    expect(rendered.text).toBe(
      await readFile(join(goldenDir, 'agent-system-prompt.txt'), 'utf8'),
    );
    expect(rendered.environment).toEqual({ cwd: '/workspace/project' });
  });

  it('pins the rendered system prompt of the coder profile, role text included', async () => {
    const rendered = profile('coder').renderSystemPrompt(context);

    expect(rendered.text).toBe(
      await readFile(join(goldenDir, 'coder-system-prompt.txt'), 'utf8'),
    );
    expect(rendered.text).toContain(
      'You are now running as a subagent. All the `user` messages are sent by the main agent.',
    );
  });

  it('renders the context sections the golden covers', () => {
    const text = profile('agent').renderSystemPrompt(context).text;

    expect(text).toContain('/workspace/project');
    expect(text).toContain('# Project rules');
    expect(text).toContain('- review: review one change');
    expect(text).toContain('## Connectors');
    expect(text).toContain('Answer in the language the user wrote in.');
  });

  it('directs the model to persist until the user outcome is achieved', () => {
    const text = profile('agent').renderSystemPrompt(context).text;
    expect(text).toContain('# Autonomy and persistence');
    expect(text).toContain('keep working autonomously until the user\u0027s intended outcome is achieved');
    expect(text).toContain('Do not stop at an intermediate result');
    expect(text).toContain('a pending, running, or inconclusive check is not completion');
  });
});
