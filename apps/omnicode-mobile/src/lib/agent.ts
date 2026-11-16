import type { ToolName } from './types';

export interface ToolStep {
  kind: 'tool';
  tool: ToolName;
  args: Record<string, string>;
  needsApproval: boolean;
  result: string;
  durationMs: number;
}

export interface TextStep {
  kind: 'text';
  text: string;
}

export type AgentStep = ToolStep | TextStep;

function topicOf(input: string): string {
  const clean = input
    .replace(/^(please|can you|could you|help me|i want to|i need to|let's)\s+/i, '')
    .replace(/[?!.]+\s*$/, '')
    .trim();
  const words = clean.split(/\s+/).slice(0, 9).join(' ');
  return words.length > 0 ? words : 'your request';
}

function searchAnswer(topic: string): string {
  return [
    `Here's what I found on **${topic}** — three sources, cross-checked:`,
    '',
    `## Key findings`,
    '',
    `1. **The landscape moved fast.** Most coverage from even six months ago is already stale; the current consensus differs on two important points.`,
    `2. **Trade-offs are real.** The popular option optimizes for speed of adoption, while the quieter option wins on long-term maintenance cost.`,
    `3. **A practical default exists.** For most teams the mid-path choice covers ~90% of cases without locking you in.`,
    '',
    `> "The best choice is the one your future self can still reverse." — synthesis of the sources below`,
    '',
    `**Sources**`,
    `- [1] Overview and benchmarks — retrieved just now`,
    `- [2] practitioner write-up with production notes`,
    `- [3] official docs, changelog section`,
    '',
    `Want me to go deeper on any of the three, or turn this into a decision memo?`,
  ].join('\n');
}

function fileAnswer(fileName: string): string {
  return [
    `I read **${fileName}** end to end. The short version:`,
    '',
    `## Summary`,
    '',
    `The document is in good shape overall. Three things stand out:`,
    '',
    `- **Structure is sound.** Sections flow logically; a reader can navigate without a map.`,
    `- **One claim needs a citation.** The middle section asserts a number that isn't backed by the appendix.`,
    `- **The ending is weak.** It summarizes instead of deciding — replace it with a clear recommendation.`,
    '',
    `## Suggested next step`,
    '',
    `I can draft the replacement ending, or mark up the full document with inline comments. Which would help more?`,
  ].join('\n');
}

function codeAnswer(topic: string): string {
  return [
    `Ran it in the on-device sandbox. **${topic}** — here's the result and the reasoning:`,
    '',
    '```ts',
    `function solve(input: number[]): number {`,
    `  const seen = new Map<number, number>();`,
    `  for (let i = 0; i < input.length; i++) {`,
    `    const want = target - input[i]!;`,
    `    if (seen.has(want)) return seen.get(want)!;`,
    `    seen.set(input[i]!, i);`,
    `  }`,
    `  return -1;`,
    `}`,
    '```',
    '',
    `**Why this shape:** one pass, \`O(n)\` time, \`O(n)\` space. The hash map trades memory for the nested loop — on phone-sized inputs that's the right side of the trade.`,
    '',
    `The sandbox executed 3 test cases; all passed. Want me to add edge cases or port it to another language?`,
  ].join('\n');
}

function planAnswer(topic: string): string {
  return [
    `Here's a plan for **${topic}**, structured so you can act on it today:`,
    '',
    `## Phase 1 — Foundation`,
    `- Define the one-sentence outcome. If it takes two sentences, split the project.`,
    `- List what already exists; reuse beats rebuild.`,
    '',
    `## Phase 2 — Build`,
    `- Ship the smallest end-to-end slice first, then widen.`,
    `- Keep every step reversible until the last responsible moment.`,
    '',
    `## Phase 3 — Verify`,
    `- Test the real path a user takes, not just the pieces.`,
    `- Write down what "done" means before you start, not after.`,
    '',
    `**Rule of thumb:** momentum compounds. A small finished thing beats a large unfinished one every time.`,
    '',
    `Tell me which phase you're in and I'll get specific.`,
  ].join('\n');
}

function defaultAnswer(topic: string): string {
  return [
    `Good question. Let me think through **${topic}** with you.`,
    '',
    `The way I'd approach it:`,
    '',
    `1. **Clarify the outcome.** What does a great result look like, concretely?`,
    `2. **Find the constraint.** Time, budget, or knowledge — one of them is the real bottleneck, and it changes the answer.`,
    `3. **Pick the reversible path.** When uncertain, prefer the option you can undo.`,
    '',
    `I can research this with live sources, run numbers in the sandbox, or draft something for you — I'll ask permission before touching anything sensitive.`,
    '',
    `What's the context behind this? The more I know, the sharper I can be.`,
  ].join('\n');
}

export function planTurn(input: string, attachmentNames: string[] = []): AgentStep[] {
  const text = input.toLowerCase();
  const topic = topicOf(input);

  if (attachmentNames.length > 0) {
    const name = attachmentNames[0] ?? 'document';
    return [
      {
        kind: 'tool',
        tool: 'read_file',
        args: { path: name, reason: 'Analyze the attached document' },
        needsApproval: true,
        result: `Read ${name}: 14 sections, 3,214 words. Structure parsed; key claims extracted.`,
        durationMs: 900,
      },
      { kind: 'text', text: fileAnswer(name) },
    ];
  }

  if (/\b(search|research|latest|news|find|compare|who is|what is|look up)\b/.test(text)) {
    return [
      {
        kind: 'tool',
        tool: 'web_search',
        args: { query: topic, max_results: '5' },
        needsApproval: false,
        result: '5 results · 3 relevant · fetched 2 pages for depth',
        durationMs: 1400,
      },
      {
        kind: 'tool',
        tool: 'read_url',
        args: { url: 'https://docs.example.dev/overview' },
        needsApproval: false,
        result: '200 OK · 4,180 words extracted · main content isolated',
        durationMs: 1100,
      },
      { kind: 'text', text: searchAnswer(topic) },
    ];
  }

  if (/\b(file|document|report|read|pdf|summarize this)\b/.test(text)) {
    return [
      {
        kind: 'tool',
        tool: 'read_file',
        args: { path: '~/Documents/quarterly-report.md', reason: 'Summarize the document' },
        needsApproval: true,
        result: 'Read quarterly-report.md: 14 sections, 3,214 words.',
        durationMs: 800,
      },
      { kind: 'text', text: fileAnswer('quarterly-report.md') },
    ];
  }

  if (/\b(code|calculate|compute|run|script|debug|refactor|function|algorithm)\b/.test(text)) {
    return [
      {
        kind: 'tool',
        tool: 'run_code',
        args: { runtime: 'quickjs', snippet: 'solve([2, 7, 11, 15], 9)' },
        needsApproval: false,
        result: 'exit 0 · 3/3 tests passed · 4ms',
        durationMs: 1200,
      },
      { kind: 'text', text: codeAnswer(topic) },
    ];
  }

  if (/\b(remember|save this|note that|don't forget|memory)\b/.test(text)) {
    return [
      {
        kind: 'tool',
        tool: 'memory_save',
        args: { content: topic, trust: 'unverified' },
        needsApproval: false,
        result: 'Saved to on-device memory · trust: unverified · provenance: model',
        durationMs: 300,
      },
      {
        kind: 'text',
        text: `Saved. I'll remember **${topic}** on this device.\n\nOne note on trust: anything I write to memory myself is marked \`unverified\` until you confirm it — that keeps my notes from quietly becoming "facts." You can review or forget anything from memory later.`,
      },
    ];
  }

  if (/\b(plan|trip|itinerary|roadmap|schedule|organize|steps)\b/.test(text)) {
    return [{ kind: 'text', text: planAnswer(topic) }];
  }

  return [{ kind: 'text', text: defaultAnswer(topic) }];
}
