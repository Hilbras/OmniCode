import { describe, expect, it } from 'vitest';

import {
  ImportBundleSchema,
  ImportedAgentSchema,
  ImportedSkillSchema,
} from '../../src/import/schema.js';

describe('import schema', () => {
  it('accepts a minimal bundle', () => {
    const result = ImportBundleSchema.safeParse({
      source: 'claude-code',
      root: '/tmp/project',
      agents: [],
      skills: [],
      config: { source: 'claude-code', settings: {}, sourcePath: '.' },
      warnings: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown source', () => {
    const result = ImportBundleSchema.safeParse({
      source: 'aider',
      root: '/tmp/project',
      agents: [],
      skills: [],
      config: { source: 'aider', settings: {}, sourcePath: '.' },
      warnings: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty agent name', () => {
    const result = ImportedAgentSchema.safeParse({
      name: '   ',
      instructions: 'do things',
      sourcePath: 'agents/a.md',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a NUL byte in an agent name', () => {
    const result = ImportedAgentSchema.safeParse({
      name: 'a\0b',
      instructions: 'do things',
      sourcePath: 'agents/a.md',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a NUL byte in a skill body', () => {
    const result = ImportedSkillSchema.safeParse({
      name: 'pdf',
      body: 'a\0b',
      sourcePath: 'skills/pdf/SKILL.md',
    });
    expect(result.success).toBe(false);
  });

  it('accepts scalar and null settings', () => {
    const result = ImportBundleSchema.safeParse({
      source: 'qwen',
      root: '/tmp/project',
      agents: [],
      skills: [],
      config: {
        source: 'qwen',
        settings: { model: 'qwen3', retries: 2, verbose: true, fallback: null },
        sourcePath: 'settings.json',
      },
      warnings: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a NUL byte in a settings key', () => {
    const result = ImportBundleSchema.safeParse({
      source: 'qwen',
      root: '/tmp/project',
      agents: [],
      skills: [],
      config: {
        source: 'qwen',
        settings: { 'a\0b': 'value' },
        sourcePath: 'settings.json',
      },
      warnings: [],
    });
    expect(result.success).toBe(false);
  });

  it('requires a provenance path on MCP servers', () => {
    const result = ImportBundleSchema.safeParse({
      source: 'codex',
      root: '/tmp/project',
      agents: [],
      skills: [],
      config: {
        source: 'codex',
        settings: {},
        mcpServers: { docs: { command: 'npx' } },
        sourcePath: 'config.toml',
      },
      warnings: [],
    });
    expect(result.success).toBe(false);
  });
});
