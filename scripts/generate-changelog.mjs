#!/usr/bin/env node
// ── Generuje dist/changelog.json z git historie ──────────────────────
// Najde commits, kde se v package.json změnila "version", vezme commit
// message + datum, výstup top N entries (newest first).
//
// Spouští se před build (tsc) — viz package.json scripts.

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'dist', 'changelog.json');
const MAX_ENTRIES = 8;

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function getCurrentPkgVersion() {
  return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
}

function shortenSummary(msg) {
  // Odstraní conventional-commit prefix (feat:, fix(scope):, chore(release):, …)
  return msg
    .replace(/^[a-z]+(?:\([^)]+\))?:\s*/i, '')
    .replace(/\s+—\s+.*$/, '')   // useknout vše za "—" (delší doplnění)
    .trim();
}

function collect() {
  // Všechny commits, které se dotkly package.json (oneline, newest first)
  const raw = sh('git log --pretty=format:"%H|%cs|%s" -- package.json');
  if (!raw) return [];

  const entries = [];
  const seen = new Set();

  for (const line of raw.split('\n')) {
    const sep1 = line.indexOf('|');
    const sep2 = line.indexOf('|', sep1 + 1);
    if (sep1 < 0 || sep2 < 0) continue;
    const hash = line.slice(0, sep1);
    const date = line.slice(sep1 + 1, sep2);
    const msg = line.slice(sep2 + 1);

    let version;
    try {
      const pkg = JSON.parse(sh(`git show ${hash}:package.json`));
      version = pkg.version;
    } catch {
      continue;
    }
    if (!version || seen.has(version)) continue;
    seen.add(version);
    entries.push({ version, date, summary: shortenSummary(msg) });
    if (entries.length >= MAX_ENTRIES) break;
  }

  // Pokud aktuální package.json verze nemá entry (např. nezacommitnuto), přidej ji
  const cur = getCurrentPkgVersion();
  if (!seen.has(cur)) {
    entries.unshift({
      version: cur,
      date: new Date().toISOString().slice(0, 10),
      summary: '(work in progress)',
    });
  }

  return entries;
}

const entries = collect();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), entries }, null, 2));
console.log(`✓ changelog.json (${entries.length} entries) → dist/changelog.json`);
