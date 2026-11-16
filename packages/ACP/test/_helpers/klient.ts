/**
 * The ACP suite boots the real engine and drives it through the same
 * in-memory klient the CLI host uses. `start.ts` takes that factory as an
 * injected host dependency (ACP must not import `@hilbras/omnicode-api`), so
 * the test host supplies it here, by source path: a `devDependency` on API
 * would re-create the very build cycle this split removed.
 */
export { createKlient } from '../../../API/src/transports/memory/index.js';
