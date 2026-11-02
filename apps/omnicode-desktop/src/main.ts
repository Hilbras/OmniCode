import { join } from 'node:path';

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';

import { type ServerHandle, startServer } from './server';
import { resourceImage, startUpdater, type UpdateStatus, type Updater } from './updater';
import { decorateWindow, titleBarOverlay } from './window-chrome';

app.commandLine.appendSwitch('disable-features', 'Translate,MediaRouter,OptimizationHints,InterestFeedContentSuggestions');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-breakpad');

let server: ServerHandle | undefined;
let mainWindow: BrowserWindow | undefined;
let updater: Updater | undefined;
let pageTitle = 'Omnicode';
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (quitting || server === undefined) return;
    event.preventDefault();
    quitting = true;
    void server.stop().finally(() => app.quit());
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => app.quit());
  }
  void app.whenReady().then(boot);
}

async function boot(): Promise<void> {
  buildMenu({ state: 'idle' });
  try {
    server = await startServer({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      onLog: (line) => {
        if (line.length > 0) console.log(`[server] ${line}`);
      },
    });
  } catch (error) {
    dialog.showErrorBox(
      'Omnicode could not start',
      error instanceof Error ? error.message : String(error),
    );
    app.exit(1);
    return;
  }
  void server.exited.then((code) => {
    if (quitting) return;
    dialog.showErrorBox('Omnicode stopped', `The Omnicode server exited unexpectedly (code ${code}).`);
    app.exit(1);
  });
  updater = startUpdater({
    window: () => mainWindow,
    pageTitle: () => pageTitle,
    onStatusChange: (status) => {
      buildMenu(status);
      if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop:update-status', status);
      }
    },
  });
  registerBridge(updater);
  mainWindow = createWindow(server);
}

function registerBridge(active: Updater): void {
  ipcMain.handle('desktop:version', () => app.getVersion());
  ipcMain.handle('desktop:update-status', () => active.status());
  ipcMain.handle('desktop:update-check', () => active.check());
  ipcMain.handle('desktop:update-download', () => active.download());
  ipcMain.handle('desktop:update-install', () => active.install());
  ipcMain.handle('desktop:update-auto-download', () => active.autoDownload());
  ipcMain.handle('desktop:update-set-auto-download', (_event, enabled: unknown) =>
    active.setAutoDownload(enabled === true),
  );
  ipcMain.on('desktop:show-window', () => showWindow());
  ipcMain.on('desktop:theme', (_event, scheme: unknown) => {
    nativeTheme.themeSource = scheme === 'light' || scheme === 'dark' ? scheme : 'system';
  });
}

function showWindow(): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function buildMenu(status: UpdateStatus): void {
  Menu.setApplicationMenu(menuFor(status));
}

function menuFor(status: UpdateStatus): Menu {
  const ready = status.state === 'downloaded';
  return Menu.buildFromTemplate([
    {
      label: 'Omnicode',
      submenu: [
        { label: `Version ${app.getVersion()}`, enabled: false },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('desktop:menu-action', 'open-settings'),
        },
        {
          label: ready ? `Restart to Update to ${status.version}` : 'Restart to Update',
          enabled: ready,
          click: () => updater?.install(),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]);
}

function createWindow(running: ServerHandle): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'Omnicode',
    icon: themedIcon(),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0b08' : '#fafaf7',
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(nativeTheme.shouldUseDarkColors),
    webPreferences: {
      preload: join(__dirname, 'desktop-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });
  const contents = window.webContents;
  const isInternal = (url: string): boolean => {
    try {
      return new URL(url).origin === running.origin;
    } catch {
      return false;
    }
  };
  contents.setWindowOpenHandler(({ url }) => {
    if (!isInternal(url) && /^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isInternal(url)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  contents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write' || permission === 'notifications');
  });
  window.on('page-title-updated', (event, title) => {
    pageTitle = title;
    if (updater === undefined) return;
    event.preventDefault();
    window.setTitle(updater.windowTitle(title));
  });
  decorateWindow(window);
  const onThemeChange = (): void => {
    if (window.isDestroyed()) return;
    const dark = nativeTheme.shouldUseDarkColors;
    window.setTitleBarOverlay(titleBarOverlay(dark));
    window.setBackgroundColor(dark ? '#0d0b08' : '#fafaf7');
    window.setIcon(themedIcon());
  };
  nativeTheme.on('updated', onThemeChange);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    nativeTheme.off('updated', onThemeChange);
    mainWindow = undefined;
  });
  void window.loadURL(desktopUrl(running.url));
  return window;
}

/** The web UI switches to desktop mode (update UI, theme bridge, static title) from these query params. */
function desktopUrl(base: string): string {
  const url = new URL(base);
  url.searchParams.set('omnicode_desktop', '1');
  url.searchParams.set('platform', process.platform);
  return url.toString();
}

function themedIcon(): Electron.NativeImage {
  return resourceImage(nativeTheme.shouldUseDarkColors ? 'icon-dark.png' : 'icon-light.png');
}
