/**
 * Inset view (bottom-right): the key's tesseract shadow, and the gate's
 * target as a ghost when a gate is near (CLAUDE.md §9).
 *
 * The key is drawn in the marble's local frame, the same frame the main view
 * uses for the screen. Twisting therefore turns it in the axes you see, and a
 * curvature turn shows up as the ghost (the gate, seen from the carried frame)
 * rotating, just as the whole maze rotates in the main view.
 *
 * 4D → 3D: perspective along w (project4to3). 3D → screen: a Three.js
 * perspective camera. Edges are coloured by their axis (x red, y green,
 * z blue, w gold) and brightened by depth in w; the marked corner, the
 * key's "bit", is a white bead. Together the colours and the bead break the
 * tesseract's symmetry, so exactly one orientation fits a gate.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { MARKED_VERTEX, TESSERACT_EDGES, TESSERACT_VERTICES, apply4, project4to3 } from '../math/four';
import type { Mat4 } from '../math/four';

const AXIS_COLORS: [number, number, number][] = [
  [1.0, 0.36, 0.36], // x
  [0.36, 1.0, 0.55], // y
  [0.36, 0.7, 1.0], // z
  [1.0, 0.8, 0.3], // w
];

/** One drawn tesseract (the key or its ghost). */
class Tesseract {
  readonly lines: LineSegments2;
  readonly bead: THREE.Mesh;
  private readonly geometry: LineSegmentsGeometry;

  constructor(width: number, opacity: number, ghost: boolean) {
    this.geometry = new LineSegmentsGeometry();
    this.geometry.setPositions(new Float32Array(TESSERACT_EDGES.length * 6));
    this.geometry.setColors(new Float32Array(TESSERACT_EDGES.length * 6));
    const material = new LineMaterial({
      linewidth: width,
      vertexColors: true,
      transparent: opacity < 1,
      opacity,
      depthWrite: !ghost,
    });
    this.lines = new LineSegments2(this.geometry, material);
    this.bead = new THREE.Mesh(
      new THREE.SphereGeometry(ghost ? 0.2 : 0.11, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: ghost, opacity: ghost ? 0.3 : 1, depthWrite: !ghost }),
    );
  }

  update(k: Mat4, ghost: boolean): void {
    const pos = this.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute;
    const col = this.geometry.attributes.instanceColorStart as THREE.InterleavedBufferAttribute;
    const p = pos.data.array as Float32Array;
    const c = col.data.array as Float32Array;
    const rotated = TESSERACT_VERTICES.map((v) => apply4(k, v));
    TESSERACT_EDGES.forEach((e, i) => {
      const a = rotated[e.a];
      const b = rotated[e.b];
      p.set(project4to3(a), i * 6);
      p.set(project4to3(b), i * 6 + 3);
      // Brightness by depth in w (−2 … 2 after rotation). The ghost keeps its
      // axis colours too: where key and ghost colours agree, that edge fits.
      const [r, g, bl] = AXIS_COLORS[e.axis];
      for (const [offset, w] of [[0, a[3]], [3, b[3]]] as const) {
        const shade = ghost ? 0.9 : 0.4 + 0.6 * ((w + 2) / 4);
        c[i * 6 + offset] = r * shade;
        c[i * 6 + offset + 1] = g * shade;
        c[i * 6 + offset + 2] = bl * shade;
      }
    });
    pos.data.needsUpdate = true;
    col.data.needsUpdate = true;
    this.geometry.computeBoundingSphere();
    this.bead.position.set(...project4to3(rotated[MARKED_VERTEX]));
  }

  setResolution(w: number, h: number): void {
    (this.lines.material as LineMaterial).resolution.set(w, h);
  }

  setVisible(v: boolean): void {
    this.lines.visible = v;
    this.bead.visible = v;
  }
}

export class KeyView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  // The key: thin bright lines. The ghost: a wide translucent halo behind them.
  private readonly key = new Tesseract(2.5, 1, false);
  private readonly ghost = new Tesseract(9, 0.32, true);

  constructor() {
    this.scene.add(this.ghost.lines, this.ghost.bead, this.key.lines, this.key.bead);
  }

  /** Updates the drawn key and (optionally) the ghost target, both in the local frame. */
  update(key: Mat4, ghost: Mat4 | null, time: number): void {
    this.key.update(key, false);
    this.ghost.setVisible(ghost !== null);
    if (ghost) this.ghost.update(ghost, true);
    // A gentle sway of the 3D camera helps the eye read depth.
    const a = 0.45 + 0.18 * Math.sin(time * 0.4);
    this.camera.position.set(Math.sin(a) * 6.2, 2.3, Math.cos(a) * 6.2);
    this.camera.lookAt(0, 0, 0);
  }

  /** Renders into a square region (CSS px, origin bottom-left) of the shared renderer. */
  render(renderer: THREE.WebGLRenderer, x: number, y: number, size: number): void {
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    this.key.setResolution(size, size);
    this.ghost.setResolution(size, size);
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, size, size);
    renderer.setViewport(x, y, size, size);
    renderer.setClearColor(0x0a0e1a, 1);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
  }
}
