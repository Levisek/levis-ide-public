import { ipcMain, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import log from 'electron-log';

const DUMP_SCRIPT_NAME = 'levis-usage-dump.js';
const SCRIPTS_DIR = path.join(os.homedir(), '.claude', 'scripts');
const SCRIPT_PATH = path.join(SCRIPTS_DIR, DUMP_SCRIPT_NAME);
const DUMP_FILE = path.join(os.homedir(), '.claude', 'levis-usage.json');
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const SETTINGS_BACKUP = path.join(os.homedir(), '.claude', 'settings.levis-backup.json');
const WRAPPER_CFG = path.join(os.homedir(), '.claude', 'levis-wrapper.json');

interface HookStatus {
  scriptInstalled: boolean;
  ourHookActive: boolean;
  hasOtherStatusline: boolean;
  otherStatuslineCmd: string | null;
  dumpAgeMs: number | null;
  wrapperActive: boolean;
}

function getBundledScriptPath(): string {
  // Packaged (asar): app.getAppPath() → …/resources/app.asar; soubor pak čteme přes fs i z asaru
  const candidates = [
    path.join(__dirname, '..', 'scripts', DUMP_SCRIPT_NAME),          // dist/electron/scripts?
    path.join(__dirname, '..', '..', 'electron', 'scripts', DUMP_SCRIPT_NAME),
    path.join(app.getAppPath(), 'electron', 'scripts', DUMP_SCRIPT_NAME),
    path.join(app.getAppPath(), 'dist', 'electron', 'scripts', DUMP_SCRIPT_NAME),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return candidates[1];
}

function readSettings(): any {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { return {}; }
}

function writeSettings(s: any): void {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
}

function getStatus(): HookStatus {
  const scriptInstalled = fs.existsSync(SCRIPT_PATH);
  const settings = readSettings();
  const currentCmd: string = settings?.statusLine?.command || '';
  const ourHookActive = scriptInstalled && currentCmd.includes(DUMP_SCRIPT_NAME);
  const hasOtherStatusline = !ourHookActive && !!currentCmd;

  let dumpAgeMs: number | null = null;
  try {
    const st = fs.statSync(DUMP_FILE);
    dumpAgeMs = Date.now() - st.mtimeMs;
  } catch {}

  let wrapperActive = false;
  try {
    const cfg = JSON.parse(fs.readFileSync(WRAPPER_CFG, 'utf8'));
    wrapperActive = !!cfg?.innerCommand;
  } catch {}

  return {
    scriptInstalled,
    ourHookActive,
    hasOtherStatusline,
    otherStatuslineCmd: hasOtherStatusline ? currentCmd : null,
    dumpAgeMs,
    wrapperActive,
  };
}

function copyScript(): void {
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  const src = getBundledScriptPath();
  const content = fs.readFileSync(src, 'utf8');
  fs.writeFileSync(SCRIPT_PATH, content);
}

export function registerBillingHandlers(): void {
  ipcMain.handle('billing:getHookStatus', () => getStatus());

  ipcMain.handle('billing:installHook', async (_e, opts: { wrapExisting?: boolean } = {}) => {
    try {
      copyScript();

      // Backup settings (jednou — první instalace si uloží originál)
      if (fs.existsSync(SETTINGS_PATH) && !fs.existsSync(SETTINGS_BACKUP)) {
        fs.copyFileSync(SETTINGS_PATH, SETTINGS_BACKUP);
      }

      const settings = readSettings();
      const currentCmd: string = settings?.statusLine?.command || '';
      const alreadyOurs = currentCmd.includes(DUMP_SCRIPT_NAME);

      if (opts.wrapExisting && currentCmd && !alreadyOurs) {
        fs.writeFileSync(WRAPPER_CFG, JSON.stringify({ innerCommand: currentCmd }, null, 2));
      } else if (!opts.wrapExisting) {
        // Replace režim → odstraň wrapper config, kdyby existoval
        try { fs.unlinkSync(WRAPPER_CFG); } catch {}
      }

      const padding = settings?.statusLine?.padding ?? 0;
      settings.statusLine = {
        type: 'command',
        command: `node "${SCRIPT_PATH}"`,
        padding,
      };
      writeSettings(settings);

      return { success: true, status: getStatus() };
    } catch (e: any) {
      log.error('billing:installHook failed:', e);
      return { success: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle('billing:uninstallHook', async () => {
    try {
      let restored = false;
      const current = readSettings();

      if (fs.existsSync(SETTINGS_BACKUP)) {
        try {
          const backup = JSON.parse(fs.readFileSync(SETTINGS_BACKUP, 'utf8'));
          if (backup?.statusLine) current.statusLine = backup.statusLine;
          else delete current.statusLine;
          writeSettings(current);
          restored = true;
        } catch {}
      }
      if (!restored) {
        // Pokud nemáme backup, jen odstraníme náš statusLine
        if (current?.statusLine?.command?.includes(DUMP_SCRIPT_NAME)) {
          delete current.statusLine;
          writeSettings(current);
        }
      }

      try { fs.unlinkSync(SCRIPT_PATH); } catch {}
      try { fs.unlinkSync(WRAPPER_CFG); } catch {}

      return { success: true, restored, status: getStatus() };
    } catch (e: any) {
      log.error('billing:uninstallHook failed:', e);
      return { success: false, error: String(e?.message || e) };
    }
  });
}
