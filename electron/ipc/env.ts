import { ipcMain, clipboard, nativeImage, app, shell } from 'electron';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export function registerEnvHandlers(): void {
  ipcMain.handle('env:homeDir', () => os.homedir());
  ipcMain.handle('env:appVersion', () => app.getVersion());
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(text));

  // Čtení obrázku z clipboardu — uloží PNG do .levis-tmp/, vrátí cestu
  ipcMain.handle('clipboard:readImage', (_e, projectPath: string) => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    const tmpDir = path.join(projectPath, '.levis-tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, `paste-${Date.now()}.png`);
    fs.writeFileSync(filePath, img.toPNG());
    // Auto-smazat po 60s
    setTimeout(() => { try { fs.unlinkSync(filePath); } catch {} }, 60000);
    return filePath;
  });

  // Vytvoří zástupce LevisIDE na ploše (Windows .lnk)
  ipcMain.handle('shell:createDesktopShortcut', () => {
    if (process.platform !== 'win32') {
      return { success: false, error: 'platform', message: 'Jen Windows (.lnk)' };
    }
    try {
      const desktop = app.getPath('desktop');
      const target = process.execPath;
      const isDev = /[\\/]electron[\\/]dist[\\/]electron\.exe$/i.test(target)
                 || /[\\/]node_modules[\\/]electron[\\/]/i.test(target);
      const shortcutPath = path.join(desktop, 'LevisIDE.lnk');
      const ok = shell.writeShortcutLink(shortcutPath, 'replace', {
        target,
        cwd: path.dirname(target),
        description: 'LevisIDE — Project Hub & Workspace',
        icon: target,
        iconIndex: 0,
      });
      if (!ok) return { success: false, error: 'write', message: 'writeShortcutLink selhalo' };
      return { success: true, path: shortcutPath, dev: isDev };
    } catch (e: any) {
      return { success: false, error: 'exception', message: String(e?.message || e) };
    }
  });
}
