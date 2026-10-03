/**
 * Common interface for the keyboard/mouse and the ESP32 controller, so the
 * game never cares which one is driving it. CLAUDE.md §7.
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
  /** Rotation rates in rad/s that drive the XW, YW and ZW planes in twist mode. */
  angularVelocity(): [number, number, number];
  /** True once per trigger press (Space or the BOOT button); reading it consumes the press. */
  twistToggled(): boolean;
  /** True once per reset-key request; reading it consumes the request. */
  resetKey(): boolean;
  status(): InputStatus;
  /** Advances any time-based smoothing. Called once per frame. */
  update?(dt: number): void;
  /** Vibration strength 0..1 (the controller accepts it; no motor is fitted yet). */
  vibrate?(strength01: number): void;
}
