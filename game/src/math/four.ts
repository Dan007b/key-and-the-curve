/**
 * Four-dimensional rotations for the key (CLAUDE.md §6.7).
 *
 * 4×4 matrices are row-major 16-element arrays. Axes are x, y, z, w = 0..3.
 * A rotation "in the XW plane" turns x towards w and leaves y and z fixed;
 * in 4D, rotations happen in planes, not about axes.
 */

export type Mat4 = number[];
export type Vec4 = [number, number, number, number];
export type Plane = 'xy' | 'xz' | 'xw' | 'yz' | 'yw' | 'zw';

export const PLANES: Record<Plane, [number, number]> = {
  xy: [0, 1],
  xz: [0, 2],
  xw: [0, 3],
  yz: [1, 2],
  yw: [1, 3],
  zw: [2, 3],
};

/** The 4×4 identity: the key's starting orientation. */
export function identity4(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Matrix product a·b. */
export function mul4(a: readonly number[], b: readonly number[]): Mat4 {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = s;
    }
  }
  return out;
}

/** Transpose; for a rotation this is also the inverse. */
export function transpose4(m: readonly number[]): Mat4 {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = m[r * 4 + c];
  return out;
}

/** Matrix-vector product m·v. */
export function apply4(m: readonly number[], v: Readonly<Vec4>): Vec4 {
  const out: Vec4 = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) out[r] = m[r * 4] * v[0] + m[r * 4 + 1] * v[1] + m[r * 4 + 2] * v[2] + m[r * 4 + 3] * v[3];
  return out;
}

/** Determinant by cofactor expansion (fine for 4×4). */
export function det4(m: readonly number[]): number {
  const minor3 = (rows: number[], cols: number[]) => {
    const g = (i: number, j: number) => m[rows[i] * 4 + cols[j]];
    return (
      g(0, 0) * (g(1, 1) * g(2, 2) - g(1, 2) * g(2, 1)) -
      g(0, 1) * (g(1, 0) * g(2, 2) - g(1, 2) * g(2, 0)) +
      g(0, 2) * (g(1, 0) * g(2, 1) - g(1, 1) * g(2, 0))
    );
  };
  let d = 0;
  for (let c = 0; c < 4; c++) {
    const cols = [0, 1, 2, 3].filter((x) => x !== c);
    d += (c % 2 === 0 ? 1 : -1) * m[c] * minor3([1, 2, 3], cols);
  }
  return d;
}

/** Rotation by `angle` in a plane, turning its first axis towards its second. */
export function planeRotation(plane: Plane, angle: number): Mat4 {
  const [i, j] = PLANES[plane];
  const m = identity4();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  m[i * 4 + i] = c;
  m[i * 4 + j] = -s;
  m[j * 4 + i] = s;
  m[j * 4 + j] = c;
  return m;
}

/**
 * The antisymmetric generator E of a plane: exp(θE) = planeRotation(plane, θ).
 * E has −1 at (i, j) and +1 at (j, i).
 */
export function generator(plane: Plane): Mat4 {
  const [i, j] = PLANES[plane];
  const m = new Array<number>(16).fill(0);
  m[i * 4 + j] = -1;
  m[j * 4 + i] = 1;
  return m;
}

/**
 * A rotation given as a list of plane rotations in degrees, applied in order
 * (the first entry acts first): [[p1, a1], [p2, a2]] → R₂·R₁.
 */
export function rotationFromList(list: readonly (readonly [Plane, number])[]): Mat4 {
  let r = identity4();
  for (const [plane, deg] of list) r = mul4(planeRotation(plane, (deg * Math.PI) / 180), r);
  return r;
}

/**
 * One twist-mode step: K ← exp(dt·(ω₀E_xw + ω₁E_yw + ω₂E_zw))·K.
 *
 * The exponential is approximated by the product of the three plane
 * rotations. The two differ by the commutator terms, of order dt²·|ω|²/2:
 * about 1e-3 rad per frame at 60 FPS even when twisting on two axes at
 * 3 rad/s. That is a slightly different path, not drift: the product is still
 * an exact rotation, and K is re-orthonormalized every frame anyway.
 */
export function twistStep(k: readonly number[], rates: readonly [number, number, number], dt: number): Mat4 {
  const step = mul4(planeRotation('xw', rates[0] * dt), mul4(planeRotation('yw', rates[1] * dt), planeRotation('zw', rates[2] * dt)));
  return reorthonormalize4(mul4(step, k));
}

/**
 * Nearest rotation by Gram–Schmidt on the rows (they are orthonormal for an
 * exact rotation). Fixes float drift; keeps det = +1 by flipping the last row
 * if a large error ever flipped orientation.
 */
export function reorthonormalize4(m: readonly number[]): Mat4 {
  const rows: number[][] = [0, 1, 2, 3].map((r) => m.slice(r * 4, r * 4 + 4));
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < i; j++) {
      const d = rows[i].reduce((s, x, k) => s + x * rows[j][k], 0);
      rows[i] = rows[i].map((x, k) => x - d * rows[j][k]);
    }
    const n = Math.hypot(...rows[i]);
    rows[i] = rows[i].map((x) => x / n);
  }
  const out = rows.flat();
  if (det4(out) < 0) for (let k = 12; k < 16; k++) out[k] = -out[k];
  return out;
}

/** Frobenius distance ‖a − b‖_F. */
export function frobenius(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < 16; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/**
 * The hyperoctahedral group B₄: every signed permutation matrix, the full
 * symmetry group of the tesseract (4!·2⁴ = 384 elements). With
 * `rotationsOnly`, the 192 with det = +1 (the rotations, B₄⁺).
 */
export function hyperoctahedralGroup(rotationsOnly = true): Mat4[] {
  const perms: number[][] = [];
  const permute = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) perms.push(prefix);
    rest.forEach((x, i) => permute([...prefix, x], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  permute([], [0, 1, 2, 3]);
  const group: Mat4[] = [];
  for (const p of perms) {
    for (let signs = 0; signs < 16; signs++) {
      const m = new Array<number>(16).fill(0);
      p.forEach((col, row) => {
        m[row * 4 + col] = (signs >> row) & 1 ? -1 : 1;
      });
      if (!rotationsOnly || det4(m) > 0) group.push(m);
    }
  }
  return group;
}

/**
 * How far orientation K is from fitting `target`, given the key's symmetries:
 * min over S of ‖K − S·target‖_F (CLAUDE.md §6.7).
 *
 * An unmarked tesseract would use all of B₄⁺, but B₄⁺ contains every 90°
 * plane rotation, so a 90° twist would fit without doing anything. The game's
 * key is marked (coloured axes and one marked corner), so its only symmetry
 * is the identity, which is the default here.
 */
export function fitDistance(k: readonly number[], target: readonly number[], symmetries: readonly Mat4[] = [identity4()]): number {
  let best = Infinity;
  for (const s of symmetries) best = Math.min(best, frobenius(k, mul4(s, target)));
  return best;
}

/**
 * The twist angle θ in one plane that brings K closest to `target`, i.e. the
 * θ minimising ‖R_plane(θ)·K − target‖_F. Used to tell the player which way
 * to turn, and how far.
 *
 * ‖R K − T‖² = const − 2·tr(Tᵀ R K) = const − 2·tr(R·M) with M = K·Tᵀ, and
 * for a rotation in plane (i, j): tr(R·M) = rest + cos θ·(M_ii + M_jj)
 * + sin θ·(M_ij − M_ji). That is maximised at θ = atan2(M_ij − M_ji, M_ii + M_jj).
 * If the remaining mismatch is a pure rotation in this plane, θ is exactly it.
 */
export function bestTwistAngle(k: readonly number[], target: readonly number[], plane: Plane): number {
  const [i, j] = PLANES[plane];
  // Only four entries of M = K·Tᵀ are needed: M_ab = Σ_c K_ac·T_bc.
  const m = (a: number, b: number) => k[a * 4] * target[b * 4] + k[a * 4 + 1] * target[b * 4 + 1] + k[a * 4 + 2] * target[b * 4 + 2] + k[a * 4 + 3] * target[b * 4 + 3];
  return Math.atan2(m(i, j) - m(j, i), m(i, i) + m(j, j));
}

/** Fit distance of a single-plane rotation by `angle` from the identity: 2√2·|sin(angle/2)|. */
export function planeAngleToFit(angle: number): number {
  return 2 * Math.SQRT2 * Math.abs(Math.sin(angle / 2));
}

// ---- The tesseract -----------------------------------------------------------

/** The 16 vertices (±1, ±1, ±1, ±1). Vertex i has coordinate k = +1 iff bit k of i is set. */
export const TESSERACT_VERTICES: Vec4[] = Array.from({ length: 16 }, (_, i) =>
  [0, 1, 2, 3].map((k) => ((i >> k) & 1 ? 1 : -1)) as Vec4,
);

/** The 32 edges: vertex pairs differing in exactly one coordinate, with that axis. */
export const TESSERACT_EDGES: { a: number; b: number; axis: number }[] = (() => {
  const edges: { a: number; b: number; axis: number }[] = [];
  for (let i = 0; i < 16; i++) {
    for (let k = 0; k < 4; k++) {
      const j = i ^ (1 << k);
      if (i < j) edges.push({ a: i, b: j, axis: k });
    }
  }
  return edges;
})();

/** Index of the marked corner, (+1, +1, +1, +1): the key's "bit". */
export const MARKED_VERTEX = 15;

/**
 * Perspective projection from 4D to 3D, looking along w from w = d:
 * (x, y, z) · s/(d − w). Points nearer the viewer (larger w) appear larger,
 * which is how the inner and outer cubes of the familiar picture arise.
 */
export function project4to3(v: Readonly<Vec4>, d = 3, s = 1.6): [number, number, number] {
  const f = s / (d - v[3]);
  return [v[0] * f, v[1] * f, v[2] * f];
}

/**
 * Moves K a fraction `alpha` of the way towards `target` and re-squares it.
 * Used to snap the key smoothly into a gate.
 */
export function approach(k: readonly number[], target: readonly number[], alpha: number): Mat4 {
  return reorthonormalize4(k.map((x, i) => x + alpha * (target[i] - x)));
}

// ---- Looking into the fourth dimension (rifts and planks) ---------------------

/**
 * Your 4D view: turned by `xwDeg` in the XW plane, then `ywDeg` in the YW
 * plane, L = R_yw(β)·R_xw(α). XW turns the floor's left-right direction
 * towards w, YW its up-down direction. The two angles are absolute (not
 * accumulated), so the view is a point in a square of angles, ±90° each.
 */
export function lookRotation(xwDeg: number, ywDeg: number): Mat4 {
  const d = Math.PI / 180;
  return mul4(planeRotation('yw', ywDeg * d), planeRotation('xw', xwDeg * d));
}

/**
 * How a plank that lies flat when viewed from `target` looks from `view`:
 * M = L(view)·L(target)⁻¹, its orientation relative to you. M = I at the
 * target. (Both angle pairs are [xw, yw] in degrees.)
 */
export function plankOrientation(view: readonly [number, number], target: readonly [number, number]): Mat4 {
  return mul4(lookRotation(view[0], view[1]), transpose4(lookRotation(target[0], target[1])));
}

/**
 * The plank's shadow on the floor: each of its four axes (half-extents
 * `ext`, along x, y, z, w) projected orthographically onto the xy plane.
 * The shadow is the zonogon these four vectors span; the corners of the
 * plank (±ext) land at sums of ± these vectors.
 */
export function shadowAxes(m: readonly number[], ext: readonly number[]): [number, number][] {
  return [0, 1, 2, 3].map((j) => [ext[j] * m[j], ext[j] * m[4 + j]] as [number, number]);
}

/**
 * Smear: how far the shadow is from the flat rectangle ext.x × ext.y it
 * makes from the target view, as a fraction of the plank's size. 0 when it
 * lies flat. The x and y axes may also be reversed (a rectangle looks the
 * same flipped); the z and w axes must vanish from the shadow.
 *
 * Over the ±90° square of views it has a single zero, at the target (checked
 * in four.test.ts); near it, 1° off in XW gives about 0.011, 1° in YW 0.006.
 */
export function plankSmear(m: readonly number[], ext: readonly number[]): number {
  const g = shadowAxes(m, ext);
  const ex = Math.min(Math.hypot(g[0][0] - ext[0], g[0][1]), Math.hypot(g[0][0] + ext[0], g[0][1]));
  const ey = Math.min(Math.hypot(g[1][0], g[1][1] - ext[1]), Math.hypot(g[1][0], g[1][1] + ext[1]));
  const ez = Math.hypot(g[2][0], g[2][1]);
  const ew = Math.hypot(g[3][0], g[3][1]);
  return (ex + ey + ez + ew) / (ext[0] + ext[1] + ext[2] + ext[3]);
}
