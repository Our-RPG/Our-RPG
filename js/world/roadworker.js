// ===== road-network warm worker =====
// Computes the deterministic settlement road polylines — including the
// city-link A* that can take whole seconds — off the main thread, ahead of
// the player. Each finished village cell's roads are posted back and injected
// into the main thread's roadCache, so by the time chunk generation asks for
// the region's roads it finds a cache hit instead of freezing the frame.
// Same code + same seed = identical routes; if the player outruns the worker
// the main thread still computes synchronously exactly as before.
"use strict";
let features = null;
onmessage = e => {
  const d = e.data;
  if (d.type === "init") {
    // world.js constants, passed in so they can never drift out of sync
    self.WORLD_SEED = d.seed;
    self.LAND_E = d.landE;
    self.ROCK_E = d.rockE;
    self.CHUNK = d.chunk;
    self.VCELL = d.vcell;
    self.PCELL = d.pcell;
    self.ICELL = d.icell;
    self.WORLDGEN_SIG = d.gensig; // features.js keys the name-registry store by it
    // the world-map region cells ship villages WITH their map icons —
    // villageForMap derives those from these gameplay-layer tables, which
    // live in files this worker doesn't import, so the map worker passes
    // them in (plain dicts). Other roadworker instances omit them and
    // villageForMap falls back exactly as it does on a page without them.
    if (d.shopIcon) self.SHOP_ICON = d.shopIcon;
    if (d.stationIcon) self.STATION_ICON = d.stationIcon;
    if (d.shopTypeKeys) self.SHOP_TYPE_KEYS = d.shopTypeKeys;
    importScripts("../data.js", "terrain.js", "citygrow.js", "labgen.js", "features.js");
    features = createWorldFeatures(createWorldTerrain());
    return;
  }
  // cold-boot world naming (features genZoneNamesData): the ~8s settlements +
  // POI pass, computed AND persisted (workers share IndexedDB) off the main
  // thread while the boot's sheet decode + atlas bake proceed. The finished
  // registry is posted back for the main thread to adopt directly.
  if (d.type === "names" && features) {
    const data = features.genZoneNamesData(d.mx, d.my,
      (f, name) => postMessage({ nameTick: f, name: name || null }));
    postMessage({ names: data });
  }
  if (d.type === "warm" && features) {
    // (i, n) = cells done / total for this warm — the boot loading bar's
    // road progress; warmDone tells the boot wait-stage to stop waiting
    features._roadWarm(d.mx, d.my, d.pad, (key, out, i, n) => postMessage({ key, out, i, n }));
    postMessage({ warmDone: true });
  }
  // world-map overlay: compute a batch of region cells' river + road
  // polylines off-thread (the cold first query can cost seconds of river
  // tracing / road A*) and post each cell back as plain serializable data.
  // world-map macro tiles: same pixel pipeline as the main thread (shared
  // features.macroPixels), computed here so the map never blocks on a bake
  if (d.type === "macro" && features)
    for (const t of d.tiles) {
      const px = features.macroPixels(t.step, t.mx, t.my, d.MACRO_PX, d.MAP_COLORS, d.MAP_WATER);
      postMessage({ macro: t, px: px.buffer }, [px.buffer]);
    }
  if (d.type === "region" && features)
    for (const c of d.cells) {
      const rivs = features.riversNear(c.x0 - 12, c.y0 - 12, c.x1 + 12, c.y1 + 12)
        .map(rv => ({ polys: rv.polys, bbox: rv.bbox }));
      const roads = features.roadsNear(c.x0 - 8, c.y0 - 8, c.x1 + 8, c.y1 + 8)
        .map(rp => ({ pts: rp.pts, bbox: rp.bbox, key: rp.key }));
      // settlement / POI / icon layers ride along in the same cell: a COLD
      // cell can run citygrow accretion and the zone-naming pass (seconds!),
      // which used to happen on the main thread the moment the map's label
      // pass touched a fresh viewport — the single biggest zoom-out freeze.
      // Same code + same seed = identical results; all plain data.
      const villages = features.villagesNearForMap(c.x0, c.y0, c.x1, c.y1, 42);
      const pois = features.poisNearForMap(c.x0, c.y0, c.x1, c.y1, 26);
      const icons = features.iconsNearForMap(c.x0, c.y0, c.x1, c.y1);
      postMessage({ region: c.id, rivs, roads, villages, pois, icons });
    }
};
