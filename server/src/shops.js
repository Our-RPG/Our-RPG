/* shops.js — the Phase-2 per-town finite stock ledger (audit §7 Phase 2)
 * plus the living till (docs/shopkeeper-economy.md Phase 1).
 * This IS the no-trading economy: players trade through the world. A sale
 * adds provenance-stamped units to the town's shelf; a purchase decrements
 * them. The client's computed base stock (SHOP_STOCK + biome surplus) is the
 * standing floor — the BANK_PERMANENTS pattern lives client-side, so this
 * ledger only ever holds the PLAYER-ADDED supply on top of it. The economy
 * can never starve a new player because the floor never reaches the server.
 *
 * The living till: every town has ONE finite cash balance (shop_till),
 * seeded deterministically (EconCore.operatingCash, so client and worker
 * agree sight unseen). Player sells drain it, purchases refill it, and the
 * daily cron drifts it back toward operating cash — a drained till is a
 * 1–3 day shortage, never a permanent grief. shop_flow holds the town's
 * demand/supply beliefs as lazily-decayed EMAs (closed-form decay on touch;
 * no tick loop ever iterates the world's shops).
 *
 * Trust model: ITEM VALUES ARE CLIENT-SIDE (ITEMS is generated at runtime
 * across the content pipeline), so the worker cannot reprice goods. It
 * protects the SHARED state instead: the till can't go below its reserve or
 * above its cap, one account can only draw a bounded share of a till per
 * day, and belief EMAs saturate at a few times baseline demand. Coins in a
 * player's pocket remain the envelope's problem, as everywhere else.
 *
 * Town key = the client's townKeyOf(x,y) ("cx,cy", market.js) — the same
 * keyspace contracts already use. Units keep the maker's NAME (quality +
 * "Coopered by Rowan" is the whole point), the seller's account for audit,
 * and the maker's rank at sale time (the §8 provenance ratchet). */

import { json, err, readJson, now, authUser, rateLimit } from "./util.js";
import Econ from "./econ-core.js";

const TOWN_KEY = /^-?\d{1,6},-?\d{1,6}$/;
const MAX_LINES = 40;                 // items per trade call
const MAX_QTY = 10000;               // per line
const MAX_TOWN_ITEM_QTY = 50000;     // ledger cap per (town, item)
const MAX_UNITS_LISTED = 8;          // provenance batches shown per item
const MAX_LINE_COINS = 5e6;          // absolute sanity cap on a line's coins
const PRICE_SANITY_MULT = 2;         // accepted per-unit ≤ this × the worker's
                                     // own scarcity-quote mid (see trade() #6)
const RANK_CAP = 32;                 // crafting ranks top out at 32 (combat scale)
const STALE_DAYS = 120;              // unsold player stock quietly rots
const CACHE = { "cache-control": "public, max-age=30" };

const cleanItem = s => {
  const id = String(s || "").slice(0, 60);
  return /^[a-z0-9_]+$/.test(id) ? id : null;
};
const cleanTag = s => {
  const t = String(s || "").slice(0, 20);
  return /^[a-z]+$/.test(t) ? t : null;
};
const coins = v => Math.max(0, Math.min(MAX_LINE_COINS, Math.round(Number(v) || 0)));

// ---- supply shocks (Phase 3) ---------------------------------------------
// Active mods for a town, {tag: {kind, floor, demand, until}}. FAIL-SOFT:
// while migration 0011 is unapplied this returns {} instead of 500ing the
// whole shop API, so deploy order doesn't matter.
async function getMods(env, town, t) {
  try {
    const rows = await env.DB.prepare(
      "SELECT tag, kind, floor_mult, demand_mult, expires_at FROM town_mods WHERE town = ? AND expires_at > ?"
    ).bind(town, t).all();
    const mods = {};
    for (const r of rows.results)
      mods[r.tag] = { kind: r.kind, floor: r.floor_mult, demand: r.demand_mult, until: r.expires_at };
    return mods;
  } catch (e) { return {}; }
}

// The daily event roller's repertoire. floor scales the standing SHELF,
// demand scales believed need — econ-core turns the pair into scarcity (or
// glut) pricing; nothing here touches a price.
const SHOCK_EVENTS = [
  { kind: "caravan_cut",   tags: ["metal", "textile", "tool", "potion"], floor: [0.15, 0.45], demand: [1.2, 1.7] },
  { kind: "mine_trouble",  tags: ["metal", "stone"],                     floor: [0.15, 0.40], demand: [1.3, 1.8] },
  { kind: "blight",        tags: ["food", "raw"],                        floor: [0.20, 0.50], demand: [1.2, 1.6] },
  { kind: "bumper",        tags: ["food", "raw"],                        floor: [2.0, 3.0],   demand: [0.7, 0.9] },
  { kind: "surplus_barge", tags: ["wood", "fuel", "stone"],              floor: [2.0, 3.0],   demand: [0.7, 0.9] },
];
const between = ([lo, hi]) => lo + Math.random() * (hi - lo);

// ---- the finite shelf -----------------------------------------------------
// ONE stock count per (town, item): the shopkeeper's own opening inventory
// plus everything players have sold in. Seeded ONCE, deterministically
// (Econ.openingStock, so the client's untouched-shelf price and the worker's
// seed agree sight unseen); thereafter it only moves on real trades —
// purchases deplete it, player sells replenish it — and NOTHING auto-restocks
// it. Row existence == seeded, so a bought-out item stays at 0 until a player
// sells more. Deltas are applied with a race-safe clamped UPDATE, like the till.

// FAIL-SOFT (like town_mods): while migration 0013 is unapplied the shelf
// reads/writes degrade to "no persistence" (every shelf reads its deterministic
// opening stock) instead of 500ing the shop API, so deploy order never matters.
async function getShelf(env, town, item, t, pp) {
  try {
    const row = await env.DB.prepare(
      "SELECT qty FROM shop_stock WHERE town = ? AND item = ?").bind(town, item).first();
    if (row) return row.qty;
    const open = Econ.openingStock(town, item, pp);
    await env.DB.prepare(
      `INSERT INTO shop_stock (town, item, qty, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(town, item) DO NOTHING`).bind(town, item, open, t).run();
    return open;
  } catch (e) { return Econ.openingStock(town, item, pp); }
}
async function moveShelf(env, town, item, delta, t) {
  try {
    await env.DB.prepare(
      `UPDATE shop_stock SET qty = MAX(0, MIN(?, qty + ?)), updated_at = ?
       WHERE town = ? AND item = ?`
    ).bind(MAX_TOWN_ITEM_QTY, Math.round(delta), t, town, item).run();
  } catch (e) { /* table not yet migrated — stock simply doesn't persist */ }
}

// ---- the till -------------------------------------------------------------

async function getTill(env, town, t, pp) {
  const row = await env.DB.prepare(
    "SELECT cash, operating FROM shop_till WHERE town = ? AND shop = 'town'"
  ).bind(town).first();
  if (row) return row;
  const operating = Econ.operatingCash(town, pp);
  await env.DB.prepare(
    `INSERT INTO shop_till (town, shop, cash, operating, updated_at)
     VALUES (?, 'town', ?, ?, ?) ON CONFLICT(town, shop) DO NOTHING`
  ).bind(town, operating, operating, t).run();
  return { cash: operating, operating };
}

/* Race-safe till move: bounds live in the statement, so two concurrent
 * flushes can never take the cash below reserve or above the cap — at worst
 * one player's payout briefly isn't till-covered, which the bounds absorb. */
async function moveTill(env, town, delta, operating, reserve, t) {
  await env.DB.prepare(
    `UPDATE shop_till SET cash = MAX(?, MIN(?, cash + ?)), updated_at = ?
     WHERE town = ? AND shop = 'town'`
  ).bind(reserve, Econ.tillCapOf(operating), Math.round(delta), t, town).run();
}

/* Coin-amount budget window on the shared rate_limits table (count = coins
 * ATTEMPTED this window). Bounds how much one account can DRAW from one town's
 * till per day — the value-table-free defence of the shared cash. Returns the
 * coins actually GRANTED (the share that fits under the cap).
 *
 * ATOMIC (#7, was TOCTOU): the old form did SELECT used → compute allow →
 * upsert as separate steps, so N concurrent draws all read the same stale
 * `used` and were each granted the full remaining cap — blowing the per-account
 * daily bound. This is now ONE upsert that increments the window counter and
 * RETURNS the post-increment total (mirroring util.rateLimit); the grant is
 * derived from that total, so the increment and the test are a single statement.
 * The counter may overshoot the cap (we always add the full attempted amount) —
 * harmless: once it reaches the cap every later draw derives a grant of 0, and
 * it resets with the window. */
async function takeBudget(env, key, amount, cap, windowSec) {
  const amt = Math.max(0, Math.round(amount));
  if (amt <= 0) return 0;
  const t = now(), winStart = t - (t % (windowSec * 1000));
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits (key, win_start, count) VALUES (?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET " +
    "  count = CASE WHEN rate_limits.win_start = ? THEN rate_limits.count + ? ELSE ? END, " +
    "  win_start = ? " +
    "RETURNING count"
  ).bind(key, winStart, amt, winStart, amt, amt, winStart).first();
  // post = total coins attempted this window (incl. this draw's full amt); the
  // coins that fit under the cap = cap − (post − amt), clamped into [0, amt].
  const post = row ? Number(row.count) : amt;
  return Math.max(0, Math.min(amt, cap - (post - amt)));
}

// ---- flow beliefs ---------------------------------------------------------

async function getFlow(env, town, item, t) {
  const row = await env.DB.prepare(
    `SELECT ema_in, ema_out, day_in, day_out, day_start, updated_at
     FROM shop_flow WHERE town = ? AND item = ?`).bind(town, item).first();
  if (!row) return { in: 0, out: 0, dayIn: 0, dayOut: 0, dayStart: t };
  const dayRolled = t - row.day_start > 864e5;
  return {
    in: Econ.decay(row.ema_in, row.updated_at, t),
    out: Econ.decay(row.ema_out, row.updated_at, t),
    dayIn: dayRolled ? 0 : row.day_in,
    dayOut: dayRolled ? 0 : row.day_out,
    dayStart: dayRolled ? t : row.day_start,
  };
}

async function putFlow(env, town, item, f, t) {
  await env.DB.prepare(
    `INSERT INTO shop_flow (town, item, ema_in, ema_out, day_in, day_out, day_start, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(town, item) DO UPDATE SET ema_in = ?, ema_out = ?,
       day_in = ?, day_out = ?, day_start = ?, updated_at = ?`
  ).bind(town, item, f.in, f.out, f.dayIn, f.dayOut, f.dayStart, t,
         f.in, f.out, f.dayIn, f.dayOut, f.dayStart, t).run();
}

// Fold a traded qty into a belief EMA, saturating at the anti-pump day cap.
function believe(flow, town, item, qty, dir) {
  const cap = Econ.dayCap(town, item);
  const dayKey = dir === "in" ? "dayIn" : "dayOut";
  const counted = Math.max(0, Math.min(qty, cap - flow[dayKey]));
  flow[dayKey] += qty;
  if (counted > 0) flow[dir] = Econ.bump(flow[dir], counted);
}

/* GET /api/shop/stock?town=cx,cy
 * → {items: {id: {qty, units:[{maker, q, rank, qty}]}},  player-sold provenance
 *    stock: {id: qty},                the FINITE shelf count per item (shop's
 *                                     own + player-sold); untouched items are
 *                                     absent — the client seeds them from
 *                                     EconCore.openingStock and prices neutral
 *    flow:  {id: {in, out}},          demand/supply beliefs, decayed to now
 *    till:  {cash, operating},        the town's shared coin
 *    now}
 * Public read: a logged-out player still sees the living shelf. */
export async function stock(req, env, url) {
  const town = String(url.searchParams.get("town") || "");
  if (!TOWN_KEY.test(town)) return err("Bad town key.");
  const t = now();
  const rows = await env.DB.prepare(
    `SELECT item, maker, maker_rank, quality, qty FROM shop_units
     WHERE town = ? AND qty > 0 ORDER BY item, sold_at`
  ).bind(town).all();
  const items = {};
  for (const r of rows.results) {
    const it = (items[r.item] ||= { qty: 0, units: [] });
    it.qty += r.qty;
    if (it.units.length < MAX_UNITS_LISTED)
      it.units.push({ maker: r.maker, q: r.quality, rank: r.maker_rank, qty: r.qty });
  }
  const shelfRows = await env.DB.prepare(
    "SELECT item, qty FROM shop_stock WHERE town = ?").bind(town).all();
  const shelf = {};
  for (const r of shelfRows.results) shelf[r.item] = r.qty;
  const flowRows = await env.DB.prepare(
    "SELECT item, ema_in, ema_out, updated_at FROM shop_flow WHERE town = ?"
  ).bind(town).all();
  const flow = {};
  for (const r of flowRows.results) {
    const fin = Econ.decay(r.ema_in, r.updated_at, t), fout = Econ.decay(r.ema_out, r.updated_at, t);
    if (fin > 0.01 || fout > 0.01) flow[r.item] = { in: fin, out: fout };
  }
  const tillRow = await env.DB.prepare(
    "SELECT cash, operating FROM shop_till WHERE town = ? AND shop = 'town'"
  ).bind(town).first();
  const operating = tillRow ? tillRow.operating : Econ.operatingCash(town, Econ.shopParams(town));
  const till = { cash: tillRow ? tillRow.cash : operating, operating };
  const mods = await getMods(env, town, t);
  return json({ ok: true, town, items, stock: shelf, flow, till, mods, now: t }, 200, CACHE);
}

/* POST /api/shop/trade
 * {town, sells:[{item, qty, paid?, q?, maker?, skill?}], buys:[{item, qty, paid?}]}
 * `paid` is the line's total coins as the client priced it (shared econ-core
 * quote × personal modifiers). Sells GROW the finite shelf (shop_stock) and a
 * provenance batch (shop_units), and DRAIN the till; buys SHRINK the shelf and
 * REFILL the till. The shelf is the single stock the price moves along, so a
 * buy-then-sell round trip lands it — and the price — exactly where it began.
 * The worker reports the shelf count after settling and what the till covered
 * (an over-draw the shared cash won't fund stays with the player; the client
 * reconciles). Lines without `paid` (older clients) move goods but no cash. */
export async function trade(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `shop:${user.id}`, 240, 3600))
    return err("Trading too fast.", 429);
  const b = await readJson(req, 64 * 1024);
  if (!b || !TOWN_KEY.test(String(b.town || ""))) return err("Bad town key.");
  const town = b.town, t = now();
  const sold = {}, bought = {}, paidOut = {};
  const pp = Econ.shopParams(town);          // the town trader's temperament
  const till = await getTill(env, town, t, pp);
  const reserve = Econ.reserveOf(till.operating, pp.reserveRatio);
  let cashAvail = till.cash;            // in-memory during this request
  let tillDelta = 0;
  const flows = new Map();              // item -> flow (loaded once, saved once)
  const flowFor = async item => {
    if (!flows.has(item)) flows.set(item, await getFlow(env, town, item, t));
    return flows.get(item);
  };
  const shelves = new Map();            // item -> current finite shelf (seeded once)
  const shelfDelta = new Map();         // item -> net change to apply (race-safe)
  const shelfFor = async item => {
    if (!shelves.has(item)) shelves.set(item, await getShelf(env, town, item, t, pp));
    return shelves.get(item);
  };
  const moveLocal = (item, d) => {
    shelves.set(item, Math.max(0, (shelves.get(item) || 0) + d));
    shelfDelta.set(item, (shelfDelta.get(item) || 0) + d);
  };
  // maker rank is a per-(user, skill) read that never changes mid-request, so
  // memoize it — a trade selling many lines of the same skill hit the ranks
  // table once per line before.
  const ranks = new Map();              // skill -> maker rank
  const rankFor = async skill => {
    const key = String(skill || "");
    if (!ranks.has(key)) ranks.set(key, await makerRank(env, user.id, key));
    return ranks.get(key);
  };

  for (const line of (Array.isArray(b.sells) ? b.sells : []).slice(0, MAX_LINES)) {
    const item = cleanItem(line?.item);
    const qty = Math.min(MAX_QTY, Math.floor(Number(line?.qty) || 0));
    if (!item || qty <= 0) continue;
    const have = await shelfFor(item);
    const flow = await flowFor(item);
    // the shop always buys (a glutted shelf just pays the floor price — the
    // client walked the curve and knows); the only cap is the shelf's hard
    // ceiling, so players can always keep a town restocked.
    const room = Math.max(0, MAX_TOWN_ITEM_QTY - have);
    let add = Math.min(qty, room);
    // the till only funds what it can afford AND what this account may still
    // draw today — goods beyond that stay with the player (client reconciles).
    // Big-ticket backstop: one line draws at most the trader's appetite for
    // a single kind of stock (the client walk enforces the same rule).
    // #6 the client-dictated per-unit is bounded to a sane multiple of the
    // worker's OWN scarcity quote on the authoritative shelf/till/flow. Item
    // base values are client-side, so the worker can't reprice — it treats the
    // client's per-unit as the value proxy and refuses a payout its own curve
    // won't justify (e.g. full price dumped onto a glutted shelf). This is a
    // bounding clamp, not exact repricing: a single plausibly-priced fake item
    // on a neutral shelf still pays out — the per-account daily-draw cap (#7),
    // the big-ticket line cap and the finite till are the backstops on coin out.
    const rawUnit = add > 0 ? coins(line.paid) / qty : 0;
    const unit = rawUnit > 0
      ? Math.min(rawUnit, PRICE_SANITY_MULT * Econ.quote(
          { value: rawUnit, stock: have, base: Econ.baselineDemand(town, item), emaOut: flow.out },
          { cash: cashAvail, operating: till.operating }, pp).mid)
      : 0;
    let pay = 0;
    if (unit > 0 && add > 0) {
      const lineCap = Math.max(25, Math.round(pp.bigTicketFrac * (cashAvail - reserve)));
      add = Math.min(add, Math.floor((cashAvail - reserve) / unit), Math.floor(lineCap / unit));
      pay = Math.round(add * unit);
      if (pay > 0) {
        const allowed = await takeBudget(env, `draw:${town}:${user.id}`,
          pay, Econ.dailyDrawCap(till.operating), 86400);
        if (allowed < pay) { add = Math.floor(allowed / unit); pay = Math.round(add * unit); }
      }
    }
    if (add <= 0) { sold[item] = (sold[item] || 0); paidOut[item] = (paidOut[item] || 0); continue; }
    cashAvail -= pay; tillDelta -= pay;
    believe(flow, town, item, add, "in");
    moveLocal(item, add);                 // the sold goods join the finite shelf
    // #6 provenance is server-stamped, never client-supplied: the maker is the
    // authenticated seller (seller_id already records the account), and quality
    // is capped at what their SERVER-held crafting rank could plausibly produce
    // (ranks top out at RANK_CAP → quality 0-100). Until a skill has rank data
    // (null) we can't verify, so the plain 0-100 clamp stands (Phase-2 backfill).
    const maker = String(user.username || "").slice(0, 40);
    const rank = await rankFor(line.skill);
    const qCap = rank == null ? 100 : Math.max(0, Math.min(100, Math.round((rank + 2) * 100 / RANK_CAP)));
    const quality = Number.isFinite(line.q) ? Math.max(0, Math.min(qCap, Math.round(line.q))) : null;
    const same = await env.DB.prepare(
      `SELECT id FROM shop_units WHERE town = ? AND item = ? AND maker = ?
       AND quality IS ? AND seller_id = ? LIMIT 1`
    ).bind(town, item, maker, quality, user.id).first();
    if (same) {
      await env.DB.prepare("UPDATE shop_units SET qty = qty + ?, sold_at = ? WHERE id = ?")
        .bind(add, t, same.id).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO shop_units (town, item, qty, maker, maker_rank, quality, seller_id, sold_at)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(town, item, add, maker, rank, quality, user.id, t).run();
    }
    sold[item] = (sold[item] || 0) + add;
    paidOut[item] = (paidOut[item] || 0) + pay;
  }

  for (const line of (Array.isArray(b.buys) ? b.buys : []).slice(0, MAX_LINES)) {
    const item = cleanItem(line?.item);
    let want = Math.min(MAX_QTY, Math.floor(Number(line?.qty) || 0));
    if (!item || want <= 0) continue;
    // #E the finite shelf is the AUTHORITY on how many a buy actually gets, so
    // two concurrent buys of the last unit can't both be served. Read-and-
    // decrement in ONE atomic transaction (a D1 batch is one SQLite txn): the
    // SELECT sees the true current stock and the clamped UPDATE removes up to
    // `want`, so `got` is the shelf's own before→after delta — never a stale
    // read. Fail-soft to the plain read while shop_stock is unmigrated.
    const have = await shelfFor(item);   // seeds the shelf row on first touch
    const flow = await flowFor(item);
    let got = Math.min(want, have);
    try {
      const res = await env.DB.batch([
        env.DB.prepare("SELECT qty FROM shop_stock WHERE town = ? AND item = ?").bind(town, item),
        env.DB.prepare(
          `UPDATE shop_stock SET qty = MAX(0, qty - ?), updated_at = ?
           WHERE town = ? AND item = ?`).bind(want, t, town, item),
      ]);
      const rows = res[0] && res[0].results;
      if (rows && rows.length) got = Math.min(want, Math.max(0, rows[0].qty));
    } catch (e) { /* table not yet migrated — stock simply doesn't persist */ }
    // the DB decrement above is authoritative, so buys do NOT route through
    // shelfDelta/moveShelf (only sells do); just keep the in-memory shelf (the
    // trade's reported stock) in lockstep by the amount actually taken.
    shelves.set(item, Math.max(0, (shelves.get(item) || 0) - got));
    if (got <= 0) { bought[item] = 0; continue; }
    // #6 bound the client-priced per-unit to a sane multiple of the worker's own
    // scarcity quote (see the sell note) before it refills the shared till, so a
    // fake-expensive buy can't pump the town's cash past what the curve allows.
    const rawUnit = coins(line.paid) / want;
    const unit = Math.min(rawUnit, PRICE_SANITY_MULT * Econ.quote(
      { value: rawUnit, stock: have, base: Econ.baselineDemand(town, item), emaOut: flow.out },
      { cash: cashAvail, operating: till.operating }, pp).mid);
    // refill the till for the coin actually spent (server-sane per-unit × the
    // units the shelf truly gave) and feed the demand belief with real sales
    tillDelta += Math.round(unit * got);
    believe(flow, town, item, got, "out");
    // keep provenance tidy: retire the oldest player-sold batches first
    // (cosmetic only — the opening stock lives in shop_stock, not here)
    let dec = got;
    const batches = await env.DB.prepare(
      "SELECT id, qty FROM shop_units WHERE town = ? AND item = ? AND qty > 0 ORDER BY sold_at"
    ).bind(town, item).all();
    for (const batch of batches.results) {
      if (!dec) break;
      const take = Math.min(dec, batch.qty);
      await env.DB.prepare("UPDATE shop_units SET qty = MAX(0, qty - ?) WHERE id = ?")
        .bind(take, batch.id).run();
      dec -= take;
    }
    bought[item] = got;
  }

  if (tillDelta !== 0) await moveTill(env, town, tillDelta, till.operating, reserve, t);
  for (const [item, d] of shelfDelta) if (d !== 0) await moveShelf(env, town, item, d, t);
  for (const [item, flow] of flows) await putFlow(env, town, item, flow, t);

  // Refreshed counts (the authoritative finite shelf) for every touched item.
  // The post-trade shelf already lives in `shelves`: sells keep it in lockstep via
  // moveLocal (same delta moveShelf applies, both clamping to the shelf's room),
  // and buys subtract exactly what their authoritative DB decrement took. No need
  // to re-SELECT every item we just wrote.
  const touched = [...new Set([...Object.keys(sold), ...Object.keys(bought)])];
  const stockNow = {}, flowNow = {};
  for (const item of touched) {
    stockNow[item] = shelves.get(item) || 0;
    const f = flows.get(item);
    if (f) flowNow[item] = { in: f.in, out: f.out };
  }
  const cashNow = Math.max(reserve,
    Math.min(Econ.tillCapOf(till.operating), till.cash + tillDelta));
  return json({ ok: true, town, sold, bought, paid: paidOut, stock: stockNow,
                flow: flowNow, till: { cash: cashNow, operating: till.operating }, now: t });
}

/* The §8 provenance ratchet: stamp units with the maker's rank AT SALE TIME
 * (a rank-32 blade stays a rank-32 artifact even if the smith later slips).
 * Ranks arrive with Phase-2 rank rows; null until that skill has data. */
async function makerRank(env, userId, skill) {
  const s = String(skill || "").slice(0, 40);
  if (!s) return null;
  const row = await env.DB.prepare(
    "SELECT level FROM ranks WHERE user_id = ? AND skill = ?"
  ).bind(userId, s).first();
  return row?.level ?? null;
}

/* Cron sweep: unsold player stock past STALE_DAYS quietly leaves the shelf
 * (the shopkeeper "sold it on") so dead towns don't accrete forever. */
export async function sweepStale(env) {
  await env.DB.prepare("DELETE FROM shop_units WHERE qty <= 0 OR sold_at < ?")
    .bind(now() - STALE_DAYS * 864e5).run();
}

/* Daily till + belief housekeeping (rides the same cron): tills drift a
 * quarter of the way back toward operating cash (the shopkeeper banks
 * profit / draws on savings overnight — a drained till is a 1–3 day
 * shortage, not a permanent grief), and long-dead belief rows vanish so the
 * tables stay sparse forever. */
export async function dailyTick(env) {
  const t = now();
  await env.DB.prepare(
    "UPDATE shop_till SET cash = cash + (operating - cash) / 4, updated_at = ? WHERE cash <> operating"
  ).bind(t).run();
  await env.DB.prepare(
    "DELETE FROM shop_flow WHERE updated_at < ? AND ema_in < 0.05 AND ema_out < 0.05"
  ).bind(t - 30 * 864e5).run();
  await rollShocks(env, t);
}

/* The daily event roller: expire finished shocks, then — on towns that
 * actually trade (they have a till row) and aren't already shocked — roll a
 * small chance of a new one. Bounded: at most ~15% of trading towns carry a
 * shock at once. Fail-soft while migration 0011 is unapplied. */
export async function rollShocks(env, t) {
  try {
    await env.DB.prepare("DELETE FROM town_mods WHERE expires_at <= ?").bind(t).run();
    const towns = (await env.DB.prepare("SELECT town FROM shop_till LIMIT 500").all())
      .results.map(r => r.town);
    if (!towns.length) return;
    const active = (await env.DB.prepare(
      "SELECT town, COUNT(*) AS n FROM town_mods GROUP BY town").all()).results;
    const shocked = new Set(active.map(r => r.town));
    let total = active.reduce((s, r) => s + r.n, 0);
    const cap = Math.max(2, Math.ceil(towns.length * 0.15));
    for (const town of towns) {
      if (total >= cap) break;
      if (shocked.has(town) || Math.random() > 0.08) continue;
      const ev = SHOCK_EVENTS[Math.floor(Math.random() * SHOCK_EVENTS.length)];
      const tag = ev.tags[Math.floor(Math.random() * ev.tags.length)];
      const days = 3 + Math.floor(Math.random() * 5);       // 3–7 days
      await env.DB.prepare(
        `INSERT INTO town_mods (town, tag, kind, floor_mult, demand_mult, started_at, expires_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(town, tag) DO NOTHING`
      ).bind(town, tag, ev.kind, +between(ev.floor).toFixed(2), +between(ev.demand).toFixed(2),
             t, t + days * 864e5).run();
      total++;
    }
  } catch (e) {}
}

/* Story events by hand (or future server-authoritative quest hooks):
 * POST /api/admin/shopevent {town, tag, kind, floor_mult, demand_mult, days}
 * — floor_mult/demand_mult clamped sane; days ≤ 30; {clear: true} removes.
 * Admin-gated in index.js routing (admin.setShopEvent wraps this). */
export async function setShockEvent(env, b) {
  const town = String(b.town || "");
  const tag = cleanTag(b.tag);
  if (!TOWN_KEY.test(town) || !tag) return { error: "Need {town: 'cx,cy', tag}." };
  const t = now();
  if (b.clear) {
    await env.DB.prepare("DELETE FROM town_mods WHERE town = ? AND tag = ?").bind(town, tag).run();
    return { ok: true, cleared: true };
  }
  const kind = String(b.kind || "caravan_cut").slice(0, 32);
  const floor = Math.min(4, Math.max(0.05, Number(b.floor_mult) || 1));
  const demand = Math.min(3, Math.max(0.3, Number(b.demand_mult) || 1));
  const days = Math.min(30, Math.max(1, Number(b.days) || 5));
  await env.DB.prepare(
    `INSERT INTO town_mods (town, tag, kind, floor_mult, demand_mult, started_at, expires_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(town, tag) DO UPDATE SET kind = ?, floor_mult = ?, demand_mult = ?, expires_at = ?`
  ).bind(town, tag, kind, floor, demand, t, t + days * 864e5,
         kind, floor, demand, t + days * 864e5).run();
  return { ok: true, town, tag, kind, floor_mult: floor, demand_mult: demand, days };
}
