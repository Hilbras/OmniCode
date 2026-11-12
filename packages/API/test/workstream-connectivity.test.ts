import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';
import { interactions } from '@hilbras/omnicode-engine/human/interaction/facade';

import { getAgentToolContributions } from '@hilbras/omnicode-engine/agent/toolRegistry/toolContribution';
import {
  ChannelRegistry,
  ChannelRuntimeService,
  configureInteractionPersistenceForHome,
  FileInteractionPersistence,
  FileTeamPersistence,
  LocalSessionSearchService,
  ModelPricingTable,
  ProviderDescriptorRegistry,
  SessionLeaseService,
  projectContextSections,
  scoreTrajectory,
  selectFallbackCandidate,
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

  it('exports hardened runtime primitives through the API barrel', () => {
    expect(ModelPricingTable).toBeTypeOf('function');
    expect(ProviderDescriptorRegistry).toBeTypeOf('function');
    expect(selectFallbackCandidate).toBeTypeOf('function');
    expect(LocalSessionSearchService).toBeTypeOf('function');
    expect(SessionLeaseService).toBeTypeOf('function');
    expect(FileInteractionPersistence).toBeTypeOf('function');
    expect(FileTeamPersistence).toBeTypeOf('function');
    expect(scoreTrajectory).toBeTypeOf('function');
    expect(projectContextSections).toBeTypeOf('function');
  });

  it('exports memory management through the memory package barrel', () => {
    expect(MemoryManageTool).toBeTypeOf('function');
    expect(MemoryFeature).toBeTypeOf('function');
  });

  it('composes durable interaction persistence for a host home', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'omnicode-api-interactions-'));
    try {
      configureInteractionPersistenceForHome(dir);
      interactions.enqueue({ id: 'api-durable-approval', kind: 'approval', payload: { tool: 'Write' } });
      await interactions.flush();
      const records = JSON.parse(await readFile(join(dir, 'interactions.json'), 'utf8')) as readonly { id: string }[];
      expect(records.some((record) => record.id === 'api-durable-approval')).toBe(true);
      interactions.respond('api-durable-approval', { decision: 'approved' });
      await interactions.flush();
      const after = JSON.parse(await readFile(join(dir, 'interactions.json'), 'utf8')) as readonly { id: string }[];
      expect(after.some((record) => record.id === 'api-durable-approval')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('registers the new tool surfaces after importing the API barrel', () => {
    const names = new Set(getAgentToolContributions().map((contribution) => contribution.options.name));
    for (const name of [
      'Lsp',
      'WorktreeList',
      'WorktreeCreate',
      'WorktreeRemove',
      'NotebookEdit',
      'ApplyPatch',
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
