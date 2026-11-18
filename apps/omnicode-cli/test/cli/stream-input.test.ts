import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { readStreamJsonPrompt, readTextPrompt } from '#/cli/stream-input';

function stream(...lines: string[]): Readable {
  return Readable.from(lines);
}

describe('stream-json prompt input', () => {
  it('joins text from typed lines', async () => {
    const prompt = await readStreamJsonPrompt(
      stream(
        `${JSON.stringify({ type: 'user', text: 'hello' })}\n`,
        `${JSON.stringify({ text: 'world' })}\n`,
      ),
    );
    expect(prompt).toBe('hello\nworld');
  });

  it('reads content parts', async () => {
    const prompt = await readStreamJsonPrompt(
      stream(`${JSON.stringify({ type: 'user', content: [{ type: 'text', text: 'hi' }] })}\n`),
    );
    expect(prompt).toBe('hi');
  });

  it('skips non-user control lines', async () => {
    const prompt = await readStreamJsonPrompt(
      stream(
        `${JSON.stringify({ type: 'meta', text: 'ignored' })}\n`,
        `${JSON.stringify({ type: 'user', text: 'kept' })}\n`,
      ),
    );
    expect(prompt).toBe('kept');
  });

  it('rejects malformed JSON and empty input', async () => {
    await expect(readStreamJsonPrompt(stream('not json\n'))).rejects.toThrow(/Invalid JSON/);
    await expect(readStreamJsonPrompt(stream(''))).rejects.toThrow(/No input/);
  });

  it('reads plain text input', async () => {
    await expect(readTextPrompt(stream('hello\nworld'))).resolves.toBe('hello\nworld');
    await expect(readTextPrompt(stream('  '))).rejects.toThrow(/No input/);
  });
});
