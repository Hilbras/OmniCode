import { z } from 'zod';

import {
  getUpdateDismissedStateFile,
  getUpdateRegistryStateFile,
  getUpdateStateFile,
} from '#/utils/paths';
import { readJsonFile, writeJsonFile } from '#/utils/persistence';

import { UpdateManifestSchema } from './cdn';
import { emptyUpdateCache, type UpdateCache } from './types';

// Stays `.strict()` (we own this file), but a malformed manifest is treated
// as no manifest so one bad optional field does not discard the whole cache.
const UpdateCacheSchema = z
  .object({
    source: z.literal('cdn'),
    checkedAt: z.string().min(1).nullable(),
    latest: z.string().min(1).nullable(),
    manifest: z.preprocess((value) => {
      const parsed = UpdateManifestSchema.nullable().safeParse(value === undefined ? null : value);
      return parsed.success ? parsed.data : null;
    }, z.union([UpdateManifestSchema, z.null()])),
  })
  .strict();

export async function readUpdateCache(
  filePath: string = getUpdateStateFile(),
): Promise<UpdateCache> {
  try {
    return await readJsonFile(filePath, UpdateCacheSchema, emptyUpdateCache());
  } catch {
    return emptyUpdateCache();
  }
}

export async function writeUpdateCache(
  value: UpdateCache,
  filePath: string = getUpdateStateFile(),
): Promise<void> {
  await writeJsonFile(filePath, UpdateCacheSchema, value);
}

// ---------------------------------------------------------------------------
// npm-registry check state + recommendation dismissal.
//
// Both files are owned by the CLI, tiny, and `.strict()`: a malformed file
// is treated as absent (the next successful check rewrites it).
// ---------------------------------------------------------------------------

export interface RegistryUpdateState {
  readonly latest: string;
  readonly checkedAt: string;
}

const RegistryUpdateStateSchema = z
  .object({
    latest: z.string().min(1),
    checkedAt: z.string().min(1),
  })
  .strict();

export function emptyRegistryUpdateState(): RegistryUpdateState {
  return { latest: '', checkedAt: '' };
}

export async function readRegistryUpdateState(
  filePath: string = getUpdateRegistryStateFile(),
): Promise<RegistryUpdateState> {
  try {
    return await readJsonFile(filePath, RegistryUpdateStateSchema, emptyRegistryUpdateState());
  } catch {
    return emptyRegistryUpdateState();
  }
}

export async function writeRegistryUpdateState(
  value: RegistryUpdateState,
  filePath: string = getUpdateRegistryStateFile(),
): Promise<void> {
  await writeJsonFile(filePath, RegistryUpdateStateSchema, value);
}

export interface UpdateDismissedState {
  readonly version: string;
  readonly dismissedAt: string;
}

const UpdateDismissedStateSchema = z
  .object({
    version: z.string().min(1),
    dismissedAt: z.string().min(1),
  })
  .strict();

export function emptyUpdateDismissedState(): UpdateDismissedState {
  return { version: '', dismissedAt: '' };
}

export async function readUpdateDismissedState(
  filePath: string = getUpdateDismissedStateFile(),
): Promise<UpdateDismissedState> {
  try {
    return await readJsonFile(filePath, UpdateDismissedStateSchema, emptyUpdateDismissedState());
  } catch {
    return emptyUpdateDismissedState();
  }
}

export async function writeUpdateDismissedState(
  value: UpdateDismissedState,
  filePath: string = getUpdateDismissedStateFile(),
): Promise<void> {
  await writeJsonFile(filePath, UpdateDismissedStateSchema, value);
}
