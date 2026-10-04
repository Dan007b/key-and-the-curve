/**
 * The controller's line protocol (CLAUDE.md §5, docs/HARDWARE.md) and the
 * pure maths that turns a sample into game input. No I/O here, so it is all
 * unit-tested.
 *
 *   $,qw,qx,qy,qz,gx,gy,gz,wx,wy,wz,cal,btn
 */

export interface Sample {
  /** Fused orientation quaternion (w, x, y, z). */
  quat: [number, number, number, number];
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

/** Which sensor axis (0 = x, 1 = y, 2 = z) and sign drive each of the XW, YW, ZW planes. */
export interface TwistMapping {
  axes: [number, number, number];
  signs: [number, number, number];
}

export const DEFAULT_TWIST_MAPPING: TwistMapping = { axes: [0, 1, 2], signs: [1, 1, 1] };

/** Gyro rates (sensor frame) → twist rates for the XW, YW and ZW planes. */
export function mapTwist(gyro: V3, m: TwistMapping): V3 {
  return [0, 1, 2].map((i) => gyro[m.axes[i]] * m.signs[i]) as V3;
}

/**
 * One plane at a time: keeps only the strongest of the three twist rates and
 * zeroes the others, so an imperfect wrist rotation doesn't smear the key
 * across all three planes. Rates below `deadband` (rad/s) are ignored, and the
 * active plane only changes when another becomes `switchRatio` times
 * stronger (hysteresis, so it doesn't flicker between two similar axes).
 * Returns the filtered rates and the active plane index (−1 if none).
 */
export function dominantTwist(
  rates: V3,
  active: number,
  deadband = 0.3,
  switchRatio = 1.6,
): { rates: V3; active: number } {
  const mags = rates.map(Math.abs);
  let best = mags.indexOf(Math.max(...mags));
  if (mags[best] < deadband) return { rates: [0, 0, 0], active: -1 };
  if (active !== -1 && active !== best && mags[active] >= deadband && mags[best] < switchRatio * mags[active]) best = active;
  const out: V3 = [0, 0, 0];
  out[best] = rates[best];
  return { rates: out, active: best };
}
