/**
 * Level solver: proves a level can be finished, ignoring hunters.
 *
 * A breadth-first search over the abstract state (room, curvature step,
 * twist step, shards held). Doors pass only in their own layer, shards are
 * taken only in theirs, and crossing a passage changes the curvature step by
 * that passage's holonomy jump: the carried frame's turn relative to the
 * destination room's reference frame, always a whole number of 72° steps
 * (transport.ts). Twist steps are free moves when the level allows twisting.
 * Rifts count as open: you can always bridge one from the room beside it.
 *
 * The state space is small (rooms × 5 × 5 × 2^shards), so this is exact and
 * fast. It backs the level tests and the level generator.
 */

import type { LoadedLevel } from './level';
import { passageKey } from './maze';
import { LAYERS, LAYER_DEG, mod } from './phase';
import { angleBetween, carryAcross } from './transport';

export interface SolveOptions {
  /** Passages the marble may use (default: every open passage of the maze). */
  passable?: Set<number>;
  /** Treat every door as a solid wall: used to check that the doors matter. */
  doorsSolid?: boolean;
  /** Leave every rift unbridged: used to check that the rifts matter. (Otherwise a rift counts as open: you can always bridge one from the room beside it.) */
  riftsClosed?: boolean;
  /** Allow twisting even if the level jams it (or forbid it with false). Default: the level's own rule. */
  twist?: boolean;
}

const STEP = (LAYER_DEG * Math.PI) / 180;

/** One step of a solution: roll into an adjacent room, or twist to a layer. */
export type SolverStep = { room: number } | { twistTo: number };

/**
 * A shortest solution: the steps to collect every shard and reach the exit,
 * or null if the level cannot be finished. A step is crossing one passage or
 * one twist (of any number of layers).
 */
export function solveLevelPath(level: LoadedLevel, opts: SolveOptions = {}): SolverStep[] | null {
  const { spec, tiling, maze, world, references } = level;
  const allowed = opts.passable ?? maze.open;
  const twist = opts.twist ?? spec.twist !== false;
  const jump = (a: number, b: number) => Math.round(angleBetween(references[b]!, carryAcross(tiling, references[a]!, a, b)) / STEP);
  const full = (1 << spec.shards.length) - 1;
  const take = (room: number, layer: number, held: number) =>
    spec.shards.reduce((h, s, i) => (s.tile === room && s.layer === layer ? h | (1 << i) : h), held);
  const key = (r: number, c: number, t: number, h: number) => ((r * LAYERS + c) * LAYERS + t) * (full + 1) + h;

  type State = [room: number, curvature: number, twist: number, held: number];
  const start: State = [spec.start, 0, 0, take(spec.start, 0, 0)];
  const parent = new Map<number, { from: number; step: SolverStep } | null>([[key(...start), null]]);
  const queue: State[] = [start];
  for (let i = 0; i < queue.length; i++) {
    const [room, c, t, held] = queue[i];
    const here = key(room, c, t, held);
    if (room === spec.exit && held === full) {
      const steps: SolverStep[] = [];
      for (let k = here, p = parent.get(k); p; k = p.from, p = parent.get(k)) steps.unshift(p.step);
      return steps;
    }
    const push = (r: number, c2: number, t2: number, step: SolverStep) => {
      const h2 = take(r, mod(c2 + t2, LAYERS), held);
      const k = key(r, c2, t2, h2);
      if (!parent.has(k)) {
        parent.set(k, { from: here, step });
        queue.push([r, c2, t2, h2]);
      }
    };
    if (twist) for (let s = 1; s < LAYERS; s++) push(room, c, mod(t + s, LAYERS), { twistTo: mod(c + t + s, LAYERS) });
    const layer = mod(c + t, LAYERS);
    for (const n of tiling.tiles[room].neighbors) {
      if (n === -1 || !maze.isRoom[n] || !allowed.has(passageKey(room, n))) continue;
      const id = world.wallOn(room, tiling.tiles[room].neighbors.indexOf(n));
      if (id !== -1) {
        const w = world.walls[id];
        if (w.rift ? opts.riftsClosed : opts.doorsSolid || w.door !== layer) continue;
      }
      push(n, mod(c + jump(room, n), LAYERS), t, { room: n });
    }
  }
  return null;
}

/** Fewest steps to finish the level (see solveLevelPath), or −1 if it cannot be finished. */
export function solveLevel(level: LoadedLevel, opts: SolveOptions = {}): number {
  return solveLevelPath(level, opts)?.length ?? -1;
}
