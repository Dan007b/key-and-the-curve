/**
 * Background music, synthesized live with Web Audio (no files).
 *
 * Each layer of the fourth dimension has its own chord, so phasing changes
 * the harmony: red A minor, gold F, green C, blue G, violet E minor, voiced
 * so the pad glides between them by small steps. Over the pad an arpeggio
 * plays the chord tones, and a bass marks the bar. As a hunter in your layer
 * closes in (Game.danger), the music builds: a pulsing bass, then hi-hats,
 * then a kick, and the arpeggio doubles its speed. Paused, only the pad plays.
 *
 * Scheduling uses the usual look-ahead pattern: a 25 ms timer queues the
 * notes of the next ~120 ms on the audio clock, so timing never depends on
 * the frame rate.
 */

/** Pad voicing per layer (MIDI notes), chosen for smooth voice leading. */
const PAD: number[][] = [
  [57, 60, 64], // red: A minor
  [53, 57, 60], // gold: F major
  [55, 60, 64], // green: C major
  [55, 59, 62], // blue: G major
  [55, 59, 64], // violet: E minor
];
/** Bass root per layer (MIDI). */
const BASS = [45, 41, 48, 43, 40];

const BPM = 96;
/** One sixteenth note, s. */
const STEP = 60 / BPM / 4;
const LOOKAHEAD = 0.12;
const TIMER_MS = 25;

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export interface Mood {
  /** Your layer, 0..4: picks the chord. */
  layer: number;
  /** 0..1: how close a hunter in your layer is. */
  danger: number;
  /** False while a card is up: only the pad plays, quieter. */
  active: boolean;
}

export class Music {
  private ctx: AudioContext | null = null;
  private enabled = false;
  private volume = 0.5;
  private mood: Mood = { layer: 0, danger: 0, active: false };

  private master: GainNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private padOscs: OscillatorNode[] = [];
  private echo: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer = 0;
  private nextTime = 0;
  private step = 0;

  /** Hands the music the (unlocked) audio context; starts playing if enabled. */
  attach(ctx: AudioContext | null): void {
    if (!ctx || this.ctx === ctx) return;
    this.ctx = ctx;
    if (this.enabled) this.start();
  }

  /** Turns the music on or off and sets its volume (0..1). */
  configure(enabled: boolean, volume: number): void {
    this.volume = volume;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.targetGain(), this.ctx.currentTime, 0.1);
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) this.start();
    else this.stop();
  }

  setMood(mood: Mood): void {
    const chordChanged = mood.layer !== this.mood.layer;
    const activeChanged = mood.active !== this.mood.active;
    this.mood = mood;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    if (chordChanged) {
      // Glide the pad to the new layer's chord.
      PAD[mood.layer].forEach((note, i) => {
        for (const k of [0, 1]) this.padOscs[i * 2 + k]?.frequency.setTargetAtTime(freq(note), now, 0.06);
      });
    }
    this.padFilter?.frequency.setTargetAtTime(600 + 900 * mood.danger, now, 0.2);
    if (activeChanged) this.master.gain.setTargetAtTime(this.targetGain(), now, 0.3);
  }

  private targetGain(): number {
    return 0.16 * this.volume * (this.mood.active ? 1 : 0.55);
  }

  private start(): void {
    const ctx = this.ctx;
    if (!ctx || this.master) return;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.setTargetAtTime(this.targetGain(), ctx.currentTime, 0.5);
    master.connect(ctx.destination);
    this.master = master;

    // Pad: two slightly detuned saws per chord note, through a soft low-pass.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.7;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.22;
    filter.connect(padGain).connect(master);
    this.padFilter = filter;
    this.padOscs = [];
    for (const note of PAD[this.mood.layer]) {
      for (const detune of [-7, 7]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq(note);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start();
        this.padOscs.push(osc);
      }
    }

    // A dotted-eighth echo for the arpeggio.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const echo = ctx.createGain();
    echo.gain.value = 0.3;
    echo.connect(delay).connect(feedback).connect(delay);
    delay.connect(master);
    this.echo = echo;

    // One second of white noise for the hi-hats.
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;

    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), TIMER_MS);
  }

  private stop(): void {
    window.clearInterval(this.timer);
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    const oscs = this.padOscs;
    window.setTimeout(() => {
      for (const o of oscs) o.stop();
      master.disconnect();
    }, 600);
    this.master = null;
    this.padFilter = null;
    this.padOscs = [];
    this.echo = null;
  }

  /** Queues every sixteenth that starts within the look-ahead window. */
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    // After a stall (hidden tab), skip ahead rather than playing a burst.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % 32;
    }
  }

  /** The notes of one sixteenth (s = 0..31, two bars). */
  private playStep(s: number, t: number): void {
    const { layer, danger, active } = this.mood;
    const chord = PAD[layer];
    const beat = s % 4 === 0;
    // Bass: the root on beat one of each bar, pulsing eighths once a hunter is near.
    if (s % 16 === 0 || (danger > 0.15 && s % 2 === 0)) {
      this.note(freq(BASS[layer]), t, s % 16 === 0 ? 0.6 : 0.18, s % 16 === 0 ? 0.32 : 0.18, 'triangle');
    }
    if (!active) return;
    // Arpeggio: chord tones an octave up, eighths (sixteenths in danger).
    if (s % 2 === 0 || danger > 0.6) {
      const tones = [...chord.map((n) => n + 12), chord[0] + 24];
      const order = [0, 1, 2, 3, 2, 1, 0, 2];
      const note = tones[order[(danger > 0.6 ? s : s / 2) % order.length]];
      this.note(freq(note), t, 0.28, 0.09, 'triangle', true);
    }
    if (danger > 0.35 && s % 4 === 2) this.hat(t);
    if (danger > 0.6 && beat) this.kick(t);
  }

  private note(f: number, t: number, length: number, gain: number, type: OscillatorType, echo = false): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(amp).connect(this.master!);
    if (echo && this.echo) amp.connect(this.echo);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  private hat(t: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.12, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(hp).connect(amp).connect(this.master!);
    src.start(t, Math.random() * 0.9, 0.06);
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    amp.gain.setValueAtTime(0.5, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(amp).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.3);
  }
}
