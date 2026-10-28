import introUrl from '../assets/dgs-intro.mp4';
import { audio } from '../audio/audio';
import { VIEW_H, VIEW_W } from '../config';
import type { Ctx } from '../render/canvas';
import { drawText, STYLE } from '../render/font';

type Phase = 'boot' | 'starting' | 'playing' | 'done';

/** The click that starts the intro must not also skip it. */
const SKIP_GRACE = 0.35;
/** Without audio after a start request, play the logo silently rather than wait forever. */
const AUDIO_WAIT = 0.6;
/** Safety nets if the video never starts or stalls. */
const START_TIMEOUT = 2;
const MAX_PLAY = 6;
/** Electron unlocks audio within a few frames: don't flash the boot prompt there. */
const PROMPT_DELAY = 0.6;

/**
 * DGS logo intro: the logo video is drawn onto the game canvas while the engine plays
 * its synthesized sting (audio.playLogoSting), started on the video's `playing` event so
 * picture and sound stay in sync. Browsers only allow audio after a user gesture, so
 * until audio is running a "press start" boot screen waits for one.
 */
export class IntroScreen {
  phase: Phase = 'boot';
  private readonly video: HTMLVideoElement;
  private videoReady = false;
  private failed = false;
  private wantStart = false;
  /** Wall-clock start of the current phase: frame dt is clamped and can't time a video. */
  private since = performance.now();
  private stopSting: (() => void) | null = null;

  constructor() {
    const v = document.createElement('video');
    // The sound is synthesized live; a muted video is allowed to play everywhere.
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.addEventListener('canplaythrough', () => (this.videoReady = true), { once: true });
    v.addEventListener('error', () => {
      console.warn('[intro] logo video failed to load, skipping it', v.error);
      this.failed = true;
    });
    v.addEventListener('playing', () => this.onPlaying());
    v.addEventListener('ended', () => this.finish());
    v.src = introUrl;
    v.load();
    this.video = v;
  }

  get done(): boolean {
    return this.phase === 'done';
  }

  /**
   * True while the picture is static (boot prompt, or the held logo between the subtitle
   * reveal and the fade): the only safe moment for a blocking pre-computation.
   */
  get still(): boolean {
    const vt = this.video.currentTime;
    return (this.phase === 'boot' && this.elapsed > 1) || (this.phase === 'playing' && vt > 2.2 && vt < 3.1);
  }

  /** Seconds since the current phase began. */
  private get elapsed(): number {
    return (performance.now() - this.since) / 1000;
  }

  private enter(phase: Phase): void {
    this.phase = phase;
    this.since = performance.now();
  }

  /** Any click or key: starts the intro from the boot screen, skips it while it plays. */
  onInput(): void {
    if (this.phase === 'boot') this.wantStart = true;
    else if (this.phase === 'playing' && this.video.currentTime > SKIP_GRACE) this.skip();
  }

  update(): void {
    if (this.phase === 'done') return;
    if (this.failed) {
      this.finish();
      return;
    }
    switch (this.phase) {
      case 'boot':
        if (this.videoReady && (audio.ready || (this.wantStart && this.elapsed > AUDIO_WAIT))) this.start();
        else if (this.wantStart && !this.videoReady && this.elapsed > START_TIMEOUT) this.finish();
        break;
      case 'starting':
        if (this.elapsed > START_TIMEOUT) this.finish();
        break;
      case 'playing':
        // A hidden tab suspends the audio clock but not the video: they would drift apart.
        if (document.hidden || this.elapsed > MAX_PLAY) this.skip();
        break;
    }
  }

  private start(): void {
    this.enter('starting');
    this.video.currentTime = 0;
    this.video.play().catch((err: unknown) => {
      console.warn('[intro] logo video could not play, skipping it', err);
      this.finish();
    });
  }

  private onPlaying(): void {
    if (this.phase !== 'starting') return;
    this.enter('playing');
    this.stopSting = audio.playLogoSting();
  }

  private skip(): void {
    this.stopSting?.();
    this.finish();
  }

  private finish(): void {
    if (this.phase === 'done') return;
    this.enter('done');
    this.stopSting = null;
    this.video.pause();
  }

  render(ctx: Ctx): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const v = this.video;
    if ((this.phase === 'playing' || this.phase === 'starting') && v.readyState >= 2) {
      ctx.drawImage(v, 0, 0, VIEW_W, VIEW_H);
      if (this.phase === 'playing' && v.currentTime > 1) {
        drawText(ctx, 'CLIC : PASSER', VIEW_W - 60, VIEW_H - 70, STYLE.tiny, 'right', 0.3);
      }
    } else if (this.phase === 'boot' && this.elapsed > PROMPT_DELAY) {
      const a = this.wantStart ? 1 : 0.55 + 0.45 * Math.sin(this.elapsed * 4);
      drawText(ctx, 'CLIQUEZ POUR COMMENCER', VIEW_W / 2, VIEW_H / 2 - 40, STYLE.medium, 'center', a);
      drawText(ctx, 'OU APPUYEZ SUR UNE TOUCHE', VIEW_W / 2, VIEW_H / 2 + 60, STYLE.small, 'center', 0.5);
    }
  }
}
