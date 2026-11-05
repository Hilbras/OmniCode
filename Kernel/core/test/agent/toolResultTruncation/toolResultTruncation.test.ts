import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAgentScopeContext, makeAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import type { ExecutableToolResult } from '#/tool/toolContract';
import { IAgentToolResultTruncationService } from '#/agent/toolResultTruncation/toolResultTruncation';
import { TOOL_RESULT_COMPRESSION_FLAG_ID } from '#/agent/toolResultTruncation/flag';
import {
  compactStructuredText,
  isDenseIdentifier,
  normalizedEntropy,
} from '#/agent/toolResultTruncation/structuredText';
import { ToolResultTruncationService } from '#/agent/toolResultTruncation/toolResultTruncationService';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IFlagService } from '#/app/flag/flag';
import type { ContentPart } from '#human/llm/message';
import { FileStorageService } from '#/persistence/backends/node-fs/fileStorageService';
import { IFileSystemStorageService } from '#/persistence/interface/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stubBootstrap } from '../../app/bootstrap/stubs';
import { stubFlag } from '../../app/flag/stubs';

describe('ToolResultTruncationService', () => {
  let disposables: DisposableStore;
  let homeDir: string;
  let truncation: IAgentToolResultTruncationService;
  let compressionEnabled = false;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'tool-result-truncation-'));
    compressionEnabled = false;
    disposables = new DisposableStore();
    const ix = disposables.add(new TestInstantiationService());
    ix.stub(IBootstrapService, stubBootstrap(homeDir));
    ix.stub(
      IFlagService,
      stubFlag((id) => id === TOOL_RESULT_COMPRESSION_FLAG_ID && compressionEnabled),
    );
    ix.stub(
      IAgentScopeContext,
      makeAgentScopeContext({
        agentId: 'main',
        agentScope: 'sessions/workspace/session/agents/main',
      }),
    );
    ix.stub(IFileSystemStorageService, new FileStorageService(homeDir));
    truncation = ix.createInstance(ToolResultTruncationService);
  });

  afterEach(async () => {
    disposables.dispose();
    await rm(homeDir, { recursive: true, force: true });
  });

  const spillDir = () =>
    join(homeDir, 'sessions/workspace/session/agents/main/tool-results');

  it('recognizes agent event logs under the sessions directory', () => {
    expect(
      truncation.isWireJournalPath(join(homeDir, 'sessions/workspace/session/agents/main/wire.jsonl')),
    ).toBe(true);
    expect(
      truncation.isWireJournalPath(join(homeDir, 'sessions/workspace/session/agents/sub-1/wire.jsonl')),
    ).toBe(true);
    expect(
      truncation.isWireJournalPath(join(homeDir, 'sessions/workspace/session/agents/main/notes.jsonl')),
    ).toBe(false);
    expect(truncation.isWireJournalPath(join(homeDir, 'blobs/wire.jsonl'))).toBe(false);
    expect(truncation.isWireJournalPath('/elsewhere/sessions/x/wire.jsonl')).toBe(false);
  });

  const bulk = (ch: string, n: number) => `${ch.repeat(99)}\n`.repeat(n);

  it('persists oversized string output and renders a bounded model preview', async () => {
    const fullOutput = `HEAD_MARKER\n${bulk('x', 500)}MIDDLE_MARKER\n${bulk('y', 20)}TAIL_MARKER\n`;

    const result = await truncation.truncateForModel<ExecutableToolResult>({
      toolName: 'Lookup Tool',
      toolCallId: 'call:lookup',
      result: { output: fullOutput, isError: true },
    });

    expect(result.truncated).toBe(true);
    expect(result.isError).toBe(true);
    const rendered = result.output;
    expect(typeof rendered).toBe('string');
    if (typeof rendered !== 'string') throw new Error('expected string output');
    expect(rendered).toContain('Tool output exceeded 50000 characters');
    expect(rendered).toContain('tool_name: Lookup Tool');
    expect(rendered).toContain('tool_call_id: call:lookup');
    expect(rendered).toContain(`output_size_chars: ${String(fullOutput.length)}`);
    expect(rendered).toContain('HEAD_MARKER');
    expect(rendered).toContain('TAIL_MARKER');
    expect(rendered).not.toContain('MIDDLE_MARKER');
    expect(rendered).toMatch(/\[elided: chars \[4096, \d+\)\]/);

    const outputPath = renderedOutputPath(rendered);
    expect(outputPath).toContain(
      join(
        homeDir,
        'sessions/workspace/session/agents/main/tool-results/Lookup_Tool-call_lookup-',
      ),
    );
    await expect(readFile(outputPath, 'utf8')).resolves.toBe(fullOutput);
  });

  it('renders the spill suffix after the pointer and strips the spill field', async () => {
    const full = `HEAD\n${bulk('x', 600)}TAIL\n`;

    const result = await truncation.truncateForModel<ExecutableToolResult>({
      toolName: 'Bash',
      toolCallId: 'call_bash',
      result: {
        output: full,
        spill: { suffix: 'Command failed with exit code: 1.' },
      },
    });

    expect(result.truncated).toBe(true);
    expect('spill' in result).toBe(false);
    const rendered = result.output;
    expect(typeof rendered).toBe('string');
    if (typeof rendered !== 'string') throw new Error('expected string output');
    expect(rendered).toContain(`output_size_chars: ${String(full.length)}`);
    expect(rendered).toContain('Command failed with exit code: 1.');
    await expect(readFile(renderedOutputPath(rendered), 'utf8')).resolves.toBe(full);
  });

  it('reports when retention preserved only a prefix of the full output', async () => {
    const preserved = bulk('x', 600);

    const result = await truncation.truncateForModel<ExecutableToolResult>({
      toolName: 'Bash',
      toolCallId: 'call_partial',
      result: {
        output: preserved,
        spill: { totalChars: 25_000_000 },
      },
    });

    const rendered = result.output;
    expect(typeof rendered).toBe('string');
    if (typeof rendered !== 'string') throw new Error('expected string output');
    expect(rendered).toContain(
      'the first 60000 characters (of 25000000) were saved to a file.',
    );
    expect(rendered).not.toContain('the full output was saved');
    expect(rendered).toContain(
      'output_size_chars: 25000000 (only the first 60000 characters were preserved)',
    );
    await expect(readFile(renderedOutputPath(rendered), 'utf8')).resolves.toBe(preserved);
  });

  it('caps the retained spill at 10MB and reports the true total', async () => {
    const full = bulk('x', 110_000);
    const retained = bulk('x', 110_000).slice(0, 10_000_000);

    const result = await truncation.truncateForModel<ExecutableToolResult>({
      toolName: 'mcp__s__big',
      toolCallId: 'call_huge',
      result: { output: full },
    });

    const rendered = result.output;
    expect(typeof rendered).toBe('string');
    if (typeof rendered !== 'string') throw new Error('expected string output');
    expect(rendered).toContain(
      'the first 10000000 characters (of 11000000) were saved to a file.',
    );
    await expect(readFile(renderedOutputPath(rendered), 'utf8')).resolves.toBe(retained);
  });

  it('reuses a pre-spilled output path instead of writing a new file', async () => {
    const existing = join(homeDir, 'task-log.txt');
    await writeFile(existing, 'full log', 'utf8');
    const retained = bulk('x', 600);

    const result = await truncation.truncateForModel<ExecutableToolResult>({
      toolName: 'Bash',
      toolCallId: 'call_prespilled',
      result: {
        output: retained,
        spill: { outputPath: existing, totalChars: 120_000, suffix: 'task_id: task-1' },
      },
    });

    const rendered = result.output;
    expect(typeof rendered).toBe('string');
    if (typeof rendered !== 'string') throw new Error('expected string output');
    expect(rendered).toContain(`output_path: ${existing}`);
    expect(rendered).toContain('the full output was saved to a file.');
    expect(rendered).toContain('output_size_chars: 120000');
    expect(rendered).not.toContain('output_size_bytes');
    expect(rendered).toContain('task_id: task-1');
    await expect(readdir(spillDir())).rejects.toThrow();
  });

  it('spills truncated text while keeping media parts in the output', async () => {
    const image = {
      type: 'image_url',
      imageUrl: { url: 'data:image/png;base64,AAAA' },
    } as const;
    const output: ContentPart[] = [{ type: 'text', text: bulk('x', 600) }, image];

    const result = await truncation.truncateForModel<ExecutableToolResult>({
      toolName: 'mcp__s__t',
      toolCallId: 'call_mcp_media',
      result: { output },
    });

    expect(result.truncated).toBe(true);
    if (!Array.isArray(result.output)) throw new Error('expected content parts output');
    const [pointer, ...media] = result.output;
    if (pointer?.type !== 'text') throw new Error('expected pointer text first');
    expect(pointer.text).toContain('Tool output exceeded 50000 characters');
    expect(pointer.text).toContain('the full text output was saved to a file');
    expect(media).toEqual([image]);
    await expect(readFile(renderedOutputPath(pointer.text), 'utf8')).resolves.toBe(
      bulk('x', 600),
    );
  });

  it('appends the pointer instead of replacing output when per-line shaping suffices', async () => {
    const longLine = 'y'.repeat(30_000);
    const full = `first line\n${longLine}\n${longLine}\nlast line`;

    const result = await truncation.truncateForModel<ExecutableToolResult>({
      toolName: 'Grep',
      toolCallId: 'call_grep',
      result: { output: full },
    });

    expect(result.truncated).toBe(true);
    const rendered = result.output;
    expect(typeof rendered).toBe('string');
    if (typeof rendered !== 'string') throw new Error('expected string output');
    expect(rendered).toContain('first line\n');
    expect(rendered).toContain(`${'y'.repeat(1_984)}[...truncated]\n`);
    expect(rendered).toContain('last line');
    expect(rendered).toContain('[Per-line truncation occurred; the complete output was saved to a file.');
    expect(rendered).toContain('next_step: Use Read with output_path');
    await expect(readFile(renderedOutputPath(rendered), 'utf8')).resolves.toBe(full);
  });

  it('does not repeat suffix lines already present in the shaped output', async () => {
    const notice = 'notice: binary part dropped';
    const full = `${notice}\n${'y'.repeat(30_000)}\n${'z'.repeat(30_000)}`;

    const result = await truncation.truncateForModel<ExecutableToolResult>({
      toolName: 'mcp__s__t',
      toolCallId: 'call_suffix_inline',
      result: { output: full, spill: { suffix: notice } },
    });

    const rendered = result.output;
    expect(typeof rendered).toBe('string');
    if (typeof rendered !== 'string') throw new Error('expected string output');
    expect(rendered).toContain('[Per-line truncation occurred; the complete output was saved to a file.');
    expect(rendered.split(notice).length - 1).toBe(1);
  });

  it('keeps suffix lines that are not present in the shaped output', async () => {
    const full = `${'y'.repeat(30_000)}\n${'z'.repeat(30_000)}`;

    const result = await truncation.truncateForModel<ExecutableToolResult>({
      toolName: 'Bash',
      toolCallId: 'call_suffix_unique',
      result: { output: full, spill: { suffix: 'task_id: task-9' } },
    });

    const rendered = result.output;
    expect(typeof rendered).toBe('string');
    if (typeof rendered !== 'string') throw new Error('expected string output');
    expect(rendered).toContain('[Per-line truncation occurred; the complete output was saved to a file.');
    expect(rendered).toContain('task_id: task-9');
  });

  it('says text output when appending a pointer alongside media parts', async () => {
    const image = {
      type: 'image_url',
      imageUrl: { url: 'data:image/png;base64,AAAA' },
    } as const;
    const output: ContentPart[] = [
      { type: 'text', text: `${'y'.repeat(30_000)}\n${'z'.repeat(30_000)}` },
      image,
    ];

    const result = await truncation.truncateForModel<ExecutableToolResult>({
      toolName: 'mcp__s__t',
      toolCallId: 'call_mcp_media_append',
      result: { output },
    });

    expect(result.truncated).toBe(true);
    if (!Array.isArray(result.output)) throw new Error('expected content parts output');
    const textParts = result.output.filter((part) => part.type === 'text');
    const rendered = textParts.map((part) => (part.type === 'text' ? part.text : '')).join('');
    expect(rendered).toContain(
      '[Per-line truncation occurred; the complete text output was saved to a file (media parts stay attached to this result).',
    );
    expect(result.output).toContainEqual(image);
  });

  it('replaces output when per-line shaping still exceeds the char cap', async () => {
    const full = `${'y'.repeat(3_000)}\n`.repeat(40);

    const result = await truncation.truncateForModel<ExecutableToolResult>({
      toolName: 'Grep',
      toolCallId: 'call_grep_cap',
      result: { output: full },
    });

    const rendered = result.output;
    expect(typeof rendered).toBe('string');
    if (typeof rendered !== 'string') throw new Error('expected string output');
    expect(rendered).toContain('Tool output exceeded 50000 characters');
    expect(rendered).not.toContain('Per-line truncation occurred');
    await expect(readFile(renderedOutputPath(rendered), 'utf8')).resolves.toBe(full);
  });

  it('delivers long lines whole while the total fits the budget', async () => {
    const below = { output: `prefix\n${'x'.repeat(30_000)}` } as const;

    await expect(
      truncation.truncateForModel({
        toolName: 'FetchURL',
        toolCallId: 'call_below',
        result: below,
      }),
    ).resolves.toBe(below);
  });

  it('passes spill-exempt results through untouched', async () => {
    const exempt = { output: 'z'.repeat(60_000), spillExempt: true as const };

    await expect(
      truncation.truncateForModel({
        toolName: 'Read',
        toolCallId: 'call_read',
        result: exempt,
      }),
    ).resolves.toBe(exempt);
  });

  it('identifies paths inside the agent spill directory', () => {
    const dir = spillDir();
    expect(truncation.isSpillFilePath(join(dir, 'Bash-call-1.txt'))).toBe(true);
    expect(truncation.isSpillFilePath(dir)).toBe(true);
    expect(
      truncation.isSpillFilePath(
        join(homeDir, 'sessions/workspace/session/agents/main/other/file.txt'),
      ),
    ).toBe(false);
    expect(truncation.isSpillFilePath(join(homeDir, 'tool-results-evil/file.txt'))).toBe(false);
  });

  it('persists oversized text content parts as one complete text file', async () => {
    const output: ContentPart[] = [
      { type: 'text', text: 'first\n' },
      { type: 'text', text: 'y'.repeat(50_001) },
    ];

    const result = await truncation.truncateForModel<ExecutableToolResult>({
      toolName: 'Lookup',
      toolCallId: 'call_text_parts',
      result: { output },
    });

    expect(result.truncated).toBe(true);
    if (!Array.isArray(result.output)) throw new Error('expected content parts output');
    const texts = result.output
      .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('');
    expect(texts).toContain('Per-line truncation occurred');
    await expect(readFile(renderedOutputPath(texts), 'utf8')).resolves.toBe(
      `first\n${'y'.repeat(50_001)}`,
    );
  });

  it('spills results flagged as truncated instead of passing them through', async () => {
    const full = bulk('z', 501);

    const result = await truncation.truncateForModel<ExecutableToolResult>({
      toolName: 'Read',
      toolCallId: 'call_truncated',
      result: { output: full, truncated: true },
    });

    expect(result.truncated).toBe(true);
    const rendered = result.output;
    expect(typeof rendered).toBe('string');
    if (typeof rendered !== 'string') throw new Error('expected string output');
    expect(rendered).toContain('Tool output exceeded 50000 characters');
    await expect(readFile(renderedOutputPath(rendered), 'utf8')).resolves.toBe(full);
  });

  it('uses unique output files for repeated call ids', async () => {
    const first = await truncation.truncateForModel({
      toolName: 'Lookup',
      toolCallId: 'call_repeat',
      result: { output: `${'a'.repeat(50_001)}first` },
    });
    const second = await truncation.truncateForModel({
      toolName: 'Lookup',
      toolCallId: 'call_repeat',
      result: { output: `${'b'.repeat(50_001)}second` },
    });

    const firstPath = renderedOutputPath(first.output);
    const secondPath = renderedOutputPath(second.output);
    expect(firstPath).not.toBe(secondPath);
    await expect(readFile(firstPath, 'utf8')).resolves.toContain('first');
    await expect(readFile(secondPath, 'utf8')).resolves.toContain('second');
  });

  it('renders a bounded preview without a pointer when the spill write fails', async () => {
    const ix = disposables.add(new TestInstantiationService());
    ix.stub(IBootstrapService, stubBootstrap(homeDir));
    ix.stub(
      IAgentScopeContext,
      makeAgentScopeContext({
        agentId: 'main',
        agentScope: 'sessions/workspace/session/agents/main',
      }),
    );
    ix.stub(IFlagService, stubFlag());
    ix.stub(IFileSystemStorageService, {
      write: async () => {
        throw new Error('disk full');
      },
    } as unknown as IFileSystemStorageService);
    const failing = ix.createInstance(ToolResultTruncationService);

    const longLine = await failing.truncateForModel<ExecutableToolResult>({
      toolName: 'Lookup',
      toolCallId: 'call_fail_long_line',
      result: { output: 'x'.repeat(60_000) },
    });
    expect(longLine.truncated).toBe(true);
    const renderedLongLine = longLine.output;
    expect(typeof renderedLongLine).toBe('string');
    if (typeof renderedLongLine !== 'string') throw new Error('expected string output');
    expect(renderedLongLine).not.toContain('output_path:');
    expect(renderedLongLine).toContain('could not be saved to a file');
    expect(renderedLongLine.length).toBeLessThan(10_000);

    const shortLines = await failing.truncateForModel<ExecutableToolResult>({
      toolName: 'Lookup',
      toolCallId: 'call_fail_short_lines',
      result: { output: 'short line\n'.repeat(6_000) },
    });
    expect(shortLines.truncated).toBe(true);
    const renderedShortLines = shortLines.output;
    expect(typeof renderedShortLines).toBe('string');
    if (typeof renderedShortLines !== 'string') throw new Error('expected string output');
    expect(renderedShortLines).not.toContain('output_path:');
    expect(renderedShortLines).toContain('could not be saved to a file');
    expect(renderedShortLines.length).toBeLessThan(10_000);
  });
function bulkItems() {
    return Array.from({ length: 400 }, (_, index) => ({
      id: `item-${index}`,
      description:
        'Long descriptive prose that exists only to add bulk to this payload and nothing else at all. '.repeat(5),
    }));
  }

  it('keeps the head and tail preview for large JSON when compression is off', async () => {
    const payload = JSON.stringify(bulkItems(), null, 2);
    const result = await truncation.truncateForModel<ExecutableToolResult>({
      toolName: 'Search',
      toolCallId: 'call:json-off',
      result: { output: payload, isError: false },
    });
    const rendered = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
    expect(result.truncated).toBe(true);
    expect(rendered).not.toContain('structure and identifiers kept');
    expect(rendered).toContain('[preview: chars');
  });

  it('inlines the compacted structure and keeps the original retrievable when compression is on', async () => {
    compressionEnabled = true;
    const payload = JSON.stringify(bulkItems(), null, 2);
    const result = await truncation.truncateForModel<ExecutableToolResult>({
      toolName: 'Search',
      toolCallId: 'call:json-on',
      result: { output: payload, isError: false },
    });
    const rendered = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
    expect(result.truncated).toBe(true);
    expect(rendered).toContain('structure and identifiers kept');
    expect(rendered).toContain('item-24');
    expect(rendered).toContain('__omitted_items');
    const savedPath = renderedOutputPath(rendered);
    expect(await readFile(savedPath, 'utf8')).toContain('item-300');
  });
});

describe('compactStructuredText', () => {
  it('returns undefined for content that is not JSON', () => {
    expect(compactStructuredText('plain text, not json')).toBeUndefined();
  });

  it('strips indentation without reporting removed values', () => {
    const raw = JSON.stringify({ id: 'a1', nested: { name: 'x', count: 2 } }, null, 2);
    const result = compactStructuredText(raw);
    expect(result).toBeDefined();
    expect(result!.text.length).toBeLessThan(raw.length);
    expect(result!.removedValues).toBe(0);
    expect(result!.removedItems).toBe(0);
    expect(JSON.parse(result!.text)).toEqual({ id: 'a1', nested: { name: 'x', count: 2 } });
  });

  it('keeps the first array items, counts the rest, and marks the omission', () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      id: `item-${index}`,
      state: 'ok',
    }));
    const result = compactStructuredText(JSON.stringify(items), {
      maxArrayItems: 5,
      maxStringChars: 160,
      entropyThreshold: 0.85,
      maxDepth: 32,
    });
    expect(result).toBeDefined();
    expect(result!.removedItems).toBe(35);
    const parsed = JSON.parse(result!.text) as unknown[];
    expect(parsed).toHaveLength(6);
    expect(parsed[5]).toEqual({ __omitted_items: 35 });
  });

  it('elides a bulky prose value but keeps a dense identifier of the same length', () => {
    const dense = 'a3f1c9e77b204d5f8a1c6e0b93d4725f6c8a19e4b7d35f2081ca64e93b7d15a8';
    const prose =
      'This is a long descriptive sentence that carries no identifier at all and keeps repeating itself over and over again for a while, and then it continues for another clause so that it comfortably passes the length threshold.';
    const result = compactStructuredText(JSON.stringify({ dense, prose }));
    expect(result).toBeDefined();
    expect(result!.removedValues).toBe(1);
    const parsed = JSON.parse(result!.text) as Record<string, string>;
    expect(parsed['dense']).toBe(dense);
    expect(parsed['prose']).toContain('__omitted_chars');
  });

  it('scores repetitive text low and mixed text high', () => {
    expect(isDenseIdentifier('a3f1c9e77b204d5f8a1c6e0b93d4725f')).toBe(true);
    expect(isDenseIdentifier('a value with spaces')).toBe(false);
    expect(normalizedEntropy('aaaaaaaaaaaaaaaa')).toBeLessThan(0.2);
    expect(normalizedEntropy('aB3f9Qx7Lm2Zp8Rw')).toBeGreaterThan(0.8);
  });
});

function renderedOutputPath(output: unknown): string {
  if (typeof output !== 'string') throw new Error('expected rendered output to be a string');
  const match = /^output_path: (.+)$/m.exec(output);
  if (match === null) throw new Error('expected rendered output to include output_path');
  return match[1]!;
}
