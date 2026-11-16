import {
  createOmnicodeWebApi,
  type OmnicodeWebApi,
  type ClientIdentity,
  type CredentialStore,
  noopTracer,
} from './index';
import { createContext, useMemo, useContext, type ReactNode } from 'react';

export const ApiContext = createContext<OmnicodeWebApi | null>(null);

const noopTranslator = ((key: string) => key) as import('@hilbras/app-core/contracts').Translator;

const noopCredentialStore: CredentialStore = {
  getToken: () => undefined,
};

const identity: ClientIdentity = {
  clientId: 'omnicode-web',
  clientName: 'omnicode-web',
  clientVersion: '0.1.0',
  clientUiMode: 'web',
};

export function ApiProvider({
  origin,
  children,
}: {
  origin: string;
  children: ReactNode;
}) {
  const api = useMemo(
    () =>
      createOmnicodeWebApi({
        origin,
        identity,
        tracer: noopTracer,
        credentialStore: noopCredentialStore,
        t: noopTranslator,
      }),
    [origin],
  );

  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): OmnicodeWebApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <ApiProvider>');
  return api;
}
