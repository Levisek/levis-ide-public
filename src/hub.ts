// ── Hub View (project tiles) ────────────

const PROJECT_COLOR_PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

interface HubProjectInfo {
  name: string;
  path: string;
  domain: string;
  lastModified: string;
  gitStatus: 'clean' | 'dirty' | 'error';
  unpushedCount: number;
  changedCount?: number; // počet dirty souborů — pro ti-num-warn v kartě
  pinned?: boolean;
  projectType?: string; // detekovano na frontendu
  hasNoPreview?: boolean; // Electron, Tauri, CLI, knihovna — nic k nahledu
  language?: 'ts' | 'js'; // z tsconfig.json / package.json
  status?: 'active' | 'paused' | 'finished'; // z projectStatuses
}

const PROJECT_TYPES: Record<string, { label: string; icon: string; color: string }> = {
  expo:     { label: 'Expo',     icon: '', color: '#000020' },
  next:     { label: 'Next.js',  icon: '', color: '#9ca3af' },
  vite:     { label: 'Vite',     icon: '', color: '#ffc024' },
  react:    { label: 'React',    icon: '', color: '#61dafb' },
  svelte:   { label: 'Svelte',   icon: '', color: '#ff3e00' },
  astro:    { label: 'Astro',    icon: '', color: '#ff5d01' },
  nuxt:     { label: 'Nuxt',     icon: '', color: '#00dc82' },
  electron: { label: 'Electron', icon: '', color: '#47848f' },
  tauri:    { label: 'Tauri',    icon: '', color: '#ffc131' },
  node:     { label: 'Node',     icon: '', color: '#5fa04e' },
  php:      { label: 'PHP',      icon: '', color: '#8892bf' },
  static:   { label: 'Static',   icon: '', color: '#e34c26' },
  other:    { label: 'Ostatní',  icon: '', color: '#888' },
};

// Vraci { type, hasNoPreview, language }. Language = ts|js|undefined podle tsconfig/package.json.
async function detectProjectType(projectPath: string): Promise<{ type: string; hasNoPreview: boolean; language?: 'ts' | 'js' }> {
  // language detect — tsconfig → ts, jinak pokud je package.json → js
  let language: 'ts' | 'js' | undefined;
  try {
    const ts = await levis.readFile(projectPath + '\\tsconfig.json');
    if (typeof ts === 'string') language = 'ts';
  } catch {}

  try {
    const pkgRaw = await levis.readFile(projectPath + '\\package.json');
    if (typeof pkgRaw === 'string') {
      if (!language) language = 'js';
      const pkg = JSON.parse(pkgRaw);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.typescript && !language) language = 'ts';
      if (deps.electron) return { type: 'electron', hasNoPreview: true, language };
      if (deps['@tauri-apps/api'] || deps['@tauri-apps/cli']) return { type: 'tauri', hasNoPreview: true, language };
      if (deps.expo) return { type: 'expo', hasNoPreview: false, language };
      if (deps.next) return { type: 'next', hasNoPreview: false, language };
      if (deps.nuxt || deps['nuxt3']) return { type: 'nuxt', hasNoPreview: false, language };
      if (deps.astro) return { type: 'astro', hasNoPreview: false, language };
      if (deps.vite) return { type: 'vite', hasNoPreview: false, language };
      if (deps['@sveltejs/kit'] || deps.svelte) return { type: 'svelte', hasNoPreview: false, language };
      if (deps.react || deps['react-scripts']) return { type: 'react', hasNoPreview: false, language };
      return { type: 'node', hasNoPreview: true, language }; // CLI / knihovna — nic k preview
    }
  } catch {}
  // Tauri bez package.json (rust binary)
  try {
    const tauriConf = await levis.readFile(projectPath + '\\src-tauri\\tauri.conf.json');
    if (typeof tauriConf === 'string') return { type: 'tauri', hasNoPreview: true, language };
  } catch {}
  // Pokud neni package.json, zkus PHP / static
  try {
    const indexPhp = await levis.readFile(projectPath + '\\index.php');
    if (typeof indexPhp === 'string') return { type: 'php', hasNoPreview: false, language };
  } catch {}
  try {
    const indexHtml = await levis.readFile(projectPath + '\\index.html');
    if (typeof indexHtml === 'string') return { type: 'static', hasNoPreview: false, language };
  } catch {}
  return { type: 'other', hasNoPreview: false, language };
}

function getGreeting(): { text: string; emoji: string; weekday: string } {
  const now = new Date();
  const hour = now.getHours();
  const dayKeys = ['day.sun', 'day.mon', 'day.tue', 'day.wed', 'day.thu', 'day.fri', 'day.sat'];
  const weekday = t(dayKeys[now.getDay()]);
  if (hour < 5) return { text: t('greet.night'), emoji: '', weekday };
  if (hour < 12) return { text: t('greet.morning'), emoji: '', weekday };
  if (hour < 18) return { text: t('greet.afternoon'), emoji: '', weekday };
  if (hour < 22) return { text: t('greet.evening'), emoji: '', weekday };
  return { text: t('greet.night'), emoji: '', weekday };
}

function formatDate(isoString: string): string {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return t('date.today');
  if (diffDays === 1) return t('date.yesterday');
  if (diffDays < 7) return t('date.daysAgo', { n: diffDays });
  return d.toLocaleDateString(getLocale() === 'cs' ? 'cs-CZ' : 'en-US');
}

// Kompaktní relativní čas — "2h", "3d", "2t", "právě teď"
function formatRelative(isoString: string): string {
  if (!isoString) return '';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return t('hub.justNow');
  const min = Math.floor(sec / 60);
  if (min < 60) return t('hub.ago.min', { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('hub.ago.hour', { n: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t('hub.ago.day', { n: day });
  const week = Math.floor(day / 7);
  if (week < 52) return t('hub.ago.week', { n: week });
  return new Date(isoString).toLocaleDateString(getLocale() === 'cs' ? 'cs-CZ' : 'en-US');
}

// Kompaktní velikost bez popisku jednotky — "12.3 MB", "380 KB"
function formatSizeCompact(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function showAboutDialog(): void {
  if (document.querySelector('.about-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'about-overlay';
  overlay.innerHTML = `
    <div class="about-box">
      <button class="about-close" title="${t('settings.close')}">×</button>
      <div class="about-logo"><img src="../assets/icon.svg" alt="LevisIDE" width="72" height="72"></div>
      <h1>LevisIDE</h1>
      <div class="about-version" id="about-version">v…</div>
      <div class="about-tagline">${t('welcome.tagline')}</div>
      <div class="about-meta">
        <div><strong>${t('about.author')}:</strong> Martin Levinger</div>
        <div><strong>${t('about.github')}:</strong> <a href="https://github.com/Levisek/levis-ide" data-extlink>Levisek/levis-ide</a></div>
        <div><strong>${t('about.builtOn')}:</strong> Electron, Monaco, xterm.js, node-pty</div>
      </div>
      <div class="about-changelog">
        <h3>${t('about.changelog')}</h3>
        <div class="about-changelog-list">
          <div class="about-cl-entry"><strong>v1.3.0</strong> — ${t('about.cl13')}</div>
          <div class="about-cl-entry"><strong>v1.2.0</strong> — ${t('about.cl12')}</div>
          <div class="about-cl-entry"><strong>v1.1.0</strong> — ${t('about.cl11')}</div>
          <div class="about-cl-entry"><strong>v1.0.0</strong> — ${t('about.cl10')}</div>
        </div>
      </div>
      <div class="about-name-explainer">${t('about.nameExpl')}</div>
    </div>
  `;
  levis.getAppVersion().then((v: string) => {
    const el = overlay.querySelector('#about-version');
    if (el) el.textContent = `v${v}`;
  }).catch(() => {});
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.about-close')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('a[data-extlink]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      try { (window as any).levis?.openExternal?.((a as HTMLAnchorElement).href); } catch {}
    });
  });
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { document.removeEventListener('keydown', esc); close(); } };
  document.addEventListener('keydown', esc);
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function createTileElement(project: HubProjectInfo, onOpen: (p: HubProjectInfo) => void, onTogglePin: (p: HubProjectInfo) => void, onAction: (action: string, p: HubProjectInfo) => void, color?: string): HTMLElement {
  const I = (window as any).icon;
  const tile = document.createElement('div');
  const statusCls = project.status === 'paused' ? ' tile-paused'
                   : project.status === 'finished' ? ' tile-finished' : '';
  tile.className = 'tile' + (project.pinned ? ' tile-pinned' : '') + ((project as any).isRecent ? ' tile-recent' : '') + statusCls;
  if ((project as any).isRecent) tile.dataset.recentLabel = t('hub.recentBadge');
  if (color) {
    tile.style.borderLeftColor = color;
    tile.style.setProperty('--name-color', color);
    tile.classList.add('tile-colored');
  }
  tile.draggable = true;
  tile.dataset.projectPath = project.path;
  tile.addEventListener('dragstart', (e) => {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData('text/plain', project.path);
    e.dataTransfer.effectAllowed = 'move';
    tile.classList.add('tile-dragging');
  });
  tile.addEventListener('dragend', () => {
    tile.classList.remove('tile-dragging');
    document.querySelectorAll('.tile-drop-before, .tile-drop-after').forEach(el => el.classList.remove('tile-drop-before', 'tile-drop-after'));
  });

  // Git stats slot — unpushed = číslo+label; jinak glowing dot podle stavu
  function gitSlotHtml(): string {
    if (project.unpushedCount > 0) {
      return `<div class="ti-num ti-num-info">${project.unpushedCount}</div><div class="ti-label">${t('hub.unpushedShort')}</div>`;
    }
    let cls = 'ti-dot-muted';
    let label = t('hub.noCommit');
    if (project.gitStatus === 'dirty') { cls = 'ti-dot-warn'; label = t('hub.uncommittedShort'); }
    else if (project.gitStatus === 'clean') { cls = 'ti-dot-ok'; label = t('hub.noCommit'); }
    return `<div class="ti-dot ${cls}" title="${label}"></div>`;
  }

  // Tech chipy — framework + language
  function techChipsHtml(): string {
    const chips: string[] = [];
    const meta = project.projectType ? PROJECT_TYPES[project.projectType] : null;
    if (meta) {
      chips.push(`<span class="tile-tech-chip" style="--chip-color:${meta.color}">${meta.label}</span>`);
    }
    if (project.language) {
      chips.push(`<span class="tile-tech-chip tech-chip-lang" data-lang="${project.language}">${project.language === 'ts' ? 'TS' : 'JS'}</span>`);
    }
    return chips.join('');
  }

  const finishedBadge = project.status === 'finished' ? `<span class="tile-badge-finished" title="${t('hub.tcm.statusFinished')}">${I('check', { size: 12 })}</span>` : '';

  tile.innerHTML = `
    <div class="tile-corner">
      <button class="tile-menu" title="${t('hub.projectOptions')}">⋯</button>
    </div>
    ${finishedBadge}
    <div class="tile-header">
      <div class="tile-name">${escapeHtml(project.name)}</div>
      <div class="tile-path" title="${escapeHtml(project.path)}">${escapeHtml(project.domain || project.path)}</div>
      <div class="tile-tech">${techChipsHtml()}</div>
    </div>
    <div class="tile-stats">
      <div class="ti-slot"><div class="ti-num" data-files>—</div><div class="ti-label">${t('hub.filesCount')}</div></div>
      <div class="ti-slot"><div class="ti-num" data-size>—</div><div class="ti-label">${t('hub.size')}</div></div>
      <div class="ti-slot ti-slot-git">${gitSlotHtml()}</div>
    </div>
    <div class="tile-meta">
      <div class="tile-meta-actions">
        <button class="tile-pin ${project.pinned ? 'pinned' : ''}" title="${t(project.pinned ? 'hub.unpin' : 'hub.pin')}">${project.pinned ? '\u2605' : '\u2606'}</button>
        <button class="tile-folder" title="${t('hub.openExplorer')}">${I('folder')}</button>
      </div>
      <div class="tile-ago" title="${escapeHtml(project.lastModified)}">${formatRelative(project.lastModified)}</div>
    </div>
  `;
  tile.addEventListener('click', (e) => {
    const tgt = e.target as HTMLElement;
    if (tgt.closest('.tile-pin, .tile-folder, .tile-menu, .tile-rf')) return;
    onOpen(project);
  });
  tile.querySelector('.tile-folder')!.addEventListener('click', (e) => {
    e.stopPropagation();
    onAction('explorer', project);
  });
  tile.querySelector('.tile-pin')!.addEventListener('click', (e) => {
    e.stopPropagation();
    onTogglePin(project);
  });
  // Lazy-load velikost projektu — display číslice + label
  const filesEl = tile.querySelector('[data-files]') as HTMLElement;
  const sizeEl = tile.querySelector('[data-size]') as HTMLElement;
  if (filesEl && sizeEl) {
    levis.dirStats(project.path).then(stats => {
      if (!stats) return;
      filesEl.textContent = String(stats.files);
      sizeEl.textContent = formatSizeCompact(stats.size);
    }).catch(() => {});
  }
  function showContextMenu(x: number, y: number): void {
    document.querySelectorAll('.tile-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'tile-context-menu';
    const Ic = (window as any).icon;
    menu.innerHTML = `
      <div class="tcm-item" data-act="open">${Ic('folder')} ${t('hub.tcm.open')}</div>
      <div class="tcm-item" data-act="explorer">${Ic('folder')} ${t('hub.tcm.explorer')}</div>
      <div class="tcm-item" data-act="copyPath">${Ic('file')} ${t('hub.tcm.copyPath')}</div>
      <div class="tcm-sep"></div>
      <div class="tcm-item" data-act="rename">${Ic('editor')} ${t('hub.tcm.rename')}</div>
      <div class="tcm-item" data-act="duplicate">${Ic('file')} ${t('hub.tcm.duplicate')}</div>
      <div class="tcm-sep"></div>
      <div class="tcm-item tcm-status-trigger">${Ic('check')} ${t('hub.tcm.status')}
        <div class="tcm-status-options">
          <span class="tcm-status-opt" data-status="active">● ${t('hub.tcm.statusActive')}</span>
          <span class="tcm-status-opt" data-status="paused">◐ ${t('hub.tcm.statusPaused')}</span>
          <span class="tcm-status-opt" data-status="finished">✓ ${t('hub.tcm.statusFinished')}</span>
        </div>
      </div>
      <div class="tcm-item tcm-color-trigger" data-act="color">${Ic('palette')} ${t('hub.tcm.color')}
        <div class="tcm-color-palette">
          ${PROJECT_COLOR_PALETTE.map(c => `<span class="tcm-color-swatch" data-color="${c}" style="background:${c}"></span>`).join('')}
          <span class="tcm-color-swatch tcm-color-clear" data-color="" title="${t('hub.tcm.colorClear')}">✕</span>
        </div>
      </div>
      <div class="tcm-sep"></div>
      <div class="tcm-item tcm-danger" data-act="delete">${Ic('close')} ${t('hub.tcm.delete')}</div>
    `;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);
    // Adjust if off-screen
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth) menu.style.left = `${window.innerWidth - r.width - 10}px`;
    if (r.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - r.height - 10}px`;
    menu.querySelectorAll('.tcm-item').forEach(item => {
      if (item.classList.contains('tcm-color-trigger') || item.classList.contains('tcm-status-trigger')) return;
      item.addEventListener('click', () => {
        const act = item.getAttribute('data-act') || '';
        menu.remove();
        if (act === 'open') onOpen(project);
        else onAction(act, project);
      });
    });
    menu.querySelectorAll('.tcm-color-swatch').forEach(sw => {
      sw.addEventListener('click', (e) => {
        e.stopPropagation();
        const c = (sw as HTMLElement).dataset.color || '';
        menu.remove();
        onAction('setColor:' + c, project);
      });
    });
    menu.querySelectorAll('.tcm-status-opt').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = (opt as HTMLElement).dataset.status || 'active';
        menu.remove();
        onAction('setStatus:' + s, project);
      });
    });
    setTimeout(() => {
      const closeOnClick = (ev: MouseEvent) => {
        if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener('click', closeOnClick); }
      };
      document.addEventListener('click', closeOnClick);
    }, 0);
  }
  tile.querySelector('.tile-menu')!.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 4);
  });
  tile.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });
  return tile;
}

function createNewProjectTile(onCreateProject: () => void): HTMLElement {
  const tile = document.createElement('div');
  tile.className = 'tile tile-new';
  tile.innerHTML = `
    <div class="tile-new-icon">+</div>
    <div class="tile-new-label">${t('hub.newProject')}</div>
  `;
  tile.addEventListener('click', onCreateProject);
  return tile;
}

async function renderHub(container: HTMLElement, onOpenProject: (project: HubProjectInfo) => void): Promise<void> {
  const homeDir: string = (await levis.storeGet('homeDir')) || (await levis.getHomeDir()) || '';
  const sep = homeDir.includes('\\') ? '\\' : '/';
  let scanPath: string = (await levis.storeGet('scanPath')) || `${homeDir}${sep}dev`;

  const I = (window as any).icon;
  container.innerHTML = `
    <div class="hub">
      <div class="hub-header">
        <div class="hub-greeting">${(() => { const g = getGreeting(); return `${g.text} <span class="hub-greeting-day">· ${g.weekday}</span>`; })()}</div>
        <div class="hub-subtitle">${t('hub.subtitleLoading', { path: escapeHtml(scanPath) })}</div>
        <div class="hub-actions">
          <button class="hub-btn hub-btn-icon hub-btn-pull-all" title="${t('hub.tooltipPullAll')}">${I('download')}</button>
          <button class="hub-btn hub-btn-icon hub-btn-push-all" title="${t('hub.tooltipPushAll')}">${I('upload')}</button>
          <button class="hub-btn hub-btn-icon hub-btn-refresh" title="${t('hub.refresh')}">${I('refresh')}</button>
        </div>
      </div>
      <div class="hub-filter-bar">
        <input type="text" class="hub-search" placeholder="${t('hub.search')}">
        <div class="hub-filter-chips"></div>
      </div>
      <div class="hub-grid"></div>
      <div class="hub-legend" title="${t('hub.legend.tooltip')}">
        <span class="hub-legend-item"><span class="hub-legend-dot hub-legend-accent"></span>${t('hub.legend.unpushed')}</span>
        <span class="hub-legend-item"><span class="hub-legend-dot hub-legend-warn"></span>${t('hub.legend.changes')}</span>
        <span class="hub-legend-item"><span class="hub-legend-dot hub-legend-success"></span>${t('hub.legend.clean')}</span>
        <span class="hub-legend-item"><span class="hub-legend-dot hub-legend-pin"></span>${t('hub.legend.pinned')}</span>
        <span class="hub-legend-item"><span class="hub-legend-dot hub-legend-info"></span>${t('hub.legend.finished')}</span>
      </div>
      <div class="hub-usage" id="hub-usage"></div>
      <button class="hub-trademark" type="button" title="${t('hub.tradeTooltip')}">
        <img class="hub-tm-logo" src="../assets/icon.svg" alt="LevisIDE" width="14" height="14">
        <span class="hub-tm-text">LevisIDE™</span>
        <span class="hub-tm-version" id="hub-version">v…</span>
      </button>
    </div>
  `;

  const grid = container.querySelector('.hub-grid') as HTMLElement;
  const subtitle = container.querySelector('.hub-subtitle') as HTMLElement;
  const btnRefresh = container.querySelector('.hub-btn-refresh') as HTMLElement;
  const btnPullAll = container.querySelector('.hub-btn-pull-all') as HTMLElement;
  const btnPushAll = container.querySelector('.hub-btn-push-all') as HTMLElement;
  const btnTrademark = container.querySelector('.hub-trademark') as HTMLElement;
  btnTrademark?.addEventListener('click', showAboutDialog);

  // Dynamická verze z package.json
  levis.getAppVersion().then((v: string) => {
    const el = container.querySelector('#hub-version');
    if (el) el.textContent = `v${v}`;
  }).catch(() => {});

  btnPullAll.addEventListener('click', async () => {
    showToast(t('toast.pullingAll'), 'info');
    const projects = await levis.scanProjects(scanPath);
    let ok = 0;
    const failed: string[] = [];
    for (const p of projects) {
      try {
        const result = await levis.gitPull(p.path);
        if (result.error) failed.push(p.name); else ok++;
      } catch { failed.push(p.name); }
    }
    if (failed.length === 0) {
      showToast(t('hub.pullOkN', { n: ok }), 'success');
    } else {
      const list = failed.slice(0, 5).join(', ') + (failed.length > 5 ? ` +${failed.length - 5}` : '');
      showToast(`Pull: ${ok} OK, selhaly: ${list}`, 'warning');
    }
    loadProjects();
  });

  btnPushAll.addEventListener('click', async () => {
    showToast(t('toast.pushingAll'), 'info');
    const projects = await levis.scanProjects(scanPath);
    let ok = 0, skip = 0;
    for (const p of projects) {
      try {
        const status = await levis.gitStatus(p.path);
        if (status.current && !status.error) {
          // Has git — try push (will fail silently if no remote)
          ok++;
        } else {
          skip++;
        }
      } catch { skip++; }
    }
    showToast(t('hub.pushOkN', { ok, skip }), 'success');
  });

  async function loadProjects(): Promise<void> {
    grid.innerHTML = '';
    subtitle.textContent = t('hub.subtitleLoading', { path: scanPath });
    try {
      const projects: HubProjectInfo[] = await levis.scanProjects(scanPath);
      subtitle.textContent = `${scanPath} — ${t('hub.nProjects', { n: projects.length })}`;
      const usageHost = container.querySelector('#hub-usage') as HTMLElement;
      if (usageHost) usageHost.style.display = projects.length === 0 ? 'none' : '';
      // Načti barvy, statusy a skupiny projektů
      const projectColors: Record<string, string> = (await levis.storeGet('projectColors')) || {};
      const projectStatuses: Record<string, string> = (await levis.storeGet('projectStatuses')) || {};
      const projectOrder: string[] = (await levis.storeGet('projectOrder')) || [];
      // Načti "naposledy otevřeno" z prefs
      const lastOpened: Record<string, number> = (await levis.storeGet('projectLastOpened')) || {};
      // Pinned nahoře, pak custom pořadí (projectOrder), fallback na lastOpened/lastModified
      projects.sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        const aIdx = projectOrder.indexOf(a.path);
        const bIdx = projectOrder.indexOf(b.path);
        if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
        if (aIdx >= 0) return -1;
        if (bIdx >= 0) return 1;
        const aOpened = lastOpened[a.path] || 0;
        const bOpened = lastOpened[b.path] || 0;
        if (aOpened || bOpened) return bOpened - aOpened;
        return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
      });
      // Označ recent projekty (otevřené v posledních 7 dnech) pro vizuální styl
      const RECENT_WINDOW = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      for (const p of projects) {
        (p as any).isRecent = lastOpened[p.path] && (now - lastOpened[p.path] < RECENT_WINDOW);
        p.status = (projectStatuses[p.path] as any) || 'active';
      }

      // Detekce typu paralelne pro vsechny projekty
      await Promise.all(projects.map(async (p) => {
        const det = await detectProjectType(p.path);
        p.projectType = det.type;
        p.hasNoPreview = det.hasNoPreview;
        p.language = det.language;
      }));

      // Render filter chips dle dostupnych typu
      const types = Array.from(new Set(projects.map(p => p.projectType || 'other')));
      const chipsHost = container.querySelector('.hub-filter-chips') as HTMLElement;
      const allChip = `<button class="hub-chip hub-chip-active" data-type="all">${t('hub.allFilter', { n: projects.length })}</button>`;
      const typeChips = types.map(type => {
        const meta = PROJECT_TYPES[type] || PROJECT_TYPES.other;
        const count = projects.filter(p => p.projectType === type).length;
        const label = type === 'other' ? t('hub.typeOther') : meta.label;
        return `<button class="hub-chip" data-type="${type}">${meta.icon} ${label} (${count})</button>`;
      }).join('');
      chipsHost.innerHTML = allChip + typeChips;

      const searchInput = container.querySelector('.hub-search') as HTMLInputElement;
      let activeFilter = 'all';
      let searchQuery = '';

      function applyFilter(): void {
        grid.innerHTML = '';
        const q = searchQuery.toLowerCase().trim();
        const filtered = projects.filter(p => {
          if (activeFilter !== 'all' && p.projectType !== activeFilter) return false;
          if (q && !p.name.toLowerCase().includes(q) && !p.domain.toLowerCase().includes(q)) return false;
          return true;
        });
        if (projects.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'hub-empty hub-empty-onboard';
          empty.innerHTML = `
            <div class="hub-empty-card">
              <div class="hub-empty-icon">${I('home', { size: 40 })}</div>
              <div class="hub-empty-title">${t('welcome.title')}</div>
              <div class="hub-empty-sub">${t('hub.noProjectsTitle', { path: escapeHtml(scanPath) })}</div>
              <ol class="hub-empty-steps">
                <li><button class="hub-empty-btn" data-action="scan">${I('folder')} ${t('hub.pickFolder')}</button></li>
                <li><button class="hub-empty-btn" data-action="new">${I('plus')} ${t('hub.newProject')}</button></li>
                <li><span>${I('inspect')} ${t('welcome.tip3')}</span></li>
              </ol>
            </div>
          `;
          grid.appendChild(empty);
          empty.querySelector('[data-action="scan"]')?.addEventListener('click', () => (window as any).openHubSettings?.());
          empty.querySelector('[data-action="new"]')?.addEventListener('click', () => newProjectHandler());
          return;
        }
        if (filtered.length === 0 && projects.length > 0) {
          const empty = document.createElement('div');
          empty.className = 'hub-empty';
          empty.innerHTML = `
            <div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:#82859a;">
              <div style="margin-bottom:12px;opacity:0.6;">${I('search', { size: 40 })}</div>
              <div style="font-size:15px;color:#f1f2f8;margin-bottom:6px;">${t('hub.noFilterMatch')}</div>
              <div style="font-size:12px;">${t('hub.noFilterHint')}</div>
            </div>
          `;
          grid.appendChild(empty);
        }
        function setupGridDrop(gridEl: HTMLElement): void {
          gridEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            // Najdi nejbližší tile pro drop indicator
            gridEl.querySelectorAll('.tile-drop-before, .tile-drop-after').forEach(el => el.classList.remove('tile-drop-before', 'tile-drop-after'));
            const target = (e.target as HTMLElement).closest('.tile:not(.tile-new)') as HTMLElement;
            if (target && !target.classList.contains('tile-dragging')) {
              const rect = target.getBoundingClientRect();
              if (e.clientX < rect.left + rect.width / 2) target.classList.add('tile-drop-before');
              else target.classList.add('tile-drop-after');
            }
          });
          gridEl.addEventListener('dragleave', () => {
            gridEl.querySelectorAll('.tile-drop-before, .tile-drop-after').forEach(el => el.classList.remove('tile-drop-before', 'tile-drop-after'));
          });
          gridEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            gridEl.querySelectorAll('.tile-drop-before, .tile-drop-after').forEach(el => el.classList.remove('tile-drop-before', 'tile-drop-after'));
            const draggedPath = e.dataTransfer?.getData('text/plain');
            if (!draggedPath) return;
            const target = (e.target as HTMLElement).closest('.tile:not(.tile-new):not(.tile-dragging)') as HTMLElement;
            const targetPath = target?.dataset?.projectPath;
            if (!targetPath || draggedPath === targetPath) return;
            // Aktualizuj projectOrder
            const order: string[] = (await levis.storeGet('projectOrder')) || [];
            // Přidej všechny paths co ještě v order nejsou
            const allPaths = filtered.map(p => p.path);
            for (const p of allPaths) { if (!order.includes(p)) order.push(p); }
            // Přesuň dragged na pozici target
            const fromIdx = order.indexOf(draggedPath);
            if (fromIdx >= 0) order.splice(fromIdx, 1);
            let toIdx = order.indexOf(targetPath);
            const rect = target.getBoundingClientRect();
            if (e.clientX >= rect.left + rect.width / 2) toIdx++;
            order.splice(toIdx, 0, draggedPath);
            await levis.storeSet('projectOrder', order);
            applyFilter();
          });
        }

        function renderGroup(label: string, projects: HubProjectInfo[], collapsed?: boolean, addNewTile?: boolean): void {
          if (projects.length === 0 && !addNewTile) return;
          const header = document.createElement('div');
          header.className = 'hub-group-header' + (collapsed ? ' hub-group-collapsed' : '');
          header.innerHTML = `<span class="hub-group-chevron">▾</span> ${label} <span class="hub-group-count">${projects.length}</span>`;
          grid.appendChild(header);
          const groupGrid = document.createElement('div');
          groupGrid.className = 'hub-group-grid';
          if (collapsed) groupGrid.style.display = 'none';
          for (const project of projects) groupGrid.appendChild(createTileElement(project, onOpenProject, onTogglePin, onTileAction, projectColors[project.path]));
          if (addNewTile) groupGrid.appendChild(createNewProjectTile(newProjectHandler));
          grid.appendChild(groupGrid);
          setupGridDrop(groupGrid);
          header.addEventListener('click', () => {
            const hidden = groupGrid.style.display === 'none';
            groupGrid.style.display = hidden ? '' : 'none';
            header.classList.toggle('hub-group-collapsed', !hidden);
          });
        }

        const active = filtered.filter(p => !projectStatuses[p.path] || projectStatuses[p.path] === 'active');
        const paused = filtered.filter(p => projectStatuses[p.path] === 'paused');
        const finished = filtered.filter(p => projectStatuses[p.path] === 'finished');

        if (paused.length === 0 && finished.length === 0) {
          for (const project of active) grid.appendChild(createTileElement(project, onOpenProject, onTogglePin, onTileAction, projectColors[project.path]));
          grid.appendChild(createNewProjectTile(newProjectHandler));
          setupGridDrop(grid);
        } else {
          renderGroup(t('hub.groupActive'), active, false, true);
          renderGroup(t('hub.groupPaused'), paused, true);
          renderGroup(t('hub.groupFinished'), finished, true);
        }
      }

      async function onTileAction(action: string, p: HubProjectInfo): Promise<void> {
        if (action.startsWith('setStatus:')) {
          const status = action.slice('setStatus:'.length) as 'active' | 'paused' | 'finished';
          if (status === 'active') delete projectStatuses[p.path];
          else projectStatuses[p.path] = status;
          await levis.storeSet('projectStatuses', { ...projectStatuses });
          applyFilter();
          return;
        }
        if (action.startsWith('setColor:')) {
          const color = action.slice('setColor:'.length);
          if (color) projectColors[p.path] = color;
          else delete projectColors[p.path];
          await levis.storeSet('projectColors', { ...projectColors });
          applyFilter();
          return;
        }
        if (action === 'explorer') {
          await levis.shellOpenPath(p.path);
        } else if (action === 'copyPath') {
          levis.clipboardWrite(p.path);
          showToast(t('toast.pathCopied'), 'success');
        } else if (action === 'rename') {
          const newName = await askModal(t('hub.dialog.rename'), t('hub.dialog.renameLabel'), p.name);
          if (!newName || newName === p.name) return;
          const r = await levis.renameProject(p.path, newName);
          if (r.error) showToast(t('hub.toast.error', { msg: r.error }), 'error');
          else { showToast(t('toast.renamed'), 'success'); loadProjects(); }
        } else if (action === 'duplicate') {
          const newName = await askModal(t('hub.dialog.duplicate'), t('hub.dialog.duplicateLabel'), p.name + '-copy');
          if (!newName) return;
          showToast(t('toast.copying'), 'info');
          const r = await levis.duplicateProject(p.path, newName);
          if (r.error) showToast(t('hub.toast.error', { msg: r.error }), 'error');
          else { showToast(t('toast.duplicated'), 'success'); loadProjects(); }
        } else if (action === 'delete') {
          const confirm = await askModal(t('hub.dialog.delete'), t('hub.dialog.deleteConfirm', { name: p.name }));
          if (confirm !== p.name) {
            if (confirm !== null) showToast(t('toast.cancelledNameMismatch'), 'warning');
            return;
          }
          const r = await levis.deleteProject(p.path);
          if (r.error) showToast(t('hub.toast.error', { msg: r.error }), 'error');
          else { showToast(t('toast.deleted'), 'success'); loadProjects(); }
        }
      }

      async function onTogglePin(p: HubProjectInfo): Promise<void> {
        const nowPinned = await levis.togglePinProject(p.path);
        p.pinned = nowPinned;
        projects.sort((a, b) => {
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
          return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
        });
        applyFilter();
        showToast(t(nowPinned ? 'hub.toast.pinned' : 'hub.toast.unpinned'), 'info');
      }

      chipsHost.querySelectorAll('.hub-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          activeFilter = chip.getAttribute('data-type') || 'all';
          chipsHost.querySelectorAll('.hub-chip').forEach(c => c.classList.remove('hub-chip-active'));
          chip.classList.add('hub-chip-active');
          applyFilter();
        });
      });
      searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        applyFilter();
      });

      applyFilter();
    } catch (err) {
      subtitle.textContent = t('hub.subtitleError', { path: scanPath });
      showToast(t('toast.projectsLoadError'), 'error');
    }
  }

  async function pickTemplate(): Promise<string | null> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'template-picker-overlay';
      overlay.innerHTML = `
        <div class="template-picker-box">
          <h3>${t('hub.template.title')}</h3>
          <div class="template-picker-list">
            <button class="template-pick" data-tpl="">${t('hub.template.gral')} <span>${t('hub.template.gralDesc')}</span></button>
            <button class="template-pick" data-tpl="vitejs/vite/packages/create-vite/template-vanilla">${t('hub.template.viteJs')} <span>${t('hub.template.viteJsDesc')}</span></button>
            <button class="template-pick" data-tpl="vitejs/vite/packages/create-vite/template-vanilla-ts">${t('hub.template.viteTs')} <span>${t('hub.template.viteTsDesc')}</span></button>
            <button class="template-pick" data-tpl="vitejs/vite/packages/create-vite/template-react-ts">${t('hub.template.reactTs')} <span>${t('hub.template.reactTsDesc')}</span></button>
            <button class="template-pick" data-tpl="vitejs/vite/packages/create-vite/template-vue-ts">${t('hub.template.vueTs')} <span>${t('hub.template.vueTsDesc')}</span></button>
            <button class="template-pick" data-tpl="vitejs/vite/packages/create-vite/template-svelte-ts">${t('hub.template.svelteTs')} <span>${t('hub.template.svelteTsDesc')}</span></button>
            <button class="template-pick" data-tpl="__next__">${t('hub.template.next')} <span>${t('hub.template.nextDesc')}</span></button>
            <button class="template-pick" data-tpl="__astro__">${t('hub.template.astro')} <span>${t('hub.template.astroDesc')}</span></button>
            <button class="template-pick" data-tpl="__plain__">${t('hub.template.plain')} <span>${t('hub.template.plainDesc')}</span></button>
          </div>
          <button class="template-cancel">${t('hub.template.cancel')}</button>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.querySelectorAll('.template-pick').forEach(btn => {
        btn.addEventListener('click', () => {
          const tpl = btn.getAttribute('data-tpl') || '';
          overlay.remove();
          resolve(tpl);
        });
      });
      overlay.querySelector('.template-cancel')!.addEventListener('click', () => {
        overlay.remove();
        resolve(null);
      });
    });
  }

  async function newProjectHandler(): Promise<void> {
    const name = await askModal(t('hub.dialog.newProject'), t('hub.dialog.newProjectLabel'));
    if (!name) return;
    const tpl = await pickTemplate();
    if (tpl === null) return;
    showToast(t('toast.creatingProject'), 'info');
    const result = await levis.scaffoldProject(name, scanPath, tpl || undefined);
    if (result.error) {
      showToast(t('hub.toast.error', { msg: result.error }), 'error');
    } else {
      showToast(t('hub.toast.projectCreated', { name }), 'success');
      loadProjects();
    }
  }

  btnRefresh.addEventListener('click', loadProjects);

  function openSettingsModal(): void {
    let settingsPanel = document.body.querySelector('.settings-panel') as HTMLElement;
    if (settingsPanel) {
      settingsPanel.remove();
      return;
    }
    settingsPanel = document.createElement('div');
    settingsPanel.className = 'settings-panel';
    settingsPanel.innerHTML = `
      <div class="settings-box">
        <h3>${t('settings.title')}</h3>
        <label>${t('settings.scanPath')}:
          <input type="text" class="settings-input" id="set-scan-path" value="${scanPath}">
        </label>
        <label>${t('settings.gitName')}:
          <input type="text" class="settings-input" id="set-username" value="">
        </label>
        <label>${t('settings.gitEmail')}:
          <input type="text" class="settings-input" id="set-email" value="">
        </label>
        <label>${t('settings.editorFontSize')}:
          <input type="number" class="settings-input" id="set-editor-font" value="14" min="10" max="24">
        </label>
        <label>${t('settings.terminalFontSize')}:
          <input type="number" class="settings-input" id="set-term-font" value="13" min="10" max="24">
        </label>
        <label>${t('settings.wedosPwd')}:
          <input type="password" class="settings-input" id="set-wedos-pwd" value="" autocomplete="off" placeholder="${t('settings.wedosPlaceholder')}">
        </label>
        <label class="settings-checkbox">
          <input type="checkbox" id="set-cc-notifications" checked>
          <span>${t('settings.ccNotifications')}</span>
        </label>
        <label class="settings-checkbox">
          <input type="checkbox" id="set-cc-sound" checked>
          <span>${t('settings.ccSound')}</span>
        </label>
        <label class="settings-checkbox">
          <input type="checkbox" id="set-autostart-dev" checked>
          <span>${t('settings.autostartDev')}</span>
        </label>
        <label>
          <span>${t('settings.theme')}</span>:
          <select class="settings-input" id="set-theme">
            <option value="dark">${t('settings.theme.dark')}</option>

            <option value="mid">${t('settings.theme.mid')}</option>
            <option value="light">${t('settings.theme.light')}</option>
          </select>
        </label>
        <label>
          <span>${t('settings.language')}</span>:
          <select class="settings-input" id="set-locale">
            <option value="en">English</option>
            <option value="cs">Čeština</option>
          </select>
        </label>
        <div class="settings-actions">
          <button class="settings-save">${t('settings.save')}</button>
          <button class="settings-close">${t('settings.close')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(settingsPanel);

    // Load current values
    levis.storeGetAll().then((all: any) => {
      (settingsPanel.querySelector('#set-scan-path') as HTMLInputElement).value = all.scanPath || scanPath;
      (settingsPanel.querySelector('#set-username') as HTMLInputElement).value = all.userName || '';
      (settingsPanel.querySelector('#set-email') as HTMLInputElement).value = all.userEmail || '';
      (settingsPanel.querySelector('#set-editor-font') as HTMLInputElement).value = String(all.editorFontSize || 14);
      (settingsPanel.querySelector('#set-term-font') as HTMLInputElement).value = String(all.terminalFontSize || 13);
      (settingsPanel.querySelector('#set-wedos-pwd') as HTMLInputElement).value = all.deployDefaultPassword || '';
      (settingsPanel.querySelector('#set-cc-notifications') as HTMLInputElement).checked = all.ccNotifications !== false;
      (settingsPanel.querySelector('#set-cc-sound') as HTMLInputElement).checked = all.ccSound !== false;
      (settingsPanel.querySelector('#set-autostart-dev') as HTMLInputElement).checked = all.autostartDev !== false;
      (settingsPanel.querySelector('#set-theme') as HTMLSelectElement).value = all.theme || 'dark';
      (settingsPanel.querySelector('#set-locale') as HTMLSelectElement).value = all.locale || 'en';
    });

    settingsPanel.querySelector('.settings-save')!.addEventListener('click', async () => {
      const newScanPath = (settingsPanel.querySelector('#set-scan-path') as HTMLInputElement).value.trim();
      if (newScanPath) {
        await levis.storeSet('scanPath', newScanPath);
        scanPath = newScanPath;
      }
      await levis.storeSet('userName', (settingsPanel.querySelector('#set-username') as HTMLInputElement).value);
      await levis.storeSet('userEmail', (settingsPanel.querySelector('#set-email') as HTMLInputElement).value);
      await levis.storeSet('editorFontSize', parseInt((settingsPanel.querySelector('#set-editor-font') as HTMLInputElement).value));
      await levis.storeSet('terminalFontSize', parseInt((settingsPanel.querySelector('#set-term-font') as HTMLInputElement).value));
      await levis.storeSet('deployDefaultPassword', (settingsPanel.querySelector('#set-wedos-pwd') as HTMLInputElement).value);
      await levis.storeSet('ccNotifications', (settingsPanel.querySelector('#set-cc-notifications') as HTMLInputElement).checked);
      await levis.storeSet('ccSound', (settingsPanel.querySelector('#set-cc-sound') as HTMLInputElement).checked);
      await levis.storeSet('autostartDev', (settingsPanel.querySelector('#set-autostart-dev') as HTMLInputElement).checked);
      const newTheme = (settingsPanel.querySelector('#set-theme') as HTMLSelectElement).value;
      await levis.storeSet('theme', newTheme);
      applyTheme(newTheme);
      const newLocale = (settingsPanel.querySelector('#set-locale') as HTMLSelectElement).value as 'en' | 'cs';
      await levis.storeSet('locale', newLocale);
      setLocale(newLocale);
      showToast(t('settings.saved'), 'success');
      settingsPanel.remove();
      loadProjects();
    });

    settingsPanel.querySelector('.settings-close')!.addEventListener('click', () => settingsPanel.remove());
  }

  (window as any).openHubSettings = openSettingsModal;

  await loadProjects();
  await renderUsagePanel(container.querySelector('#hub-usage') as HTMLElement);
}

// ── Usage tracker panel ───────────────────────
// Plan limity: aproximace nakladu (USD) odpovidajici Pro / Max plan tier
// hodnoty per 5h block + per mesic. Anthropic plany neexponuji presne kvoty,
// takze tohle je hruby odhad pouzitelny jako progress bar.
const PLAN_LIMITS: Record<string, { block5h: number; month: number; label: string }> = {
  pro:    { block5h: 5,    month: 100,  label: 'Pro' },
  max5:   { block5h: 25,   month: 500,  label: 'Max 5x' },
  max20:  { block5h: 100,  month: 2000, label: 'Max 20x' },
  api:    { block5h: 9999, month: 99999, label: 'API (bez limitu)' },
};

function fmtTok(n: number): string {
  if (n >= 1_000_000) return Math.round(n / 1_000_000) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'k';
  return String(Math.round(n));
}
function fmtUsd(n: number): string {
  return '$' + n.toFixed(2);
}

async function renderUsagePanel(host: HTMLElement): Promise<void> {
  if (!host) return;
  host.innerHTML = `<div class="usage-bar usage-bar-loading">Načítám usage...</div>`;
  let plan: string = (await levis.storeGet('claudePlan')) || 'max5';
  const account = await levis.usageAccount();
  const data = await levis.usageScan();
  const realLimits = await levis.usageRateLimits(); // realna data od Claude Code (statusline dump)

  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.max5;
  const t = data.totals;
  const block5hPct = Math.round(Math.min(100, (t.block5h.cost / limits.block5h) * 100));
  const monthPct = Math.round(Math.min(100, (t.month.cost / limits.month) * 100));

  // Realna procenta od Claude Code (pokud je statusline dump dostupny)
  const rl = realLimits?.rate_limits || null;
  const cw = realLimits?.context_window || null;
  const sessionPct = rl?.five_hour?.used_percentage != null ? Math.round(rl.five_hour.used_percentage) : null;
  const weeklyPct = rl?.seven_day?.used_percentage != null ? Math.round(rl.seven_day.used_percentage) : null;
  const ctxPct = cw?.used_percentage != null ? Math.round(cw.used_percentage) : null;
  function fmtReset(epoch: number | undefined): string {
    if (!epoch) return '';
    const diff = epoch * 1000 - Date.now();
    if (diff <= 0) return 'reset teď';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `reset za ${h}h ${m}m`;
  }
  function pctColor(p: number): string {
    return p > 80 ? '#ff6a00' : p > 50 ? '#f59e0b' : '#4ade80';
  }
  const realCard = rl ? `
    <div class="usage-stat">
      <div class="usage-stat-label">Session (5h)</div>
      <div class="usage-stat-val">${sessionPct}<span class="usage-stat-pct-unit">%</span></div>
      <div class="usage-progress"><div class="usage-progress-fill" style="width:${sessionPct ?? 0}%;background:${pctColor(sessionPct ?? 0)}"></div></div>
      <div class="usage-stat-sub">${fmtReset(rl.five_hour?.resets_at)}</div>
    </div>
    <div class="usage-stat">
      <div class="usage-stat-label">Weekly</div>
      <div class="usage-stat-val">${weeklyPct}<span class="usage-stat-pct-unit">%</span></div>
      <div class="usage-progress"><div class="usage-progress-fill" style="width:${weeklyPct ?? 0}%;background:${pctColor(weeklyPct ?? 0)}"></div></div>
      <div class="usage-stat-sub">${fmtReset(rl.seven_day?.resets_at)}</div>
    </div>
    ${ctxPct !== null ? `
    <div class="usage-stat">
      <div class="usage-stat-label">${(window as any).t('usage.context')}</div>
      <div class="usage-stat-val">${ctxPct}<span class="usage-stat-pct-unit">%</span></div>
      <div class="usage-progress"><div class="usage-progress-fill" style="width:${ctxPct}%;background:${pctColor(ctxPct)}"></div></div>
      <div class="usage-stat-sub">${realLimits?.model?.display_name || ''}</div>
    </div>` : ''}
  ` : `
    <div class="usage-stat">
      <div class="usage-stat-label">${(window as any).t('usage.realLimits')}</div>
      <div class="usage-stat-val" style="font-size:11px;color:var(--text-muted)">${(window as any).t('usage.realLimitsNA')}</div>
      <div class="usage-stat-sub">${(window as any).t('usage.realLimitsSub')}</div>
    </div>
  `;

  const planOptions = Object.entries(PLAN_LIMITS).map(([k, v]) =>
    `<option value="${k}" ${k === plan ? 'selected' : ''}>${v.label}</option>`
  ).join('');

  host.innerHTML = `
    <div class="usage-bar">
      <div class="usage-bar-row">
        <div class="usage-stat">
          <div class="usage-stat-label">${(window as any).t('usage.today')}</div>
          <div class="usage-stat-val">${fmtUsd(t.today.cost)}</div>
          <div class="usage-stat-sub">${fmtTok(t.today.i + t.today.cw + t.today.cr)} in &middot; ${fmtTok(t.today.o)} out</div>
        </div>
        ${realCard}
        <div class="usage-stat">
          <div class="usage-stat-label">${(window as any).t('usage.monthEstimate')}</div>
          <div class="usage-stat-val" style="font-size:14px">${fmtUsd(t.month.cost)}</div>
          <div class="usage-stat-sub">5h: ${fmtUsd(t.block5h.cost)}</div>
        </div>
        <div class="usage-stat">
          <div class="usage-stat-label">${(window as any).t('usage.total')}</div>
          <div class="usage-stat-val">${fmtUsd(t.all.cost)}</div>
          <div class="usage-stat-sub">${(window as any).t('usage.messages', { n: t.all.count })}</div>
        </div>
        <div class="usage-stat usage-plan">
          <div class="usage-stat-label">${(window as any).t('usage.plan')}</div>
          <select class="usage-plan-select" aria-label="${(window as any).t('usage.plan')}">${planOptions}</select>
          <div class="usage-stat-sub">${account?.emailAddress ? escapeHtml(account.emailAddress) : (window as any).t('usage.notLoggedIn')}</div>
        </div>
        <button class="usage-toggle" title="${(window as any).t('hub.usageDetail')}">${(window as any).icon('arrow-down', { size: 14 })}</button>
      </div>
      <div class="usage-detail" style="display:none"></div>
    </div>
  `;

  const planSelect = host.querySelector('.usage-plan-select') as HTMLSelectElement;
  planSelect.addEventListener('change', async () => {
    await levis.storeSet('claudePlan', planSelect.value);
    renderUsagePanel(host);
  });
  // Klik na select nesmi togglovat detail
  planSelect.addEventListener('click', (e) => e.stopPropagation());

  const detail = host.querySelector('.usage-detail') as HTMLElement;
  const toggle = host.querySelector('.usage-toggle') as HTMLElement;
  const bar = host.querySelector('.usage-bar') as HTMLElement;

  function expand() {
    if (detail.style.display !== 'none') {
      detail.style.display = 'none';
      toggle.innerHTML = (window as any).icon('arrow-down', { size: 14 });
      return;
    }
    detail.style.display = 'block';
    toggle.innerHTML = (window as any).icon('arrow-up', { size: 14 });
    detail.innerHTML = renderUsageDetail(data);
  }
  toggle.addEventListener('click', (e) => { e.stopPropagation(); expand(); });
  bar.querySelector('.usage-bar-row')!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.usage-plan, .usage-toggle')) return;
    expand();
  });
}

function renderUsageDetail(data: any): string {
  const projects = Object.entries(data.perProject as Record<string, any>)
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 20);
  const maxProj = Math.max(...projects.map(p => (p[1] as any).cost), 0.0001);

  const models = Object.entries(data.perModel as Record<string, any>)
    .sort((a, b) => b[1].cost - a[1].cost);
  const maxModel = Math.max(...models.map(m => (m[1] as any).cost), 0.0001);

  // Last 14 days
  const days: Array<[string, any]> = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push([key, data.dailySeries[key] || { cost: 0, i: 0, o: 0, cw: 0, cr: 0, count: 0 }]);
  }
  const maxDay = Math.max(...days.map(d => d[1].cost), 0.0001);

  const projRows = projects.map(([name, b]) => `
    <div class="usage-row">
      <span class="usage-row-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
      <div class="usage-row-bar"><div class="usage-row-bar-fill" style="width:${(b.cost / maxProj * 100).toFixed(1)}%"></div></div>
      <span class="usage-row-val">${fmtUsd(b.cost)}</span>
    </div>
  `).join('');

  const modelRows = models.map(([name, b]) => `
    <div class="usage-row">
      <span class="usage-row-name">${escapeHtml(name)}</span>
      <div class="usage-row-bar"><div class="usage-row-bar-fill" style="width:${(b.cost / maxModel * 100).toFixed(1)}%;background:#a78bfa"></div></div>
      <span class="usage-row-val">${fmtUsd(b.cost)} &middot; ${fmtTok(b.i + b.cw + b.cr + b.o)}</span>
    </div>
  `).join('');

  const dayBars = days.map(([key, b]) => {
    const h = Math.max(2, (b.cost / maxDay) * 100);
    return `<div class="usage-day" title="${key}: ${fmtUsd(b.cost)}"><div class="usage-day-bar" style="height:${h}%"></div></div>`;
  }).join('');

  return `
    <div class="usage-detail-grid">
      <div class="usage-detail-col">
        <h4>${t('usage.last14')}</h4>
        <div class="usage-chart">${dayBars}</div>
      </div>
      <div class="usage-detail-col">
        <h4>${t('usage.models')}</h4>
        ${modelRows || `<div class="usage-empty">${t('usage.noData')}</div>`}
      </div>
      <div class="usage-detail-col usage-detail-col-wide">
        <h4>${t('hub.topProjects')}</h4>
        ${projRows || `<div class="usage-empty">${t('usage.noData')}</div>`}
      </div>
    </div>
  `;
}

// ── Custom modal (nahrazuje window.prompt) ─────
function askModal(title: string, label: string, defaultValue = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'levis-modal-overlay';
    overlay.innerHTML = `
      <div class="levis-modal">
        <div class="levis-modal-title"></div>
        <label class="levis-modal-label"></label>
        <input type="text" class="levis-modal-input">
        <div class="levis-modal-actions">
          <button class="levis-modal-cancel">${t('modal.cancel')}</button>
          <button class="levis-modal-ok">${t('modal.ok')}</button>
        </div>
      </div>
    `;
    (overlay.querySelector('.levis-modal-title') as HTMLElement).textContent = title;
    (overlay.querySelector('.levis-modal-label') as HTMLElement).textContent = label;
    const input = overlay.querySelector('.levis-modal-input') as HTMLInputElement;
    input.value = defaultValue;
    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 0);

    const close = (val: string | null) => {
      overlay.remove();
      resolve(val);
    };
    overlay.querySelector('.levis-modal-ok')!.addEventListener('click', () => close(input.value.trim() || null));
    overlay.querySelector('.levis-modal-cancel')!.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value.trim() || null);
      if (e.key === 'Escape') close(null);
    });
  });
}

(window as any).renderHub = renderHub;
