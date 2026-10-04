/**
 * Main view: the hyperbolic plane in the Poincaré disk, always centred on
 * the marble and using its carried frame as the screen axes (CLAUDE.md §6.2,
 * §9). After a loop the whole world appears rotated: that is the holonomy,
 * made visible.
 */

import * as THREE from 'three';
import { identity, mul } from '../math/lorentz';
import type { Mat3, ReadonlyMat3 } from '../math/lorentz';
import type { Tiling } from '../math/tiling';
import { HyperMesh, geodesicBand, hyperDisk, polygonFan, softGeodesicBand } from './hyperMesh';
import type { World } from '../game/world';
import { POST_RADIUS, WALL_HALF_WIDTH } from '../game/world';
import type { LevelSpec } from '../game/level';

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
  room: [0.15, 0.19, 0.31] as RGB,
  start: [0.1, 0.3, 0.3] as RGB,
  goal: [0.55, 0.42, 0.1] as RGB,
  grid: [0.2, 0.25, 0.38] as RGB,
  wall: [0.6, 0.93, 1.0] as RGB,
  wallGlow: [0.12, 0.4, 0.6] as RGB,
  post: [0.82, 0.97, 1.0] as RGB,
  pillar: [0.75, 0.45, 1.0] as RGB,
  gate: [1.0, 0.3, 0.85] as RGB,
  gateNear: [1.0, 0.85, 0.3] as RGB,
  gateOpen: [0.3, 1.0, 0.6] as RGB,
};

/** Per-frame state the view needs from the game. */
export interface ViewState {
  time: number;
  twistMode: boolean;
  /** Per gate: 0 = far from fitting … 1 = fits. */
  gateGlow: number[];
  gateOpen: boolean[];
  /** Post ids to pulse (marked pillars, loop labels). */
  highlightPosts: Set<number>;
}

export class DiskView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  /** Disk radius in CSS pixels, for mapping disk coordinates to the screen. */
  diskRadiusPx = 1;
  /** Disk centre in CSS pixels. */
  centerPx = { x: 0, y: 0 };

  private world: World | null = null;
  private spec: LevelSpec | null = null;
  private tileColors = new Float32Array(0);
  private gridEdges: EdgeRef[] = [];
  private meshes: HyperMesh[] = [];
  private fills!: HyperMesh;
  private grid!: HyperMesh;
  private wallGlow!: HyperMesh;
  private walls!: HyperMesh;
  private gates!: HyperMesh;
  private gateGlowMesh!: HyperMesh;
  private posts!: HyperMesh;
  private readonly tileMatrices: Mat3[] = [];
  private readonly tileVisible: boolean[] = [];
  private readonly tmp: Mat3 = identity();
  private readonly marble: THREE.Group;
  private readonly marbleBody: THREE.Mesh;
  private readonly twistRing: THREE.Mesh;

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

    // The marble always sits at the centre of the disk.
    this.marble = new THREE.Group();
    this.marble.renderOrder = 50;
    this.marbleBody = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.MeshBasicMaterial({ color: 0xf4f7ff, transparent: true, depthTest: false }),
    );
    const shine = new THREE.Mesh(
      new THREE.CircleGeometry(0.35, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }),
    );
    shine.position.set(-0.3, 0.3, 0);
    this.twistRing = new THREE.Mesh(
      new THREE.RingGeometry(1.25, 1.45, 64),
      new THREE.MeshBasicMaterial({ color: 0xc08cff, transparent: true, depthTest: false }),
    );
    for (const m of [this.marbleBody, shine, this.twistRing]) m.renderOrder = 50;
    this.marble.add(this.marbleBody, shine, this.twistRing);
    this.scene.add(this.marble);
  }

  /** Installs a loaded level's geometry. */
  setLevel(world: World, spec: LevelSpec, marbleRadius: number): void {
    for (const m of this.meshes) this.scene.remove(m.mesh);
    this.world = world;
    this.spec = spec;
    const { tiling, maze } = world;
    const n = tiling.tiles.length;

    this.tileColors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      let c = maze.isRoom[i] ? COLORS.room : COLORS.void;
      if (i === spec.start) c = COLORS.start;
      if (i === spec.goal) c = COLORS.goal;
      this.tileColors.set(c, i * 3);
    }
    // Faint grid lines on every edge that is not a wall.
    this.gridEdges = uniqueEdges(tiling).filter(({ tile, edge }) => world.wallOn(tile, edge) === -1);

    const [v0, v1] = tiling.canonicalVertices;
    this.fills = new HyperMesh(polygonFan(tiling.canonicalVertices, 6), n, 'opaque', 0);
    this.grid = new HyperMesh(geodesicBand(v0, v1, 0.006, 8), this.gridEdges.length, 'opaque', 1);
    this.wallGlow = new HyperMesh(softGeodesicBand(v0, v1, 0.13, 16, 0.06), world.walls.length, 'additive', 2);
    this.walls = new HyperMesh(geodesicBand(v0, v1, WALL_HALF_WIDTH, 12, WALL_HALF_WIDTH), world.walls.length, 'opaque', 3);
    this.gateGlowMesh = new HyperMesh(softGeodesicBand(v0, v1, 0.2, 16, 0.04), Math.max(1, world.walls.length), 'additive', 4);
    this.gates = new HyperMesh(geodesicBand(v0, v1, WALL_HALF_WIDTH * 1.4, 12, 0), Math.max(1, world.walls.length), 'alpha', 5);
    this.posts = new HyperMesh(hyperDisk(POST_RADIUS, 20), world.posts.length, 'opaque', 6);
    this.meshes = [this.fills, this.grid, this.wallGlow, this.walls, this.gateGlowMesh, this.gates, this.posts];
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
  }

  /** Draws the plane as seen from the frame whose inverse is `viewInverse`. */
  render(viewInverse: ReadonlyMat3, state: ViewState): void {
    const world = this.world;
    const spec = this.spec;
    if (!world || !spec) return;
    const { tiling } = world;
    const pulse = 0.5 + 0.5 * Math.sin(state.time * 3);

    this.fills.begin();
    tiling.tiles.forEach((t, i) => {
      const m = mul(viewInverse, t.frame, this.tileMatrices[i]);
      // m·O is the tile centre in view coordinates; its z is cosh(distance).
      const visible = m[8] < CULL_COSH;
      this.tileVisible[i] = visible;
      if (!visible) return;
      let shade = distanceShade(Math.acosh(Math.max(1, m[8])));
      if (i === spec.goal) shade *= 0.75 + 0.35 * pulse;
      const c = this.tileColors;
      this.fills.push(m, c[i * 3] * shade, c[i * 3 + 1] * shade, c[i * 3 + 2] * shade);
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

    this.walls.begin();
    this.wallGlow.begin();
    this.gates.begin();
    this.gateGlowMesh.begin();
    for (const wall of world.walls) {
      if (!this.tileVisible[wall.tile]) continue;
      const m = mul(this.tileMatrices[wall.tile], tiling.edgeRotations[wall.edge], this.tmp);
      const shade = distanceShade(Math.acosh(Math.max(1, this.tileMatrices[wall.tile][8])));
      if (wall.gate === -1) {
        const [r, g, b] = COLORS.wall;
        this.walls.push(m, r * (0.35 + 0.65 * shade), g * (0.35 + 0.65 * shade), b * (0.35 + 0.65 * shade));
        const [gr, gg, gb] = COLORS.wallGlow;
        this.wallGlow.push(m, gr * shade, gg * shade, gb * shade, 1);
        continue;
      }
      const glow = state.gateGlow[wall.gate] ?? 0;
      if (state.gateOpen[wall.gate]) {
        const [r, g, b] = COLORS.gateOpen;
        this.gates.push(m, r, g, b, 0.25 * shade);
        continue;
      }
      const [r0, g0, b0] = COLORS.gate;
      const [r1, g1, b1] = COLORS.gateNear;
      const mix = (x: number, y: number) => x + (y - x) * glow;
      this.gates.push(m, mix(r0, r1), mix(g0, g1), mix(b0, b1), 0.6 + 0.4 * shade);
      const halo = (0.25 + 0.75 * glow) * (0.6 + 0.4 * pulse) * shade;
      this.gateGlowMesh.push(m, mix(r0, r1) * halo, mix(g0, g1) * halo, mix(b0, b1) * halo, 1);
    }
    this.walls.end();
    this.wallGlow.end();
    this.gates.end();
    this.gateGlowMesh.end();

    this.posts.begin();
    world.posts.forEach((post, id) => {
      const m = mul(viewInverse, post.matrix, this.tmp);
      if (m[8] > CULL_COSH) return;
      const shade = 0.4 + 0.6 * distanceShade(Math.acosh(Math.max(1, m[8])));
      const [r, g, b] = state.highlightPosts.has(id)
        ? COLORS.pillar.map((x) => x * (0.6 + 0.6 * pulse))
        : COLORS.post;
      this.posts.push(m, r * shade, g * shade, b * shade);
    });
    this.posts.end();

    this.twistRing.visible = state.twistMode;
    (this.twistRing.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.4 * pulse;

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  /** Screen position (CSS px) of a point given in view (disk) coordinates. */
  diskToScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.centerPx.x + x * this.diskRadiusPx, y: this.centerPx.y - y * this.diskRadiusPx };
  }
}
