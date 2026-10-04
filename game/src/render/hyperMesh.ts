/**
 * Instanced drawing of hyperbolic geometry in the Poincaré disk.
 *
 * Every tile of a regular tiling is congruent, so each kind of shape (a tile
 * fill, an edge band, a post) is uploaded once in canonical hyperboloid
 * coordinates. Each instance carries a 3×3 Lorentz matrix, view⁻¹·frame,
 * computed on the CPU in float64; the vertex shader applies it and maps the
 * result to the disk with (x, y)/(1 + z).
 *
 * Precision: canonical coordinates are O(1) and the per-instance matrix is
 * formed in float64, so float32 only rounds the final, well-conditioned
 * product: relative error ~1e-7 in disk coordinates. (Uploading world
 * coordinates instead would cancel catastrophically far from the origin.)
 */

import * as THREE from 'three';
import type { ReadonlyMat3, ReadonlyVec3 } from '../math/lorentz';
import { distance, expOrigin } from '../math/lorentz';
import { geodesicNormal, geodesicPoint } from '../math/geodesic';

const vertexShader = /* glsl */ `
attribute vec3 iRow0;
attribute vec3 iRow1;
attribute vec3 iRow2;
attribute vec4 iColor;
attribute float aFade;
varying vec4 vColor;
void main() {
  vec3 p = vec3(dot(iRow0, position), dot(iRow1, position), dot(iRow2, position));
  vec2 d = p.xy / (1.0 + p.z);
  vColor = vec4(iColor.rgb, iColor.a * aFade);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(d, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}
`;

/** Canonical shape: hyperboloid points plus a triangle index list. */
export interface HyperShape {
  positions: number[];
  indices: number[];
  /** Optional per-vertex opacity (1 = full), e.g. to feather a glow band. */
  fade?: number[];
}

export type Blend = 'opaque' | 'alpha' | 'additive';

/** A batch of instances of one canonical shape, refilled every frame. */
export class HyperMesh {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly rows: [THREE.InstancedBufferAttribute, THREE.InstancedBufferAttribute, THREE.InstancedBufferAttribute];
  private readonly colors: THREE.InstancedBufferAttribute;
  private readonly capacity: number;
  private count = 0;

  constructor(shape: HyperShape, capacity: number, blend: Blend, renderOrder: number) {
    this.capacity = capacity;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(shape.positions, 3));
    const vertexCount = shape.positions.length / 3;
    g.setAttribute('aFade', new THREE.Float32BufferAttribute(shape.fade ?? new Array(vertexCount).fill(1), 1));
    g.setIndex(shape.indices);
    const mk = (size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.rows = [mk(3), mk(3), mk(3)];
    this.colors = mk(4);
    g.setAttribute('iRow0', this.rows[0]);
    g.setAttribute('iRow1', this.rows[1]);
    g.setAttribute('iRow2', this.rows[2]);
    g.setAttribute('iColor', this.colors);
    g.instanceCount = 0;
    this.geometry = g;

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: blend !== 'opaque',
      blending: blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, material);
    // The canonical bounding sphere says nothing about where instances land.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  /** Starts a new frame's worth of instances. */
  begin(): void {
    this.count = 0;
  }

  /** Adds one instance drawn with matrix m (view⁻¹·frame) and an RGBA colour. */
  push(m: ReadonlyMat3, r: number, g: number, b: number, a = 1): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const [r0, r1, r2] = this.rows;
    r0.array[i * 3] = m[0]; r0.array[i * 3 + 1] = m[1]; r0.array[i * 3 + 2] = m[2];
    r1.array[i * 3] = m[3]; r1.array[i * 3 + 1] = m[4]; r1.array[i * 3 + 2] = m[5];
    r2.array[i * 3] = m[6]; r2.array[i * 3 + 1] = m[7]; r2.array[i * 3 + 2] = m[8];
    const c = this.colors.array;
    c[i * 4] = r; c[i * 4 + 1] = g; c[i * 4 + 2] = b; c[i * 4 + 3] = a;
  }

  /** Uploads this frame's instances. Only the used range is re-sent. */
  end(): void {
    this.geometry.instanceCount = this.count;
    for (const a of [...this.rows, this.colors]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

// ---- Canonical shapes ---------------------------------------------------------

function pushPoint(out: number[], p: ReadonlyVec3): void {
  out.push(p[0], p[1], p[2]);
}

/**
 * A filled polygon as a triangle fan from O, with each edge sampled along its
 * geodesic so the edges curve correctly in the disk.
 */
export function polygonFan(vertices: readonly ReadonlyVec3[], samplesPerEdge: number): HyperShape {
  const positions: number[] = [0, 0, 1];
  const n = vertices.length;
  for (let k = 0; k < n; k++) {
    const a = vertices[k];
    const b = vertices[(k + 1) % n];
    for (let s = 0; s < samplesPerEdge; s++) {
      pushPoint(positions, geodesicPoint(a, b, s / samplesPerEdge));
    }
  }
  const ring = n * samplesPerEdge;
  const indices: number[] = [];
  for (let i = 0; i < ring; i++) {
    indices.push(0, 1 + i, 1 + ((i + 1) % ring));
  }
  return { positions, indices };
}

/**
 * A band of hyperbolic half-width w around the geodesic segment a→b,
 * extended by `extend` past both ends. Its sides are equidistant curves
 * (points at distance w from the geodesic), so the band keeps a constant
 * true width and naturally thins towards the disk's rim.
 */
export function geodesicBand(a: ReadonlyVec3, b: ReadonlyVec3, w: number, samples: number, extend = 0): HyperShape {
  const n = geodesicNormal(a, b);
  const len = distance(a, b);
  const ch = Math.cosh(w);
  const sh = Math.sinh(w);
  const positions: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (-extend + (i / samples) * (len + 2 * extend)) / len;
    const c = geodesicPoint(a, b, t);
    pushPoint(positions, [ch * c[0] + sh * n[0], ch * c[1] + sh * n[1], ch * c[2] + sh * n[2]]);
    pushPoint(positions, [ch * c[0] - sh * n[0], ch * c[1] - sh * n[1], ch * c[2] - sh * n[2]]);
  }
  const indices: number[] = [];
  for (let i = 0; i < samples; i++) {
    const a0 = 2 * i;
    indices.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
  }
  return { positions, indices };
}

/** A hyperbolic disk of radius r centred on O. */
export function hyperDisk(r: number, segments: number): HyperShape {
  const positions: number[] = [0, 0, 1];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    pushPoint(positions, expOrigin(r * Math.cos(a), r * Math.sin(a)));
  }
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) indices.push(0, 1 + i, 1 + ((i + 1) % segments));
  return { positions, indices };
}

/** A hyperbolic annulus (ring) between radii r0 < r1 centred on O. */
export function hyperRing(r0: number, r1: number, segments: number): HyperShape {
  const positions: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    const c = Math.cos(a), s = Math.sin(a);
    pushPoint(positions, expOrigin(r0 * c, r0 * s));
    pushPoint(positions, expOrigin(r1 * c, r1 * s));
  }
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = 2 * i, b0 = 2 * ((i + 1) % segments);
    indices.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0);
  }
  return { positions, indices };
}

/** A dashed hyperbolic annulus: `dashes` arcs between radii r0 < r1, each filling `duty` of its slot. */
export function dashedRing(r0: number, r1: number, dashes: number, duty: number, segmentsPerDash: number): HyperShape {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let d = 0; d < dashes; d++) {
    const base = positions.length / 3;
    for (let i = 0; i <= segmentsPerDash; i++) {
      const a = ((d + (duty * i) / segmentsPerDash) * 2 * Math.PI) / dashes;
      const c = Math.cos(a), s = Math.sin(a);
      pushPoint(positions, expOrigin(r0 * c, r0 * s));
      pushPoint(positions, expOrigin(r1 * c, r1 * s));
    }
    for (let i = 0; i < segmentsPerDash; i++) {
      const a0 = base + 2 * i;
      indices.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
  }
  return { positions, indices };
}

/**
 * Like geodesicBand, but with a centre line at full opacity fading to zero at
 * the edges: a soft glow that keeps its true hyperbolic width.
 */
export function softGeodesicBand(a: ReadonlyVec3, b: ReadonlyVec3, w: number, samples: number, extend = 0): HyperShape {
  const n = geodesicNormal(a, b);
  const len = distance(a, b);
  const ch = Math.cosh(w);
  const sh = Math.sinh(w);
  const positions: number[] = [];
  const fade: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (-extend + (i / samples) * (len + 2 * extend)) / len;
    const c = geodesicPoint(a, b, t);
    // Ends fade out too, so overlapping glows at corners blend smoothly.
    const s = i / samples;
    const endFade = Math.min(1, Math.min(s, 1 - s) * 6);
    pushPoint(positions, [ch * c[0] + sh * n[0], ch * c[1] + sh * n[1], ch * c[2] + sh * n[2]]);
    pushPoint(positions, c);
    pushPoint(positions, [ch * c[0] - sh * n[0], ch * c[1] - sh * n[1], ch * c[2] - sh * n[2]]);
    fade.push(0, endFade, 0);
  }
  const indices: number[] = [];
  for (let i = 0; i < samples; i++) {
    const r = 3 * i;
    for (const k of [0, 1]) {
      indices.push(r + k, r + k + 1, r + k + 3, r + k + 1, r + k + 4, r + k + 3);
    }
  }
  return { positions, indices, fade };
}
