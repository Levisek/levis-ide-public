import { ipcMain, webContents } from 'electron';
import log from 'electron-log';

// Drzime informaci o tom, ke kterym webContents jsme uz pripojili debugger.
const attached = new Set<number>();

async function ensureAttached(id: number): Promise<boolean> {
  if (attached.has(id)) return true;
  const wc = webContents.fromId(id);
  if (!wc) {
    log.warn('[touch] no webContents for id', id);
    return false;
  }
  try {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
      log.info('[touch] debugger attached to', id);
    }
    // Enable touch emulation aby page videla touch events i bez touchscreenu
    await wc.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    });
    await wc.debugger.sendCommand('Emulation.setEmitTouchEventsForMouse', {
      enabled: false, // my si dispatchneme sami
      configuration: 'mobile',
    });
    log.info('[touch] touch emulation enabled for', id);
    attached.add(id);
    wc.once('destroyed', () => attached.delete(id));
    return true;
  } catch (err) {
    log.warn('[touch] attach/emulation failed:', err);
    return false;
  }
}

export function registerTouchInputHandlers(): void {
  // Enable touch emulation pro guest webview — browser pak sam konvertuje
  // mys na touch eventy. RN-Web/Expo to vidi jako realny telefon.
  ipcMain.handle('mobile:enableTouch', async (_e, id: number) => {
    if (!(await ensureAttached(id))) return false;
    const wc = webContents.fromId(id);
    if (!wc) return false;
    try {
      // configuration:'desktop' = bez mobile cursor indicator (jinak by se
      // zobrazoval velky kruzek pri kliku, vypadalo by to jako artefakt v IDE)
      await wc.debugger.sendCommand('Emulation.setEmitTouchEventsForMouse', {
        enabled: true,
        configuration: 'desktop',
      });
      log.info('[touch] setEmitTouchEventsForMouse=true on', id);
      return true;
    } catch (err) {
      log.warn('[touch] setEmit failed:', (err as any)?.message || err);
      return false;
    }
  });

  ipcMain.handle('mobile:disableTouch', async (_e, id: number) => {
    const wc = webContents.fromId(id);
    if (!wc || !wc.debugger.isAttached()) return false;
    try {
      await wc.debugger.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: false });
      return true;
    } catch (err) {
      return false;
    }
  });

  ipcMain.handle('mobile:setColorScheme', async (_e, id: number, scheme: 'dark' | 'light') => {
    if (!(await ensureAttached(id))) return false;
    const wc = webContents.fromId(id);
    if (!wc) return false;
    try {
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: scheme }],
      });
      return true;
    } catch (err) {
      log.warn('[touch] setColorScheme failed:', (err as any)?.message || err);
      return false;
    }
  });

  ipcMain.on('mobile:touch', async (_e, id: number, type: string, x: number, y: number) => {
    if (!(await ensureAttached(id))) return;
    const wc = webContents.fromId(id);
    if (!wc) return;
    try {
      const touchPoints = type === 'touchEnd' ? [] : [{ x, y, radiusX: 10, radiusY: 10, force: 0.5 }];
      await wc.debugger.sendCommand('Input.dispatchTouchEvent', {
        type, touchPoints, modifiers: 0,
      });
    } catch (err) {
      log.warn('[touch] dispatch failed:', (err as any)?.message || err);
    }
  });
}
