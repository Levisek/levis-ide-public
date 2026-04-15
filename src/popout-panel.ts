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

  if (data.panelType === 'terminal') {
    const termCount = data.payload.terminals?.length ?? 1;
    titleEl.textContent = `Terminál — ${data.payload.projectName || ''} (${termCount})`;
    initTerminalPanel(contentEl, data.payload);
  } else if (data.panelType === 'editor') {
    titleEl.textContent = `Editor — ${data.payload.projectName || ''}`;
    initEditorPanel(contentEl, data.payload);
  }
});

window.addEventListener('DOMContentLoaded', () => {
  if (myPanelId) {
    panelApi.notifyReady?.(myPanelId);
  }
});

// Window controls
document.getElementById('panel-min')!.addEventListener('click', () => panelApi.minimize(myPanelId));
document.getElementById('panel-max')!.addEventListener('click', () => panelApi.toggleMaximize(myPanelId));
document.getElementById('panel-close')!.addEventListener('click', () => panelApi.close(myPanelId));
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

  const instances: Array<{ term: any; fit: any; container: HTMLElement; ptyId: string; unsubs: Array<() => void> }> = [];

  for (let i = 0; i < terminals.length; i++) {
    const entry = terminals[i];
    const slot = document.createElement('div');
    slot.style.cssText = 'flex:1; padding:2px; min-width:0; min-height:0; overflow:hidden; background:var(--term-bg, #15161c); transition: box-shadow .15s ease;';
    slot.addEventListener('mousedown', () => {
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
    term.open(slot);
    // WebGL vypnutý — canvas stabilnější
    // if (Wgl) { try { term.loadAddon(new Wgl()); } catch {} }

    if (entry.initial) { try { term.write(entry.initial); } catch {} }

    const ptyId = entry.ptyId;
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

    instances.push({ term, fit, container: slot, ptyId, unsubs: [unsubData, unsubExit] });
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
