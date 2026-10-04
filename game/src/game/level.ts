/**
 * Level loading (CLAUDE.md §8). Levels are JSON files in /game/levels.
 */

import { generateTiling } from '../math/tiling';
import type { Tiling } from '../math/tiling';
import { generateMaze, roomDistances } from './maze';
import type { Maze } from './maze';
import { buildWorld } from './world';
import type { World } from './world';
import { referenceFrames } from './transport';
import type { Mat3 } from '../math/lorentz';

import level1 from '../../levels/1-rolling.json';
import level2 from '../../levels/2-first-gate.json';
import level3 from '../../levels/3-curvature.json';
import level4 from '../../levels/4-combine.json';
import level5 from '../../levels/5-final.json';

import type { Plane } from '../math/four';

export interface GateSpec {
  /** The gate sits on this tile's edge; holonomy is measured on this side. */
  tile: number;
  edge: number;
  /** Target orientation as plane rotations in degrees, applied in order. */
  target: [Plane, number][];
}

export interface LevelSpec {
  name: string;
  /** Tiling {p, q}. */
  tiling: [number, number];
  /** Rooms are the tiles within this many steps of the start. */
  depth: number;
  seed: number;
  extraOpenings: number;
  open?: [number, number][];
  closed?: [number, number][];
  start: number;
  goal: number;
  /** Whether twist mode is allowed (false on the pure-holonomy level). */
  twist?: boolean;
  gates?: GateSpec[];
  /** Pillars to highlight, as [tile, vertex] pairs. */
  markedPillars?: [number, number][];
  /** One or two sentences shown at the start of the level. */
  intro: string;
  /** Short reminder shown in the HUD while playing. */
  hint: string;
}

export const LEVELS: LevelSpec[] = [level1, level2, level3, level4, level5] as LevelSpec[];

/** Generation radius for every level's tiling. Fixed so tile indices never change. */
export const WORLD_RADIUS = 7.5;

const tilings = new Map<string, Tiling>();

/** The (cached) tiling for {p, q}. */
export function tilingFor(p: number, q: number): Tiling {
  const key = `${p},${q}`;
  let t = tilings.get(key);
  if (!t) {
    t = generateTiling({ p, q, maxRadius: WORLD_RADIUS });
    tilings.set(key, t);
  }
  return t;
}

export interface LoadedLevel {
  spec: LevelSpec;
  tiling: Tiling;
  maze: Maze;
  world: World;
  /** Reference frame per room for measuring holonomy (null outside the maze). */
  references: (Mat3 | null)[];
}

export function loadLevel(spec: LevelSpec): LoadedLevel {
  const tiling = tilingFor(spec.tiling[0], spec.tiling[1]);
  const maze = generateMaze(tiling, {
    depth: spec.depth,
    seed: spec.seed,
    start: spec.start,
    extraOpenings: spec.extraOpenings,
    open: spec.open,
    closed: spec.closed,
  });
  if (maze.isRoom[spec.goal] !== 1) throw new Error(`level ${spec.name}: goal ${spec.goal} is not a room`);
  if (!roomDistances(tiling, maze, spec.start).has(spec.goal)) {
    throw new Error(`level ${spec.name}: goal unreachable`);
  }
  const world = buildWorld(tiling, maze, spec.gates ?? []);
  const references = referenceFrames(tiling, maze.tree, spec.start);
  return { spec, tiling, maze, world, references };
}
