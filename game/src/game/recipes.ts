/**
 * Recipes for the generated levels (5–7). `npm run levels` turns each one
 * into levels/<n>-<name>.json with the generator (generator.ts), which only
 * keeps levels the solver proves fair. Levels 1–4 and 8 were laid out by hand.
 *
 * Regenerating is deterministic: the same recipe always gives the same file.
 * Edit the recipe (not the JSON) and rerun, then run the tests.
 */

import type { LevelRecipe } from './generator';

export const RECIPES: { file: string; recipe: LevelRecipe }[] = [
  {
    file: '5-shifter.json',
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
    file: '6-orbit.json',
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
    file: '7-flux.json',
    recipe: {
      name: 'Flux',
      seed: 41,
      depth: 3,
      extraOpenings: 5,
      doors: 3,
      shards: 4,
      hunters: [{ layer: 1, shiftEvery: 7 }, { layer: 3, shiftEvery: 7, shiftStep: -1 }, { layer: 0 }],
      hunterSpeed: 0.9,
      intro:
        'Two shifters cycle through the colours in opposite directions, and a red hunter never leaves red. The ring around your 4D body shows which colour every hunter is in right now (shifters have a white outline).',
      hint: 'Two shifters, opposite ways round. Check the phase ring before you phase.',
    },
  },
];
