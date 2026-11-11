import type { MemoryRecord, MemoryScope } from '#/contracts/memoryTypes';

export const MEMORY_SCHEMA_VERSION = 1;
export const MEMORY_SCHEMA_KEY = '__schema';

export const RECORD_PREFIX = 'm:';
export const FINGERPRINT_PREFIX = 'f:';
export const SCOPE_PREFIX = 's:';
export const SUBJECT_PREFIX = 'k:';
export const REVIEW_PREFIX = 'q:';
export const IDEMPOTENCY_PREFIX = 'x:';
export const PHRASE_PREFIX = 'ph:';
export const VERSION_PREFIX = 'v:';
export const AUDIT_PREFIX = 'a:';
export const FEEDBACK_PREFIX = 'f:';
export const FEEDBACK_COOLDOWN_PREFIX = 'fr:';

export const ALL_SCOPE_PREFIXES: readonly string[] = Object.freeze([
  `${SCOPE_PREFIX}g:`,
  `${SCOPE_PREFIX}w:`,
  `${SCOPE_PREFIX}r:`,
  `${SCOPE_PREFIX}s:`,
  `${SCOPE_PREFIX}t:`,
]);

function encode(value: string): string {
  return encodeURIComponent(value);
}

export function scopeKeyFor(scope: MemoryScope): string | undefined {
  switch (scope.tier) {
    case 'global':
      return 'g';
    case 'workspace':
      return scope.workspaceId === undefined ? undefined : `w:${encode(scope.workspaceId)}`;
    case 'repository':
      return scope.projectId === undefined ? undefined : `r:${encode(scope.projectId)}`;
    case 'session':
      return scope.sessionId === undefined ? undefined : `s:${encode(scope.sessionId)}`;
    case 'task':
      return scope.taskId === undefined ? undefined : `t:${encode(scope.taskId)}`;
  }
}

export function scopePrefix(scope: MemoryScope): string | undefined {
  const key = scopeKeyFor(scope);
  return key === undefined ? undefined : `${SCOPE_PREFIX}${key}:`;
}

export function subjectIndexPrefix(record: MemoryRecord): string | undefined {
  return subjectPrefixFor(record.subject, record.scope);
}

export function subjectPrefixFor(subject: string | undefined, scope: MemoryScope): string | undefined {
  if (subject === undefined) return undefined;
  const key = scopeKeyFor(scope);
  if (key === undefined) return undefined;
  return `${SUBJECT_PREFIX}${key}:${encode(subject)}:`;
}

export function subjectIndexKey(record: MemoryRecord): string | undefined {
  const prefix = subjectIndexPrefix(record);
  return prefix === undefined ? undefined : `${prefix}${record.id}`;
}

export function recordKey(id: string): string {
  return `${RECORD_PREFIX}${id}`;
}

export function fingerprintKey(fingerprint: string): string {
  return `${FINGERPRINT_PREFIX}${fingerprint}`;
}

export function reviewKey(jobId: string): string {
  return `${REVIEW_PREFIX}${jobId}`;
}

export function idempotencyKey(requestKey: string): string {
  return `${IDEMPOTENCY_PREFIX}${encode(requestKey)}`;
}

export function pointerIds(values: Iterable<unknown>): string[] {
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value !== 'object' || value === null) continue;
    const id = (value as Record<string, unknown>)['id'];
    if (typeof id === 'string' && id.length > 0) ids.push(id);
  }
  return ids;
}

export function feedbackKey(memoryId: string, at: number, id: string): string {
  return `${FEEDBACK_PREFIX}${encode(memoryId)}:${String(at).padStart(16, '0')}:${encode(id)}`;
}

export function feedbackPrefixFor(memoryId: string): string {
  return `${FEEDBACK_PREFIX}${encode(memoryId)}:`;
}

export function feedbackCooldownKey(memoryId: string): string {
  return `${FEEDBACK_COOLDOWN_PREFIX}${encode(memoryId)}`;
}

export function auditKey(at: number, id: string): string {
  return `${AUDIT_PREFIX}${String(at).padStart(16, '0')}:${encode(id)}`;
}

export function versionPrefixFor(memoryId: string): string {
  return `${VERSION_PREFIX}${encode(memoryId)}:`;
}

export function versionKey(memoryId: string, revision: number): string {
  return `${versionPrefixFor(memoryId)}${String(revision).padStart(8, '0')}`;
}

export function relationPrefixFor(sourceId: string): string {
  return `r:${encode(sourceId)}:`;
}

export function reverseRelationPrefixFor(targetId: string): string {
  return `rb:${encode(targetId)}:`;
}

export function relationKey(sourceId: string, kind: string, targetId: string): string {
  return `r:${encode(sourceId)}:${kind}:${encode(targetId)}`;
}

export function reverseRelationKey(targetId: string, kind: string, sourceId: string): string {
  return `rb:${encode(targetId)}:${kind}:${encode(sourceId)}`;
}

export function referenceKeys(record: MemoryRecord): readonly string[] {
  return referenceValues(record).map((entry) => entry.key);
}

export function referenceValues(record: MemoryRecord): readonly { key: string; value: unknown }[] {
  const values: { key: string; value: unknown }[] = [
    { key: recordKey(record.id), value: record },
    { key: fingerprintKey(record.fingerprint), value: { id: record.id } },
  ];
  const scope = scopePrefix(record.scope);
  if (scope !== undefined) values.push({ key: `${scope}${record.id}`, value: { id: record.id } });
  const subject = subjectIndexKey(record);
  if (subject !== undefined) values.push({ key: subject, value: { id: record.id } });
  for (const relation of record.relations) {
    values.push({ key: relationKey(record.id, relation.kind, relation.targetId), value: { id: relation.targetId } });
    values.push({ key: reverseRelationKey(relation.targetId, relation.kind, record.id), value: { id: record.id } });
  }
  return values;
}