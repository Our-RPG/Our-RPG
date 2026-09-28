// ===== Taiao Workshop — Zones dossier =====
// Enter zone coordinates (default 0,0) and get the whole zone: a rendered
// terrain map (the game's REAL world-gen, run off-thread in js/zone-worker.js —
// biomes, coastlines, hillshade, settlements, POIs, roads, rivers, labels), plus
// every NPC and station, the quests, biomes and bank model.
//
// The world is deterministic (seed 1337) and a zone is 15000×15000 tiles
// (features.js ZONE_T). Zone[0,0] is the origin/spawn zone; Newhaven is the fixed
// starting city WITHIN it (one of its shires), not the zone's name. Rendering the true
// per-tile map for 225M tiles as one image is physically impossible, so the map
// is a downsampled overview you can zoom; higher detail = more compute.
"use strict";

const ZONE_T = 15000;              // game tiles per zone side (features.js)
const ZONE_HALF = ZONE_T / 2;

// biome colour palette + water/road colours — copied verbatim from js/world/map.js
const ZMAP_COLORS = [[66,88,134],[100,124,162],[199,183,143],[93,122,62],[72,104,54],[94,106,72],[197,172,113],[110,104,95],[222,225,228],[150,159,138],[152,132,76],[162,120,82],[44,90,40],[110,140,70],[164,154,86],[126,122,106],[148,150,120],[56,50,48],[96,88,76],[88,112,88],[88,138,72],[90,140,160],[136,130,112],[220,218,206],[76,112,88],[170,108,68],[152,146,90],[186,106,60],[112,98,120],[182,174,152],[92,124,116],[94,90,86],[118,102,108],[202,218,230],[124,150,72],[124,140,94],[152,142,170]];
const ZMAP_WATER = [[50,70,114],[72,94,140],[98,124,164],[138,164,194]];
const ZMAP_PATH = "rgb(158,139,104)", ZMAP_RIVER = "rgb(120,150,180)";

const DETAILS = {
  overview: { label: "Overview (fast)", step: 32 },
  detailed: { label: "Detailed", step: 16 },
  fine:     { label: "Fine (slow)", step: 8 },
};

// rendered-map cache: "zx,zy,detail" → { url, meta, feat }
const _zoneCache = new Map();

// The local bake server (tools/bake-server.mjs) runs on :8898 alongside the
// static server. "Generate zone" streams its progress over SSE and it writes the
// per-zone page (zones/<zx>.<zy>.html) + manifest when done.
const BAKE_SERVER = (typeof location !== "undefined") ? (location.protocol + "//" + location.hostname + ":8898") : "";
// Baking only works from a local dev checkout (the bake server isn't deployed
// anywhere else) — gate the "Generate zone" button on that.
const LOCAL_BAKE_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const isLocalBake = (typeof location !== "undefined") && LOCAL_BAKE_HOSTS.includes(location.hostname);
let _zoneBaking = false;   // one bake at a time (client guard; the server also locks)
const zoneFileName = (x, y) => x + "." + y + ".html";

// Which zones are baked — assets/zones/index.json (["0,0","-1,0",…]), written by
// gen_pages and appended by the bake server after each new bake. The NPC and Quests
// tabs aggregate across all of these, so a freshly-baked zone's NPCs & quests show
// up. Falls back to just the origin if the index is missing.
function bakedZones() {
  return fetch(STUDIO_BASE + "assets/zones/index.json", { cache: "no-cache" })
    .then(r => r.ok ? r.json() : null)
    .then(list => (Array.isArray(list) && list.length) ? list.map(String) : ["0,0"])
    .catch(() => ["0,0"]);
}

// The coordinate form: View a baked zone, or Generate (bake) an unbaked one with a
// live progress bar. Baked = the per-zone HTML page exists in /zones/.
function zoneCoordForm(zx, zy) {
  const card = el("div.card");
  const readInt = (v, d) => { const n = parseInt(v, 10); return isNaN(n) ? d : n; };
  const xIn = el("input", { type: "number", value: String(zx), style: "width:90px" });
  const yIn = el("input", { type: "number", value: String(zy), style: "width:90px" });
  const actionHost = el("span");
  const status = el("div", { style: "margin-top:.6rem" });
  const coords = () => [readInt(xIn.value, 0), readInt(yIn.value, 0)];

  async function refreshAction() {
    const [x, y] = coords();
    clear(status); clear(actionHost);
    actionHost.appendChild(el("span.tagline", { text: "checking…" }));
    let baked = false;
    try { baked = (await fetch(STUDIO_BASE + "zones/" + zoneFileName(x, y), { method: "HEAD" })).ok; } catch (_) {}
    clear(actionHost);
    if (baked) {
      actionHost.appendChild(el("a.btn.sm.primary", { text: "View zone", href: "#/zones?zx=" + x + "&zy=" + y }));
    } else if (isLocalBake) {
      const gen = el("button.btn.sm.primary", { text: "Generate zone", onclick: () => generate(x, y, gen) });
      actionHost.appendChild(gen);
      actionHost.appendChild(el("span.tagline", { style: "margin-left:.5rem", text: "not baked yet" }));
    } else {
      actionHost.appendChild(el("button.btn.sm", { text: "Generate zone", disabled: true, title: "Local dev only" }));
      actionHost.appendChild(el("span.tagline", { style: "margin-left:.5rem", text: "Zone baking runs from a local dev checkout (studio/tools/bake-server.mjs) — not available on this site." }));
    }
  }
  xIn.oninput = yIn.oninput = refreshAction;

  function generate(x, y, btn) {
    if (_zoneBaking) { toast("A zone is already generating — one at a time.", "warn"); return; }
    _zoneBaking = true; btn.disabled = true; btn.textContent = "Generating…";
    clear(status);
    const bar = el("div", { style: "height:14px;border-radius:7px;background:var(--line,#333);overflow:hidden;max-width:440px" });
    const fill = el("div", { style: "height:100%;width:0%;background:var(--gold);transition:width .3s" });
    bar.appendChild(fill);
    const label = el("div.tagline", { style: "margin-top:.3rem", text: "Starting bake…" });
    status.appendChild(bar); status.appendChild(label);
    const setPct = (p, msg) => { const v = Math.max(0, Math.min(100, p)); fill.style.width = v + "%"; label.textContent = (msg ? msg + "  " : "") + Math.round(v) + "%"; };
    let es;
    const fail = msg => { _zoneBaking = false; btn.disabled = false; btn.textContent = "Generate zone"; clear(status); status.appendChild(el("div.banner.warn", { text: msg })); if (es) try { es.close(); } catch (_) {} };
    try { es = new EventSource(BAKE_SERVER + "/bake?zx=" + x + "&zy=" + y); }
    catch (e) { fail("Couldn't reach the bake server on :8898 — run `node studio/tools/bake-server.mjs`."); return; }
    es.addEventListener("progress", ev => { try { const d = JSON.parse(ev.data); setPct(d.pct, d.msg); } catch (_) {} });
    // non-fatal — the bake itself still succeeded (e.g. NPC-page regen failed)
    es.addEventListener("warning", ev => { try { toast(JSON.parse(ev.data).msg || "Bake warning.", "warn", 8000); } catch (_) {} });
    es.addEventListener("error-msg", ev => { let m = "Bake failed."; try { m = JSON.parse(ev.data).msg || m; } catch (_) {} fail(m); });
    es.addEventListener("done", () => {
      es.close(); _zoneBaking = false; setPct(100, "Done!");
      toast("Zone " + x + "," + y + " baked.", "ok", 5000);
      clear(actionHost); actionHost.appendChild(el("a.btn.sm.primary", { text: "View zone", href: "#/zones?zx=" + x + "&zy=" + y }));
      clear(status); status.appendChild(el("div.banner.info", { html: "Baked ✓ — <a href='#/zones?zx=" + x + "&zy=" + y + "'>open zone " + x + "," + y + "</a>." }));
    });
    es.onerror = () => { if (es.readyState === EventSource.CLOSED && _zoneBaking) fail("Couldn't reach the bake server on :8898 — is `node studio/tools/bake-server.mjs` running?"); };
  }

  card.appendChild(el("div.row", { style: "align-items:flex-end;gap:.8rem;flex-wrap:wrap" }, [
    el("label.field", { style: "margin:0" }, [el("span", { text: "Zone X" }), xIn]),
    el("label.field", { style: "margin:0" }, [el("span", { text: "Zone Y" }), yIn]),
    actionHost,
    el("a.btn.sm", { text: "Origin (0,0)", href: "#/zones?zx=0&zy=0" }),
    el("a.btn.sm", { text: "✦ Special zone", title: "sealed locations that are not on the world map", href: "#/zones?special=1" }),
  ]));
  card.appendChild(status);
  refreshAction();
  return card;
}

function pageZones(root, params) {
  clear(root);
  // zone[special] — the sealed locations that are NOT on the coordinate world map
  if (params && params.get("special")) return pageSpecialZone(root);
  const page = el("div.page");
  const readInt = (v, d) => { const n = parseInt(v, 10); return isNaN(n) ? d : n; };
  let zx = readInt(params && params.get("zx"), 0);
  let zy = readInt(params && params.get("zy"), 0);
  const isOrigin = zx === 0 && zy === 0;

  page.appendChild(el("div.banner.info", { html:
    "The whole zone, rendered from the game's real world engine (seed <b>1337</b>). A zone is " +
    ZONE_T.toLocaleString() + "×" + ZONE_T.toLocaleString() + " tiles; zone <b>0,0</b> is the origin zone, home to the fixed starting city <b>Newhaven</b>." }));

  // coordinate entry — View a baked zone, or Generate (bake) an unbaked one
  page.appendChild(zoneCoordForm(zx, zy));

  // header + bounds — the zone is always "Zone x,y"; Newhaven is a city within the
  // origin zone (its primary settlement), not the zone's name.
  const zoneName = "Zone " + zx + "," + zy;
  const cx = zx * ZONE_T, cy = zy * ZONE_T;
  const hdr = el("div.card");
  hdr.appendChild(el("div.sectitle", null, [el("h3", null, [zoneName + " ", el("span.hint", { text: isOrigin ? "origin / spawn zone" : "procedural zone" })]),
    el("span.badge", { text: isOrigin ? "spawn zone" : "procedural zone" })]));
  const kv = el("dl.kv");
  const add = (k, v) => { kv.appendChild(el("dt", { text: k })); kv.appendChild(el("dd", { text: String(v) })); };
  add("Coordinates", "(" + zx + ", " + zy + ")");
  add("Centre tile", "(" + cx.toLocaleString() + ", " + cy.toLocaleString() + ")");
  add("Tile bounds", "x " + (cx - ZONE_HALF).toLocaleString() + " … " + (cx + ZONE_HALF).toLocaleString() + "  ·  y " + (cy - ZONE_HALF).toLocaleString() + " … " + (cy + ZONE_HALF).toLocaleString());
  add("Area", (ZONE_T * ZONE_T).toLocaleString() + " tiles");
  add("Primary settlement", isOrigin ? "Newhaven (fixed at origin)" : "generated at play time");
  hdr.appendChild(kv);
  page.appendChild(hdr);

  page.appendChild(zoneMapCard(zx, zy));
  page.appendChild(citiesCard(zx, zy, isOrigin));
  root.appendChild(page);
}

// zone[special]: the sealed locations that are NOT on the coordinate world map
function pageSpecialZone(root) {
  const page = el("div.page");
  page.appendChild(el("div.banner.info", { html:
    "<b>zone[special]</b> — sealed locations that exist in Taiao but are <b>not part of any world-map zone</b>. They can't be reached by navigating the seed map (no coordinates lead here); each is entered only by its own in-game mechanic." }));
  page.appendChild(el("div.card", null, [el("div.btn-row", null, [
    el("a.btn.sm", { text: "← Back to the world map", href: "#/zones?zx=0&zy=0" }),
  ])]));
  const hdr = el("div.card");
  hdr.appendChild(el("div.sectitle", null, [el("h3", null, ["Special zone ", el("span.hint", { text: "off-grid, sealed regions" })]), el("span.badge", { text: "not on the world map" })]));
  page.appendChild(hdr);
  const host = el("div", null, [el("div.center-col", null, [el("div.spinner"), el("small", { text: "Loading…" })])]);
  page.appendChild(host);
  root.appendChild(page);

  fetch(STUDIO_BASE + "assets/zones/zone_special.json", { cache: "force-cache" })
    .then(r => r.ok ? r.json() : null).then(m => {
      clear(host);
      if (!m || !m.regions || !m.regions.length) { host.appendChild(el("div.empty", { html: "<div class='big'>✦</div>No baked special zone found.<br><small>Bake it with <span class='mono'>tools/prerender-zone.mjs --special</span>.</small>" })); return; }
      m.regions.forEach(rg => {
        const card = el("div.card");
        card.appendChild(el("div.sectitle", null, [el("h3", { text: rg.name })]));
        card.appendChild(el("div", { style: "overflow:auto;max-height:80vh;border-radius:10px;background:#0e1014" }, [
          el("img", { src: STUDIO_BASE + "assets/zones/" + rg.image, style: "display:block;max-width:100%;image-rendering:pixelated" }),
        ]));
        if (rg.note) card.appendChild(el("p.tagline", { style: "margin-top:.4rem", text: rg.note }));
        host.appendChild(card);
      });
    }).catch(() => { clear(host); host.appendChild(el("div.empty", { text: "Couldn't load the special zone." })); });
}

// ---- the rendered terrain map: pre-rendered from disk if available, else worker ----
function zoneMapCard(zx, zy) {
  const card = el("div.card");
  card.appendChild(el("div.sectitle", null, [el("h3", null, ["Zone map ", el("span.hint", { text: "the real terrain — biomes, roads, rivers, settlements" })])]));
  const status = el("small.tagline");
  const controls = el("div.btn-row", { style: "flex-wrap:wrap;align-items:center;gap:.6rem" });
  card.appendChild(controls);
  const bar = el("div", { style: "height:6px;background:var(--bg-2);border-radius:4px;overflow:hidden;margin:.5rem 0;display:none" });
  const fill = el("div", { style: "height:100%;width:0;background:var(--gold);transition:width .1s" });
  bar.appendChild(fill); card.appendChild(bar);

  // the whole map fits in this one frame by default; pinch/scroll to zoom in
  const viewport = el("div", { style: "overflow:auto;max-height:80vh;border-radius:10px;background:#0e1014" });
  const stage = el("div", { style: "position:relative;width:max-content" });
  const mapCv = el("canvas", { width: 16, height: 16, style: "display:block;image-rendering:pixelated" });
  // live higher-res detail rendered on zoom-in, painted over the base terrain
  const detailCv = el("canvas", { width: 16, height: 16, style: "position:absolute;left:0;top:0;image-rendering:pixelated;display:none;pointer-events:none" });
  // deep-zoom TILE view: real chunks drawn as ground tiles + object sprites, sized
  // to the viewport and re-drawn as you pan (kept separate from the macro detailCv)
  const tileCv = el("canvas", { width: 16, height: 16, style: "position:absolute;left:0;top:0;image-rendering:pixelated;display:none;pointer-events:none" });
  const overlay = el("canvas", { width: 16, height: 16, style: "position:absolute;left:0;top:0;pointer-events:none" });
  stage.appendChild(mapCv); stage.appendChild(detailCv); stage.appendChild(tileCv); stage.appendChild(overlay);
  viewport.appendChild(stage); card.appendChild(viewport);
  const legend = el("div.chips", { style: "margin-top:.5rem" });
  card.appendChild(legend);
  const note = el("p.tagline", { style: "margin-top:.4rem" });
  card.appendChild(note);
  const detailInfo = el("small.tagline", { style: "display:block;margin-top:.25rem;color:var(--gold)" });
  card.appendChild(detailInfo);

  const zoom = el("input", { type: "range", min: "0.02", max: "8", step: "0.01", value: "0.5", style: "width:180px" });
  let curZoom = 0.5, fitZ = 0.5, MAXZ = 8;
  let shireCities = null, shireBBox = null, selectedShire = null, _lastFeat = null, _shiresVisible = true;   // shire overlay state
  const SHIRE_VIS_MAX = 2.2;   // shires shown only near the overview zoom; hidden once you zoom into one
  const shiresVisibleNow = () => !!baseMeta && curZoom <= fitZ * SHIRE_VIS_MAX;
  const redrawOverlay = () => { if (baseMeta) drawOverlay(overlay, baseMeta, _lastFeat || {}, (shiresVisibleNow() && shireCities) ? shireCities : null, selectedShire); };
  const applyZoom = () => { const z = curZoom, w = mapCv.width * z, h = mapCv.height * z; stage.style.width = w + "px"; [mapCv, overlay].forEach(c => { c.style.width = w + "px"; c.style.height = h + "px"; }); positionDetail(); positionTiles(); };
  const setZoom = (z, fx, fy) => {
    z = Math.max(fitZ * 0.85, Math.min(MAXZ, z));
    const prev = curZoom; curZoom = z; zoom.value = String(z);
    if (fx != null) {   // keep the point under the cursor stable while zooming
      const r = viewport.getBoundingClientRect();
      const ix = (viewport.scrollLeft + fx - r.left) / prev, iy = (viewport.scrollTop + fy - r.top) / prev;
      applyZoom(); viewport.scrollLeft = ix * z - (fx - r.left); viewport.scrollTop = iy * z - (fy - r.top);
    } else applyZoom();
    const vis = shiresVisibleNow();
    if (vis !== _shiresVisible) { _shiresVisible = vis; redrawOverlay(); }   // hide shire overlay once zoomed into a shire
    scheduleDetail();
  };
  zoom.oninput = () => setZoom(parseFloat(zoom.value) || 1);
  // trackpad pinch = ctrl/⌘ + wheel; zoom about the cursor. Plain scroll pans.
  viewport.addEventListener("wheel", e => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); setZoom(curZoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY); }, { passive: false });
  viewport.addEventListener("scroll", () => scheduleDetail());
  const showLegend = () => { clear(legend); [["#8affc1", "settlement"], [ZMAP_PATH, "road"], [ZMAP_RIVER, "river"], ["#ffd479", "POI"]].forEach(([c, t]) => legend.appendChild(el("span.chip.sm", { html: "<span style='color:" + c + "'>●</span> " + t }))); if (shireCities) legend.appendChild(el("span.chip.sm", { html: "<span style='color:#cfe8ff'>▦</span> shire — double-click to zoom" })); };
  const fitZoom = () => {
    const vw = viewport.clientWidth || 900, vh = Math.min(760, (window.innerHeight || 900) * 0.72);
    fitZ = Math.max(0.02, Math.min(1, Math.min((vw - 8) / mapCv.width, vh / mapCv.height)));
    // Let zoom go deep enough that individual game tiles become legible (~TILE_TARGET
    // px/tile), bounded so the CSS-scaled base stage never gets absurdly large.
    const TILE_TARGET = 22, STAGE_CAP = 262144;
    const zTiles = baseMeta ? TILE_TARGET * 2 * baseMeta.step : 8;   // 1 tile = 0.5 map units
    MAXZ = Math.max(8, Math.min(zTiles, STAGE_CAP / mapCv.width));
    zoom.max = String(MAXZ);
    setZoom(fitZ);
  };

  // ---- shire overlays: Voronoi catchments of the city fountains; double-click a
  // shire on the map to zoom the viewer to it. Bounds are sampled once. ----
  function computeShireBBoxes(cities) {
    const bb = new Map();
    const half = ZONE_HALF, gx0 = zx * ZONE_T - half, gy0 = zy * ZONE_T - half, STEP = 100;
    for (let gy = gy0 + STEP / 2; gy < gy0 + ZONE_T; gy += STEP)
      for (let gx = gx0 + STEP / 2; gx < gx0 + ZONE_T; gx += STEP) {
        let best = null, bd = Infinity;
        for (const c of cities) { const dx = c.gx - gx, dy = c.gy - gy, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = c; } }
        if (!best) continue;
        let e = bb.get(best.name); if (!e) { e = { minGx: gx, maxGx: gx, minGy: gy, maxGy: gy }; bb.set(best.name, e); }
        else { if (gx < e.minGx) e.minGx = gx; if (gx > e.maxGx) e.maxGx = gx; if (gy < e.minGy) e.minGy = gy; if (gy > e.maxGy) e.maxGy = gy; }
      }
    return bb;
  }
  function shireAt(clientX, clientY) {
    if (!shireCities || !baseMeta) return null;
    const rect = mapCv.getBoundingClientRect();
    const imgX = (clientX - rect.left) * (mapCv.width / rect.width);
    const imgY = (clientY - rect.top) * (mapCv.height / rect.height);
    const mx = baseMeta.originMapX + imgX * baseMeta.step, my = baseMeta.originMapY + imgY * baseMeta.step;
    const gx = mx * 2, gy = my * 2;   // map units → game tiles (fountains are game tiles)
    let best = null, bd = Infinity;
    for (const c of shireCities) { const dx = c.gx - gx, dy = c.gy - gy, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = c; } }
    return best;
  }
  function zoomToShire(name) {
    const e = shireBBox && shireBBox.get(name); if (!e || !baseMeta) return;
    const [x0, y0] = _mapToPx(baseMeta, e.minGx / 2, e.minGy / 2);
    const [x1, y1] = _mapToPx(baseMeta, e.maxGx / 2, e.maxGy / 2);
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const vw = viewport.clientWidth || 900, vh = viewport.clientHeight || Math.min(760, (window.innerHeight || 900) * 0.72), pad = 1.18;
    const z = Math.max(fitZ * 0.85, Math.min(MAXZ, Math.min(vw / (w * pad), vh / (h * pad))));
    setZoom(z);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    viewport.scrollLeft = cx * z - vw / 2;
    viewport.scrollTop = cy * z - vh / 2;
  }
  viewport.addEventListener("dblclick", e => {
    const c = shireAt(e.clientX, e.clientY); if (!c) return;
    e.preventDefault();
    selectedShire = c.name;
    zoomToShire(c.name);   // zooming past the threshold makes setZoom hide the shire overlay
    status.textContent = "Focused on " + c.name + " shire.";
  });

  // ---- live detail-on-zoom: when magnified past the base resolution, a worker
  // renders the visible region at a finer step from the real procedural engine
  // and paints it crisply over the blown-up base terrain. ----
  let baseMeta = null;                 // {originMapX, originMapY, step, imgW, imgH}
  let dWorker = null, dReady = false, dToken = 0, dPending = null, dRegionMeta = null;
  const DETAIL_MPX = 64, DETAIL_MAX = 1280;   // hard cap on detail image px/side (worker cost)
  // ---- deep-zoom TILE view state (real chunks + game sprites) ----
  const TILE_MODE_MIN = 3;             // px/tile at which the baked tile layer takes over
  const DECOR_MIN_PX = 4;              // draw the numerous small decor only once tiles are this big (LOD)
  const CHUNK_T = 32;                  // world.CHUNK — game tiles per chunk side
  const DECOR_SCALE = 1.35, NODE_SCALE = 1.7;   // sprites overhang their tile a little
  let tileManifest = null, tileManifestTried = false;   // baked-tile manifest for this zone (or null)
  const chunkCache = new Map();        // "cx,cy" → decoded chunk payload
  const shardCache = new Map();        // "scx,scy" → true once its shard is loaded
  const shardReq = new Set();          // "scx,scy" fetch already in flight/done
  let tileTimer = null, tileRAF = 0;
  const tilePxNow = () => baseMeta ? (0.5 / baseMeta.step) * curZoom : 0;   // on-screen px per game tile
  // tile view needs the zone's baked chunk data (cold live-gen is far too slow)
  const inTileMode = () => !!baseMeta && !!tileManifest && tilePxNow() >= TILE_MODE_MIN;
  function ensureDetailWorker() {
    if (dWorker || typeof Worker === "undefined") return dWorker;
    try { dWorker = new Worker(STUDIO_BASE + "js/zone-worker.js"); } catch (_) { dWorker = null; return null; }
    dWorker.onmessage = e => {
      const m = e.data;
      if (m.ready) { dReady = true; if (dPending) { const f = dPending; dPending = null; f(); } return; }
      if (m.token !== dToken) return;   // the view moved — drop stale detail
      if (m.regionMeta) { dRegionMeta = m.regionMeta; detailCv.width = m.regionMeta.imgW; detailCv.height = m.regionMeta.imgH; detailCv._g = detailCv.getContext("2d"); positionDetail(); detailCv.style.display = ""; detailInfo.textContent = "Generating higher-resolution terrain from the engine…"; return; }
      if (m.regionTile && detailCv._g) { detailCv._g.putImageData(new ImageData(new Uint8ClampedArray(m.px), m.regionTile.MPX, m.regionTile.MPX), m.regionTile.ox, m.regionTile.oy); return; }
      if (m.regionDone && dRegionMeta) { detailInfo.textContent = "Live detail: " + dRegionMeta.step.toFixed(2) + " map-units/px (≈" + (baseMeta ? (baseMeta.step / dRegionMeta.step).toFixed(1) : "?") + "× the baked map), generated on the fly."; return; }
    };
    dWorker.postMessage({ type: "init", seed: 1337, landE: 0.483, rockE: 0.655, chunk: 32, vcell: 144, pcell: 30, icell: 44, gensig: "studio" });
    return dWorker;
  }
  function positionDetail() {
    if (!baseMeta || !dRegionMeta || detailCv.style.display === "none") return;
    const z = curZoom, s = baseMeta.step;
    detailCv.style.left = ((dRegionMeta.originMapX - baseMeta.originMapX) / s * z) + "px";
    detailCv.style.top = ((dRegionMeta.originMapY - baseMeta.originMapY) / s * z) + "px";
    detailCv.style.width = (dRegionMeta.imgW * dRegionMeta.step / s * z) + "px";
    detailCv.style.height = (dRegionMeta.imgH * dRegionMeta.step / s * z) + "px";
  }
  function requestDetail() {
    const w = ensureDetailWorker(); if (!w || !baseMeta) return;
    const z = curZoom;
    const bx0 = Math.max(0, viewport.scrollLeft / z), by0 = Math.max(0, viewport.scrollTop / z);
    const bx1 = Math.min(baseMeta.imgW, (viewport.scrollLeft + viewport.clientWidth) / z);
    const by1 = Math.min(baseMeta.imgH, (viewport.scrollTop + viewport.clientHeight) / z);
    if (bx1 <= bx0 || by1 <= by0) return;
    const mX0 = baseMeta.originMapX + bx0 * baseMeta.step, mY0 = baseMeta.originMapY + by0 * baseMeta.step;
    const mX1 = baseMeta.originMapX + bx1 * baseMeta.step, mY1 = baseMeta.originMapY + by1 * baseMeta.step;
    // Size the detail render to the visible region's on-screen pixels so it
    // sharpens the instant we upscale past the baked map. The old fixed 448px
    // cap sat below the viewport, so the cap term dominated and detail stayed
    // coarser than the baked map (→ skipped) until zoomed way in. Hard-capped
    // by DETAIL_MAX so huge viewports don't overload the worker.
    const target = Math.max(448, Math.min(DETAIL_MAX, Math.max(viewport.clientWidth || 900, viewport.clientHeight || 700)));
    let step = Math.max(baseMeta.step / z, Math.max(mX1 - mX0, mY1 - mY0) / target);
    if (step >= baseMeta.step - 1e-6) { detailCv.style.display = "none"; detailInfo.textContent = ""; return; }   // no finer than baked
    dToken++;
    const tok = dToken, fire = () => w.postMessage({ type: "region", token: tok, mapX0: mX0, mapY0: mY0, mapX1: mX1, mapY1: mY1, step, MPX: DETAIL_MPX, MAP_COLORS: ZMAP_COLORS, MAP_WATER: ZMAP_WATER });
    if (dReady) fire(); else dPending = fire;
  }
  let detailTimer = null;

  // ---- deep-zoom TILE view: draw REAL chunks (ground tiles + object sprites) ----
  // A second worker runs the game's actual getChunk(); we cache the chunks it
  // streams and paint them into tileCv, sized to the viewport and re-drawn as you
  // pan. Ground/objects use the game's own atlases via SprRender (providers-extra).
  const SPR_OK = typeof SprRender !== "undefined";
  const OBJ_OK = typeof ObjRender !== "undefined";
  // repaint the tile view whenever a sheet it needs finishes loading (ground lives
  // on sheet "b" + a few core tile sheets; objects on the packed object sheet)
  if (OBJ_OK) { ObjRender.onReady(() => scheduleRender()); ObjRender.sheet(); }
  if (SPR_OK && SprRender.sheetImg && typeof document !== "undefined") {
    ["b", "t", "c", "x", "m"].forEach(sh => { SprRender.sheetImg(sh, "low"); document.addEventListener("studio-sheet:" + sh, () => scheduleRender()); });
  }
  const tilesBase = STUDIO_BASE + "assets/zones/zone_" + zx + "_" + zy + "_tiles/";
  // Load the baked-tile manifest for this zone (if it exists). Its presence is
  // what enables the tile view — see inTileMode(). Baked by
  // studio/tools/prerender-zone-tiles.mjs.
  function loadTileManifest() {
    if (tileManifestTried) return; tileManifestTried = true;
    fetch(tilesBase + "manifest.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : null)
      .then(m => { tileManifest = m || null; if (m) scheduleDetail(); })   // re-evaluate: may now enter tile mode
      .catch(() => { tileManifest = null; });
  }
  // Decode one baked shard's chunks into the render-ready shape renderTiles()
  // consumes (identical to the live worker's output), keyed "cx,cy".
  function decodeShard(shard) {
    const CS = shard.chunkSize || 32;
    for (const key in shard.chunks) {
      const c = shard.chunks[key], [cx, cy] = c.c;
      const idx = new Uint16Array(CS * CS);   // expand run-length ground
      let p = 0; const runs = c.g.r;
      for (let i = 0; i < runs.length; i += 2) { const n = runs[i], v = runs[i + 1]; for (let k = 0; k < n; k++) idx[p++] = v; }
      chunkCache.set(key, {
        cx, cy, CS, bx: cx * CS, by: cy * CS, pal: c.g.p, _idx: idx,
        decor: c.d || [],
        nodes: (c.n || []).map(a => ({ x: a[0], y: a[1], spr: a[2], type: a[3] })),
        buildings: (c.b || []).map(a => ({ x0: a[0], y0: a[1], w: a[2], h: a[3], stone: !!a[4], roof: a[5] })),
        spawns: (c.s || []).map(a => ({ kind: a[0], x: a[1], y: a[2] })),
      });
    }
  }
  function visibleTileRect() {
    const z = curZoom, s = baseMeta.step, ox = baseMeta.originMapX, oy = baseMeta.originMapY;
    const sl = viewport.scrollLeft, st = viewport.scrollTop, cw = viewport.clientWidth, ch = viewport.clientHeight;
    const txAt = px => (ox + (px / z) * s) * 2, tyAt = px => (oy + (px / z) * s) * 2;   // 1 map unit = 2 tiles
    return { tx0: Math.floor(txAt(sl)) - 1, tx1: Math.ceil(txAt(sl + cw)) + 1, ty0: Math.floor(tyAt(st)) - 1, ty1: Math.ceil(tyAt(st + ch)) + 1 };
  }
  function positionTiles() {
    if (!inTileMode()) { tileCv.style.display = "none"; return; }
    tileCv.style.display = "";
    const cw = viewport.clientWidth, ch = viewport.clientHeight;
    tileCv.style.left = viewport.scrollLeft + "px"; tileCv.style.top = viewport.scrollTop + "px";
    tileCv.style.width = cw + "px"; tileCv.style.height = ch + "px";
    if (tileCv.width !== cw || tileCv.height !== ch) { tileCv.width = cw; tileCv.height = ch; }
    scheduleRender();
  }
  function scheduleRender() { if (tileRAF || typeof requestAnimationFrame === "undefined") return; tileRAF = requestAnimationFrame(() => { tileRAF = 0; renderTiles(); }); }
  function drawObj(g, key, wx, wy, tp, fallbackScale, sxOf, syOf, alt) {
    const cx = sxOf(wx) + tp / 2, footY = syOf(wy) + tp;   // anchor bottom-centre on the tile
    // real object art (trees/rocks/stations/props) from the packed objects sheet
    let r = OBJ_OK ? ObjRender.objForKey(key) : null;
    if (!r && alt && OBJ_OK) r = ObjRender.objForKey(alt);
    if (r) {
      const sz = tp * Math.max(0.7, Math.min(3, r.scale || fallbackScale));
      if (ObjRender.blitIdx(g, r.idx, Math.round(cx - sz / 2), Math.round(footY - sz), Math.ceil(sz), Math.ceil(sz))) return;
    }
    // some flat props (lily, tilled soil, stepstones) live in SPR instead
    if (SPR_OK) {
      const sz = tp * fallbackScale, dx = Math.round(cx - sz / 2), dy = Math.round(footY - sz), d = Math.ceil(sz);
      if (SprRender.blit(g, key, dx, dy, d, d)) return;
      if (alt && SprRender.blit(g, alt, dx, dy, d, d)) return;
    }
    g.fillStyle = "rgba(70,180,95,.7)"; g.beginPath(); g.arc(cx, syOf(wy) + tp / 2, Math.max(1.5, tp * 0.2), 0, 7); g.fill();
  }
  function renderTiles() {
    if (!baseMeta || !inTileMode()) return;
    const g = tileCv.getContext("2d"); g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, tileCv.width, tileCv.height);
    const z = curZoom, s = baseMeta.step, ox = baseMeta.originMapX, oy = baseMeta.originMapY;
    const sl = viewport.scrollLeft, st = viewport.scrollTop, tp = tilePxNow(), tsz = Math.ceil(tp) + 1;
    const rect = visibleTileRect();
    const sxOf = wx => (wx * 0.5 - ox) / s * z - sl, syOf = wy => (wy * 0.5 - oy) / s * z - st;
    const BGMM = (typeof BG_MM !== "undefined") ? BG_MM : null;
    const chunks = [...chunkCache.values()].filter(ch => !(ch.bx + ch.CS < rect.tx0 || ch.bx > rect.tx1 || ch.by + ch.CS < rect.ty0 || ch.by > rect.ty1));
    // pass 1 — ground tiles. Always draw the real tile sprite (with the minimap
    // biome colour as an under-fill for the sprite's transparent edges). The
    // ground never changes representation with zoom, so biome colours stay put.
    for (const ch of chunks) {
      const CS = ch.CS, idx = ch._idx, pal = ch.pal;
      for (let lz = 0; lz < CS; lz++) {
        const wy = ch.by + lz; if (wy < rect.ty0 || wy > rect.ty1) continue;
        const sy = Math.floor(syOf(wy));
        for (let lx = 0; lx < CS; lx++) {
          const wx = ch.bx + lx; if (wx < rect.tx0 || wx > rect.tx1) continue;
          const key = pal[idx[lz * CS + lx]]; if (!key) continue;
          const sx = Math.floor(sxOf(wx));
          const mm = BGMM && BGMM[key]; if (mm) { g.fillStyle = mm; g.fillRect(sx, sy, tsz, tsz); }
          if (SPR_OK) SprRender.blit(g, key, sx, sy, tsz, tsz);
        }
      }
    }
    // pass 2 — objects on top (building footprints, decor, nodes, creatures)
    for (const ch of chunks) {
      const CS = ch.CS;
      for (const b of ch.buildings) {
        const bx = Math.floor(sxOf(b.x0)), by = Math.floor(syOf(b.y0));
        g.fillStyle = b.stone ? "rgba(150,152,162,.22)" : "rgba(158,116,74,.22)";
        g.fillRect(bx, by, Math.ceil(b.w * tp), Math.ceil(b.h * tp));
      }
      for (const [li, dk] of ch.decor) {
        const wx = ch.bx + (li % CS), wy = ch.by + Math.floor(li / CS);
        if (wx < rect.tx0 - 2 || wx > rect.tx1 + 2 || wy < rect.ty0 - 2 || wy > rect.ty1 + 2) continue;
        const base = dk.split("#")[0];
        if (base.startsWith("wall_") || base.startsWith("tower_")) {   // walls are flat blocks in-game, not billboards
          const sx = Math.floor(sxOf(wx)), sy = Math.floor(syOf(wy)), d = Math.ceil(tp) + 1;
          g.fillStyle = base.indexOf("wood") >= 0 ? "#7a5a36" : base.indexOf("brick") >= 0 ? "#8a4b3a" : base.indexOf("plaster") >= 0 ? "#cabfa8" : "#8f9098";
          g.fillRect(sx, sy, d, d);
          continue;
        }
        if (tp < DECOR_MIN_PX) continue;   // LOD: skip the many small props until zoomed enough to see them
        drawObj(g, base, wx, wy, tp, DECOR_SCALE, sxOf, syOf);
      }
      for (const n of ch.nodes) {
        if (n.x < rect.tx0 - 2 || n.x > rect.tx1 + 2 || n.y < rect.ty0 - 2 || n.y > rect.ty1 + 2) continue;
        drawObj(g, n.spr, n.x, n.y, tp, NODE_SCALE, sxOf, syOf, n.type);
      }
      if (tp >= DECOR_MIN_PX) for (const sp of ch.spawns) {
        if (sp.x < rect.tx0 || sp.x > rect.tx1 || sp.y < rect.ty0 || sp.y > rect.ty1) continue;
        const cxp = sxOf(sp.x) + tp / 2, cyp = syOf(sp.y) + tp / 2;
        g.fillStyle = "rgba(255,92,92,.9)"; g.beginPath(); g.arc(cxp, cyp, Math.max(2, tp * 0.22), 0, 7); g.fill();
      }
    }
  }
  // Fetch the baked shards covering the visible chunks (each shard is
  // SHARD×SHARD chunks). Missing shards (partial bake) just leave gaps — the
  // blurry base map shows through until they're baked.
  function requestTiles() {
    if (!baseMeta || !tileManifest) return;
    const SH = tileManifest.shardChunks || 16;
    const rect = visibleTileRect();
    const sx0 = Math.floor(Math.floor(rect.tx0 / CHUNK_T) / SH), sx1 = Math.floor(Math.floor(rect.tx1 / CHUNK_T) / SH);
    const sy0 = Math.floor(Math.floor(rect.ty0 / CHUNK_T) / SH), sy1 = Math.floor(Math.floor(rect.ty1 / CHUNK_T) / SH);
    let loaded = 0, pending = 0;
    for (let scy = sy0; scy <= sy1; scy++) for (let scx = sx0; scx <= sx1; scx++) {
      const k = scx + "," + scy;
      if (shardCache.has(k)) { loaded++; continue; }
      if (shardReq.has(k)) { pending++; continue; }
      shardReq.add(k); pending++;
      fetch(tilesBase + "s_" + scx + "_" + scy + ".json", { cache: "force-cache" })
        .then(r => r.ok ? r.json() : null)
        .then(s => { if (s) { decodeShard(s); shardCache.set(k, true); } scheduleRender(); })
        .catch(() => {});
    }
    scheduleRender();
    detailInfo.textContent = pending ? "Tile view: loading baked terrain…" : "Tile view: real ground & objects (baked).";
  }

  function scheduleDetail() {
    clearTimeout(detailTimer); clearTimeout(tileTimer);
    if (!baseMeta) { detailCv.style.display = "none"; tileCv.style.display = "none"; detailInfo.textContent = ""; return; }
    if (inTileMode()) {                       // deep zoom → real tiles + objects
      dToken++; detailCv.style.display = "none";   // stop the macro layer
      overlay.style.display = "none";         // the CSS-scaled vector overlay is too blurry this deep
      positionTiles();                        // reposition + repaint cached chunks now
      tileTimer = setTimeout(requestTiles, 200);
      return;
    }
    overlay.style.display = "";
    tileCv.style.display = "none";            // mid/low zoom → macro terrain detail
    if (curZoom <= 1.05) { dToken++; detailCv.style.display = "none"; detailInfo.textContent = ""; return; }
    positionDetail();
    detailTimer = setTimeout(requestDetail, 400);
  }

  function paint(meta, feat, imgSrc, fromDisk) {
    const img = new Image();
    img.onload = () => {
      mapCv.width = meta.imgW; mapCv.height = meta.imgH;
      mapCv.getContext("2d").drawImage(img, 0, 0);
      overlay.width = meta.imgW; overlay.height = meta.imgH;
      _lastFeat = feat || {};
      baseMeta = meta;   // detail-on-zoom needs the base geometry (origin + step)
      _shiresVisible = shiresVisibleNow(); redrawOverlay();
      fitZoom(); showLegend();
      status.textContent = (fromDisk ? "Loaded from storage" : "Rendered") + " — " + meta.imgW + "×" + meta.imgH + "px" + (fromDisk && meta.builtAt ? " (baked " + meta.builtAt + ")" : "") + ". Zoom in for higher-res detail" + (tileManifest ? "; keep zooming for real tiles & objects." : ".");
    };
    img.onerror = () => { status.textContent = "Stored map image missing."; showGenerateUI(); };
    img.src = imgSrc;
  }

  // worker fallback UI (only used when there's no pre-rendered map on disk)
  function showGenerateUI() {
    clear(controls);
    if (typeof Worker === "undefined") { note.textContent = "No pre-rendered map on disk, and live rendering needs Web Workers (unavailable here)."; return; }
    const detailSel = el("select");
    Object.keys(DETAILS).forEach(k => detailSel.appendChild(el("option", { value: k, text: DETAILS[k].label })));
    const genBtn = el("button.btn.sm.primary", { text: "Generate terrain map" });
    controls.appendChild(el("label.field", { style: "margin:0" }, [el("span", { text: "Detail" }), detailSel]));
    controls.appendChild(genBtn);
    controls.appendChild(el("label.field", { style: "margin:0" }, [el("span", { text: "Zoom" }), zoom]));
    controls.appendChild(status);
    note.textContent = "No pre-rendered map on disk for this zone — generating it live (the game's real world engine, off-thread). Bake it to disk with tools/prerender-zone.mjs for instant loads.";
    genBtn.onclick = () => {
      const detail = detailSel.value, ckey = zx + "," + zy + "," + detail;
      if (_zoneCache.has(ckey)) { const c = _zoneCache.get(ckey); paint(c.meta, c.feat, c.url, false); return; }
      genBtn.disabled = true; bar.style.display = "block"; fill.style.width = "0"; status.textContent = "Starting world engine…";
      renderZoneMap(zx, zy, detail, mapCv, overlay, {
        onMeta: m => { baseMeta = m; }, onProgress: (i, n) => { fill.style.width = Math.round(i / n * 100) + "%"; status.textContent = "Terrain " + i + "/" + n + " tiles…"; },
        onPhase: p => { if (p === "features") status.textContent = "Placing settlements, roads & rivers…"; },
        onDone: (meta, feat) => { bar.style.display = "none"; genBtn.disabled = false; baseMeta = meta; fitZoom(); showLegend(); status.textContent = "Rendered " + meta.imgW + "×" + meta.imgH + "px. Zoom in for live higher-res detail."; try { _zoneCache.set(ckey, { url: mapCv.toDataURL("image/png"), meta, feat }); } catch (_) {} },
        onError: msg => { bar.style.display = "none"; genBtn.disabled = false; status.textContent = "Render failed: " + msg; },
      });
    };
  }

  // try the pre-rendered map on disk first
  controls.appendChild(el("label.field", { style: "margin:0" }, [el("span", { text: "Zoom" }), zoom]));
  controls.appendChild(status);
  status.textContent = "Checking storage…";
  loadTileManifest();   // enable the deep-zoom tile view if this zone has baked chunk data
  fetch(STUDIO_BASE + "assets/zones/zone_" + zx + "_" + zy + ".json", { cache: "force-cache" })
    .then(r => r.ok ? r.json() : null).then(m => {
      if (m && m.cities && m.cities.length) { shireCities = m.cities; try { shireBBox = computeShireBBoxes(shireCities); } catch (_) {} }
      if (m && m.meta && m.meta.image) { note.textContent = "Loaded from pre-rendered storage. Double-click a shire to zoom to it."; paint(m.meta, m.feat, STUDIO_BASE + "assets/zones/" + m.meta.image, true); }
      else showGenerateUI();
    }).catch(() => showGenerateUI());
  return card;
}

// orchestrate the worker: stream terrain tiles into mapCv, then draw feature overlay
function renderZoneMap(zx, zy, detail, mapCv, overlay, cb) {
  let worker;
  try { worker = new Worker(STUDIO_BASE + "js/zone-worker.js"); } catch (e) { cb.onError && cb.onError(String(e)); return; }
  const feat = { villages: [], pois: [], icons: [], rivers: [], roads: [] };
  let meta = null, mctx = null;
  worker.onmessage = e => {
    const d = e.data;
    if (d.ready) { worker.postMessage({ type: "render", zx, zy, step: DETAILS[detail].step, MPX: 64, zoneTiles: ZONE_T, seed: 1337, landE: 0.483, rockE: 0.655, chunk: 32, vcell: 144, pcell: 30, icell: 44, gensig: "studio", MAP_COLORS: ZMAP_COLORS, MAP_WATER: ZMAP_WATER }); return; }
    if (d.meta) { meta = d.meta; mapCv.width = meta.imgW; mapCv.height = meta.imgH; mctx = mapCv.getContext("2d"); overlay.width = meta.imgW; overlay.height = meta.imgH; cb.onMeta && cb.onMeta(meta); return; }
    if (d.macro && mctx) { const arr = new Uint8ClampedArray(d.px); mctx.putImageData(new ImageData(arr, d.macro.MPX, d.macro.MPX), d.macro.ox, d.macro.oy); cb.onProgress && cb.onProgress(d.i, d.n); return; }
    if (d.phase) { cb.onPhase && cb.onPhase(d.phase); return; }
    ["villages", "pois", "icons", "rivers", "roads"].forEach(k => { if (d[k]) { feat[k] = d[k]; if (meta) drawOverlay(overlay, meta, feat); } });
    if (d.done) { if (meta) drawOverlay(overlay, meta, feat); cb.onDone && cb.onDone(meta, feat); worker.terminate(); }
    if (d.error) { cb.onError && cb.onError(d.error); worker.terminate(); }
  };
  worker.onerror = err => { cb.onError && cb.onError(err.message || "worker error"); try { worker.terminate(); } catch (_) {} };
  worker.postMessage({ type: "init", seed: 1337, landE: 0.483, rockE: 0.655, chunk: 32, vcell: 144, pcell: 30, icell: 44, gensig: "studio" });
}

// map a feature MAP coord to an image pixel. Villages/POIs/roads/rivers are all
// in the game's MAP coordinate system (the same one macroPixels samples with
// elevation()), so it's a straight (coord − origin) / step — NO tile halving.
function _mapToPx(meta, mx, my) {
  return [(mx - meta.originMapX) / meta.step, (my - meta.originMapY) / meta.step];
}
// four-colour palette (h,s,l) + a graph 4-colouring so no two adjacent shires
// share a colour (planar map ⇒ 4 always suffice; backtracking finds it).
const SHIRE_PALETTE = [[210, 68, 52], [34, 82, 55], [145, 52, 46], [292, 50, 58]];
function fourColorGraph(adj) {
  const N = adj.length, order = [...Array(N).keys()].sort((a, b) => adj[b].size - adj[a].size), color = new Array(N).fill(-1);
  const ok = (node, c) => { for (const nb of adj[node]) if (color[nb] === c) return false; return true; };
  const solve = k => { if (k === N) return true; const node = order[k]; for (let c = 0; c < 4; c++) { if (ok(node, c)) { color[node] = c; if (solve(k + 1)) return true; color[node] = -1; } } return false; };
  if (!solve(0)) { color.fill(-1); for (const node of order) { const used = new Set(); for (const nb of adj[node]) if (color[nb] >= 0) used.add(color[nb]); let c = 0; while (used.has(c)) c++; color[node] = c; } }
  return color;
}
// translucent Voronoi shire cells + boundaries + a big centred shire name, all
// drawn UNDER the features (so seat labels stay readable on top). One coarse
// Voronoi rasterisation gives the fills, the boundaries and each shire's pixel
// centroid + extent for sizing the label.
function drawShireCells(ctx, meta, cities, selected) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const F = cities.map(c => { const [px, py] = _mapToPx(meta, c.gx / 2, c.gy / 2); return { name: c.name, px, py, sx: 0, sy: 0, n: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }; });
  const STEP = Math.max(6, Math.round(Math.min(W, H) / 260));
  const cols = Math.ceil(W / STEP), rows = Math.ceil(H / STEP);
  const idx = new Int16Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) {
    const x = cc * STEP + STEP / 2, y = r * STEP + STEP / 2; let bi = -1, bd = Infinity;
    for (let i = 0; i < F.length; i++) { const dx = F[i].px - x, dy = F[i].py - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i; } }
    idx[r * cols + cc] = bi;
    const f = F[bi]; f.sx += x; f.sy += y; f.n++; if (x < f.x0) f.x0 = x; if (x > f.x1) f.x1 = x; if (y < f.y0) f.y0 = y; if (y > f.y1) f.y1 = y;
  }
  // shire adjacency (cells that touch) → 4-colour so neighbours differ
  const adj = F.map(() => new Set());
  for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) {
    const i = idx[r * cols + cc]; if (i < 0) continue;
    if (cc + 1 < cols) { const j = idx[r * cols + cc + 1]; if (j >= 0 && j !== i) { adj[i].add(j); adj[j].add(i); } }
    if (r + 1 < rows) { const j = idx[(r + 1) * cols + cc]; if (j >= 0 && j !== i) { adj[i].add(j); adj[j].add(i); } }
  }
  const shireColor = fourColorGraph(adj);
  for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) {
    const i = idx[r * cols + cc]; if (i < 0) continue;
    const sel = selected && F[i].name === selected;
    const p = SHIRE_PALETTE[shireColor[i] % SHIRE_PALETTE.length];
    ctx.fillStyle = "hsla(" + p[0] + "," + p[1] + "%," + p[2] + "%," + (sel ? 0.48 : 0.22) + ")";
    ctx.fillRect(cc * STEP, r * STEP, STEP, STEP);
  }
  ctx.lineWidth = Math.max(1, 1 / meta.step * 3); ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.beginPath();
  for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) {
    const i = idx[r * cols + cc];
    if (cc + 1 < cols && idx[r * cols + cc + 1] !== i) { const x = (cc + 1) * STEP; ctx.moveTo(x, r * STEP); ctx.lineTo(x, (r + 1) * STEP); }
    if (r + 1 < rows && idx[(r + 1) * cols + cc] !== i) { const y = (r + 1) * STEP; ctx.moveTo(cc * STEP, y); ctx.lineTo((cc + 1) * STEP, y); }
  }
  ctx.stroke();
  // huge shire name filling most of the cell, centred on its pixel centroid
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const f of F) {
    if (!f.n) continue;
    const cx = f.sx / f.n, cy = f.sy / f.n, w = Math.max(1, f.x1 - f.x0), h = Math.max(1, f.y1 - f.y0);
    const sel = selected && f.name === selected;
    const fs = 73;   // uniform shire label size
    ctx.font = "800 " + fs + "px system-ui";
    ctx.lineWidth = Math.max(1.5, fs / 14); ctx.strokeStyle = "#0b0d10";
    ctx.fillStyle = sel ? "#fff2c8" : "#ffffff";
    ctx.strokeText(f.name, cx, cy); ctx.fillText(f.name, cx, cy);
  }
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";   // restore for feature labels
}
function drawOverlay(cv, meta, feat, cities, selectedShire) {
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (cities && cities.length) drawShireCells(ctx, meta, cities, selectedShire);   // shire regions + names under the features
  ctx.lineWidth = Math.max(1, 1 / meta.step * 6);
  // rivers then roads (lines)
  const line = (pts, color, w) => { if (!pts || pts.length < 2) return; ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); for (let i = 0; i < pts.length; i++) { const [px, py] = _mapToPx(meta, pts[i][0], pts[i][1]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); } ctx.stroke(); };
  (feat.rivers || []).forEach(rv => (rv.polys || []).forEach(poly => line(poly, ZMAP_RIVER, 1.6)));
  (feat.roads || []).forEach(rd => line(rd.pts, ZMAP_PATH, 1.4));
  // POIs (small gold dots)
  ctx.font = "9px system-ui";
  (feat.pois || []).forEach(p => { const [px, py] = _mapToPx(meta, p.x, p.y); ctx.fillStyle = "#ffd479"; ctx.beginPath(); ctx.arc(px, py, 2, 0, 7); ctx.fill(); });
  // settlements (dot + label) — draw last so labels sit on top
  (feat.villages || []).forEach(v => {
    const [px, py] = _mapToPx(meta, v.x, v.y);
    const big = v.kind === "city";
    ctx.fillStyle = "#8affc1"; ctx.beginPath(); ctx.arc(px, py, big ? 4 : 2.6, 0, 7); ctx.fill();
    if (v.name) { ctx.font = (big ? "bold 11px" : "10px") + " system-ui"; ctx.fillStyle = "#0b0d10"; ctx.fillText(v.name, px + 6.6, py + 3.6); ctx.fillStyle = "#eafff2"; ctx.fillText(v.name, px + 6, py + 3); }
  });
}

// ---- NPCs: every NPC that populates the zone ----
function npcThumb(mixIdx, size) {
  size = size || 64;
  const thumb = el("div.thumb", { style: "width:" + size + "px;height:" + size + "px;flex:none" });
  const cv = el("canvas", { width: size, height: size }); thumb.appendChild(cv);
  try { const raw = (typeof MIX_NPCS !== "undefined" && MIX_NPCS.list) ? MIX_NPCS.list[mixIdx] : null; if (raw) Roster.drawNpc(cv, raw, 0); else clear(thumb); } catch (_) { clear(thumb); }
  return thumb;
}
// The NPC's single display name with the "of <City>" origin suffix stripped
// (curated singletons like "Basil the Registrar" keep their whole name).
function npcBaseName(n) {
  const city = n.city || "";
  const suf = " of " + city;
  return (city && n.name.endsWith(suf)) ? n.name.slice(0, -suf.length) : n.name;
}
// The NPC's raw roster character (for the sprite / a link to its detail page).
function npcRaw(n) {
  return (n.mixIndex >= 0 && typeof MIX_NPCS !== "undefined" && MIX_NPCS.list) ? MIX_NPCS.list[n.mixIndex] : null;
}
// The NPC's canonical id: "<sprite id>$<shire lowercased>$<zx>.<zy>". The sprite
// id is the dotted "<body>.<garb>" id shown at the top of the character page
// (Roster's entry.snake), NOT the long source-art key. e.g. Kwame of Snakantharop
// (sprite ondine.jabir) in zone 0,0 → ondine.jabir$snakantharop$0.0
function npcSpriteId(n) {
  const raw = npcRaw(n);
  if (!raw) return "npc" + n.mixIndex;
  const ent = (typeof Roster !== "undefined" && Roster.charEntry) ? Roster.charEntry(raw.key) : null;
  return (ent && ent.snake) || raw.key;
}
function npcId(n, zone) {
  const shire = String(n.city || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const z = String(zone || "0,0").trim().replace(/\s*,\s*/, ".");
  return npcSpriteId(n) + "$" + shire + "$" + z;
}
// A tile for one baked, zone-generated NPC: its real spawn character, single
// (deduped) name, role/title, and ZONE-LOCAL spawn coordinates.
function npcZoneTile(n) {
  // home settlement shown only when it differs from the NPC's city (villagers
  // are bound to their nearest city fountain, but live in an outlying village)
  const where = (n.settlement && n.settlement !== n.city) ? "  ·  " + n.settlement : "";
  const sub = (n.title || n.role || "NPC") + "  ·  (" + n.lx + ", " + n.ly + ")" + where;
  const raw = (n.mixIndex >= 0 && typeof MIX_NPCS !== "undefined" && MIX_NPCS.list) ? MIX_NPCS.list[n.mixIndex] : null;
  return el("a.tile", raw ? { href: "#/detail?type=character&key=" + encodeURIComponent(raw.key) } : null, [
    npcThumb(n.mixIndex),
    el("div.meta", null, [el("div.name", { text: n.name }), el("div.sub", { text: sub })]),
  ]);
}
// ---- Cities: each city fountain as a collapsible dossier of everything bound
//      to it — NPCs, quests, stations, monsters, POIs, towns & villages. ----
// ---- vote glue: one ballot state per zone (subject gen:zone:<zx>,<zy>) --------
function zvote(state, field, opts) {
  return VoteWidget.symbol(Object.assign({ kind: "zone", folder: state.folder, field, getTallies: () => state.tallies, refetch: state.refetch }, opts));
}
// keep/remove votes in the main-page tables render as inline buttons (the 🗳
// glyph is reserved for individual/detail pages). Same ballot as zvote().
function zvoteButtons(state, field, opts) {
  return VoteWidget.buttons(Object.assign({ kind: "zone", folder: state.folder, field, getTallies: () => state.tallies, refetch: state.refetch, register: fn => (state.cells || (state.cells = [])).push(fn) }, opts));
}
// a table with rows that can expand a detail (locations) row beneath them
function ztable(cols, rows) {
  const wrap = el("div", { style: "overflow-x:auto;margin:.2rem 0 .6rem" });
  const t = el("table.ztable", { style: "width:100%;border-collapse:collapse;font-size:.82rem" });
  const htr = el("tr");
  // a column may be a plain label/node, or a spec { label, nofilter, skip, text }
  // — the flags map to the TableFilter data-tf-* header attributes.
  cols.forEach(c => {
    const attrs = { style: "text-align:left;padding:.35rem .55rem;border-bottom:1px solid var(--line,#2a2f3a);color:var(--ink-dim);white-space:nowrap" };
    let label = c;
    if (c && typeof c === "object" && c.nodeType == null && !Array.isArray(c)) {
      if (c.nofilter) attrs["data-tf-nofilter"] = "";
      if (c.skip) attrs["data-tf-skip"] = "";
      if (c.text) attrs["data-tf-text"] = "";
      label = c.label != null ? c.label : "";
    }
    htr.appendChild(el("th", attrs, [].concat(label)));
  });
  t.appendChild(el("thead", null, [htr]));
  const tb = el("tbody");
  rows.forEach(r => {
    const tr = el("tr");
    r.cells.forEach(c => tr.appendChild(el("td", { style: "padding:.3rem .55rem;border-bottom:1px solid var(--line,#20242c);vertical-align:top" }, [].concat(c))));
    tb.appendChild(tr);
    if (r.detail) {
      const dtr = el("tr", { style: "display:none" });
      dtr.appendChild(el("td", { colSpan: cols.length, style: "padding:.15rem .9rem .55rem;background:rgba(0,0,0,.14)" }, [r.detail]));
      tb.appendChild(dtr);
      if (r.toggle) r.toggle._dtr = dtr;
    }
  });
  t.appendChild(tb); wrap.appendChild(t);
  TableFilter.enhance(t);
  return wrap;
}
// a "N ▸" button that expands its table detail row, listing each instance's
// coordinates (+ biome/settlement) with a keep/remove vote, plus an add-instance vote.
function locationsCell(state, instances, o) {
  o = o || {};
  const btn = el("button.btn.sm.ghost", { type: "button", text: instances.length + " ▸" });
  btn.onclick = () => { const d = btn._dtr; if (!d) return; const show = d.style.display === "none"; d.style.display = show ? "" : "none"; btn.textContent = instances.length + (show ? " ▾" : " ▸"); };
  const detail = el("div", { style: "display:flex;flex-direction:column;gap:.15rem" });
  instances.forEach(inst => detail.appendChild(el("div", { style: "display:flex;align-items:center;gap:.45rem;flex-wrap:wrap" }, [
    (inst.main ? el("span", { text: "★", title: "main branch" }) : null),
    el("span.mono", { text: "(" + inst.lx + ", " + inst.ly + ")" }),
    inst.biome ? el("span.hint", { text: inst.biome }) : (inst.settlement ? el("span.hint", { text: inst.settlement }) : null),
    o.rmField ? zvoteButtons(state, o.rmField(inst), { label: "this instance" }) : null,
  ])));
  if (o.addField) detail.appendChild(el("div", { style: "margin-top:.3rem;display:flex;align-items:center;gap:.4rem" }, [
    el("span.hint", { text: "propose a new instance (x, y):" }),
    zvote(state, o.addField, { type: "string", placeholder: "lx, ly", label: "add an instance" }),
  ]));
  return { cell: btn, detail, toggle: btn };
}
// each table/list lives in its own collapsed sub-section within the shire
function tableSection(title, node) {
  const d = el("details", { style: "border:1px solid var(--line,#20242c);border-radius:8px;margin:.35rem 0;padding:0 .6rem;background:rgba(255,255,255,.02)" });
  d.appendChild(el("summary", { style: "cursor:pointer;padding:.4rem .1rem;font-size:.85rem;font-weight:600;list-style:revert", text: title }));
  d.appendChild(el("div", { style: "padding:.1rem 0 .5rem" }, [node]));
  return d;
}

// ---- shire-table icons: a small sprite thumbnail beside a name -------------
const ZTBL_ICON = "width:26px;height:26px;image-rendering:pixelated;flex:0 0 auto";
function zSprIcon(sprKey) {
  const cv = el("canvas", { width: 48, height: 48, style: ZTBL_ICON });
  if (sprKey && typeof SPR !== "undefined" && SPR[sprKey] && typeof SprRender !== "undefined") {
    try { SprRender.drawKeys(cv, [sprKey], cv.width, false); } catch (_) {}
  }
  return cv;
}
// a name cell = sprite icon + label (a null key just yields a blank icon slot).
function zIconName(sprKey, label) {
  return el("div", { style: "display:flex;align-items:center;gap:.5rem" }, [zSprIcon(sprKey), el("span", { text: label })]);
}
// v1 ground-tile sprite for a biome CODE (via the B enum → bg_<id>_0).
function zBiomeTileKey(code) {
  const id = (typeof B !== "undefined" && B[code] != null) ? B[code] : null;
  return id != null ? "bg_" + id + "_0" : null;
}
// map icon a crafting station uses (STATION_ICON, mirrored by defaultMapIcon).
function zStationIconKey(key) {
  const name = (typeof defaultMapIcon === "function" && defaultMapIcon("object", key)) || key;
  return "i_mapicon_" + name;
}
// POIs are drawn in-game as procedural glyphs, so most landmark types have no
// dedicated map-icon art — this maps each to the closest existing map icon so
// every POI still shows one (best-fit; tweak freely).
const POI_MAP_ICON = {
  apiary: "garden", arena: "swordshop", banditcamp: "camp", barrow: "altar", battlefield: "swordshop",
  beacon: "range", campsite: "camp", crater: "mine", fairyring: "altar", farmstead: "seedsman",
  fishvillage: "fishmonger", gallows: "quest", garden: "garden", geyser: "water", graveyard: "altar",
  guild: "store", hermitage: "altar", hotspring: "water", huntercamp: "camp", inn: "foodshop",
  lighthouse: "water", lumbercamp: "woodcutter", manor: "store", maze: "quest", minecamp: "mining",
  obelisk: "altar", observatory: "magicshop", orchard: "orchard", pond: "water", portal: "magicshop",
  ruins: "quest", runecircle: "altar", shack: "store", shipwreck: "water", shrine: "altar",
  standing: "altar", statue: "altar", stonecircle: "altar", tarpit: "mine", totem: "altar",
  vineyard: "garden", watchtower: "store", watermill: "windmill", windmill: "windmill",
  wishingwell: "water", wizardtower: "magicshop",
};
function zPoiIconKey(type) {
  const name = POI_MAP_ICON[type] || ((typeof SPR !== "undefined" && SPR["i_mapicon_" + type]) ? type : "quest");
  return "i_mapicon_" + name;
}

// ---- the per-shire tables (Monsters intentionally omitted) ----
function banksTable(state, cityName, banks) {
  const F = "bank:" + cityName + ":";
  const rows = banks.map(b => {
    const loc = locationsCell(state, b.branches, { rmField: inst => F + b.company + ":rm:" + inst.lx + "," + inst.ly, addField: F + b.company + ":add" });
    return {
      cells: [b.company,
        String(b.count),
        b.mainBranch ? b.mainBranch.name + " (" + b.mainBranch.lx + ", " + b.mainBranch.ly + ")" : el("span.hint", { text: "co-op (none)" }),
        loc.cell],
      detail: loc.detail, toggle: loc.toggle,
    };
  });
  return tableSection("Banks (" + banks.reduce((s, b) => s + b.count, 0) + " across " + banks.length + " compan" + (banks.length === 1 ? "y" : "ies") + ")",
    ztable(["company", "banks", "main branch", "locations"], rows));
}
function stationsTable(state, cityName, stations) {
  const F = "station:" + cityName + ":";
  const rows = stations.map(s => {
    const loc = locationsCell(state, s.instances || [], { rmField: inst => F + s.key + ":rm:" + inst.lx + "," + inst.ly, addField: F + s.key + ":add" });
    return {
      cells: [zIconName(zStationIconKey(s.key), s.name),
        String(s.count), loc.cell],
      detail: loc.detail, toggle: loc.toggle,
    };
  });
  return tableSection("Stations (" + stations.length + " kinds, " + stations.reduce((s, x) => s + x.count, 0) + ")",
    ztable(["station", "count", "locations"], rows));
}
function poisTable(state, cityName, pois) {
  const byType = new Map();
  pois.forEach(p => { const k = p.type || "poi"; if (!byType.has(k)) byType.set(k, []); byType.get(k).push(p); });
  const F = "poi:" + cityName + ":";
  const rows = [...byType.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([type, list]) => {
    const loc = locationsCell(state, list.map(p => ({ lx: p.lx, ly: p.ly, settlement: p.name || "" })), { rmField: inst => F + type + ":rm:" + inst.lx + "," + inst.ly, addField: F + type + ":add" });
    return {
      cells: [zIconName(zPoiIconKey(type), type),
        String(list.length), loc.cell],
      detail: loc.detail, toggle: loc.toggle,
    };
  });
  return tableSection("POIs (" + byType.size + " types, " + pois.length + ")", ztable(["POI", "quantity", "locations"], rows));
}
function townsTable(state, cityName, setls) {
  const F = "town:" + cityName + ":";
  const rows = setls.slice().sort((a, b) => (b.seat ? 1 : 0) - (a.seat ? 1 : 0) || (a.kind === "city" ? -1 : 1) - (b.kind === "city" ? -1 : 1) || a.ly - b.ly).map(s => ({
    cells: [[(s.seat ? "★ " : "") + s.name + " ", zvoteButtons(state, F + s.name + ":keep", { label: s.name })],
      s.seat ? "city · shire seat" : s.kind, el("span.mono", { text: "(" + s.lx + ", " + s.ly + ")" })],
  }));
  rows.push({ cells: [el("span.hint", { text: "propose a new settlement" }), "", zvote(state, F + "add", { type: "string", placeholder: "name @ lx,ly", label: "add a settlement" })] });
  return tableSection("Cities, Towns, Villages (" + setls.length + ")", ztable(["settlement", "kind", "location"], rows));
}
// the per-shire NPC table: each NPC's sprite + single name (origin suffix
// stripped), zone-local coordinates, whether it's a shopkeeper / a quest start,
// and the settlement it lives in.
function npcsTable(state, cityName, npcs) {
  const rows = npcs.slice().sort((a, b) => a.ly - b.ly || a.lx - b.lx).map(n => {
    const isShop = n.role === "shopkeeper";
    const isQuest = n.role === "quest-giver" || n.role === "quest-anchor";
    const href = "#/npc?zone=" + encodeURIComponent(state.folder) + "&at=" + n.lx + "," + n.ly + "&id=" + encodeURIComponent(npcId(n, state.folder));
    const nameCell = el("div", { style: "display:flex;align-items:center;gap:.5rem" }, [
      el("a", { href, title: n.name, style: "flex:none;line-height:0" }, [npcThumb(n.mixIndex, 40)]),
      el("a", { href, style: "color:var(--gold);text-decoration:none;font-weight:600", text: npcBaseName(n) }),
    ]);
    return {
      cells: [
        nameCell,
        el("span.mono", { text: "(" + n.lx + ", " + n.ly + ")" }),
        String(isShop).toUpperCase(),
        String(isQuest).toUpperCase(),
        n.settlement || el("span.hint", { text: "—" }),
      ],
    };
  });
  return tableSection("NPCs (" + npcs.length + ")",
    ztable(["NPC", "coordinates", "shopkeeper", "quest start", "location"], rows));
}
// biome code → real display name (mirrors js/providers-extra.js BIOME_LABEL).
const ZBIOME_LABEL = { DEEP: "Deep Sea", WATER: "Sea", REEF: "Coral Reef", SAND: "Beach", GRASS: "Plains", FOREST: "Forest", SWAMP: "Swamp", DESERT: "Desert", ROCK: "Mountains", SNOW: "Snowy Peaks", TUNDRA: "Taiga", FARM: "Farmland", BADLANDS: "Badlands", JUNGLE: "Jungle", MEADOW: "Meadow", SAVANNA: "Savanna", ROCKY: "Rockyland", LABYRINTH: "Labyrinth", VOLCANO: "Volcano", WILD: "Wilderness", TAIGA: "Taiga", OASIS: "Oasis", RUINSB: "Ruins", SALT: "Salt Flats", WETLAND: "Wetlands", CANYON: "Canyon", STEPPE: "Steppe", REDDESERT: "Red Desert", MUSHROOM: "Giant Mushroom Forest", BONE: "Bone Fields", DREAM: "Dream Forest", ASH: "Ashen Forest", MOOR: "Heather Moor", GLACIER: "Glacier", BAMBOO: "Bamboo Grove", CHERRY: "Blossom Grove", CRYSTAL: "Crystal Fields" };
const zbiomeLabel = code => ZBIOME_LABEL[code] || String(code).replace(/^biome /, "biome ").replace(/\b\w/g, m => m.toUpperCase());
// the per-shire biome table: how many tiles of each biome the shire covers.
function biomesTable(cityName, biomes, areaTiles) {
  const entries = Object.entries(biomes || {}).sort((a, b) => b[1] - a[1]);
  const total = areaTiles || entries.reduce((s, [, v]) => s + v, 0);
  const rows = entries.map(([code, tiles]) => ({
    cells: [zIconName(zBiomeTileKey(code), zbiomeLabel(code)), el("span.mono", { text: code }),
      tiles.toLocaleString(), total ? (tiles / total * 100).toFixed(1) + "%" : "—"],
  }));
  return tableSection("Biomes (" + entries.length + ")", ztable(["biome", "code", "tiles", "share"], rows));
}
// a clickable quest-name link to the Quests tab (dash if no quest id)
function questNameLink(id, name) {
  if (!id) return el("span.hint", { text: "—" });
  const qid = String(id).replace(/^quests\//, "");
  return el("a", { href: "#/quests?id=" + encodeURIComponent(qid), style: "color:var(--gold);text-decoration:none;font-weight:600", text: name });
}
function questsTable(state, cityName, quests, Q, isOrigin, cityIsNewhaven) {
  const F = "quest:" + cityName + ":";
  const byGiver = (Q && Q.byGiver) || new Map();
  const rows = quests.slice().sort((a, b) => a.ly - b.ly || a.lx - b.lx).map(q => {
    // the canonical quest (authored or generated) for this giver — from allQuests.
    // The QuestScript source lives on the quest's own page (click the name) —
    // it's no longer expanded inline here.
    const q2 = byGiver.get(q.gx + "," + q.gy);
    return { cells: [questNameLink(q2 && q2.id, q2 ? q2.name : "—"), [q.name + " ", zvoteButtons(state, F + q.name + ":keep", { label: q.name })],
      el("span.mono", { text: "(" + q.lx + ", " + q.ly + ")" })] };
  });
  const qlocQuest = Q && Q.list && Q.list.find(x => x.kind === "objects");
  if (isOrigin && cityIsNewhaven && typeof QUEST_LOCS !== "undefined")
    QUEST_LOCS.forEach(o => rows.push({ cells: [questNameLink(qlocQuest && qlocQuest.id, qlocQuest ? qlocQuest.name : "Quest Objects"), o.script.replace(/^qloc_/, "") + " (object)", el("span.mono", { text: "(" + (o.x + ZONE_HALF) + ", " + (o.y + ZONE_HALF) + ")" })] }));
  rows.push({ cells: ["", el("span.hint", { text: "propose a new quest" }), zvote(state, F + "add", { type: "string", placeholder: "name @ lx,ly", label: "add a quest" })] });
  return tableSection("Quests (" + quests.length + ")", ztable(["quest name", "quest start", "location"], rows));
}

// the expanded contents for one shire — the meta + all its data tables.
function cityBody(c, state, isOrigin, Q) {
  const d = c.d || {};
  const quests = c.npcs.filter(n => n.role === "quest-giver" || n.role === "quest-anchor");
  const stations = d.stations || [], banks = d.banks || [], pois = d.pois || [], setls = d.settlements || [];
  const body = el("div", { style: "padding:.2rem 0 .7rem" });
  const meta = el("dl.kv", { style: "margin:.2rem 0 .5rem" });
  const kv = (k, v) => { meta.appendChild(el("dt", { text: k })); meta.appendChild(el("dd", { text: v })); };
  if (d.lx != null) kv("Fountain", "(" + d.lx + ", " + d.ly + ")");
  if (d.areaTiles) kv("Shire size", d.areaTiles.toLocaleString() + " tiles (~" + Math.round(Math.sqrt(d.areaTiles / Math.PI)) + " tile radius)");
  body.appendChild(meta);
  if (d.biomes && Object.keys(d.biomes).length) body.appendChild(biomesTable(c.nm, d.biomes, d.areaTiles));
  if (c.npcs.length) body.appendChild(npcsTable(state, c.nm, c.npcs));
  if (quests.length || (isOrigin && c.nm === "Newhaven")) body.appendChild(questsTable(state, c.nm, quests, Q, isOrigin, c.nm === "Newhaven"));
  if (banks.length) body.appendChild(banksTable(state, c.nm, banks));
  if (stations.length) body.appendChild(stationsTable(state, c.nm, stations));
  if (pois.length) body.appendChild(poisTable(state, c.nm, pois));
  if (setls.length) body.appendChild(townsTable(state, c.nm, setls));
  return body;
}

// One row per shire with count columns; the Expand button reveals its cityBody().
// Every column is click-to-sort (asc/desc); numeric columns + their headers are
// right-aligned. Each shire's summary row and its (hidden) detail row move together
// when sorting, preserving the expanded/collapsed state.
function shiresTable(cityList, state, isOrigin, Q) {
  const thBase = "border-bottom:1px solid var(--line,#333);padding:.4rem .55rem;font-size:.7rem;letter-spacing:.02em;color:var(--ink-dim);white-space:nowrap;position:sticky;top:0;background:var(--bg-1,#111)";
  const td = "border-bottom:1px solid var(--line,#222);padding:.45rem .55rem;font-size:.82rem;vertical-align:middle;white-space:nowrap";
  const numTd = td + ";text-align:right;color:var(--ink-dim);font-variant-numeric:tabular-nums";
  // {label, num, noSort} — num columns (and their headers) right-align.
  const heads = [
    { label: "Shire", num: false }, { label: "Tiles", num: true }, { label: "NPCs", num: true },
    { label: "Biomes", num: true }, { label: "Quests", num: true }, { label: "Stations", num: true },
    { label: "Banks", num: true }, { label: "POIs", num: true }, { label: "Settlements", num: true },
    { label: "", num: false, noSort: true },
  ];
  const table = el("table", { style: "border-collapse:collapse;width:100%" });
  const headTr = el("tr"); table.appendChild(headTr);
  const tbody = el("tbody"); table.appendChild(tbody);

  const entries = cityList.map(c => {
    const d = c.d || {};
    const quests = c.npcs.filter(n => n.role === "quest-giver" || n.role === "quest-anchor");
    const banks = d.banks || [], stations = d.stations || [], pois = d.pois || [], setls = d.settlements || [];
    const bankTotal = banks.reduce((s, b) => s + b.count, 0);
    const biomeCount = d.biomes ? Object.keys(d.biomes).length : 0;
    const vals = [c.nm, d.areaTiles || 0, c.npcs.length, biomeCount, quests.length, stations.length, bankTotal, pois.length, setls.length];
    const num = v => el("td", { style: numTd, text: v ? Number(v).toLocaleString() : "—" });

    const detailCell = el("td", { style: td + ";background:var(--bg-2,#12151b);white-space:normal" });
    detailCell.setAttribute("colspan", String(heads.length));
    const detailRow = el("tr", { style: "display:none" }, [detailCell]);
    let built = false;
    const btn = el("button.btn.sm.ghost", { text: "▸ Expand" });
    btn.onclick = () => {
      const open = detailRow.style.display === "none";
      if (open && !built) { built = true; detailCell.appendChild(cityBody(c, state, isOrigin, Q)); }
      detailRow.style.display = open ? "" : "none";
      btn.textContent = open ? "▾ Collapse" : "▸ Expand";
    };
    const summaryRow = el("tr", null, [
      el("td", { style: td }, [el("span", { style: "font-weight:600", text: c.nm })]),
      num(d.areaTiles), num(c.npcs.length), num(biomeCount), num(quests.length),
      num(stations.length), num(bankTotal), num(pois.length), num(setls.length),
      el("td", { style: td }, [btn]),
    ]);
    return { vals, summaryRow, detailRow };
  });

  let sortCol = -1, sortDir = 1;
  const applySort = () => {
    const arr = entries.slice();
    if (sortCol >= 0) {
      const numeric = heads[sortCol].num;
      arr.sort((a, b) => {
        const x = a.vals[sortCol], y = b.vals[sortCol];
        const cmp = numeric ? ((Number(x) || 0) - (Number(y) || 0)) : String(x).localeCompare(String(y));
        return cmp * sortDir;
      });
    }
    clear(tbody);
    for (const e of arr) { tbody.appendChild(e.summaryRow); tbody.appendChild(e.detailRow); }
  };
  const updateIndicators = () => heads.forEach((h, i) => { if (h._ind) h._ind.textContent = i === sortCol ? (sortDir === 1 ? " ▲" : " ▼") : ""; });
  heads.forEach((h, i) => {
    const cell = el("th", { style: thBase + (h.num ? ";text-align:right" : ";text-align:left") + (h.noSort ? "" : ";cursor:pointer;user-select:none") });
    cell.appendChild(el("span", { text: h.label }));
    const ind = el("span", { style: "color:var(--gold)", text: "" }); h._ind = ind; cell.appendChild(ind);
    if (!h.noSort) cell.onclick = () => {
      if (sortCol === i) sortDir = -sortDir; else { sortCol = i; sortDir = h.num ? -1 : 1; }   // numbers default high→low
      updateIndicators(); applySort();
    };
    headTr.appendChild(cell);
  });
  applySort();
  return el("div", { style: "overflow-x:auto" }, [table]);
}
function citiesCard(zx, zy, isOrigin) {
  const card = el("div.card");
  const badge = el("span.badge", { text: "…" });
  card.appendChild(el("div.sectitle", null, [el("h3", null, ["Shires ", el("span.hint", { text: "each city fountain's shire and everything bound to it — NPCs, quests, monsters, banks, stations, POIs, towns" })]), badge]));
  const host = el("div", null, [el("div.center-col", null, [el("div.spinner"), el("small", { text: "Loading baked zone data…" })])]);
  card.appendChild(host);
  const state = { folder: zx + "," + zy, tallies: {}, refetch: async () => { try { state.tallies = (typeof Taiao !== "undefined" && Taiao.tally) ? (await Taiao.tally("zone", state.folder) || {}) : {}; } catch (_) {} } };
  Promise.all([
    fetch(STUDIO_BASE + "assets/zones/zone_" + zx + "_" + zy + ".json", { cache: "force-cache" }).then(r => r.ok ? r.json() : null).catch(() => null),
    state.refetch(),
  ]).then(([m]) => {
    clear(host);
    const npcs = (m && m.npcs) || [], cities = (m && m.cities) || [], monsters = (m && m.monsters) || [];
    if (!npcs.length && !cities.length) {
      badge.textContent = "0";
      host.appendChild(el("div.empty", { html: "<div class='big'>🏛️</div>No baked zone data.<br><small>Bake with <span class='mono'>--npcsonly</span>, <span class='mono'>--citiesonly</span> and <span class='mono'>--monstersonly</span>.</small>" }));
      return;
    }
    const dossier = new Map(); cities.forEach(c => dossier.set(c.name, c));
    // shire size fallback: if the bake didn't record areaTiles, estimate each
    // fountain's catchment area by sampling the zone grid against all fountains.
    const fountains = cities.filter(c => c.lx != null);
    if (fountains.length && fountains.some(c => !c.areaTiles)) {
      const STEP = 200, cnt = new Map();
      for (let sy = STEP / 2; sy < ZONE_T; sy += STEP) for (let sx = STEP / 2; sx < ZONE_T; sx += STEP) {
        let best = null, bd = Infinity;
        for (const c of fountains) { const dx = c.lx - sx, dy = c.ly - sy, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = c; } }
        if (best) cnt.set(best.name, (cnt.get(best.name) || 0) + 1);
      }
      fountains.forEach(c => { if (!c.areaTiles) c.areaTiles = (cnt.get(c.name) || 0) * STEP * STEP; });
    }
    const npcByCity = new Map(); npcs.forEach(n => { const k = n.city || "—"; if (!npcByCity.has(k)) npcByCity.set(k, []); npcByCity.get(k).push(n); });
    const monByCity = new Map(); monsters.forEach(mo => { const k = mo.city || "—"; if (!monByCity.has(k)) monByCity.set(k, []); monByCity.get(k).push(mo); });
    const names = new Set([...dossier.keys(), ...npcByCity.keys(), ...monByCity.keys()]);
    const cityList = [...names].map(nm => ({ nm, d: dossier.get(nm), npcs: npcByCity.get(nm) || [], monsters: monByCity.get(nm) || [] }));
    cityList.sort((a, b) => b.npcs.length - a.npcs.length || String(a.nm).localeCompare(String(b.nm)));
    badge.textContent = String(cityList.length);
    host.appendChild(el("p.tagline", { text: npcs.length + " NPCs across " + cityList.length + " shires. Everything is bound to its nearest city fountain; expand a shire for its tables. Coordinates are zone-local tiles; 🗳 to vote." }));
    const Q = (typeof allQuests === "function") ? allQuests(m) : null;   // canonical quest ids/names/code shared with the Quests tab
    host.appendChild(shiresTable(cityList, state, isOrigin, Q));
  }).catch(() => { clear(host); badge.textContent = "!"; host.appendChild(el("div.empty", { text: "Couldn't load baked zone data." })); });
  return card;
}

// ---- a unique page for one NPC: "<name> of <City>" ----
// Reached by clicking an NPC in a shire's NPC table. Keyed by zone + exact
// spawn tile (unique per NPC); the manifest record carries the whole identity.
const _zoneManifestCache = new Map();   // "zx,zy" → Promise<manifest|null>
function loadZoneManifest(zx, zy) {
  const k = zx + "," + zy;
  if (!_zoneManifestCache.has(k))
    _zoneManifestCache.set(k, fetch(STUDIO_BASE + "assets/zones/zone_" + zx + "_" + zy + ".json", { cache: "force-cache" })
      .then(r => r.ok ? r.json() : null).catch(() => null));
  return _zoneManifestCache.get(k);
}
// The NPC tab: every NPC baked into the world (zone 0,0), by full name. Each row
// links to that NPC's own information/voting page (#/npc?id=<npcId>).
// The "NPC templates" card: the procedural NPC roster (MIX_NPCS), each shown by
// just its TEMPLATE id (the dotted "body.garb" part, e.g. ezana.prithvi — NOT the
// "$shire$zone" world-spawn suffix a baked NPC gets), plus any NPCs the player has
// created (which land here as drafts).
function npcTemplatesCard() {
  const th = "border-bottom:1px solid var(--line,#333);padding:.4rem .55rem;text-align:left;font-size:.7rem;color:var(--ink-dim);white-space:nowrap;position:sticky;top:0;background:var(--bg-1,#111)";
  const td = "border-bottom:1px solid var(--line,#222);padding:.35rem .55rem;font-size:.8rem;white-space:nowrap";
  const card = el("details.card");   // collapsed by default — expand to view
  const badge = el("span.badge", { text: "…" });
  card.appendChild(el("summary", { style: "cursor:pointer;font-weight:650" }, ["NPC templates ", badge]));

  // NPCs the player has created land at the top of the card, as drafts
  const draftHost = el("div"); card.appendChild(draftHost);
  try {
    Store.all("character").then(rows => {
      const mine = (rows || []).filter(p => p && p.roster === "npc");
      if (!mine.length) return;
      const box = el("div", { style: "margin:.2rem 0 .7rem" });
      box.appendChild(el("div.tagline", { style: "font-size:.72rem;margin-bottom:.2rem", text: "Your created NPCs" }));
      const g = el("div.grid-cards");
      mine.forEach(p => g.appendChild(el("a.tile", { href: "#/edit/" + p.id }, [
        el("div.thumb", { style: "width:64px;height:64px;flex:none" }),
        el("div.meta", null, [el("div.name", { text: p.name || p.charId || "NPC" }),
          el("div.sub", null, [el("span.mono", { style: "font-size:.7rem;color:var(--gold)", text: p.charId || "—" }), el("span.badge", { style: "margin-left:.35rem", text: "draft" })])]),
      ])));
      box.appendChild(g); draftHost.appendChild(box);
    }).catch(() => {});
  } catch (_) {}

  // the procedural roster (MIX_NPCS) — one row per template
  const list = (typeof MIX_NPCS !== "undefined" && MIX_NPCS.list) ? MIX_NPCS.list : [];
  badge.textContent = list.length + (list.length === 1 ? " template" : " templates");
  if (!list.length) { card.appendChild(el("div.empty", { text: "No procedural NPC roster loaded." })); return card; }
  const table = el("table", { style: "border-collapse:collapse;width:100%" });
  table.appendChild(el("tr", null, ["NPC", "sprite id", "Description"].map(h =>
    el("th", h === "sprite id" ? { style: th, text: h, "data-tf-text": "" } : { style: th, text: h }))));
  list.forEach((raw, i) => {
    const tid = npcSpriteId({ mixIndex: i });
    const key = encodeURIComponent(raw.key);
    table.appendChild(el("tr", null, [
      // name → the NPC's (character) page
      el("td", { style: td }, [el("div", { style: "display:flex;align-items:center;gap:.5rem" }, [npcThumb(i, 34),
        el("a", { href: "#/detail?type=character&key=" + key, style: "color:inherit;text-decoration:none;font-weight:600", text: raw.name })])]),
      // sprite id → the sprite (art) page
      el("td", { style: td }, [el("a", { href: "#/sprite?type=character&key=" + key, style: "color:var(--gold);text-decoration:none;font-family:monospace;font-size:.74rem", text: tid })]),
      el("td", { style: td + ";color:var(--ink-dim);white-space:normal", text: raw.title || raw.dlg || "NPC" }),
    ]));
  });
  card.appendChild(el("div", { style: "overflow-x:auto" }, [TableFilter.enhance(table)]));
  return card;
}

function pageNpcList(root) {
  clear(root);
  const page = el("div.page");
  page.appendChild(el("div.banner.info", { html: "Every NPC baked into the world — quest-givers, shopkeepers, bankers, registrars and residents — across all baked zones, by full name. Click one for its information &amp; voting page." }));
  // create a new NPC entity (id + stats + a default sprite; art is on the Sprites tab)
  if (typeof buildCharacterCreator === "function") {
    const gen = el("details.card");
    gen.appendChild(el("summary", { style: "cursor:pointer;font-weight:650", text: "＋ Create a new NPC" }));
    const body = el("div", { style: "margin-top:.8rem" });
    body.appendChild(el("p.tagline", { html: 'Give it an id, stats and a default sprite. Generate the sprite art first on the <a href="#/sprites">Sprites tab</a>.' }));
    buildCharacterCreator(body, "npc");
    gen.appendChild(body); page.appendChild(gen);
  }
  page.appendChild(npcTemplatesCard());
  const card = el("details.card");   // collapsed by default — expand to view
  const badge = el("span.badge", { id: "npc-count", text: "…" });
  card.appendChild(el("summary", { style: "cursor:pointer;font-weight:650" }, [
    "All NPCs ", el("span.hint", { text: "baked into the world" }), " ", badge,
  ]));
  const host = el("div", null, [el("div.center-col", null, [el("div.spinner"), el("small", { text: "Loading NPCs…" })])]);
  card.appendChild(host); page.appendChild(card); root.appendChild(page);
  const th = "border-bottom:1px solid var(--line,#333);padding:.4rem .55rem;text-align:left;font-size:.7rem;color:var(--ink-dim);white-space:nowrap;position:sticky;top:0;background:var(--bg-1,#111)";
  const td = "border-bottom:1px solid var(--line,#222);padding:.35rem .55rem;font-size:.8rem;white-space:nowrap";

  bakedZones().then(zones => Promise.all(zones.map(z => {
    const p = z.split(",").map(s => parseInt(s, 10));
    return fetch(STUDIO_BASE + "assets/zones/zone_" + p[0] + "_" + p[1] + ".json", { cache: "force-cache" })
      .then(r => r.ok ? r.json() : null).then(m => ({ z, m })).catch(() => ({ z, m: null }));
  }))).then(results => {
    clear(host);
    const all = [];
    for (const { z, m } of results) if (m && m.npcs) for (const n of m.npcs) all.push({ n, zone: z });
    all.sort((a, b) => String(a.n.name).localeCompare(String(b.n.name)));
    badge.textContent = all.length + (all.length === 1 ? " NPC" : " NPCs");
    if (!all.length) { host.appendChild(el("div.empty", { text: "No NPCs baked yet." })); return; }
    const t = el("table", { style: "border-collapse:collapse;width:100%" });
    t.appendChild(el("tr", null, ["NPC", "NPC id", "Shire", "Zone"].map(h =>
      el("th", h === "NPC id" ? { style: th, text: h, "data-tf-text": "" } : { style: th, text: h }))));
    for (const { n, zone } of all) {
      const thumb = (typeof npcThumb === "function") ? npcThumb(n.mixIndex, 34) : el("span");
      const short = (typeof npcBaseName === "function") ? npcBaseName(n) : n.name;
      const id = npcId(n, zone);
      const link = el("a", { href: "#/npc?zone=" + encodeURIComponent(zone) + "&id=" + encodeURIComponent(id), style: "color:inherit;text-decoration:none;font-weight:600", text: short });
      t.appendChild(el("tr", null, [
        el("td", { style: td }, [el("div", { style: "display:flex;align-items:center;gap:.5rem" }, [thumb, link])]),
        el("td", { style: td + ";font-family:monospace;font-size:.72rem;color:var(--ink-dim)", text: id }),
        el("td", { style: td + ";color:var(--ink-dim)", text: n.city || "—" }),
        el("td", { style: td + ";color:var(--ink-dim)", text: "(" + zone + ")" }),
      ]));
    }
    host.appendChild(el("div", { style: "overflow-x:auto" }, [TableFilter.enhance(t)]));
  }).catch(() => { clear(host); host.appendChild(el("div.empty", { text: "Couldn't load the baked NPC data." })); });
}

function pageNpc(root, params) {
  clear(root);
  const page = el("div.page");
  const readInt = (v, d) => { const n = parseInt(v, 10); return isNaN(n) ? d : n; };
  const zone = (params && params.get("zone")) || "0,0";
  const zx = readInt(zone.split(",")[0], 0), zy = readInt(zone.split(",")[1], 0);
  const at = (params && params.get("at")) || "";
  const lx = readInt(at.split(",")[0], NaN), ly = readInt(at.split(",")[1], NaN);
  const wantName = params && params.get("name");
  const wantId = params && params.get("id");

  page.appendChild(el("div.card", null, [el("div.btn-row", null, [
    el("a.btn.sm", { text: "← Back to the zone", href: "#/zones?zx=" + zx + "&zy=" + zy }),
  ])]));
  const host = el("div", null, [el("div.center-col", null, [el("div.spinner"), el("small", { text: "Loading NPC…" })])]);
  page.appendChild(host);
  root.appendChild(page);

  loadZoneManifest(zx, zy).then(m => {
    clear(host);
    const npcs = (m && m.npcs) || [];
    const n = npcs.find(x => (!isNaN(lx) && !isNaN(ly)) ? (x.lx === lx && x.ly === ly) : (x.name === wantName))
      || (wantName ? npcs.find(x => x.name === wantName) : null)
      || (wantId ? npcs.find(x => npcId(x, zone) === wantId) : null);
    if (!n) {
      host.appendChild(el("div.empty", { html: "<div class='big'>🧍</div>NPC not found in this zone.<br><small>They may not be in the baked manifest.</small>" }));
      return;
    }
    host.appendChild(npcPageBody(m, n, zx, zy));
  }).catch(() => { clear(host); host.appendChild(el("div.empty", { text: "Couldn't load the zone data for this NPC." })); });
}
function npcPageBody(m, n, zx, zy) {
  const wrap = el("div");
  const raw = npcRaw(n);
  const isShop = n.role === "shopkeeper";
  const isQuest = n.role === "quest-giver" || n.role === "quest-anchor";

  // header: big idle portrait + name / title / role
  const hdr = el("div.card");
  const portrait = el("div.thumb", { style: "width:128px;height:128px;flex:none" });
  const pcv = el("canvas", { width: 128, height: 128 }); portrait.appendChild(pcv);
  try { if (raw) Roster.drawNpc(pcv, raw, 0); } catch (_) {}
  hdr.appendChild(el("div.row", { style: "gap:1rem;align-items:center;flex-wrap:wrap" }, [
    portrait,
    el("div", null, [
      el("div.sectitle", null, [el("h3", { text: n.name }),
        el("span.badge", { text: isQuest ? "quest start" : isShop ? "shopkeeper" : (n.role || "NPC") })]),
      el("div.hint", { text: (n.title || "") + (n.job ? "  ·  " + n.job : "") }),
    ]),
  ]));
  wrap.appendChild(hdr);

  // identity table
  const info = el("div.card");
  info.appendChild(el("div.sectitle", null, [el("h3", { text: "Details" })]));
  const kv = el("dl.kv");
  const add = (k, v) => { if (v == null || v === "") return; kv.appendChild(el("dt", { text: k })); kv.appendChild(el("dd", null, [].concat(v))); };
  add("Name", npcBaseName(n));
  add("Full name", n.name);
  add("NPC id", el("span.mono", { text: npcId(n, zx + "," + zy) }));
  add("Shire", (n.city || "—") + " shire");
  add("Home settlement", n.settlement || "—");
  add("Role", n.role || "—");
  if (n.title) add("Title", n.title);
  add("Shopkeeper", String(isShop).toUpperCase());
  add("Quest start", String(isQuest).toUpperCase());
  add("Zone", "(" + zx + ", " + zy + ")");
  add("Zone-local tile", "(" + n.lx + ", " + n.ly + ")");
  if (n.gx != null) add("World tile", "(" + n.gx.toLocaleString() + ", " + n.gy.toLocaleString() + ")");
  if (raw) add("Sprite source", el("a", { href: "#/sprite?type=character&key=" + encodeURIComponent(raw.key), style: "color:var(--gold);text-decoration:none;font-family:monospace", text: npcSpriteId(n) }));
  // quest link, if this NPC starts one
  if (isQuest) {
    const Q = (typeof allQuests === "function") ? allQuests(m) : null;
    const q = Q && Q.byGiver && Q.byGiver.get(n.gx + "," + n.gy);
    if (q) add("Starts quest", el("a", { href: "#/quests?id=" + encodeURIComponent(q.id), style: "color:var(--gold);text-decoration:none;font-weight:600", text: q.name }));
  }
  info.appendChild(kv);
  wrap.appendChild(info);

  // sprite decks + sprite & animation rules — same cards the catalog NPC pages show
  if (raw) {
    const rulesEntry = { npc: true, key: raw.key, snake: npcSpriteId(n) };
    if (typeof entitySpritesSection === "function") entitySpritesSection(wrap, "character", rulesEntry, "npc");
    if (typeof spriteAnimRulesSection === "function") spriteAnimRulesSection(wrap, "character", rulesEntry, "npc");
  }
  return wrap;
}

