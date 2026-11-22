// The "Frame source" card: start a screen share or load screenshots, see the preview,
// and watch when the change detector decides a frame is worth reading.

import { canvasToPng } from "../capture/pipeline.js";
import { createReplaySource, filesFromDrop } from "../capture/replaySource.js";
import { SCREEN_METHODS, canShareScreen, startScreenShare } from "../capture/screenSource.js";
import { fitWidth } from "../capture/pixels.js";

const PREVIEW_MAX_WIDTH = 1440;
const LOG_SIZE = 6;
const REASONS = { settled: "changed and settled", timeout: "kept changing, read anyway", forced: "read on request" };

/**
 * Returns { addOverlay(fn), redraw() }. Overlays are drawn on the preview after each
 * frame as fn(ctx, scale), where scale maps frame pixels to preview pixels.
 * onStop() runs whenever the source stops or changes.
 */
export function mountFramePanel(root, { pipeline, debug = false, onStop }) {
  root.innerHTML = `
    <div class="card-head">
      <h2>Frame source</h2>
      <span class="pill" data-el="pill">Off</span>
    </div>
    <div class="actions">
      <button class="primary" data-act="share">Share game window</button>
      <label class="button">Load screenshots<input type="file" accept="image/*" multiple hidden data-el="files" /></label>
      <button data-act="stop" hidden>Stop</button>
    </div>
    <p class="error" role="alert" data-el="error" hidden></p>
    <div class="replay" data-el="replay" hidden>
      <button data-act="prev" aria-label="Previous screenshot">◀</button>
      <button data-act="play" data-el="play">Play</button>
      <button data-act="next" aria-label="Next screenshot">▶</button>
      <span class="position" data-el="position"></span>
    </div>
    <div class="stage" data-el="stage">
      <canvas class="preview" data-el="preview" hidden></canvas>
      <p class="empty" data-el="empty">Share a window, or drop screenshots (or a folder of them) here.</p>
    </div>
    <div class="actions">
      <button data-act="read" disabled>Read now</button>
      <button data-act="save" disabled>Save frame as PNG</button>
    </div>
    <dl class="stats">
      <div><dt>Source</dt><dd data-el="source">—</dd></div>
      <div><dt>Capture method</dt><dd data-el="method">—</dd></div>
      <div><dt>Frame size</dt><dd data-el="size">—</dd></div>
      <div><dt>Frames per second</dt><dd data-el="fps">—</dd></div>
      <div><dt>Reads</dt><dd data-el="reads">0</dd></div>
      <div><dt>Picture</dt><dd data-el="state">—</dd></div>
    </dl>
    <p class="note warn" data-el="hidden-warning" hidden>
      This page is hidden, and this browser may pause capture while it is.
      Keep the page visible (for example on another monitor), or use Chrome or Edge.
    </p>
    <h3>Recent reads</h3>
    <ol class="read-log" data-el="log"><li class="muted">None yet.</li></ol>
    ${debug ? `
    <div class="debug">
      <h3>Debug: change detector</h3>
      <canvas class="thumb" data-el="thumb"></canvas>
      <p class="mono" data-el="debug-text"></p>
    </div>` : ""}
    <p class="note">
      Frames stay in this browser: nothing is uploaded, and nothing is saved unless you press Save frame.
      Reading shop windows comes in the next phases; for now a "read" is logged below.
    </p>
  `;

  const el = (name) => root.querySelector(`[data-el="${name}"]`);
  const act = (name) => root.querySelector(`[data-act="${name}"]`);
  const preview = el("preview");
  const previewCtx = preview.getContext("2d", { alpha: false });
  const thumb = debug ? el("thumb") : null;

  let mode = "off"; // "off" | "screen" | "replay"
  let share = null;
  let methodLabel = "—";
  let logItems = [];
  const overlays = new Set();

  const replay = createReplaySource({
    onImage: (bitmap, meta) => pipeline.submit(bitmap, meta),
    onChange: (s) => {
      el("position").textContent = s.count ? `${s.index + 1} / ${s.count} · ${s.name}` : "";
      el("play").textContent = s.playing ? "Pause" : "Play";
    },
    onError: (error, file) => showError(`Couldn't open ${file.name}: ${error.message}`),
  });

  // ---- sources ----

  async function startShare() {
    showError("");
    try {
      const started = await startScreenShare({
        onImage: (image, meta) => pipeline.submit(image, meta),
        onEnded: () => stopAll(),
      });
      stopAll();
      share = started;
      mode = "screen";
      methodLabel = SCREEN_METHODS[started.method];
      refreshControls();
    } catch (error) {
      // The user closing the picker is not an error worth shouting about.
      if (error.name !== "NotAllowedError" && error.name !== "AbortError") showError(error.message);
    }
  }

  async function loadFiles(files) {
    showError("");
    const list = [...files];
    if (!list.length) return;
    stopAll();
    mode = "replay";
    methodLabel = "Still images";
    refreshControls();
    const count = await replay.load(list);
    if (!count) {
      showError("No images found. Load PNG, JPEG or WebP screenshots.");
      stopAll();
    }
  }

  function stopAll() {
    share?.stop();
    share = null;
    replay.stop();
    pipeline.reset();
    mode = "off";
    methodLabel = "—";
    preview.hidden = true;
    el("empty").hidden = false;
    refreshControls();
    refreshStats(null);
    onStop?.();
  }

  // ---- rendering ----

  function refreshControls() {
    const on = mode !== "off";
    act("stop").hidden = !on;
    act("read").disabled = !on;
    act("save").disabled = !on;
    act("share").disabled = !canShareScreen();
    el("replay").hidden = mode !== "replay";
    el("pill").textContent = { off: "Off", screen: "Live", replay: "Replay" }[mode];
    el("pill").dataset.mode = mode;
    el("method").textContent = methodLabel;
    refreshHiddenWarning();
  }

  function refreshHiddenWarning() {
    el("hidden-warning").hidden = !(mode === "screen" && document.hidden && share?.method !== "track-processor");
  }

  function refreshStats(frame) {
    const { reads, fps } = pipeline.stats;
    el("source").textContent = frame ? (frame.source === "screen" ? share?.label || "Shared window" : "Saved screenshots") : "—";
    el("size").textContent = frame ? `${frame.width} × ${frame.height}` : "—";
    el("fps").textContent = frame && mode === "screen" ? fps.toFixed(1) : "—";
    el("reads").textContent = String(reads);
    el("state").textContent = frame ? (frame.change.state === "stable" ? "Holding still" : "Changing") : "—";
  }

  function drawPreview(frame) {
    const size = fitWidth(frame.width, frame.height, PREVIEW_MAX_WIDTH);
    if (preview.width !== size.width || preview.height !== size.height) {
      preview.width = size.width;
      preview.height = size.height;
    }
    previewCtx.drawImage(frame.canvas, 0, 0, size.width, size.height);
    for (const fn of overlays) fn(previewCtx, size.width / frame.width);
    preview.hidden = false;
    el("empty").hidden = true;
  }

  function drawDebug(frame) {
    const { gray, width, height, region } = frame.thumb;
    if (thumb.width !== width || thumb.height !== height) {
      thumb.width = width;
      thumb.height = height;
    }
    const img = new ImageData(width, height);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
      img.data[j] = img.data[j + 1] = img.data[j + 2] = gray[i];
      img.data[j + 3] = 255;
    }
    thumb.getContext("2d").putImageData(img, 0, 0);
    const c = frame.change;
    el("debug-text").textContent =
      `frame ${frame.seq}${frame.repeat ? " (re-check)" : ""} · motion ${pct(c.motion)} · changed since read ${pct(c.changed)}` +
      ` · state ${c.state} · watching ${region.width}×${region.height} at ${region.x},${region.y}`;
  }

  function logRead(frame) {
    const time = new Date().toLocaleTimeString();
    const what = frame.source === "replay" ? ` · ${frame.label}` : "";
    logItems = [`${time} · ${REASONS[frame.change.reason]} · ${pct(frame.change.changed)} changed${what}`, ...logItems].slice(0, LOG_SIZE);
    el("log").innerHTML = logItems.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  }

  pipeline.onFrame((frame) => {
    if (!frame.repeat) drawPreview(frame);
    if (thumb) drawDebug(frame);
    refreshStats(frame);
  });
  pipeline.onRead(logRead);

  // ---- actions ----

  async function saveFrame() {
    const frame = pipeline.last;
    if (!frame) return;
    const blob = await canvasToPng(frame.canvas);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `frame-${stamp(new Date())}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  function showError(message) {
    el("error").textContent = message;
    el("error").hidden = !message;
  }

  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button) return;
    const handlers = {
      share: startShare,
      stop: stopAll,
      prev: () => replay.prev(),
      next: () => replay.next(),
      play: () => (replay.state.playing ? replay.pause() : replay.play()),
      read: () => pipeline.forceRead(),
      save: saveFrame,
    };
    handlers[button.dataset.act]?.();
  });

  el("files").addEventListener("change", (event) => {
    loadFiles(event.target.files);
    event.target.value = ""; // so loading the same files again still fires "change"
  });

  const stage = el("stage");
  stage.addEventListener("dragover", (event) => {
    event.preventDefault();
    stage.classList.add("dragging");
  });
  stage.addEventListener("dragleave", () => stage.classList.remove("dragging"));
  stage.addEventListener("drop", async (event) => {
    event.preventDefault();
    stage.classList.remove("dragging");
    loadFiles(await filesFromDrop(event.dataTransfer));
  });

  // Arrow keys step through screenshots, space plays and pauses (not while typing).
  document.addEventListener("keydown", (event) => {
    if (mode !== "replay" || event.target.closest?.("input, textarea, select")) return;
    if (event.key === "ArrowLeft") replay.prev();
    else if (event.key === "ArrowRight") replay.next();
    else if (event.key === " " && !event.target.closest?.("button")) {
      // (on a focused button, space already clicks it)
      event.preventDefault();
      replay.state.playing ? replay.pause() : replay.play();
    }
  });

  document.addEventListener("visibilitychange", refreshHiddenWarning);

  if (!canShareScreen()) showError("This browser can't share a window. You can still load screenshots.");
  refreshControls();

  return {
    addOverlay(fn) {
      overlays.add(fn);
      return () => overlays.delete(fn);
    },
    /** Redraw the preview and overlays from the latest frame (the frame canvas still holds it). */
    redraw() {
      if (pipeline.last && mode !== "off") drawPreview(pipeline.last);
    },
  };
}

function pct(fraction) {
  return `${(fraction * 100).toFixed(1)}%`;
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
