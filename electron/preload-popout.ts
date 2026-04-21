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
  sendPrompt: (prompt: string) => ipcRenderer.send('popout:sendPrompt', prompt),
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
};

contextBridge.exposeInMainWorld('popoutApi', api);
