// ===== Taiao Lua — engine: registry, dispatch, public window.Lua API =====
// The language-agnostic layer that the game calls. Handlers register themselves
// from Lua (via the injected __register callback) into key-sets here; dispatch
// runs a handler by asking Lua to `__run(kind, subject, ctxid)` inside a
// yieldable thread (engine.doString), so scripted dialogue/waits can suspend.
//
// Mirrors the old window.QuestScript surface (hasNpc/runNpc, hasLoc/runLoc,
// hasRole/runRole, tickRoutines) and adds onKill / item / cutscene hooks.
"use strict";

(function () {
  const L = (window.__LUA = window.__LUA || {});
  let lua = null;   // the wasmoon LuaEngine (set by boot via attach)

  // ---- registry (populated from Lua at load time) --------------------------
  const KEYS = { npc: new Set(), loc: new Set(), role: new Set(), routine: new Set(), kill: new Set(), item: new Set(), cutscene: new Set() };
  function registerKey(kind, subject) { if (KEYS[kind]) KEYS[kind].add(String(subject)); }
  function reportErr(subject, msg) {
    console.error("Lua script error in", subject, msg);
    if (typeof log === "function") log("(A script hit a snag.)", "warn");
  }
  L.registerKey = registerKey;
  L.reportErr = reportErr;

  // ---- per-run context registry (the bound NPC/loc for a dispatch) ---------
  const REG = Object.create(null); let seq = 1;
  function pushCtx(o) { const id = seq++; REG[id] = { npc: o.npc || null, loc: o.loc || null, script: o.script || "?" }; return id; }
  function popCtx(id) { delete REG[id]; }
  L.ctx = { get: id => REG[id] || null };

  // Lua string literal for a subject (subjects are simple ids, but be safe).
  const luaStr = s => '"' + String(s).replace(/[\\"\n]/g, c => ({ "\\": "\\\\", '"': '\\"', "\n": "\\n" }[c])) + '"';

  // Run a handler; errors are logged, never thrown into the game loop. Interaction
  // dispatches persist afterwards (save=true); routine ticks do not.
  async function dispatch(kind, subject, ctxInit, save) {
    if (!lua || !L.ready) return null;
    const id = pushCtx(ctxInit || {});
    try { await lua.doString('__run("' + kind + '", ' + luaStr(subject) + ', ' + id + ')'); }
    catch (e) { console.error("Lua dispatch error", kind, subject, e); }
    finally { popCtx(id); if (save && typeof saveGame === "function") { try { saveGame(); } catch (e) {} } }
  }

  function runRoutineOnce(npc) {
    const name = routineNameFor(npc);
    if (!name || !lua || !L.ready) return Promise.resolve();
    const id = pushCtx({ npc, script: name });
    return lua.doString('__run("routine", ' + luaStr(name) + ', ' + id + ')').finally(() => popCtx(id));
  }

  // ---- role / routine resolution (mirrors qs-engine.js) --------------------
  function roleKey(npc) {
    if (!npc) return null;
    if (npc.trader) return "trader";
    if (npc.banker) return "banker";
    if (npc.tutor) return "tutor";
    if (npc.wizard) return "wizard";
    if (npc.dreamNpc) return "dream";
    return npc._bjob || npc.mix || null;
  }
  function routineNameFor(npc) {
    if (!npc) return null;
    if (npc._routine && KEYS.routine.has(npc._routine)) return npc._routine;
    if (KEYS.routine.has(npc.name)) return npc.name;
    const rk = roleKey(npc);
    if (rk && KEYS.routine.has(rk)) return rk;
    // the "villager" default only covers ambient townsfolk (mix NPCs) — never the
    // bespoke self-driven ones (tutors, Weaver, Dream folk, Registrar, givers).
    if (npc.mix && !npc.tutor && !npc.wizard && !npc.dreamNpc && !npc.charselect && !npc._questGiver && KEYS.routine.has("villager")) return "villager";
    return null;
  }

  const baseKey = k => (k ? String(k).split("#")[0] : k);
  function npcSubject(npc) {
    if (!npc) return null;
    if (npc._script && KEYS.npc.has(npc._script)) return npc._script;
    if (KEYS.npc.has(npc.name)) return npc.name;
    return null;
  }

  let cutsceneDepth = 0;

  // internal engine handle for the coroutine runner (js/lua/lua-coro.js)
  L.engine = { attach: e => { lua = e; }, runRoutineOnce, routineNameFor };

  // ---- public API ----------------------------------------------------------
  window.Lua = Object.assign(window.Lua || {}, {
    ready: false,
    hasNpc: npc => !!npcSubject(npc),
    runNpc: npc => { const s = npcSubject(npc); return s ? dispatch("npc", s, { npc, script: s }, true) : null; },
    hasLoc: key => KEYS.loc.has(baseKey(key)),
    runLoc: (key, x, y) => { const b = baseKey(key); return KEYS.loc.has(b) ? dispatch("loc", b, { loc: { x: x | 0, y: y | 0, key: b }, script: b }, true) : null; },
    hasRole: (role, npc) => KEYS.role.has(role),
    runRole: (role, npc) => (KEYS.role.has(role) ? dispatch("role", role, { npc, script: role }, true) : null),
    hasItem: id => KEYS.item.has(String(id)),
    runItem: id => (KEYS.item.has(String(id)) ? dispatch("item", String(id), {}, true) : null),
    onKill: kind => { if (KEYS.kill.has(String(kind))) dispatch("kill", String(kind), {}, false); },
    hasCutscene: name => KEYS.cutscene.has(String(name)),
    playCutscene: name => {
      if (!KEYS.cutscene.has(String(name))) return null;
      cutsceneDepth++;
      return dispatch("cutscene", String(name), {}, false).finally(() => { cutsceneDepth = Math.max(0, cutsceneDepth - 1); });
    },
    cutsceneActive: () => cutsceneDepth > 0,
    routineFor: npc => routineNameFor(npc),
    tickRoutines: () => (L.coro && L.coro.tickRoutines()),
  });
})();
