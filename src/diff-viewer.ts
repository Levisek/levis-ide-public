// ── Git Diff Viewer ─────────────────────

interface DiffViewerInstance {
  element: HTMLElement;
  showDiff: (projectPath: string) => Promise<void>;
  dispose: () => void;
}

function createDiffViewer(container: HTMLElement): DiffViewerInstance {
  const tt = (window as any).t as (key: string, p?: Record<string, string | number>) => string;
  const wrapper = document.createElement('div');
  wrapper.className = 'diff-panel';

  const toolbar = document.createElement('div');
  toolbar.className = 'diff-toolbar';
  toolbar.innerHTML = `
    <span class="diff-title">${tt('diff.title')}</span>
    <span style="flex:1"></span>
    <button class="diff-btn-unstaged diff-btn-active">${tt('diff.unstaged')}</button>
    <button class="diff-btn-staged">${tt('diff.staged')}</button>
    <button class="diff-btn-refresh">${(window as any).icon('refresh')}</button>
  `;
  wrapper.appendChild(toolbar);

  // Commit bar
  const commitBar = document.createElement('div');
  commitBar.className = 'diff-commit-bar';
  commitBar.innerHTML = `
    <input type="text" class="diff-commit-msg" placeholder="${tt('diff.emptyMessage')}">
    <button class="diff-commit-btn">Commit</button>
    <button class="diff-commit-push-btn">${tt('diff.commitPush')}</button>
  `;
  wrapper.appendChild(commitBar);

  const diffContent = document.createElement('div');
  diffContent.className = 'diff-content';
  wrapper.appendChild(diffContent);

  container.appendChild(wrapper);

  let currentPath = '';
  let showStaged = false;

  function parseDiff(raw: string): HTMLElement {
    const fragment = document.createElement('div');
    if (!raw || raw.trim() === '') {
      fragment.innerHTML = `<div class="diff-empty">${tt('diff.noChanges')}</div>`;
      return fragment;
    }

    const lines = raw.split('\n');
    let currentFile = '';

    for (const line of lines) {
      const el = document.createElement('div');
      el.className = 'diff-line';

      if (line.startsWith('diff --git')) {
        const match = line.match(/b\/(.+)$/);
        currentFile = match ? match[1] : '';
        el.className = 'diff-file-header';
        el.textContent = currentFile;
        fragment.appendChild(el);
        continue;
      }
      if (line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
        continue; // skip meta lines
      }
      if (line.startsWith('@@')) {
        el.className = 'diff-line diff-hunk';
        el.textContent = line;
        fragment.appendChild(el);
        continue;
      }
      if (line.startsWith('+')) {
        el.className = 'diff-line diff-add';
        el.textContent = line;
      } else if (line.startsWith('-')) {
        el.className = 'diff-line diff-remove';
        el.textContent = line;
      } else {
        el.className = 'diff-line diff-context';
        el.textContent = line;
      }
      fragment.appendChild(el);
    }

    return fragment;
  }

  async function showDiff(projectPath: string): Promise<void> {
    currentPath = projectPath;
    diffContent.innerHTML = `<div class="diff-empty">${tt('diff.loading')}</div>`;
    try {
      const raw = showStaged
        ? await levis.gitDiffStaged(projectPath)
        : await levis.gitDiff(projectPath);
      diffContent.innerHTML = '';
      diffContent.appendChild(parseDiff(raw as string));
    } catch (err) {
      const safe = String(err).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
      diffContent.innerHTML = `<div class="diff-empty">${tt('diff.errorPrefix', { msg: safe })}</div>`;
    }
  }

  // Toggle buttons
  const btnUnstaged = toolbar.querySelector('.diff-btn-unstaged') as HTMLElement;
  const btnStaged = toolbar.querySelector('.diff-btn-staged') as HTMLElement;
  const btnRefresh = toolbar.querySelector('.diff-btn-refresh') as HTMLElement;

  btnUnstaged.addEventListener('click', () => {
    showStaged = false;
    btnUnstaged.classList.add('diff-btn-active');
    btnStaged.classList.remove('diff-btn-active');
    if (currentPath) showDiff(currentPath);
  });

  btnStaged.addEventListener('click', () => {
    showStaged = true;
    btnStaged.classList.add('diff-btn-active');
    btnUnstaged.classList.remove('diff-btn-active');
    if (currentPath) showDiff(currentPath);
  });

  btnRefresh.addEventListener('click', () => {
    if (currentPath) showDiff(currentPath);
  });

  // Commit handlers
  const commitMsgInput = commitBar.querySelector('.diff-commit-msg') as HTMLInputElement;
  const commitBtn = commitBar.querySelector('.diff-commit-btn') as HTMLButtonElement;
  const commitPushBtn = commitBar.querySelector('.diff-commit-push-btn') as HTMLButtonElement;

  async function doCommit(push: boolean): Promise<void> {
    if (!currentPath) return;
    const msg = commitMsgInput.value.trim();
    if (!msg) {
      (window as any).showToast?.(tt('diff.emptyMessage'), 'warning');
      return;
    }
    commitBtn.disabled = true;
    commitPushBtn.disabled = true;
    const result = await levis.gitCommit(currentPath, msg, push);
    commitBtn.disabled = false;
    commitPushBtn.disabled = false;
    if (result.error) {
      (window as any).showToast?.(tt('diff.errorPrefix', { msg: result.error }), 'error');
    } else if (result.pushError) {
      (window as any).showToast?.(tt('diff.commitOkPushFail', { msg: result.pushError }), 'warning');
      commitMsgInput.value = '';
      showDiff(currentPath);
    } else {
      (window as any).showToast?.(push ? tt('diff.commitPushDone') : tt('diff.commitDone'), 'success');
      commitMsgInput.value = '';
      showDiff(currentPath);
    }
  }

  commitBtn.addEventListener('click', () => doCommit(false));
  commitPushBtn.addEventListener('click', () => doCommit(true));
  commitMsgInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') doCommit(e.ctrlKey || e.shiftKey);
  });

  return {
    element: wrapper,
    showDiff,
    dispose: () => wrapper.remove(),
  };
}

(window as any).createDiffViewer = createDiffViewer;
