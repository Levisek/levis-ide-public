// ── Workspace (project tab layout) ──────

interface WorkspaceInstance {
  element: HTMLElement;
  getActiveTerminals: () => Array<{ label: string; state: 'idle' | 'working' | 'waiting' }>;
  onCCDone: (cb: () => void) => () => void;
  onCCStateChange: (cb: (state: string) => void) => () => void;
  hasUnsavedChanges: () => boolean;
  getDirtyFiles: () => string[];
  // Otevřít soubor v editoru (pro Ctrl+P quick file open)
  openFile: (filePath: string) => Promise<void>;
  dispose: () => void;
}

type RightPanel = 'browser' | 'hidden';
type WsPanelId = 'terminal' | 'editor' | 'diff' | 'browser';

function panelLabel(panel: WsPanelId): { icon: string; text: string } {
  const I = (window as any).icon;
  switch (panel) {
    case 'terminal': return { icon: I('terminal'), text: t('ws.terminal') };
    case 'editor':   return { icon: I('editor'),   text: t('ws.editor') };
    case 'diff':     return { icon: I('git'),      text: t('ws.diff') };
    case 'browser':  return { icon: I('browser'),  text: t('ws.browser') };
  }
}
const PANEL_LABELS = new Proxy({} as Record<WsPanelId, { icon: string; text: string }>, {
  get: (_t, p: string) => panelLabel(p as WsPanelId),
});

type AutostartEntry = {
  cmd: string | null;
  scriptName?: string;
  port: number | null;
};

const AUTOSTART: Record<string, AutostartEntry> = {
  // Node
  next:       { cmd: 'npm run dev', scriptName: 'dev', port: 3000 },
  vite:       { cmd: 'npm run dev', scriptName: 'dev', port: 5173 },
  react:      { cmd: 'npm run dev', scriptName: 'dev', port: 3000 },
  astro:      { cmd: 'npm run dev', scriptName: 'dev', port: 4321 },
  nuxt:       { cmd: 'npm run dev', scriptName: 'dev', port: 3000 },
  svelte:     { cmd: 'npm run dev', scriptName: 'dev', port: 5173 },
  angular:    { cmd: 'npm start',   scriptName: 'start', port: 4200 },
  remix:      { cmd: 'npm run dev', scriptName: 'dev', port: 3000 },
  gatsby:     { cmd: 'npm run develop', scriptName: 'develop', port: 8000 },
  nest:       { cmd: 'npm run start:dev', scriptName: 'start:dev', port: 3000 },
  expo:       { cmd: "$env:BROWSER='none'; npm run web", scriptName: 'web', port: 8081 },
  deno:       { cmd: 'deno task dev', port: null },
  bun:        { cmd: 'bun dev', port: 3000 },
  node:       { cmd: 'npm start', scriptName: 'start', port: 3000 },
  electron:   { cmd: null, port: null },
  tauri:      { cmd: null, port: null },
  // Python
  django:     { cmd: 'python manage.py runserver', port: 8000 },
  flask:      { cmd: 'python app.py', port: 5000 },
  fastapi:    { cmd: 'uvicorn main:app --reload', port: 8000 },
  streamlit:  { cmd: 'streamlit run app.py', port: 8501 },
  gradio:     { cmd: 'python app.py', port: 7860 },
  python:     { cmd: null, port: null },
  // PHP
  laravel:    { cmd: 'php artisan serve', port: 8000 },
  symfony:    { cmd: 'symfony server:start', port: 8000 },
  wordpress:  { cmd: null, port: null },
  php:        { cmd: 'php -S localhost:8000', port: 8000 },
  // Ruby / Rails
  rails:      { cmd: 'bin/rails server', port: 3000 },
  ruby:       { cmd: null, port: null },
  // Compiled
  go:         { cmd: null, port: null },
  rust:       { cmd: null, port: null },
  dotnet:     { cmd: 'dotnet run', port: 5000 },
  spring:     { cmd: './mvnw spring-boot:run', port: 8080 },
  java:       { cmd: null, port: null },
  kotlin:     { cmd: null, port: null },
  elixir:     { cmd: null, port: null },
  phoenix:    { cmd: 'mix phx.server', port: 4000 },
  crystal:    { cmd: null, port: null },
  haskell:    { cmd: null, port: null },
  ocaml:      { cmd: null, port: null },
  zig:        { cmd: null, port: null },
  nim:        { cmd: null, port: null },
  // SSG
  hugo:       { cmd: 'hugo server', port: 1313 },
  jekyll:     { cmd: 'bundle exec jekyll serve', port: 4000 },
  mkdocs:     { cmd: 'mkdocs serve', port: 8000 },
  docusaurus: { cmd: 'npm start', scriptName: 'start', port: 3000 },
  vitepress:  { cmd: 'npm run docs:dev', scriptName: 'docs:dev', port: 5173 },
  // Ostatní
  docker:     { cmd: 'docker compose up', port: null },
  flutter:    { cmd: 'flutter run -d chrome', port: null },
  jupyter:    { cmd: 'jupyter lab', port: 8888 },
  static:     { cmd: null, port: null },
  other:      { cmd: null, port: null },
};

const PORT_PROBE_TIMEOUT_MS = 120_000; // 2 min — stíhají i pomalé Spring Boot / Next build / Flask DB init

async function probePort(port: number, signal: { aborted: boolean }): Promise<boolean> {
  const deadline = Date.now() + PORT_PROBE_TIMEOUT_MS;
  while (Date.now() < deadline && !signal.aborted) {
    try {
      await fetch(`http://localhost:${port}`, { method: 'GET', mode: 'no-cors' });
      return true;
    } catch {
      await new Promise(res => setTimeout(res, 500));
    }
  }
  return false;
}

interface LaunchCandidate { id: string; label: string; kind: 'dev' | 'static' | 'storybook' }

// Modal picker pro ambiguous launch — tlačítka + "Zapamatovat" checkbox
function askLaunchChoice(candidates: LaunchCandidate[]): Promise<{ id: string; remember: boolean } | null> {
  return new Promise((resolve) => {
    const t = (window as any).t || ((k: string) => k);
    const savedFocus = document.activeElement as HTMLElement | null;
    const overlay = document.createElement('div');
    overlay.className = 'editor-choice-overlay launch-choice-overlay';
    const esc = (s: string) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    overlay.innerHTML = `
      <div class="editor-choice-box launch-choice-box" role="dialog" aria-modal="true">
        <div class="editor-choice-msg">${esc(t('workspace.launch.title'))}</div>
        <div class="launch-choice-list">
          ${candidates.map(c => `<button class="editor-choice-btn launch-choice-btn" data-id="${esc(c.id)}">${esc(c.label)}</button>`).join('')}
        </div>
        <label class="launch-choice-remember">
          <input type="checkbox" class="launch-choice-remember-cb" checked>
          <span>${esc(t('workspace.launch.remember'))}</span>
        </label>
      </div>
    `;
    document.body.appendChild(overlay);
    const buttons = Array.from(overlay.querySelectorAll<HTMLButtonElement>('.launch-choice-btn'));
    const checkbox = overlay.querySelector<HTMLInputElement>('.launch-choice-remember-cb')!;
    const cleanup = (): void => {
      overlay.remove();
      document.removeEventListener('keydown', keyHandler);
      if (savedFocus && typeof savedFocus.focus === 'function') { try { savedFocus.focus(); } catch {} }
    };
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        const remember = checkbox.checked;
        cleanup();
        resolve({ id, remember });
      });
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { cleanup(); resolve(null); }
    });
    const focusable: HTMLElement[] = [...buttons, checkbox];
    const keyHandler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { cleanup(); resolve(null); return; }
      if (e.key === 'Tab') {
        const active = document.activeElement as HTMLElement;
        const idx = focusable.indexOf(active);
        e.preventDefault();
        const next = e.shiftKey
          ? (idx <= 0 ? focusable.length - 1 : idx - 1)
          : (idx < 0 || idx === focusable.length - 1 ? 0 : idx + 1);
        focusable[next].focus();
      }
    };
    document.addEventListener('keydown', keyHandler);
    if (buttons[0]) buttons[0].focus();
  });
}

async function createWorkspace(projectPath: string, projectName: string, projectType?: string): Promise<WorkspaceInstance> {
  const STAGE = (_s: string) => {};
  const wrapper = document.createElement('div');
  wrapper.className = 'workspace';

  // Track all cleanup functions
  const cleanups: (() => void)[] = [];
  // Popout state — pro return-to-workspace
  const poppedPanels = new Set<WsPanelId>();
  const panelPopoutMap = new Map<string, WsPanelId>();

  // ── Workspace toolbar (slim — tab switching už je v lt-tabbar uvnitř leafu) ─
  const wsToolbar = document.createElement('div');
  wsToolbar.className = 'ws-toolbar';
  const I = (window as any).icon;
  wsToolbar.innerHTML = `
    <div class="ws-panel-tabs">
      <button class="ws-panel-tab ws-btn-toggle-sidebar" title="${t('ws.toggleSidebar')}">${I('sidebar')}</button>
      <button class="ws-panel-tab ws-btn-sidebar-side" title="${t('ws.swapSidebar')}">${I('swap')}</button>
      <span class="ws-toolbar-divider"></span>
      <button class="ws-panel-tab ws-btn-add-panel" title="${t('ws.addPanel')}">${I('plus')}</button>
      <button class="ws-panel-tab ws-btn-reset-layout" title="${t('ws.resetLayout')}">${I('refresh')}</button>
      <button class="ws-panel-tab ws-btn-equalize-layout" title="${t('ws.equalize')}">${I('equalize')}</button>
      <button class="ws-panel-tab ws-btn-lock-layout" title="${t('ws.lockLayout')}">${I('lock')}</button>
    </div>
    <span style="flex:1"></span>
    <div class="ws-right-tabs"></div>
  `;
  wrapper.appendChild(wsToolbar);

  // ── Main panels ───────────────────────
  const panels = document.createElement('div');
  panels.className = 'workspace-panels';
  wrapper.appendChild(panels);

  // Sidebar (file tree) — samostatný flex item, lze přehodit L/R přes CSS order
  const sidebarContainer = document.createElement('div');
  sidebarContainer.className = 'ws-sidebar';
  panels.appendChild(sidebarContainer);

  const sidebarSplitter = document.createElement('div');
  sidebarSplitter.className = 'splitter split-handle sidebar-splitter';
  panels.appendChild(sidebarSplitter);

  // Layout-tree root container (drží celý strom panelů)
  const layoutRoot = document.createElement('div');
  layoutRoot.className = 'ws-layout-root';
  layoutRoot.style.flex = '1';
  layoutRoot.style.minWidth = '0';
  layoutRoot.style.overflow = 'hidden';
  panels.appendChild(layoutRoot);

  // Aplikovat sidebarSide preference
  let sidebarSide: 'left' | 'right' = 'left';
  (async () => {
    const saved = await levis.storeGet('sidebarSide');
    if (saved === 'right') {
      sidebarSide = 'right';
      applySidebarSide();
    }
  })();
  function applySidebarSide(): void {
    if (sidebarSide === 'left') {
      sidebarContainer.style.order = '0';
      sidebarSplitter.style.order = '1';
      layoutRoot.style.order = '2';
    } else {
      sidebarContainer.style.order = '99';
      sidebarSplitter.style.order = '98';
      layoutRoot.style.order = '0';
    }
  }
  applySidebarSide();

  // ── Panel root elementy (mountnou se do layout-tree leafů přes mountPanel) ─
  // Drží je tady jako lokální proměnné, ať na ně mají referenci create*() volání níž.
  const termPanel = document.createElement('div');
  termPanel.className = 'panel-terminal';
  termPanel.dataset.panel = 'terminal';

  const editorPanel = document.createElement('div');
  editorPanel.className = 'panel-editor';
  editorPanel.dataset.panel = 'editor';

  const diffPanel = document.createElement('div');
  diffPanel.className = 'panel-diff';
  diffPanel.dataset.panel = 'diff';



  const browserPanel = document.createElement('div');
  browserPanel.className = 'panel-browser';
  browserPanel.dataset.rpanel = 'browser';


  const panelEls: Record<WsPanelId, HTMLElement> = {
    terminal: termPanel,
    editor: editorPanel,
    diff: diffPanel,
    browser: browserPanel,
  };

  // ── Status Bar (replaces CC Bar) ──────
  const statusBar = document.createElement('div');
  statusBar.className = 'status-bar';
  statusBar.innerHTML = `
    <span class="status-project-size" title="${t('ws.projectSize')}"></span>
    <span class="status-dirty" title="Změněné soubory"></span>
    <span class="status-sync" title="Ahead / Behind"></span>
    <span class="status-file-info" title=""></span>
    <span style="flex:1"></span>
    <button class="status-btn status-btn-save" title="${t('ws.takjo')}">${I('save')} ${t('ws.btnSave')}</button>
    <button class="status-btn status-btn-push" title="${t('ws.jeb')}">${I('upload')} ${t('ws.btnSend')}</button>
    <button class="status-btn status-btn-pull" title="${t('ws.gitPull')}">${I('download')} ${t('ws.btnPull')}</button>
    <button class="status-btn status-btn-restart" title="${t('ws.restartCC')}">${I('restart')} ${t('ws.btnCC')}</button>
    <button class="status-btn status-btn-revert" title="${t('ws.revertTooltip')}" disabled>${I('restart')} ↩</button>
    <button class="status-btn status-btn-attach" title="${t('ws.attachFile')}">${I('attach')} ${t('ws.btnAttach')}</button>
    <button class="status-btn status-btn-queue" title="${t('ws.queueTooltip')}" style="display:none">${I('list')} <span class="queue-count">0</span></button>
    <button class="status-btn status-btn-devlog" title="${t('ws.devLogTooltip')}" style="display:none">${I('file')} ${t('ws.btnDevLog')}</button>
  `;
  wrapper.appendChild(statusBar);

  // ── Auto-generate CLAUDE.md ───────────
  levis.generateClaudeMd(projectPath).then((r: any) => {
    if (r.success) showToast(t('toast.claudemdGenerated'), 'info');
  }).catch(() => {});

  // ── Project type detection ─────────────
  let autoCommand: string | undefined = undefined;
  let termCwd = projectPath;



  // ── AUTOSTART resolution ─────────────
  // projectType prijde z hubu (HubProjectInfo.projectType). Pokud chybi, fallback re-detekce.
  let resolvedType: string = projectType || 'other';
  let pkgScripts: Record<string, string> = {};
  try {
    const pkgRaw = await levis.readFile(projectPath + '\\package.json');
    if (typeof pkgRaw === 'string') {
      const pkg = JSON.parse(pkgRaw);
      pkgScripts = pkg.scripts || {};
      if (!projectType) {
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        if (deps.electron) resolvedType = 'electron';
        else if (deps['@tauri-apps/api'] || deps['@tauri-apps/cli']) resolvedType = 'tauri';
        else if (deps.expo) resolvedType = 'expo';
        else if (deps.next) resolvedType = 'next';
        else if (deps.nuxt || deps['nuxt3']) resolvedType = 'nuxt';
        else if (deps.astro) resolvedType = 'astro';
        else if (deps.vite) resolvedType = 'vite';
        else if (deps['@sveltejs/kit'] || deps.svelte) resolvedType = 'svelte';
        else if (deps.react || deps['react-scripts']) resolvedType = 'react';
        else resolvedType = 'node';
      }
    }
  } catch {
    if (!projectType) {
      try {
        const html = await levis.readFile(projectPath + '\\index.html');
        if (typeof html === 'string') resolvedType = 'static';
      } catch {}
      try {
        const php = await levis.readFile(projectPath + '\\index.php');
        if (typeof php === 'string') resolvedType = 'php';
      } catch {}
    }
  }

  const autostartEntry: AutostartEntry = AUTOSTART[resolvedType] || AUTOSTART.other;
  const hasNoPreview = autostartEntry.cmd === null && resolvedType !== 'static';
  const hasStorybook = !!pkgScripts.storybook;

  // ── Deploy URL autodetekce (Vercel, package.json homepage) ──
  let deployUrl = '';
  try {
    const prefs = await levis.getProjectPrefs(projectPath);
    if ((prefs as any)?.previewUrl) deployUrl = (prefs as any).previewUrl;
  } catch {}
  if (!deployUrl) {
    // Vercel: vercel.json → name/alias
    try {
      const vRaw = await levis.readFile(projectPath + '\\vercel.json');
      if (typeof vRaw === 'string') {
        const vc = JSON.parse(vRaw);
        const alias = vc.alias?.[0] || vc.name;
        if (alias) deployUrl = alias.startsWith('http') ? alias : `https://${alias}.vercel.app`;
      }
    } catch {}
  }
  if (!deployUrl) {
    // package.json → homepage (CRA/Vite pattern)
    try {
      const pkgRaw2 = await levis.readFile(projectPath + '\\package.json');
      if (typeof pkgRaw2 === 'string') {
        const pkg2 = JSON.parse(pkgRaw2);
        if (pkg2.homepage && pkg2.homepage.startsWith('http')) deployUrl = pkg2.homepage;
      }
    } catch {}
  }

  // Skript fallback: pokud preferovany script chybi, zkus dev/start/serve a uprav cmd.
  let devCommand: string | null = autostartEntry.cmd;
  if (devCommand && autostartEntry.scriptName && !pkgScripts[autostartEntry.scriptName]) {
    if (pkgScripts.dev) devCommand = 'npm run dev';
    else if (pkgScripts.start) devCommand = 'npm start';
    else if (pkgScripts.serve) devCommand = 'npm run serve';
    else devCommand = null;
  }

  // ── Launch picker — detekce víc možných entry pointů ──
  const launchCandidates: Array<{ id: string; label: string; kind: 'dev' | 'static' | 'storybook' }> = [];
  if (devCommand && autostartEntry.cmd !== null) {
    const portPart = autostartEntry.port != null ? autostartEntry.port : '?';
    launchCandidates.push({
      id: 'dev',
      kind: 'dev',
      label: t('workspace.launch.dev', { cmd: devCommand, port: portPart }),
    });
  }
  // Static index.html jako samostatná volba — jen pokud projekt NEMÁ dev server v AUTOSTART
  // (Vite/Next mají index.html jako součást dev serveru, nechceme duplicitní volbu).
  if (!devCommand || autostartEntry.cmd === null) {
    try {
      const hasIndex = await levis.readFile(projectPath + '\\index.html');
      if (typeof hasIndex === 'string') {
        launchCandidates.push({
          id: 'static',
          kind: 'static',
          label: t('workspace.launch.static'),
        });
      }
    } catch {}
  }
  if (pkgScripts.storybook) {
    launchCandidates.push({
      id: 'storybook',
      kind: 'storybook',
      label: t('workspace.launch.storybook'),
    });
  }

  // Per-projekt stored volba
  let launchChoice: string | null = null;
  if (launchCandidates.length >= 2) {
    try {
      const storedMap = (await levis.storeGet('hubProjectLaunchChoice')) || {};
      const stored = storedMap[projectPath];
      if (stored && launchCandidates.some(c => c.id === stored)) {
        launchChoice = stored;
      }
    } catch {}
  } else if (launchCandidates.length === 1) {
    launchChoice = launchCandidates[0].id;
  }



  // ── Initialize components ─────────────
  let editorInstance: any = null;
  let diffInstance: any = null;
  const termInstances: any[] = [];

  // Multi-terminal container
  const termContainer = document.createElement('div');
  termContainer.className = 'term-split-container';
  termPanel.appendChild(termContainer);

  async function addTerminal(cmdOverride?: string, label?: string): Promise<void> {
    if (termInstances.length >= 3) {
      showToast(t('toast.maxTerminals'), 'warning');
      return;
    }
    const termSlot = document.createElement('div');
    termSlot.className = 'term-slot';
    const termIdx = termInstances.length;
    termSlot.addEventListener('mousedown', () => {
      activeTerminalIndex = termIdx;
      termContainer.querySelectorAll('.term-slot').forEach((s, i) => {
        (s as HTMLElement).classList.toggle('term-slot-active', i === termIdx);
      });
    });
    termContainer.appendChild(termSlot);

    // Close button (visible on hover, only for non-first terminals)
    if (termInstances.length > 0) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'term-close-btn';
      closeBtn.title = 'Zavřít terminál';
      closeBtn.innerHTML = (window as any).icon('close', { size: 12 });
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        termSlot.dispatchEvent(new Event('term-close'));
      });
      termSlot.appendChild(closeBtn);
    }

    // Add splitter between terminals
    if (termInstances.length > 0) {
      const tSplitter = document.createElement('div');
      tSplitter.className = 'term-splitter split-handle';
      termSlot.before(tSplitter);
      setupDragSplitter(tSplitter, 'vertical', termContainer);
    }

    try {
      const cwd = termCwd;
      const cmd = cmdOverride ?? (termInstances.length === 0 ? autoCommand : undefined);
      const termLabel = label ?? (termInstances.length === 0 ? 'Claude Code' : undefined);
      const inst = await createTerminal(termSlot, cwd, projectName, cmd, termLabel);
      termInstances.push(inst);

      // Handle close event from terminal
      termSlot.addEventListener('term-close', () => {
        if (termInstances.length <= 1) {
          showToast(t('toast.lastTerminal'), 'warning');
          return;
        }
        const idx = termInstances.indexOf(inst);
        if (idx === -1) return;
        inst.dispose();
        termInstances.splice(idx, 1);
        // Remove slot and its preceding splitter
        const prevSplitter = termSlot.previousElementSibling;
        if (prevSplitter?.classList.contains('term-splitter')) prevSplitter.remove();
        else {
          const nextSplitter = termSlot.nextElementSibling;
          if (nextSplitter?.classList.contains('term-splitter')) nextSplitter.remove();
        }
        termSlot.remove();
        // Refit remaining terminals
        for (const t of termInstances) { try { t.fitAddon.fit(); } catch {} }
      });
    } catch (err) {
      console.error('[terminal] createTerminal selhal:', err);
      const msg = (err as any)?.message || String(err);
      termSlot.textContent = '';
      const errDiv = document.createElement('div');
      errDiv.className = 'loading';
      errDiv.textContent = `Chyba terminálu: ${msg}`;
      termSlot.appendChild(errDiv);
    }
  }

  STAGE('before addTerminal');
  await addTerminal(); // First terminal
  STAGE('after addTerminal');

  STAGE('before editor');
  // Editor
  try {
    editorInstance = await createEditor(editorPanel);
    STAGE('after createEditor');
    // Auto-persist po každé změně otevřených souborů
    if (editorInstance.onFilesChange) {
      cleanups.push(editorInstance.onFilesChange(() => persistOpenFiles()));
    }
    // Restore otevřené soubory z předchozí session
    try {
      const prefs = await levis.getProjectPrefs(projectPath);
      const savedFiles = (prefs as any)?.editorOpenFiles;
      if (Array.isArray(savedFiles) && savedFiles.length > 0) {
        for (const fp of savedFiles) {
          if (typeof fp === 'string') {
            try { await editorInstance.openFile(fp); } catch {}
          }
        }
      }
    } catch {}
  } catch (err) {
    editorPanel.innerHTML = `<div class="loading">Chyba editoru</div>`;
  }

  // Diff
  try {
    diffInstance = createDiffViewer(diffPanel);
  } catch (err) {
    diffPanel.innerHTML = `<div class="loading">Chyba diff vieweru</div>`;
  }

  const browserInstance = createBrowser(browserPanel, '', projectPath);

  // Pro web/expo projekty: prepnout na Mobile panel, spustit dev server jako
  // BACKGROUND PTY (zadny xterm slot vedle Claude Code) a po chvili nacist
  // URL v iframu. Output je dostupny pres "Dev log" tlacitko v statusbaru.
  let devPtyId: string | null = null;
  let devLogBuffer: string[] = [];
  let devLogUnsub: (() => void) | null = null;
  let devLogPanel: HTMLElement | null = null;
  let devLogPre: HTMLElement | null = null;

  function stripAnsi(s: string): string {
    // ESC[...m / ESC[...K / ESC[...H atd. + OSC sekvence ESC]...BEL/ESC\
    return s
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/\x1b[=>]/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  }

  function appendDevLog(chunk: string): void {
    const clean = stripAnsi(chunk);
    devLogBuffer.push(clean);
    // FIFO ~1000 chunks
    if (devLogBuffer.length > 1000) devLogBuffer.shift();
    if (devLogPre) {
      devLogPre.textContent = devLogBuffer.join('');
      devLogPre.scrollTop = devLogPre.scrollHeight;
    }
    // Detekce chyb -> toast
    if (/CommandError|ERROR|Failed to|Cannot find module/i.test(chunk)) {
      const line = chunk.split('\n').find(l => /CommandError|ERROR|Failed to|Cannot find module/i.test(l));
      if (line) showToast('Dev: ' + line.trim().slice(0, 200), 'error');
    }
  }

  async function startBackgroundDevPty(cwd: string, command: string): Promise<void> {
    try {
      devPtyId = await levis.createPty(cwd);
      devLogUnsub = levis.onPtyData((id: string, data: string) => {
        if (id === devPtyId) appendDevLog(data);
      });
      // Pockat moment a poslat command do shellu
      setTimeout(() => {
        if (devPtyId) levis.writePty(devPtyId, command + '\r');
      }, 500);
    } catch (err) {
      showToast(t('toast.devFailed', { msg: (err as any)?.message || '' }), 'error');
    }
  }

  STAGE('before grid');
  // ── Grid (2x2 max, swap-based) ──
  const GridMod = (window as any).Grid;

  function refitTerminals(): void {
    requestAnimationFrame(() => {
      for (const t of termInstances) { try { t.fitAddon.fit(); } catch {} }
    });
  }

  function persistLayout(): void {
    try { levis.setProjectPref(projectPath, 'workspaceLayout', grid.getState()); } catch {}
  }

  function persistOpenFiles(): void {
    try {
      const files = editorInstance?.getOpenFiles?.() || [];
      levis.setProjectPref(projectPath, 'editorOpenFiles', files);
    } catch {}
  }

  // Načti uložený grid (per-projekt) nebo default
  STAGE('grid: getProjectPrefs');
  let initialState: any = null;
  try {
    const prefs = await levis.getProjectPrefs(projectPath);
    STAGE('grid: prefs ok');
    if (prefs?.workspaceLayout) {
      initialState = GridMod.deserializeGrid(prefs.workspaceLayout);
      STAGE('grid: deserialized');
    }
  } catch (e) { STAGE('grid: prefs err ' + e); }

  STAGE('grid: createGrid');
  const grid = GridMod.createGrid({
    rootEl: layoutRoot,
    mountPanel: (panel: WsPanelId) => panelEls[panel],
    getLabel: (panel: WsPanelId) => PANEL_LABELS[panel],
    onHeaderRender: (panel: WsPanelId, header: HTMLElement) => {
      if (panel === 'terminal') {
        const actions = [
          { icon: 'search', title: t('terminal.search'), fn: () => { const ti = termInstances[activeTerminalIndex] || termInstances[0]; ti?.toggleSearch(); } },
          { icon: 'clear', title: t('terminal.clear'), fn: () => { const ti = termInstances[activeTerminalIndex] || termInstances[0]; ti?.clear(); } },
          { icon: 'equalize-v', title: t('ws.equalizeTerminals'), fn: () => {
            const slots = termContainer.querySelectorAll('.term-slot');
            slots.forEach((s) => { (s as HTMLElement).style.flex = '1'; (s as HTMLElement).style.width = ''; });
            for (const ti of termInstances) { try { ti.fitAddon.fit(); } catch {} }
          }},
          { icon: 'split', title: t('ws.newTerminal'), fn: () => addTerminal() },
        ];
        const closeBtn = header.querySelector('.grid-cell-close');
        for (const a of actions) {
          const btn = document.createElement('button');
          btn.className = 'grid-cell-action';
          btn.title = a.title;
          btn.innerHTML = I(a.icon, { size: 14 });
          btn.addEventListener('click', (e) => { e.stopPropagation(); a.fn(); });
          if (closeBtn) closeBtn.before(btn);
        }
      }
    },
    onChange: (state: any) => {
      persistLayout();
      // Lazy actions když panel přibyl — projdi všechny řádky
      const flat: string[] = [];
      for (const row of state.rows ?? []) {
        for (const c of row.cells ?? []) if (c) flat.push(c);
      }
      if (flat.includes('diff') && diffInstance) diffInstance.showDiff(projectPath);
      refitTerminals();
    },
    onAfterRender: () => refitTerminals(),
    onDragOut: async (panel: WsPanelId, _x: number, _y: number) => {
      // Popout panelu mimo workspace
      try {
        if (panel === 'browser') {
          const bUrl = browserInstance?.getUrl?.() || '';
          const popData: any = { type: 'browser' };
          if (bUrl.startsWith('file:///')) popData.filePath = bUrl.replace('file:///', '');
          else if (bUrl && bUrl !== 'about:blank') popData.url = bUrl;
          await levis.popout(popData);
          poppedPanels.add('browser');
        } else if (panel === 'editor') {
          const files = editorInstance?.getOpenFiles?.() || [];
          const r = await levis.popoutPanel({ panelType: 'editor', payload: { files, projectPath, projectName } });
          if (r?.panelId) panelPopoutMap.set(r.panelId, 'editor');
        } else if (panel === 'terminal') {
          // Dumpni buffer všech terminálů pro popout
          const terminals = termInstances.map((inst, idx) => {
            let initial = '';
            try {
              if (inst.term) {
                const buf = inst.term.buffer.active;
                const lines: string[] = [];
                for (let i = 0; i < buf.length; i++) {
                  const line = buf.getLine(i);
                  if (line) lines.push(line.translateToString(true));
                }
                initial = lines.join('\r\n');
              }
            } catch {}
            return { ptyId: inst.ptyId, label: `Terminal ${idx + 1}`, initial };
          });
          const r = await levis.popoutPanel({ panelType: 'terminal', payload: { terminals, projectPath, projectName } });
          if (r?.panelId) panelPopoutMap.set(r.panelId, 'terminal');
        } else {
          showToast(`Panel "${PANEL_LABELS[panel].text}" zatím nepodporuje popout`, 'warning');
          return;
        }
        grid.removePanel(panel);
        showToast(t('toast.notInGrid', { name: PANEL_LABELS[panel].text }), 'info');
      } catch (err) {
        console.error('[popout] selhal:', err);
        showToast(t('toast.popoutFailed'), 'error');
      }
    },
  });
  STAGE('grid: created');
  if (initialState) {
    STAGE('grid: setState init');
    grid.setState(initialState);
  } else if (hasNoPreview) {
    STAGE('grid: setState noPreview');
    grid.setState({
      rows: [{ cells: ['terminal'], colSizes: [100] }],
      rowSizes: [100],
      locked: false,
    });
  }
  STAGE('grid: ensurePanel detection');
  if (!hasNoPreview) {
    grid.ensurePanel('browser');
  }
  STAGE('grid: done');

  // Autostart dev serveru — globalni opt-out v Hub Settings
  let autostartEnabled = true;
  try {
    const v = await levis.storeGet('autostartDev');
    if (v === false) autostartEnabled = false;
  } catch {}

  // Pokud máme víc kandidátů a uložená volba není, zeptej se
  if (!deployUrl && launchChoice === null && launchCandidates.length >= 2 && autostartEnabled) {
    const picked = await askLaunchChoice(launchCandidates);
    if (picked) {
      launchChoice = picked.id;
      if (picked.remember) {
        try {
          const map = (await levis.storeGet('hubProjectLaunchChoice')) || {};
          map[projectPath] = picked.id;
          await levis.storeSet('hubProjectLaunchChoice', map);
        } catch {}
      }
    }
  }

  // Deploy URL má nejvyšší prioritu — pokud existuje, načti rovnou
  if (deployUrl) {
    switchRightPanel('browser');
    browserInstance.setUrl(deployUrl);
    showToast(t('toast.deployUrl', { url: deployUrl }), 'info');
  } else if (autostartEnabled && launchChoice === 'dev' && devCommand && autostartEntry.cmd !== null) {
    switchRightPanel('browser');
    // Ukaž loader s labelem podle typu (Vite / Next / Expo / ...)
    browserInstance.setLoading?.(true, t('workspace.launch.startingDev', { type: resolvedType }));
    startBackgroundDevPty(termCwd, devCommand);
    const btnDevLog = statusBar.querySelector('.status-btn-devlog') as HTMLElement;
    if (btnDevLog) btnDevLog.style.display = '';

    if (autostartEntry.port != null) {
      const probeSignal = { aborted: false };
      cleanups.push(() => { probeSignal.aborted = true; });
      // Paralelní race: [A] default port probe, [B] detekce alt portu v PTY logu (port collision / Vite auto-increment)
      let resolved = false;
      const resolveOnce = (port: number, fromLog: boolean): void => {
        if (resolved || probeSignal.aborted) return;
        resolved = true;
        const url = `http://localhost:${port}`;
        // Webview začne načítat URL → did-start-loading si loader řídí sám
        browserInstance.setLoading?.(false);
        browserInstance.setUrl(url);
        if (fromLog && port !== autostartEntry.port) {
          showToast(t('workspace.launch.altPortDetected', { port }), 'success');
        } else {
          showToast(t('toast.devStarted', { name: resolvedType, port }), 'success');
        }
      };
      // [A] Probe default port
      (async () => {
        const ok = await probePort(autostartEntry.port!, probeSignal);
        if (!probeSignal.aborted && ok) resolveOnce(autostartEntry.port!, false);
      })();
      // [B] Průběžný polling logu — jakmile najde Local: http://localhost:PORT, vyřeš
      const logRegex = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/;
      const logPollId = window.setInterval(() => {
        if (resolved || probeSignal.aborted) { window.clearInterval(logPollId); return; }
        const m = devLogBuffer.join('').match(logRegex);
        if (m) {
          const port = parseInt(m[1], 10);
          resolveOnce(port, port !== autostartEntry.port);
          window.clearInterval(logPollId);
        }
      }, 400);
      cleanups.push(() => window.clearInterval(logPollId));
      // Timeout fallback — po PORT_PROBE_TIMEOUT_MS bez výsledku actionable toast
      window.setTimeout(() => {
        window.clearInterval(logPollId);
        if (resolved || probeSignal.aborted) return;
        resolved = true;
        browserInstance.setLoading?.(false);
        showToast(t('workspace.launch.portTimeout', { port: autostartEntry.port! }), 'error', {
          action: { label: t('workspace.launch.showTerminal'), onClick: () => {
            const btn = statusBar.querySelector('.status-btn-devlog') as HTMLElement | null;
            if (btn) btn.click();
          }},
        });
      }, PORT_PROBE_TIMEOUT_MS);
    }
  } else if (launchChoice === 'static') {
    switchRightPanel('browser');
    const fileUrl = 'file:///' + projectPath.replace(/\\/g, '/').replace(/ /g, '%20') + '/index.html';
    browserInstance.setUrl(fileUrl);
  } else if (launchChoice === 'storybook') {
    // Storybook spustí handler status-btn-storybook níže (detekuje launchChoice === 'storybook')
    switchRightPanel('browser');
  } else if (hasNoPreview) {
    // Electron/Tauri/CLI/knihovna — pravy panel je k nicemu, defaultne editor pres celou sirku
    switchRightPanel('hidden');
    switchLeftPanel('editor');
  }

  // Storybook tlacitko (pokud projekt ma scripts.storybook)
  if (hasStorybook) {
    const btnSb = document.createElement('button');
    btnSb.className = 'status-btn status-btn-storybook';
    btnSb.title = 'Spustit Storybook (npm run storybook)';
    btnSb.innerHTML = `${I('play')} Storybook`;
    let sbPtyId: string | null = null;
    let sbStarted = false;
    btnSb.addEventListener('click', async () => {
      if (sbStarted) {
        switchRightPanel('browser');
        browserInstance.setUrl('http://localhost:6006');
        return;
      }
      sbStarted = true;
      btnSb.classList.add('ws-tab-active');
      try {
        sbPtyId = await levis.createPty(termCwd);
        setTimeout(() => sbPtyId && levis.writePty(sbPtyId, 'npm run storybook\r'), 500);
        showToast(t('toast.storybookStarting'), 'info');
        const probeSignal = { aborted: false };
        cleanups.push(() => { probeSignal.aborted = true; });
        const ok = await probePort(6006, probeSignal);
        if (ok) {
          grid.ensurePanel('browser');
          switchRightPanel('browser');
          browserInstance.setUrl('http://localhost:6006');
          showToast(t('toast.storybookReady'), 'success');
        } else {
          showToast(t('toast.storybookTimeout'), 'error');
        }
      } catch (err) {
        showToast(t('toast.storybookFailed', { msg: (err as any)?.message || '' }), 'error');
      }
    });
    statusBar.appendChild(btnSb);
    // Pokud user zvolil Storybook v launch pickeru, spusť ho auto
    if (launchChoice === 'storybook') {
      setTimeout(() => btnSb.click(), 0);
    }
  }

  // Dev log floating panel toggle
  const btnDevLog = statusBar.querySelector('.status-btn-devlog') as HTMLElement;
  btnDevLog?.addEventListener('click', () => {
    if (devLogPanel) {
      devLogPanel.remove();
      devLogPanel = null;
      devLogPre = null;
      return;
    }
    devLogPanel = document.createElement('div');
    devLogPanel.className = 'devlog-floating';
    devLogPanel.innerHTML = `
      <div class="devlog-header">
        <span>Dev server log</span>
        <span style="flex:1"></span>
        <button class="devlog-clear" title="Vyčistit">${I('clear')}</button>
        <button class="devlog-close" title="Zavřít">${I('close')}</button>
      </div>
      <pre class="devlog-pre"></pre>
    `;
    wrapper.appendChild(devLogPanel);
    devLogPre = devLogPanel.querySelector('.devlog-pre') as HTMLElement;
    devLogPre.textContent = devLogBuffer.join('');
    devLogPre.scrollTop = devLogPre.scrollHeight;
    devLogPanel.querySelector('.devlog-close')?.addEventListener('click', () => {
      devLogPanel?.remove();
      devLogPanel = null;
      devLogPre = null;
    });
    devLogPanel.querySelector('.devlog-clear')?.addEventListener('click', () => {
      devLogBuffer = [];
      if (devLogPre) devLogPre.textContent = '';
    });
  });



  // File tree
  let fileTreeInstance: any = null;
  try {
    fileTreeInstance = await createFileTree(sidebarContainer, projectPath, async (filePath: string) => {
      // HTML soubory → preview (artifact), ostatní → editor
      if (/\.(html?)$/i.test(filePath) && browserInstance) {
        switchRightPanel('browser');
        browserInstance.loadFile(filePath);
      } else {
        switchLeftPanel('editor');
        if (editorInstance) await editorInstance.openFile(filePath);
      }
    });
  } catch (err) {
    sidebarContainer.innerHTML = `<div class="loading">Chyba file tree</div>`;
  }



  // ── Status bar elements ───────────────
  const dirtyEl = statusBar.querySelector('.status-dirty') as HTMLElement;
  const syncEl = statusBar.querySelector('.status-sync') as HTMLElement;
  const projectSizeEl = statusBar.querySelector('.status-project-size') as HTMLElement;
  const fileInfoEl = statusBar.querySelector('.status-file-info') as HTMLElement;

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  // Načti velikost projektu
  levis.dirStats(projectPath).then(stats => {
    projectSizeEl.textContent = `${stats.files} ${t('ws.filesCount')} · ${formatSize(stats.size)}`;
    projectSizeEl.title = t('ws.projectSize');
  }).catch(() => {});

  function updateGitStatus(): void {
    levis.gitStatus(projectPath).then((status: any) => {
      if (status.current) {
        const fileCount = status.files?.length || 0;
        if (fileCount > 0) {
          dirtyEl.textContent = `${fileCount} ${fileCount === 1 ? 'změna' : fileCount < 5 ? 'změny' : 'změn'}`;
          dirtyEl.classList.add('status-dirty-active');
        } else {
          dirtyEl.textContent = '';
          dirtyEl.classList.remove('status-dirty-active');
        }

        const ahead = status.ahead || 0;
        const behind = status.behind || 0;
        if (ahead > 0 || behind > 0) {
          syncEl.textContent = (ahead > 0 ? `↑${ahead}` : '') + (behind > 0 ? ` ↓${behind}` : '');
        } else {
          syncEl.textContent = '';
        }
      } else {
        dirtyEl.textContent = '';
        syncEl.textContent = '';
      }
    }).catch(() => {});
  }
  updateGitStatus();

  // Helpers — kompatibilní s původním API zbytku workspace.ts
  function switchLeftPanel(panel: string): void {
    const pid = panel as WsPanelId;
    grid.ensurePanel(pid);
    if (pid === 'diff' && diffInstance) diffInstance.showDiff(projectPath);
    refitTerminals();
  }

  function switchRightPanel(panel: RightPanel): void {
    if (panel === 'hidden') {
      for (const p of ['browser'] as WsPanelId[]) {
        grid.removePanel(p);
      }
      refitTerminals();
      return;
    }
    grid.ensurePanel(panel as WsPanelId);
    refitTerminals();
  }

  // Sidebar toggle (file tree)
  const btnToggleSidebar = wsToolbar.querySelector('.ws-btn-toggle-sidebar') as HTMLElement;
  let sidebarHidden = false;
  btnToggleSidebar?.classList.add('ws-tab-active'); // visible by default
  btnToggleSidebar?.addEventListener('click', () => {
    sidebarHidden = !sidebarHidden;
    sidebarContainer.style.display = sidebarHidden ? 'none' : '';
    sidebarSplitter.style.display = sidebarHidden ? 'none' : '';
    btnToggleSidebar.classList.toggle('ws-tab-active', !sidebarHidden);
  });

  // Sidebar L/R toggle
  const btnSidebarSide = wsToolbar.querySelector('.ws-btn-sidebar-side') as HTMLElement;
  btnSidebarSide?.addEventListener('click', async () => {
    sidebarSide = sidebarSide === 'left' ? 'right' : 'left';
    applySidebarSide();
    await levis.storeSet('sidebarSide', sidebarSide);
    showToast(t(sidebarSide === 'left' ? 'toast.sidebarLeft' : 'toast.sidebarRight'), 'info');
  });

  // Reset layout
  const btnResetLayout = wsToolbar.querySelector('.ws-btn-reset-layout') as HTMLElement;
  btnResetLayout?.addEventListener('click', () => {
    const rightPanel: WsPanelId = hasNoPreview ? 'editor' : 'browser';
    grid.setState({
      rows: [{ cells: ['terminal', rightPanel], colSizes: [55, 45] }],
      rowSizes: [100],
      locked: false,
    });
    persistLayout();
    showToast(t('toast.layoutReset'), 'info');
  });

  const btnAddPanel = wsToolbar.querySelector('.ws-btn-add-panel') as HTMLElement;
  btnAddPanel?.addEventListener('click', () => grid.openPicker());

  const btnEqualizeLayout = wsToolbar.querySelector('.ws-btn-equalize-layout') as HTMLElement;
  btnEqualizeLayout?.addEventListener('click', () => {
    grid.equalize();
    persistLayout();
    showToast(t('toast.layoutEqualized'), 'info');
  });

  const btnLockLayout = wsToolbar.querySelector('.ws-btn-lock-layout') as HTMLElement;
  btnLockLayout?.addEventListener('click', () => {
    grid.toggleLock();
    btnLockLayout.classList.toggle('ws-tab-active', grid.getState().locked);
    persistLayout();
  });

  // ── Splitter utility (overlay + user-select lock, sjednoceno s grid splitterem) ──
  function setupDragSplitter(
    handle: HTMLElement,
    direction: 'vertical' | 'horizontal',
    _parent: HTMLElement
  ): void {
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      handle.classList.add('dragging');
      document.body.style.userSelect = 'none';
      const cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';
      document.body.style.cursor = cursor;

      const prev = handle.previousElementSibling as HTMLElement;
      const next = handle.nextElementSibling as HTMLElement;
      if (!prev || !next) return;

      // Zachytit rects při mousedown — počítáme relativně k těmto dvěma slotům
      const prevRect = prev.getBoundingClientRect();
      const nextRect = next.getBoundingClientRect();
      const originPx = direction === 'vertical' ? prevRect.left : prevRect.top;
      const combinedPx = direction === 'vertical'
        ? (nextRect.right - prevRect.left)
        : (nextRect.bottom - prevRect.top);

      // Overlay zabrání iframe/xterm žrát mouse events
      const overlay = document.createElement('div');
      overlay.style.cssText = `position:fixed;inset:0;z-index:9999;cursor:${cursor}`;
      document.body.appendChild(overlay);

      const onMove = (ev: MouseEvent) => {
        const mousePos = (direction === 'vertical' ? ev.clientX : ev.clientY) - originPx;
        const minPx = combinedPx * 0.15;
        let clamped = Math.min(combinedPx - minPx, Math.max(minPx, mousePos));

        // Snap k 50% kombinované šířky
        const half = combinedPx / 2;
        if (Math.abs(clamped - half) < combinedPx * 0.03) clamped = half;

        prev.style.flex = 'none';
        prev.style[direction === 'vertical' ? 'width' : 'height'] = `${clamped}px`;
        next.style.flex = 'none';
        next.style[direction === 'vertical' ? 'width' : 'height'] = `${combinedPx - clamped}px`;

        for (const ti of termInstances) {
          try { ti.fitAddon.fit(); } catch {}
        }
      };

      const onUp = () => {
        handle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        overlay.remove();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        for (const ti of termInstances) {
          try { ti.fitAddon.fit(); } catch {}
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── Drag helper with body user-select lock ──
  function startDrag(
    handle: HTMLElement,
    onDrag: (e: MouseEvent) => void
  ): void {
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      handle.classList.add('dragging');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      // Overlay to prevent iframe from eating mouse events
      const dragOverlay = document.createElement('div');
      dragOverlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;cursor:col-resize;';
      document.body.appendChild(dragOverlay);

      const onMove = (ev: MouseEvent) => onDrag(ev);

      const onUp = () => {
        handle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        dragOverlay.remove();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // Refit all terminals after drag
        for (const t of termInstances) { try { t.fitAddon.fit(); } catch {} }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // Main splitter mezi sloty workspace už řeší layout-render (lt-splitter).
  // Sidebar splitter — drag mění šířku sidebaru proti layoutRoot
  startDrag(sidebarSplitter, (ev) => {
    const rect = panels.getBoundingClientRect();
    const raw = sidebarSide === 'left' ? ev.clientX - rect.left : rect.right - ev.clientX;
    sidebarContainer.style.width = `${Math.min(400, Math.max(120, raw))}px`;
  });

  // ── Status bar actions ────────────────
  // ── Fronta promptů pro CC ──
  const promptQueue: string[] = [];
  let queueWatcherAttached = false;
  const btnQueue = statusBar.querySelector('.status-btn-queue') as HTMLButtonElement;
  const queueCountEl = statusBar.querySelector('.queue-count') as HTMLElement;

  function updateQueueUI(): void {
    const n = promptQueue.length;
    btnQueue.style.display = n > 0 ? '' : 'none';
    queueCountEl.textContent = String(n);
    btnQueue.title = n > 0 ? t('ws.queueTooltip') + ` (${n})` : t('ws.queueTooltip');
  }

  function drainQueue(): void {
    const first = termInstances[0];
    if (!first || promptQueue.length === 0) return;
    const state = first.getState ? first.getState() : 'idle';
    if (state !== 'idle') return;
    const next = promptQueue.shift()!;
    updateQueueUI();
    levis.writePty(first.ptyId, next + '\r');
    if (promptQueue.length > 0) {
      showToast(t('toast.queueRemaining', { n: promptQueue.length }), 'info');
    }
  }

  function attachQueueWatcher(): void {
    if (queueWatcherAttached) return;
    const first = termInstances[0];
    if (!first || typeof first.onStateChange !== 'function') return;
    first.onStateChange((s: string) => {
      if (s === 'idle' && promptQueue.length > 0) {
        setTimeout(drainQueue, 500);
      }
    });
    queueWatcherAttached = true;
  }

  let activeTerminalIndex = 0;

  // Queue popup — zobrazení a správa fronty
  btnQueue.addEventListener('click', () => {
    // Odstraň existující popup
    document.querySelectorAll('.queue-popup').forEach(el => el.remove());
    if (promptQueue.length === 0) return;
    const popup = document.createElement('div');
    popup.className = 'queue-popup';
    const escH = (s: string) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    popup.innerHTML = `
      <div class="queue-popup-header">
        <span>${t('ws.queueTitle')} (${promptQueue.length})</span>
        <button class="queue-popup-clear" title="${t('ws.queueClear')}">✕ ${t('ws.queueClear')}</button>
      </div>
      <div class="queue-popup-list">
        ${promptQueue.map((item, i) => `
          <div class="queue-popup-item">
            <span class="queue-popup-text">${escH(item.length > 80 ? item.substring(0, 80) + '…' : item)}</span>
            <button class="queue-popup-remove" data-idx="${i}" title="${t('ws.queueRemove')}">✕</button>
          </div>
        `).join('')}
      </div>
    `;
    const rect = btnQueue.getBoundingClientRect();
    popup.style.left = `${rect.left}px`;
    popup.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    document.body.appendChild(popup);
    // Clear all
    popup.querySelector('.queue-popup-clear')!.addEventListener('click', () => {
      promptQueue.length = 0;
      updateQueueUI();
      popup.remove();
      showToast(t('ws.queueCleared'), 'success');
    });
    // Remove individual
    popup.querySelectorAll('.queue-popup-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt((btn as HTMLElement).dataset.idx || '0', 10);
        promptQueue.splice(idx, 1);
        updateQueueUI();
        popup.remove();
        if (promptQueue.length > 0) btnQueue.click(); // reopen
      });
    });
    // Close on outside click
    setTimeout(() => {
      const close = (ev: MouseEvent) => {
        if (!popup.contains(ev.target as Node) && ev.target !== btnQueue) {
          popup.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 0);
  });

  function sendToFirstTerminal(text: string): void {
    const target = termInstances[activeTerminalIndex] || termInstances[0];
    if (!target) return;
    const state = target.getState ? target.getState() : 'idle';
    if (state !== 'idle') {
      promptQueue.push(text);
      attachQueueWatcher();
      updateQueueUI();
      showToast(t('toast.ccBusyQueued', { n: promptQueue.length }), 'info');
      switchLeftPanel('terminal');
      return;
    }
    switchLeftPanel('terminal');
    levis.writePty(target.ptyId, text + '\r');
  }

  const btnRestart = statusBar.querySelector('.status-btn-restart') as HTMLButtonElement;
  btnRestart.addEventListener('click', () => {
    const first = termInstances[0];
    if (!first) return;
    btnRestart.disabled = true;
    btnRestart.classList.add('status-btn-loading');
    // Ctrl+C (ukončit běžící CC) → cls → claude
    levis.writePty(first.ptyId, '\x03');
    setTimeout(() => {
      levis.writePty(first.ptyId, 'cls\r');
      setTimeout(() => {
        levis.writePty(first.ptyId, 'claude\r');
        setTimeout(() => {
          btnRestart.disabled = false;
          btnRestart.classList.remove('status-btn-loading');
        }, 600);
      }, 300);
    }, 400);
    showToast(t('toast.ccRestarted'), 'info');
  });

  // Checkpoint UI handler — registrovaný po ccDoneCallbacks (viz níže)
  interface Checkpoint { hash: string; ts: number; files: number }
  const checkpoints: Checkpoint[] = [];
  const btnRevert = statusBar.querySelector('.status-btn-revert') as HTMLButtonElement;

  btnRevert.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (checkpoints.length === 0) return;

    const existing = document.querySelector('.checkpoint-dropdown');
    if (existing) { existing.remove(); return; }

    const dd = document.createElement('div');
    dd.className = 'checkpoint-dropdown';
    const recent = checkpoints.slice(0, 5);
    dd.innerHTML = recent.map((cp, i) => {
      const ago = Math.round((Date.now() - cp.ts) / 60000);
      const label = ago < 1 ? 'právě teď' : ago < 60 ? `před ${ago} min` : `před ${Math.round(ago / 60)}h`;
      return `<div class="checkpoint-item" data-idx="${i}">
        <span class="checkpoint-time">${label}</span>
        <span class="checkpoint-hash">${cp.hash.slice(0, 7)}</span>
      </div>`;
    }).join('');
    btnRevert.style.position = 'relative';
    btnRevert.appendChild(dd);

    dd.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const item = (ev.target as HTMLElement).closest('.checkpoint-item') as HTMLElement;
      if (!item) return;
      const idx = Number(item.dataset.idx);
      const cp = recent[idx];
      if (!cp) return;
      dd.remove();

      showToast('Revertuji…', 'info');
      const result = await levis.gitResetHard(projectPath, cp.hash);
      if (result && result.success) {
        const ago = Math.round((Date.now() - cp.ts) / 60000);
        const label = ago < 1 ? 'právě teď' : `před ${ago} minutami`;
        showToast(`✓ Projekt vrácen do stavu ${label}`, 'success');
        checkpoints.splice(0, idx + 1);
        updateGitStatus();
      } else {
        showToast('Revert selhal: ' + ((result as any)?.error || 'neznámá chyba'), 'error');
      }
    });

    setTimeout(() => {
      document.addEventListener('click', function closeDd() {
        dd.remove(); document.removeEventListener('click', closeDd);
      }, { once: true });
    }, 10);
  });

  statusBar.querySelector('.status-btn-attach')!.addEventListener('click', async () => {
    const files = await levis.openFileDialog(true);
    if (!files || files.length === 0) return;
    const paths = files.map((f: string) => `"${f}"`).join(' ');
    sendToFirstTerminal(paths);
    showToast(t('toast.filesAttached', { n: files.length }), 'info');
  });

  // Save/Push — konfigurovatelné příkazy (default: git commit / git commit+push)
  statusBar.querySelector('.status-btn-save')!.addEventListener('click', async () => {
    const cmd = (await levis.storeGet('cmdSave')) || '/commit';
    sendToFirstTerminal(cmd as string);
    showToast(t('toast.saving'), 'info');
  });

  statusBar.querySelector('.status-btn-push')!.addEventListener('click', async () => {
    const cmd = (await levis.storeGet('cmdPush')) || '/commit && git push';
    sendToFirstTerminal(cmd as string);
    showToast(t('toast.pushing'), 'info');
  });

  statusBar.querySelector('.status-btn-pull')!.addEventListener('click', async () => {
    showToast(t('toast.pulling'), 'info');
    const result = await levis.gitPull(projectPath);
    if (result.error) showToast(`Pull chyba: ${result.error}`, 'error');
    else showToast(t('toast.pullOk'), 'success');
  });



  // ── Lehký refresh po PTY ticha ──
  // Pravidelný refresh artifactu nedělá smysl — Watch mode v artifactu je
  // efektivnější (polling souboru, reaguje jen na skutečnou změnu).
  // Tady jen refreshneme git status + file tree po PTY dojetí.
  let ccIdleTimer: any = null;
  const first = termInstances[0];
  if (first) {
    const unsubAutoRefresh = levis.onPtyData((id: string, data: string) => {
      if (id !== first.ptyId) return;
      if (ccIdleTimer) clearTimeout(ccIdleTimer);
      ccIdleTimer = setTimeout(() => {
        updateGitStatus();
      }, 2000);
    });
    cleanups.push(unsubAutoRefresh);
  }

  // ── Refresh on window focus ───────────
  // Použijeme OS-level BrowserWindow blur/focus posílané z main procesu.
  // DOM window focus/blur v rendereru fire i při interním kliku na webview
  // (Chromium přesouvá DOM focus do webview guest view), takže přes window events
  // se refresh triggeroval i při běžném klikání uvnitř okna. BrowserWindow.on('blur')
  // se naopak firuje jen při OS přepnutí aplikace (Alt+Tab, taskbar, jiné okno).
  let osWasBlurred = false;
  const unsubBlur = levis.onWindowOsBlur?.(() => { osWasBlurred = true; });
  const unsubFocus = levis.onWindowOsFocus?.(() => {
    if (!osWasBlurred) return;
    osWasBlurred = false;
    if (!browserInstance.isInteracting?.()) {
      browserInstance.refresh();
    }
    updateGitStatus();
  });
  if (unsubBlur) cleanups.push(unsubBlur);
  if (unsubFocus) cleanups.push(unsubFocus);

  // ── Pop-out button ────────────────────
  let poppedOut = false;
  async function popoutArtifact(): Promise<void> {
    const currentUrl = browserInstance?.getUrl?.() || '';
    let filePath: string | null = null;
    let url: string | undefined;

    if (currentUrl.startsWith('http://') || currentUrl.startsWith('https://')) {
      url = currentUrl;
    } else if (currentUrl.startsWith('file:///')) {
      filePath = currentUrl.replace('file:///', '').replace(/\//g, '\\');
    } else {
      const sep = projectPath.includes('\\') ? '\\' : '/';
      const candidates = [
        projectPath + sep + 'index.html',
        projectPath + sep + 'public' + sep + 'index.html',
        projectPath + sep + 'src' + sep + 'index.html',
      ];
      for (const c of candidates) {
        try {
          const content = await levis.readFile(c);
          if (typeof content === 'string') { filePath = c; break; }
        } catch {}
      }
    }
    await levis.popout({
      type: 'browser',
      filePath: filePath || undefined,
      url,
    });
    grid.removePanel('browser');
    poppedOut = true;
    poppedPanels.add('browser');
    showToast(t('toast.previewPopout'), 'info');
  }
  wsToolbar.querySelector('.ws-btn-popout')?.addEventListener('click', popoutArtifact);

  // Drag-out řeší grid (onDragOut callback výš). Žádné duplicitní handlery.

  // Receive prompt from popout window → send to terminal
  const unsubPopoutPrompt = levis.onPopoutSendPrompt((prompt: string) => {
    const first = termInstances[0];
    if (first) {
      switchLeftPanel('terminal');
      levis.writePty(first.ptyId, prompt + '\r');
    }
  });
  cleanups.push(unsubPopoutPrompt);

  // When popout window closes, restore panel (singleton artifact/browser/mobile popout)
  const unsubPopoutClosed = levis.onPopoutClosed(() => {
    poppedOut = false;
    for (const p of ['browser'] as WsPanelId[]) {
      if (poppedPanels.has(p)) {
        grid.ensurePanel(p);
        poppedPanels.delete(p);
        showToast(`${PANEL_LABELS[p].text} vráceno do workspace`, 'info');
      }
    }
  });
  cleanups.push(unsubPopoutClosed);

  // Plovoucí terminal/editor okno se vrátilo nebo zavřelo → re-add do gridu
  try {
    const unsubPanelReturned = (levis as any).onPanelReturned?.((data: any) => {
      try {
        if (!data || !data.panelId) return;
        const panelType = panelPopoutMap.get(data.panelId);
        if (panelType && PANEL_LABELS[panelType]) {
          grid.ensurePanel(panelType);
          panelPopoutMap.delete(data.panelId);
          showToast(`${PANEL_LABELS[panelType].text} vráceno do workspace`, 'info');
        }
      } catch (err) {
        console.error('[panel:returned]', err);
      }
    });
    if (unsubPanelReturned) cleanups.push(unsubPanelReturned);
  } catch (err) { console.error('[onPanelReturned setup]', err); }

  try {
    const unsubPanelClosed = (levis as any).onPanelClosed?.((data: any) => {
      try {
        if (!data || !data.panelId) return;
        const panelType = panelPopoutMap.get(data.panelId);
        if (panelType && PANEL_LABELS[panelType]) {
          grid.ensurePanel(panelType);
          panelPopoutMap.delete(data.panelId);
        }
      } catch (err) {
        console.error('[panel:closed]', err);
      }
    });
    if (unsubPanelClosed) cleanups.push(unsubPanelClosed);
  } catch (err) { console.error('[onPanelClosed setup]', err); }

  // Listen for send-to-pty events from inspector/artifact
  const sendToPtyHandler = ((e: CustomEvent) => {
    sendToFirstTerminal(e.detail);
  }) as EventListener;
  wrapper.addEventListener('send-to-pty', sendToPtyHandler);
  cleanups.push(() => wrapper.removeEventListener('send-to-pty', sendToPtyHandler));

  // File tree → status bar info (velikost souboru/složky)
  const fileSelectedHandler = ((e: CustomEvent) => {
    const { path: fp, isDirectory } = e.detail;
    levis.fileStats(fp).then((stats: any) => {
      if (!stats) { fileInfoEl.textContent = ''; return; }
      const name = fp.replace(/\\/g, '/').split('/').pop() || fp;
      if (stats.isDirectory) {
        fileInfoEl.textContent = `${name}/ — ${stats.files} ${t('ws.filesCount')} · ${formatSize(stats.size)}`;
      } else {
        fileInfoEl.textContent = `${name} — ${formatSize(stats.size)}`;
      }
    }).catch(() => { fileInfoEl.textContent = ''; });
  }) as EventListener;
  wrapper.addEventListener('file-selected', fileSelectedHandler);
  cleanups.push(() => wrapper.removeEventListener('file-selected', fileSelectedHandler));

  // Ctrl+Enter — send editor selection to terminal
  // Ctrl+Shift+V — reload artifact preview
  const onWorkspaceKeys = (e: KeyboardEvent) => {
    if (e.ctrlKey && !e.shiftKey && e.key === 'Enter' && editorInstance) {
      const sel = editorInstance.getSelection();
      if (sel) {
        e.preventDefault();
        sendToFirstTerminal(sel);
        showToast(t('toast.sentToTerminal'), 'info');
      }
    }
    if (e.ctrlKey && e.shiftKey && e.key === 'V') {
      e.preventDefault();
      browserInstance.refresh();
      levis.popoutRefresh();
      showToast(t('toast.previewReturned'), 'info');
    }
    // Alt+I — toggle inspect mode
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'i' || e.key === 'I' || e.code === 'KeyI')) {
      const btn = wrapper.querySelector('.artifact-inspect') as HTMLElement | null;
      if (btn) {
        e.preventDefault();
        btn.click();
      }
    }
  };
  window.addEventListener('keydown', onWorkspaceKeys);
  cleanups.push(() => window.removeEventListener('keydown', onWorkspaceKeys));

  // CC done event + live state — pro tab badge/indikátor v app.ts
  const ccDoneCallbacks: Array<() => void> = [];
  const ccStateCallbacks: Array<(state: string) => void> = [];
  // Hook do termInstances — když některý terminál přejde z working → idle
  function attachTermStateWatcher(): void {
    for (const t of termInstances) {
      if (t._badgeWatcherAttached) continue;
      if (typeof t.onStateChange !== 'function') continue;
      let prevState = t.getState ? t.getState() : 'idle';
      let workingSince = 0;
      t.onStateChange((s: string) => {
        for (const cb of ccStateCallbacks) try { cb(s); } catch {}
        if (s === 'working' && prevState !== 'working') {
          workingSince = Date.now();
        }
        if (prevState === 'working' && (s === 'idle' || s === 'waiting')) {
          const elapsed = Date.now() - workingSince;
          if (elapsed > 1500) {
            for (const cb of ccDoneCallbacks) try { cb(); } catch {}
          }
        }
        prevState = s;
      });
      t._badgeWatcherAttached = true;
    }
  }
  // Periodicky připoj watcher na nově vytvořené terminály (po addTerminal click)
  setTimeout(attachTermStateWatcher, 500);
  const termWatchInterval = setInterval(attachTermStateWatcher, 2000);
  cleanups.push(() => clearInterval(termWatchInterval));

  // Refresh git status po CC akci
  ccDoneCallbacks.push(() => updateGitStatus());

  // Po CC akci aktualizuj velikost projektu
  ccDoneCallbacks.push(() => {
    levis.dirStats(projectPath).then(stats => {
      projectSizeEl.textContent = `${stats.files} ${t('ws.filesCount')} · ${formatSize(stats.size)}`;
    }).catch(() => {});
  });

  // Checkpoint — ulož HEAD hash PŘED prací CC (při idle→working)
  // Tak revert vrátí stav před tím než CC něco změnil
  let pendingCheckpointHash: string | null = null;
  ccStateCallbacks.push((s: string) => {
    if (s === 'working' && !pendingCheckpointHash) {
      levis.gitRevparse(projectPath).then((hash: any) => {
        if (typeof hash === 'string' && hash.length >= 6) {
          pendingCheckpointHash = hash;
        }
      }).catch(() => {});
    }
  });
  ccDoneCallbacks.push(() => {
    if (pendingCheckpointHash) {
      if (checkpoints.length === 0 || checkpoints[0].hash !== pendingCheckpointHash) {
        checkpoints.unshift({ hash: pendingCheckpointHash, ts: Date.now(), files: 0 });
        if (checkpoints.length > 20) checkpoints.length = 20;
        btnRevert.disabled = false;
      }
      pendingCheckpointHash = null;
    }
  });

  STAGE('returning');
  return {
    element: wrapper,
    getActiveTerminals: () => termInstances.map((t, i) => ({
      label: `Terminál ${i + 1}`,
      state: t.getState ? t.getState() : 'idle',
    })),
    onCCDone: (cb: () => void) => {
      ccDoneCallbacks.push(cb);
      return () => {
        const i = ccDoneCallbacks.indexOf(cb);
        if (i !== -1) ccDoneCallbacks.splice(i, 1);
      };
    },
    onCCStateChange: (cb: (state: string) => void) => {
      ccStateCallbacks.push(cb);
      return () => {
        const i = ccStateCallbacks.indexOf(cb);
        if (i !== -1) ccStateCallbacks.splice(i, 1);
      };
    },
    hasUnsavedChanges: (): boolean => {
      try { return !!editorInstance?.hasUnsavedChanges?.(); } catch { return false; }
    },
    getDirtyFiles: (): string[] => {
      try {
        if (!editorInstance) return [];
        const files = editorInstance.getOpenFiles();
        return files.filter((f: string) => {
          try { return (editorInstance as any).isDirty?.(f); } catch { return false; }
        });
      } catch { return []; }
    },
    openFile: async (filePath: string) => {
      grid.ensurePanel('editor');
      if (editorInstance) {
        await editorInstance.openFile(filePath);
        persistOpenFiles();
      }
    },
    dispose: () => {
      // Zavřít všechna plovoucí okna patřící tomuto workspace
      for (const [panelId] of panelPopoutMap) {
        try { levis.closePopoutPanel(panelId); } catch {}
      }
      panelPopoutMap.clear();
      if (devLogUnsub) devLogUnsub();
      if (devPtyId) { try { levis.killPty(devPtyId); } catch {} }
      if (devLogPanel) devLogPanel.remove();
      for (const t of termInstances) t.dispose();
      if (editorInstance) editorInstance.dispose();
      if (diffInstance) diffInstance.dispose();
      if (fileTreeInstance) fileTreeInstance.dispose();
      browserInstance.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

(window as any).createWorkspace = createWorkspace;
