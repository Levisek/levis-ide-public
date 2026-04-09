import { ipcMain, BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import log from 'electron-log';
import { isPathAllowed } from './safe-path';

const ptyProcesses: Map<string, pty.IPty> = new Map();

// Broadcast PTY event do všech otevřených oken — renderer si sám filtruje podle id
function broadcastPty(channel: string, ...args: any[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try { win.webContents.send(channel, ...args); } catch {}
    }
  }
}

export function registerPtyHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('pty:create', (_event, cwd: string) => {
    if (!isPathAllowed(cwd)) {
      log.warn(`PTY create rejected, path not allowed: ${cwd}`);
      throw new Error('Path not allowed');
    }
    const id = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: process.env as Record<string, string>,
    });

    ptyProcess.onData((data: string) => {
      broadcastPty('pty:data', id, data);
    });

    ptyProcess.onExit(() => {
      ptyProcesses.delete(id);
      broadcastPty('pty:exit', id);
    });

    ptyProcesses.set(id, ptyProcess);
    log.info(`PTY created: ${id} in ${cwd}`);
    return id;
  });

  // Adopce existujícího PTY (drag-out scenario) — vrací cwd ať popout ví kde
  ipcMain.handle('pty:info', (_event, id: string) => {
    const proc = ptyProcesses.get(id);
    if (!proc) return null;
    return { id, cols: proc.cols, rows: proc.rows };
  });

  ipcMain.on('pty:write', (_event, id: string, data: string) => {
    const proc = ptyProcesses.get(id);
    if (proc) proc.write(data);
  });

  ipcMain.on('pty:resize', (_event, id: string, cols: number, rows: number) => {
    const proc = ptyProcesses.get(id);
    if (proc) proc.resize(cols, rows);
  });

  ipcMain.on('pty:kill', (_event, id: string) => {
    const proc = ptyProcesses.get(id);
    if (proc) {
      proc.kill();
      ptyProcesses.delete(id);
      log.info(`PTY killed: ${id}`);
    }
  });
}

export function killAllPty(): void {
  for (const [id, proc] of ptyProcesses) {
    proc.kill();
    ptyProcesses.delete(id);
  }
}
