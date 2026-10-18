import { describe, expect, it } from 'vitest';

import { evidenceForFile, fingerprintText, isFingerprintOfKind } from '#/service/evidence';

import { captureInput, createHarness, evidenceFor, FakeTimers, REPO_A, REPO_B, repoScope } from './helpers';
import { MemoryMaintenanceScheduler } from '#/service/memoryMaintenance';

function files(initial: Record<string, string> = {}) {
  const contents = new Map<string, string>(Object.entries(initial));
  return {
    contents,
    read: async (ref: string) => contents.get(ref),
    write: (ref: string, content: string) => {
      contents.set(ref, content);
    },
    remove: (ref: string) => {
      contents.delete(ref);
    },
  };
}

describe('evidence fingerprints', () => {
  it('is stable, content-addressed and names its scheme', () => {
    expect(fingerprintText('abc')).toBe(fingerprintText('abc'));
    expect(fingerprintText('abc')).not.toBe(fingerprintText('abd'));
    expect(fingerprintText('abc')).toMatch(/^sha256:[0-9a-f]{32}$/);
  });

  it('only claims verification for fingerprints it produced itself', () => {
    expect(isFingerprintOfKind(fingerprintText('a'), 'file')).toBe(true);
    expect(isFingerprintOfKind(fingerprintText('a'), 'tool')).toBe(false);
    expect(isFingerprintOfKind('fp-anything', 'file')).toBe(false);
  });
});

describe('evidence refresh', () => {
  it('reports unavailable when the host cannot read files', async () => {
    const harness = createHarness();
    const report = await harness.service.refreshEvidence({ projectId: REPO_A });
    expect(report.status).toBe('unavailable');
  });

  it('leaves a memory verified while its evidence file is unchanged', async () => {
    const disk = files({ 'docs/plan.md': 'the original plan' });
    const harness = createHarness({ readEvidence: disk.read });
    const stored = await harness.service.capture(
      captureInput('the plan lives in docs/plan.md', {
        evidence: [evidenceForFile('docs/plan.md', 'the original plan', 1)],
      }),
    );
    expect(stored.record?.trust).toBe('verified');

    const report = await harness.service.refreshEvidence({ projectId: REPO_A });
    expect(report.status).toBe('checked');
    expect(report.checked).toBe(1);
    expect(report.changed).toBe(0);
    expect(report.report.marked).toBe(0);
    expect((await harness.service.get(stored.id as string))?.trust).toBe('verified');
  });

  it('demotes the memory and withdraws it from search when the file changes', async () => {
    const disk = files({ 'docs/plan.md': 'the original plan' });
    const harness = createHarness({ readEvidence: disk.read });
    const stored = await harness.service.capture(
      captureInput('the plan says we ship on fridays', {
        evidence: [evidenceForFile('docs/plan.md', 'the original plan', 1)],
      }),
    );
    expect((await harness.service.get(stored.id as string))?.trust).toBe('verified');

    disk.write('docs/plan.md', 'a completely different plan');

    const report = await harness.service.refreshEvidence({ projectId: REPO_A });
    expect(report.status).toBe('checked');
    expect(report.changed).toBe(1);
    expect(report.report.marked).toBe(1);
    expect(report.report.findings[0]?.evidenceRef).toBe('docs/plan.md');

    const after = await harness.service.get(stored.id as string);
    expect(after?.trust).toBe('unverified');
    expect(after?.trustReason).toBe('evidence changed since capture');
    expect(after?.evidence[0]?.state).toBe('changed');
    expect((await harness.service.search({ query: 'ship on fridays', projectId: REPO_A })).memories).toHaveLength(0);
  });

  it('treats an unreadable file as unknown rather than as a change', async () => {
    const disk = files({ 'docs/plan.md': 'the original plan' });
    const harness = createHarness({ readEvidence: disk.read });
    const stored = await harness.service.capture(
      captureInput('a claim backed by a file', {
        evidence: [evidenceForFile('docs/plan.md', 'the original plan', 1)],
      }),
    );

    disk.remove('docs/plan.md');
    const report = await harness.service.refreshEvidence({ projectId: REPO_A });
    expect(report.status).toBe('checked');
    expect(report.checked).toBe(0);
    expect(report.unreadable).toBe(1);
    expect(report.changed).toBe(0);
    expect((await harness.service.get(stored.id as string))?.trust).toBe('verified');
  });

  it('ignores evidence that no fingerprint scheme produced', async () => {
    const disk = files({ 'docs/plan.md': 'anything at all' });
    const harness = createHarness({ readEvidence: disk.read });
    const stored = await harness.service.capture(
      captureInput('a claim backed by an opaque token', { evidence: evidenceFor('docs/plan.md') }),
    );

    const report = await harness.service.refreshEvidence({ projectId: REPO_A });
    expect(report.checked).toBe(0);
    expect(report.changed).toBe(0);
    expect((await harness.service.get(stored.id as string))?.trust).toBe('verified');
  });

  it('never looks outside the project it was asked about', async () => {
    const disk = files({ 'docs/plan.md': 'the original plan' });
    const harness = createHarness({ readEvidence: disk.read });
    await harness.service.capture(
      captureInput('a fact belonging to another repository', {
        scope: repoScope(REPO_B),
        evidence: [evidenceForFile('docs/plan.md', 'the original plan', 1)],
      }),
    );
    await harness.service.capture(
      captureInput('a fact belonging to this repository', {
        scope: repoScope(REPO_A),
        evidence: [evidenceForFile('docs/plan.md', 'the original plan', 1)],
      }),
    );

    disk.write('docs/plan.md', 'a completely different plan');
    const report = await harness.service.refreshEvidence({ projectId: REPO_A });
    expect(report.report.marked).toBe(1);
    expect(report.report.findings.every((finding) => finding.memoryId !== undefined)).toBe(true);

    const other = await harness.service.list({ projectId: REPO_B });
    expect(other).toHaveLength(1);
    expect(other[0]?.trust).toBe('verified');
  });

  it('stays within its work budget for a large corpus', async () => {
    const disk = files();
    const harness = createHarness({ readEvidence: disk.read });
    for (let index = 0; index < 40; index += 1) {
      const ref = `docs/file-${String(index)}.md`;
      disk.write(ref, `content ${String(index)}`);
      await harness.service.capture(
        captureInput(`a fact recorded from ${ref}`, { evidence: [evidenceForFile(ref, `content ${String(index)}`, 1)] }),
      );
    }
    const report = await harness.service.refreshEvidence({ projectId: REPO_A, limit: 5 });
    expect(report.checked).toBeLessThanOrEqual(5);
  });
});

describe('evidence sweep on the maintenance schedule', () => {
  it('runs the refresh and reports what it found', async () => {
    const disk = files({ 'docs/plan.md': 'the original plan' });
    const harness = createHarness({ readEvidence: disk.read });
    await harness.service.capture(
      captureInput('the plan says we ship on fridays', {
        evidence: [evidenceForFile('docs/plan.md', 'the original plan', 1)],
      }),
    );
    disk.write('docs/plan.md', 'a completely different plan');

    const timers = new FakeTimers();
    const scheduler = new MemoryMaintenanceScheduler({
      memory: harness.service,
      log: harness.log,
      enabled: () => true,
      now: harness.clock.now,
      timers,
      evidenceSweepMs: 0,
      reviewDebounceMs: 100_000,
      retentionSweepMs: 100_000,
      evidenceProjectId: () => REPO_A,
    });
    scheduler.start();
    await timers.fireAll(scheduler);

    expect(harness.log.entriesAt('info').some((entry) => entry.message === 'memory evidence changed on disk')).toBe(
      true,
    );
    scheduler.dispose();
  });

  it('stays quiet when nothing changed', async () => {
    const disk = files({ 'docs/plan.md': 'the original plan' });
    const harness = createHarness({ readEvidence: disk.read });
    await harness.service.capture(
      captureInput('an unchanged plan', { evidence: [evidenceForFile('docs/plan.md', 'the original plan', 1)] }),
    );

    const timers = new FakeTimers();
    const scheduler = new MemoryMaintenanceScheduler({
      memory: harness.service,
      log: harness.log,
      enabled: () => true,
      now: harness.clock.now,
      timers,
      evidenceSweepMs: 0,
      reviewDebounceMs: 100_000,
      retentionSweepMs: 100_000,
    });
    scheduler.start();
    await timers.fireAll(scheduler);
    expect(harness.log.entriesAt('info').some((entry) => entry.message === 'memory evidence changed on disk')).toBe(
      false,
    );
    scheduler.dispose();
  });
});