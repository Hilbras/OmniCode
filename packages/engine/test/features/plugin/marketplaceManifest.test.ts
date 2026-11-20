import { describe, expect, it } from 'vitest';

import {
  resolvePluginName,
  validateMarketplace,
  type MarketplaceManifest,
} from '#/features/plugin/marketplaceManifest';

const manifest = (): MarketplaceManifest => ({
  name: 'core',
  plugins: [{
    name: 'reviewer',
    source: { kind: 'git-subdir', location: 'https://example.test/plugins', subdir: 'reviewer' },
    category: 'workflow',
    renames: { check: 'review-check' },
    userConfigKeys: ['strictness'],
  }],
});

describe('validateMarketplace', () => {
  it('accepts a valid manifest', () => {
    expect(validateMarketplace(manifest())).toEqual([]);
  });

  it('rejects duplicates, missing locations and subdir-less git sources', () => {
    const original = manifest();
    const bad: MarketplaceManifest = {
      ...original,
      plugins: [...original.plugins, { ...original.plugins[0]!, source: { kind: 'git-subdir', location: '' } }],
    };
    expect(validateMarketplace(bad).map((issue) => issue.reason)).toContain('duplicate plugin name');
    expect(validateMarketplace(bad).map((issue) => issue.reason)).toContain('source location is required');
    expect(validateMarketplace(bad).map((issue) => issue.reason)).toContain('git-subdir source requires a subdir');
  });
});

describe('resolvePluginName', () => {
  it('applies renames and passes through unknown names', () => {
    const entry = manifest().plugins[0]!;
    expect(resolvePluginName(entry, 'check')).toBe('review-check');
    expect(resolvePluginName(entry, 'other')).toBe('other');
  });
});
