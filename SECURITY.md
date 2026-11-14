# Security Policy

## Supported versions

The published artifact is `@omnicode/cli` (npm). Only the latest release
receives security fixes; fixes land on the default branch and ship in the next
release, and there are no backports to older release lines. The workspace
packages under `packages/` are private and never published — vulnerabilities in
them are fixed on the default branch like any other change.

If you are running from source, update to the current default branch before
reporting; the tip of the default branch is the only supported configuration.

## Reporting a vulnerability

Do not open a public issue for a security problem.

Report privately through GitHub's private vulnerability reporting for this
repository (Security tab → "Report a vulnerability"). If you maintain the
repository, advisories are drafted there and published after the fix ships.

Please include:

- The version or commit you are running and the platform.
- What you did, what happened, and what you expected to happen instead.
- Whether the issue crosses a trust boundary (below) — for example, a workspace
  file that can reach a credential path, or an untrusted input that turns into
  an execution path.
- A minimal reproduction and your assessment of impact and severity.

## Trust boundaries

The codebase treats the following as security invariants (see `AGENTS.md`,
"Security invariants"). Findings that break any of them are security-relevant:

- Workspace trust gates command execution; pre-trust code never resolves bare
  command names from PATH, and commands spawn as argument arrays, not shell
  strings.
- Path access is symlink-aware: workspaces cannot reach outside paths or
  credential files through symlinks.
- Secrets are redacted from logs, telemetry, errors, and tool output;
  telemetry never carries paths, environment values, tokens, or raw error
  text.
- Model-authored memory cannot exceed `unverified` trust; retrieval reports
  provenance and trust honestly; `secret` memory never leaves the host or
  reaches a provider.
- MCP private and link-local endpoints are rejected unless explicitly allowed.
- Exec policy and permission decisions fail closed: unmatched and opaque
  commands prompt or refuse, never silently allow.
- Reviewer-lane and channel-signature seams defer to the human or refuse when
  anything is missing.

## Coordinated disclosure

- We acknowledge reports, triage them, and develop fixes privately.
- Once a fix lands on the default branch, we publish it in the next release
  and publish the advisory with credit if you want it.
- Please keep the details private until the advisory is published and give us
  a reasonable window to ship the fix before any public disclosure.
- Details of how far an issue reaches matter more than a polished exploit;
  partial reports are welcome.
