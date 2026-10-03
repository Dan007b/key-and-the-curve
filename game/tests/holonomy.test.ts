// The holonomy test (CLAUDE.md §6.6, Phase 2): carrying a frame around a
// closed geodesic polygon by pure translations, M ← M·T(step), rotates it by
// the polygon's area. This is the fact the whole game is built on.
//
// How the walk works. The frame P is only ever translated (parallel transport).
// The walker's heading ψ is tracked separately, in P's local coordinates: each
// edge is the step T(L·(cos ψ, sin ψ)), and at each vertex the walker turns
// left by the exterior angle, ψ += π − α. A walker who turned their own frame
// would end up facing exactly as they started (the polygon closes), so the
// rotation shows up only in the transported frame P:
//
//   P_final = P_start · R(−A),   A = (n − 2)π − Σαᵢ  (Gauss–Bonnet, K = −1)
//
// i.e. a counter-clockwise lap rotates transported vectors clockwise by the
// enclosed area. We check that P returns to its start point and that the
// rotation matches −A to 1e-9.

import { describe, expect, it } from 'vitest';
import { ORIGIN, decompose, distance, identity, mul, translation } from '../src/math/lorentz';
import type { Mat3 } from '../src/math/lorentz';
import { wrapAngle } from './helpers';

/** Transport a frame around a regular n-gon with side L and interior angle α; returns P_final. */
function walkRegularPolygon(n: number, side: number, interior: number): Mat3 {
  let p = identity();
  let heading = 0;
  for (let k = 0; k < n; k++) {
    p = mul(p, translation(side * Math.cos(heading), side * Math.sin(heading)));
    heading += Math.PI - interior;
  }
  return p;
}

/**
 * Side length and interior angle of a regular hyperbolic n-gon with
 * circumradius R. From the right triangle (centre, vertex, edge midpoint) with
 * angle π/n at the centre and hypotenuse R:
 *   sinh(L/2) = sinh R · sin(π/n),   cot(α/2) = cosh R · tan(π/n).
 */
function regularPolygon(n: number, circumradius: number) {
  const side = 2 * Math.asinh(Math.sinh(circumradius) * Math.sin(Math.PI / n));
  const interior = 2 * Math.atan(1 / (Math.cosh(circumradius) * Math.tan(Math.PI / n)));
  return { side, interior };
}

describe('holonomy', () => {
  it('one lap around a {5,4} tile rotates the frame by π/2', () => {
    // {5,4}: pentagons, four around each vertex, so α = 2π/4 = π/2.
    // Side length of a regular {p,q} tile, from the right triangle (centre,
    // vertex, edge midpoint) with angles π/p at the centre and π/q at the
    // vertex: cosh(L/2) = cos(π/p) / sin(π/q).
    const p = 5;
    const q = 4;
    const alpha = (2 * Math.PI) / q;
    const side = 2 * Math.acosh(Math.cos(Math.PI / p) / Math.sin(Math.PI / q));

    const pFinal = walkRegularPolygon(p, side, alpha);
    const { position, angle } = decompose(pFinal);

    // The walk closes: back at the start vertex.
    expect(distance(position, ORIGIN)).toBeLessThan(1e-9);
    // Area = 3π − 5·(π/2) = π/2, so the transported frame turned by −π/2.
    const area = (p - 2) * Math.PI - p * alpha;
    expect(area).toBeCloseTo(Math.PI / 2, 15);
    expect(Math.abs(wrapAngle(angle + Math.PI / 2))).toBeLessThan(1e-9);
  });

  it('matches −area for regular polygons of many shapes and sizes', () => {
    for (const n of [3, 4, 5, 7, 12]) {
      for (const radius of [0.1, 0.5, 1, 2]) {
        const { side, interior } = regularPolygon(n, radius);
        const area = (n - 2) * Math.PI - n * interior;
        const { position, angle } = decompose(walkRegularPolygon(n, side, interior));
        expect(distance(position, ORIGIN)).toBeLessThan(1e-9);
        expect(Math.abs(wrapAngle(angle + area))).toBeLessThan(1e-9);
      }
    }
  });

  it('a lap the other way rotates the frame the other way', () => {
    const { side, interior } = regularPolygon(5, 1);
    const area = 3 * Math.PI - 5 * interior;
    // Clockwise: turn right at each vertex.
    let p = identity();
    let heading = 0;
    for (let k = 0; k < 5; k++) {
      p = mul(p, translation(side * Math.cos(heading), side * Math.sin(heading)));
      heading -= Math.PI - interior;
    }
    expect(Math.abs(wrapAngle(decompose(p).angle - area))).toBeLessThan(1e-9);
  });

  it('a tiny loop has almost no holonomy (space is nearly flat up close)', () => {
    const { side, interior } = regularPolygon(4, 1e-3);
    const { angle } = decompose(walkRegularPolygon(4, side, interior));
    // Area of a square of circumradius 1e-3 is ~2e-6.
    expect(Math.abs(angle)).toBeLessThan(3e-6);
  });
});
