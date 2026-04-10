// ── Mobile Preview Panel ─────────────────
// Jednoduchy iframe na localhost dev server (Vite/Next/CRA/...).
// Presety velikosti od malych telefonu po tablet, inspector + annotace
// jako v artifact panelu.

interface MobileInstance {
  element: HTMLElement;
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
  loadUrl: (url: string) => void;
  dispose: () => void;
}

interface DevicePreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'iphone-se',  label: 'iPhone SE',     width: 375, height: 667 },
  { id: 'iphone-12',  label: 'iPhone 12/13',  width: 390, height: 844 },
  { id: 'iphone-pro', label: 'iPhone 15 Pro', width: 393, height: 852 },
  { id: 'pixel',      label: 'Pixel 7',       width: 412, height: 915 },
  { id: 'galaxy',     label: 'Galaxy S20+',   width: 384, height: 854 },
  { id: 'ipad-mini',  label: 'iPad Mini',     width: 768, height: 1024 },
  { id: 'ipad-pro',   label: 'iPad Pro 11"',  width: 834, height: 1194 },
  { id: 'full',       label: 'Full',          width: 0,   height: 0 },
];

function createMobile(container: HTMLElement, projectPath: string, _projectName: string): MobileInstance {
  const wrapper = document.createElement('div');
  wrapper.className = 'mobile-panel artifact-panel';

  const presetOptions = DEVICE_PRESETS.map(p =>
    `<option value="${p.id}">${p.label}${p.width ? ` (${p.width}\u00d7${p.height})` : ''}</option>`
  ).join('');

  // Toolbar
  const I = (window as any).icon;
  const toolbar = document.createElement('div');
  toolbar.className = 'artifact-toolbar mobile-toolbar';
  toolbar.innerHTML = `
    <span class="artifact-icon">${I('mobile')}</span>
    <span class="artifact-title">Mobile</span>
    <input type="text" class="mobile-url" placeholder="http://localhost:5173" style="flex:1;min-width:160px;max-width:280px;padding:4px 8px;background:var(--bg-1,#0a0a0f);border:1px solid var(--border,#2a2a3a);color:var(--text,#e8e8f0);border-radius:4px;font-size:12px;">
    <button class="artifact-btn mobile-load" title="${t('mobile.loadUrl')}">${I('play')} Load</button>
    <select class="mobile-preset" title="${t('mobile.deviceSize')}" style="padding:4px 6px;background:var(--bg-1,#0a0a0f);border:1px solid var(--border,#2a2a3a);color:var(--text,#e8e8f0);border-radius:4px;font-size:12px;">${presetOptions}</select>
    <button class="artifact-btn mobile-rotate" title="${t('mobile.rotate')}">${I('refresh')}</button>
    <span style="flex:1"></span>
    <button class="artifact-btn mobile-touch-toggle" title="${t('mobile.touchEm')}">${I('inspect')} Touch</button>
    <button class="artifact-btn artifact-inspect" title="${t('browser.inspect')}">${I('inspect')} ${t('browser.inspect')}</button>
    <button class="artifact-btn artifact-annotate" title="${t('mobile.lasso')}">${I('editor')} ${t('browser.annotate')}</button>
    <button class="artifact-btn artifact-reload" title="${t('artifact.refreshTip')}">${I('refresh')}</button>
  `;
  wrapper.appendChild(toolbar);

  // Preview container
  const previewContainer = document.createElement('div');
  previewContainer.className = 'artifact-preview mobile-preview';
  wrapper.appendChild(previewContainer);

  // Wrapper s pevnym rozmerem; webview vyplni 100% wrapperu.
  // Diky tomu webview nemusime nasilim sizovat (jeho default chovani je
  // ignorovat inline width/height) a scroll v previewContaineru funguje na wrapper.
  const deviceWrap = document.createElement('div');
  deviceWrap.className = 'mobile-device-wrap';
  previewContainer.appendChild(deviceWrap);

  const iframe = document.createElement('webview') as any;
  iframe.className = 'artifact-iframe mobile-iframe';
  iframe.setAttribute('allowpopups', '');
  // Inline styly aby webview vyplnil wrapper bez ohledu na CSS specificity
  iframe.style.display = 'flex';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.flex = '1 1 auto';
  deviceWrap.appendChild(iframe);


  // Annotation canvas overlay
  const annotCanvas = document.createElement('canvas');
  annotCanvas.className = 'artifact-annot-canvas';
  previewContainer.appendChild(annotCanvas);

  // Mini-prompt bar (inspector select)
  const infoBar = document.createElement('div');
  infoBar.className = 'artifact-info-bar';
  infoBar.style.display = 'none';
  infoBar.innerHTML = `
    <span class="info-selector"></span>
    <input type="text" class="info-prompt" placeholder="${t('artifact.promptPh')}">
    <button class="info-send" title="${t('toast.sentToCC')}">${I('play')}</button>
    <button class="info-clear" title="${t('mobile.cancel')}">${I('close')}</button>
  `;
  wrapper.appendChild(infoBar);

  container.appendChild(wrapper);

  const urlInput = toolbar.querySelector('.mobile-url') as HTMLInputElement;
  const presetSelect = toolbar.querySelector('.mobile-preset') as HTMLSelectElement;
  const btnLoad = toolbar.querySelector('.mobile-load') as HTMLElement;
  const btnRotate = toolbar.querySelector('.mobile-rotate') as HTMLElement;
  const btnReload = toolbar.querySelector('.artifact-reload') as HTMLElement;

  let currentUrl = '';
  let currentPreset: DevicePreset = DEVICE_PRESETS[1]; // iPhone 12 default
  let landscape = false;
  let selectedElement: any = null;

  // ── Auto-detect dev port from package.json ──
  (async () => {
    try {
      const pkgRaw = await levis.readFile(projectPath + '\\package.json');
      if (typeof pkgRaw !== 'string') return;
      const pkg = JSON.parse(pkgRaw);
      const scripts: Record<string, string> = pkg.scripts || {};
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      // Try to guess port from common frameworks
      let port = 5173;
      if (deps.expo) port = 8081;
      else if (deps.next) port = 3000;
      else if (deps['react-scripts']) port = 3000;
      else if (deps.vite) port = 5173;
      else if (deps.astro) port = 4321;
      else if (deps.nuxt || deps['nuxt3']) port = 3000;

      // Try to find explicit --port in scripts
      const allScripts = Object.values(scripts).join(' ');
      const portMatch = allScripts.match(/--port[= ](\d+)/);
      if (portMatch) port = parseInt(portMatch[1], 10);

      urlInput.value = `http://localhost:${port}`;
    } catch {
      urlInput.value = 'http://localhost:5173';
    }
  })();

  // ── Sizing ───────────────────────────
  function applyPreset(): void {
    if (currentPreset.width === 0) {
      deviceWrap.style.width = '100%';
      deviceWrap.style.height = '100%';
      deviceWrap.style.margin = '0';
      deviceWrap.style.flexShrink = '0';
      previewContainer.classList.remove('artifact-device-frame');
      return;
    }
    const w = landscape ? currentPreset.height : currentPreset.width;
    const h = landscape ? currentPreset.width : currentPreset.height;
    deviceWrap.style.width = w + 'px';
    deviceWrap.style.height = h + 'px';
    deviceWrap.style.margin = '12px auto';
    deviceWrap.style.flexShrink = '0';
    previewContainer.classList.add('artifact-device-frame');
  }

  presetSelect.value = currentPreset.id;
  presetSelect.addEventListener('change', () => {
    const preset = DEVICE_PRESETS.find(p => p.id === presetSelect.value);
    if (preset) {
      currentPreset = preset;
      applyPreset();
    }
  });

  btnRotate.addEventListener('click', () => {
    landscape = !landscape;
    applyPreset();
  });

  applyPreset();

  // ── Drag-to-pan (myš jako prst) ──────
  // Middle mouse drag NEBO Shift+levy drag panuje obsahem previewContaineru.
  // Iframe by jinak chytal myš, takze behem panu dame pointer-events:none.
  let panActive = false;
  let panStartX = 0, panStartY = 0;
  let panScrollX = 0, panScrollY = 0;

  previewContainer.addEventListener('mousedown', (e: MouseEvent) => {
    const isMiddle = e.button === 1;
    const isShiftLeft = e.button === 0 && e.shiftKey;
    if (!isMiddle && !isShiftLeft) return;
    e.preventDefault();
    panActive = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panScrollX = previewContainer.scrollLeft;
    panScrollY = previewContainer.scrollTop;
    previewContainer.classList.add('panning');
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!panActive) return;
    previewContainer.scrollLeft = panScrollX - (e.clientX - panStartX);
    previewContainer.scrollTop = panScrollY - (e.clientY - panStartY);
  });

  window.addEventListener('mouseup', () => {
    if (!panActive) return;
    panActive = false;
    previewContainer.classList.remove('panning');
  });

  // ── Load URL ─────────────────────────
  function loadUrl(url: string): void {
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    currentUrl = url;
    iframe.src = url;
  }

  btnLoad.addEventListener('click', () => loadUrl(urlInput.value.trim()));
  urlInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') loadUrl(urlInput.value.trim());
  });
  btnReload.addEventListener('click', () => {
    if (!currentUrl) return;
    // webview ma reload() metodu — spolehlivejsi nez src= re-assign
    if (typeof (iframe as any).reload === 'function') {
      try { (iframe as any).reload(); return; } catch {}
    }
    iframe.src = currentUrl;
  });

  // ── Inspector ────────────────────────
  const inspector = createInspector();
  const btnInspect = toolbar.querySelector('.artifact-inspect') as HTMLElement;
  let inspectActive = false;

  btnInspect.addEventListener('click', () => {
    inspectActive = !inspectActive;
    btnInspect.classList.toggle('artifact-btn-active', inspectActive);
    btnInspect.innerHTML = `${I('inspect')} ${t(inspectActive ? 'browser.inspectOn' : 'browser.inspect')}`;
    if (inspectActive) {
      inspector.enable(iframe);
      // Mutually exclusive — vypni annotate
      if (annotating) {
        annotating = false;
        btnAnnotate.classList.remove('artifact-btn-active');
        btnAnnotate.innerHTML = `${I('editor')} Označit`;
        annotCanvas.style.display = 'none';
        annotCanvas.style.pointerEvents = 'none';
      }
    } else {
      inspector.disable();
    }
  });

  // ── Touch emulation pres CDP ──
  // Po prvnim dom-ready zapneme Emulation.setEmitTouchEventsForMouse na guest
  // webContents. Chrome pak sam konvertuje mouse eventy v webview na touch.
  let touchEmulationOn = false;
  let webContentsId: number | null = null;

  async function applyTouchEmulation(): Promise<void> {
    if (webContentsId == null) return;
    if (touchEmulationOn) await levis.mobileEnableTouch(webContentsId);
    else await levis.mobileDisableTouch(webContentsId);
  }

  iframe.addEventListener('dom-ready', async () => {
    try {
      webContentsId = (iframe as any).getWebContentsId();
      await applyTouchEmulation();
      console.log('[mobile] touch emulation', touchEmulationOn ? 'ON' : 'OFF', 'id=', webContentsId);
    } catch (err) {
      console.warn('[mobile] touch emulation failed', err);
    }
    if (inspectActive) setTimeout(() => inspector.enable(iframe), 300);
  });

  const btnTouchToggle = toolbar.querySelector('.mobile-touch-toggle') as HTMLElement;
  btnTouchToggle.addEventListener('click', async () => {
    touchEmulationOn = !touchEmulationOn;
    btnTouchToggle.classList.toggle('artifact-btn-active', touchEmulationOn);
    await applyTouchEmulation();
    showToast(t(touchEmulationOn ? 'mobile.touchOn' : 'mobile.touchOff'), 'info');
  });

  const infoPromptInput = infoBar.querySelector('.info-prompt') as HTMLInputElement;
  const infoSelectorLabel = infoBar.querySelector('.info-selector') as HTMLElement;

  inspector.onSelect((info) => {
    selectedElement = info;
    infoBar.style.display = 'flex';
    infoSelectorLabel.textContent = info.selector;
    infoPromptInput.value = '';
    infoPromptInput.placeholder = `Co udělat s ${info.selector}?`;
    infoPromptInput.focus();
  });

  function sendElementPrompt(): void {
    if (!selectedElement) return;
    const userText = infoPromptInput.value.trim();
    const fullPrompt = `V mobile preview (${currentUrl}) uprav element ${selectedElement.selector}` +
      (selectedElement.text ? ` (obsah: "${selectedElement.text.substring(0, 50)}")` : '') +
      (userText ? ` — ${userText}` : '');
    wrapper.dispatchEvent(new CustomEvent('send-to-pty', { detail: fullPrompt, bubbles: true }));
    showToast(t('toast.sentToCC'), 'success');
    infoPromptInput.value = '';
    selectedElement = null;
    infoBar.style.display = 'none';
    // Drive jsme tu inspector vypinali a zase zapinali — zpusobovalo to flash/cernou.
    // Inspector zustava aktivni, jen vycistime selection.
  }

  infoBar.querySelector('.info-send')!.addEventListener('click', sendElementPrompt);
  infoPromptInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); sendElementPrompt(); }
    if (e.key === 'Escape') { selectedElement = null; infoBar.style.display = 'none'; }
  });
  infoBar.querySelector('.info-clear')!.addEventListener('click', () => {
    selectedElement = null;
    infoBar.style.display = 'none';
  });

  // ── Annotation (freehand pen) ────────
  const btnAnnotate = toolbar.querySelector('.artifact-annotate') as HTMLElement;
  let annotating = false;
  let annotCtx: CanvasRenderingContext2D | null = null;
  let drawing = false;
  let strokes: Array<Array<{x: number; y: number}>> = [];
  let currentStroke: Array<{x: number; y: number}> = [];

  btnAnnotate.addEventListener('click', () => {
    annotating = !annotating;
    btnAnnotate.classList.toggle('artifact-btn-active', annotating);
    btnAnnotate.innerHTML = `${I('editor')} ${t(annotating ? 'browser.annotateDraw' : 'browser.annotate')}`;
    annotCanvas.style.display = annotating ? 'block' : 'none';
    annotCanvas.style.pointerEvents = annotating ? 'auto' : 'none';

    if (annotating) {
      // Mutually exclusive — vypni inspect
      if (inspectActive) {
        inspectActive = false;
        btnInspect.classList.remove('artifact-btn-active');
        btnInspect.innerHTML = `${I('inspect')} Inspect`;
        inspector.disable();
      }
      const rect = previewContainer.getBoundingClientRect();
      annotCanvas.width = rect.width;
      annotCanvas.height = rect.height;
      annotCtx = annotCanvas.getContext('2d');
      redrawAll();
    }
  });

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

  function endStroke(): void {
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

  let annotPrompt: HTMLElement | null = null;

  function showAnnotPrompt(pts: Array<{x: number; y: number}>): void {
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    if (annotPrompt) annotPrompt.remove();
    annotPrompt = document.createElement('div');
    annotPrompt.className = 'annot-prompt';
    annotPrompt.innerHTML = `
      <span class="annot-prompt-label">Oblast (${Math.round(maxX - minX)}x${Math.round(maxY - minY)}px) @ ${currentPreset.label}</span>
      <input type="text" class="annot-prompt-input" placeholder="${t('mobile.areaPh')}">
      <button class="annot-prompt-send">${I('play')}</button>
      <button class="annot-prompt-clear">${I('close')}</button>
    `;
    previewContainer.appendChild(annotPrompt);

    const input = annotPrompt.querySelector('.annot-prompt-input') as HTMLInputElement;
    input.focus();

    function sendAnnot(): void {
      const text = input.value.trim();
      if (!text) return;
      const prompt = `V mobile preview (${currentUrl}, ${currentPreset.label}${landscape ? ' landscape' : ''}) v oblasti (${Math.round(minX)},${Math.round(minY)} → ${Math.round(maxX)},${Math.round(maxY)}) udělej: ${text}`;
      wrapper.dispatchEvent(new CustomEvent('send-to-pty', { detail: prompt, bubbles: true }));
      showToast(t('toast.sentToCC'), 'success');
      if (annotPrompt) { annotPrompt.remove(); annotPrompt = null; }
      strokes.pop();
      redrawAll();
    }

    annotPrompt.querySelector('.annot-prompt-send')!.addEventListener('click', sendAnnot);
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') sendAnnot();
      if (e.key === 'Escape') {
        strokes.pop();
        redrawAll();
        if (annotPrompt) { annotPrompt.remove(); annotPrompt = null; }
      }
    });
    annotPrompt.querySelector('.annot-prompt-clear')!.addEventListener('click', () => {
      strokes.pop();
      redrawAll();
      if (annotPrompt) { annotPrompt.remove(); annotPrompt = null; }
    });
  }

  annotCanvas.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    strokes = [];
    currentStroke = [];
    if (annotCtx) annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
  });

  function drawStroke(ctx: CanvasRenderingContext2D, pts: Array<{x: number; y: number}>, color: string, width: number): void {
    if (pts.length < 2) return;
    const isClosed = pts.length > 3 &&
      Math.abs(pts[0].x - pts[pts.length - 1].x) < 5 &&
      Math.abs(pts[0].y - pts[pts.length - 1].y) < 5;

    if (isClosed) {
      ctx.fillStyle = 'rgba(255, 106, 0, 0.12)';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(255, 106, 0, 0.25)';
    ctx.lineWidth = width + 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
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

  function redrawAll(): void {
    if (!annotCtx) return;
    annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
    for (const s of strokes) drawStroke(annotCtx, s, '#ff6a00', 3);
  }

  // ── Lifecycle (start/stop kept for API kompatibility) ──
  function start(): void {
    if (urlInput.value.trim()) loadUrl(urlInput.value.trim());
  }
  function stop(): void {
    iframe.src = 'about:blank';
    currentUrl = '';
  }

  return {
    element: wrapper,
    start,
    stop,
    isRunning: () => !!currentUrl,
    loadUrl: (url: string) => { urlInput.value = url; loadUrl(url); },
    dispose: () => {
      inspector.dispose();
      wrapper.remove();
    },
  };
}

(window as any).createMobile = createMobile;
