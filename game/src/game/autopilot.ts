/**
 * An autopilot that steers the marble through a list of rooms using only
 * tilt, the same input a player has. Used by the tests (to prove each level
 * is physically completable) and by the in-game demo.
 */

import type { Game } from './game';
import type { InputSource, InputStatus } from '../input/InputSource';
import { passageKey } from './maze';
import { apply, distance, logOrigin, lorentzInverse } from '../math/lorentz';
import type { Vec3 } from '../math/lorentz';

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
export function waypoints(game: Game, route: readonly number[]): Vec3[] {
  const { tiles } = game.level.tiling;
  const pts: Vec3[] = [];
  for (let i = 0; i + 1 < route.length; i++) {
    const k = tiles[route[i]].neighbors.indexOf(route[i + 1]);
    pts.push(tiles[route[i]].midpoints[k], tiles[route[i + 1]].center);
  }
  return pts;
}

/**
 * Tilt input that heads for each waypoint in turn: a proportional pull
 * towards the target in screen coordinates, minus a velocity term so it
 * doesn't overshoot. Phase steps can be queued for scripted phasing.
 */
export class Autopilot implements InputSource {
  private index = 0;
  /** Phase steps to send on the next read. */
  steps = 0;

  constructor(private readonly game: Game, private points: Vec3[] = []) {}

  setPoints(points: Vec3[]): void {
    this.points = points;
    this.index = 0;
  }

  done(): boolean {
    return this.index >= this.points.length;
  }

  /** Advances to the next waypoint once the marble is close to the current one. */
  update(): void {
    while (!this.done() && distance(this.game.marble.position(), this.points[this.index]) < 0.12) this.index++;
  }

  tilt(): { x: number; y: number } {
    if (this.done()) return { x: 0, y: 0 };
    const toScreen = lorentzInverse(this.game.viewFrame());
    const [ux, uy] = logOrigin(apply(toScreen, this.points[this.index]));
    const m = this.game.marble;
    const v = apply(toScreen, apply(m.frame, [m.vel[0], m.vel[1], 0]));
    let tx = 3 * ux - 1.5 * v[0];
    let ty = 3 * uy - 1.5 * v[1];
    const len = Math.hypot(tx, ty);
    if (len > 1) {
      tx /= len;
      ty /= len;
    }
    return { x: tx, y: ty };
  }

  phaseSteps(): number {
    const n = this.steps;
    this.steps = 0;
    return n;
  }

  phaseRate(): number {
    return 0;
  }

  status(): InputStatus {
    return { label: 'Autopilot', connected: true };
  }
}
