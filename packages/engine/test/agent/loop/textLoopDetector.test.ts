import { describe, expect, it } from 'vitest';

import {
  TextLoopDetector,
  detectTextLoop,
  exactPeriod,
  periodicSuffix,
  stripFencedBlocks,
} from '#/agent/loop/textLoopDetector';

const PROSE = [
  'I checked the parser and the fixture it uses.',
  'The failing assertion comes from the tokenizer step.',
  'Before changing anything I want to confirm the expected output.',
  'That means running the focused suite one more time.',
  'The suite is green on this machine for the touched files.',
  'Next I will update the fixture and rerun the same command.',
].join('\n');

function filler(): string {
  return `${PROSE}\n`;
}

describe('stripFencedBlocks', () => {
  it('drops fenced lines and keeps everything outside the fence', () => {
    const text = ['before', '```ts', 'const a = 1;', '```', 'after'].join('\n');
    expect(stripFencedBlocks(text)).toBe(['before', 'after'].join('\n'));
  });

  it('treats an unterminated fence as open to the end', () => {
    const text = ['before', '```', 'const a = 1;'].join('\n');
    expect(stripFencedBlocks(text)).toBe('before');
  });

  it('accepts tilde fences and keeps text between separate fences', () => {
    const text = ['a', '~~~', 'hidden', '~~~', 'b', '```', 'hidden', '```', 'c'].join('\n');
    expect(stripFencedBlocks(text)).toBe(['a', 'b', 'c'].join('\n'));
  });
});

describe('exactPeriod', () => {
  it('finds the smallest whole repetition period', () => {
    expect(exactPeriod('abcabcabc')).toBe(3);
    expect(exactPeriod('abab')).toBe(2);
    expect(exactPeriod('abcd')).toBeUndefined();
    expect(exactPeriod('abcabcab')).toBeUndefined();
  });
});

describe('periodicSuffix', () => {
  it('finds a repeated suffix and ignores a varied head', () => {
    expect(periodicSuffix(`${PROSE}\n${'Step done. '.repeat(6)}`, 200)).toBe(11);
    expect(periodicSuffix('no repetition here at all', 20)).toBeUndefined();
  });

  it('requires the requested number of repeats', () => {
    expect(periodicSuffix('unitunit', 10, 3)).toBeUndefined();
    expect(periodicSuffix('unitunitunit', 10, 3)).toBe(4);
  });
});

describe('detectTextLoop', () => {
  it('stays silent for short text (cold start)', () => {
    expect(detectTextLoop('one line repeated\none line repeated')).toBeUndefined();
  });

  it('stays silent for varied prose', () => {
    expect(detectTextLoop(`${filler()}${filler()}`)).toBeUndefined();
  });

  it('reports a verbatim repeated phrase', () => {
    const line = 'Let me check the configuration file once more.';
    const signal = detectTextLoop(`${filler()}${line}\n${line}\n${line}\n${line}\n`);
    expect(signal?.kind).toBe('repeated-phrase');
    expect(signal?.detail).toContain('let me check the configuration file');
  });

  it('reports alternating blocks', () => {
    const a = 'Running the focused test suite now.';
    const b = 'The suite did not print anything yet.';
    const text = `${filler()}${[a, b, a, b, a, b].join('\n')}\n`;
    const signal = detectTextLoop(text);
    expect(signal?.kind).toBe('alternating-blocks');
    expect(signal?.detail).toContain('running the focused test suite');
  });

  it('reports a periodic tail', () => {
    const text = `${filler()}${'Step done. '.repeat(8)}`;
    const signal = detectTextLoop(text);
    expect(signal?.kind).toBe('periodic-text');
  });

  it('ignores repetition inside a fenced code block', () => {
    const code = ['```ts', ...Array.from({ length: 8 }, () => 'const value = compute(input);'), '```'].join('\n');
    expect(detectTextLoop(`${filler()}${code}`)).toBeUndefined();
  });

  it('ignores a fence that opens and closes across pushes', () => {
    const detector = new TextLoopDetector();
    const repeated = 'const value = compute(input);\n'.repeat(8);
    let signal = detector.push(`${filler()}${filler()}\`\`\`ts\n${repeated}`);
    expect(signal).toBeUndefined();
    signal = detector.push('```\n');
    expect(signal).toBeUndefined();
  });

  it('detects the same kind whether fed whole or in chunks', () => {
    const content = `${filler()}${filler()}${['Alpha line one here.', 'Beta line two here.', 'Alpha line one here.', 'Beta line two here.', 'Alpha line one here.', 'Beta line two here.'].join('\n')}\n`;
    const whole = detectTextLoop(content);
    expect(whole?.kind).toBe('alternating-blocks');

    const detector = new TextLoopDetector();
    let chunked: ReturnType<TextLoopDetector['push']>;
    for (let index = 0; index < content.length; index += 32) {
      chunked = detector.push(content.slice(index, index + 32)) ?? chunked;
    }
    chunked = detector.push('\n'.repeat(64)) ?? chunked;
    expect(chunked?.kind).toBe('alternating-blocks');
  });

  it('resets its buffer', () => {
    const detector = new TextLoopDetector();
    const line = 'Let me check the configuration file once more.';
    expect(detector.push(`${filler()}${line}\n${line}\n${line}\n${line}\n`)?.kind).toBe('repeated-phrase');
    detector.reset();
    expect(detector.text).toBe('');
    expect(detector.push(filler())).toBeUndefined();
  });
});
