/**
 * Static geometry of a loaded level: walls, posts, and which of them the
 * marble can touch from each room.
 */

import { distance, translationTo } from '../math/lorentz';
import type { Mat3, Vec3 } from '../math/lorentz';
import type { Tiling } from '../math/tiling';
import type { Maze } from './maze';
import { passageKey } from './maze';

/** Hyperbolic half-width of a wall. */
export const WALL_HALF_WIDTH = 0.035;
/** Hyperbolic radius of the post at every maze vertex. */
export const POST_RADIUS = 0.08;

export interface Wall {
  /** Tile that owns the wall, and which of its edges it lies on. */
  tile: number;
  edge: number;
  /** World endpoints (the edge's vertices). */
  a: Vec3;
  b: Vec3;
  /** Index into the level's gates if this wall is a gate, else −1. */
  gate: number;
}

export interface Post {
  position: Vec3;
  /** translationTo(position), precomputed for drawing. */
  matrix: Mat3;
}

export interface World {
  tiling: Tiling;
  maze: Maze;
  walls: Wall[];
  posts: Post[];
  /** Wall id on (tile, edge), from either side; −1 if the passage is open. */
  wallOn: (tile: number, edge: number) => number;
  /** Walls/posts the marble may touch while its centre is in a given room. */
  nearbyWalls: number[][];
  nearbyPosts: number[][];
  /** Post id at vertex k of each room (empty for non-rooms). */
  roomPosts: number[][];
}

export interface GateEdge {
  tile: number;
  edge: number;
}

/**
 * Builds walls on every room edge that is not an open passage, gates on the
 * listed edges (which must be open passages), and a post on every vertex of
 * every room. Posts matter beyond looks: they stop the marble rolling over a
 * vertex, so which side of each pillar a path went is always well defined,
 * which is what the key's holonomy counts (see transport.ts).
 */
export function buildWorld(tiling: Tiling, maze: Maze, gates: readonly GateEdge[]): World {
  const { tiles } = tiling;
  const p = tiling.metrics.p;
  const walls: Wall[] = [];
  const wallIds = new Map<number, number>(); // tile * p + edge → wall id, both sides

  const gateAt = (tile: number, edge: number): number => {
    const j = tiles[tile].neighbors[edge];
    return gates.findIndex((g) => (g.tile === tile && g.edge === edge) || (g.tile === j && tiles[j]?.neighbors[g.edge] === tile));
  };

  for (const i of maze.rooms) {
    tiles[i].neighbors.forEach((j, k) => {
      const jIsRoom = j !== -1 && maze.isRoom[j] === 1;
      if (jIsRoom && j < i) return; // the lower index owns shared walls
      const gate = jIsRoom ? gateAt(i, k) : -1;
      const open = jIsRoom && maze.open.has(passageKey(i, j));
      if (open && gate === -1) return;
      if (gate !== -1 && !open) {
        throw new Error(`level: gate on tiles ${i}/${j} is not an open passage`);
      }
      const id = walls.length;
      walls.push({ tile: i, edge: k, a: tiles[i].vertices[k], b: tiles[i].vertices[(k + 1) % p], gate });
      wallIds.set(i * p + k, id);
      if (j !== -1) wallIds.set(j * p + tiles[i].neighborEdges[k], id);
    });
  }

  // One post per distinct vertex of any room.
  const posts: Post[] = [];
  const roomPosts: number[][] = tiles.map(() => []);
  for (const i of maze.rooms) {
    roomPosts[i] = tiles[i].vertices.map((v) => {
      const found = posts.findIndex((post) => distance(post.position, v) < 1e-6);
      if (found !== -1) return found;
      posts.push({ position: v, matrix: translationTo(v) });
      return posts.length - 1;
    });
  }

  const nearbyWalls: number[][] = tiles.map(() => []);
  const nearbyPosts: number[][] = tiles.map(() => []);
  for (const i of maze.rooms) {
    const area = [i, ...tiles[i].neighbors.filter((j) => j !== -1)];
    const w = new Set<number>();
    const ps = new Set<number>();
    for (const t of area) {
      for (let k = 0; k < p; k++) {
        const id = wallIds.get(t * p + k);
        if (id !== undefined) w.add(id);
      }
      for (const id of roomPosts[t]) ps.add(id);
    }
    nearbyWalls[i] = [...w];
    nearbyPosts[i] = [...ps];
  }

  return {
    tiling,
    maze,
    walls,
    posts,
    wallOn: (tile, edge) => wallIds.get(tile * p + edge) ?? -1,
    nearbyWalls,
    nearbyPosts,
    roomPosts,
  };
}
