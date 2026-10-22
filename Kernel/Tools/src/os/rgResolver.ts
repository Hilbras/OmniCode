import {
  ensureRgPath,
  type EnsureRgPathOptions,
  type RgProbe,
  type RgResolution,
} from '@hilbras/omnicode-core/os/backends/node-local/tools/rgLocator';

export type RgResolver = (probe: RgProbe, options: EnsureRgPathOptions) => Promise<RgResolution>;

let resolverOverride: RgResolver | undefined;

/**
 * Resolve the ripgrep binary for the search tools.
 *
 * The tools live in this package while the resolver lives in the kernel, so
 * the lookup runs through this indirection: a test in another package can
 * substitute the resolution without replacing the kernel module itself.
 */
export function resolveRgPath(
  probe: RgProbe,
  options: EnsureRgPathOptions = {},
): Promise<RgResolution> {
  return resolverOverride === undefined
    ? ensureRgPath(probe, options)
    : resolverOverride(probe, options);
}

export function _setRgResolverForTests(resolver: RgResolver | undefined): void {
  resolverOverride = resolver;
}
