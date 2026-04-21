// ── Browser Panel — wrapper nad BrowserCore ──
// Browser-specific UI (URL bar, back/forward, touch, dev server, device frame)
// + instanciace BrowserCore (inspect / annotate / lasso flow).
//
// BrowserCore + LevisHost se loadují jako <script> tagy před browser.js
// (viz src/index.html). Factory funkce visí na window.

interface BrowserInstance {
  element: HTMLElement;
  setUrl: (url: string) => void;
  getUrl: () => string;
  loadFile: (filePath: string) => Promise<void>;
  refresh: () => void;
  /** True když je aktivní popover / inspect / annotate — refresh-on-focus by neměl běžet. */
  isInteracting: () => boolean;
  /** Zobrazí/skryje loading overlay v panelu. message volitelný (např. "Spouštím Vite dev server..."). */
  setLoading: (on: boolean, message?: string) => void;
  /** Volá workspace po working→idle přechodu CC. Pokud je nahraný pending reload
   *  (tj. user poslal prompt z inspect/lasso), náhled se refreshne. */
  notifyCCDone: () => void;
  dispose: () => void;
}

function createBrowser(
  container: HTMLElement,
  defaultUrl: string = '',
  projectPath: string = '',
  injectedHost?: IBrowserHost,
): BrowserInstance {
  const I = (window as any).icon;

  // Pro file:// defaultUrl ukazujeme v URL baru čistou cestu (konzistence s loadFile)
  // — uživatelsky přátelštější než 'file:///C:/...'. Samotný webview.src musí zůstat
  // s plným file:/// schématem aby Electron webview stránku načetl.
  const initialInputValue = defaultUrl.startsWith('file:///')
    ? defaultUrl.replace('file:///', '').replace(/\//g, '\\')
    : defaultUrl;

  const wrapper = document.createElement('div');
  wrapper.className = 'browser-panel';
  wrapper.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;position:relative;';

  const toolbar = document.createElement('div');
  toolbar.className = 'browser-toolbar';
  toolbar.innerHTML = `
    <button class="btn-back" title="${t('browser.back')}">‹</button>
    <button class="btn-forward" title="${t('browser.forward')}">›</button>
    <div class="browser-url-wrap">
      <input type="text" class="browser-url" value="${initialInputValue}" placeholder="${t('browser.urlPlaceholder')}">
      <button class="artifact-btn browser-pin-url" title="${t('browser.pinUrl')}">${I('pin')}</button>
    </div>
    <div class="artifact-size-btns">
      <button class="artifact-size-btn" data-size="mobile" title="${t('browser.deviceMobile')}">${I('mobile')}</button>
      <button class="artifact-size-btn" data-size="tablet" title="${t('browser.deviceTablet')}">${I('file')}</button>
      <button class="artifact-size-btn artifact-size-active" data-size="full" title="${t('browser.deviceFull')}">${I('browser')}</button>
    </div>
    <button class="artifact-btn browser-touch-toggle" title="${t('mobile.touchEm')}">${I('touch')}</button>
    <button class="artifact-btn browser-color-scheme" title="${t('browser.colorScheme')}">☀</button>
    <button class="artifact-btn browser-inspect" title="${t('artifact.inspectTip')}">${I('inspect')}</button>
    <button class="artifact-btn browser-annotate" title="${t('artifact.annotateTip')}">${I('editor')}</button>
    <button class="artifact-btn browser-reload" title="${t('artifact.refreshTip')}">${I('refresh')}</button>
    <button class="artifact-btn browser-open-file" title="${t('artifact.loadHtml')}">${I('folder')}</button>
    <button class="artifact-btn browser-zoom-out" title="${t('browser.zoomOut')}">−</button>
    <span class="browser-zoom-label" style="font-size:10px;color:var(--text-muted);min-width:32px;text-align:center;user-select:none;">100%</span>
    <button class="artifact-btn browser-zoom-in" title="${t('browser.zoomIn')}">+</button>
    <button class="artifact-btn btn-devtools" title="${t('browser.devTools')}">${I('gear')}</button>
  `;
  wrapper.appendChild(toolbar);

  // Content area: iframe + webview jako sourozenci. Core overlay (ring/canvas/popover)
  // se attachuje k webview.parentElement. Iframe je v Levis main flow nepoužitý
  // (file:// jde přes webview kvůli webSecurity=no), ale musí žít vedle webview kvůli
  // BrowserCore kontraktu (Task 6 deviation #4).
  const contentArea = document.createElement('div');
  contentArea.className = 'browser-webview-container';
  wrapper.appendChild(contentArea);

  const iframe = document.createElement('iframe');
  iframe.className = 'browser-iframe';
  iframe.style.cssText = 'display:none;width:100%;height:100%;border:0;';
  contentArea.appendChild(iframe);

  const webview = document.createElement('webview') as any;
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('webpreferences', 'webSecurity=no');
  if (defaultUrl) webview.setAttribute('src', defaultUrl);
  else webview.setAttribute('src', 'about:blank');
  contentArea.appendChild(webview);

  // Loading overlay — zobrazí se během startu dev serveru i při načítání stránky
  const loaderOverlay = document.createElement('div');
  loaderOverlay.className = 'browser-loader';
  loaderOverlay.innerHTML = `
    <div class="browser-loader-inner">
      <div class="browser-loader-spinner"></div>
      <div class="browser-loader-msg">${t('browser.loading')}</div>
      <div class="browser-loader-sub"></div>
    </div>
  `;
  loaderOverlay.hidden = true;
  contentArea.appendChild(loaderOverlay);

  // Touch cursor overlay
  const touchCursor = document.createElement('div');
  touchCursor.className = 'touch-cursor';
  document.body.appendChild(touchCursor);

  container.appendChild(wrapper);

  // ── Webview loading lifecycle ──
  // loaderFromDevServer = workspace explicitně zapnul loader pro start dev serveru.
  // V tom stavu webview eventy (typicky about:blank → did-stop-loading hned po mount)
  // NESMÍ loader schovat — teprve resolveOnce ve workspace to vypne.
  let loaderFromDevServer = false;
  function isRealUrl(): boolean {
    try { return !!webview.src && webview.src !== 'about:blank' && !webview.src.startsWith('about:'); }
    catch { return false; }
  }
  function setLoading(on: boolean, message?: string): void {
    if (!on) { loaderOverlay.hidden = true; return; }
    const msgEl = loaderOverlay.querySelector('.browser-loader-msg') as HTMLElement;
    const subEl = loaderOverlay.querySelector('.browser-loader-sub') as HTMLElement;
    msgEl.textContent = message ?? t('browser.loading');
    subEl.textContent = (webview.src && webview.src !== 'about:blank') ? webview.src : '';
    loaderOverlay.hidden = false;
  }
  webview.addEventListener('did-start-loading', () => {
    if (loaderFromDevServer) return;
    if (isRealUrl()) setLoading(true);
  });
  webview.addEventListener('did-stop-loading', () => { if (!loaderFromDevServer) setLoading(false); });
  webview.addEventListener('did-finish-load', () => { if (!loaderFromDevServer) setLoading(false); });
  webview.addEventListener('did-fail-load', (e: any) => {
    if (e.errorCode === -3) return; // ERR_ABORTED — rychlé set src
    if (loaderFromDevServer) return;
    setLoading(false);
  });
  webview.addEventListener('console-message', (e: any) => {
    if (e.level === 3) {
      const msg = e.message?.substring(0, 120) || 'Unknown error';
      console.warn('[browser webview]', msg);
    }
  });

  // ── State ──
  const urlInput = toolbar.querySelector('.browser-url') as HTMLInputElement;
  const btnBack = toolbar.querySelector('.btn-back') as HTMLElement;
  const btnForward = toolbar.querySelector('.btn-forward') as HTMLElement;
  const btnDevtools = toolbar.querySelector('.btn-devtools') as HTMLElement;
  const btnTouchToggle = toolbar.querySelector('.browser-touch-toggle') as HTMLElement;
  const btnColorScheme = toolbar.querySelector('.browser-color-scheme') as HTMLElement;
  const zoomLabel = toolbar.querySelector('.browser-zoom-label') as HTMLElement;
  const btnPin = toolbar.querySelector('.browser-pin-url') as HTMLElement | null;

  // Pro file:// defaultUrl nastavíme currentFilePath — tím funguje refresh (loadFile cestu)
  // a getUrl() vrátí správné file:/// URL zpět do workspace popout caller.
  let currentFilePath: string | null = defaultUrl.startsWith('file:///')
    ? defaultUrl.replace('file:///', '').replace(/\//g, '\\')
    : null;
  let currentSize: 'mobile' | 'tablet' | 'full' = 'full';
  let zoomLevel = 1.0;
  let touchWebContentsId: number | null = null;
  let touchEmulationOn = false;
  let colorScheme: 'dark' | 'light' = 'light';

  // ── BrowserCore wiring ──
  // `sizeBtnsContainer: null` — wrapper si registruje vlastní handlery s PPI device frame.
  const w = window as unknown as {
    createLevisHost: (projectPath: string) => IBrowserHost;
    createBrowserCore: (
      host: IBrowserHost,
      container: HTMLElement,
      toolbar: BrowserToolbarRefs,
      iframeEl: HTMLIFrameElement,
      webviewEl: HTMLElement,
    ) => BrowserCoreInstance;
  };
  // Injektovaný host (popout předá PopoutHost); fallback = LevisHost pro main workspace.
  const host = injectedHost ?? w.createLevisHost(projectPath);
  const toolbarRefs: BrowserToolbarRefs = {
    inspectBtn: toolbar.querySelector('.browser-inspect'),
    annotateBtn: toolbar.querySelector('.browser-annotate'),
    reloadBtn: toolbar.querySelector('.browser-reload'),
    sizeBtnsContainer: null,
  };
  const core = w.createBrowserCore(host, contentArea, toolbarRefs, iframe, webview);

  // ── 1:1 device simulation (PPI device frame) ──
  // Fyzické rozměry zařízení v palcích (šířka × výška displeje)
  const DEVICES: Record<string, { w: number; h: number; radius: number }> = {
    mobile: { w: 2.56, h: 5.69, radius: 20 }, // 6" telefon, poměr 20:9
    tablet: { w: 6.58, h: 8.77, radius: 16 }, // 10.9" iPad, poměr 4:3
  };

  async function getMonitorCssPPI(): Promise<number> {
    const diag = Number(await host.storeGet('monitorDiagonal')) || 24;
    const sw = window.screen.width;
    const sh = window.screen.height;
    return Math.sqrt(sw * sw + sh * sh) / diag;
  }

  function resetWebviewFull(): void {
    contentArea.style.background = '';
    contentArea.style.display = '';
    contentArea.style.alignItems = '';
    contentArea.style.justifyContent = '';
    contentArea.style.overflow = 'hidden';
    webview.style.position = 'absolute';
    webview.style.width = '100%';
    webview.style.height = '100%';
    webview.style.maxHeight = '';
    webview.style.flex = '';
    webview.style.margin = '';
    webview.style.border = '';
    webview.style.borderRadius = '';
    webview.style.boxShadow = '';
  }

  function applyDeviceFrame(ppi: number, device: { w: number; h: number; radius: number }): void {
    const w = Math.round(device.w * ppi);
    const h = Math.round(device.h * ppi);
    contentArea.style.background = '#0a0a0f';
    contentArea.style.display = 'flex';
    contentArea.style.alignItems = 'center';
    contentArea.style.justifyContent = 'center';
    contentArea.style.overflow = 'auto';
    webview.style.position = 'relative';
    webview.style.width = w + 'px';
    webview.style.height = h + 'px';
    webview.style.maxHeight = '100%';
    webview.style.flex = '0 0 auto';
    webview.style.margin = '0 auto';
    webview.style.border = '1px solid rgba(255,255,255,0.1)';
    webview.style.borderRadius = device.radius + 'px';
    webview.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
  }

  function defaultZoomFor(size: 'mobile' | 'tablet' | 'full'): number {
    return size === 'mobile' ? 1.5 : 1.0;
  }

  async function applyZoom(): Promise<void> {
    zoomLabel.textContent = Math.round(zoomLevel * 100) + '%';
    const device = DEVICES[currentSize];
    if (device) {
      const ppi = await getMonitorCssPPI();
      const w = Math.round(device.w * ppi * zoomLevel);
      const h = Math.round(device.h * ppi * zoomLevel);
      webview.style.width = w + 'px';
      webview.style.height = h + 'px';
    } else {
      try { (webview as any).setZoomFactor(zoomLevel); } catch { /* webview not ready */ }
    }
  }

  async function setSize(size: 'mobile' | 'tablet' | 'full'): Promise<void> {
    currentSize = size;
    toolbar.querySelectorAll('.artifact-size-btn').forEach((b) => b.classList.remove('artifact-size-active'));
    toolbar.querySelector(`.artifact-size-btn[data-size="${size}"]`)?.classList.add('artifact-size-active');
    resetWebviewFull();
    zoomLevel = defaultZoomFor(size);
    const device = DEVICES[size];
    if (device) {
      const ppi = await getMonitorCssPPI();
      applyDeviceFrame(ppi, device);
    }
    await applyZoom();
  }

  toolbar.querySelectorAll('.artifact-size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const size = ((btn as HTMLElement).dataset.size as 'mobile' | 'tablet' | 'full') || 'full';
      void setSize(size);
    });
  });

  toolbar.querySelector('.browser-zoom-in')!.addEventListener('click', () => {
    zoomLevel = Math.min(3, +(zoomLevel + 0.1).toFixed(1));
    void applyZoom();
  });
  toolbar.querySelector('.browser-zoom-out')!.addEventListener('click', () => {
    zoomLevel = Math.max(0.25, +(zoomLevel - 0.1).toFixed(1));
    void applyZoom();
  });
  zoomLabel.addEventListener('click', () => { zoomLevel = 1.0; void applyZoom(); });

  // ── Touch emulation ──
  const onTouchMove = (e: MouseEvent) => {
    if (!touchEmulationOn) return;
    const rect = contentArea.getBoundingClientRect();
    const over = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    touchCursor.style.left = e.clientX + 'px';
    touchCursor.style.top = e.clientY + 'px';
    if (over) touchCursor.classList.add('visible');
    else touchCursor.classList.remove('visible', 'pressed');
  };
  const onTouchDown = () => {
    if (touchEmulationOn && touchCursor.classList.contains('visible')) touchCursor.classList.add('pressed');
  };
  const onTouchUp = () => { touchCursor.classList.remove('pressed'); };
  document.addEventListener('mousemove', onTouchMove);
  document.addEventListener('mousedown', onTouchDown);
  document.addEventListener('mouseup', onTouchUp);

  function ensureWebContentsId(): void {
    if (touchWebContentsId == null) {
      try { touchWebContentsId = (webview as any).getWebContentsId(); } catch { /* not ready */ }
    }
  }

  webview.addEventListener('dom-ready', () => {
    ensureWebContentsId();
    if (touchEmulationOn && touchWebContentsId != null) {
      host.mobileEnableTouch(touchWebContentsId).catch(() => {});
    }
  });

  btnTouchToggle.addEventListener('click', async () => {
    touchEmulationOn = !touchEmulationOn;
    btnTouchToggle.classList.toggle('artifact-btn-active', touchEmulationOn);
    if (!touchEmulationOn) touchCursor.classList.remove('visible', 'pressed');
    contentArea.style.cursor = touchEmulationOn ? 'none' : '';
    ensureWebContentsId();
    if (touchWebContentsId != null) {
      if (touchEmulationOn) await host.mobileEnableTouch(touchWebContentsId);
      else await host.mobileDisableTouch(touchWebContentsId);
    }
    showToast(t(touchEmulationOn ? 'mobile.touchOn' : 'mobile.touchOff'), 'info');
  });

  // ── Dark/Light mode simulace ──
  btnColorScheme.addEventListener('click', async () => {
    colorScheme = colorScheme === 'light' ? 'dark' : 'light';
    btnColorScheme.textContent = colorScheme === 'dark' ? '☾' : '☀';
    btnColorScheme.classList.toggle('artifact-btn-active', colorScheme === 'dark');
    ensureWebContentsId();
    if (touchWebContentsId != null) {
      await host.mobileSetColorScheme(touchWebContentsId, colorScheme);
    }
    showToast(`prefers-color-scheme: ${colorScheme}`, 'info');
  });

  // ── Reload / Load URL / Load file ──
  toolbar.querySelector('.browser-reload')!.addEventListener('click', () => {
    if (currentFilePath) { void loadFile(currentFilePath); return; }
    if (typeof (webview as any).reloadIgnoringCache === 'function') {
      try { (webview as any).reloadIgnoringCache(); } catch { /* not ready */ }
    }
  });

  function loadUrl(url: string): void {
    if (!url) return;
    if (!/^(https?|file):\/\//i.test(url)) {
      if (url.includes('\\') || url.includes('/')) {
        url = 'file:///' + url.replace(/\\/g, '/');
      } else {
        url = 'http://' + url;
      }
    }
    currentFilePath = null;
    webview.src = url;
    urlInput.value = url;
  }

  async function loadFile(filePath: string): Promise<void> {
    currentFilePath = filePath;
    const fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
    webview.src = fileUrl;
    urlInput.value = filePath;
  }

  urlInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      const val = urlInput.value.trim();
      if (/\.(html?|svg|php)$/i.test(val) && !val.startsWith('http')) {
        void loadFile(val);
      } else {
        loadUrl(val);
      }
    }
  });

  btnBack.addEventListener('click', () => { if (webview.canGoBack()) webview.goBack(); });
  btnForward.addEventListener('click', () => { if (webview.canGoForward()) webview.goForward(); });

  toolbar.querySelector('.browser-open-file')!.addEventListener('click', async () => {
    const files = await host.openFileDialog(false);
    if (!files || files.length === 0) return;
    const fp = files[0];
    if (/\.(html?|svg)$/i.test(fp)) {
      await loadFile(fp);
    } else {
      showToast(t('artifact.notHtml'), 'warning');
    }
  });

  // ── Pin URL jako výchozí pro projekt — toggle ──
  async function refreshPinState(): Promise<void> {
    if (!btnPin || !projectPath) return;
    try {
      const prefs = await host.getProjectPrefs(projectPath);
      const pinnedUrl = (prefs as any)?.previewUrl;
      const isPinned = !!pinnedUrl && pinnedUrl === urlInput.value.trim();
      btnPin.classList.toggle('artifact-btn-active', isPinned);
      btnPin.title = isPinned ? t('browser.unpinUrl') : t('browser.pinUrl');
    } catch { /* prefs read may fail */ }
  }
  btnPin?.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url || url === 'about:blank') { showToast(t('browser.pinEmpty'), 'warning'); return; }
    if (!projectPath) return;
    try {
      const prefs = await host.getProjectPrefs(projectPath);
      const pinnedUrl = (prefs as any)?.previewUrl;
      if (pinnedUrl === url) {
        await host.setProjectPref(projectPath, 'previewUrl', '');
        btnPin.classList.remove('artifact-btn-active');
        btnPin.title = t('browser.pinUrl');
        showToast(t('browser.unpinned'), 'info');
      } else {
        await host.setProjectPref(projectPath, 'previewUrl', url);
        btnPin.classList.add('artifact-btn-active');
        btnPin.title = t('browser.unpinUrl');
        showToast(t('browser.pinSaved', { url }), 'success');
      }
    } catch { /* prefs write may fail */ }
  });
  webview.addEventListener('did-navigate', () => void refreshPinState());
  webview.addEventListener('did-navigate-in-page', () => void refreshPinState());
  urlInput.addEventListener('change', () => void refreshPinState());
  setTimeout(() => void refreshPinState(), 200);

  // ── Drag & drop ──
  wrapper.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  wrapper.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const textPath = e.dataTransfer?.getData('text/plain');
    if (textPath && /\.(html?|php|svg)$/i.test(textPath)) {
      void loadFile(textPath);
      return;
    }
    const file = e.dataTransfer?.files?.[0];
    if (file && (file as any).path) {
      const fp = (file as any).path;
      if (/\.(html?|php|svg)$/i.test(fp)) void loadFile(fp);
      else loadUrl('file:///' + fp.replace(/\\/g, '/'));
    }
  });

  btnDevtools.addEventListener('click', () => {
    if (webview.isDevToolsOpened()) webview.closeDevTools();
    else webview.openDevTools();
  });

  function updateNavButtons(): void {
    try {
      (btnBack as HTMLButtonElement).disabled = !webview.canGoBack();
      (btnForward as HTMLButtonElement).disabled = !webview.canGoForward();
    } catch { /* not ready */ }
  }
  updateNavButtons();
  webview.addEventListener('did-navigate', (e: any) => { urlInput.value = e.url; updateNavButtons(); });
  webview.addEventListener('did-navigate-in-page', (e: any) => { urlInput.value = e.url; updateNavButtons(); });
  webview.addEventListener('did-finish-load', updateNavButtons);

  // ── Drag-to-pan (middle mouse / Shift+click) ──
  let panActive = false;
  let panStartX = 0, panStartY = 0, panScrollX = 0, panScrollY = 0;
  contentArea.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      panActive = true;
      panStartX = e.clientX; panStartY = e.clientY;
      panScrollX = contentArea.scrollLeft; panScrollY = contentArea.scrollTop;
    }
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!panActive) return;
    contentArea.scrollLeft = panScrollX - (e.clientX - panStartX);
    contentArea.scrollTop = panScrollY - (e.clientY - panStartY);
  });
  window.addEventListener('mouseup', () => { panActive = false; });

  // ── Initial load — statický projekt: zkus najít index.html ──
  if (!defaultUrl && projectPath) {
    (async () => {
      const sep = projectPath.includes('\\') ? '\\' : '/';
      const candidates = [
        projectPath + sep + 'index.html',
        projectPath + sep + 'public' + sep + 'index.html',
        projectPath + sep + 'src' + sep + 'index.html',
      ];
      for (const c of candidates) {
        try {
          const content = await host.readFile(c);
          if (typeof content === 'string') { await loadFile(c); return; }
        } catch { /* candidate not present */ }
      }
    })();
  }

  // ── Initial size ──
  void setSize(currentSize);

  return {
    element: wrapper,
    setUrl: (url: string) => loadUrl(url),
    // Vrátí plně kvalifikovanou URL. Pro file contextu (loadFile) vrátí file:/// —
    // workspace popout caller se pak správně rozhodne mezi data.filePath vs data.url.
    // urlInput.value drží jen path (UX), takže ho tady doplníme o schéma.
    getUrl: () => {
      if (currentFilePath) return 'file:///' + currentFilePath.replace(/\\/g, '/');
      return urlInput.value;
    },
    loadFile,
    refresh: () => {
      if (currentFilePath) { void loadFile(currentFilePath); return; }
      if (typeof (webview as any).reloadIgnoringCache === 'function') {
        try { (webview as any).reloadIgnoringCache(); } catch { /* not ready */ }
      }
    },
    isInteracting: () => core.isInteracting(),
    setLoading: (on: boolean, message?: string) => {
      loaderFromDevServer = on && !!message;
      setLoading(on, message);
    },
    notifyCCDone: () => core.notifyCCDone(),
    dispose: () => {
      core.dispose();
      document.removeEventListener('mousemove', onTouchMove);
      document.removeEventListener('mousedown', onTouchDown);
      document.removeEventListener('mouseup', onTouchUp);
      touchCursor.remove();
      wrapper.remove();
    },
  };
}

(window as any).createBrowser = createBrowser;
