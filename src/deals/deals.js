// Deal math. All prices are whole currency units per item.
// Rates are in basis points (1 bp = 0.01%) so the math stays in integers.

export const DEFAULTS = Object.freeze({
  feeBps: 300, // sale fee charged when your listing sells (3%)
  undercutBps: 200, // list this far under market so it actually sells (2%)
  minProfit: 5000, // smallest per-item profit worth showing
  minMarginBps: 800, // smallest margin worth showing (8%)
  targetMarginBps: 1500, // margin that earns a full score (15%)
  misreadRatioBps: 2500, // under 25% of market = probably a misread, flag it
});

const BPS = 10000;

/** Price per item when a listing is priced per bundle. */
export function unitPrice(price, bundleQty = 1) {
  if (!Number.isFinite(price) || price < 0) throw new RangeError("price must be >= 0");
  if (!Number.isInteger(bundleQty) || bundleQty < 1) throw new RangeError("bundleQty must be a positive integer");
  return Math.floor(price / bundleQty);
}

/** What you plan to list at, and what you keep after the fee. */
export function resale(marketPrice, settings = DEFAULTS) {
  const sellPrice = Math.floor((marketPrice * (BPS - settings.undercutBps)) / BPS);
  const fee = Math.ceil((sellPrice * settings.feeBps) / BPS);
  return { sellPrice, fee, net: sellPrice - fee };
}

/** Highest buy price that still breaks even. */
export function breakEven(marketPrice, settings = DEFAULTS) {
  return resale(marketPrice, settings).net;
}

/**
 * Evaluate one listing.
 * status: "deal" (passes thresholds), "check" (suspiciously cheap, verify by eye) or "skip".
 * confidence (0-1) comes from price sample size, price age and OCR agreement.
 */
export function evaluate({ buyPrice, marketPrice, qty = 1, confidence = 1 }, settings = DEFAULTS) {
  if (!(marketPrice > 0) || !(buyPrice >= 0)) {
    return { status: "skip", reason: "missing price", profit: 0, totalProfit: 0, marginBps: 0, score: 0 };
  }
  const { sellPrice, fee, net } = resale(marketPrice, settings);
  const profit = net - buyPrice;
  const marginBps = buyPrice > 0 ? Math.floor((profit * BPS) / buyPrice) : 0;
  const totalProfit = profit * qty;
  const marginFactor = Math.min(1, Math.max(0, marginBps / settings.targetMarginBps));
  const score = profit > 0 ? Math.round(totalProfit * marginFactor * clamp01(confidence)) : 0;

  let status = "skip";
  let reason = "below thresholds";
  if (buyPrice * BPS < marketPrice * settings.misreadRatioBps) {
    status = "check";
    reason = "too cheap: verify the price and item";
  } else if (profit >= settings.minProfit && marginBps >= settings.minMarginBps) {
    status = "deal";
    reason = "passes thresholds";
  }
  return { status, reason, sellPrice, fee, net, profit, totalProfit, marginBps, score };
}

/** Deals first, highest score first. "check" items follow so they stay visible. */
export function rank(listings, settings = DEFAULTS) {
  const order = { deal: 0, check: 1, skip: 2 };
  return listings
    .map((listing) => ({ ...listing, result: evaluate(listing, settings) }))
    .sort((a, b) => order[a.result.status] - order[b.result.status] || b.result.score - a.result.score);
}

function clamp01(x) {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}
