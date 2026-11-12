import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DisposableStore } from '@hilbras/omnicode-base/di/lifecycle';
import { createServices, type TestInstantiationService } from '@hilbras/omnicode-base/di/test';
import { IBashParserService } from '#/app/bashParser/bashParser';
import { BashParserService } from '#/app/bashParser/bashParserService';
import {
  clearReadOnlyShellCache,
  classifyReadOnlyShell,
  isReadOnlyShellCall,
} from '#/tool/read-only-shell';

describe('read-only shell classification', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let parser: IBashParserService;

  beforeEach(() => {
    clearReadOnlyShellCache();
    disposables = new DisposableStore();
    ix = createServices(disposables, {
      additionalServices: (reg) => {
        reg.define(IBashParserService, BashParserService);
      },
    });
    parser = ix.get(IBashParserService);
  });

  afterEach(() => {
    disposables.dispose();
    clearReadOnlyShellCache();
  });

  const bash = (command: string) => ({ name: 'Bash', args: { command } });

  it('accepts known read verbs and read-only git subcommands', () => {
    expect(isReadOnlyShellCall(bash('ls -la'), parser)).toBe(true);
    expect(isReadOnlyShellCall(bash('git status'), parser)).toBe(true);
    expect(isReadOnlyShellCall(bash('cat a.txt | grep x'), parser)).toBe(true);
  });

  it('rejects writes, redirects, and unknown verbs', () => {
    expect(isReadOnlyShellCall(bash('rm -rf build'), parser)).toBe(false);
    expect(isReadOnlyShellCall(bash('echo hi > out.txt'), parser)).toBe(false);
    expect(isReadOnlyShellCall(bash('git commit -m x'), parser)).toBe(false);
    expect(isReadOnlyShellCall(bash('./run.sh'), parser)).toBe(false);
  });

  it('fails closed when the parser is missing or args are malformed', () => {
    expect(classifyReadOnlyShell({ name: 'Bash', args: { command: 'ls' } }, undefined)).toEqual({
      readOnly: false,
      reason: 'no-parser',
    });
    expect(classifyReadOnlyShell({ name: 'Bash', args: {} }, parser)).toEqual({
      readOnly: false,
      reason: 'parse-miss',
    });
    expect(classifyReadOnlyShell({ name: 'Bash', args: null }, parser)).toEqual({
      readOnly: false,
      reason: 'parse-miss',
    });
  });

  it('refuses non-shell tool names even with a shell-shaped payload', () => {
    expect(classifyReadOnlyShell({ name: 'Write', args: { command: 'ls' } }, parser)).toEqual({
      readOnly: false,
      reason: 'not-a-shell-tool',
    });
  });

  it('reports why a classified write was denied', () => {
    expect(classifyReadOnlyShell(bash('touch new.txt'), parser)).toEqual({
      readOnly: false,
      reason: 'classified-write',
    });
  });
});
