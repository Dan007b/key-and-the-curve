import { describe, expect, it } from 'vitest';
import { ORIGIN, expOrigin } from '../src/math/lorentz';
import { geodesicPoint } from '../src/math/geodesic';
import { fromKlein, fromPoincare, poincareRadius, toKlein, toPoincare } from '../src/math/poincare';
import { maxDiff, randomPoint, rng } from './helpers';

describe('Poincaré disk', () => {
  it('maps O to the centre', () => {
    expect(toPoincare(ORIGIN)).toEqual([0, 0]);
  });

  it('puts a point at distance d at radius tanh(d/2)', () => {
    for (const d of [0.1, 1, 3, 7]) {
      const [x, y] = toPoincare(expOrigin(d, 0));
      expect(Math.hypot(x, y)).toBeCloseTo(poincareRadius(d), 14);
    }
  });

  it('stays strictly inside the unit disk, even for extreme points', () => {
    const rand = rng(20);
    for (let i = 0; i < 1000; i++) {
      const [x, y] = toPoincare(randomPoint(rand, 30));
      expect(Math.hypot(x, y)).toBeLessThan(1);
    }
    // Beyond ~37 units float64 rounds tanh(d/2) to 1; the clamp keeps it inside.
    for (const d of [40, 100, 700]) {
      const [x, y] = toPoincare(expOrigin(d * 0.6, d * 0.8));
      expect(Math.hypot(x, y)).toBeLessThan(1);
    }
  });

  it('round-trips through fromPoincare', () => {
    const rand = rng(21);
    for (let i = 0; i < 200; i++) {
      const p = randomPoint(rand, 5);
      const back = fromPoincare(toPoincare(p));
      expect(maxDiff(back, p) / p[2]).toBeLessThan(1e-12);
    }
  });
});

describe('Klein disk', () => {
  it('puts a point at distance d at radius tanh(d)', () => {
    const [x, y] = toKlein(expOrigin(0, 1.5));
    expect(Math.hypot(x, y)).toBeCloseTo(Math.tanh(1.5), 14);
  });

  it('round-trips through fromKlein', () => {
    // Klein squeezes far points against the rim (radius tanh d), and 1/√(1 − |k|²)
    // amplifies rounding by ~z² on the way back: ~1e-12 relative at d = 5.
    const rand = rng(22);
    for (let i = 0; i < 200; i++) {
      const p = randomPoint(rand, 5);
      expect(maxDiff(fromKlein(toKlein(p)), p) / p[2]).toBeLessThan(1e-10);
    }
  });

  it('sends geodesics to straight lines', () => {
    const rand = rng(23);
    for (let i = 0; i < 50; i++) {
      const a = randomPoint(rand);
      const b = randomPoint(rand);
      const [ax, ay] = toKlein(a);
      const [bx, by] = toKlein(b);
      for (const t of [0.2, 0.5, 0.9]) {
        const [mx, my] = toKlein(geodesicPoint(a, b, t));
        // 2D cross product of (b − a) and (m − a) vanishes for collinear points.
        expect((bx - ax) * (my - ay) - (by - ay) * (mx - ax)).toBeCloseTo(0, 10);
      }
    }
  });
});
