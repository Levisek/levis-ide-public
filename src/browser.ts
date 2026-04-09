// ── Browser Panel (webview) ─────────────

interface BrowserInstance {
  setUrl: (url: string) => void;
  getUrl: () => string;
  dispose: () => void;
}

function createBrowser(container: HTMLElement, defaultUrl: string = 'http://localhost:8080'): BrowserInstance {
  const toolbar = document.createElement('div');
  toolbar.className = 'browser-toolbar';
  const _I = (window as any).icon;
  toolbar.innerHTML = `
    <button class="btn-back" title="Zpět">‹</button>
    <button class="btn-forward" title="Vpřed">›</button>
    <button class="btn-reload" title="Obnovit">${_I('refresh')}</button>
    <input type="text" class="browser-url" value="${defaultUrl}" placeholder="URL adresa...">
    <button class="btn-devtools" title="DevTools">${_I('gear')}</button>
  `;
  container.appendChild(toolbar);

  const webviewContainer = document.createElement('div');
  webviewContainer.className = 'browser-webview-container';
  container.appendChild(webviewContainer);

  const webview = document.createElement('webview') as any;
  webview.setAttribute('src', defaultUrl);
  webview.setAttribute('allowpopups', '');
  webview.style.width = '100%';
  webview.style.height = '100%';
  webview.style.position = 'absolute';
  webview.style.top = '0';
  webview.style.left = '0';
  webviewContainer.appendChild(webview);

  const urlInput = toolbar.querySelector('.browser-url') as HTMLInputElement;
  const btnBack = toolbar.querySelector('.btn-back') as HTMLElement;
  const btnForward = toolbar.querySelector('.btn-forward') as HTMLElement;
  const btnReload = toolbar.querySelector('.btn-reload') as HTMLElement;
  const btnDevtools = toolbar.querySelector('.btn-devtools') as HTMLElement;

  urlInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      let url = urlInput.value.trim();
      if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      webview.src = url;
      urlInput.value = url;
    }
  });

  btnBack.addEventListener('click', () => { if (webview.canGoBack()) webview.goBack(); });
  btnForward.addEventListener('click', () => { if (webview.canGoForward()) webview.goForward(); });
  btnReload.addEventListener('click', () => webview.reload());
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

  return {
    setUrl: (url: string) => { webview.src = url; urlInput.value = url; },
    getUrl: () => urlInput.value,
    dispose: () => webviewContainer.removeChild(webview),
  };
}

(window as any).createBrowser = createBrowser;
