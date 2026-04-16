// ── Workspace grid (rows × cells, max 2 řádky, max 2 buňky/řádek) ──
//
// Strukturně: jeden nebo dva řádky, každý řádek 1–2 buňky NEZÁVISLE.
// Tj. možné: [1], [2], [1,1], [2,1], [1,2], [2,2] buněk celkem.
//
// Drag z buňky A do buňky B = swap. Klik na "+" v prázdné buňce = picker panelů.
// "+" tlačítka na okrajích a uvnitř řádků pro přidávání sloupců/řádků.
// "-" pro sbalení prázdné buňky/řádku.

type GridPanelId =
  | 'terminal' | 'editor' | 'diff' | 'audit' | 'tokens'
  | 'browser';

interface GridRow {
  cells: (GridPanelId | null)[];  // length 1 nebo 2
  colSizes: number[];              // matches cells.length, sumuje 100
}

interface GridState {
  rows: GridRow[];                 // 1 nebo 2 řádky
  rowSizes: number[];              // matches rows.length, sumuje 100
  locked: boolean;
}

interface GridOptions {
  rootEl: HTMLElement;
  mountPanel: (panel: GridPanelId) => HTMLElement;
  getLabel: (panel: GridPanelId) => { icon: string; text: string };
  onChange?: (state: GridState) => void;
  onAfterRender?: () => void;
  // Extra akční tlačítka v headeru (např. split terminal)
  onHeaderRender?: (panel: GridPanelId, header: HTMLElement) => void;
  // Drag panelu mimo workspace bounds → tear-out do popout okna
  onDragOut?: (panel: GridPanelId, x: number, y: number) => void;
}

interface CellRef { row: number; col: number; }

interface GridApi {
  getState(): GridState;
  setState(s: Partial<GridState>): void;
  setCell(ref: CellRef, panel: GridPanelId | null): void;
  swap(a: CellRef, b: CellRef): void;
  toggleLock(): void;
  equalize(): void;
  openPicker(): void;
  findCell(panel: GridPanelId): CellRef | null;
  ensurePanel(panel: GridPanelId): void;
  removePanel(panel: GridPanelId): void;
  rerender(): void;
  dispose(): void;
}

const ALL_GRID_PANELS: GridPanelId[] = [
  'terminal', 'editor', 'diff', 'browser',
];

function defaultGridState(): GridState {
  return {
    rows: [{ cells: ['terminal', null], colSizes: [55, 45] }],
    rowSizes: [100],
    locked: false,
  };
}

function deserializeGrid(raw: unknown): GridState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as any;
  if (!Array.isArray(r.rows) || r.rows.length === 0 || r.rows.length > 2) return null;
  const rows: GridRow[] = [];
  for (const row of r.rows) {
    if (!row || !Array.isArray(row.cells)) return null;
    const len = row.cells.length;
    if (len < 1 || len > 2) return null;
    const cells = row.cells.map((c: any): GridPanelId | null =>
      typeof c === 'string' && ALL_GRID_PANELS.includes(c as GridPanelId) ? (c as GridPanelId) : null);
    const colSizes = Array.isArray(row.colSizes) && row.colSizes.length === len
      ? row.colSizes : (len === 1 ? [100] : [55, 45]);
    rows.push({ cells, colSizes });
  }
  const rowSizes = Array.isArray(r.rowSizes) && r.rowSizes.length === rows.length
    ? r.rowSizes : (rows.length === 1 ? [100] : [60, 40]);
  return { rows, rowSizes, locked: !!r.locked };
}

function createGrid(opts: GridOptions): GridApi {
  let state: GridState = defaultGridState();
  const panelCache = new Map<GridPanelId, HTMLElement>();

  function getOrMountPanel(panel: GridPanelId): HTMLElement {
    let el = panelCache.get(panel);
    if (!el) {
      el = opts.mountPanel(panel);
      el.classList.add('grid-panel');
      panelCache.set(panel, el);
    }
    return el;
  }

  function escapeText(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] || c));
  }

  function allCells(): GridPanelId[] {
    const out: GridPanelId[] = [];
    for (const row of state.rows) {
      for (const c of row.cells) if (c) out.push(c);
    }
    return out;
  }

  function availablePanels(): GridPanelId[] {
    const present = allCells();
    return ALL_GRID_PANELS.filter(p => !present.includes(p));
  }

  function refToKey(ref: CellRef): string { return `${ref.row}:${ref.col}`; }
  function keyToRef(key: string): CellRef {
    const [r, c] = key.split(':').map(Number);
    return { row: r, col: c };
  }

  // ── DnD ────────────────
  let drag: { from: CellRef; ghost: HTMLElement; started: boolean; ifrShield: HTMLElement | null } | null = null;
  let hoverOverlay: HTMLElement | null = null;

  function makeIframeShield(): HTMLElement {
    // Plnoplošný transparentní overlay nad iframy/webviews,
    // ať pointermove/up dorazí do našeho document handleru.
    const sh = document.createElement('div');
    sh.style.cssText = 'position:fixed;inset:0;z-index:9997;cursor:grabbing;background:transparent;';
    document.body.appendChild(sh);
    return sh;
  }

  function showHoverOverlay(cellEl: HTMLElement): void {
    if (!hoverOverlay) {
      hoverOverlay = document.createElement('div');
      hoverOverlay.className = 'grid-hover-overlay';
      document.body.appendChild(hoverOverlay);
    }
    const r = cellEl.getBoundingClientRect();
    hoverOverlay.style.cssText =
      `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` +
      `background:rgba(255,106,0,0.18);border:2px solid #ff6a00;border-radius:8px;` +
      `pointer-events:none;z-index:9998;transition:all 80ms ease;`;
  }
  function hideHoverOverlay(): void { hoverOverlay?.remove(); hoverOverlay = null; }

  function findCellAt(cx: number, cy: number): CellRef | null {
    const cells = opts.rootEl.querySelectorAll('.grid-cell');
    for (const cell of Array.from(cells)) {
      const r = cell.getBoundingClientRect();
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
        const key = (cell as HTMLElement).dataset.cellKey;
        if (key) return keyToRef(key);
      }
    }
    return null;
  }

  // ── Render ────────────
  function rerender(): void {
    // Cleanup edge proximity listeneru z minulého renderu
    const oldWrapper = opts.rootEl.firstElementChild as any;
    if (oldWrapper?._cleanupEdge) oldWrapper._cleanupEdge();
    for (const el of panelCache.values()) {
      if (el.parentElement) el.parentElement.removeChild(el);
    }
    opts.rootEl.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;width:100%;height:100%;';

    const root = document.createElement('div');
    root.className = 'grid-root' + (state.locked ? ' grid-locked' : '');
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.width = '100%';
    root.style.height = '100%';
    root.style.gap = '4px';

    for (let ri = 0; ri < state.rows.length; ri++) {
      const row = state.rows[ri];
      const rowEl = document.createElement('div');
      rowEl.className = 'grid-row';
      rowEl.style.display = 'flex';
      rowEl.style.flexDirection = 'row';
      rowEl.style.minHeight = '0';
      rowEl.style.minWidth = '0';
      rowEl.style.gap = '4px';
      rowEl.style.position = 'relative';
      if (state.locked) {
        rowEl.style.flex = '1';
      } else {
        rowEl.style.height = state.rowSizes[ri] + '%';
      }

      for (let ci = 0; ci < row.cells.length; ci++) {
        const panel = row.cells[ci];
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.cellKey = `${ri}:${ci}`;
        cell.style.minWidth = '0';
        cell.style.minHeight = '0';
        if (state.locked) {
          cell.style.flex = '1';
        } else {
          cell.style.width = row.colSizes[ci] + '%';
        }

        if (panel) {
          cell.classList.add('grid-cell-filled');
          const header = document.createElement('div');
          header.className = 'grid-cell-header';
          const lbl = opts.getLabel(panel);
          header.innerHTML = `<span class="grid-cell-icon">${lbl.icon}</span><span class="grid-cell-label">${escapeText(lbl.text)}</span>`;
          const closeBtn = document.createElement('button');
          closeBtn.className = 'grid-cell-close';
          closeBtn.title = (window as any).t('grid.closePanel');
          closeBtn.innerHTML = (window as any).icon('close', { size: 14 });
          closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setCell({ row: ri, col: ci }, null);
          });
          header.appendChild(closeBtn);
          if (opts.onHeaderRender) opts.onHeaderRender(panel, header);
          cell.appendChild(header);

          const body = document.createElement('div');
          body.className = 'grid-cell-body';
          body.appendChild(getOrMountPanel(panel));
          cell.appendChild(body);
        } else {
          cell.classList.add('grid-cell-empty');
          const plus = document.createElement('button');
          plus.className = 'grid-cell-plus';
          plus.innerHTML = (window as any).icon('plus', { size: 28 });
          plus.title = (window as any).t('grid.addPanel');
          plus.addEventListener('click', (e) => {
            e.stopPropagation();
            showAddMenu((p) => setCell({ row: ri, col: ci }, p));
          });
          cell.appendChild(plus);
        }
        rowEl.appendChild(cell);
      }

      // Splitter mezi sloupci v řádku (jen když 2 buňky a !locked)
      if (row.cells.length === 2 && !state.locked) {
        const vSplit = document.createElement('div');
        vSplit.className = 'grid-splitter grid-splitter-v split-handle';
        vSplit.style.cssText =
          `position:absolute;top:0;bottom:0;width:6px;` +
          `left:calc(${row.colSizes[0]}% - 3px);cursor:col-resize;z-index:5;`;
        rowEl.appendChild(vSplit);
        attachVSplit(vSplit, rowEl, ri);
      }

      // Edge handle: pokud má řádek 1 buňku, "+" na pravém okraji řádku (skrytý, ukáže se na hover)
      if (row.cells.length === 1) {
        const addCol = document.createElement('button');
        addCol.className = 'grid-edge-add grid-edge-add-right-row grid-edge-hidden';
        addCol.title = 'Přidat sloupec do tohoto řádku';
        addCol.innerHTML = (window as any).icon('plus', { size: 18 });
        addCol.addEventListener('click', (e) => {
          e.stopPropagation();
          row.cells.push(null);
          row.colSizes = [60, 40];
          opts.onChange?.(state);
          rerender();
        });
        rowEl.appendChild(addCol);
      } else if (row.cells.length === 2 && (row.cells[0] === null || row.cells[1] === null)) {
        // Sbalit prázdnou buňku v řádku
        const rmCol = document.createElement('button');
        rmCol.className = 'grid-edge-rm grid-edge-rm-row';
        rmCol.title = 'Sbalit prázdnou buňku';
        rmCol.textContent = '\u2212';
        rmCol.addEventListener('click', (e) => {
          e.stopPropagation();
          const keepIdx = row.cells[0] === null ? 1 : 0;
          row.cells = [row.cells[keepIdx]];
          row.colSizes = [100];
          opts.onChange?.(state);
          rerender();
        });
        rowEl.appendChild(rmCol);
      }

      root.appendChild(rowEl);
    }

    // Splitter mezi řádky
    if (state.rows.length === 2 && !state.locked) {
      const hSplit = document.createElement('div');
      hSplit.className = 'grid-splitter grid-splitter-h split-handle split-handle-h';
      hSplit.style.cssText =
        `position:absolute;left:0;right:0;height:6px;` +
        `top:calc(${state.rowSizes[0]}% - 3px);cursor:row-resize;z-index:5;`;
      wrapper.appendChild(hSplit);
      // Wrapper musí vědět o root pro výpočet — připojíme později
      setTimeout(() => attachHSplit(hSplit, wrapper), 0);
    }

    wrapper.appendChild(root);

    // Edge handle: přidat řádek dole (skrytý, ukáže se na hover okraje)
    if (state.rows.length === 1) {
      const addRow = document.createElement('button');
      addRow.className = 'grid-edge-add grid-edge-add-bottom grid-edge-hidden';
      addRow.title = 'Přidat řádek dole';
      addRow.innerHTML = (window as any).icon('plus', { size: 18 });
      addRow.addEventListener('click', () => {
        state.rows.push({ cells: [null], colSizes: [100] });
        state.rowSizes = [60, 40];
        opts.onChange?.(state);
        rerender();
      });
      wrapper.appendChild(addRow);
    } else if (state.rows.length === 2) {
      // Sbalit prázdný řádek
      const isEmpty = (row: GridRow) => row.cells.every(c => c === null);
      if (isEmpty(state.rows[0]) || isEmpty(state.rows[1])) {
        const rmRow = document.createElement('button');
        rmRow.className = 'grid-edge-rm grid-edge-rm-bottom';
        rmRow.title = 'Sbalit prázdný řádek';
        rmRow.textContent = '\u2212';
        rmRow.addEventListener('click', () => {
          const keepIdx = isEmpty(state.rows[0]) ? 1 : 0;
          state.rows = [state.rows[keepIdx]];
          state.rowSizes = [100];
          opts.onChange?.(state);
          rerender();
        });
        wrapper.appendChild(rmRow);
      }
    }

    opts.rootEl.appendChild(wrapper);

    // Edge proximity hover — ukáže/schová `+` tlačítka když je kurzor blízko okraje
    const EDGE_THRESHOLD = 60; // px
    const onMove = (ev: MouseEvent) => {
      const r = wrapper.getBoundingClientRect();
      const nearRight = ev.clientX >= r.right - EDGE_THRESHOLD && ev.clientX <= r.right + 10
                     && ev.clientY >= r.top && ev.clientY <= r.bottom;
      const nearBottom = ev.clientY >= r.bottom - EDGE_THRESHOLD && ev.clientY <= r.bottom + 10
                      && ev.clientX >= r.left && ev.clientX <= r.right;
      wrapper.querySelectorAll('.grid-edge-add-right-row, .grid-edge-add-right')
        .forEach(el => el.classList.toggle('grid-edge-visible', nearRight));
      wrapper.querySelectorAll('.grid-edge-add-bottom')
        .forEach(el => el.classList.toggle('grid-edge-visible', nearBottom));
    };
    document.addEventListener('mousemove', onMove);
    // Cleanup při příštím render
    (wrapper as any)._cleanupEdge = () => document.removeEventListener('mousemove', onMove);

    opts.onAfterRender?.();
  }

  function attachVSplit(vSplit: HTMLElement, rowEl: HTMLElement, rowIdx: number): void {
    vSplit.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startCol = state.rows[rowIdx].colSizes[0];
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize';
      document.body.appendChild(overlay);
      const onMove = (ev: MouseEvent) => {
        const r = rowEl.getBoundingClientRect();
        const dx = ((ev.clientX - startX) / r.width) * 100;
        let next = Math.max(15, Math.min(85, startCol + dx));
        if (Math.abs(next - 50) < 3) next = 50; // snap na střed
        state.rows[rowIdx].colSizes = [next, 100 - next];
        const cells = rowEl.querySelectorAll('.grid-cell');
        if (cells[0]) (cells[0] as HTMLElement).style.width = next + '%';
        if (cells[1]) (cells[1] as HTMLElement).style.width = (100 - next) + '%';
        vSplit.style.left = `calc(${next}% - 4px)`;
      };
      const onUp = () => {
        overlay.remove();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        opts.onChange?.(state);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function attachHSplit(hSplit: HTMLElement, wrapper: HTMLElement): void {
    hSplit.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startRow = state.rowSizes[0];
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:row-resize';
      document.body.appendChild(overlay);
      const onMove = (ev: MouseEvent) => {
        const r = wrapper.getBoundingClientRect();
        const dy = ((ev.clientY - startY) / r.height) * 100;
        let next = Math.max(15, Math.min(85, startRow + dy));
        if (Math.abs(next - 50) < 3) next = 50; // snap na střed
        state.rowSizes = [next, 100 - next];
        const rows = wrapper.querySelectorAll('.grid-row');
        if (rows[0]) (rows[0] as HTMLElement).style.height = next + '%';
        if (rows[1]) (rows[1] as HTMLElement).style.height = (100 - next) + '%';
        hSplit.style.top = `calc(${next}% - 4px)`;
      };
      const onUp = () => {
        overlay.remove();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        opts.onChange?.(state);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── Add panel modal ──
  // mode='available' = jen panely co nejsou v gridu (pro "+" v prázdné buňce)
  // mode='all' = všechny panely (pro toolbar button — discovery)
  function showAddMenu(onPick: (panel: GridPanelId) => void, mode: 'available' | 'all' = 'available'): void {
    document.querySelector('.grid-add-modal-backdrop')?.remove();
    const panels = mode === 'all' ? ALL_GRID_PANELS : availablePanels();
    if (panels.length === 0) return;
    const present = new Set(allCells());
    const backdrop = document.createElement('div');
    backdrop.className = 'grid-add-modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'grid-add-modal';
    modal.innerHTML = `<div class="grid-add-modal-title">Vyber panel</div>`;
    const listEl = document.createElement('div');
    listEl.className = 'grid-add-modal-list';
    for (const p of panels) {
      const lbl = opts.getLabel(p);
      const isPresent = present.has(p);
      const item = document.createElement('button');
      item.className = 'grid-add-modal-item' + (isPresent ? ' grid-add-modal-item-present' : '');
      item.innerHTML = `
        <span class="grid-add-modal-icon">${lbl.icon}</span>
        <span class="grid-add-modal-text">${escapeText(lbl.text)}</span>
        ${isPresent ? '<span class="grid-add-modal-badge">v gridu</span>' : ''}
      `;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        backdrop.remove();
        if (!isPresent) onPick(p);
      });
      listEl.appendChild(item);
    }
    modal.appendChild(listEl);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
    const escListener = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        backdrop.remove();
        document.removeEventListener('keydown', escListener);
      }
    };
    document.addEventListener('keydown', escListener);
  }

  // ── Mutace ────────
  function getCell(ref: CellRef): GridPanelId | null {
    return state.rows[ref.row]?.cells[ref.col] ?? null;
  }
  function setCellRaw(ref: CellRef, panel: GridPanelId | null): void {
    const row = state.rows[ref.row];
    if (!row) return;
    // Pokud cílíme na col mimo bounds → rozšířit cells (a dorovnat colSizes)
    while (row.cells.length <= ref.col) {
      row.cells.push(null);
    }
    if (row.colSizes.length !== row.cells.length) {
      // Rovnoměrné rozdělení
      const n = row.cells.length;
      row.colSizes = Array(n).fill(100 / n);
    }
    row.cells[ref.col] = panel;
  }

  function compactGrid(): void {
    const panels: GridPanelId[] = [];
    for (const row of state.rows) {
      for (const c of row.cells) {
        if (c !== null) panels.push(c);
      }
    }
    if (panels.length === 0) {
      state.rows = [{ cells: [null], colSizes: [100] }];
      state.rowSizes = [100];
    } else if (panels.length === 1) {
      state.rows = [{ cells: [panels[0]], colSizes: [100] }];
      state.rowSizes = [100];
    } else if (panels.length === 2) {
      state.rows = [{ cells: [panels[0], panels[1]], colSizes: [55, 45] }];
      state.rowSizes = [100];
    } else if (panels.length === 3) {
      state.rows = [
        { cells: [panels[0], panels[1]], colSizes: [55, 45] },
        { cells: [panels[2]], colSizes: [100] },
      ];
      state.rowSizes = [60, 40];
    }
  }

  function setCell(ref: CellRef, panel: GridPanelId | null): void {
    if (panel) {
      // Pokud panel už někde je → swap
      const existing = findCell(panel);
      if (existing && (existing.row !== ref.row || existing.col !== ref.col)) {
        const here = getCell(ref);
        setCellRaw(existing, here);
        setCellRaw(ref, panel);
        opts.onChange?.(state);
        rerender();
        return;
      }
    }
    setCellRaw(ref, panel);
    if (panel === null) compactGrid();
    opts.onChange?.(state);
    rerender();
  }

  function swap(a: CellRef, b: CellRef): void {
    if (a.row === b.row && a.col === b.col) return;
    const av = getCell(a);
    const bv = getCell(b);
    setCellRaw(a, bv);
    setCellRaw(b, av);
    opts.onChange?.(state);
    rerender();
  }

  function toggleLock(): void {
    state.locked = !state.locked;
    opts.onChange?.(state);
    rerender();
  }

  function openPicker(): void {
    showAddMenu((panel) => ensurePanel(panel), 'all');
  }

  function equalize(): void {
    for (const row of state.rows) {
      if (row.cells.length === 2) row.colSizes = [50, 50];
      else row.colSizes = [100];
    }
    state.rowSizes = state.rows.length === 2 ? [50, 50] : [100];
    opts.onChange?.(state);
    rerender();
  }

  function findCell(panel: GridPanelId): CellRef | null {
    for (let r = 0; r < state.rows.length; r++) {
      const idx = state.rows[r].cells.indexOf(panel);
      if (idx !== -1) return { row: r, col: idx };
    }
    return null;
  }

  function ensurePanel(panel: GridPanelId): void {
    if (findCell(panel)) return;
    // 1) Najdi první prázdnou buňku
    for (let r = 0; r < state.rows.length; r++) {
      const idx = state.rows[r].cells.indexOf(null);
      if (idx !== -1) {
        state.rows[r].cells[idx] = panel;
        opts.onChange?.(state);
        rerender();
        return;
      }
    }
    // 2) Rozšířit první řádek na 2 buňky (pokud má jen 1)
    if (state.rows[0].cells.length === 1) {
      state.rows[0].cells.push(panel);
      state.rows[0].colSizes = [55, 45];
      opts.onChange?.(state);
      rerender();
      return;
    }
    // 3) Přidat nový řádek (pokud zatím jen 1)
    if (state.rows.length === 1) {
      state.rows.push({ cells: [panel], colSizes: [100] });
      state.rowSizes = [60, 40];
      opts.onChange?.(state);
      rerender();
      return;
    }
    // 4) Druhý řádek má jen 1 buňku → přidej jako druhou
    if (state.rows[1].cells.length === 1) {
      state.rows[1].cells.push(panel);
      state.rows[1].colSizes = [55, 45];
      opts.onChange?.(state);
      rerender();
      return;
    }
    // 5) Plný 2×2 grid → fallback: nahraď první buňku
    state.rows[0].cells[0] = panel;
    opts.onChange?.(state);
    rerender();
  }

  function removePanel(panel: GridPanelId): void {
    const ref = findCell(panel);
    if (!ref) return;
    state.rows[ref.row].cells[ref.col] = null;
    compactGrid();
    opts.onChange?.(state);
    rerender();
  }

  function getState(): GridState { return state; }
  function setState(s: Partial<GridState>): void {
    state = { ...state, ...s };
    rerender();
  }

  // ── DnD pointer handler ──
  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    // Lock = zamknuto, žádný drag mezi buňkami ani drag-out
    if (state.locked) return;
    const target = e.target as HTMLElement;
    if (target.closest('.grid-cell-close')) return;
    if (target.closest('.grid-cell-plus')) return;
    if (target.closest('.grid-edge-add')) return;
    if (target.closest('.grid-edge-rm')) return;
    if (target.closest('.grid-splitter')) return;
    const header = target.closest('.grid-cell-header') as HTMLElement | null;
    if (!header) return;
    const cellEl = header.closest('.grid-cell') as HTMLElement | null;
    if (!cellEl || !cellEl.dataset.cellKey) return;
    const fromRef = keyToRef(cellEl.dataset.cellKey);
    const panel = getCell(fromRef);
    if (!panel) return;

    const startX = e.clientX, startY = e.clientY;
    drag = { from: fromRef, ghost: null as any, started: false, ifrShield: null };
    e.preventDefault();
    try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch {}

    const onMove = (ev: PointerEvent) => {
      if (!drag) return;
      if (!drag.started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        drag.started = true;
        const lbl = opts.getLabel(panel);
        const ghost = document.createElement('div');
        ghost.className = 'grid-drag-ghost';
        ghost.innerHTML = `<span>${lbl.icon}</span> ${escapeText(lbl.text)}`;
        document.body.appendChild(ghost);
        drag.ghost = ghost;
        drag.ifrShield = makeIframeShield();
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }
      drag.ghost.style.left = (ev.clientX + 12) + 'px';
      drag.ghost.style.top = (ev.clientY + 12) + 'px';

      // Out-of-bounds detection — pointer mimo workspace bounds (s tolerancí 6px)
      // Tolerance je důležitá protože Electron okno polkne pointer na své hraně
      const r = opts.rootEl.getBoundingClientRect();
      const TOL = 6;
      const outside = ev.clientX < r.left + TOL || ev.clientX > r.right - TOL
                   || ev.clientY < r.top + TOL || ev.clientY > r.bottom - TOL;
      if (outside) {
        hideHoverOverlay();
        drag.ghost.classList.add('grid-drag-ghost-outside');
        return;
      }
      drag.ghost.classList.remove('grid-drag-ghost-outside');

      const overRef = findCellAt(ev.clientX, ev.clientY);
      if (!overRef || (overRef.row === drag.from.row && overRef.col === drag.from.col)) {
        hideHoverOverlay();
      } else {
        const cellEl = opts.rootEl.querySelector(`.grid-cell[data-cell-key="${refToKey(overRef)}"]`) as HTMLElement | null;
        if (cellEl) showHoverOverlay(cellEl);
      }
    };

    const onUp = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (!drag) return;
      const wasStarted = drag.started;
      if (!wasStarted) {
        drag.ifrShield?.remove();
        drag = null;
        return;
      }
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      drag.ghost?.remove();
      drag.ifrShield?.remove();
      hideHoverOverlay();

      // Drop mimo workspace → drag-out (popout). Stejná tolerance jako v onMove.
      const dropR = opts.rootEl.getBoundingClientRect();
      const DROP_TOL = 6;
      const outside = ev.clientX < dropR.left + DROP_TOL || ev.clientX > dropR.right - DROP_TOL
                   || ev.clientY < dropR.top + DROP_TOL || ev.clientY > dropR.bottom - DROP_TOL;
      if (outside && opts.onDragOut) {
        const panel = getCell(drag.from);
        if (panel) {
          opts.onDragOut(panel, ev.screenX, ev.screenY);
        }
        drag = null;
        return;
      }

      const overRef = findCellAt(ev.clientX, ev.clientY);
      if (overRef && (overRef.row !== drag.from.row || overRef.col !== drag.from.col)) {
        swap(drag.from, overRef);
      }

      const killClick = (ce: Event) => {
        ce.stopImmediatePropagation();
        ce.preventDefault();
        document.removeEventListener('click', killClick, true);
      };
      document.addEventListener('click', killClick, true);
      setTimeout(() => document.removeEventListener('click', killClick, true), 50);

      drag = null;
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  opts.rootEl.addEventListener('pointerdown', onPointerDown);
  rerender();

  function dispose(): void {
    // Odeber root-level listener aby se nehromadily při opakovaných createGrid volání
    try { opts.rootEl.removeEventListener('pointerdown', onPointerDown); } catch {}
  }

  return {
    getState, setState, setCell, swap, toggleLock, equalize, openPicker,
    findCell, ensurePanel, removePanel, rerender, dispose,
  };
}

(window as any).Grid = { createGrid, defaultGridState, deserializeGrid, ALL_GRID_PANELS };
