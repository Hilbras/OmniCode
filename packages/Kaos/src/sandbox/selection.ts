import type {
  SandboxAvailability,
  SandboxBackendKind,
  SandboxPermissionMode,
  SandboxSelection,
} from './types';

/** Ordered by platform coverage: bwrap (Linux), seatbelt (macOS), landlock (reserved). */
export const SANDBOX_BACKEND_PREFERENCE: readonly SandboxBackendKind[] = [
  'bwrap',
  'seatbelt',
  'landlock',
];

export interface SandboxSelectionInput {
  readonly permissionMode: SandboxPermissionMode;
  readonly availability: readonly SandboxAvailability[];
}

function unavailableMessage(mode: SandboxPermissionMode): string {
  switch (mode) {
    case 'manual':
      return 'no OS sandbox backend is available; manual mode still requires approval for every command';
    case 'auto':
      return 'no OS sandbox backend is available; auto mode permission checks still apply';
    case 'yolo':
      return 'no OS sandbox backend is available; yolo mode runs commands without OS isolation';
  }
}

export function selectSandboxBackend(input: SandboxSelectionInput): SandboxSelection {
  for (const kind of SANDBOX_BACKEND_PREFERENCE) {
    const available = input.availability.find(
      (candidate) => candidate.backend === kind && candidate.available,
    );
    if (available !== undefined) {
      return {
        backend: kind,
        enabled: true,
        permissionMode: input.permissionMode,
        reason: 'sandbox-available',
        message: `${kind} sandbox is available and selected`,
        availability: available,
      };
    }
  }

  return {
    backend: null,
    enabled: false,
    permissionMode: input.permissionMode,
    reason: 'sandbox-unavailable',
    message: unavailableMessage(input.permissionMode),
    availability: null,
  };
}
