/**
 * Hunters: shadows that live in one layer of the fourth dimension.
 *
 * A hunter moves through the maze like the marble does: it cannot pass solid
 * walls, though as a shadow it drifts through doors. It can only see you while you
 * are in its layer: then it chases, heading for the shared edge of the next
 * room on the shortest route to you, and straight at you once in your room.
 * Otherwise it patrols at random. Rooms are convex, so straight moves to an
 * edge midpoint or to a point in the same room never cross a wall.
 *
 * Shifters change layer on a fixed timetable: every `every` seconds they step
 * `step` layers round the circle. The timetable is a pure function of the
 * game clock, so it is predictable, and for the last SHIFT_WARNING seconds
 * before a shift the hunter flickers towards its next colour as a warning.
 */

import { distance, minkowski } from '../math/lorentz';
import type { Vec3 } from '../math/lorentz';
import { geodesicPoint } from '../math/geodesic';
import { locateTile } from '../math/tiling';
import type { Tiling } from '../math/tiling';
import { LAYERS } from './phase';

export interface HunterGraph {
  tiling: Tiling;
  /** Whether a hunter in `layer` can pass from room a to the adjacent room b. */
  passable(a: number, b: number, layer: number): boolean;
}

/** Hunter radius (hyperbolic units). */
export const HUNTER_RADIUS = 0.16;
/** Patrol speed as a fraction of chase speed. */
const PATROL = 0.55;
/** Seconds of warning before a shifter changes layer. */
export const SHIFT_WARNING = 1.5;

/** A shifter's timetable: every `every` seconds it moves `step` layers (±1 usually). */
export interface ShiftSchedule {
  every: number;
  step: number;
}

/** Layer of a hunter that starts in `base` and follows `shift`, at game time `time`. */
export function scheduledLayer(base: number, shift: ShiftSchedule | null, time: number): number {
  if (!shift) return base;
  const n = Math.floor(time / shift.every);
  return (((base + n * shift.step) % LAYERS) + LAYERS) % LAYERS;
}

export class Hunter {
  position: Vec3;
  room: number;
  chasing = false;
  /** The layer it lives in right now (changes over time for shifters). */
  layer: number;
  /** Seconds until its next layer change (Infinity if it never shifts). */
  shiftIn = Infinity;
  /** The layer it will shift into next (its own layer if it never shifts). */
  nextLayer: number;
  private patrolTarget = -1;

  constructor(
    readonly baseLayer: number,
    readonly spawn: number,
    private readonly graph: HunterGraph,
    private readonly rand: () => number,
    readonly shift: ShiftSchedule | null = null,
  ) {
    this.room = spawn;
    this.position = [...graph.tiling.tiles[spawn].center] as Vec3;
    this.layer = baseLayer;
    this.nextLayer = baseLayer;
    this.setTime(0);
  }

  /** Follows the shift timetable to game time `time`. */
  setTime(time: number): void {
    this.layer = scheduledLayer(this.baseLayer, this.shift, time);
    if (!this.shift) return;
    this.nextLayer = scheduledLayer(this.baseLayer, this.shift, time + this.shift.every);
    this.shiftIn = this.shift.every * (Math.floor(time / this.shift.every) + 1) - time;
  }

  /** Whether it is in the warning window just before a shift. */
  aboutToShift(): boolean {
    return this.shiftIn <= SHIFT_WARNING;
  }

  respawn(): void {
    this.room = this.spawn;
    this.position = [...this.graph.tiling.tiles[this.spawn].center] as Vec3;
    this.patrolTarget = -1;
  }

  /** Next room on a shortest route from `from` to `to` in this hunter's layer, or −1. */
  private nextHop(from: number, to: number): number {
    if (from === to) return to;
    const { tiles } = this.graph.tiling;
    const prev = new Map<number, number>([[from, -1]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const r = queue[i];
      for (const n of tiles[r].neighbors) {
        if (n === -1 || prev.has(n) || !this.graph.passable(r, n, this.layer)) continue;
        prev.set(n, r);
        if (n === to) {
          let step = n;
          while (prev.get(step) !== from) step = prev.get(step)!;
          return step;
        }
        queue.push(n);
      }
    }
    return -1;
  }

  /** Moves the hunter; `seesTarget` is true when the marble is in this hunter's layer. */
  update(dt: number, speed: number, target: Vec3, targetRoom: number, seesTarget: boolean): void {
    const { tiles } = this.graph.tiling;
    let goal: Vec3 | null = null;
    let hop = -1;
    if (seesTarget) hop = this.nextHop(this.room, targetRoom);
    this.chasing = hop !== -1;
    if (this.chasing) {
      // A chase moves it on; any old patrol target may no longer be next door.
      this.patrolTarget = -1;
      goal = hop === this.room ? target : tiles[this.room].midpoints[tiles[this.room].neighbors.indexOf(hop)];
    } else {
      // Patrol: wander to a random passable neighbouring room's centre.
      if (this.patrolTarget === -1 || this.patrolTarget === this.room || !tiles[this.room].neighbors.includes(this.patrolTarget)) {
        const options = tiles[this.room].neighbors.filter((n) => n !== -1 && this.graph.passable(this.room, n, this.layer));
        this.patrolTarget = options.length > 0 ? options[Math.floor(this.rand() * options.length)] : this.room;
      }
      const t = this.patrolTarget;
      goal = t === this.room ? tiles[t].center : tiles[this.room].midpoints[tiles[this.room].neighbors.indexOf(t)];
      // Once through the doorway, carry on to the room's centre.
      if (distance(this.position, goal) < 0.05 && t !== this.room) goal = tiles[t].center;
    }
    const step = (this.chasing ? speed : speed * PATROL) * dt;
    const d = distance(this.position, goal);
    if (d > 1e-9) {
      // Move along the geodesic towards the goal, overshooting edge midpoints a little so we cross.
      const overshoot = !this.chasing || hop !== this.room ? 0.06 : 0;
      this.position = geodesicPoint(this.position, goal, Math.min(1 + overshoot / d, step / d));
      // Keep it exactly on the hyperboloid.
      const n = Math.sqrt(-minkowski(this.position, this.position));
      this.position = [this.position[0] / n, this.position[1] / n, this.position[2] / n];
    }
    this.room = locateTile(this.graph.tiling, this.position, this.room);
  }
}
