#!/usr/bin/env node
// ── LevisIDE: upload build artefaktů na levinger.cz přes FTP ─────────
// Nahraje z release/ na FTP:
//   /levis-ide/updates/latest/LevisIDE-Setup-${version}.exe
//   /levis-ide/updates/latest/LevisIDE-Setup-${version}.exe.blockmap
//   /levis-ide/updates/latest/latest.yml
//
// Před uploadem přesune předchozí latest do /history/ (keep last 5 versions).
//
// Env (načtené z .env.release nebo shell):
//   WEDOS_FTP_HOST     = ftp.levinger.cz
//   WEDOS_FTP_USER     = ...
//   WEDOS_FTP_PASS     = ...
//   WEDOS_FTP_SECURE   = "true" (FTPS)|"false"

import * as ftp from 'basic-ftp';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const RELEASE_DIR = resolve(ROOT, 'release');

// ── Načíst env.release pokud existuje ──
const ENV_FILE = resolve(ROOT, '.env.release');
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !m[1].startsWith('#')) {
      process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const HOST = process.env.WEDOS_FTP_HOST;
const USER = process.env.WEDOS_FTP_USER;
const PASS = process.env.WEDOS_FTP_PASS;
const SECURE = (process.env.WEDOS_FTP_SECURE ?? 'true') === 'true';

if (!HOST || !USER || !PASS) {
  console.error('✗ Chybí FTP credentials (WEDOS_FTP_HOST / USER / PASS).');
  console.error('  Vytvoř .env.release se třemi řádky, nebo exportuj env vars.');
  process.exit(1);
}

// ── Soubory k uploadu ──
const EXE_NAME = `LevisIDE-Setup-${VERSION}.exe`;
const FILES = [
  { local: resolve(RELEASE_DIR, EXE_NAME), remote: EXE_NAME, required: true },
  { local: resolve(RELEASE_DIR, EXE_NAME + '.blockmap'), remote: EXE_NAME + '.blockmap', required: true },
  { local: resolve(RELEASE_DIR, 'latest.yml'), remote: 'latest.yml', required: true },
];

// Ověř že všechno existuje
for (const f of FILES) {
  if (!existsSync(f.local)) {
    if (f.required) {
      console.error(`✗ Chybí: ${f.local}`);
      console.error('  Spusť nejdřív: npm run release:build');
      process.exit(1);
    }
  } else {
    const sz = (statSync(f.local).size / 1024 / 1024).toFixed(1);
    console.log(`  ${f.remote} (${sz} MB)`);
  }
}

const REMOTE_BASE = '/levis-ide/updates';
const REMOTE_LATEST = `${REMOTE_BASE}/latest`;
const REMOTE_HISTORY = `${REMOTE_BASE}/history`;

const client = new ftp.Client(30000);
client.ftp.verbose = false;

try {
  console.log(`\n→ Připojuji se k ${HOST}…`);
  await client.access({ host: HOST, user: USER, password: PASS, secure: SECURE });
  console.log('✓ connected');

  // Zajisti cílové složky
  await client.ensureDir(REMOTE_LATEST);
  await client.ensureDir(REMOTE_HISTORY);
  await client.cd(REMOTE_LATEST);

  // Přesuň předchozí EXE (pokud existuje jiné verze než ta, kterou uploadujeme)
  console.log('\n→ Cleanup latest/ (přesouvám starou verzi do history/)…');
  try {
    const list = await client.list();
    for (const item of list) {
      if (item.isFile && item.name.startsWith('LevisIDE-Setup-') && item.name !== EXE_NAME && item.name !== EXE_NAME + '.blockmap') {
        const src = `${REMOTE_LATEST}/${item.name}`;
        const dst = `${REMOTE_HISTORY}/${item.name}`;
        try {
          await client.rename(src, dst);
          console.log(`  ↪ ${item.name} → history/`);
        } catch (e) {
          console.warn(`  ⚠ rename ${item.name} selhal: ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.warn(`  ⚠ list latest/ selhal: ${e.message}`);
  }

  // Upload nových souborů
  console.log('\n→ Upload…');
  for (const f of FILES) {
    if (!existsSync(f.local)) continue;
    const sz = (statSync(f.local).size / 1024 / 1024).toFixed(1);
    process.stdout.write(`  ↑ ${f.remote} (${sz} MB) …`);
    const t0 = Date.now();
    await client.uploadFrom(f.local, f.remote);
    process.stdout.write(` ok (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  }

  // Cleanup history: keep last 5 verzí
  console.log('\n→ History cleanup (keep last 5 versions)…');
  try {
    await client.cd(REMOTE_HISTORY);
    const hist = await client.list();
    const exeFiles = hist
      .filter((i) => i.isFile && /^LevisIDE-Setup-.*\.exe$/.test(i.name))
      .sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0));
    for (const item of exeFiles.slice(5)) {
      try {
        await client.remove(item.name);
        const bm = item.name + '.blockmap';
        if (hist.some((h) => h.name === bm)) await client.remove(bm);
        console.log(`  ✕ ${item.name}`);
      } catch (e) {
        console.warn(`  ⚠ delete ${item.name} selhal: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`  ⚠ history cleanup selhal: ${e.message}`);
  }

  console.log(`\n✓ Upload dokončen: https://levinger.cz${REMOTE_LATEST}/latest.yml`);
} catch (e) {
  console.error(`\n✗ FTP selhal: ${e.message}`);
  process.exit(1);
} finally {
  client.close();
}
