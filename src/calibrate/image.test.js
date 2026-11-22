import { describe, expect, it } from "vitest";
import { cropGray, grayMedian, grayStdDev, integralImages, matchTemplate, resizeGray, rgbaStats } from "./image.js";
import { busyBackground } from "./scene.testutil.js";

describe("resizeGray", () => {
  it("averages boxes when shrinking", () => {
    const src = new Uint8Array([0, 100, 50, 50, 200, 100, 50, 50]); // 4 × 2
    expect([...resizeGray(src, 4, 2, 2, 1)]).toEqual([100, 50]);
  });

  it("keeps flat images flat when growing", () => {
    expect([...resizeGray(new Uint8Array(4).fill(77), 2, 2, 5, 3)]).toEqual(Array(15).fill(77));
  });
});

describe("matchTemplate", () => {
  const w = 120;
  const h = 80;
  const img = busyBackground(w, h, 3);
  const rect = { x: 37, y: 21, width: 25, height: 18 };
  const tpl = cropGray(img, w, rect);

  it("finds an exact crop with a score of 1", () => {
    const r = matchTemplate(img, w, h, tpl, rect.width, rect.height);
    expect(r).toMatchObject({ x: 37, y: 21 });
    expect(r.score).toBeCloseTo(1, 5);
  });

  it("gives the same answer with integral images", () => {
    const r = matchTemplate(img, w, h, tpl, rect.width, rect.height, { integrals: integralImages(img, w, h) });
    expect(r).toMatchObject({ x: 37, y: 21 });
  });

  it("ignores brightness and contrast changes", () => {
    const brighter = img.map((v) => Math.min(255, Math.round(v * 0.5 + 60)));
    expect(matchTemplate(brighter, w, h, tpl, rect.width, rect.height).score).toBeGreaterThan(0.99);
  });

  it("respects the search area", () => {
    const r = matchTemplate(img, w, h, tpl, rect.width, rect.height, { area: { x0: 0, y0: 0, x1: 20, y1: 20 } });
    expect(r.x).toBeLessThanOrEqual(20);
    expect(r.score).toBeLessThan(0.9);
  });

  it("returns score 0 for a flat template instead of NaN", () => {
    expect(matchTemplate(img, w, h, new Uint8Array(20).fill(9), 5, 4).score).toBe(0);
  });
});

describe("stats", () => {
  it("measures median brightness and chroma", () => {
    const rgba = new Uint8ClampedArray([200, 200, 200, 255, 210, 200, 190, 255, 255, 0, 0, 255]);
    expect(rgbaStats(rgba, 3, { x: 0, y: 0, width: 3, height: 1 })).toEqual({ medianBrightness: 200, medianChroma: 20 });
  });

  it("measures median gray and spread", () => {
    expect(grayMedian(new Uint8Array([5, 1, 9, 7]), 2, { x: 0, y: 0, width: 2, height: 2 })).toBe(5);
    expect(grayStdDev(new Uint8Array([10, 10, 10]))).toBe(0);
    expect(grayStdDev(new Uint8Array([0, 200]))).toBe(100);
  });
});
