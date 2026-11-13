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
  /**
   * Host-configured backend. When set, the selection uses exactly this backend
   * or none at all: it never substitutes a different backend, and reports the
   * refused substitution through `fallback`.
   */
  readonly preferredBackend?: SandboxBackendKind;
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

function preferredUnavailableMessage(kind: SandboxBackendKind, reason: string): string {
  return (
    `preferred sandbox backend ${kind} is unavailable (${reason}); ` +
    'the selection refuses to substitute a different backend, so commands run unsandboxed'
  );
}

export function selectSandboxBackend(input: SandboxSelectionInput): SandboxSelection {
  if (input.preferredBackend !== undefined) {
    const preferred = input.availability.find(
      (candidate) => candidate.backend === input.preferredBackend && candidate.available,
    );
    if (preferred !== undefined) {
      return {
        backend: preferred.backend,
        enabled: true,
        permissionMode: input.permissionMode,
        reason: 'sandbox-available',
        message: `${preferred.backend} sandbox is available and selected`,
        availability: preferred,
        fallback: null,
      };
    }
    const rejected = input.availability.find(
      (candidate) => candidate.backend === input.preferredBackend,
    );
    const reason =
      rejected?.reason ??
      `no availability probe ran for ${String(input.preferredBackend)}`;
    return {
      backend: null,
      enabled: false,
      permissionMode: input.permissionMode,
      reason: 'preferred-backend-unavailable',
      message: preferredUnavailableMessage(input.preferredBackend, reason),
      availability: null,
      fallback: { from: input.preferredBackend, to: null, reason },
    };
  }

  let firstFailure: { readonly kind: SandboxBackendKind; readonly reason: string } | null = null;
  for (const kind of SANDBOX_BACKEND_PREFERENCE) {
    const candidate = input.availability.find((entry) => entry.backend === kind);
    if (candidate?.available === true) {
      return {
        backend: kind,
        enabled: true,
        permissionMode: input.permissionMode,
        reason: 'sandbox-available',
        message: `${kind} sandbox is available and selected`,
        availability: candidate,
        fallback:
          firstFailure === null
            ? null
            : { from: firstFailure.kind, to: kind, reason: firstFailure.reason },
      };
    }
    if (firstFailure === null) {
      firstFailure = { kind, reason: candidate?.reason ?? 'not probed' };
    }
  }

  return {
    backend: null,
    enabled: false,
    permissionMode: input.permissionMode,
    reason: 'sandbox-unavailable',
    message: unavailableMessage(input.permissionMode),
    availability: null,
    fallback:
      firstFailure === null
        ? null
        : { from: firstFailure.kind, to: null, reason: firstFailure.reason },
  };
}
