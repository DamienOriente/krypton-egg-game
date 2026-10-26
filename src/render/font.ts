import { createSurface, type Ctx } from './canvas';

// 5x7 dot-matrix glyphs: the HUD of the original used chunky bitmap lettering,
// re-rendered here as glossy LED dots so it stays crisp at 2K.
const GLYPHS: Record<string, string> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#',
  N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
  '3': '#####|...#.|..#..|...#.|....#|#...#|.###.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '..##.|.#...|#....|####.|#...#|#...#|.###.',
  '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
  '.': '.....|.....|.....|.....|.....|.##..|.##..',
  ',': '.....|.....|.....|.....|.##..|..#..|.#...',
  ':': '.....|.##..|.##..|.....|.##..|.##..|.....',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  '-': '.....|.....|.....|#####|.....|.....|.....',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '/': '.....|....#|...#.|..#..|.#...|#....|.....',
  "'": '..#..|..#..|.#...|.....|.....|.....|.....',
  '(': '...#.|..#..|.#...|.#...|.#...|..#..|...#.',
  ')': '.#...|..#..|...#.|...#.|...#.|..#..|.#...',
  '<': '...#.|..#..|.#...|#....|.#...|..#..|...#.',
  '>': '.#...|..#..|...#.|....#|...#.|..#..|.#...',
  '=': '.....|.....|#####|.....|#####|.....|.....',
  '%': '##...|##..#|...#.|..#..|.#...|#..##|...##',
  '*': '.....|..#..|#.#.#|.###.|#.#.#|..#..|.....',
  _: '.....|.....|.....|.....|.....|.....|#####',
  '#': '.#.#.|#####|.#.#.|.#.#.|.#.#.|#####|.#.#.',
  '@': '.###.|#...#|#.###|#.#.#|#.###|#....|.###.',
};

const ACCENTS: Record<string, string> = {
  À: 'A', Â: 'A', Ä: 'A', Ç: 'C', É: 'E', È: 'E', Ê: 'E', Ë: 'E', Î: 'I', Ï: 'I', Ô: 'O', Ö: 'O', Ù: 'U', Û: 'U', Ü: 'U',
};

const parsed = new Map<string, boolean[][]>();
function glyph(ch: string): boolean[][] {
  const up = ch.toUpperCase();
  const key = ACCENTS[up] ?? up;
  let g = parsed.get(key);
  if (!g) {
    const src = GLYPHS[key] ?? GLYPHS['?']!;
    g = src.split('|').map((row) => [...row].map((c) => c === '#'));
    parsed.set(key, g);
  }
  return g;
}

/** Exposed for level/intro effects that want to place things on glyph pixels. */
export function glyphBitmap(ch: string): boolean[][] {
  return glyph(ch);
}

export interface TextStyle {
  /** Dot pitch in pixels; a glyph is 5 dots wide and 7 tall. */
  size: number;
  top: string;
  bottom: string;
  glow?: string;
  glowBlur?: number;
  /** Dark outline under the dots for readability on busy backgrounds. */
  outline?: boolean;
  /** Extra dot gap between characters. */
  spacing?: number;
}

export const textWidth = (text: string, style: TextStyle): number =>
  text.length === 0 ? 0 : (text.length * (5 + 1 + (style.spacing ?? 0)) - 1 - (style.spacing ?? 0)) * style.size;
export const textHeight = (style: TextStyle): number => 7 * style.size;

const cache = new Map<string, HTMLCanvasElement>();
const CACHE_LIMIT = 400;

function renderText(text: string, style: TextStyle): HTMLCanvasElement {
  const key = `${text}|${style.size}|${style.top}|${style.bottom}|${style.glow ?? ''}|${style.glowBlur ?? 0}|${style.outline ? 1 : 0}|${style.spacing ?? 0}`;
  const hit = cache.get(key);
  if (hit) {
    // Refresh LRU position.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const s = style.size;
  const blur = style.glow ? (style.glowBlur ?? s * 3) : 0;
  const margin = Math.ceil(blur * 1.5 + s);
  const w = textWidth(text, style);
  const h = textHeight(style);
  const { canvas, ctx } = createSurface(w + margin * 2, h + margin * 2);

  // 1) dot mask
  const mask = createSurface(w + margin * 2, h + margin * 2);
  const m = mask.ctx;
  const dot = s * 0.84;
  const rad = dot * 0.32;
  const step = 6 + (style.spacing ?? 0);
  m.fillStyle = '#fff';
  [...text].forEach((ch, i) => {
    const g = glyph(ch);
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (!g[y]![x]) continue;
        const px = margin + (i * step + x) * s + (s - dot) / 2;
        const py = margin + y * s + (s - dot) / 2;
        m.beginPath();
        m.roundRect(px, py, dot, dot, rad);
        m.fill();
      }
    }
  });

  // 2) gradient fill through the mask
  const fill = createSurface(w + margin * 2, h + margin * 2);
  const f = fill.ctx;
  const grad = f.createLinearGradient(0, margin, 0, margin + h);
  grad.addColorStop(0, style.top);
  grad.addColorStop(1, style.bottom);
  f.fillStyle = grad;
  f.fillRect(0, 0, fill.canvas.width, fill.canvas.height);
  // Per-dot specular: a soft white band on the upper part of every dot row.
  f.globalCompositeOperation = 'source-over';
  for (let y = 0; y < 7; y++) {
    const gy = margin + y * s;
    const hl = f.createLinearGradient(0, gy, 0, gy + s);
    hl.addColorStop(0, 'rgba(255,255,255,0.55)');
    hl.addColorStop(0.45, 'rgba(255,255,255,0)');
    f.fillStyle = hl;
    f.fillRect(0, gy, fill.canvas.width, s);
  }
  f.globalCompositeOperation = 'destination-in';
  f.drawImage(mask.canvas, 0, 0);

  if (style.outline) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.filter = `blur(${Math.max(1, s * 0.35)}px)`;
    ctx.drawImage(mask.canvas, 0, s * 0.35);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
  if (style.glow) {
    ctx.save();
    ctx.shadowColor = style.glow;
    ctx.shadowBlur = blur;
    ctx.drawImage(fill.canvas, 0, 0);
    ctx.restore();
  }
  ctx.drawImage(fill.canvas, 0, 0);

  cache.set(key, canvas);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  (canvas as HTMLCanvasElement & { _margin?: number })._margin = margin;
  return canvas;
}

export type Align = 'left' | 'center' | 'right';

export function drawText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
  align: Align = 'left',
  alpha = 1,
): void {
  if (!text) return;
  const spr = renderText(text, style) as HTMLCanvasElement & { _margin?: number };
  const margin = spr._margin ?? 0;
  const w = textWidth(text, style);
  const ox = align === 'left' ? 0 : align === 'center' ? w / 2 : w;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.drawImage(spr, Math.round(x - ox - margin), Math.round(y - margin));
  ctx.globalAlpha = prev;
}

// Shared styles
export const STYLE = {
  hudLabel: { size: 7, top: '#ffd6f4', bottom: '#e0409e', glow: '#ff4fb8', glowBlur: 10 },
  hudDigits: { size: 7, top: '#d8ffb0', bottom: '#3fd23a', glow: '#3cff5a', glowBlur: 12 },
  title: { size: 22, top: '#fff6c8', bottom: '#ff8a1e', glow: '#ff7a00', glowBlur: 40, outline: true },
  big: { size: 16, top: '#ffffff', bottom: '#7fd8ff', glow: '#2fa8ff', glowBlur: 30, outline: true },
  medium: { size: 9, top: '#ffffff', bottom: '#9fe7ff', glow: '#2fa8ff', glowBlur: 16, outline: true },
  small: { size: 6, top: '#f2f6ff', bottom: '#a9c4e8', outline: true },
  tiny: { size: 4, top: '#e8f0ff', bottom: '#9fb4d6' },
  gold: { size: 9, top: '#fff7c2', bottom: '#ffb000', glow: '#ff9d00', glowBlur: 18, outline: true },
  red: { size: 9, top: '#ffd0c8', bottom: '#ff3a2a', glow: '#ff2a1a', glowBlur: 18, outline: true },
  green: { size: 9, top: '#e2ffc8', bottom: '#46e04a', glow: '#2cff4a', glowBlur: 16, outline: true },
  pink: { size: 9, top: '#ffe0f6', bottom: '#ff4fb8', glow: '#ff3fae', glowBlur: 16, outline: true },
} satisfies Record<string, TextStyle>;
