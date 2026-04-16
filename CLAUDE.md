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
- `src/index.html` — hlavní okno (nacita všechny skripty včetně `i18n.js`)
- `src/popout.html` — náhled pop-out okno (artifact + inspector), načítá `i18n.js` pro překlady toolbarů
- `src/popout-panel.html` — plovoucí panel okno (terminal/editor), načítá `i18n.js` pro překlady window controls

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
- **`isPathAllowed` v `safe-path.ts`** se volá ve **všech** `fs:*` a `git:*` IPC handlerech (read/write/delete/rename/duplicate/capture + 10× git). Renderer nesmí zasáhnout mimo allowed roots (`scanPath` + `~/dev` + `~/Documents` + `~/Desktop`).
- `fs:renameProject` / `fs:duplicateProject` navíc odmítají `newName` obsahující `/ \ ..` a validují cílovou cestu.
- **`store:set('scanPath', …)`** validuje: absolutní cesta, existuje jako adresář, není systémová lokace (`/windows`, `/etc`, `/sys`, …). Jinak renderer by mohl přes store rozšířit allowed roots.
- **`hardenWindow()` helper** (v `main.ts`) aplikován na **všechna** okna (main + popout + panel):
  - `will-navigate` — blokuje navigaci mimo `file://`, http(s) se předá do `shell.openExternal`
  - `setWindowOpenHandler` — blokuje `window.open`, http(s) se předá do `shell.openExternal`
- `shell:openExternal` IPC akceptuje jen http(s) URL; `shell:openPath` validuje přes `isPathAllowed` a odmítá URL schémata.
- `capture:region` validuje savePath + vynucuje `.png`; `capture:cleanup` vyžaduje `.levis-tmp` v cestě.
- `projects:scan` vyžaduje, aby `scanPath` odpovídal uloženému `store.get('scanPath')` (brání enumeration libovolné cesty).
- `clipboard:readImage` validuje `projectPath` přes `isPathAllowed`.
- Webview validátor (`will-attach-webview`) v main i popout okně vynucuje `nodeIntegration: false` + `contextIsolation: true` a blokuje `data:` / `javascript:` / `vbscript:` URL schémata.
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

## Hotovo v1.2

- Terminál: toolbar odstraněn, čistý xterm (jako tmux/VS Code split)
- Status dot overlay, aktivní pane = accent inset shadow
- Akce (search/clear/split) v grid headeru TERMINAL
- Popout multi-terminal: tiled layout (vedle sebe)
- Popout browser: race condition fix + webview pro http://
- Splitter unifikace: sdílený split-handle CSS
- Browser toolbar: ikony-only
- Touch ikona: nová hand/finger SVG
- File tree: auto-refresh odstraněn (složky se nezavírají)
- New Project wizard: +React/Vue/Svelte/Next.js/Astro šablony
- Cross-platform build config (mac/linux targets)
- Orphaned CSS cleanup, terminál splitter direction fix

## Hotovo v1.3

- **Browser toolbar overlap fix** — `flex-shrink: 0` na toolbar, webview container `flex:1 1 0;min-height:0`
- **Grid kompakce** — zavření panelu automaticky zmenší grid (2×1→1×1, 2×2→1×2 atd.)
- **Zavření workspace zavře plovoucí okna** — `dispose()` volá `closePopoutPanel` na všechny popouty
- **Settings/Help kontextové zobrazení** — v Hubu jen hub UI tlačítka, v titlebaru jen ve workspace
- **Okno jde přesunout** — fix `app-region: drag` selektorů, prázdný prostor v tab-baru draggable
- **Feedback formulář** — built-in formulář s GitHub Issues + PHP endpoint na levinger.cz (CAPTCHA + API klíč + rate limit)
- **Logo a app icon** — SVG/PNG/ICO v assets/, electron-builder config
- **Drag-back gesture** — popout panel → tlačítko "Vrátit do workspace" → panel:returned IPC
- **Editor model handshake** — Monaco modely per-window, sync přes file I/O
- **Tab badge** — CC dokončil v pozadí → puntík na tabu, zmizí po kliknutí
- **Zvuková notifikace** — Web Audio 2-tónový beep (opt-in v nastavení)
- **OS-level notifikace** — Electron Notification API při unfocused okně
- **Session persistence** — editor taby přežijí restart (electron-store per-projekt)
- **Split-handle + term-splitter** — opraveno
- **CC waiting detector** — opraveno

## Hotovo v1.5.1 (bezpečnostní audit + i18n sanita)

### Bezpečnost
- **`isPathAllowed` ve všech fs/git IPC handlerech** — `renameProject` + `duplicateProject` navíc odmítají `newName` s `/ \ ..`, `project:generateClaudeMd` validuje cestu, všech 10 `git:*` handlerů validuje `projectPath`
- **`store:set('scanPath', …)` validace** — absolutní cesta, existuje jako adresář, není systémová lokace (`/windows`, `/etc`, `/sys`, …)
- **`hardenWindow()`** — helper v `main.ts`, aplikován na main + popout + panel okna; `will-navigate` blokuje navigaci mimo `file://`, `setWindowOpenHandler` blokuje `window.open`, externí http(s) se otevře v systémovém prohlížeči
- **`projects:scan`** — vyžaduje shodu `scanPath` s `store.get('scanPath')` (brání enumeration)
- **`clipboard:readImage`** — `isPathAllowed(projectPath)`

### i18n
- ~108 nových klíčů pokrývajících `browser`, `editor`, `diff`, `grid`, `workspace`, `panel`, `popout`, `titlebar`, `usage`
- **Popout + popout-panel** nyní načítají `i18n.js` a volají `initI18n()` → `storeGet('locale')` → `applyI18nDom`
- **`preload-popout.ts`** získal `storeGet` IPC (popout potřebuje přečíst locale)
- `initI18n` v `src/i18n.ts` rozšířen — pracuje se všemi třemi preload API (`window.levis`, `window.panelApi`, `window.popoutApi`)
- HTML: `data-i18n-title` a `data-i18n-placeholder` doplněny v `index.html`, `popout.html`, `popout-panel.html`

## Hotovo v1.6

### Race conditions
- **Race condition quit flow** — `runGitCheckThenQuit()` v `src/app.ts` má `cancelled` flag; po 8s hard timeoutu už žádná pozdní `gitStatus` odpověď nezmění `issues[]`. Main-side 4s timeout v `electron/ipc/git.ts:13` zůstává.
- **Race condition watch interval** — `startWatch()` v `src/browser.ts` má `watchPending` guard; pokud `loadFile` trvá > 2 s, další tick se skipne místo paralelního startu.

### Auto-reload náhledu po CC (regrese fix)
- `browser.ts` má `armedReloadAfterCC` flag + `notifyCCDone()` metodu v API. Když user odešle prompt z Inspect / Lasso / Annotate, flag se nahraje. `workspace.ccDoneCallbacks` volá `browserInstance.notifyCCDone()` při working→idle přechodu → náhled se refreshne (pokud Watch neběží — ten si reload dělá sám).

### Inspect/Lasso toggle "odeslat / jen připravit"
- **Settings** (Hub → ozubené kolo) → nový checkbox **„Prompt z Inspectu/Lasa odeslat do CC hned"** (default ON). OFF = prompt se do CC jen napíše bez Enteru, user stiskne sám.
- `browser.ts sendElementPrompt` / `showAnnotPrompt` čtou `storeGet('inspectAutoSubmit')` a posílají object `{ text, submit }` místo plain string. `workspace.sendToFirstTerminal(text, submit)` přijímá druhý parametr — v prepare módu píše bez `\r`.
- Store klíč: `inspectAutoSubmit` (boolean, default true).

### Pre-quit modal — bezpečnější detekce + akce
- **Rozšířená dirty detekce** — původní kontrola (`files/modified/created`) nechytala untracked (`not_added`), `deleted`, `renamed`, `conflicted`, `staged` → appka se mohla zavřít s tichou ztrátou. Teď detekce pokrývá všechny.
- **`unknown` flag** — pokud `gitStatus` timeoutne / vrátí error, projekt se přidá do modalu s tagem "stav neznámý" místo potichého přeskočení.
- **Nové akce v modálu per dirty projekt:**
  - **Commit** — inline input pro message → `git:commit` → po úspěchu se tag dirty přepne na ahead + přidá se Push tlačítko
  - **Otevřít projekt** — zruší quit, přepne na tab (každý issue, i terminálový)
  - **Zahodit** — confirm → `git:stash -u` (bezpečná alternativa k hard discardu, reverzibilní přes `git stash pop`)
- Nový IPC: `git:stash` (electron/ipc/git.ts).

### Stash vše v Hubu
- Toolbar tlačítko **„Stash vše"** (archive ikona) nahradilo dřívější buggy „Push vše" (to jen inkrementovalo counter bez volání `git push`). Iteruje projekty, stashne jen dirty; toast ukazuje kolik stashnuto + kolik už bylo čistých.

## TODO v1.6+

### Bezpečnost zbývá
- Cross-platform testování (macOS, Linux)

## TODO v1.6 — Monetizace / licencování

### Licenční klíče (paid verze)
- **Key format** — např. `LVS-XXXX-XXXX-XXXX-XXXX`, 16 hex znaků, HMAC-SHA256 checksum + Ed25519 signatura podepsaná private klíčem na serveru (aplikace validuje offline přes public key embed)
- **Trial mode** — prvních 14 dní plná funkcionalita bez klíče, poté degradace (kolik projektů? splash s promptem na aktivaci?)
- **Backend** — endpoint na `levinger.cz` (PHP + SQLite nebo MySQL):
  - `POST /license/activate` (key + device fingerprint → aktivace, limit zařízení per klíč)
  - `POST /license/validate` (periodická kontrola → revocation)
  - `POST /license/purchase` (webhook od platební brány Stripe/GoPay)
- **Aktivační dialog v LevisIDE** — při prvním startu po 14 dnech / manuálně přes Settings
- **Secure storage** — klíč uložit přes `keytar` (OS credential store: Windows Credential Vault / macOS Keychain / Linux libsecret)
- **Offline grace** — 30 dní bez validation hitu (pak přinutí online validate)
- **Revocation** — seznam zneplatněných klíčů tažený 1× denně
- **Antitamper** — runtime check signatury .exe (electron-builder umí `codeSign` pro Windows), obfuskace validační funkce (terser mangle)
- **Cenotvorba** — osobní / komerční / team / lifetime — rozhodnout před implementací

### EULA / TOS
- `build/license.txt` nebo `.rtf` — text zobrazený v NSIS instalátoru (i wipe u open-source cesty)
- Privacy policy na levinger.cz (hostuje se data o klíčích, logování aktivací)
- Refund policy (14 dní?)

### Build s podpisem
- Code signing certifikát (Windows) — $100-300/rok, DigiCert / Sectigo / SSL.com; bez něj instalátor hází SmartScreen warning
- NSIS config: `oneClick: false`, `allowToChangeInstallationDirectory: true`, `license: "build/license.txt"`, `signingHashAlgorithms: ["sha256"]`, `signAndEditExecutable: true`
- Notarization (macOS) — Apple Developer $99/rok, `notarize: true` v electron-builder

### Rozšířit detekci typu projektu (přesunuto z v1.4)
- Monorepo detection (lerna/nx/turbo), build tool autodetekce (pnpm/yarn/bun), project meta pro kartu v Hubu (verze, repo URL)

## Git

- Autor: Martin Levinger (@Levisek)
- Origin není nastaven — nastav si sám: `git remote add origin <tvoje-url>`
