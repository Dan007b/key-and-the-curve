// The discrete holonomy the game is built on: carrying the key's frame from
// room centre to room centre (see src/game/transport.ts).

import { describe, expect, it } from 'vitest';
import { tilingFor } from '../src/game/level';
import { angleBetween, carryAcross, referenceFrames } from '../src/game/transport';
import { generateMaze, passageKey } from '../src/game/maze';
import { distance, lorentzError } from '../src/math/lorentz';
import { toKlein } from '../src/math/poincare';
import { maxDiff, rng } from './helpers';

const tiling = tilingFor(5, 4);
const { tiles } = tiling;
const DEG = Math.PI / 180;

/** Carries tile `loop[0]`'s canonical frame along a closed room path; returns the holonomy angle. */
function loopHolonomy(loop: number[]): number {
  const start = tiles[loop[0]].frame;
  let f = start;
  for (let i = 1; i < loop.length; i++) f = carryAcross(tiling, f, loop[i - 1], loop[i]);
  expect(maxDiff([f[2], f[5], f[8]], [start[2], start[5], start[8]])).toBeLessThan(1e-9);
  return angleBetween(start, f);
}

/** Signed area of the room-centre polygon in the Klein disk (> 0 = counter-clockwise). */
function orientation(loop: number[]): number {
  let a = 0;
  for (let i = 0; i + 1 < loop.length; i++) {
    const [x1, y1] = toKlein(tiles[loop[i]].center);
    const [x2, y2] = toKlein(tiles[loop[i + 1]].center);
    a += x1 * y2 - x2 * y1;
  }
  return Math.sign(a);
}

/** The four rooms around vertex k of tile t, in cyclic order, as a closed loop. */
function roomsAroundVertex(t: number, k: number): number[] {
  const v = tiles[t].vertices[k];
  const around = tiles.map((_, i) => i).filter((i) => tiles[i].vertices.some((w) => distance(w, v) < 1e-9));
  expect(around).toHaveLength(4);
  const loop = [around[0]];
  while (loop.length < 4) {
    const last = loop[loop.length - 1];
    const next = around.find((i) => !loop.includes(i) && tiles[last].neighbors.includes(i));
    loop.push(next!);
  }
  return [...loop, loop[0]];
}

describe('carrying the key between rooms', () => {
  it('there and back again changes nothing', () => {
    const f = carryAcross(tiling, carryAcross(tiling, tiles[0].frame, 0, 3), 3, 0);
    expect(maxDiff(f, tiles[0].frame)).toBeLessThan(1e-12);
  });

  it('one lap around a pillar turns the key by exactly 72°', () => {
    for (const [t, k] of [[0, 0], [0, 3], [7, 2], [20, 4]]) {
      const loop = roomsAroundVertex(t, k);
      const hol = loopHolonomy(loop);
      // Counter-clockwise laps turn the key clockwise (curvature is negative).
      expect(hol).toBeCloseTo(-orientation(loop) * 72 * DEG, 12);
      expect(loopHolonomy([...loop].reverse())).toBeCloseTo(-hol, 12);
    }
  });

  it('a lap around a whole tile encloses 5 pillars: 5 × 72° = 360°', () => {
    // Around tile 0: alternate edge-neighbours and corner tiles.
    const ring = [1, 6, 5, 18, 4, 14, 3, 10, 2, 9, 1];
    for (let i = 0; i + 1 < ring.length; i++) expect(tiles[ring[i]].neighbors).toContain(ring[i + 1]);
    expect(Math.abs(loopHolonomy(ring))).toBeLessThan(1e-9);
  });

  it('two laps around a pillar make 144°', () => {
    const loop = roomsAroundVertex(0, 1);
    const twice = [...loop, ...loop.slice(1)];
    expect(Math.abs(loopHolonomy(twice))).toBeCloseTo(144 * DEG, 12);
  });

  it('stays exact on a long random walk (frames are snapped)', () => {
    const rand = rng(77);
    let room = 0;
    let f = tiles[0].frame;
    for (let i = 0; i < 5000; i++) {
      const options = tiles[room].neighbors.filter((n) => n !== -1 && tiles[n].depth <= 4);
      const next = options[Math.floor(rand() * options.length)];
      f = carryAcross(tiling, f, room, next);
      room = next;
    }
    expect(lorentzError(f)).toBeLessThan(1e-9);
    // Walk home along any route; the leftover rotation is a whole number of 72° steps.
    while (room !== 0) {
      const next = tiles[room].neighbors.reduce((best, n) => (n !== -1 && tiles[n].depth < tiles[best].depth ? n : best), room);
      f = carryAcross(tiling, f, room, next);
      room = next;
    }
    const steps = angleBetween(tiles[0].frame, f) / (72 * DEG);
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9);
  });
});

describe('reference frames', () => {
  it('agree with carrying along the tree, and differ by 72° steps across loops', () => {
    const maze = generateMaze(tiling, { depth: 3, seed: 3, start: 0, extraOpenings: 3 });
    const refs = referenceFrames(tiling, maze.tree, 0);
    for (const r of maze.rooms) expect(refs[r]).not.toBeNull();
    for (const key of maze.open) {
      const a = Math.floor(key / 1_000_003);
      const b = key % 1_000_003;
      const jump = angleBetween(refs[b]!, carryAcross(tiling, refs[a]!, a, b)) / (72 * DEG);
      expect(Math.abs(jump - Math.round(jump))).toBeLessThan(1e-9);
      if (maze.tree.has(passageKey(a, b))) expect(Math.abs(jump)).toBeLessThan(1e-9);
    }
  });
});
