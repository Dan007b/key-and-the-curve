import { describe, expect, it } from 'vitest';
import { tilingFor } from '../src/game/level';
import { generateMaze, passageKey, roomDistances } from '../src/game/maze';
import { buildWorld } from '../src/game/world';
import { distance } from '../src/math/lorentz';

const tiling = tilingFor(5, 4);

describe('maze generation', () => {
  it('carves a perfect maze: a spanning tree over the rooms', () => {
    for (const seed of [1, 2, 3, 42]) {
      const maze = generateMaze(tiling, { depth: 3, seed, start: 0, extraOpenings: 0 });
      expect(maze.rooms).toHaveLength(61);
      expect(maze.tree.size).toBe(maze.rooms.length - 1);
      expect(roomDistances(tiling, maze, 0, maze.tree).size).toBe(maze.rooms.length);
    }
  });

  it('is deterministic for a seed and varies between seeds', () => {
    const a = generateMaze(tiling, { depth: 2, seed: 7, start: 0, extraOpenings: 2 });
    const b = generateMaze(tiling, { depth: 2, seed: 7, start: 0, extraOpenings: 2 });
    const c = generateMaze(tiling, { depth: 2, seed: 8, start: 0, extraOpenings: 2 });
    expect([...a.open].sort()).toEqual([...b.open].sort());
    expect([...a.open].sort()).not.toEqual([...c.open].sort());
  });

  it('knocks out exactly the requested extra walls, creating loops', () => {
    const maze = generateMaze(tiling, { depth: 3, seed: 3, start: 0, extraOpenings: 4 });
    expect(maze.open.size).toBe(maze.tree.size + 4);
  });

  it('respects forced openings and closures', () => {
    const maze = generateMaze(tiling, { depth: 2, seed: 1, start: 0, extraOpenings: 0, open: [[0, 5]], closed: [[0, 4]] });
    expect(maze.open.has(passageKey(0, 5))).toBe(true);
    expect(maze.open.has(passageKey(0, 4))).toBe(false);
    expect(roomDistances(tiling, maze, 0).size).toBe(maze.rooms.length);
  });
});

describe('world geometry', () => {
  const maze = generateMaze(tiling, { depth: 2, seed: 1, start: 0, extraOpenings: 0 });
  const world = buildWorld(tiling, maze, []);

  it('puts a wall on every room edge that is not an open passage', () => {
    let roomEdges = 0;
    let openEdges = 0;
    for (const r of maze.rooms) {
      tiling.tiles[r].neighbors.forEach((n, k) => {
        roomEdges++;
        const open = n !== -1 && maze.isRoom[n] === 1 && maze.open.has(passageKey(r, n));
        if (open) openEdges++;
        expect(world.wallOn(r, k) === -1).toBe(open);
      });
    }
    // Interior walls are shared by two rooms but stored once.
    const interiorWalls = world.walls.filter((w) => maze.isRoom[tiling.tiles[w.tile].neighbors[w.edge]] === 1).length;
    expect(world.walls.length + interiorWalls + openEdges).toBe(roomEdges);
  });

  it('puts one post on every distinct room vertex', () => {
    for (let i = 0; i < world.posts.length; i++) {
      for (let j = i + 1; j < world.posts.length; j++) {
        expect(distance(world.posts[i].position, world.posts[j].position)).toBeGreaterThan(0.5);
      }
    }
    for (const r of maze.rooms) {
      tiling.tiles[r].vertices.forEach((v, k) => {
        expect(distance(world.posts[world.roomPosts[r][k]].position, v)).toBeLessThan(1e-9);
      });
    }
  });

  it('lets each room see its own walls', () => {
    for (const r of maze.rooms) {
      tiling.tiles[r].neighbors.forEach((_, k) => {
        const id = world.wallOn(r, k);
        if (id !== -1) expect(world.nearbyWalls[r]).toContain(id);
      });
    }
  });
});
