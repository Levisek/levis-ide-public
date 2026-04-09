import { contextBridge, ipcRenderer } from 'electron';

const api = {
  minimize: () => ipcRenderer.send('popout:minimize'),
  toggleMaximize: () => ipcRenderer.send('popout:toggleMaximize'),
  close: () => ipcRenderer.send('popout:close'),
  toggleFullscreen: () => ipcRenderer.send('popout:toggleFullscreen'),
  sendPrompt: (prompt: string) => ipcRenderer.send('popout:sendPrompt', prompt),
  onLoad: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('popout:load', handler);
    return () => { ipcRenderer.off('popout:load', handler); };
  },
  onRefresh: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('popout:refresh', handler);
    return () => { ipcRenderer.off('popout:refresh', handler); };
  },
};

contextBridge.exposeInMainWorld('popoutApi', api);
