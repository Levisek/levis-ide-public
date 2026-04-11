// ── Browser Panel (webview) ─────────────
// Plnohodnotny prohlizec s killer feature: Inspect + lasso screenshot do CC.

interface BrowserInstance {
  setUrl: (url: string) => void;
  getUrl: () => string;
  dispose: () => void;
}

function createBrowser(container: HTMLElement, defaultUrl: string = 'http://localhost:8080', projectPath: string = ''): BrowserInstance {
  const I = (window as any).icon;
  const wrapper = document.createElement('div');
  wrapper.className = 'browser-panel';
  wrapper.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;position:relative;';

  const toolbar = document.createElement('div');
  toolbar.className = 'browser-toolbar';
  toolbar.innerHTML = `
    <button class="btn-back" title="${t('browser.back')}">‹</button>
    <button class="btn-forward" title="${t('browser.forward')}">›</button>
    <input type="text" class="browser-url" value="${defaultUrl}" placeholder="URL...">
    <div class="artifact-size-btns">
      <button class="artifact-size-btn" data-size="mobile" title="Mobile (412px)">${I('mobile')}</button>
      <button class="artifact-size-btn" data-size="tablet" title="Tablet (768px)">${I('file')}</button>
      <button class="artifact-size-btn artifact-size-active" data-size="full" title="Full">${I('browser')}</button>
    </div>
    <button class="artifact-btn browser-inspect" title="${t('artifact.inspectTip')}">${I('inspect')} ${t('browser.inspect')}</button>
    <button class="artifact-btn browser-annotate" title="${t('artifact.annotateTip')}">${I('editor')} ${t('browser.annotate')}</button>
    <button class="artifact-btn browser-reload" title="${t('artifact.refreshTip')}">${I('refresh')}</button>
    <button class="artifact-btn browser-watch" title="${t('artifact.watchTip')}">${I('eye')} Watch</button>
    <button class="artifact-btn browser-color-scheme" title="Dark / Light mode">☀</button>
    <button class="btn-devtools" title="DevTools">${I('gear')}</button>
  `;
  wrapper.appendChild(toolbar);

  const webviewContainer = document.createElement('div');
  webviewContainer.className = 'browser-webview-container';
  webviewContainer.style.cssText = 'position:relative;flex:1 1 auto;overflow:hidden;';
  wrapper.appendChild(webviewContainer);

  const webview = document.createElement('webview') as any;
  webview.setAttribute('src', defaultUrl);
  webview.setAttribute('allowpopups', '');
  webview.style.width = '100%';
  webview.style.height = '100%';
  webview.style.position = 'absolute';
  webview.style.top = '0';
  webview.style.left = '0';
  webviewContainer.appendChild(webview);

  // Annotation canvas overlay (nad webview)
  const annotCanvas = document.createElement('canvas');
  annotCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:none;pointer-events:none;z-index:10;';
  webviewContainer.appendChild(annotCanvas);

  // Element ring overlay (floating popover host)
  const elementRing = document.createElement('div');
  elementRing.className = 'artifact-element-ring';
  elementRing.style.display = 'none';
  webviewContainer.appendChild(elementRing);

  let activePopover: HTMLElement | null = null;

  container.appendChild(wrapper);

  const urlInput = toolbar.querySelector('.browser-url') as HTMLInputElement;
  const btnBack = toolbar.querySelector('.btn-back') as HTMLElement;
  const btnForward = toolbar.querySelector('.btn-forward') as HTMLElement;
  const btnDevtools = toolbar.querySelector('.btn-devtools') as HTMLElement;
  const btnInspect = toolbar.querySelector('.browser-inspect') as HTMLElement;
  const btnAnnotate = toolbar.querySelector('.browser-annotate') as HTMLElement;

  // ── Responsive size buttons (same as artifact) ──
  let currentSize = 'full';
  let touchWebContentsId: number | null = null;
  webview.addEventListener('dom-ready', () => {
    try { touchWebContentsId = (webview as any).getWebContentsId(); } catch {}
    // Reapply touch state after navigation
    if (currentSize === 'mobile' && touchWebContentsId != null) {
      levis.mobileEnableTouch(touchWebContentsId).catch(() => {});
    }
  });

  const sizeBtns = toolbar.querySelectorAll('.artifact-size-btn');
  sizeBtns.forEach((btn: Element) => {
    btn.addEventListener('click', async () => {
      currentSize = btn.getAttribute('data-size') || 'full';
      sizeBtns.forEach(b => b.classList.remove('artifact-size-active'));
      btn.classList.add('artifact-size-active');

      switch (currentSize) {
        case 'mobile':
          webviewContainer.style.background = '#0a0a0f';
          webviewContainer.style.display = 'flex';
          webviewContainer.style.alignItems = 'flex-start';
          webviewContainer.style.justifyContent = 'center';
          webviewContainer.style.overflow = 'auto';
          webview.style.position = 'relative';
          webview.style.width = '412px';
          webview.style.height = '915px';
          webview.style.flex = '0 0 auto';
          webview.style.margin = '12px auto';
          webview.style.border = '1px solid rgba(255,255,255,0.12)';
          webview.style.borderRadius = '24px';
          webview.style.boxShadow = '0 8px 40px rgba(0,0,0,0.5)';
          if (touchWebContentsId != null) {
            try { await levis.mobileEnableTouch(touchWebContentsId); } catch {}
          }
          break;
        case 'tablet':
          resetWebviewFull();
          webview.style.width = '768px';
          webview.style.margin = '0 auto';
          webview.style.position = 'relative';
          webviewContainer.style.display = 'flex';
          webviewContainer.style.justifyContent = 'center';
          webviewContainer.style.overflow = 'auto';
          webviewContainer.classList.add('artifact-device-frame');
          if (touchWebContentsId != null) {
            try { await levis.mobileDisableTouch(touchWebContentsId); } catch {}
          }
          break;
        default: // full
          resetWebviewFull();
          webviewContainer.classList.remove('artifact-device-frame');
          if (touchWebContentsId != null) {
            try { await levis.mobileDisableTouch(touchWebContentsId); } catch {}
          }
      }
    });
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
    webview.style.flex = '';
    webview.style.margin = '';
    webview.style.border = '';
    webview.style.borderRadius = '';
    webview.style.boxShadow = '';
  }

  // ── Watch mode (auto-reload) — defaultně ON pro localhost ──
  let watching = false;
  let watchInterval: any = null;
  const watchBtn = toolbar.querySelector('.browser-watch') as HTMLElement;

  function startWatch(): void {
    if (watchInterval) return;
    watchInterval = setInterval(() => {
      if (webview.src && webview.src !== 'about:blank') {
        try { if (typeof (webview as any).reloadIgnoringCache === 'function') (webview as any).reloadIgnoringCache(); } catch {}
      }
    }, 2000);
  }
  function stopWatch(): void {
    if (watchInterval) { clearInterval(watchInterval); watchInterval = null; }
  }
  watchBtn.addEventListener('click', () => {
    watching = !watching;
    watchBtn.classList.toggle('artifact-watch-active', watching);
    watchBtn.innerHTML = `${I('eye')} ${watching ? 'Watching' : 'Watch'}`;
    if (watching) startWatch(); else stopWatch();
  });

  // ── Dark/Light mode simulace ──
  let colorScheme: 'dark' | 'light' = 'light';
  const btnColorScheme = toolbar.querySelector('.browser-color-scheme') as HTMLElement;
  btnColorScheme.addEventListener('click', async () => {
    colorScheme = colorScheme === 'light' ? 'dark' : 'light';
    btnColorScheme.textContent = colorScheme === 'dark' ? '☾' : '☀';
    btnColorScheme.classList.toggle('artifact-btn-active', colorScheme === 'dark');
    if (touchWebContentsId != null) {
      await levis.mobileSetColorScheme(touchWebContentsId, colorScheme);
    }
    showToast(`prefers-color-scheme: ${colorScheme}`, 'info');
  });

  // ── Reload button ──
  toolbar.querySelector('.browser-reload')!.addEventListener('click', () => {
    if (typeof (webview as any).reloadIgnoringCache === 'function') {
      try { (webview as any).reloadIgnoringCache(); } catch {}
    }
  });

  function loadUrl(url: string): void {
    if (!url) return;
    // Podporuje file://, http://, https://
    if (!/^(https?|file):\/\//i.test(url)) {
      if (url.includes('\\') || url.includes('/')) {
        // Vypadá jako cesta k souboru
        url = 'file:///' + url.replace(/\\/g, '/');
      } else {
        url = 'http://' + url;
      }
    }
    webview.src = url;
    urlInput.value = url;
  }

  urlInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') loadUrl(urlInput.value.trim());
  });

  btnBack.addEventListener('click', () => { if (webview.canGoBack()) webview.goBack(); });
  btnForward.addEventListener('click', () => { if (webview.canGoForward()) webview.goForward(); });

  // ── Drag & drop HTML soubor do preview ──
  wrapper.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  wrapper.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // File tree drag (text/plain s cestou)
    const textPath = e.dataTransfer?.getData('text/plain');
    if (textPath && /\.(html?|php)$/i.test(textPath)) {
      loadUrl('file:///' + textPath.replace(/\\/g, '/'));
      return;
    }
    // OS file drop
    const file = e.dataTransfer?.files?.[0];
    if (file && (file as any).path) {
      loadUrl('file:///' + (file as any).path.replace(/\\/g, '/'));
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

  // ── Inspector ─────────────────────────
  const inspector = createInspector();
  let inspectActive = false;

  btnInspect.addEventListener('click', () => {
    inspectActive = !inspectActive;
    btnInspect.classList.toggle('artifact-btn-active', inspectActive);
    btnInspect.innerHTML = `${I('inspect')} ${t(inspectActive ? 'browser.inspectOn' : 'browser.inspect')}`;
    if (inspectActive) {
      inspector.enable(webview);
      if (annotating) toggleAnnotate(false);
    } else {
      inspector.disable();
    }
  });

  webview.addEventListener('dom-ready', () => {
    if (inspectActive) setTimeout(() => inspector.enable(webview), 200);
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

  function showFloatingPopover(rect: { x: number; y: number; width: number; height: number }, contextLabel: string, onSubmit: (text: string) => void, onCancel?: () => void): void {
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
        <button class="popover-send" title="${t('toast.sentToCC')}">${I('play')}</button>
      </div>
      <div class="popover-arrow"></div>
    `;
    webviewContainer.appendChild(popover);
    activePopover = popover;

    // Smart placement
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
    function submit() { onSubmit(input.value.trim()); }
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
      (text) => sendElementPrompt(text),
      () => { selectedElement = null; },
    );
  });

  // ── Lasso screenshot (capturePage cesta) ──
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

  async function sendElementPrompt(userText: string) {
    if (!selectedElement) return;
    const url = urlInput.value;
    let shot: { rel: string; abs: string } | null = null;
    if (selectedElement.rect) shot = await captureLasso(selectedElement.rect, true);

    let prompt = `V prohlížeči (${url}) uprav element ${selectedElement.selector}` +
      (selectedElement.text ? ` (obsah: "${selectedElement.text.substring(0, 50)}")` : '') +
      (userText ? ` — ${userText}` : '');
    if (shot) prompt += ` (screenshot: ${shot.rel})`;

    wrapper.dispatchEvent(new CustomEvent('send-to-pty', { detail: prompt, bubbles: true }));
    if (shot) scheduleCleanup(shot.abs);
    showToast(t(shot ? 'toast.sentToCCWithShot' : 'toast.sentToCC'), 'success');
    closePopover();
    if (inspectActive) {
      inspector.disable();
      setTimeout(() => inspector.enable(webview), 300);
    }
  }

  // ── Annotation (freehand lasso) ───────
  let annotating = false;
  let annotCtx: CanvasRenderingContext2D | null = null;
  let drawing = false;
  let strokes: Array<Array<{x: number; y: number}>> = [];
  let currentStroke: Array<{x: number; y: number}> = [];

  function toggleAnnotate(force?: boolean) {
    annotating = force !== undefined ? force : !annotating;
    btnAnnotate.classList.toggle('artifact-btn-active', annotating);
    btnAnnotate.innerHTML = `${I('editor')} ${t(annotating ? 'browser.annotateDraw' : 'browser.annotate')}`;
    annotCanvas.style.display = annotating ? 'block' : 'none';
    annotCanvas.style.pointerEvents = annotating ? 'auto' : 'none';

    if (annotating) {
      if (inspectActive) {
        inspectActive = false;
        btnInspect.classList.remove('artifact-btn-active');
        btnInspect.innerHTML = `${I('inspect')} Inspect`;
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

    showFloatingPopover(
      { x: minX, y: minY, width: w, height: h },
      `${Math.round(w)}×${Math.round(h)}px`,
      async (text) => {
        if (!text) return;
        const shot = await captureLasso({ x: minX, y: minY, width: w, height: h }, false);
        let prompt = `V prohlížeči (${urlInput.value}) v oblasti (${Math.round(minX)},${Math.round(minY)} → ${Math.round(maxX)},${Math.round(maxY)}) udělej: ${text}`;
        if (shot) prompt += ` (screenshot: ${shot.rel})`;
        wrapper.dispatchEvent(new CustomEvent('send-to-pty', { detail: prompt, bubbles: true }));
        if (shot) scheduleCleanup(shot.abs);
        showToast(t(shot ? 'toast.sentToCCWithShot' : 'toast.sentToCC'), 'success');
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
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,106,0,0.25)';
    ctx.lineWidth = width + 6;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (isClosed) ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (isClosed) ctx.closePath();
    ctx.stroke();
  }

  function redrawAll() {
    if (!annotCtx) return;
    annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
    for (const s of strokes) drawStroke(annotCtx, s, '#ff6a00', 3);
  }

  return {
    setUrl: (url: string) => loadUrl(url),
    getUrl: () => urlInput.value,
    dispose: () => {
      inspector.dispose();
      wrapper.remove();
    },
  };
}

(window as any).createBrowser = createBrowser;
