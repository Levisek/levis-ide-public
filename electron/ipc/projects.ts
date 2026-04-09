import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import simpleGit from 'simple-git';
import log from 'electron-log';
import { store } from '../store';

interface ProjectInfo {
  name: string;
  path: string;
  domain: string;
  lastModified: string;
  gitStatus: 'clean' | 'dirty' | 'error';
  unpushedCount: number;
  pinned: boolean;
}

// Vraci nejvyssi mtime z relevantnich kandidatu — odolne vuci tomu, ze
// adresarove mtime na Windows se nemeni pri editaci souboru uvnitr.
function getProjectActivity(projectPath: string): Date | null {
  const candidates: string[] = [
    path.join(projectPath, '.git', 'index'),
    path.join(projectPath, '.git', 'HEAD'),
    path.join(projectPath, 'package.json'),
    projectPath,
  ];
  let best: number = 0;
  for (const c of candidates) {
    try {
      const ms = fs.statSync(c).mtime.getTime();
      if (ms > best) best = ms;
    } catch {}
  }
  return best > 0 ? new Date(best) : null;
}

export function registerProjectHandlers(): void {
  // ── Scan projects ───────────────────────
  ipcMain.handle('projects:scan', async (_event, scanPath: string) => {
    const projects: ProjectInfo[] = [];
    const pinnedSet = new Set<string>(((store as any).get('pinnedProjects') as string[]) || []);
    try {
      const entries = fs.readdirSync(scanPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const projectPath = path.join(scanPath, entry.name);
        const skipDirs = ['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information'];
        if (skipDirs.includes(entry.name) || entry.name.startsWith('.')) continue;

        let name = entry.name;
        let domain = '';

        const pkgPath = path.join(projectPath, 'package.json');
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            if (pkg.name) name = pkg.name;
            if (typeof pkg.homepage === 'string') domain = pkg.homepage;
          } catch {}
        }

        let lastModified = '';
        try {
          const activity = getProjectActivity(projectPath);
          if (activity) lastModified = activity.toISOString();
        } catch {}

        let gitStatus: 'clean' | 'dirty' | 'error' = 'error';
        let unpushedCount = 0;
        try {
          const git = simpleGit(projectPath);
          const isRepo = await git.checkIsRepo();
          if (isRepo) {
            const status = await git.status();
            gitStatus = status.isClean() ? 'clean' : 'dirty';
            unpushedCount = status.ahead;
          }
        } catch {}

        projects.push({ name, path: projectPath, domain, lastModified, gitStatus, unpushedCount, pinned: pinnedSet.has(projectPath) });
      }
    } catch (err) {
      log.error('Failed to scan projects:', err);
    }
    return projects;
  });

  // ── Generate CLAUDE.md for project ────
  ipcMain.handle('project:generateClaudeMd', async (_event, projectPath: string) => {
    try {
      const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
      if (fs.existsSync(claudeMdPath)) {
        return { exists: true, path: claudeMdPath };
      }

      let projectType = 'generic';
      let projectName = path.basename(projectPath);
      const files = fs.readdirSync(projectPath);

      const hasPkg = files.includes('package.json');
      let pkg: any = {};

      if (hasPkg) {
        try { pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8')); } catch {}
        projectName = pkg.name || projectName;
      }

      if (pkg.dependencies?.expo) projectType = 'expo';
      else if (pkg.dependencies?.next) projectType = 'nextjs';
      else if (pkg.dependencies?.electron) projectType = 'electron';
      else if (files.includes('index.html')) projectType = 'vanilla';

      const rules: string[] = [
        `# ${projectName}`,
        '',
        `## Typ projektu: ${projectType}`,
        '',
        '## Pravidla pro Claude Code',
        '',
        '- Bud strucny, ukazuj jen zmenene casti kodu',
        '- Neprepisuj cele soubory, pouzij Edit tool',
        '- Pred kazdou zmenou precti soubor, at vidis aktualni stav',
        '- Commit message pis cesky',
      ];

      if (projectType === 'expo') {
        rules.push(
          '- React Native + Expo — pouzivej hooks a funkcionalni komponenty',
          '- Styly pres StyleSheet.create, ne inline',
          '- Testuj na Android i iOS',
          `- SDK: ${pkg.dependencies?.expo || 'latest'}`,
        );
      } else if (projectType === 'nextjs') {
        rules.push(
          '- Next.js App Router — preferuj Server Components',
          '- Tailwind pro styly',
          '- Supabase pro DB (pokud existuje lib/db/)',
        );
      }

      rules.push('', '## Struktura', '');

      const topLevel = files.filter(f => !f.startsWith('.') && f !== 'node_modules').slice(0, 20);
      for (const f of topLevel) {
        const isDir = fs.statSync(path.join(projectPath, f)).isDirectory();
        rules.push(`- ${isDir ? f + '/' : f}`);
      }

      fs.writeFileSync(claudeMdPath, rules.join('\n'), 'utf-8');
      log.info(`Generated CLAUDE.md for ${projectPath}`);
      return { success: true, path: claudeMdPath };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // ── Pinned projects ─────────────────────
  ipcMain.handle('projects:getPinned', async () => {
    return ((store as any).get('pinnedProjects') as string[]) || [];
  });

  ipcMain.handle('projects:togglePin', async (_e, projectPath: string) => {
    const list: string[] = ((store as any).get('pinnedProjects') as string[]) || [];
    const idx = list.indexOf(projectPath);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(projectPath);
    (store as any).set('pinnedProjects', list);
    return list.includes(projectPath);
  });

  // ── Per-project workspace preferences (swap, etc.) ──
  ipcMain.handle('projects:getPrefs', async (_e, projectPath: string) => {
    const all = ((store as any).get('projectPrefs') as Record<string, any>) || {};
    return all[projectPath] || {};
  });

  ipcMain.handle('projects:setPref', async (_e, projectPath: string, key: string, value: any) => {
    const all = ((store as any).get('projectPrefs') as Record<string, any>) || {};
    all[projectPath] = { ...(all[projectPath] || {}), [key]: value };
    (store as any).set('projectPrefs', all);
  });
}
