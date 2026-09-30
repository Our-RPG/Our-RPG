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
const STALE_DAYS = 120;              // unsold player stock quietly rots
const CACHE = { "cache-control": "public, max-age=30" };

const cleanItem = s => {
  const id = String(s || "").slice(0, 60);
  return /^[a-z0-9_]+$/.test(id) ? id : null;
};
const coins = v => Math.max(0, Math.min(MAX_LINE_COINS, Math.round(Number(v) || 0)));

// ---- the till -------------------------------------------------------------

async function getTill(env, town, t) {
  const row = await env.DB.prepare(
    "SELECT cash, operating FROM shop_till WHERE town = ? AND shop = 'town'"
  ).bind(town).first();
  if (row) return row;
  const operating = Econ.operatingCash(town);
  await env.DB.prepare(
    `INSERT INTO shop_till (town, shop, cash, operating, updated_at)
     VALUES (?, 'town', ?, ?, ?) ON CONFLICT(town, shop) DO NOTHING`
  ).bind(town, operating, operating, t).run();
  return { cash: operating, operating };
}

/* Race-safe till move: bounds live in the statement, so two concurrent
 * flushes can never take the cash below reserve or above the cap — at worst
 * one player's payout briefly isn't till-covered, which the bounds absorb. */
async function moveTill(env, town, delta, operating, t) {
  await env.DB.prepare(
    `UPDATE shop_till SET cash = MAX(?, MIN(?, cash + ?)), updated_at = ?
     WHERE town = ? AND shop = 'town'`
  ).bind(Econ.reserveOf(operating), Econ.tillCapOf(operating), Math.round(delta), t, town).run();
}

/* Coin-amount budget window on the shared rate_limits table (count = coins).
 * Bounds how much one account can DRAW from one town's till per day — the
 * value-table-free defence of the shared cash. Returns coins allowed. */
async function takeBudget(env, key, amount, cap, windowSec) {
  const t = now(), winStart = t - (t % (windowSec * 1000));
  const row = await env.DB.prepare(
    "SELECT win_start, count FROM rate_limits WHERE key = ?").bind(key).first();
  const used = row && row.win_start === winStart ? row.count : 0;
  const allow = Math.max(0, Math.min(amount, cap - used));
  if (allow > 0) {
    await env.DB.prepare(
      `INSERT INTO rate_limits (key, win_start, count) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN win_start = ? THEN count + ? ELSE ? END,
         win_start = ?`
    ).bind(key, winStart, allow, winStart, allow, allow, winStart).run();
  }
  return allow;
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
 * → {items: {id: {qty, units:[{maker, q, rank, qty}]}},
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
  const operating = tillRow ? tillRow.operating : Econ.operatingCash(town);
  const till = { cash: tillRow ? tillRow.cash : operating, operating };
  return json({ ok: true, town, items, flow, till, now: t }, 200, CACHE);
}

/* POST /api/shop/trade
 * {town, sells:[{item, qty, paid?, q?, maker?, skill?}], buys:[{item, qty, paid?}]}
 * `paid` is the line's total coins as the client priced it (shared econ-core
 * quote × personal modifiers). Sells append to the shelf (merging batches by
 * maker+quality) and DRAIN the till; buys decrement oldest-first and REFILL
 * it. The worker reports what the ledger/till actually covered — the
 * remainder was floor stock or an over-draw the shared state won't fund.
 * Lines without `paid` (older clients) move goods but no till cash. */
export async function trade(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `shop:${user.id}`, 240, 3600))
    return err("Trading too fast.", 429);
  const b = await readJson(req, 64 * 1024);
  if (!b || !TOWN_KEY.test(String(b.town || ""))) return err("Bad town key.");
  const town = b.town, t = now();
  const sold = {}, bought = {}, paidOut = {};
  const till = await getTill(env, town, t);
  const reserve = Econ.reserveOf(till.operating);
  let cashAvail = till.cash;            // in-memory during this request
  let tillDelta = 0;
  const flows = new Map();              // item -> flow (loaded once, saved once)
  const flowFor = async item => {
    if (!flows.has(item)) flows.set(item, await getFlow(env, town, item, t));
    return flows.get(item);
  };

  for (const line of (Array.isArray(b.sells) ? b.sells : []).slice(0, MAX_LINES)) {
    const item = cleanItem(line?.item);
    const qty = Math.min(MAX_QTY, Math.floor(Number(line?.qty) || 0));
    if (!item || qty <= 0) continue;
    const have = await env.DB.prepare(
      "SELECT COALESCE(SUM(qty),0) AS n FROM shop_units WHERE town = ? AND item = ?"
    ).bind(town, item).first();
    const flow = await flowFor(item);
    // refusal backstop (the client enforces the real curve incl. its floor):
    // the shelf already holds several times what this town believes it moves
    const target = Econ.targetStock(0, flow.out, Econ.baselineDemand(town, item));
    const refuse = (have?.n || 0) >= Math.max(24, Econ.P.refuseAt * target);
    const room = refuse ? 0 : Math.max(0, MAX_TOWN_ITEM_QTY - (have?.n || 0));
    let add = Math.min(qty, room);
    // the till only funds what it can afford AND what this account may still
    // draw today — goods beyond that stay with the player (client reconciles)
    const unit = add > 0 ? coins(line.paid) / qty : 0;
    let pay = 0;
    if (unit > 0 && add > 0) {
      add = Math.min(add, Math.floor((cashAvail - reserve) / unit));
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
    const maker = String(line.maker || user.username).slice(0, 40);
    const quality = Number.isFinite(line.q) ? Math.max(0, Math.min(100, Math.round(line.q))) : null;
    const rank = await makerRank(env, user.id, line.skill);
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
    // the FULL purchase (floor stock included — the shopkeeper's own shelf
    // earning coin) refills the till and feeds demand beliefs; the ledger
    // walk below only covers the player-stocked units
    tillDelta += coins(line.paid);
    believe(await flowFor(item), town, item, want, "out");
    const batches = await env.DB.prepare(
      "SELECT id, qty FROM shop_units WHERE town = ? AND item = ? AND qty > 0 ORDER BY sold_at"
    ).bind(town, item).all();
    let got = 0;
    for (const batch of batches.results) {
      if (!want) break;
      const take = Math.min(want, batch.qty);
      await env.DB.prepare("UPDATE shop_units SET qty = qty - ? WHERE id = ?")
        .bind(take, batch.id).run();
      want -= take; got += take;
    }
    bought[item] = got;
  }

  if (tillDelta !== 0) await moveTill(env, town, tillDelta, till.operating, t);
  for (const [item, flow] of flows) await putFlow(env, town, item, flow, t);

  // Refreshed counts for every item the trade touched.
  const touched = [...new Set([...Object.keys(sold), ...Object.keys(bought)])];
  const stockNow = {}, flowNow = {};
  for (const item of touched) {
    const row = await env.DB.prepare(
      "SELECT COALESCE(SUM(qty),0) AS n FROM shop_units WHERE town = ? AND item = ? AND qty > 0"
    ).bind(town, item).first();
    stockNow[item] = row?.n || 0;
    const f = flows.get(item);
    if (f) flowNow[item] = { in: f.in, out: f.out };
  }
  const cashNow = Math.max(Econ.reserveOf(till.operating),
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
}
