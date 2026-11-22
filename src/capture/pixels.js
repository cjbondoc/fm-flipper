// Small pixel helpers. Pure functions on typed arrays, so they run in tests without a browser.

/**
 * RGBA bytes (as from getImageData) to one gray byte per pixel.
 * Integer weights 77/150/29 sum to 256, an integer form of the usual luma weights.
 */
export function toGray(rgba, width, height) {
  const n = width * height;
  if (rgba.length < n * 4) throw new RangeError("rgba buffer is smaller than width × height × 4");
  const gray = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    gray[i] = (77 * rgba[j] + 150 * rgba[j + 1] + 29 * rgba[j + 2]) >> 8;
  }
  return gray;
}

/** Size that fits targetWidth while keeping the aspect ratio. Never scales up. */
export function fitWidth(width, height, targetWidth) {
  if (!(width > 0) || !(height > 0)) throw new RangeError("width and height must be > 0");
  if (width <= targetWidth) return { width, height };
  return { width: targetWidth, height: Math.max(1, Math.round((height * targetWidth) / width)) };
}

/**
 * Fraction (0-1) of pixels whose gray values differ by more than pixelThreshold.
 * Counting changed pixels, rather than averaging the difference, ignores video
 * compression noise yet still notices a small window opening.
 */
export function changedFraction(a, b, pixelThreshold) {
  if (a.length !== b.length) throw new RangeError("frames must be the same size");
  if (a.length === 0) return 0;
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    if (d > pixelThreshold || d < -pixelThreshold) changed++;
  }
  return changed / a.length;
}

/**
 * A region given as fractions of the frame ({x, y, width, height}, each 0-1)
 * converted to whole pixels and clamped inside the frame. null means the whole frame.
 */
export function regionToPixels(region, frameWidth, frameHeight) {
  if (!region) return { x: 0, y: 0, width: frameWidth, height: frameHeight };
  const x = clamp(Math.floor(region.x * frameWidth), 0, frameWidth - 1);
  const y = clamp(Math.floor(region.y * frameHeight), 0, frameHeight - 1);
  const right = clamp(Math.ceil((region.x + region.width) * frameWidth), x + 1, frameWidth);
  const bottom = clamp(Math.ceil((region.y + region.height) * frameHeight), y + 1, frameHeight);
  return { x, y, width: right - x, height: bottom - y };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
