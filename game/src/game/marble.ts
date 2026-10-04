/**
 * Marble physics in the marble's own local frame (CLAUDE.md §6.3).
 *
 * State: a frame M (marble position = M·O, axes = M's first two columns) and
 * a velocity v in those local axes. Each step adds acceleration, applies
 * damping, then moves with M ← M·T(v·dt). Keeping v local while composing
 * translations on the right is exactly parallel transport along the geodesic
 * the marble is rolling on, so no explicit rotation is ever added: curvature
 * turns the frame by itself.
 */

import { apply, distance, identity, logOrigin, lorentzInverse, mul, reorthonormalize, translation } from '../math/lorentz';
import type { Mat3, ReadonlyVec3, Vec3 } from '../math/lorentz';
import { closestPointOnSegment } from '../math/geodesic';

export interface MarbleParams {
  /** Hyperbolic radius of the marble. */
  radius: number;
  /** Acceleration at full tilt, units/s². */
  accel: number;
  /** Damping rate k in v ← v·exp(−k·dt), 1/s. */
  damping: number;
  /** Coefficient of restitution for bounces (0 = dead stop, 1 = perfect bounce). */
  restitution: number;
  /** Speed cap, units/s. Keeps per-step motion far below the wall thickness. */
  maxSpeed: number;
}

export const DEFAULT_MARBLE: MarbleParams = {
  radius: 0.14,
  accel: 3.2,
  damping: 0.9,
  restitution: 0.4,
  maxSpeed: 3.5,
};

/** Something the marble can bump into: a wall segment or a post (point). */
export type Collider =
  | { kind: 'segment'; a: ReadonlyVec3; b: ReadonlyVec3; radius: number }
  | { kind: 'point'; p: ReadonlyVec3; radius: number };

export class Marble {
  frame: Mat3 = identity();
  /** Velocity in local coordinates. */
  vel: [number, number] = [0, 0];

  constructor(public params: MarbleParams = DEFAULT_MARBLE) {}

  position(): Vec3 {
    return [this.frame[2], this.frame[5], this.frame[8]];
  }

  speed(): number {
    return Math.hypot(this.vel[0], this.vel[1]);
  }

  /**
   * Advances by dt with local acceleration (ax, ay) (already scaled), resolving
   * collisions. Returns the largest impact speed into a collider (0 if none).
   */
  step(dt: number, ax: number, ay: number, colliders: readonly Collider[], extraDamping = 0): number {
    const { damping, maxSpeed, restitution } = this.params;
    let [vx, vy] = this.vel;
    vx += ax * dt;
    vy += ay * dt;
    const decay = Math.exp(-(damping + extraDamping) * dt);
    vx *= decay;
    vy *= decay;
    const s = Math.hypot(vx, vy);
    if (s > maxSpeed) {
      vx *= maxSpeed / s;
      vy *= maxSpeed / s;
    }
    this.frame = mul(this.frame, translation(vx * dt, vy * dt));

    let impact = 0;
    for (const c of colliders) {
      const p = this.position();
      const closest = c.kind === 'segment' ? closestPointOnSegment(p, c.a, c.b) : c.p;
      const limit = this.params.radius + c.radius;
      const d = distance(p, closest);
      if (d >= limit) continue;
      // Direction to the contact point in local coordinates; push the other way.
      const [lx, ly] = logOrigin(apply(lorentzInverse(this.frame), closest));
      const len = Math.hypot(lx, ly);
      if (len < 1e-12) continue;
      const nx = -lx / len;
      const ny = -ly / len;
      this.frame = mul(this.frame, translation(nx * (limit - d), ny * (limit - d)));
      const vn = vx * nx + vy * ny;
      if (vn < 0) {
        vx -= (1 + restitution) * vn * nx;
        vy -= (1 + restitution) * vn * ny;
        impact = Math.max(impact, -vn);
      }
    }

    this.frame = reorthonormalize(this.frame, this.frame);
    this.vel = [vx, vy];
    return impact;
  }
}
