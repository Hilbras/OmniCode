import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

export interface IFeatureAssemblyService {
  readonly _serviceBrand: undefined;
}

export const IFeatureAssemblyService: ServiceIdentifier<IFeatureAssemblyService> =
  createDecorator<IFeatureAssemblyService>('featureAssemblyService');
