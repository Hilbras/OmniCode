import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';

export interface IHostRequestHeaders {
  readonly headers: Readonly<Record<string, string>>;
  readonly thirdPartyHeaders: Readonly<Record<string, string>>;
  readonly identitySlug?: string;
}

export const IHostRequestHeaders = createDecorator<IHostRequestHeaders>('hostRequestHeaders');
