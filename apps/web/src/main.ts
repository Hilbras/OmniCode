import { createApp } from 'vue';
import { IconResolverKey } from '@hilbras/app-ui';
import { OmnicodeI18nKey, type OmnicodeI18nApi } from '@hilbras/app-i18n';
import App from './App.vue';
import i18n from './i18n';
import { setOmnicodeClientDeps } from '@hilbras/app-client/client';
import { clientPinia } from '@hilbras/app-client/stores';
import { isDesktop } from '@hilbras/app-core/lib';
import { getIcon, type IconName } from '@hilbras/app-client/icons';
import { installClientErrorCapture, reportRendererException, sessionExportTraceToJsonl, traceClientEvent, traceKeyEvent } from './debug/trace';
import { getOmnicodeWebApi } from './api';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './style.css';
import './studio-theme.css';

// Always retain bounded metadata for uncaught failures. With ?debug=1 / the
// debug flag, console output is included too; HMR restores listeners/wrappers.
installClientErrorCapture();

// Wire the shared client singletons' platform seams (app-client/client): the
// composed api singleton, i18n translator, and trace ring. The optional
// desktop hooks (native terminal / session intent / plugins shelf) stay at
// their no-op defaults here.
setOmnicodeClientDeps({
  api: getOmnicodeWebApi,
  t: (key, params) => (params === undefined ? i18n.global.t(key) : i18n.global.t(key, params)),
  traceClientEvent,
  traceKeyEvent: (event, info) => traceKeyEvent(event as never, info),
  sessionExportTraceToJsonl,
});

const app = createApp(App).use(i18n);
app.config.errorHandler = (err, _instance, info) => reportRendererException(err, info);
// Install the package-held pinia instance (app-client/stores): the domain
// stores' truth source, shared with the client singletons' module-level code.
app.use(clientPinia);
// Hand packages (e.g. app-markdown) a translator without forcing them to import
// the global vue-i18n. Wrap the composer as a minimal `OmnicodeI18nApi` (its `locale`
// is a Ref, not a string), so `inject(OmnicodeI18nKey)` stays type-safe.
const omnicodeI18n: OmnicodeI18nApi = {
  t: (key, params) => i18n.global.t(key, params as never),
};
app.provide(OmnicodeI18nKey, omnicodeI18n);
// Bridge app-ui's <Icon> to this app's icon registry: <Icon name> resolves its
// component through lib/icons.ts (which owns the `~icons/*` collections). The
// registry stays in apps/web; app-ui only defines the injection key.
app.provide(IconResolverKey, (name) => getIcon(name as IconName)?.component);
app.mount('#app');

// In the desktop app, mirror <html data-color-scheme> to the host's nativeTheme
// via the preload-exposed IPC (replaces the main process's console-message hack).
if (isDesktop) {
  const bridge = (window as unknown as { omnicodeDesktop?: { setTheme: (s: 'light' | 'dark' | 'system') => void } }).omnicodeDesktop;
  if (bridge) {
    const report = () => {
      const v = document.documentElement.dataset.colorScheme;
      bridge.setTheme(v === 'light' || v === 'dark' ? v : 'system');
    };
    new MutationObserver(report).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-scheme'],
    });
    report();
  }
}
