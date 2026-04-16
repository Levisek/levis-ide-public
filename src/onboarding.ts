// ── LevisIDE onboarding flow ─────────────────────────────────────────
//
// Volá se z app.ts po inicializaci, ale ne během příchozího prompt handleru.
// Runs sequentially:
//   1. Welcome tour (4-step feature showcase) — pokud !welcomeSeen
//   2. Claude Code detection & install offer    — pokud !ccInstalled && !ccInstallOffered
//   3. Claude Code login prompt                 — pokud ccInstalled && !ccLoginOffered
//   4. Billing hook opt-in                      — pokud !billingHookPromptSeen
//
// Každý krok si uživatel může odložit (*Teď ne*) — flagy se uloží do store
// tak, aby to neobtěžovalo při dalším startu.

type StepResult = 'done' | 'skipped' | 'postponed';

interface WelcomeSlide {
  titleKey: string;
  bodyKey: string;
}

const WELCOME_SLIDES: WelcomeSlide[] = [
  { titleKey: 'welcome.slide1.title', bodyKey: 'welcome.slide1.body' },
  { titleKey: 'welcome.slide2.title', bodyKey: 'welcome.slide2.body' },
  { titleKey: 'welcome.slide3.title', bodyKey: 'welcome.slide3.body' },
  { titleKey: 'welcome.slide4.title', bodyKey: 'welcome.slide4.body' },
];

// ── Modal helper ────────────────────────────────────────────────────
interface ModalButton {
  labelKey: string;
  primary?: boolean;
  onClick: () => void | Promise<void>;
}

function showModal(opts: {
  titleKey: string;
  bodyHtml: string;
  buttons: ModalButton[];
  wide?: boolean;
  onRender?: (modal: HTMLElement) => void;
}): HTMLElement {
  // Odeber předchozí onboarding modal
  document.querySelector('.onboarding-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'onboarding-backdrop';
  backdrop.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:rgba(0,0,0,0.7)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'backdrop-filter:blur(6px)',
  ].join(';');

  const modal = document.createElement('div');
  modal.className = 'onboarding-modal';
  modal.style.cssText = [
    `max-width:${opts.wide ? '680px' : '520px'}`,
    'width:90vw',
    'max-height:90vh',
    'overflow-y:auto',
    'background:var(--bg-elev-1,#1e2029)',
    'border:1px solid var(--border-strong,#3a3d4b)',
    'border-radius:12px',
    'padding:28px 32px',
    'box-shadow:0 20px 60px rgba(0,0,0,0.5)',
    'color:var(--text,#e8e8f0)',
    'font-family:Inter,system-ui,sans-serif',
  ].join(';');

  const title = document.createElement('h2');
  title.textContent = t(opts.titleKey);
  title.style.cssText = 'margin:0 0 16px 0;font-size:20px;font-weight:600';
  modal.appendChild(title);

  const body = document.createElement('div');
  body.className = 'onboarding-body';
  body.style.cssText = 'font-size:14px;line-height:1.6;color:var(--text-dim,#b8bac8);margin-bottom:24px';
  body.innerHTML = opts.bodyHtml;
  modal.appendChild(body);

  const btnBar = document.createElement('div');
  btnBar.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap';
  for (const b of opts.buttons) {
    const btn = document.createElement('button');
    btn.textContent = t(b.labelKey);
    btn.className = b.primary ? 'onboarding-btn-primary' : 'onboarding-btn-secondary';
    btn.style.cssText = [
      'padding:10px 20px',
      'border-radius:8px',
      'font-size:14px',
      'font-weight:500',
      'cursor:pointer',
      'font-family:inherit',
      b.primary
        ? 'background:var(--accent,#ff7a1a);border:1px solid var(--accent,#ff7a1a);color:#fff'
        : 'background:var(--bg-elev-2,#272a35);border:1px solid var(--border-strong,#3a3d4b);color:var(--text,#e8e8f0)',
    ].join(';');
    btn.addEventListener('click', async () => {
      try { await b.onClick(); } catch (e) { console.error('[onboarding btn]', e); }
    });
    btnBar.appendChild(btn);
  }
  modal.appendChild(btnBar);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  if (opts.onRender) opts.onRender(modal);
  return backdrop;
}

function closeModal(): void {
  document.querySelector('.onboarding-backdrop')?.remove();
}

// ── Welcome tour ────────────────────────────────────────────────────
function runWelcomeTour(): Promise<StepResult> {
  return new Promise((resolve) => {
    let idx = 0;

    function renderSlide(): void {
      const s = WELCOME_SLIDES[idx];
      const isLast = idx === WELCOME_SLIDES.length - 1;
      const dots = WELCOME_SLIDES.map((_, i) =>
        `<span style="width:8px;height:8px;border-radius:50%;background:${i === idx ? 'var(--accent,#ff7a1a)' : 'var(--border,#2d303c)'};display:inline-block;margin-right:6px"></span>`
      ).join('');

      const bodyHtml = `
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:var(--accent,#ff7a1a);font-weight:600;margin-bottom:14px">${t('welcome.stepLabel', { current: idx + 1, total: WELCOME_SLIDES.length })}</div>
        <div style="font-size:15px;line-height:1.65">${t(s.bodyKey)}</div>
        <div style="margin-top:28px;text-align:center">${dots}</div>
      `;

      const buttons: ModalButton[] = [];
      if (idx > 0) {
        buttons.push({ labelKey: 'welcome.nav.back', onClick: () => { idx--; renderSlide(); } });
      }
      buttons.push({ labelKey: 'welcome.nav.skip', onClick: () => { closeModal(); resolve('skipped'); } });
      buttons.push({
        labelKey: isLast ? 'welcome.nav.finish' : 'welcome.nav.next',
        primary: true,
        onClick: () => {
          if (isLast) { closeModal(); resolve('done'); }
          else { idx++; renderSlide(); }
        },
      });

      showModal({
        titleKey: s.titleKey,
        bodyHtml,
        buttons,
        wide: true,
      });
    }

    renderSlide();
  });
}

// ── CC install step ─────────────────────────────────────────────────
function runCcInstallStep(): Promise<StepResult> {
  return new Promise(async (resolve) => {
    const { cmd, docsUrl } = await levis.ccInstallCommand();

    const bodyHtml = `
      <p>${t('onboarding.ccInstallBody')}</p>
      <p style="margin-top:12px;padding:10px;background:var(--bg-deep,#0d0f14);border:1px solid var(--border,#2d303c);border-radius:6px;font-family:monospace;font-size:12px;color:var(--text,#e8e8f0);overflow-x:auto;white-space:nowrap">${cmd.trim()}</p>
    `;

    showModal({
      titleKey: 'onboarding.ccInstallTitle',
      bodyHtml,
      buttons: [
        { labelKey: 'onboarding.ccInstallSkip', onClick: () => { closeModal(); resolve('skipped'); } },
        {
          labelKey: 'onboarding.ccInstallDocs',
          onClick: () => { levis.openExternal(docsUrl); },
        },
        {
          labelKey: 'onboarding.ccInstallRun',
          primary: true,
          onClick: async () => {
            closeModal();
            // Zobrazit info toast, skutečnou instalaci spustí user zkopírováním
            // cmd do terminálu — bezpečnější než auto-run skript bez user awareness.
            // (Fallback: postpone — user sám spustí, my po restartu znovu zkontrolujeme.)
            const st: any = (window as any).showToast;
            if (st) st(t('onboarding.ccInstallCopied'), 'info');
            try { await levis.clipboardWrite(cmd.trim()); } catch {}
            resolve('done');
          },
        },
      ],
      wide: true,
    });
  });
}

// ── CC login step ───────────────────────────────────────────────────
function runCcLoginStep(): Promise<StepResult> {
  return new Promise((resolve) => {
    showModal({
      titleKey: 'onboarding.ccLoginTitle',
      bodyHtml: `<p>${t('onboarding.ccLoginBody')}</p>`,
      buttons: [
        { labelKey: 'onboarding.ccLoginLater', onClick: () => { closeModal(); resolve('postponed'); } },
        {
          labelKey: 'onboarding.ccLoginSignup',
          onClick: () => { levis.openExternal('https://claude.ai/signup'); },
        },
        {
          labelKey: 'onboarding.ccLoginRun',
          primary: true,
          onClick: () => {
            closeModal();
            // Login je interaktivní v CC — user zkopíruje příkaz nebo ho spustíme jako hint
            const st: any = (window as any).showToast;
            if (st) st(t('onboarding.ccLoginHint'), 'info');
            resolve('done');
          },
        },
      ],
    });
  });
}

// ── Billing hook opt-in ─────────────────────────────────────────────
function runBillingOptIn(): Promise<StepResult> {
  return new Promise((resolve) => {
    showModal({
      titleKey: 'billing.promptTitle',
      bodyHtml: `
        <p>${t('billing.promptBody')}</p>
        <p style="margin-top:14px;font-size:12px;color:var(--text-muted,#9999ad)">${t('billing.promptNote')}</p>
      `,
      buttons: [
        { labelKey: 'billing.promptMore', onClick: () => { levis.openExternal('https://levinger.cz/levis-ide/privacy'); } },
        { labelKey: 'billing.promptLater', onClick: () => { closeModal(); resolve('postponed'); } },
        {
          labelKey: 'billing.promptAllow',
          primary: true,
          onClick: async () => {
            closeModal();
            const st: any = (window as any).showToast;
            try {
              const res = await levis.billingInstallHook({ wrapExisting: true });
              if (res.success) {
                if (st) st(t('billing.promptInstalled'), 'success');
                resolve('done');
              } else {
                if (st) st(t('billing.promptFailed', { msg: res.error || '' }), 'error');
                resolve('skipped');
              }
            } catch (e) {
              if (st) st(t('billing.promptFailed', { msg: String(e) }), 'error');
              resolve('skipped');
            }
          },
        },
      ],
    });
  });
}

// ── Main orchestrator ───────────────────────────────────────────────
async function runOnboarding(): Promise<void> {
  console.log('[onboarding] start');
  try {
    // 1. Welcome tour — klíč 'welcomeTourV3Seen' (V3 = redesign bez emoji,
    // step label místo ikony). Po upgradu z 1.5.2/1.5.3 se tour ukáže znovu.
    const welcomeSeen = await levis.storeGet('welcomeTourV3Seen');
    console.log('[onboarding] welcomeTourV3Seen=', welcomeSeen);
    if (!welcomeSeen) {
      console.log('[onboarding] running welcome tour…');
      await runWelcomeTour();
      await levis.storeSet('welcomeTourV3Seen', true);
      console.log('[onboarding] welcome tour finished');
    }

    // 2. CC detection & install
    const ccInstallOffered = await levis.storeGet('ccInstallOffered');
    const det = await levis.ccDetect();
    await levis.storeSet('ccDetectedOnce', det.installed);

    if (!det.installed && !ccInstallOffered) {
      await runCcInstallStep();
      await levis.storeSet('ccInstallOffered', true);
    }

    // 3. CC login (jen pokud CC existuje a login nebyl nabídnut)
    if (det.installed) {
      const ccLoginOffered = await levis.storeGet('ccLoginOffered');
      if (!ccLoginOffered) {
        await runCcLoginStep();
        await levis.storeSet('ccLoginOffered', true);
      }
    }

    // 4. Billing hook opt-in
    const billingPromptSeen = await levis.storeGet('billingHookPromptSeen');
    if (!billingPromptSeen) {
      // Ověř že billing hook ještě není aktivní (jinak nemá smysl ptát se)
      try {
        const hookStatus = await levis.billingGetHookStatus();
        if (!hookStatus.ourHookActive) {
          await runBillingOptIn();
        }
      } catch {
        await runBillingOptIn();
      }
      await levis.storeSet('billingHookPromptSeen', true);
    }
  } catch (err) {
    console.warn('[onboarding] error — continuing:', err);
  }
}

// Public: umožnit user-u znovu otevřít welcome tour z Help menu
async function reopenWelcomeTour(): Promise<void> {
  await runWelcomeTour();
}

(window as any).runOnboarding = runOnboarding;
(window as any).reopenWelcomeTour = reopenWelcomeTour;
