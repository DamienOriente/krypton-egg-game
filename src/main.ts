import { audio } from './audio/audio';
import { VIEW_H, VIEW_W } from './config';
import { input } from './core/input';
import { Game, toggleFullscreen } from './game/game';
import { sprites } from './render/sprites';

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
if (!canvas) throw new Error('#game canvas missing');
canvas.width = VIEW_W;
canvas.height = VIEW_H;
const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) throw new Error('Canvas 2D not supported');
ctx.imageSmoothingQuality = 'high';

input.attach(canvas);
// Warm the sprite bank before the first frame so the title never hitches.
sprites();
const game = new Game(ctx);
// The desktop build allows audio without a gesture (see electron/main.js): unlocking now lets the
// logo intro start with its sound right away instead of waiting on the "press start" screen.
if (navigator.userAgent.includes('Electron/')) audio.unlock();
if (import.meta.env.DEV) {
  // Dev-only console handle for QA (autopilot, stage skipping); stripped from production builds.
  Object.assign(window, { __ke: { game } });
}

// Audio unlock and pointer lock must happen synchronously inside a user gesture.
const gesture = (): void => game.onGesture();
canvas.addEventListener('mousedown', gesture);
canvas.addEventListener('touchstart', gesture, { passive: true });
window.addEventListener('keydown', (e) => {
  gesture();
  if (e.code === 'KeyF' && !e.repeat && !game.typing) toggleFullscreen();
});

let last = performance.now();
function frame(now: number): void {
  // Clamp long frames (tab switch, breakpoint) so the simulation never explodes.
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  game.frame(dt);
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
