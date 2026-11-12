import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ChannelSessionBindingService,
  FileChannelBindingPersistence,
} from '#/index';

const dirs: string[] = [];

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-channel-bindings-'));
  dirs.push(dir);
  return join(dir, 'bindings.json');
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('channel binding persistence', () => {
  it('persists bindings atomically and reloads them', async () => {
    const file = await tempFile();
    const service = new ChannelSessionBindingService({ persistence: new FileChannelBindingPersistence(file) });
    service.bind({ channel: 'telegram', conversationId: '42', sessionId: 's1', workspaceRoot: '/workspace' });
    await service.flush();

    const reloaded = new ChannelSessionBindingService({ persistence: new FileChannelBindingPersistence(file) });
    await reloaded.load();
    expect(reloaded.get('telegram', '42')).toMatchObject({ sessionId: 's1', workspaceRoot: '/workspace' });
    const mode = JSON.parse(await readFile(file, 'utf8')) as unknown[];
    expect(mode).toHaveLength(1);
  });

  it('persists unbind and clear', async () => {
    const file = await tempFile();
    const service = new ChannelSessionBindingService({ persistence: new FileChannelBindingPersistence(file) });
    service.bind({ channel: 'slack', conversationId: 'c1', sessionId: 's1', workspaceRoot: '/w' });
    await service.flush();
    service.unbind('slack', 'c1');
    await service.flush();

    const reloaded = new ChannelSessionBindingService({ persistence: new FileChannelBindingPersistence(file) });
    await reloaded.load();
    expect(reloaded.list()).toHaveLength(0);
  });

  it('returns empty for a missing file and rejects malformed JSON', async () => {
    const file = await tempFile();
    await expect(new FileChannelBindingPersistence(file).load()).resolves.toEqual([]);
    await writeFile(file, '{not json', 'utf8');
    await expect(new FileChannelBindingPersistence(file).load()).rejects.toThrow();
  });

  it('drops malformed binding entries instead of trusting them', async () => {
    const file = await tempFile();
    await writeFile(
      file,
      JSON.stringify([
        { channel: 'telegram', conversationId: '42', sessionId: 's1', workspaceRoot: '/w', updatedAt: 1 },
        { channel: 'unknown', conversationId: '42', sessionId: 's2', workspaceRoot: '/w', updatedAt: 1 },
        { channel: 'slack', conversationId: 'c1' },
      ]),
      'utf8',
    );
    const loaded = await new FileChannelBindingPersistence(file).load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.sessionId).toBe('s1');
  });
});
