/**
 * Hyperboloid (Lorentz) model of the hyperbolic plane, curvature −1.
 *
 * Points are vectors p = (x, y, z) in ℝ³ with ⟨p,p⟩ = −1 and z > 0, where
 * ⟨a,b⟩ = aₓbₓ + a_y b_y − a_z b_z is the Minkowski product. The origin is
 * O = (0, 0, 1). Isometries are 3×3 matrices in SO⁺(2,1), i.e. matrices M with
 * Mᵀ J M = J (J = diag(1, 1, −1)), det M = +1, preserving z > 0.
 *
 * Conventions used throughout the game:
 * - Matrices are row-major 9-tuples: m[3*row + col].
 * - A frame M maps local coordinates to world coordinates; its third column
 *   M·O is the frame's position, its first two columns are its x and y axes.
 * - Angles are counter-clockwise when viewed with +z towards the viewer.
 *
 * Functions return fresh arrays unless an `out` argument is given; every
 * function that takes `out` is safe when `out` aliases an input.
 */

export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type ReadonlyVec3 = Readonly<Vec3>;
export type ReadonlyMat3 = Readonly<Mat3>;

/** The origin O = (0, 0, 1) of the hyperboloid. */
export const ORIGIN: ReadonlyVec3 = [0, 0, 1];

/** Minkowski product ⟨a,b⟩ = aₓbₓ + a_y b_y − a_z b_z. */
export function minkowski(a: ReadonlyVec3, b: ReadonlyVec3): number {
  return a[0] * b[0] + a[1] * b[1] - a[2] * b[2];
}

/** The 3×3 identity matrix. */
export function identity(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

/** Matrix product a·b. */
export function mul(a: ReadonlyMat3, b: ReadonlyMat3, out: Mat3 = identity()): Mat3 {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = a;
  const [b0, b1, b2, b3, b4, b5, b6, b7, b8] = b;
  out[0] = a0 * b0 + a1 * b3 + a2 * b6;
  out[1] = a0 * b1 + a1 * b4 + a2 * b7;
  out[2] = a0 * b2 + a1 * b5 + a2 * b8;
  out[3] = a3 * b0 + a4 * b3 + a5 * b6;
  out[4] = a3 * b1 + a4 * b4 + a5 * b7;
  out[5] = a3 * b2 + a4 * b5 + a5 * b8;
  out[6] = a6 * b0 + a7 * b3 + a8 * b6;
  out[7] = a6 * b1 + a7 * b4 + a8 * b7;
  out[8] = a6 * b2 + a7 * b5 + a8 * b8;
  return out;
}

/** Matrix-vector product m·v. */
export function apply(m: ReadonlyMat3, v: ReadonlyVec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const [x, y, z] = v;
  out[0] = m[0] * x + m[1] * y + m[2] * z;
  out[1] = m[3] * x + m[4] * y + m[5] * z;
  out[2] = m[6] * x + m[7] * y + m[8] * z;
  return out;
}

/**
 * Inverse of a Lorentz matrix: M⁻¹ = J Mᵀ J.
 *
 * Exact (no division) and valid only for M in O(2,1). Entry (i,j) of J Mᵀ J is
 * Jᵢ · M[j][i] · Jⱼ, so the transpose is negated where exactly one of i, j is
 * the timelike index 2.
 */
export function lorentzInverse(m: ReadonlyMat3, out: Mat3 = identity()): Mat3 {
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = m;
  out[0] = m0;
  out[1] = m3;
  out[2] = -m6;
  out[3] = m1;
  out[4] = m4;
  out[5] = -m7;
  out[6] = -m2;
  out[7] = -m5;
  out[8] = m8;
  return out;
}

/** Rotation by `theta` (counter-clockwise) about the origin O. */
export function rotation(theta: number): Mat3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Boost (hyperbolic translation) by distance `d` along the x axis through O. */
export function boostX(d: number): Mat3 {
  const ch = Math.cosh(d);
  const sh = Math.sinh(d);
  return [ch, 0, sh, 0, 1, 0, sh, 0, ch];
}

/**
 * The point reached from O by walking distance |u| in direction u, where u is
 * a tangent vector at O (the exponential map at the origin):
 * exp(u) = (sinh|u| · u/|u|, cosh|u|).
 */
export function expOrigin(ux: number, uy: number): Vec3 {
  const r = Math.hypot(ux, uy);
  // sinh(r)/r → 1 as r → 0; computing the ratio directly is accurate for r > 0.
  const f = r > 0 ? Math.sinh(r) / r : 1;
  return [f * ux, f * uy, Math.cosh(r)];
}

/**
 * Inverse of {@link expOrigin}: the tangent vector at O pointing at p, with
 * length equal to the distance from O to p.
 *
 * Uses asinh of the horizontal radius rather than acosh(z): acosh loses half
 * its significant digits near z = 1, asinh does not.
 */
export function logOrigin(p: ReadonlyVec3): [number, number] {
  const s = Math.hypot(p[0], p[1]);
  if (s === 0) {
    return [0, 0];
  }
  const k = Math.asinh(s) / s;
  return [k * p[0], k * p[1]];
}

/**
 * The translation (transvection) along the geodesic from O to point p:
 * the unique isometry that maps O to p with no rotation relative to parallel
 * transport along that geodesic.
 *
 * Closed form of R(φ)·Bₓ(d)·R(−φ) with sinh d·(cos φ, sin φ) = (pₓ, p_y),
 * cosh d = p_z:
 *
 *     ⎡ 1 + pₓ²/(1+p_z)   pₓp_y/(1+p_z)    pₓ  ⎤
 *     ⎢ pₓp_y/(1+p_z)     1 + p_y²/(1+p_z) p_y ⎥
 *     ⎣ pₓ                p_y              p_z ⎦
 *
 * This needs no trig and no division by the (possibly zero) distance.
 */
export function translationTo(p: ReadonlyVec3): Mat3 {
  const [x, y, z] = p;
  const k = 1 / (1 + z);
  return [1 + x * x * k, x * y * k, x, x * y * k, 1 + y * y * k, y, x, y, z];
}

/**
 * Translation T(u) by a tangent vector u at O: moves O a distance |u| in the
 * direction of u. Equal to R(φ)·Bₓ(|u|)·R(−φ) with φ = atan2(u).
 *
 * Composing on the right, M ← M·T(v·dt), moves a frame along the geodesic in
 * its own local direction v; this is exactly parallel transport (CLAUDE.md §6.3).
 */
export function translation(ux: number, uy: number): Mat3 {
  return translationTo(expOrigin(ux, uy));
}

/**
 * Hyperbolic distance between two points of the hyperboloid.
 *
 * The textbook formula d = acosh(−⟨p,q⟩) loses about half of its significant
 * digits for nearby points (acosh has infinite slope at 1). Instead we use
 * ⟨p−q, p−q⟩ = 2(cosh d − 1) = 4 sinh²(d/2), so d = 2 asinh(√⟨p−q,p−q⟩ / 2),
 * which is accurate for small d. Both formulas suffer from cancellation when
 * both points are far from O (coordinates ~cosh of their distance from O);
 * the game measures distances in the marble's local frame, near O.
 */
export function distance(p: ReadonlyVec3, q: ReadonlyVec3): number {
  const dx = p[0] - q[0];
  const dy = p[1] - q[1];
  const dz = p[2] - q[2];
  const m2 = Math.max(0, dx * dx + dy * dy - dz * dz);
  return 2 * Math.asinh(Math.sqrt(m2) / 2);
}

/**
 * Restores M to an exact Lorentz matrix after floating-point drift, using
 * Gram–Schmidt with respect to the Minkowski form on the columns.
 *
 * The third column (the frame's position) is fixed first and normalized to
 * ⟨c,c⟩ = −1; the first and second columns are then made Minkowski-orthogonal
 * to it and to each other and normalized to ⟨c,c⟩ = +1. Starting with the
 * position means the correction never moves the marble, only re-squares its axes.
 *
 * For a matrix within ε of SO⁺(2,1), the result is within O(ε) of the input
 * and satisfies Mᵀ J M = J to ~1e-15 (see tests).
 */
export function reorthonormalize(m: ReadonlyMat3, out: Mat3 = identity()): Mat3 {
  // Columns.
  let ax = m[0], ay = m[3], az = m[6];
  let bx = m[1], by = m[4], bz = m[7];
  let cx = m[2], cy = m[5], cz = m[8];

  // Position column: timelike, ⟨c,c⟩ = −1, upper sheet (z > 0).
  const cn = Math.sqrt(-(cx * cx + cy * cy - cz * cz)) * Math.sign(cz);
  cx /= cn; cy /= cn; cz /= cn;

  // x axis: remove the component along c (projection coefficient is ⟨a,c⟩/⟨c,c⟩ = −⟨a,c⟩).
  const ac = ax * cx + ay * cy - az * cz;
  ax += ac * cx; ay += ac * cy; az += ac * cz;
  const an = Math.sqrt(ax * ax + ay * ay - az * az);
  ax /= an; ay /= an; az /= an;

  // y axis: remove components along c and a.
  const bc = bx * cx + by * cy - bz * cz;
  bx += bc * cx; by += bc * cy; bz += bc * cz;
  const ba = bx * ax + by * ay - bz * az;
  bx -= ba * ax; by -= ba * ay; bz -= ba * az;
  const bn = Math.sqrt(bx * bx + by * by - bz * bz);
  bx /= bn; by /= bn; bz /= bn;

  out[0] = ax; out[1] = bx; out[2] = cx;
  out[3] = ay; out[4] = by; out[5] = cy;
  out[6] = az; out[7] = bz; out[8] = cz;
  return out;
}

/**
 * Largest absolute entry of Mᵀ J M − J: zero for an exact Lorentz matrix.
 * Used by tests and debug checks to measure drift.
 */
export function lorentzError(m: ReadonlyMat3): number {
  const J = [1, 1, -1] as const;
  let worst = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      // (MᵀJM)ᵢⱼ = Σₖ M[k][i] · Jₖ · M[k][j]
      let s = 0;
      for (let k = 0; k < 3; k++) {
        s += (m[3 * k + i] as number) * J[k as 0 | 1 | 2] * (m[3 * k + j] as number);
      }
      const target = i === j ? J[i as 0 | 1 | 2] : 0;
      worst = Math.max(worst, Math.abs(s - target));
    }
  }
  return worst;
}

/**
 * Splits an isometry into M = T(position) · R(angle): a translation from O to
 * the frame's position, followed (on the right, i.e. in local coordinates) by
 * a rotation about O.
 *
 * `angle` is the frame's rotation relative to the frame you would get by
 * translating straight from O to `position`. After a closed loop
 * (position = O) it is exactly the holonomy rotation, which is how gates
 * measure how the maze's curvature has turned the key (CLAUDE.md §6.7).
 */
export function decompose(m: ReadonlyMat3): { position: Vec3; angle: number } {
  const position: Vec3 = [m[2], m[5], m[8]];
  const r = mul(lorentzInverse(translationTo(position)), m);
  // r = R(angle) = [[c, −s, 0], [s, c, 0], [0, 0, 1]].
  return { position, angle: Math.atan2(r[3], r[0]) };
}
