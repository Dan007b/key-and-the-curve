import { describe, expect, it } from 'vitest';
import {
  ORIGIN,
  apply,
  boostX,
  decompose,
  distance,
  expOrigin,
  identity,
  logOrigin,
  lorentzError,
  lorentzInverse,
  minkowski,
  mul,
  reorthonormalize,
  rotation,
  translation,
  translationTo,
} from '../src/math/lorentz';
import type { Mat3, Vec3 } from '../src/math/lorentz';
import { maxDiff, randomIsometry, randomPoint, rng, wrapAngle } from './helpers';

describe('Lorentz inverse', () => {
  it('J Mᵀ J is the inverse of random isometries', () => {
    const rand = rng(1);
    for (let i = 0; i < 200; i++) {
      const m = randomIsometry(rand);
      expect(maxDiff(mul(m, lorentzInverse(m)), identity())).toBeLessThan(1e-11);
      expect(maxDiff(mul(lorentzInverse(m), m), identity())).toBeLessThan(1e-11);
    }
  });

  it('is safe when out aliases the input', () => {
    const m = randomIsometry(rng(2));
    const expected = lorentzInverse(m);
    expect(lorentzInverse(m, m)).toEqual(expected);
  });
});

describe('isometries preserve the Minkowski product', () => {
  it('boosts preserve ⟨a,b⟩ for arbitrary vectors', () => {
    const rand = rng(3);
    for (let i = 0; i < 200; i++) {
      const b = boostX((rand() - 0.5) * 10);
      const u: Vec3 = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
      const v: Vec3 = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
      const before = minkowski(u, v);
      const after = minkowski(apply(b, u), apply(b, v));
      // Boosts by up to 5 scale entries by cosh 5 ≈ 74, so allow a relative error.
      expect(Math.abs(after - before)).toBeLessThan(1e-12 * 74 * 74);
    }
  });

  it('boosts, rotations, translations and products satisfy MᵀJM = J', () => {
    const rand = rng(4);
    expect(lorentzError(boostX(2.5))).toBeLessThan(1e-13);
    expect(lorentzError(rotation(1.234))).toBeLessThan(1e-15);
    expect(lorentzError(translation(0.3, -1.7))).toBeLessThan(1e-13);
    for (let i = 0; i < 100; i++) {
      expect(lorentzError(randomIsometry(rand))).toBeLessThan(1e-11);
    }
  });

  it('maps the hyperboloid to itself (upper sheet)', () => {
    const rand = rng(5);
    for (let i = 0; i < 100; i++) {
      const q = apply(randomIsometry(rand), randomPoint(rand));
      expect(minkowski(q, q)).toBeCloseTo(-1, 9);
      expect(q[2]).toBeGreaterThan(0);
    }
  });
});

describe('translations', () => {
  it('T(u) equals R(φ)·Bₓ(|u|)·R(−φ)', () => {
    const rand = rng(6);
    for (let i = 0; i < 100; i++) {
      const ux = (rand() - 0.5) * 6;
      const uy = (rand() - 0.5) * 6;
      const phi = Math.atan2(uy, ux);
      const viaBoost = mul(mul(rotation(phi), boostX(Math.hypot(ux, uy))), rotation(-phi));
      expect(maxDiff(translation(ux, uy), viaBoost)).toBeLessThan(1e-12);
    }
  });

  it('T(0) is the identity', () => {
    expect(translation(0, 0)).toEqual(identity());
  });

  it('moves O to exp(u), at distance |u|', () => {
    const rand = rng(7);
    for (let i = 0; i < 100; i++) {
      const ux = (rand() - 0.5) * 6;
      const uy = (rand() - 0.5) * 6;
      const p = apply(translation(ux, uy), ORIGIN);
      expect(maxDiff(p, expOrigin(ux, uy))).toBeLessThan(1e-12);
      expect(distance(ORIGIN, p)).toBeCloseTo(Math.hypot(ux, uy), 12);
    }
  });

  it('translationTo(p) maps O to p', () => {
    const rand = rng(8);
    for (let i = 0; i < 100; i++) {
      const p = randomPoint(rand, 5);
      expect(maxDiff(apply(translationTo(p), ORIGIN), p)).toBeLessThan(1e-12);
    }
  });

  it('logOrigin inverts expOrigin, including tiny vectors', () => {
    for (const [ux, uy] of [[0.3, -0.4], [2, 1], [1e-12, 3e-12], [0, 0]] as const) {
      const [lx, ly] = logOrigin(expOrigin(ux, uy));
      expect(lx).toBeCloseTo(ux, 12);
      expect(ly).toBeCloseTo(uy, 12);
    }
  });
});

describe('distance', () => {
  it('is invariant under isometries', () => {
    const rand = rng(9);
    for (let i = 0; i < 200; i++) {
      const p = randomPoint(rand);
      const q = randomPoint(rand);
      const m = randomIsometry(rand);
      expect(distance(apply(m, p), apply(m, q))).toBeCloseTo(distance(p, q), 9);
    }
  });

  it('is accurate for very small separations', () => {
    // acosh(−⟨p,q⟩) would give ~1e-8 of absolute error here.
    const d = distance(ORIGIN, expOrigin(1e-10, 0));
    expect(Math.abs(d - 1e-10) / 1e-10).toBeLessThan(1e-6);
  });

  it('matches cosh d = −⟨p,q⟩', () => {
    const rand = rng(10);
    for (let i = 0; i < 100; i++) {
      const p = randomPoint(rand);
      const q = randomPoint(rand);
      expect(Math.cosh(distance(p, q))).toBeCloseTo(-minkowski(p, q), 8);
    }
  });
});

describe('reorthonormalize', () => {
  it('fixes a perturbed matrix and barely moves it', () => {
    const rand = rng(11);
    for (let i = 0; i < 100; i++) {
      const m = randomIsometry(rand, 2);
      const noisy = m.map((x) => x + (rand() - 0.5) * 2e-6) as Mat3;
      expect(lorentzError(noisy)).toBeGreaterThan(1e-8);
      const fixed = reorthonormalize(noisy);
      expect(lorentzError(fixed)).toBeLessThan(1e-13);
      expect(maxDiff(fixed, m)).toBeLessThan(1e-4);
    }
  });

  it('leaves an exact isometry essentially unchanged', () => {
    const m = randomIsometry(rng(12), 2);
    expect(maxDiff(reorthonormalize(m), m)).toBeLessThan(1e-13);
  });

  it('keeps the frame position fixed', () => {
    const m = randomIsometry(rng(13), 2);
    const noisy = m.map((x, i) => (i % 3 === 2 ? x : x + 1e-6)) as Mat3;
    const fixed = reorthonormalize(noisy);
    expect(maxDiff([fixed[2], fixed[5], fixed[8]], [m[2], m[5], m[8]])).toBeLessThan(1e-13);
  });

  it('holds drift down over 100k marble-sized steps', () => {
    const rand = rng(14);
    let m = identity();
    for (let i = 0; i < 100_000; i++) {
      m = mul(m, translation((rand() - 0.5) * 0.02, (rand() - 0.5) * 0.02));
      m = reorthonormalize(m, m);
    }
    expect(lorentzError(m)).toBeLessThan(1e-13);
  });
});

describe('decompose', () => {
  it('recovers position and angle of T(p)·R(θ)', () => {
    const rand = rng(15);
    for (let i = 0; i < 100; i++) {
      const p = randomPoint(rand, 4);
      const theta = (rand() - 0.5) * 2 * Math.PI;
      const { position, angle } = decompose(mul(translationTo(p), rotation(theta)));
      expect(maxDiff(position, p)).toBeLessThan(1e-12);
      expect(wrapAngle(angle - theta)).toBeCloseTo(0, 12);
    }
  });
});
