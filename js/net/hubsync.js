// ===== Our RPG — global presence (Phase 4: the whole world, at once) =====
// A second, slim WebSocket alongside livesync's zone socket — this one to the
// single GlobalHub Durable Object (server/src/hub.js). The zone socket shows
// the players sharing your patch of ground; this one answers "who is online
// anywhere" and carries direct messages to anyone, in any zone.
//
//   OUT  hello (combat level + a short "where" label), presence updates when
//        those change, and direct messages
//   IN   the full online roster + join/leave/upd, and DMs addressed to you
//
// Same liveness rules as livesync: logged out, in DEV_MODE, or still on Tūhura
// Isle, nothing here runs.
"use strict";

(function () {
  const DEV = typeof DEV_MODE !== "undefined" && DEV_MODE;
  const TOKEN_KEY = "taiao_session_v1";
  const PING_EVERY = 25e3;
  const RETRY_MIN = 2e3, RETRY_MAX = 60e3;

  if (DEV) {
    window.Hub = { online: new Map(), tick: () => {}, connected: () => false,
      myId: () => 0, sendDM: () => false, onDM: () => {}, onRoster: () => {},
      status: () => ({ enabled: false }) };
    return;
  }

  const URL_ = typeof SERVER_URL !== "undefined" ? SERVER_URL : "";

  const onIsle = () => typeof player !== "undefined" && player.tutorial &&
    typeof player.tutorial === "object" && !player.tutorial.graduated;
  const live = () => !!URL_ && typeof Server !== "undefined" && Server.logged() &&
    typeof gameReady !== "undefined" && gameReady && !onIsle();

  const online = new Map();   // id -> { name, clvl, zone }
  let ws = null, wsOpen = false, helloSent = false;
  let retryIn = RETRY_MIN, retryAt = 0, pingAt = 0, manageAt = 0;
  let myId = 0;
  let lastClvl = -1, lastZone = null;
  const dmListeners = [], rosterListeners = [];
  const fire = (fns, m) => { for (const fn of fns) { try { fn(m); } catch (e) {} } };
  const clvlNow = () => (typeof combatLevel === "function" ? combatLevel() : 1) | 0;

  // a short human "where" — the nearest settlement if there is one close, else
  // the zone's grid coordinate. Cheap and best-effort; never throws.
  function whereLabel() {
    try {
      if (typeof world === "undefined" || !world) return "";
      let label = "";
      if (world.villagesNear) {
        const vs = world.villagesNear(player.x, player.y, player.x, player.y, 64) || [];
        let best = null, bestD = Infinity;
        for (const v of vs) {
          if (!v || v.x == null) continue;
          const d = Math.abs(v.x - player.x) + Math.abs(v.y - player.y);
          if (d < bestD) { bestD = d; best = v; }
        }
        if (best && best.name && bestD <= 90) label = best.name;
      }
      if (!label && world.zoneOf) { const z = world.zoneOf(player.x, player.y); label = "the wilds (" + z[0] + "," + z[1] + ")"; }
      return String(label).slice(0, 40);
    } catch (e) { return ""; }
  }

  function send(obj) { if (ws && wsOpen) { try { ws.send(JSON.stringify(obj)); } catch (e) {} } }

  function connect() {
    const token = (() => { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } })();
    if (!token) return;
    const url = URL_.replace(/^http/, "ws") + "/api/hub/ws";
    let sock;
    try { sock = new WebSocket(url, ["taiao-hub", "tk." + token]); } catch (e) { return; }
    ws = sock; wsOpen = false; helloSent = false;
    sock.onopen = () => { if (sock !== ws) return; wsOpen = true; retryIn = RETRY_MIN; hello(); };
    sock.onmessage = ev => { if (sock === ws) onMessage(ev.data); };
    sock.onclose = () => { if (sock === ws) dropped(); };
    sock.onerror = () => { try { sock.close(); } catch (e) {} };
  }
  function dropped() {
    ws = null; wsOpen = false; helloSent = false;
    online.clear(); fire(rosterListeners, online);
    retryAt = Date.now() + retryIn;
    retryIn = Math.min(RETRY_MAX, retryIn * 2);
  }
  function disconnect() {
    if (ws) { const s = ws; ws = null; try { s.close(1000); } catch (e) {} }
    wsOpen = false; helloSent = false;
    online.clear(); fire(rosterListeners, online);
  }

  function hello() {
    myId = (Server.user && Server.user.id) | 0;
    lastClvl = clvlNow(); lastZone = whereLabel();
    send({ t: "hello", clvl: lastClvl, zone: lastZone });
    helloSent = true;
  }

  function onMessage(raw) {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || !m.t) return;
    switch (m.t) {
      case "roster":
        online.clear();
        for (const p of m.players || []) if (p && p.id && p.id !== myId) online.set(p.id, { name: String(p.name || "?"), clvl: p.clvl | 0, zone: String(p.zone || "") });
        fire(rosterListeners, online);
        return;
      case "join":
        if (m.p && m.p.id && m.p.id !== myId) { online.set(m.p.id, { name: String(m.p.name || "?"), clvl: m.p.clvl | 0, zone: String(m.p.zone || "") }); fire(rosterListeners, online); }
        return;
      case "leave":
        if (online.delete(m.id)) fire(rosterListeners, online);
        return;
      case "upd": {
        const o = online.get(m.id);
        if (o) { o.clvl = m.clvl | 0; o.zone = String(m.zone || ""); fire(rosterListeners, online); }
        return;
      }
      case "sync": hello(); return;
      case "pong": return;
      case "dm":
        // both the message you receive and the echo of one you sent land here;
        // the UI tells them apart by from === myId
        fire(dmListeners, m);
        return;
    }
  }

  function tick(dt) {
    const t = Date.now();
    if (t < manageAt) return;
    manageAt = t + 1000;
    if (!live()) { if (ws) disconnect(); return; }
    if (!ws) { if (t >= retryAt) connect(); return; }
    if (!wsOpen || !helloSent) return;
    if (t >= pingAt) { pingAt = t + PING_EVERY; send({ t: "ping" }); }
    // presence upkeep: tell the hub when our combat level or area changes
    const cl = clvlNow(), zn = whereLabel();
    if (cl !== lastClvl || zn !== lastZone) {
      lastClvl = cl; lastZone = zn;
      send({ t: "u", clvl: cl, zone: zn });
    }
  }

  if (typeof Server !== "undefined") Server.onAuth(u => { if (!u) disconnect(); });
  addEventListener("beforeunload", () => { try { if (ws) ws.close(1000); } catch (e) {} });

  window.Hub = {
    online,
    tick,
    connected: () => !!(ws && wsOpen),
    myId: () => myId,
    myName: () => (Server.user && Server.user.username) || "",
    sendDM(to, text) {
      to = to | 0;
      const body = String(text || "").slice(0, 500).trim();
      if (!to || !body || !(ws && wsOpen)) return false;
      send({ t: "dm", to, text: body });
      return true;
    },
    // find an online player id by (case-insensitive) name — for /w <name>
    idByName(name) {
      const n = String(name || "").toLowerCase();
      for (const [id, o] of online) if (String(o.name).toLowerCase() === n) return id;
      return 0;
    },
    onDM: fn => dmListeners.push(fn),
    onRoster: fn => rosterListeners.push(fn),
    status: () => ({ enabled: !!URL_, connected: !!(ws && wsOpen), online: online.size }),
  };
})();
