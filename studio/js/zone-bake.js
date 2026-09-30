// ===== Our RPG Workshop — in-browser zone bake orchestrator =====
// Powers the Zones tab's "Generate zone" on the DEPLOYED site: runs the same
// six passes as tools/bake-zone.mjs, but in THIS browser — terrain+features
// through a pool of js/zone-worker.js renderers, then NPCs / city dossiers /
// monster spawns / shire merge / biome histograms through a pool of
// js/zone-bake-worker.js engines (the shared ZoneBakeCore algorithms) — and
// publishes the finished manifest + map to the server (server/src/zones.js)
// so the whole community views the zone forever without regenerating.
//
// The bake is RESUMABLE and SHARED: progress heartbeats to the server every
// ~30s (anyone watching the Zones tab sees the live bar), and the two long
// passes checkpoint their partial results every ~45s. A hard refresh — or a
// different signed-in player, once the lease goes stale — picks up from the
// last checkpoint instead of starting over.
//
//   ZoneBake.run(zx, zy, {onPct, onLog, npcId}) → Promise (resolves when
//   published; rejects with a friendly message otherwise). One at a time.
"use strict";

const ZoneBake = (function () {
  const ZONE_T = 15000, MPX = 64, STEP = 2;          // bake resolution — same as prerender-zone.mjs default
  const PREVIEW_STEP = 8;                            // the instant zoomed-out biome overview (~944px)
  const MERGE_MIN_TILES = 4500000, BIOME_STEP = 60;
  const WG = { seed: 1337, landE: 0.483, rockE: 0.655, chunk: 32, vcell: 144, pcell: 30, icell: 44, gensig: "studio" };
  // per-pass progress bands — MUST stay aligned with tools/bake-common.mjs.
  // (No monster-spawn pass: the zone pages never render spawn data.)
  const BANDS = [[0, 10], [10, 60], [60, 88], [88, 92], [92, 100]];
  const STAGE_MSGS = ["terrain & features", "NPCs", "shire dossiers & POIs", "merging shires", "biome tile histograms"];
  const HEARTBEAT_MS = 30000, CHECKPOINT_MS = 45000;

  let S = null;   // the one active bake's state

  // ---- server glue -------------------------------------------------------
  async function api(path, body) {
    const r = await Taiao.call(path, body ? { body } : {});
    if (!r || r.error) { const e = new Error((r && r.error) || "Server unreachable."); e.zone = r && r.zone; throw e; }
    return r;
  }
  const ckQuery = kind => "/api/zones/checkpoint?zx=" + S.zx + "&zy=" + S.zy + "&kind=" + kind;
  async function putCk(kind, body, contentType) {
    const res = await Taiao.raw(ckQuery(kind), { method: "PUT", body, contentType });
    if (!res.ok) {
      let msg = "Checkpoint upload failed (" + res.status + ").";
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
  }
  async function getCk(kind) {
    const res = await Taiao.raw(ckQuery(kind));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("Checkpoint download failed (" + res.status + ").");
    return res.json();
  }
  function setPct(stage, pct, msg) {
    S.stage = stage; S.pct = pct; S.msg = msg || STAGE_MSGS[stage] || "";
    if (S.ui.onPct) S.ui.onPct(pct, S.msg);
  }
  const bandPct = (stage, frac) => BANDS[stage][0] + Math.max(0, Math.min(1, frac)) * (BANDS[stage][1] - BANDS[stage][0]);
  const log = m => { if (S.ui.onLog) S.ui.onLog(m); };
  // advance to `stage` server-side (a heartbeat with the new stage/pct)
  const syncProgress = () => api("/api/zones/progress", { zx: S.zx, zy: S.zy, stage: S.stage, pct: S.pct, msg: S.msg }).catch(e => { throw e; });

  // ---- worker plumbing ---------------------------------------------------
  // One outstanding request per worker; stream messages go to the handlers.
  function spawn(file, initMsg) {
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker(STUDIO_BASE + "js/" + file); } catch (e) { reject(new Error("Couldn't start " + file)); return; }
      const wrap = {
        w, busy: false,
        request(msg, on) {
          return new Promise((res2, rej2) => {
            wrap.busy = true;
            const token = ++wrap._tok;
            w.onmessage = ev => {
              const d = ev.data;
              if (d.token !== token) return;
              if (d.error) { wrap.busy = false; rej2(new Error(d.error)); return; }
              if (d.log !== undefined) { if (on && on.log) on.log(d.log); return; }
              for (const k in d) if (k !== "token" && on && on[k]) on[k](d[k]);
              if (on && on.doneKey && d[on.doneKey] !== undefined) { wrap.busy = false; res2(d[on.doneKey]); }
            };
            w.onerror = err => { wrap.busy = false; rej2(new Error(err.message || file + " worker error")); };
            w.postMessage(Object.assign({ token }, msg));
          });
        },
        _tok: 0,
        kill() { try { w.terminate(); } catch (_) {} },
      };
      w.onmessage = ev => { if (ev.data && ev.data.ready) resolve(wrap); else if (ev.data && ev.data.error) reject(new Error(ev.data.error)); };
      w.onerror = err => reject(new Error(err.message || file + " failed to boot"));
      w.postMessage(Object.assign({ type: "init" }, WG));
    });
  }
  const poolSize = () => Math.min(Math.max(1, (navigator.hardwareConcurrency || 4) - 1), 6);
  async function bakePool() {
    if (S.pool) return S.pool;
    log("Booting " + poolSize() + " world-engine workers…");
    S.pool = await Promise.all(Array.from({ length: poolSize() }, () => spawn("zone-bake-worker.js")));
    return S.pool;
  }
  function killAll() {
    (S.pool || []).forEach(p => p.kill());
    (S.tpool || []).forEach(p => p.kill());
    S.pool = S.tpool = null;
  }
  // contiguous banding, same shape as the node fan-out
  function bands(items, n) {
    const groups = Array.from({ length: n }, () => []);
    const per = Math.ceil(items.length / n) || 1;
    items.forEach((it, i) => groups[Math.floor(i / per)].push(it));
    return groups.filter(g => g.length);
  }

  // ---- pass 0: terrain + features → manifest {meta, feat} + map.png ------
  // (region streaming needs custom per-message handlers, so this drives the
  // zone-worker pool directly instead of through wrap.request)
  const gridFor = step => {
    const zoneMap = ZONE_T / 2, MT = MPX * step;
    const cMap = S.zx * zoneMap, cMapY = S.zy * zoneMap;
    const mapMinX = cMap - zoneMap / 2, mapMinY = cMapY - zoneMap / 2;
    const mapMaxX = cMap + zoneMap / 2, mapMaxY = cMapY + zoneMap / 2;
    const mx0 = Math.floor(mapMinX / MT), mx1 = Math.floor((mapMaxX - 1e-6) / MT);
    const my0 = Math.floor(mapMinY / MT), my1 = Math.floor((mapMaxY - 1e-6) / MT);
    const cols = mx1 - mx0 + 1, rows = my1 - my0 + 1;
    return { MT, cols, rows, imgW: cols * MPX, imgH: rows * MPX, originMapX: mx0 * MT, originMapY: my0 * MT };
  };
  // render the whole zone at `step` across the terrain-worker pool, streaming
  // progress into the [f0,f1] slice of the pass-0 band. Returns the canvas.
  async function renderZoneCanvas(step, f0, f1, label) {
    const G = gridFor(step);
    const cv = document.createElement("canvas");
    cv.width = G.imgW; cv.height = G.imgH;
    const g = cv.getContext("2d");
    const total = G.cols * G.rows; let done = 0;
    const rowBands = bands(Array.from({ length: G.rows }, (_, i) => i), S.tpool.length);
    await Promise.all(rowBands.map((band, bi) => new Promise((res, rej) => {
      const w = S.tpool[bi].w, r0 = band[0], r1 = band[band.length - 1];
      const token = "t" + step + "_" + bi;
      w.onmessage = ev => {
        const d = ev.data;
        if (!d || d.token !== token) return;
        if (d.regionTile) {
          g.putImageData(new ImageData(new Uint8ClampedArray(d.px), MPX, MPX), d.regionTile.ox, r0 * MPX + d.regionTile.oy);
          done++;
          if (done % 8 === 0 || done === total) setPct(0, bandPct(0, f0 + (f1 - f0) * done / total), label + " " + done + "/" + total);
          return;
        }
        if (d.regionDone) res();
        if (d.error) rej(new Error(d.error));
      };
      w.onerror = err => rej(new Error(err.message || "terrain worker error"));
      w.postMessage({ type: "region", token,
        mapX0: G.originMapX, mapY0: G.originMapY + r0 * G.MT,
        mapX1: G.originMapX + G.cols * G.MT, mapY1: G.originMapY + (r1 + 1) * G.MT,
        step, MPX, MAP_COLORS: ZMAP_COLORS, MAP_WATER: ZMAP_WATER });
    })));
    return cv;
  }
  async function passTerrainImpl() {
    const { zx, zy } = S;
    const nT = poolSize();
    S.tpool = await Promise.all(Array.from({ length: nT }, () => spawn("zone-worker.js")));

    // FIRST: the fast zoomed-out overview — the whole zone with every biome
    // visible, rendered in well under a minute and pushed to the server, so
    // the baker (and everyone watching the progress bar) sees the zone's
    // shape immediately while the real bake grinds on.
    const pv = await renderZoneCanvas(PREVIEW_STEP, 0.02, 0.14, "biome overview");
    try {
      const pvBlob = await new Promise((res, rej) => pv.toBlob(b => b ? res(b) : rej(new Error("preview encode failed")), "image/png"));
      if (S.ui.onPreview) { try { S.ui.onPreview(URL.createObjectURL(pvBlob)); } catch (_) {} }
      await putCk("preview", pvBlob, "image/png");
    } catch (e) { log("Overview upload skipped: " + e.message); }   // non-fatal — purely cosmetic

    // then the real thing at full bake resolution
    log("Rendering terrain across " + nT + " workers…");
    const G = gridFor(STEP);
    const { imgW, imgH, originMapX, originMapY } = G;
    const cv = await renderZoneCanvas(STEP, 0.15, 0.8, "terrain");

    // features over the image's exact map extent (same as queryFeatures in
    // prerender-zone.mjs: villages/rivers/roads; POIs/icons stay out of the
    // default bake — the cities pass gathers POIs into the shire dossiers)
    setPct(0, bandPct(0, 0.82), "settlements, roads & rivers");
    const feat = { villages: [], pois: [], icons: [], rivers: [], roads: [] };
    await new Promise((res, rej) => {
      const w = S.tpool[0].w, token = "feat";
      w.onmessage = ev => {
        const d = ev.data;
        if (!d || d.token !== token) return;
        ["villages", "pois", "icons", "rivers", "roads"].forEach(k => { if (d[k]) feat[k] = d[k]; });
        if (d.featuresDone) res();
        if (d.error) rej(new Error(d.error));
      };
      w.onerror = err => rej(new Error(err.message || "feature query failed"));
      w.postMessage({ type: "features", token, vcell: WG.vcell, pcell: WG.pcell,
        tMinX: originMapX, tMinY: originMapY,
        tMaxX: originMapX + imgW * STEP, tMaxY: originMapY + imgH * STEP });
    });
    // compact exactly like prerender-zone.mjs queryFeatures (int coords,
    // decimated polylines) so the manifest matches a node bake byte-for-shape
    const ri = n => Math.round(n);
    const simp = pts => { if (!pts || pts.length <= 3) return (pts || []).map(q => [ri(q[0]), ri(q[1])]); const out = [pts[0].map(ri)]; for (let i = 1; i < pts.length - 1; i += 2) out.push([ri(pts[i][0]), ri(pts[i][1])]); out.push(pts[pts.length - 1].map(ri)); return out; };
    feat.villages.forEach(v => { v.x = ri(v.x); v.y = ri(v.y); });
    feat.roads.forEach(r => { r.pts = simp(r.pts); });
    feat.rivers.forEach(r => { r.polys = (r.polys || []).map(simp); });

    (S.tpool || []).forEach(p => p.kill()); S.tpool = null;

    setPct(0, bandPct(0, 0.9), "encoding map image");
    const blob = await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("PNG encode failed")), "image/png"));
    const meta = { zx, zy, step: STEP, MPX, zoneTiles: ZONE_T, imgW, imgH, originMapX, originMapY,
      image: "zone_" + zx + "_" + zy + ".png", builtAt: new Date().toISOString().slice(0, 10) };
    const man = { meta, feat };
    setPct(0, bandPct(0, 0.95), "uploading map (" + (blob.size / 1048576).toFixed(1) + " MB)");
    await putCk("map", blob, "image/png");
    await putCk("manifest", JSON.stringify(man), "application/json");
    setPct(1, BANDS[1][0], STAGE_MSGS[1]);
    await syncProgress();
    return man;
  }

  // Throttled, serialized checkpoint uploader. checkpoint(false) fires at
  // most every CHECKPOINT_MS; checkpoint(true) ALWAYS uploads (queued after
  // any in-flight upload), so the end-of-pass state is never lost.
  function makeCheckpointer(kind, snapshot) {
    let lastCk = Date.now(), chain = Promise.resolve();
    return force => {
      if (!force && Date.now() - lastCk < CHECKPOINT_MS) return chain;
      lastCk = Date.now();
      chain = chain
        .then(() => putCk(kind, JSON.stringify(snapshot()), "application/json"))
        .catch(e => log("Checkpoint upload failed: " + e.message));
      return chain;
    };
  }

  // ---- pass 1: NPCs (fanned out, per-settlement checkpoints) -------------
  async function ensureEnum() {
    if (S.enum) return S.enum;
    const pool = await bakePool();
    log("Enumerating settlements…");
    S.enum = await pool[0].request({ type: "enumerate", zx: S.zx, zy: S.zy }, { doneKey: "enumerated" });
    // deterministic order → stable indices for the resume checkpoints
    S.enum.settlements.sort((a, b) => a.y - b.y || a.x - b.x);
    return S.enum;
  }
  async function passNpcs(man, have) {
    const { zx, zy } = S;
    const pool = await bakePool();
    const { settlements, all, cities } = await ensureEnum();
    let doneIdx = new Set(), records = [];
    if (have && have.npcs) {
      const ck = await getCk("npcs");
      if (ck && Array.isArray(ck.done) && Array.isArray(ck.records)) {
        doneIdx = new Set(ck.done); records = ck.records;
        log("Resuming NPCs: " + doneIdx.size + "/" + settlements.length + " settlements already done (" + records.length + " NPCs).");
      }
    }
    const todo = settlements.map((s, i) => ({ index: i, settlement: s })).filter(e => !doneIdx.has(e.index));
    const checkpoint = makeCheckpointer("npcs", () => ({ done: [...doneIdx], records }));
    if (todo.length) {
      await Promise.all(bands(todo, pool.length).map((group, gi) => pool[gi].request(
        { type: "npcs", zx, zy, group, all },
        {
          doneKey: "npcsDone",
          log: m => log("[w" + gi + "] " + m),
          settlementDone: d => {
            doneIdx.add(d.index); records.push(...d.records);
            setPct(1, bandPct(1, doneIdx.size / settlements.length),
              "NPCs — " + doneIdx.size + "/" + settlements.length + " settlements (" + records.length + " found)");
            checkpoint(false);
          },
        }
      )));
    }
    await checkpoint(true);
    log(records.length + " raw NPCs; naming…");
    man.npcs = await pool[0].request({ type: "nameAll", records, zx, zy, cities }, { doneKey: "npcs" });
    await putCk("manifest", JSON.stringify(man), "application/json");
    setPct(2, BANDS[2][0], STAGE_MSGS[2]);
    await syncProgress();
  }

  // ---- pass 2: city dossiers (single worker; the POI query is the slow bit) ----
  async function passCities(man) {
    const pool = await bakePool();
    setPct(2, bandPct(2, 0.1), "shire dossiers & POIs");
    man.cities = await pool[0].request(
      { type: "cities", zx: S.zx, zy: S.zy, pois: true },
      { doneKey: "cities", log: m => { log(m); setPct(2, bandPct(2, 0.5), "shire dossiers — " + m); } });
    await putCk("manifest", JSON.stringify(man), "application/json");
    setPct(3, BANDS[3][0], STAGE_MSGS[3]);
    await syncProgress();
  }

  // ---- passes 3+4: merge shires, biome histograms ------------------------
  async function passMerge(man) {
    const pool = await bakePool();
    const merged = await pool[0].request({ type: "merge", man, minTiles: MERGE_MIN_TILES }, { doneKey: "merged", log });
    await putCk("manifest", JSON.stringify(merged), "application/json");
    setPct(4, BANDS[4][0], STAGE_MSGS[4]);
    await syncProgress();
    return merged;
  }
  async function passBiomes(man) {
    const pool = await bakePool();
    const done = await pool[0].request({ type: "biomes", man, zx: S.zx, zy: S.zy, step: BIOME_STEP }, { doneKey: "biomed", log });
    await putCk("manifest", JSON.stringify(done), "application/json");
    return done;
  }

  // ---- publish -----------------------------------------------------------
  async function publishZone(man) {
    setPct(4, 99, "publishing");
    // pages.json: the compact npc id→name index the server uses to synthesize
    // each baked NPC's static page shell (no HTML is ever stored)
    let pages = null;
    if (S.ui.npcId) {
      try { pages = { npcs: (man.npcs || []).map(n => ({ id: S.ui.npcId(n), name: n.name })) }; } catch (_) {}
    }
    if (pages) await putCk("pages", JSON.stringify(pages), "application/json");
    const r = await api("/api/zones/publish", { zx: S.zx, zy: S.zy });
    setPct(5, 100, "published");
    return r;
  }

  // ---- main --------------------------------------------------------------
  async function run(zx, zy, ui) {
    if (S) throw new Error("A zone is already generating — one at a time.");
    if (typeof Worker === "undefined") throw new Error("This browser has no Web Workers — zone generation needs them.");
    if (!Taiao.logged()) throw new Error("Sign in to generate zones — the finished zone uploads to your account.");
    S = { zx, zy, ui: ui || {}, stage: 0, pct: 0, msg: "claiming", pool: null, tpool: null, enum: null, hb: null };
    try {
      const claim = await api("/api/zones/claim", { zx, zy });
      let stage = (claim.zone && claim.zone.status === "baking") ? (claim.zone.stage || 0) : 0;
      const have = claim.checkpoints || {};
      let man = null;
      if (stage > 0 && have.manifest) {
        log("Resuming bake at " + (STAGE_MSGS[stage] || "publish") + " (" + Math.round(claim.zone.pct) + "%)…");
        man = await getCk("manifest");
      }
      if (!man) stage = 0;
      if (stage > 0 && !have.map) stage = 0;   // map lost — redo the terrain pass
      setPct(stage, Math.max(claim.zone ? claim.zone.pct : 0, BANDS[Math.min(stage, 4)][0]), STAGE_MSGS[Math.min(stage, 4)]);
      S.hb = setInterval(() => {
        api("/api/zones/progress", { zx, zy, stage: S.stage, pct: S.pct, msg: S.msg })
          .catch(e => { if (/holds this bake|No bake in progress/.test(e.message)) { S.lost = e.message; } });
      }, HEARTBEAT_MS);

      if (stage <= 0) man = await passTerrainImpl();
      if (S.lost) throw new Error(S.lost);
      if (stage <= 1) await passNpcs(man, have);
      if (S.lost) throw new Error(S.lost);
      if (stage <= 2) await passCities(man);
      if (S.lost) throw new Error(S.lost);
      if (stage <= 3) man = await passMerge(man);
      if (stage <= 4) man = await passBiomes(man);
      const r = await publishZone(man);
      if (typeof ZoneStore !== "undefined") ZoneStore.invalidate();
      return r;
    } finally {
      if (S) { clearInterval(S.hb); killAll(); }
      S = null;
    }
  }

  function cancel() { if (S) { killAll(); } }
  const active = () => !!S;

  return { run, cancel, active };
})();
