// ===== Taiao — region mutation ledger sync (Phase 2: one world, shared) =====
// Your harvesting is felt in my world. The SHARED delta types (audit §4 +
// Phase-2 sharing policy) sync through one Durable Object per world region:
//
//   node:x,y     resource node depletion (trees/ores/gems/fishing spots)
//   decor:x,y    picked decoration
//   heat:x,y,l   station heat (a stoked forge stays hot for the next player)
//
// Crops, placed furniture and door unlocks are PERSONAL by policy (griefing;
// no land claims yet) and never sync. Regions are 8×8 chunks (256² tiles);
// we push our mutations and pull the 3×3 regions around the player.
//
// SERVER TIME IS CANONICAL for shared timers — but the global `now` stays
// local (shifting it would displace every persisted local wall-clock timer).
// Instead every record crosses the wire in server time and is converted at
// this boundary with the measured clock offset, so all clients agree on the
// moment a tree grows back while local saves stay untouched.
//
// Logged out (or in DEV_MODE, or on Tūhura Isle — every fresh player's isle
// is their own) nothing here runs and the world is exactly the offline one.
"use strict";

(function () {
  const DEV = typeof DEV_MODE !== "undefined" && DEV_MODE;
  const REGION_T = 256;                    // tiles per region side (8×8 chunks)
  const OUTBOX_KEY = "taiao_regionoutbox_v1";
  const CURSOR_KEY = "taiao_regioncursors_v1";
  const PUSH_EVERY = 20e3, PULL_EVERY = 60e3;

  if (DEV) { window.RegionSync = mkNoop(); return; }

  let outbox = {};                         // k -> {k, v, e}  (e in LOCAL ms)
  let cursors = {};                        // regionKey -> last seen seq
  try { outbox = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "{}") || {}; } catch (e) {}
  try { cursors = JSON.parse(localStorage.getItem(CURSOR_KEY) || "{}") || {}; } catch (e) {}
  const persistOutbox = () => { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)); } catch (e) {} };
  const persistCursors = () => { try { localStorage.setItem(CURSOR_KEY, JSON.stringify(cursors)); } catch (e) {} };

  // ---------- server clock ----------
  // off: serverNow ≈ Date.now() + off. Measured against /api/health with a
  // half-RTT correction; null until measured (sync waits for it).
  let off = null;
  async function measureClock() {
    const t0 = Date.now();
    const r = await Server.call("/api/health");
    if (r && r.ok && typeof r.t === "number") off = r.t + (Date.now() - t0) / 2 - Date.now();
  }
  const toServer = localMs => localMs + off;
  const toLocal = serverMs => serverMs - off;

  // ---------- gates ----------
  const onIsle = () => typeof player !== "undefined" && player.tutorial &&
    typeof player.tutorial === "object" && !player.tutorial.graduated;
  const live = () => typeof Server !== "undefined" && Server.enabled() && Server.logged() &&
    typeof gameReady !== "undefined" && gameReady && !onIsle();

  const regionOf = (x, y) => Math.floor(x / REGION_T) + "," + Math.floor(y / REGION_T);
  const coordsOf = k => k.split(":")[1].split(",").map(Number); // [x, y(, level)]

  // ---------- outbound notes (called from the game's mutation sites) ----------
  // Recording is cheap and unconditional-ish (even logged out, so a login
  // mid-session still shares your morning); the isle never records.
  function note(k, v, eLocal) {
    if (DEV || onIsle()) return;
    outbox[k] = { k, v, e: eLocal };
    persistOutbox();
  }
  function noteNode(node) {
    if (!node || node.station || !node.respawnAt) return;
    note("node:" + node.x + "," + node.y,
      { left: 0, leftMax: node.leftMax || null }, node.respawnAt);
  }
  function noteDecor(x, y, respawnAtLocal) {
    note("decor:" + x + "," + y, {}, respawnAtLocal);
  }
  function noteHeat(key) {                 // key = "x,y,level" (firemaking heatKey)
    const h = typeof stationHeat !== "undefined" && stationHeat.get(key);
    if (!h) return;
    note("heat:" + key, { peak: h.peak, burnMs: h.burnMs, tier: h.tier, stoked: h.stokedAt },
      h.stokedAt + h.burnMs);
  }

  // ---------- apply (inbound records, server-authoritative) ----------
  // A record with v=null (tombstone) or a past expiry means the default
  // state — the world healed. `pendingNodes` holds records whose chunk isn't
  // loaded yet; retried each pull tick, dropped once expired.
  const pendingNodes = new Map();
  function apply(rec) {
    try {
      const [kind] = rec.k.split(":");
      const eL = toLocal(rec.e);
      const healed = rec.v === null || eL <= Date.now();
      if (kind === "node") return applyNode(rec, eL, healed);
      if (kind === "decor") {
        const key = rec.k.slice(6);
        if (healed) pickedDecor.delete(key); else pickedDecor.set(key, eL);
      } else if (kind === "heat") {
        const key = rec.k.slice(5);
        if (healed) stationHeat.delete(key);
        else stationHeat.set(key, {
          peak: Number(rec.v.peak) || 0,
          stokedAt: rec.v.stoked != null ? toLocal(rec.v.stoked) : toLocal(rec.t),
          burnMs: Number(rec.v.burnMs) || 0,
          tier: Number(rec.v.tier) || 1,
        });
      }
      uiDirty = true;
    } catch (e) {}
  }
  function applyNode(rec, eL, healed) {
    const [x, y] = coordsOf(rec.k);
    const n = world.nodeAt(x, y);
    if (!n) { if (!healed) pendingNodes.set(rec.k, rec); return; }
    pendingNodes.delete(rec.k);
    if (healed) {
      if (!n.alive) { n.alive = true; if (n.leftMax != null) n.left = n.leftMax; n.respawnAt = 0; }
    } else {
      n.alive = false;
      n.left = 0;
      if (rec.v.leftMax != null) n.leftMax = rec.v.leftMax;
      n.respawnAt = eL;              // the server's word on when it returns
      if (typeof depletedNodes !== "undefined" && depletedNodes.indexOf(n) < 0)
        depletedNodes.push(n);
    }
    if (world.persistAt) world.persistAt(x, y);
    uiDirty = true;
  }

  // ---------- push / pull ----------
  let pushing = false, pulling = false;
  async function push() {
    if (pushing || !live() || off == null) return;
    const keys = Object.keys(outbox);
    if (!keys.length) return;
    pushing = true;
    try {
      const byRegion = {};
      for (const k of keys) {
        const [x, y] = coordsOf(k);
        (byRegion[regionOf(x, y)] ||= []).push(outbox[k]);
      }
      for (const [region, deltas] of Object.entries(byRegion).slice(0, 3)) {
        const r = await Server.call("/api/region/push?r=" + region, {
          body: { deltas: deltas.slice(0, 200).map(d => ({
            k: d.k,
            // v is opaque to the server, but any timestamps inside it must
            // cross the wire in server time like e does (heat's stokedAt)
            v: d.v && d.v.stoked != null ? { ...d.v, stoked: toServer(d.v.stoked) } : d.v,
            e: toServer(d.e),
          })) },
        });
        if (!r || !r.ok) continue;             // kept in the outbox, retried
        for (const d of deltas) delete outbox[d.k];
        for (const rec of r.records || []) apply(rec);   // adopt server time
      }
      persistOutbox();
    } catch (e) {} finally { pushing = false; }
  }

  async function pull() {
    if (pulling || !live() || off == null) return;
    pulling = true;
    try {
      const px = Math.floor(player.x / REGION_T), py = Math.floor(player.y / REGION_T);
      const parts = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const key = (px + dx) + "," + (py + dy);
        parts.push(key + ":" + (cursors[key] || 0));
      }
      const r = await Server.call("/api/region/pull?rs=" + encodeURIComponent(parts.join(";")));
      if (!r || !r.ok) return;
      for (const [key, reg] of Object.entries(r.regions || {})) {
        if (!reg || !reg.ok) continue;
        for (const rec of reg.deltas || []) apply(rec);
        cursors[key] = reg.seq;
      }
      // chunks that streamed in since last time may unblock stashed records
      for (const rec of [...pendingNodes.values()]) apply(rec);
      persistCursors();
    } catch (e) {} finally { pulling = false; }
  }

  // ---------- cadence ----------
  let pushAt = 0, pullAt = 0, started = false;
  setInterval(async () => {
    if (!live()) return;
    if (off == null) { await measureClock(); if (off == null) return; }
    if (!started) { started = true; pull(); }         // login/boot full pull
    const t = Date.now();
    if (t >= pushAt) { pushAt = t + PUSH_EVERY; push(); }
    if (t >= pullAt) { pullAt = t + PULL_EVERY; pull(); }
  }, 5000);
  if (typeof Server !== "undefined") Server.onAuth(u => { if (!u) { started = false; off = null; } });
  addEventListener("beforeunload", () => { persistOutbox(); persistCursors(); });

  function mkNoop() {
    return { noteNode: () => {}, noteDecor: () => {}, noteHeat: () => {},
             applyLive: () => {},
             status: () => ({ enabled: false }) };
  }

  // Live-presence courier (livesync.js): apply a mutation relayed straight
  // from another player's client, whose times are THEIR wall clock — near
  // enough to ours (NTP) for an instant visual. The ledger's own pull
  // re-applies the authoritative record within the minute.
  function applyLive(rec) {
    const o = off;
    off = 0;                 // toLocal()/toServer() become identity for this call
    try { apply(rec); } finally { off = o; }
  }

  window.RegionSync = {
    noteNode, noteDecor, noteHeat, applyLive,
    status: () => ({
      enabled: true, live: live(), offsetMs: off,
      outbox: Object.keys(outbox).length, pendingApply: pendingNodes.size,
    }),
  };
})();
