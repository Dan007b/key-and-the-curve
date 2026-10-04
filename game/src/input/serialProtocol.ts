/**
 * The controller's protocols (CLAUDE.md §5, docs/HARDWARE.md) and the pure
 * maths that turns a sample into game input. No I/O here, so it is all
 * unit-tested.
 *
 * USB serial, one text line per sample:
 *
 *   $,qw,qx,qy,qz,gx,gy,gz,wx,wy,wz,cal,btn
 *
 * Bluetooth Low Energy, one 16-byte notification per sample (parseBlePacket).
 */

export interface Sample {
  /** Fused orientation quaternion (w, x, y, z); null over Bluetooth, which doesn't send it (the game doesn't use it). */
  quat: [number, number, number, number] | null;
  /** Gravity in the sensor frame, m/s². Points up (away from the Earth) when at rest. */
  gravity: [number, number, number];
  /** Angular velocity in the sensor frame, rad/s. */
  gyro: [number, number, number];
  /** Packed calibration, sys*1000 + gyr*100 + acc*10 + mag. */
  calibration: number;
  /** Button bitmask: bit0 = BOOT (trigger). */
  buttons: number;
}

/**
 * Parses one line. Returns a Sample, or null for debug lines ('#…') and
 * anything malformed (wrong field count, non-numeric fields, garbage).
 */
export function parseLine(line: string): Sample | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('$,')) return null;
  const f = trimmed.split(',');
  if (f.length !== 13) return null;
  const nums = f.slice(1).map(Number);
  if (nums.some((x) => !Number.isFinite(x))) return null;
  const [qw, qx, qy, qz, gx, gy, gz, wx, wy, wz, cal, btn] = nums;
  if (!Number.isInteger(cal) || !Number.isInteger(btn)) return null;
  return { quat: [qw, qx, qy, qz], gravity: [gx, gy, gz], gyro: [wx, wy, wz], calibration: cal, buttons: btn };
}

/** Splits a byte stream (decoded to text in arbitrary chunks) into complete lines. */
export class LineSplitter {
  private buffer = '';
  /** Longest line kept; anything longer is garbage and is dropped. */
  private static readonly MAX = 256;

  push(chunk: string): string[] {
    this.buffer += chunk;
    const parts = this.buffer.split('\n');
    this.buffer = parts.pop() ?? '';
    if (this.buffer.length > LineSplitter.MAX) this.buffer = '';
    return parts.map((p) => p.replace(/\r$/, '')).filter((p) => p.length > 0 && p.length <= LineSplitter.MAX);
  }
}

export interface TiltSettings {
  /** Tilt angle (degrees) that counts as full tilt. Smaller = more sensitive. */
  fullTiltDeg: number;
  /** Fraction of full tilt ignored around level (0..1). */
  deadzone: number;
  invertX: boolean;
  invertY: boolean;
  swapXY: boolean;
}

export const DEFAULT_TILT: TiltSettings = {
  fullTiltDeg: 22,
  deadzone: 0.08,
  invertX: false,
  invertY: false,
  swapXY: false,
};

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
};

/**
 * Screen tilt from a gravity reading, relative to a captured "level" gravity.
 *
 * The reference direction r̂ is projected out: what remains of ĝ lies in the
 * plane the board was level in, and its length is sin(tilt angle). The
 * gravity output points *up* when the board is at rest (it is the
 * accelerometer's reaction force), so downhill is the negative of that
 * projection. Screen axes in that plane: x follows the sensor's x axis
 * (projected), y = r̂ × x. With the board flat and the reference (0, 0, 1),
 * screen x is sensor x and screen y is sensor y.
 *
 * The result is scaled so `fullTiltDeg` gives length 1, then deadzoned and
 * clamped to the unit disk.
 */
export function tiltFromGravity(gravity: V3, reference: V3, s: TiltSettings): { x: number; y: number } {
  const r = norm(reference);
  const g = norm(gravity);
  const gr = dot(g, r);
  const down: V3 = [-(g[0] - gr * r[0]), -(g[1] - gr * r[1]), -(g[2] - gr * r[2])];
  // Basis of the level plane. If the sensor x axis is (nearly) parallel to r̂,
  // fall back to the sensor y axis.
  const xRaw: V3 = Math.abs(r[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = norm([xRaw[0] - r[0] * dot(xRaw, r), xRaw[1] - r[1] * dot(xRaw, r), xRaw[2] - r[2] * dot(xRaw, r)]);
  const e2 = crossV(r, e1);
  let x = dot(down, e1);
  let y = dot(down, e2);
  if (s.swapXY) [x, y] = [y, x];
  if (s.invertX) x = -x;
  if (s.invertY) y = -y;

  const full = Math.sin((s.fullTiltDeg * Math.PI) / 180);
  x /= full;
  y /= full;
  const len = Math.hypot(x, y);
  if (len <= s.deadzone) return { x: 0, y: 0 };
  // Rescale so output starts at 0 at the deadzone edge, then clamp to 1.
  const k = Math.min(1, (len - s.deadzone) / (1 - s.deadzone)) / len;
  return { x: x * k, y: y * k };
}

/**
 * Turning rate about the "level" vertical, in rad/s: the gyro vector projected
 * onto the captured reference direction (gravity at rest, which points up).
 * Turning the controller like a dial on a table gives this rate; tilting it
 * (rotating about a horizontal axis) contributes almost nothing, so phasing
 * and rolling don't interfere. Rates below `deadband` are ignored.
 */
export function yawRate(gyro: V3, reference: V3, deadband = 0.35): number {
  const r = norm(reference);
  const w = dot(gyro, r);
  return Math.abs(w) < deadband ? 0 : w;
}

/** Holding BOOT at least this long (ms) means "look into 4D" rather than a tap. */
export const BOOT_HOLD_MS = 300;

/**
 * The BOOT button's two jobs. A tap (released within BOOT_HOLD_MS) steps up
 * one layer; holding it turns tilt into turning your 4D view instead of
 * rolling, until you let go. Fed the button state with each sample's time.
 */
export class BootButton {
  private downAt: number | null = null;
  private taps = 0;
  private lastTime = 0;

  update(pressed: boolean, timeMs: number): void {
    if (pressed && this.downAt === null) this.downAt = timeMs;
    if (!pressed && this.downAt !== null) {
      if (timeMs - this.downAt < BOOT_HOLD_MS) this.taps++;
      this.downAt = null;
    }
    this.lastTime = timeMs;
  }

  /** Whether BOOT has been held long enough to be looking (as of the last sample). */
  holding(): boolean {
    return this.downAt !== null && this.lastTime - this.downAt >= BOOT_HOLD_MS;
  }

  /** Taps since the last call. */
  takeTaps(): number {
    const n = this.taps;
    this.taps = 0;
    return n;
  }
}

// ---- Bluetooth Low Energy -------------------------------------------------------

/** Must match firmware/src/main.cpp. */
export const BLE_NAME = 'PhaseEscape';
export const BLE_SERVICE = '6f1c0001-3b0e-4b7c-9f4a-2d8e5a7c1b90';
export const BLE_SAMPLE = '6f1c0002-3b0e-4b7c-9f4a-2d8e5a7c1b90';
export const BLE_COMMAND = '6f1c0003-3b0e-4b7c-9f4a-2d8e5a7c1b90';
export const BLE_LOG = '6f1c0004-3b0e-4b7c-9f4a-2d8e5a7c1b90';
const BLE_FORMAT = 1;

/**
 * Decodes one BLE sample notification (16 bytes, little-endian):
 *
 *   [0] format (1)  [1] sequence  [2] buttons  [3] calibration sys<<6|gyr<<4|acc<<2|mag
 *   [4..9]   gravity x, y, z: int16, 0.01 m/s²
 *   [10..15] gyro x, y, z: int16, 1/16 °/s (converted to rad/s here)
 *
 * Returns the sample and its sequence number, or null for anything else
 * (wrong length or format version).
 */
export function parseBlePacket(view: DataView): { sample: Sample; seq: number } | null {
  if (view.byteLength !== 16 || view.getUint8(0) !== BLE_FORMAT) return null;
  const c = view.getUint8(3);
  const i16 = (o: number) => view.getInt16(o, true);
  const gyro = (o: number) => ((i16(o) / 16) * Math.PI) / 180;
  return {
    seq: view.getUint8(1),
    sample: {
      quat: null,
      gravity: [i16(4) / 100, i16(6) / 100, i16(8) / 100],
      gyro: [gyro(10), gyro(12), gyro(14)],
      calibration: ((c >> 6) & 3) * 1000 + ((c >> 4) & 3) * 100 + ((c >> 2) & 3) * 10 + (c & 3),
      buttons: view.getUint8(2),
    },
  };
}
