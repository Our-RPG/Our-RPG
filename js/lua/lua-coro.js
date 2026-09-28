// ===== Taiao Lua — routine coroutine support: wait/pump registry + lamplighter =====
// NPC daily routines run as wasmoon coroutines: one doString per "day", looped
// while the NPC is live. Suspending host verbs (walk_to/wait/sleep_until) return
// a Promise that wasmoon yields on; this file resolves those Promises each frame
// when a world predicate becomes true — the same waitOn/pump machinery the old
// QuestScript routine runner used (js/questscript/qs-routines.js), re-homed here.
//
// Division of labour: the coroutine DECIDES (sets npc._escortTarget / timers);
// render3d's stepMixNpc executes the MOTION. npc._luaRoutine flags an NPC as
// Lua-driven so the legacy JS wander/bedtime AI stands down.
"use strict";

(function () {
  const L = (window.__LUA = window.__LUA || {});
  const running = new Set();
  const nowMs = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

  // Suspend until predicate() is true (polled each frame by pump). Rejects with
  // {__luaCancel} if the NPC is despawned mid-wait.
  function waitOn(npc, predicate) {
    return new Promise((res, rej) => { (npc._luaWaits || (npc._luaWaits = [])).push({ predicate, res, rej }); });
  }
  const pause = (npc, ms) => { const t = nowMs() + ms; return waitOn(npc, () => nowMs() >= t); };
  // Walk toward npc._escortTarget until arrival OR a real-time deadline (a greedy
  // path that can't reach its goal must not wedge the coroutine forever).
  const arrive = (npc, ms) => {
    const dl = nowMs() + (ms || 8000);
    return waitOn(npc, () => !npc._escortTarget || nowMs() >= dl).then(() => { npc._escortTarget = null; });
  };

  // ---- lamplighter (per-NPC; reuses the daynight/village services) ---------
  const lampClaims = new Set();
  function lampVillageFor(npc) {
    if (typeof world === "undefined" || !world || !world.villagesNearPt) return null;
    for (const v of world.villagesNearPt(npc.x, npc.y, 40)) {
      const dx = npc.x - v.x, dy = npc.y - v.y;
      if (dx * dx + dy * dy < v.R * v.R) return v;
    }
    return null;
  }
  function lampModeFor(npc) {                 // "place" (dusk) | "collect" (dawn) | ""
    const v = lampVillageFor(npc); if (!v) return "";
    if (typeof daylightAt !== "function" || typeof sunPhase !== "function" || typeof daylightTrend !== "function") return "";
    const Lv = daylightAt(npc.y, sunPhase(npc.x));
    if (Lv <= 0.05 || Lv >= 0.72) return "";
    return daylightTrend(npc.x) < 0 ? "place" : "collect";
  }
  function lampRelease(npc) {
    if (npc._luaLampKey) { lampClaims.delete(npc._luaLampKey); npc._luaLampKey = null; }
    npc._luaLamp = null; npc._luaLampV = null; npc._luaLampMode = null;
  }
  function claimLampSpot(npc) {
    const v = lampVillageFor(npc), mode = lampModeFor(npc);
    if (!v || !mode || typeof villageCandleSpots !== "function" || typeof lampSpotPlaced !== "function") return false;
    const vk = v.x + "," + v.y;
    let best = null, bd = Infinity;
    for (const s of villageCandleSpots(v)) {
      if (s.inside) continue;
      const placed = lampSpotPlaced(v, s.x, s.y);
      const need = mode === "place" ? placed !== true : placed === true;
      if (!need) continue;
      const key = vk + ":" + s.x + "," + s.y;
      if (lampClaims.has(key)) continue;
      const d = Math.abs(s.x - npc.x) + Math.abs(s.y - npc.y);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return false;
    npc._luaLampKey = vk + ":" + best.x + "," + best.y;
    lampClaims.add(npc._luaLampKey);
    npc._luaLampV = v; npc._luaLamp = [best.x, best.y]; npc._luaLampMode = mode;
    return true;
  }
  const lampSpotOf = npc => npc._luaLamp || null;
  function lightLamp(npc) {
    if (!npc || !npc._luaLamp) return;
    if (npc._luaLampV && typeof lampSpotSet === "function")
      lampSpotSet(npc._luaLampV, npc._luaLamp[0], npc._luaLamp[1], npc._luaLampMode !== "collect");
    lampRelease(npc);
  }

  function cancel(npc) {
    running.delete(npc);
    npc._luaRoutine = false;
    lampRelease(npc);
    const w = npc._luaWaits;
    if (w && w.length) { npc._luaWaits = []; for (const x of w) x.rej && x.rej({ __luaCancel: true }); }
  }

  function startRoutine(npc) {
    if (running.has(npc)) return;
    if (!L.engine || !L.engine.routineNameFor(npc)) return;
    running.add(npc);
    npc._luaRoutine = true;   // gates off the legacy JS wander (render3d stepMixNpc)
    loop(npc);
  }
  async function loop(npc) {
    try {
      while (running.has(npc)) {
        try {
          await L.engine.runRoutineOnce(npc);
        } catch (e) {
          if (e && e.__luaCancel) break;
          console.error("Lua routine error", e);
          await pause(npc, 2000).catch(() => {});
        }
        // a body with no suspends must not busy-spin the microtask queue
        await pause(npc, 300).catch(() => {});
      }
    } finally { cancel(npc); }
  }

  // Called every frame from the main loop. Starts coroutines for new routine
  // NPCs, resolves pending waits, cancels coroutines for NPCs that left the world.
  function tickRoutines() {
    if (!L.ready) return;
    if (typeof world === "undefined" || !world || !world.npcs) return;
    const npcs = world.npcs;
    if (running.size) { const live = new Set(npcs); for (const npc of running) if (!live.has(npc)) cancel(npc); }
    for (const npc of npcs) {
      if (npc._home && !running.has(npc) && L.engine.routineNameFor(npc)) startRoutine(npc);
      if (npc._luaWaits && npc._luaWaits.length) pump(npc);
    }
  }
  function pump(npc) {
    const w = npc._luaWaits;
    if (!w || !w.length) return;
    for (let i = 0; i < w.length; i++) {
      let ok = false;
      try { ok = w[i].predicate(); } catch (e) { ok = true; }   // throwing predicate fails open
      if (ok) { const res = w[i].res; w.splice(i, 1); i--; res(); }
    }
  }

  L.coro = {
    waitOn, pause, arrive, cancel, startRoutine, tickRoutines, running,
    lampModeFor, claimLampSpot, lampSpotOf, lightLamp,
  };
})();
