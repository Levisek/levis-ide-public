// ── Quick file open (Ctrl+P) ──
//
// Modal s fuzzy file pickerem. Načte rekurzivně všechny soubory projektu,
// fuzzy match na zadaný query, šipky nahoru/dolů, Enter otevře soubor v editoru.

interface FileEntry {
  path: string;
  rel: string;
  name: string;
}

let cachedFiles: { projectPath: string; files: FileEntry[]; ts: number } | null = null;
const CACHE_TTL = 30_000; // 30 s

function fuzzyScore(query: string, target: string): number {
  // Jednoduchý fuzzy: každý znak query musí být v target ve správném pořadí.
  // Score: čím méně mezer mezi matchnutými znaky, tím lepší. Bonus za prefix match.
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let ti = 0;
  let lastMatch = -1;
  let score = 0;
  let consecutive = 0;
  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      // Bonus za consecutive match
      if (lastMatch === ti - 1) consecutive++;
      else consecutive = 0;
      score += 10 + consecutive * 5;
      // Bonus za začátek slova
      if (ti === 0 || /[\/\.\-_]/.test(t[ti - 1])) score += 10;
      lastMatch = ti;
      qi++;
    }
    ti++;
  }
  if (qi < q.length) return -1; // nematch
  // Penalizuj dlouhé cesty
  score -= Math.floor(target.length / 20);
  return score;
}

async function showQuickFileOpen(projectPath: string, workspace?: any): Promise<void> {
  // Zavři předchozí modal pokud existuje
  document.querySelector('.qfo-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'qfo-backdrop';

  const modal = document.createElement('div');
  modal.className = 'qfo-modal';
  modal.innerHTML = `
    <div class="qfo-input-wrap">
      <input type="text" class="qfo-input" placeholder="Hledat soubor v projektu... (Esc zruší)" autocomplete="off" spellcheck="false">
    </div>
    <div class="qfo-list"></div>
    <div class="qfo-footer">
      <span><kbd>↑↓</kbd> navigace</span>
      <span><kbd>Enter</kbd> otevřít</span>
      <span><kbd>Esc</kbd> zavřít</span>
    </div>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const input = modal.querySelector('.qfo-input') as HTMLInputElement;
  const listEl = modal.querySelector('.qfo-list') as HTMLElement;
  const footer = modal.querySelector('.qfo-footer') as HTMLElement;

  let files: FileEntry[] = [];
  let filtered: FileEntry[] = [];
  let selectedIdx = 0;

  function close(): void {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
  }

  function escapeText(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] || c));
  }

  function renderList(): void {
    listEl.innerHTML = '';
    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="qfo-empty">Žádné soubory</div>';
      return;
    }
    const slice = filtered.slice(0, 60);
    for (let i = 0; i < slice.length; i++) {
      const f = slice[i];
      const item = document.createElement('div');
      item.className = 'qfo-item' + (i === selectedIdx ? ' qfo-item-active' : '');
      const dirPart = f.rel.includes('/') ? f.rel.substring(0, f.rel.lastIndexOf('/') + 1) : '';
      item.innerHTML = `
        <span class="qfo-item-name">${escapeText(f.name)}</span>
        <span class="qfo-item-dir">${escapeText(dirPart)}</span>
      `;
      item.addEventListener('click', () => openSelected(i));
      listEl.appendChild(item);
    }
  }

  function applyFilter(): void {
    const q = input.value.trim();
    if (!q) {
      filtered = files.slice(0, 60);
    } else {
      const scored = files.map(f => ({ f, s: fuzzyScore(q, f.rel) })).filter(x => x.s >= 0);
      scored.sort((a, b) => b.s - a.s);
      filtered = scored.map(x => x.f);
    }
    selectedIdx = 0;
    renderList();
  }

  async function openSelected(idx?: number): Promise<void> {
    const i = idx ?? selectedIdx;
    const file = filtered[i];
    if (!file) return;
    close();
    if (workspace?.openFile) {
      workspace.openFile(file.path);
    } else {
      // Fallback — dispatch global event, workspace ho odchytí
      document.dispatchEvent(new CustomEvent('qfo:open', { detail: { path: file.path } }));
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      openSelected();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1);
      renderList();
      const active = listEl.querySelector('.qfo-item-active');
      active?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      renderList();
      const active = listEl.querySelector('.qfo-item-active');
      active?.scrollIntoView({ block: 'nearest' });
      return;
    }
  }
  document.addEventListener('keydown', onKey, true);

  input.addEventListener('input', applyFilter);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  setTimeout(() => input.focus(), 0);

  // Načti soubory (cache)
  footer.textContent = 'Načítám seznam souborů...';
  if (cachedFiles && cachedFiles.projectPath === projectPath && Date.now() - cachedFiles.ts < CACHE_TTL) {
    files = cachedFiles.files;
  } else {
    try {
      files = await (window as any).levis.listFilesRecursive(projectPath);
      cachedFiles = { projectPath, files, ts: Date.now() };
    } catch (err) {
      files = [];
    }
  }
  footer.innerHTML = `
    <span><kbd>↑↓</kbd> navigace</span>
    <span><kbd>Enter</kbd> otevřít</span>
    <span><kbd>Esc</kbd> zavřít</span>
    <span style="margin-left:auto; opacity:0.5;">${files.length} souborů</span>
  `;
  applyFilter();
}

(window as any).showQuickFileOpen = showQuickFileOpen;
