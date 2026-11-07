import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

import type { WebSearchProvider } from '#/app/auth/webSearch/webSearchContract';

export type { WebSearchProvider, WebSearchResult } from '#/app/auth/webSearch/webSearchContract';

export interface IWebSearchProviderService {
  readonly _serviceBrand: undefined;

  getWebSearchProvider(): WebSearchProvider | undefined;
  hasWebSearchProvider(): boolean;
}

export const IWebSearchProviderService: ServiceIdentifier<IWebSearchProviderService> =
  createDecorator<IWebSearchProviderService>('webSearchProviderService');
