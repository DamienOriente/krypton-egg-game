/**
 * Level layout format.
 *
 * `rows`: at most MAX_ROWS (13) strings, each exactly COLS (18) chars.
 * Row 0 is the top row of the brick grid.
 *
 * Legend:
 *   .  empty
 *   r o y l g c b v p w k n   1-hit bricks: red, orange, yellow, lime, green, cyan,
 *                             blue, violet, pink, white, grey, brown
 *   S  silver: multi-hit (2 hits, 3 from level 31)
 *   G  gold: indestructible
 *   R  regenerating: comes back ~8 s after being destroyed unless the level ends
 *   X  explosive: destroys its 8 neighbours (chain reactions allowed)
 *   T  teleporter: paired in reading order (1st<->2nd, 3rd<->4th...). Even count.
 */
export interface LevelDef {
  name: string;
  rows: string[];
  /** Background plate pattern 0..4. */
  background?: number;
}

export const BRICK_CHARS = 'roylgcbvpwknSGRXT';
