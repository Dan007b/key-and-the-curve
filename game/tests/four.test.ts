import { describe, expect, it } from 'vitest';
import { MARKED_VERTEX, TESSERACT_EDGES, TESSERACT_VERTICES, apply4, approach, det4, fitDistance, frobenius, generator, hyperoctahedralGroup, identity4, mul4, planeAngleToFit, planeRotation, project4to3, reorthonormalize4, rotationFromList, transpose4, twistStep, lookRotation, plankOrientation, plankSmear, shadowAxes } from '../src/math/four';
import type { Mat4, Plane } from '../src/math/four';
import { rng } from './helpers';

const PLANE_NAMES: Plane[] = ['xy', 'xz', 'xw', 'yz', 'yw', 'zw'];
const isOrthogonal = (m: Mat4) => frobenius(mul4(m, transpose4(m)), identity4()) < 1e-12;
const key = (m: Mat4) => m.map((x) => Math.round(x)).join(',');

describe('B₄⁺, the rotation group of the tesseract', () => {
  const group = hyperoctahedralGroup();

  it('has 192 elements (and the full B₄ has 384)', () => {
    expect(group).toHaveLength(192);
    expect(new Set(group.map(key)).size).toBe(192);
    expect(hyperoctahedralGroup(false)).toHaveLength(384);
  });

  it('consists of orthogonal matrices with det = 1', () => {
    for (const g of group) {
      expect(isOrthogonal(g)).toBe(true);
      expect(det4(g)).toBeCloseTo(1, 12);
    }
  });

  it('is closed under multiplication', () => {
    const keys = new Set(group.map(key));
    for (const a of group) {
      for (const b of group) expect(keys.has(key(mul4(a, b)))).toBe(true);
    }
  });

  it('maps the tesseract onto itself', () => {
    const verts = new Set(TESSERACT_VERTICES.map((v) => v.join(',')));
    for (const g of group) {
      for (const v of TESSERACT_VERTICES) expect(verts.has(apply4(g, v).map(Math.round).join(','))).toBe(true);
    }
  });
});

describe('plane rotations', () => {
  it('are rotations, and exp(θE) agrees with them', () => {
    for (const p of PLANE_NAMES) {
      const r = planeRotation(p, 0.7);
      expect(isOrthogonal(r)).toBe(true);
      expect(det4(r)).toBeCloseTo(1, 12);
      // exp(θE) by a long Taylor series.
      const e = generator(p).map((x) => x * 0.7);
      let term = identity4();
      let sum = identity4();
      for (let n = 1; n < 30; n++) {
        term = mul4(term, e).map((x) => x / n);
        sum = sum.map((x, i) => x + term[i]);
      }
      expect(frobenius(sum, r)).toBeLessThan(1e-12);
    }
  });

  it('XW by 90° sends x to w', () => {
    expect(apply4(planeRotation('xw', Math.PI / 2), [1, 0, 0, 0]).map((x) => Math.round(x * 1e12) / 1e12)).toEqual([0, 0, 0, 1]);
  });

  it('builds targets from lists, first entry first', () => {
    const r = rotationFromList([['xw', 90], ['xy', 72]]);
    const expected = mul4(planeRotation('xy', (72 * Math.PI) / 180), planeRotation('xw', Math.PI / 2));
    expect(frobenius(r, expected)).toBeLessThan(1e-12);
  });
});

describe('twisting', () => {
  it('one second at π/2 rad/s in XW is a 90° turn, in 60 small steps', () => {
    let k = identity4();
    for (let i = 0; i < 60; i++) k = twistStep(k, [Math.PI / 2, 0, 0], 1 / 60);
    expect(frobenius(k, planeRotation('xw', Math.PI / 2))).toBeLessThan(1e-9);
  });

  it('stays an exact rotation under long random twisting', () => {
    const rand = rng(9);
    let k = identity4();
    for (let i = 0; i < 20000; i++) k = twistStep(k, [rand() * 6 - 3, rand() * 6 - 3, rand() * 6 - 3], 1 / 60);
    expect(isOrthogonal(k)).toBe(true);
    expect(det4(k)).toBeCloseTo(1, 12);
  });

  it('reorthonormalize4 repairs a perturbed rotation', () => {
    const rand = rng(10);
    const r = rotationFromList([['xw', 30], ['yz', 50], ['zw', -20]]);
    const noisy = r.map((x) => x + (rand() - 0.5) * 1e-4);
    const fixed = reorthonormalize4(noisy);
    expect(isOrthogonal(fixed)).toBe(true);
    expect(frobenius(fixed, r)).toBeLessThan(1e-3);
  });
});

describe('the fit test', () => {
  it('is zero at the target and grows with the angle off', () => {
    const t = rotationFromList([['xw', 90]]);
    expect(fitDistance(t, t)).toBeCloseTo(0, 12);
    for (const off of [5, 14, 30, 90]) {
      const k = mul4(planeRotation('xw', (off * Math.PI) / 180), t);
      expect(fitDistance(k, t)).toBeCloseTo(planeAngleToFit((off * Math.PI) / 180), 12);
    }
  });

  it('an unmarked tesseract cannot tell a 90° twist from none, which is why the key is marked', () => {
    const group = hyperoctahedralGroup();
    const target = rotationFromList([['xw', 90]]);
    // Up to the tesseract's symmetries, the untouched key already "fits"...
    expect(fitDistance(identity4(), target, group)).toBeCloseTo(0, 12);
    // ...and so does a 90° curvature turn in XY. A 72° turn does not.
    expect(fitDistance(planeRotation('xy', Math.PI / 2), identity4(), group)).toBeCloseTo(0, 12);
    expect(fitDistance(planeRotation('xy', (72 * Math.PI) / 180), identity4(), group)).toBeGreaterThan(0.4);
    // With the marking (identity symmetry only), the 90° twist is required.
    expect(fitDistance(identity4(), target)).toBeCloseTo(2, 12);
  });

  it('approach() converges smoothly onto the target', () => {
    let k = rotationFromList([['xw', 80]]);
    const t = rotationFromList([['xw', 90]]);
    for (let i = 0; i < 60; i++) k = approach(k, t, 0.2);
    expect(frobenius(k, t)).toBeLessThan(1e-5);
    expect(isOrthogonal(k)).toBe(true);
  });
});

describe('the tesseract', () => {
  it('has 16 vertices and 32 edges of length 2, eight along each axis', () => {
    expect(TESSERACT_VERTICES).toHaveLength(16);
    expect(TESSERACT_EDGES).toHaveLength(32);
    for (const e of TESSERACT_EDGES) {
      const a = TESSERACT_VERTICES[e.a];
      const b = TESSERACT_VERTICES[e.b];
      expect(Math.hypot(...a.map((x, i) => x - b[i]))).toBe(2);
    }
    for (let axis = 0; axis < 4; axis++) expect(TESSERACT_EDGES.filter((e) => e.axis === axis)).toHaveLength(8);
    expect(TESSERACT_VERTICES[MARKED_VERTEX]).toEqual([1, 1, 1, 1]);
  });

  it('projects nearer-in-w vertices larger', () => {
    const near = project4to3([1, 1, 1, 1]);
    const far = project4to3([1, 1, 1, -1]);
    expect(near[0]).toBeGreaterThan(far[0]);
  });
});

describe('looking into 4D: plank shadows', () => {
  const ext = [0.1, 0.32, 0.1, 0.3];

  it('the view is a proper rotation, and the plank lies flat exactly at its target', () => {
    const l = lookRotation(37, -52);
    expect(Math.abs(det4(l) - 1)).toBeLessThan(1e-12);
    expect(frobenius(mul4(l, transpose4(l)), identity4())).toBeLessThan(1e-12);
    expect(plankSmear(plankOrientation([37, -52], [37, -52]), ext)).toBeLessThan(1e-12);
    // From the target, the shadow is the flat rectangle: w and z vanish.
    const g = shadowAxes(plankOrientation([37, -52], [37, -52]), ext);
    expect(g[3][0] ** 2 + g[3][1] ** 2).toBeLessThan(1e-24);
  });

  it('has one solution: every view whose shadow is nearly flat is close to the target', () => {
    for (const target of [[40, -30], [-60, 45], [55, 60], [20, -60]] as [number, number][]) {
      for (let a = -90; a <= 90; a += 1) {
        for (let b = -90; b <= 90; b += 1) {
          if (plankSmear(plankOrientation([a, b], target), ext) < 0.08) {
            expect(Math.abs(a - target[0]), `${target} at ${a},${b}`).toBeLessThanOrEqual(8);
            expect(Math.abs(b - target[1]), `${target} at ${a},${b}`).toBeLessThanOrEqual(14);
          }
        }
      }
    }
  });

  it('smears more the further you look from the target', () => {
    const t: [number, number] = [30, -45];
    let last = 0;
    for (const off of [1, 2, 4, 8, 16, 32]) {
      const s = plankSmear(plankOrientation([t[0] + off, t[1]], t), ext);
      expect(s).toBeGreaterThan(last);
      last = s;
    }
  });
});
