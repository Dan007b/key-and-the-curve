// The level generator: deterministic, and only ever emits levels the solver
// proves fair. Also checks the generated level files are up to date.

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateLevel } from '../src/game/generator';
import type { LevelRecipe } from '../src/game/generator';
import { RECIPES } from '../src/game/recipes';
import { loadLevel } from '../src/game/level';
import type { LevelSpec } from '../src/game/level';
import { passageKey, roomDistances } from '../src/game/maze';
import { solveLevel } from '../src/game/solver';

const small: LevelRecipe = {
  name: 'Test',
  seed: 1,
  depth: 2,
  extraOpenings: 1,
  doors: 2,
  shards: 3,
  hunters: [{ layer: 1 }, { layer: 3, shiftEvery: 5 }],
  intro: '',
  hint: '',
};

describe('level generator', () => {
  it('is deterministic', () => {
    expect(generateLevel(small).spec).toEqual(generateLevel(small).spec);
  });

  it('puts the exit in the farthest room, doors on the way, and every door, shard and hunter where it should be', () => {
    const { spec } = generateLevel(small);
    const level = loadLevel(spec);
    const dist = roomDistances(level.tiling, level.maze, spec.start);
    expect(dist.get(spec.exit)).toBe(Math.max(...dist.values()));
    expect(spec.doors).toHaveLength(2);
    expect(spec.doors[0].layer).not.toBe(0); // you must phase straight away
    expect(spec.doors[1].layer).not.toBe(spec.doors[0].layer);
    expect(spec.shards).toHaveLength(3);
    expect(new Set(spec.shards.map((s) => s.layer)).size).toBe(3);
    expect(spec.hunters.map((h) => h.layer)).toEqual([1, 3]);
    expect(spec.hunters[1].shiftEvery).toBe(5);
    for (const r of [...spec.shards.map((s) => s.tile), ...spec.hunters.map((h) => h.tile)]) {
      expect(r).not.toBe(spec.start);
      expect(r).not.toBe(spec.exit);
    }
  });

  it('only emits fair levels: solvable, doors needed, loops needed when twisting is jammed', () => {
    for (const { recipe } of RECIPES) {
      const { spec, moves } = generateLevel(recipe);
      const level = loadLevel(spec);
      expect(solveLevel(level), recipe.name).toBe(moves);
      expect(moves).toBeGreaterThan(0);
      expect(solveLevel(level, { doorsSolid: true }), recipe.name).toBe(-1);
      if (recipe.twist === false) expect(solveLevel(level, { passable: level.maze.tree }), recipe.name).toBe(-1);
    }
  });

  it('opens a full lap around every marked pillar', () => {
    for (const { recipe } of RECIPES.filter((r) => r.recipe.pillarLoops)) {
      const { spec } = generateLevel(recipe);
      const level = loadLevel(spec);
      expect(spec.markedPillars).toHaveLength(recipe.pillarLoops!);
      for (const [tile, k] of spec.markedPillars!) {
        const post = level.world.roomPosts[tile][k];
        const rooms = level.world.roomPosts.flatMap((posts, r) => (posts.includes(post) ? [r] : []));
        expect(rooms).toHaveLength(4);
        const passages = rooms.flatMap((a) => rooms.filter((b) => a < b && level.tiling.tiles[a].neighbors.includes(b)).map((b) => [a, b]));
        expect(passages).toHaveLength(4);
        for (const [a, b] of passages) expect(level.maze.open.has(passageKey(a, b))).toBe(true);
      }
    }
  });

  it('the generated level files match their recipes (rerun `npm run levels` after editing one)', () => {
    for (const { file, recipe } of RECIPES) {
      const onDisk = JSON.parse(readFileSync(new URL(`../levels/${file}`, import.meta.url), 'utf8')) as LevelSpec;
      expect(onDisk, file).toEqual(generateLevel(recipe).spec);
    }
  });
});
