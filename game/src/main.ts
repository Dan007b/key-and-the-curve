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
import { ControllerInput } from './input/ControllerInput';
import type { Link } from './input/ControllerInput';
import { CombinedInput } from './input/CombinedInput';
import { Game, LIVES } from './game/game';
import { LEVELS, levelIndex as indexOfLevel } from './game/level';
import { LAYERS, LAYER_CSS, LAYER_NAMES, LAYER_RGB, holonomySteps, mod } from './game/phase';
import { Autopilot, waypoints } from './game/autopilot';
import { roomDistances } from './game/maze';
import { Sound } from './audio';
import { Music } from './music';
import { SHIFT_WARNING } from './game/hunter';
import { Tutorial } from './game/tutorial';
import { TABLE_SIZE, formatTime, insertRun, loadPlayerName, loadScores, rankOf, savePlayerName, saveScores, starsFor } from './scores';
import type { ScoreEntry } from './scores';
import { loadSettings, saveSettings, settingsForm } from './settings';
import { holonomyFigure } from './render/explain';
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
const controller = new ControllerInput();
const input = new CombinedInput(keyboard, controller);
const game = new Game();
const keyView = new KeyView();
const sound = new Sound();
const music = new Music();
const INSET_MARGIN = 16;
let insetSize = 240;
let settings = loadSettings();

let levelIndex = 0;
let paused = true;
let markedPosts = new Set<number>();
/** Tutorial tips for the teaching levels (null on other levels, or when turned off). */
let tutorial: Tutorial | null = null;
/** Pillars to pulse after a loop closes, with the game time their highlight ends. */
const loopPillars = new Map<number, number>();
/** One-time explanation of curvature phasing (this session). */
let ahaShown = false;

/** Pushes settings into the game and the controller input, and remembers them. */
function applySettings(s: Settings): void {
  settings = s;
  game.settings.marble.damping = s.damping;
  controller.tiltSettings = { fullTiltDeg: s.fullTiltDeg, deadzone: s.deadzone, invertX: s.invertX, invertY: s.invertY, swapXY: s.swapXY };
  controller.phaseGain = s.phaseGain;
  controller.phaseInvert = s.phaseInvert;
  sound.enabled = s.sound;
  music.configure(s.sound && s.music, s.musicVolume);
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
  tutorial = settings.tutorial ? new Tutorial(spec.name) : null;
  if (tutorial && !tutorial.active()) tutorial = null;
  hud.setTip(null);
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
  const book = loadScores();
  LEVELS.forEach((spec, i) => {
    const b = document.createElement('button');
    b.className = 'hud-button';
    const best = book[spec.name]?.[0];
    const name = document.createElement('span');
    name.textContent = `${i + 1} · ${spec.name}`;
    const record = document.createElement('span');
    record.className = best ? 'level-best' : 'level-best none';
    record.textContent = best ? `${stars(best.stars)} ${formatTime(best.time)}` : 'not finished yet';
    b.append(name, record);
    b.addEventListener('click', () => startLevel(i));
    grid.appendChild(b);
  });
  pauseWith('Levels', '', 'Close', grid, true);
}

/** ★★☆ */
function stars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

/**
 * A level's top runs as a table. If `entry` is given and makes the table, it
 * is shown at its rank with a name box, which is handed to `nameBox`.
 */
function scoreTable(levelName: string, entry: ScoreEntry | null, nameBox?: (input: HTMLInputElement) => void): HTMLElement {
  const table = document.createElement('table');
  table.className = 'score-table';
  const head = table.createTHead().insertRow();
  for (const h of ['#', 'Name', 'Time', 'Stars', 'Lives']) head.insertCell().textContent = h;
  const body = table.createTBody();
  const runs = loadScores()[levelName] ?? [];
  const rank = entry ? rankOf(runs, entry) : -1;
  const rows = rank === -1 ? runs : insertRun(runs, entry!);
  rows.forEach((run, i) => {
    const tr = body.insertRow();
    if (i === rank) tr.className = 'new';
    tr.insertCell().textContent = String(i + 1);
    const nameCell = tr.insertCell();
    if (i === rank && nameBox) {
      const input = document.createElement('input');
      input.maxLength = 14;
      input.placeholder = 'Your name';
      input.value = run.name;
      input.className = 'score-name';
      nameCell.appendChild(input);
      nameBox(input);
    } else {
      nameCell.textContent = run.name;
    }
    tr.insertCell().textContent = formatTime(run.time);
    tr.insertCell().textContent = stars(run.stars);
    tr.insertCell().textContent = String(run.lives);
  });
  if (rows.length === 0) {
    const cell = body.insertRow().insertCell();
    cell.colSpan = 5;
    cell.className = 'empty';
    cell.textContent = 'No runs yet.';
  }
  return table;
}

function showScores(): void {
  const wrap = document.createElement('div');
  wrap.className = 'score-book';
  LEVELS.forEach((spec, i) => {
    const h = document.createElement('h2');
    h.textContent = `${i + 1} · ${spec.name}`;
    wrap.append(h, scoreTable(spec.name, null));
  });
  const clear = document.createElement('button');
  clear.className = 'hud-button';
  clear.textContent = 'Clear all scores';
  clear.addEventListener('click', () => {
    if (!window.confirm('Delete every saved score in this browser?')) return;
    saveScores({});
    hud.closeCard();
    showScores();
  });
  wrap.appendChild(clear);
  pauseWith('High scores', `Your ${TABLE_SIZE} best runs of each level, saved in this browser. Ranked by stars, then time.`, 'Close', wrap, true);
}

function showHelp(): void {
  const table = document.createElement('table');
  table.className = 'help-table';
  const rows: [string, string][] = [
    ['Arrows / WASD / drag', 'Roll the marble (or tilt the controller)'],
    ['Q / E', 'Phase down / up one layer through the fourth dimension'],
    ['Space', 'Phase up one layer'],
    ['Shift + arrows / WASD', 'Turn your 4D view (the tesseract): left/right in XW, up/down in YW'],
    ['F', 'Straighten your 4D view'],
    ['Controller', 'Tilt to roll; turn it like a dial to phase; tap BOOT = phase up; hold BOOT and tilt = turn your 4D view'],
    ['R', 'Restart the level'],
    ['T · M · N · H', 'Trail · sound · music · this help'],
  ];
  for (const [k, v] of rows) {
    const tr = table.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = v;
  }
  const extra = document.createElement('div');
  const section = (title: string, ...paras: string[]) => {
    if (title) {
      const h = document.createElement('h2');
      h.className = 'help-heading';
      h.textContent = title;
      extra.appendChild(h);
    }
    for (const t of paras) {
      const p = document.createElement('p');
      p.textContent = t;
      extra.appendChild(p);
    }
  };
  extra.appendChild(table);
  section(
    'When can a hunter hurt me?',
    'Only when it is the same colour as you. Then it can see you (a line joins you to it), it chases you, and touching you costs a life. In any other colour it is a faint ghost that cannot see or touch you. The top right says how many hunters can see you right now. When one is close, change colour.',
  );
  section(
    'Why does a lap round a pillar change my colour?',
    'You carry a needle that you never turn yourself: it is the white pointer on the ring in the corner, and the colour under it is your colour. Q and E turn the needle. A lap round a pillar turns it too, because this space is curved:',
  );
  extra.appendChild(holonomyFigure());
  section(
    '',
    'The four rooms round a pillar make a square whose corners are 72°, not 90°. Going round it you turn 108° at each corner, 432° in all: one full turn plus 72°. You end up facing the way you started, but the needle is 72° off, which is one colour. On the ring, the colour wheel turns under the needle. Counter-clockwise laps go down a colour, clockwise laps go up.',
    'Straight lines here behave differently from on a sphere: between two points there is exactly one straight path. What changes is how you arrive. Two different routes to the same room bring you there turned differently, by 72° for every pillar between the two routes.',
  );
  section(
    'What does the tesseract do?',
    'It is your view into the fourth dimension. Hold Shift and use the arrows (or hold BOOT and tilt) to turn it. Planks over rifts are four-dimensional, so you only see their shadows; turning your view moves the shadows. When a plank lies flat across its rift, it becomes a bridge.',
  );
  pauseWith(
    'How to play',
    'Grab every shard ◆, then roll into the portal. Lose three lives to the hunters and you are caught.\n' +
      'The maze has a fourth dimension: five layers, five colours. You are in one at a time. Doors open only in their own colour, and shards can only be grabbed in theirs. Shifters are hunters that change colour every few seconds: the dashed ring around one is the colour it moves into next.',
    'Close',
    extra,
    true,
  );
}

function showSettings(): void {
  pauseWith('Settings', '', 'Done', settingsForm(settings, applySettings), true);
}

/** The holonomy moment: the first time a loop shifts your layer. */
function showAha(degrees: number, to: number): void {
  if (demo) window.setTimeout(() => hud.closeCard(), 9000);
  const extra = document.createElement('div');
  extra.appendChild(holonomyFigure());
  const formula = document.createElement('div');
  formula.className = 'formula';
  formula.textContent = '4 × 108° − 360° = 72° = (4 − 2)·180° − 4·72°, the square\'s area';
  const more = document.createElement('p');
  more.textContent =
    'Your colour is just the colour under your needle (the white pointer on the ring in the corner), so 72° is exactly one colour: watch the wheel turn under the needle. Counter-clockwise laps go down a colour, clockwise laps go up, and five laps bring you all the way round. This is holonomy: in curved space, the path you take turns what you carry.';
  extra.append(formula, more);
  pauseWith(
    'The curvature of space turned you',
    `You rolled once around the pillar and came back ${LAYER_NAMES[to]}, without touching the controls. The lap turned your needle ${Math.abs(degrees)}° ${degrees < 0 ? 'clockwise' : 'counter-clockwise'}.\n` +
      'The four rooms round a pillar make a square, but in this curved space its corners are 72°, not 90°. So you turn 108° at each corner, 432° in all: a full turn plus 72°. You face the way you started, but the needle you carried, which you never turned, is now 72° off:',
    'Back to the maze',
    extra,
    true,
  );
}

// ---- Demo: level 3 plays itself --------------------------------------------------

/** Each step is a route through rooms, or a single room centre to roll to. */
type DemoStep = { route: number[] } | { center: number };
const DEMO_LEVEL = indexOfLevel('Curvature');
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

/** Connects the controller over Bluetooth or USB; reports failures (a cancelled chooser is not one). */
function connectController(how: Link): void {
  const attempt = how === 'bluetooth' ? controller.connectBluetooth() : controller.connectSerial();
  attempt.catch((err: unknown) => {
    if (err instanceof DOMException && err.name === 'NotFoundError') return;
    pauseWith(
      'Could not connect the controller',
      how === 'bluetooth'
        ? `${String(err)}\nIs the controller switched on and nearby, and Bluetooth on in Windows? Only one app can use it at a time.`
        : `${String(err)}\nIs another program (a serial monitor) using the port?`,
      'OK',
    );
  });
}

/** Lets you pick Bluetooth or a USB cable. Each button connects straight from its click (browsers require a click). */
function showConnect(): void {
  const row = document.createElement('div');
  row.className = 'connect-choices';
  const choice = (label: string, how: Link) => {
    const b = document.createElement('button');
    b.className = 'hud-button';
    b.textContent = label;
    b.addEventListener('click', () => {
      hud.closeCard();
      connectController(how);
    });
    row.appendChild(b);
  };
  if (ControllerInput.bluetoothSupported()) choice('Bluetooth (wireless)', 'bluetooth');
  if (ControllerInput.serialSupported()) choice('USB cable', 'usb');
  pauseWith(
    'Connect the controller',
    'Bluetooth: switch the controller on and pick "PhaseEscape". No pairing in Windows settings is needed.\nUSB: plug it in with a data cable (and take the batteries out, or switch them off, first).',
    'Cancel',
    row,
  );
}

if (ControllerInput.bluetoothSupported() || ControllerInput.serialSupported()) {
  const connectButton = hud.button('Connect controller', 'Connect the controller over Bluetooth or a USB cable', () => {
    if (controller.connected()) {
      void controller.disconnect();
      return;
    }
    showConnect();
  });
  setInterval(() => {
    connectButton.textContent = controller.connected() ? 'Disconnect controller' : 'Connect controller';
  }, 500);
  hud.button('Set level', 'Hold the controller the way you want "flat" to be, then click', () => {
    if (!controller.setLevel()) pauseWith('No controller data yet', 'Connect the controller first.', 'OK');
  });
}
hud.button('Watch demo', 'Level 3 plays itself: curvature moves you through the fourth dimension', startDemo);
hud.button('Levels', 'Choose a level', showLevels);
hud.button('Scores', 'Your best runs of each level', showScores);
hud.button('Settings', 'Controller feel, friction, trail, sound and music', showSettings);
hud.button('Help (H)', 'How to play', showHelp);
hud.button('Restart (R)', 'Restart this level', () => startLevel(levelIndex));

/** Audio may only start after a user gesture; the music shares the effects' context. */
function unlockAudio(): void {
  sound.unlock();
  music.attach(sound.context());
}

window.addEventListener('keydown', (e) => {
  unlockAudio();
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
  if (e.code === 'KeyF') game.resetLook();
  if (e.code === 'KeyM') applySettings({ ...settings, sound: !settings.sound });
  if (e.code === 'KeyN') applySettings({ ...settings, music: !settings.music });
});
window.addEventListener('pointerdown', unlockAudio);

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
    hunters: game.hunters.map((h) => ({
      position: h.position,
      layer: h.layer,
      chasing: h.chasing,
      shifter: h.shift !== null,
      nextLayer: h.nextLayer,
      warning: h.aboutToShift() ? 1 - h.shiftIn / SHIFT_WARNING : 0,
    })),
    exit: { position: tiles[game.level.spec.exit].center, open: game.exitOpen() },
    invulnerable: game.invulnerable,
    highlightPosts: highlight,
    trail: settings.trail ? game.trail : null,
    look: game.look,
    bridged: game.bridged,
    riftFocus: game.riftFocus,
  };
}

function draw(): void {
  const viewInverse = lorentzInverse(game.viewFrame());
  view.render(viewInverse, viewState());
  keyView.update(game.look, LAYER_RGB[game.layer], performance.now() / 1000);
  keyView.render(view.renderer, window.innerWidth - insetSize - INSET_MARGIN, INSET_MARGIN, insetSize);
  const locate = (anchor: unknown) => {
    const [x, y] = toPoincare(apply(viewInverse, anchor as Vec3));
    return view.diskToScreen(x, y);
  };
  hud.updateLabels(locate);
  hud.updateTip(locate);
  const focus = game.riftFocus;
  if (focus && !paused) {
    const w = game.level.world.walls[focus.wall];
    const lined = Math.round(100 * Math.max(0, 1 - focus.smear / 0.6));
    hud.setRift(`4D plank lined up ${lined}%`, game.level.tiling.tiles[w.tile].midpoints[w.edge]);
  } else {
    hud.setRift(null, null);
  }
  hud.updateRift(locate);
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
    const name = LAYER_NAMES[e.to].toUpperCase();
    if (game.huntersSeeingYou(3).length > 0) {
      // Phasing into a hunter's colour is the moment it can start hurting you: say so.
      sound.alarm();
      hud.flash(`${e.cause === 'curvature' ? 'CURVATURE → ' : '→ '}${name} · A ${name} HUNTER CAN SEE YOU`, LAYER_CSS[e.to]);
    } else {
      hud.flash(e.cause === 'curvature' ? `CURVATURE → ${name}` : `→ ${name}`, LAYER_CSS[e.to]);
    }
    if (e.cause === 'curvature' && !ahaShown && levelIndex === DEMO_LEVEL) {
      ahaShown = true;
      showAha(lastLoopDegrees, e.to);
    }
  }
  for (const _ of game.bridgeEvents.splice(0)) {
    sound.bridge();
    hud.flash('THE PLANK LIES FLAT · BRIDGE BUILT', '#7fe7ff');
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
  for (const e of game.shiftEvents.splice(0)) {
    if (e.to !== game.layer) continue;
    sound.alarm();
    hud.flash(`A HUNTER SHIFTED INTO ${LAYER_NAMES[e.to].toUpperCase()}`, LAYER_CSS[e.to]);
  }
  if (game.hitEvents > 0) {
    game.hitEvents = 0;
    sound.hurt();
    const colour = LAYER_NAMES[game.lastHitLayer].toLowerCase();
    if (game.status !== 'lost') hud.flash(`HIT: you were both ${colour} · ${game.lives} ${game.lives === 1 ? 'life' : 'lives'} left`, '#ff5a6e');
  }
}

function step(dt: number): void {
  input.update(dt);
  music.setMood({ layer: game.layer, danger: paused ? 0 : game.danger(), active: !paused });
  if (paused) return;
  game.update(dt, demoInput() ?? input);
  input.vibrate(game.danger());
  handleEvents();
  if (tutorial && !demo) {
    const tip = tutorial.update(game);
    hud.setTip(tip?.text ?? null, tip && tip.layer !== null ? LAYER_CSS[tip.layer] : undefined, tip?.anchor ?? null);
  }
  if (game.status === 'won') {
    paused = true;
    const watched = demo !== null;
    demo = null;
    sound.complete();
    showWin(watched);
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

/** The level-complete card: stars, time, and the high-score table (with a name box if the run made it). */
function showWin(watched: boolean): void {
  const spec = game.level.spec;
  const time = Math.round(game.time * 10) / 10;
  const n = starsFor(time, game.lives, LIVES, spec.par);
  const last = levelIndex === LEVELS.length - 1;
  const entry: ScoreEntry = { name: loadPlayerName() || 'Player', time, lives: game.lives, stars: n, date: new Date().toLocaleDateString('en-CA') };
  // Demo runs don't count; a real run that makes the table gets a name box.
  const ranked = !watched && rankOf(loadScores()[spec.name] ?? [], entry) !== -1;
  let nameInput: HTMLInputElement | null = null;
  const table = watched ? undefined : scoreTable(spec.name, ranked ? entry : null, (input) => (nameInput = input));
  hud.showCard(
    last ? 'You escaped' : 'Level complete',
    `${stars(n)}   ${formatTime(time)} (par ${formatTime(spec.par)}) · ${game.lives}/${LIVES} lives\n` +
      (ranked ? 'A new high score! Type your name, then press Enter.\n' : '') +
      (last ? 'You outran the hunters through five dimensions of curved space.' : ''),
    last ? 'Play again' : 'Next level',
    () => {
      if (ranked) {
        const name = nameInput?.value.trim() || 'Player';
        savePlayerName(name);
        const book = loadScores();
        book[spec.name] = insertRun(book[spec.name] ?? [], { ...entry, name });
        saveScores(book);
      }
      startLevel(last ? 0 : levelIndex + 1);
    },
    table,
  );
  const box = nameInput as HTMLInputElement | null;
  box?.focus();
  box?.select();
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
    twistDeg: game.twistDeg,
    curvatureSteps: holonomySteps(game.holonomy()),
    twistAllowed: game.twistAllowed(),
    lives: game.lives,
    maxLives: LIVES,
    shards: game.shards.map((s) => ({ layer: s.spec.layer, collected: s.collected })),
    hunters: game.hunters.map((h) => ({ layer: h.layer, shifter: h.shift !== null })),
    time: game.time,
    danger: game.danger(),
    look: game.look,
    seenBy: game.huntersSeeingYou().length,
  });
  requestAnimationFrame(tick);
}

/**
 * ?scene=… sets up a showcase state (used for the README screenshots):
 * title (level 1), doors (level 1 at a door), hunted (Hunted with a hunter
 * closing in), curvature (just after a pillar lap), rift (a 4D plank part-way
 * lined up), shifter (a shifter about to change colour), final (the last level).
 */
/** Puts the marble at a room's centre, carried along the direct route (scenes and dev hooks). */
function teleport(room: number): void {
  const ref = game.level.references[room];
  if (!ref) throw new Error(`room ${room} is not in the maze`);
  game.marble.frame = [...ref] as Mat3;
  game.marble.vel = [0, 0];
  game.carry = [...ref] as Mat3;
  game.room = room;
  game.cameraOffset = 0;
  game.rebuildColliders();
}

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
  if (scene === 'title') begin(indexOfLevel('Slip'));
  if (scene === 'doors') {
    begin(indexOfLevel('Slip'));
    drive([0, 4, 14]);
  }
  if (scene === 'hunted') {
    begin(indexOfLevel('Hunted'));
    for (let t = 0; t < 3.5; t += 1 / 60) game.update(1 / 60, new Autopilot(game));
  }
  if (scene === 'curvature') {
    begin(indexOfLevel('Curvature'));
    drive([0, 4, 18, 5, 0]);
    handleEvents();
  }
  if (scene === 'rift') {
    // Beside the first rift on the Rift level, with the 4D view part-way to its plank.
    begin(indexOfLevel('Rift'));
    const id = game.level.world.walls.findIndex((w) => w.rift);
    const w = game.level.world.walls[id];
    teleport(w.tile);
    game.look = [w.rift![0] - 22, w.rift![1] + 18];
    for (let t = 0; t < 0.2; t += 1 / 60) game.update(1 / 60, new Autopilot(game));
  }
  if (scene === 'shifter') {
    // Two rooms from the shifter, in the colour it is about to move into, just before it does.
    begin(indexOfLevel('Shifter'));
    const shifter = game.hunters.find((h) => h.shift)!;
    const near = roomDistances(game.level.tiling, game.level.maze, shifter.spawn);
    teleport([...near.keys()].find((r) => near.get(r) === 2)!);
    // Phase straight away (out of the red hunter's sight), then wait for the warning.
    const pilot = new Autopilot(game);
    pilot.steps = mod(shifter.nextLayer - game.layer, LAYERS);
    for (let t = 0; t < 10 && !(shifter.shiftIn <= 0.55 && shifter.shiftIn > 0.53); t += 1 / 60) game.update(1 / 60, pilot);
  }
  if (scene === 'final') {
    begin(LEVELS.length - 1);
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
    __music: music,
    __demo: startDemo,
    __start(index: number) {
      startLevel(index, false);
      paused = false;
    },
    /** Puts the marble at a room's centre, carried along the direct route. */
    __teleport(room: number) {
      teleport(room);
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
