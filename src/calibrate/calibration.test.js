import { describe, expect, it } from "vitest";
import { makeCalibration, mergeCalibrations, normalizeRect, parseCalibrations, serializeCalibrations } from "./calibration.js";
import { ANCHOR, PANEL, scene } from "./scene.testutil.js";

const frame = scene();
const anchorRect = { x: 300 + ANCHOR.x, y: 150 + ANCHOR.y, width: ANCHOR.width, height: ANCHOR.height };
const panelRect = { x: 300 + PANEL.x, y: 150 + PANEL.y, width: PANEL.width, height: PANEL.height };

describe("makeCalibration", () => {
  it("stores the anchor pixels and the panel relative to the anchor", () => {
    const { calibration, problems } = makeCalibration({ name: "Store", frame, anchorRect, panelRect });
    expect(problems).toEqual([]);
    expect(calibration.anchor).toMatchObject({ width: 80, height: 60 });
    expect(calibration.anchor.gray).toHaveLength(80 * 60);
    expect(calibration.panel).toEqual({ dx: PANEL.x - ANCHOR.x, dy: PANEL.y - ANCHOR.y, width: 200, height: 240 });
    expect(calibration).toMatchObject({ frameWidth: 1000, frameHeight: 600, rows: 6 });
  });

  it("snaps a hand-drawn panel box onto the panel's edges", () => {
    const sloppy = { x: panelRect.x + 3, y: panelRect.y - 4, width: panelRect.width - 1, height: panelRect.height + 6 };
    const { calibration } = makeCalibration({ frame, anchorRect, panelRect: sloppy });
    expect(calibration.panel).toEqual({ dx: PANEL.x - ANCHOR.x, dy: PANEL.y - ANCHOR.y, width: 200, height: 240 });
  });

  it("accepts boxes drawn from bottom-right to top-left", () => {
    const flipped = { x: anchorRect.x + anchorRect.width, y: anchorRect.y + anchorRect.height, width: -anchorRect.width, height: -anchorRect.height };
    expect(makeCalibration({ frame, anchorRect: flipped, panelRect }).problems).toEqual([]);
  });

  it("explains what is wrong with bad boxes", () => {
    expect(makeCalibration({ frame, anchorRect: { x: 10, y: 10, width: 5, height: 5 }, panelRect }).problems[0]).toMatch(/bigger anchor/);
    expect(makeCalibration({ frame, anchorRect, panelRect: { ...panelRect, height: 20 } }).problems[0]).toMatch(/six listing rows/);
    expect(makeCalibration({ frame, anchorRect: { ...panelRect, width: 60, height: 30 }, panelRect }).problems.join()).toMatch(/overlap/);
    // A box inside the plain panel background has no detail to match on.
    const plain = { x: panelRect.x + 150, y: panelRect.y + 2, width: 40, height: 6 };
    expect(makeCalibration({ frame, anchorRect: { ...plain, height: 12, y: panelRect.y - 20 + 0 }, panelRect: { ...panelRect } }).problems.length).toBeGreaterThan(0);
  });
});

describe("export and import", () => {
  const { calibration } = makeCalibration({ name: "Store", frame, anchorRect, panelRect });

  it("round-trips through JSON", () => {
    const [back] = parseCalibrations(serializeCalibrations([calibration]));
    expect(back.anchor.gray).toEqual(calibration.anchor.gray);
    expect(back.panel).toEqual(calibration.panel);
    expect(back.name).toBe("Store");
  });

  it("rejects files that aren't calibration exports", () => {
    expect(() => parseCalibrations("not json")).toThrow(/valid JSON/);
    expect(() => parseCalibrations('{"hello": 1}')).toThrow(/isn't an FM Flipper/);
    const damaged = JSON.parse(serializeCalibrations([calibration]));
    damaged.calibrations[0].anchor.width = 81;
    expect(() => parseCalibrations(JSON.stringify(damaged))).toThrow(/damaged/);
  });

  it("merges by name", () => {
    const a = { ...calibration, name: "A" };
    const b = { ...calibration, name: "B" };
    const a2 = { ...calibration, name: "A", rows: 5 };
    expect(mergeCalibrations([a, b], [a2]).map((c) => [c.name, c.rows])).toEqual([["A", 5], ["B", 6]]);
  });
});

describe("normalizeRect", () => {
  it("clamps to the frame and drops empty boxes", () => {
    expect(normalizeRect({ x: -10, y: 5, width: 30, height: 10 }, 100, 100)).toEqual({ x: 0, y: 5, width: 20, height: 10 });
    expect(normalizeRect({ x: 5, y: 5, width: 0, height: 10 }, 100, 100)).toBeNull();
  });
});
