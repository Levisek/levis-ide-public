import { ipcMain, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as readline from 'readline';
import log from 'electron-log';
import chokidar, { FSWatcher } from 'chokidar';

// ── Pricing per 1M tokens (USD) — Anthropic public pricing ──
// input | output | cache_write | cache_read
const PRICING: Record<string, { i: number; o: number; cw: number; cr: number }> = {
  'opus':    { i: 15,   o: 75,   cw: 18.75, cr: 1.50 },
  'sonnet':  { i: 3,    o: 15,   cw: 3.75,  cr: 0.30 },
  'haiku':   { i: 0.80, o: 4,    cw: 1.00,  cr: 0.08 },
};

function modelFamily(model: string): 'opus' | 'sonnet' | 'haiku' | 'unknown' {
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'unknown';
}

function costFor(model: string, u: { i: number; o: number; cw: number; cr: number }): number {
  const fam = modelFamily(model);
  if (fam === 'unknown') return 0;
  const p = PRICING[fam];
  return (u.i * p.i + u.o * p.o + u.cw * p.cw + u.cr * p.cr) / 1_000_000;
}

interface UsageEntry {
  ts: number;          // ms
  model: string;
  project: string;     // dir name under ~/.claude/projects/
  i: number;           // input tokens (uncached)
  o: number;           // output tokens
  cw: number;          // cache creation tokens
  cr: number;          // cache read tokens
  cost: number;
}

async function parseJsonlFile(filePath: string, project: string, seenMsgIds: Set<string>): Promise<UsageEntry[]> {
  const out: UsageEntry[] = [];
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line || line.indexOf('"usage"') === -1) return;
      try {
        const obj = JSON.parse(line);
        const msg = obj.message;
        if (!msg || !msg.usage || !msg.model) return;
        const msgId = msg.id;
        if (msgId) {
          if (seenMsgIds.has(msgId)) return;
          seenMsgIds.add(msgId);
        }
        const u = msg.usage;
        const i = u.input_tokens || 0;
        const o = u.output_tokens || 0;
        const cw = u.cache_creation_input_tokens || 0;
        const cr = u.cache_read_input_tokens || 0;
        if (i + o + cw + cr === 0) return;
        const ts = obj.timestamp ? Date.parse(obj.timestamp) : 0;
        const cost = costFor(msg.model, { i, o, cw, cr });
        out.push({ ts, model: msg.model, project, i, o, cw, cr, cost });
      } catch {}
    });
    rl.on('close', () => resolve(out));
    rl.on('error', () => resolve(out));
  });
}

let usageWatcher: FSWatcher | null = null;
let usageDebounce: NodeJS.Timeout | null = null;

function broadcastUsageUpdate(): void {
  if (usageDebounce) clearTimeout(usageDebounce);
  usageDebounce = setTimeout(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('usage:updated'); } catch {}
    }
  }, 250);
}

function startUsageWatcher(): void {
  if (usageWatcher) return;
  const fp = path.join(os.homedir(), '.claude', 'levis-usage.json');
  // chokidar zvládne i soubor, který zatím neexistuje — začne watch až se vytvoří
  usageWatcher = chokidar.watch(fp, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  usageWatcher.on('add', broadcastUsageUpdate);
  usageWatcher.on('change', broadcastUsageUpdate);
  usageWatcher.on('error', (err: unknown) => log.warn('usage watcher error:', err));
}

export function registerUsageHandlers(): void {
  startUsageWatcher();

  // ── Account info ─────────────────────────
  ipcMain.handle('usage:account', async () => {
    try {
      const cfgPath = path.join(os.homedir(), '.claude.json');
      const raw = fs.readFileSync(cfgPath, 'utf-8');
      const j = JSON.parse(raw);
      return j.oauthAccount || null;
    } catch (err) {
      return null;
    }
  });

  // ── Real rate limits z statusline dump souboru ──
  // Statusline-dump.js script zapise rate_limits + context_window do tohoto souboru
  // po kazdem requestu Claude Code. Hub to cte misto vlastniho odhadu.
  ipcMain.handle('usage:rateLimits', async () => {
    try {
      const fp = path.join(os.homedir(), '.claude', 'levis-usage.json');
      const raw = fs.readFileSync(fp, 'utf8');
      const data = JSON.parse(raw);
      return {
        capturedAt: data.capturedAt || null,
        rate_limits: data.rate_limits || null,
        context_window: data.context_window || null,
        model: data.raw?.model || null,
      };
    } catch {
      return null;
    }
  });

  // ── Scan all usage from ~/.claude/projects/**/*.jsonl ──
  ipcMain.handle('usage:scan', async () => {
    const root = path.join(os.homedir(), '.claude', 'projects');
    const all: UsageEntry[] = [];
    const seen = new Set<string>();
    try {
      const dirs = fs.readdirSync(root, { withFileTypes: true });
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const projDir = path.join(root, d.name);
        let files: string[] = [];
        try { files = fs.readdirSync(projDir).filter(f => f.endsWith('.jsonl')); } catch { continue; }
        for (const f of files) {
          const fp = path.join(projDir, f);
          const entries = await parseJsonlFile(fp, d.name, seen);
          for (const e of entries) all.push(e);
        }
      }
    } catch (err) {
      log.error('usage:scan failed:', err);
    }

    // ── Aggregate ─────────────────────────
    const now = Date.now();
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const todayMs = startOfDay.getTime();
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const monthMs = monthStart.getTime();
    const fiveHourAgo = now - 5 * 60 * 60 * 1000;

    function emptyBucket() { return { i: 0, o: 0, cw: 0, cr: 0, cost: 0, count: 0 }; }
    const totals = {
      all: emptyBucket(),
      today: emptyBucket(),
      month: emptyBucket(),
      block5h: emptyBucket(),
    };
    const perProject: Record<string, ReturnType<typeof emptyBucket>> = {};
    const perModel: Record<string, ReturnType<typeof emptyBucket>> = {};
    const dailySeries: Record<string, ReturnType<typeof emptyBucket>> = {}; // YYYY-MM-DD

    for (const e of all) {
      const add = (b: ReturnType<typeof emptyBucket>) => {
        b.i += e.i; b.o += e.o; b.cw += e.cw; b.cr += e.cr; b.cost += e.cost; b.count += 1;
      };
      add(totals.all);
      if (e.ts >= todayMs) add(totals.today);
      if (e.ts >= monthMs) add(totals.month);
      if (e.ts >= fiveHourAgo) add(totals.block5h);

      const projKey = e.project.replace(/^C--/, '').replace(/-/g, '/');
      if (!perProject[projKey]) perProject[projKey] = emptyBucket();
      add(perProject[projKey]);

      const fam = modelFamily(e.model);
      if (!perModel[fam]) perModel[fam] = emptyBucket();
      add(perModel[fam]);

      if (e.ts > 0) {
        const d = new Date(e.ts);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!dailySeries[key]) dailySeries[key] = emptyBucket();
        add(dailySeries[key]);
      }
    }

    return {
      totals,
      perProject,
      perModel,
      dailySeries,
      scanned: all.length,
      blockStartMs: fiveHourAgo,
      blockEndMs: now,
    };
  });
}
