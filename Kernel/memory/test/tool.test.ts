import { describe, expect, it } from 'vitest';

import { ToolAccesses } from '@hilbras/omnicode-core/tool/toolContract';

import {
  IMemorySearchTool,
  MEMORY_SEARCH_DESCRIPTION,
  MEMORY_SEARCH_TOOL_NAME,
  MemorySearchInputSchema,
  MemorySearchTool,
} from '#/tool/memorySearchTool';

import type { IAgentMemoryContextService, MemoryWriteScopeTier } from '#/context/agentMemoryContextService';
import type { MemoryRecord, MemoryScope } from '#/contracts/memoryTypes';
import type { IMemoryService, MemorySearchQuery, RetrievalResult } from '#/contracts/memoryContract';

import {
  isScopeVisible,
  MEMORY_FORGET_TOOL_NAME,
  MEMORY_SAVE_TOOL_NAME,
  MemoryForgetInputSchema,
  MemoryForgetTool,
  MemorySaveInputSchema,
  MemorySaveTool,
} from '#/tool/memoryWriteTools';

import {
  captureInput,
  createHarness,
  evidenceFor,
  globalScope,
  REPO_A,
  REPO_B,
  repoScope,
  SESSION,
  sessionScope,
  WORKSPACE,
} from './helpers';

function stubResult(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    status: 'no_match',
    query: 'x',
    purpose: 'explicit_search',
    memories: [],
    budget: {
      applied: {
        maxResults: 8,
        maxContextChars: 4000,
        maxMemoryChars: 600,
        maxCandidates: 400,
        maxPostingsVisits: 50_000,
      },
      truncated: false,
      constraints: [],
      droppedByBudget: 0,
      mayBeIncomplete: false,
    },
    diagnostics: {
      normalizedQuery: 'x',
      queryTerms: [],
      scopePrefixes: [],
      scopeCandidates: 0,
      lexicalCandidates: 0,
      lexicalTruncated: false,
      lexicalVisits: 0,
      rejected: [],
    },
    context: '',
    ...overrides,
  };
}

async function run(
  tool: MemorySearchTool,
  args: Parameters<typeof tool.resolveExecution>[0],
  turnId = 1,
): Promise<string> {
  const resolved = tool.resolveExecution(args);
  if (resolved === null || typeof resolved !== 'object' || !('execute' in resolved)) {
    if (typeof resolved === 'object' && resolved !== null && 'output' in resolved) {
      return typeof resolved.output === 'string' ? resolved.output : JSON.stringify(resolved.output);
    }
    return '';
  }
  const result = await resolved.execute({
    turnId,
    toolCallId: `call-${turnId}`,
    signal: new AbortController().signal,
  });
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

function fakeRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const base: MemoryRecord = {
    id: 'mem_fake',
    tier: 'distilled',
    category: 'fact',
    content: 'a recorded fact',
    redactionCount: 0,
    trust: 'verified',
    trustReason: 'supported by present evidence',
    sourceType: 'repository_file',
    origin: 'application',
    scope: { tier: 'repository', projectId: REPO_A },
    createdAt: 1,
    updatedAt: 1,
    lifecycle: 'active',
    evidence: [{ kind: 'file', ref: 'a.md', state: 'present', fingerprint: 'fp', observedAt: 1 }],
    derivedFrom: [],
    revision: 0,
    accessCount: 0,
    fingerprint: 'fp',
    verification: { status: 'verified', checkedAt: 1, method: 'evidence' },
    conflictsWith: [],
    suspicious: false,
    suspicionReasons: [],
  };
  return { ...base, ...overrides };
}

function fakeExplanation(record: MemoryRecord) {
  return {
    memoryId: record.id,
    tier: record.tier,
    category: record.category,
    trust: record.trust,
    sourceType: record.sourceType,
    scopeTier: record.scope.tier,
    lifecycle: record.lifecycle,
    score: 1,
    components: { lexical: 1, trust: 0.8, scope: 0.2, reinforcement: 0, total: 2 },
    gates: [],
    evidence: record.evidence,
    suspicious: record.suspicious,
    suspiciousReasons: record.suspicionReasons,
    redacted: record.redactionCount > 0,
    conflictsWith: record.conflictsWith,
  };
}

function buildTool(
  result: RetrievalResult,
  overrides: { readonly enabled?: boolean } = {},
): { tool: MemorySearchTool; queries: MemorySearchQuery[]; noted: string[][] } {
  const queries: MemorySearchQuery[] = [];
  const noted: string[][] = [];
  const agentContext = {
    search: async (query: MemorySearchQuery) => {
      queries.push(query);
      return result;
    },
  } as unknown as IAgentMemoryContextService;
  const memory = {
    enabled: overrides.enabled ?? true,
    noteAccess: async (ids: readonly string[]) => {
      noted.push([...ids]);
      return ids.length;
    },
  } as unknown as IMemoryService;
  return { tool: new MemorySearchTool(agentContext, memory), queries, noted };
}

describe('memory_search tool contract', () => {
  it('exposes the documented name, description and parameter schema', () => {
    const { tool } = buildTool(stubResult());
    expect(tool.name).toBe(MEMORY_SEARCH_TOOL_NAME);
    expect(tool.description).toBe(MEMORY_SEARCH_DESCRIPTION);
    const schema = tool.parameters as Record<string, Record<string, unknown>>;
    expect(Object.keys(schema['properties'] ?? {}).toSorted()).toEqual([
      'categories',
      'includeUntrusted',
      'limit',
      'query',
      'scopes',
      'tiers',
    ]);
    expect(schema['additionalProperties']).toBe(false);
    expect(Object.keys(schema)).toContain('required');
  });

  it('is a read-only tool that still requires its own approval rule', () => {
    const { tool } = buildTool(stubResult());
    const resolved = tool.resolveExecution({ query: 'anything' });
    if (resolved === null || typeof resolved !== 'object' || !('execute' in resolved)) {
      throw new Error('expected a runnable execution');
    }
    expect(resolved.accesses).toEqual(ToolAccesses.none());
    expect(resolved.approvalRule).toBe(MEMORY_SEARCH_TOOL_NAME);
  });

  it('rejects an empty query before touching the store', async () => {
    const { tool, queries } = buildTool(stubResult());
    expect(await run(tool, { query: '   ' })).toBe('Provide a non-empty query.');
    expect(queries).toHaveLength(0);
  });

  it('passes the caller filters through to the retriever', async () => {
    const { tool, queries } = buildTool(stubResult());
    await run(tool, {
      query: 'build pipeline',
      scopes: ['repository'],
      tiers: ['distilled'],
      categories: ['fact'],
      includeUntrusted: true,
      limit: 3,
    });
    expect(queries[0]).toMatchObject({
      query: 'build pipeline',
      scopes: ['repository'],
      tiers: ['distilled'],
      categories: ['fact'],
      includeUntrusted: true,
      limit: 3,
    });
  });

  it('says plainly when memory is disabled', async () => {
    const { tool } = buildTool(stubResult(), { enabled: false });
    const output = await run(tool, { query: 'anything' });
    expect(output).toContain('Memory is disabled');
    expect(output).toContain('No memories were searched');
  });

  it('reports a no-match result without inventing content', async () => {
    const { tool } = buildTool(stubResult());
    const output = await run(tool, { query: 'nothing here' });
    expect(output).toContain('memory search status: no_match');
    expect(output).toContain('No stored memory matched this query.');
  });

  it('counts an access only for memories it actually returned', async () => {
    const record = fakeRecord();
    const result = stubResult({
      status: 'complete',
      memories: [{ record, explanation: fakeExplanation(record) }],
    });
    const { tool, noted } = buildTool(result);
    await run(tool, { query: 'recorded fact' });
    expect(noted).toEqual([['mem_fake']]);
  });

  it('does not count an access when nothing was returned', async () => {
    const { tool, noted } = buildTool(stubResult());
    await run(tool, { query: 'nothing here' });
    expect(noted).toEqual([]);
  });

  it('validates the input schema', () => {
    expect(MemorySearchInputSchema.safeParse({ query: 'x' }).success).toBe(true);
    expect(MemorySearchInputSchema.safeParse({ query: '' }).success).toBe(false);
    expect(MemorySearchInputSchema.safeParse({ query: 'x', scopes: ['nope'] }).success).toBe(false);
    expect(MemorySearchInputSchema.safeParse({ query: 'x', limit: 0 }).success).toBe(false);
    expect(MemorySearchInputSchema.safeParse({ query: 'x', limit: 99 }).success).toBe(false);
  });

  it('exports the decorator used for registration', () => {
    expect(typeof IMemorySearchTool).toBe('function');
  });

  it('renders what the real service returns end to end', async () => {
    const harness = createHarness();
    await harness.service.capture(
      captureInput('the workspace uses a pnpm workspace layout', {
        evidence: evidenceFor('pnpm-workspace.yaml'),
      }),
    );
    const record = fakeRecord({ id: 'mem_x' });
    const real = await harness.service.search({ query: 'pnpm workspace layout', projectId: REPO_A });
    expect(real.memories.length).toBe(1);
    const output = await run(buildTool(real).tool, { query: 'pnpm workspace layout' });
    expect(output).toContain('memory search status: complete');
    expect(output).toContain(record.tier);
  });
});

async function runTool(
  tool: { resolveExecution: (args: never) => ReturnType<MemorySaveTool['resolveExecution']> },
  args: unknown,
  toolCallId = 'call-1',
): Promise<{ output: string; isError: boolean }> {
  const resolved = (tool.resolveExecution as (a: unknown) => ReturnType<MemorySaveTool['resolveExecution']>)(args);
  if (resolved === null || typeof resolved !== 'object' || !('execute' in resolved)) {
    const output = typeof resolved === 'object' && resolved !== null && 'output' in resolved ? resolved.output : '';
    return { output: typeof output === 'string' ? output : JSON.stringify(output), isError: true };
  }
  const result = await resolved.execute({ turnId: 1, toolCallId, signal: new AbortController().signal });
  return {
    output: typeof result.output === 'string' ? result.output : JSON.stringify(result.output),
    isError: result.isError === true,
  };
}

function writeContext(knownProject: string | null = REPO_A): IAgentMemoryContextService {
  const projectId = knownProject ?? undefined;
  return {
    sessionId: () => SESSION,
    workspaceId: () => WORKSPACE,
    projectId: async () => projectId,
    scopeFor: async (tier: MemoryWriteScopeTier): Promise<MemoryScope | undefined> => {
      if (tier === 'global') return globalScope();
      if (tier === 'workspace') return { tier, workspaceId: WORKSPACE };
      if (projectId === undefined) return undefined;
      return tier === 'repository' ? repoScope(projectId) : sessionScope(SESSION, projectId);
    },
  } as unknown as IAgentMemoryContextService;
}

describe('memory_save tool', () => {
  it('stores a model-authored working memory that stays unverified', async () => {
    const harness = createHarness();
    const tool = new MemorySaveTool(writeContext(), harness.service);
    const { output, isError } = await runTool(tool, {
      content: 'The dev server listens on port 5173.',
      category: 'fact',
      subject: 'devserver.port',
    });
    expect(isError).toBe(false);
    expect(output).toContain('memory save status: stored');
    const [record] = await harness.service.list({ projectId: REPO_A, workspaceId: WORKSPACE });
    expect(record).toMatchObject({
      tier: 'working',
      category: 'fact',
      trust: 'unverified',
      origin: 'model',
      sourceType: 'agent_observation',
      scope: { tier: 'repository', projectId: REPO_A },
    });
  });

  it('cannot raise its own trust by claiming a preference', async () => {
    const harness = createHarness();
    const tool = new MemorySaveTool(writeContext(), harness.service);
    await runTool(tool, { content: 'The user prefers tabs over spaces.', category: 'preference' });
    const [record] = await harness.service.list({ projectId: REPO_A, workspaceId: WORKSPACE });
    expect(record?.trust).toBe('unverified');
  });

  it('is idempotent for a replayed tool call', async () => {
    const harness = createHarness();
    const tool = new MemorySaveTool(writeContext(), harness.service);
    const args = { content: 'Tests run with vitest.', category: 'fact' };
    await runTool(tool, args, 'call-7');
    await runTool(tool, args, 'call-7');
    expect(await harness.service.list({ projectId: REPO_A, workspaceId: WORKSPACE })).toHaveLength(1);
  });

  it('honours session and global scopes', async () => {
    const harness = createHarness();
    const tool = new MemorySaveTool(writeContext(), harness.service);
    await runTool(tool, { content: 'Only for this session.', category: 'task', scope: 'session' }, 'call-a');
    await runTool(tool, { content: 'Applies everywhere.', category: 'preference', scope: 'global' }, 'call-b');
    const records = await harness.service.list({ projectId: REPO_A, workspaceId: WORKSPACE, sessionId: SESSION });
    expect(records.map((record) => record.scope.tier).toSorted()).toEqual(['global', 'session']);
  });

  it('refuses a repository memory when the project cannot be identified', async () => {
    const harness = createHarness();
    const tool = new MemorySaveTool(writeContext(null), harness.service);
    const { output, isError } = await runTool(tool, { content: 'Something about the repo.', category: 'fact' });
    expect(isError).toBe(true);
    expect(output).toContain('could not be identified');
    expect(await harness.service.list({ workspaceId: WORKSPACE })).toHaveLength(0);
  });

  it('says plainly when memory is disabled and stores nothing', async () => {
    const harness = createHarness({ available: () => false });
    const tool = new MemorySaveTool(writeContext(), harness.service);
    const { output } = await runTool(tool, { content: 'Should not be stored.', category: 'fact' });
    expect(output).toContain('Memory is disabled');
  });

  it('requires its own approval rule and validates input', () => {
    const tool = new MemorySaveTool(writeContext(), createHarness().service);
    const resolved = tool.resolveExecution({ content: 'x', category: 'fact' });
    if (resolved === null || typeof resolved !== 'object' || !('execute' in resolved)) {
      throw new Error('expected a runnable execution');
    }
    expect(resolved.approvalRule).toBe(MEMORY_SAVE_TOOL_NAME);
    expect(MemorySaveInputSchema.safeParse({ content: 'x', category: 'fact' }).success).toBe(true);
    expect(MemorySaveInputSchema.safeParse({ content: 'x', category: 'policy' }).success).toBe(false);
    expect(MemorySaveInputSchema.safeParse({ content: 'x', category: 'fact', subject: 'Has Spaces' }).success).toBe(
      false,
    );
    expect(MemorySaveInputSchema.safeParse({ content: '', category: 'fact' }).success).toBe(false);
  });
});

describe('memory_forget tool', () => {
  it('invalidates a visible memory so search no longer returns it', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(
      captureInput('the build uses tsdown', { evidence: evidenceFor('package.json') }),
    );
    const tool = new MemoryForgetTool(writeContext(), harness.service);
    const { output, isError } = await runTool(tool, { id: stored.id, reason: 'the build moved to vite' });
    expect(isError).toBe(false);
    expect(output).toContain('memory forget status: invalidated');
    expect((await harness.service.get(stored.id ?? ''))?.lifecycle).toBe('invalidated');
    const after = await harness.service.search({ query: 'build uses tsdown', projectId: REPO_A });
    expect(after.memories).toHaveLength(0);
  });

  it('refuses a memory that belongs to another project', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(captureInput('repo beta fact', { scope: repoScope(REPO_B) }));
    const tool = new MemoryForgetTool(writeContext(), harness.service);
    const { output, isError } = await runTool(tool, { id: stored.id, reason: 'not mine' });
    expect(isError).toBe(true);
    expect(output).toContain('is visible to this session');
    expect((await harness.service.get(stored.id ?? ''))?.lifecycle).toBe('active');
  });

  it('reports an already-forgotten memory without changing it again', async () => {
    const harness = createHarness();
    const stored = await harness.service.capture(captureInput('old fact'));
    const tool = new MemoryForgetTool(writeContext(), harness.service);
    await runTool(tool, { id: stored.id, reason: 'outdated' }, 'call-1');
    const second = await runTool(tool, { id: stored.id, reason: 'outdated' }, 'call-2');
    expect(second.output).toContain('already invalidated');
  });

  it('requires its own approval rule and both fields', () => {
    const tool = new MemoryForgetTool(writeContext(), createHarness().service);
    const resolved = tool.resolveExecution({ id: 'mem_1', reason: 'r' });
    if (resolved === null || typeof resolved !== 'object' || !('execute' in resolved)) {
      throw new Error('expected a runnable execution');
    }
    expect(resolved.approvalRule).toBe(MEMORY_FORGET_TOOL_NAME);
    expect(MemoryForgetInputSchema.safeParse({ id: 'mem_1' }).success).toBe(false);
  });
});

describe('memory write scope visibility', () => {
  const current = { workspaceId: WORKSPACE, projectId: REPO_A, sessionId: SESSION };

  it('allows global, own workspace, own repository and own session', () => {
    expect(isScopeVisible(globalScope(), current)).toBe(true);
    expect(isScopeVisible({ tier: 'workspace', workspaceId: WORKSPACE }, current)).toBe(true);
    expect(isScopeVisible(repoScope(REPO_A), current)).toBe(true);
    expect(isScopeVisible(sessionScope(SESSION, REPO_A), current)).toBe(true);
  });

  it('rejects other workspaces, projects and sessions', () => {
    expect(isScopeVisible({ tier: 'workspace', workspaceId: 'other' }, current)).toBe(false);
    expect(isScopeVisible(repoScope(REPO_B), current)).toBe(false);
    expect(isScopeVisible(sessionScope('session-2', REPO_A), current)).toBe(false);
    expect(isScopeVisible(repoScope(REPO_A), { ...current, projectId: undefined })).toBe(false);
  });
});
