// ── Popout panel renderer ──────────────
// Spouští se v plovoucím Electron okně (popout-panel.html).
// Načte typ panelu (terminal / editor) a vykreslí ho s napojením na PTY / fs přes panelApi.

declare const panelApi: any;

interface PanelLoadData {
  panelId: string;
  panelType: 'terminal' | 'editor';
  payload: any;
}

// PanelId z URL hash — spolehlivě dostupný hned po load, bez race condition
let myPanelId = window.location.hash.slice(1) || '';

panelApi.onAssignId?.((panelId: string) => {
  if (!myPanelId) myPanelId = panelId;
});

panelApi.onLoad((data: PanelLoadData) => {
  myPanelId = data.panelId;
  const titleEl = document.getElementById('panel-title')!;
  const contentEl = document.getElementById('panel-content')!;
  const tt = (window as any).t as (key: string, p?: Record<string, string | number>) => string;

  if (data.panelType === 'terminal') {
    const termCount = data.payload.terminals?.length ?? 1;
    titleEl.textContent = tt('panel.terminalTitle', { project: data.payload.projectName || '', n: termCount });
    initTerminalPanel(contentEl, data.payload);
  } else if (data.panelType === 'editor') {
    titleEl.textContent = tt('panel.editorTitle', { file: data.payload.projectName || '' });
    initEditorPanel(contentEl, data.payload);
  }
});

window.addEventListener('DOMContentLoaded', () => {
  // Zapojení i18n: načti locale a přelož DOM atributy (data-i18n-title)
  (window as any).initI18n?.().then(() => (window as any).applyI18nDom?.(document));
  if (myPanelId) {
    panelApi.notifyReady?.(myPanelId);
  }
});

// Window controls
document.getElementById('panel-min')!.addEventListener('click', () => panelApi.minimize(myPanelId));
document.getElementById('panel-max')!.addEventListener('click', () => panelApi.toggleMaximize(myPanelId));
document.getElementById('panel-close')!.addEventListener('click', () => panelApi.close(myPanelId));
document.getElementById('panel-fullscreen')?.addEventListener('click', () => panelApi.toggleFullscreen?.(myPanelId));
// Vrátit panel zpět do hlavního workspace
document.getElementById('panel-return')!.addEventListener('click', () => {
  if (panelApi.returnToWorkspace) {
    panelApi.returnToWorkspace(myPanelId);
  } else {
    // Fallback: jen zavři okno, hlavní okno detekuje a může re-add panel
    panelApi.close(myPanelId);
  }
});

// ── Terminal panel (multi-terminal s tab barem) ──
interface TermEntry { ptyId: string; label: string; initial?: string }

async function initTerminalPanel(host: HTMLElement, payload: any): Promise<void> {
  const T: any = (window as any).Terminal;
  const Fit: any = (window as any).FitAddon?.FitAddon;
  const Web: any = (window as any).WebLinksAddon?.WebLinksAddon;
  const Wgl: any = (window as any).WebglAddon?.WebglAddon || null;
  const Search: any = (window as any).SearchAddon?.SearchAddon || null;

  // Normalizace: starý formát (single ptyId) → nový (terminals pole)
  const terminals: TermEntry[] = payload.terminals
    ? payload.terminals
    : [{ ptyId: payload.ptyId, label: 'Terminal 1', initial: payload.initial }];

  console.log('[popout-panel] initTerminal', { count: terminals.length });
  if (typeof T !== 'function') {
    host.innerHTML = '<div style="color:#ef4444;padding:20px;font-family:monospace;">CHYBA: window.Terminal není načtený. xterm UMD se nepovedlo.</div>';
    return;
  }

  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  host.style.flex = '1';
  host.style.minHeight = '0';

  const fontSize = Number(await panelApi.storeGet('terminalFontSize')) || 13;

  function buildTermTheme(): any {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fb: string) => (cs.getPropertyValue(name).trim() || fb);
    const bg = v('--term-bg', '#15161c');
    const fg = v('--term-fg', '#c8cbd5');
    return {
      background: bg, foreground: fg, cursor: v('--term-cursor', '#ff7a1a'),
      cursorAccent: bg, selectionBackground: v('--term-selection', '#ff7a1a33'),
      black: '#1a1a24', red: '#ef4444', green: '#10b981', yellow: '#f59e0b',
      blue: '#3b82f6', magenta: '#a855f7', cyan: '#06b6d4', white: fg,
      brightBlack: '#6b6b80', brightRed: '#f87171', brightGreen: '#34d399',
      brightYellow: '#fbbf24', brightBlue: '#60a5fa', brightMagenta: '#c084fc',
      brightCyan: '#22d3ee', brightWhite: '#ffffff',
    };
  }

  // Tiled layout — terminály vedle sebe (jako tmux/VS Code split)
  const termContainer = document.createElement('div');
  termContainer.style.cssText = 'flex:1; display:flex; gap:4px; min-height:0; overflow:hidden;';
  host.appendChild(termContainer);

  const instances: Array<{ term: any; fit: any; search: any; container: HTMLElement; ptyId: string; unsubs: Array<() => void> }> = [];
  let activeIdx = 0;
  const projectPath: string = payload.projectPath || '';

  // Factory pro jeden terminal slot — použito při init i při split
  function addTermSlot(ptyId: string, initial?: string): void {
    const slot = document.createElement('div');
    slot.style.cssText = 'flex:1; padding:2px; min-width:0; min-height:0; overflow:hidden; background:var(--term-bg, #15161c); transition: box-shadow .15s ease; position:relative;';
    slot.addEventListener('mousedown', () => {
      activeIdx = instances.findIndex(x => x.container === slot);
      termContainer.querySelectorAll(':scope > div').forEach((s) => {
        (s as HTMLElement).style.boxShadow = '';
      });
      slot.style.boxShadow = 'inset 0 2px 0 #ff7a1a';
    });
    termContainer.appendChild(slot);

    const term = new T({
      theme: buildTermTheme(),
      fontFamily: "'JetBrains Mono', monospace",
      fontSize,
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 10000,
    });

    const fit = new Fit();
    term.loadAddon(fit);
    if (Web) term.loadAddon(new Web());
    const search = Search ? new Search() : null;
    if (search) term.loadAddon(search);
    term.open(slot);

    if (initial) { try { term.write(initial); } catch {} }

    const unsubData = panelApi.onPtyData((id: string, data: string) => {
      if (id === ptyId) term.write(data);
    });
    const unsubExit = panelApi.onPtyExit((id: string) => {
      if (id === ptyId) term.write('\r\n\x1b[33m[Process exited]\x1b[0m\r\n');
    });
    term.onData((data: string) => panelApi.writePty(ptyId, data));

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        panelApi.clipboardRead().then((text: string) => {
          if (text) panelApi.writePty(ptyId, text);
        }).catch(() => {});
        return false;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && term.hasSelection()) {
        panelApi.clipboardWrite(term.getSelection());
        return false;
      }
      if (e.shiftKey && !e.ctrlKey && !e.altKey && e.key === 'Enter') {
        panelApi.writePty(ptyId, '\\\r\n');
        return false;
      }
      return true;
    });

    // Close button — skryt na prvním, ostatní smí být zavřené
    if (instances.length > 0) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'lvi-popbtn';
      closeBtn.style.cssText = 'position:absolute;top:4px;right:4px;z-index:5;background:var(--bg-elev-1);opacity:.5;';
      closeBtn.onmouseenter = () => { closeBtn.style.opacity = '1'; };
      closeBtn.onmouseleave = () => { closeBtn.style.opacity = '.5'; };
      closeBtn.title = 'Zavřít terminál';
      closeBtn.innerHTML = '<svg class="lvi" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = instances.findIndex(x => x.container === slot);
        if (idx < 0 || instances.length <= 1) return;
        const inst = instances[idx];
        inst.unsubs.forEach(u => u());
        try { inst.term.dispose(); } catch {}
        try { panelApi.killPty?.(inst.ptyId); } catch {}
        slot.remove();
        instances.splice(idx, 1);
        if (activeIdx >= instances.length) activeIdx = instances.length - 1;
        requestAnimationFrame(fitAll);
      });
      slot.appendChild(closeBtn);
    }

    instances.push({ term, fit, search, container: slot, ptyId, unsubs: [unsubData, unsubExit] });
  }

  for (let i = 0; i < terminals.length; i++) {
    const entry = terminals[i];
    addTermSlot(entry.ptyId, entry.initial);
  }

  // ── Akční lišta v top baru (search + clear) — napojená na aktivní instanci ──
  const actionsHost = document.getElementById('panel-actions');
  if (actionsHost) {
    actionsHost.innerHTML = '';
    const tt = (window as any).t as (key: string) => string;
    const mkBtn = (titleKey: string, fallback: string, svg: string, onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.className = 'lvi-popbtn';
      btn.title = tt?.(titleKey) || fallback;
      btn.setAttribute('data-i18n-title', titleKey);
      btn.innerHTML = svg;
      btn.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
      return btn;
    };
    const iconSearch = '<svg class="lvi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    const iconClear  = '<svg class="lvi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
    const iconEqualize = '<svg class="lvi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="21"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="18" y1="3" x2="18" y2="21"/></svg>';
    const iconSplit = '<svg class="lvi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>';

    // Search overlay — malý inline input na top baru, hledá v aktivním terminálu
    let searchBar: HTMLElement | null = null;
    const toggleSearch = (): void => {
      if (searchBar) { searchBar.remove(); searchBar = null; return; }
      const inst = instances[activeIdx] || instances[0];
      if (!inst?.search) return;
      searchBar = document.createElement('div');
      searchBar.className = 'term-search-bar';
      searchBar.style.cssText = 'position:absolute;top:42px;left:50%;transform:translateX(-50%);z-index:20;';
      searchBar.innerHTML = `<input type="text" class="term-search-input" placeholder="${tt?.('terminal.searchPh') || 'Hledat…'}">`;
      document.body.appendChild(searchBar);
      const input = searchBar.querySelector('.term-search-input') as HTMLInputElement;
      input.focus();
      input.addEventListener('input', () => { try { inst.search.findNext(input.value); } catch {} });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { try { inst.search.findNext(input.value); } catch {} }
        if (e.key === 'Escape') toggleSearch();
      });
    };

    actionsHost.appendChild(mkBtn('terminal.search', 'Hledat (Ctrl+F)', iconSearch, toggleSearch));
    actionsHost.appendChild(mkBtn('terminal.clear', 'Vyčistit', iconClear, () => {
      const inst = instances[activeIdx] || instances[0];
      try { inst?.term.clear(); } catch {}
    }));
    actionsHost.appendChild(mkBtn('ws.equalizeTerminals', 'Vyrovnat šířky terminálů', iconEqualize, () => {
      termContainer.querySelectorAll(':scope > div').forEach((s) => {
        (s as HTMLElement).style.flex = '1';
        (s as HTMLElement).style.width = '';
      });
      requestAnimationFrame(fitAll);
    }));
    actionsHost.appendChild(mkBtn('ws.newTerminal', 'Otevřít další terminál (max 3)', iconSplit, async () => {
      if (instances.length >= 3) {
        try { const ts = (window as any).showToast; ts?.(tt?.('toast.maxTerminals') || 'Max 3 terminály', 'warning'); } catch {}
        return;
      }
      if (!projectPath) {
        try { const ts = (window as any).showToast; ts?.('Chybí projectPath — nelze vytvořit PTY', 'error'); } catch {}
        return;
      }
      try {
        const newPtyId: string = await panelApi.createPty(projectPath);
        addTermSlot(newPtyId);
        requestAnimationFrame(fitAll);
      } catch (err) {
        console.error('[popout-panel] split createPty selhalo', err);
      }
    }));

    // Přelož nově vložené data-i18n-title atributy
    (window as any).applyI18nDom?.(actionsHost);
  }

  // Fit all terminals
  function fitAll(): void {
    for (const inst of instances) {
      try {
        const r = inst.container.getBoundingClientRect();
        if (r.width > 50 && r.height > 50) {
          inst.fit.fit();
          panelApi.resizePty(inst.ptyId, inst.term.cols, inst.term.rows);
        }
      } catch {}
    }
  }
  requestAnimationFrame(fitAll);
  const ro = new ResizeObserver(() => fitAll());
  ro.observe(termContainer);
  window.addEventListener('resize', fitAll);

  const themeObs = new MutationObserver(() => {
    const theme = buildTermTheme();
    for (const inst of instances) { try { inst.term.options.theme = theme; } catch {} }
  });
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  window.addEventListener('beforeunload', () => {
    for (const inst of instances) inst.unsubs.forEach(u => u());
    ro.disconnect();
    themeObs.disconnect();
  });
}

// ── Editor panel (Monaco) ──
let monacoLoadPromisePopout: Promise<any> | null = null;
function loadMonacoPopout(): Promise<any> {
  if ((window as any).monaco) return Promise.resolve((window as any).monaco);
  if (monacoLoadPromisePopout) return monacoLoadPromisePopout;
  monacoLoadPromisePopout = new Promise((resolve, reject) => {
    const w = window as any;
    const nodeRequire = w.require;
    const savedModule = w.module;
    const savedExports = w.exports;
    try { delete w.module; } catch { w.module = undefined; }
    try { delete w.exports; } catch { w.exports = undefined; }
    const script = document.createElement('script');
    script.src = '../node_modules/monaco-editor/min/vs/loader.js';
    script.onload = () => {
      const amdRequire = w.require;
      try {
        amdRequire.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
        amdRequire(['vs/editor/editor.main'], () => {
          w.require = nodeRequire;
          w.module = savedModule;
          w.exports = savedExports;
          resolve(w.monaco);
        });
      } catch (err) {
        w.require = nodeRequire; w.module = savedModule; w.exports = savedExports;
        reject(err);
      }
    };
    script.onerror = (e) => {
      w.require = nodeRequire; w.module = savedModule; w.exports = savedExports;
      reject(e);
    };
    document.head.appendChild(script);
  });
  return monacoLoadPromisePopout;
}

function basenamePop(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() || p;
}

interface EditorPayload {
  files?: string[];
  openFiles?: string[];
  activeFile?: string | null;
  projectPath?: string;
  projectName?: string;
}

async function initEditorPanel(host: HTMLElement, payload: EditorPayload): Promise<void> {
  const filePaths = payload.files || payload.openFiles || [];
  const wrap = document.createElement('div');
  wrap.style.cssText = 'flex:1; display:flex; flex-direction:column; min-height:0;';

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.style.cssText = 'display:flex; align-items:center; gap:6px; padding:6px 10px; background:#1e2029; border-bottom:1px solid #2d303c; overflow-x:auto; flex-shrink:0;';
  wrap.appendChild(tabBar);

  // Editor host
  const editorHost = document.createElement('div');
  editorHost.style.cssText = 'flex:1; min-height:0;';
  wrap.appendChild(editorHost);
  host.appendChild(wrap);

  // Načti Monaco
  const loading = document.createElement('div');
  loading.textContent = 'Načítám editor...';
  loading.style.cssText = 'flex:1; display:flex; align-items:center; justify-content:center; color:#82859a; font-size:13px;';
  editorHost.appendChild(loading);

  let monaco: any;
  try {
    monaco = await loadMonacoPopout();
  } catch (err) {
    loading.textContent = 'Monaco se nepodařilo načíst: ' + String(err);
    return;
  }

  loading.remove();

  const editor = monaco.editor.create(editorHost, {
    theme: 'vs-dark',
    automaticLayout: true,
    fontSize: Number(await panelApi.storeGet('editorFontSize')) || 14,
    fontFamily: "'JetBrains Mono', monospace",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: 'on',
    wordWrap: 'on',
  });

  // Models per soubor
  const models = new Map<string, any>();
  let currentPath: string | null = null;

  async function openFile(path: string): Promise<void> {
    if (!models.has(path)) {
      const content = await panelApi.readFile(path);
      if (typeof content !== 'string') return;
      const lang = await panelApi.getLanguage(path).catch(() => 'plaintext');
      const model = monaco.editor.createModel(content, lang || 'plaintext');
      models.set(path, model);
    }
    editor.setModel(models.get(path));
    currentPath = path;
    // Aktualizuj tab styl
    tabBar.querySelectorAll('button').forEach((b: any) => {
      b.style.background = b.dataset.path === path ? '#272a35' : 'transparent';
      b.style.color = b.dataset.path === path ? '#ff7a1a' : '#b8bac8';
    });
  }

  // Vykresli taby
  for (const fp of filePaths) {
    const tab = document.createElement('button');
    tab.dataset.path = fp;
    tab.textContent = basenamePop(fp);
    tab.title = fp;
    tab.style.cssText = 'background:transparent; border:1px solid #2d303c; color:#b8bac8; padding:4px 12px; border-radius:12px; font-family:Inter,sans-serif; font-size:11px; cursor:pointer; white-space:nowrap;';
    tab.addEventListener('click', () => openFile(fp));
    tabBar.appendChild(tab);
  }

  // Otevři první soubor
  if (filePaths.length > 0) {
    await openFile(payload.activeFile && filePaths.includes(payload.activeFile) ? payload.activeFile : filePaths[0]);
  }

  // Save shortcut Ctrl+S
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
    if (!currentPath) return;
    const value = editor.getValue();
    try {
      await panelApi.writeFile(currentPath, value);
      editor.getModel()?.pushStackElement();
    } catch (err) {
      console.error('Save failed:', err);
    }
  });
}
