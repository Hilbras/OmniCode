import { describe, expect, it } from 'vitest';

import { InMemoryMemoryStore } from '#/storage/memoryStore';
import { RecordingLogger } from './helpers';
import { MemoryService } from '#/service/memoryService';
import type { MemoryAuthority } from '#/contracts/memoryAuthority';

function service() {
  const store = new InMemoryMemoryStore();
  return new MemoryService({ store, log: new RecordingLogger(), now: () => 1000 });
}

describe('dream consolidation', () => {
  it('merges related working memories and supersedes sources', async () => {
    const memory = service();
    const scope = { tier: 'repository' as const, workspaceId: 'w', projectId: 'p' };
    const first = await memory.capture({
      content: 'the cli uses tsup',
      tier: 'working',
      category: 'fact',
      sourceType: 'repository_file',
      origin: 'application',
      scope,
      subject: 'build.tool',
    });
    const second = await memory.capture({
      content: 'the cli bundles with tsup',
      tier: 'working',
      category: 'fact',
      sourceType: 'repository_file',
      origin: 'application',
      scope,
      subject: 'build.tool',
    });
    expect(first.status).toBe('stored');
    expect(second.status).toBe('stored');

    const result = await memory.dreamConsolidate(scope);
    expect(result.status).toBe('completed');
    expect(result.consolidated).toBe(1);
    expect(result.superseded).toBe(2);

    const consolidated = await memory.get(result.ids[0]!);
    expect(consolidated?.tier).toBe('distilled');
    expect(consolidated?.origin).toBe('application');
    expect(consolidated?.sourceType).toBe('derived');
    expect(consolidated?.trust).toBe('unverified');
    expect(consolidated?.evidence).toHaveLength(0);
  });

  it('skips legal-held sources', async () => {
    const memory = service();
    const scope = { tier: 'repository' as const, workspaceId: 'w', projectId: 'p' };
    const held = await memory.capture({
      content: 'secret fact',
      tier: 'working',
      category: 'fact',
      sourceType: 'repository_file',
      origin: 'application',
      scope,
      subject: 'secret.subject',
    });
    await memory.setLegalHold(held.id!, true, 'hold');
    await memory.capture({
      content: 'another secret fact',
      tier: 'working',
      category: 'fact',
      sourceType: 'repository_file',
      origin: 'application',
      scope,
      subject: 'secret.subject',
    });

    const result = await memory.dreamConsolidate(scope);
    expect(result.consolidated).toBe(0);
  });

  it('supports dry runs without mutation', async () => {
    const memory = service();
    const scope = { tier: 'repository' as const, workspaceId: 'w', projectId: 'p' };
    await memory.capture({ content: 'a', tier: 'working', category: 'fact', sourceType: 'repository_file', origin: 'application', scope, subject: 'x' });
    await memory.capture({ content: 'b', tier: 'working', category: 'fact', sourceType: 'repository_file', origin: 'application', scope, subject: 'x' });

    const result = await memory.dreamConsolidate({ scope, dryRun: true });
    expect(result.groups).toBe(1);
    expect(result.consolidated).toBe(0);
    expect(result.skipped).toBe(1);
  });
});
