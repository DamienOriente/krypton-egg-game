/**
 * Music instruments. Each note builds its own short-lived node graph; nothing is
 * tracked because songs are stopped by fading and detaching the song output.
 */
import { adsr, applyShape, glide, midiToHz, perc } from './core';
import type { Kit, Shape } from './core';

export interface LeadPreset {
  wave: Shape;
  level: number;
  cutoff: number;
  /** Spread of the detuned double, in cents (0 = single oscillator). */
  detune: number;
  /** Delayed vibrato depth, in cents. */
  vibrato: number;
  attack: number;
  release: number;
  /** Echo send amount. */
  echo: number;
}

export interface BassPreset {
  wave: Shape;
  level: number;
  cutoff: number;
  /** Filter envelope amount in Hz on top of cutoff. */
  env: number;
  q: number;
  /** Filter envelope decay, in seconds. */
  decay: number;
  /** Sine sub-octave level relative to the main oscillator. */
  sub: number;
}

export interface ArpPreset {
  wave: Shape;
  level: number;
  /** Arp sub-notes per 16th step: 2 = 1/32, 4 = 1/64 (classic ST/Amiga VBL speed). */
  rate: number;
  /** MIDI note the chord root is placed around. */
  center: number;
  cutoff: number;
  /** 0 = flat, 1 = each 16th re-plucks and decays: the chip "gated" feel. */
  gate: number;
  echo: number;
}

export interface PadPreset {
  level: number;
  cutoff: number;
  center: number;
  attack: number;
  release: number;
  /** Detune between the two saws of each chord tone, in cents. */
  spread: number;
}

export interface DrumPreset {
  level: number;
  kick: number;
  snare: number;
  hat: number;
  tom: number;
  crash: number;
}

/** A pitch change inside one legato note: `at` seconds after the note start. */
export interface PitchPoint {
  at: number;
  midi: number;
}

const GLIDE_TIME = 0.07;

function setPitches(p: AudioParam, t: number, pts: readonly PitchPoint[]): void {
  p.setValueAtTime(midiToHz(pts[0].midi), t);
  for (let i = 1; i < pts.length; i++) {
    glide(p, t + pts[i].at, midiToHz(pts[i - 1].midi), midiToHz(pts[i].midi), GLIDE_TIME);
  }
}

export function leadNote(
  kit: Kit,
  dest: AudioNode,
  p: LeadPreset,
  t: number,
  dur: number,
  pitches: readonly PitchPoint[],
  vel: number,
): void {
  const ctx = kit.ctx;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  amp.connect(dest);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.7;
  // A touch of filter envelope gives each note a soft "pluck" without brightening the mix.
  lp.frequency.setValueAtTime(p.cutoff * 1.7, t);
  lp.frequency.setTargetAtTime(p.cutoff, t, 0.06);
  lp.connect(amp);
  const stop = adsr(amp.gain, t, vel * p.level, p.attack, 0.3, 0.72, t + dur, p.release) + 0.02;

  // Delayed vibrato, like a player leaning into long notes; short notes stay straight.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.6;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.setValueAtTime(0, t + 0.18);
  depth.gain.linearRampToValueAtTime(p.vibrato, t + 0.5);
  lfo.connect(depth);
  lfo.start(t);
  lfo.stop(stop);

  const detunes = p.detune > 0 ? [-p.detune / 2, p.detune / 2] : [0];
  detunes.forEach((d, i) => {
    const o = ctx.createOscillator();
    applyShape(o, kit, p.wave);
    o.detune.value = d;
    setPitches(o.frequency, t, pitches);
    depth.connect(o.detune);
    const g = ctx.createGain();
    g.gain.value = i === 0 ? 0.62 : 0.42;
    o.connect(g);
    g.connect(lp);
    o.start(t);
    o.stop(stop);
  });
}

export function bassNote(
  kit: Kit,
  dest: AudioNode,
  p: BassPreset,
  t: number,
  dur: number,
  pitches: readonly PitchPoint[],
  vel: number,
): void {
  const ctx = kit.ctx;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  amp.connect(dest);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = p.q;
  lp.frequency.setValueAtTime(p.cutoff + p.env * vel, t);
  lp.frequency.setTargetAtTime(p.cutoff, t + 0.004, p.decay / 3);
  lp.connect(amp);
  const stop = adsr(amp.gain, t, vel * p.level, 0.004, 0.2, 0.75, t + dur, 0.06) + 0.02;
  const o = ctx.createOscillator();
  applyShape(o, kit, p.wave);
  setPitches(o.frequency, t, pitches);
  o.connect(lp);
  o.start(t);
  o.stop(stop);
  if (p.sub > 0) {
    // Sub goes around the filter: weight without mud from the resonance.
    const s = ctx.createOscillator();
    s.type = 'sine';
    setPitches(s.frequency, t, pitches.map((pt) => ({ at: pt.at, midi: pt.midi - 12 })));
    const g = ctx.createGain();
    g.gain.value = p.sub;
    s.connect(g);
    g.connect(amp);
    s.start(t);
    s.stop(stop);
  }
}

export function arpChord(
  kit: Kit,
  dest: AudioNode,
  p: ArpPreset,
  t: number,
  steps: number,
  stepDur: number,
  tones: readonly number[],
): void {
  if (tones.length === 0) return;
  const ctx = kit.ctx;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = p.cutoff;
  lp.Q.value = 0.6;
  amp.connect(lp);
  lp.connect(dest);
  const o = ctx.createOscillator();
  applyShape(o, kit, p.wave);
  // Tracker-style arp: one oscillator, frequency hard-stepped through the chord.
  const sub = stepDur / p.rate;
  const count = steps * p.rate;
  for (let i = 0; i < count; i++) {
    o.frequency.setValueAtTime(midiToHz(tones[i % tones.length]), t + i * sub);
  }
  const end = t + steps * stepDur;
  const low = 1 - p.gate * 0.6;
  for (let s = 0; s < steps; s++) {
    const ts = t + s * stepDur;
    amp.gain.setTargetAtTime(p.level, ts, 0.002);
    amp.gain.setTargetAtTime(p.level * low, ts + 0.008, stepDur * 0.45);
  }
  amp.gain.setTargetAtTime(0, end, 0.02);
  o.connect(amp);
  o.start(t);
  o.stop(end + 0.15);
}

export function padChord(
  kit: Kit,
  dest: AudioNode,
  p: PadPreset,
  t: number,
  dur: number,
  tones: readonly number[],
): void {
  if (tones.length === 0) return;
  const ctx = kit.ctx;
  const end = t + dur;
  const stop = end + p.release * 1.6;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(p.level, t + Math.min(p.attack, dur));
  amp.gain.setValueAtTime(p.level, Math.max(end, t + p.attack));
  amp.gain.setTargetAtTime(0, Math.max(end, t + p.attack), p.release / 4);
  amp.connect(dest);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.4;
  // Filter opens with the attack so chord changes "bloom" instead of switching.
  lp.frequency.setValueAtTime(p.cutoff * 0.55, t);
  lp.frequency.linearRampToValueAtTime(p.cutoff, t + Math.min(p.attack * 1.5, dur));
  lp.connect(amp);
  const perOsc = 1 / (tones.length * 1.6);
  for (const m of tones) {
    for (const side of [-1, 1]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiToHz(m);
      o.detune.value = (side * p.spread) / 2;
      const g = ctx.createGain();
      g.gain.value = perOsc;
      const pan = ctx.createStereoPanner();
      pan.pan.value = side * 0.45;
      o.connect(g);
      g.connect(pan);
      pan.connect(lp);
      o.start(t);
      o.stop(stop);
    }
  }
}

/** Drum voices; keeps the open-hat choke state of its song. */
export class DrumKit {
  private readonly kit: Kit;
  private readonly dest: AudioNode;
  private readonly p: DrumPreset;
  private openChoke: GainNode | null = null;
  private openEnd = 0;

  constructor(kit: Kit, dest: AudioNode, p: DrumPreset) {
    this.kit = kit;
    this.dest = dest;
    this.p = p;
  }

  kick(t: number, vel: number): void {
    const ctx = this.kit.ctx;
    const g = this.gain(this.dest);
    const end = perc(g.gain, t, vel * this.p.kick, 0.0015, 0.34);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(54, t + 0.055);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.3);
    o.connect(g);
    o.start(t);
    o.stop(end + 0.01);
    // Beater click so the kick reads on small speakers.
    const cg = this.gain(this.dest);
    const cend = perc(cg.gain, t, vel * this.p.kick * 0.22, 0.0005, 0.012);
    const c = ctx.createOscillator();
    c.type = 'triangle';
    glide(c.frequency, t, 2200, 600, 0.01);
    c.connect(cg);
    c.start(t);
    c.stop(cend + 0.01);
  }

  snare(t: number, vel: number): void {
    const ctx = this.kit.ctx;
    const bg = this.gain(this.dest);
    const bend = perc(bg.gain, t, vel * this.p.snare * 0.5, 0.001, 0.11);
    const body = ctx.createOscillator();
    body.type = 'triangle';
    glide(body.frequency, t, 220, 175, 0.04);
    body.connect(bg);
    body.start(t);
    body.stop(bend + 0.01);
    const ng = this.gain(this.dest);
    const nend = perc(ng.gain, t, vel * this.p.snare * 0.75, 0.001, 0.17);
    const lp = this.filter(ng, 'lowpass', 9000, 0.5);
    const hp = this.filter(lp, 'highpass', 1200, 0.7);
    this.noise(hp, t, nend + 0.01);
  }

  hat(t: number, vel: number, open: boolean): void {
    // Any new hat chokes a ringing open hat, like a real foot pedal.
    if (this.openChoke && t < this.openEnd) {
      this.openChoke.gain.setTargetAtTime(0, t, 0.008);
      this.openChoke = null;
    }
    // The choke is a separate gain so cutting it never fights the envelope automation.
    let out: AudioNode = this.dest;
    if (open) {
      const choke = this.gain(this.dest, 1);
      this.openChoke = choke;
      out = choke;
    }
    const g = this.gain(out);
    const end = perc(g.gain, t, vel * this.p.hat, 0.0005, open ? 0.3 : 0.045);
    if (open) this.openEnd = end;
    const lp = this.filter(g, 'lowpass', 12000, 0.5);
    const hp = this.filter(lp, 'highpass', 7000, 0.6);
    this.noise(hp, t, end + 0.01);
  }

  crash(t: number, vel: number): void {
    const g = this.gain(this.dest);
    const end = perc(g.gain, t, vel * this.p.crash, 0.002, 1.4);
    const hp = this.filter(g, 'highpass', 4200, 0.6);
    this.noise(hp, t, end + 0.01);
    const rg = this.gain(this.dest);
    const rend = perc(rg.gain, t, vel * this.p.crash * 0.3, 0.002, 0.7);
    this.noise(this.filter(rg, 'bandpass', 5200, 3), t, rend + 0.01);
  }

  tom(t: number, vel: number, f: number): void {
    const ctx = this.kit.ctx;
    const g = this.gain(this.dest);
    const end = perc(g.gain, t, vel * this.p.tom, 0.002, 0.32);
    const o = ctx.createOscillator();
    glide(o.frequency, t, f, f * 0.6, 0.2);
    o.connect(g);
    o.start(t);
    o.stop(end + 0.01);
    const ng = this.gain(this.dest);
    const nend = perc(ng.gain, t, vel * this.p.tom * 0.2, 0.001, 0.03);
    this.noise(this.filter(ng, 'lowpass', 1500, 0.7), t, nend + 0.01);
  }

  private gain(dest: AudioNode, value = 0): GainNode {
    const g = this.kit.ctx.createGain();
    g.gain.value = value;
    g.connect(dest);
    return g;
  }

  private filter(dest: AudioNode, type: BiquadFilterType, f: number, q: number): BiquadFilterNode {
    const n = this.kit.ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    n.connect(dest);
    return n;
  }

  private noise(dest: AudioNode, t: number, stop: number): void {
    const s = this.kit.ctx.createBufferSource();
    s.buffer = this.kit.noise.white;
    s.loop = true;
    s.connect(dest);
    s.start(t, Math.random() * 1.8);
    s.stop(stop);
  }
}
