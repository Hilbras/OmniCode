import { describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { dispatchInput } from '#/tui/commands/index';

function makeHost(options: { streaming?: boolean } = {}) {
  const skillsBrowserController = { show: vi.fn(async () => {}) };
  const subagentsBrowserController = { show: vi.fn(async () => {}) };
  const connectorsBrowserController = { show: vi.fn(async () => {}) };
  const host = {
    state: {
      appState: {
        model: 'omnicode-model',
        streamingPhase: options.streaming === true ? 'streaming' : 'idle',
        isCompacting: false,
        version: '1.0.0',
      },
      ui: { requestRender: vi.fn() },
    },
    session: undefined,
    ensureSession: vi.fn(async () => undefined),
    sendNormalUserInput: vi.fn(),
    showError: vi.fn(),
    track: vi.fn(),
    skillCommandMap: new Map<string, string>(),
    pluginCommandMap: new Map<string, string>(),
    skillsBrowserController,
    subagentsBrowserController,
    connectorsBrowserController,
  } as unknown as SlashCommandHost;
  return { host, skillsBrowserController, subagentsBrowserController, connectorsBrowserController };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('catalog browser slash commands', () => {
  it('routes /skills to the skills browser', async () => {
    const { host, skillsBrowserController, subagentsBrowserController } = makeHost();

    dispatchInput(host, '/skills');
    await flush();

    expect(skillsBrowserController.show).toHaveBeenCalledTimes(1);
    expect(subagentsBrowserController.show).not.toHaveBeenCalled();
  });

  it('routes /subagents to the subagents browser', async () => {
    const { host, skillsBrowserController, subagentsBrowserController } = makeHost();

    dispatchInput(host, '/subagents');
    await flush();

    expect(subagentsBrowserController.show).toHaveBeenCalledTimes(1);
    expect(skillsBrowserController.show).not.toHaveBeenCalled();
  });

  it('never creates a session for the catalog browsers', async () => {
    const { host } = makeHost();

    dispatchInput(host, '/skills');
    dispatchInput(host, '/subagents');
    await flush();

    expect(host.ensureSession).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    expect(host.showError).not.toHaveBeenCalled();
  });

  it('stays available while a turn is running', async () => {
    const { host, skillsBrowserController, subagentsBrowserController } = makeHost({
      streaming: true,
    });

    dispatchInput(host, '/skills');
    dispatchInput(host, '/subagents');
    await flush();

    expect(skillsBrowserController.show).toHaveBeenCalledTimes(1);
    expect(subagentsBrowserController.show).toHaveBeenCalledTimes(1);
    expect(host.showError).not.toHaveBeenCalled();
  });

  it('routes /connectors to the connectors browser', async () => {
    const { host, connectorsBrowserController } = makeHost();

    dispatchInput(host, '/connectors');
    await flush();

    expect(connectorsBrowserController.show).toHaveBeenCalledTimes(1);
  });

  it('never creates a session for the connectors browser', async () => {
    const { host, connectorsBrowserController } = makeHost();

    dispatchInput(host, '/connectors');
    await flush();

    expect(connectorsBrowserController.show).toHaveBeenCalledTimes(1);
    expect(host.ensureSession).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    expect(host.showError).not.toHaveBeenCalled();
  });

  it('keeps the connectors browser available while a turn is running', async () => {
    const { host, connectorsBrowserController } = makeHost({ streaming: true });

    dispatchInput(host, '/connectors');
    await flush();

    expect(connectorsBrowserController.show).toHaveBeenCalledTimes(1);
    expect(host.showError).not.toHaveBeenCalled();
  });
});
