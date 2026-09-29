// ===== chunk terrain-field warm worker =====
// Runs getChunk's passes 1-2 — the eroded elevation grid + biome
// classification, the expensive noise half of a chunk data build — off the
// main thread, ahead of the player (same pattern as roadworker.js). Finished
// grids are posted back and injected (world._fieldInject); the next
// synchronous getChunk for that chunk skips straight to feature stamping.
// The pass code itself is SHARED (erosion.js computeChunkFields) and the
// seed matches, so worker-warmed and cold-built chunks are bit-identical; if
// the player outruns the worker the main thread just computes synchronously
// exactly as before.
"use strict";
let T = null, CHUNK = 32;
onmessage = e => {
  const d = e.data;
  if (d.type === "init") {
    // world.js constants, passed in so they can never drift out of sync
    self.WORLD_SEED = d.seed;
    self.LAND_E = d.landE;
    self.ROCK_E = d.rockE;
    CHUNK = d.chunk;
    self.VCELL = d.vcell;
    self.PCELL = d.pcell;
    self.ICELL = d.icell;
    self.WORLDGEN_SIG = d.gensig; // parity with the other workers (unused here today)
    importScripts("../data.js", "terrain.js", "erosion.js");
    T = createWorldTerrain();
    return;
  }
  if (d.type === "fields" && T)
    for (const c of d.chunks) {
      const f = computeChunkFields(T, CHUNK, c.cx, c.cy);
      postMessage({ key: c.cx + "," + c.cy, eG: f.eG.buffer, bG: f.bG.buffer, tfG: f.tfG.buffer },
        [f.eG.buffer, f.bG.buffer, f.tfG.buffer]);
    }
  // far-LOD vista grids (render3d syncFarLod): raw elevation + biome id for
  // each ring vertex. Pure terrain noise, but ~3800 biome classifications per
  // recentre — sampled here so the main thread only pays for colour lookups
  // and geometry. Heights are (n+1)² — the hillshade needs the +1,+1 diagonal
  // neighbour of every vertex, including the last row/column.
  if (d.type === "far" && T) {
    const grids = [], tr = [];
    for (const ring of d.rings) {
      const n = (2 * ring.half) / ring.step + 1;
      const h = new Float32Array((n + 1) * (n + 1));
      const b = new Int16Array(n * n);
      for (let r = 0; r <= n; r++) {
        const wz = d.cz - ring.half + r * ring.step;
        for (let i = 0; i <= n; i++) {
          const wx = d.cx - ring.half + i * ring.step;
          h[r * (n + 1) + i] = T.elevation(wx / 2, wz / 2);
          if (r < n && i < n) b[r * n + i] = T.biomeAtTile(wx / 2, wz / 2);
        }
      }
      grids.push({ n, h: h.buffer, b: b.buffer });
      tr.push(h.buffer, b.buffer);
    }
    postMessage({ far: { cx: d.cx, cz: d.cz }, grids }, tr);
  }
};
