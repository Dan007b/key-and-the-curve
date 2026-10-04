/**
 * The level 1 tutorial: one short tip at a time, chosen from what is around
 * you right now rather than a fixed script, so it never asks for something
 * you can't do yet.
 *
 * Tips, most urgent first:
 * - roll: how to move (until you have rolled a little way);
 * - portal: once every shard is in, roll into the portal;
 * - door: a coloured door is next to you: phase to its colour, roll through
 *   (until you have been through a door);
 * - shard: a shard is near: phase to its colour, roll over it (until you have
 *   picked up one that needed a phase);
 * - goal: otherwise, what you are looking for (until the first shard).
 *
 * Plain logic over the game state; the HUD draws the tip and a marker at its
 * anchor.
 */

import type { Game } from './game';
import { LAYER_NAMES } from './phase';
import { distance } from '../math/lorentz';
import type { Vec3 } from '../math/lorentz';

export interface TutorialTip {
  id: 'roll' | 'portal' | 'door' | 'shard' | 'goal';
  text: string;
  /** World point the tip is about (a door, a shard, the portal), or null. */
  anchor: Vec3 | null;
  /** The colour the tip is about (0..4), for tinting the marker, or null. */
  layer: number | null;
}

/** How far (hyperbolic units) a door or shard can be and still get a tip. */
const NEAR = 1.6;
/** Rolling this far from the start teaches rolling. */
const ROLLED = 0.6;
const PHASE_KEYS = 'Q / E (or turn the controller like a dial)';

export class Tutorial {
  private readonly learned = new Set<TutorialTip['id']>();
  private lastRoom = -1;

  /** The tip to show now, or null. Call once per frame while playing. */
  update(game: Game): TutorialTip | null {
    const { tiling, world, spec } = game.level;
    const me = game.marble.position();
    const layer = game.layer;
    const colour = (l: number) => LAYER_NAMES[l].toLowerCase();

    // Learn from what just happened.
    if (this.lastRoom !== -1 && game.room !== this.lastRoom && game.isDoor(this.lastRoom, game.room)) this.learned.add('door');
    this.lastRoom = game.room;
    if (distance(me, tiling.tiles[spec.start].center) > ROLLED) this.learned.add('roll');
    if (game.shards.some((s) => s.collected)) this.learned.add('goal');
    // A shard in your starting colour teaches nothing about phasing: keep the tip until one that needed it.
    if (game.shards.some((s) => s.collected && s.spec.layer !== 0)) this.learned.add('shard');

    if (game.status !== 'playing') return null;
    if (!this.learned.has('roll')) {
      return { id: 'roll', text: 'Roll the marble: arrow keys or WASD, hold the mouse on the disk, or tilt the controller.', anchor: null, layer: null };
    }
    if (game.exitOpen()) {
      return { id: 'portal', text: 'Every shard collected: the portal is open. Roll into it!', anchor: tiling.tiles[spec.exit].center, layer: null };
    }
    if (!this.learned.has('door')) {
      let best: { at: Vec3; door: number; d: number } | null = null;
      for (const id of world.nearbyWalls[game.room]) {
        const w = world.walls[id];
        if (w.door === -1) continue;
        const at = tiling.tiles[w.tile].midpoints[w.edge];
        const d = distance(me, at);
        if (d < NEAR && (!best || d < best.d)) best = { at, door: w.door, d };
      }
      if (best) {
        const c = colour(best.door);
        const text = best.door === layer
          ? `You're ${c} now, so the ${c} door is open. Roll straight through it.`
          : `A ${c} door. Doors only open in their own colour: press ${PHASE_KEYS} until the world turns ${c}.`;
        return { id: 'door', text, anchor: best.at, layer: best.door };
      }
    }
    if (!this.learned.has('shard')) {
      let best: { at: Vec3; layer: number; d: number } | null = null;
      for (const s of game.shards) {
        if (s.collected) continue;
        const at = tiling.tiles[s.spec.tile].center;
        const d = distance(me, at);
        if (d < NEAR && (!best || d < best.d)) best = { at, layer: s.spec.layer, d };
      }
      if (best) {
        const c = colour(best.layer);
        const text = best.layer === layer
          ? `A ${c} shard, and you're ${c}: roll over it to grab it.`
          : `A ${c} shard ◆. You can only grab it while you're ${c}: press ${PHASE_KEYS}.`;
        return { id: 'shard', text, anchor: best.at, layer: best.layer };
      }
    }
    if (!this.learned.has('goal')) {
      return { id: 'goal', text: 'Find every shard ◆ (counted at the top), then roll into the portal. Coloured doors and shards need their own colour.', anchor: null, layer: null };
    }
    return null;
  }
}
