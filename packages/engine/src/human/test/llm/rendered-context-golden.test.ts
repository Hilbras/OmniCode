import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { UNKNOWN_CAPABILITY } from '#/llm/capability';
import {
  createAssistantMessage,
  createToolMessage,
  createUserMessage,
  type Message,
  type ToolDescription,
} from '#/llm/message';
import type { LlmModel } from '#/llm/model';
import { prepareAnthropicRequest } from '#/llm/requester/bases/anthropic/requester';
import { prepareGoogleGenAIRequest } from '#/llm/requester/bases/google-genai/requester';
import { prepareOpenAIResponsesRequest } from '#/llm/requester/bases/openai-responses/requester';
import { prepareOpenAIRequest } from '#/llm/requester/bases/openai/requester';

const goldenDir = fileURLToPath(new URL('./goldens/', import.meta.url));

const model: LlmModel = {
  provider: 'test',
  model: 'gpt-5-mini',
  capability: UNKNOWN_CAPABILITY,
  baseUrl: 'https://example.test/v1',
  apiKey: 'YOUR_API_KEY',
  promptCacheKey: true,
};

const tools: readonly ToolDescription[] = [
  {
    name: 'Read',
    description: 'Read a file from the workspace.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'ApplyPatch',
    description: 'Apply a patch to a file.',
    parameters: {
      type: 'object',
      properties: { patch: { type: 'string' } },
      required: ['patch'],
    },
  },
];

const messages: readonly Message[] = [
  createUserMessage('the parser tests fail'),
  createAssistantMessage(
    [{ type: 'think', think: 'inspect the failing module first' }, { type: 'text', text: 'Let me look.' }],
    [{ type: 'function', id: 'call_1', name: 'Read', arguments: '{"path":"src/parser.ts"}' }],
  ),
  createToolMessage('call_1', 'export function parse(input: string): string { return input; }'),
  createUserMessage('fix it'),
];

const requestInput = {
  model,
  systemPrompt: 'You are a careful coding agent.',
  tools: [...tools],
  cacheKey: 'session-abc',
  thinking: { effort: 'high' },
  maxCompletionTokens: 4096,
  maxContextTokens: 128_000,
  usedContextTokens: 12_000,
  messages,
};

describe('rendered context goldens', () => {
  it('pins the rendered OpenAI chat request for a full agent context', async () => {
    const wire = prepareOpenAIRequest(requestInput);

    const golden = await readFile(join(goldenDir, 'openai-chat-rendered-request.json'), 'utf8');
    expect(wire.params).toEqual(JSON.parse(golden));
    expect(wire.toolNameAliases).toBeUndefined();
  });

  it('pins the rendered Anthropic messages request for a full agent context', async () => {
    const wire = prepareAnthropicRequest(requestInput);

    const golden = await readFile(
      join(goldenDir, 'anthropic-messages-rendered-request.json'),
      'utf8',
    );
    expect(wire.params).toEqual(JSON.parse(golden));
  });

  it('pins the rendered OpenAI Responses request for a full agent context', async () => {
    const wire = prepareOpenAIResponsesRequest(requestInput);

    const golden = await readFile(
      join(goldenDir, 'openai-responses-rendered-request.json'),
      'utf8',
    );
    expect(wire.params).toEqual(JSON.parse(golden));
  });

  it('pins the rendered Google GenAI request for a full agent context', async () => {
    const wire = prepareGoogleGenAIRequest(requestInput);

    const golden = await readFile(join(goldenDir, 'google-genai-rendered-request.json'), 'utf8');
    expect(wire.params).toEqual(JSON.parse(golden));
  });
});
