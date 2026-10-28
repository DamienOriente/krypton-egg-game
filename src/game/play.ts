import {
  BALL_SPEED_MAX,
  BALL_SPEED_START,
  BRICK_H,
  BRICK_W,
  FIELD,
  PADDLE_H,
  PADDLE_W,
  PADDLE_Y,
  VIEW_H,
  VIEW_W,
} from '../config';
import { TAU, chance, circleRectHit, clamp, damp, easeOutBack, pick, rand } from '../core/math';
import { input } from '../core/input';
import { audio, type SfxName, type SfxOptions } from '../audio/audio';
import { GATE, background, drawGateClosed } from '../render/background';
import { createSurface, drawGlow, type Ctx, type Surface } from '../render/canvas';
import { drawText, STYLE, type TextStyle } from '../render/font';
import { Particles } from '../render/particles';
import { BRICK_COLORS, CAPSULE_H, CAPSULE_W, PADDLE_CAP, PILL, sprites } from '../render/sprites';
import type { LevelDef } from '../levels/types';
import { BrickField, type Brick } from './bricks';
import { Boss, type BossHost } from './boss';
import { InvaderWave, drawEnemy, drawShot, makeEnemy, updateEnemy, type Enemy, type EnemyKind, type Shot, type ShotKind } from './enemies';
import { drawHud } from './hud';
import { POWERS, rollPower, type Capsule, type PowerId } from './powerups';
import type { Session } from './session';

export type PlayPhase = 'intro' | 'play' | 'death' | 'bossDying' | 'clear';

interface Ball {
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  stuck: boolean;
  offset: number;
  stuckTime: number;
  alive: boolean;
  teleCd: number;
  trail: { x: number; y: number }[];
}

interface Paddle {
  x: number;
  y: number;
  w: number;
  targetX: number;
  targetY: number;
  dead: boolean;
  vy: number;
}

interface Laser {
  x: number;
  y: number;
  alive: boolean;
}

interface Banner {
  text: string;
  sub: string;
  t: number;
  life: number;
  style: TextStyle;
}

const SHIELD_Y = 1404;
const DEBRIS_COLORS = ['#6b4a2c', '#8a6238', '#a07a4a', '#7a8088', '#5a6068'];
const LASER_SPEED = 2300;
const CAPSULE_SPEED = 290;
const ROCKET_RANGE = 430;
const COMBO_SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const BALL_R = 13;
const BALL_R_BIG = 22;
/** Cap for the multi-ball power-up (unchanged) and for the M key (×3 per press: 1 → 3 → 9 → 27 → 81 → 243). */
const MULTI_POWER_MAX = 12;
const MULTI_KEY_MAX = 243;
const pan = (x: number): number => clamp((x - VIEW_W / 2) / (VIEW_W / 2), -1, 1) * 0.8;

export class Play implements BossHost {
  phase: PlayPhase = 'intro';
  phaseT = 0;
  time = 0;
  done = false;
  gameOver = false;
  readonly isBoss: boolean;
  readonly levelNumber: number;
  readonly levelName: string;
  readonly levelLabel: string;
  readonly field: BrickField;
  readonly particles = new Particles();
  readonly boss: Boss | null;
  private readonly bg: HTMLCanvasElement;
  private readonly paddle: Paddle;
  private balls: Ball[] = [];
  private capsules: Capsule[] = [];
  private lasers: Laser[] = [];
  private enemies: Enemy[] = [];
  private shots: Shot[] = [];
  private wave: InvaderWave | null = null;
  private waveTimer = 0;
  private readonly effects = new Map<PowerId, number>();
  private shakeAmt = 0;
  private bossMusicCut = false;
  private combo = 0;
  private spawnTimer = 9;
  private pendingSpawn: EnemyKind | null = null;
  private gateTimer = 0;
  private gateHold = 0;
  private gateOpen = 0;
  private laserCd = 0;
  private invuln = 0;
  private darkness = 0;
  private drunkK = 0;
  private clearBonus = 0;
  private clearPaid = 0;
  private tickTimer = 0;
  private banner: Banner | null = null;
  private launchedOnce = false;
  private darkSurf: Surface | null = null;
  private readonly tmp: Brick[] = [];

  constructor(
    private readonly session: Session,
    def: LevelDef | null,
  ) {
    const stage = session.stage;
    this.isBoss = stage.kind === 'boss';
    this.levelNumber = session.levelNumber;
    this.field = new BrickField(this.isBoss ? null : def, this.levelNumber);
    this.field.intro = this.isBoss ? 1 : 0;
    this.field.onRegen = (b) => {
      this.sfx('brickRegen', { pan: pan(b.x) });
      this.particles.flash(b.x + BRICK_W / 2, b.y + BRICK_H / 2, '#ff40f0', 90, 0.4);
    };
    this.field.regenBlocked = (b) =>
      this.balls.some((ball) => circleRectHit(ball.x, ball.y, this.ballR + 4, b.x, b.y, BRICK_W, BRICK_H) !== null);
    this.boss = stage.kind === 'boss' ? new Boss(stage.tier) : null;
    this.bg = background(this.isBoss ? 3 : (def?.background ?? 0), this.isBoss);
    this.levelName = this.boss ? this.boss.name : (def?.name ?? '');
    this.levelLabel = this.isBoss ? 'BOSS' : String(this.levelNumber).padStart(2, '0');
    this.paddle = {
      x: FIELD.x + FIELD.w / 2,
      y: PADDLE_Y,
      w: PADDLE_W.normal,
      targetX: FIELD.x + FIELD.w / 2,
      targetY: PADDLE_Y,
      dead: false,
      vy: 0,
    };
    this.balls = [this.newBall()];
    session.onExtraLife = () => {
      this.sfx('extraLife');
      this.showBanner('VIE BONUS !', '', STYLE.green, 1.6);
    };
    if (this.boss) {
      this.showBanner('ALERTE !', this.boss.name, STYLE.red, 3.2);
      void audio.playJingle('bossIntro');
    } else {
      this.showBanner(`NIVEAU ${this.levelLabel}`, this.levelName, STYLE.big, 2.6);
      void audio.playJingle('levelStart');
    }
  }

  // -------------------------------------------------------------------------
  // BossHost

  get paddleX(): number {
    return this.paddle.x;
  }
  get paddleY(): number {
    return this.paddle.y;
  }
  get paddleW(): number {
    return this.paddle.w;
  }
  get shielded(): boolean {
    return this.effects.has('shield') || this.invuln > 0;
  }

  /** Bottom barrier: the timed Bouclier power-up or the permanent one toggled with P. */
  private get barrierUp(): boolean {
    return this.session.barrier || this.effects.has('shield');
  }
  get enemyCount(): number {
    return this.enemies.length;
  }

  fireShot(kind: ShotKind, x: number, y: number, vx: number, vy: number, r: number): void {
    this.shots.push({ kind, x, y, vx, vy, r, t: 0, alive: true });
  }

  spawnEnemy(kind: EnemyKind, x: number, y: number): void {
    this.enemies.push(makeEnemy(kind, x, y));
  }

  dropCapsule(x: number, y: number): void {
    // Boss drops are always helpful: the player needs tools, not punishment.
    let id = rollPower(this.rollCtx());
    for (let i = 0; i < 8 && !POWERS[id].good; i++) id = rollPower(this.rollCtx());
    if (!POWERS[id].good) id = 'laser';
    this.capsules.push({ id, x, y, vy: CAPSULE_SPEED, t: 0, alive: true });
    this.sfx('powerupDrop', { pan: pan(x) });
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(40, this.shakeAmt + amount);
  }

  sfx(name: SfxName, opts?: SfxOptions): void {
    audio.play(name, opts);
  }

  killPaddle(): void {
    if (this.phase !== 'play' || this.paddle.dead || this.shielded) return;
    this.paddle.dead = true;
    const p = this.paddle;
    this.particles.explosion(p.x, p.y, 1.6, '#ff6a3a');
    this.particles.explosion(p.x - p.w / 3, p.y, 0.8, '#ffd040');
    this.particles.explosion(p.x + p.w / 3, p.y, 0.8, '#40c8ff');
    for (let i = 0; i < 4; i++) this.particles.brickBurst(p.x + rand(-p.w / 2, p.w / 2), p.y, pick(['#c8140e', '#93ab9e', '#ffcf3a']), 0, -1, 6);
    this.sfx('paddleDeath', { pan: pan(p.x) });
    this.sfx('bigExplosion', { pan: pan(p.x), volume: 0.8 });
    this.shake(30);
    for (const b of this.balls) b.alive = false;
    this.loseLife('RAQUETTE DETRUITE');
  }

  // -------------------------------------------------------------------------

  private rollCtx(): Parameters<typeof rollPower>[0] {
    return {
      level: this.levelNumber,
      hasEnemies: this.enemies.length > 0,
      isBoss: this.isBoss,
      ballCount: this.balls.length,
    };
  }

  private get ballR(): number {
    return this.effects.has('big') ? BALL_R_BIG : BALL_R;
  }

  private get baseSpeed(): number {
    return Math.min(BALL_SPEED_START + (this.levelNumber - 1) * 5, 1200);
  }

  private get maxSpeed(): number {
    return Math.min(BALL_SPEED_MAX, 1240 + this.levelNumber * 6);
  }

  private speedMult(): number {
    return this.effects.has('slow') ? 0.66 : this.effects.has('fast') ? 1.3 : 1;
  }

  private newBall(): Ball {
    return {
      x: this.paddle.x,
      y: this.paddle.y - PADDLE_H / 2 - BALL_R,
      dx: 0,
      dy: -1,
      speed: this.baseSpeed,
      stuck: true,
      offset: rand(-30, 30),
      stuckTime: 0,
      alive: true,
      teleCd: 0,
      trail: [],
    };
  }

  private showBanner(text: string, sub: string, style: TextStyle, life: number): void {
    this.banner = { text, sub, t: 0, life, style };
  }

  private addScore(points: number, x?: number, y?: number): void {
    const pts = points * (this.effects.has('double') ? 2 : 1);
    this.session.addScore(pts);
    if (x !== undefined && y !== undefined && pts >= 100)
      this.particles.text(x, y - 30, `+${pts}`, this.effects.has('double') ? STYLE.gold : { size: 4, top: '#ffffff', bottom: '#ffe08a', outline: true });
  }

  // -------------------------------------------------------------------------
  // Input (once per rendered frame)

  frameInput(dt: number): void {
    if (input.keyPressed('p')) this.toggleBarrier();
    if (input.keyPressed('m') && this.phase === 'play' && !this.paddle.dead) this.multiplyBalls();
    const p = this.paddle;
    const frozen = this.effects.has('freeze');
    const rocket = this.effects.has('rocket');
    const m = input.consumeMotion();
    if (!frozen && !p.dead) {
      if (input.locked) {
        p.targetX += m.dx;
        if (rocket) p.targetY += m.dy;
      } else if (input.pointerMoved || input.touchActive) {
        p.targetX = input.pointerX;
        if (rocket) p.targetY = input.pointerY;
      }
      const kb = 2000 * dt;
      if (input.isDown('ArrowLeft') || input.isDown('KeyA') || input.isDown('KeyQ')) p.targetX -= kb;
      if (input.isDown('ArrowRight') || input.isDown('KeyD')) p.targetX += kb;
      if (rocket) {
        if (input.isDown('ArrowUp') || input.isDown('KeyW') || input.isDown('KeyZ')) p.targetY -= kb * 0.6;
        if (input.isDown('ArrowDown') || input.isDown('KeyS')) p.targetY += kb * 0.6;
      }
    }
    const half = p.w / 2;
    p.targetX = clamp(p.targetX, FIELD.x + half, FIELD.right - half);
    p.targetY = rocket ? clamp(p.targetY, PADDLE_Y - ROCKET_RANGE, PADDLE_Y) : PADDLE_Y;

    if (this.phase !== 'play' && this.phase !== 'intro') return;
    const launch = input.mousePressed(0) || input.wasPressed('Space', 'Enter');
    const stuck = this.balls.some((b) => b.stuck && b.alive);
    if (launch && stuck && !p.dead && (this.phase === 'play' || this.phaseT > 1.3)) {
      if (this.phase === 'intro') this.beginPlay();
      this.launchBalls();
    } else {
      const firing = input.mouseDown(2) || ((input.mouseDown(0) || input.isDown('Space')) && !stuck);
      if (firing && this.effects.has('laser') && this.phase === 'play' && !p.dead) this.fireLasers();
    }
  }

  private beginPlay(): void {
    this.phase = 'play';
    this.phaseT = 0;
    this.field.intro = 1;
    if (this.levelNumber % 10 === 5 && !this.isBoss) this.startWave();
  }

  private startWave(): void {
    const l = this.levelNumber;
    const cols = l < 10 ? 6 : l < 30 ? 7 : l < 50 ? 8 : 9;
    const rows = l < 10 ? 2 : l < 50 ? 3 : 4;
    this.wave = new InvaderWave(cols, rows, 0.5 + l / 100);
    this.enemies.push(...this.wave.members);
    this.sfx('enemySpawn', { pitch: -5 });
    this.showBanner('INVASION !', 'ATTENTION AUX DAGUES', STYLE.pink, 2);
  }

  private launchBalls(): void {
    for (const b of this.balls) {
      if (!b.stuck) continue;
      b.stuck = false;
      const t = clamp(b.offset / (this.paddle.w / 2), -1, 1);
      const a = t * 0.9 + rand(-0.08, 0.08);
      b.dx = Math.sin(a);
      b.dy = -Math.cos(a);
      this.normalize(b);
      this.sfx('launch', { pan: pan(b.x) });
    }
    this.launchedOnce = true;
  }

  private fireLasers(): void {
    if (this.laserCd > 0) return;
    this.laserCd = 0.17;
    const p = this.paddle;
    const top = p.y - PADDLE_H / 2 - 18;
    for (const side of [-1, 1]) {
      const x = p.x + side * (p.w / 2 - PADDLE_CAP * 0.55);
      this.lasers.push({ x, y: top, alive: true });
      this.particles.flash(x, top, '#ff4040', 40, 0.1);
    }
    this.sfx('laser', { pan: pan(p.x), volume: 0.7 });
  }

  // -------------------------------------------------------------------------
  // Simulation (fixed step)

  update(dt: number): void {
    this.time += dt;
    this.phaseT += dt;
    this.particles.update(dt);
    this.field.update(dt);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 60);
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > this.banner.life) this.banner = null;
    }
    this.laserCd = Math.max(0, this.laserCd - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.darkness = damp(this.darkness, this.effects.has('dark') ? 1 : 0, 4, dt);
    this.drunkK = damp(this.drunkK, this.effects.has('drunk') ? 1 : 0, 3, dt);

    this.updatePaddle(dt);
    this.updateGate(dt);
    this.boss?.update(dt, this);

    switch (this.phase) {
      case 'intro':
        this.field.intro = Math.min(1, this.phaseT / 1.5);
        this.stickBalls();
        if (this.phaseT > 1.6 && (!this.boss || this.boss.vulnerable)) this.beginPlay();
        break;
      case 'play':
        this.updateEffects(dt);
        this.updateBalls(dt);
        this.updateFuses(dt);
        this.updateLasers(dt);
        this.updateCapsules(dt);
        this.updateEnemies(dt);
        this.updateShots(dt);
        if (this.phase === 'play') this.checkEnd();
        break;
      case 'death':
        this.updateEnemies(dt);
        this.updateShots(dt);
        if (this.phaseT > 2.1) {
          if (this.session.lives <= 0) this.gameOver = true;
          else this.respawn();
        }
        break;
      case 'bossDying':
        // The boss theme plays on through the explosions and cuts with the final blast.
        if (this.boss?.phase === 'dead' && !this.bossMusicCut) {
          this.bossMusicCut = true;
          audio.stopMusic(0.6);
        }
        if (this.boss && this.boss.phase === 'dead' && this.phaseT > 4.2) this.startClear();
        break;
      case 'clear':
        this.updateClear(dt);
        break;
    }
    audio.setThruster(this.effects.has('rocket') && this.phase === 'play' ? 0.35 + Math.min(0.65, Math.abs(this.paddle.vy) / 900) : 0);
    this.updateQuake(dt);
  }

  private updatePaddle(dt: number): void {
    const p = this.paddle;
    const target = this.effects.has('expand') ? PADDLE_W.large : this.effects.has('shrink') ? PADDLE_W.small : PADDLE_W.normal;
    p.w = damp(p.w, target, 9, dt);
    let tx = p.targetX;
    if (this.drunkK > 0.01) {
      // Beer: the paddle sways around where the player aims.
      tx += (Math.sin(this.time * 2.1) * 150 + Math.sin(this.time * 5.7) * 45) * this.drunkK;
    }
    if (!this.effects.has('freeze')) p.x = damp(p.x, tx, this.drunkK > 0.01 ? 7 : 40, dt);
    p.x = clamp(p.x, FIELD.x + p.w / 2, FIELD.right - p.w / 2);
    const prevY = p.y;
    p.y = damp(p.y, p.targetY, 14, dt);
    p.vy = (p.y - prevY) / dt;
    if (this.effects.has('rocket') && !p.dead && this.phase === 'play') {
      for (const side of [-1, 1]) {
        if (Math.random() < 0.7)
          this.particles.ember(p.x + side * (p.w / 2 - 40) + rand(-6, 6), p.y + PADDLE_H / 2 + 10, rand(-30, 30), rand(300, 520), pick(['#ffb040', '#ff6a1a', '#fff0a0']), rand(4, 8), rand(0.15, 0.3));
      }
    }
  }

  /** Boss earthquake: rumble loudness follows the same intensity as the camera and the debris. */
  private updateQuake(dt: number): void {
    const q = this.boss?.quake ?? 0;
    audio.setQuake(q);
    if (q < 0.2) return;
    let n = q * 45 * dt;
    while (n > 0) {
      if (Math.random() < n) {
        const x = rand(FIELD.x + 10, FIELD.right - 10);
        if (Math.random() < 0.25) this.particles.dust(x, FIELD.y + 8);
        else this.particles.debris(x, FIELD.y + 4, pick(DEBRIS_COLORS));
      }
      n -= 1;
    }
  }

  private updateGate(dt: number): void {
    if (this.pendingSpawn) {
      this.gateTimer -= dt;
      if (this.gateTimer <= 0) {
        const kind = this.pendingSpawn;
        this.pendingSpawn = null;
        const e = makeEnemy(kind, GATE.x + GATE.w / 2, FIELD.y - 30);
        e.entering = kind === 'ray' ? 0.5 : 0.9;
        if (kind === 'ray') e.vy = 120;
        this.enemies.push(e);
        this.sfx('enemySpawn', { pitch: kind === 'ray' ? 5 : 0 });
        this.gateHold = 0.9;
      }
    }
    this.gateHold = Math.max(0, this.gateHold - dt);
    const open = this.pendingSpawn !== null || this.gateHold > 0;
    this.gateOpen = damp(this.gateOpen, open ? 1 : 0, 7, dt);
  }

  private stickBalls(): void {
    const p = this.paddle;
    for (const b of this.balls) {
      if (!b.stuck) continue;
      b.offset = clamp(b.offset, -p.w / 2 + 10, p.w / 2 - 10);
      b.x = p.x + b.offset;
      b.y = p.y - PADDLE_H / 2 - this.ballR - 0.5;
    }
  }

  private updateEffects(dt: number): void {
    for (const [id, left] of this.effects) {
      const next = left - dt;
      if (next <= 0) {
        this.effects.delete(id);
        if (id === 'glue') this.launchBalls();
      } else this.effects.set(id, next);
    }
  }

  private updateBalls(dt: number): void {
    this.stickBalls();
    const fire = this.effects.has('fire');
    for (const b of this.balls) {
      if (!b.alive) continue;
      b.teleCd = Math.max(0, b.teleCd - dt);
      if (b.stuck) {
        b.stuckTime += dt;
        // Glue releases automatically so the game never stalls.
        if (this.effects.has('glue') && b.stuckTime > 3 && this.launchedOnce) this.launchBalls();
        continue;
      }
      b.speed = Math.min(this.maxSpeed, b.speed + 4 * dt);
      const v = b.speed * this.speedMult();
      const steps = Math.max(1, Math.ceil((v * dt) / 6));
      const h = dt / steps;
      for (let i = 0; i < steps && b.alive && !b.stuck; i++) {
        b.x += b.dx * v * h;
        b.y += b.dy * v * h;
        this.collideBall(b);
      }
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 12) b.trail.shift();
      if (fire && Math.random() < 0.6)
        this.particles.ember(b.x + rand(-6, 6), b.y + rand(-6, 6), rand(-40, 40), rand(-40, 40), pick(['#3fb8ff', '#bff3ff', '#ffffff']), rand(3, 6), rand(0.15, 0.3));
    }
    const before = this.balls.length;
    this.balls = this.balls.filter((b) => b.alive);
    if (before > 0 && this.balls.length === 0 && this.phase === 'play') {
      this.sfx('lifeLost');
      this.loseLife('BALLE PERDUE');
    }
  }

  private normalize(b: Ball): void {
    const len = Math.hypot(b.dx, b.dy) || 1;
    b.dx /= len;
    b.dy /= len;
    // Keep a minimum vertical component so the ball never ping-pongs sideways forever.
    const minY = 0.26;
    if (Math.abs(b.dy) < minY) {
      b.dy = (b.dy < 0 ? -1 : 1) * minY;
      b.dx = (b.dx < 0 ? -1 : 1) * Math.sqrt(1 - minY * minY);
    }
  }

  private collideBall(b: Ball): void {
    const r = this.ballR;
    // Walls (wooden frame).
    if (b.x - r < FIELD.x) {
      b.x = FIELD.x + r;
      b.dx = Math.abs(b.dx);
      this.sfx('wall', { pan: -0.8 });
      this.particles.sparks(b.x - r, b.y, '#ffd8a0', 3, 300);
    } else if (b.x + r > FIELD.right) {
      b.x = FIELD.right - r;
      b.dx = -Math.abs(b.dx);
      this.sfx('wall', { pan: 0.8 });
      this.particles.sparks(b.x + r, b.y, '#ffd8a0', 3, 300);
    }
    if (b.y - r < FIELD.y) {
      b.y = FIELD.y + r;
      b.dy = Math.abs(b.dy);
      this.sfx('wall', { pan: pan(b.x), pitch: 2 });
      this.particles.sparks(b.x, b.y - r, '#ffd8a0', 3, 300);
    }
    if (this.barrierUp && b.dy > 0 && b.y + r > SHIELD_Y) {
      b.y = SHIELD_Y - r;
      b.dy = -Math.abs(b.dy);
      this.sfx('shieldHit', { pan: pan(b.x) });
      this.particles.spray(b.x, SHIELD_Y, 0, -1, '#5ae8ff', 8);
      this.particles.ring(b.x, SHIELD_Y, '#5ae8ff', 60, 0.3);
    }
    if (b.y - r > VIEW_H) {
      b.alive = false;
      return;
    }

    this.collidePaddle(b, r);
    if (b.stuck) return;
    this.collideBricks(b, r);
    this.collideEnemies(b, r);
    if (this.boss) this.collideBoss(b, r);
    this.teleport(b);
  }

  private collidePaddle(b: Ball, r: number): void {
    const p = this.paddle;
    if (p.dead) return;
    const left = p.x - p.w / 2;
    const top = p.y - PADDLE_H / 2;
    const hit = circleRectHit(b.x, b.y, r, left, top, p.w, PADDLE_H);
    if (!hit) return;
    if (b.y < p.y) {
      if (b.dy <= 0) {
        // Rocket paddle catching up with a rising ball: just lift it.
        b.y = top - r - 0.5;
        return;
      }
      const t = clamp((b.x - p.x) / (p.w / 2), -1, 1);
      const ang = t * 1.05;
      b.dx = Math.sin(ang);
      b.dy = -Math.cos(ang);
      b.y = top - r - 0.5;
      this.normalize(b);
      this.combo = 0;
      b.speed = Math.min(this.maxSpeed, b.speed * 1.006);
      this.particles.sparks(b.x, top, '#c8fff0', 5, 380);
      if (this.effects.has('glue')) {
        b.stuck = true;
        b.offset = b.x - p.x;
        b.stuckTime = 0;
        this.sfx('glue', { pan: pan(b.x) });
      } else {
        this.sfx('paddle', { pan: pan(b.x), pitch: t * 2 });
      }
      if (this.effects.has('rocket') && p.vy < -200) b.speed = Math.min(this.maxSpeed, b.speed + 40);
    } else {
      b.dx = b.x < p.x ? -Math.abs(b.dx) : Math.abs(b.dx);
      b.x = b.x < p.x ? left - r - 0.5 : left + p.w + r + 0.5;
      this.sfx('paddle', { pan: pan(b.x), pitch: -4 });
    }
  }

  private collideBricks(b: Ball, r: number): void {
    const list = this.field.query(b.x - r, b.y - r, b.x + r, b.y + r, this.tmp);
    if (!list.length) return;
    const fire = this.effects.has('fire');
    let best: Brick | null = null;
    let bestHit: { nx: number; ny: number; depth: number } | null = null;
    for (const br of list) {
      const hit = circleRectHit(b.x, b.y, r, br.x + PILL.x, br.y + PILL.y, PILL.w, PILL.h);
      if (!hit) continue;
      if (fire && br.kind !== 'gold') {
        this.destroyBrick(br, b.dx, b.dy);
        continue;
      }
      if (!bestHit || hit.depth > bestHit.depth) {
        best = br;
        bestHit = hit;
      }
    }
    if (!best || !bestHit) return;
    const dot = b.dx * bestHit.nx + b.dy * bestHit.ny;
    if (dot < 0) {
      b.dx -= 2 * dot * bestHit.nx;
      b.dy -= 2 * dot * bestHit.ny;
    }
    b.x += bestHit.nx * bestHit.depth;
    b.y += bestHit.ny * bestHit.depth;
    this.normalize(b);
    this.hitBrick(best, this.effects.has('big') ? 2 : 1, b.x - bestHit.nx * r, b.y - bestHit.ny * r, bestHit.nx, bestHit.ny);
  }

  private hitBrick(br: Brick, dmg: number, hx: number, hy: number, nx: number, ny: number): void {
    if (br.kind === 'gold') {
      br.flash = 1;
      this.sfx('brickGold', { pan: pan(hx) });
      this.particles.spray(hx, hy, nx, ny, '#ffe080', 7);
      return;
    }
    if (br.kind === 'silver') {
      br.hp -= dmg;
      if (br.hp > 0) {
        br.flash = 1;
        this.field.markDirty();
        this.sfx('brickHit', { pan: pan(hx), pitch: (br.maxHp - br.hp) * 2 });
        this.particles.spray(hx, hy, nx, ny, '#ffffff', 9);
        this.addScore(20);
        return;
      }
    }
    this.destroyBrick(br, -nx, -ny);
  }

  private destroyBrick(br: Brick, dirX: number, dirY: number): void {
    if (!br.alive || br.kind === 'gold') return;
    this.field.kill(br);
    const cx = br.x + BRICK_W / 2;
    const cy = br.y + BRICK_H / 2;
    const pts = br.kind === 'silver' ? 100 * br.maxHp : br.kind === 'regen' ? 80 : br.kind === 'explosive' ? 120 : 50;
    this.addScore(pts, cx, cy);
    this.combo++;
    const pitch = COMBO_SCALE[Math.min(this.combo - 1, COMBO_SCALE.length - 1)]!;
    if (br.kind === 'silver') this.sfx('brickMetalBreak', { pan: pan(cx) });
    else if (br.kind === 'explosive') this.sfx('explosion', { pan: pan(cx) });
    else this.sfx('brick', { pan: pan(cx), pitch });
    this.particles.brickBurst(cx, cy, BRICK_COLORS[br.ch] ?? '#ffffff', dirX, dirY);
    if (br.kind === 'explosive') {
      this.particles.explosion(cx, cy, 0.9, '#ff8a20');
      this.shake(10);
      for (const n of this.field.neighbours(br)) if (n.kind !== 'gold' && n.fuse <= 0) n.fuse = 0.11;
    }
    if (!this.isBoss && this.capsules.length < 3 && chance(0.115 + (br.kind === 'silver' ? 0.07 : 0))) {
      const id = rollPower(this.rollCtx());
      this.capsules.push({ id, x: cx, y: cy, vy: CAPSULE_SPEED, t: 0, alive: true });
      this.sfx('powerupDrop', { pan: pan(cx) });
    }
  }

  private updateFuses(dt: number): void {
    for (const br of this.field.bricks) {
      if (br.alive && br.fuse > 0) {
        br.fuse -= dt;
        if (br.fuse <= 0) this.destroyBrick(br, rand(-1, 1), -1);
      }
    }
  }

  private collideEnemies(b: Ball, r: number): void {
    for (const e of this.enemies) {
      if (!e.alive || e.entering > 0) continue;
      const dx = b.x - e.x;
      const dy = b.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d >= e.r + r) continue;
      const nx = dx / (d || 1);
      const ny = dy / (d || 1);
      const dot = b.dx * nx + b.dy * ny;
      if (dot < 0) {
        b.dx -= 2 * dot * nx;
        b.dy -= 2 * dot * ny;
      }
      b.x = e.x + nx * (e.r + r + 0.5);
      b.y = e.y + ny * (e.r + r + 0.5);
      this.normalize(b);
      this.killEnemy(e);
    }
  }

  private collideBoss(b: Ball, r: number): void {
    const boss = this.boss!;
    for (const pl of boss.platePositions()) {
      const dx = b.x - pl.x;
      const dy = b.y - pl.y;
      const d = Math.hypot(dx, dy);
      if (d >= pl.r + r) continue;
      const nx = dx / (d || 1);
      const ny = dy / (d || 1);
      const dot = b.dx * nx + b.dy * ny;
      if (dot < 0) {
        b.dx -= 2 * dot * nx;
        b.dy -= 2 * dot * ny;
      }
      b.x = pl.x + nx * (pl.r + r + 0.5);
      b.y = pl.y + ny * (pl.r + r + 0.5);
      this.normalize(b);
      this.sfx('brickGold', { pan: pan(b.x), pitch: 3 });
      this.particles.spray(b.x, b.y, nx, ny, '#ffe080', 6);
    }
    const hit = boss.hit(b.x, b.y, r);
    if (!hit) return;
    const dot = b.dx * hit.nx + b.dy * hit.ny;
    if (dot < 0) {
      b.dx -= 2 * dot * hit.nx;
      b.dy -= 2 * dot * hit.ny;
    }
    b.x = hit.px + hit.nx * 0.5;
    b.y = hit.py + hit.ny * 0.5;
    this.normalize(b);
    if (boss.vulnerable) {
      const dmg = this.effects.has('fire') || this.effects.has('big') ? 2 : 1;
      this.addScore(50 * dmg);
      if (boss.damage(dmg, this, b.x - hit.nx * r, b.y - hit.ny * r)) this.onBossKilled();
    } else {
      this.sfx('brickGold', { pan: pan(b.x), pitch: -5 });
    }
  }

  private teleport(b: Ball): void {
    if (b.teleCd > 0) return;
    const tps = this.field.teleporters;
    for (const t of tps) {
      if (t.pair < 0) continue;
      if (Math.hypot(b.x - t.x, b.y - t.y) > 30) continue;
      const dest = tps[t.pair]!;
      this.particles.ring(t.x, t.y, '#30e0ff', 70, 0.35);
      b.x = dest.x + b.dx * 44;
      b.y = dest.y + b.dy * 44;
      b.teleCd = 0.5;
      b.trail.length = 0;
      this.particles.ring(dest.x, dest.y, '#ff8a30', 90, 0.4);
      this.particles.sparks(dest.x, dest.y, '#bff3ff', 12, 500);
      this.sfx('teleport', { pan: pan(dest.x) });
      return;
    }
  }

  private updateLasers(dt: number): void {
    for (const l of this.lasers) {
      if (!l.alive) continue;
      l.y -= LASER_SPEED * dt;
      if (l.y < FIELD.y) {
        l.alive = false;
        this.particles.sparks(l.x, FIELD.y + 4, '#ff8080', 3, 250);
        continue;
      }
      const hits = this.field.query(l.x - 3, l.y - 24, l.x + 3, l.y, this.tmp);
      const br = hits.find((h) => l.x > h.x + PILL.x && l.x < h.x + PILL.x + PILL.w);
      if (br) {
        l.alive = false;
        this.hitBrick(br, 1, l.x, br.y + BRICK_H, 0, 1);
        continue;
      }
      for (const e of this.enemies) {
        if (e.alive && e.entering <= 0 && Math.hypot(l.x - e.x, l.y - e.y) < e.r + 6) {
          l.alive = false;
          this.killEnemy(e);
          break;
        }
      }
      if (!l.alive || !this.boss) continue;
      for (const pl of this.boss.platePositions()) {
        if (Math.hypot(l.x - pl.x, l.y - pl.y) < pl.r) {
          l.alive = false;
          this.particles.spray(l.x, l.y, 0, 1, '#ffe080', 4);
        }
      }
      if (l.alive && this.boss.hit(l.x, l.y, 4)) {
        l.alive = false;
        if (this.boss.vulnerable) {
          this.addScore(10);
          if (this.boss.damage(0.45, this, l.x, l.y)) this.onBossKilled();
        }
      }
    }
    this.lasers = this.lasers.filter((l) => l.alive);
  }

  private updateCapsules(dt: number): void {
    const p = this.paddle;
    for (const c of this.capsules) {
      c.t += dt;
      c.y += c.vy * dt;
      if (
        !p.dead &&
        Math.abs(c.x - p.x) < p.w / 2 + CAPSULE_W / 2 - 10 &&
        Math.abs(c.y - p.y) < PADDLE_H / 2 + CAPSULE_H / 2
      ) {
        c.alive = false;
        this.applyPower(c.id, c.x, c.y);
      } else if (c.y > VIEW_H + 60) c.alive = false;
    }
    this.capsules = this.capsules.filter((c) => c.alive);
  }

  /** Every live ball splits into three (the original plus ±24°), up to `max` balls in play. */
  private splitBalls(max: number): number {
    const src = this.balls.filter((b) => b.alive);
    if (src.some((b) => b.stuck)) this.launchBalls();
    const extra: Ball[] = [];
    for (const b of src) {
      for (const off of [-0.42, 0.42]) {
        if (this.balls.length + extra.length >= max) break;
        const a = Math.atan2(b.dx, -b.dy) + off;
        const nb: Ball = { ...b, dx: Math.sin(a), dy: -Math.abs(Math.cos(a)), stuck: false, trail: [], teleCd: 0 };
        this.normalize(nb);
        extra.push(nb);
      }
    }
    this.balls.push(...extra);
    return extra.length;
  }

  /** Floating label above the paddle, kept clear of the frame (these strings are ~1000 px wide). */
  private paddleLabel(text: string, style: TextStyle, life: number): void {
    const x = clamp(this.paddle.x, FIELD.x + 540, FIELD.right - 540);
    this.particles.text(x, this.paddle.y - 90, text, style, life);
  }

  private multiplyBalls(): void {
    const p = this.paddle;
    if (this.splitBalls(MULTI_KEY_MAX) === 0) {
      this.sfx('menuMove', { pitch: -5 });
      this.paddleLabel(`MAXIMUM ${MULTI_KEY_MAX} BALLES`, STYLE.red, 1);
      return;
    }
    this.sfx('multiball', { pan: pan(p.x) });
    this.paddleLabel(`${this.balls.length} BALLES`, STYLE.green, 1);
  }

  private toggleBarrier(): void {
    const on = (this.session.barrier = !this.session.barrier);
    const p = this.paddle;
    this.sfx(on ? 'shield' : 'pause');
    this.paddleLabel(on ? 'BARRIERE PERMANENTE' : 'BARRIERE COUPEE', on ? STYLE.green : STYLE.red, 1.2);
    if (on) this.particles.ring(p.x, SHIELD_Y, '#5ae8ff', 260, 0.5);
  }

  private applyPower(id: PowerId, x: number, y: number): void {
    const def = POWERS[id];
    this.sfx(def.good ? 'powerupGood' : 'powerupBad', { pan: pan(x) });
    this.addScore(250, x, y);
    this.particles.ring(x, y, def.color, 120, 0.45);
    this.particles.sparks(x, y, def.color, 16, 600);
    this.particles.text(this.paddle.x, this.paddle.y - 90, def.name, def.good ? STYLE.green : STYLE.red, 1.2);
    if (def.duration > 0) {
      if (id === 'expand') this.effects.delete('shrink');
      if (id === 'shrink') this.effects.delete('expand');
      if (id === 'slow') this.effects.delete('fast');
      if (id === 'fast') this.effects.delete('slow');
      this.effects.set(id, def.duration);
    }
    const specific: Partial<Record<PowerId, SfxName>> = {
      expand: 'expand',
      shrink: 'shrink',
      multi: 'multiball',
      shield: 'shield',
      freeze: 'freeze',
      dark: 'darkness',
      drunk: 'drunk',
      rocket: 'rocket',
      dynamite: 'dynamite',
      warp: 'warp',
      slow: 'slow',
      fast: 'fast',
      fire: 'fireball',
      big: 'bigball',
      double: 'double',
      laser: 'laserGet',
      glue: 'catchGet',
    };
    const s = specific[id];
    if (s) this.sfx(s, { pan: pan(x) });
    switch (id) {
      case 'multi':
        this.splitBalls(MULTI_POWER_MAX);
        break;
      case 'life':
        this.session.lives = Math.min(9, this.session.lives + 1);
        this.sfx('extraLife');
        break;
      case 'dynamite': {
        for (const e of this.enemies) if (e.alive) this.killEnemy(e);
        for (const s2 of this.shots) {
          s2.alive = false;
          this.particles.sparks(s2.x, s2.y, '#ffb040', 6, 400);
        }
        if (this.boss?.vulnerable && this.boss.damage(3, this, this.boss.x, this.boss.y)) this.onBossKilled();
        this.shake(20);
        this.particles.flash(VIEW_W / 2, VIEW_H / 2, '#ffffff', 900, 0.3);
        break;
      }
      case 'warp':
        if (!this.isBoss) {
          this.particles.flash(this.paddle.x, this.paddle.y, '#ff4fe0', 600, 0.6);
          this.startClear();
        }
        break;
      case 'freeze':
        this.particles.sparks(this.paddle.x, this.paddle.y, '#dff6ff', 30, 500);
        break;
      default:
        break;
    }
  }

  private updateEnemies(dt: number): void {
    const p = this.paddle;
    if (this.phase === 'play' && !this.isBoss) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && !this.pendingSpawn) {
        const free = this.enemies.filter((e) => e.kind !== 'invader').length;
        if (free < 2 + Math.floor(this.levelNumber / 20)) {
          this.pendingSpawn = this.pickEnemyKind();
          this.gateTimer = 0.8;
          this.sfx('gateOpen');
        }
        this.spawnTimer = Math.max(6, 15 - this.levelNumber * 0.12) + rand(0, 4);
      }
      if (this.levelNumber % 10 === 5) {
        if (this.wave && this.wave.alive === 0) {
          this.wave = null;
          this.waveTimer = 18;
          this.addScore(2000, VIEW_W / 2, 600);
        }
        if (!this.wave) {
          this.waveTimer -= dt;
          if (this.waveTimer <= 0) this.startWave();
        }
      }
    }
    if (this.wave && this.phase === 'play') {
      const step = this.wave.update(dt, (x, y) => {
        this.fireShot('dagger', x, y, 0, 480 + this.levelNumber * 2, 12);
        this.sfx('dagger', { pan: pan(x) });
      });
      if (step !== null) this.sfx('invaderStep', { pitch: step, volume: 0.6 });
    }
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.kind !== 'invader') updateEnemy(e, dt, p.x);
      if (e.kind === 'ray' && Math.random() < 0.8)
        this.particles.ember(e.x + rand(-8, 8), e.y + rand(-8, 8), rand(-30, 30), rand(-120, -40), pick(['#ff6a00', '#ffb040']), rand(4, 9), rand(0.2, 0.4));
      if (p.dead || e.entering > 0 || this.phase !== 'play') continue;
      if (circleRectHit(e.x, e.y, e.r * 0.85, p.x - p.w / 2, p.y - PADDLE_H / 2, p.w, PADDLE_H)) {
        if (e.deadly && !this.shielded) this.killPaddle();
        else this.killEnemy(e);
      }
    }
    this.enemies = this.enemies.filter((e) => e.alive);
  }

  private pickEnemyKind(): EnemyKind {
    const l = this.levelNumber;
    if (l >= 8 && chance(Math.min(0.38, 0.08 + l * 0.005))) return 'ray';
    const pool: EnemyKind[] = ['orb'];
    if (l >= 11) pool.push('cube');
    if (l >= 21) pool.push('jelly');
    if (l >= 31) pool.push('mine');
    return pick(pool);
  }

  private killEnemy(e: Enemy): void {
    if (!e.alive) return;
    e.alive = false;
    const color =
      e.kind === 'ray' ? '#ff8a20' : e.kind === 'cube' ? '#9a5aff' : e.kind === 'jelly' ? '#40ffb0' : e.kind === 'invader' ? '#ff4fd0' : e.kind === 'mine' ? '#ff3030' : '#ffd060';
    this.particles.explosion(e.x, e.y, e.kind === 'ray' ? 0.9 : 0.6, color);
    this.sfx(e.kind === 'ray' || e.kind === 'mine' ? 'explosion' : 'enemyHit', { pan: pan(e.x) });
    this.addScore(e.score, e.x, e.y);
    this.shake(4);
  }

  private updateShots(dt: number): void {
    const p = this.paddle;
    for (const s of this.shots) {
      if (!s.alive) continue;
      s.t += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.kind === 'fireball' && Math.random() < 0.5)
        this.particles.ember(s.x, s.y, rand(-20, 20), rand(-60, -10), '#ff6a00', rand(3, 6), 0.25);
      if (s.y > VIEW_H + 40 || s.x < FIELD.x - 40 || s.x > FIELD.right + 40) {
        s.alive = false;
        continue;
      }
      if (this.barrierUp && s.y + s.r > SHIELD_Y) {
        s.alive = false;
        this.particles.spray(s.x, SHIELD_Y, 0, -1, '#5ae8ff', 6);
        this.sfx('shieldHit', { pan: pan(s.x), pitch: -3 });
        continue;
      }
      if (!p.dead && this.phase === 'play' && circleRectHit(s.x, s.y, s.r, p.x - p.w / 2, p.y - PADDLE_H / 2, p.w, PADDLE_H)) {
        s.alive = false;
        if (this.shielded) {
          this.particles.sparks(s.x, s.y, '#5ae8ff', 10, 400);
          this.sfx('shieldHit', { pan: pan(s.x) });
        } else this.killPaddle();
      }
    }
    this.shots = this.shots.filter((s) => s.alive);
  }

  private checkEnd(): void {
    if (!this.isBoss && this.field.remaining === 0) this.startClear();
  }

  private onBossKilled(): void {
    this.phase = 'bossDying';
    this.phaseT = 0;
    this.vanishPlayObjects();
    this.addScore(10000 * (this.boss?.tier ?? 1), VIEW_W / 2, 700);
  }

  private vanishPlayObjects(): void {
    for (const b of this.balls) {
      this.particles.sparks(b.x, b.y, '#fff2c0', 20, 600);
      this.particles.flash(b.x, b.y, '#ffd060', 90, 0.4);
    }
    this.balls = [];
    for (const e of this.enemies) if (e.alive) this.killEnemy(e);
    this.enemies = [];
    this.shots = [];
    this.lasers = [];
    this.capsules = [];
    this.wave = null;
    this.pendingSpawn = null;
  }

  private startClear(): void {
    if (this.phase === 'clear') return;
    this.phase = 'clear';
    this.phaseT = 0;
    this.vanishPlayObjects();
    this.effects.clear();
    this.clearBonus = this.isBoss ? 5000 : 1000 + this.levelNumber * 50;
    this.clearPaid = 0;
    void audio.playJingle('levelClear');
    this.showBanner(this.isBoss ? 'OEUF DETRUIT !' : 'NIVEAU TERMINE !', `BONUS ${this.clearBonus}`, STYLE.gold, 3.6);
  }

  private updateClear(dt: number): void {
    if (this.phaseT > 0.8 && this.clearPaid < this.clearBonus) {
      const step = Math.min(this.clearBonus - this.clearPaid, Math.ceil((this.clearBonus / 1.2) * dt));
      this.clearPaid += step;
      this.session.addScore(step);
      this.tickTimer -= dt;
      if (this.tickTimer <= 0) {
        this.tickTimer = 0.05;
        this.sfx('scoreTick', { volume: 0.5 });
      }
    }
    if (this.phaseT > 3.6) this.done = true;
  }

  private loseLife(reason: string): void {
    this.phase = 'death';
    this.phaseT = 0;
    this.session.lives = Math.max(0, this.session.lives - 1);
    this.effects.clear();
    this.capsules = [];
    this.lasers = [];
    for (const s of this.shots) s.alive = false;
    for (const e of this.enemies) if (e.kind === 'ray') e.alive = false;
    this.balls = [];
    audio.setThruster(0);
    if (this.session.lives > 0) this.showBanner(reason, `${this.session.lives} VIE${this.session.lives > 1 ? 'S' : ''}`, STYLE.red, 2);
  }

  private respawn(): void {
    const p = this.paddle;
    p.dead = false;
    p.x = p.targetX = FIELD.x + FIELD.w / 2;
    p.y = p.targetY = PADDLE_Y;
    p.w = PADDLE_W.normal;
    this.balls = [this.newBall()];
    this.invuln = 2;
    this.combo = 0;
    this.phase = 'play';
    this.phaseT = 0;
    this.showBanner('PRET ?', 'CLIC POUR LANCER', STYLE.big, 1.6);
  }

  // -------------------------------------------------------------------------
  // Rendering

  render(ctx: Ctx): void {
    const q = this.boss?.quake ?? 0;
    // Moving the camera exposes the canvas edges: clear them, or the last frame smears there.
    if (q > 0.005 || this.shakeAmt > 0 || this.drunkK > 0.01) {
      ctx.fillStyle = '#03050a';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    // Earthquake: the whole screen rolls, HUD included (two incommensurate sines per axis).
    ctx.save();
    if (q > 0.005) {
      const a = 30 * q;
      const t = this.time;
      const ox = a * (0.6 * Math.sin(TAU * 7.3 * t) + 0.4 * Math.sin(TAU * 12.9 * t + 1.3));
      const oy = a * 1.25 * (0.6 * Math.sin(TAU * 5.1 * t + 0.7) + 0.4 * Math.sin(TAU * 11.7 * t + 2.1));
      ctx.translate(VIEW_W / 2 + ox, VIEW_H / 2 + oy);
      ctx.rotate(0.005 * q * Math.sin(TAU * 3.1 * t));
      ctx.translate(-VIEW_W / 2, -VIEW_H / 2);
    }
    ctx.save();
    if (this.shakeAmt > 0) ctx.translate(rand(-1, 1) * this.shakeAmt * 0.5, rand(-1, 1) * this.shakeAmt * 0.5);
    if (this.drunkK > 0.01) {
      ctx.translate(VIEW_W / 2, VIEW_H / 2);
      ctx.rotate(Math.sin(this.time * 1.3) * 0.012 * this.drunkK);
      ctx.translate(-VIEW_W / 2, -VIEW_H / 2);
    }
    ctx.drawImage(this.bg, 0, 0);
    if (this.gateOpen > 0.01) drawGateClosed(ctx, this.gateOpen);

    ctx.save();
    ctx.beginPath();
    ctx.rect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
    ctx.clip();

    this.field.render(ctx, this.time);
    if (this.barrierUp) this.renderShield(ctx);
    this.boss?.renderBeam(ctx, this.paddle.y);

    for (const c of this.capsules) this.renderCapsule(ctx, c);
    for (const e of this.enemies) if (e.kind !== 'ray') drawEnemy(ctx, e, this.paddle.x);
    this.boss?.render(ctx, this.paddle.x);
    this.renderPaddle(ctx);
    this.renderBalls(ctx);
    for (const l of this.lasers) this.renderLaser(ctx, l.x, l.y);
    for (const s of this.shots) drawShot(ctx, s);
    for (const e of this.enemies) if (e.kind === 'ray') drawEnemy(ctx, e, this.paddle.x);
    this.particles.render(ctx);
    if (this.darkness > 0.01) this.renderDarkness(ctx);
    ctx.restore();
    ctx.restore();

    drawHud(ctx, {
      score: this.session.score,
      high: this.session.high,
      lives: this.session.lives,
      levelLabel: this.levelLabel,
      levelName: this.levelName,
      bricksLeft: this.isBoss ? null : this.field.remaining,
      effects: [
        ...(this.session.barrier ? [{ id: 'shield' as const, left: Infinity, permanent: true }] : []),
        ...[...this.effects].map(([id, left]) => ({ id, left })),
      ],
      boss: this.boss && this.boss.phase !== 'enter' && this.boss.phase !== 'dead' ? { name: this.boss.name, hp: this.boss.hp, max: this.boss.maxHp } : null,
      time: this.time,
    });
    this.renderOverlay(ctx);
    ctx.restore();
  }

  private renderShield(ctx: Ctx): void {
    const left = this.session.barrier ? Infinity : (this.effects.get('shield') ?? 0);
    const blink = left < 3 && Math.sin(this.time * 16) < 0 ? 0.4 : 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, SHIELD_Y - 18, 0, SHIELD_Y + 18);
    g.addColorStop(0, 'rgba(60,200,255,0)');
    g.addColorStop(0.5, `rgba(120,240,255,${0.85 * blink})`);
    g.addColorStop(1, 'rgba(60,200,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(FIELD.x, SHIELD_Y - 18, FIELD.w, 36);
    ctx.globalAlpha = 0.35 * blink;
    ctx.strokeStyle = '#8af0ff';
    ctx.lineWidth = 2;
    const off = (this.time * 120) % 48;
    ctx.beginPath();
    for (let x = FIELD.x - 48 + off; x < FIELD.right; x += 48) {
      ctx.moveTo(x, SHIELD_Y - 10);
      ctx.lineTo(x + 24, SHIELD_Y + 10);
    }
    ctx.stroke();
    ctx.restore();
  }

  private renderCapsule(ctx: Ctx, c: Capsule): void {
    const spr = sprites();
    const def = POWERS[c.id];
    const img = spr.capsule(def.color, def.label);
    // Rolling illusion: squash vertically as the capsule spins.
    const roll = 0.82 + 0.18 * Math.abs(Math.cos(c.t * 3));
    ctx.drawImage(spr.capsuleShadow, c.x - CAPSULE_W / 2 - 12 + 14, c.y - CAPSULE_H / 2 - 12 + 18);
    drawGlow(ctx, def.good ? def.color : '#ff2020', c.x, c.y, 80, 0.35);
    ctx.drawImage(img, c.x - CAPSULE_W / 2, c.y - (CAPSULE_H * roll) / 2, CAPSULE_W, CAPSULE_H * roll);
    // Travelling glint.
    const gx = c.x - CAPSULE_W / 2 + ((c.t * 120) % (CAPSULE_W + 60)) - 30;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(c.x - CAPSULE_W / 2, c.y - (CAPSULE_H * roll) / 2, CAPSULE_W, CAPSULE_H * roll, (CAPSULE_H * roll) / 2);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(gx - 14, 0, gx + 14, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(gx - 14, c.y - CAPSULE_H / 2, 28, CAPSULE_H);
    ctx.restore();
  }

  private renderPaddle(ctx: Ctx): void {
    const p = this.paddle;
    if (p.dead) return;
    if (this.invuln > 0 && Math.sin(this.time * 30) < 0) return;
    const spr = sprites();
    const h = PADDLE_H;
    const x0 = p.x - p.w / 2;
    const y0 = p.y - h / 2;
    const cap = PADDLE_CAP;
    // Shadow.
    ctx.drawImage(spr.brickShadow, x0 + 14 - 16, y0 + 20 - 16, p.w + 32, h + 32);
    if (this.effects.has('laser')) {
      for (const side of [-1, 1]) {
        const cx = p.x + side * (p.w / 2 - cap * 0.55);
        ctx.drawImage(spr.laserCannon, cx - 9, y0 - 22);
      }
    }
    ctx.drawImage(spr.paddleTube, x0 + cap, y0, p.w - cap * 2, h);
    ctx.drawImage(spr.paddleCore, p.x - 28, y0);
    ctx.drawImage(spr.paddleCapL, x0, y0);
    ctx.drawImage(spr.paddleCapR, x0 + p.w - cap, y0);
    // Running lights.
    const blinkL = Math.sin(this.time * 5) > 0 ? 1 : 0.35;
    drawGlow(ctx, '#40c8ff', x0 + 12, p.y + 2, 22, blinkL);
    drawGlow(ctx, '#ffc040', x0 + p.w - 12, p.y + 2, 22, 1.35 - blinkL);
    if (this.effects.has('glue')) {
      ctx.fillStyle = 'rgba(80,230,90,0.85)';
      for (let i = 0; i < 7; i++) {
        const gx = x0 + cap + ((p.w - cap * 2) * (i + 0.5)) / 7;
        const drip = 6 + 5 * Math.sin(this.time * 3 + i * 1.7);
        ctx.beginPath();
        ctx.ellipse(gx, y0 + 2, 14, 6, 0, 0, TAU);
        ctx.ellipse(gx + 4, y0 + 4 + drip, 3.5, drip * 0.5, 0, 0, TAU);
        ctx.fill();
      }
      drawGlow(ctx, '#50ff60', p.x, y0, p.w * 0.6, 0.25);
    }
    if (this.effects.has('rocket')) {
      for (const side of [-1, 1]) {
        const nx = p.x + side * (p.w / 2 - 40);
        ctx.fillStyle = '#4a515c';
        ctx.fillRect(nx - 12, y0 + h - 4, 24, 14);
        drawGlow(ctx, '#ff8a20', nx, y0 + h + 18, 40 + Math.random() * 12, 0.9);
        drawGlow(ctx, '#fff0a0', nx, y0 + h + 12, 18, 1);
      }
    }
    if (this.effects.has('freeze')) {
      ctx.save();
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = '#bfefff';
      ctx.beginPath();
      ctx.roundRect(x0 - 4, y0 - 6, p.w + 8, h + 12, (h + 12) / 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      drawGlow(ctx, '#dff6ff', p.x, p.y, p.w * 0.6, 0.5);
    }
    if (this.effects.has('shield') || this.invuln > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(120,240,255,${0.35 + 0.2 * Math.sin(this.time * 8)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.w / 2 + 24, h / 2 + 24, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  private renderBalls(ctx: Ctx): void {
    const spr = sprites();
    const big = this.effects.has('big');
    const fire = this.effects.has('fire');
    const r = this.ballR;
    const img = fire ? (big ? spr.ballFireBig : spr.ballFire) : big ? spr.ballBig : spr.ball;
    const shadow = big ? spr.ballShadowBig : spr.ballShadow;
    const trailColor = fire ? '#3fb8ff' : '#ff9a2a';
    // Level of detail: trails are 12 additive glows per ball, too many once the M key
    // has stacked dozens of balls. Sparser points keep 243 balls inside a 60 Hz frame.
    const n = this.balls.length;
    const stride = n <= 12 ? 1 : n <= 40 ? 2 : 4;
    for (const b of this.balls) {
      for (let i = b.trail.length - 1; i >= 0; i -= stride) {
        const t = b.trail[i]!;
        const k = (i + 1) / b.trail.length;
        drawGlow(ctx, trailColor, t.x, t.y, r * (1.2 + k * 1.4), Math.min(0.5, k * 0.22 * stride));
      }
      ctx.drawImage(shadow, b.x - r - 10 + 10, b.y - r - 10 + 14);
      drawGlow(ctx, trailColor, b.x, b.y, r * 4, 0.45);
      ctx.drawImage(img, b.x - r - 4, b.y - r - 4);
    }
  }

  private renderLaser(ctx: Ctx, x: number, y: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, y, 0, y + 46);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,80,80,0.95)');
    g.addColorStop(1, 'rgba(255,0,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 3.5, y, 7, 46);
    ctx.restore();
    drawGlow(ctx, '#ff3040', x, y + 8, 26, 0.8);
  }

  private renderDarkness(ctx: Ctx): void {
    if (!this.darkSurf) this.darkSurf = createSurface(FIELD.w, FIELD.h);
    const { ctx: d, canvas } = this.darkSurf;
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, canvas.width, canvas.height);
    d.fillStyle = `rgba(0,2,6,${0.94 * this.darkness})`;
    d.fillRect(0, 0, canvas.width, canvas.height);
    d.globalCompositeOperation = 'destination-out';
    const hole = (x: number, y: number, r: number): void => {
      const g = d.createRadialGradient(x - FIELD.x, y - FIELD.y, 0, x - FIELD.x, y - FIELD.y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.75)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = g;
      d.fillRect(x - FIELD.x - r, y - FIELD.y - r, r * 2, r * 2);
    };
    for (const b of this.balls) hole(b.x, b.y, 210);
    if (!this.paddle.dead) hole(this.paddle.x, this.paddle.y, this.paddle.w * 0.9);
    for (const c of this.capsules) hole(c.x, c.y, 90);
    for (const e of this.enemies) hole(e.x, e.y, e.kind === 'ray' ? 160 : 60);
    for (const s of this.shots) hole(s.x, s.y, 60);
    ctx.drawImage(canvas, FIELD.x, FIELD.y);
  }

  private renderOverlay(ctx: Ctx): void {
    const cx = FIELD.x + FIELD.w / 2;
    const b = this.banner;
    if (b) {
      const tIn = clamp(b.t / 0.35, 0, 1);
      const tOut = clamp((b.life - b.t) / 0.4, 0, 1);
      const a = Math.min(tIn, tOut);
      const scale = 0.6 + 0.4 * easeOutBack(tIn);
      const y = 640;
      ctx.save();
      ctx.translate(cx, y);
      ctx.scale(scale, scale);
      drawText(ctx, b.text, 0, -60, b.style, 'center', a);
      ctx.restore();
      if (b.sub) drawText(ctx, b.sub, cx, y + 70, STYLE.medium, 'center', a);
    }
    const stuck = this.balls.some((x) => x.stuck);
    if (stuck && (this.phase === 'play' || (this.phase === 'intro' && this.phaseT > 1.3)) && !this.effects.has('glue') && !this.banner) {
      const a = 0.55 + 0.45 * Math.sin(this.time * 4);
      drawText(ctx, 'CLIC POUR LANCER', cx, 1000, STYLE.small, 'center', a);
      if (input.locked && !this.launchedOnce)
        drawText(ctx, 'SOURIS CAPTUREE  -  ECHAP POUR LA LIBERER', cx, 1060, STYLE.tiny, 'center', 0.7);
    }
  }
}
