import { LEVEL_COUNT, START_LIVES } from '../config';
import { loadJson, saveJson } from '../core/storage';

export type Stage = { kind: 'level'; level: number } | { kind: 'boss'; tier: number };

/** L1..L10, boss 1, L11..L20, boss 2, ... L60, boss 6. */
export const STAGES: Stage[] = (() => {
  const out: Stage[] = [];
  for (let l = 1; l <= LEVEL_COUNT; l++) {
    out.push({ kind: 'level', level: l });
    if (l % 10 === 0) out.push({ kind: 'boss', tier: l / 10 });
  }
  return out;
})();

export const stageIndexOfLevel = (level: number): number =>
  STAGES.findIndex((s) => s.kind === 'level' && s.level === level);

/** Sector codes revealed after each boss (noble gases, krypton's family). */
const CODE_LIST = ['NEON', 'ARGO', 'XENO', 'RADO', 'HELI'] as const;

export function codeAfterBoss(tier: number): string | null {
  return CODE_LIST[tier - 1] ?? null;
}

export function stageForCode(code: string): number | null {
  const i = CODE_LIST.indexOf(code.toUpperCase() as (typeof CODE_LIST)[number]);
  return i < 0 ? null : stageIndexOfLevel((i + 1) * 10 + 1);
}

export interface ScoreEntry {
  score: number;
  level: number;
  date: string;
}

interface ScoreBook {
  entries: ScoreEntry[];
}

const SCORE_KEY = 'ke.scores';
const DEFAULT_HIGH = 5000;

export function loadScores(): ScoreEntry[] {
  const book = loadJson<ScoreBook>(SCORE_KEY, { entries: [] });
  return Array.isArray(book.entries) ? book.entries.slice(0, 5) : [];
}

/** Returns the rank (0-based) if the score entered the table, else -1. */
export function recordScore(score: number, level: number): number {
  const entries = loadScores();
  const entry: ScoreEntry = { score, level, date: new Date().toISOString().slice(0, 10) };
  entries.push(entry);
  entries.sort((a, b) => b.score - a.score);
  const top = entries.slice(0, 5);
  saveJson(SCORE_KEY, { entries: top });
  return top.indexOf(entry);
}

export function highScore(): number {
  const e = loadScores();
  return Math.max(DEFAULT_HIGH, e[0]?.score ?? 0);
}

const LIFE_THRESHOLDS = [20000, 60000, 120000];

export class Session {
  score = 0;
  lives = START_LIVES;
  stageIndex: number;
  readonly startHigh = highScore();
  private lifeIndex = 0;
  /** Called when a score threshold grants a life. */
  onExtraLife: (() => void) | null = null;

  constructor(stageIndex = 0) {
    this.stageIndex = stageIndex;
  }

  get stage(): Stage {
    return STAGES[this.stageIndex]!;
  }

  get high(): number {
    return Math.max(this.startHigh, this.score);
  }

  /** Level number used for difficulty; boss tier n behaves like level 10n. */
  get levelNumber(): number {
    const s = this.stage;
    return s.kind === 'level' ? s.level : s.tier * 10;
  }

  addScore(points: number): void {
    this.score += Math.round(points);
    const next = LIFE_THRESHOLDS[this.lifeIndex] ?? 100000 * (this.lifeIndex - LIFE_THRESHOLDS.length + 2);
    if (this.score >= next) {
      this.lifeIndex++;
      this.lives = Math.min(9, this.lives + 1);
      this.onExtraLife?.();
    }
  }
}
