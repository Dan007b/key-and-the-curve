# The maths behind Phase Escape

This is the geometry the game runs on, written for someone curious rather than for a specialist. Each section points to the code that implements it and the tests that check it.

## 1. A plane with negative curvature

On a flat sheet of paper, a triangle's angles add up to 180°, and the area of a disk grows like r². On a sphere (positive curvature), triangles have *more* than 180°. The **hyperbolic plane** is the opposite: triangles have *less* than 180°, and the area of a disk grows exponentially, like e^r. There is always far more room than you expect.

We use curvature −1 everywhere. One consequence matters for the whole game. For any polygon made of straight lines (geodesics), the angle shortfall equals the area:

> **area = (n − 2)·180° − (sum of the interior angles)**

For a flat polygon the right-hand side is zero. Here it is the area.

You can't draw the hyperbolic plane on paper without distorting it, so we compute in one model and draw in another.

## 2. Computing: the hyperboloid model

Code: `game/src/math/lorentz.ts`.

Points of the hyperbolic plane are vectors p = (x, y, z) on the upper sheet of the hyperboloid z² − x² − y² = 1. The natural "dot product" is the **Minkowski product**

  ⟨a, b⟩ = aₓbₓ + a_y b_y − a_z b_z,

so points satisfy ⟨p, p⟩ = −1. The origin is O = (0, 0, 1).

**Distance.** cosh d(p, q) = −⟨p, q⟩. In code we use the equivalent d = 2·asinh(½√⟨p−q, p−q⟩), which keeps full precision for nearby points. The textbook acosh form loses half its digits there.

**Motions** (isometries) are 3×3 matrices M that preserve the product: Mᵀ J M = J with J = diag(1, 1, −1). That makes the inverse free: M⁻¹ = J Mᵀ J.

- **Rotation** about O by θ: the usual 2D rotation in the x–y block.
- **Boost** (translation) by distance d along x: `[[cosh d, 0, sinh d], [0, 1, 0], [sinh d, 0, cosh d]]`.
- **Translation by a tangent vector u**: T(u) = R(φ)·Bₓ(|u|)·R(−φ), where φ is u's direction. In code this is a closed form with no trigonometry, taking O straight to the point p = exp(u):

  ```
  ⎡ 1 + pₓ²/(1+p_z)   pₓp_y/(1+p_z)    pₓ  ⎤
  ⎢ pₓp_y/(1+p_z)     1 + p_y²/(1+p_z) p_y ⎥
  ⎣ pₓ                p_y              p_z ⎦
  ```

**Frames.** A frame is a motion M: its third column M·O is a position, and its first two columns are the x and y axes there. After many multiplications, rounding errors build up, so frames are **re-orthonormalised** with Gram–Schmidt in the Minkowski product. The position column is fixed first (normalised to ⟨c,c⟩ = −1), so the correction never moves anything. It only re-squares the axes. A test runs 100,000 small steps and checks Mᵀ J M = J to 1e-13.

## 3. Drawing: the Poincaré and Klein disks

Code: `game/src/math/poincare.ts`, `game/src/render/`.

- **Poincaré disk:** (x, y, z) ↦ (x, y)/(1 + z). Angles come out true, and straight lines become circular arcs meeting the rim at right angles. A point at distance d from the centre lands at radius tanh(d/2) < 1. That is why rooms shrink towards the rim, and why you can never reach it.
- **Klein disk:** (x, y, z) ↦ (x, y)/z. Angles are distorted, but straight lines stay straight. The game uses it wherever straightness helps, for example to decide which pillars a loop went around.

The view is always centred on the marble: every world point is mapped with M⁻¹ (the marble's frame inverted) and then into the disk. Edges are drawn by sampling points along each geodesic.

**On the GPU.** Every tile is congruent, so each shape (tile, wall, post) is uploaded once in canonical coordinates. Each copy carries one matrix, view⁻¹·frame, computed on the CPU in float64. The vertex shader multiplies by it and divides by 1 + z. Uploading world coordinates instead would be hopeless in float32: far from the origin they reach ~10³, and the differences that matter would cancel away.

## 4. The marble: parallel transport for free

Code: `game/src/game/marble.ts`.

The marble has a frame M and a velocity v, written in its own local axes. Each 1/240 s:

1. v += a·dt (acceleration from tilt)
2. v *= e^(−k·dt) (rolling friction)
3. M ← M·T(v·dt)

Step 3 moves the frame along the geodesic it is heading down, in its own local direction. Keeping v local while multiplying on the right is precisely **parallel transport**. The code never adds a rotation, and still the frame comes back rotated after a loop. The curvature does it.

## 5. Walls

Code: `game/src/math/geodesic.ts`.

A geodesic is where the hyperboloid meets a plane through the origin of ℝ³. Describe that plane by a normal n with ⟨n, n⟩ = 1:

- **Normal of the geodesic through a and b:** n = J(a × b), normalised. (⟨n, a⟩ = (a × b)·a = 0.)
- **Signed distance from p to it:** sinh d = ⟨p, n⟩.
- **Closest point on the segment [a, b]:** write the geodesic as γ(s) = cosh(s)·a + sinh(s)·t̂. A point at height h above the foot γ(s₀) has cosh dist(p, γ(s)) = cosh h · cosh(s − s₀). That grows with |s − s₀|, so the closest point is γ(s₀) clamped to the segment.
- **Collision:** if the marble is closer than its radius plus the wall's half-width, push it straight out (in its own frame), then reflect the inward velocity with restitution e = 0.4.

Every maze vertex has a round post, which handles corners and matters for holonomy (§7).

## 6. The {5,4} tiling

Code: `game/src/math/tiling.ts`.

{p, q} means regular p-gons, q around every vertex. It is hyperbolic when (p − 2)(q − 2) > 4; {5,4} gives pentagons with four 90° corners meeting at each vertex. Cut a tile into right triangles (centre, edge midpoint, vertex), with angles π/p at the centre and π/q at the vertex:

- circumradius R: cosh R = cot(π/p)·cot(π/q)
- inradius r: cosh r = cos(π/q)/sin(π/p)
- side L: cosh(L/2) = cos(π/p)/sin(π/q)
- area: 3·180° − 5·90° = 90° (π/2)

**Generation** is breadth-first from a central tile. Each neighbour is the image of the tile under a **half-turn** about an edge midpoint. That gives the same tiles as reflecting, but keeps every frame orientation-preserving. Duplicates are merged by comparing centres. Layers come out 1, 5, 15, 40, 105, … tiles.

## 7. Holonomy: why the key turns

**The fact.** Carry a direction around a closed geodesic polygon by parallel transport. It comes back rotated by the polygon's area: clockwise for a counter-clockwise loop, because the curvature is negative. Once around a single {5,4} tile turns it by 90°. The test `holonomy.test.ts` walks a frame around a tile using only translations and finds −π/2 to within 1e-9. It also checks 20 other regular polygons against their areas.

**What the game does with it.** The marble's own frame rotates by the area its actual path enclosed. That path wobbles: hug the inner wall of a loop or swing wide, and the enclosed area changes by about a radian. A game rule can't depend on that. So your frame is carried along a cleaner path: the chain of geodesics joining **room centres**. When the marble crosses into the next room, the carried frame is translated straight from the old centre to the new one (`game/src/game/transport.ts`).

Any closed walk through rooms is then an exact geodesic polygon. The smallest loop goes through the four rooms around one vertex: a square of the dual {4,5} tiling. Its corners are 360°/5 = 72° instead of 90°, so its area is

> 2·180° − 4·72° = **72°**.

Every loop turns you by a whole number of 72° steps, one for each pillar it goes around. A lap around a whole tile encloses its five pillars: 5·72° = 360°, back to the start. A post at every vertex stops the marble cutting through one, so "which side of each pillar did you pass" is always well defined. Wiggles inside a room change nothing.

Because every carried frame is a room's canonical frame turned by a multiple of 36°, the code snaps to that grid after each step. Rounding errors can never build up.

**Measuring it.** The maze generator carves a spanning tree: exactly one direct route to every room. The start frame carried along that tree gives each room a reference frame. Your holonomy is the carried frame's angle relative to the reference: 0° on the direct route, ±72° per pillar looped. The view uses the carried frame as the screen axes, so after a loop the whole maze appears turned by that angle.

## 8. The fourth dimension: five layers

Code: `game/src/game/phase.ts`, `game.ts`, `hunter.ts`.

The maze is a 2D hyperbolic maze times a circle: a phase coordinate w that wraps around. Picture a stack of five copies of the maze, where going up from the top copy brings you back to the bottom. The circle is cut into five layers of 72°, one colour each. Everything coloured lives in one layer:

- a **door** is a wall with a gap at one position along w: open only in its own layer;
- a **shard** sits at one position along w: you can only reach it from its layer;
- a **hunter** lives in one layer: it can only see and touch you there.

You only ever see your own slice (the world is tinted its colour); other layers' things show as ghosts.

**Two ways to move along w.** Your phase is

  layer = (twist steps + holonomy steps) mod 5.

Twist steps are what you dial in: keys, the BOOT button, or turning the controller like a dial (the gyro's rate projected onto the "level" vertical; tilting rotates about horizontal axes, so it barely counts). Holonomy steps come from §7: every lap around a pillar turns your carried frame by exactly 72°, which is exactly one layer. That is not a coincidence we arranged: in the {5,4} tiling, the turn per pillar (72°) divides 360° into exactly five steps, so the five layers are the holonomy group of the maze. Looping clockwise moves you up a layer and counter-clockwise down, and five laps bring you all the way round.

**Hunters** move like the marble does, room by room, along the shortest route through the maze (they drift through doors, but not through walls). They only chase when they can see you, that is, when you share their layer; otherwise they patrol. Rooms are convex, so a straight move to the next doorway never cuts through a wall.

**Shifters** are hunters that move along w on their own, on a fixed timetable: a shifter that starts in layer b and steps s layers every T seconds is in layer

  (b + s·⌊t / T⌋) mod 5

at game time t. Because that is a plain function of the clock, it is predictable: the game knows the next layer and how long until the shift, and for the last 1.5 s the shifter flickers towards its next colour (and fades in if that colour is yours).

**The colour dial: why a lap changes your colour.** The ring in the corner is drawn to say exactly what happens. The colour wheel is painted on the world (in each room's reference frame), and the pointer is a needle you carry with your frame. Twisting turns the needle (counter-clockwise for +1). A lap round a pillar doesn't touch the needle. It parallel-transports your frame round a square whose corners are 72°, so you turn 108° at each corner, 432° = 360° + 72° in all. You come back facing the way you started, with the needle 72° off relative to the room. On screen that shows as the wheel turning 72° under the needle. The colours run counter-clockwise round the wheel, so the sector under the needle is always (twist + holonomy) mod 5 (`dialAngles` in `phase.ts`, checked in `levels.test.ts`).

Straight lines are not what changes. Between two points of the hyperbolic plane there is exactly one geodesic (on a sphere, antipodal points have infinitely many). What depends on the route is the *orientation you arrive with*: two routes to the same room differ by the holonomy of the loop they make together, 72° per pillar between them.

**When hunters can hurt you.** Only hunters in your layer: they can see you (the game draws a line to each of them and counts them in the corner), chase you, and cost a life on contact, after which you have 2 s of protection. The rest are ghosts in other slices of w, and you pass right through them.

**Why it is fair.** A breadth-first search over (room, holonomy step, twist step, shards held) proves every level can be finished (`game/src/game/solver.ts`). Crossing a passage changes the holonomy step by that passage's jump, the carried frame's turn against the destination's reference frame, which is always a whole number of 72° steps. The same search shows that the twist-jammed levels (4 and 7) cannot be finished on the spanning tree alone, so you must loop, and that no level can be finished with its doors shut or its rifts unbridged. (It counts a rift as open: you can always bridge one from the room beside it.) Its shortest solution is then played by an autopilot with the real physics, for every level (`tests/levels.test.ts`).

**Generated levels.** Levels 2 and 6–8 come from recipes (`game/src/game/generator.ts`). The exit goes in the room farthest from the start; doors and rifts go evenly along the shortest route to it, each door a different colour from the last, each rift's plank flat at a random view (15°–60° either way in each plane); shards go in dead ends, spread out farthest-first; hunters go in far rooms. A recipe can also open "pillar loops": all four passages around a pillar, so a single lap (one layer) is possible there. A candidate is kept only if the solver accepts it on all three counts above; otherwise the next seed is tried.

## 9. Looking into the fourth dimension: rifts and planks

Code: `game/src/math/four.ts` (`lookRotation`, `plankOrientation`, `shadowAxes`, `plankSmear`), `game/src/game/game.ts` (`updateLook`), `render/diskView.ts`, `render/keyView.ts`.

The tesseract in the corner is your **view** into the fourth dimension. You turn it in two planes: by α in XW (the floor's left-right direction tips towards w) and by β in YW (its up-down direction tips towards w),

  L(α, β) = R_yw(β) · R_xw(α),  with α, β ∈ [−90°, 90°].

A **rift** is a passage you can't roll across. Over it floats a **plank**, a 4D box with half-extents (h_x, h_y, h_z, h_w) = (0.10, 0.32, 0.10, 0.30) in the rift's own frame (x along the crack, y across it). It is built to lie flat when seen from one particular view L₀ = L(α₀, β₀). From your view L you see it turned by

  M = L · L₀⁻¹,

and what reaches the floor is its orthographic shadow: the plank's corners Σ ±h_j e_j land at Σ ±h_j (M₀ⱼ, M₁ⱼ). So the shadow is the zonogon spanned by the four vectors g_j = h_j (M₀ⱼ, M₁ⱼ). At L = L₀, M = I, the z and w vectors vanish, and the shadow is the flat h_x × h_y rectangle spanning the crack: the bridge. Anywhere else, the w vector g_w smears the shadow sideways. The game draws the plank's w edges in gold, so you watch them shrink to nothing as you line it up.

**Smear.** How far the shadow is from flat, as a fraction of the plank's size:

  smear = ( |g_x ∓ (h_x, 0)| + |g_y ∓ (0, h_y)| + |g_z| + |g_w| ) / (h_x + h_y + h_z + h_w),

taking the better sign for g_x and g_y (a rectangle looks the same flipped). Near the target, 1° off in XW gives a smear of about 0.011 and 1° off in YW about 0.006. A test scans the whole ±90° square of views in 1° steps: every view with smear < 0.08 lies within 8° (XW) and 14° (YW) of the target, so the only flat view is the right one. The rift is bridged once the smear stays under 0.04 for 0.2 s; within 0.1, if you let go of the controls, the view eases onto the target.

This is a perspective puzzle in the spirit of Superliminal and The Witness, except the direction you can't see is w. The two angles are absolute, not accumulated, so the view is a point in a square and every plank has one answer. Rotations in 4D don't commute, though, and M = R_yw(β) R_xw(α − α₀) R_yw(−β₀) is not simply "the difference of the angles". That's why the shadow smears in a slanted way unless both angles are right.

The inset shows the same view: the tesseract (16 vertices (±1, ±1, ±1, ±1), 32 edges) turned by L, plus a fixed 3D tilt, then projected 4D → 3D by perspective along w (x′ = x·s/(d − w), d = 3) and drawn with a 3D camera. Its gold w edges are the ones that tip into the floor as you turn.

## 10. Numerical care, in one table

| Where | Risk | Remedy |
|---|---|---|
| Frames composed every step | Drift off the hyperboloid | Minkowski Gram–Schmidt every step; position column fixed first |
| Distances between nearby points | acosh loses digits near 1 | d = 2·asinh(½√⟨p−q, p−q⟩) |
| Carried frame | Rounding over a long game | Snapped to the exact 36° grid after every room |
| GPU in float32 | Cancellation far from the origin | Canonical shapes plus per-instance matrices formed in float64 |
| Disk rim | tanh(d/2) rounds to 1 beyond ~37 units | Clamp to 1 − 4ε (and cull beyond 5.5 units anyway) |
| Physics step | Tunnelling through walls | 240 Hz substeps and a speed cap: < 0.015 units per step |
