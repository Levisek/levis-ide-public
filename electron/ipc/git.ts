import { ipcMain } from 'electron';
import simpleGit from 'simple-git';
import { isPathAllowed } from './safe-path';

export function registerGitHandlers(): void {
  ipcMain.handle('git:status', async (_event, projectPath: string) => {
    if (!isPathAllowed(projectPath)) return { error: 'Path not allowed' };
    try {
      const git = simpleGit(projectPath);
      // Timeout 4 s aby never-resolve git nezamrazil renderer
      return await Promise.race([
        git.status(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('git status timeout')), 4000)),
      ]);
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('git:pull', async (_event, projectPath: string) => {
    if (!isPathAllowed(projectPath)) return { error: 'Path not allowed' };
    const git = simpleGit(projectPath);
    try {
      return await git.pull();
    } catch (err) {
      const raw = String(err);
      // Žádný upstream → zkus auto-nastavit origin/<current> a pull znovu
      if (/no tracking information|no remote tracking/i.test(raw)) {
        try {
          const status = await git.status();
          const branch = status.current;
          if (!branch) return { error: 'Nepodařilo se zjistit aktuální větev.' };
          const remotes = await git.getRemotes(true);
          const origin = remotes.find(r => r.name === 'origin');
          if (!origin) return { error: 'Repozitář nemá nastavený remote (origin). Nejdřív přidej GitHub remote.' };
          // Nastavit upstream a pull
          await git.branch(['--set-upstream-to=origin/' + branch, branch]);
          const result = await git.pull();
          return result;
        } catch (err2) {
          const raw2 = String(err2);
          if (/couldn't find remote ref|does not appear to be a git repository|Couldn't find remote ref/i.test(raw2)) {
            return { error: `Větev "${(await git.status()).current}" neexistuje na remote (origin). Nejdřív ji pushni: git push -u origin <branch>.` };
          }
          return { error: 'Pull selhal i po nastavení upstream: ' + raw2 };
        }
      }
      // Další běžné případy → česky
      if (/Could not resolve host|unable to access/i.test(raw)) {
        return { error: 'Bez připojení k internetu nebo GitHub není dostupný.' };
      }
      if (/Authentication failed|could not read Username/i.test(raw)) {
        return { error: 'Přihlášení k GitHubu selhalo. Zkontroluj git credentials.' };
      }
      if (/merge conflict|CONFLICT/i.test(raw)) {
        return { error: 'Konflikt při merge. Vyřeš ručně v terminálu.' };
      }
      if (/local changes.*would be overwritten|unstaged changes/i.test(raw)) {
        return { error: 'Máš necommitnuté lokální změny, které by pull přepsal. Nejdřív je commitni nebo stash.' };
      }
      return { error: raw };
    }
  });

  ipcMain.handle('git:log', async (_event, projectPath: string, count: number = 20) => {
    if (!isPathAllowed(projectPath)) return { error: 'Path not allowed' };
    try {
      const git = simpleGit(projectPath);
      return await git.log({ maxCount: count });
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('git:diff', async (_event, projectPath: string) => {
    if (!isPathAllowed(projectPath)) return { error: 'Path not allowed' };
    try {
      const git = simpleGit(projectPath);
      return await git.diff();
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('git:diffStaged', async (_event, projectPath: string) => {
    if (!isPathAllowed(projectPath)) return { error: 'Path not allowed' };
    try {
      const git = simpleGit(projectPath);
      return await git.diff(['--staged']);
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('git:commit', async (_event, projectPath: string, message: string, push: boolean = false) => {
    if (!isPathAllowed(projectPath)) return { error: 'Path not allowed' };
    try {
      const git = simpleGit(projectPath);
      await git.add('.');
      const commitResult = await git.commit(message);
      if (push) {
        try { await git.push(); } catch (pushErr) { return { success: true, commit: commitResult, pushError: String(pushErr) }; }
      }
      return { success: true, commit: commitResult };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('git:push', async (_event, projectPath: string) => {
    if (!isPathAllowed(projectPath)) return { error: 'Path not allowed' };
    try {
      const git = simpleGit(projectPath);
      const r = await git.push();
      return { success: true, result: r };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // Stash všech změn včetně untracked — bezpečná alternativa k discardu.
  // User může kdykoli vrátit přes `git stash pop`.
  ipcMain.handle('git:stash', async (_event, projectPath: string) => {
    if (!isPathAllowed(projectPath)) return { error: 'Path not allowed' };
    try {
      const git = simpleGit(projectPath);
      const msg = `levis-quit-check ${new Date().toISOString()}`;
      await git.raw(['stash', 'push', '--include-untracked', '-m', msg]);
      return { success: true, message: msg };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // ── Checkpoint / Revert ──

  ipcMain.handle('git:revparse', async (_event, projectPath: string) => {
    if (!isPathAllowed(projectPath)) return { error: 'Path not allowed' };
    try {
      const git = simpleGit(projectPath);
      return (await git.revparse(['HEAD'])).trim();
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('git:resetHard', async (_event, projectPath: string, hash: string) => {
    if (!isPathAllowed(projectPath)) return { error: 'Path not allowed' };
    try {
      const git = simpleGit(projectPath);
      await git.reset(['--hard', hash]);
      return { success: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('git:diffRange', async (_event, projectPath: string, fromHash: string) => {
    if (!isPathAllowed(projectPath)) return { error: 'Path not allowed' };
    try {
      const git = simpleGit(projectPath);
      const stat = await git.diffSummary([fromHash, 'HEAD']);
      return { files: stat.files.length, insertions: stat.insertions, deletions: stat.deletions };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('git:recentFiles', async (_event, projectPath: string) => {
    if (!isPathAllowed(projectPath)) return [];
    try {
      const git = simpleGit(projectPath);
      const log = await Promise.race([
        git.log({ maxCount: 15, '--diff-filter': 'M', '--name-only': null }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 500)),
      ]);
      const seen = new Set<string>();
      const result: string[] = [];
      for (const entry of (log as any).all || []) {
        const body = (entry as any).body || (entry as any).diff?.files?.map((f: any) => f.file) || [];
        // git log --name-only puts filenames in body field
        const names = typeof body === 'string' ? body.split('\n').filter((l: string) => l.trim()) : (Array.isArray(body) ? body : []);
        for (const name of names) {
          if (name && !seen.has(name) && !name.startsWith('.') && !name.includes('node_modules')) {
            seen.add(name);
            result.push(name);
            if (result.length >= 3) return result;
          }
        }
      }
      return result;
    } catch {
      return [];
    }
  });
}
