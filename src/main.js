import "./style.css";
import { loadSavedCalibrations, saveCalibrations } from "./calibrate/calibration.js";
import { createShopLocator } from "./calibrate/locator.js";
import { createPipeline } from "./capture/pipeline.js";
import { DEFAULTS, breakEven, evaluate } from "./deals/deals.js";
import { mountFramePanel } from "./ui/framePanel.js";
import { mountShopPanel } from "./ui/shopPanel.js";

const fmt = (n) => Math.round(n).toLocaleString("en-US");
const pct = (bps) => `${(bps / 100).toFixed(1)}%`;
const debug = new URLSearchParams(location.search).get("debug") === "1";

document.querySelector("#app").innerHTML = `
  <header>
    <h1>FM Flipper</h1>
    <p class="lead">Screen-reading market scanner. Work in progress: capture, shop-window finding and the deal calculator work today; reading prices is next.</p>
  </header>

  <section class="card" id="frames"></section>

  <section class="card" id="shop"></section>

  <section class="card">
    <h2>Deal calculator</h2>
    <form id="calc">
      <label>Listed price per item <input name="buy" type="number" min="0" step="1" value="70000" /></label>
      <label>Market price per item <input name="market" type="number" min="0" step="1" value="100000" /></label>
      <label>Quantity <input name="qty" type="number" min="1" step="1" value="1" /></label>
    </form>
    <dl id="result"></dl>
    <p class="note">Assumes a ${pct(DEFAULTS.feeBps)} sale fee and listing ${pct(DEFAULTS.undercutBps)} under market.</p>
  </section>

  <section class="card">
    <h2>Roadmap</h2>
    <ol class="roadmap">
      <li class="done">Repo, tests and auto-deploy</li>
      <li class="done">Deal math</li>
      <li class="done">Frame source: live screen share and replay of saved screenshots</li>
      <li class="done">Calibration and region finding</li>
      <li>Text and price reading</li>
      <li>Item matching and price sources</li>
      <li>Session log and ranked deals view</li>
    </ol>
  </section>
`;

// Every frame flows through one pipeline. The shop locator looks for a shop window on
// each read; the price reader (next phase) will subscribe with locator.onResult(...).
let calibrations = loadSavedCalibrations();
const store = {
  get: () => calibrations,
  set(list) {
    calibrations = list;
    return saveCalibrations(list);
  },
};
const pipeline = createPipeline();
const locator = createShopLocator({ pipeline, getCalibrations: store.get });
const framePanel = mountFramePanel(document.querySelector("#frames"), { pipeline, debug, onStop: () => locator.reset() });
mountShopPanel(document.querySelector("#shop"), { pipeline, locator, store, framePanel, debug });
if (debug) Object.assign(window, { pipeline, locator }); // poke at them from the browser console

const form = document.querySelector("#calc");
const out = document.querySelector("#result");

function update() {
  const data = new FormData(form);
  const buyPrice = Number(data.get("buy"));
  const marketPrice = Number(data.get("market"));
  const qty = Math.max(1, Math.floor(Number(data.get("qty")) || 1));
  const r = evaluate({ buyPrice, marketPrice, qty });
  const label = { deal: "Deal", check: "Check by eye", skip: "Skip" }[r.status];
  out.innerHTML = `
    <div><dt>Verdict</dt><dd class="status ${r.status}">${label}</dd></div>
    <div><dt>Profit per item</dt><dd>${fmt(r.profit)}</dd></div>
    <div><dt>Total profit</dt><dd>${fmt(r.totalProfit)}</dd></div>
    <div><dt>Margin</dt><dd>${pct(r.marginBps)}</dd></div>
    <div><dt>Break-even buy price</dt><dd>${marketPrice > 0 ? fmt(breakEven(marketPrice)) : "—"}</dd></div>
    <div><dt>Why</dt><dd>${r.reason}</dd></div>
  `;
}

form.addEventListener("input", update);
update();
