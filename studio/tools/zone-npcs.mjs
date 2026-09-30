// ===== Taiao Workshop — zone NPC extraction =====
// Runs the game's REAL NPC generation headlessly (js/world/chunks.js deriveNpcs +
// the render3d.js resident/quest-giver placement) over every settlement in a
// zone, and returns the actual NPCs the game would spawn there — with their
// EXACT spawn tiles (collision-resolved), zone-local coordinates, and
// zone-unique names (duplicate names swapped for a culturally-similar unused
// one via js/world/npc-names.js, exactly as at play).
//
// The ALGORITHMS live in studio/js/zone-bake-core.js (ZoneBakeCore) — one
// shared implementation with the in-browser "Generate zone" pipeline
// (studio/js/zone-bake-worker.js), so the CLI and the site can never drift.
// This file is the NODE HARNESS around that core: the vm sandbox boot, the
// worker_threads fan-out, and the CLI.
//
// The heavy chunk pipeline (terrain → erosion → settlement stamping) is minutes
// per zone, so work is fanned out across CPU cores: each worker generates a slice
// of the zone's settlements and returns STRUCTURAL npc records (no naming); the
// main thread then runs ONE deterministic, zone-global naming pass so dedup is
// stable regardless of worker scheduling.
//
//   node studio/tools/zone-npcs.mjs [--zx 0] [--zy 0] [--limit N] [--out file]
//
// Exports { extractZoneNpcs, extractZoneCities, extractZoneMonsters,
// mergeShires, augmentShireBiomes } for reuse by prerender-zone.mjs.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, "../../js");
const ZONE_T = 15000;
const DIR8 = ["south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"];

// the shared algorithm core (also importScripts'd by the browser bake worker).
// Loaded into THIS realm — its functions take the booted vm context as G.
vm.runInThisContext(fs.readFileSync(path.join(HERE, "../js/zone-bake-core.js"), "utf8"), { filename: "zone-bake-core.js" });
const CORE = globalThis.ZoneBakeCore;

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
    "world/terrain.js", "world/erosion.js",
    "world/citygrow.js", "world/labgen.js", // settlement accretion + maze plans (features/chunks call them)
    "world/features.js", "world/chunks.js",
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

// ---------- public API ----------
export async function extractZoneNpcs(zx, zy, { limit = 0, workers = 0, log = () => {} } = {}) {
  const t0 = Date.now();
  log(`enumerating settlements for zone ${zx},${zy}…`);
  const ectx = boot({ withNpcNames: false });
  let { settlements, all, cities } = CORE.enumerateZone(ectx, zx, zy);
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
  const named = CORE.nameAll(ectx, merged, zx, zy, cities);
  const npcs = CORE.toZoneLocalNpcs(named, zx, zy);
  log(`done: ${npcs.length} NPCs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { zx, zy, count: npcs.length, npcs };
}

// Associate every town/village, station, monster and POI in a zone with its
// nearest CITY fountain — the per-city dossier the Zones tab renders.
export async function extractZoneCities(zx, zy, { pois = true, log = () => {} } = {}) {
  const t0 = Date.now();
  const ctx = boot({ withNpcNames: false });
  log(`enumerating settlements for zone ${zx},${zy}…`);
  const r = CORE.citiesPass(ctx, zx, zy, { pois, log: s => log("  " + s) });
  log(`done: ${r.cities.length} city dossiers in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return r;
}

// Collect the REAL monster spawn instances the world engine seeds in the WILD
// around each city (past the peaceful town core), by generating the map chunks
// there and reading ch.spawnDefs. Heavy — this is the chunk pipeline — so it's
// fanned out across cores. Returns a flat monsters[] with per-instance tiles,
// biome and bound city. `radius` (game tiles from each fountain) sets coverage.
export async function extractZoneMonsters(zx, zy, { radius = 130, workers = 0, log = () => {} } = {}) {
  const t0 = Date.now();
  const ectx = boot({ withNpcNames: false });
  const { cities } = CORE.enumerateZone(ectx, zx, zy);
  log(`  ${cities.length} cities; gathering wild chunks within ${radius} tiles of each fountain…`);
  const chunks = CORE.monsterChunkList(cities, radius);
  log(`  ${chunks.length} unique chunks to generate`);
  const nW = workers || workerCap(chunks.length);
  // contiguous bands (already sorted row-major) for road/river cache locality
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
  const monsters = CORE.dedupeMonsters(results.flat(), zx, zy);
  log(`done: ${monsters.length} monster instances in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { zx, zy, radius, monsters };
}

// Consolidate a baked manifest's shires (absorb sub-threshold shires) + re-dedup
// NPC names. Pure post-process on an already-baked manifest. Mutates + returns man.
export function mergeShires(man, { minTiles = 4500000, log = () => {} } = {}) {
  const ctx = boot({ withNpcNames: false });   // just needs the name pools
  return CORE.mergeShires(ctx, man, { minTiles, log });
}

// Compute per-shire biome tile counts for an ALREADY-BAKED (and possibly merged)
// manifest. Mutates man.cities[].biomes.
export function augmentShireBiomes(man, zx, zy, { step = 60, log = () => {} } = {}) {
  const ctx = boot({ withNpcNames: false });
  return CORE.augmentShireBiomes(ctx, man, zx, zy, { step, log });
}

// ---------- worker branch ----------
// Guarded by kind so this file can be imported by prerender-zone.mjs without its
// terrain workers (different workerData) accidentally running NPC extraction.
if (!isMainThread && workerData && workerData.kind === "zone-npcs") {
  const { zx, zy, group, all } = workerData;
  const post = s => parentPort.postMessage({ log: s });
  const ctx = boot({ withNpcNames: false });
  const P = CORE.makePlacers(ctx, all);
  // quest icon lookup per settlement
  const questMap = new Map();
  for (const v of group) if (v.quest) questMap.set(v.x + "," + v.y, v.quest);
  const records = [];
  let done = 0;
  for (const v of group) {
    try { records.push(...CORE.settlementNpcs(ctx, P, v, questMap).map(r => ({ ...r, settlement: v.name }))); }
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
  const records = CORE.harvestMonsterChunks(ctx, chunks, cities,
    (done, total, found) => post(`${done}/${total} chunks (${found} spawns)`));
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
