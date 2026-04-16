import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { store } from '../store';

// Klíče které mění security-relevantní stav (allowed roots atd.) vyžadují dodatečnou
// validaci, jinak by renderer mohl rozšířit sandbox přes store:set.
function validateStoreValue(key: string, value: any): { ok: boolean; error?: string } {
  if (key === 'scanPath') {
    if (typeof value !== 'string' || !value) return { ok: false, error: 'scanPath must be non-empty string' };
    if (!path.isAbsolute(value)) return { ok: false, error: 'scanPath must be absolute' };
    // Zákaz systémových cest — attacker nemůže eskalovat sandbox přes scanPath
    const lower = value.toLowerCase().replace(/\\/g, '/');
    const forbidden = [
      '/windows', '/program files', '/programdata', '/system32',
      '/etc', '/sys', '/proc', '/root', '/boot', '/var/log',
    ];
    for (const f of forbidden) {
      if (lower === f || lower.startsWith(f + '/') || lower.startsWith('c:' + f) || lower.endsWith(':' + f)) {
        return { ok: false, error: `scanPath not allowed: ${value}` };
      }
    }
    try {
      const st = fs.statSync(value);
      if (!st.isDirectory()) return { ok: false, error: 'scanPath is not a directory' };
    } catch {
      return { ok: false, error: 'scanPath does not exist' };
    }
  }
  return { ok: true };
}

export function registerStoreHandlers(): void {
  ipcMain.handle('store:get', (_event, key: string) => {
    return store.get(key);
  });
  ipcMain.handle('store:set', (_event, key: string, value: any) => {
    const v = validateStoreValue(key, value);
    if (!v.ok) return { error: v.error };
    store.set(key, value);
    return { success: true };
  });
  ipcMain.handle('store:getAll', () => {
    return store.store;
  });
}
