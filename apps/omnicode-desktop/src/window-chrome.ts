import type { BrowserWindow, TitleBarOverlayOptions } from 'electron';

export const TITLEBAR_HEIGHT = 48;

/**
 * Width of the native caption buttons the app draws over its top-right
 * corner. Windows and Linux draw them there — macOS keeps its traffic lights
 * on the left — and the page measures the real width through the Window
 * Controls Overlay API; this is the fallback for a renderer that does not
 * expose it.
 */
export const CONTROLS_WIDTH =
  process.platform === 'win32' ? 138 : process.platform === 'linux' ? 113 : 0;
const DRAG_STRIP_ID = 'omnicode-desktop-drag';
export const RESERVE_VAR = '--omnicode-desktop-controls';

interface WindowControlsOverlayLike {
  getTitlebarAreaRect: () => { right: number };
}

/**
 * The width the native caption buttons take from the app's top-right corner,
 * as the page itself reports it. Zero when the platform draws none there.
 */
export function measureControlsWidth(): number {
  const overlay = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike })
    .windowControlsOverlay;
  if (!overlay) return CONTROLS_WIDTH;
  const width = Math.round(window.innerWidth - overlay.getTitlebarAreaRect().right);
  return Number.isFinite(width) && width > 0 ? width : 0;
}

/**
 * The app runs edge to edge under the native window controls: the sidebar
 * takes the full height and the main column's own header row is the title
 * bar. A fixed, click-through strip along the top edge is the drag region,
 * every control the app renders up there stays clickable, and the app's
 * top-right controls move left of the window controls.
 */
const APP_CSS = `
:root { ${RESERVE_VAR}: ${CONTROLS_WIDTH}px; }
#${DRAG_STRIP_ID} {
  position: fixed;
  inset: 0 0 auto 0;
  height: ${TITLEBAR_HEIGHT}px;
  pointer-events: none;
  -webkit-app-region: drag;
  app-region: drag;
  z-index: 2147483647;
}
button, a, input, textarea, select, summary, label, [role], [contenteditable], [tabindex] {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
.right-panel-toggle {
  right: calc(var(--panel-head-inset, 11px) + var(${RESERVE_VAR})) !important;
}
.empty-toggles {
  right: calc(var(--space-4, 16px) + var(--icon-button-sm, 26px) + var(--space-2, 8px) + var(${RESERVE_VAR})) !important;
}
.panel-tab-bar .ptb-tail {
  margin-right: var(${RESERVE_VAR});
}
.chat-header .ch-git,
.chat-header .ch-pr,
.chat-header .ch-toggles {
  position: relative;
  right: var(${RESERVE_VAR});
}
`;

const ADD_DRAG_STRIP_SCRIPT = `(() => {
  if (document.getElementById('${DRAG_STRIP_ID}')) return;
  const strip = document.createElement('div');
  strip.id = '${DRAG_STRIP_ID}';
  strip.setAttribute('aria-hidden', 'true');
  document.body.prepend(strip);
})()`;

/**
 * Native window controls on a transparent backing, so they sit on whatever
 * the app paints there in either theme; only the symbol color follows the
 * app's light / dark appearance.
 */
export function titleBarOverlay(dark: boolean): TitleBarOverlayOptions {
  return {
    color: '#00000000',
    symbolColor: dark ? '#f3efe3' : '#1c1a16',
    height: TITLEBAR_HEIGHT - 1,
  };
}

export function decorateWindow(window: BrowserWindow): void {
  window.webContents.on('dom-ready', () => {
    void window.webContents.insertCSS(APP_CSS).catch(() => {});
    void window.webContents.executeJavaScript(ADD_DRAG_STRIP_SCRIPT, false).catch(() => {});
  });
}
