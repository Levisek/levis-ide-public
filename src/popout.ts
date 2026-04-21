// ── Pop-out Preview Window — tenký wrapper nad createBrowser ──
// Sdílená codepath s workspace browser. Jediná úloha popoutu:
// 1) window chrome (min / max / close / return / fullscreen)
// 2) inicializovat createBrowser s PopoutHost (IPC místo window.levis)
// 3) forwardovat IPC eventy onLoad/onRefresh do BrowserInstance
//
// URL bar, navigace, inspect, annotate, touch, color scheme, device frame —
// všechno drží createBrowser v browser.ts. Parity s main oknem je dána
// tím, že se používá přesně ta stejná factory.

declare const popoutApi: {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  toggleFullscreen: () => void;
  sendPrompt: (payload: { text: string; submit: boolean }) => void;
  onLoad: (cb: (data: { type?: string; filePath?: string; url?: string; projectPath?: string }) => void) => () => void;
  onRefresh: (cb: () => void) => () => void;
  onCCDone: (cb: () => void) => () => void;
  storeGet: <T = unknown>(key: string) => Promise<T | undefined>;
  storeSet: <T = unknown>(key: string, value: T) => Promise<void>;
  clipboardRead: () => string;
  clipboardWrite: (text: string) => void;
  captureRegion: (rect: { x: number; y: number; width: number; height: number }, savePath: string) => Promise<{ success?: boolean; error?: string }>;
  captureCleanup: (tmpDir: string) => Promise<{ success?: boolean; error?: string }>;
  mobileEnableTouch: (id: number) => Promise<boolean>;
  mobileDisableTouch: (id: number) => Promise<boolean>;
  mobileSetColorScheme: (id: number, scheme: 'dark' | 'light') => Promise<boolean>;
  getProjectPrefs: (projectPath: string) => Promise<Record<string, unknown> | undefined>;
  setProjectPref: (projectPath: string, key: string, value: unknown) => Promise<void>;
  openFileDialog: (multi?: boolean) => Promise<string[] | null>;
  readFile: (filePath: string) => Promise<string | { error: string }>;
};

interface BrowserInstanceMin {
  loadFile: (filePath: string) => Promise<void>;
  setUrl: (url: string) => void;
  refresh: () => void;
  notifyCCDone: () => void;
  dispose: () => void;
}

function initPopout(): void {
  // i18n — init probíhá async, applyI18nDom přepíše texty po načtení locale
  (window as unknown as { initI18n?: () => Promise<void>; applyI18nDom?: (r: Document) => void })
    .initI18n?.().then(() => (window as unknown as { applyI18nDom?: (r: Document) => void }).applyI18nDom?.(document));

  const content = document.getElementById('popout-content') as HTMLElement;

  // ── Window controls ──
  document.getElementById('pop-min')!.addEventListener('click', () => popoutApi.minimize());
  document.getElementById('pop-max')!.addEventListener('click', () => popoutApi.toggleMaximize());
  document.getElementById('pop-close')!.addEventListener('click', () => popoutApi.close());
  document.getElementById('pop-return')!.addEventListener('click', () => popoutApi.close());
  document.querySelector('.pop-fullscreen')!.addEventListener('click', () => popoutApi.toggleFullscreen());

  // ── Browser instance (createBrowser s PopoutHost) ──
  // Lazy init — až do první onLoad zprávy neznáme projectPath.
  let browserInstance: BrowserInstanceMin | null = null;

  function ensureBrowser(projectPath: string, initialUrl: string): { browser: BrowserInstanceMin; created: boolean } {
    if (browserInstance) return { browser: browserInstance, created: false };
    const w = window as unknown as {
      createPopoutHost: (projectPath: string) => IBrowserHost;
      createBrowser: (
        container: HTMLElement,
        defaultUrl?: string,
        projectPath?: string,
        host?: IBrowserHost,
      ) => BrowserInstanceMin;
    };
    const host = w.createPopoutHost(projectPath);
    browserInstance = w.createBrowser(content, initialUrl, projectPath, host);
    return { browser: browserInstance, created: true };
  }

  // ── Load content from main window ──
  // POZOR: při prvním vytvoření browseru předáváme initialUrl do createBrowser
  // (webview.src se nastaví jen jednou). Nesmíme po createBrowser volat loadFile/setUrl
  // znovu — druhý src change během probíhajícího loadu → ERR_ABORTED (-3) → about:blank.
  // Reuse scénář (popout už existuje a main posílá nový obsah) ale setUrl/loadFile volat musíme.
  popoutApi.onLoad((data) => {
    const projectPath = data.projectPath || '';
    const initialUrl = data.url
      || (data.filePath ? 'file:///' + data.filePath.replace(/\\/g, '/') : '');
    const { browser, created } = ensureBrowser(projectPath, initialUrl);

    if (!created) {
      if (data.filePath) browser.loadFile(data.filePath);
      else if (data.url) browser.setUrl(data.url);
    }
  });

  // Explicit refresh z workspace (IPC `popout:refresh`)
  popoutApi.onRefresh(() => browserInstance?.refresh());

  // CC working→idle bridge — BrowserCore uvnitř createBrowser si registruje vlastní
  // onCCDone přes host.onCCDone → PopoutHost → popoutApi.onCCDone. Tady nemusíme nic.
}

document.addEventListener('DOMContentLoaded', initPopout);
