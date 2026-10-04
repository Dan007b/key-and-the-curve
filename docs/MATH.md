# The maths behind The Key and the Curve

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

**What the game does with it.** The marble's own frame rotates by the area its actual path enclosed. That path wobbles: hug the inner wall of a loop or swing wide, and the enclosed area changes by about a radian. A gate with a ~14° tolerance can't depend on that. So the key is carried along a cleaner path: the chain of geodesics joining **room centres**. When the marble crosses into the next room, the key's frame is translated straight from the old centre to the new one (`game/src/game/transport.ts`).

Any closed walk through rooms is then an exact geodesic polygon. The smallest loop goes through the four rooms around one vertex: a square of the dual {4,5} tiling. Its corners are 360°/5 = 72° instead of 90°, so its area is

> 2·180° − 4·72° = **72°**.

Every loop turns the key by a whole number of 72° steps, one for each pillar it goes around. A lap around a whole tile encloses its five pillars: 5·72° = 360°, back to the start. A post at every vertex stops the marble cutting through one, so "which side of each pillar did you pass" is always well defined. Wiggles inside a room change nothing.

Because every carried frame is a room's canonical frame turned by a multiple of 36°, the code snaps to that grid after each step. Rounding errors can never build up.

**Measuring it.** The maze generator carves a spanning tree: exactly one direct route to every room. The start frame carried along that tree gives each room a reference frame. The key's holonomy is its carried frame's angle relative to the reference: 0° on the direct route, ±72° per pillar looped. The view uses the carried frame as the screen axes, so after a loop the whole maze appears turned by that angle.

## 8. The 4D key

Code: `game/src/math/four.ts`, `game/src/render/keyView.ts`.

**The tesseract** has 16 vertices (±1, ±1, ±1, ±1) and 32 edges, joining vertices that differ in one coordinate. Its orientation K is a 4×4 rotation matrix, stored in the marble's local frame.

**Rotating in 4D.** In 3D you rotate about an axis; in 4D you rotate *in a plane*, and there are six: XY, XZ, XW, YZ, YW, ZW. Twist mode drives the three that involve the fourth axis:

  K ← exp(dt·(ω₁E_xw + ω₂E_yw + ω₃E_zw))·K,

where ω are the controller's gyro rates (or the Q/A, W/S, E/D keys) and E are the planes' antisymmetric generators. The exponential is approximated by the product of the three plane rotations. That differs by commutator terms of size dt²·ω²/2, about 0.001 rad per frame, and is still an exact rotation. K is re-orthonormalised every frame.

**Drawing it.** 4D → 3D by perspective along w, x′ = x·s/(d − w) with d = 3: corners nearer in w look bigger, which produces the familiar cube-in-a-cube. Then 3D → screen with an ordinary perspective camera. Edges are coloured by axis and brightened by depth in w.

**How curvature reaches the key.** At a gate, the key is compared in the gate's frame:

  K_eff = R_xy(θ)·K,

where θ is the holonomy (§7) measured on the gate's side, and R_xy rotates the key's XY plane. Looping a pillar changes θ by 72°, which turns the key relative to the gate.

**A key must not be symmetric.** The obvious fit test, min over symmetries S of ‖K_eff − S·target‖, uses the tesseract's rotation group B₄⁺: the 192 signed permutation matrices with determinant +1. But B₄⁺ contains every 90° plane rotation. So an untouched tesseract already "fits" a 90° XW target, and a 90° curvature turn would be invisible (`four.test.ts` demonstrates both). Real keys have teeth for a reason. Ours has coloured axes and one marked corner (the white bead), which leaves only the identity as a symmetry. The fit is simply

  d = ‖K_eff − target‖_F.

For a single-plane mismatch of angle α, d = 2√2·|sin(α/2)|. The gate starts glowing within 2τ, and within τ = 0.35 (about 14°) the key glides onto the exact orientation and the gate opens. If the player gets within 2τ and stops twisting, the key also drifts the rest of the way (the settle assist).

**Telling the player which way to turn.** Every gate target is written as twists in the W planes followed by a turn in XY, so the lock splits into four dials: curvature (XY) and the XW, YW, ZW twists (`game/src/game/lock.ts`). For each twist plane, the best angle to turn has a closed form. ‖R(θ)·K − T‖² = const − 2·tr(R(θ)·M) with M = K·Tᵀ, and for a rotation in plane (i, j), tr(R(θ)·M) = rest + cos θ·(M_ii + M_jj) + sin θ·(M_ij − M_ji). So the best twist is

  θ* = atan2(M_ij − M_ji, M_ii + M_jj),

which is exactly the remaining angle when the mismatch lies in that plane. That is what each dial shows, and the panel highlights the plane with the most to go. For curvature, the dial shows the difference between the holonomy needed and the holonomy carried, in 72° laps.

## 9. Numerical care, in one table

| Where | Risk | Remedy |
|---|---|---|
| Frames composed every step | Drift off the hyperboloid | Minkowski Gram–Schmidt every step; position column fixed first |
| Distances between nearby points | acosh loses digits near 1 | d = 2·asinh(½√⟨p−q, p−q⟩) |
| Carried key frame | Rounding over a long game | Snapped to the exact 36° grid after every room |
| GPU in float32 | Cancellation far from the origin | Canonical shapes plus per-instance matrices formed in float64 |
| Disk rim | tanh(d/2) rounds to 1 beyond ~37 units | Clamp to 1 − 4ε (and cull beyond 5.5 units anyway) |
| Key orientation | Drift from many twist steps | Row Gram–Schmidt every frame; det kept at +1 |
| Physics step | Tunnelling through walls | 240 Hz substeps and a speed cap: < 0.015 units per step |
