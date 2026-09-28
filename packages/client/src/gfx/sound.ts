/**
 * Beeper-style sound effects, after the original's: square waves and 1-bit noise, synthesised
 * into buffers once and played through a gentle low-pass, like a Spectrum through a TV speaker.
 * Browsers only allow audio after the player has interacted with the page, so `unlock()` is
 * called from the first click or key press.
 */

export type SoundName =
  'type' | 'fire' | 'intro' | 'shot' | 'rush' | 'hit' | 'miss' | 'plane' | 'drone' | 'horn';

/** Makes a sound's samples; sounds that can be stretched take their `length` in seconds. */
type Synth = (sr: number, length?: number) => Float32Array;

const MUTED_KEY = 'bs.muted';
const VOLUME = 0.22;

/** A square wave whose frequency follows `freq(t)`, with the amplitude envelope `env(t)`. */
function square(
  sr: number,
  seconds: number,
  freq: (t: number) => number,
  env: (t: number) => number = () => 1,
) {
  const n = Math.round(sr * seconds);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    phase = (phase + freq(t) / sr) % 1;
    out[i] = (phase < 0.5 ? 1 : -1) * env(t);
  }
  return out;
}

/** 1-bit noise: a random level held for `hold(t)` seconds at a time. */
function noise(
  sr: number,
  seconds: number,
  hold: (t: number) => number,
  env: (t: number) => number,
  seed = 1,
) {
  const n = Math.round(sr * seconds);
  const out = new Float32Array(n);
  let s = seed >>> 0;
  let level = 1;
  let next = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (t >= next) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      level = s & 0x10000 ? 1 : -1;
      next = t + hold(t);
    }
    out[i] = level * env(t);
  }
  return out;
}

/** The firing beeps: each lasts this long, out of a cycle this long (ms). */
export const FIRE_BEEP_ON_MS = 300;
export const FIRE_BEEP_MS = 400;

/** Length of one burst of the teletype chatter, in ms. */
export const TYPE_UNIT_MS = 105;

/**
 * The beeper's crackle, as in the original's teletype: the speaker held high for most of a
 * burst, with very short clicks down, crowded at the start of the burst and thinning out; then
 * held low for `gap` seconds. `units` bursts of `unit` seconds each, AC-coupled like the
 * Spectrum's output.
 */
function crackle(sr: number, units: number, unit: number, gap: number, seed: number) {
  const n = Math.round(sr * unit * units);
  const raw = new Float32Array(n);
  let s = seed >>> 0;
  const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const clickLen = Math.max(2, Math.round(sr * 0.00012));
  for (let u = 0; u < units; u++) {
    const start = Math.round(u * unit * sr);
    const high = Math.round((unit - gap) * sr);
    const end = Math.round((u + 1) * unit * sr);
    for (let i = start; i < end; i++) raw[i] = i - start < high ? 0.5 : -0.5;
    for (let t = 0.0003; t < unit - gap - 0.0005;) {
      const at = start + Math.round(t * sr);
      for (let k = 0; k < clickLen; k++) raw[at + k] = -0.5;
      t += t < 0.01 ? 0.0003 + rand() * 0.0012 : 0.0008 + rand() * 0.004;
    }
  }
  // the output is AC-coupled: a held level sags back towards zero
  const out = new Float32Array(n);
  const a = 1 / (1 + (2 * Math.PI * 8) / sr);
  for (let i = 1; i < n; i++) out[i] = a * (out[i - 1]! + raw[i]! - raw[i - 1]!);
  return out;
}

const fadeOut =
  (seconds: number, tail = 0.02) =>
  (t: number) =>
    Math.min(1, Math.max(0, (seconds - t) / tail));

/** Exported so the sounds can be rendered offline to check them. */
export const SYNTHS: Record<SoundName, Synth> = {
  // the teletype chatter as text types out: one burst of the crackle per unit
  type: (sr) => crackle(sr, 1, TYPE_UNIT_MS / 1000, 0.01, 11),
  // three beeps as the salvo is fired
  fire: (sr) =>
    square(
      sr,
      (3 * FIRE_BEEP_MS) / 1000,
      () => 820,
      (t) => ((t * 1000) % FIRE_BEEP_MS < FIRE_BEEP_ON_MS ? 0.8 : 0),
    ),
  // a shell leaving the gun: a tone stepping down from 1900 to 1300 Hz in eight steps,
  // stretched to last until the next shell goes
  shot: (sr, length = 0.25) => {
    const steps = 8;
    const gap = 0.003;
    const step = length / steps - gap;
    return square(
      sr,
      steps * (step + gap),
      (t) =>
        1900 *
        Math.pow(1300 / 1900, Math.min(steps - 1, Math.floor(t / (step + gap))) / (steps - 1)),
      (t) => (t % (step + gap) < step ? 0.45 : 0),
    );
  },
  // the salvo scene opening: a buzz of clicks, 50 a second, each a short burst of square wave
  // whose pitch falls from 2800 to 700 Hz
  intro: (sr, length = 0.6) => {
    const seconds = length;
    const out = new Float32Array(Math.round(sr * seconds));
    for (let t = 0; t < seconds; t += 0.02) {
      const f = 2800 * Math.pow(700 / 2800, t / seconds);
      const start = Math.round(t * sr);
      const len = Math.round((3 / f) * sr);
      for (let i = 0; i < len && start + i < out.length; i++) {
        out[start + i] = ((i / sr) * f) % 1 < 0.5 ? 0.7 : 0;
      }
    }
    return out;
  },
  // the rushing under the whole salvo: the crackle in quick bursts (looped)
  rush: (sr) => crackle(sr, 10, 0.065, 0.025, 5),
  // a hit: noise falling in pitch as it dies away
  hit: (sr) =>
    noise(
      sr,
      0.9,
      (t) => 1 / (7000 * Math.pow(900 / 7000, t / 0.9)),
      (t) => Math.pow(1 - t / 0.9, 1.5),
      3,
    ),
  // a miss: a short hiss of spray
  miss: (sr) =>
    noise(
      sr,
      0.3,
      () => 1 / 12000,
      (t) => 0.4 * Math.pow(1 - t / 0.3, 2),
      5,
    ),
  // a plane's engine: a low, buzzing click train (looped while the plane is in view)
  plane: (sr) => {
    const out = new Float32Array(Math.round(sr * 0.5));
    const period = Math.round(sr / 34);
    for (let at = 0; at < out.length; at += period) for (let k = 0; k < 30; k++) out[at + k] = 0.35;
    return out;
  },
  // the winning fleet: two detuned square waves beating slowly against each other
  drone: (sr) => {
    const a = square(sr, 4.5, () => 110);
    const b = square(sr, 4.5, () => 110.45);
    const env = (t: number) => Math.min(1, t / 0.05) * fadeOut(4.5, 0.4)(t) * 0.45;
    return a.map((v, i) => ((v + b[i]!) / 2) * env(i / sr));
  },
  // a ship's horn
  horn: (sr) => {
    const f = (t: number) => 98 * (1 - 0.03 * t);
    const a = square(sr, 0.8, f);
    const b = square(sr, 0.8, (t) => f(t) * 1.006);
    const env = (t: number) => Math.min(1, t / 0.04) * fadeOut(0.8, 0.12)(t) * 0.5;
    return a.map((v, i) => ((v + b[i]!) / 2) * env(i / sr));
  },
};

class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  muted: boolean;

  constructor() {
    let muted = false;
    try {
      muted = localStorage.getItem(MUTED_KEY) === '1';
    } catch {
      // storage can be unavailable; sound stays on
    }
    this.muted = muted;
  }

  /** Starts audio; call from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const lowpass = this.ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 6000;
      this.out = this.ctx.createGain();
      this.out.gain.value = this.muted ? 0 : VOLUME;
      this.out.connect(lowpass).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.out) this.out.gain.value = this.muted ? 0 : VOLUME;
    try {
      localStorage.setItem(MUTED_KEY, this.muted ? '1' : '0');
    } catch {
      // not remembered, then
    }
    return this.muted;
  }

  private buffer(name: SoundName, length?: number): AudioBuffer | null {
    if (!this.ctx) return null;
    // stretched sounds are kept per length, to the nearest 10 ms
    const len = length === undefined ? undefined : Math.max(0.05, Math.round(length * 100) / 100);
    const key = len === undefined ? name : `${name} ${len}`;
    let b = this.buffers.get(key);
    if (!b) {
      const data = SYNTHS[name](this.ctx.sampleRate, len);
      b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(key, b);
    }
    return b;
  }

  /**
   * Plays a sound. With `seconds`, it loops for that long and fades out; with `length`, a
   * stretchable sound is made that long; `delay` (seconds) starts it that much later, on the
   * audio clock. Returns a function that stops it early.
   */
  play(
    name: SoundName,
    opts: { volume?: number; seconds?: number; length?: number; delay?: number } = {},
  ): () => void {
    const buffer = this.buffer(name, opts.length);
    if (!this.ctx || !this.out || !buffer || this.muted || this.ctx.state !== 'running')
      return () => {};
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    src.connect(gain).connect(this.out);
    const now = this.ctx.currentTime + Math.max(0, opts.delay ?? 0);
    if (opts.seconds !== undefined) {
      src.loop = true;
      gain.gain.setValueAtTime(opts.volume ?? 1, now + Math.max(0, opts.seconds - 0.3));
      gain.gain.linearRampToValueAtTime(0, now + opts.seconds);
      src.start(now);
      src.stop(now + opts.seconds);
    } else {
      src.start(now);
    }
    return () => {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    };
  }
}

export const sound = new Sound();
