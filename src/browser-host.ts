// ── Browser Host abstraction ─────────────────────────
// Sdílený interface pro browser-core.ts (renderer-agnostic).
// Dva impl: LevisHost (hlavní okno přes window.levis), PopoutHost (popout, doplníme v Task 10).
//
// Loaduje se jako <script> tag — žádný ES module export. Factory visí na window.

interface IBrowserHost {
  /** Pošle prompt do CC terminálu. main: workspace.sendToFirstTerminal; popout: IPC → main → workspace. */
  sendPromptToCC(text: string, submit: boolean): Promise<void>;

  /** electron-store get */
  storeGet<T = unknown>(key: string): Promise<T | undefined>;

  /** electron-store set */
  storeSet<T = unknown>(key: string, value: T): Promise<void>;

  /** Clipboard text read */
  clipboardRead(): Promise<string>;

  /** Clipboard text write */
  clipboardWrite(text: string): Promise<void>;

  /** Lasso PNG screenshot — uloží region z hlavního BrowserWindow do savePath. */
  captureRegion(rect: { x: number; y: number; width: number; height: number }, savePath: string): Promise<void>;

  /** Cleanup .levis-tmp adresáře — smaže staré PNG screenshoty. */
  cleanupCapture(tmpDir: string): Promise<void>;

  /** Registruje listener na CC working→idle přechod. Vrací unregister fn. */
  onCCDone(cb: () => void): () => void;

  /** Absolutní cesta k root projektu (pro lasso PNG cestu). */
  getProjectRoot(): string;

  /** Touch emulation přes CDP — id je webContentsId guest webview (getWebContentsId). */
  mobileEnableTouch(webContentsId: number): Promise<boolean>;
  mobileDisableTouch(webContentsId: number): Promise<boolean>;
  mobileSetColorScheme(webContentsId: number, scheme: 'dark' | 'light'): Promise<boolean>;

  /** Per-projekt preference (pin URL, panelsSwapped …). */
  getProjectPrefs(projectPath: string): Promise<Record<string, unknown> | undefined>;
  setProjectPref(projectPath: string, key: string, value: unknown): Promise<void>;

  /** OS file dialog (Open file…). */
  openFileDialog(multi?: boolean): Promise<string[] | null>;

  /** Read file (probe pro index.html detection v browser.ts initial load). */
  readFile(filePath: string): Promise<string | { error: string }>;
}

// ── WorkspaceWindow — minimální typ pro window.workspace (exponovaný z app.ts) ─────────────────

interface WorkspaceWindow {
  sendToFirstTerminal?: (text: string, submit?: boolean, bypassQueue?: boolean) => void;
  onCCDone?: (cb: () => void) => () => void;
}

// ── LevisHost — pro hlavní okno (window.levis) ─────────────────────────

function createLevisHost(projectPath: string): IBrowserHost {
  return {
    async sendPromptToCC(text, submit) {
      const ws = (window as { workspace?: WorkspaceWindow }).workspace;
      if (ws && typeof ws.sendToFirstTerminal === 'function') {
        ws.sendToFirstTerminal(text, submit, false);
      }
    },

    storeGet<T = unknown>(key: string): Promise<T | undefined> {
      return levis.storeGet(key) as Promise<T | undefined>;
    },

    storeSet<T = unknown>(key: string, value: T): Promise<void> {
      return levis.storeSet(key, value as unknown);
    },

    clipboardRead(): Promise<string> {
      return levis.clipboardRead();
    },

    clipboardWrite(text: string): Promise<void> {
      // levis.clipboardWrite je void, obalíme do Promise
      levis.clipboardWrite(text);
      return Promise.resolve();
    },

    async captureRegion(rect, savePath) {
      const result = await levis.captureRegion(rect, savePath);
      if (!result?.success) throw new Error(result?.error ?? 'captureRegion failed');
    },

    async cleanupCapture(tmpDir) {
      await levis.captureCleanup(tmpDir);
    },

    onCCDone(cb) {
      const ws = (window as { workspace?: WorkspaceWindow }).workspace;
      if (ws && typeof ws.onCCDone === 'function') {
        return ws.onCCDone(cb);
      }
      return () => {};
    },

    getProjectRoot() {
      return projectPath;
    },

    mobileEnableTouch(id) { return levis.mobileEnableTouch(id); },
    mobileDisableTouch(id) { return levis.mobileDisableTouch(id); },
    mobileSetColorScheme(id, scheme) { return levis.mobileSetColorScheme(id, scheme); },

    getProjectPrefs(p) { return levis.getProjectPrefs(p) as Promise<Record<string, unknown> | undefined>; },
    async setProjectPref(p, key, value) { await levis.setProjectPref(p, key, value); },

    openFileDialog(multi) { return levis.openFileDialog(multi); },

    readFile(f) { return levis.readFile(f); },
  };
}

(window as unknown as { createLevisHost: typeof createLevisHost }).createLevisHost = createLevisHost;

// ── PopoutHost — pro pop-out preview okno (window.popoutApi) ─────────────────────────

interface PopoutApiShape {
  sendPrompt: (payload: { text: string; submit: boolean }) => void;
  storeGet: <T = unknown>(key: string) => Promise<T | undefined>;
  storeSet: <T = unknown>(key: string, value: T) => Promise<void>;
  clipboardRead: () => string;
  clipboardWrite: (text: string) => void;
  captureRegion: (rect: { x: number; y: number; width: number; height: number }, savePath: string) => Promise<{ success?: boolean; error?: string; path?: string }>;
  captureCleanup: (tmpDir: string) => Promise<{ success?: boolean; error?: string }>;
  onCCDone: (cb: () => void) => () => void;
  mobileEnableTouch: (id: number) => Promise<boolean>;
  mobileDisableTouch: (id: number) => Promise<boolean>;
  mobileSetColorScheme: (id: number, scheme: 'dark' | 'light') => Promise<boolean>;
  getProjectPrefs: (projectPath: string) => Promise<Record<string, unknown> | undefined>;
  setProjectPref: (projectPath: string, key: string, value: unknown) => Promise<void>;
  openFileDialog: (multi?: boolean) => Promise<string[] | null>;
  readFile: (filePath: string) => Promise<string | { error: string }>;
}

function createPopoutHost(projectPath: string): IBrowserHost {
  const api = (window as unknown as { popoutApi: PopoutApiShape }).popoutApi;
  return {
    async sendPromptToCC(text, submit) {
      // Popout nemá přímý přístup k termu → forward přes main → workspace queue.
      api.sendPrompt({ text, submit });
    },
    storeGet<T = unknown>(key: string): Promise<T | undefined> {
      return api.storeGet<T>(key);
    },
    storeSet<T = unknown>(key: string, value: T): Promise<void> {
      return api.storeSet<T>(key, value);
    },
    clipboardRead(): Promise<string> {
      return Promise.resolve(api.clipboardRead());
    },
    clipboardWrite(text: string): Promise<void> {
      api.clipboardWrite(text);
      return Promise.resolve();
    },
    async captureRegion(rect, savePath) {
      const result = await api.captureRegion(rect, savePath);
      if (!result?.success) throw new Error(result?.error ?? 'captureRegion failed');
    },
    async cleanupCapture(tmpDir) {
      await api.captureCleanup(tmpDir);
    },
    onCCDone(cb) {
      return api.onCCDone(cb);
    },
    getProjectRoot() {
      return projectPath;
    },
    mobileEnableTouch(id) { return api.mobileEnableTouch(id); },
    mobileDisableTouch(id) { return api.mobileDisableTouch(id); },
    mobileSetColorScheme(id, scheme) { return api.mobileSetColorScheme(id, scheme); },
    getProjectPrefs(p) { return api.getProjectPrefs(p); },
    setProjectPref(p, key, value) { return api.setProjectPref(p, key, value); },
    openFileDialog(multi) { return api.openFileDialog(multi); },
    readFile(f) { return api.readFile(f); },
  };
}

(window as unknown as { createPopoutHost: typeof createPopoutHost }).createPopoutHost = createPopoutHost;
