import type {
  PermissionPolicy,
  PermissionPolicyContext,
  PermissionPolicyResult,
} from '#/agent/permissionPolicy/types';
import {
  EXEC_POLICY_ALLOWED_HOSTS_KEY,
  matchExecPolicy,
  type ExecDecision,
  type ExecPolicy,
} from '#/agent/permissionPolicy/execPolicy/execPolicy';
import { IBashParserService } from '#/app/bashParser/bashParser';

/**
 * Applies a loaded exec policy to `Bash` calls.
 *
 * Placement matters more than the matching rules: this policy runs *after*
 * the sensitive-file and git-control policies in the chain, so a rule can only
 * ever narrow what would otherwise be admitted — it can never re-open a
 * path the workspace layer already refused. It also runs before the auto-mode
 * classifier, so an explicit `forbidden` is not something the classifier's
 * "safe tool" fast path can bypass.
 *
 * The policy itself is composed by `AgentPermissionPolicyService` from the
 * `execPolicy` config section; this class only holds the loaded policy. Without
 * a policy the service is inert (`undefined` result), which keeps the existing
 * chain byte-for-byte the same.
 *
 * A rule that carries `hosts` amends its `allow` with the hosts the command is
 * approved for. The amendment rides on the approval's execution metadata; the
 * executing tool must refuse to run when it cannot confine the command's
 * network use to those hosts.
 */
export class ExecPolicyPermissionPolicyService implements PermissionPolicy {
  readonly name = 'exec-policy';

  private policy: ExecPolicy | undefined;

  constructor(@IBashParserService private readonly bashParser: IBashParserService) {}

  /** Replaces the active policy. `undefined` disables the rule pass. */
  setPolicy(policy: ExecPolicy | undefined): void {
    this.policy = policy;
  }

  get activePolicy(): ExecPolicy | undefined {
    return this.policy;
  }

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    const policy = this.policy;
    if (policy === undefined) return undefined;
    const toolName = context.tool?.name ?? context.toolCall.name;
    if (toolName !== 'Bash') return undefined;
    const command = bashCommand(context.args);
    if (command === undefined) return undefined;

    const match = matchExecPolicy(command, policy, { parser: this.bashParser });
    return decisionResult(match.decision, match.reason, command, match.rule?.hosts);
  }
}

function decisionResult(
  decision: ExecDecision,
  reason: string,
  command: string,
  hosts: readonly string[] | undefined,
): PermissionPolicyResult | undefined {
  switch (decision) {
    case 'allow':
      return hosts === undefined || hosts.length === 0
        ? { kind: 'approve', reason: { exec_policy: reason, command } }
        : {
            kind: 'approve',
            reason: { exec_policy: reason, command },
            executionMetadata: { [EXEC_POLICY_ALLOWED_HOSTS_KEY]: hosts },
          };
    case 'forbidden':
      return {
        kind: 'deny',
        reason: { exec_policy: reason, command },
        message:
          `Command refused by exec policy (${reason}): ${command}\n` +
          'This command is on a forbidden rule. Do not retry it or try to express it differently; ' +
          'ask the user to change the policy if it should be allowed.',
      };
    case 'prompt':
      return { kind: 'ask', reason: { exec_policy: reason, command } };
    case 'prompt-user':
      // A bare prompt-user means "a human decides" — an approval that no
      // reviewer lane may auto-approve later.
      return {
        kind: 'ask',
        reason: { exec_policy: reason, command, requires_human: true },
      };
  }
}

function bashCommand(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const command = (args as { readonly command?: unknown }).command;
  return typeof command === 'string' && command.trim().length > 0 ? command : undefined;
}
