import { contextBridge, ipcRenderer, clipboard } from 'electron';

// Buffer pro data která přijdou před registrací listeneru
let pendingLoad: any = null;

ipcRenderer.on('popout:load', (_e, data) => {
  pendingLoad = data;
});

const api = {
  minimize: () => ipcRenderer.send('popout:minimize'),
  toggleMaximize: () => ipcRenderer.send('popout:toggleMaximize'),
  close: () => ipcRenderer.send('popout:close'),
  toggleFullscreen: () => ipcRenderer.send('popout:toggleFullscreen'),
  // Payload { text, submit } — submit=false = jen připravit prompt bez odeslání (prepare mód).
  // Main forwarduje do workspace, který volá sendToFirstTerminal → queue respekt.
  sendPrompt: (payload: { text: string; submit: boolean }) =>
    ipcRenderer.send('popout:sendPrompt', payload),
  onLoad: (cb: (data: any) => void) => {
    // Doruč data co přišla před registrací
    if (pendingLoad) {
      const d = pendingLoad;
      pendingLoad = null;
      queueMicrotask(() => cb(d));
    }
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('popout:load', handler);
    return () => { ipcRenderer.off('popout:load', handler); };
  },
  onRefresh: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('popout:refresh', handler);
    return () => { ipcRenderer.off('popout:refresh', handler); };
  },
  // CC working→idle bridge z workspace (main → popout) — pro BrowserCore armed-reload flow
  onCCDone: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('popout:ccDone', handler);
    return () => { ipcRenderer.off('popout:ccDone', handler); };
  },
  // Store
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: any) => ipcRenderer.invoke('store:set', key, value),
  // Clipboard (text only — popout nikdy nečte obrázky)
  clipboardRead: () => clipboard.readText(),
  clipboardWrite: (text: string) => { clipboard.writeText(text); },
  // Capture — capture:region v main používá event.sender, takže capturuje popout webContents
  captureRegion: (rect: { x: number; y: number; width: number; height: number }, savePath: string) =>
    ipcRenderer.invoke('capture:region', rect, savePath),
  captureCleanup: (tmpDir: string) => ipcRenderer.invoke('capture:cleanup', tmpDir),
  // Touch emulation (CDP přes main) — id je webContentsId guest webview uvnitř popoutu
  mobileEnableTouch: (id: number) => ipcRenderer.invoke('mobile:enableTouch', id),
  mobileDisableTouch: (id: number) => ipcRenderer.invoke('mobile:disableTouch', id),
  mobileSetColorScheme: (id: number, scheme: 'dark' | 'light') =>
    ipcRenderer.invoke('mobile:setColorScheme', id, scheme),
  // Per-project prefs (pin URL atd.)
  getProjectPrefs: (projectPath: string) => ipcRenderer.invoke('projects:getPrefs', projectPath),
  setProjectPref: (projectPath: string, key: string, value: any) =>
    ipcRenderer.invoke('projects:setPref', projectPath, key, value),
  // OS file dialog — pro "Open file…" tlačítko v browser toolbaru
  openFileDialog: (multi?: boolean) => ipcRenderer.invoke('dialog:openFile', multi),
  // FS read — pro initial index.html probe ve statickém projektu
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
};

contextBridge.exposeInMainWorld('popoutApi', api);
