// ── Hub View (project tiles) ────────────

// Sortable je load-ed jako UMD <script> v index.html a vystaven na window.Sortable
declare const Sortable: any;

// Glow sweep se přehraje jen při prvním loadu a po Refresh / rescan (ne při každém přepnutí tabu)
let glowShownThisSession = false;

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
  // Node ekosystém
  expo:       { label: 'Expo',        icon: '', color: '#6366f1' },
  next:       { label: 'Next.js',     icon: '', color: '#9ca3af' },
  vite:       { label: 'Vite',        icon: '', color: '#ffc024' },
  react:      { label: 'React',       icon: '', color: '#61dafb' },
  svelte:     { label: 'Svelte',      icon: '', color: '#ff3e00' },
  astro:      { label: 'Astro',       icon: '', color: '#ff5d01' },
  nuxt:       { label: 'Nuxt',        icon: '', color: '#00dc82' },
  angular:    { label: 'Angular',     icon: '', color: '#dd0031' },
  remix:      { label: 'Remix',       icon: '', color: '#121212' },
  gatsby:     { label: 'Gatsby',      icon: '', color: '#663399' },
  nest:       { label: 'NestJS',      icon: '', color: '#e0234e' },
  electron:   { label: 'Electron',    icon: '', color: '#47848f' },
  tauri:      { label: 'Tauri',       icon: '', color: '#ffc131' },
  node:       { label: 'Node',        icon: '', color: '#5fa04e' },
  deno:       { label: 'Deno',        icon: '', color: '#70ffaf' },
  bun:        { label: 'Bun',         icon: '', color: '#fbf0df' },
  // Python
  django:     { label: 'Django',      icon: '', color: '#0c4b33' },
  flask:      { label: 'Flask',       icon: '', color: '#4b8bbe' },
  fastapi:    { label: 'FastAPI',     icon: '', color: '#009688' },
  streamlit:  { label: 'Streamlit',   icon: '', color: '#ff4b4b' },
  gradio:     { label: 'Gradio',      icon: '', color: '#ff7a00' },
  python:     { label: 'Python',      icon: '', color: '#ffd43b' },
  // PHP
  laravel:    { label: 'Laravel',     icon: '', color: '#ff2d20' },
  symfony:    { label: 'Symfony',     icon: '', color: '#000000' },
  wordpress:  { label: 'WordPress',   icon: '', color: '#21759b' },
  php:        { label: 'PHP',         icon: '', color: '#8892bf' },
  // Compiled / systémové
  go:         { label: 'Go',          icon: '', color: '#00add8' },
  rust:       { label: 'Rust',        icon: '', color: '#dea584' },
  dotnet:     { label: '.NET',        icon: '', color: '#512bd4' },
  spring:     { label: 'Spring Boot', icon: '', color: '#6db33f' },
  java:       { label: 'Java',        icon: '', color: '#f89820' },
  kotlin:     { label: 'Kotlin',      icon: '', color: '#7f52ff' },
  rails:      { label: 'Rails',       icon: '', color: '#cc0000' },
  ruby:       { label: 'Ruby',        icon: '', color: '#cc342d' },
  elixir:     { label: 'Elixir',      icon: '', color: '#4b275f' },
  phoenix:    { label: 'Phoenix',     icon: '', color: '#fd4f00' },
  crystal:    { label: 'Crystal',     icon: '', color: '#000000' },
  haskell:    { label: 'Haskell',     icon: '', color: '#5e5086' },
  ocaml:      { label: 'OCaml',       icon: '', color: '#ee6a1a' },
  zig:        { label: 'Zig',         icon: '', color: '#f7a41d' },
  nim:        { label: 'Nim',         icon: '', color: '#ffe953' },
  // SSG
  hugo:       { label: 'Hugo',        icon: '', color: '#ff4088' },
  jekyll:     { label: 'Jekyll',      icon: '', color: '#cc0000' },
  mkdocs:     { label: 'MkDocs',      icon: '', color: '#526cfe' },
  docusaurus: { label: 'Docusaurus',  icon: '', color: '#3ecc5f' },
  vitepress:  { label: 'VitePress',   icon: '', color: '#41b883' },
  // Ostatní
  docker:     { label: 'Docker',      icon: '', color: '#2496ed' },
  flutter:    { label: 'Flutter',     icon: '', color: '#02569b' },
  jupyter:    { label: 'Jupyter',     icon: '', color: '#f37626' },
  static:     { label: 'Static',      icon: '', color: '#e34c26' },
  other:      { label: 'Ostatní',     icon: '', color: '#888' },
};

// Vraci { type, hasNoPreview, language }. Language = ts|js|undefined podle tsconfig/package.json.
// Strategie: JS/TS frameworky mají přednost (package.json), pak backendy (Python/PHP/Ruby/...),
// pak compiled jazyky (Go/Rust/.NET/Java/...), pak SSG a fallback static/other.
async function detectProjectType(projectPath: string): Promise<{ type: string; hasNoPreview: boolean; language?: 'ts' | 'js' }> {
  const readMaybe = async (rel: string): Promise<string | null> => {
    try {
      const r = await levis.readFile(projectPath + '\\' + rel);
      return typeof r === 'string' ? r : null;
    } catch { return null; }
  };
  const dirFiles = async (): Promise<string[]> => {
    try {
      const entries = await levis.readDir(projectPath);
      return entries.filter(e => !e.isDirectory).map(e => e.name.toLowerCase());
    } catch { return []; }
  };

  // ── 1) Node / JS / TS ekosystém ────────────────────────────────
  let language: 'ts' | 'js' | undefined;
  const tsConf = await readMaybe('tsconfig.json');
  if (tsConf) language = 'ts';

  const pkgRaw = await readMaybe('package.json');
  if (pkgRaw) {
    try {
      if (!language) language = 'js';
      const pkg = JSON.parse(pkgRaw);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.typescript && !language) language = 'ts';
      if (deps.electron) return { type: 'electron', hasNoPreview: true, language };
      if (deps['@tauri-apps/api'] || deps['@tauri-apps/cli']) return { type: 'tauri', hasNoPreview: true, language };
      if (deps.expo) return { type: 'expo', hasNoPreview: false, language };
      if (deps['@nestjs/core']) return { type: 'nest', hasNoPreview: false, language };
      if (deps['@angular/core']) return { type: 'angular', hasNoPreview: false, language };
      if (deps['@remix-run/dev'] || deps['@remix-run/react']) return { type: 'remix', hasNoPreview: false, language };
      if (deps.gatsby) return { type: 'gatsby', hasNoPreview: false, language };
      if (deps.next) return { type: 'next', hasNoPreview: false, language };
      if (deps.nuxt || deps['nuxt3']) return { type: 'nuxt', hasNoPreview: false, language };
      if (deps.astro) return { type: 'astro', hasNoPreview: false, language };
      if (deps.vitepress) return { type: 'vitepress', hasNoPreview: false, language };
      if (deps['@docusaurus/core']) return { type: 'docusaurus', hasNoPreview: false, language };
      if (deps.vite) return { type: 'vite', hasNoPreview: false, language };
      if (deps['@sveltejs/kit'] || deps.svelte) return { type: 'svelte', hasNoPreview: false, language };
      if (deps.react || deps['react-scripts']) return { type: 'react', hasNoPreview: false, language };
      return { type: 'node', hasNoPreview: true, language };
    } catch {}
  }

  // Tauri bez package.json (rust binary)
  const tauriConf = await readMaybe('src-tauri\\tauri.conf.json');
  if (tauriConf) return { type: 'tauri', hasNoPreview: true, language };

  // Deno / Bun bez package.json
  if (await readMaybe('deno.json') || await readMaybe('deno.jsonc')) return { type: 'deno', hasNoPreview: false };
  const files = await dirFiles();
  if (files.includes('bun.lockb')) return { type: 'bun', hasNoPreview: false };

  // ── 2) Python ──────────────────────────────────────────────────
  const managePy = await readMaybe('manage.py');
  const reqTxt = await readMaybe('requirements.txt');
  const pyProject = await readMaybe('pyproject.toml');
  const appPy = await readMaybe('app.py');
  const mainPy = await readMaybe('main.py');
  const wsgiPy = await readMaybe('wsgi.py');
  const pyBlob = [(reqTxt || ''), (pyProject || '')].join('\n').toLowerCase();
  const pyImports = [(appPy || ''), (mainPy || ''), (wsgiPy || '')].join('\n');
  const pyHas = (re: RegExp): boolean => re.test(pyBlob) || re.test(pyImports.toLowerCase());

  if (managePy !== null || /\bdjango\b/.test(pyBlob)) return { type: 'django', hasNoPreview: false };
  if (pyHas(/\bfastapi\b/)) return { type: 'fastapi', hasNoPreview: false };
  if (pyHas(/\bstreamlit\b/)) return { type: 'streamlit', hasNoPreview: false };
  if (pyHas(/\bgradio\b/)) return { type: 'gradio', hasNoPreview: false };
  if (pyHas(/\bflask\b/)) return { type: 'flask', hasNoPreview: false };
  if (reqTxt !== null || pyProject !== null || appPy !== null || mainPy !== null) {
    return { type: 'python', hasNoPreview: true };
  }

  // ── 3) Ruby / PHP (framework detect přes deps) ─────────────────
  const gemfile = await readMaybe('Gemfile');
  if (gemfile) {
    const g = gemfile.toLowerCase();
    if (/\bgem\s+['"]rails['"]/.test(g)) return { type: 'rails', hasNoPreview: false };
    if (/\bgem\s+['"]jekyll['"]/.test(g)) return { type: 'jekyll', hasNoPreview: false };
    return { type: 'ruby', hasNoPreview: true };
  }

  const composer = await readMaybe('composer.json');
  if (composer) {
    try {
      const c = JSON.parse(composer);
      const req = { ...(c.require || {}), ...(c['require-dev'] || {}) };
      if (req['laravel/framework']) return { type: 'laravel', hasNoPreview: false };
      if (req['symfony/framework-bundle'] || req['symfony/symfony']) return { type: 'symfony', hasNoPreview: false };
    } catch {}
  }
  if (await readMaybe('wp-config.php')) return { type: 'wordpress', hasNoPreview: true };

  // ── 4) Compiled jazyky ─────────────────────────────────────────
  if (await readMaybe('go.mod')) return { type: 'go', hasNoPreview: true };
  if (await readMaybe('Cargo.toml')) return { type: 'rust', hasNoPreview: true };

  const pom = await readMaybe('pom.xml');
  if (pom) {
    if (/spring-boot-starter/i.test(pom)) return { type: 'spring', hasNoPreview: false };
    return { type: 'java', hasNoPreview: true };
  }
  const gradleKts = await readMaybe('build.gradle.kts');
  const gradle = await readMaybe('build.gradle');
  const gradleAny = gradleKts || gradle;
  if (gradleAny) {
    if (/spring-boot/i.test(gradleAny)) return { type: 'spring', hasNoPreview: false };
    if (gradleKts) return { type: 'kotlin', hasNoPreview: true };
    return { type: 'java', hasNoPreview: true };
  }

  const hasCsproj = files.some(f => f.endsWith('.csproj') || f.endsWith('.fsproj') || f.endsWith('.sln'));
  if (hasCsproj) return { type: 'dotnet', hasNoPreview: false };

  if (await readMaybe('mix.exs')) {
    const mix = await readMaybe('mix.exs');
    if (mix && /\bphoenix\b/i.test(mix)) return { type: 'phoenix', hasNoPreview: false };
    return { type: 'elixir', hasNoPreview: true };
  }
  if (await readMaybe('shard.yml')) return { type: 'crystal', hasNoPreview: true };
  if (await readMaybe('stack.yaml') || files.some(f => f.endsWith('.cabal'))) return { type: 'haskell', hasNoPreview: true };
  if (await readMaybe('dune-project')) return { type: 'ocaml', hasNoPreview: true };
  if (await readMaybe('build.zig')) return { type: 'zig', hasNoPreview: true };
  if (files.some(f => f.endsWith('.nimble'))) return { type: 'nim', hasNoPreview: true };

  // ── 5) Mobile / DevOps / Docs ──────────────────────────────────
  if (await readMaybe('pubspec.yaml')) return { type: 'flutter', hasNoPreview: true };
  if (await readMaybe('mkdocs.yml')) return { type: 'mkdocs', hasNoPreview: false };
  const hugoCfg = await readMaybe('config.toml') || await readMaybe('hugo.toml') || await readMaybe('hugo.yaml');
  if (hugoCfg && /baseURL\s*=|baseurl:/i.test(hugoCfg)) return { type: 'hugo', hasNoPreview: false };
  if (await readMaybe('docker-compose.yml') || await readMaybe('docker-compose.yaml') || await readMaybe('compose.yml')) {
    return { type: 'docker', hasNoPreview: true };
  }
  if (files.some(f => f.endsWith('.ipynb'))) return { type: 'jupyter', hasNoPreview: false };

  // ── 6) Static / PHP fallback ───────────────────────────────────
  if (await readMaybe('index.php')) return { type: 'php', hasNoPreview: false, language };
  if (await readMaybe('index.html')) return { type: 'static', hasNoPreview: false, language };

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

function askBillingInstallChoice(): Promise<'wrap' | 'replace' | 'cancel'> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'about-overlay';
    overlay.innerHTML = `
      <div class="about-box" style="max-width:420px;text-align:left">
        <h3 style="margin:0 0 12px">${t('settings.liveBilling')}</h3>
        <p style="color:var(--text-soft);font-size:13px;line-height:1.55;margin:0 0 16px">${t('settings.liveBillingReplaceQ')}</p>
        <div style="display:flex;gap:8px;flex-direction:column">
          <button class="settings-save" data-ch="wrap">${t('settings.liveBillingWrap')}</button>
          <button class="settings-close" data-ch="replace">${t('settings.liveBillingReplace')}</button>
          <button class="settings-close" data-ch="cancel" style="opacity:0.7">${t('settings.liveBillingCancel')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = (v: 'wrap' | 'replace' | 'cancel') => { overlay.remove(); resolve(v); };
    overlay.querySelectorAll('[data-ch]').forEach((b) => {
      b.addEventListener('click', () => close((b as HTMLElement).dataset.ch as any));
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close('cancel'); });
  });
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
        <div><strong>${t('about.builtOn')}:</strong> Electron, Monaco, xterm.js, node-pty</div>
      </div>
      <div class="about-changelog">
        <h3>${t('about.changelog')}</h3>
        <div class="about-changelog-list" id="about-changelog-list">
          <div class="about-cl-entry" style="opacity:.6">${t('about.changelogLoading')}</div>
        </div>
      </div>
      <div class="about-actions">
        <button class="about-btn-tour" id="about-reopen-tour">${t('welcome.reopenLink')}</button>
      </div>
      <div class="about-name-explainer">${t('about.nameExpl')}</div>
    </div>
  `;
  levis.getAppVersion().then((v: string) => {
    const el = overlay.querySelector('#about-version');
    if (el) el.textContent = `v${v}`;
  }).catch(() => {});
  document.body.appendChild(overlay);

  // Načti changelog dynamicky z dist/changelog.json (generuje se při buildu)
  // Top 3 entries — staré verze drží git history.
  (async () => {
    const listEl = overlay.querySelector('#about-changelog-list') as HTMLElement | null;
    if (!listEl) return;
    try {
      const res = await fetch('../dist/changelog.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { entries: Array<{ version: string; date: string; summary: string }> };
      const top = (data.entries || []).slice(0, 3);
      if (!top.length) throw new Error('empty');
      listEl.innerHTML = top.map((e) =>
        `<div class="about-cl-entry"><strong>v${escapeHtml(e.version)}</strong> <span class="about-cl-date">${escapeHtml(e.date)}</span> — ${escapeHtml(e.summary)}</div>`
      ).join('');
    } catch {
      listEl.innerHTML = `<div class="about-cl-entry" style="opacity:.6">${t('about.changelogUnavailable')}</div>`;
    }
  })();
  const close = () => overlay.remove();
  overlay.querySelector('.about-close')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#about-reopen-tour')?.addEventListener('click', () => {
    close();
    try { (window as any).reopenWelcomeTour?.(); } catch {}
  });
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
  tile.dataset.projectPath = project.path;
  // HTML5 drag v Electronu produkuje random screenshot — používáme pointer-based drag s custom ghost (viz attachTileDrag v loadProjects)
  tile.draggable = false;

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

  // Type slot — chip frameworku + jazyk (vlevo ve stats, sjednoceno s horním filter chipem)
  function typeSlotHtml(): string {
    const meta = project.projectType ? PROJECT_TYPES[project.projectType] : null;
    if (!meta) return '';
    const typeChip = `<span class="tile-type-chip" data-type="${project.projectType}" style="--chip-color:${meta.color}">${meta.label}</span>`;
    const langChip = project.language ? `<span class="tile-lang-tag" data-lang="${project.language}">${project.language === 'ts' ? 'TS' : 'JS'}</span>` : '';
    return typeChip + langChip;
  }

  tile.innerHTML = `
    <div class="tile-corner">
      <button class="tile-menu" title="${t('hub.projectOptions')}">⋯</button>
    </div>
    <div class="tile-header">
      <div class="tile-name">${escapeHtml(project.name)}</div>
      <div class="tile-path" title="${escapeHtml(project.path)}">${escapeHtml(project.domain || project.path)}</div>
    </div>
    <div class="tile-stats">
      <div class="ti-slot"><div class="ti-num" data-files>—</div><div class="ti-label">${t('hub.filesCount')}</div></div>
      <div class="ti-slot"><div class="ti-num" data-size>—</div><div class="ti-label">${t('hub.size')}</div></div>
      <div class="ti-slot ti-slot-git">${gitSlotHtml()}</div>
    </div>
    <div class="tile-meta">
      <div class="tile-meta-type">${typeSlotHtml()}</div>
      <div class="tile-meta-actions">
        <button class="tile-pin ${project.pinned ? 'pinned' : ''}" title="${t(project.pinned ? 'hub.unpin' : 'hub.pin')}">${project.pinned ? '\u2605' : '\u2606'}</button>
        <button class="tile-folder" title="${t('hub.openExplorer')}">${I('folder')}</button>
      </div>
      <div class="tile-ago" title="${escapeHtml(project.lastModified)}">${formatRelative(project.lastModified)}</div>
    </div>
  `;
  // Zneplatní drag na všech inner obrázcích/SVG — jinak by HTML5 drag vzal jen ten obrázek pod kurzorem
  tile.querySelectorAll('img, svg').forEach(el => el.setAttribute('draggable', 'false'));
  tile.addEventListener('click', (e) => {
    const tgt = e.target as HTMLElement;
    if (tgt.closest('.tile-pin, .tile-folder, .tile-menu, .tile-rf')) return;
    // Pokud tahle dlaždice právě skončila drag, klik ignoruj (suppress po reorderingu)
    if ((tile as any)._dragJustEnded) return;
    // Shift/Ctrl klik = bulk selection; standard klik = otevřít (nebo pokud je něco už vybrané, přidat tuhle taky)
    const toggle = (window as any)._hubToggleSelect as undefined | ((p: string, shift: boolean, ctrl: boolean) => void);
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (toggle) toggle(project.path, e.shiftKey, e.ctrlKey || e.metaKey);
      return;
    }
    // Pokud je selection mode aktivní (cokoli vybráno), klik bez modifikátoru výběr zruší
    if (document.querySelector('.tile-selected')) {
      (window as any)._hubClearSelection?.();
      return;
    }
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
      <div class="tcm-item" data-act="resetLaunch">${Ic('refresh')} ${t('workspace.launch.reset')}</div>
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
    // Queue microtask → listener se registruje v další frame (po synchronním bubble
    // kliku, který menu otevřel). Rychlejší a spolehlivější než setTimeout 0 —
    // bez rizika že user klikne před registrací listener-u.
    queueMicrotask(() => {
      const closeOnClick = (ev: MouseEvent) => {
        if (!menu.contains(ev.target as Node)) {
          menu.remove();
          document.removeEventListener('click', closeOnClick);
        }
      };
      document.addEventListener('click', closeOnClick);
    });
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
      </div>
      <div class="hub-filter-bar">
        <div class="hub-actions">
          <button class="hub-btn hub-btn-icon hub-btn-pull-all" title="${t('hub.tooltipPullAll')}">${I('download')}</button>
          <button class="hub-btn hub-btn-icon hub-btn-stash-all" title="${t('hub.tooltipStashAll')}">${I('archive')}</button>
          <button class="hub-btn hub-btn-icon hub-btn-refresh" title="${t('hub.refresh')}">${I('refresh')}</button>
        </div>
        <input type="text" class="hub-search" placeholder="${t('hub.search')}">
        <div class="hub-type-control">
          <button class="hub-dropdown-btn hub-type-btn" type="button">
            <span class="hub-dropdown-label">${t('hub.type.title')}</span>
            <span class="hub-dropdown-chevron">▾</span>
          </button>
          <div class="hub-dropdown hub-type-dropdown" hidden></div>
        </div>
        <div class="hub-sort-control">
          <button class="hub-dropdown-btn hub-sort-btn" type="button">
            <span class="hub-dropdown-label">${t('hub.sort.title')}</span>
            <span class="hub-dropdown-chevron">▾</span>
          </button>
          <div class="hub-dropdown hub-sort-dropdown" hidden></div>
        </div>
      </div>
      <div class="hub-bulk-bar" hidden></div>
      <div class="hub-grid"></div>
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
  const btnStashAll = container.querySelector('.hub-btn-stash-all') as HTMLElement;
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

  // Stash vše — hromadný `git stash -u` přes dirty projekty.
  // Bezpečný (reverzibilní přes `git stash pop`), nahradil dřívější "Push vše"
  // které dělalo commit+push naslepo bez diff view (= nebezpečné).
  btnStashAll.addEventListener('click', async () => {
    const confirmMsg = t('hub.stashAllConfirm');
    if (!window.confirm(confirmMsg)) return;
    showToast(t('toast.stashingAll'), 'info');
    const projects = await levis.scanProjects(scanPath);
    let stashed = 0, clean = 0;
    const failed: string[] = [];
    for (const p of projects) {
      try {
        const status: any = await levis.gitStatus(p.path);
        if (!status || status.error) continue;
        const dirty = (status.files?.length > 0)
          || (status.modified?.length > 0)
          || (status.created?.length > 0)
          || (status.not_added?.length > 0)
          || (status.deleted?.length > 0)
          || (status.renamed?.length > 0)
          || (status.staged?.length > 0);
        if (!dirty) { clean++; continue; }
        const r: any = await (levis as any).gitStash(p.path);
        if (r?.error) failed.push(p.name); else stashed++;
      } catch { /* přeskoč — není git, timeout, apod. */ }
    }
    if (failed.length === 0) {
      showToast(t('hub.stashDone', { stashed, clean }), 'success');
    } else {
      const list = failed.slice(0, 3).join(', ') + (failed.length > 3 ? ` +${failed.length - 3}` : '');
      showToast(t('hub.stashPartial', { stashed, failed: list }), 'warning');
    }
    loadProjects();
  });

  async function loadProjects(forceGlow = false): Promise<void> {
    grid.innerHTML = '';
    // Skeleton placeholdery — počet podle minulého scanu (shodný s velikostí gridu co user naposledy viděl)
    const lastCount = Number(await levis.storeGet('lastProjectCount')) || 6;
    const skelCount = Math.max(3, Math.min(lastCount, 14));
    for (let i = 0; i < skelCount; i++) {
      const skel = document.createElement('div');
      skel.className = 'tile-skel';
      grid.appendChild(skel);
    }
    subtitle.textContent = t('hub.subtitleLoading', { path: scanPath });
    try {
      const projects: HubProjectInfo[] = await levis.scanProjects(scanPath);
      // Uložit počet pro příští skeleton
      await levis.storeSet('lastProjectCount', projects.length);
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

      // Zjisti všechny typy projektů pro populaci Typ dropdownu
      const types = Array.from(new Set(projects.map(p => p.projectType || 'other')));

      const searchInput = container.querySelector('.hub-search') as HTMLInputElement;
      const typeControl = container.querySelector('.hub-type-control') as HTMLElement;
      const typeBtn = typeControl.querySelector('.hub-type-btn') as HTMLButtonElement;
      const typeBtnLabel = typeBtn.querySelector('.hub-dropdown-label') as HTMLElement;
      const typeDropdown = typeControl.querySelector('.hub-type-dropdown') as HTMLElement;
      const sortControl = container.querySelector('.hub-sort-control') as HTMLElement;
      const sortBtn = sortControl.querySelector('.hub-sort-btn') as HTMLButtonElement;
      const sortBtnLabel = sortBtn.querySelector('.hub-dropdown-label') as HTMLElement;
      const sortDropdown = sortControl.querySelector('.hub-sort-dropdown') as HTMLElement;
      const bulkBar = container.querySelector('.hub-bulk-bar') as HTMLElement;

      // Načti uložený filtr typu + sort mode + custom presety
      const savedTypes: string[] = (await levis.storeGet('hubTypeFilter')) || [];
      const activeTypes: Set<string> = new Set(savedTypes.filter(t => types.includes(t)));
      let hubSortMode: { kind: 'preset' | 'custom'; id: string; dir?: 'asc' | 'desc' } =
        (await levis.storeGet('hubSortMode')) || { kind: 'preset', id: 'modified', dir: 'desc' };
      let customPresets: Record<string, { name: string; order: string[] }> =
        (await levis.storeGet('customSortPresets')) || {};
      // Pokud je draft aktivní, použij projectOrder jako zdroj pořadí
      if (hubSortMode.kind === 'custom' && hubSortMode.id === 'draft') {
        (projects as any)._draftOrder = projectOrder.slice();
      }
      // Pokud je aktivní custom preset který byl mezitím smazán, spadni na default
      if (hubSortMode.kind === 'custom' && hubSortMode.id !== 'draft' && !customPresets[hubSortMode.id]) {
        hubSortMode = { kind: 'preset', id: 'modified', dir: 'desc' };
        await levis.storeSet('hubSortMode', hubSortMode);
      }

      let searchQuery = '';
      const selectedPaths: Set<string> = new Set();
      let lastSelectedPath: string | null = null;

      function sortProjects(list: HubProjectInfo[]): HubProjectInfo[] {
        const arr = list.slice();
        // Pinned vždy nahoře
        const pinCmp = (a: HubProjectInfo, b: HubProjectInfo) => (!!a.pinned === !!b.pinned) ? 0 : (a.pinned ? -1 : 1);
        if (hubSortMode.kind === 'custom') {
          // Custom preset nebo draft: pořadí z customPresets[id].order nebo projectOrder (draft)
          let order: string[] = [];
          if (hubSortMode.id === 'draft') {
            order = (projects as any)._draftOrder || [];
          } else {
            order = customPresets[hubSortMode.id]?.order || [];
          }
          arr.sort((a, b) => {
            const pc = pinCmp(a, b); if (pc !== 0) return pc;
            const aIdx = order.indexOf(a.path);
            const bIdx = order.indexOf(b.path);
            if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
            if (aIdx >= 0) return -1;
            if (bIdx >= 0) return 1;
            // Fallback podle názvu
            return a.name.localeCompare(b.name);
          });
          return arr;
        }
        // Preset sort
        const dir = hubSortMode.dir === 'asc' ? 1 : -1;
        arr.sort((a, b) => {
          const pc = pinCmp(a, b); if (pc !== 0) return pc;
          switch (hubSortMode.id) {
            case 'name': return a.name.localeCompare(b.name) * dir;
            case 'size': {
              const as = (a as any).sizeBytes || 0;
              const bs = (b as any).sizeBytes || 0;
              return (bs - as) * -dir; // default desc = největší nahoru
            }
            case 'type': {
              const at = a.projectType || 'other';
              const bt = b.projectType || 'other';
              return at.localeCompare(bt) * dir;
            }
            case 'modified':
            default: {
              const at = new Date(a.lastModified).getTime();
              const bt = new Date(b.lastModified).getTime();
              return (bt - at) * -dir; // default desc = čerstvé nahoru
            }
          }
        });
        return arr;
      }

      function applyFilter(): void {
        grid.innerHTML = '';
        const q = searchQuery.toLowerCase().trim();
        const filteredBase = projects.filter(p => {
          if (activeTypes.size > 0 && !activeTypes.has(p.projectType || 'other')) return false;
          if (q && !p.name.toLowerCase().includes(q) && !p.domain.toLowerCase().includes(q)) return false;
          return true;
        });
        const filtered = sortProjects(filteredBase);
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
          // SortableJS — interaktivní reorder, ostatní dlaždice se živě odsouvají, placeholder je mezera.
          // forceFallback=true obchází HTML5 drag API (které v Electronu vyrábí random screenshot ghost).
          // group 'hub-projects' → drag mezi sekcemi active/paused/finished, v onEnd nastavíme status.
          Sortable.create(gridEl, {
            group: 'hub-projects',
            animation: 170,
            easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
            forceFallback: true,
            fallbackOnBody: true,
            fallbackClass: 'tile-drag-ghost',
            // Drag začne až po 8 px pohybu — běžný click (i delší hold bez pohybu)
            // se pošle jako click a otevře projekt. Bez toho každý mousedown+microjitter
            // zahájil drag a proklik do projektu neprošel.
            fallbackTolerance: 8,
            swapThreshold: 0.6,
            delay: 0,
            ghostClass: 'tile-drag-placeholder',
            chosenClass: 'tile-drag-chosen',
            dragClass: 'tile-drag-src',
            filter: '.tile-new, .tile-pin, .tile-folder, .tile-menu, .tile-rf, button, input',
            preventOnFilter: false,
            draggable: '.tile:not(.tile-new)',
            onStart: () => { document.body.classList.add('hub-dragging'); },
            onEnd: async (evt: any) => {
              document.body.classList.remove('hub-dragging');
              const item = evt.item as HTMLElement;
              (item as any)._dragJustEnded = true;
              window.setTimeout(() => { (item as any)._dragJustEnded = false; }, 300);
              const draggedPath = item.dataset.projectPath;
              if (!draggedPath) return;

              // Cross-group drop → změna statusu (active / paused / finished)
              const fromStatus = (evt.from as HTMLElement).dataset.hubStatus;
              const toStatus = (evt.to as HTMLElement).dataset.hubStatus;
              if (toStatus && fromStatus !== toStatus) {
                const newStatus = toStatus as 'active' | 'paused' | 'finished';
                if (newStatus === 'active') delete projectStatuses[draggedPath];
                else projectStatuses[draggedPath] = newStatus;
                await levis.storeSet('projectStatuses', { ...projectStatuses });
                const proj = projects.find(p => p.path === draggedPath);
                if (proj) proj.status = newStatus;
                showToast(t('hub.toast.statusChanged', { status: t('hub.tcm.status' + newStatus[0].toUpperCase() + newStatus.slice(1)) }), 'success');
                applyFilter();
                return;
              }

              // Same-group reorder
              if (evt.oldIndex === evt.newIndex) return;
              const next = item.nextElementSibling as HTMLElement | null;
              const beforePath = next && next.classList.contains('tile') && !next.classList.contains('tile-new')
                ? (next.dataset.projectPath || null)
                : null;
              await persistReorder(draggedPath, beforePath);
            },
          });
        }

        async function persistReorder(draggedPath: string, beforePath: string | null): Promise<void> {
          // Vezmi aktuální pořadí — pokud user edituje uložený custom preset, pokračuje v něm;
          // jinak začne od projectOrder (draft)
          let order: string[];
          if (hubSortMode.kind === 'custom' && hubSortMode.id !== 'draft' && customPresets[hubSortMode.id]) {
            order = customPresets[hubSortMode.id].order.slice();
          } else {
            order = (await levis.storeGet('projectOrder')) || [];
          }
          // Doplň všechny ostatní paths aby nic nevypadlo (nové projekty po scanu)
          const allPaths = projects.map(p => p.path);
          for (const p of allPaths) { if (!order.includes(p)) order.push(p); }
          // Přesuň dragged před beforePath (nebo na konec pokud beforePath je null)
          const fromIdx = order.indexOf(draggedPath);
          if (fromIdx >= 0) order.splice(fromIdx, 1);
          if (beforePath === null) {
            order.push(draggedPath);
          } else {
            const toIdx = order.indexOf(beforePath);
            if (toIdx >= 0) order.splice(toIdx, 0, draggedPath);
            else order.push(draggedPath);
          }
          // Zapiš zpět: do presetu pokud editujem existující, nebo do projectOrder (draft)
          if (hubSortMode.kind === 'custom' && hubSortMode.id !== 'draft' && customPresets[hubSortMode.id]) {
            customPresets[hubSortMode.id].order = order;
            await levis.storeSet('customSortPresets', { ...customPresets });
          } else {
            await levis.storeSet('projectOrder', order);
            hubSortMode = { kind: 'custom', id: 'draft' };
            await levis.storeSet('hubSortMode', hubSortMode);
          }
          (projects as any)._draftOrder = order;
          renderSortDropdown();
          applyFilter();
        }

        function renderGroup(label: string, slug: 'active' | 'paused' | 'finished', projects: HubProjectInfo[], collapsed?: boolean, addNewTile?: boolean): void {
          if (projects.length === 0 && !addNewTile) return;
          const header = document.createElement('div');
          header.className = 'hub-group-header hub-group-' + slug + (collapsed ? ' hub-group-collapsed' : '');
          header.innerHTML = `<span class="hub-group-chevron">▾</span> <span class="hub-group-label">${label}</span> <span class="hub-group-count">${projects.length}</span> <span class="hub-group-line"></span>`;
          grid.appendChild(header);
          const groupGrid = document.createElement('div');
          groupGrid.className = 'hub-group-grid';
          groupGrid.dataset.hubStatus = slug;
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
          renderGroup(t('hub.groupActive'), 'active', active, false, true);
          renderGroup(t('hub.groupPaused'), 'paused', paused, true);
          renderGroup(t('hub.groupFinished'), 'finished', finished, true);
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
        } else if (action === 'resetLaunch') {
          try {
            const map = (await levis.storeGet('hubProjectLaunchChoice')) || {};
            if (map[p.path]) {
              delete map[p.path];
              await levis.storeSet('hubProjectLaunchChoice', map);
            }
            showToast(t('workspace.launch.resetDone'), 'success');
          } catch (err) {
            showToast(t('hub.toast.error', { msg: (err as any)?.message || '' }), 'error');
          }
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

      // ── Type dropdown ──
      function updateTypeBtnLabel(): void {
        if (activeTypes.size === 0) typeBtnLabel.textContent = t('hub.type.title');
        else typeBtnLabel.textContent = t('hub.type.countSelected', { n: activeTypes.size });
      }
      function renderTypeDropdown(): void {
        const rows = types.map(type => {
          const meta = PROJECT_TYPES[type] || PROJECT_TYPES.other;
          const count = projects.filter(p => (p.projectType || 'other') === type).length;
          const label = type === 'other' ? t('hub.typeOther') : meta.label;
          const isActive = activeTypes.has(type);
          return `<div class="hub-dropdown-option hub-type-opt${isActive ? ' hub-sort-opt-active' : ''}" data-type="${type}">
            <span class="hub-type-chip-inline" style="--chip-color:${meta.color}">${meta.icon}</span>
            <span class="hub-type-opt-name">${label}</span>
            <span class="hub-type-opt-count">${count}</span>
          </div>`;
        }).join('');
        typeDropdown.innerHTML = `
          <div class="hub-dropdown-header">
            <button class="hub-dropdown-reset" type="button">${t('hub.type.all')}</button>
          </div>
          <div class="hub-dropdown-body">${rows}</div>
        `;
        typeDropdown.querySelector('.hub-dropdown-reset')?.addEventListener('click', async () => {
          activeTypes.clear();
          await levis.storeSet('hubTypeFilter', []);
          renderTypeDropdown();
          updateTypeBtnLabel();
          applyFilter();
        });
        typeDropdown.querySelectorAll('.hub-type-opt').forEach(opt => {
          opt.addEventListener('click', async (e) => {
            e.stopPropagation();
            const type = (opt as HTMLElement).dataset.type!;
            if (activeTypes.has(type)) activeTypes.delete(type);
            else activeTypes.add(type);
            await levis.storeSet('hubTypeFilter', Array.from(activeTypes));
            opt.classList.toggle('hub-sort-opt-active', activeTypes.has(type));
            updateTypeBtnLabel();
            applyFilter();
          });
        });
      }
      updateTypeBtnLabel();
      renderTypeDropdown();

      // ── Sort dropdown ──
      function updateSortBtnLabel(): void {
        if (hubSortMode.kind === 'custom') {
          if (hubSortMode.id === 'draft') sortBtnLabel.textContent = t('hub.sort.draftLabel');
          else sortBtnLabel.textContent = customPresets[hubSortMode.id]?.name || t('hub.sort.title');
        } else {
          const idMap: Record<string, string> = {
            modified: t('hub.sort.modified'),
            name: t('hub.sort.name'),
            size: t('hub.sort.size'),
            type: t('hub.sort.typeKind'),
          };
          const arrow = hubSortMode.dir === 'asc' ? '↑' : '↓';
          sortBtnLabel.textContent = `${idMap[hubSortMode.id] || t('hub.sort.title')} ${arrow}`;
        }
      }
      function renderSortDropdown(): void {
        const presets: Array<{ id: string; label: string }> = [
          { id: 'modified', label: t('hub.sort.modified') },
          { id: 'name', label: t('hub.sort.name') },
          { id: 'size', label: t('hub.sort.size') },
          { id: 'type', label: t('hub.sort.typeKind') },
        ];
        const presetRows = presets.map(p => {
          const isActive = hubSortMode.kind === 'preset' && hubSortMode.id === p.id;
          const arrow = isActive ? (hubSortMode.dir === 'asc' ? '↑' : '↓') : '';
          return `<div class="hub-dropdown-option hub-sort-opt${isActive ? ' hub-sort-opt-active' : ''}" data-kind="preset" data-id="${p.id}">
            <span class="hub-sort-opt-name">${p.label}</span>
            <span class="hub-sort-opt-arrow">${arrow}</span>
          </div>`;
        }).join('');
        const customIds = Object.keys(customPresets);
        let customSection = '';
        if (customIds.length > 0) {
          const customRows = customIds.map(id => {
            const isActive = hubSortMode.kind === 'custom' && hubSortMode.id === id;
            return `<div class="hub-dropdown-option hub-sort-opt hub-sort-opt-custom${isActive ? ' hub-sort-opt-active' : ''}" data-kind="custom" data-id="${id}">
              <span class="hub-sort-opt-star">★</span>
              <span class="hub-sort-opt-name">${escapeHtml(customPresets[id].name)}</span>
              <button class="hub-sort-opt-del" data-del="${id}" title="${t('hub.sort.deletePreset')}">✕</button>
            </div>`;
          }).join('');
          customSection = `<div class="hub-dropdown-sep">${t('hub.sort.presets')}</div>${customRows}`;
        }
        const draftActive = hubSortMode.kind === 'custom' && hubSortMode.id === 'draft';
        const saveRow = draftActive
          ? `<div class="hub-dropdown-option hub-sort-save" data-action="save">${t('hub.sort.savePreset')}</div>`
          : '';
        sortDropdown.innerHTML = `
          <div class="hub-dropdown-body">
            ${presetRows}
            ${customSection}
            ${saveRow ? `<div class="hub-dropdown-sep"></div>${saveRow}` : ''}
          </div>
        `;
        // Preset klik: stejný id → toggle směr, jinak aktivuj
        sortDropdown.querySelectorAll('.hub-sort-opt[data-kind="preset"]').forEach(opt => {
          opt.addEventListener('click', async () => {
            const id = (opt as HTMLElement).dataset.id!;
            if (hubSortMode.kind === 'preset' && hubSortMode.id === id) {
              hubSortMode = { kind: 'preset', id, dir: hubSortMode.dir === 'asc' ? 'desc' : 'asc' };
            } else {
              const defaultDir: 'asc' | 'desc' = (id === 'name' || id === 'type') ? 'asc' : 'desc';
              hubSortMode = { kind: 'preset', id, dir: defaultDir };
            }
            await levis.storeSet('hubSortMode', hubSortMode);
            updateSortBtnLabel();
            renderSortDropdown();
            applyFilter();
          });
        });
        sortDropdown.querySelectorAll('.hub-sort-opt[data-kind="custom"]').forEach(opt => {
          opt.addEventListener('click', async (e) => {
            if ((e.target as HTMLElement).closest('.hub-sort-opt-del')) return;
            const id = (opt as HTMLElement).dataset.id!;
            hubSortMode = { kind: 'custom', id };
            await levis.storeSet('hubSortMode', hubSortMode);
            updateSortBtnLabel();
            renderSortDropdown();
            applyFilter();
          });
        });
        sortDropdown.querySelectorAll('.hub-sort-opt-del').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = (btn as HTMLElement).dataset.del!;
            delete customPresets[id];
            await levis.storeSet('customSortPresets', { ...customPresets });
            if (hubSortMode.kind === 'custom' && hubSortMode.id === id) {
              hubSortMode = { kind: 'preset', id: 'modified', dir: 'desc' };
              await levis.storeSet('hubSortMode', hubSortMode);
            }
            showToast(t('hub.sort.presetDeleted'), 'info');
            updateSortBtnLabel();
            renderSortDropdown();
            applyFilter();
          });
        });
        sortDropdown.querySelector('.hub-sort-save')?.addEventListener('click', async () => {
          const name = await askModal(t('hub.sort.savePreset'), t('hub.sort.presetName'), '');
          if (!name) return;
          const id = 'preset_' + Date.now().toString(36);
          const order: string[] = (projects as any)._draftOrder || (await levis.storeGet('projectOrder')) || [];
          customPresets[id] = { name: name.trim(), order: order.slice() };
          await levis.storeSet('customSortPresets', { ...customPresets });
          hubSortMode = { kind: 'custom', id };
          await levis.storeSet('hubSortMode', hubSortMode);
          sortDropdown.setAttribute('hidden', '');
          showToast(t('hub.sort.presetSaved'), 'success');
          updateSortBtnLabel();
          renderSortDropdown();
          applyFilter();
        });
      }
      updateSortBtnLabel();
      renderSortDropdown();

      // ── Dropdown open/close ──
      function closeAllDropdowns(): void {
        typeDropdown.setAttribute('hidden', '');
        sortDropdown.setAttribute('hidden', '');
      }
      typeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const was = typeDropdown.hasAttribute('hidden');
        closeAllDropdowns();
        if (was) typeDropdown.removeAttribute('hidden');
      });
      sortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const was = sortDropdown.hasAttribute('hidden');
        closeAllDropdowns();
        if (was) sortDropdown.removeAttribute('hidden');
      });
      document.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('.hub-type-control, .hub-sort-control')) closeAllDropdowns();
      });

      // ── Bulk selection ──
      function updateBulkBar(): void {
        if (selectedPaths.size === 0) {
          bulkBar.setAttribute('hidden', '');
          bulkBar.innerHTML = '';
          return;
        }
        bulkBar.removeAttribute('hidden');
        bulkBar.innerHTML = `
          <span class="hub-bulk-count">${t('hub.bulk.selected', { n: selectedPaths.size })}</span>
          <div class="hub-bulk-sep"></div>
          <button class="hub-bulk-btn" data-act="pin">${t('hub.bulk.pin')}</button>
          <button class="hub-bulk-btn" data-act="unpin">${t('hub.bulk.unpin')}</button>
          <div class="hub-bulk-dd">
            <button class="hub-bulk-btn" data-act="status">${t('hub.bulk.status')} ▾</button>
            <div class="hub-bulk-submenu" hidden>
              <div class="hub-bulk-sub-opt" data-status="active">● ${t('hub.tcm.statusActive')}</div>
              <div class="hub-bulk-sub-opt" data-status="paused">◐ ${t('hub.tcm.statusPaused')}</div>
              <div class="hub-bulk-sub-opt" data-status="finished">✓ ${t('hub.tcm.statusFinished')}</div>
            </div>
          </div>
          <button class="hub-bulk-btn" data-act="pull">${t('hub.bulk.pullAll')}</button>
          <button class="hub-bulk-btn" data-act="push">${t('hub.bulk.pushAll')}</button>
          <button class="hub-bulk-btn hub-bulk-danger" data-act="delete">${t('hub.bulk.delete')}</button>
          <div class="hub-bulk-sep"></div>
          <button class="hub-bulk-btn hub-bulk-cancel" data-act="cancel">${t('hub.bulk.cancel')} <kbd>Esc</kbd></button>
        `;
        bulkBar.querySelectorAll('.hub-bulk-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const act = (btn as HTMLElement).dataset.act;
            if (act === 'status') {
              const dd = (btn as HTMLElement).nextElementSibling as HTMLElement;
              dd?.toggleAttribute('hidden');
              e.stopPropagation();
              return;
            }
            await runBulkAction(act!);
          });
        });
        bulkBar.querySelectorAll('.hub-bulk-sub-opt').forEach(opt => {
          opt.addEventListener('click', async () => {
            const status = (opt as HTMLElement).dataset.status as 'active' | 'paused' | 'finished';
            for (const p of projects.filter(x => selectedPaths.has(x.path))) {
              if (status === 'active') delete projectStatuses[p.path];
              else projectStatuses[p.path] = status;
            }
            await levis.storeSet('projectStatuses', { ...projectStatuses });
            clearSelection();
            applyFilter();
          });
        });
      }
      function clearSelection(): void {
        selectedPaths.clear();
        lastSelectedPath = null;
        grid.querySelectorAll('.tile-selected').forEach(el => el.classList.remove('tile-selected'));
        updateBulkBar();
      }
      async function runBulkAction(act: string): Promise<void> {
        const sel = projects.filter(p => selectedPaths.has(p.path));
        if (sel.length === 0) return;
        if (act === 'cancel') { clearSelection(); return; }
        if (act === 'pin' || act === 'unpin') {
          const want = act === 'pin';
          for (const p of sel) {
            if (!!p.pinned !== want) {
              const newState = await levis.togglePinProject(p.path);
              p.pinned = newState;
            }
          }
          clearSelection();
          applyFilter();
          return;
        }
        if (act === 'pull' || act === 'push') {
          let ok = 0;
          for (const p of sel) {
            const r = act === 'pull' ? await levis.gitPull(p.path) : await levis.gitPush(p.path);
            if (!r.error) ok++;
          }
          showToast(t(act === 'pull' ? 'hub.bulk.pullDone' : 'hub.bulk.pushDone', { ok, total: sel.length }), 'info');
          clearSelection();
          applyFilter();
          return;
        }
        if (act === 'delete') {
          const names = sel.map(p => p.name).join(', ');
          const confirm = await askModal(t('hub.dialog.delete'), t('hub.bulk.deleteConfirm', { n: sel.length }) + '\n\n' + names);
          if (!confirm) return;
          for (const p of sel) await levis.deleteProject(p.path);
          clearSelection();
          loadProjects();
        }
      }
      (window as any)._hubClearSelection = clearSelection;
      (window as any)._hubToggleSelect = (path: string, shift: boolean, ctrl: boolean) => {
        if (ctrl) {
          if (selectedPaths.has(path)) selectedPaths.delete(path);
          else selectedPaths.add(path);
          lastSelectedPath = path;
        } else if (shift && lastSelectedPath) {
          // range select mezi lastSelectedPath a path v rámci aktuálního filtered+sorted pořadí
          const ordered = Array.from(grid.querySelectorAll('.tile[data-project-path]')).map(el => (el as HTMLElement).dataset.projectPath!);
          const a = ordered.indexOf(lastSelectedPath);
          const b = ordered.indexOf(path);
          if (a >= 0 && b >= 0) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            for (let i = lo; i <= hi; i++) selectedPaths.add(ordered[i]);
          }
        } else {
          selectedPaths.clear();
          selectedPaths.add(path);
          lastSelectedPath = path;
        }
        grid.querySelectorAll('.tile[data-project-path]').forEach(el => {
          const p = (el as HTMLElement).dataset.projectPath!;
          el.classList.toggle('tile-selected', selectedPaths.has(p));
        });
        updateBulkBar();
      };

      // Keyboard: Escape ukončí selection
      const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape' && selectedPaths.size > 0) clearSelection(); };
      document.addEventListener('keydown', escHandler);
      // Clean up on unmount — hub se re-renderuje přes container.innerHTML, takže listener visí.
      // Interval-based reaper: kdyby container už nebyl v DOMu, odregistrujem.
      const reaper = setInterval(() => {
        if (!document.body.contains(container)) {
          document.removeEventListener('keydown', escHandler);
          clearInterval(reaper);
        }
      }, 2000);

      searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        applyFilter();
      });

      applyFilter();

      // Glow sweep — jen při prvním otevření aplikace nebo po Refresh / změně scanPath
      if (forceGlow || !glowShownThisSession) {
        glowShownThisSession = true;
        grid.classList.add('hub-grid-revealing');
        window.setTimeout(() => grid.classList.remove('hub-grid-revealing'), 1550);
      }
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
            <button class="template-pick" data-tpl="__empty__">${t('hub.template.empty')} <span>${t('hub.template.emptyDesc')}</span></button>
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

  btnRefresh.addEventListener('click', () => loadProjects(true));

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
          <div class="settings-input-row">
            <input type="text" class="settings-input" id="set-scan-path" value="${scanPath}">
            <button type="button" class="settings-btn-browse" id="set-scan-browse" title="${t('settings.browseFolder')}">${t('settings.browseFolder')}</button>
          </div>
        </label>
        <label>${t('settings.gitName')}:
          <input type="text" class="settings-input" id="set-username" value="">
        </label>
        <label>${t('settings.gitEmail')}:
          <input type="text" class="settings-input" id="set-email" value="">
        </label>
        <div class="settings-row-grid">
          <label class="settings-label-grid">
            <span>${t('settings.editorFontSize')}:</span>
            <div class="settings-counter" data-target="set-editor-font">
              <button type="button" class="counter-btn counter-dec" aria-label="−">−</button>
              <input type="number" class="counter-input" id="set-editor-font" value="14" min="10" max="24">
              <button type="button" class="counter-btn counter-inc" aria-label="+">+</button>
            </div>
          </label>
          <label class="settings-label-grid">
            <span>${t('settings.terminalFontSize')}:</span>
            <div class="settings-counter" data-target="set-term-font">
              <button type="button" class="counter-btn counter-dec" aria-label="−">−</button>
              <input type="number" class="counter-input" id="set-term-font" value="13" min="10" max="24">
              <button type="button" class="counter-btn counter-inc" aria-label="+">+</button>
            </div>
          </label>
        </div>
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
        <div class="settings-row-grid">
          <label class="settings-label-grid">
            <span>${t('settings.theme')}:</span>
            <select class="settings-select" id="set-theme">
              <option value="dark">${t('settings.theme.dark')}</option>
              <option value="mid">${t('settings.theme.mid')}</option>
              <option value="light">${t('settings.theme.light')}</option>
            </select>
          </label>
          <label class="settings-label-grid">
            <span>${t('settings.language')}:</span>
            <select class="settings-select" id="set-locale">
              <option value="en">English</option>
              <option value="cs">Čeština</option>
            </select>
          </label>
        </div>
        <div class="settings-row">
          <span>${t('settings.desktopShortcut')}</span>
          <button class="settings-btn-shortcut" type="button">${t('settings.createShortcut')}</button>
        </div>
        <div class="settings-row" data-billing-row>
          <span>${t('settings.liveBilling')}<br><small class="settings-row-hint" data-billing-state></small></span>
          <button class="settings-btn-billing" type="button" data-billing-action="">…</button>
        </div>
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
      (settingsPanel.querySelector('#set-cc-notifications') as HTMLInputElement).checked = all.ccNotifications !== false;
      (settingsPanel.querySelector('#set-cc-sound') as HTMLInputElement).checked = all.ccSound !== false;
      (settingsPanel.querySelector('#set-autostart-dev') as HTMLInputElement).checked = all.autostartDev !== false;
      (settingsPanel.querySelector('#set-theme') as HTMLSelectElement).value = all.theme || 'mid';
      (settingsPanel.querySelector('#set-locale') as HTMLSelectElement).value = all.locale || 'en';
    });

    settingsPanel.querySelector('#set-scan-browse')?.addEventListener('click', async () => {
      try {
        const folder = await levis.openFolderDialog();
        if (folder) {
          (settingsPanel.querySelector('#set-scan-path') as HTMLInputElement).value = folder;
        }
      } catch {}
    });

    // Counter −/+ handlery pro font size inputy (settings-counter komponenty)
    settingsPanel.querySelectorAll('.settings-counter').forEach((counter) => {
      const input = counter.querySelector('.counter-input') as HTMLInputElement;
      const dec = counter.querySelector('.counter-dec') as HTMLButtonElement;
      const inc = counter.querySelector('.counter-inc') as HTMLButtonElement;
      const min = parseInt(input.min || '0', 10);
      const max = parseInt(input.max || '999', 10);
      function clamp(v: number): number { return Math.max(min, Math.min(max, v)); }
      dec.addEventListener('click', () => {
        input.value = String(clamp((parseInt(input.value, 10) || min) - 1));
      });
      inc.addEventListener('click', () => {
        input.value = String(clamp((parseInt(input.value, 10) || min) + 1));
      });
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
      closeSettings();
      loadProjects(true);
    });

    // Close helpers: × tlačítko, klik na backdrop (mimo box), ESC
    function closeSettings(): void {
      settingsPanel.remove();
      document.removeEventListener('keydown', onEscClose);
    }
    function onEscClose(e: KeyboardEvent): void {
      if (e.key === 'Escape') { e.preventDefault(); closeSettings(); }
    }
    settingsPanel.querySelector('.settings-close')!.addEventListener('click', closeSettings);
    settingsPanel.addEventListener('mousedown', (e) => {
      if (e.target === settingsPanel) closeSettings();
    });
    document.addEventListener('keydown', onEscClose);

    // Billing hook install / uninstall
    async function refreshBillingRow(): Promise<void> {
      const btn = settingsPanel.querySelector('.settings-btn-billing') as HTMLButtonElement | null;
      const stateEl = settingsPanel.querySelector('[data-billing-state]') as HTMLElement | null;
      if (!btn || !stateEl) return;
      try {
        const status = await (levis as any).billingGetHookStatus();
        if (status?.ourHookActive) {
          stateEl.textContent = t('settings.liveBillingActive');
          btn.textContent = t('settings.liveBillingUninstall');
          btn.dataset.billingAction = 'uninstall';
        } else {
          stateEl.textContent = t('settings.liveBillingInactive');
          btn.textContent = t('settings.liveBillingInstall');
          btn.dataset.billingAction = 'install';
        }
      } catch {}
    }
    refreshBillingRow();

    settingsPanel.querySelector('.settings-btn-billing')?.addEventListener('click', async () => {
      const btn = settingsPanel.querySelector('.settings-btn-billing') as HTMLButtonElement;
      const action = btn.dataset.billingAction;
      btn.disabled = true;
      try {
        if (action === 'install') {
          const status = await (levis as any).billingGetHookStatus();
          let wrapExisting = false;
          if (status?.hasOtherStatusline) {
            const choice = await askBillingInstallChoice();
            if (choice === 'cancel') { btn.disabled = false; return; }
            wrapExisting = choice === 'wrap';
          }
          const r = await (levis as any).billingInstallHook({ wrapExisting });
          if (r?.success) showToast(t('settings.liveBillingInstalled'), 'success');
          else showToast(String(r?.error || '?'), 'error');
        } else if (action === 'uninstall') {
          const r = await (levis as any).billingUninstallHook();
          if (r?.success) showToast(t('settings.liveBillingUninstalled'), 'success');
          else showToast(String(r?.error || '?'), 'error');
        }
        await refreshBillingRow();
      } finally {
        btn.disabled = false;
      }
    });

    settingsPanel.querySelector('.settings-btn-shortcut')?.addEventListener('click', async () => {
      const btn = settingsPanel.querySelector('.settings-btn-shortcut') as HTMLButtonElement;
      btn.disabled = true;
      try {
        const res = await (levis as any).createDesktopShortcut();
        if (res?.success) {
          showToast(res.dev ? t('settings.shortcutDev') : t('settings.shortcutOk'), 'success');
        } else if (res?.error === 'platform') {
          showToast(t('settings.shortcutWinOnly'), 'warning');
        } else {
          showToast(t('settings.shortcutFail', { err: res?.message || res?.error || '?' }), 'error');
        }
      } catch (e: any) {
        showToast(t('settings.shortcutFail', { err: String(e?.message || e) }), 'error');
      } finally {
        btn.disabled = false;
      }
    });
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
  const isFirstRender = !host.innerHTML || host.innerHTML.includes('usage-bar-loading');
  if (isFirstRender) {
    host.innerHTML = `<div class="usage-bar usage-bar-loading">Načítám usage...</div>`;
  }
  let plan: string = (await levis.storeGet('claudePlan')) || 'max5';
  // Billing/usage panel je na startu Hubu vždycky složený, user ho v rámci session může rozbalit
  let collapsed: boolean = true;
  const account = await levis.usageAccount();
  const data = await levis.usageScan();
  const realLimits = await levis.usageRateLimits();

  // Skip re-render pokud se relevantní metriky nezměnily (statusline dump píše soubor i když
  // se čísla nehnula — jen capturedAt se posouvá → zbytečný flicker v Hubu).
  // POZN: data.totals má strukturu { all, today, month, block5h, week }, sahat přímo na .cost
  // nebo .tokens by dalo undefined → hash by byl vždy stejný a render skipl vše po prvním cyklu.
  const rl0 = realLimits?.rate_limits;
  const cw0 = realLimits?.context_window;
  const tokSum = (b: any) => (b?.i || 0) + (b?.o || 0) + (b?.cw || 0) + (b?.cr || 0);
  const currentHash = JSON.stringify({
    allCost: data?.totals?.all?.cost,
    allTok: tokSum(data?.totals?.all),
    todayCost: data?.totals?.today?.cost,
    block5hCost: data?.totals?.block5h?.cost,
    fiveHUsed: rl0?.five_hour?.used,
    sevenDUsed: rl0?.seven_day?.used,
    ctxLeft: cw0?.tokens_left,
    plan,
  });
  if (!isFirstRender && (host as any)._usageDataHash === currentHash) return;
  (host as any)._usageDataHash = currentHash;

  const tot = data.totals;

  // Realna procenta od Claude Code (pokud je statusline dump dostupny)
  const rl = realLimits?.rate_limits || null;
  const cw = realLimits?.context_window || null;
  const nowMs = Date.now();
  // capturedAt — může být number (ms) nebo ISO string
  const capturedMs = typeof realLimits?.capturedAt === 'number'
    ? realLimits.capturedAt
    : (realLimits?.capturedAt ? Date.parse(realLimits.capturedAt) : 0);
  const captureAgeMs = capturedMs ? nowMs - capturedMs : Infinity;
  // Stale: snapshot je z doby před resetem NEBO starší než 1 hodina (dump hook nefunguje)
  const sessionResetMs = rl?.five_hour?.resets_at ? rl.five_hour.resets_at * 1000 : 0;
  const weeklyResetMs = rl?.seven_day?.resets_at ? rl.seven_day.resets_at * 1000 : 0;
  const sessionStale = (sessionResetMs > 0 && sessionResetMs < nowMs && capturedMs < sessionResetMs)
                    || captureAgeMs > 60 * 60 * 1000;
  const weeklyStale  = (weeklyResetMs  > 0 && weeklyResetMs  < nowMs && capturedMs < weeklyResetMs)
                    || captureAgeMs > 60 * 60 * 1000;

  // Anthropic přesná procenta
  const sessionPctReal = !sessionStale && rl?.five_hour?.used_percentage != null ? Math.round(rl.five_hour.used_percentage) : null;
  const weeklyPctReal  = !weeklyStale  && rl?.seven_day?.used_percentage != null ? Math.round(rl.seven_day.used_percentage) : null;

  // Fallback: lokální odhad z transcripts (block5h / week bucket vůči plan limitům v USD)
  const planMeta = PLAN_LIMITS[plan] || PLAN_LIMITS.max5;
  const block5hCost = tot.block5h?.cost || 0;
  const weekCost = (tot as any).week?.cost || tot.month.cost; // fallback na month pro starý build
  const sessionPctEst = planMeta.block5h > 0 ? Math.min(100, Math.round((block5hCost / planMeta.block5h) * 100)) : 0;
  const weeklyPctEst  = planMeta.month   > 0 ? Math.min(100, Math.round((weekCost   / (planMeta.month * 7 / 30)) * 100)) : 0;

  // Výsledné hodnoty: preferuj Anthropic, jinak odhad; null jen pokud nemáme vůbec nic
  const sessionPct = sessionPctReal ?? sessionPctEst;
  const weeklyPct  = weeklyPctReal  ?? weeklyPctEst;
  const sessionEst = sessionPctReal === null; // true = zobrazujeme odhad, ne Anthropic
  const weeklyEst  = weeklyPctReal  === null;

  const ctxPct = cw?.used_percentage != null ? Math.round(cw.used_percentage) : null;
  function fmtAge(ms: number): string {
    if (!ms) return '';
    const diff = Date.now() - ms;
    if (diff < 60_000) return 'teď';
    const m = Math.floor(diff / 60_000);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  function fmtReset(epoch: number | undefined): string {
    if (!epoch) return '';
    const diff = epoch * 1000 - Date.now();
    if (diff <= 0) return 'po resetu — spusť CC';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `reset za ${h}h ${m}m`;
  }
  function pctColor(p: number): string {
    return p > 80 ? '#ff6a00' : p > 50 ? '#f59e0b' : '#4ade80';
  }
  function hbarHtml(pct: number | null, color: string): string {
    const p = pct ?? 0;
    return `<div class="usage-progress"><div class="usage-progress-fill" style="width:${p}%;background:${color}"></div></div>`;
  }

  const sessColor = pctColor(sessionPct ?? 0);
  const weekColor = pctColor(weeklyPct ?? 0);
  const ctxColor  = pctColor(ctxPct ?? 0);
  // Mini indikátory — label + bar + procenta. Pokud jde o lokální odhad (bez Anthropic dumpu),
  // prefix '~' a tooltip vysvětlí, že je to odhad podle tvého plánu.
  const sessMark = sessionEst ? '~' : '';
  const weekMark = weeklyEst ? '~' : '';
  const estTip = t('usage.estTip');
  const miniPillsHtml = `
    <span class="usage-pill" title="Session (5h): ${sessMark}${sessionPct}%${sessionEst ? estTip : ''}">
      <span class="usage-pill-label">Session</span>
      <span class="usage-pill-bar"><span class="usage-pill-fill" style="width:${sessionPct}%;background:${sessColor}"></span></span>
      <strong>${sessMark}${sessionPct}%</strong>
    </span>
    <span class="usage-pill" title="Weekly: ${weekMark}${weeklyPct}%${weeklyEst ? estTip : ''}">
      <span class="usage-pill-label">Weekly</span>
      <span class="usage-pill-bar"><span class="usage-pill-fill" style="width:${weeklyPct}%;background:${weekColor}"></span></span>
      <strong>${weekMark}${weeklyPct}%</strong>
    </span>
    <span class="usage-pill" title="Context: ${ctxPct ?? '—'}%">
      <span class="usage-pill-label">Context</span>
      <span class="usage-pill-bar"><span class="usage-pill-fill" style="width:${ctxPct ?? 0}%;background:${ctxColor}"></span></span>
      <strong>${ctxPct ?? '—'}%</strong>
    </span>
  `;

  const ageStr = capturedMs ? t('usage.liveDumpAge', { age: fmtAge(capturedMs) }) : t('usage.liveDumpNa');
  const sessionSub = sessionEst
    ? t('usage.estSub', { plan: planMeta.label, used: fmtUsd(block5hCost), limit: fmtUsd(planMeta.block5h) })
    : fmtReset(rl?.five_hour?.resets_at);
  const weeklySub = weeklyEst
    ? t('usage.estSub', { plan: planMeta.label, used: fmtUsd(weekCost), limit: fmtUsd(planMeta.month * 7 / 30) })
    : fmtReset(rl?.seven_day?.resets_at);
  const estTag = (on: boolean) => on ? ` <span class="usage-est-tag" title="${t('usage.liveSyncOff')}">~</span>` : '';
  const realCard = `
    <div class="usage-stat">
      <div class="usage-stat-label">Session (5h)${estTag(sessionEst)}</div>
      <div class="usage-stat-val">${sessMark}${sessionPct}<span class="usage-stat-pct-unit">%</span></div>
      ${hbarHtml(sessionPct, sessColor)}
      <div class="usage-stat-sub">${sessionSub}</div>
    </div>
    <div class="usage-stat">
      <div class="usage-stat-label">Weekly${estTag(weeklyEst)}</div>
      <div class="usage-stat-val">${weekMark}${weeklyPct}<span class="usage-stat-pct-unit">%</span></div>
      ${hbarHtml(weeklyPct, weekColor)}
      <div class="usage-stat-sub">${weeklySub}</div>
    </div>
    ${ctxPct !== null ? `
    <div class="usage-stat">
      <div class="usage-stat-label">${(window as any).t('usage.context')}</div>
      <div class="usage-stat-val">${ctxPct}<span class="usage-stat-pct-unit">%</span></div>
      ${hbarHtml(ctxPct, ctxColor)}
      <div class="usage-stat-sub">${realLimits?.model?.display_name || ''}</div>
    </div>` : ''}
  `;

  const planOptions = Object.entries(PLAN_LIMITS).map(([k, v]) =>
    `<option value="${k}" ${k === plan ? 'selected' : ''}>${v.label}</option>`
  ).join('');

  const miniCost = `${fmtUsd(tot.today.cost)} dnes · ${fmtUsd(tot.month.cost)} měs`;

  host.innerHTML = `
    <div class="usage-bar ${collapsed ? '' : 'usage-bar-expanded'}">
      <div class="usage-mini" title="${ageStr}${sessionStale || weeklyStale ? ' — reset proběhl, pusť jakýkoli CC request pro aktualizaci' : ''}">
        <span class="usage-mini-label">Usage</span>
        <span class="usage-mini-pills">${miniPillsHtml}</span>
        <span class="usage-mini-cost">${miniCost}</span>
        <button class="usage-expand" title="${(window as any).t('hub.usageDetail')}" aria-expanded="${!collapsed}">${(window as any).icon('arrow-down', { size: 14 })}</button>
      </div>
      <div class="usage-full" ${collapsed ? 'hidden' : ''}>
        <div class="usage-bar-row">
          <div class="usage-stat">
            <div class="usage-stat-label">${(window as any).t('usage.today')}</div>
            <div class="usage-stat-val">${fmtUsd(tot.today.cost)}</div>
            <div class="usage-stat-sub">${fmtTok(tot.today.i + tot.today.cw + tot.today.cr)} in &middot; ${fmtTok(tot.today.o)} out</div>
          </div>
          ${realCard}
          <div class="usage-stat">
            <div class="usage-stat-label">${(window as any).t('usage.monthEstimate')}</div>
            <div class="usage-stat-val" style="font-size:14px">${fmtUsd(tot.month.cost)}</div>
            <div class="usage-stat-sub">5h: ${fmtUsd(tot.block5h.cost)}</div>
          </div>
          <div class="usage-stat">
            <div class="usage-stat-label">${(window as any).t('usage.total')}</div>
            <div class="usage-stat-val">${fmtUsd(tot.all.cost)}</div>
            <div class="usage-stat-sub">${(window as any).t('usage.messages', { n: tot.all.count })}</div>
          </div>
          <div class="usage-stat usage-plan">
            <div class="usage-stat-label">${(window as any).t('usage.plan')}</div>
            <select class="usage-plan-select" aria-label="${(window as any).t('usage.plan')}">${planOptions}</select>
            <div class="usage-stat-sub">${account?.emailAddress ? escapeHtml(account.emailAddress) : (window as any).t('usage.notLoggedIn')}</div>
          </div>
        </div>
        <div class="usage-detail"></div>
      </div>
    </div>
  `;

  const planSelect = host.querySelector('.usage-plan-select') as HTMLSelectElement | null;
  if (planSelect) {
    planSelect.addEventListener('change', async () => {
      await levis.storeSet('claudePlan', planSelect.value);
      renderUsagePanel(host);
    });
    planSelect.addEventListener('click', (e) => e.stopPropagation());
  }

  const bar = host.querySelector('.usage-bar') as HTMLElement;
  const mini = host.querySelector('.usage-mini') as HTMLElement;
  const full = host.querySelector('.usage-full') as HTMLElement;
  const detailHost = host.querySelector('.usage-detail') as HTMLElement;
  const expandBtn = host.querySelector('.usage-expand') as HTMLElement;

  async function toggleCollapse(): Promise<void> {
    collapsed = !collapsed;
    // Stav NEukládáme — usage panel se vždy startuje složený
    bar.classList.toggle('usage-bar-expanded', !collapsed);
    if (collapsed) {
      full.setAttribute('hidden', '');
      expandBtn.setAttribute('aria-expanded', 'false');
    } else {
      full.removeAttribute('hidden');
      expandBtn.setAttribute('aria-expanded', 'true');
      if (detailHost && !detailHost.innerHTML) detailHost.innerHTML = renderUsageDetail(data);
    }
  }

  mini.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.usage-expand')) return;
    toggleCollapse();
  });
  expandBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapse(); });

  // Pokud byl panel rozbalený z předchozí session, rovnou dorenderuj detail
  if (!collapsed && detailHost && !detailHost.innerHTML) {
    detailHost.innerHTML = renderUsageDetail(data);
  }

  // ── Live update: watch ~/.claude/levis-usage.json přes IPC ──
  // Při každém zápisu (statusline-dump po CC requestu) re-renderuje panel.
  // Guard: zrušit předchozí subscribe, aby nám nerostly vrstvy listenerů.
  const prevUnsub: (() => void) | null = (host as any)._usageUnsub || null;
  if (prevUnsub) { try { prevUnsub(); } catch {} }
  const unsub = (levis as any).onUsageUpdated?.(() => {
    // Debounce 1500 ms — statusline dump může psát soubor často, i když se
    // reálná čísla nehnula. Uvnitř renderUsagePanel navíc hash check skipne render,
    // pokud se metriky nezměnily.
    window.clearTimeout((host as any)._usageRenderTo);
    (host as any)._usageRenderTo = window.setTimeout(() => { renderUsagePanel(host); }, 1500);
  });
  (host as any)._usageUnsub = unsub;
}

function renderUsageDetail(data: any): string {
  const projects = Object.entries(data.perProject as Record<string, any>)
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 10);
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
