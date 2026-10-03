// ----------------------------------------------------------------------------
// Townfolk directory — a one-click roster of everyone you can reach in the
// city/village you're standing in.
//
// When the player is inside a settlement (daynight.js currentSettlement), a
// button appears top-right just UNDER the multiplayer "Online" pill and the
// NPC-engine status pill (js/net/npc-engine-ui.js), labelled with the
// settlement's name. Clicking it opens an overlay listing every NPC in
// the settlement footprint that the player currently has a walkable path to
// (gameplay/pathing.js findPath). Each NPC shows its FULL right-click menu —
// the very same {label, fn} entries buildTileMenu produces (gameplay/input.js:
// hoverLabel + doTarget), so clicking an action walks the player to the NPC and
// performs it (Talk / Trade / Examine) exactly as a right-click would. Each
// shopkeeper carries a goods glyph (what they trade in); bankers a bank glyph.
//
// Self-contained IIFE in the social-ui.js mould: injects its own <style>, owns
// its button + overlay, and polls currentSettlement() to show/hide. Works in
// every build (unlike social-ui.js, which is multiplayer-only).
// ----------------------------------------------------------------------------
(function () {
  "use strict";

  // goods glyph per shop type (mirrors market.js SHOP_TYPES keys). The title
  // attribute spells it out; the glyph is the at-a-glance "what do they sell".
  const SHOP_SYM = {
    general: "\u{1F6D2}",      // 🛒 general store
    woodcutter: "\u{1FA93}",   // 🪓 axes / timber
    mining: "⛏️",     // ⛏️ picks / ores
    fishmonger: "\u{1F41F}",   // 🐟 rods / fish
    armoury: "\u{1F6E1}️", // 🛡️ armour
    weaponsmith: "⚔️", // ⚔️ weapons
    seedsman: "\u{1F331}",     // 🌱 seeds / produce
    herbalist: "\u{1F33F}",    // 🌿 herbs / potions
    jeweller: "\u{1F48E}",     // 💎 gems / luxury
    clothier: "\u{1F9F5}",     // 🧵 cloth / leather
    provisioner: "\u{1F35E}",  // 🍞 food / drink
    timberwright: "\u{1FAB5}", // 🪵 boards / beams
    runeseller: "\u{1F52E}",   // 🔮 runes
    dream: "\u{1F4A4}",        // 💤 dream pedlar
  };

  function shopName(npc) {
    if (typeof SHOP_TYPES !== "undefined" && SHOP_TYPES[npc.shopType]) return SHOP_TYPES[npc.shopType].name;
    return "Merchant";
  }

  // --- NPC portrait: a front-facing (south, frame 0) 2D thumbnail -----------
  // Two NPC appearances, same as the renderer: a "mix" roster character (its
  // billboard atlas strip in MIX_SHEETS, frame math from MIX_NPCS.list — see
  // objedit.js drawMixFrame), or the legacy layered villager (npc.spr / the
  // VILLAGER_LOOKS[look] layer stack composited from the shared sheets in IMGS
  // via sprRect). Images may not be decoded yet, so each painter redraws on the
  // relevant image's load event.
  const PX = 52;
  const _mixImgs = {};
  function paintMix(cv, def) {
    if (typeof MIX_SHEETS === "undefined") return;
    const ctx = cv.getContext("2d");
    let img = _mixImgs[def.sheet];
    if (!img) { img = new Image(); img.src = MIX_SHEETS[def.sheet]; _mixImgs[def.sheet] = img; }
    if (!img.complete || !img.naturalWidth) { img.addEventListener("load", () => paintMix(cv, def), { once: true }); return; }
    ctx.clearRect(0, 0, PX, PX);
    ctx.imageSmoothingEnabled = false;
    const s = Math.min(PX / def.fw, PX / def.fh), dw = def.fw * s, dh = def.fh * s;
    ctx.drawImage(img, def.ax, def.ay, def.fw, def.fh, (PX - dw) / 2, (PX - dh) / 2, dw, dh);
  }
  function paintLegacy(cv, layers) {
    if (typeof sprRect !== "function" || typeof IMGS === "undefined") return;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, PX, PX);
    ctx.imageSmoothingEnabled = false;
    for (const layer of layers) {
      const key = Array.isArray(layer) ? layer[0] : layer;
      const r = sprRect(key);
      if (!r) continue;
      const img = IMGS[r.sheet];
      if (!img) continue;
      if (!img.complete || !img.naturalWidth) { img.addEventListener("load", () => paintLegacy(cv, layers), { once: true }); continue; }
      ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, PX, PX); // villager layers are single front-facing cells
    }
  }
  // returns a <canvas> portrait, or null if this NPC has no resolvable sprite
  function portraitEl(npc) {
    const cv = document.createElement("canvas");
    cv.width = PX; cv.height = PX; cv.className = "tf-por";
    let def = null;
    if (npc.mix && typeof MIX_NPCS !== "undefined" && MIX_NPCS.list)
      def = MIX_NPCS.list.find(d => d.key === npc.mix);
    if (def) { paintMix(cv, def); return cv; }
    const layers = (npc.spr && npc.spr.length) ? npc.spr
      : (typeof VILLAGER_LOOKS !== "undefined" ? VILLAGER_LOOKS[npc.look | 0] : null);
    if (layers && layers.length) { paintLegacy(cv, layers); return cv; }
    return null;
  }

  // --- styling (mirrors #online-top / #online-dialog in js/net/social-ui.js) --
  const css = document.createElement("style");
  css.textContent = `
#townfolk-top { position:fixed; top:72px; right:340px; z-index:50; display:none;
  align-items:center; gap:6px; max-width:240px; background:rgba(20,26,34,0.92);
  color:#cfe4ff; border:1px solid #3a4a5a; border-radius:8px; padding:5px 11px;
  cursor:pointer; font:12px OpenDyslexic, Verdana, sans-serif; }
#townfolk-top.on { display:inline-flex; }
#townfolk-top:hover { background:rgba(40,52,66,0.96); color:#fff; }
#townfolk-top .tf-pin { flex:0 0 auto; }
#townfolk-top .tf-where { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#townfolk-dialog { position:fixed; inset:0; z-index:70; display:none;
  background:rgba(6,9,13,0.6); align-items:center; justify-content:center;
  font:14px OpenDyslexic, Verdana, sans-serif; }
#townfolk-dialog.on { display:flex; }
#townfolk-dialog .tf-card { width:min(620px,94vw); max-height:86vh; display:flex;
  flex-direction:column; background:#141a22; color:#dce8f5;
  border:1px solid #3a4a5a; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,0.5); }
#townfolk-dialog .tf-topbar { display:flex; align-items:center; justify-content:space-between;
  padding:12px 16px; border-bottom:1px solid #2a3542; }
#townfolk-dialog .tf-topbar h2 { margin:0; font-size:17px; color:#fff; }
#townfolk-dialog .tf-topbar .tf-x { cursor:pointer; color:#9fb3c8; font-size:18px; padding:0 4px; }
#townfolk-dialog .tf-topbar .tf-x:hover { color:#fff; }
#townfolk-dialog .tf-body { overflow-y:auto; padding:10px 16px 16px; }
#townfolk-dialog .tf-group { margin:12px 0 4px; font-size:12px; letter-spacing:.06em;
  text-transform:uppercase; color:#7f95ab; }
#townfolk-dialog .tf-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:10px; }
#townfolk-dialog .tf-npc { display:flex; gap:10px; align-items:flex-start;
  background:#1b222c; border:1px solid #2c3845; border-radius:9px; padding:9px 11px; }
#townfolk-dialog .tf-por { width:52px; height:52px; flex:0 0 auto; border-radius:7px;
  background:#10161e center/contain no-repeat; border:1px solid #2c3845;
  image-rendering:pixelated; image-rendering:crisp-edges; }
#townfolk-dialog .tf-main { flex:1 1 auto; min-width:0; }
#townfolk-dialog .tf-head { display:flex; align-items:baseline; gap:7px; margin-bottom:6px; }
#townfolk-dialog .tf-sym { font-size:16px; flex:0 0 auto; }
#townfolk-dialog .tf-name { font-weight:bold; color:#fff; }
#townfolk-dialog .tf-role { font-size:11px; color:#8ba2b8; margin-left:auto; text-align:right; }
#townfolk-dialog .tf-acts { display:flex; flex-direction:column; gap:3px; }
#townfolk-dialog .tf-act { cursor:pointer; padding:5px 8px; border-radius:6px;
  background:#232d39; color:#cfe0f0; font-size:13px; }
#townfolk-dialog .tf-act:hover { background:#2f3e4e; color:#fff; }
#townfolk-dialog .tf-empty { color:#8ba2b8; padding:16px 4px; text-align:center; }
`;
  document.head.appendChild(css);

  // --- button ---------------------------------------------------------------
  const topBtn = document.createElement("div");
  topBtn.id = "townfolk-top";
  topBtn.title = "Everyone you can reach here — click to open the directory";
  topBtn.innerHTML = `<span class="tf-pin">\u{1F3D8}️</span><span class="tf-where"></span>`;
  document.body.appendChild(topBtn);
  const whereEl = topBtn.querySelector(".tf-where");
  const pinEl = topBtn.querySelector(".tf-pin");

  // --- overlay --------------------------------------------------------------
  const dialog = document.createElement("div");
  dialog.id = "townfolk-dialog";
  dialog.innerHTML = `<div class="tf-card">
    <div class="tf-topbar"><h2></h2><span class="tf-x">✕</span></div>
    <div class="tf-body"></div>
  </div>`;
  document.body.appendChild(dialog);
  const titleEl = dialog.querySelector(".tf-topbar h2");
  const bodyEl = dialog.querySelector(".tf-body");
  dialog.querySelector(".tf-x").onclick = () => dialog.classList.remove("on");
  dialog.onclick = e => { if (e.target === dialog) dialog.classList.remove("on"); };

  // --- settlement + roster helpers -----------------------------------------
  function here() {
    if (typeof currentSettlement !== "function") return null;
    try { return currentSettlement(); } catch (e) { return null; }
  }

  // integer tile key (no per-probe string alloc — this is what made the flood
  // cheap enough to run on click). Safe for |y| < 50000, which covers every
  // world coordinate (15000²-tile blocks, centres well within ±7500).
  const EK = (x, y) => x * 100003 + y;

  // ONE bounded flood-fill from the player, using findPath's exact neighbour
  // rules (8-connected, diagonal-corner + terrace-step checks, warm chunks
  // only). Produces the Set of EK(x,y) tiles the player can stand on — so the
  // whole roster's reachability costs a single pass instead of a findPath per
  // NPC (the old way ran A* up to 9000 iters for every unreachable NPC).
  //
  // In a big city the flood touches ~20k tiles (~1-2s of passable() queries),
  // so it is RESUMABLE and precomputed in the BACKGROUND, a few ms per animation
  // frame (_tickFlood), while the player is in town. By the time the menu is
  // opened the result is usually already cached → the open is instant. If it
  // isn't finished yet, reachableFrom() finishes the remainder synchronously.
  // Keyed by player tile (moving restarts it); passable() memoised per town so
  // a restart after a few steps is cheap.
  const perfNow = (typeof performance !== "undefined" && performance.now) ? () => performance.now() : () => 0;
  let _reach = null;           // completed: { k, set }
  let _flood = null;           // in-progress resumable state, or null
  let _rafOn = false;
  const _passMemo = new Map();  // EK(x,y) -> walkable? reused across floods in one town
  let _passVill = "";           // settlement the passable memo belongs to
  // how many of THIS settlement's chunks are currently warm. A flood over a
  // half-warm town is invalidated once more of it loads (else the cached set
  // misses NPCs that spawn in chunks warmed after the flood). Scoped to the
  // town footprint — unlike world.chunks.size, distant chunk streaming doesn't
  // churn it, so once the town has settled the background precompute completes
  // and stays cached.
  function _warmStamp(cur) {
    if (!cur || typeof world === "undefined" || !world || !world.chunks) return 0;
    const CS = world.CHUNK || 32, v = cur.v;
    // only the chunks the flood can actually touch — player±80 ∩ town±R. In a
    // big city the far edges sit outside the player's view radius and flicker
    // warm/cold; counting them would churn the key forever and the background
    // precompute would never settle. Near-player chunks stay warm once you're
    // standing there, so this stabilises.
    const lox = Math.max(player.x - 80, v.x - v.R), hix = Math.min(player.x + 80, v.x + v.R);
    const loy = Math.max(player.y - 80, v.y - v.R), hiy = Math.min(player.y + 80, v.y + v.R);
    const c0x = Math.floor(lox / CS), c1x = Math.floor(hix / CS);
    const c0y = Math.floor(loy / CS), c1y = Math.floor(hiy / CS);
    let n = 0;
    for (let cx = c0x; cx <= c1x; cx++) for (let cy = c0y; cy <= c1y; cy++)
      if (world.chunks.has(cx + "," + cy)) n++;
    return n;
  }
  // cache key = player tile + the town's warm stamp (passable() stays memoised
  // per town, so a re-flood after the stamp changes is cheap).
  const _ckOf = (cur) => player.x + ":" + player.y + ":" + (player.level | 0) + ":" + _warmStamp(cur);

  function _startFlood(cur) {
    if (typeof passable !== "function" || typeof world === "undefined" || !world || !world.chunks) return null;
    const villId = cur.v.x + "," + cur.v.y;
    if (villId !== _passVill || _passMemo.size > 262144) { _passMemo.clear(); _passVill = villId; }
    const sx = player.x, sy = player.y;
    const CS = world.CHUNK || 32;
    const warm = (x, y) => world.chunks.has(Math.floor(x / CS) + "," + Math.floor(y / CS));
    const passOk = (x, y) => {
      const k = EK(x, y);
      let v = _passMemo.get(k);
      if (v === undefined) {
        if (!warm(x, y)) return false;   // cold chunk: unwalkable for now, but
        v = passable(x, y);              // DON'T cache — it may warm in later;
        _passMemo.set(k, v);             // only stable (warm) results are memoised
      }
      return v;
    };
    const climbOK = (typeof stepClimbOK === "function") ? stepClimbOK : () => true;
    // bound the flood to findPath's 80-tile reach of the player AND the town
    // footprint (+margin) so it never spills far into open wilderness.
    const cx = cur.v.x, cy = cur.v.y, RB = cur.v.R + 3;
    const inBounds = (x, y) => Math.max(Math.abs(x - sx), Math.abs(y - sy)) <= 80
      && Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= RB;
    return { k: _ckOf(cur), seen: new Set([EK(sx, sy)]), qx: [sx], qy: [sy],
      head: 0, guard: 0, passOk, climbOK, inBounds };
  }
  // expand until the queue drains, the guard trips, or the time budget is spent
  // (deadline = perfNow()+ms; Infinity to finish now). Returns true when done.
  function _runFlood(f, deadline) {
    const { seen, qx, qy, passOk, climbOK, inBounds } = f;
    let budgetCheck = 0;
    while (f.head < qx.length) {
      if (f.guard++ >= 60000) break;
      const x = qx[f.head], y = qy[f.head]; f.head++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy, nk = EK(nx, ny);
        if (seen.has(nk) || !inBounds(nx, ny) || !passOk(nx, ny)) continue;
        if (dx && dy && (!passOk(nx, y) || !passOk(x, ny))) continue; // no corner-cutting
        if (!climbOK(x, y, nx, ny)) continue;                         // terraces
        seen.add(nk); qx.push(nx); qy.push(ny);
      }
      if ((++budgetCheck & 255) === 0 && perfNow() >= deadline) return false; // yield
    }
    _reach = { k: f.k, set: seen };
    return true;
  }
  // background nibble: advance the flood ~5ms/frame, re-scheduling until done
  function _tickFlood() {
    _rafOn = false;
    const cur = here();
    const ck = _ckOf(cur);
    if (!cur || (_reach && _reach.k === ck)) { _flood = null; return; }
    if (!_flood || _flood.k !== ck) _flood = _startFlood(cur);
    if (!_flood) return;
    if (!_runFlood(_flood, perfNow() + 5)) _scheduleFlood(); // not done → keep going
    else _flood = null;
  }
  function _scheduleFlood() {
    if (_rafOn || typeof requestAnimationFrame !== "function") return;
    _rafOn = true; requestAnimationFrame(_tickFlood);
  }

  // used by render(): return the reachable set, finishing any in-progress flood
  // synchronously so the menu is always correct the instant it opens.
  function reachableFrom(cur) {
    const ck = _ckOf(cur);
    if (_reach && _reach.k === ck) return _reach.set;
    if (!_flood || _flood.k !== ck) _flood = _startFlood(cur);
    if (!_flood) return null; // deps missing → caller skips reachability filter
    _runFlood(_flood, Infinity);
    const set = (_reach && _reach.k === ck) ? _reach.set : _flood.seen;
    _flood = null;
    return set;
  }
  // reach-1: can the player stand on any tile adjacent to (or on) the NPC?
  // Mirrors findPath(n.x, n.y, 1) !== null exactly — including its 80-tile
  // click cap, so the menu never offers an action that would then fail with
  // "You can't reach that."
  function reachNpc(seen, n) {
    if (Math.max(Math.abs(n.x - player.x), Math.abs(n.y - player.y)) > 80) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (seen.has(EK(n.x + dx, n.y + dy))) return true;
    return false;
  }

  // every NPC inside the settlement footprint that we can actually walk to,
  // deduped and sorted (shops/services first, then townsfolk, alpha within).
  function roster(cur) {
    if (!cur || typeof world === "undefined" || !world || !Array.isArray(world.npcs)) return [];
    const v = cur.v, R2 = v.R * v.R;
    const reach = reachableFrom(cur);     // null = couldn't compute → don't filter
    const dedupe = new Set(), out = [];
    for (const n of world.npcs) {
      if (!n || n.name == null) continue;
      const dx = n.x - v.x, dy = n.y - v.y;
      if (dx * dx + dy * dy >= R2) continue;            // outside this settlement
      const key = n.name + "@" + n.x + "," + n.y + "," + (n.level | 0);
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      if (reach && !reachNpc(reach, n)) continue;       // no walkable path
      out.push(n);
    }
    const rank = n => (n.trader || n.banker) ? 0 : 1;
    out.sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
    return out;
  }

  // the FULL right-click menu for an NPC — the same entries buildTileMenu builds
  // (input.js): the primary Talk/Trade action (walk-to-then-act via doTarget),
  // plus an Examine line. Reuses the game's own hoverLabel/doTarget so labels,
  // night-closed/asleep gates and behaviour stay in lockstep with right-click.
  function npcMenu(npc) {
    const tg = { kind: "npc", npc };
    const items = [];
    if (typeof hoverLabel === "function" && typeof doTarget === "function")
      items.push({ label: hoverLabel(tg), fn: () => doTarget(tg) });
    else
      items.push({
        label: (npc.trader ? "Trade with " : "Talk to ") + npc.name,
        fn: () => { if (typeof setGoal === "function") setGoal({ type: "npc", npc }, npc.x, npc.y, 1); },
      });
    const exam = (typeof npcAsleep === "function" && npcAsleep(npc)) ? `${npc.name} is fast asleep.`
      : npc.trader ? ((typeof shopClosed === "function" && shopClosed(npc)) ? "A merchant — shop's shut for the night." : "A merchant. Fair prices, mostly.")
      : `${npc.name}, a villager.`;
    items.push({ label: `Examine ${npc.name}`, fn: () => { if (typeof log === "function") log(exam, "sys"); } });
    return items;
  }

  function roleOf(npc) {
    if (npc.trader) return shopName(npc);
    if (npc.banker) return "Banker";
    if (npc._questGiver) return "Has a task";
    return npc.mixTitle || npc._bjob || "Townsfolk";
  }
  function symOf(npc) {
    if (npc.trader) return SHOP_SYM[npc.shopType] || "\u{1F6D2}";
    if (npc.banker) return "\u{1F3E6}";       // 🏦
    if (npc._questGiver) return "✦";       // ✦
    return "\u{1F464}";                        // 👤
  }

  function card(npc) {
    const el = document.createElement("div");
    el.className = "tf-npc";
    const head = document.createElement("div");
    head.className = "tf-head";
    const sym = document.createElement("span");
    sym.className = "tf-sym";
    sym.textContent = symOf(npc);
    if (npc.trader) sym.title = shopName(npc);
    const name = document.createElement("span");
    name.className = "tf-name";
    name.textContent = npc.name;
    const role = document.createElement("span");
    role.className = "tf-role";
    role.textContent = roleOf(npc);
    head.append(sym, name, role);
    const acts = document.createElement("div");
    acts.className = "tf-acts";
    for (const it of npcMenu(npc)) {
      const a = document.createElement("div");
      a.className = "tf-act";
      a.textContent = it.label;
      a.onclick = () => { dialog.classList.remove("on"); it.fn(); };
      acts.appendChild(a);
    }
    const main = document.createElement("div");
    main.className = "tf-main";
    main.append(head, acts);
    const por = portraitEl(npc);
    if (por) { por.title = npc.name; el.append(por, main); }
    else el.append(main);
    return el;
  }

  function render() {
    const cur = here();
    if (!cur) { dialog.classList.remove("on"); return; }
    titleEl.textContent = (cur.v.name || "Here") + " — who's about";
    bodyEl.innerHTML = "";
    const list = roster(cur);
    if (!list.length) {
      const e = document.createElement("div");
      e.className = "tf-empty";
      e.textContent = "No one here you can reach right now.";
      bodyEl.appendChild(e);
      return;
    }
    const shops = list.filter(n => n.trader || n.banker);
    const folk = list.filter(n => !(n.trader || n.banker));
    const section = (label, arr) => {
      if (!arr.length) return;
      const h = document.createElement("div");
      h.className = "tf-group";
      h.textContent = label;
      const grid = document.createElement("div");
      grid.className = "tf-grid";
      for (const n of arr) grid.appendChild(card(n));
      bodyEl.append(h, grid);
    };
    section("Shops & services", shops);
    section("Townsfolk", folk);
  }

  topBtn.onclick = () => { dialog.classList.add("on"); render(); };

  // show/hide the button as the player enters/leaves settlements; refresh the
  // name live. Cheap — currentSettlement() is a small cached lookup. The heavy
  // reachability flood runs in the background (precomputed here) so the menu
  // opens instantly; it never runs on this poll's critical path.
  function tick() {
    const cur = here();
    topBtn.classList.toggle("on", !!cur);
    if (cur) {
      whereEl.textContent = cur.v.name || "Settlement";
      pinEl.textContent = cur.v.kind === "city" ? "\u{1F3D9}️" : "\u{1F3D8}️"; // 🏙️ / 🏘️
      if (!(_reach && _reach.k === _ckOf(cur))) _scheduleFlood();   // warm reachability ahead of a click
    } else if (dialog.classList.contains("on")) {
      dialog.classList.remove("on");   // walked out of town with the panel open
    }
  }
  setInterval(tick, 800);
  tick();
})();
