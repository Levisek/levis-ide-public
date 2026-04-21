import { ipcMain, BrowserWindow, app } from 'electron';
import * as path from 'path';
import { setAllowQuit, hardenWindow } from '../main';

// Singleton legacy popout (artifact / browser / mobile)
let popoutWindow: BrowserWindow | null = null;
// Multi-instance panel popouts (terminal / editor) — key = unique panelId
const panelPopouts: Map<string, BrowserWindow> = new Map();
// Data čekající až si je renderer vyzvedne handshake-em (panel:ready)
const pendingPanelData: Map<string, { panelId: string; panelType: string; payload: any }> = new Map();

export function registerWindowHandlers(mainWindow: BrowserWindow): void {
  // ── Window controls ─────────────────────
  ipcMain.on('window:minimize', () => mainWindow.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow.close());
  ipcMain.on('window:hardReload', () => mainWindow.webContents.reloadIgnoringCache());
  // Force quit po confirm + animaci
  ipcMain.on('app:forceQuit', () => {
    setAllowQuit(true);
    app.quit();
  });

  // ── Pop-out window ────────────────────
  ipcMain.handle('window:popout', (_event, data: { type: string; url?: string; filePath?: string; projectPath?: string }) => {
    if (popoutWindow && !popoutWindow.isDestroyed()) {
      popoutWindow.focus();
      popoutWindow.webContents.send('popout:load', data);
      return { reused: true };
    }

    popoutWindow = new BrowserWindow({
      width: 900,
      height: 700,
      minWidth: 400,
      minHeight: 300,
      frame: false,
      backgroundColor: '#0a0a0f',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: path.join(__dirname, '..', 'preload-popout.js'),
        webviewTag: true,
        webSecurity: false, // file:// iframe musi byt same-origin pro inspector eval
        backgroundThrottling: true, // šetří CPU/baterku když popout v pozadí
      },
    });

    popoutWindow.webContents.on('will-attach-webview', (e, webPreferences, params) => {
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      delete (webPreferences as any).preload;
      const src = params.src || '';
      if (!/^(https?:\/\/|file:\/\/|about:blank)/i.test(src)) {
        e.preventDefault();
      }
    });

    hardenWindow(popoutWindow);
    popoutWindow.loadFile(path.join(__dirname, '..', '..', '..', 'src', 'popout.html'));

    popoutWindow.webContents.once('did-finish-load', () => {
      popoutWindow!.webContents.send('popout:load', data);
    });

    popoutWindow.on('closed', () => {
      popoutWindow = null;
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('popout:closed');
        }
      } catch {}
    });

    return { opened: true };
  });

  // Popout window controls
  ipcMain.on('popout:close', () => {
    if (popoutWindow && !popoutWindow.isDestroyed()) popoutWindow.close();
  });
  ipcMain.on('popout:minimize', () => {
    if (popoutWindow && !popoutWindow.isDestroyed()) popoutWindow.minimize();
  });
  ipcMain.on('popout:toggleMaximize', () => {
    if (popoutWindow && !popoutWindow.isDestroyed()) {
      if (popoutWindow.isMaximized()) popoutWindow.unmaximize();
      else popoutWindow.maximize();
    }
  });
  ipcMain.on('popout:toggleFullscreen', () => {
    if (popoutWindow && !popoutWindow.isDestroyed()) {
      popoutWindow.setFullScreen(!popoutWindow.isFullScreen());
    }
  });

  // Forward prompt from popout to main window
  // Payload: { text: string; submit: boolean } — submit=false = prepare mód (bez Enteru).
  // Legacy string payload zůstává backward-compat (submit=true default).
  ipcMain.on('popout:sendPrompt', (_event, payload: string | { text: string; submit: boolean }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const normalized = typeof payload === 'string' ? { text: payload, submit: true } : payload;
      mainWindow.webContents.send('popout:sendPrompt', normalized);
    }
  });

  // Forward refresh from main to popout
  ipcMain.on('popout:refresh', () => {
    if (popoutWindow && !popoutWindow.isDestroyed()) {
      popoutWindow.webContents.send('popout:refresh');
    }
  });

  // Forward CC working→idle (pro BrowserCore armed-reload v popoutu)
  ipcMain.on('popout:ccDone', () => {
    if (popoutWindow && !popoutWindow.isDestroyed()) {
      popoutWindow.webContents.send('popout:ccDone');
    }
  });

  // ── Panel popout (terminal / editor) — multi instance ──
  ipcMain.handle('window:popoutPanel', (_event, data: { panelType: 'terminal' | 'editor'; payload: any }) => {
    const panelId = `panel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const win = new BrowserWindow({
      width: data.panelType === 'editor' ? 1024 : 900,
      height: data.panelType === 'editor' ? 768 : 600,
      minWidth: 400,
      minHeight: 300,
      frame: false,
      backgroundColor: '#0a0a0f',
      title: data.panelType === 'editor' ? 'LevisIDE — Editor' : 'LevisIDE — Terminál',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: path.join(__dirname, '..', 'preload-popout-panel.js'),
        webviewTag: false,
        backgroundThrottling: true, // šetří CPU/baterku když panel v pozadí
      },
    });
    hardenWindow(win);
    panelPopouts.set(panelId, win);
    // Ulož data ať si je renderer vyzvedne handshake-em (panel:ready → panel:load)
    pendingPanelData.set(panelId, { panelId, panelType: data.panelType, payload: data.payload });
    win.loadFile(path.join(__dirname, '..', '..', '..', 'src', 'popout-panel.html'), { hash: panelId });
    win.on('closed', () => {
      try {
        panelPopouts.delete(panelId);
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
          try { mainWindow.webContents.send('panel:closed', { panelId, panelType: data.panelType }); } catch {}
        }
      } catch (err) {
        console.error('[panel closed handler]', err);
      }
    });
    return { panelId };
  });

  // Handshake: renderer řekl že je ready → pošli mu data + otevři DevTools
  ipcMain.on('panel:ready', (event, panelId: string) => {
    const data = pendingPanelData.get(panelId);
    if (data) {
      try { event.sender.send('panel:load', data); } catch {}
      pendingPanelData.delete(panelId);
    }
  });

  ipcMain.on('panel:close', (_event, panelId: string) => {
    const w = panelPopouts.get(panelId);
    if (w && !w.isDestroyed()) w.close();
  });
  ipcMain.on('panel:minimize', (_event, panelId: string) => {
    const w = panelPopouts.get(panelId);
    if (w && !w.isDestroyed()) w.minimize();
  });
  ipcMain.on('panel:toggleMaximize', (_event, panelId: string) => {
    const w = panelPopouts.get(panelId);
    if (w && !w.isDestroyed()) {
      if (w.isMaximized()) w.unmaximize(); else w.maximize();
    }
  });

  // Vrátit panel zpět do hlavního workspace okna
  ipcMain.on('panel:returnToWorkspace', (_event, panelId: string) => {
    try {
      const w = panelPopouts.get(panelId);
      if (!w || w.isDestroyed()) return;
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        try { mainWindow.webContents.send('panel:returned', { panelId }); } catch {}
        try { mainWindow.focus(); } catch {}
      }
      // Defer close aby renderer stihl event zpracovat
      setTimeout(() => {
        try { if (w && !w.isDestroyed()) w.close(); } catch {}
      }, 50);
    } catch (err) {
      console.error('[panel:returnToWorkspace]', err);
    }
  });
}
