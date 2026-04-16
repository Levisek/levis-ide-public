# LevisIDE release scripts

## Release workflow

```bash
npm run release:check     # validace (git clean, branch, tsc, remote version)
npm run release:build     # tsc + electron-builder --win bez rebuild
npm run release:upload    # FTP upload na levinger.cz

npm run release           # všechno dohromady
```

## `.env.release` (nutné pro upload)

Vytvoř soubor `.env.release` v kořeni repa (v `.gitignore`):

```
WEDOS_FTP_HOST=ftp.levinger.cz
WEDOS_FTP_USER=your_ftp_user
WEDOS_FTP_PASS=your_ftp_password
WEDOS_FTP_SECURE=true
```

## Co skripty dělají

### `pre-release-check.mjs`
1. `git status --porcelain` je prázdný (nebo `--allow-dirty`)
2. branch = `master` (nebo `--allow-any-branch`)
3. `package.json` version > remote `latest.yml` verze (nebo `--skip-remote-check`)
4. `npx tsc --noEmit` = 0 errors

### `upload-release.mjs`
1. Připojí FTP k levinger.cz
2. Přesune starou verzi z `/latest/` do `/history/`
3. Uploadne nové `LevisIDE-Setup-${version}.exe`, `.exe.blockmap`, `latest.yml`
4. Smaže z `/history/` všechno kromě posledních 5 verzí

## Server-side struktura

Hosting pod hlavní doménou **levinger.cz** (není nutné kupovat novou doménu).
WEDOS path: `/www/domains/levinger.cz/levis-ide/`

**Souborová struktura na serveru:**
```
/www/domains/levinger.cz/
└── levis-ide/
    └── updates/
        ├── .htaccess               ← zkopíruj z build/updates.htaccess
        ├── latest/
        │   ├── LevisIDE-Setup-1.5.1.exe
        │   ├── LevisIDE-Setup-1.5.1.exe.blockmap
        │   └── latest.yml          ← electron-updater čte odsud
        └── history/
            ├── LevisIDE-Setup-1.5.0.exe
            └── ...
```

**Veřejné URL:**
- `https://levinger.cz/levis-ide/updates/latest/latest.yml`
- `https://levinger.cz/levis-ide/updates/latest/LevisIDE-Setup-1.5.1.exe`

**První setup na hostingu** (ruční, jednou):
1. FTP do `/www/domains/levinger.cz/`
2. Vytvoř složku `levis-ide/updates/latest/` a `levis-ide/updates/history/`
3. Zkopíruj `build/updates.htaccess` → `/www/domains/levinger.cz/levis-ide/updates/.htaccess`
4. `npm run release` pak nahraje artefakty automaticky

Viz `build/updates.htaccess` pro Content-Type hlavičky (text/yaml, no-cache latest.yml, immutable .exe).
