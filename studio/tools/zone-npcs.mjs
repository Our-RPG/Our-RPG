// ===== Taiao Workshop — zone NPC extraction =====
// Runs the game's REAL NPC generation headlessly (js/world/chunks.js deriveNpcs +
// the render3d.js resident/quest-giver placement, ported verbatim below) over
// every settlement in a zone, and returns the actual NPCs the game would spawn
// there — with their EXACT spawn tiles (collision-resolved), zone-local
// coordinates, and zone-unique names (duplicate names swapped for a
// culturally-similar unused one via js/world/npc-names.js, exactly as at play).
//
// The heavy chunk pipeline (terrain → erosion → settlement stamping) is minutes
// per zone, so work is fanned out across CPU cores: each worker generates a slice
// of the zone's settlements and returns STRUCTURAL npc records (no naming); the
// main thread then runs ONE deterministic, zone-global naming pass so dedup is
// stable regardless of worker scheduling.
//
//   node studio/tools/zone-npcs.mjs [--zx 0] [--zy 0] [--limit N] [--out file]
//
// Exports { extractZoneNpcs } for reuse by prerender-zone.mjs.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, "../../js");
const ZONE_T = 15000, ZONE_M = ZONE_T / 2;
const DIR8 = ["south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"];

// Worker cap: os.cpus() can report the HOST core count (e.g. 128) even inside a
// container limited to far fewer, so cap hard to avoid oversubscription/OOM.
// Override with STUDIO_WORKERS.
function workerCap(n) {
  const env = Number(process.env.STUDIO_WORKERS);
  const cap = env > 0 ? env : Math.min(Math.max(1, os.cpus().length - 1), 12);
  return Math.max(1, Math.min(n, cap));
}

// ---------- shared sandbox boot ----------
const readGame = f => fs.readFileSync(path.join(GAME, f), "utf8");
// SHOP_TYPES is a self-contained literal (its sells/buys are lazy and never
// called by deriveNpcs); slice it out so we don't drag in the whole skills graph.
function shopTypesSlice() {
  const s = readGame("skills/market.js");
  const a = s.indexOf("const SHOP_TYPES = {");
  const e = s.indexOf("\n", s.indexOf(";", s.indexOf("const SHOP_TYPE_KEYS =")));
  return s.slice(a, e + 1);
}

// Build a vm context holding the real world engine. `withNpcNames:false` leaves
// NpcNames undefined so deriveNpcs/placeMixNpc emit RAW base names (workers);
// the main thread re-derives the final zone-unique names centrally.
function boot({ withNpcNames }) {
  const files = [
    "sprites/mix-npc-data.js", "data.js", "biome-tiles.js", "content.js",
    "sprites/objects-data.js", "__SHOP__", "world/quest-anchors.js",
    ...(withNpcNames ? ["world/npc-names.js"] : []),
    "world/terrain.js", "world/erosion.js", "world/features.js", "world/chunks.js",
  ];
  const src = files.map(f => f === "__SHOP__" ? shopTypesSlice() : readGame(f)).join("\n;\n");
  const ctx = {
    WORLD_SEED: 1337, LAND_E: 0.483, ROCK_E: 0.655,
    CHUNK: 32, VCELL: 144, PCELL: 30, ICELL: 44, WORLDGEN_SIG: "studio",
    PX: t => t * 48, TILE: 1, SCALE: 48,
    performance: { now: () => Date.now() }, indexedDB: undefined,
    mulberry32(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; },
    liftAt: () => 0, groundY: () => 0, DIR8,
    console, Math, JSON, Map, Set, WeakMap, Array, Object, String, Number, Boolean,
    Float32Array, Float64Array, Uint8Array, Uint8ClampedArray, Int32Array, Uint32Array, Int8Array, Int16Array, Uint16Array,
    isNaN, parseInt, parseFloat, Date,
  };
  ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { timeout: 180000 });
  vm.runInContext(`
    var __t = createWorldTerrain();
    var __f = createWorldFeatures(__t);
    var __c = createWorldChunks(Object.assign({}, __t, __f));
    var __CH = CHUNK, __cdiv = function (v) { return Math.floor(v / __CH); };
    var __chunkAt = function (x, y) { return __c.getChunk(__cdiv(x), __cdiv(y)); };
    var __lidx = function (ch, x, y) { return (y - ch.cy * __CH) * __CH + (x - ch.cx * __CH); };
    globalThis.world = {
      zoneOf: __f.zoneOf, getChunk: __c.getChunk, npcs: __c.npcs, CHUNK: __CH,
      isBlocked: function (x, y) { var ch = __chunkAt(x, y); return ch.blocked[__lidx(ch, x, y)] === 1; },
      isWater: function (x, y) { var ch = __chunkAt(x, y); return isWaterKey(ch.ground[__lidx(ch, x, y)]); },
      npcAt: function (x, y, level) { return __c.npcs.find(function (n) { return n.x === x && n.y === y && (level == null || (n.level | 0) === (level | 0)); }); },
      villagesNearPt: function (x, y, pad) { return __f.villagesNear(x / 2, y / 2, x / 2, y / 2, pad == null ? 40 : pad); },
      villagesNearForMap: __f.villagesNearForMap, iconsNearForMap: __f.iconsNearForMap,
      buildingMeta: function () { return { storeys: 1 }; },
    };
    globalThis.__c = __c; globalThis.__f = __f; globalThis.__t = __t;
    // Re-export plain-const game globals so the host can read them (top-level
    // const in a vm is NOT a sandbox property; only var/globalThis/window are).
    // resolveBiomeMobs(B) has already run inside createWorldChunks, so BIOME_MOBS
    // is populated here.
    globalThis.VILLAGER_NAMES = (typeof VILLAGER_NAMES !== 'undefined') ? VILLAGER_NAMES : [];
    globalThis.STATIONS = (typeof STATIONS !== 'undefined') ? STATIONS : {};
    globalThis.BIOME_MOBS = (typeof BIOME_MOBS !== 'undefined') ? BIOME_MOBS : {};
    globalThis.MONSTERS = (typeof MONSTERS !== 'undefined') ? MONSTERS : {};
    globalThis.B = (typeof B !== 'undefined') ? B : {};
  `, ctx, { timeout: 180000 });
  return ctx;
}

// ---------- ported deterministic NPC selection (render3d.js, verbatim) ----------
function makePlacers(ctx, allSettlements) {
  const MIX = ctx.MIX_NPCS.list, N = MIX.length, world = ctx.world;
  const mulberry32 = ctx.mulberry32;
  const keyIndex = new Map(); MIX.forEach((d, i) => keyIndex.set(d.key, i));
  function mixHash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const MIX_UNIQUE_R2 = 1000 * 1000, _stlBase = new Map();
  function settlementBlockBase(v) {
    const key = v.x + "," + v.y; if (_stlBase.has(key)) return _stlBase.get(key);
    let base = mixHash("stl:" + key) % N;
    const myN = Math.min(N, (v.buildings ? v.buildings.length : 12) + 1);
    const earlier = [];
    for (const u of allSettlements) {
      if (u.x === v.x && u.y === v.y) continue;
      const dx = u.x - v.x, dy = u.y - v.y; if (dx * dx + dy * dy > MIX_UNIQUE_R2) continue;
      if (u.y < v.y || (u.y === v.y && u.x < v.x)) earlier.push([mixHash("stl:" + u.x + "," + u.y) % N, Math.min(N, (u.nb || 12) + 1)]);
    }
    if (earlier.length) {
      const clash = start => earlier.some(([ub, un]) => { for (let a = 0; a < myN; a++) { const d = (((start + a) - ub) % N + N) % N; if (d < un) return true; } return false; });
      for (let sh = 0; sh < N; sh++) { const s = (base + sh) % N; if (!clash(s)) { base = s; break; } }
    }
    _stlBase.set(key, base); return base;
  }
  const mixDefForBuilding = (v, i) => MIX[(((settlementBlockBase(v) + i) % N) + N) % N];
  // like render3d.js placeMixNpc but records baseName/culture instead of naming;
  // returns the raw record (already pushed to world.npcs to block its tile).
  function placeMixNpc(def, gx, gy, rng, maxR, radius, quest) {
    for (let a = 0; a < 40; a++) {
      const ang = rng() * Math.PI * 2, rad = 1 + rng() * maxR;
      const tx = Math.round(gx + Math.cos(ang) * rad), ty = Math.round(gy + Math.sin(ang) * rad);
      if (world.isBlocked(tx, ty) || world.isWater(tx, ty)) continue;
      if (world.npcAt(tx, ty, 0)) continue;
      const npc = { x: tx, y: ty, level: 0, mix: def.key, _rawMix: def.key, _questGiver: !!quest,
        _baseName: def.name, _culture: (def.key || "").split("__")[0], _mixTitle: def.title };
      world.npcs.push(npc); return npc;
    }
    return null;
  }
  return { MIX, N, world, mulberry32, keyIndex, mixHash, mixDefForBuilding, placeMixNpc };
}

// classify a raw deriveNpcs npc into a structural record for central naming
function classifyDerived(npc, P) {
  // curated singletons keep their curated names (never deduped)
  const curated = !!(npc._script || npc.charselect || npc.wizard || npc.tutor || npc.name === "Sten");
  const rec = {
    x: npc.x, y: npc.y,
    role: npc.banker ? "banker" : npc.trader ? "shopkeeper" : npc.charselect ? "registrar"
        : npc.wizard ? "weaver" : npc._script ? "quest-anchor" : npc.tutor ? "tutor" : "other",
    curatedName: curated ? npc.name : null,
    baseName: npc.name,          // raw villager name (NpcNames disabled) for pooled keepers
    culture: "villager",
    mixKey: npc.mix || null, mixIndex: npc.mix != null ? (P.keyIndex.get(npc.mix) ?? -1) : -1,
    mixTitle: npc.mixTitle || null, line: npc.line || null, script: npc._script || null,
  };
  return rec;
}

// Generate every NPC for ONE settlement: real chunk gen (shopkeepers/bankers/
// named singletons via deriveNpcs) + ported residents + quest-givers. Returns
// structural records (no final naming). `v` is a villageInfo (game-tile coords).
function settlementNpcs(ctx, P, v, questIconMap) {
  const world = ctx.world, run = ctx.__c;
  const before = world.npcs.length;
  // 1) generate the chunks covering the settlement footprint (+margin for the
  //    resident collision search). deriveNpcs runs inside getChunk.
  const R = (v.R || (v.kind === "city" ? 68 : 34)) + 8;
  const c0x = Math.floor((v.x - R) / 32), c1x = Math.floor((v.x + R) / 32);
  const c0y = Math.floor((v.y - R) / 32), c1y = Math.floor((v.y + R) / 32);
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) run.getChunk(cx, cy);
  const out = [];
  // 2) reskin the shopkeepers/bankers this settlement just spawned (assign the
  //    mix appearance the game gives them) + classify them.
  for (let i = before; i < world.npcs.length; i++) {
    const npc = world.npcs[i];
    const curated = !!(npc._script || npc.charselect || npc.wizard || npc.tutor || npc.name === "Sten");
    if (npc.trader || npc.banker) {
      // a border chunk can be generated by two settlements' workers — report a
      // keeper ONLY from the settlement whose building actually holds it, so it's
      // counted once and gets the correct per-building mix appearance.
      const slot = slotFor(v, npc.x, npc.y);
      if (slot == null) continue;
      const def = !npc.banker ? P.mixDefForBuilding(v, slot) : P.MIX[P.mixHash("shop:" + npc.x + "," + npc.y) % P.N];
      npc.mix = def.key; npc.mixTitle = npc.banker ? "banker" : def.title;
    } else if (!curated) {
      // some other derived NPC not tied to this settlement's buildings — skip
      // (dedup across workers is by tile anyway; keepers/curated are handled)
      continue;
    }
    out.push(classifyDerived(npc, P));
  }
  // 3) residents — one per non-trader/bank building (render3d.js syncMixNpcs)
  const h = P.mixHash("v:" + v.x + "," + v.y), rng = P.mulberry32(h);
  const blds = v.buildings || [];
  for (let bIdx = 0; bIdx < blds.length; bIdx++) {
    const b = blds[bIdx];
    if (b.job === "trader" || b.job === "bank") continue;
    if (world.npcs.some(n => n.x >= b.x0 && n.x < b.x0 + b.w && n.y >= b.y0 && n.y < b.y0 + b.h)) continue;
    const cx = b.x0 + (b.w >> 1), cy = b.y0 + b.h - 2;
    const def = P.mixDefForBuilding(v, bIdx);
    const npc = P.placeMixNpc(def, cx, cy, rng, 2, Math.max(3, Math.max(b.w, b.h)), false);
    if (npc) out.push({ x: npc.x, y: npc.y, role: "resident", curatedName: null,
      baseName: npc._baseName, culture: npc._culture, mixKey: npc._rawMix,
      mixIndex: P.keyIndex.get(npc._rawMix) ?? -1, mixTitle: npc._mixTitle, job: b.job || null });
  }
  // 4) quest-givers — one per quest icon on this settlement
  const q = questIconMap.get(v.x + "," + v.y);
  if (q) {
    const rngq = P.mulberry32(P.mixHash("q:" + q.mx + "," + q.my));
    const def = P.MIX[P.mixHash("q:" + q.mx + "," + q.my) % P.N];
    const npc = P.placeMixNpc(def, q.gx, q.gy, rngq, 3, 3, true);
    if (npc) out.push({ x: npc.x, y: npc.y, role: "quest-giver", curatedName: null,
      baseName: npc._baseName, culture: npc._culture, mixKey: npc._rawMix,
      mixIndex: P.keyIndex.get(npc._rawMix) ?? -1, mixTitle: npc._mixTitle });
  }
  return out;
}
// which building index of v contains (x,y)
function slotFor(v, x, y) {
  const blds = v.buildings || [];
  for (let i = 0; i < blds.length; i++) { const b = blds[i]; if (x >= b.x0 && x < b.x0 + b.w && y >= b.y0 && y < b.y0 + b.h) return i; }
  return null;
}

// ---------- settlement enumeration (main thread) ----------
// Returns { settlements:[{x,y,kind,name,R,nb,buildings,quest}], all:[{x,y,nb}] }
function enumerateZone(ctx, zx, zy) {
  const F = ctx.__f, S = ctx.__t.S, rand2 = ctx.__t.rand2;
  const cx = zx * ZONE_T, cy = zy * ZONE_T, half = ZONE_T / 2;
  // cell range covering the zone (VCELL is in MAP units; game = 2*map). Add a
  // margin of ~5 cells so `all` also holds settlements just OUTSIDE the zone —
  // settlementBlockBase declusters against neighbours up to 1000 tiles away, so
  // edge settlements pick the same characters the running game would.
  const MARG = 5;
  const c0 = Math.floor((cx - half) / 2 / ctx.VCELL) - MARG, c1 = Math.floor((cx + half) / 2 / ctx.VCELL) + MARG;
  const r0 = Math.floor((cy - half) / 2 / ctx.VCELL) - MARG, r1 = Math.floor((cy + half) / 2 / ctx.VCELL) + MARG;
  const settlements = [], all = [], cities = [];
  for (let vcy = r0; vcy <= r1; vcy++) for (let vcx = c0; vcx <= c1; vcx++) {
    const info = F.villageInfo(vcx, vcy);
    if (!info) continue;
    all.push({ x: info.x, y: info.y, nb: (info.buildings || []).length });
    const inZone = !(info.x < cx - half || info.x >= cx + half || info.y < cy - half || info.y >= cy + half);
    // Shire fountains are IN-ZONE cities only, so every shire listed under a zone
    // has its fountain inside that zone. Entities bind to the nearest in-zone
    // fountain. (`all` still carries margin settlements for decluster spacing.)
    if (info.kind === "city" && inZone) cities.push({ x: info.x, y: info.y, name: info.name });
    if (!inZone) continue;
    // quest icon rule (features.js villageForMap): 50% chance, at map (x/2+4, y/2-3)
    let quest = null;
    if (rand2(vcx, vcy, S ^ 0x5ddd) < 0.5) {
      const mx = info.x / 2 + 4, my = info.y / 2 - 3;
      quest = { mx, my, gx: Math.round(mx * 2), gy: Math.round(my * 2) };
    }
    settlements.push({ x: info.x, y: info.y, kind: info.kind, name: info.name, R: info.R,
      nb: (info.buildings || []).length,
      buildings: (info.buildings || []).map(b => ({ x0: b.x0, y0: b.y0, w: b.w, h: b.h, job: b.job || null, job2: b.job2 || null, kind: b.kind || null })),
      quest });
  }
  // also collect neighbouring settlements just outside the zone for accurate
  // cross-border declustering (settlementBlockBase looks 1000 tiles out)
  return { settlements, all, cities };
}

// ---------- central deterministic naming (main thread) ----------
// Every NPC is bound to its NEAREST CITY (its spawn fountain, at the city
// centre). The display name is "<base> of <City>", and base names are made
// unique PER CITY (a duplicate is swapped for a culturally-similar unused one,
// exactly the js/world/npc-names.js pools) — so no two NPCs of a city share a
// name, and the "of <City>" suffix separates same-named folk across cities.
// Curated singletons (the Registrar, Weaver, Newhaven quest-givers, Sten) keep
// their hand-authored names.
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const roman = n => (n <= 10 ? ROMAN[n] : "(" + n + ")");
function nameAll(records, zx, zy, cities) {
  const ctx = boot({ withNpcNames: false });   // just need the name pools
  const MIX = ctx.MIX_NPCS.list, VILL = ctx.VILLAGER_NAMES || [];
  const cultPools = new Map();
  for (const d of MIX) { const c = (d.key || "").split("__")[0]; if (!cultPools.has(c)) cultPools.set(c, []); cultPools.get(c).push(d.name); }
  const altPool = culture => culture === "villager" ? VILL : (cultPools.get(culture) || []);
  const nearestCity = (x, y) => {
    let best = null, bd = Infinity;
    for (const c of cities) { const dx = c.x - x, dy = c.y - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = c; } }
    return best;
  };
  // bind each NPC to its nearest city fountain
  for (const r of records) { const c = nearestCity(r.x, r.y); r.city = c ? c.name : null; }
  // canonical order → stable per-city dedup regardless of worker scheduling
  const ROLE = { registrar: 0, weaver: 1, "quest-anchor": 2, tutor: 3, shopkeeper: 4, banker: 5, resident: 6, "quest-giver": 7, other: 8 };
  records.sort((a, b) => String(a.city).localeCompare(String(b.city)) || (ROLE[a.role] - ROLE[b.role]) || a.y - b.y || a.x - b.x);
  // tile-dedup: a border chunk generated by two workers can report the same
  // curated singleton (e.g. the Registrar) twice — keep the canonical-first.
  const seenTile = new Set();
  records = records.filter(r => { const k = r.x + "," + r.y; if (seenTile.has(k)) return false; seenTile.add(k); return true; });
  const usedByCity = new Map();   // city name -> Set(base names taken)
  for (const r of records) {
    if (r.curatedName) { r.name = r.curatedName; continue; }
    const city = r.city || "the wilds";
    let used = usedByCity.get(city); if (!used) { used = new Set(); usedByCity.set(city, used); }
    let base = r.baseName;
    if (used.has(base)) {
      let cand = null;
      for (const n of altPool(r.culture)) if (!used.has(n)) { cand = n; break; }          // same-culture unused
      if (!cand) for (const d of MIX) if (!used.has(d.name)) { cand = d.name; break; }     // any roster name
      if (!cand) { let k = 2; while (used.has(base + " " + roman(k))) k++; cand = base + " " + roman(k); }  // last resort
      base = cand;
    }
    used.add(base);
    r.baseFinal = base;
    r.name = r.city ? base + " of " + r.city : base;
  }
  return records;
}

// ---------- public API ----------
export async function extractZoneNpcs(zx, zy, { limit = 0, workers = 0, log = () => {} } = {}) {
  const t0 = Date.now();
  log(`enumerating settlements for zone ${zx},${zy}…`);
  const ectx = boot({ withNpcNames: false });
  let { settlements, all, cities } = enumerateZone(ectx, zx, zy);
  if (limit) settlements = settlements.slice(0, limit);
  log(`  ${settlements.length} settlements, ${cities.length} cities (${Date.now() - t0}ms)`);
  const nW = workers || workerCap(settlements.length);
  // split settlements into N contiguous (row-major) bands for cache locality
  settlements.sort((a, b) => a.y - b.y || a.x - b.x);
  const groups = Array.from({ length: nW }, () => []);
  settlements.forEach((s, i) => groups[Math.floor(i / Math.ceil(settlements.length / nW))].push(s));
  log(`  fanning out across ${nW} workers…`);
  const results = await Promise.all(groups.filter(g => g.length).map((g, gi) => new Promise((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { kind: "zone-npcs", zx, zy, group: g, all } });
    let recs = null;
    w.on("message", m => { if (m.log) log(`  [w${gi}] ${m.log}`); else recs = m.records; });
    w.on("error", rej);
    w.on("exit", c => c === 0 ? res(recs || []) : rej(new Error("worker " + gi + " exit " + c)));
  })));
  const merged = results.flat();
  log(`  ${merged.length} raw NPCs; naming…`);
  const named = nameAll(merged, zx, zy, cities);
  // to zone-local coordinates (top-left origin of the zone)
  const ox = zx * ZONE_T - ZONE_T / 2, oy = zy * ZONE_T - ZONE_T / 2;
  const npcs = named.map(r => ({
    name: r.name, lx: r.x - ox, ly: r.y - oy, gx: r.x, gy: r.y,
    role: r.role, title: r.mixTitle || null, mixIndex: r.mixIndex, job: r.job || null,
    settlement: r.settlement || null, city: r.city || null,
  }));
  log(`done: ${npcs.length} NPCs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { zx, zy, count: npcs.length, npcs };
}

// Associate every town/village, station, monster and POI in a zone with its
// nearest CITY fountain — the per-city dossier the Zones tab renders. Cheap
// relative to the NPC bake (no chunk generation): enumeration + biome lookups
// (+ optional POI generation, which is slow). NPCs/quests are the flat npcs[]
// filtered by `city` on the page, so they're not duplicated here.
export async function extractZoneCities(zx, zy, { pois = true, log = () => {} } = {}) {
  const t0 = Date.now();
  const ctx = boot({ withNpcNames: false });
  const F = ctx.__f, T = ctx.__t, STATIONS = ctx.STATIONS || {}, BIOME_MOBS = ctx.BIOME_MOBS || {}, MONSTERS = ctx.MONSTERS || {};
  log(`enumerating settlements for zone ${zx},${zy}…`);
  const { settlements, cities } = enumerateZone(ctx, zx, zy);
  log(`  ${settlements.length} settlements, ${cities.length} cities (${Date.now() - t0}ms)`);
  const ox = zx * ZONE_T - ZONE_T / 2, oy = zy * ZONE_T - ZONE_T / 2;
  const nearestCity = (x, y) => { let b = null, bd = Infinity; for (const c of cities) { const dx = c.x - x, dy = c.y - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; b = c; } } return b; };
  const cityMap = new Map();
  const getCity = c => { let r = cityMap.get(c.name); if (!r) { r = { name: c.name, gx: c.x, gy: c.y, lx: c.x - ox, ly: c.y - oy, settlements: [], stationsMap: new Map(), banksMap: new Map(), pois: [] }; cityMap.set(c.name, r); } return r; };
  // bank building → its banking company (road-connected network) + main branch,
  // memoised per network id (bankNetAt/Info do the road-web BFS).
  const netCache = new Map();
  const netFor = (gx, gy) => {
    let net; try { net = F.bankNetAt(gx, gy); } catch (e) { return null; }
    if (!net) return null;
    if (netCache.has(net)) return netCache.get(net);
    let info = null; try { info = F.bankNetInfo(net); } catch (e) {}
    const branch = info && info.branch ? { name: info.branch.name, lx: info.branch.x - ox, ly: info.branch.y - oy } : null;
    const rec = { company: (info && info.title) || "Unaffiliated vault", branch };
    netCache.set(net, rec); return rec;
  };
  // towns/villages → nearest city; aggregate stations + banks their buildings hold
  for (const s of settlements) {
    const c = nearestCity(s.x, s.y); if (!c) continue;
    const rec = getCity(c);
    if (s.name !== c.name) rec.settlements.push({ name: s.name, kind: s.kind, lx: s.x - ox, ly: s.y - oy });
    for (const b of s.buildings) {
      // banks are grouped by company (not lumped in with crafting stations)
      if (b.job === "bank") {
        const bx = b.x0 + (b.w >> 1), by = b.y0 + (b.h >> 1);
        const isMain = b.kind === "mainbank";
        const net = netFor(b.x0, b.y0);
        const company = net ? net.company : "Unaffiliated vault";
        let e = rec.banksMap.get(company);
        if (!e) { e = { company, branches: [], mainBranch: net ? net.branch : null }; rec.banksMap.set(company, e); }
        if (net && net.branch && !e.mainBranch) e.mainBranch = net.branch;
        e.branches.push({ lx: bx - ox, ly: by - oy, settlement: s.name, main: isMain });
      }
      for (const j of [b.job, b.job2]) {
        if (j && j !== "bank" && STATIONS[j]) {
          const cur = rec.stationsMap.get(j) || { key: j, name: STATIONS[j].name || j, instances: [] };
          cur.instances.push({ lx: (b.x0 + (b.w >> 1)) - ox, ly: (b.y0 + (b.h >> 1)) - oy, settlement: s.name });
          rec.stationsMap.set(j, cur);
        }
      }
    }
  }
  // POIs → nearest city (optional; poisNearForMap is slow over a whole zone)
  if (pois) {
    log("  generating POIs (slow)…");
    const half = ZONE_T / 2, mx0 = (zx * ZONE_T - half) / 2, my0 = (zy * ZONE_T - half) / 2, mx1 = (zx * ZONE_T + half) / 2, my1 = (zy * ZONE_T + half) / 2;
    let P = [];
    try { P = F.poisNearForMap(mx0, my0, mx1, my1, 30) || []; } catch (e) { log("  POI gen failed: " + e.message); }
    for (const p of P) { const gx = Math.round(p.x * 2), gy = Math.round(p.y * 2); const c = nearestCity(gx, gy); if (!c) continue; getCity(c).pois.push({ type: p.type || p.kind || "poi", name: p.name || null, lx: gx - ox, ly: gy - oy }); }
    log(`  ${P.length} POIs`);
  }
  // monsters per city: the mob types the local biome(s) spawn (centre + a ring)
  for (const rec of cityMap.values()) {
    const pts = [[rec.gx, rec.gy]]; const R = 260;
    for (let a = 0; a < 4; a++) pts.push([rec.gx + Math.round(Math.cos(a * Math.PI / 2) * R), rec.gy + Math.round(Math.sin(a * Math.PI / 2) * R)]);
    const seen = new Set(), mobs = [];
    for (const [gx, gy] of pts) {
      let bid; try { bid = T.biomeAtTile(gx / 2, gy / 2); } catch (e) { continue; }
      for (const m of (BIOME_MOBS[bid] || [])) { if (seen.has(m.key)) continue; seen.add(m.key); const md = MONSTERS[m.key]; mobs.push({ key: m.key, name: md ? md.name : m.key, lvl: m.lvl }); }
    }
    mobs.sort((a, b) => a.lvl - b.lvl);
    rec.monsters = mobs;
  }
  // shire size + biome mix: sampling the zone on a coarse grid, each sample is
  // attributed to its nearest city fountain (its shire) and classified by biome.
  // Shire size = sampled tiles; biomes = per-biome tile counts (sum == areaTiles).
  const STEP = 60, areaByCity = new Map(), biomeByCity = new Map();
  const idToBiome = biomeIndex(ctx);
  const zx0 = zx * ZONE_T - ZONE_T / 2, zy0 = zy * ZONE_T - ZONE_T / 2;
  for (let sy = zy0 + STEP / 2; sy < zy0 + ZONE_T; sy += STEP)
    for (let sx = zx0 + STEP / 2; sx < zx0 + ZONE_T; sx += STEP) {
      const c = nearestCity(sx, sy); if (!c) continue;
      areaByCity.set(c.name, (areaByCity.get(c.name) || 0) + 1);
      let bid; try { bid = T.biomeAtTile(sx / 2, sy / 2); } catch (e) { continue; }
      const bn = idToBiome[bid] || ("biome " + bid);
      let mm = biomeByCity.get(c.name); if (!mm) { mm = new Map(); biomeByCity.set(c.name, mm); }
      mm.set(bn, (mm.get(bn) || 0) + 1);
    }
  for (const rec of cityMap.values()) {
    rec.areaTiles = (areaByCity.get(rec.name) || 0) * STEP * STEP;
    rec.biomes = biomesToTiles(biomeByCity.get(rec.name), STEP);
  }
  const out = [];
  for (const rec of cityMap.values()) {
    const banks = [...rec.banksMap.values()].map(e => ({
      company: e.company, count: e.branches.length,
      mainBranch: e.mainBranch || null,
      branches: e.branches.sort((a, b) => (b.main - a.main) || a.ly - b.ly || a.lx - b.lx),
    })).sort((a, b) => b.count - a.count || a.company.localeCompare(b.company));
    out.push({ name: rec.name, gx: rec.gx, gy: rec.gy, lx: rec.lx, ly: rec.ly, areaTiles: rec.areaTiles || 0,
      biomes: rec.biomes || {},
      settlements: rec.settlements.sort((a, b) => a.ly - b.ly || a.lx - b.lx),
      stations: [...rec.stationsMap.values()].map(e => ({ key: e.key, name: e.name, count: e.instances.length, instances: e.instances.sort((a, b) => a.ly - b.ly || a.lx - b.lx) })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      banks,
      pois: rec.pois.sort((a, b) => a.ly - b.ly || a.lx - b.lx),
      monsters: rec.monsters || [] });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  log(`done: ${out.length} city dossiers in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { zx, zy, cities: out };
}

// Collect the REAL monster spawn instances the world engine seeds in the WILD
// around each city (past the peaceful town core), by generating the map chunks
// there and reading ch.spawnDefs. Heavy — this is the chunk pipeline — so it's
// fanned out across cores. Returns a flat monsters[] with per-instance tiles,
// biome and bound city. `radius` (game tiles from each fountain) sets coverage.
export async function extractZoneMonsters(zx, zy, { radius = 130, workers = 0, log = () => {} } = {}) {
  const t0 = Date.now();
  const ectx = boot({ withNpcNames: false });
  const { cities } = enumerateZone(ectx, zx, zy);
  log(`  ${cities.length} cities; gathering wild chunks within ${radius} tiles of each fountain…`);
  // union of chunk coords within `radius` of any city centre (dedup)
  const CH = 32, chunkSet = new Set();
  const cr = Math.ceil(radius / CH);
  for (const c of cities) {
    const c0 = Math.floor((c.x - radius) / CH), c1 = Math.floor((c.x + radius) / CH);
    const r0 = Math.floor((c.y - radius) / CH), r1 = Math.floor((c.y + radius) / CH);
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) chunkSet.add(cx + "," + cy);
  }
  const chunks = [...chunkSet].map(s => s.split(",").map(Number));
  log(`  ${chunks.length} unique chunks to generate`);
  const nW = workers || workerCap(chunks.length);
  // contiguous bands (sort by row then col) for road/river cache locality
  chunks.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const groups = Array.from({ length: nW }, () => []);
  chunks.forEach((c, i) => groups[Math.floor(i / Math.ceil(chunks.length / nW))].push(c));
  log(`  fanning out across ${nW} workers…`);
  const results = await Promise.all(groups.filter(g => g.length).map((g, gi) => new Promise((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { kind: "zone-monsters", zx, zy, chunks: g, cities } });
    let recs = null;
    w.on("message", m => { if (m.log) log(`  [w${gi}] ${m.log}`); else recs = m.records; });
    w.on("error", rej);
    w.on("exit", c => c === 0 ? res(recs || []) : rej(new Error("monster worker " + gi + " exit " + c)));
  })));
  // merge + dedup by (key,tile)
  const ox = zx * ZONE_T - ZONE_T / 2, oy = zy * ZONE_T - ZONE_T / 2;
  const seen = new Set(), monsters = [];
  for (const r of results.flat()) {
    const k = r.key + "@" + r.gx + "," + r.gy; if (seen.has(k)) continue; seen.add(k);
    monsters.push({ key: r.key, name: r.name, lvl: r.lvl, aggro: !!r.aggro, gx: r.gx, gy: r.gy, lx: r.gx - ox, ly: r.gy - oy, biome: r.biome, city: r.city });
  }
  log(`done: ${monsters.length} monster instances in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { zx, zy, radius, monsters };
}

// Consolidate a baked manifest's shires: starting from the smallest, absorb any
// shire below `minTiles` into its closest neighbouring fountain until every
// remaining shire is >= minTiles, then re-dedup NPC names so no two NPCs in a
// (merged) shire share a name. Pure post-process on an already-baked manifest —
// no chunk generation. Mutates and returns `man`.
export function mergeShires(man, { minTiles = 4500000, log = () => {} } = {}) {
  const cities = man.cities || [], npcs = man.npcs || [], monsters = man.monsters || [];
  if (!cities.length) { log("no cities to merge"); return man; }
  const byName = new Map(cities.map(c => [c.name, c]));
  const parent = new Map(cities.map(c => [c.name, c.name]));
  const find = n => { if (!parent.has(n)) return n; while (parent.get(n) !== n) { parent.set(n, parent.get(parent.get(n))); n = parent.get(n); } return n; };
  const area = new Map(cities.map(c => [c.name, c.areaTiles || 0]));
  let merges = 0;
  while (true) {
    const caps = [...parent.keys()].filter(n => find(n) === n);
    if (caps.length <= 1) break;
    caps.sort((a, b) => area.get(a) - area.get(b));
    const small = caps[0];
    if (area.get(small) >= minTiles) break;
    const sf = byName.get(small);
    let nb = null, bd = Infinity;
    for (const c of caps) { if (c === small) continue; const o = byName.get(c); const dx = o.gx - sf.gx, dy = o.gy - sf.gy, d = dx * dx + dy * dy; if (d < bd) { bd = d; nb = c; } }
    if (!nb) break;
    parent.set(small, nb); area.set(nb, area.get(nb) + area.get(small)); merges++;
  }
  const finalCap = n => find(n);
  const capCount = [...parent.keys()].filter(n => find(n) === n).length;
  log(`${merges} merges: ${cities.length} shires → ${capCount} (all >= ${minTiles.toLocaleString()} tiles)`);
  // remap flat entities
  npcs.forEach(n => { if (n.city) n.city = finalCap(n.city); });
  monsters.forEach(m => { if (m.city) m.city = finalCap(m.city); });
  // merge dossiers into their final capital
  const merged = new Map();
  for (const c of cities) {
    const cap = finalCap(c.name);
    let m = merged.get(cap);
    if (!m) { m = { name: cap, gx: 0, gy: 0, lx: 0, ly: 0, areaTiles: 0, settlements: [], _st: [], _bk: [], _bio: new Map(), pois: [] }; merged.set(cap, m); }
    m.areaTiles += c.areaTiles || 0;
    for (const bn in (c.biomes || {})) m._bio.set(bn, (m._bio.get(bn) || 0) + c.biomes[bn]);
    m.settlements.push(...(c.settlements || []));
    // every city fountain in the shire is a settlement (kind "city") — the
    // namesake capital (seat) plus any absorbed cities.
    m.settlements.push({ name: c.name, kind: "city", lx: c.lx, ly: c.ly, seat: c.name === cap });
    m.pois.push(...(c.pois || []));
    m._st.push(...(c.stations || []));
    m._bk.push(...(c.banks || []));
    if (c.name === cap) { m.gx = c.gx; m.gy = c.gy; m.lx = c.lx; m.ly = c.ly; }
  }
  for (const m of merged.values()) {
    const sm = new Map();
    for (const s of m._st) { let e = sm.get(s.key); if (!e) { e = { key: s.key, name: s.name, count: 0, instances: [] }; sm.set(s.key, e); } e.count += s.count; e.instances.push(...(s.instances || [])); }
    m.stations = [...sm.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const bm = new Map();
    for (const b of m._bk) { let e = bm.get(b.company); if (!e) { e = { company: b.company, count: 0, mainBranch: b.mainBranch || null, branches: [] }; bm.set(b.company, e); } e.count += b.count; if (!e.mainBranch && b.mainBranch) e.mainBranch = b.mainBranch; e.branches.push(...(b.branches || [])); }
    m.banks = [...bm.values()].sort((a, b) => b.count - a.count || a.company.localeCompare(b.company));
    const bio = {}; for (const [bn, v] of [...m._bio.entries()].sort((a, b) => b[1] - a[1])) bio[bn] = v; m.biomes = bio;
    m.settlements.sort((a, b) => a.ly - b.ly || a.lx - b.lx);
    m.pois.sort((a, b) => a.ly - b.ly || a.lx - b.lx);
    delete m._st; delete m._bk; delete m._bio;
  }
  man.cities = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));

  // recalibrate NPC names so no two NPCs in a merged shire share a name
  const ctx = boot({ withNpcNames: false });
  const MIX = ctx.MIX_NPCS.list, VILL = ctx.VILLAGER_NAMES || [];
  const cultPools = new Map();
  for (const d of MIX) { const c = (d.key || "").split("__")[0]; if (!cultPools.has(c)) cultPools.set(c, []); cultPools.get(c).push(d.name); }
  const altPool = culture => culture === "villager" ? VILL : (cultPools.get(culture) || []);
  const ROLEP = { registrar: 0, weaver: 1, "quest-anchor": 2, shopkeeper: 3, banker: 4, resident: 5, "quest-giver": 6, other: 7 };
  const byCity = new Map();
  npcs.forEach(n => { const k = n.city || "—"; if (!byCity.has(k)) byCity.set(k, []); byCity.get(k).push(n); });
  let renamed = 0;
  for (const [shire, list] of byCity) {
    list.sort((a, b) => (ROLEP[a.role] - ROLEP[b.role]) || a.gy - b.gy || a.gx - b.gx);
    const used = new Set();
    for (const n of list) {
      const cut = n.name.lastIndexOf(" of ");
      if (cut < 0) continue;                                  // curated singleton — keep
      const oldBase = n.name.slice(0, cut);
      const culture = (n.role === "banker" || n.role === "shopkeeper") ? "villager"
        : (n.mixIndex >= 0 && MIX[n.mixIndex]) ? (MIX[n.mixIndex].key || "").split("__")[0] : "villager";
      let base = oldBase;
      if (used.has(base)) {
        let cand = null;
        for (const nm of altPool(culture)) if (!used.has(nm)) { cand = nm; break; }
        if (!cand) for (const d of MIX) if (!used.has(d.name)) { cand = d.name; break; }
        if (!cand) { let k = 2; while (used.has(base + " " + k)) k++; cand = base + " " + k; }
        base = cand; renamed++;
      }
      used.add(base);
      n.name = base + " of " + shire;
    }
  }
  log(`recalibrated names: ${renamed} NPCs renamed to keep shires collision-free`);
  return man;
}

// ---------- shire biome histograms ----------
// biome numeric id → biome key name (B maps name → id).
function biomeIndex(ctx) {
  const B = ctx.B || (typeof B !== "undefined" ? B : {});
  const idToBiome = {}; for (const k in B) idToBiome[B[k]] = k; return idToBiome;
}
// {biomeName → sampleCount} → {biomeName → tileCount}, sorted biggest-first.
function biomesToTiles(mm, step) {
  const o = {}; if (!mm) return o;
  const S2 = step * step;
  for (const [bn, cnt] of [...mm.entries()].sort((a, b) => b[1] - a[1])) o[bn] = cnt * S2;
  return o;
}
// Compute per-shire biome tile counts for an ALREADY-BAKED (and possibly merged)
// manifest, without re-running the whole cities pass. Re-enumerates the zone's
// original city fountains, maps each to the merged shire that now owns it (from
// the baked "kind: city" settlements), samples the zone grid over those
// fountains and classifies each sample by biome. Mutates man.cities[].biomes.
export function augmentShireBiomes(man, zx, zy, { step = 60, log = () => {} } = {}) {
  const ctx = boot({ withNpcNames: false });
  const T = ctx.__t;
  const { cities } = enumerateZone(ctx, zx, zy);      // original in-zone fountains
  const idToBiome = biomeIndex(ctx);
  const shires = man.cities || [];
  // original fountain name → merged shire name (every fountain is a "city" settlement)
  const memberToShire = new Map();
  for (const c of shires) for (const s of (c.settlements || [])) if (s.kind === "city") memberToShire.set(s.name, c.name);
  // fallback for any fountain not recorded as a member: nearest merged seat
  const seats = shires.filter(c => c.gx != null);
  const nearestSeat = (x, y) => { let b = null, bd = Infinity; for (const c of seats) { const dx = c.gx - x, dy = c.gy - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; b = c; } } return b ? b.name : null; };
  const fShire = new Map();
  for (const f of cities) fShire.set(f.name, memberToShire.get(f.name) || nearestSeat(f.x, f.y));
  const nearest = (x, y) => { let b = null, bd = Infinity; for (const c of cities) { const dx = c.x - x, dy = c.y - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; b = c; } } return b; };
  const half = ZONE_T / 2, zx0 = zx * ZONE_T - half, zy0 = zy * ZONE_T - half;
  const byShire = new Map();
  for (let sy = zy0 + step / 2; sy < zy0 + ZONE_T; sy += step)
    for (let sx = zx0 + step / 2; sx < zx0 + ZONE_T; sx += step) {
      const f = nearest(sx, sy); if (!f) continue;
      const shire = fShire.get(f.name); if (!shire) continue;
      let bid; try { bid = T.biomeAtTile(sx / 2, sy / 2); } catch (e) { continue; }
      const bn = idToBiome[bid] || ("biome " + bid);
      let mm = byShire.get(shire); if (!mm) { mm = new Map(); byShire.set(shire, mm); }
      mm.set(bn, (mm.get(bn) || 0) + 1);
    }
  for (const c of shires) c.biomes = biomesToTiles(byShire.get(c.name), step);
  log(`biomes computed for ${shires.length} shires (grid step ${step}, ${byShire.size} shires sampled)`);
  return man;
}

// ---------- worker branch ----------
// Guarded by kind so this file can be imported by prerender-zone.mjs without its
// terrain workers (different workerData) accidentally running NPC extraction.
if (!isMainThread && workerData && workerData.kind === "zone-npcs") {
  const { zx, zy, group, all } = workerData;
  const post = s => parentPort.postMessage({ log: s });
  const ctx = boot({ withNpcNames: false });
  const P = makePlacers(ctx, all);
  // quest icon lookup per settlement
  const questMap = new Map();
  for (const v of group) if (v.quest) questMap.set(v.x + "," + v.y, v.quest);
  const records = [];
  let done = 0;
  for (const v of group) {
    try { records.push(...settlementNpcs(ctx, P, v, questMap).map(r => ({ ...r, settlement: v.name }))); }
    catch (e) { post(`settlement ${v.name} @ ${v.x},${v.y} FAILED: ${e.message}`); }
    if (++done % 5 === 0) post(`${done}/${group.length} settlements`);
  }
  parentPort.postMessage({ records });
  process.exit(0);
}

// worker: generate a band of WILD chunks and harvest their monster spawnDefs.
if (!isMainThread && workerData && workerData.kind === "zone-monsters") {
  const { chunks, cities } = workerData;
  const post = s => parentPort.postMessage({ log: s });
  const ctx = boot({ withNpcNames: false });
  const T = ctx.__t, MONSTERS = ctx.MONSTERS || {}, B = ctx.B || {};
  const idToBiome = {}; for (const k in B) idToBiome[B[k]] = k;
  const nearestCity = (x, y) => { let b = null, bd = Infinity; for (const c of cities) { const dx = c.x - x, dy = c.y - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; b = c; } } return b ? b.name : null; };
  const records = [];
  let done = 0;
  for (const [ccx, ccy] of chunks) {
    let ch; try { ch = ctx.__c.getChunk(ccx, ccy); } catch (e) { if (++done % 50 === 0) post(`${done}/${chunks.length} chunks`); continue; }
    for (const sd of (ch.spawnDefs || [])) {
      const kind = sd[0], gx = sd[1], gy = sd[2], md = MONSTERS[kind];
      if (!md) continue;
      let bid; try { bid = T.biomeAtTile(gx / 2, gy / 2); } catch (e) { bid = -1; }
      records.push({ key: kind, name: md.name || kind, lvl: md.lvl, aggro: !!md.aggro, gx, gy, biome: idToBiome[bid] || String(bid), city: nearestCity(gx, gy) });
    }
    if (++done % 50 === 0) post(`${done}/${chunks.length} chunks (${records.length} spawns)`);
  }
  parentPort.postMessage({ records });
  process.exit(0);
}

// ---------- CLI ----------
if (isMainThread && import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
  const zx = Number(arg("zx", 0)), zy = Number(arg("zy", 0)), limit = Number(arg("limit", 0));
  const out = arg("out", "");
  const log = s => process.stdout.write(s + "\n");
  const run = argv.includes("--monsters")
    ? extractZoneMonsters(zx, zy, { radius: Number(arg("radius", 130)), log }).then(r => ({ r, preview: r.monsters.slice(0, 20) }))
    : extractZoneNpcs(zx, zy, { limit, log }).then(r => ({ r, preview: r.npcs.slice(0, 20) }));
  run.then(({ r, preview }) => {
    if (out) { fs.writeFileSync(out, JSON.stringify(r)); process.stdout.write(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)\n`); }
    else process.stdout.write(JSON.stringify(preview, null, 1) + "\n");
  }).catch(e => { console.error(e); process.exit(1); });
}
