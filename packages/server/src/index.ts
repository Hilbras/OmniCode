import '@hilbras/omnicode-addons';
import '@hilbras/omnicode-tools';
import '@hilbras/omnicode-memory';

export { startServer } from './start';
export type { ServerHostIdentity, ServerStartOptions, RunningServer } from './start';
export { okEnvelope, errEnvelope } from './envelope';
export type { Envelope } from './envelope';
export { classify } from './security/bindClassify';
export type { BindClass } from './security/bindClassify';
export { rotateServerToken, serverTokenPath } from './services/auth/persistentToken';
export { createServerLogger } from './services/pinoLoggerService';
export type {
  CreateLoggerOptions,
  ServerLogger,
  ServerLogLevel,
} from './services/pinoLoggerService';
export {
  createInstanceRegistry,
  listLiveServerInstances,
  getLiveServerInstance,
  resolveServerInstancesDir,
  HEARTBEAT_INTERVAL_MS,
} from './instanceRegistry';
export type {
  IInstanceRegistry,
  InstanceRegistration,
  InstanceRegistryOptions,
  ServerInstanceInfo,
} from './instanceRegistry';
