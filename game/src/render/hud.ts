/**
 * Heads-up display: plain DOM over the canvas (crisp text, no GPU cost).
 * Level title and hint, lives, shards, timer, your layer, the phase ring
 * around the 4D inset, a danger vignette, buttons and overlay cards.
 */

import type { InputStatus } from '../input/InputSource';
import { LAYERS, LAYER_CSS, LAYER_DEG, LAYER_NAMES, dialAngles, dialSectorAngle } from '../game/phase';

export interface HudState {
  fps: number;
  inputs: InputStatus[];
  layer: number;
  /** The phase you have dialled in yourself (continuous), degrees: turns the ring's needle. */
  twistDeg: number;
  /** Whole layers of curvature picked up from loops (signed). */
  curvatureSteps: number;
  twistAllowed: boolean;
  lives: number;
  maxLives: number;
  shards: { layer: number; collected: boolean }[];
  /** Each hunter's current layer; shifters change layer over time. */
  hunters: { layer: number; shifter: boolean }[];
  time: number;
  /** 0..1 how close a hunter in your layer is. */
  danger: number;
  /** Your 4D view, [xw, yw] degrees. */
  look: readonly [number, number];
  /** Hunters in your layer: the ones that can see and hit you. */
  seenBy: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG arc path for a ring sector between angles a0..a1 (degrees, clockwise from the top). */
function sector(r0: number, r1: number, a0: number, a1: number): string {
  const pt = (r: number, a: number) => {
    const t = ((a - 90) * Math.PI) / 180;
    return `${(50 + r * Math.cos(t)).toFixed(2)},${(50 + r * Math.sin(t)).toFixed(2)}`;
  };
  return `M${pt(r1, a0)} A${r1},${r1} 0 0 1 ${pt(r1, a1)} L${pt(r0, a1)} A${r0},${r0} 0 0 0 ${pt(r0, a0)} Z`;
}

export class Hud {
  readonly root: HTMLDivElement;
  readonly buttons: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly fps: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly layerPill: HTMLDivElement;
  private readonly lookLabel: HTMLDivElement;
  private readonly threat: HTMLDivElement;
  private readonly riftMeter: HTMLDivElement;
  private riftAnchor: unknown = null;
  private readonly curvature: HTMLDivElement;
  private readonly lives: HTMLDivElement;
  private readonly shards: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly ring: SVGSVGElement;
  private readonly pointer: SVGGElement;
  private readonly wheel: SVGGElement;
  private readonly ringMarks: SVGGElement;
  /** The wheel's displayed turn (degrees, eased towards the curvature turn) and when it was last updated. */
  private wheelShown = 0;
  private wheelTime = 0;
  private readonly overlay: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private readonly tipText: HTMLDivElement;
  private readonly tipMarker: HTMLDivElement;
  private tipAnchor: unknown = null;
  private toastTimer = 0;
  private overlayAction: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.vignette = el('div', 'danger-vignette', this.root);
    const left = el('div', 'hud-left', this.root);
    this.title = el('div', 'hud-title', left);
    this.hint = el('div', 'hud-hint', left);
    const center = el('div', 'hud-center', this.root);
    this.lives = el('div', 'hud-lives', center);
    this.shards = el('div', 'hud-shards', center);
    this.timer = el('div', 'hud-timer', center);
    const right = el('div', 'hud-right', this.root);
    this.fps = el('div', 'hud-fps', right);
    this.status = el('div', 'hud-status', right);
    this.layerPill = el('div', 'hud-layer', right);
    this.curvature = el('div', 'hud-curvature', right);
    this.threat = el('div', 'hud-threat', right);
    this.buttons = el('div', 'hud-buttons', this.root);

    // The 4D inset frame, with the phase ring drawn around it. The ring is
    // the honest picture of how your colour works: the colour wheel is painted
    // on the world, and the pointer is a needle you carry. Twisting turns the
    // needle. Looping a pillar turns the world relative to you by 72° (the
    // holonomy), so the wheel turns under the needle. The colours run
    // counter-clockwise so that both agree with layer = twist + curvature.
    const inset = el('div', 'hud-inset', this.root);
    el('div', 'hud-inset-label', inset, 'Your 4D view');
    this.lookLabel = el('div', 'hud-look', inset);
    this.ring = document.createElementNS(SVG_NS, 'svg');
    this.ring.setAttribute('viewBox', '0 0 100 100');
    this.ring.classList.add('phase-ring');
    let svg = '';
    for (let i = 0; i < LAYERS; i++) {
      const a = dialSectorAngle(i);
      svg += `<path d="${sector(41, 47, a - LAYER_DEG / 2 + 1.5, a + LAYER_DEG / 2 - 1.5)}" fill="${LAYER_CSS[i]}" class="ring-sector" data-layer="${i}"/>`;
    }
    this.ring.innerHTML = `<g class="ring-wheel">${svg}<g class="ring-marks"></g></g><g class="ring-pointer"><path d="M50,1.5 L46.2,8.5 L53.8,8.5 Z" fill="#fff"/></g>`;
    this.wheel = this.ring.querySelector('.ring-wheel') as SVGGElement;
    this.ringMarks = this.ring.querySelector('.ring-marks') as SVGGElement;
    this.pointer = this.ring.querySelector('.ring-pointer') as SVGGElement;
    inset.appendChild(this.ring);

    this.toast = el('div', 'hud-toast hidden', this.root);
    this.riftMeter = el('div', 'rift-meter hidden', this.root);
    this.tipMarker = el('div', 'tip-marker hidden', this.root);
    this.tip = el('div', 'hud-tip hidden', this.root);
    el('div', 'hud-tip-label', this.tip, 'Tutorial');
    this.tipText = el('div', 'hud-tip-text', this.tip);
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

  /** Positions the frame drawn around the inset (size in CSS px). */
  setInset(size: number, margin: number): void {
    this.root.style.setProperty('--inset-size', `${size}px`);
    this.root.style.setProperty('--inset-margin', `${margin}px`);
  }

  /** Shows a short message in the middle of the screen for a moment. */
  flash(text: string, color = 'var(--good)'): void {
    this.toast.textContent = text;
    this.toast.style.borderColor = color;
    this.toast.style.color = color;
    this.toast.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add('hidden'), 1500);
  }

  setLevel(index: number, name: string, hint: string): void {
    this.wheelShown = 0;
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

    this.layerPill.textContent = `${LAYER_NAMES[s.layer]} layer${s.twistAllowed ? '' : ' · twist jammed'}`;
    this.layerPill.style.background = LAYER_CSS[s.layer];
    const c = s.curvatureSteps;
    this.curvature.textContent = c === 0 ? 'Curvature shift: none' : `Curvature shift: ${c > 0 ? '+' : ''}${c} layer${Math.abs(c) > 1 ? 's' : ''} (${c * LAYER_DEG > 0 ? '+' : ''}${c * LAYER_DEG}°)`;

    this.lives.textContent = '♥'.repeat(Math.max(0, s.lives)) + '♡'.repeat(Math.max(0, s.maxLives - s.lives));
    this.shards.innerHTML = '';
    for (const sh of s.shards) {
      const d = el('span', sh.collected ? 'shard got' : 'shard', this.shards, '◆');
      d.style.color = LAYER_CSS[sh.layer];
    }
    const secs = Math.floor(s.time);
    this.timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

    this.vignette.style.opacity = String(Math.min(1, s.danger * 1.1));
    // Who can hurt you right now: only hunters in your own colour.
    const colour = LAYER_NAMES[s.layer].toLowerCase();
    let threat = '';
    if (s.hunters.length === 0) threat = '';
    else if (s.seenBy > 0) threat = `⚠ ${s.seenBy} ${colour} hunter${s.seenBy > 1 ? 's' : ''} can see you`;
    else threat = `Safe: no hunter is ${colour}`;
    if (this.threat.textContent !== threat) this.threat.textContent = threat;
    this.threat.classList.toggle('danger', s.seenBy > 0);
    const deg = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}°`;
    this.lookLabel.textContent = `XW ${deg(s.look[0])} · YW ${deg(s.look[1])}`;

    // Phase ring: the needle turns with your twist (counter-clockwise for +);
    // the wheel turns (clockwise on screen for +) with the curvature, easing
    // over a quarter second so you see it move. Marks for hunters (dots) and
    // shards (diamonds) sit on their layer's sector.
    const dial = dialAngles(s.twistDeg, s.curvatureSteps);
    this.pointer.setAttribute('transform', `rotate(${dial.needle.toFixed(1)} 50 50)`);
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(0, now - this.wheelTime));
    this.wheelTime = now;
    const target = dial.wheel;
    this.wheelShown += (target - this.wheelShown) * (1 - Math.exp(-dt / 0.25));
    this.wheel.setAttribute('transform', `rotate(${this.wheelShown.toFixed(1)} 50 50)`);
    let marks = '';
    for (let i = 0; i < LAYERS; i++) {
      const a = ((dialSectorAngle(i) - 90) * Math.PI) / 180;
      const hunters = s.hunters.filter((h) => h.layer === i);
      const shards = s.shards.filter((sh) => !sh.collected && sh.layer === i).length;
      const x = 50 + 35 * Math.cos(a);
      const y = 50 + 35 * Math.sin(a);
      const parts: string[] = [];
      // Shifters get a white outline: they won't stay in this layer.
      hunters.forEach((h, k) =>
        parts.push(`<circle cx="${(x - 4 + k * 4).toFixed(1)}" cy="${(y - 2).toFixed(1)}" r="1.7" fill="${LAYER_CSS[i]}" stroke="${h.shifter ? '#fff' : '#000'}" stroke-width="${h.shifter ? 0.8 : 0.6}"/>`),
      );
      for (let k = 0; k < shards; k++) parts.push(`<rect x="${(x - 3.5 + k * 4).toFixed(1)}" y="${(y + 1).toFixed(1)}" width="2.6" height="2.6" transform="rotate(45 ${(x - 2.2 + k * 4).toFixed(1)} ${(y + 2.3).toFixed(1)})" fill="${LAYER_CSS[i]}"/>`);
      marks += parts.join('');
    }
    this.ringMarks.innerHTML = marks;
    for (const p of this.ring.querySelectorAll<SVGPathElement>('.ring-sector')) {
      p.style.opacity = Number(p.dataset.layer) === s.layer ? '1' : '0.35';
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

  /**
   * Shows a tutorial tip (or hides it with null). `anchor` is something the
   * caller can locate on screen (see updateTip); the marker rings it.
   */
  setTip(text: string | null, color = 'var(--accent)', anchor: unknown = null): void {
    if (text === null) {
      this.tip.classList.add('hidden');
      this.tipMarker.classList.add('hidden');
      this.tipAnchor = null;
      return;
    }
    if (this.tipText.textContent !== text) this.tipText.textContent = text;
    this.tip.style.borderColor = color;
    this.tip.classList.remove('hidden');
    this.tipAnchor = anchor;
    this.tipMarker.style.borderColor = color;
    this.tipMarker.style.color = color;
    this.tipMarker.classList.toggle('hidden', anchor === null);
  }

  /** Keeps the tip's marker on its anchor; `locate` maps an anchor to screen px. */
  updateTip(locate: (anchor: unknown) => { x: number; y: number }): void {
    if (this.tipAnchor === null) return;
    const at = locate(this.tipAnchor);
    this.tipMarker.style.left = `${at.x}px`;
    this.tipMarker.style.top = `${at.y}px`;
  }

  /** Shows the "lined up" readout next to the rift you are working on (null hides it). */
  setRift(text: string | null, anchor: unknown): void {
    this.riftAnchor = text === null ? null : anchor;
    this.riftMeter.classList.toggle('hidden', text === null);
    if (text !== null && this.riftMeter.textContent !== text) this.riftMeter.textContent = text;
  }

  /** Keeps the rift readout on its rift; `locate` maps an anchor to screen px. */
  updateRift(locate: (anchor: unknown) => { x: number; y: number }): void {
    if (this.riftAnchor === null) return;
    const at = locate(this.riftAnchor);
    this.riftMeter.style.left = `${at.x}px`;
    this.riftMeter.style.top = `${at.y}px`;
  }

  clearLabels(): void {
    for (const l of this.labels) l.el.remove();
    this.labels = [];
  }
}
