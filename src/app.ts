// ── LevisIDE App (Tab Manager + Init) ───

interface TabInfo {
  id: string;
  label: string;
  projectPath?: string;
  contentEl: HTMLElement;
  tabEl: HTMLElement;
  workspace?: any;
}

const tabs: TabInfo[] = [];
let activeTabId: string = 'hub';

function applyTheme(theme: string): void {
  if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}
(window as any).applyTheme = applyTheme;

async function init(): Promise<void> {
  await initI18n();
  applyI18nDom(document);

  // Apply saved theme
  try {
    const savedTheme = await levis.storeGet('theme');
    if (savedTheme && savedTheme !== 'dark') applyTheme(savedTheme);
  } catch {}
  document.getElementById('btn-min')!.addEventListener('click', () => levis.minimize());
  document.getElementById('btn-max')!.addEventListener('click', () => levis.maximize());
  document.getElementById('btn-close')!.addEventListener('click', () => levis.close());

  // Confirm close + git pre-quit check
  let quitInProgress = false;
  levis.onConfirmQuit(() => {
    if (quitInProgress) return;
    showQuitConfirm();
  });

  function showQuitConfirm(): void {
    const overlay = document.createElement('div');
    overlay.className = 'quit-overlay';
    overlay.innerHTML = `
      <div class="quit-box">
        <div class="quit-title">${t('quit.title')}</div>
        <div class="quit-sub">${t('quit.sub')}</div>
        <div class="quit-btns">
          <button class="quit-cancel">${t('quit.cancel')}</button>
          <button class="quit-confirm">${t('quit.confirm')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cancel = () => overlay.remove();
    const confirm = async () => {
      overlay.remove();
      await runGitCheckThenQuit();
    };
    overlay.querySelector('.quit-cancel')!.addEventListener('click', cancel);
    overlay.querySelector('.quit-confirm')!.addEventListener('click', confirm);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cancel(); });
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { cancel(); document.removeEventListener('keydown', escHandler); }
      if (e.key === 'Enter') { confirm(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
  }

  interface GitIssue {
    name: string;
    path: string;
    dirty: boolean;
    ahead: number;
  }

  async function runGitCheckThenQuit(): Promise<void> {
    quitInProgress = true;
    // Loading state
    const loading = document.createElement('div');
    loading.className = 'quit-overlay';
    loading.innerHTML = `<div class="quit-box"><div class="quit-title">${t('quit.checking')}</div></div>`;
    document.body.appendChild(loading);

    const projects = tabs.filter(t => t.projectPath).map(t => ({ name: t.label, path: t.projectPath! }));
    console.log('[quit-check] projects:', projects);
    const issues: GitIssue[] = [];
    // Parallel s 3 s timeout per projekt — nezaseknout se na jediné
    const checks = projects.map(async (p) => {
      try {
        const status = await Promise.race([
          levis.gitStatus(p.path),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
        ]) as any;
        if (status && !status.error) {
          const dirty = (status.files && status.files.length > 0) || (status.modified && status.modified.length > 0) || (status.created && status.created.length > 0);
          const ahead = status.ahead || 0;
          if (dirty || ahead > 0) {
            issues.push({ name: p.name, path: p.path, dirty: !!dirty, ahead });
          }
        }
      } catch (e) {
        console.warn('[quit-check] failed for', p.path, e);
      }
    });
    await Promise.allSettled(checks);

    // Terminal aktivity check — pokud nějaký CC pracuje nebo čeká na input
    const activeTerms: Array<{ tab: string; label: string; state: string }> = [];
    for (const t of tabs) {
      if (!t.workspace || !t.workspace.getActiveTerminals) continue;
      try {
        const terms = t.workspace.getActiveTerminals();
        for (const term of terms) {
          if (term.state === 'working' || term.state === 'waiting') {
            activeTerms.push({ tab: t.label, label: term.label, state: term.state });
          }
        }
      } catch {}
    }

    loading.remove();

    if (issues.length === 0 && activeTerms.length === 0) {
      levis.forceQuit();
      return;
    }
    showQuitIssuesModal(issues, activeTerms);
  }

  function showQuitIssuesModal(issues: GitIssue[], activeTerms: Array<{ tab: string; label: string; state: string }>): void {
    const overlay = document.createElement('div');
    overlay.className = 'quit-overlay';
    const termRows = activeTerms.map(t => `
      <div class="git-issue-row">
        <div class="git-issue-info">
          <div class="git-issue-name">${escapeHtmlSafe(t.tab)} · ${escapeHtmlSafe(t.label)}</div>
          <div class="git-issue-detail">
            <span class="git-tag ${t.state === 'waiting' ? 'ahead' : 'dirty'}">
              ${t.state === 'waiting' ? (window as any).t('quit.ccWaiting') : (window as any).t('quit.ccWorking')}
            </span>
          </div>
        </div>
      </div>
    `).join('');
    const rows = issues.map((i, idx) => `
      <div class="git-issue-row" data-idx="${idx}">
        <div class="git-issue-info">
          <div class="git-issue-name">${escapeHtmlSafe(i.name)}</div>
          <div class="git-issue-detail">
            ${i.dirty ? `<span class="git-tag dirty">${(window as any).t('quit.tagDirty')}</span>` : ''}
            ${i.ahead > 0 ? `<span class="git-tag ahead">${(window as any).t('quit.tagUnpushed', { n: i.ahead })}</span>` : ''}
          </div>
        </div>
        <div class="git-issue-actions">
          ${i.ahead > 0 && !i.dirty ? '<button class="git-action push">Push</button>' : ''}
          <span class="git-issue-status"></span>
        </div>
      </div>
    `).join('');
    const subParts: string[] = [];
    if (activeTerms.length > 0) subParts.push(t('quit.partRunningCC'));
    if (issues.length > 0) subParts.push(t('quit.partUncommitted'));
    overlay.innerHTML = `
      <div class="quit-box quit-box-wide">
        <div class="quit-title">${t('quit.warnTitle')}</div>
        <div class="quit-sub">${t('quit.warnSub', { parts: subParts.join(getLocale() === 'cs' ? ' a ' : ' and ') })}</div>
        <div class="git-issues-list">${termRows}${rows}</div>
        <div class="quit-btns">
          <button class="quit-cancel">${t('quit.cancelFix')}</button>
          <button class="quit-confirm">${t('quit.confirmAnyway')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('.git-action.push').forEach((btn, i) => {
      const idx = parseInt((btn.closest('.git-issue-row') as HTMLElement).dataset.idx || '0', 10);
      btn.addEventListener('click', async () => {
        const issue = issues[idx];
        const statusEl = (btn.closest('.git-issue-row') as HTMLElement).querySelector('.git-issue-status') as HTMLElement;
        (btn as HTMLButtonElement).disabled = true;
        statusEl.textContent = '…';
        const r = await levis.gitPush(issue.path);
        if (r.error) {
          statusEl.textContent = '✗';
          statusEl.title = r.error;
          (btn as HTMLButtonElement).disabled = false;
        } else {
          statusEl.textContent = '✓';
          (btn as HTMLElement).style.display = 'none';
        }
      });
    });

    overlay.querySelector('.quit-cancel')!.addEventListener('click', () => {
      overlay.remove();
      quitInProgress = false;
    });
    overlay.querySelector('.quit-confirm')!.addEventListener('click', () => {
      overlay.remove();
      levis.forceQuit();
    });
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        overlay.remove();
        quitInProgress = false;
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  const content = document.getElementById('content')!;
  const hubContent = document.createElement('div');
  hubContent.className = 'tab-content active';
  hubContent.id = 'tab-content-hub';
  content.appendChild(hubContent);

  const hubTab: TabInfo = {
    id: 'hub',
    label: 'Hub',
    contentEl: hubContent,
    tabEl: document.querySelector('.tab[data-tab="hub"]')!,
  };
  tabs.push(hubTab);
  hubTab.tabEl.addEventListener('click', () => switchTab('hub'));

  await renderHub(hubContent, openProject);

  document.getElementById('btn-new-tab')?.addEventListener('click', () => {
    switchTab('hub');
    setTimeout(() => {
      // Najdi tile "Nový projekt" v Hubu nebo button v empty state a klikni
      const tile = document.querySelector('.tile-new') as HTMLElement;
      if (tile) tile.click();
      else {
        const emptyBtn = document.querySelector('.hub-empty-btn[data-action="new"]') as HTMLElement;
        if (emptyBtn) emptyBtn.click();
      }
    }, 150);
  });

  // ── Native keyboard shortcuts (NO hotkeys-js — no Ctrl+C/V conflict) ──
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // Don't intercept anything inside terminal, editor, or inputs
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
    if (el.closest('.xterm')) return;
    if (el.closest('.monaco-editor')) return;
    if (el.getAttribute('contenteditable')) return;

    // Ctrl+Shift+P — command palette
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
      e.preventDefault();
      (window as any).commandPalette.show();
    }
    // Ctrl+P — quick file open
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'p') {
      e.preventDefault();
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab?.projectPath) {
        (window as any).showQuickFileOpen?.(activeTab.projectPath, activeTab.workspace);
      }
    }
    // Ctrl+Shift+F — project search & replace
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault();
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab?.projectPath) {
        (window as any).showProjectSearch?.(activeTab.projectPath, activeTab.workspace);
      }
    }
    // Ctrl+Shift+T — hub
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      switchTab('hub');
    }
    // Ctrl+Shift+R — hard reload (no cache)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
      e.preventDefault();
      levis.hardReload();
    }
    // Ctrl+Tab / Ctrl+Shift+Tab — cyklovat mezi taby
    if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
      e.preventDefault();
      if (tabs.length < 2) return;
      const idx = tabs.findIndex(t => t.id === activeTabId);
      const next = e.shiftKey
        ? (idx - 1 + tabs.length) % tabs.length
        : (idx + 1) % tabs.length;
      switchTab(tabs[next].id);
    }
    // Ctrl+Shift+W — close tab
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'W') {
      e.preventDefault();
      if (activeTabId !== 'hub') closeTab(activeTabId);
    }
    // Ctrl+, — settings
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      switchTab('hub');
      setTimeout(() => {
        const btn = document.querySelector('.hub-btn-settings') as HTMLElement;
        if (btn) btn.click();
      }, 100);
    }
    // F1 nebo ? — help overlay
    if (e.key === 'F1' || (e.key === '?' && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault();
      showHelpOverlay();
    }
  });

  // ── Help overlay ──
  function showHelpOverlay(): void {
    const existing = document.getElementById('help-overlay');
    if (existing) { existing.remove(); return; }
    const overlay = document.createElement('div');
    overlay.id = 'help-overlay';
    overlay.className = 'help-overlay';
    overlay.innerHTML = `
      <div class="help-box">
        <div class="help-header">
          <h2>${t('help.title')}</h2>
          <button class="help-close" title="${t('artifact.cancelEsc')}">${(window as any).icon('close')}</button>
        </div>
        <div class="help-body">
          <section>
            <h3>${t('help.global')}</h3>
            <table>
              <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd></td><td>${t('help.row.palette')}</td></tr>
              <tr><td><kbd>Ctrl</kbd>+<kbd>P</kbd></td><td>${t('help.row.qfo')}</td></tr>
              <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd></td><td>${t('help.row.search')}</td></tr>
              <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd></td><td>${t('help.row.toHub')}</td></tr>
              <tr><td><kbd>Ctrl</kbd>+<kbd>Tab</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Tab</kbd></td><td>${t('help.row.cycleTabs')}</td></tr>
              <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>W</kbd></td><td>${t('help.row.closeTab')}</td></tr>
              <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd></td><td>${t('help.row.reload')}</td></tr>
              <tr><td><kbd>Ctrl</kbd>+<kbd>,</kbd></td><td>${t('help.row.settings')}</td></tr>
              <tr><td><kbd>F1</kbd> / <kbd>?</kbd></td><td>${t('help.row.help')}</td></tr>
            </table>
          </section>
          <section>
            <h3>${t('help.workspace')}</h3>
            <table>
              <tr><td><kbd>Alt</kbd>+<kbd>I</kbd></td><td>${t('help.row.toggleInspect')}</td></tr>
              <tr><td><kbd>Ctrl</kbd>+<kbd>Enter</kbd></td><td>${t('help.row.sendToTerm')}</td></tr>
              <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd></td><td>${t('help.row.refreshArt')}</td></tr>
              <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>${t('help.row.saveFile')}</td></tr>
              <tr><td><kbd>Ctrl</kbd>+<kbd>F</kbd> / <kbd>Ctrl</kbd>+<kbd>H</kbd></td><td>${t('help.row.findReplace')}</td></tr>
              <tr><td>${t('help.row.shiftEnter')}</td><td>${t('help.row.newline')}</td></tr>
            </table>
          </section>
          <section>
            <h3>${t('help.dnd')}</h3>
            <ul>
              <li>${t('help.dnd1')}</li>
              <li>${t('help.dnd2')}</li>
              <li>${t('help.dnd3')}</li>
            </ul>
          </section>
          <section>
            <h3>${t('help.inspector')}</h3>
            <ol>
              <li>${t('help.insp1')}</li>
              <li>${t('help.insp2')}</li>
              <li>${t('help.insp3')}</li>
              <li>${t('help.insp4')}</li>
            </ol>
          </section>
          <section>
            <h3>${t('help.annotation')}</h3>
            <ol>
              <li>${t('help.ann1')}</li>
              <li>${t('help.ann2')}</li>
              <li>${t('help.ann3')}</li>
            </ol>
          </section>
          <section>
            <h3>${t('help.hub')}</h3>
            <ul>
              <li>${t('help.hub1')}</li>
              <li>${t('help.hub2')}</li>
              <li>${t('help.hub3')}</li>
              <li>${t('help.hub4')}</li>
            </ul>
          </section>
          <section>
            <h3>${t('help.popout')}</h3>
            <p>${t('help.popoutText')}</p>
          </section>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.help-close')!.addEventListener('click', close);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
    const escHandler = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
  }
  (window as any).showHelpOverlay = showHelpOverlay;

  // ── Feedback formulář ──
  function showFeedbackForm(): void {
    if (document.getElementById('feedback-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'feedback-overlay';
    overlay.className = 'feedback-overlay';
    overlay.innerHTML = `
      <div class="feedback-box">
        <div class="feedback-header">
          <h2>${t('feedback.title')}</h2>
          <button class="help-close" title="${t('artifact.cancelEsc')}">${(window as any).icon('close')}</button>
        </div>
        <div class="feedback-body">
          <label class="feedback-label">${t('feedback.type')}</label>
          <div class="feedback-type-row">
            <button class="feedback-type-btn active" data-type="bug">🐛 ${t('feedback.bug')}</button>
            <button class="feedback-type-btn" data-type="feature">💡 ${t('feedback.feature')}</button>
            <button class="feedback-type-btn" data-type="crash">💥 ${t('feedback.crash')}</button>
          </div>
          <label class="feedback-label">${t('feedback.titleLabel')}</label>
          <input class="feedback-input" id="feedback-title" type="text" placeholder="${t('feedback.titlePlaceholder')}" />
          <label class="feedback-label">${t('feedback.descLabel')}</label>
          <textarea class="feedback-textarea" id="feedback-desc" rows="5" placeholder="${t('feedback.descPlaceholder')}"></textarea>
          <label class="feedback-label">${t('feedback.sendVia')}</label>
          <div class="feedback-submit-row">
            <button class="feedback-submit-btn feedback-submit-github" data-via="github">${(window as any).icon('github')} ${t('help.feedbackGithub')}</button>
            <button class="feedback-submit-btn feedback-submit-email" data-via="email">${(window as any).icon('upload')} ${t('help.feedbackEmail')}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.help-close')!.addEventListener('click', close);
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });

    let selectedType = 'bug';
    overlay.querySelectorAll('.feedback-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.feedback-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedType = (btn as HTMLElement).dataset.type || 'bug';
      });
    });

    const FEEDBACK_URL = 'https://levinger.cz/feedback.php';
    const FEEDBACK_TOKEN_URL = 'https://levinger.cz/feedback_token.php';

    overlay.querySelectorAll('.feedback-submit-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const title = (overlay.querySelector('#feedback-title') as HTMLInputElement).value.trim();
        const desc = (overlay.querySelector('#feedback-desc') as HTMLTextAreaElement).value.trim();
        if (!title) { (overlay.querySelector('#feedback-title') as HTMLInputElement).focus(); return; }
        const typeLabel = selectedType === 'bug' ? 'Bug' : selectedType === 'crash' ? 'Crash' : 'Feature';
        const via = (btn as HTMLElement).dataset.via;
        close();
        if (via === 'github') {
          const labels = selectedType === 'feature' ? 'enhancement' : 'bug';
          const body = encodeURIComponent(`## ${typeLabel}\n\n${desc || '_Bez popisu_'}`);
          const url = `https://github.com/Levisek/levis-ide/issues/new?title=${encodeURIComponent(`[${typeLabel}] ${title}`)}&body=${body}&labels=${labels}`;
          await (window as any).levis?.openExternal?.(url);
        } else {
          try {
            const tokenRes = await fetch(FEEDBACK_TOKEN_URL, { credentials: 'include' });
            const { token: captcha } = await tokenRes.json();
            const res = await fetch(FEEDBACK_URL, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: typeLabel, title, desc, captcha }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
          } catch {
            showToast(t('feedback.error'), 'error');
            return;
          }
        }
        showToast(t('feedback.sent'), 'success');
      });
    });

    const esc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    };
    document.addEventListener('keydown', esc);
    setTimeout(() => (overlay.querySelector('#feedback-title') as HTMLInputElement)?.focus(), 50);
  }
  (window as any).showFeedbackForm = showFeedbackForm;

  // Help + Settings + Feedback — přímé listenery
  document.getElementById('btn-help')?.addEventListener('click', () => showHelpOverlay());
  document.getElementById('btn-feedback')?.addEventListener('click', () => showFeedbackForm());
  document.getElementById('btn-settings')?.addEventListener('click', () => {
    if ((window as any).openHubSettings) (window as any).openHubSettings();
  });

  // ── Command palette commands ──
  const cp = (window as any).commandPalette;

  // GRAL commands — send to active workspace terminal
  function sendToActiveTerminal(cmd: string): void {
    const activeTab = tabs.find(t => t.id === activeTabId);
    const termSlot = activeTab?.contentEl.querySelector('.term-slot');
    if (termSlot) {
      termSlot.dispatchEvent(new CustomEvent('send-to-pty', { detail: cmd, bubbles: true }));
    } else {
      showToast(t('toast.noTerminal'), 'warning');
    }
  }

  cp.registerCommand({ id: 'gral-audit', label: '/audit — GRAL audit projektu', category: 'GRAL', action: () => sendToActiveTerminal('/audit') });
  cp.registerCommand({ id: 'gral-new-web', label: t('cp.newWeb'), category: t('cp.cat.gral'), action: () => sendToActiveTerminal('/new-web') });
  cp.registerCommand({ id: 'gral-vylepsit', label: t('cp.vylepsit'), category: t('cp.cat.gral'), action: () => sendToActiveTerminal('/vylepsit') });
  cp.registerCommand({ id: 'gral-harvest', label: t('cp.harvest'), category: t('cp.cat.gral'), action: () => sendToActiveTerminal('/harvest') });
  cp.registerCommand({ id: 'gral-extract', label: '/extract — Extrakce z projektu', category: 'GRAL', action: () => sendToActiveTerminal('/extract') });
  cp.registerCommand({ id: 'git-save', label: 'Git Save (commit)', category: 'Git', action: async () => { const cmd = (await levis.storeGet('cmdSave')) || '/commit'; sendToActiveTerminal(cmd as string); } });
  cp.registerCommand({ id: 'git-push', label: 'Git Push (commit + push)', category: 'Git', action: async () => { const cmd = (await levis.storeGet('cmdPush')) || '/commit && git push'; sendToActiveTerminal(cmd as string); } });

  // Nav commands
  cp.registerCommand({ id: 'hub', label: t('cp.gotoHub'), shortcut: 'Ctrl+Shift+T', category: t('cp.cat.nav'), action: () => switchTab('hub') });
  cp.registerCommand({ id: 'close-tab', label: t('cp.closeTab'), shortcut: 'Ctrl+Shift+W', category: t('cp.cat.nav'), action: () => { if (activeTabId !== 'hub') closeTab(activeTabId); } });
  cp.registerCommand({ id: 'reload', label: 'Obnovit Hub', category: 'Hub', action: () => {
    switchTab('hub');
    renderHub(tabs[0].contentEl, openProject);
  }});
  cp.registerCommand({ id: 'settings', label: t('cp.openSettings'), shortcut: 'Ctrl+,', category: t('cp.cat.app'), action: () => {
    switchTab('hub');
    setTimeout(() => {
      const btn = document.querySelector('.hub-btn-settings') as HTMLElement;
      if (btn) btn.click();
    }, 100);
  }});

  showToast('LevisIDE ready', 'success');

  // Welcome screen — pouze první spuštění
  (async () => {
    try {
      const seen = await levis.storeGet('welcomeSeen');
      if (!seen) showWelcomeScreen();
    } catch {}
  })();
}

function showWelcomeScreen(): void {
  const overlay = document.createElement('div');
  overlay.className = 'welcome-overlay';
  overlay.innerHTML = `
    <div class="welcome-box">
      <div class="welcome-logo"><img src="../assets/icon.svg" alt="LevisIDE"></div>
      <h1>${t('welcome.title')}</h1>
      <p class="welcome-tagline">${t('welcome.tagline')}</p>
      <div class="welcome-tips">
        <div class="welcome-tip">${t('welcome.tip1')}</div>
        <div class="welcome-tip">${t('welcome.tip2')}</div>
        <div class="welcome-tip">${t('welcome.tip3')}</div>
        <div class="welcome-tip">${t('welcome.tip4')}</div>
      </div>
      <button class="welcome-start">${t('welcome.start')}</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = async () => {
    overlay.remove();
    try { await levis.storeSet('welcomeSeen', true); } catch {}
  };
  overlay.querySelector('.welcome-start')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

function switchTab(tabId: string): void {
  activeTabId = tabId;
  for (const tab of tabs) {
    const isActive = tab.id === tabId;
    tab.tabEl.classList.toggle('active', isActive);
    tab.contentEl.classList.toggle('active', isActive);
    if (isActive) tab.tabEl.classList.remove('tab-has-badge');
  }
  // Skrýt titlebar settings/help/feedback v Hubu (Hub má vlastní)
  document.getElementById('window-controls')?.classList.toggle('hub-active', tabId === 'hub');
}

async function closeTab(tabId: string): Promise<void> {
  if (tabId === 'hub') return;
  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;
  const tab = tabs[idx];

  // Dirty check — neuložené soubory v editoru
  if (tab.workspace?.hasUnsavedChanges?.()) {
    const dirty = tab.workspace.getDirtyFiles?.() || [];
    const list = dirty.map((f: string) => f.split(/[\\/]/).pop()).join(', ') || t('quit.someFiles');
    const ok = await confirmCloseTab(tab.label, list);
    if (!ok) return;
  }

  if (tab.workspace) tab.workspace.dispose();
  tab.tabEl.remove();
  tab.contentEl.remove();
  tabs.splice(idx, 1);
  if (activeTabId === tabId) {
    switchTab(tabs[Math.min(idx, tabs.length - 1)].id);
  }
}

function confirmCloseTab(name: string, dirtyList: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'quit-overlay';
    overlay.innerHTML = `
      <div class="quit-box">
        <div class="quit-title">${t('quit.dirtyTitle', { name: escapeHtmlSafe(name) })}</div>
        <div class="quit-sub">${t('quit.dirtySub', { files: '<strong>' + escapeHtmlSafe(dirtyList) + '</strong>' })}</div>
        <div class="quit-btns">
          <button class="quit-cancel">${t('quit.dirtyCancel')}</button>
          <button class="quit-confirm">${t('quit.dirtyConfirm')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const done = (v: boolean) => { overlay.remove(); resolve(v); };
    overlay.querySelector('.quit-cancel')!.addEventListener('click', () => done(false));
    overlay.querySelector('.quit-confirm')!.addEventListener('click', () => done(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { document.removeEventListener('keydown', esc); done(false); }
    };
    document.addEventListener('keydown', esc);
  });
}

async function openProject(project: any): Promise<void> {
  const existing = tabs.find(t => t.projectPath === project.path);
  if (existing) { switchTab(existing.id); return; }

  const tabId = `project-${Date.now()}`;
  const tabsContainer = document.getElementById('tabs')!;
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.tab = tabId;
  tabEl.innerHTML = `
    <span class="tab-label">${escapeHtmlSafe(project.name)}</span>
    <span class="tab-close">&times;</span>
  `;
  // Per-projekt barevný border na tabu
  try {
    const colors: Record<string, string> = (await levis.storeGet('projectColors')) || {};
    const c = colors[project.path];
    if (c) tabEl.style.setProperty('--tab-color', c);
  } catch {}
  tabsContainer.appendChild(tabEl);

  tabEl.addEventListener('click', (e: MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('tab-close')) closeTab(tabId);
    else switchTab(tabId);
  });

  const content = document.getElementById('content')!;
  const contentEl = document.createElement('div');
  contentEl.className = 'tab-content';
  contentEl.id = `tab-content-${tabId}`;
  contentEl.innerHTML = `<div class="loading">${t('quit.loadingWs')}</div>`;
  content.appendChild(contentEl);

  const tabInfo: TabInfo = { id: tabId, label: project.name, projectPath: project.path, contentEl, tabEl };
  tabs.push(tabInfo);
  switchTab(tabId);

  (window as any).commandPalette.registerCommand({
    id: `goto-${tabId}`, label: t('cp.gotoProject', { name: project.name }), category: t('cp.cat.projects'),
    action: () => switchTab(tabId),
  });

  try { levis.gitPull(project.path); } catch {}

  // Track last opened time pro Recent sekci v Hubu
  try {
    const all: any = await levis.storeGet('projectLastOpened') || {};
    all[project.path] = Date.now();
    await levis.storeSet('projectLastOpened', all);
  } catch {}

  try {
    const workspace = await createWorkspace(project.path, project.name, project.projectType);
    contentEl.innerHTML = '';
    contentEl.appendChild(workspace.element);
    tabInfo.workspace = workspace;
    // Tab: CC working indikátor — živá animace dokud CC pracuje
    if (typeof workspace.onCCStateChange === 'function') {
      workspace.onCCStateChange((state: string) => {
        tabEl.classList.toggle('tab-cc-working', state === 'working');
      });
    }
    // Tab badge: když CC v tomto workspace doběhne a tab není aktivní, ukaž puntík
    if (typeof workspace.onCCDone === 'function') {
      workspace.onCCDone(async () => {
        if (activeTabId !== tabId) {
          tabEl.classList.add('tab-has-badge');
          // OS notifikace + zvuk (opt-in z prefs)
          try {
            const notifEnabled = await levis.storeGet('ccNotifications');
            const soundEnabled = await levis.storeGet('ccSound');
            if (notifEnabled !== false) {
              new Notification(t('notif.ccDone'), {
                body: t('notif.ccDoneBody', { name: project.name }),
                silent: soundEnabled === false,
              });
            }
            if (soundEnabled !== false) {
              playBeep();
            }
          } catch {}
        }
      });
    }
  } catch (err) {
    contentEl.innerHTML = `<div class="loading">Chyba: ${escapeHtmlSafe(String(err))}</div>`;
    console.error('Workspace error:', err);
  }
}

function escapeHtmlSafe(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Krátký 2-tónový beep přes Web Audio
let _audioCtx: AudioContext | null = null;
async function playBeep(): Promise<void> {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = _audioCtx;
    // Pokud byl kontext suspendnutý kvůli autoplay policy, probuď ho
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch {}
    }
    const now = ctx.currentTime;
    const tones = [ { freq: 880, t: 0 }, { freq: 1320, t: 0.13 } ];
    for (const tone of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = tone.freq;
      gain.gain.setValueAtTime(0, now + tone.t);
      gain.gain.linearRampToValueAtTime(0.35, now + tone.t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, now + tone.t + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + tone.t);
      osc.stop(now + tone.t + 0.25);
    }
  } catch (err) {
    console.warn('[playBeep]', err);
  }
}

// Inicializuj audio kontext na první user interaction (autoplay policy)
let _audioInited = false;
function initAudioOnce(): void {
  if (_audioInited) return;
  _audioInited = true;
  try {
    _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
  } catch {}
}
document.addEventListener('click', initAudioOnce, { once: true });
document.addEventListener('keydown', initAudioOnce, { once: true });

// Vystavit pro debug — F12 console: playBeep()
(window as any).playBeep = playBeep;

document.addEventListener('DOMContentLoaded', init);
