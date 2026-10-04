/**
 * The ESP32 + BNO055 controller over Web Serial (Chrome or Edge on localhost).
 *
 * - connect() must run from a user gesture (the "Connect controller" button).
 * - Opens at 921600 baud, then drops DTR and RTS so the DevKitC's auto-reset
 *   circuit leaves the board running.
 * - Parses lines robustly (partial chunks, '#' debug lines, garbage dropped).
 * - Tilt comes from the gravity vector relative to a captured "level"
 *   reference (setLevel()). Turning the controller about that vertical, like
 *   a dial, slides you through the fourth dimension; a BOOT tap steps up one
 *   layer, and holding BOOT makes tilt turn your 4D view instead of rolling.
 */

import type { InputSource, InputStatus } from './InputSource';
import { BootButton, DEFAULT_TILT, LineSplitter, parseLine, tiltFromGravity, yawRate } from './serialProtocol';
import type { Sample, TiltSettings } from './serialProtocol';

/** Must match kBaud in firmware/src/main.cpp. */
export const BAUD = 921600;

// Minimal Web Serial typings (not yet in TypeScript's DOM library).
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(options?: { filters?: { usbVendorId: number }[] }): Promise<SerialPortLike>;
}

/** USB-serial bridges seen on ESP32 boards: Silicon Labs CP210x, WCH CH340, FTDI, Espressif native. */
const USB_VENDORS = [0x10c4, 0x1a86, 0x0403, 0x303a];

export class SerialInput implements InputSource {
  tiltSettings: TiltSettings = { ...DEFAULT_TILT };
  /** Degrees of phase per degree of controller turn (72° of phase is one layer). */
  phaseGain = 1.2;
  phaseInvert = false;
  /** Called with every '#' line from the board (for a debug console). */
  onDebugLine: ((line: string) => void) | null = null;

  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private latest: Sample | null = null;
  private reference: [number, number, number] = [0, 0, 1];
  private recentGravity: [number, number, number][] = [];
  private readonly boot = new BootButton();
  private sampleTimes: number[] = [];
  private lastVibration = -1;
  private lastVibrationTime = 0;

  /** Whether this browser can talk to serial ports at all. */
  static supported(): boolean {
    return 'serial' in navigator;
  }

  connected(): boolean {
    return this.port !== null;
  }

  async connect(): Promise<void> {
    const serial = (navigator as unknown as { serial: SerialLike }).serial;
    const port = await serial.requestPort({ filters: USB_VENDORS.map((usbVendorId) => ({ usbVendorId })) });
    await port.open({ baudRate: BAUD });
    // Deassert DTR/RTS: on the DevKitC these drive EN and GPIO0 through the
    // auto-reset transistors, and leaving one asserted can reset the board.
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    this.port = port;
    void this.readLoop(port);
  }

  async disconnect(): Promise<void> {
    const port = this.port;
    this.port = null;
    try {
      await this.reader?.cancel();
      await port?.close();
    } catch {
      // Already gone (unplugged); nothing to clean up.
    }
  }

  private async readLoop(port: SerialPortLike): Promise<void> {
    const splitter = new LineSplitter();
    const decoder = new TextDecoder();
    while (this.port === port && port.readable) {
      this.reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          for (const line of splitter.push(decoder.decode(value, { stream: true }))) this.handleLine(line);
        }
      } catch {
        // A read error (e.g. unplugged) ends this reader; the outer loop exits if the port is gone.
        break;
      } finally {
        this.reader.releaseLock();
      }
    }
    if (this.port === port) {
      this.port = null;
      this.latest = null;
    }
  }

  private handleLine(line: string): void {
    if (line.startsWith('#')) {
      this.onDebugLine?.(line);
      return;
    }
    const s = parseLine(line);
    if (!s) return;
    this.latest = s;
    this.recentGravity.push(s.gravity);
    if (this.recentGravity.length > 20) this.recentGravity.shift();
    const now = performance.now();
    this.boot.update((s.buttons & 1) === 1, now);
    this.sampleTimes.push(now);
    while (this.sampleTimes.length > 0 && now - this.sampleTimes[0] > 1000) this.sampleTimes.shift();
  }

  /** Captures the current gravity (averaged over the last ~0.2 s) as "level". */
  setLevel(): boolean {
    if (this.recentGravity.length === 0) return false;
    const sum = this.recentGravity.reduce((a, g) => [a[0] + g[0], a[1] + g[1], a[2] + g[2]], [0, 0, 0]);
    this.reference = [sum[0], sum[1], sum[2]];
    return true;
  }

  /** Rolling tilt; zero while BOOT is held (then tilt turns your 4D view). */
  tilt(): { x: number; y: number } {
    if (!this.latest || this.boot.holding()) return { x: 0, y: 0 };
    return tiltFromGravity(this.latest.gravity, this.reference, this.tiltSettings);
  }

  /** While BOOT is held, tilt turns your 4D view: left/right in XW, forward/back in YW. */
  look(): { x: number; y: number } {
    if (!this.latest || !this.boot.holding()) return { x: 0, y: 0 };
    return tiltFromGravity(this.latest.gravity, this.reference, this.tiltSettings);
  }

  /** Whether BOOT is being held to look into 4D. */
  looking(): boolean {
    return this.boot.holding();
  }

  /** Degrees per second through the fourth dimension, from turning the controller like a dial. */
  phaseRate(): number {
    if (!this.latest) return 0;
    const w = yawRate(this.latest.gyro, this.reference);
    return ((w * 180) / Math.PI) * this.phaseGain * (this.phaseInvert ? -1 : 1);
  }

  /** One layer up per BOOT tap. */
  phaseSteps(): number {
    return this.boot.takeTaps();
  }

  status(): InputStatus {
    const hz = this.sampleTimes.length;
    return {
      label: 'Controller',
      connected: this.port !== null,
      calibration: this.latest?.calibration,
      hz: this.port ? hz : undefined,
    };
  }

  /**
   * Sends V,<0-255> when the strength changes, at most 20 times a second.
   * The firmware accepts it; no motor is fitted on this build.
   */
  vibrate(strength01: number): void {
    const port = this.port;
    if (!port?.writable) return;
    const v = Math.round(Math.max(0, Math.min(1, strength01)) * 255);
    const now = performance.now();
    if (v === this.lastVibration || now - this.lastVibrationTime < 50) return;
    this.lastVibration = v;
    this.lastVibrationTime = now;
    const writer = port.writable.getWriter();
    void writer.write(new TextEncoder().encode(`V,${v}\n`)).finally(() => writer.releaseLock());
  }
}
