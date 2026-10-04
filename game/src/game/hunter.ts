/**
 * Hunters: shadows that live in one layer of the fourth dimension.
 *
 * A hunter moves through the maze like the marble does: it cannot pass solid
 * walls, though as a shadow it drifts through doors. It can only see you while you
 * are in its layer: then it chases, heading for the shared edge of the next
 * room on the shortest route to you, and straight at you once in your room.
 * Otherwise it patrols at random. Rooms are convex, so straight moves to an
 * edge midpoint or to a point in the same room never cross a wall.
 */

import { distance, minkowski } from '../math/lorentz';
import type { Vec3 } from '../math/lorentz';
import { geodesicPoint } from '../math/geodesic';
import { locateTile } from '../math/tiling';
import type { Tiling } from '../math/tiling';

export interface HunterGraph {
  tiling: Tiling;
  /** Whether a hunter in `layer` can pass from room a to the adjacent room b. */
  passable(a: number, b: number, layer: number): boolean;
}

/** Hunter radius (hyperbolic units). */
export const HUNTER_RADIUS = 0.16;
/** Patrol speed as a fraction of chase speed. */
const PATROL = 0.55;

export class Hunter {
  position: Vec3;
  room: number;
  chasing = false;
  private patrolTarget = -1;

  constructor(
    readonly layer: number,
    readonly spawn: number,
    private readonly graph: HunterGraph,
    private readonly rand: () => number,
  ) {
    this.room = spawn;
    this.position = [...graph.tiling.tiles[spawn].center] as Vec3;
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
      goal = hop === this.room ? target : tiles[this.room].midpoints[tiles[this.room].neighbors.indexOf(hop)];
    } else {
      // Patrol: wander to a random passable neighbouring room's centre.
      if (this.patrolTarget === -1 || this.patrolTarget === this.room) {
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
