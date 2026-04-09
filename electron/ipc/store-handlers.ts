import { ipcMain } from 'electron';
import { store } from '../store';

export function registerStoreHandlers(): void {
  ipcMain.handle('store:get', (_event, key: string) => {
    return store.get(key);
  });
  ipcMain.handle('store:set', (_event, key: string, value: any) => {
    store.set(key, value);
  });
  ipcMain.handle('store:getAll', () => {
    return store.store;
  });
}
