// ===== Our RPG Workshop — in-browser zone bake worker =====
// The browser twin of studio/tools/zone-npcs.mjs's vm sandbox: boots the
// game's REAL world engine (data + content + terrain + erosion + features +
// chunks + the NPC roster) off the main thread and runs the shared bake
// algorithms (studio/js/zone-bake-core.js — the ONE implementation this file
// and the node CLI both use) for the Zones tab's "Generate zone" button.
//
// studio/js/zone-bake.js orchestrates a pool of these: one boots per worker
// (heavy — the whole world engine), then jobs stream in: enumerate → npcs
// (per-settlement results, so the page can checkpoint to the server) →
// nameAll → cities → monsters (per-chunk-batch results) → merge → biomes.
"use strict";

let booted = false;

// ---- globals the game files read, that live in files we do NOT import ----
// (identical to the zone-npcs.mjs vm context: js/world.js wires the live game
//  and js/main/state.js the live canvas — neither is worker-safe.)
self.PX = t => t * 48;
self.TILE = 1;
self.SCALE = 48;
self.liftAt = () => 0;
self.groundY = () => 0;
self.DIR8 = ["south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"];
// mulberry32 — deterministic PRNG (verbatim from js/world.js)
self.mulberry32 = function (seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// SHOP_TYPES is a self-contained literal in js/skills/market.js (its
// sells/buys are lazy and never called by deriveNpcs); slice it out so we
// don't drag in the whole skills graph — same slice zone-npcs.mjs makes.
// Loaded as a Blob importScripts so its top-level const lands in the global
// lexical scope exactly like a real script (eval would keep it private).
async function shopTypesUrl() {
  const res = await fetch("../../js/skills/market.js");
  if (!res.ok) throw new Error("couldn't fetch skills/market.js (" + res.status + ")");
  const s = await res.text();
  const a = s.indexOf("const SHOP_TYPES = {");
  const e = s.indexOf("\n", s.indexOf(";", s.indexOf("const SHOP_TYPE_KEYS =")));
  if (a < 0 || e < 0) throw new Error("SHOP_TYPES slice not found in market.js");
  return URL.createObjectURL(new Blob([s.slice(a, e + 1)], { type: "text/javascript" }));
}

async function boot(d) {
  self.window = self;   // mix-npc-data.js exports via window.* (the vm sets ctx.window = ctx)
  self.WORLD_SEED = d.seed; self.LAND_E = d.landE; self.ROCK_E = d.rockE;
  self.CHUNK = d.chunk; self.VCELL = d.vcell; self.PCELL = d.pcell;
  self.ICELL = d.icell; self.WORLDGEN_SIG = d.gensig;
  const shopUrl = await shopTypesUrl();
  // same file list, same order, as zone-npcs.mjs boot() (paths are relative to
  // THIS worker at /studio/js/ → the game lives at /js/; the site build mirrors
  // that layout — workshop/js/ → site-root js/)
  importScripts(
    "../../js/sprites/mix-npc-data.js",
    "../../js/data.js",
    "../../js/biome-tiles.js",
    "../../js/content.js",
    "../../js/sprites/objects-data.js",
    shopUrl,
    "../../js/world/quest-anchors.js",
    "../../js/world/terrain.js",
    "../../js/world/erosion.js",
    "../../js/world/citygrow.js",
    "../../js/world/labgen.js",
    "../../js/world/features.js",
    "../../js/world/chunks.js",
    "zone-bake-core.js"
  );
  URL.revokeObjectURL(shopUrl);
  // the same world facade zone-npcs.mjs builds in its vm — just enough of
  // js/world.js for deriveNpcs + the ported placers
  const __t = createWorldTerrain();
  const __f = createWorldFeatures(__t);
  const __c = createWorldChunks(Object.assign({}, __t, __f));
  const CH = self.CHUNK;
  const chunkAt = (x, y) => __c.getChunk(Math.floor(x / CH), Math.floor(y / CH));
  const lidx = (ch, x, y) => (y - ch.cy * CH) * CH + (x - ch.cx * CH);
  self.world = {
    zoneOf: __f.zoneOf, getChunk: __c.getChunk, npcs: __c.npcs, CHUNK: CH,
    isBlocked: (x, y) => { const ch = chunkAt(x, y); return ch.blocked[lidx(ch, x, y)] === 1; },
    isWater: (x, y) => { const ch = chunkAt(x, y); return isWaterKey(ch.ground[lidx(ch, x, y)]); },
    npcAt: (x, y, level) => __c.npcs.find(n => n.x === x && n.y === y && (level == null || (n.level | 0) === (level | 0))),
    villagesNearPt: (x, y, pad) => __f.villagesNear(x / 2, y / 2, x / 2, y / 2, pad == null ? 40 : pad),
    villagesNearForMap: __f.villagesNearForMap, iconsNearForMap: __f.iconsNearForMap,
    buildingMeta: () => ({ storeys: 1 }),
  };
  self.__t = __t; self.__f = __f; self.__c = __c;
  // re-export script-lexical game consts as worker globals so the core's
  // G.<name> property reads find them (mirrors the vm globalThis re-exports;
  // resolveBiomeMobs(B) has already run inside createWorldChunks)
  self.VILLAGER_NAMES = (typeof VILLAGER_NAMES !== "undefined") ? VILLAGER_NAMES : [];
  self.STATIONS = (typeof STATIONS !== "undefined") ? STATIONS : {};
  self.BIOME_MOBS = (typeof BIOME_MOBS !== "undefined") ? BIOME_MOBS : {};
  self.MONSTERS = (typeof MONSTERS !== "undefined") ? MONSTERS : {};
  self.B = (typeof B !== "undefined") ? B : {};
  if (typeof MIX_NPCS !== "undefined" && !self.MIX_NPCS) self.MIX_NPCS = MIX_NPCS;
  booted = true;
}

// per-worker placer state for the npcs job (world.npcs accumulates across the
// settlements THIS worker generates, matching the node worker-band behaviour)
let placers = null, placersAllKey = null;

onmessage = async e => {
  const d = e.data, C = self.ZoneBakeCore;
  try {
    if (d.type === "init") { await boot(d); postMessage({ ready: true }); return; }
    if (!booted) { postMessage({ error: "worker not booted", token: d.token }); return; }

    if (d.type === "enumerate") {
      const r = C.enumerateZone(self, d.zx, d.zy);
      postMessage({ token: d.token, enumerated: r });
      return;
    }

    // group: [{index, settlement}] — one settlementDone per entry so the page
    // can checkpoint completed settlements to the server as it goes.
    if (d.type === "npcs") {
      const allKey = d.zx + "," + d.zy;
      if (!placers || placersAllKey !== allKey) { placers = C.makePlacers(self, d.all); placersAllKey = allKey; }
      const questMap = new Map();
      for (const g of d.group) if (g.settlement.quest) questMap.set(g.settlement.x + "," + g.settlement.y, g.settlement.quest);
      for (const g of d.group) {
        const v = g.settlement;
        let records = [];
        try { records = C.settlementNpcs(self, placers, v, questMap).map(r => Object.assign({}, r, { settlement: v.name })); }
        catch (err2) { postMessage({ token: d.token, log: "settlement " + v.name + " @ " + v.x + "," + v.y + " FAILED: " + (err2 && err2.message) }); }
        postMessage({ token: d.token, settlementDone: { index: g.index, records } });
      }
      postMessage({ token: d.token, npcsDone: true });
      return;
    }

    if (d.type === "nameAll") {
      const named = C.nameAll(self, d.records, d.zx, d.zy, d.cities);
      postMessage({ token: d.token, npcs: C.toZoneLocalNpcs(named, d.zx, d.zy) });
      return;
    }

    if (d.type === "cities") {
      const r = C.citiesPass(self, d.zx, d.zy, { pois: d.pois !== false, log: s => postMessage({ token: d.token, log: s }) });
      postMessage({ token: d.token, cities: r.cities });
      return;
    }

    // (No monster-spawn job: the zone pages never render spawn data, so bakes
    // stopped producing it 2026-09-30. ZoneBakeCore keeps the harvest fns for
    // the node CLI's opt-in --monstersonly.)

    if (d.type === "merge") {
      const man = C.mergeShires(self, d.man, { minTiles: d.minTiles, log: s => postMessage({ token: d.token, log: s }) });
      postMessage({ token: d.token, merged: man });
      return;
    }

    if (d.type === "biomes") {
      const man = C.augmentShireBiomes(self, d.man, d.zx, d.zy, { step: d.step, log: s => postMessage({ token: d.token, log: s }) });
      postMessage({ token: d.token, biomed: man });
      return;
    }
  } catch (err) {
    postMessage({ token: d && d.token, error: String(err && err.stack || err) });
  }
};
