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

  // Strategie:
  // — tenký highlight overlay při hover (e.target jako cíl, jako to bylo původně → správné selektory).
  // — všechny mouse/click eventy na document v capture fázi preventDefault + stopImmediatePropagation.
  // — navíc override history API a window.location během inspect mode, aby SPA routing (React/Next)
  //   nemohl provést navigaci.
  const INSPECTOR_SCRIPT = `
(function() {
  if (window.__levisInspector) return;
  window.__levisInspector = true;

  var overlay = null;
  var label = null;

  // Uchováme originální navigační API a přetížíme je no-opy, aby SPA click handlery (router.push)
  // nemohly ZMĚNIT URL během inspect mode.
  var origPushState = history.pushState;
  var origReplaceState = history.replaceState;
  history.pushState = function() { /* blocked by inspector */ };
  history.replaceState = function() { /* blocked by inspector */ };

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = '__levis-inspector-overlay';
    overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #ff6a00;background:rgba(255,106,0,0.08);z-index:2147483647;transition:all 80ms ease;display:none;';
    document.documentElement.appendChild(overlay);

    label = document.createElement('div');
    label.id = '__levis-inspector-label';
    label.style.cssText = 'position:fixed;z-index:2147483647;background:#ff6a00;color:white;font:11px/1.3 monospace;padding:2px 6px;border-radius:3px;pointer-events:none;display:none;white-space:nowrap;';
    document.documentElement.appendChild(label);
  }

  // Zahazujeme hashed CSS classy (Emotion / CSS Modules / React Native Web / styled-components) —
  // jsou to opakující se generované hashe typu "css-view-g5y9jx", "r-flex-13awgt0", "sc-abc123",
  // pro targetting elementu nepoužitelné.
  function isHashedClass(c) {
    if (!c || typeof c !== 'string') return true;
    // Prefixy běžných CSS-in-JS knihoven
    if (/^(css-|sc-|jsx-|emotion-|tw-|chakra-)/.test(c)) return true;
    // React Native Web "r-*-*" (r-flex-13awgt0, r-WebkitOverflowScrolling-150rngu)
    if (/^r-[a-zA-Z]+-[a-z0-9]{5,}$/.test(c)) return true;
    // Čistý hash: 6+ hex/base36 znaků bez pomlček
    if (/^[a-z0-9]{6,}$/.test(c) && /[0-9]/.test(c)) return true;
    // _xxx123, __abc
    if (/^_+[a-z0-9]{4,}$/i.test(c)) return true;
    return false;
  }

  function meaningfulClasses(el) {
    if (!el.className || typeof el.className !== 'string') return [];
    return el.className.trim().split(/\\s+/)
      .filter(function(c){ return c && !c.startsWith('__levis') && !isHashedClass(c); })
      .slice(0, 2);
  }

  function esc(s, max) {
    if (!s) return '';
    s = String(s).replace(/"/g, "'").replace(/\\s+/g, ' ').trim();
    if (max && s.length > max) s = s.slice(0, max) + '…';
    return s;
  }

  // Popis jedné úrovně — vrátí nejspecifičtější selektor co element má
  function describe(el) {
    var tag = el.tagName.toLowerCase();
    if (el.id) return '#' + el.id;

    var testid = el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test-id'));
    if (testid) return tag + '[data-testid="' + esc(testid, 40) + '"]';

    var aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return tag + '[aria-label="' + esc(aria, 40) + '"]';

    var out = tag;
    var classes = meaningfulClasses(el);
    if (classes.length > 0) out += '.' + classes.join('.');

    // Rich attribute hints — když tam je, přidá unikátnost
    var role = el.getAttribute && el.getAttribute('role');
    if (role && classes.length === 0) out += '[role="' + role + '"]';

    if (tag === 'input' || tag === 'textarea') {
      var itype = el.getAttribute('type');
      if (itype) out += '[type="' + itype + '"]';
      var placeholder = el.getAttribute('placeholder');
      if (placeholder) out += '[placeholder="' + esc(placeholder, 30) + '"]';
      var name = el.getAttribute('name');
      if (name) out += '[name="' + esc(name, 20) + '"]';
    }
    if (tag === 'img') {
      var alt = el.getAttribute('alt');
      if (alt) out += '[alt="' + esc(alt, 30) + '"]';
      else {
        var src = el.getAttribute('src');
        if (src) out += '[src*="' + esc(src.split('/').pop() || src, 24) + '"]';
      }
    }
    if (tag === 'a') {
      var href = el.getAttribute('href');
      if (href) out += '[href="' + esc(href, 40) + '"]';
    }

    // Text content — pro leafy nebo elementy s krátkým vlastním textem
    var text = (el.textContent || '').trim();
    var own = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) own += (n.nodeValue || '');
    }
    own = own.trim();
    var displayText = own || (el.children.length === 0 ? text : '');
    if (displayText && displayText.length > 0 && displayText.length <= 50 && out === tag) {
      out += ':contains("' + esc(displayText, 40) + '")';
    } else if (displayText && displayText.length > 0 && displayText.length <= 50 && classes.length === 0) {
      out += ':contains("' + esc(displayText, 40) + '")';
    }

    // Pokud pořád jen holý tag bez ničeho, přidej nth-child
    if (out === tag) {
      var parent = el.parentElement;
      if (parent) {
        var idx = Array.prototype.indexOf.call(parent.children, el) + 1;
        out += ':nth-child(' + idx + ')';
      }
    }

    return out;
  }

  function getSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + el.id;

    // Když element sám má silnou identitu (text, aria, testid, href, alt, placeholder)
    // → vrať jen jeho popis, není třeba walkovat nahoru.
    var selfPiece = describe(el);
    var strongSelf = /data-testid|aria-label|contains\\(|alt=|placeholder=|href=|src\\*=|^#/.test(selfPiece);
    if (strongSelf) return selfPiece;

    // Jinak walkuj nahoru max 3 úrovně a hledej landmark / silný předek
    var path = [selfPiece];
    var curr = el.parentElement;
    var depth = 0;
    while (curr && curr.nodeType === 1 && depth < 3) {
      var piece = describe(curr);
      var tag = curr.tagName.toLowerCase();
      path.unshift(piece);
      if (curr.id) break;
      if (['nav','main','header','footer','section','article','aside','form'].indexOf(tag) >= 0) break;
      if (/data-testid|aria-label|role=/.test(piece)) break;
      curr = curr.parentElement;
      depth++;
    }
    return path.join(' > ');
  }

  function onMouseOver(e) {
    if (!overlay) createOverlay();
    var el = e.target;
    if (el.id && el.id.startsWith('__levis')) return;
    var rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';

    var sel = getSelector(el);
    label.style.display = 'block';
    label.textContent = sel + ' (' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ')';
    label.style.top = Math.max(0, rect.top - 20) + 'px';
    label.style.left = rect.left + 'px';
  }

  function onMouseOut() {
    if (overlay) overlay.style.display = 'none';
    if (label) label.style.display = 'none';
  }

  // Blokátor: preventDefault + stopImmediatePropagation v capture phase.
  // Pointer events se do stránky dostanou, ale navigace / SPA handlery jsou stopnuté.
  function blockEvent(e) {
    var el = e.target;
    if (el && el.id && typeof el.id === 'string' && el.id.startsWith('__levis')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
  }

  function onClick(e) {
    var el = e.target;
    if (el && el.id && typeof el.id === 'string' && el.id.startsWith('__levis')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();

    var r = el.getBoundingClientRect();
    var info = {
      tagName: el.tagName.toLowerCase(),
      id: el.id || '',
      classes: Array.from(el.classList).filter(function(c){ return !c.startsWith('__levis'); }),
      text: (el.textContent || '').trim().substring(0, 100),
      selector: getSelector(el),
      pageUrl: window.location.href,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height }
    };
    try { window.parent.postMessage({ type: '__levis_inspector_select', info: info }, '*'); } catch(e) {}
    try { console.log('__LEVIS_INSPECTOR_SELECT__' + JSON.stringify(info)); } catch(e) {}
  }

  // Capture phase listenery
  // Registrujeme na window — ten je v capture fázi JEŠTĚ PŘED document, takže naše
  // preventDefault + stopImmediatePropagation se spustí dřív než jakýkoli document-level listener
  // z React / Next / Vue routeru, který by vyvolal navigaci.
  window.addEventListener('mouseover', onMouseOver, true);
  window.addEventListener('mouseout', onMouseOut, true);
  window.addEventListener('mousedown', blockEvent, true);
  window.addEventListener('mouseup', blockEvent, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('auxclick', blockEvent, true);
  window.addEventListener('dblclick', blockEvent, true);
  window.addEventListener('submit', blockEvent, true);
  window.addEventListener('dragstart', blockEvent, true);
  window.addEventListener('contextmenu', blockEvent, true);

  window.__levisInspectorCleanup = function() {
    window.removeEventListener('mouseover', onMouseOver, true);
    window.removeEventListener('mouseout', onMouseOut, true);
    window.removeEventListener('mousedown', blockEvent, true);
    window.removeEventListener('mouseup', blockEvent, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('auxclick', blockEvent, true);
    window.removeEventListener('dblclick', blockEvent, true);
    window.removeEventListener('submit', blockEvent, true);
    window.removeEventListener('dragstart', blockEvent, true);
    window.removeEventListener('contextmenu', blockEvent, true);
    // Restore history API
    try { history.pushState = origPushState; } catch(e) {}
    try { history.replaceState = origReplaceState; } catch(e) {}
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
