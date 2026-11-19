import { describe, expect, it } from 'vitest';

import { suggestAllowRule } from '#/agent/permissionPolicy/execPolicy/ruleSuggestion';

describe('suggestAllowRule', () => {
  it('keeps the root and a known subcommand, wildcards the arguments', () => {
    expect(suggestAllowRule('git log -5')).toEqual({
      prefix: ['git', 'log'],
      display: 'git log *',
    });
  });

  it('does not collapse a subcommand into the root', () => {
    const rule = suggestAllowRule('git log -5');
    expect(rule?.prefix).toEqual(['git', 'log']);
    expect(rule?.prefix).not.toEqual(['git']);
  });

  it('renders no wildcard when the command has no further arguments', () => {
    expect(suggestAllowRule('git status')).toEqual({
      prefix: ['git', 'status'],
      display: 'git status',
    });
  });

  it('skips leading global flags when locating the subcommand', () => {
    expect(suggestAllowRule('git --no-pager log --oneline -5')).toEqual({
      prefix: ['git', 'log'],
      display: 'git log *',
    });
  });

  it('suggests only the root for a command outside the subcommand tables', () => {
    expect(suggestAllowRule('pytest -x -q')).toEqual({
      prefix: ['pytest'],
      display: 'pytest *',
    });
  });

  it('keeps the root when the next word is not a known subcommand', () => {
    expect(suggestAllowRule('rg -i pattern')).toEqual({
      prefix: ['rg'],
      display: 'rg *',
    });
  });

  it('resolves docker compose to the third level', () => {
    expect(suggestAllowRule('docker compose up -d')).toEqual({
      prefix: ['docker', 'compose', 'up'],
      display: 'docker compose up *',
    });
    expect(suggestAllowRule('docker compose logs -f api')).toEqual({
      prefix: ['docker', 'compose', 'logs'],
      display: 'docker compose logs *',
    });
  });

  it('keeps docker at two levels when the compose subcommand is unknown', () => {
    expect(suggestAllowRule('docker compose frobnicate')).toEqual({
      prefix: ['docker', 'compose'],
      display: 'docker compose *',
    });
  });

  it.each([
    ['npm install express', ['npm', 'install'], 'npm install *'],
    ['pnpm test -- --runInBand', ['pnpm', 'test'], 'pnpm test *'],
    ['cargo build --release', ['cargo', 'build'], 'cargo build *'],
    ['kubectl get pods -A', ['kubectl', 'get'], 'kubectl get *'],
    ['gh pr view 123', ['gh', 'pr'], 'gh pr *'],
  ])('derives %s', (command, prefix, display) => {
    expect(suggestAllowRule(command)).toEqual({ prefix, display });
  });

  it('unwraps shell wrappers like the canonicalizer does', () => {
    expect(suggestAllowRule('/bin/bash -lc "git log -5"')).toEqual({
      prefix: ['git', 'log'],
      display: 'git log *',
    });
  });

  it('yields no suggestion for commands with shell metacharacters', () => {
    expect(suggestAllowRule('echo hi | sh')).toBeUndefined();
    expect(suggestAllowRule('cat a && cat b')).toBeUndefined();
  });

  it('yields no suggestion for an empty command', () => {
    expect(suggestAllowRule('   ')).toBeUndefined();
  });

  it('yields no suggestion when the root is not a command word', () => {
    expect(suggestAllowRule('/usr/bin/env git status')).toBeUndefined();
    expect(suggestAllowRule('$FOO bar')).toBeUndefined();
  });
});
