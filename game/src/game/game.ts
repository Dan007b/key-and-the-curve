/**
 * Phase Escape: game state and the fixed-timestep simulation. Rendering and
 * input live elsewhere; this module is plain logic and runs headless in tests.
 *
 * Collect every shard, then reach the exit portal, without being caught three
 * times. The maze is layered in a fourth dimension (phase.ts): doors, shards
 * and hunters each live in one layer, and you change layer by twisting, or by
 * looping pillars and letting the curvature of space turn you.
 */

import { angleBetween, carryAcross, wrapAngle } from './transport';
import { Marble, DEFAULT_MARBLE } from './marble';
import type { Collider, MarbleParams } from './marble';
import { loadLevel } from './level';
import type { LevelSpec, LoadedLevel, ShardSpec } from './level';
import { POST_RADIUS, WALL_HALF_WIDTH } from './world';
import { Hunter, HUNTER_RADIUS } from './hunter';
import { LAYER_DEG, holonomySteps, layerOf } from './phase';
import { passageKey } from './maze';
import { makeRng } from './random';
import { locateTile } from '../math/tiling';
import { apply, decompose, distance, logOrigin, lorentzInverse, mul, rotation, translation } from '../math/lorentz';
import type { Mat3, Vec3 } from '../math/lorentz';
import { toKlein } from '../math/poincare';
import type { InputSource } from '../input/InputSource';

/** Physics substep: 240 Hz, so a marble at top speed moves < 0.015 per step. */
export const PHYSICS_DT = 1 / 240;
/** Time constant for easing the camera across a room-boundary jump, s. */
const CAMERA_EASE = 0.25;
/** Time constant for a keyboard/BOOT phase step to glide to the next layer, s. */
const PHASE_EASE = 0.07;
export const LIVES = 3;
/** Seconds of protection after being hit. */
const INVULNERABLE = 2;
/** Pick-up radius for shards, and the portal's catch radius as a fraction of the room. */
const SHARD_RADIUS = 0.32;
const PORTAL_FRACTION = 0.55;
/** Hunter speed grows by this fraction per second, up to MAX_HUNTER_SPEED. */
const HUNTER_RAMP = 0.025;
const MAX_HUNTER_SPEED = 2.4;

export interface GameSettings {
  marble: MarbleParams;
}

export const DEFAULT_SETTINGS: GameSettings = {
  marble: { ...DEFAULT_MARBLE },
};

/** A closed loop that turned your frame: emitted when you re-enter a room with a new holonomy. */
export interface LoopEvent {
  /** Rotation picked up around this loop, degrees (−72 per counter-clockwise pillar). */
  degrees: number;
  /** Posts (pillars) the loop went around. */
  pillars: number[];
  /** World point to label: the centroid of the enclosed pillars. */
  where: Vec3;
}

export interface PhaseEvent {
  from: number;
  to: number;
  /** 'twist' when you dialled it, 'curvature' when a loop moved you. */
  cause: 'twist' | 'curvature';
}

export type GameStatus = 'playing' | 'won' | 'lost';

/** Trail samples per second, and how many are kept (30 s). */
const TRAIL_HZ = 30;
export const TRAIL_LENGTH = 900;

/**
 * Winding number of a closed polygon (Klein-disk points) around point q.
 * Geodesics are straight lines in the Klein model, so the polygon through
 * room centres is drawn exactly.
 */
export function windingNumber(poly: readonly [number, number][], q: readonly [number, number]): number {
  let w = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const isLeft = (x2 - x1) * (q[1] - y1) - (q[0] - x1) * (y2 - y1);
    if (y1 <= q[1]) {
      if (y2 > q[1] && isLeft > 0) w++;
    } else if (y2 <= q[1] && isLeft < 0) {
      w--;
    }
  }
  return w;
}

export class Game {
  level!: LoadedLevel;
  marble = new Marble();
  /** Tile the marble's centre is in. */
  room = 0;
  /** Your frame at the centre of the current room, carried along room centres (transport.ts). */
  carry!: Mat3;
  /** Display-only rotation that eases out the jump at room boundaries, rad. */
  cameraOffset = 0;
  /** Seconds since the level started. */
  time = 0;
  status: GameStatus = 'playing';

  /** Phase you have dialled in yourself, degrees (continuous while twisting). */
  twistDeg = 0;
  /** Where the twist settles when you let go: a whole number of layers. */
  private twistTarget = 0;
  /** The layer of the fourth dimension you are in, 0..4. */
  layer = 0;

  lives = LIVES;
  /** Seconds of protection left after a hit. */
  invulnerable = 0;
  shards: { spec: ShardSpec; collected: boolean }[] = [];
  hunters: Hunter[] = [];

  // Events since the last read (sound, HUD); the caller empties them.
  phaseEvents: PhaseEvent[] = [];
  pickupEvents: number[] = [];
  hitEvents = 0;
  /** Shifters that changed layer: which hunter, and the layer it moved into. */
  shiftEvents: { hunter: number; to: number }[] = [];
  loopEvents: LoopEvent[] = [];
  /** Largest wall impact speed since the last read. */
  lastImpact = 0;
  /** Recent marble positions (world), oldest first, sampled at 30 Hz. */
  trail: Vec3[] = [];

  private accumulator = 0;
  private colliders: Collider[] = [];
  private history: { room: number; holonomy: number }[] = [];
  private trailClock = 0;

  constructor(public settings: GameSettings = DEFAULT_SETTINGS) {}

  load(spec: LevelSpec): void {
    this.level = loadLevel(spec);
    const start = this.level.tiling.tiles[spec.start];
    this.marble = new Marble(this.settings.marble);
    this.marble.frame = [...start.frame] as Mat3;
    this.room = spec.start;
    this.carry = [...start.frame] as Mat3;
    this.cameraOffset = 0;
    this.time = 0;
    this.status = 'playing';
    this.accumulator = 0;
    this.twistDeg = 0;
    this.twistTarget = 0;
    this.layer = 0;
    this.lives = LIVES;
    this.invulnerable = 0;
    this.shards = spec.shards.map((s) => ({ spec: s, collected: false }));
    const rand = makeRng(spec.seed * 7919 + 1);
    // Hunters are shadows: they drift through doors of any colour, but not through solid walls.
    const graph = { tiling: this.level.tiling, passable: (a: number, b: number) => this.passable(a, b, -2) || this.isDoor(a, b) };
    this.hunters = spec.hunters.map(
      (h) => new Hunter(h.layer, h.tile, graph, rand, h.shiftEvery ? { every: h.shiftEvery, step: h.shiftStep ?? 1 } : null),
    );
    this.phaseEvents = [];
    this.pickupEvents = [];
    this.hitEvents = 0;
    this.shiftEvents = [];
    this.loopEvents = [];
    this.trail = [];
    this.trailClock = 0;
    this.history = [{ room: spec.start, holonomy: 0 }];
    this.rebuildColliders();
  }

  /** Whether the current level lets you twist through the fourth dimension. */
  twistAllowed(): boolean {
    return this.level.spec.twist !== false;
  }

  /** Whether you can pass between adjacent rooms a and b while in `layer`. */
  passable(a: number, b: number, layer: number): boolean {
    const { maze, world, tiling } = this.level;
    if (maze.isRoom[a] !== 1 || maze.isRoom[b] !== 1 || !maze.open.has(passageKey(a, b))) return false;
    const id = world.wallOn(a, tiling.tiles[a].neighbors.indexOf(b));
    return id === -1 || world.walls[id].door === layer;
  }

  /** Whether the passage between adjacent rooms a and b is a door (of any colour). */
  isDoor(a: number, b: number): boolean {
    const { world, tiling, maze } = this.level;
    if (maze.isRoom[a] !== 1 || maze.isRoom[b] !== 1) return false;
    const id = world.wallOn(a, tiling.tiles[a].neighbors.indexOf(b));
    return id !== -1 && world.walls[id].door !== -1;
  }

  /** Walls (minus doors open in your layer) and posts the marble can touch from its room. */
  rebuildColliders(): void {
    const { world } = this.level;
    this.colliders = [];
    for (const id of world.nearbyWalls[this.room]) {
      const w = world.walls[id];
      if (w.door === this.layer) continue;
      this.colliders.push({ kind: 'segment', a: w.a, b: w.b, radius: WALL_HALF_WIDTH });
    }
    for (const id of world.nearbyPosts[this.room]) {
      this.colliders.push({ kind: 'point', p: world.posts[id].position, radius: POST_RADIUS });
    }
  }

  /**
   * The display frame: the carried frame translated from the room centre to
   * the marble, plus the easing offset. Its origin is the marble; its axes are
   * the screen axes.
   */
  viewFrame(withOffset = true): Mat3 {
    const local = apply(lorentzInverse(this.carry), this.marble.position());
    const [ux, uy] = logOrigin(local);
    const v = mul(this.carry, translation(ux, uy));
    return withOffset ? mul(v, rotation(this.cameraOffset)) : v;
  }

  /** Holonomy in the current room: the carried frame's turn relative to the direct route (multiple of 72°). */
  holonomy(): number {
    const ref = this.level.references[this.room];
    return ref ? angleBetween(ref, this.carry) : 0;
  }

  /** Your phase as one continuous angle (degrees): twist plus curvature. Drives the phase ring. */
  phaseDeg(): number {
    return this.twistDeg + holonomySteps(this.holonomy()) * LAYER_DEG;
  }

  shardsLeft(): number {
    return this.shards.filter((s) => !s.collected).length;
  }

  exitOpen(): boolean {
    return this.shardsLeft() === 0;
  }

  /**
   * 0..1: how close the nearest hunter in your layer is (1 = touching). A
   * shifter about to move into your layer counts too, at a lower weight, so
   * the warning glow starts before it can see you.
   */
  danger(): number {
    let best = 0;
    for (const h of this.hunters) {
      const weight = h.layer === this.layer ? 1 : h.aboutToShift() && h.nextLayer === this.layer ? 0.6 : 0;
      if (weight === 0) continue;
      const d = distance(h.position, this.marble.position());
      best = Math.max(best, weight * (1 - Math.min(1, Math.max(0, d - 0.3) / 1.5)));
    }
    return best;
  }

  /** Current hunter chase speed (units/s). */
  hunterSpeed(): number {
    return Math.min(MAX_HUNTER_SPEED, (this.level.spec.hunterSpeed ?? 0.8) * (1 + HUNTER_RAMP * this.time));
  }

  /** Advances the simulation by dt seconds of real time. */
  update(dt: number, input: InputSource): void {
    if (this.status !== 'playing') return;
    dt = Math.min(dt, 0.1);
    this.updateTwist(dt, input);

    this.accumulator += dt;
    // Tilt is screen-aligned; physics runs in the marble's own frame M, which
    // differs from the screen frame V by a rotation β at the same point.
    const beta = decompose(mul(lorentzInverse(this.marble.frame), this.viewFrame())).angle;
    const tilt = input.tilt();
    const a = this.settings.marble.accel;
    const ax = a * (Math.cos(beta) * tilt.x - Math.sin(beta) * tilt.y);
    const ay = a * (Math.sin(beta) * tilt.x + Math.cos(beta) * tilt.y);
    while (this.accumulator >= PHYSICS_DT) {
      this.accumulator -= PHYSICS_DT;
      this.time += PHYSICS_DT;
      this.lastImpact = Math.max(this.lastImpact, this.marble.step(PHYSICS_DT, ax, ay, this.colliders));
      this.trackRoom();
      this.trailClock += PHYSICS_DT;
      if (this.trailClock >= 1 / TRAIL_HZ) {
        this.trailClock = 0;
        this.trail.push(this.marble.position());
        if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
      }
    }
    this.cameraOffset *= Math.exp(-dt / CAMERA_EASE);
    this.updateLayer('twist');
    this.updateHunters(dt);
    this.collectShards();
    this.checkExit();
  }

  /** Twist input: whole steps glide to the next layer; a continuous twist follows the controller, then settles. */
  private updateTwist(dt: number, input: InputSource): void {
    let steps = input.phaseSteps();
    let rate = input.phaseRate();
    if (!this.twistAllowed()) {
      steps = 0;
      rate = 0;
    }
    if (steps !== 0) this.twistTarget = Math.round(this.twistTarget / LAYER_DEG) * LAYER_DEG + steps * LAYER_DEG;
    if (Math.abs(rate) > 1e-6) {
      this.twistDeg += rate * dt;
      this.twistTarget = Math.round(this.twistDeg / LAYER_DEG) * LAYER_DEG;
    } else {
      this.twistDeg += (this.twistTarget - this.twistDeg) * (1 - Math.exp(-dt / PHASE_EASE));
    }
  }

  /** Recomputes your layer; emits an event (and swaps the doors) when it changes. */
  private updateLayer(cause: PhaseEvent['cause']): void {
    const layer = layerOf(this.twistDeg, holonomySteps(this.holonomy()));
    if (layer === this.layer) return;
    this.phaseEvents.push({ from: this.layer, to: layer, cause });
    this.layer = layer;
    this.rebuildColliders();
  }

  private updateHunters(dt: number): void {
    if (this.invulnerable > 0) this.invulnerable = Math.max(0, this.invulnerable - dt);
    const speed = this.hunterSpeed();
    const me = this.marble.position();
    for (const [i, h] of this.hunters.entries()) {
      const before = h.layer;
      h.setTime(this.time);
      if (h.layer !== before) this.shiftEvents.push({ hunter: i, to: h.layer });
      h.update(dt, speed, me, this.room, h.layer === this.layer);
      if (h.layer !== this.layer || this.invulnerable > 0) continue;
      if (distance(h.position, me) < this.settings.marble.radius + HUNTER_RADIUS) {
        this.lives--;
        this.hitEvents++;
        this.invulnerable = INVULNERABLE;
        h.respawn();
        if (this.lives <= 0) this.status = 'lost';
      }
    }
  }

  private collectShards(): void {
    const me = this.marble.position();
    this.shards.forEach((s, i) => {
      if (s.collected || s.spec.layer !== this.layer) return;
      if (distance(me, this.level.tiling.tiles[s.spec.tile].center) < SHARD_RADIUS) {
        s.collected = true;
        this.pickupEvents.push(i);
      }
    });
  }

  private checkExit(): void {
    if (!this.exitOpen() || this.room !== this.level.spec.exit) return;
    const { tiling } = this.level;
    if (distance(this.marble.position(), tiling.tiles[this.room].center) < tiling.metrics.inradius * PORTAL_FRACTION) {
      this.status = 'won';
    }
  }

  /** Follows the marble from room to room, carrying its frame along. */
  private trackRoom(): void {
    const { tiling } = this.level;
    const next = locateTile(tiling, this.marble.position(), this.room);
    if (next === this.room) return;
    const before = this.viewFrame(false);
    this.carry = carryAcross(tiling, this.carry, this.room, next);
    this.room = next;
    // Keep the picture continuous: absorb the frame jump into the offset.
    this.cameraOffset = wrapAngle(this.cameraOffset + angleBetween(this.viewFrame(false), before));
    this.rebuildColliders();
    this.detectLoop();
    // A loop may have turned you into another layer.
    this.updateLayer('curvature');
  }

  /**
   * Loop detection. Revisiting a room closes a loop; if the holonomy changed,
   * the loop enclosed pillars, so report how much and which.
   */
  private detectLoop(): void {
    const holonomy = this.holonomy();
    const i = this.history.findIndex((h) => h.room === this.room);
    if (i === -1) {
      this.history.push({ room: this.room, holonomy });
      return;
    }
    const loopRooms = [...this.history.slice(i).map((h) => h.room), this.room];
    const delta = wrapAngle(holonomy - this.history[i].holonomy);
    this.history = this.history.slice(0, i + 1);
    this.history[i].holonomy = holonomy;
    if (Math.abs(delta) < 1e-6 && loopRooms.length < 5) return;
    this.reportLoop(loopRooms);
  }

  private reportLoop(rooms: number[]): void {
    const { tiling, world } = this.level;
    const poly = rooms.slice(0, -1).map((r) => toKlein(tiling.tiles[r].center));
    const candidates = new Set(rooms.flatMap((r) => world.roomPosts[r]));
    const pillars: number[] = [];
    let turns = 0;
    for (const id of candidates) {
      const w = windingNumber(poly, toKlein(world.posts[id].position));
      if (w !== 0) {
        pillars.push(id);
        turns += w;
      }
    }
    if (turns === 0) return;
    // Each pillar contributes the area of the dual polygon around it: q rooms
    // meet there, and that q-gon has corners of 2π/p, so its area is
    // (q − 2)·180° − q·360°/p (72° for {5,4}). Counter-clockwise laps turn you clockwise.
    const { p, q } = tiling.metrics;
    const perPillar = (q - 2) * 180 - (q * 360) / p;
    const sum = pillars
      .map((id) => world.posts[id].position)
      .reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as Vec3, [0, 0, 0] as Vec3);
    const n = Math.sqrt(Math.max(1e-12, sum[2] * sum[2] - sum[0] * sum[0] - sum[1] * sum[1]));
    this.loopEvents.push({ degrees: -turns * perPillar, pillars, where: [sum[0] / n, sum[1] / n, sum[2] / n] });
  }
}
