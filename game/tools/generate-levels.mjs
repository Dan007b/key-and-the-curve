// Writes the generated levels (src/game/recipes.ts) to levels/*.json.
// Usage (from game/): npm run levels
// Loads the TypeScript sources through Vite's module runner, so no build step is needed.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const opts = { root, configFile: false, logLevel: 'error' };
const { module: generator } = await runnerImport('/src/game/generator.ts', opts);
const { module: recipes } = await runnerImport('/src/game/recipes.ts', opts);

for (const { file, recipe } of recipes.RECIPES) {
  const { spec, moves, rejected } = generator.generateLevel(recipe);
  writeFileSync(new URL(`../levels/${file}`, import.meta.url), JSON.stringify(spec, null, 2) + '\n');
  console.log(`${file}: seed ${spec.seed} (${rejected} rejected), ${moves} moves, par ${spec.par} s`);
}
// The module runner keeps file watchers open; we're done.
process.exit(0);
