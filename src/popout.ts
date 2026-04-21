// ── Pop-out Preview Window — wrapper nad BrowserCore ──
// Runs in separate BrowserWindow — řeší window controls, size (PPI device frame),
// zoom, fullscreen, devtools. Inspect / annotate / lasso / auto-reload po CC drží
// BrowserCore (viz src/browser-core.ts). Společný `IBrowserHost` z browser-host.ts.

declare const popoutApi: {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  toggleFullscreen: () => void;
  sendPrompt: (prompt: string) => void;
  onLoad: (cb: (data: { type?: string; filePath?: string; url?: string; projectPath?: string }) => void) => () => void;
  onRefresh: (cb: () => void) => () => void;
  onCCDone: (cb: () => void) => () => void;
  storeGet: <T = unknown>(key: string) => Promise<T | undefined>;
  storeSet: <T = unknown>(key: string, value: T) => Promise<void>;
  clipboardRead: () => string;
  clipboardWrite: (text: string) => void;
  captureRegion: (rect: { x: number; y: number; width: number; height: number }, savePath: string) => Promise<{ success?: boolean; error?: string }>;
  captureCleanup: (tmpDir: string) => Promise<{ success?: boolean; error?: string }>;
};

function initPopout(): void {
  // i18n — init probíhá async, applyI18nDom přepíše texty po načtení locale
  (window as unknown as { initI18n?: () => Promise<void>; applyI18nDom?: (r: Document) => void })
    .initI18n?.().then(() => (window as unknown as { applyI18nDom?: (r: Document) => void }).applyI18nDom?.(document));

  const iframe = document.getElementById('popout-iframe') as HTMLIFrameElement;
  const webview = document.getElementById('popout-webview') as HTMLElement & {
    src: string;
    reload: () => void;
    openDevTools: () => void;
    closeDevTools: () => void;
    isDevToolsOpened: () => boolean;
    setZoomFactor?: (z: number) => void;
  };
  const content = document.getElementById('popout-content') as HTMLElement;
  const fileLabel = document.querySelector('.popout-file') as HTMLElement;
  let useWebview = false;
  let coreInstance: BrowserCoreInstance | null = null;

  function showIframe(): void {
    useWebview = false;
    iframe.style.display = '';
    webview.style.display = 'none';
  }
  function showWebview(): void {
    useWebview = true;
    iframe.style.display = 'none';
    webview.style.cssText = 'flex:1; border:none;';
  }

  // ── BrowserCore wire-up ──
  // Core se inicializuje až po prvním onLoad, kdy známe projectPath (IBrowserHost
  // ho drží synchronně). Idempotent — další loady jen aktualizují obsah.
  function wireCore(projectPath: string): void {
    if (coreInstance) return;
    const w = window as unknown as {
      createPopoutHost: (p: string) => IBrowserHost;
      createBrowserCore: (
        host: IBrowserHost,
        container: HTMLElement,
        toolbar: BrowserToolbarRefs,
        iframeEl: HTMLIFrameElement,
        webviewEl: HTMLElement,
      ) => BrowserCoreInstance;
    };
    const host = w.createPopoutHost(projectPath);
    const toolbarRefs: BrowserToolbarRefs = {
      inspectBtn: document.querySelector('.pop-inspect'),
      annotateBtn: document.querySelector('.pop-annotate'),
      reloadBtn: null, // reload má vlastní handler níže (device-frame friendly)
      sizeBtnsContainer: null, // popout drží vlastní PPI size handler
    };
    coreInstance = w.createBrowserCore(host, content, toolbarRefs, iframe, webview);
  }

  // ── Window controls ──
  document.getElementById('pop-min')!.addEventListener('click', () => popoutApi.minimize());
  document.getElementById('pop-max')!.addEventListener('click', () => popoutApi.toggleMaximize());
  document.getElementById('pop-close')!.addEventListener('click', () => popoutApi.close());
  document.getElementById('pop-return')!.addEventListener('click', () => popoutApi.close());

  // ── Load content from main window ──
  popoutApi.onLoad((data) => {
    if (data.projectPath) wireCore(data.projectPath);

    if (data.filePath) {
      const name = data.filePath.replace(/\\/g, '/').split('/').pop();
      fileLabel.textContent = name || '';
      showIframe();
      if (coreInstance) {
        coreInstance.loadContent({ filePath: data.filePath });
      } else {
        iframe.src = 'file:///' + data.filePath.replace(/\\/g, '/');
      }
    } else if (data.url) {
      fileLabel.textContent = data.url;
      const isHttp = data.url.startsWith('http://') || data.url.startsWith('https://');
      if (isHttp) showWebview(); else showIframe();
      if (coreInstance) {
        coreInstance.loadContent({ url: data.url });
      } else {
        if (isHttp) webview.src = data.url;
        else iframe.src = data.url;
      }
    }
  });

  // Explicit refresh z workspace (IPC `popout:refresh`)
  popoutApi.onRefresh(() => coreInstance?.refresh());

  // Reload tlačítko
  document.querySelector('.pop-reload')!.addEventListener('click', () => coreInstance?.refresh());

  // Fullscreen
  document.querySelector('.pop-fullscreen')!.addEventListener('click', () => popoutApi.toggleFullscreen());

  // ── 1:1 Device simulation (PPI device frame) ──
  const DEVICES: Record<string, { w: number; h: number; radius: number }> = {
    mobile: { w: 2.56, h: 5.69, radius: 20 },
    tablet: { w: 6.58, h: 8.77, radius: 16 },
  };
  // PPI odhad — default 24" monitor; popoutApi.storeGet by šel číst, ale synchronně
  // se nehodí a pro popout stačí odhad (pro přesný PPI je workspace).
  const monitorDiag = 24;
  const cssPPI = Math.sqrt(window.screen.width ** 2 + window.screen.height ** 2) / monitorDiag;

  const sizeBtns = document.querySelectorAll('.pop-size-btn');
  sizeBtns.forEach((btn: Element) => {
    btn.addEventListener('click', () => {
      const size = btn.getAttribute('data-size') || 'full';
      sizeBtns.forEach(b => b.classList.remove('pop-size-active'));
      btn.classList.add('pop-size-active');
      const target = useWebview ? webview : iframe;
      target.style.width = '';
      target.style.height = '';
      target.style.maxHeight = '';
      target.style.flex = '';
      target.style.border = '';
      target.style.borderRadius = '';
      target.style.boxShadow = '';
      content.classList.remove('artifact-device-frame');
      content.style.alignItems = '';
      content.style.justifyContent = '';

      const device = DEVICES[size];
      if (device) {
        const w = Math.round(device.w * cssPPI);
        const h = Math.round(device.h * cssPPI);
        content.style.display = 'flex';
        content.style.alignItems = 'center';
        content.style.justifyContent = 'center';
        content.classList.add('artifact-device-frame');
        target.style.width = w + 'px';
        target.style.height = h + 'px';
        target.style.maxHeight = '100%';
        target.style.flex = '0 0 auto';
        target.style.border = '1px solid rgba(255,255,255,0.1)';
        target.style.borderRadius = device.radius + 'px';
        target.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
      }
    });
  });

  // ── DevTools pro iframe / webview ──
  document.querySelector('.pop-devtools')!.addEventListener('click', () => {
    const target = useWebview ? webview : (iframe as unknown as HTMLElement & {
      openDevTools?: () => void; closeDevTools?: () => void; isDevToolsOpened?: () => boolean;
    });
    const t = target as { openDevTools?: () => void; closeDevTools?: () => void; isDevToolsOpened?: () => boolean };
    if (t.openDevTools) {
      if (t.isDevToolsOpened?.()) t.closeDevTools?.();
      else t.openDevTools();
    }
  });

  // ── Zoom (device frame scale / webview setZoomFactor) ──
  let popZoom = 1.0;
  const popZoomLabel = document.querySelector('.pop-zoom-label') as HTMLElement;
  function applyPopZoom(): void {
    popZoomLabel.textContent = Math.round(popZoom * 100) + '%';
    const activeBtn = document.querySelector('.pop-size-btn.pop-size-active');
    const size = activeBtn?.getAttribute('data-size') || 'full';
    const device = DEVICES[size];
    if (device) {
      const target = useWebview ? webview : iframe;
      const w = Math.round(device.w * cssPPI * popZoom);
      const h = Math.round(device.h * cssPPI * popZoom);
      target.style.width = w + 'px';
      target.style.height = h + 'px';
    } else if (useWebview) {
      try { webview.setZoomFactor?.(popZoom); } catch { /* webview not ready */ }
    }
  }
  document.querySelector('.pop-zoom-in')!.addEventListener('click', () => {
    popZoom = Math.min(3, popZoom + 0.1); applyPopZoom();
  });
  document.querySelector('.pop-zoom-out')!.addEventListener('click', () => {
    popZoom = Math.max(0.25, popZoom - 0.1); applyPopZoom();
  });
  popZoomLabel.addEventListener('click', () => { popZoom = 1.0; applyPopZoom(); });
}

document.addEventListener('DOMContentLoaded', initPopout);
