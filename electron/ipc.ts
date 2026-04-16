import { BrowserWindow } from 'electron';
import { registerWindowHandlers } from './ipc/window';
import { registerStoreHandlers } from './ipc/store-handlers';
import { registerProjectHandlers } from './ipc/projects';
import { registerGitHandlers } from './ipc/git';
import { registerFsHandlers } from './ipc/fs';
import { registerPtyHandlers, killAllPty as _killAllPty } from './ipc/pty';
import { registerScaffoldHandlers } from './ipc/scaffold';
import { registerUsageHandlers } from './ipc/usage';
import { registerEnvHandlers } from './ipc/env';
import { registerTouchInputHandlers } from './ipc/touch-input';
import { registerCaptureHandlers } from './ipc/capture';
import { registerBillingHandlers } from './ipc/billing';

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  registerWindowHandlers(mainWindow);
  registerStoreHandlers();
  registerProjectHandlers();
  registerGitHandlers();
  registerFsHandlers(mainWindow);
  registerPtyHandlers(mainWindow);
  registerScaffoldHandlers();
  registerUsageHandlers();
  registerEnvHandlers();
  registerTouchInputHandlers();
  registerCaptureHandlers();
  registerBillingHandlers();
}

export const killAllPty = _killAllPty;
