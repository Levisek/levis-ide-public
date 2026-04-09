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

async function createFileTree(
  container: HTMLElement,
  rootPath: string,
  onFileOpen: (filePath: string) => void
): Promise<FileTreeInstance> {
  const wrapper = document.createElement('div');
  wrapper.className = 'file-tree';

  const header = document.createElement('div');
  header.className = 'file-tree-header';
  header.innerHTML = `
    <span class="file-tree-title">SOUBORY</span>
    <button class="file-tree-refresh" title="Obnovit (zahrne i git status)">${(window as any).icon('refresh')}</button>
  `;
  wrapper.appendChild(header);

  const treeContainer = document.createElement('div');
  treeContainer.className = 'file-tree-content';
  wrapper.appendChild(treeContainer);
  container.appendChild(wrapper);

  const _IFT = (window as any).icon;
  const folderOpenSvg = _IFT('folder', { size: 13 });
  const folderClosedSvg = _IFT('folder', { size: 13 });
  const fileSvg = _IFT('file', { size: 13 });

  function getIcon(node: FileTreeNode): string {
    if (node.isDirectory) return node.expanded ? folderOpenSvg : folderClosedSvg;
    return fileSvg;
  }

  // ── Git status mapa: relativní cesta (forward slashes) → status code ──
  // Status: 'M' modified, 'A' added, 'D' deleted, '?' untracked, 'R' renamed, 'C' conflict
  const gitStatusMap = new Map<string, string>();
  // Cache map kterýkoli adresář obsahuje dirty soubory (pro indikaci na složkách)
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
        // Označit i všechny rodičovské adresáře jako dirty
        let dir = rel;
        while (dir.includes('/')) {
          dir = dir.substring(0, dir.lastIndexOf('/'));
          gitDirtyDirs.add(dir);
        }
      };
      // simple-git status: files = [{path, index, working_dir}]
      if (Array.isArray(status.files)) {
        for (const f of status.files) {
          // Priorita: index char, fallback working_dir
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
    node.loaded = true;
  }

  function renderNode(node: FileTreeNode, depth: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'file-tree-item';
    el.dataset.path = node.path;
    el.style.paddingLeft = `${12 + depth * 16}px`;

    const icon = getIcon(node);
    const gitBadge = getGitBadge(node);
    el.innerHTML = `
      <span class="ft-icon">${icon}</span>
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
        el.querySelector('.ft-icon')!.innerHTML = getIcon(node);
      });

      const fragment = document.createDocumentFragment();
      fragment.appendChild(el);
      fragment.appendChild(childContainer);

      const wrapper = document.createElement('div');
      wrapper.appendChild(el);
      wrapper.appendChild(childContainer);
      return wrapper;
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
        // Remove previous selection
        treeContainer.querySelectorAll('.ft-active').forEach(n => n.classList.remove('ft-active'));
        el.classList.add('ft-active');
        onFileOpen(node.path);
      });
      return el;
    }
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
    for (const node of rootNodes) {
      treeContainer.appendChild(renderNode(node, 0));
    }
    // Git status načti na pozadí, neblokuj render — když dorazí, applyne badges
    loadGitStatus().then(applyGitBadges).catch(() => {});
  }

  header.querySelector('.file-tree-refresh')!.addEventListener('click', renderTree);
  await renderTree();

  // Auto-refresh git status každých 6 s — non-blocking
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
