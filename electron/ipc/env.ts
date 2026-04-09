import { ipcMain, clipboard } from 'electron';
import * as os from 'os';

export function registerEnvHandlers(): void {
  ipcMain.handle('env:homeDir', () => os.homedir());
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(text));
}
