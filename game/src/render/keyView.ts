/**
 * Inset view (bottom-right): your marble's 4D body. A tesseract's shadow,
 * tinted by the layer you are in, that turns through the XW plane as your
 * phase moves around the fourth dimension: twist and you see it rotate
 * through 4D; loop a pillar and it jumps a fifth of a turn.
 *
 * 4D → 3D: perspective along w (project4to3). 3D → screen: a Three.js
 * perspective camera. Edges are brightened by depth in w.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { TESSERACT_EDGES, TESSERACT_VERTICES, apply4, mul4, planeRotation, project4to3 } from '../math/four';

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

  /** Draws the tesseract turned by `phaseDeg` in the XW plane, tinted `rgb`. */
  update(phaseDeg: number, rgb: [number, number, number], time: number): void {
    // Phase turns XW (one layer = 72°); a slow YZ drift keeps the 3D shape readable.
    const k = mul4(planeRotation('xw', (phaseDeg * Math.PI) / 180), planeRotation('yz', 0.35 + 0.15 * Math.sin(time * 0.3)));
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
      for (const [o, w] of [[0, a[3]], [3, b[3]]] as const) {
        const shade = 0.35 + 0.65 * ((w + 2) / 4);
        c[i * 6 + o] = rgb[0] * shade;
        c[i * 6 + o + 1] = rgb[1] * shade;
        c[i * 6 + o + 2] = rgb[2] * shade;
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
