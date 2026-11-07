Read the build logs of one Vercel deployment.

Use the dpl_ identifier or the deployment url. Each event is one build log line with its type, level and timestamp, which is enough to find the failing step of a build.

Requires a Vercel access token whose account owns the deployment. The tool fails closed when no token is configured, when the token was rejected, or when the deployment is outside the authorized account.
