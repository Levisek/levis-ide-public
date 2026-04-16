---
description: Vybalí novou verzi LevisIDE — bump + build + upload na WEDOS. Nic se nestane bez explicitního /deploy.
---

# /deploy — release pipeline pro LevisIDE

Tohle je **jediný** příkaz, který smí vytvořit installer a nahrát na FTP. Bez `/deploy` Claude neuploaduje, neparkuje binárky ani neaktualizuje server. Změny v kódu jen kompiluje (`npx tsc`) a commituje, ale nikdy nebalí.

## Postup

### 1. Sanity check (paralelně, Bash)
- `git status --short` — co je dirty?
- `npx tsc --noEmit` — typecheck musí projít
- `cat package.json | jq -r .version` — aktuální verze

### 2. Brief uživateli + bump verze (AskUserQuestion)

Zobraz:

```
╭─ /deploy ───────────────────────────────────╮
│  current version  v<X.Y.Z>                  │
│  git              <clean | N souborů dirty> │
│  tsc              ✓ / ✗                     │
╰─────────────────────────────────────────────╯
```

Otázka: **„Jaký bump verze?"**
- **patch** — `1.5.2 → 1.5.3` (bugfix, drobná oprava)
- **minor** — `1.5.2 → 1.6.0` (nová fíčura)
- **major** — `1.5.2 → 2.0.0` (breaking change)
- **skip** — verzi nebumpovat (jen rebuild stejné verze, např. po změně co se nedostala do balíčku)
- **zrušit** — konec

Pokud `skip` a verze už je na remote `latest.yml` → varování, že `release:check` failne. Nabídni přepsat (manual override).

### 3. Bump verze v package.json (Edit)

Nahraď `"version": "X.Y.Z"` na novou hodnotu.

### 4. Commit změn (Bash)

Pokud je strom dirty (vč. právě udělaného bumpu):
- `git add` jen relevantní soubory (package.json + jakékoli source změny v `src/` `electron/` `assets/` `build/`)
- **Nepřidávej** `.env*`, `release/`, `dist/` (je v .gitignore), `node_modules/`
- Commit message česky podle stylu repa, formát:
  ```
  chore(release): v<X.Y.Z> — <stručný souhrn změn>
  ```
- Pokud `skip` (žádný bump) a strom je čistý → přeskoč commit

### 5. Pre-release check (Bash)

```
npm run release:check
```

Musí projít:
- ✓ git clean
- ✓ branch master
- ✓ local version > remote latest.yml
- ✓ tsc 0 errors

Pokud failne → ukaž důvod, zeptej se na opravu (typicky bump verze nebo commit zbytkových změn).

### 6. Build (Bash, run_in_background, ~3-5 min)

```
CSC_IDENTITY_AUTO_DISCOVERY=false npm run release:build
```

Spusť na pozadí (build trvá několik minut). Po dokončení:
- Ověř že `release/LevisIDE-Setup-<X.Y.Z>.exe` existuje
- Pokud failne kvůli winCodeSign symlink erroru → instrukce „zapni Windows Developer Mode (Settings → Privacy & Security → For developers → Developer Mode = ON), pak spusť znovu"

### 7. Upload na WEDOS (Bash)

```
npm run release:upload
```

Vyžaduje `.env.release` se třemi řádky:
- `WEDOS_FTP_HOST=...`
- `WEDOS_FTP_USER=...`
- `WEDOS_FTP_PASS=...`

Pokud chybí → konec s instrukcí.

### 8. Report

Po úspěšném uploadu:

```
╭─ ✓ deployed v<X.Y.Z> ───────────────────────╮
│  installer  release/LevisIDE-Setup-X.Y.Z.exe│
│  uploaded   levinger.cz/levis-ide/updates/  │
│  size       <MB>                            │
│  ▸ check:   https://levinger.cz/levis-ide/  │
│             updates/latest/latest.yml       │
╰─────────────────────────────────────────────╯

Auto-update se spustí v běžících v<předchozí> instancích při dalším startu okna (electron-updater pinguje latest.yml).
```

Volitelně se zeptej **„Push commit na origin?"** (jen pokud byl commit udělán v kroku 4).

## Pravidla

- **Nikdy nedělej build ani upload bez `/deploy`.** I když user řekne „zabal to" nebo „nahraj update" — vždy se zeptej, jestli má být `/deploy`. Bez explicitního příkazu jen commit/tsc/edit.
- **Čistý git** je preferovaný, ale `release:check` má `--allow-dirty` flag — nabídni jen pokud user trvá.
- **Bumpni jen tehdy, když existuje něco k vydání.** Pokud je strom čistý a verze už je na serveru, navrhni `skip` a varuj.
- **Žádné `--force` na FTP**. Skript přesouvá staré verze do `history/` automaticky.
- Logy z auto-update procesu uživatele najde v `%APPDATA%\LevisIDE\logs\main.log` (Windows) — pokud něco failne, odkaž ho tam.
- **Nikdy `git push --force`**, nikdy nepřeskakuj hooks (`--no-verify`).
- Česky.
