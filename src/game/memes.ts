import { audio, type SfxName } from '../audio/audio';
import { PADDLE_H, VIEW_W } from '../config';
import { TAU, clamp, easeOutBack, rand } from '../core/math';
import { createSurface, drawGlow, roundRectPath, type Ctx } from '../render/canvas';
import { drawText, type TextStyle } from '../render/font';
import { PADDLE_CAP, sprites } from '../render/sprites';
import { Boss } from './boss';

/**
 * Meme-style animated gags for the end credits. All original drawings made from the
 * game's own sprites (no third-party GIFs: those are copyrighted stills/footage), framed
 * like a GIF in a chat: white border, "GIF" badge, choppy 12 fps motion, top/bottom
 * captions in white outlined capitals.
 */

const W = 560;
const H = 420;
const GIF_FPS = 12;

interface MemeDef {
  id: string;
  top?: string;
  bottom?: string;
  bg: string;
  /** Seconds on screen (pop-in and pop-out included). */
  life?: number;
  /** One-shot sounds, at seconds after the pop-in. */
  sfx?: readonly (readonly [number, SfxName])[];
  /** `t` is already quantized to the GIF frame rate. */
  draw(ctx: Ctx, t: number): void;
}

// ---------------------------------------------------------------------------
// Drawing helpers

const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const eggs = new Map<number, Boss>();
function egg(ctx: Ctx, tier: number, x: number, y: number, scale: number, lookX = x): void {
  let e = eggs.get(tier);
  if (!e) {
    e = new Boss(tier);
    e.phase = 'fight';
    eggs.set(tier, e);
  }
  e.animate(1 / 60);
  e.x = 0;
  e.y = 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  e.render(ctx, (lookX - x) / scale);
  ctx.restore();
}

function paddle(ctx: Ctx, cx: number, cy: number, w: number, s = 1): void {
  const spr = sprites();
  const h = PADDLE_H * s;
  const cap = PADDLE_CAP * s;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  ctx.drawImage(spr.paddleTube, x0 + cap, y0, w - cap * 2, h);
  ctx.drawImage(spr.paddleCore, cx - 28 * s, y0, 56 * s, (PADDLE_H + 12) * s);
  ctx.drawImage(spr.paddleCapL, x0, y0, cap, h);
  ctx.drawImage(spr.paddleCapR, x0 + w - cap, y0, cap, h);
}

function ball(ctx: Ctx, x: number, y: number, s = 1, fire = false): void {
  const spr = sprites();
  drawGlow(ctx, fire ? '#3fb8ff' : '#ff9a2a', x, y, 40 * s, 0.5);
  ctx.drawImage(fire ? spr.ballFire : spr.ball, x - 17 * s, y - 17 * s, 34 * s, 34 * s);
}

function brick(ctx: Ctx, ch: string, cx: number, cy: number, s = 1): void {
  ctx.drawImage(sprites().bricks[ch]!, cx - 56 * s, cy - 28 * s, 112 * s, 56 * s);
}

function heart(ctx: Ctx, x: number, y: number, size: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.35);
  ctx.bezierCurveTo(x - size, y - size * 0.4, x - size * 0.35, y - size * 1.05, x, y - size * 0.35);
  ctx.bezierCurveTo(x + size * 0.35, y - size * 1.05, x + size, y - size * 0.4, x, y + size * 0.35);
  ctx.fill();
}

function note(ctx: Ctx, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(x, y, 11, 8, -0.4, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + 9, y - 2);
  ctx.lineTo(x + 9, y - 42);
  ctx.lineTo(x + 26, y - 32);
  ctx.stroke();
}

/** Classic meme caption: white capitals with a dark outline, shrunk to fit the card. */
export function caption(ctx: Ctx, text: string, cx: number, y: number, maxW = W - 36, size = 6): void {
  const fit = Math.min(size, maxW / (text.length * 6));
  const style: TextStyle = { size: Math.max(2.4, fit), top: '#ffffff', bottom: '#ececec', outline: true };
  drawText(ctx, text, cx, y, style, 'center');
}

function label(size: number, color: string): TextStyle {
  return { size, top: color, bottom: color, outline: true };
}

function confetti(ctx: Ctx, t: number, n: number): void {
  const colors = ['#ff3a3a', '#ffd21a', '#36c25a', '#2e69ff', '#ff58c4', '#26cfe6'];
  for (let i = 0; i < n; i++) {
    const x = hash(i) * W;
    const y = ((hash(i + 50) * H + t * (120 + hash(i + 9) * 160)) % (H + 40)) - 20;
    ctx.save();
    ctx.translate(x + Math.sin(t * 3 + i) * 10, y);
    ctx.rotate(t * 4 + i);
    ctx.fillStyle = colors[i % colors.length]!;
    ctx.fillRect(-6, -3, 12, 6);
    ctx.restore();
  }
}

function linePath(ctx: Ctx, pts: readonly (readonly [number, number])[], upTo: number): [number, number] {
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  let last: [number, number] = [pts[0]![0], pts[0]![1]];
  const segs = pts.length - 1;
  const reach = clamp(upTo, 0, 1) * segs;
  for (let i = 0; i < segs; i++) {
    const k = clamp(reach - i, 0, 1);
    if (k <= 0) break;
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    last = [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
    ctx.lineTo(last[0], last[1]);
  }
  return last;
}

const SHADES = ['###############', '.#ww####.#ww##.', '.##ww###.##ww#.', '..####....###..'];
function shades(ctx: Ctx, cx: number, y: number, px: number): void {
  SHADES.forEach((row, r) => {
    [...row].forEach((c, i) => {
      if (c === '.') return;
      ctx.fillStyle = c === 'w' ? '#ffffff' : '#000000';
      ctx.fillRect(cx - (row.length * px) / 2 + i * px, y + r * px, px, px);
    });
  });
}

// ---------------------------------------------------------------------------
// The gags

const MEMES: MemeDef[] = [
  {
    id: 'dealWithIt',
    top: 'QUAND TU BATS LE BOSS',
    bottom: 'DEAL WITH IT',
    bg: '#0d3a40',
    draw(ctx, t) {
      egg(ctx, 6, W / 2, H / 2 + 30, 0.5);
      const p = clamp(t / 1.3, 0, 1);
      shades(ctx, W / 2, -60 + (H / 2 + 12 - -60) * p, 12);
    },
  },
  {
    id: 'stonks',
    top: 'MON SCORE',
    bottom: 'STONKS',
    bg: '#071a33',
    draw(ctx, t) {
      ctx.strokeStyle = 'rgba(80,160,255,0.18)';
      ctx.lineWidth = 2;
      for (let x = 0; x < W; x += 56) ctx.strokeRect(x, 0, 56, H);
      for (let y = 0; y < H; y += 56) ctx.strokeRect(0, y, W, 56);
      const pts = [[40, 330], [120, 270], [180, 300], [260, 200], [320, 235], [420, 120], [510, 60]] as const;
      ctx.strokeStyle = '#3cff5a';
      ctx.lineWidth = 9;
      ctx.lineJoin = 'round';
      const [ex, ey] = linePath(ctx, pts, t / 1.6);
      ctx.stroke();
      drawGlow(ctx, '#3cff5a', ex, ey, 70, 0.7);
      ctx.fillStyle = '#3cff5a';
      ctx.beginPath();
      ctx.moveTo(ex + 18, ey - 14);
      ctx.lineTo(ex - 12, ey - 12);
      ctx.lineTo(ex + 6, ey + 18);
      ctx.fill();
    },
  },
  {
    id: 'toutVaBien',
    top: 'LE BOSS CRACHE DU FEU',
    bottom: 'TOUT VA BIEN',
    bg: '#3a1204',
    draw(ctx, t) {
      for (let i = 0; i < 16; i++) {
        const x = i * 38;
        const h = 110 + Math.sin(t * 9 + i * 1.7) * 40 + hash(i) * 50;
        const g = ctx.createLinearGradient(0, H - h, 0, H);
        g.addColorStop(0, 'rgba(255,240,120,0)');
        g.addColorStop(0.3, 'rgba(255,170,30,0.9)');
        g.addColorStop(1, 'rgba(220,40,0,1)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - 30, H);
        ctx.quadraticCurveTo(x + Math.sin(t * 7 + i) * 18, H - h * 0.6, x + 8, H - h);
        ctx.quadraticCurveTo(x + 30, H - h * 0.5, x + 46, H);
        ctx.fill();
      }
      paddle(ctx, W / 2, 250, 230, 0.9);
      // A coffee mug, of course.
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(W / 2 + 130, 222, 34, 40);
      ctx.strokeStyle = '#f2f2f2';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(W / 2 + 168, 242, 10, -1.2, 1.2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 3;
      for (const dx of [8, 22]) {
        ctx.beginPath();
        for (let k = 0; k < 6; k++) ctx.lineTo(W / 2 + 130 + dx + Math.sin(t * 5 + k + dx) * 5, 215 - k * 9);
        ctx.stroke();
      }
    },
  },
  {
    id: 'payRespects',
    top: 'RIP BRIQUE ROUGE',
    bottom: 'APPUYEZ SUR F',
    bg: '#2a2f3a',
    draw(ctx, t) {
      roundRectPath(ctx, W / 2 - 80, 150, 160, 190, 70);
      ctx.fillStyle = '#7d8592';
      ctx.fill();
      drawText(ctx, 'RIP', W / 2, 200, label(7, '#2a2f3a'), 'center');
      ctx.save();
      ctx.translate(W / 2, 300);
      ctx.rotate(0.15);
      brick(ctx, 'r', 0, 0, 0.9);
      ctx.restore();
      for (let i = 0; i < 9; i++) {
        const y = ((t * 160 + hash(i) * 400) % 460) - 40;
        drawText(ctx, 'F', 40 + hash(i + 3) * (W - 80), y, label(5, '#ffd21a'), 'center', 0.9);
      }
      drawText(ctx, '(CA MET EN PLEIN ECRAN)', W / 2, 70, label(2.6, '#c8d0dc'), 'center');
    },
  },
  {
    id: 'over9000',
    top: 'SON NIVEAU DE PUISSANCE ?',
    bottom: 'PLUS DE 9000 !!!',
    bg: '#5a2a00',
    draw(ctx, t) {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(t * 0.8);
      for (let i = 0; i < 16; i++) {
        ctx.rotate(TAU / 16);
        ctx.fillStyle = i % 2 ? '#ffb020' : '#ff7a00';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-60, -460);
        ctx.lineTo(60, -460);
        ctx.fill();
      }
      ctx.restore();
      const k = clamp(t / 2.2, 0, 1);
      const v = Math.min(9001, Math.floor(9001 * k * k * k));
      const over = v > 9000;
      const shake = over ? rand(-6, 6) : 0;
      drawText(ctx, String(v).padStart(4, '0'), W / 2 + shake, H / 2 - 50 + shake, label(14, over ? '#ffffff' : '#fff3a0'), 'center');
      if (over) drawGlow(ctx, '#ffffff', W / 2, H / 2, 300, 0.35);
    },
  },
  {
    id: 'noScope',
    top: '360 NO SCOPE',
    bottom: 'PRO GAMER MOVE',
    bg: '#1a0730',
    sfx: [[1.35, 'brick']],
    draw(ctx, t) {
      brick(ctx, 'v', 420, 200, 0.9);
      if (t < 1.35) {
        const a = t * TAU * 1.6;
        const r = 120 * (1 - t / 1.6);
        ball(ctx, 230 + Math.cos(a) * r, 200 + Math.sin(a) * r);
      } else {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 6;
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          ctx.beginPath();
          ctx.moveTo(420 + dx * 18, 200 + dy * 18);
          ctx.lineTo(420 + dx * 42, 200 + dy * 42);
          ctx.stroke();
        }
        drawText(ctx, 'WOW', 130, 250, label(7, '#ffd21a'), 'center');
        drawText(ctx, '+100', 440, 110, label(5, '#3cff5a'), 'center');
        confetti(ctx, t, 26);
      }
    },
  },
  {
    id: 'partyEgg',
    bottom: 'PARTY OEUF',
    bg: '#000000',
    draw(ctx, t) {
      ctx.fillStyle = `hsl(${(t * 540) % 360}, 75%, 45%)`;
      ctx.fillRect(0, 0, W, H);
      const off = partySurface();
      off.ctx.clearRect(0, 0, off.canvas.width, off.canvas.height);
      egg(off.ctx, 1, off.canvas.width / 2, off.canvas.height / 2, 0.5);
      ctx.save();
      ctx.translate(W / 2 + Math.sin(t * TAU * 2) * 50, H / 2 + 10 - Math.abs(Math.sin(t * TAU * 2)) * 30);
      ctx.rotate(Math.sin(t * TAU * 2) * 0.3);
      ctx.filter = `hue-rotate(${(t * 720) % 360}deg)`;
      ctx.drawImage(off.canvas, -off.canvas.width / 2, -off.canvas.height / 2);
      ctx.restore();
    },
  },
  {
    id: 'ballVacances',
    top: 'LA BALLE EN VACANCES',
    bg: '#0b1a4a',
    draw(ctx, t) {
      for (let i = 0; i < 30; i++) {
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 3 + i));
        ctx.fillStyle = `rgba(255,255,255,${tw})`;
        ctx.fillRect(hash(i) * W, hash(i + 40) * H, 4, 4);
      }
      const x = ((t * 260) % (W + 200)) - 60;
      const bands = ['#ff3a3a', '#ff9a1c', '#ffe23a', '#36c25a', '#2e8bff', '#9447ff'];
      for (let px = x - 8; px > x - 300; px -= 14) {
        const wy = Math.sin(px * 0.05 - t * 10) * 8;
        bands.forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.fillRect(px, H / 2 - 30 + i * 10 + wy, 14, 10);
        });
      }
      ball(ctx, x, H / 2 + Math.sin(t * 8) * 6, 1.6);
    },
  },
  {
    id: 'suchWow',
    bg: '#f3e6b8',
    draw(ctx, t) {
      egg(ctx, 5, W / 2, H / 2 + 40, 0.42);
      const words: readonly (readonly [string, string, number, number])[] = [
        ['WOW', '#ff3ad0', 90, 60],
        ['SUCH BRIQUE', '#2e69ff', 360, 90],
        ['MUCH REBOND', '#1ea84a', 160, 345],
        ['VERY KRYPTON', '#ff7a00', 400, 375],
        ['AMAZE', '#9447ff', 450, 190],
        ['SO OEUF', '#e3262c', 100, 190],
      ];
      words.forEach(([w, c, x, y], i) => {
        if (t < i * 0.4) return;
        drawText(ctx, w, x + Math.sin(t * 6 + i) * 3, y, { size: 4.2, top: c, bottom: c }, 'center');
      });
    },
  },
  {
    id: 'loading',
    top: 'SAUVEGARDE EN COURS',
    bottom: 'NE PAS ETEINDRE LA CONSOLE',
    bg: '#0f1418',
    draw(ctx, t) {
      const p = t < 1.6 ? (t / 1.6) * 0.99 : t < 3 ? 0.99 : 0.12;
      roundRectPath(ctx, 60, 190, W - 120, 46, 12);
      ctx.strokeStyle = '#9fe7ff';
      ctx.lineWidth = 3;
      ctx.stroke();
      roundRectPath(ctx, 66, 196, (W - 132) * p, 34, 8);
      ctx.fillStyle = '#3fd23a';
      ctx.fill();
      const blink = t >= 1.6 && t < 3 && Math.floor(t * 4) % 2 === 0 ? 0.3 : 1;
      drawText(ctx, `${Math.round(p * 100)} %`, W / 2, 262, label(6, '#ffffff'), 'center', blink);
    },
  },
  {
    id: 'skillIssue',
    top: 'MOI : *RATE LA BALLE*',
    bottom: 'SKILL ISSUE',
    bg: '#0f5a63',
    draw(ctx, t) {
      paddle(ctx, 380 - Math.min(t, 1.2) * 170, 330, 200, 0.85);
      const bx = 160 + t * 190;
      const by = 40 + t * 260;
      if (by < H + 40) ball(ctx, bx, by);
      if (t > 1.4) drawText(ctx, '?', 175, 250, label(8, '#ffd21a'), 'center');
    },
  },
  {
    id: 'vibeCheck',
    top: 'LA MUSIQUE DU BOSS DEMARRE',
    bottom: 'VIBE CHECK : OK',
    bg: '#2a0a4a',
    draw(ctx, t) {
      const beat = Math.abs(Math.sin(t * TAU * 1.5));
      ctx.save();
      ctx.translate(W / 2, 260 - beat * 50);
      ctx.rotate(Math.sin(t * TAU * 0.75) * 0.25);
      ctx.scale(1 + (1 - beat) * 0.12, 1 - (1 - beat) * 0.12);
      paddle(ctx, 0, 0, 240, 0.95);
      ctx.restore();
      for (let i = 0; i < 4; i++) {
        const k = (t * 0.6 + i / 4) % 1;
        note(ctx, 90 + i * 120, 330 - k * 230, ['#ff58c4', '#26cfe6', '#ffd21a', '#a6ea3a'][i]!);
      }
    },
  },
  {
    id: 'galaxyBrain',
    bg: '#06070f',
    draw(ctx, t) {
      const rows = ['TAPER LA BALLE', 'VISER LES BORDS', 'APPUYER SUR P', 'APPUYER 5 FOIS SUR M'];
      rows.forEach((r, i) => {
        if (t < i * 0.6) return;
        const y = 20 + i * 100;
        ctx.fillStyle = i % 2 ? '#0e1426' : '#121a30';
        ctx.fillRect(0, y - 10, W, 100);
        drawText(ctx, r, 20, y + 30, label(3.2, '#ffffff'));
        const cx = W - 90;
        drawGlow(ctx, ['#ff9ad0', '#ffd0f0', '#bff3ff', '#ffffff'][i]!, cx, y + 40, 30 + i * 30, 0.3 + i * 0.25);
        ctx.fillStyle = '#ff9ad0';
        ctx.beginPath();
        ctx.ellipse(cx, y + 40, 30, 22, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = '#c0407a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, y + 20);
        ctx.quadraticCurveTo(cx - 12, y + 40, cx, y + 60);
        ctx.stroke();
      });
    },
  },
  {
    id: 'mathEgg',
    bottom: 'QUAND LA BALLE PART EN BIAIS',
    bg: '#0d3a40',
    draw(ctx, t) {
      egg(ctx, 2, W / 2, H / 2 + 20, 0.42);
      const eq = ['E=MC2', 'SIN(A)', 'V=D/T', 'X+Y=?', 'COS(B)', '2+2=5', 'PI', '%'];
      eq.forEach((e, i) => {
        const a = t * 0.6 + i * (TAU / eq.length);
        const x = W / 2 + Math.cos(a) * 200;
        const y = H / 2 - 10 + Math.sin(a * 1.3) * 120;
        drawText(ctx, e, x, y, label(3.6, '#e8f6ff'), 'center', 0.5 + 0.5 * Math.sin(t * 3 + i));
      });
    },
  },
  {
    id: 'oof',
    top: 'LE BOSS : *TIRE*',
    bg: '#123b40',
    sfx: [[1, 'explosion']],
    draw(ctx, t) {
      if (t < 1) {
        paddle(ctx, W / 2, 330, 220, 0.9);
        const y = 30 + t * 290;
        drawGlow(ctx, '#ff4a00', W / 2, y, 60, 0.9);
        drawGlow(ctx, '#ffe080', W / 2, y, 26, 1);
      } else {
        const k = t - 1;
        drawGlow(ctx, '#ffb040', W / 2, 330, 120 + k * 200, Math.max(0, 1 - k));
        for (let i = 0; i < 14; i++) {
          const a = hash(i) * TAU;
          const d = k * (180 + hash(i + 7) * 120);
          ctx.fillStyle = ['#c8140e', '#93ab9e', '#ffcf3a'][i % 3]!;
          ctx.fillRect(W / 2 + Math.cos(a) * d, 330 + Math.sin(a) * d + k * k * 200, 12, 8);
        }
        drawText(ctx, 'OOF', W / 2, 120, label(16, '#ff5a3a'), 'center');
      }
    },
  },
  {
    id: 'mSpam',
    top: 'MOI : *APPUIE SUR M*',
    bg: '#16161e',
    sfx: [[0.3, 'multiball']],
    draw(ctx, t) {
      const presses = Math.min(5, Math.floor(t / 0.3));
      const down = (t % 0.3) < 0.1 && presses < 5;
      roundRectPath(ctx, 40, 150 + (down ? 8 : 0), 120, 120, 16);
      ctx.fillStyle = '#d8dde5';
      ctx.fill();
      ctx.fillStyle = '#7a828e';
      ctx.fillRect(40, 262 + (down ? 8 : 0), 120, 14);
      drawText(ctx, 'M', 100, 185 + (down ? 8 : 0), label(7, '#2a2e35'), 'center');
      const n = Math.pow(3, presses);
      for (let i = 0; i < n; i++) {
        const x = 200 + hash(i) * 330;
        const y = 70 + hash(i + 300) * 260;
        ctx.fillStyle = '#ff9c1c';
        ctx.beginPath();
        ctx.arc(x, y, n > 81 ? 5 : 9, 0, TAU);
        ctx.fill();
      }
      drawText(ctx, `${n} BALLES`, 365, 350, label(5, presses >= 5 ? '#ff5a3a' : '#3cff5a'), 'center');
    },
  },
  {
    id: 'notStonks',
    top: 'MES VIES',
    bottom: 'NOT STONKS',
    bg: '#2a0606',
    draw(ctx, t) {
      const pts = [[40, 70], [120, 120], [180, 100], [260, 200], [320, 180], [420, 300], [510, 360]] as const;
      ctx.strokeStyle = '#ff3a3a';
      ctx.lineWidth = 9;
      ctx.lineJoin = 'round';
      const [ex, ey] = linePath(ctx, pts, t / 1.6);
      ctx.stroke();
      drawGlow(ctx, '#ff3a3a', ex, ey, 70, 0.7);
      const lives = Math.max(0, 4 - Math.floor(t / 0.5));
      for (let i = 0; i < 4; i++) heart(ctx, 330 + i * 52, 120, 22, i < lives ? '#ff2a6a' : 'rgba(255,255,255,0.15)');
    },
  },
  {
    id: 'normalVsChad',
    top: 'BRIQUE NORMALE VS BRIQUE CHAD',
    bg: '#20232a',
    draw(ctx, t) {
      ctx.fillStyle = '#5a5f6a';
      ctx.fillRect(0, 0, W / 2, H);
      const g = ctx.createLinearGradient(W / 2, 0, W, H);
      g.addColorStop(0, '#ffd86a');
      g.addColorStop(1, '#b07806');
      ctx.fillStyle = g;
      ctx.fillRect(W / 2, 0, W / 2, H);
      const spr = sprites();
      const tremble = Math.sin(t * 40) * 3;
      brick(ctx, 'r', W / 4 + tremble, 200, 0.8);
      ctx.drawImage(spr.cracks[1]!, W / 4 + tremble - 45, 200 - 22, 90, 45);
      ctx.save();
      ctx.translate(W * 0.75, 190);
      ctx.scale(1.4, 1.4);
      brick(ctx, 'G', 0, 0, 1);
      ctx.restore();
      shades(ctx, W * 0.75, 172, 6);
      drawText(ctx, 'CASSE EN 1 COUP', W / 4, 290, label(2.8, '#ffffff'), 'center');
      drawText(ctx, 'MEME PAS MAL', W * 0.75, 290, label(2.8, '#ffffff'), 'center');
    },
  },
  {
    id: 'bassDrop',
    top: 'QUAND LE BOSS ARRIVE',
    bottom: '*BASS DROP*',
    bg: '#000000',
    draw(ctx, t) {
      const drop = t > 1.2;
      const shake = drop ? 12 * Math.max(0, 1.8 - (t - 1.2)) : 0;
      ctx.save();
      ctx.translate(rand(-shake, shake), rand(-shake, shake));
      for (let i = 0; i < 28; i++) {
        const h = (drop ? 140 : 30) * (0.3 + Math.abs(Math.sin(t * 9 + i * 0.7)) * hash(i + Math.floor(t * 12)));
        ctx.fillStyle = drop ? '#ff3ad0' : '#2e69ff';
        ctx.fillRect(10 + i * 19.5, H / 2 + 70 - h, 14, h);
      }
      if (drop) egg(ctx, 4, W / 2, H / 2 - 10, 0.45);
      ctx.restore();
      if (drop && t < 1.4) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(0, 0, W, H);
      }
    },
  },
  {
    id: 'salutRaph',
    top: 'SALUT RAPH !',
    bottom: 'CE JEU EST POUR TOI',
    bg: '#2a4a8a',
    draw(ctx, t) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#ff8a5a');
      g.addColorStop(1, '#5a3aa0');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, 260);
      ctx.rotate(-0.4 + Math.sin(t * 9) * 0.45);
      paddle(ctx, 0, -70, 180, 0.8);
      ctx.restore();
      for (let i = 0; i < 7; i++) {
        const k = (t * 0.5 + i / 7) % 1;
        heart(ctx, 60 + hash(i) * (W - 120), 380 - k * 320, 16 + hash(i + 4) * 10, `rgba(255,60,120,${1 - k})`);
      }
    },
  },
  {
    id: 'ggEz',
    top: 'BOSS FINAL',
    bottom: 'GG EZ',
    bg: '#101830',
    draw(ctx, t) {
      confetti(ctx, t, 40);
      const cx = W / 2;
      const s = 1 + Math.sin(t * 6) * 0.05;
      ctx.save();
      ctx.translate(cx, 210);
      ctx.scale(s, s);
      const g = ctx.createLinearGradient(-70, 0, 70, 0);
      g.addColorStop(0, '#b07806');
      g.addColorStop(0.4, '#fff3a0');
      g.addColorStop(1, '#d79a1c');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-70, -80);
      ctx.lineTo(70, -80);
      ctx.quadraticCurveTo(66, 20, 0, 34);
      ctx.quadraticCurveTo(-66, 20, -70, -80);
      ctx.fill();
      ctx.fillRect(-12, 30, 24, 40);
      ctx.fillRect(-45, 66, 90, 16);
      ctx.strokeStyle = '#ffd21a';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(-74, -45, 26, Math.PI * 0.5, Math.PI * 1.5);
      ctx.arc(74, -45, 26, Math.PI * 1.5, Math.PI * 0.5);
      ctx.stroke();
      ctx.restore();
      drawGlow(ctx, '#ffd060', cx, 190, 160, 0.3);
    },
  },
  {
    id: 'hackerman',
    top: 'L OEUF A PIRATE LE GENERIQUE',
    bottom: 'HACKERMAN',
    bg: '#000000',
    draw(ctx, t) {
      const chars = '01KRYPTONEGG';
      for (let c = 0; c < 18; c++) {
        const speed = 120 + hash(c) * 200;
        const head = ((t * speed + hash(c + 5) * H) % (H + 200)) - 100;
        for (let k = 0; k < 9; k++) {
          const ch = chars[(c * 7 + k + Math.floor(t * 12)) % chars.length]!;
          drawText(ctx, ch, 14 + c * 31, head - k * 26, label(3.2, k === 0 ? '#d8ffd8' : '#2cff4a'), 'center', 1 - k / 9);
        }
      }
      ctx.fillStyle = '#05070a';
      ctx.beginPath();
      ctx.ellipse(W / 2, H / 2, 110, 54, 0, 0, TAU);
      ctx.fill();
      drawGlow(ctx, '#5aff5a', W / 2, H / 2, 110, 0.7);
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.ellipse(W / 2 + Math.sin(t * 2) * 30, H / 2, 10, 40, 0, 0, TAU);
      ctx.fill();
    },
  },
  {
    id: 'touchGrass',
    top: 'TOI APRES 66 NIVEAUX',
    bottom: 'VA TOUCHER DE L HERBE',
    bg: '#5ab0ff',
    draw(ctx, t) {
      ctx.fillStyle = '#ffe23a';
      ctx.beginPath();
      ctx.arc(470, 80, 44, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#36c25a';
      ctx.fillRect(0, 300, W, 120);
      for (let i = 0; i < 70; i++) {
        const x = i * 8;
        const sway = Math.sin(t * 4 + i * 0.6) * 6;
        ctx.strokeStyle = i % 3 ? '#1e8a3a' : '#5ae070';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, 310);
        ctx.lineTo(x + sway, 280 - hash(i) * 30);
        ctx.stroke();
      }
      paddle(ctx, W / 2, 268, 190, 0.8);
      drawText(ctx, '?', W / 2 + 120, 190 + Math.sin(t * 5) * 6, label(6, '#ffffff'), 'center');
    },
  },
];

let partyCanvas: ReturnType<typeof createSurface> | null = null;
function partySurface(): ReturnType<typeof createSurface> {
  partyCanvas ??= createSurface(420, 420);
  return partyCanvas;
}

export const MEME_COUNT = MEMES.length;

// ---------------------------------------------------------------------------
// Layer: pops gags in the side margins at random, never the same one twice in a row.

interface Active {
  def: MemeDef;
  x: number;
  y: number;
  rot: number;
  t: number;
  life: number;
  side: -1 | 1;
  fired: number;
}

const POP_IN = 0.3;
const POP_OUT = 0.25;
const SCALE = 0.95;
/** White strip under the picture, like a GIF in a chat app: holds the GIF badge and the author. */
const FOOTER = 46;

export class MemeLayer {
  private readonly active: Active[] = [];
  private bag: MemeDef[] = [];
  private timer = 1.2;
  private nextSide: -1 | 1 = Math.random() < 0.5 ? -1 : 1;

  update(dt: number, spawning: boolean): void {
    for (const a of this.active) {
      a.t += dt;
      const sfx = a.def.sfx ?? [];
      while (a.fired < sfx.length && a.t - POP_IN >= sfx[a.fired]![0]) {
        audio.play(sfx[a.fired]![1], { pan: a.side * 0.6, volume: 0.6 });
        a.fired++;
      }
    }
    for (let i = this.active.length - 1; i >= 0; i--) if (this.active[i]!.t >= this.active[i]!.life) this.active.splice(i, 1);
    if (!spawning) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = rand(2.2, 4.2);
    const side = this.nextSide;
    if (this.active.some((a) => a.side === side)) return;
    this.nextSide = side === -1 ? 1 : -1;
    this.spawn(side);
  }

  private spawn(side: -1 | 1): void {
    if (!this.bag.length) {
      this.bag = [...MEMES];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j]!, this.bag[i]!];
      }
    }
    const def = this.bag.pop()!;
    const margin = (W * SCALE) / 2 + 40;
    this.active.push({
      def,
      side,
      x: side < 0 ? margin + rand(0, 30) : VIEW_W - margin - rand(0, 30),
      y: rand(330, 1110),
      rot: rand(-0.07, 0.07),
      t: 0,
      life: def.life ?? rand(3.6, 4.6),
      fired: 0,
    });
    audio.play('menuSelect', { pitch: rand(-3, 6), pan: side * 0.6, volume: 0.5 });
  }

  render(ctx: Ctx): void {
    for (const a of this.active) {
      const k = a.t < POP_IN ? easeOutBack(a.t / POP_IN) : a.t > a.life - POP_OUT ? Math.max(0, (a.life - a.t) / POP_OUT) : 1;
      if (k <= 0) continue;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot);
      ctx.scale(SCALE * k, SCALE * k);
      ctx.globalAlpha = Math.min(1, k);
      drawCard(ctx, a.def, Math.floor(Math.max(0, a.t - POP_IN) * GIF_FPS) / GIF_FPS);
      ctx.restore();
    }
  }
}

function drawCard(ctx: Ctx, def: MemeDef, t: number): void {
  const x0 = -W / 2;
  const y0 = -(H + FOOTER) / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 14;
  roundRectPath(ctx, x0 - 10, y0 - 10, W + 20, H + FOOTER + 20, 18);
  ctx.fillStyle = '#f4f6fa';
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRectPath(ctx, x0, y0, W, H, 10);
  ctx.clip();
  ctx.translate(x0, y0);
  ctx.fillStyle = def.bg;
  ctx.fillRect(0, 0, W, H);
  def.draw(ctx, t);
  ctx.filter = 'none';
  if (def.top) caption(ctx, def.top, W / 2, 16);
  if (def.bottom) caption(ctx, def.bottom, W / 2, H - 58);
  ctx.restore();
  const fy = y0 + H + 8;
  roundRectPath(ctx, x0 + 2, fy, 66, 32, 8);
  ctx.fillStyle = '#1c1f26';
  ctx.fill();
  drawText(ctx, 'GIF', x0 + 35, fy + 6, { size: 3, top: '#ffffff', bottom: '#dddddd' }, 'center');
  drawText(ctx, '@CLAUDO', x0 + W - 4, fy + 6, { size: 3, top: '#6a7080', bottom: '#5a6070' }, 'right');
}
