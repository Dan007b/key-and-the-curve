// Phase Escape: the rules (doors, shards, hunters, lives, curvature phasing),
// level solvability, and autopilot playthroughs with the real physics.

import { describe, expect, it } from 'vitest';
import { Game, LIVES } from '../src/game/game';
import { LEVELS, levelNamed, loadLevel } from '../src/game/level';
import type { LevelSpec } from '../src/game/level';
import { passageKey } from '../src/game/maze';
import { solveLevel, solveLevelPath } from '../src/game/solver';
import { LAYERS, dialAngles, dialSectorAngle, holonomySteps, layerOf, mod } from '../src/game/phase';
import { scheduledLayer } from '../src/game/hunter';
import { makeRng } from '../src/game/random';
import { drive, followSolution, idle, phaseTo, playLevel, routeWaypoints } from './bot';

const STEP = (72 * Math.PI) / 180;

describe('phase layers', () => {
  it('the dial needle always points at your layer (wheel = curvature, needle = twist)', () => {
    for (let steps = -7; steps <= 7; steps++) {
      for (let twist = -400; twist <= 400; twist += 7) {
        if (Math.abs(mod(twist, 72) - 36) < 1) continue; // exactly between two layers: either is right
        const { needle, wheel } = dialAngles(twist, steps);
        // The sector whose centre (after the wheel turns) is nearest the needle.
        let best = -1;
        let bestGap = Infinity;
        for (let i = 0; i < LAYERS; i++) {
          const gap = Math.abs(mod(dialSectorAngle(i) + wheel - needle + 180, 360) - 180);
          if (gap < bestGap) [best, bestGap] = [i, gap];
        }
        expect(best, `twist ${twist}, steps ${steps}`).toBe(layerOf(twist, steps));
      }
    }
  });

  it('combine twist and curvature, wrapping around five layers', () => {
    expect(layerOf(0, 0)).toBe(0);
    expect(layerOf(72, 0)).toBe(1);
    expect(layerOf(30, 0)).toBe(0); // rounds to the nearest layer
    expect(layerOf(0, -1)).toBe(4); // one counter-clockwise lap: red → violet
    expect(layerOf(5 * 72, 0)).toBe(0); // a full turn
    expect(holonomySteps(-STEP)).toBe(-1);
  });
});

/** Whether a level can be finished (ignoring hunters), optionally using only some passages. */
function solvable(spec: LevelSpec, passable?: Set<number>): boolean {
  return solveLevel(loadLevel(spec), { passable }) !== -1;
}

describe('levels', () => {
  it('every level is solvable', () => {
    for (const spec of LEVELS) expect(solvable(spec), spec.name).toBe(true);
  });

  it('level 3 (no twisting) needs loops around the pillar', () => {
    const spec = levelNamed('Curvature');
    expect(spec.twist).toBe(false);
    expect(solvable(spec, loadLevel(spec).maze.tree)).toBe(false);
  });

  it('every level that jams twisting needs loops, and every level needs its doors and its rifts', () => {
    for (const spec of LEVELS) {
      const level = loadLevel(spec);
      if (spec.twist === false) expect(solvable(spec, level.maze.tree), spec.name).toBe(false);
      if (spec.doors.length > 0) expect(solveLevel(level, { doorsSolid: true }), spec.name).toBe(-1);
      if ((spec.rifts ?? []).length > 0) expect(solveLevel(level, { riftsClosed: true }), spec.name).toBe(-1);
    }
  });

  it('every level has something in the way: a door or a rift', () => {
    for (const spec of LEVELS) expect(spec.doors.length + (spec.rifts ?? []).length, spec.name).toBeGreaterThan(0);
  });
});

describe('rules', () => {
  it('a door blocks you unless you are in its colour', () => {
    const game = new Game();
    game.load(levelNamed('Slip'));
    const door = levelNamed('Slip').doors[0];
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
    game.load(levelNamed('Hunted'));
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
    game.load(levelNamed('Hunted'));
    const hunter = game.hunters[0];
    phaseTo(game, hunter.layer);
    const d0 = hunter.position[2];
    idle(game, 4);
    // Closer to the marble (at the start room, near the origin: z = cosh(distance)).
    expect(hunter.chasing || game.lives < LIVES).toBe(true);
    expect(hunter.position[2]).toBeLessThan(d0);
  });

  it('hunters survive you phasing in and out of their layer mid-chase (regression: stale patrol target)', () => {
    const rand = makeRng(7);
    for (const spec of LEVELS.filter((l) => l.hunters.length > 0)) {
      for (let run = 0; run < 2; run++) {
        const game = new Game();
        game.load(spec);
        for (let k = 0; k < 15; k++) {
          phaseTo(game, Math.floor(rand() * LAYERS));
          idle(game, 0.3 + rand() * 2.5);
          game.lives = LIVES; // keep playing
        }
      }
    }
  }, 60_000);

  it('looping a pillar shifts you one layer (level 3)', () => {
    const game = new Game();
    game.load(levelNamed('Curvature'));
    expect(game.layer).toBe(0);
    drive(game, routeWaypoints(game, [0, 4, 18, 5, 0])); // counter-clockwise lap
    expect(game.layer).toBe(4); // red → violet
    expect(game.phaseEvents.some((e) => e.cause === 'curvature')).toBe(true);
    expect(game.loopEvents.map((l) => l.degrees)).toContain(-72);
  });
});

describe('shifting hunters', () => {
  it('follow a fixed timetable round the five layers, either way', () => {
    expect(scheduledLayer(2, null, 100)).toBe(2);
    expect(scheduledLayer(2, { every: 8, step: 1 }, 7.9)).toBe(2);
    expect(scheduledLayer(2, { every: 8, step: 1 }, 8)).toBe(3);
    expect(scheduledLayer(2, { every: 8, step: 1 }, 8 * 4)).toBe(1); // 2 → 3 → 4 → 0 → 1
    expect(scheduledLayer(1, { every: 7, step: -1 }, 7 * 2)).toBe(4); // 1 → 0 → 4
  });

  it('change layer in the game, warn first, and only hit you in the layer they are in now', () => {
    const game = new Game();
    const spec = LEVELS.find((l) => l.hunters.some((h) => h.shiftEvery))!;
    game.load(spec);
    const shifter = game.hunters.find((h) => h.shift)!;
    const every = shifter.shift!.every;
    const start = shifter.layer;
    // Stay out of every hunter's way: park all of them at their spawns each frame.
    const hold = () => game.hunters.forEach((h) => h.respawn());
    for (let t = 0; t < every - 1; t += 1 / 60) {
      game.update(1 / 60, { tilt: () => ({ x: 0, y: 0 }), phaseSteps: () => 0, phaseRate: () => 0, status: () => ({ label: 'bot', connected: true }) });
      hold();
    }
    expect(shifter.layer).toBe(start);
    expect(shifter.aboutToShift()).toBe(true);
    expect(shifter.nextLayer).toBe((start + shifter.shift!.step + LAYERS) % LAYERS);
    idle(game, 1.1);
    expect(shifter.layer).toBe(shifter.nextLayer === start ? start : (start + shifter.shift!.step + LAYERS) % LAYERS);
    expect(game.shiftEvents.some((e) => e.to === shifter.layer)).toBe(true);
    // In its old layer it is a ghost; in its new one it hits.
    const now = shifter.layer;
    hold();
    phaseTo(game, start);
    shifter.position = game.marble.position();
    shifter.room = game.room;
    idle(game, 0.05);
    expect(game.lives).toBe(LIVES);
    phaseTo(game, now);
    shifter.position = game.marble.position();
    shifter.room = game.room;
    idle(game, 0.05);
    expect(game.lives).toBe(LIVES - 1);
  });
});

describe('autopilot playthroughs (real physics)', () => {
  it('every level, following the solver, hunters removed', () => {
    for (const spec of LEVELS) {
      const calm = { ...spec, hunters: [] };
      const steps = solveLevelPath(loadLevel(calm))!;
      const game = new Game();
      game.load(calm);
      expect(followSolution(game, steps), spec.name).toBe(true);
    }
  });

  it('level 1: collect both shards through coloured doors, then the portal', () => {
    const game = new Game();
    game.load(levelNamed('Slip'));
    expect(playLevel(game)).toBe(true);
    expect(game.status).toBe('won');
  });

  it('level 3: curvature only: red shard, a counter-clockwise lap to violet, two clockwise laps to gold, out', () => {
    const game = new Game();
    game.load(levelNamed('Curvature'));
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
