/**
 * Player settings (CLAUDE.md §9): sensitivity, deadzone, damping, the twist
 * axis mapping, the gate tolerance τ, and a few toggles. Kept in this
 * browser's localStorage as a convenience; everything works without it.
 */

import { DEFAULT_TILT } from './input/serialProtocol';
import { DEFAULT_MARBLE } from './game/marble';

export interface Settings {
  /** Controller tilt angle counted as full tilt, degrees. */
  fullTiltDeg: number;
  deadzone: number;
  invertX: boolean;
  invertY: boolean;
  swapXY: boolean;
  /** Marble damping rate, 1/s. */
  damping: number;
  /** Gate tolerance τ. */
  tolerance: number;
  /** Sensor axis (0 = x, 1 = y, 2 = z) driving the XW, YW and ZW planes. */
  twistAxes: [number, number, number];
  twistInvert: [boolean, boolean, boolean];
  trail: boolean;
  sound: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  fullTiltDeg: DEFAULT_TILT.fullTiltDeg,
  deadzone: DEFAULT_TILT.deadzone,
  invertX: false,
  invertY: false,
  swapXY: false,
  damping: DEFAULT_MARBLE.damping,
  tolerance: 0.35,
  twistAxes: [0, 1, 2],
  twistInvert: [false, false, false],
  trail: true,
  sound: true,
};

const STORAGE_KEY = 'key-and-the-curve.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Storage unavailable (private window, blocked site data): use defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Not fatal: settings just won't persist.
  }
}

/** Builds the settings form. `onChange` is called with the updated settings after every edit. */
export function settingsForm(initial: Settings, onChange: (s: Settings) => void): HTMLElement {
  const s: Settings = structuredClone(initial);
  const form = document.createElement('div');
  form.className = 'settings';

  const section = (title: string) => {
    const h = document.createElement('h2');
    h.textContent = title;
    form.appendChild(h);
  };
  const row = (label: string, control: HTMLElement, note?: string) => {
    const r = document.createElement('label');
    r.className = 'settings-row';
    const l = document.createElement('span');
    l.textContent = label;
    r.append(l, control);
    if (note) {
      const n = document.createElement('small');
      n.textContent = note;
      r.appendChild(n);
    }
    form.appendChild(r);
  };
  const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) => {
    const wrap = document.createElement('span');
    wrap.className = 'settings-slider';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    const out = document.createElement('output');
    out.textContent = fmt(get());
    input.addEventListener('input', () => {
      set(Number(input.value));
      out.textContent = fmt(get());
      onChange(structuredClone(s));
    });
    wrap.append(input, out);
    row(label, wrap);
  };
  const checkbox = (label: string, get: () => boolean, set: (v: boolean) => void) => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = get();
    input.addEventListener('change', () => {
      set(input.checked);
      onChange(structuredClone(s));
    });
    row(label, input);
  };

  section('Controller tilt');
  slider('Sensitivity (full tilt at)', 8, 45, 1, () => s.fullTiltDeg, (v) => (s.fullTiltDeg = v), (v) => `${v}°`);
  slider('Deadzone', 0, 0.4, 0.01, () => s.deadzone, (v) => (s.deadzone = v), (v) => `${Math.round(v * 100)}%`);
  checkbox('Invert left/right', () => s.invertX, (v) => (s.invertX = v));
  checkbox('Invert up/down', () => s.invertY, (v) => (s.invertY = v));
  checkbox('Swap axes', () => s.swapXY, (v) => (s.swapXY = v));

  section('Twist mapping (controller)');
  (['XW', 'YW', 'ZW'] as const).forEach((plane, i) => {
    const wrap = document.createElement('span');
    wrap.className = 'settings-pair';
    const select = document.createElement('select');
    ['sensor x', 'sensor y', 'sensor z'].forEach((name, axis) => {
      const o = document.createElement('option');
      o.value = String(axis);
      o.textContent = name;
      select.appendChild(o);
    });
    select.value = String(s.twistAxes[i]);
    select.addEventListener('change', () => {
      s.twistAxes[i] = Number(select.value);
      onChange(structuredClone(s));
    });
    const inv = document.createElement('input');
    inv.type = 'checkbox';
    inv.checked = s.twistInvert[i];
    inv.title = 'Invert';
    inv.addEventListener('change', () => {
      s.twistInvert[i] = inv.checked;
      onChange(structuredClone(s));
    });
    const invLabel = document.createElement('span');
    invLabel.textContent = 'invert';
    wrap.append(select, inv, invLabel);
    row(`${plane} plane`, wrap);
  });

  section('Game');
  slider('Rolling friction', 0.2, 3, 0.05, () => s.damping, (v) => (s.damping = v), (v) => `${v.toFixed(2)} /s`);
  slider('Gate tolerance τ', 0.15, 0.6, 0.01, () => s.tolerance, (v) => (s.tolerance = v), (v) => `${v.toFixed(2)} (≈${Math.round((2 * Math.asin(v / (2 * Math.SQRT2)) * 180) / Math.PI)}°)`);
  checkbox('Holonomy trail (T)', () => s.trail, (v) => (s.trail = v));
  checkbox('Sound (M)', () => s.sound, (v) => (s.sound = v));
  return form;
}
