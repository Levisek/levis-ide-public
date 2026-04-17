// ── In-app updater banner ─────────────────────────────────
// Zobrazuje stav electron-updater v aplikaci — user vidí checking / available /
// download progress / downloaded / error. Klik "Stáhnout" → download, "Restart" → install.

type UpdateStatus = 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

interface UpdateData {
  status: UpdateStatus;
  version?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  message?: string;
}

function fmtSize(b: number): string {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function fmtSpeed(bps: number): string {
  if (!bps) return '';
  return `${fmtSize(bps)}/s`;
}

function escUpdate(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

function initUpdater(): void {
  let banner: HTMLElement | null = null;
  // Automaticky skrýt "not-available" a "checking" po chvíli — nerušit user zbytečně.
  let autoHideTimer: number | null = null;

  function ensureBanner(): HTMLElement {
    if (banner && document.body.contains(banner)) return banner;
    banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.style.display = 'none';
    document.body.appendChild(banner);
    return banner;
  }

  function hide(): void {
    if (banner) banner.style.display = 'none';
  }

  function clearAutoHide(): void {
    if (autoHideTimer) { window.clearTimeout(autoHideTimer); autoHideTimer = null; }
  }

  function render(data: UpdateData): void {
    clearAutoHide();
    const b = ensureBanner();
    const v = data.version ? escUpdate(data.version) : '';

    switch (data.status) {
      case 'checking':
        // Tiché — banner nezobrazujeme, jen případně toast (nepříjemné při každém startu)
        hide();
        return;

      case 'not-available':
        // Zobrazíme krátkou zprávu jen pokud uživatel vyvolal check manuálně.
        // Automatický startup check → ticho. Rozlišení: flag v window._manualUpdateCheck.
        if ((window as any)._manualUpdateCheck) {
          b.className = 'update-banner info';
          b.innerHTML = `
            <div class="update-banner-content">
              <span class="update-banner-icon">✓</span>
              <div class="update-banner-text">
                <strong>${(window as any).t('update.latest')}</strong>
              </div>
              <button class="update-banner-close" title="Zavřít">×</button>
            </div>`;
          b.style.display = 'flex';
          autoHideTimer = window.setTimeout(hide, 4000);
          (window as any)._manualUpdateCheck = false;
        } else {
          hide();
        }
        return;

      case 'available':
        b.className = 'update-banner info';
        b.innerHTML = `
          <div class="update-banner-content">
            <span class="update-banner-icon">↓</span>
            <div class="update-banner-text">
              <strong>${(window as any).t('update.available', { v })}</strong>
              <span class="update-banner-sub">${(window as any).t('update.availableSub')}</span>
            </div>
            <button class="update-banner-btn primary" data-act="download">${(window as any).t('update.download')}</button>
            <button class="update-banner-btn" data-act="later">${(window as any).t('update.later')}</button>
          </div>`;
        b.style.display = 'flex';
        return;

      case 'downloading': {
        const pct = data.percent ?? 0;
        const got = data.transferred ? fmtSize(data.transferred) : '';
        const tot = data.total ? fmtSize(data.total) : '';
        const sp  = data.bytesPerSecond ? ` · ${fmtSpeed(data.bytesPerSecond)}` : '';
        b.className = 'update-banner progress';
        b.innerHTML = `
          <div class="update-banner-content">
            <span class="update-banner-icon">⇣</span>
            <div class="update-banner-text">
              <strong>${(window as any).t('update.downloading', { v })}</strong>
              <span class="update-banner-sub">${pct}% · ${got} / ${tot}${sp}</span>
            </div>
            <div class="update-banner-progress">
              <div class="update-banner-progress-fill" style="width:${pct}%"></div>
            </div>
          </div>`;
        b.style.display = 'flex';
        return;
      }

      case 'downloaded':
        b.className = 'update-banner success';
        b.innerHTML = `
          <div class="update-banner-content">
            <span class="update-banner-icon">✓</span>
            <div class="update-banner-text">
              <strong>${(window as any).t('update.downloaded', { v })}</strong>
              <span class="update-banner-sub">${(window as any).t('update.downloadedSub')}</span>
            </div>
            <button class="update-banner-btn primary pulse" data-act="install">${(window as any).t('update.install')}</button>
            <button class="update-banner-btn" data-act="later">${(window as any).t('update.laterInstall')}</button>
          </div>`;
        b.style.display = 'flex';
        return;

      case 'error':
        b.className = 'update-banner error';
        b.innerHTML = `
          <div class="update-banner-content">
            <span class="update-banner-icon">⚠</span>
            <div class="update-banner-text">
              <strong>${(window as any).t('update.errorTitle')}</strong>
              <span class="update-banner-sub">${escUpdate(data.message || '?')}</span>
            </div>
            <button class="update-banner-close" title="Zavřít">×</button>
          </div>`;
        b.style.display = 'flex';
        autoHideTimer = window.setTimeout(hide, 10_000);
        return;
    }
  }

  ensureBanner().addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest('[data-act]') as HTMLElement | null;
    const closeBtn = target.closest('.update-banner-close') as HTMLElement | null;
    if (closeBtn) { hide(); return; }
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'download') {
      btn.setAttribute('disabled', '');
      btn.textContent = (window as any).t('update.starting');
      try { await levis.updateDownload(); } catch {}
    } else if (act === 'install') {
      btn.setAttribute('disabled', '');
      btn.textContent = (window as any).t('update.restarting');
      try { await levis.updateInstall(); } catch {}
    } else if (act === 'later') {
      hide();
    }
  });

  levis.onUpdateStatus((data) => render(data as UpdateData));

  // Manuální check (volitelně spojíme s tlačítkem v Settings / About)
  (window as any).checkForUpdatesManually = async () => {
    (window as any)._manualUpdateCheck = true;
    await levis.updateCheck();
  };
}

(window as any).initUpdater = initUpdater;
