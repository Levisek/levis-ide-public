// ── Terminal (xterm.js + node-pty) ──────
//
// xterm a addony se loaduji jako UMD <script> v index.html (pred touto
// soubor). To znamena ze `Terminal` a addony jsou na window. Nepouzivame
// require() — renderer bezi s contextIsolation:true a nodeIntegration:false.
const Terminal: any = (window as any).Terminal;
const FitAddon: any = (window as any).FitAddon?.FitAddon;
const WebLinksAddon: any = (window as any).WebLinksAddon?.WebLinksAddon;
const SearchAddon: any = (window as any).SearchAddon?.SearchAddon;
const WebglAddon: any = (window as any).WebglAddon?.WebglAddon || null;

interface TerminalInstance {
  ptyId: string;
  term: any;
  fitAddon: any;
  searchAddon: any;
  container: HTMLElement;
  toggleSearch: () => void;
  clear: () => void;
  close: () => void;
  getState: () => 'idle' | 'working' | 'waiting';
  onStateChange: (cb: (state: 'idle' | 'working' | 'waiting') => void) => () => void;
  dispose: () => void;
}

async function createTerminal(
  container: HTMLElement,
  cwd: string,
  projectName: string,
  autoCommand?: string,
  label?: string
): Promise<TerminalInstance> {
  // Status dot overlay (v rohu pane, žádný toolbar)
  const statusDot = document.createElement('span');
  statusDot.className = 'term-status-dot term-status-idle';
  statusDot.title = t('terminal.status');
  container.style.position = 'relative';
  container.appendChild(statusDot);

  // Status detector
  const ccDetector = new ((window as any).CCStateDetector)();
  let currentState: 'idle' | 'working' | 'waiting' = 'idle';
  let stateTimer: any = null;
  const stateListeners: Array<(s: 'idle' | 'working' | 'waiting') => void> = [];
  function setState(s: 'idle' | 'working' | 'waiting'): void {
    if (currentState === s) return;
    currentState = s;
    statusDot.classList.remove('term-status-idle', 'term-status-working', 'term-status-waiting');
    statusDot.classList.add('term-status-' + s);
    statusDot.title = s === 'idle' ? t('terminal.stateIdle') : s === 'working' ? t('terminal.stateWorking') : t('terminal.stateWaiting');
    for (const cb of stateListeners) try { cb(s); } catch {}
  }

  // Terminal container
  const termContainer = document.createElement('div');
  termContainer.className = 'terminal-container';
  container.appendChild(termContainer);

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const fontSize = Number((await levis.storeGet('terminalFontSize'))) || 13;

  function buildTermTheme(): any {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => (cs.getPropertyValue(name).trim() || fallback);
    const bg = v('--term-bg', '#15161c');
    const fg = v('--term-fg', '#c8cbd5');
    return {
      background: bg,
      foreground: fg,
      cursor: v('--term-cursor', '#ff7a1a'),
      cursorAccent: bg,
      selectionBackground: v('--term-selection', '#ff7a1a33'),
      selectionForeground: fg,
      black: '#1a1a24',
      red: '#ef4444',
      green: '#10b981',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#a855f7',
      cyan: '#06b6d4',
      white: fg,
      brightBlack: '#6b6b80',
      brightRed: '#f87171',
      brightGreen: '#34d399',
      brightYellow: '#fbbf24',
      brightBlue: '#60a5fa',
      brightMagenta: '#c084fc',
      brightCyan: '#22d3ee',
      brightWhite: '#ffffff',
    };
  }

  const term = new Terminal({
    theme: buildTermTheme(),
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
    fontSize,
    lineHeight: 1.1,
    cursorBlink: true,
    allowTransparency: true,
    scrollback: 10000,
  });

  // Reaguj na změnu tématu (data-theme na <html>)
  const themeObserver = new MutationObserver(() => {
    try { term.options.theme = buildTermTheme(); } catch {}
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.loadAddon(searchAddon);
  term.open(termContainer);

  // PTY id — vytvori se nize, ale handlery na nej drzi closure referenci.
  // Buffer pro data prijata pred tim, nez xterm zavola term.open() / fit (early output).
  let ptyId: string = '';
  let earlyBuffer: string[] = [];
  let termReady = false;

  // Auto-scroll: pokud je uživatel na konci (nebo blízko), scrollneme při novém výstupu
  let userScrolledUp = false;
  term.onScroll(() => {
    const buf = term.buffer.active;
    userScrolledUp = buf.viewportY < buf.baseY - 3;
  });

  // Subscribni listener PRED createPty, jinak ztratime prvni vypisy (banner, chyby)
  const unsubData = levis.onPtyData((id: string, data: string) => {
    if (id !== ptyId) return;
    if (termReady) {
      term.write(data);
      if (!userScrolledUp) term.scrollToBottom();
    }
    else earlyBuffer.push(data);
    // CC state — feed do detektoru, debounce a vyhodnoť skutečný stav z bufferu.
    // Žádné brute force "data → working → idle" které dělalo notifikace na každý burst.
    ccDetector.feed(data);
    if (stateTimer) clearTimeout(stateTimer);
    // Dokud data tečou, považuj za working
    setState('working');
    // Po 600ms ticha vyhodnoť idle/working (waiting odstraněn — nespolehlivý)
    stateTimer = setTimeout(() => {
      try {
        const real = ccDetector.detect();
        setState(real === 'waiting' ? 'working' : real);
      } catch {
        setState('idle');
      }
    }, 600);
  });
  const unsubExit = levis.onPtyExit((id: string) => {
    if (id === ptyId) term.write('\r\n\x1b[33m[Process exited]\x1b[0m\r\n');
  });

  // Ctrl+V paste, Ctrl+C copy — xterm jinak posle raw \x16/\x03
  // Pouze keydown handler (jeden zdroj pravdy, zadny native paste listener
  // ktery by mohl vest k duplikatu).
  term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    if (e.type !== 'keydown') return true;
    // Globální app shortcuts — nech projít do document keydown listeneru.
    // Bez toho xterm eventy konzumuje a Ctrl+Tab a spol. nefungují z fokusu v terminálu.
    const isMod = e.ctrlKey || e.metaKey;
    if (isMod && e.key === 'Tab') return false;
    if (isMod && e.shiftKey) {
      const k = e.key.toUpperCase();
      if (k === 'P' || k === 'O' || k === 'F' || k === 'T' || k === 'R' || k === 'W') return false;
      if (e.code === 'Comma') return false;
    }
    if (e.key === 'F1') return false;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      e.stopPropagation();
      (async () => {
        // Zkus text
        const text = await levis.clipboardRead();
        if (text) { levis.writePty(ptyId, text); return; }
        // Zkus obrázek — ulož PNG a pošli cestu do CC
        if (levis.clipboardReadImage) {
          const imgPath = await levis.clipboardReadImage(cwd);
          if (imgPath) {
            const rel = imgPath.replace(/\\/g, '/').replace(cwd.replace(/\\/g, '/') + '/', '');
            levis.writePty(ptyId, rel);
          }
        }
      })().catch(() => {});
      return false;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && term.hasSelection()) {
      levis.clipboardWrite(term.getSelection());
      return false;
    }
    // Shift+Enter — line continuation (backslash + enter, jako v bashi)
    if (e.shiftKey && !e.ctrlKey && !e.altKey && e.key === 'Enter') {
      levis.writePty(ptyId, '\\\r');
      return false;
    }
    return true;
  });

  // WebGL renderer vypnutý — canvas je stabilnější (WebGL má rendering artefakty na některých GPU)
  // if (WebglAddon) {
  //   try {
  //     const webgl = new WebglAddon();
  //     webgl.onContextLoss(() => { webgl.dispose(); });
  //     term.loadAddon(webgl);
  //   } catch {}
  // }

  // Delay fit until container is in DOM and has real dimensions
  // Multiple frames needed because workspace appends wrapper async
  let fitRetries = 0;
  function tryFit(): void {
    try {
      const rect = termContainer.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 50) {
        fitAddon.fit();
      } else if (fitRetries < 20) {
        fitRetries++;
        requestAnimationFrame(tryFit);
      }
    } catch {}
  }
  requestAnimationFrame(tryFit);

  // ── Drag & drop souborů z file tree do terminálu ──
  termContainer.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  termContainer.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    if (!ptyId) return;
    // OS file drag (z plochy / průzkumníku)
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const fp = (files[i] as any).path;
        if (fp) paths.push(`"${fp}"`);
      }
      if (paths.length > 0) {
        levis.writePty(ptyId, paths.join(' ') + ' ');
        return;
      }
    }
    // Fallback: items s getAsFile
    const items = e.dataTransfer?.items;
    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          const fp = file && (file as any).path;
          if (fp) {
            levis.writePty(ptyId, `"${fp}" `);
            return;
          }
        }
      }
    }
    // Interní drag (file tree)
    const path = e.dataTransfer?.getData('text/plain');
    if (path) {
      levis.writePty(ptyId, `"${path}" `);
    }
  });

  // ── Pravý klik context menu (Copy / Paste) ──
  termContainer.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    // Odstraň starý menu
    document.querySelectorAll('.term-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'term-context-menu';
    const hasSel = term.hasSelection();
    menu.innerHTML = `
      <div class="tcm-item${hasSel ? '' : ' tcm-disabled'}" data-act="copy">${t('ws.copy')}</div>
      <div class="tcm-item" data-act="paste">${t('ws.paste')}</div>
    `;
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    document.body.appendChild(menu);
    menu.querySelectorAll('.tcm-item:not(.tcm-disabled)').forEach(item => {
      item.addEventListener('click', async () => {
        const act = (item as HTMLElement).dataset.act;
        menu.remove();
        if (act === 'copy' && hasSel) {
          levis.clipboardWrite(term.getSelection());
        } else if (act === 'paste') {
          const text = await levis.clipboardRead();
          if (text && ptyId) levis.writePty(ptyId, text);
        }
      });
    });
    setTimeout(() => {
      const close = (ev: MouseEvent) => {
        if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener('click', close); }
      };
      document.addEventListener('click', close);
    }, 0);
  });

  // Create PTY
  ptyId = await levis.createPty(cwd);

  // Flush early buffer ted, kdyz uz mame ptyId
  termReady = true;
  for (const chunk of earlyBuffer) term.write(chunk);
  earlyBuffer = [];

  // Sync initial size after PTY created
  requestAnimationFrame(() => {
    try {
      fitAddon.fit();
      levis.resizePty(ptyId, term.cols, term.rows);
    } catch {}
  });

  // Connect xterm <-> pty
  term.onData((data: string) => {
    levis.writePty(ptyId, data);
    // Uživatel píše → scroll dolů
    userScrolledUp = false;
    term.scrollToBottom();
  });

  // Handle resize — debounced to avoid rapid fire
  let resizeTimer: any = null;
  const resizeObserver = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      try {
        fitAddon.fit();
        levis.resizePty(ptyId, term.cols, term.rows);
      } catch {}
    }, 50);
  });
  resizeObserver.observe(termContainer);

  // Auto-launch: pokud autoCommand je shell command (nezacina /), spust ho primo bez claude.
  // Pokud zacina / (napr. /rubej), spust claude a pak posli command.
  // Pokud neni autoCommand, spust claude.
  setTimeout(() => {
    const isShellCmd = autoCommand && !autoCommand.startsWith('/');
    if (isShellCmd) {
      levis.writePty(ptyId, autoCommand + '\r');
    } else {
      levis.writePty(ptyId, 'claude\r');
      if (autoCommand) {
        setTimeout(() => levis.writePty(ptyId, autoCommand + '\r'), 3000);
      }
    }
  }, 1000);

  // Search bar (toggled from grid header)
  let searchBarVisible = false;
  let searchBar: HTMLElement | null = null;

  function toggleSearch(): void {
    if (searchBarVisible && searchBar) {
      searchBar.remove();
      searchBarVisible = false;
      return;
    }
    searchBar = document.createElement('div');
    searchBar.className = 'term-search-bar';
    searchBar.innerHTML = `<input type="text" class="term-search-input" placeholder="${t('terminal.searchPh')}">`;
    container.insertBefore(searchBar, termContainer);
    searchBarVisible = true;
    const input = searchBar.querySelector('.term-search-input') as HTMLInputElement;
    input.focus();
    input.addEventListener('input', () => searchAddon.findNext(input.value));
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') searchAddon.findNext(input.value);
      if (e.key === 'Escape') toggleSearch();
    });
  }

  return {
    ptyId,
    term,
    fitAddon,
    searchAddon,
    container,
    toggleSearch,
    clear: () => term.clear(),
    close: () => container.dispatchEvent(new CustomEvent('term-close')),
    getState: () => currentState,
    onStateChange: (cb) => {
      stateListeners.push(cb);
      return () => {
        const i = stateListeners.indexOf(cb);
        if (i >= 0) stateListeners.splice(i, 1);
      };
    },
    dispose: () => {
      unsubData();
      unsubExit();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      if (stateTimer) clearTimeout(stateTimer);
      levis.killPty(ptyId);
      term.dispose();
    },
  };
}

(window as any).createTerminal = createTerminal;
