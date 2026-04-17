// ── Browser Panel (unified: webview pro file:// i http://) ──
// Sloučený artifact + browser + mobile do jednoho panelu.
// Umí: localhost dev server, statické HTML, mobilní emulaci, inspector, lasso, annotation.


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

function createBrowser(container: HTMLElement, defaultUrl: string = '', projectPath: string = ''): BrowserInstance {
  const I = (window as any).icon;
  const wrapper = document.createElement('div');
  wrapper.className = 'browser-panel';
  wrapper.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;position:relative;';

  // Cleanup starých screenshotů
  if (projectPath) {
    const sep = projectPath.includes('\\') ? '\\' : '/';
    levis.captureCleanup(projectPath + sep + '.levis-tmp').catch(() => {});
  }

  const toolbar = document.createElement('div');
  toolbar.className = 'browser-toolbar';
  toolbar.innerHTML = `
    <button class="btn-back" title="${t('browser.back')}">‹</button>
    <button class="btn-forward" title="${t('browser.forward')}">›</button>
    <div class="browser-url-wrap">
      <input type="text" class="browser-url" value="${defaultUrl}" placeholder="${t('browser.urlPlaceholder')}">
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
    <button class="artifact-btn browser-watch" title="${t('artifact.watchTip')}">${I('eye')}</button>
    <button class="artifact-btn browser-open-file" title="${t('artifact.loadHtml')}">${I('folder')}</button>
    <button class="artifact-btn browser-zoom-out" title="${t('browser.zoomOut')}">−</button>
    <span class="browser-zoom-label" style="font-size:10px;color:var(--text-muted);min-width:32px;text-align:center;user-select:none;">100%</span>
    <button class="artifact-btn browser-zoom-in" title="${t('browser.zoomIn')}">+</button>
    <button class="artifact-btn btn-devtools" title="${t('browser.devTools')}">${I('gear')}</button>
  `;
  wrapper.appendChild(toolbar);

  const webviewContainer = document.createElement('div');
  webviewContainer.className = 'browser-webview-container';
  webviewContainer.style.cssText = 'position:relative;flex:1 1 0;min-height:0;overflow:hidden;';
  wrapper.appendChild(webviewContainer);

  const webview = document.createElement('webview') as any;
  webview.setAttribute('allowpopups', '');
  webview.style.width = '100%';
  webview.style.height = '100%';
  webview.style.position = 'absolute';
  webview.style.top = '0';
  webview.style.left = '0';
  webview.setAttribute('webpreferences', 'webSecurity=no');
  if (defaultUrl) webview.setAttribute('src', defaultUrl);
  else webview.setAttribute('src', 'about:blank');
  // Webview loading lifecycle — show/hide loader overlay.
  // loaderFromDevServer = workspace explicitně zapnul loader pro start dev serveru.
  // V tom stavu webview eventy (typicky about:blank → did-stop-loading hned po mount)
  // NESMÍ loader schovat — teprve resolveOnce ve workspace to vypne.
  let loaderFromDevServer = false;
  function isRealUrl(): boolean {
    try { return !!webview.src && webview.src !== 'about:blank' && !webview.src.startsWith('about:'); }
    catch { return false; }
  }
  webview.addEventListener('did-start-loading', () => {
    if (loaderFromDevServer) return;
    if (isRealUrl()) setLoading(true);
  });
  webview.addEventListener('did-stop-loading', () => {
    if (loaderFromDevServer) return;
    setLoading(false);
  });
  webview.addEventListener('did-finish-load', () => {
    if (loaderFromDevServer) return;
    setLoading(false);
  });
  webview.addEventListener('did-fail-load', (e: any) => {
    // Ignore cancelled loads (code -3 = ERR_ABORTED při rychlém seběmenu set src)
    if (e.errorCode === -3) return;
    if (loaderFromDevServer) return;
    setLoading(false);
  });
  // Forward console errors z webview jako toast (JS error reporting)
  webview.addEventListener('console-message', (e: any) => {
    if (e.level === 3) { // error
      const msg = e.message?.substring(0, 120) || 'Unknown error';
      console.warn('[browser webview]', msg);
    }
  });
  webviewContainer.appendChild(webview);

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
  webviewContainer.appendChild(loaderOverlay);

  function setLoading(on: boolean, message?: string): void {
    if (!on) {
      loaderOverlay.hidden = true;
      return;
    }
    const msgEl = loaderOverlay.querySelector('.browser-loader-msg') as HTMLElement;
    const subEl = loaderOverlay.querySelector('.browser-loader-sub') as HTMLElement;
    if (message) {
      msgEl.textContent = message;
      subEl.textContent = (webview.src && webview.src !== 'about:blank') ? webview.src : '';
    } else {
      msgEl.textContent = t('browser.loading');
      subEl.textContent = (webview.src && webview.src !== 'about:blank') ? webview.src : '';
    }
    loaderOverlay.hidden = false;
  }

  // Annotation canvas overlay
  const annotCanvas = document.createElement('canvas');
  annotCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:none;pointer-events:none;z-index:10;';
  webviewContainer.appendChild(annotCanvas);

  // Element ring overlay
  const elementRing = document.createElement('div');
  elementRing.className = 'artifact-element-ring';
  elementRing.style.display = 'none';
  webviewContainer.appendChild(elementRing);

  let activePopover: HTMLElement | null = null;

  // Touch cursor overlay
  const touchCursor = document.createElement('div');
  touchCursor.className = 'touch-cursor';
  document.body.appendChild(touchCursor);

  container.appendChild(wrapper);

  const urlInput = toolbar.querySelector('.browser-url') as HTMLInputElement;
  const btnBack = toolbar.querySelector('.btn-back') as HTMLElement;
  const btnForward = toolbar.querySelector('.btn-forward') as HTMLElement;
  const btnDevtools = toolbar.querySelector('.btn-devtools') as HTMLElement;
  const btnInspect = toolbar.querySelector('.browser-inspect') as HTMLElement;
  const btnAnnotate = toolbar.querySelector('.browser-annotate') as HTMLElement;
  let currentFilePath: string | null = null;
  let currentUrl = '';
  let currentSize = 'full';
  let touchWebContentsId: number | null = null;
  let touchEmulationOn = false;

  webview.addEventListener('dom-ready', () => {
    try { touchWebContentsId = (webview as any).getWebContentsId(); } catch {}
    if (touchEmulationOn && touchWebContentsId != null) {
      levis.mobileEnableTouch(touchWebContentsId).catch(() => {});
    }
    if (inspectActive) setTimeout(() => inspector.enable(webview), 200);
  });

  function resetWebviewFull(): void {
    webviewContainer.style.background = '';
    webviewContainer.style.display = '';
    webviewContainer.style.alignItems = '';
    webviewContainer.style.justifyContent = '';
    webviewContainer.style.overflow = 'hidden';
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

  // ── 1:1 device simulation ──
  // Fyzické rozměry zařízení v palcích (šířka × výška displeje)
  const DEVICES: Record<string, { w: number; h: number; radius: number }> = {
    mobile: { w: 2.56, h: 5.69, radius: 20 }, // 6" telefon, poměr 20:9
    tablet: { w: 6.58, h: 8.77, radius: 16 }, // 10.9" iPad, poměr 4:3
  };

  async function getMonitorCssPPI(): Promise<number> {
    const diag = Number(await levis.storeGet('monitorDiagonal')) || 24;
    const sw = window.screen.width;
    const sh = window.screen.height;
    return Math.sqrt(sw * sw + sh * sh) / diag;
  }

  function applyDeviceFrame(ppi: number, device: { w: number; h: number; radius: number }): void {
    const w = Math.round(device.w * ppi);
    const h = Math.round(device.h * ppi);
    webviewContainer.style.background = '#0a0a0f';
    webviewContainer.style.display = 'flex';
    webviewContainer.style.alignItems = 'center';
    webviewContainer.style.justifyContent = 'center';
    webviewContainer.style.overflow = 'auto';
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

  // Default zoom per device — mobile je na HiDPI monitorech sám o sobě malý, 150% je čitelnější
  function defaultZoomFor(size: string): number {
    return size === 'mobile' ? 1.5 : 1.0;
  }

  const sizeBtns = toolbar.querySelectorAll('.artifact-size-btn');
  sizeBtns.forEach((btn: Element) => {
    btn.addEventListener('click', async () => {
      currentSize = btn.getAttribute('data-size') || 'full';
      sizeBtns.forEach(b => b.classList.remove('artifact-size-active'));
      btn.classList.add('artifact-size-active');
      resetWebviewFull();
      zoomLevel = defaultZoomFor(currentSize);
      const device = DEVICES[currentSize];
      if (device) {
        const ppi = await getMonitorCssPPI();
        applyDeviceFrame(ppi, device);
      }
      await applyZoom();
    });
  });

  // ── Zoom (device frame scale) ──
  let zoomLevel = 1.0;
  const zoomLabel = toolbar.querySelector('.browser-zoom-label') as HTMLElement;
  async function applyZoom(): Promise<void> {
    zoomLabel.textContent = Math.round(zoomLevel * 100) + '%';
    const device = DEVICES[currentSize];
    if (device) {
      // Device mode — škáluj rozměry frame
      const ppi = await getMonitorCssPPI();
      const w = Math.round(device.w * ppi * zoomLevel);
      const h = Math.round(device.h * ppi * zoomLevel);
      webview.style.width = w + 'px';
      webview.style.height = h + 'px';
    } else {
      // Full mode — zoomuj obsah webview
      try { (webview as any).setZoomFactor(zoomLevel); } catch {}
    }
  }
  toolbar.querySelector('.browser-zoom-in')!.addEventListener('click', () => {
    zoomLevel = Math.min(3, +(zoomLevel + 0.1).toFixed(1));
    applyZoom();
  });
  toolbar.querySelector('.browser-zoom-out')!.addEventListener('click', () => {
    zoomLevel = Math.max(0.25, +(zoomLevel - 0.1).toFixed(1));
    applyZoom();
  });
  zoomLabel.addEventListener('click', () => { zoomLevel = 1.0; applyZoom(); });

  // ── Touch emulation ──
  const btnTouchToggle = toolbar.querySelector('.browser-touch-toggle') as HTMLElement;

  const onTouchMove = (e: MouseEvent) => {
    if (!touchEmulationOn) return;
    const rect = webviewContainer.getBoundingClientRect();
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
      try { touchWebContentsId = (webview as any).getWebContentsId(); } catch {}
    }
  }

  btnTouchToggle.addEventListener('click', async () => {
    touchEmulationOn = !touchEmulationOn;
    btnTouchToggle.classList.toggle('artifact-btn-active', touchEmulationOn);
    if (!touchEmulationOn) touchCursor.classList.remove('visible', 'pressed');
    webviewContainer.style.cursor = touchEmulationOn ? 'none' : '';
    ensureWebContentsId();
    if (touchWebContentsId != null) {
      if (touchEmulationOn) await levis.mobileEnableTouch(touchWebContentsId);
      else await levis.mobileDisableTouch(touchWebContentsId);
    }
    showToast(t(touchEmulationOn ? 'mobile.touchOn' : 'mobile.touchOff'), 'info');
  });

  // ── Dark/Light mode simulace ──
  let colorScheme: 'dark' | 'light' = 'light';
  const btnColorScheme = toolbar.querySelector('.browser-color-scheme') as HTMLElement;
  btnColorScheme.addEventListener('click', async () => {
    colorScheme = colorScheme === 'light' ? 'dark' : 'light';
    btnColorScheme.textContent = colorScheme === 'dark' ? '☾' : '☀';
    btnColorScheme.classList.toggle('artifact-btn-active', colorScheme === 'dark');
    ensureWebContentsId();
    if (touchWebContentsId != null) {
      await levis.mobileSetColorScheme(touchWebContentsId, colorScheme);
    }
    showToast(`prefers-color-scheme: ${colorScheme}`, 'info');
  });

  // ── Watch mode ──
  // Default ZAPNUTÝ — bez něj je inspect/lasso flow nepřetěžový: user pošle prompt,
  // CC upraví soubor, ale náhled se nerefreshne sám (reload závisí na CC state
  // detektoru + armedReload flag). S Watch ON polluje soubor každé 2 s a uvidí změnu
  // hned. Originál LevisIDE to měl takto (c:/dev/levis-ide/artifact.ts:669).
  let watching = true;
  let watchInterval: any = null;
  let watchPending = false; // brání double-fire pokud loadFile trvá > 2 s
  const watchBtn = toolbar.querySelector('.browser-watch') as HTMLElement;

  // ── Auto-reload po CC done ──
  // Když user odešle prompt z inspect/lasso, nastavíme flag; až workspace
  // zachytí working→idle přechod, refreshne náhled (pokud Watch neběží).
  let armedReloadAfterCC = false;

  function startWatch(): void {
    if (watchInterval) return;
    watchInterval = setInterval(async () => {
      if (watchPending) return;
      watchPending = true;
      try {
        if (currentFilePath) {
          // File mode — reload file
          await loadFile(currentFilePath);
        } else if (webview.src && webview.src !== 'about:blank') {
          try { if (typeof (webview as any).reloadIgnoringCache === 'function') (webview as any).reloadIgnoringCache(); } catch {}
        }
      } finally {
        watchPending = false;
      }
    }, 2000);
  }
  function stopWatch(): void {
    if (watchInterval) { clearInterval(watchInterval); watchInterval = null; }
  }
  watchBtn.addEventListener('click', () => {
    watching = !watching;
    watchBtn.classList.toggle('artifact-watch-active', watching);
    watchBtn.innerHTML = `${I('eye')} ${watching ? t('browser.watching') : t('browser.watch')}`;
    if (watching) startWatch(); else stopWatch();
  });
  // Init vizuálu + start polling — default ON
  watchBtn.classList.add('artifact-watch-active');
  watchBtn.innerHTML = `${I('eye')} ${t('browser.watching')}`;
  startWatch();

  // ── Reload ──
  toolbar.querySelector('.browser-reload')!.addEventListener('click', () => {
    if (currentFilePath) { loadFile(currentFilePath); return; }
    if (typeof (webview as any).reloadIgnoringCache === 'function') {
      try { (webview as any).reloadIgnoringCache(); } catch {}
    }
  });

  // ── Load URL ──
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
    currentUrl = url;
    webview.src = url;
    urlInput.value = url;
  }

  // ── Load file (z artifact) ──
  async function loadFile(filePath: string): Promise<void> {
    currentFilePath = filePath;
    const fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
    currentUrl = fileUrl;
    webview.src = fileUrl;
    urlInput.value = filePath;
  }

  urlInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      const val = urlInput.value.trim();
      if (/\.(html?|svg|php)$/i.test(val) && !val.startsWith('http')) {
        loadFile(val);
      } else {
        loadUrl(val);
      }
    }
  });

  btnBack.addEventListener('click', () => { if (webview.canGoBack()) webview.goBack(); });
  btnForward.addEventListener('click', () => { if (webview.canGoForward()) webview.goForward(); });

  // ── File dialog ──
  toolbar.querySelector('.browser-open-file')!.addEventListener('click', async () => {
    const files = await levis.openFileDialog(false);
    if (!files || files.length === 0) return;
    const fp = files[0];
    if (/\.(html?|svg)$/i.test(fp)) {
      await loadFile(fp);
    } else {
      showToast(t('artifact.notHtml'), 'warning');
    }
  });

  // ── Pin URL jako výchozí pro projekt — toggle ──
  const btnPin = toolbar.querySelector('.browser-pin-url') as HTMLElement | null;
  async function refreshPinState(): Promise<void> {
    if (!btnPin || !projectPath) return;
    try {
      const prefs = await levis.getProjectPrefs(projectPath);
      const pinnedUrl = (prefs as any)?.previewUrl;
      const currentUrl = urlInput.value.trim();
      const isPinned = !!pinnedUrl && pinnedUrl === currentUrl;
      btnPin.classList.toggle('artifact-btn-active', isPinned);
      btnPin.title = isPinned ? t('browser.unpinUrl') : t('browser.pinUrl');
    } catch {}
  }
  btnPin?.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url || url === 'about:blank') { showToast(t('browser.pinEmpty'), 'warning'); return; }
    if (!projectPath) return;
    try {
      const prefs = await levis.getProjectPrefs(projectPath);
      const pinnedUrl = (prefs as any)?.previewUrl;
      if (pinnedUrl === url) {
        // Unpin
        await levis.setProjectPref(projectPath, 'previewUrl', '');
        btnPin.classList.remove('artifact-btn-active');
        btnPin.title = t('browser.pinUrl');
        showToast(t('browser.unpinned'), 'info');
      } else {
        // Pin
        await levis.setProjectPref(projectPath, 'previewUrl', url);
        btnPin.classList.add('artifact-btn-active');
        btnPin.title = t('browser.unpinUrl');
        showToast(t('browser.pinSaved', { url }), 'success');
      }
    } catch {}
  });
  // Sync pin state při navigaci
  webview.addEventListener('did-navigate', () => refreshPinState());
  webview.addEventListener('did-navigate-in-page', () => refreshPinState());
  urlInput.addEventListener('change', () => refreshPinState());
  // Initial sync po dom-ready
  setTimeout(() => refreshPinState(), 200);

  // ── Drag & drop ──
  wrapper.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  wrapper.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const textPath = e.dataTransfer?.getData('text/plain');
    if (textPath && /\.(html?|php|svg)$/i.test(textPath)) {
      loadFile(textPath);
      return;
    }
    const file = e.dataTransfer?.files?.[0];
    if (file && (file as any).path) {
      const fp = (file as any).path;
      if (/\.(html?|php|svg)$/i.test(fp)) loadFile(fp);
      else loadUrl('file:///' + fp.replace(/\\/g, '/'));
    }
  });

  btnDevtools.addEventListener('click', () => {
    if (webview.isDevToolsOpened()) webview.closeDevTools();
    else webview.openDevTools();
  });

  function updateNavButtons() {
    try {
      (btnBack as HTMLButtonElement).disabled = !webview.canGoBack();
      (btnForward as HTMLButtonElement).disabled = !webview.canGoForward();
    } catch {}
  }
  updateNavButtons();

  webview.addEventListener('did-navigate', (e: any) => { urlInput.value = e.url; updateNavButtons(); });
  webview.addEventListener('did-navigate-in-page', (e: any) => { urlInput.value = e.url; updateNavButtons(); });
  webview.addEventListener('did-finish-load', updateNavButtons);

  // ── Inspector ──
  const inspector = createInspector();
  let inspectActive = false;

  btnInspect.addEventListener('click', () => {
    inspectActive = !inspectActive;
    btnInspect.classList.toggle('artifact-btn-active', inspectActive);
    btnInspect.title = t(inspectActive ? 'browser.inspectOn' : 'browser.inspect');
    if (inspectActive) {
      inspector.enable(webview);
      if (annotating) toggleAnnotate(false);
    } else {
      inspector.disable();
    }
  });

  let selectedElement: any = null;

  function closePopover(): void {
    if (activePopover) { activePopover.remove(); activePopover = null; }
    elementRing.style.display = 'none';
  }

  function getElementRectInContainer(iframeRect: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
    const ifRect = webview.getBoundingClientRect();
    const ctRect = webviewContainer.getBoundingClientRect();
    return {
      x: (ifRect.left - ctRect.left) + iframeRect.x,
      y: (ifRect.top - ctRect.top) + iframeRect.y,
      width: iframeRect.width,
      height: iframeRect.height,
    };
  }

  function showFloatingPopover(rect: { x: number; y: number; width: number; height: number }, contextLabel: string, onSubmit: (text: string, auto: boolean) => void, onCancel?: () => void): void {
    closePopover();
    elementRing.style.display = 'block';
    elementRing.style.left = `${rect.x - 4}px`;
    elementRing.style.top = `${rect.y - 4}px`;
    elementRing.style.width = `${rect.width + 8}px`;
    elementRing.style.height = `${rect.height + 8}px`;

    const popover = document.createElement('div');
    popover.className = 'artifact-popover';
    popover.innerHTML = `
      <div class="popover-header">
        <span class="popover-icon">${I('inspect')}</span>
        <span class="popover-label">${contextLabel}</span>
        <button class="popover-close" title="Esc">${I('close')}</button>
      </div>
      <div class="popover-body">
        <input type="text" class="popover-input" placeholder="${t('browser.placeholder', { selector: contextLabel })}">
        <button class="popover-mode" type="button" aria-pressed="false" title="">✎</button>
        <button class="popover-send" title="">${I('play')}</button>
      </div>
      <div class="popover-arrow"></div>
    `;
    webviewContainer.appendChild(popover);
    activePopover = popover;

    const containerRect = webviewContainer.getBoundingClientRect();
    const pop = popover.getBoundingClientRect();
    const popW = pop.width || 380;
    const popH = pop.height || 80;
    const pad = 12;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    type Side = 'bottom' | 'top' | 'right' | 'left';
    const candidates: Array<{ side: Side; x: number; y: number }> = [
      { side: 'bottom', x: cx - popW / 2, y: rect.y + rect.height + pad },
      { side: 'top',    x: cx - popW / 2, y: rect.y - popH - pad },
      { side: 'right',  x: rect.x + rect.width + pad, y: cy - popH / 2 },
      { side: 'left',   x: rect.x - popW - pad, y: cy - popH / 2 },
    ];
    let chosen: { side: Side; x: number; y: number } | null = null;
    for (const c of candidates) {
      if (c.x >= 4 && c.y >= 4 && c.x + popW <= containerRect.width - 4 && c.y + popH <= containerRect.height - 4) {
        chosen = c; break;
      }
    }
    if (!chosen) chosen = { side: 'bottom', x: cx - popW / 2, y: rect.y + rect.height + pad };
    chosen.x = Math.max(8, Math.min(chosen.x, containerRect.width - popW - 8));
    chosen.y = Math.max(8, Math.min(chosen.y, containerRect.height - popH - 8));
    popover.style.left = `${chosen.x}px`;
    popover.style.top = `${chosen.y}px`;
    popover.dataset.side = chosen.side;

    const arrow = popover.querySelector('.popover-arrow') as HTMLElement;
    if (chosen.side === 'bottom') { arrow.style.left = `${Math.max(12, Math.min(cx - chosen.x, popW - 12))}px`; arrow.style.top = '-6px'; }
    else if (chosen.side === 'top') { arrow.style.left = `${Math.max(12, Math.min(cx - chosen.x, popW - 12))}px`; arrow.style.bottom = '-6px'; }
    else if (chosen.side === 'right') { arrow.style.top = `${Math.max(12, Math.min(cy - chosen.y, popH - 12))}px`; arrow.style.left = '-6px'; }
    else { arrow.style.top = `${Math.max(12, Math.min(cy - chosen.y, popH - 12))}px`; arrow.style.right = '-6px'; }

    const input = popover.querySelector('.popover-input') as HTMLInputElement;
    const sendBtn = popover.querySelector('.popover-send') as HTMLElement;
    const closeBtn = popover.querySelector('.popover-close') as HTMLElement;
    const modeBtn = popover.querySelector('.popover-mode') as HTMLButtonElement;
    const label = popover.querySelector('.popover-label') as HTMLElement;
    const safeLabel = contextLabel.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

    // Local state pro tento popover. currentAuto = true → Send s Enterem. false → bez Enteru.
    // Lokální flag eliminuje async race s IPC storeGet/storeSet.
    let currentAuto = true;
    let userInteracted = false;
    function applyMode(auto: boolean): void {
      currentAuto = auto;
      if (auto) {
        modeBtn.classList.remove('active');
        modeBtn.setAttribute('aria-pressed', 'false');
        modeBtn.title = t('browser.modeToggleToPrepare');
        sendBtn.title = t('browser.hintSend');
        if (label) { label.dataset.submitMode = 'send'; label.innerHTML = safeLabel; }
      } else {
        modeBtn.classList.add('active');
        modeBtn.setAttribute('aria-pressed', 'true');
        modeBtn.title = t('browser.modeToggleToSend');
        sendBtn.title = t('browser.hintPrepare');
        if (label) {
          label.dataset.submitMode = 'prepare';
          label.innerHTML = `${safeLabel} <span class="popover-badge-prepare">✎ ${t('browser.badgePrepare')}</span>`;
        }
      }
    }
    // Initial — výchozí hodnota přichází ze Settings checkboxu (store.inspectAutoSubmit).
    // Pokud user klikl tužku dřív, nepřepisuj.
    getInspectAutoSubmit().then(v => { if (!userInteracted) applyMode(v); }).catch(() => { if (!userInteracted) applyMode(true); });
    // Klik NEUKLÁDÁ do store — tužka je jen per-popover override, ne persistentní volba.
    // Persistentní default řídí Settings checkbox. Takhle nikdy nenastane stav, kdy si
    // user omylem přepne tužku, zavře popover a další inspect je v prepare módu bez
    // zjevné příčiny.
    modeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      userInteracted = true;
      applyMode(!currentAuto);
    });

    function submit() { onSubmit(input.value.trim(), currentAuto); }
    function cancel() { if (onCancel) onCancel(); closePopover(); }
    sendBtn.addEventListener('click', submit);
    closeBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    setTimeout(() => input.focus(), 50);
  }

  inspector.onSelect((info) => {
    selectedElement = info;
    if (!info.rect) return;
    showFloatingPopover(
      getElementRectInContainer(info.rect),
      info.selector,
      (text, auto) => sendElementPrompt(text, auto),
      () => {
        selectedElement = null;
        if (inspectActive) {
          inspector.disable();
          setTimeout(() => inspector.enable(webview), 150);
        }
      },
    );
  });

  // ── Lasso screenshot ──
  async function captureLasso(rect: { x: number; y: number; width: number; height: number }, useWebviewOffset: boolean): Promise<{ rel: string; abs: string } | null> {
    if (!projectPath) return null;
    try {
      const offsetEl = useWebviewOffset ? webview : webviewContainer;
      const off = offsetEl.getBoundingClientRect();
      const pad = 8;
      const abs = {
        x: Math.max(0, off.left + rect.x - pad),
        y: Math.max(0, off.top + rect.y - pad),
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      };
      const sep = projectPath.includes('\\') ? '\\' : '/';
      const filename = `lasso-${Date.now()}.png`;
      const savePath = (projectPath.replace(/\\/g, '/') + '/.levis-tmp/' + filename).replace(/\//g, sep);
      const result = await levis.captureRegion(abs, savePath);
      if (result && result.success && result.path) {
        return { rel: './.levis-tmp/' + filename, abs: result.path };
      }
    } catch {}
    return null;
  }

  function scheduleCleanup(absPath: string) {
    setTimeout(() => { levis.deleteFile(absPath).catch(() => {}); }, 30_000);
  }

  async function sendElementPrompt(userText: string, auto: boolean) {
    if (!selectedElement) return;
    const label = currentFilePath
      ? currentFilePath.replace(/\\/g, '/').split('/').pop() || ''
      : urlInput.value;
    let shot: { rel: string; abs: string } | null = null;
    if (selectedElement.rect) shot = await captureLasso(selectedElement.rect, true);

    let prompt = `V prohlížeči (${label}) uprav element ${selectedElement.selector}` +
      (selectedElement.text ? ` (obsah: "${selectedElement.text.substring(0, 50)}")` : '') +
      (userText ? ` — ${userText}` : '');
    if (shot) prompt += ` (screenshot: ${shot.rel})`;

    // `auto` pochází přímo z popoveru (lokální state toggle) — bez storeGet round-tripu
    // a bez race conditions.
    const submit = auto;
    armedReloadAfterCC = true;
    wrapper.dispatchEvent(new CustomEvent('send-to-pty', { detail: { text: prompt, submit, bypassQueue: true }, bubbles: true }));
    if (shot) scheduleCleanup(shot.abs);
    showToast(t(submit ? (shot ? 'toast.sentToCCWithShot' : 'toast.sentToCC') : 'toast.preparedInCC'), 'success');
    closePopover();
    selectedElement = null;
    if (inspectActive) {
      inspector.disable();
      setTimeout(() => inspector.enable(webview), 300);
    }
  }

  async function getInspectAutoSubmit(): Promise<boolean> {
    try {
      const v = await levis.storeGet('inspectAutoSubmit');
      return v !== false; // default ON
    } catch { return true; }
  }

  // ── Annotation (freehand lasso) ──
  let annotating = false;
  let annotCtx: CanvasRenderingContext2D | null = null;
  let drawing = false;
  let strokes: Array<Array<{x: number; y: number}>> = [];
  let currentStroke: Array<{x: number; y: number}> = [];

  function toggleAnnotate(force?: boolean) {
    annotating = force !== undefined ? force : !annotating;
    btnAnnotate.classList.toggle('artifact-btn-active', annotating);
    btnAnnotate.title = t(annotating ? 'browser.annotateDraw' : 'browser.annotate');
    annotCanvas.style.display = annotating ? 'block' : 'none';
    annotCanvas.style.pointerEvents = annotating ? 'auto' : 'none';
    if (annotating) {
      if (inspectActive) {
        inspectActive = false;
        btnInspect.classList.remove('artifact-btn-active');
        btnInspect.title = t('browser.inspect');
        inspector.disable();
      }
      const rect = webviewContainer.getBoundingClientRect();
      annotCanvas.width = rect.width;
      annotCanvas.height = rect.height;
      annotCtx = annotCanvas.getContext('2d');
      redrawAll();
    }
  }
  btnAnnotate.addEventListener('click', () => toggleAnnotate());

  annotCanvas.addEventListener('mousedown', (e: MouseEvent) => {
    if (!annotating || !annotCtx) return;
    drawing = true;
    const rect = annotCanvas.getBoundingClientRect();
    currentStroke = [{ x: e.clientX - rect.left, y: e.clientY - rect.top }];
  });
  annotCanvas.addEventListener('mousemove', (e: MouseEvent) => {
    if (!drawing || !annotCtx) return;
    const rect = annotCanvas.getBoundingClientRect();
    currentStroke.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    redrawAll();
    drawStroke(annotCtx, currentStroke, '#ff6a00', 3);
  });
  function endStroke() {
    if (drawing && currentStroke.length > 2) {
      currentStroke.push({ x: currentStroke[0].x, y: currentStroke[0].y });
      strokes.push([...currentStroke]);
      redrawAll();
      showAnnotPrompt(currentStroke);
    }
    drawing = false;
    currentStroke = [];
  }
  annotCanvas.addEventListener('mouseup', endStroke);
  annotCanvas.addEventListener('mouseleave', endStroke);
  annotCanvas.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    strokes = []; currentStroke = [];
    if (annotCtx) annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
  });

  function showAnnotPrompt(pts: Array<{x: number; y: number}>) {
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = maxX - minX, h = maxY - minY;
    const label = currentFilePath
      ? currentFilePath.replace(/\\/g, '/').split('/').pop() || ''
      : urlInput.value;

    showFloatingPopover(
      { x: minX, y: minY, width: w, height: h },
      `${Math.round(w)}×${Math.round(h)}px`,
      async (text, auto) => {
        if (!text) return;
        const shot = await captureLasso({ x: minX, y: minY, width: w, height: h }, false);
        let prompt = `V prohlížeči (${label}) v oblasti (${Math.round(minX)},${Math.round(minY)} → ${Math.round(maxX)},${Math.round(maxY)}) udělej: ${text}`;
        if (shot) prompt += ` (screenshot: ${shot.rel})`;
        const submit = auto;
        armedReloadAfterCC = true;
        wrapper.dispatchEvent(new CustomEvent('send-to-pty', { detail: { text: prompt, submit, bypassQueue: true }, bubbles: true }));
        if (shot) scheduleCleanup(shot.abs);
        showToast(t(submit ? (shot ? 'toast.sentToCCWithShot' : 'toast.sentToCC') : 'toast.preparedInCC'), 'success');
        closePopover();
        strokes.pop();
        redrawAll();
      },
      () => { strokes.pop(); redrawAll(); },
    );
  }

  function drawStroke(ctx: CanvasRenderingContext2D, pts: Array<{x: number; y: number}>, color: string, width: number) {
    if (pts.length < 2) return;
    const isClosed = pts.length > 3 &&
      Math.abs(pts[0].x - pts[pts.length - 1].x) < 5 &&
      Math.abs(pts[0].y - pts[pts.length - 1].y) < 5;
    if (isClosed) {
      ctx.fillStyle = 'rgba(255,106,0,0.12)';
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,106,0,0.25)';
    ctx.lineWidth = width + 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (isClosed) ctx.closePath(); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (isClosed) ctx.closePath(); ctx.stroke();
  }

  function redrawAll() {
    if (!annotCtx) return;
    annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
    for (const s of strokes) drawStroke(annotCtx, s, '#ff6a00', 3);
  }

  // ── Initial load ──
  if (!defaultUrl && projectPath) {
    // Statický projekt — zkus najít index.html
    (async () => {
      const sep = projectPath.includes('\\') ? '\\' : '/';
      const candidates = [
        projectPath + sep + 'index.html',
        projectPath + sep + 'public' + sep + 'index.html',
        projectPath + sep + 'src' + sep + 'index.html',
      ];
      for (const c of candidates) {
        try {
          const content = await levis.readFile(c);
          if (typeof content === 'string') { await loadFile(c); return; }
        } catch {}
      }
    })();
  }

  // ── Drag-to-pan (middle mouse / Shift+click) ──
  let panActive = false;
  let panStartX = 0, panStartY = 0, panScrollX = 0, panScrollY = 0;
  webviewContainer.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      panActive = true;
      panStartX = e.clientX; panStartY = e.clientY;
      panScrollX = webviewContainer.scrollLeft; panScrollY = webviewContainer.scrollTop;
    }
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!panActive) return;
    webviewContainer.scrollLeft = panScrollX - (e.clientX - panStartX);
    webviewContainer.scrollTop = panScrollY - (e.clientY - panStartY);
  });
  window.addEventListener('mouseup', () => { panActive = false; });

  return {
    element: wrapper,
    setUrl: (url: string) => loadUrl(url),
    getUrl: () => urlInput.value,
    loadFile,
    refresh: () => {
      if (currentFilePath) loadFile(currentFilePath);
      else if (typeof (webview as any).reloadIgnoringCache === 'function') {
        try { (webview as any).reloadIgnoringCache(); } catch {}
      }
    },
    isInteracting: () => inspectActive || annotating || !!activePopover,
    setLoading: (on: boolean, message?: string) => {
      loaderFromDevServer = on && !!message;
      setLoading(on, message);
    },
    notifyCCDone: () => {
      if (!armedReloadAfterCC) return;
      armedReloadAfterCC = false;
      if (watching) return; // Watch mód si reload dělá sám, netřeba dublovat
      if (currentFilePath) { loadFile(currentFilePath); return; }
      if (webview.src && webview.src !== 'about:blank') {
        try { if (typeof (webview as any).reloadIgnoringCache === 'function') (webview as any).reloadIgnoringCache(); } catch {}
      }
    },
    dispose: () => {
      stopWatch();
      inspector.dispose();
      document.removeEventListener('mousemove', onTouchMove);
      document.removeEventListener('mousedown', onTouchDown);
      document.removeEventListener('mouseup', onTouchUp);
      touchCursor.remove();
      wrapper.remove();
    },
  };
}

(window as any).createBrowser = createBrowser;
