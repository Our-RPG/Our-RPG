// ===== Taiao Lua — boot: initialise wasmoon, inject the host, load scripts =====
// wasmoon (libs/lua/wasmoon.js, a UMD global loaded before the bundle) boots its
// Lua 5.4 WASM asynchronously. We create the engine, inject __LUA.HOST + the two
// engine callbacks (__register/__err), run the prelude, then every content
// script (LUA_SRC, inlined at build time). Dispatch seams guard on Lua.ready and
// fall through to their JS fallbacks during the sub-second boot window.
//
// wasmoon async model: a JS function injected here that returns a Promise makes
// the calling Lua coroutine YIELD until it resolves — as long as the Lua ran via
// engine.doString (a yieldable thread), which every dispatch does. That is how
// scripted dialogue (__choice) and routine waits (__walk_to) suspend cleanly.
"use strict";

(function () {
  const L = (window.__LUA = window.__LUA || {});
  const base = p => new URL(p, document.baseURI).href;

  async function init() {
    if (L._initStarted) return;
    L._initStarted = true;
    if (typeof wasmoon === "undefined") { console.error("Lua: wasmoon runtime not loaded (libs/lua/wasmoon.js)"); return; }
    try {
      const factory = new wasmoon.LuaFactory(base("libs/lua/glue.wasm"));
      const engine = await factory.createEngine();   // openStandardLibs + coroutine lib on

      // ---- CONCURRENT-dispatch fix: registry-anchor doString's coroutines ----
      // Upstream wasmoon's callByteCode anchors each doString's new coroutine
      // at an ABSOLUTE index on the GLOBAL stack, then lua_remove()s that index
      // when the awaited run completes — possibly seconds later. With many
      // dispatches in flight at once (every villager routine is one, looping
      // continuously), an earlier completion shifts all later anchors down a
      // slot, so later completions remove the WRONG slot — unanchoring a
      // coroutine that is still RUNNING. Lua's GC then frees the live thread
      // and the shared lua_State corrupts progressively: js_function metatable
      // identity checks fail, _G entries (__run, tostring) turn nil, the wasm
      // heap faults ("index out of bounds") — and every NPC routine dies,
      // freezing the town (npc._luaRoutine gates the legacy JS wander OFF).
      // Fix: pin each thread in the REGISTRY (stable integer keys, immune to
      // stack traffic) and pop xmove'd results so the global stack can't grow.
      // Instance-level override — the vendored libs/lua/wasmoon.js is untouched.
      engine.callByteCode = async function (loader) {
        const g = this.global;
        const thread = g.newThread();  // pushed on the global stack…
        const ref = g.lua.luaL_ref(g.address, wasmoon.LUA_REGISTRYINDEX); // …popped & pinned
        try {
          loader(thread);
          const result = await thread.run(0);
          if (result.length > 0) {
            this.cmodule.lua_xmove(thread.address, g.address, result.length);
            const v = g.getValue(g.getTop() - result.length + 1);
            g.setTop(g.getTop() - result.length);
            return v;
          }
          return undefined;
        } finally {
          g.lua.luaL_unref(g.address, wasmoon.LUA_REGISTRYINDEX, ref);
        }
      };

      // inject every __-prefixed host fn + the two engine callbacks
      const inj = Object.assign({}, L.HOST, { __register: L.registerKey, __err: L.reportErr });
      for (const k in inj) engine.global.set(k, inj[k]);

      // prelude (authoring API) first, then content scripts
      if (typeof LUA_PRELUDE !== "undefined") await engine.doString(LUA_PRELUDE);
      const src = (typeof LUA_SRC !== "undefined") ? LUA_SRC : {};
      let n = 0;
      for (const name in src) {
        try { await engine.doString(src[name]); n++; }
        catch (e) { console.error("Lua: failed to load", name, e); }
      }

      L.engine.attach(engine);
      L.lua = engine;
      L.ready = true;
      window.Lua.ready = true;
      console.log(`Lua: ready — ${n} script(s) loaded`);
      window.dispatchEvent(new Event("lua-ready"));
    } catch (e) {
      console.error("Lua: init failed", e);
    }
  }

  window.Lua = window.Lua || {};
  window.Lua.init = init;
  L.init = init;
  // Kick off, non-blocking. Safe to call at bundle-eval time: init touches no
  // game state, only the vendored runtime + inlined script sources.
  init();
})();
