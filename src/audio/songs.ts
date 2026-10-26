/**
 * Hand-written song data (see sequencer.ts for the notation). 16 steps per bar.
 *
 * Keys were chosen around the brick ping (E5 + combo semitones): A minor, E dorian,
 * G major and D minor all contain E, so combo runs never fight the music. Game
 * tracks keep leads mid-register and filtered, and arps quiet, to leave the upper
 * mids to the SFX.
 */
import type { Jingle, MusicTrack } from './audio';
import type { ArpPreset, BassPreset, DrumPreset, LeadPreset } from './instruments';
import type { PatternDef, SongDef } from './sequencer';

// ---------------------------------------------------------------------------
// Composition helpers (rhythm templates; the notes stay hand-picked).

/** Same text repeated as `n` bars. */
const rep = (bar: string, n: number): string => Array.from({ length: n }, () => bar).join(' | ');

/** Note one octave up: "A2" → "A3". */
function up(note: string): string {
  const m = /^([A-G][#b]?)(\d)$/.exec(note);
  return m ? `${m[1]}${Number(m[2]) + 1}` : note;
}

/** Driving 8ths with octave pops. */
const oct8 = (r: string): string => {
  const h = up(r);
  return `${r}:2 ${r}:2 ${h}:2 ${r}:2 ${r}:2 ${r}:2 ${h}:2 ${r}:2`;
};

/** Syncopated push: dotted 8ths then 8ths, with octave and fifth. */
const push = (r: string, fifth: string): string => `${r}:3 ${r}:3 ${r}:2 ${up(r)}:2 ${r}:2 ${fifth}:2 ${r}:2`;

/** Funk octave figure with a passing note leading into the next bar. */
const funk = (r: string, pass: string): string => {
  const h = up(r);
  return `${r}:2 ${h} ${r} -:2 ${r}:2 ${h}:2 ${r} ${h} -:2 ${pass}:2`;
};

/** Root / octave / fifth / octave bounce. */
const bounce = (r: string, fifth: string): string => {
  const h = up(r);
  return `${r}:2 ${h}:2 ${fifth}:2 ${h}:2 ${r}:2 ${h}:2 ${fifth}:2 ${h}:2`;
};

/** March: dotted-8th + 16th + quarter, root then fifth. */
const march = (r: string, fifth: string): string => `${r}:3 ${r} ${r}:4 ${fifth}:3 ${fifth} ${fifth}:4`;

const EMPTY_BAR = '................';

// ---------------------------------------------------------------------------
// Shared instrument presets: one band, re-voiced per track.

const DRUMS: DrumPreset = { level: 1, kick: 0.62, snare: 0.4, hat: 0.1, tom: 0.45, crash: 0.2 };

const LEAD_GAME: LeadPreset = {
  wave: 'pulse25', level: 0.2, cutoff: 2300, detune: 8, vibrato: 12, attack: 0.008, release: 0.1, echo: 0.18,
};
const HARM_SOFT: LeadPreset = {
  wave: 'pulse12', level: 0.09, cutoff: 1600, detune: 0, vibrato: 6, attack: 0.02, release: 0.18, echo: 0.08,
};
const BASS_DRIVE: BassPreset = { wave: 'sawtooth', level: 0.3, cutoff: 420, env: 1600, q: 4.5, decay: 0.14, sub: 0.3 };
const ARP_CHIP: ArpPreset = { wave: 'pulse25', level: 0.05, rate: 4, center: 64, cutoff: 2000, gate: 0.8, echo: 0.12 };

// ---------------------------------------------------------------------------
// TITLE — D minor, 110 BPM. Pad + slow 1/32 arps, half-time drums, epic hook.

const titleIntro: PatternDef = {
  bars: 4,
  pad: 'Dm:16 | Bb:16 | Gm:16 | A:16',
  arp: 'Dm:16 | Bb:16 | Gm:16 | A:16',
  harm: 'A4:16 | Bb4:16 | D5:16 | C#5:16',
  bass: 'D2:16 | Bb1:16 | G1:16 | A1:16',
  tom: `${EMPTY_BAR} | ${EMPTY_BAR} | l.......l....... | l...l...l.l.m.h.`,
};

const titleA: PatternDef = {
  bars: 8,
  lead:
    'D5:6 E5:2 F5:4 A5:4 | G5:3 F5:3 D5:2 F5:8 | E5:6 F5:2 G5:4 E5:4 | C#5:8 E5:4 A4:4 | ' +
    'D5:6 E5:2 F5:4 A5:4 | Bb5:6 A5:2 G5:4 F5:4 | G5:4 F5:2 E5:2 D5:4 Bb4:4 | A4:6 C#5:2 E5:8',
  pad: 'Dm:16 | Bb:16 | C:16 | A:16 | Dm:16 | Bb:16 | Gm:16 | A:16',
  arp: 'Dm:16 | Bb:16 | C:16 | A:16 | Dm:16 | Bb:16 | Gm:16 | A:16',
  bass:
    'D2:6 D2:6 D3:4 | Bb1:6 Bb1:6 Bb2:4 | C2:6 C2:6 C3:4 | A1:6 A1:6 C#2:2 E2:2 | ' +
    'D2:6 D2:6 D3:4 | Bb1:6 Bb1:6 Bb2:4 | G1:6 G1:6 G2:4 | A1:6 A1:6 A2:4',
  kick: `${rep('x.....x...x.....', 7)} | x.....x.x.......`,
  snare: `${rep('........x.......', 7)} | ........x..xx.XX`,
  hat: `c.x.x.x.x.x.x.x. | ${rep('x.x.x.x.x.x.x.x.', 7)}`,
};

const titleB: PatternDef = {
  bars: 8,
  lead:
    'F5:8 D5:4 F5:4 | C6:8 A5:4 F5:4 | Bb5:6 A5:2 G5:4 D5:4 | F5:6 E5:2 D5:8 | ' +
    'D5:4 F5:4 Bb5:4 D6:4 | C6:6 Bb5:2 G5:4 E5:4 | E5:4 A5:4 C#6:8 | ~D6:2 ~C#6:2 A5:4 -:8',
  harm: 'D5:16 | A4:16 | D5:8 Bb4:8 | A4:16 | F4:8 Bb4:8 | E4:8 G4:8 | A4:8 E4:8 | E4:16',
  pad: 'Bb:16 | F:16 | Gm:16 | Dm:16 | Bb:16 | C:16 | A:16 | Asus4:8 A:8',
  arp: 'Bb:16 | F:16 | Gm:16 | Dm:16 | Bb:16 | C:16 | A:16 | Asus4:8 A:8',
  bass:
    'Bb1:6 Bb1:6 F2:4 | F2:6 F2:6 C3:4 | G1:6 G1:6 D2:4 | D2:6 D2:6 A2:4 | ' +
    `Bb1:6 Bb1:6 F2:4 | C2:6 C2:6 G2:4 | A1:6 A1:6 E2:4 | ${'A1:2 '.repeat(8).trim()}`,
  kick: `${rep('x.....x.x.....x.', 7)} | x.....x.........`,
  snare: `${rep('....x.......x...', 7)} | ....x...........`,
  hat: `c.x.x.x.x.x.x.o. | ${rep('x.x.x.x.x.x.x.o.', 6)} | x.x.x.x.........`,
  tom: `${rep(EMPTY_BAR, 7)} | ........hhmmllll`,
};

const TITLE: SongDef = {
  name: 'title',
  bpm: 110,
  loop: true,
  loopTo: 1,
  order: ['intro', 'A', 'B'],
  patterns: { intro: titleIntro, A: titleA, B: titleB },
  lead: { wave: 'pulse25', level: 0.2, cutoff: 3000, detune: 10, vibrato: 18, attack: 0.012, release: 0.18, echo: 0.3 },
  harm: { ...HARM_SOFT, level: 0.1, cutoff: 1800, echo: 0.15 },
  bass: { wave: 'sawtooth', level: 0.3, cutoff: 300, env: 900, q: 3, decay: 0.3, sub: 0.4 },
  arp: { wave: 'pulse25', level: 0.045, rate: 2, center: 69, cutoff: 3000, gate: 0.5, echo: 0.3 },
  pad: { level: 0.14, cutoff: 1400, center: 57, attack: 0.8, release: 1.2, spread: 16 },
  drums: { ...DRUMS, kick: 0.68, tom: 0.5, crash: 0.24 },
  echo: { beats: 0.75, feedback: 0.32 },
};

// ---------------------------------------------------------------------------
// GAME 1 — A minor, 132 BPM. Busy syncopated hook (A) vs long-note chorus (B).

const g1A: PatternDef = {
  bars: 8,
  lead:
    'A4:2 C5:2 E5:3 D5:1 C5:2 A4:2 E5:4 | F5:3 E5:1 C5:2 A4:2 F4:2 A4:2 C5:4 | ' +
    'G5:3 E5:1 C5:2 G4:2 E5:3 D5:1 C5:4 | D5:2 B4:2 G4:2 B4:2 D5:3 E5:1 D5:2 B4:2 | ' +
    'A4:2 C5:2 E5:3 D5:1 C5:2 A4:2 A5:4 | G5:3 F5:1 E5:2 C5:2 A4:2 C5:2 F5:4 | ' +
    'D5:3 E5:1 F5:2 E5:2 D5:2 B4:2 G4:4 | G#4:4 B4:4 E5:4 ~D5:2 B4:2',
  arp: 'Am:16 | F:16 | C:16 | G:16 | Am:16 | F:16 | G:16 | E:16',
  bass: [oct8('A2'), oct8('F2'), oct8('C3'), oct8('G2'), oct8('A2'), oct8('F2'), oct8('G2'), 'E2:2 E2:2 E3:2 E2:2 G#2:2 B2:2 D3:2 B2:2'].join(' | '),
  kick: rep('x.....x.x.....x.', 8),
  snare: `${rep('....x.......x...', 7)} | ....x.......xxXX`,
  hat: `c.x.x.x.x.x.x.x. | ${rep('x.x.x.x.x.x.x.x.', 7)}`,
};

const g1B: PatternDef = {
  bars: 8,
  lead:
    'C5:6 A4:2 C5:4 F5:4 | D5:6 B4:2 D5:4 G5:4 | E5:6 G5:2 B5:4 A5:2 G5:2 | A5:8 E5:4 C5:4 | ' +
    'F5:6 E5:2 D5:4 A4:4 | B4:6 C5:2 D5:4 G5:4 | E5:4 G5:4 C6:6 B5:2 | B5:4 G#5:4 E5:4 -:4',
  harm: 'A4:16 | B4:16 | B4:16 | C5:16 | A4:16 | B4:16 | G4:16 | G#4:16',
  arp: 'F:16 | G:16 | Em:16 | Am:16 | Dm:16 | G:16 | C:16 | E:16',
  pad: 'F:16 | G:16 | Em:16 | Am:16 | Dm:16 | G:16 | C:16 | E:16',
  bass: [push('F2', 'C3'), push('G2', 'D3'), push('E2', 'B2'), push('A2', 'E3'), push('D2', 'A2'), push('G2', 'D3'), push('C3', 'G2'), push('E2', 'B2')].join(' | '),
  kick: rep('x...x...x...x...', 8),
  snare: `${rep('....x.......x...', 7)} | ....x...x.x.xxXX`,
  hat: `c.o...o...o...o. | ${rep('..o...o...o...o.', 7)}`,
};

const g1A2: PatternDef = {
  ...g1A,
  harm: 'E4:8 A4:8 | C5:8 A4:8 | G4:8 E4:8 | D4:8 G4:8 | E4:8 A4:8 | C5:8 F4:8 | D4:8 B3:8 | B3:8 G#4:8',
  hat: `c.x.x.x.x.x.x.x. | ${rep('x.x.x.x.x.x.x.x.', 6)} | x.x.x.x.x.x.x.o.`,
};

const GAME1: SongDef = {
  name: 'game1',
  bpm: 132,
  loop: true,
  order: ['A', 'B', 'A2'],
  patterns: { A: g1A, B: g1B, A2: g1A2 },
  lead: LEAD_GAME,
  harm: HARM_SOFT,
  bass: BASS_DRIVE,
  arp: ARP_CHIP,
  pad: { level: 0.07, cutoff: 900, center: 57, attack: 0.4, release: 0.6, spread: 12 },
  drums: DRUMS,
  echo: { beats: 0.75, feedback: 0.25 },
};

// ---------------------------------------------------------------------------
// GAME 2 — E dorian, 126 BPM, light swing. Funk octave bass, call & response lead.

const g2A: PatternDef = {
  bars: 8,
  lead:
    'E5:2 -:1 E5:1 G5:2 E5:2 A5:3 G5:1 E5:4 | -:2 C#5:2 E5:2 F#5:2 E5:2 C#5:2 B4:4 | ' +
    'E5:2 -:1 E5:1 G5:2 E5:2 B5:3 A5:1 G5:4 | F#5:3 E5:1 C#5:2 A4:2 B4:8 | ' +
    'G5:3 G5:1 E5:2 C5:2 G5:2 E5:2 C5:4 | F#5:3 F#5:1 D5:2 A4:2 F#5:2 A5:2 D6:4 | ' +
    'B5:4 A5:2 G5:2 F#5:2 E5:2 D5:2 B4:2 | E5:8 -:8',
  arp: 'Em7:16 | A7:16 | Em7:16 | A7:16 | Cmaj7:16 | D:16 | Em7:16 | Em7:16',
  bass: [funk('E2', 'D3'), funk('A1', 'B1'), funk('E2', 'D3'), funk('A1', 'B1'), funk('C2', 'C#2'), funk('D2', 'D#2'), funk('E2', 'D3'), funk('E2', 'B1')].join(' | '),
  kick: rep('x.....x...x..x..', 8),
  snare: `${rep('....x..g....x..g', 7)} | ....x..g..x.xxXX`,
  hat: rep('x.xxx.x.x.xxx.xo', 8),
};

const g2B: PatternDef = {
  bars: 8,
  lead:
    'E5:6 D5:2 E5:4 G5:4 | F#5:6 E5:2 D5:4 A4:4 | D5:6 C#5:2 B4:4 F#4:4 | G4:4 B4:4 E5:8 | ' +
    'G5:6 F#5:2 E5:4 C5:4 | A5:6 G5:2 F#5:4 D5:4 | D#5:4 F#5:4 A5:4 B5:4 | ~C6:2 ~B5:2 A5:2 F#5:2 D#5:4 -:4',
  harm: 'G4:16 | A4:16 | F#4:16 | G4:16 | E4:16 | F#4:16 | F#4:16 | A4:16',
  arp: 'Cmaj7:16 | D:16 | Bm:16 | Em:16 | Cmaj7:16 | D:16 | B7:16 | B7:16',
  bass:
    [oct8('C2'), oct8('D2'), oct8('B1'), oct8('E2'), oct8('C2'), oct8('D2'), oct8('B1')].join(' | ') +
    ' | B1:2 B2:2 B1:2 B2:2 A2:2 F#2:2 D#2:2 B1:2',
  kick: rep('x.......x.x.....', 8),
  snare: `${rep('....x.......x...', 7)} | ....x...x.x.xxXX`,
  hat: `c.x.x.x.x.x.x.o. | ${rep('x.x.x.x.x.x.x.o.', 7)}`,
};

const g2A2: PatternDef = {
  ...g2A,
  harm: 'G4:8 B4:8 | A4:8 C#5:8 | G4:8 B4:8 | E4:8 C#5:8 | E4:8 G4:8 | F#4:8 A4:8 | G4:8 B4:8 | B4:16',
};

const GAME2: SongDef = {
  name: 'game2',
  bpm: 126,
  swing: 0.12,
  loop: true,
  order: ['A', 'B', 'A2'],
  patterns: { A: g2A, B: g2B, A2: g2A2 },
  lead: { wave: 'pulse12', level: 0.21, cutoff: 2600, detune: 12, vibrato: 10, attack: 0.006, release: 0.09, echo: 0.24 },
  harm: { ...HARM_SOFT, wave: 'triangle', level: 0.12, cutoff: 2400 },
  bass: { wave: 'pulse25', level: 0.3, cutoff: 500, env: 2200, q: 6, decay: 0.1, sub: 0.4 },
  arp: { wave: 'square', level: 0.04, rate: 4, center: 66, cutoff: 1800, gate: 1, echo: 0.2 },
  drums: { ...DRUMS, hat: 0.09 },
  echo: { beats: 0.75, feedback: 0.28 },
};

// ---------------------------------------------------------------------------
// GAME 3 — G major, 138 BPM. Galloping hook, bright and heroic.

const g3A: PatternDef = {
  bars: 8,
  lead:
    'D5:2 D5:1 D5:1 G5:2 D5:2 B4:2 D5:2 G5:4 | F#5:2 F#5:1 F#5:1 A5:2 F#5:2 D5:2 F#5:2 A5:4 | ' +
    'G5:2 G5:1 G5:1 B5:2 G5:2 E5:2 G5:2 B5:2 A5:2 | G5:6 E5:2 D5:4 C5:4 | ' +
    'D5:2 D5:1 D5:1 G5:2 D5:2 B4:2 D5:2 G5:2 B5:2 | A5:2 A5:1 A5:1 D6:2 A5:2 F#5:2 A5:2 D6:4 | ' +
    'E6:4 D6:2 C6:2 B5:2 A5:2 G5:2 E5:2 | F#5:4 A5:4 D5:4 -:4',
  arp: 'G:16 | D:16 | Em:16 | C:16 | G:16 | D:16 | C:16 | D:16',
  bass:
    [bounce('G2', 'D3'), bounce('D2', 'A2'), bounce('E2', 'B2'), bounce('C2', 'G2'), bounce('G2', 'D3'), bounce('D2', 'A2'), bounce('C2', 'G2')].join(' | ') +
    ' | D2:2 D3:2 A2:2 D3:2 D2:2 E2:2 F#2:2 A2:2',
  kick: rep('x...x...x...x...', 8),
  snare: `${rep('....x.......x...', 7)} | ....x.......x.XX`,
  hat: `c.X.x.X.x.X.x.X. | ${rep('x.X.x.X.x.X.x.X.', 7)}`,
  tom: `${rep(EMPTY_BAR, 7)} | ........hhmm.ll.`,
};

const g3B: PatternDef = {
  bars: 8,
  lead:
    'B5:6 A5:2 G5:4 E5:4 | G5:6 E5:2 C5:4 E5:4 | D5:6 E5:2 G5:4 B5:4 | A5:8 F#5:4 D5:4 | ' +
    'E5:4 G5:4 B5:4 E6:4 | E6:6 D6:2 C6:4 G5:4 | A5:4 C6:4 E6:4 ~D6:2 C6:2 | D6:6 C6:2 A5:4 F#5:4',
  harm: 'G4:8 B4:8 | E4:8 G4:8 | B4:8 D5:8 | F#4:8 A4:8 | G4:8 B4:8 | E4:8 G4:8 | C5:8 E4:8 | F#4:8 A4:8',
  arp: 'Em:16 | C:16 | G:16 | D:16 | Em:16 | C:16 | Am:16 | D:16',
  pad: 'Em:16 | C:16 | G:16 | D:16 | Em:16 | C:16 | Am:16 | D:16',
  bass: [push('E2', 'B2'), push('C2', 'G2'), push('G2', 'D3'), push('D2', 'A2'), push('E2', 'B2'), push('C2', 'G2'), push('A2', 'E3'), push('D2', 'A2')].join(' | '),
  kick: rep('x.....x.x.......', 8),
  snare: `${rep('....x.......x...', 7)} | ....x...x.xxXXXX`,
  hat: `c.x.x.x.x.x.x.x. | ${rep('x.x.x.x.x.x.x.x.', 7)}`,
};

const g3A2: PatternDef = {
  ...g3A,
  harm: 'B4:8 D5:8 | A4:8 F#4:8 | B4:8 G4:8 | E4:8 G4:8 | B4:8 D5:8 | A4:8 D5:8 | E5:8 C5:8 | A4:8 F#4:8',
};

const GAME3: SongDef = {
  name: 'game3',
  bpm: 138,
  loop: true,
  order: ['A', 'B', 'A2'],
  patterns: { A: g3A, B: g3B, A2: g3A2 },
  lead: { ...LEAD_GAME, level: 0.19, cutoff: 2600, detune: 10, vibrato: 14, echo: 0.2 },
  harm: { ...HARM_SOFT, wave: 'triangle', level: 0.12, cutoff: 3000 },
  bass: { wave: 'sawtooth', level: 0.3, cutoff: 450, env: 1300, q: 3.5, decay: 0.12, sub: 0.25 },
  arp: { ...ARP_CHIP, wave: 'pulse12', center: 67, cutoff: 2400, gate: 0.6, echo: 0.15 },
  pad: { level: 0.07, cutoff: 1000, center: 60, attack: 0.3, release: 0.6, spread: 12 },
  drums: DRUMS,
  echo: { beats: 0.75, feedback: 0.25 },
};

// ---------------------------------------------------------------------------
// BOSS — E phrygian, 150 BPM. 16th chug riff with b2 / tritone, harmonic-minor B section.

const bossA: PatternDef = {
  bars: 4,
  bass:
    'E2 E2 E3 E2 F2 E2 E2 G2 E2 E2 F2 E2 A#2 A2 G2 F2 | ' +
    'E2 E2 E3 E2 F2 E2 E2 G2 E2 E2 F2 E2 G2:2 F2:2 | ' +
    'F2 F2 F3 F2 G2 F2 F2 A2 F2 F2 G2 F2 C3 B2 A2 G2 | ' +
    'E2 E2 E3 E2 F2 E2 E2 G2 E2:2 D#2:2 D2:2 D#2:2',
  lead: 'E5:4 F5:4 E5:2 -:2 B4:4 | C5:6 B4:2 A#4:4 B4:4 | F5:4 G5:4 F5:2 -:2 C5:4 | B4:8 ~C5:4 ~B4:4',
  arp: 'Em:16 | Em:16 | F:16 | Em:16',
  kick: rep('x.x...x.x.x...x.', 4),
  snare: `${rep('....x.......x...', 3)} | ....x.......x.xx`,
  hat: `c.x.x.x.x.x.x.x. | ${rep('x.x.x.x.x.x.x.x.', 3)}`,
};

const bossA2: PatternDef = {
  ...bossA,
  // Sustained saw a semitone / tritone against the lead: the screw tightens.
  harm: 'B4:16 | A#4:16 | C5:16 | B4:8 A#4:8',
  hat: `c.x.x.x.x.x.x.x. | ${rep('x.xxx.xxx.xxx.xx', 3)}`,
};

const bossB: PatternDef = {
  bars: 8,
  bass: [oct8('A1'), oct8('A1'), oct8('F1'), oct8('F1'), oct8('D2'), oct8('D2'), oct8('B1'), 'B1:2 B1:2 B1:2 B1:2 C2:2 C#2:2 D2:2 D#2:2'].join(' | '),
  lead:
    'A4:2 C5:2 E5:2 A5:4 G#5:2 A5:2 B5:2 | C6:6 B5:2 A5:4 E5:4 | F5:2 A5:2 C6:4 B5:2 A5:2 G#5:2 A5:2 | F5:8 E5:4 C5:4 | ' +
    'D5:2 F5:2 A5:2 D6:4 C6:2 A5:2 F5:2 | G#5:6 A5:2 F5:4 D5:4 | D#5:2 F#5:2 A5:2 B5:4 A5:2 F#5:2 D#5:2 | B5:8 ~C6:2 ~B5:2 A5:2 F#5:2',
  harm: 'E4:16 | E4:16 | C4:16 | C4:16 | F4:16 | F4:16 | D#4:16 | F#4:16',
  arp: 'Am:16 | Am:16 | F:16 | F:16 | Dm:16 | Dm:16 | B7:16 | B7:16',
  kick: `${rep('x..x..x.x..x..x.', 7)} | x.......x.......`,
  snare: `${rep('....x.......x...', 7)} | x.x.x.x.xxxxXXXX`,
  hat: `c.x.x.x.x.x.x.x. | ${rep('x.x.x.x.x.x.x.x.', 6)} | ${EMPTY_BAR}`,
};

const BOSS: SongDef = {
  name: 'boss',
  bpm: 150,
  loop: true,
  order: ['A', 'A2', 'B'],
  patterns: { A: bossA, A2: bossA2, B: bossB },
  lead: { wave: 'pulse25', level: 0.17, cutoff: 2200, detune: 16, vibrato: 20, attack: 0.006, release: 0.1, echo: 0.15 },
  harm: { wave: 'sawtooth', level: 0.07, cutoff: 1400, detune: 10, vibrato: 0, attack: 0.15, release: 0.3, echo: 0 },
  bass: { wave: 'sawtooth', level: 0.3, cutoff: 600, env: 2400, q: 7, decay: 0.08, sub: 0.3 },
  arp: { wave: 'pulse12', level: 0.045, rate: 4, center: 64, cutoff: 1800, gate: 1, echo: 0.1 },
  drums: { ...DRUMS, kick: 0.7, snare: 0.45, tom: 0.55, crash: 0.24 },
  echo: { beats: 0.5, feedback: 0.2 },
  gain: 0.89,
};

// ---------------------------------------------------------------------------
// VICTORY — D major, 120 BPM. Fanfare lead over a march, pad + 1/32 arps.

const victA: PatternDef = {
  bars: 8,
  lead:
    'A4:2 D5:2 F#5:2 A5:6 F#5:2 A5:2 | E5:6 C#5:2 E5:4 A5:4 | F#5:6 D5:2 B4:4 D5:4 | G5:6 F#5:2 E5:4 D5:4 | ' +
    'A4:2 D5:2 F#5:2 A5:6 B5:2 C#6:2 | D6:4 C#6:4 B5:2 A5:2 E5:4 | B5:6 A5:2 G5:4 B5:4 | A5:8 E5:4 C#5:4',
  pad: 'D:16 | A:16 | Bm:16 | G:16 | D:16 | A:16 | G:16 | A:16',
  arp: 'D:16 | A:16 | Bm:16 | G:16 | D:16 | A:16 | G:16 | A:16',
  bass: [march('D2', 'A1'), march('A1', 'E2'), march('B1', 'F#2'), march('G1', 'D2'), march('D2', 'A1'), march('A1', 'E2'), march('G1', 'D2'), march('A1', 'E2')].join(' | '),
  kick: rep('x...x...x...x...', 8),
  snare: rep('....x..g....x.gx', 8),
  hat: `c.x.x.x.x.x.x.x. | ${rep('x.x.x.x.x.x.x.x.', 7)}`,
};

const victB: PatternDef = {
  bars: 8,
  lead:
    'D5:4 G5:4 B5:6 A5:2 | A5:4 E5:4 C#5:6 E5:2 | C#6:6 A5:2 F#5:4 A5:4 | B5:8 F#5:4 D5:4 | ' +
    'G5:4 B5:4 E6:6 D6:2 | C#6:6 B5:2 A5:4 G5:4 | F#5:4 A5:4 D6:8 | E6:4 C#6:4 A5:4 E5:4',
  harm: 'B4:16 | C#5:16 | A4:16 | D5:16 | B4:16 | E5:8 C#5:8 | A4:16 | C#5:16',
  pad: 'G:16 | A:16 | F#m:16 | Bm:16 | Em:16 | A7:16 | D:16 | A:16',
  arp: 'G:16 | A:16 | F#m:16 | Bm:16 | Em:16 | A7:16 | D:16 | A:16',
  bass: [march('G1', 'D2'), march('A1', 'E2'), march('F#1', 'C#2'), march('B1', 'F#2'), march('E2', 'B1'), march('A1', 'E2'), march('D2', 'A1'), march('A1', 'E2')].join(' | '),
  kick: rep('x...x...x...x...', 8),
  snare: `${rep('....x..g....x.gx', 7)} | ....x...gggxgxXX`,
  hat: `c.x.x.x.x.x.x.x. | ${rep('x.x.x.x.x.x.x.x.', 7)}`,
};

const VICTORY: SongDef = {
  name: 'victory',
  bpm: 120,
  loop: true,
  order: ['A', 'B'],
  patterns: { A: victA, B: victB },
  lead: { wave: 'pulse25', level: 0.2, cutoff: 3200, detune: 10, vibrato: 16, attack: 0.008, release: 0.14, echo: 0.25 },
  harm: { ...HARM_SOFT, level: 0.1, cutoff: 2400 },
  bass: { wave: 'sawtooth', level: 0.3, cutoff: 500, env: 1000, q: 2.5, decay: 0.2, sub: 0.35 },
  arp: { wave: 'pulse25', level: 0.045, rate: 2, center: 69, cutoff: 3000, gate: 0.5, echo: 0.25 },
  pad: { level: 0.12, cutoff: 1600, center: 62, attack: 0.3, release: 0.8, spread: 14 },
  drums: DRUMS,
  echo: { beats: 0.75, feedback: 0.3 },
};

export const TRACKS: Readonly<Record<MusicTrack, SongDef>> = {
  title: TITLE,
  game1: GAME1,
  game2: GAME2,
  game3: GAME3,
  boss: BOSS,
  victory: VICTORY,
};

// ---------------------------------------------------------------------------
// JINGLES — one-shot, written as a single pattern of explicit length.

const LEAD_JINGLE: LeadPreset = {
  wave: 'pulse25', level: 0.22, cutoff: 3500, detune: 10, vibrato: 16, attack: 0.006, release: 0.25, echo: 0.2,
};

const LEVEL_START: SongDef = {
  name: 'levelStart',
  bpm: 150,
  loop: false,
  order: ['J'],
  patterns: {
    J: {
      steps: 20,
      lead: 'G4 B4 D5 G5 A5:2 B5:2 D6:12',
      harm: '-:8 B5:12',
      bass: 'G1:4 -:4 D2:4 G2:8',
      arp: '-:8 G:12',
      pad: '-:8 G:12',
      kick: 'x.......X...........',
      snare: '....gggX............',
      hat: '........c...........',
    },
  },
  lead: LEAD_JINGLE,
  harm: { ...HARM_SOFT, level: 0.1, cutoff: 3000 },
  bass: BASS_DRIVE,
  arp: { ...ARP_CHIP, center: 71, cutoff: 3500, level: 0.05 },
  pad: { level: 0.1, cutoff: 1800, center: 62, attack: 0.15, release: 0.6, spread: 14 },
  drums: DRUMS,
  echo: { beats: 0.75, feedback: 0.3 },
};

const LEVEL_CLEAR: SongDef = {
  name: 'levelClear',
  bpm: 140,
  loop: false,
  order: ['J'],
  patterns: {
    J: {
      steps: 30,
      lead: 'G4 C5 E5 G5:3 E5 G5 C6:6 B5:2 C6:2 D6:2 E6:10',
      harm: '-:6 C5 E5 G5:6 G5:2 A5:2 B5:2 C6:10',
      bass: 'C2:6 C2:2 C3:6 G2:6 C2:10',
      pad: 'C:14 G:6 C:10',
      arp: 'C:14 G:6 C:10',
      kick: 'x.....x.......X.....x.........',
      snare: '......x.gx....X.....x.........',
      hat: 'c.x.x.x.x.x.x.c...............',
    },
  },
  lead: LEAD_JINGLE,
  harm: { ...HARM_SOFT, level: 0.11, cutoff: 3000 },
  bass: BASS_DRIVE,
  arp: { ...ARP_CHIP, center: 72, cutoff: 3500, level: 0.05 },
  pad: { level: 0.12, cutoff: 1800, center: 60, attack: 0.1, release: 0.7, spread: 14 },
  drums: DRUMS,
  echo: { beats: 0.75, feedback: 0.3 },
};

const GAME_OVER: SongDef = {
  name: 'gameOver',
  bpm: 84,
  loop: false,
  order: ['J'],
  patterns: {
    J: {
      steps: 24,
      lead: 'E5:2 D5:2 C5:2 B4:2 C5:3 B4:1 A4:2 G#4:2 A4:8',
      harm: 'A4:8 F4:4 E4:12',
      pad: 'Am:8 F:4 E:4 Am:8',
      bass: 'A2:8 F2:4 E2:4 A1:8',
      tom: '................l.......',
    },
  },
  lead: { ...LEAD_JINGLE, cutoff: 2400, vibrato: 22, attack: 0.02, release: 0.5, echo: 0.3 },
  harm: { ...HARM_SOFT, wave: 'triangle', level: 0.12 },
  bass: { wave: 'sawtooth', level: 0.28, cutoff: 280, env: 500, q: 2, decay: 0.4, sub: 0.4 },
  pad: { level: 0.15, cutoff: 1100, center: 57, attack: 0.4, release: 1.2, spread: 16 },
  drums: { ...DRUMS, tom: 0.5 },
  echo: { beats: 0.75, feedback: 0.35 },
};

const BOSS_INTRO: SongDef = {
  name: 'bossIntro',
  bpm: 96,
  loop: false,
  order: ['J'],
  patterns: {
    J: {
      steps: 20,
      bass: 'E1:3 E1:1 F1:4 E1:3 E1:1 F1:4 E1:4',
      lead: '-:8 B4:4 C5:4 ~B4:4',
      harm: 'E4:8 F4:8 E4:4',
      pad: 'Em:8 F:8 E5:4',
      tom: 'l...l...l...l...l.l.',
      kick: 'X...............X...',
      hat: '................c...',
    },
  },
  lead: { wave: 'sawtooth', level: 0.14, cutoff: 1800, detune: 18, vibrato: 25, attack: 0.05, release: 0.4, echo: 0.3 },
  harm: { wave: 'sawtooth', level: 0.07, cutoff: 1100, detune: 12, vibrato: 0, attack: 0.2, release: 0.5, echo: 0 },
  bass: { wave: 'sawtooth', level: 0.32, cutoff: 260, env: 1400, q: 6, decay: 0.2, sub: 0.45 },
  pad: { level: 0.12, cutoff: 800, center: 52, attack: 0.5, release: 1, spread: 20 },
  drums: { ...DRUMS, kick: 0.75, tom: 0.6, crash: 0.25 },
  echo: { beats: 0.75, feedback: 0.35 },
  gain: 0.85,
};

const CODE_REVEAL: SongDef = {
  name: 'codeReveal',
  bpm: 120,
  loop: false,
  order: ['J'],
  patterns: {
    J: {
      steps: 20,
      // E lydian: Emaj7 → F# (I → II) is the classic "mystery, but bright" move.
      lead: 'B5:2 G#5:2 D#6:4 C#6:2 A#5:2 F#6:8',
      arp: 'Emaj7:10 F#:10',
      pad: 'Emaj7:10 F#:10',
      bass: 'E2:10 F#2:10',
    },
  },
  lead: { wave: 'triangle', level: 0.24, cutoff: 6000, detune: 6, vibrato: 12, attack: 0.004, release: 0.4, echo: 0.35 },
  bass: { wave: 'sawtooth', level: 0.24, cutoff: 350, env: 600, q: 2, decay: 0.3, sub: 0.4 },
  arp: { wave: 'pulse25', level: 0.05, rate: 4, center: 76, cutoff: 4000, gate: 0.4, echo: 0.35 },
  pad: { level: 0.12, cutoff: 2000, center: 64, attack: 0.25, release: 1, spread: 16 },
  echo: { beats: 0.5, feedback: 0.4 },
  gain: 1.4,
};

export const JINGLES: Readonly<Record<Jingle, SongDef>> = {
  levelStart: LEVEL_START,
  levelClear: LEVEL_CLEAR,
  gameOver: GAME_OVER,
  bossIntro: BOSS_INTRO,
  codeReveal: CODE_REVEAL,
};
