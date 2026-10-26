import { BRICK_H, BRICK_W, PADDLE_H } from '../config';
import { capsulePath, createSurface, roundRectPath, shade, type Ctx, type Surface } from './canvas';
import { drawText, textWidth, type TextStyle } from './font';

export const BRICK_COLORS: Record<string, string> = {
  r: '#e3262c',
  o: '#ff8618',
  y: '#ffd22a',
  l: '#a6ea3a',
  g: '#36c25a',
  c: '#26cfe6',
  b: '#2e69ff',
  v: '#9447ff',
  p: '#ff58c4',
  w: '#eef2f8',
  k: '#737b88',
  n: '#9b5a2b',
  S: '#c9ced6',
  G: '#f2c03c',
  R: '#ff3df0',
  X: '#ff5a1a',
};

/** Margin around the pill inside its 112x56 grid cell. */
const INSET = 4;
export const PILL = { x: INSET, y: INSET, w: BRICK_W - INSET * 2, h: BRICK_H - INSET * 2 };
const PILL_R = 19;

function pillPath(ctx: Ctx, x = PILL.x, y = PILL.y, w = PILL.w, h = PILL.h, r = PILL_R): void {
  roundRectPath(ctx, x, y, w, h, r);
}

function glossyPill(ctx: Ctx, base: string): void {
  const { x, y, w, h } = PILL;
  pillPath(ctx);
  const v = ctx.createLinearGradient(0, y, 0, y + h);
  v.addColorStop(0, shade(base, 0.45));
  v.addColorStop(0.16, shade(base, 0.16));
  v.addColorStop(0.52, base);
  v.addColorStop(0.84, shade(base, -0.38));
  v.addColorStop(1, shade(base, -0.62));
  ctx.fillStyle = v;
  ctx.fill();

  ctx.save();
  pillPath(ctx);
  ctx.clip();
  // Cylindrical falloff towards both rounded ends.
  const hz = ctx.createLinearGradient(x, 0, x + w, 0);
  hz.addColorStop(0, 'rgba(0,0,0,0.32)');
  hz.addColorStop(0.14, 'rgba(0,0,0,0)');
  hz.addColorStop(0.86, 'rgba(0,0,0,0)');
  hz.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = hz;
  ctx.fillRect(x, y, w, h);

  // Broad specular band.
  const sx = x + w * 0.36;
  const sy = y + h * 0.26;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(1, 0.32);
  const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.36);
  sg.addColorStop(0, 'rgba(255,255,255,0.85)');
  sg.addColorStop(0.5, 'rgba(255,255,255,0.32)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Bounce light along the bottom edge.
  const bl = ctx.createLinearGradient(0, y + h - 12, 0, y + h);
  bl.addColorStop(0, 'rgba(255,255,255,0)');
  bl.addColorStop(0.7, shade(base, 0.25, 0.35));
  bl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = bl;
  ctx.fillRect(x + 14, y + h - 12, w - 28, 12);
  ctx.restore();

  // Hotspot + the little cyan glint the original bricks have in their corner.
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(x + 17, y + 12, 5, 3.4, -0.4, 0, Math.PI * 2);
  ctx.fill();
  const gl = ctx.createRadialGradient(x + w - 11, y + h - 9, 0, x + w - 11, y + h - 9, 7);
  gl.addColorStop(0, 'rgba(190,240,255,0.95)');
  gl.addColorStop(1, 'rgba(60,160,255,0)');
  ctx.fillStyle = gl;
  ctx.fillRect(x + w - 20, y + h - 18, 18, 18);

  pillPath(ctx);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = shade(base, -0.7, 0.75);
  ctx.stroke();
}

function silverPill(ctx: Ctx): void {
  const { x, y, w, h } = PILL;
  pillPath(ctx, x, y, w, h, 12);
  const v = ctx.createLinearGradient(0, y, 0, y + h);
  v.addColorStop(0, '#ffffff');
  v.addColorStop(0.18, '#e4e8ee');
  v.addColorStop(0.46, '#aab2bd');
  v.addColorStop(0.5, '#6e7682');
  v.addColorStop(0.72, '#a3abb6');
  v.addColorStop(1, '#4a505a');
  ctx.fillStyle = v;
  ctx.fill();
  ctx.save();
  pillPath(ctx, x, y, w, h, 12);
  ctx.clip();
  // Brushed metal streaks.
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.06})`;
    ctx.fillRect(x, y + Math.random() * h, w, 1);
  }
  ctx.restore();
  // Engraved inner frame + rivets.
  roundRectPath(ctx, x + 7, y + 7, w - 14, h - 14, 7);
  ctx.strokeStyle = 'rgba(40,44,52,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  roundRectPath(ctx, x + 8, y + 8.5, w - 16, h - 16, 6);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
  for (const rx of [x + 14, x + w - 14]) {
    const g = ctx.createRadialGradient(rx - 1.5, y + h / 2 - 1.5, 0, rx, y + h / 2, 5);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.6, '#8d95a1');
    g.addColorStop(1, '#3b4049');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(rx, y + h / 2, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  pillPath(ctx, x, y, w, h, 12);
  ctx.strokeStyle = 'rgba(30,32,38,0.8)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

function goldPlate(ctx: Ctx): void {
  const { x, y, w, h } = PILL;
  roundRectPath(ctx, x, y, w, h, 7);
  const v = ctx.createLinearGradient(0, y, 0, y + h);
  v.addColorStop(0, '#fff8cf');
  v.addColorStop(0.2, '#ffd86a');
  v.addColorStop(0.48, '#d79a1c');
  v.addColorStop(0.52, '#a66b08');
  v.addColorStop(0.78, '#e2aa30');
  v.addColorStop(1, '#6b4204');
  ctx.fillStyle = v;
  ctx.fill();
  // Bevel.
  roundRectPath(ctx, x + 5, y + 5, w - 10, h - 10, 4);
  const b = ctx.createLinearGradient(0, y + 5, 0, y + h - 5);
  b.addColorStop(0, '#ffe58c');
  b.addColorStop(0.5, '#c58614');
  b.addColorStop(1, '#ffdf7a');
  ctx.strokeStyle = b;
  ctx.lineWidth = 3;
  ctx.stroke();
  // Diamond emblem.
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 12);
  ctx.lineTo(cx + 18, cy);
  ctx.lineTo(cx, cy + 12);
  ctx.lineTo(cx - 18, cy);
  ctx.closePath();
  const d = ctx.createLinearGradient(0, cy - 12, 0, cy + 12);
  d.addColorStop(0, '#fffbe0');
  d.addColorStop(0.5, '#e7a92a');
  d.addColorStop(1, '#8a5604');
  ctx.fillStyle = d;
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,55,0,0.8)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // Corner bolts.
  for (const [bx, by] of [
    [x + 10, y + 10],
    [x + w - 10, y + 10],
    [x + 10, y + h - 10],
    [x + w - 10, y + h - 10],
  ] as const) {
    ctx.fillStyle = '#7a4c06';
    ctx.beginPath();
    ctx.arc(bx, by + 0.8, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff1b0';
    ctx.beginPath();
    ctx.arc(bx - 0.6, by - 0.6, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  roundRectPath(ctx, x, y, w, h, 7);
  ctx.strokeStyle = 'rgba(70,40,0,0.9)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

function regenCrystal(ctx: Ctx): void {
  const { x, y, w, h } = PILL;
  pillPath(ctx);
  const v = ctx.createLinearGradient(0, y, 0, y + h);
  v.addColorStop(0, 'rgba(255,200,255,0.95)');
  v.addColorStop(0.3, 'rgba(230,70,230,0.85)');
  v.addColorStop(0.7, 'rgba(120,20,160,0.9)');
  v.addColorStop(1, 'rgba(50,0,80,0.95)');
  ctx.fillStyle = v;
  ctx.fill();
  ctx.save();
  pillPath(ctx);
  ctx.clip();
  // Facets.
  ctx.strokeStyle = 'rgba(255,220,255,0.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const fx = x + 8 + i * 18;
    ctx.moveTo(fx, y);
    ctx.lineTo(fx + 14, y + h);
  }
  ctx.stroke();
  const core = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, 30);
  core.addColorStop(0, 'rgba(255,255,255,0.9)');
  core.addColorStop(0.4, 'rgba(255,120,250,0.5)');
  core.addColorStop(1, 'rgba(255,0,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(x + 18, y + 11, 6, 3, -0.3, 0, Math.PI * 2);
  ctx.fill();
  pillPath(ctx);
  ctx.strokeStyle = 'rgba(255,170,255,0.9)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

function explosiveBrick(ctx: Ctx): void {
  const { x, y, w, h } = PILL;
  pillPath(ctx);
  const v = ctx.createLinearGradient(0, y, 0, y + h);
  v.addColorStop(0, '#6a6f78');
  v.addColorStop(0.2, '#2b2f36');
  v.addColorStop(0.8, '#121418');
  v.addColorStop(1, '#050607');
  ctx.fillStyle = v;
  ctx.fill();
  ctx.save();
  pillPath(ctx);
  ctx.clip();
  // Hazard band.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y + h / 2 - 9, w, 18);
  ctx.clip();
  ctx.fillStyle = '#ffc21a';
  ctx.fillRect(x, y + h / 2 - 9, w, 18);
  ctx.fillStyle = '#141414';
  for (let i = -2; i < 10; i++) {
    ctx.beginPath();
    const sx = x + i * 16;
    ctx.moveTo(sx, y + h / 2 + 9);
    ctx.lineTo(sx + 8, y + h / 2 + 9);
    ctx.lineTo(sx + 26, y + h / 2 - 9);
    ctx.lineTo(sx + 18, y + h / 2 - 9);
    ctx.closePath();
    ctx.fill();
  }
  const shadeBand = ctx.createLinearGradient(0, y + h / 2 - 9, 0, y + h / 2 + 9);
  shadeBand.addColorStop(0, 'rgba(255,255,255,0.35)');
  shadeBand.addColorStop(0.5, 'rgba(0,0,0,0)');
  shadeBand.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = shadeBand;
  ctx.fillRect(x, y + h / 2 - 9, w, 18);
  ctx.restore();
  ctx.restore();
  // Warning core.
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.fillStyle = '#1a0a05';
  ctx.beginPath();
  ctx.arc(cx, cy, 11, 0, Math.PI * 2);
  ctx.fill();
  const core = ctx.createRadialGradient(cx - 2, cy - 2, 0, cx, cy, 9);
  core.addColorStop(0, '#fff6c0');
  core.addColorStop(0.4, '#ff9a1a');
  core.addColorStop(1, '#a01a00');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, 8.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.ellipse(x + 18, y + 11, 6, 3, -0.3, 0, Math.PI * 2);
  ctx.fill();
  pillPath(ctx);
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

function crackOverlay(level: number): HTMLCanvasElement {
  const { canvas, ctx } = createSurface(BRICK_W, BRICK_H);
  const { x, y, w, h } = PILL;
  ctx.save();
  pillPath(ctx, x, y, w, h, 12);
  ctx.clip();
  const rays = level === 1 ? 4 : 8;
  const ox = x + w * (0.4 + Math.random() * 0.2);
  const oy = y + h * (0.35 + Math.random() * 0.3);
  for (let i = 0; i < rays; i++) {
    let px = ox;
    let py = oy;
    let a = (i / rays) * Math.PI * 2 + Math.random() * 0.6;
    ctx.beginPath();
    ctx.moveTo(px, py);
    const len = 4 + Math.floor(Math.random() * 4);
    for (let s = 0; s < len; s++) {
      a += (Math.random() - 0.5) * 0.9;
      px += Math.cos(a) * 8;
      py += Math.sin(a) * 5;
      ctx.lineTo(px, py);
    }
    ctx.strokeStyle = 'rgba(20,22,28,0.85)';
    ctx.lineWidth = level === 1 ? 1.6 : 2.2;
    ctx.stroke();
    ctx.translate(0.8, 0.8);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.translate(-0.8, -0.8);
  }
  ctx.restore();
  return canvas;
}

function brickShadow(): HTMLCanvasElement {
  const pad = 16;
  const { canvas, ctx } = createSurface(BRICK_W + pad * 2, BRICK_H + pad * 2);
  ctx.filter = 'blur(5px)';
  ctx.fillStyle = 'rgba(0,10,14,0.55)';
  pillPath(ctx, pad + PILL.x, pad + PILL.y, PILL.w, PILL.h);
  ctx.fill();
  return canvas;
}

/** White pill used for hit flashes (drawn additively over a brick). */
function flashPill(): HTMLCanvasElement {
  const { canvas, ctx } = createSurface(BRICK_W, BRICK_H);
  pillPath(ctx);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return canvas;
}

function outlinePill(color: string): HTMLCanvasElement {
  const { canvas, ctx } = createSurface(BRICK_W, BRICK_H);
  pillPath(ctx);
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  return canvas;
}

function makeBrick(ch: string): HTMLCanvasElement {
  const { canvas, ctx } = createSurface(BRICK_W, BRICK_H);
  if (ch === 'S') silverPill(ctx);
  else if (ch === 'G') goldPlate(ctx);
  else if (ch === 'R') regenCrystal(ctx);
  else if (ch === 'X') explosiveBrick(ctx);
  else glossyPill(ctx, BRICK_COLORS[ch] ?? '#888888');
  return canvas;
}

// ---------------------------------------------------------------------------
// Ball

function makeBall(r: number, kind: 'normal' | 'fire'): HTMLCanvasElement {
  const m = 4;
  const { canvas, ctx } = createSurface(r * 2 + m * 2, r * 2 + m * 2);
  const c = r + m;
  const g = ctx.createRadialGradient(c - r * 0.38, c - r * 0.42, r * 0.05, c, c, r);
  if (kind === 'fire') {
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, '#d8f8ff');
    g.addColorStop(0.6, '#4cc2ff');
    g.addColorStop(0.9, '#1a4fd6');
    g.addColorStop(1, '#0b1f70');
  } else {
    g.addColorStop(0, '#fffdf0');
    g.addColorStop(0.22, '#ffe48a');
    g.addColorStop(0.58, '#ff9c1c');
    g.addColorStop(0.88, '#c0400a');
    g.addColorStop(1, '#5a1804');
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  // Rim light from the playfield below.
  const rim = ctx.createRadialGradient(c + r * 0.3, c + r * 0.45, r * 0.2, c, c, r);
  rim.addColorStop(0.7, 'rgba(120,255,240,0)');
  rim.addColorStop(1, 'rgba(120,255,240,0.35)');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(c - r * 0.38, c - r * 0.42, r * 0.26, r * 0.17, -0.6, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

function makeRoundShadow(r: number): HTMLCanvasElement {
  const pad = 10;
  const { canvas, ctx } = createSurface(r * 2 + pad * 2, r * 2 + pad * 2);
  ctx.filter = 'blur(4px)';
  ctx.fillStyle = 'rgba(0,8,12,0.5)';
  ctx.beginPath();
  ctx.arc(r + pad, r + pad, r, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

// ---------------------------------------------------------------------------
// Paddle: built from a left cap, a stretchable tube slice and a right cap so its
// width can animate smoothly without re-rendering.

export const PADDLE_CAP = 48;

function paddleTube(): HTMLCanvasElement {
  const h = PADDLE_H;
  const { canvas, ctx } = createSurface(8, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#5e6b64');
  g.addColorStop(0.08, '#f3fbf6');
  g.addColorStop(0.24, '#d2e2d8');
  g.addColorStop(0.5, '#93ab9e');
  g.addColorStop(0.62, '#7d978a');
  g.addColorStop(0.84, '#4e6358');
  g.addColorStop(1, '#1f2924');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, h);
  return canvas;
}

function paddleCap(side: 'left' | 'right'): HTMLCanvasElement {
  const h = PADDLE_H;
  const w = PADDLE_CAP;
  const { canvas, ctx } = createSurface(w, h);
  ctx.save();
  if (side === 'right') {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  // Red rounded nose.
  ctx.beginPath();
  ctx.moveTo(w, 2);
  ctx.lineTo(h / 2, 2);
  ctx.arc(h / 2, h / 2, h / 2 - 2, -Math.PI / 2, Math.PI / 2, true);
  ctx.lineTo(w, h - 2);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#ffb0a0');
  g.addColorStop(0.18, '#ff4a3a');
  g.addColorStop(0.55, '#c8140e');
  g.addColorStop(0.85, '#6a0604');
  g.addColorStop(1, '#2a0201');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.ellipse(h * 0.42, h * 0.24, 9, 3.5, -0.2, 0, Math.PI * 2);
  ctx.fill();
  // Chrome / gold ring between nose and tube.
  const rx = w - 12;
  const rg = ctx.createLinearGradient(0, 0, 0, h);
  rg.addColorStop(0, '#fff6c8');
  rg.addColorStop(0.3, '#ffcf3a');
  rg.addColorStop(0.6, '#b07806');
  rg.addColorStop(1, '#4a3000');
  ctx.fillStyle = rg;
  roundRectPath(ctx, rx, 0, 12, h, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(rx + 2, 3, 3, h - 6);
  ctx.restore();
  return canvas;
}

function paddleCore(): HTMLCanvasElement {
  const h = PADDLE_H;
  const w = 56;
  const { canvas, ctx } = createSurface(w, h + 12);
  // Ventral nub (visible under the original's paddle).
  const ng = ctx.createLinearGradient(0, h - 4, 0, h + 10);
  ng.addColorStop(0, '#9bb0a4');
  ng.addColorStop(1, '#2a3530');
  ctx.fillStyle = ng;
  roundRectPath(ctx, w / 2 - 9, h - 6, 18, 16, 5);
  ctx.fill();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#3a6a4a');
  g.addColorStop(0.1, '#d8ffe4');
  g.addColorStop(0.3, '#8ff0b0');
  g.addColorStop(0.55, '#3fbf6e');
  g.addColorStop(0.85, '#17603a');
  g.addColorStop(1, '#08261a');
  ctx.fillStyle = g;
  ctx.fillRect(6, 0, w - 12, h);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(6, 0, 2, h);
  ctx.fillRect(w - 8, 0, 2, h);
  return canvas;
}

function laserCannon(): HTMLCanvasElement {
  const { canvas, ctx } = createSurface(18, 30);
  const g = ctx.createLinearGradient(0, 0, 18, 0);
  g.addColorStop(0, '#3a3f48');
  g.addColorStop(0.35, '#f4f6fa');
  g.addColorStop(0.7, '#8a909c');
  g.addColorStop(1, '#2a2e35');
  ctx.fillStyle = g;
  roundRectPath(ctx, 3, 4, 12, 26, 3);
  ctx.fill();
  ctx.fillStyle = '#ff3a2a';
  roundRectPath(ctx, 2, 0, 14, 8, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,220,200,0.8)';
  ctx.fillRect(5, 1.5, 4, 2);
  return canvas;
}

// ---------------------------------------------------------------------------
// Power-up capsules

export const CAPSULE_W = 96;
export const CAPSULE_H = 44;

function makeCapsule(color: string, label: string): HTMLCanvasElement {
  const w = CAPSULE_W;
  const h = CAPSULE_H;
  const { canvas, ctx } = createSurface(w, h);
  // Glass body.
  capsulePath(ctx, 1, 1, w - 2, h - 2);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, shade(color, 0.55));
  g.addColorStop(0.25, shade(color, 0.1));
  g.addColorStop(0.6, color);
  g.addColorStop(1, shade(color, -0.6));
  ctx.fillStyle = g;
  ctx.fill();
  // Chrome end caps.
  ctx.save();
  capsulePath(ctx, 1, 1, w - 2, h - 2);
  ctx.clip();
  const cg = ctx.createLinearGradient(0, 0, 0, h);
  cg.addColorStop(0, '#ffffff');
  cg.addColorStop(0.35, '#c4cad3');
  cg.addColorStop(0.55, '#6a717c');
  cg.addColorStop(1, '#2c3038');
  ctx.fillStyle = cg;
  ctx.fillRect(0, 0, 20, h);
  ctx.fillRect(w - 20, 0, 20, h);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(19, 0, 2, h);
  ctx.fillRect(w - 21, 0, 2, h);
  ctx.restore();
  // Label.
  const style: TextStyle = { size: label.length > 2 ? 3.4 : 4.2, top: '#ffffff', bottom: shade(color, 0.6), outline: true };
  const tw = textWidth(label, style);
  drawText(ctx, label, w / 2 - tw / 2, h / 2 - (7 * style.size) / 2, style);
  // Gloss.
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.24, w * 0.32, h * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  capsulePath(ctx, 1, 1, w - 2, h - 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  return canvas;
}

// ---------------------------------------------------------------------------

export interface SpriteBank {
  bricks: Record<string, HTMLCanvasElement>;
  cracks: HTMLCanvasElement[];
  brickShadow: HTMLCanvasElement;
  brickFlash: HTMLCanvasElement;
  regenGhost: HTMLCanvasElement;
  ball: HTMLCanvasElement;
  ballBig: HTMLCanvasElement;
  ballFire: HTMLCanvasElement;
  ballFireBig: HTMLCanvasElement;
  ballShadow: HTMLCanvasElement;
  ballShadowBig: HTMLCanvasElement;
  paddleTube: HTMLCanvasElement;
  paddleCapL: HTMLCanvasElement;
  paddleCapR: HTMLCanvasElement;
  paddleCore: HTMLCanvasElement;
  laserCannon: HTMLCanvasElement;
  capsule: (color: string, label: string) => HTMLCanvasElement;
  capsuleShadow: HTMLCanvasElement;
}

let bank: SpriteBank | null = null;

export function sprites(): SpriteBank {
  if (bank) return bank;
  const bricks: Record<string, HTMLCanvasElement> = {};
  for (const ch of Object.keys(BRICK_COLORS)) bricks[ch] = makeBrick(ch);
  const capsules = new Map<string, HTMLCanvasElement>();
  const capShadow: Surface = createSurface(CAPSULE_W + 24, CAPSULE_H + 24);
  capShadow.ctx.filter = 'blur(5px)';
  capShadow.ctx.fillStyle = 'rgba(0,8,12,0.5)';
  capsulePath(capShadow.ctx, 12, 12, CAPSULE_W, CAPSULE_H);
  capShadow.ctx.fill();
  bank = {
    bricks,
    cracks: [crackOverlay(1), crackOverlay(2)],
    brickShadow: brickShadow(),
    brickFlash: flashPill(),
    regenGhost: outlinePill('rgba(255,140,255,0.8)'),
    ball: makeBall(13, 'normal'),
    ballBig: makeBall(22, 'normal'),
    ballFire: makeBall(13, 'fire'),
    ballFireBig: makeBall(22, 'fire'),
    ballShadow: makeRoundShadow(13),
    ballShadowBig: makeRoundShadow(22),
    paddleTube: paddleTube(),
    paddleCapL: paddleCap('left'),
    paddleCapR: paddleCap('right'),
    paddleCore: paddleCore(),
    laserCannon: laserCannon(),
    capsule: (color, label) => {
      const key = color + label;
      let c = capsules.get(key);
      if (!c) {
        c = makeCapsule(color, label);
        capsules.set(key, c);
      }
      return c;
    },
    capsuleShadow: capShadow.canvas,
  };
  return bank;
}
