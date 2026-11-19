import { canonicalCommandTokens } from '../commandCanonicalization';

/**
 * Narrowest allow-rule suggestion for an approved command.
 *
 * Derivation follows the minimum-scope principle (the qwen
 * `extractCommandRules` reference): preserve the root command plus its known
 * subcommand, replace the arguments with a wildcard. In this tree's exec-policy
 * grammar the wildcard is the argv prefix itself — a rule with prefix
 * `["git","log"]` matches any `git log …` invocation — so the suggestion is the
 * leading command words and the preview is what an "always allow" will
 * actually persist.
 *
 * Fail-closed: anything the canonicalizer refuses (shell metacharacters,
 * opaque commands) yields no suggestion, and the approval falls back to the
 * exact-command rule. The subcommand table is data, deliberately small: a
 * missing root only makes the suggestion narrower (root-only), never broader.
 */

interface SubcommandTables {
  readonly roots: Readonly<Record<string, ReadonlySet<string>>>;
  /** Second-level words: `docker compose <sub>`. */
  readonly nested: Readonly<Record<string, ReadonlySet<string>>>;
}

const KNOWN_SUBCOMMANDS: SubcommandTables = {
  roots: {
    git: new Set([
      'add', 'am', 'archive', 'bisect', 'blame', 'branch', 'bundle', 'cat-file',
      'checkout', 'cherry-pick', 'clean', 'clone', 'commit', 'config', 'describe',
      'diff', 'fetch', 'format-patch', 'gc', 'grep', 'init', 'log', 'ls-files',
      'ls-remote', 'merge', 'mv', 'notes', 'pull', 'push', 'range-diff', 'rebase',
      'reflog', 'remote', 'reset', 'restore', 'revert', 'rev-parse', 'rm',
      'shortlog', 'show', 'stash', 'status', 'submodule', 'switch', 'tag',
      'worktree',
    ]),
    npm: new Set([
      'access', 'audit', 'bugs', 'cache', 'ci', 'create', 'diff', 'dist-tag',
      'docs', 'doctor', 'exec', 'explain', 'explore', 'find-dupes', 'fund',
      'help', 'init', 'install', 'link', 'login', 'logout', 'ls', 'outdated',
      'owner', 'pack', 'ping', 'prefix', 'profile', 'prune', 'publish', 'rebuild',
      'repo', 'restart', 'root', 'run', 'run-script', 'search', 'shrinkwrap',
      'star', 'stars', 'start', 'stop', 'team', 'test', 'token', 'uninstall',
      'unpublish', 'update', 'version', 'view', 'whoami',
    ]),
    pnpm: new Set([
      'add', 'approve-builds', 'audit', 'build', 'catalog', 'config', 'deploy',
      'diff', 'dlx', 'env', 'exec', 'fetch', 'find', 'format', 'generate-lockfile',
      'help', 'import', 'init', 'install', 'link', 'list', 'login', 'logout',
      'ls', 'outdated', 'pack', 'patch', 'prune', 'publish', 'rebuild', 'remove',
      'repair', 'repo', 'restart', 'root', 'run', 'setup', 'store', 'test',
      'unlink', 'update', 'version', 'why',
    ]),
    yarn: new Set([
      'add', 'audit', 'autoclean', 'bin', 'cache', 'check', 'config', 'constraints',
      'create', 'dedupe', 'dlx', 'exec', 'explain', 'generate-lock-entry', 'help',
      'info', 'init', 'install', 'link', 'link-binaries', 'list', 'login',
      'logout', 'npm', 'outdated', 'pack', 'patch-commit', 'plugin', 'rebuild',
      'remove', 'run', 'set', 'solutions', 'test', 'unlink', 'unplug', 'up',
      'upgrade', 'version', 'why', 'workspace',
    ]),
    docker: new Set([
      'attach', 'build', 'commit', 'compose', 'container', 'context', 'cp',
      'create', 'diff', 'events', 'exec', 'export', 'history', 'image', 'images',
      'import', 'info', 'inspect', 'kill', 'load', 'login', 'logout', 'logs',
      'manifest', 'network', 'node', 'pause', 'plugin', 'port', 'ps', 'pull',
      'push', 'rename', 'restart', 'rm', 'rmi', 'run', 'save', 'search', 'secret',
      'service', 'stack', 'start', 'stats', 'stop', 'swarm', 'system', 'tag',
      'top', 'unpause', 'update', 'version', 'volume', 'wait',
    ]),
    cargo: new Set([
      'add', 'bench', 'build', 'check', 'clean', 'doc', 'fetch', 'fix', 'fmt',
      'generate-lockfile', 'init', 'install', 'login', 'logout', 'metadata',
      'new', 'owner', 'package', 'publish', 'report', 'run', 'rustc', 'rustdoc',
      'search', 'test', 'tree', 'uninstall', 'update', 'vendor', 'verify-project',
      'version', 'yank',
    ]),
    kubectl: new Set([
      'annotate', 'api-resources', 'api-versions', 'apply', 'attach', 'auth',
      'autoscale', 'certificate', 'cluster-info', 'completion', 'config',
      'cordon', 'cp', 'create', 'debug', 'delete', 'describe', 'diff', 'drain',
      'edit', 'events', 'exec', 'explain', 'expose', 'get', 'help', 'kustomize',
      'label', 'logs', 'options', 'patch', 'plugin', 'port-forward', 'proxy',
      'replace', 'rollout', 'run', 'scale', 'set', 'taint', 'top', 'uncordon',
      'version', 'wait',
    ]),
    gh: new Set([
      'browse', 'codespace', 'gist', 'issue', 'org', 'pr', 'project', 'release',
      'repo', 'run', 'search', 'secret', 'ssh-key', 'status', 'workflow',
    ]),
    go: new Set([
      'build', 'clean', 'doc', 'env', 'fix', 'fmt', 'generate', 'get', 'install',
      'list', 'mod', 'run', 'test', 'tool', 'version', 'vet', 'work',
    ]),
    pip: new Set([
      'cache', 'check', 'completion', 'config', 'debug', 'download', 'freeze',
      'hash', 'help', 'index', 'init', 'install', 'list', 'local', 'search',
      'show', 'uninstall', 'upgrade',
    ]),
    uv: new Set([
      'add', 'build', 'cache', 'clean', 'export', 'help', 'init', 'install',
      'lock', 'pip', 'publish', 'python', 'remove', 'run', 'self', 'sync',
      'tool', 'tree', 'uninstall', 'update', 'upgrade', 'venv', 'workspace',
    ]),
  },
  nested: {
    compose: new Set([
      'build', 'config', 'create', 'down', 'events', 'exec', 'images', 'kill',
      'logs', 'ls', 'pause', 'port', 'ps', 'pull', 'push', 'restart', 'rm',
      'run', 'start', 'stop', 'top', 'unpause', 'up', 'version',
    ]),
  },
};

export interface SuggestedAllowRule {
  /** The argv prefix an "always allow" persists. */
  readonly prefix: readonly string[];
  /** Preview form for approval UIs: `git log *`. */
  readonly display: string;
}

/** A token usable as a command word in a prefix rule: no flags, paths, or assignments. */
function isCommandWord(token: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(token);
}

export function suggestAllowRule(command: string): SuggestedAllowRule | undefined {
  const tokens = canonicalCommandTokens(command);
  if (tokens === undefined || tokens.length === 0) return undefined;
  const root = tokens[0]!;
  if (!isCommandWord(root)) return undefined;

  const prefix: string[] = [root];

  // Skip leading global flags (git --no-pager log) to find the subcommand.
  let index = 1;
  while (index < tokens.length && tokens[index]!.startsWith('-')) index += 1;
  const subcommandRoot = KNOWN_SUBCOMMANDS.roots[root];
  const candidate = index < tokens.length ? tokens[index]!.toLowerCase() : undefined;
  if (subcommandRoot !== undefined && candidate !== undefined && subcommandRoot.has(candidate)) {
    prefix.push(tokens[index]!);
    if (root === 'docker' && candidate === 'compose' && index + 1 < tokens.length) {
      const nested = tokens[index + 1]!.toLowerCase();
      if (KNOWN_SUBCOMMANDS.nested['compose']?.has(nested)) {
        prefix.push(tokens[index + 1]!);
      }
    }
  }

  const display = prefix.join(' ') + (tokens.length > prefix.length ? ' *' : '');
  return { prefix, display };
}
