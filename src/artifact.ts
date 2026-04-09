// ── Artifact Preview (like Claude Artifacts) ──
// Renders HTML/CSS/JS live in a sandboxed iframe.
// Can load from file, from raw HTML, or watch for changes.

interface ArtifactInstance {
  element: HTMLElement;
  loadFile: (filePath: string) => Promise<void>;
  loadHtml: (html: string) => void;
  refresh: () => void;
  getFilePath: () => string | null;
  dispose: () => void;
}

function createArtifact(container: HTMLElement, projectPath: string): ArtifactInstance {
  const wrapper = document.createElement('div');
  wrapper.className = 'artifact-panel';

  // Cleanup .levis-tmp — smaž lasso screenshoty starší než 24 h
  if (projectPath) {
    const sep = projectPath.includes('\\') ? '\\' : '/';
    levis.captureCleanup(projectPath + sep + '.levis-tmp').catch(() => {});
  }

  // Toolbar
  const I = (window as any).icon;
  const toolbar = document.createElement('div');
  toolbar.className = 'artifact-toolbar';
  toolbar.innerHTML = `
    <span class="artifact-icon">${I('preview')}</span>
    <span class="artifact-title">Náhled</span>
    <span class="artifact-filepath"></span>
    <span style="flex:1"></span>
    <div class="artifact-size-btns">
      <button class="artifact-size-btn" data-size="mobile" title="Mobile (375px)">${I('mobile')}</button>
      <button class="artifact-size-btn" data-size="tablet" title="Tablet (768px)">${I('file')}</button>
      <button class="artifact-size-btn artifact-size-active" data-size="full" title="Full width">${I('browser')}</button>
    </div>
    <button class="artifact-btn artifact-inspect" title="Inspect element (Alt+I) — klikni na prvek v náhledu, napiš co změnit, pošli do Claude Code">${I('inspect')} Inspect</button>
    <button class="artifact-btn artifact-annotate" title="Označit oblast — zakroužkuj část náhledu, popiš co změnit, pošli do CC se screenshotem">${I('editor')} Označit</button>
    <button class="artifact-btn artifact-reload" title="Obnovit náhled (Ctrl+Shift+V)">${I('refresh')}</button>
    <button class="artifact-btn artifact-watch" title="Watch mode — auto-reload při změně souboru">${I('eye')} Watch</button>
    <button class="artifact-btn artifact-open-file" title="Načíst HTML soubor z disku">${I('folder')} Načíst</button>
  `;
  wrapper.appendChild(toolbar);

  // Preview container (holds iframe with responsive sizing)
  const previewContainer = document.createElement('div');
  previewContainer.className = 'artifact-preview';
  wrapper.appendChild(previewContainer);

  // Iframe (no sandbox — file:// needs full access for relative resources)
  const iframe = document.createElement('iframe');
  iframe.className = 'artifact-iframe';
  previewContainer.appendChild(iframe);

  // Annotation canvas overlay (for drawing circles/arrows)
  const annotCanvas = document.createElement('canvas');
  annotCanvas.className = 'artifact-annot-canvas';
  previewContainer.appendChild(annotCanvas);

  // Element ring overlay (vignette + dashed outline)
  const elementRing = document.createElement('div');
  elementRing.className = 'artifact-element-ring';
  elementRing.style.display = 'none';
  previewContainer.appendChild(elementRing);

  // Floating popover host (created/destroyed dynamicky pro každý prompt)
  let activePopover: HTMLElement | null = null;

  container.appendChild(wrapper);

  let currentFilePath: string | null = null;
  let currentHtml: string = '';
  let watchInterval: any = null;
  let lastModified: number = 0;
  let currentSize: string = 'full';
  let selectedElement: any = null;

  const filepathLabel = toolbar.querySelector('.artifact-filepath') as HTMLElement;

  // ── Inspector integration ─────────────
  const inspector = createInspector();
  const btnInspect = toolbar.querySelector('.artifact-inspect') as HTMLElement;
  let inspectActive = false;

  btnInspect.addEventListener('click', () => {
    inspectActive = !inspectActive;
    btnInspect.classList.toggle('artifact-btn-active', inspectActive);
    btnInspect.innerHTML = `${I('inspect')} ${inspectActive ? 'Inspect ON' : 'Inspect'}`;
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

  // Re-enable inspector after iframe navigates/reloads
  iframe.addEventListener('load', () => {
    if (inspectActive) {
      setTimeout(() => inspector.enable(iframe), 300);
    }
  });

  // ── Prompt history (sdíleno přes levis store) ──
  async function pushPromptHistory(text: string): Promise<void> {
    if (!text || !text.trim()) return;
    const list: string[] = (await levis.storeGet('promptHistory')) || [];
    const filtered = list.filter(x => x !== text);
    filtered.unshift(text);
    await levis.storeSet('promptHistory', filtered.slice(0, 10));
  }
  async function getPromptHistory(): Promise<string[]> {
    return (await levis.storeGet('promptHistory')) || [];
  }
  function escapeHtmlA(s: string): string { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ── Floating popover ─────────────────
  // Univerzální helper pro inspector i annotation. Vytvoří plovoucí popover
  // vedle vybrané oblasti (dole/nahoře/vpravo/vlevo podle volného místa),
  // dashed ring kolem oblasti, vignette na zbytek preview.
  interface PopoverOptions {
    rect: { x: number; y: number; width: number; height: number };  // souřadnice v previewContainer
    contextLabel: string;
    placeholder?: string;
    onSubmit: (text: string) => void;
    onCancel?: () => void;
  }

  function closePopover(): void {
    if (activePopover) {
      activePopover.remove();
      activePopover = null;
    }
    elementRing.style.display = 'none';
  }

  function showFloatingPopover(opts: PopoverOptions): void {
    closePopover();

    const { rect, contextLabel, onSubmit, onCancel } = opts;

    // Element ring + vignette
    elementRing.style.display = 'block';
    elementRing.style.left = `${rect.x - 4}px`;
    elementRing.style.top = `${rect.y - 4}px`;
    elementRing.style.width = `${rect.width + 8}px`;
    elementRing.style.height = `${rect.height + 8}px`;

    // Build popover
    const popover = document.createElement('div');
    popover.className = 'artifact-popover';
    popover.innerHTML = `
      <div class="popover-header">
        <span class="popover-icon">${I('inspect')}</span>
        <span class="popover-label">${escapeHtmlA(contextLabel)}</span>
        <button class="popover-close" title="Zrušit (Esc)">${I('close')}</button>
      </div>
      <div class="popover-body">
        <input type="text" class="popover-input" placeholder="${escapeHtmlA(opts.placeholder || 'Co chceš změnit?')}">
        <button class="popover-history" title="Historie promptů">${I('arrow-down')}</button>
        <button class="popover-send" title="Odeslat do Claude Code (Enter)">${I('play')}</button>
      </div>
      <div class="popover-history-dropdown" style="display:none;"></div>
      <div class="popover-arrow"></div>
    `;
    previewContainer.appendChild(popover);
    activePopover = popover;

    // Smart placement
    const containerRect = previewContainer.getBoundingClientRect();
    // Po appendnutí má popover svoje rozměry
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
        chosen = c;
        break;
      }
    }
    if (!chosen) {
      // Fallback: bottom + clamp
      chosen = { side: 'bottom', x: cx - popW / 2, y: rect.y + rect.height + pad };
    }
    // Clamp do containeru
    chosen.x = Math.max(8, Math.min(chosen.x, containerRect.width - popW - 8));
    chosen.y = Math.max(8, Math.min(chosen.y, containerRect.height - popH - 8));

    popover.style.left = `${chosen.x}px`;
    popover.style.top = `${chosen.y}px`;
    popover.dataset.side = chosen.side;

    // Šipka — pozice tak aby ukazovala na střed elementu
    const arrow = popover.querySelector('.popover-arrow') as HTMLElement;
    if (chosen.side === 'bottom') {
      arrow.style.left = `${Math.max(12, Math.min(cx - chosen.x, popW - 12))}px`;
      arrow.style.top = '-6px';
    } else if (chosen.side === 'top') {
      arrow.style.left = `${Math.max(12, Math.min(cx - chosen.x, popW - 12))}px`;
      arrow.style.bottom = '-6px';
    } else if (chosen.side === 'right') {
      arrow.style.top = `${Math.max(12, Math.min(cy - chosen.y, popH - 12))}px`;
      arrow.style.left = '-6px';
    } else {
      arrow.style.top = `${Math.max(12, Math.min(cy - chosen.y, popH - 12))}px`;
      arrow.style.right = '-6px';
    }

    // Wire up
    const input = popover.querySelector('.popover-input') as HTMLInputElement;
    const sendBtn = popover.querySelector('.popover-send') as HTMLElement;
    const historyBtn = popover.querySelector('.popover-history') as HTMLElement;
    const dropdown = popover.querySelector('.popover-history-dropdown') as HTMLElement;
    const closeBtn = popover.querySelector('.popover-close') as HTMLElement;

    function submit(): void {
      onSubmit(input.value.trim());
    }
    function cancel(): void {
      if (onCancel) onCancel();
      closePopover();
    }

    sendBtn.addEventListener('click', submit);
    closeBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    historyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (dropdown.style.display === 'block') { dropdown.style.display = 'none'; return; }
      const list = await getPromptHistory();
      if (list.length === 0) {
        dropdown.innerHTML = `<div class="popover-history-empty">Žádná historie</div>`;
      } else {
        dropdown.innerHTML = list.map(p => `<div class="popover-history-item">${escapeHtmlA(p)}</div>`).join('');
        dropdown.querySelectorAll('.popover-history-item').forEach((el, i) => {
          el.addEventListener('click', () => {
            input.value = list[i];
            input.focus();
            dropdown.style.display = 'none';
          });
        });
      }
      dropdown.style.display = 'block';
    });
    // Klik mimo dropdown ho zavře (ne celý popover)
    popover.addEventListener('click', (e) => {
      if (!historyBtn.contains(e.target as Node) && !dropdown.contains(e.target as Node)) {
        dropdown.style.display = 'none';
      }
    });

    // Auto-focus
    setTimeout(() => input.focus(), 50);
  }

  inspector.onSelect((info) => {
    selectedElement = info;
    if (!info.rect) return;
    showFloatingPopover({
      rect: getElementRectInContainer(info.rect),
      contextLabel: info.selector,
      placeholder: `Co udělat s ${info.selector}?`,
      onSubmit: (text) => sendElementPrompt(text),
      onCancel: () => { selectedElement = null; },
    });
  });

  // Převod rect z iframe coords (selectedElement.rect je v iframe viewport coords)
  // na previewContainer coords (kde žije popover a elementRing).
  function getElementRectInContainer(iframeRect: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
    const ifRect = iframe.getBoundingClientRect();
    const ctRect = previewContainer.getBoundingClientRect();
    return {
      x: (ifRect.left - ctRect.left) + iframeRect.x,
      y: (ifRect.top - ctRect.top) + iframeRect.y,
      width: iframeRect.width,
      height: iframeRect.height,
    };
  }

  async function captureLassoScreenshot(rectInIframeOrContainer: { x: number; y: number; width: number; height: number }, useIframeOffset: boolean): Promise<{ rel: string; abs: string } | null> {
    if (!currentFilePath) return null;
    try {
      const offsetEl = useIframeOffset ? iframe : previewContainer;
      const off = offsetEl.getBoundingClientRect();
      const abs = {
        x: off.left + rectInIframeOrContainer.x,
        y: off.top + rectInIframeOrContainer.y,
        width: rectInIframeOrContainer.width,
        height: rectInIframeOrContainer.height,
      };
      const pad = 8;
      abs.x = Math.max(0, abs.x - pad);
      abs.y = Math.max(0, abs.y - pad);
      abs.width += pad * 2;
      abs.height += pad * 2;

      const useBackslash = currentFilePath.includes('\\');
      const sep = useBackslash ? '\\' : '/';
      const projectDir = currentFilePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
      const filename = `lasso-${Date.now()}.png`;
      const savePath = (projectDir + '/.levis-tmp/' + filename).replace(/\//g, sep);
      const result = await levis.captureRegion(abs, savePath);
      if (result && result.success && result.path) {
        return { rel: './.levis-tmp/' + filename, abs: result.path };
      }
      return null;
    } catch {
      return null;
    }
  }

  // Po odeslání: dej CC 30 s na zpracování PNG, pak smaž (ať .levis-tmp nezasiruje disk)
  function scheduleScreenshotCleanup(absPath: string): void {
    setTimeout(() => { levis.deleteFile(absPath).catch(() => {}); }, 30_000);
  }

  async function sendElementPrompt(userText: string): Promise<void> {
    if (!selectedElement) return;
    const file = currentFilePath ? currentFilePath.replace(/\\/g, '/').split('/').pop() : '';

    let shot: { rel: string; abs: string } | null = null;
    if (selectedElement.rect) {
      shot = await captureLassoScreenshot(selectedElement.rect, true);
    }

    let fullPrompt = `V souboru ${file} uprav element ${selectedElement.selector}` +
      (selectedElement.text ? ` (obsah: "${selectedElement.text.substring(0, 50)}")` : '') +
      (userText ? ` — ${userText}` : '');
    if (shot) {
      fullPrompt += ` (screenshot vybrané oblasti: ${shot.rel})`;
    }

    wrapper.dispatchEvent(new CustomEvent('send-to-pty', { detail: fullPrompt, bubbles: true }));
    if (userText) pushPromptHistory(userText);
    if (shot) scheduleScreenshotCleanup(shot.abs);
    showToast(shot ? 'Odesláno do CC + screenshot' : 'Odesláno do Claude Code', 'success');
    selectedElement = null;
    closePopover();

    if (inspectActive) {
      inspector.disable();
      setTimeout(() => inspector.enable(iframe), 300);
    }
  }

  // ── Annotation (freehand pen drawing) ──
  const btnAnnotate = toolbar.querySelector('.artifact-annotate') as HTMLElement;
  let annotating = false;
  let annotCtx: CanvasRenderingContext2D | null = null;
  let drawing = false;
  let strokes: Array<Array<{x: number; y: number}>> = [];
  let currentStroke: Array<{x: number; y: number}> = [];

  btnAnnotate.addEventListener('click', () => {
    annotating = !annotating;
    btnAnnotate.classList.toggle('artifact-btn-active', annotating);
    btnAnnotate.innerHTML = `${I('editor')} ${annotating ? 'Kreslím...' : 'Označit'}`;
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
    // Drž jen jeden stroke — předchozí výběr smazat
    strokes = [];
    closePopover();
    const rect = annotCanvas.getBoundingClientRect();
    currentStroke = [{ x: e.clientX - rect.left, y: e.clientY - rect.top }];
    redrawAll();
  });

  annotCanvas.addEventListener('mousemove', (e: MouseEvent) => {
    if (!drawing || !annotCtx) return;
    const rect = annotCanvas.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    currentStroke.push(pt);

    // Draw live stroke
    redrawAll();
    drawStroke(annotCtx, currentStroke, '#ff6a00', 3);
  });

  annotCanvas.addEventListener('mouseup', () => {
    if (drawing && currentStroke.length > 2) {
      // Close shape — connect last point to first
      currentStroke.push({ x: currentStroke[0].x, y: currentStroke[0].y });
      strokes.push([...currentStroke]);
      redrawAll();
      // Show annotation prompt
      showAnnotPrompt(currentStroke);
    }
    drawing = false;
    currentStroke = [];
  });

  annotCanvas.addEventListener('mouseleave', () => {
    if (drawing && currentStroke.length > 2) {
      currentStroke.push({ x: currentStroke[0].x, y: currentStroke[0].y });
      strokes.push([...currentStroke]);
      redrawAll();
      showAnnotPrompt(currentStroke);
    }
    drawing = false;
    currentStroke = [];
  });

  // ── Annotation prompt ─────────────────
  function showAnnotPrompt(pts: Array<{x: number; y: number}>): void {
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.round(maxX - minX);
    const h = Math.round(maxY - minY);

    showFloatingPopover({
      rect: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      contextLabel: `Označená oblast (${w}×${h} px)`,
      placeholder: 'Co chceš udělat s touto oblastí?',
      onSubmit: async (text) => {
        if (!text) return;
        const file = currentFilePath ? currentFilePath.replace(/\\/g, '/').split('/').pop() : '';
        // Schovat canvas + ring před capturem aby nebyly ve screenshotu
        const canvasWasVisible = annotCanvas.style.display;
        const ringWasVisible = elementRing.style.display;
        annotCanvas.style.display = 'none';
        elementRing.style.display = 'none';
        if (activePopover) activePopover.style.display = 'none';
        await new Promise(r => requestAnimationFrame(r));
        const shot = await captureLassoScreenshot({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, false);
        annotCanvas.style.display = canvasWasVisible;
        elementRing.style.display = ringWasVisible;
        if (activePopover) activePopover.style.display = '';

        let prompt = `V souboru ${file} v oblasti (${Math.round(minX)},${Math.round(minY)} → ${Math.round(maxX)},${Math.round(maxY)}) udělej: ${text}`;
        if (shot) prompt += ` (screenshot oblasti: ${shot.rel})`;
        wrapper.dispatchEvent(new CustomEvent('send-to-pty', { detail: prompt, bubbles: true }));
        pushPromptHistory(text);
        if (shot) scheduleScreenshotCleanup(shot.abs);
        showToast(shot ? 'Odesláno do CC + screenshot' : 'Odesláno do CC', 'success');
        closePopover();
        strokes.pop();
        redrawAll();
      },
      onCancel: () => {
        strokes.pop();
        redrawAll();
      },
    });
  }

  // Right-click to clear all
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

    // Fill if shape is closed
    if (isClosed) {
      ctx.fillStyle = 'rgba(255, 106, 0, 0.12)';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
    }

    // Glow outline
    ctx.strokeStyle = 'rgba(255, 106, 0, 0.25)';
    ctx.lineWidth = width + 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (isClosed) ctx.closePath();
    ctx.stroke();

    // Main stroke
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
    for (const s of strokes) {
      drawStroke(annotCtx, s, '#ff6a00', 3);
    }
  }

  function renderContent(html: string): void {
    currentHtml = html;
    // Inject into iframe via srcdoc
    // Wrap with base tag pointing to project dir for relative resources
    const basePath = currentFilePath
      ? currentFilePath.replace(/[^/\\]+$/, '').replace(/\\/g, '/')
      : projectPath.replace(/\\/g, '/');

    const wrapped = `<!DOCTYPE html>
<html>
<head>
  <base href="file:///${basePath}">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    /* Smooth transitions for artifact updates */
    * { transition: background-color 0.2s, color 0.2s, transform 0.2s; }
  </style>
</head>
<body>
${html}
</body>
</html>`;

    iframe.srcdoc = wrapped;
  }

  async function loadFile(filePath: string): Promise<void> {
    currentFilePath = filePath;
    const parts = filePath.replace(/\\/g, '/').split('/');
    filepathLabel.textContent = parts.slice(-2).join('/');
    filepathLabel.title = filePath;

    const content = await levis.readFile(filePath);
    if (typeof content === 'object' && content.error) {
      renderContent(`<div style="padding:40px;font-family:sans-serif;color:#ef4444;">Chyba: ${content.error}</div>`);
      return;
    }

    const html = content as string;
    currentHtml = html;

    // Full HTML docs: load via file:// so relative CSS/JS/images resolve
    if (html.toLowerCase().includes('<!doctype') || html.toLowerCase().includes('<html')) {
      const fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
      iframe.removeAttribute('srcdoc');
      iframe.src = fileUrl;
    } else {
      renderContent(html);
    }

    showToast(`Artifact: ${parts.pop()}`, 'info');
  }

  function loadHtml(html: string): void {
    currentFilePath = null;
    filepathLabel.textContent = 'Live preview';
    renderContent(html);
  }

  function refresh(): void {
    if (currentFilePath) {
      loadFile(currentFilePath);
    } else {
      renderContent(currentHtml);
    }
  }

  // ── Responsive size buttons ───────────
  const sizeBtns = toolbar.querySelectorAll('.artifact-size-btn');
  sizeBtns.forEach((btn: Element) => {
    btn.addEventListener('click', () => {
      currentSize = btn.getAttribute('data-size') || 'full';
      sizeBtns.forEach(b => b.classList.remove('artifact-size-active'));
      btn.classList.add('artifact-size-active');

      switch (currentSize) {
        case 'mobile':
          iframe.style.width = '375px';
          iframe.style.margin = '0 auto';
          previewContainer.classList.add('artifact-device-frame');
          break;
        case 'tablet':
          iframe.style.width = '768px';
          iframe.style.margin = '0 auto';
          previewContainer.classList.add('artifact-device-frame');
          break;
        default:
          iframe.style.width = '100%';
          iframe.style.margin = '0';
          previewContainer.classList.remove('artifact-device-frame');
      }
    });
  });

  // ── Reload button ─────────────────────
  toolbar.querySelector('.artifact-reload')!.addEventListener('click', refresh);

  // ── Watch mode (auto-reload) — defaultně ZAPNUTO ──────
  let watching = true;
  const watchBtn = toolbar.querySelector('.artifact-watch') as HTMLElement;
  watchBtn.classList.add('artifact-watch-active');
  watchBtn.innerHTML = `${I('eye')} Watching`;

  let lastAssetsHash = '';
  function startWatch(): void {
    if (watchInterval) return;
    watchInterval = setInterval(async () => {
      if (!currentFilePath) return;
      try {
        // 1) Hlavní soubor — content match
        const content = await levis.readFile(currentFilePath);
        let needReload = false;
        if (typeof content === 'string' && content !== currentHtml) {
          currentHtml = content;
          needReload = true;
        }
        // 2) Sledovat všechny asset soubory v adresáři (css/js/svg/...)
        const dir = currentFilePath.substring(0, Math.max(currentFilePath.lastIndexOf('\\'), currentFilePath.lastIndexOf('/')));
        if (dir) {
          const hash = await levis.projectAssetsHash(dir);
          if (hash && hash !== lastAssetsHash) {
            if (lastAssetsHash) needReload = true; // První iterace jen zapamatuj
            lastAssetsHash = hash;
          }
        }
        if (needReload) {
          if (typeof content === 'string' && (content.toLowerCase().includes('<!doctype') || content.toLowerCase().includes('<html'))) {
            const fileUrl = 'file:///' + currentFilePath!.replace(/\\/g, '/');
            iframe.removeAttribute('srcdoc');
            // Force reload (cache bust query string)
            iframe.src = fileUrl + '?_t=' + Date.now();
          } else if (typeof content === 'string') {
            renderContent(content);
          }
        }
      } catch {}
    }, 1200);
  }
  function stopWatch(): void {
    if (watchInterval) {
      clearInterval(watchInterval);
      watchInterval = null;
    }
  }
  // Spustit hned
  startWatch();

  watchBtn.addEventListener('click', () => {
    watching = !watching;
    watchBtn.classList.toggle('artifact-watch-active', watching);
    watchBtn.innerHTML = `${I('eye')} ${watching ? 'Watching' : 'Watch'}`;
    if (watching) startWatch(); else stopWatch();
  });

  // ── Open file button ──────────────────
  toolbar.querySelector('.artifact-open-file')!.addEventListener('click', async () => {
    // Look for index.html in project
    const indexPath = projectPath.replace(/\\/g, '/') + '/index.html';
    const content = await levis.readFile(indexPath);
    if (typeof content === 'string') {
      loadFile(indexPath.replace(/\//g, '\\'));
    } else {
      showToast('Nenalezen index.html — vyber soubor ze stromu', 'warning');
    }
  });

  // ── Initial: try loading project's index.html ──
  (async () => {
    const indexPath = projectPath + '\\index.html';
    const content = await levis.readFile(indexPath);
    if (typeof content === 'string') {
      await loadFile(indexPath);
    } else {
      renderContent(`
        <div style="display:flex;align-items:center;justify-content:center;height:100%;
                    font-family:'Outfit',sans-serif;color:#6b6b80;text-align:center;padding:40px;">
          <div>
            <div style="margin-bottom:20px;opacity:0.6;">${I('preview', { size: 56 })}</div>
            <div style="font-size:18px;font-weight:600;margin-bottom:10px;color:#e8e8f0;">Náhled</div>
            <div style="font-size:13px;line-height:1.6;margin-bottom:24px;">
              Tento projekt nemá <code style="background:#1a1a22;padding:2px 6px;border-radius:3px;color:#ff7a1a;">index.html</code>.<br>
              Otevři jakýkoliv HTML soubor v file tree vlevo,<br>
              nebo přetáhni soubor sem.
            </div>
            <div style="display:inline-block;padding:8px 16px;border:1px dashed #2a2a35;border-radius:8px;font-size:12px;color:#6b6b80;">
              Tip: <kbd style="background:#1a1a22;padding:2px 6px;border-radius:3px;">Ctrl+Shift+V</kbd> reload preview
            </div>
          </div>
        </div>
      `);
    }
  })();

  return {
    element: wrapper,
    loadFile,
    loadHtml,
    refresh,
    getFilePath: () => currentFilePath,
    dispose: () => {
      if (watchInterval) clearInterval(watchInterval);
      inspector.dispose();
      wrapper.remove();
    },
  };
}

(window as any).createArtifact = createArtifact;
