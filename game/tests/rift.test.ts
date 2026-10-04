// Rifts: passages bridged by turning your 4D view until a 4D plank lies flat.

import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { LEVELS, loadLevel } from '../src/game/level';
import type { LevelSpec } from '../src/game/level';
import { solveLevel } from '../src/game/solver';
import { passageKey } from '../src/game/maze';
import type { Mat3 } from '../src/math/lorentz';
import type { InputSource } from '../src/input/InputSource';
import { bridgeRift, drive, idle, routeWaypoints } from './bot';

// Level 1 with a rift on every way out of the start room; the first one's plank lies flat at [40, -30].
const slip = LEVELS.find((l) => l.name === 'Slip')!;
const exits = (() => {
  const { tiling, maze } = loadLevel(slip);
  return tiling.tiles[0].neighbors.flatMap((n, edge) => (n !== -1 && maze.open.has(passageKey(0, n)) ? [edge] : []));
})();
const targets = [[40, -30], [-30, 20], [15, 50], [-50, -45], [55, 10]];
const spec: LevelSpec = { ...slip, rifts: exits.map((edge, i) => ({ tile: 0, edge, xw: targets[i][0], yw: targets[i][1] })) };

function setup(): { game: Game; wall: number; beyond: number } {
  const game = new Game();
  game.load(spec);
  const beyond = game.level.tiling.tiles[0].neighbors[exits[0]];
  return { game, wall: game.level.world.wallOn(0, exits[0]), beyond };
}

const looking = (x: number, y: number): InputSource => ({
  tilt: () => ({ x: 0, y: 0 }),
  phaseSteps: () => 0,
  phaseRate: () => 0,
  look: () => ({ x, y }),
  status: () => ({ label: 'test', connected: true }),
});

describe('rifts', () => {
  it('block the marble and hunters until bridged', () => {
    const { game, wall, beyond } = setup();
    expect(game.level.world.walls[wall].rift).toEqual([40, -30]);
    expect(game.passable(0, beyond, game.layer)).toBe(false);
    expect(drive(game, routeWaypoints(game, [0, beyond]), 3)).toBe(Infinity);
    expect(game.room).toBe(0);
  });

  it('bridge once you turn your 4D view to the plank, and then let you through', () => {
    const { game, wall, beyond } = setup();
    expect(bridgeRift(game, wall)).toBe(true);
    expect(game.bridgeEvents).toContain(wall);
    expect(Math.abs(game.look[0] - 40)).toBeLessThan(5);
    expect(Math.abs(game.look[1] + 30)).toBeLessThan(7);
    expect(game.passable(0, beyond, game.layer)).toBe(true);
    expect(drive(game, routeWaypoints(game, [0, beyond]))).toBeLessThan(10);
    expect(game.room).toBe(beyond);
  });

  it('turning the view moves the plank: the smear falls as you approach its angles', () => {
    const { game, wall } = setup();
    idle(game, 0.1);
    const s0 = game.riftSmear(wall);
    for (let frame = 0; frame < 24; frame++) game.update(1 / 60, looking(1, -1));
    expect(game.look[0]).toBeCloseTo(24, 6); // 60°/s for 24 frames
    expect(game.look[1]).toBeCloseTo(-24, 6);
    expect(game.riftSmear(wall)).toBeLessThan(s0);
    expect(game.bridged.has(wall)).toBe(false);
  });

  it('ease onto the plank when you get close and let go', () => {
    const { game, wall } = setup();
    game.look = [37, -26];
    idle(game, 1.5);
    expect(game.bridged.has(wall)).toBe(true);
  });

  it('stay shut if you are far away, however you look', () => {
    const { game, wall } = setup();
    // Put the marble in a room two or more steps from the start room.
    const { tiling, maze, references } = game.level;
    const far = maze.rooms.find((r) => r !== 0 && !tiling.tiles[0].neighbors.includes(r))!;
    game.marble.frame = [...references[far]!] as Mat3;
    game.carry = [...references[far]!] as Mat3;
    game.room = far;
    game.rebuildColliders();
    game.look = [40, -30];
    expect(game.riftSmear(wall)).toBeLessThan(1e-9);
    idle(game, 0.5);
    expect(game.riftFocus).toBeNull();
    expect(game.bridged.has(wall)).toBe(false);
  });

  it('count as open for the solver, and can be required', () => {
    const level = loadLevel(spec);
    expect(solveLevel(level)).toBeGreaterThan(0);
    expect(solveLevel(level, { riftsClosed: true })).toBe(-1);
  });
});
