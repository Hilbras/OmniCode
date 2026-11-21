import { describe, expect, it, vi } from 'vitest';

// ChatPane's import graph reaches markstream (KaTeX worker), which can't load
// under node — only its props metadata is needed here, so stub Markdown out.
vi.mock('@hilbras/app-markdown', async () => {
  const vue = await import('vue');
  return {
    Markdown: vue.defineComponent({ name: 'Markdown', setup: () => () => vue.h('div') }),
  };
});

import { ChatPane } from '@hilbras/app-components';
import { TurnFilesSummary } from '@hilbras/app-components';

// The barrel exports async components; the props metadata lives on the raw
// SFC behind the loader, so resolve it before reading prop defaults.
async function propDefault(component: unknown, name: string): Promise<unknown> {
  const wrapper = component as {
    props?: Record<string, { default?: unknown }>;
    __asyncLoader?: () => Promise<unknown>;
  };
  if (wrapper.props !== undefined) return wrapper.props[name]?.default;
  if (wrapper.__asyncLoader === undefined) return undefined;
  const raw = (await wrapper.__asyncLoader()) as {
    props?: Record<string, { default?: unknown }>;
  };
  return raw.props?.[name]?.default;
}

describe('TurnFilesSummary interactivity', () => {
  it('defaults the interactive flag to true at both boundaries', async () => {
    await expect(propDefault(TurnFilesSummary, 'interactive')).resolves.toBe(true);
    await expect(propDefault(ChatPane, 'turnFilesInteractive')).resolves.toBe(true);
  });
});
