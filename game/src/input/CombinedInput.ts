/**
 * Merges keyboard/mouse and the controller so either can drive at any time.
 * Keyboard tilt wins while a tilt key is held; phase steps and rates from
 * both sources add up.
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

  phaseSteps(): number {
    return this.keyboard.phaseSteps() + this.serial.phaseSteps();
  }

  phaseRate(): number {
    return this.keyboard.phaseRate() + this.serial.phaseRate();
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
