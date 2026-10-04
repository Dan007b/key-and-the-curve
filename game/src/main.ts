// Entry point: wires the game, the views, the HUD, sound and the inputs together.

import './style.css';
import { apply, lorentzInverse } from './math/lorentz';
import type { Vec3 } from './math/lorentz';
import { toPoincare } from './math/poincare';
import { DiskView } from './render/diskView';
import type { ViewState } from './render/diskView';
import { Hud } from './render/hud';
import { KeyView } from './render/keyView';
import { KeyboardInput } from './input/KeyboardInput';
import { SerialInput } from './input/SerialInput';
import { CombinedInput } from './input/CombinedInput';
import { FIT_SCALE, Game } from './game/game';
import { LEVELS } from './game/level';
import { Sound } from './audio';
import { Autopilot, shortestRoute, waypoints } from './game/autopilot';
import { identity4 } from './math/four';
import { loadSettings, saveSettings, settingsForm } from './settings';
import type { Settings } from './settings';

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
const keyView = new KeyView();
const sound = new Sound();
const INSET_MARGIN = 16;
let insetSize = 240;
let settings = loadSettings();

let levelIndex = 0;
let paused = true;
let markedPosts = new Set<number>();
/** Pillars to pulse after a loop closes, with the time (s) their highlight ends. */
const loopPillars = new Map<number, number>();
/** Whether the level 3 explanation has been shown this session. */
let ahaShown = false;
let wasTwisting = false;

// ---- Demo: level 3 plays itself --------------------------------------------------

type DemoStep = { route: number[] } | { toGoal: true } | { wait: number };
const DEMO_LEVEL = 2;
const DEMO_STEPS: DemoStep[] = [
  // Straight to the gate: no curvature turn, so the key does not fit.
  { route: [0, 4, 18, 5] },
  { wait: 2 },
  // Back and once round the glowing pillar, counter-clockwise: −72°.
  { route: [5, 0, 4, 18, 5] },
  { wait: 1.5 },
  { toGoal: true },
];
let demo: { pilot: Autopilot; step: number; started: boolean; wait: number } | null = null;

function startDemo(): void {
  ahaShown = false;
  startLevel(DEMO_LEVEL);
  hud.hideCard();
  paused = false;
  demo = { pilot: new Autopilot(game), step: 0, started: false, wait: 0 };
  hud.flash('DEMO · press any key to take over');
}

function stopDemo(): void {
  if (demo) hud.flash('YOUR TURN');
  demo = null;
}

/** Advances the demo script; returns the input to use this frame. */
function demoInput(dt: number): Autopilot | null {
  if (!demo) return null;
  const s = DEMO_STEPS[demo.step];
  if (!s) {
    demo = null;
    return null;
  }
  if (!demo.started) {
    demo.started = true;
    if ('route' in s) demo.pilot.setPoints(waypoints(game, s.route));
    if ('toGoal' in s) demo.pilot.setPoints(waypoints(game, shortestRoute(game, game.room, game.level.spec.goal)));
    if ('wait' in s) demo.wait = s.wait;
  }
  demo.pilot.update();
  const finished = 'wait' in s ? (demo.wait -= dt) <= 0 : demo.pilot.done();
  if (finished) {
    demo.step++;
    demo.started = false;
  }
  return demo.pilot;
}

/** Pushes settings into the game and the controller input, and remembers them. */
function applySettings(s: Settings): void {
  settings = s;
  game.settings.marble.damping = s.damping;
  game.settings.tolerance = s.tolerance;
  serial.tiltSettings = { fullTiltDeg: s.fullTiltDeg, deadzone: s.deadzone, invertX: s.invertX, invertY: s.invertY, swapXY: s.swapXY };
  serial.twistMapping = { axes: [...s.twistAxes], signs: s.twistInvert.map((inv) => (inv ? -1 : 1)) as [number, number, number] };
  sound.enabled = s.sound;
  saveSettings(s);
}
applySettings(settings);

function startLevel(index: number): void {
  levelIndex = index;
  const spec = LEVELS[index];
  game.load(spec);
  view.setLevel(game.level.world, spec, game.settings.marble.radius);
  markedPosts = new Set((spec.markedPillars ?? []).map(([t, k]) => game.level.world.roomPosts[t][k]));
  loopPillars.clear();
  hud.clearLabels();
  hud.setLevel(index, spec.name, spec.hint);
  paused = true;
  hud.showCard(`Level ${index + 1} · ${spec.name}`, spec.intro, 'Start', () => {
    paused = false;
  });
}

/** Pauses with a card; resumes when it closes. */
function pauseWith(title: string, body: string, action: string, extra?: HTMLElement, wide = false): void {
  const wasPaused = paused;
  paused = true;
  hud.showCard(title, body, action, () => {
    paused = wasPaused;
  }, extra, wide);
}

function showLevels(): void {
  const grid = document.createElement('div');
  grid.className = 'level-grid';
  LEVELS.forEach((spec, i) => {
    const b = document.createElement('button');
    b.className = 'hud-button';
    b.textContent = `${i + 1} · ${spec.name}`;
    b.addEventListener('click', () => startLevel(i));
    grid.appendChild(b);
  });
  pauseWith('Levels', '', 'Close', grid);
}

function showHelp(): void {
  const table = document.createElement('table');
  table.className = 'help-table';
  const rows: [string, string][] = [
    ['Arrows / WASD / drag', 'Tilt the board to roll the marble'],
    ['Space · BOOT button', 'Toggle twist mode (turn the key through 4D)'],
    ['Q / A', 'Twist in the XW plane (in twist mode; or Shift+Q/A)'],
    ['W / S', 'Twist in the YW plane'],
    ['E / D', 'Twist in the ZW plane'],
    ['R', 'Reset the key (undo all twists)'],
    ['T', 'Show or hide the holonomy trail'],
    ['M', 'Sound on or off'],
    ['H', 'This help'],
  ];
  for (const [k, v] of rows) {
    const tr = table.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = v;
  }
  pauseWith(
    'How to play',
    'Roll the marble to the golden room. Magenta gates open only when the key, the tesseract in the corner, matches its ghost.\n' +
      'You can turn the key two ways: twist it through the fourth dimension, or roll around a pillar and let the curvature of space turn it. Each lap around a pillar turns it 72°.',
    'Close',
    table,
    true,
  );
}

function showSettings(): void {
  pauseWith('Settings', '', 'Done', settingsForm(settings, applySettings), true);
}

/** The level 3 "aha" moment: what just happened to the key, with the angle-sum formula. */
function showAha(degrees: number): void {
  // During the demo the card closes itself after a while.
  if (demo) window.setTimeout(() => hud.closeCard(), 9000);
  const formula = document.createElement('div');
  formula.className = 'formula';
  formula.textContent = 'turn = area = (n − 2)·180° − Σ angles = 2·180° − 4·72° = 72°';
  pauseWith(
    'Curvature turned your key',
    `You rolled once around the pillar and came back, yet the key has turned ${Math.abs(degrees)}°, and so has the whole maze around you.\n` +
      'The four rooms around a pillar form a square. In flat space its corners would be 90°, but in this curved space each one is only 72°. Carry anything around a closed path and it comes back turned by the area the path encloses:',
    'Back to the maze',
    formula,
  );
  const more = document.createElement('p');
  more.textContent =
    'This is holonomy: in curved space, the path you take changes the object you carry. Go around the other way and it turns the other way; go around a whole tile (five pillars) and it turns a full 360°. Now take the key to the gate.';
  formula.after(more);
}

// ---- Buttons and keys ----------------------------------------------------------

if (SerialInput.supported()) {
  const connectButton = hud.button('Connect controller', 'Pick the ESP32 serial port (Chrome or Edge)', () => {
    if (serial.connected()) {
      void serial.disconnect();
      return;
    }
    serial.connect().catch((err: unknown) => {
      // Cancelling the port picker is not an error worth shouting about.
      if (!(err instanceof DOMException && err.name === 'NotFoundError')) {
        pauseWith('Could not open the controller', `${String(err)}\nIs another program (a serial monitor) using the port?`, 'OK');
      }
    });
  });
  setInterval(() => {
    connectButton.textContent = serial.connected() ? 'Disconnect controller' : 'Connect controller';
  }, 500);
  hud.button('Set level', 'Hold the controller the way you want "flat" to be, then click', () => {
    if (!serial.setLevel()) pauseWith('No controller data yet', 'Connect the controller first.', 'OK');
  });
} else {
  hud.button('Controller: use Chrome or Edge', 'Web Serial is not available in this browser', () => {});
}
hud.button('Reset key (R)', 'Undo all twists', () => {
  game.key = identity4();
});
hud.button('Watch demo', 'Level 3 plays itself: the curvature trick', startDemo);
hud.button('Levels', 'Choose a level', showLevels);
hud.button('Settings', 'Sensitivity, deadzone, twist mapping, tolerance', showSettings);
hud.button('Help (H)', 'Controls', showHelp);
hud.button('Restart', 'Restart this level', () => startLevel(levelIndex));

window.addEventListener('keydown', (e) => {
  sound.unlock();
  if (demo && !hud.cardVisible()) stopDemo();
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
  if (e.repeat) return;
  if (e.code === 'KeyH' && !hud.cardVisible()) showHelp();
  if (e.code === 'KeyT') applySettings({ ...settings, trail: !settings.trail });
  if (e.code === 'KeyM') applySettings({ ...settings, sound: !settings.sound });
});
window.addEventListener('pointerdown', () => sound.unlock());

const resize = () => {
  view.resize(window.innerWidth, window.innerHeight);
  insetSize = Math.round(Math.max(140, Math.min(270, Math.min(window.innerWidth, window.innerHeight) * 0.3)));
  hud.setInset(insetSize, INSET_MARGIN);
};
window.addEventListener('resize', resize);
resize();

// ---- Frame loop ------------------------------------------------------------------

function viewState(): ViewState {
  const highlight = new Set(markedPosts);
  for (const [id, until] of loopPillars) {
    if (until > game.time) highlight.add(id);
    else loopPillars.delete(id);
  }
  return {
    time: game.time,
    twistMode: game.twistMode,
    gateGlow: game.gates.map((_, i) => (game.gateReading?.index === i ? game.gateGlow() : 0)),
    gateOpen: game.gates.map((g) => g.open),
    highlightPosts: highlight,
    trail: settings.trail ? game.trail : null,
  };
}

function draw(): void {
  const viewInverse = lorentzInverse(game.viewFrame());
  view.render(viewInverse, viewState());
  keyView.update(game.key, game.gateReading?.ghost ?? null, performance.now() / 1000);
  keyView.render(view.renderer, window.innerWidth - insetSize - INSET_MARGIN, INSET_MARGIN, insetSize);
  hud.updateLabels((anchor) => {
    const [x, y] = toPoincare(apply(viewInverse, anchor as Vec3));
    return view.diskToScreen(x, y);
  });
}

/** Turns game events into sound, labels and overlays. */
function handleEvents(): void {
  if (game.lastImpact > 0) {
    sound.hit(game.lastImpact);
    game.lastImpact = 0;
  }
  if (game.twistMode !== wasTwisting) {
    sound.twist(game.twistMode);
    wasTwisting = game.twistMode;
  }
  for (const _ of game.openedEvents.splice(0)) {
    sound.gateOpen();
    hud.flash('GATE OPEN');
  }
  for (const loop of game.loopEvents.splice(0)) {
    sound.loop(loop.degrees);
    const n = loop.pillars.length;
    hud.addLabel(`${loop.degrees > 0 ? '+' : ''}${loop.degrees}°${n > 1 ? ` (${n} pillars)` : ''}`, loop.where);
    for (const id of loop.pillars) loopPillars.set(id, game.time + 4);
    if (levelIndex === DEMO_LEVEL && !ahaShown && loop.degrees !== 0) {
      ahaShown = true;
      showAha(loop.degrees);
    }
  }
}

function step(dt: number): void {
  input.update(dt);
  keyboard.twistMode = game.twistMode;
  if (paused) return;
  game.update(dt, demoInput(dt) ?? input);
  input.vibrate(game.gateGlow());
  handleEvents();
  if (game.completed) {
    paused = true;
    sound.complete();
    const last = levelIndex === LEVELS.length - 1;
    hud.showCard(
      last ? 'You made it home' : 'Level complete',
      last
        ? 'You carried the key through curved space and the fourth dimension. Every twist and every loop you rolled is still in it.'
        : `Solved in ${Math.round(game.time)} s.`,
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
    holonomyDeg: ((game.gateReading?.holonomy ?? game.holonomy()) * 180) / Math.PI,
    fit: game.gateReading ? Math.max(0, 1 - game.gateReading.distance / FIT_SCALE) : null,
    fitThreshold: 1 - game.settings.tolerance / FIT_SCALE,
  });
  requestAnimationFrame(tick);
}

startLevel(0);
requestAnimationFrame(tick);

if (import.meta.env.DEV) {
  // Dev hooks for testing in a hidden tab, where requestAnimationFrame is paused.
  Object.assign(window, {
    __game: game,
    __demo: startDemo,
    /** Drives the marble through a room route with the autopilot (simulated time). */
    __drive(rooms: number[], maxSeconds = 60) {
      const pilot = new Autopilot(game, waypoints(game, rooms));
      for (let t = 0; t < maxSeconds && !pilot.done(); t += 1 / 60) {
        game.update(1 / 60, pilot);
        pilot.update();
        handleEvents();
      }
      draw();
      return pilot.done();
    },
    __start(index: number) {
      startLevel(index);
      hud.hideCard();
      paused = false;
    },
    /** Puts the marble at a room's centre, carrying the key along the direct route. */
    __teleport(room: number) {
      const ref = game.level.references[room];
      if (!ref) throw new Error(`room ${room} is not in the maze`);
      game.marble.frame = [...ref] as typeof ref;
      game.marble.vel = [0, 0];
      game.carry = [...ref] as typeof ref;
      game.room = room;
      game.cameraOffset = 0;
      game.rebuildColliders();
      draw();
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
