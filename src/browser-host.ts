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
  };
}

(window as unknown as { createLevisHost: typeof createLevisHost }).createLevisHost = createLevisHost;
