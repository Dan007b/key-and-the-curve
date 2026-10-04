// Entry point: wires the game, the views, the HUD and the inputs together.

import './style.css';
import { lorentzInverse } from './math/lorentz';
import { DiskView } from './render/diskView';
import type { ViewState } from './render/diskView';
import { Hud } from './render/hud';
import { KeyboardInput } from './input/KeyboardInput';
import { SerialInput } from './input/SerialInput';
import { CombinedInput } from './input/CombinedInput';
import { Game } from './game/game';
import { LEVELS } from './game/level';

const app = document.getElementById('app');
if (!app) {
  throw new Error('#app element missing from index.html');
}

const canvas = document.createElement('canvas');
app.appendChild(canvas);
const view = new DiskView(canvas);
const hud = new Hud(app);
const keyboard = new KeyboardInput(canvas, () => view.diskRadiusPx);
const serial = new SerialInput();
const input = new CombinedInput(keyboard, serial);
const game = new Game();

let levelIndex = 0;
let paused = true;

function startLevel(index: number): void {
  levelIndex = index;
  const spec = LEVELS[index];
  game.load(spec);
  view.setLevel(game.level.world, spec, game.settings.marble.radius);
  hud.setLevel(index, spec.name, spec.hint);
  paused = true;
  hud.showCard(`Level ${index + 1} · ${spec.name}`, spec.intro, 'Start', () => {
    paused = false;
  });
}

if (SerialInput.supported()) {
  const connectButton = hud.button('Connect controller', 'Pick the ESP32 serial port (Chrome or Edge)', () => {
    if (serial.connected()) {
      void serial.disconnect();
      return;
    }
    serial.connect().catch((err: unknown) => {
      // Cancelling the port picker is not an error worth shouting about.
      if (!(err instanceof DOMException && err.name === 'NotFoundError')) {
        hud.showCard(
          'Could not open the controller',
          `${String(err)}\nIs another program (a serial monitor) using the port?`,
          'OK',
          () => {},
        );
      }
    });
  });
  setInterval(() => {
    connectButton.textContent = serial.connected() ? 'Disconnect controller' : 'Connect controller';
  }, 500);
  hud.button('Set level', 'Hold the controller the way you want "flat" to be, then click', () => {
    if (!serial.setLevel()) hud.showCard('No controller data yet', 'Connect the controller first.', 'OK', () => {});
  });
} else {
  hud.button('Controller: use Chrome or Edge', 'Web Serial is not available in this browser', () => {});
}
hud.button('Restart', 'Restart this level', () => startLevel(levelIndex));
hud.button('Next level', 'Skip to the next level', () => startLevel((levelIndex + 1) % LEVELS.length));

const resize = () => view.resize(window.innerWidth, window.innerHeight);
window.addEventListener('resize', resize);
resize();

function viewState(): ViewState {
  return {
    time: game.time,
    twistMode: game.twistMode,
    gateGlow: [],
    gateOpen: [],
    highlightPosts: new Set(),
  };
}

function draw(): void {
  view.render(lorentzInverse(game.viewFrame()), viewState());
}

function step(dt: number): void {
  input.update(dt);
  keyboard.twistMode = game.twistMode;
  if (paused) return;
  game.update(dt, input);
  if (game.completed) {
    paused = true;
    const last = levelIndex === LEVELS.length - 1;
    hud.showCard(
      last ? 'You made it home' : 'Level complete',
      last ? 'You carried the key through curved space and four dimensions.' : 'On to the next one.',
      last ? 'Play again' : 'Next level',
      () => startLevel(last ? 0 : levelIndex + 1),
    );
  }
}

let last = performance.now();
let frames = 0;
let fpsTime = last;
let fps = 60;
function tick(now: number): void {
  step(Math.min(0.1, (now - last) / 1000));
  last = now;
  draw();
  frames++;
  if (now - fpsTime > 500) {
    fps = (frames * 1000) / (now - fpsTime);
    frames = 0;
    fpsTime = now;
  }
  hud.update({
    fps,
    inputs: input.statuses(),
    twistMode: game.twistMode,
    twistAllowed: game.twistAllowed(),
    holonomyDeg: (game.holonomy() * 180) / Math.PI,
    fit: null,
    fitThreshold: 0,
  });
  requestAnimationFrame(tick);
}

startLevel(0);
requestAnimationFrame(tick);

if (import.meta.env.DEV) {
  // Dev hooks for testing in a hidden tab, where requestAnimationFrame is paused.
  Object.assign(window, {
    __game: game,
    __start(index: number) {
      startLevel(index);
      hud.hideCard();
      paused = false;
    },
    /** Advances the simulation by `seconds` in 60 Hz steps and redraws. */
    __advance(seconds: number) {
      for (let t = 0; t < seconds; t += 1 / 60) step(1 / 60);
      draw();
    },
    /** Mean ms per frame over n renders (GPU flushed). */
    __bench(n = 200) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) draw();
      view.renderer.getContext().finish();
      return (performance.now() - t0) / n;
    },
  });
}
