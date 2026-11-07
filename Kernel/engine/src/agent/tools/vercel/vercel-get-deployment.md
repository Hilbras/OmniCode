Read one Vercel deployment.

Use the dpl_ identifier or the deployment url. The result reports the state, target, source, aliases and the error code and message of a failed build, which is enough to explain why a deployment did not go live.

Requires a Vercel access token whose account owns the deployment. The tool fails closed when no token is configured, when the token was rejected, or when the deployment is outside the authorized account.
