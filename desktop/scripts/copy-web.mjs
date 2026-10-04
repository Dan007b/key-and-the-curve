// Copies the built game (game/dist) into desktop/web, where the app loads it from.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../../game/dist', import.meta.url));
const to = fileURLToPath(new URL('../web', import.meta.url));

if (!existsSync(from)) {
  console.error('game/dist is missing: build the game first (npm --prefix ../game run build).');
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`Copied ${from} -> ${to}`);
