// Decides when a frame is worth a full read.
//
// Reading every frame wastes work and reads half-drawn windows. Instead we compare a
// small gray thumbnail of each frame with the last frame we read. When enough of it
// changes, we wait for the picture to hold still for a few frames and then read once.
// If it never settles (an animated scene), we read anyway after maxWaitFrames.

import { changedFraction } from "./pixels.js";

export const CHANGE_DEFAULTS = Object.freeze({
  pixelThreshold: 24, // gray levels a pixel must move to count as changed
  changeFraction: 0.01, // share of pixels changed since the last read that starts a new read (1%)
  settleFraction: 0.002, // frame-to-frame change below this counts as holding still (0.2%)
  settleFrames: 2, // still frames in a row before reading
  maxWaitFrames: 10, // read anyway after this many frames of continuous change
});

/**
 * push(gray) takes one thumbnail (Uint8Array, same size each time) and returns
 * { read, reason, state, motion, changed }:
 *   read    true when this frame should get a full read
 *   reason  "settled" | "timeout" | "forced" when read is true, else null
 *   state   "stable" (nothing new) or "moving" (changed, waiting to settle)
 *   motion  fraction changed since the previous frame
 *   changed fraction changed since the last read frame
 */
export function createChangeDetector(options = {}) {
  const o = { ...CHANGE_DEFAULTS, ...options };
  let prev = null;
  let ref = null;
  let state = "moving";
  let still = 0;
  let waited = 0;
  let forced = false;

  function reset() {
    prev = null;
    ref = null;
    state = "moving";
    still = 0;
    waited = 0;
    forced = false;
  }

  function push(gray) {
    if (prev && prev.length !== gray.length) reset(); // frame size changed: start over

    const motion = prev ? changedFraction(gray, prev, o.pixelThreshold) : 1;
    const changed = ref ? changedFraction(gray, ref, o.pixelThreshold) : 1;
    prev = gray;

    let reason = null;
    if (forced) {
      reason = "forced";
    } else {
      if (state === "stable" && changed >= o.changeFraction) {
        state = "moving";
        still = 0;
        waited = 0;
      }
      if (state === "moving") {
        still = motion < o.settleFraction ? still + 1 : 0;
        waited++;
        if (still >= o.settleFrames) {
          // Settled. Skip the read if the picture went back to what we last read.
          if (changed >= o.changeFraction) reason = "settled";
          state = "stable";
        } else if (waited >= o.maxWaitFrames) {
          reason = "timeout";
        }
      }
    }

    if (reason) {
      ref = gray;
      state = "stable";
      forced = false;
    }
    return { read: reason !== null, reason, state, motion, changed };
  }

  return {
    push,
    reset,
    /** Read the next frame no matter what changed. */
    force() {
      forced = true;
    },
    get options() {
      return o;
    },
  };
}
