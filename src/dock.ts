// ── Dock helper ─────────────────────
// Detekce drag panelu MIMO workspace bounds → callback pro tear-out.
// Funguje na principu: mousedown na headeru → tracking mousemove →
// pokud kurzor opustí workspaceContainer bounds, zobrazí ghost preview;
// na mouseup MIMO workspace zavolá onTearOut.

function escDock(s: string): string { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

interface DragOptions {
  handle: HTMLElement;            // drag handle (panel header / toolbar)
  workspaceContainer: HTMLElement; // bounds proti kterým se měří
  panelLabel: string;             // co se zobrazí v ghostu
  onTearOut: (screenX: number, screenY: number) => void;
}

function attachDragOut(opts: DragOptions): () => void {
  const { handle, workspaceContainer, panelLabel, onTearOut } = opts;
  let dragging = false;
  let pointerId = -1;
  let ghost: HTMLElement | null = null;
  let outOfBounds = false;

  function createGhost(x: number, y: number): void {
    ghost = document.createElement('div');
    ghost.className = 'dock-drag-ghost';
    ghost.innerHTML = `
      <div class="dock-ghost-titlebar">
        <span class="dock-ghost-dot dot-r"></span>
        <span class="dock-ghost-dot dot-y"></span>
        <span class="dock-ghost-dot dot-g"></span>
        <span class="dock-ghost-title">${escDock(panelLabel)}</span>
      </div>
      <div class="dock-ghost-body">
        <div class="dock-ghost-line w70"></div>
        <div class="dock-ghost-line w50"></div>
        <div class="dock-ghost-line w85"></div>
        <div class="dock-ghost-line w40"></div>
      </div>
    `;
    ghost.style.left = `${x + 14}px`;
    ghost.style.top = `${y + 14}px`;
    document.body.appendChild(ghost);
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Skip kliky na buttons / inputs uvnitř toolbaru
    if (target.closest('button') || target.closest('input') || target.closest('select')) return;
    e.preventDefault();
    dragging = true;
    pointerId = e.pointerId;
    outOfBounds = false;
    try { handle.setPointerCapture(pointerId); } catch {}
    // Vytvořit ghost HNED — viditelný feedback od první ms
    createGhost(e.clientX, e.clientY);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || e.pointerId !== pointerId) return;
    if (ghost) {
      ghost.style.left = `${e.clientX + 14}px`;
      ghost.style.top = `${e.clientY + 14}px`;
    }
    const wsRect = workspaceContainer.getBoundingClientRect();
    const isOut = e.clientX < wsRect.left || e.clientX > wsRect.right ||
                  e.clientY < wsRect.top || e.clientY > wsRect.bottom;
    if (isOut !== outOfBounds) {
      outOfBounds = isOut;
      if (ghost) ghost.classList.toggle('dock-ghost-out', isOut);
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    try { handle.releasePointerCapture(pointerId); } catch {}
    if (ghost) { ghost.remove(); ghost = null; }
    if (outOfBounds) {
      onTearOut(e.screenX, e.screenY);
    }
  }

  function onPointerCancel(): void {
    dragging = false;
    if (ghost) { ghost.remove(); ghost = null; }
  }

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerUp);
  handle.addEventListener('pointercancel', onPointerCancel);
  return () => {
    handle.removeEventListener('pointerdown', onPointerDown);
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', onPointerUp);
    handle.removeEventListener('pointercancel', onPointerCancel);
    if (ghost) ghost.remove();
  };
}

(window as any).attachDragOut = attachDragOut;
