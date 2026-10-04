// Test helpers built on the game's autopilot: drive a route, twist, idle.

import type { Game } from '../src/game/game';
import type { InputSource } from '../src/input/InputSource';
import { Autopilot, shortestRoute, waypoints } from '../src/game/autopilot';
import type { Vec3 } from '../src/math/lorentz';

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
    if (elapsed > perPointLimit * points.length) return Infinity;
  }
  return elapsed;
}

/** Waypoints through a room route that may revisit rooms (e.g. pillar loops). */
export function routeWaypoints(game: Game, rooms: number[]): Vec3[] {
  return waypoints(game, rooms);
}

const quiet = (rates: [number, number, number], toggle: () => boolean): InputSource => ({
  tilt: () => ({ x: 0, y: 0 }),
  angularVelocity: () => rates,
  twistToggled: toggle,
  resetKey: () => false,
  status: () => ({ label: 'bot', connected: true }),
});

/** Enters twist mode, twists at the given XW/YW/ZW rates for `seconds`, and leaves twist mode. */
export function twist(game: Game, rates: [number, number, number], seconds: number): void {
  let toggle = true;
  const take = () => {
    const t = toggle;
    toggle = false;
    return t;
  };
  const dt = 1 / 60;
  for (let t = 0; t < seconds - 1e-9; t += dt) game.update(dt, quiet(rates, take));
  toggle = true;
  game.update(dt, quiet([0, 0, 0], take));
  if (game.twistMode) throw new Error('bot: failed to leave twist mode');
}

/** Lets the simulation run with no input for `seconds`. */
export function idle(game: Game, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) game.update(1 / 60, quiet([0, 0, 0], () => false));
}
