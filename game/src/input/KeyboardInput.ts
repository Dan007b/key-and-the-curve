/**
 * Keyboard and mouse input. The game is fully playable without the controller.
 *
 * - Arrow keys or WASD tilt the board. Holding the left mouse button on the
 *   disk also tilts it towards the pointer.
 * - Q / E step one layer down / up through the fourth dimension; Space steps up.
 *
 * Keys are read by physical position (KeyboardEvent.code), so the layout
 * doesn't matter.
 */

import type { InputSource, InputStatus } from './InputSource';

/** How fast keyboard tilt ramps between 0 and full, per second. */
const TILT_RAMP = 6;

export class KeyboardInput implements InputSource {
  private readonly down = new Set<string>();
  private steps = 0;
  private tiltX = 0;
  private tiltY = 0;
  private pointer: { x: number; y: number } | null = null;

  constructor(private readonly diskElement: HTMLElement, private readonly diskRadiusPx: () => number) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.down.clear());
    diskElement.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      diskElement.setPointerCapture(e.pointerId);
      this.pointer = this.pointerTilt(e);
    });
    diskElement.addEventListener('pointermove', (e) => {
      if (this.pointer) this.pointer = this.pointerTilt(e);
    });
    const release = () => {
      this.pointer = null;
    };
    diskElement.addEventListener('pointerup', release);
    diskElement.addEventListener('pointercancel', release);
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    if (isDown) {
      if (!e.repeat && (e.code === 'KeyE' || e.code === 'Space')) this.steps++;
      if (!e.repeat && e.code === 'KeyQ') this.steps--;
      this.down.add(e.code);
    } else {
      this.down.delete(e.code);
    }
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  }

  /** Tilt towards the pointer, proportional to its distance from the disk centre. */
  private pointerTilt(e: PointerEvent): { x: number; y: number } {
    const r = this.diskElement.getBoundingClientRect();
    const radius = this.diskRadiusPx();
    const x = (e.clientX - (r.left + r.width / 2)) / (radius * 0.6);
    const y = -(e.clientY - (r.top + r.height / 2)) / (radius * 0.6);
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  update(dt: number): void {
    const has = (...codes: string[]) => codes.some((c) => this.down.has(c));
    let tx = 0;
    let ty = 0;
    if (has('ArrowLeft', 'KeyA')) tx -= 1;
    if (has('ArrowRight', 'KeyD')) tx += 1;
    if (has('ArrowDown', 'KeyS')) ty -= 1;
    if (has('ArrowUp', 'KeyW')) ty += 1;
    const len = Math.hypot(tx, ty);
    if (len > 1) {
      tx /= len;
      ty /= len;
    }
    // Ramp towards the target so keyboard tilt isn't a harsh on/off step.
    const step = TILT_RAMP * dt;
    this.tiltX += Math.max(-step, Math.min(step, tx - this.tiltX));
    this.tiltY += Math.max(-step, Math.min(step, ty - this.tiltY));
  }

  tilt(): { x: number; y: number } {
    if (this.pointer) return this.pointer;
    return { x: this.tiltX, y: this.tiltY };
  }

  phaseSteps(): number {
    const n = this.steps;
    this.steps = 0;
    return n;
  }

  phaseRate(): number {
    return 0;
  }

  status(): InputStatus {
    return { label: 'Keyboard', connected: true };
  }
}
