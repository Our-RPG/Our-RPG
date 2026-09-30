// ===== Taiao — shop stock ledger sync (Phase 2: the no-trading economy) =====
// Shops carry what players sold. The server ledger (server/src/shops.js)
// holds only the PLAYER-ADDED units per town — the client's computed base
// stock (SHOP_STOCK + biome surplus) is the standing floor, BANK_PERMANENTS
// style, so staples are always buyable and a new player can never starve.
//
// The living till (docs/shopkeeper-economy.md): alongside the shelf, each
// town syncs a finite CASH balance and per-item demand/supply beliefs
// (lazily-decayed EMAs). market.js prices everything through the shared
// EconCore engine over this state — the same math the worker runs when it
// settles a flushed trade, so every player at a stall sees the same market.
//
// Trades queue locally and flush async (offline play loses nothing); logged
// out or in DEV_MODE the module is inert and EconCore's neutral state makes
// shops price exactly as the legacy formulas did.
"use strict";

(function () {
  const DEV = typeof DEV_MODE !== "undefined" && DEV_MODE;
  const QUEUE_KEY = "taiao_tradequeue_v1";
  const STOCK_TTL = 90e3;
  const noop = { ensureStock: () => null, qty: () => 0, units: () => [], items: () => ({}),
    flow: () => null, till: () => null, noteSell: () => {}, noteBuy: () => {},
    status: () => ({ enabled: false }) };
  if (DEV) { window.ShopSync = noop; return; }

  const live = () => typeof Server !== "undefined" && Server.enabled() && Server.logged();

  let queue = [];                        // [{town, sells:[], buys:[]}]
  try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]") || []; } catch (e) {}
  const persistQueue = () => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch (e) {} };

  const stocks = new Map();              // town -> {items, flow, till, at, fetching}

  // ---------- reads (market.js render + price formulas) ----------
  function ensureStock(town) {
    if (!town || !live()) return null;
    let s = stocks.get(town);
    if (!s || (!s.fetching && Date.now() - s.at > STOCK_TTL)) {
      s = s || { items: null, flow: null, till: null, at: 0 };
      s.fetching = true;
      stocks.set(town, s);
      Server.call("/api/shop/stock?town=" + encodeURIComponent(town)).then(r => {
        s.fetching = false;
        if (!r || !r.ok) return;
        s.items = r.items || {}; s.flow = r.flow || {}; s.till = r.till || null;
        s.at = Date.now();
        // repaint an open market so player stock appears without a reopen
        try {
          if (typeof activeMarket !== "undefined" && activeMarket &&
              activeMarket.townKey === town && typeof renderMarket === "function") renderMarket();
        } catch (e) {}
      });
    }
    return s.items;
  }
  const entry = (town, id) => { const it = stocks.get(town); return it && it.items && it.items[id] || null; };
  const qty = (town, id) => (entry(town, id) || {}).qty || 0;
  const units = (town, id) => (entry(town, id) || {}).units || [];
  const items = town => { const s = stocks.get(town); return (s && s.items) || {}; };

  // Demand/supply beliefs, decayed to now (EconCore closed-form — the same
  // decay the worker applies, so both sides read the same number).
  function flow(town, id) {
    const s = stocks.get(town);
    const f = s && s.flow && s.flow[id];
    if (!f || typeof EconCore === "undefined") return f || null;
    return { in: EconCore.decay(f.in, s.at, Date.now()),
             out: EconCore.decay(f.out, s.at, Date.now()) };
  }
  // The town's cash. Null until the first sync (EconCore treats null as
  // neutral, i.e. legacy prices) — never guessed, so prices only bend once
  // the shared truth has actually arrived.
  function till(town) { const s = stocks.get(town); return (s && s.till) || null; };

  // ---------- writes (choke-point notes from market.js) ----------
  function lineFor(town) {
    let l = queue.find(x => x.town === town);
    if (!l) { l = { town, sells: [], buys: [] }; queue.push(l); }
    return l;
  }
  // Optimistic till move so repeated dumps between flushes see the cash
  // drain (and offers fall) immediately; server truth overwrites on flush.
  function tillMove(town, delta) {
    const s = stocks.get(town);
    if (!s || !s.till || typeof EconCore === "undefined") return;
    s.till.cash = Math.max(EconCore.reserveOf(s.till.operating),
      Math.min(EconCore.tillCapOf(s.till.operating), s.till.cash + delta));
  }
  function noteSell(town, id, n, q, maker, skill, paid) {
    if (!town || !n || DEV) return;
    const l = lineFor(town);
    const same = l.sells.find(s => s.item === id && s.q === q && s.maker === maker);
    if (same) { same.qty += n; same.paid = (same.paid || 0) + (paid || 0); }
    else l.sells.push({ item: id, qty: n, q: q ?? null, maker: maker || null,
                        skill: skill || null, paid: paid || 0 });
    // optimistic: the shelf shows your goods immediately, the till pays now
    const s = stocks.get(town);
    if (s && s.items) (s.items[id] ||= { qty: 0, units: [] }).qty += n;
    tillMove(town, -(paid || 0));
    persistQueue(); soonFlush();
  }
  function noteBuy(town, id, n, paid) {
    if (!town || !n || DEV) return;
    const l = lineFor(town);
    const same = l.buys.find(b => b.item === id);
    if (same) { same.qty += n; same.paid = (same.paid || 0) + (paid || 0); }
    else l.buys.push({ item: id, qty: n, paid: paid || 0 });
    const e = entry(town, id);
    if (e) e.qty = Math.max(0, e.qty - n);
    tillMove(town, paid || 0);
    persistQueue(); soonFlush();
  }

  // ---------- flush ----------
  let flushing = false, flushTimer = null;
  const soonFlush = () => { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 2500); };
  async function flush() {
    if (flushing || !live() || !queue.length) return;
    flushing = true;
    try {
      while (queue.length) {
        const l = queue[0];
        const r = await Server.call("/api/shop/trade", { body: l });
        if (!r || !r.ok) break;              // kept queued; retried later
        queue.shift();
        const s = stocks.get(l.town);
        if (s && s.items && r.stock)
          for (const [id, n] of Object.entries(r.stock))
            (s.items[id] ||= { qty: 0, units: [] }).qty = n;
        if (s && r.till) s.till = r.till;
        if (s && r.flow) { s.flow = s.flow || {}; Object.assign(s.flow, r.flow); }
      }
      persistQueue();
    } catch (e) {} finally { flushing = false; }
  }
  setInterval(flush, 20e3);
  addEventListener("beforeunload", persistQueue);

  window.ShopSync = {
    ensureStock, qty, units, items, flow, till, noteSell, noteBuy,
    status: () => ({ enabled: true, live: live(), queued: queue.length }),
  };
})();
