import { describe, expect, it } from "vitest";
import { DEFAULTS, breakEven, evaluate, rank, resale, unitPrice } from "./deals.js";

describe("resale", () => {
  it("applies the undercut, then the 3% fee", () => {
    expect(resale(100000)).toEqual({ sellPrice: 98000, fee: 2940, net: 95060 });
  });

  it("rounds the fee up so profit is never overstated", () => {
    expect(resale(1001).fee).toBe(30); // 980 * 3% = 29.4 -> 30
  });
});

describe("evaluate", () => {
  it("matches the worked example in the plan", () => {
    const r = evaluate({ buyPrice: 70000, marketPrice: 100000 });
    expect(r.status).toBe("deal");
    expect(r.profit).toBe(25060);
    expect(r.marginBps).toBe(3580); // 35.8%
  });

  it("multiplies profit by quantity", () => {
    expect(evaluate({ buyPrice: 70000, marketPrice: 100000, qty: 3 }).totalProfit).toBe(75180);
  });

  it("skips listings that do not clear the margin floor", () => {
    expect(evaluate({ buyPrice: 93000, marketPrice: 100000 }).status).toBe("skip");
  });

  it("flags suspiciously cheap listings instead of ranking them", () => {
    const r = evaluate({ buyPrice: 9000, marketPrice: 100000 });
    expect(r.status).toBe("check");
  });

  it("skips listings with no market price", () => {
    expect(evaluate({ buyPrice: 5000, marketPrice: 0 }).reason).toBe("missing price");
  });

  it("scales the score down by confidence", () => {
    const full = evaluate({ buyPrice: 70000, marketPrice: 100000, confidence: 1 }).score;
    const half = evaluate({ buyPrice: 70000, marketPrice: 100000, confidence: 0.5 }).score;
    expect(half).toBe(Math.round(full / 2));
  });
});

describe("helpers", () => {
  it("converts bundle prices to per-item prices", () => {
    expect(unitPrice(5000, 100)).toBe(50);
  });

  it("break-even is about 95% of market with default settings", () => {
    expect(breakEven(100000)).toBe(95060);
  });

  it("ranks deals by score, then checks, then skips", () => {
    const ranked = rank([
      { id: "skip", buyPrice: 99000, marketPrice: 100000 },
      { id: "small", buyPrice: 80000, marketPrice: 100000 },
      { id: "check", buyPrice: 1000, marketPrice: 100000 },
      { id: "big", buyPrice: 60000, marketPrice: 100000 },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["big", "small", "check", "skip"]);
  });

  it("exposes defaults as read-only", () => {
    expect(Object.isFrozen(DEFAULTS)).toBe(true);
  });
});
