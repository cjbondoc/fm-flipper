// A calibration teaches the app what one kind of shop window looks like, using your
// own screenshot: you box an "anchor" (something on the window that never changes, like
// its buttons) and the listing panel. Nothing here comes from other tools.
//
// Shape in memory:
//   { version, name, frameWidth, frameHeight, rows,
//     anchor: { gray: Uint8Array, width, height },
//     panel:  { dx, dy, width, height },   // relative to the anchor's top-left, in frame pixels
//     createdAt }

import { cropGray, grayStdDev } from "./image.js";
import { snapPanel } from "./locate.js";

export const CALIBRATION_VERSION = 1;
const STORAGE_KEY = "fm-flipper.calibrations.v1";
const MIN_ANCHOR = { width: 24, height: 12 };
const MIN_ANCHOR_DETAIL = 12; // std-dev of gray values; flat boxes can't be found reliably

/**
 * Build a calibration from a frame and two rectangles in frame pixels.
 * Returns { calibration, problems }; calibration is null when problems is not empty.
 */
export function makeCalibration({ name, frame, anchorRect, panelRect, rows = 6, createdAt = new Date().toISOString() }) {
  const problems = [];
  const a = normalizeRect(anchorRect, frame.width, frame.height);
  const drawn = normalizeRect(panelRect, frame.width, frame.height);
  // Hand-drawn boxes are a few pixels off; snap the panel to its real edges.
  const p = drawn && drawn.width > 8 && drawn.height > 8 ? snapPanel(frame.gray, frame.width, frame.height, drawn) : drawn;
  if (!a || a.width < MIN_ANCHOR.width || a.height < MIN_ANCHOR.height) {
    problems.push(`Draw a bigger anchor box (at least ${MIN_ANCHOR.width} × ${MIN_ANCHOR.height} pixels of the frame).`);
  }
  if (!p || p.height < rows * 8 || p.width < 40) {
    problems.push("Draw a box around all six listing rows.");
  }
  if (a && p && overlaps(a, p)) problems.push("The anchor shouldn't overlap the listing panel; listings change, the anchor must not.");
  if (problems.length) return { calibration: null, problems };

  const gray = cropGray(frame.gray, frame.width, a);
  if (grayStdDev(gray) < MIN_ANCHOR_DETAIL) {
    return { calibration: null, problems: ["The anchor box is too plain to find again. Pick something with text or edges, like the window's buttons."] };
  }
  return {
    calibration: {
      version: CALIBRATION_VERSION,
      name: String(name || "Shop window").trim().slice(0, 40) || "Shop window",
      frameWidth: frame.width,
      frameHeight: frame.height,
      rows,
      anchor: { gray, width: a.width, height: a.height },
      panel: { dx: p.x - a.x, dy: p.y - a.y, width: p.width, height: p.height },
      createdAt,
    },
    problems: [],
  };
}

/** JSON text for export or storage. Anchor pixels are base64. */
export function serializeCalibrations(list) {
  return JSON.stringify(
    {
      app: "fm-flipper",
      kind: "calibrations",
      version: CALIBRATION_VERSION,
      calibrations: list.map((c) => ({ ...c, anchor: { width: c.anchor.width, height: c.anchor.height, gray: toBase64(c.anchor.gray) } })),
    },
    null,
    1,
  );
}

/** Parse exported JSON. Throws with a readable message if the file isn't one of ours. */
export function parseCalibrations(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (data?.app !== "fm-flipper" || data.kind !== "calibrations" || !Array.isArray(data.calibrations)) {
    throw new Error("That file isn't an FM Flipper calibration export.");
  }
  if (data.version !== CALIBRATION_VERSION) throw new Error(`Unsupported calibration version ${data.version}.`);
  return data.calibrations.map((c, i) => {
    const gray = fromBase64(c.anchor?.gray ?? "");
    const ok =
      Number.isInteger(c.anchor?.width) && Number.isInteger(c.anchor?.height) && gray.length === c.anchor.width * c.anchor.height &&
      [c.panel?.dx, c.panel?.dy, c.panel?.width, c.panel?.height, c.frameWidth, c.frameHeight, c.rows].every(Number.isFinite);
    if (!ok) throw new Error(`Calibration ${i + 1} in that file is damaged.`);
    return { ...c, anchor: { width: c.anchor.width, height: c.anchor.height, gray } };
  });
}

/** Add or replace (by name) calibrations. */
export function mergeCalibrations(existing, incoming) {
  const byName = new Map(existing.map((c) => [c.name, c]));
  for (const c of incoming) byName.set(c.name, c);
  return [...byName.values()];
}

/** Saved calibrations from this browser, or [] if none or storage is unavailable. */
export function loadSavedCalibrations() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? parseCalibrations(text) : [];
  } catch {
    return [];
  }
}

/** Save to this browser. Returns false if storage is unavailable (private mode, blocked). */
export function saveCalibrations(list) {
  try {
    localStorage.setItem(STORAGE_KEY, serializeCalibrations(list));
    return true;
  } catch {
    return false;
  }
}

/** Positive-size integer rectangle inside the frame, or null. Accepts boxes drawn in any direction. */
export function normalizeRect(r, frameWidth, frameHeight) {
  if (!r) return null;
  const x0 = Math.max(0, Math.round(Math.min(r.x, r.x + r.width)));
  const y0 = Math.max(0, Math.round(Math.min(r.y, r.y + r.height)));
  const x1 = Math.min(frameWidth, Math.round(Math.max(r.x, r.x + r.width)));
  const y1 = Math.min(frameHeight, Math.round(Math.max(r.y, r.y + r.height)));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text) {
  try {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}
