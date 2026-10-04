/**
 * The gate as a 4D combination lock, for the player's benefit.
 *
 * A gate's target is a rotation of the key. In this game every target is
 * written as twists in the W planes followed by a turn in the XY plane, so
 * it splits into four "tumblers":
 *
 * - curvature (XY): set only by rolling around pillars, in 72° steps;
 * - XW, YW, ZW: set by twisting.
 *
 * analyzeLock() reports, for each tumbler, how far off it is and what to do,
 * which the HUD shows as dials. (The gate itself still opens on the plain fit
 * distance; this is guidance, not a second rule.)
 */

import { bestTwistAngle, rotationFromList } from '../math/four';
import type { Mat4, Plane } from '../math/four';
import type { GateSpec } from './level';

export type TwistPlane = 'xw' | 'yw' | 'zw';
export const TWIST_PLANES: TwistPlane[] = ['xw', 'yw', 'zw'];

/** Keyboard keys for (+, −) in each twist plane. */
export const TWIST_KEYS: Record<TwistPlane, [string, string]> = { xw: ['Q', 'A'], yw: ['W', 'S'], zw: ['E', 'D'] };

/** A tumbler counts as set within this many degrees (the gate tolerance is ~14°). */
const SET_DEG = 4;

export interface CurvatureTumbler {
  needDeg: number;
  haveDeg: number;
  /** Signed laps still needed: + clockwise, − counter-clockwise (each is 72°). 0 when set. */
  laps: number;
  set: boolean;
}

export interface TwistTumbler {
  plane: TwistPlane;
  /** How far to twist this plane, degrees, in (−180, 180]. */
  remainingDeg: number;
  set: boolean;
}

export interface LockStatus {
  curvature: CurvatureTumbler;
  twists: TwistTumbler[];
  /** The twist plane to work on next (largest remaining), or null if all set. */
  next: TwistPlane | null;
  setCount: number;
}

function wrapDeg(d: number): number {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return x;
}

/** Splits a gate target into its curvature (XY) part and its twist (W-plane) part. */
export function splitTarget(target: GateSpec['target']): { xyDeg: number; twist: Mat4 } {
  const xyDeg = target.filter(([p]) => p === 'xy').reduce((s, [, a]) => s + a, 0);
  const twist = rotationFromList(target.filter(([p]) => p !== 'xy') as [Plane, number][]);
  return { xyDeg, twist };
}

/**
 * Lock status for a key in the marble's local frame and the holonomy measured
 * at the gate (radians). `degPerLap` is the turn from one lap around a pillar.
 */
export function analyzeLock(key: Mat4, holonomy: number, gate: GateSpec, degPerLap = 72): LockStatus {
  const { xyDeg, twist } = splitTarget(gate.target);
  const haveDeg = (holonomy * 180) / Math.PI;
  const diff = wrapDeg(xyDeg - haveDeg);
  // Clockwise laps add +72°; pick the shorter way round.
  const laps = Math.round(diff / degPerLap);
  const curvature: CurvatureTumbler = { needDeg: xyDeg, haveDeg, laps, set: Math.abs(diff) < 1 };

  const twists = TWIST_PLANES.map((plane) => {
    const remainingDeg = (bestTwistAngle(key, twist, plane) * 180) / Math.PI;
    return { plane, remainingDeg, set: Math.abs(remainingDeg) < SET_DEG };
  });
  const open = twists.filter((t) => !t.set).sort((a, b) => Math.abs(b.remainingDeg) - Math.abs(a.remainingDeg));
  const setCount = (curvature.set ? 1 : 0) + twists.filter((t) => t.set).length;
  return { curvature, twists, next: open[0]?.plane ?? null, setCount };
}
