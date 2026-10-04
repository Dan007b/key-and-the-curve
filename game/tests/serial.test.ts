/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TILT, LineSplitter, parseLine, tiltFromGravity, yawRate } from '../src/input/serialProtocol';

const GOOD = '$,0.99994,-0.00412,0.00897,0.00015,0.07,-0.17,9.80,0.0011,-0.0022,0.0000,3333,1';

describe('parseLine', () => {
  it('parses a well-formed sample', () => {
    const s = parseLine(GOOD)!;
    expect(s.quat).toEqual([0.99994, -0.00412, 0.00897, 0.00015]);
    expect(s.gravity).toEqual([0.07, -0.17, 9.8]);
    expect(s.gyro).toEqual([0.0011, -0.0022, 0]);
    expect(s.calibration).toBe(3333);
    expect(s.buttons).toBe(1);
  });

  it('accepts a CR line ending and plain-integer calibration', () => {
    expect(parseLine(GOOD.replace(',3333,', ',300,') + '\r')?.calibration).toBe(300);
  });

  it('ignores debug lines and rejects malformed ones', () => {
    for (const bad of [
      '#hz 100.0 overruns 0',
      '#cal loaded from NVS',
      '',
      '7,0.2029,3333,0', // a fragment of a line
      GOOD.replace('9.80', '9.8x'),
      GOOD + ',5', // extra field
      GOOD.replace('$,', 'X,'),
      GOOD.replace(',3333,', ',33.5,'), // non-integer calibration
      GOOD.replace('0.07', 'NaN'),
    ]) {
      expect(parseLine(bad)).toBeNull();
    }
  });
});

describe('LineSplitter', () => {
  it('reassembles lines split across chunks', () => {
    const s = new LineSplitter();
    expect(s.push(GOOD.slice(0, 20))).toEqual([]);
    expect(s.push(GOOD.slice(20) + '\r\n#hz 100.0\r\n$,1')).toEqual([GOOD, '#hz 100.0']);
    expect(s.push(',0,0,0,0,0,9.8,0,0,0,3333,0\n')).toEqual(['$,1,0,0,0,0,0,9.8,0,0,0,3333,0']);
  });

  it('drops runaway garbage without a newline', () => {
    const s = new LineSplitter();
    s.push('x'.repeat(1000));
    expect(s.push('\n' + GOOD + '\n')).toEqual([GOOD]);
  });
});

describe('tiltFromGravity', () => {
  const flat: [number, number, number] = [0, 0, 1];
  const deg = Math.PI / 180;
  // Gravity reading (it points up at rest) after lowering the board's +x edge by θ:
  // world-up seen from the sensor is (−sin θ, 0, cos θ).
  const lowerPlusX = (t: number): [number, number, number] => [-9.8 * Math.sin(t * deg), 0, 9.8 * Math.cos(t * deg)];
  const noDeadzone = { ...DEFAULT_TILT, deadzone: 0 };

  it('is zero when level', () => {
    expect(tiltFromGravity([0, 0, 9.8], flat, DEFAULT_TILT)).toEqual({ x: 0, y: 0 });
  });

  it('rolls towards the lowered edge, scaled by the full-tilt angle', () => {
    const t = tiltFromGravity(lowerPlusX(10), flat, noDeadzone);
    expect(t.x).toBeCloseTo(Math.sin(10 * deg) / Math.sin(DEFAULT_TILT.fullTiltDeg * deg), 12);
    expect(t.y).toBeCloseTo(0, 12);
  });

  it('clamps past full tilt and honours the deadzone', () => {
    expect(tiltFromGravity(lowerPlusX(60), flat, noDeadzone).x).toBeCloseTo(1, 12);
    expect(tiltFromGravity(lowerPlusX(1), flat, { ...DEFAULT_TILT, deadzone: 0.1 })).toEqual({ x: 0, y: 0 });
  });

  it('works relative to any captured level, e.g. the board held upright', () => {
    // Holding the board with its +y axis pointing up: gravity reads (0, 9.8, 0).
    const upright: [number, number, number] = [0, 9.8, 0];
    expect(tiltFromGravity(upright, upright, DEFAULT_TILT)).toEqual({ x: 0, y: 0 });
    const tilted: [number, number, number] = [-9.8 * Math.sin(10 * deg), 9.8 * Math.cos(10 * deg), 0];
    const t = tiltFromGravity(tilted, upright, noDeadzone);
    expect(Math.hypot(t.x, t.y)).toBeCloseTo(Math.sin(10 * deg) / Math.sin(DEFAULT_TILT.fullTiltDeg * deg), 12);
  });

  it('applies swap and invert settings', () => {
    const t = tiltFromGravity(lowerPlusX(10), flat, { ...noDeadzone, swapXY: true, invertY: true });
    expect(t.x).toBeCloseTo(0, 12);
    expect(t.y).toBeLessThan(0);
  });
});

describe('recorded controller output', () => {
  // Two seconds captured from the real ESP32 + BNO055 at 921600 baud (board at rest).
  const raw = readFileSync(fileURLToPath(new URL('./fixtures/controller-2s.txt', import.meta.url)), 'latin1');

  it('parses cleanly when fed in arbitrary chunks', () => {
    const splitter = new LineSplitter();
    const lines: string[] = [];
    for (let i = 0; i < raw.length; ) {
      const n = 1 + ((i * 7919) % 97); // deterministic odd-sized chunks
      lines.push(...splitter.push(raw.slice(i, i + n)));
      i += n;
    }
    const samples = lines.map(parseLine);
    const good = samples.filter((s) => s !== null);
    // ~100 Hz for 2 s; at most the first (partial) line is unusable.
    expect(good.length).toBeGreaterThan(190);
    expect(samples.length - good.length).toBeLessThanOrEqual(1);
    for (const s of good) {
      expect(Math.hypot(...s!.quat)).toBeCloseTo(1, 2);
      expect(Math.hypot(...s!.gravity)).toBeGreaterThan(9.5);
    }
    // At rest, tilt relative to its own first reading stays inside the deadzone.
    const ref = good[0]!.gravity;
    for (const s of good) expect(tiltFromGravity(s!.gravity, ref, DEFAULT_TILT)).toEqual({ x: 0, y: 0 });
  });
});

describe('yawRate (turning the controller like a dial)', () => {
  it('measures rotation about the level vertical, whatever way up the board is', () => {
    expect(yawRate([0, 0, 1.2], [0, 0, 9.8])).toBeCloseTo(1.2, 12);
    // Board held upright (its y axis is up): the dial axis is y.
    expect(yawRate([0, -0.9, 0], [0, 9.8, 0])).toBeCloseTo(-0.9, 12);
  });

  it('ignores tilting and small wobbles', () => {
    expect(yawRate([1.5, -1.0, 0], [0, 0, 9.8])).toBe(0);
    expect(yawRate([0, 0, 0.2], [0, 0, 9.8])).toBe(0);
  });
});
