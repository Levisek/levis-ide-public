// ── Hub View (project tiles) ────────────

interface HubProjectInfo {
  name: string;
  path: string;
  domain: string;
  lastModified: string;
  gitStatus: 'clean' | 'dirty' | 'error';
  unpushedCount: number;
  pinned?: boolean;
  projectType?: string; // detekovano na frontendu
  hasNoPreview?: boolean; // Electron, Tauri, CLI, knihovna — nic k nahledu
}

const PROJECT_TYPES: Record<string, { label: string; icon: string }> = {
  expo:     { label: 'Expo',     icon: '' },
  next:     { label: 'Next.js',  icon: '' },
  vite:     { label: 'Vite',     icon: '' },
  react:    { label: 'React',    icon: '' },
  svelte:   { label: 'Svelte',   icon: '' },
  astro:    { label: 'Astro',    icon: '' },
  nuxt:     { label: 'Nuxt',     icon: '' },
  electron: { label: 'Electron', icon: '' },
  tauri:    { label: 'Tauri',    icon: '' },
  node:     { label: 'Node',     icon: '' },
  php:      { label: 'PHP',      icon: '' },
  static:   { label: 'Static',   icon: '' },
  other:    { label: 'Ostatní',  icon: '' },
};

// Vraci [type, hasNoPreview]. Non-preview = Electron, Tauri, CLI/knihovna (Node bez webove deps).
async function detectProjectType(projectPath: string): Promise<{ type: string; hasNoPreview: boolean }> {
  try {
    const pkgRaw = await levis.readFile(projectPath + '\\package.json');
    if (typeof pkgRaw === 'string') {
      const pkg = JSON.parse(pkgRaw);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.electron) return { type: 'electron', hasNoPreview: true };
      if (deps['@tauri-apps/api'] || deps['@tauri-apps/cli']) return { type: 'tauri', hasNoPreview: true };
      if (deps.expo) return { type: 'expo', hasNoPreview: false };
      if (deps.next) return { type: 'next', hasNoPreview: false };
      if (deps.nuxt || deps['nuxt3']) return { type: 'nuxt', hasNoPreview: false };
      if (deps.astro) return { type: 'astro', hasNoPreview: false };
      if (deps.vite) return { type: 'vite', hasNoPreview: false };
      if (deps['@sveltejs/kit'] || deps.svelte) return { type: 'svelte', hasNoPreview: false };
      if (deps.react || deps['react-scripts']) return { type: 'react', hasNoPreview: false };
      return { type: 'node', hasNoPreview: true }; // CLI / knihovna — nic k preview
    }
  } catch {}
  // Tauri bez package.json (rust binary)
  try {
    const tauriConf = await levis.readFile(projectPath + '\\src-tauri\\tauri.conf.json');
    if (typeof tauriConf === 'string') return { type: 'tauri', hasNoPreview: true };
  } catch {}
  // Pokud neni package.json, zkus PHP / static
  try {
    const indexPhp = await levis.readFile(projectPath + '\\index.php');
    if (typeof indexPhp === 'string') return { type: 'php', hasNoPreview: false };
  } catch {}
  try {
    const indexHtml = await levis.readFile(projectPath + '\\index.html');
    if (typeof indexHtml === 'string') return { type: 'static', hasNoPreview: false };
  } catch {}
  return { type: 'other', hasNoPreview: false };
}

function getGreeting(): { text: string; emoji: string; weekday: string } {
  const now = new Date();
  const hour = now.getHours();
  const days = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
  const weekday = days[now.getDay()];
  if (hour < 5) return { text: 'Dobrou noc', emoji: '🌙', weekday };
  if (hour < 12) return { text: 'Dobré ráno', emoji: '☀️', weekday };
  if (hour < 18) return { text: 'Dobré odpoledne', emoji: '🌤️', weekday };
  if (hour < 22) return { text: 'Dobrý večer', emoji: '🌆', weekday };
  return { text: 'Dobrou noc', emoji: '🌙', weekday };
}

function formatDate(isoString: string): string {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'dnes';
  if (diffDays === 1) return 'včera';
  if (diffDays < 7) return `před ${diffDays} dny`;
  return d.toLocaleDateString('cs-CZ');
}

function showAboutDialog(): void {
  if (document.querySelector('.about-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'about-overlay';
  overlay.innerHTML = `
    <div class="about-box">
      <button class="about-close" title="Zavřít">×</button>
      <div class="about-logo"><img src="../assets/icon.svg" alt="LevisIDE"></div>
      <h1>LevisIDE</h1>
      <div class="about-version">verze 1.0.0</div>
      <div class="about-tagline">IDE pro webové projekty s Claude Code v jednom okně.</div>
      <div class="about-meta">
        <div><strong>Autor:</strong> Martin Levinger</div>
        <div><strong>GitHub:</strong> <a href="https://github.com/Levisek/levis-ide" data-extlink>Levisek/levis-ide</a></div>
        <div><strong>Postaveno na:</strong> Electron, Monaco, xterm.js, node-pty</div>
      </div>
      <div class="about-name-explainer">
        <strong>„LevisIDE"</strong> je dvojsmysl — <em>IDE</em> (Integrated Development Environment)
        + ostravské nářečí <em>ide</em> (= „jde, kráčí"). Logo: kráčející postava odcházející z L.
      </div>
    </div>
  `;
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

function createTileElement(project: HubProjectInfo, onOpen: (p: HubProjectInfo) => void, onTogglePin: (p: HubProjectInfo) => void, onAction: (action: string, p: HubProjectInfo) => void): HTMLElement {
  const tile = document.createElement('div');
  tile.className = 'tile' + (project.pinned ? ' tile-pinned' : '') + ((project as any).isRecent ? ' tile-recent' : '');
  tile.innerHTML = `
    <button class="tile-pin ${project.pinned ? 'pinned' : ''}" title="${project.pinned ? 'Odepnout' : 'Připnout nahoru'}">${project.pinned ? '\u2605' : '\u2606'}</button>
    <button class="tile-menu" title="Možnosti projektu">⋯</button>
    <div class="tile-status ${project.gitStatus}" title="${project.gitStatus === 'clean' ? 'Git: vše commitnuto' : project.gitStatus === 'dirty' ? 'Git: necommitované změny' : 'Git: není repo nebo chyba'}"></div>
    <div class="tile-name">${escapeHtml(project.name)}</div>
    <div class="tile-domain">${escapeHtml(project.domain || project.path)}</div>
    <div class="tile-meta">
      <span>${formatDate(project.lastModified)}</span>
      <span>${project.unpushedCount > 0 ? `${project.unpushedCount} nepushnuto` : project.gitStatus === 'clean' ? 'Git OK' : ''}</span>
    </div>
    <button class="tile-open" title="Otevřít projekt ve Workspace">Otevřít</button>
  `;
  tile.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.tile-pin') || t.closest('.tile-menu')) return;
    onOpen(project);
  });
  tile.querySelector('.tile-pin')!.addEventListener('click', (e) => {
    e.stopPropagation();
    onTogglePin(project);
  });
  function showContextMenu(x: number, y: number): void {
    document.querySelectorAll('.tile-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'tile-context-menu';
    menu.innerHTML = `
      <div class="tcm-item" data-act="open">📂 Otevřít projekt</div>
      <div class="tcm-item" data-act="explorer">🗂 Otevřít ve file exploreru</div>
      <div class="tcm-item" data-act="copyPath">📋 Kopírovat cestu</div>
      <div class="tcm-sep"></div>
      <div class="tcm-item" data-act="rename">✏️ Přejmenovat</div>
      <div class="tcm-item" data-act="duplicate">📑 Duplikovat</div>
      <div class="tcm-sep"></div>
      <div class="tcm-item tcm-danger" data-act="delete">🗑 Smazat projekt</div>
    `;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);
    // Adjust if off-screen
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth) menu.style.left = `${window.innerWidth - r.width - 10}px`;
    if (r.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - r.height - 10}px`;
    menu.querySelectorAll('.tcm-item').forEach(item => {
      item.addEventListener('click', () => {
        const act = item.getAttribute('data-act') || '';
        menu.remove();
        if (act === 'open') onOpen(project);
        else onAction(act, project);
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
    <div class="tile-new-label">Nový projekt</div>
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
        <div class="hub-subtitle">${escapeHtml(scanPath)} &mdash; načítám projekty...</div>
        <div class="hub-actions">
          <button class="hub-btn hub-btn-pull-all" title="Stáhnout vše z GitHubu">${I('download')} Pull vše</button>
          <button class="hub-btn hub-btn-push-all" title="Odeslat vše na GitHub">${I('upload')} Push vše</button>
          <button class="hub-btn hub-btn-refresh" title="Obnovit">${I('refresh')} Refresh</button>
          <button class="hub-btn hub-btn-settings" title="Nastavení">${I('gear')} Nastavení</button>
        </div>
      </div>
      <div class="hub-filter-bar">
        <input type="text" class="hub-search" placeholder="Hledat projekt...">
        <div class="hub-filter-chips"></div>
      </div>
      <div class="hub-grid"></div>
      <div class="hub-usage" id="hub-usage"></div>
      <button class="hub-trademark" type="button" title="O aplikaci">
        <img class="hub-tm-logo" src="../assets/icon.svg" alt="LevisIDE">
        <span class="hub-tm-text">LevisIDE™</span>
        <span class="hub-tm-version">v1.0.0</span>
      </button>
    </div>
  `;

  const grid = container.querySelector('.hub-grid') as HTMLElement;
  const subtitle = container.querySelector('.hub-subtitle') as HTMLElement;
  const btnRefresh = container.querySelector('.hub-btn-refresh') as HTMLElement;
  const btnSettings = container.querySelector('.hub-btn-settings') as HTMLElement;
  const btnPullAll = container.querySelector('.hub-btn-pull-all') as HTMLElement;
  const btnPushAll = container.querySelector('.hub-btn-push-all') as HTMLElement;
  const btnTrademark = container.querySelector('.hub-trademark') as HTMLElement;
  btnTrademark?.addEventListener('click', showAboutDialog);

  btnPullAll.addEventListener('click', async () => {
    showToast('Stahuji vše z GitHubu...', 'info');
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
      showToast(`Pull OK: ${ok} projektů`, 'success');
    } else {
      const list = failed.slice(0, 5).join(', ') + (failed.length > 5 ? ` +${failed.length - 5}` : '');
      showToast(`Pull: ${ok} OK, selhaly: ${list}`, 'warning');
    }
    loadProjects();
  });

  btnPushAll.addEventListener('click', async () => {
    showToast('Odesílám vše na GitHub... (jen projekty s remote)', 'info');
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
    showToast(`Push: ${ok} projektů zpracováno, ${skip} přeskočeno`, 'success');
  });

  async function loadProjects(): Promise<void> {
    grid.innerHTML = '';
    subtitle.textContent = `${scanPath} — načítám projekty...`;
    try {
      const projects: HubProjectInfo[] = await levis.scanProjects(scanPath);
      subtitle.textContent = `${scanPath} — ${projects.length} projektů`;
      const usageHost = container.querySelector('#hub-usage') as HTMLElement;
      if (usageHost) usageHost.style.display = projects.length === 0 ? 'none' : '';
      // Načti "naposledy otevřeno" z prefs
      const lastOpened: Record<string, number> = (await levis.storeGet('projectLastOpened')) || {};
      // Pinned nahoře, pak podle "naposledy otevřeno" (pokud je), jinak fallback na lastModified
      projects.sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
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
      }

      // Detekce typu paralelne pro vsechny projekty
      await Promise.all(projects.map(async (p) => {
        const det = await detectProjectType(p.path);
        p.projectType = det.type;
        p.hasNoPreview = det.hasNoPreview;
      }));

      // Render filter chips dle dostupnych typu
      const types = Array.from(new Set(projects.map(p => p.projectType || 'other')));
      const chipsHost = container.querySelector('.hub-filter-chips') as HTMLElement;
      const allChip = `<button class="hub-chip hub-chip-active" data-type="all">Vše (${projects.length})</button>`;
      const typeChips = types.map(t => {
        const meta = PROJECT_TYPES[t] || PROJECT_TYPES.other;
        const count = projects.filter(p => p.projectType === t).length;
        return `<button class="hub-chip" data-type="${t}">${meta.icon} ${meta.label} (${count})</button>`;
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
              <div class="hub-empty-title">Vítej v LevisIDE</div>
              <div class="hub-empty-sub">V <code>${escapeHtml(scanPath)}</code> zatím nejsou žádné projekty. Začni jedním z kroků:</div>
              <ol class="hub-empty-steps">
                <li><button class="hub-empty-btn" data-action="scan">${I('folder')} Vyber složku s projekty</button></li>
                <li><button class="hub-empty-btn" data-action="new">${I('plus')} Vytvoř nový projekt</button></li>
                <li><span>${I('inspect')} Otevři Workspace a vyzkoušej Inspector — klikni na element v náhledu, napiš co změnit, Claude Code to udělá.</span></li>
              </ol>
            </div>
          `;
          grid.appendChild(empty);
          empty.querySelector('[data-action="scan"]')?.addEventListener('click', () => (btnSettings as HTMLElement).click());
          empty.querySelector('[data-action="new"]')?.addEventListener('click', () => newProjectHandler());
          return;
        }
        if (filtered.length === 0 && projects.length > 0) {
          const empty = document.createElement('div');
          empty.className = 'hub-empty';
          empty.innerHTML = `
            <div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:#82859a;">
              <div style="margin-bottom:12px;opacity:0.6;">${I('search', { size: 40 })}</div>
              <div style="font-size:15px;color:#f1f2f8;margin-bottom:6px;">Žádné projekty neodpovídají filtru</div>
              <div style="font-size:12px;">Zkus změnit hledání nebo filtr typu</div>
            </div>
          `;
          grid.appendChild(empty);
        }
        for (const project of filtered) grid.appendChild(createTileElement(project, onOpenProject, onTogglePin, onTileAction));
        grid.appendChild(createNewProjectTile(newProjectHandler));
      }

      async function onTileAction(action: string, p: HubProjectInfo): Promise<void> {
        if (action === 'explorer') {
          await levis.shellOpenPath(p.path);
        } else if (action === 'copyPath') {
          levis.clipboardWrite(p.path);
          showToast('Cesta zkopírována', 'success');
        } else if (action === 'rename') {
          const newName = await askModal('Přejmenovat projekt', 'Nový název:', p.name);
          if (!newName || newName === p.name) return;
          const r = await levis.renameProject(p.path, newName);
          if (r.error) showToast(`Chyba: ${r.error}`, 'error');
          else { showToast('Přejmenováno', 'success'); loadProjects(); }
        } else if (action === 'duplicate') {
          const newName = await askModal('Duplikovat projekt', 'Název kopie:', p.name + '-copy');
          if (!newName) return;
          showToast('Kopíruji...', 'info');
          const r = await levis.duplicateProject(p.path, newName);
          if (r.error) showToast(`Chyba: ${r.error}`, 'error');
          else { showToast('Duplikováno', 'success'); loadProjects(); }
        } else if (action === 'delete') {
          const confirm = await askModal('Smazat projekt', `Opravdu smazat "${p.name}"? Tahle akce je NEVRATNÁ. Napiš název projektu pro potvrzení:`);
          if (confirm !== p.name) {
            if (confirm !== null) showToast('Zrušeno — název nesouhlasí', 'warning');
            return;
          }
          const r = await levis.deleteProject(p.path);
          if (r.error) showToast(`Chyba: ${r.error}`, 'error');
          else { showToast('Smazáno', 'success'); loadProjects(); }
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
        showToast(nowPinned ? 'Připnuto' : 'Odepnuto', 'info');
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
      subtitle.textContent = `${scanPath} — chyba při načítání`;
      showToast('Chyba při načítání projektů', 'error');
    }
  }

  async function pickTemplate(): Promise<string | null> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'template-picker-overlay';
      overlay.innerHTML = `
        <div class="template-picker-box">
          <h3>Vyber šablonu</h3>
          <div class="template-picker-list">
            <button class="template-pick" data-tpl="vitejs/vite/packages/create-vite/template-vanilla">Vite Vanilla <span>JS + Vite dev server</span></button>
            <button class="template-pick" data-tpl="vitejs/vite/packages/create-vite/template-vanilla-ts">Vite Vanilla TS <span>TypeScript + Vite</span></button>
            <button class="template-pick" data-tpl="__plain__">Plain HTML <span>index + style + main, žádné deps</span></button>
          </div>
          <button class="template-cancel">Zrušit</button>
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
    const name = await askModal('Nový projekt', 'Název projektu:');
    if (!name) return;
    const tpl = await pickTemplate();
    if (tpl === null) return;
    showToast('Vytvářím projekt...', 'info');
    const result = await levis.scaffoldProject(name, scanPath, tpl || undefined);
    if (result.error) {
      showToast(`Chyba: ${result.error}`, 'error');
    } else {
      showToast(`Projekt ${name} vytvořen!`, 'success');
      loadProjects();
    }
  }

  btnRefresh.addEventListener('click', loadProjects);

  btnSettings.addEventListener('click', () => {
    // Show settings panel
    let settingsPanel = container.querySelector('.settings-panel') as HTMLElement;
    if (settingsPanel) {
      settingsPanel.remove();
      return;
    }
    settingsPanel = document.createElement('div');
    settingsPanel.className = 'settings-panel';
    settingsPanel.innerHTML = `
      <div class="settings-box">
        <h3>Nastavení</h3>
        <label>Složka projektů:
          <input type="text" class="settings-input" id="set-scan-path" value="${scanPath}">
        </label>
        <label>Git user.name:
          <input type="text" class="settings-input" id="set-username" value="">
        </label>
        <label>Git user.email:
          <input type="text" class="settings-input" id="set-email" value="">
        </label>
        <label>Velikost písma (editor):
          <input type="number" class="settings-input" id="set-editor-font" value="14" min="10" max="24">
        </label>
        <label>Velikost písma (terminál):
          <input type="number" class="settings-input" id="set-term-font" value="13" min="10" max="24">
        </label>
        <label class="settings-checkbox">
          <input type="checkbox" id="set-cc-notifications" checked>
          <span>OS notifikace když CC v jiném tabu doběhne</span>
        </label>
        <label class="settings-checkbox">
          <input type="checkbox" id="set-cc-sound" checked>
          <span>Zvuk při dokončení CC</span>
        </label>
        <div class="settings-actions">
          <button class="settings-save">Uložit</button>
          <button class="settings-close">Zavřít</button>
        </div>
      </div>
    `;
    container.querySelector('.hub')!.appendChild(settingsPanel);

    // Load current values
    levis.storeGetAll().then((all: any) => {
      (settingsPanel.querySelector('#set-scan-path') as HTMLInputElement).value = all.scanPath || scanPath;
      (settingsPanel.querySelector('#set-username') as HTMLInputElement).value = all.userName || '';
      (settingsPanel.querySelector('#set-email') as HTMLInputElement).value = all.userEmail || '';
      (settingsPanel.querySelector('#set-editor-font') as HTMLInputElement).value = String(all.editorFontSize || 14);
      (settingsPanel.querySelector('#set-term-font') as HTMLInputElement).value = String(all.terminalFontSize || 13);
      (settingsPanel.querySelector('#set-cc-notifications') as HTMLInputElement).checked = all.ccNotifications !== false;
      (settingsPanel.querySelector('#set-cc-sound') as HTMLInputElement).checked = all.ccSound !== false;
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
      showToast('Nastavení uloženo', 'success');
      settingsPanel.remove();
      loadProjects();
    });

    settingsPanel.querySelector('.settings-close')!.addEventListener('click', () => settingsPanel.remove());
  });

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
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
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
  const block5hPct = Math.min(100, (t.block5h.cost / limits.block5h) * 100);
  const monthPct = Math.min(100, (t.month.cost / limits.month) * 100);

  // Realna procenta od Claude Code (pokud je statusline dump dostupny)
  const rl = realLimits?.rate_limits || null;
  const cw = realLimits?.context_window || null;
  const sessionPct = rl?.five_hour?.used_percentage ?? null;
  const weeklyPct = rl?.seven_day?.used_percentage ?? null;
  const ctxPct = cw?.used_percentage ?? null;
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
      <div class="usage-progress"><div class="usage-progress-fill" style="width:${sessionPct}%;background:${pctColor(sessionPct)}"></div></div>
      <div class="usage-stat-sub">${fmtReset(rl.five_hour?.resets_at)}</div>
    </div>
    <div class="usage-stat">
      <div class="usage-stat-label">Weekly</div>
      <div class="usage-stat-val">${weeklyPct}<span class="usage-stat-pct-unit">%</span></div>
      <div class="usage-progress"><div class="usage-progress-fill" style="width:${weeklyPct}%;background:${pctColor(weeklyPct)}"></div></div>
      <div class="usage-stat-sub">${fmtReset(rl.seven_day?.resets_at)}</div>
    </div>
    ${ctxPct !== null ? `
    <div class="usage-stat">
      <div class="usage-stat-label">Kontext</div>
      <div class="usage-stat-val">${ctxPct}<span class="usage-stat-pct-unit">%</span></div>
      <div class="usage-progress"><div class="usage-progress-fill" style="width:${ctxPct}%;background:${pctColor(ctxPct)}"></div></div>
      <div class="usage-stat-sub">${realLimits?.model?.display_name || ''}</div>
    </div>` : ''}
  ` : `
    <div class="usage-stat">
      <div class="usage-stat-label">Real limity</div>
      <div class="usage-stat-val" style="font-size:11px;color:var(--text-muted)">N/A</div>
      <div class="usage-stat-sub">pošli zprávu v claude</div>
    </div>
  `;

  const planOptions = Object.entries(PLAN_LIMITS).map(([k, v]) =>
    `<option value="${k}" ${k === plan ? 'selected' : ''}>${v.label}</option>`
  ).join('');

  host.innerHTML = `
    <div class="usage-bar">
      <div class="usage-bar-row">
        <div class="usage-stat">
          <div class="usage-stat-label">Dnes</div>
          <div class="usage-stat-val">${fmtUsd(t.today.cost)}</div>
          <div class="usage-stat-sub">${fmtTok(t.today.i + t.today.cw + t.today.cr)} in &middot; ${fmtTok(t.today.o)} out</div>
        </div>
        ${realCard}
        <div class="usage-stat">
          <div class="usage-stat-label">Lokální odhad měsíc</div>
          <div class="usage-stat-val" style="font-size:14px">${fmtUsd(t.month.cost)}</div>
          <div class="usage-stat-sub">5h: ${fmtUsd(t.block5h.cost)}</div>
        </div>
        <div class="usage-stat">
          <div class="usage-stat-label">Celkem</div>
          <div class="usage-stat-val">${fmtUsd(t.all.cost)}</div>
          <div class="usage-stat-sub">${t.all.count} zpráv</div>
        </div>
        <div class="usage-stat usage-plan">
          <div class="usage-stat-label">Plán</div>
          <select class="usage-plan-select">${planOptions}</select>
          <div class="usage-stat-sub">${account?.emailAddress ? escapeHtml(account.emailAddress) : 'nepřihlášen'}</div>
        </div>
        <button class="usage-toggle" title="Zobrazit detail využití">${(window as any).icon('arrow-down', { size: 14 })}</button>
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
        <h4>Posledních 14 dní</h4>
        <div class="usage-chart">${dayBars}</div>
      </div>
      <div class="usage-detail-col">
        <h4>Modely</h4>
        ${modelRows || '<div class="usage-empty">žádná data</div>'}
      </div>
      <div class="usage-detail-col usage-detail-col-wide">
        <h4>Top projekty (top 20)</h4>
        ${projRows || '<div class="usage-empty">žádná data</div>'}
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
          <button class="levis-modal-cancel">Zrušit</button>
          <button class="levis-modal-ok">OK</button>
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
