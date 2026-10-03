// Phase 0 smoke test: confirms vitest runs and float64 hyperbolic
// functions behave as expected. Real math tests arrive in Phase 2.
import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2);
  });

  it('satisfies cosh² − sinh² = 1', () => {
    for (const d of [0, 0.5, 1, 3, 7]) {
      expect(Math.cosh(d) ** 2 - Math.sinh(d) ** 2).toBeCloseTo(1, 9);
    }
  });
});
