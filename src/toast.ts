// ── Toast Notification System ────────────

let toastContainer: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

interface ToastOptions {
  action?: { label: string; onClick: () => void };
  duration?: number;
}

function showToast(
  message: string,
  type: 'info' | 'success' | 'warning' | 'error' = 'info',
  options?: ToastOptions,
): void {
  const container = ensureContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons: Record<string, string> = {
    info: '\u2139',
    success: '\u2713',
    warning: '\u26A0',
    error: '\u2717',
  };

  const iconEl = document.createElement('span');
  iconEl.className = 'toast-icon';
  iconEl.textContent = icons[type];
  const msgEl = document.createElement('span');
  msgEl.className = 'toast-msg';
  msgEl.textContent = message;
  toast.appendChild(iconEl);
  toast.appendChild(msgEl);

  if (options?.action) {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'toast-action';
    actionBtn.textContent = options.action.label;
    actionBtn.addEventListener('click', () => {
      options.action!.onClick();
      removeToast(toast);
    });
    toast.appendChild(actionBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '\u00D7';
  closeBtn.addEventListener('click', () => removeToast(toast));
  toast.appendChild(closeBtn);

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-show'));

  // Actionable toasty žijou déle — user potřebuje čas na kliknutí
  const duration = options?.duration ?? (options?.action ? 8000 : 4000);
  setTimeout(() => removeToast(toast), duration);
}

function removeToast(toast: HTMLElement): void {
  toast.classList.remove('toast-show');
  toast.classList.add('toast-hide');
  setTimeout(() => toast.remove(), 300);
}

(window as any).showToast = showToast;
