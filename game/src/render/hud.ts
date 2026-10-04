/**
 * Heads-up display: plain DOM over the canvas (crisp text, no GPU cost).
 * Level title and hint, FPS, input status, ROLL/TWIST mode, the key's
 * holonomy, the gate fit meter, buttons and overlay cards.
 */

import type { InputStatus } from '../input/InputSource';

export interface HudState {
  fps: number;
  inputs: InputStatus[];
  twistMode: boolean;
  twistAllowed: boolean;
  /** Key holonomy in degrees, relative to the direct route. */
  holonomyDeg: number;
  /** 0..1 closeness of the nearest gate, or null if no gate is near. */
  fit: number | null;
  fitThreshold: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

export class Hud {
  readonly root: HTMLDivElement;
  readonly buttons: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly fps: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly mode: HTMLDivElement;
  private readonly holonomy: HTMLDivElement;
  private readonly fitBox: HTMLDivElement;
  private readonly fitBar: HTMLDivElement;
  private readonly fitMark: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly inset: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private toastTimer = 0;
  private overlayAction: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    const left = el('div', 'hud-left', this.root);
    this.title = el('div', 'hud-title', left);
    this.hint = el('div', 'hud-hint', left);
    const right = el('div', 'hud-right', this.root);
    this.fps = el('div', 'hud-fps', right);
    this.status = el('div', 'hud-status', right);
    this.mode = el('div', 'hud-mode', right);
    this.holonomy = el('div', 'hud-holonomy', right);
    this.fitBox = el('div', 'hud-fit', this.root);
    el('div', 'hud-fit-label', this.fitBox, 'Key fit');
    const track = el('div', 'hud-fit-track', this.fitBox);
    this.fitBar = el('div', 'hud-fit-bar', track);
    this.fitMark = el('div', 'hud-fit-mark', track);
    this.buttons = el('div', 'hud-buttons', this.root);
    this.inset = el('div', 'hud-inset', this.root);
    el('div', 'hud-inset-label', this.inset, '4D key');
    const legend = el('div', 'hud-inset-legend', this.inset);
    for (const [axis, cls] of [['x', 'ax-x'], ['y', 'ax-y'], ['z', 'ax-z'], ['w', 'ax-w']]) el('span', cls, legend, axis);
    el('span', 'ax-bit', legend, '● bit');
    this.toast = el('div', 'hud-toast hidden', this.root);
    this.overlay = el('div', 'overlay hidden', parent);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && this.overlayAction) {
        e.preventDefault();
        this.overlayAction();
      }
    });
  }

  /** Adds a button to the bottom bar. */
  button(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'hud-button', this.buttons, label);
    b.title = title;
    b.addEventListener('click', () => {
      onClick();
      b.blur();
    });
    return b;
  }

  /** Positions the frame drawn around the key inset (size in CSS px). */
  setInset(size: number, margin: number): void {
    this.root.style.setProperty('--inset-size', `${size}px`);
    this.root.style.setProperty('--inset-margin', `${margin}px`);
  }

  /** Shows a short message in the middle of the screen for a moment. */
  flash(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add('hidden'), 1600);
  }

  setLevel(index: number, name: string, hint: string): void {
    this.title.textContent = `Level ${index + 1} · ${name}`;
    this.hint.textContent = hint;
  }

  update(s: HudState): void {
    this.fps.textContent = `${Math.round(s.fps)} FPS`;
    this.status.innerHTML = '';
    for (const st of s.inputs) {
      const line = el('div', st.connected ? 'ok' : 'off', this.status);
      let text = `${st.label}: ${st.connected ? 'connected' : 'not connected'}`;
      if (st.connected && st.hz !== undefined) text += ` · ${Math.round(st.hz)} Hz`;
      if (st.connected && st.calibration !== undefined) {
        const d = String(st.calibration).padStart(4, '0');
        text += ` · cal S${d[0]} G${d[1]} A${d[2]} M${d[3]}`;
      }
      line.textContent = text;
    }
    this.mode.textContent = !s.twistAllowed ? 'ROLL · twist disabled' : s.twistMode ? 'TWIST' : 'ROLL';
    this.mode.className = `hud-mode ${s.twistMode ? 'twist' : 'roll'}`;
    const h = Math.round(s.holonomyDeg);
    this.holonomy.textContent = `Curvature has turned the key ${h > 0 ? '+' : ''}${h}°`;
    if (s.fit === null) {
      this.fitBox.classList.add('hidden');
    } else {
      this.fitBox.classList.remove('hidden');
      this.fitBar.style.width = `${Math.round(s.fit * 100)}%`;
      this.fitBar.classList.toggle('good', s.fit >= s.fitThreshold);
      this.fitMark.style.left = `${Math.round(s.fitThreshold * 100)}%`;
    }
  }

  /** Shows a centred card with a title, body text and one action (also Enter). */
  showCard(title: string, body: string, action: string, onAction: () => void, extra?: HTMLElement, wide = false): void {
    this.overlay.innerHTML = '';
    const card = el('div', wide ? 'card wide' : 'card', this.overlay);
    el('h1', '', card, title);
    for (const para of body.split('\n').filter((x) => x.length > 0)) el('p', '', card, para);
    if (extra) card.appendChild(extra);
    const btn = el('button', 'card-button', card, `${action} (Enter)`);
    this.overlayAction = () => {
      this.hideCard();
      onAction();
    };
    btn.addEventListener('click', () => this.overlayAction?.());
    this.overlay.classList.remove('hidden');
  }

  /** Closes the card as if its button was pressed. */
  closeCard(): void {
    this.overlayAction?.();
  }

  hideCard(): void {
    this.overlay.classList.add('hidden');
    this.overlayAction = null;
  }

  cardVisible(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  private labels: { el: HTMLDivElement; born: number; anchor: unknown }[] = [];

  /** Adds a floating label (e.g. a loop's angle) tied to an anchor the caller can locate on screen. */
  addLabel(text: string, anchor: unknown): void {
    const e = el('div', 'loop-label', this.root, text);
    this.labels.push({ el: e, born: performance.now(), anchor });
  }

  /** Positions and fades labels; `locate` maps an anchor to screen px. Labels live 4.5 s. */
  updateLabels(locate: (anchor: unknown) => { x: number; y: number }): void {
    const now = performance.now();
    this.labels = this.labels.filter((l) => {
      const age = (now - l.born) / 1000;
      if (age > 4.5) {
        l.el.remove();
        return false;
      }
      const at = locate(l.anchor);
      l.el.style.left = `${at.x}px`;
      l.el.style.top = `${at.y}px`;
      l.el.style.opacity = String(Math.min(1, (4.5 - age) / 1.2));
      return true;
    });
  }

  clearLabels(): void {
    for (const l of this.labels) l.el.remove();
    this.labels = [];
  }
}
