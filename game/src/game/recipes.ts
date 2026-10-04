/**
 * Recipes for the generated levels (2 and 6–8). `npm run levels` turns each
 * one into levels/<n>-<name>.json with the generator (generator.ts), which
 * only keeps levels the solver proves fair. Levels 1, 3–5 and 9 were laid out
 * by hand.
 *
 * Regenerating is deterministic: the same recipe always gives the same file.
 * Edit the recipe (not the JSON) and rerun, then run the tests.
 */

import type { LevelRecipe } from './generator';

export const RECIPES: { file: string; recipe: LevelRecipe }[] = [
  {
    file: '2-rift.json',
    recipe: {
      name: 'Rift',
      seed: 11,
      depth: 2,
      extraOpenings: 1,
      doors: 0,
      rifts: 2,
      shards: 2,
      hunters: [],
      intro:
        'Your marble carries a tesseract, a 4D cube: it is the picture in the corner, and it is how you look at the world. The glowing cracks are rifts. Over each one floats a plank that is four-dimensional, so all you see is its smeared shadow. Hold Shift and use the arrow keys (or hold BOOT and tilt the controller) to turn your view into the fourth dimension. The tesseract turns, the shadow shifts, and when the plank lies flat over the crack it becomes a bridge.',
      hint: 'Rift: hold Shift + arrows (or BOOT + tilt) to turn your 4D view until the plank lies flat. F straightens your view.',
    },
  },
  {
    file: '6-shifter.json',
    recipe: {
      name: 'Shifter',
      seed: 21,
      depth: 3,
      extraOpenings: 4,
      doors: 2,
      shards: 3,
      hunters: [{ layer: 2, shiftEvery: 8 }, { layer: 0 }],
      hunterSpeed: 0.8,
      intro:
        'Not every hunter stays in one colour. A shifter slides to the next colour every few seconds. Its spinning dashed ring shows the colour it will move into, and it flickers just before it goes. If it is about to slide into your colour, be somewhere else.',
      hint: 'Dashed ring = the colour a shifter moves into next. It flickers just before it shifts.',
    },
  },
  {
    file: '7-orbit.json',
    recipe: {
      name: 'Orbit',
      seed: 31,
      depth: 3,
      extraOpenings: 0,
      pillarLoops: 3,
      doors: 2,
      shards: 3,
      twist: false,
      hunters: [{ layer: 3 }],
      hunterSpeed: 0.45,
      intro:
        'Twisting is jammed again, and the maze is bigger. Three glowing pillars each have a lap around them. Every clockwise lap takes you up one colour and every counter-clockwise lap takes you down one: only the curvature of space can change your colour here. Plan your laps.',
      hint: 'Twist jammed. Lap a glowing pillar: clockwise = next colour, counter-clockwise = previous.',
    },
  },
  {
    file: '8-flux.json',
    recipe: {
      name: 'Flux',
      seed: 41,
      depth: 3,
      extraOpenings: 5,
      doors: 3,
      rifts: 1,
      shards: 4,
      hunters: [{ layer: 1, shiftEvery: 7 }, { layer: 3, shiftEvery: 7, shiftStep: -1 }, { layer: 0 }],
      hunterSpeed: 0.9,
      intro:
        'Two shifters cycle through the colours in opposite directions, and a red hunter never leaves red. The ring around your 4D view shows which colour every hunter is in right now (shifters have a white outline). There is a rift on the way: bridge it with your 4D view while they hunt you.',
      hint: 'Two shifters, opposite ways round. Check the phase ring before you phase.',
    },
  },
];
