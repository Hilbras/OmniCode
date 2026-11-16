import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { createApp } from 'vue';
import { createI18n } from 'vue-i18n';
import { createOmnicodeI18n, messages, OmnicodeI18nKey, useOmnicodeI18n } from '../src';

const englishMessages = messages.en;
const chineseMessages = messages.zh;

function flatten(value: unknown, prefix = ''): Map<string, string> {
  if (typeof value !== 'object' || value === null) {
    return new Map([[prefix, String(value)]]);
  }
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    [...flatten(nested, prefix === '' ? key : `${prefix}.${key}`).entries()],
  );
  return new Map(entries);
}

const en = flatten(englishMessages);
const zh = flatten(chineseMessages);

describe('createOmnicodeI18n', () => {
  it('returns the Chinese message for locale "zh"', () => {
    const i18n = createOmnicodeI18n({ locale: 'zh' });
    expect(i18n.global.t('filePreview.copyCode')).toBe('复制代码');
  });

  it('returns the English message for locale "en"', () => {
    const i18n = createOmnicodeI18n({ locale: 'en' });
    expect(i18n.global.t('filePreview.copyCode')).toBe('Copy code');
  });

  it('renders the /goal description in full (pipe chars are escaped literals, not plural separators)', () => {
    const i18n = createOmnicodeI18n({ locale: 'en' });
    expect(i18n.global.t('commands.goal.desc')).toBe(
      'Create/control a goal: /goal <objective>, /goal pause|resume|cancel',
    );
  });
});

describe('useOmnicodeI18n', () => {
  it('prefers the app-provided OmnicodeI18nKey over the global vue-i18n', () => {
    const globalI18n = createI18n({
      legacy: false,
      locale: 'en',
      messages: { en: { filePreview: { copyCode: 'GLOBAL' } } },
    });
    const app = createApp({});
    app.use(globalI18n);
    app.provide(OmnicodeI18nKey, { t: (key: string) => `INJECTED:${key}` });

    let resolved = '';
    app.runWithContext(() => {
      resolved = useOmnicodeI18n().t('filePreview.copyCode');
    });
    expect(resolved).toBe('INJECTED:filePreview.copyCode');
  });
});

describe('message bundles', () => {
  it('defines every user-visible key in both locales', () => {
    const missingInChinese = [...en.keys()].filter((key) => !zh.has(key));
    const missingInEnglish = [...zh.keys()].filter((key) => !en.has(key));

    expect(missingInChinese).toEqual([]);
    expect(missingInEnglish).toEqual([]);
  });

  // A message may legitimately be empty in one locale — English leaves
  // `sidebar.archiveToastTail` and `tools.activity.liveDonePrefix` empty where
  // Chinese carries the suffix — but a key that is empty in both shows the user
  // nothing at all.
  it('has no message that is empty in both locales', () => {
    const blankEverywhere = [...en.keys()].filter(
      (key) => (en.get(key) ?? '').trim() === '' && (zh.get(key) ?? '').trim() === '',
    );

    expect(blankEverywhere).toEqual([]);
  });
});

describe('key usage across consumers', () => {
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

  function consumers(): string[] {
    const found: string[] = [];
    for (const group of ['packages', 'apps']) {
      for (const entry of readdirSync(join(repoRoot, group))) {
        const manifest = join(repoRoot, group, entry, 'package.json');
        if (!existsSync(manifest)) continue;
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
          peerDependencies?: Record<string, string>;
        };
        const deps = {
          ...parsed.dependencies,
          ...parsed.devDependencies,
          ...parsed.peerDependencies,
        };
        if ('@hilbras/app-i18n' in deps) found.push(join(repoRoot, group, entry));
      }
    }
    return found;
  }

  function sourceFiles(dir: string): string[] {
    const files: string[] = [];
    const walk = (current: string): void => {
      for (const entry of readdirSync(current)) {
        if (entry === 'node_modules' || entry === 'dist' || entry === 'test') continue;
        const full = join(current, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|vue)$/.test(entry)) files.push(full);
      }
    };
    if (existsSync(join(dir, 'src'))) walk(join(dir, 'src'));
    return files;
  }

  // This is a usage lint, not a rendering test: components resolve keys through
  // `t()` at runtime, so the only way to know which keys the tree depends on is to
  // read the call sites. Renaming a key without updating the callers would ship a
  // screen showing the raw key, which no parity check between the two bundles can
  // catch.
  const referenced = new Map<string, string[]>();
  for (const consumer of consumers()) {
    for (const file of sourceFiles(consumer)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\bt\(\s*['"]([A-Za-z0-9_.]+)['"]/g)) {
        const key = match[1];
        if (key === undefined) continue;
        referenced.set(key, [...(referenced.get(key) ?? []), relative(repoRoot, file)]);
      }
    }
  }

  it('scans the apps that actually consume the bundles', () => {
    // A gate that silently scans nothing is worse than no gate.
    expect(consumers().length).toBeGreaterThanOrEqual(5);
    expect(referenced.size).toBeGreaterThanOrEqual(400);
  });

  it('resolves every referenced key in both locales', () => {
    const unknown = [...referenced.entries()]
      .filter(([key]) => !en.has(key) || !zh.has(key))
      .map(([key, files]) => `${key} (${files[0]})`);

    expect(unknown).toEqual([]);
  });

  it('names every referenced key under a namespace the bundles define', () => {
    const namespaces = new Set(Object.keys(englishMessages as Record<string, unknown>));
    // A literal whose first segment is not a namespace is either a typo
    // (`workpace.x`) or a `t()` that is not this bundle's translator. Both are worth
    // failing on: fix the key, or scope this scan so the call site is excluded.
    const foreign = [...referenced.keys()]
      .filter((key) => !namespaces.has(key.split('.')[0] ?? ''))
      .map((key) => `${key} (${(referenced.get(key) ?? [])[0]})`);

    expect(foreign).toEqual([]);
  });
});
