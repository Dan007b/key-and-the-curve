// Enforces CLAUDE.md §11: the math layer is pure and never imports Three.js.

/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const mathDir = fileURLToPath(new URL('../src/math', import.meta.url));

describe('src/math', () => {
  it('does not import three', () => {
    const files = readdirSync(mathDir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(join(mathDir, file), 'utf8');
      expect(src, file).not.toMatch(/from\s+['"]three/);
    }
  });
});
