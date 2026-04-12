# LevisIDE

Electron IDE pro webove projekty. Spojuje terminal, editor, live preview a Git do jednoho okna.
Hlavni fíčura — inspector/anotace v náhledu posílá instrukce primo do Claude Code v terminalu, **včetně screenshotu vybrané oblasti** (lasso → PNG do `.levis-tmp/` → cesta v promptu).

Název: **"LevisIDE"** je dvojsmysl — `IDE` (Integrated Development Environment) + ostravské nářečí `ide` (= "jde, kráčí"). Logo koncept: kráčející postava.

## Pravidla pro Claude Code

- Bud strucny, ukazuj jen zmenene casti kodu
- Neprepisuj cele soubory, pouzij Edit tool
- Pred kazdou zmenou precti soubor, at vidis aktualni stav
- Commit message pis cesky
- Komunikuj cesky, neformalne, bez zbytecnych otazek
- Kdyz je zamer jasny, rovnou jednej — neptej se na potvrzeni
- Po zmene vzdy zkompiluj: `npx tsc` (musi projit bez chyb)

## Architektura

Electron app se dvema procesy:

### Main process (`electron/`)
- `main.ts` — vstupni bod, vytvari hlavni BrowserWindow (frameless), single instance lock, **close event preventDefault** + `app:confirmQuit` IPC pro pre-quit git check
- `ipc.ts` — registruje vsechny IPC handlery z `ipc/` (window, store, projects, git, fs, pty, scaffold, usage, env, touch-input, capture)
- `preload.ts` — `contextBridge.exposeInMainWorld('levis', ...)` API pro hlavni okno (contextIsolation: true, nodeIntegration: false)
- `preload-popout.ts` — `contextBridge.exposeInMainWorld('popoutApi', ...)` pro náhled popout okno
- `preload-popout-panel.ts` — `contextBridge.exposeInMainWorld('panelApi', ...)` pro plovoucí terminal/editor okna (PTY broadcast, fs, clipboard)
- `store.ts` — electron-store konfigurace (pozice okna, sidebarSide, promptHistory, atd.)
- `ipc/env.ts` — `os.homedir()`, clipboard read/write
- `ipc/capture.ts` — `webContents.capturePage(rect)` pro lasso screenshot
- `ipc/pty.ts` — node-pty s **broadcast všem oknům** (renderer filtruje podle ptyId)
- `ipc/window.ts` — window:popout (singleton artifact) + window:popoutPanel (multi-instance terminal/editor)
- `ipc/safe-path.ts` — path validation, allowed roots = scanPath + ~/dev + ~/Documents + ~/Desktop

### Renderer (`src/`)
- `app.ts` — tab manager, prepina mezi Hub a Workspace taby, **global hotkeys** (F1 help, Ctrl+Shift+P palette, atd.), **pre-quit confirm + git check modal**
- `hub.ts` — prehled projektu, scan, hromadny git pull/push, **scaffolding wizard** (Vite/Plain HTML), **project management context menu** (delete/rename/duplicate), **trademark**
- `workspace.ts` — hlavni layout: sidebar (file tree) + levý slot (terminal/editor/diff) + pravý slot (browser/náhled/mobil), **sidebar L/R toggle**, **drag-out na pravé panely**
- `artifact.ts` — live HTML/CSS/JS preview v iframe, inspector integrace, **floating prompt popover** se smart placement (vedle vybrané oblasti), annotace canvas, **lasso screenshot capture**, watch mode (default ON), responsive sizes
- `inspector.ts` — injektuje script do iframe, highlight na hover, klik vybere element + jeho rect, posle info pres postMessage
- `popout.ts` — pop-out okno na druhy monitor, ma vlastni inspect/anotace/info bar, posila prompty pres IPC zpet do hlavniho okna
- `popout-panel.ts` — renderer plovoucího panelu (terminal s xterm + PTY broadcast filter, editor fallback view)
- `popout-panel.html` — HTML pro plovoucí panel okno
- `terminal.ts` — xterm.js wrapper, PTY pres IPC, split terminal, **status dot** (idle/working/waiting), **Shift+Enter line continuation**
- `cc-state.ts` — heuristický detector stavu CC (idle/working/waiting) z PTY bufferu
- `editor.ts` — Monaco editor wrapper, **multi-file tabs** (`Map<filePath, ITextModel>`), per-tab dirty check, dirty modal Save/Discard/Cancel, format on save, Find/Replace oranžový highlight
- `file-tree.ts` — stromovy prohledavac souboru (otevírá jen do editoru, ne náhledu)
- `browser.ts` — webview panel pro localhost nahledy
- `mobile.ts` — mobilní preview přes `<webview>`, touch emulace (CDP `Emulation.setEmitTouchEventsForMouse`)
- `command-palette.ts` — Ctrl+Shift+P command palette
- `toast.ts` — notifikacni toasty
- `diff-viewer.ts` — git diff zobrazeni + commit bar (Commit / Commit & push)
- `dock.ts` — drag-out helper (pointer events s capture, mini window ghost)
- `css/` — modulární styly (variables, layout, components, utilities, hub, artifact)
- `xterm.d.ts` — TypeScript deklarace pro LevisAPI a globalni funkce

### HTML vstupní body
- `src/index.html` — hlavní okno (nacita všechny skripty)
- `src/popout.html` — náhled pop-out okno (artifact + inspector)
- `src/popout-panel.html` — plovoucí panel okno (terminal/editor)

## Klíčové datové toky

1. **Inspector → Claude Code se screenshotem**: user klikne Inspect → vybere element v iframe → inspector pošle `{rect, selector, ...}` přes postMessage → artifact.ts vytvoří floating popover vedle elementu (smart placement) → user napíše prompt → `captureRegion` IPC uloží PNG do `.levis-tmp/lasso-{ts}.png` → CC dostane prompt s relativní cestou → po 30 s se PNG smaže
2. **Annotation → Claude Code**: kreslení canvas → bbox → floating popover → stejný flow
3. **Pop-out lifecycle**: workspace klikne / drag mimo → `window:popout` IPC → main vytvoří/reusne BrowserWindow → při zavření pošle `popout:closed` → workspace obnoví pravý panel
4. **PTY broadcast**: `pty.ts` v main procesu vysílá `pty:data` všem oknům, renderer filtruje podle `ptyId`
5. **Pre-quit flow**: × na window → main `before-close` preventDefault → `app:confirmQuit` IPC → renderer zobrazí modal → na confirm projde tabs, zavolá `gitStatus` per projekt → najde dirty/ahead → druhý modal s push tlačítky → po vyřízení `app:forceQuit` IPC → main `allowQuit = true` → `app.quit()`

## Build & Run

```bash
npm install
npm run dev     # tsc -w + electron (vyvoj)
npm run build   # tsc + electron-builder --win (NSIS installer)
npm start       # jen electron . (musi byt zkompilovano)
```

Kompilace: `npx tsc` — output do `dist/`

## Bezpečnost

- `contextIsolation: true`, `nodeIntegration: false` v obou oknech. Renderer NEMÁ přístup k Node API. Vše jde přes `contextBridge`.
- xterm a addony se loaduji jako UMD `<script>` v `src/index.html` a `popout-panel.html`.
- Clipboard přes `levis.clipboardRead/clipboardWrite` (IPC do main procesu).
- CSP: `script-src` povoluje `'unsafe-eval'` (Monaco AMD loader), `style-src` povoluje `'unsafe-inline'`. Inline `<script>` povolené **nejsou**.
- `innerHTML` — všechny dynamické interpolace jdou přes `escapeHtml()` helpery.
- popout window má `webSecurity: false` — nutné pro `file://` iframe + inspector cross-frame eval.
- **Path validation v `safe-path.ts`** pro všechny destruktivní fs operace (delete/rename/duplicate/capture).
- `shell:openExternal` IPC akceptuje jen http(s) URL.
- Mobile panel: CDP debugger přes `Emulation.setEmitTouchEventsForMouse`, default **OFF** (opt-in).

## Hotovo v1.0.1

- i18n systém (`src/i18n.ts`) — čeština (default) + angličtina, přepínání v Settings
- Autostart dev serveru dle typu projektu (AUTOSTART tabulka, port probe, Storybook tlačítko)
- Browser panel s artifact layoutem — size buttons (Mobile 412px/Tablet/Full), Watch, Inspect, Annotate + lasso screenshot
- Settings tlačítko v topbaru (gear ikona vedle nápovědy)
- CC waiting modrá tečka odstraněna (mapuje se na working/oranžová)
- Sidebar splitter fix pro sidebar vpravo
- Grid fix: audit/tokens odstraněny z ALL_GRID_PANELS (neexistují v public)

## Hotovo v1.1.0

- **Sloučení panelů** — Preview + Browser + Mobile → jeden Browser panel
- Témata (4 color schemes), per-projekt barvy (dot v tabu), statusy (Active/Paused/Finished)
- File tree: ikony per typ, šipky, pravý klik (rename/copy path)
- Floating popover, Dark/Light mode, Touch kurzor (jen přes tlačítko)
- Prompt fronta (CC busy → auto-send), aktivní terminál (klik vybere cíl)
- Drag file tree → terminál/browser, pravý klik v terminálu (Copy/Paste)
- Auto-scroll, hard reload, scrollbar redesign, Ctrl+V/Shift+Enter fix
- Settings/Help přesunuty do #window-controls (Electron app-region fix)

## Bugy / known issues

- **Popout terminal občas černé okno** — race condition
- **Popout browser** — funguje jen pro file://, ne http://

## TODO v1.2

- Touch ikona duplikát, terminál splitter direction fix
- Popout font size ze store, popout multi-terminal
- New Project wizard — více šablon (React/Vue/Svelte/Next/Astro) + prázdný projekt
- Orphaned CSS cleanup po sloučení panelů
- Cross-platform build (macOS, Linux)

## Git

- Autor: Martin Levinger (@Levisek)
- Origin není nastaven — nastav si sám: `git remote add origin <tvoje-url>`
