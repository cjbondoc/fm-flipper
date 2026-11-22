// Connects shop-window finding to the frame pipeline.
//
// On every read the pipeline decides is worth it, look for a calibrated shop window.
// While one is open, the pipeline watches only its listing panel for changes, so the
// animated scene around it no longer triggers reads. When the window closes or moves,
// the panel area changes, the next read fails to find it there, and we go back to
// watching the whole frame.

import { locateShop } from "./locate.js";

const BROAD_EVERY_MS = 5000; // the full scale sweep is slow; run it at most this often

export function createShopLocator({ pipeline, getCalibrations, options = {} }) {
  const listeners = new Set();
  const scaleHints = new Map(); // calibration name -> scale it was last found at
  let lock = null;
  let last = { status: "idle" };
  let lastBroadAt = -Infinity;

  function run(frame) {
    const started = performance.now();
    const image = frame.imageData();
    const broad = started - lastBroadAt >= BROAD_EVERY_MS;
    const result = locateShop({ rgba: image.data, width: frame.width, height: frame.height }, getCalibrations(), { lock, scaleHints, broad, ...options });
    if (result.searched === "broad") lastBroadAt = started;
    if (result.status === "found") scaleHints.set(result.name, result.scale);
    lock = result.lock;
    watch(result.status === "found" ? result.panel : null, frame);
    last = { ...result, ms: performance.now() - started, frameSeq: frame.seq, frameWidth: frame.width, frameHeight: frame.height, source: frame.source, label: frame.label };
    for (const fn of listeners) fn(last, frame);
    return last;
  }

  // Watch the panel (or the whole frame). Only tell the pipeline when it actually
  // changes, because a new region restarts change detection.
  function watch(panel, frame) {
    const next = panel ? { x: panel.x / frame.width, y: panel.y / frame.height, width: panel.width / frame.width, height: panel.height / frame.height } : null;
    const now = pipeline.region;
    const same = next === now || (next && now && ["x", "y", "width", "height"].every((k) => Math.abs(next[k] - now[k]) < 1e-6));
    if (!same) pipeline.setRegion(next);
  }

  pipeline.onRead((frame) => run(frame));

  return {
    /** result listener: fn(result, frame). The frame is only valid during the call. */
    onResult(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Forget the current window, e.g. after calibrations change or the source stops. */
    reset() {
      lock = null;
      lastBroadAt = -Infinity;
      if (pipeline.region) pipeline.setRegion(null);
      last = { status: "idle" };
      for (const fn of listeners) fn(last, null);
    },
    /** Look at the current frame again right away (after calibrating, say). */
    recheck() {
      lock = null;
      lastBroadAt = -Infinity;
      pipeline.forceRead();
    },
    get last() {
      return last;
    },
  };
}
