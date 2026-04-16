// ── Pop-out Preview Window ──────────────
// Runs in separate BrowserWindow — must use its own window controls!

declare const popoutApi: {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  toggleFullscreen: () => void;
  sendPrompt: (prompt: string) => void;
  onLoad: (cb: (data: any) => void) => () => void;
  onRefresh: (cb: () => void) => () => void;
};

// Popout má i18n.js načtený v popout.html (stejné dicts jako hlavní okno).
// Init locale probíhá přes popoutApi.storeGet — spustí se v initPopout().
const popT = (window as any).t as (key: string, p?: Record<string, string | number>) => string;

let currentFilePath: string | null = null;

function initPopout(): void {
  // Zapojení i18n pro popout — initI18n přečte locale přes popoutApi.storeGet a aplikuje překlady
  (window as any).initI18n?.().then(() => (window as any).applyI18nDom?.(document));
  const iframe = document.getElementById('popout-iframe') as HTMLIFrameElement;
  const webview = document.getElementById('popout-webview') as any;
  const fileLabel = document.querySelector('.popout-file') as HTMLElement;
  let useWebview = false;

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

  document.getElementById('pop-min')!.addEventListener('click', () => {
    popoutApi.minimize();
  });
  document.getElementById('pop-max')!.addEventListener('click', () => {
    popoutApi.toggleMaximize();
  });
  document.getElementById('pop-close')!.addEventListener('click', () => {
    popoutApi.close();
  });

  // ── "Return to main" button ──
  document.getElementById('pop-return')!.addEventListener('click', () => {
    popoutApi.close();
  });

  // ── Load content from main window ──
  popoutApi.onLoad((data: any) => {
    if (data.filePath) {
      currentFilePath = data.filePath;
      const name = data.filePath.replace(/\\/g, '/').split('/').pop();
      fileLabel.textContent = name || '';
      showIframe();
      iframe.src = 'file:///' + data.filePath.replace(/\\/g, '/');
    } else if (data.url) {
      currentFilePath = null;
      fileLabel.textContent = data.url;
      if (data.url.startsWith('http://') || data.url.startsWith('https://')) {
        showWebview();
        webview.src = data.url;
      } else {
        showIframe();
        iframe.src = data.url;
      }
    }
  });

  // ── Refresh from main window ──
  popoutApi.onRefresh(() => {
    if (currentFilePath) {
      iframe.src = 'file:///' + currentFilePath.replace(/\\/g, '/') + '?t=' + Date.now();
    } else if (useWebview) {
      try { webview.reload(); } catch {}
    } else {
      try { iframe.contentWindow?.location.reload(); } catch {}
    }
  });

  // Reload button
  document.querySelector('.pop-reload')!.addEventListener('click', () => {
    if (currentFilePath) {
      iframe.src = 'file:///' + currentFilePath.replace(/\\/g, '/') + '?t=' + Date.now();
    } else if (useWebview) {
      try { webview.reload(); } catch {}
    } else {
      try { iframe.contentWindow?.location.reload(); } catch {}
    }
  });

  // ── Fullscreen toggle ──
  let isFullscreen = false;
  document.querySelector('.pop-fullscreen')!.addEventListener('click', () => {
    popoutApi.toggleFullscreen();
    isFullscreen = !isFullscreen;
  });

  // ── 1:1 Device simulation ──
  const DEVICES: Record<string, { w: number; h: number; radius: number }> = {
    mobile: { w: 2.56, h: 5.69, radius: 20 },
    tablet: { w: 6.58, h: 8.77, radius: 16 },
  };
  // PPI odhad — default 24" monitor (popout nemá přístup ke store)
  const monitorDiag = 24;
  const cssPPI = Math.sqrt(window.screen.width ** 2 + window.screen.height ** 2) / monitorDiag;

  const sizeBtns = document.querySelectorAll('.pop-size-btn');
  sizeBtns.forEach((btn: Element) => {
    btn.addEventListener('click', () => {
      const size = btn.getAttribute('data-size') || 'full';
      sizeBtns.forEach(b => b.classList.remove('pop-size-active'));
      btn.classList.add('pop-size-active');
      const content = document.getElementById('popout-content') as HTMLElement;
      const target = useWebview ? webview : iframe;
      // Reset
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

  // ── DevTools for iframe / webview ──
  document.querySelector('.pop-devtools')!.addEventListener('click', () => {
    const target = useWebview ? webview : iframe;
    if (target.openDevTools) {
      if (target.isDevToolsOpened()) target.closeDevTools();
      else target.openDevTools();
    }
  });

  // ── Zoom (device frame scale) ──
  let popZoom = 1.0;
  const popZoomLabel = document.querySelector('.pop-zoom-label') as HTMLElement;
  function applyPopZoom(): void {
    popZoomLabel.textContent = Math.round(popZoom * 100) + '%';
    // Najdi aktivní size
    const activeBtn = document.querySelector('.pop-size-btn.pop-size-active');
    const size = activeBtn?.getAttribute('data-size') || 'full';
    const device = DEVICES[size];
    if (device) {
      const target = useWebview ? webview : iframe;
      const w = Math.round(device.w * cssPPI * popZoom);
      const h = Math.round(device.h * cssPPI * popZoom);
      target.style.width = w + 'px';
      target.style.height = h + 'px';
    } else {
      const target = useWebview ? webview : iframe;
      if (target.setZoomFactor) { try { target.setZoomFactor(popZoom); } catch {} }
    }
  }
  document.querySelector('.pop-zoom-in')!.addEventListener('click', () => {
    popZoom = Math.min(3, popZoom + 0.1); applyPopZoom();
  });
  document.querySelector('.pop-zoom-out')!.addEventListener('click', () => {
    popZoom = Math.max(0.25, popZoom - 0.1); applyPopZoom();
  });
  popZoomLabel.addEventListener('click', () => { popZoom = 1.0; applyPopZoom(); });

  // ── Shared floating popover (same as workspace browser) ──
  const popoutContent = document.getElementById('popout-content') as HTMLElement;
  let activePopover: HTMLElement | null = null;

  // SVG ikony inline (popout nemá icon() funkci)
  const SVG_INSPECT = '<svg class="lvi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h2"/><path d="M14 3h1"/><path d="M3 9v1"/><path d="M21 9v2"/><path d="M3 14v1"/><path d="M21 14v1"/></svg>';
  const SVG_CLOSE = '<svg class="lvi" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const SVG_SEND = '<svg class="lvi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

  function showFloatingPopover(
    rect: { x: number; y: number; width: number; height: number },
    label: string,
    placeholder: string,
    onSubmit: (text: string) => void,
    onCancel?: () => void
  ): void {
    closePopover();
    const popover = document.createElement('div');
    popover.className = 'artifact-popover';
    popover.innerHTML = `
      <div class="popover-header">
        <span class="popover-icon">${SVG_INSPECT}</span>
        <span class="popover-label">${label}</span>
        <button class="popover-close" title="Esc">${SVG_CLOSE}</button>
      </div>
      <div class="popover-body">
        <input type="text" class="popover-input" placeholder="${placeholder}">
        <button class="popover-send" title="Odeslat do CC">${SVG_SEND}</button>
      </div>
      <div class="popover-arrow"></div>
    `;
    popoutContent.appendChild(popover);
    activePopover = popover;

    // Smart placement
    const containerRect = popoutContent.getBoundingClientRect();
    const popW = 380, popH = popover.getBoundingClientRect().height || 80;
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
    function submit(): void { onSubmit(input.value.trim()); }
    function cancel(): void { if (onCancel) onCancel(); closePopover(); }
    sendBtn.addEventListener('click', submit);
    closeBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    setTimeout(() => input.focus(), 50);
  }

  function closePopover(): void {
    if (activePopover) { activePopover.remove(); activePopover = null; }
  }

  // ── Inspector integration ──
  const inspector = (window as any).createInspector() as any;
  const btnInspect = document.querySelector('.pop-inspect') as HTMLElement;
  let inspectActive = false;

  btnInspect.addEventListener('click', () => {
    inspectActive = !inspectActive;
    btnInspect.classList.toggle('artifact-btn-active', inspectActive);
    btnInspect.title = popT(inspectActive ? 'browser.inspectOn' : 'browser.inspect');
    if (inspectActive) {
      inspector.enable(iframe);
    } else {
      inspector.disable();
      closePopover();
    }
  });

  iframe.addEventListener('load', () => {
    if (inspectActive) setTimeout(() => inspector.enable(iframe), 300);
  });

  inspector.onSelect((info: any) => {
    const file = currentFilePath ? currentFilePath.replace(/\\/g, '/').split('/').pop() : '';
    showFloatingPopover(
      info.rect || { x: 100, y: 100, width: 100, height: 30 },
      info.selector,
      `Co udělat s ${info.selector}?`,
      (text) => {
        const prompt = `V souboru ${file} uprav element ${info.selector}` +
          (info.text ? ` (obsah: "${info.text.substring(0, 50)}")` : '') +
          (text ? ` — ${text}` : '');
        popoutApi.sendPrompt(prompt);
        closePopover();
        if (inspectActive) { inspector.disable(); setTimeout(() => inspector.enable(iframe), 300); }
      }
    );
  });

  // ── Annotation (freehand drawing) ──
  const btnAnnotate = document.querySelector('.pop-annotate') as HTMLElement;
  const annotCanvas = document.getElementById('popout-annot-canvas') as HTMLCanvasElement;
  let annotating = false;
  let annotCtx: CanvasRenderingContext2D | null = null;
  let drawing = false;
  let strokes: Array<Array<{x: number; y: number}>> = [];
  let currentStroke: Array<{x: number; y: number}> = [];

  btnAnnotate.addEventListener('click', () => {
    annotating = !annotating;
    btnAnnotate.classList.toggle('artifact-btn-active', annotating);
    btnAnnotate.title = popT(annotating ? 'browser.annotateDraw' : 'browser.annotate');
    annotCanvas.style.display = annotating ? 'block' : 'none';
    annotCanvas.style.pointerEvents = annotating ? 'auto' : 'none';
    if (annotating) {
      const rect = popoutContent.getBoundingClientRect();
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

  function finishStroke(): void {
    if (drawing && currentStroke.length > 2) {
      currentStroke.push({ x: currentStroke[0].x, y: currentStroke[0].y });
      strokes.push([...currentStroke]);
      redrawAll();
      const pts = strokes[strokes.length - 1];
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const file = currentFilePath ? currentFilePath.replace(/\\/g, '/').split('/').pop() : '';
      showFloatingPopover(
        { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        `Oblast ${Math.round(maxX - minX)}×${Math.round(maxY - minY)}px`,
        popT('popout.areaPh'),
        (text) => {
          if (!text) return;
          const prompt = `V souboru ${file} v oblasti (${Math.round(minX)},${Math.round(minY)} → ${Math.round(maxX)},${Math.round(maxY)}) udělej: ${text}`;
          popoutApi.sendPrompt(prompt);
          closePopover();
          strokes.pop();
          redrawAll();
        },
        () => { strokes.pop(); redrawAll(); }
      );
    }
    drawing = false;
    currentStroke = [];
  }

  annotCanvas.addEventListener('mouseup', finishStroke);
  annotCanvas.addEventListener('mouseleave', finishStroke);
  annotCanvas.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    strokes = []; currentStroke = [];
    if (annotCtx) annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
    closePopover();
  });

  function drawStroke(ctx: CanvasRenderingContext2D, pts: Array<{x: number; y: number}>, color: string, width: number): void {
    if (pts.length < 2) return;
    const isClosed = pts.length > 3 &&
      Math.abs(pts[0].x - pts[pts.length - 1].x) < 5 &&
      Math.abs(pts[0].y - pts[pts.length - 1].y) < 5;
    if (isClosed) {
      ctx.fillStyle = 'rgba(255, 106, 0, 0.12)';
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255, 106, 0, 0.25)';
    ctx.lineWidth = width + 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (isClosed) ctx.closePath(); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (isClosed) ctx.closePath(); ctx.stroke();
  }

  function redrawAll(): void {
    if (!annotCtx) return;
    annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
    for (const s of strokes) drawStroke(annotCtx, s, '#ff6a00', 3);
  }
}

document.addEventListener('DOMContentLoaded', initPopout);
