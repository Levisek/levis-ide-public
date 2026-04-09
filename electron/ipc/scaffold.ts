import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import simpleGit from 'simple-git';
import log from 'electron-log';

export function registerScaffoldHandlers(): void {
  ipcMain.handle('scaffold:create', async (_event, projectName: string, targetDir: string, templateRepo?: string) => {
    try {
      const dest = path.join(targetDir, projectName);
      fs.mkdirSync(dest, { recursive: true });

      // Plain HTML — lokální skeleton, žádný degit
      if (templateRepo === '__plain__') {
        fs.writeFileSync(path.join(dest, 'index.html'),
`<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projectName}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>${projectName}</h1>
  <script src="main.js"></script>
</body>
</html>
`);
        fs.writeFileSync(path.join(dest, 'style.css'),
`* { box-sizing: border-box; }
body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; }
h1 { color: #ff6a00; }
`);
        fs.writeFileSync(path.join(dest, 'main.js'),
`console.log('${projectName} ready');\n`);
      } else {
        const degit = require('degit');
        const repo = templateRepo || 'vitejs/vite/packages/create-vite/template-vanilla';
        const emitter = degit(repo, { cache: false, force: true });
        await emitter.clone(dest);
      }

      // .gitignore — vždy přidat .levis-tmp/
      const giPath = path.join(dest, '.gitignore');
      const giExisting = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '';
      if (!giExisting.includes('.levis-tmp')) {
        fs.writeFileSync(giPath, giExisting + (giExisting && !giExisting.endsWith('\n') ? '\n' : '') + '.levis-tmp/\n');
      }

      const git = simpleGit(dest);
      await git.init();
      log.info(`Project scaffolded: ${dest}`);
      return { success: true, path: dest };
    } catch (err) {
      log.error('Scaffold failed:', err);
      return { error: String(err) };
    }
  });
}
