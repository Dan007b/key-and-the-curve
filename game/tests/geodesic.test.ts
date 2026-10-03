import { describe, expect, it } from 'vitest';
import { ORIGIN, apply, distance, expOrigin, minkowski } from '../src/math/lorentz';
import type { Vec3 } from '../src/math/lorentz';
import {
  closestPointOnSegment,
  distanceToSegment,
  geodesicNormal,
  geodesicPoint,
  sampleGeodesic,
  signedDistanceToGeodesic,
} from '../src/math/geodesic';
import { maxDiff, randomIsometry, randomPoint, rng } from './helpers';

/** Point at arclength s along the geodesic through a with unit tangent t, lifted by h along n. */
function offsetPoint(a: Vec3, t: Vec3, n: Vec3, s: number, h: number): Vec3 {
  const cs = Math.cosh(s), ss = Math.sinh(s), ch = Math.cosh(h), sh = Math.sinh(h);
  return [0, 1, 2].map((i) => ch * (cs * (a[i] as number) + ss * (t[i] as number)) + sh * (n[i] as number)) as Vec3;
}

/** A random geodesic segment [a, b] plus its unit tangent at a and normal. */
function randomSegment(rand: () => number) {
  const m = randomIsometry(rand, 2);
  const len = 0.5 + rand() * 2;
  // Build it at O along +x, then move it anywhere with a random isometry.
  const a = apply(m, ORIGIN);
  const b = apply(m, expOrigin(len, 0));
  const t = apply(m, [1, 0, 0]);
  const n = apply(m, [0, 1, 0]);
  return { a, b, t, n, len };
}

describe('geodesic normal', () => {
  it('is Minkowski-orthogonal to both points and unit length', () => {
    const rand = rng(30);
    for (let i = 0; i < 100; i++) {
      const a = randomPoint(rand);
      const b = randomPoint(rand);
      const n = geodesicNormal(a, b);
      expect(minkowski(n, a)).toBeCloseTo(0, 10);
      expect(minkowski(n, b)).toBeCloseTo(0, 10);
      expect(minkowski(n, n)).toBeCloseTo(1, 12);
    }
  });

  it('points to the left of a→b', () => {
    const n = geodesicNormal(ORIGIN, expOrigin(1, 0));
    expect(maxDiff(n, [0, 1, 0])).toBeLessThan(1e-15);
    expect(signedDistanceToGeodesic(expOrigin(0, 0.5), n)).toBeCloseTo(0.5, 14);
    expect(signedDistanceToGeodesic(expOrigin(0, -0.5), n)).toBeCloseTo(-0.5, 14);
  });

  it('throws for coincident points', () => {
    expect(() => geodesicNormal(ORIGIN, ORIGIN)).toThrow();
  });
});

describe('signed distance to a geodesic', () => {
  it('recovers the height of a point lifted off the geodesic', () => {
    const rand = rng(31);
    for (let i = 0; i < 100; i++) {
      const { a, b, t, n } = randomSegment(rand);
      const h = (rand() - 0.5) * 4;
      const p = offsetPoint(a, t, n, (rand() - 0.5) * 4, h);
      expect(signedDistanceToGeodesic(p, geodesicNormal(a, b))).toBeCloseTo(h, 9);
    }
  });
});

describe('geodesic interpolation', () => {
  it('hits the endpoints and divides the distance evenly', () => {
    const rand = rng(32);
    for (let i = 0; i < 50; i++) {
      const a = randomPoint(rand);
      const b = randomPoint(rand);
      const d = distance(a, b);
      expect(maxDiff(geodesicPoint(a, b, 0), a)).toBeLessThan(1e-12);
      expect(maxDiff(geodesicPoint(a, b, 1), b) / b[2]).toBeLessThan(1e-12);
      const m = geodesicPoint(a, b, 0.3);
      expect(distance(a, m)).toBeCloseTo(0.3 * d, 9);
      expect(distance(m, b)).toBeCloseTo(0.7 * d, 9);
      expect(minkowski(m, m)).toBeCloseTo(-1, 10);
    }
  });

  it('samples lie on the geodesic', () => {
    const a = expOrigin(-1, 0.5);
    const b = expOrigin(2, 1);
    const n = geodesicNormal(a, b);
    const pts = sampleGeodesic(a, b, 16);
    expect(pts).toHaveLength(16);
    for (const p of pts) {
      expect(minkowski(p, n)).toBeCloseTo(0, 12);
    }
  });
});

describe('segment tests', () => {
  it('uses the perpendicular foot when it lies inside the segment', () => {
    const rand = rng(33);
    for (let i = 0; i < 100; i++) {
      const { a, b, t, n, len } = randomSegment(rand);
      const s = (0.05 + 0.9 * rand()) * len;
      const h = (rand() - 0.5) * 3;
      const p = offsetPoint(a, t, n, s, h);
      expect(distanceToSegment(p, a, b)).toBeCloseTo(Math.abs(h), 9);
      expect(maxDiff(closestPointOnSegment(p, a, b), offsetPoint(a, t, n, s, 0))).toBeLessThan(1e-9);
    }
  });

  it('falls back to the nearer endpoint beyond the ends', () => {
    const rand = rng(34);
    for (let i = 0; i < 100; i++) {
      const { a, b, t, n, len } = randomSegment(rand);
      const h = (rand() - 0.5) * 3;
      const before = offsetPoint(a, t, n, -0.1 - rand(), h);
      const after = offsetPoint(a, t, n, len + 0.1 + rand(), h);
      expect(distanceToSegment(before, a, b)).toBeCloseTo(distance(before, a), 12);
      expect(distanceToSegment(after, a, b)).toBeCloseTo(distance(after, b), 12);
      expect(closestPointOnSegment(before, a, b)).toEqual([...a]);
      expect(closestPointOnSegment(after, a, b)).toEqual([...b]);
    }
  });

  it('is never farther than either endpoint', () => {
    const rand = rng(35);
    for (let i = 0; i < 200; i++) {
      const a = randomPoint(rand);
      const b = randomPoint(rand);
      const p = randomPoint(rand);
      const d = distanceToSegment(p, a, b);
      expect(d).toBeLessThanOrEqual(distance(p, a) + 1e-12);
      expect(d).toBeLessThanOrEqual(distance(p, b) + 1e-12);
    }
  });
});
