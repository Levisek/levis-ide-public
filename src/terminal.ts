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
  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'terminal-toolbar';
  const labelHtml = label ? ` <span class="terminal-label">${label}</span>` : '';
  const I = (window as any).icon;
  toolbar.innerHTML = `
    <span class="term-status-dot term-status-idle" title="Stav terminálu"></span>
    <span class="project-label">${projectName}</span>${labelHtml}
    <span style="flex:1"></span>
    <button class="btn-search-term" title="Hledat v terminálu (Ctrl+F)">${I('search')}</button>
    <button class="btn-restart" title="Restartovat Claude Code (Ctrl+C, cls, claude)">${I('restart')} Restart CC</button>
    <button class="btn-clear" title="Vyčistit terminál">${I('clear')} Clear</button>
    <button class="btn-close-term" title="Zavřít terminál">${I('close')}</button>
  `;
  container.appendChild(toolbar);

  // Status detector
  const ccDetector = new ((window as any).CCStateDetector)();
  const statusDot = toolbar.querySelector('.term-status-dot') as HTMLElement;
  let currentState: 'idle' | 'working' | 'waiting' = 'idle';
  let stateTimer: any = null;
  const stateListeners: Array<(s: 'idle' | 'working' | 'waiting') => void> = [];
  function setState(s: 'idle' | 'working' | 'waiting'): void {
    if (currentState === s) return;
    currentState = s;
    statusDot.classList.remove('term-status-idle', 'term-status-working', 'term-status-waiting');
    statusDot.classList.add('term-status-' + s);
    statusDot.title = s === 'idle' ? 'Idle — čeká na input' : s === 'working' ? 'Working — CC pracuje' : 'Waiting — CC se ptá';
    for (const cb of stateListeners) try { cb(s); } catch {}
  }

  // Terminal container
  const termContainer = document.createElement('div');
  termContainer.className = 'terminal-container';
  container.appendChild(termContainer);

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const fontSize = Number((await levis.storeGet('terminalFontSize'))) || 13;

  const term = new Terminal({
    theme: {
      background: '#0a0a0f',
      foreground: '#e8e8f0',
      cursor: '#ff6a00',
      cursorAccent: '#0a0a0f',
      selectionBackground: '#ff6a0033',
      selectionForeground: '#e8e8f0',
      black: '#1a1a24',
      red: '#ef4444',
      green: '#10b981',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#a855f7',
      cyan: '#06b6d4',
      white: '#e8e8f0',
      brightBlack: '#6b6b80',
      brightRed: '#f87171',
      brightGreen: '#34d399',
      brightYellow: '#fbbf24',
      brightBlue: '#60a5fa',
      brightMagenta: '#c084fc',
      brightCyan: '#22d3ee',
      brightWhite: '#ffffff',
    },
    fontFamily: "'JetBrains Mono', monospace",
    fontSize,
    cursorBlink: true,
    allowTransparency: true,
    scrollback: 10000,
  });

  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.loadAddon(searchAddon);
  term.open(termContainer);

  // PTY id — vytvori se nize, ale handlery na nej drzi closure referenci.
  // Buffer pro data prijata pred tim, nez xterm zavola term.open() / fit (early output).
  let ptyId: string = '';
  let earlyBuffer: string[] = [];
  let termReady = false;

  // Subscribni listener PRED createPty, jinak ztratime prvni vypisy (banner, chyby)
  const unsubData = levis.onPtyData((id: string, data: string) => {
    if (id !== ptyId) return;
    if (termReady) term.write(data);
    else earlyBuffer.push(data);
    // CC state — feed do detektoru, debounce a vyhodnoť skutečný stav z bufferu.
    // Žádné brute force "data → working → idle" které dělalo notifikace na každý burst.
    ccDetector.feed(data);
    if (stateTimer) clearTimeout(stateTimer);
    // Dokud data tečou, považuj za working
    setState('working');
    // Po 600ms ticha vyhodnoť skutečný stav z bufferu (idle/working/waiting)
    stateTimer = setTimeout(() => {
      try {
        const real = ccDetector.detect();
        setState(real);
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
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
      levis.clipboardRead().then((text) => {
        if (text) levis.writePty(ptyId, text);
      }).catch(() => {});
      return false;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C') && term.hasSelection()) {
      levis.clipboardWrite(term.getSelection());
      return false;
    }
    // Shift+Enter — backslash + newline (CC i mnoho REPL apps to bere jako line continuation)
    if (e.shiftKey && !e.ctrlKey && !e.altKey && e.key === 'Enter') {
      levis.writePty(ptyId, '\\\r\n');
      return false;
    }
    return true;
  });

  // Try WebGL renderer for performance
  if (WebglAddon) {
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL not available, fallback to canvas
    }
  }

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
  term.onData((data: string) => levis.writePty(ptyId, data));

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

  // Toolbar buttons
  const btnSearch = toolbar.querySelector('.btn-search-term') as HTMLElement;
  const btnRestart = toolbar.querySelector('.btn-restart') as HTMLElement;
  const btnClear = toolbar.querySelector('.btn-clear') as HTMLElement;

  let searchBarVisible = false;
  let searchBar: HTMLElement | null = null;

  btnSearch.addEventListener('click', () => {
    if (searchBarVisible && searchBar) {
      searchBar.remove();
      searchBarVisible = false;
      return;
    }
    searchBar = document.createElement('div');
    searchBar.className = 'term-search-bar';
    searchBar.innerHTML = `<input type="text" class="term-search-input" placeholder="Hledat v terminálu...">`;
    toolbar.after(searchBar);
    searchBarVisible = true;
    const input = searchBar.querySelector('.term-search-input') as HTMLInputElement;
    input.focus();
    input.addEventListener('input', () => searchAddon.findNext(input.value));
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') searchAddon.findNext(input.value);
      if (e.key === 'Escape') {
        searchBar!.remove();
        searchBarVisible = false;
      }
    });
  });

  btnRestart.addEventListener('click', () => {
    levis.writePty(ptyId, '\x03');
    setTimeout(() => levis.writePty(ptyId, 'claude\r'), 500);
  });

  btnClear.addEventListener('click', () => term.clear());

  // Close button — dispatches custom event so workspace can handle removal
  const btnCloseTerm = toolbar.querySelector('.btn-close-term') as HTMLElement;
  btnCloseTerm.addEventListener('click', () => {
    container.dispatchEvent(new CustomEvent('term-close'));
  });

  return {
    ptyId,
    term,
    fitAddon,
    searchAddon,
    container,
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
      if (stateTimer) clearTimeout(stateTimer);
      levis.killPty(ptyId);
      term.dispose();
    },
  };
}

(window as any).createTerminal = createTerminal;
