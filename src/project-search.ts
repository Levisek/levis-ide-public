// ── Project-wide search & replace (Ctrl+Shift+F) ──
//
// Modal s textovým hledáním napříč celým projektem.
// Volitelný case-sensitive a regex toggle. Volitelné nahrazení.
// Klik na hit = otevři soubor v editoru a skoč na řádek.

interface SearchHit {
  path: string;
  rel: string;
  line: number;
  col: number;
  preview: string;
}

let searchDebounce: any = null;

async function showProjectSearch(projectPath: string, workspace?: any): Promise<void> {
  document.querySelector('.psr-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'psr-backdrop';

  const modal = document.createElement('div');
  modal.className = 'psr-modal';
  const I = (window as any).icon;
  modal.innerHTML = `
    <div class="psr-header">
      <div class="psr-row">
        <span class="psr-icon">${I('search')}</span>
        <input type="text" class="psr-query" placeholder="${t('hub.search')}" spellcheck="false" autocomplete="off">
        <button class="psr-toggle psr-case" title="Case sensitive (Aa)">Aa</button>
        <button class="psr-toggle psr-regex" title="Regex">.*</button>
      </div>
      <div class="psr-row psr-replace-row">
        <span class="psr-icon">${I('editor')}</span>
        <input type="text" class="psr-replacement" placeholder="${t('search.replaceAll')}…" spellcheck="false" autocomplete="off">
        <button class="psr-btn psr-replace-all" title="${t('search.replaceAllTip')}">${t('search.replaceAll')}</button>
      </div>
    </div>
    <div class="psr-results"></div>
    <div class="psr-footer">
      <span class="psr-status">${t('search.startTyping')}</span>
      <span style="flex:1"></span>
      <span><kbd>Esc</kbd> ${t('search.close')}</span>
    </div>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const queryInput = modal.querySelector('.psr-query') as HTMLInputElement;
  const replInput = modal.querySelector('.psr-replacement') as HTMLInputElement;
  const caseBtn = modal.querySelector('.psr-case') as HTMLElement;
  const regexBtn = modal.querySelector('.psr-regex') as HTMLElement;
  const replAllBtn = modal.querySelector('.psr-replace-all') as HTMLButtonElement;
  const resultsEl = modal.querySelector('.psr-results') as HTMLElement;
  const statusEl = modal.querySelector('.psr-status') as HTMLElement;

  let caseSensitive = false;
  let useRegex = false;
  let lastHits: SearchHit[] = [];

  function close(): void {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
  }

  function escapeText(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] || c));
  }

  function highlightMatch(line: string, query: string): string {
    if (!query) return escapeText(line);
    try {
      let pattern: RegExp;
      if (useRegex) pattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
      else pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
      return escapeText(line).replace(pattern, m => `<mark class="psr-mark">${escapeText(m)}</mark>`);
    } catch {
      return escapeText(line);
    }
  }

  function renderResults(): void {
    resultsEl.innerHTML = '';
    if (lastHits.length === 0) {
      resultsEl.innerHTML = `<div class="psr-empty">${t('search.noResults')}</div>`;
      return;
    }
    // Group by file
    const byFile = new Map<string, SearchHit[]>();
    for (const h of lastHits) {
      if (!byFile.has(h.rel)) byFile.set(h.rel, []);
      byFile.get(h.rel)!.push(h);
    }
    for (const [rel, hits] of byFile) {
      const fileGroup = document.createElement('div');
      fileGroup.className = 'psr-file-group';
      const header = document.createElement('div');
      header.className = 'psr-file-header';
      header.innerHTML = `<span class="psr-file-name">${escapeText(rel)}</span><span class="psr-file-count">${hits.length}</span>`;
      fileGroup.appendChild(header);
      for (const h of hits) {
        const hitEl = document.createElement('div');
        hitEl.className = 'psr-hit';
        hitEl.innerHTML = `
          <span class="psr-hit-line">${h.line}</span>
          <span class="psr-hit-preview">${highlightMatch(h.preview, queryInput.value)}</span>
        `;
        hitEl.addEventListener('click', () => {
          if (workspace?.openFile) {
            workspace.openFile(h.path);
            // TODO: jump to line — vyžaduje editor.gotoLine API
          }
          close();
        });
        fileGroup.appendChild(hitEl);
      }
      resultsEl.appendChild(fileGroup);
    }
  }

  async function runSearch(): Promise<void> {
    const q = queryInput.value.trim();
    if (!q) {
      lastHits = [];
      resultsEl.innerHTML = '';
      statusEl.textContent = 'Začni psát pro hledání';
      return;
    }
    statusEl.textContent = 'Hledám...';
    try {
      lastHits = await (window as any).levis.projectSearch(projectPath, q, { caseSensitive, regex: useRegex });
      const fileCount = new Set(lastHits.map(h => h.rel)).size;
      statusEl.textContent = `${lastHits.length} výskytů v ${fileCount} souborech${lastHits.length >= 200 ? ' (limit 200)' : ''}`;
      renderResults();
    } catch (err) {
      statusEl.textContent = 'Chyba: ' + String(err);
    }
  }

  async function runReplaceAll(): Promise<void> {
    const q = queryInput.value.trim();
    const r = replInput.value;
    if (!q) return;
    if (lastHits.length === 0) return;
    if (!confirm(t('search.confirmReplace', { n: lastHits.length, files: new Set(lastHits.map(h => h.rel)).size }))) return;
    const targetFiles = Array.from(new Set(lastHits.map(h => h.path)));
    statusEl.textContent = 'Nahrazuji...';
    try {
      const result = await (window as any).levis.projectReplace(projectPath, q, r, { caseSensitive, regex: useRegex, targetFiles });
      if (result.error) {
        statusEl.textContent = 'Chyba: ' + result.error;
      } else {
        statusEl.textContent = `Nahrazeno ${result.count} výskytů`;
        // Refresh search po replace
        setTimeout(runSearch, 300);
      }
    } catch (err) {
      statusEl.textContent = 'Chyba: ' + String(err);
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }
  document.addEventListener('keydown', onKey, true);

  queryInput.addEventListener('input', () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runSearch, 250);
  });
  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
  });

  caseBtn.addEventListener('click', () => {
    caseSensitive = !caseSensitive;
    caseBtn.classList.toggle('psr-toggle-active', caseSensitive);
    if (queryInput.value) runSearch();
  });
  regexBtn.addEventListener('click', () => {
    useRegex = !useRegex;
    regexBtn.classList.toggle('psr-toggle-active', useRegex);
    if (queryInput.value) runSearch();
  });
  replAllBtn.addEventListener('click', runReplaceAll);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  setTimeout(() => queryInput.focus(), 0);
}

(window as any).showProjectSearch = showProjectSearch;
