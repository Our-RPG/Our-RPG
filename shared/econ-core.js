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
  // ---- the bid/ask spread (the shopkeeper's margin) --------------------
  // Both sides of the counter quote one fair MID price built from scarcity;
  // the shop buys a touch below it and sells a touch above. Because buy and
  // sell straddle the SAME mid at the SAME stock level, buying N units then
  // selling them straight back returns the shelf — and therefore the price —
  // to exactly where it started: the only coin lost is this spread (the
  // shop's cut), never a cratered price. ask = mid×(1+h), bid = mid×(1−h).
  halfSpread: 0.06,    // ⇒ ~12% round-trip margin (h). Set 0 for free round trips.
  spreadMin: 0.10,     // hard floor after per-player mults: pays ≤ charges×(1−this)
  // ---- scarcity curve --------------------------------------------------
  daysOfSupply: 7,     // target (neutral-price) stock = believed demand × this
  openMult: 1.5,       // opening shelf = target × this (comfortable starting stock)
  minOpen: 12,         // every carried staple opens with at least this many units
  expStock: 0.55,      // scarcity exponent: price = mid × (target/stock)^this
  pLo: 0.45,           // glut floor on the scarcity multiplier (overstocked)
  pHi: 2.4,            // scarcity ceiling (near sold-out)
  // ---- the till (finite cash) ------------------------------------------
  reserveRatio: 0.25,  // till fraction the shopkeeper won't spend
  tillCapMult: 4,      // till never grows past 4× operating cash
  dailyDrawFrac: 0.35, // one account may draw ≤ this × operating cash / day
  // ---- misc ------------------------------------------------------------
  tauDays: 3,          // EMA time constant (wall-clock days, exp decay)
  chunk: 5,            // bulk trades reprice every 5 units (bank-click grammar)
  commPerTile: 1.8,    // commission baseline market rate — coins per tile guided
  commMin: 5,          // suggested travel fee never dips below this (short hops)
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
function fnv(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---- deterministic per-town facts (both sides derive, neither stores) ----

// The town till's operating cash — seeded into shop_till on first trade.
// (params scales NEW seeds only; existing tills keep their stored operating.)
function operatingCash(townKey, params) {
  return Math.round((900 + (fnv("till:" + townKey) % 1200)) * (params ? params.opMult : 1));
}
function reserveOf(operating, ratio) { return Math.round(operating * (ratio || P.reserveRatio)); }
function tillCapOf(operating) { return operating * P.tillCapMult; }
function dailyDrawCap(operating) { return Math.round(operating * P.dailyDrawFrac); }

// ---- personality (Phase 2) ----------------------------------------------
// Every town's head trader has a hash-derived temperament. CRITICAL
// INVARIANT: personality bends only the DYNAMIC parameters (stock horizon,
// reserve, refusal, big-ticket appetite, pressure exponent, till size) —
// never the neutral anchors (payBase, surplusMult, spreadMin) — so an
// untouched or offline town still prices byte-identically to the legacy
// formulas. Personality only shows once the market is alive.
const ARCHETYPES = [
  // steady: deep reserves, long horizon, hates single big buys
  { name: "steady",     daysOfSupply: 9,  reserveRatio: 0.38, refuseAt: 2.4, opMult: 1.25, bigTicketFrac: 0.15, expStock: 0.40 },
  // keen: thin reserves, quick repricing, chases opportunity
  { name: "keen",       daysOfSupply: 4,  reserveRatio: 0.15, refuseAt: 3.5, opMult: 0.85, bigTicketFrac: 0.40, expStock: 0.55 },
  // particular: big purse, slow turnover, will splash on one fine piece
  { name: "particular", daysOfSupply: 12, reserveRatio: 0.30, refuseAt: 2.0, opMult: 1.50, bigTicketFrac: 0.55, expStock: 0.45 },
  // brisk: small float, fast stock, everything must move
  { name: "brisk",      daysOfSupply: 3,  reserveRatio: 0.20, refuseAt: 4.0, opMult: 0.70, bigTicketFrac: 0.20, expStock: 0.50 },
];
function shopParams(townKey) {
  const h = fnv("pers:" + townKey);
  const a = ARCHETYPES[h % ARCHETYPES.length];
  // ±20% per-field jitter so no two steady towns are quite the same
  const j = k => 1 + ((((h >>> (k * 4)) & 31) % 21) - 10) / 50;
  return {
    archetype: a.name,
    daysOfSupply: a.daysOfSupply * j(1),
    reserveRatio: clamp(a.reserveRatio * j(2), 0.10, 0.45),
    refuseAt: clamp(a.refuseAt * j(3), 1.8, 4.5),
    opMult: a.opMult * j(4),
    bigTicketFrac: clamp(a.bigTicketFrac * j(5), 0.08, 0.60),
    expStock: clamp(a.expStock * j(6), 0.30, 0.65),
  };
}

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

// Target stock from believed demand — the level at which the shelf prices at
// its neutral fair value (scarcity multiplier == 1). floorQty is legacy (now
// always 0); both client and server pass the same args so targets agree.
function targetStock(floorQty, emaOut, base, days) {
  return Math.max(1, floorQty + Math.max(emaOut, base) * (days || P.daysOfSupply));
}

// The shopkeeper's OPENING inventory of an item they stock — deterministic so
// the client (showing an untouched shelf) and the worker (seeding the ledger
// on first trade) always agree sight unseen. A comfortable buffer above the
// neutral target: normal buying barely moves the price; only bulk-buying
// clears the shelf and drives real scarcity. Stock only ever replenishes from
// here via players SELLING — nothing auto-restocks it.
function openingStock(townKey, item, params) {
  const days = params ? params.daysOfSupply : P.daysOfSupply;
  const target = targetStock(0, 0, baselineDemand(townKey, item), days);
  return Math.max(P.minOpen, Math.round(target * P.openMult));
}

// ---- commission (pay-to-be-guided) market rate --------------------------
// The suggested travel fee for guiding someone `dist` tiles. ratePerTile is
// the live observed market average (coins/tile) the LiveZone DO tracks across
// delivered commissions; when it has none yet (fresh zone / offline) the
// caller passes 0 and we fall back to the commPerTile baseline. A short-hop
// floor keeps tiny trips from suggesting ~0. Pure — the caller shows it as a
// pre-filled suggestion the player can revise.
function commissionSuggest(dist, ratePerTile) {
  const d = Math.max(1, dist | 0);
  const rate = ratePerTile > 0 ? ratePerTile : P.commPerTile;
  return Math.max(P.commMin, Math.round(rate * d));
}

// ---- the shared quote --------------------------------------------------
// ONE finite shelf, priced on scarcity, with a symmetric bid/ask straddle.
//
// view: { value, localMult, stock, base, emaOut, floorMult, baseMult }
//   value     — the item's base coin value
//   localMult — the town's standing appetite for this KIND of good (>1 a
//               place that wants it, <1 a local surplus, 1 neutral). Applied
//               to the MID, so a demanded good is both dearer to buy AND
//               better-paid when sold — one coherent local-market signal.
//   stock     — units currently on the shelf (shop's own + player-sold); the
//               single number both buy and sell prices move along.
//   base      — baselineDemand(town,item); emaOut — believed units/day bought.
//   floorMult/baseMult — Phase-3 supply shocks (shrink the shelf / heat need).
// till: { cash, operating } or null (offline / logged out). The till limits
//   how much the shop can PAY OUT (sell side), never the per-unit price.
// params: shopParams(townKey), or omitted for the fixed defaults.
//
// At stock == target the scarcity multiplier is 1 and the shelf prices at its
// neutral fair value. Buying lowers stock → price rises; selling raises stock
// → price falls. Both sides read the same mid, so a buy-then-sell round trip
// at one stock level nets exactly the spread (2·halfSpread) — never a crater.
function quote(view, till, params) {
  const days = params ? params.daysOfSupply : P.daysOfSupply;
  const resRatio = params ? params.reserveRatio : P.reserveRatio;
  const expStock = params ? params.expStock : P.expStock;
  const value = Math.max(1, view.value || 1);
  const localMult = view.localMult > 0 ? view.localMult : 1;
  const floorMult = view.floorMult > 0 ? view.floorMult : 1;  // shock: shrink shelf
  const baseMult = view.baseMult > 0 ? view.baseMult : 1;     // shock: heat demand
  const base = Math.max(0.1, view.base || 0.5);
  const emaOut = Math.max(0, view.emaOut || 0);

  const target = targetStock(0, emaOut, base * baseMult, days);
  // the comfortably-stocked level — a buffer above the bare 1-week target, and
  // the point at which the shelf prices at its neutral fair value. It is also
  // exactly the opening stock (openingStock below), so an untouched shelf
  // reads ratio 1 and prices at value×localMult. Rising demand lifts it, so a
  // shelf that was comfortable becomes "short" as the town wants more.
  const comfort = Math.max(P.minOpen, Math.round(target * P.openMult));
  const stock = Math.max(0, (view.stock || 0) * floorMult);
  // scarcity ratio: comfort/stock. >1 shelf is short (price up), <1 glut (down).
  const ratio = comfort / Math.max(stock, 1);
  const pressure = clamp(Math.pow(ratio, expStock), P.pLo, P.pHi);
  const mid = value * localMult * pressure;

  const h = P.halfSpread;
  const charges = Math.max(1, Math.round(mid * (1 + h)));      // shop sells (ask)
  let pays = Math.max(0, Math.round(mid * (1 - h)));           // shop buys  (bid)
  pays = Math.min(pays, Math.round(charges * (1 - P.spreadMin))); // safety: bid < ask
  // till health, for flavour/mood only — deliberately NOT a price factor, so
  // draining the till on a sell can't asymmetrically depress the next quote.
  const liquidity = till
    ? clamp((till.cash - reserveOf(till.operating, resRatio)) /
            Math.max(1, till.operating - reserveOf(till.operating, resRatio)), 0, 1.25)
    : 1;

  // stockNeed > 1 ⇒ shelf below its comfortable level ⇒ shop wants more
  // (drives the "bring me X" contracts and the market-mood line).
  return { pays, charges, mid, target: comfort, stock, ratio, pressure, liquidity,
           stockNeed: ratio, refused: false };
}

// ---- the unified bulk walk ----------------------------------------------
// Walk `qty` units through the curve ONE unit at a time, moving the shelf as we
// go, so a big lot is priced before the player commits. The convention that
// makes buying and selling exactly inverse: the unit at shelf-position `p`
// (present whenever stock ≥ p) is bought when stock IS p and sold when adding
// it MAKES stock p — i.e. a buy prices at the pre-removal stock, a sell at the
// post-add stock. Buying N then selling the same N back therefore trades the
// identical physical positions {s−N+1 … s}; at each, ask(p) > bid(p) by the
// spread, so the shelf (and price) land exactly where they began and the only
// loss is the shop's margin — never a cratered price, never a free profit.
//
// `mult` is the per-player factor (quality × reputation × specialist premium /
// buy discount). `opts` (buy): {budget} coins the player has, {space} units of
// pack room — the walk stops at either (noFunds / noSpace). Sells are bounded
// by the till (can't pay below reserve → tillShort; one line can't tie up more
// than params.bigTicketFrac of the spendable till → bigTicket). Buys are bounded
// by the shelf (outOfStock). Returns { accepted, paid, unitFirst, tillShort,
// bigTicket, outOfStock, noFunds, noSpace, refused } — `paid` is total coin.
function quoteLot(view, till, qty, side, mult, params, opts) {
  mult = mult > 0 ? mult : 1;
  const buy = side === "buy";
  const budget = opts && opts.budget != null ? opts.budget : Infinity;
  const space = opts && opts.space != null ? opts.space : Infinity;
  let cash = till ? till.cash : Infinity;
  const floor = till ? reserveOf(till.operating, params && params.reserveRatio) : 0;
  const lineCap = (!buy && till)
    ? Math.max(25, Math.round((params ? params.bigTicketFrac : 1) * (till.cash - floor)))
    : Infinity;
  let stock = Math.max(0, view.stock || 0);
  let accepted = 0, paid = 0, unitFirst = 0;
  let tillShort = false, bigTicket = false, outOfStock = false, noFunds = false, noSpace = false;
  while (accepted < qty) {
    if (buy) {
      if (stock <= 0) { outOfStock = true; break; }
      if (accepted >= space) { noSpace = true; break; }
      const unit = Math.max(1, Math.round(
        quote({ ...view, stock }, till ? { cash, operating: till.operating } : null, params).charges * mult));
      if (paid + unit > budget) { noFunds = true; break; }
      if (!unitFirst) unitFirst = unit;
      paid += unit; accepted++; stock--;
    } else {
      const unit = Math.max(1, Math.round(
        quote({ ...view, stock: stock + 1 }, till ? { cash, operating: till.operating } : null, params).pays * mult));
      if (!unitFirst) unitFirst = unit;
      if (paid + unit > lineCap) { bigTicket = true; break; }
      if (cash - floor < unit) { tillShort = true; break; }
      paid += unit; accepted++; stock++; cash -= unit;
    }
  }
  return { accepted, paid, unitFirst, tillShort, bigTicket, outOfStock, noFunds, noSpace, refused: false };
}
// Back-compat thin wrappers (older callers / tests).
function quoteSellLot(view, till, qty, mult, _maxUnit, params) {
  return quoteLot(view, till, qty, "sell", mult, params);
}
function quoteBuyLot(view, till, qty, mult, params, opts) {
  return quoteLot(view, till, qty, "buy", mult, params, opts);
}

root.EconCore = {
  P, fnv, clamp, shopParams,
  operatingCash, reserveOf, tillCapOf, dailyDrawCap,
  baselineDemand, decay, bump, dayCap, targetStock, openingStock,
  quote, quoteLot, quoteSellLot, quoteBuyLot, commissionSuggest,
};
})(typeof globalThis !== "undefined" ? globalThis : self);
