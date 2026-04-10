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
    <span style="flex:1"></span>
    <div class="artifact-size-btns">
      <button class="artifact-size-btn" data-size="mobile" title="Mobile (412px)">${I('mobile')}</button>
      <button class="artifact-size-btn" data-size="tablet" title="Tablet (768px)">${I('file')}</button>
      <button class="artifact-size-btn artifact-size-active" data-size="full" title="Full">${I('browser')}</button>
    </div>
    <button class="artifact-btn browser-inspect" title="${t('artifact.inspectTip')}">${I('inspect')} ${t('browser.inspect')}</button>
    <button class="artifact-btn browser-annotate" title="${t('artifact.annotateTip')}">${I('editor')} ${t('browser.annotate')}</button>
    <button class="artifact-btn browser-reload" title="${t('artifact.refreshTip')}">${I('refresh')}</button>
    <button class="artifact-btn browser-watch" title="${t('artifact.watchTip')}">${I('eye')} Watch</button>
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
        try { if (typeof (webview as any).reload === 'function') (webview as any).reload(); } catch {}
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

  // ── Reload button ──
  toolbar.querySelector('.browser-reload')!.addEventListener('click', () => {
    if (typeof (webview as any).reload === 'function') {
      try { (webview as any).reload(); } catch {}
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
  let infoBar: HTMLElement | null = null;

  inspector.onSelect((info) => {
    selectedElement = info;
    showInfoBar(info.selector, async (text) => {
      await sendElementPrompt(text);
    });
  });

  function showInfoBar(selector: string, onSubmit: (text: string) => void) {
    if (infoBar) infoBar.remove();
    infoBar = document.createElement('div');
    infoBar.className = 'artifact-info-bar';
    infoBar.style.cssText = 'position:absolute;left:8px;right:8px;bottom:8px;display:flex;gap:6px;background:#14141c;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:6px;z-index:20;';
    infoBar.innerHTML = `
      <span class="info-selector" style="color:#ff6a00;font:12px monospace;align-self:center;max-width:30%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
      <input type="text" class="info-prompt" placeholder="${t('browser.placeholder', { selector })}" style="flex:1;background:#0a0a0f;border:1px solid #2a2a3a;color:#e8e8f0;padding:4px 8px;border-radius:4px;">
      <button class="info-send artifact-btn">${I('play')}</button>
      <button class="info-clear artifact-btn">${I('close')}</button>
    `;
    (infoBar.querySelector('.info-selector') as HTMLElement).textContent = selector;
    webviewContainer.appendChild(infoBar);
    const input = infoBar.querySelector('.info-prompt') as HTMLInputElement;
    input.focus();
    const send = () => { onSubmit(input.value.trim()); };
    infoBar.querySelector('.info-send')!.addEventListener('click', send);
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
      if (e.key === 'Escape') closeInfoBar();
    });
    infoBar.querySelector('.info-clear')!.addEventListener('click', closeInfoBar);
  }

  function closeInfoBar() {
    if (infoBar) { infoBar.remove(); infoBar = null; }
    selectedElement = null;
  }

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
    closeInfoBar();
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

  let annotPrompt: HTMLElement | null = null;
  function showAnnotPrompt(pts: Array<{x: number; y: number}>) {
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = maxX - minX, h = maxY - minY;

    if (annotPrompt) annotPrompt.remove();
    annotPrompt = document.createElement('div');
    annotPrompt.className = 'annot-prompt';
    annotPrompt.style.cssText = `position:absolute;left:${Math.max(8, minX)}px;top:${Math.min(maxY + 8, annotCanvas.height - 50)}px;display:flex;gap:6px;background:#14141c;border:1px solid #ff6a00;border-radius:6px;padding:6px;z-index:30;`;
    annotPrompt.innerHTML = `
      <span style="color:#ff6a00;font:11px monospace;align-self:center;">${Math.round(w)}×${Math.round(h)}px</span>
      <input type="text" class="annot-prompt-input" placeholder="${t('browser.areaPrompt')}" style="flex:1;background:#0a0a0f;border:1px solid #2a2a3a;color:#e8e8f0;padding:4px 8px;border-radius:4px;min-width:200px;">
      <button class="annot-prompt-send artifact-btn">${I('play')}</button>
      <button class="annot-prompt-clear artifact-btn">${I('close')}</button>
    `;
    webviewContainer.appendChild(annotPrompt);
    const input = annotPrompt.querySelector('.annot-prompt-input') as HTMLInputElement;
    input.focus();

    const sendAnnot = async () => {
      const text = input.value.trim();
      if (!text) return;
      const shot = await captureLasso({ x: minX, y: minY, width: w, height: h }, false);
      let prompt = `V prohlížeči (${urlInput.value}) v oblasti (${Math.round(minX)},${Math.round(minY)} → ${Math.round(maxX)},${Math.round(maxY)}) udělej: ${text}`;
      if (shot) prompt += ` (screenshot: ${shot.rel})`;
      wrapper.dispatchEvent(new CustomEvent('send-to-pty', { detail: prompt, bubbles: true }));
      if (shot) scheduleCleanup(shot.abs);
      showToast(t(shot ? 'toast.sentToCCWithShot' : 'toast.sentToCC'), 'success');
      if (annotPrompt) { annotPrompt.remove(); annotPrompt = null; }
      strokes.pop();
      redrawAll();
    };

    annotPrompt.querySelector('.annot-prompt-send')!.addEventListener('click', sendAnnot);
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') sendAnnot();
      if (e.key === 'Escape') {
        strokes.pop(); redrawAll();
        if (annotPrompt) { annotPrompt.remove(); annotPrompt = null; }
      }
    });
    annotPrompt.querySelector('.annot-prompt-clear')!.addEventListener('click', () => {
      strokes.pop(); redrawAll();
      if (annotPrompt) { annotPrompt.remove(); annotPrompt = null; }
    });
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
