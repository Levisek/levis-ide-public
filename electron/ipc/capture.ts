import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { isPathAllowed } from './safe-path';

export function registerCaptureHandlers(): void {
  // Capture region z webContents toho okna co volá (event.sender)
  // rect je v souřadnicích webContents (CSS px, top-left = 0,0)
  // savePath = absolutní cesta kam uložit PNG
  ipcMain.handle('capture:region', async (event, rect: { x: number; y: number; width: number; height: number }, savePath: string) => {
    if (!isPathAllowed(savePath)) return { error: 'Save path not allowed' };
    if (!savePath.toLowerCase().endsWith('.png')) return { error: 'Only .png files allowed' };
    try {
      const wc = event.sender;
      // capturePage zaokrouhlí na integery
      const r = {
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      };
      const image = await wc.capturePage(r);
      const dir = path.dirname(savePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(savePath, image.toPNG());
      return { success: true, path: savePath };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // Cleanup .levis-tmp/ — smazat soubory starší než 24 h
  ipcMain.handle('capture:cleanup', async (_event, tmpDir: string) => {
    if (!isPathAllowed(tmpDir)) return { error: 'Path not allowed' };
    if (!tmpDir.includes('.levis-tmp')) return { error: 'Only .levis-tmp directories allowed' };
    try {
      if (!fs.existsSync(tmpDir)) return { success: true };
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const f of fs.readdirSync(tmpDir)) {
        const fp = path.join(tmpDir, f);
        try {
          const st = fs.statSync(fp);
          if (st.isFile() && st.mtimeMs < cutoff) fs.unlinkSync(fp);
        } catch {}
      }
      return { success: true };
    } catch (err) {
      return { error: String(err) };
    }
  });
}
