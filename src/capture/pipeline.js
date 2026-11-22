// Every frame, live or replayed, goes through here.
//
// A source calls submit(image, meta) with anything drawImage accepts (VideoFrame,
// video element, ImageBitmap). The pipeline copies it to one working canvas, makes a
// small gray thumbnail, runs the change detector and tells listeners:
//   onFrame(frame)  every submitted frame (preview, status)
//   onRead(frame)   only when the picture changed and settled: run the full read here
//
// The frame object and its canvas are reused for the next frame, so listeners must
// use them right away (draw it, or call frame.imageData()) and not keep them.

import { createChangeDetector } from "./changeDetector.js";
import { fitWidth, regionToPixels, toGray } from "./pixels.js";

const THUMB_WIDTH = 160; // whole frame: coarse is enough to notice a window opening
const REGION_THUMB_WIDTH = 320; // a watched region (e.g. one shop window): fine enough to see text change
const REPEAT_MS = 250; // re-check the last frame this often while waiting for it to settle

export function createPipeline({
  detector = createChangeDetector(),
  thumbWidth = THUMB_WIDTH,
  regionThumbWidth = REGION_THUMB_WIDTH,
} = {}) {
  const frameCanvas = makeCanvas();
  const frameCtx = frameCanvas.getContext("2d", { alpha: false });
  const thumbCanvas = makeCanvas();
  const thumbCtx = thumbCanvas.getContext("2d", { alpha: false, willReadFrequently: true });

  const frameListeners = new Set();
  const readListeners = new Set();
  let region = null; // fraction of the frame to watch for changes; null = all of it
  let last = null; // latest frame object
  let repeatTimer = 0;
  let seq = 0;
  let reads = 0;
  let fps = 0;
  let lastSubmitAt = 0;

  /** Feed one picture in. meta: { width, height, source, label?, time? } */
  function submit(image, meta) {
    const now = performance.now();
    if (lastSubmitAt) fps = fps * 0.8 + (1000 / Math.max(1, now - lastSubmitAt)) * 0.2;
    lastSubmitAt = now;

    const { width, height } = meta;
    if (frameCanvas.width !== width || frameCanvas.height !== height) {
      frameCanvas.width = width;
      frameCanvas.height = height;
      detector.reset();
    }
    frameCtx.drawImage(image, 0, 0, width, height);
    analyze({ ...meta, time: meta.time ?? now, repeat: false });
  }

  function analyze(meta) {
    clearTimeout(repeatTimer);
    const { width, height } = frameCanvas;
    const watch = regionToPixels(region, width, height);
    const thumb = fitWidth(watch.width, watch.height, region ? regionThumbWidth : thumbWidth);
    if (thumbCanvas.width !== thumb.width || thumbCanvas.height !== thumb.height) {
      thumbCanvas.width = thumb.width;
      thumbCanvas.height = thumb.height;
    }
    thumbCtx.drawImage(frameCanvas, watch.x, watch.y, watch.width, watch.height, 0, 0, thumb.width, thumb.height);
    const gray = toGray(thumbCtx.getImageData(0, 0, thumb.width, thumb.height).data, thumb.width, thumb.height);
    const change = detector.push(gray);

    last = {
      seq: ++seq,
      canvas: frameCanvas,
      width,
      height,
      time: meta.time,
      source: meta.source,
      label: meta.label ?? "",
      repeat: meta.repeat,
      change,
      thumb: { gray, width: thumb.width, height: thumb.height, region: watch },
      imageData: () => frameCtx.getImageData(0, 0, width, height),
    };
    if (change.read) reads++;
    for (const fn of frameListeners) fn(last);
    if (change.read) for (const fn of readListeners) fn(last);

    // A still picture may stop producing frames (a paused replay, a window that
    // only repaints on change). Re-check the last one so it can still settle.
    if (change.state === "moving") {
      const { source, label } = last;
      repeatTimer = setTimeout(() => analyze({ source, label, time: performance.now(), repeat: true }), REPEAT_MS);
    }
  }

  return {
    submit,
    onFrame: (fn) => subscribe(frameListeners, fn),
    onRead: (fn) => subscribe(readListeners, fn),
    /** Read the next frame no matter what changed. Re-checks the current one if there is one. */
    forceRead() {
      detector.force();
      if (last) analyze({ source: last.source, label: last.label, time: performance.now(), repeat: true });
    },
    /** Watch only part of the frame for changes ({x, y, width, height} as 0-1 fractions), or null for all. */
    setRegion(next) {
      region = next;
      detector.reset();
    },
    get region() {
      return region;
    },
    /** Forget the current picture and watched region, e.g. when switching sources. */
    reset() {
      clearTimeout(repeatTimer);
      region = null;
      detector.reset();
      last = null;
      fps = 0;
      lastSubmitAt = 0;
    },
    get stats() {
      return { reads, fps, frames: seq };
    },
    get last() {
      return last;
    },
  };
}

function subscribe(set, fn) {
  set.add(fn);
  return () => set.delete(fn);
}

function makeCanvas() {
  return typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
}

/** PNG blob of a canvas, for OffscreenCanvas or a regular canvas. */
export function canvasToPng(canvas) {
  if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode PNG"))), "image/png"));
}
