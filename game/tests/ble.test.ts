// The Bluetooth sample packet (firmware/src/main.cpp streamSample) and the
// controller input it drives.

import { describe, expect, it } from 'vitest';
import { parseBlePacket, parseLine } from '../src/input/serialProtocol';
import { ControllerInput } from '../src/input/ControllerInput';

/** Encodes a packet the way the firmware does: register units, little-endian int16. */
function packet(o: { seq?: number; btn?: number; cal: [number, number, number, number]; gravity: number[]; gyroDps: number[] }): DataView {
  const v = new DataView(new ArrayBuffer(16));
  v.setUint8(0, 1);
  v.setUint8(1, o.seq ?? 0);
  v.setUint8(2, o.btn ?? 0);
  const [s, g, a, m] = o.cal;
  v.setUint8(3, (s << 6) | (g << 4) | (a << 2) | m);
  o.gravity.forEach((x, i) => v.setInt16(4 + 2 * i, Math.round(x * 100), true));
  o.gyroDps.forEach((x, i) => v.setInt16(10 + 2 * i, Math.round(x * 16), true));
  return v;
}

describe('Bluetooth sample packet', () => {
  it('decodes gravity, gyro (to rad/s), calibration and buttons', () => {
    const p = parseBlePacket(packet({ seq: 200, btn: 1, cal: [3, 3, 2, 1], gravity: [0.07, -0.17, 9.8], gyroDps: [1, -2000, 0.0625] }))!;
    expect(p.seq).toBe(200);
    expect(p.sample.buttons).toBe(1);
    expect(p.sample.calibration).toBe(3321);
    expect(p.sample.gravity[0]).toBeCloseTo(0.07, 10);
    expect(p.sample.gravity[1]).toBeCloseTo(-0.17, 10);
    expect(p.sample.gravity[2]).toBeCloseTo(9.8, 10);
    expect(p.sample.gyro[0]).toBeCloseTo(Math.PI / 180, 12);
    expect(p.sample.gyro[1]).toBeCloseTo((-2000 * Math.PI) / 180, 9);
    expect(p.sample.gyro[2]).toBeCloseTo((0.0625 * Math.PI) / 180, 12); // one LSB
    expect(p.sample.quat).toBeNull();
  });

  it('rejects the wrong length or format version', () => {
    expect(parseBlePacket(new DataView(new ArrayBuffer(15)))).toBeNull();
    const v = packet({ cal: [0, 0, 0, 0], gravity: [0, 0, 9.8], gyroDps: [0, 0, 0] });
    v.setUint8(0, 2);
    expect(parseBlePacket(v)).toBeNull();
  });

  it('drives the controls exactly like the same sample over USB', () => {
    const usb = new ControllerInput();
    const ble = new ControllerInput();
    const feedUsb = (line: string) => (usb as unknown as { handleLine(l: string): void }).handleLine(line);
    const feedBle = (v: DataView) => (ble as unknown as { handleBlePacket(v: DataView): void }).handleBlePacket(v);
    // Level first (flat), then tilted and turning.
    feedUsb('$,1,0,0,0,0.00,0.00,9.81,0.0000,0.0000,0.0000,3333,0');
    feedBle(packet({ cal: [3, 3, 3, 3], gravity: [0, 0, 9.81], gyroDps: [0, 0, 0] }));
    usb.setLevel();
    ble.setLevel();
    const line = '$,1,0,0,0,1.70,-0.85,9.62,0.0000,0.0000,1.7453,3333,0';
    expect(parseLine(line)).not.toBeNull();
    feedUsb(line);
    feedBle(packet({ seq: 1, cal: [3, 3, 3, 3], gravity: [1.7, -0.85, 9.62], gyroDps: [0, 0, 100] }));
    const a = usb.tilt();
    const b = ble.tilt();
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
    expect(Math.hypot(a.x, a.y)).toBeGreaterThan(0.1);
    // 1.7453 rad/s over USB is 100 °/s, exactly what the packet carries.
    expect(ble.phaseRate()).toBeCloseTo(usb.phaseRate(), 2);
  });
});
