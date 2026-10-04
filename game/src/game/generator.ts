/**
 * Level generator: turns a short recipe into a level, and keeps only levels
 * the solver can prove are fair.
 *
 * The recipe's maze is carved as usual (maze.ts). Then:
 * - the exit goes in the room farthest from the start;
 * - doors go on the shortest route to the exit, evenly spaced, each a
 *   different colour from the one before (the first is never red, the
 *   starting layer, so you have to phase straight away);
 * - shards go in dead ends, spread out (greedy farthest-first);
 * - hunters spawn in far rooms, spread out, in the recipe's layers;
 * - optionally, "pillar loops": all four passages around a few pillars are
 *   opened, so you can lap that one pillar (one layer per lap), and the
 *   pillar is marked. Levels that jam twisting rely on these.
 *
 * A candidate is kept only if the solver finds a solution, the doors matter
 * (with every door solid the level is impossible), and, for levels that jam
 * twisting, the spanning tree alone is not enough (you must loop pillars).
 * Otherwise the next seed is tried. Everything is seeded, so a recipe always
 * produces the same level.
 */

import { distance } from '../math/lorentz';
import { loadLevel } from './level';
import type { HunterSpec, LevelSpec, LoadedLevel, ShardSpec } from './level';
import type { DoorEdge } from './world';
import { passageKey, roomDistances } from './maze';
import { LAYERS } from './phase';
import { makeRng, shuffle } from './random';
import { solveLevel } from './solver';

export interface LevelRecipe {
  name: string;
  /** First maze seed to try; later seeds are tried until one passes. */
  seed: number;
  /** Rooms are the tiles within this many steps of the start. */
  depth: number;
  extraOpenings: number;
  doors: number;
  shards: number;
  /** Pillars to open a lap around (and mark), spread out from the start. */
  pillarLoops?: number;
  /** Hunters: starting layer, and an optional shift timetable. */
  hunters: Omit<HunterSpec, 'tile'>[];
  twist?: boolean;
  hunterSpeed?: number;
  /** Seconds per solver move when setting par (default 4.5, roughly what the hand-made levels use). */
  parPerMove?: number;
  intro: string;
  hint: string;
}

export interface GeneratedLevel {
  spec: LevelSpec;
  /** Fewest moves (passages crossed plus twists) to finish, from the solver. */
  moves: number;
  /** How many seeds were rejected before this one. */
  rejected: number;
}

/** Shortest route between two rooms through open passages. */
function route(level: LoadedLevel, from: number, to: number): number[] {
  const { tiling, maze } = level;
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let i = 0; i < queue.length && !prev.has(to); i++) {
    for (const n of tiling.tiles[queue[i]].neighbors) {
      if (n !== -1 && maze.isRoom[n] === 1 && !prev.has(n) && maze.open.has(passageKey(queue[i], n))) {
        prev.set(n, queue[i]);
        queue.push(n);
      }
    }
  }
  const path = [to];
  while (prev.get(path[0])! !== -1) path.unshift(prev.get(path[0])!);
  return path;
}

/**
 * Picks `count` rooms from `candidates`, farthest-first: each pick maximises
 * its distance (in passages) to the start and to every earlier pick.
 */
function spreadOut(level: LoadedLevel, candidates: number[], count: number, avoid: number[]): number[] {
  const { tiling, maze } = level;
  const picked: number[] = [];
  const dist = new Map<number, number>();
  const relax = (from: number) => {
    for (const [r, d] of roomDistances(tiling, maze, from)) dist.set(r, Math.min(dist.get(r) ?? Infinity, d));
  };
  for (const a of avoid) relax(a);
  const pool = [...candidates];
  while (picked.length < count && pool.length > 0) {
    pool.sort((a, b) => (dist.get(b) ?? 0) - (dist.get(a) ?? 0) || a - b);
    const next = pool.shift()!;
    picked.push(next);
    relax(next);
  }
  return picked;
}

/**
 * Chooses `count` pillars whose four surrounding tiles are all rooms, spread
 * out across the plane (the first is a corner of the start room, the rest
 * farthest-first by hyperbolic distance), and returns the passages that open
 * a lap around each one plus the [tile, vertex] pairs that mark them.
 */
function pillarLoops(level: LoadedLevel, count: number): { open: [number, number][]; marked: [number, number][] } | null {
  const { tiling, world, spec } = level;
  const around = new Map<number, number[]>(); // post → rooms that have it as a corner
  world.roomPosts.forEach((posts, room) => posts.forEach((id) => around.set(id, [...(around.get(id) ?? []), room])));
  const candidates = [...around.keys()].filter((id) => around.get(id)!.length === tiling.metrics.q).sort((a, b) => a - b);
  const first = candidates.find((id) => around.get(id)!.includes(spec.start));
  if (first === undefined) return null;
  const chosen = [first];
  while (chosen.length < count) {
    let best = -1;
    let bestDist = 0;
    for (const id of candidates) {
      const d = Math.min(...chosen.map((c) => distance(world.posts[c].position, world.posts[id].position)));
      if (d > bestDist) {
        best = id;
        bestDist = d;
      }
    }
    if (best === -1) return null;
    chosen.push(best);
  }
  const open: [number, number][] = [];
  const marked: [number, number][] = [];
  for (const id of chosen) {
    const rooms = around.get(id)!;
    for (const a of rooms) for (const b of rooms) if (a < b && tiling.tiles[a].neighbors.includes(b)) open.push([a, b]);
    const room = Math.min(...rooms);
    marked.push([room, world.roomPosts[room].indexOf(id)]);
  }
  return { open, marked };
}

/** One attempt at a recipe with a given maze seed; null if the result is not fair. */
export function tryRecipe(recipe: LevelRecipe, seed: number): { spec: LevelSpec; moves: number } | null {
  const rand = makeRng(seed * 104729 + 17);
  const base: LevelSpec = {
    name: recipe.name,
    tiling: [5, 4],
    depth: recipe.depth,
    seed,
    extraOpenings: recipe.extraOpenings,
    start: 0,
    exit: 0,
    twist: recipe.twist,
    doors: [],
    shards: [],
    hunters: [],
    hunterSpeed: recipe.hunterSpeed,
    par: 0,
    intro: recipe.intro,
    hint: recipe.hint,
  };
  if (base.twist === undefined) delete base.twist;
  if (base.hunterSpeed === undefined) delete base.hunterSpeed;
  if (recipe.pillarLoops) {
    const loops = pillarLoops(loadLevel(base), recipe.pillarLoops);
    if (!loops) return null;
    base.open = loops.open;
    base.markedPillars = loops.marked;
  }
  const bare = loadLevel(base);
  const { tiling, maze } = bare;

  // Exit: the farthest room from the start.
  const fromStart = roomDistances(tiling, maze, base.start);
  let exit = base.start;
  for (const [r, d] of fromStart) if (d > fromStart.get(exit)! || (d === fromStart.get(exit)! && r < exit)) exit = r;

  // Doors: evenly spaced along the shortest route to the exit.
  const path = route(bare, base.start, exit);
  const edges = path.length - 1;
  if (edges < recipe.doors + 1) return null;
  const doors: DoorEdge[] = [];
  let colour = 0;
  for (let k = 1; k <= recipe.doors; k++) {
    const i = Math.round((k * edges) / (recipe.doors + 1)) - 1;
    const a = path[i];
    const b = path[i + 1];
    colour = (colour + 1 + Math.floor(rand() * (LAYERS - 1))) % LAYERS; // never the previous colour
    doors.push({ tile: a, edge: tiling.tiles[a].neighbors.indexOf(b), layer: colour });
  }

  // Shards: dead ends first (then the farthest rooms), spread out, random colours.
  const degree = (r: number) => tiling.tiles[r].neighbors.filter((n) => n !== -1 && maze.isRoom[n] === 1 && maze.open.has(passageKey(r, n))).length;
  const others = maze.rooms.filter((r) => r !== base.start && r !== exit);
  const deadEnds = others.filter((r) => degree(r) === 1);
  const rest = others.filter((r) => degree(r) !== 1).sort((a, b) => fromStart.get(b)! - fromStart.get(a)! || a - b);
  const shardRooms = spreadOut(bare, deadEnds, recipe.shards, [base.start]);
  if (shardRooms.length < recipe.shards) shardRooms.push(...spreadOut(bare, rest, recipe.shards - shardRooms.length, [base.start, ...shardRooms]));
  const shards: ShardSpec[] = shardRooms.map((tile) => ({ tile, layer: Math.floor(rand() * LAYERS) }));
  if (new Set(shards.map((s) => s.layer)).size < Math.min(3, shards.length)) return null;

  // Hunters: far from the start (at least half the maze's radius), spread out.
  const radius = fromStart.get(exit)!;
  const far = shuffle(
    others.filter((r) => fromStart.get(r)! >= Math.ceil(radius / 2) && !shardRooms.includes(r)),
    rand,
  );
  const hunterRooms = spreadOut(bare, far, recipe.hunters.length, [base.start]);
  if (hunterRooms.length < recipe.hunters.length) return null;
  const hunters: HunterSpec[] = recipe.hunters.map((h, i) => ({ tile: hunterRooms[i], ...h }));

  const spec: LevelSpec = { ...base, exit, doors, shards, hunters };
  const level = loadLevel(spec);
  const moves = solveLevel(level);
  if (moves === -1) return null;
  // The doors must matter: with every door solid there is no way through.
  if (doors.length > 0 && solveLevel(level, { doorsSolid: true }) !== -1) return null;
  // Twisting jammed: the direct routes alone must not be enough.
  if (recipe.twist === false && solveLevel(level, { passable: maze.tree }) !== -1) return null;
  spec.par = Math.max(30, Math.round((moves * (recipe.parPerMove ?? 4.5)) / 5) * 5);
  return { spec, moves };
}

/** Tries seeds from the recipe's own upward until a fair level comes out. */
export function generateLevel(recipe: LevelRecipe, maxTries = 500): GeneratedLevel {
  for (let i = 0; i < maxTries; i++) {
    const got = tryRecipe(recipe, recipe.seed + i);
    if (got) return { ...got, rejected: i };
  }
  throw new Error(`generator: no fair level for "${recipe.name}" in ${maxTries} seeds`);
}
