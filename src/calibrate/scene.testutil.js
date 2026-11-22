// Synthetic frames for tests: a busy background with a fake shop window drawn on top.
// Everything is drawn from rectangles, so the window can be drawn at any scale.

/** Deterministic pseudo-random numbers (so tests never flake). */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function busyBackground(width, height, seed = 7) {
  const gray = new Uint8Array(width * height).fill(90);
  const r = rng(seed);
  for (let i = 0; i < 400; i++) {
    const w = 4 + Math.floor(r() * 60);
    const h = 4 + Math.floor(r() * 60);
    fill(gray, width, height, Math.floor(r() * width), Math.floor(r() * height), w, h, Math.floor(r() * 256));
  }
  return gray;
}

// Window-local layout at scale 1. The anchor is the "buttons" block; the panel holds 6 rows of 40 px.
export const WINDOW = { width: 320, height: 380 };
export const ANCHOR = { x: 220, y: 30, width: 80, height: 60 };
export const PANEL = { x: 10, y: 120, width: 200, height: 240 };

/**
 * Draw the window at (ox, oy) and `scale`.
 * rows: per row "full" (dark text), "sold" (light gray text) or "empty".
 */
export function drawWindow(gray, width, height, ox, oy, scale, rows = ["full", "full", "sold", "full", "empty", "empty"]) {
  const R = (x, y, w, h, v) =>
    fill(gray, width, height, Math.round(ox + x * scale), Math.round(oy + y * scale), Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), v);
  R(0, 0, WINDOW.width, WINDOW.height, 150); // window body
  // Anchor: three "buttons" with "lettering", distinctive enough to find.
  R(ANCHOR.x, ANCHOR.y, ANCHOR.width, ANCHOR.height, 60);
  for (let b = 0; b < 3; b++) {
    R(ANCHOR.x + 4, ANCHOR.y + 4 + b * 19, 72, 15, [200, 120, 170][b]);
    for (let k = 0; k < 6; k++) R(ANCHOR.x + 10 + k * 10 + (b % 2) * 3, ANCHOR.y + 8 + b * 19, 5, 7, 30);
  }
  // Listing panel: pale background, rows with an icon and two lines of "text".
  R(PANEL.x, PANEL.y, PANEL.width, PANEL.height, 225);
  rows.forEach((kind, i) => {
    const y = PANEL.y + i * 40;
    R(PANEL.x, y, PANEL.width, 1, 205); // faint separator
    if (kind === "empty") return;
    const ink = kind === "sold" ? 160 : 35;
    R(PANEL.x + 4, y + 4, 32, 32, kind === "sold" ? 180 : 70); // icon
    for (let k = 0; k < 9; k++) R(PANEL.x + 44 + k * 12, y + 8, 8, 9, ink); // name
    for (let k = 0; k < 11; k++) R(PANEL.x + 44 + k * 12, y + 23, 8, 9, ink); // "qty for price"
  });
}

export function grayToRgba(gray) {
  const rgba = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0; i < gray.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = gray[i];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export function scene({ width = 1000, height = 600, x = 300, y = 150, scale = 1, rows, window = true, seed } = {}) {
  const gray = busyBackground(width, height, seed);
  if (window) drawWindow(gray, width, height, x, y, scale, rows);
  return { gray, width, height, rgba: grayToRgba(gray) };
}

export function fill(gray, width, height, x, y, w, h, v) {
  for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) {
    gray.fill(v, yy * width + Math.max(0, x), yy * width + Math.min(width, x + w));
  }
}
