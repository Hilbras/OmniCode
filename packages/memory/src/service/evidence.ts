import { createHash } from 'node:crypto';

import type { MemoryEvidence } from '#/contracts/memoryTypes';

export const EVIDENCE_FINGERPRINT_PREFIX = 'sha256:';

export function fingerprintText(content: string): string {
  return `${EVIDENCE_FINGERPRINT_PREFIX}${createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 32)}`;
}

export function isFingerprintOfKind(fingerprint: string, kind: MemoryEvidence['kind']): boolean {
  if (kind !== 'file' && kind !== 'test') return false;
  return fingerprint.startsWith(EVIDENCE_FINGERPRINT_PREFIX);
}

export function evidenceForFile(ref: string, content: string, observedAt: number): MemoryEvidence {
  return { kind: 'file', ref, state: 'present', fingerprint: fingerprintText(content), observedAt };
}