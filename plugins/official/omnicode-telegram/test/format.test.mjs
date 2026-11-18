import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  chunkText,
  formatDuration,
  markdownToHtml,
} from '../bin/omnicode-telegram.mjs';

describe('formatDuration', () => {
  it('renders seconds, minutes and hours', () => {
    assert.equal(formatDuration(9000), '9s');
    assert.equal(formatDuration(65000), '1m 5s');
    assert.equal(formatDuration(3_600_000 + 120_000), '1h 2m');
  });

  it('returns an empty string for missing or nonsense durations', () => {
    assert.equal(formatDuration(undefined), '');
    assert.equal(formatDuration(0), '');
    assert.equal(formatDuration(-5), '');
    assert.equal(formatDuration(Number.NaN), '');
  });
});

describe('chunkText', () => {
  it('keeps every chunk within the limit when lines allow', () => {
    const text = Array.from({ length: 40 }, (_, index) => `line ${String(index)}`).join('\n');
    const chunks = chunkText(text, 40);

    assert.ok(chunks.length > 1);
    for (const chunk of chunks) assert.ok(chunk.length <= 40, `chunk too long: ${String(chunk.length)}`);
  });

  it('loses nothing when splitting', () => {
    const text = Array.from({ length: 25 }, (_, index) => `row-${String(index)}`).join('\n');

    assert.equal(chunkText(text, 30).join('\n'), text);
  });

  it('keeps a single oversized line whole instead of cutting it', () => {
    const long = 'x'.repeat(120);

    assert.deepEqual(chunkText(long, 40), [long]);
  });
});

describe('markdownToHtml', () => {
  it('converts headings, bold, inline code and bullets', () => {
    const html = markdownToHtml(['## Done', 'Bold **claim** and `code`', '- one', '* two'].join('\n'));

    assert.match(html, /<b>Done<\/b>/);
    assert.match(html, /<b>claim<\/b>/);
    assert.match(html, /<code>code<\/code>/);
    assert.match(html, /• one/);
    assert.match(html, /• two/);
  });

  it('escapes html so model output cannot break the message', () => {
    const html = markdownToHtml('a <tag> & an ampersand');

    assert.match(html, /&lt;tag&gt;/);
    assert.match(html, /&amp;/);
    assert.doesNotMatch(html, /<tag>/);
  });

  it('keeps fenced blocks escaped and unformatted', () => {
    const html = markdownToHtml(['```sh', 'pnpm test', 'echo $HOME', '```'].join('\n'));

    assert.match(html, /<pre>pnpm test\necho \$HOME<\/pre>/);
  });
});
