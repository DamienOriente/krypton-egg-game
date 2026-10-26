/**
 * Shared DSP building blocks: generated noise, band-limited pulse tables,
 * shaper curves, the procedural room impulse response and envelope helpers.
 *
 * Everything takes a BaseAudioContext so the exact same code can render into an
 * OfflineAudioContext (loudness balancing, tests) and into the live context.
 */

export type Shape = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'pulse12' | 'pulse25';
/** `crackle` is sparse random clicks (fire, fuses, electric arcs), not a noise colour. */
export type NoiseKind = 'white' | 'pink' | 'brown' | 'crackle';

export interface Kit {
  readonly ctx: BaseAudioContext;
  readonly noise: Readonly<Record<NoiseKind, AudioBuffer>>;
  readonly pulse12: PeriodicWave;
  readonly pulse25: PeriodicWave;
  /** Gentle tanh saturation, used for punch on booms and growls. */
  readonly drive: Float32Array<ArrayBuffer>;
  /** Harder saturation for electric / monster textures. */
  readonly crunch: Float32Array<ArrayBuffer>;
}

/** Equal-RMS noise makes recipe levels comparable whatever the colour. */
const NOISE_RMS = 0.35;
const NOISE_SECONDS = 2;

export function createKit(ctx: BaseAudioContext): Kit {
  return {
    ctx,
    noise: {
      white: makeNoise(ctx, 'white'),
      pink: makeNoise(ctx, 'pink'),
      brown: makeNoise(ctx, 'brown'),
      crackle: makeCrackle(ctx),
    },
    pulse12: makePulse(ctx, 0.125),
    pulse25: makePulse(ctx, 0.25),
    drive: makeTanhCurve(2.2),
    crunch: makeTanhCurve(6),
  };
}

function makeNoise(ctx: BaseAudioContext, kind: Exclude<NoiseKind, 'crackle'>): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  // Extra tail is cross-faded into the head so looped playback (thruster) has no seam click.
  const fade = Math.floor(ctx.sampleRate * 0.05);
  const raw = new Float32Array(n + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') {
      raw[i] = w;
    } else if (kind === 'pink') {
      // Paul Kellet's refined pink filter: cheap and flat enough for SFX use.
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      // Leaky integrator: the leak keeps DC from wandering off.
      brown = (brown + 0.02 * w) / 1.02;
      raw[i] = brown;
    }
  }
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const out = buf.getChannelData(0);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += raw[i];
  mean /= n;
  for (let i = 0; i < n; i++) {
    const v = i < fade ? raw[i] * (i / fade) + raw[n + i] * (1 - i / fade) : raw[i];
    out[i] = v - mean;
  }
  let sq = 0;
  for (let i = 0; i < n; i++) sq += out[i] * out[i];
  const gain = NOISE_RMS / Math.sqrt(sq / n || 1);
  for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, out[i] * gain));
  return buf;
}

/**
 * Poisson-spaced micro-bursts with random amplitude. Uniform white noise is
 * bounded, so a dead-zone shaper can't make it sparse: we place the clicks directly.
 */
function makeCrackle(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * NOISE_SECONDS);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  const perSecond = 70;
  let i = 0;
  while (i < n) {
    i += Math.floor((-Math.log(1 - Math.random()) / perSecond) * sr) + 1;
    const amp = Math.pow(Math.random(), 1.8) * (Math.random() < 0.5 ? -1 : 1);
    const len = Math.floor(sr * (0.0004 + Math.random() * 0.0018));
    for (let k = 0; k < len && i + k < n; k++) {
      d[i + k] += amp * (Math.random() * 2 - 1) * Math.exp(-k / (len * 0.35));
    }
  }
  let peak = 0;
  for (let k = 0; k < n; k++) peak = Math.max(peak, Math.abs(d[k]));
  const g = 0.95 / (peak || 1);
  for (let k = 0; k < n; k++) d[k] *= g;
  return buf;
}

/** Fourier series of a pulse of given duty; a soft harmonic roll-off keeps it warm, not fizzy. */
function makePulse(ctx: BaseAudioContext, duty: number): PeriodicWave {
  const harmonics = 64;
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let k = 1; k <= harmonics; k++) {
    const rolloff = 1 / (1 + (k / 28) * (k / 28));
    real[k] = (Math.sin(2 * Math.PI * k * duty) / (Math.PI * k)) * rolloff;
    imag[k] = ((1 - Math.cos(2 * Math.PI * k * duty)) / (Math.PI * k)) * rolloff;
  }
  return ctx.createPeriodicWave(real, imag);
}

function makeTanhCurve(k: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

/**
 * Safety clipper for the very end of the chain. It expects a 0.5 pre-gain so the
 * curve covers ±2 of real amplitude: linear up to 0.8, then a tanh knee that can
 * never exceed 0.99, whatever reaches it.
 */
export function makeClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(n);
  const knee = 0.8;
  const room = 0.99 - knee;
  for (let i = 0; i < n; i++) {
    const u = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(u);
    const y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room);
    curve[i] = Math.sign(u) * y;
  }
  return curve;
}

/**
 * "Small metallic room": dense early reflections off hard walls, a short dark
 * diffuse tail and a faint inharmonic plate ring so everything sounds like it
 * lives inside the same metal arena.
 */
export function makeRoomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const seconds = 0.85;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  const taps = [0.0071, 0.0113, 0.0168, 0.0229, 0.0307, 0.0411, 0.0533, 0.0662];
  const ring = [1173, 1741, 2417, 3329, 4561];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const skew = ch === 0 ? 0 : 0.0013;
    taps.forEach((tap, i) => {
      const idx = Math.floor((tap + skew * (i % 3)) * sr);
      if (idx < n) d[idx] += (i % 2 === 0 ? 1 : -1) * 0.55 * Math.pow(0.82, i);
    });
    const phases = ring.map(() => Math.random() * Math.PI * 2);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if (t < 0.012) continue;
      const onset = Math.min(1, (t - 0.012) / 0.02);
      const decay = Math.exp(-t / 0.13);
      // Coefficient falls over time: high frequencies die first, like a real room.
      const a = 0.85 * Math.exp(-t / 0.25) + 0.1;
      lp += a * ((Math.random() * 2 - 1) - lp);
      let metal = 0;
      for (let k = 0; k < ring.length; k++) metal += Math.sin(2 * Math.PI * ring[k] * t + phases[k]);
      d[i] += onset * decay * (lp * 0.9 + metal * 0.018 * Math.exp(-t / 0.09));
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Envelopes. All return the time at which the envelope reaches silence.

/** Attack → optional hold → exponential decay to -60 dB. `peak` must be > 0. */
export function env(p: AudioParam, t: number, peak: number, attack: number, hold: number, decay: number): number {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  if (hold > 0) p.setValueAtTime(peak, t + attack + hold);
  const end = t + attack + hold + decay;
  p.exponentialRampToValueAtTime(peak * 0.001, end);
  p.setValueAtTime(0, end + 0.001);
  return end;
}

export function perc(p: AudioParam, t: number, peak: number, attack: number, decay: number): number {
  return env(p, t, peak, attack, 0, decay);
}

/**
 * ADSR driven by setTargetAtTime chains: robust when notes are shorter than the
 * attack/decay (no out-of-order ramp events). Returns the time the voice can stop.
 */
export function adsr(
  p: AudioParam,
  t: number,
  peak: number,
  attack: number,
  decay: number,
  sustain: number,
  noteEnd: number,
  release: number,
): number {
  const end = Math.max(noteEnd, t + attack);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.setTargetAtTime(peak * sustain, t + attack, decay / 3);
  p.setTargetAtTime(0, end, release / 4);
  return end + release * 1.5;
}

/** Exponential frequency glide (targets must stay > 0). */
export function glide(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(from, t);
  p.exponentialRampToValueAtTime(to, t + Math.max(0.001, dur));
}

export function applyShape(o: OscillatorNode, kit: Kit, shape: Shape): void {
  if (shape === 'pulse12') o.setPeriodicWave(kit.pulse12);
  else if (shape === 'pulse25') o.setPeriodicWave(kit.pulse25);
  else o.type = shape;
}

// ---------------------------------------------------------------------------
// Pitch helpers.

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

const PITCH_CLASS: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "A4" → 69, "C#5" → 73, "Bb2" → 46. Returns null on malformed input. */
export function noteToMidi(name: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name);
  if (!m) return null;
  const pc = PITCH_CLASS[m[1].toUpperCase()];
  if (pc === undefined) return null;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + pc + acc;
}

export function pitchClass(name: string): number | null {
  const m = /^([A-G])([#b]?)$/.exec(name);
  if (!m) return null;
  const pc = PITCH_CLASS[m[1]];
  if (pc === undefined) return null;
  return (pc + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}
