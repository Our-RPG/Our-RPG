// ===== Our RPG Workshop — zone terrain render worker =====
// Runs the game's REAL world generation off the main thread (exactly like the
// game's own js/world/roadworker.js): importScripts the deterministic terrain +
// feature code, then renders a zone's macro-tile pixels and queries its
// settlements, POIs, icons, rivers and roads. Heavy (seconds of noise + road
// A*), so it streams results back as they're ready and the page stays live.
"use strict";
let features = null, terrain = null;

// world.js constants (passed in on init so they can never drift from the game)
function boot(d) {
  self.WORLD_SEED = d.seed;
  self.LAND_E = d.landE;
  self.ROCK_E = d.rockE;
  self.CHUNK = d.chunk;
  self.VCELL = d.vcell;
  self.PCELL = d.pcell;
  self.ICELL = d.icell;
  self.WORLDGEN_SIG = d.gensig;
  // paths are relative to THIS worker (/studio/js/) → the game lives at /js/
  importScripts("../../js/data.js", "../../js/world/terrain.js", "../../js/world/features.js");
  terrain = createWorldTerrain();
  features = createWorldFeatures(terrain);
  // the sealed special locations are never baked into the main map (they live in
  // zone[special]); neutralise both so the world map shows the natural underlying
  // terrain — bounds out of range → tutIsleSD & dreamSD return null (no isle carve
  // or seal-masked blue circle, no dream overrides).
  const FAR = { x0: 1e12, y0: 1e12, x1: 1e12 + 1, y1: 1e12 + 1 };
  if (typeof TUT_ISLE !== "undefined" && TUT_ISLE && TUT_ISLE.bbox) TUT_ISLE.bbox = FAR;
  if (typeof DREAM_WORLD !== "undefined" && DREAM_WORLD && DREAM_WORLD.RECT) DREAM_WORLD.RECT = FAR;
}

onmessage = e => {
  const d = e.data;
  try {
    if (d.type === "init") { boot(d); postMessage({ ready: true }); return; }

    // ---- live detail: render an arbitrary MAP-coord rect at a finer step (for
    // zoom-in). Streams tiles tagged with `token` so the page can drop stale
    // responses when the view moves. Terrain only (no feature query). ----
    if (d.type === "region" && features) {
      const MPX = d.MPX, step = d.step, MT = MPX * step;
      const mx0 = Math.floor(d.mapX0 / MT), mx1 = Math.floor((d.mapX1 - 1e-6) / MT);
      const my0 = Math.floor(d.mapY0 / MT), my1 = Math.floor((d.mapY1 - 1e-6) / MT);
      const cols = mx1 - mx0 + 1, rows = my1 - my0 + 1;
      const originMapX = mx0 * MT, originMapY = my0 * MT;
      postMessage({ regionMeta: { token: d.token, MPX, step, imgW: cols * MPX, imgH: rows * MPX, originMapX, originMapY }, n: cols * rows });
      let i = 0;
      for (let my = my0; my <= my1; my++) {
        for (let mx = mx0; mx <= mx1; mx++) {
          const px = features.macroPixels(step, mx, my, MPX, d.MAP_COLORS, d.MAP_WATER, false);
          i++;
          postMessage({ regionTile: { token: d.token, ox: (mx - mx0) * MPX, oy: (my - my0) * MPX, MPX }, px: px.buffer, i, n: cols * rows }, [px.buffer]);
        }
      }
      postMessage({ regionDone: true, token: d.token });
      return;
    }

    if (d.type !== "render" || !features) return;

    // ---- zone geometry ----
    // A zone is d.zoneTiles tiles per side (15000); 1 map unit = 2 tiles, so the
    // zone is zoneTiles/2 map units per side. macroPixels works in MAP units.
    const zoneMap = d.zoneTiles / 2;                 // 7500 map units per side
    const cMap = d.zx * zoneMap, cMapY = d.zy * zoneMap;   // zone centre (map units)
    const mapMinX = cMap - zoneMap / 2, mapMinY = cMapY - zoneMap / 2;
    const mapMaxX = cMap + zoneMap / 2, mapMaxY = cMapY + zoneMap / 2;
    const MPX = d.MPX, step = d.step, MT = MPX * step;       // map units per macro tile
    const mx0 = Math.floor(mapMinX / MT), mx1 = Math.floor((mapMaxX - 1e-6) / MT);
    const my0 = Math.floor(mapMinY / MT), my1 = Math.floor((mapMaxY - 1e-6) / MT);
    const cols = mx1 - mx0 + 1, rows = my1 - my0 + 1;
    // image origin in map units (top-left of the tile-aligned grid)
    const originMapX = mx0 * MT, originMapY = my0 * MT;
    const imgW = cols * MPX, imgH = rows * MPX;
    postMessage({ meta: { cols, rows, MPX, step, imgW, imgH, originMapX, originMapY, mapMinX, mapMinY, zoneMap } });

    // ---- terrain tiles (streamed as they render) ----
    const total = cols * rows; let i = 0;
    for (let my = my0; my <= my1; my++) {
      for (let mx = mx0; mx <= mx1; mx++) {
        const px = features.macroPixels(step, mx, my, MPX, d.MAP_COLORS, d.MAP_WATER, false);
        const ox = (mx - mx0) * MPX, oy = (my - my0) * MPX;
        i++;
        postMessage({ macro: { ox, oy, MPX }, px: px.buffer, i, n: total }, [px.buffer]);
      }
    }

    // ---- features. Villages/POIs/roads/rivers are in MAP coords (the units
    // elevation()/macroPixels sample) — query exactly the rendered image's map
    // extent so overlays land on the terrain. Each stage guarded + streamed. ----
    const tMinX = originMapX, tMinY = originMapY;
    const tMaxX = originMapX + imgW * step, tMaxY = originMapY + imgH * step;
    postMessage({ phase: "features" });
    const stage = (name, fn) => { try { postMessage({ [name]: fn() }); } catch (err) { postMessage({ [name]: [], warn: name + ": " + err }); } };
    stage("villages", () => features.villagesNearForMap(tMinX, tMinY, tMaxX, tMaxY, d.vcell)
      .map(v => ({ name: v.name, kind: v.kind, x: v.x, y: v.y })));
    stage("pois", () => features.poisNearForMap(tMinX, tMinY, tMaxX, tMaxY, d.pcell)
      .map(p => ({ name: p.name, kind: p.kind, x: p.x, y: p.y })));
    stage("icons", () => features.iconsNearForMap(tMinX, tMinY, tMaxX, tMaxY)
      .map(ic => ({ kind: ic.kind || ic.type, x: ic.x, y: ic.y })));
    stage("rivers", () => features.riversNear(tMinX, tMinY, tMaxX, tMaxY).map(rv => ({ polys: rv.polys, bbox: rv.bbox })));
    stage("roads", () => features.roadsNear(tMinX, tMinY, tMaxX, tMaxY).map(rp => ({ pts: rp.pts, bbox: rp.bbox })));
    postMessage({ done: true });
  } catch (err) {
    postMessage({ error: String(err && err.stack || err) });
  }
};
