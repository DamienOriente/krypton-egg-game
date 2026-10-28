import { TAU, rand } from '../core/math';
import { drawGlow, shade, type Ctx } from './canvas';
import { drawText, type TextStyle } from './font';

type Kind = 'shard' | 'spark' | 'smoke' | 'flash' | 'ring' | 'text' | 'ember';

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  dark: string;
  gravity: number;
  drag: number;
  text: string;
  style: TextStyle | null;
}

const MAX = 2600;

export class Particles {
  private readonly items: Particle[] = [];
  private readonly pool: Particle[] = [];

  private spawn(kind: Kind, x: number, y: number): Particle {
    const p: Particle = this.pool.pop() ?? {
      kind,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      max: 1,
      size: 1,
      rot: 0,
      vr: 0,
      color: '#fff',
      dark: '#000',
      gravity: 0,
      drag: 0,
      text: '',
      style: null,
    };
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.rot = 0;
    p.vr = 0;
    p.gravity = 0;
    p.drag = 0;
    p.style = null;
    if (this.items.length >= MAX) this.items.shift();
    this.items.push(p);
    return p;
  }

  get count(): number {
    return this.items.length;
  }

  clear(): void {
    this.pool.push(...this.items);
    this.items.length = 0;
  }

  /** Glass/plastic shards flying out of a broken capsule brick. */
  brickBurst(x: number, y: number, color: string, dirX = 0, dirY = -1, amount = 14): void {
    for (let i = 0; i < amount; i++) {
      const p = this.spawn('shard', x + rand(-40, 40), y + rand(-16, 16));
      const a = Math.atan2(dirY, dirX) + rand(-1.3, 1.3);
      const sp = rand(200, 720);
      p.vx = Math.cos(a) * sp * 0.6 + rand(-120, 120);
      p.vy = Math.sin(a) * sp * 0.6 - rand(80, 380);
      p.gravity = 2100;
      p.drag = 0.6;
      p.size = rand(6, 15);
      p.rot = rand(0, TAU);
      p.vr = rand(-14, 14);
      p.life = p.max = rand(0.55, 1.05);
      p.color = color;
      p.dark = shade(color, -0.5);
    }
    this.sparks(x, y, shade(color, 0.5), 6, 500);
    const f = this.spawn('flash', x, y);
    f.size = 90;
    f.life = f.max = 0.18;
    f.color = color;
  }

  sparks(x: number, y: number, color: string, n: number, speed: number, gravity = 900): void {
    for (let i = 0; i < n; i++) {
      const p = this.spawn('spark', x, y);
      const a = rand(0, TAU);
      const sp = rand(speed * 0.3, speed);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.gravity = gravity;
      p.drag = 2.2;
      p.size = rand(2, 4);
      p.life = p.max = rand(0.25, 0.6);
      p.color = color;
    }
  }

  /** Directional spark spray, e.g. the ball scraping a metal brick. */
  spray(x: number, y: number, nx: number, ny: number, color: string, n: number): void {
    const base = Math.atan2(ny, nx);
    for (let i = 0; i < n; i++) {
      const p = this.spawn('spark', x, y);
      const a = base + rand(-0.9, 0.9);
      const sp = rand(260, 820);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.gravity = 1400;
      p.drag = 2.5;
      p.size = rand(2, 3.5);
      p.life = p.max = rand(0.18, 0.42);
      p.color = color;
    }
  }

  explosion(x: number, y: number, scale = 1, color = '#ffb040'): void {
    const f = this.spawn('flash', x, y);
    f.size = 220 * scale;
    f.life = f.max = 0.32;
    f.color = color;
    const r = this.spawn('ring', x, y);
    r.size = 180 * scale;
    r.life = r.max = 0.45;
    r.color = color;
    for (let i = 0; i < 18 * scale; i++) {
      const p = this.spawn('ember', x, y);
      const a = rand(0, TAU);
      const sp = rand(200, 900) * Math.sqrt(scale);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.gravity = 500;
      p.drag = 2.4;
      p.size = rand(4, 9) * Math.sqrt(scale);
      p.life = p.max = rand(0.4, 0.9);
      p.color = color;
    }
    for (let i = 0; i < 8 * scale; i++) {
      const p = this.spawn('smoke', x + rand(-30, 30) * scale, y + rand(-30, 30) * scale);
      const a = rand(0, TAU);
      p.vx = Math.cos(a) * rand(30, 160);
      p.vy = Math.sin(a) * rand(30, 160) - 60;
      p.drag = 1.6;
      p.size = rand(30, 60) * scale;
      p.life = p.max = rand(0.7, 1.3);
      p.color = '#1a1d24';
    }
    this.sparks(x, y, '#fff2c0', Math.round(14 * scale), 1100 * Math.sqrt(scale), 600);
  }

  ring(x: number, y: number, color: string, radius: number, life = 0.4): void {
    const r = this.spawn('ring', x, y);
    r.size = radius;
    r.life = r.max = life;
    r.color = color;
  }

  flash(x: number, y: number, color: string, radius: number, life = 0.2): void {
    const f = this.spawn('flash', x, y);
    f.size = radius;
    f.life = f.max = life;
    f.color = color;
  }

  text(x: number, y: number, text: string, style: TextStyle, life = 0.9): void {
    const p = this.spawn('text', x, y);
    p.text = text;
    p.style = style;
    p.vy = -120;
    p.drag = 1.5;
    p.life = p.max = life;
  }

  /** Wood splinter / stone chip shaken loose from the frame (earthquake). */
  debris(x: number, y: number, color: string): void {
    const p = this.spawn('shard', x, y);
    p.vx = rand(-70, 70);
    p.vy = rand(40, 280);
    p.gravity = 1900;
    p.drag = 0.3;
    p.size = rand(5, 12);
    p.rot = rand(0, TAU);
    p.vr = rand(-10, 10);
    p.life = p.max = rand(0.8, 1.4);
    p.color = color;
    p.dark = shade(color, -0.5);
  }

  /** Light dust puff drifting down (earthquake). */
  dust(x: number, y: number): void {
    const p = this.spawn('smoke', x, y);
    p.vx = rand(-40, 40);
    p.vy = rand(30, 110);
    p.drag = 1.2;
    p.size = rand(18, 40);
    p.life = p.max = rand(0.8, 1.5);
    p.color = '#8f8578';
  }

  /** Continuous emitter helpers (trails, thrusters). */
  ember(x: number, y: number, vx: number, vy: number, color: string, size: number, life: number): void {
    const p = this.spawn('ember', x, y);
    p.vx = vx;
    p.vy = vy;
    p.drag = 2;
    p.size = size;
    p.life = p.max = life;
    p.color = color;
  }

  update(dt: number): void {
    const items = this.items;
    let w = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.pool.push(p);
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      items[w++] = p;
    }
    items.length = w;
  }

  render(ctx: Ctx): void {
    // Opaque pass first, additive pass after, so glows sit on top of debris.
    for (const p of this.items) {
      const t = p.life / p.max;
      if (p.kind === 'shard') {
        ctx.save();
        ctx.globalAlpha = Math.min(1, t * 2.2);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const s = p.size;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(-s * 0.6, -s * 0.4);
        ctx.lineTo(s * 0.7, -s * 0.2);
        ctx.lineTo(s * 0.2, s * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = p.dark;
        ctx.beginPath();
        ctx.moveTo(s * 0.7, -s * 0.2);
        ctx.lineTo(s * 0.2, s * 0.55);
        ctx.lineTo(-s * 0.1, s * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(-s * 0.3, -s * 0.3, s * 0.35, s * 0.12);
        ctx.restore();
      } else if (p.kind === 'smoke') {
        ctx.save();
        ctx.globalAlpha = 0.2 * t;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.6 - t * 0.6), 0, TAU);
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'text' && p.style) {
        drawText(ctx, p.text, p.x, p.y, p.style, 'center', Math.min(1, t * 3));
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.items) {
      const t = p.life / p.max;
      switch (p.kind) {
        case 'spark': {
          ctx.globalAlpha = t;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          ctx.stroke();
          break;
        }
        case 'ember': {
          ctx.globalAlpha = 1;
          drawGlow(ctx, p.color, p.x, p.y, p.size * 3, t);
          break;
        }
        case 'flash': {
          ctx.globalAlpha = 1;
          drawGlow(ctx, p.color, p.x, p.y, p.size * (1.2 - t * 0.4), t);
          break;
        }
        case 'ring': {
          const k = 1 - t;
          ctx.globalAlpha = t * 0.9;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 3 + 14 * t;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.2 + k * 0.9), 0, TAU);
          ctx.stroke();
          break;
        }
        default:
          break;
      }
    }
    ctx.restore();
  }
}
