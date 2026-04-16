#!/usr/bin/env node
// LevisIDE — usage dump hook
// Spouští Claude Code jako statusLine command. Dostane JSON ze stdin
// (rate_limits, context_window, model, session_id, cwd, ...).
//
// Co skript dělá:
//   1) zapíše snapshot do ~/.claude/levis-usage.json (čte Hub billing panel)
//   2) pokud je nastaven "wrapper mode" (~/.claude/levis-wrapper.json má innerCommand),
//      předá vstup do user's původního statusline skriptu a vrátí jeho výstup
//   3) jinak vypíše minimální status řádek (project · model)
//
// Bez závislostí — jen core Node modules.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  let data = {};
  try { data = input ? JSON.parse(input) : {}; } catch {}

  // 1) Dump pro LevisIDE Hub
  try {
    const dump = {
      capturedAt: Date.now(),
      raw: data,
      rate_limits: data.rate_limits || null,
      context_window: data.context_window || null,
      model: data.model || null,
    };
    const dumpPath = path.join(os.homedir(), '.claude', 'levis-usage.json');
    fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
    fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2));
  } catch (_err) {
    // tichá chyba — nesmíme rozbít CC statusline
  }

  // 2) Wrapper mode — předej vstup do user's inner statusline
  let innerCmd = null;
  try {
    const cfgPath = path.join(os.homedir(), '.claude', 'levis-wrapper.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    innerCmd = (cfg && cfg.innerCommand) || null;
  } catch {}

  if (innerCmd) {
    try {
      const r = spawnSync(innerCmd, { input, shell: true, encoding: 'utf8', timeout: 5000 });
      if (r.stdout) process.stdout.write(r.stdout);
      return;
    } catch {
      // fallthrough do default statusu
    }
  }

  // 3) Default minimal status
  try {
    const model = (data.model && (data.model.display_name || data.model.id)) || '';
    const cwd = (data.workspace && data.workspace.current_dir) || data.cwd || '';
    const cwdName = String(cwd).split(/[\\\/]/).filter(Boolean).pop() || '';
    const parts = [cwdName, model].filter(Boolean);
    process.stdout.write(parts.join(' · '));
  } catch {
    process.stdout.write('');
  }
});
