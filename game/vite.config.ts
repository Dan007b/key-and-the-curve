import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the built game also loads from disk (desktop app).
  base: './',
  server: {
    // Web Serial requires a secure context; localhost qualifies.
    host: 'localhost',
    port: 5173,
  },
  build: {
    // Three.js alone is ~600 kB minified; one chunk is fine for a local game.
    chunkSizeWarningLimit: 1000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
