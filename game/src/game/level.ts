/**
 * Level loading. Levels are JSON files in /game/levels.
 */

import { generateTiling } from '../math/tiling';
import type { Tiling } from '../math/tiling';
import { generateMaze, roomDistances } from './maze';
import type { Maze } from './maze';
import { buildWorld } from './world';
import type { DoorEdge, RiftEdge, World } from './world';
import { referenceFrames } from './transport';
import type { Mat3 } from '../math/lorentz';

import level1 from '../../levels/1-slip.json';
import level2 from '../../levels/2-rift.json';
import level3 from '../../levels/3-hunted.json';
import level4 from '../../levels/4-curvature.json';
import level5 from '../../levels/5-swarm.json';
import level6 from '../../levels/6-shifter.json';
import level7 from '../../levels/7-orbit.json';
import level8 from '../../levels/8-flux.json';
import level9 from '../../levels/9-escape.json';

export interface ShardSpec {
  tile: number;
  /** The layer the shard lives in: it can only be picked up there. */
  layer: number;
}

export interface HunterSpec {
  /** Spawn room. */
  tile: number;
  /** The layer it starts in. */
  layer: number;
  /** Shifters only: seconds between layer changes. */
  shiftEvery?: number;
  /** Shifters only: layers moved per change (default +1). */
  shiftStep?: number;
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
  /** Room with the exit portal (opens once every shard is collected). */
  exit: number;
  /** Whether you may twist through the fourth dimension (false: only curvature moves you). */
  twist?: boolean;
  doors: DoorEdge[];
  /** Rifts: passages you bridge by lining up a 4D plank (turn your 4D view to its angles). */
  rifts?: RiftEdge[];
  shards: ShardSpec[];
  hunters: HunterSpec[];
  /** Hunter chase speed at the start, units/s (it rises over time). */
  hunterSpeed?: number;
  /** Seconds for three stars. */
  par: number;
  /** Pillars to highlight, as [tile, vertex] pairs. */
  markedPillars?: [number, number][];
  intro: string;
  hint: string;
}

export const LEVELS: LevelSpec[] = [level1, level2, level3, level4, level5, level6, level7, level8, level9] as LevelSpec[];

/** Index of the level called `name` in LEVELS (throws if there is none). */
export function levelIndex(name: string): number {
  const i = LEVELS.findIndex((l) => l.name === name);
  if (i === -1) throw new Error(`no level named ${name}`);
  return i;
}

/** The level called `name`. */
export function levelNamed(name: string): LevelSpec {
  return LEVELS[levelIndex(name)];
}

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
  for (const r of [spec.exit, ...spec.shards.map((s) => s.tile), ...spec.hunters.map((h) => h.tile)]) {
    if (maze.isRoom[r] !== 1) throw new Error(`level ${spec.name}: tile ${r} is not a room`);
  }
  if (!roomDistances(tiling, maze, spec.start).has(spec.exit)) {
    throw new Error(`level ${spec.name}: exit unreachable`);
  }
  const world = buildWorld(tiling, maze, spec.doors, spec.rifts ?? []);
  const references = referenceFrames(tiling, maze.tree, spec.start);
  return { spec, tiling, maze, world, references };
}
