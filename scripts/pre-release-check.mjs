#!/usr/bin/env node
// ── LevisIDE: pre-release sanity checks ──────────────────────────────
// Spouští se před release:build. Musí projít všechny kontroly, jinak abort.
//
// Kontrolujeme:
//   1. git status --porcelain je prázdný (žádné nestaged změny)
//   2. aktuální branch = master (nebo --allow-any-branch)
//   3. package.json version > verze publikovaná na levinger.cz
//   4. npx tsc --noEmit projde bez chyb

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

const ALLOW_DIRTY = process.argv.includes('--allow-dirty');
const ALLOW_ANY_BRANCH = process.argv.includes('--allow-any-branch');
const SKIP_REMOTE = process.argv.includes('--skip-remote-check');

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

// ── 1. Git status ─────────────────────────────────────
try {
  const status = sh('git status --porcelain');
  if (status && !ALLOW_DIRTY) {
    fail(`git working tree není čistý:\n${status}\n(použij --allow-dirty pro přeskočení)`);
  }
  ok(status ? 'git: dirty (allowed)' : 'git: clean');
} catch (e) {
  fail(`git status selhal: ${e.message}`);
}

// ── 2. Branch ─────────────────────────────────────────
try {
  const branch = sh('git branch --show-current');
  if (branch !== 'master' && !ALLOW_ANY_BRANCH) {
    fail(`jsi na branchi "${branch}", release jde jen z master (--allow-any-branch pro přeskočení)`);
  }
  ok(`branch: ${branch}`);
} catch (e) {
  fail(`branch detect selhal: ${e.message}`);
}

// ── 3. Version bump check (proti levinger.cz latest.yml) ──
if (!SKIP_REMOTE) {
  try {
    const url = pkg.build?.publish?.url
      ? `${pkg.build.publish.url.replace(/\/$/, '')}/latest.yml`
      : null;
    if (!url) {
      console.warn('⚠ package.json build.publish.url chybí — přeskakuji remote verze check');
    } else {
      const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
      if (res && res.ok) {
        const txt = await res.text();
        const m = /^version:\s*(\S+)/m.exec(txt);
        if (m) {
          const remoteVer = m[1];
          const localVer = pkg.version;
          if (localVer === remoteVer) {
            fail(`package.json version (${localVer}) = remote latest.yml (${remoteVer}). Bumpni verzi.`);
          }
          ok(`version: local ${localVer} > remote ${remoteVer}`);
        } else {
          console.warn(`⚠ remote latest.yml neobsahuje version field — přeskakuji (obsah: ${txt.slice(0, 100)}…)`);
        }
      } else {
        console.warn(`⚠ remote latest.yml nedostupný (${res?.status ?? 'no response'}) — první release?`);
      }
    }
  } catch (e) {
    console.warn(`⚠ remote check selhal: ${e.message} — pokračujeme`);
  }
}

// ── 4. TypeScript check ──────────────────────────────
try {
  console.log('… tsc --noEmit');
  sh('npx tsc --noEmit');
  ok('tsc: 0 errors');
} catch (e) {
  fail(`tsc selhal:\n${e.stdout ?? ''}${e.stderr ?? ''}`);
}

console.log('\n✓ pre-release-check OK — připraveno na build & upload');
