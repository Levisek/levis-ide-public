// ── Element Inspector ───────────────────
// Injects into iframe, highlights on hover, captures on click.
// Sends element info back to parent for Claude Code instructions.

interface InspectorInstance {
  enable: (iframe: HTMLIFrameElement) => void;
  disable: () => void;
  isActive: () => boolean;
  onSelect: (callback: (info: ElementInfo) => void) => void;
  dispose: () => void;
}

interface ElementInfo {
  tagName: string;
  id: string;
  classes: string[];
  text: string;
  selector: string;
  pageUrl: string;
  rect?: { x: number; y: number; width: number; height: number };
}

function createInspector(): InspectorInstance {
  let active = false;
  let currentIframe: HTMLIFrameElement | null = null;
  let selectCallback: ((info: ElementInfo) => void) | null = null;
  let messageHandler: ((e: MessageEvent) => void) | null = null;
  let consoleMessageHandler: ((e: any) => void) | null = null;

  // JS to inject into iframe
  const INSPECTOR_SCRIPT = `
(function() {
  if (window.__levisInspector) return;
  window.__levisInspector = true;

  let overlay = null;
  let label = null;

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = '__levis-inspector-overlay';
    overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #ff6a00;background:rgba(255,106,0,0.08);z-index:999999;transition:all 80ms ease;display:none;';
    document.body.appendChild(overlay);

    label = document.createElement('div');
    label.id = '__levis-inspector-label';
    label.style.cssText = 'position:fixed;z-index:999999;background:#ff6a00;color:white;font:11px/1.3 monospace;padding:2px 6px;border-radius:3px;pointer-events:none;display:none;white-space:nowrap;';
    document.body.appendChild(label);
  }

  function getSelector(el) {
    if (el.id) return '#' + el.id;
    let path = '';
    while (el && el.nodeType === 1) {
      let selector = el.tagName.toLowerCase();
      if (el.id) { path = '#' + el.id + (path ? ' > ' + path : ''); break; }
      if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\\s+/).filter(c => !c.startsWith('__levis')).slice(0, 2).join('.');
        if (cls) selector += '.' + cls;
      }
      path = selector + (path ? ' > ' + path : '');
      el = el.parentElement;
    }
    return path;
  }

  function onMouseOver(e) {
    if (!overlay) createOverlay();
    const el = e.target;
    if (el.id && el.id.startsWith('__levis')) return;
    const rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';

    const sel = getSelector(el);
    label.style.display = 'block';
    label.textContent = sel + ' (' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ')';
    label.style.top = Math.max(0, rect.top - 20) + 'px';
    label.style.left = rect.left + 'px';
  }

  function onMouseOut() {
    if (overlay) overlay.style.display = 'none';
    if (label) label.style.display = 'none';
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    if (el.id && el.id.startsWith('__levis')) return;

    const r = el.getBoundingClientRect();
    const info = {
      tagName: el.tagName.toLowerCase(),
      id: el.id || '',
      classes: Array.from(el.classList).filter(c => !c.startsWith('__levis')),
      text: (el.textContent || '').trim().substring(0, 100),
      selector: getSelector(el),
      pageUrl: window.location.href,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height }
    };

    // Pro klasicky iframe: postMessage do parenta
    try { window.parent.postMessage({ type: '__levis_inspector_select', info: info }, '*'); } catch(e) {}
    // Pro Electron <webview>: parent neslyšši postMessage, takze posleme i pres console.log
    // (parent nasloucha 'console-message' event a parsuje tento prefix).
    try { console.log('__LEVIS_INSPECTOR_SELECT__' + JSON.stringify(info)); } catch(e) {}
  }

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('click', onClick, true);

  window.__levisInspectorCleanup = function() {
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    if (overlay) overlay.remove();
    if (label) label.remove();
    delete window.__levisInspector;
    delete window.__levisInspectorCleanup;
  };
})();
`;

  const CLEANUP_SCRIPT = `
if (window.__levisInspectorCleanup) window.__levisInspectorCleanup();
`;

  function enable(iframe: HTMLIFrameElement): void {
    if (active && currentIframe === iframe) return;
    if (active) disable();

    currentIframe = iframe;
    active = true;

    // Inject inspector script
    try {
      const iframeWin = iframe.contentWindow;
      if (iframeWin) {
        (iframeWin as any).eval(INSPECTOR_SCRIPT);
      }
    } catch (err) {
      // Cross-origin — try executeJavaScript for webview
      if ((iframe as any).executeJavaScript) {
        (iframe as any).executeJavaScript(INSPECTOR_SCRIPT);
      }
    }

    // Listen for messages from iframe (klasicky iframe path)
    messageHandler = (e: MessageEvent) => {
      if (e.data?.type === '__levis_inspector_select' && selectCallback) {
        selectCallback(e.data.info as ElementInfo);
      }
    };
    window.addEventListener('message', messageHandler);

    // Pro Electron <webview>: poslouchat console-message event a parsovat prefix
    if ((iframe as any).addEventListener && iframe.tagName === 'WEBVIEW') {
      consoleMessageHandler = (e: any) => {
        const msg: string = e.message || '';
        if (msg.startsWith('__LEVIS_INSPECTOR_SELECT__') && selectCallback) {
          try {
            const info = JSON.parse(msg.slice('__LEVIS_INSPECTOR_SELECT__'.length));
            selectCallback(info as ElementInfo);
          } catch {}
        }
      };
      iframe.addEventListener('console-message', consoleMessageHandler);
    }
  }

  function disable(): void {
    if (!active) return;
    active = false;

    if (currentIframe) {
      try {
        const iframeWin = currentIframe.contentWindow;
        if (iframeWin) (iframeWin as any).eval(CLEANUP_SCRIPT);
      } catch {
        if ((currentIframe as any).executeJavaScript) {
          (currentIframe as any).executeJavaScript(CLEANUP_SCRIPT);
        }
      }
    }

    if (messageHandler) {
      window.removeEventListener('message', messageHandler);
      messageHandler = null;
    }
    if (consoleMessageHandler && currentIframe) {
      try { currentIframe.removeEventListener('console-message' as any, consoleMessageHandler); } catch {}
      consoleMessageHandler = null;
    }
    currentIframe = null;
  }

  return {
    enable,
    disable,
    isActive: () => active,
    onSelect: (cb) => { selectCallback = cb; },
    dispose: () => { disable(); },
  };
}

(window as any).createInspector = createInspector;
