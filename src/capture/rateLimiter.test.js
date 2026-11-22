import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimiter.js";

/** How many frames are kept from one second of input at sourceFps. */
function keptPerSecond(sourceFps, targetFps, jitterMs = 0) {
  const due = createRateLimiter(targetFps);
  let kept = 0;
  const seconds = 5;
  for (let i = 0; i < sourceFps * seconds; i++) {
    const jitter = jitterMs ? ((i * 7919) % 11) / 10 - 0.5 : 0; // deterministic ±0.5 spread
    if (due((i * 1000) / sourceFps + jitter * jitterMs)) kept++;
  }
  return kept / seconds;
}

describe("rate limiter", () => {
  it("gives the target rate from sources faster than it", () => {
    expect(keptPerSecond(15, 10)).toBeCloseTo(10, 0);
    expect(keptPerSecond(30, 10)).toBeCloseTo(10, 0);
    expect(keptPerSecond(60, 10)).toBeCloseTo(10, 0);
  });

  it("copes with timing jitter", () => {
    expect(keptPerSecond(15, 10, 4)).toBeGreaterThanOrEqual(9);
    expect(keptPerSecond(30, 10, 4)).toBeLessThanOrEqual(10.4);
  });

  it("keeps every frame from slower sources", () => {
    expect(keptPerSecond(5, 10)).toBe(5);
  });

  it("does not burst after a stall", () => {
    const due = createRateLimiter(10);
    expect(due(0)).toBe(true);
    expect(due(5000)).toBe(true); // first frame after a 5 s gap
    expect(due(5033)).toBe(false); // and no catch-up burst right after it
    expect(due(5066)).toBe(false);
    expect(due(5100)).toBe(true);
  });
});
