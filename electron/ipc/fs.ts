import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { isPathAllowed } from './safe-path';

export function registerFsHandlers(mainWindow: BrowserWindow): void {
  // Project-wide search — fulltext search v textových souborech.
  // Vrací max 200 hitů. Skipuje binary, node_modules, .git, dist, build.
  ipcMain.handle('fs:projectSearch', async (_event, rootPath: string, query: string, opts: { caseSensitive?: boolean; regex?: boolean } = {}) => {
    if (!isPathAllowed(rootPath)) return [];
    if (!query) return [];
    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out', 'target', '.cache', '.levis-tmp', '.vscode', '.idea']);
    const TEXT_EXTS = new Set([
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.html', '.htm',
      '.css', '.scss', '.sass', '.less', '.md', '.txt', '.xml', '.svg', '.yml', '.yaml',
      '.toml', '.ini', '.env', '.sh', '.py', '.rb', '.php', '.go', '.rs', '.java',
      '.kt', '.swift', '.c', '.cpp', '.h', '.hpp', '.lua', '.sql', '.vue', '.svelte', '.astro',
    ]);
    const MAX_HITS = 200;
    const MAX_FILE_SIZE = 1024 * 512; // 512 KB

    let pattern: RegExp;
    try {
      if (opts.regex) {
        pattern = new RegExp(query, opts.caseSensitive ? 'g' : 'gi');
      } else {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pattern = new RegExp(escaped, opts.caseSensitive ? 'g' : 'gi');
      }
    } catch {
      return [];
    }

    const hits: Array<{ path: string; rel: string; line: number; col: number; preview: string }> = [];
    function walk(dir: string, depth: number): void {
      if (depth > 8 || hits.length >= MAX_HITS) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (hits.length >= MAX_HITS) return;
        if (e.name.startsWith('.') && depth === 0) continue;
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue;
          walk(path.join(dir, e.name), depth + 1);
        } else if (e.isFile()) {
          const ext = path.extname(e.name).toLowerCase();
          if (!TEXT_EXTS.has(ext)) continue;
          const full = path.join(dir, e.name);
          try {
            const stat = fs.statSync(full);
            if (stat.size > MAX_FILE_SIZE) continue;
            const content = fs.readFileSync(full, 'utf-8');
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              if (hits.length >= MAX_HITS) return;
              pattern.lastIndex = 0;
              const m = pattern.exec(lines[i]);
              if (m) {
                hits.push({
                  path: full,
                  rel: path.relative(rootPath, full).replace(/\\/g, '/'),
                  line: i + 1,
                  col: m.index + 1,
                  preview: lines[i].substring(0, 200),
                });
              }
            }
          } catch {}
        }
      }
    }
    try { walk(rootPath, 0); } catch {}
    return hits;
  });

  // Project-wide replace — pro každý hit nahradí query za replacement v souborech.
  // Vrací počet nahrazených výskytů.
  ipcMain.handle('fs:projectReplace', async (_event, rootPath: string, query: string, replacement: string, opts: { caseSensitive?: boolean; regex?: boolean; targetFiles?: string[] } = {}) => {
    if (!isPathAllowed(rootPath)) return { error: 'Path not allowed', count: 0 };
    if (!query) return { count: 0 };
    let pattern: RegExp;
    try {
      if (opts.regex) {
        pattern = new RegExp(query, opts.caseSensitive ? 'g' : 'gi');
      } else {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pattern = new RegExp(escaped, opts.caseSensitive ? 'g' : 'gi');
      }
    } catch (err) {
      return { error: 'Invalid regex', count: 0 };
    }
    let count = 0;
    const files = opts.targetFiles && opts.targetFiles.length > 0
      ? opts.targetFiles.filter(f => isPathAllowed(f))
      : [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const newContent = content.replace(pattern, replacement);
        if (newContent !== content) {
          // Spočítej nahrazení
          const matches = content.match(pattern);
          if (matches) count += matches.length;
          fs.writeFileSync(file, newContent, 'utf-8');
        }
      } catch {}
    }
    return { count };
  });

  // Snapshot mtimů asset souborů (html/css/js/...) v adresáři — pro artifact watch.
  // Vrací string ve tvaru "name:mtime|name:mtime|..." který se srovnává s předchozím.
  ipcMain.handle('fs:projectAssetsHash', async (_event, rootDir: string) => {
    if (!isPathAllowed(rootDir)) return '';
    const ASSET_EXTS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg']);
    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.cache', '.levis-tmp']);
    const parts: string[] = [];
    function walk(dir: string, depth: number): void {
      if (depth > 4) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue;
          walk(path.join(dir, e.name), depth + 1);
        } else if (e.isFile()) {
          const ext = path.extname(e.name).toLowerCase();
          if (!ASSET_EXTS.has(ext)) continue;
          try {
            const st = fs.statSync(path.join(dir, e.name));
            parts.push(`${e.name}:${st.mtimeMs}`);
          } catch {}
        }
      }
    }
    try { walk(rootDir, 0); } catch {}
    return parts.join('|');
  });

  // Rekurzivní listing souborů (pro Ctrl+P quick file open).
  // Limit na 5000 souborů a 6 úrovní hloubky aby to nezatuhlo na velkých projektech.
  ipcMain.handle('fs:listFilesRecursive', async (_event, rootPath: string) => {
    if (!isPathAllowed(rootPath)) return { error: 'Path not allowed' };
    const files: Array<{ path: string; rel: string; name: string }> = [];
    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out', 'target', '.cache', '.levis-tmp']);
    const MAX_FILES = 5000;
    const MAX_DEPTH = 8;
    function walk(dir: string, depth: number): void {
      if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') && depth === 0) continue;
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue;
          walk(path.join(dir, e.name), depth + 1);
        } else if (e.isFile()) {
          if (files.length >= MAX_FILES) return;
          const full = path.join(dir, e.name);
          const rel = path.relative(rootPath, full).replace(/\\/g, '/');
          files.push({ path: full, rel, name: e.name });
        }
      }
    }
    try { walk(rootPath, 0); } catch {}
    return files;
  });

  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    if (!isPathAllowed(dirPath)) return { error: 'Path not allowed' };
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
        .map(e => ({
          name: e.name,
          path: path.join(dirPath, e.name),
          isDirectory: e.isDirectory(),
        }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } catch (err) {
      return [];
    }
  });

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    if (!isPathAllowed(filePath)) return { error: 'Path not allowed' };
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    if (!isPathAllowed(filePath)) return { error: 'Path not allowed' };
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('fs:getLanguage', async (_event, filePath: string) => {
    const ext = path.extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
      '.json': 'json', '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'scss',
      '.md': 'markdown', '.py': 'python', '.php': 'php', '.rs': 'rust', '.go': 'go',
      '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.sh': 'shell',
      '.yml': 'yaml', '.yaml': 'yaml', '.xml': 'xml', '.sql': 'sql',
      '.txt': 'plaintext', '.env': 'plaintext', '.gitignore': 'plaintext',
    };
    return langMap[ext] || 'plaintext';
  });

  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Project management — destrukivní operace, vždy přes safe-path check
  ipcMain.handle('fs:deleteProject', async (_event, projectPath: string) => {
    if (!isPathAllowed(projectPath)) return { error: 'Path not allowed' };
    try {
      // Bezpečnost: nemažeme drive root nebo příliš krátké cesty
      if (!projectPath || projectPath.length < 6) return { error: 'Path too short' };
      fs.rmSync(projectPath, { recursive: true, force: true });
      return { success: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('fs:renameProject', async (_event, oldPath: string, newName: string) => {
    if (!isPathAllowed(oldPath)) return { error: 'Path not allowed' };
    try {
      const parent = path.dirname(oldPath);
      const newPath = path.join(parent, newName);
      if (fs.existsSync(newPath)) return { error: 'Cílový název už existuje' };
      fs.renameSync(oldPath, newPath);
      return { success: true, path: newPath };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('fs:duplicateProject', async (_event, sourcePath: string, newName: string) => {
    if (!isPathAllowed(sourcePath)) return { error: 'Path not allowed' };
    try {
      const parent = path.dirname(sourcePath);
      const destPath = path.join(parent, newName);
      if (fs.existsSync(destPath)) return { error: 'Cílový název už existuje' };
      // Recursive copy bez node_modules a .git, ignoruje symlinky
      function copyRec(src: string, dst: string): void {
        const st = fs.lstatSync(src);
        if (st.isSymbolicLink()) return; // bezpečnost: symlinky NEnásledujeme
        if (st.isDirectory()) {
          const base = path.basename(src);
          if (base === 'node_modules' || base === '.git' || base === '.levis-tmp') return;
          fs.mkdirSync(dst, { recursive: true });
          for (const f of fs.readdirSync(src)) copyRec(path.join(src, f), path.join(dst, f));
        } else if (st.isFile()) {
          fs.copyFileSync(src, dst);
        }
      }
      copyRec(sourcePath, destPath);
      return { success: true, path: destPath };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('fs:deleteFile', async (_event, filePath: string) => {
    if (!isPathAllowed(filePath)) return { error: 'Path not allowed' };
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      }
      return { success: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // Otevřít https/http URL v defaultním prohlížeči (pro About → GitHub link apod.)
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) return { error: 'Only http(s) URLs allowed' };
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
    if (!isPathAllowed(targetPath)) return { error: 'Path not allowed' };
    // Zákaz URL — shell.openPath umí otevřít file paths, pro URL je openExternal
    if (/^[a-z][a-z0-9+.\-]*:\/\//i.test(targetPath)) return { error: 'URLs not allowed via shell:openPath' };
    try {
      const err = await shell.openPath(targetPath);
      return err ? { error: err } : { success: true };
    } catch (err) {
      return { error: String(err) };
    }
  });
}
