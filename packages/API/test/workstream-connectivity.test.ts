import { describe, expect, it } from 'vitest';

import { getAgentToolContributions } from '@hilbras/omnicode-engine/agent/toolRegistry/toolContribution';
import {
  ChannelRegistry,
  ChannelRuntimeService,
  MemoryFeature,
  MemoryManageTool,
  TelegramAdapter,
  channelMemoryScope,
  createSandboxExecutionPlan,
  scopeKeyFor,
  selectSandboxBackend,
} from '../src/index.js';

describe('workstream connectivity through the public API', () => {
  it('exports channel and sandbox surfaces from the API barrel', () => {
    expect(ChannelRegistry).toBeTypeOf('function');
    expect(ChannelRuntimeService).toBeTypeOf('function');
    expect(TelegramAdapter).toBeTypeOf('function');
    expect(channelMemoryScope('telegram', '42')).toEqual({ tier: 'channel', channelId: 'telegram:42' });
    expect(scopeKeyFor(channelMemoryScope('telegram', '42'))).toBe('c:telegram%3A42');
    expect(selectSandboxBackend).toBeTypeOf('function');
    expect(createSandboxExecutionPlan).toBeTypeOf('function');
  });

  it('exports memory management through the memory package barrel', () => {
    expect(MemoryManageTool).toBeTypeOf('function');
    expect(MemoryFeature).toBeTypeOf('function');
  });

  it('registers the new tool surfaces after importing the API barrel', () => {
    const names = new Set(getAgentToolContributions().map((contribution) => contribution.options.name));
    for (const name of [
      'Lsp',
      'WorktreeList',
      'WorktreeCreate',
      'WorktreeRemove',
      'NotebookEdit',
      'TaskBoardCreate',
      'TaskBoardUpdate',
      'TaskBoardList',
      'Team',
      'Arena',
      'TeamCreate',
      'TeamJoin',
      'TeamLeave',
      'TeamList',
      'ArtifactRecord',
      'SourceRecord',
    ]) {
      expect(names.has(name), name).toBe(true);
    }
  });
});
