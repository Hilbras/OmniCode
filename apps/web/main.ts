import { createApp } from 'vue';
import { IconResolverKey } from '@vendor/app-ui';
import { KimiI18nKey, type KimiI18nApi } from '@vendor/app-i18n';
import App from './App.vue';
import BrandLogo from './components/onboarding/BrandLogo.vue';
import { FontPreviewBrandKey } from '@vendor/app-components';
import i18n from './i18n';
import { setKimiClientDeps } from '@vendor/app-client/client';
import { createKimiToast } from '@vendor/app-client/client';
import { AppToasts } from '@vendor/app-components';
import { clientPinia } from '@vendor/app-client/stores';
import { initVibrancy } from './composables/useVibrancy';
import { useFontPrefs } from '@vendor/app-core';
import { isDesktop, hasCustomTitleBar, isMacosDesktop, isWindowsDesktop } from '@vendor/app-core/lib';
import { destroyPanelSessionSnapshot, panelDraftContextKey, forkPanelBrowserTabs } from '@vendor/app-client/composables';
import { getNativeBrowserBridge } from './lib/nativeBrowser';
import { copyBrowserReceipts, deleteBrowserReceipts } from './lib/browserReceipts';
import { createBrowserId } from '@shared/browser';
import { clonedBrowserTabPayload } from './lib/browserTabClone';
import { getIcon, type IconName } from '@vendor/app-client/icons';
import {
  configureTrace,
  installClientErrorCapture,
  reportRendererException,
  sessionExportTraceToJsonl,
  traceClientEvent,
  traceKeyEvent,
} from '@vendor/app-client/trace';
import { isBenignWindowError, reportRendererError } from './debug/rendererErrors';
import { setProductTracker } from '@vendor/app-client/contracts';
import { productTracker } from './lib/track';
import { setComposerKeymapResolver } from '@vendor/app-client/contracts';
import { desktopComposerKeymapResolver } from './lib/composerKeymap';
import { getKimiWebApi } from './api';
import { nativeTerminalDraftKey, useNativeTerminal } from './composables/useNativeTerminal';
import { handlePluginsShelfEvent } from '@vendor/app-client/composables';
import { consumeSessionIntent } from './lib/session-intent';
import { reportStartupMilestone } from './lib/startupMilestones';
import './style.css';

const desktopVariant = typeof __OMNICODE_WEB_DESKTOP__ !== 'undefined' && __OMNICODE_WEB_DESKTOP__;

configureTrace(
  desktopVariant
    ? {
        logPrefix: '[kimi-code]',
        logFilePrefix: 'kimi-code-log',
        ignoreWindowError: isBenignWindowError,
        onRendererError: reportRendererError,
      }
    : { logPrefix: '[kimi-web]', logFilePrefix: 'kimi-web-log' },
);
installClientErrorCapture();
useFontPrefs();

if (desktopVariant) {
  setProductTracker(productTracker);
  setComposerKeymapResolver(desktopComposerKeymapResolver);
}

setKimiClientDeps({
  api: getKimiWebApi,
  t: (key, params) => (params === undefined ? i18n.global.t(key) : i18n.global.t(key, params)),
  traceClientEvent,
  traceKeyEvent: (event, info) => traceKeyEvent(event as never, info),
  sessionExportTraceToJsonl,
  onSessionDestroyed: (sessionId) => {
    useNativeTerminal().destroySession(sessionId);
    destroyPanelSessionSnapshot(sessionId);
  },
  onSessionDeleted: deleteBrowserReceipts,
  onSessionForked: async (source, target) => {
    await copyBrowserReceipts(source, target);
    const bridge = getNativeBrowserBridge();
    if (bridge === null) return;
    await forkPanelBrowserTabs(source, target, async (payload) => {
      const browserId = createBrowserId();
      const state = await bridge.browserClone(payload.browserId, browserId);
      return clonedBrowserTabPayload(payload, browserId, state);
    });
  },
  onWorkspaceDestroyed: (workspaceId, _root, sessionIds) => {
    const terminals = useNativeTerminal();
    for (const id of sessionIds) {
      terminals.destroySession(id);
      destroyPanelSessionSnapshot(id);
    }
    terminals.destroySession(nativeTerminalDraftKey(workspaceId));
    destroyPanelSessionSnapshot(panelDraftContextKey(workspaceId));
  },
  consumeSessionIntent,
  onPluginsShelfEvent: (event) => handlePluginsShelfEvent(event as never),
});

const app = createApp(App).use(i18n);
app.config.errorHandler = (err, _instance, info) => reportRendererException(err, info);
app.use(clientPinia);
const kimiI18n: KimiI18nApi = {
  t: (key, params) => i18n.global.t(key, params as never),
};
app.provide(KimiI18nKey, kimiI18n);
app.provide(IconResolverKey, (name) => getIcon(name as IconName)?.component);
app.provide(FontPreviewBrandKey, BrandLogo);
app.use(createKimiToast(AppToasts));

if (isMacosDesktop) {
  document.documentElement.classList.add('macos-desktop');
  initVibrancy();
}

if (isWindowsDesktop) document.documentElement.classList.add('windows-desktop');

if (hasCustomTitleBar) document.documentElement.classList.add('custom-titlebar');

app.mount('#app');
if (desktopVariant) reportStartupMilestone('ui-mounted');

if (isDesktop) {
  const bridge = (window as unknown as { kimiDesktop?: { setTheme: (s: 'light' | 'dark' | 'system') => void } }).kimiDesktop;
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
