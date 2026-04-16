# Changelog

Formát podle [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), verze podle [SemVer](https://semver.org/).

## [1.5.0] — 2026-04-16

### Přidáno
- **Rozšířená detekce typů projektů** (~40 typů) — detekce čistě statická (čte soubory ve složce, bez localhost pollu):
  - Node ekosystém: Next.js, Nuxt, Vite, React, SvelteKit, Astro, Angular, Remix, Gatsby, NestJS, Expo, Electron, Tauri, Deno, Bun
  - Python: Django, Flask, FastAPI, Streamlit, Gradio, generic (requirements.txt / pyproject.toml / *.py)
  - Ruby: Rails, Jekyll, generic (Gemfile)
  - PHP: Laravel, Symfony, WordPress, generic
  - Compiled: Go, Rust, .NET, Java, Kotlin, Spring Boot, Elixir, Phoenix, Crystal, Haskell, OCaml, Zig, Nim
  - SSG: Hugo, MkDocs, Docusaurus, VitePress
  - Ostatní: Docker Compose, Flutter, Jupyter notebooks
- **Hub drag mezi statusy** — přetáhni dlaždici z Active do Paused/Finished (a zpět) pro změnu stavu projektu, uloženo persistentně
- **Middle-click na tab projektu** jej zavře
- **Kompaktní changelog v patě Hubu** pod LevisIDE™ trademarkem (3 poslední verze + odkaz na celý changelog)
- **Create desktop shortcut** — tlačítko v Hub → Nastavení, plus standalone `create-desktop-shortcut.bat` v kořeni
- **Onboarding .bat skripty** v kořeni: `install.bat`, `build.bat` pro kolegy bez CLI workflow
- **AUTOSTART** doplněn o spouštěcí příkazy a porty pro všechny nové typy projektů (flask run, uvicorn, streamlit, php artisan, mkdocs, hugo server, phoenix, dotnet run atd.)

### Změněno
- Dev-server probe timeout `30s → 120s` (konstanta `PORT_PROBE_TIMEOUT_MS`) — stíhají i pomalejší backendy (Spring Boot, Next prod build, Flask s DB init)
- Refresh browseru při focus okna běží jen po skutečném blur (předtím trigger i při interních klicích webview → sidebar)
- Help overlay (F1) scrollbar stylizovaný pro viditelnost (webkit custom scrollbar, track/thumb kontrast)

### Odstraněno
- Badge fajfky u dlaždic se statusem Finished (stav vyjadřuje sekce + opacity)

## [1.4.2] — 2026-04-15

- **Hub:** interaktivní drag & drop přes SortableJS (dlaždice se živě odsouvají), sort presety, bulk actions (Shift/Ctrl multi-select), Typ filter dropdown místo chip řady
- **Workspace:** Launch picker pro ambiguous entry pointy, browser loader overlay, port collision handling (paralelní PTY regex + alt port detection), mobile default 150% zoom
- **Inspector:** SPA-safe (blokuje navigaci React/Next routerů), chytré selektory (filter hashed classes, prefer aria/testid/text), Pin URL toggle
- **Vizuální:** sjednocené focus indikátory, token-based popover barvy (light theme fix), terminal mid theme bg odlišen, legenda symbolů přesunuta do F1
- **Kompatibilita:** klávesy sjednoceny pod `Ctrl+Shift+` prefix, dirty modal focus trap + autofocus
- **Build:** NSIS installer vytvoří desktop + start menu shortcut

## [1.4.0]

- Témata: 3 schémata (Dark/Mid/Light warm), dark-soft odstraněn
- Hub: velikost projektu na dlaždicích, recent files, drag & drop řazení, icon-only toolbar
- Queue UI: vizuální správa prompt fronty (badge + popup + cancel)
- File tree: multi-select, keyboard shortcuts, context menu na složkách, zachování stavu
- Desktop drag: soubory z plochy do terminálu
- Status bar: velikost projektu + info o vybraném souboru
- Inspect/annotate auto-reset po odeslání

## [1.3.0]

- Feedback formulář, logo/ikona, drag-back, editor handshake
- Tab badge, zvukové + OS notifikace, session persistence
- Split-handle + term-splitter fix, CC waiting detector fix

## [1.2.0]

- Čistý terminal (toolbar odstraněn), popout multi-terminal
- Browser toolbar ikony-only, nové šablony (React/Vue/Svelte/Next/Astro)

## [1.1.0]

- Sloučení panelů (Preview+Browser+Mobile → Browser)
- Témata, per-projekt barvy, prompt fronta, file tree ikony

## [1.0.0]

- První release — workspace grid, drag-out, inspector, lasso screenshot
