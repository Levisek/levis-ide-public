import { ipcMain, clipboard, nativeImage, app, shell } from 'electron';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { isPathAllowed } from './safe-path';

// Detekce Claude Code CLI — hledáme v PATH + známých lokacích native/npm installeru.
// Vrací {installed, version, path, source} pro onboarding wizard.
type CcSource = 'native' | 'npm' | 'path' | null;
interface CcDetection {
  installed: boolean;
  version: string | null;
  path: string | null;
  source: CcSource;
}

function tryClaudeVersion(cmd: string): Promise<{ ok: boolean; version: string | null }> {
  return new Promise((resolve) => {
    execFile(cmd, ['--version'], { shell: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve({ ok: false, version: null });
      // stdout typicky: "claude 1.2.3" nebo "@anthropic-ai/claude-code 1.2.3"
      const m = /(\d+\.\d+\.\d+)/.exec(stdout || '');
      resolve({ ok: true, version: m ? m[1] : (stdout || '').trim().slice(0, 40) || null });
    });
  });
}

async function detectClaudeCode(): Promise<CcDetection> {
  // 1. Native installer default (Windows) — %LOCALAPPDATA%\Programs\claude\claude.exe
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

  const candidates: Array<{ path: string; source: CcSource }> = [];
  if (process.platform === 'win32') {
    candidates.push(
      { path: path.join(localAppData, 'Programs', 'claude', 'claude.exe'), source: 'native' },
      { path: path.join(localAppData, 'claude', 'bin', 'claude.exe'), source: 'native' },
      { path: path.join(appData, 'npm', 'claude.cmd'), source: 'npm' },
    );
  } else {
    candidates.push(
      { path: path.join(home, '.local', 'bin', 'claude'), source: 'native' },
      { path: '/usr/local/bin/claude', source: 'native' },
      { path: '/opt/homebrew/bin/claude', source: 'native' },
      { path: path.join(home, '.npm-global', 'bin', 'claude'), source: 'npm' },
    );
  }

  for (const c of candidates) {
    if (fs.existsSync(c.path)) {
      const v = await tryClaudeVersion(`"${c.path}"`);
      if (v.ok) return { installed: true, version: v.version, path: c.path, source: c.source };
    }
  }

  // 2. Fallback: hledat `claude` v PATH
  const pathCmd = process.platform === 'win32' ? 'claude' : 'claude';
  const v = await tryClaudeVersion(pathCmd);
  if (v.ok) return { installed: true, version: v.version, path: pathCmd, source: 'path' };

  return { installed: false, version: null, path: null, source: null };
}

export function registerEnvHandlers(): void {
  ipcMain.handle('env:homeDir', () => os.homedir());
  ipcMain.handle('env:appVersion', () => app.getVersion());
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(text));

  // Čtení obrázku z clipboardu — uloží PNG do .levis-tmp/ uvnitř projectPath, vrátí cestu
  ipcMain.handle('clipboard:readImage', (_e, projectPath: string) => {
    if (!isPathAllowed(projectPath)) return null;
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

  // Claude Code detekce — pro onboarding wizard
  ipcMain.handle('cc:detect', async () => {
    return await detectClaudeCode();
  });

  // Spustit PowerShell install skript pro CC native installer (Windows only)
  // Vrací cwd s PTY id — renderer může sledovat output přes standardní pty:data broadcast
  ipcMain.handle('cc:installCommand', () => {
    if (process.platform === 'win32') {
      return {
        cmd: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"\r',
        docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
      };
    }
    // macOS / Linux (pro budoucnost)
    return {
      cmd: 'curl -fsSL https://claude.ai/install.sh | sh\n',
      docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
    };
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
