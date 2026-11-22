// Finds a calibrated shop window in a frame and splits its listing panel into rows.
//
// A calibration (see calibration.js) holds a small "anchor" picture of something on the
// window that never changes, plus where the listing panel sits relative to it. To find the
// window we search for the anchor with normalized cross-correlation:
//   1. coarse: shrink the frame to ~320 px wide and try a sweep of UI scales
//   2. fine:   check the best few spots at full resolution, nudging the scale slightly
// then confirm the listing panel really is the pale panel before trusting it.

import { toGray } from "../capture/pixels.js";
import { grayMedian, integralImages, matchTemplate, resizeGray, rgbaStats } from "./image.js";

export const LOCATE_DEFAULTS = Object.freeze({
  workWidth: 320, // coarse search width in pixels
  minScore: 0.85, // full-resolution match needed to accept the anchor
  minTemplate: 8, // skip scales where the shrunken anchor is smaller than this
  candidates: 3, // coarse spots to check at full resolution
  scaleRange: [0.6, 1.6], // wide sweep, relative to the calibration frame
  scaleStep: 1.06,
  lockRadius: 4, // how far a known window may shift before we search again
  panelMinBrightness: 170, // listing panel checks
  panelMaxChroma: 60,
});

/** Geometric list of scales from lo to hi, always including 1 if it is in range. */
export function scaleSweep(lo, hi, step) {
  const out = [];
  for (let s = 1; s >= lo; s /= step) out.unshift(s);
  for (let s = step; s <= hi; s *= step) out.push(s);
  return out;
}

/** Coarse-then-fine search for the anchor over the given scales. Returns the best hit (maybe weak). */
export function findAnchor(frame, anchor, scales, options = {}) {
  const o = { ...LOCATE_DEFAULTS, ...options };
  const f = Math.min(1, o.workWidth / frame.width);
  const ww = Math.max(1, Math.round(frame.width * f));
  const wh = Math.max(1, Math.round(frame.height * f));
  const work = f < 1 ? resizeGray(frame.gray, frame.width, frame.height, ww, wh) : frame.gray;
  const integrals = integralImages(work, ww, wh);

  const coarse = [];
  for (const s of scales) {
    const tw = Math.round(anchor.width * s * f);
    const th = Math.round(anchor.height * s * f);
    if (tw < o.minTemplate || th < o.minTemplate || tw > ww || th > wh) continue;
    const tpl = resizeGray(anchor.gray, anchor.width, anchor.height, tw, th);
    // Every other position first, then a closer look around its best few peaks.
    const quick = matchTemplate(work, ww, wh, tpl, tw, th, { integrals, step: 2, keep: 5, spread: 1 });
    for (const p of quick.peaks ?? []) {
      const r = matchTemplate(work, ww, wh, tpl, tw, th, { integrals, area: { x0: p.x - 1, y0: p.y - 1, x1: p.x + 1, y1: p.y + 1 } });
      if (r.x >= 0) coarse.push({ scale: s, x: r.x / f, y: r.y / f, score: r.score });
    }
  }
  coarse.sort((a, b) => b.score - a.score);

  const radius = Math.ceil(1 / f) + 2;
  let best = { x: -1, y: -1, scale: 1, width: 0, height: 0, score: 0 };
  for (const c of coarse.slice(0, o.candidates)) {
    const hit = refineAnchor(frame, anchor, c.scale, c.x, c.y, radius, [0.98, 1, 1.02]);
    if (hit.score > best.score) best = hit;
  }
  if (best.score <= 0) return best;
  // Polish the scale: the panel can sit far from the anchor, so a 1% scale error
  // can shift it by several pixels.
  const polished = refineAnchor(frame, anchor, best.scale, best.x, best.y, 2, POLISH_STEPS);
  return polished.score >= best.score ? polished : best;
}

const POLISH_STEPS = Array.from({ length: 13 }, (_, i) => 0.97 + i * 0.005);

/** Full-resolution search near (x, y) at `scale` times each of scaleSteps. */
export function refineAnchor(frame, anchor, scale, x, y, radius, scaleSteps = [1]) {
  let best = { x: -1, y: -1, scale, width: 0, height: 0, score: 0 };
  const tried = new Set();
  for (const k of scaleSteps) {
    const s = scale * k;
    const tw = Math.round(anchor.width * s);
    const th = Math.round(anchor.height * s);
    if (tw < 1 || th < 1 || tw > frame.width || th > frame.height || tried.has(tw * 100000 + th)) continue;
    tried.add(tw * 100000 + th);
    const same = tw === anchor.width && th === anchor.height;
    const tpl = same ? anchor.gray : resizeGray(anchor.gray, anchor.width, anchor.height, tw, th);
    const area = { x0: Math.round(x) - radius, y0: Math.round(y) - radius, x1: Math.round(x) + radius, y1: Math.round(y) + radius };
    const r = matchTemplate(frame.gray, frame.width, frame.height, tpl, tw, th, { area });
    // Many nearby scales round to the same template size, so report the scale
    // that size actually implies rather than the one we asked for.
    const implied = (tw + th) / (anchor.width + anchor.height);
    if (r.score > best.score) best = { x: r.x, y: r.y, scale: implied, width: tw, height: th, score: r.score };
  }
  return best;
}

/** Where the listing panel is, given where the anchor was found. Clamped to the frame. */
export function panelRect(hit, calibration, frameWidth, frameHeight) {
  const p = calibration.panel;
  const x = Math.round(hit.x + p.dx * hit.scale);
  const y = Math.round(hit.y + p.dy * hit.scale);
  const right = Math.min(frameWidth, Math.round(hit.x + (p.dx + p.width) * hit.scale));
  const bottom = Math.min(frameHeight, Math.round(hit.y + (p.dy + p.height) * hit.scale));
  const cx = Math.max(0, x);
  const cy = Math.max(0, y);
  return { x: cx, y: cy, width: Math.max(0, right - cx), height: Math.max(0, bottom - cy) };
}

/**
 * Line up a roughly placed panel rectangle with the real listing rows.
 *
 * Vertically, rows are separated by thin lines darker than the rows around them, so we
 * fit a grid of `rows` equal bands (top and row height) whose inner boundaries land on
 * those lines. Horizontally, each side moves to the nearest clear edge where the pale
 * inside is brighter than the column just outside. Anything without clear evidence
 * (contrast under minContrast gray levels) stays where it was.
 */
export function snapPanel(gray, width, height, rect, { rows = 6, radius = 6, minContrast = 15 } = {}) {
  const midY0 = rect.y + Math.round(rect.height * 0.1);
  const midY1 = rect.y + Math.round(rect.height * 0.9);
  const colMean = (x) => {
    if (x < 0 || x >= width) return null;
    let s = 0;
    for (let y = midY0; y < midY1; y++) s += gray[y * width + x];
    return s / Math.max(1, midY1 - midY0);
  };
  // edge = first pixel inside on that side; dir = +1 if inside is at larger coordinates
  const snapX = (edge, dir) => {
    for (let d = 0; d <= radius; d++) {
      let found = null;
      for (const c of d === 0 ? [edge] : [edge - d, edge + d]) {
        const inside = colMean(c);
        const outside = colMean(c - dir);
        if (inside === null || outside === null) continue;
        const contrast = inside - outside;
        if (contrast >= minContrast && (!found || contrast > found.contrast)) found = { c, contrast };
      }
      if (found) return found.c;
    }
    return edge;
  };
  const left = snapX(rect.x, 1);
  const right = snapX(rect.x + rect.width - 1, -1) + 1;
  const x = right - left >= rect.width / 2 ? left : rect.x;
  const w = right - left >= rect.width / 2 ? right - left : rect.width;

  const grid = fitRowGrid(gray, width, height, { x, y: rect.y, width: w, height: rect.height }, rows, radius, minContrast);
  return grid ? { x, y: grid.top, width: w, height: Math.round(grid.pitch * rows) } : { x, y: rect.y, width: w, height: rect.height };
}

/** Best { top, pitch } for `rows` bands whose inner boundaries sit on separator lines, or null. */
export function fitRowGrid(gray, width, height, rect, rows, radius = 6, minContrast = 15) {
  if (rows < 2) return null;
  const x0 = rect.x + Math.round(rect.width * 0.1);
  const x1 = rect.x + Math.round(rect.width * 0.9);
  const y0 = Math.max(0, rect.y - radius - 4);
  const y1 = Math.min(height, rect.y + rect.height + radius + 4);
  const profile = new Float64Array(y1 - y0);
  for (let y = y0; y < y1; y++) {
    let s = 0;
    for (let x = x0; x < x1; x++) s += gray[y * width + x];
    profile[y - y0] = s / Math.max(1, x1 - x0);
  }
  const at = (y) => (y - y0 >= 0 && y - y0 < profile.length ? profile[y - y0] : null);
  // How clearly y starts a thin (1-2 px) dark line: darker than the rows right above and
  // right below it. Text is thicker, so its edges don't score.
  const lineContrast = (y) => {
    const v = at(y);
    const v2 = at(y + 1);
    const above = at(y - 1);
    const below1 = at(y + 1);
    const below2 = at(y + 2);
    if (v === null || above === null || below1 === null || below2 === null) return -Infinity;
    const one = Math.min(above, below1) - v;
    const two = Math.min(above, below2) - Math.max(v, v2);
    return Math.max(one, two);
  };

  const p0 = rect.height / rows;
  let best = null;
  for (let pitch = p0 * 0.92; pitch <= p0 * 1.08; pitch += 0.1) {
    for (let top = rect.y - radius; top <= rect.y + radius; top++) {
      let sum = 0;
      for (let k = 1; k < rows; k++) sum += lineContrast(Math.round(top + k * pitch));
      const mean = sum / (rows - 1);
      const drift = Math.abs(top - rect.y) + Math.abs(pitch - p0); // prefer small moves on ties
      if (!best || mean > best.mean + 1e-9 || (Math.abs(mean - best.mean) <= 1e-9 && drift < best.drift)) best = { top, pitch, mean, drift };
    }
  }
  return best && best.mean >= minContrast ? { top: best.top, pitch: best.pitch } : null;
}

/**
 * Split the listing panel into equal row bands and sort each into listing, sold or empty.
 *
 * The test is how dark the darkest text is compared with the row's own background
 * (textContrast = background - 1st-percentile gray of the text area). Measured on a real
 * shop window: normal rows have black text (about 200 levels below the background), sold
 * rows have gray text on a lighter row (about 50), empty rows have none (about 0). This
 * holds up when the window is scaled and blurred, unlike counting dark pixels.
 *   isRow  text and an icon are present
 *   sold   the text is the faded gray kind (the listing can no longer be bought)
 */
export function splitRows(gray, width, panel, rows = 6, { iconInk = 0.03, minText = 25, soldBelow = 120 } = {}) {
  const bands = [];
  const bandH = panel.height / rows;
  // Stay a little inside the panel and each band, so borders and the separator
  // lines between rows never count as ink.
  const insetX = Math.max(1, Math.round(panel.width * 0.02));
  const insetY = Math.max(1, Math.round(bandH * 0.06));
  const left = panel.x + insetX;
  const inner = Math.max(2, panel.width - 2 * insetX);
  for (let i = 0; i < rows; i++) {
    const top = Math.round(panel.y + i * bandH);
    const bottom = Math.round(panel.y + (i + 1) * bandH);
    const band = { x: panel.x, y: top, width: panel.width, height: Math.max(1, bottom - top) };
    const y = top + insetY;
    const h = Math.max(1, bottom - top - 2 * insetY);
    const bg = grayMedian(gray, width, { x: left, y, width: inner, height: h });
    const iconW = Math.max(1, Math.min(Math.round(bandH) - insetX, Math.round(inner * 0.3)));
    const icon = { x: left, y, width: iconW, height: h };
    const text = { x: left + iconW + 2, y, width: Math.max(1, inner - iconW - 2), height: h };
    const iconShare = share(gray, width, icon, (v) => Math.abs(v - bg) > 40);
    const textContrast = bg - grayPercentile(gray, width, text, 0.01);
    const hasIcon = iconShare >= iconInk;
    const hasText = textContrast >= minText;
    const isRow = hasIcon && hasText;
    bands.push({ index: i, ...band, background: bg, iconInk: iconShare, textContrast, hasIcon, hasText, isRow, sold: isRow && textContrast < soldBelow });
  }
  return bands;
}

function grayPercentile(gray, width, rect, p) {
  const hist = new Uint32Array(256);
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) hist[gray[y * width + x]]++;
  }
  const target = Math.max(1, Math.ceil(rect.width * rect.height * p));
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= target) return v;
  }
  return 255;
}

/**
 * Look for any calibrated shop window in one frame.
 * frame: { rgba, width, height } (gray is computed if missing).
 * lock:  the previous result's lock, to re-check the last known spot first (fast path).
 * scaleHints: Map of calibration name -> scale it was last found at; searched near first.
 * broad: also try the full scale sweep if nothing is found near the expected scales.
 *        It is the slow part, so callers may skip it most of the time.
 * Returns { status, searched, ... , lock } where status is
 *   "found"         window and panel confirmed; panel and rows are set
 *   "rejected"      anchor matched but the panel didn't look right (reason says why)
 *   "not-found"     no anchor match good enough
 *   "uncalibrated"  no calibrations to look for
 */
export function locateShop(frame, calibrations, { lock = null, scaleHints = new Map(), broad = true, ...options } = {}) {
  const o = { ...LOCATE_DEFAULTS, ...options };
  if (!calibrations.length) return { status: "uncalibrated", lock: null };
  const gray = frame.gray ?? toGray(frame.rgba, frame.width, frame.height);
  const img = { gray, width: frame.width, height: frame.height };

  let found = null;
  let bestScore = 0;
  let searched = "lock";
  const consider = (calibration, hit) => {
    bestScore = Math.max(bestScore, hit.score);
    if (hit.score >= o.minScore && (!found || hit.score > found.hit.score)) found = { calibration, hit };
  };

  // 1. Same place as last time?
  if (lock && calibrations.includes(lock.calibration)) {
    consider(lock.calibration, refineAnchor(img, lock.calibration.anchor, lock.hit.scale, lock.hit.x, lock.hit.y, o.lockRadius));
  }
  // 2. Near the scale it was last seen at, and the scale the frame size suggests.
  if (!found) {
    searched = "near";
    for (const c of calibrations) {
      const centers = [scaleHints.get(c.name), frame.width / c.frameWidth].filter(Number.isFinite);
      const scales = [];
      for (const s of centers) for (const k of [1 / 1.08, 1 / 1.04, 1, 1.04, 1.08]) if (!scales.some((t) => Math.abs(t / (s * k) - 1) < 0.02)) scales.push(s * k);
      consider(c, findAnchor(img, c.anchor, scales, o));
    }
  }
  // 3. Every scale in range (slow).
  if (!found && broad) {
    searched = "broad";
    const [lo, hi] = o.scaleRange;
    for (const c of calibrations) {
      const expected = frame.width / c.frameWidth;
      consider(c, findAnchor(img, c.anchor, scaleSweep(lo * expected, hi * expected, o.scaleStep), o));
    }
  }
  if (!found) return { status: "not-found", searched, bestScore, lock: null };

  const { calibration, hit } = found;
  const anchorRect = { x: hit.x, y: hit.y, width: hit.width, height: hit.height };
  const predicted = panelRect(hit, calibration, frame.width, frame.height);
  const panel = predicted.width > 8 && predicted.height > 8 ? snapPanel(gray, frame.width, frame.height, predicted) : predicted;
  const base = { name: calibration.name, searched, score: hit.score, scale: hit.scale, anchor: anchorRect, panel };
  if (panel.width < 8 || panel.height < calibration.rows * 4) {
    return { status: "rejected", reason: "the listing panel would be off screen", ...base, lock: null };
  }
  if (frame.rgba) {
    const stats = rgbaStats(frame.rgba, frame.width, panel);
    base.stats = stats;
    if (stats.medianBrightness < o.panelMinBrightness || stats.medianChroma > o.panelMaxChroma) {
      return { status: "rejected", reason: "the listing area isn't the pale panel", ...base, lock: null };
    }
  }
  const rows = splitRows(gray, frame.width, panel, calibration.rows);
  return { status: "found", ...base, rows, lock: { calibration, hit } };
}

function share(gray, width, rect, test) {
  let n = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) if (test(gray[y * width + x])) n++;
  }
  return n / (rect.width * rect.height);
}
