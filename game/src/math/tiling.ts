/**
 * Regular {p,q} tilings of the hyperbolic plane: p-gons, q meeting at every
 * vertex. Hyperbolic exactly when (p − 2)(q − 2) > 4; the game uses {5,4}.
 *
 * Tile 0 is centred on O. Every tile stores a frame (canonical tile → world),
 * so all tiles share one canonical geometry and the renderer can instance it.
 *
 * Canonical tile: vertex k sits at angle 2πk/p and distance R (circumradius)
 * from O; edge k runs from vertex k to vertex k+1, counter-clockwise, and its
 * midpoint is at angle (2k+1)π/p and distance r (inradius).
 */

import {
  ORIGIN,
  apply,
  distance,
  expOrigin,
  identity,
  lorentzInverse,
  minkowski,
  mul,
  reorthonormalize,
  rotation,
  translationTo,
} from './lorentz';
import type { Mat3, ReadonlyMat3, Vec3 } from './lorentz';
import { geodesicNormal } from './geodesic';

/** Lengths and angles of one regular tile of a {p,q} tiling. */
export interface TileMetrics {
  p: number;
  q: number;
  /** Distance from the centre to a vertex: cosh R = cot(π/p)·cot(π/q). */
  circumradius: number;
  /** Distance from the centre to an edge midpoint: cosh r = cos(π/q)/sin(π/p). */
  inradius: number;
  /** Edge length: cosh(L/2) = cos(π/p)/sin(π/q). */
  side: number;
  /** Interior angle at each vertex: 2π/q. */
  interiorAngle: number;
  /** Area, by Gauss–Bonnet: (p − 2)π − p·(2π/q). */
  area: number;
}

/**
 * Metrics of a regular {p,q} tile. All three lengths come from the right
 * triangle (centre, edge midpoint, vertex), whose angles are π/p at the
 * centre, π/q at the vertex and π/2 at the midpoint.
 */
export function tileMetrics(p: number, q: number): TileMetrics {
  if ((p - 2) * (q - 2) <= 4) {
    throw new Error(`{${p},${q}} is not a hyperbolic tiling`);
  }
  const a = Math.PI / p;
  const b = Math.PI / q;
  return {
    p,
    q,
    circumradius: Math.acosh(1 / (Math.tan(a) * Math.tan(b))),
    inradius: Math.acosh(Math.cos(b) / Math.sin(a)),
    side: 2 * Math.acosh(Math.cos(a) / Math.sin(b)),
    interiorAngle: 2 * b,
    area: (p - 2) * Math.PI - p * 2 * b,
  };
}

export interface Tile {
  /** Maps the canonical tile to this tile. Orientation-preserving (SO⁺(2,1)). */
  frame: Mat3;
  /** World position of the tile centre (frame · O). */
  center: Vec3;
  /** World positions of the p vertices, counter-clockwise. */
  vertices: Vec3[];
  /** World midpoints of the p edges. */
  midpoints: Vec3[];
  /**
   * Inward unit normals of the p edge geodesics (⟨n,n⟩ = 1): a point x is
   * inside the tile iff ⟨x, n_k⟩ ≥ 0 for every k.
   */
  inwardNormals: Vec3[];
  /** Tile across edge k, or −1 if it was not generated. */
  neighbors: number[];
  /** Index of the shared edge as seen from the neighbour (−1 if none). */
  neighborEdges: number[];
  /** Number of edge-crossings from tile 0 (breadth-first). */
  depth: number;
}

export interface Tiling {
  metrics: TileMetrics;
  /** Canonical vertex positions (tile 0's vertices). */
  canonicalVertices: Vec3[];
  /** Canonical edge midpoints. */
  canonicalMidpoints: Vec3[];
  /** R(2πk/p): maps canonical edge 0 / vertex 0 to edge k / vertex k. */
  edgeRotations: Mat3[];
  tiles: Tile[];
}

export interface TilingOptions {
  p: number;
  q: number;
  /** Generate tiles whose centre is at most this far from O. */
  maxRadius: number;
  /** Hard cap on the number of tiles. */
  maxTiles?: number;
}

// Two tile centres closer than this are the same tile. Distinct centres are
// at least 2·inradius apart (≈ 1.26 for {5,4}), and float error in a centre
// stays below ~1e-9 at the radii we generate, so any value in between works.
const SAME_TILE = 1e-4;

/**
 * Generates the tiling breadth-first from a central tile.
 *
 * Neighbours are produced by half-turns about edge midpoints rather than by
 * reflections: the half-turn about the midpoint of edge k maps the tile onto
 * its neighbour across that edge (it swaps the edge's endpoints), and unlike
 * a reflection it preserves orientation, so every frame stays in SO⁺(2,1)
 * and the neighbour's shared edge is again its edge k. Duplicates (tiles
 * reached by two routes) are merged by comparing centres.
 */
export function generateTiling(opts: TilingOptions): Tiling {
  const { p, q, maxRadius } = opts;
  const maxTiles = opts.maxTiles ?? 20000;
  const metrics = tileMetrics(p, q);

  const canonicalVertices: Vec3[] = [];
  const canonicalMidpoints: Vec3[] = [];
  const edgeRotations: Mat3[] = [];
  const halfTurns: Mat3[] = [];
  for (let k = 0; k < p; k++) {
    const va = (2 * Math.PI * k) / p;
    const ma = ((2 * k + 1) * Math.PI) / p;
    canonicalVertices.push(expOrigin(metrics.circumradius * Math.cos(va), metrics.circumradius * Math.sin(va)));
    const mid = expOrigin(metrics.inradius * Math.cos(ma), metrics.inradius * Math.sin(ma));
    canonicalMidpoints.push(mid);
    edgeRotations.push(rotation(va));
    const t = translationTo(mid);
    halfTurns.push(mul(mul(t, rotation(Math.PI)), lorentzInverse(t)));
  }

  const tiles: Tile[] = [];
  // Spatial hash on the centre's (x, y) hyperboloid coordinates. Distinct
  // centres differ by more than 1 in (x, y) (|Δxy| ≥ hyperbolic distance), so
  // checking the 3×3 neighbouring buckets of size 0.5 finds every duplicate.
  const buckets = new Map<string, number[]>();
  const bucketKey = (ix: number, iy: number) => `${ix},${iy}`;

  const findTile = (c: Vec3): number => {
    const ix = Math.floor(c[0] / 0.5);
    const iy = Math.floor(c[1] / 0.5);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of buckets.get(bucketKey(ix + dx, iy + dy)) ?? []) {
          if (distance(tiles[j].center, c) < SAME_TILE) return j;
        }
      }
    }
    return -1;
  };

  const addTile = (frame: Mat3, depth: number): number => {
    const center: Vec3 = [frame[2], frame[5], frame[8]];
    const vertices = canonicalVertices.map((v) => apply(frame, v));
    const midpoints = canonicalMidpoints.map((m) => apply(frame, m));
    const inwardNormals = vertices.map((v, k) => {
      // Vertices run counter-clockwise, so the interior is on the left of
      // v_k → v_{k+1}, which is the side geodesicNormal points to.
      const n = geodesicNormal(v, vertices[(k + 1) % p]);
      return minkowski(center, n) >= 0 ? n : (n.map((x) => -x) as Vec3);
    });
    const index = tiles.length;
    tiles.push({
      frame,
      center,
      vertices,
      midpoints,
      inwardNormals,
      neighbors: new Array(p).fill(-1),
      neighborEdges: new Array(p).fill(-1),
      depth,
    });
    const key = bucketKey(Math.floor(center[0] / 0.5), Math.floor(center[1] / 0.5));
    const list = buckets.get(key);
    if (list) list.push(index);
    else buckets.set(key, [index]);
    return index;
  };

  const link = (i: number, k: number, j: number) => {
    // Find which edge of j is the edge k of i, by matching midpoints.
    const mid = tiles[i].midpoints[k];
    let best = -1;
    let bestDist = Infinity;
    tiles[j].midpoints.forEach((m, e) => {
      const d = distance(m, mid);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    });
    if (bestDist > SAME_TILE) {
      throw new Error(`tiling: tiles ${i} and ${j} do not share edge ${k}`);
    }
    tiles[i].neighbors[k] = j;
    tiles[i].neighborEdges[k] = best;
    tiles[j].neighbors[best] = i;
    tiles[j].neighborEdges[best] = k;
  };

  addTile(identity(), 0);
  for (let i = 0; i < tiles.length; i++) {
    for (let k = 0; k < p; k++) {
      if (tiles[i].neighbors[k] !== -1) continue;
      // Frames are composed many times on the way out; re-square each one.
      const frame = reorthonormalize(mul(tiles[i].frame, halfTurns[k]));
      const center: Vec3 = [frame[2], frame[5], frame[8]];
      const existing = findTile(center);
      if (existing >= 0) {
        link(i, k, existing);
        continue;
      }
      if (distance(ORIGIN, center) > maxRadius || tiles.length >= maxTiles) continue;
      link(i, k, addTile(frame, tiles[i].depth + 1));
    }
  }

  return { metrics, canonicalVertices, canonicalMidpoints, edgeRotations, tiles };
}

/**
 * Index of the tile containing world point x, searching outward from a
 * starting guess (usually the tile the point was in last step). Returns the
 * guess itself if x has left the generated region.
 */
export function locateTile(tiling: Tiling, x: Vec3, guess: number): number {
  let current = guess;
  // A point moves at most a few tiles per call; bound the walk anyway.
  for (let steps = 0; steps < 64; steps++) {
    const tile = tiling.tiles[current];
    let worst = 0;
    let worstEdge = -1;
    tile.inwardNormals.forEach((n, k) => {
      const s = minkowski(x, n);
      if (s < worst) {
        worst = s;
        worstEdge = k;
      }
    });
    if (worstEdge === -1) return current;
    const next = tile.neighbors[worstEdge];
    if (next === -1) return current;
    current = next;
  }
  return current;
}

/** Composes a frame with the canonical rotation for edge/vertex k. */
export function edgeFrame(tiling: Tiling, tileFrame: ReadonlyMat3, k: number): Mat3 {
  return mul(tileFrame, tiling.edgeRotations[k]);
}
