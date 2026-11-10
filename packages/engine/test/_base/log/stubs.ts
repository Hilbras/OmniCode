import type { ServiceRegistration } from '@hilbras/omnicode-base/di/test';
import { ILogService } from '@hilbras/omnicode-base/log/log';
import type { ILogger } from '@hilbras/omnicode-base/log/log';

export function stubLogger(): ILogger {
  const logger: ILogger = {
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    child: () => logger,
  };
  return logger;
}

export function stubLog(): ILogService {
  return {
    ...stubLogger(),
    _serviceBrand: undefined,
    level: 'info',
    setLevel: () => {},
    flush: () => Promise.resolve(),
  };
}

export function registerLogServices(reg: ServiceRegistration): void {
  reg.defineInstance(ILogService, stubLog());
}
