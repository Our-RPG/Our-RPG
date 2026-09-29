// ===== Taiao — live presence (Phase 3: we can SEE each other) =====
// A single WebSocket to the LiveZone Durable Object for the world ZONE the
// player stands in (world.zoneOf — the 15000²-tile named blocks, NOT
// regionsync's little 256² ledger cells). Through it, in real time:
//
//   OUT  every tile step (with its duration, so remotes replay the exact
//        interpolation — latency hides inside the step), teleports,
//        action state (mining/fighting/crafting), appearance changes,
//        deeds (monster kills, shop buys/sells), and instant node/decor
//        depletion (a visual courier — the RegionLedger stays canonical
//        and its pull corrects anything this raced)
//   IN   the same, from everyone else in the zone → Live.players, which
//        render3d.js draws as full outfit-aware bodies with nameplates
//
// Chat and player trading speak this socket too (live-ui.js) — the protocol
// is fully built, but the SERVER refuses both until its LIVE_CHAT /
// LIVE_TRADE vars flip to "on" (moderation isn't staffed yet). The roster
// message advertises the flags, so enabling them later needs no client
// rebuild.
//
// Same liveness rules as regionsync: logged out, in DEV_MODE, or on Tūhura
// Isle (every fresh player's isle is their own) nothing here runs.
"use strict";

(function () {
  const DEV = typeof DEV_MODE !== "undefined" && DEV_MODE;
  const TOKEN_KEY = "taiao_session_v1";       // serverapi.js's session token
  const PING_EVERY = 25e3;                    // well inside CF's idle timeout
  const STALE_MS = 180e3;                     // drop a remote we've heard nothing from
  const RETRY_MIN = 2e3, RETRY_MAX = 60e3;

  if (DEV) {
    window.Live = { players: new Map(), tick: () => {}, connected: () => false,
      chatOn: () => false, tradeOn: () => false, sendChat: () => {}, sendTrade: () => {},
      onChat: () => {}, onTrade: () => {}, onRoster: () => {}, myId: () => 0,
      status: () => ({ enabled: false }) };
    return;
  }

  const URL_ = typeof SERVER_URL !== "undefined" ? SERVER_URL : "";

  // ---------- gates (mirrors regionsync.js) ----------
  const onIsle = () => typeof player !== "undefined" && player.tutorial &&
    typeof player.tutorial === "object" && !player.tutorial.graduated;
  const live = () => !!URL_ && typeof Server !== "undefined" && Server.logged() &&
    typeof gameReady !== "undefined" && gameReady && !onIsle() &&
    typeof world !== "undefined" && world.zoneOf;

  // ---------- state ----------
  const players = new Map();     // id -> remote player (shaped like a slim `player`)
  let ws = null, wsZone = null, wsOpen = false, helloSent = false;
  let retryIn = RETRY_MIN, retryAt = 0, pingAt = 0, manageAt = 0;
  let flags = { chat: false, trade: false };
  let myId = 0;
  const chatListeners = [], tradeListeners = [], rosterListeners = [];
  const fire = (fns, m) => { for (const fn of fns) { try { fn(m); } catch (e) {} } };

  function zoneKey() {
    const z = world.zoneOf(player.x, player.y);
    return z[0] + "," + z[1];
  }

  function send(obj) {
    if (ws && wsOpen) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }
  }

  // ---------- connection ----------
  function connect() {
    const token = (() => { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } })();
    if (!token) return;
    const zone = zoneKey();
    const url = URL_.replace(/^http/, "ws") + "/api/live/ws?z=" + encodeURIComponent(zone);
    let sock;
    // the session token rides in the subprotocol list — browsers can't set
    // an Authorization header on a WebSocket (server/src/live.js connect)
    try { sock = new WebSocket(url, ["taiao-live", "tk." + token]); } catch (e) { return; }
    ws = sock; wsZone = zone; wsOpen = false; helloSent = false;
    sock.onopen = () => {
      if (sock !== ws) return;
      wsOpen = true; retryIn = RETRY_MIN;
      hello();
    };
    sock.onmessage = ev => { if (sock === ws) onMessage(ev.data); };
    sock.onclose = () => { if (sock === ws) dropped(); };
    sock.onerror = () => { try { sock.close(); } catch (e) {} };
  }
  function dropped() {
    ws = null; wsOpen = false; helloSent = false;
    players.clear();
    retryAt = Date.now() + retryIn;
    retryIn = Math.min(RETRY_MAX, retryIn * 2);
  }
  function disconnect() {
    if (ws) { const s = ws; ws = null; try { s.close(1000); } catch (e) {} }
    wsOpen = false; helloSent = false;
    players.clear();
  }

  function hello() {
    myId = (Server.user && Server.user.id) | 0;
    send({ t: "hello", x: player.x, y: player.y, lvl: player.level | 0,
           clvl: (typeof combatLevel === "function" ? combatLevel() : 1) | 0,
           character: player.character, outfit: player.outfit || "Idle" });
    helloSent = true;
    // re-announce whatever we're mid-doing so a fresh zone sees it
    lastAct = undefined; lastOutfit = undefined;
  }

  // ---------- inbound ----------
  function upsert(p) {
    if (!p || !p.id || p.id === myId) return null;
    let rp = players.get(p.id);
    if (!rp) {
      rp = { id: p.id, name: "?", x: 0, y: 0, px: 0, py: 0, level: 0, clvl: 0,
             dir8: "south", moving: null, character: null, outfit: "Idle",
             act: null, _say: null, last: Date.now() };
      players.set(p.id, rp);
    }
    if (p.name != null) rp.name = String(p.name);
    if (p.x != null) { rp.x = p.x; rp.y = p.y; rp.px = PX(p.x); rp.py = PX(p.y); }
    if (p.lvl != null) rp.level = p.lvl | 0;
    if (p.clvl != null) rp.clvl = p.clvl | 0;
    if (p.character !== undefined) rp.character = p.character;
    if (p.outfit !== undefined) rp.outfit = p.outfit || "Idle";
    if (p.act !== undefined) rp.act = p.act;
    rp.last = Date.now();
    return rp;
  }
  // a message about an id we've never met (we joined mid-story, or the DO
  // rebooted): make a placeholder — the next join/roster fills the name in
  const known = id => players.get(id) || upsert({ id });

  const nearLocal = (rp, r) => Math.abs(rp.x - player.x) <= r && Math.abs(rp.y - player.y) <= r;

  function onMessage(raw) {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || !m.t) return;
    switch (m.t) {
      case "roster":
        players.clear();
        for (const p of m.players || []) upsert(p);
        flags.chat = !!m.chat; flags.trade = !!m.trade;
        fire(rosterListeners, flags);
        return;
      case "join": upsert(m.p); return;
      case "leave": players.delete(m.id); return;
      case "sync": hello(); return;   // DO woke from hibernation, re-introduce
      case "pong": return;
      case "m": {   // a tile step — replay their interpolation exactly
        const rp = known(m.id); if (!rp) return;
        // missed steps (or our join raced): snap to the step's origin first
        rp.x = m.fx; rp.y = m.fy;
        rp.moving = { fx: m.fx, fy: m.fy, tx: m.tx, ty: m.ty, t: 0, dur: m.dur || 260 };
        rp.px = PX(m.fx); rp.py = PX(m.fy);
        if (m.d8) rp.dir8 = m.d8;
        rp.level = m.lvl | 0;
        if (m.clvl != null) rp.clvl = m.clvl | 0;
        rp.last = Date.now();
        return;
      }
      case "tp": {
        const rp = known(m.id); if (!rp) return;
        rp.moving = null;
        rp.x = m.x; rp.y = m.y; rp.px = PX(m.x); rp.py = PX(m.y);
        if (m.d8) rp.dir8 = m.d8;
        rp.level = m.lvl | 0;
        if (m.clvl != null) rp.clvl = m.clvl | 0;
        rp.last = Date.now();
        return;
      }
      case "s": { const rp = known(m.id); if (rp) upsert({ id: m.id, character: m.character, outfit: m.outfit }); return; }
      case "a": { const rp = known(m.id); if (rp) { rp.act = m.k || null; rp.last = Date.now(); } return; }
      case "e": {   // someone's deed, made visible
        const rp = players.get(m.id); if (!rp) return;
        if (typeof addFloat !== "function" || !nearLocal(rp, 48)) return;
        if (m.k === "kill")
          addFloat("⚔ " + (m.mon || "").replace(/_/g, " "), rp.px, rp.py - 40, "#ffb08f", 12);
        else if (m.k === "buy" || m.k === "sell")
          addFloat((m.k === "buy" ? "− " : "+ ") + "💰", rp.px, rp.py - 40, "#ffe14a", 12);
        return;
      }
      case "n":     // instant node/decor depletion from another player
        if (typeof RegionSync !== "undefined" && RegionSync.applyLive)
          RegionSync.applyLive({ k: m.k, v: m.v, e: m.e, t: Date.now() });
        return;
      case "chat": {
        const rp = players.get(m.id);
        if (rp) rp._say = { text: m.text, until: performance.now() + 6000 };
        fire(chatListeners, { id: m.id, name: m.name, text: m.text });
        return;
      }
      case "ti": case "to": case "ta": case "tc":
        fire(tradeListeners, m);
        return;
      case "err":
        if (m.code === "chat-disabled") flags.chat = false;
        if (m.code === "trade-disabled") flags.trade = false;
        fire(rosterListeners, flags);
        return;
    }
  }

  // ---------- outbound watchers ----------
  let lastMoving = null, lastX = null, lastY = null, lastLvl = null;
  let lastAct, lastOutfit, lastCharacter;

  function watchOutbound() {
    // movement: one message per tile step, sent the moment it STARTS — the
    // one-way latency hides inside the step's own duration
    const mv = player.moving;
    const clvl = (typeof combatLevel === "function" ? combatLevel() : 1) | 0;
    if (mv && mv !== lastMoving) {
      lastMoving = mv;
      send({ t: "m", fx: mv.fx, fy: mv.fy, tx: mv.tx, ty: mv.ty,
             dur: Math.round(mv.dur), d8: player.dir8, lvl: player.level | 0, clvl });
      lastX = mv.tx; lastY = mv.ty; lastLvl = player.level | 0;
    } else if (!mv) {
      lastMoving = null;
      // position changed with no step animating = a teleport (door, veil,
      // respawn, Bifrost) — remotes snap
      if (player.x !== lastX || player.y !== lastY || (player.level | 0) !== lastLvl) {
        lastX = player.x; lastY = player.y; lastLvl = player.level | 0;
        send({ t: "tp", x: player.x, y: player.y, d8: player.dir8, lvl: lastLvl, clvl });
      }
    }
    // action state (mining/fighting/crafting…) — remotes show an indicator
    const act = player.act ? (player.act.kind === "gather" || player.act.kind === "combat"
      ? player.act.kind : "craft") : null;
    if (act !== lastAct) { lastAct = act; send({ t: "a", k: act }); }
    // appearance
    if (player.outfit !== lastOutfit || player.character !== lastCharacter) {
      lastOutfit = player.outfit; lastCharacter = player.character;
      send({ t: "s", character: player.character, outfit: player.outfit || "Idle" });
    }
  }

  // ---------- per-frame tick (main.js) ----------
  function tick(dt) {
    // advance remote interpolations even while our own sim is paused
    // (cutscenes) — the world keeps moving for everyone else
    for (const rp of players.values()) {
      const m = rp.moving;
      if (!m) continue;
      m.t += dt / m.dur;
      if (m.t >= 1) {
        rp.x = m.tx; rp.y = m.ty;
        rp.px = PX(m.tx); rp.py = PX(m.ty);
        rp.moving = null;
      } else {
        rp.px = PX(m.fx) + (PX(m.tx) - PX(m.fx)) * m.t;
        rp.py = PX(m.fy) + (PX(m.ty) - PX(m.fy)) * m.t;
      }
    }

    const t = Date.now();
    if (t >= manageAt) {   // 1 Hz housekeeping
      manageAt = t + 1000;
      if (!live()) { if (ws) disconnect(); return; }
      if (!ws) {
        if (t >= retryAt) connect();
      } else if (wsOpen) {
        // crossing into another zone: reconnect to its Durable Object
        const z = zoneKey();
        if (z !== wsZone) { disconnect(); retryAt = 0; connect(); }
        if (t >= pingAt) { pingAt = t + PING_EVERY; send({ t: "ping" }); }
        for (const [id, rp] of players)
          if (t - rp.last > STALE_MS) players.delete(id);
      }
    }
    if (ws && wsOpen && helloSent) watchOutbound();
  }

  // ---------- deed + shared-mutation relays (wrap-by-reassignment, the
  // actionlog.js pattern — these run AFTER its wraps in the bundle) ----------
  if (typeof killMonster === "function") {
    const orig = killMonster;
    killMonster = function (mon) {
      try { if (mon && mon.alive) send({ t: "e", k: "kill", mon: mon.kind || "?" }); } catch (e) {}
      return orig(mon);
    };
  }
  if (typeof ShopSync !== "undefined") {
    const oSell = ShopSync.noteSell, oBuy = ShopSync.noteBuy;
    ShopSync.noteSell = function (town, id, n, q, maker, skill) {
      try { send({ t: "e", k: "sell", item: id, n: n | 0 }); } catch (e) {}
      return oSell(town, id, n, q, maker, skill);
    };
    ShopSync.noteBuy = function (town, id, n) {
      try { send({ t: "e", k: "buy", item: id, n: n | 0 }); } catch (e) {}
      return oBuy(town, id, n);
    };
  }
  if (typeof RegionSync !== "undefined" && RegionSync.noteNode) {
    const oNode = RegionSync.noteNode, oDecor = RegionSync.noteDecor;
    RegionSync.noteNode = function (node) {
      try {
        if (node && !node.station && node.respawnAt)
          send({ t: "n", k: "node:" + node.x + "," + node.y,
                 v: { left: 0, leftMax: node.leftMax || null }, e: node.respawnAt });
      } catch (e) {}
      return oNode(node);
    };
    RegionSync.noteDecor = function (x, y, respawnAtLocal) {
      try { send({ t: "n", k: "decor:" + x + "," + y, v: {}, e: respawnAtLocal }); } catch (e) {}
      return oDecor(x, y, respawnAtLocal);
    };
  }

  if (typeof Server !== "undefined") Server.onAuth(u => { if (!u) disconnect(); });
  addEventListener("beforeunload", () => { try { if (ws) ws.close(1000); } catch (e) {} });

  window.Live = {
    players,
    tick,
    connected: () => !!(ws && wsOpen),
    chatOn: () => !!(ws && wsOpen && flags.chat),
    tradeOn: () => !!(ws && wsOpen && flags.trade),
    myId: () => myId,
    sendChat: text => { if (flags.chat) send({ t: "chat", text: String(text).slice(0, 240) }); },
    sendTrade: m => { if (flags.trade) send(m); },
    onChat: fn => chatListeners.push(fn),
    onTrade: fn => tradeListeners.push(fn),
    onRoster: fn => rosterListeners.push(fn),
    status: () => ({ enabled: !!URL_, live: live(), connected: !!(ws && wsOpen),
                     zone: wsZone, players: players.size, flags: { ...flags } }),
  };
})();
