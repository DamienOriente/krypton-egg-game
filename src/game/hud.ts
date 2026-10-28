import { FIELD, PADDLE_H } from '../config';
import { pad } from '../core/math';
import { HUD_PANELS, SIDE } from '../render/background';
import { drawGlow, roundRectPath, type Ctx } from '../render/canvas';
import { drawText, STYLE, textWidth, type TextStyle } from '../render/font';
import { sprites } from '../render/sprites';
import { POWERS, type PowerId } from './powerups';

export interface HudData {
  score: number;
  high: number;
  lives: number;
  levelLabel: string;
  levelName: string;
  bricksLeft: number | null;
  effects: { id: PowerId; left: number; permanent?: boolean }[];
  boss: { name: string; hp: number; max: number } | null;
  time: number;
}

const LABEL = STYLE.hudLabel;
const DIGITS = STYLE.hudDigits;
const SIDE_LABEL: TextStyle = { size: 4, top: '#bfe9ff', bottom: '#3aa8ff', glow: '#1e90ff', glowBlur: 8 };
const SIDE_VALUE: TextStyle = { size: 10, top: '#e8ffd0', bottom: '#3fd23a', glow: '#3cff5a', glowBlur: 16 };
const SIDE_SMALL: TextStyle = { size: 2.8, top: '#ffffff', bottom: '#9fc6e8' };

function labelled(ctx: Ctx, panel: { x: number; y: number; w: number; h: number }, label: string, value: string): void {
  const gap = 18;
  const colon = ':';
  const lw = textWidth(label, LABEL);
  const cw = textWidth(colon, LABEL);
  const vw = textWidth(value, DIGITS);
  const total = lw + gap + cw + gap + vw;
  const x = panel.x + panel.w / 2 - total / 2;
  const y = panel.y + panel.h / 2 - (7 * LABEL.size) / 2;
  drawText(ctx, label, x, y, LABEL);
  drawText(ctx, colon, x + lw + gap, y, LABEL);
  drawText(ctx, value, x + lw + gap + cw + gap, y, DIGITS);
}

export function drawHud(ctx: Ctx, d: HudData): void {
  labelled(ctx, HUD_PANELS.score, 'SCORE', pad(d.score, 7));
  labelled(ctx, HUD_PANELS.high, 'RECORD', pad(d.high, 7));

  // Lives: mini paddle icon + count, like the original's middle panel.
  const lp = HUD_PANELS.lives;
  const spr = sprites();
  const iconW = 120;
  const iconH = PADDLE_H * 0.7;
  const value = pad(d.lives, 2);
  const vw = textWidth(value, DIGITS) + textWidth(':', LABEL) + 18;
  const total = iconW + 30 + vw;
  const ix = lp.x + lp.w / 2 - total / 2;
  const iy = lp.y + lp.h / 2 - iconH / 2;
  const capW = 34;
  ctx.drawImage(spr.paddleCapL, ix, iy, capW, iconH);
  ctx.drawImage(spr.paddleTube, ix + capW, iy, iconW - capW * 2, iconH);
  ctx.drawImage(spr.paddleCapR, ix + iconW - capW, iy, capW, iconH);
  const ty = lp.y + lp.h / 2 - (7 * LABEL.size) / 2;
  drawText(ctx, ':', ix + iconW + 30, ty, LABEL);
  drawText(ctx, value, ix + iconW + 30 + textWidth(':', LABEL) + 18, ty, DIGITS);

  drawLeftPanel(ctx, d);
  drawRightPanel(ctx, d);
  if (d.boss) drawBossBar(ctx, d.boss, d.time);
}

function drawLeftPanel(ctx: Ctx, d: HudData): void {
  const p = SIDE.left;
  const cx = p.x + p.w / 2;
  let y = p.y + 40;
  drawText(ctx, 'NIVEAU', cx, y, SIDE_LABEL, 'center');
  y += 48;
  drawText(ctx, d.levelLabel, cx, y, d.levelLabel.length > 2 ? { ...SIDE_VALUE, size: 6.5 } : SIDE_VALUE, 'center');
  y += 110;
  if (d.bricksLeft !== null) {
    drawText(ctx, 'BRIQUES', cx, y, SIDE_LABEL, 'center');
    y += 44;
    drawText(ctx, pad(d.bricksLeft, 3), cx, y, { ...SIDE_VALUE, size: 7 }, 'center');
    y += 100;
  }
  // Level name, wrapped on words to fit the narrow column.
  const words = d.levelName.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, SIDE_SMALL) > p.w - 14 && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  for (const line of lines) {
    drawText(ctx, line, cx, y, SIDE_SMALL, 'center');
    y += 34;
  }

  // Decorative vertical logo at the bottom of the column.
  const logo = 'KRYPTON';
  const ls: TextStyle = { size: 6, top: '#fff6c8', bottom: '#ff8a1e', glow: '#ff7a00', glowBlur: 14 };
  let ly = 1440 - 60 - logo.length * 54;
  for (const ch of logo) {
    drawText(ctx, ch, cx, ly, ls, 'center', 0.5);
    ly += 54;
  }
}

function drawRightPanel(ctx: Ctx, d: HudData): void {
  const p = SIDE.right;
  const cx = p.x + p.w / 2;
  let y = p.y + 40;
  drawText(ctx, 'BONUS', cx, y, SIDE_LABEL, 'center');
  y += 56;
  const spr = sprites();
  for (const e of d.effects) {
    const def = POWERS[e.id];
    const cap = spr.capsule(def.color, def.label);
    const w = 96 * 0.9;
    const h = 44 * 0.9;
    const blink = e.left < 3 && Math.sin(d.time * 14) < 0 ? 0.35 : 1;
    ctx.globalAlpha = blink;
    ctx.drawImage(cap, cx - w / 2, y, w, h);
    ctx.globalAlpha = 1;
    y += h + 10;
    if (e.permanent) {
      drawText(ctx, 'PERMANENT', cx, y - 2, SIDE_SMALL, 'center', 0.85);
      y += 34;
      continue;
    }
    const bw = p.w - 40;
    const frac = Math.max(0, Math.min(1, e.left / def.duration));
    roundRectPath(ctx, cx - bw / 2, y, bw, 10, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    roundRectPath(ctx, cx - bw / 2, y, bw * frac, 10, 5);
    ctx.fillStyle = def.good ? '#3fd23a' : '#ff3a3a';
    ctx.fill();
    y += 34;
    if (y > 1360) break;
  }
  if (!d.effects.length) drawText(ctx, '---', cx, y, SIDE_SMALL, 'center', 0.5);
}

function drawBossBar(ctx: Ctx, b: { name: string; hp: number; max: number }, time: number): void {
  const w = 900;
  const x = FIELD.x + FIELD.w / 2 - w / 2;
  const y = FIELD.y + 18;
  roundRectPath(ctx, x - 6, y - 6, w + 12, 30, 15);
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,80,120,0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
  const frac = Math.max(0, b.hp / b.max);
  roundRectPath(ctx, x, y, w * frac, 18, 9);
  const g = ctx.createLinearGradient(0, y, 0, y + 18);
  g.addColorStop(0, '#ffd0d8');
  g.addColorStop(0.4, '#ff3a5a');
  g.addColorStop(1, '#7a0016');
  ctx.fillStyle = g;
  ctx.fill();
  if (frac > 0) drawGlow(ctx, '#ff2a4a', x + w * frac, y + 9, 40, 0.6 + 0.3 * Math.sin(time * 10));
  drawText(ctx, b.name, FIELD.x + FIELD.w / 2, y + 36, { size: 4, top: '#ffe0e6', bottom: '#ff5a7a', outline: true }, 'center');
}
