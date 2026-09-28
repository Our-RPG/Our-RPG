// ===== Taiao Workshop — offline zone TILE bake =====
// Runs the game's REAL chunk generation (data + content + terrain + features +
// erosion + chunks) headlessly in a Node vm and bakes EVERY chunk of a zone to
// disk: per-tile ground + world objects (trees, rocks, buildings, resource
// nodes, creature spawns). The Zones tab's deep-zoom "tile view" loads these
// instead of generating live (cold getChunk is ~1.6s/chunk + a ~49s one-time
// road/river trace per region — far too slow for interactive zoom).
//
//   node studio/tools/prerender-zone-tiles.mjs [--zx 0] [--zy 0] [--jobs N] [--force]
//   node studio/tools/prerender-zone-tiles.mjs --test              # tiny slice, for validation
//   node studio/tools/prerender-zone-tiles.mjs --test --tx0 0 --ty0 0 --tx1 1 --ty1 1
//
// Output: studio/assets/zones/zone_<zx>_<zy>_tiles/{manifest.json, s_<scx>_<scy>.json}
// A zone is 15000² tiles → 469² ≈ 220k chunks → ~900 shard files (16×16 chunks
// each). RESUMABLE: shard files that already exist are skipped, so an interrupted
// overnight run just continues.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, "../../js");
const OUT = path.resolve(HERE, "../assets/zones");
const ZONE_TILES = 15000, CS = 32, SHARD = 16;   // chunk size, chunks per shard side

// ---- boot the real engine in a vm (mirrors js/zone-chunk-worker.js globals) ----
function buildChunks() {
  const files = ["data.js", "content.js", "world/terrain.js", "world/features.js", "world/erosion.js", "world/chunks.js"];
  const src = files.map(f => fs.readFileSync(path.join(GAME, f), "utf8")).join("\n;\n");
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const WATER_BIOME_IDS = new Set([0, 1, 21]);
  function isWaterKey(k) {
    if (!k) return false;
    if (k.startsWith("at_")) return WATER_BIOME_IDS.has(+k.split("_")[1]);
    return k.startsWith("water") || k === "deep" || k === "sea";
  }
  const ctx = {
    WORLD_SEED: 1337, LAND_E: 0.483, ROCK_E: 0.655, CHUNK: 32, VCELL: 144, PCELL: 30, ICELL: 44, WORLDGEN_SIG: "studio",
    Math, Float32Array, Float64Array, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array,
    ArrayBuffer, DataView, Array, Object, JSON, Map, Set, WeakMap, WeakSet, Symbol, Promise, Date, RegExp, Error,
    isNaN, isFinite, parseInt, parseFloat, String, Number, Boolean, console,
    performance: { now: () => Date.now() }, indexedDB: { open: () => ({}) }, importScripts: () => {},
    mulberry32, isWaterKey, WATER_BIOME_IDS, PX: t => t * 48,
  };
  ctx.globalThis = ctx; ctx.self = ctx; ctx.window = undefined;
  vm.createContext(ctx);
  vm.runInContext(src + `
    ;globalThis.__t = createWorldTerrain();
    ;globalThis.__f = createWorldFeatures(__t);
    ;globalThis.__c = createWorldChunks({ ...__t, ...__f });
    ;globalThis.__NODE_TYPES = (typeof NODE_TYPES !== "undefined") ? NODE_TYPES : {};
    ;globalThis.__STATIONS = (typeof STATIONS !== "undefined") ? STATIONS : {};`, ctx, { filename: "worldgen.js" });
  // sealed special locations never appear on the natural map
  const FAR = { x0: 1e12, y0: 1e12, x1: 1e12 + 1, y1: 1e12 + 1 };
  if (ctx.TUT_ISLE && ctx.TUT_ISLE.bbox) ctx.TUT_ISLE.bbox = FAR;
  if (ctx.DREAM_WORLD && ctx.DREAM_WORLD.RECT) ctx.DREAM_WORLD.RECT = FAR;
  return { C: ctx.__c, F: ctx.__f, ctx, WATER_BIOME_IDS };
}

// resolve at_<b>_<av>_<col> → bg_<b>_<pers> (drawable from shipped sheet "b")
function makeGroundKey(F, WATER) {
  return function groundKey(g, wx, wy) {
    if (!g || !g.startsWith("at_")) return g || "";
    const p = g.split("_"), b = +p[1];
    const pers = WATER.has(b) ? +p[2] : F.personalityAt(wx, wy);
    return "bg_" + b + "_" + pers;
  };
}
function serializeChunk(ch, cx, cy, groundKey, nodeSpr) {
  const bx = cx * CS, by = cy * CS;
  // ground → palette + run-length encoding (biomes are contiguous → tiny)
  const pal = [], idxOf = new Map(), runs = [];
  let prev = -1, run = 0;
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const key = groundKey(ch.ground[z * CS + x], bx + x, by + z);
    let pi = idxOf.get(key); if (pi === undefined) { pi = pal.length; pal.push(key); idxOf.set(key, pi); }
    if (pi === prev) run++; else { if (run > 0) runs.push(run, prev); prev = pi; run = 1; }
  }
  if (run > 0) runs.push(run, prev);
  const decor = [];
  for (let li = 0; li < CS * CS; li++) { const v = ch.decor[li]; if (v) decor.push([li, v]); }
  const nodes = (ch.nodes || []).map(n => [n.x, n.y, nodeSpr(n.type), n.type]);
  const buildings = (ch.buildings || []).map(b => [b.x0, b.y0, b.w, b.h, b.stone ? 1 : 0, b.roof || 0]);
  const spawns = (ch.spawnDefs || []).map(s => [s[0], s[1], s[2]]);
  const o = { c: [cx, cy], g: { p: pal, r: runs } };
  if (decor.length) o.d = decor;
  if (nodes.length) o.n = nodes;
  if (buildings.length) o.b = buildings;
  if (spawns.length) o.s = spawns;
  return o;
}

function zoneChunkBounds(zx, zy) {
  const half = ZONE_TILES / 2;
  const minT = -half, maxT = half - 1;   // tiles relative to zone centre
  return {
    minCx: Math.floor((zx * ZONE_TILES + minT) / CS), maxCx: Math.floor((zx * ZONE_TILES + maxT) / CS),
    minCy: Math.floor((zy * ZONE_TILES + minT) / CS), maxCy: Math.floor((zy * ZONE_TILES + maxT) / CS),
  };
}

// ---------------- worker: bake an assigned list of shards ----------------
if (!isMainThread) {
  const { zx, zy, shards, dir, bounds } = workerData;
  const { C, F, ctx, WATER_BIOME_IDS } = buildChunks();
  const groundKey = makeGroundKey(F, WATER_BIOME_IDS);
  const NODE_TYPES = ctx.__NODE_TYPES || {}, STATIONS = ctx.__STATIONS || {};
  // stations resolve their sprite via STATIONS (render3d.js), everything else via NODE_TYPES
  const nodeSpr = t => (STATIONS[t] && STATIONS[t].spr) || (NODE_TYPES[t] && NODE_TYPES[t].spr) || t;
  for (const [scx, scy] of shards) {
    const cx0 = Math.max(bounds.minCx, scx * SHARD), cx1 = Math.min(bounds.maxCx, scx * SHARD + SHARD - 1);
    const cy0 = Math.max(bounds.minCy, scy * SHARD), cy1 = Math.min(bounds.maxCy, scy * SHARD + SHARD - 1);
    const chunks = {};
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      chunks[cx + "," + cy] = serializeChunk(C.getChunk(cx, cy), cx, cy, groundKey, nodeSpr);
    }
    fs.writeFileSync(path.join(dir, `s_${scx}_${scy}.json`), JSON.stringify({ z: [zx, zy], scx, scy, cs: SHARD, chunkSize: CS, chunks }));
    // Free the per-chunk caches so a 220k-chunk run stays flat in memory instead
    // of accumulating every chunk (getChunk memoizes into C.chunks; deriveNpcs
    // pushes into C.npcs). The expensive river/road ROUTE caches inside features
    // are kept — that's the one-time warm we never want to redo.
    if (C.chunks && C.chunks.clear) C.chunks.clear();
    if (Array.isArray(C.npcs)) C.npcs.length = 0;
    if (Array.isArray(C.obstacles)) C.obstacles.length = 0;
    parentPort.postMessage({ done: [scx, scy] });
  }
  process.exit(0);
}

// ---------------- main: plan shards, spawn workers, write manifest ----------------
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i >= 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes("--" + k);
const zx = +arg("zx", 0), zy = +arg("zy", 0);
const jobs = Math.max(1, +arg("jobs", Math.max(1, os.cpus().length - 2)));
const force = has("force");
const bounds = zoneChunkBounds(zx, zy);
const dir = path.join(OUT, `zone_${zx}_${zy}_tiles`);
fs.mkdirSync(dir, { recursive: true });

// shard grid
let sc0x = Math.floor(bounds.minCx / SHARD), sc1x = Math.floor(bounds.maxCx / SHARD);
let sc0y = Math.floor(bounds.minCy / SHARD), sc1y = Math.floor(bounds.maxCy / SHARD);
if (has("test")) {   // tiny validation slice: an explicit chunk rect → its shard(s)
  const tx0 = +arg("tx0", 0), ty0 = +arg("ty0", 0), tx1 = +arg("tx1", 1), ty1 = +arg("ty1", 1);
  bounds.minCx = tx0; bounds.maxCx = tx1; bounds.minCy = ty0; bounds.maxCy = ty1;
  sc0x = Math.floor(tx0 / SHARD); sc1x = Math.floor(tx1 / SHARD);
  sc0y = Math.floor(ty0 / SHARD); sc1y = Math.floor(ty1 / SHARD);
  console.log(`TEST bake: chunks x[${tx0}..${tx1}] y[${ty0}..${ty1}]`);
}

const allShards = [], todo = [];
for (let scy = sc0y; scy <= sc1y; scy++) for (let scx = sc0x; scx <= sc1x; scx++) {
  allShards.push([scx, scy]);
  if (force || !fs.existsSync(path.join(dir, `s_${scx}_${scy}.json`))) todo.push([scx, scy]);
}

// write/update the manifest up front so the Zones tab can enable the tile view
// while a long bake is still filling in shards
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
  z: [zx, zy], chunkSize: CS, shardChunks: SHARD,
  minChunk: [bounds.minCx, bounds.minCy], maxChunk: [bounds.maxCx, bounds.maxCy],
  shardGrid: [sc0x, sc0y, sc1x, sc1y], builtAt: new Date().toISOString().slice(0, 10), version: 1,
}, null, 1));

console.log(`Zone ${zx},${zy}: ${allShards.length} shards total, ${todo.length} to bake (${allShards.length - todo.length} already on disk).`);
if (!todo.length) { console.log("Nothing to do — all shards baked. Use --force to rebuild."); process.exit(0); }

const N = Math.min(jobs, todo.length);
// Give each worker a CONTIGUOUS band of shards (todo is row-major), not an
// interleaved stripe: adjacent shards share the same rivers/roads, so a worker
// pays the ~50s road/river warm once per local region and reuses it — far faster
// and far less route-cache memory than scattering each worker across the zone.
const per = Math.ceil(todo.length / N);
const groups = Array.from({ length: N }, (_, i) => todo.slice(i * per, (i + 1) * per)).filter(g => g.length);
console.log(`Baking with ${N} worker(s)…  (a full zone is ~220k chunks at ~1.6s each — expect many hours; safe to Ctrl-C and re-run)`);

const t0 = Date.now();
let done = 0;
await Promise.all(groups.filter(g => g.length).map(shards => new Promise((resolve, reject) => {
  const w = new Worker(fileURLToPath(import.meta.url), { workerData: { zx, zy, shards, dir, bounds } });
  w.on("message", m => {
    if (m.done) {
      done++;
      const pct = (done / todo.length * 100).toFixed(1);
      const rate = done / ((Date.now() - t0) / 1000);
      const eta = rate > 0 ? Math.round((todo.length - done) / rate) : 0;
      process.stdout.write(`\r  ${done}/${todo.length} shards (${pct}%)  ~${eta}s left    `);
    }
  });
  w.on("error", reject);
  w.on("exit", code => code === 0 ? resolve() : reject(new Error("worker exit " + code)));
})));
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${dir}`);
