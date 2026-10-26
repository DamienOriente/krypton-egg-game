/**
 * Tiny tracker: songs are written as text patterns on a 16th-note grid and played
 * with lookahead scheduling on the audio clock (the timer only decides *when to
 * schedule*, never *when things sound*).
 *
 * Melodic lanes (lead, harm, bass), space separated tokens, `|` = bar line:
 *   A4      note, 1 step          A4:4   note lasting 4 steps     A4:2!  accented
 *   ~C5:2   glide (legato) from the previous note into C5
 *   .:4     extend the sounding note by 4 steps
 *   -:4     rest 4 steps
 * Chord lanes (arp, pad): same rhythm syntax with chord symbols:
 *   Am:8  F#m7:4  Cmaj7  G7  Dsus4  Bdim  E5 (power)  Eadd9 ...
 * Drum lanes, one char per step (`|` and spaces ignored), `.` = nothing:
 *   kick  x X      snare  x X g(host)      hat  x X o(pen) c(rash)      tom  l m h
 */
import { noteToMidi, pitchClass } from './core';
import type { Kit } from './core';
import { DrumKit, arpChord, bassNote, leadNote, padChord } from './instruments';
import type { ArpPreset, BassPreset, DrumPreset, LeadPreset, PadPreset } from './instruments';

export interface PatternDef {
  /** Length in bars of 16 steps (default 1)… */
  bars?: number;
  /** …or an explicit step count (jingles). */
  steps?: number;
  lead?: string;
  harm?: string;
  bass?: string;
  arp?: string;
  pad?: string;
  kick?: string;
  snare?: string;
  hat?: string;
  tom?: string;
}

export interface SongDef {
  name: string;
  bpm: number;
  /** Delay applied to odd 16ths, as a fraction of a step. */
  swing?: number;
  loop: boolean;
  /** Index in `order` the loop jumps back to (skips intros). */
  loopTo?: number;
  order: readonly string[];
  patterns: Readonly<Record<string, PatternDef>>;
  lead?: LeadPreset;
  harm?: LeadPreset;
  bass?: BassPreset;
  arp?: ArpPreset;
  pad?: PadPreset;
  drums?: DrumPreset;
  /** Tempo-synced echo for lead/arp sends. */
  echo?: { beats: number; feedback: number };
  /** Song-level trim from loudness measurements, so tracks match each other. */
  gain?: number;
}

type MelodicLane = 'lead' | 'harm' | 'bass';
type ChordLane = 'arp' | 'pad';
type DrumLane = 'kick' | 'snare' | 'hat' | 'tom';

interface NoteEvent {
  kind: 'note';
  lane: MelodicLane;
  len: number;
  /** `at` in steps from the note start. */
  pitches: { at: number; midi: number }[];
  accent: boolean;
}

interface ChordEvent {
  kind: 'chord';
  lane: ChordLane;
  len: number;
  rootPc: number;
  intervals: readonly number[];
}

interface HitEvent {
  kind: 'hit';
  lane: DrumLane;
  code: string;
}

type SeqEvent = NoteEvent | ChordEvent | HitEvent;

interface CompiledPattern {
  steps: number;
  at: (SeqEvent[] | undefined)[];
}

export interface CompiledSong {
  readonly def: SongDef;
  readonly stepDur: number;
  readonly patterns: readonly CompiledPattern[];
  readonly loopTo: number;
  /** Total length of one pass through `order`, in seconds. */
  readonly duration: number;
}

const BAR = 16;

const CHORD_INTERVALS: Readonly<Record<string, readonly number[]>> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  '9': [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '5': [0, 7, 12],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  add9: [0, 4, 7, 14],
};

const NOTE_TOKEN = /^(~?)([A-G][#b]?-?\d)(?::(\d+))?(!?)$/;
const CHORD_TOKEN = /^([A-G][#b]?)(maj7|m7|m9|m6|m|7|9|6|5|sus2|sus4|dim|aug|add9)?(?::(\d+))?$/;
const REST_TOKEN = /^-(?::(\d+))?$/;
const HOLD_TOKEN = /^\.(?::(\d+))?$/;

const DRUM_CODES: Readonly<Record<DrumLane, string>> = {
  kick: 'xX',
  snare: 'xXg',
  hat: 'xXoc',
  tom: 'lmh',
};

function warn(msg: string): void {
  console.warn(`[audio] ${msg}`);
}

class Slots {
  readonly at: (SeqEvent[] | undefined)[];
  readonly total: number;

  constructor(total: number) {
    this.total = total;
    this.at = new Array<SeqEvent[] | undefined>(total);
  }

  push(step: number, ev: SeqEvent): void {
    if (step < 0 || step >= this.total) return;
    const list = this.at[step];
    if (list) list.push(ev);
    else this.at[step] = [ev];
  }
}

function checkBar(where: string, bars: number, index: number, len: number): void {
  if (index < bars - 1 && len !== BAR) warn(`${where}: bar ${index + 1} is ${len} steps, expected ${BAR}`);
}

/** Shared rhythm parser for melodic and chord lanes. */
function parseRhythm(
  src: string,
  where: string,
  slots: Slots,
  onToken: (tok: string) => { len: number; start?: () => SeqEvent; glide?: number } | null,
): void {
  let cursor = 0;
  let open: (NoteEvent | ChordEvent) | null = null;
  let openStart = 0;
  const close = (): void => {
    if (open) {
      open.len = Math.max(1, Math.min(cursor, slots.total) - openStart);
      slots.push(openStart, open);
      open = null;
    }
  };
  const bars = src.split('|');
  bars.forEach((bar, bi) => {
    const barStart = cursor;
    for (const tok of bar.trim().split(/\s+/)) {
      if (!tok) continue;
      let m = HOLD_TOKEN.exec(tok);
      if (m) {
        cursor += m[1] ? Number(m[1]) : 1;
        continue;
      }
      m = REST_TOKEN.exec(tok);
      if (m) {
        close();
        cursor += m[1] ? Number(m[1]) : 1;
        continue;
      }
      const parsed = onToken(tok);
      if (!parsed) {
        warn(`${where}: bad token "${tok}"`);
        continue;
      }
      if (parsed.glide !== undefined && open && open.kind === 'note') {
        open.pitches.push({ at: cursor - openStart, midi: parsed.glide });
      } else if (parsed.start) {
        close();
        const ev = parsed.start();
        if (ev.kind !== 'hit') {
          open = ev;
          openStart = cursor;
        }
      }
      cursor += parsed.len;
    }
    checkBar(where, bars.length, bi, cursor - barStart);
  });
  close();
  if (cursor !== slots.total) warn(`${where}: ${cursor} steps, expected ${slots.total}`);
}

function parseMelodic(src: string, lane: MelodicLane, where: string, slots: Slots): void {
  parseRhythm(src, where, slots, (tok) => {
    const m = NOTE_TOKEN.exec(tok);
    if (!m) return null;
    const midi = noteToMidi(m[2]);
    if (midi === null) return null;
    const len = m[3] ? Number(m[3]) : 1;
    if (m[1] === '~') return { len, glide: midi, start: () => newNote(lane, midi, m[4] === '!') };
    return { len, start: () => newNote(lane, midi, m[4] === '!') };
  });
}

function newNote(lane: MelodicLane, midi: number, accent: boolean): NoteEvent {
  return { kind: 'note', lane, len: 0, pitches: [{ at: 0, midi }], accent };
}

function parseChords(src: string, lane: ChordLane, where: string, slots: Slots): void {
  parseRhythm(src, where, slots, (tok) => {
    const m = CHORD_TOKEN.exec(tok);
    if (!m) return null;
    const pc = pitchClass(m[1]);
    const intervals = CHORD_INTERVALS[m[2] ?? ''];
    if (pc === null || !intervals) return null;
    const len = m[3] ? Number(m[3]) : 1;
    return { len, start: (): ChordEvent => ({ kind: 'chord', lane, len: 0, rootPc: pc, intervals }) };
  });
}

function parseDrums(src: string, lane: DrumLane, where: string, slots: Slots): void {
  const allowed = DRUM_CODES[lane];
  const bars = src.split('|');
  let cursor = 0;
  bars.forEach((bar, bi) => {
    const barStart = cursor;
    for (const ch of bar.replace(/\s+/g, '')) {
      if (ch !== '.') {
        if (allowed.includes(ch)) slots.push(cursor, { kind: 'hit', lane, code: ch });
        else warn(`${where}: bad drum code "${ch}"`);
      }
      cursor++;
    }
    checkBar(where, bars.length, bi, cursor - barStart);
  });
  if (cursor !== slots.total) warn(`${where}: ${cursor} steps, expected ${slots.total}`);
}

function compilePattern(song: string, name: string, p: PatternDef): CompiledPattern {
  const steps = p.steps ?? (p.bars ?? 1) * BAR;
  const slots = new Slots(steps);
  const where = (lane: string): string => `${song}/${name}/${lane}`;
  if (p.lead) parseMelodic(p.lead, 'lead', where('lead'), slots);
  if (p.harm) parseMelodic(p.harm, 'harm', where('harm'), slots);
  if (p.bass) parseMelodic(p.bass, 'bass', where('bass'), slots);
  if (p.arp) parseChords(p.arp, 'arp', where('arp'), slots);
  if (p.pad) parseChords(p.pad, 'pad', where('pad'), slots);
  if (p.kick) parseDrums(p.kick, 'kick', where('kick'), slots);
  if (p.snare) parseDrums(p.snare, 'snare', where('snare'), slots);
  if (p.hat) parseDrums(p.hat, 'hat', where('hat'), slots);
  if (p.tom) parseDrums(p.tom, 'tom', where('tom'), slots);
  return { steps, at: slots.at };
}

const compiled = new WeakMap<SongDef, CompiledSong>();

export function compileSong(def: SongDef): CompiledSong {
  const hit = compiled.get(def);
  if (hit) return hit;
  const byName = new Map<string, CompiledPattern>();
  const patterns: CompiledPattern[] = [];
  for (const name of def.order) {
    let pat = byName.get(name);
    if (!pat) {
      const src = def.patterns[name];
      if (!src) {
        warn(`${def.name}: unknown pattern "${name}"`);
        continue;
      }
      pat = compilePattern(def.name, name, src);
      byName.set(name, pat);
    }
    patterns.push(pat);
  }
  const stepDur = 60 / def.bpm / 4;
  const loopTo = Math.min(Math.max(0, def.loopTo ?? 0), Math.max(0, patterns.length - 1));
  const duration = patterns.reduce((s, p) => s + p.steps, 0) * stepDur;
  const song: CompiledSong = { def, stepDur, patterns, loopTo, duration };
  compiled.set(def, song);
  return song;
}

/** Root placed nearest `center`, then stacked upward: the classic root-position chip arp. */
function arpVoicing(rootPc: number, intervals: readonly number[], center: number): number[] {
  let root = center - (((center - rootPc) % 12) + 12) % 12;
  if (center - root > 6) root += 12;
  return intervals.map((i) => root + i);
}

/** Every tone folded into ±6 semitones of `center`: smooth pad voice leading for free. */
function padVoicing(rootPc: number, intervals: readonly number[], center: number): number[] {
  const out = new Set<number>();
  const low = center - 6;
  for (const i of intervals) out.add(low + ((((rootPc + i - low) % 12) + 12) % 12));
  return [...out].sort((a, b) => a - b);
}

const LOOKAHEAD = 0.12;
/** Beyond this lag the timer was starved: resync instead of flooding a backlog. */
const MAX_LAG = 0.5;
/** Steps this late are dropped rather than played out of time. */
const LATE_TOLERANCE = 0.02;
const TOM_HZ: Readonly<Record<string, number>> = { l: 98, m: 131, h: 175 };

interface Ramp {
  from: number;
  to: number;
  t0: number;
  t1: number;
}

export class SongPlayer {
  readonly song: CompiledSong;
  readonly out: GainNode;
  private readonly kit: Kit;
  private readonly drums: DrumKit;
  private readonly lead: GainNode;
  private readonly harm: GainNode;
  private readonly bass: GainNode;
  private readonly arp: GainNode;
  private readonly pad: GainNode;
  private readonly owned: AudioNode[] = [];
  private nextTime: number;
  private pi = 0;
  private step = 0;
  private finished = false;
  private endAt = Infinity;
  private stopAt = Infinity;
  /** Our own copy of the gain ramp: AudioParam.value is not reliable mid-automation everywhere. */
  private ramp: Ramp;

  constructor(kit: Kit, song: CompiledSong, dest: AudioNode, start: number, gain = 1) {
    const ctx = kit.ctx;
    this.kit = kit;
    this.song = song;
    this.nextTime = start;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(gain, start);
    this.ramp = { from: gain, to: gain, t0: start, t1: start };
    this.out.connect(dest);
    if (song.patterns.length === 0) {
      this.finished = true;
      this.endAt = start;
    }

    const trim = song.def.gain ?? 1;
    const lane = (): GainNode => {
      const g = ctx.createGain();
      g.gain.value = trim;
      g.connect(this.out);
      this.owned.push(g);
      return g;
    };
    this.lead = lane();
    this.harm = lane();
    this.bass = lane();
    this.arp = lane();
    this.pad = lane();
    const drumBus = lane();
    drumBus.gain.value = trim * (song.def.drums?.level ?? 1);
    this.drums = new DrumKit(kit, drumBus, song.def.drums ?? { level: 1, kick: 0.5, snare: 0.35, hat: 0.1, tom: 0.4, crash: 0.2 });

    const def = song.def;
    if (def.echo) {
      const echoIn = ctx.createGain();
      const delay = ctx.createDelay(2);
      delay.delayTime.value = Math.min(1.9, (def.echo.beats * 60) / def.bpm);
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 2600;
      const fb = ctx.createGain();
      fb.gain.value = def.echo.feedback;
      echoIn.connect(delay);
      delay.connect(damp);
      damp.connect(fb);
      fb.connect(delay);
      damp.connect(this.out);
      this.owned.push(echoIn, delay, damp, fb);
      const send = (from: GainNode, amount: number): void => {
        if (amount <= 0) return;
        const s = ctx.createGain();
        s.gain.value = amount;
        from.connect(s);
        s.connect(echoIn);
        this.owned.push(s);
      };
      send(this.lead, def.lead?.echo ?? 0);
      send(this.harm, def.harm?.echo ?? 0);
      send(this.arp, def.arp?.echo ?? 0);
    }
  }

  get name(): string {
    return this.song.def.name;
  }

  /** True once the music content has played out (or a fade-out completed). */
  isOver(now: number): boolean {
    return (this.finished && now >= this.endAt) || now >= this.stopAt;
  }

  get stopping(): boolean {
    return this.stopAt !== Infinity;
  }

  /** When the last step ends (non-looping songs), or the fade-out ends. */
  get endTime(): number {
    return Math.min(this.endAt, this.stopAt);
  }

  pump(now: number): void {
    if (this.finished || now >= this.stopAt) return;
    if (this.nextTime < now - MAX_LAG) this.nextTime = now + 0.03;
    const horizon = now + LOOKAHEAD;
    const { patterns, stepDur, loopTo } = this.song;
    while (this.nextTime < horizon && this.nextTime < this.stopAt) {
      const pat = patterns[this.pi];
      if (this.nextTime >= now - LATE_TOLERANCE) this.scheduleStep(pat, this.step, this.nextTime);
      this.nextTime += stepDur;
      this.step++;
      if (this.step >= pat.steps) {
        this.step = 0;
        this.pi++;
        if (this.pi >= patterns.length) {
          if (this.song.def.loop) {
            this.pi = loopTo;
          } else {
            this.finished = true;
            this.endAt = this.nextTime;
            return;
          }
        }
      }
    }
  }

  fadeIn(t: number, dur: number): void {
    this.rampTo(0, t, 0);
    this.rampTo(1, t, dur);
  }

  fadeOut(now: number, dur: number): void {
    this.rampTo(0, now, dur);
    this.stopAt = Math.min(this.stopAt, now + dur);
  }

  dispose(): void {
    this.out.disconnect();
    for (const n of this.owned) n.disconnect();
  }

  private gainAt(t: number): number {
    const r = this.ramp;
    if (t <= r.t0) return r.from;
    if (t >= r.t1) return r.to;
    return r.from + ((r.to - r.from) * (t - r.t0)) / (r.t1 - r.t0);
  }

  private rampTo(value: number, t: number, dur: number): void {
    const g = this.out.gain;
    const from = this.gainAt(t);
    g.cancelScheduledValues(t);
    g.setValueAtTime(dur > 0 ? from : value, t);
    if (dur > 0) g.linearRampToValueAtTime(value, t + dur);
    this.ramp = { from: dur > 0 ? from : value, to: value, t0: t, t1: t + dur };
  }

  private scheduleStep(pat: CompiledPattern, step: number, time: number): void {
    const evs = pat.at[step];
    if (!evs) return;
    const def = this.song.def;
    const sd = this.song.stepDur;
    const t = time + (step % 2 === 1 ? (def.swing ?? 0) * sd : 0);
    for (const ev of evs) {
      if (ev.kind === 'note') {
        const vel = ev.accent ? 1 : 0.82;
        const pitches = ev.pitches.map((p) => ({ at: p.at * sd, midi: p.midi }));
        const span = ev.len * sd;
        if (ev.lane === 'bass') {
          if (def.bass) bassNote(this.kit, this.bass, def.bass, t, span - Math.min(0.05, sd * 0.35), pitches, vel);
        } else {
          const preset = ev.lane === 'lead' ? def.lead : def.harm;
          const dest = ev.lane === 'lead' ? this.lead : this.harm;
          if (preset) leadNote(this.kit, dest, preset, t, span - Math.min(0.025, sd * 0.25), pitches, vel);
        }
      } else if (ev.kind === 'chord') {
        if (ev.lane === 'arp' && def.arp) {
          arpChord(this.kit, this.arp, def.arp, t, ev.len, sd, arpVoicing(ev.rootPc, ev.intervals, def.arp.center));
        } else if (ev.lane === 'pad' && def.pad) {
          padChord(this.kit, this.pad, def.pad, t, ev.len * sd, padVoicing(ev.rootPc, ev.intervals, def.pad.center));
        }
      } else {
        this.hit(ev, t);
      }
    }
  }

  private hit(ev: HitEvent, t: number): void {
    const d = this.drums;
    switch (ev.lane) {
      case 'kick':
        d.kick(t, ev.code === 'X' ? 1 : 0.85);
        break;
      case 'snare':
        d.snare(t, ev.code === 'X' ? 1 : ev.code === 'g' ? 0.3 : 0.8);
        break;
      case 'hat':
        if (ev.code === 'c') d.crash(t, 0.9);
        else d.hat(t, ev.code === 'X' ? 0.95 : ev.code === 'o' ? 0.8 : 0.7, ev.code === 'o');
        break;
      case 'tom':
        d.tom(t, 0.85, TOM_HZ[ev.code] ?? 131);
        break;
    }
  }
}
