// Test helpers built on the game's autopilot: drive a route, phase, idle,
// and a simple solver-bot that plays a whole level.

import type { Game } from '../src/game/game';
import type { InputSource } from '../src/input/InputSource';
import { Autopilot, shortestRoute, waypoints } from '../src/game/autopilot';
import { LAYERS, mod } from '../src/game/phase';
import type { Vec3 } from '../src/math/lorentz';
import type { SolverStep } from '../src/game/solver';

export { shortestRoute, waypoints };

/**
 * Drives the marble through the waypoints. Returns the simulated seconds used,
 * or Infinity if it got stuck (more than `perPointLimit` s per waypoint).
 */
export function drive(game: Game, points: Vec3[], perPointLimit = 8): number {
  const pilot = new Autopilot(game, points);
  let elapsed = 0;
  const dt = 1 / 60;
  while (!pilot.done()) {
    game.update(dt, pilot);
    pilot.update();
    elapsed += dt;
    if (game.status === 'won') return elapsed;
    if (elapsed > perPointLimit * points.length || game.status === 'lost') return Infinity;
  }
  return elapsed;
}

/** Waypoints through a room route that may revisit rooms (e.g. pillar loops). */
export function routeWaypoints(game: Game, rooms: number[]): Vec3[] {
  return waypoints(game, rooms);
}

const quiet = (steps: () => number): InputSource => ({
  tilt: () => ({ x: 0, y: 0 }),
  phaseSteps: steps,
  phaseRate: () => 0,
  status: () => ({ label: 'bot', connected: true }),
});

/** Lets the simulation run with no input for `seconds`. */
export function idle(game: Game, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) game.update(1 / 60, quiet(() => 0));
}

/** Steps the phase until the marble is in `layer` (shortest way round), then lets it settle. */
export function phaseTo(game: Game, layer: number): void {
  let diff = mod(layer - game.layer, LAYERS);
  if (diff > LAYERS / 2) diff -= LAYERS;
  let pending = diff;
  game.update(1 / 60, quiet(() => {
    const n = pending;
    pending = 0;
    return n;
  }));
  idle(game, 0.4);
}

/**
 * Plays a level with twisting allowed: visits every shard (nearest first),
 * then the exit, phasing to each door's colour before going through it and
 * to each shard's colour on arrival. Ignores hunters (use levels without
 * them, or accept the risk).
 */
export function playLevel(game: Game): boolean {
  const { tiling, world } = game.level;
  const targets = [...game.level.spec.shards.map((s) => s.tile)];
  while (game.status === 'playing') {
    const remaining = game.shards.filter((s) => !s.collected).map((s) => s.spec);
    const next = remaining.length > 0
      ? remaining.sort((a, b) => shortestRoute(game, game.room, a.tile).length - shortestRoute(game, game.room, b.tile).length)[0]
      : null;
    const goal = next ? next.tile : game.level.spec.exit;
    const route = shortestRoute(game, game.room, goal);
    for (let i = 0; i + 1 < route.length; i++) {
      const id = world.wallOn(route[i], tiling.tiles[route[i]].neighbors.indexOf(route[i + 1]));
      if (id !== -1 && world.walls[id].door !== -1) phaseTo(game, world.walls[id].door);
      if (drive(game, routeWaypoints(game, [route[i], route[i + 1]])) === Infinity) return false;
    }
    if (next) {
      phaseTo(game, next.layer);
      if (drive(game, [tiling.tiles[next.tile].center]) === Infinity) return false;
      idle(game, 0.2);
    } else {
      idle(game, 1);
      return (game.status as string) === 'won';
    }
    if (targets.length > 50) return false;
  }
  return game.status === 'won';
}

/**
 * Turns the 4D view towards rift `wall`'s plank with look input (as the
 * keyboard would, at most full speed), until the rift is bridged. Returns
 * false if it doesn't bridge within `limit` seconds.
 */
export function bridgeRift(game: Game, wall: number, limit = 8): boolean {
  const target = game.level.world.walls[wall].rift!;
  const input: InputSource = {
    tilt: () => ({ x: 0, y: 0 }),
    phaseSteps: () => 0,
    phaseRate: () => 0,
    look: () => {
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));
      return { x: clamp((target[0] - game.look[0]) / 8), y: clamp((target[1] - game.look[1]) / 8) };
    },
    status: () => ({ label: 'bot', connected: true }),
  };
  for (let t = 0; t < limit && !game.bridged.has(wall); t += 1 / 60) game.update(1 / 60, input);
  return game.bridged.has(wall);
}

/**
 * Plays a solver solution with the real physics: rolls room to room through
 * each shared edge's midpoint (bridging any rift on the way first), and on a
 * twist step phases, then re-centres in the room (shards are picked up near
 * the centre). True if the level is won.
 */
export function followSolution(game: Game, steps: SolverStep[]): boolean {
  const { tiles } = game.level.tiling;
  for (const step of steps) {
    if ('twistTo' in step) {
      phaseTo(game, step.twistTo);
      if (game.layer !== step.twistTo) return false;
      if (drive(game, [tiles[game.room].center]) === Infinity) return false;
    } else {
      const id = game.level.world.wallOn(game.room, tiles[game.room].neighbors.indexOf(step.room));
      if (id !== -1 && game.level.world.walls[id].rift && !game.bridged.has(id) && !bridgeRift(game, id)) return false;
      if (drive(game, routeWaypoints(game, [game.room, step.room])) === Infinity) return false;
      if (game.status === 'won') return true;
      if (game.room !== step.room) return false;
    }
  }
  idle(game, 1);
  return game.status === 'won';
}
