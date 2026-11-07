import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

export interface ISessionSubagentModelsValidationService {
  readonly _serviceBrand: undefined;
}

export const ISessionSubagentModelsValidationService: ServiceIdentifier<ISessionSubagentModelsValidationService> =
  createDecorator<ISessionSubagentModelsValidationService>(
    'sessionSubagentModelsValidationService',
  );
