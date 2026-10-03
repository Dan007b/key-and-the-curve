// Entry point. Phase 3: fly a frame around the {5,4} tiling with the keyboard.

import { identity, lorentzInverse, mul, reorthonormalize, translation } from './math/lorentz';
import { generateTiling } from './math/tiling';
import { DiskView } from './render/diskView';
import { KeyboardInput } from './input/KeyboardInput';

const app = document.getElementById('app');
if (!app) {
  throw new Error('#app element missing from index.html');
}

const canvas = document.createElement('canvas');
app.appendChild(canvas);
const fps = document.createElement('div');
fps.className = 'fps';
app.appendChild(fps);

const view = new DiskView(canvas);
const tiling = generateTiling({ p: 5, q: 4, maxRadius: 7.5 });
const colors = new Float32Array(tiling.tiles.length * 3);
tiling.tiles.forEach((t, i) => {
  // Alternate shades by depth so the layered growth of the plane is visible.
  const base = t.depth % 2 === 0 ? [0.16, 0.2, 0.32] : [0.11, 0.14, 0.24];
  colors.set(i === 0 ? [0.35, 0.3, 0.12] : base, i * 3);
});
view.setTiling(tiling, colors);

const input = new KeyboardInput(canvas, () => view.diskRadiusPx);

const resize = () => view.resize(window.innerWidth, window.innerHeight);
window.addEventListener('resize', resize);
resize();

let frame = identity();
const SPEED = 1.5; // hyperbolic units per second at full tilt

/** Advances the simulation by dt seconds. */
function step(dt: number) {
  input.update(dt);
  const { x, y } = input.tilt();
  // Move in the frame's own local direction: parallel transport (CLAUDE.md §6.3).
  frame = reorthonormalize(mul(frame, translation(x * SPEED * dt, y * SPEED * dt)));
}

function draw() {
  view.render(lorentzInverse(frame));
}

let last = performance.now();
let frames = 0;
let fpsTime = last;
function tick(now: number) {
  step(Math.min(0.05, (now - last) / 1000));
  last = now;
  draw();
  frames++;
  if (now - fpsTime > 500) {
    fps.textContent = `${Math.round((frames * 1000) / (now - fpsTime))} FPS`;
    frames = 0;
    fpsTime = now;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

if (import.meta.env.DEV) {
  Object.assign(window, {
    /** Mean ms per frame over n renders from moving viewpoints (GPU flushed). */
    __bench(n = 200) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        view.render(lorentzInverse(mul(frame, translation(Math.cos(i) * 2, Math.sin(i) * 2))));
      }
      view.renderer.getContext().finish();
      return (performance.now() - t0) / n;
    },
    /** Advances the simulation by `seconds` in 60 Hz steps and redraws (works while the tab is hidden). */
    __advance(seconds: number) {
      for (let t = 0; t < seconds; t += 1 / 60) step(1 / 60);
      draw();
    },
  });
}
