import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { LEVELS, loadLevel } from '../src/game/level';
import { solveLevelPath } from '../src/game/solver';
import { Tutorial } from '../src/game/tutorial';
import type { TutorialTip } from '../src/game/tutorial';
import { LAYER_NAMES } from '../src/game/phase';
import { followSolution } from './bot';

describe('level 1 tutorial', () => {
  it('walks you through rolling, doors, shards and the portal, in the order you meet them', () => {
    const game = new Game();
    game.load(LEVELS[0]);
    const tutorial = new Tutorial();
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
    expect(followSolution(game, solveLevelPath(loadLevel(LEVELS[0]))!)).toBe(true);
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
