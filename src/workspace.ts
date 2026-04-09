// ── Workspace (project tab layout) ──────

interface WorkspaceInstance {
  element: HTMLElement;
  getActiveTerminals: () => Array<{ label: string; state: 'idle' | 'working' | 'waiting' }>;
  onCCDone: (cb: () => void) => () => void;
  hasUnsavedChanges: () => boolean;
  getDirtyFiles: () => string[];
  // Otevřít soubor v editoru (pro Ctrl+P quick file open)
  openFile: (filePath: string) => Promise<void>;
  dispose: () => void;
}

type RightPanel = 'browser' | 'artifact' | 'mobile' | 'hidden';
type WsPanelId = 'terminal' | 'editor' | 'diff' | 'browser' | 'artifact' | 'mobile';

const PANEL_LABELS: Record<WsPanelId, { icon: string; text: string }> = {
  terminal: { icon: (window as any).icon('terminal'), text: 'Terminál' },
  editor:   { icon: (window as any).icon('editor'),   text: 'Editor' },
  diff:     { icon: (window as any).icon('git'),      text: 'Git změny' },
  browser:  { icon: (window as any).icon('browser'),  text: 'Prohlížeč' },
  artifact: { icon: (window as any).icon('preview'),  text: 'Náhled' },
  mobile:   { icon: (window as any).icon('mobile'),   text: 'Mobil' },
};

async function createWorkspace(projectPath: string, projectName: string): Promise<WorkspaceInstance> {
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
      <button class="ws-panel-tab ws-btn-toggle-sidebar" title="Skrýt/zobrazit panel souborů">${I('sidebar')}</button>
      <button class="ws-panel-tab ws-btn-sidebar-side" title="Přehodit sidebar vlevo/vpravo">${I('swap')}</button>
      <span class="ws-toolbar-divider"></span>
      <button class="ws-panel-tab ws-btn-add-panel" title="Přidat panel do workspace">${I('plus')} Panel</button>
      <button class="ws-panel-tab ws-btn-reset-layout" title="Obnovit výchozí rozložení panelů">${I('refresh')}</button>
      <button class="ws-panel-tab ws-btn-equalize-layout" title="Zarovnat panely na stejnou velikost">${I('equalize')}</button>
      <button class="ws-panel-tab ws-btn-lock-layout" title="Zamknout rovnoměrné rozložení (vypne volný resize)">${I('lock')}</button>
    </div>
    <span style="flex:1"></span>
    <div class="ws-right-tabs">
      <button class="ws-panel-tab ws-btn-popout" title="Vysunout náhled na druhý monitor">${I('arrow-up')} Vysunout</button>
    </div>
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
  sidebarSplitter.className = 'splitter sidebar-splitter';
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

  const artifactPanel = document.createElement('div');
  artifactPanel.className = 'panel-artifact';
  artifactPanel.dataset.rpanel = 'artifact';

  const mobilePanel = document.createElement('div');
  mobilePanel.className = 'panel-mobile';
  mobilePanel.dataset.rpanel = 'mobile';

  const panelEls: Record<WsPanelId, HTMLElement> = {
    terminal: termPanel,
    editor: editorPanel,
    diff: diffPanel,
    browser: browserPanel,
    artifact: artifactPanel,
    mobile: mobilePanel,
  };

  // ── Status Bar (replaces CC Bar) ──────
  const statusBar = document.createElement('div');
  statusBar.className = 'status-bar';
  statusBar.innerHTML = `
    <span class="status-project">${projectName}</span>
    <span class="status-branch">...</span>
    <span class="status-sizes"></span>
    <span style="flex:1"></span>
    <button class="status-btn status-btn-save" title="/takjo — uložit změny lokálně (git add + commit)">${I('save')} Uložit</button>
    <button class="status-btn status-btn-push" title="/jeb — uložit a odeslat na GitHub (commit + push)">${I('upload')} Odeslat</button>
    <button class="status-btn status-btn-pull" title="Git pull — stáhnout změny z GitHubu">${I('download')} Stáhnout</button>
    <button class="status-btn status-btn-restart" title="Ukončit a znovu spustit Claude Code v terminálu">${I('restart')} CC</button>
    <button class="status-btn status-btn-split" title="Otevřít další terminál vedle stávajícího (max 3)">${I('plus')} Terminál</button>
    <button class="status-btn status-btn-devlog" title="Log dev serveru (npm run dev output)" style="display:none">${I('file')} Dev log</button>
  `;
  wrapper.appendChild(statusBar);

  // ── Auto-generate CLAUDE.md ───────────
  levis.generateClaudeMd(projectPath).then((r: any) => {
    if (r.success) showToast('CLAUDE.md vygenerován', 'info');
  }).catch(() => {});

  // ── Project type detection ─────────────
  let autoCommand: string | undefined = undefined;
  let termCwd = projectPath;

  // Detect Expo / web framework — pro auto-spousteni dev serveru a Mobile panelu
  let isExpo = false;
  let devCommand: string | null = null;
  let isWebApp = false;
  let hasNoPreview = false; // Electron, Tauri, CLI, knihovna
  try {
    const pkgRaw = await levis.readFile(projectPath + '\\package.json');
    if (typeof pkgRaw === 'string') {
      const pkg = JSON.parse(pkgRaw);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      isExpo = !!deps.expo;
      isWebApp = !!(deps.vite || deps.next || deps['react-scripts'] || deps.astro || deps.nuxt || deps['@sveltejs/kit'] || deps.remix);
      const isElectron = !!deps.electron;
      const isTauri = !!(deps['@tauri-apps/api'] || deps['@tauri-apps/cli']);
      hasNoPreview = isElectron || isTauri || (!isExpo && !isWebApp);
      const scripts: Record<string, string> = pkg.scripts || {};
      // Expo: preferuj `npm run web` (spusti web build na portu 8081), ne `npm start` (interaktivni Metro menu)
      // BROWSER=none zabrani Expo otevrit Chrome s localhostem
      if (isExpo && scripts.web) devCommand = "$env:BROWSER='none'; npm run web";
      else if (scripts.dev) devCommand = 'npm run dev';
      else if (scripts.start) devCommand = 'npm start';
      else if (scripts.serve) devCommand = 'npm run serve';
    }
  } catch {
    // Bez package.json — vanilla web (index.html), ne non-preview
  }
  // Tauri bez package.json
  if (!hasNoPreview) {
    try {
      const tauriConf = await levis.readFile(projectPath + '\\src-tauri\\tauri.conf.json');
      if (typeof tauriConf === 'string') hasNoPreview = true;
    } catch {}
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
      showToast('Max 3 terminály', 'warning');
      return;
    }
    const termSlot = document.createElement('div');
    termSlot.className = 'term-slot';
    termContainer.appendChild(termSlot);

    // Add splitter between terminals
    if (termInstances.length > 0) {
      const tSplitter = document.createElement('div');
      tSplitter.className = 'splitter term-splitter';
      termSlot.before(tSplitter);
      setupDragSplitter(tSplitter, 'horizontal', termContainer);
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
          showToast('Poslední terminál nelze zavřít', 'warning');
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

  const browserInstance = createBrowser(browserPanel);
  const artifactInstance = createArtifact(artifactPanel, projectPath);
  const mobileInstance = createMobile(mobilePanel, projectPath, projectName);

  // Auto-load index.html do náhledu pokud existuje (vanilla weby)
  // Spouští se po krátkém delayi, aby měl grid čas zmountovat artifact panel.
  setTimeout(async () => {
    const sep = projectPath.includes('\\') ? '\\' : '/';
    const candidates = [
      projectPath + sep + 'index.html',
      projectPath + sep + 'public' + sep + 'index.html',
      projectPath + sep + 'src' + sep + 'index.html',
    ];
    for (const candidate of candidates) {
      try {
        const content = await levis.readFile(candidate);
        if (typeof content === 'string') {
          artifactInstance.loadFile(candidate);
          break;
        }
      } catch {}
    }
  }, 200);

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
      showToast('Dev server selhal: ' + (err as any)?.message, 'error');
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
        if (panel === 'artifact') {
          await popoutArtifact();
          poppedPanels.add('artifact');
        } else if (panel === 'browser') {
          await levis.popout({ type: 'browser' });
          poppedPanels.add('browser');
        } else if (panel === 'mobile') {
          await levis.popout({ type: 'mobile' });
          poppedPanels.add('mobile');
        } else if (panel === 'editor') {
          const files = editorInstance?.getOpenFiles?.() || [];
          const r = await levis.popoutPanel({ panelType: 'editor', payload: { files, projectPath, projectName } });
          if (r?.panelId) panelPopoutMap.set(r.panelId, 'editor');
        } else if (panel === 'terminal') {
          const first = termInstances[0];
          const firstPty = first?.ptyId;
          // Dumpni buffer aby popout terminal viděl historii
          let initial = '';
          try {
            if (first?.term) {
              const buf = first.term.buffer.active;
              const lines: string[] = [];
              for (let i = 0; i < buf.length; i++) {
                const line = buf.getLine(i);
                if (line) lines.push(line.translateToString(true));
              }
              initial = lines.join('\r\n');
            }
          } catch {}
          const r = await levis.popoutPanel({ panelType: 'terminal', payload: { ptyId: firstPty, projectPath, projectName, initial } });
          if (r?.panelId) panelPopoutMap.set(r.panelId, 'terminal');
        } else {
          showToast(`Panel "${PANEL_LABELS[panel].text}" zatím nepodporuje popout`, 'warning');
          return;
        }
        grid.removePanel(panel);
        showToast(`${PANEL_LABELS[panel].text} v plovoucím okně`, 'info');
      } catch (err) {
        console.error('[popout] selhal:', err);
        showToast('Popout selhal', 'error');
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
  if (isExpo || isWebApp) {
    grid.ensurePanel('mobile');
  } else if (!hasNoPreview) {
    grid.ensurePanel('artifact');
  }
  STAGE('grid: done');

  if ((isExpo || isWebApp) && devCommand) {
    switchRightPanel('mobile');
    startBackgroundDevPty(termCwd, devCommand);
    // Zobraz tlacitko Dev log v statusbaru
    const btnDevLog = statusBar.querySelector('.status-btn-devlog') as HTMLElement;
    if (btnDevLog) btnDevLog.style.display = '';
    setTimeout(() => mobileInstance.start(), isExpo ? 12000 : 4000);
  } else if (isExpo) {
    switchRightPanel('mobile');
  } else if (hasNoPreview) {
    // Electron/Tauri/CLI/knihovna — pravy panel je k nicemu, defaultne editor pres celou sirku
    switchRightPanel('hidden');
    switchLeftPanel('editor');
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
      // Klik v file tree → vždy jen editor. Náhled / prohlížeč si user otevře sám.
      switchLeftPanel('editor');
      if (editorInstance) await editorInstance.openFile(filePath);
    });
  } catch (err) {
    sidebarContainer.innerHTML = `<div class="loading">Chyba file tree</div>`;
  }

  // ── Git branch for status bar ─────────
  const branchEl = statusBar.querySelector('.status-branch') as HTMLElement;
  function updateGitStatus(): void {
    levis.gitStatus(projectPath).then((status: any) => {
      if (status.current) {
        const dirty = status.files && status.files.length > 0;
        branchEl.textContent = status.current + (dirty ? ' \u25CF' : '');
        branchEl.title = dirty ? `${status.files.length} změněných souborů` : 'Git clean';
      } else {
        branchEl.textContent = '';
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
      for (const p of ['browser', 'artifact', 'mobile'] as WsPanelId[]) {
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
    showToast(`Soubory: ${sidebarSide === 'left' ? 'vlevo' : 'vpravo'}`, 'info');
  });

  // Reset layout
  const btnResetLayout = wsToolbar.querySelector('.ws-btn-reset-layout') as HTMLElement;
  btnResetLayout?.addEventListener('click', () => {
    grid.setState(GridMod.defaultGridState());
    persistLayout();
    showToast('Layout obnoven', 'info');
  });

  const btnAddPanel = wsToolbar.querySelector('.ws-btn-add-panel') as HTMLElement;
  btnAddPanel?.addEventListener('click', () => grid.openPicker());

  const btnEqualizeLayout = wsToolbar.querySelector('.ws-btn-equalize-layout') as HTMLElement;
  btnEqualizeLayout?.addEventListener('click', () => {
    grid.equalize();
    persistLayout();
    showToast('Panely zarovnány', 'info');
  });

  const btnLockLayout = wsToolbar.querySelector('.ws-btn-lock-layout') as HTMLElement;
  btnLockLayout?.addEventListener('click', () => {
    grid.toggleLock();
    btnLockLayout.classList.toggle('ws-tab-active', grid.getState().locked);
    persistLayout();
  });

  // ── Splitter utility (no memory leak) ──
  function setupDragSplitter(
    handle: HTMLElement,
    direction: 'vertical' | 'horizontal',
    parent: HTMLElement
  ): void {
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      handle.classList.add('dragging');

      const onMove = (e: MouseEvent) => {
        const rect = parent.getBoundingClientRect();
        if (direction === 'vertical') {
          const pct = ((e.clientX - rect.left) / rect.width) * 100;
          const prev = handle.previousElementSibling as HTMLElement;
          if (prev) prev.style.width = `${Math.min(70, Math.max(30, pct))}%`;
        }
        for (const t of termInstances) {
          try { t.fitAddon.fit(); } catch {}
        }
      };

      const onUp = () => {
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
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
    sidebarContainer.style.width = `${Math.min(400, Math.max(120, ev.clientX - rect.left))}px`;
  });

  // ── Status bar actions ────────────────
  function sendToFirstTerminal(text: string): void {
    const first = termInstances[0];
    if (first) {
      switchLeftPanel('terminal');
      levis.writePty(first.ptyId, text + '\r');
    }
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
    showToast('Claude Code restartován', 'info');
  });

  statusBar.querySelector('.status-btn-split')!.addEventListener('click', () => {
    switchLeftPanel('terminal');
    addTerminal();
  });

  statusBar.querySelector('.status-btn-save')!.addEventListener('click', () => {
    sendToFirstTerminal('/takjo');
    showToast('Posílám /takjo...', 'info');
  });

  statusBar.querySelector('.status-btn-push')!.addEventListener('click', () => {
    sendToFirstTerminal('/jeb');
    showToast('Posílám /jeb (push)...', 'info');
  });

  statusBar.querySelector('.status-btn-pull')!.addEventListener('click', async () => {
    showToast('Stahuji z GitHubu...', 'info');
    const result = await levis.gitPull(projectPath);
    if (result.error) showToast(`Pull chyba: ${result.error}`, 'error');
    else showToast('Pull OK', 'success');
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
        if (fileTreeInstance) fileTreeInstance.refresh();
      }, 2000);
    });
    cleanups.push(unsubAutoRefresh);
  }

  // ── Refresh on window focus ───────────
  // Pouze artifact + git branch — file tree a velikosti se obnovuji jen
  // po dojeti commandu (PTY idle) nebo manualnim refreshi z toolbaru.
  const onWindowFocus = () => {
    artifactInstance.refresh();
    updateGitStatus();
  };
  window.addEventListener('focus', onWindowFocus);
  cleanups.push(() => window.removeEventListener('focus', onWindowFocus));

  // ── Pop-out button ────────────────────
  let poppedOut = false;
  async function popoutArtifact(): Promise<void> {
    let filePath = artifactInstance.getFilePath?.() || null;
    // Fallback: pokud artifact nemá načtený soubor, najdi index.html v projektu
    if (!filePath) {
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
      type: 'artifact',
      filePath: filePath || undefined,
    });
    grid.removePanel('artifact');
    poppedOut = true;
    poppedPanels.add('artifact');
    showToast('Preview otevřen v plovoucím okně', 'info');
  }
  wsToolbar.querySelector('.ws-btn-popout')!.addEventListener('click', popoutArtifact);

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
    for (const p of ['artifact', 'browser', 'mobile'] as WsPanelId[]) {
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

  // Ctrl+Enter — send editor selection to terminal
  // Ctrl+Shift+V — reload artifact preview
  const onWorkspaceKeys = (e: KeyboardEvent) => {
    if (e.ctrlKey && !e.shiftKey && e.key === 'Enter' && editorInstance) {
      const sel = editorInstance.getSelection();
      if (sel) {
        e.preventDefault();
        sendToFirstTerminal(sel);
        showToast('Odesláno do terminálu', 'info');
      }
    }
    if (e.ctrlKey && e.shiftKey && e.key === 'V') {
      e.preventDefault();
      artifactInstance.refresh();
      levis.popoutRefresh();
      showToast('Preview obnoven', 'info');
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

  // CC done event — pro tab badge v app.ts
  const ccDoneCallbacks: Array<() => void> = [];
  // Hook do termInstances — když některý terminál přejde z working → idle
  function attachTermStateWatcher(): void {
    for (const t of termInstances) {
      if (t._badgeWatcherAttached) continue;
      if (typeof t.onStateChange !== 'function') continue;
      let prevState = t.getState ? t.getState() : 'idle';
      let workingSince = 0;
      t.onStateChange((s: string) => {
        if (s === 'working' && prevState !== 'working') {
          workingSince = Date.now();
        }
        // CC dokončil práci: working → (idle nebo waiting na input).
        // Vyžaduj minimálně 1.5s working ať nepípáme na krátké blicky.
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
      if (devLogUnsub) devLogUnsub();
      if (devPtyId) { try { levis.killPty(devPtyId); } catch {} }
      if (devLogPanel) devLogPanel.remove();
      for (const t of termInstances) t.dispose();
      if (editorInstance) editorInstance.dispose();
      if (diffInstance) diffInstance.dispose();
      if (fileTreeInstance) fileTreeInstance.dispose();
      browserInstance.dispose();
      artifactInstance.dispose();
      mobileInstance.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

(window as any).createWorkspace = createWorkspace;
