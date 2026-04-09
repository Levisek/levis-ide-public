// ── CC state detector ─────────────────
// Heuristika pro detekci stavu Claude Code v terminálu na základě posledních
// 2 KB výstupu. Vrací 'idle' / 'working' / 'waiting'. Konzervativní — když si
// není jistý, vrátí 'working' (raději false-positive working než false-positive idle).

type CCState = 'idle' | 'working' | 'waiting';

// Patterny které značí že CC se ptá uživatele.
// Liberální přístup — raději false positive waiting než false negative.
const WAITING_PATTERNS: RegExp[] = [
  // === SILNÉ SIGNÁLY — CC interaktivní selection mode ===
  /Enter to select/i,           // CC selection footer
  /Tab.{0,15}Arrow.{0,20}navigate/i,
  /Esc to cancel/i,
  /Press \w+ to /i,
  // === Otázky ===
  /Do you want to /i,
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /\(yes\/no\)/i,
  /Approve [^?\n]{0,80}\?/i,
  /Allow [^?\n]{0,80}\?/i,
  /Continue\?/i,
  /Proceed\?/i,
  // === Numbered options 1./2. nebo 1)/2) — velmi liberální ===
  /\b1\.\s+\S[\s\S]{0,400}?\b2\.\s+\S/,
  /\b1\)\s+\S[\s\S]{0,400}?\b2\)\s+\S/,
  // CC arrow selector
  /[❯>›]\s*1\.\s/,
  /[❯>›]\s*Yes/i,
];

// Spinner = working
const WORKING_PATTERNS: RegExp[] = [
  /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/,                 // braille spinner (CC, ora, atd.)
];

// CC běží a čeká na vstup — vstupní box / prompt rámeček
const CC_RUNNING_PATTERNS: RegExp[] = [
  /│\s*>/,                       // CC vstupní pole (│ >  uvnitř box rámce)
  /╭─+╮/,                        // CC top border rámečku
  /╰─+╯/,                        // CC bottom border rámečku
];

// Patterny shell prompt (CC NEJEDE — idle).
// Jen klasické shell prompty BEZ CC rámečku okolo.
const SHELL_IDLE_PATTERNS: RegExp[] = [
  /(?:^|\n)PS [A-Za-z]:[^>\n]*>\s*$/m,                  // PowerShell prompt
  /(?:^|\n)[A-Za-z0-9_\-]+@[^\n]*[\$#]\s*$/m,          // bash user@host prompt
  /(?:^|\n)\$\s*$/m,                                    // jen $
];

class CCStateDetector {
  private buffer = '';
  // Hard limit aby regex nedostal příliš velký vstup (ReDoS prevence)
  private readonly maxBufferSize = 4096;

  feed(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.maxBufferSize);
    }
  }

  reset(): void {
    this.buffer = '';
  }

  detect(): CCState {
    // Strip ANSI escape sekvence pro spolehlivější regex
    const clean = this.buffer
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')   // CSI sequences
      .replace(/\x1b\][^\x07]*\x07/g, '')       // OSC sequences
      .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '') // other escapes
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ''); // control chars
    const tail = clean.slice(-3000);
    const recentTail = clean.slice(-500);
    const lowerTail = tail.toLowerCase();

    // 1. Shell prompt na konci = CC NEJEDE = idle (nejvyšší priorita —
    //    pokud je posledním znakem shell prompt, CC dávno doběhlo)
    for (const re of SHELL_IDLE_PATTERNS) {
      if (re.test(tail)) {
        if ((window as any).__levisCCDebug) console.log('[CC] idle via shell prompt');
        return 'idle';
      }
    }

    // 2. Explicit waiting markers — CC se aktivně ptá nebo je v selection
    const waitingSubstrings = [
      'askuserquestion', 'exitplanmode',
      'enter to select', 'tab/arrow', 'esc to cancel',
      'do you want to', '(y/n)', '[y/n]',
      'press enter', 'press any key', 'continue?', 'proceed?',
    ];
    for (const s of waitingSubstrings) {
      if (lowerTail.includes(s)) {
        if ((window as any).__levisCCDebug) console.log('[CC] waiting via substring:', s);
        return 'waiting';
      }
    }
    for (const re of WAITING_PATTERNS) {
      if (re.test(tail)) {
        if ((window as any).__levisCCDebug) console.log('[CC] waiting via regex:', re);
        return 'waiting';
      }
    }

    // 3. CC běží (vidíme box rámec) → waiting na input
    //    (priorita PŘED spinner — když vidíme box, CC zobrazuje vstupní pole
    //    a čeká na input, i kdyby v bufferu byla stará spinner stopa)
    for (const re of CC_RUNNING_PATTERNS) {
      if (re.test(recentTail)) {
        if ((window as any).__levisCCDebug) console.log('[CC] waiting — CC box visible');
        return 'waiting';
      }
    }

    // 4. Spinner v posledních ~300 znaků = working (až poslední — protože stale
    //    spinner v bufferu nemá přebít waiting box)
    const spinnerTail = clean.slice(-300);
    for (const re of WORKING_PATTERNS) {
      if (re.test(spinnerTail)) return 'working';
    }

    return 'idle';
  }
}

(window as any).CCStateDetector = CCStateDetector;
