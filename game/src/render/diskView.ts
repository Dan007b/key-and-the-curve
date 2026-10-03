/**
 * Main view: the hyperbolic plane in the Poincaré disk, always centred on
 * the viewer's frame (the marble), using that frame's axes as screen axes.
 */

import * as THREE from 'three';
import { identity, mul } from '../math/lorentz';
import type { Mat3, ReadonlyMat3 } from '../math/lorentz';
import type { Tiling } from '../math/tiling';
import { HyperMesh, geodesicBand, polygonFan } from './hyperMesh';

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

export class DiskView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  /** Disk radius in CSS pixels, for mapping disk coordinates to the screen. */
  diskRadiusPx = 1;

  private tiling: Tiling | null = null;
  private tileColors: Float32Array = new Float32Array(0);
  private edges: EdgeRef[] = [];
  private fills: HyperMesh | null = null;
  private outlines: HyperMesh | null = null;
  private readonly tmp: Mat3 = identity();
  private readonly tileMatrices: Mat3[] = [];
  private readonly tileVisible: boolean[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x05060a, 1);
    this.renderer.autoClear = false;

    // Disk background and rim, drawn in plain screen (disk) coordinates.
    const disk = new THREE.Mesh(new THREE.CircleGeometry(1, 128), new THREE.MeshBasicMaterial({ color: 0x090c14 }));
    disk.renderOrder = -10;
    const rim = new THREE.Mesh(new THREE.RingGeometry(1, 1.006, 256), new THREE.MeshBasicMaterial({ color: 0x3a4a6e }));
    rim.renderOrder = 100;
    this.scene.add(disk, rim);
  }

  /** Installs the tiling and a per-tile base colour (RGB triples, 0..1). */
  setTiling(tiling: Tiling, tileColors: Float32Array): void {
    if (this.fills) this.scene.remove(this.fills.mesh);
    if (this.outlines) this.scene.remove(this.outlines.mesh);
    this.tiling = tiling;
    this.tileColors = tileColors;
    this.edges = uniqueEdges(tiling);
    const [v0, v1] = tiling.canonicalVertices;
    this.fills = new HyperMesh(polygonFan(tiling.canonicalVertices, 6), tiling.tiles.length, 'opaque', 0);
    this.outlines = new HyperMesh(geodesicBand(v0, v1, 0.006, 8), this.edges.length, 'opaque', 1);
    this.scene.add(this.fills.mesh, this.outlines.mesh);
    this.tileMatrices.length = 0;
    this.tileVisible.length = 0;
    for (let i = 0; i < tiling.tiles.length; i++) {
      this.tileMatrices.push(identity());
      this.tileVisible.push(false);
    }
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
    this.camera.updateProjectionMatrix();
  }

  /** Matrix taking canonical tile coordinates to view coordinates, valid after render(). */
  tileMatrix(i: number): ReadonlyMat3 | null {
    return this.tileVisible[i] ? this.tileMatrices[i] : null;
  }

  /** Draws the plane as seen from the frame whose inverse is `viewInverse`. */
  render(viewInverse: ReadonlyMat3): void {
    const tiling = this.tiling;
    if (!tiling || !this.fills || !this.outlines) return;

    this.fills.begin();
    tiling.tiles.forEach((t, i) => {
      const m = mul(viewInverse, t.frame, this.tileMatrices[i]);
      // m·O is the tile centre in view coordinates; its z is cosh(distance).
      const z = m[8];
      const visible = z < CULL_COSH;
      this.tileVisible[i] = visible;
      if (!visible) return;
      const shade = distanceShade(Math.acosh(Math.max(1, z)));
      const c = this.tileColors;
      this.fills!.push(m, c[i * 3] * shade, c[i * 3 + 1] * shade, c[i * 3 + 2] * shade);
    });
    this.fills.end();

    this.outlines.begin();
    for (const { tile, edge } of this.edges) {
      if (!this.tileVisible[tile]) continue;
      const m = this.tileMatrices[tile];
      const shade = distanceShade(Math.acosh(Math.max(1, m[8])));
      mul(m, tiling.edgeRotations[edge], this.tmp);
      this.outlines.push(this.tmp, 0.16 * shade + 0.04, 0.2 * shade + 0.05, 0.3 * shade + 0.07);
    }
    this.outlines.end();

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }
}
