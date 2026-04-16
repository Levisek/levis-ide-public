# LevisIDE — Privacy Policy / Ochrana soukromí

_Last updated / Poslední aktualizace: 2026-04-16_

---

## TL;DR

**LevisIDE does NOT collect telemetry, analytics, or tracking data.**
**LevisIDE NESHROMAŽĎUJE telemetrii, analytiku ani sledovací data.**

---

## English

### What data LevisIDE sends out

LevisIDE is a local desktop application. The **only** network traffic it generates on its own is:

1. **Auto-update check** — once per application start, LevisIDE fetches
   `https://levinger.cz/levis-ide/updates/latest/latest.yml` to check whether
   a new version is available. The request contains only standard HTTP headers
   (User-Agent including app version and OS). No user data is transmitted.

2. **Claude Code** — when you explicitly trigger a prompt, an Inspector action,
   or any feature that calls Anthropic's Claude Code CLI, the content you wrote
   is sent to Anthropic under their own Terms of Service and Privacy Policy.
   LevisIDE acts only as a local UI; it does not modify, log, or forward that
   content anywhere else.

3. **Feedback form (optional, opt-in)** — if you explicitly submit feedback
   through the built-in Feedback form, the message is sent either to GitHub
   Issues (public) or to a PHP endpoint on `levinger.cz` (CAPTCHA protected).
   No data is sent unless you press the Submit button.

### What LevisIDE stores locally

- **`%APPDATA%\LevisIDE\config.json`** — your preferences (window size, theme,
  scan path, project colors, recent projects). Never transmitted.
- **`%APPDATA%\LevisIDE\logs\`** — electron-log files for debugging, rotated.
  Never transmitted unless you manually attach them to a bug report.
- **`.levis-tmp/`** (inside each project) — temporary screenshots for lasso→CC
  flow. Auto-deleted after 30 seconds.

### Billing hook (opt-in)

If you explicitly enable the "Live billing sync" feature:
- A small script (`levis-usage-dump.js`) is written to `~/.claude/scripts/`.
- Your `~/.claude/settings.json` is modified to add a `statusLine` entry that
  runs this script after each Claude Code invocation.
- The script reads rate-limit data from Claude Code's JSON output and writes
  a snapshot to `~/.claude/levis-usage.json`, read locally by LevisIDE's Hub.
- **Nothing leaves your machine.** Disable anytime in Settings → Live billing
  sync → Uninstall.

### What LevisIDE does NOT do

- No Google Analytics, Sentry, PostHog, Mixpanel, or any other third-party
  telemetry.
- No "phone home" heartbeat.
- No reading, uploading, or indexing of your source code.
- No fingerprinting, device tracking, or cookie-like identifiers.

---

## Česky

### Jaká data LevisIDE odesílá

LevisIDE je lokální desktopová aplikace. **Jediné** síťové požadavky, které
sama generuje, jsou:

1. **Kontrola aktualizací** — jednou při startu aplikace stáhne
   `https://levinger.cz/levis-ide/updates/latest/latest.yml` pro detekci nové
   verze. Požadavek obsahuje pouze standardní HTTP hlavičky (User-Agent
   s verzí aplikace a OS). Nepřenáší žádná uživatelská data.

2. **Claude Code** — pokud výslovně spustíte prompt, Inspector akci nebo
   jakoukoli funkci, která volá Claude Code CLI od Anthropic, Vámi napsaný
   obsah je odeslán přímo Anthropic za jejich vlastních podmínek služby
   a zásad ochrany soukromí. LevisIDE slouží pouze jako lokální rozhraní;
   obsah nemodifikuje, neloguje ani nikam jinam nepřeposílá.

3. **Formulář zpětné vazby (volitelný)** — pokud přes vestavěný formulář
   výslovně odešlete zprávu, bude předána buď na GitHub Issues (veřejné),
   nebo na PHP endpoint na `levinger.cz` (chráněný CAPTCHA). Bez Vašeho
   kliknutí na "Odeslat" nic neodchází.

### Co LevisIDE ukládá lokálně

- **`%APPDATA%\LevisIDE\config.json`** — Vaše preference (velikost okna,
  téma, cesta ke scanu, barvy projektů, recent projekty). Nikdy neodesíláno.
- **`%APPDATA%\LevisIDE\logs\`** — logy electron-logu pro debugging, rotovány.
  Nikdy neodesíláno, dokud je ručně nepřipojíte k bug reportu.
- **`.levis-tmp/`** (uvnitř každého projektu) — dočasné screenshoty pro
  lasso → CC flow. Automaticky mazáno po 30 sekundách.

### Billing hook (opt-in)

Pokud výslovně povolíte funkci "Live billing sync":
- Malý skript (`levis-usage-dump.js`) je zapsán do `~/.claude/scripts/`.
- Váš soubor `~/.claude/settings.json` je upraven o `statusLine` položku,
  která tento skript spouští po každém volání Claude Code.
- Skript čte data o rate-limitech z JSON výstupu Claude Code a zapisuje
  snapshot do `~/.claude/levis-usage.json`, který čte lokálně Hub LevisIDE.
- **Nic neopouští Váš počítač.** Kdykoli vypněte v Nastavení → Live billing
  sync → Vypnout.

### Co LevisIDE NEDĚLÁ

- Žádný Google Analytics, Sentry, PostHog, Mixpanel ani jinou třetí-stranou
  telemetrii.
- Žádné "phone home" heartbeaty.
- Nečte, neodesílá ani neindexuje Váš zdrojový kód.
- Žádný fingerprinting, tracking zařízení ani cookie-like identifikátory.

---

## Contact / Kontakt

**Author / Autor:** Martin Levinger
**Email:** martin@levinger.cz
**Web:** https://levinger.cz

Questions, concerns, or data removal requests: send an email. We respond within
30 days per GDPR requirements.

Dotazy, připomínky nebo žádosti o výmaz dat: pošlete e-mail. Odpovídáme do
30 dní dle požadavků GDPR.
