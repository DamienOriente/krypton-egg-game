// Fixed internal resolution: the game always renders at 2560x1440 ("2K") and the
// canvas is letterboxed to the window by CSS.
export const VIEW_W = 2560;
export const VIEW_H = 1440;

export const COLS = 18;
export const MAX_ROWS = 13;
export const BRICK_W = 112;
export const BRICK_H = 56;

export const HUD_H = 128;
export const FRAME_T = 56;

/** Inner playfield (inside the wooden frame). The bottom is open. */
export const FIELD = {
  x: 272,
  y: 200,
  w: COLS * BRICK_W,
  h: VIEW_H - 200,
  get right(): number {
    return this.x + this.w;
  },
  get bottom(): number {
    return this.y + this.h;
  },
} as const;

/** One empty row is kept above the bricks so enemies can enter through the gate. */
export const GRID_TOP = FIELD.y + BRICK_H;

export const PADDLE_Y = 1330;
export const PADDLE_H = 44;
export const PADDLE_W = { small: 170, normal: 250, large: 380 } as const;

export const BALL_R = 13;
export const BALL_SPEED_START = 900;
export const BALL_SPEED_MAX = 1650;

export const START_LIVES = 4;
export const LEVEL_COUNT = 60;
