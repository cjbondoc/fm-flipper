// Thins a stream of frames down to about `fps` per second.
//
// Keeping "one frame per 100 ms since the last kept one" loses frames when the source
// runs at a rate that doesn't divide evenly: a 15 fps window would give 7.5. Instead we
// keep a schedule of due times and take the first frame at or after each one.

export function createRateLimiter(fps) {
  const gap = 1000 / fps;
  const slack = gap * 0.05; // tolerate a little timing jitter
  let nextAt = -Infinity;

  /** true if the frame arriving at `now` (ms) should be kept */
  return function due(now) {
    if (now < nextAt - slack) return false;
    // Behind by more than a frame (a stall, a paused tab): restart the schedule from now
    // instead of letting a burst of frames through to catch up.
    nextAt = now - nextAt > gap ? now + gap : nextAt + gap;
    return true;
  };
}
