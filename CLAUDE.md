# CLAUDE.md: "The Key and the Curve"

Project brief and working instructions for Claude Code. Read this whole file before writing any code.

## 1. What we are building

A browser game for the "Beyond Euclid: Interactive Experiences in Impossible Geometries" challenge.

The player holds a handheld controller: an ESP32 (DevKitC V4) with a BNO055 IMU. Tilting the controller rolls a marble through a maze laid out on a hyperbolic {5,4} tiling, drawn in the Poincaré disk model. A 4D tesseract "key" floats with the marble. Doors in the maze are gates, and a gate opens only when the key's orientation matches the gate's target orientation. Pressing the trigger (the ESP32's BOOT button) toggles twist mode on and off. In twist mode, wrist rotation turns the key in the XW, YW and ZW planes, so the player is physically rotating something through the fourth dimension.

The core mechanic is holonomy. The key's orientation is stored in the marble's own parallel-transported frame. Because the plane is hyperbolic, rolling the marble around a closed loop rotates that frame by an angle equal to the loop's enclosed area. The player can therefore change the key's orientation in two ways: by twisting it through 4D, or by taking a detour around a loop and letting the curvature turn it. Some gates require both. The game should teach the player that in curved space, the path you take changes the object you carry.

### Judging criteria to keep in mind

| Criterion | Weight | What it means for this project |
|---|---|---|
| Geometric creativity | 30% | The geometry must be correct and must matter to gameplay. |
| UX and interaction | 30% | Controls should be smooth, and the player should understand what is happening. |
| Graphics and technical | 25% | Run at 60 FPS (minimum 30), with clean code. |
| Documentation | 15% | README and MATH.md should explain the math clearly, and the code should be commented. |

### Bonus points to aim for

- Educational value. The game should teach holonomy and 4D rotation.
- Novel technical approach. Physical IMU input mapped to 4D rotation and hyperbolic motion.

## 2. Environment and constraints

- The developer is Danny, who works on Windows. Give shell commands for PowerShell.
- The hardware is an ESP32-DevKitC V4 (ESP32-WROOM-32D, classic ESP32, no native USB) and an Adafruit BNO055 breakout. There is no Raspberry Pi; the game runs on the laptop.
- The game must also be fully playable with keyboard and mouse only (no hardware), so development and judging never depend on the controller.
- Do not guess GPIO pins, the I2C address, or the board variant. Ask Danny before writing firmware pin constants.

## 3. Tech stack

### Firmware (`/firmware`)

- Use PlatformIO with the Arduino framework, board `esp32dev` (confirmed: ESP32-DevKitC V4).
- Libraries: `adafruit/Adafruit BNO055` and `adafruit/Adafruit Unified Sensor`. Use `Preferences` (NVS) to store calibration.
- Communicate over the board's USB-to-UART bridge at **921600 baud** (the classic ESP32 has no native USB). 115200 would be ~75% saturated by the 100 Hz stream. The game must open Web Serial at the same baud, and should deassert DTR/RTS on connect so the DevKitC auto-reset circuit doesn't reset the board.

### Game (`/game`)

- Vite, TypeScript in strict mode, and Three.js (pin an exact version).
- Use vitest for unit tests.
- Connect to the controller with the Web Serial API. This works in Chrome or Edge on `localhost`.
- No backend.

### Docs

- `/README.md`, `/docs/MATH.md`, and `/docs/HARDWARE.md`.

## 4. Repository layout

```
/firmware
  platformio.ini
  src/main.cpp
/game
  index.html
  src/
    math/
      lorentz.ts      hyperboloid model: Minkowski ops, boosts, rotations, reorthonormalize
      poincare.ts     hyperboloid → Poincaré disk / Klein mappings
      tiling.ts       {p,q} tiling generation
      geodesic.ts     wall normals, distances, segment tests
      four.ts         4×4 rotations, plane generators, B4 symmetry group, fit metric
    game/
      marble.ts       physics in the marble's local frame
      maze.ts         maze generation over tiling adjacency
      gates.ts        gate logic, holonomy-corrected comparison
      level.ts        level loading (JSON)
    input/
      InputSource.ts  interface
      SerialInput.ts  Web Serial parser
      KeyboardInput.ts
    render/
      diskView.ts     main Poincaré disk view
      keyView.ts      inset 3D view of tesseract shadow + gate target ghost
      hud.ts
    main.ts
  levels/*.json
  tests/*.test.ts
/docs
```

## 5. Hardware and serial protocol

### Wiring

Confirm every pin with Danny before using it.

- **BNO055 over I2C.** Adafruit breakout (confirmed), default address 0x28; still scan the bus on boot and print what is found. It has the external crystal (confirmed), so enable `setExtCrystalUse(true)` by default. Pins (confirmed): SDA = GPIO25, SCL = GPIO26, on the same header as 5V/VIN and GND so the controller wires to one side. Never use GPIO6–11 (internal flash).
- **Trigger** is the DevKitC's own BOOT button (GPIO0, pressed = LOW); there are no other buttons (confirmed). Firmware reports the debounced held state; the **game** turns presses into a toggle: first press enters twist mode, second press exits. The game owns the mode so it can force it off (levels with twist disabled, level load).
- **No reset-key button** (confirmed). Reset the key with R or an on-screen button.
- **No vibration motor** (confirmed). The firmware still accepts `V,<n>` and ignores it.
- **Wireless (added 2026-10-04):** powered by 4 × AA across 5V/VIN and GND (no battery-sense wire); external pull-ups added on SDA/SCL (Danny reported 1 kΩ and 220 Ω; 220 Ω is far too strong, recommended 2.2–4.7 kΩ to 3V3, see HARDWARE.md). The controller streams over **BLE** (NimBLE, name "PhaseEscape", 16-byte sample notifications) as well as USB serial; the game connects with Web Bluetooth or Web Serial (`input/ControllerInput.ts`).

### Firmware behavior

- Initialize the BNO055 in NDOF mode. Make `setExtCrystalUse(true)` a compile-time option, because cheap boards often lack the crystal.
- Start the I2C clock at 100 kHz. If reads are flaky, drop to 50 kHz. The BNO055 uses clock stretching.
- On boot, load calibration offsets from NVS if they exist. When the host sends `S\n` and the system is fully calibrated (3/3/3/3), save the offsets to NVS.
- Debounce the buttons in firmware.
- Stream one line at 100 Hz:

```
$,qw,qx,qy,qz,gx,gy,gz,wx,wy,wz,cal,btn\n
```

| Fields | Meaning |
|---|---|
| `qw..qz` | Fused quaternion (unit, float, 5 decimals). |
| `gx..gz` | Gravity vector in the sensor frame, m/s². |
| `wx..wz` | Gyro angular velocity, converted to **rad/s** in firmware (the Adafruit lib returns deg/s; verify and document). |
| `cal` | Packed calibration status, `sys*1000 + gyr*100 + acc*10 + mag`. |
| `btn` | Bitmask: bit0 = BOOT held; bit1 reserved, always 0. |

- Debug lines start with `#` and are ignored by the parser.
- **Host to device commands:**
  - `V,<0-255>\n` sets vibration strength.
  - `S\n` saves calibration.
  - `P\n` triggers a ping that answers `#pong`.

## 6. The math

Copy this section, expanded, into `docs/MATH.md`. The curvature is −1 everywhere.

### 6.1 Hyperboloid model (internal representation)

- **Minkowski product.** ⟨a,b⟩ = aₓbₓ + a_yb_y − a_zb_z. Let J = diag(1, 1, −1).
- **Points.** ⟨p,p⟩ = −1 with z > 0. The origin is O = (0, 0, 1).
- **Distance.** cosh d(p,q) = −⟨p,q⟩.
- **Isometries.** These are 3×3 matrices in SO⁺(2,1), with inverse M⁻¹ = J Mᵀ J.
  - Rotation by θ about O is the usual 2D rotation in the xy block.
  - Boost (translation) along x by distance d is
    `[[cosh d, 0, sinh d], [0, 1, 0], [sinh d, 0, cosh d]]`.
  - Translation by a tangent vector u at O, with φ = atan2(u), is T(u) = R(φ) · Bₓ(|u|) · R(−φ).
- **Reorthonormalize** every frame using Gram–Schmidt with respect to the Minkowski form. Column 3 is timelike (normalize so ⟨c,c⟩ = −1); columns 1 and 2 are spacelike (⟨c,c⟩ = +1). This prevents floating-point drift. JS numbers are float64, so the math is precise enough, but drift still accumulates over many frames.

### 6.2 Display

- Map a world point to the marble's local frame with p_local = M⁻¹ p.
- **Poincaré disk.** (x, y, z) ↦ (x/(1+z), y/(1+z)). Scale by the screen radius.
- **Klein model.** (x/z, y/z). In this model geodesics are straight lines, which helps with culling.
- Draw edges as geodesics by sampling points along the geodesic on the hyperboloid (interpolate between endpoints with sinh/cosh, about 12–24 samples) and mapping each sample to the disk.
- The view is always centered on the marble, using the marble's transported frame as screen axes. As a result, after the player completes a loop the whole world appears rotated. This is intentional, because it makes holonomy visible.
- Cull tiles whose center is more than about 7 units from the marble; they are invisible at the disk edge anyway.

### 6.3 Marble physics (parallel transport for free)

- **State.** A frame M (in SO⁺(2,1)) and a velocity v ∈ ℝ² expressed in local coordinates.
- **Each step:**
  1. Add acceleration: v += a_tilt · dt.
  2. Apply damping: v *= exp(−k·dt).
  3. Move the marble: M ← M · T(v·dt).
- Keeping v in local coordinates while composing translations on the right is exactly parallel transport along geodesics. Do not add any explicit rotation; the holonomy emerges by itself.
- Use a fixed physics timestep (e.g. 240 Hz substeps) for stability.

### 6.4 Walls (geodesic segments)

- **Normal of the geodesic through world points a and b.** n = J (a × b) (the ordinary cross product, then multiply by J). Normalize so ⟨n,n⟩ = +1.
- **Signed distance from p to the geodesic.** sinh(d) = ⟨p, n⟩.
- **Segment test.** The foot of the perpendicular must lie between a and b. Test this with the perpendicular geodesics at the endpoints, or simply treat each endpoint as a point collider as well.
- **Collision response.** Transform the normal to local coordinates: n_local = M⁻¹ n. The wall normal in the tangent plane at O is n̂ = normalize(n_local.x, n_local.y). Then:
  1. Push the marble out to radius r along n̂ using T.
  2. Reflect the velocity: v ← v − (1 + e)(v·n̂) n̂, with e ≈ 0.4.

### 6.5 Tiling {5,4} (configurable {p,q})

- **Circumradius** R satisfies cosh R = cot(π/p) · cot(π/q).
- **Generation.** Start from a central regular p-gon. Then BFS by reflecting tiles across their edges. Deduplicate tiles by center distance (< 1e-6). Stop at a configured count or radius.
- **Per-tile data.** Store a frame matrix (mapping the canonical tile to the world), the vertex positions, and the neighbor index for each edge.
- **Maze.** Cells are tiles and adjacency is shared edges. Generate with seeded randomized DFS, then optionally knock out extra walls to create loops. **Loops are essential**, because the holonomy puzzles need them.

### 6.6 Holonomy fact (for tests and for the in-game explanation)

For a geodesic polygon with n sides, interior angles αᵢ, and area A, transporting a vector around the polygon rotates it by

  A = (n − 2)π − Σαᵢ

For example, the rotation picked up by walking once around one {5,4} tile is 3π − 5·(π/2) = π/2. **This is a great teaching moment**: one lap around a single tile rotates the key by 90°.

### 6.7 The 4D key

- **Tesseract.** 16 vertices at (±1, ±1, ±1, ±1) and 32 edges (vertex pairs that differ in exactly one coordinate).
- **Orientation.** K_local is a 4×4 matrix in SO(4), stored in the marble's local frame.
- **Twist mode** (toggled on/off by trigger presses). Let ω be the gyro rate in rad/s, mapped from device axes to 4D planes: device x → XW, device y → YW, device z → ZW. The mapping should be configurable. Each frame:
  - K_local ← exp(dt · (ωₓE_xw + ω_yE_yw + ω_zE_zw)) · K_local
  - The E matrices are the antisymmetric plane generators. Computing the exponential by composing the three plane rotations is acceptable at small dt.
  - Reorthonormalize K every frame (Gram–Schmidt or SVD).
- **Rolling coupling.** When not twisting, the key does not rotate in local coordinates. It still "rotates" relative to the world because the frame M does.
- **Projection for the inset view.**
  - 4D to 3D by perspective from w: x′ = x · s/(d − w) with d ≈ 3.
  - 3D to screen with a Three.js perspective camera.
  - Color edges by w depth.
- **Holonomy coupling at gates.** Compute A = G⁻¹ M, where G is the gate's frame. Decompose A = T(pos) · R(θ) and extract θ. The effective key orientation in the gate's frame is R_xy(θ) · K_local, where R_xy rotates the XY plane of the 4D key. This is how the maze's curvature acts on the key.
- **Fit test.**
  - The tesseract symmetry group B₄ has 384 elements: signed 4×4 permutation matrices. Use the subgroup with det = +1 (192 elements) for rotations.
  - The fit is min over S ∈ B₄⁺ of ‖K_eff − S · R_target‖_F.
  - The gate opens when the fit is below a tolerance τ (start at τ ≈ 0.35 and tune).
  - Within 2τ, the gate glows and the controller vibrates in proportion to closeness.
  - Within τ, snap the key smoothly to the exact match and open the gate.

## 7. Input layer

The `InputSource` interface looks like this:

```ts
interface InputSource {
  tilt(): { x: number; y: number };      // -1..1, after deadzone + sensitivity
  angularVelocity(): [number, number, number]; // rad/s, for twist mode
  twistToggled(): boolean;                // true once per trigger press (rising edge), consumed on read
  resetKey(): boolean;                    // keyboard R / on-screen button; serial has no reset button
  status(): { connected: boolean; calibration?: number; hz?: number };
  vibrate?(strength01: number): void;
}
```

- **SerialInput.**
  - Connect through a "Connect controller" button (Web Serial needs a user gesture).
  - Parse lines robustly: handle partial lines, ignore `#` lines, and drop malformed lines.
  - Compute tilt from the gravity vector relative to a captured "level" reference. Add a "Set level" button that captures the current gravity, and project out the reference axis.
  - Apply the deadzone, sensitivity, and clamping from the settings panel.
- **KeyboardInput.**
  - Arrow keys or WASD tilt.
  - Shift + Q/A rotates in XW, Shift + W/S in YW, Shift + E/D in ZW.
  - Space toggles twist mode (same as the BOOT button); R resets the key.
- Show the input status in the HUD: connected or not, sample rate, and the calibration digits.

## 8. Levels

Store levels as JSON in `/game/levels`. Each level has:

- the tiling {p,q}
- the maze seed and the number of extra openings (or an explicit wall list)
- the start tile and goal tile
- the gates, each with a tile, an edge, and R_target (given as a list of plane rotations, e.g. `[["xw", 90]]`)
- hint text

Planned levels:

1. **Rolling.** A maze with no gates. Teaches tilt control, the hyperbolic look, and the fact that space grows outward.
2. **First gate.** The target equals a plain twist (90° in XW). Teaches twist mode.
3. **Curvature turns the key.** The only way to fit the gate is to roll once around a marked tile loop (a 90° rotation in XY). Twist mode is disabled for this level. Show an "aha" overlay explaining holonomy, with the angle-sum formula.
4. **Combine.** The target needs one 4D twist plus one holonomy loop.
5. **Final.** A larger maze, multiple gates, and a goal.

## 9. Rendering and UX

- **Main view.** A dark background and a disk boundary circle. Tiles are subtly shaded by distance. Walls are bright geodesic arcs. The marble sits at the center with a small arrow showing its transported frame. Gates are colored arcs that glow when nearly fitting.
- **Inset view** (bottom-right). The tesseract shadow, plus a ghost of the gate's target orientation when a gate is nearby.
- **HUD.** FPS, the input status, the current mode (ROLL or TWIST), and a fit meter.
- **Holonomy trail toggle.** Draw the marble's recent path. When a loop closes, label the enclosed rotation angle.
- **Settings panel.** Sensitivity, deadzone, damping, the axis mapping for twist, and the tolerance τ.
- Keep 60 FPS. Update line geometry buffers in place instead of rebuilding objects every frame.

## 10. Development phases

Work one phase at a time. At the end of each phase:

1. Run the tests.
2. Summarize what was done.
3. List anything Danny must check on hardware.
4. Stop and wait for Danny's go-ahead before starting the next phase.
5. Commit with a clear message.

### Phase 0: Scaffold
- Create the repo layout and initialize git.
- Set up the Vite + TS + Three.js + vitest project and a PlatformIO project.
- **Done when:** `npm run dev` shows a blank page and `npm test` passes.

### Phase 1: Firmware
- Run an I2C scan, initialize the BNO055, stream at 100 Hz in the protocol above, read the buttons, persist calibration, and handle the host commands.
- Add `docs/HARDWARE.md` covering wiring and calibration (figure-8 motion for the magnetometer, still for the gyro, 6 positions for the accelerometer).
- **Done when:** the PlatformIO serial monitor shows clean lines at about 100 Hz.

### Phase 2: Hyperbolic math core
Implement `lorentz.ts`, `poincare.ts`, and `geodesic.ts` with unit tests for:
- the inverse formula, and that boosts preserve ⟨·,·⟩
- distance invariance under isometries
- reorthonormalization fixing a perturbed matrix
- disk mapping staying strictly inside the unit disk
- **the holonomy test.** Walk M around a geodesic polygon made of the edges of one {5,4} tile, using T steps with turns at the vertices, and assert that the net rotation equals π/2 to within 1e-9.

### Phase 3: Tiling and view
- Generate the {5,4} tiling and render it centered on a movable frame using keyboard input.
- **Done when:** the view is smooth at 60 FPS and you can fly around with arrow keys.

### Phase 4: Marble physics and maze
- Build the maze generator (with loops), the walls, collisions, and the goal tile.
- **Done when:** level 1 is playable on keyboard.

### Phase 5: Serial input
- Implement SerialInput, the "Set level" button, the HUD status, and the vibration command.
- **Done when:** level 1 is playable with the controller.

### Phase 6: 4D key
- Implement `four.ts` with tests: B₄⁺ has 192 elements, is closed under multiplication, and all its elements are orthogonal with det = 1.
- Add twist mode, the inset view, and gates with holonomy coupling, the fit meter, and snapping.
- **Done when:** levels 2–4 are playable.

### Phase 7: Content and polish
- Finish all 5 levels, the holonomy trail and labels, the tutorial overlays, the settings panel, and sound (optional, synthesized with the Web Audio API).

### Phase 8: Docs and demo
- Write `README.md` (concept, controls, build and flash steps, screenshots) and `docs/MATH.md` (all of section 6, written for a curious non-expert).
- Make sure the code has comments on every math function.
- Write a 2-minute demo script.

## 11. Rules for Claude Code

- Keep the math pure and tested, and separate from rendering. No Three.js imports inside `/math`.
- Prefer correctness over shortcuts. If an approximation is used, comment why and how big its error is.
- Never hardcode hardware details Danny hasn't confirmed.
- Keyboard mode must keep working after every phase.
- If something in this spec turns out to be wrong or impractical, say so and propose a fix rather than silently diverging.

## 12. Implementation notes (decisions made during the build)

These supersede the parts of sections 6–8 they mention. Details and reasoning are in `docs/MATH.md` and the README's "Changes from the original brief".

- **Key transport is discrete.** The key's frame is carried along geodesics between room centres (`game/src/game/transport.ts`), not in the marble's continuous frame: the marble's own path area is too noisy for gate tolerances. Loops therefore turn the key by exact multiples of 72° (one per enclosed pillar, the area of a dual {4,5} square), not "90° per tile lap". A post at every maze vertex keeps the pillar winding well defined. Holonomy is measured against reference frames carried along the maze's spanning tree.
- **The key is marked.** B₄⁺ contains every 90° plane rotation, so the symmetric fit would make 90° targets trivial. The key has axis-coloured edges and one marked corner, and the fit is ‖K_eff − target‖_F with no symmetry. `hyperoctahedralGroup()` and the B₄⁺ tests remain.
- **Twist mode is a toggle** (Space or the BOOT button), owned by the game. `InputSource.trigger()` became `twistToggled()`.
- **View frame** = carried room frame translated to the marble, with a short eased offset hiding the ≤18° jump at room boundaries. Physics still runs in the marble's continuous frame M.
- **Levels** were designed with measured loop holonomies; `tests/levels.test.ts` has a state-space solver and autopilot playthroughs (`game/src/game/autopilot.ts`). Run them after any level edit. Tile indices are stable as long as `WORLD_RADIUS` and the generation order are unchanged.
- **4D lock guidance.** Gate targets must list W-plane twists first and the XY turn last (tested): the lock panel (`render/lockPanel.ts`, `game/lock.ts`) splits each gate into a curvature dial and XW/YW/ZW dials using the closed-form best twist angle. A settle assist pulls the key in when it is within 2τ and the player stops twisting. The controller twists one plane at a time (strongest axis, 0.3 rad/s deadband). An explainer card appears at the first gate.
- **Dev hooks** (dev server only): `__start(i)`, `__teleport(room)`, `__drive([rooms])`, `__advance(s)`, `__bench(n)`, `__demo()`. `?scene=title|gate|loop|final` sets up the README screenshots (capture with headless Chrome).

## 13. Phase Escape redesign (supersedes the key/gate gameplay)

The game is now **Phase Escape** (see README and `HANDOFF.md`): collect shards, reach the portal, three lives, hunters. The 4th dimension is five colour layers (72° each); doors/shards/hunters live in one layer; layer = (twist steps + holonomy steps) mod 5, so one pillar lap = one layer. Inputs: `InputSource.phaseSteps()` / `phaseRate()` (Q/E/Space, BOOT, controller yaw about the level vertical). The tesseract is now a decorative "4D body" turned in XW by your phase. Gates, the lock panel and tesseract matching were removed. Levels in `game/levels/*-slip|rift|hunted|curvature|swarm|shifter|orbit|flux|escape.json` (9 levels; refer to them by name with `levelNamed` / `levelIndex`, never by index); solvability and autopilot tests in `tests/levels.test.ts`.

Additions after the redesign (see HANDOFF.md):
- **Solver** (`game/src/game/solver.ts`): BFS over (room, holonomy step, twist step, shards held); `solveLevelPath` returns the route, which `tests/bot.ts` `followSolution` plays with real physics for every level.
- **Generator** (`game/src/game/generator.ts`, recipes in `recipes.ts`): levels 2 and 6–8 are generated; edit the recipe, run `npm run levels`, never hand-edit those JSON files (a test checks they match). A recipe without rifts draws the same random numbers as before rifts existed (keep it that way).
- **Shifters**: `HunterSpec.shiftEvery` / `shiftStep`; layer = (base + step·⌊t/every⌋) mod 5, 1.5 s warning (`SHIFT_WARNING`).
- **Tutorial** (`game/src/game/tutorial.ts`, tips for Slip, Rift and Hunted in `TUTORIAL_TIPS`), **high scores** (`game/src/scores.ts`, localStorage, top 5 per level by stars then time), **music** (`game/src/music.ts`, one chord per layer, builds with danger; N toggles).
- **The tesseract is your 4D view** (`Game.look`, [xw, yw] degrees within ±90; `lookRotation` = R_yw(β)·R_xw(α) in `four.ts`). Keyboard Shift + arrows, controller hold BOOT (≥ 300 ms, `BootButton`) + tilt; a BOOT tap is still +1 layer; F straightens. Phasing no longer rotates the tesseract.
- **Rifts** (`LevelSpec.rifts`, `Wall.rift = [xw, yw]`): blocked (marble and hunters) until bridged. A 4D plank (`PLANK_EXTENTS`) is seen turned by M = L·L₀⁻¹; its floor shadow's smear (`plankSmear`) must stay < 0.04 for 0.2 s within `RIFT_RANGE`; let go within 0.1 and the view eases on. The solver treats rifts as open (`riftsClosed` to require them). Rift targets stay within ±60°.
- **Clarity:** the HUD phase ring is a world colour wheel turned by curvature under a carried needle turned by twist (`dialAngles`); sight lines and a "can see you" count show which hunters can hurt you; the holonomy card and help use `render/explain.ts` (flat vs curved square, 4 × 108° = 360° + 72°).
