import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import * as paths from '../src/paths.js';

describe('paths', () => {
  it('sourceCredentialsDir joins ~/.omnicode/credentials', () => {
    expect(paths.sourceCredentialsDir('/x/.omnicode')).toBe(join('/x/.omnicode', 'credentials'));
  });

  it('targetConfigFile and targetTuiFile', () => {
    expect(paths.targetConfigFile('/y')).toBe(join('/y', 'config.toml'));
    expect(paths.targetTuiFile('/y')).toBe(join('/y', 'tui.toml'));
  });

  it('targetSessionIndex', () => {
    expect(paths.targetSessionIndex('/y')).toBe(join('/y', 'session_index.jsonl'));
  });

  it('migratedMarker is under source', () => {
    expect(paths.migratedMarker('/x/.omnicode')).toBe(join('/x/.omnicode', '.migrated-to-omnicode'));
  });

  it('skipMarker is under target', () => {
    expect(paths.skipMarker('/y/.omnicode')).toBe(join('/y/.omnicode', '.skip-migration-from-omnicode-cli'));
  });

  it('migrationReportFile is under target', () => {
    expect(paths.migrationReportFile('/y')).toBe(join('/y', 'migration-report.json'));
  });

  it('sourceSessionsDir / sourceUserHistoryDir / sourceLegacyIndexJson', () => {
    expect(paths.sourceSessionsDir('/x')).toBe(join('/x', 'sessions'));
    expect(paths.sourceUserHistoryDir('/x')).toBe(join('/x', 'user-history'));
    expect(paths.sourceLegacyIndexJson('/x')).toBe(join('/x', 'kimi.json'));
  });
});
