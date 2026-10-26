import { VIEW_H, VIEW_W } from '../config';

/**
 * Mouse (pointer lock for relative motion, like the original's mouse control),
 * keyboard and touch. Edge-triggered states are cleared by `endFrame()`.
 */
export class Input {
  /** Relative motion in game pixels accumulated since the last `consumeMotion()`. */
  private dx = 0;
  private dy = 0;
  /** Absolute pointer position in game pixels (mouse without lock, or touch). */
  pointerX = VIEW_W / 2;
  pointerY = VIEW_H / 2;
  pointerMoved = false;
  touchActive = false;
  locked = false;
  sensitivity = 1;

  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly buttonsHeld = new Set<number>();
  private readonly buttonsPressed = new Set<number>();
  readonly typed: string[] = [];
  /** Any key/click/touch since last endFrame (used for "press any key" screens). */
  anyPressed = false;

  private canvas: HTMLCanvasElement | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    const scale = (): number => VIEW_W / canvas.getBoundingClientRect().width;
    const toGame = (clientX: number, clientY: number): void => {
      const rect = canvas.getBoundingClientRect();
      this.pointerX = ((clientX - rect.left) / rect.width) * VIEW_W;
      this.pointerY = ((clientY - rect.top) / rect.height) * VIEW_H;
    };

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) {
        this.pressed.add(e.code);
        this.anyPressed = true;
      }
      this.held.add(e.code);
      if (e.key.length === 1) this.typed.push(e.key);
      else if (e.key === 'Backspace') this.typed.push('\b');
      else if (e.key === 'Enter') this.typed.push('\n');
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => {
      this.held.clear();
      this.buttonsHeld.clear();
    });

    canvas.addEventListener('mousemove', (e) => {
      if (this.locked) {
        const s = scale() * this.sensitivity;
        this.dx += e.movementX * s;
        this.dy += e.movementY * s;
      } else {
        toGame(e.clientX, e.clientY);
        this.pointerMoved = true;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      canvas.focus();
      this.buttonsHeld.add(e.button);
      this.buttonsPressed.add(e.button);
      this.anyPressed = true;
    });
    window.addEventListener('mouseup', (e) => this.buttonsHeld.delete(e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange?.(this.locked);
    });

    const onTouch = (e: TouchEvent): void => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) {
        toGame(t.clientX, t.clientY);
        this.pointerMoved = true;
      }
      this.touchActive = e.touches.length > 0;
    };
    canvas.addEventListener(
      'touchstart',
      (e) => {
        onTouch(e);
        this.buttonsPressed.add(0);
        this.buttonsHeld.add(0);
        if (e.touches.length > 1) this.buttonsPressed.add(2);
        this.anyPressed = true;
      },
      { passive: false },
    );
    canvas.addEventListener('touchmove', onTouch, { passive: false });
    canvas.addEventListener(
      'touchend',
      (e) => {
        onTouch(e);
        if (e.touches.length === 0) this.buttonsHeld.delete(0);
      },
      { passive: false },
    );
  }

  requestLock(): void {
    if (!this.canvas || this.locked || 'ontouchstart' in window) return;
    // requestPointerLock returns a promise in modern browsers and rejects when the
    // user gesture is missing; that is expected and only worth a debug line.
    const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    result?.catch?.((err: unknown) => console.debug('[input] pointer lock refused', err));
  }

  exitLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  consumeMotion(): { dx: number; dy: number } {
    const m = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return m;
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }
  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }
  mouseDown(button: number): boolean {
    return this.buttonsHeld.has(button);
  }
  mousePressed(button: number): boolean {
    return this.buttonsPressed.has(button);
  }

  endFrame(): void {
    this.pressed.clear();
    this.buttonsPressed.clear();
    this.typed.length = 0;
    this.anyPressed = false;
    this.pointerMoved = false;
  }
}

export const input = new Input();
