/**
 * Sound-effect recipes. One palette: warm glass/plastic pings for bricks, wood for
 * the frame, damped metal for armour, soft chip blips for pickups/UI, saturated
 * noise for blasts. Short tails everywhere; space comes from the shared room send.
 */
import type { SfxName } from './audio';
import { clamp, glide, midiToHz, perc, rand } from './core';
import type { Kit, Shape } from './core';
import { Voice, hiss, tone } from './voice';

/** Reference pitch of the brick ping (pitch offset 0). E sits well in every track key. */
const E5 = 659.26;
const semi = (s: number): number => Math.pow(2, s / 12);

/** `r` = pitch ratio (from SfxOptions.pitch + per-name jitter), `pitch` = raw option. */
type Recipe = (v: Voice, r: number, pitch: number) => void;

// ---------------------------------------------------------------------------
// Building blocks shared by several recipes: they are what keeps the palette coherent.

function glassPing(v: Voice, f: number, at: number, peak: number, pan = 0, bright = 1): void {
  const t = v.t + at;
  const dest = pan === 0 ? v.out : v.pan(v.out, pan);
  const amp = v.gain(dest);
  const end = perc(amp.gain, t, peak, 0.0015, 0.42);
  const car = v.osc('sine', f, amp, t, end + 0.01);
  // Decaying FM index: a bright glassy strike that melts into a pure, pitch-clear tone.
  const index = v.gain(car.frequency);
  index.gain.setValueAtTime(f * 1.3 * bright, t);
  index.gain.exponentialRampToValueAtTime(f * 0.001, t + 0.08);
  v.osc('sine', f * 2, index, t, t + 0.09);
  // Free-bar partial ratios read as "glass" rather than "bell".
  tone(v, { f: f * 2.756, at, peak: peak * 0.24 * bright, d: 0.12, dest });
  if (f * 5.404 < 14000) tone(v, { f: f * 5.404, at, peak: peak * 0.07 * bright, a: 0.0005, d: 0.04, dest });
  hiss(v, { at, peak: peak * 0.14, a: 0.0003, d: 0.006, type: 'highpass', f: 5000, q: 0.7, dest });
}

function clank(v: Voice, f: number, at: number, peak: number, decay: number, dest: AudioNode = v.out): void {
  const t = v.t + at;
  // Low-passed so the armour sounds dense and damped, never like a fork on a plate.
  const lp = v.filter(dest, 'lowpass', 7000, 0.7);
  const bp = v.filter(lp, 'bandpass', Math.min(f * 4.6, 6000), 1.1);
  const amp = v.gain(bp);
  const end = perc(amp.gain, t, peak * 0.6, 0.0008, decay);
  // Ring-modulated squares at a non-integer ratio: dense inharmonic "metal" spectrum.
  const ring = v.gain(amp, 0);
  v.osc('square', f, ring, t, end + 0.01);
  v.osc('square', f * 1.483, ring.gain, t, end + 0.01);
  tone(v, { f, at, peak: peak * 0.4, d: decay * 1.4, dest: lp });
  tone(v, { f: f * 2.32, at, peak: peak * 0.28, d: decay * 0.8, dest: lp });
  tone(v, { f: f * 4.25, at, peak: peak * 0.14, d: decay * 0.45, dest: lp });
  hiss(v, { at, peak: peak * 0.35, a: 0.0003, d: 0.01, type: 'highpass', f: 3000, dest: lp });
}

function boom(v: Voice, at: number, size: number, r: number, pan = 0): void {
  const dest = pan === 0 ? v.out : v.pan(v.out, pan);
  // Saturation glues sub, body and rumble into one punchy blob instead of three layers.
  const pre = v.gain(v.shaper(dest, v.kit.drive), 0.5);
  tone(v, { f: 125 * r, to: 38 * r, glide: 0.3 * size, at, peak: 0.9, a: 0.002, d: 0.45 * size, dest: pre });
  hiss(v, { at, peak: 0.8, a: 0.002, d: 0.5 * size, type: 'lowpass', f: 4200 * r, to: 240 * r, glide: 0.45 * size, q: 0.8, dest: pre });
  hiss(v, { at, kind: 'brown', peak: 0.7, a: 0.008, d: 0.6 * size, type: 'lowpass', f: 420 * r, q: 0.9, dest: pre });
}

interface ChipOpts {
  pan?: number;
  shape?: Shape;
  /** Delayed vibrato depth in cents. */
  vib?: number;
  dest?: AudioNode;
  /** Low-pass cutoff as a multiple of the note frequency. */
  bright?: number;
}

/** Pulse + sine double: the "chip" voice shared by pickups, UI and the music lead. */
function chip(v: Voice, f: number, at: number, len: number, peak: number, o: ChipOpts = {}): OscillatorNode[] {
  const t = v.t + at;
  let dest: AudioNode = o.dest ?? v.out;
  if (o.pan !== undefined) dest = v.pan(dest, o.pan);
  const lp = v.filter(dest, 'lowpass', Math.min(f * (o.bright ?? 5), 9000), 0.6);
  const oscs = [
    tone(v, { shape: o.shape ?? 'pulse25', f, at, peak: peak * 0.55, a: 0.003, hold: len, d: 0.09, dest: lp }),
    tone(v, { f, at, peak: peak * 0.5, a: 0.003, hold: len, d: 0.14, dest: lp, detune: 5 }),
  ];
  if (o.vib) {
    for (const osc of oscs) {
      const l = v.lfo('sine', 6, 0, osc.detune, t, t + len + 0.25);
      l.depth.gain.setValueAtTime(0, t + 0.06);
      l.depth.gain.linearRampToValueAtTime(o.vib, t + Math.max(0.12, Math.min(0.2, len)));
    }
  }
  return oscs;
}

function crackle(v: Voice, at: number, hold: number, peak: number, f: number, dest: AudioNode = v.out, rate = 1): void {
  hiss(v, { kind: 'crackle', at, peak, a: 0.01, hold, d: 0.08, type: 'bandpass', f, q: 0.7, dest, rate });
}

/** 4-stage swept allpass against the dry path; returns the input to feed. */
function phaser(v: Voice, dest: AudioNode, from: number, top: number, back: number, dur: number): AudioNode {
  const t = v.t;
  const wet = v.gain(dest, 0.7);
  let next: AudioNode = wet;
  for (const k of [1, 1.6, 2.7, 4.1]) {
    const ap = v.filter(next, 'allpass', from * k, 0.8);
    ap.frequency.setValueAtTime(from * k, t);
    ap.frequency.exponentialRampToValueAtTime(top * k, t + dur * 0.5);
    ap.frequency.exponentialRampToValueAtTime(back * k, t + dur);
    next = ap;
  }
  const input = v.gain(dest, 0.7);
  input.connect(next);
  return input;
}

function ringTone(v: Voice, f1: number, f2: number, at: number, peak: number, d: number, dest: AudioNode = v.out): void {
  const t = v.t + at;
  const amp = v.gain(dest);
  const end = perc(amp.gain, t, peak, 0.001, d);
  const ring = v.gain(amp, 0);
  v.osc('sine', f1, ring, t, end + 0.01);
  v.osc('sine', f2, ring.gain, t, end + 0.01);
}

function lowpass(v: Voice, f: number, q = 0.7, dest: AudioNode = v.out): BiquadFilterNode {
  return v.filter(dest, 'lowpass', f, q);
}

// ---------------------------------------------------------------------------

const RECIPES: Record<SfxName, Recipe> = {
  paddle: (v, r) => {
    const lp = lowpass(v, 2400 * r, 0.8);
    const body = tone(v, { shape: 'triangle', f: 310 * r, peak: 0.85, a: 0.002, d: 0.17, dest: lp });
    // Rubber: fast drop then a small spring back up gives the "boing" without going cartoon.
    body.frequency.exponentialRampToValueAtTime(158 * r, v.t + 0.045);
    body.frequency.linearRampToValueAtTime(182 * r, v.t + 0.14);
    tone(v, { f: 620 * r, to: 320 * r, glide: 0.05, peak: 0.25, d: 0.06, dest: lp });
    // Chrome glint of the capsule hull.
    tone(v, { f: 3150 * r, peak: 0.05, a: 0.0005, d: 0.03 });
    hiss(v, { peak: 0.22, a: 0.0005, d: 0.012, type: 'bandpass', f: 1700 * r, q: 1.1 });
  },

  wall: (v, r) => {
    // Two damped modes + body: a wood block, kept very short because it fires constantly.
    tone(v, { f: 480 * r, to: 440 * r, glide: 0.03, peak: 0.75, a: 0.0008, d: 0.07 });
    tone(v, { f: 1310 * r, peak: 0.3, a: 0.0005, d: 0.035 });
    tone(v, { f: 2350 * r, peak: 0.08, a: 0.0005, d: 0.018 });
    tone(v, { f: 185 * r, to: 150 * r, glide: 0.05, peak: 0.45, d: 0.05 });
    hiss(v, { peak: 0.35, a: 0.0003, d: 0.008, type: 'bandpass', f: 2600 * r, q: 1.4 });
  },

  brick: (v, r, pitch) => {
    // High combo notes get duller and slightly quieter so a 24-step run never pierces.
    const bright = clamp(1 - pitch / 36, 0.4, 1);
    glassPing(v, E5 * r, 0, 0.8 * clamp(1 - pitch / 70, 0.65, 1.1), 0, bright);
  },

  brickHit: (v, r) => clank(v, 520 * r, 0, 0.8, 0.17),

  brickMetalBreak: (v, r) => {
    clank(v, 470 * r, 0, 0.85, 0.24);
    tone(v, { f: 190 * r, to: 95 * r, peak: 0.5, d: 0.12 });
    hiss(v, { peak: 0.28, a: 0.001, d: 0.3, type: 'highpass', f: 3800 * r, q: 0.6 });
    for (let i = 0; i < 9; i++) {
      const at = 0.012 + Math.pow(i / 9, 1.3) * 0.26 + rand(0, 0.015);
      tone(v, { f: rand(1900, 5200) * r, at, peak: 0.13 * (1 - i / 12), a: 0.0005, d: rand(0.04, 0.09), pan: rand(-0.7, 0.7) });
    }
  },

  brickGold: (v, r) => {
    const f = 196 * r;
    const lp = lowpass(v, 1700 * r, 0.6);
    const amp = v.gain(lp);
    const end = perc(amp.gain, v.t, 0.8, 0.001, 0.75);
    const car = v.osc('sine', f, amp, v.t, end + 0.01);
    // Inharmonic FM (√2 ratio) through a low-pass: heavy, dull, unmistakably "won't break".
    const index = v.gain(car.frequency);
    index.gain.setValueAtTime(f * 2.2, v.t);
    index.gain.exponentialRampToValueAtTime(f * 0.08, v.t + 0.3);
    v.osc('sine', f * 1.41, index, v.t, end + 0.01);
    tone(v, { f: f * 2.76, peak: 0.22, d: 0.28, dest: lp });
    tone(v, { f: 105 * r, to: 68 * r, peak: 0.6, d: 0.1 });
    hiss(v, { kind: 'pink', peak: 0.3, a: 0.0005, d: 0.025, type: 'lowpass', f: 1400, q: 0.7 });
  },

  brickRegen: (v, r) => {
    [0, 4, 7, 11, 12, 16, 19, 24].forEach((s, i) => {
      tone(v, { shape: 'triangle', f: E5 * r * semi(s), at: i * 0.032, peak: 0.22, a: 0.004, d: 0.16, pan: i % 2 ? 0.35 : -0.35 });
    });
    hiss(v, { peak: 0.12, a: 0.22, d: 0.18, type: 'highpass', f: 2200, to: 9000, glide: 0.4, q: 0.8 });
  },

  explosion: (v, r) => {
    boom(v, 0, 1, r);
    hiss(v, { peak: 0.4, a: 0.0005, d: 0.03, type: 'highpass', f: 1600, q: 0.7 });
  },

  bigExplosion: (v, r) => {
    const pre = v.gain(v.shaper(v.out, v.kit.drive), 0.5);
    tone(v, { f: 95 * r, to: 27 * r, glide: 0.9, peak: 0.95, a: 0.003, d: 1.5, dest: pre });
    hiss(v, { peak: 0.85, a: 0.003, d: 1.3, type: 'lowpass', f: 6000 * r, to: 180 * r, glide: 1.2, q: 0.7, dest: pre });
    // Two slow LFOs on the rumble make it roll instead of hiss.
    const flutter = v.gain(pre, 1);
    v.lfo('sine', 6.3, 0.35, flutter.gain, v.t, v.t + 2.6);
    v.lfo('sine', 2.7, 0.2, flutter.gain, v.t, v.t + 2.6);
    hiss(v, { kind: 'brown', peak: 0.85, a: 0.04, d: 2.4, type: 'lowpass', f: 320 * r, q: 1, dest: flutter });
    for (let i = 0; i < 7; i++) {
      const at = 0.15 + i * 0.19 + rand(0, 0.08);
      hiss(v, {
        at,
        peak: rand(0.2, 0.35) * (1 - i / 10),
        a: 0.002,
        d: rand(0.12, 0.22),
        type: 'lowpass',
        f: rand(1300, 2800) * r,
        q: 0.8,
        pan: rand(-0.6, 0.6),
        dest: pre,
      });
    }
    hiss(v, { peak: 0.5, a: 0.0005, d: 0.05, type: 'highpass', f: 1200, q: 0.7 });
  },

  laser: (v, r) => {
    // Twin beams: two detuned zaps 4 ms apart, panned apart; reads as width, not as two events.
    const f = 1650 * r;
    for (const side of [-1, 1]) {
      const at = side > 0 ? 0.004 : 0;
      const lp = lowpass(v, 3800, 0.6, v.pan(v.out, side * 0.28));
      const f0 = f * (side > 0 ? 1.006 : 1);
      tone(v, { shape: 'pulse25', f: f0, to: f0 * 0.3, glide: 0.09, at, peak: 0.32, d: 0.1, dest: lp });
      tone(v, { f: f0 * 0.5, to: f0 * 0.16, glide: 0.1, at, peak: 0.28, d: 0.1, dest: lp });
    }
  },

  launch: (v, r) => {
    tone(v, { shape: 'triangle', f: 230 * r, to: 140 * r, glide: 0.06, peak: 0.5, d: 0.08 });
    tone(v, { shape: 'triangle', f: 330 * r, to: 990 * r, glide: 0.14, a: 0.006, peak: 0.42, d: 0.2 });
    hiss(v, { peak: 0.2, a: 0.02, d: 0.15, type: 'bandpass', f: 800 * r, to: 3500 * r, glide: 0.15, q: 1.4 });
  },

  glue: (v, r) => {
    const lp = lowpass(v, 1500 * r, 6);
    glide(lp.frequency, v.t, 1500 * r, 210 * r, 0.13);
    tone(v, { shape: 'sawtooth', f: 260 * r, to: 120 * r, glide: 0.12, peak: 0.42, a: 0.002, d: 0.16, dest: lp });
    tone(v, { f: 520 * r, to: 170 * r, glide: 0.05, peak: 0.4, d: 0.07 });
    hiss(v, { kind: 'pink', peak: 0.18, d: 0.05, type: 'lowpass', f: 1100, q: 0.7 });
  },

  powerupDrop: (v, r) => {
    tone(v, { f: 520 * r, to: 880 * r, glide: 0.06, peak: 0.4, a: 0.002, d: 0.12 });
    tone(v, { shape: 'triangle', f: 1040 * r, to: 1760 * r, glide: 0.06, peak: 0.08, a: 0.002, d: 0.08 });
  },

  powerupGood: (v, r) => {
    [0, 4, 7, 12, 16].forEach((s, i) => chip(v, E5 * r * semi(s), i * 0.045, i === 4 ? 0.16 : 0.04, 0.42));
  },

  powerupBad: (v, r) => {
    const lp = lowpass(v, 1900, 0.8);
    glide(lp.frequency, v.t, 1900, 500, 0.45);
    // Minor second + tritone below, all sliding down together: sour on purpose, but soft.
    const layers: ReadonlyArray<readonly [number, number]> = [[1, 0.35], [1.06, 0.3], [0.707, 0.25]];
    for (const [ratio, pk] of layers) {
      const o = tone(v, { shape: 'sawtooth', f: 620 * r * ratio, to: 175 * r * ratio, glide: 0.45, peak: pk, a: 0.005, d: 0.48, dest: lp });
      v.lfo('sine', 7, 35, o.detune, v.t, v.t + 0.5);
    }
  },

  extraLife: (v, r) => {
    [7, 12, 16, 19].forEach((s, i) => chip(v, E5 * r * semi(s), i * 0.065, 0.045, 0.42));
    chip(v, E5 * r * semi(24), 0.26, 0.3, 0.42, { vib: 18 });
    chip(v, E5 * r * semi(19), 0.26, 0.3, 0.2, { shape: 'pulse12' });
  },

  expand: (v, r) => {
    const lp = lowpass(v, 400, 4);
    glide(lp.frequency, v.t, 400, 3200, 0.28);
    tone(v, { shape: 'sawtooth', f: 175 * r, to: 350 * r, glide: 0.26, peak: 0.35, a: 0.03, d: 0.33, dest: lp });
    tone(v, { shape: 'sawtooth', f: 175 * r, to: 350 * r, glide: 0.26, peak: 0.3, a: 0.03, d: 0.33, dest: lp, detune: 14 });
    tone(v, { f: 87.5 * r, to: 175 * r, glide: 0.26, peak: 0.3, a: 0.03, d: 0.3 });
  },

  shrink: (v, r) => {
    const lp = lowpass(v, 3200, 4);
    glide(lp.frequency, v.t, 3200, 380, 0.28);
    tone(v, { shape: 'sawtooth', f: 350 * r, to: 170 * r, glide: 0.26, peak: 0.35, a: 0.01, d: 0.33, dest: lp });
    tone(v, { shape: 'sawtooth', f: 350 * r, to: 170 * r, glide: 0.26, peak: 0.3, a: 0.01, d: 0.33, dest: lp, detune: -14 });
    tone(v, { f: 175 * r, to: 87.5 * r, glide: 0.26, peak: 0.3, a: 0.01, d: 0.3 });
  },

  multiball: (v, r) => {
    // Three brick pings spreading L / C / R: the ball literally splits in the stereo field.
    const parts: ReadonlyArray<readonly [number, number]> = [[7, -0.6], [12, 0], [16, 0.6]];
    parts.forEach(([s, pan], i) => glassPing(v, E5 * r * semi(s), i * 0.045, 0.5, pan, 0.8));
  },

  shield: (v, r) => {
    const t = v.t;
    const lp = lowpass(v, 200, 3);
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + 0.3);
    lp.frequency.exponentialRampToValueAtTime(900, t + 0.65);
    const trem = v.gain(lp, 1);
    v.lfo('sine', 14, 0.35, trem.gain, t, t + 0.75);
    const layers: ReadonlyArray<readonly [number, number]> = [[110, 0.3], [110.6, 0.25], [220, 0.2], [330, 0.1]];
    for (const [f, pk] of layers) tone(v, { shape: 'sawtooth', f: f * r, peak: pk, a: 0.08, hold: 0.25, d: 0.35, dest: trem });
    tone(v, { f: 1320 * r, peak: 0.08, a: 0.1, hold: 0.15, d: 0.3, dest: trem });
  },

  freeze: (v, r) => {
    for (let i = 0; i < 10; i++) {
      tone(v, { f: rand(2800, 6200) * r, at: i * 0.035 + rand(0, 0.02), peak: 0.12, a: 0.0005, d: rand(0.06, 0.14), pan: rand(-0.7, 0.7) });
    }
    tone(v, { shape: 'triangle', f: 2600 * r, to: 1300 * r, glide: 0.35, peak: 0.2, a: 0.004, d: 0.38 });
    hiss(v, { peak: 0.14, a: 0.05, d: 0.3, type: 'highpass', f: 6000, q: 0.7 });
  },

  darkness: (v, r) => {
    const lp = lowpass(v, 1200, 2);
    glide(lp.frequency, v.t, 1200, 170, 0.7);
    const layers: ReadonlyArray<readonly [number, number]> = [[55, 0.35], [55.7, 0.3], [82.4, 0.2]];
    for (const [f, pk] of layers) tone(v, { shape: 'sawtooth', f: f * r, peak: pk, a: 0.12, hold: 0.2, d: 0.6, dest: lp });
    tone(v, { f: 110 * r, to: 98 * r, peak: 0.2, a: 0.1, hold: 0.2, d: 0.55 });
  },

  drunk: (v, r) => {
    for (const det of [0, 32]) {
      const o = tone(v, { shape: 'triangle', f: 440 * r, to: 300 * r, glide: 0.6, peak: 0.3, a: 0.02, hold: 0.25, d: 0.35, detune: det });
      v.lfo('sine', 5.5, 90, o.detune, v.t, v.t + 0.7);
    }
    // Hiccup.
    tone(v, { f: 320 * r, to: 950 * r, glide: 0.04, at: 0.52, peak: 0.25, a: 0.003, d: 0.06 });
  },

  rocket: (v, r) => {
    hiss(v, { peak: 0.5, a: 0.05, d: 0.45, type: 'bandpass', f: 300 * r, to: 2800 * r, glide: 0.4, q: 1.2 });
    hiss(v, { kind: 'brown', peak: 0.55, a: 0.02, d: 0.5, type: 'lowpass', f: 260, q: 0.8 });
    tone(v, { f: 80 * r, to: 140 * r, glide: 0.4, peak: 0.3, a: 0.02, d: 0.42 });
  },

  dynamite: (v, r) => {
    tone(v, { f: 1900 * r, peak: 0.25, a: 0.0005, d: 0.02 });
    crackle(v, 0.02, 0.35, 0.6, 3200 * r, v.out, 1.6);
    hiss(v, { at: 0.02, peak: 0.13, a: 0.03, hold: 0.3, d: 0.1, type: 'highpass', f: 5000, q: 0.7 });
  },

  warp: (v, r) => {
    const input = phaser(v, v.out, 300, 3500, 500, 0.55);
    const lp = lowpass(v, 4000, 0.7, input);
    const o = tone(v, { shape: 'sawtooth', f: 220 * r, to: 1800 * r, glide: 0.45, peak: 0.25, a: 0.02, hold: 0.2, d: 0.3, dest: lp });
    v.lfo('sine', 37, 60 * r, o.frequency, v.t, v.t + 0.6);
    hiss(v, { peak: 0.25, a: 0.08, hold: 0.15, d: 0.3, type: 'lowpass', f: 3000, dest: input });
  },

  slow: (v, r) => {
    const lp = lowpass(v, 3000, 1);
    glide(lp.frequency, v.t, 3000, 450, 0.45);
    // Tape-stop curve: exponential pitch fall.
    tone(v, { shape: 'triangle', f: 700 * r, to: 170 * r, glide: 0.45, peak: 0.45, a: 0.005, hold: 0.1, d: 0.38, dest: lp });
    tone(v, { shape: 'pulse25', f: 350 * r, to: 85 * r, glide: 0.45, peak: 0.2, a: 0.005, hold: 0.1, d: 0.36, dest: lp });
  },

  fast: (v, r) => {
    const lp = lowpass(v, 4500);
    for (const at of [0, 0.09]) {
      tone(v, { shape: 'pulse25', f: 320 * r, to: 1700 * r, glide: 0.08, at, peak: 0.25, a: 0.002, d: 0.09, dest: lp });
      tone(v, { f: 320 * r, to: 1700 * r, glide: 0.08, at, peak: 0.25, a: 0.002, d: 0.09 });
    }
  },

  fireball: (v, r) => {
    const t = v.t;
    const bp = hiss(v, { peak: 0.5, a: 0.07, hold: 0.1, d: 0.38, type: 'bandpass', f: 400 * r, q: 1.3 });
    bp.frequency.setValueAtTime(400 * r, t);
    bp.frequency.exponentialRampToValueAtTime(1800 * r, t + 0.18);
    bp.frequency.exponentialRampToValueAtTime(650 * r, t + 0.55);
    const roar = lowpass(v, 900, 0.8, v.shaper(v.out, v.kit.drive));
    tone(v, { shape: 'sawtooth', f: 90 * r, to: 190 * r, glide: 0.35, peak: 0.3, a: 0.04, hold: 0.1, d: 0.35, dest: roar });
    crackle(v, 0.03, 0.35, 0.35, 2200 * r);
  },

  bigball: (v, r) => {
    const o = tone(v, { f: 120 * r, to: 175 * r, glide: 0.45, peak: 0.7, a: 0.003, d: 0.55 });
    // Decaying pitch wobble = a heavy spring settling.
    const wob = v.lfo('sine', 9, 0, o.frequency, v.t, v.t + 0.6);
    wob.depth.gain.setValueAtTime(70 * r, v.t);
    wob.depth.gain.exponentialRampToValueAtTime(2 * r, v.t + 0.5);
    tone(v, { shape: 'triangle', f: 240 * r, to: 350 * r, glide: 0.45, peak: 0.18, a: 0.003, d: 0.35 });
  },

  double: (v, r) => {
    chip(v, E5 * r * semi(7), 0, 0.04, 0.4, { pan: -0.5 });
    chip(v, E5 * r * semi(7), 0.085, 0.04, 0.4, { pan: 0.5 });
    chip(v, E5 * r * semi(12), 0.17, 0.08, 0.35);
  },

  laserGet: (v, r) => {
    const lp = lowpass(v, 4200);
    [1, 1.26, 1.5].forEach((m, i) => {
      tone(v, { shape: 'pulse25', f: 700 * r * m, to: 2100 * r * m, glide: 0.06, at: i * 0.07, peak: 0.26, a: 0.002, d: 0.08, dest: lp });
      tone(v, { f: 350 * r * m, to: 1050 * r * m, glide: 0.06, at: i * 0.07, peak: 0.2, a: 0.002, d: 0.08 });
    });
  },

  catchGet: (v, r) => {
    const lp = lowpass(v, 1400 * r, 6);
    glide(lp.frequency, v.t, 1400 * r, 260 * r, 0.12);
    tone(v, { shape: 'sawtooth', f: 240 * r, to: 130 * r, glide: 0.12, peak: 0.35, a: 0.002, d: 0.14, dest: lp });
    // Magnetic hum rising under it.
    const trem = v.gain(v.out, 1);
    v.lfo('sine', 22, 0.45, trem.gain, v.t, v.t + 0.45);
    tone(v, { shape: 'triangle', f: 400 * r, to: 820 * r, glide: 0.3, at: 0.06, peak: 0.25, a: 0.02, hold: 0.12, d: 0.2, dest: trem });
  },

  shieldHit: (v, r) => {
    tone(v, { f: 990 * r, peak: 0.4, d: 0.22 });
    tone(v, { f: 1485 * r, peak: 0.12, d: 0.1 });
    const bp = v.filter(v.out, 'bandpass', 1300 * r, 2);
    tone(v, { shape: 'square', f: 160 * r, to: 120 * r, glide: 0.08, peak: 0.35, d: 0.09, dest: bp });
    ringTone(v, 1500 * r, 2310 * r, 0, 0.12, 0.1);
  },

  enemySpawn: (v, r) => {
    const t = v.t;
    const lp = lowpass(v, 3200);
    const layers: ReadonlyArray<readonly [number, number]> = [[1, 0.35], [1.5, 0.15]];
    for (const [m, pk] of layers) {
      const o = tone(v, { shape: 'triangle', f: 320 * r * m, to: 720 * r * m, glide: 0.5, peak: pk, a: 0.05, hold: 0.32, d: 0.18, dest: lp });
      const w = v.lfo('sine', 11, 0, o.detune, t, t + 0.6);
      w.depth.gain.setValueAtTime(260, t);
      w.depth.gain.linearRampToValueAtTime(60, t + 0.55);
    }
    hiss(v, { peak: 0.1, a: 0.1, hold: 0.2, d: 0.2, type: 'bandpass', f: 1200, to: 2600, glide: 0.5, q: 2 });
  },

  enemyHit: (v, r) => {
    tone(v, { f: 520 * r, to: 70 * r, glide: 0.06, peak: 0.5, a: 0.002, d: 0.1 });
    const lp = lowpass(v, 2600 * r, 7);
    glide(lp.frequency, v.t, 2600 * r, 200 * r, 0.14);
    tone(v, { shape: 'sawtooth', f: 400 * r, to: 90 * r, glide: 0.14, peak: 0.35, d: 0.18, dest: lp });
    hiss(v, { kind: 'pink', peak: 0.3, a: 0.0005, d: 0.05, type: 'bandpass', f: 900 * r, q: 1 });
  },

  enemyShoot: (v, r) => {
    const lp = lowpass(v, 2600);
    const o = tone(v, { shape: 'triangle', f: 950 * r, to: 240 * r, glide: 0.16, peak: 0.45, a: 0.002, d: 0.18, dest: lp });
    v.lfo('sine', 42, 35 * r, o.frequency, v.t, v.t + 0.2);
    tone(v, { shape: 'pulse12', f: 950 * r, to: 240 * r, glide: 0.16, peak: 0.12, a: 0.002, d: 0.14, dest: lp });
  },

  dagger: (v, r) => {
    const o = tone(v, { f: 2100 * r, to: 850 * r, glide: 0.38, peak: 0.3, a: 0.02, hold: 0.12, d: 0.26 });
    v.lfo('sine', 9, 25, o.detune, v.t, v.t + 0.42);
    // Breath that follows the whistle pitch.
    hiss(v, { peak: 0.35, a: 0.02, hold: 0.12, d: 0.26, type: 'bandpass', f: 2100 * r, to: 850 * r, glide: 0.38, q: 8 });
  },

  invaderStep: (v, _r, pitch) => {
    // The game passes the step index 0..3, not semitones: the classic descending bass walk.
    const notes = [98.0, 87.31, 77.78, 73.42];
    const f = notes[((Math.round(pitch) % 4) + 4) % 4];
    const lp = lowpass(v, 560, 2.5);
    tone(v, { shape: 'square', f, peak: 0.55, a: 0.003, d: 0.17, dest: lp });
    tone(v, { f, peak: 0.55, a: 0.003, d: 0.19 });
    tone(v, { f: f * 2, to: f, glide: 0.03, peak: 0.3, d: 0.05 });
  },

  teleport: (v, r) => {
    const t = v.t;
    const input = phaser(v, v.out, 350, 4200, 400, 0.6);
    hiss(v, { peak: 0.4, a: 0.1, hold: 0.15, d: 0.35, type: 'lowpass', f: 5000, q: 0.5, dest: input });
    tone(v, { shape: 'sawtooth', f: 110 * r, peak: 0.25, a: 0.1, hold: 0.15, d: 0.35, dest: lowpass(v, 2500, 0.7, input) });
    const o = tone(v, { f: 300 * r, peak: 0.18, a: 0.08, hold: 0.2, d: 0.3 });
    o.frequency.exponentialRampToValueAtTime(1500 * r, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(500 * r, t + 0.6);
  },

  paddleDeath: (v, r) => {
    const t = v.t;
    // Electric buzz: crunchy saw chopped by a 23 Hz square, like a shorting coil.
    const am = v.gain(v.filter(v.out, 'bandpass', 1800, 0.9), 0.5);
    v.lfo('square', 23, 0.5, am.gain, t, t + 0.75);
    tone(v, { shape: 'sawtooth', f: 62 * r, peak: 0.5, a: 0.005, hold: 0.55, d: 0.15, dest: v.shaper(am, v.kit.crunch) });
    crackle(v, 0, 0.6, 0.5, 4000, v.out, 2.5);
    const lp = lowpass(v, 3000, 1);
    glide(lp.frequency, t, 3000, 300, 0.9);
    tone(v, { shape: 'square', f: 1400 * r, to: 90 * r, glide: 0.9, peak: 0.22, a: 0.01, hold: 0.3, d: 0.6, dest: lp });
    boom(v, 0.72, 0.7, r);
  },

  lifeLost: (v, r) => {
    const notes = [392.0, 369.99, 349.23, 329.63];
    notes.forEach((f, i) => {
      const last = i === notes.length - 1;
      const oscs = chip(v, f * r, i * 0.2, last ? 0.55 : 0.13, 0.42, { vib: last ? 30 : 0, bright: 4 });
      if (last) {
        // Final note sags flat: the "wah-wah-waaah" droop.
        const t = v.t + i * 0.2;
        for (const o of oscs) {
          o.frequency.setValueAtTime(f * r, t + 0.25);
          o.frequency.exponentialRampToValueAtTime(f * r * 0.94, t + 0.7);
        }
      }
    });
  },

  bossHit: (v, r) => {
    clank(v, 300 * r, 0, 0.75, 0.3);
    const sat = v.shaper(v.out, v.kit.drive);
    tone(v, { f: 95 * r, to: 52 * r, glide: 0.15, peak: 0.8, d: 0.22, dest: sat });
    hiss(v, { kind: 'brown', peak: 0.45, a: 0.002, d: 0.2, type: 'lowpass', f: 600, q: 0.8, dest: sat });
  },

  bossShoot: (v, r) => {
    const lp = lowpass(v, 2200, 5, v.shaper(v.out, v.kit.drive));
    glide(lp.frequency, v.t, 2200, 280, 0.3);
    tone(v, { shape: 'sawtooth', f: 420 * r, to: 70 * r, glide: 0.32, peak: 0.4, a: 0.002, d: 0.35, dest: lp });
    tone(v, { shape: 'sawtooth', f: 420 * r, to: 70 * r, glide: 0.32, peak: 0.35, a: 0.002, d: 0.35, dest: lp, detune: 18 });
    hiss(v, { peak: 0.3, a: 0.001, d: 0.08, type: 'bandpass', f: 1200, q: 0.9 });
    tone(v, { f: 110 * r, to: 45 * r, glide: 0.25, peak: 0.5, d: 0.25 });
  },

  bossCharge: (v, r) => {
    const t = v.t;
    const lp = lowpass(v, 300, 3);
    glide(lp.frequency, t, 300, 4200, 1.0);
    const trem = v.gain(lp, 0.7);
    // Tremolo speeds up as the charge builds: tension you can count.
    const l = v.lfo('sine', 5, 0.3, trem.gain, t, t + 1.15);
    glide(l.osc.frequency, t, 5, 32, 1.0);
    tone(v, { shape: 'sawtooth', f: 90 * r, to: 720 * r, glide: 1.0, peak: 0.4, a: 0.9, d: 0.15, dest: trem });
    tone(v, { shape: 'square', f: 45 * r, to: 360 * r, glide: 1.0, peak: 0.2, a: 0.9, d: 0.15, dest: trem });
    hiss(v, { peak: 0.15, a: 0.9, d: 0.12, type: 'highpass', f: 800, to: 6000, glide: 1.0, q: 0.7 });
  },

  bossRoar: (v, r) => {
    const t = v.t;
    const out = v.gain(v.out, 1);
    // Two formants gliding "aah" → "ooh" over a crunchy, AM-growled saw stack.
    const f1 = v.filter(out, 'bandpass', 700, 4);
    glide(f1.frequency, t, 700, 420, 1.3);
    const f2 = v.filter(out, 'bandpass', 1150, 5);
    glide(f2.frequency, t, 1150, 780, 1.3);
    const chest = v.filter(out, 'lowpass', 500, 0.7);
    const bus = v.gain(f1, 1);
    bus.connect(f2);
    bus.connect(chest);
    const growl = v.gain(v.shaper(bus, v.kit.crunch), 0.6);
    v.lfo('sine', 28, 0.4, growl.gain, t, t + 1.5);
    for (const f of [72, 72 * 1.013, 108]) {
      const o = tone(v, { shape: 'sawtooth', f: f * r, peak: 0.35, a: 0.12, hold: 0.75, d: 0.5, dest: growl });
      o.frequency.exponentialRampToValueAtTime(f * r * 1.25, t + 0.4);
      o.frequency.exponentialRampToValueAtTime(f * r * 0.85, t + 1.3);
    }
    hiss(v, { kind: 'pink', peak: 0.2, a: 0.1, hold: 0.7, d: 0.4, type: 'bandpass', f: 1500, q: 1, dest: out });
  },

  bossDeath: (v, r) => {
    const lp = lowpass(v, 3500, 1);
    glide(lp.frequency, v.t, 3500, 400, 2.4);
    const o = tone(v, { shape: 'sawtooth', f: 900 * r, to: 55 * r, glide: 2.4, peak: 0.3, a: 0.05, hold: 1.4, d: 1.0, dest: lp });
    v.lfo('sine', 7, 60, o.detune, v.t, v.t + 2.5);
    [0, 0.35, 0.65, 1.0, 1.3, 1.6].forEach((at) => boom(v, at, 0.6, r * rand(0.8, 1.2), rand(-0.6, 0.6)));
    boom(v, 1.9, 2.2, r * 0.7);
  },

  menuMove: (v, r) => {
    tone(v, { f: 1180 * r, peak: 0.35, d: 0.05 });
    tone(v, { shape: 'triangle', f: 2360 * r, peak: 0.06, d: 0.025 });
  },

  menuSelect: (v, r) => {
    chip(v, E5 * r * semi(12), 0, 0.04, 0.35);
    chip(v, E5 * r * semi(19), 0.06, 0.1, 0.35);
  },

  codeOk: (v, r) => {
    [0, 4, 7, 12].forEach((s, i) => chip(v, E5 * r * semi(s), i * 0.06, 0.05, 0.38));
    for (const s of [12, 16, 19]) tone(v, { f: E5 * r * semi(s), at: 0.24, peak: 0.1, a: 0.01, d: 0.5 });
  },

  codeBad: (v, r) => {
    const lp = lowpass(v, 900, 0.8);
    const beeps: ReadonlyArray<readonly [number, number]> = [[0, 0.12], [0.17, 0.22]];
    for (const [at, len] of beeps) {
      // A2 against Bb2: the beating says "no" without a harsh buzzer.
      tone(v, { shape: 'square', f: 110 * r, at, peak: 0.3, a: 0.004, hold: len, d: 0.05, dest: lp });
      tone(v, { shape: 'square', f: 116.54 * r, at, peak: 0.3, a: 0.004, hold: len, d: 0.05, dest: lp });
    }
  },

  pause: (v, r) => {
    chip(v, E5 * r * semi(7), 0, 0.05, 0.32, { bright: 3 });
    chip(v, E5 * r, 0.08, 0.1, 0.32, { bright: 3 });
  },

  unpause: (v, r) => {
    chip(v, E5 * r, 0, 0.05, 0.32, { bright: 3 });
    chip(v, E5 * r * semi(7), 0.08, 0.1, 0.32, { bright: 3 });
  },

  scoreTick: (v, r) => {
    tone(v, { f: 2400 * r, peak: 0.3, a: 0.0005, d: 0.02 });
    tone(v, { shape: 'triangle', f: 1200 * r, peak: 0.1, a: 0.0005, d: 0.015 });
  },

  gateOpen: (v, r) => {
    const t = v.t;
    const am = v.gain(lowpass(v, 700, 2), 0.6);
    v.lfo('square', 28, 0.4, am.gain, t, t + 0.6);
    tone(v, { shape: 'sawtooth', f: 80 * r, to: 112 * r, glide: 0.45, peak: 0.35, a: 0.03, hold: 0.4, d: 0.1, dest: am });
    // Ratchet teeth.
    for (let i = 0; i < 9; i++) {
      const at = 0.03 + i * 0.045;
      hiss(v, { at, peak: 0.22, a: 0.0003, d: 0.008, type: 'bandpass', f: 3000, q: 4 });
      tone(v, { f: 1800 * r, at, peak: 0.06, a: 0.0003, d: 0.01 });
    }
    tone(v, { f: 140 * r, to: 80 * r, at: 0.5, peak: 0.6, d: 0.12 });
    clank(v, 400 * r, 0.5, 0.3, 0.12);
  },
};

export const SFX_NAMES = Object.keys(RECIPES) as SfxName[];

/**
 * Per-sound output trim from offline K-weighted loudness measurements (max 200 ms
 * window). Reference = paddle; offsets by design: frequent sounds sit lower
 * (laser -5 dB, wall -2, score tick -12), stingers -3 under the good/bad layer,
 * rare big events higher (explosion +3, big blasts / boss death +5).
 */
const LEVEL: Record<SfxName, number> = {
  paddle: 1.02, wall: 0.92, brick: 0.61, brickHit: 1.17, brickMetalBreak: 0.58, brickGold: 0.36, brickRegen: 0.67,
  explosion: 0.62, bigExplosion: 0.31, laser: 0.95, launch: 1.26, glue: 1.38, powerupDrop: 0.98, powerupGood: 0.43,
  powerupBad: 1.15, extraLife: 0.44, expand: 0.58, shrink: 0.71, multiball: 0.29, shield: 0.31, freeze: 0.79,
  darkness: 0.29, drunk: 0.36, rocket: 0.84, dynamite: 1.33, warp: 0.9, slow: 0.49, fast: 1.24, fireball: 0.35,
  bigball: 0.41, double: 0.35, laserGet: 1.33, catchGet: 0.73, shieldHit: 1.2, enemySpawn: 0.42, enemyHit: 1.15,
  enemyShoot: 1.07, dagger: 0.37, invaderStep: 0.39, teleport: 0.52, paddleDeath: 0.65, lifeLost: 0.51,
  bossHit: 0.41, bossShoot: 0.46, bossCharge: 0.59, bossRoar: 0.24, bossDeath: 0.38, menuMove: 1.43,
  menuSelect: 0.35, codeOk: 0.37, codeBad: 0.22, pause: 0.34, unpause: 0.34, scoreTick: 1.27, gateOpen: 0.71,
};

/** Room-reverb send. Bricks and pickups get air; booms and UI stay mostly dry. */
const SEND: Record<SfxName, number> = {
  paddle: 0.12, wall: 0.1, brick: 0.28, brickHit: 0.2, brickMetalBreak: 0.25, brickGold: 0.2,
  brickRegen: 0.35, explosion: 0.12, bigExplosion: 0.15, laser: 0.1, launch: 0.15, glue: 0.08,
  powerupDrop: 0.2, powerupGood: 0.25, powerupBad: 0.22, extraLife: 0.25, expand: 0.18,
  shrink: 0.18, multiball: 0.3, shield: 0.22, freeze: 0.3, darkness: 0.25, drunk: 0.2,
  rocket: 0.15, dynamite: 0.1, warp: 0.25, slow: 0.2, fast: 0.18, fireball: 0.15, bigball: 0.15,
  double: 0.22, laserGet: 0.2, catchGet: 0.15, shieldHit: 0.25, enemySpawn: 0.25, enemyHit: 0.15,
  enemyShoot: 0.15, dagger: 0.25, invaderStep: 0.1, teleport: 0.3, paddleDeath: 0.18,
  lifeLost: 0.25, bossHit: 0.18, bossShoot: 0.15, bossCharge: 0.2, bossRoar: 0.25, bossDeath: 0.2,
  menuMove: 0.08, menuSelect: 0.12, codeOk: 0.25, codeBad: 0.08, pause: 0.12, unpause: 0.12,
  scoreTick: 0.05, gateOpen: 0.15,
};

/**
 * Random detune range in cents. Constantly repeated sounds get a little variation so
 * they don't machine-gun; musical ones (brick, jingles) stay exactly in tune.
 */
const JITTER: Partial<Record<SfxName, number>> = {
  paddle: 25, wall: 40, brickHit: 30, brickMetalBreak: 40, brickGold: 15, laser: 30, explosion: 80,
  bigExplosion: 60, enemyHit: 50, enemyShoot: 40, shieldHit: 20, bossHit: 30, bossShoot: 30,
  glue: 30, launch: 20, scoreTick: 15, dagger: 40, gateOpen: 20,
};

export interface SfxParams {
  pitch: number;
  pan: number;
  volume: number;
}

/**
 * Builds one voice at time `t` and wires it: voice → panner → `dest`, plus the
 * reverb send. Throws only on a recipe bug, after cleaning up after itself.
 */
export function spawnSfx(kit: Kit, name: SfxName, t: number, p: SfxParams, dest: AudioNode, send: AudioNode): Voice {
  const ctx = kit.ctx;
  const j = JITTER[name] ?? 0;
  const semis = name === 'invaderStep' ? 0 : p.pitch;
  const r = Math.pow(2, (semis + (j ? rand(-j, j) / 100 : 0)) / 12);
  const v = new Voice(kit, t, LEVEL[name] * p.volume);
  const panner = ctx.createStereoPanner();
  panner.pan.value = p.pan;
  v.out.connect(panner);
  panner.connect(dest);
  v.own(panner);
  const sendLevel = SEND[name];
  if (sendLevel > 0) {
    const s = ctx.createGain();
    s.gain.value = sendLevel;
    panner.connect(s);
    s.connect(send);
    v.own(s);
  }
  try {
    RECIPES[name](v, r, p.pitch);
  } catch (err) {
    v.kill(t);
    v.dispose();
    throw err;
  }
  v.disposeWhenDone();
  return v;
}

const THRUSTER_LEVEL = 0.125;

/**
 * Continuous rocket thruster: looped brown rumble + band-passed hiss, with a
 * combustion flutter. Sources run forever at gain 0 when idle (negligible cost),
 * which keeps every intensity change a smooth ramp.
 */
export class Thruster {
  private readonly amp: GainNode;
  private readonly lp: BiquadFilterNode;
  private readonly hissGain: GainNode;

  constructor(kit: Kit, dest: AudioNode, send: AudioNode) {
    const ctx = kit.ctx;
    const now = ctx.currentTime;
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.amp.connect(dest);
    const sendGain = ctx.createGain();
    sendGain.gain.value = 0.12;
    this.amp.connect(sendGain);
    sendGain.connect(send);

    const flutter = ctx.createGain();
    flutter.gain.value = 1;
    flutter.connect(this.amp);
    for (const [rate, depth] of [[13, 0.22], [4.7, 0.12]] as const) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      lfo.connect(g);
      g.connect(flutter.gain);
      lfo.start(now);
    }

    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 160;
    this.lp.Q.value = 0.8;
    this.lp.connect(flutter);
    const rumble = ctx.createBufferSource();
    rumble.buffer = kit.noise.brown;
    rumble.loop = true;
    rumble.connect(this.lp);
    rumble.start(now);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.7;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    bp.connect(this.hissGain);
    this.hissGain.connect(flutter);
    const air = ctx.createBufferSource();
    air.buffer = kit.noise.white;
    air.loop = true;
    air.connect(bp);
    air.start(now, 0.7);
  }

  set(intensity: number, now: number): void {
    const x = clamp(intensity, 0, 1);
    this.amp.gain.setTargetAtTime(THRUSTER_LEVEL * Math.pow(x, 1.2), now, 0.07);
    this.lp.frequency.setTargetAtTime(160 + 900 * x, now, 0.1);
    this.hissGain.gain.setTargetAtTime(0.35 * x * x, now, 0.1);
  }
}

// ---------------------------------------------------------------------------
// DIGINUMIA Game Studio logo intro.

/** Overall level, set from offline loudness against the main SFX (see CLAUDE.md). */
const LOGO_LEVEL = 0.44;
const LOGO_SEND = 0.3;
/** The logo video lasts 4 s; the room tail rings a little past it. */
export const LOGO_STING_SECONDS = 4.3;

/**
 * Sound for the 4 s DGS logo video, hand-synced to timings measured on the video:
 * light sweep 0.55 → 1.40 s (letters D / G / S complete at 0.85 / 1.12 / 1.40 s,
 * wipe from x = 15 % to 84 % of the frame), subtitle wipe 1.67 → 1.95 s,
 * fade to black 3.30 → 3.90 s. E major throughout: it resolves onto the A-minor
 * title theme that follows (E is its dominant).
 */
export function spawnLogoSting(kit: Kit, t: number, dest: AudioNode, send: AudioNode): Voice {
  const v = new Voice(kit, t, LOGO_LEVEL);
  v.out.connect(dest);
  const s = kit.ctx.createGain();
  s.gain.value = LOGO_SEND;
  v.out.connect(s);
  s.connect(send);
  v.own(s);
  try {
    logoSting(v);
  } catch (err) {
    v.kill(t);
    v.dispose();
    throw err;
  }
  v.disposeWhenDone();
  return v;
}

function logoSting(v: Voice): void {
  const T = v.t;

  // 1. Out of the black: an airy swell and a low E rising into the first light (0.05 → 0.55 s).
  hiss(v, { kind: 'pink', at: 0.05, peak: 0.08, a: 0.48, d: 0.14, type: 'bandpass', f: 320, to: 2600, glide: 0.5, q: 1.2 });
  tone(v, { f: midiToHz(40), at: 0.05, peak: 0.14, a: 0.5, d: 0.45 });
  tone(v, { shape: 'triangle', f: midiToHz(52), at: 0.15, peak: 0.05, a: 0.4, d: 0.3 });

  // 2. The light blade (0.55 → 1.40 s): bright air panned along the wipe, a scanner tone rising an octave.
  const blade = v.pan(v.out, -0.69);
  blade.pan.setValueAtTime(-0.69, T + 0.57);
  blade.pan.linearRampToValueAtTime(-0.21, T + 0.85);
  blade.pan.linearRampToValueAtTime(0.2, T + 1.12);
  blade.pan.linearRampToValueAtTime(0.68, T + 1.4);
  hiss(v, { at: 0.53, peak: 0.22, a: 0.05, hold: 0.72, d: 0.18, type: 'bandpass', f: 2400, to: 6500, glide: 0.9, q: 2.5, dest: blade });
  hiss(v, { kind: 'pink', at: 0.53, peak: 0.16, a: 0.06, hold: 0.7, d: 0.2, type: 'lowpass', f: 900, to: 2200, glide: 0.9, dest: blade });
  const scan = v.filter(blade, 'lowpass', 1800, 0.7);
  for (const detune of [-7, 7]) {
    tone(v, { shape: 'sawtooth', f: midiToHz(64), to: midiToHz(76), glide: 0.85, at: 0.55, peak: 0.07, a: 0.08, hold: 0.62, d: 0.2, dest: scan, detune });
  }

  // 3. One glass note per letter as the light finishes it: E5, G#5, B5.
  glassPing(v, E5, 0.84, 0.3, -0.45);
  glassPing(v, E5 * semi(4), 1.11, 0.3, 0);
  glassPing(v, E5 * semi(7), 1.38, 0.3, 0.45);

  // 4. Lock-in at 1.42 s: low boom, damped metal and a bright octave on top.
  boom(v, 1.41, 0.9, 0.9);
  clank(v, midiToHz(52), 1.41, 0.22, 0.55);
  glassPing(v, E5 * 2, 1.42, 0.28, 0, 1.2);

  // 5. Pad bloom (E add9) under the held logo, closing with the fade to black.
  const padLp = v.filter(v.out, 'lowpass', 400, 0.6);
  padLp.frequency.setValueAtTime(400, T + 1.42);
  padLp.frequency.exponentialRampToValueAtTime(2600, T + 2.1);
  padLp.frequency.setValueAtTime(2600, T + 3.3);
  padLp.frequency.exponentialRampToValueAtTime(500, T + 3.95);
  const pad = v.gain(padLp);
  pad.gain.setValueAtTime(0, T + 1.41);
  pad.gain.linearRampToValueAtTime(1, T + 1.75);
  pad.gain.setValueAtTime(1, T + 3.3);
  pad.gain.exponentialRampToValueAtTime(0.001, T + 3.95);
  pad.gain.setValueAtTime(0, T + 3.96);
  const chord: ReadonlyArray<readonly [number, number]> = [[40, 0], [47, -0.35], [52, 0.35], [56, -0.2], [59, 0.2], [66, 0]];
  for (const [note, pan] of chord) {
    const g = v.gain(v.pan(pad, pan), 0.045);
    for (const detune of [-9, 9]) {
      const o = v.osc('sawtooth', midiToHz(note), g, T + 1.41, T + 4);
      o.detune.value = detune;
    }
  }

  // 6. Subtitle wipe (1.67 → 1.97 s): chip glints running left to right with the text.
  const glints = [88, 90, 92, 95, 97, 100];
  for (let i = 0; i < 10; i++) {
    chip(v, midiToHz(glints[i % glints.length]!), 1.67 + i * 0.03, 0.02, 0.11, { pan: -0.63 + (1.3 * i) / 9, bright: 3 });
  }

  // 7. A soft falling breath with the fade to black.
  hiss(v, { kind: 'pink', at: 3.28, peak: 0.06, a: 0.25, d: 0.45, type: 'bandpass', f: 2200, to: 300, glide: 0.65, q: 0.9 });
}
