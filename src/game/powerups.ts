import { weightedPick } from '../core/math';

export type PowerId =
  | 'expand'
  | 'shrink'
  | 'laser'
  | 'multi'
  | 'glue'
  | 'slow'
  | 'fast'
  | 'shield'
  | 'double'
  | 'fire'
  | 'big'
  | 'rocket'
  | 'life'
  | 'dynamite'
  | 'warp'
  | 'freeze'
  | 'dark'
  | 'drunk';

export interface PowerDef {
  id: PowerId;
  label: string;
  color: string;
  good: boolean;
  name: string;
  desc: string;
  weight: number;
  /** Seconds; 0 = instant effect. */
  duration: number;
  minLevel: number;
}

const def = (d: PowerDef): PowerDef => d;

export const POWERS: Record<PowerId, PowerDef> = {
  expand: def({ id: 'expand', label: '<>', color: '#2e8bff', good: true, name: 'GEANTE', desc: 'RAQUETTE GEANTE', weight: 10, duration: 25, minLevel: 1 }),
  laser: def({ id: 'laser', label: 'L', color: '#ff3a3a', good: true, name: 'LASERS', desc: 'CLIC DROIT : TIR', weight: 9, duration: 20, minLevel: 1 }),
  multi: def({ id: 'multi', label: 'M', color: '#a64dff', good: true, name: 'MULTI', desc: 'TROIS BALLES', weight: 9, duration: 0, minLevel: 1 }),
  glue: def({ id: 'glue', label: 'C', color: '#39d353', good: true, name: 'COLLE', desc: 'ATTRAPE LA BALLE', weight: 7, duration: 20, minLevel: 1 }),
  slow: def({ id: 'slow', label: 'S', color: '#ff9a1c', good: true, name: 'LENTE', desc: 'BALLE RALENTIE', weight: 7, duration: 15, minLevel: 1 }),
  shield: def({ id: 'shield', label: 'B', color: '#1fd8ff', good: true, name: 'BOUCLIER', desc: 'BARRIERE + ARMURE', weight: 6, duration: 15, minLevel: 2 }),
  double: def({ id: 'double', label: 'X2', color: '#ffd21a', good: true, name: 'X2', desc: 'POINTS DOUBLES', weight: 6, duration: 20, minLevel: 1 }),
  fire: def({ id: 'fire', label: 'F', color: '#ff5a00', good: true, name: 'FEU', desc: 'BALLE PERFORANTE', weight: 4, duration: 10, minLevel: 4 }),
  big: def({ id: 'big', label: 'O', color: '#ff7ab8', good: true, name: 'GROSSE', desc: 'BALLE PUISSANTE', weight: 5, duration: 15, minLevel: 3 }),
  rocket: def({ id: 'rocket', label: 'R', color: '#c8ced8', good: true, name: 'FUSEE', desc: 'LA RAQUETTE VOLE', weight: 4, duration: 18, minLevel: 3 }),
  life: def({ id: 'life', label: '1UP', color: '#ff2a6a', good: true, name: '1UP', desc: 'UNE VIE EN PLUS', weight: 1.6, duration: 0, minLevel: 2 }),
  dynamite: def({ id: 'dynamite', label: 'D', color: '#d81e1e', good: true, name: 'DYNAMITE', desc: 'TUE LES ENNEMIS', weight: 4, duration: 0, minLevel: 2 }),
  warp: def({ id: 'warp', label: 'W', color: '#ff4fe0', good: true, name: 'WARP', desc: 'NIVEAU SUIVANT', weight: 0.9, duration: 0, minLevel: 3 }),
  shrink: def({ id: 'shrink', label: '><', color: '#7a1a1a', good: false, name: 'MINI', desc: 'RAQUETTE REDUITE', weight: 6, duration: 20, minLevel: 2 }),
  fast: def({ id: 'fast', label: 'V', color: '#b0132a', good: false, name: 'RAPIDE', desc: 'BALLE ACCELEREE', weight: 6, duration: 12, minLevel: 2 }),
  freeze: def({ id: 'freeze', label: '*', color: '#8fd8ff', good: false, name: 'GEL', desc: 'RAQUETTE GELEE', weight: 3.5, duration: 2.2, minLevel: 4 }),
  dark: def({ id: 'dark', label: 'N', color: '#2a2a44', good: false, name: 'NUIT', desc: 'LUMIERES ETEINTES', weight: 3.5, duration: 12, minLevel: 6 }),
  drunk: def({ id: 'drunk', label: 'Z', color: '#c8a000', good: false, name: 'BIERE', desc: 'COMMANDES IVRES', weight: 3.5, duration: 10, minLevel: 5 }),
};

export const POWER_LIST = Object.values(POWERS);

export interface RollContext {
  level: number;
  hasEnemies: boolean;
  isBoss: boolean;
  ballCount: number;
}

export function rollPower(ctx: RollContext): PowerId {
  const entries: [PowerId, number][] = [];
  for (const p of POWER_LIST) {
    if (ctx.level < p.minLevel) continue;
    if (p.id === 'warp' && ctx.isBoss) continue;
    if (p.id === 'multi' && ctx.ballCount >= 9) continue;
    let w = p.weight;
    if (p.id === 'dynamite' && !ctx.hasEnemies) w *= 0.25;
    // Bad pickups get a little more common in the late game.
    if (!p.good) w *= 0.8 + Math.min(0.6, ctx.level / 100);
    entries.push([p.id, w]);
  }
  return weightedPick(entries);
}

export interface Capsule {
  id: PowerId;
  x: number;
  y: number;
  vy: number;
  t: number;
  alive: boolean;
}
