// The "Shop window" card: calibrate from a frame, manage saved calibrations, and show
// whether a shop window is in view (with boxes drawn on the preview).

import { makeCalibration, mergeCalibrations, parseCalibrations, serializeCalibrations } from "../calibrate/calibration.js";
import { locateShop } from "../calibrate/locate.js";
import { toGray } from "../capture/pixels.js";

const COLORS = { anchor: "#f5a524", found: "#2fbf71", rejected: "#e5484d", row: "rgba(47, 191, 113, 0.18)" };

const STEPS = {
  anchor: {
    title: "Step 1 of 2: box the anchor",
    help: "Drag a box around something on the shop window that always looks the same, whatever is for sale. The Seller info, Buy item and Leave store buttons work well. Don't include the shop's title, the listings or any player.",
  },
  panel: {
    title: "Step 2 of 2: box the listings",
    help: "Drag a box around all six listing rows, from the top of the first row to the bottom of the last. Leave out the scroll bar. It snaps to the panel's edges, so a few pixels off is fine.",
  },
};

/**
 * store: { get(): calibrations[], set(list): boolean (false if it couldn't be saved) }
 * framePanel: from mountFramePanel, for preview overlays.
 */
export function mountShopPanel(root, { pipeline, locator, store, framePanel, debug = false }) {
  root.innerHTML = `
    <div class="card-head">
      <h2>Shop window</h2>
      <span class="pill" data-el="pill">Not calibrated</span>
    </div>
    <p class="status-line" data-el="status"></p>
    <ol class="row-chips" data-el="rows" hidden></ol>
    <p class="mono" data-el="debug" ${debug ? "" : "hidden"}></p>
    <div class="actions">
      <button class="primary" data-act="calibrate" disabled>Calibrate from current frame</button>
      <label class="button">Import calibration<input type="file" accept=".json,application/json" hidden data-el="import" /></label>
      <button data-act="export" disabled>Export calibrations</button>
    </div>
    <p class="error" role="alert" data-el="error" hidden></p>
    <p class="ok" role="status" data-el="message" hidden></p>
    <ul class="profiles" data-el="profiles"></ul>

    <div class="editor" data-el="editor" hidden>
      <h3 data-el="step-title"></h3>
      <p class="note" data-el="step-help"></p>
      <canvas class="snapshot" data-el="snapshot"></canvas>
      <label class="name">Name for this kind of window <input data-el="name" value="Player store" maxlength="40" /></label>
      <p class="error" role="alert" data-el="editor-error" hidden></p>
      <div class="actions">
        <button data-act="back">Back</button>
        <button class="primary" data-act="next">Next</button>
        <button data-act="cancel">Cancel</button>
      </div>
    </div>

    <p class="note">
      Calibrating teaches the app what a shop window looks like, from your own screenshot. Open a shop in the game
      (or load a screenshot of one), then press Calibrate. Do it once for each kind of window, such as a player store
      and a hired merchant. Calibrations are kept in this browser; export them to use them on another computer.
    </p>
  `;

  const el = (name) => root.querySelector(`[data-el="${name}"]`);
  const act = (name) => root.querySelector(`[data-act="${name}"]`);

  // ---- status and overlay ----

  function showResult(r) {
    const has = store.get().length > 0;
    let pill = has ? "Looking" : "Not calibrated";
    let text = has
      ? "Waiting for a frame. Share the game window or load screenshots."
      : "Not calibrated yet. Open a shop in the game (or load a screenshot of one), then press Calibrate from current frame.";
    if (r.status === "found") {
      pill = "Found";
      text = `${r.name} found: ${describeRows(r.rows)}. Watching only the listing panel for changes.`;
    } else if (r.status === "not-found") {
      pill = "Not in view";
      text = "No shop window in view.";
    } else if (r.status === "rejected") {
      pill = "Unsure";
      text = `Something like ${r.name} is in view, but ${r.reason}. If a shop is open, try calibrating again.`;
    }
    el("pill").textContent = pill;
    el("pill").dataset.mode = r.status;
    el("status").textContent = text;

    const rows = el("rows");
    rows.hidden = r.status !== "found";
    if (r.status === "found") {
      rows.innerHTML = r.rows
        .map((b) => {
          const kind = !b.isRow ? "empty" : b.sold ? "sold" : "listing";
          return `<li class="${kind === "listing" ? "on" : kind}">${b.index + 1}: ${kind}</li>`;
        })
        .join("");
    }
    if (debug) {
      el("debug").textContent =
        r.status === "idle" || r.status === "uncalibrated"
          ? ""
          : `locate ${r.status} (${r.searched} search) in ${r.ms?.toFixed(0)} ms · match ${(r.score ?? r.bestScore ?? 0).toFixed(3)}` +
            (r.scale ? ` · scale ${r.scale.toFixed(3)}` : "") +
            (r.stats ? ` · panel brightness ${r.stats.medianBrightness}, chroma ${r.stats.medianChroma}` : "") +
            (r.rows ? ` · rows (icon % / text contrast) ${r.rows.map((b) => `${(b.iconInk * 100).toFixed(0)}/${b.textContrast}`).join(" ")}` : "");
    }
  }

  framePanel.addOverlay((ctx, scale) => {
    const r = locator.last;
    const frame = pipeline.last;
    if (!frame || (r.status !== "found" && r.status !== "rejected") || r.frameWidth !== frame.width) return;
    const box = (rect, color, fill) => {
      const x = rect.x * scale;
      const y = rect.y * scale;
      const w = rect.width * scale;
      const h = rect.height * scale;
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, w, h);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, ctx.canvas.width / 600);
      ctx.strokeRect(x, y, w, h);
    };
    box(r.anchor, COLORS.anchor);
    box(r.panel, r.status === "found" ? COLORS.found : COLORS.rejected);
    if (r.rows) for (const b of r.rows) if (b.isRow) box(b, "transparent", COLORS.row);
  });

  locator.onResult((r) => {
    showResult(r);
    framePanel.redraw();
  });

  pipeline.onFrame(() => {
    act("calibrate").disabled = !editorClosed();
  });

  // ---- saved calibrations ----

  function renderProfiles() {
    const list = store.get();
    act("export").disabled = list.length === 0;
    el("profiles").innerHTML = list
      .map(
        (c, i) => `<li>
          <span><strong>${escapeHtml(c.name)}</strong> · from a ${c.frameWidth} × ${c.frameHeight} frame · ${new Date(c.createdAt).toLocaleDateString()}</span>
          <button data-act="delete" data-index="${i}">Delete</button>
        </li>`,
      )
      .join("");
  }

  function update(list, message) {
    const saved = store.set(list);
    renderProfiles();
    showMessage(saved ? message : `${message} This browser won't let the page save it, so it lasts only until you close the page; export it to keep it.`);
    locator.recheck();
    showResult(locator.last);
  }

  // ---- calibration editor ----

  const canvas = el("snapshot");
  const ctx = canvas.getContext("2d");
  let snap = null; // { canvas, gray, rgba, width, height }
  let step = "anchor";
  let boxes = { anchor: null, panel: null };
  let drag = null;

  const editorClosed = () => el("editor").hidden;

  function openEditor() {
    const frame = pipeline.last;
    if (!frame) return;
    const copy = document.createElement("canvas");
    copy.width = frame.width;
    copy.height = frame.height;
    const copyCtx = copy.getContext("2d", { willReadFrequently: true });
    copyCtx.drawImage(frame.canvas, 0, 0);
    const rgba = copyCtx.getImageData(0, 0, frame.width, frame.height).data;
    snap = { canvas: copy, rgba, gray: toGray(rgba, frame.width, frame.height), width: frame.width, height: frame.height };
    canvas.width = frame.width;
    canvas.height = frame.height;
    boxes = { anchor: null, panel: null };
    setStep("anchor");
    showError("");
    showMessage("");
    el("editor").hidden = false;
    act("calibrate").disabled = true;
    el("editor").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeEditor() {
    el("editor").hidden = true;
    snap = null;
    drag = null;
    act("calibrate").disabled = !pipeline.last;
  }

  function setStep(next) {
    step = next;
    el("step-title").textContent = STEPS[step].title;
    el("step-help").textContent = STEPS[step].help;
    act("back").disabled = step === "anchor";
    act("next").textContent = step === "anchor" ? "Next" : "Save";
    showEditorError("");
    render();
  }

  function render() {
    if (!snap) return;
    ctx.drawImage(snap.canvas, 0, 0);
    const lw = Math.max(2, canvas.width / (canvas.clientWidth || canvas.width)) * 1.5;
    const draw = (r, color) => {
      if (!r) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.strokeRect(r.x, r.y, r.width, r.height);
    };
    draw(boxes.anchor, COLORS.anchor);
    draw(boxes.panel, COLORS.found);
    if (drag) draw(drag.rect, step === "anchor" ? COLORS.anchor : COLORS.found);
  }

  function toFrame(event) {
    const r = canvas.getBoundingClientRect();
    return { x: ((event.clientX - r.left) * canvas.width) / r.width, y: ((event.clientY - r.top) * canvas.height) / r.height };
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!snap) return;
    canvas.setPointerCapture(event.pointerId);
    const p = toFrame(event);
    drag = { start: p, rect: { x: p.x, y: p.y, width: 0, height: 0 } };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const p = toFrame(event);
    drag.rect = {
      x: Math.min(drag.start.x, p.x),
      y: Math.min(drag.start.y, p.y),
      width: Math.abs(p.x - drag.start.x),
      height: Math.abs(p.y - drag.start.y),
    };
    render();
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.rect.width >= 3 && drag.rect.height >= 3) {
      boxes[step] = { x: Math.round(drag.rect.x), y: Math.round(drag.rect.y), width: Math.round(drag.rect.width), height: Math.round(drag.rect.height) };
      showEditorError("");
    }
    drag = null;
    render();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  function next() {
    if (step === "anchor") {
      if (!boxes.anchor) return showEditorError("Drag a box around the anchor first.");
      return setStep("panel");
    }
    if (!boxes.panel) return showEditorError("Drag a box around the listing rows first.");
    const { calibration, problems } = makeCalibration({ name: el("name").value, frame: snap, anchorRect: boxes.anchor, panelRect: boxes.panel });
    if (!calibration) return showEditorError(problems.join(" "));
    // Prove it works on this very frame before keeping it.
    const check = locateShop(snap, [calibration]);
    if (check.status !== "found") {
      return showEditorError(
        check.status === "rejected"
          ? `That doesn't look right: ${check.reason}. Check the listing box covers the pale rows.`
          : "The anchor couldn't be found again in this frame. Pick something with more detail.",
      );
    }
    closeEditor();
    update(mergeCalibrations(store.get(), [calibration]), `Saved "${calibration.name}". Checked on this frame: ${describeRows(check.rows)}.`);
  }

  // ---- import, export, delete ----

  function exportAll() {
    const blob = new Blob([serializeCalibrations(store.get())], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "shop-calibrations.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  el("import").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    showError("");
    try {
      const incoming = parseCalibrations(await file.text());
      update(mergeCalibrations(store.get(), incoming), `Imported ${incoming.length} calibration${incoming.length === 1 ? "" : "s"}.`);
    } catch (error) {
      showError(error.message);
    }
  });

  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button) return;
    const handlers = {
      calibrate: openEditor,
      back: () => setStep("anchor"),
      next,
      cancel: closeEditor,
      export: exportAll,
      delete: () => {
        const list = store.get().slice();
        const [gone] = list.splice(Number(button.dataset.index), 1);
        if (gone && confirm(`Delete the calibration "${gone.name}"?`)) update(list, `Deleted "${gone.name}".`);
      },
    };
    handlers[button.dataset.act]?.();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !editorClosed()) closeEditor();
  });

  function showError(message) {
    el("error").textContent = message;
    el("error").hidden = !message;
  }
  function showEditorError(message) {
    el("editor-error").textContent = message;
    el("editor-error").hidden = !message;
  }
  function showMessage(message) {
    el("message").textContent = message;
    el("message").hidden = !message;
  }

  renderProfiles();
  showResult(locator.last);
}

/** "4 listings, 1 sold, 1 empty row" */
function describeRows(rows) {
  const listings = rows.filter((b) => b.isRow && !b.sold).length;
  const sold = rows.filter((b) => b.sold).length;
  const empty = rows.length - listings - sold;
  const parts = [`${listings} listing${listings === 1 ? "" : "s"}`];
  if (sold) parts.push(`${sold} sold`);
  if (empty) parts.push(`${empty} empty row${empty === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
