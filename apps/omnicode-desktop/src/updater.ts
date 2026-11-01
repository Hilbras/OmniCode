import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { app, type BrowserWindow, nativeImage, Notification } from 'electron';
import electronUpdater, { type UpdateInfo } from 'electron-updater';

const { autoUpdater } = electronUpdater;

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;
const MANUAL_CHECK_TIMEOUT_MS = 30_000;
const SETTINGS_FILE = 'desktop-settings.json';

/** The web UI's update contract (its Settings → Version & updates and sidebar update pill). */
export type UpdateState = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error';

export interface UpdateStatus {
  readonly state: UpdateState;
  readonly version?: string;
  readonly percent?: number;
  readonly message?: string;
  readonly releaseDate?: string;
  readonly releaseNotes?: { readonly en?: string };
}

export type UpdateCheckResult =
  | { readonly outcome: 'available'; readonly version?: string }
  | { readonly outcome: 'latest' }
  | { readonly outcome: 'unsupported' }
  | { readonly outcome: 'error'; readonly message: string };

export interface Updater {
  readonly status: () => UpdateStatus;
  readonly check: () => Promise<UpdateCheckResult>;
  readonly download: () => Promise<void>;
  readonly install: () => void;
  readonly autoDownload: () => boolean;
  readonly setAutoDownload: (enabled: boolean) => void;
  /** The page's own title with the "update ready" marker appended when one is waiting. */
  readonly windowTitle: (pageTitle: string) => string;
}

export interface UpdaterOptions {
  readonly window: () => BrowserWindow | undefined;
  /** The app page's title; the window title is this plus the "update ready" marker. */
  readonly pageTitle: () => string;
  readonly onStatusChange: (status: UpdateStatus) => void;
}

/**
 * The updater's errors carry the reason, a response dump and a stack trace
 * after the first line. Only the first line says what went wrong, and it is
 * what the settings page shows.
 */
function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split('\n')[0]?.trim() ?? '';
  return firstLine === '' ? message : firstLine;
}

/**
 * Updates from the GitHub `desktop-latest` release. Checks shortly after
 * launch and every few hours; a found version is announced but only
 * downloaded when the user asks (or when they turned automatic downloads
 * on). A downloaded update installs on restart from the web UI, the
 * notification, or the menu; on Windows it also installs on the next quit.
 * The .deb install needs an admin password prompt, so on Linux it never
 * starts on quit.
 */
export function startUpdater(options: UpdaterOptions): Updater {
  let status: UpdateStatus = { state: 'idle' };
  let autoDownload = readSettings().autoDownload === true;
  let notifiedVersion: string | undefined;
  let checking: Promise<UpdateCheckResult> | undefined;
  const installsOnQuit = process.platform === 'win32';

  const windowTitle = (pageTitle: string): string =>
    status.state === 'downloaded' ? `${pageTitle} — update ready` : pageTitle;

  const setStatus = (next: UpdateStatus): void => {
    status = next;
    renderStatus(options.window(), next, windowTitle(options.pageTitle()));
    options.onStatusChange(next);
  };

  const install = (): void => {
    if (status.state !== 'downloaded') return;
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  };

  if (!app.isPackaged) {
    return {
      status: () => status,
      check: async () => ({ outcome: 'unsupported' }),
      download: async () => {},
      install,
      autoDownload: () => autoDownload,
      setAutoDownload: (enabled) => {
        autoDownload = enabled;
        writeSettings({ autoDownload });
      },
      windowTitle,
    };
  }

  autoUpdater.autoDownload = autoDownload;
  autoUpdater.autoInstallOnAppQuit = installsOnQuit;
  autoUpdater.logger = console;

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    if (status.state === 'downloading' || status.state === 'downloaded') return;
    setStatus(baseStatus('available', info));
    if (notifiedVersion === `available:${info.version}` || autoDownload) return;
    notifiedVersion = `available:${info.version}`;
    showNotification(
      `Omnicode ${info.version} is available`,
      'Open Omnicode to see what is new and download it.',
      () => focusWindow(options.window()),
    );
  });
  autoUpdater.on('update-not-available', () => {
    if (status.state === 'available' || status.state === 'error') setStatus({ state: 'idle' });
  });
  autoUpdater.on('download-progress', (progress) => {
    setStatus({ ...status, state: 'downloading', percent: progress.percent });
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setStatus(baseStatus('downloaded', info));
    if (notifiedVersion === `downloaded:${info.version}`) return;
    notifiedVersion = `downloaded:${info.version}`;
    showNotification(
      `Omnicode ${info.version} is ready to install`,
      installsOnQuit
        ? 'Click to restart and update now, or it will install the next time you quit.'
        : 'Click to restart and update now.',
      install,
    );
  });
  autoUpdater.on('error', (error: Error) => {
    console.error('[updater]', error);
    if (status.state === 'downloading') {
      setStatus({ ...status, state: 'error', message: errorSummary(error) });
    }
  });

  const runCheck = async (): Promise<UpdateCheckResult> => {
    try {
      const result = await Promise.race([
        autoUpdater.checkForUpdates(),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('The update check timed out.')), MANUAL_CHECK_TIMEOUT_MS).unref(),
        ),
      ]);
      if (result === null || result === undefined || !result.isUpdateAvailable) return { outcome: 'latest' };
      return { outcome: 'available', version: result.updateInfo.version };
    } catch (error) {
      return { outcome: 'error', message: errorSummary(error) };
    }
  };

  const check = (): Promise<UpdateCheckResult> => {
    if (status.state === 'downloaded' || status.state === 'downloading') {
      return Promise.resolve({ outcome: 'available', version: status.version });
    }
    checking ??= runCheck().finally(() => {
      checking = undefined;
    });
    return checking;
  };

  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS).unref();
  setInterval(() => void check(), CHECK_INTERVAL_MS).unref();

  return {
    status: () => status,
    check,
    download: async () => {
      if (status.state !== 'available' && status.state !== 'error') return;
      setStatus({ ...status, state: 'downloading', percent: 0, message: undefined });
      try {
        await autoUpdater.downloadUpdate();
      } catch (error) {
        setStatus({ ...status, state: 'error', message: errorSummary(error) });
      }
    },
    install,
    autoDownload: () => autoDownload,
    setAutoDownload: (enabled) => {
      autoDownload = enabled;
      autoUpdater.autoDownload = enabled;
      writeSettings({ autoDownload });
      if (enabled && status.state === 'available') void autoUpdater.downloadUpdate().catch(() => {});
    },
    windowTitle,
  };
}

function baseStatus(state: UpdateState, info: UpdateInfo): UpdateStatus {
  const notes = notesText(info);
  return {
    state,
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: notes === '' ? undefined : { en: notes },
  };
}

/** Taskbar progress, badge / overlay icon, and window title for the current status. */
function renderStatus(window: BrowserWindow | undefined, status: UpdateStatus, title: string): void {
  const ready = status.state === 'downloaded';
  app.setBadgeCount(ready ? 1 : 0);
  if (window === undefined || window.isDestroyed()) return;
  window.setProgressBar(status.state === 'downloading' ? (status.percent ?? 0) / 100 : -1);
  window.setTitle(title);
  if (process.platform === 'win32') {
    window.setOverlayIcon(ready ? resourceImage('update-badge.png') : null, ready ? 'Update ready' : '');
  }
}

/** Release notes as markdown; electron-builder embeds build/release-notes.md in latest*.yml. */
function notesText(info: UpdateInfo): string {
  const notes = info.releaseNotes;
  if (typeof notes === 'string') return notes.trim();
  if (Array.isArray(notes)) {
    return notes
      .map((note) => note.note ?? '')
      .filter((note) => note.length > 0)
      .join('\n\n')
      .trim();
  }
  return '';
}

function focusWindow(window: BrowserWindow | undefined): void {
  if (window === undefined || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function showNotification(title: string, body: string, onClick: () => void): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body, icon: resourceImage('icon.png') });
  notification.on('click', onClick);
  notification.show();
}

interface DesktopSettings {
  readonly autoDownload?: boolean;
}

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE);
}

function readSettings(): DesktopSettings {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8')) as DesktopSettings;
  } catch {
    return {};
  }
}

function writeSettings(patch: DesktopSettings): void {
  try {
    writeFileSync(settingsPath(), `${JSON.stringify({ ...readSettings(), ...patch }, null, 2)}\n`);
  } catch (error) {
    console.error('[updater] could not save desktop settings', error);
  }
}

export function resourceImage(name: string): Electron.NativeImage {
  const path = app.isPackaged
    ? join(process.resourcesPath, name)
    : join(app.getAppPath(), 'build', name);
  return nativeImage.createFromPath(path);
}
