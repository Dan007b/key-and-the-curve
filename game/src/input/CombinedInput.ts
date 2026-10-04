/**
 * Merges keyboard/mouse and the controller so either can drive at any time.
 * Keyboard tilt wins while a tilt key is held; twist rates add; button
 * presses from either source count.
 */

import type { InputSource, InputStatus } from './InputSource';
import type { KeyboardInput } from './KeyboardInput';
import type { SerialInput } from './SerialInput';

export class CombinedInput implements InputSource {
  constructor(private readonly keyboard: KeyboardInput, private readonly serial: SerialInput) {}

  update(dt: number): void {
    this.keyboard.update(dt);
  }

  tilt(): { x: number; y: number } {
    const k = this.keyboard.tilt();
    if (Math.hypot(k.x, k.y) > 0.01 || !this.serial.connected()) return k;
    return this.serial.tilt();
  }

  angularVelocity(): [number, number, number] {
    const k = this.keyboard.angularVelocity();
    const s = this.serial.angularVelocity();
    return [k[0] + s[0], k[1] + s[1], k[2] + s[2]];
  }

  twistToggled(): boolean {
    // Evaluate both so neither source keeps a stale press queued.
    const k = this.keyboard.twistToggled();
    const s = this.serial.twistToggled();
    return k || s;
  }

  resetKey(): boolean {
    const k = this.keyboard.resetKey();
    const s = this.serial.resetKey();
    return k || s;
  }

  status(): InputStatus {
    return this.serial.connected() ? this.serial.status() : this.keyboard.status();
  }

  statuses(): InputStatus[] {
    return [this.keyboard.status(), this.serial.status()];
  }

  vibrate(strength01: number): void {
    this.serial.vibrate(strength01);
  }
}
