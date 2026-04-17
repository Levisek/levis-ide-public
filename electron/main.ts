import { app, BrowserWindow, globalShortcut, Menu, shell, ipcMain } from 'electron';
import * as path from 'path';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';
import { registerIpcHandlers, killAllPty } from './ipc';
import { store } from './store';

// Hardening: blok navigace mimo původní file:// a blok window.open z rendereru.
// Externí http(s) linky se otevřou v systémovém prohlížeči, vše ostatní se odmítne.
export function hardenWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    // Povol jen file:// navigace uvnitř dist/src (initial load + reload)
    if (!/^file:\/\//i.test(url)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url).catch(() => {});
      } else {
        log.warn(`Blocked navigation: ${url}`);
      }
    }
  });
}

log.transports.file.level = 'info';
autoUpdater.logger = log;

let mainWindow: BrowserWindow | null = null;
// --audit-mode: visual-audit runner, přeskočit confirm-quit dialogy ať proces zavře čistě
let allowQuit = process.argv.includes('--audit-mode');
export function setAllowQuit(v: boolean): void { allowQuit = v; }
export function isAllowQuit(): boolean { return allowQuit; }

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow(): void {
  const windowState = store.get('windowState', {
    width: 1400,
    height: 900,
    x: undefined as number | undefined,
    y: undefined as number | undefined,
    isMaximized: false,
  });

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
    },
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  hardenWindow(mainWindow);
  registerIpcHandlers(mainWindow);

  // OS-level focus/blur — posíláme do rendereru místo window.addEventListener(focus|blur),
  // které v rendereru fire i při interním kliku na webview (Chromium DOM focus capture).
  // BrowserWindow.on('blur'/'focus') se fire jen při přepnutí OS okna/aplikace.
  mainWindow.on('blur', () => {
    try { mainWindow?.webContents.send('window:osBlur'); } catch {}
  });
  mainWindow.on('focus', () => {
    try { mainWindow?.webContents.send('window:osFocus'); } catch {}
  });

  // Webview validátor — povol http(s) (dev servery, mobile preview) + file:// (HTML projekt preview)
  // + about:blank (init). Bloky data:/javascript:/vbscript: jako XSS exfil vector.
  mainWindow.webContents.on('will-attach-webview', (e, webPreferences, params) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    delete (webPreferences as any).preload;
    const src = params.src || '';
    if (!/^(https?:\/\/|file:\/\/|about:blank)/i.test(src)) {
      log.warn(`Blocked webview src: ${src}`);
      e.preventDefault();
    }
  });

  // __dirname is dist/electron/, index.html is in src/
  mainWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show();
    log.info('LevisIDE window ready');
  });

  // DevTools shortcut: Ctrl+Shift+I / F12
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && (input.key === 'I' || input.key === 'i'))) {
      mainWindow!.webContents.toggleDevTools();
    }
  });

  // Save window state on resize/move
  const saveWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    store.set('windowState', {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: mainWindow.isMaximized(),
    });
  };

  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  // Confirm před zavřením + animace tipečka
  mainWindow.on('close', (e) => {
    saveWindowState();
    if (!allowQuit) {
      e.preventDefault();
      mainWindow!.webContents.send('app:confirmQuit');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Auto-update s in-app UI feedbackem: místo checkForUpdatesAndNotify (OS notifikace, co
  // user nevidí) si bereme eventy sami a posíláme renderer-side banner přes IPC.
  // Automatický download nebudeme — počkáme až user potvrdí „Stáhnout", ať nezpomaluje síť.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  const sendUpdate = (status: string, payload: any = {}): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try { mainWindow.webContents.send('update:status', { status, ...payload }); } catch {}
  };

  autoUpdater.on('checking-for-update', () => sendUpdate('checking'));
  autoUpdater.on('update-available', (info) => sendUpdate('available', { version: info.version, releaseNotes: info.releaseNotes, releaseDate: info.releaseDate }));
  autoUpdater.on('update-not-available', (info) => sendUpdate('not-available', { version: info?.version }));
  autoUpdater.on('download-progress', (p) => sendUpdate('downloading', { percent: Math.round(p.percent), transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate('downloaded', { version: info.version }));
  autoUpdater.on('error', (err) => sendUpdate('error', { message: String(err?.message || err) }));

  // Renderer -> main akce
  ipcMain.handle('update:check', async () => {
    try { await autoUpdater.checkForUpdates(); return { success: true }; }
    catch (err) { log.warn('update:check failed:', err); return { error: String(err) }; }
  });
  ipcMain.handle('update:download', async () => {
    try { await autoUpdater.downloadUpdate(); return { success: true }; }
    catch (err) { log.warn('update:download failed:', err); return { error: String(err) }; }
  });
  ipcMain.handle('update:install', () => {
    // quitAndInstall zavře všechna okna a nainstaluje. Nastavit allowQuit, jinak pre-quit
    // modal přeruší instalaci.
    allowQuit = true;
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { success: true };
  });

  // Spustit první check 5 s po startu (ať se renderer stihne připojit na 'update:status')
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => log.warn('Auto-update check failed:', err));
  }, 5000);
}

app.whenReady().then(() => {
  // Menu s Edit role — jinak Ctrl+C/V/X/A nefunguje ve frameless okne
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ]));

  createWindow();
  log.info('LevisIDE started, version', app.getVersion());
});

app.on('window-all-closed', () => {
  killAllPty();
  globalShortcut.unregisterAll();
  app.quit();
});
