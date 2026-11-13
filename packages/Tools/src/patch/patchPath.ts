import { isAbsolute, normalize, relative, resolve } from 'pathe';

/**
 * Path resolution seam for patch application.
 *
 * Patch text carries workspace-relative paths; a host decides what backend
 * path each one denotes. Local execution resolves to the workspace sandbox,
 * a remote host can resolve to its own tree without the patch engine knowing
 * anything about that host.
 */
export interface PatchPathMapper {
  /** Map a path authored in the patch to the backend path the adapter uses. */
  toBackend(path: string): string;
}

export class PatchPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchPathError';
  }
}

export function createPatchPathMapper(resolvePath: (path: string) => string): PatchPathMapper {
  return { toBackend: resolvePath };
}

/** Backend paths are the patch paths; used by in-memory and local adapters. */
export const identityPatchPathMapper: PatchPathMapper = { toBackend: (path) => path };

/**
 * Mapper that roots every patch path under `root` and refuses absolute paths
 * or `..` traversal. Use it when the backend is a tree the patch author does
 * not otherwise address.
 */
export function rootedPatchPathMapper(root: string): PatchPathMapper {
  const base = normalize(root);
  return {
    toBackend(path: string): string {
      if (path.length === 0) throw new PatchPathError('patch path must not be empty');
      if (isAbsolute(path)) {
        throw new PatchPathError(`patch path must be relative to the patch root: ${path}`);
      }
      const target = resolve(base, path);
      const rel = relative(base, target);
      if (rel === '' || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
        throw new PatchPathError(`patch path escapes the patch root: ${path}`);
      }
      return target;
    },
  };
}