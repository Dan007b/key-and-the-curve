/**
 * The ESP32 + BNO055 controller, over Bluetooth Low Energy (Web Bluetooth) or
 * a USB cable (Web Serial). Chrome or Edge on localhost, or the desktop app.
 *
 * - connectBluetooth() / connectSerial() must run from a user gesture (the
 *   "Connect controller" card). One link at a time.
 * - Bluetooth: finds the controller advertising as "PhaseEscape", subscribes
 *   to its 16-byte sample notifications and its '#' log lines, and sends
 *   commands to the command characteristic (protocol in serialProtocol.ts).
 * - USB: opens at 921600 baud, then drops DTR and RTS so the DevKitC's
 *   auto-reset circuit leaves the board running, and parses text lines
 *   robustly (partial chunks, '#' debug lines, garbage dropped).
 * - Either way, tilt comes from the gravity vector relative to a captured
 *   "level" reference (setLevel()). Turning the controller about that
 *   vertical, like a dial, slides you through the fourth dimension; a BOOT tap
 *   steps up one layer, and holding BOOT makes tilt turn your 4D view instead
 *   of rolling.
 */

import type { InputSource, InputStatus } from './InputSource';
import {
  BLE_COMMAND,
  BLE_LOG,
  BLE_NAME,
  BLE_SAMPLE,
  BLE_SERVICE,
  BootButton,
  DEFAULT_TILT,
  LineSplitter,
  parseBlePacket,
  parseLine,
  tiltFromGravity,
  yawRate,
} from './serialProtocol';
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

// Minimal Web Bluetooth typings (not in TypeScript's DOM library either).
interface GattCharacteristicLike extends EventTarget {
  readonly value: DataView | null;
  startNotifications(): Promise<GattCharacteristicLike>;
  writeValueWithoutResponse(value: Uint8Array): Promise<void>;
}
interface GattServiceLike {
  getCharacteristic(uuid: string): Promise<GattCharacteristicLike>;
}
interface GattServerLike {
  readonly connected: boolean;
  connect(): Promise<GattServerLike>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<GattServiceLike>;
}
interface BluetoothDeviceLike extends EventTarget {
  readonly name?: string;
  readonly gatt?: GattServerLike;
}
interface BluetoothLike {
  requestDevice(options: { filters: ({ services: string[] } | { name: string })[]; optionalServices?: string[] }): Promise<BluetoothDeviceLike>;
}

/** Attempts to reconnect a Bluetooth controller that dropped, before giving up. */
const RECONNECT_TRIES = 8;

/** USB-serial bridges seen on ESP32 boards: Silicon Labs CP210x, WCH CH340, FTDI, Espressif native. */
const USB_VENDORS = [0x10c4, 0x1a86, 0x0403, 0x303a];

export type Link = 'bluetooth' | 'usb';

export class ControllerInput implements InputSource {
  tiltSettings: TiltSettings = { ...DEFAULT_TILT };
  /** Degrees of phase per degree of controller turn (72° of phase is one layer). */
  phaseGain = 1.2;
  phaseInvert = false;
  /** Called with every '#' line from the board (for a debug console). */
  onDebugLine: ((line: string) => void) | null = null;

  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private ble: { device: BluetoothDeviceLike; server: GattServerLike; command: GattCharacteristicLike } | null = null;
  private latest: Sample | null = null;
  private reference: [number, number, number] = [0, 0, 1];
  private recentGravity: [number, number, number][] = [];
  private readonly boot = new BootButton();
  private sampleTimes: number[] = [];
  /** Bluetooth only: the last sequence number, and samples lost in the last second (from gaps in it). */
  private lastSeq = -1;
  private losses: number[] = [];
  private lastVibration = -1;
  private lastVibrationTime = 0;
  /** The Bluetooth controller we are trying to get back after it dropped, if any. */
  private reconnecting: BluetoothDeviceLike | null = null;

  /** Whether this browser can use a USB cable (Web Serial). */
  static serialSupported(): boolean {
    return 'serial' in navigator;
  }

  /** Whether this browser can use Bluetooth Low Energy (Web Bluetooth). */
  static bluetoothSupported(): boolean {
    return 'bluetooth' in navigator;
  }

  connected(): boolean {
    return this.link() !== null;
  }

  /** How the controller is connected, if it is. */
  link(): Link | null {
    if (this.ble) return 'bluetooth';
    if (this.port) return 'usb';
    return null;
  }

  /** Connects over Bluetooth: the browser (or the desktop app) finds the controller by its service. */
  async connectBluetooth(): Promise<void> {
    // (Only await when there is something to close: the chooser must open while the click still counts.)
    if (this.connected() || this.reconnecting) await this.disconnect();
    const bluetooth = (navigator as unknown as { bluetooth: BluetoothLike }).bluetooth;
    const device = await bluetooth.requestDevice({
      filters: [{ services: [BLE_SERVICE] }, { name: BLE_NAME }],
      optionalServices: [BLE_SERVICE],
    });
    if (!device.gatt) throw new Error('This Bluetooth device has no GATT server.');
    // If the link drops (out of range, batteries sagging), reconnect on our own: no chooser needed for a device already picked.
    device.addEventListener('gattserverdisconnected', () => {
      if (this.ble?.device !== device) return;
      this.dropLink();
      void this.reconnect(device);
    });
    await this.attach(device);
  }

  /** Tries to get a dropped controller back: up to RECONNECT_TRIES attempts, a second or two apart. */
  private async reconnect(device: BluetoothDeviceLike): Promise<void> {
    this.reconnecting = device;
    for (let i = 0; i < RECONNECT_TRIES && this.reconnecting === device; i++) {
      await new Promise((r) => setTimeout(r, 1000 + 500 * i));
      if (this.reconnecting !== device) return;
      try {
        await this.attach(device);
        this.reconnecting = null;
        return;
      } catch {
        // Not back yet; try again.
      }
    }
    if (this.reconnecting === device) this.reconnecting = null;
  }

  /** Opens the GATT connection to `device` and subscribes to its samples and log lines. */
  private async attach(device: BluetoothDeviceLike): Promise<void> {
    const server = await device.gatt!.connect();
    try {
      const service = await server.getPrimaryService(BLE_SERVICE);
      const sample = await service.getCharacteristic(BLE_SAMPLE);
      const command = await service.getCharacteristic(BLE_COMMAND);
      const log = await service.getCharacteristic(BLE_LOG);
      const decoder = new TextDecoder();
      sample.addEventListener('characteristicvaluechanged', () => {
        if (this.ble?.device === device && sample.value) this.handleBlePacket(sample.value);
      });
      log.addEventListener('characteristicvaluechanged', () => {
        if (this.ble?.device === device && log.value) this.onDebugLine?.(decoder.decode(log.value));
      });
      this.ble = { device, server, command };
      this.lastSeq = -1;
      await sample.startNotifications();
      await log.startNotifications();
    } catch (err) {
      this.ble = null;
      server.disconnect();
      throw err;
    }
  }

  /** Connects over a USB cable (Web Serial). */
  async connectSerial(): Promise<void> {
    if (this.connected() || this.reconnecting) await this.disconnect();
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
    this.reconnecting = null;
    const ble = this.ble;
    const port = this.port;
    this.dropLink();
    if (ble) ble.server.disconnect();
    try {
      await this.reader?.cancel();
      await port?.close();
    } catch {
      // Already gone (unplugged); nothing to clean up.
    }
  }

  /** Forgets the current link and its samples (the reference "level" is kept). */
  private dropLink(): void {
    this.ble = null;
    this.port = null;
    this.latest = null;
    this.sampleTimes = [];
    this.losses = [];
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
    if (this.port === port) this.dropLink();
  }

  private handleLine(line: string): void {
    if (line.startsWith('#')) {
      this.onDebugLine?.(line);
      return;
    }
    const s = parseLine(line);
    if (s) this.handleSample(s);
  }

  private handleBlePacket(view: DataView): void {
    const p = parseBlePacket(view);
    if (!p) return;
    // Notifications are not retransmitted; count gaps in the sequence as lost samples.
    if (this.lastSeq !== -1) {
      const lost = (p.seq - this.lastSeq - 1 + 256) % 256;
      const now = performance.now();
      for (let i = 0; i < lost; i++) this.losses.push(now);
    }
    this.lastSeq = p.seq;
    this.handleSample(p.sample);
  }

  private handleSample(s: Sample): void {
    this.latest = s;
    this.recentGravity.push(s.gravity);
    if (this.recentGravity.length > 20) this.recentGravity.shift();
    const now = performance.now();
    this.boot.update((s.buttons & 1) === 1, now);
    this.sampleTimes.push(now);
    while (this.sampleTimes.length > 0 && now - this.sampleTimes[0] > 1000) this.sampleTimes.shift();
    while (this.losses.length > 0 && now - this.losses[0] > 1000) this.losses.shift();
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
    const link = this.link();
    const hz = this.sampleTimes.length;
    return {
      label: link === 'bluetooth' ? 'Controller (Bluetooth)' : link === 'usb' ? 'Controller (USB)' : 'Controller',
      connected: link !== null,
      note: !link && this.reconnecting ? 'reconnecting…' : undefined,
      calibration: this.latest?.calibration,
      hz: link ? hz : undefined,
      lossPercent: link === 'bluetooth' && hz + this.losses.length > 0 ? (100 * this.losses.length) / (hz + this.losses.length) : undefined,
    };
  }

  /**
   * Sends a command ("P", "S", "V,<n>"): a line over USB, one write over Bluetooth.
   * Resolves false if not connected or the write failed.
   */
  async command(cmd: string): Promise<boolean> {
    const data = new TextEncoder().encode(cmd);
    try {
      if (this.ble) {
        await this.ble.command.writeValueWithoutResponse(data);
        return true;
      }
      const port = this.port;
      if (port?.writable && !port.writable.locked) {
        const writer = port.writable.getWriter();
        try {
          await writer.write(new TextEncoder().encode(`${cmd}\n`));
        } finally {
          writer.releaseLock();
        }
        return true;
      }
    } catch {
      // Link dropped mid-write.
    }
    return false;
  }

  /**
   * Sends V,<0-255> when the strength changes, at most 20 times a second, over
   * USB only: no motor is fitted, and over Bluetooth the radio is better spent
   * on samples.
   */
  vibrate(strength01: number): void {
    if (!this.port) return;
    const v = Math.round(Math.max(0, Math.min(1, strength01)) * 255);
    const now = performance.now();
    if (v === this.lastVibration || now - this.lastVibrationTime < 50) return;
    this.lastVibration = v;
    this.lastVibrationTime = now;
    void this.command(`V,${v}`);
  }
}
