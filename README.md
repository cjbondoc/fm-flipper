# FM Flipper

A browser tool that reads a shared screen of a market's shop windows and flags listings priced below market value, after the sale fee. Everything runs locally in the browser: frames are never uploaded.

**Live site:** https://cjbondoc.github.io/fm-flipper/

## Status

- [x] Repo, tests and auto-deploy to GitHub Pages
- [x] Deal math (`src/deals`)
- [x] Frame source: live screen share and replay of saved screenshots
- [x] Calibration and region finding
- [ ] Text and price reading
- [ ] Item matching and price sources
- [ ] Session log and ranked deals view

## How a deal is scored

All prices are per item. With the default 2% undercut and 3% sale fee:

```
net    = market × 0.98 × 0.97
profit = net − buy price
margin = profit / buy price
score  = profit × qty × min(1, margin / 15%) × confidence
```

A listing shows as a deal at 5,000+ profit and 8%+ margin. Anything under 25% of market is flagged "check by eye", since it is usually a misread digit or the wrong item. All thresholds live in `DEFAULTS` in `src/deals/deals.js`.

## Develop

```sh
npm install
npm run dev      # local server; screen sharing works on localhost
npm test         # unit tests
npm run build    # production build into dist/
```

Pushes to `main` run the tests, build, and deploy to GitHub Pages.

## Frame source

- **Share game window** captures a window you pick. Chrome and Edge use `MediaStreamTrackProcessor`, which keeps running when the page is in the background. Other browsers fall back to a hidden video element and may pause while the page is hidden.
- **Load screenshots** (or drop images or a folder onto the preview) replays saved screenshots through the same pipeline, so you can develop without the game. Use the arrow keys to step and the space bar to play or pause.
- **Save frame as PNG** saves the current frame, which is handy for collecting test screenshots.

Frames are thinned out to 10 per second. A full read runs only when the picture changes and then holds still (`src/capture/changeDetector.js`), not on every frame. Add `?debug=1` to the URL to see the detector's thumbnail and numbers. That mode also exposes `window.pipeline` and `window.locator` in the console.

## Shop window

The app learns what a shop window looks like from your own screenshot. Open a shop (or load a screenshot of one) and press **Calibrate from current frame**, then:

1. Box an **anchor**: something on the window that never changes, such as its buttons.
2. Box the **listing rows**. The box snaps onto the rows using the thin lines between them.

On each read it searches for the anchor with normalized cross-correlation. It does a coarse pass on a 320 px wide copy of the frame over a range of UI scales, then a fine pass at full resolution. Before trusting a match it checks that the listing area is the pale panel, and it splits the panel into 6 rows: listing, sold (faded text) or empty. While a window is open, the change detector watches only its listing panel, so the animated scene around it no longer triggers reads.

Calibrations live in the browser. **Export calibrations** saves them as JSON so you can import them on another computer.

## Layout

| Folder | Purpose |
| --- | --- |
| `src/capture` | Screen share and replay frame sources |
| `src/calibrate` | Region selection and auto-detection |
| `src/ocr` | Digit matcher and text-recognition fallback |
| `src/match` | Map recognized names to known items |
| `src/prices` | Market price sources and cache |
| `src/deals` | Profit, margin and ranking |
| `src/session` | Location, seller and listing log |
| `src/ui` | Ranked list and highlights |
| `fixtures` | Test data; see `fixtures/README.md` (full screenshots stay local in `fixtures/raw/`) |

## Ground rules

Read-only: the tool only reads pixels from a window you choose to share. It sends no clicks or keypresses and reads no process memory.
