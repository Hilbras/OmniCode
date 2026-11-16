import { describe, expect, it } from 'vitest';

import type {
  IWebSearchProviderService,
  WebSearchProvider,
} from '@hilbras/omnicode-engine/app/auth/webSearch/webSearch';
import type { ExecutableToolResult } from '@hilbras/omnicode-engine/tool/toolContract';

import { WebSearchTool } from '#/web-search/webSearchTool';

function output(result: ExecutableToolResult): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

function providerService(provider: WebSearchProvider | undefined): IWebSearchProviderService {
  return {
    _serviceBrand: undefined,
    getWebSearchProvider: () => provider,
    hasWebSearchProvider: () => provider !== undefined,
  };
}

function harness(provider: WebSearchProvider | undefined) {
  const tool = new WebSearchTool(providerService(provider));
  return {
    async search(query = 'typescript 6 release notes'): Promise<ExecutableToolResult> {
      const execution = tool.resolveExecution({ query });
      if (!('execute' in execution)) throw new Error('expected an executable result');
      return execution.execute({
        turnId: 0,
        toolCallId: 'call_search',
        signal: new AbortController().signal,
      });
    },
  };
}

function providerReturning(results: Awaited<ReturnType<WebSearchProvider['search']>>): WebSearchProvider {
  return { search: async () => results };
}

describe('WebSearchTool', () => {
  it('formats results with the fields and the citation instruction', async () => {
    const { search } = harness(
      providerReturning([
        {
          title: 'TypeScript 6.0',
          url: 'https://example.com/ts6',
          snippet: 'Type stripping is on by default.',
          siteName: 'example.com',
          date: '2026-01-05',
        },
        { title: 'Release notes', url: 'https://example.org/notes', snippet: 'Details.' },
      ]),
    );

    const result = await search();
    const text = output(result);

    expect(result.isError).toBeFalsy();
    expect(text).toContain('Title: TypeScript 6.0');
    expect(text).toContain('Site: example.com');
    expect(text).toContain('Date: 2026-01-05');
    expect(text).toContain('URL: https://example.com/ts6');
    expect(text).toContain('Snippet: Type stripping is on by default.');
    expect(text).toContain('---');
    expect(text).toContain('cite it inline as a markdown link');
  });

  it('says so when the provider returns nothing', async () => {
    const { search } = harness(providerReturning([]));

    const text = output(await search());

    expect(text).toContain('No search results found.');
  });

  it('reports a provider that disappeared after the session started', async () => {
    const { search } = harness(undefined);

    const result = await search();

    expect(result.isError).toBe(true);
    expect(output(result)).toContain('Web search is no longer configured');
  });

  it('classifies provider failures by cause', async () => {
    const cases: [Error, string][] = [
      [Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }), 'Search cancelled:'],
      [Object.assign(new Error('request timed out'), { name: 'TimeoutError' }), 'Search timed out:'],
      [new Error('401 Unauthorized'), 'Search failed (authentication):'],
      [new TypeError('fetch failed'), 'Search failed (network):'],
      [new Error('quota exceeded'), 'Search failed:'],
    ];

    for (const [error, expected] of cases) {
      const { search } = harness({ search: async () => Promise.reject(error) });
      const result = await search();
      expect(result.isError, error.message).toBe(true);
      expect(output(result), error.message).toContain(expected);
    }
  });
});
