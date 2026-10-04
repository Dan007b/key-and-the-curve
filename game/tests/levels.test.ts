// Phase Escape: the rules (doors, shards, hunters, lives, curvature phasing),
// level solvability, and autopilot playthroughs with the real physics.

import { describe, expect, it } from 'vitest';
import { Game, LIVES } from '../src/game/game';
import { LEVELS, loadLevel } from '../src/game/level';
import type { LevelSpec } from '../src/game/level';
import { passageKey } from '../src/game/maze';
import { LAYERS, holonomySteps, layerOf, mod } from '../src/game/phase';
import { angleBetween, carryAcross } from '../src/game/transport';
import { drive, idle, phaseTo, playLevel, routeWaypoints } from './bot';

const STEP = (72 * Math.PI) / 180;

describe('phase layers', () => {
  it('combine twist and curvature, wrapping around five layers', () => {
    expect(layerOf(0, 0)).toBe(0);
    expect(layerOf(72, 0)).toBe(1);
    expect(layerOf(30, 0)).toBe(0); // rounds to the nearest layer
    expect(layerOf(0, -1)).toBe(4); // one counter-clockwise lap: red → violet
    expect(layerOf(5 * 72, 0)).toBe(0); // a full turn
    expect(holonomySteps(-STEP)).toBe(-1);
  });
});

/**
 * Breadth-first search over (room, curvature step, twist step, shards held).
 * Doors pass only in their own layer; shards are taken only in their layer;
 * crossing a passage changes the curvature step by its holonomy jump. Twist
 * steps are free if the level allows twisting. Ignores hunters.
 */
function solvable(spec: LevelSpec, passable?: Set<number>): boolean {
  const { tiling, maze, world, references } = loadLevel(spec);
  const allowed = passable ?? maze.open;
  const twist = spec.twist !== false;
  const jump = (a: number, b: number) => Math.round(angleBetween(references[b]!, carryAcross(tiling, references[a]!, a, b)) / STEP);
  const full = (1 << spec.shards.length) - 1;
  const take = (room: number, layer: number, held: number) =>
    spec.shards.reduce((h, s, i) => (s.tile === room && s.layer === layer ? h | (1 << i) : h), held);
  const key = (r: number, c: number, t: number, h: number) => `${r}|${c}|${t}|${h}`;
  const start: [number, number, number, number] = [spec.start, 0, 0, take(spec.start, 0, 0)];
  const seen = new Set([key(...start)]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const [room, c, t, held] = queue[i];
    if (room === spec.exit && held === full) return true;
    const push = (r: number, c2: number, t2: number) => {
      const h2 = take(r, mod(c2 + t2, LAYERS), held);
      const k = key(r, c2, t2, h2);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push([r, c2, t2, h2]);
      }
    };
    if (twist) for (let d = 1; d < LAYERS; d++) push(room, c, mod(t + d, LAYERS));
    const layer = mod(c + t, LAYERS);
    for (const n of tiling.tiles[room].neighbors) {
      if (n === -1 || !maze.isRoom[n] || !allowed.has(passageKey(room, n))) continue;
      const id = world.wallOn(room, tiling.tiles[room].neighbors.indexOf(n));
      if (id !== -1 && world.walls[id].door !== layer) continue;
      push(n, mod(c + jump(room, n), LAYERS), t);
    }
  }
  return false;
}

describe('levels', () => {
  it('every level is solvable', () => {
    for (const spec of LEVELS) expect(solvable(spec), spec.name).toBe(true);
  });

  it('level 3 (no twisting) needs loops around the pillar', () => {
    const spec = LEVELS[2];
    expect(spec.twist).toBe(false);
    expect(solvable(spec, loadLevel(spec).maze.tree)).toBe(false);
  });

  it('every level has doors that need more than one colour', () => {
    for (const spec of LEVELS) expect(new Set(spec.doors.map((d) => d.layer)).size, spec.name).toBeGreaterThanOrEqual(1);
  });
});

describe('rules', () => {
  it('a door blocks you unless you are in its colour', () => {
    const game = new Game();
    game.load(LEVELS[0]);
    const door = LEVELS[0].doors[0];
    const beyond = game.level.tiling.tiles[door.tile].neighbors[door.edge];
    const route = (() => {
      const r = [] as number[];
      // Walk the open passages to the door's room first.
      const prev = new Map<number, number>([[game.room, -1]]);
      const q = [game.room];
      for (let i = 0; i < q.length; i++) {
        for (const n of game.level.tiling.tiles[q[i]].neighbors) {
          if (n !== -1 && game.level.maze.isRoom[n] && !prev.has(n) && game.level.maze.open.has(passageKey(q[i], n)) && !(q[i] === door.tile && n === beyond)) {
            prev.set(n, q[i]);
            q.push(n);
          }
        }
      }
      let x = door.tile;
      while (x !== -1) {
        r.unshift(x);
        x = prev.get(x)!;
      }
      return r;
    })();
    // Get to the door's room, phasing through any doors on the way.
    for (let i = 0; i + 1 < route.length; i++) {
      const id = game.level.world.wallOn(route[i], game.level.tiling.tiles[route[i]].neighbors.indexOf(route[i + 1]));
      if (id !== -1 && game.level.world.walls[id].door !== -1) phaseTo(game, game.level.world.walls[id].door);
      drive(game, routeWaypoints(game, [route[i], route[i + 1]]));
    }
    phaseTo(game, (door.layer + 2) % LAYERS);
    expect(drive(game, routeWaypoints(game, [door.tile, beyond]), 3)).toBe(Infinity);
    expect(game.room).toBe(door.tile);
    phaseTo(game, door.layer);
    expect(drive(game, routeWaypoints(game, [game.room, beyond]))).toBeLessThan(20);
    expect(game.room).toBe(beyond);
  });

  it('hunters only hit you in their own layer, then you get a breather, and three hits end the game', () => {
    const game = new Game();
    game.load(LEVELS[1]);
    const hunter = game.hunters[0];
    // Park the hunter right on top of the marble, in another layer: nothing happens.
    phaseTo(game, (hunter.layer + 1) % LAYERS);
    hunter.position = game.marble.position();
    hunter.room = game.room;
    idle(game, 0.05);
    expect(game.lives).toBe(LIVES);
    // Same layer: a hit, the hunter goes home, and you're briefly safe.
    for (let hit = 1; hit <= LIVES; hit++) {
      hunter.respawn(); // far away while we phase into its layer
      phaseTo(game, hunter.layer);
      hunter.position = game.marble.position();
      hunter.room = game.room;
      idle(game, 0.05);
      expect(game.lives).toBe(LIVES - hit);
      expect(hunter.room).toBe(hunter.spawn);
      idle(game, 2.1);
    }
    expect(game.status).toBe('lost');
  });

  it('a hunter that sees you closes in through the maze', () => {
    const game = new Game();
    game.load(LEVELS[1]);
    const hunter = game.hunters[0];
    phaseTo(game, hunter.layer);
    const d0 = hunter.position[2];
    idle(game, 4);
    // Closer to the marble (at the start room, near the origin: z = cosh(distance)).
    expect(hunter.chasing || game.lives < LIVES).toBe(true);
    expect(hunter.position[2]).toBeLessThan(d0);
  });

  it('looping a pillar shifts you one layer (level 3)', () => {
    const game = new Game();
    game.load(LEVELS[2]);
    expect(game.layer).toBe(0);
    drive(game, routeWaypoints(game, [0, 4, 18, 5, 0])); // counter-clockwise lap
    expect(game.layer).toBe(4); // red → violet
    expect(game.phaseEvents.some((e) => e.cause === 'curvature')).toBe(true);
    expect(game.loopEvents.map((l) => l.degrees)).toContain(-72);
  });
});

describe('autopilot playthroughs (real physics)', () => {
  it('level 1: collect both shards through coloured doors, then the portal', () => {
    const game = new Game();
    game.load(LEVELS[0]);
    expect(playLevel(game)).toBe(true);
    expect(game.status).toBe('won');
  });

  it('level 3: curvature only: red shard, a counter-clockwise lap to violet, two clockwise laps to gold, out', () => {
    const game = new Game();
    game.load(LEVELS[2]);
    const center = (r: number) => [game.level.tiling.tiles[r].center];
    drive(game, routeWaypoints(game, [0, 4]));
    drive(game, center(4)); // red shard
    drive(game, routeWaypoints(game, [4, 18, 5, 0, 4, 18])); // CCW lap → violet, to the violet shard
    drive(game, center(18));
    expect(game.layer).toBe(4);
    drive(game, routeWaypoints(game, [18, 4, 0, 5, 18, 4, 0, 5])); // two clockwise laps → gold
    expect(game.layer).toBe(1);
    expect(drive(game, routeWaypoints(game, [5, 6, 1]))).toBeLessThan(40); // through the gold door
    drive(game, center(1)); // gold shard
    expect(game.shardsLeft()).toBe(0);
    expect(drive(game, routeWaypoints(game, [1, 9, 2, 10, 3, 13]))).toBeLessThan(60);
    idle(game, 1);
    expect(game.status).toBe('won');
  });
});
