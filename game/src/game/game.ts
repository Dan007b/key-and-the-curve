/**
 * Game state and the fixed-timestep simulation: marble, rooms, carried frame,
 * camera. Rendering and input live elsewhere; this module is plain logic and
 * runs headless in tests.
 */

import { angleBetween, carryAcross, wrapAngle } from './transport';
import { Marble, DEFAULT_MARBLE } from './marble';
import type { Collider, MarbleParams } from './marble';
import { loadLevel } from './level';
import type { LevelSpec, LoadedLevel } from './level';
import { POST_RADIUS, WALL_HALF_WIDTH } from './world';
import { locateTile } from '../math/tiling';
import { apply, decompose, distance, logOrigin, lorentzInverse, mul, rotation, translation } from '../math/lorentz';
import type { Mat3 } from '../math/lorentz';
import type { InputSource } from '../input/InputSource';
import { approach, fitDistance, frobenius, identity4, mul4, planeRotation, rotationFromList, twistStep } from '../math/four';
import type { Mat4 } from '../math/four';
import type { GateSpec } from './level';
import { analyzeLock } from './lock';
import type { LockStatus } from './lock';
import { toKlein } from '../math/poincare';
import type { Vec3 } from '../math/lorentz';

/** Physics substep: 240 Hz, so a marble at top speed moves < 0.015 per step. */
export const PHYSICS_DT = 1 / 240;
/** Time constant for easing the camera across a room-boundary jump, s. */
const CAMERA_EASE = 0.25;
/** Extra damping while twisting, so the marble settles instead of drifting. */
const TWIST_BRAKE = 4;

export interface GameSettings {
  marble: MarbleParams;
  /** Gate tolerance τ on the Frobenius fit distance (CLAUDE.md §6.7). */
  tolerance: number;
  /**
   * Settle assist: within 2τ of a fit, if the player stops twisting, the key
   * drifts gently into place. Exact twisting to within ~14° is hard by hand.
   */
  assist: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  marble: { ...DEFAULT_MARBLE },
  tolerance: 0.35,
  assist: true,
};

/** Time constant of the snap into a gate once within τ, s. */
const SNAP_TIME = 0.08;
/** Time constant of the settle assist inside 2τ, s. */
const SETTLE_TIME = 0.45;
/** Twist rates below this (rad/s) count as "not twisting" for the settle assist. */
const SETTLE_IDLE = 0.15;
/** Fit distances are shown relative to this: 2 is a 90° single-plane turn. */
export const FIT_SCALE = 2;

export interface Gate {
  spec: GateSpec;
  /** Target orientation, in the gate's reference frame. */
  target: Mat4;
  /** Wall id of the gate, and the room on its far side. */
  wall: number;
  across: number;
  open: boolean;
}

/** A closed loop that turned the key: emitted when the marble re-enters a room with a new holonomy. */
export interface LoopEvent {
  /** Rotation picked up around this loop, degrees (−72 per counter-clockwise pillar). */
  degrees: number;
  /** Posts (pillars) the loop went around. */
  pillars: number[];
  /** World point to label: the centroid of the enclosed pillars. */
  where: Vec3;
}

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

/** What the HUD and views need to know about the gate the marble is at. */
export interface GateReading {
  index: number;
  /** Key holonomy measured at the gate, rad. */
  holonomy: number;
  /** Fit distance ‖K_eff − target‖_F. */
  distance: number;
  /** The target expressed in the marble's local frame (what the ghost shows). */
  ghost: Mat4;
  /** Per-tumbler guidance (see lock.ts). */
  lock: LockStatus;
}

export class Game {
  level!: LoadedLevel;
  marble = new Marble();
  /** Tile the marble's centre is in. */
  room = 0;
  /** The key's frame at the centre of the current room (see transport.ts). */
  carry!: Mat3;
  /** Display-only rotation that eases out the jump at room boundaries, rad. */
  cameraOffset = 0;
  twistMode = false;
  completed = false;
  /** Seconds since the level started. */
  time = 0;
  /** Largest wall impact speed since the last read (for sound/vibration). */
  lastImpact = 0;
  /** The key's orientation in the marble's local (carried) frame. */
  key: Mat4 = identity4();
  gates: Gate[] = [];
  /** The gate being approached this frame, if any. */
  gateReading: GateReading | null = null;
  /** Gate indices opened since the last read (for sound and the HUD). */
  openedEvents: number[] = [];
  /** Loops closed since the last read. */
  loopEvents: LoopEvent[] = [];
  /** Recent marble positions (world), oldest first, sampled at 30 Hz. */
  trail: Vec3[] = [];
  /** Rooms entered since the last loop closed, with the holonomy on entry. */
  private history: { room: number; holonomy: number }[] = [];
  private trailClock = 0;

  private accumulator = 0;
  private colliders: Collider[] = [];

  constructor(public settings: GameSettings = DEFAULT_SETTINGS) {}

  load(spec: LevelSpec): void {
    this.level = loadLevel(spec);
    const start = this.level.tiling.tiles[spec.start];
    this.marble = new Marble(this.settings.marble);
    this.marble.frame = [...start.frame] as Mat3;
    this.room = spec.start;
    this.carry = [...start.frame] as Mat3;
    this.cameraOffset = 0;
    this.twistMode = false;
    this.completed = false;
    this.time = 0;
    this.accumulator = 0;
    this.key = identity4();
    this.gateReading = null;
    this.openedEvents = [];
    this.loopEvents = [];
    this.trail = [];
    this.trailClock = 0;
    this.history = [{ room: spec.start, holonomy: 0 }];
    const { world, tiling } = this.level;
    this.gates = (spec.gates ?? []).map((g) => ({
      spec: g,
      target: rotationFromList(g.target),
      wall: world.wallOn(g.tile, g.edge),
      across: tiling.tiles[g.tile].neighbors[g.edge],
      open: false,
    }));
    this.rebuildColliders();
  }

  /** Whether the current level lets the player twist the key. */
  twistAllowed(): boolean {
    return this.level.spec.twist !== false;
  }

  /** Walls (except open gates) and posts the marble can touch from its room. */
  rebuildColliders(): void {
    const { world } = this.level;
    this.colliders = [];
    for (const id of world.nearbyWalls[this.room]) {
      const w = world.walls[id];
      if (w.gate !== -1 && this.gateIsOpen(w.gate)) continue;
      this.colliders.push({ kind: 'segment', a: w.a, b: w.b, radius: WALL_HALF_WIDTH });
    }
    for (const id of world.nearbyPosts[this.room]) {
      this.colliders.push({ kind: 'point', p: world.posts[id].position, radius: POST_RADIUS });
    }
  }

  gateIsOpen(gate: number): boolean {
    return this.gates[gate]?.open ?? false;
  }

  /**
   * The key as the gate sees it: K_eff = R_xy(θ)·K_local, where θ is the
   * holonomy measured on the gate's side. This is how the maze's curvature
   * acts on the key (CLAUDE.md §6.7).
   */
  effectiveKey(holonomy: number): Mat4 {
    return mul4(planeRotation('xy', holonomy), this.key);
  }

  /** The closed gate on an edge of the marble's room, nearest first, or −1. */
  private nearbyGate(): number {
    let best = -1;
    let bestDist = Infinity;
    this.gates.forEach((g, i) => {
      if (g.open || (this.room !== g.spec.tile && this.room !== g.across)) return;
      const mid = this.level.tiling.tiles[g.spec.tile].midpoints[g.spec.edge];
      const d = distance(this.marble.position(), mid);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  /** Twist, reset, measure the nearest gate's fit, snap and open it. */
  private updateKey(dt: number, input: InputSource): void {
    const rates = input.angularVelocity();
    if (input.resetKey()) this.key = identity4();
    if (this.twistMode) this.key = twistStep(this.key, rates, dt);

    const index = this.nearbyGate();
    if (index === -1) {
      this.gateReading = null;
      return;
    }
    const gate = this.gates[index];
    const holonomy = this.holonomy(gate.spec.tile);
    const ghost = mul4(planeRotation('xy', -holonomy), gate.target);
    const d = fitDistance(this.effectiveKey(holonomy), gate.target);
    this.gateReading = { index, holonomy, distance: d, ghost, lock: analyzeLock(this.key, holonomy, gate.spec) };
    const idle = !this.twistMode || Math.hypot(rates[0], rates[1], rates[2]) < SETTLE_IDLE;
    if (this.settings.assist && idle && d < 2 * this.settings.tolerance && d >= this.settings.tolerance) {
      // Close, and the player has let go: drift into place.
      this.key = approach(this.key, ghost, 1 - Math.exp(-dt / SETTLE_TIME));
    }
    if (d < this.settings.tolerance) {
      // Within τ: glide onto the exact fit, then open.
      this.key = approach(this.key, ghost, 1 - Math.exp(-dt / SNAP_TIME));
      if (frobenius(this.key, ghost) < 1e-3) {
        this.key = ghost;
        gate.open = true;
        this.openedEvents.push(index);
        this.gateReading = null;
        this.rebuildColliders();
      }
    }
  }

  /** 0 = far, 1 = within τ; ramps up inside 2τ (drives the glow and vibration). */
  gateGlow(): number {
    const r = this.gateReading;
    if (!r) return 0;
    const tau = this.settings.tolerance;
    return Math.max(0, Math.min(1, (2 * tau - r.distance) / tau));
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

  /**
   * Holonomy of the key in the current room: the carried frame's rotation
   * relative to the room's reference frame. Always a multiple of 72° for {5,4}.
   */
  holonomy(room = this.room): number {
    const ref = this.level.references[room];
    return ref ? angleBetween(ref, this.carryInRoom(room)) : 0;
  }

  /** The carried frame as it would be in `room` (the current room or a neighbour). */
  carryInRoom(room: number): Mat3 {
    if (room === this.room) return this.carry;
    return carryAcross(this.level.tiling, this.carry, this.room, room);
  }

  /** Advances the simulation by dt seconds of real time. */
  update(dt: number, input: InputSource): void {
    if (input.twistToggled() && this.twistAllowed()) this.twistMode = !this.twistMode;
    if (!this.twistAllowed()) this.twistMode = false;

    this.accumulator += Math.min(dt, 0.1);
    // Tilt is screen-aligned; physics runs in the marble's own frame M, which
    // differs from the screen frame V by a rotation β at the same point.
    const beta = decompose(mul(lorentzInverse(this.marble.frame), this.viewFrame())).angle;
    const tilt = this.twistMode ? { x: 0, y: 0 } : input.tilt();
    const a = this.settings.marble.accel;
    const ax = a * (Math.cos(beta) * tilt.x - Math.sin(beta) * tilt.y);
    const ay = a * (Math.sin(beta) * tilt.x + Math.cos(beta) * tilt.y);

    while (this.accumulator >= PHYSICS_DT) {
      this.accumulator -= PHYSICS_DT;
      this.time += PHYSICS_DT;
      const impact = this.marble.step(PHYSICS_DT, ax, ay, this.colliders, this.twistMode ? TWIST_BRAKE : 0);
      this.lastImpact = Math.max(this.lastImpact, impact);
      this.trackRoom();
      this.trailClock += PHYSICS_DT;
      if (this.trailClock >= 1 / TRAIL_HZ) {
        this.trailClock = 0;
        this.trail.push(this.marble.position());
        if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
      }
    }
    // Ease the camera back onto the carried frame.
    this.cameraOffset *= Math.exp(-dt / CAMERA_EASE);
    this.updateKey(dt, input);
    this.checkGoal();
  }

  /** Follows the marble from room to room, carrying the key's frame along. */
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
    this.onRoomChange();
  }

  /**
   * Loop detection. Revisiting a room closes a loop; if the key's holonomy
   * changed, the loop enclosed pillars, so report how much and which. Either
   * way the history is cut back, so the next loop is measured fresh.
   */
  private onRoomChange(): void {
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
    // (q − 2)·180° − q·360°/p (72° for {5,4}). Counter-clockwise (positive
    // winding) laps turn the key clockwise.
    const { p, q } = tiling.metrics;
    const perPillar = (q - 2) * 180 - (q * 360) / p;
    const where = pillars
      .map((id) => world.posts[id].position)
      .reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as Vec3, [0, 0, 0] as Vec3);
    const norm = Math.sqrt(Math.max(1e-12, where[2] * where[2] - where[0] * where[0] - where[1] * where[1]));
    this.loopEvents.push({ degrees: -turns * perPillar, pillars, where: [where[0] / norm, where[1] / norm, where[2] / norm] });
  }

  private checkGoal(): void {
    if (this.completed) return;
    const { spec, tiling, metrics } = { ...this.level, metrics: this.level.tiling.metrics };
    if (this.room !== spec.goal) return;
    if (distance(this.marble.position(), tiling.tiles[spec.goal].center) < metrics.inradius * 0.6) {
      this.completed = true;
    }
  }
}
