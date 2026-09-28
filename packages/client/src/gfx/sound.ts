/**
 * Beeper-style sound effects, after the original's: square waves and 1-bit noise, synthesised
 * into buffers once and played through a gentle low-pass, like a Spectrum through a TV speaker.
 * Browsers only allow audio after the player has interacted with the page, so `unlock()` is
 * called from the first click or key press.
 */

export type SoundName =
  'type' | 'fire' | 'launch' | 'hit' | 'miss' | 'sink' | 'plane' | 'drone' | 'horn';

type Synth = (sr: number) => Float32Array;

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

const fadeOut =
  (seconds: number, tail = 0.02) =>
  (t: number) =>
    Math.min(1, Math.max(0, (seconds - t) / tail));

/** Exported so the sounds can be rendered offline to check them. */
export const SYNTHS: Record<SoundName, Synth> = {
  // a teletype chatter: a few sharp clicks at irregular intervals
  type: (sr) => {
    const out = new Float32Array(Math.round(sr * 0.045));
    let s = 7;
    for (let at = 0; at < out.length - 40;) {
      for (let k = 0; k < 14; k++) out[at + k] = 1 - k / 14;
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      at += Math.round(sr * (0.002 + (((s >>> 16) % 100) / 100) * 0.006));
    }
    return out;
  },
  // three beeps as the salvo is fired
  fire: (sr) =>
    square(
      sr,
      1.14,
      () => 820,
      (t) => (t % 0.38 < 0.28 ? 0.8 : 0),
    ),
  // a shell leaving the gun: a quick falling chirp
  launch: (sr) =>
    square(
      sr,
      0.12,
      (t) => 1900 * Math.pow(1300 / 1900, t / 0.12),
      (t) => 0.55 * fadeOut(0.12)(t),
    ),
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
  // a ship going down: a long falling whistle
  sink: (sr) =>
    square(
      sr,
      1.3,
      (t) => 3000 * Math.pow(500 / 3000, t / 1.3),
      (t) => 0.5 * fadeOut(1.3, 0.2)(t),
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
  private readonly buffers = new Map<SoundName, AudioBuffer>();
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

  private buffer(name: SoundName): AudioBuffer | null {
    if (!this.ctx) return null;
    let b = this.buffers.get(name);
    if (!b) {
      const data = SYNTHS[name](this.ctx.sampleRate);
      b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(name, b);
    }
    return b;
  }

  /**
   * Plays a sound. With `seconds`, it loops for that long and fades out; returns a function that
   * stops it early.
   */
  play(name: SoundName, opts: { volume?: number; seconds?: number } = {}): () => void {
    const buffer = this.buffer(name);
    if (!this.ctx || !this.out || !buffer || this.muted || this.ctx.state !== 'running')
      return () => {};
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    src.connect(gain).connect(this.out);
    const now = this.ctx.currentTime;
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
