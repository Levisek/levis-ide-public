# LevisIDE

<p align="center">
  <img src="assets/icon.png" width="128" alt="LevisIDE icon">
</p>

<p align="center">
  Electron IDE pro webové projekty s integrací Claude Code.<br>
  <em>"LevisIDE — Levis ide" (ostravské nářečí: Levis kráčí)</em>
</p>

---

## Co to je

LevisIDE je desktopové vývojové prostředí postavené na Electronu. Spojuje terminál, editor, live preview a Git do jednoho okna. Navržené pro rychlý workflow s Claude Code — označíš element v náhledu, napíšeš co chceš změnit a pošleš rovnou do terminálu **včetně screenshotu vybrané oblasti**.

---

## v1.0.0 — co je nového

První oficiální verze. Highlighty:

- **Workspace 2×2 grid** s drag & drop přeskupením, lock toggle, „+" panel picker
- **Drag-out panelů** do plovoucích Electron oken (terminal, editor, náhled, prohlížeč, mobil) — multi-monitor workflow
- **Welcome screen** na první spuštění + **About dialog** (klik na trademark v Hubu)
- **OS notifikace + zvuk** + **tab badge** když Claude Code dokončí práci v jiném tabu (opt-in v Nastavení)
- **Recent projects** — modrý „Naposledy" badge na projektech otevřených v posledních 7 dnech
- **Session persistence** — otevřené editor taby přežijí restart projektu
- **Project search** `Ctrl+Shift+F` (find/replace s regex + case)
- **Quick file open** `Ctrl+P` (fuzzy)
- **Tab cyklování** `Ctrl+Tab` / `Ctrl+Shift+Tab`, dirty check při zavření tabu
- **Git status v file tree** — barevné M/U/A badges, dirty složky
- **CC state detector** přes ccDetector.detect() místo brute force (žádné falešné notifikace)
- **Nová ikona** — ISO exit-man v oranžovém gradientu (`assets/icon.svg` + `.ico`)

## Funkce

### 🏠 Hub (přehled projektů)
- Scan projektů v `~/dev` (cross-platform default, konfigurovatelná cesta)
- Animovaný gradient greeting s emoji podle denní doby + den v týdnu (🌙 ☀️ 🌤️ 🌆)
- Automatická detekce typu projektu: Next, React, Vue, Svelte, Astro, Nuxt, Electron, Tauri, Node, PHP, Static
- Filtr chips podle typu, fulltext search
- Připnutí oblíbených projektů nahoru (★)
- Status git: clean / dirty / no-repo, počet nepushnutých commitů
- Hromadný **Pull vše** / **Push vše** z GitHubu
- **Onboarding empty state** — když je složka prázdná, ukáže 3-step návod (Vybrat složku / Nový projekt / Inspector)
- **Project management context menu** (pravý klik / `⋯` na dlaždici): Otevřít, File explorer, Kopírovat cestu, Přejmenovat, Duplikovat, Smazat (s name-confirm)
- **Scaffolding wizard** se šablonami: Vite Vanilla, Vite TS, Plain HTML
- Usage panel (Claude Code spotřeba) — viditelný jen když máš projekty
- Trademark v rohu (LevisIDE™ + verze)

### 🪟 Workspace
- Frameless okno s vlastním tab barem (Hub + N workspace tabů)
- Layout: **sidebar (file tree)** + **levý slot** (terminal/editor/diff) + **pravý slot** (browser/náhled/mobil)
- **Sidebar L/R toggle** (`⇆`) — file tree přepnout vlevo/vpravo, persistovaný per-uživatel
- **Drag-out plovoucí okno** — drag náhled / prohlížeč / mobil header mimo workspace = otevře v separátním Electron okně (druhý monitor)
- Splitter mezi sloty, dirty indikátor projektu
- **Auto-load `index.html`** do náhledu při otevření projektu (vanilla / Vite / public/ struktura)
- **Pre-quit git check** — při zavření aplikace projde otevřené projekty, najde necommitované změny / nepushnuté commity, nabídne push přímo z modalu

### 💻 Terminál
- xterm.js + node-pty (skutečný shell, PowerShell na Win / bash/zsh na Unix)
- WebGL renderer, fit / search / web-links / webgl addony
- Split terminal (víc instancí vedle sebe)
- Fulltext hledání v outputu
- **Stavový indikátor** v toolbaru: 🟢 idle / 🟠 working (pulse) / 🔵 waiting (rychlý pulse)
- **Shift+Enter** = newline (line continuation pro CC multiline prompty)
- Ctrl+V paste, Ctrl+C copy (xterm custom handler, Ctrl+C jen při výběru)

### 📝 Editor (Monaco, VS Code-class)
- **Multi-file tabs** — `Map<filePath, ITextModel>`, view state preservation při přepnutí
- Per-tab dirty indikátor (• před názvem, oranžový text, pulzující save tlačítko)
- **Dirty modal** při zavření taby — Save / Discard / Cancel
- **Ctrl+W** zavře aktivní tab, středokliky zavírají
- Find / Replace (`Ctrl+F` / `Ctrl+H`) s **oranžovým match highlight**
- **Format on save** (`editor.action.formatDocument` před writeFile)
- Dark téma "levis-dark" (orange + purple accent)
- Drag & drop souborů z OS i file tree

### 📁 File tree
- Stromový prohlížeč souborů s ikonami
- Klik = otevře v editoru (single source of truth, neotevírá zároveň náhled)

### 🎨 Artifact preview (live náhled) — HEADLINE
- HTML/CSS/JS živý náhled v iframe
- **Watch mode defaultně ZAPNUTO** — polling 1.5 s, reload jen při skutečné změně souboru
- Responsive sizes (375 / 768 / full)
- **Inspector** — hover highlight, klik vybere element
- **Floating prompt popover** vedle vybrané oblasti se smart placementem (dole / nahoře / vpravo / vlevo podle volného místa), CSS šipka, dashed orange ring + vignette efekt na zbytek preview, glow border, gradient background
- **Prompt history dropdown** (top 10) sdílený přes store
- **Annotation canvas** — kreslení / zakroužkování oblastí, popis co změnit
- **Screenshot vybrané oblasti** se přiloží k promptu pro CC (`.levis-tmp/lasso-*.png`, 30 s auto-cleanup)

### 🪞 Pop-out plovoucí okna
- Náhled / prohlížeč / mobil → drag toolbar mimo workspace = nové Electron okno
- **Mini window ghost** během tažení (titlebar + content placeholder, mírná rotace, oranžový glow když je mimo bounds)
- Vlastní inspectorem a anotacemi v popout okně
- Prompty se posílají zpět do hlavního terminálu přes IPC

### 📱 Mobile preview
- `<webview>` panel s mobilní velikostí
- QR kód pro skutečné zařízení
- **Touch emulace** přes CDP `Emulation.setEmitTouchEventsForMouse` — myš se chová jako prst, RN-Web/Expo to nepozná od mobilu (default OFF, opt-in v toolbaru)

### 🌐 Browser panel
- Webview pro localhost náhledy
- Zpět / vpřed, refresh, URL bar

### 🔀 Git integrace
- Status, diff viewer, pull, push, log
- **Diff viewer s commit barem** (input message + Commit / Commit & push)
- Branch indikátor v toolbaru
- Hromadný pull/push z Hubu

### ⚡ Command palette
- `Ctrl+Shift+P` — fuzzy search command palette
- `+ Nový projekt` tlačítko v tab baru
- **`F1` / `?`** — Help overlay s plným seznamem zkratek

### 🔔 Toast notifikace
- success / info / warning / error

---

## Klávesové zkratky

| Zkratka | Akce |
|---------|------|
| `F1` / `?` | Help overlay |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+P` | Quick file open (fuzzy) |
| `Ctrl+Shift+F` | Project search & replace |
| `Ctrl+Shift+T` | Hub tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Cyklovat mezi taby |
| `Ctrl+Shift+W` | Zavřít tab |
| `Ctrl+Shift+R` | Hard reload |
| `Ctrl+,` | Nastavení |
| `Alt+I` | Toggle Inspect mode |
| `Ctrl+Enter` | Pošli editor selection do terminálu |
| `Ctrl+Shift+V` | Refresh artifact preview |
| `Ctrl+S` | Uložit aktivní soubor (s format) |
| `Ctrl+W` | Zavřít editor tab |
| `Ctrl+F` / `Ctrl+H` | Find / Replace |
| `Shift+Enter` v terminálu | Newline (line continuation) |
| Pravý klik na tile v Hubu | Project management menu |

---

## Architektura & bezpečnost

- **Modulární IPC**: `electron/ipc/` rozdělené (window, store, projects, git, fs, pty, scaffold, usage, env, touch-input, capture)
- **`contextIsolation: true`**, **`nodeIntegration: false`** v obou oknech
- `contextBridge.exposeInMainWorld('levis', ...)` pro hlavní okno
- `contextBridge.exposeInMainWorld('popoutApi', ...)` pro náhledové popout okno
- `contextBridge.exposeInMainWorld('panelApi', ...)` pro plovoucí panely (terminal/editor)
- Clipboard přes IPC (ne `navigator.clipboard`)
- CSP s `unsafe-eval` (Monaco) a `unsafe-inline` (styly), inline `<script>` zakázán
- Všechny `innerHTML` interpolace přes escape helpery
- **Path validation** v `safe-path.ts` pro všechny destruktivní fs operace (delete, rename, duplicate, capture)
- `shell:openPath` blokuje URL schémata (`http:`, `javascript:`, atd.)
- Symlinky se v `fs:duplicateProject` nenásledují (anti symlink-attack)
- **PTY broadcast** — PTY data jdou všem oknům, renderer filtruje podle `ptyId` (potřeba pro multi-window terminal)
- **Pre-quit guards**: confirm modal + git stav check + push tlačítka per-projekt
- České UI s plnou diakritikou
- Cross-platform homedir default (`os.homedir()`)

---

## Instalace

```bash
git clone https://github.com/Levisek/levis-ide.git
cd levis-ide
npm install
```

## Spuštění

```bash
# Vývoj (TypeScript watch + Electron)
npm run dev

# Jen spustit (vyžaduje předchozí build)
npm start
```

## Build

```bash
# Windows NSIS installer
npm run build
```

Výstup najdeš v `release/`.

---

## Technologie

| Co | Čím |
|----|-----|
| Framework | Electron 41 |
| Editor | Monaco Editor |
| Terminál | xterm.js + node-pty |
| Git | simple-git |
| Jazyk | TypeScript |
| Build | electron-builder |

---

## Struktura

```
electron/                       # Main process
  main.ts                       # Vstupní bod, BrowserWindow, single instance
  ipc.ts                        # Registruje všechny IPC handlery
  ipc/
    window.ts                   # Window controls + popout (artifact + panel)
    store-handlers.ts           # Persistent settings
    projects.ts                 # Hub project scan
    git.ts                      # status / diff / pull / commit / push
    fs.ts                       # readDir/readFile/writeFile/delete/rename/duplicate
    safe-path.ts                # Path validation (anti traversal)
    pty.ts                      # node-pty + broadcast všem oknům
    scaffold.ts                 # Project scaffolding (degit + plain)
    usage.ts                    # Claude Code usage
    env.ts                      # homedir, clipboard
    touch-input.ts              # CDP touch emulation
    capture.ts                  # webContents.capturePage region (lasso PNG)
  preload.ts                    # window.levis API (hlavní okno)
  preload-popout.ts             # window.popoutApi (artifact popout)
  preload-popout-panel.ts       # window.panelApi (terminal/editor popout)
  store.ts                      # electron-store
src/                            # Renderer
  app.ts                        # Tab manager + global hotkeys + help + quit flow
  workspace.ts                  # Workspace layout (sidebar + 2 sloty + drag-out)
  hub.ts                        # Project hub + scaffold + project management
  artifact.ts                   # Live preview + inspector + floating popover + lasso
  inspector.ts                  # Element picker (postMessage z iframe)
  popout.ts                     # Artifact popout renderer
  popout-panel.ts               # Panel popout renderer (terminal/editor — připraveno)
  popout-panel.html             # HTML pro plovoucí panel okno
  terminal.ts                   # xterm wrapper + state dot + Shift+Enter
  cc-state.ts                   # Detector stavu Claude Code (idle/working/waiting)
  editor.ts                     # Monaco multi-tab + dirty modal + format on save
  file-tree.ts                  # Stromový prohlížeč
  mobile.ts                     # Mobile preview + touch emulation
  browser.ts                    # Webview panel
  command-palette.ts            # Ctrl+Shift+P
  diff-viewer.ts                # Git diff + commit bar
  toast.ts                      # Notifikace
  dock.ts                       # Drag-out detection helper (mini window ghost)
  css/                          # Modulární styly
    variables.css
    layout.css
    components.css
    utilities.css
    hub.css
    artifact.css
assets/                         # Ikony
```

---

## TODO / Roadmap

### 🐛 Známé bugy
- [ ] **CC waiting detector nefunguje** — `src/cc-state.ts` neidentifikuje když Claude Code čeká na odpověď, modrá tečka se neaktivuje. Implicitní markery (`Enter to select`, `AskUserQuestion`, CC box rámec) byly přidány ale match selhává. Diagnostika: v DevTools `__levisCCDebug = true` → vyvolat CC výzvu → sledovat console. Možná problém s ANSI strippingem nebo state machine v `terminal.ts` přebije detekci. **Možný fix**: sticky state — pokud byl WORKING a teď je ticho → automaticky WAITING (bez ohledu na buffer obsah).

### 🚧 Rozpracované (priorita)
- [ ] **G2c — Drag-and-drop reorder mezi sloty workspace** — drag terminal/editor toolbar → drop na druhý slot = swap. Aktuálně je jen tlačítko `↔` pro celý swap stran. Drop zone visuální feedback (oranžový glow nad slotem). Backend pro popout-panel (PTY broadcast, panelApi preload) je hotový — využije se až bude potřeba.
- [ ] **Editor v plovoucím okně** — Monaco models cross-window, znovu načíst openFiles po popout. Aktuálně fallback view se seznamem souborů.
- [ ] **Drag-back z plovoucího okna** — táhnout header plovoucího okna zpět nad workspace slot → panel se vrátí. Vyžaduje main process screen coords tracking + drop zone detekce.

### ⏸ Plánované
- [ ] **Logo a app icon** — koncept "Levis ide" (kráčející postava). Aktuálně placeholder SVG v hub trademarku. Vyrobit pořádný SVG + `assets/icon.png` + `icon.ico` pro Windows.
- [ ] **Cross-platform build** — macOS (`.dmg`) a Linux (`.AppImage`, `.deb`) targets v `electron-builder`. Apple code signing ($99/rok) optional. Touch emulace v `mobile.ts` ověřit na Macu. Path separators audit (přesunout do helperu `src/utils/path.ts`).
- [ ] **Tab badge** — když workspace tab není aktivní a CC v něm dokončil (working → idle), bod na ikoně tabu. Klik = bod zmizí.
- [ ] **Zvuková notifikace** (opt-in) — `AudioContext` ding při dokončení CC. Setting v Hub Settings (off/low/normal). Default off.
- [ ] **OS-level notifikace** — když okno není focused a CC dokončí, native Electron `Notification`.
- [ ] **Ctrl+P quick file open** — fuzzy file picker nad celým projektem (`Ctrl+Shift+P` je command palette, `Ctrl+P` zatím není). Reuse `levis.readDir` rekurzivně, cache.
- [ ] **Session persistence** — otevřené editor taby uložit do `levis.storeSet('workspace:${path}:openFiles')`. Při znovuotevření obnovit.

### 💭 Nice-to-have
- [ ] **Session replay** — záznam sekvence inspect → prompt → CC výstup, přehrát. JSONL v `.levis-tmp/sessions/`.
- [ ] **Budget alert** — barva v usage panelu (dnes vs 7denní průměr). Žádné notifikace, jen vizuální.
- [ ] **Demo video (60 s)** — OBS, no edit, real workflow s floating popoverem a lassem. README banner.

### ✅ Hotovo (highlights)
- ✅ Multi-file editor tabs s dirty checkem
- ✅ Floating prompt popover (HEADLINE — vedle vybrané oblasti, smart placement)
- ✅ Screenshot lasso → CC s PNG
- ✅ Hub project management (delete/rename/duplicate/copy path)
- ✅ Sidebar L/R toggle
- ✅ Drag-out plovoucí okno (náhled/browser/mobil)
- ✅ Pre-quit git check + push z modalu
- ✅ Help overlay (F1)
- ✅ Format on save, find/replace s oranžovým highlightem
- ✅ Generic scaffolding (Vite/Plain HTML)
- ✅ Bezpečnostní audit (path validation, XSS escape, ReDoS)

---

## Autor

**Martin Levinger** ([@Levisek](https://github.com/Levisek))

## Licence

ISC
