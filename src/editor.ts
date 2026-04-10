// ── Monaco Editor Integration (multi-file tabs) ───────────

interface EditorInstance {
  element: HTMLElement;
  openFile: (filePath: string) => Promise<void>;
  closeFile: (filePath: string) => Promise<boolean>;
  getValue: () => string;
  getFilePath: () => string | null;
  getSelection: () => string | null;
  getOpenFiles: () => string[];
  hasUnsavedChanges: () => boolean;
  onFilesChange: (cb: (files: string[]) => void) => () => void;
  dispose: () => void;
}

interface OpenFileEntry {
  model: any;          // monaco.ITextModel
  viewState: any;      // monaco.editor.ICodeEditorViewState
  isDirty: boolean;
}

// Monaco se loaduje pres svuj AMD loader. V Electronu s nodeIntegration
// je `require` Node CJS, takze AMD loader by se zaregistroval jako CJS modul
// misto nastaveni globalniho require. Docasne schovame module/exports.
let monacoLoadPromise: Promise<any> | null = null;
function loadMonaco(): Promise<any> {
  if ((window as any).monaco) return Promise.resolve((window as any).monaco);
  if (monacoLoadPromise) return monacoLoadPromise;
  monacoLoadPromise = new Promise((resolve, reject) => {
    const w = window as any;
    const nodeRequire = w.require;
    const savedModule = w.module;
    const savedExports = w.exports;
    // Schovat CJS prostredi aby se loader.js zaregistroval jako AMD globalne
    try { delete w.module; } catch { w.module = undefined; }
    try { delete w.exports; } catch { w.exports = undefined; }

    const script = document.createElement('script');
    script.src = '../node_modules/monaco-editor/min/vs/loader.js';
    script.onload = () => {
      const amdRequire = w.require;
      try {
        amdRequire.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
        amdRequire(['vs/editor/editor.main'], () => {
          // Obnovit Node require + module/exports
          w.require = nodeRequire;
          w.module = savedModule;
          w.exports = savedExports;
          resolve(w.monaco);
        });
      } catch (err) {
        w.require = nodeRequire;
        w.module = savedModule;
        w.exports = savedExports;
        reject(err);
      }
    };
    script.onerror = (e) => {
      w.require = nodeRequire;
      w.module = savedModule;
      w.exports = savedExports;
      reject(new Error('Monaco loader.js se nepodarilo nacist'));
    };
    document.head.appendChild(script);
  });
  return monacoLoadPromise;
}

async function createEditor(container: HTMLElement): Promise<EditorInstance> {
  const fontSize = Number((await levis.storeGet('editorFontSize'))) || 14;
  const wrapper = document.createElement('div');
  wrapper.className = 'editor-panel';

  // Editor tab bar (multi-file tabs)
  const tabBar = document.createElement('div');
  tabBar.className = 'editor-tabbar';
  const _I = (window as any).icon;
  tabBar.innerHTML = `
    <div class="editor-tabs"></div>
    <span style="flex:1"></span>
    <button class="editor-save" title="${t('editor.save')}">${_I('save')} ${t('ws.btnSave')}</button>
  `;
  wrapper.appendChild(tabBar);

  // Monaco container
  const monacoContainer = document.createElement('div');
  monacoContainer.className = 'editor-monaco-container';
  wrapper.appendChild(monacoContainer);

  container.appendChild(wrapper);

  // Show loading state
  const loadingEl = document.createElement('div');
  loadingEl.className = 'loading';
  loadingEl.textContent = 'Načítám editor...';
  monacoContainer.appendChild(loadingEl);

  let monaco: any = null;
  let editor: any = null;
  let pendingFile: string | null = null;
  let currentFilePath: string | null = null;
  const openFiles = new Map<string, OpenFileEntry>();
  const filesChangeListeners: Array<(f: string[]) => void> = [];
  function notifyFilesChange(): void {
    const files = Array.from(openFiles.keys());
    for (const cb of filesChangeListeners) try { cb(files); } catch {}
  }
  const tabsHost = tabBar.querySelector('.editor-tabs') as HTMLElement;
  const saveBtn = tabBar.querySelector('.editor-save') as HTMLElement;

  loadMonaco().then((m) => {
    monaco = m;
    loadingEl.remove();
    initMonaco();
    if (pendingFile) openFile(pendingFile);
  }).catch((err) => {
    loadingEl.textContent = 'Chyba při načítání editoru: ' + (err?.message || err);
    showToast(t('editor.loadFailed'), 'error');
  });

  function initMonaco(): void {
  // Set dark theme
  monaco.editor.defineTheme('levis-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6b6b80', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c084fc' },
      { token: 'string', foreground: '10b981' },
      { token: 'number', foreground: 'f59e0b' },
      { token: 'type', foreground: '06b6d4' },
      { token: 'function', foreground: '60a5fa' },
    ],
    colors: {
      'editor.background': '#0a0a0f',
      'editor.foreground': '#e8e8f0',
      'editor.lineHighlightBackground': '#1a1a2440',
      'editor.selectionBackground': '#ff6a0033',
      'editorCursor.foreground': '#ff6a00',
      'editorLineNumber.foreground': '#6b6b80',
      'editorLineNumber.activeForeground': '#e8e8f0',
      'editor.inactiveSelectionBackground': '#ff6a0022',
      'editorIndentGuide.background': '#2a2a38',
      'editorIndentGuide.activeBackground': '#ff6a0044',
      'editorWidget.background': '#111118',
      'editorWidget.border': '#2a2a38',
      'input.background': '#1a1a24',
      'input.border': '#2a2a38',
      'input.foreground': '#e8e8f0',
      'scrollbarSlider.background': '#2a2a3866',
      'scrollbarSlider.hoverBackground': '#6b6b8066',
      'editor.findMatchBackground': '#ff6a0099',
      'editor.findMatchHighlightBackground': '#ff6a0044',
      'editor.findMatchBorder': '#ff6a00',
      'editor.findMatchHighlightBorder': '#ff6a0066',
    },
  });

  monaco.editor.setTheme('levis-dark');

  editor = monaco.editor.create(monacoContainer, {
    value: '// Otevři soubor ze stromu vlevo\n',
    language: 'typescript',
    theme: 'levis-dark',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize,
    lineNumbers: 'on',
    minimap: { enabled: true, maxColumn: 80 },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    wordWrap: 'on',
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    padding: { top: 8 },
    // Fixne hover widgety (color picker, suggestions) v body — neclipuje cell overflow
    fixedOverflowWidgets: true,
  });

  // Force layout after render
  requestAnimationFrame(() => editor.layout());

  // Ctrl+S shortcut (musi byt po vytvoreni editoru)
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveFile());
  // Ctrl+W zavřít aktuální tab
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => {
    if (currentFilePath) closeFile(currentFilePath);
  });
  } // konec initMonaco

  function basename(p: string): string {
    return p.replace(/\\/g, '/').split('/').pop() || p;
  }

  function renderTabs(): void {
    tabsHost.innerHTML = '';
    if (openFiles.size === 0) {
      const empty = document.createElement('span');
      empty.className = 'editor-tab-empty';
      empty.textContent = 'Žádný otevřený soubor';
      tabsHost.appendChild(empty);
      saveBtn.classList.remove('editor-save-dirty');
      return;
    }
    for (const [path, entry] of openFiles) {
      const tab = document.createElement('div');
      tab.className = 'editor-tab' + (path === currentFilePath ? ' editor-tab-active' : '') + (entry.isDirty ? ' editor-tab-dirty' : '');
      tab.title = path;
      tab.innerHTML = `
        <span class="editor-tab-name">${escapeHtmlE(basename(path))}</span>
        <button class="editor-tab-close" title="${t('editor.close')}">${_I('close', { size: 12 })}</button>
      `;
      tab.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.editor-tab-close')) return;
        activateFile(path);
      });
      tab.querySelector('.editor-tab-close')!.addEventListener('click', (e) => {
        e.stopPropagation();
        closeFile(path);
      });
      tab.addEventListener('mousedown', (e) => {
        // Middle click = close
        if (e.button === 1) { e.preventDefault(); closeFile(path); }
      });
      tabsHost.appendChild(tab);
    }
    saveBtn.classList.toggle('editor-save-dirty', openFiles.get(currentFilePath || '')?.isDirty === true);
  }

  function escapeHtmlE(s: string): string {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function activateFile(filePath: string): void {
    const entry = openFiles.get(filePath);
    if (!entry || !editor) return;
    // Save view state aktivního před přepnutím
    if (currentFilePath && openFiles.has(currentFilePath)) {
      try { openFiles.get(currentFilePath)!.viewState = editor.saveViewState(); } catch {}
    }
    editor.setModel(entry.model);
    if (entry.viewState) {
      try { editor.restoreViewState(entry.viewState); } catch {}
    }
    currentFilePath = filePath;
    renderTabs();
    requestAnimationFrame(() => { try { editor.layout(); editor.focus(); } catch {} });
  }

  async function openFile(filePath: string): Promise<void> {
    if (!monaco || !editor) {
      pendingFile = filePath;
      return;
    }
    // Už otevřené → jen aktivovat
    if (openFiles.has(filePath)) {
      activateFile(filePath);
      return;
    }
    try {
      const content = await levis.readFile(filePath);
      if (content && typeof content === 'object' && (content as any).error) {
        showToast(`Chyba: ${(content as any).error}`, 'error');
        return;
      }
      if (typeof content !== 'string') {
        showToast(t('editor.binary'), 'error');
        return;
      }
      const lang = await levis.getLanguage(filePath);
      const model = monaco.editor.createModel(content, lang);
      // Dirty listener per-model
      model.onDidChangeContent(() => {
        const e = openFiles.get(filePath);
        if (!e) return;
        if (!e.isDirty) {
          e.isDirty = true;
          renderTabs();
        }
      });
      openFiles.set(filePath, { model, viewState: null, isDirty: false });
      activateFile(filePath);
      notifyFilesChange();
    } catch (err) {
      showToast(t('editor.error', { msg: (err as any)?.message || String(err) }), 'error');
      console.error('[editor.openFile]', err);
    }
  }

  async function closeFile(filePath: string): Promise<boolean> {
    const entry = openFiles.get(filePath);
    if (!entry) return true;
    if (entry.isDirty) {
      const choice = await askChoice(
        `Soubor ${basename(filePath)} má neuložené změny`,
        ['Uložit', 'Zahodit', 'Zrušit']
      );
      if (choice === 'Zrušit' || choice === null) return false;
      if (choice === 'Uložit') {
        const ok = await saveFile(filePath);
        if (!ok) return false;
      }
    }
    try { entry.model.dispose(); } catch {}
    openFiles.delete(filePath);
    notifyFilesChange();
    if (currentFilePath === filePath) {
      // Přepnout na poslední otevřený nebo prázdný stav
      const remaining = Array.from(openFiles.keys());
      if (remaining.length > 0) {
        activateFile(remaining[remaining.length - 1]);
      } else {
        currentFilePath = null;
        editor.setModel(monaco.editor.createModel('// Otevři soubor ze stromu vlevo\n', 'plaintext'));
      }
    }
    renderTabs();
    return true;
  }

  async function saveFile(filePath?: string): Promise<boolean> {
    const path = filePath || currentFilePath;
    if (!path || !editor) return false;
    const entry = openFiles.get(path);
    if (!entry) return false;
    // Format on save (jen pokud je to aktivní soubor — Monaco pracuje s aktivním modelem)
    if (path === currentFilePath) {
      try {
        const action = editor.getAction('editor.action.formatDocument');
        if (action) await action.run();
      } catch { /* některé jazyky neformátují */ }
    }
    const content = entry.model.getValue();
    const result = await levis.writeFile(path, content);
    if (result.error) {
      showToast(`Chyba při ukládání: ${result.error}`, 'error');
      return false;
    }
    entry.isDirty = false;
    renderTabs();
    showToast(`Uloženo: ${basename(path)}`, 'success');
    return true;
  }

  // Modal s 3 volbami pro dirty check
  function askChoice(message: string, options: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'editor-choice-overlay';
      overlay.innerHTML = `
        <div class="editor-choice-box">
          <div class="editor-choice-msg">${escapeHtmlE(message)}</div>
          <div class="editor-choice-btns">
            ${options.map(o => `<button class="editor-choice-btn" data-opt="${escapeHtmlE(o)}">${escapeHtmlE(o)}</button>`).join('')}
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const cleanup = () => overlay.remove();
      overlay.querySelectorAll('.editor-choice-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const opt = btn.getAttribute('data-opt');
          cleanup();
          resolve(opt);
        });
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { cleanup(); resolve(null); }
      });
      const escHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { cleanup(); document.removeEventListener('keydown', escHandler); resolve(null); }
      };
      document.addEventListener('keydown', escHandler);
    });
  }

  saveBtn.addEventListener('click', () => saveFile());

  // Initial render — empty state
  renderTabs();

  // Drag & drop souboru do editoru (z OS / file tree)
  wrapper.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    wrapper.classList.add('editor-drop-active');
  });
  wrapper.addEventListener('dragleave', (e: DragEvent) => {
    if (e.target === wrapper) wrapper.classList.remove('editor-drop-active');
  });
  wrapper.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    wrapper.classList.remove('editor-drop-active');
    // 1) OS file drop — File.path je absolutni cesta v Electronu
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const p = (files[0] as any).path;
      if (p) { openFile(p); return; }
    }
    // 2) Interni drag (file tree) — text/plain s cestou
    const txt = e.dataTransfer?.getData('text/plain');
    if (txt) openFile(txt);
  });

  return {
    element: wrapper,
    openFile,
    closeFile,
    getValue: () => editor ? editor.getValue() : '',
    getFilePath: () => currentFilePath,
    getSelection: (): string | null => {
      if (!editor) return null;
      const sel = editor.getSelection();
      if (!sel || sel.isEmpty()) return null;
      return editor.getModel()?.getValueInRange(sel) || null;
    },
    getOpenFiles: () => Array.from(openFiles.keys()),
    hasUnsavedChanges: () => Array.from(openFiles.values()).some(e => e.isDirty),
    onFilesChange: (cb: (files: string[]) => void) => {
      filesChangeListeners.push(cb);
      return () => {
        const i = filesChangeListeners.indexOf(cb);
        if (i !== -1) filesChangeListeners.splice(i, 1);
      };
    },
    dispose: () => {
      // Dispose všech modelů
      for (const e of openFiles.values()) {
        try { e.model.dispose(); } catch {}
      }
      openFiles.clear();
      if (editor) editor.dispose();
      wrapper.remove();
    },
  };
}

(window as any).createEditor = createEditor;
