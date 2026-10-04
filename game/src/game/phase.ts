/**
 * The fourth dimension in Phase Escape.
 *
 * The maze is a 2D hyperbolic maze times a circle: a phase w that wraps
 * around. The circle is cut into five layers of 72° each. Everything coloured
 * lives in one layer: doors are open only in their own layer, shards can only
 * be picked up there, and hunters can only see or touch you there.
 *
 * Your phase has two parts:
 * - twist: what you dial in yourself (keys, BOOT, or turning the controller);
 * - curvature: the holonomy you have picked up by looping pillars. One lap
 *   around a pillar turns your carried frame by exactly 72° (transport.ts),
 *   which is exactly one layer. Space itself moves you through the fourth
 *   dimension.
 *
 * Why 5 and 72°: in the {5,4} tiling the four rooms around a pillar form a
 * square with 72° corners, so a lap picks up 2·180° − 4·72° = 72°, and five
 * laps make a full turn. The layers are the holonomy group of the maze.
 */

export const LAYERS = 5;
export const LAYER_DEG = 360 / LAYERS;
export const LAYER_NAMES = ['Red', 'Gold', 'Green', 'Blue', 'Violet'];
export const LAYER_RGB: [number, number, number][] = [
  [1.0, 0.33, 0.36],
  [1.0, 0.76, 0.22],
  [0.28, 0.95, 0.52],
  [0.3, 0.64, 1.0],
  [0.78, 0.47, 1.0],
];
export const LAYER_CSS = ['#ff5a5c', '#ffc238', '#48f285', '#4da3ff', '#c778ff'];

/** n mod m, always in [0, m). */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** The layer you are in, from your twist (degrees, continuous) and your curvature (whole 72° steps). */
export function layerOf(twistDeg: number, holonomySteps: number): number {
  return mod(Math.round(twistDeg / LAYER_DEG) + holonomySteps, LAYERS);
}

/** Holonomy in radians → whole layer steps (it is always a multiple of 72° here). */
export function holonomySteps(holonomy: number): number {
  return Math.round((holonomy * 180) / Math.PI / LAYER_DEG);
}
