/**
 * How the key is carried from room to room.
 *
 * The marble rolls freely, but the key's frame is parallel-transported along
 * the chain of geodesic segments joining room centres: crossing from room i
 * to neighbouring room j, the frame is translated straight from centre i to
 * centre j. Any closed walk through rooms is then a geodesic polygon, and the
 * key comes back rotated by exactly that polygon's area (CLAUDE.md §6.6).
 *
 * For {5,4}, the four rooms around a maze vertex form a square of the dual
 * {4,5} tiling with 72° corners, of area 2π − 4·(2π/5) = 2π/5. So every loop
 * turns the key by a multiple of 72°: one step per enclosed vertex (pillar).
 * Measuring the marble's actual wobbly path instead would make the angle
 * depend on how it hugged the walls, which is unplayable for a gate with a
 * ~14° tolerance; the room chain keeps the geometry exact and the game fair.
 *
 * Exactness: every carried frame equals the room's canonical frame rotated
 * by a multiple of π/p (shown in MATH.md), so after each step we snap to
 * that grid. Round-off therefore never accumulates, however long you play.
 */

import { decompose, logOrigin, lorentzInverse, mul, rotation, translation, apply } from '../math/lorentz';
import type { Mat3, ReadonlyMat3 } from '../math/lorentz';
import type { Tiling } from '../math/tiling';
import { passageKey } from './maze';

/** Grid that carried frames live on, relative to a room's canonical frame. */
function snapStep(tiling: Tiling): number {
  return Math.PI / tiling.metrics.p;
}

/**
 * Snaps a frame sitting at the centre of `tile` to the canonical frame
 * rotated by the nearest multiple of π/p. Throws if it is not already within
 * 1e-6 of that grid, since that would mean the transport is wrong.
 */
export function snapToTile(tiling: Tiling, frame: ReadonlyMat3, tile: number): Mat3 {
  const canon = tiling.tiles[tile].frame;
  const rel = decompose(mul(lorentzInverse(canon), frame));
  const step = snapStep(tiling);
  const k = Math.round(rel.angle / step);
  const err = Math.abs(rel.angle - k * step);
  if (err > 1e-6 || Math.hypot(rel.position[0], rel.position[1]) > 1e-6) {
    throw new Error(`transport: frame is not on tile ${tile}'s grid (error ${err})`);
  }
  return mul(canon, rotation(k * step));
}

/**
 * Carries a frame sitting at the centre of room `from` to the centre of the
 * adjacent room `to`, along the geodesic joining the centres.
 */
export function carryAcross(tiling: Tiling, frame: ReadonlyMat3, from: number, to: number): Mat3 {
  if (!tiling.tiles[from].neighbors.includes(to)) {
    throw new Error(`transport: rooms ${from} and ${to} are not adjacent`);
  }
  // Centre of `to` in the frame's own coordinates, as a tangent vector at O.
  const [ux, uy] = logOrigin(apply(lorentzInverse(frame), tiling.tiles[to].center));
  return snapToTile(tiling, mul(frame, translation(ux, uy)), to);
}

/** Wraps an angle to (−π, π]. */
export function wrapAngle(theta: number): number {
  let t = theta % (2 * Math.PI);
  if (t > Math.PI) t -= 2 * Math.PI;
  if (t <= -Math.PI) t += 2 * Math.PI;
  return t;
}

/** Rotation angle of `frame` relative to `reference` (both at the same point). */
export function angleBetween(reference: ReadonlyMat3, frame: ReadonlyMat3): number {
  return wrapAngle(decompose(mul(lorentzInverse(reference), frame)).angle);
}

/**
 * Reference frames: the start frame carried along the maze's spanning tree to
 * every room. The tree has exactly one route to each room, so this is well
 * defined. The key's holonomy in a room is its carried frame's angle relative
 * to this reference: zero along the direct route, ±72° per pillar looped.
 */
export function referenceFrames(tiling: Tiling, tree: Set<number>, start: number): (Mat3 | null)[] {
  const frames: (Mat3 | null)[] = tiling.tiles.map(() => null);
  frames[start] = tiling.tiles[start].frame;
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    for (const n of tiling.tiles[t].neighbors) {
      if (n !== -1 && frames[n] === null && tree.has(passageKey(t, n))) {
        frames[n] = carryAcross(tiling, frames[t]!, t, n);
        queue.push(n);
      }
    }
  }
  return frames;
}
