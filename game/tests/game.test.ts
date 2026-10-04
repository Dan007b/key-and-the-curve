import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { LEVELS, loadLevel } from '../src/game/level';
import { roomDistances } from '../src/game/maze';
import type { InputSource } from '../src/input/InputSource';
import { decompose, lorentzInverse, mul } from '../src/math/lorentz';
import { drive, shortestRoute, waypoints } from './bot';

/** A scripted input: constant tilt, no buttons. */
function fakeInput(x: number, y: number): InputSource {
  return {
    tilt: () => ({ x, y }),
    angularVelocity: () => [0, 0, 0],
    twistToggled: () => false,
    resetKey: () => false,
    status: () => ({ label: 'test', connected: true }),
  };
}

describe('levels', () => {
  it('all load, with a reachable goal', () => {
    for (const spec of LEVELS) {
      const level = loadLevel(spec);
      expect(roomDistances(level.tiling, level.maze, spec.start).has(spec.goal)).toBe(true);
    }
  });
});

describe('game loop', () => {
  it('keeps the view frame on the marble and follows it between rooms', () => {
    const game = new Game();
    game.load(LEVELS[0]);
    const rooms = new Set<number>();
    // Level 1's start room opens downward (edge 3 of tile 0).
    for (let i = 0; i < 120; i++) {
      game.update(1 / 60, fakeInput(0, -1));
      rooms.add(game.room);
      const v = game.viewFrame();
      const m = game.marble.frame;
      // Same position: V⁻¹·M is a pure rotation about O.
      const rel = decompose(mul(lorentzInverse(v), m));
      expect(Math.hypot(rel.position[0], rel.position[1])).toBeLessThan(1e-9);
    }
    expect(rooms.has(0)).toBe(true);
    expect(rooms.size).toBeGreaterThan(1);
  });

  it('level 1 can be rolled from start to goal using tilt alone', () => {
    const game = new Game();
    game.load(LEVELS[0]);
    const route = shortestRoute(game, LEVELS[0].start, LEVELS[0].goal);
    const seconds = drive(game, waypoints(game, route));
    expect(seconds).toBeLessThan(60);
    // Settle in the goal room.
    for (let i = 0; i < 60 && !game.completed; i++) game.update(1 / 60, fakeInput(0, 0));
    expect(game.completed).toBe(true);
  });

  it('measures zero holonomy along the maze tree', () => {
    const game = new Game();
    game.load(LEVELS[0]);
    for (let i = 0; i < 300; i++) {
      game.update(1 / 60, fakeInput(Math.sin(i / 20), -1));
      // Level 1 has no loops, so the key can never be turned by curvature.
      expect(Math.abs(game.holonomy())).toBeLessThan(1e-9);
    }
  });
});
