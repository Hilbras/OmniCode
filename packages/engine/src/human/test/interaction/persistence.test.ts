import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { createInteractionFacade } from '#/interaction/facade';
import { FileInteractionPersistence } from '#/interaction/persistence';
import { createInteractionMachine } from '#/interaction/machine';
import { createActor } from '#/xstate2';

const dirs: string[] = [];

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-interactions-'));
  dirs.push(dir);
  return join(dir, 'interactions.json');
}

function facade() {
  const actor = createActor(createInteractionMachine());
  actor.start();
  return createInteractionFacade(actor);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('interaction persistence', () => {
  it('persists pending interactions and reloads them', async () => {
    const file = await tempFile();
    const first = facade();
    first.configurePersistence(new FileInteractionPersistence(file));
    first.enqueue({ id: 'approval-1', kind: 'approval', payload: { tool: 'Write' }, tags: { sessionId: 's1' } });
    await first.flush();

    const second = facade();
    second.configurePersistence(new FileInteractionPersistence(file));
    await second.load();
    expect(second.findOne({ id: 'approval-1' })).toMatchObject({ kind: 'approval', tags: { sessionId: 's1' } });
    second.stop();
  });

  it('does not persist resolved interactions', async () => {
    const file = await tempFile();
    const first = facade();
    first.configurePersistence(new FileInteractionPersistence(file));
    first.enqueue({ id: 'approval-2', kind: 'approval', payload: {} });
    first.respond('approval-2', { decision: 'approved' });
    await first.flush();

    const second = facade();
    second.configurePersistence(new FileInteractionPersistence(file));
    await second.load();
    expect(second.findOne({ id: 'approval-2' })).toBeUndefined();
    second.stop();
  });

  it('loads empty when no file exists', async () => {
    const file = await tempFile();
    const second = facade();
    second.configurePersistence(new FileInteractionPersistence(file));
    await second.load();
    expect(second.findAll()).toEqual([]);
    second.stop();
  });
});
