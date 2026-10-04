/**
 * Common interface for the keyboard/mouse and the ESP32 controller, so the
 * game never cares which one is driving it.
 */

export interface InputStatus {
  /** Short name shown in the HUD, e.g. "Keyboard" or "Controller". */
  label: string;
  connected: boolean;
  /** Packed BNO055 calibration, sys*1000 + gyr*100 + acc*10 + mag. */
  calibration?: number;
  /** Samples per second actually received. */
  hz?: number;
}

export interface InputSource {
  /** Tilt in −1..1 per axis, screen-aligned (+x right, +y up), after deadzone and sensitivity. */
  tilt(): { x: number; y: number };
  /** Whole-layer phase steps requested since the last read (+1 / −1 per press). Reading consumes them. */
  phaseSteps(): number;
  /** Continuous phase rate through the fourth dimension, degrees per second (controller twist). */
  phaseRate(): number;
  status(): InputStatus;
  /** Advances any time-based smoothing. Called once per frame. */
  update?(dt: number): void;
  /** Vibration strength 0..1 (the controller accepts it; no motor is fitted yet). */
  vibrate?(strength01: number): void;
}
