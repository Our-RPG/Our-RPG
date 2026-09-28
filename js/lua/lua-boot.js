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
