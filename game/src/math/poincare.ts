/**
 * Maps between the hyperboloid and the two flat disk models used for display
 * and culling. Both disks are the open unit disk; scale by the screen radius.
 *
 * - Poincaré disk: conformal (angles are true), geodesics are circular arcs
 *   meeting the boundary at right angles. This is what the player sees.
 * - Klein disk: geodesics are straight chords, angles are distorted. Handy for
 *   straight-line tests such as culling.
 */

import type { ReadonlyVec3, Vec3 } from './lorentz';

export type Vec2 = [number, number];

// Largest radius we let a mapped point have. Points farther than ~37 units
// from the centre round to radius exactly 1 in float64 (the disk radius is
// tanh(d/2)); clamping keeps every mapped point strictly inside the disk.
// The game culls tiles beyond ~7 units, so this never affects what is drawn.
const MAX_RADIUS = 1 - 4 * Number.EPSILON;

/** Scales (x, y) in place so its length is at most MAX_RADIUS. */
function clampInside(out: Vec2): Vec2 {
  const r2 = out[0] * out[0] + out[1] * out[1];
  if (r2 > MAX_RADIUS * MAX_RADIUS) {
    const k = MAX_RADIUS / Math.sqrt(r2);
    out[0] *= k;
    out[1] *= k;
  }
  return out;
}

/**
 * Hyperboloid → Poincaré disk: (x, y, z) ↦ (x, y) / (1 + z).
 *
 * This is stereographic projection from (0, 0, −1). A point at distance d from
 * O lands at radius tanh(d/2) < 1.
 */
export function toPoincare(p: ReadonlyVec3, out: Vec2 = [0, 0]): Vec2 {
  const k = 1 / (1 + p[2]);
  out[0] = p[0] * k;
  out[1] = p[1] * k;
  return clampInside(out);
}

/** Poincaré disk → hyperboloid: w ↦ (2w, 1 + |w|²) / (1 − |w|²). Requires |w| < 1. */
export function fromPoincare(w: Readonly<Vec2>): Vec3 {
  const r2 = w[0] * w[0] + w[1] * w[1];
  const k = 1 / (1 - r2);
  return [2 * w[0] * k, 2 * w[1] * k, (1 + r2) * k];
}

/**
 * Hyperboloid → Klein disk: (x, y, z) ↦ (x, y) / z.
 *
 * Central projection from the origin of ℝ³ onto the plane z = 1, which sends
 * geodesics (intersections with planes through 0) to straight chords. A point
 * at distance d from O lands at radius tanh(d).
 */
export function toKlein(p: ReadonlyVec3, out: Vec2 = [0, 0]): Vec2 {
  const k = 1 / p[2];
  out[0] = p[0] * k;
  out[1] = p[1] * k;
  return clampInside(out);
}

/** Klein disk → hyperboloid: k ↦ (k, 1) / √(1 − |k|²). Requires |k| < 1. */
export function fromKlein(k: Readonly<Vec2>): Vec3 {
  const g = 1 / Math.sqrt(1 - (k[0] * k[0] + k[1] * k[1]));
  return [k[0] * g, k[1] * g, g];
}

/** Radius in the Poincaré disk of a point at hyperbolic distance d from the centre. */
export function poincareRadius(d: number): number {
  return Math.tanh(d / 2);
}
