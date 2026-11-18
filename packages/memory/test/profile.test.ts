import { describe, expect, it } from 'vitest';

import { extractProfileStatements } from '#/layers/profile';

function contents(prompt: string): string[] {
  return extractProfileStatements(prompt).map((statement) => statement.content);
}

describe('extractProfileStatements', () => {
  it.each([
    ['my name is Hassan', 'my name is Hassan'],
    ['call me Hassan', 'my name is Hassan'],
    ['I live in Cairo', 'I live in Cairo'],
    ['I am based in Cairo', 'I live in Cairo'],
    ["I'm from Cairo", 'I live in Cairo'],
    ['my location is Cairo', 'I live in Cairo'],
    ['my timezone is UTC+2', 'my timezone is UTC+2'],
    ["I'm in the Cairo timezone", 'my timezone is Cairo'],
    ['I work as a backend engineer', 'I work as backend engineer'],
    ['my job is backend engineer', 'I work as backend engineer'],
    ['I work at Acme', 'I work at Acme'],
    ['my company is Acme', 'I work at Acme'],
    ['I speak Arabic', 'I speak Arabic'],
    ['my native language is Arabic', 'I speak Arabic'],
    ['I prefer pnpm', 'I prefer pnpm'],
    ['I use Neovim', 'I use Neovim'],
    ['my editor is Neovim', 'my editor is Neovim'],
    ['remember that I am a backend developer', 'I am a backend developer'],
  ])('extracts %j', (prompt, expected) => {
    expect(contents(prompt)).toContain(expected);
  });

  it('gives profile facts stable subjects', () => {
    const statements = extractProfileStatements(
      'I work as a backend engineer and I live in Cairo',
    );
    expect(statements).toEqual(
      expect.arrayContaining([
        { content: 'I work as backend engineer', subject: 'profile.occupation' },
        { content: 'I live in Cairo', subject: 'profile.location' },
      ]),
    );
  });

  it('does not capture ordinary conversation', () => {
    expect(contents('I am tired and I use the bathroom')).toEqual([]);
  });
});
