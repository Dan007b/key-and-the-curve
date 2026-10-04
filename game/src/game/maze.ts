/**
 * Mazes on the tiling: each tile is a room, and two edge-adjacent rooms are
 * joined by a passage or separated by a wall (CLAUDE.md §6.5).
 *
 * A seeded randomized depth-first search carves a perfect maze (a spanning
 * tree: exactly one route between any two rooms). Extra walls are then
 * knocked out to create loops, which the holonomy puzzles need.
 */

import type { Tiling } from '../math/tiling';
import { makeRng, shuffle } from './random';

/** Unordered pair of tile indices as a single number. */
export function passageKey(a: number, b: number): number {
  return a < b ? a * 1_000_003 + b : b * 1_000_003 + a;
}

export interface MazeOptions {
  /** Rooms are the tiles within this many edge-crossings of the start tile. */
  depth: number;
  seed: number;
  start: number;
  /** Walls between rooms to knock out at random after carving. */
  extraOpenings: number;
  /** Passages that must be open (added after carving). */
  open?: [number, number][];
  /** Passages the carver must never use (it routes around them). */
  closed?: [number, number][];
}

export interface Maze {
  /** 1 if the tile is a room, per tile index. */
  isRoom: Uint8Array;
  rooms: number[];
  /** All open passages (keys from passageKey). */
  open: Set<number>;
  /** The carved spanning tree: a subset of `open` with exactly one route between rooms. */
  tree: Set<number>;
  start: number;
}

/** Rooms within `depth` edge-crossings of `start` (breadth-first). */
function roomsAround(tiling: Tiling, start: number, depth: number): number[] {
  const dist = new Map<number, number>([[start, 0]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    const d = dist.get(t)!;
    if (d === depth) continue;
    for (const n of tiling.tiles[t].neighbors) {
      if (n !== -1 && !dist.has(n)) {
        dist.set(n, d + 1);
        queue.push(n);
      }
    }
  }
  return queue;
}

export function generateMaze(tiling: Tiling, opts: MazeOptions): Maze {
  const rand = makeRng(opts.seed);
  const rooms = roomsAround(tiling, opts.start, opts.depth);
  const isRoom = new Uint8Array(tiling.tiles.length);
  for (const r of rooms) isRoom[r] = 1;
  const closed = new Set((opts.closed ?? []).map(([a, b]) => passageKey(a, b)));

  // Randomized DFS with an explicit stack.
  const tree = new Set<number>();
  const visited = new Set<number>([opts.start]);
  const stack = [opts.start];
  while (stack.length > 0) {
    const room = stack[stack.length - 1];
    const options = tiling.tiles[room].neighbors.filter(
      (n) => n !== -1 && isRoom[n] === 1 && !visited.has(n) && !closed.has(passageKey(room, n)),
    );
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const next = options[Math.floor(rand() * options.length)];
    tree.add(passageKey(room, next));
    visited.add(next);
    stack.push(next);
  }

  const open = new Set(tree);
  // Knock out extra walls between rooms, in a deterministic shuffled order.
  const candidates: number[] = [];
  for (const r of rooms) {
    for (const n of tiling.tiles[r].neighbors) {
      if (n > r && isRoom[n] === 1) {
        const key = passageKey(r, n);
        if (!open.has(key) && !closed.has(key)) candidates.push(key);
      }
    }
  }
  candidates.sort((a, b) => a - b);
  for (const key of shuffle(candidates, rand).slice(0, opts.extraOpenings)) open.add(key);
  for (const [a, b] of opts.open ?? []) open.add(passageKey(a, b));

  return { isRoom, rooms, open, tree, start: opts.start };
}

/** Rooms reachable from `from` through open passages, with their step counts. */
export function roomDistances(tiling: Tiling, maze: Maze, from: number, passable = maze.open): Map<number, number> {
  const dist = new Map<number, number>([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    for (const n of tiling.tiles[t].neighbors) {
      if (n !== -1 && maze.isRoom[n] === 1 && !dist.has(n) && passable.has(passageKey(t, n))) {
        dist.set(n, dist.get(t)! + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}
