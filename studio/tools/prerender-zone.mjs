// ===== Taiao Workshop — offline zone pre-render =====
// Runs the game's REAL world generation (js/data.js + world/terrain.js +
// world/features.js) headlessly in a Node vm — no browser, no native canvas —
// and bakes a whole zone to a high-resolution PNG + a features JSON, saved under
// studio/assets/zones/. The Zones tab loads those from disk instead of
// regenerating. Parallelised across CPU cores.
//
//   node studio/tools/prerender-zone.mjs [--zx 0] [--zy 0] [--step 2]
//
// step = map units per pixel (lower = higher resolution, slower, bigger file):
//   step 4 → 1920px   step 2 → 3840px   step 1 → 7552px
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";
import fs from "node:fs";
import zlib from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractZoneNpcs, extractZoneCities, extractZoneMonsters, mergeShires, augmentShireBiomes } from "./zone-npcs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, "../../js");          // /RPG/js
const OUT = path.resolve(HERE, "../assets/zones");    // /RPG/studio/assets/zones
const MPX = 64, ZONE_TILES = 15000;
const MAP_COLORS = [[66,88,134],[100,124,162],[199,183,143],[93,122,62],[72,104,54],[94,106,72],[197,172,113],[110,104,95],[222,225,228],[150,159,138],[152,132,76],[162,120,82],[44,90,40],[110,140,70],[164,154,86],[126,122,106],[148,150,120],[56,50,48],[96,88,76],[88,112,88],[88,138,72],[90,140,160],[136,130,112],[220,218,206],[76,112,88],[170,108,68],[152,146,90],[186,106,60],[112,98,120],[182,174,152],[92,124,116],[94,90,86],[118,102,108],[202,218,230],[124,150,72],[124,140,94],[152,142,170]];
const MAP_WATER = [[50,70,114],[72,94,140],[98,124,164],[138,164,194]];

function buildFeatures() {
  const src = [path.join(GAME, "data.js"), path.join(GAME, "world/terrain.js"), path.join(GAME, "world/features.js")]
    .map(f => fs.readFileSync(f, "utf8")).join("\n;\n");
  const ctx = { WORLD_SEED: 1337, LAND_E: 0.483, ROCK_E: 0.655, CHUNK: 32, VCELL: 144, PCELL: 30, ICELL: 44, WORLDGEN_SIG: "studio",
    Math, Float32Array, Uint8ClampedArray, Int32Array, Uint32Array, Float64Array, Array, Object, JSON, Map, Set, isNaN, parseInt, parseFloat, String, Number, Boolean, console };
  ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(src + "\n; globalThis.__F = createWorldFeatures(createWorldTerrain());", ctx, { timeout: 120000 });
  return { F: ctx.__F, ctx };   // ctx carries TUT_ISLE / DREAM_WORLD globals
}

// render an arbitrary MAP-unit rect to raw RGBA (used for the sealed pockets)
function renderRegion(F, x0, y0, x1, y1, step, showIsle) {
  const MT = MPX * step;
  const mx0 = Math.floor(x0 / MT), mx1 = Math.floor((x1 - 1e-6) / MT);
  const my0 = Math.floor(y0 / MT), my1 = Math.floor((y1 - 1e-6) / MT);
  const cols = mx1 - mx0 + 1, rows = my1 - my0 + 1, imgW = cols * MPX, imgH = rows * MPX;
  const rgba = new Uint8ClampedArray(imgW * imgH * 4);
  for (let my = my0; my <= my1; my++) for (let mx = mx0; mx <= mx1; mx++) {
    const px = F.macroPixels(step, mx, my, MPX, MAP_COLORS, MAP_WATER, showIsle);
    const ox = (mx - mx0) * MPX, oy = (my - my0) * MPX;
    for (let ty = 0; ty < MPX; ty++) { const s = ty * MPX * 4; rgba.set(px.subarray(s, s + MPX * 4), ((oy + ty) * imgW + ox) * 4); }
  }
  return { rgba, imgW, imgH };
}

// zone[special]: a zone OUTSIDE the coordinate world map, holding the sealed
// locations that are never part of any normal zone — the Tūhura Isle (private
// ocean, showIsle=true so the carve renders) and the Dream Forest interior. The
// normal zones never contain these (the isle is masked to sea, the dream is
// neutralised), so they only exist here, unreachable by navigating the seed map.
function bakeSpecialZone(F, ctx) {
  const T = ctx.TUT_ISLE, D = ctx.DREAM_WORLD, regions = [];
  if (T && T.CX != null) {
    const rad = T.RO + T.SEAL_D + 20;   // full sealed ocean disc + a margin
    const r = renderRegion(F, T.CX - rad, T.CY - rad, T.CX + rad, T.CY + rad, 1, true);
    const f = `zone_special_isle.png`; fs.writeFileSync(path.join(OUT, f), encodePNG(r.imgW, r.imgH, r.rgba));
    regions.push({ key: "isle", name: "Tūhura Isle", image: f, imgW: r.imgW, imgH: r.imgH,
      note: "The Swim-Master's islet in a mist-walled private ocean. Not part of any world-map zone — reached only by swimming out during the Swim-Master's tutorial." });
    console.log(`    isle: ${r.imgW}×${r.imgH}px`);
  }
  if (D && D.RECT) {
    const R = D.RECT;
    const r = renderRegion(F, R.x0 - 10, R.y0 - 10, R.x1 + 10, R.y1 + 10, 2, false);
    const f = `zone_special_dream.png`; fs.writeFileSync(path.join(OUT, f), encodePNG(r.imgW, r.imgH, r.rgba));
    regions.push({ key: "dream", name: "Dream Forest interior", image: f, imgW: r.imgW, imgH: r.imgH,
      note: "A pocket dimension of stacked dream levels. Not part of any world-map zone — entered only through a dream gate." });
    console.log(`    dream: ${r.imgW}×${r.imgH}px`);
  }
  return regions;
}

// tile grid for a zone (identical math to js/zone-worker.js)
function grid(zx, zy, step) {
  const zoneMap = ZONE_TILES / 2, MT = MPX * step;
  const cMap = zx * zoneMap, cMapY = zy * zoneMap;
  const mapMinX = cMap - zoneMap / 2, mapMinY = cMapY - zoneMap / 2;
  const mapMaxX = cMap + zoneMap / 2, mapMaxY = cMapY + zoneMap / 2;
  const mx0 = Math.floor(mapMinX / MT), mx1 = Math.floor((mapMaxX - 1e-6) / MT);
  const my0 = Math.floor(mapMinY / MT), my1 = Math.floor((mapMaxY - 1e-6) / MT);
  const cols = mx1 - mx0 + 1, rows = my1 - my0 + 1;
  return { mx0, mx1, my0, my1, cols, rows, MT, step, MPX,
    imgW: cols * MPX, imgH: rows * MPX, originMapX: mx0 * MT, originMapY: my0 * MT };
}

// ---------- worker: render a band of macro-tile ROWS ----------
if (!isMainThread) {
  const { zx, zy, step, myRow0, myRow1 } = workerData;
  const { F, ctx } = buildFeatures();
  // The sealed special locations are NEVER baked into the main map — they live in
  // zone[special]. Neutralise both so the world map shows the natural underlying
  // terrain where they'd be: move each region's bounds out of range so tutIsleSD
  // and dreamSD return null everywhere (no isle carve, no seal-masked blue circle,
  // no dream overrides).
  const FAR = { x0: 1e12, y0: 1e12, x1: 1e12 + 1, y1: 1e12 + 1 };
  if (ctx.TUT_ISLE && ctx.TUT_ISLE.bbox) ctx.TUT_ISLE.bbox = FAR;
  if (ctx.DREAM_WORLD && ctx.DREAM_WORLD.RECT) ctx.DREAM_WORLD.RECT = FAR;
  const g = grid(zx, zy, step);
  const bandRows = myRow1 - myRow0 + 1;
  const band = new Uint8ClampedArray(g.imgW * bandRows * MPX * 4);
  for (let my = myRow0; my <= myRow1; my++) {
    const oyBand = (my - myRow0) * MPX;
    for (let mx = g.mx0; mx <= g.mx1; mx++) {
      const px = F.macroPixels(step, mx, my, MPX, MAP_COLORS, MAP_WATER, false);
      const ox = (mx - g.mx0) * MPX;
      for (let ty = 0; ty < MPX; ty++) {
        const srcOff = ty * MPX * 4;
        const dstOff = ((oyBand + ty) * g.imgW + ox) * 4;
        band.set(px.subarray(srcOff, srcOff + MPX * 4), dstOff);
      }
    }
    parentPort.postMessage({ progress: my - g.my0 + 1, total: g.rows });
  }
  parentPort.postMessage({ myRow0, bandRows, buf: band.buffer }, [band.buffer]);
  process.exit(0);
}

// ---------- PNG encoder (truecolour+alpha, filter 0) ----------
function crc32(buf, start, end) {
  let c = ~0;
  for (let i = start; i < end; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = data.length, out = Buffer.alloc(12 + len);
  out.writeUInt32BE(len, 0); out.write(type, 4, "ascii"); data.copy(out, 8);
  out.writeUInt32BE(crc32(out, 4, 8 + len), 8 + len);
  return out;
}
function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA
  const stride = width * 4, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1); }
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// query the zone's features over a MAP-coord rect (settlements/roads/rivers; POIs
// & icons optional) and compact them (int coords, decimated polylines) for the web.
function queryFeatures(F, tMinX, tMinY, tMaxX, tMaxY, wantPois, wantIcons) {
  const safe = (name, fn) => { const s = Date.now(); try { const v = fn(); process.stdout.write(`    ${name}: ${v.length} (${((Date.now() - s) / 1000).toFixed(1)}s)\n`); return v; } catch (e) { process.stdout.write(`    ${name}: FAILED ${e}\n`); return []; } };
  const feat = {
    villages: safe("villages", () => F.villagesNearForMap(tMinX, tMinY, tMaxX, tMaxY, 144).map(v => ({ name: v.name, kind: v.kind, x: v.x, y: v.y }))),
    rivers: safe("rivers", () => F.riversNear(tMinX, tMinY, tMaxX, tMaxY).map(rv => ({ polys: rv.polys }))),
    roads: safe("roads", () => F.roadsNear(tMinX, tMinY, tMaxX, tMaxY).map(rp => ({ pts: rp.pts }))),
    pois: wantPois ? safe("pois", () => F.poisNearForMap(tMinX, tMinY, tMaxX, tMaxY, 30).map(p => ({ name: p.name, kind: p.type, x: p.x, y: p.y }))) : [],
    icons: wantIcons ? safe("icons", () => F.iconsNearForMap(tMinX, tMinY, tMaxX, tMaxY).map(ic => ({ kind: ic.kind || ic.type, x: ic.x, y: ic.y }))) : [],
  };
  const ri = n => Math.round(n);
  const simp = pts => { if (!pts || pts.length <= 3) return (pts || []).map(q => [ri(q[0]), ri(q[1])]); const out = [pts[0].map(ri)]; for (let i = 1; i < pts.length - 1; i += 2) out.push([ri(pts[i][0]), ri(pts[i][1])]); out.push(pts[pts.length - 1].map(ri)); return out; };
  feat.villages.forEach(v => { v.x = ri(v.x); v.y = ri(v.y); });
  feat.pois.forEach(p => { p.x = ri(p.x); p.y = ri(p.y); });
  feat.roads.forEach(r => { r.pts = simp(r.pts); });
  feat.rivers.forEach(r => { r.polys = (r.polys || []).map(simp); });
  return feat;
}

// render a zone's terrain to a PNG buffer, parallelised across CPU cores (each
// worker neutralises the sealed special locations, so they never bake in).
async function renderZoneTerrain(zx, zy, step) {
  const g = grid(zx, zy, step);
  console.log(`Zone ${zx},${zy} @ step ${step} → ${g.imgW}×${g.imgH}px  (${g.cols}×${g.rows} macro tiles)`);
  const nWorkers = Math.min(g.rows, Math.max(1, os.cpus().length - 2));
  const perW = Math.ceil(g.rows / nWorkers);
  const rgba = new Uint8ClampedArray(g.imgW * g.imgH * 4);
  let done = 0, lastPct = -1;
  await Promise.all(Array.from({ length: nWorkers }, (_, wi) => {
    const r0 = g.my0 + wi * perW, r1 = Math.min(g.my1, r0 + perW - 1);
    if (r0 > r1) return Promise.resolve();
    return new Promise((res, rej) => {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { zx, zy, step, myRow0: r0, myRow1: r1 } });
      w.on("message", m => {
        if (m.progress != null) { done++; const pct = Math.floor(done / g.rows * 100); if (pct !== lastPct) { lastPct = pct; process.stdout.write(`\r  rendering… ${pct}%   `); } return; }
        if (m.buf) { const band = new Uint8ClampedArray(m.buf); rgba.set(band, (m.myRow0 - g.my0) * MPX * g.imgW * 4); }
      });
      w.on("error", rej); w.on("exit", c => c === 0 ? res() : rej(new Error("worker exit " + c)));
    });
  }));
  process.stdout.write("\n");
  return { g, png: encodePNG(g.imgW, g.imgH, rgba) };
}

// ---------- main ----------
async function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? Number(argv[i + 1]) : d; };
  const zx = arg("zx", 0), zy = arg("zy", 0), step = arg("step", 2);
  fs.mkdirSync(OUT, { recursive: true });

  // bake zone[special]: the sealed locations that live OUTSIDE the coordinate
  // world map (Tūhura Isle + Dream Forest interior). Writes zone_special.json.
  if (argv.includes("--special")) {
    console.log("Baking zone[special] (Tūhura Isle + Dream Forest interior)…");
    const { F, ctx } = buildFeatures();
    const regions = bakeSpecialZone(F, ctx);
    const jsonPath = path.join(OUT, "zone_special.json");
    fs.writeFileSync(jsonPath, JSON.stringify({ special: true, name: "Special zone", regions }));
    console.log("wrote zone_special.json:", regions.map(r => r.name).join(", "));
    return;
  }

  // re-render just the terrain PNG, keeping the existing manifest (use after a
  // terrain/neutralisation fix — skips the feature query).
  if (argv.includes("--terrainonly")) {
    console.log(`Re-rendering terrain PNG for zone ${zx},${zy} @ step ${step} (keeping manifest)…`);
    const t0 = Date.now();
    const { png } = await renderZoneTerrain(zx, zy, step);
    fs.writeFileSync(path.join(OUT, `zone_${zx}_${zy}.png`), png);
    console.log(`wrote zone_${zx}_${zy}.png (${(png.length / 1048576).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return;
  }

  // re-query features and patch the manifest, keeping the existing PNG (use after
  // a coordinate/query fix — skips the long terrain render). Normal zones carry
  // NO special locations, so pockets are cleared.
  if (argv.includes("--featuresonly")) {
    const g0 = grid(zx, zy, step);
    console.log(`Re-querying features for zone ${zx},${zy} @ step ${step} over map extent…`);
    const { F } = buildFeatures();
    const feat = queryFeatures(F, g0.originMapX, g0.originMapY, g0.originMapX + g0.imgW * step, g0.originMapY + g0.imgH * step, argv.includes("--pois"), argv.includes("--icons"));
    const jsonPath = path.join(OUT, `zone_${zx}_${zy}.json`);
    const man = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    man.feat = feat; delete man.pockets;
    fs.writeFileSync(jsonPath, JSON.stringify(man));
    console.log(`patched features (${feat.villages.length} villages, ${feat.roads.length} roads, ${feat.rivers.length} rivers) → ${(fs.statSync(jsonPath).size / 1048576).toFixed(1)} MB`);
    return;
  }

  // NPCs only: run the real world engine's NPC generation for this zone and
  // patch the manifest's `npcs` array, keeping the existing PNG + features.
  if (argv.includes("--npcsonly")) {
    console.log(`Extracting NPCs for zone ${zx},${zy} (real world engine; this is minutes)…`);
    const r = await extractZoneNpcs(zx, zy, { log: s => process.stdout.write("  " + s + "\n") });
    const jsonPath = path.join(OUT, `zone_${zx}_${zy}.json`);
    const man = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf8")) : { meta: { zx, zy } };
    man.npcs = r.npcs;
    fs.writeFileSync(jsonPath, JSON.stringify(man));
    console.log(`patched ${r.npcs.length} NPCs → ${jsonPath}  (${(fs.statSync(jsonPath).size / 1048576).toFixed(1)} MB)`);
    return;
  }

  // Cities only: associate towns/villages, stations, monsters & POIs with each
  // city fountain and patch the manifest's `cities` array (keeps PNG/features/
  // NPCs). --nopois skips the slow POI generation.
  if (argv.includes("--citiesonly")) {
    console.log(`Building per-city dossiers for zone ${zx},${zy}…`);
    const r = await extractZoneCities(zx, zy, { pois: !argv.includes("--nopois"), log: s => process.stdout.write("  " + s + "\n") });
    const jsonPath = path.join(OUT, `zone_${zx}_${zy}.json`);
    const man = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf8")) : { meta: { zx, zy } };
    man.cities = r.cities;
    fs.writeFileSync(jsonPath, JSON.stringify(man));
    console.log(`patched ${r.cities.length} city dossiers → ${jsonPath}  (${(fs.statSync(jsonPath).size / 1048576).toFixed(1)} MB)`);
    return;
  }

  // Monsters only: generate the wild around each city and harvest the real
  // monster spawn instances (heavy chunk pipeline). Patches manifest `monsters`.
  if (argv.includes("--monstersonly")) {
    console.log(`Harvesting monster spawns for zone ${zx},${zy} (real chunk gen; this is heavy)…`);
    const r = await extractZoneMonsters(zx, zy, { radius: Number(arg("radius", 130)), log: s => process.stdout.write("  " + s + "\n") });
    const jsonPath = path.join(OUT, `zone_${zx}_${zy}.json`);
    const man = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf8")) : { meta: { zx, zy } };
    man.monsters = r.monsters; man.monsterRadius = r.radius;
    fs.writeFileSync(jsonPath, JSON.stringify(man));
    console.log(`patched ${r.monsters.length} monster spawns → ${jsonPath}  (${(fs.statSync(jsonPath).size / 1048576).toFixed(1)} MB)`);
    return;
  }

  // Merge shires: consolidate sub-threshold shires into neighbours + recalibrate
  // NPC names. Pure post-process over the baked manifest (run after the three
  // extraction passes). --min sets the tile threshold (default 2,250,000).
  if (argv.includes("--mergeshires")) {
    const jsonPath = path.join(OUT, `zone_${zx}_${zy}.json`);
    if (!fs.existsSync(jsonPath)) { console.error("no manifest to merge: " + jsonPath); process.exit(1); }
    const man = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    mergeShires(man, { minTiles: Number(arg("min", 4500000)), log: s => process.stdout.write("  " + s + "\n") });
    fs.writeFileSync(jsonPath, JSON.stringify(man));
    console.log(`merged shires → ${jsonPath}  (${man.cities.length} shires, ${(fs.statSync(jsonPath).size / 1048576).toFixed(1)} MB)`);
    return;
  }

  // add/refresh per-shire biome tile histograms on an already-baked manifest
  if (argv.includes("--biomesonly")) {
    const jsonPath = path.join(OUT, `zone_${zx}_${zy}.json`);
    if (!fs.existsSync(jsonPath)) { console.error("no manifest to augment: " + jsonPath); process.exit(1); }
    const man = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    augmentShireBiomes(man, zx, zy, { step: Number(arg("step", 60)), log: s => process.stdout.write("  " + s + "\n") });
    fs.writeFileSync(jsonPath, JSON.stringify(man));
    console.log(`biomes → ${jsonPath}  (${man.cities.length} shires)`);
    return;
  }

  const t0 = Date.now();
  const { g, png } = await renderZoneTerrain(zx, zy, step);
  const pngPath = path.join(OUT, `zone_${zx}_${zy}.png`);
  fs.writeFileSync(pngPath, png);
  console.log(`  terrain rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${pngPath}  (${(png.length / 1048576).toFixed(1)} MB)`);

  // features (settlements, roads, rivers by default; POIs/icons are optional —
  // per-POI name generation is very slow over a whole zone, so gate them behind
  // flags). One vm context; this is the one-time offline cost.
  const wantPois = argv.includes("--pois"), wantIcons = argv.includes("--icons");
  console.log("  querying features (villages, roads, rivers" + (wantPois ? ", pois" : "") + (wantIcons ? ", icons" : "") + ")…");
  const { F } = buildFeatures();
  // features live in MAP coords (the units elevation()/macroPixels sample) — query
  // exactly the image's map extent so every settlement/road matches the terrain.
  const feat = queryFeatures(F, g.originMapX, g.originMapY, g.originMapX + g.imgW * step, g.originMapY + g.imgH * step, wantPois, wantIcons);
  // NOTE: the sealed special locations (isle/dream) are NOT in any normal zone —
  // they live in zone[special] (bake with --special). The main terrain above
  // already excludes them (isle masked, dream neutralised in the worker branch).
  const meta = { zx, zy, step, MPX, zoneTiles: ZONE_TILES, imgW: g.imgW, imgH: g.imgH, originMapX: g.originMapX, originMapY: g.originMapY, image: `zone_${zx}_${zy}.png`, builtAt: new Date().toISOString().slice(0, 10) };
  // NPCs (opt-in with --npcs; the real world engine, minutes per zone). Off by
  // default so the common terrain+features bake stays fast.
  let npcs;
  if (argv.includes("--npcs")) {
    console.log("  extracting NPCs (real world engine — minutes)…");
    npcs = (await extractZoneNpcs(zx, zy, { log: s => process.stdout.write("    " + s + "\n") })).npcs;
  }
  const jsonPath = path.join(OUT, `zone_${zx}_${zy}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(npcs ? { meta, feat, npcs } : { meta, feat }));
  console.log(`  wrote ${jsonPath}  (${(fs.statSync(jsonPath).size / 1024).toFixed(0)} KB)${npcs ? ` — ${npcs.length} NPCs` : ""}`);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
}
main().catch(e => { console.error(e); process.exit(1); });
