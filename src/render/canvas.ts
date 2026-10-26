export type Ctx = CanvasRenderingContext2D;

export interface Surface {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
}

export function createSurface(w: number, h: number): Surface {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return { canvas, ctx };
}

export function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function capsulePath(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  roundRectPath(ctx, x, y, w, h, h / 2);
}

// ---------------------------------------------------------------------------
// Colour helpers (hex <-> rgb, shading)

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const rgba = (c: Rgb, a = 1): string =>
  `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${a})`;

/** amount > 0 lightens towards white, < 0 darkens towards black. */
export function shade(hex: string, amount: number, alpha = 1): string {
  const c = hexToRgb(hex);
  const t = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  return rgba({ r: c.r + (t - c.r) * k, g: c.g + (t - c.g) * k, b: c.b + (t - c.b) * k }, alpha);
}

export const withAlpha = (hex: string, a: number): string => rgba(hexToRgb(hex), a);

// ---------------------------------------------------------------------------
// Additive glow sprites, cached per colour/radius. Runtime shadowBlur is far too
// slow at 2560x1440, so every glow in the game goes through these.

const glowCache = new Map<string, HTMLCanvasElement>();

export function glowSprite(color: string, radius: number, falloff = 2): HTMLCanvasElement {
  const key = `${color}|${radius}|${falloff}`;
  const cached = glowCache.get(key);
  if (cached) return cached;
  const size = radius * 2;
  const { canvas, ctx } = createSurface(size, size);
  const g = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  const c = hexToRgb(color);
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    g.addColorStop(t, rgba(c, Math.pow(1 - t, falloff)));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowCache.set(key, canvas);
  return canvas;
}

export function drawGlow(ctx: Ctx, color: string, x: number, y: number, radius: number, alpha = 1): void {
  // Quantise the radius so the cache stays small even when callers animate it.
  const r = Math.max(4, Math.round(radius / 4) * 4);
  const spr = glowSprite(color, r);
  const prevOp = ctx.globalCompositeOperation;
  const prevA = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = prevA * alpha;
  ctx.drawImage(spr, x - r, y - r);
  ctx.globalAlpha = prevA;
  ctx.globalCompositeOperation = prevOp;
}

// ---------------------------------------------------------------------------
// Value noise for procedural textures (wood grain, brushed metal).

export function makeNoise(seed = 1): (x: number, y: number) => number {
  const perm = new Uint8Array(512);
  let s = seed >>> 0 || 1;
  const rnd = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;
  const grad = new Float32Array(256);
  for (let i = 0; i < 256; i++) grad[i] = rnd();
  const fade = (t: number): number => t * t * (3 - 2 * t);
  return (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const h = (a: number, b: number): number => grad[perm[(perm[a & 255]! + b) & 511]!]!;
    const v00 = h(xi, yi);
    const v10 = h(xi + 1, yi);
    const v01 = h(xi, yi + 1);
    const v11 = h(xi + 1, yi + 1);
    const u = fade(xf);
    const v = fade(yf);
    return (v00 * (1 - u) + v10 * u) * (1 - v) + (v01 * (1 - u) + v11 * u) * v;
  };
}

export function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
