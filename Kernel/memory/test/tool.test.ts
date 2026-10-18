import { describe, expect, it } from 'vitest';

import { ToolAccesses } from '@hilbras/omnicode-core/tool/toolContract';

import {
  IMemorySearchTool,
  MEMORY_SEARCH_DESCRIPTION,
  MEMORY_SEARCH_TOOL_NAME,
  MemorySearchInputSchema,
  MemorySearchTool,
} from '#/tool/memorySearchTool';

import type { IAgentMemoryContextService } from '#/context/agentMemoryContextService';
import type { MemoryRecord } from '#/contracts/memoryTypes';
import type { IMemoryService, MemorySearchQuery, RetrievalResult } from '#/contracts/memoryContract';

import { captureInput, createHarness, evidenceFor, REPO_A } from './helpers';

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