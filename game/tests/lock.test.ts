// Guidance for the 4D lock: the per-plane "turn this far" maths, the lock
// analysis on the real gates, the controller's one-plane filter, and the
// settle assist.

import { describe, expect, it } from 'vitest';
import { bestTwistAngle, frobenius, identity4, mul4, planeRotation, rotationFromList } from '../src/math/four';
import type { Plane } from '../src/math/four';
import { analyzeLock, splitTarget } from '../src/game/lock';
import { dominantTwist } from '../src/input/serialProtocol';
import { Game } from '../src/game/game';
import { LEVELS } from '../src/game/level';
import { drive, idle, routeWaypoints } from './bot';
import { rng } from './helpers';

const DEG = Math.PI / 180;

describe('bestTwistAngle', () => {
  it('reads off a pure single-plane mismatch exactly, and zero for the other planes', () => {
    const k = rotationFromList([['zw', 30], ['xy', 20]]);
    for (const plane of ['xw', 'yw', 'zw'] as Plane[]) {
      const target = mul4(planeRotation(plane, 62 * DEG), k);
      expect(bestTwistAngle(k, target, plane) / DEG).toBeCloseTo(62, 9);
      for (const other of ['xw', 'yw', 'zw'] as Plane[]) {
        if (other !== plane) expect(Math.abs(bestTwistAngle(k, target, other))).toBeLessThan(0.6);
      }
    }
  });

  it('minimises the fit distance along that plane (checked by brute force)', () => {
    const rand = rng(31);
    for (let n = 0; n < 20; n++) {
      const k = rotationFromList([['xw', rand() * 360], ['yz', rand() * 360], ['zw', rand() * 360]]);
      const t = rotationFromList([['yw', rand() * 360], ['xy', rand() * 360]]);
      for (const plane of ['xw', 'yw', 'zw'] as Plane[]) {
        const best = bestTwistAngle(k, t, plane);
        const f = (a: number) => frobenius(mul4(planeRotation(plane, a), k), t);
        for (let a = -Math.PI; a < Math.PI; a += 0.05) expect(f(best)).toBeLessThanOrEqual(f(a) + 1e-9);
      }
    }
  });
});

describe('analyzeLock on the real gates', () => {
  it('every gate target is written as twists followed by the XY turn (the lock panel relies on it)', () => {
    for (const spec of LEVELS) {
      for (const g of spec.gates ?? []) {
        const firstXy = g.target.findIndex(([p]) => p === 'xy');
        if (firstXy !== -1) expect(g.target.slice(firstXy).every(([p]) => p === 'xy')).toBe(true);
        const { xyDeg, twist } = splitTarget(g.target);
        expect(frobenius(mul4(planeRotation('xy', xyDeg * DEG), twist), rotationFromList(g.target))).toBeLessThan(1e-12);
      }
    }
  });

  it('level 2: curvature is fine, XW needs +90° (hold Q)', () => {
    const s = analyzeLock(identity4(), 0, LEVELS[1].gates![0]);
    expect(s.curvature.set).toBe(true);
    expect(s.twists.find((t) => t.plane === 'xw')!.remainingDeg).toBeCloseTo(90, 9);
    expect(s.twists.filter((t) => t.set).map((t) => t.plane)).toEqual(['yw', 'zw']);
    expect(s.next).toBe('xw');
    expect(s.setCount).toBe(3);
  });

  it('level 3: one counter-clockwise lap needed, then everything is set', () => {
    const gate = LEVELS[2].gates![0];
    const before = analyzeLock(identity4(), 0, gate);
    expect(before.curvature.laps).toBe(-1);
    expect(before.next).toBeNull();
    const after = analyzeLock(identity4(), -72 * DEG, gate);
    expect(after.curvature.set).toBe(true);
    expect(after.setCount).toBe(4);
  });

  it('level 4: one clockwise lap and YW +90°', () => {
    const s = analyzeLock(identity4(), 0, LEVELS[3].gates![0]);
    expect(s.curvature.laps).toBe(1);
    expect(s.twists.find((t) => t.plane === 'yw')!.remainingDeg).toBeCloseTo(90, 9);
    expect(s.next).toBe('yw');
  });
});

describe('dominantTwist (controller, one plane at a time)', () => {
  it('keeps only the strongest axis and ignores small wobble', () => {
    expect(dominantTwist([1.2, 0.4, -0.3], -1)).toEqual({ rates: [1.2, 0, 0], active: 0 });
    expect(dominantTwist([0.1, -0.2, 0.05], 0)).toEqual({ rates: [0, 0, 0], active: -1 });
  });

  it('does not flicker between two similar axes', () => {
    expect(dominantTwist([1.0, 1.3, 0], 0).active).toBe(0); // 1.3 < 1.6 × 1.0: stay on XW
    expect(dominantTwist([1.0, 1.8, 0], 0).active).toBe(1); // clearly stronger: switch
  });
});

describe('settle assist', () => {
  const nearlyTwisted = (assist: boolean) => {
    const game = new Game();
    game.settings.assist = assist;
    game.load(LEVELS[1]);
    drive(game, routeWaypoints(game, [0, 4]));
    // 70° of the needed 90°: within 2τ but not τ.
    game.key = planeRotation('xw', 70 * DEG);
    idle(game, 2);
    return game.gates[0].open;
  };

  it('slides a nearly-right key into the gate once the player lets go', () => {
    expect(nearlyTwisted(true)).toBe(true);
  });

  it('can be turned off', () => {
    expect(nearlyTwisted(false)).toBe(false);
  });
});
