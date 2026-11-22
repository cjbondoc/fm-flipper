import { describe, expect, it } from "vitest";
import { makeCalibration } from "./calibration.js";
import { locateShop, scaleSweep, snapPanel } from "./locate.js";
import { ANCHOR, PANEL, grayToRgba, scene } from "./scene.testutil.js";

// Calibrate once from a scene with the window at (300, 150), scale 1, like a user would.
const ref = scene();
const { calibration } = makeCalibration({
  name: "Test store",
  frame: ref,
  anchorRect: { x: 300 + ANCHOR.x, y: 150 + ANCHOR.y, width: ANCHOR.width, height: ANCHOR.height },
  panelRect: { x: 300 + PANEL.x, y: 150 + PANEL.y, width: PANEL.width, height: PANEL.height },
});

describe("scaleSweep", () => {
  it("includes 1 and stays in range", () => {
    const s = scaleSweep(0.6, 1.6, 1.06);
    expect(s).toContain(1);
    expect(Math.min(...s)).toBeGreaterThanOrEqual(0.6);
    expect(Math.max(...s)).toBeLessThanOrEqual(1.6);
  });
});

describe("locateShop", () => {
  it("finds the window where it moved to, on a different background", () => {
    const r = locateShop(scene({ x: 120, y: 60, seed: 99 }), [calibration]);
    expect(r.status).toBe("found");
    expect(r.anchor.x).toBe(120 + ANCHOR.x);
    expect(r.anchor.y).toBe(60 + ANCHOR.y);
    expect(r.panel).toEqual({ x: 120 + PANEL.x, y: 60 + PANEL.y, width: PANEL.width, height: PANEL.height });
    expect(r.score).toBeGreaterThan(0.95);
  });

  it("tells listings, sold listings and empty rows apart", () => {
    const r = locateShop(scene({ rows: ["full", "sold", "full", "empty", "full", "empty"] }), [calibration]);
    expect(r.rows.map((b) => b.isRow)).toEqual([true, true, true, false, true, false]);
    expect(r.rows.map((b) => b.sold)).toEqual([false, true, false, false, false, false]);
  });

  it("finds the window at a smaller UI scale", () => {
    const r = locateShop(scene({ x: 200, y: 100, scale: 0.8, seed: 5 }), [calibration]);
    expect(r.status).toBe("found");
    expect(r.scale).toBeCloseTo(0.8, 1);
    expect(Math.abs(r.anchor.x - (200 + ANCHOR.x * 0.8))).toBeLessThanOrEqual(2);
    // Snapping puts the panel on its real edges (within the 1 px the drawing rounds by).
    expect(Math.abs(r.panel.x - (200 + PANEL.x * 0.8))).toBeLessThanOrEqual(1);
    expect(Math.abs(r.panel.y - (100 + PANEL.y * 0.8))).toBeLessThanOrEqual(1);
    expect(Math.abs(r.panel.height - PANEL.height * 0.8)).toBeLessThanOrEqual(1);
    expect(r.rows.filter((b) => b.isRow)).toHaveLength(4);
  });

  it("finds the window at a larger UI scale", () => {
    const r = locateShop(scene({ x: 100, y: 40, scale: 1.25, width: 1100, height: 700 }), [calibration]);
    expect(r.status).toBe("found");
    expect(r.scale).toBeCloseTo(1.25, 1);
  });

  it("skips the slow full sweep when asked, unless a hint points at the right scale", () => {
    // The frame size suggests scale 1.1; the window is really at 1.45, out of the near search's reach.
    const frame = scene({ x: 100, y: 40, scale: 1.45, width: 1100, height: 700 });
    const quick = locateShop(frame, [calibration], { broad: false });
    expect(quick).toMatchObject({ status: "not-found", searched: "near" });
    expect(locateShop(frame, [calibration])).toMatchObject({ status: "found", searched: "broad" });
    const hinted = locateShop(frame, [calibration], { broad: false, scaleHints: new Map([["Test store", 1.45]]) });
    expect(hinted).toMatchObject({ status: "found", searched: "near" });
  });

  it("reports not-found when no window is open", () => {
    const r = locateShop(scene({ window: false, seed: 11 }), [calibration]);
    expect(r.status).toBe("not-found");
    expect(r.bestScore).toBeLessThan(0.85);
  });

  it("re-checks the last spot first", () => {
    const frame = scene({ x: 50, y: 50 });
    const first = locateShop(frame, [calibration]);
    const again = locateShop(frame, [calibration], { lock: first.lock });
    expect(again.status).toBe("found");
    expect(again.anchor).toEqual(first.anchor);
  });

  it("rejects a match whose listing area isn't the pale panel", () => {
    const frame = scene();
    const rgba = grayToRgba(frame.gray);
    // Tint the panel area strongly blue.
    for (let y = 150 + PANEL.y; y < 150 + PANEL.y + PANEL.height; y++) {
      for (let x = 300 + PANEL.x; x < 300 + PANEL.x + PANEL.width; x++) {
        rgba[(y * frame.width + x) * 4] = 20;
        rgba[(y * frame.width + x) * 4 + 2] = 250;
      }
    }
    const r = locateShop({ ...frame, rgba }, [calibration]);
    expect(r.status).toBe("rejected");
    expect(r.lock).toBeNull();
  });

  it("snaps a box that is a few pixels off onto the panel's edges", () => {
    const f = scene();
    const exact = { x: 300 + PANEL.x, y: 150 + PANEL.y, width: PANEL.width, height: PANEL.height };
    const sloppy = { x: exact.x - 4, y: exact.y + 3, width: exact.width + 7, height: exact.height - 5 };
    expect(snapPanel(f.gray, f.width, f.height, sloppy)).toEqual(exact);
  });

  it("says when there is nothing to look for", () => {
    expect(locateShop(ref, []).status).toBe("uncalibrated");
  });
});
