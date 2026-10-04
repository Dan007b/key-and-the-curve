import { describe, expect, it } from 'vitest';
import { Marble, DEFAULT_MARBLE } from '../src/game/marble';
import type { Collider } from '../src/game/marble';
import { ORIGIN, distance, lorentzError, minkowski } from '../src/math/lorentz';
import { distanceToSegment } from '../src/math/geodesic';
import { tilingFor } from '../src/game/level';
import { POST_RADIUS, WALL_HALF_WIDTH } from '../src/game/world';
import { rng } from './helpers';

const DT = 1 / 240;

describe('marble motion', () => {
  it('rolls along a geodesic when left alone (parallel transport, no explicit rotation)', () => {
    const m = new Marble({ ...DEFAULT_MARBLE, damping: 0 });
    m.vel = [1, 0];
    for (let i = 0; i < 480; i++) m.step(DT, 0, 0, []);
    const p = m.position();
    // Still on the x-axis geodesic (normal (0,1,0)), 2 units out, same speed.
    expect(minkowski(p, [0, 1, 0])).toBeCloseTo(0, 12);
    expect(distance(ORIGIN, p)).toBeCloseTo(2, 10);
    expect(m.speed()).toBeCloseTo(1, 12);
    expect(lorentzError(m.frame)).toBeLessThan(1e-12);
  });

  it('slows down as exp(−k t)', () => {
    const m = new Marble({ ...DEFAULT_MARBLE, damping: 0.9 });
    m.vel = [0.5, 0.5];
    for (let i = 0; i < 240; i++) m.step(DT, 0, 0, []);
    expect(m.speed()).toBeCloseTo(Math.SQRT1_2 * Math.exp(-0.9), 10);
  });

  it('bounces off a wall with the configured restitution', () => {
    const m = new Marble({ ...DEFAULT_MARBLE, damping: 0, restitution: 0.4 });
    m.vel = [1, 0];
    // A wall across the x-axis at x ≈ 1 (long geodesic segment through (1, ±2)).
    const wall: Collider = { kind: 'segment', a: [Math.sinh(1), -2, Math.sqrt(1 + Math.sinh(1) ** 2 + 4)], b: [Math.sinh(1), 2, Math.sqrt(1 + Math.sinh(1) ** 2 + 4)], radius: 0.035 };
    let impact = 0;
    for (let i = 0; i < 480; i++) impact = Math.max(impact, m.step(DT, 0, 0, [wall]));
    expect(impact).toBeCloseTo(1, 1);
    // Moving back with 40% of the speed (the frame's x still points at the wall).
    expect(m.vel[0]).toBeCloseTo(-0.4, 2);
  });
});

describe('collisions in a closed room', () => {
  it('never lets the marble through a wall or a post', () => {
    const tiling = tilingFor(5, 4);
    const tile = tiling.tiles[0];
    const p = tiling.metrics.p;
    const colliders: Collider[] = [];
    for (let k = 0; k < p; k++) {
      colliders.push({ kind: 'segment', a: tile.vertices[k], b: tile.vertices[(k + 1) % p], radius: WALL_HALF_WIDTH });
      colliders.push({ kind: 'point', p: tile.vertices[k], radius: POST_RADIUS });
    }
    const m = new Marble();
    const rand = rng(5);
    let ax = 0;
    let ay = 0;
    let closest = Infinity;
    for (let i = 0; i < 240 * 30; i++) {
      if (i % 120 === 0) {
        // A new random full-tilt direction every half second.
        const a = rand() * 2 * Math.PI;
        ax = DEFAULT_MARBLE.accel * Math.cos(a);
        ay = DEFAULT_MARBLE.accel * Math.sin(a);
      }
      m.step(DT, ax, ay, colliders);
      const pos = m.position();
      for (const n of tile.inwardNormals) expect(minkowski(pos, n)).toBeGreaterThan(0);
      for (let k = 0; k < p; k++) {
        closest = Math.min(closest, distanceToSegment(pos, tile.vertices[k], tile.vertices[(k + 1) % p]) - WALL_HALF_WIDTH);
      }
    }
    // The marble touches walls (it was thrown at them for 30 s) but never sinks in by more than a hair.
    expect(closest).toBeGreaterThan(DEFAULT_MARBLE.radius - 0.01);
    expect(closest).toBeLessThan(DEFAULT_MARBLE.radius + 0.01);
  });
});
