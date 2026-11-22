import { describe, expect, it } from "vitest";
import { changedFraction, fitWidth, regionToPixels, toGray } from "./pixels.js";

describe("toGray", () => {
  it("maps white to 255, black to 0, and weights green most", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]);
    expect([...toGray(rgba, 4, 1)]).toEqual([255, 0, 76, 149]);
  });

  it("rejects a buffer that is too small", () => {
    expect(() => toGray(new Uint8ClampedArray(4), 2, 1)).toThrow(RangeError);
  });
});

describe("fitWidth", () => {
  it("scales down and keeps the aspect ratio", () => {
    expect(fitWidth(1920, 1080, 160)).toEqual({ width: 160, height: 90 });
  });

  it("never scales up", () => {
    expect(fitWidth(100, 50, 160)).toEqual({ width: 100, height: 50 });
  });

  it("keeps at least one row", () => {
    expect(fitWidth(10000, 1, 160).height).toBe(1);
  });
});

describe("changedFraction", () => {
  it("counts only differences above the threshold", () => {
    const a = new Uint8Array([100, 100, 100, 100]);
    const b = new Uint8Array([124, 125, 76, 75]); // +24 and -24 do not count; +25 and -25 do
    expect(changedFraction(a, b, 24)).toBe(0.5);
  });

  it("rejects frames of different sizes", () => {
    expect(() => changedFraction(new Uint8Array(2), new Uint8Array(3), 24)).toThrow(RangeError);
  });
});

describe("regionToPixels", () => {
  it("returns the whole frame for null", () => {
    expect(regionToPixels(null, 1920, 1080)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it("converts fractions and clamps to the frame", () => {
    expect(regionToPixels({ x: 0.5, y: 0.5, width: 0.25, height: 0.25 }, 1000, 800)).toEqual({ x: 500, y: 400, width: 250, height: 200 });
    expect(regionToPixels({ x: 0.9, y: -0.1, width: 0.5, height: 0.5 }, 100, 100)).toEqual({ x: 90, y: 0, width: 10, height: 40 });
  });
});
