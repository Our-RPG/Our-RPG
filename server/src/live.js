/* live.js — real-time presence (Phase 3: we can SEE each other).
 * One Durable Object per world ZONE (the 15000²-tile named blocks of
 * features.js — NOT regionsync's little 256² ledger cells) holds a
 * hibernatable WebSocket per connected player and relays:
 *
 *   hello/roster/join/leave   who is here, what they look like
 *   m / tp                    tile steps (with duration, so remotes replay
 *                             the exact interpolation) and teleports
 *   s / a                     appearance (outfit/character) and action state
 *   e                         discrete deeds: kill, shop buy/sell
 *   n                         instant node/decor depletion (a VISUAL courier —
 *                             the RegionLedger stays the authority; its pull
 *                             corrects anything this raced)
 *   chat / t*                 public chat and player-to-player trading — the
 *                             protocol ships NOW but both are refused unless
 *                             env LIVE_CHAT / LIVE_TRADE = "on" (moderation
 *                             isn't staffed yet; flip the vars to launch,
 *                             no client rebuild needed)
 *
 * The DO relays, it does not simulate: every client runs its own world and
 * the plausibility envelope (envelope.js) remains the anti-cheat line. The
 * worker (connect below) authenticates the session and forwards with trusted
 * ?u=&n= params — the DO trusts its caller, like region.js.
 *
 * Hibernation: per-socket meta lives in the attachment (survives), volatile
 * state (position, appearance) lives in this.p (doesn't). After a wake the
 * first message from a socket we don't know triggers a {t:"sync"} nudge and
 * the client re-introduces itself. Nothing here touches storage. */

const MAX_CONNS = 200;            // per zone — a bound, not a target
const MAX_MSG_BYTES = 2048;
const CHAT_MAX_CHARS = 240;
const NAME_MAX = 24;
// public chat is PROXIMITY: only players within the speaker's full-zoom-out
// view range hear them (client viewRadius() peaks at ~77 tiles at camZoom 3.0,
// render3d.js:764). A zone can be far bigger, so a shout never crosses it.
const CHAT_RADIUS = 80;

const num = (v, lim = 1e7) => {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= lim ? n : 0;
};
const str = (v, max) => String(v == null ? "" : v).slice(0, max);
// same shared-delta shape the RegionLedger accepts (region.js TYPES)
const NODE_KEY = /^(node|decor):-?\d{1,7},-?\d{1,7}$|^heat:-?\d{1,7},-?\d{1,7},\d{1,2}$/;
const ACT_KINDS = new Set(["gather", "combat", "craft", "farm", "agility"]);
const EVENT_KINDS = new Set(["kill", "buy", "sell"]);
const TRADE_TYPES = new Set(["ti", "to", "ta", "tc"]); // invite/offer/accept/cancel

export class LiveZone {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.p = new Map(); // ws -> {id,name,hello,x,y,lvl,clvl,character,outfit,act,tokens,tAt,nudged}
    // live trade sessions between two players in this zone, keyed by the sorted
    // id pair. Authoritative: the DO holds each side's offer + accept flag and
    // only ever commits both offers together (see commitTrade). Volatile — a
    // committed-but-unclaimed swap is persisted to ctx.storage so a client that
    // drops mid-commit re-claims it on its next hello (recoverTrades).
    this.trades = new Map();
    // heartbeats answered by the runtime without waking a hibernated DO
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  async fetch(req) {
    if ((req.headers.get("upgrade") || "").toLowerCase() !== "websocket")
      return new Response("Expected a WebSocket.", { status: 426 });
    const url = new URL(req.url);
    const id = Number(url.searchParams.get("u")) | 0;
    const name = str(url.searchParams.get("n"), NAME_MAX) || "player" + id;
    if (!id) return new Response("No user.", { status: 400 });
    const socks = this.ctx.getWebSockets();
    if (socks.length >= MAX_CONNS) return new Response("Zone is full.", { status: 503 });
    // one live body per account per zone: a second tab (or a reconnect the
    // server hasn't noticed dying yet) replaces the first
    for (const ws of socks) {
      const at = this.attach(ws);
      if (at && at.id === id) {
        this.p.delete(ws);
        try { ws.close(4000, "replaced"); } catch (e) {}
        this.bcast({ t: "leave", id }, ws);
      }
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, name });
    // join is announced when the client introduces itself with "hello"
    return new Response(null, {
      status: 101, webSocket: client,
      // echo the app subprotocol — the browser fails the handshake without it
      // (the client offers ["taiao-live", "tk.<token>"]; see connect below)
      headers: { "sec-websocket-protocol": "taiao-live" },
    });
  }

  attach(ws) { try { return ws.deserializeAttachment(); } catch (e) { return null; } }

  state(ws) {
    let st = this.p.get(ws);
    if (!st) {
      const at = this.attach(ws);
      if (!at) return null;
      st = { id: at.id, name: at.name, hello: false, nudged: false,
             x: 0, y: 0, lvl: 0, clvl: 0, character: null, outfit: "", act: null,
             tokens: 30, tAt: Date.now() };
      this.p.set(ws, st);
    }
    return st;
  }

  pub(st) {
    return { id: st.id, name: st.name, x: st.x, y: st.y, lvl: st.lvl, clvl: st.clvl,
             character: st.character, outfit: st.outfit, act: st.act };
  }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }

  bcast(obj, except) {
    const msg = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(msg); } catch (e) {}
    }
  }

  sendTo(userId, obj) {
    for (const [ws, st] of this.p)
      if (st.id === userId) { this.send(ws, obj); return true; }
    return false;
  }

  // proximity broadcast: everyone (the origin included) whose last-known
  // position is within `radius` tiles of the origin. Uses this.p positions,
  // kept fresh by every m/tp; a peer we haven't heard a position from yet
  // (post-wake) simply doesn't hear it until they move.
  bcastNear(origin, obj, radius) {
    const msg = JSON.stringify(obj);
    for (const [ws, st] of this.p) {
      if (!st.hello) continue;
      if (Math.abs(st.x - origin.x) <= radius && Math.abs(st.y - origin.y) <= radius) {
        try { ws.send(msg); } catch (e) {}
      }
    }
  }

  // ---- authoritative trade escrow -----------------------------------------
  // A trade record: { key, ids:[x,y], offers:{[uid]:[[id,qty]...]}, acc:{[uid]:bool} }.
  // ANY offer change voids BOTH accepts, so a swap can only commit against the
  // exact offers both sides currently see — no "swap something out after they
  // agreed" race. WebSocket messages are ordered per connection and processed
  // one at a time here, so the reset-on-change rule is race-safe without seqs.
  tradeKey(a, b) { return Math.min(a, b) + "-" + Math.max(a, b); }
  getTrade(a, b) {
    const key = this.tradeKey(a, b);
    let tr = this.trades.get(key);
    if (!tr) {
      tr = { key, ids: [a, b], offers: {}, acc: {} };
      tr.offers[a] = []; tr.offers[b] = [];
      tr.acc[a] = false; tr.acc[b] = false;
      this.trades.set(key, tr);
    }
    return tr;
  }
  async commitTrade(tr) {
    const [x, y] = tr.ids;
    const tid = crypto.randomUUID();
    const rec = { tid, x, y, giveX: tr.offers[x] || [], giveY: tr.offers[y] || [],
                  ackX: false, ackY: false, at: Date.now() };
    this.trades.delete(tr.key);
    // persist BEFORE handing out the commit, so a client that acks can be found
    try { await this.ctx.storage.put("trade:" + tid, rec); } catch (e) {}
    this.sendTo(x, { t: "tcommit", tid, give: rec.giveX, get: rec.giveY, peerId: y });
    this.sendTo(y, { t: "tcommit", tid, give: rec.giveY, get: rec.giveX, peerId: x });
  }
  async ackTrade(uid, tid) {
    try {
      const rec = await this.ctx.storage.get("trade:" + tid);
      if (!rec) return;
      if (uid === rec.x) rec.ackX = true;
      if (uid === rec.y) rec.ackY = true;
      if (rec.ackX && rec.ackY) await this.ctx.storage.delete("trade:" + tid);
      else await this.ctx.storage.put("trade:" + tid, rec);
    } catch (e) {}
  }
  async recoverTrades(ws, uid) {
    try {
      const list = await this.ctx.storage.list({ prefix: "trade:" });
      const stale = Date.now() - 6 * 3600e3;
      for (const [k, rec] of list) {
        if (rec.at < stale) { await this.ctx.storage.delete(k); continue; }
        if (rec.x === uid && !rec.ackX)
          this.send(ws, { t: "tcommit", tid: rec.tid, give: rec.giveX, get: rec.giveY, peerId: rec.y });
        else if (rec.y === uid && !rec.ackY)
          this.send(ws, { t: "tcommit", tid: rec.tid, give: rec.giveY, get: rec.giveX, peerId: rec.x });
      }
    } catch (e) {}
  }

  webSocketMessage(ws, msg) {
    if (typeof msg !== "string" || msg.length > MAX_MSG_BYTES) return;
    const st = this.state(ws);
    if (!st) return;
    // token bucket: 30 burst, 12/s refill — brisk play (a step every ~150 ms
    // plus action chatter) stays well inside; a flooder gets cut off
    const t = Date.now();
    st.tokens = Math.min(30, st.tokens + (t - st.tAt) * 0.012);
    st.tAt = t;
    if (--st.tokens < 0) {
      this.p.delete(ws);
      try { ws.close(4001, "too fast"); } catch (e) {}
      this.bcast({ t: "leave", id: st.id });
      return;
    }
    let m;
    try { m = JSON.parse(msg); } catch (e) { return; }
    if (!m || typeof m.t !== "string") return;

    if (m.t === "hello") {
      st.x = num(m.x); st.y = num(m.y); st.lvl = num(m.lvl, 40) | 0;
      st.clvl = num(m.clvl, 99) | 0;
      st.character = m.character == null ? null : num(m.character, 999) | 0;
      st.outfit = str(m.outfit, 48);
      st.hello = true;
      const roster = [];
      for (const [ows, os] of this.p)
        if (ows !== ws && os.hello) roster.push(this.pub(os));
      this.send(ws, { t: "roster", players: roster,
                      chat: this.env.LIVE_CHAT === "on",
                      trade: this.env.LIVE_TRADE === "on" });
      // re-hellos after a hibernation wake re-announce too — join is an
      // idempotent upsert client-side
      this.bcast({ t: "join", p: this.pub(st) }, ws);
      // hand back any committed-but-unclaimed swap this player dropped before
      // acking (disconnect mid-trade) — the client re-applies idempotently
      if (this.env.LIVE_TRADE === "on") this.recoverTrades(ws, st.id);
      return;
    }

    // anything else from a socket we haven't heard hello from (a wake wiped
    // this.p, or messages raced the handshake): nudge it to re-introduce
    if (!st.hello) {
      if (!st.nudged) { st.nudged = true; this.send(ws, { t: "sync" }); }
      return;
    }

    switch (m.t) {
      case "m": {   // tile step: replay the exact interpolation remotely
        const fx = num(m.fx), fy = num(m.fy), tx = num(m.tx), ty = num(m.ty);
        if (Math.abs(tx - fx) > 1.5 || Math.abs(ty - fy) > 1.5) return; // steps are adjacent tiles
        const dur = Math.min(5000, Math.max(60, num(m.dur, 5000) || 260));
        st.x = tx; st.y = ty; st.lvl = num(m.lvl, 40) | 0;
        if (m.clvl != null) st.clvl = num(m.clvl, 99) | 0;
        this.bcast({ t: "m", id: st.id, fx, fy, tx, ty, dur,
                     d8: str(m.d8, 10), lvl: st.lvl, clvl: st.clvl }, ws);
        return;
      }
      case "tp": {  // teleport/respawn/door — discontinuous, remotes snap
        st.x = num(m.x); st.y = num(m.y); st.lvl = num(m.lvl, 40) | 0;
        if (m.clvl != null) st.clvl = num(m.clvl, 99) | 0;
        this.bcast({ t: "tp", id: st.id, x: st.x, y: st.y,
                     d8: str(m.d8, 10), lvl: st.lvl, clvl: st.clvl }, ws);
        return;
      }
      case "s": {   // appearance change
        st.character = m.character == null ? null : num(m.character, 999) | 0;
        st.outfit = str(m.outfit, 48);
        this.bcast({ t: "s", id: st.id, character: st.character, outfit: st.outfit }, ws);
        return;
      }
      case "a": {   // action state: k=null means "stopped doing the thing"
        const k = m.k && ACT_KINDS.has(m.k) ? m.k : null;
        st.act = k;
        this.bcast({ t: "a", id: st.id, k }, ws);
        return;
      }
      case "e": {   // discrete deed — a visible moment, not an authority claim
        if (!EVENT_KINDS.has(m.k)) return;
        this.bcast({ t: "e", id: st.id, k: m.k, item: str(m.item, 64),
                     mon: str(m.mon, 64), n: num(m.n, 1e6) | 0 }, ws);
        return;
      }
      case "n": {   // instant shared-mutation courier (ledger stays canonical)
        const k = str(m.k, 40);
        if (!NODE_KEY.test(k)) return;
        let v = null;
        if (m.v != null) {
          try { if (JSON.stringify(m.v).length > 300) return; } catch (e) { return; }
          v = m.v;
        }
        this.bcast({ t: "n", id: st.id, k, v, e: num(m.e, 4e15) }, ws);
        return;
      }
      case "chat": {
        if (this.env.LIVE_CHAT !== "on")
          return this.send(ws, { t: "err", code: "chat-disabled" });
        // strip control characters; length-cap; empty after that = drop
        const text = str(m.text, CHAT_MAX_CHARS).replace(/[\x00-\x1f\x7f]/g, " ").trim();
        if (!text) return;
        // proximity only: heard within CHAT_RADIUS tiles of the speaker
        this.bcastNear(st, { t: "chat", id: st.id, name: st.name, text }, CHAT_RADIUS);
        return;
      }
      case "tack": {   // "I applied that committed swap" — lets us drop the record
        if (this.env.LIVE_TRADE !== "on") return;
        const tid = str(m.tid, 64);
        if (tid) this.ackTrade(st.id, tid);
        return;
      }
      case "ti": case "to": case "ta": case "tc": {   // player trading (authoritative)
        if (this.env.LIVE_TRADE !== "on")
          return this.send(ws, { t: "err", code: "trade-disabled" });
        const to = num(m.to, 1e12) | 0;
        if (!to || to === st.id) return;
        if (m.t === "ti") {   // invite/handshake — pure relay
          this.sendTo(to, { t: "ti", id: st.id, name: st.name });
          return;
        }
        if (m.t === "tc") {   // cancel — drop any session, tell the peer
          this.trades.delete(this.tradeKey(st.id, to));
          this.sendTo(to, { t: "tc", id: st.id });
          return;
        }
        if (m.t === "to") {   // offer: [[itemId, qty], ...] — small and shallow
          if (!Array.isArray(m.items) || m.items.length > 24) return;
          const items = m.items.map(it => [str(it && it[0], 64), Math.max(1, num(it && it[1], 1e6) | 0)])
            .filter(it => it[0]);
          const tr = this.getTrade(st.id, to);
          tr.offers[st.id] = items;
          tr.acc[st.id] = false; tr.acc[to] = false;   // any change voids both accepts
          this.sendTo(to, { t: "to", id: st.id, name: st.name, items });
          return;
        }
        if (m.t === "ta") {   // accept the peer's CURRENT offer
          const tr = this.trades.get(this.tradeKey(st.id, to));
          if (!tr) return;
          tr.acc[st.id] = true;
          this.sendTo(to, { t: "ta", id: st.id });
          const [x, y] = tr.ids;
          if (tr.acc[x] && tr.acc[y]) this.commitTrade(tr);   // both agreed → swap
          return;
        }
        return;
      }
    }
  }

  webSocketClose(ws) { this.gone(ws); }
  webSocketError(ws) { this.gone(ws); }
  gone(ws) {
    const st = this.p.get(ws);
    this.p.delete(ws);
    if (st && st.hello) this.bcast({ t: "leave", id: st.id });
  }
}

// ---- worker-side route (runs in index.js, not in the DO) ------------------

import { err, authToken, rateLimit } from "./util.js";

const ZONE_KEY = /^-?\d{1,4},-?\d{1,4}$/;

/* GET /api/live/ws?z=zx,zy — WebSocket upgrade. Browsers can't set an
 * Authorization header on a WebSocket, so the session token rides in the
 * subprotocol list: new WebSocket(url, ["taiao-live", "tk.<token>"])
 * (base64url is a valid RFC 6455 subprotocol token). The DO echoes
 * "taiao-live" back so the browser accepts the handshake. */
export async function connect(req, env, url) {
  if ((req.headers.get("upgrade") || "").toLowerCase() !== "websocket")
    return err("Expected a WebSocket.", 426);
  const protos = (req.headers.get("sec-websocket-protocol") || "")
    .split(",").map(s => s.trim());
  const tk = protos.find(s => s.startsWith("tk."));
  const user = tk ? await authToken(env, tk.slice(3)) : null;
  if (!user) return err("Not logged in.", 401);
  const zone = String(url.searchParams.get("z") || "");
  if (!ZONE_KEY.test(zone)) return err("Bad zone key.");
  if (!await rateLimit(env, `live-conn:${user.id}`, 120, 3600))
    return err("Reconnecting too fast.", 429);
  const stub = env.LIVE.get(env.LIVE.idFromName("z:" + zone));
  return stub.fetch(new Request(
    "https://live/ws?u=" + user.id + "&n=" + encodeURIComponent(user.username || ""),
    req));
}
