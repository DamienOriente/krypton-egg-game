import { BRICK_H, BRICK_W, VIEW_H, VIEW_W } from '../config';
import { TAU, pad, rand } from '../core/math';
import { titleBackground } from '../render/background';
import { drawGlow, roundRectPath, type Ctx } from '../render/canvas';
import { drawText, STYLE, textWidth, type TextStyle } from '../render/font';
import { BRICK_COLORS, CAPSULE_H, CAPSULE_W, sprites } from '../render/sprites';
import { Boss } from './boss';
import { POWER_LIST } from './powerups';
import type { ScoreEntry } from './session';

interface Floater {
  ch: string;
  x: number;
  y: number;
  vy: number;
  rot: number;
  vr: number;
  scale: number;
  alpha: number;
}

export interface MenuItem {
  id: string;
  label: string;
}

const MENU_Y = 470;
const MENU_STEP = 92;
const LEGEND = { x: 1795, y: 400, w: 730, h: 940 };
const LEGEND_NAME: TextStyle = { size: 3.6, top: '#ffffff', bottom: '#bcd4f0' };
const LEGEND_DESC: TextStyle = { size: 2.4, top: '#9fb8d8', bottom: '#7a92b4' };

export class TitleScreen {
  private readonly floaters: Floater[] = [];
  private readonly egg = new Boss(6);
  t = 0;
  selected = 0;

  constructor() {
    const keys = Object.keys(BRICK_COLORS).filter((k) => k !== 'G' && k !== 'X');
    for (let i = 0; i < 34; i++) {
      this.floaters.push({
        ch: keys[i % keys.length]!,
        x: rand(0, VIEW_W),
        y: rand(0, VIEW_H),
        vy: rand(-40, -14),
        rot: rand(0, TAU),
        vr: rand(-0.4, 0.4),
        scale: rand(0.5, 1.3),
        alpha: rand(0.15, 0.45),
      });
    }
    this.egg.phase = 'fight';
    this.egg.x = 560;
    this.egg.y = 830;
  }

  update(dt: number): void {
    this.t += dt;
    for (const f of this.floaters) {
      f.y += f.vy * f.scale * dt;
      f.rot += f.vr * dt;
      if (f.y < -100) {
        f.y = VIEW_H + 100;
        f.x = rand(0, VIEW_W);
      }
    }
    // The egg is only used as a picture here: advance its clock without running its AI.
    this.egg.animate(dt);
    this.egg.y = 830 + Math.sin(this.t * 1.1) * 18;
  }

  itemBounds(i: number, items: MenuItem[]): { x: number; y: number; w: number; h: number } {
    const label = items[i]!.label;
    const w = textWidth(label, STYLE.medium) + 140;
    return { x: VIEW_W / 2 - w / 2, y: MENU_Y + i * MENU_STEP - 20, w, h: 7 * STYLE.medium.size + 40 };
  }

  hitTest(x: number, y: number, items: MenuItem[]): number {
    for (let i = 0; i < items.length; i++) {
      const b = this.itemBounds(i, items);
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i;
    }
    return -1;
  }

  render(ctx: Ctx, items: MenuItem[], scores: ScoreEntry[], pointerX: number, audioReady: boolean): void {
    const spr = sprites();
    ctx.drawImage(titleBackground(), 0, 0);
    for (const f of this.floaters) {
      ctx.save();
      ctx.globalAlpha = f.alpha;
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.scale(f.scale, f.scale);
      ctx.drawImage(spr.bricks[f.ch]!, -BRICK_W / 2, -BRICK_H / 2);
      ctx.restore();
    }

    // Logo with a slow light sweep.
    const logoY = 96 + Math.sin(this.t * 1.4) * 6;
    drawGlow(ctx, '#ff7a00', VIEW_W / 2, logoY + 80, 900, 0.18);
    drawText(ctx, 'KRYPTON EGG', VIEW_W / 2, logoY, STYLE.title, 'center');
    const sweep = ((this.t * 0.35) % 1.6) - 0.3;
    drawGlow(ctx, '#ffffff', VIEW_W / 2 - 750 + sweep * 1500, logoY + 77, 160, 0.35);
    drawText(ctx, 'REMAKE 2K  -  D APRES LE JEU D ALEXANDRE KRAL (1989)', VIEW_W / 2, logoY + 196, STYLE.small, 'center', 0.85);

    // Egg emblem; its eye follows the mouse.
    ctx.save();
    ctx.translate(this.egg.x, this.egg.y);
    ctx.scale(0.95, 0.95);
    ctx.translate(-this.egg.x, -this.egg.y);
    this.egg.render(ctx, pointerX);
    ctx.restore();

    // Menu.
    items.forEach((item, i) => {
      const sel = i === this.selected;
      const b = this.itemBounds(i, items);
      if (sel) {
        roundRectPath(ctx, b.x, b.y, b.w, b.h, b.h / 2);
        const g = ctx.createLinearGradient(b.x, 0, b.x + b.w, 0);
        g.addColorStop(0, 'rgba(255,150,30,0)');
        g.addColorStop(0.5, 'rgba(255,150,30,0.22)');
        g.addColorStop(1, 'rgba(255,150,30,0)');
        ctx.fillStyle = g;
        ctx.fill();
        const bob = Math.sin(this.t * 6) * 8;
        drawText(ctx, '>', b.x + 30 + bob, MENU_Y + i * MENU_STEP, STYLE.gold);
        drawText(ctx, '<', b.x + b.w - 30 - 45 - bob, MENU_Y + i * MENU_STEP, STYLE.gold);
      }
      drawText(ctx, item.label, VIEW_W / 2, MENU_Y + i * MENU_STEP, sel ? STYLE.gold : STYLE.medium, 'center', sel ? 1 : 0.75);
    });

    // High scores.
    const sy = MENU_Y + items.length * MENU_STEP + 50;
    drawText(ctx, 'MEILLEURS SCORES', VIEW_W / 2, sy, STYLE.pink, 'center');
    const rows = scores.length ? scores : [];
    for (let i = 0; i < 5; i++) {
      const e = rows[i];
      const line = e ? `${i + 1}.  ${pad(e.score, 7)}   NIV ${pad(e.level, 2)}` : `${i + 1}.  -------   ------`;
      drawText(ctx, line, VIEW_W / 2, sy + 90 + i * 54, { size: 5, top: '#e8ffd0', bottom: '#3fd23a', glow: '#3cff5a', glowBlur: 8 }, 'center', e ? 1 : 0.4);
    }

    this.renderLegend(ctx);

    const hint = 'CLIC GAUCHE : LANCER    CLIC DROIT : TIRER    ECHAP : PAUSE    P : BARRIERE    M : BALLES X3    F : PLEIN ECRAN';
    drawText(ctx, hint, VIEW_W / 2, VIEW_H - 62, { size: 3.6, top: '#cfe2ff', bottom: '#7f9ccc' }, 'center', 0.8);
    if (!audioReady) {
      const a = 0.5 + 0.5 * Math.sin(this.t * 4);
      drawText(ctx, 'CLIQUEZ POUR ACTIVER LE SON', VIEW_W / 2, logoY + 262, STYLE.small, 'center', a);
    }
  }

  private renderLegend(ctx: Ctx): void {
    const spr = sprites();
    const { x, y, w, h } = LEGEND;
    roundRectPath(ctx, x, y, w, h, 24);
    ctx.fillStyle = 'rgba(4,10,20,0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,200,255,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
    drawText(ctx, 'BONUS ET MALUS', x + w / 2, y + 26, { size: 5, top: '#bfe9ff', bottom: '#3aa8ff', glow: '#1e90ff', glowBlur: 10 }, 'center');
    const colW = w / 2;
    const rowH = 93;
    POWER_LIST.forEach((p, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = x + 22 + col * colW;
      const cy = y + 92 + row * rowH;
      const img = spr.capsule(p.color, p.label);
      ctx.drawImage(img, cx, cy, CAPSULE_W * 0.72, CAPSULE_H * 0.72);
      drawText(ctx, p.name, cx + 84, cy + 2, { ...LEGEND_NAME, bottom: p.good ? '#9cf09a' : '#ff9a9a' });
      drawText(ctx, p.desc, cx + 84, cy + 36, LEGEND_DESC);
    });
  }
}
