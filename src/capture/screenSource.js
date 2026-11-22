// Live frames from a window the user chooses to share (getDisplayMedia).
//
// Two ways to get frames, best first:
//   "track-processor"       MediaStreamTrackProcessor hands us each VideoFrame directly.
//                           It is driven by promises, so it keeps running while this tab is
//                           in the background (Chrome and Edge).
//   "video-frame-callback"  Play the stream in a hidden <video> and grab it on each new
//                           frame. Browsers may pause this while the page is hidden.
// Frames are thinned out to `fps` before they reach the pipeline.

import { createRateLimiter } from "./rateLimiter.js";

export const SCREEN_METHODS = Object.freeze({
  "track-processor": "Track processor",
  "video-frame-callback": "Video frame callback",
  timer: "Timer",
});

export function canShareScreen() {
  return Boolean(navigator.mediaDevices?.getDisplayMedia);
}

/**
 * Ask the user to pick a window, then call onImage(image, meta) up to `fps` times a second.
 * Resolves to { stop(), method, label, width, height }. Rejects if the user cancels.
 * onEnded() runs when sharing stops from the browser's own "Stop sharing" bar.
 */
export async function startScreenShare({ onImage, onEnded, fps = 10 }) {
  if (!canShareScreen()) throw new Error("This browser can't share a window. Use a recent Chrome or Edge.");

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "window", frameRate: { ideal: 30, max: 30 }, cursor: "never" },
    audio: false,
    selfBrowserSurface: "exclude",
  });
  const [track] = stream.getVideoTracks();
  const due = createRateLimiter(fps);
  let stopped = false;
  let cleanup = () => {};

  let method;
  if (typeof MediaStreamTrackProcessor === "function") {
    method = "track-processor";
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    cleanup = () => reader.cancel().catch(() => {});
    (async () => {
      while (!stopped) {
        let result;
        try {
          result = await reader.read();
        } catch {
          break;
        }
        if (result.done) break;
        const frame = result.value;
        try {
          if (!stopped && due(performance.now())) {
            onImage(frame, { width: frame.displayWidth, height: frame.displayHeight, source: "screen" });
          }
        } finally {
          frame.close(); // VideoFrames hold GPU memory until closed
        }
      }
    })();
  } else {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    const grab = () => {
      if (!stopped && video.videoWidth && due(performance.now())) {
        onImage(video, { width: video.videoWidth, height: video.videoHeight, source: "screen" });
      }
    };
    if (typeof video.requestVideoFrameCallback === "function") {
      method = "video-frame-callback";
      let handle = 0;
      const onVideoFrame = () => {
        grab();
        if (!stopped) handle = video.requestVideoFrameCallback(onVideoFrame);
      };
      handle = video.requestVideoFrameCallback(onVideoFrame);
      cleanup = () => {
        video.cancelVideoFrameCallback?.(handle);
        video.srcObject = null;
      };
    } else {
      method = "timer";
      const timer = setInterval(grab, 1000 / fps);
      cleanup = () => {
        clearInterval(timer);
        video.srcObject = null;
      };
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    cleanup();
    for (const t of stream.getTracks()) t.stop();
  }

  track.addEventListener("ended", () => {
    const wasRunning = !stopped;
    stop();
    if (wasRunning) onEnded?.();
  });

  const settings = track.getSettings();
  return { stop, method, label: track.label, width: settings.width, height: settings.height };
}
