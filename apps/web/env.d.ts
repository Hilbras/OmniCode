/// <reference types="vite/client" />
/// <reference types="unplugin-icons/types/vue" />

import './vendor/vite-preset/src/icons';
import './vendor/vite-preset/src/worker';

declare global {
  const __OMNICODE_WEB_DESKTOP__: boolean;
  const __OMNICODE_DEV_PROXY_TARGET__: string;
  const __OMNICODE_CLIENT_VERSION__: string;
  const __OMNICODE_BUILD_TIME__: string;
  const __OMNICODE_COMMIT_SHA__: string;
  const __OMNICODE_BRANCH__: string;
  const __KIMI_BRANCH__: string;
  const __KIMI_BUILD_TIME__: string;
  const __KIMI_COMMIT_SHA__: string;
  const __KIMI_CODE_DESKTOP__: boolean;
  const __KIMI_CORE_REF__: string;
  const __KIMI_DEV_PROXY_TARGET__: string;
  const __KIMI_DEV_BACKENDS__: { default: string; multi: string };
  const __KIMI_CLIENT_VERSION__: string;
  const __KIMI_BUILD_TIME__: string;
}

declare module '~icons/*?raw' {
  const src: string;
  export default src;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
