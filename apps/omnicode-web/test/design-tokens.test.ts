import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokensCss = readFileSync(join(appRoot, 'src', 'styles', 'tokens.css'), 'utf8');

function themeBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  if (open < 0) return '';
  let depth = 1;
  let cursor = open + 1;
  while (depth > 0 && cursor < css.length) {
    const ch = css[cursor];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    cursor += 1;
  }
  return css.slice(open + 1, cursor - 1);
}

function customProperties(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;
    map.set(`--${name}`, value.trim());
  }
  return map;
}

// Sample of the Hilbras family tokens the app must carry verbatim.
// Source of truth: hilbras site globals.css.
const DARK_SAMPLE: Record<string, string> = {
  '--bg': '#0c0b09',
  '--surface': '#15130e',
  '--text': '#f2efe6',
  '--gold': '#e2bd52',
  '--gold-text': '#e6c768',
  '--danger': '#ff8a80',
};
const LIGHT_SAMPLE: Record<string, string> = {
  '--bg': '#faf9f5',
  '--surface': '#ffffff',
  '--text': '#17150f',
  '--gold': '#d4af37',
  '--gold-text': '#7d620f',
  '--danger': '#c23b31',
};

const COMPONENT_CLASSES = [
  'btn-gold',
  'btn-ghost',
  'btn-quiet',
  'card',
  'panel',
  'eyebrow',
  'mono-label',
  'gold-text',
  'hairline',
  'nav-blur',
  'node',
  'theme-toggle',
];

const FONT_FACES = ['geist-latin.woff2', 'geist-latin-ext.woff2', 'geist-mono-latin.woff2', 'geist-mono-latin-ext.woff2'];

describe('Hilbras design token port', () => {
  it('carries the family tokens verbatim in the dark theme', () => {
    const dark = customProperties(themeBlock(tokensCss, '[data-theme="dark"]'));
    for (const [name, value] of Object.entries(DARK_SAMPLE)) {
      expect(dark.get(name), `${name} in dark`).toBe(value);
    }
  });

  it('carries the family tokens verbatim in the light theme', () => {
    const light = customProperties(themeBlock(tokensCss, '[data-theme="light"]'));
    for (const [name, value] of Object.entries(LIGHT_SAMPLE)) {
      expect(light.get(name), `${name} in light`).toBe(value);
    }
  });

  it('exposes the shared component classes', () => {
    for (const className of COMPONENT_CLASSES) {
      expect(tokensCss, className).toContain(`.${className}`);
    }
  });

  it('declares every self-hosted Geist font face', () => {
    expect(tokensCss).toContain('font-family: "Geist"');
    expect(tokensCss).toContain('font-family: "Geist Mono"');
    for (const font of FONT_FACES) {
      expect(tokensCss, font).toContain(`/fonts/${font}`);
      expect(() => readFileSync(join(appRoot, 'public', 'fonts', font))).not.toThrow();
    }
  });
});
