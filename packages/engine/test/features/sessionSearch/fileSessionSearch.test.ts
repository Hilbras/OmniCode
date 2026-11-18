import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { FileSessionSearchService } from '#/features/sessionSearch/fileSessionSearch';

function line(role: string, text: string, time = 1_700_000_000, agentId = 'main'): string {
  return JSON.stringify({
    type: 'context.append_message',
    agentId,
    time,
    message: { role, content: [{ type: 'text', text }], toolCalls: [] },
  });
}

describe('FileSessionSearchService', () => {
  let root: string;
  let service: FileSessionSearchService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'omnicode-session-search-'));
    service = new FileSessionSearchService({ sessionsDir: root } as IBootstrapService);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads user and assistant text from the session and subagent wires', async () => {
    const session = join(root, 'ws', 's1');
    await mkdir(join(session, 'agents', 'coder'), { recursive: true });
    await writeFile(
      join(session, 'wire.jsonl'),
      `${line('user', 'hello world')}\n${line('assistant', 'hello back')}\n`,
    );
    await writeFile(
      join(session, 'agents', 'coder', 'wire.jsonl'),
      `${line('assistant', 'subagent notes about hello', 1_700_000_000, 'coder')}\n`,
    );

    const page = await service.search({ query: 'hello', pageSize: 10 });

    expect(page.items.map((hit) => hit.snippet)).toEqual([
      expect.stringContaining('hello'),
      expect.stringContaining('hello'),
      expect.stringContaining('hello'),
    ]);
    expect(page.items.map((hit) => hit.agentId).sort()).toEqual(['coder', 'main', 'main']);
    expect(page.items.every((hit) => hit.sessionId === 's1')).toBe(true);
    expect(page.items[0]?.sessionTitle).toBe('hello world');
  });

  it('skips injected user messages and malformed lines', async () => {
    const session = join(root, 'ws', 's2');
    await mkdir(session, { recursive: true });
    const injected = JSON.stringify({
      type: 'context.append_message',
      agentId: 'main',
      time: 1_700_000_000,
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'injected hello' }],
        toolCalls: [],
        origin: { kind: 'injection' },
      },
    });
    await writeFile(
      join(session, 'wire.jsonl'),
      `${injected}\nnot json\n${line('user', 'typed hello')}\n`,
    );

    const page = await service.search({ query: 'hello', pageSize: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.snippet).toContain('typed hello');
  });

  it('does not follow symlinked directories', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'omnicode-session-outside-'));
    await writeFile(join(outside, 'wire.jsonl'), `${line('user', 'secret hello')}\n`);
    await mkdir(join(root, 'ws', 's3'), { recursive: true });
    await symlink(outside, join(root, 'ws', 's3', 'linked'));

    const page = await service.search({ query: 'hello', pageSize: 10 });

    expect(page.items).toHaveLength(0);
    await rm(outside, { recursive: true, force: true });
  });

  it('returns an empty page when the sessions root is missing', async () => {
    const missing = new FileSessionSearchService({
      sessionsDir: join(root, 'does-not-exist'),
    } as IBootstrapService);
    const page = await missing.search({ query: 'hello', pageSize: 10 });
    expect(page.items).toEqual([]);
  });
});
