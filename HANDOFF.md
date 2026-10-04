# Handoff: The Key and the Curve → Phase Escape

Paste this file (or point a new Claude Code chat at it) to continue. Project root: `C:\Users\bosak\Documents\Engineering\stomhacks 2026` (folder name has the typo "stomhacks"). GitHub: https://github.com/Dan007b/key-and-the-curve (branch `main`; commit and push at each milestone, ending commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Read `CLAUDE.md` (original brief + section 12 implementation notes) first.

## Who / environment

- Danny, Windows 11, PowerShell. Node 24 at `C:\Program Files\nodejs` (old terminals may need a restart to see it; in Git Bash use `export PATH="/c/Program Files/nodejs:$PATH"`). PlatformIO CLI at `%USERPROFILE%\.platformio\penv\Scripts\pio.exe` (not on PATH).
- StormHacks 2026, challenge "Beyond Euclid: Interactive Experiences in Impossible Geometries". Judging: geometric creativity 30%, UX 30%, graphics/technical 25%, docs 15%.

## Hardware (all confirmed and working)

- ESP32-DevKitC V4 (classic ESP32, CP2102 USB-UART, appears as **COM9**), Adafruit BNO055 at 0x28 with external crystal.
- Wiring on the 5V/GND header: SDA GPIO25, SCL GPIO26. **Only button: the board's BOOT button (GPIO0)**. No vibration motor.
- Firmware (`firmware/src/main.cpp`): 921600 baud, 100 Hz lines `$,qw,qx,qy,qz,gx,gy,gz,wx,wy,wz,cal,btn` (gyro rad/s, cal packed integer, btn bit0 = BOOT held), `#` debug lines, commands P/S/V. Calibration saved in NVS (done, loads on boot). Fixed a first-init bug (700 ms clock settle after selecting the crystal) + fusion watchdog. Tools: `firmware/tools/check_stream.py COM9`, `calibrate.py`, `nvs_dump.py`.

## Game as of commit d7ad34e (working, 118 tests)

- `game/` Vite 8 + TS 7 strict + Three.js 0.186.1 + vitest 5. `npm run dev` / `npm test` / `npm run build`.
- Math (`src/math`, pure, tested): `lorentz.ts` (hyperboloid model), `poincare.ts`, `geodesic.ts`, `tiling.ts` ({5,4} tiling, 3,646 tiles at radius 7.5), `four.ts` (4D rotations, B4, tesseract, bestTwistAngle).
- Game (`src/game`): `marble.ts` (parallel-transport physics), `maze.ts` (seeded DFS + openings), `world.ts` (walls, posts at every vertex), `transport.ts` (key frame carried room-centre to room-centre → holonomy is exactly 72° per pillar looped; reference frames along the maze tree), `game.ts` (240 Hz loop, rooms, gates, loops/trail), `lock.ts`, `level.ts` + `levels/*.json`, `autopilot.ts` (used by tests + demo).
- Render: instanced GPU geometry (`render/hyperMesh.ts`, `diskView.ts`), `keyView.ts` (tesseract inset), `hud.ts`, `lockPanel.ts`, `explainer.ts`. Input: `KeyboardInput.ts`, `SerialInput.ts` (Web Serial), `CombinedInput.ts`, `serialProtocol.ts`.
- Desktop app: `desktop/` (Electron 44). `npm run package` → `desktop/out/The Key and the Curve-win32-x64/The Key and the Curve.exe`. Must close the running app before repackaging (files locked). Electron picks the ESP32 serial port itself.
- Docs: README, docs/MATH.md, docs/HARDWARE.md, docs/DEMO.md, docs/screenshots (regenerate with `?scene=title|gate|loop|final` + headless Chrome).

## Why we're redesigning

Danny's feedback: the tesseract-key matching is vague and too hard, there is no way to lose, not engaging enough to win. Chosen direction: **Phase Escape** (arcade chase in a 4D-layered hyperbolic maze).

## Phase Escape design (being implemented now)

- **Goal:** collect every shard in the level, then reach the exit portal. **Lose:** hunters hit you 3 times (lives); hunters speed up over time. Timer + stars for score.
- **4th dimension = 5 layers** (a circle of phase, 72° per layer), colour-coded: red, gold, green, blue, violet. Your layer tints the world.
  - **Doors** (coloured walls) are open only in their own layer: match colours to pass.
  - **Shards** of a colour can only be collected in that layer.
  - **Hunters** live in one layer: they chase through the maze graph (respecting walls/their doors) and can only hit you in their layer; in other layers they're ghosts. Dodge by phasing.
- **Phasing:** keyboard Q/E (−/+ one layer, animated), Space +1; controller: twist about the vertical (yaw rate about the "level" reference axis, so tilting doesn't interfere), snaps to nearest layer on release; BOOT = +1 layer.
- **Curvature couples to phase (the hook):** layer = (twist steps + holonomy steps) mod 5. One lap around a pillar = 72° of holonomy = exactly one layer. Level 3 disables twisting so loops are the only way to change dimension.
- Remove the tesseract-matching gates/lock panel from gameplay; keep a decorative tesseract in the inset that rotates in XW with your phase and is tinted by your layer, plus a phase ring showing the 5 layers, where hunters/shards are.
- Tests to keep: math, maze, marble, transport. New: level solvability BFS over (room, holonomy step, twist step), level 3 needs loops, hunter AI respects walls/doors, hits only in same layer, lives/game over, autopilot playthrough of the no-hunter level.

## Status checklist (update as you go)

- [x] Phase model + doors in game logic (`src/game/phase.ts`, `game.ts`, `world.ts` doors)
- [x] Shards, exit portal, lives, timer, stars
- [x] Hunters (`src/game/hunter.ts`: chase only in their layer, drift through doors, respawn on hit, 2 s invulnerability)
- [x] Rendering: layer tint, doors, shards, hunters, portal, phase ring (`render/diskView.ts`, `hud.ts`, `keyView.ts` = 4D body)
- [x] Inputs: Q/E/Space, controller yaw twist (`yawRate` in serialProtocol) + BOOT steps
- [x] Five levels (`levels/1-slip … 5-escape.json`) + 109 tests (solver, rules, autopilot playthroughs of levels 1 and 3)
- [ ] Docs/README/demo script/screenshots (scenes: title, doors, hunted, curvature, final), desktop rebuild, push
