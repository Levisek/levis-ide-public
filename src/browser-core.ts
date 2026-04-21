// ── Browser Core ─────────────────────────
// Renderer-agnostic UI logika pro browser/preview panel.
// Používá IBrowserHost pro IPC, neví nic o window.levis ani window.popoutApi.
//
// Loaduje se jako <script> tag — žádný ES module export. Factory visí na window.
// IBrowserHost je deklarován v browser-host.ts (loadovaný dříve, tedy globální typ).

interface BrowserToolbarRefs {
  inspectBtn?: HTMLElement | null;
  annotateBtn?: HTMLElement | null;
  reloadBtn?: HTMLElement | null;
  sizeBtnsContainer?: HTMLElement | null;
}

interface BrowserCoreInstance {
  loadContent(content: { filePath: string } | { url: string }): void;
  refresh(): void;
  notifyCCDone(): void;
  setSize(size: 'mobile' | 'tablet' | 'full'): void;
  isInteracting(): boolean;
  dispose(): void;
}

// Webview má vlastní API nad rámec HTMLElement — cast helper
type WebviewEl = HTMLElement & { src: string; reload: () => void; reloadIgnoringCache?: () => void };

// Globální helpery (`t`, `showToast`, `window.icon`) jsou deklarované v xterm.d.ts.
type IconFn = (name: string, opts?: { size?: number }) => string;

interface InspectorElementInfo {
  tagName: string;
  id: string;
  classes: string[];
  text: string;
  selector: string;
  pageUrl: string;
  rect?: { x: number; y: number; width: number; height: number };
}
interface InspectorInstanceLite {
  enable: (el: HTMLIFrameElement) => void;
  disable: () => void;
  isActive: () => boolean;
  onSelect: (cb: (info: InspectorElementInfo) => void) => void;
  dispose: () => void;
}

/**
 * Vytvoří renderer-agnostic Browser/Preview core.
 *
 * KONTRAKT na DOM strukturu:
 * - `iframeEl` a `webviewEl` MUSÍ mít stejného parent elementu.
 * - Overlay vrstvy (ring, annot canvas, popover) se připojují k `webviewEl.parentElement`.
 *   Pokud iframe žije pod jiným parentem, overlay nebudou správně pozicované nad ním.
 * - `container` je fallback pro overlay parent pokud `webviewEl.parentElement` chybí.
 *
 * @param host abstrakce nad IPC (LevisHost pro main, PopoutHost pro popout)
 * @param container kořenový element pro core (toolbar je obvykle uvnitř)
 * @param toolbar reference na inspect/annotate/reload/size buttony (mohou být null)
 * @param iframeEl iframe pro file:// content
 * @param webviewEl webview pro http(s) content
 */
function createBrowserCore(
  host: IBrowserHost,
  container: HTMLElement,
  toolbar: BrowserToolbarRefs,
  iframeEl: HTMLIFrameElement,
  webviewEl: HTMLElement,
): BrowserCoreInstance {
  let armedReloadAfterCC = false;
  let interacting = false;
  let currentFilePath: string | null = null;
  let currentUrl: string | null = null;

  // Cleanup starých screenshotů z .levis-tmp
  const root = host.getProjectRoot();
  if (root) {
    const sep = root.includes('\\') ? '\\' : '/';
    host.cleanupCapture(root + sep + '.levis-tmp').catch(() => {});
  }

  // Ikona helper — globální `(window as any).icon`. Cast přes any je nutný,
  // protože core nemá k dispozici typ z xterm.d.ts (popout má vlastní deklarace).
  const I: IconFn = ((window as unknown) as { icon?: IconFn }).icon ?? (() => '');

  // Aktivní view = ten, který není display:none. Inspect/lasso/annotate cílí na něj.
  function activeView(): HTMLElement {
    if (webviewEl && webviewEl.style.display !== 'none') return webviewEl;
    return iframeEl;
  }

  // Rodič pro overlay (ring, popover, canvas) — preferujeme parent webview/iframe,
  // fallback na container.
  function overlayParent(): HTMLElement {
    return (webviewEl.parentElement as HTMLElement | null) ?? container;
  }

  // ── Sdílené overlay prvky ─────────────────────────
  const overlayHost = overlayParent();
  if (getComputedStyle(overlayHost).position === 'static') {
    overlayHost.style.position = 'relative';
  }

  const elementRing = document.createElement('div');
  elementRing.className = 'artifact-element-ring';
  elementRing.style.display = 'none';
  overlayHost.appendChild(elementRing);

  const annotCanvas = document.createElement('canvas');
  annotCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:none;pointer-events:none;z-index:10;';
  overlayHost.appendChild(annotCanvas);

  let activePopover: HTMLElement | null = null;

  function recomputeInteracting(): void {
    interacting = inspectActive || annotating || activePopover !== null;
  }

  // ── Inspector + state ─────────────────────────
  // createInspector je global helper (window.createInspector), exportovaný z inspector.ts.
  type CreateInspectorFn = () => InspectorInstanceLite;
  const createInspectorRef = ((window as unknown) as { createInspector?: CreateInspectorFn }).createInspector;
  const inspector: InspectorInstanceLite | null = createInspectorRef ? createInspectorRef() : null;
  let inspectActive = false;
  let selectedElement: InspectorElementInfo | null = null;

  // ── Annotation state ─────────────────────────
  let annotating = false;
  let annotCtx: CanvasRenderingContext2D | null = null;
  let drawing = false;
  let strokes: Array<Array<{ x: number; y: number }>> = [];
  let currentStroke: Array<{ x: number; y: number }> = [];

  // ── Size state ─────────────────────────
  let currentSize: 'mobile' | 'tablet' | 'full' = 'full';

  // ── Helpers ─────────────────────────
  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
  }

  function closePopover(): void {
    if (activePopover) { activePopover.remove(); activePopover = null; }
    elementRing.style.display = 'none';
    recomputeInteracting();
  }

  function getElementRectInOverlay(viewRect: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
    const view = activeView();
    const vRect = view.getBoundingClientRect();
    const oRect = overlayHost.getBoundingClientRect();
    return {
      x: (vRect.left - oRect.left) + viewRect.x,
      y: (vRect.top - oRect.top) + viewRect.y,
      width: viewRect.width,
      height: viewRect.height,
    };
  }

  function showFloatingPopover(
    rect: { x: number; y: number; width: number; height: number },
    contextLabel: string,
    onSubmit: (text: string, auto: boolean) => void,
    onCancel?: () => void,
  ): void {
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
        <span class="popover-label">${escapeHtml(contextLabel)}</span>
        <button class="popover-close" title="Esc">${I('close')}</button>
      </div>
      <div class="popover-body">
        <input type="text" class="popover-input" placeholder="${escapeHtml(t('browser.placeholder', { selector: contextLabel }))}">
        <button class="popover-mode" type="button" aria-pressed="false" title="">✎</button>
        <button class="popover-send" title="">${I('play')}</button>
      </div>
      <div class="popover-arrow"></div>
    `;
    overlayHost.appendChild(popover);
    activePopover = popover;
    recomputeInteracting();

    const containerRect = overlayHost.getBoundingClientRect();
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
    const labelEl = popover.querySelector('.popover-label') as HTMLElement;
    const safeLabel = escapeHtml(contextLabel);

    let currentAuto = true;
    function applyMode(auto: boolean): void {
      currentAuto = auto;
      if (auto) {
        modeBtn.classList.remove('active');
        modeBtn.setAttribute('aria-pressed', 'false');
        modeBtn.title = t('browser.modeToggleToPrepare');
        sendBtn.title = t('browser.hintSend');
        if (labelEl) { labelEl.dataset.submitMode = 'send'; labelEl.innerHTML = safeLabel; }
      } else {
        modeBtn.classList.add('active');
        modeBtn.setAttribute('aria-pressed', 'true');
        modeBtn.title = t('browser.modeToggleToSend');
        sendBtn.title = t('browser.hintPrepare');
        if (labelEl) {
          labelEl.dataset.submitMode = 'prepare';
          labelEl.innerHTML = `${safeLabel} <span class="popover-badge-prepare">✎ ${escapeHtml(t('browser.badgePrepare'))}</span>`;
        }
      }
    }
    applyMode(true);
    modeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      applyMode(!currentAuto);
    });

    function submit(): void { onSubmit(input.value.trim(), currentAuto); }
    function cancel(): void { if (onCancel) onCancel(); closePopover(); }
    sendBtn.addEventListener('click', submit);
    closeBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    setTimeout(() => input.focus(), 50);
  }

  // ── Lasso screenshot ─────────────────────────
  // Capture region z aktivního view a ulož PNG do .levis-tmp/.
  // useViewOffset=true → cílíme přímo na element ve view (inspect path),
  //                false → cílíme na overlay-host souřadnice (annotate path).
  async function captureLasso(
    rect: { x: number; y: number; width: number; height: number },
    useViewOffset: boolean,
  ): Promise<{ rel: string; abs: string } | null> {
    const projectRoot = host.getProjectRoot();
    if (!projectRoot) return null;
    try {
      const offsetEl: HTMLElement = useViewOffset ? activeView() : overlayHost;
      const off = offsetEl.getBoundingClientRect();
      const pad = 8;
      const absRect = {
        x: Math.max(0, off.left + rect.x - pad),
        y: Math.max(0, off.top + rect.y - pad),
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      };
      const sep = projectRoot.includes('\\') ? '\\' : '/';
      const tmpDir = projectRoot + sep + '.levis-tmp';
      const filename = `lasso-${Date.now()}.png`;
      const abs = tmpDir + sep + filename;
      const rel = './.levis-tmp/' + filename;
      await host.captureRegion(absRect, abs);
      // Cleanup celého .levis-tmp adresáře po 30 s — obecně bezpečné, protože
      // souběžné screenshoty typicky neletí (popover je modal-like).
      window.setTimeout(() => {
        host.cleanupCapture(tmpDir).catch(() => {});
      }, 30_000);
      return { rel, abs };
    } catch {
      return null;
    }
  }

  // ── Inspect flow ─────────────────────────
  function setupInspect(): void {
    const btn = toolbar.inspectBtn;
    if (!btn || !inspector) return;

    btn.addEventListener('click', () => {
      inspectActive = !inspectActive;
      btn.classList.toggle('artifact-btn-active', inspectActive);
      btn.title = t(inspectActive ? 'browser.inspectOn' : 'browser.inspect');
      if (inspectActive) {
        if (annotating) toggleAnnotate(false);
        // Inspector přijímá iframe i webview (rozliší přes tagName === 'WEBVIEW').
        inspector.enable(activeView() as unknown as HTMLIFrameElement);
      } else {
        inspector.disable();
      }
      recomputeInteracting();
    });

    inspector.onSelect((info) => {
      selectedElement = info;
      if (!info.rect) return;
      showFloatingPopover(
        getElementRectInOverlay(info.rect),
        info.selector,
        (text, auto) => { void sendElementPrompt(text, auto); },
        () => {
          selectedElement = null;
          if (inspectActive) {
            inspector.disable();
            window.setTimeout(() => inspector.enable(activeView() as unknown as HTMLIFrameElement), 150);
          }
        },
      );
    });
  }

  async function sendElementPrompt(userText: string, auto: boolean): Promise<void> {
    if (!selectedElement) return;
    const label = currentFilePath
      ? currentFilePath.replace(/\\/g, '/').split('/').pop() || ''
      : (currentUrl ?? '');
    let shot: { rel: string; abs: string } | null = null;
    if (selectedElement.rect) shot = await captureLasso(selectedElement.rect, true);
    if (!selectedElement) return;

    let prompt = `V prohlížeči (${label}) uprav element ${selectedElement.selector}` +
      (selectedElement.text ? ` (obsah: "${selectedElement.text.substring(0, 50)}")` : '') +
      (userText ? ` — ${userText}` : '');
    if (shot) prompt += ` (screenshot: ${shot.rel})`;

    const submit = auto;
    armedReloadAfterCC = true;
    await host.sendPromptToCC(prompt, submit);
    showToast(t(submit ? (shot ? 'toast.sentToCCWithShot' : 'toast.sentToCC') : 'toast.preparedInCC'), 'success');
    closePopover();
    selectedElement = null;
    if (inspectActive && inspector) {
      inspector.disable();
      window.setTimeout(() => inspector.enable(activeView() as unknown as HTMLIFrameElement), 300);
    }
  }

  // ── Annotate flow ─────────────────────────
  function setupAnnotate(): void {
    const btn = toolbar.annotateBtn;
    if (!btn) return;
    btn.addEventListener('click', () => toggleAnnotate());

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
    annotCanvas.addEventListener('mouseup', endStroke);
    annotCanvas.addEventListener('mouseleave', endStroke);
    annotCanvas.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      strokes = []; currentStroke = [];
      if (annotCtx) annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
    });
  }

  function toggleAnnotate(force?: boolean): void {
    annotating = force !== undefined ? force : !annotating;
    const btn = toolbar.annotateBtn;
    if (btn) {
      btn.classList.toggle('artifact-btn-active', annotating);
      btn.title = t(annotating ? 'browser.annotateDraw' : 'browser.annotate');
    }
    annotCanvas.style.display = annotating ? 'block' : 'none';
    annotCanvas.style.pointerEvents = annotating ? 'auto' : 'none';
    if (annotating) {
      if (inspectActive && inspector) {
        inspectActive = false;
        const iBtn = toolbar.inspectBtn;
        if (iBtn) {
          iBtn.classList.remove('artifact-btn-active');
          iBtn.title = t('browser.inspect');
        }
        inspector.disable();
      }
      const rect = overlayHost.getBoundingClientRect();
      annotCanvas.width = rect.width;
      annotCanvas.height = rect.height;
      annotCtx = annotCanvas.getContext('2d');
      redrawAll();
    }
    recomputeInteracting();
  }

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

  function showAnnotPrompt(pts: Array<{ x: number; y: number }>): void {
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = maxX - minX, h = maxY - minY;
    const label = currentFilePath
      ? currentFilePath.replace(/\\/g, '/').split('/').pop() || ''
      : (currentUrl ?? '');

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
        await host.sendPromptToCC(prompt, submit);
        showToast(t(submit ? (shot ? 'toast.sentToCCWithShot' : 'toast.sentToCC') : 'toast.preparedInCC'), 'success');
        closePopover();
        strokes.pop();
        redrawAll();
      },
      () => { strokes.pop(); redrawAll(); },
    );
  }

  function drawStroke(ctx: CanvasRenderingContext2D, pts: Array<{ x: number; y: number }>, color: string, width: number): void {
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

  function redrawAll(): void {
    if (!annotCtx) return;
    annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
    for (const s of strokes) drawStroke(annotCtx, s, '#ff6a00', 3);
  }

  // ── Size buttons (mobile / tablet / full) ─────────────────────────
  // Core verze drží zjednodušený sizing — pixelová šířka aplikovaná na webview/iframe.
  // Plný 1:1 device-frame s PPI škálováním zůstává v browser.ts wrapperu (Task 7).
  function setupSizeButtons(): void {
    const wrap = toolbar.sizeBtnsContainer;
    if (!wrap) return;
    const btns = wrap.querySelectorAll('.artifact-size-btn');
    btns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const size = (btn.getAttribute('data-size') as 'mobile' | 'tablet' | 'full') || 'full';
        btns.forEach(b => b.classList.remove('artifact-size-active'));
        btn.classList.add('artifact-size-active');
        setSize(size);
      });
    });
  }

  function setSize(size: 'mobile' | 'tablet' | 'full'): void {
    currentSize = size;
    const view = activeView();
    if (size === 'full') {
      view.style.width = '100%';
      view.style.maxWidth = '';
      view.style.margin = '';
    } else if (size === 'tablet') {
      view.style.width = '768px';
      view.style.maxWidth = '100%';
      view.style.margin = '0 auto';
    } else {
      view.style.width = '412px';
      view.style.maxWidth = '100%';
      view.style.margin = '0 auto';
    }
  }

  setupInspect();
  setupAnnotate();
  setupSizeButtons();

  // CC done listener — odpálí auto-reload pokud je armed
  const unregisterCCDone = host.onCCDone(() => {
    if (!armedReloadAfterCC) return;
    armedReloadAfterCC = false;
    if (interacting) return; // popover/canvas otevřený — reload by rušil práci
    refresh();
  });

  function loadContent(content: { filePath: string } | { url: string }): void {
    if ('filePath' in content) {
      currentFilePath = content.filePath;
      currentUrl = null;
      iframeEl.src = 'file:///' + content.filePath.replace(/\\/g, '/');
      iframeEl.style.display = '';
      webviewEl.style.display = 'none';
    } else {
      currentUrl = content.url;
      currentFilePath = null;
      const isHttp = content.url.startsWith('http://') || content.url.startsWith('https://');
      if (isHttp) {
        (webviewEl as WebviewEl).src = content.url;
        webviewEl.style.display = '';
        iframeEl.style.display = 'none';
      } else {
        iframeEl.src = content.url;
        iframeEl.style.display = '';
        webviewEl.style.display = 'none';
      }
    }
    void container; // Task 6: container ponecháno pro budoucí use
    // Re-aplikovat aktuální size na nově zobrazený element
    setSize(currentSize);
  }

  function refresh(): void {
    if (currentFilePath) {
      iframeEl.src = 'file:///' + currentFilePath.replace(/\\/g, '/') + '?t=' + Date.now();
    } else if (currentUrl && webviewEl.style.display !== 'none') {
      const wv = webviewEl as WebviewEl;
      try {
        if (typeof wv.reloadIgnoringCache === 'function') wv.reloadIgnoringCache();
        else wv.reload();
      } catch { /* webview ještě není ready */ }
    } else if (currentUrl) {
      iframeEl.src = currentUrl + (currentUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
    }
  }

  function notifyCCDone(): void {
    // Veřejné API: pro popout, který nemá přímý workspace bridge
    if (!armedReloadAfterCC) return;
    armedReloadAfterCC = false;
    if (interacting) return;
    refresh();
  }

  function dispose(): void {
    unregisterCCDone();
    try { inspector?.dispose(); } catch { /* noop */ }
    closePopover();
    elementRing.remove();
    annotCanvas.remove();
  }

  return {
    loadContent,
    refresh,
    notifyCCDone,
    setSize,
    isInteracting: () => interacting,
    dispose,
  };
}

(window as unknown as { createBrowserCore: typeof createBrowserCore }).createBrowserCore = createBrowserCore;
