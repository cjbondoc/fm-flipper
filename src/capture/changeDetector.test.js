import { describe, expect, it } from "vitest";
import { createChangeDetector } from "./changeDetector.js";

const SIZE = 1000; // a 1000-pixel thumbnail makes fractions easy to reason about

/** A flat gray frame, with the first `patch` pixels set to `value` (a "window"). */
function frame(patch = 0, value = 250, base = 100) {
  const g = new Uint8Array(SIZE).fill(base);
  g.fill(value, 0, patch);
  return g;
}

/** Push frames and return the reasons for the ones that were read. */
function reads(detector, frames) {
  return frames.map((f) => detector.push(f)).filter((r) => r.read).map((r) => r.reason);
}

describe("change detector", () => {
  it("reads the first picture once it holds still", () => {
    const d = createChangeDetector();
    expect(d.push(frame()).read).toBe(false); // nothing to compare with yet
    expect(d.push(frame()).read).toBe(false); // 1 still frame
    expect(d.push(frame())).toMatchObject({ read: true, reason: "settled" }); // 2 still frames
    expect(reads(d, [frame(), frame(), frame()])).toEqual([]); // nothing new afterwards
  });

  it("ignores noise below the pixel threshold", () => {
    const d = createChangeDetector();
    reads(d, [frame(), frame(), frame()]);
    expect(reads(d, [frame(0, 0, 110), frame(0, 0, 90), frame(0, 0, 120)])).toEqual([]);
  });

  it("ignores changes smaller than changeFraction", () => {
    const d = createChangeDetector();
    reads(d, [frame(), frame(), frame()]);
    expect(reads(d, [frame(9), frame(9), frame(9), frame(9)])).toEqual([]); // 0.9% < 1%
  });

  it("reads a new window only after it stops animating", () => {
    const d = createChangeDetector();
    reads(d, [frame(), frame(), frame()]);
    // Window grows over three frames, then holds still.
    expect(d.push(frame(20)).read).toBe(false);
    expect(d.push(frame(40)).read).toBe(false);
    expect(d.push(frame(60)).read).toBe(false);
    expect(d.push(frame(60)).read).toBe(false);
    expect(d.push(frame(60))).toMatchObject({ read: true, reason: "settled" });
  });

  it("skips the read when the picture returns to what was last read", () => {
    const d = createChangeDetector();
    reads(d, [frame(), frame(), frame()]);
    expect(reads(d, [frame(50), frame(), frame(), frame()])).toEqual([]);
  });

  it("reads anyway when the picture never settles", () => {
    const d = createChangeDetector({ maxWaitFrames: 4 });
    reads(d, [frame(), frame(), frame()]);
    const moving = [frame(20), frame(40), frame(60), frame(80), frame(100)];
    expect(reads(d, moving)).toEqual(["timeout"]);
  });

  it("force() reads the very next frame", () => {
    const d = createChangeDetector();
    reads(d, [frame(), frame(), frame()]);
    d.force();
    expect(d.push(frame())).toMatchObject({ read: true, reason: "forced" });
    expect(d.push(frame()).read).toBe(false);
  });

  it("starts over when the frame size changes", () => {
    const d = createChangeDetector();
    reads(d, [frame(), frame(), frame()]);
    const small = new Uint8Array(10).fill(100);
    expect(reads(d, [small, small, small])).toEqual(["settled"]);
  });
});
