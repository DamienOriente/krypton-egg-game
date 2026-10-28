import { FIELD, VIEW_H } from '../config';
import { TAU, clamp, easeOutCubic, pick, rand } from '../core/math';
import type { SfxName, SfxOptions } from '../audio/audio';
import { drawGlow, shade, type Ctx } from '../render/canvas';
import type { Particles } from '../render/particles';
import type { EnemyKind, ShotKind } from './enemies';

export interface BossHost {
  readonly paddleX: number;
  readonly paddleY: number;
  readonly paddleW: number;
  readonly shielded: boolean;
  readonly enemyCount: number;
  readonly particles: Particles;
  fireShot(kind: ShotKind, x: number, y: number, vx: number, vy: number, r: number): void;
  spawnEnemy(kind: EnemyKind, x: number, y: number): void;
  dropCapsule(x: number, y: number): void;
  shake(amount: number): void;
  sfx(name: SfxName, opts?: SfxOptions): void;
  killPaddle(): void;
}

interface Theme {
  name: string;
  shell: string;
  glow: string;
}

export const BOSS_THEMES: Theme[] = [
  { name: 'OEUF DE JADE', shell: '#2fb59a', glow: '#7dff4a' },
  { name: 'OEUF AZUR', shell: '#2f6bff', glow: '#3fe0ff' },
  { name: 'OEUF D AMETHYSTE', shell: '#8a3cff', glow: '#ff6af0' },
  { name: 'OEUF DE MAGMA', shell: '#d0281e', glow: '#ffb020' },
  { name: 'OEUF D OR', shell: '#e0a420', glow: '#fff3a0' },
  { name: 'L OEUF KRYPTON', shell: '#1c2420', glow: '#5aff5a' },
];

type Phase = 'enter' | 'fight' | 'dying' | 'dead';

interface Beam {
  x: number;
  charge: number;
  fire: number;
}

export class Boss {
  readonly theme: Theme;
  x = FIELD.x + FIELD.w / 2;
  y = -400;
  readonly rx = 190;
  readonly ry = 250;
  hp: number;
  readonly maxHp: number;
  t = 0;
  phase: Phase = 'enter';
  flash = 0;
  /** Earthquake intensity 0..1 (arrival and death), read by Play for camera, debris and rumble. */
  quake = 0;
  private enterT = 0;
  private attackTimer = 3;
  private beam: Beam | null = null;
  private rain = 0;
  private rainTimer = 0;
  private dyingT = 0;
  private nextDrop: number;
  private readonly plates: number;
  private plateAngle = 0;
  private readonly cracks: { a: number; len: number; seg: number[] }[];

  constructor(readonly tier: number) {
    this.theme = BOSS_THEMES[clamp(tier - 1, 0, BOSS_THEMES.length - 1)]!;
    this.maxHp = this.hp = 22 + tier * 7;
    this.nextDrop = this.maxHp * 0.85;
    this.plates = tier >= 3 ? Math.min(5, tier + 1) : 0;
    this.cracks = Array.from({ length: 9 }, (_, i) => ({
      a: (i / 9) * TAU + rand(-0.2, 0.2),
      len: rand(0.5, 0.9),
      seg: Array.from({ length: 6 }, () => rand(-0.35, 0.35)),
    }));
  }

  get enraged(): boolean {
    return this.hp < this.maxHp / 2;
  }
  get vulnerable(): boolean {
    return this.phase === 'fight';
  }
  get name(): string {
    return this.theme.name;
  }

  /** Advances the idle animation only (title and victory screens). */
  animate(dt: number): void {
    this.t += dt;
    this.plateAngle += dt * 0.6;
  }

  update(dt: number, host: BossHost): void {
    this.t += dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 5);
    this.plateAngle += dt * (0.9 + this.tier * 0.12) * (this.enraged ? 1.5 : 1);

    if (this.phase === 'enter') {
      this.enterT += dt / 2.6;
      const k = easeOutCubic(clamp(this.enterT, 0, 1));
      this.y = -400 + (this.restY() + 400) * k;
      // The ground shakes harder as the egg comes down.
      this.quake = 0.3 + 0.5 * Math.pow(clamp(this.enterT, 0, 1), 2);
      if (this.enterT >= 1) {
        this.phase = 'fight';
        this.quake = 1;
        host.sfx('bossRoar');
        host.sfx('bigExplosion', { pitch: -6, volume: 0.8 });
        host.shake(16);
      }
      return;
    }
    if (this.phase === 'dying') {
      this.dyingT += dt;
      this.quake = Math.max(this.quake - dt * 1.5, 0.65);
      if (Math.random() < dt * 14) {
        this.quake = Math.min(1, this.quake + 0.3);
        const a = rand(0, TAU);
        const rr = Math.sqrt(Math.random());
        host.particles.explosion(this.x + Math.cos(a) * this.rx * rr, this.y + Math.sin(a) * this.ry * rr, rand(0.5, 1.1), pick([this.theme.glow, '#ffb040', '#ffffff']));
        host.sfx('explosion', { pitch: rand(-5, 3), pan: (this.x - 1280) / 1200 });
        host.shake(10);
      }
      if (this.dyingT > 3.2) {
        host.particles.explosion(this.x, this.y, 4, this.theme.glow);
        host.particles.explosion(this.x, this.y, 2.5, '#ffffff');
        for (let i = 0; i < 60; i++)
          host.particles.brickBurst(this.x + rand(-this.rx, this.rx), this.y + rand(-this.ry, this.ry), this.theme.shell, rand(-1, 1), rand(-1, 1), 2);
        host.sfx('bossDeath');
        host.shake(40);
        this.quake = 1;
        this.phase = 'dead';
      }
      return;
    }
    // Aftershock: the landing tremor fades in ~1 s, the death one in ~1.8 s.
    this.quake = Math.max(0, this.quake - dt * (this.phase === 'dead' ? 0.55 : 0.9));
    if (this.phase === 'dead') return;

    const speed = (0.32 + this.tier * 0.045) * (this.enraged ? 1.45 : 1);
    this.x = FIELD.x + FIELD.w / 2 + Math.sin(this.t * speed) * (FIELD.w / 2 - this.rx - 110);
    this.y = this.restY() + Math.sin(this.t * 0.9) * 45;

    // Telegraphed beam.
    if (this.beam) {
      const b = this.beam;
      if (b.charge > 0) {
        b.charge -= dt;
        if (b.charge <= 0) {
          host.sfx('bossShoot', { pitch: -7 });
          host.shake(12);
        }
      } else {
        b.fire -= dt;
        if (Math.abs(host.paddleX - b.x) < 40 + host.paddleW / 2 && !host.shielded) host.killPaddle();
        if (Math.random() < 0.6) host.particles.sparks(b.x + rand(-30, 30), host.paddleY + 30, this.theme.glow, 2, 500);
        if (b.fire <= 0) this.beam = null;
      }
    }

    if (this.rain > 0) {
      this.rainTimer -= dt;
      if (this.rainTimer <= 0) {
        this.rain--;
        this.rainTimer = 0.22;
        host.fireShot('fireball', rand(FIELD.x + 60, FIELD.right - 60), FIELD.y + 10, rand(-40, 40), rand(380, 520), 16);
        host.sfx('enemyShoot', { pitch: rand(-3, 3) });
      }
    }

    this.attackTimer -= dt;
    if (this.attackTimer <= 0 && !this.beam) {
      this.attack(host);
      const base = 3.6 - this.tier * 0.25;
      this.attackTimer = Math.max(1.3, base * (this.enraged ? 0.7 : 1)) + rand(0, 0.8);
    }
  }

  private restY(): number {
    return FIELD.y + 330;
  }

  private attack(host: BossHost): void {
    const options: string[] = ['spread', 'spread'];
    if (host.enemyCount < 4) options.push('mines');
    if (this.tier >= 2) options.push('beam');
    if (this.tier >= 4) options.push('rain');
    if (this.enraged && this.tier >= 2) options.push('beam', 'spread');
    const a = pick(options);
    const mouthX = this.x;
    const mouthY = this.y + this.ry * 0.85;
    if (a === 'spread') {
      const n = 3 + Math.floor(this.tier / 2) + (this.enraged ? 2 : 0);
      const aim = Math.atan2(host.paddleY - mouthY, host.paddleX - mouthX);
      const spread = 0.16;
      const sp = 480 + this.tier * 35;
      for (let i = 0; i < n; i++) {
        const ang = aim + (i - (n - 1) / 2) * spread;
        host.fireShot('fireball', mouthX, mouthY, Math.cos(ang) * sp, Math.sin(ang) * sp, 15);
      }
      host.sfx('bossShoot', { pan: (mouthX - 1280) / 1200 });
      host.particles.flash(mouthX, mouthY, this.theme.glow, 120, 0.25);
    } else if (a === 'mines') {
      host.spawnEnemy('mine', this.x - this.rx - 20, this.y);
      host.spawnEnemy('mine', this.x + this.rx + 20, this.y);
      host.sfx('enemySpawn');
    } else if (a === 'beam') {
      this.beam = { x: host.paddleX, charge: 1.15 - Math.min(0.35, this.tier * 0.05), fire: 0.7 };
      host.sfx('bossCharge');
    } else if (a === 'rain') {
      this.rain = 6 + this.tier;
      this.rainTimer = 0.1;
      host.sfx('bossRoar', { pitch: 3 });
    }
  }

  /** Returns true if this damage killed the boss. */
  damage(amount: number, host: BossHost, hx: number, hy: number): boolean {
    if (!this.vulnerable) return false;
    this.hp -= amount;
    this.flash = 1;
    host.sfx('bossHit', { pan: (hx - 1280) / 1200, pitch: rand(-1, 1) });
    host.particles.sparks(hx, hy, this.theme.glow, 10, 700);
    host.shake(5);
    while (this.hp <= this.nextDrop && this.nextDrop > 0) {
      host.dropCapsule(this.x + rand(-60, 60), this.y + this.ry);
      this.nextDrop -= this.maxHp * 0.15;
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.phase = 'dying';
      this.beam = null;
      this.rain = 0;
      host.sfx('bigExplosion');
      return true;
    }
    return false;
  }

  /** Ellipse collision against a circle. Returns the outward normal and the contact point. */
  hit(bx: number, by: number, r: number): { nx: number; ny: number; px: number; py: number } | null {
    if (this.phase === 'dead' || this.phase === 'dying') return null;
    const ex = this.rx + r;
    const ey = this.ry + r;
    const u = (bx - this.x) / ex;
    const v = (by - this.y) / ey;
    const d2 = u * u + v * v;
    if (d2 >= 1) return null;
    const len = Math.sqrt(d2) || 1;
    let nx = u / ex;
    let ny = v / ey;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    return { nx, ny, px: this.x + (u / len) * ex, py: this.y + (v / len) * ey };
  }

  platePositions(): { x: number; y: number; r: number }[] {
    const out: { x: number; y: number; r: number }[] = [];
    if (this.phase !== 'fight' && this.phase !== 'enter') return out;
    for (let i = 0; i < this.plates; i++) {
      const a = this.plateAngle + (i / this.plates) * TAU;
      out.push({ x: this.x + Math.cos(a) * (this.rx + 95), y: this.y + Math.sin(a) * (this.ry + 70), r: 34 });
    }
    return out;
  }

  // -------------------------------------------------------------------------

  private eggPath(ctx: Ctx, rx: number, ry: number): void {
    ctx.beginPath();
    const steps = 64;
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * TAU;
      const s = Math.sin(th);
      // Wider bottom, narrower top: the egg silhouette.
      const x = Math.cos(th) * rx * (1 + 0.1 * s);
      const y = s * ry;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  renderBeam(ctx: Ctx, paddleY: number): void {
    const b = this.beam;
    if (!b) return;
    const top = this.y + this.ry * 0.8;
    if (b.charge > 0) {
      const blink = Math.sin(this.t * 40) > 0 ? 0.6 : 0.25;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = this.theme.glow;
      ctx.globalAlpha = blink;
      ctx.setLineDash([18, 14]);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(b.x - 40, top);
      ctx.lineTo(b.x - 40, VIEW_H);
      ctx.moveTo(b.x + 40, top);
      ctx.lineTo(b.x + 40, VIEW_H);
      ctx.stroke();
      ctx.restore();
      drawGlow(ctx, this.theme.glow, this.x, top, 90 + (1 - b.charge) * 120, 0.8);
    } else {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const w = 80 + Math.sin(this.t * 60) * 8;
      const g = ctx.createLinearGradient(b.x - w / 2, 0, b.x + w / 2, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.3, this.theme.glow);
      g.addColorStop(0.5, '#ffffff');
      g.addColorStop(0.7, this.theme.glow);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(b.x - w / 2, top, w, VIEW_H - top);
      ctx.restore();
      drawGlow(ctx, '#ffffff', b.x, paddleY, 120, 0.6);
    }
  }

  render(ctx: Ctx, paddleX: number): void {
    if (this.phase === 'dead') return;
    const { rx, ry } = this;
    const th = this.theme;
    const shakeX = this.phase === 'dying' ? rand(-8, 8) : 0;
    const shakeY = this.phase === 'dying' ? rand(-8, 8) : 0;

    for (const p of this.platePositions()) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(this.plateAngle * 2);
      const g = ctx.createLinearGradient(-p.r, -p.r, p.r, p.r);
      g.addColorStop(0, '#fff6c0');
      g.addColorStop(0.5, '#d79a1c');
      g.addColorStop(1, '#6b4204');
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        ctx.lineTo(Math.cos(a) * p.r, Math.sin(a) * p.r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#4a2a00';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      drawGlow(ctx, '#ffb000', p.x, p.y, 50, 0.25);
    }

    ctx.save();
    ctx.translate(this.x + shakeX, this.y + shakeY);
    // Drop shadow on the plates.
    ctx.save();
    ctx.translate(40, 60);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    this.eggPath(ctx, rx, ry);
    ctx.fill();
    ctx.restore();

    // Aura.
    drawGlow(ctx, th.glow, 0, 0, rx * 2.1, 0.22 + (this.enraged ? 0.15 * (0.5 + 0.5 * Math.sin(this.t * 6)) : 0));

    // Shell.
    this.eggPath(ctx, rx, ry);
    const g = ctx.createRadialGradient(-rx * 0.4, -ry * 0.45, 10, 0, 0, ry * 1.15);
    g.addColorStop(0, shade(th.shell, 0.8));
    g.addColorStop(0.25, shade(th.shell, 0.25));
    g.addColorStop(0.6, th.shell);
    g.addColorStop(0.9, shade(th.shell, -0.6));
    g.addColorStop(1, shade(th.shell, -0.85));
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    this.eggPath(ctx, rx, ry);
    ctx.clip();
    // Metal bands with rivets.
    for (const by of [-ry * 0.42, ry * 0.32]) {
      const bg = ctx.createLinearGradient(0, by - 18, 0, by + 18);
      bg.addColorStop(0, '#f4f6fa');
      bg.addColorStop(0.4, '#9aa2ae');
      bg.addColorStop(0.6, '#4a515c');
      bg.addColorStop(1, '#1c2026');
      ctx.fillStyle = bg;
      ctx.fillRect(-rx * 1.2, by - 18, rx * 2.4, 36);
      for (let i = -6; i <= 6; i++) {
        ctx.fillStyle = '#2a2e35';
        ctx.beginPath();
        ctx.arc(i * 32, by, 5, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#e8ecf2';
        ctx.beginPath();
        ctx.arc(i * 32 - 1, by - 1.5, 2.5, 0, TAU);
        ctx.fill();
      }
    }
    // Damage cracks glow from inside.
    const dmg = 1 - this.hp / this.maxHp;
    const showCracks = Math.floor(dmg * this.cracks.length * 1.1);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < Math.min(showCracks, this.cracks.length); i++) {
      const c = this.cracks[i]!;
      ctx.strokeStyle = th.glow;
      ctx.lineWidth = 3 + dmg * 3;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.t * 8 + i);
      ctx.beginPath();
      let px = Math.cos(c.a) * rx * 0.2;
      let py = Math.sin(c.a) * ry * 0.2;
      ctx.moveTo(px, py);
      c.seg.forEach((off, k) => {
        const rr = 0.2 + ((k + 1) / c.seg.length) * c.len;
        px = Math.cos(c.a + off) * rx * rr;
        py = Math.sin(c.a + off) * ry * rr;
        ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // Specular.
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(-rx * 0.38, -ry * 0.55, rx * 0.22, ry * 0.12, -0.5, 0, TAU);
    ctx.fill();

    // The eye: a krypton core that tracks the paddle.
    const look = clamp((paddleX - this.x) / 800, -1, 1) * rx * 0.25;
    const ey = ry * -0.02;
    ctx.fillStyle = '#05070a';
    ctx.beginPath();
    ctx.ellipse(look * 0.4, ey, rx * 0.42, ry * 0.2, 0, 0, TAU);
    ctx.fill();
    const blink = this.phase === 'enter' ? 0.3 : 1;
    const eg = ctx.createRadialGradient(look, ey, 0, look, ey, rx * 0.22);
    eg.addColorStop(0, '#ffffff');
    eg.addColorStop(0.3, th.glow);
    eg.addColorStop(1, shade(th.glow, -0.8));
    ctx.fillStyle = eg;
    ctx.globalAlpha = blink;
    ctx.beginPath();
    ctx.arc(look, ey, rx * 0.17, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(look, ey, 7, rx * 0.12, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    drawGlow(ctx, th.glow, this.x + look, this.y + ey, 110, 0.55 * blink);

    if (this.flash > 0) {
      ctx.save();
      ctx.translate(this.x + shakeX, this.y + shakeY);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.flash * 0.6;
      ctx.fillStyle = '#ffffff';
      this.eggPath(ctx, rx, ry);
      ctx.fill();
      ctx.restore();
    }
  }
}
