// Every level is solvable as designed, and the puzzles need what they claim
// to need. Two checks: a fast state-space solver over (room, holonomy step,
// open gates), and autopilot playthroughs with the real physics and gate code.

import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { LEVELS, loadLevel } from '../src/game/level';
import type { LevelSpec } from '../src/game/level';
import { passageKey } from '../src/game/maze';
import { angleBetween, carryAcross } from '../src/game/transport';
import { drive, idle, routeWaypoints, shortestRoute, twist } from './bot';

const STEP = (72 * Math.PI) / 180;

/**
 * Breadth-first search over (room, holonomy in 72° steps mod 5, opened gates).
 * A gate opens when the player is on its side with holonomy equal to the XY
 * part of its target, and, if the target has 4D (W-plane) parts, twisting is
 * allowed. `passable` restricts which passages may be used.
 */
function solve(spec: LevelSpec, passable?: Set<number>): boolean {
  const level = loadLevel(spec);
  const { tiling, maze, references } = level;
  const gates = spec.gates ?? [];
  const xySteps = gates.map((g) => {
    const deg = g.target.filter(([p]) => p === 'xy').reduce((s, [, a]) => s + a, 0);
    return (((Math.round(deg / 72) % 5) + 5) % 5);
  });
  const needsTwist = gates.map((g) => g.target.some(([p]) => p !== 'xy'));
  const twistOk = spec.twist !== false;
  const allowed = passable ?? maze.open;
  // Holonomy change (in 72° steps) when crossing each open passage.
  const jump = (a: number, b: number) => Math.round(angleBetween(references[b]!, carryAcross(tiling, references[a]!, a, b)) / STEP);
  const gateOn = (a: number, b: number) =>
    gates.findIndex((g) => (g.tile === a && tiling.tiles[a].neighbors[g.edge] === b) || (g.tile === b && tiling.tiles[b].neighbors[g.edge] === a));

  const key = (room: number, h: number, mask: number) => `${room}|${h}|${mask}`;
  const seen = new Set([key(spec.start, 0, 0)]);
  const queue: [number, number, number][] = [[spec.start, 0, 0]];
  while (queue.length) {
    const [room, h, mask] = queue.shift()!;
    if (room === spec.goal) return true;
    let m = mask;
    gates.forEach((g, i) => {
      if (g.tile === room && h === xySteps[i] && (!needsTwist[i] || twistOk)) m |= 1 << i;
    });
    for (const n of tiling.tiles[room].neighbors) {
      if (n === -1 || !maze.isRoom[n] || !allowed.has(passageKey(room, n))) continue;
      const gi = gateOn(room, n);
      if (gi !== -1 && !(m & (1 << gi))) continue;
      const h2 = (((h + jump(room, n)) % 5) + 5) % 5;
      const k = key(n, h2, m);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push([n, h2, m]);
      }
    }
  }
  return false;
}

describe('level design', () => {
  it('every level is solvable', () => {
    for (const spec of LEVELS) expect(solve(spec), spec.name).toBe(true);
  });

  it('level 3 cannot be solved without looping (direct routes only)', () => {
    const spec = LEVELS[2];
    expect(spec.twist).toBe(false);
    expect(solve(spec, loadLevel(spec).maze.tree)).toBe(false);
  });

  it('level 4 cannot be solved on the direct routes either', () => {
    const spec = LEVELS[3];
    expect(solve(spec, loadLevel(spec).maze.tree)).toBe(false);
  });
});

describe('autopilot playthroughs (real physics and gates)', () => {
  const finish = (game: Game) => {
    const route = shortestRoute(game, game.room, game.level.spec.goal);
    expect(drive(game, routeWaypoints(game, route))).toBeLessThan(120);
    idle(game, 1.5);
    expect(game.completed).toBe(true);
  };

  it('level 2: roll to the gate, twist XW 90°, roll on', () => {
    const game = new Game();
    game.load(LEVELS[1]);
    expect(drive(game, routeWaypoints(game, [0, 4]))).toBeLessThan(30);
    expect(game.gates[0].open).toBe(false);
    twist(game, [Math.PI / 2, 0, 0], 1);
    idle(game, 0.5);
    expect(game.gates[0].open).toBe(true);
    finish(game);
  });

  it('level 3: one counter-clockwise lap around the pillar opens the gate', () => {
    const game = new Game();
    game.load(LEVELS[2]);
    // The direct route arrives with no curvature turn: the gate stays shut.
    expect(drive(game, routeWaypoints(game, [0, 4, 18, 5]))).toBeLessThan(40);
    expect(Math.abs(game.holonomy())).toBeLessThan(1e-9);
    expect(game.gates[0].open).toBe(false);
    // Back to the start and round the pillar counter-clockwise: 5 → 0 → 4 → 18 → 5.
    expect(drive(game, routeWaypoints(game, [5, 0, 4, 18, 5]))).toBeLessThan(40);
    expect((game.holonomy() * 180) / Math.PI).toBeCloseTo(-72, 9);
    idle(game, 0.5);
    expect(game.gates[0].open).toBe(true);
    finish(game);
  });

  it('level 4: twist YW 90° and loop clockwise, then the gate opens', () => {
    const game = new Game();
    game.load(LEVELS[3]);
    twist(game, [0, Math.PI / 2, 0], 1);
    // Clockwise lap around the pillar between rooms 4, 16, 45 and 14.
    expect(drive(game, routeWaypoints(game, [0, 4, 16, 45, 14, 4]))).toBeLessThan(60);
    expect((game.holonomy() * 180) / Math.PI).toBeCloseTo(72, 9);
    expect(drive(game, routeWaypoints(game, [4, 16, 45, 14, 43]))).toBeLessThan(60);
    idle(game, 0.5);
    expect(game.gates[0].open).toBe(true);
    finish(game);
  });
});
