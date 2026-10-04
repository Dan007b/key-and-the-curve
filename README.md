# Phase Escape

**A chase through a maze in curved space with a fourth dimension. Phase between dimensions to slip through doors and lose the hunters, and let the curvature of space shift you too.**

Built for the StormHacks 2026 challenge *Beyond Euclid: Interactive Experiences in Impossible Geometries*, with an optional handheld controller (ESP32 + orientation sensor).

![After a lap around a pillar, space itself has shifted the marble from red to violet](docs/screenshots/curvature.png)

## How it plays

You are a marble in a maze on the **hyperbolic plane**: pentagonal rooms, four meeting at every corner, drawn in the Poincaré disk. Rooms crowd towards the rim because hyperbolic space grows exponentially: there is always more maze ahead.

The maze also has a **fourth dimension**: five layers, five colours. You exist in one layer at a time, and the whole world takes on its colour.

- **Doors** are open only in their own colour. Match it to pass.
- **Shards** ◆ can only be grabbed in their own colour.
- **Hunters** live in one colour. They can only see you, chase you and hit you while you are in their layer; in any other layer they are harmless ghosts. When one closes in, phase out.
- **Shifters** are hunters that change colour on a timetable. A spinning dashed ring shows the colour each one moves into next, and it flickers for a second and a half before it goes.
- **Goal:** collect every shard, then roll into the portal. **Lose:** caught three times. Hunters speed up the longer you take. Finish under par with all lives for three stars.

**Space itself moves you through the fourth dimension.** Roll once around a pillar and you come back one layer over: clockwise goes up a colour, counter-clockwise goes down. That is **holonomy**. The four rooms around a pillar form a square whose corners are 72° instead of 90°, so a lap turns you by its area, 2·180° − 4·72° = 72°, exactly one of the five layers. In level 3 twisting is jammed, and loops are the only way through.

| Input | Action |
|---|---|
| Arrows / WASD / drag on the disk | Roll |
| Q / E, Space | Phase down / up one layer |
| Controller | Tilt to roll; turn it like a dial to phase; BOOT = phase up |
| R · T · M · N · H | Restart · trail · sound · music · help |

The corner view is your marble's **4D body**: a tesseract's shadow, in your colour, that turns through the XW plane as you phase. The ring around it shows the five layers, where you are, and which layers hold hunters (dots; shifters have a white outline) and shards (diamonds).

Level 1 has a **tutorial** that reacts to what is around you: how to roll, then how to get through the first door and grab the first shard, then the portal. Each level keeps a **high-score table** (best five runs, saved in the browser), and the **music** is synthesized live: every layer has its own chord, so phasing changes the harmony, and percussion builds as a hunter in your layer closes in.

**Watch demo** plays level 3 by itself: it loops the pillar to change colour without touching the controls.

### Levels

1. **Slip:** learn to phase: two coloured doors, two shards, with tutorial tips.
2. **Hunted:** a red hunter, and you start red.
3. **Curvature:** twisting is jammed: loop the pillar to change colour.
4. **Swarm:** 61 rooms, three hunters in three colours.
5. **Shifter:** a hunter that changes colour every 8 s.
6. **Orbit:** twisting is jammed again, in a 61-room maze with three loopable pillars.
7. **Flux:** two shifters going round the colours in opposite directions.
8. **Escape:** four hunters; only violet is empty.

Levels 5–7 come from a **level generator** (`game/src/game/generator.ts`). It puts the exit in the farthest room, coloured doors along the way, shards in dead ends and hunters in far rooms, and opens laps around chosen pillars. It keeps a level only if the solver proves it fair: finishable, impossible with the doors shut, and (when twisting is jammed) impossible without looping. Recipes live in `src/game/recipes.ts`; `npm run levels` rewrites the JSON.

## Run it

**Windows desktop app:** `cd desktop`, `npm install`, `npm run package`, then double-click `desktop\out\Phase Escape-win32-x64\Phase Escape.exe`. Copy the whole folder to share it. It finds the controller's port by itself.

**Browser:**

```powershell
cd game
npm install
npm run dev
```

Open http://localhost:5173 in Chrome or Edge (they have Web Serial, which the controller needs). Keyboard and mouse are enough to play.

## The controller (optional)

An ESP32-DevKitC V4 with an Adafruit BNO055 orientation sensor, streaming fused orientation, gravity and gyro at 100 Hz over USB. Wiring, calibration and the protocol are in [docs/HARDWARE.md](docs/HARDWARE.md). Click **Connect controller**, hold it the way you want "flat" to be, and click **Set level**. Tilting rolls the marble; turning the controller about that vertical, like a dial, slides you through the layers (tilting barely affects it, so the two don't fight). Sensitivity and directions are under **Settings**.

```powershell
cd firmware
pio run -t upload
```

## How it works

The full explanation, written for a curious non-expert, is in [docs/MATH.md](docs/MATH.md).

- **Hyperboloid model.** Points satisfy ⟨p,p⟩ = −1 under the Minkowski product; motions are 3×3 Lorentz matrices, all in float64 and re-squared every step.
- **Parallel transport for free.** The marble's velocity lives in its own frame and it moves by M ← M·T(v·dt): exactly parallel transport, so curvature turns its frame with no explicit rotation in the code.
- **Exact holonomy.** Your frame is carried along the geodesics joining room centres, so every loop turns it by exactly the area of a geodesic polygon: 72° per pillar enclosed. A post at every vertex keeps "which side of each pillar" well defined.
- **The fourth dimension is the holonomy group.** Five layers of 72° each: your layer is your twist plus your holonomy, mod 5. Twisting and looping are two ways of moving along the same circle.
- **Fair by construction.** A breadth-first solver over (room, holonomy step, twist step, shards held) proves every level can be finished; the autopilot then plays every level along the solver's route with the real physics.
- **Instanced rendering.** Every tile is congruent, so each shape is uploaded once in canonical coordinates. Each instance carries a Lorentz matrix formed on the CPU in float64, and the shader maps it into the disk. The biggest level renders in about 3 ms per frame.

## Project layout

```
desktop/       Electron wrapper: Windows app, automatic controller port selection
firmware/      PlatformIO project: ESP32 + BNO055 at 100 Hz, tools/
game/
  src/math/    pure, tested maths: lorentz, poincare, geodesic, tiling, four
  src/game/    marble, maze, transport (holonomy), phase, hunter, game, levels,
               solver, generator + recipes, tutorial, autopilot
  src/input/   keyboard/mouse, Web Serial controller, protocol parsing
  src/render/  Poincaré disk view, 4D body inset, HUD
  src/         main, sound effects, music, scores, settings
  levels/      the eight levels (JSON)
  tools/       generate-levels.mjs (npm run levels)
  tests/       vitest suites
docs/          MATH.md, HARDWARE.md, DEMO.md, screenshots
```

## Tests

`cd game` then `npm test`. There are 124 tests:
- **Geometry:** isometries, distances, re-orthonormalisation, the disk models, geodesic segments, and the tiling.
- **Holonomy:** one lap around a {5,4} tile turns a transported frame by π/2 to within 1e-9; the room-to-room transport gives ±72° per pillar, and 360° around a tile.
- **Phase Escape:**
  - The rules: doors, hunters (same layer only), lives, and curvature phasing. Shifters follow their timetable and only hit in their current layer. A fuzz test phases in and out around hunters.
  - A state-space solver proving every level is solvable, that every level needs its doors, and that the twist-jammed levels (3 and 6) cannot be solved without looping.
  - Autopilot playthroughs of every level along the solver's route, with the real physics.
  - The generator: deterministic, only fair levels, a full lap open around every marked pillar, and the level files in sync with their recipes.
  - The tutorial's order of tips, and the high-score ranking.
- **4D maths:** B₄⁺, rotations and the tesseract.
- **Controller:** the protocol parser, run against a real 2 s recording from the controller.

## Screenshots

| | |
|---|---|
| ![Level 1](docs/screenshots/title.png) | ![A coloured door](docs/screenshots/doors.png) |
| ![A red hunter closing in](docs/screenshots/hunted.png) | ![A shifter about to turn blue](docs/screenshots/shifter.png) |
| ![After a pillar lap](docs/screenshots/curvature.png) | ![The final level](docs/screenshots/final.png) |

Regenerate with `?scene=title|doors|hunted|curvature|shifter|final` (headless Chrome at 1280×800). The two-minute demo script is in [docs/DEMO.md](docs/DEMO.md).

## History

This started as "The Key and the Curve", a puzzle about matching a tesseract key's 4D orientation ([CLAUDE.md](CLAUDE.md) has the original brief). Playtesting showed it was vague and too hard, with no way to lose, so it became Phase Escape. The hyperbolic engine, the controller and the exact holonomy carried over; the fourth dimension became something you move through, not something you decode.
