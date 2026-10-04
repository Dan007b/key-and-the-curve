/**
 * Small synthesized sound effects (Web Audio, no files). The context is
 * created on the first user gesture, as browsers require.
 */

export class Sound {
  enabled = true;
  private ctx: AudioContext | null = null;
  private lastHit = 0;

  /** Call from a user gesture (click or key press) to allow audio. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        this.enabled = false;
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** A short tone with an exponential decay. */
  private tone(freq: number, start: number, duration: number, gain: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  /** A soft knock when the marble hits a wall, louder for harder hits. */
  hit(speed: number): void {
    const now = performance.now();
    if (speed < 0.35 || now - this.lastHit < 70) return;
    this.lastHit = now;
    const g = Math.min(0.25, 0.06 * speed);
    this.tone(90 + 30 * speed, 0, 0.12, g, 'triangle');
  }

  /** Twist mode on (rising) or off (falling). */
  twist(on: boolean): void {
    this.tone(on ? 520 : 390, 0, 0.09, 0.08, 'sine');
    this.tone(on ? 780 : 260, 0.05, 0.1, 0.06, 'sine');
  }

  /** A gate opening: a rising arpeggio. */
  gateOpen(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, i * 0.07, 0.5, 0.09));
  }

  /** A loop closing: two bell tones, falling for clockwise turns, rising for counter-clockwise. */
  loop(degrees: number): void {
    const up = degrees > 0;
    this.tone(up ? 440 : 660, 0, 0.7, 0.08, 'sine');
    this.tone(up ? 660 : 440, 0.12, 0.9, 0.08, 'sine');
  }

  /** Level complete. */
  complete(): void {
    [392, 523.25, 659.25, 783.99].forEach((f) => this.tone(f, 0, 1.4, 0.06));
    this.tone(1046.5, 0.25, 1.2, 0.05);
  }
}
