// ===== Taiao Workshop — providers for monsters, tiles, UI & sounds =====
// These read the game's own data layer (loaded in index.html): the universal
// SPR sprite table, the MONSTERS registry, biome/flat tiles, the map-icon &
// gear-icon atlases, and the audio manifest. A self-contained port of the
// game's sprite resolver (js/main/assets.js icon() / objedit.js drawKeys) lets
// us draw any SPR key straight from the game's atlases. Everything is guarded
// so a missing data file just yields an empty catalog, never an error.
"use strict";

// ---------------- Asset provenance (origin + maker) ----------------
// Every sprite is drawn from a named spritesheet, and the SHEET decides who made
// the art (see README Credits + each js/sprites/*.js header). Kenney.nl and Clint
// Bellanger's "Tiny Creatures" are human CC0 packs; a handful of sheets are
// hand-drawn; the ChatGPT / AI "art drop" sheets are AI; everything else is
// PixelLab-generated (the default). Every AI and PixelLab prompt was run by
// "admin". Resolve an entry via forSprKey(sprKey) → { madeBy, maker }.
const AssetOrigin = (function () {
  const H = who => ({ madeBy: "human", maker: who });
  const AI = { madeBy: "ai", maker: "admin" };            // ChatGPT / AI image-gen drop
  const PIXELLAB = { madeBy: "pixellab", maker: "admin" };
  // spritesheet code → origin; unlisted sheets (incl. the packed character /
  // object atlases) default to PixelLab.
  const SHEET = {
    t: H("Kenney.nl"), c: H("Kenney.nl"),               // Kenney.nl CC0 packs
    m: H("Clint Bellanger"),                             // "Tiny Creatures" CC0
    x: H("admin"), bi: H("admin"), cw: H("admin"), fw: H("admin"), mx: H("admin"),   // hand-drawn
    // ChatGPT / AI "art drop" sheets (forage, map-icon atlases, gear + the
    // reference-PNG-derived armour/arrow/ingot/alloy/crop icon sheets)
    fg: AI, mi: AI, mi2: AI, ga: AI,
    ag: AI, aw: AI, ah: AI, mb: AI, cb: AI, ay: AI,
    cg: AI, cf: AI, ch: AI, co: AI, cp: AI,
  };
  // Explicit per-asset AI overrides (win over the sheet map AND the 8-direction
  // → PixelLab probe): a set of hand-listed object keys plus every composite-mob
  // sprite (cmb_ / cms_ boss art).
  const AI_KEYS = new Set(["altar_rune", "assay_furnace", "bindery", "charcoal_clamp", "cobblers_bench",
    "cooperage", "creamery", "drawbench", "fulling_mill", "leather_bench", "lime_kiln", "locksmith_bench",
    "malthouse", "masons_yard", "paper_mill", "ropewalk", "saddlers_bench", "sawmill", "seasoning_yard",
    "shipyard", "soap_works", "tailors_bench", "toolsmith"]);
  const forcedAI = key => !!key && (AI_KEYS.has(key) || /^cm[bs]_/.test(key));
  // does an ENTRY resolve to a forced-AI asset? checks its own key and (for
  // monsters/objects) its south-facing sprite layer keys.
  const forcedAIEntry = (provider, e) => {
    if (!e) return false;
    if (forcedAI(e.key)) return true;
    if (provider && typeof provider.layerKeys === "function") {
      const keys = provider.layerKeys(e.key, 0) || [];
      if (keys.some(forcedAI)) return true;
    }
    return false;
  };
  // Explicit per-SPR-key provenance overrides (win over the sheet map). Hand-listed
  // corrections for individual icon keys / key prefixes. `_ex` = exact keys,
  // `_pf` = key prefixes ("all keys starting with…"). Exact wins over prefix.
  const KENNEY = H("Kenney.nl");
  const OVR_EXACT = {}, OVR_PREFIX = [];
  const _ex = (o, keys) => keys.forEach(k => { OVR_EXACT[k] = o; });
  const _pf = (o, prefs) => prefs.forEach(p => OVR_PREFIX.push([p, o]));
  _ex(AI, ["i_boat_barge", "i_boat_catboat", "i_boat_coracle", "i_boat_dinghy", "i_boat_dory",
    "i_raft_logs", "i_raft_planks", "i_ring", "i_shafts", "i_skiff", "i_spring", "i_tacks"]);
  _pf(AI, ["i_ship_", "i_wc_bow_", "i_wc_buckler_", "i_wc_staff_", "mx_"]);
  _ex(KENNEY, ["i_canoe", "i_cloth", "i_dyed_silk_cloth", "i_fine_paper", "i_flour", "i_foresail",
    "i_leather", "i_lime_plaster", "i_lye", "i_meat", "i_mortar", "i_paper", "i_rawmeat", "i_robe",
    "i_sailboat", "i_ship", "i_vellum", "i_wheat"]);
  _pf(KENNEY, ["i_crop", "i_grain"]);
  const keyOverride = key => {
    if (!key) return null;
    if (OVR_EXACT[key]) return OVR_EXACT[key];                        // exact wins (e.g. i_ship → Kenney)
    for (const [p, o] of OVR_PREFIX) if (key.indexOf(p) === 0) return o;   // then prefix (e.g. i_ship_ → AI)
    return null;
  };
  const forSheet = code => (code && SHEET[code]) || PIXELLAB;
  const forSprKey = key => keyOverride(key) || (forcedAI(key) ? AI : forSheet((typeof SPR !== "undefined" && SPR[key]) ? SPR[key][0] : null));
  return { forSheet, forSprKey, forcedAI, forcedAIEntry, HUMAN: H, AI, PIXELLAB };
})();

// ---------------- SPR resolver (self-contained) ----------------
const SprRender = (function () {
  const have = () => typeof SPR !== "undefined" && typeof ASSET_DATA !== "undefined";
  const TILE = () => (typeof SHEET_TILE !== "undefined" ? SHEET_TILE : {});
  const NOPAD = () => (typeof SHEET_NOPAD !== "undefined" ? SHEET_NOPAD : new Set());
  const COLORKEY = () => (typeof SHEET_COLORKEY !== "undefined" ? SHEET_COLORKEY : new Set());
  const OFFSET = () => (typeof SHEET_OFFSET !== "undefined" ? SHEET_OFFSET : {});
  const imgs = {};   // sheetKey → Image
  // priority: "high" for sheets a visible tab is drawing right now, "low" for the
  // background warm. The sheets total ~50MB across 66 files, so a blanket eager
  // load saturates the browser's ~6 connections and the tab you actually open
  // ends up queued behind giant icon/npc atlases. High-priority on-demand fetches
  // + a throttled low-priority warm keep the visible gallery instant.
  function sheetImg(sheet, priority) {
    if (imgs[sheet]) return imgs[sheet];
    if (typeof ASSET_DATA === "undefined" || !ASSET_DATA[sheet]) return null;
    const img = new Image();
    try { if (priority) img.fetchPriority = priority; } catch (_) {}
    // Fire a sheet-SPECIFIC event so only the tiles that actually need this
    // sheet redraw — not every pending canvas in the app. decode() guarantees
    // the bitmap is ready so the redraw paints instantly.
    const done = () => document.dispatchEvent(new CustomEvent("studio-sheet:" + sheet));
    img.onload = () => { if (img.decode) img.decode().then(done, done); else done(); };
    img.onerror = done;   // let waiters/queue advance even on a failed sheet
    img.src = ASSET_BASE + ASSET_DATA[sheet];
    imgs[sheet] = img;
    return img;
  }

  // Port of objedit.js drawKeys: composite one or more SPR keys into a canvas.
  function drawKeys(cv, keys, px, flip) {
    px = px || cv.width || 64;
    cv.width = px; cv.height = px;
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, px, px);
    if (!have()) return false;
    let drew = false;
    const waiting = new Set();   // sheets this canvas is already queued to wait on
    for (const key of [].concat(keys)) {
      const def = SPR[key];
      if (!def) continue;
      const [sheet, c, r, extra] = def;
      const img = sheetImg(sheet, "high");   // this sheet is on screen now — fetch it first
      if (!img || !img.complete || img.naturalWidth === 0) {
        if (img && !waiting.has(sheet)) {
          waiting.add(sheet);
          document.addEventListener("studio-sheet:" + sheet, () => drawKeys(cv, keys, px, flip), { once: true });
        }
        continue;
      }
      const st = TILE()[sheet] || 16;
      const off = OFFSET()[sheet] || { ox: 0, oy: 0 };
      const pitch = NOPAD().has(sheet) ? st : st + 1;
      const sx = (extra && extra.sx != null ? extra.sx : c * pitch) + (off.ox || 0);
      const sy = (extra && extra.sy != null ? extra.sy : r * pitch) + (off.oy || 0);
      const sw = (extra && extra.sw) || st, sh = (extra && extra.sh) || st;
      ctx.save();
      if (flip) { ctx.translate(px, 0); ctx.scale(-1, 1); }
      if (extra && extra.filter) ctx.filter = extra.filter;
      if (COLORKEY().has(sheet)) {
        const tmp = document.createElement("canvas"); tmp.width = px; tmp.height = px;
        const tc = tmp.getContext("2d"); tc.imageSmoothingEnabled = false;
        tc.drawImage(img, sx, sy, sw, sh, 0, 0, px, px);
        try {
          const id = tc.getImageData(0, 0, px, px), d = id.data;
          for (let i = 0; i < d.length; i += 4) if (d[i] < 12 && d[i + 1] < 12 && d[i + 2] < 12) d[i + 3] = 0;
          tc.putImageData(id, 0, 0);
        } catch (_) {}
        ctx.drawImage(tmp, 0, 0, px, px);
      } else {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, px, px);
      }
      ctx.restore();
      drew = true;
    }
    return drew;
  }
  // Blit ONE SPR key into an existing context at (dx,dy,w,h) — no clear, so many
  // sprites compose onto a shared canvas (the deep-zoom tile map). Returns true if
  // it drew; false if the sheet isn't loaded yet (it kicks off the fetch, and the
  // caller redraws on the "studio-sheet:<sheet>" event). Colour-keyed sheets ("n")
  // get their black→transparent tile baked once and cached by key+size.
  const ckCache = new Map();
  function blit(ctx, key, dx, dy, w, h) {
    if (!have()) return false;
    const def = SPR[key];
    if (!def) return false;
    const [sheet, c, r, extra] = def;
    const img = sheetImg(sheet, "high");
    if (!img || !img.complete || img.naturalWidth === 0) return false;
    const st = TILE()[sheet] || 16;
    const off = OFFSET()[sheet] || { ox: 0, oy: 0 };
    const pitch = NOPAD().has(sheet) ? st : st + 1;
    const sx = (extra && extra.sx != null ? extra.sx : c * pitch) + (off.ox || 0);
    const sy = (extra && extra.sy != null ? extra.sy : r * pitch) + (off.oy || 0);
    const sw = (extra && extra.sw) || st, sh = (extra && extra.sh) || st;
    if (COLORKEY().has(sheet)) {
      const ck = key + "@" + w + "x" + h;
      let tile = ckCache.get(ck);
      if (!tile) {
        tile = document.createElement("canvas"); tile.width = w; tile.height = h;
        const tc = tile.getContext("2d"); tc.imageSmoothingEnabled = false;
        tc.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        try {
          const id = tc.getImageData(0, 0, w, h), d = id.data;
          for (let i = 0; i < d.length; i += 4) if (d[i] < 12 && d[i + 1] < 12 && d[i + 2] < 12) d[i + 3] = 0;
          tc.putImageData(id, 0, 0);
        } catch (_) {}
        ckCache.set(ck, tile);
      }
      ctx.drawImage(tile, dx, dy, w, h);
    } else {
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, w, h);
    }
    return true;
  }

  // Background-warm every sheet at LOW priority, at most a couple in flight, so
  // revisiting a tab is instant without ever stealing bandwidth from the sheets
  // the currently-open tab is fetching at high priority. `firstSheets` are warmed
  // ahead of the rest (e.g. the default tab's sheets).
  function preload(firstSheets) {
    if (typeof ASSET_DATA === "undefined") return;
    const all = Object.keys(ASSET_DATA);
    const head = (firstSheets || []).filter(s => ASSET_DATA[s]);
    const queue = head.concat(all.filter(s => head.indexOf(s) < 0)).filter(s => !imgs[s]);
    let i = 0, active = 0;
    const MAX = 2;   // leave connections free for high-priority on-demand fetches
    function pump() {
      while (active < MAX && i < queue.length) {
        const sheet = queue[i++];
        if (imgs[sheet]) continue;
        active++;
        document.addEventListener("studio-sheet:" + sheet, () => { active--; pump(); }, { once: true });
        if (!sheetImg(sheet, "low")) { active--; }
      }
    }
    pump();
  }
  return { have, drawKeys, blit, sheetImg, preload };
})();

// ---------------- Object sprites (trees, rocks, stations, props) ----------------
// World objects don't live in SPR — they're packed on the shared `objects` sheet
// (OBJ_SHEET), addressed by OBJ_MAP[name]*8 + direction. A node/decor KEY (e.g.
// "tree", "rock_copper", "s_rock5") first resolves to a packed object + display
// scale via objForKey — a self-contained port of render3d.js:objForKey/objScaleFor
// (the game's 3D resolver, unavailable here). Used by the Zones deep-zoom tile view.
const ObjRender = (function () {
  const CELL = () => (typeof OBJ_CELL !== "undefined" ? OBJ_CELL : 96);
  const COLS = () => (typeof OBJ_COLS !== "undefined" ? OBJ_COLS : 64);
  const MAP = () => (typeof OBJ_MAP !== "undefined" ? OBJ_MAP : null);
  const url = () => (typeof OBJ_SHEET !== "undefined" ? ASSET_BASE + OBJ_SHEET : "");
  // tables copied verbatim from js/render3d.js
  const OBJ_STATION = { furnace: 1.5, anvil: 1.5, loom: 1.5, cauldron: 1.5, workbench: 1.5, tanrack: 1.5, mill: 1.5, altar: 1.5, sawmill: 1.5, cooperage: 1.5, malthouse: 1.5, fulling_mill: 1.5, masons_yard: 1.5, assay_furnace: 1.5, drawbench: 1.5, leather_bench: 1.5, cobblers_bench: 1.5, saddlers_bench: 1.5, toolsmith: 1.5, locksmith_bench: 1.5, paper_mill: 1.5, bindery: 1.5, soap_works: 1.5, seasoning_yard: 1.5, charcoal_clamp: 1.5, lime_kiln: 1.5, ropewalk: 1.5, shipyard: 1.5, barn: 1.5, creamery: 1.5, tailors_bench: 1.5, altar_rune: 1.5, bread_oven: 1.4, brewery_tun: 1.4, spinning_wheel: 1.4, dye_vat: 1.4, kiln: 1.4, jewelrytable: 1.4, sailmaker_spindle: 1.4, chandler_set: 1.4 };
  const OBJ_ROCK = { rock_copper: 1.2, rock_iron: 1.2, rock_gold: 1.2, rock_essence: 1.2 };
  const OBJ_TREEBASE = { tree: "tree_generic", tree_orange: "tree_maple", tree_pine: "tree_pine", tree_apple: "tree_cherry" };
  const OBJ_TREECYCLE = ["tree_oak", "tree_maple", "tree_pine", "tree_cherry"];
  const OBJ_ROCK_TIER = { 1: "rock_tin", 3: "rock_zinc", 4: "rock_lead", 5: "rock_silver", 6: "rock_nickel", 7: "rock_cobalt", 9: "rock_platinum", 10: "rock_tungsten", 11: "rock_titanium", 12: "rock_mithril", 13: "rock_orichalcum", 14: "rock_adamantite", 15: "rock_darksteel", 16: "rock_meteorite", 17: "rock_runite", 18: "rock_dragonite", 19: "rock_voidsteel", 20: "rock_starmetal", 21: "rock_bloodiron", 22: "rock_frostiron", 23: "rock_emberite", 24: "rock_stormsteel", 25: "rock_duskmetal", 26: "rock_dawnmetal", 27: "rock_aetherium", 28: "rock_celestium" };
  const SCALE = () => (typeof OBJ_SCALE !== "undefined" && OBJ_SCALE ? OBJ_SCALE : {});
  const NZ = () => (typeof NZ_TREE_SCALE !== "undefined" && NZ_TREE_SCALE ? NZ_TREE_SCALE : {});
  function scaleFor(key) {
    if (SCALE()[key] != null) return SCALE()[key];
    if (NZ()[key] != null) return NZ()[key];
    if (key.startsWith("tree_") || key.startsWith("nz_")) return 2.2;
    if (key.startsWith("rock_")) return 1.2;
    if (key.startsWith("forage_")) return 0.85;
    if (key.startsWith("herb_")) return 0.5;
    if (key.startsWith("crystal_")) return 0.9;
    if (key.startsWith("wall_") || key.startsWith("tower_")) return 1.4;
    return 0.9;
  }
  function objForKey(key) {
    const M = MAP(); if (!M || !key) return null;
    if (OBJ_STATION[key] != null && M[key] != null) return { idx: M[key], scale: OBJ_STATION[key] };
    if (OBJ_ROCK[key] != null && M[key] != null) return { idx: M[key], scale: OBJ_ROCK[key] };
    if (key === "stump" && M.stump != null) return { idx: M.stump, scale: 1.3 };
    if (key === "gravestone" && M.gravestone2 != null) return { idx: M.gravestone2, scale: 0.9 };
    if (OBJ_TREEBASE[key] && M[OBJ_TREEBASE[key]] != null) return { idx: M[OBJ_TREEBASE[key]], scale: scaleFor(OBJ_TREEBASE[key]) };
    if (key.startsWith("s_rock")) { const ok = OBJ_ROCK_TIER[parseInt(key.slice(6), 10)]; return (ok && M[ok] != null) ? { idx: M[ok], scale: 1.2 } : null; }
    if (key.startsWith("s_tree")) { const ok = OBJ_TREECYCLE[(parseInt(key.slice(6), 10) || 0) % 4]; return M[ok] != null ? { idx: M[ok], scale: scaleFor(ok) } : null; }
    if (key.startsWith("nzf_")) { const tk = "nz_" + key.slice(4); if (M[tk] != null) return { idx: M[tk], scale: NZ()[tk] || 2.2 }; }
    if (M[key] != null) return { idx: M[key], scale: scaleFor(key) };
    return null;
  }
  let img = null;
  function sheet() {
    if (img !== null) return img.complete && img.naturalWidth ? img : null;
    if (!url()) { img = false; return null; }
    img = new Image();
    const done = () => document.dispatchEvent(new CustomEvent("studio-objsheet"));
    img.onload = () => { if (img.decode) img.decode().then(done, done); else done(); };
    img.onerror = done; img.src = url();
    return null;
  }
  // draw packed object `idx` (south-facing) into ctx at (dx,dy,w,h); false if not ready
  function blitIdx(ctx, idx, dx, dy, w, h) {
    const im = sheet(); if (!im) return false;
    const cell = CELL(), cols = COLS(), frame = idx * 8;   // dir 0 = south
    ctx.drawImage(im, (frame % cols) * cell, Math.floor(frame / cols) * cell, cell, cell, dx, dy, w, h);
    return true;
  }
  return { objForKey, blitIdx, sheet, onReady: cb => document.addEventListener("studio-objsheet", cb) };
})();

// ---------------- Monsters ----------------
(function () {
  if (typeof MONSTERS === "undefined") return;
  const D8 = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"];
  const WESTISH = new Set([5, 6, 7]);   // north-west, west, south-west — billboard mirror
  // ---- biome variants ----------------------------------------------------
  // A monster spawns in one or more biomes; in the studio each (monster, biome)
  // pair is its own listing — "Adder (Desert)", "Adder (Swamp)", "Adder
  // (Wetlands)" — with its own page and id (base key + "$" + biome slug) so the
  // community can vote a different level / drop table per biome. They all remain
  // the single monster ("Adder") in the actual game. Art, base stats and the
  // sprite are shared across a monster's biome variants.
  const baseOf = key => String(key).split("$")[0];      // "adder$desert" → "adder"
  const biomeOf = key => { const i = String(key).indexOf("$"); return i < 0 ? null : String(key).slice(i + 1); };

  const isDir = key => { const d = MONSTERS[baseOf(key)]; return !!(d && d.dirSpr); };
  // layer keys for a monster in a given direction (single-sprite mobs reuse
  // their one sprite for every direction, mirrored on the west-facing side)
  function layerKeys(key, dirIndex) {
    key = baseOf(key);
    const def = MONSTERS[key]; if (!def) return [];
    if (def.dirSpr) { const base = key.replace(/(_v)?(_baby)?$/, ""); return ["mcd_" + base + "_" + D8[dirIndex || 0]]; }
    return Array.isArray(def.spr) ? def.spr.map(l => (Array.isArray(l) ? l[0] : l)) : [def.spr];
  }
  function draw(cv, e, di) {
    di = di || 0;
    const dir = isDir(e.key) ? di : 0;
    const flip = !isDir(e.key) && WESTISH.has(di);   // one sprite → mirror for west-facing dirs
    return SprRender.drawKeys(cv, layerKeys(e.key, dir), cv.width, flip);
  }

  // spawn biomes: invert BIOME_MOB_NAMES (biome code → mob names). No world layer
  // is loaded, so we map codes to their display labels directly.
  const BIOME_LABEL = { DEEP: "Deep Sea", WATER: "Sea", REEF: "Coral Reef", SAND: "Beach", GRASS: "Plains", FOREST: "Forest", SWAMP: "Swamp", DESERT: "Desert", ROCK: "Mountains", SNOW: "Snowy Peaks", TUNDRA: "Taiga", FARM: "Farmland", BADLANDS: "Badlands", JUNGLE: "Jungle", MEADOW: "Meadow", SAVANNA: "Savanna", ROCKY: "Rockyland", LABYRINTH: "Labyrinth", VOLCANO: "Volcano", WILD: "Wilderness", TAIGA: "Taiga", OASIS: "Oasis", RUINSB: "Ruins", SALT: "Salt Flats", WETLAND: "Wetlands", CANYON: "Canyon", STEPPE: "Steppe", REDDESERT: "Red Desert", MUSHROOM: "Giant Mushroom Forest", BONE: "Bone Fields", DREAM: "Dream Forest", ASH: "Ashen Forest", MOOR: "Heather Moor", GLACIER: "Glacier", BAMBOO: "Bamboo Grove", CHERRY: "Blossom Grove", CRYSTAL: "Crystal Fields" };
  const slugify = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  // Resolve every name that appears in BIOME_MOB_NAMES to a real MONSTERS key.
  // BIOME_MOB_NAMES mixes display names ("Gelatinous cube sr.") and raw keys
  // ("pukeko"), and a display name doesn't always slugify to its key — so we
  // index MONSTERS by both its key and its slugified display name, and resolve
  // through that. This is what makes sure a biome is retrieved for every monster.
  const nameToKey = {};
  for (const k of Object.keys(MONSTERS)) {
    nameToKey[k] = k;
    nameToKey[slugify(k)] = k;
    const nm = MONSTERS[k] && MONSTERS[k].name;
    if (nm) { const s = slugify(nm); if (!nameToKey[s]) nameToKey[s] = k; }
  }
  const resolveKey = disp => nameToKey[slugify(disp)] || null;

  // Husbandry livestock & tendable exotics don't ride BIOME_MOB_NAMES — their
  // habitats live in ANIMAL_BIOME (js/world/features.js, which the studio doesn't
  // load), keyed straight by monster key → biome codes. Mirrored here so alpaca,
  // camel, buffalo, goose, turkey, griffon, aurochs, wyrmling &c. get their biomes.
  const ANIMAL_BIOME = {
    chicken: ["GRASS", "FARM", "MEADOW"],
    cow: ["GRASS", "FARM", "MEADOW"],
    pig: ["GRASS", "FARM", "MEADOW", "FOREST"],
    rabbit: ["GRASS", "FARM", "MEADOW", "FOREST"],
    quail: ["GRASS", "FARM", "MEADOW", "STEPPE"],
    duck: ["GRASS", "FARM", "MEADOW", "WETLAND", "SWAMP"],
    goose: ["GRASS", "FARM", "MEADOW", "WETLAND", "TUNDRA"],
    turkey: ["GRASS", "FARM", "FOREST", "SAVANNA"],
    sheep: ["GRASS", "FARM", "MEADOW", "MOOR", "STEPPE"],
    goat: ["GRASS", "FARM", "MEADOW", "MOOR", "STEPPE", "ROCKY"],
    bee: ["MEADOW", "GRASS", "FOREST", "CHERRY", "JUNGLE"],
    camel: ["DESERT", "REDDESERT", "OASIS", "SALT", "CANYON", "BADLANDS"],
    buffalo: ["SAVANNA", "STEPPE", "GRASS", "WETLAND"],
    alpaca: ["STEPPE", "MOOR", "ROCKY", "TUNDRA", "TAIGA"],
    griffon: ["ROCK", "ROCKY", "VOLCANO", "CANYON"],
    aurochs: ["STEPPE", "SAVANNA", "TAIGA", "FOREST"],
    wyrmling: ["VOLCANO", "ASH", "BADLANDS", "CRYSTAL"],
  };

  // Studio-assigned habitats for creatures the game defines but never seeds in the
  // wild by biome (they're on NEITHER BIOME_MOB_NAMES nor ANIMAL_BIOME). These are
  // sensible-default biomes so every monster gets biome listings to vote on — they
  // are NOT mirrored from game code, so treat them as proposals, not ground truth.
  const STUDIO_EXTRA_BIOME = {
    beetle: ["FOREST", "JUNGLE", "GRASS", "MEADOW"],
    weasel: ["FOREST", "MEADOW", "GRASS", "TAIGA"],
    raccoon: ["FOREST", "GRASS", "MEADOW", "SWAMP"],
    bat: ["FOREST", "ROCK", "ROCKY", "RUINSB"],
    hornet: ["FOREST", "JUNGLE", "MEADOW", "GRASS"],
    earth_sprite: ["ROCK", "ROCKY", "CRYSTAL", "CANYON"],
    catfolk: ["SAVANNA", "JUNGLE", "DESERT", "STEPPE"],
    moauta: ["FOREST", "TAIGA", "MOOR", "MEADOW"],
    bear: ["FOREST", "TAIGA", "TUNDRA", "ROCKY"],
    orc: ["BADLANDS", "WILD", "STEPPE", "CANYON"],
    hobgoblin: ["BADLANDS", "WILD", "FOREST", "CANYON"],
    troll: ["ROCK", "ROCKY", "CANYON", "LABYRINTH"],
    cockatrice: ["SWAMP", "BADLANDS", "RUINSB", "WILD"],
    bugbear: ["FOREST", "WILD", "BADLANDS", "TAIGA"],
    green_knight: ["FOREST", "MEADOW", "GRASS", "DREAM"],
    pegasus: ["MEADOW", "CHERRY", "DREAM", "SNOW"],
    elder_treant: ["FOREST", "DREAM", "JUNGLE", "MUSHROOM"],
    dragon: ["FOREST", "JUNGLE", "SWAMP", "WILD"],
    green_dragon: ["FOREST", "JUNGLE", "SWAMP", "WILD"],
    blue_knight: ["SNOW", "GLACIER", "WATER", "TUNDRA"],
    earth_elemental: ["ROCK", "ROCKY", "CANYON", "CRYSTAL"],
    hippogryph: ["ROCK", "ROCKY", "STEPPE", "CANYON"],
    red_knight: ["VOLCANO", "REDDESERT", "ASH", "BADLANDS"],
    succubus: ["WILD", "ASH", "BONE", "RUINSB"],
    cherub: ["DREAM", "CRYSTAL", "MEADOW", "CHERRY"],
    chimera: ["BADLANDS", "VOLCANO", "CANYON", "WILD"],
    iron_golem: ["ROCK", "ROCKY", "RUINSB", "LABYRINTH"],
    blue_dragon: ["SNOW", "GLACIER", "WATER", "TUNDRA"],
    hydra: ["SWAMP", "WETLAND", "WATER", "REEF"],
    angel: ["DREAM", "CRYSTAL", "GLACIER", "CHERRY"],
    black_dragon: ["ASH", "BONE", "WILD", "VOLCANO"],
    godling: ["WILD", "DREAM", "CRYSTAL", "VOLCANO"],
  };

  const spawnIndex = {};   // monsterKey → Set(biome labels)
  const addBiome = (k, label) => { if (k && MONSTERS[k]) (spawnIndex[k] || (spawnIndex[k] = new Set())).add(label); };
  // the named monster and every raised variant — elite (_v), juvenile (_baby) and
  // the giant's baby (_v_baby) — share the parent's habitat, so spread each biome
  // across all of them (only ones that actually exist stick) — no variant left out.
  const addFamily = (base, label) => ["", "_v", "_baby", "_v_baby"].forEach(s => addBiome(base + s, label));
  if (typeof BIOME_MOB_NAMES !== "undefined") {
    for (const code of Object.keys(BIOME_MOB_NAMES)) {
      const label = BIOME_LABEL[code] || Roster.prettyName(code);
      for (const disp of BIOME_MOB_NAMES[code]) {
        const k = resolveKey(disp);
        if (k) addFamily(k.replace(/(_v)?(_baby)?$/, ""), label);
      }
    }
  }
  for (const base of Object.keys(ANIMAL_BIOME)) {
    for (const code of ANIMAL_BIOME[base]) addFamily(base, BIOME_LABEL[code] || Roster.prettyName(code));
  }
  for (const base of Object.keys(STUDIO_EXTRA_BIOME)) {
    for (const code of STUDIO_EXTRA_BIOME[base]) addFamily(base, BIOME_LABEL[code] || Roster.prettyName(code));
  }
  const biomesOf = baseKey => spawnIndex[baseKey] ? [...spawnIndex[baseKey]].sort() : [];

  // For a base key → its biomes; for a variant key ("x$slug") → just that biome.
  const spawnBiomes = key => {
    const base = baseOf(key), b = biomeOf(key);
    if (b == null) return biomesOf(base);
    const label = biomesOf(base).find(l => slugify(l) === b);
    return label ? [label] : [];
  };
  const variants = key => {
    const base = baseOf(key).replace(/(_v)?(_baby)?$/, "");
    return ["", "_v", "_baby", "_v_baby"].map(s => base + s).filter(k => k !== baseOf(key) && MONSTERS[k]);
  };
  const baseName = k => (MONSTERS[k] && MONSTERS[k].name) || Roster.prettyName(k);

  Providers.set("monster", {
    type: "monster", label: "Monster", plural: "Monsters", icon: "🐉",
    supportsGen: true, dirs: true,
    // one listing per (monster, biome); monsters on no biome table list once.
    list: () => {
      const out = [];
      for (const k of Object.keys(MONSTERS).sort()) {
        const bs = biomesOf(k);
        // only disambiguate the name with "(Biome)" when the monster has >1 biome
        if (bs.length) bs.forEach(label => out.push({ type: "monster", key: k + "$" + slugify(label), baseKey: k, biome: label, name: baseName(k) + (bs.length > 1 ? " (" + label + ")" : "") }));
        else out.push({ type: "monster", key: k, baseKey: k, biome: null, name: baseName(k) });
      }
      return out;
    },
    entry: key => {
      const base = baseOf(key);
      if (!MONSTERS[base]) return null;
      const b = biomeOf(key);
      if (b == null) return { type: "monster", key, baseKey: base, biome: null, name: baseName(base) };
      const all = biomesOf(base);
      const label = all.find(l => slugify(l) === b) || Roster.prettyName(b);
      return { type: "monster", key, baseKey: base, biome: label, name: baseName(base) + (all.length > 1 ? " (" + label + ")" : "") };
    },
    draw, isDir: e => isDir(e.key), layerKeys,
    maker: e => AssetOrigin.forSprKey(e ? (layerKeys(e.key, 0) || [])[0] : null),
    data: e => MONSTERS[baseOf(e.key)],
    spawnBiomes, variants, baseOf, biomeOf,
    votes: () => [
      { field: "temperament", label: "Temperament", choices: ["peaceful", "aggressive"] },
      { field: "flight", label: "Flight", choices: ["grounded", "flying"], current: "grounded" },   // no real per-monster flight data yet — default hint only
    ],
  });
})();

// Real biome names by id (copied from js/world/map.js — the world layer that
// owns them isn't loaded here).
const BIOME_NAMES = ["Deep Sea", "Sea", "Beach", "Plains", "Forest", "Swamp",
  "Desert", "Mountains", "Snowy Peaks", "Frozen Wastes", "Farmland", "Badlands",
  "Jungle", "Meadow", "Savanna", "Rockyland", "Labyrinth", "Volcano", "Wilderness",
  "Taiga", "Oasis", "Coral Reef", "Ruins", "Salt Flats", "Wetlands", "Canyon",
  "Steppe", "Red Desert", "Giant Mushroom Forest", "Bone Fields", "Dream Forest",
  "Ashen Forest", "Heather Moor", "Glacier", "Bamboo Grove", "Blossom Grove", "Crystal Fields"];

// ---------------- Tiles (biome ground) ----------------
(function () {
  if (typeof SPR === "undefined") return;
  const list = [];
  if (typeof BIOME_GROUND_VARIANTS !== "undefined") {
    const bslug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    for (const biome of Object.keys(BIOME_GROUND_VARIANTS)) {
      const label = BIOME_NAMES[Number(biome)] || Roster.prettyName(String(biome));
      // only the first 4 variants exist per biome in-game (atlasVariantAt() % 4);
      // variants 5-6 are redundant leftover art, so they're dropped everywhere.
      // snake = the biome NAME in snake_case (deep_sea, plains…) — the sprite id.
      const vars = (BIOME_GROUND_VARIANTS[biome] || []).slice(0, 4);
      vars.forEach((k, i) => list.push({ type: "tile", key: k, snake: bslug(label), name: label + (vars.length > 1 ? " · v" + (i + 1) : "") }));
    }
  }
  // classic named terrain + flat tiles that exist in SPR
  ["grass", "grass2", "water", "sand", "dirt", "stone", "gravel", "farm", "snow", "lily", "lily2", "lily3", "footprint_moa"]
    .forEach(k => { if (SPR[k]) list.push({ type: "tile", key: k, name: Roster.prettyName(k) }); });
  if (!list.length) return;
  const byKey = Object.fromEntries(list.map(t => [t.key, t]));
  Providers.set("tile", {
    type: "tile", label: "Biome", plural: "Biomes", icon: "🌿",
    supportsGen: false, dirs: false,
    list: () => list.slice(),
    entry: key => byKey[key] || null,
    draw: (cv, e) => SprRender.drawKeys(cv, [e.key], cv.width, false),
    // all biome tile art is credited to AI (overrides the per-sheet mapping)
    maker: () => AssetOrigin.AI,
    data: e => ({ key: e.key, spr: SPR[e.key], minimap: (typeof BG_MM !== "undefined" ? BG_MM[e.key] : undefined) }),
  });
})();

// ---------------- Icons (every in-game item icon) ----------------
(function () {
  if (typeof SPR === "undefined") return;
  const list = [];
  if (typeof ITEMS !== "undefined") {
    // one entry per item in the registry, drawn from its own icon key
    for (const id of Object.keys(ITEMS)) {
      const it = ITEMS[id]; const iconKey = it && it.icon;
      if (!iconKey || !SPR[iconKey]) continue;
      list.push({ type: "ui", key: "item:" + id, itemId: id, iconKey, name: it.name || Roster.prettyName(id) });
    }
  }
  // plus any genuinely-orphan gear-atlas icons (art with no backing item). Shown
  // WITHOUT the legacy "ga_" key prefix (draw still uses the real iconKey). Skip
  // any whose de-prefixed id is already a real item (or its rename alias) — those
  // are just alternate icons and would double-list — and skip stale
  // generic-numbered atlas cells (ga_bar_16 → "bar_16"/"Bar 16"), which are
  // leftover duplicates of the real, now name-based, items.
  const seen = new Set(list.map(e => e.iconKey));
  const genericId = id => /_(?:m|f)?\d+$/.test(id) || /^[a-z]+\d+$/.test(id);
  Object.keys(SPR)
    .filter(k => k.indexOf("ga_") === 0 && !seen.has(k))
    .filter(k => { const id = k.slice(3); return !(typeof ITEMS !== "undefined" && ITEMS[id]) && !genericId(id); })
    .sort()
    .forEach(k => list.push({ type: "ui", key: k.slice(3), itemId: k.slice(3), iconKey: k, name: Roster.prettyName(k.slice(3)) }));
  if (!list.length) return;
  list.sort((a, b) => a.name.localeCompare(b.name));
  const byKey = Object.fromEntries(list.map(t => [t.key, t]));
  Providers.set("ui", {
    type: "ui", label: "Item", plural: "Items", icon: "🖱️",
    supportsGen: false, dirs: false,
    list: () => list.slice(),
    entry: key => byKey[key] || null,
    draw: (cv, e) => SprRender.drawKeys(cv, [e.iconKey], cv.width, false),
    maker: e => AssetOrigin.forSprKey(e && e.iconKey),
    data: e => ({ id: e.itemId, icon: e.iconKey, item: (typeof ITEMS !== "undefined" ? ITEMS[e.itemId] : undefined), spr: SPR[e.iconKey] }),
  });
})();

// ---------------- Map (map/POI icons) ----------------
(function () {
  if (typeof SPR === "undefined" || typeof MAP_ICON_TYPES === "undefined") return;
  const names = Array.isArray(MAP_ICON_TYPES) ? MAP_ICON_TYPES : Object.keys(MAP_ICON_TYPES);
  const list = names.map(n => ({ type: "map", key: "i_mapicon_" + n, name: Roster.prettyName(n), poi: n })).filter(e => SPR[e.key]);
  if (!list.length) return;
  const byKey = Object.fromEntries(list.map(t => [t.key, t]));
  Providers.set("map", {
    type: "map", label: "Map icon", plural: "Map", icon: "🗺️",
    supportsGen: false, dirs: false,
    list: () => list.slice(),
    entry: key => byKey[key] || null,
    draw: (cv, e) => SprRender.drawKeys(cv, [e.key], cv.width, false),
    maker: e => AssetOrigin.forSprKey(e && e.key),
    data: e => ({ key: e.key, poi: e.poi, spr: SPR[e.key] }),
  });
})();

// Which map icon a world object / shop / skill "represents" — mirrored from
// STATION_ICON + SHOP_ICON in js/gameplay/world.js (not loaded here). Used as the
// default for the votable "Map icon" field on the World Object / Skill / Quests
// pages (the community votes to change it). MAP_ICON_TYPES (the full choice list)
// is loaded from js/sprites/map-icon-atlas*-data.js.
const MAP_ICON_FOR_OBJECT = {
  furnace: "furnace", anvil: "anvil", campfire: "range", bank: "bank",
  workbench: "workbench", loom: "loom", tanrack: "tanning", mill: "windmill",
  cauldron: "cauldron", alchtable: "alchemy", altar: "altar",
  fletchers_bench: "fletchers_bench", sawmill: "sawmill", cooperage: "cooperage", bakehouse: "range",
  malthouse: "malthouse", brewery: "brewery", spinning_wheel: "spinning_wheel", dyeworks: "dyeworks",
  fulling_mill: "fulling_mill", tailors_bench: "tailors_bench", barn: "barn", creamery: "creamery",
  ropewalk: "ropewalk", sail_loft: "sail_loft", shipyard: "shipyard", charcoal_clamp: "charcoal_clamp",
  lime_kiln: "lime_kiln", masons_yard: "masons_yard", pottery_kiln: "pottery_kiln", glass_furnace: "glass_furnace",
  assay_furnace: "assay_furnace", drawbench: "drawbench", jewelers_bench: "jewelers_bench",
  leather_bench: "leather_bench", cobblers_bench: "cobblers_bench", saddlers_bench: "saddlers_bench",
  toolsmith: "toolsmith", locksmith_bench: "locksmith_bench", paper_mill: "paper_mill", bindery: "workbench",
  chandlery: "chandlery", soap_works: "soap_works", seasoning_yard: "seasoning_yard", curing_shed: "tanning",
};
const MAP_ICON_FOR_SHOP = {
  woodcutter: "woodcutter", mining: "mining", fishmonger: "fishmonger", armoury: "armoury",
  seedsman: "seedsman", timberwright: "timberwright", weaponsmith: "swordshop", herbalist: "herbshop",
  jeweller: "gemshop", clothier: "clothesshop", provisioner: "foodshop",
};
// sensible defaults for the skills whose activity has a natural POI marker
const MAP_ICON_FOR_SKILL = {
  Mining: "mining", Woodcutting: "woodcutter", Fishing: "fishmonger", Alchemy: "alchemy",
  Farming: "garden", Cooking: "range", Smithing: "anvil", Smelting: "furnace", Runecrafting: "altar",
};
function defaultMapIcon(kind, key) {
  if (kind === "object") return MAP_ICON_FOR_OBJECT[key] || MAP_ICON_FOR_SHOP[key] || "";
  if (kind === "skill") return MAP_ICON_FOR_SKILL[key] || "";
  if (kind === "quest") return "quest";
  return "";
}
function mapIconChoices() { return (typeof MAP_ICON_TYPES !== "undefined") ? (Array.isArray(MAP_ICON_TYPES) ? MAP_ICON_TYPES.slice() : Object.keys(MAP_ICON_TYPES)).slice().sort() : []; }

// ---------------- Sounds ----------------
// The trigger is the sound's real in-game EVENT ID — the exact key the game
// passes to sfx()/SFX.play() (the SOUNDS table in js/audio.js). A file's trigger
// id is its base name with the variant number stripped: "step_grass3.ogg" →
// step_grass, "swing0.ogg" → swing. SFX_EVENT_IDS is kept in sync with audio.js so
// only genuine event ids are shown; anything else (or a stray file) reads "—".
const SFX_EVENT_IDS = new Set(["step_grass", "step_stone", "step_snow", "step_sand", "step_wood",
  "wade", "splash_big", "swing", "hit", "hurt", "kill", "bow", "arrowhit", "arrowmiss",
  "spellword", "spellcast", "die", "chop", "mine", "fish", "forage", "coins", "pickup", "equip",
  "eat", "drink", "dooropen", "doorclose", "gate", "latch", "climb", "book", "click", "error",
  "craft", "anvil", "levelup", "quest", "portal", "attune"]);
function soundTrigger(e) {
  if (!e) return "—";
  const base = String(e.name || "").replace(/\d+$/, "");
  if (e.cat === "sfx") return SFX_EVENT_IDS.has(base) ? base : "—";
  return base;   // ambience/birdsong/music loops are keyed by their own id (rain, tui, …)
}
(function () {
  if (typeof SOUND_MANIFEST === "undefined") return;
  const list = [];
  for (const cat of Object.keys(SOUND_MANIFEST))
    for (const file of SOUND_MANIFEST[cat])
      list.push({ type: "sound", key: cat + "/" + file, name: file.replace(/\.[^.]+$/, ""), cat, file: "assets/" + cat + "/" + file });
  if (!list.length) return;
  const byKey = Object.fromEntries(list.map(t => [t.key, t]));
  Providers.set("sound", {
    type: "sound", label: "Sound", plural: "Sounds", icon: "🔊",
    supportsGen: false, dirs: false, isAudio: true,
    list: () => list.slice(),
    entry: key => byKey[key] || null,
    draw: () => {},
    audioSrc: e => ASSET_BASE + e.file,
    trigger: soundTrigger,
    data: e => ({ key: e.name, category: e.cat, trigger: soundTrigger(e), file: e.file }),
  });
})();

// ---------------- augment Objects with gatherable nodes (trees, rocks…) ----
// NODE_TYPES (trees/rocks/bushes) are interactive world objects too, so they
// appear in the Objects catalog and pick up their real Action-menu verbs
// (Chop/Mine/Forage) gated on the right tool. Rendered from their SPR key.
(function () {
  if (typeof NODE_TYPES === "undefined" || typeof SPR === "undefined") return;
  const obj = Providers.get("object");
  if (!obj) return;
  const seen = new Set(), nodes = [];
  for (const k in NODE_TYPES) {
    const nt = NODE_TYPES[k];
    if (!nt || !nt.spr || seen.has(nt.spr) || !SPR[nt.spr]) continue;
    seen.add(nt.spr);
    nodes.push({ type: "object", key: nt.spr, name: nt.name, node: true, nodeKey: k });
  }
  if (!nodes.length) return;
  const byKey = Object.fromEntries(nodes.map(e => [e.key, e]));
  const baseList = obj.list, baseEntry = obj.entry, baseDraw = obj.draw, baseData = obj.data;
  obj.list = () => baseList().concat(nodes);
  obj.entry = key => baseEntry(key) || byKey[key] || null;
  obj.draw = (cv, e, di) => (e && e.node) ? SprRender.drawKeys(cv, [e.key], cv.width || 64, false) : baseDraw(cv, e, di);
  obj.data = e => (e && e.node) ? { key: e.key, name: e.name, node: NODE_TYPES[e.nodeKey] } : baseData(e);
})();
