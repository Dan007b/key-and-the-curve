import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { levelNamed, loadLevel } from '../src/game/level';
import { solveLevelPath } from '../src/game/solver';
import { Tutorial } from '../src/game/tutorial';
import type { TutorialTip } from '../src/game/tutorial';
import { LAYER_NAMES } from '../src/game/phase';
import { followSolution, idle, phaseTo } from './bot';

describe('level 1 tutorial', () => {
  it('walks you through rolling, doors, shards and the portal, in the order you meet them', () => {
    const game = new Game();
    game.load(levelNamed('Slip'));
    const tutorial = new Tutorial('Slip');
    const tips: TutorialTip[] = [];
    const watch = () => {
      const tip = tutorial.update(game);
      if (tip && tips[tips.length - 1]?.id !== tip.id) tips.push(tip);
      return tip;
    };
    expect(watch()?.id).toBe('roll');
    // Look at the tip every frame, as the game does.
    const update = game.update.bind(game);
    game.update = (dt, input) => {
      update(dt, input);
      watch();
    };
    expect(followSolution(game, solveLevelPath(loadLevel(levelNamed('Slip')))!)).toBe(true);
    expect(game.status).toBe('won');
    expect(watch()).toBeNull();
    const ids = tips.map((t) => t.id);
    expect(ids[0]).toBe('roll');
    expect(ids).toContain('door');
    expect(ids).toContain('shard');
    expect(ids[ids.length - 1]).toBe('portal');
    // Door and shard tips name the colour they need, and point at the thing.
    for (const t of tips.filter((x) => x.id === 'door' || x.id === 'shard')) {
      expect(t.layer).not.toBeNull();
      expect(t.text.toLowerCase()).toContain(LAYER_NAMES[t.layer!].toLowerCase());
      expect(t.anchor).not.toBeNull();
    }
  });
});

describe('Rift and Hunted tips', () => {
  it('Rift: explains the 4D plank while you line it up, until the first bridge', () => {
    const spec = levelNamed('Rift');
    const game = new Game();
    game.load(spec);
    const tutorial = new Tutorial('Rift');
    const ids = new Set<string>();
    const update = game.update.bind(game);
    game.update = (dt, input) => {
      update(dt, input);
      const tip = tutorial.update(game);
      if (tip) ids.add(tip.id);
      if (tip?.id === 'rift') expect(game.riftFocus).not.toBeNull();
    };
    expect(followSolution(game, solveLevelPath(loadLevel(spec))!)).toBe(true);
    expect(ids.has('rift')).toBe(true);
    expect(ids.has('portal')).toBe(true);
    expect(ids.has('roll')).toBe(false); // Slip already taught rolling
  });

  it('Hunted: warns you when a hunter of your colour is close, then explains it is a ghost once you phase', () => {
    const game = new Game();
    game.load(levelNamed('Hunted'));
    const tutorial = new Tutorial('Hunted');
    const hunter = game.hunters[0];
    expect(tutorial.update(game)?.id ?? null).not.toBe('ghost');
    // Bring the hunter close, in your colour.
    phaseTo(game, hunter.layer);
    hunter.position = game.level.tiling.tiles[game.level.tiling.tiles[game.room].neighbors.find((n) => n !== -1)!].center;
    const warn = tutorial.update(game);
    expect(warn?.id).toBe('hunter');
    expect(warn?.text).toContain(LAYER_NAMES[hunter.layer].toLowerCase());
    // Phase away: now it's a ghost, and the tip says so for a few seconds.
    phaseTo(game, (hunter.layer + 2) % 5);
    expect(tutorial.update(game)?.id).toBe('ghost');
    idle(game, 5.5);
    expect(tutorial.update(game)?.id ?? null).not.toBe('ghost');
  });

  it('other levels have no tips', () => {
    expect(new Tutorial('Escape').active()).toBe(false);
  });
});
