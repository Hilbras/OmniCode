// apps/web/src/api/bootstrap.ts — composes the app-core createOmnicodeWebApi
// factory with this app's tracer, credential store, identity, and i18n
// translator, and exposes the shared singleton.
//
// This is the only module that knows both sides: app-core's api composition and
// the app's debug/trace + runtime config. Everything else consumes the composed
// `api` (or the back-compat `getOmnicodeWebApi()` accessor).

import { createOmnicodeWebApi } from '@hilbras/app-core/api';
import type { CredentialStore, Tracer, Translator } from '@hilbras/app-core/contracts';
import {
  traceRestFailure,
  traceRestRequest,
  traceRestResponse,
  traceWsIn,
  traceWsLifecycle,
  traceWsOut,
  traceKeyEvent as recordKeyEvent,
} from '../debug/trace';
import { getCredential, markAuthRequired } from '@hilbras/app-core/lib';
import { i18n } from '../i18n';
import { readOmnicodeApiConfig } from './config';
import type { OmnicodeWebApi } from './types';

const appTracer: Tracer = {
  restRequest: (info) => traceRestRequest(info),
  restResponse: (info) => traceRestResponse(info),
  restFailure: (info) => traceRestFailure(info),
  wsEvent: (event) => {
    switch (event.kind) {
      case 'lifecycle':
        traceWsLifecycle(event.event, event.detail);
        break;
      case 'in':
        traceWsIn(event.frame);
        break;
      case 'out':
        traceWsOut(event.frame);
        break;
    }
  },
  traceKeyEvent: (event, info) => recordKeyEvent(event as never, info),
};

const appCredentialStore: CredentialStore = {
  getToken: getCredential,
  markAuthRequired,
};

const t: Translator = (key, params) => (params === undefined ? i18n.global.t(key) : i18n.global.t(key, params));

function createApi(): OmnicodeWebApi {
  const config = readOmnicodeApiConfig();
  return createOmnicodeWebApi({
    origin: config.serverHttpUrl,
    identity: {
      clientId: config.clientId,
      clientName: config.clientName,
      clientVersion: config.clientVersion,
      clientUiMode: config.clientUiMode,
    },
    tracer: appTracer,
    credentialStore: appCredentialStore,
    t,
  });
}

/** The shared DaemonOmnicodeWebApi instance (composed with this app's bridges). */
export const api: OmnicodeWebApi = createApi();

/**
 * Back-compat accessor kept so the existing `getOmnicodeWebApi()` call sites need no
 * changes; returns the same singleton as `api`.
 */
export function getOmnicodeWebApi(): OmnicodeWebApi {
  return api;
}
