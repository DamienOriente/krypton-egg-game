import { applyShape, env, glide } from './core';
import type { Kit, NoiseKind, Shape } from './core';

/** Anything a node can feed: another node, or an AudioParam for FM / ring modulation. */
export type Dest = AudioNode | AudioParam;

export function link(src: AudioNode, dest: Dest): void {
  // Two separate overloads in the DOM typings; narrow so each call matches one.
  if ('setValueAtTime' in dest) src.connect(dest);
  else src.connect(dest);
}

export interface Lfo {
  osc: OscillatorNode;
  depth: GainNode;
}

/**
 * One triggered sound effect. Recipes build their node graph through this class
 * so every source is tracked: that is what makes voice stealing click-free and
 * lets the whole sub-graph be disconnected once the last source has ended.
 */
export class Voice {
  readonly kit: Kit;
  readonly ctx: BaseAudioContext;
  /** Start time of the sound on the context clock. */
  readonly t: number;
  /** Recipes connect into this; its gain is the voice level and is only touched by kill(). */
  readonly out: GainNode;
  readonly level: number;
  end: number;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly owned: AudioNode[] = [];
  private last: AudioScheduledSourceNode | null = null;
  private killed = false;
  private disposed = false;

  constructor(kit: Kit, t: number, level: number) {
    this.kit = kit;
    this.ctx = kit.ctx;
    this.t = t;
    this.end = t;
    this.level = level;
    this.out = kit.ctx.createGain();
    this.out.gain.value = level;
  }

  osc(shape: Shape, freq: number, dest: Dest, start: number, stop: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    applyShape(o, this.kit, shape);
    o.frequency.setValueAtTime(freq, start);
    link(o, dest);
    this.schedule(o, start, stop);
    return o;
  }

  noise(kind: NoiseKind, dest: Dest, start: number, stop: number, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    const buf = this.kit.noise[kind];
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    link(s, dest);
    // Random read offset: two consecutive hits never share the same noise grain.
    s.start(start, Math.random() * buf.duration * 0.9);
    s.stop(stop);
    this.track(s, stop);
    return s;
  }

  gain(dest: Dest, value = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    link(g, dest);
    return g;
  }

  filter(dest: AudioNode, type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  pan(dest: AudioNode, value: number): StereoPannerNode {
    const p = this.ctx.createStereoPanner();
    p.pan.value = value;
    p.connect(dest);
    return p;
  }

  shaper(dest: Dest, curve: Float32Array<ArrayBuffer>): WaveShaperNode {
    const s = this.ctx.createWaveShaper();
    s.curve = curve;
    s.oversample = '2x';
    link(s, dest);
    return s;
  }

  /** LFO added onto `target`; both nodes are returned so callers can automate rate and depth. */
  lfo(shape: Shape, rate: number, depth: number, target: AudioParam, start: number, stop: number): Lfo {
    const depthGain = this.ctx.createGain();
    depthGain.gain.value = depth;
    depthGain.connect(target);
    const o = this.ctx.createOscillator();
    applyShape(o, this.kit, shape);
    o.frequency.value = rate;
    o.connect(depthGain);
    this.schedule(o, start, stop);
    return { osc: o, depth: depthGain };
  }

  /** Fast fade then stop: used when the voice is stolen. */
  kill(now: number): void {
    if (this.killed) return;
    this.killed = true;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(this.level, now);
    g.linearRampToValueAtTime(0, now + 0.012);
    const stop = now + 0.02;
    for (const s of this.sources) {
      try {
        s.stop(stop);
      } catch (err) {
        // A source that never started cannot be stopped; nothing else to do for it.
        console.warn('[audio] could not stop stolen voice source', err);
      }
    }
    this.end = Math.min(this.end, stop);
  }

  /** Extra nodes (panner, sends) that must be detached with the voice. */
  own(node: AudioNode): void {
    this.owned.push(node);
  }

  /** Detaches the voice from the buses; idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.out.disconnect();
    for (const n of this.owned) n.disconnect();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Disposes once the longest-lived source has ended. */
  disposeWhenDone(): void {
    if (this.last) this.last.onended = () => this.dispose();
    else this.dispose();
  }

  private schedule(src: AudioScheduledSourceNode, start: number, stop: number): void {
    src.start(start);
    src.stop(stop);
    this.track(src, stop);
  }

  private track(src: AudioScheduledSourceNode, stop: number): void {
    this.sources.push(src);
    if (stop >= this.end) {
      this.end = stop;
      this.last = src;
    }
  }
}

// ---------------------------------------------------------------------------
// Recipe sugar. Times (`at`) are offsets from the voice start.

export interface ToneOpts {
  shape?: Shape;
  f: number;
  /** Glide target frequency. */
  to?: number;
  /** Glide duration (defaults to the whole envelope). */
  glide?: number;
  at?: number;
  peak: number;
  a?: number;
  hold?: number;
  d: number;
  dest?: AudioNode;
  detune?: number;
  pan?: number;
}

/** Oscillator through its own envelope. */
export function tone(v: Voice, o: ToneOpts): OscillatorNode {
  const t = v.t + (o.at ?? 0);
  let dest: AudioNode = o.dest ?? v.out;
  if (o.pan !== undefined) dest = v.pan(dest, o.pan);
  const g = v.gain(dest);
  const a = o.a ?? 0.001;
  const end = env(g.gain, t, o.peak, a, o.hold ?? 0, o.d);
  const osc = v.osc(o.shape ?? 'sine', o.f, g, t, end + 0.01);
  if (o.detune) osc.detune.value = o.detune;
  if (o.to !== undefined) glide(osc.frequency, t, o.f, o.to, o.glide ?? a + (o.hold ?? 0) + o.d);
  return osc;
}

export interface NoiseOpts {
  kind?: NoiseKind;
  at?: number;
  peak: number;
  a?: number;
  hold?: number;
  d: number;
  type?: BiquadFilterType;
  f: number;
  to?: number;
  glide?: number;
  q?: number;
  dest?: AudioNode;
  pan?: number;
  rate?: number;
}

/** Filtered noise burst; returns the filter so callers can add more automation. */
export function hiss(v: Voice, o: NoiseOpts): BiquadFilterNode {
  const t = v.t + (o.at ?? 0);
  let dest: AudioNode = o.dest ?? v.out;
  if (o.pan !== undefined) dest = v.pan(dest, o.pan);
  const g = v.gain(dest);
  const flt = v.filter(g, o.type ?? 'bandpass', o.f, o.q ?? 0.9);
  const a = o.a ?? 0.001;
  const end = env(g.gain, t, o.peak, a, o.hold ?? 0, o.d);
  v.noise(o.kind ?? 'white', flt, t, end + 0.01, o.rate ?? 1);
  if (o.to !== undefined) glide(flt.frequency, t, o.f, o.to, o.glide ?? a + (o.hold ?? 0) + o.d);
  return flt;
}
