// An autopilot for tests: steers the marble through a list of rooms using
// only tilt, the same input a player has. Proves levels are physically
// completable (walls and posts never block a passage).

import type { Game } from '../src/game/game';
import type { InputSource } from '../src/input/InputSource';
import { passageKey } from '../src/game/maze';
import { apply, distance, logOrigin, lorentzInverse } from '../src/math/lorentz';
import type { Vec3 } from '../src/math/lorentz';

/** Shortest room route through open passages (gates count as passable). */
export function shortestRoute(game: Game, from: number, to: number): number[] {
  const { tiling, maze } = game.level;
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    for (const n of tiling.tiles[queue[i]].neighbors) {
      if (n !== -1 && maze.isRoom[n] === 1 && !prev.has(n) && maze.open.has(passageKey(queue[i], n))) {
        prev.set(n, queue[i]);
        queue.push(n);
      }
    }
  }
  const route = [to];
  while (prev.get(route[0])! !== -1) route.unshift(prev.get(route[0])!);
  return route;
}

/** Waypoints for a room route: each shared edge's midpoint, then the next room's centre. */
export function waypoints(game: Game, route: number[]): Vec3[] {
  const { tiles } = game.level.tiling;
  const pts: Vec3[] = [];
  for (let i = 0; i + 1 < route.length; i++) {
    const k = tiles[route[i]].neighbors.indexOf(route[i + 1]);
    pts.push(tiles[route[i]].midpoints[k], tiles[route[i + 1]].center);
  }
  return pts;
}

/**
 * Drives the marble to each waypoint in turn. Returns the number of simulated
 * seconds used, or Infinity if it got stuck (`perPointLimit` seconds on one point).
 */
export function drive(game: Game, points: Vec3[], perPointLimit = 8): number {
  let target = 0;
  let elapsed = 0;
  let onPoint = 0;
  const input: InputSource = {
    tilt: () => {
      // Target direction in screen coordinates, minus a velocity term for damping.
      const [ux, uy] = logOrigin(apply(lorentzInverse(game.viewFrame()), points[target]));
      const vScreen = apply(lorentzInverse(game.viewFrame()), apply(game.marble.frame, [game.marble.vel[0], game.marble.vel[1], 0]));
      let tx = 3 * ux - 1.5 * vScreen[0];
      let ty = 3 * uy - 1.5 * vScreen[1];
      const len = Math.hypot(tx, ty);
      if (len > 1) {
        tx /= len;
        ty /= len;
      }
      return { x: tx, y: ty };
    },
    angularVelocity: () => [0, 0, 0],
    twistToggled: () => false,
    resetKey: () => false,
    status: () => ({ label: 'bot', connected: true }),
  };
  const dt = 1 / 60;
  while (target < points.length) {
    game.update(dt, input);
    elapsed += dt;
    onPoint += dt;
    if (distance(game.marble.position(), points[target]) < 0.12) {
      target++;
      onPoint = 0;
    }
    if (onPoint > perPointLimit) return Infinity;
  }
  return elapsed;
}

/** Enters twist mode, twists at the given XW/YW/ZW rates for `seconds`, and leaves twist mode. */
export function twist(game: Game, rates: [number, number, number], seconds: number): void {
  let toggle = true;
  const input: InputSource = {
    tilt: () => ({ x: 0, y: 0 }),
    angularVelocity: () => rates,
    twistToggled: () => {
      const t = toggle;
      toggle = false;
      return t;
    },
    resetKey: () => false,
    status: () => ({ label: 'bot', connected: true }),
  };
  const dt = 1 / 60;
  for (let t = 0; t < seconds - 1e-9; t += dt) game.update(dt, input);
  toggle = true;
  const idle: InputSource = { ...input, angularVelocity: () => [0, 0, 0] };
  game.update(dt, idle);
  if (game.twistMode) throw new Error('bot: failed to leave twist mode');
}

/** Waypoints through a room route that may revisit rooms (e.g. pillar loops). */
export function routeWaypoints(game: Game, rooms: number[]): Vec3[] {
  return waypoints(game, rooms);
}

/** Lets the simulation run with no input for `seconds`. */
export function idle(game: Game, seconds: number): void {
  const input: InputSource = {
    tilt: () => ({ x: 0, y: 0 }),
    angularVelocity: () => [0, 0, 0],
    twistToggled: () => false,
    resetKey: () => false,
    status: () => ({ label: 'bot', connected: true }),
  };
  for (let t = 0; t < seconds; t += 1 / 60) game.update(1 / 60, input);
}
