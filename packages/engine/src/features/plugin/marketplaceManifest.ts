/**
 * Installable plugin marketplace manifest (unified plan C1).
 *
 * A catalog of plugins with git-subdir/local sources, categories, name renames
 * and typed user-config keys, so skills/features can be distributed rather
 * than only discovered locally. Reference: Claude `.claude-plugin/marketplace.json:2-191`.
 */
export interface PluginSource {
  readonly kind: 'git-subdir' | 'local' | 'registry';
  readonly location: string;
  readonly subdir?: string;
}

export interface MarketplaceEntry {
  readonly name: string;
  readonly source: PluginSource;
  readonly category?: string;
  readonly renames?: Readonly<Record<string, string>>;
  readonly userConfigKeys?: readonly string[];
}

export interface MarketplaceManifest {
  readonly name: string;
  readonly plugins: readonly MarketplaceEntry[];
}

export interface ManifestIssue {
  readonly field: string;
  readonly reason: string;
}

export function validateMarketplace(manifest: MarketplaceManifest): readonly ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  if (manifest.name.trim().length === 0) issues.push({ field: 'name', reason: 'name is required' });
  const names = new Set<string>();
  for (const plugin of manifest.plugins) {
    if (names.has(plugin.name)) issues.push({ field: plugin.name, reason: 'duplicate plugin name' });
    names.add(plugin.name);
    if (plugin.source.location.trim().length === 0) {
      issues.push({ field: plugin.name, reason: 'source location is required' });
    }
    if (plugin.source.kind === 'git-subdir' && (plugin.source.subdir ?? '').trim().length === 0) {
      issues.push({ field: plugin.name, reason: 'git-subdir source requires a subdir' });
    }
    for (const [from, to] of Object.entries(plugin.renames ?? {})) {
      if (from.trim().length === 0 || to.trim().length === 0) {
        issues.push({ field: plugin.name, reason: 'rename has an empty side' });
      }
    }
  }
  return issues;
}

export function resolvePluginName(
  entry: MarketplaceEntry,
  requested: string,
): string {
  return entry.renames?.[requested] ?? requested;
}
