// app-core api/createOmnicodeWebApi — the composition root both app shells
// (desktop renderer / web) use: DaemonOmnicodeWebApi wired with the in-package
// agent event projector. The shells inject their tracer, credential store,
// identity, and translator; each keeps only a thin bootstrap of its own
// (runtime config, bridge objects, the singleton accessor).

import type { ClientIdentity, CredentialStore, Tracer, Translator } from '../contracts';
import { DaemonOmnicodeWebApi } from './daemon/client';
import { createAgentProjector } from './daemon/agentEventProjector';
import type { OmnicodeWebApi } from './types';

export interface CreateOmnicodeWebApiDeps {
  origin: string;
  identity: ClientIdentity;
  tracer: Tracer;
  credentialStore: CredentialStore;
  /** Translator for projector-emitted text (the shell's vue-i18n global `t`). */
  t: Translator;
  /** Desktop keeps legacy raw events main-only while auxiliary views use
   *  Transcript; web omits this. Each shell chooses — see the ownership matrix. */
  mainAgentOnly?: boolean;
}

export function createOmnicodeWebApi(deps: CreateOmnicodeWebApiDeps): OmnicodeWebApi {
  return new DaemonOmnicodeWebApi({
    origin: deps.origin,
    identity: deps.identity,
    tracer: deps.tracer,
    credentialStore: deps.credentialStore,
    projectorFactory: () => createAgentProjector({ t: deps.t }),
    mainAgentOnly: deps.mainAgentOnly,
  });
}
