import { FIELD, PADDLE_Y } from '../config';
import { TAU, clamp, rand } from '../core/math';
import { createSurface, drawGlow, shade, type Ctx } from '../render/canvas';

export type EnemyKind = 'orb' | 'cube' | 'jelly' | 'ray' | 'invader' | 'mine';

export interface Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  t: number;
  alive: boolean;
  deadly: boolean;
  score: number;
  tx: number;
  ty: number;
  /** Seconds left of the "coming out of the gate" animation. */
  entering: number;
  /** Invader formation slot + sprite variant. */
  slotX: number;
  slotY: number;
  variant: number;
  seed: number;
  flash: number;
}

export type ShotKind = 'dagger' | 'fireball' | 'pellet';

export interface Shot {
  kind: ShotKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  t: number;
  alive: boolean;
}

const WANDER_BOTTOM = 1150;

export function makeEnemy(kind: EnemyKind, x: number, y: number): Enemy {
  const base: Enemy = {
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    r: 30,
    t: 0,
    alive: true,
    deadly: false,
    score: 150,
    tx: x,
    ty: y + 200,
    entering: 0,
    slotX: 0,
    slotY: 0,
    variant: 0,
    seed: Math.random() * 1000,
    flash: 0,
  };
  switch (kind) {
    case 'orb':
      base.r = 30;
      break;
    case 'cube':
      base.r = 32;
      base.score = 200;
      break;
    case 'jelly':
      base.r = 34;
      base.score = 250;
      break;
    case 'ray':
      base.r = 22;
      base.deadly = true;
      base.score = 400;
      break;
    case 'invader':
      base.r = 34;
      base.score = 120;
      break;
    case 'mine':
      base.r = 24;
      base.score = 100;
      break;
  }
  return base;
}

function newTarget(e: Enemy): void {
  e.tx = rand(FIELD.x + 80, FIELD.right - 80);
  e.ty = rand(FIELD.y + 90, WANDER_BOTTOM);
}

/** Movement for free-roaming enemies (invaders are driven by their formation). */
export function updateEnemy(e: Enemy, dt: number, paddleX: number): void {
  e.t += dt;
  if (e.flash > 0) e.flash -= dt * 4;
  if (e.entering > 0) {
    e.entering -= dt;
    e.y += 120 * dt;
    if (e.entering <= 0) newTarget(e);
    return;
  }
  switch (e.kind) {
    case 'orb':
    case 'cube':
    case 'jelly':
    case 'mine': {
      const speed = e.kind === 'cube' ? 240 : e.kind === 'jelly' ? 120 : e.kind === 'mine' ? 210 : 170;
      const dx = e.tx - e.x;
      const dy = e.ty - e.y;
      const d = Math.hypot(dx, dy);
      if (d < 30) newTarget(e);
      const ax = (dx / (d || 1)) * speed;
      const ay = (dy / (d || 1)) * speed;
      // Steering with inertia so the motion reads as floating, not as a robot.
      const k = 1 - Math.exp(-1.6 * dt);
      e.vx += (ax - e.vx) * k;
      e.vy += (ay - e.vy) * k;
      let wob = 0;
      if (e.kind === 'jelly') wob = Math.sin(e.t * 3 + e.seed) * 60;
      e.x += (e.vx + wob) * dt;
      e.y += e.vy * dt;
      break;
    }
    case 'ray': {
      // Homes in on the paddle, but with a limited turn rate so it can be dodged.
      const desired = clamp((paddleX - e.x) * 1.4, -420, 420);
      e.vx += (desired - e.vx) * (1 - Math.exp(-1.2 * dt));
      e.vy = Math.min(e.vy + 260 * dt, 430);
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (e.y > PADDLE_Y + 160) e.alive = false;
      break;
    }
    case 'invader':
      break;
  }
  e.x = clamp(e.x, FIELD.x + e.r, FIELD.right - e.r);
  if (e.kind !== 'ray') e.y = clamp(e.y, FIELD.y + e.r, WANDER_BOTTOM + 40);
}

// ---------------------------------------------------------------------------
// Invader pixel sprites, rendered as glossy dots like the HUD font.

const INVADER_BITMAPS: string[][] = [
  [
    '...##...|..####..|.######.|##.##.##|########|..#..#..|.#.##.#.|#.#..#.#',
    '...##...|..####..|.######.|##.##.##|########|.#.##.#.|#......#|.#....#.',
  ],
  [
    '..#.....#..|...#...#...|..#######..|.##.###.##.|###########|#.#######.#|#.#.....#.#|...##.##...',
    '..#.....#..|#..#...#..#|#.#######.#|###.###.###|###########|.#########.|..#.....#..|.#.......#.',
  ],
  [
    '....####....|.##########.|############|###..##..###|############|...##..##...|..##.##.##..|##........##',
    '....####....|.##########.|############|###..##..###|############|..###..###..|.##..##..##.|..##....##..',
  ],
];
const INVADER_COLORS = ['#ff4fd0', '#3fe0ff', '#7dff4a'];
const PIX = 7;

const invaderCache = new Map<string, HTMLCanvasElement>();
function invaderSprite(variant: number, frame: number): HTMLCanvasElement {
  const key = `${variant}|${frame}`;
  const hit = invaderCache.get(key);
  if (hit) return hit;
  const rows = INVADER_BITMAPS[variant % 3]![frame]!.split('|');
  const w = rows[0]!.length * PIX;
  const h = rows.length * PIX;
  const m = 16;
  const { canvas, ctx } = createSurface(w + m * 2, h + m * 2);
  const color = INVADER_COLORS[variant % 3]!;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  rows.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c !== '#') return;
      const px = m + x * PIX;
      const py = m + y * PIX;
      const g = ctx.createLinearGradient(0, py, 0, py + PIX);
      g.addColorStop(0, shade(color, 0.6));
      g.addColorStop(1, shade(color, -0.25));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(px + 0.5, py + 0.5, PIX - 1, PIX - 1, 2);
      ctx.fill();
    });
  });
  invaderCache.set(key, canvas);
  // Silhouette used as a drop shadow so the aliens read clearly over the bricks.
  const sh = createSurface(canvas.width, canvas.height);
  sh.ctx.drawImage(canvas, 0, 0);
  sh.ctx.globalCompositeOperation = 'source-in';
  sh.ctx.fillStyle = 'rgba(0,6,10,0.6)';
  sh.ctx.fillRect(0, 0, canvas.width, canvas.height);
  invaderCache.set(key + 's', sh.canvas);
  return canvas;
}

// ---------------------------------------------------------------------------
// Rendering

function drawOrb(ctx: Ctx, e: Enemy, paddleX: number): void {
  const r = e.r;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,10,14,0.4)';
  ctx.beginPath();
  ctx.ellipse(12, 16, r, r * 0.9, 0, 0, TAU);
  ctx.fill();
  const g = ctx.createRadialGradient(-r * 0.4, -r * 0.45, 2, 0, 0, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, '#c8d0dc');
  g.addColorStop(0.7, '#5a6370');
  g.addColorStop(1, '#1a1e24');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  // Spinning equator ring.
  const spin = e.t * 3;
  ctx.strokeStyle = '#ffb020';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(0, 0, r + 9, 9, Math.sin(e.t * 0.8) * 0.25, spin, spin + Math.PI * 1.2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,240,180,0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Eye tracks the paddle.
  const look = clamp((paddleX - e.x) / 600, -1, 1) * r * 0.32;
  ctx.fillStyle = '#120000';
  ctx.beginPath();
  ctx.ellipse(look, 3, r * 0.42, r * 0.3, 0, 0, TAU);
  ctx.fill();
  const eye = ctx.createRadialGradient(look, 3, 0, look, 3, r * 0.28);
  eye.addColorStop(0, '#fff2c0');
  eye.addColorStop(0.35, '#ff3a1a');
  eye.addColorStop(1, '#5a0000');
  ctx.fillStyle = eye;
  ctx.beginPath();
  ctx.arc(look, 3, r * 0.26, 0, TAU);
  ctx.fill();
  ctx.restore();
  drawGlow(ctx, '#ff3a1a', e.x + look, e.y + 3, 30, 0.5);
}

const CUBE_V = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
] as const;
const CUBE_F = [
  [0, 1, 2, 3],
  [4, 7, 6, 5],
  [0, 4, 5, 1],
  [3, 2, 6, 7],
  [0, 3, 7, 4],
  [1, 5, 6, 2],
] as const;

function drawCube(ctx: Ctx, e: Enemy): void {
  const a = e.t * 1.7 + e.seed;
  const b = e.t * 1.1 + e.seed * 0.5;
  const s = e.r * 0.62;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const pts = CUBE_V.map(([x, y, z]) => {
    const x1 = x * ca - z * sa;
    const z1 = x * sa + z * ca;
    const y1 = y * cb - z1 * sb;
    const z2 = y * sb + z1 * cb;
    return { x: e.x + x1 * s, y: e.y + y1 * s, z: z2 };
  });
  ctx.fillStyle = 'rgba(0,10,14,0.35)';
  ctx.beginPath();
  ctx.ellipse(e.x + 12, e.y + 18, e.r, e.r * 0.8, 0, 0, TAU);
  ctx.fill();
  const faces = CUBE_F.map((f) => {
    const p = f.map((i) => pts[i]!);
    const z = p.reduce((acc, q) => acc + q.z, 0) / 4;
    const ux = p[1]!.x - p[0]!.x;
    const uy = p[1]!.y - p[0]!.y;
    const vx = p[3]!.x - p[0]!.x;
    const vy = p[3]!.y - p[0]!.y;
    return { p, z, n: ux * vy - uy * vx };
  }).sort((f1, f2) => f2.z - f1.z);
  for (const f of faces) {
    if (f.n <= 0) continue;
    const light = clamp(0.35 + (1 - (f.z + 1) / 2) * 0.65, 0, 1);
    ctx.fillStyle = shade('#7a3cff', light * 0.8 - 0.3);
    ctx.beginPath();
    f.p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#d8b8ff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  drawGlow(ctx, '#9a5aff', e.x, e.y, 60, 0.35);
}

function drawJelly(ctx: Ctx, e: Enemy): void {
  const r = e.r;
  const pulse = 1 + Math.sin(e.t * 4 + e.seed) * 0.08;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.strokeStyle = 'rgba(120,255,190,0.7)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const tx = -r * 0.6 + i * r * 0.3;
    ctx.beginPath();
    ctx.moveTo(tx, r * 0.2);
    for (let k = 1; k <= 6; k++) {
      ctx.lineTo(tx + Math.sin(e.t * 5 + i + k * 0.8) * 7, r * 0.2 + k * 8);
    }
    ctx.stroke();
  }
  ctx.scale(pulse, 1 / pulse);
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.5, 2, 0, -r * 0.1, r * 1.1);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.3, 'rgba(120,255,200,0.75)');
  g.addColorStop(1, 'rgba(10,120,90,0.55)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI, 0);
  ctx.quadraticCurveTo(r * 0.5, r * 0.45, 0, r * 0.3);
  ctx.quadraticCurveTo(-r * 0.5, r * 0.45, -r, 0);
  ctx.fill();
  ctx.fillStyle = '#062a20';
  ctx.beginPath();
  ctx.arc(-r * 0.3, -r * 0.15, 4, 0, TAU);
  ctx.arc(r * 0.3, -r * 0.15, 4, 0, TAU);
  ctx.fill();
  ctx.restore();
  drawGlow(ctx, '#40ffb0', e.x, e.y, 70, 0.3);
}

function drawRay(ctx: Ctx, e: Enemy): void {
  const sp = Math.hypot(e.vx, e.vy) || 1;
  const tx = -e.vx / sp;
  const ty = -e.vy / sp;
  const len = 90 + Math.sin(e.t * 20) * 10;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(e.x, e.y, e.x + tx * len, e.y + ty * len);
  g.addColorStop(0, 'rgba(255,240,180,0.95)');
  g.addColorStop(0.3, 'rgba(255,120,20,0.7)');
  g.addColorStop(1, 'rgba(255,40,0,0)');
  ctx.strokeStyle = g;
  ctx.lineCap = 'round';
  ctx.lineWidth = e.r * 1.6;
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(e.x + tx * len, e.y + ty * len);
  ctx.stroke();
  ctx.restore();
  drawGlow(ctx, '#ff6a00', e.x, e.y, 90, 0.9);
  drawGlow(ctx, '#fff6c0', e.x, e.y, 34, 1);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.r * 0.55, 0, TAU);
  ctx.fill();
}

function drawMine(ctx: Ctx, e: Enemy): void {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.t * 2);
  ctx.fillStyle = '#3a0a10';
  for (let i = 0; i < 8; i++) {
    ctx.rotate(TAU / 8);
    ctx.beginPath();
    ctx.moveTo(-5, -e.r * 0.7);
    ctx.lineTo(0, -e.r * 1.3);
    ctx.lineTo(5, -e.r * 0.7);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(-6, -6, 1, 0, 0, e.r);
  g.addColorStop(0, '#ffb0a0');
  g.addColorStop(0.4, '#d02020');
  g.addColorStop(1, '#300408');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, e.r * 0.8, 0, TAU);
  ctx.fill();
  ctx.restore();
  drawGlow(ctx, '#ff2020', e.x, e.y, 40, 0.3 + 0.3 * Math.sin(e.t * 8));
}

export function drawEnemy(ctx: Ctx, e: Enemy, paddleX: number): void {
  if (e.kind === 'invader') {
    const frame = Math.floor(e.t * 2) % 2;
    const spr = invaderSprite(e.variant, frame);
    const shadow = invaderCache.get(`${e.variant}|${frame}s`);
    if (shadow) ctx.drawImage(shadow, e.x - spr.width / 2 + 10, e.y - spr.height / 2 + 14);
    ctx.drawImage(spr, e.x - spr.width / 2, e.y - spr.height / 2);
  } else if (e.kind === 'orb') drawOrb(ctx, e, paddleX);
  else if (e.kind === 'cube') drawCube(ctx, e);
  else if (e.kind === 'jelly') drawJelly(ctx, e);
  else if (e.kind === 'ray') drawRay(ctx, e);
  else drawMine(ctx, e);
  if (e.flash > 0) drawGlow(ctx, '#ffffff', e.x, e.y, e.r * 2.2, e.flash);
}

export function drawShot(ctx: Ctx, s: Shot): void {
  if (s.kind === 'dagger') {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.atan2(s.vy, s.vx) - Math.PI / 2);
    const g = ctx.createLinearGradient(-6, 0, 6, 0);
    g.addColorStop(0, '#8a929e');
    g.addColorStop(0.5, '#ffffff');
    g.addColorStop(1, '#5a616c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 30);
    ctx.lineTo(6, 4);
    ctx.lineTo(-6, 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd21a';
    ctx.fillRect(-11, 0, 22, 5);
    ctx.fillStyle = '#a0101a';
    ctx.fillRect(-3.5, -16, 7, 16);
    ctx.restore();
    drawGlow(ctx, '#ff3040', s.x, s.y + 10, 30, 0.45);
  } else if (s.kind === 'fireball') {
    drawGlow(ctx, '#ff4a00', s.x, s.y, s.r * 4, 0.85);
    drawGlow(ctx, '#ffe080', s.x, s.y, s.r * 1.8, 1);
    ctx.fillStyle = '#fffbe8';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 0.6, 0, TAU);
    ctx.fill();
  } else {
    drawGlow(ctx, '#7dff4a', s.x, s.y, s.r * 3, 0.9);
    ctx.fillStyle = '#eaffd8';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 0.6, 0, TAU);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Invader formation (levels 5, 15, 25...)

export class InvaderWave {
  originX: number;
  originY = FIELD.y + 120;
  dir = 1;
  private stepTimer = 0;
  stepIndex = 0;
  readonly members: Enemy[] = [];
  private readonly total: number;
  private fireTimer = 1.5;

  constructor(
    readonly cols: number,
    readonly rows: number,
    private readonly fireRate: number,
  ) {
    this.originX = FIELD.x + FIELD.w / 2;
    const sx = 132;
    const sy = 86;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const e = makeEnemy('invader', 0, 0);
        e.slotX = (c - (cols - 1) / 2) * sx;
        e.slotY = r * sy;
        e.variant = r % 3;
        e.score = 100 + (rows - r) * 30;
        // Fly in from above, staggered.
        e.entering = 0.6 + (r * cols + c) * 0.05;
        this.members.push(e);
      }
    }
    this.total = this.members.length;
  }

  get alive(): number {
    return this.members.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
  }

  /** Returns a pitch index when the formation steps (for the classic march sound). */
  update(dt: number, onShoot: (x: number, y: number) => void): number | null {
    const alive = this.members.filter((m) => m.alive);
    if (!alive.length) return null;
    let stepped: number | null = null;
    // The march speeds up as the formation thins out, like the 1978 classic.
    const interval = 0.18 + 0.55 * (alive.length / this.total);
    this.stepTimer += dt;
    if (this.stepTimer >= interval) {
      this.stepTimer -= interval;
      this.originX += this.dir * 26;
      let minX = Infinity;
      let maxX = -Infinity;
      for (const m of alive) {
        minX = Math.min(minX, this.originX + m.slotX);
        maxX = Math.max(maxX, this.originX + m.slotX);
      }
      if (maxX > FIELD.right - 70 || minX < FIELD.x + 70) {
        this.dir *= -1;
        this.originX += this.dir * 26;
        if (this.originY < FIELD.y + 330) this.originY += 30;
      }
      stepped = this.stepIndex++ % 4;
    }
    for (const m of this.members) {
      m.t += dt;
      if (m.flash > 0) m.flash -= dt * 4;
      const tx = this.originX + m.slotX;
      const ty = this.originY + m.slotY;
      if (m.entering > 0) {
        m.entering -= dt;
        const k = clamp(1 - m.entering / 0.6, 0, 1);
        m.x = tx;
        m.y = ty - (1 - k) * 700;
      } else {
        m.x = tx;
        m.y = ty;
      }
    }
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer = rand(0.6, 1.6) / this.fireRate;
      // Only invaders at the bottom of their column shoot.
      const bottoms = new Map<number, Enemy>();
      for (const m of alive) {
        if (m.entering > 0) continue;
        const cur = bottoms.get(m.slotX);
        if (!cur || m.slotY > cur.slotY) bottoms.set(m.slotX, m);
      }
      const shooters = [...bottoms.values()];
      const s = shooters[Math.floor(Math.random() * shooters.length)];
      if (s) onShoot(s.x, s.y + 30);
    }
    return stepped;
  }
}
