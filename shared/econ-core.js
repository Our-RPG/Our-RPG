// ===== Our RPG — shared shopkeeper economics =====
// The ONE implementation of the living-till price math (docs/
// shopkeeper-economy.md), shared by:
//   • js/skills/market.js + js/net/shopsync.js — the in-game market UI
//     computes every quote from this (tools/bundle.list, before market.js)
//   • server/src/shops.js — the Worker uses the same seed/decay/target math
//     when it settles flushed trades against the town till (via the ESM shim
//     server/src/econ-core.js)
// ZoneBakeCore pattern: plain script, no DOM/node/module APIs, one global.
// Every function is pure; state lives in the D1 ledger and the caller.
//
// Vocabulary (market.js's "sell/buy" is player-relative and ambiguous):
//   shopPays    — coins/unit the shop pays a player (player sells)
//   shopCharges — coins/unit the shop charges a player (player buys)
// Neutral state (no player stock, no observed demand, till at operating
// cash) reproduces the legacy formulas exactly: charges = value×surplusMult,
// pays = value×demandMult×payBase. Live shared state bends prices around
// that anchor, never replaces it.
"use strict";
(function (root) {

const P = {
  payBase: 0.5,        // neutral payout anchor — matches legacy value×0.5
  spreadMin: 0.15,     // hard bid-ask floor: pays ≤ charges×(1−this), always
  daysOfSupply: 7,     // stock the shop wants, in days of believed demand
  reserveRatio: 0.25,  // till fraction the shopkeeper won't spend
  tillCapMult: 4,      // till never grows past 4× operating cash
  expStock: 0.45,      // charges' stock-pressure exponent
  expDemand: 0.35,     // charges' demand-pressure exponent
  tauDays: 3,          // EMA time constant (wall-clock days, exp decay)
  chunk: 5,            // bulk sells reprice every 5 units (bank-click grammar)
  refuseAt: 3,         // shop refuses buying past 3× target stock
  floorDepth: 10,      // nominal shelf depth of a standing-floor item
  chargesMax: 2.2,     // charges never exceed 2.2× the neutral anchor
  dailyDrawFrac: 0.35, // one account may draw ≤ this × operating cash / day
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
function fnv(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---- deterministic per-town facts (both sides derive, neither stores) ----

// The town till's operating cash — seeded into shop_till on first trade.
function operatingCash(townKey) { return 900 + (fnv("till:" + townKey) % 1200); }
function reserveOf(operating) { return Math.round(operating * P.reserveRatio); }
function tillCapOf(operating) { return operating * P.tillCapMult; }
function dailyDrawCap(operating) { return Math.round(operating * P.dailyDrawFrac); }

// What the shopkeeper believes this item sells at with NO observations —
// units/day, hash-wobbled so identical neighbours differ a little.
function baselineDemand(townKey, item) {
  return 0.4 + (fnv("bd:" + townKey + ":" + item) % 120) / 40; // 0.4–3.4/day
}

// ---- lazy EMAs: store (value, updatedAt); decay in closed form on touch ----

function decay(v, updatedAt, nowMs) {
  if (!(v > 0)) return 0;
  return v * Math.exp(-Math.max(0, nowMs - updatedAt) / (P.tauDays * 864e5));
}
// Fold a traded quantity into an already-decayed EMA (units/day).
function bump(v, qty) { return v + qty / P.tauDays; }

// How much of today's flow still counts toward belief updates (anti-pump:
// stock always moves, but beliefs saturate at a few times baseline demand).
function dayCap(townKey, item) { return Math.max(20, Math.round(4 * baselineDemand(townKey, item))); }

// Target stock from believed demand; serverTarget uses ledger-only floor 0.
function targetStock(floorQty, emaOut, base) {
  return Math.max(1, floorQty + Math.max(emaOut, base) * P.daysOfSupply);
}

// ---- the shared quote --------------------------------------------------
// view: { value, demandMult, surplusMult, stocked, playerQty, emaOut, emaIn,
//         base }        (base = baselineDemand(town,item); stocked = standing
//                        floor item → nominal floorDepth shelf presence)
// till: { cash, operating } or null (offline / logged out → neutral).
// Returns integer coin prices plus the factors, for UI legibility.
function quote(view, till) {
  const value = Math.max(1, view.value || 1);
  const floorQty = view.stocked ? P.floorDepth : 0;
  const invEff = Math.max(0, floorQty + (view.playerQty || 0));
  const base = Math.max(0.1, view.base || 0.5);
  const emaOut = Math.max(0, view.emaOut || 0);

  // Pressure ratio built to be EXACTLY 1 in the neutral state, so offline
  // and untouched towns price precisely like the legacy formulas.
  const live = targetStock(floorQty, emaOut, base) / Math.max(invEff, 1);
  const neutral = targetStock(floorQty, 0, base) / Math.max(floorQty, 1);
  const ratio = live / neutral;

  const stockPressure = clamp(Math.pow(ratio, P.expStock), 0.55, 1.9);
  // Demand only ever RAISES charges above the anchor (staples stay stable
  // for new players); slack demand already lowers pays through stockNeed.
  const demandPressure = clamp(Math.pow(Math.max(emaOut, base) / base, P.expDemand), 1, 1.5);
  const stockNeed = clamp(ratio, 0.10, 1.5);
  const liquidity = till
    ? clamp((till.cash - reserveOf(till.operating)) /
            Math.max(1, till.operating - reserveOf(till.operating)), 0.15, 1.25)
    : 1;

  const anchor = value * (view.surplusMult || 1);
  const charges = Math.max(1, Math.round(
    Math.min(anchor * P.chargesMax, anchor * stockPressure * demandPressure)));
  const refused = invEff >= P.refuseAt * targetStock(floorQty, emaOut, base);
  const pays = refused ? 0 : Math.max(0, Math.round(Math.min(
    charges * (1 - P.spreadMin),
    value * (view.demandMult || 1) * P.payBase * stockNeed * liquidity)));

  return { pays, charges, refused, stockNeed, liquidity, ratio };
}

// ---- bulk sell walk ------------------------------------------------------
// Reprice every `chunk` units as the shelf fills and the till drains, so a
// 100-fish dump walks DOWN the curve in one deterministic pass. `mult` is
// the per-player factor (quality × reputation × specialist premium) applied
// to each chunk's shared price; the till pays the player's actual price.
// `maxUnit` caps every chunk's unit (the buy-back-loop guard for goods with
// no quality of their own). Returns { accepted, paid, unitFirst, refused,
// tillShort }.
function quoteSellLot(view, till, qty, mult, maxUnit) {
  mult = mult > 0 ? mult : 1;
  if (!(maxUnit > 0)) maxUnit = Infinity;
  let cash = till ? till.cash : Infinity;
  const floor = till ? reserveOf(till.operating) : 0;
  let pq = view.playerQty || 0, accepted = 0, paid = 0, unitFirst = 0;
  let refused = false, tillShort = false;
  while (accepted < qty) {
    const q = quote({ ...view, playerQty: pq }, till ? { cash, operating: till.operating } : null);
    if (q.refused) { refused = true; break; }
    // pays rounding to zero is the shelf saturating — unless the till is
    // scraping its reserve, in which case it's the coin that ran out
    if (q.pays < 1) { if (q.liquidity <= 0.2) tillShort = true; else refused = true; break; }
    const unit = Math.min(maxUnit, Math.max(1, Math.round(q.pays * mult)));
    if (!unitFirst) unitFirst = unit;
    let take = Math.min(P.chunk, qty - accepted);
    if (cash - floor < unit * take) take = Math.floor((cash - floor) / unit);
    if (take <= 0) { tillShort = true; break; }
    paid += unit * take; accepted += take; pq += take; cash -= unit * take;
  }
  return { accepted, paid, unitFirst, refused, tillShort };
}

root.EconCore = {
  P, fnv, clamp,
  operatingCash, reserveOf, tillCapOf, dailyDrawCap,
  baselineDemand, decay, bump, dayCap, targetStock,
  quote, quoteSellLot,
};
})(typeof globalThis !== "undefined" ? globalThis : self);
