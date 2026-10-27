/**
 * Krypton Egg audio engine: 100% synthesized with the Web Audio API.
 *
 * Contract: every public method is safe to call at any time. Before unlock(),
 * or when Web Audio is unavailable, calls are no-ops (music requests are
 * remembered and start on unlock). Nothing here throws into the game loop.
 */
import { clamp, createKit } from './core';
import type { Kit } from './core';
import { Mixer } from './mixer';
import { SongPlayer, compileSong } from './sequencer';
import { Thruster, spawnLogoSting, spawnSfx } from './sfx';
import { JINGLES, TRACKS } from './songs';
import type { Voice } from './voice';

export type SfxName =
  | 'paddle'          // ball hits paddle: soft rubbery thock/boing
  | 'wall'            // ball hits the wooden frame: short wood knock
  | 'brick'           // 1-hit brick destroyed: glassy tonal ping (pitch = combo semitones)
  | 'brickHit'        // multi-hit silver brick damaged, not destroyed: metallic clank
  | 'brickMetalBreak' // silver brick destroyed: metal shatter
  | 'brickGold'       // indestructible gold brick hit: low heavy dull ting
  | 'brickRegen'      // regenerating brick reappears: rising shimmer
  | 'explosion'       // explosive brick / enemy blown up: punchy boom
  | 'bigExplosion'    // boss death, paddle destroyed: long rumbling blast
  | 'laser'           // paddle twin laser shot (very frequent!)
  | 'launch'          // ball launched from paddle
  | 'glue'            // ball caught by sticky paddle
  | 'powerupDrop'     // a power-up capsule is released from a brick (subtle)
  | 'powerupGood'     // generic good pickup (rising arpeggio)
  | 'powerupBad'      // generic bad pickup (falling, dissonant)
  | 'extraLife'       // 1UP jingle-like
  | 'expand' | 'shrink' | 'multiball' | 'shield' | 'freeze' | 'darkness' | 'drunk'
  | 'rocket' | 'dynamite' | 'warp' | 'slow' | 'fast' | 'fireball' | 'bigball'
  | 'double' | 'laserGet' | 'catchGet' // specific pickup stingers (layer over good/bad flavour)
  | 'shieldHit'       // ball bounces on the bottom energy barrier
  | 'enemySpawn'      // gate opens, alien enters: warble
  | 'enemyHit'        // enemy destroyed: squelchy pop
  | 'enemyShoot'      // enemy/invader shot
  | 'dagger'          // invader drops a dagger: whistle
  | 'invaderStep'     // invader formation step (classic low 4-note bass step, game passes pitch 0..3)
  | 'teleport'        // ball goes through a teleporter: phaser whoosh
  | 'paddleDeath'     // paddle electrocuted/destroyed
  | 'lifeLost'        // ball lost: descending sad tones
  | 'bossHit' | 'bossShoot' | 'bossCharge' | 'bossRoar' | 'bossDeath'
  | 'menuMove' | 'menuSelect' | 'codeOk' | 'codeBad' | 'pause' | 'unpause'
  | 'scoreTick'       // end-of-level score counting tick (very short, quiet)
  | 'gateOpen';       // top gate mechanism opening (mechanical)

export type MusicTrack = 'title' | 'game1' | 'game2' | 'game3' | 'boss' | 'victory';
export type Jingle = 'levelStart' | 'levelClear' | 'gameOver' | 'bossIntro' | 'codeReveal';

export interface SfxOptions {
  pitch?: number;  // semitones offset, default 0
  pan?: number;    // -1..1 stereo position, default 0
  volume?: number; // 0..1 multiplier, default 1
}

const STORAGE_KEY = 'ke.audio';
/** Same sound retriggered faster than this is ignored (one frame of double collisions). */
const RETRIGGER_MS = 25;
const MAX_PER_NAME = 6;
const MAX_VOICES = 40;
const CROSSFADE = 1;
/** Small scheduling lead so attacks are never clipped by main-thread / render-quantum jitter. */
const SCHEDULE_LEAD = 0.006;
const TICK_MS = 25;
/** Release tails of a finished jingle keep ringing this long before we detach it. */
const JINGLE_TAIL = 1.5;

interface Settings {
  music: boolean;
  sfx: boolean;
}

interface WebkitWindow {
  webkitAudioContext?: typeof AudioContext;
}

interface ActiveJingle {
  player: SongPlayer;
  resolve: () => void;
  fallback: ReturnType<typeof setTimeout>;
}

function loadSettings(): Settings {
  const defaults: Settings = { music: true, sfx: true };
  if (typeof localStorage === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaults;
    const rec = parsed as Record<string, unknown>;
    return {
      music: typeof rec.music === 'boolean' ? rec.music : defaults.music,
      sfx: typeof rec.sfx === 'boolean' ? rec.sfx : defaults.sfx,
    };
  } catch (err) {
    console.warn('[audio] could not read saved audio settings', err);
    return defaults;
  }
}

function saveSettings(s: Settings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (err) {
    console.warn('[audio] could not save audio settings', err);
  }
}

function finiteOr(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private kit: Kit | null = null;
  private mixer: Mixer | null = null;
  private thruster: Thruster | null = null;
  private unavailable = false;
  private resumePending = false;
  private hiddenSuspend = false;
  private readonly settings: Settings;
  private paused = false;
  private thrust = 0;
  private wantedTrack: MusicTrack | null = null;
  private current: SongPlayer | null = null;
  private currentTrack: MusicTrack | null = null;
  private readonly fading: SongPlayer[] = [];
  private readonly retired: { player: SongPlayer; at: number }[] = [];
  private jingle: ActiveJingle | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly voices = new Map<SfxName, Voice[]>();
  private readonly lastPlay = new Map<SfxName, number>();

  constructor() {
    this.settings = loadSettings();
  }

  /** Must be called from a user gesture (click/key). Idempotent. Creates/resumes the AudioContext. */
  unlock(): void {
    if (this.unavailable || typeof window === 'undefined') return;
    const ctx = this.ctx ?? this.create();
    if (!ctx) return;
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
      this.resumePending = true;
      this.hiddenSuspend = false;
      ctx.resume().then(
        () => {
          this.resumePending = false;
          this.syncMusic();
          this.applyThruster();
        },
        (err: unknown) => {
          this.resumePending = false;
          console.warn('[audio] AudioContext.resume() was refused', err);
        },
      );
      // Old iOS only unlocks output once a buffer is started inside the gesture.
      try {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(ctx.destination);
        src.start();
      } catch (err) {
        console.warn('[audio] silent unlock buffer failed', err);
      }
    }
    this.syncMusic();
    this.applyThruster();
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  play(name: SfxName, opts?: SfxOptions): void {
    if (!this.settings.sfx) return;
    const ctx = this.ctx;
    const kit = this.kit;
    const mixer = this.mixer;
    if (!ctx || !kit || !mixer || !this.canSchedule(ctx)) return;
    const volume = clamp(finiteOr(opts?.volume, 1), 0, 1);
    if (volume <= 0) return;
    const nowMs = performance.now();
    const last = this.lastPlay.get(name);
    if (last !== undefined && nowMs - last < RETRIGGER_MS) return;
    this.lastPlay.set(name, nowMs);

    const now = ctx.currentTime;
    this.reapVoices(now);
    const list = this.voices.get(name) ?? [];
    while (list.length >= MAX_PER_NAME) list.shift()?.kill(now);
    this.enforceGlobalCap(now);
    try {
      const voice = spawnSfx(
        kit,
        name,
        now + SCHEDULE_LEAD,
        {
          pitch: clamp(finiteOr(opts?.pitch, 0), -48, 48),
          pan: clamp(finiteOr(opts?.pan, 0), -1, 1),
          volume,
        },
        mixer.sfx,
        mixer.reverb,
      );
      list.push(voice);
      this.voices.set(name, list);
    } catch (err) {
      console.error(`[audio] sfx "${name}" failed`, err);
    }
  }

  /** Crossfades (~1 s) from the current track; no-op if the same track is already playing. */
  playMusic(track: MusicTrack): void {
    if (!(track in TRACKS)) {
      console.warn(`[audio] unknown music track "${String(track)}"`);
      return;
    }
    this.wantedTrack = track;
    this.syncMusic();
  }

  stopMusic(fadeSeconds = 1): void {
    this.wantedTrack = null;
    this.fadeOutCurrent(Math.max(0.03, finiteOr(fadeSeconds, 1)));
  }

  /** One-shot musical sting; ducks the music while it plays; resolves when finished (resolves immediately if audio not ready or music disabled). */
  playJingle(name: Jingle): Promise<void> {
    const ctx = this.ctx;
    const kit = this.kit;
    const mixer = this.mixer;
    const def = JINGLES[name];
    if (!this.settings.music || !ctx || !kit || !mixer || !def || !this.canSchedule(ctx)) return Promise.resolve();
    try {
      this.endJingle(true);
      const song = compileSong(def);
      const start = ctx.currentTime + 0.04;
      const player = new SongPlayer(kit, song, mixer.jingle, start);
      mixer.duck(start);
      return new Promise<void>((resolve) => {
        // Wall-clock safety net: a game awaiting a jingle must never hang on a stalled context.
        const fallback = setTimeout(() => {
          if (this.jingle?.player === player) this.endJingle(true);
        }, (song.duration + 2.5) * 1000);
        this.jingle = { player, resolve, fallback };
        this.ensureTimer();
        this.tick();
      });
    } catch (err) {
      console.error(`[audio] jingle "${name}" failed`, err);
      return Promise.resolve();
    }
  }

  /**
   * Sound of the DGS logo intro, synced to the 4 s logo video: call it when the video
   * starts playing. Follows the SFX setting. Returns a function that cuts it (skip).
   */
  playLogoSting(): () => void {
    const ctx = this.ctx;
    const kit = this.kit;
    const mixer = this.mixer;
    if (!this.settings.sfx || !ctx || !kit || !mixer || !this.canSchedule(ctx)) return () => undefined;
    try {
      const voice = spawnLogoSting(kit, ctx.currentTime + SCHEDULE_LEAD, mixer.sfx, mixer.reverb);
      return () => voice.kill(ctx.currentTime);
    } catch (err) {
      console.error('[audio] logo sting failed', err);
      return () => undefined;
    }
  }

  /** Pause menu: music muffled through a lowpass sweep + lowered, not stopped. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (this.ctx && this.mixer) this.mixer.setPaused(paused, this.ctx.currentTime);
    this.applyThruster();
  }

  /** Continuous rocket-thruster rumble (filtered noise), 0 = silent, 1 = full. Smoothly ramped. */
  setThruster(intensity: number): void {
    this.thrust = clamp(finiteOr(intensity, 0), 0, 1);
    this.applyThruster();
  }

  get musicEnabled(): boolean {
    return this.settings.music;
  }

  set musicEnabled(v: boolean) {
    if (this.settings.music === v) return;
    this.settings.music = v;
    saveSettings(this.settings);
    if (this.ctx && this.mixer) this.mixer.setMusicEnabled(v, this.ctx.currentTime);
    if (v) {
      this.syncMusic();
    } else {
      this.endJingle(true);
      this.fadeOutCurrent(0.3);
    }
  }

  get sfxEnabled(): boolean {
    return this.settings.sfx;
  }

  set sfxEnabled(v: boolean) {
    if (this.settings.sfx === v) return;
    this.settings.sfx = v;
    saveSettings(this.settings);
    const ctx = this.ctx;
    if (ctx && this.mixer) {
      this.mixer.setSfxEnabled(v, ctx.currentTime);
      if (!v) {
        const now = ctx.currentTime;
        for (const list of this.voices.values()) for (const voice of list) voice.kill(now);
        this.voices.clear();
      }
    }
    this.applyThruster();
  }

  toggleMusic(): boolean {
    this.musicEnabled = !this.musicEnabled;
    return this.musicEnabled;
  }

  toggleSfx(): boolean {
    this.sfxEnabled = !this.sfxEnabled;
    return this.sfxEnabled;
  }

  // -------------------------------------------------------------------------

  private create(): AudioContext | null {
    const Ctor = window.AudioContext ?? (window as Window & WebkitWindow).webkitAudioContext;
    if (!Ctor) {
      this.unavailable = true;
      console.warn('[audio] Web Audio API is not available: running silent');
      return null;
    }
    try {
      const ctx = new Ctor({ latencyHint: 'interactive' });
      const kit = createKit(ctx);
      const mixer = new Mixer(kit, ctx.destination);
      const now = ctx.currentTime;
      mixer.setSfxEnabled(this.settings.sfx, now);
      mixer.setMusicEnabled(this.settings.music, now);
      mixer.setPaused(this.paused, now);
      this.ctx = ctx;
      this.kit = kit;
      this.mixer = mixer;
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
      return ctx;
    } catch (err) {
      this.unavailable = true;
      console.warn('[audio] could not create the AudioContext: running silent', err);
      return null;
    }
  }

  /** While a resume() is in flight, scheduling is fine: it plays a few ms later. */
  private canSchedule(ctx: AudioContext): boolean {
    return ctx.state === 'running' || (ctx.state === 'suspended' && this.resumePending);
  }

  /**
   * Hidden tabs get their timers throttled to ~1 Hz, which would turn the music into
   * stutter. Suspending the context freezes the audio clock instead, so the
   * sequencer resumes seamlessly when the tab comes back.
   */
  private readonly onVisibility = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    if (document.hidden) {
      if (ctx.state === 'running') {
        this.hiddenSuspend = true;
        ctx.suspend().catch((err: unknown) => console.warn('[audio] suspend() failed', err));
      }
    } else if (this.hiddenSuspend) {
      this.hiddenSuspend = false;
      ctx.resume().catch((err: unknown) => console.warn('[audio] resume() after tab switch failed', err));
    }
  };

  private syncMusic(): void {
    const ctx = this.ctx;
    const kit = this.kit;
    const mixer = this.mixer;
    if (!ctx || !kit || !mixer || !this.canSchedule(ctx)) return;
    const want = this.settings.music ? this.wantedTrack : null;
    if (want === null) {
      this.fadeOutCurrent(0.3);
      return;
    }
    if (this.current && this.currentTrack === want && !this.current.stopping) return;
    try {
      const now = ctx.currentTime;
      const start = now + 0.05;
      const song = compileSong(TRACKS[want]);
      const crossfade = this.current !== null;
      const next = new SongPlayer(kit, song, mixer.music, start, crossfade ? 0 : 1);
      if (this.current) {
        this.current.fadeOut(now, CROSSFADE);
        this.fading.push(this.current);
        next.fadeIn(start, CROSSFADE);
      }
      this.current = next;
      this.currentTrack = want;
      this.ensureTimer();
      this.tick();
    } catch (err) {
      console.error(`[audio] could not start music "${want}"`, err);
    }
  }

  private fadeOutCurrent(fade: number): void {
    const ctx = this.ctx;
    if (!this.current || !ctx) {
      this.current = null;
      this.currentTrack = null;
      return;
    }
    this.current.fadeOut(ctx.currentTime, fade);
    this.fading.push(this.current);
    this.current = null;
    this.currentTrack = null;
  }

  private endJingle(cut: boolean): void {
    const j = this.jingle;
    if (!j) return;
    this.jingle = null;
    clearTimeout(j.fallback);
    const ctx = this.ctx;
    if (ctx) {
      const now = ctx.currentTime;
      if (cut) j.player.fadeOut(now, 0.06);
      this.retired.push({ player: j.player, at: now + (cut ? 0.1 : JINGLE_TAIL) });
      this.mixer?.unduck(now);
      this.ensureTimer();
    } else {
      j.player.dispose();
    }
    j.resolve();
  }

  private applyThruster(): void {
    const ctx = this.ctx;
    const kit = this.kit;
    const mixer = this.mixer;
    if (!ctx || !kit || !mixer) return;
    const target = this.settings.sfx && !this.paused ? this.thrust : 0;
    if (!this.thruster) {
      if (target <= 0 || !this.canSchedule(ctx)) return;
      try {
        this.thruster = new Thruster(kit, mixer.sfx, mixer.reverb);
      } catch (err) {
        console.error('[audio] thruster setup failed', err);
        return;
      }
    }
    this.thruster.set(target, ctx.currentTime);
  }

  private reapVoices(now: number): void {
    for (const [name, list] of this.voices) {
      let i = 0;
      // Lists are in start order, so finished voices cluster at the front.
      while (i < list.length && list[i].end < now - 0.25) {
        list[i].dispose();
        i++;
      }
      if (i > 0) list.splice(0, i);
      if (list.length === 0) this.voices.delete(name);
    }
  }

  private enforceGlobalCap(now: number): void {
    let total = 0;
    for (const list of this.voices.values()) total += list.length;
    while (total >= MAX_VOICES) {
      let oldestList: Voice[] | null = null;
      for (const list of this.voices.values()) {
        if (list.length > 0 && (!oldestList || list[0].t < oldestList[0].t)) oldestList = list;
      }
      if (!oldestList) return;
      oldestList.shift()?.kill(now);
      total--;
    }
  }

  private ensureTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(this.tick, TICK_MS);
  }

  private readonly tick = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (this.current) {
      try {
        this.current.pump(now);
      } catch (err) {
        console.error('[audio] music sequencer failed; stopping track', err);
        this.current.dispose();
        this.current = null;
        this.currentTrack = null;
      }
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const p = this.fading[i];
      if (p.isOver(now)) {
        p.dispose();
        this.fading.splice(i, 1);
      } else {
        this.pumpSafely(p, now);
      }
    }
    const j = this.jingle;
    if (j) {
      this.pumpSafely(j.player, now);
      if (j.player.isOver(now)) this.endJingle(false);
    }
    for (let i = this.retired.length - 1; i >= 0; i--) {
      if (now >= this.retired[i].at) {
        this.retired[i].player.dispose();
        this.retired.splice(i, 1);
      }
    }
    if (!this.current && this.fading.length === 0 && !this.jingle && this.retired.length === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  };

  private pumpSafely(p: SongPlayer, now: number): void {
    try {
      p.pump(now);
    } catch (err) {
      console.error(`[audio] sequencer failed for "${p.name}"`, err);
      p.fadeOut(now, 0.05);
    }
  }
}

export const audio: AudioEngine = new AudioEngine();
