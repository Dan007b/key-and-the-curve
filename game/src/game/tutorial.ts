/**
 * Tutorial tips for the levels that introduce something: one short tip at a
 * time, chosen from what is around you right now rather than a fixed script,
 * so it never asks for something you can't do yet.
 *
 * Tips, most urgent first (each level uses some of them):
 * - roll: how to move (until you have rolled a little way);
 * - hunter: a hunter of your colour is close: it can see and hit you, so
 *   change colour (until you have got away from one by phasing);
 * - ghost: just after that, why it is harmless now (shown for a few seconds);
 * - rift: a rift is in reach: turn your 4D view until its plank lies flat
 *   (until you have bridged one);
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

export type TipId = 'roll' | 'hunter' | 'ghost' | 'rift' | 'portal' | 'door' | 'shard' | 'goal';

export interface TutorialTip {
  id: TipId;
  text: string;
  /** World point the tip is about (a door, a shard, a hunter, a rift, the portal), or null. */
  anchor: Vec3 | null;
  /** The colour the tip is about (0..4), for tinting the marker, or null. */
  layer: number | null;
}

/** Which tips each teaching level uses. Other levels get none. */
export const TUTORIAL_TIPS: Record<string, TipId[]> = {
  Slip: ['roll', 'portal', 'door', 'shard', 'goal'],
  Rift: ['rift', 'portal', 'shard'],
  Hunted: ['hunter', 'ghost', 'portal'],
};

/** How far (hyperbolic units) a door or shard can be and still get a tip. */
const NEAR = 1.6;
/** A hunter this close and in your colour is worth a warning. */
const HUNTER_NEAR = 2.5;
/** Rolling this far from the start teaches rolling. */
const ROLLED = 0.6;
/** How long the "it's a ghost now" tip stays up, s. */
const GHOST_TIP = 5;
const PHASE_KEYS = 'Q / E (or turn the controller like a dial)';
const LOOK_KEYS = 'hold Shift and press the arrow keys (or hold BOOT and tilt the controller)';

export class Tutorial {
  private readonly tips: Set<TipId>;
  private readonly learned = new Set<TipId>();
  private lastRoom = -1;
  /** The colour of the hunter you were last warned about (−1: none), and until when the ghost tip shows. */
  private warnedLayer = -1;
  private ghostUntil = -1;

  constructor(levelName: string) {
    this.tips = new Set(TUTORIAL_TIPS[levelName] ?? []);
  }

  /** Whether this level has any tips. */
  active(): boolean {
    return this.tips.size > 0;
  }

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
    if (game.bridged.size > 0) this.learned.add('rift');
    const seen = game.huntersSeeingYou(HUNTER_NEAR);
    if (this.warnedLayer !== -1 && layer !== this.warnedLayer && seen.length === 0) {
      // You phased away from the hunter you were warned about: that's the lesson.
      this.learned.add('hunter');
      this.ghostUntil = game.time + GHOST_TIP;
      this.warnedLayer = -1;
    }
    if (this.ghostUntil !== -1 && game.time > this.ghostUntil) this.learned.add('ghost');

    if (game.status !== 'playing') return null;
    const want = (id: TipId) => this.tips.has(id) && !this.learned.has(id);

    if (want('roll')) {
      return { id: 'roll', text: 'Roll the marble: arrow keys or WASD, hold the mouse on the disk, or tilt the controller.', anchor: null, layer: null };
    }
    if (want('hunter') && seen.length > 0) {
      const h = seen[0];
      this.warnedLayer = h.layer;
      const c = colour(h.layer);
      return {
        id: 'hunter',
        text: `This hunter is ${c}, and so are you: it can see you (the line) and touching you costs a life. Press ${PHASE_KEYS} to change colour.`,
        anchor: h.position,
        layer: h.layer,
      };
    }
    if (this.tips.has('ghost') && this.learned.has('hunter') && !this.learned.has('ghost')) {
      return {
        id: 'ghost',
        text: `You're ${colour(layer)} now, so the hunters are faint ghosts: they can't see you or touch you. A hunter is only dangerous in its own colour.`,
        anchor: null,
        layer: null,
      };
    }
    if (want('rift') && game.riftFocus) {
      const w = world.walls[game.riftFocus.wall];
      const text = game.riftFocus.smear < 0.1
        ? 'Almost flat. Let go and it settles onto the crack.'
        : `A rift. The plank over it is four-dimensional, so you only see its shadow, smeared by its gold 4th-dimension edges. To turn your view into the 4th dimension, ${LOOK_KEYS}, until the plank lies flat across the crack.`;
      return { id: 'rift', text, anchor: tiling.tiles[w.tile].midpoints[w.edge], layer: null };
    }
    if (this.tips.has('portal') && game.exitOpen()) {
      return { id: 'portal', text: 'Every shard collected: the portal is open. Roll into it!', anchor: tiling.tiles[spec.exit].center, layer: null };
    }
    if (want('door')) {
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
    if (want('shard')) {
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
    if (want('goal')) {
      return { id: 'goal', text: 'Find every shard ◆ (counted at the top), then roll into the portal. Coloured doors and shards need their own colour.', anchor: null, layer: null };
    }
    return null;
  }
}
