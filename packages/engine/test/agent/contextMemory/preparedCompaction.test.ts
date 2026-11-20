import { describe, expect, it } from 'vitest';

import {
  decidePreparedInstall,
  structuralFingerprint,
  type MessageIdentity,
} from '#/agent/contextMemory/preparedCompaction';

const messages: readonly MessageIdentity[] = [
  { id: 'm1', role: 'user', contentHash: 'h1' },
  { id: 'm2', role: 'assistant', contentHash: 'h2' },
];

describe('structuralFingerprint', () => {
  it('is stable for identical sequences and changes on any field', () => {
    const fp = structuralFingerprint(messages);
    expect(fp).toBe(structuralFingerprint([...messages]));
    expect(fp).not.toBe(structuralFingerprint([...messages, { id: 'm3', role: 'user', contentHash: 'h3' }]));
    expect(fp).not.toBe(structuralFingerprint([{ ...messages[0]!, contentHash: 'changed' }, messages[1]!]));
  });
});

describe('decidePreparedInstall', () => {
  const prepared = { fingerprint: structuralFingerprint(messages), text: 'summary', compiledAt: 1000 };

  it('installs when structure matches', () => {
    expect(decidePreparedInstall(messages, prepared, 2000, 60_000)).toEqual({
      kind: 'install', reason: 'structural identity matches',
    });
  });

  it('discards when a message was interleaved during compilation', () => {
    const interleaved = [...messages, { id: 'm3', role: 'user', contentHash: 'h3' }];
    expect(decidePreparedInstall(interleaved, prepared, 2000, 60_000).kind).toBe('discard');
  });

  it('discards stale or empty artifacts', () => {
    expect(decidePreparedInstall(messages, prepared, 70_000, 60_000).kind).toBe('discard');
    expect(decidePreparedInstall(messages, { ...prepared, text: '' }, 2000, 60_000).kind).toBe('discard');
  });

  it('compiles when nothing is prepared, discards with no messages', () => {
    expect(decidePreparedInstall(messages, undefined, 2000, 60_000).kind).toBe('compile');
    expect(decidePreparedInstall([], prepared, 2000, 60_000).kind).toBe('discard');
  });
});
