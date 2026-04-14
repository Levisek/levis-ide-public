import { app, BrowserWindow, globalShortcut, Menu } from 'electron';
import * as path from 'path';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';
import { registerIpcHandlers, killAllPty } from './ipc';
import { store } from './store';

log.transports.file.level = 'info';
autoUpdater.logger = log;

let mainWindow: BrowserWindow | null = null;
let allowQuit = false;
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

  registerIpcHandlers(mainWindow);

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

  // Check for updates (silent)
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    log.warn('Auto-update check failed:', err);
  });
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
