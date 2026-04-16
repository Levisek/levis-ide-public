import { contextBridge, ipcRenderer } from 'electron';

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
  // Store read pro i18n init
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
};

contextBridge.exposeInMainWorld('popoutApi', api);
