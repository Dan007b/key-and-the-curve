/**
 * The gate's lock, drawn as four dials (above the key inset): curvature, and
 * the XW, YW and ZW twist planes. A dial points straight up when its tumbler
 * is set; turning the key the right way swings the needle clockwise towards
 * the top. Each row says what to do next.
 */

import type { LockStatus, TwistPlane } from '../game/lock';
import { TWIST_KEYS } from '../game/lock';

export interface LockView {
  status: LockStatus;
  /** 0..1 overall closeness, and where the gate opens. */
  fit: number;
  threshold: number;
  twistMode: boolean;
  twistAllowed: boolean;
  controllerConnected: boolean;
}

const PLANE_LABEL: Record<TwistPlane, string> = { xw: 'XW twist', yw: 'YW twist', zw: 'ZW twist' };
const PLANE_COLOR: Record<TwistPlane, string> = { xw: '#ff5c5c', yw: '#5cff8c', zw: '#5cb3ff' };

const SVG_NS = 'http://www.w3.org/2000/svg';

class Row {
  readonly el: HTMLDivElement;
  private readonly needle: SVGGElement;
  private readonly name: HTMLDivElement;
  private readonly hint: HTMLDivElement;

  constructor(parent: HTMLElement, label: string, color: string) {
    this.el = document.createElement('div');
    this.el.className = 'lock-row';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-15 -15 30 30');
    svg.classList.add('lock-dial');
    svg.innerHTML =
      `<circle r="12.5" class="dial-face"/>` +
      `<path d="M0,-14.5 L-3,-10 L3,-10 Z" class="dial-notch"/>` +
      `<g class="dial-needle"><line x1="0" y1="2" x2="0" y2="-10" stroke="${color}"/><circle r="2.2" fill="${color}"/></g>`;
    this.needle = svg.querySelector('.dial-needle') as SVGGElement;
    const text = document.createElement('div');
    text.className = 'lock-text';
    this.name = document.createElement('div');
    this.name.className = 'lock-name';
    this.name.textContent = label;
    this.hint = document.createElement('div');
    this.hint.className = 'lock-hint';
    text.append(this.name, this.hint);
    this.el.append(svg, text);
    parent.appendChild(this.el);
  }

  /** Needle angle in degrees clockwise from the top (0 = set). */
  set(angleDeg: number, state: 'set' | 'todo' | 'next' | 'fixed', hint: string): void {
    this.needle.setAttribute('transform', `rotate(${angleDeg.toFixed(1)})`);
    this.el.dataset.state = state;
    this.hint.textContent = hint;
  }
}

export class LockPanel {
  readonly el: HTMLDivElement;
  private readonly count: HTMLSpanElement;
  private readonly curvature: Row;
  private readonly twists: Record<TwistPlane, Row>;
  private readonly bar: HTMLDivElement;
  private readonly mark: HTMLDivElement;

  constructor(parent: HTMLElement, onHelp: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'lock-panel hidden';
    const head = document.createElement('div');
    head.className = 'lock-head';
    const title = document.createElement('span');
    title.textContent = 'Gate lock';
    this.count = document.createElement('span');
    this.count.className = 'lock-count';
    const help = document.createElement('button');
    help.className = 'lock-help';
    help.textContent = '?';
    help.title = 'How the 4D lock works';
    help.addEventListener('click', () => {
      onHelp();
      help.blur();
    });
    head.append(title, this.count, help);
    this.el.appendChild(head);
    this.curvature = new Row(this.el, 'Curvature', '#c08cff');
    this.twists = {
      xw: new Row(this.el, PLANE_LABEL.xw, PLANE_COLOR.xw),
      yw: new Row(this.el, PLANE_LABEL.yw, PLANE_COLOR.yw),
      zw: new Row(this.el, PLANE_LABEL.zw, PLANE_COLOR.zw),
    };
    const track = document.createElement('div');
    track.className = 'lock-track';
    this.bar = document.createElement('div');
    this.bar.className = 'lock-bar';
    this.mark = document.createElement('div');
    this.mark.className = 'lock-mark';
    track.append(this.bar, this.mark);
    this.el.appendChild(track);
    parent.appendChild(this.el);
  }

  update(view: LockView | null): void {
    if (!view) {
      this.el.classList.add('hidden');
      return;
    }
    this.el.classList.remove('hidden');
    const { status } = view;
    this.count.textContent = `${status.setCount} of 4 set`;

    const c = status.curvature;
    const laps = Math.abs(c.laps);
    const curveHint = c.set
      ? `set · turned ${Math.round(c.haveDeg)}°`
      : `roll ${laps} lap${laps > 1 ? 's' : ''} ${c.laps > 0 ? 'clockwise ↻' : 'counter-clockwise ↺'} around a pillar`;
    // Needle: how far the curvature turn is from what the lock needs (clockwise laps swing it clockwise).
    this.curvature.set(c.haveDeg - c.needDeg, c.set ? 'set' : 'todo', curveHint);

    for (const t of status.twists) {
      const row = this.twists[t.plane];
      if (t.set) {
        row.set(-t.remainingDeg, 'set', 'set');
        continue;
      }
      if (!view.twistAllowed) {
        row.set(-t.remainingDeg, 'fixed', 'twisting is disabled here');
        continue;
      }
      const [plus, minus] = TWIST_KEYS[t.plane];
      const key = t.remainingDeg > 0 ? plus : minus;
      const amount = `${t.remainingDeg > 0 ? '+' : '−'}${Math.round(Math.abs(t.remainingDeg))}°`;
      const how = view.twistMode ? `hold ${key}` : `Space, then hold ${key}`;
      const ctrl = view.controllerConnected ? ' or twist the controller' : '';
      row.set(-t.remainingDeg, status.next === t.plane ? 'next' : 'todo', `turn ${amount} · ${how}${ctrl}`);
    }

    this.bar.style.width = `${Math.round(view.fit * 100)}%`;
    this.bar.classList.toggle('good', view.fit >= view.threshold);
    this.mark.style.left = `${Math.round(view.threshold * 100)}%`;
  }
}
