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
- **Goal:** collect every shard, then roll into the portal. **Lose:** caught three times. Hunters speed up the longer you take. Finish under par with all lives for three stars.

**Space itself moves you through the fourth dimension.** Roll once around a pillar and you come back one layer over: clockwise goes up a colour, counter-clockwise goes down. That is **holonomy**. The four rooms around a pillar form a square whose corners are 72° instead of 90°, so a lap turns you by its area, 2·180° − 4·72° = 72°, exactly one of the five layers. In level 3 twisting is jammed, and loops are the only way through.

| Input | Action |
|---|---|
| Arrows / WASD / drag on the disk | Roll |
| Q / E, Space | Phase down / up one layer |
| Controller | Tilt to roll; turn it like a dial to phase; BOOT = phase up |
| R · T · M · H | Restart · trail · sound · help |

The corner view is your marble's **4D body**: a tesseract's shadow, in your colour, that turns through the XW plane as you phase. The ring around it shows the five layers, where you are, and which layers hold hunters (dots) and shards (diamonds).

**Watch demo** plays level 3 by itself: it loops the pillar to change colour without touching the controls.

### Levels

1. **Slip:** learn to phase: two coloured doors, two shards.
2. **Hunted:** a red hunter, and you start red.
3. **Curvature:** twisting is jammed: loop the pillar to change colour.
4. **Swarm:** 61 rooms, three hunters in three colours.
5. **Escape:** four hunters; only violet is empty.

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
- **Instanced rendering.** Every tile is congruent, so each shape is uploaded once in canonical coordinates. Each instance carries a Lorentz matrix formed on the CPU in float64, and the shader maps it into the disk. The biggest level renders in about 3 ms per frame.

## Project layout

```
desktop/       Electron wrapper: Windows app, automatic controller port selection
firmware/      PlatformIO project: ESP32 + BNO055 at 100 Hz, tools/
game/
  src/math/    pure, tested maths: lorentz, poincare, geodesic, tiling, four
  src/game/    marble, maze, transport (holonomy), phase, hunter, game, levels, autopilot
  src/input/   keyboard/mouse, Web Serial controller, protocol parsing
  src/render/  Poincaré disk view, 4D body inset, HUD
  levels/      the five levels (JSON)
  tests/       vitest suites
docs/          MATH.md, HARDWARE.md, DEMO.md, screenshots
```

## Tests

`cd game` then `npm test`. There are 109 tests:
- **Geometry:** isometries, distances, re-orthonormalisation, the disk models, geodesic segments, and the tiling.
- **Holonomy:** one lap around a {5,4} tile turns a transported frame by π/2 to within 1e-9; the room-to-room transport gives ±72° per pillar, and 360° around a tile.
- **Phase Escape:**
  - The rules: doors, hunters (same layer only), lives, and curvature phasing.
  - A state-space solver proving every level is solvable, and that level 3 cannot be solved without looping.
  - Autopilot playthroughs of levels 1 and 3 with the real physics.
- **4D maths:** B₄⁺, rotations and the tesseract.
- **Controller:** the protocol parser, run against a real 2 s recording from the controller.

## Screenshots

| | |
|---|---|
| ![Level 1](docs/screenshots/title.png) | ![A coloured door](docs/screenshots/doors.png) |
| ![A red hunter closing in](docs/screenshots/hunted.png) | ![The final level](docs/screenshots/final.png) |

Regenerate with `?scene=title|doors|hunted|curvature|final`. The two-minute demo script is in [docs/DEMO.md](docs/DEMO.md).

## History

This started as "The Key and the Curve", a puzzle about matching a tesseract key's 4D orientation ([CLAUDE.md](CLAUDE.md) has the original brief). Playtesting showed it was vague and too hard, with no way to lose, so it became Phase Escape. The hyperbolic engine, the controller and the exact holonomy carried over; the fourth dimension became something you move through, not something you decode.
