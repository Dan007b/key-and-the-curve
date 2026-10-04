// Phase Escape entry point: wires the game, the views, the HUD, sound and the inputs together.

import './style.css';
import { apply, lorentzInverse } from './math/lorentz';
import type { Mat3, Vec3 } from './math/lorentz';
import { toPoincare } from './math/poincare';
import { DiskView } from './render/diskView';
import type { ViewState } from './render/diskView';
import { Hud } from './render/hud';
import { KeyView } from './render/keyView';
import { KeyboardInput } from './input/KeyboardInput';
import { SerialInput } from './input/SerialInput';
import { CombinedInput } from './input/CombinedInput';
import { Game, LIVES } from './game/game';
import { LEVELS } from './game/level';
import { LAYER_CSS, LAYER_NAMES, LAYER_RGB, holonomySteps } from './game/phase';
import { Autopilot, waypoints } from './game/autopilot';
import { Sound } from './audio';
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
/** Pillars to pulse after a loop closes, with the game time their highlight ends. */
const loopPillars = new Map<number, number>();
/** One-time explanation of curvature phasing (this session). */
let ahaShown = false;

/** Pushes settings into the game and the controller input, and remembers them. */
function applySettings(s: Settings): void {
  settings = s;
  game.settings.marble.damping = s.damping;
  serial.tiltSettings = { fullTiltDeg: s.fullTiltDeg, deadzone: s.deadzone, invertX: s.invertX, invertY: s.invertY, swapXY: s.swapXY };
  serial.phaseGain = s.phaseGain;
  serial.phaseInvert = s.phaseInvert;
  sound.enabled = s.sound;
  saveSettings(s);
}
applySettings(settings);

function startLevel(index: number, showIntro = true): void {
  levelIndex = index;
  const spec = LEVELS[index];
  game.load(spec);
  view.setLevel(game.level.world, spec, game.settings.marble.radius);
  markedPosts = new Set((spec.markedPillars ?? []).map(([t, k]) => game.level.world.roomPosts[t][k]));
  loopPillars.clear();
  hud.clearLabels();
  hud.setLevel(index, spec.name, spec.hint);
  paused = true;
  if (showIntro) {
    hud.showCard(`Level ${index + 1} · ${spec.name}`, spec.intro, 'Start', () => {
      paused = false;
    });
  }
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
    ['Arrows / WASD / drag', 'Roll the marble (or tilt the controller)'],
    ['Q / E', 'Phase down / up one layer through the fourth dimension'],
    ['Space', 'Phase up one layer'],
    ['Controller', 'Tilt to roll; turn it like a dial to phase; BOOT = phase up'],
    ['R', 'Restart the level'],
    ['T · M · H', 'Trail · sound · this help'],
  ];
  for (const [k, v] of rows) {
    const tr = table.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = v;
  }
  pauseWith(
    'How to play',
    'Grab every shard ◆, then roll into the portal. Hunters take a life when they touch you; lose three and you are caught.\n' +
      'The maze has a fourth dimension: five layers, five colours. You exist in one at a time. Doors open only in their own colour, shards can only be grabbed in theirs, and hunters can only see and touch you in theirs. Phase to slip through doors and away from hunters.\n' +
      'Space is curved here. Roll once around a pillar and you come back one layer over (clockwise = up, counter-clockwise = down): the curvature itself moves you through the fourth dimension.',
    'Close',
    table,
    true,
  );
}

function showSettings(): void {
  pauseWith('Settings', '', 'Done', settingsForm(settings, applySettings), true);
}

/** The holonomy moment: the first time a loop shifts your layer. */
function showAha(degrees: number, to: number): void {
  if (demo) window.setTimeout(() => hud.closeCard(), 9000);
  const formula = document.createElement('div');
  formula.className = 'formula';
  formula.textContent = 'turn = (4 − 2)·180° − 4·72° = 72° = one layer';
  pauseWith(
    'Space just moved you through the fourth dimension',
    `You rolled once around the pillar and came back ${LAYER_NAMES[to]}, without touching the controls. That lap turned you ${degrees > 0 ? '+' : ''}${degrees}°.\n` +
      'The four rooms around a pillar form a square. In flat space its corners would be 90°, but in this curved space each is only 72°. Anything carried around a closed path comes back turned by the area it encloses:',
    'Back to the maze',
    formula,
  );
  const more = document.createElement('p');
  more.textContent =
    'Five laps make 360°, a full trip around the fourth dimension. This is holonomy: in curved space, the path you take changes you. Clockwise laps go up a layer, counter-clockwise go down.';
  formula.after(more);
}

// ---- Demo: level 3 plays itself --------------------------------------------------

/** Each step is a route through rooms, or a single room centre to roll to. */
type DemoStep = { route: number[] } | { center: number };
const DEMO_LEVEL = 2;
const DEMO_STEPS: DemoStep[] = [
  { route: [0, 4] },
  { center: 4 }, // red shard
  { route: [4, 18, 5, 0, 4, 18] }, // counter-clockwise lap: red → violet
  { center: 18 }, // violet shard
  { route: [18, 4, 0, 5, 18, 4, 0, 5] }, // two clockwise laps: violet → gold
  { route: [5, 6, 1] }, // through the gold door
  { center: 1 }, // gold shard
  { route: [1, 9, 2, 10, 3, 13] }, // to the portal
];
let demo: { pilot: Autopilot; step: number; started: boolean } | null = null;

function startDemo(): void {
  ahaShown = false;
  startLevel(DEMO_LEVEL, false);
  paused = false;
  demo = { pilot: new Autopilot(game), step: 0, started: false };
  hud.flash('DEMO · press any key to take over', '#ffffff');
}

/** Advances the demo script; returns the input to use this frame. */
function demoInput(): Autopilot | null {
  if (!demo) return null;
  const s = DEMO_STEPS[demo.step];
  if (!s) {
    demo = null;
    return null;
  }
  if (!demo.started) {
    demo.started = true;
    demo.pilot.setPoints('route' in s ? waypoints(game, s.route) : [game.level.tiling.tiles[s.center].center]);
  }
  demo.pilot.update();
  if (demo.pilot.done()) {
    demo.step++;
    demo.started = false;
  }
  return demo.pilot;
}

// ---- Buttons and keys ----------------------------------------------------------

if (SerialInput.supported()) {
  const connectButton = hud.button('Connect controller', 'Pick the ESP32 serial port', () => {
    if (serial.connected()) {
      void serial.disconnect();
      return;
    }
    serial.connect().catch((err: unknown) => {
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
}
hud.button('Watch demo', 'Level 3 plays itself: curvature moves you through the fourth dimension', startDemo);
hud.button('Levels', 'Choose a level', showLevels);
hud.button('Settings', 'Controller feel, friction, trail, sound', showSettings);
hud.button('Help (H)', 'How to play', showHelp);
hud.button('Restart (R)', 'Restart this level', () => startLevel(levelIndex));

window.addEventListener('keydown', (e) => {
  sound.unlock();
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
  if (demo && !hud.cardVisible()) {
    demo = null;
    hud.flash('YOUR TURN', '#ffffff');
  }
  if (e.repeat) return;
  if (e.code === 'KeyH' && !hud.cardVisible()) showHelp();
  if (e.code === 'KeyR' && !hud.cardVisible()) startLevel(levelIndex);
  if (e.code === 'KeyT') applySettings({ ...settings, trail: !settings.trail });
  if (e.code === 'KeyM') applySettings({ ...settings, sound: !settings.sound });
});
window.addEventListener('pointerdown', () => sound.unlock());

const resize = () => {
  view.resize(window.innerWidth, window.innerHeight);
  insetSize = Math.round(Math.max(140, Math.min(250, Math.min(window.innerWidth, window.innerHeight) * 0.28)));
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
  const { tiles } = game.level.tiling;
  return {
    time: game.time,
    layer: game.layer,
    shards: game.shards.map((s) => ({ position: tiles[s.spec.tile].center, layer: s.spec.layer, collected: s.collected })),
    hunters: game.hunters.map((h) => ({ position: h.position, layer: h.layer, chasing: h.chasing })),
    exit: { position: tiles[game.level.spec.exit].center, open: game.exitOpen() },
    invulnerable: game.invulnerable,
    highlightPosts: highlight,
    trail: settings.trail ? game.trail : null,
  };
}

function draw(): void {
  const viewInverse = lorentzInverse(game.viewFrame());
  view.render(viewInverse, viewState());
  keyView.update(game.phaseDeg(), LAYER_RGB[game.layer], performance.now() / 1000);
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
  let lastLoopDegrees = 0;
  for (const loop of game.loopEvents.splice(0)) {
    lastLoopDegrees = loop.degrees;
    sound.loop(loop.degrees);
    const steps = Math.round(loop.degrees / 72);
    hud.addLabel(`${loop.degrees > 0 ? '+' : ''}${loop.degrees}° · ${steps > 0 ? '+' : ''}${steps} layer`, loop.where);
    for (const id of loop.pillars) loopPillars.set(id, game.time + 4);
  }
  for (const e of game.phaseEvents.splice(0)) {
    sound.phase(e.to, e.cause === 'curvature');
    hud.flash(e.cause === 'curvature' ? `CURVATURE → ${LAYER_NAMES[e.to].toUpperCase()}` : `→ ${LAYER_NAMES[e.to].toUpperCase()}`, LAYER_CSS[e.to]);
    if (e.cause === 'curvature' && !ahaShown && levelIndex === DEMO_LEVEL) {
      ahaShown = true;
      showAha(lastLoopDegrees, e.to);
    }
  }
  for (const _ of game.pickupEvents.splice(0)) {
    if (game.exitOpen()) {
      sound.portalOpen();
      hud.flash('ALL SHARDS · PORTAL OPEN', '#ffffff');
    } else {
      sound.pickup();
      hud.flash(`SHARD · ${game.shards.length - game.shardsLeft()}/${game.shards.length}`, '#ffffff');
    }
  }
  if (game.hitEvents > 0) {
    game.hitEvents = 0;
    sound.hurt();
    if (game.status !== 'lost') hud.flash(`HIT · ${game.lives} ${game.lives === 1 ? 'life' : 'lives'} left`, '#ff5a6e');
  }
}

function step(dt: number): void {
  input.update(dt);
  if (paused) return;
  game.update(dt, demoInput() ?? input);
  input.vibrate(game.danger());
  handleEvents();
  if (game.status === 'won') {
    paused = true;
    demo = null;
    sound.complete();
    const t = Math.round(game.time);
    const par = game.level.spec.par;
    const stars = game.lives === LIVES && t <= par ? 3 : t <= par * 1.5 ? 2 : 1;
    const last = levelIndex === LEVELS.length - 1;
    hud.showCard(
      last ? 'You escaped' : 'Level complete',
      `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}   ${t} s (par ${par} s) · ${game.lives}/${LIVES} lives\n` +
        (last ? 'You outran the hunters through five dimensions of curved space.' : ''),
      last ? 'Play again' : 'Next level',
      () => startLevel(last ? 0 : levelIndex + 1),
    );
  } else if (game.status === 'lost') {
    paused = true;
    demo = null;
    sound.caught();
    hud.showCard('Caught', `The hunters got you after ${Math.round(game.time)} s. Phase out of their colour when they close in.`, 'Try again', () => startLevel(levelIndex, false));
    window.setTimeout(() => {
      if (!hud.cardVisible()) paused = false;
    }, 0);
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
    layer: game.layer,
    phaseDeg: game.phaseDeg(),
    curvatureSteps: holonomySteps(game.holonomy()),
    twistAllowed: game.twistAllowed(),
    lives: game.lives,
    maxLives: LIVES,
    shards: game.shards.map((s) => ({ layer: s.spec.layer, collected: s.collected })),
    hunterLayers: game.hunters.map((h) => h.layer),
    time: game.time,
    danger: game.danger(),
  });
  requestAnimationFrame(tick);
}

/**
 * ?scene=… sets up a showcase state (used for the README screenshots):
 * title (level 1), doors (level 1 at a door), hunted (level 2 with a hunter
 * closing in), curvature (level 3 just after a pillar lap), final (level 5).
 */
function setupScene(scene: string): void {
  ahaShown = true;
  const drive = (rooms: number[]) => {
    const pilot = new Autopilot(game, waypoints(game, rooms));
    for (let t = 0; t < 60 && !pilot.done(); t += 1 / 60) {
      game.update(1 / 60, pilot);
      pilot.update();
    }
  };
  const begin = (index: number) => {
    startLevel(index, false);
    hud.hideCard();
    paused = false;
  };
  if (scene === 'title') begin(0);
  if (scene === 'doors') {
    begin(0);
    drive([0, 4, 14]);
  }
  if (scene === 'hunted') {
    begin(1);
    for (let t = 0; t < 3.5; t += 1 / 60) game.update(1 / 60, new Autopilot(game));
  }
  if (scene === 'curvature') {
    begin(2);
    drive([0, 4, 18, 5, 0]);
    handleEvents();
  }
  if (scene === 'final') {
    begin(4);
    drive([0, 4, 14, 3]);
  }
}

startLevel(0);
const scene = new URLSearchParams(location.search).get('scene');
if (scene) {
  // Showcase shots are often taken headless with a software renderer, whose FPS is meaningless.
  document.body.classList.add('scene');
  setupScene(scene);
}
requestAnimationFrame(tick);

if (import.meta.env.DEV) {
  // Dev hooks for testing in a hidden tab, where requestAnimationFrame is paused.
  Object.assign(window, {
    __game: game,
    __demo: startDemo,
    __start(index: number) {
      startLevel(index, false);
      paused = false;
    },
    /** Puts the marble at a room's centre, carried along the direct route. */
    __teleport(room: number) {
      const ref = game.level.references[room];
      if (!ref) throw new Error(`room ${room} is not in the maze`);
      game.marble.frame = [...ref] as Mat3;
      game.marble.vel = [0, 0];
      game.carry = [...ref] as Mat3;
      game.room = room;
      game.cameraOffset = 0;
      game.rebuildColliders();
      draw();
    },
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
