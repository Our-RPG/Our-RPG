/* live.js — real-time presence (Phase 3: we can SEE each other).
 * One Durable Object per world ZONE (the 15000²-tile named blocks of
 * features.js — NOT regionsync's little 256² ledger cells) holds a
 * hibernatable WebSocket per connected player and relays:
 *
 *   hello/roster/join/leave   who is here, what they look like
 *   m / tp                    tile steps (with duration, so remotes replay
 *                             the exact interpolation) and teleports
 *   s / a                     appearance (outfit/character/carried light) and
 *                             action state
 *   sp                        split selves — each extra body's tile, facing,
 *                             own combat level and action
 *   fx                        player visual combat events (lunge / hit+health /
 *                             heal / floating xp / projectile) — ephemeral,
 *                             proximity-relayed so every nearby screen sees the
 *                             same swings, hitsplats, arrows and xp as the owner
 *   e                         discrete deeds: kill, shop buy/sell
 *   n                         instant node/decor depletion (a VISUAL courier —
 *                             the RegionLedger stays the authority; its pull
 *                             corrects anything this raced)
 *   E                         entity-sync batches (shared monsters & NPCs):
 *                             an opaque op array from the proximity authority,
 *                             relayed to everyone near the sender (the CLIENTS
 *                             define the op grammar — js/net/entsync.js)
 *   chat / t*                 public chat and player-to-player trading (gated
 *                             by env LIVE_CHAT / LIVE_TRADE = "on")
 *   fe                        feeding another player (one food item, relayed)
 *   fol                       follow notification (someone follows/unfollows you)
 *   cm / cmok / cmno          commission negotiation: offer a fee to be guided,
 *                             guide accepts/declines
 *   cmstart / cmprog / cmarr / cmcancel / cmpay
 *                             commission ESCROW: the follower escrows the fee,
 *                             progress is tracked, and the DO pays it out — whole
 *                             fee to the guide on a both-arrived delivery, split by
 *                             distance covered on a cancel; payouts re-deliver until
 *                             acked (cmpayack), like a gift
 *   gv / gcommit / gack       giving items: a one-sided escrow — the gift is
 *                             persisted BEFORE delivery and re-delivered on
 *                             reconnect until the recipient acks, so a drop
 *                             mid-give can't eat the items
 *
 * The DO relays, it does not simulate: every client runs its own world and
 * the plausibility envelope (envelope.js) remains the anti-cheat line. The
 * worker (connect below) authenticates the session and forwards with trusted
 * ?u=&n= params — the DO trusts its caller, like region.js.
 *
 * HIBERNATION: per-socket meta lives in the attachment and now mirrors the
 * WHOLE durable half of the state (identity + last position + appearance),
 * refreshed on hello/appearance and throttled on movement. this.p is only a
 * cache over it. Before this, a wake wiped this.p and every sendTo /
 * bcastNear / roster built from it silently missed all the players who
 * hadn't spoken since — trade invites and whispers "sent" but never
 * delivered, proximity chat falling on deaf ears. state(ws) reconstructs
 * from the attachment, and all() is the only enumeration anyone uses. */

const MAX_CONNS = 200;            // per zone — a bound, not a target
const MAX_MSG_BYTES = 8192;       // entity-sync batches are the big ones
const CHAT_MAX_CHARS = 240;
const NAME_MAX = 24;
// public chat is PROXIMITY: only players within the speaker's full-zoom-out
// view range hear them (client viewRadius() peaks at ~77 tiles at camZoom 3.0,
// render3d.js:764). A zone can be far bigger, so a shout never crosses it.
const CHAT_RADIUS = 80;
// entity-sync batches reach everyone who could possibly see the entities the
// sender is simulating (sim radius 48 + a generous view margin)
const ENT_RADIUS = 140;
// player visual events (lunge/hit/heal/float/projectile) reach everyone who
// could see the player — same generous view margin as entity sync
const FX_RADIUS = 140;
const FX_KINDS = new Set(["lg", "ht", "hp", "fl", "pj"]);
// a roadside hitchhiking offer reaches a bit past chat range, so a driver
// trotting down the road spots a thumb out before they're on top of them
const HH_RADIUS = 110;
// feeding is a point-blank social action; gate it to chat range so a feed
// can't be flung at an arbitrary victim across the zone (see the "fe" handler)
const FEED_RADIUS = 80;
// hard caps on a gift: a gift is a handful of items, not a bank dump. The
// delivery is ultimately a client-side addItem (the client's inventory stays
// the authority), so these only BOUND the per-event mint — they can't close it.
const GIFT_MAX_STACKS = 8;
const GIFT_MAX_QTY = 10000;        // per-stack ceiling, on top of itemList's clamp
// most a single commission escrow may ever hold / pay out — "a few thousand
// coins" on this file's commrate scale. Caps the per-event coin mint on a
// cancel or a delivery (the payout is still a client-side addItem — bounded,
// not fully closed without server-authoritative coin custody).
const COMM_MAX_PRICE = 5000;
// sane band for the coins-per-tile value fed into the persisted commrate EMA,
// so one contrived trip can't poison the average that prefills offer panels
const COMM_RATE_MIN = 0.1, COMM_RATE_MAX = 50;
// per-sender standing caps on unacked escrow records, so one client can't
// balloon the DO's storage (and slow every player's hello recovery scan)
const GIFT_PENDING_CAP = 20, COMM_PENDING_CAP = 20;
// upper bound on records a single hello's recovery scan will load; the caps
// above keep realistic totals well under it — it only guards pathological bloat
const RECOVER_SCAN_LIMIT = 1024;
// reused for the byte-accurate message-size check (MAX_MSG_BYTES is in bytes)
const MSG_ENC = new TextEncoder();

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

// sanitize a [[itemId, qty], ...] offer/gift list (small and shallow)
function itemList(v, maxLen) {
  if (!Array.isArray(v) || v.length > maxLen) return null;
  return v.map(it => [str(it && it[0], 64), Math.max(1, num(it && it[1], 1e6) | 0)])
    .filter(it => it[0]);
}

export class LiveZone {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.p = new Map(); // ws -> state cache (attachment holds the durable half)
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
      st = { id: at.id, name: at.name, hello: !!at.hello, nudged: false,
             x: at.x || 0, y: at.y || 0, lvl: at.lvl | 0, clvl: at.clvl | 0,
             character: at.character == null ? null : at.character,
             outfit: at.outfit || "", cndl: at.cndl | 0, sp: at.sp || null,
             act: null, tokens: 60, tAt: Date.now(), saveAt: 0 };
      this.p.set(ws, st);
    }
    return st;
  }

  // mirror the durable half of st into the attachment (survives hibernation).
  // `always` forces it; otherwise throttled to one write per 3s per socket so
  // a brisk walker isn't serializing every step.
  save(ws, st, always) {
    const t = Date.now();
    if (!always && t < st.saveAt) return;
    st.saveAt = t + 3000;
    try {
      ws.serializeAttachment({ id: st.id, name: st.name, hello: st.hello,
        x: st.x, y: st.y, lvl: st.lvl, clvl: st.clvl, character: st.character,
        outfit: st.outfit, cndl: st.cndl, sp: st.sp });
    } catch (e) {}
  }

  // every connected socket with its state — the only hibernation-safe way to
  // enumerate players (this.p alone forgets everyone across a wake)
  *all() {
    for (const ws of this.ctx.getWebSockets()) {
      const st = this.state(ws);
      if (st) yield [ws, st];
    }
  }

  pub(st) {
    return { id: st.id, name: st.name, x: st.x, y: st.y, lvl: st.lvl, clvl: st.clvl,
             character: st.character, outfit: st.outfit, act: st.act,
             cndl: st.cndl || 0, sp: st.sp || null };
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
    for (const [ws, st] of this.all())
      if (st.id === userId) { this.send(ws, obj); return true; }
    return false;
  }

  // like sendTo, but only when the target's last-known position is within
  // `radius` tiles of `origin` — for point-blank targeted actions (feeding),
  // so they can't be aimed at a victim anywhere in the zone
  sendToNear(origin, userId, obj, radius) {
    for (const [ws, st] of this.all())
      if (st.id === userId && st.hello &&
          Math.abs(st.x - origin.x) <= radius && Math.abs(st.y - origin.y) <= radius) {
        this.send(ws, obj); return true;
      }
    return false;
  }

  // proximity broadcast: everyone (the origin included, unless excepted) whose
  // last-known position is within `radius` tiles of the origin. Positions come
  // from the attachment-backed states, kept fresh by every m/tp.
  bcastNear(origin, obj, radius, except) {
    const msg = JSON.stringify(obj);
    for (const [ws, st] of this.all()) {
      if (!st.hello || ws === except) continue;
      if (Math.abs(st.x - origin.x) <= radius && Math.abs(st.y - origin.y) <= radius) {
        try { ws.send(msg); } catch (e) {}
      }
    }
  }

  // Per-socket leaky bucket on a NAMED action (tp / gift / comm), separate from
  // the global token bucket: it throttles one specific action without tripping
  // the whole-connection flood cut, so teleport-spam to hop near victims, or
  // gift/commission-spam that balloons DO storage, is bounded on its own.
  // Fields live on st as `<key>Tok` / `<key>At`. Returns false → drop the action.
  bucketOk(st, key, burst, refillPerMs) {
    const t = Date.now();
    const tk = key + "Tok", ta = key + "At";
    const tok = Math.min(burst,
      (st[tk] == null ? burst : st[tk]) + (t - (st[ta] || t)) * refillPerMs);
    st[ta] = t;
    if (tok < 1) { st[tk] = tok; return false; }
    st[tk] = tok - 1;
    return true;
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
      const list = await this.ctx.storage.list({ prefix: "trade:", limit: RECOVER_SCAN_LIMIT });
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

  // ---- gift escrow (one-sided trade: "Give items" / right-click) ----------
  // The giver's client removes the items the moment it sends gv (its own save
  // is the authority on its inventory); the DO persists the gift and delivers
  // a gcommit the recipient applies idempotently and acks — re-delivered on
  // every hello until acked, exactly like a committed trade's missing half.
  async giveItems(st, to, items) {
    // bound the sender's standing unacked gifts so a client can't balloon the
    // DO's storage (the scan itself is capped by RECOVER_SCAN_LIMIT)
    try {
      const existing = await this.ctx.storage.list({ prefix: "gift:", limit: RECOVER_SCAN_LIMIT });
      let mine = 0;
      for (const [, r] of existing) if (r && r.from === st.id) mine++;
      if (mine >= GIFT_PENDING_CAP) return false;
    } catch (e) {}
    const gid = crypto.randomUUID();
    const rec = { gid, from: st.id, fromName: st.name, to, items, at: Date.now() };
    try { await this.ctx.storage.put("gift:" + gid, rec); } catch (e) {}
    const delivered = this.sendTo(to, { t: "gcommit", gid, from: st.id, fromName: st.name, items });
    return delivered;
  }
  async ackGift(uid, gid) {
    try {
      const rec = await this.ctx.storage.get("gift:" + gid);
      if (rec && rec.to === uid) await this.ctx.storage.delete("gift:" + gid);
    } catch (e) {}
  }
  async recoverGifts(ws, uid) {
    try {
      const list = await this.ctx.storage.list({ prefix: "gift:", limit: RECOVER_SCAN_LIMIT });
      const stale = Date.now() - 6 * 3600e3;
      for (const [k, rec] of list) {
        if (rec.at < stale) { await this.ctx.storage.delete(k); continue; }
        if (rec.to === uid)
          this.send(ws, { t: "gcommit", gid: rec.gid, from: rec.from, fromName: rec.fromName, items: rec.items });
      }
    } catch (e) {}
  }

  // ---- commission escrow (pay-to-be-guided) -------------------------------
  // The follower deducts `price` coins the instant they start the commission
  // (their save is the authority on their own purse, same trust model as
  // trades/gifts). The DO holds the escrow and, at settlement, hands each
  // party a coin payout (comm pay) they apply idempotently and ack — like a
  // gift, re-delivered on every hello until acked. A commission can only ever
  // pay out `price` total: full to the leader on a both-arrived delivery, or
  // split by distance covered on a cancel.
  // The escrow is a JOINT account, not a loose amount: the record names BOTH
  // parties (f = follower/payer, l = leader/guide) and the coin it holds, and
  // nothing may be drawn from it until the contract completes (both arrive) or
  // breaks (either logs off / withdraws / dies — all surface here as a cancel).
  //   comm:<cid>      = { cid, f, l, fn, ln, price, dx, dy, orig, rem, arrF, arrL, at }
  //   cpay:<cid>:<uid>= { cid, uid, coins, why, other, at }   pending payout
  //   commrate        = { r, at }   light EMA of coins/tile across deliveries
  nameById(id) {
    for (const [, s] of this.all()) if (s.hello && s.id === id) return s.name || "";
    return "";
  }
  async commStart(st, to, cid, price, dx, dy, dist) {
    // one follower can't hold open an unbounded pile of escrow records
    try {
      const existing = await this.ctx.storage.list({ prefix: "comm:", limit: RECOVER_SCAN_LIMIT });
      let mine = 0;
      for (const [, r] of existing) if (r && r.f === st.id) mine++;
      if (mine >= COMM_PENDING_CAP) return;
    } catch (e) {}
    const orig = Math.max(1, dist | 0);
    const rec = { cid, f: st.id, l: to, fn: st.name, ln: this.nameById(to),
                  price: Math.min(COMM_MAX_PRICE, Math.max(0, price | 0)),  // hard-cap the escrow
                  dx: dx | 0, dy: dy | 0, orig, rem: orig, arrF: false, arrL: false, at: Date.now() };
    try { await this.ctx.storage.put("comm:" + cid, rec); } catch (e) {}
    // tell the leader the trip is on (they track arrival + follower-gone)
    this.sendTo(to, { t: "cmstart", id: st.id, name: st.name, cid,
                      price: rec.price, dx: rec.dx, dy: rec.dy, dist: orig });
  }
  async commProgress(cid, by, rem) {
    try {
      const rec = await this.ctx.storage.get("comm:" + cid);
      if (!rec) return;
      if (by !== rec.f && by !== rec.l) return;           // only a party may report progress
      rec.rem = Math.max(0, Math.min(rec.rem, rem | 0));  // remaining only ever shrinks (monotonic)
      await this.ctx.storage.put("comm:" + cid, rec);
    } catch (e) {}
  }
  async commArrive(uid, cid) {
    try {
      const rec = await this.ctx.storage.get("comm:" + cid);
      if (!rec) return;
      if (uid !== rec.f && uid !== rec.l) return;   // only a party may mark arrival
      if (uid === rec.f) rec.arrF = true;
      if (uid === rec.l) rec.arrL = true;
      if (rec.arrF && rec.arrL) {                       // delivered — whole fee to the leader
        await this.ctx.storage.delete("comm:" + cid);
        await this.bumpCommRate(rec.price / rec.orig);  // a real trade feeds the market rate
        await this.payout(rec.l, cid, rec.price, "deliver", rec.fn);
        await this.payout(rec.f, cid, 0, "deliver", rec.ln); // closes the follower's side (0 coins, just the note)
      } else {
        await this.ctx.storage.put("comm:" + cid, rec);
      }
    } catch (e) {}
  }
  async commCancel(cid, by, rem) {
    try {
      const rec = await this.ctx.storage.get("comm:" + cid);
      if (!rec) return;
      if (by !== rec.f && by !== rec.l) return;   // only a party may cancel their own contract
      await this.ctx.storage.delete("comm:" + cid);
      // the split comes from SERVER-tracked remaining distance (rec.rem, fed by
      // cmprog), never a self-serving client number. The follower may NARROW it
      // (they've travelled on past the last ping) but never widen it — rem is
      // clamped monotonically non-increasing against the recorded value.
      let r = Math.max(0, Math.min(rec.orig, rec.rem | 0));
      if (by === rec.f && rem != null) r = Math.max(0, Math.min(r, num(rem, 1e7) | 0));
      const refund = Math.round((r / rec.orig) * rec.price);   // distance NOT covered → back to follower
      const lead = rec.price - refund;                          // distance covered → to the leader
      await this.payout(rec.f, cid, refund, "cancel", rec.ln);
      await this.payout(rec.l, cid, lead, "cancel", rec.fn);
    } catch (e) {}
  }
  async payout(uid, cid, coins, why, other) {
    const key = "cpay:" + cid + ":" + uid;
    const rec = { cid, uid, coins: Math.max(0, coins | 0), why, other: other || "", at: Date.now() };
    try { await this.ctx.storage.put(key, rec); } catch (e) {}
    this.sendTo(uid, { t: "cmpay", cid, coins: rec.coins, why, other: rec.other });
  }
  // light EMA of coins-per-tile across delivered commissions — the "average
  // market rate" the offer panel pre-fills (served at hello via sendCommRate).
  async bumpCommRate(perTile) {
    if (!(perTile > 0)) return;
    // clamp into a sane band so one contrived trip (tiny distance at max price,
    // or a huge distance at a token price) can't drag the persisted EMA to an
    // absurd value that then mis-prefills everyone's offer panel
    perTile = Math.max(COMM_RATE_MIN, Math.min(COMM_RATE_MAX, perTile));
    try {
      const rec = await this.ctx.storage.get("commrate");
      const prev = rec && rec.r > 0 ? rec.r : perTile;
      await this.ctx.storage.put("commrate", { r: prev * 0.8 + perTile * 0.2, at: Date.now() });
    } catch (e) {}
  }
  async sendCommRate(ws) {
    try {
      const rec = await this.ctx.storage.get("commrate");
      this.send(ws, { t: "commrate", r: rec && rec.r > 0 ? rec.r : 0 });
    } catch (e) {}
  }
  async ackPay(uid, cid) {
    try { await this.ctx.storage.delete("cpay:" + cid + ":" + uid); } catch (e) {}
  }
  async recoverComms(ws, uid) {
    try {
      // re-deliver any unclaimed payouts addressed to us
      const pays = await this.ctx.storage.list({ prefix: "cpay:", limit: RECOVER_SCAN_LIMIT });
      const stale = Date.now() - 24 * 3600e3;
      for (const [k, rec] of pays) {
        if (rec.at < stale) { await this.ctx.storage.delete(k); continue; }
        if (rec.uid === uid) this.send(ws, { t: "cmpay", cid: rec.cid, coins: rec.coins, why: rec.why, other: rec.other || "" });
      }
    } catch (e) {}
  }

  webSocketMessage(ws, msg) {
    if (typeof msg !== "string") return;
    // the cap is in BYTES: .length counts UTF-16 code units, so a multibyte
    // payload could be ~3× the intended cap. Char length is a cheap lower bound
    // on byte length (UTF-8 is >= 1 byte/unit), so only encode near the limit.
    if (msg.length > MAX_MSG_BYTES || MSG_ENC.encode(msg).length > MAX_MSG_BYTES) return;
    const st = this.state(ws);
    if (!st) return;
    // token bucket: 60 burst, 25/s refill — brisk play (a step every ~150 ms,
    // action chatter, 3 Hz entity-sync batches when carrying authority) stays
    // well inside; a flooder gets cut off
    const t = Date.now();
    st.tokens = Math.min(60, st.tokens + (t - st.tAt) * 0.025);
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
      st.cndl = num(m.cndl, 9) | 0;
      st.hello = true;
      this.save(ws, st, true);
      const roster = [];
      for (const [ows, os] of this.all())
        if (ows !== ws && os.hello) roster.push(this.pub(os));
      this.send(ws, { t: "roster", players: roster,
                      chat: this.env.LIVE_CHAT === "on",
                      trade: this.env.LIVE_TRADE === "on" });
      // re-hellos after a hibernation wake re-announce too — join is an
      // idempotent upsert client-side
      this.bcast({ t: "join", p: this.pub(st) }, ws);
      // hand back any committed-but-unclaimed swap/gift this player dropped
      // before acking (disconnect mid-trade) — re-applied idempotently
      if (this.env.LIVE_TRADE === "on") this.recoverTrades(ws, st.id);
      this.recoverGifts(ws, st.id);
      this.recoverComms(ws, st.id);   // unclaimed commission payouts
      this.sendCommRate(ws);          // current average travel rate (coins/tile)
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
        this.save(ws, st);
        // Proximity-filtered like fx/entity-sync: a tile step is only visible to
        // players who can see the mover, so sending it zone-wide was pure O(N²)
        // waste. st was just moved to the step's destination, so FX_RADIUS around
        // it reaches everyone in (and comfortably beyond) view range. tp/s/a stay
        // on full bcast — tp is also the idle heartbeat that keeps far players
        // from being stale-pruned, and s carries appearance identity; both are
        // low-frequency, so proximity-filtering them would risk stale remotes for
        // no real throughput win.
        this.bcastNear(st, { t: "m", id: st.id, fx, fy, tx, ty, dur,
                     d8: str(m.d8, 10), lvl: st.lvl, clvl: st.clvl }, FX_RADIUS, ws);
        return;
      }
      case "tp": {  // teleport/respawn/door — discontinuous, remotes snap
        // rate-limit teleports: doors/respawn are occasional, but unbounded tp
        // lets an attacker hop the whole zone every message to park next to
        // victims and fire proximity-gated payloads (fe/fx/chat). 6 burst,
        // refill 1 / 1.5s — legit play never hits it, and distance stays
        // unclamped so a long respawn across the zone still works. Overflow
        // silently drops the hop (position just doesn't advance remotely).
        if (!this.bucketOk(st, "tp", 6, 1 / 1500)) return;
        st.x = num(m.x); st.y = num(m.y); st.lvl = num(m.lvl, 40) | 0;
        if (m.clvl != null) st.clvl = num(m.clvl, 99) | 0;
        this.save(ws, st);
        this.bcast({ t: "tp", id: st.id, x: st.x, y: st.y,
                     d8: str(m.d8, 10), lvl: st.lvl, clvl: st.clvl }, ws);
        return;
      }
      case "s": {   // appearance change (incl. the light they carry)
        st.character = m.character == null ? null : num(m.character, 999) | 0;
        st.outfit = str(m.outfit, 48);
        st.cndl = num(m.cndl, 9) | 0;
        this.save(ws, st, true);
        this.bcast({ t: "s", id: st.id, character: st.character, outfit: st.outfit,
                     cndl: st.cndl }, ws);
        return;
      }
      case "sp": {  // split selves: [x,y,d8,storey,clvl,actCode] per extra body
        let b = null;
        if (Array.isArray(m.b)) {
          b = m.b.slice(0, 4).map(e => [num(e && e[0]), num(e && e[1]),
            str(e && e[2], 10), num(e && e[3], 8) | 0,
            num(e && e[4], 99) | 0, str(e && e[5], 1)]);
        }
        st.sp = b && b.length ? b : null;
        this.save(ws, st, true);
        this.bcast({ t: "sp", id: st.id, b: st.sp }, ws);
        return;
      }
      case "a": {   // action state: k=null means "stopped doing the thing"
        const k = m.k && ACT_KINDS.has(m.k) ? m.k : null;
        st.act = k;
        this.bcast({ t: "a", id: st.id, k }, ws);
        return;
      }
      case "fx": {  // player visual combat event (lunge / hit / heal / float /
                    // projectile) — ephemeral, proximity-relayed, never stored.
        const k = str(m.k, 2);
        if (!FX_KINDS.has(k)) return;
        const out = { t: "fx", id: st.id, k };
        if (m.hp != null) out.hp = num(m.hp, 1e6) | 0;
        if (m.mhp != null) out.mhp = num(m.mhp, 1e6) | 0;
        if (k === "lg" && Array.isArray(m.d))
          out.d = [Math.max(-1, Math.min(1, num(m.d[0], 2) | 0)), Math.max(-1, Math.min(1, num(m.d[1], 2) | 0))];
        if (k === "ht") out.v = num(m.v, 1e6) | 0;
        if (k === "fl") {
          out.s = str(m.s, 48).replace(/[\x00-\x1f\x7f]/g, " ");
          if (m.c) out.c = str(m.c, 12);
          if (m.z) out.z = num(m.z, 64) | 0;
        }
        if (k === "pj") {
          const p = m.p;
          if (!p || typeof p !== "object") return;
          try { if (JSON.stringify(p).length > 320) return; } catch (e) { return; }
          out.p = { kind: str(p.kind, 8), x0: num(p.x0), y0: num(p.y0),
            x1: num(p.x1), y1: num(p.y1), dur: num(p.dur, 5000) };
          if (p.h0 != null) out.p.h0 = num(p.h0, 1e4);
          if (p.h1 != null) out.p.h1 = num(p.h1, 1e4);
          if (p.peak != null) out.p.peak = num(p.peak, 1e4);
          if (p.hitT != null) out.p.hitT = num(p.hitT, 2);
          if (p.col) out.p.col = str(p.col, 12);
        }
        this.bcastNear(st, out, FX_RADIUS, ws);
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
      case "E": {   // entity-sync batch (shared monsters & NPCs) — opaque relay.
        // The clients define the op grammar (js/net/entsync.js); the DO only
        // bounds it: an array, not too many ops, total size already capped by
        // MAX_MSG_BYTES. Relayed to everyone near the sender, sender excluded.
        if (!Array.isArray(m.a) || !m.a.length || m.a.length > 96) return;
        this.bcastNear(st, { t: "E", id: st.id, a: m.a }, ENT_RADIUS, ws);
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
      case "fe": {  // feed another player: one food item, applied by the eater
        const to = num(m.to, 1e12) | 0;
        const item = str(m.item, 64);
        if (!to || to === st.id || !item) return;
        // proximity gate: feeding is point-blank, so it can't be aimed at an
        // arbitrary victim across the zone (pairs with the tp rate-limit above)
        this.sendToNear(st, to, { t: "fe", id: st.id, name: st.name, item }, FEED_RADIUS);
        return;
      }
      case "gv": {  // give items (one-sided escrow — see giveItems above)
        const to = num(m.to, 1e12) | 0;
        if (!to || to === st.id) return;
        const items = itemList(m.items, GIFT_MAX_STACKS);
        if (!items || !items.length) return;
        for (const it of items) if (it[1] > GIFT_MAX_QTY) it[1] = GIFT_MAX_QTY;  // per-stack hard cap
        if (!this.bucketOk(st, "gift", 5, 1 / 3000)) return;   // a gift is occasional, not a firehose
        this.giveItems(st, to, items);
        return;
      }
      case "gack": { // recipient applied the gift — retire the record
        const gid = str(m.gid, 64);
        if (gid) this.ackGift(st.id, gid);
        return;
      }
      case "fol": {  // follow notification — pure relay to the followed player
        const to = num(m.to, 1e12) | 0;
        if (!to || to === st.id) return;
        this.sendTo(to, { t: "fol", id: st.id, name: st.name, on: !!m.on });
        return;
      }
      case "cm": {   // commission offer — relay to the would-be guide
        const to = num(m.to, 1e12) | 0;
        if (!to || to === st.id) return;
        this.sendTo(to, { t: "cm", id: st.id, name: st.name,
          price: Math.min(COMM_MAX_PRICE, num(m.price, 1e9) | 0),  // same ceiling the escrow enforces
          dx: num(m.dx) | 0, dy: num(m.dy) | 0 });
        return;
      }
      case "cmok": { // guide accepts — relay to the follower (who then escrows)
        const to = num(m.to, 1e12) | 0;
        if (to && to !== st.id) this.sendTo(to, { t: "cmok", id: st.id, name: st.name });
        return;
      }
      case "cmno": { // guide declines
        const to = num(m.to, 1e12) | 0;
        if (to && to !== st.id) this.sendTo(to, { t: "cmno", id: st.id, name: st.name });
        return;
      }
      case "cmstart": {  // follower escrowed the fee — open the commission record
        const to = num(m.to, 1e12) | 0;
        const cid = str(m.cid, 64);
        if (!to || to === st.id || !cid) return;
        if (!this.bucketOk(st, "comm", 6, 1 / 2000)) return;   // bound escrow churn per sender
        this.commStart(st, to, cid, num(m.price, 1e9) | 0, num(m.dx) | 0, num(m.dy) | 0, num(m.dist, 1e7) | 0);
        return;
      }
      // these mutate/settle an escrow, so the sender (st.id) MUST be a party to
      // it — the party check lives in the comm* methods below
      case "cmprog": { const cid = str(m.cid, 64); if (cid) this.commProgress(cid, st.id, num(m.rem, 1e7) | 0); return; }
      case "cmarr": { const cid = str(m.cid, 64); if (cid) this.commArrive(st.id, cid); return; }
      case "cmcancel": {
        const cid = str(m.cid, 64);
        // rate-limit with cmstart so cancel-spam can't churn payouts; the raw
        // client rem is passed through but only honoured from the follower and
        // clamped against server-tracked progress in commCancel
        if (cid && this.bucketOk(st, "comm", 6, 1 / 2000)) this.commCancel(cid, st.id, m.rem);
        return;
      }
      case "cmpayack": { const cid = str(m.cid, 64); if (cid) this.ackPay(st.id, cid); return; }
      case "hh": {   // public hitchhiking offer — proximity-broadcast to drivers
        this.bcastNear(st, { t: "hh", id: st.id, name: st.name,
          dx: num(m.dx) | 0, dy: num(m.dy) | 0, price: num(m.price, 1e9) | 0 }, HH_RADIUS, ws);
        return;
      }
      case "hhcancel": {  // thumb down — tell nearby drivers to drop the listing
        this.bcastNear(st, { t: "hhcancel", id: st.id }, HH_RADIUS, ws);
        return;
      }
      case "hhpick": {    // a driver accepts a roadside offer — relay to the hitchhiker
        const to = num(m.to, 1e12) | 0;
        if (to && to !== st.id) this.sendTo(to, { t: "hhpick", id: st.id, name: st.name });
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
          const items = itemList(m.items, 24);
          if (!items) return;
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
    // read via attachment too: a socket that dies after a hibernation wake
    // (before speaking again) still needs its leave broadcast
    const st = this.p.get(ws) || this.state(ws);
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
