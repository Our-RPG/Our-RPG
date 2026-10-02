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
  // Drop a remote only after a LONG silence. The server broadcasts leave
  // reliably, and idle players now heartbeat their position every 45s — the
  // old 180s prune made a standing trade partner literally vanish mid-trade.
  const STALE_MS = 600e3;
  const HEARTBEAT_MS = 45e3;                  // idle position re-announce
  const RETRY_MIN = 2e3, RETRY_MAX = 60e3;

  if (DEV) {
    window.Live = { players: new Map(), tick: () => {}, connected: () => false,
      chatOn: () => false, tradeOn: () => false, sendChat: () => {}, sendTrade: () => {},
      onChat: () => {}, onTrade: () => {}, onRoster: () => {}, myId: () => 0,
      sendE: () => {}, onE: () => {}, sendFeed: () => {}, onFeed: () => {},
      sendGive: () => {}, onGift: () => {}, sendGiftAck: () => {}, nameOf: () => "",
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
  const entListeners = [], feedListeners = [], giftListeners = [];
  const followListeners = [], commListeners = [], hitchListeners = [];
  let commRate = 0;   // average coins/tile the DO reports (0 = none yet → formula)
  const fire = (fns, m) => { for (const fn of fns) { try { fn(m); } catch (e) {} } };
  // the light the local player carries, as a sync-able brightness tier
  const myCndl = () => (typeof candleInHand === "function" ? candleInHand() : 0) | 0;

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
           character: player.character, outfit: player.outfit || "Idle",
           cndl: myCndl(),
           hp: player.hp | 0, mhp: (typeof maxHp === "function" ? maxHp() : player.hp) | 0 });
    helloSent = true;
    // re-announce whatever we're mid-doing so a fresh zone sees it
    lastAct = undefined; lastOutfit = undefined; lastSp = undefined; lastHp = undefined;
    heartbeatAt = Date.now() + HEARTBEAT_MS;
  }

  // ---------- inbound ----------
  function upsert(p) {
    if (!p || !p.id || p.id === myId) return null;
    let rp = players.get(p.id);
    if (!rp) {
      rp = { id: p.id, name: "?", x: 0, y: 0, px: 0, py: 0, level: 0, clvl: 0,
             dir8: "south", moving: null, character: null, outfit: "Idle",
             act: null, cndl: 0, sp: null, _say: null, last: Date.now(),
             // combat visuals (net fx channel): hp/mhp drive the overhead
             // bar, lungeT/lungeDir replay the attack animation on their body
             hp: null, mhp: null, lungeT: -9999, lungeDir: [0, 0] };
      players.set(p.id, rp);
    }
    if (p.name != null) rp.name = String(p.name);
    if (p.x != null) { rp.x = p.x; rp.y = p.y; rp.px = PX(p.x); rp.py = PX(p.y); }
    if (p.lvl != null) rp.level = p.lvl | 0;
    if (p.clvl != null) rp.clvl = p.clvl | 0;
    if (p.character !== undefined) rp.character = p.character;
    if (p.outfit !== undefined) rp.outfit = p.outfit || "Idle";
    if (p.act !== undefined) rp.act = p.act;
    if (p.cndl !== undefined) rp.cndl = p.cndl | 0;
    if (p.hp != null) rp.hp = p.hp | 0;
    if (p.mhp != null) rp.mhp = p.mhp | 0;
    if (p.sp !== undefined) rp.sp = applySp(rp, p.sp);
    rp.last = Date.now();
    return rp;
  }
  // split-self ghost bodies of a remote player: [[x,y,d8,storey,clvl,act],...]
  // → slim body objects with their own pixel coords (eased in tick so ghosts
  // glide between the 600ms announcements), their OWN combat level (split
  // halves xp, so each body's level differs) and current action for the
  // overhead nameplate + indicator.
  const ACT_DECODE = { g: "gather", c: "combat", r: "craft" };
  function applySp(rp, b) {
    if (!b || !b.length) return null;
    const prev = rp.sp || [];
    return b.map((e, i) => {
      const o = prev[i] || { x: e[0], y: e[1], px: PX(e[0]), py: PX(e[1]) };
      o.tx = e[0]; o.ty = e[1]; o.dir8 = e[2] || "south"; o.level = e[3] | 0;
      o.clvl = e[4] | 0; o.act = ACT_DECODE[e[5]] || null;
      return o;
    });
  }
  // ---- remote visual events (fx): reproduce on the sender's body exactly
  // what the sender saw on theirs — the lunge of a swing, the hitsplat and
  // health drop of a blow landing, the arrow or spell in flight, the floating
  // xp. These ride the shared splats/floats/projectiles arrays (state.js),
  // which already prune themselves, and render through the same loops as the
  // local player's own effects. _fxApplying stops the outbound wraps below
  // from echoing an event we're only replaying.
  let _fxApplying = false;
  function applyFx(rp, m) {
    _fxApplying = true;
    try {
      const T = (typeof now !== "undefined" ? now : Date.now());
      if (m.hp != null) rp.hp = m.hp | 0;
      if (m.mhp != null) rp.mhp = m.mhp | 0;
      switch (m.k) {
        case "lg":   // a swing/shot/cast — lunge their body toward the target
          rp.lungeT = T;
          rp.lungeDir = Array.isArray(m.d) ? [Math.sign(m.d[0] || 0), Math.sign(m.d[1] || 0)] : [0, 0];
          return;
        case "ht":   // a blow landed on them — hitsplat over their body
          if (typeof addSplat === "function") addSplat(rp, m.v | 0);
          return;
        case "hp":   // health changed with no splat (heal, regen) — bar only
          return;
        case "fl":   // floating text (xp, level-up) over their head
          if (typeof addFloat === "function" && m.s)
            addFloat(String(m.s).slice(0, 48), rp.px, rp.py - 30, m.c || "#8ff08f", m.z | 0 || 13);
          return;
        case "pj": { // a projectile they loosed — visual only (no dmg field so
                     // tickArrows skips it; it auto-prunes on its own duration)
          const p = m.p; if (!p || typeof projectiles === "undefined") return;
          const proj = { kind: String(p.kind || "arrow").slice(0, 8),
            x0: +p.x0 || 0, y0: +p.y0 || 0, x1: +p.x1 || 0, y1: +p.y1 || 0,
            t0: T, dur: Math.max(60, Math.min(5000, +p.dur || 400)), stick: p.hitT != null ? 900 : 0,
            h0: p.h0, h1: p.h1, peak: p.peak, hitT: p.hitT, col: p.col ? String(p.col).slice(0, 12) : undefined,
            _remote: true };
          projectiles.push(proj);
          if (_sentProj) _sentProj.add(proj);   // never echo a projectile we only replayed
          return;
        }
      }
    } catch (e) { /* a bad fx must never break the frame */ }
    finally { _fxApplying = false; }
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
      case "s": { const rp = known(m.id); if (rp) upsert({ id: m.id, character: m.character, outfit: m.outfit, cndl: m.cndl }); return; }
      case "sp": { const rp = known(m.id); if (rp) { rp.sp = applySp(rp, m.b); rp.last = Date.now(); } return; }
      case "a": { const rp = known(m.id); if (rp) { rp.act = m.k || null; rp.last = Date.now(); } return; }
      case "fx": {   // a remote player's visual combat event — show it on THEIR
                     // body exactly as it looked on theirs (net parity)
        const rp = players.get(m.id); if (!rp) return;
        applyFx(rp, m);
        rp.last = Date.now();
        return;
      }
      case "E":     // entity-sync batch from a proximity authority (entsync.js)
        fire(entListeners, m);
        return;
      case "fe":    // someone fed us — the eater applies the food locally
        fire(feedListeners, m);
        return;
      case "gcommit": // a gift addressed to us (escrowed server-side until gack)
        fire(giftListeners, m);
        return;
      case "fol":   // someone started/stopped following us
        fire(followListeners, m);
        return;
      // commission (pay-to-be-guided) negotiation + escrow settlement
      case "cm": case "cmok": case "cmno": case "cmstart": case "cmpay":
        fire(commListeners, m);
        return;
      case "commrate":   // the zone's average travel rate (coins/tile)
        commRate = +m.r > 0 ? +m.r : 0;
        return;
      // hitchhiking: public roadside offers + a driver's pickup
      case "hh": case "hhcancel": case "hhpick":
        fire(hitchListeners, m);
        return;
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
      case "ti": case "to": case "ta": case "tc": case "tcommit":
        // tcommit was MISSING here — the server's committed swap fell through
        // the switch unseen, so trades hung forever at "Exchanging…" (the
        // 2026-10-02 "trading doesn't work" report). live-ui.js applyCommit
        // has always been ready for it.
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
  let lastAct, lastOutfit, lastCharacter, lastCndl, lastSp, lastHp;
  let heartbeatAt = 0, spAt = 0, lastLungeT = -9999;
  const _sentProj = typeof WeakSet === "function" ? new WeakSet() : null;

  // combat level of a split body from its OWN skills (split halves xp, so each
  // body's level differs) — mirrors state.js combatLevel() on a given set
  function clvlOf(sk) {
    if (!sk || typeof levelFromXp !== "function") return 0;
    const L = s => levelFromXp(sk[s] || 0);
    return Math.ceil(((L("Strength") + L("Archery") + L("Magic")) / 3 + L("Melee") + L("Defence")) / 3 + 1);
  }
  const ACT_ENCODE = { gather: "g", combat: "c", craft: "r", farm: "g", agility: "g" };
  const actCode = a => (a && a.kind && ACT_ENCODE[a.kind]) || "";
  // true only mid ghost-tick: combat visuals are broadcast for the ACTIVE
  // body only (a ghost's `player`-swap would mislabel the event's owner)
  const ghosting = () => typeof Split !== "undefined" && Split.isGhost && Split.isGhost();

  function watchOutbound() {
    // movement: one message per tile step, sent the moment it STARTS — the
    // one-way latency hides inside the step's own duration
    const mv = player.moving;
    const clvl = (typeof combatLevel === "function" ? combatLevel() : 1) | 0;
    const tNow = Date.now();
    if (mv && mv !== lastMoving) {
      lastMoving = mv;
      send({ t: "m", fx: mv.fx, fy: mv.fy, tx: mv.tx, ty: mv.ty,
             dur: Math.round(mv.dur), d8: player.dir8, lvl: player.level | 0, clvl });
      lastX = mv.tx; lastY = mv.ty; lastLvl = player.level | 0;
      heartbeatAt = tNow + HEARTBEAT_MS;
    } else if (!mv) {
      lastMoving = null;
      // position changed with no step animating = a teleport (door, veil,
      // respawn, Bifrost) — remotes snap. The same message doubles as the
      // IDLE HEARTBEAT: a player standing still (trading, chatting, afk at a
      // bank) re-announces every 45s so remotes never stale-prune them and
      // the zone DO's attachment keeps a fresh position across hibernation.
      if (player.x !== lastX || player.y !== lastY || (player.level | 0) !== lastLvl ||
          tNow >= heartbeatAt) {
        lastX = player.x; lastY = player.y; lastLvl = player.level | 0;
        heartbeatAt = tNow + HEARTBEAT_MS;
        send({ t: "tp", x: player.x, y: player.y, d8: player.dir8, lvl: lastLvl, clvl });
      }
    }
    // action state (mining/fighting/crafting…) — remotes show an indicator
    const act = player.act ? (player.act.kind === "gather" || player.act.kind === "combat"
      ? player.act.kind : "craft") : null;
    if (act !== lastAct) { lastAct = act; send({ t: "a", k: act }); }
    // appearance — including the light we carry (remotes draw our candle glow)
    const cndl = myCndl();
    if (player.outfit !== lastOutfit || player.character !== lastCharacter || cndl !== lastCndl) {
      lastOutfit = player.outfit; lastCharacter = player.character; lastCndl = cndl;
      send({ t: "s", character: player.character, outfit: player.outfit || "Idle", cndl });
    }
    // split selves: announce each ghost body's tile, facing, storey, its OWN
    // combat level and current action (throttled; only on change) — remotes
    // draw a full nameplate (our username + that body's level) and indicator
    if (tNow >= spAt) {
      spAt = tNow + 600;
      let sp = null;
      if (typeof Split !== "undefined" && player.bodies && player.bodies.length) {
        sp = player.bodies.slice(0, 4).map(b =>
          [b.x, b.y, b.dir8 || "south", b.level | 0, clvlOf(b.skills), actCode(b.act)]);
      }
      const key = sp ? JSON.stringify(sp) : null;
      if (key !== lastSp) { lastSp = key; send({ t: "sp", b: sp }); }
    }
    // combat visuals (active body only — ghost ticks swap `player`):
    if (!ghosting()) {
      // a swing/shot/cast lunges the body — rebroadcast when lungeT advances
      if (player.lungeT !== lastLungeT && (tNow - player.lungeT) < 400) {
        lastLungeT = player.lungeT;
        send({ t: "fx", k: "lg", d: player.lungeDir || [0, 0] });
      }
      // health changed with no splat (heal/regen/food) — keep the remote bar live
      const hp = player.hp | 0;
      if (hp !== lastHp) {
        lastHp = hp;
        send({ t: "fx", k: "hp", hp, mhp: (typeof maxHp === "function" ? maxHp() : hp) | 0 });
      }
      // arrows & spell bolts we've loosed this frame — reproduce them in flight
      // on every nearby screen (visual only; the shooter's client owns the hit)
      if (_sentProj && typeof projectiles !== "undefined" && players.size) {
        for (const pr of projectiles) {
          if (_sentProj.has(pr) || (tNow - pr.t0) > 200) { _sentProj.add(pr); continue; }
          _sentProj.add(pr);
          send({ t: "fx", k: "pj", p: {
            kind: pr.kind, x0: pr.x0, y0: pr.y0, x1: pr.x1, y1: pr.y1, dur: Math.round(pr.dur),
            h0: pr.h0, h1: pr.h1, peak: pr.peak, hitT: pr.hitT, col: pr.col } });
        }
      }
    }
  }

  // ---------- per-frame tick (main.js) ----------
  function tick(dt) {
    // advance remote interpolations even while our own sim is paused
    // (cutscenes) — the world keeps moving for everyone else
    for (const rp of players.values()) {
      const m = rp.moving;
      if (m) {
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
      // split-self ghosts glide toward their last-announced tile (announcements
      // come every ~600ms, so the ease closes the gap in about that long)
      if (rp.sp) for (const b of rp.sp) {
        b.x = b.tx; b.y = b.ty;
        const gx = PX(b.tx), gy = PX(b.ty);
        const k = Math.min(1, dt / 500);
        b.px += (gx - b.px) * k;
        b.py += (gy - b.py) * k;
        if (Math.abs(gx - b.px) > PX(3) - PX(0)) b.px = gx;   // too far — snap
        if (Math.abs(gy - b.py) > PX(3) - PX(0)) b.py = gy;
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

  // ---------- combat-visual relays (wrap-by-reassignment) ----------
  // A hitsplat over the PLAYER (a blow landing, a heal) is drawn via
  // addSplat(player, val) — rebroadcast it so everyone sees the hit land and
  // the health bar move. addFloat over the player (xp, level-up, "well fed")
  // rebroadcasts too, so onlookers see them earning it. The entsync addSplat
  // wrap (monsters) and this one stack; each ignores the other's entity.
  if (typeof addSplat === "function") {
    const oSplat = addSplat;
    addSplat = function (ent, val, delay) {
      try {
        if (!_fxApplying && ent === player && !ghosting() && (ws && wsOpen) && players.size) {
          send({ t: "fx", k: "ht", v: val | 0,
                 hp: player.hp | 0, mhp: (typeof maxHp === "function" ? maxHp() : player.hp) | 0 });
          lastHp = player.hp | 0;   // the splat already carried hp — don't double with an "hp" fx
        }
      } catch (e) {}
      return oSplat(ent, val, delay);
    };
  }
  if (typeof addFloat === "function") {
    const oFloat = addFloat;
    addFloat = function (text, x, y, color, size) {
      try {
        // only the player's OWN overhead floats (xp etc.), not effects placed
        // elsewhere (remote deeds, map markers): match on position near us
        if (!_fxApplying && !ghosting() && (ws && wsOpen) && players.size &&
            Math.abs(x - player.px) < 70 && y < player.py && y > player.py - 140)
          send({ t: "fx", k: "fl", s: String(text).slice(0, 48), c: color, z: size | 0 });
      } catch (e) {}
      return oFloat(text, x, y, color, size);
    };
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
    ShopSync.noteSell = function (...args) {
      try { send({ t: "e", k: "sell", item: args[1], n: args[2] | 0 }); } catch (e) {}
      return oSell(...args);
    };
    ShopSync.noteBuy = function (...args) {
      try { send({ t: "e", k: "buy", item: args[1], n: args[2] | 0 }); } catch (e) {}
      return oBuy(...args);
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
    nameOf: id => { const rp = players.get(id); return (rp && rp.name) || ""; },
    sendChat: text => { if (flags.chat) send({ t: "chat", text: String(text).slice(0, 240) }); },
    sendTrade: m => { if (flags.trade) send(m); },
    // entity sync (js/net/entsync.js): authority batches out, everyone's in
    sendE: ops => { if (ops && ops.length) send({ t: "E", a: ops }); },
    onE: fn => entListeners.push(fn),
    // feeding & giving (right-click on a player)
    sendFeed: (to, item) => send({ t: "fe", to, item }),
    onFeed: fn => feedListeners.push(fn),
    sendGive: (to, items) => send({ t: "gv", to, items }),
    onGift: fn => giftListeners.push(fn),
    sendGiftAck: gid => send({ t: "gack", gid }),
    // follow notifications (net/player-actions.js)
    sendFollowNote: (to, on) => send({ t: "fol", to: to | 0, on: !!on }),
    onFollowNote: fn => followListeners.push(fn),
    // commission (pay-to-be-guided) — negotiation + escrow settlement
    sendCommissionOffer: (to, price, dx, dy) => send({ t: "cm", to: to | 0, price: price | 0, dx: dx | 0, dy: dy | 0 }),
    sendCommissionAccept: to => send({ t: "cmok", to: to | 0 }),
    sendCommissionDecline: to => send({ t: "cmno", to: to | 0 }),
    sendCommissionStart: (to, cid, price, dx, dy, dist) =>
      send({ t: "cmstart", to: to | 0, cid: String(cid), price: price | 0, dx: dx | 0, dy: dy | 0, dist: dist | 0 }),
    sendCommissionProgress: (cid, rem) => send({ t: "cmprog", cid: String(cid), rem: rem | 0 }),
    sendCommissionArrive: cid => send({ t: "cmarr", cid: String(cid) }),
    sendCommissionCancel: (cid, rem) => send({ t: "cmcancel", cid: String(cid), rem: rem | 0 }),
    sendCommissionPayAck: cid => send({ t: "cmpayack", cid: String(cid) }),
    onComm: fn => commListeners.push(fn),
    commRate: () => commRate,     // avg coins/tile (0 = unknown → use the formula)
    // hitchhiking (public roadside offers): broadcast an offer, withdraw it,
    // or (as a driver) pick up a hitchhiker
    sendHitch: (price, dx, dy) => send({ t: "hh", price: price | 0, dx: dx | 0, dy: dy | 0 }),
    sendHitchCancel: () => send({ t: "hhcancel" }),
    sendHitchPick: to => send({ t: "hhpick", to: to | 0 }),
    onHitch: fn => hitchListeners.push(fn),
    onChat: fn => chatListeners.push(fn),
    onTrade: fn => tradeListeners.push(fn),
    onRoster: fn => rosterListeners.push(fn),
    status: () => ({ enabled: !!URL_, live: live(), connected: !!(ws && wsOpen),
                     zone: wsZone, players: players.size, flags: { ...flags } }),
  };
})();
