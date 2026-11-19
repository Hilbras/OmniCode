import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { IConfigService } from '#/app/config/config';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { canonicalCommandTokens } from '#/agent/permissionPolicy/commandCanonicalization';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { IHostFileSystem } from '#/os/interface/hostFileSystem';

import { EXEC_POLICY_SECTION, type ExecPolicyConfig } from './configSection';
import { loadExecPolicy, type ExecRuleExample, type ExecRuleSpec } from './execPolicy';
import { resolveExecPolicyPath } from './execPolicyLoader';
import type { SuggestedAllowRule } from './ruleSuggestion';

export type ExecPolicyWriteResult =
  | { readonly ok: true; readonly path: string; readonly added: boolean }
  | { readonly ok: false; readonly reason: string };

export interface IExecPolicyWriterService {
  readonly _serviceBrand: undefined;

  appendAllowPrefix(command: string, suggested?: SuggestedAllowRule): Promise<ExecPolicyWriteResult>;
}

export const IExecPolicyWriterService = createDecorator<IExecPolicyWriterService>(
  'execPolicyWriterService',
);

interface PolicyFile {
  version: 1;
  rules: ExecRuleSpec[];
  opaque?: string;
}

/**
 * Examples pinned onto every persisted rule so the file validates its own
 * intent on every load. The match example is the approved command itself — it
 * must keep matching whatever rule was written. The not-match probe mutates
 * the last word of the persisted prefix: `git log` → `git logx`. The probe is
 * what catches a later hand-broadening of the prefix (for example `git log`
 * widened to `git`) — the loader rejects the file instead of silently allowing
 * more than the user approved.
 */
function examplesFor(prefix: readonly string[], approvedCommand: string): readonly ExecRuleExample[] {
  const last = prefix[prefix.length - 1] ?? '';
  const mutated = [...prefix.slice(0, -1), `${last}x`];
  return [
    { command: approvedCommand, matches: true },
    { command: mutated.join(' '), matches: false },
  ];
}

export class ExecPolicyWriterService implements IExecPolicyWriterService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IConfigService private readonly config: IConfigService,
    @IBootstrapService private readonly bootstrap: IBootstrapService,
    @IHostFileSystem private readonly fs: IHostFileSystem,
  ) {}

  async appendAllowPrefix(command: string, suggested?: SuggestedAllowRule): Promise<ExecPolicyWriteResult> {
    const tokens = canonicalCommandTokens(command);
    if (tokens === undefined) {
      return { ok: false, reason: 'the command is not a simple invocation and cannot become a prefix rule' };
    }
    // The suggestion is display-sourced data; trust it only as a narrowing of
    // the approved command. Anything that is not a strict prefix of the
    // canonical tokens is ignored and the exact command is persisted instead.
    const rule =
      suggested !== undefined && isPrefixOf(suggested.prefix, tokens) ? suggested.prefix : tokens;
    const configured = this.config.get<ExecPolicyConfig | undefined>(EXEC_POLICY_SECTION);
    if (configured === undefined || configured.path.length === 0) {
      return { ok: false, reason: 'no exec policy path is configured ([execPolicy] path)' };
    }
    const path = resolveExecPolicyPath(configured.path, this.bootstrap.homeDir, this.bootstrap.osHomeDir);
    let source: PolicyFile;
    try {
      source = JSON.parse(await this.fs.readText(path)) as PolicyFile;
    } catch (error) {
      return {
        ok: false,
        reason: `cannot read the exec policy at ${path}: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
    if (source.version !== 1 || !Array.isArray(source.rules)) {
      return { ok: false, reason: `the exec policy at ${path} is not a version-1 rules file` };
    }
    const duplicate = source.rules.some((candidate) => {
      if (candidate.decision !== 'allow' || !Array.isArray(candidate.prefix)) return false;
      const prefix = candidate.prefix.filter((part): part is string => typeof part === 'string');
      return (
        prefix.length === candidate.prefix.length &&
        prefix.length === rule.length &&
        prefix.every((part, index) => part === rule[index])
      );
    });
    if (duplicate) return { ok: true, path, added: false };

    const next: PolicyFile = {
      ...source,
      rules: [
        ...source.rules,
        {
          prefix: rule,
          decision: 'allow',
          note: 'approved by the user',
          examples: examplesFor(rule, command),
        },
      ],
    };
    try {
      loadExecPolicy(next, path);
    } catch (error) {
      return {
        ok: false,
        reason: `refusing to write an invalid policy: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
    try {
      await this.fs.writeText(path, `${JSON.stringify(next, null, 2)}\n`);
    } catch (error) {
      return {
        ok: false,
        reason: `cannot write the exec policy at ${path}: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
    return { ok: true, path, added: true };
  }
}

registerScopedService(
  LifecycleScope.App,
  IExecPolicyWriterService,
  ExecPolicyWriterService,
  ScopeActivation.OnDemand,
  'execPolicyWriter',
);

function isPrefixOf(prefix: readonly string[], tokens: readonly string[]): boolean {
  return (
    prefix.length > 0 &&
    prefix.length <= tokens.length &&
    prefix.every((part, index) => part === tokens[index])
  );
}
