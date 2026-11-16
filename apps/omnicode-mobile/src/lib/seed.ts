import type { Session } from './types';

const now = Date.now();
const minute = 60_000;
const hour = 60 * minute;

export function seedSessions(): Session[] {
  return [
    {
      id: 'ses_seed_refactor',
      title: 'Refactor auth middleware',
      createdAt: now - 2 * hour,
      updatedAt: now - 26 * minute,
      providerId: 'anthropic',
      model: 'claude-sonnet-4-5',
      messages: [
        {
          id: 'msg_seed_1',
          role: 'user',
          text: 'Refactor the auth middleware — the token expiry check looks wrong and the tests keep flaking.',
          createdAt: now - 2 * hour,
          toolCalls: [],
        },
        {
          id: 'msg_seed_2',
          role: 'assistant',
          text: 'Found it. The expiry check uses `<` where it should use `<=`, so a token is treated as valid for one extra millisecond — and the flaky test was racing that exact boundary.\n\n```ts\nif (token.expiresAt <= Date.now()) {\n  throw new TokenExpiredError();\n}\n```\n\nI ran the suite in the sandbox: **14/14 passing**, including the boundary case that used to flake. The fix is one character; the test now pins the clock instead of sleeping.',
          createdAt: now - 26 * minute,
          toolCalls: [
            {
              id: 'tc_seed_1',
              tool: 'run_code',
              args: { runtime: 'quickjs', snippet: 'vitest run auth.middleware.test.ts' },
              status: 'done',
              result: 'exit 0 · 14/14 tests passed · 212ms',
              durationMs: 1400,
            },
          ],
        },
      ],
    },
    {
      id: 'ses_seed_vector',
      title: 'Research vector databases',
      createdAt: now - 26 * hour,
      updatedAt: now - 25 * hour,
      providerId: 'openai',
      model: 'gpt-5.2',
      messages: [
        {
          id: 'msg_seed_3',
          role: 'user',
          text: 'Research vector databases for a mobile app — I need on-device or embedded, not a server.',
          createdAt: now - 26 * hour,
          toolCalls: [],
        },
        {
          id: 'msg_seed_4',
          role: 'assistant',
          text: 'For on-device, the field narrows fast:\n\n1. **SQLite + sqlite-vec** — embedded, zero infrastructure, survives app restarts. The pragmatic default.\n2. **ObjectBox** — faster writes, vector search built in, but a heavier dependency.\n3. **In-memory HNSW** — simplest, gone on restart; fine for session-scoped recall.\n\n> Recommendation: start with sqlite-vec. It matches your "no outside servers" constraint and the data is yours.\n\nSources: official docs, two production write-ups, benchmark repo. Want a schema sketch?',
          createdAt: now - 25 * hour,
          toolCalls: [
            {
              id: 'tc_seed_2',
              tool: 'web_search',
              args: { query: 'embedded vector database mobile on-device', max_results: '5' },
              status: 'done',
              result: '5 results · 3 relevant · fetched 2 pages for depth',
              durationMs: 1600,
            },
          ],
        },
      ],
    },
    {
      id: 'ses_seed_report',
      title: 'Summarize quarterly report',
      createdAt: now - 3 * 24 * hour,
      updatedAt: now - 3 * 24 * hour + 4 * minute,
      providerId: 'anthropic',
      model: 'claude-sonnet-4-5',
      messages: [
        {
          id: 'msg_seed_5',
          role: 'user',
          text: 'Read the quarterly report and give me the honest summary.',
          createdAt: now - 3 * 24 * hour,
          toolCalls: [],
          attachments: [{ id: 'att_seed_1', name: 'quarterly-report.md', size: 48_200 }],
        },
        {
          id: 'msg_seed_6',
          role: 'assistant',
          text: 'Read it end to end. Honest version:\n\n- **Revenue is up, margin is down.** Growth is being bought with discounting.\n- **The roadmap slipped two weeks** — the report buries this in section 9.\n- **One claim has no citation** and I flagged it inline.\n\nThe ending summarizes instead of deciding. I drafted a replacement that names the trade-off and picks a direction — want it?',
          createdAt: now - 3 * 24 * hour + 4 * minute,
          toolCalls: [
            {
              id: 'tc_seed_3',
              tool: 'read_file',
              args: { path: 'quarterly-report.md', reason: 'Summarize the document' },
              status: 'done',
              result: 'Read quarterly-report.md: 14 sections, 3,214 words.',
              durationMs: 900,
            },
          ],
          approval: {
            id: 'apr_seed_1',
            tool: 'read_file',
            args: { path: 'quarterly-report.md', reason: 'Summarize the document' },
            status: 'allowed',
          },
        },
      ],
    },
    {
      id: 'ses_seed_lisbon',
      title: 'Lisbon trip plan',
      createdAt: now - 5 * 24 * hour,
      updatedAt: now - 5 * 24 * hour + 6 * minute,
      providerId: 'google',
      model: 'gemini-3-pro',
      messages: [
        {
          id: 'msg_seed_7',
          role: 'user',
          text: 'Plan a 3-day Lisbon trip — food, views, no tourist traps.',
          createdAt: now - 5 * 24 * hour,
          toolCalls: [],
        },
        {
          id: 'msg_seed_8',
          role: 'assistant',
          text: '**Day 1 — Alfama.** Get lost on purpose. Miradouro de Santa Luzia at sunset, dinner at a tasca on Rua dos Remédios — order whatever the table next to you is having.\n\n**Day 2 — Belém + LX Factory.** Pastéis at the original shop before 10am (the line doubles by 11), then the berardo collection, then LX Factory for the afternoon.\n\n**Day 3 — Príncipe Real.** Embaixada for lunch, Jardim do Príncipe Real for the shade, and a fado house in Bairro Alto after dark — the small ones, not the dinner-show packages.\n\nRule: any place with a photo menu near a monument, walk past it.',
          createdAt: now - 5 * 24 * hour + 6 * minute,
          toolCalls: [],
        },
      ],
    },
  ];
}
