// Gray-image helpers for finding things on screen. Pure functions on typed arrays.
// A gray image is { gray: Uint8Array, width, height }.

/** Resize a gray image. Averages boxes when shrinking (no aliasing), bilinear when growing. */
export function resizeGray(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh);
  const fx = sw / dw;
  const fy = sh / dh;
  if (fx >= 1 && fy >= 1) {
    for (let y = 0; y < dh; y++) {
      const y0 = Math.floor(y * fy);
      const y1 = Math.max(y0 + 1, Math.min(sh, Math.floor((y + 1) * fy)));
      for (let x = 0; x < dw; x++) {
        const x0 = Math.floor(x * fx);
        const x1 = Math.max(x0 + 1, Math.min(sw, Math.floor((x + 1) * fx)));
        let sum = 0;
        for (let yy = y0; yy < y1; yy++) {
          const row = yy * sw;
          for (let xx = x0; xx < x1; xx++) sum += src[row + xx];
        }
        out[y * dw + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
      }
    }
    return out;
  }
  for (let y = 0; y < dh; y++) {
    const sy = clamp((y + 0.5) * fy - 0.5, 0, sh - 1);
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = clamp((x + 0.5) * fx - 0.5, 0, sw - 1);
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = sx - x0;
      const top = src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx;
      const bottom = src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx;
      out[y * dw + x] = Math.round(top * (1 - wy) + bottom * wy);
    }
  }
  return out;
}

/** Copy a rectangle out of a gray image. */
export function cropGray(src, sw, rect) {
  const out = new Uint8Array(rect.width * rect.height);
  for (let y = 0; y < rect.height; y++) {
    const from = (rect.y + y) * sw + rect.x;
    out.set(src.subarray(from, from + rect.width), y * rect.width);
  }
  return out;
}

/** Summed-area tables of values and squares, so any box's mean and variance cost O(1). */
export function integralImages(img, w, h) {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  const sq = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 0; x < w; x++) {
      const v = img[y * w + x];
      rowSum += v;
      rowSq += v * v;
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + rowSum;
      sq[(y + 1) * W + x + 1] = sq[y * W + x + 1] + rowSq;
    }
  }
  return { sum, sq, W };
}

/**
 * Normalized cross-correlation of a template over an image.
 * Returns the best top-left position and its score (-1..1; 1 = identical up to
 * brightness and contrast). Flat image patches score 0.
 *
 * area limits the top-left positions searched ({x0, y0, x1, y1}, inclusive).
 * step > 1 checks every step-th position only (a quick first pass).
 * keep > 1 also returns `peaks`: up to `keep` best positions at least `spread` px apart,
 * so a quick pass can hand several candidates to a closer look.
 * integrals (from integralImages) speed up big searches; small ones compute sums inline.
 */
export function matchTemplate(img, iw, ih, tpl, tw, th, { area, integrals, step = 1, keep = 1, spread = 3 } = {}) {
  const none = { x: -1, y: -1, score: 0 };
  if (tw > iw || th > ih || tw < 1 || th < 1) return none;
  const n = tw * th;

  let tMean = 0;
  for (let i = 0; i < n; i++) tMean += tpl[i];
  tMean /= n;
  const tz = new Float32Array(n);
  let tNorm = 0;
  for (let i = 0; i < n; i++) {
    tz[i] = tpl[i] - tMean;
    tNorm += tz[i] * tz[i];
  }
  if (tNorm < 1e-6) return none; // a flat template matches everything equally: useless
  tNorm = Math.sqrt(tNorm);

  const x0 = Math.max(0, area?.x0 ?? 0);
  const y0 = Math.max(0, area?.y0 ?? 0);
  const x1 = Math.min(iw - tw, area?.x1 ?? iw - tw);
  const y1 = Math.min(ih - th, area?.y1 ?? ih - th);

  let best = none;
  const peaks = [];
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      let dot = 0;
      let s = 0;
      let s2 = 0;
      if (integrals) {
        const { sum, sq, W } = integrals;
        const a = y * W + x;
        const b = y * W + x + tw;
        const c = (y + th) * W + x;
        const d = (y + th) * W + x + tw;
        s = sum[d] - sum[b] - sum[c] + sum[a];
        s2 = sq[d] - sq[b] - sq[c] + sq[a];
        for (let ty = 0; ty < th; ty++) {
          const ri = (y + ty) * iw + x;
          const rt = ty * tw;
          for (let tx = 0; tx < tw; tx++) dot += img[ri + tx] * tz[rt + tx];
        }
      } else {
        for (let ty = 0; ty < th; ty++) {
          const ri = (y + ty) * iw + x;
          const rt = ty * tw;
          for (let tx = 0; tx < tw; tx++) {
            const v = img[ri + tx];
            dot += v * tz[rt + tx];
            s += v;
            s2 += v * v;
          }
        }
      }
      const varSum = s2 - (s * s) / n;
      if (varSum < 1e-6) continue;
      // sum((I - mean I) * tz) equals sum(I * tz) because tz sums to zero.
      const score = dot / (Math.sqrt(varSum) * tNorm);
      if (score > best.score) best = { x, y, score };
      if (keep > 1) addPeak(peaks, { x, y, score }, keep, spread);
    }
  }
  return keep > 1 ? { ...best, peaks } : best;
}

// Keep the `keep` best hits, dropping any hit within `spread` px of a better one.
function addPeak(peaks, hit, keep, spread) {
  if (peaks.length === keep && hit.score <= peaks[keep - 1].score) return;
  for (let i = peaks.length - 1; i >= 0; i--) {
    const p = peaks[i];
    if (Math.abs(p.x - hit.x) <= spread && Math.abs(p.y - hit.y) <= spread) {
      if (p.score >= hit.score) return;
      peaks.splice(i, 1);
    }
  }
  peaks.push(hit);
  peaks.sort((a, b) => b.score - a.score);
  if (peaks.length > keep) peaks.length = keep;
}

/**
 * Median brightness and median chroma (max(R,G,B) - min(R,G,B), 0-255) of a
 * rectangle in an RGBA buffer. Used to confirm the pale, grayish listing panel.
 */
export function rgbaStats(rgba, width, rect) {
  const bright = new Uint32Array(256);
  const chroma = new Uint32Array(256);
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      bright[(77 * r + 150 * g + 29 * b) >> 8]++;
      chroma[Math.max(r, g, b) - Math.min(r, g, b)]++;
    }
  }
  const n = rect.width * rect.height;
  return { medianBrightness: histMedian(bright, n), medianChroma: histMedian(chroma, n) };
}

/** Median of the gray values inside a rectangle. */
export function grayMedian(gray, width, rect) {
  const hist = new Uint32Array(256);
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) hist[gray[y * width + x]]++;
  }
  return histMedian(hist, rect.width * rect.height);
}

/** Standard deviation of a gray buffer: a cheap "is there any detail here" check. */
export function grayStdDev(gray) {
  if (!gray.length) return 0;
  let s = 0;
  let s2 = 0;
  for (const v of gray) {
    s += v;
    s2 += v * v;
  }
  const mean = s / gray.length;
  return Math.sqrt(Math.max(0, s2 / gray.length - mean * mean));
}

function histMedian(hist, n) {
  if (n === 0) return 0;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen * 2 >= n) return v;
  }
  return 255;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
