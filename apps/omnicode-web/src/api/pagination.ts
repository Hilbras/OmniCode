import type { AppSession, Page, AppMessage } from '../api';

/** The slice of the shared client these helpers need — not the whole `OmnicodeWebApi`,
 *  so the pagination rules can be tested without a running daemon. */
export interface SessionListApi {
  listSessions(
    query: { pageSize: number; beforeId?: string },
  ): Promise<Page<AppSession>>;
}

export interface MessageListApi {
  listMessages(
    sessionId: string,
    query: { pageSize: number },
  ): Promise<Page<AppMessage>>;
}

export const PAGE_SIZE = 100;

/**
 * Walks the cursor pages until the daemon says there are no more.
 *
 * It stops on a page that claims `hasMore` but returns no items: without that guard the
 * cursor would be `undefined` and the loop would either re-request the first page or spin
 * forever, depending on how the daemon answers a missing cursor.
 */
export async function fetchAllSessions(
  api: SessionListApi,
  pageSize: number = PAGE_SIZE,
): Promise<readonly AppSession[]> {
  const items: AppSession[] = [];
  let beforeId: string | undefined;
  for (;;) {
    const page = await api.listSessions({ pageSize, ...(beforeId ? { beforeId } : {}) });
    items.push(...page.items);
    if (!page.hasMore) return items;
    beforeId = page.items[page.items.length - 1]?.id;
    if (beforeId === undefined) return items;
  }
}

/** One page of a session's messages; `undefined` session yields nothing and no request. */
export async function fetchMessages(
  api: MessageListApi,
  sessionId: string | undefined,
  pageSize: number = PAGE_SIZE,
): Promise<readonly AppMessage[]> {
  if (sessionId === undefined) return [];
  const page = await api.listMessages(sessionId, { pageSize });
  return page.items;
}
