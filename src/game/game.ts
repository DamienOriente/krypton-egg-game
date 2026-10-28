import { VIEW_H, VIEW_W } from '../config';
import { TAU, clamp, easeOutBack, pad, rand } from '../core/math';
import { input } from '../core/input';
import { audio, type MusicTrack } from '../audio/audio';
import { background, titleBackground } from '../render/background';
import { drawGlow, roundRectPath, type Ctx } from '../render/canvas';
import { drawText, STYLE, textWidth } from '../render/font';
import { Particles } from '../render/particles';
import { LEVELS } from '../levels/levels';
import { Boss } from './boss';
import { CreditsScreen } from './credits';
import { IntroScreen } from './intro';
import { Play } from './play';
import { STAGES, Session, codeAfterBoss, loadScores, recordScore, stageForCode, type ScoreEntry } from './session';
import { TitleScreen, type MenuItem } from './title';

type Screen = 'intro' | 'title' | 'code' | 'play' | 'reveal' | 'gameover' | 'victory' | 'credits';

const STEP = 1 / 120;
const GAME_TRACKS: MusicTrack[] = ['game1', 'game2', 'game3'];

export class Game {
  private screen: Screen = 'intro';
  private readonly intro = new IntroScreen();
  private credits: CreditsScreen | null = null;
  private warmed = false;
  private readonly title = new TitleScreen();
  private session: Session | null = null;
  private play: Play | null = null;
  private paused = false;
  private pausedAt = 0;
  private pauseSel = 0;
  private acc = 0;
  private t = 0;
  private screenT = 0;
  private scores: ScoreEntry[] = loadScores();
  private code = '';
  private codeShake = 0;
  private revealCode = '';
  private rank = -1;
  private readonly fx = new Particles();
  private victoryEgg: Boss | null = null;

  constructor(private readonly ctx: Ctx) {
    document.documentElement.dataset.screen = this.screen;
    input.onLockChange = (locked) => {
      if (!locked && this.screen === 'play' && !this.paused && this.play && !this.play.gameOver) this.setPaused(true);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.screen === 'play' && !this.paused) this.setPaused(true);
    });
  }

  /** Letter keys are text input on the code screen, not shortcuts. */
  get typing(): boolean {
    return this.screen === 'code';
  }

  /** Runs synchronously inside a user gesture: the only place where audio unlock and pointer lock are allowed. */
  onGesture(): void {
    const wasReady = audio.ready;
    audio.unlock();
    if (!wasReady && audio.ready && this.screen === 'title') audio.playMusic('title');
    if (this.screen === 'play') {
      const resuming = this.paused && this.pauseItems()[this.pauseHover()]?.id === 'resume';
      if (!this.paused || resuming) input.requestLock();
    }
  }

  // -------------------------------------------------------------------------

  frame(dt: number): void {
    this.t += dt;
    this.screenT += dt;
    if (!this.typing) {
      // In a running game M multiplies the balls (Play.frameInput); it toggles the music everywhere else.
      if (input.keyPressed('m') && !(this.screen === 'play' && !this.paused)) audio.toggleMusic();
      if (input.keyPressed('n')) audio.toggleSfx();
    }

    switch (this.screen) {
      case 'intro':
        this.updateIntro();
        break;
      case 'title':
        this.updateTitle(dt);
        break;
      case 'code':
        this.updateCode(dt);
        break;
      case 'play':
        this.updatePlay(dt);
        break;
      case 'reveal':
      case 'gameover':
      case 'victory':
        this.updateEndScreens(dt);
        break;
      case 'credits':
        this.credits!.update(dt);
        if (this.credits!.done) this.toTitle();
        break;
    }
    this.render();
  }

  private updateIntro(): void {
    if (input.anyPressed) this.intro.onInput();
    this.intro.update();
    if (!this.warmed && (this.intro.still || this.intro.done)) {
      // Title and first playfield textures (per-pixel wood) take ~150 ms: build them on a still frame.
      this.warmed = true;
      titleBackground();
      background(0);
    }
    if (this.intro.done) {
      audio.playMusic('title');
      this.go('title');
    }
  }

  private go(screen: Screen): void {
    this.screen = screen;
    this.screenT = 0;
    // Read by the desktop smoke test (electron/main.js) to know when the title is up.
    document.documentElement.dataset.screen = screen;
  }

  // ----------------------------------------------------------------- title

  private titleItems(): MenuItem[] {
    return [
      { id: 'play', label: 'JOUER' },
      { id: 'code', label: 'CODE SECTEUR' },
      { id: 'credits', label: 'CREDITS' },
      { id: 'music', label: `MUSIQUE : ${audio.musicEnabled ? 'OUI' : 'NON'}` },
      { id: 'sfx', label: `SONS : ${audio.sfxEnabled ? 'OUI' : 'NON'}` },
      { id: 'fullscreen', label: 'PLEIN ECRAN' },
    ];
  }

  private updateTitle(dt: number): void {
    this.title.update(dt);
    const items = this.titleItems();
    if (input.pointerMoved) {
      const h = this.title.hitTest(input.pointerX, input.pointerY, items);
      if (h >= 0 && h !== this.title.selected) {
        this.title.selected = h;
        audio.play('menuMove');
      }
    }
    if (input.wasPressed('ArrowDown', 'KeyS')) this.moveSel(1, items.length);
    if (input.wasPressed('ArrowUp', 'KeyW', 'KeyZ')) this.moveSel(-1, items.length);
    const click = input.mousePressed(0) && this.title.hitTest(input.pointerX, input.pointerY, items) >= 0;
    if (click || input.wasPressed('Enter', 'Space')) this.activateTitle(items[this.title.selected]!.id);
  }

  private moveSel(d: number, n: number): void {
    this.title.selected = (this.title.selected + d + n) % n;
    audio.play('menuMove');
  }

  private activateTitle(id: string): void {
    audio.play('menuSelect');
    switch (id) {
      case 'play':
        this.startGame(0);
        break;
      case 'code':
        this.code = '';
        this.go('code');
        break;
      case 'credits':
        this.startCredits();
        break;
      case 'music':
        audio.toggleMusic();
        if (audio.musicEnabled) audio.playMusic('title');
        break;
      case 'sfx':
        audio.toggleSfx();
        break;
      case 'fullscreen':
        toggleFullscreen();
        break;
    }
  }

  private updateCode(dt: number): void {
    this.title.update(dt);
    this.codeShake = Math.max(0, this.codeShake - dt * 3);
    for (const ch of input.typed) {
      if (ch === '\b') this.code = this.code.slice(0, -1);
      else if (ch === '\n') this.submitCode();
      else if (/^[a-z]$/i.test(ch) && this.code.length < 4) {
        this.code += ch.toUpperCase();
        audio.play('menuMove', { pitch: this.code.length * 2 });
      }
    }
    if (input.wasPressed('Escape') || input.mousePressed(2)) {
      audio.play('menuMove', { pitch: -5 });
      this.go('title');
    }
  }

  private submitCode(): void {
    const stage = stageForCode(this.code);
    if (stage === null) {
      audio.play('codeBad');
      this.codeShake = 1;
      this.code = '';
      return;
    }
    audio.play('codeOk');
    this.startGame(stage);
  }

  // ------------------------------------------------------------------ play

  private startGame(stageIndex: number): void {
    this.session = new Session(stageIndex);
    this.startStage();
  }

  private startStage(): void {
    const s = this.session!;
    const stage = s.stage;
    const def = stage.kind === 'level' ? (LEVELS[stage.level - 1] ?? null) : null;
    this.play = new Play(s, def);
    this.paused = false;
    this.acc = 0;
    this.go('play');
    audio.setPaused(false);
    audio.playMusic(stage.kind === 'boss' ? 'boss' : GAME_TRACKS[(stage.level - 1) % GAME_TRACKS.length]!);
  }

  private pauseItems(): MenuItem[] {
    return [
      { id: 'resume', label: 'CONTINUER' },
      { id: 'music', label: `MUSIQUE : ${audio.musicEnabled ? 'OUI' : 'NON'}` },
      { id: 'sfx', label: `SONS : ${audio.sfxEnabled ? 'OUI' : 'NON'}` },
      { id: 'quit', label: 'QUITTER' },
    ];
  }

  private pauseItemBounds(i: number): { x: number; y: number; w: number; h: number } {
    const w = 900;
    return { x: VIEW_W / 2 - w / 2, y: 600 + i * 110 - 20, w, h: 7 * STYLE.medium.size + 40 };
  }

  private pauseHover(): number {
    for (let i = 0; i < this.pauseItems().length; i++) {
      const b = this.pauseItemBounds(i);
      if (input.pointerX >= b.x && input.pointerX <= b.x + b.w && input.pointerY >= b.y && input.pointerY <= b.y + b.h) return i;
    }
    return -1;
  }

  private setPaused(p: boolean): void {
    if (this.paused === p) return;
    this.paused = p;
    this.pausedAt = this.t;
    this.pauseSel = 0;
    audio.setPaused(p);
    audio.play(p ? 'pause' : 'unpause');
    audio.setThruster(0);
    audio.setQuake(0);
    if (p) input.exitLock();
  }

  private updatePlay(dt: number): void {
    const play = this.play!;
    if (this.paused) {
      const items = this.pauseItems();
      if (input.pointerMoved) {
        const h = this.pauseHover();
        if (h >= 0 && h !== this.pauseSel) {
          this.pauseSel = h;
          audio.play('menuMove');
        }
      }
      if (input.wasPressed('ArrowDown', 'KeyS')) this.pauseSel = (this.pauseSel + 1) % items.length;
      if (input.wasPressed('ArrowUp', 'KeyW', 'KeyZ')) this.pauseSel = (this.pauseSel + items.length - 1) % items.length;
      const click = input.mousePressed(0) && this.pauseHover() >= 0;
      // Escape that released the pointer lock may also arrive as a keydown: don't let it unpause instantly.
      if (input.wasPressed('Escape') && this.t - this.pausedAt > 0.3) this.setPaused(false);
      else if (click || input.wasPressed('Enter', 'Space')) {
        const id = items[this.pauseSel]!.id;
        audio.play('menuSelect');
        if (id === 'resume') this.setPaused(false);
        else if (id === 'music') audio.toggleMusic();
        else if (id === 'sfx') audio.toggleSfx();
        else if (id === 'quit') this.toTitle();
      }
      input.consumeMotion();
      return;
    }
    if (input.wasPressed('Escape')) {
      this.setPaused(true);
      return;
    }

    play.frameInput(dt);
    this.acc += dt;
    while (this.acc >= STEP) {
      play.update(STEP);
      this.acc -= STEP;
    }

    if (play.gameOver) {
      this.rank = recordScore(this.session!.score, this.session!.levelNumber);
      this.scores = loadScores();
      input.exitLock();
      audio.stopMusic(0.5);
      void audio.playJingle('gameOver');
      this.go('gameover');
    } else if (play.done) {
      const s = this.session!;
      const stage = s.stage;
      if (stage.kind === 'boss') {
        const code = codeAfterBoss(stage.tier);
        if (code && s.stageIndex + 1 < STAGES.length) {
          this.revealCode = code;
          input.exitLock();
          // Sector freed: the triumphant theme rises under the reveal sting.
          audio.playMusic('victory');
          void audio.playJingle('codeReveal');
          this.go('reveal');
          return;
        }
        this.rank = recordScore(s.score, 60);
        this.scores = loadScores();
        input.exitLock();
        audio.playMusic('victory');
        this.victoryEgg = new Boss(6);
        this.victoryEgg.phase = 'fight';
        this.victoryEgg.x = VIEW_W / 2;
        this.victoryEgg.y = 760;
        this.go('victory');
        return;
      }
      s.stageIndex++;
      this.startStage();
    }
  }

  private startCredits(): void {
    this.credits = new CreditsScreen();
    input.exitLock();
    audio.playMusic('victory');
    this.go('credits');
  }

  private toTitle(): void {
    this.credits = null;
    this.paused = false;
    audio.setPaused(false);
    audio.setThruster(0);
    audio.setQuake(0);
    input.exitLock();
    this.play = null;
    this.session = null;
    this.scores = loadScores();
    audio.playMusic('title');
    this.go('title');
  }

  private updateEndScreens(dt: number): void {
    this.fx.update(dt);
    if (this.screen === 'victory') {
      this.title.update(dt);
      this.victoryEgg?.animate(dt);
      if (Math.random() < dt * 6)
        this.fx.explosion(rand(300, VIEW_W - 300), rand(200, 900), rand(0.4, 1), ['#ffd060', '#5aff5a', '#3fe0ff', '#ff4fd0'][Math.floor(Math.random() * 4)]);
    }
    if (this.screen === 'gameover') this.play?.update(STEP * Math.min(1, dt / STEP) * 0.25);
    const ready = this.screenT > 1.5;
    // The victory screen rolls into the end credits on its own after a while.
    if (this.screen === 'victory' && this.screenT > 14) {
      this.startCredits();
      return;
    }
    if (ready && (input.mousePressed(0) || input.wasPressed('Enter', 'Space'))) {
      audio.play('menuSelect');
      if (this.screen === 'reveal') {
        this.session!.stageIndex++;
        this.startStage();
      } else if (this.screen === 'victory') this.startCredits();
      else this.toTitle();
    }
  }

  // ---------------------------------------------------------------- render

  private render(): void {
    const ctx = this.ctx;
    switch (this.screen) {
      case 'intro':
        this.intro.render(ctx);
        break;
      case 'title':
        this.title.render(ctx, this.titleItems(), this.scores, input.pointerX, audio.ready);
        break;
      case 'code':
        this.title.render(ctx, this.titleItems(), this.scores, input.pointerX, audio.ready);
        this.renderCode(ctx);
        break;
      case 'play':
        this.play!.render(ctx);
        if (this.paused) this.renderPause(ctx);
        break;
      case 'gameover':
        this.play?.render(ctx);
        this.renderGameOver(ctx);
        break;
      case 'reveal':
        this.play?.render(ctx);
        this.renderReveal(ctx);
        break;
      case 'victory':
        this.renderVictory(ctx);
        break;
      case 'credits':
        this.credits!.render(ctx);
        break;
    }
  }

  private dim(ctx: Ctx, a: number): void {
    ctx.fillStyle = `rgba(2,4,10,${a})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  private panel(ctx: Ctx, w: number, h: number, y = VIEW_H / 2 - h / 2): void {
    const x = VIEW_W / 2 - w / 2;
    roundRectPath(ctx, x, y, w, h, 40);
    ctx.fillStyle = 'rgba(6,12,26,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,200,255,0.7)';
    ctx.lineWidth = 3;
    ctx.stroke();
    roundRectPath(ctx, x + 10, y + 10, w - 20, h - 20, 32);
    ctx.strokeStyle = 'rgba(40,200,255,0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private renderCode(ctx: Ctx): void {
    this.dim(ctx, 0.6);
    this.panel(ctx, 1100, 620);
    const cx = VIEW_W / 2;
    drawText(ctx, 'CODE SECTEUR', cx, 470, STYLE.gold, 'center');
    const shake = Math.sin(this.screenT * 60) * 24 * this.codeShake;
    const slotW = 150;
    const gap = 40;
    const total = slotW * 4 + gap * 3;
    for (let i = 0; i < 4; i++) {
      const x = cx - total / 2 + i * (slotW + gap) + shake;
      const y = 600;
      roundRectPath(ctx, x, y, slotW, 180, 20);
      ctx.fillStyle = '#02050c';
      ctx.fill();
      ctx.strokeStyle = i === this.code.length ? `rgba(255,190,60,${0.5 + 0.5 * Math.sin(this.t * 8)})` : 'rgba(40,200,255,0.6)';
      ctx.lineWidth = 4;
      ctx.stroke();
      const ch = this.code[i];
      if (ch) drawText(ctx, ch, x + slotW / 2, y + 34, STYLE.big, 'center');
    }
    drawText(ctx, 'TAPEZ LE CODE PUIS ENTREE  -  ECHAP : RETOUR', cx, 860, STYLE.small, 'center', 0.8);
  }

  private renderPause(ctx: Ctx): void {
    this.dim(ctx, 0.62);
    this.panel(ctx, 1100, 720, 380);
    drawText(ctx, 'PAUSE', VIEW_W / 2, 440, STYLE.big, 'center');
    this.pauseItems().forEach((it, i) => {
      const sel = i === this.pauseSel;
      drawText(ctx, sel ? `> ${it.label} <` : it.label, VIEW_W / 2, 600 + i * 110, sel ? STYLE.gold : STYLE.medium, 'center', sel ? 1 : 0.75);
    });
  }

  private renderGameOver(ctx: Ctx): void {
    const k = clamp(this.screenT / 0.8, 0, 1);
    this.dim(ctx, 0.7 * k);
    const s = this.session!;
    const scale = 0.4 + 0.6 * easeOutBack(k);
    ctx.save();
    ctx.translate(VIEW_W / 2, 540);
    ctx.scale(scale, scale);
    drawText(ctx, 'GAME OVER', 0, -77, { ...STYLE.title, top: '#ffd0c8', bottom: '#ff2a1a', glow: '#ff1a0a' }, 'center', k);
    ctx.restore();
    drawText(ctx, `SCORE  ${pad(s.score, 7)}`, VIEW_W / 2, 720, STYLE.green, 'center', k);
    drawText(ctx, `NIVEAU ATTEINT  ${pad(s.levelNumber, 2)}`, VIEW_W / 2, 820, STYLE.medium, 'center', k);
    if (s.score > s.startHigh) drawText(ctx, 'NOUVEAU RECORD !', VIEW_W / 2, 930, STYLE.gold, 'center', 0.6 + 0.4 * Math.sin(this.t * 6));
    else if (this.rank > 0) drawText(ctx, `CLASSE ${this.rank + 1}E`, VIEW_W / 2, 930, STYLE.pink, 'center');
    if (this.screenT > 1.5) drawText(ctx, 'CLIC POUR CONTINUER', VIEW_W / 2, 1080, STYLE.small, 'center', 0.5 + 0.5 * Math.sin(this.t * 4));
  }

  private renderReveal(ctx: Ctx): void {
    const k = clamp(this.screenT / 0.6, 0, 1);
    this.dim(ctx, 0.75 * k);
    this.panel(ctx, 1560, 760);
    const cx = VIEW_W / 2;
    drawText(ctx, 'SECTEUR LIBERE', cx, 420, STYLE.gold, 'center', k);
    drawText(ctx, 'CODE DU SECTEUR SUIVANT', cx, 540, STYLE.small, 'center', k);
    const reveal = Math.floor(clamp((this.screenT - 0.6) / 0.25, 0, 4));
    const total = this.revealCode.length * textWidth('W', STYLE.title) + (this.revealCode.length - 1) * 2 * STYLE.title.size;
    let x = cx - total / 2;
    for (let i = 0; i < this.revealCode.length; i++) {
      const ch = i < reveal ? this.revealCode[i]! : String.fromCharCode(65 + Math.floor(Math.random() * 26));
      const w = textWidth(ch, STYLE.title);
      drawText(ctx, ch, x + w / 2, 640, i < reveal ? STYLE.title : { ...STYLE.title, top: '#6a7a8a', bottom: '#2a3a4a', glow: '#000000' }, 'center', k);
      x += w + 2 * STYLE.title.size;
    }
    drawGlow(ctx, '#ff9a20', cx, 720, 500, 0.2 * k);
    drawText(ctx, 'NOTEZ-LE : IL PERMET DE REPRENDRE ICI', cx, 880, STYLE.small, 'center', k * 0.85);
    if (this.screenT > 1.5) drawText(ctx, 'CLIC POUR CONTINUER', cx, 990, STYLE.small, 'center', 0.5 + 0.5 * Math.sin(this.t * 4));
  }

  private renderVictory(ctx: Ctx): void {
    ctx.drawImage(titleBackground(), 0, 0);
    const egg = this.victoryEgg;
    const open = clamp((this.screenT - 1) / 3, 0, 1);
    const cx = VIEW_W / 2;
    // The egg splits open and the krypton core rises out of it.
    drawGlow(ctx, '#5aff5a', cx, 760, 400 + open * 700, 0.25 + open * 0.4);
    if (egg) {
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * open * 260, open * 60);
        ctx.translate(cx, 760);
        ctx.rotate(side * open * 0.35);
        ctx.translate(-cx, -760);
        // Clip after the transform so each half carries its own side of the jagged crack.
        const edge = side < 0 ? 0 : VIEW_W;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        for (let y = 420, i = 0; y <= 1100; y += 45, i++) ctx.lineTo(cx + (i % 2 ? 22 : -22), y);
        ctx.lineTo(cx, VIEW_H);
        ctx.lineTo(edge, VIEW_H);
        ctx.lineTo(edge, 0);
        ctx.closePath();
        ctx.clip();
        egg.render(ctx, cx);
        ctx.restore();
      }
    }
    const core = 760 - open * 220;
    drawGlow(ctx, '#ffffff', cx, core, 90 + open * 120, open);
    drawGlow(ctx, '#5aff5a', cx, core, 220 + open * 200, open * 0.8);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + this.t * 0.4;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.15 * open;
      ctx.strokeStyle = '#bfffbf';
      ctx.lineWidth = 30;
      ctx.beginPath();
      ctx.moveTo(cx, core);
      ctx.lineTo(cx + Math.cos(a) * 1600, core + Math.sin(a) * 1600);
      ctx.stroke();
      ctx.restore();
    }
    this.fx.render(ctx);
    drawText(ctx, 'FELICITATIONS !', cx, 110, STYLE.title, 'center');
    drawText(ctx, 'L OEUF KRYPTON EST VAINCU', cx, 330, STYLE.green, 'center');
    if (this.screenT > 3) {
      const s = this.session!;
      drawText(ctx, `SCORE FINAL  ${pad(s.score, 7)}`, cx, 1130, STYLE.gold, 'center');
      if (s.score > s.startHigh) drawText(ctx, 'NOUVEAU RECORD !', cx, 1230, STYLE.pink, 'center', 0.6 + 0.4 * Math.sin(this.t * 6));
      drawText(ctx, 'MERCI D AVOIR JOUE  -  CLIC POUR LE GENERIQUE', cx, 1340, STYLE.small, 'center', 0.5 + 0.5 * Math.sin(this.t * 3));
    }
  }
}

export function toggleFullscreen(): void {
  const el = document.documentElement;
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch((err: unknown) => console.warn('[fullscreen] exit failed', err));
  } else {
    void el.requestFullscreen().catch((err: unknown) => console.warn('[fullscreen] request refused', err));
  }
}
