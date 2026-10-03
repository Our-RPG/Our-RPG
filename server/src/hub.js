/* hub.js — the ONE global presence hub (Phase 4: the whole world at once).
 *
 * LiveZone is per-zone: it can only ever see the players sharing your 15000²
 * block, which is exactly right for movement/proximity but useless for "who is
 * online across the entire world" and for a direct message to someone half a
 * continent away. Those need a single meeting point, so this is one Durable
 * Object (idFromName("global")) that every logged-in player also holds a slim
 * WebSocket to, alongside their zone socket.
 *
 *   hello {clvl,zone}  → reply roster (everyone online) + broadcast join
 *   u {clvl,zone}      → presence update (combat level ticked up, changed area)
 *   dm {to,text}       → deliver to that user wherever they are (+ echo back to
 *                        the sender so their own thread shows it); dropped if the
 *                        target is offline
 *   leave              → on socket close
 *
 * Like LiveZone it relays only — no world simulation, no storage. Hibernatable
 * sockets keep it cheap; per-socket identity rides the attachment. */

const MAX_CONNS = 4000;           // whole world — a bound, not a target
const MAX_MSG_BYTES = 2048;
const DM_MAX_CHARS = 500;
const NAME_MAX = 24;
const ZONE_MAX = 40;              // a short "where" label

const num = (v, lim = 1e12) => {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= lim ? n : 0;
};
const str = (v, max) => String(v == null ? "" : v).slice(0, max);
// Actual UTF-8 byte length — the size cap is in bytes, not JS chars (a string
// of multi-byte glyphs is far heavier than its .length suggests).
const enc = new TextEncoder();
const byteLen = s => enc.encode(s).length;

export class GlobalHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.p = new Map(); // ws -> {id,name,clvl,zone,hello,nudged,tokens,tAt}
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
    if (socks.length >= MAX_CONNS) return new Response("Hub is full.", { status: 503 });
    // one presence per account: a second tab (or a reconnect the server hasn't
    // seen die yet) replaces the first
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
    return new Response(null, {
      status: 101, webSocket: client,
      headers: { "sec-websocket-protocol": "taiao-hub" },
    });
  }

  attach(ws) { try { return ws.deserializeAttachment(); } catch (e) { return null; } }

  // HIBERNATION-PROOF presence: everything the hub knows about a player is
  // mirrored into the socket's attachment (which survives DO hibernation).
  // Before this, a wake wiped this.p, and every sendTo/roster built from it
  // silently missed all the players who hadn't spoken since the wake — DMs
  // "sent" but never delivered, rosters showing one player in a full world.
  state(ws) {
    let st = this.p.get(ws);
    if (!st) {
      const at = this.attach(ws);
      if (!at) return null;
      st = { id: at.id, name: at.name, clvl: at.clvl | 0, zone: at.zone || "",
             character: at.character == null ? null : at.character,
             hello: !!at.hello, nudged: false, tokens: 20, tAt: Date.now(),
             dmTok: 5, dmAt: Date.now(), dmPair: null };
      this.p.set(ws, st);
    }
    return st;
  }

  // persist the durable half of st back into the attachment
  save(ws, st) {
    try {
      ws.serializeAttachment({ id: st.id, name: st.name, clvl: st.clvl,
        zone: st.zone, character: st.character, hello: st.hello });
    } catch (e) {}
  }

  // every connected socket with its state — the ONLY safe way to enumerate
  // players (this.p alone forgets everyone across a hibernation wake)
  *all() {
    for (const ws of this.ctx.getWebSockets()) {
      const st = this.state(ws);
      if (st) yield [ws, st];
    }
  }

  pub(st) { return { id: st.id, name: st.name, clvl: st.clvl, zone: st.zone, character: st.character }; }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }

  bcast(obj, except) {
    const msg = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(msg); } catch (e) {}
    }
  }

  sendTo(userId, obj) {
    let any = false;
    for (const [ws, st] of this.all())
      if (st.id === userId) { this.send(ws, obj); any = true; }
    return any;
  }

  // Resolve a DM target to exactly ONE account id. A numeric target is already
  // an id (one id = one account), so it passes straight through. A name target
  // is resolved HERE rather than on the client, so case variants can't misroute
  // or impersonate: because `Alice` and `alice` are distinct, case-sensitive-
  // unique accounts, an exact-case match wins outright; a case-insensitive
  // match is honoured only when it is the single online candidate, and an
  // ambiguous one is refused (returns 0).
  resolveTo(to) {
    if (typeof to === "number" || /^[0-9]+$/.test(String(to)))
      return num(to, 1e12) | 0;
    const name = str(to, NAME_MAX);
    if (!name) return 0;
    const lc = name.toLowerCase();
    let ci = 0, nci = 0;
    for (const [, st] of this.all()) {
      if (st.name === name) return st.id;                 // unambiguous exact-case hit
      if (String(st.name).toLowerCase() === lc) { ci = st.id; nci++; }
    }
    return nci === 1 ? ci : 0;                            // unique CI match, else refuse
  }

  webSocketMessage(ws, msg) {
    // .length is chars; the cap is bytes. The char pre-check short-circuits a
    // pathologically long frame before we bother UTF-8-measuring it (chars can
    // never outnumber bytes, so > cap chars is already > cap bytes).
    if (typeof msg !== "string" || msg.length > MAX_MSG_BYTES || byteLen(msg) > MAX_MSG_BYTES) return;
    const st = this.state(ws);
    if (!st) return;
    // token bucket: 20 burst, 6/s refill — roster upkeep plus the odd DM stays
    // well inside; a flooder gets cut off
    const t = Date.now();
    st.tokens = Math.min(20, st.tokens + (t - st.tAt) * 0.006);
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
      st.clvl = num(m.clvl, 99) | 0;
      st.zone = str(m.zone, ZONE_MAX);
      st.character = m.character == null ? null : num(m.character, 999) | 0;
      st.hello = true;
      this.save(ws, st);
      const roster = [];
      for (const [ows, os] of this.all())
        if (ows !== ws && os.hello) roster.push(this.pub(os));
      this.send(ws, { t: "roster", players: roster });
      this.bcast({ t: "join", p: this.pub(st) }, ws);
      return;
    }

    if (!st.hello) {
      if (!st.nudged) { st.nudged = true; this.send(ws, { t: "sync" }); }
      return;
    }

    switch (m.t) {
      case "u": {   // presence update — combat level ticked, changed area, reskin
        st.clvl = num(m.clvl, 99) | 0;
        st.zone = str(m.zone, ZONE_MAX);
        if (m.character !== undefined) st.character = m.character == null ? null : num(m.character, 999) | 0;
        this.save(ws, st);
        this.bcast({ t: "upd", id: st.id, clvl: st.clvl, zone: st.zone, character: st.character }, ws);
        return;
      }
      case "dm": {  // a direct message — reaches its target anywhere online
        // Free text is moderated: no DMs until LIVE_CHAT is staffed/on. The
        // LiveZone gates zone chat the same way; the hub must gate DMs too, or
        // the whole moderation hold is a side door away from being bypassed.
        if (this.env.LIVE_CHAT !== "on")
          return this.send(ws, { t: "err", code: "chat-disabled" });
        // Deterministic target resolution (see resolveTo) — a numeric id or a
        // name, never an ambiguous case variant.
        const to = this.resolveTo(m.to);
        if (!to || to === st.id) return;
        const text = str(m.text, DM_MAX_CHARS).replace(/[\x00-\x1f\x7f]/g, " ").trim();
        if (!text) return;
        // DM flood guard, tighter than the shared 6/s bucket above (which alone
        // would still let a stream of whispers bury someone). Per-sender token
        // bucket: 5 burst, ~0.5/s refill; plus a per-recipient floor so one
        // target can't be singled out inside that budget. Over-rate drops the
        // DM (an err notice, not a kick — the shared bucket handles true floods).
        const dt = Date.now();
        st.dmTok = Math.min(5, st.dmTok + (dt - st.dmAt) * 0.0005);
        st.dmAt = dt;
        if (--st.dmTok < 0) { st.dmTok = 0; return this.send(ws, { t: "err", code: "dm-too-fast" }); }
        if (!st.dmPair) st.dmPair = new Map();
        if (dt - (st.dmPair.get(to) || 0) < 1500)
          return this.send(ws, { t: "err", code: "dm-too-fast" });
        if (st.dmPair.size > 64) st.dmPair.clear();  // bound the per-pair map
        st.dmPair.set(to, dt);
        const packet = { t: "dm", from: st.id, name: st.name, to, text };
        const reached = this.sendTo(to, packet);
        // echo to the sender's own sockets so their thread shows the sent line;
        // tell them if it didn't land
        this.send(ws, { ...packet, sent: true, delivered: reached });
        return;
      }
    }
  }

  webSocketClose(ws) { this.gone(ws); }
  webSocketError(ws) { this.gone(ws); }
  gone(ws) {
    // read via attachment too: a socket that dies after a hibernation wake
    // (before speaking) still needs its leave broadcast
    const st = this.p.get(ws) || this.state(ws);
    this.p.delete(ws);
    if (st && st.hello) this.bcast({ t: "leave", id: st.id });
  }
}

// ---- worker-side route (runs in index.js, not in the DO) ------------------

import { err, authToken, rateLimit } from "./util.js";

/* GET /api/hub/ws — WebSocket upgrade to the single global hub. Same
 * subprotocol-token auth as live.connect: the browser can't set an auth header
 * on a WebSocket, so the session token rides the subprotocol list. */
export async function connect(req, env) {
  if ((req.headers.get("upgrade") || "").toLowerCase() !== "websocket")
    return err("Expected a WebSocket.", 426);
  const protos = (req.headers.get("sec-websocket-protocol") || "")
    .split(",").map(s => s.trim());
  const tk = protos.find(s => s.startsWith("tk."));
  const user = tk ? await authToken(env, tk.slice(3)) : null;
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `hub-conn:${user.id}`, 120, 3600))
    return err("Reconnecting too fast.", 429);
  const stub = env.HUB.get(env.HUB.idFromName("global"));
  return stub.fetch(new Request(
    "https://hub/ws?u=" + user.id + "&n=" + encodeURIComponent(user.username || ""),
    req));
}
