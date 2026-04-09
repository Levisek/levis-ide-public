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

let currentFilePath: string | null = null;

function initPopout(): void {
  const iframe = document.getElementById('popout-iframe') as HTMLIFrameElement;
  const fileLabel = document.querySelector('.popout-file') as HTMLElement;

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
      iframe.src = 'file:///' + data.filePath.replace(/\\/g, '/');
    } else if (data.url) {
      currentFilePath = null;
      fileLabel.textContent = data.url;
      iframe.src = data.url;
    }
  });

  // ── Refresh from main window ──
  popoutApi.onRefresh(() => {
    if (currentFilePath) {
      iframe.src = 'file:///' + currentFilePath.replace(/\\/g, '/') + '?t=' + Date.now();
    } else {
      try { iframe.contentWindow?.location.reload(); } catch {}
    }
  });

  // Reload button
  document.querySelector('.pop-reload')!.addEventListener('click', () => {
    if (currentFilePath) {
      iframe.src = 'file:///' + currentFilePath.replace(/\\/g, '/') + '?t=' + Date.now();
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

  // ── Responsive size buttons ──
  const sizeBtns = document.querySelectorAll('.pop-size-btn');
  sizeBtns.forEach((btn: Element) => {
    btn.addEventListener('click', () => {
      const size = btn.getAttribute('data-size') || 'full';
      sizeBtns.forEach(b => b.classList.remove('pop-size-active'));
      btn.classList.add('pop-size-active');
      const content = document.getElementById('popout-content') as HTMLElement;
      switch (size) {
        case 'mobile':
          iframe.style.width = '375px';
          iframe.style.margin = '0 auto';
          content.classList.add('artifact-device-frame');
          break;
        case 'tablet':
          iframe.style.width = '768px';
          iframe.style.margin = '0 auto';
          content.classList.add('artifact-device-frame');
          break;
        default:
          iframe.style.width = '100%';
          iframe.style.margin = '0';
          content.classList.remove('artifact-device-frame');
      }
    });
  });

  // ── DevTools for iframe ──
  document.querySelector('.pop-devtools')!.addEventListener('click', () => {
    if ((iframe as any).openDevTools) {
      if ((iframe as any).isDevToolsOpened()) (iframe as any).closeDevTools();
      else (iframe as any).openDevTools();
    }
  });

  // ── Inspector integration ──
  const inspector = (window as any).createInspector() as any;
  const btnInspect = document.querySelector('.pop-inspect') as HTMLElement;
  let inspectActive = false;

  btnInspect.addEventListener('click', () => {
    inspectActive = !inspectActive;
    btnInspect.classList.toggle('artifact-btn-active', inspectActive);
    btnInspect.textContent = inspectActive ? 'Inspect ON' : 'Inspect';
    if (inspectActive) {
      inspector.enable(iframe);
    } else {
      inspector.disable();
    }
  });

  // Re-enable inspector after iframe reloads
  iframe.addEventListener('load', () => {
    if (inspectActive) {
      setTimeout(() => inspector.enable(iframe), 300);
    }
  });

  // Info bar — shows after element select
  const infoBar = document.getElementById('popout-info-bar') as HTMLElement;
  const infoPromptInput = infoBar.querySelector('.info-prompt') as HTMLInputElement;
  const infoSelectorLabel = infoBar.querySelector('.info-selector') as HTMLElement;
  let selectedElement: any = null;

  inspector.onSelect((info: any) => {
    selectedElement = info;
    infoBar.style.display = 'flex';
    infoSelectorLabel.textContent = info.selector;
    infoPromptInput.value = '';
    infoPromptInput.placeholder = `Co udělat s ${info.selector}?`;
    infoPromptInput.focus();
  });

  function sendElementPrompt(): void {
    if (!selectedElement) return;
    const file = currentFilePath ? currentFilePath.replace(/\\/g, '/').split('/').pop() : '';
    const userText = infoPromptInput.value.trim();
    const fullPrompt = `V souboru ${file} uprav element ${selectedElement.selector}` +
      (selectedElement.text ? ` (obsah: "${selectedElement.text.substring(0, 50)}")` : '') +
      (userText ? ` — ${userText}` : '');
    // Send prompt to main window → terminal
    popoutApi.sendPrompt(fullPrompt);
    infoPromptInput.value = '';
    selectedElement = null;
    infoBar.style.display = 'none';

    // Re-enable inspector for next selection
    if (inspectActive) {
      inspector.disable();
      setTimeout(() => inspector.enable(iframe), 300);
    }
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

  // ── Annotation (freehand drawing) ──
  const btnAnnotate = document.querySelector('.pop-annotate') as HTMLElement;
  const annotCanvas = document.getElementById('popout-annot-canvas') as HTMLCanvasElement;
  const popoutContent = document.getElementById('popout-content') as HTMLElement;
  let annotating = false;
  let annotCtx: CanvasRenderingContext2D | null = null;
  let drawing = false;
  let strokes: Array<Array<{x: number; y: number}>> = [];
  let currentStroke: Array<{x: number; y: number}> = [];

  btnAnnotate.addEventListener('click', () => {
    annotating = !annotating;
    btnAnnotate.classList.toggle('artifact-btn-active', annotating);
    btnAnnotate.textContent = annotating ? 'Kreslím...' : 'Označit';
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

  annotCanvas.addEventListener('mouseup', () => {
    if (drawing && currentStroke.length > 2) {
      currentStroke.push({ x: currentStroke[0].x, y: currentStroke[0].y });
      strokes.push([...currentStroke]);
      redrawAll();
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

  annotCanvas.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    strokes = [];
    currentStroke = [];
    if (annotCtx) annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
  });

  let annotPrompt: HTMLElement | null = null;

  function showAnnotPrompt(pts: Array<{x: number; y: number}>): void {
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    if (annotPrompt) annotPrompt.remove();

    annotPrompt = document.createElement('div');
    annotPrompt.className = 'annot-prompt';
    annotPrompt.innerHTML = `
      <span class="annot-prompt-label">Označená oblast (${Math.round(maxX - minX)}x${Math.round(maxY - minY)}px)</span>
      <input type="text" class="annot-prompt-input" placeholder="Co chceš udělat s touto oblastí?">
      <button class="annot-prompt-send" title="Odeslat (Enter)">›</button>
      <button class="annot-prompt-clear" title="Zrušit">×</button>
    `;
    popoutContent.appendChild(annotPrompt);
    const input = annotPrompt.querySelector('.annot-prompt-input') as HTMLInputElement;
    input.focus();

    function sendAnnot(): void {
      const text = input.value.trim();
      if (!text) return;
      const file = currentFilePath ? currentFilePath.replace(/\\/g, '/').split('/').pop() : '';
      const prompt = `V souboru ${file} v oblasti (${Math.round(minX)},${Math.round(minY)} → ${Math.round(maxX)},${Math.round(maxY)}) udělej: ${text}`;
      popoutApi.sendPrompt(prompt);
      if (annotPrompt) { annotPrompt.remove(); annotPrompt = null; }
      strokes.pop();
      redrawAll();
    }

    annotPrompt.querySelector('.annot-prompt-send')!.addEventListener('click', sendAnnot);
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') sendAnnot();
      if (e.key === 'Escape') { strokes.pop(); redrawAll(); if (annotPrompt) { annotPrompt.remove(); annotPrompt = null; } }
    });
    annotPrompt.querySelector('.annot-prompt-clear')!.addEventListener('click', () => {
      strokes.pop(); redrawAll(); if (annotPrompt) { annotPrompt.remove(); annotPrompt = null; }
    });
  }

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
