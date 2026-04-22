import { contextBridge, ipcRenderer } from 'electron';

// Preload pro plovoucí okna terminálu / editoru.
// Vystavuje subset levis API potřebný pro běh izolovaného panelu:
// - PTY (write, resize, listen) — pty data se broadcastují všem oknům
// - Clipboard (CC výzva paste, copy)
// - File system (editor save/load)
// - Window controls (panel:close, minimize, maximize)
// - Panel lifecycle (panel:load event)

const api = {
  // Window controls
  minimize: (panelId: string) => ipcRenderer.send('panel:minimize', panelId),
  toggleMaximize: (panelId: string) => ipcRenderer.send('panel:toggleMaximize', panelId),
  toggleFullscreen: (panelId: string) => ipcRenderer.send('panel:toggleFullscreen', panelId),
  close: (panelId: string) => ipcRenderer.send('panel:close', panelId),
  returnToWorkspace: (panelId: string) => ipcRenderer.send('panel:returnToWorkspace', panelId),

  // Panel lifecycle
  onLoad: (cb: (data: { panelId: string; panelType: string; payload: any }) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('panel:load', handler);
    return () => { ipcRenderer.off('panel:load', handler); };
  },
  onAssignId: (cb: (panelId: string) => void) => {
    const handler = (_e: any, panelId: string) => cb(panelId);
    ipcRenderer.on('panel:assignId', handler);
    return () => { ipcRenderer.off('panel:assignId', handler); };
  },
  notifyReady: (panelId: string) => ipcRenderer.send('panel:ready', panelId),

  // PTY
  createPty: (cwd: string) => ipcRenderer.invoke('pty:create', cwd),
  writePty: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
  resizePty: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
  killPty: (id: string) => ipcRenderer.send('pty:kill', id),
  onPtyData: (cb: (id: string, data: string) => void) => {
    const handler = (_e: any, id: string, data: string) => cb(id, data);
    ipcRenderer.on('pty:data', handler);
    return () => { ipcRenderer.off('pty:data', handler); };
  },
  onPtyExit: (cb: (id: string) => void) => {
    const handler = (_e: any, id: string) => cb(id);
    ipcRenderer.on('pty:exit', handler);
    return () => { ipcRenderer.off('pty:exit', handler); };
  },

  // Clipboard
  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  clipboardWrite: (text: string) => ipcRenderer.send('clipboard:write', text),

  // File system (pro editor)
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  getLanguage: (filePath: string) => ipcRenderer.invoke('fs:getLanguage', filePath),
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: any) => ipcRenderer.invoke('store:set', key, value),
};

contextBridge.exposeInMainWorld('panelApi', api);
