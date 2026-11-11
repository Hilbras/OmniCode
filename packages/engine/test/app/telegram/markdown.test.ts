import { describe, expect, it } from 'vitest';

import {
  markdownToTelegramHtml,
  splitMarkdownChunks,
  telegramHtmlBody,
} from '#/app/telegram/markdown';

describe('markdownToTelegramHtml', () => {
  it('renders bold, italic and strikethrough', () => {
    expect(markdownToTelegramHtml('**bold** and *italic* and ~~gone~~')).toBe(
      '<b>bold</b> and <i>italic</i> and <s>gone</s>',
    );
  });

  it('renders inline code without interpreting its contents', () => {
    expect(markdownToTelegramHtml('Use `a < b` here')).toBe('Use <code>a &lt; b</code> here');
  });

  it('renders fenced code blocks and escapes HTML', () => {
    expect(markdownToTelegramHtml('```ts\nconst x = 1 < 2;\n```')).toBe(
      '<pre>const x = 1 &lt; 2;</pre>',
    );
  });

  it('renders links with an escaped URL', () => {
    expect(markdownToTelegramHtml('[site](https://example.com?a=1&b=2)')).toBe(
      '<a href="https://example.com?a=1&amp;b=2">site</a>',
    );
  });

  it('renders headings, blockquotes and list markers', () => {
    expect(markdownToTelegramHtml('# Title\n> quote\n- item')).toBe(
      '<b>Title</b>\n<blockquote>quote</blockquote>\n• item',
    );
  });

  it('escapes HTML in plain text', () => {
    expect(markdownToTelegramHtml('a < b & c')).toBe('a &lt; b &amp; c');
  });

  it('renders a Markdown table as preformatted text', () => {
    expect(markdownToTelegramHtml('| A | B |\n|---|---|\n| 1 | 2 |')).toBe(
      '<pre>A   | B\n--- | ---\n1   | 2</pre>',
    );
  });

  it('renders a horizontal rule', () => {
    expect(markdownToTelegramHtml('above\n---\nbelow')).toBe('above\n────────\nbelow');
  });
});

describe('splitMarkdownChunks', () => {
  it('closes and reopens a code fence across chunks', () => {
    const input = ['```ts', ...Array.from({ length: 20 }, () => 'const x = 1;'), '```'].join('\n');
    const chunks = splitMarkdownChunks(input, 80);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith('```ts')).toBe(true);
      expect(chunk.endsWith('```')).toBe(true);
    }
  });

  it('keeps a short message in one chunk', () => {
    expect(splitMarkdownChunks('hello', 100)).toEqual(['hello']);
  });
});

describe('telegramHtmlBody', () => {
  it('keeps plain text when markdown is disabled', () => {
    expect(telegramHtmlBody('**bold**', false)).toEqual({ text: '**bold**' });
  });

  it('falls back to plain text when the rendered HTML is too long', () => {
    const text = 'a'.repeat(4_001);
    expect(telegramHtmlBody(text, true)).toEqual({ text });
  });
});
