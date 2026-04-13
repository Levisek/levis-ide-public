import { ipcMain, clipboard, nativeImage, app } from 'electron';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export function registerEnvHandlers(): void {
  ipcMain.handle('env:homeDir', () => os.homedir());
  ipcMain.handle('env:appVersion', () => app.getVersion());
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(text));

  ipcMain.handle('clipboard:readImage', (_e, projectPath: string) => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    const tmpDir = path.join(projectPath, '.levis-tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, `paste-${Date.now()}.png`);
    fs.writeFileSync(filePath, img.toPNG());
    setTimeout(() => { try { fs.unlinkSync(filePath); } catch {} }, 60000);
    return filePath;
  });
}
