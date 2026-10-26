import { FIELD, FRAME_T, HUD_H, VIEW_H, VIEW_W } from '../config';
import { createSurface, fbm, makeNoise, roundRectPath, type Ctx } from './canvas';

const TILE_W = 224;
const TILE_H = 168;

export const FRAME = {
  x: FIELD.x - FRAME_T,
  y: FIELD.y - FRAME_T,
  right: FIELD.x + FIELD.w + FRAME_T,
};
export const GATE = { x: FIELD.x + FIELD.w / 2 - 104, w: 208, y: FRAME.y, h: FRAME_T };

export const HUD_PANELS = {
  score: { x: FRAME.x, y: 14, w: 760, h: HUD_H - 26 },
  lives: { x: VIEW_W / 2 - 230, y: 14, w: 460, h: HUD_H - 26 },
  high: { x: FRAME.right - 760, y: 14, w: 760, h: HUD_H - 26 },
};

export const SIDE = {
  left: { x: 18, y: FRAME.y, w: FRAME.x - 36 },
  right: { x: FRAME.right + 18, y: FRAME.y, w: VIEW_W - FRAME.right - 36 },
};

// ---------------------------------------------------------------------------
// Tileable grain texture shared by every metal surface.

let grainTex: HTMLCanvasElement | null = null;
function grain(): HTMLCanvasElement {
  if (grainTex) return grainTex;
  const size = 256;
  const { canvas, ctx } = createSurface(size, size);
  const img = ctx.createImageData(size, size);
  const n = makeNoise(7);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Tileable by sampling on a torus-like wrap of the noise lattice.
      const v =
        fbm(n, (x / size) * 16, (y / size) * 16, 3) * 0.6 +
        fbm(n, (x / size) * 64 + 100, (y / size) * 4, 2) * 0.4;
      const c = Math.floor(v * 255);
      const i = (y * size + x) * 4;
      img.data[i] = c;
      img.data[i + 1] = c;
      img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  grainTex = canvas;
  return canvas;
}

function overlayGrain(ctx: Ctx, x: number, y: number, w: number, h: number, alpha: number): void {
  const pat = ctx.createPattern(grain(), 'repeat');
  if (!pat) return;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pat;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Plate patterns. Palette follows the original's teal metal.

const TEAL = { hi: '#2a95a0', base: '#0f6670', mid: '#0c5761', lo: '#073d45', seam: '#042a30' };

function plateBevel(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = TEAL.seam;
  ctx.fillRect(x, y, w, h);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#12707a');
  g.addColorStop(1, '#0b5560');
  ctx.fillStyle = g;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  ctx.fillStyle = 'rgba(140,240,240,0.22)';
  ctx.fillRect(x + 2, y + 2, w - 4, 2);
  ctx.fillRect(x + 2, y + 2, 2, h - 4);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x + 2, y + h - 4, w - 4, 2);
  ctx.fillRect(x + w - 4, y + 2, 2, h - 4);
}

function rivet(ctx: Ctx, x: number, y: number, r = 3.2): void {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.arc(x + 1, y + 1.2, r, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, 0, x, y, r);
  g.addColorStop(0, '#9ff2f2');
  g.addColorStop(0.6, '#2d8f99');
  g.addColorStop(1, '#0a4a52');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function tilePyramid(): HTMLCanvasElement {
  const { canvas, ctx } = createSurface(TILE_W, TILE_H);
  plateBevel(ctx, 0, 0, TILE_W, TILE_H);
  for (const [rx, ry] of [
    [10, 10],
    [TILE_W - 10, 10],
    [10, TILE_H - 10],
    [TILE_W - 10, TILE_H - 10],
  ] as const)
    rivet(ctx, rx, ry);
  const s = 104;
  const cx = TILE_W / 2;
  const cy = TILE_H / 2;
  const x0 = cx - s / 2;
  const y0 = cy - s / 2;
  // Recess shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x0 - 2, y0 - 2, s + 8, s + 8);
  const tri = (ax: number, ay: number, bx: number, by: number, col: string): void => {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
  };
  tri(x0, y0, x0 + s, y0, '#2fa3ad');
  tri(x0, y0, x0, y0 + s, '#1b7d88');
  tri(x0 + s, y0, x0 + s, y0 + s, '#0a4c55');
  tri(x0, y0 + s, x0 + s, y0 + s, '#083f47');
  ctx.strokeStyle = 'rgba(160,255,250,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(cx, cy);
  ctx.stroke();
  // Neon green frame, as on the original plates.
  ctx.save();
  ctx.shadowColor = '#3dff8a';
  ctx.shadowBlur = 10;
  ctx.strokeStyle = '#45e08a';
  ctx.lineWidth = 4;
  ctx.strokeRect(x0, y0, s, s);
  ctx.restore();
  ctx.strokeStyle = 'rgba(220,255,230,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 - 1.5, y0 - 1.5, s + 3, s + 3);
  return canvas;
}

function tileRibs(): HTMLCanvasElement {
  const { canvas, ctx } = createSurface(TILE_W, TILE_H);
  plateBevel(ctx, 0, 0, TILE_W, TILE_H);
  const rib = 28;
  for (let y = 8; y + rib <= TILE_H - 4; y += rib) {
    const g = ctx.createLinearGradient(0, y, 0, y + rib);
    g.addColorStop(0, '#2b9aa4');
    g.addColorStop(0.35, '#16808a');
    g.addColorStop(0.8, '#0a4e57');
    g.addColorStop(1, '#052f35');
    ctx.fillStyle = g;
    roundRectPath(ctx, 8, y + 2, TILE_W - 16, rib - 4, 10);
    ctx.fill();
    ctx.fillStyle = 'rgba(190,255,250,0.25)';
    ctx.fillRect(18, y + 5, TILE_W - 36, 2);
  }
  return canvas;
}

function tileStuds(): HTMLCanvasElement {
  const { canvas, ctx } = createSurface(TILE_W, TILE_H);
  plateBevel(ctx, 0, 0, TILE_W, TILE_H);
  const step = 56;
  for (let y = step / 2; y < TILE_H; y += step) {
    for (let x = step / 2; x < TILE_W; x += step) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.arc(x + 3, y + 4, 19, 0, Math.PI * 2);
      ctx.fill();
      const g = ctx.createRadialGradient(x - 7, y - 8, 2, x, y, 19);
      g.addColorStop(0, '#7fe6e8');
      g.addColorStop(0.35, '#1f8e98');
      g.addColorStop(0.85, '#0a4b54');
      g.addColorStop(1, '#063840');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(69,224,138,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return canvas;
}

function tileDiagonal(): HTMLCanvasElement {
  const { canvas, ctx } = createSurface(TILE_W, TILE_H);
  plateBevel(ctx, 0, 0, TILE_W, TILE_H);
  ctx.save();
  ctx.beginPath();
  ctx.rect(4, 4, TILE_W - 8, TILE_H - 8);
  ctx.clip();
  const band = 28;
  for (let i = -TILE_H; i < TILE_W + TILE_H; i += band * 2) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + band, 0);
    ctx.lineTo(i + band - TILE_H, TILE_H);
    ctx.lineTo(i - TILE_H, TILE_H);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,30,36,0.42)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,250,245,0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(i + band, 0);
    ctx.lineTo(i + band - TILE_H, TILE_H);
    ctx.stroke();
  }
  ctx.restore();
  rivet(ctx, TILE_W / 2, TILE_H / 2, 4.5);
  return canvas;
}

function tileGrid(): HTMLCanvasElement {
  const { canvas, ctx } = createSurface(TILE_W, TILE_H);
  ctx.fillStyle = TEAL.seam;
  ctx.fillRect(0, 0, TILE_W, TILE_H);
  const c = 28;
  for (let y = 0; y < TILE_H; y += c) {
    for (let x = 0; x < TILE_W; x += c) {
      const g = ctx.createLinearGradient(x, y, x + c, y + c);
      g.addColorStop(0, '#1a8892');
      g.addColorStop(1, '#0a4f58');
      ctx.fillStyle = g;
      ctx.fillRect(x + 2, y + 2, c - 4, c - 4);
      ctx.fillStyle = 'rgba(160,255,250,0.2)';
      ctx.fillRect(x + 2, y + 2, c - 4, 1.5);
      ctx.fillRect(x + 2, y + 2, 1.5, c - 4);
      ctx.fillStyle = (x / c + y / c) % 7 === 0 ? 'rgba(69,224,138,0.5)' : 'rgba(0,0,0,0.0)';
      ctx.fillRect(x + c / 2 - 3, y + c / 2 - 3, 6, 6);
    }
  }
  return canvas;
}

const TILE_MAKERS = [tilePyramid, tileRibs, tileStuds, tileDiagonal, tileGrid];

function drawPlayfield(ctx: Ctx, pattern: number, boss: boolean): void {
  const tile = TILE_MAKERS[((pattern % TILE_MAKERS.length) + TILE_MAKERS.length) % TILE_MAKERS.length]!();
  const pat = ctx.createPattern(tile, 'repeat');
  ctx.save();
  ctx.beginPath();
  ctx.rect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
  ctx.clip();
  ctx.translate(FIELD.x, FIELD.y);
  if (pat) {
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, FIELD.w, FIELD.h);
  }
  ctx.restore();

  overlayGrain(ctx, FIELD.x, FIELD.y, FIELD.w, FIELD.h, 0.22);

  ctx.save();
  ctx.beginPath();
  ctx.rect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
  ctx.clip();
  if (boss) {
    // 'color' keeps the plates' luminance and only swaps hue: a crimson arena, not a dark one.
    ctx.globalCompositeOperation = 'color';
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#c02848';
    ctx.fillRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  // Overhead light: brighter top centre, darker towards the open bottom.
  const cx = FIELD.x + FIELD.w / 2;
  const light = ctx.createRadialGradient(cx, FIELD.y + 200, 100, cx, FIELD.y + 500, 1500);
  light.addColorStop(0, 'rgba(180,255,250,0.10)');
  light.addColorStop(0.5, 'rgba(0,0,0,0)');
  light.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = light;
  ctx.fillRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
  const bottom = ctx.createLinearGradient(0, FIELD.bottom - 260, 0, FIELD.bottom);
  bottom.addColorStop(0, 'rgba(0,0,0,0)');
  bottom.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = bottom;
  ctx.fillRect(FIELD.x, FIELD.bottom - 260, FIELD.w, 260);
  // Inner shadow cast by the frame.
  const sh = 34;
  const top = ctx.createLinearGradient(0, FIELD.y, 0, FIELD.y + sh);
  top.addColorStop(0, 'rgba(0,0,0,0.65)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top;
  ctx.fillRect(FIELD.x, FIELD.y, FIELD.w, sh);
  const left = ctx.createLinearGradient(FIELD.x, 0, FIELD.x + sh, 0);
  left.addColorStop(0, 'rgba(0,0,0,0.6)');
  left.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = left;
  ctx.fillRect(FIELD.x, FIELD.y, sh, FIELD.h);
  const right = ctx.createLinearGradient(FIELD.right, 0, FIELD.right - sh, 0);
  right.addColorStop(0, 'rgba(0,0,0,0.6)');
  right.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = right;
  ctx.fillRect(FIELD.right - sh, FIELD.y, sh, FIELD.h);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Wooden frame

function woodBar(w: number, h: number, vertical: boolean, seed: number): HTMLCanvasElement {
  const { canvas, ctx } = createSurface(w, h);
  const img = ctx.createImageData(w, h);
  const n = makeNoise(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = vertical ? y : x; // along the grain
      const v = vertical ? x : y; // across the grain
      const warp = fbm(n, u * 0.0035, v * 0.03, 4) * 9;
      const rings = (v * 0.09 + warp) % 1;
      const ring = Math.pow(Math.abs(Math.sin(rings * Math.PI)), 6);
      const streak = fbm(n, u * 0.02 + 50, v * 0.7, 2);
      let t = 0.45 + ring * 0.35 + (streak - 0.5) * 0.5;
      t = Math.max(0, Math.min(1, t));
      const i = (y * w + x) * 4;
      // Mix dark walnut -> warm honey.
      img.data[i] = 58 + t * 150;
      img.data[i + 1] = 30 + t * 92;
      img.data[i + 2] = 14 + t * 46;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Rounded bevel across the bar.
  const g = vertical ? ctx.createLinearGradient(0, 0, w, 0) : ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.12, 'rgba(255,220,170,0.28)');
  g.addColorStop(0.35, 'rgba(255,220,170,0.06)');
  g.addColorStop(0.75, 'rgba(0,0,0,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Varnish sheen.
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = 'rgba(255,200,120,0.25)';
  ctx.fillRect(0, 0, w, h);
  return canvas;
}

// Per-pixel wood is the slowest texture to build; it never changes between levels.
let woodBars: { left: HTMLCanvasElement; right: HTMLCanvasElement; top: HTMLCanvasElement } | null = null;

function drawFrame(ctx: Ctx): void {
  const fullH = VIEW_H - FRAME.y;
  woodBars ??= {
    left: woodBar(FRAME_T, fullH, true, 11),
    right: woodBar(FRAME_T, fullH, true, 23),
    top: woodBar(FRAME.right - FRAME.x, FRAME_T, false, 37),
  };
  const { left, right, top } = woodBars;
  ctx.drawImage(left, FRAME.x, FRAME.y);
  ctx.drawImage(right, FIELD.right, FRAME.y);
  // Mitred corners: the top bar overlaps the uprights with a diagonal cut.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(FRAME.x, FRAME.y);
  ctx.lineTo(FRAME.right, FRAME.y);
  ctx.lineTo(FIELD.right, FIELD.y);
  ctx.lineTo(FIELD.x, FIELD.y);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(top, FRAME.x, FRAME.y);
  ctx.restore();
  ctx.strokeStyle = 'rgba(30,12,4,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(FRAME.x, FRAME.y);
  ctx.lineTo(FIELD.x, FIELD.y);
  ctx.moveTo(FRAME.right, FRAME.y);
  ctx.lineTo(FIELD.right, FIELD.y);
  ctx.stroke();
  // Outer dark edge.
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(FRAME.x + 1.5, VIEW_H);
  ctx.lineTo(FRAME.x + 1.5, FRAME.y + 1.5);
  ctx.lineTo(FRAME.right - 1.5, FRAME.y + 1.5);
  ctx.lineTo(FRAME.right - 1.5, VIEW_H);
  ctx.stroke();
  drawGateClosed(ctx);
}

/** Static closed gate; the opening animation is drawn on top at runtime. */
export function drawGateClosed(ctx: Ctx, open = 0): void {
  const { x, y, w, h } = GATE;
  ctx.save();
  ctx.fillStyle = '#05080c';
  ctx.fillRect(x, y + 6, w, h - 6);
  const half = w / 2;
  const slide = half * open;
  for (const side of [0, 1]) {
    const px = side === 0 ? x - slide : x + half + slide;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#6a4a2c');
    g.addColorStop(0.5, '#3a2616');
    g.addColorStop(1, '#1c110a');
    ctx.fillStyle = g;
    ctx.fillRect(px, y + 4, half, h - 4);
    for (let i = 0; i < 4; i++) {
      const ly = y + 12 + i * 10;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(px + 6, ly, half - 12, 4);
      ctx.fillStyle = 'rgba(255,200,140,0.22)';
      ctx.fillRect(px + 6, ly + 4, half - 12, 1.5);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(side === 0 ? px + half - 2 : px, y + 4, 2, h - 4);
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y + 3, w, h - 3);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// HUD + side panel chrome (static parts)

function hazardBand(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#f08a14';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#1a2a6a';
  for (let i = -h; i < w + h; i += 30) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + 14, y + h);
    ctx.lineTo(x + i + 14 + h, y);
    ctx.lineTo(x + i + h, y);
    ctx.closePath();
    ctx.fill();
  }
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

export function drawNeonPanel(ctx: Ctx, x: number, y: number, w: number, h: number, stripes = true): void {
  const r = h / 2;
  ctx.save();
  // Outer glow.
  ctx.shadowColor = '#18b8ff';
  ctx.shadowBlur = 22;
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = '#0a3f8a';
  ctx.fill();
  ctx.restore();
  // Cyan tube.
  roundRectPath(ctx, x, y, w, h, r);
  const tube = ctx.createLinearGradient(0, y, 0, y + h);
  tube.addColorStop(0, '#c8f6ff');
  tube.addColorStop(0.2, '#28c8ff');
  tube.addColorStop(0.5, '#0a62c8');
  tube.addColorStop(0.8, '#28c8ff');
  tube.addColorStop(1, '#0a3a7a');
  ctx.fillStyle = tube;
  ctx.fill();
  if (stripes) {
    ctx.save();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.clip();
    hazardBand(ctx, x + r, y, w - r * 2, 8);
    hazardBand(ctx, x + r, y + h - 8, w - r * 2, 8);
    ctx.restore();
  }
  // Inner screen.
  const ix = x + 12;
  const iy = y + 12;
  const iw = w - 24;
  const ih = h - 24;
  roundRectPath(ctx, ix, iy, iw, ih, ih / 2);
  const scr = ctx.createLinearGradient(0, iy, 0, iy + ih);
  scr.addColorStop(0, '#020409');
  scr.addColorStop(1, '#0a1220');
  ctx.fillStyle = scr;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.save();
  roundRectPath(ctx, ix, iy, iw, ih, ih / 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let sy = iy; sy < iy + ih; sy += 4) ctx.fillRect(ix, sy, iw, 1);
  ctx.restore();
}

function drawSidePanel(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  roundRectPath(ctx, x, y, w, h, 18);
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, '#0b1422');
  g.addColorStop(0.5, '#101d30');
  g.addColorStop(1, '#0a121e');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,200,255,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  roundRectPath(ctx, x + 6, y + 6, w - 12, h - 12, 14);
  ctx.strokeStyle = 'rgba(40,200,255,0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawBackdrop(ctx: Ctx): void {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, '#060912');
  g.addColorStop(1, '#020306');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  // Faint circuit lines in the margins.
  ctx.strokeStyle = 'rgba(40,160,255,0.06)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const side = i % 2 === 0 ? 0 : FRAME.right;
    const w = i % 2 === 0 ? FRAME.x : VIEW_W - FRAME.right;
    const y = 160 + i * 50;
    ctx.beginPath();
    ctx.moveTo(side + 10, y);
    ctx.lineTo(side + w * 0.5, y);
    ctx.lineTo(side + w * 0.5 + 20, y + 20);
    ctx.lineTo(side + w - 10, y + 20);
    ctx.stroke();
  }
  overlayGrain(ctx, 0, 0, VIEW_W, VIEW_H, 0.08);
}

const bgCache = new Map<string, HTMLCanvasElement>();

export function background(pattern: number, boss = false): HTMLCanvasElement {
  const key = `${pattern}|${boss}`;
  const hit = bgCache.get(key);
  if (hit) return hit;
  const { canvas, ctx } = createSurface(VIEW_W, VIEW_H);
  drawBackdrop(ctx);
  drawPlayfield(ctx, pattern, boss);
  drawFrame(ctx);
  drawNeonPanel(ctx, HUD_PANELS.score.x, HUD_PANELS.score.y, HUD_PANELS.score.w, HUD_PANELS.score.h);
  drawNeonPanel(ctx, HUD_PANELS.lives.x, HUD_PANELS.lives.y, HUD_PANELS.lives.w, HUD_PANELS.lives.h);
  drawNeonPanel(ctx, HUD_PANELS.high.x, HUD_PANELS.high.y, HUD_PANELS.high.w, HUD_PANELS.high.h);
  drawSidePanel(ctx, SIDE.left.x, SIDE.left.y, SIDE.left.w, VIEW_H - SIDE.left.y - 18);
  drawSidePanel(ctx, SIDE.right.x, SIDE.right.y, SIDE.right.w, VIEW_H - SIDE.right.y - 18);
  if (bgCache.size > 4) {
    const first = bgCache.keys().next().value;
    if (first !== undefined) bgCache.delete(first);
  }
  bgCache.set(key, canvas);
  return canvas;
}

/** Title screen backdrop: a full-width plate field without the frame. */
let titleBg: HTMLCanvasElement | null = null;
export function titleBackground(): HTMLCanvasElement {
  if (titleBg) return titleBg;
  const { canvas, ctx } = createSurface(VIEW_W, VIEW_H);
  ctx.fillStyle = '#03050a';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const tile = tilePyramid();
  const pat = ctx.createPattern(tile, 'repeat');
  if (pat) {
    ctx.save();
    ctx.translate(-TILE_W / 2 + ((VIEW_W / 2) % TILE_W), 0);
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, VIEW_W + TILE_W, VIEW_H);
    ctx.restore();
  }
  overlayGrain(ctx, 0, 0, VIEW_W, VIEW_H, 0.2);
  const v = ctx.createRadialGradient(VIEW_W / 2, VIEW_H * 0.42, 200, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.7);
  v.addColorStop(0, 'rgba(0,10,20,0.35)');
  v.addColorStop(1, 'rgba(0,0,0,0.92)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  titleBg = canvas;
  return canvas;
}
