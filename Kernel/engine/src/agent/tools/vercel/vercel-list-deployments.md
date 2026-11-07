List the Vercel deployments of one project.

Use the project name or the prj_ identifier. Each deployment reports its state, target, source, aliases and error, which is enough to tell whether the latest build of a branch is healthy.

Requires a Vercel access token whose account owns the project. The tool fails closed when no token is configured, when the token was rejected, or when the project is outside the authorized account.
