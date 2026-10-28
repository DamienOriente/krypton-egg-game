// @ts-check
// Pure helpers for the desktop smoke test, kept apart from main.js so Node can test them.

/** Below this brightness spread (0..255 luma) a capture is "nearly uniform": the game did not draw. */
export const MIN_LUMA_STD = 10;

/**
 * Mean and standard deviation of the luma of a BGRA bitmap (NativeImage.toBitmap()),
 * sampled on a 4-pixel grid: plenty to tell a rendered screen from a blank one.
 * @param {Uint8Array} bgra
 * @param {number} width
 * @param {number} height
 * @returns {{ mean: number, std: number }}
 */
export function lumaStats(bgra, width, height) {
  let n = 0;
  let sum = 0;
  let sq = 0;
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * 4;
      const l = 0.0722 * (bgra[i] ?? 0) + 0.7152 * (bgra[i + 1] ?? 0) + 0.2126 * (bgra[i + 2] ?? 0);
      n++;
      sum += l;
      sq += l * l;
    }
  }
  if (n === 0) return { mean: 0, std: 0 };
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}
