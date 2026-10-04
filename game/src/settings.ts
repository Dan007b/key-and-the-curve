/**
 * Player settings: controller tilt and phase-twist feel, rolling friction,
 * and a few toggles. Kept in this browser's localStorage as a convenience;
 * everything works without it.
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
  /** Degrees of phase per degree of controller turn (72° of phase = one layer). */
  phaseGain: number;
  phaseInvert: boolean;
  /** Marble damping rate, 1/s. */
  damping: number;
  trail: boolean;
  sound: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  fullTiltDeg: DEFAULT_TILT.fullTiltDeg,
  deadzone: DEFAULT_TILT.deadzone,
  invertX: false,
  invertY: false,
  swapXY: false,
  phaseGain: 1.2,
  phaseInvert: false,
  damping: DEFAULT_MARBLE.damping,
  trail: true,
  sound: true,
};

const STORAGE_KEY = 'phase-escape.settings.v1';

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
  const row = (label: string, control: HTMLElement) => {
    const r = document.createElement('label');
    r.className = 'settings-row';
    const l = document.createElement('span');
    l.textContent = label;
    r.append(l, control);
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

  section('Controller: rolling (tilt)');
  slider('Sensitivity (full tilt at)', 8, 45, 1, () => s.fullTiltDeg, (v) => (s.fullTiltDeg = v), (v) => `${v}°`);
  slider('Deadzone', 0, 0.4, 0.01, () => s.deadzone, (v) => (s.deadzone = v), (v) => `${Math.round(v * 100)}%`);
  checkbox('Invert left/right', () => s.invertX, (v) => (s.invertX = v));
  checkbox('Invert up/down', () => s.invertY, (v) => (s.invertY = v));
  checkbox('Swap axes', () => s.swapXY, (v) => (s.swapXY = v));

  section('Controller: phasing (turn like a dial)');
  slider('Turn needed per layer', 30, 120, 1, () => 72 / s.phaseGain, (v) => (s.phaseGain = 72 / v), (v) => `${Math.round(v)}°`);
  checkbox('Reverse phasing direction', () => s.phaseInvert, (v) => (s.phaseInvert = v));

  section('Game');
  slider('Rolling friction', 0.2, 3, 0.05, () => s.damping, (v) => (s.damping = v), (v) => `${v.toFixed(2)} /s`);
  checkbox('Holonomy trail (T)', () => s.trail, (v) => (s.trail = v));
  checkbox('Sound (M)', () => s.sound, (v) => (s.sound = v));
  return form;
}
