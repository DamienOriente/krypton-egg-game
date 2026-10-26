/**
 * Master bus:
 *
 *   sfx ─────────────────────────────────────────────┐
 *   music → carve EQ → duck → pause LPF → pause gain ┼→ pre → compressor → soft clip → out
 *   jingle ──────────────────────────────────────────┤
 *   room reverb (sends from all three) ──────────────┘
 *
 * The compressor does the glue/limiting; the soft clipper after it is a hard
 * guarantee that nothing ever exceeds 0.99, whatever stacks up.
 */
import { makeClipCurve, makeRoomImpulse } from './core';
import type { Kit } from './core';

const SFX_LEVEL = 1;
const MUSIC_LEVEL = 0.254;
const JINGLE_LEVEL = 0.33;
/**
 * Pre-gain keeps single sounds under the compressor knee: it should only act when
 * things stack. POST_GAIN then sets the final loudness (the Web Audio compressor
 * adds a fixed makeup gain of its own, ~+5 dB with these settings).
 */
const PRE_GAIN = 0.67;
const POST_GAIN = 1.15;
const REVERB_RETURN = 0.55;
const MUSIC_REVERB_SEND = 0.12;
const JINGLE_REVERB_SEND = 0.16;
const DUCK_LEVEL = 0.2;
const PAUSE_CUTOFF = 480;
const PAUSE_LEVEL = 0.5;

export class Mixer {
  /** SFX voices connect here. */
  readonly sfx: GainNode;
  /** Song players connect here. */
  readonly music: GainNode;
  readonly jingle: GainNode;
  /** Reverb send input. */
  readonly reverb: GainNode;
  private readonly duckGain: GainNode;
  private readonly pauseFilter: BiquadFilterNode;
  private readonly pauseGain: GainNode;
  private readonly openCutoff: number;

  constructor(kit: Kit, destination: AudioNode) {
    const ctx = kit.ctx;
    const gain = (value: number): GainNode => {
      const g = ctx.createGain();
      g.gain.value = value;
      return g;
    };

    const pre = gain(PRE_GAIN);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -9;
    comp.knee.value = 4;
    comp.ratio.value = 20;
    comp.attack.value = 0.001;
    comp.release.value = 0.1;
    // 0.5 = the clip curve's input scaling (it covers ±2 of real amplitude).
    const clipIn = gain(0.5 * POST_GAIN);
    const clip = ctx.createWaveShaper();
    clip.curve = makeClipCurve();
    // No oversampling: its reconstruction filter can overshoot the curve ceiling.
    clip.oversample = 'none';
    pre.connect(comp);
    comp.connect(clipIn);
    clipIn.connect(clip);
    clip.connect(destination);

    this.sfx = gain(SFX_LEVEL);
    this.sfx.connect(pre);

    this.music = gain(MUSIC_LEVEL);
    // Gentle dip where the brick pings and lasers live, so the music sits under them.
    const carve = ctx.createBiquadFilter();
    carve.type = 'peaking';
    carve.frequency.value = 2600;
    carve.Q.value = 0.8;
    carve.gain.value = -3;
    this.duckGain = gain(1);
    this.openCutoff = Math.min(20000, ctx.sampleRate * 0.45);
    this.pauseFilter = ctx.createBiquadFilter();
    this.pauseFilter.type = 'lowpass';
    this.pauseFilter.frequency.value = this.openCutoff;
    this.pauseFilter.Q.value = 0.9;
    this.pauseGain = gain(1);
    this.music.connect(carve);
    carve.connect(this.duckGain);
    this.duckGain.connect(this.pauseFilter);
    this.pauseFilter.connect(this.pauseGain);
    this.pauseGain.connect(pre);

    this.jingle = gain(JINGLE_LEVEL);
    this.jingle.connect(pre);

    // One shared small metallic room for everything: that is what makes the palette coherent.
    this.reverb = gain(1);
    const conv = ctx.createConvolver();
    conv.buffer = makeRoomImpulse(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 280;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7500;
    const ret = gain(REVERB_RETURN);
    this.reverb.connect(conv);
    conv.connect(hp);
    hp.connect(lp);
    lp.connect(ret);
    ret.connect(pre);
    // Music feeds the room after the pause filter, so its tail is muffled too.
    const musicSend = gain(MUSIC_REVERB_SEND);
    this.pauseGain.connect(musicSend);
    musicSend.connect(this.reverb);
    const jingleSend = gain(JINGLE_REVERB_SEND);
    this.jingle.connect(jingleSend);
    jingleSend.connect(this.reverb);
  }

  setSfxEnabled(on: boolean, now: number): void {
    this.sfx.gain.setTargetAtTime(on ? SFX_LEVEL : 0, now, 0.02);
  }

  setMusicEnabled(on: boolean, now: number): void {
    const v = on ? 1 : 0;
    this.music.gain.setTargetAtTime(v * MUSIC_LEVEL, now, 0.08);
    this.jingle.gain.setTargetAtTime(v * JINGLE_LEVEL, now, 0.03);
  }

  setPaused(paused: boolean, now: number): void {
    this.pauseFilter.frequency.cancelScheduledValues(now);
    this.pauseGain.gain.cancelScheduledValues(now);
    if (paused) {
      this.pauseFilter.frequency.setValueAtTime(this.pauseFilter.frequency.value, now);
      this.pauseFilter.frequency.exponentialRampToValueAtTime(PAUSE_CUTOFF, now + 0.45);
    } else {
      this.pauseFilter.frequency.setValueAtTime(Math.max(PAUSE_CUTOFF, this.pauseFilter.frequency.value), now);
      this.pauseFilter.frequency.exponentialRampToValueAtTime(this.openCutoff, now + 0.35);
    }
    this.pauseGain.gain.setTargetAtTime(paused ? PAUSE_LEVEL : 1, now, 0.12);
  }

  duck(start: number): void {
    this.duckGain.gain.cancelScheduledValues(start);
    this.duckGain.gain.setTargetAtTime(DUCK_LEVEL, start, 0.04);
  }

  unduck(now: number): void {
    this.duckGain.gain.cancelScheduledValues(now);
    this.duckGain.gain.setTargetAtTime(1, now, 0.25);
  }
}
