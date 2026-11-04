import { contextBridge, ipcRenderer, type IpcRendererEvent, webUtils } from 'electron';

import { mountUpdateButton } from './update-button';
import type { UpdateCheckResult, UpdateStatus } from './updater';
import { RESERVE_VAR, measureControlsWidth } from './window-chrome';

/**
 * `window.omnicodeDesktop`: the bridge the web UI looks for when it runs in
 * desktop mode (`?omnicode_desktop`). It drives the web UI's Settings →
 * Version & updates section and the update button beside the window
 * controls, keeps the window theme in step with the app's appearance
 * setting, and resolves dropped files to paths.
 */
contextBridge.exposeInMainWorld('omnicodeDesktop', {
  getVersion: (): Promise<string> => ipcRenderer.invoke('desktop:version'),
  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('desktop:update-status'),
  onUpdateStatus: (listener: (status: UpdateStatus) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, status: UpdateStatus): void => listener(status);
    ipcRenderer.on('desktop:update-status', handler);
    return () => ipcRenderer.off('desktop:update-status', handler);
  },
  checkForUpdates: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('desktop:update-check'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('desktop:update-download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('desktop:update-install'),
  getUpdateAutoDownload: (): Promise<boolean> => ipcRenderer.invoke('desktop:update-auto-download'),
  setUpdateAutoDownload: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('desktop:update-set-auto-download', enabled === true),
  setTheme: (scheme: string): void => {
    ipcRenderer.send('desktop:theme', scheme);
  },
  showWindow: (): void => {
    ipcRenderer.send('desktop:show-window');
  },
  setOnboarded: (): void => {},
  onMenuAction: (listener: (action: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, action: string): void => listener(action);
    ipcRenderer.on('desktop:menu-action', handler);
    return () => ipcRenderer.off('desktop:menu-action', handler);
  },
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  log: (): void => {},
});

window.addEventListener('DOMContentLoaded', () => {
  void ipcRenderer.invoke('desktop:version').then((currentVersion: string) => {
    mountUpdateButton({
      currentVersion,
      controlsWidth: measureControlsWidth(),
      reserveVar: RESERVE_VAR,
      getStatus: () => ipcRenderer.invoke('desktop:update-status'),
      onStatus: (listener) => {
        ipcRenderer.on('desktop:update-status', (_event: IpcRendererEvent, status: UpdateStatus) => listener(status));
      },
      download: () => void ipcRenderer.invoke('desktop:update-download'),
      install: () => void ipcRenderer.invoke('desktop:update-install'),
    });
  });
});
