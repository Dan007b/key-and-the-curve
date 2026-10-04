/**
 * Geodesics (hyperbolic straight lines) on the hyperboloid: wall normals,
 * signed distances, interpolation and segment tests.
 *
 * A geodesic is the intersection of the hyperboloid with a plane through the
 * origin of ℝ³. We describe that plane by its Minkowski-unit normal n
 * (⟨n,n⟩ = +1); then a point p lies on the geodesic iff ⟨p,n⟩ = 0, and in
 * general ⟨p,n⟩ = sinh(signed distance from p to the geodesic).
 */

import { distance, minkowski } from './lorentz';
import type { Mat3, ReadonlyVec3, Vec3 } from './lorentz';

/** Ordinary Euclidean cross product a × b. */
export function cross(a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Unit normal of the geodesic through points a and b: n = J(a × b), scaled so
 * ⟨n,n⟩ = +1.
 *
 * Why J(a × b): ⟨n,a⟩ = (J(a×b))ᵀ J a = (a×b)·a = 0, and likewise for b, so n
 * is Minkowski-orthogonal to the plane through 0, a and b.
 *
 * Orientation: walking from a to b, points on the left have ⟨p,n⟩ > 0.
 * Throws if a = b, since then the geodesic is undefined.
 */
export function geodesicNormal(a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  const c = cross(a, b);
  const n: Vec3 = [c[0], c[1], -c[2]];
  const n2 = minkowski(n, n);
  if (!(n2 > 0)) {
    throw new Error('geodesicNormal: points coincide, geodesic undefined');
  }
  const k = 1 / Math.sqrt(n2);
  n[0] *= k;
  n[1] *= k;
  n[2] *= k;
  return n;
}

/**
 * Signed hyperbolic distance from p to the geodesic with unit normal n:
 * sinh(d) = ⟨p,n⟩. Positive on the left of the direction the normal was built from.
 */
export function signedDistanceToGeodesic(p: ReadonlyVec3, n: ReadonlyVec3): number {
  return Math.asinh(minkowski(p, n));
}

/**
 * Point a fraction t of the way along the geodesic from a to b (t = 0 → a,
 * t = 1 → b; values outside [0, 1] extrapolate along the same geodesic).
 *
 * Hyperbolic analogue of slerp:
 *   γ(t) = (sinh((1 − t)d) · a + sinh(t·d) · b) / sinh d,  d = dist(a, b).
 */
export function geodesicPoint(a: ReadonlyVec3, b: ReadonlyVec3, t: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const d = distance(a, b);
  let wa: number;
  let wb: number;
  if (d < 1e-9) {
    // sinh(x·d)/sinh(d) = x + O(d²); the error here is below 1e-18.
    wa = 1 - t;
    wb = t;
  } else {
    const s = Math.sinh(d);
    wa = Math.sinh((1 - t) * d) / s;
    wb = Math.sinh(t * d) / s;
  }
  out[0] = wa * a[0] + wb * b[0];
  out[1] = wa * a[1] + wb * b[1];
  out[2] = wa * a[2] + wb * b[2];
  return out;
}

/**
 * `count` points evenly spaced (by hyperbolic distance) along the geodesic
 * segment from a to b, including both endpoints. Used to draw edges as
 * polylines in the disk (12–24 samples is plenty at screen resolution).
 */
export function sampleGeodesic(a: ReadonlyVec3, b: ReadonlyVec3, count: number): Vec3[] {
  if (count < 2) {
    throw new Error('sampleGeodesic: need at least 2 samples');
  }
  const pts: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    pts.push(geodesicPoint(a, b, i / (count - 1)));
  }
  return pts;
}

/**
 * The point of the geodesic segment [a, b] closest to p.
 *
 * Parametrize the geodesic by arclength from a: γ(s) = cosh(s)·a + sinh(s)·t̂,
 * where t̂ = (b − cosh(d)·a)/sinh(d) is the unit tangent at a towards b. If p is
 * at height h above the geodesic with foot γ(s₀), then
 *   cosh dist(p, γ(s)) = cosh(h) · cosh(s − s₀),
 * which grows with |s − s₀|. So the closest point of the segment is γ(s₀)
 * clamped to s ∈ [0, d], and s₀ = asinh(⟨p,t̂⟩ / cosh h).
 */
export function closestPointOnSegment(p: ReadonlyVec3, a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  const d = distance(a, b);
  if (d === 0) {
    return [a[0], a[1], a[2]];
  }
  const coshD = Math.cosh(d);
  const sinhD = Math.sinh(d);
  const t: Vec3 = [(b[0] - coshD * a[0]) / sinhD, (b[1] - coshD * a[1]) / sinhD, (b[2] - coshD * a[2]) / sinhD];

  const sinhH = minkowski(p, geodesicNormal(a, b));
  const coshH = Math.sqrt(1 + sinhH * sinhH);
  const s0 = Math.asinh(minkowski(p, t) / coshH);

  if (s0 <= 0) {
    return [a[0], a[1], a[2]];
  }
  if (s0 >= d) {
    return [b[0], b[1], b[2]];
  }
  const cs = Math.cosh(s0);
  const ss = Math.sinh(s0);
  return [cs * a[0] + ss * t[0], cs * a[1] + ss * t[1], cs * a[2] + ss * t[2]];
}

/** Hyperbolic distance from p to the geodesic segment [a, b]. */
export function distanceToSegment(p: ReadonlyVec3, a: ReadonlyVec3, b: ReadonlyVec3): number {
  return distance(p, closestPointOnSegment(p, a, b));
}

/**
 * The frame at the midpoint m of the segment a→b: an isometry taking O to m,
 * its x axis to the direction towards b along the segment, and its y axis to
 * the segment's normal n. Columns (t, n, m) with ⟨t,t⟩ = ⟨n,n⟩ = 1 and
 * ⟨m,m⟩ = −1, all mutually orthogonal, so it is in SO⁺(2,1) up to the
 * orientation of (t, n). Rifts draw their planks in this frame.
 */
export function segmentFrame(a: ReadonlyVec3, b: ReadonlyVec3): Mat3 {
  const m = geodesicPoint(a, b, 0.5);
  const n = geodesicNormal(a, b);
  // Tangent towards b: project b onto m's tangent space (u + ⟨u,m⟩m), then normalise.
  const bm = minkowski(b, m);
  const t: Vec3 = [b[0] + bm * m[0], b[1] + bm * m[1], b[2] + bm * m[2]];
  const k = 1 / Math.sqrt(minkowski(t, t));
  t[0] *= k;
  t[1] *= k;
  t[2] *= k;
  return [t[0], n[0], m[0], t[1], n[1], m[1], t[2], n[2], m[2]];
}
