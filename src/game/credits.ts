import { VIEW_H, VIEW_W } from '../config';
import { TAU, clamp, easeOutCubic, rand } from '../core/math';
import { input } from '../core/input';
import { titleBackground } from '../render/background';
import { drawGlow, type Ctx } from '../render/canvas';
import { drawText, STYLE, textWidth, type TextStyle } from '../render/font';
import { BRICK_COLORS, sprites } from '../render/sprites';
import { BRICK_H, BRICK_W } from '../config';
import { Boss } from './boss';
import { MemeLayer } from './memes';

/** One name for every job, like a AAA crawl staffed by a single heroic person. */
const NAME = 'CLAUDO';

type Item =
  | { kind: 'title'; text: string }
  | { kind: 'header'; text: string }
  | { kind: 'role'; role: string }
  | { kind: 'note'; text: string }
  | { kind: 'gap'; h: number }
  | { kind: 'final' };

const role = (r: string): Item => ({ kind: 'role', role: r });
const header = (text: string): Item => ({ kind: 'header', text });
const note = (text: string): Item => ({ kind: 'note', text });
const gap = (h = 120): Item => ({ kind: 'gap', h });

const ITEMS: Item[] = [
  { kind: 'title', text: 'KRYPTON EGG' },
  note('REMAKE 2K'),
  gap(160),
  header('UN JEU CLAUDO'),
  gap(200),
  header('DIRECTION'),
  role('REALISATEUR'),
  role('DIRECTEUR DE LA DIRECTION'),
  role('ASSISTANT DU DIRECTEUR DE LA DIRECTION'),
  role('VISIONNAIRE EN CHEF (PORTE DES LUNETTES)'),
  gap(),
  header('PRODUCTION'),
  role('PRODUCTION'),
  role('PRODUCTEUR EXECUTIF DE LA PRODUCTION EXECUTIVE'),
  role('CHEF DE PROJET DU CHEF DE PROJET'),
  role('RESPONSABLE DES REUNIONS QUI AURAIENT PU ETRE UN MAIL'),
  role('GESTIONNAIRE DES DEADLINES (DEPASSEES)'),
  gap(),
  header('GAME DESIGN'),
  role('GAME DESIGNER'),
  role('INGENIEUR EN REBOND DE BALLE'),
  role('SPECIALISTE DES ANGLES BIZARRES'),
  role('PSYCHOLOGUE DES BRIQUES EN OR'),
  role('CONSULTANT EN OEUFS'),
  role('EQUILIBRAGE (A LA LOUCHE)'),
  role('INVENTEUR DE LA TOUCHE M'),
  gap(),
  header('PROGRAMMATION'),
  role('PROGRAMMEUR PRINCIPAL'),
  role('PROGRAMMEUR SECONDAIRE (LE MEME)'),
  role('CREATION DES BUGS'),
  role('CORRECTION DES BUGS'),
  role('CREATION DE NOUVEAUX BUGS EN CORRIGEANT LES ANCIENS'),
  role('PHYSICIEN QUANTIQUE DE LA RAQUETTE'),
  role('RESPONSABLE DES COMMITS ATOMIQUES'),
  role('NEGOCIATEUR AVEC LE CLASSIFIEUR DE PERMISSIONS'),
  gap(),
  header('GRAPHISMES'),
  role('DIRECTION ARTISTIQUE'),
  role('COLORISTE DES PIXELS TEAL'),
  role('LUSTREUR DE BRIQUES'),
  role('VERNISSEUR DU CADRE EN BOIS'),
  role('DESSINATEUR DE DEBRIS (TRES PETITS)'),
  role('MAQUILLEUR DE L OEUF KRYPTON'),
  gap(),
  header('AUDIO'),
  role('MUSIQUE'),
  role('BRUITAGES'),
  role('ACCORDEUR DES BRIQUES EN MI'),
  role('COACH VOCAL DE L OEUF KRYPTON'),
  role('DOUBLURE DE LA BALLE (ROLE MUET)'),
  role('INGENIEUR DU TREMBLEMENT DE TERRE'),
  role('TECHNICIEN DU BASS DROP'),
  gap(),
  header('CONTROLE QUALITE'),
  role('TESTEUR EN CHEF'),
  role('TESTEUR DE LA TOUCHE M (243 FOIS)'),
  role('AVOCAT DE LA BARRIERE PERMANENTE'),
  role('A PERDU 4 VIES POUR LA SCIENCE'),
  role('A CONFONDU PAUSE ET BARRIERE'),
  gap(),
  header('LOCALISATION'),
  role('TRADUCTION FRANCAIS > FRANCAIS'),
  role('CONVERSION QWERTY > AZERTY'),
  role('RELECTURE DES ACCENTS (SUPPRIMES)'),
  gap(),
  header('MARKETING'),
  role('RESPONSABLE DE LA HYPE'),
  role('STAGIAIRE TIKTOK'),
  role('FABRICANT DE MEMES'),
  gap(),
  header('SERVICES GENERAUX'),
  role('DIRECTEUR DU DEPARTEMENT CAFE'),
  role('STAGIAIRE CAFE'),
  role('RESPONSABLE DE LA PLANTE VERTE'),
  role('CATERING (CROISSANTS)'),
  role('GARDIEN DU PARKING (IL N Y A PAS DE PARKING)'),
  gap(),
  header('REMERCIEMENTS SPECIAUX'),
  note('LA BALLE, POUR SA PATIENCE'),
  note('LES 243 CLONES DE LA BALLE'),
  note('L OEUF KRYPTON, POUR AVOIR ACCEPTE DE PERDRE 6 FOIS'),
  note('ALEXANDRE KRAL, POUR LE JEU ORIGINAL (1989)'),
  note('ET RAPH, EVIDEMMENT'),
  gap(200),
  note('AUCUN OEUF N A ETE MALTRAITE PENDANT LE DEVELOPPEMENT'),
  note('(SAUF SIX)'),
  gap(160),
  note('TOUTE RESSEMBLANCE AVEC UN CASSE-BRIQUES'),
  note('EXISTANT EST VOLONTAIRE'),
  gap(280),
  { kind: 'final' },
];

const ROLE_STYLE: TextStyle = { size: 4.2, top: '#d8f6ff', bottom: '#3fc8ff', outline: true };
const NAME_STYLE: TextStyle = { ...STYLE.gold, size: 8 };
const HEADER_STYLE: TextStyle = { ...STYLE.pink, size: 8 };
const NOTE_STYLE: TextStyle = { size: 5, top: '#ffffff', bottom: '#c8d6ee', outline: true };
const TITLE_STYLE: TextStyle = { ...STYLE.title, size: 18 };
const COLUMN = 1120;
const BASE_SPEED = 115;
const FAST = 7;
const FINAL_H = 560;

interface Placed {
  item: Item;
  y: number;
  lines: string[];
}

function wrap(text: string, style: TextStyle, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && textWidth(next, style) > max) {
      out.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

interface Floater {
  ch: string;
  x: number;
  y: number;
  depth: number;
  rot: number;
  vr: number;
}

export class CreditsScreen {
  private readonly placed: Placed[] = [];
  private readonly finalY: number;
  private scroll = 0;
  private t = 0;
  /** Seconds since the crawl stopped on the final card. */
  private endT = -1;
  private readonly memes = new MemeLayer();
  private readonly floaters: Floater[] = [];
  private readonly egg = new Boss(6);
  done = false;

  constructor() {
    let y = VIEW_H + 60;
    for (const item of ITEMS) {
      let h = 0;
      let lines: string[] = [];
      switch (item.kind) {
        case 'title':
          h = 7 * TITLE_STYLE.size + 40;
          break;
        case 'header':
          h = 7 * HEADER_STYLE.size + 70;
          break;
        case 'role':
          lines = wrap(item.role, ROLE_STYLE, COLUMN);
          h = lines.length * 40 + 7 * NAME_STYLE.size + 70;
          break;
        case 'note':
          lines = wrap(item.text, NOTE_STYLE, COLUMN);
          h = lines.length * 50 + 24;
          break;
        case 'gap':
          h = item.h;
          break;
        case 'final':
          h = FINAL_H;
          break;
      }
      this.placed.push({ item, y, lines });
      y += h;
    }
    const final = this.placed[this.placed.length - 1]!;
    // The crawl stops when the final card is centred on screen.
    this.finalY = final.y + FINAL_H / 2 - VIEW_H / 2;
    const keys = Object.keys(BRICK_COLORS).filter((k) => k !== 'X');
    for (let i = 0; i < 28; i++) {
      this.floaters.push({ ch: keys[i % keys.length]!, x: rand(0, VIEW_W), y: rand(0, VIEW_H), depth: rand(0.15, 0.6), rot: rand(0, TAU), vr: rand(-0.3, 0.3) });
    }
    this.egg.phase = 'fight';
  }

  get ended(): boolean {
    return this.endT >= 0;
  }

  update(dt: number): void {
    this.t += dt;
    const fast = input.mouseDown(0) || input.isDown('Space') || input.isDown('ArrowDown');
    if (input.wasPressed('Escape')) {
      this.done = true;
      return;
    }
    if (this.endT < 0) {
      const v = BASE_SPEED * (fast ? FAST : 1);
      this.scroll = Math.min(this.finalY, this.scroll + v * dt);
      for (const f of this.floaters) {
        f.y -= v * f.depth * dt;
        f.rot += f.vr * dt;
        if (f.y < -80) {
          f.y = VIEW_H + 80;
          f.x = rand(0, VIEW_W);
        }
      }
      if (this.scroll >= this.finalY) this.endT = 0;
    } else {
      this.endT += dt;
      this.egg.animate(dt);
      if (this.endT > 2 && (input.mousePressed(0) || input.wasPressed('Enter', 'Space'))) this.done = true;
    }
    // No new gags over the post-credits scene.
    this.memes.update(dt, this.endT < 5);
  }

  render(ctx: Ctx): void {
    ctx.drawImage(titleBackground(), 0, 0);
    ctx.fillStyle = 'rgba(2,4,10,0.8)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const spr = sprites();
    for (const f of this.floaters) {
      ctx.save();
      ctx.globalAlpha = 0.12 + f.depth * 0.35;
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.scale(f.depth * 1.6, f.depth * 1.6);
      ctx.drawImage(spr.bricks[f.ch]!, -BRICK_W / 2, -BRICK_H / 2);
      ctx.restore();
    }
    drawGlow(ctx, '#2a7aff', VIEW_W / 2, VIEW_H / 2, 900, 0.08);

    const cx = VIEW_W / 2;
    // The whole crawl fades out before the post-credits scene.
    const fadeOut = this.endT > 5 ? clamp(1 - (this.endT - 5) / 0.8, 0, 1) : 1;
    ctx.globalAlpha = fadeOut;
    for (const p of this.placed) {
      const y = p.y - this.scroll;
      if (y > VIEW_H + 40 || y < -FINAL_H - 40) continue;
      const it = p.item;
      switch (it.kind) {
        case 'title':
          drawGlow(ctx, '#ff7a00', cx, y + 60, 700, 0.2);
          drawText(ctx, it.text, cx, y, TITLE_STYLE, 'center');
          break;
        case 'header': {
          drawText(ctx, it.text, cx, y, HEADER_STYLE, 'center');
          const w = textWidth(it.text, HEADER_STYLE) / 2 + 40;
          ctx.fillStyle = 'rgba(255,79,184,0.5)';
          ctx.fillRect(cx - w - 180, y + 26, 180, 4);
          ctx.fillRect(cx + w, y + 26, 180, 4);
          break;
        }
        case 'role':
          p.lines.forEach((l, i) => drawText(ctx, l, cx, y + i * 40, ROLE_STYLE, 'center'));
          drawText(ctx, NAME, cx, y + p.lines.length * 40 + 8, NAME_STYLE, 'center');
          break;
        case 'note':
          p.lines.forEach((l, i) => drawText(ctx, l, cx, y + i * 50, NOTE_STYLE, 'center'));
          break;
        case 'final':
          this.renderFinal(ctx, y, fadeOut);
          break;
        case 'gap':
          break;
      }
    }
    ctx.globalAlpha = 1;
    if (this.endT > 5) this.renderPostCredits(ctx, this.endT - 5);
    this.memes.render(ctx);

    if (this.endT < 0) {
      drawText(ctx, 'MAINTENIR CLIC : ACCELERER   -   ECHAP : PASSER', VIEW_W - 40, VIEW_H - 50, STYLE.tiny, 'right', 0.45);
    } else if (this.endT > 2) {
      drawText(ctx, 'CLIC POUR REVENIR AU TITRE', cx, VIEW_H - 90, STYLE.small, 'center', 0.5 + 0.5 * Math.sin(this.t * 4));
    }
  }

  private renderFinal(ctx: Ctx, y: number, alpha: number): void {
    if (alpha <= 0) return;
    const cx = VIEW_W / 2;
    drawGlow(ctx, '#ff7a00', cx, y + 120, 700, 0.18 * alpha);
    drawText(ctx, 'MERCI D AVOIR JOUE !', cx, y + 40, { ...STYLE.title, size: 10 }, 'center', alpha);
    const line = 'DEVELOPPE AVEC';
    const line2 = 'POUR MON POTE RAPH';
    const w1 = textWidth(line, STYLE.gold);
    const heartW = 80;
    const x1 = cx - (w1 + 30 + heartW) / 2;
    const ly = y + 270;
    drawText(ctx, line, x1, ly, STYLE.gold, 'left', alpha);
    // The font has no heart glyph: draw one, beating.
    const hx = x1 + w1 + 30 + heartW / 2;
    const beat = 1 + 0.12 * Math.max(0, Math.sin(this.t * 7));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(hx, ly + 34);
    ctx.scale(beat, beat);
    drawGlow(ctx, '#ff2a6a', 0, 0, 90, 0.5);
    ctx.fillStyle = '#ff2a6a';
    ctx.beginPath();
    ctx.moveTo(0, 26);
    ctx.bezierCurveTo(-60, -10, -30, -55, 0, -22);
    ctx.bezierCurveTo(30, -55, 60, -10, 0, 26);
    ctx.fill();
    ctx.restore();
    drawText(ctx, line2, cx, ly + 110, STYLE.gold, 'center', alpha);
  }

  /** Marvel-style stinger: the black egg rises again, eye wide open. */
  private renderPostCredits(ctx: Ctx, t: number): void {
    const k = easeOutCubic(clamp(t / 2.5, 0, 1));
    const e = this.egg;
    e.x = VIEW_W / 2;
    e.y = VIEW_H + 320 - k * 760;
    e.render(ctx, VIEW_W / 2 + Math.sin(this.t * 0.8) * 500);
    if (t > 1.2) drawText(ctx, 'SCENE POST-GENERIQUE', VIEW_W / 2, 120, STYLE.small, 'center', clamp((t - 1.2) / 0.6, 0, 1) * 0.7);
    if (t > 2.6) drawText(ctx, 'L OEUF KRYPTON REVIENDRA...', VIEW_W / 2, 230, STYLE.red, 'center', clamp((t - 2.6) / 0.8, 0, 1));
  }
}
