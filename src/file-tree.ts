// ── File Tree Sidebar ───────────────────

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
  expanded?: boolean;
  loaded?: boolean;
}

interface FileTreeInstance {
  element: HTMLElement;
  refresh: () => Promise<void>;
  dispose: () => void;
}

function ftEscape(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Mapování přípony → ikona + CSS třída pro barvu
const FILE_ICON_MAP: Record<string, { icon: string; cls: string }> = {
  // Code
  ts:    { icon: 'file-code', cls: 'ft-ext-ts' },
  tsx:   { icon: 'file-code', cls: 'ft-ext-ts' },
  js:    { icon: 'file-code', cls: 'ft-ext-js' },
  jsx:   { icon: 'file-code', cls: 'ft-ext-js' },
  mjs:   { icon: 'file-code', cls: 'ft-ext-js' },
  vue:   { icon: 'file-code', cls: 'ft-ext-vue' },
  svelte:{ icon: 'file-code', cls: 'ft-ext-svelte' },
  py:    { icon: 'file-code', cls: 'ft-ext-py' },
  rs:    { icon: 'file-code', cls: 'ft-ext-rs' },
  go:    { icon: 'file-code', cls: 'ft-ext-go' },
  php:   { icon: 'file-code', cls: 'ft-ext-php' },
  rb:    { icon: 'file-code', cls: 'ft-ext-rb' },
  java:  { icon: 'file-code', cls: 'ft-ext-java' },
  c:     { icon: 'file-code', cls: 'ft-ext-c' },
  cpp:   { icon: 'file-code', cls: 'ft-ext-c' },
  h:     { icon: 'file-code', cls: 'ft-ext-c' },
  cs:    { icon: 'file-code', cls: 'ft-ext-cs' },
  html:  { icon: 'file-code', cls: 'ft-ext-html' },
  htm:   { icon: 'file-code', cls: 'ft-ext-html' },
  css:   { icon: 'file-code', cls: 'ft-ext-css' },
  scss:  { icon: 'file-code', cls: 'ft-ext-css' },
  less:  { icon: 'file-code', cls: 'ft-ext-css' },
  // Data
  json:  { icon: 'file-json', cls: 'ft-ext-json' },
  yaml:  { icon: 'file-text', cls: 'ft-ext-yaml' },
  yml:   { icon: 'file-text', cls: 'ft-ext-yaml' },
  toml:  { icon: 'file-text', cls: 'ft-ext-yaml' },
  xml:   { icon: 'file-code', cls: 'ft-ext-html' },
  sql:   { icon: 'file-code', cls: 'ft-ext-sql' },
  // Images
  png:   { icon: 'file-image', cls: 'ft-ext-img' },
  jpg:   { icon: 'file-image', cls: 'ft-ext-img' },
  jpeg:  { icon: 'file-image', cls: 'ft-ext-img' },
  gif:   { icon: 'file-image', cls: 'ft-ext-img' },
  svg:   { icon: 'file-image', cls: 'ft-ext-svg' },
  webp:  { icon: 'file-image', cls: 'ft-ext-img' },
  ico:   { icon: 'file-image', cls: 'ft-ext-img' },
  // Text / docs
  md:    { icon: 'file-text', cls: 'ft-ext-md' },
  txt:   { icon: 'file-text', cls: 'ft-ext-txt' },
  log:   { icon: 'file-text', cls: 'ft-ext-txt' },
  env:   { icon: 'file-text', cls: 'ft-ext-env' },
  sh:    { icon: 'terminal',  cls: 'ft-ext-sh' },
  bat:   { icon: 'terminal',  cls: 'ft-ext-sh' },
  ps1:   { icon: 'terminal',  cls: 'ft-ext-sh' },
};

// Speciální soubory podle názvu
const FILE_NAME_MAP: Record<string, { icon: string; cls: string }> = {
  'package.json':   { icon: 'file-json', cls: 'ft-ext-npm' },
  'tsconfig.json':  { icon: 'file-json', cls: 'ft-ext-ts' },
  '.gitignore':     { icon: 'file-text', cls: 'ft-ext-git' },
  'Dockerfile':     { icon: 'file-text', cls: 'ft-ext-docker' },
  'CLAUDE.md':      { icon: 'file-text', cls: 'ft-ext-claude' },
  '.env':           { icon: 'file-text', cls: 'ft-ext-env' },
  '.env.local':     { icon: 'file-text', cls: 'ft-ext-env' },
};

function getFileExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

// Vlastní confirm modal — nahrazuje native window.confirm (blokující + nekonzistentní UX).
function ftConfirm(message: string, okLabel: string, danger = true): Promise<boolean> {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'ft-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'ft-modal';
    modal.setAttribute('role', 'dialog');

    const msgEl = document.createElement('div');
    msgEl.className = 'ft-modal-msg';
    msgEl.textContent = message;
    modal.appendChild(msgEl);

    const actions = document.createElement('div');
    actions.className = 'ft-modal-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ft-modal-btn';
    cancelBtn.textContent = t('ft.cancel');
    const okBtn = document.createElement('button');
    okBtn.className = 'ft-modal-btn ' + (danger ? 'ft-modal-btn-danger' : 'ft-modal-btn-primary');
    okBtn.textContent = okLabel;
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const done = (result: boolean) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      if (e.key === 'Enter')  { e.preventDefault(); done(true); }
    };
    document.addEventListener('keydown', onKey);
    cancelBtn.addEventListener('click', () => done(false));
    okBtn.addEventListener('click', () => done(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    okBtn.focus();
  });
}

function ftToast(msg: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
  const fn = (window as any).showToast;
  if (typeof fn === 'function') fn(msg, type);
}

async function createFileTree(
  container: HTMLElement,
  rootPath: string,
  onFileOpen: (filePath: string) => void
): Promise<FileTreeInstance> {
  const wrapper = document.createElement('div');
  wrapper.className = 'file-tree';

  const I = (window as any).icon;

  const header = document.createElement('div');
  header.className = 'file-tree-header';
  header.innerHTML = `
    <span class="file-tree-title">${ftEscape(t('ws.files'))}</span>
    <div class="file-tree-actions">
      <button class="file-tree-btn file-tree-new" title="${ftEscape(t('ft.newItem'))}">${I('plus', { size: 12 })}</button>
      <button class="file-tree-btn file-tree-collapse-all" title="${ftEscape(t('ws.collapseAll'))}">${I('chevron-right', { size: 12 })}</button>
      <button class="file-tree-btn file-tree-refresh" title="${ftEscape(t('ws.refreshFiles'))}">${I('refresh', { size: 12 })}</button>
    </div>
  `;
  wrapper.appendChild(header);

  const treeContainer = document.createElement('div');
  treeContainer.className = 'file-tree-content';
  treeContainer.tabIndex = 0; // pro keyboard eventy
  wrapper.appendChild(treeContainer);
  container.appendChild(wrapper);

  // ── Multi-select ──
  const selectedPaths = new Set<string>();
  let lastClickedPath: string | null = null;
  let activePath: string | null = null;

  function clearSelection(): void {
    selectedPaths.clear();
    treeContainer.querySelectorAll('.ft-selected').forEach(el => el.classList.remove('ft-selected'));
  }

  function selectItem(path: string, el: HTMLElement): void {
    selectedPaths.add(path);
    el.classList.add('ft-selected');
  }

  function deselectItem(path: string, el: HTMLElement): void {
    selectedPaths.delete(path);
    el.classList.remove('ft-selected');
  }

  // Item je "viditelný" pokud má layout (žádný předek nemá display:none).
  // offsetParent === null jasně signalizuje neviditelnost.
  function getAllVisibleItems(): HTMLElement[] {
    return Array.from(treeContainer.querySelectorAll<HTMLElement>('.file-tree-item'))
      .filter(el => el.offsetParent !== null);
  }

  // Po re-renderu obnov vizuální stav (třídy) — Set přežívá, DOM ne.
  function restoreSelectionVisual(): void {
    for (const p of selectedPaths) {
      const el = treeContainer.querySelector<HTMLElement>(`.file-tree-item[data-path="${CSS.escape(p)}"]`);
      if (el) el.classList.add('ft-selected');
    }
    if (activePath) {
      const el = treeContainer.querySelector<HTMLElement>(`.file-tree-item[data-path="${CSS.escape(activePath)}"]`);
      if (el) el.classList.add('ft-active');
    }
  }

  function getFileIcon(node: FileTreeNode): { svg: string; cls: string } {
    if (node.isDirectory) {
      return node.expanded
        ? { svg: I('folder-open', { size: 16 }), cls: 'ft-icon-folder-open' }
        : { svg: I('folder', { size: 16 }), cls: 'ft-icon-folder' };
    }
    const byName = FILE_NAME_MAP[node.name];
    if (byName) return { svg: I(byName.icon, { size: 16 }), cls: byName.cls };
    const ext = getFileExt(node.name);
    const byExt = FILE_ICON_MAP[ext];
    if (byExt) return { svg: I(byExt.icon, { size: 16 }), cls: byExt.cls };
    return { svg: I('file', { size: 16 }), cls: '' };
  }

  // ── Git status mapa ──
  const gitStatusMap = new Map<string, string>();
  const gitDirtyDirs = new Set<string>();

  // Case-insensitive path prefix match (Windows má case-insensitive filesystem,
  // git i Node vrací různý casing disk letter → bez toho badge nechytí).
  function pathToRel(fullPath: string): string {
    const lowerFull = fullPath.toLowerCase();
    const lowerRoot = rootPath.toLowerCase();
    let sliced = fullPath;
    if (lowerFull.startsWith(lowerRoot)) {
      sliced = fullPath.slice(rootPath.length);
    }
    return sliced.replace(/^[\\\/]+/, '').replace(/\\/g, '/');
  }

  async function loadGitStatus(): Promise<void> {
    gitStatusMap.clear();
    gitDirtyDirs.clear();
    try {
      const status: any = await (window as any).levis.gitStatus(rootPath);
      if (!status || status.error) return;
      const addEntry = (filePath: string, code: string) => {
        const rel = filePath.replace(/\\/g, '/').toLowerCase();
        gitStatusMap.set(rel, code);
        let dir = rel;
        while (dir.includes('/')) {
          dir = dir.substring(0, dir.lastIndexOf('/'));
          gitDirtyDirs.add(dir);
        }
      };
      if (Array.isArray(status.files)) {
        for (const f of status.files) {
          const code = (f.index && f.index !== ' ') ? f.index : (f.working_dir || '?');
          addEntry(f.path, code);
        }
      }
    } catch {}
  }

  function getGitBadge(node: FileTreeNode): string {
    const rel = pathToRel(node.path).toLowerCase();
    if (node.isDirectory) {
      return gitDirtyDirs.has(rel) ? '<span class="ft-git-dot"></span>' : '';
    }
    const code = gitStatusMap.get(rel);
    if (!code) return '';
    let cls = 'ft-git ft-git-other';
    let label = code;
    if (code === 'M') { cls = 'ft-git ft-git-modified'; label = 'M'; }
    else if (code === 'A') { cls = 'ft-git ft-git-added'; label = 'A'; }
    else if (code === 'D') { cls = 'ft-git ft-git-deleted'; label = 'D'; }
    else if (code === '?') { cls = 'ft-git ft-git-untracked'; label = 'U'; }
    else if (code === 'R') { cls = 'ft-git ft-git-renamed'; label = 'R'; }
    return `<span class="${cls}">${ftEscape(label)}</span>`;
  }

  async function loadChildren(node: FileTreeNode): Promise<void> {
    if (!node.isDirectory || node.loaded) return;
    const raw = await levis.readDir(node.path);
    const entries = Array.isArray(raw) ? raw : [];
    node.children = entries.map((e: any) => ({
      name: e.name,
      path: e.path,
      isDirectory: e.isDirectory,
      children: e.isDirectory ? [] : undefined,
      expanded: false,
      loaded: false,
    }));
    // Sort: dirs first, then alpha
    node.children.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    node.loaded = true;
  }

  function renderNode(node: FileTreeNode, depth: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'file-tree-item';
    el.dataset.path = node.path;
    el.style.paddingLeft = `${8 + depth * 18}px`;

    const fileIcon = getFileIcon(node);
    const gitBadge = getGitBadge(node);
    const chevron = node.isDirectory
      ? `<span class="ft-chevron">${I(node.expanded ? 'chevron-down' : 'chevron-right', { size: 12 })}</span>`
      : '<span class="ft-chevron-spacer"></span>';

    // node.name jde přes ftEscape — jinak soubor se jménem "<img onerror=...>" rozbije DOM.
    el.innerHTML = `
      ${chevron}
      <span class="ft-icon ${fileIcon.cls}">${fileIcon.svg}</span>
      <span class="ft-name">${ftEscape(node.name)}</span>
      ${gitBadge}
    `;

    if (node.isDirectory) {
      el.classList.add('ft-dir');
      const childContainer = document.createElement('div');
      childContainer.className = 'ft-children';
      childContainer.style.display = node.expanded ? 'block' : 'none';

      el.addEventListener('click', async (e: MouseEvent) => {
        e.stopPropagation();
        node.expanded = !node.expanded;
        if (node.expanded && !node.loaded) {
          await loadChildren(node);
          childContainer.innerHTML = '';
          for (const child of node.children || []) {
            childContainer.appendChild(renderNode(child, depth + 1));
          }
        }
        childContainer.style.display = node.expanded ? 'block' : 'none';
        // Update chevron + icon
        const chev = el.querySelector('.ft-chevron');
        if (chev) chev.innerHTML = I(node.expanded ? 'chevron-down' : 'chevron-right', { size: 12 });
        const ic = getFileIcon(node);
        const iconEl = el.querySelector('.ft-icon');
        if (iconEl) { iconEl.innerHTML = ic.svg; iconEl.className = 'ft-icon ' + ic.cls; }
        wrapper.dispatchEvent(new CustomEvent('file-selected', { detail: { path: node.path, isDirectory: true }, bubbles: true }));
      });

      el.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        showFileContextMenu(e.clientX, e.clientY, node);
      });

      const nodeWrapper = document.createElement('div');
      nodeWrapper.className = 'ft-node';
      nodeWrapper.appendChild(el);
      nodeWrapper.appendChild(childContainer);
      return nodeWrapper;
    } else {
      el.classList.add('ft-file');
      el.draggable = true;
      el.addEventListener('dragstart', (e: DragEvent) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData('text/plain', node.path);
        e.dataTransfer.effectAllowed = 'copy';
      });
      el.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey) {
          if (selectedPaths.has(node.path)) deselectItem(node.path, el);
          else selectItem(node.path, el);
        } else if (e.shiftKey && lastClickedPath) {
          const items = getAllVisibleItems();
          const fromIdx = items.findIndex(i => i.dataset.path === lastClickedPath);
          const toIdx = items.findIndex(i => i.dataset.path === node.path);
          if (fromIdx >= 0 && toIdx >= 0) {
            const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
            for (let i = start; i <= end; i++) {
              const p = items[i].dataset.path;
              if (p) selectItem(p, items[i]);
            }
          }
        } else {
          clearSelection();
          treeContainer.querySelectorAll('.ft-active').forEach(n => n.classList.remove('ft-active'));
          el.classList.add('ft-active');
          activePath = node.path;
          selectItem(node.path, el);
          onFileOpen(node.path);
        }
        lastClickedPath = node.path;
        wrapper.dispatchEvent(new CustomEvent('file-selected', { detail: { path: node.path, isDirectory: false }, bubbles: true }));
      });
      el.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        showFileContextMenu(e.clientX, e.clientY, node);
      });
      return el;
    }
  }

  // Inline rename input (soubor i složka)
  function startRename(node: FileTreeNode): void {
    const itemEl = treeContainer.querySelector(`.file-tree-item[data-path="${CSS.escape(node.path)}"]`);
    if (!itemEl) return;
    const nameEl = itemEl.querySelector('.ft-name') as HTMLElement;
    if (!nameEl) return;
    const oldName = node.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldName;
    input.className = 'ft-rename-input';
    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    // Výchozí: vybrat jen basename bez přípony
    const dot = oldName.lastIndexOf('.');
    if (dot > 0 && !node.isDirectory) input.setSelectionRange(0, dot);
    else input.select();
    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      done = true;
      const newName = input.value.trim();
      if (!commit || !newName || newName === oldName) {
        nameEl.textContent = oldName;
        return;
      }
      const res = await levis.renamePath(node.path, newName);
      if (res && res.error) {
        ftToast(t('ft.renameFailed', { err: res.error }), 'error');
        nameEl.textContent = oldName;
        return;
      }
      // Update selection set — starý path už neexistuje
      if (selectedPaths.has(node.path)) {
        selectedPaths.delete(node.path);
        if (res && res.path) selectedPaths.add(res.path);
      }
      if (activePath === node.path && res && res.path) activePath = res.path;
      await renderTree();
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); done = true; nameEl.textContent = oldName; }
    });
  }

  // Inline input pro New File / New Folder
  function startCreate(parentPath: string, kind: 'file' | 'folder'): void {
    // Cílový kontejner
    let host: HTMLElement | null = null;
    let depth = 0;
    if (parentPath === rootPath) {
      host = treeContainer;
      depth = 0;
    } else {
      const parentItem = treeContainer.querySelector<HTMLElement>(`.ft-dir[data-path="${CSS.escape(parentPath)}"]`);
      if (!parentItem) return;
      const childrenEl = parentItem.parentElement?.querySelector<HTMLElement>('.ft-children') ?? null;
      if (!childrenEl) return;
      if (childrenEl.style.display === 'none') parentItem.click(); // rozbalí
      host = childrenEl;
      const padding = parseInt(parentItem.style.paddingLeft || '8', 10);
      depth = Math.max(0, Math.round((padding - 8) / 18)) + 1;
    }
    if (!host) return;

    const row = document.createElement('div');
    row.className = 'file-tree-item ft-create-row';
    row.style.paddingLeft = `${8 + depth * 18}px`;
    const iconSvg = kind === 'folder' ? I('folder', { size: 16 }) : I('file', { size: 16 });
    row.innerHTML = `<span class="ft-chevron-spacer"></span><span class="ft-icon">${iconSvg}</span>`;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ft-rename-input';
    input.placeholder = t(kind === 'folder' ? 'ft.newFolderPlaceholder' : 'ft.newFilePlaceholder');
    row.appendChild(input);
    host.insertBefore(row, host.firstChild);
    input.focus();

    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      row.remove();
      if (!commit || !name) return;
      if (name.includes('/') || name.includes('\\') || name.includes('..')) {
        ftToast(t('ft.invalidName'), 'error');
        return;
      }
      const sep = parentPath.includes('\\') || /^[A-Za-z]:/.test(parentPath) ? '\\' : '/';
      const targetPath = parentPath.replace(/[\\/]+$/, '') + sep + name;
      const res = kind === 'folder'
        ? await levis.createDir(targetPath)
        : await levis.createFile(targetPath);
      if (res && res.error) {
        ftToast(t('ft.createFailed', { err: res.error }), 'error');
        return;
      }
      await renderTree();
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
  }

  async function doDelete(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const names = paths.map(p => p.replace(/\\/g, '/').split('/').pop() || p);
    const ok = await ftConfirm(t('ft.confirmDelete', { names: names.join(', ') }), t('ft.delete'), true);
    if (!ok) return;
    const errors: string[] = [];
    for (const p of paths) {
      const res = await levis.deletePath(p);
      if (res && res.error) errors.push(`${names.find(n => p.endsWith(n)) || p}: ${res.error}`);
    }
    if (errors.length) ftToast(t('ft.deleteFailed', { err: errors.join('; ') }), 'error');
    else if (paths.length > 1) ftToast(t('ft.deletedCount', { n: String(paths.length) }), 'success');
    // Vyčistit selection pro smazané cesty
    for (const p of paths) selectedPaths.delete(p);
    if (activePath && paths.includes(activePath)) activePath = null;
    await renderTree();
  }

  function showFileContextMenu(x: number, y: number, node: FileTreeNode | null): void {
    document.querySelectorAll('.ft-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'ft-context-menu';
    const hasMultiSelect = selectedPaths.size > 1;
    const rootClick = !node;
    const parentForNew = rootClick ? rootPath : (node.isDirectory ? node.path : rootPath);

    if (rootClick) {
      // Menu v prázdném prostoru — jen create akce
      menu.innerHTML = `
        <div class="tcm-item" data-act="newFile">${I('file', { size: 13 })} ${ftEscape(t('ft.newFile'))}</div>
        <div class="tcm-item" data-act="newFolder">${I('folder', { size: 13 })} ${ftEscape(t('ft.newFolder'))}</div>
      `;
    } else {
      menu.innerHTML = `
        ${node.isDirectory ? `
          <div class="tcm-item" data-act="newFile">${I('file', { size: 13 })} ${ftEscape(t('ft.newFile'))}</div>
          <div class="tcm-item" data-act="newFolder">${I('folder', { size: 13 })} ${ftEscape(t('ft.newFolder'))}</div>
          <div class="tcm-sep"></div>
        ` : ''}
        <div class="tcm-item" data-act="rename">${I('editor', { size: 13 })} ${ftEscape(t('hub.tcm.rename'))}</div>
        <div class="tcm-item" data-act="copyPath">${I('file', { size: 13 })} ${ftEscape(t('hub.tcm.copyPath'))}</div>
        <div class="tcm-item" data-act="explorer">${I('folder', { size: 13 })} ${ftEscape(t('hub.tcm.explorer'))}</div>
        <div class="tcm-sep"></div>
        <div class="tcm-item" data-act="sendToCC">${I('terminal', { size: 13 })} ${ftEscape(t('ft.sendToCC'))}${hasMultiSelect ? ` (${selectedPaths.size})` : ''}</div>
        <div class="tcm-sep"></div>
        <div class="tcm-item tcm-danger" data-act="delete">${I('close', { size: 13 })} ${ftEscape(t('hub.tcm.delete'))}</div>
      `;
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth) menu.style.left = `${window.innerWidth - r.width - 8}px`;
    if (r.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - r.height - 8}px`;

    const closeMenu = () => {
      document.removeEventListener('click', onOutsideClick);
      menu.remove();
    };
    const onOutsideClick = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) closeMenu();
    };

    menu.querySelectorAll('.tcm-item').forEach(item => {
      item.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const act = (item as HTMLElement).dataset.act;
        closeMenu();
        if (act === 'newFile') {
          startCreate(parentForNew, 'file');
        } else if (act === 'newFolder') {
          startCreate(parentForNew, 'folder');
        } else if (act === 'rename' && node) {
          startRename(node);
        } else if (act === 'copyPath' && node) {
          const paths = selectedPaths.size > 1 ? Array.from(selectedPaths).join('\n') : node.path;
          levis.clipboardWrite(paths);
        } else if (act === 'explorer' && node) {
          const target = node.isDirectory ? node.path : node.path.substring(0, Math.max(node.path.lastIndexOf('\\'), node.path.lastIndexOf('/')));
          levis.shellOpenPath(target);
        } else if (act === 'sendToCC' && node) {
          const paths = selectedPaths.size > 1 ? Array.from(selectedPaths) : [node.path];
          const text = paths.map(p => `"${p}"`).join(' ');
          wrapper.dispatchEvent(new CustomEvent('send-to-pty', { detail: text, bubbles: true }));
        } else if (act === 'delete' && node) {
          const paths = selectedPaths.size > 1 ? Array.from(selectedPaths) : [node.path];
          await doDelete(paths);
        }
      });
    });

    setTimeout(() => document.addEventListener('click', onOutsideClick), 0);
  }

  function applyGitBadges(): void {
    treeContainer.querySelectorAll('.file-tree-item').forEach((el) => {
      const path = (el as HTMLElement).dataset.path;
      if (!path) return;
      const isDir = el.classList.contains('ft-dir');
      const node: any = { path, isDirectory: isDir, expanded: false };
      // Mažeme jen přímé děti (scope) — zabrání zásahu do children trees
      el.querySelectorAll(':scope > .ft-git, :scope > .ft-git-dot').forEach(b => b.remove());
      const badge = getGitBadge(node);
      if (badge) {
        const tmp = document.createElement('div');
        tmp.innerHTML = badge;
        if (tmp.firstChild) el.appendChild(tmp.firstChild);
      }
    });
  }

  // Pamatuj si expandované složky pro zachování stavu při refreshi
  const expandedPaths = new Set<string>();

  function collectExpandedPaths(): void {
    expandedPaths.clear();
    treeContainer.querySelectorAll('.ft-dir').forEach(el => {
      const path = (el as HTMLElement).dataset.path;
      if (!path) return;
      const parent = el.parentElement; // .ft-node
      const children = parent?.querySelector('.ft-children') as HTMLElement;
      if (children && children.style.display !== 'none') {
        expandedPaths.add(path);
      }
    });
  }

  async function restoreExpanded(nodes: FileTreeNode[]): Promise<void> {
    for (const node of nodes) {
      if (node.isDirectory && expandedPaths.has(node.path)) {
        node.expanded = true;
        await loadChildren(node);
        if (node.children) await restoreExpanded(node.children);
      }
    }
  }

  async function renderTree(): Promise<void> {
    collectExpandedPaths();
    treeContainer.innerHTML = '';
    const raw = await levis.readDir(rootPath);
    const entries = Array.isArray(raw) ? raw : [];
    const rootNodes: FileTreeNode[] = entries.map((e: any) => ({
      name: e.name,
      path: e.path,
      isDirectory: e.isDirectory,
      children: e.isDirectory ? [] : undefined,
      expanded: false,
      loaded: false,
    }));
    rootNodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    if (expandedPaths.size > 0) await restoreExpanded(rootNodes);
    for (const node of rootNodes) {
      treeContainer.appendChild(renderNode(node, 0));
    }
    restoreSelectionVisual();
    loadGitStatus().then(applyGitBadges).catch(() => {});
  }

  // ── Keyboard shortcuts ──
  treeContainer.addEventListener('keydown', async (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      const items = getAllVisibleItems();
      for (const item of items) {
        const p = item.dataset.path;
        if (p) selectItem(p, item);
      }
    } else if (e.key === 'Delete') {
      e.preventDefault();
      if (selectedPaths.size === 0) return;
      await doDelete(Array.from(selectedPaths));
    } else if (e.key === 'F2') {
      e.preventDefault();
      const target = activePath || (selectedPaths.size === 1 ? Array.from(selectedPaths)[0] : null);
      if (!target) return;
      // Najdi node — stačí base info z DOM
      const el = treeContainer.querySelector<HTMLElement>(`.file-tree-item[data-path="${CSS.escape(target)}"]`);
      if (!el) return;
      const name = el.querySelector('.ft-name')?.textContent || '';
      const isDir = el.classList.contains('ft-dir');
      startRename({ name, path: target, isDirectory: isDir });
    }
  });

  // Pravý klik v prázdném prostoru treeu → menu s New File/Folder do rootu
  treeContainer.addEventListener('contextmenu', (e: MouseEvent) => {
    const hit = (e.target as HTMLElement).closest('.file-tree-item');
    if (hit) return; // řeší item handler
    e.preventDefault();
    showFileContextMenu(e.clientX, e.clientY, null);
  });

  // ── Header actions ──
  header.querySelector('.file-tree-refresh')!.addEventListener('click', renderTree);
  header.querySelector('.file-tree-new')!.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = e.currentTarget as HTMLElement;
    const r = btn.getBoundingClientRect();
    showFileContextMenu(r.left, r.bottom + 4, null);
  });
  header.querySelector('.file-tree-collapse-all')!.addEventListener('click', () => {
    treeContainer.querySelectorAll('.ft-children').forEach((c) => {
      (c as HTMLElement).style.display = 'none';
    });
    treeContainer.querySelectorAll('.ft-chevron').forEach((c) => {
      c.innerHTML = I('chevron-right', { size: 12 });
    });
    treeContainer.querySelectorAll('.ft-icon-folder-open').forEach((ic) => {
      ic.innerHTML = I('folder', { size: 16 });
      ic.className = 'ft-icon ft-icon-folder';
    });
  });

  await renderTree();

  // Auto-refresh git status — jen když je tree skutečně vidět (šetří IPC + CPU).
  const gitPoll = setInterval(() => {
    if (wrapper.offsetParent === null) return;
    loadGitStatus().then(applyGitBadges).catch(() => {});
  }, 6000);

  return {
    element: wrapper,
    refresh: renderTree,
    dispose: () => {
      clearInterval(gitPoll);
      wrapper.remove();
    },
  };
}

(window as any).createFileTree = createFileTree;
