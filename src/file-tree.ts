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
    <span class="file-tree-title">${t('ws.files')}</span>
    <div class="file-tree-actions">
      <button class="file-tree-btn file-tree-collapse-all" title="${t('ws.collapseAll')}">${I('chevron-right', { size: 12 })}</button>
      <button class="file-tree-btn file-tree-refresh" title="${t('ws.refreshFiles')}">${I('refresh', { size: 12 })}</button>
    </div>
  `;
  wrapper.appendChild(header);

  const treeContainer = document.createElement('div');
  treeContainer.className = 'file-tree-content';
  wrapper.appendChild(treeContainer);
  container.appendChild(wrapper);

  function getFileIcon(node: FileTreeNode): { svg: string; cls: string } {
    if (node.isDirectory) {
      return node.expanded
        ? { svg: I('folder-open', { size: 14 }), cls: 'ft-icon-folder-open' }
        : { svg: I('folder', { size: 14 }), cls: 'ft-icon-folder' };
    }
    const byName = FILE_NAME_MAP[node.name];
    if (byName) return { svg: I(byName.icon, { size: 14 }), cls: byName.cls };
    const ext = getFileExt(node.name);
    const byExt = FILE_ICON_MAP[ext];
    if (byExt) return { svg: I(byExt.icon, { size: 14 }), cls: byExt.cls };
    return { svg: I('file', { size: 14 }), cls: '' };
  }

  // ── Git status mapa ──
  const gitStatusMap = new Map<string, string>();
  const gitDirtyDirs = new Set<string>();

  function pathToRel(fullPath: string): string {
    return fullPath.replace(rootPath, '').replace(/^[\\\/]+/, '').replace(/\\/g, '/');
  }

  async function loadGitStatus(): Promise<void> {
    gitStatusMap.clear();
    gitDirtyDirs.clear();
    try {
      const status: any = await (window as any).levis.gitStatus(rootPath);
      if (!status || status.error) return;
      const addEntry = (filePath: string, code: string) => {
        const rel = filePath.replace(/\\/g, '/');
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
    const rel = pathToRel(node.path);
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
    return `<span class="${cls}">${label}</span>`;
  }

  async function loadChildren(node: FileTreeNode): Promise<void> {
    if (!node.isDirectory || node.loaded) return;
    const entries = await levis.readDir(node.path);
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

    el.innerHTML = `
      ${chevron}
      <span class="ft-icon ${fileIcon.cls}">${fileIcon.svg}</span>
      <span class="ft-name">${node.name}</span>
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
        treeContainer.querySelectorAll('.ft-active').forEach(n => n.classList.remove('ft-active'));
        el.classList.add('ft-active');
        onFileOpen(node.path);
      });
      el.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        showFileContextMenu(e.clientX, e.clientY, node);
      });
      return el;
    }
  }

  function showFileContextMenu(x: number, y: number, node: FileTreeNode): void {
    document.querySelectorAll('.ft-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'ft-context-menu';
    menu.innerHTML = `
      <div class="tcm-item" data-act="rename">${I('editor', { size: 13 })} ${t('hub.tcm.rename')}</div>
      <div class="tcm-item" data-act="copyPath">${I('file', { size: 13 })} ${t('hub.tcm.copyPath')}</div>
      <div class="tcm-item" data-act="explorer">${I('folder', { size: 13 })} ${t('hub.tcm.explorer')}</div>
    `;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth) menu.style.left = `${window.innerWidth - r.width - 8}px`;
    if (r.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - r.height - 8}px`;
    menu.querySelectorAll('.tcm-item').forEach(item => {
      item.addEventListener('click', async () => {
        const act = (item as HTMLElement).dataset.act;
        menu.remove();
        if (act === 'rename') {
          // Inline rename — najdi element v tree a nahraď text inputem
          const itemEl = treeContainer.querySelector(`[data-path="${CSS.escape(node.path)}"]`);
          if (!itemEl) return;
          const nameEl = itemEl.querySelector('.ft-name') as HTMLElement;
          if (!nameEl) return;
          const oldName = node.name;
          const input = document.createElement('input');
          input.type = 'text';
          input.value = oldName;
          input.className = 'ft-rename-input';
          input.style.cssText = 'background:var(--bg-deep);border:1px solid var(--accent);color:var(--text);padding:1px 4px;font-size:12px;border-radius:3px;width:100%;outline:none;';
          nameEl.textContent = '';
          nameEl.appendChild(input);
          input.focus();
          input.select();
          const finish = async () => {
            const newName = input.value.trim();
            if (newName && newName !== oldName) {
              try {
                await levis.renameProject(node.path, newName);
                await renderTree();
              } catch { nameEl.textContent = oldName; }
            } else {
              nameEl.textContent = oldName;
            }
          };
          input.addEventListener('blur', finish);
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { input.value = oldName; input.blur(); }
          });
        } else if (act === 'copyPath') {
          levis.clipboardWrite(node.path);
        } else if (act === 'explorer') {
          levis.shellOpenPath(node.isDirectory ? node.path : node.path.substring(0, Math.max(node.path.lastIndexOf('\\'), node.path.lastIndexOf('/'))));
        }
      });
    });
    setTimeout(() => {
      const close = (ev: MouseEvent) => {
        if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener('click', close); }
      };
      document.addEventListener('click', close);
    }, 0);
  }

  function applyGitBadges(): void {
    treeContainer.querySelectorAll('.file-tree-item').forEach((el) => {
      const path = (el as HTMLElement).dataset.path;
      if (!path) return;
      const isDir = el.classList.contains('ft-dir');
      const node: any = { path, isDirectory: isDir, expanded: false };
      el.querySelectorAll('.ft-git, .ft-git-dot').forEach(b => b.remove());
      const badge = getGitBadge(node);
      if (badge) {
        const tmp = document.createElement('div');
        tmp.innerHTML = badge;
        if (tmp.firstChild) el.appendChild(tmp.firstChild);
      }
    });
  }

  async function renderTree(): Promise<void> {
    treeContainer.innerHTML = '';
    const entries = await levis.readDir(rootPath);
    const rootNodes: FileTreeNode[] = entries.map((e: any) => ({
      name: e.name,
      path: e.path,
      isDirectory: e.isDirectory,
      children: e.isDirectory ? [] : undefined,
      expanded: false,
      loaded: false,
    }));
    // Sort: dirs first, then alpha
    rootNodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    for (const node of rootNodes) {
      treeContainer.appendChild(renderNode(node, 0));
    }
    loadGitStatus().then(applyGitBadges).catch(() => {});
  }

  // ── Header actions ──
  header.querySelector('.file-tree-refresh')!.addEventListener('click', renderTree);

  header.querySelector('.file-tree-collapse-all')!.addEventListener('click', () => {
    treeContainer.querySelectorAll('.ft-children').forEach((c) => {
      (c as HTMLElement).style.display = 'none';
    });
    treeContainer.querySelectorAll('.ft-chevron').forEach((c) => {
      c.innerHTML = I('chevron-right', { size: 12 });
    });
    treeContainer.querySelectorAll('.ft-icon-folder-open').forEach((ic) => {
      ic.innerHTML = I('folder', { size: 14 });
      ic.className = 'ft-icon ft-icon-folder';
    });
  });

  await renderTree();

  // Auto-refresh git status
  const gitPoll = setInterval(() => {
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
