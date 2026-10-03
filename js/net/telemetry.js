// ===== Taiao — gameplay telemetry: the full action stream =====
// Records every player action as a timestamped event and ships batches to the
// server (POST /api/telemetry), so we can see which parts of the game hold
// attention and which get abandoned. Where pulse.js keeps local per-player
// verdicts and actionlog.js keeps hourly anti-cheat summaries, this is the
// raw stream: tile moves, clicks, gathers, equips, fights, examines, ladders,
// NPC talks, XP ticks, camera moves, UI panel use, task queueing, splits,
// banking and trading.
//
// Same wrap-by-reassignment pattern as pulse.js (fall through to the original
// even if our bookkeeping throws), plus a 250 ms sampler for state nobody
// funnels through a function (tile position, player.act, panel visibility,
// camera). Events are compact arrays [t, type, ...fields]; batches carry a
// device id (anonymous, persisted), the login session when present, the
// character index and DEV_MODE flag so analysis can slice or drop dev play.
//
// Wholly inert when the build has no SERVER_URL. Players can switch it off:
// the "Share gameplay data" select in the help tab (taiaoTelemetry = "off").
// Unsent events survive refreshes in a capped localStorage backlog; when the
// server is unreachable they queue there and drain later — never blocking or
// slowing play.
"use strict";

(function () {
  const ENABLED = typeof SERVER_URL !== "undefined" && !!SERVER_URL;
  const stub = { ev: () => {}, flush: () => {}, report: () => null, optedOut: () => true };
  if (!ENABLED) { window.Tele = stub; return; }

  const LS_OPT = "taiaoTelemetry";        // "off" = player said no
  const LS_DEV = "taiao_device_v1";       // anonymous install id
  const LS_BACKLOG = "taiao_tele_backlog_v1";
  const FLUSH_MS = 25000;                 // batch cadence
  const FLUSH_AT = 400;                   // ...or when this many events queue
  const Q_HARD_CAP = 3000;                // in-memory ceiling (drop oldest)
  const BACKLOG_CAP = 4000;               // LS ceiling across refreshes
  const CAM_SETTLE_MS = 700;              // a zoom/turn logs once it stops

  // Cache the opt-out once (PERF): ev() fires on every xp/item/kill/move tick —
  // a synchronous localStorage.getItem per event hitched tight crafting/combat
  // bursts. Read it once here; the settings toggle below keeps it in sync, which
  // is the only place the value ever changes in-session.
  let _optedOut = false;
  try { _optedOut = localStorage.getItem(LS_OPT) === "off"; } catch (e) {}
  function optedOut() { return _optedOut; }

  // ---------- identity ----------
  let device = null;
  try { device = localStorage.getItem(LS_DEV); } catch (e) {}
  if (!device) {
    device = "d" + Date.now().toString(36) +
      Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(36).slice(-1)).join("");
    try { localStorage.setItem(LS_DEV, device); } catch (e) {}
  }
  const session = Date.now().toString(36) + "-" +
    Math.floor(Math.random() * 1e9).toString(36);

  // ---------- queue ----------
  let Q = [];
  try {
    const back = JSON.parse(localStorage.getItem(LS_BACKLOG) || "null");
    if (Array.isArray(back)) Q = back.slice(-BACKLOG_CAP);
    localStorage.removeItem(LS_BACKLOG);
  } catch (e) {}
  let batchSeq = 0, inFlight = false, dropped = 0;

  function ev(type, ...fields) {
    if (optedOut()) return;
    Q.push([Date.now(), type, ...fields]);
    if (Q.length > Q_HARD_CAP) { Q.splice(0, Q.length - Q_HARD_CAP); dropped++; }
    if (Q.length >= FLUSH_AT) flush();
  }

  function saveBacklog() {
    try {
      if (Q.length) localStorage.setItem(LS_BACKLOG, JSON.stringify(Q.slice(-BACKLOG_CAP)));
      else localStorage.removeItem(LS_BACKLOG);
    } catch (e) {}
  }

  async function flush(final) {
    if (inFlight || !Q.length || optedOut()) return;
    if (typeof Server === "undefined") return;
    // keepalive requests are size-capped by the browser (~64 KB) — a final
    // flush sends only a tail-slice and stashes the rest for next boot
    const events = final ? Q.slice(-600) : Q.splice(0);
    if (final) { Q = Q.slice(0, -600); saveBacklog(); }
    inFlight = true;
    const body = {
      v: 1, device, session, seq: ++batchSeq, now: Date.now(),
      char: typeof player !== "undefined" && player ? (player.character ?? null) : null,
      dev: typeof DEV_MODE !== "undefined" && DEV_MODE ? 1 : 0,
      build: typeof WORLDGEN_SIG !== "undefined" ? WORLDGEN_SIG : "?",
      dropped, events,
    };
    try {
      const r = await Server.call("/api/telemetry", { body, keepalive: !!final });
      if (r && r.ok) { dropped = 0; saveBacklog(); }
      else if (!final) { Q = events.concat(Q); saveBacklog(); }   // retry later
    } catch (e) {
      if (!final) { Q = events.concat(Q); saveBacklog(); }
    } finally { inFlight = false; }
  }
  setInterval(() => flush(), FLUSH_MS);

  // ---------- helpers ----------
  const rnd1 = v => Math.round(v * 10) / 10;
  // name a click/goal target for the log: monsters by kind, NPCs by name,
  // nodes/items/placed things by id — whatever the object carries
  function goalName(goal) {
    if (!goal) return null;
    if (goal.mon) return goal.mon.kind || null;
    if (goal.npc) return goal.npc.name || null;
    if (goal.node) return goal.node.kind || goal.node.type || goal.node.id || null;
    if (goal.item) return goal.item.id || null;
    if (goal.ent) return goal.ent.id || null;
    return null;
  }
  // ---------- choke-point wraps ----------
  // Every wrapper falls through to the original even when logging throws.
  if (typeof setGoal === "function") {
    const orig = setGoal;
    setGoal = function (goal, tx, ty, reach) {
      try { ev("goal", goal && goal.type || "?", goalName(goal), Math.round(tx), Math.round(ty)); } catch (e) {}
      return orig(goal, tx, ty, reach);
    };
  }
  if (typeof buildTileMenu === "function") {
    // instrument the tile action menu so the CHOSEN action logs with its
    // label — this catches every left-click default and right-click pick:
    // Attack X, Talk to Y, Chop, Take, Examine, Walk here, ...
    const orig = buildTileMenu;
    buildTileMenu = function (t) {
      const items = orig(t);
      try {
        for (const it of items) {
          if (!it || typeof it.fn !== "function") continue;
          const fn = it.fn, label = it.label;
          it.fn = function (...a) {
            try { ev("click", String(label).slice(0, 60), t.x, t.y); } catch (e) {}
            return fn.apply(this, a);
          };
        }
      } catch (e) {}
      return items;
    };
  }
  if (typeof addXp === "function") {
    const orig = addXp;
    addXp = function (skill, amt, quiet) {
      try { if (amt > 0) ev("xp", skill, rnd1(amt)); } catch (e) {}
      return orig(skill, amt, quiet);
    };
  }
  if (typeof addItem === "function") {
    const orig = addItem;
    addItem = function (id, qty = 1, meta) {
      const r = orig(id, qty, meta);
      try { if (r) ev("gain", id, qty); } catch (e) {}
      return r;
    };
  }
  if (typeof removeItem === "function") {
    const orig = removeItem;
    removeItem = function (id, qty = 1) {
      try { ev("lose", id, qty); } catch (e) {}
      return orig(id, qty);
    };
  }
  if (typeof killMonster === "function") {
    const orig = killMonster;
    killMonster = function (mon) {
      try { ev("kill", (mon && mon.kind) || "?"); } catch (e) {}
      return orig(mon);
    };
  }
  if (typeof playerDie === "function") {
    const orig = playerDie;
    playerDie = function (by) {
      try { ev("die", String(by || "?").slice(0, 40)); flush(); } catch (e) {}
      return orig(by);
    };
  }
  if (typeof eatItem === "function") {
    const orig = eatItem;
    eatItem = function (i) {
      try { const s = player.inv && player.inv[i]; ev("eat", s ? s.id : "?"); } catch (e) {}
      return orig(i);
    };
  }
  if (typeof equipItem === "function") {
    const orig = equipItem;
    equipItem = function (i) {
      try { const s = player.inv && player.inv[i]; ev("equip", s ? s.id : "?"); } catch (e) {}
      return orig(i);
    };
  }
  if (typeof unequip === "function") {
    const orig = unequip;
    unequip = function (slot) {
      try { ev("unequip", String(slot)); } catch (e) {}
      return orig(slot);
    };
  }
  if (typeof useDoor === "function") {
    const orig = useDoor;
    useDoor = function (d) {
      try { ev("door", Math.round(d && d.x || player.x), Math.round(d && d.y || player.y)); } catch (e) {}
      return orig(d);
    };
  }
  if (typeof useLadder === "function") {
    const orig = useLadder;
    useLadder = function (b, m, dir) {
      try { ev("ladder", dir > 0 ? "up" : "down"); } catch (e) {}
      return orig(b, m, dir);
    };
  }
  if (typeof talkTo === "function") {
    const orig = talkTo;
    talkTo = function (npc) {
      try { ev("talk", npc && npc.name || "?", npc && npc.kind || npc && npc.job || null); } catch (e) {}
      return orig(npc);
    };
  }
  if (typeof examineItem === "function") {
    const orig = examineItem;
    examineItem = function (s) {
      try { ev("examine", s && s.id || "?"); } catch (e) {}
      return orig(s);
    };
  }
  if (typeof tradeBuy === "function") {
    const orig = tradeBuy;
    tradeBuy = function (id, price, n) {
      try { ev("buy", id, price, n || 1); } catch (e) {}
      return orig(id, price, n);
    };
  }
  if (typeof depositToBank === "function") {
    const orig = depositToBank;
    depositToBank = function (i, n) {
      try { const s = player.inv && player.inv[i]; if (s) ev("bank", "dep", s.id, Math.min(n, s.qty)); } catch (e) {}
      return orig(i, n);
    };
  }
  if (typeof openBank === "function") {
    const orig = openBank;
    openBank = function (node) {
      try { ev("ui", "bank", 1); } catch (e) {}
      return orig(node);
    };
  }
  if (typeof openMarket === "function") {
    const orig = openMarket;
    openMarket = function (npc) {
      try { ev("ui", "trade", 1); } catch (e) {}
      return orig(npc);
    };
  }
  if (typeof showPanel === "function") {
    const orig = showPanel;
    showPanel = function (name) {
      try { ev("ui", "panel:" + name, 1); } catch (e) {}
      return orig(name);
    };
  }
  if (typeof toggleSoapsMenu === "function") {
    const orig = toggleSoapsMenu;
    toggleSoapsMenu = function () {
      try { ev("ui", "soaps", typeof soapsMenuOpen === "function" && soapsMenuOpen() ? 0 : 1); } catch (e) {}
      return orig();
    };
  }
  // task queueing (Option/Alt+click) — Split's methods live on its exposed
  // object, so property reassignment reaches every external caller
  if (typeof Split !== "undefined" && Split) {
    if (typeof Split.tryQueueClick === "function") {
      const orig = Split.tryQueueClick;
      Split.tryQueueClick = function (item) {
        try { ev("queue", item && String(item.label).slice(0, 60) || "?"); } catch (e) {}
        return orig.call(Split, item);
      };
    }
    if (typeof Split.capture === "function") {
      const orig = Split.capture;
      Split.capture = function (goal, x, y, reach) {
        const r = orig.call(Split, goal, x, y, reach);
        try { if (r) ev("queue", goal ? (goal.type || "?") : "walk", Math.round(x), Math.round(y)); } catch (e) {}
        return r;
      };
    }
  }

  // ---------- the 250 ms sampler: position, actions, panels, camera ----------
  let lastTile = null;         // "x,y,lvl"
  let curAct = null;           // {kind, name, at}
  const uiOpen = {};           // watched panel -> last seen open state
  let camPending = null;       // {zoom, step, at} awaiting settle
  let camLast = null;          // last LOGGED {zoom, step}
  let wmZoomLast = null;

  function domOpen(id) {
    const el = document.getElementById(id);
    return !!(el && (el.classList.contains("open") || el.classList.contains("show")));
  }
  function watchUi(key, open) {
    if (!!open === !!uiOpen[key]) return;
    uiOpen[key] = !!open;
    ev("ui", key, open ? 1 : 0);
  }

  function sample() {
    if (typeof gameReady === "undefined" || !gameReady) return;
    if (typeof player === "undefined" || !player) return;

    // every tile moved to (the active body)
    const tx = Math.round(player.x), ty = Math.round(player.y), lvl = player.level | 0;
    const tileKey = tx + "," + ty + "," + lvl;
    if (tileKey !== lastTile) {
      lastTile = tileKey;
      ev("move", tx, ty, lvl);
    }

    // action start/end (chop, mine, fish, craft, combat, ...): log on END
    // with its kind, the skill that named it (pulse's act._pk) and duration
    const act = player.act;
    const kind = act ? (act._pk || "act:" + act.kind) : null;
    if (curAct && (!act || kind !== curAct.kind)) {
      ev("act", curAct.kind, Math.round((Date.now() - curAct.at) / 1000));
      curAct = null;
    }
    if (act && !curAct) curAct = { kind, at: Date.now() };
    else if (act && curAct) curAct.kind = kind;   // act learned its skill name

    // UI panels that don't funnel through a function
    watchUi("map", typeof wm !== "undefined" && wm && wm.open);
    watchUi("bestiary", domOpen("bestiary"));
    watchUi("quests", domOpen("questlog"));
    watchUi("skillguide", domOpen("skillguide"));
    watchUi("soaps", typeof soapsMenuOpen === "function" && soapsMenuOpen());
    {
      const p = document.getElementById("pulsepanel");
      watchUi("pulse", !!(p && p.style.display !== "none" && p.style.display !== ""));
    }
    if (typeof wm !== "undefined" && wm && wm.open && wm.zoom !== wmZoomLast) {
      if (wmZoomLast != null) ev("wmzoom", wm.zoom);
      wmZoomLast = wm.zoom;
    }

    // camera: log zoom/rotation once movement settles, not every frame
    try {
      const z = rnd1(typeof camZoom !== "undefined" ? camZoom : 1);
      const st = typeof camStep !== "undefined" ? (camStep & 3) : 0;
      if (!camLast) camLast = { zoom: z, step: st };
      else if (z !== camLast.zoom || st !== camLast.step) {
        if (!camPending || camPending.zoom !== z || camPending.step !== st)
          camPending = { zoom: z, step: st, at: Date.now() };
        else if (Date.now() - camPending.at >= CAM_SETTLE_MS) {
          camLast = { zoom: z, step: st };
          camPending = null;
          ev("cam", z, st);
        }
      } else camPending = null;
    } catch (e) {}
  }
  setInterval(() => { try { sample(); } catch (e) {} }, 250);

  // ---------- session bracket + unload ----------
  ev("session", "start",
    typeof WORLDGEN_SIG !== "undefined" ? WORLDGEN_SIG : "?",
    typeof DEV_MODE !== "undefined" && DEV_MODE ? 1 : 0);
  let ended = false;
  function onEnd() {
    if (ended) return;
    ended = true;
    try {
      if (curAct) ev("act", curAct.kind, Math.round((Date.now() - curAct.at) / 1000));
      ev("session", "end");
      saveBacklog();   // even if a flush is mid-flight, nothing is lost
      flush(true);
    } catch (e) {}
  }
  window.addEventListener("pagehide", onEnd);
  window.addEventListener("beforeunload", onEnd);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { saveBacklog(); flush(); }
    else ended = false;
  });

  // ---------- settings toggle (help tab, next to motion/font-scale) ----------
  function wireToggle() {
    const sel = document.getElementById("telemetrysel");
    if (!sel) return;
    sel.value = optedOut() ? "off" : "on";
    sel.addEventListener("change", () => {
      try {
        if (sel.value === "off") localStorage.setItem(LS_OPT, "off");
        else localStorage.removeItem(LS_OPT);
      } catch (e) {}
      _optedOut = sel.value === "off"; // keep the cached flag in sync with the setting
      if (sel.value === "off") { Q = []; saveBacklog(); }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireToggle);
  else wireToggle();

  window.Tele = {
    ev, flush, optedOut,
    report: () => ({ device, session, queued: Q.length, sentBatches: batchSeq, dropped }),
  };
})();
