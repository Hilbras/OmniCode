import { describe, expect, it, vi } from 'vitest';

import { AcpServer } from '../src/server';

function serverWithList(list: ReturnType<typeof vi.fn>): AcpServer {
  const klient = {
    global: { sessions: { list } },
  } as unknown as ConstructorParameters<typeof AcpServer>[1];
  return new AcpServer(
    {} as ConstructorParameters<typeof AcpServer>[0],
    klient,
    {} as ConstructorParameters<typeof AcpServer>[2],
  );
}

describe('session/list cursor forwarding', () => {
  it('forwards an ACP cursor as the SDK before cursor', async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: undefined }));
    const server = serverWithList(list);

    await server.listSessions({ cursor: 'session-cursor' });

    expect(list).toHaveBeenCalledWith({ before: 'session-cursor' });
  });

  it('omits the before cursor when the client sends none', async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: undefined }));
    const server = serverWithList(list);

    await server.listSessions({});

    expect(list).toHaveBeenCalledWith({ before: undefined });
  });
});
