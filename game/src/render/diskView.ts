/**
 * Main view: the hyperbolic plane in the Poincaré disk, always centred on
 * the marble and using its carried frame as the screen axes. After a loop the
 * whole world appears rotated: that is the holonomy, made visible.
 *
 * Phase Escape layers: the world is tinted by the layer you are in; doors and
 * shards of other layers are drawn solid, those of your layer are ghosts (or
 * pick-up-able); hunters of other layers are translucent.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { apply, expOrigin, identity, mul, rotation, translationTo } from '../math/lorentz';
import type { Mat3, ReadonlyMat3, Vec3 } from '../math/lorentz';
import { toPoincare } from '../math/poincare';
import { segmentFrame } from '../math/geodesic';
import { TESSERACT_EDGES, TESSERACT_VERTICES, plankOrientation, shadowAxes } from '../math/four';
import type { Tiling } from '../math/tiling';
import { HyperMesh, dashedRing, geodesicBand, hyperDisk, hyperRing, polygonFan, softGeodesicBand } from './hyperMesh';
import type { World } from '../game/world';
import { POST_RADIUS, WALL_HALF_WIDTH } from '../game/world';
import type { LevelSpec } from '../game/level';
import { BRIDGE_SMEAR, PLANK_EXTENTS, TRAIL_LENGTH } from '../game/game';
import { HUNTER_RADIUS } from '../game/hunter';
import { LAYER_RGB } from '../game/phase';

/** Tiles farther than this from the view centre are skipped: they sit within 0.8% of the rim (a few pixels). */
const CULL_DISTANCE = 5.5;
const CULL_COSH = Math.cosh(CULL_DISTANCE);

/** Brightness falloff with distance, so the eye reads depth towards the rim. */
export function distanceShade(d: number): number {
  return 1 / (1 + 0.22 * d * d);
}

export interface EdgeRef {
  tile: number;
  edge: number;
}

/** Every edge of the tiling exactly once (owned by the lower-indexed tile). */
export function uniqueEdges(tiling: Tiling): EdgeRef[] {
  const edges: EdgeRef[] = [];
  tiling.tiles.forEach((t, i) => {
    t.neighbors.forEach((j, k) => {
      if (j === -1 || i < j) edges.push({ tile: i, edge: k });
    });
  });
  return edges;
}

type RGB = [number, number, number];

export const COLORS = {
  background: 0x05060a,
  void: [0.045, 0.055, 0.09] as RGB,
  room: [0.13, 0.16, 0.26] as RGB,
  start: [0.12, 0.2, 0.24] as RGB,
  grid: [0.2, 0.25, 0.38] as RGB,
  wall: [0.82, 0.9, 1.0] as RGB,
  wallGlow: [0.18, 0.28, 0.45] as RGB,
  post: [0.86, 0.93, 1.0] as RGB,
};

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Per-frame state the view needs from the game. */
export interface ViewState {
  time: number;
  /** The layer you are in (0..4). */
  layer: number;
  shards: { position: Vec3; layer: number; collected: boolean }[];
  hunters: {
    position: Vec3;
    layer: number;
    chasing: boolean;
    /** Shifters change layer on a timetable; nextLayer is where they go next. */
    shifter: boolean;
    nextLayer: number;
    /** 0 normally; rises 0 → 1 over the warning window before a shift. */
    warning: number;
  }[];
  exit: { position: Vec3; open: boolean };
  /** Seconds of post-hit protection left (the marble blinks). */
  invulnerable: number;
  /** Post ids to pulse (marked pillars, loop labels). */
  highlightPosts: Set<number>;
  /** Recent marble positions (world), oldest first, or null to hide the trail. */
  trail: readonly Vec3[] | null;
  /** Your 4D view, [xw, yw] degrees. */
  look: readonly [number, number];
  /** Rifts already bridged (wall ids). */
  bridged: ReadonlySet<number>;
  /** The rift being lined up and how flat its plank is, or null. */
  riftFocus: { wall: number; smear: number } | null;
}

/** Rift glow and plank colours: cyan for the plank's x, y edges, gold for its w edges (the fourth dimension). */
const RIFT_RGB: RGB = [0.45, 0.95, 1.0];
const PLANK_W_RGB: RGB = [1.0, 0.8, 0.3];
const BRIDGE_RGB: RGB = [0.75, 0.97, 1.0];
/** Most hunters any level has, for the sight-line buffer. */
const SIGHT_CAPACITY = 16;
/** Plank edges drawn per rift: the tesseract's 32 minus the 8 along z, which never show in the floor's shadow. */
const PLANK_EDGES = TESSERACT_EDGES.filter((e) => e.axis !== 2);

export class DiskView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  /** Disk radius in CSS pixels, for mapping disk coordinates to the screen. */
  diskRadiusPx = 1;
  /** Disk centre in CSS pixels. */
  centerPx = { x: 0, y: 0 };
  private size = { width: 1, height: 1 };

  private world: World | null = null;
  private spec: LevelSpec | null = null;
  private tileBase: RGB[] = [];
  private gridEdges: EdgeRef[] = [];
  private meshes: HyperMesh[] = [];
  private fills!: HyperMesh;
  private grid!: HyperMesh;
  private wallGlow!: HyperMesh;
  private walls!: HyperMesh;
  private doorGlow!: HyperMesh;
  private doors!: HyperMesh;
  private posts!: HyperMesh;
  private shards!: HyperMesh;
  private hunterBodies!: HyperMesh;
  private hunterHalos!: HyperMesh;
  private hunterCores!: HyperMesh;
  private hunterShift!: HyperMesh;
  private portal!: HyperMesh;
  private riftGlow!: HyperMesh;
  private riftCore!: HyperMesh;
  private bridges!: HyperMesh;
  /** Canonical edge's midpoint frame (x along the edge, y across): planks are drawn in it. */
  private edgeFrame: Mat3 = identity();
  private readonly planks: LineSegments2;
  /** A line from you to every hunter that shares your colour: the ones that can see and hit you. */
  private readonly sight: LineSegments2;
  private readonly sightGeometry: LineSegmentsGeometry;
  private readonly plankGeometry: LineSegmentsGeometry;
  private plankCapacity = 0;
  private readonly tileMatrices: Mat3[] = [];
  private readonly tileVisible: boolean[] = [];
  private readonly tmp: Mat3 = identity();
  private readonly marble: THREE.Group;
  private readonly marbleBody: THREE.Mesh;
  private readonly phaseRing: THREE.Mesh;
  private readonly trail: LineSegments2;
  private readonly trailGeometry: LineSegmentsGeometry;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(COLORS.background, 1);
    this.renderer.autoClear = false;

    // Disk background and rim, in plain screen (disk) coordinates.
    const disk = new THREE.Mesh(new THREE.CircleGeometry(1, 128), new THREE.MeshBasicMaterial({ color: 0x070910 }));
    disk.renderOrder = -10;
    const rim = new THREE.Mesh(new THREE.RingGeometry(1, 1.006, 256), new THREE.MeshBasicMaterial({ color: 0x3a4a6e }));
    rim.renderOrder = 100;
    this.scene.add(disk, rim);

    // The marble always sits at the centre of the disk, wearing its layer's colour.
    this.marble = new THREE.Group();
    this.marbleBody = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.MeshBasicMaterial({ color: 0xf4f7ff, transparent: true, depthTest: false }),
    );
    const shine = new THREE.Mesh(
      new THREE.CircleGeometry(0.35, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }),
    );
    shine.position.set(-0.3, 0.3, 0);
    this.phaseRing = new THREE.Mesh(
      new THREE.RingGeometry(1.25, 1.55, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }),
    );
    for (const m of [this.marbleBody, shine, this.phaseRing]) m.renderOrder = 50;
    this.marble.add(this.phaseRing, this.marbleBody, shine);
    this.scene.add(this.marble);

    // The holonomy trail: the marble's recent path, fading with age.
    this.trailGeometry = new LineSegmentsGeometry();
    this.trailGeometry.setPositions(new Float32Array(TRAIL_LENGTH * 6));
    this.trailGeometry.setColors(new Float32Array(TRAIL_LENGTH * 6));
    this.trail = new LineSegments2(
      this.trailGeometry,
      new LineMaterial({ linewidth: 2.5, vertexColors: true, transparent: true, opacity: 0.8, depthTest: false }),
    );
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 40;
    this.scene.add(this.trail);

    // 4D planks over the rifts: the shadow of a tesseract-shaped plank, re-projected every frame.
    this.plankGeometry = new LineSegmentsGeometry();
    this.planks = new LineSegments2(
      this.plankGeometry,
      new LineMaterial({ linewidth: 2, vertexColors: true, transparent: true, opacity: 0.95, depthTest: false }),
    );
    this.planks.frustumCulled = false;
    this.planks.renderOrder = 45;
    this.scene.add(this.planks);

    this.sightGeometry = new LineSegmentsGeometry();
    this.sightGeometry.setPositions(new Float32Array(SIGHT_CAPACITY * 6));
    this.sightGeometry.setColors(new Float32Array(SIGHT_CAPACITY * 6));
    this.sight = new LineSegments2(
      this.sightGeometry,
      new LineMaterial({ linewidth: 2, vertexColors: true, dashed: false, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.sight.frustumCulled = false;
    this.sight.renderOrder = 41;
    this.scene.add(this.sight);
  }

  /** Installs a loaded level's geometry. */
  setLevel(world: World, spec: LevelSpec, marbleRadius: number): void {
    for (const m of this.meshes) this.scene.remove(m.mesh);
    this.world = world;
    this.spec = spec;
    const { tiling, maze } = world;
    const n = tiling.tiles.length;

    this.tileBase = tiling.tiles.map((_, i) => (maze.isRoom[i] ? (i === spec.start ? COLORS.start : COLORS.room) : COLORS.void));
    // Faint grid lines on every edge that is not a wall or door.
    this.gridEdges = uniqueEdges(tiling).filter(({ tile, edge }) => world.wallOn(tile, edge) === -1);

    const [v0, v1] = tiling.canonicalVertices;
    const walls = Math.max(1, world.walls.length);
    this.fills = new HyperMesh(polygonFan(tiling.canonicalVertices, 6), n, 'opaque', 0);
    this.grid = new HyperMesh(geodesicBand(v0, v1, 0.006, 8), Math.max(1, this.gridEdges.length), 'opaque', 1);
    this.wallGlow = new HyperMesh(softGeodesicBand(v0, v1, 0.13, 16, 0.06), walls, 'additive', 2);
    this.walls = new HyperMesh(geodesicBand(v0, v1, WALL_HALF_WIDTH, 12, WALL_HALF_WIDTH), walls, 'opaque', 3);
    this.doorGlow = new HyperMesh(softGeodesicBand(v0, v1, 0.2, 16, 0.04), walls, 'additive', 4);
    this.doors = new HyperMesh(geodesicBand(v0, v1, WALL_HALF_WIDTH * 1.5, 12, 0), walls, 'alpha', 5);
    this.posts = new HyperMesh(hyperDisk(POST_RADIUS, 20), Math.max(1, world.posts.length), 'opaque', 6);
    this.portal = new HyperMesh(hyperRing(0.22, 0.3, 48), 1, 'alpha', 7);
    // A square of 4 segments is a diamond: the shards.
    this.shards = new HyperMesh(hyperDisk(0.13, 4), Math.max(1, spec.shards.length), 'alpha', 8);
    this.hunterHalos = new HyperMesh(hyperRing(HUNTER_RADIUS * 1.05, HUNTER_RADIUS * 1.6, 12), Math.max(1, spec.hunters.length), 'additive', 9);
    this.hunterBodies = new HyperMesh(hyperDisk(HUNTER_RADIUS, 7), Math.max(1, spec.hunters.length), 'alpha', 10);
    this.hunterCores = new HyperMesh(hyperDisk(HUNTER_RADIUS * 0.45, 16), Math.max(1, spec.hunters.length), 'alpha', 11);
    // Shifters wear a spinning dashed ring in the colour they shift into next.
    this.hunterShift = new HyperMesh(dashedRing(HUNTER_RADIUS * 1.7, HUNTER_RADIUS * 2.05, 5, 0.55, 4), Math.max(1, spec.hunters.length), 'alpha', 12);
    // Rifts: a glowing crack, the faint outline of the bridge-to-be, and solid bridges once built.
    this.edgeFrame = segmentFrame(v0, v1);
    const [hx, hy] = PLANK_EXTENTS;
    const plankEnds = [apply(this.edgeFrame, expOrigin(0, -hy)), apply(this.edgeFrame, expOrigin(0, hy))];
    this.riftGlow = new HyperMesh(softGeodesicBand(v0, v1, 0.18, 16, 0.02), walls, 'additive', 13);
    this.riftCore = new HyperMesh(geodesicBand(v0, v1, WALL_HALF_WIDTH * 0.6, 12, 0), walls, 'alpha', 14);
    this.bridges = new HyperMesh(geodesicBand(plankEnds[0], plankEnds[1], hx, 8, 0), walls, 'alpha', 15);
    const rifts = world.walls.filter((w) => w.rift).length;
    this.plankCapacity = Math.max(1, rifts) * PLANK_EDGES.length;
    this.plankGeometry.setPositions(new Float32Array(this.plankCapacity * 6));
    this.plankGeometry.setColors(new Float32Array(this.plankCapacity * 6));
    this.meshes = [this.fills, this.grid, this.wallGlow, this.walls, this.doorGlow, this.doors, this.posts, this.portal, this.shards, this.hunterHalos, this.hunterBodies, this.hunterCores, this.hunterShift, this.riftGlow, this.riftCore, this.bridges];
    for (const m of this.meshes) this.scene.add(m.mesh);

    this.tileMatrices.length = 0;
    this.tileVisible.length = 0;
    for (let i = 0; i < n; i++) {
      this.tileMatrices.push(identity());
      this.tileVisible.push(false);
    }
    // In the Poincaré disk a hyperbolic radius r around the centre is a circle of radius tanh(r/2).
    this.marble.scale.setScalar(Math.tanh(marbleRadius / 2));
  }

  /** Fits the disk into the canvas, leaving a small margin. */
  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.size = { width, height };
    const margin = 1.04;
    const aspect = width / height;
    if (aspect >= 1) {
      this.camera.left = -margin * aspect;
      this.camera.right = margin * aspect;
      this.camera.top = margin;
      this.camera.bottom = -margin;
      this.diskRadiusPx = height / 2 / margin;
    } else {
      this.camera.left = -margin;
      this.camera.right = margin;
      this.camera.top = margin / aspect;
      this.camera.bottom = -margin / aspect;
      this.diskRadiusPx = width / 2 / margin;
    }
    this.centerPx = { x: width / 2, y: height / 2 };
    this.camera.updateProjectionMatrix();
    (this.trail.material as LineMaterial).resolution.set(width, height);
    (this.planks.material as LineMaterial).resolution.set(width, height);
    (this.sight.material as LineMaterial).resolution.set(width, height);
  }

  /** Writes the trail as disk-space segments from point i to i+1, brightest at the newest end. */
  private updateTrail(points: readonly Vec3[] | null, viewInverse: ReadonlyMat3, tint: RGB): void {
    if (!points || points.length < 2) {
      this.trail.visible = false;
      return;
    }
    this.trail.visible = true;
    const pos = (this.trailGeometry.attributes.instanceStart as THREE.InterleavedBufferAttribute).data;
    const col = (this.trailGeometry.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data;
    const p = pos.array as Float32Array;
    const c = col.array as Float32Array;
    const n = Math.min(points.length, TRAIL_LENGTH);
    let prev = toPoincare(apply(viewInverse, points[points.length - n]));
    for (let i = 1; i < n; i++) {
      const cur = toPoincare(apply(viewInverse, points[points.length - n + i]));
      const k = (i - 1) * 6;
      p[k] = prev[0]; p[k + 1] = prev[1]; p[k + 2] = 0;
      p[k + 3] = cur[0]; p[k + 4] = cur[1]; p[k + 5] = 0;
      for (const [o, age] of [[0, i - 1], [3, i]] as const) {
        const f = age / n;
        c[k + o] = tint[0] * f;
        c[k + o + 1] = tint[1] * f;
        c[k + o + 2] = tint[2] * f;
      }
      prev = cur;
    }
    this.trailGeometry.instanceCount = n - 1;
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  /**
   * The 4D plank over every visible unbridged rift, as seen from your 4D view:
   * the tesseract-shaped plank turned by M = L(view)·L(target)⁻¹ and projected
   * onto the floor (shadowAxes). Its corners are drawn in the rift's own frame
   * (x along the crack, y across), so it lies across the crack as a bridge
   * when flat. W edges are gold: they shrink to nothing as it lines up.
   * Edges are drawn straight in the disk; they are under 0.7 units long, so
   * the bend of a true geodesic would be a fraction of a pixel near the centre.
   */
  private updatePlanks(state: ViewState): void {
    const world = this.world!;
    const { tiling } = world;
    const p = (this.plankGeometry.attributes.instanceStart as THREE.InterleavedBufferAttribute).data;
    const c = (this.plankGeometry.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data;
    const pos = p.array as Float32Array;
    const col = c.array as Float32Array;
    let n = 0;
    world.walls.forEach((wall, id) => {
      if (!wall.rift || state.bridged.has(id) || !this.tileVisible[wall.tile]) return;
      const frame = mul(mul(this.tileMatrices[wall.tile], tiling.edgeRotations[wall.edge]), this.edgeFrame);
      if (frame[8] > CULL_COSH) return;
      const g = shadowAxes(plankOrientation(state.look, wall.rift), PLANK_EXTENTS);
      const corner = TESSERACT_VERTICES.map((v) => {
        const sx = v[0] * g[0][0] + v[1] * g[1][0] + v[2] * g[2][0] + v[3] * g[3][0];
        const sy = v[0] * g[0][1] + v[1] * g[1][1] + v[2] * g[2][1] + v[3] * g[3][1];
        return toPoincare(apply(frame, expOrigin(sx, sy)));
      });
      const focus = state.riftFocus?.wall === id;
      // Brighter when it is the one you are lining up, and brightest when nearly flat.
      const k = focus ? 0.75 + 0.25 * Math.max(0, 1 - state.riftFocus!.smear / (4 * BRIDGE_SMEAR)) : 0.45;
      for (const e of PLANK_EDGES) {
        if (n >= this.plankCapacity) return;
        const a = corner[e.a];
        const b = corner[e.b];
        pos.set([a[0], a[1], 0, b[0], b[1], 0], n * 6);
        const rgb = e.axis === 3 ? PLANK_W_RGB : RIFT_RGB;
        col.set([rgb[0] * k, rgb[1] * k, rgb[2] * k, rgb[0] * k, rgb[1] * k, rgb[2] * k], n * 6);
        n++;
      }
    });
    this.planks.visible = n > 0;
    this.plankGeometry.instanceCount = n;
    p.needsUpdate = true;
    c.needsUpdate = true;
  }

  /**
   * Sight lines: from the marble (the disk centre) to each hunter in your
   * layer, fading from the hunter's end to yours, pulsing while it chases.
   * Drawn straight in the disk: a geodesic through the centre is a diameter,
   * so this is exact.
   */
  private updateSight(state: ViewState, viewInverse: ReadonlyMat3): void {
    const p = (this.sightGeometry.attributes.instanceStart as THREE.InterleavedBufferAttribute).data;
    const c = (this.sightGeometry.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data;
    const pos = p.array as Float32Array;
    const col = c.array as Float32Array;
    let n = 0;
    const pulse = 0.6 + 0.4 * Math.sin(state.time * 8);
    for (const h of state.hunters) {
      if (h.layer !== state.layer || n >= SIGHT_CAPACITY) continue;
      const [x, y] = toPoincare(apply(viewInverse, h.position));
      if (Math.hypot(x, y) > 0.97) continue;
      const [r, g, b] = LAYER_RGB[h.layer];
      const k = h.chasing ? pulse : 0.35;
      pos.set([0, 0, 0, x, y, 0], n * 6);
      col.set([r * 0.15, g * 0.15, b * 0.15, r * k, g * k, b * k], n * 6);
      n++;
    }
    this.sight.visible = n > 0;
    this.sightGeometry.instanceCount = n;
    p.needsUpdate = true;
    c.needsUpdate = true;
  }

  /** Matrix placing a shape centred on O at world point p, as seen from the view. */
  private at(viewInverse: ReadonlyMat3, p: Vec3, spin = 0): Mat3 {
    return mul(mul(viewInverse, translationTo(p)), rotation(spin));
  }

  /** Draws the plane as seen from the frame whose inverse is `viewInverse`. */
  render(viewInverse: ReadonlyMat3, state: ViewState): void {
    const world = this.world;
    if (!world || !this.spec) return;
    const { tiling } = world;
    const t = state.time;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    const layerRgb = LAYER_RGB[state.layer];

    // Rooms, tinted by the layer you're in: the colour of your slice of the fourth dimension.
    this.fills.begin();
    tiling.tiles.forEach((tile, i) => {
      const m = mul(viewInverse, tile.frame, this.tileMatrices[i]);
      const visible = m[8] < CULL_COSH;
      this.tileVisible[i] = visible;
      if (!visible) return;
      const shade = distanceShade(Math.acosh(Math.max(1, m[8])));
      const base = world.maze.isRoom[i] ? mix(this.tileBase[i], layerRgb, 0.16) : this.tileBase[i];
      this.fills.push(m, base[0] * shade, base[1] * shade, base[2] * shade);
    });
    this.fills.end();

    this.grid.begin();
    for (const { tile, edge } of this.gridEdges) {
      if (!this.tileVisible[tile]) continue;
      const m = this.tileMatrices[tile];
      const shade = distanceShade(Math.acosh(Math.max(1, m[8])));
      const [r, g, b] = COLORS.grid;
      this.grid.push(mul(m, tiling.edgeRotations[edge], this.tmp), r * shade, g * shade, b * shade);
    }
    this.grid.end();

    // Walls and doors. A door of your layer is open: a faint ghost you roll through.
    this.walls.begin();
    this.wallGlow.begin();
    this.doors.begin();
    this.doorGlow.begin();
    this.riftGlow.begin();
    this.riftCore.begin();
    this.bridges.begin();
    world.walls.forEach((wall, id) => {
      if (!this.tileVisible[wall.tile]) return;
      const m = mul(this.tileMatrices[wall.tile], tiling.edgeRotations[wall.edge], this.tmp);
      const shade = distanceShade(Math.acosh(Math.max(1, this.tileMatrices[wall.tile][8])));
      if (wall.rift) {
        const [r, g, b] = state.bridged.has(id) ? BRIDGE_RGB : RIFT_RGB;
        if (state.bridged.has(id)) {
          this.bridges.push(m, r, g, b, 0.9);
        } else {
          // The crack flickers; the bridge it could become is a faint outline.
          const flicker = 0.6 + 0.4 * Math.sin(t * 9 + id * 1.7) * Math.sin(t * 5.3 + id);
          this.riftGlow.push(m, r * shade * flicker, g * shade * flicker, b * shade * flicker, 1);
          this.riftCore.push(m, r, g, b, 0.5 + 0.4 * flicker);
          this.bridges.push(m, r, g, b, state.riftFocus?.wall === id ? 0.16 : 0.07);
        }
        return;
      }
      if (wall.door === -1) {
        const [r, g, b] = COLORS.wall;
        const k = 0.35 + 0.65 * shade;
        this.walls.push(m, r * k, g * k, b * k);
        const [gr, gg, gb] = COLORS.wallGlow;
        this.wallGlow.push(m, gr * shade, gg * shade, gb * shade, 1);
        return;
      }
      const [r, g, b] = LAYER_RGB[wall.door];
      if (wall.door === state.layer) {
        this.doors.push(m, r, g, b, 0.18 + 0.12 * pulse);
      } else {
        this.doors.push(m, r, g, b, 0.75 + 0.25 * shade);
        const halo = 0.55 * shade;
        this.doorGlow.push(m, r * halo, g * halo, b * halo, 1);
      }
    });
    this.walls.end();
    this.wallGlow.end();
    this.doors.end();
    this.doorGlow.end();
    this.riftGlow.end();
    this.riftCore.end();
    this.bridges.end();
    this.updatePlanks(state);

    this.posts.begin();
    world.posts.forEach((post, id) => {
      const m = mul(viewInverse, post.matrix, this.tmp);
      if (m[8] > CULL_COSH) return;
      const shade = 0.4 + 0.6 * distanceShade(Math.acosh(Math.max(1, m[8])));
      const c = state.highlightPosts.has(id) ? mix(COLORS.post, layerRgb, 0.5 + 0.5 * pulse) : COLORS.post;
      this.posts.push(m, c[0] * shade, c[1] * shade, c[2] * shade);
    });
    this.posts.end();

    // Exit portal: dim until every shard is collected, then bright and spinning.
    this.portal.begin();
    const pm = this.at(viewInverse, state.exit.position, t * (state.exit.open ? 2 : 0.3));
    if (pm[8] < CULL_COSH) {
      if (state.exit.open) this.portal.push(pm, 1, 1, 1, 0.65 + 0.35 * pulse);
      else this.portal.push(pm, 0.4, 0.45, 0.6, 0.5);
    }
    this.portal.end();

    // Shards: spinning diamonds; solid in your layer, ghosts in others.
    this.shards.begin();
    for (const s of state.shards) {
      if (s.collected) continue;
      const m = this.at(viewInverse, s.position, t * 1.5);
      if (m[8] > CULL_COSH) continue;
      const [r, g, b] = LAYER_RGB[s.layer];
      this.shards.push(m, r, g, b, s.layer === state.layer ? 0.95 : 0.3);
    }
    this.shards.end();

    // Hunters: a spinning heptagon with a dark eye; bright and haloed in your
    // layer (danger), faint ghosts in others (harmless). A shifter about to
    // change layer flickers towards its next colour, faster as the shift nears,
    // and if that is your layer it fades in as a warning.
    this.hunterBodies.begin();
    this.hunterHalos.begin();
    this.hunterCores.begin();
    this.hunterShift.begin();
    for (const h of state.hunters) {
      const mine = h.layer === state.layer;
      const m = this.at(viewInverse, h.position, t * (h.chasing ? 5 : 1.2));
      if (m[8] > CULL_COSH) continue;
      const flicker = h.warning > 0 && Math.sin(t * (12 + 28 * h.warning)) > 0;
      const [r, g, b] = LAYER_RGB[flicker ? h.nextLayer : h.layer];
      const incoming = h.warning > 0 && h.nextLayer === state.layer;
      const alpha = mine ? 1 : incoming ? 0.2 + 0.6 * h.warning : 0.2;
      this.hunterBodies.push(m, r, g, b, alpha);
      this.hunterCores.push(m, 0.02, 0.02, 0.05, mine ? 1 : 0.3);
      if (mine) {
        const k = h.chasing ? 0.7 + 0.3 * pulse : 0.4;
        this.hunterHalos.push(m, r * k, g * k, b * k, 1);
      }
      if (h.shifter) {
        const [nr, ng, nb] = LAYER_RGB[h.nextLayer];
        const ring = this.at(viewInverse, h.position, -t * (1.5 + 6 * h.warning));
        this.hunterShift.push(ring, nr, ng, nb, h.warning > 0 ? 0.55 + 0.45 * pulse : mine || incoming ? 0.6 : 0.25);
      }
    }
    this.hunterBodies.end();
    this.hunterHalos.end();
    this.hunterCores.end();
    this.hunterShift.end();
    this.updateSight(state, viewInverse);

    this.updateTrail(state.trail, viewInverse, layerRgb);
    const body = mix([0.96, 0.97, 1.0], layerRgb, 0.35);
    (this.marbleBody.material as THREE.MeshBasicMaterial).color.setRGB(body[0], body[1], body[2]);
    (this.phaseRing.material as THREE.MeshBasicMaterial).color.setRGB(layerRgb[0], layerRgb[1], layerRgb[2]);
    // Blink while protected after a hit.
    this.marble.visible = !(state.invulnerable > 0 && Math.floor(t * 10) % 2 === 0);

    // The renderer is shared with the inset, so restore our viewport and clear colour.
    this.renderer.setViewport(0, 0, this.size.width, this.size.height);
    this.renderer.setClearColor(COLORS.background, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  /** Screen position (CSS px) of a point given in view (disk) coordinates. */
  diskToScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.centerPx.x + x * this.diskRadiusPx, y: this.centerPx.y - y * this.diskRadiusPx };
  }
}
