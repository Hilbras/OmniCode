import type { InjectionKey } from 'vue';
import type { OmnicodeWebClientCore } from './createOmnicodeWebClientCore';

/** Provide/inject key for the per-app session state-machine core. The consumer
 *  (web or desktop shell) creates one core via `createOmnicodeWebClientCore(...)` and
 *  `app.provide(OmnicodeWebClientCoreKey, core)`; the shell composable injects it. */
export const OmnicodeWebClientCoreKey: InjectionKey<OmnicodeWebClientCore> = Symbol('OmnicodeWebClientCore');
