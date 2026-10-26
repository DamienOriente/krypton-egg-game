import { BRICK_H, BRICK_W, COLS, FIELD, GRID_TOP, MAX_ROWS } from '../config';
import { TAU, clamp, easeOutBack } from '../core/math';
import { createSurface, drawGlow, type Ctx, type Surface } from '../render/canvas';
import { BRICK_COLORS, sprites } from '../render/sprites';
import type { LevelDef } from '../levels/types';

export type BrickKind = 'color' | 'silver' | 'gold' | 'regen' | 'explosive';

export interface Brick {
  col: number;
  row: number;
  x: number;
  y: number;
  ch: string;
  kind: BrickKind;
  hp: number;
  maxHp: number;
  alive: boolean;
  regenTimer: number;
  flash: number;
  /** >0 while an explosion is about to reach this brick (chain reaction delay). */
  fuse: number;
}

export interface Teleporter {
  x: number;
  y: number;
  pair: number;
  pulse: number;
}

export const REGEN_TIME = 8;
const SHADOW_DX = 9;
const SHADOW_DY = 11;

export class BrickField {
  readonly bricks: Brick[] = [];
  private readonly grid: (Brick | null)[] = new Array(COLS * MAX_ROWS).fill(null);
  readonly teleporters: Teleporter[] = [];
  private readonly layer: Surface;
  private dirty = true;
  /** 0..1 progress of the drop-in animation; 1 = settled (cached rendering). */
  intro = 1;
  onRegen: ((b: Brick) => void) | null = null;
  /** Returns true while something (a ball) occupies the cell, so the brick must not respawn on it. */
  regenBlocked: ((b: Brick) => boolean) | null = null;

  constructor(def: LevelDef | null, levelNumber: number) {
    this.layer = createSurface(FIELD.w, MAX_ROWS * BRICK_H + BRICK_H * 2);
    if (!def) return;
    const silverHp = levelNumber >= 31 ? 3 : 2;
    def.rows.slice(0, MAX_ROWS).forEach((line, row) => {
      for (let col = 0; col < Math.min(COLS, line.length); col++) {
        const ch = line[col]!;
        if (ch === '.' || ch === ' ') continue;
        const x = FIELD.x + col * BRICK_W;
        const y = GRID_TOP + row * BRICK_H;
        if (ch === 'T') {
          this.teleporters.push({ x: x + BRICK_W / 2, y: y + BRICK_H / 2, pair: -1, pulse: Math.random() * TAU });
          continue;
        }
        if (!(ch in BRICK_COLORS)) continue;
        const kind: BrickKind =
          ch === 'S' ? 'silver' : ch === 'G' ? 'gold' : ch === 'R' ? 'regen' : ch === 'X' ? 'explosive' : 'color';
        const hp = kind === 'silver' ? silverHp : kind === 'gold' ? Infinity : 1;
        const b: Brick = { col, row, x, y, ch, kind, hp, maxHp: hp, alive: true, regenTimer: 0, flash: 0, fuse: 0 };
        this.bricks.push(b);
        this.grid[row * COLS + col] = b;
      }
    });
    for (let i = 0; i + 1 < this.teleporters.length; i += 2) {
      this.teleporters[i]!.pair = i + 1;
      this.teleporters[i + 1]!.pair = i;
    }
  }

  at(col: number, row: number): Brick | null {
    if (col < 0 || col >= COLS || row < 0 || row >= MAX_ROWS) return null;
    return this.grid[row * COLS + col] ?? null;
  }

  /** Alive bricks whose cell overlaps the given box. */
  query(x0: number, y0: number, x1: number, y1: number, out: Brick[]): Brick[] {
    out.length = 0;
    const c0 = Math.floor((x0 - FIELD.x) / BRICK_W);
    const c1 = Math.floor((x1 - FIELD.x) / BRICK_W);
    const r0 = Math.floor((y0 - GRID_TOP) / BRICK_H);
    const r1 = Math.floor((y1 - GRID_TOP) / BRICK_H);
    for (let r = Math.max(0, r0); r <= Math.min(MAX_ROWS - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(COLS - 1, c1); c++) {
        const b = this.grid[r * COLS + c];
        if (b && b.alive) out.push(b);
      }
    }
    return out;
  }

  get remaining(): number {
    let n = 0;
    for (const b of this.bricks) if (b.alive && b.kind !== 'gold') n++;
    return n;
  }

  get destructibleTotal(): number {
    let n = 0;
    for (const b of this.bricks) if (b.kind !== 'gold') n++;
    return n;
  }

  kill(b: Brick): void {
    b.alive = false;
    b.fuse = 0;
    if (b.kind === 'regen') b.regenTimer = REGEN_TIME;
    this.dirty = true;
  }

  markDirty(): void {
    this.dirty = true;
  }

  neighbours(b: Brick): Brick[] {
    const out: Brick[] = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const n = this.at(b.col + dc, b.row + dr);
        if (n && n.alive) out.push(n);
      }
    return out;
  }

  update(dt: number): void {
    for (const b of this.bricks) {
      if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 4);
      if (!b.alive && b.kind === 'regen' && b.regenTimer > 0) {
        b.regenTimer -= dt;
        if (b.regenTimer <= 0 && this.regenBlocked?.(b)) b.regenTimer = 0.15;
        if (b.regenTimer <= 0) {
          b.alive = true;
          b.hp = b.maxHp;
          b.flash = 1;
          this.dirty = true;
          this.onRegen?.(b);
        }
      }
    }
    for (const t of this.teleporters) t.pulse += dt;
  }

  private rebuild(): void {
    const { ctx, canvas } = this.layer;
    const spr = sprites();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const ox = -FIELD.x;
    const oy = -FIELD.y;
    for (const b of this.bricks)
      if (b.alive) ctx.drawImage(spr.brickShadow, b.x + ox + SHADOW_DX - 16, b.y + oy + SHADOW_DY - 16);
    for (const b of this.bricks) {
      if (!b.alive) continue;
      ctx.drawImage(spr.bricks[b.ch]!, b.x + ox, b.y + oy);
      if (b.kind === 'silver' && b.hp < b.maxHp) {
        const crack = b.hp <= 1 ? spr.cracks[1]! : spr.cracks[0]!;
        ctx.drawImage(crack, b.x + ox, b.y + oy);
      }
    }
    this.dirty = false;
  }

  render(ctx: Ctx, time: number): void {
    const spr = sprites();
    this.renderTeleporters(ctx, time);
    if (this.intro < 1) {
      // Drop-in: rows land top to bottom, columns ripple from the centre.
      for (const b of this.bricks) {
        const delay = b.row * 0.045 + Math.abs(b.col - (COLS - 1) / 2) * 0.018;
        const t = clamp((this.intro * 1.6 - delay) / 0.55, 0, 1);
        if (t <= 0) continue;
        const k = easeOutBack(t);
        const y = b.y - (1 - k) * 420;
        ctx.globalAlpha = Math.min(1, t * 2);
        ctx.drawImage(spr.brickShadow, b.x + SHADOW_DX * k - 16, y + SHADOW_DY * k - 16);
        ctx.drawImage(spr.bricks[b.ch]!, b.x, y);
        ctx.globalAlpha = 1;
      }
      return;
    }
    if (this.dirty) this.rebuild();
    ctx.drawImage(this.layer.canvas, FIELD.x, FIELD.y);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.bricks) {
      if (b.alive) {
        if (b.flash > 0) {
          ctx.globalAlpha = b.flash * 0.8;
          ctx.drawImage(spr.brickFlash, b.x, b.y);
          ctx.globalAlpha = 1;
        }
        if (b.kind === 'regen') {
          const p = 0.5 + 0.5 * Math.sin(time * 3 + b.col * 0.7 + b.row);
          drawGlow(ctx, '#ff40f0', b.x + BRICK_W / 2, b.y + BRICK_H / 2, 56, 0.18 + p * 0.22);
        } else if (b.kind === 'explosive') {
          const p = 0.5 + 0.5 * Math.sin(time * 6 + b.col);
          drawGlow(ctx, '#ff7a1a', b.x + BRICK_W / 2, b.y + BRICK_H / 2, 34, 0.25 + p * 0.35);
          if (b.fuse > 0) drawGlow(ctx, '#ffffff', b.x + BRICK_W / 2, b.y + BRICK_H / 2, 70, 0.8);
        }
      } else if (b.kind === 'regen' && b.regenTimer > 0 && b.regenTimer < 2.6) {
        // Ghost outline flickers faster and faster as the brick is about to return.
        const f = 1 - b.regenTimer / 2.6;
        const blink = Math.sin(time * (8 + f * 30)) > 0 ? 1 : 0.3;
        ctx.globalAlpha = (0.25 + f * 0.6) * blink;
        ctx.drawImage(spr.regenGhost, b.x, b.y);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  private renderTeleporters(ctx: Ctx, time: number): void {
    for (let i = 0; i < this.teleporters.length; i++) {
      const t = this.teleporters[i]!;
      const hue = i % 4 < 2 ? '#30e0ff' : '#ff8a30';
      ctx.save();
      ctx.translate(t.x, t.y);
      // Dark well.
      const well = ctx.createRadialGradient(0, 0, 4, 0, 0, 34);
      well.addColorStop(0, '#000000');
      well.addColorStop(0.7, 'rgba(0,10,20,0.85)');
      well.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = well;
      ctx.beginPath();
      ctx.ellipse(0, 0, 44, 30, 0, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const a = time * (2.4 + k * 0.6) * (i % 2 ? -1 : 1) + k * 2.1;
        ctx.strokeStyle = hue;
        ctx.globalAlpha = 0.55 - k * 0.12;
        ctx.lineWidth = 4 - k;
        ctx.beginPath();
        ctx.ellipse(0, 0, 38 - k * 9, 24 - k * 6, 0, a, a + Math.PI * 1.3);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      drawGlow(ctx, hue, 0, 0, 60, 0.45 + 0.15 * Math.sin(t.pulse * 4));
      ctx.restore();
    }
  }
}
