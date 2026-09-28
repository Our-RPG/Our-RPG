// ===== Taiao — bootstrap =====
"use strict";

// Renderer startup failed — the one non-recoverable boot error. Under file://
// this is EXPECTED since the sprite sheets moved to external files
// (assets/sheets/*.webp): every file:// document is its own opaque origin, so
// the sheets taint the atlas canvas and WebGL refuses the textures. Explain
// the fix on screen instead of dying to a blank page, and offer a raw
// localStorage save download so the character can follow to localhost.
function bootFailed() {
  if (typeof window !== "undefined" && window.__boot) __boot.done(); // clear the loading bar under the error screen
  const isFile = location.protocol === "file:";
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;inset:0;z-index:99999;background:#14161f;color:#e8eaf2;" +
    "font:15px/1.5 OpenDyslexic,Verdana,sans-serif;padding:12vh 18vw;overflow:auto";
  d.innerHTML = isFile
    ? "<h2>Our RPG can't run from file:// any more</h2>" +
      "<p>The sprite sheets now live in separate <code>assets/sheets/*.webp</code> files, and " +
      "browsers refuse to feed file:// images to WebGL (the world can't get its textures).</p>" +
      "<p><b>To play:</b> double-click <code>Start Our RPG.command</code> in the game folder — " +
      "it starts a tiny local server and opens the game at <code>http://localhost:8899</code>.</p>" +
      "<p>localhost counts as a different browser identity, so your character won't be there on " +
      "first launch. Click the button below to back up this page's save, then use " +
      "<b>Import</b> in the localhost game and pick that file.</p>" +
      "<button id='bf-save' style='font:inherit;padding:8px 16px;cursor:pointer'>Download save backup</button>"
    : "<h2>Our RPG couldn't start its renderer</h2>" +
      "<p>WebGL initialisation failed — check the browser console for details.</p>";
  document.body.appendChild(d);
  const btn = document.getElementById("bf-save");
  if (btn) btn.onclick = () => {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { alert("No save found in this browser."); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    a.download = "our-rpg-save-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
  };
}

// Callers (8):
//  main.js:27,49 main/assets.js:36 render3d.js:323,325,642 storage.js:8,152
async function init() {
  // boot-timeline beacons: performance.mark("ef:…") at each stage, readable
  // from the console via performance.getEntriesByType("mark") — how "the game
  // takes ages to load" gets localized without instrumented builds
  // each mark also advances the index.html loading bar (window.__boot)
  const M = n => {
    try { performance.mark("ef:" + n); } catch (e) { /* old browser */ }
    if (typeof window !== "undefined" && window.__boot) __boot.stage(n);
  };
  // yield to the compositor so the loading bar/label actually PAINTS before
  // the next synchronous slab of work (_bootYield in main/state.js — safe in
  // hidden tabs, where rAF never fires)
  const _paint = _bootYield;
  M("init");
  const loaded = loadGame();
  M("loadGame");
  // The original Taiao renders in HD-2D with billboard sprites (the
  // R3D three.js renderer). The retired prototype voxel engine is intentionally left
  // DISABLED so the original bestiary AND all original sprites are shown — LC3D
  // has no billboard path for monsters, so it would draw voxel NPCs instead of
  // the tiny-creatures art. Keeping lcBoot=false skips LC3D.loadEngine(),
  // applyLcBestiary() and LC3D.start(), so the renderer falls through to R3D.
  const lcBoot = false;
  // if (typeof LC3D !== "undefined" && LC3D) { try { lcBoot = await LC3D.loadEngine(); } catch (e) { console.error("LC3D load:", e); } }
  // if (lcBoot && typeof applyLcBestiary === "function") applyLcBestiary();
  world = genWorld();
  M("genWorld");
  monsters = []; // spawned lazily as chunks activate (updateWorldStuff)
  // fold vaults/accounts keyed by retired regional net ids onto today's
  // networks (bank edge rules changed in chunk v43 — storage.js)
  if (loaded) migrateBankNets();
  M("migrateBankNets");
  if (!loaded) {
    // fresh characters wake on Tūhura Isle, the tutorial island (gameplay/
    // tutorial.js) — respawn points there too until the Navigator ferries
    // them to Newhaven. Cheat mode included: restarting the game should
    // always land on the isle. Tutorial characters start BARE — the keepers
    // hand over each tool as they teach.
    const tut = typeof Tutorial !== "undefined";
    newPlayer(tut);
    const s = tut ? Tutorial.START : world.playerStart;
    player.x = s.x; player.y = s.y;
    if (tut) {
      player.respawn = { x: s.x, y: s.y, name: "Tūhura Isle" };
      Tutorial.state(); // seed player.tutorial so the welcome fires post-boot
    }
    log("Welcome to Our RPG — the world we're all still building!", "gold");
    log("Click things to interact. Check the ? tab for a guide.", "sys");
  } else {
    // saved-position validation happens BELOW, after preloadSeen: passable()
    // is a world-tile query, and issuing it before the IDB chunk hydration
    // regenerated the spawn chunk from scratch — dragging the road A* and
    // the full world-name pass into every warm reload (~14s of the old boot)
    log("Welcome back to Our RPG!", "gold");
  }
  // Unconditional build beacon (stale-client diagnosis): shows in EVERY boot,
  // new save or old, and reports whether the current feature wiring is live.
  log(`build 2026-09-03d · placing ${ITEMS.raft_logs && ITEMS.raft_logs.place ? "on" : "OFF"}` +
      ` · ammo ${String(ITEMS.arrow_iron && ITEMS.arrow_iron.icon).startsWith("i_arrow_") ? "paired" : "OFF"}`, "sys");
  // Start the road-network warm for the spawn region NOW, on the worker: the
  // per-cell city-link A* is the other multi-second half of a cold first
  // chunk generation (beside the naming pass), and up here it crunches in
  // PARALLEL with the naming/hydration awaits below. The roadGen bar stage
  // (before genNear) then just waits out whatever is left, with real
  // cells-done progress; render3d's syncRoadWorker adopts this same worker
  // afterwards. Failure of any kind marks it failed and genNear simply pays
  // the synchronous road cost exactly as before.
  if (typeof Worker !== "undefined" && world._roadCellInject && world._workerInit) {
    try {
      const w = new Worker("js/world/roadworker.js");
      _bootRoadWorker = { w, done: 0, total: 0, finished: false, failed: false };
      w.onmessage = e => {
        const d = e.data;
        if (!d) return;
        if (d.warmDone) { _bootRoadWorker.finished = true; return; }
        if (d.key) {
          world._roadCellInject(d.key, d.out);
          if (d.i) _bootRoadWorker.done = d.i;
          if (d.n) _bootRoadWorker.total = d.n;
        }
      };
      w.onerror = err => {
        console.warn("road worker unavailable:", err.message || err);
        _bootRoadWorker.failed = true; _bootRoadWorker.finished = true;
        try { w.terminate(); } catch (e2) { /* already dead */ }
      };
      w.postMessage({ type: "init", ...world._workerInit });
      w.postMessage({ type: "warm", mx: player.x / 2, my: player.y / 2, pad: 16 });
    } catch (e) { _bootRoadWorker = null; }
  }
  // Warm only the chunks AROUND THE PLAYER. A long-lived save can carry
  // thousands of seen chunks; decoding a map image for every one of them (and,
  // after a chunk-cache version bump, regenerating every one of them via the
  // prewarm queue) OOM-crashed the tab during load. Everything farther out
  // hydrates on demand: markSeen streams nearby chunks as you move, and the
  // world map's prewarm pump pulls stored images from IndexedDB as you pan.
  const bootNear = new Set();
  {
    const pcx = Math.floor(player.x / world.CHUNK), pcy = Math.floor(player.y / world.CHUNK);
    for (const k of seenChunks) {
      const [cx, cy] = k.split(",").map(Number);
      if (Math.abs(cx - pcx) <= 8 && Math.abs(cy - pcy) <= 8) bootNear.add(k);
    }
  }
  // restore persisted world-name registries first: chunk gen below stamps
  // settlement/POI labels, and a cache hit here skips an ~8s full-world
  // naming pass (world/features.js preloadZoneNames)
  if (world.preloadZoneNames) await world.preloadZoneNames();
  if (typeof NpcNames !== "undefined" && NpcNames.preload) await NpcNames.preload(); // zone-unique NPC names (world/npc-names.js)
  M("preloadZoneNames");
  // cold cache only: run the full world-naming pass NOW, async-sliced with
  // real progress ticks, instead of letting the first chunk generation drag
  // it in as one giant synchronous freeze. Warm boots (registry hydrated
  // above) resolve instantly.
  if (world.genZoneNames)
    await world.genZoneNames(player.x, player.y,
      (f, name) => { if (typeof window !== "undefined" && window.__boot) __boot.sub("nameGen", f, name); });
  M("nameGen");
  await world.preloadSeen(bootNear);
  M("preloadSeen");
  // FIRST world-tile queries of the boot — deliberately after the hydration
  // awaits above, so a warm reload finds every nearby chunk hot and skips
  // generation entirely. (A corrupt saved position falls back to playerStart,
  // whose chunks may then be cold — rare, and the streamed build covers it.)
  if (loaded) {
    if (!loaded.pos || !passable(player.x, player.y)) {
      const s = world.playerStart;
      player.x = s.x; player.y = s.y;
      player.level = 0;
    }
    // (bridge tiles are water underneath — standing on the deck is not sailing)
    if (world.isWater(player.x, player.y) &&
        !String(world.getDecor(player.x, player.y) || "").startsWith("stone_bridge"))
      player.sailing = bestBoat();
  }
  M("posValidate");
  // warm the zoomed-out macro set FIRST — its one small ranged getAll must
  // not queue behind the per-key chunk-image storm below, so the first map
  // open (however early) already has the whole generalized world on hand
  try { world.prewarmMacros(); } catch (e) { /* best effort */ }
  world.preloadMapImages(bootNear).then(() => { for (const k of bootNear) { const [cx, cy] = k.split(",").map(Number); world.prewarmMapChunk(cx, cy); } });
  player.px = PX(player.x);
  player.py = PX(player.y);
  // Pre-generate the missing chunk DATA of the renderer's immediate
  // neighbourhood HERE — one chunk per paint — instead of letting R3D.init's
  // first synchronous syncChunks swallow it. A first-ever visit pays the
  // whole world-naming pass + road web on the very first getChunk (many
  // seconds): up here the loading bar ticks through it chunk by chunk, and
  // the sprite decode keeps running in parallel underneath. On a warm reload
  // every chunk is already hydrated and this loop is a no-op.
  // Only the inner 3x3 blocks boot — the renderer's own fog cuts off at 52
  // world units (render3d.js scene.fog(28,52), CHUNK=32), well inside a
  // second ring out, so the rest of the old 5x5 isn't visible at first paint
  // anyway. That outer ring streams in AFTER gameReady instead (user req
  // 2026-09-17: shorten the loading screen — defer what isn't needed right
  // away, stream it in during play, as long as it's not visibly late).
  let _farChunks = [];
  {
    const CS = world.CHUNK;
    const pcx = Math.floor(player.x / CS), pcy = Math.floor(player.y / CS);
    const near = [];
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        if (world.chunks.has((pcx + dx) + "," + (pcy + dy))) continue;
        (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? near : _farChunks).push([pcx + dx, pcy + dy, Math.abs(dx) + Math.abs(dy)]);
      }
    near.sort((a, b) => a[2] - b[2]);
    _farChunks.sort((a, b) => a[2] - b[2]);
    // roads first: wait for the boot road-warm (crunching on the worker since
    // the top of init, in parallel with the naming pass) so the chunk gens
    // below find every road cell cached instead of freezing on the A*. Real
    // cells-done progress; skipped when nothing needs generating (every warm
    // reload), on worker failure, or after a 30s watchdog — the loop below
    // then computes roads synchronously exactly as before.
    if (near.length && _bootRoadWorker && !_bootRoadWorker.failed) {
      const _t0 = performance.now();
      while (!_bootRoadWorker.finished && performance.now() - _t0 < 30000) {
        if (typeof window !== "undefined" && window.__boot && _bootRoadWorker.total)
          __boot.sub("roadGen", _bootRoadWorker.done / _bootRoadWorker.total);
        await _paint();
      }
    }
    M("roadGen");
    for (let i = 0; i < near.length; i++) {
      if (typeof window !== "undefined" && window.__boot) __boot.sub("genNear", i / near.length);
      await _paint();
      world.getChunk(near[i][0], near[i][1]);
    }
  }
  M("genNear");
  // rendezvous with the core sprite-sheet decode that has been running in
  // parallel since page load (bottom of this file) — everything above needs
  // no pixels, so the IDB hydration and the webp decode overlap instead of
  // serializing. From here on IMGS is fully decoded.
  await _assetsReady;
  M("assets");
  // Start decoding the character + object art sheets NOW so they're ready before
  // the first frame paints — otherwise the opening frames fall back to the legacy
  // atlas sprites and then visibly pop to the real art (see R3D.preloadArt). The
  // decode overlaps the atlas bake + renderer init below; we await it just before
  // gameReady so the overlay stays up until the world can paint its real art.
  const _artReady = (typeof R3D !== "undefined" && R3D.preloadArt) ? R3D.preloadArt() : Promise.resolve();
  // the minimap draws icons continuously without ever requiring the world map
  // to be opened, so this can't wait on openWorldMap() (see applyMapIconArt())
  if (typeof applyMapIconArt === "function") applyMapIconArt();
  // bake the sprite atlas in painted slices with real progress (R3D.init
  // finds it done and skips its synchronous fallback bake)
  if (typeof R3D !== "undefined" && R3D.buildAtlasAsync) {
    try {
      await R3D.buildAtlasAsync(f => { if (typeof window !== "undefined" && window.__boot) __boot.sub("atlas", f); });
    } catch (e) { console.warn("async atlas bake failed, R3D.init will retry:", e.message); }
  }
  M("atlas");
  // Prefer the retired prototype engine renderer (voxel world, real 3D models,
  // retired prototype collision + pathfinding); fall back to the three.js billboards.
  let lcOk = false;
  if (lcBoot) {
    try { lcOk = LC3D.start(); } catch (e) { console.error("LC3D start:", e); }
  }
  if (lcOk) {
    REN = LC3D;
    log("retired prototype engine online: 3D models, voxels and pathfinding active.", "gold");
  } else {
    let r3dOk = false;
    try { r3dOk = R3D.init(); } catch (e) { console.error("R3D init:", e); }
    if (!r3dOk) return bootFailed();
    REN = R3D;
  }
  M("renderer");
  // hold the last beat of boot until the character/object sheets have decoded, so
  // the first painted frame shows the real art instead of the legacy atlas
  // fallback (only R3D needs them; LC3D has its own models). Kicked off above, so
  // this usually resolves at once (it decoded during the atlas bake + init).
  if (REN === R3D) { try { await _artReady; } catch (e) { /* bad sheet: first frames use the atlas fallback */ } }
  gameReady = true;
  saveGame();
  uiDirty = true;
  // the outer chunk ring deferred above: stream it in now that the player
  // can already move, one chunk per paint (same pacing as the blocking loop
  // it was split from) so it never competes for a frame with real gameplay
  if (_farChunks.length) (async () => {
    for (const [fx, fy] of _farChunks) { await _paint(); world.getChunk(fx, fy); }
  })();
  // first boot of a fresh character on Tūhura Isle: the Guide's welcome
  if (typeof Tutorial !== "undefined") Tutorial.maybeWelcome();
  // (no "while you were away" login notification — the game has no passive/
  // offline progression to report; Pulse still tracks sessions for the I-key
  // journal, it just doesn't pop a toast on login.)
  M("gameReady");
  // record this boot's real per-stage durations — the loading bar's segment
  // widths next time. Cold (fresh save) and warm boots have wildly different
  // shapes, so each kind keeps its own profile; index.html picks by whether
  // a save exists, which is exactly what decides the shape of the next boot.
  try {
    const prof = {};
    let prev = 0;
    for (const e of performance.getEntriesByType("mark")) {
      if (!e.name.startsWith("ef:")) continue;
      // coreSheets is a beacon, not a bar segment — it fires mid-stage
      // (decode runs in parallel), and advancing `prev` on it would steal
      // that whole window from the stage it landed inside
      if (e.name === "ef:coreSheets") continue;
      prof[e.name.slice(3)] = Math.max(1, Math.round(e.startTime - prev));
      prev = e.startTime;
    }
    localStorage.setItem(loaded ? "ef_boot_profile_w" : "ef_boot_profile_c", JSON.stringify(prof));
  } catch (e) { /* private mode etc. */ }
  if (typeof window !== "undefined" && window.__boot) __boot.done();

  // `now` is WALL-CLOCK (Date.now, epoch ms), not a session timer — so every
  // game-logic timer (crop growth, node/monster respawn, husbandry cooldowns,
  // decor regrowth…) is measured against real time and KEEPS RUNNING while the
  // tab is closed: on return, `now` has advanced by the real elapsed time and
  // anything whose deadline passed is simply ready. The per-frame delta is
  // capped (below) so a long gap can't fast-forward movement/animation.
  let last = Date.now();
  function frame(t) {
    now = Date.now();
    const dt = Math.min(100, now - last);
    last = now;
    // one bad frame (a transient renderer error) must never kill the loop
    try {
      // Bifrost graduation cinematic (gameplay/bifrost.js): the player, action
      // and quest sims pause while the light carries them — but the world keeps
      // turning and render() keeps painting so Newhaven warms up behind the void
      const cine = (typeof Bifrost !== "undefined" && Bifrost.active()) ||
        (typeof Lua !== "undefined" && Lua.ready && Lua.cutsceneActive());
      if (!cine) {
        stepPlayer(dt);
        updateZoom(dt);
        updateAction();
        if (typeof Split !== "undefined") Split.tick(dt); // split selves: queues + ghost bodies
      }
      updateMonsters(dt);
      updateWorldStuff();
      tickTrade(); // close the shop/bank window when out of reach
      if (typeof npcChatTick === "function") npcChatTick(); // AI NPC earshot greetings (Nets)
      if (typeof tickPlaced === "function") tickPlaced(); // temporary placed decor withers
      if (!cine && typeof Quests !== "undefined") Quests.tick(); // quest collect/reach objectives
      if (!cine && typeof Lua !== "undefined" && Lua.ready) Lua.tickRoutines(); // NPC daily routines (js/lua; inert until the runtime is ready)
      if (!cine && typeof Tutorial !== "undefined" && Tutorial.tick) Tutorial.tick(); // Tūhura source-reach reward
      if (!cine && typeof GoalsArc !== "undefined") GoalsArc.tick(dt); // post-Bifrost "First days in Newhaven" arc
      if (!cine && typeof Eggs !== "undefined") Eggs.tick(dt); // easter-egg condition watchers (1 Hz inside)
      render();
    } catch (e) {
      console.error("frame error:", e);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Kick the core sprite-sheet decode and the save/world hydration in PARALLEL:
// init() runs immediately and only rendezvouses with the sheets (via
// _assetsReady) right before its image-dependent tail (map icon art, the
// renderer/atlas). The old `loadAssets(init)` serialized ~2.5s of webp decode
// in front of boot work that needs no pixels at all.
const _assetsReady = new Promise(res => loadAssets(res));
init();
