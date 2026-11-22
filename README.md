# FM Flipper

A browser tool that reads a shared screen of a market's shop windows and flags listings priced below market value, after the sale fee. Everything runs locally in the browser: frames are never uploaded.

**Live site:** https://cjbondoc.github.io/fm-flipper/

## Status

- [x] Repo, tests and auto-deploy to GitHub Pages
- [x] Deal math (`src/deals`)
- [x] Frame source: live screen share and replay of saved screenshots
- [ ] Calibration and region finding
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

Frames are thinned out to 10 per second. A full read runs only when the picture changes and then holds still (`src/capture/changeDetector.js`), not on every frame. Add `?debug=1` to the URL to see the detector's thumbnail and numbers. That mode also exposes the pipeline as `window.pipeline` in the console.

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
| `fixtures` | Saved screenshots with ground truth, for tests |

## Ground rules

Read-only: the tool only reads pixels from a window you choose to share. It sends no clicks or keypresses and reads no process memory.
