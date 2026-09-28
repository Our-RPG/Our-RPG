// ===== Taiao Lua — host bridge (the game API exposed to Lua) =====
// Builds __LUA.HOST: the table of __-prefixed JS functions injected into the Lua
// state at boot. Each is a THIN wrapper over a real engine global — nothing here
// reimplements game logic (mirrors the old js/questscript/qs-stdlib.js bridges):
//   __chatnpc -> npcSay      __add_item/__del_item -> addItem/removeItem
//   __has_item -> countItem  __get_var/__set_var   -> player.scriptVars
// Suspending verbs (__walk_to/__wait/__choice/...) return a Promise; wasmoon
// yields the running Lua coroutine on it (see js/lua/lua-boot.js header).
"use strict";

(function () {
  const L = (window.__LUA = window.__LUA || {});

  // ---- context helpers (the bound NPC/loc for the running handler) ----------
  const ctx = cid => (L.ctx ? L.ctx.get(cid) : null);
  const npcOf = cid => { const c = ctx(cid); return c && c.npc; };
  const P = () => (typeof player !== "undefined" ? player : null);

  const localHour = x => (typeof localPhase === "function" ? Math.floor(localPhase(x) * 24) : 0);
  const ctxLon = cid => { const n = npcOf(cid); return n ? n.x : (P() ? P().x : 0); };
  const ctxLat = cid => { const n = npcOf(cid); return n ? n.y : (P() ? P().y : 0); };
  const bankNet = cid => { const n = npcOf(cid); return (n && typeof bankNetFor === "function") ? bankNetFor(n.x, n.y) : "main"; };

  function scriptVars() {
    const p = P(); if (!p) return {};
    if (!p.scriptVars || typeof p.scriptVars !== "object") p.scriptVars = {};
    return p.scriptVars;
  }

  // Scripts may hand out items no other system registered — register a stackable
  // placeholder so addItem/countItem behave (same pattern as gameplay/quests.js).
  function ensureItem(id) {
    if (typeof ITEMS === "undefined" || ITEMS[id]) return id;
    let icon = "i_planks";
    if (typeof SPR !== "undefined") { if (SPR["i_" + id]) icon = "i_" + id; else if (SPR[id]) icon = id; }
    const nm = id.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
    ITEMS[id] = { name: nm, icon, stack: true, value: 0, questItem: true };
    if (typeof EXAMINE !== "undefined" && !EXAMINE[id]) EXAMINE[id] = `A ${nm.toLowerCase()}.`;
    if (typeof registerPlaceholder === "function") registerPlaceholder(id, nm, "Lua script item — placeholder icon");
    return id;
  }
  L.ensureItem = ensureItem;

  // ---- routine helpers (async; drive render3d's _escortTarget locomotion) ---
  async function wanderImpl(npc, r) {
    if (!npc) return;
    r = Math.max(1, (r | 0) || (npc._r || 3));
    if (Math.random() < 0.5) { await L.coro.pause(npc, 1200 + Math.random() * 3200); return; }
    const hx = npc._home ? npc._home[0] : npc.x, hy = npc._home ? npc._home[1] : npc.y;
    let tx = npc.x, ty = npc.y;
    for (let i = 0; i < 6; i++) {
      const cx = hx + (Math.floor(Math.random() * (2 * r + 1)) - r);
      const cy = hy + (Math.floor(Math.random() * (2 * r + 1)) - r);
      if (typeof world !== "undefined" && world.isBlocked && (world.isBlocked(cx, cy) || (world.isWater && world.isWater(cx, cy)))) continue;
      tx = cx; ty = cy; break;
    }
    npc._escortTarget = [tx, ty, npc.level | 0];
    await L.coro.arrive(npc, 5000);
  }
  function sleepUntilImpl(npc, h) {
    h = (((h | 0) % 24) + 24) % 24;
    const x = npc ? npc.x : (P() ? P().x : 0);
    const ph = () => (typeof localPhase === "function" ? localPhase(x) : 0);
    const EPS = 1e-6, tp = h / 24, p0 = ph();
    return L.coro.waitOn(npc || {}, () => {
      const p = ph();
      return p0 <= tp + EPS ? (p >= tp - EPS) : (p >= tp - EPS && p < p0);
    });
  }

  // ---- scripted encounter: spawn a live monster ----------------------------
  function spawnMonster(kind, x, y) {
    if (typeof MONSTERS === "undefined" || !MONSTERS[kind] || typeof monsters === "undefined") return false;
    if (typeof monMaxHp !== "function" || typeof PX !== "function") return false;
    const aquatic = !!MONSTERS[kind].canSwim || !!MONSTERS[kind].aquatic;
    const m = {
      uid: (typeof _monUid !== "undefined") ? ++_monUid : Math.floor(Math.random() * 1e9),
      kind, x, y, sx: x, sy: y, px: PX(x), py: PX(y),
      hp: monMaxHp(kind), alive: true, moving: null, target: null,
      nextAtkAt: 0, facing: 1, dir8: "south", spr: MONSTERS[kind].spr, lungeT: -9999,
      spawnBiome: (typeof world !== "undefined" && world.biomeAt) ? world.biomeAt(x, y) : null,
      canSwim: aquatic, scripted: true,
    };
    if (aquatic && typeof waterDepthAt === "function") {
      const wd = waterDepthAt(x, y);
      m.swimY = m.swimTgt = Math.min(wd, 0.35);
    }
    monsters.push(m);
    return true;
  }

  // ---- the injected host table ---------------------------------------------
  L.HOST = {
    // persistence (the `quest` proxy sits on these)
    __get_var: k => (scriptVars()[k] | 0),
    __set_var: (k, v) => { scriptVars()[k] = v | 0; },

    // speech / messages
    __chatnpc: (cid, t) => { const n = npcOf(cid); if (n && typeof npcSay === "function") npcSay(n, String(t)); else if (typeof log === "function") log(String(t), "sys"); },
    __say: (cid, t) => { const n = npcOf(cid); if (n && typeof npcSay === "function") npcSay(n, String(t)); },
    __mes: t => { if (typeof log === "function") log(String(t), "sys"); },

    // choices (async — yields until the player clicks; returns 1-based index)
    __choice: async (...labels) => (L.modal ? await L.modal.choose(labels.map(String)) : 1),
    __dialog: async (title, body, ...labels) => (L.modal ? await L.modal.dialog(String(title), String(body), labels.map(String)) : 1),

    // inventory / progression
    __add_item: (id, n) => { const rid = ensureItem(String(id)); return (typeof addItem === "function") ? !!addItem(rid, (n | 0) || 1) : false; },
    __del_item: (id, n) => { if (typeof removeItem === "function") removeItem(String(id), (n | 0) || 1); },
    __has_item: id => (typeof countItem === "function" && countItem(String(id)) > 0),
    __count_item: id => (typeof countItem === "function" ? countItem(String(id)) : 0),
    __kills: kind => { const p = P(); return (p && p.kills && p.kills[String(kind)]) | 0; },
    __give_xp: (skill, n) => { if (typeof addXp === "function") addXp(String(skill), n | 0); },
    __skill_lvl: name => (typeof skillLvl === "function" ? skillLvl(String(name)) : 0),
    __qp: () => { const p = P(); return (p ? p.questPoints : 0) | 0; },
    __quest_point: n => { const p = P(); if (p) { p.questPoints = (p.questPoints | 0) + (n | 0); if (typeof log === "function") log(`Quest points: ${p.questPoints}.`, "gold"); } },
    __rand: n => Math.floor(Math.random() * Math.max(1, n | 0)),

    // world-object removal (on_loc)
    __loc_del: (cid, policy) => {
      const c = ctx(cid);
      if (c && c.loc && typeof pickedDecor !== "undefined") {
        const key = c.loc.x + "," + c.loc.y;
        const base = (typeof now !== "undefined") ? now : Date.now();
        const at = (String(policy) === "none") ? base + 3.15e12
          : base + (typeof DECOR_RESPAWN_MS !== "undefined" ? DECOR_RESPAWN_MS : 300000);
        pickedDecor.set(key, at);
        if (typeof RegionSync !== "undefined") RegionSync.noteDecor(c.loc.x, c.loc.y, at);
        if (typeof uiDirty !== "undefined") uiDirty = true;
      }
    },

    // time / environment
    __time_hour: (cid, x) => localHour(x != null ? (x | 0) : ctxLon(cid)),
    __is_night: cid => (typeof isBedtime === "function" && isBedtime(ctxLon(cid))),
    __is_bedtime: cid => (typeof isBedtime === "function" && isBedtime(ctxLon(cid))),
    __sky: cid => (typeof skyLabel === "function" ? skyLabel(ctxLat(cid), ctxLon(cid)) : ""),

    // stink
    __stink_total: () => (typeof stinkTotal === "function" ? stinkTotal() : 0),
    __stink_blocks_shops: () => (typeof stinkBlocksShops === "function" && stinkBlocksShops()),
    __stink_blocks_gates: () => (typeof stinkBlocksGates === "function" && stinkBlocksGates()),

    // shop / bank (bound NPC = shopkeeper / banker)
    __shop_closed: cid => { const n = npcOf(cid); return !!(n && !n.alwaysOpen && typeof shopClosed === "function" && shopClosed(n)); },
    __open_shop: cid => { const n = npcOf(cid); if (!n) return; if (typeof openMarket === "function") openMarket(n); else if (typeof openShop === "function") openShop(n); },
    __has_account: cid => (typeof hasBankAccount === "function" && hasBankAccount(bankNet(cid))),
    __open_bank: cid => { const n = npcOf(cid); if (n && typeof openBank === "function") openBank(n); },
    __bank_open_account: cid => { const n = npcOf(cid); if (n && typeof openBankAccountFor === "function") openBankAccountFor(bankNet(cid), n); },

    // NPC-context readers
    __here_x: cid => { const n = npcOf(cid); return n ? n.x | 0 : 0; },
    __here_y: cid => { const n = npcOf(cid); return n ? n.y | 0 : 0; },
    __here_level: cid => { const n = npcOf(cid); return n ? (n.level | 0) : 0; },
    __home_x: cid => { const n = npcOf(cid); return n && n._home ? n._home[0] : (n ? n.x : 0); },
    __home_y: cid => { const n = npcOf(cid); return n && n._home ? n._home[1] : (n ? n.y : 0); },
    __home_radius: cid => { const n = npcOf(cid); return n && n._r ? n._r : 3; },
    __bed_x: cid => { const n = npcOf(cid); return n && n._bed ? n._bed[0] : (n && n._home ? n._home[0] : 0); },
    __bed_y: cid => { const n = npcOf(cid); return n && n._bed ? n._bed[1] : (n && n._home ? n._home[1] : 0); },
    __bed_level: cid => { const n = npcOf(cid); return n && n._bed ? (n._bedLevel | 0) : 0; },

    // player position (for handlers with no bound NPC — on_item / on_kill)
    __player_x: () => { const p = P(); return p ? p.x | 0 : 0; },
    __player_y: () => { const p = P(); return p ? p.y | 0 : 0; },

    // travel / fx / Weaver-position queries
    __teleport: (x, y) => { if (typeof portalTravel === "function") portalTravel(x | 0, y | 0); },
    __sfx: name => { if (typeof sfx === "function") sfx(String(name), 0.5); },
    __weaver_tower_x: () => (typeof Wizard !== "undefined" && Wizard.towerPos() ? Wizard.towerPos().x : 0),
    __weaver_tower_y: () => (typeof Wizard !== "undefined" && Wizard.towerPos() ? Wizard.towerPos().y : 0),
    __at_tower: () => {
      const t = typeof Wizard !== "undefined" && Wizard.towerPos();
      return !!(t && P() && Math.abs(P().x - t.x) < 24 && Math.abs(P().y - t.y) < 24);
    },
    __spawn_x: () => (typeof world !== "undefined" && world && world.playerStart ? world.playerStart.x : 0),
    __spawn_y: () => (typeof world !== "undefined" && world && world.playerStart ? world.playerStart.y : 0),

    // routine motion (async — always return a Promise so Lua's :await() is safe)
    __walk_to: (cid, x, y, lv) => { const n = npcOf(cid); if (!n) return Promise.resolve(); n._escortTarget = [x | 0, y | 0, lv != null ? (lv | 0) : (n.level | 0)]; return L.coro.arrive(n); },
    __walk_home: cid => { const n = npcOf(cid); if (!n) return Promise.resolve(); const hx = n._home ? n._home[0] : n.x, hy = n._home ? n._home[1] : n.y; n._escortTarget = [hx, hy, 0]; return L.coro.arrive(n); },
    __go_to_bed: cid => { const n = npcOf(cid); if (!n) return Promise.resolve(); const bx = n._bed ? n._bed[0] : (n._home ? n._home[0] : n.x), by = n._bed ? n._bed[1] : (n._home ? n._home[1] : n.y); n._escortTarget = [bx, by, n._bed ? (n._bedLevel | 0) : 0]; return L.coro.arrive(n, 12000); },
    __climb_to: (cid, lv) => { const n = npcOf(cid); if (!n) return Promise.resolve(); n._escortTarget = [n.x, n.y, lv | 0]; return L.coro.arrive(n, 8000); },
    __wander: (cid, r) => wanderImpl(npcOf(cid), r),
    __sleep_until: (cid, h) => sleepUntilImpl(npcOf(cid), h),
    __wait: (cid, sec) => L.coro.pause(npcOf(cid) || {}, Math.max(0, +sec || 0) * 1000),

    // instant routine actions
    __open_door: (x, y) => { if (typeof world !== "undefined" && world.setDoorOpen) world.setDoorOpen(x | 0, y | 0, true); },
    __close_door: (x, y) => { if (typeof world !== "undefined" && world.setDoorOpen) world.setDoorOpen(x | 0, y | 0, false); },
    __face: (cid, dir) => { const n = npcOf(cid); if (n) n.dir8 = String(dir); },

    // lamplighter
    __lamp_mode: cid => { const n = npcOf(cid); return n ? L.coro.lampModeFor(n) : ""; },
    __claim_lamp_spot: cid => { const n = npcOf(cid); return n ? L.coro.claimLampSpot(n) : false; },
    __lamp_spot_x: cid => { const n = npcOf(cid); const s = n && L.coro.lampSpotOf(n); return s ? s[0] : (n ? n.x : 0); },
    __lamp_spot_y: cid => { const n = npcOf(cid); const s = n && L.coro.lampSpotOf(n); return s ? s[1] : (n ? n.y : 0); },
    __light_lamp: cid => { const n = npcOf(cid); if (n) L.coro.lightLamp(n); },

    // scripted encounters (NEW)
    __spawn_monster: (kind, x, y) => spawnMonster(String(kind), x | 0, y | 0),

    // cutscene (NEW)
    __fade: (dir, sec) => L.cutscene.fade(dir | 0, +sec),
    __scene_text: (t, sec) => L.cutscene.text(String(t), +sec),
    __cam_zoom: (z, sec) => L.cutscene.camZoom(+z, +sec),
    __play_bifrost: () => { if (typeof Bifrost !== "undefined" && Bifrost.start) Bifrost.start({}); },
    // fire a registered cutscene(name) as its own dispatch (engages the cine gate)
    __play_cutscene: name => { if (window.Lua && window.Lua.playCutscene) window.Lua.playCutscene(String(name)); },
  };
})();
