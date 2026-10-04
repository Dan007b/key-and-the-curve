# Two-minute demo script

Setup: the game open full-screen in Chrome (`npm run dev`), the controller connected and calibrated (cal reads S3 G3 A3 M3), and **Set level** pressed while holding it flat. Sound on. Have **Watch demo** ready as a fallback if the controller misbehaves.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Level 1 intro card | "This is a marble maze in hyperbolic space, the geometry where triangles add up to less than 180° and space grows exponentially." |
| 0:10 | Tilt the controller; the marble rolls | "I'm tilting a real controller: an ESP32 with an orientation sensor, streaming at 100 Hz. The view stays centred on the marble. Rooms near the rim look tiny, but they're all the same size: there's just exponentially more of them." |
| 0:30 | Level 2: reach the magenta gate; the ghost appears in the corner | "The gate needs the key, this tesseract, in a specific orientation. That's the ghost behind it." |
| 0:40 | Press BOOT; violet ring; rotate wrist; the XW dial swings up; GATE OPEN | "The gate is a 4D lock with four dials: three twist planes and curvature. BOOT switches to twist mode, and my wrist rotates the key through the fourth dimension. When every dial points up, the key matches and it slides in." |
| 0:55 | Level 3 (Levels → 3); roll straight to the gate | "Here twisting is disabled, and the gate wants the key turned 72°. The direct route doesn't do it." |
| 1:05 | Roll back and loop the glowing pillar counter-clockwise; trail and −72° label; the maze turns | "But if I roll once around this pillar... the key comes back turned by 72°, and so does the whole maze. Nothing twisted it. The curvature of space did." |
| 1:20 | The aha card with the formula | "The four rooms around a pillar make a square whose corners are 72°, not 90°. Go around it and you pick up exactly its area: 2·180° − 4·72° = 72°. That's holonomy. In curved space, the path you take changes the object you carry." |
| 1:35 | Gate opens; roll to the goal | "Go round the other way and it turns the other way. Some gates need both: a 4D twist and a loop." |
| 1:45 | Level 5 overview, or the README screenshot | "Under the hood: exact Lorentz-matrix geometry in float64, instanced GPU rendering at 60 FPS, and 118 tests, including an autopilot that plays every level to the end with the real physics." |
| 1:55 | Title | "The Key and the Curve." |

If time is short, skip level 1 and start at level 2.
