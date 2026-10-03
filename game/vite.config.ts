import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    // Web Serial requires a secure context; localhost qualifies.
    host: 'localhost',
    port: 5173,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
