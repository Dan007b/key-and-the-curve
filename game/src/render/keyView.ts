/**
 * Inset view (bottom-right): your 4D view. A tesseract turned by the same
 * rotation as your view into the fourth dimension (Shift + arrows, or hold
 * BOOT and tilt): XW turns its left-right edges towards w, YW its up-down
 * ones. The planks over rifts are seen through this same rotation, so as the
 * tesseract turns, they slide. Its w edges are gold, its x, y, z edges are
 * tinted with the layer you are in.
 *
 * 4D → 3D: perspective along w (project4to3). 3D → screen: a Three.js
 * perspective camera. Edges are brightened by depth in w.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { TESSERACT_EDGES, TESSERACT_VERTICES, apply4, lookRotation, mul4, planeRotation, project4to3 } from '../math/four';

/** The fourth dimension's colour (w edges), as on the rift planks. */
const W_RGB: [number, number, number] = [1.0, 0.8, 0.3];

export class KeyView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  private readonly geometry = new LineSegmentsGeometry();
  private readonly lines: LineSegments2;

  constructor() {
    this.geometry.setPositions(new Float32Array(TESSERACT_EDGES.length * 6));
    this.geometry.setColors(new Float32Array(TESSERACT_EDGES.length * 6));
    this.lines = new LineSegments2(this.geometry, new LineMaterial({ linewidth: 2.5, vertexColors: true }));
    this.scene.add(this.lines);
  }

  /** Draws the tesseract turned by your 4D view `look` ([xw, yw] degrees), tinted `rgb`. */
  update(look: readonly [number, number], rgb: [number, number, number], time: number): void {
    // The view's rotation, then a fixed 3D tilt (with a slow drift) so the cube-in-a-cube shape stays readable.
    const k = mul4(planeRotation('yz', 0.35 + 0.15 * Math.sin(time * 0.3)), mul4(planeRotation('xz', 0.3), lookRotation(look[0], look[1])));
    const pos = (this.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute).data;
    const col = (this.geometry.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data;
    const p = pos.array as Float32Array;
    const c = col.array as Float32Array;
    const rotated = TESSERACT_VERTICES.map((v) => apply4(k, v));
    TESSERACT_EDGES.forEach((e, i) => {
      const a = rotated[e.a];
      const b = rotated[e.b];
      p.set(project4to3(a), i * 6);
      p.set(project4to3(b), i * 6 + 3);
      const tint = e.axis === 3 ? W_RGB : rgb;
      for (const [o, w] of [[0, a[3]], [3, b[3]]] as const) {
        const shade = 0.35 + 0.65 * ((w + 2) / 4);
        c[i * 6 + o] = tint[0] * shade;
        c[i * 6 + o + 1] = tint[1] * shade;
        c[i * 6 + o + 2] = tint[2] * shade;
      }
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.geometry.computeBoundingSphere();
    this.camera.position.set(2.2, 1.6, 5.8);
    this.camera.lookAt(0, 0, 0);
  }

  /** Renders into a square region (CSS px, origin bottom-left) of the shared renderer. */
  render(renderer: THREE.WebGLRenderer, x: number, y: number, size: number): void {
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    (this.lines.material as LineMaterial).resolution.set(size, size);
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, size, size);
    renderer.setViewport(x, y, size, size);
    renderer.setClearColor(0x0a0e1a, 1);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
  }
}
