// ── Command Palette (Ctrl+Shift+P) ──────

interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
  category?: string;
}

const registeredCommands: PaletteCommand[] = [];
let paletteEl: HTMLElement | null = null;
let paletteInput: HTMLInputElement | null = null;
let paletteList: HTMLElement | null = null;
let paletteVisible = false;

function createPaletteDOM(): void {
  if (paletteEl) return;

  paletteEl = document.createElement('div');
  paletteEl.id = 'command-palette';
  paletteEl.className = 'palette-overlay';
  paletteEl.innerHTML = `
    <div class="palette-box">
      <input type="text" class="palette-input" placeholder="Zadej příkaz...">
      <div class="palette-list"></div>
    </div>
  `;
  document.body.appendChild(paletteEl);

  paletteInput = paletteEl.querySelector('.palette-input') as HTMLInputElement;
  paletteList = paletteEl.querySelector('.palette-list') as HTMLElement;

  paletteInput.addEventListener('input', () => renderFiltered());
  paletteInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') hidePalette();
    if (e.key === 'Enter') {
      const first = paletteList!.querySelector('.palette-item') as HTMLElement;
      if (first) first.click();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      navigateList(e.key === 'ArrowDown' ? 1 : -1);
    }
  });

  paletteEl.addEventListener('click', (e: MouseEvent) => {
    if (e.target === paletteEl) hidePalette();
  });
}

let selectedIdx = 0;

function navigateList(dir: number): void {
  const items = paletteList!.querySelectorAll('.palette-item');
  if (!items.length) return;
  items[selectedIdx]?.classList.remove('palette-selected');
  selectedIdx = Math.max(0, Math.min(items.length - 1, selectedIdx + dir));
  items[selectedIdx]?.classList.add('palette-selected');
  items[selectedIdx]?.scrollIntoView({ block: 'nearest' });
}

function renderFiltered(): void {
  if (!paletteList || !paletteInput) return;
  const query = paletteInput.value.toLowerCase();
  const filtered = registeredCommands.filter(c =>
    c.label.toLowerCase().includes(query) || (c.category || '').toLowerCase().includes(query)
  );

  paletteList.innerHTML = '';
  selectedIdx = 0;

  filtered.forEach((cmd, i) => {
    const item = document.createElement('div');
    item.className = `palette-item${i === 0 ? ' palette-selected' : ''}`;
    item.innerHTML = `
      <span class="palette-category">${cmd.category || 'General'}</span>
      <span class="palette-label">${cmd.label}</span>
      ${cmd.shortcut ? `<span class="palette-shortcut">${cmd.shortcut}</span>` : ''}
    `;
    item.addEventListener('click', () => {
      hidePalette();
      cmd.action();
    });
    paletteList!.appendChild(item);
  });
}

function showPalette(): void {
  createPaletteDOM();
  paletteEl!.classList.add('palette-visible');
  paletteInput!.value = '';
  paletteVisible = true;
  renderFiltered();
  setTimeout(() => paletteInput!.focus(), 50);
}

function hidePalette(): void {
  if (paletteEl) paletteEl.classList.remove('palette-visible');
  paletteVisible = false;
}

function registerCommand(cmd: PaletteCommand): void {
  const existing = registeredCommands.findIndex(c => c.id === cmd.id);
  if (existing >= 0) registeredCommands[existing] = cmd;
  else registeredCommands.push(cmd);
}

(window as any).commandPalette = {
  show: showPalette,
  hide: hidePalette,
  registerCommand,
  isVisible: () => paletteVisible,
};
