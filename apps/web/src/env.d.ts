/// <reference types="vite/client" />

// Shared ambient module declarations for unplugin-icons `?raw` and Vite
// `?worker&type=module` imports live in `@hilbras/vite-preset` so the web
// and desktop renderers stay in sync.
import '@hilbras/vite-preset/icons';
import '@hilbras/vite-preset/worker';

declare global {
  // Injected by Vite `define` (see vite.config.ts): the dev proxy's upstream
  // daemon target, so the UI can display which daemon it actually talks to.
  // In production builds this is still defined but unused (same-origin daemon).
  const __OMNICODE_DEV_PROXY_TARGET__: string;

  // Injected by Vite `define`: the client version — the Omnicode CLI version
  // this web bundle ships with (from the omnicode submodule, see
  // vite.config.ts), NOT apps/web/package.json.
  const __OMNICODE_CLIENT_VERSION__: string;

  // Injected by Vite `define`: true only in the web bundle embedded in the Omnicode
  // Desktop app. Gates the internal-build banner (see InternalBuildBanner.vue).
  const __OMNICODE_WEB_DESKTOP__: boolean;

  // Injected by Vite `define` (from @hilbras/vite-preset): the bundle's
  // build time (ISO), shown in settings → advanced.
  const __OMNICODE_BUILD_TIME__: string;

  // Injected by Vite `define` (from @hilbras/vite-preset): the bundle's
  // source commit (full sha; '' when git is unavailable).
  const __OMNICODE_COMMIT_SHA__: string;

  // Injected by Vite `define` (from @hilbras/vite-preset): the bundle's
  // source branch ('' when unknown) — the debug pill's label.
  const __OMNICODE_BRANCH__: string;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
