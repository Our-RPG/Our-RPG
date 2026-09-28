// ===== Taiao Workshop — real chunk generator (deep-zoom tile view) =====
// Boots the game's ACTUAL world engine off-thread — data + content + terrain +
// features + erosion + chunks — and streams fully generated chunks so the Zones
// map can draw real ground tiles and world objects (trees, rocks, buildings,
// resource nodes) exactly as the running game would, not a terrain-colour proxy.
//
// This is the heavy sibling of zone-worker.js: that one only renders macro
// terrain colour (macroPixels); this one runs full getChunk() (erosion + rivers
// + road A* + settlement/vegetation stamping) for a small set of visible chunks.
"use strict";

let terrain = null, features = null, chunksApi = null;

// ---- globals that chunks.js reads but that live in files we do NOT import ----
// (js/world.js wires the live game; js/biome-tiles.js pokes the SPR atlas table
//  and js/main/state.js the live canvas — none are worker-safe, so we provide
//  just the few pure helpers chunks.js actually needs.)

// mulberry32 — deterministic PRNG (verbatim from js/world.js:30).
self.mulberry32 = function (seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// isWaterKey — worker-safe port of js/biome-tiles.js. Water biomes are
// Deep(0)/Sea(1)/Reef(21); literal ground water keys start "water".
const WATER_BIOME_IDS = new Set([0, 1, 21]);
self.isWaterKey = function (k) {
  if (!k) return false;
  if (k.startsWith("at_")) return WATER_BIOME_IDS.has(+k.split("_")[1]);
  return k.startsWith("water") || k === "deep" || k === "sea";
};

// PX — js/main/state.js maps a tile to on-screen px for deriveNpcs' precomputed
// coordinates, which we never consume. A plain scale keeps deriveNpcs happy.
self.PX = t => t * 48;

function boot(d) {
  self.WORLD_SEED = d.seed; self.LAND_E = d.landE; self.ROCK_E = d.rockE;
  self.CHUNK = d.chunk; self.VCELL = d.vcell; self.PCELL = d.pcell;
  self.ICELL = d.icell; self.WORLDGEN_SIG = d.gensig;
  // paths are relative to THIS worker (/studio/js/) → the game lives at /js/
  importScripts(
    "../../js/data.js", "../../js/content.js",
    "../../js/world/terrain.js", "../../js/world/features.js",
    "../../js/world/erosion.js", "../../js/world/chunks.js",
  );
  terrain = createWorldTerrain();
  features = createWorldFeatures(terrain);
  chunksApi = createWorldChunks({ ...terrain, ...features });
  // Sealed special locations never appear on the natural map (they live in
  // zone[special]); neutralise them exactly like zone-worker.js does.
  const FAR = { x0: 1e12, y0: 1e12, x1: 1e12 + 1, y1: 1e12 + 1 };
  if (typeof TUT_ISLE !== "undefined" && TUT_ISLE && TUT_ISLE.bbox) TUT_ISLE.bbox = FAR;
  if (typeof DREAM_WORLD !== "undefined" && DREAM_WORLD && DREAM_WORLD.RECT) DREAM_WORLD.RECT = FAR;
}

// Resolve a generated ground key to one the studio's atlas blitter can draw.
// The game's 64px ground atlas (sheet "a") is not shipped to the browser, so —
// like render3d.js:453-461 — we remap `at_<b>_<av>_<col>` to `bg_<b>_<pers>`
// (sheet "b", which IS shipped): water biomes keep their fixed variant, land
// uses the regional personality roll. Literal keys (floor_wood, water#3, farm…)
// pass straight through for the main thread to look up.
function groundKey(g, wx, wy) {
  if (!g || g.charCodeAt(0) !== 97 /* 'a' */ || !g.startsWith("at_")) return g;
  const p = g.split("_");
  const b = +p[1];
  const pers = WATER_BIOME_IDS.has(b) ? +p[2] : features.personalityAt(wx, wy);
  return "bg_" + b + "_" + pers;
}

// One node's drawable sprite key (NODE_TYPES carries it; stations/others fall
// back to the raw type, which the main thread resolves against SPR or a marker).
function nodeSpr(type) {
  const nt = (typeof NODE_TYPES !== "undefined") ? NODE_TYPES[type] : null;
  return (nt && nt.spr) || type;
}

function emitChunk(token, cx, cy, i, n) {
  const ch = chunksApi.getChunk(cx, cy);
  const CS = self.CHUNK;
  const bx = cx * CS, by = cy * CS;
  // ground → palette + Uint16 index grid (1024 tiles compress to a handful of keys)
  const pal = [], palIdx = new Map(), idx = new Uint16Array(CS * CS);
  for (let z = 0; z < CS; z++) {
    for (let x = 0; x < CS; x++) {
      const li = z * CS + x;
      const key = groundKey(ch.ground[li], bx + x, by + z) || "";
      let pi = palIdx.get(key);
      if (pi === undefined) { pi = pal.length; pal.push(key); palIdx.set(key, pi); }
      idx[li] = pi;
    }
  }
  // decor → sparse list {li, key} (most tiles are empty)
  const decor = [];
  for (let li = 0; li < CS * CS; li++) {
    const d = ch.decor[li];
    if (d) decor.push([li, d]);
  }
  // nodes → world-tile pos + drawable sprite key + type
  const nodes = (ch.nodes || []).map(n => ({ x: n.x, y: n.y, spr: nodeSpr(n.type), type: n.type }));
  const buildings = (ch.buildings || []).map(b => ({ x0: b.x0, y0: b.y0, w: b.w, h: b.h, stone: !!b.stone, roof: b.roof }));
  const spawns = (ch.spawnDefs || []).map(s => ({ kind: s[0], x: s[1], y: s[2] }));
  postMessage({
    token, i, n,
    chunk: { cx, cy, CS, bx, by, pal, idx: idx.buffer, decor, nodes, buildings, spawns },
  }, [idx.buffer]);
}

onmessage = e => {
  const d = e.data;
  try {
    if (d.type === "init") { boot(d); postMessage({ ready: true }); return; }
    if (d.type === "chunks" && chunksApi) {
      const list = d.list || [];
      // The main thread drops stale responses by token; we just render the
      // (small, visible) list it asked for as fast as we can.
      for (let i = 0; i < list.length; i++) emitChunk(d.token, list[i][0], list[i][1], i + 1, list.length);
      postMessage({ token: d.token, chunksDone: true });
      return;
    }
  } catch (err) {
    postMessage({ token: d && d.token, error: String(err && err.stack || err) });
  }
};
