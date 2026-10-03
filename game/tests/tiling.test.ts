import { describe, expect, it } from 'vitest';
import { ORIGIN, distance, expOrigin, lorentzError, minkowski } from '../src/math/lorentz';
import { generateTiling, locateTile, tileMetrics } from '../src/math/tiling';

const tiling = generateTiling({ p: 5, q: 4, maxRadius: 4 });

describe('tile metrics', () => {
  it('match the {5,4} values', () => {
    const m = tileMetrics(5, 4);
    expect(Math.cosh(m.circumradius)).toBeCloseTo(1 / Math.tan(Math.PI / 5), 14);
    expect(m.interiorAngle).toBeCloseTo(Math.PI / 2, 15);
    expect(m.area).toBeCloseTo(Math.PI / 2, 14);
  });

  it('rejects Euclidean and spherical tilings', () => {
    expect(() => tileMetrics(4, 4)).toThrow();
    expect(() => tileMetrics(5, 3)).toThrow();
  });

  it('are consistent with the canonical tile', () => {
    const m = tiling.metrics;
    const [v0, v1] = tiling.canonicalVertices;
    expect(distance(ORIGIN, v0)).toBeCloseTo(m.circumradius, 12);
    expect(distance(v0, v1)).toBeCloseTo(m.side, 12);
    expect(distance(ORIGIN, tiling.canonicalMidpoints[0])).toBeCloseTo(m.inradius, 12);
  });
});

describe('generated {5,4} tiling', () => {
  const { tiles } = tiling;

  it('has the expected layer sizes', () => {
    const layers = new Map<number, number>();
    for (const t of tiles) layers.set(t.depth, (layers.get(t.depth) ?? 0) + 1);
    // Layer 1: the 5 edge-neighbours. Layer 2: 5 corner tiles + 2 outer tiles per layer-1 tile.
    expect(layers.get(0)).toBe(1);
    expect(layers.get(1)).toBe(5);
    expect(layers.get(2)).toBe(15);
  });

  it('keeps every frame an exact isometry', () => {
    for (const t of tiles) expect(lorentzError(t.frame)).toBeLessThan(1e-9);
  });

  it('has distinct tile centres', () => {
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        expect(distance(tiles[i].center, tiles[j].center)).toBeGreaterThan(1.2);
      }
    }
  });

  it('links neighbours symmetrically across a shared edge', () => {
    tiles.forEach((t, i) => {
      t.neighbors.forEach((j, k) => {
        if (j === -1) return;
        const e = t.neighborEdges[k];
        expect(tiles[j].neighbors[e]).toBe(i);
        expect(tiles[j].neighborEdges[e]).toBe(k);
        // Shared edge: same endpoints, in opposite order.
        const p = tiling.metrics.p;
        expect(distance(t.vertices[k], tiles[j].vertices[(e + 1) % p])).toBeLessThan(1e-9);
        expect(distance(t.vertices[(k + 1) % p], tiles[j].vertices[e])).toBeLessThan(1e-9);
      });
    });
  });

  it('puts the centre of each neighbour exactly 2·inradius away', () => {
    tiles.forEach((t) => {
      t.neighbors.forEach((j) => {
        if (j !== -1) expect(distance(t.center, tiles[j].center)).toBeCloseTo(2 * tiling.metrics.inradius, 9);
      });
    });
  });

  it('has q = 4 tiles around every interior vertex', () => {
    // Count how many tiles have a vertex at each of tile 0's vertices.
    for (const v of tiles[0].vertices) {
      const around = tiles.filter((t) => t.vertices.some((w) => distance(v, w) < 1e-9));
      expect(around).toHaveLength(4);
    }
  });

  it('has inward normals that contain the tile centre', () => {
    for (const t of tiles) {
      for (const n of t.inwardNormals) {
        expect(minkowski(t.center, n)).toBeGreaterThan(0);
        expect(minkowski(n, n)).toBeCloseTo(1, 12);
      }
    }
  });
});

describe('locateTile', () => {
  it('finds the tile containing a point by walking from a guess', () => {
    const { tiles } = tiling;
    for (let i = 0; i < 40; i++) {
      // A point slightly off tile i's centre must be located in tile i,
      // whatever tile 0 guess we start from.
      const t = tiles[i];
      const target = t.center;
      expect(locateTile(tiling, target, 0)).toBe(i);
    }
  });

  it('switches tiles when a point crosses an edge', () => {
    const r = tiling.metrics.inradius;
    const angle = Math.PI / 5; // direction of edge 0's midpoint
    const inside = expOrigin((r - 0.01) * Math.cos(angle), (r - 0.01) * Math.sin(angle));
    const outside = expOrigin((r + 0.01) * Math.cos(angle), (r + 0.01) * Math.sin(angle));
    expect(locateTile(tiling, inside, 0)).toBe(0);
    expect(locateTile(tiling, outside, 0)).toBe(tiling.tiles[0].neighbors[0]);
  });
});
