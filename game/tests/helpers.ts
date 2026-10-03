// Shared test utilities: a seeded RNG (so failures reproduce) and random
// isometries / points on the hyperboloid.

import { expOrigin, identity, mul, rotation, translation } from '../src/math/lorentz';
import type { Mat3, Vec3 } from '../src/math/lorentz';

/** Deterministic PRNG (mulberry32) returning floats in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random point within distance `maxDist` of the origin. */
export function randomPoint(rand: () => number, maxDist = 3): Vec3 {
  const r = rand() * maxDist;
  const phi = rand() * 2 * Math.PI;
  return expOrigin(r * Math.cos(phi), r * Math.sin(phi));
}

/** Random isometry R(α)·T(u)·R(β) with |u| ≤ maxDist. */
export function randomIsometry(rand: () => number, maxDist = 3): Mat3 {
  const r = rand() * maxDist;
  const phi = rand() * 2 * Math.PI;
  let m = identity();
  m = mul(m, rotation(rand() * 2 * Math.PI));
  m = mul(m, translation(r * Math.cos(phi), r * Math.sin(phi)));
  m = mul(m, rotation(rand() * 2 * Math.PI));
  return m;
}

/** Largest absolute difference between two equal-length number arrays. */
export function maxDiff(a: readonly number[], b: readonly number[]): number {
  let worst = 0;
  a.forEach((x, i) => {
    worst = Math.max(worst, Math.abs(x - (b[i] as number)));
  });
  return worst;
}

/** Angle wrapped to (−π, π]. */
export function wrapAngle(theta: number): number {
  const t = theta % (2 * Math.PI);
  if (t > Math.PI) return t - 2 * Math.PI;
  if (t <= -Math.PI) return t + 2 * Math.PI;
  return t;
}
