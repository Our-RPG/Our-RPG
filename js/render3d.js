// ===== HD-2D renderer: 3D world, billboard pixel sprites (three.js) =====
// Game logic stays on the 2D grid; this layer only draws it in 3D and maps
// mouse picks back to tiles. Effects (splats, floats, HP bars, projectiles)
// are drawn on a 2D overlay canvas using projected positions.
"use strict";

// Callers (3):
//  main.js:27,28 main/assets.js:36
const R3D = (() => {
  let renderer, scene, camera, ready = false;
  let overlay, octx, overlayCssW = 0, overlayCssH = 0;
  let _candleKey;   // resolved candle object sprite for placed village candles (day/night)
  let _bioLights = [];   // per-frame glow points for bioluminescent-biome decor (mushrooms/trees/rocks)
  let atlas; // { canvas, tex, cells: {key:{cx,cy}}, cols, rows, mat }
  // community overlay: atlas keys patched before the atlas itself exists yet
  // (boot order — the overlay can run before buildAtlas/buildAtlasAsync has
  // fired) queue here and flush once _finishAtlas hands back a real atlas.
  let _pendingAtlasPatches = [];
  let sharedMat, geomCache = {}, shadowMat, shadowGeom;
  // ---- snow cover shading (weather.js snowNow) ----
  // One shared uniform frosts the whole world as snow settles: every surface
  // that faces UP — terrain tiers, bridge decks, roofs, wall tops — whitens
  // (flat-face normal from screen-space derivatives), and billboard objects
  // (trees, rocks, furniture) whiten from the crown down. Patched into the
  // shared materials at creation via onBeforeCompile: zero rebakes, the
  // uniform just rises and falls with the cover integral. Water keeps its
  // blue (blue-dominance mask) and the sea backdrop plane is left unpatched;
  // ground quads carry an aSnow vertex attribute so INTERIOR floors (inside
  // a building footprint) never frost — geometry without the attribute
  // defaults to 0, which only ever affects vertical faces anyway.
  const snowUni = { value: 0 };
  // ---- colour temperature (sun position → light colour) ----
  // uTint multiplies every world material's final colour: neutral white under
  // a high sun, golden as the sun sinks toward the horizon (grazing light —
  // which the seasonal sun geometry makes PERMANENT through subarctic winter
  // days and under the Fullday Pole's midnight sun), and the cool blue hour
  // once the sun is down. Shares the snow patches where they exist; creature
  // sprites, the sea backdrop and the sky/fog get a tint-only patch so the
  // whole outside world sits in one light. Applied AFTER the snow mix, so
  // snowfields glow gold at sunset like the real thing.
  const tintUni = { value: new THREE.Color(1, 1, 1) };
  // golden-hour saturation: >1 through the low-sun window so dusk POPS instead
  // of just yellowing (applied post-fog, so the haze itself goes rich, not grey)
  const satUni = { value: 1 };
  const TINT_DECL = "\nuniform vec3 uTint;\nuniform float uSat;";
  const TINT_GLSL = `
      gl_FragColor.rgb = mix(vec3(dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114))), gl_FragColor.rgb, uSat);
      gl_FragColor.rgb *= uTint;`;
  function tintPatch(mat) {
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTint = tintUni;
      sh.uniforms.uSat = satUni;
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>" + TINT_DECL)
        .replace("#include <dithering_fragment>", "#include <dithering_fragment>" + TINT_GLSL);
    };
  }
  function snowPatchUp(mat, forceAttr1) {
    // aSnowOff is an EXCLUSION mask (1 = never frost): geometry that doesn't
    // carry the attribute (roofs, skirts, structure faces — they share
    // sharedMat) defaults to 0 and frosts normally; only the chunk ground
    // mesh sets it, to keep INTERIOR floors bare.
    mat.onBeforeCompile = sh => {
      sh.uniforms.uSnow = snowUni;
      sh.uniforms.uTint = tintUni;
      sh.uniforms.uSat = satUni;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aSnowOff;\nvarying vec3 vSnowP;\nvarying float vSnowA;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSnowP = (modelMatrix * vec4(position, 1.0)).xyz;\nvSnowA = " + (forceAttr1 ? "1.0" : "1.0 - aSnowOff") + ";");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vSnowP;\nvarying float vSnowA;\nuniform float uSnow;" + TINT_DECL)
        .replace("#include <dithering_fragment>", `#include <dithering_fragment>
      vec3 snN = normalize(cross(dFdx(vSnowP), dFdy(vSnowP)));
      float snUp = smoothstep(0.55, 0.85, abs(snN.y));
      float snWet = smoothstep(0.03, 0.15, gl_FragColor.b - max(gl_FragColor.r, gl_FragColor.g));
      float snA = uSnow * snUp * vSnowA * (1.0 - 0.9 * snWet);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.93, 0.95, 1.0), snA * 0.85);` + TINT_GLSL);
    };
  }
  function snowPatchTop(mat) {   // billboards: unit plane, local y -0.5..+0.5
    mat.onBeforeCompile = sh => {
      sh.uniforms.uSnow = snowUni;
      sh.uniforms.uTint = tintUni;
      sh.uniforms.uSat = satUni;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vSnowT;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSnowT = position.y + 0.5;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vSnowT;\nuniform float uSnow;" + TINT_DECL)
        .replace("#include <dithering_fragment>", `#include <dithering_fragment>
      float snA = uSnow * smoothstep(0.35, 0.9, vSnowT);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.94, 0.96, 1.0), snA * 0.7);` + TINT_GLSL);
    };
  }
  const meshes = new Map();   // id -> mesh (nodes: "n"+id, monsters: "m"+i, etc.)
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const _v = new THREE.Vector3();
  // smoothed follow point (separate from the orbit so rotation is a clean arc,
  // never a chord that dips toward the player) and the shared billboard orientation
  let followX = null, followZ = null, followY = 0;
  // Dream Forest (gameplay/dream.js): a silent relocation translates the
  // player AND this follow point by the same delta, so the camera never
  // notices the world moved underneath it. (WX(px) = tile + 0.5, so the
  // shift is in plain tile units.)
  if (typeof window !== "undefined")
    window.__r3dShiftFollow = (dx, dz) => {
      if (followX !== null) { followX += dx; followZ += dz; }
    };
  // nearest of the 8 sprite directions to the *smoothed* camera angle, so directional
  // frames flip in sync with the visible rotation instead of snapping to the target
  // step the instant a key is pressed (which read as billboards lagging the ground).
  let camDir = 0;
  const _up = new THREE.Vector3(0, 1, 0);
  const _tiltAxis = new THREE.Vector3();
  const _qYaw = new THREE.Quaternion(), _qTilt = new THREE.Quaternion(), _bbQuat = new THREE.Quaternion();
  const SKY = 0x87b5d4;
  // Golden hour: at low zoom the camera never pitches above the horizon, so
  // the "sky" the player sees IS the fog colour (== scene.background). Dusk
  // therefore lives in that background colour: lerp SKY → this apricot as the
  // sun sinks, instead of multiplying SKY by the warm tint (blue × orange =
  // muddy grey-green).
  const SKY_DUSK = new THREE.Color(0xf0a05c);
  const _skyTarget = new THREE.Color();
  let duskW = 0;        // 0 high sun … 1 sun on the horizon (this frame, incl. cloud cut)
  let wxCloudNow = 0;   // this frame's weather cloud scalar (for the overlay sun glow)
  // sea sun-glint uniforms: xy = ground dir TOWARD the sun, z = strength, w = time (s)
  const glintUni = { value: new THREE.Vector4(-0.7, -0.55, 0, 0) };
  const glintCamUni = { value: new THREE.Vector3() };
  // the sea backdrop's haze ramp mirrors depth fog's near/far (see the frame
  // loop) so the plane fades in exactly where fog already hides real terrain.
  const seaHazeUni = { value: new THREE.Vector2(28, 52) };
  // ---- zoom-tilt: zoomed out, the camera levels toward the horizon ----
  // The classic orbit pitches ~44° down, so even the top of the screen looks
  // 20° BELOW horizontal — distant mountains and the sky are mathematically
  // never in frame. tiltK eases 0 (camZoom ≤ 1.6: the close-up look, exactly
  // as before) → 1 (max zoom: the aim point rises, the view levels to ~21°,
  // and the far-terrain ring, sky dome, sun and clouds come into frame).
  let tiltK = 0;
  function tiltKFor(z) {
    const t = Math.max(0, Math.min(1, (z - 1.6) / 1.4));
    return t * t * (3 - 2 * t);
  }
  // sky dome (gradient + the real sun disc) and the horizon cloud deck
  let skyDome = null, skyMat = null;
  const _zenTarget = new THREE.Color();
  const ZEN_DAY = 0x4d7fae, ZEN_DUSK_C = new THREE.Color(0x655f8e);
  let clouds = null;
  const CELL = 33, CSZ = 32; // atlas cell pitch / drawable size (32px for painted tiles)
  const FLAT_DECOR = new Set(["lily", "lily2", "lily3", "stepstone", "tilled_soil",
    "footprint_moa"]); // the easter-egg trail (chunks.js) — a flat pressed print, never a billboard
  // pixellab masonry props that happen to start with "wall_" but are free-standing
  // billboards (rubble piles, brick/plaster sections, a wall bracket) — not the
  // structural wall_wood/wall_stone blocks the maze/ruins bake flat. Let these
  // fall through to objForKey so they show their real art.
  const BILLBOARD_WALL = new Set(["wall_brick", "wall_keep", "wall_plaster", "wall_rubble", "wall_bracket"]);
  // ---- real 3D structures (buildings / city walls) ----
  // Building walls, roofs, doors, gates and ladders are true tile-edge-aligned
  // geometry built by the structure system (see "structural geometry" section),
  // NOT billboards. Wall decor tiles carrying a "#dir" side tag are therefore
  // skipped by the chunk mesh; only bare wall decor (maze/ruins rubble) renders
  // as a small stand-alone wall block.
  const STOREY_H = 1.8;    // wall band height per storey
  const FLOOR_T = 0.06;    // plinth slab height (buildings sit above the terrain)
  const DOOR_H = 1.25;     // door leaf / opening height (lintel band above)
  const CITYWALL_H = 2.4;  // city wall ring height (plus merlons)
  const RIPPLE_FRAMES = ["rippleF0", "rippleF1", "rippleF2", "rippleF3"];

  // ---------- atlas ----------
  function drawSprTo(c2, key, dx, dy) {
    const def = SPR[key];
    if (!def) return;
    const [sheet, c, r, extra] = def;
    const img = IMGS[sheet];
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const st = SHEET_TILE[sheet] || 16;
    c2.save();
    if (extra && extra.filter) c2.filter = extra.filter;
    if (extra && extra.rot) {
      c2.translate(dx + CSZ / 2, dy + CSZ / 2);
      c2.rotate(extra.rot * Math.PI / 180);
      c2.translate(-(dx + CSZ / 2), -(dy + CSZ / 2));
    }
    const off = SHEET_OFFSET[sheet];
    const sx = (extra && extra.sx != null ? extra.sx : c * (SHEET_NOPAD.has(sheet) ? st : st + 1)) + (off ? off.ox : 0);
    const sy = (extra && extra.sy != null ? extra.sy : r * (SHEET_NOPAD.has(sheet) ? st : st + 1)) + (off ? off.oy : 0);
    const sw = extra && extra.sw ? extra.sw : st;
    const sh = extra && extra.sh ? extra.sh : st;
    if (SHEET_NOPAD.has(sheet)) {
      if (SHEET_COLORKEY.has(sheet)) {
        // color-key solid black → transparent (RGB sheets only)
        const tmp = document.createElement("canvas");
        tmp.width = CSZ; tmp.height = CSZ;
        const tc = tmp.getContext("2d");
        tc.imageSmoothingEnabled = false;
        tc.drawImage(IMGS[sheet], sx, sy, sw, sh, 0, 0, CSZ, CSZ);
        const id = tc.getImageData(0, 0, CSZ, CSZ);
        const d = id.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] < 12 && d[i + 1] < 12 && d[i + 2] < 12) d[i + 3] = 0;
        }
        tc.putImageData(id, 0, 0);
        c2.drawImage(tmp, dx, dy);
      } else {
        c2.drawImage(IMGS[sheet], sx, sy, sw, sh, dx, dy, CSZ, CSZ);
      }
    } else {
      c2.drawImage(IMGS[sheet], sx, sy, sw, sh, dx, dy, CSZ, CSZ);
    }
    c2.restore();
  }

  // Atlas bake, split three ways so the BOOT can run it in painted slices
  // with a real progress fraction (buildAtlasAsync — the loading bar's
  // "Baking the sprite atlas…" stage) while the classic synchronous
  // buildAtlas() drains the same parts as a fallback. One drawing code path.
  const ATLAS_COLS = 62; // 62*33 = 2046 cells <= 2048px row budget
  // The bake PLAN (which keys land in which cells) — split out of _planAtlas
  // so _atlasRestore can validate a cached atlas against the CURRENT plan
  // without allocating the multi-MB canvas.
  function _planAtlasKeys() {
    // Embedded data URIs should keep the canvas origin-clean. This guard remains
    // for bad or stale asset data and skips at_* keys if taint is detected.
    let atlasOk = false;
    try {
      if (IMGS["a"] && IMGS["a"].complete && IMGS["a"].naturalWidth > 0) {
        const t = document.createElement("canvas"); t.width = t.height = 2;
        const tc = t.getContext("2d");
        tc.drawImage(IMGS["a"], 0, 0, 2, 2);
        tc.getImageData(0, 0, 2, 2); // throws SecurityError if tainted
        atlasOk = true;
      }
    } catch (e) { /* atlas sheet unavailable; at_* tiles will use bg_* terrain tiles */ }

    const keys = Object.keys(SPR).filter(k => atlasOk || !k.startsWith("at_"));
    const composites = { ply: ["body_player", "shirt_green", "hair_brown"], npc0: ["body_npc", "shirt_orange", "hat_white"] };
    VILLAGER_LOOKS.forEach((layers, i) => { composites["vill" + i] = layers.map(l => l[0]); });
    for (const kind in MONSTERS) {
      composites["mon_" + kind] = MONSTERS[kind].spr.map(l => l[0]);
      if (MONSTERS[kind].dirSpr) {
        // "_v" GIANTS (and "_baby" young) reuse their base creature's 8-dir sprite —
        // the monster's own scale (giant x1.5 / baby x0.5) sizes them. No dedicated
        // giant/baby sheet needed; buffalo_v etc. no longer render blank.
        const base = kind.replace(/(_v)?(_baby)?$/, "");
        for (const d of DIR8) composites["mon_" + kind + "_" + d] = ["mcd_" + base + "_" + d];
      }
    }
    const all = [...keys, ...Object.keys(composites), ...RIPPLE_FRAMES, "tilled_soil"];
    return { all, composites };
  }
  function _planAtlas() {
    const { all, composites } = _planAtlasKeys();
    const rows = Math.ceil(all.length / ATLAS_COLS);
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = Math.pow(2, Math.ceil(Math.log2(rows * CELL)));
    const c2 = canvas.getContext("2d");
    c2.imageSmoothingEnabled = false;
    return { all, composites, canvas, c2, cells: {} };
  }
  function _drawAtlasCell(P, key, i) {
    const { composites, c2, cells } = P;
    const cx = (i % ATLAS_COLS) * CELL, cy = Math.floor(i / ATLAS_COLS) * CELL;
    cells[key] = { cx, cy };
    {
      if (composites[key]) {
        for (const layer of composites[key]) drawSprTo(c2, layer, cx, cy);
      } else if (RIPPLE_FRAMES.includes(key)) {
        // Procedural water-swirl: concentric rings that expand and fade, phased
        // across the 4 frames so the animation reads as ripples spreading out.
        // Drawn fairly opaque over a transparent cell (the shared material
        // alpha-tests at 0.5, dropping the faint edges) — no more white square.
        const S = CSZ, ox = cx + S / 2, oy = cy + S / 2, RMAX = S * 0.46;
        const ph = RIPPLE_FRAMES.indexOf(key) / RIPPLE_FRAMES.length;
        c2.save();
        for (let k = 0; k < 3; k++) {
          const t = (ph + k / 3) % 1;                    // this ring's progress 0..1
          const a = 1 - t * 1.15;                        // bright when new, gone when wide
          if (a <= 0.05) continue;
          c2.beginPath();
          c2.arc(ox, oy, RMAX * (0.12 + t * 0.88), 0, Math.PI * 2);
          c2.strokeStyle = "rgba(214,238,255," + a.toFixed(3) + ")";
          c2.lineWidth = Math.max(1.2, S * 0.08 * (1 - t * 0.5));
          c2.stroke();
        }
        c2.fillStyle = "rgba(235,248,255,0.85)";         // disturbed-water glint
        c2.beginPath(); c2.arc(ox, oy, S * 0.05, 0, Math.PI * 2); c2.fill();
        c2.restore();
      } else if (key === "tilled_soil") {
        // hoed earth: a filled brown cell with darker ploughed furrow rows,
        // laid flat on the ground under a crop-ready plot
        const S = CSZ;
        c2.fillStyle = "#6b4a2c"; c2.fillRect(cx, cy, S, S);
        c2.strokeStyle = "#4e341d"; c2.lineWidth = Math.max(1, S * 0.06);
        for (let ry = 1; ry < 5; ry++) {
          const yy = cy + (S * ry) / 5;
          c2.beginPath(); c2.moveTo(cx + 1, yy); c2.lineTo(cx + S - 1, yy); c2.stroke();
        }
        c2.strokeStyle = "rgba(120,86,52,0.7)"; c2.lineWidth = 1;
        for (let ry = 0; ry < 5; ry++) {
          const yy = cy + (S * ry) / 5 + S / 10;
          c2.beginPath(); c2.moveTo(cx + 1, yy); c2.lineTo(cx + S - 1, yy); c2.stroke();
        }
      } else {
        drawSprTo(c2, key, cx, cy);
      }
    }
  }
  function _finishAtlas(P) {
    const tex = new THREE.CanvasTexture(P.canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    atlas = { canvas: P.canvas, tex, cells: P.cells };
    sharedMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide,
    });
    snowPatchUp(sharedMat);   // terrain/decks frost under snow cover (aSnow attr)
    // drain anything the community overlay tried to patch before the atlas
    // existed — cells that still don't resolve (unknown key) are dropped
    if (_pendingAtlasPatches.length) {
      const pending = _pendingAtlasPatches; _pendingAtlasPatches = [];
      const c2p = atlas.canvas.getContext("2d");
      c2p.imageSmoothingEnabled = false;
      for (const [key, img] of pending) {
        const cell = atlas.cells[key];
        if (!cell) continue;
        c2p.clearRect(cell.cx, cell.cy, CSZ, CSZ);
        c2p.drawImage(img, cell.cx, cell.cy, CSZ, CSZ);
      }
      atlas.tex.needsUpdate = true;
    }
  }
  // Community overlay: bake replacement art for one atlas cell (a plain
  // sprite key, or a composite key like "mon_<kind>_<dir>") in place on the
  // already-baked atlas canvas — same trick as main/assets.js patchSheetRects
  // for the 2D IMGS sheets, since the atlas is baked exactly once and nothing
  // else ever re-reads it. Queues (and flushes from _finishAtlas, above) when
  // the atlas hasn't been built yet.
  function patchAtlasKey(key, img) {
    if (!atlas || !atlas.cells[key]) { _pendingAtlasPatches.push([key, img]); return false; }
    const { cx, cy } = atlas.cells[key];
    const c2 = atlas.canvas.getContext("2d");
    c2.imageSmoothingEnabled = false;
    c2.clearRect(cx, cy, CSZ, CSZ);
    c2.drawImage(img, cx, cy, CSZ, CSZ);
    atlas.tex.needsUpdate = true;
    return true;
  }
  // Any sheet pushed into SHEET_KEYS by a js/sprites/*-data.js file (not just
  // the fixed CORE_SHEET_KEYS set) streams in AFTER boot (main/assets.js
  // loadAssets) — but the atlas bake above typically starts the moment core
  // assets are ready, i.e. BEFORE those deferred sheets finish decoding. Any
  // atlas cell sourced from one (e.g. the five crop growth-stage sheets,
  // "cg"/"co"/"ch"/"cp"/"cf") bakes blank and silently stays blank forever,
  // since the atlas is baked exactly once. Re-bake every cell that reads from
  // a sheet once it actually finishes loading, on every boot (not just when
  // a community-overlay patch targets one specific key).
  if (typeof document !== "undefined") {
    document.addEventListener("taiao-sheet-loaded", e => {
      const sheet = e.detail && e.detail.sheet;
      if (!sheet || !atlas) return;
      const c2 = atlas.canvas.getContext("2d");
      c2.imageSmoothingEnabled = false;
      let any = false;
      for (const key in atlas.cells) {
        const def = SPR[key];
        if (!def || def[0] !== sheet) continue;
        const { cx, cy } = atlas.cells[key];
        c2.clearRect(cx, cy, CSZ, CSZ);
        drawSprTo(c2, key, cx, cy);
        any = true;
      }
      if (any) atlas.tex.needsUpdate = true;
    });
  }
  function buildAtlas() {
    const P = _planAtlas();
    P.all.forEach((key, i) => _drawAtlasCell(P, key, i));
    _finishAtlas(P);
  }
  // ---- baked-atlas IDB cache ----
  // The bake is a pure function of the sheet art + the bake code, both
  // captured by ATLAS_SIG (tools/build.mjs) — so the finished canvas caches
  // as a PNG blob and a warm boot restores it in ~200ms instead of re-baking
  // for 2-6s. Community art patches apply ON TOP after restore, exactly as
  // they do after a fresh bake (they arrive at runtime, never cached here).
  function _atlasDb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("taiao-atlas", 1);
      r.onupgradeneeded = e => e.target.result.createObjectStore("a");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function _atlasRestore() {
    if (typeof ATLAS_SIG === "undefined" || typeof indexedDB === "undefined") return false;
    try {
      const db = await _atlasDb();
      const rec = await new Promise((res, rej) => {
        const r = db.transaction("a").objectStore("a").get("atlas");
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      if (!rec || rec.sig !== ATLAS_SIG || !rec.blob || !rec.cells) return false;
      // Integrity gates — ATLAS_SIG (sheet filenames + this file) can't see
      // everything the bake depends on, and a bad cached atlas is CATASTROPHIC
      // but silent: a ground key with no (or a blank) cell drops that tile's
      // quad from the chunk mesh entirely, so the sea backdrop / far-LOD show
      // through as flat light-blue / biome-colour patches over whole regions.
      // (a) plan drift: the key list lives in DATA (SPR/MONSTERS/…) which can
      // change without touching the sheets or this file — every key the
      // current plan bakes must exist in the record at the exact cell the
      // current bake would use.
      const plan = _planAtlasKeys().all;
      if (Object.keys(rec.cells).length !== plan.length) return false;
      for (let i = 0; i < plan.length; i++) {
        const c = rec.cells[plan[i]];
        if (!c || c.cx !== (i % ATLAS_COLS) * CELL || c.cy !== Math.floor(i / ATLAS_COLS) * CELL)
          return false;
      }
      const bmp = await createImageBitmap(rec.blob);
      const cv = document.createElement("canvas");
      cv.width = bmp.width; cv.height = bmp.height;
      const c2 = cv.getContext("2d");
      c2.imageSmoothingEnabled = false;
      c2.drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      // (b) blank-pixel probe: 2D canvases can lose their GPU backing under
      // memory pressure (e.g. an in-browser zone bake) and toBlob then
      // snapshots transparent — persisting a blank/partial atlas forever.
      // Terrain tile art is fully opaque, so a transparent centre pixel in
      // any sampled ground cell means the blob is bad: re-bake.
      const gk = plan.filter(k => k.startsWith("bg_") || k === "dirt" || k === "tilled_soil" || k === "floor_stone");
      const gstep = Math.max(1, Math.floor(gk.length / 40));
      for (let i = 0; i < gk.length; i += gstep) {
        const c = rec.cells[gk[i]];
        if (c2.getImageData(c.cx + (CSZ >> 1), c.cy + (CSZ >> 1), 1, 1).data[3] < 8) return false;
      }
      _finishAtlas({ canvas: cv, cells: rec.cells });
      return true;
    } catch (e) { return false; } // corrupt/private mode — bake as before
  }
  function _atlasPersist(P) {
    if (typeof ATLAS_SIG === "undefined" || typeof indexedDB === "undefined") return;
    try {
      P.canvas.toBlob(blob => {
        if (!blob) return;
        _atlasDb().then(db => {
          db.transaction("a", "readwrite").objectStore("a")
            .put({ sig: ATLAS_SIG, blob, cells: P.cells }, "atlas");
        }).catch(() => { /* best effort */ });
      }, "image/png");
    } catch (e) { /* best effort */ }
  }
  // boot path: same bake, sliced ~60ms at a time with a paint (and a real
  // completed-cells fraction to `tick`) between slices, so the loading bar
  // moves through the multi-hundred-ms atlas stage instead of freezing.
  // (Slices much finer than this spend more time waiting on vsync than
  // drawing — under CPU contention each paint can cost a whole slow frame.)
  async function buildAtlasAsync(tick) {
    if (atlas) { if (tick) tick(1); return true; }
    if (await _atlasRestore()) { if (tick) tick(1); return true; }
    const P = _planAtlas();
    let last = performance.now();
    for (let i = 0; i < P.all.length; i++) {
      _drawAtlasCell(P, P.all[i], i);
      if (performance.now() - last > 60) {
        if (tick) tick(i / P.all.length);
        await _bootYield(); // hidden-tab-safe paint (main/state.js)
        last = performance.now();
      }
    }
    _finishAtlas(P);
    _atlasPersist(P);
    if (tick) tick(1);
    return true;
  }

  function setUV(geom, key) {
    const { cx, cy } = atlas.cells[key];
    const W = atlas.canvas.width, H = atlas.canvas.height;
    // half-texel inset — anything smaller lets edge fragments round into the
    // neighbouring cell.
    const u0 = (cx + 0.5) / W, u1 = (cx + CSZ - 0.5) / W;
    const v1 = 1 - (cy + 0.5) / H, v0 = 1 - (cy + CSZ - 0.5) / H;
    const uv = geom.attributes.uv;
    // PlaneGeometry uv order: (0,1) (1,1) (0,0) (1,0)
    uv.setXY(0, u0, v1); uv.setXY(1, u1, v1);
    uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
    uv.needsUpdate = true;
    return geom;
  }
  function geomFor(key) {
    if (!geomCache[key]) geomCache[key] = setUV(new THREE.PlaneGeometry(1, 1), key);
    return geomCache[key];
  }

  // ---------- chunked world meshes (built on demand, disposed when far) ----------
  const chunkMeshes = new Map(); // "cx,cy" -> THREE.Group
  const meshLog = []; // rolling per-chunk mesh build times (perf triage)
  const _meshHealed = new Set(); // chunks whose mesh threw once — self-heal retry (syncChunks)
  const warmRows = new Map(); // "cx,cy" -> next groundY row to pre-warm
  // ---- road-network warm worker ----
  // A cold city road link runs a multi-second A* the first time any chunk in
  // its region generates — a total freeze on the main thread. The worker
  // computes the same deterministic routes in the background ahead of the
  // player; finished cells inject into the road cache so chunk generation
  // finds hits. Falls back silently (roadWorker = false) where workers are
  // unavailable — behaviour is then exactly as before.
  let roadWorker = null;
  let roadWarmX = Infinity, roadWarmY = Infinity;
  function syncRoadWorker() {
    if (roadWorker === false) return;
    if (roadWorker === null) {
      if (typeof Worker === "undefined" || !world._roadCellInject || !world._workerInit) { roadWorker = false; return; }
      // adopt the worker the boot already started (main.js init spawns it
      // first thing so the spawn region's roads crunch during the loading
      // bar) — same init, same seed; spawning a second would double the work
      if (typeof _bootRoadWorker !== "undefined" && _bootRoadWorker && _bootRoadWorker.w && !_bootRoadWorker.failed) {
        roadWorker = _bootRoadWorker.w;
        roadWorker.onmessage = e => { if (e.data && e.data.key) world._roadCellInject(e.data.key, e.data.out); };
        roadWorker.onerror = err => {
          console.warn("road worker unavailable:", err.message || err);
          try { roadWorker.terminate(); } catch (e2) { /* already dead */ }
          roadWorker = false;
        };
      } else try {
        roadWorker = new Worker("js/world/roadworker.js");
        roadWorker.onmessage = e => { if (e.data && e.data.key) world._roadCellInject(e.data.key, e.data.out); };
        roadWorker.onerror = err => {
          console.warn("road worker unavailable:", err.message || err);
          try { roadWorker.terminate(); } catch (e2) { /* already dead */ }
          roadWorker = false;
        };
        roadWorker.postMessage({ type: "init", ...world._workerInit });
      } catch (e) { roadWorker = false; return; }
    }
    // re-warm when the player has moved a decent distance; the worker skips
    // cells it has already finished, so repeat requests only cost new ground
    if (Math.abs(player.x - roadWarmX) > 96 || Math.abs(player.y - roadWarmY) > 96) {
      roadWarmX = player.x; roadWarmY = player.y;
      // pad 19 cells: ≥ roadsNear's ROAD_SCAN (14) reach for every chunk the
      // mesh pipeline can touch, PLUS the far-LOD ribbons' rect (±588 map
      // units ≈ 4 cells + ROAD_SCAN = 18) so roadsNearCached converges to
      // zero missing cells without any main-thread A*
      roadWorker.postMessage({ type: "warm", mx: player.x / 2, my: player.y / 2, pad: 19 });
    }
  }
  // ---- chunk terrain-field warm worker ----
  // The noise passes of a chunk data build (eroded elevation + biome grids)
  // are a 17-50ms main-thread stall per fresh chunk while walking. This
  // worker pre-computes them (shared erosion.js computeChunkFields — same
  // code, same seed, identical output) for every not-yet-generated chunk in
  // the mesh pipeline's reach plus one ring, and injects the grids
  // (world._fieldInject); the synchronous build then only pays for feature
  // stamping. Falls back silently where workers are unavailable.
  let chunkWorker = null;
  const fieldReq = new Set(); // chunk keys already sent to the worker
  function syncChunkWorker(pcx, pcy, R) {
    if (chunkWorker === false) return;
    if (chunkWorker === null) {
      if (typeof Worker === "undefined" || !world._fieldInject || !world._workerInit) { chunkWorker = false; return; }
      try {
        chunkWorker = new Worker("js/world/chunkworker.js");
        chunkWorker.onmessage = e => world._fieldInject(e.data.key, e.data);
        chunkWorker.onerror = err => {
          console.warn("chunk worker unavailable:", err.message || err);
          try { chunkWorker.terminate(); } catch (e2) { /* already dead */ }
          chunkWorker = false;
        };
        chunkWorker.postMessage({ type: "init", ...world._workerInit });
      } catch (e) { chunkWorker = false; return; }
    }
    // request the missing chunks of the pipeline's neighbourhood, a small
    // batch per frame; fieldReq stops re-sends (and is forgotten wholesale
    // now and then so a pruned-and-revisited region can warm again)
    if (fieldReq.size > 4000) fieldReq.clear();
    const want = [];
    scan: for (let cy = pcy - R - 1; cy <= pcy + R + 1; cy++)
      for (let cx = pcx - R - 1; cx <= pcx + R + 1; cx++) {
        const k = cx + "," + cy;
        if (fieldReq.has(k) || (world.chunks && world.chunks.has(k))) continue;
        fieldReq.add(k);
        want.push({ cx, cy });
        if (want.length >= 12) break scan;
      }
    if (want.length) chunkWorker.postMessage({ type: "fields", chunks: want });
  }
  let sea = null;

  // FIX B: persistent scratch arrays for the per-chunk geometry builders.
  // buildChunkMesh used to allocate fresh pos/uvs/idx/snw (and wall pos/uv/idx)
  // on every build — a chunk's worth of GC churn per chunk. It is synchronous
  // and non-reentrant (only ever called from syncChunks on the main thread, and
  // nothing it calls re-enters it), so these can be shared and reset per build.
  // THREE.Float32BufferAttribute/setIndex COPY the array into a typed array, so
  // the finished geometry is byte-identical and resetting the scratch for the
  // next build can't touch it — pure allocation savings, no behaviour change.
  const _bcmPos = [], _bcmUV = [], _bcmIdx = [], _bcmSnw = [];
  const _bcmWPos = [], _bcmWUV = [], _bcmWIdx = [];
  function buildChunkMesh(cx, cy) {
    const CS = world.CHUNK;
    const ch = world.getChunk(cx, cy);
    const group = new THREE.Group();
    const pos = _bcmPos, uvs = _bcmUV, idx = _bcmIdx, snw = _bcmSnw;
    pos.length = 0; uvs.length = 0; idx.length = 0; snw.length = 0;
    let n = 0;
    const AW = atlas.canvas.width, AH = atlas.canvas.height;
    function quad(x, z, key, y, sn, must) {
      let cell = atlas.cells[key];
      if (!cell && key.startsWith("at_")) {
        // atlas.png not usable in WebGL (file:// taint); fall back to biomes.png with regional personality
        const parts = key.split("_");
        // water at_* keys carry a deliberate variant (fixed per biome / per
        // isle water body — see biomeGround): honour it, or the personality
        // roll re-dithers open water into a checkerboard of clashing blues
        const water = parts[1] === "0" || parts[1] === "1" || parts[1] === "21";
        const pers = water ? +parts[2] : world.personalityAt(x, z);
        cell = atlas.cells[`bg_${parts[1]}_${pers}`];
      }
      // GROUND must never be a hole: an unresolvable key (stale/bad cached
      // atlas, unknown art) would drop the tile and expose the sea backdrop /
      // far-LOD beneath as flat colour — same fallback the cliff skirts use.
      if (!cell && must) cell = atlas.cells.dirt;
      if (!cell) return;
      const { cx: acx, cy: acy } = cell;
      const u0 = (acx + 0.5) / AW, u1 = (acx + CSZ - 0.5) / AW;
      const v1 = 1 - (acy + 0.5) / AH, v0 = 1 - (acy + CSZ - 0.5) / AH;
      pos.push(x, y, z, x + 1, y, z, x, y, z + 1, x + 1, y, z + 1);
      uvs.push(u0, v1, u1, v1, u0, v0, u1, v0);
      // snow exclusion: interior floors never frost (sn 0 → aSnowOff 1)
      const s = sn === 0 ? 1 : 0;
      snw.push(s, s, s, s);
      idx.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
      n += 4;
    }
    const bx = cx * CS, by = cy * CS;
    // stepped terrain: every tile sits flat on its half-block tier
    const gys = new Float32Array(CS * CS);
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++) {
        const gy = groundY(bx + x, by + z);
        gys[z * CS + x] = gy;
        const gk = ch.ground[z * CS + x];
        quad(bx + x, by + z, gk, gy,
          (typeof gk === "string" && gk.startsWith("floor") && insideB(bx + x, by + z)) ? 0 : 1, true);
        const d = ch.decor[z * CS + x];
        if (d && FLAT_DECOR.has(d)) quad(bx + x, by + z, d, gy + 0.015);
        // flood margin: the risen river spilling over a low bank tile — a
        // water sheet at the flooded surface, drawn over the unmoved ground
        if (floodLvl > 0 && !isWaterKey(gk)) {
          const fs = floodSurfAt(bx + x, by + z, gy);
          if (fs) quad(bx + x, by + z, fs.key, fs.y + 0.01);
        }
        // bridge deck: one flat stone slab across the whole crossing (bank
        // top to bank top). It lives in the ground mesh so clicks land on it.
        // (piers inside a building footprint carry the building's own slab —
        // no deck quad of their own)
        if (d && d.startsWith("stone_bridge") && !insideB(bx + x, by + z))
          quad(bx + x, by + z, "floor_stone", bridgeDeckY(bx + x, by + z) + FLOOR_T);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute("aSnowOff", new THREE.Float32BufferAttribute(snw, 1));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, sharedMat);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    group.userData.groundGeom = g;
    group.userData.groundMesh = mesh; // picking raycasts against this
    // cliff skirts: a shaded vertical face wherever a neighbour tier is lower
    // (each chunk draws the faces of its OWN higher tiles, so no doubles)
    const extraGeoms = group.userData.extraGeoms = [];
    const recShim = { geoms: extraGeoms };
    const skirt = newSB();
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++) {
        const gy = gys[z * CS + x];
        const wx2 = bx + x, wz2 = by + z;
        // resolve the tile art the same way quad() does (at_* biome-atlas keys
        // fall back to the bg_* terrain tiles); cliffs reuse the tile's own art
        let key2 = ch.ground[z * CS + x];
        if (!atlas.cells[key2] && key2.startsWith("at_")) {
          const p2 = key2.split("_");
          const w2 = p2[1] === "0" || p2[1] === "1" || p2[1] === "21";
          key2 = `bg_${p2[1]}_${w2 ? +p2[2] : world.personalityAt(wx2, wz2)}`;
        }
        if (!atlas.cells[key2]) key2 = "dirt";
        const nb = [
          [wx2, wz2 + 1, wx2, wz2 + 1, wx2 + 1, wz2 + 1, SH_S],
          [wx2, wz2 - 1, wx2 + 1, wz2, wx2, wz2, SH_N],
          [wx2 - 1, wz2, wx2, wz2, wx2, wz2 + 1, SH_W],
          [wx2 + 1, wz2, wx2 + 1, wz2 + 1, wx2 + 1, wz2, SH_E],
        ];
        for (const [nx, nz, ax, az, bx3, bz3, shd] of nb) {
          const ng = (nx >= bx && nx < bx + CS && nz >= by && nz < by + CS)
            ? gys[(nz - by) * CS + (nx - bx)] : groundY(nx, nz);
          if (ng < gy - 0.01) sbWallFace(skirt, key2, ax, az, bx3, bz3, ng, gy, shd * 0.55);
        }
      }
    // ---- bridges: parapets, fascia and support piers around the deck ----
    // The flat deck slab itself is in the ground mesh (pickable); here its 3D
    // dressing. Sides facing off the span (open water, or the bank slope the
    // deck floats above) get a parapet above deck level and a fascia lip
    // below; sides meeting the bank top get a small stone fill down to the
    // road. "stone_bridge#p" tiles are solid 1-tile support piers rising from
    // the riverbed to the deck (blocked in gameplay — boats steer between).
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++) {
        const d0 = ch.decor[z * CS + x];
        if (typeof d0 !== "string" || !d0.startsWith("stone_bridge")) continue;
        const wx2 = bx + x, wz2 = by + z;
        // piers under a river-spanning building rise to that building's slab
        // and get no parapets (the building provides the walls above)
        const inB = insideB(wx2, wz2);
        const deck = (inB ? bldTier(inB)
                          : bridgeDeckY(wx2, wz2)) + FLOOR_T;
        if (d0 === "stone_bridge#p") {
          const y0 = gys[z * CS + x] - 0.4; // riverbed under the water surface
          sbWallFace(skirt, "wall_stone", wx2, wz2, wx2 + 1, wz2, y0, deck, SH_N * 0.9);
          sbWallFace(skirt, "wall_stone", wx2, wz2 + 1, wx2 + 1, wz2 + 1, y0, deck, SH_S * 0.9);
          sbWallFace(skirt, "wall_stone", wx2, wz2, wx2, wz2 + 1, y0, deck, SH_W * 0.9);
          sbWallFace(skirt, "wall_stone", wx2 + 1, wz2, wx2 + 1, wz2 + 1, y0, deck, SH_E * 0.9);
        }
        if (inB) continue; // no parapets/fascia inside a building undercroft
        const sides = [
          [wx2, wz2 + 1, wx2, wz2 + 1, wx2 + 1, wz2 + 1, SH_S],
          [wx2, wz2 - 1, wx2 + 1, wz2, wx2, wz2, SH_N],
          [wx2 - 1, wz2, wx2, wz2, wx2, wz2 + 1, SH_W],
          [wx2 + 1, wz2, wx2 + 1, wz2 + 1, wx2 + 1, wz2, SH_E],
        ];
        for (const [nx, nz, ax, az, bx3, bz3, shd] of sides) {
          if ((world.getDecor(nx, nz) || "").startsWith("stone_bridge")) continue; // span continues
          const ng = world.isWater(nx, nz) ? null : groundY(nx, nz);
          if (ng == null || ng < deck - 0.6) {
            sbWallFace(skirt, "wall_stone", ax, az, bx3, bz3, deck, deck + 0.5, shd);
            sbWallFace(skirt, "wall_stone", ax, az, bx3, bz3, deck - 0.4, deck, shd * 0.75);
          } else if (ng < deck - 0.01) {
            sbWallFace(skirt, "wall_stone", ax, az, bx3, bz3, ng, deck, shd * 0.8);
          }
        }
      }
    // pickable too: pointing at a terrace riser must select the tile at its
    // base — without this the pick ray passes through the cliff face into
    // the hill and lands far beyond the crest (cursor popping uphill)
    group.userData.skirtMesh = sbMesh(skirt, sharedMat, recShim, group);
    // upright decor billboards. Building/city walls and roofs are NOT drawn
    // here any more — the structure system builds them as real geometry from
    // the building/village records; wall decor with a "#dir" side tag belongs
    // to a structure and is skipped entirely.
    const decorObjs = group.userData.decorObjs = [];
    // shadow casters, baked into direction-specific meshes by buildChunkShadow
    // (rebuilt when the camera/sun rotates): sprite silhouettes + solid blocks
    const shSprites = group.userData.shSprites = []; // {key, cx, cz, len}
    const shBlocks = group.userData.shBlocks = [];   // {x0, z0, x1, z1, len}
    // static wall blocks (bare maze/ruins wall decor) share the atlas material,
    // so their quads are appended straight into a second baked geometry
    const wpos = _bcmWPos, wuvs = _bcmWUV, widx = _bcmWIdx;   // FIX B: shared scratch (reset per build)
    wpos.length = 0; wuvs.length = 0; widx.length = 0;
    let wn = 0;
    const wallQuad = (key, ax, ay, az, bx2, by2, bz2, cx2, cy2, cz2, dx2, dy2, dz2) => {
      const cell = atlas.cells[key];
      if (!cell) return;
      const u0 = (cell.cx + 0.5) / AW, u1 = (cell.cx + CSZ - 0.5) / AW;
      const v1 = 1 - (cell.cy + 0.5) / AH, v0 = 1 - (cell.cy + CSZ - 0.5) / AH;
      wpos.push(ax, ay, az, bx2, by2, bz2, cx2, cy2, cz2, dx2, dy2, dz2);
      wuvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      widx.push(wn, wn + 1, wn + 2, wn, wn + 2, wn + 3);
      wn += 4;
    };
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++) {
        const d = ch.decor[z * CS + x];
        if (!d || FLAT_DECOR.has(d)) continue;
        if (d.startsWith("stone_bridge")) continue; // real deck/parapet/pier geometry above
        const dk = d.includes('#') ? d.split('#')[0] : d; // strip the n/s/e/w side tag
        const tgy = gys[z * CS + x];
        if (dk.startsWith("wall_") && !BILLBOARD_WALL.has(dk)) {
          if (d.includes('#')) continue; // structural wall — drawn by the structure system
          // free-standing ruin/maze wall: a low solid block on the tile
          const key = dk === "wall_stone" ? "wall_stone" : "wall_wood";
          const wx0 = bx + x, wz0 = by + z, y0 = tgy, wh = tgy + 1.0;
          wallQuad(key, wx0, y0, wz0 + 1, wx0 + 1, y0, wz0 + 1, wx0 + 1, wh, wz0 + 1, wx0, wh, wz0 + 1); // S
          wallQuad(key, wx0 + 1, y0, wz0, wx0, y0, wz0, wx0, wh, wz0, wx0 + 1, wh, wz0);                 // N
          wallQuad(key, wx0, y0, wz0, wx0, y0, wz0 + 1, wx0, wh, wz0 + 1, wx0, wh, wz0);                 // W
          wallQuad(key, wx0 + 1, y0, wz0 + 1, wx0 + 1, y0, wz0, wx0 + 1, wh, wz0, wx0 + 1, wh, wz0 + 1); // E
          wallQuad(key, wx0, wh, wz0 + 1, wx0 + 1, wh, wz0 + 1, wx0 + 1, wh, wz0, wx0, wh, wz0);         // top
          shBlocks.push({ x0: wx0 + 0.1, z0: wz0 + 0.1, x1: wx0 + 0.9, z1: wz0 + 0.9, len: 1.1 });
          continue;
        }
        // decor with a matching packed object renders as a dynamic 8-directional
        // billboard (placed per-frame by syncDecor) rather than a baked flat sprite.
        const ov = objForKey(dk);
        if (ov) {
          const e = { wx: bx + x + 0.5, wz: by + z + 0.5, idx: ov.idx, scale: ov.scale };
          // fences/gates rotate with the camera (syncDecor). Two pieces:
          // · fr — the sheet cell holding the object's true SOUTH view. The
          //   fence/gate sheets are mis-rotated (user-confirmed: fence
          //   south = the cell one step back, i.e. cell 7; gate south =
          //   two steps back, cell 6; verified headlessly — those are the
          //   straight-on front panels).
          // · fdir — the world direction the panel FACES, from the run
          //   direction (auto-detected from neighbouring fence tiles): an
          //   E–W run faces south (0), a N–S run faces east (2), so from
          //   a side-on camera a run shows panels and along the run it
          //   shows receding posts.
          if (dk === "fence_wood" || dk === "gate_wood") {
            e.fr = dk === "fence_wood" ? 7 : 6;
            const isF = (xx, yy) => { const dd = world.getDecor(xx, yy); return dd === "fence_wood" || dd === "gate_wood"; };
            const wx0 = bx + x, wz0 = by + z;
            const ns = isF(wx0, wz0 - 1) || isF(wx0, wz0 + 1);
            const ew = isF(wx0 - 1, wz0) || isF(wx0 + 1, wz0);
            e.fdir = (ns && !ew) ? 2 : 0;
          }
          decorObjs.push(e); continue;
        }
        const isPine = dk === "tree_pine";
        const m = new THREE.Mesh(geomFor(d), sharedMat);
        if (isPine) {
          m.position.set(bx + x + 0.5, tgy + 0.65, by + z + 0.5);
          m.scale.set(1, 1.3, 1);
        } else {
          m.position.set(bx + x + 0.5, tgy + 0.5, by + z + 0.5);
        }
        m.rotation.x = -0.42;
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        group.add(m);
        // the sprite silhouette (length = its drawn height) casts the shadow,
        // baked for the current sun direction by buildChunkShadow
        shSprites.push({ key: d, cx: bx + x + 0.5, cz: by + z + 0.5, len: isPine ? 1.3 : 1.0 });
      }
    if (wn) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute("position", new THREE.Float32BufferAttribute(wpos, 3));
      wg.setAttribute("uv", new THREE.Float32BufferAttribute(wuvs, 2));
      wg.setIndex(widx);
      const wmesh = new THREE.Mesh(wg, sharedMat);
      wmesh.matrixAutoUpdate = false;
      group.add(wmesh);
      group.userData.wallGeom = wg;
    }
    buildChunkShadow(group);
    scene.add(group);
    return group;
  }

  // (Re)build a chunk's baked shadow meshes for the current sun direction.
  // Two meshes: textured sprite silhouettes and gradient decor blocks. Called
  // on chunk create and whenever the camera (hence the sun) rotates.
  function buildChunkShadow(group) {
    for (const old of group.userData.shadowMeshes || []) { group.remove(old); old.geometry.dispose(); }
    group.userData.shadowMeshes = [];
    if (!SHADOWS || !sunState.up) return;              // night: no cast shadows
    const [sdx, sdz] = sunDir();
    const SL = sunState.len;                           // sun-elevation length multiplier
    const yOf = (tx, tz) => groundY(tx, tz) + 0.025;
    const sil = newSB();
    for (const s of group.userData.shSprites || [])
      bakeSil(sil, s.key, s.cx, s.cz, s.len * SL, 0.5, sdx, sdz, yOf);
    const silM = sbMesh(sil, shadowMatFor(sharedMat), { geoms: [] }, group);
    if (silM) { silM.renderOrder = 2; group.userData.shadowMeshes.push(silM); }
    const shb = newSH();
    for (const b of group.userData.shBlocks || [])
      bakeBlockShadow(shb, b.x0, b.z0, b.x1, b.z1, b.len * SL, sdx, sdz, yOf);
    const blkM = shMesh(shb, null, group);
    if (blkM) { blkM.renderOrder = 2; group.userData.shadowMeshes.push(blkM); }
  }

  // (Re)build a structure's baked ground shadow for the current sun direction.
  // Each shadowFoot is a footprint rect stretched by its height; group-relative
  // heights drape over terrain steps. Called on create and on sun rotation.
  function buildStructShadow(rec) {
    for (const old of rec.shadowMeshes || []) { rec.group.remove(old); old.geometry.dispose(); }
    rec.shadowMeshes = [];
    if (!SHADOWS || !sunState.up) return;              // night: no cast shadows
    const [sdx, sdz] = sunDir();
    const SL = sunState.len;
    const yOf = (tx, tz) => groundY(tx, tz) - rec.baseTier + 0.02;
    const sh = newSH();
    for (const f of rec.shadowFeet || [])
      bakeBlockShadow(sh, f.x0, f.z0, f.x1, f.z1, f.len * SL, sdx, sdz, yOf);
    const m = shMesh(sh, null, rec.group);
    if (m) { m.renderOrder = 2; rec.shadowMeshes.push(m); }
  }

  // How far (in tiles, from the player) the ground actually reaches the screen
  // corners at the current zoom — measured empirically as ~18.4*camZoom+13, so
  // the loaded world always covers the view with a small margin.  A floor keeps
  // the near-zoom draw distance at least as generous as the old fixed radii.
  function viewRadius() { return Math.max(48, 19 * (typeof camZoom !== "undefined" ? camZoom : 1) + 20); }
  // chunks to build each side: enough that the axis-aligned 5x5..NxN square
  // contains that reach even with the player at the far edge of their chunk.
  function chunkRadius() { return Math.min(8, Math.max(2, Math.ceil((viewRadius() + 4) / 32))); }

  function syncChunks() {
    syncRoadWorker();
    const CS = world.CHUNK;
    const pcx = Math.floor(player.x / CS), pcy = Math.floor(player.y / CS);
    const R = chunkRadius(); // loaded neighborhood grows with zoom-out so the
                             // world fills the screen to the edges (no void)
    syncChunkWorker(pcx, pcy, R); // pre-compute missing chunks' terrain fields off-thread
    const want = new Set();
    const missing = [];
    for (let cy = pcy - R; cy <= pcy + R; cy++)
      for (let cx = pcx - R; cx <= pcx + R; cx++) {
        const key = cx + "," + cy;
        want.add(key);
        if (!chunkMeshes.has(key))
          missing.push({ cx, cy, key, d: Math.max(Math.abs(cx - pcx), Math.abs(cy - pcy)) });
      }
    // Amortized building. Walking across a chunk border used to stack five
    // ~100ms mesh builds (plus inline data generation) into a single frame —
    // the "new region" hitch. Now, per frame, the outer ring advances ONE
    // step of a three-stage pipeline per chunk, nearest-first (it sits past
    // the depth-fog cutoff so the staggering is invisible):
    //   1. generate the chunk's 3x3 DATA neighbourhood (one chunk per frame —
    //      groundY probes reach into the margins);
    //   2. pre-warm the fresh groundY pass a ~6ms slice per frame (it was
    //      the expensive half of every build);
    //   3. build the mesh, which now only pays for geometry.
    // Chunks under/beside the player still build immediately (boot,
    // teleports — a hole there is visible).
    missing.sort((a, b) => a.d - b.d);
    let built = 0, worked = false, _imm = 0;
    for (const m of missing) {
      // "immediate" (mesh this frame, past the budget): chunks under/beside
      // the player whose DATA is already in memory — hydrated or generated,
      // the mesh is the cheap half, and a hole there is visible. The player's
      // own chunk always builds now; its d=1 ring builds at most two per call
      // (the rest land within 2-3 frames — invisible), so a boot/teleport
      // blocks ~150ms instead of meshing all nine at once. A d<=1 chunk with
      // NO data takes the staged pipeline like the outer ring instead: paying
      // up to 9 synchronous data gens froze a first-ever boot for ~16s.
      const immediate = m.d <= 1 && world.chunks && world.chunks.has(m.key) &&
        (m.d === 0 || _imm++ < 2);
      if (!immediate && (built || worked)) break;
      if (!immediate) {
        // stage 1: data neighbourhood
        if (world.chunks) {
          let need = null;
          n3: for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
              if (!world.chunks.has((m.cx + dx) + "," + (m.cy + dy))) { need = [m.cx + dx, m.cy + dy]; break n3; }
          if (need) { world.getChunk(need[0], need[1]); worked = true; break; }
        }
        // stage 2: groundY warm slice
        let row = warmRows.get(m.key) || 0;
        if (row < CS) {
          const t0 = performance.now();
          while (row < CS && performance.now() - t0 < 6) {
            for (let x = 0; x < CS; x++) groundY(m.cx * CS + x, m.cy * CS + row);
            row++;
          }
          if (row < CS) { warmRows.set(m.key, row); worked = true; break; }
        }
        warmRows.delete(m.key);
      }
      // stage 3 (or adjacent-to-player immediate): the mesh itself.
      // quarantine failures: a bad chunk must render as a hole, not
      // re-throw every frame (which freezes the whole renderer)
      let g;
      const _t0 = performance.now();
      try { g = buildChunkMesh(m.cx, m.cy); }
      catch (e) {
        // SELF-HEAL (the durable Newhaven-vista fix): a mesh build that throws
        // is almost always poisoned cached chunk DATA — a torn-deploy mid-edit
        // bundle persisted bad ground that chunks.js _chunkGroundValid's holed-
        // array check doesn't catch (it passes validation yet still breaks the
        // mesh). Left alone the chunk is quarantined as an empty group and the
        // far-LOD vista shows through FOREVER (reloaded from IDB every session).
        // So on the first failure: drop the cached chunk + its IDB record,
        // regenerate clean from current code, and retry the mesh ONCE. Only a
        // SECOND failure on freshly regenerated data is a genuine code bug —
        // then quarantine as before. Guards every poison shape, not just holes,
        // and deletes the bad IDB record so it can't return next session.
        if (!_meshHealed.has(m.key) && world.dropChunkRect) {
          _meshHealed.add(m.key);
          console.warn("chunk mesh build failed — dropping + regenerating", m.key, e && e.message);
          try {
            const CS = world.CHUNK, bx = m.cx * CS, by = m.cy * CS;
            world.dropChunkRect(bx, by, bx, by);
            world.getChunk(m.cx, m.cy);
            g = buildChunkMesh(m.cx, m.cy);
          } catch (e2) { g = null; }
        }
        if (!g) {
          console.error("chunk mesh build failed at", m.key, e);
          g = new THREE.Group();
          g.userData.groundGeom = new THREE.BufferGeometry();
          scene.add(g);
        }
      }
      meshLog.push({ key: m.key, ms: Math.round(performance.now() - _t0) });
      if (meshLog.length > 200) meshLog.splice(0, 100);
      chunkMeshes.set(m.key, g);
      built++;
    }
    // Data prefetch: on fully idle frames, pre-generate the DATA of one chunk
    // a ring beyond the mesh radius, so the pipeline above rarely finds a
    // missing neighbourhood in the first place.
    if (!built && !worked && world.chunks) {
      prefetch: for (let r = 0; r <= R + 1; r++)
        for (let cy = pcy - r; cy <= pcy + r; cy++)
          for (let cx = pcx - r; cx <= pcx + r; cx++) {
            if (Math.max(Math.abs(cx - pcx), Math.abs(cy - pcy)) !== r) continue;
            if (world.chunks.has(cx + "," + cy)) continue;
            world.getChunk(cx, cy);
            break prefetch;
          }
    }
    for (const [key, group] of chunkMeshes) {
      if (want.has(key)) continue;
      scene.remove(group);
      group.userData.groundGeom.dispose();
      if (group.userData.wallGeom) group.userData.wallGeom.dispose();
      for (const sm of group.userData.shadowMeshes || []) sm.geometry.dispose();
      for (const eg of group.userData.extraGeoms || []) eg.dispose();
      chunkMeshes.delete(key);
    }
    // sea floor follows the player so the horizon is never void (ocean/river
    // tiles sit at -STEP_H, so the backdrop plane sits just beneath them;
    // ponds and springs float higher, at their own banks)
    sea.position.set(WX(player.px), -STEP_H - 0.12, WX(player.py));
  }

  function initSea() {
    // The distant-sea backdrop — "the horizon is never void". It is DRAWN as
    // atmospheric HAZE, not an opaque slab: transparent, its alpha ramping
    // from 0 up close to 1 at the haze horizon (seaGlintPatch's uHaze), so the
    // real textured `bg_1_*` water tiles own the near field and the plane only
    // materialises as soft haze toward the horizon and through the far-LOD's
    // open-water holes. Previously it was an opaque plane z-fighting the
    // shallow tiles — a flat coloured sheet that read as a wall, not fog.
    // depthWrite off + a very negative renderOrder keep it behind everything.
    const seaMat = new THREE.MeshBasicMaterial({
      color: 0x3c7c9e, transparent: true, depthWrite: false,
    });
    seaGlintPatch(seaMat);   // sky-temperature tint, the sun's reflection path + haze alpha
    // Sized to exactly match the camera's far clip (1600, see init()) — safe
    // because depth fog always fully obscures everything before the camera
    // can reach that far.
    sea = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -STEP_H - 0.12;
    sea.renderOrder = -9;    // behind the water tiles (0) and far LOD (-5), in front of the sky dome (-10)
    scene.add(sea);
  }

  // ---------- sky dome ----------
  // A camera-centred gradient sphere behind everything (depthTest off,
  // renderOrder -10): horizon colour = fog colour (== scene.background, so
  // the fog IS the sky — terrain melts into it seamlessly at the fog cutoff),
  // zenith its own deeper blue, plus the REAL sun — a
  // warm glow and a disc at the sun's true azimuth/elevation. Only visible
  // once the zoom-tilt lets the view reach the horizon; costs one draw call.
  function initSkyDome() {
    skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: {
        uHor: { value: new THREE.Color(SKY) },
        uZen: { value: new THREE.Color(ZEN_DAY) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunI: { value: 0 },
      },
      vertexShader: "varying vec3 vDir;\nvoid main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `varying vec3 vDir;
uniform vec3 uHor, uZen, uSunDir;
uniform float uSunI;
void main() {
  vec3 d = normalize(vDir);
  vec3 col = mix(uHor, uZen, smoothstep(0.0, 0.35, d.y));
  float s = max(dot(d, uSunDir), 0.0);
  col += vec3(1.0, 0.74, 0.45) * pow(s, 24.0) * 0.55 * uSunI;          // wide warm glow
  col += vec3(1.0, 0.92, 0.78) * smoothstep(0.9993, 0.9997, s) * uSunI; // the disc
  gl_FragColor = vec4(col, 1.0);
}`,
    });
    skyDome = new THREE.Mesh(new THREE.SphereGeometry(1200, 24, 12), skyMat);
    skyDome.renderOrder = -10;
    skyDome.frustumCulled = false;
    scene.add(skyDome);
  }

  // ---------- horizon clouds ----------
  // A small deck of soft billboard puffs riding the weather wind, high enough
  // (y 60-130) that they live in the sky band the zoom-tilt reveals — at the
  // default zoom no ray reaches them, so they cost nothing visually. Opacity
  // follows cloudiness; the shared tint patch turns them gold at dusk.
  const CLOUD_N = 12;
  function initClouds() {
    const cv = document.createElement("canvas");
    cv.width = 160; cv.height = 96;
    const cc = cv.getContext("2d");
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 8; i++) {
      const bx = 24 + rnd() * 112, by = 34 + rnd() * 34, br = 14 + rnd() * 22;
      const g = cc.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, "rgba(255,255,255,0.5)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      cc.fillStyle = g;
      cc.fillRect(0, 0, 160, 96);
    }
    const tex = new THREE.CanvasTexture(cv);
    const geo = new THREE.PlaneGeometry(1, 1);
    clouds = [];
    for (let i = 0; i < CLOUD_N; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0,
      });
      tintPatch(mat);
      const m = new THREE.Mesh(geo, mat);
      const wsc = 190 + rnd() * 170;
      m.scale.set(wsc, wsc * (0.24 + rnd() * 0.1), 1);
      m.frustumCulled = false;
      scene.add(m);
      clouds.push({
        m, jit: 0.55 + rnd() * 0.45, drift: 2.5 + rnd() * 4,
        // absolute world offsets, wrapped into a box around the player. Low
        // and far: the zoom-tilt sky band only spans a few degrees above the
        // horizon, so high overhead cloud would never be in frame.
        x: (rnd() - 0.5) * 2000, z: (rnd() - 0.5) * 2000, y: 35 + rnd() * 45,
      });
    }
  }
  function syncClouds(wfog, dt) {
    if (!clouds) return;
    const cl = wfog ? wfog.cloud : 0.3;
    const wv = (wfog && wfog.wind) ? wfog.wind : { x: 0.5, y: 0 };
    const px = WX(player.px), pz = WX(player.py);
    const move = Math.min(100, dt) / 1000;
    for (const c of clouds) {
      c.x += wv.x * c.drift * move;
      c.z += wv.y * c.drift * move;
      // wrap into a ±1000 box around the player
      let rx = c.x - px, rz = c.z - pz;
      if (rx > 1000) c.x -= 2000; else if (rx < -1000) c.x += 2000;
      if (rz > 1000) c.z -= 2000; else if (rz < -1000) c.z += 2000;
      rx = c.x - px; rz = c.z - pz;
      const d = Math.hypot(rx, rz);
      const target = (0.14 + 0.6 * cl) * c.jit *
        Math.max(0, Math.min(1, 1.6 - d / 1100)) *   // fade at the far edge
        Math.max(0, Math.min(1, d / 220 - 0.3));      // never overhead
      const mt = c.m.material;
      mt.opacity += (target - mt.opacity) * Math.min(1, dt / 2500);
      c.m.visible = mt.opacity > 0.01;
      c.m.position.set(c.x, c.y + followY, c.z);
      c.m.quaternion.copy(_qYaw);                     // upright, facing the view
    }
  }

  // ---------- far terrain LOD ----------
  // Beyond the loaded chunk ring, a coarse vertex-coloured height mesh carries
  // the landscape to the horizon — the SAME pure heightAt math the chunks use
  // (no chunk generation, no erosion: at these distances the haze owns the
  // detail). Two rings: step-16 tiles out to 384, step-64 out to 1152. Sits
  // 0.45 below true ground so the real chunks always cover it. Rebuilt
  // incrementally (time-budgeted rows per frame) when the player crosses a
  // 96-tile cell; the finished mesh swaps in atomically, old one stays up
  // meanwhile. Colours are elevation bands (water depth → sand → lowland →
  // forest → upland → rock) with a position hash to break the banding —
  // biome-true colouring (deserts, snowfields) is a known follow-up.
  const FARLOD_RINGS = [
    { step: 16, half: 384 },
    { step: 64, half: 1152 },
  ];
  const FARLOD_SINK = 0.45, FARLOD_CELL = 96;
  let farMeshes = [], farMat = null, farJob = null, farCenter = null;
  // far road/river ribbons live apart from the terrain grid so they can be
  // redrawn alone: roads come from the CACHED cells only (roadsNearCached) —
  // cells the road worker hasn't finished yet are skipped, counted here, and
  // the ROAD ribbon alone redraws when the worker has injected new cells.
  // Forcing them synchronously (the old way) ran the per-cell city-link A*
  // for a ±1176-tile rect on the main thread: a 5+ second freeze every time
  // the far vista recentred over a freshly visited region.
  let farRivMesh = null, farRoadMesh = null;
  let farRibbonsMissing = false, farRibbonRetryAt = 0, farRibbonCacheN = -1;
  // ACCURATE distant terrain colour: the biome the world would actually
  // classify there (world.biomeAt — the same pure classify the chunks use),
  // coloured with the mean pixel of that biome's own ground tile art from
  // the atlas (at_* cells; bg_* fallback, exactly as the chunk mesh resolves
  // them). At 16-64-tile sampling the per-tile variant dither averages out,
  // so the biome mean IS what a resolved chunk reads as from afar — deserts
  // tan, farmland gold, forests deep green, snowfields white.
  const _farBiomeCol = new Map();
  // One whole-canvas pixel snapshot shared by every atlas colour average:
  // a getImageData PER CELL forces a full canvas readback each call —
  // measured 100-500 ms apiece, and the ~37 biome misses of a far build in
  // fresh territory summed to ~8 s of frame stalls. The snapshot is dropped
  // shortly after the burst (it's canvas-sized — tens of MB).
  let _farSnap = null;
  function _farAtlasSnap() {
    if (!_farSnap) {
      _farSnap = atlas.canvas.getContext("2d").getImageData(0, 0, atlas.canvas.width, atlas.canvas.height);
      setTimeout(() => { _farSnap = null; }, 4000);
    }
    return _farSnap;
  }
  function farColorForBiome(b) {
    let c = _farBiomeCol.get(b);
    if (c) return c;
    c = [0.45, 0.5, 0.38];   // fallback: neutral scrub
    if (atlas && atlas.canvas && atlas.cells) {
      let keys = Object.keys(atlas.cells).filter(k => k.startsWith(`at_${b}_`));
      if (!keys.length) keys = Object.keys(atlas.cells).filter(k => k.startsWith(`bg_${b}_`));
      if (keys.length) {
        const snap = _farAtlasSnap(), W = snap.width, px = snap.data;
        let r = 0, g = 0, bl = 0, n = 0;
        for (const k of keys) {
          const cell = atlas.cells[k];
          for (let y = 0; y < CSZ; y++) {
            let o = ((cell.cy + y) * W + cell.cx) * 4;
            for (let x = 0; x < CSZ; x += 4, o += 16) {   // every 4th pixel
              if (px[o + 3] < 128) continue;
              r += px[o]; g += px[o + 1]; bl += px[o + 2]; n++;
            }
          }
        }
        if (n) c = [r / n / 255, g / n / 255, bl / n / 255];
      }
    }
    _farBiomeCol.set(b, c);
    return c;
  }
  function farColor(shade, b, wx, wz, out, o) {
    const c = farColorForBiome(b);
    const s = Math.sin(wx * 12.9898 + wz * 78.233) * 43758.5453;
    const j = shade * (0.96 + ((s - Math.floor(s)) - 0.5) * 0.08);
    out[o] = Math.min(1, c[0] * j);
    out[o + 1] = Math.min(1, c[1] * j);
    out[o + 2] = Math.min(1, c[2] * j);
  }
  // ---- distant roads and rivers: ribbons over the LOD landscape ----
  // The world's actual polyline registries (riversNear/roadsNear — MAP
  // half-scale coords) drawn as thin draped strips: rivers in the painted
  // water art's mean colour, roads in dirt#1's. Draping samples the SAME
  // bilinear height surface the LOD grid triangulates, plus a small lift,
  // so the strips lie on the distant hills; under the loaded chunk ring
  // everything sits below the real terrain and stays hidden.
  let farRivMat = null, farRoadMat = null;
  function _farCellAvg(keys, fallback) {
    if (atlas && atlas.canvas && atlas.cells) {
      const snap = _farAtlasSnap(), W = snap.width, px = snap.data;
      for (const k of keys) {
        const cell = atlas.cells[k];
        if (!cell) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = 0; y < CSZ; y++) {
          let o = ((cell.cy + y) * W + cell.cx) * 4;
          for (let x = 0; x < CSZ; x += 4, o += 16) {
            if (px[o + 3] < 128) continue;
            r += px[o]; g += px[o + 1]; b += px[o + 2]; n++;
          }
        }
        if (n) return new THREE.Color(r / n / 255, g / n / 255, b / n / 255);
      }
    }
    return new THREE.Color(fallback);
  }
  function buildFarRibbons(cx, cz, roadsOnly) {
    const out = { riv: null, road: null };
    if (!world.riversNear || !world.roadsNear) return out;
    if (!farRivMat) {
      const rc = farColorForBiome(1);   // B.WATER's own painted art
      farRivMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(rc[0], rc[1], rc[2]) });
      tintPatch(farRivMat);
      farRoadMat = new THREE.MeshBasicMaterial({ color: _farCellAvg(["dirt#1", "dirt"], 0xb0763c) });
      tintPatch(farRoadMat);
    }
    const LE = world.LAND_ELEVATION;
    const outerHalf = FARLOD_RINGS[FARLOD_RINGS.length - 1].half;
    const innerHalf = FARLOD_RINGS[0].half;
    const hv = (X, Z) => {
      const h = world.heightAt(X, Z);
      return h < LE ? -STEP_H - 0.08 : ((h - LE) / (1 - LE)) * 50 * STEP_H - FARLOD_SINK;
    };
    const lodY = (gx, gz) => {
      const step = Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) < innerHalf - 1
        ? FARLOD_RINGS[0].step : FARLOD_RINGS[1].step;
      const x0 = Math.floor((gx - cx) / step) * step + cx;
      const z0 = Math.floor((gz - cz) / step) * step + cz;
      const fx = (gx - x0) / step, fz = (gz - z0) / step;
      return (hv(x0, z0) * (1 - fx) + hv(x0 + step, z0) * fx) * (1 - fz) +
             (hv(x0, z0 + step) * (1 - fx) + hv(x0 + step, z0 + step) * fx) * fz;
    };
    const mkStrips = (polys, halfWOf, lift, clampNear) => {
      const pos = [], idx = [];
      let n = 0;
      for (const pts of polys) {
        // resample to ≤20-unit steps in GAME coords, carrying per-point width
        const rs = [];
        for (let i = 0; i < pts.length; i++) {
          const gx = pts[i][0] * 2, gz = pts[i][1] * 2, w = halfWOf(pts[i]);
          if (i > 0) {
            const [pxg, pzg, pw] = rs[rs.length - 1];
            const d = Math.hypot(gx - pxg, gz - pzg);
            const nSub = Math.ceil(d / 20);
            for (let s = 1; s < nSub; s++)
              rs.push([pxg + (gx - pxg) * s / nSub, pzg + (gz - pzg) * s / nSub,
                pw + (w - pw) * s / nSub]);
          }
          rs.push([gx, gz, w]);
        }
        let strip = -1;   // index of previous cross-section start, -1 = broken
        for (let i = 0; i < rs.length; i++) {
          const [gx, gz, w] = rs[i];
          if (Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) > outerHalf - 2) { strip = -1; continue; }
          // direction from neighbours, perpendicular for the cross-section
          const a = rs[Math.max(0, i - 1)], b = rs[Math.min(rs.length - 1, i + 1)];
          let dx = b[0] - a[0], dz = b[1] - a[1];
          const dl = Math.hypot(dx, dz) || 1;
          const px = -dz / dl, pz = dx / dl;
          let y = lodY(gx, gz) + lift;
          // near-field rivers: never float over the real carved channel —
          // dive to just under the sea-level water surface (rivers gorge to
          // -½, so loaded tiles cover the ribbon; in the LOD's water holes
          // the sunken ribbon still colours the notch)
          if (clampNear && Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) <= FARLOD_HOLE_R)
            y = Math.min(y, -STEP_H - 0.02);
          pos.push(gx + px * w, y, gz + pz * w, gx - px * w, y, gz - pz * w);
          if (strip >= 0) idx.push(strip, strip + 1, n, n, strip + 1, n + 1);
          strip = n; n += 2;
        }
      }
      if (!idx.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      return g;
    };
    const mx0 = (cx - outerHalf - 24) / 2, mz0 = (cz - outerHalf - 24) / 2;
    const mx1 = (cx + outerHalf + 24) / 2, mz1 = (cz + outerHalf + 24) / 2;
    if (!roadsOnly) {
      const rivPolys = [];
      for (const rv of world.riversNear(mx0, mz0, mx1, mz1)) for (const p of rv.polys) rivPolys.push(p);
      const rg = mkStrips(rivPolys, pt => Math.min(8, 2.4 + (pt[2] || 0) * 2), 0.1, true);
      if (rg) {
        const m = new THREE.Mesh(rg, farRivMat);
        m.frustumCulled = false; m.renderOrder = -4;
        out.riv = m;
      }
    }
    const roadQ = world.roadsNearCached ? world.roadsNearCached(mx0, mz0, mx1, mz1)
      : { roads: world.roadsNear(mx0, mz0, mx1, mz1), missing: 0 };
    farRibbonsMissing = roadQ.missing > 0;
    const roadPolys = roadQ.roads.map(rp => rp.pts);
    const dg = mkStrips(roadPolys, () => 2.2, 0.14);
    if (dg) {
      const m = new THREE.Mesh(dg, farRoadMat);
      m.frustumCulled = false; m.renderOrder = -3;
      out.road = m;
    }
    return out;
  }

  // Near-field water holes: within the radius chunks can actually be loaded
  // (view reach + the LOD rebuild cell's wander) the ring-0 grid must NOT
  // bridge carved water — rivers gorge down to sea level while the analytic
  // heightAt knows only the uncarved surface, so the sunk LOD (0.45 < one
  // 0.5 terrain step) planes flatly OVER the real river/pond/coast tiles.
  // Every ring-0 quad a river crosses, every coast-fringe quad (mixed
  // land/water corners) and every water-POI pocket inside this radius is a
  // HOLE: loaded chunks show their real tiles through it, unloaded ones show
  // the sea backdrop, which reads as water anyway. Beyond the radius the LOD
  // is pure vista and the bridges + draped ribbons stay — they ARE the far
  // rivers.
  const FARLOD_HOLE_R = 192;
  function farHoleCells(cx, cz) {
    const holes = new Set();
    const ring = FARLOD_RINGS[0], half = ring.half, step = ring.step;
    const nq = (2 * half) / step;               // quads per grid side
    const mark = (gx, gz) => {
      if (Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) > FARLOD_HOLE_R) return;
      const qx = Math.floor((gx - (cx - half)) / step), qz = Math.floor((gz - (cz - half)) / step);
      if (qx >= 0 && qx < nq && qz >= 0 && qz < nq) holes.add(qz * nq + qx);
    };
    try {
      if (world.riversNear) {
        const m0x = (cx - FARLOD_HOLE_R - 24) / 2, m0z = (cz - FARLOD_HOLE_R - 24) / 2;
        const m1x = (cx + FARLOD_HOLE_R + 24) / 2, m1z = (cz + FARLOD_HOLE_R + 24) / 2;
        for (const rv of world.riversNear(m0x, m0z, m1x, m1z))
          for (const pts of rv.polys) {
            let px = null, pz = null;
            for (const pt of pts) {
              const gx = pt[0] * 2, gz = pt[1] * 2;
              // stamped half-width (same formula as the ribbon) + bank carve
              const w = Math.min(8, 2.4 + (pt[2] || 0) * 2) + 4;
              const stamp = (ix, iz) => {
                mark(ix - w, iz - w); mark(ix + w, iz - w);
                mark(ix - w, iz + w); mark(ix + w, iz + w);
              };
              if (px !== null) {
                const d = Math.hypot(gx - px, gz - pz), nSub = Math.max(1, Math.ceil(d / 8));
                for (let s = 1; s <= nSub; s++)
                  stamp(px + (gx - px) * s / nSub, pz + (gz - pz) * s / nSub);
              } else stamp(gx, gz);
              px = gx; pz = gz;
            }
          }
      }
      if (world.poisNearForMap) {
        for (const p of world.poisNearForMap((cx - FARLOD_HOLE_R) / 2, (cz - FARLOD_HOLE_R) / 2,
                                             (cx + FARLOD_HOLE_R) / 2, (cz + FARLOD_HOLE_R) / 2, 8))
          if (p && (p.type === "pond" || p.type === "hotspring" || p.type === "geyser" || p.type === "tarpit")) {
            const gx = p.x * 2, gz = p.y * 2;
            mark(gx - 6, gz - 6); mark(gx + 6, gz - 6); mark(gx - 6, gz + 6); mark(gx + 6, gz + 6);
          }
      }
    } catch (e) { /* hole set is best-effort — the LOD must never fail to build */ }
    return holes;
  }

  function startFarBuild(cx, cz) {
    farJob = { cx, cz, ring: 0, row: 0, parts: [], holes: farHoleCells(cx, cz) };
    for (const r of FARLOD_RINGS) {
      const n = (2 * r.half) / r.step + 1;
      farJob.parts.push({
        n, pos: new Float32Array(n * n * 3), col: new Float32Array(n * n * 3), idx: [],
      });
    }
    // sample the ring grids on the far worker when it's up: the ~3800 biome
    // classifications of a recentre are tens of ms per ROW on the main
    // thread (each is a full noise-stack classify). A DEDICATED chunkworker
    // instance — the shared field warmer's queue runs 100-300 ms per chunk
    // and a teleport floods it, which starved far requests past any timeout.
    // Until the grids arrive the job idles and the previous vista stays up;
    // worker down or slow (5 s) falls back to inline sampling as before.
    const fw = farWorkerGet();
    if (fw) {
      farJob.waiting = performance.now();
      try { fw.postMessage({ type: "far", cx, cz, rings: FARLOD_RINGS }); }
      catch (e) { farJob.waiting = 0; }
    }
  }
  let farWorker = null;
  function farWorkerGet() {
    if (farWorker === false) return null;
    if (farWorker) return farWorker;
    if (typeof Worker === "undefined" || !world || !world._workerInit) { farWorker = false; return null; }
    try {
      farWorker = new Worker("js/world/chunkworker.js");
      farWorker.onmessage = e => { if (e.data && e.data.far) farGridsArrived(e.data); };
      farWorker.onerror = err => {
        console.warn("far worker unavailable:", err.message || err);
        try { farWorker.terminate(); } catch (e2) { /* already dead */ }
        farWorker = false;
      };
      farWorker.postMessage({ type: "init", ...world._workerInit });
    } catch (e) { farWorker = false; return null; }
    return farWorker;
  }
  function farGridsArrived(d) {
    _sec("farGridsMsg", 1);
    if (!farJob || farJob.cx !== d.far.cx || farJob.cz !== d.far.cz) return; // stale recentre
    farJob.grids = d.grids.map(g => ({ n: g.n, h: new Float32Array(g.h), b: new Int16Array(g.b) }));
    farJob.waiting = 0;
    _sec("farGridsUsed", 1);
  }
  function stepFarBuild() {
    // grids requested from the chunk worker: idle until they arrive (the old
    // vista stays up), then fill rows from them below. 5 s with no reply =
    // worker dead or drowning — sample inline exactly as the old code did.
    if (farJob && farJob.waiting) {
      if (performance.now() - farJob.waiting < 5000) return;
      farJob.waiting = 0;
      _sec("farTimeout", 1);
    }
    const t0 = performance.now();
    const LE = world.LAND_ELEVATION;
    let _rows = 0;
    while (farJob && performance.now() - t0 < 3) {
      _rows++;
      const ring = FARLOD_RINGS[farJob.ring], part = farJob.parts[farJob.ring];
      const n = part.n, r = farJob.row;
      if (r < n) {
        const grid = farJob.grids && farJob.grids[farJob.ring];
        const _rt = performance.now();
        const wz = farJob.cz - ring.half + r * ring.step;
        for (let i = 0; i < n; i++) {
          const wx = farJob.cx - ring.half + i * ring.step;
          const h = grid ? grid.h[r * (n + 1) + i] : world.heightAt(wx, wz);
          const k = (r * n + i) * 3;
          part.pos[k] = wx; part.pos[k + 2] = wz;
          if (h < LE) {                      // open water: flat, colour by depth
            part.pos[k + 1] = -STEP_H - 0.08;
            const dpt = Math.min(1, (LE - h) / (LE * 0.35 || 1));
            part.col[k] = 0.25 - 0.09 * dpt;
            part.col[k + 1] = 0.51 - 0.14 * dpt;
            part.col[k + 2] = 0.65 - 0.15 * dpt;
          } else {
            const rel = (h - LE) / (1 - LE);
            part.pos[k + 1] = rel * 50 * STEP_H - FARLOD_SINK;
            // NW-lit hillshade (like the world map): slopes rising toward
            // the south-east catch the light, falling ones sit in shade
            const hSE = grid ? grid.h[(r + 1) * (n + 1) + i + 1]
              : world.heightAt(wx + ring.step, wz + ring.step);
            const dse = (hSE - h) / (1 - LE) * 50;
            const shade = Math.max(0.8, Math.min(1.18, 1 + dse * 0.05));
            farColor(shade, grid ? grid.b[r * n + i] : world.biomeAt(wx, wz), wx, wz, part.col, k);
          }
        }
        farJob.row++;
        _sec(grid ? "farRowGrid" : "farRowLive", performance.now() - _rt);
        continue;
      }
      // ring rows done: build indices (outer ring skips quads the inner
      // covers; fully-open-water quads are HOLES so the sea backdrop — the
      // plane carrying the sun-glint shader — shows through; coast-fringe
      // quads with mixed corners keep their depth shading)
      const inner = farJob.ring > 0 ? FARLOD_RINGS[farJob.ring - 1].half : -1;
      const WATER_Y = -STEP_H - 0.08;
      for (let z = 0; z < n - 1; z++)
        for (let x = 0; x < n - 1; x++) {
          if (inner > 0) {
            const wx = farJob.cx - ring.half + x * ring.step;
            const wz = farJob.cz - ring.half + z * ring.step;
            if (wx >= farJob.cx - inner && wx + ring.step <= farJob.cx + inner &&
                wz >= farJob.cz - inner && wz + ring.step <= farJob.cz + inner) continue;
          }
          const a = z * n + x;
          if (part.pos[a * 3 + 1] <= WATER_Y && part.pos[(a + 1) * 3 + 1] <= WATER_Y &&
              part.pos[(a + n) * 3 + 1] <= WATER_Y && part.pos[(a + n + 1) * 3 + 1] <= WATER_Y)
            continue;
          if (farJob.ring === 0) {
            // near-field water holes (rivers / water POIs — see farHoleCells)
            if (farJob.holes.has(z * (n - 1) + x)) continue;
            // near-field coast fringe: a mixed land/water quad slopes across
            // up to 16 tiles of REAL sea tiles — hole it, the backdrop is sea
            const wx = farJob.cx - ring.half + x * ring.step + ring.step / 2;
            const wz = farJob.cz - ring.half + z * ring.step + ring.step / 2;
            const nearField = Math.max(Math.abs(wx - farJob.cx), Math.abs(wz - farJob.cz)) <= FARLOD_HOLE_R;
            if (nearField &&
                (part.pos[a * 3 + 1] <= WATER_Y || part.pos[(a + 1) * 3 + 1] <= WATER_Y ||
                 part.pos[(a + n) * 3 + 1] <= WATER_Y || part.pos[(a + n + 1) * 3 + 1] <= WATER_Y))
              continue;
            // near-field RELIEF holes: same failure mode as the carved water
            // above, but on steep LAND — across a 16-tile quad the interpolated
            // surface bridges terrace steps the real chunks quantize, so the
            // chord rides ABOVE the lower terraces (the 0.45 sink covers less
            // than one 0.5 step) and pokes through the loaded ground as flat
            // biome-colour wedges. Any quad spanning terrace-scale relief
            // inside the loaded-chunk field is a HOLE; the real tiles (or,
            // past view reach, depth fog) own it. Beyond FARLOD_HOLE_R the
            // vista keeps its slopes — there's no near mesh to fight.
            if (nearField) {
              const y00 = part.pos[a * 3 + 1], y10 = part.pos[(a + 1) * 3 + 1],
                    y01 = part.pos[(a + n) * 3 + 1], y11 = part.pos[(a + n + 1) * 3 + 1];
              if (Math.max(y00, y10, y01, y11) - Math.min(y00, y10, y01, y11) > STEP_H * 0.55)
                continue;
            }
          }
          part.idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
        }
      farJob.ring++; farJob.row = 0;
      if (farJob.ring < FARLOD_RINGS.length) continue;
      // all rings sampled: swap the meshes in
      if (!farMat) {
        farMat = new THREE.MeshBasicMaterial({ vertexColors: true });
        snowPatchUp(farMat, true);           // altitude snow + the shared tint/sat
      }
      const fresh = [];
      for (const p of farJob.parts) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(p.pos, 3));
        g.setAttribute("color", new THREE.BufferAttribute(p.col, 3));
        g.setIndex(p.idx);
        const m = new THREE.Mesh(g, farMat);
        m.frustumCulled = false;
        m.renderOrder = -5;                  // under everything but the sky
        scene.add(m);
        fresh.push(m);
      }
      for (const m of farMeshes) { scene.remove(m); m.geometry.dispose(); }
      farMeshes = fresh;
      farCenter = { x: farJob.cx, z: farJob.cz };
      farJob = null;
      refreshFarRibbons(farCenter.x, farCenter.z);
    }
    _sec("farRows", performance.now() - t0);
    _sec("farRowN", _rows);
  }
  function refreshFarRibbons(cx, cz, roadsOnly) {
    const _t0 = performance.now();
    let built = null;
    try { built = buildFarRibbons(cx, cz, roadsOnly); }
    catch (e) { /* distant roads/rivers are decoration — never fail the LOD */ }
    if (built) {
      if (!roadsOnly) {
        if (farRivMesh) { scene.remove(farRivMesh); farRivMesh.geometry.dispose(); }
        farRivMesh = built.riv;
        if (farRivMesh) scene.add(farRivMesh);
      }
      if (farRoadMesh) { scene.remove(farRoadMesh); farRoadMesh.geometry.dispose(); }
      farRoadMesh = built.road;
      if (farRoadMesh) scene.add(farRoadMesh);
    }
    farRibbonCacheN = world._roadCacheSize ? world._roadCacheSize() : -1;
    _sec("farRibbons", performance.now() - _t0);
  }
  function syncFarLod() {
    if (!world || !world.heightAt) return;
    const qx = Math.round(player.x / FARLOD_CELL) * FARLOD_CELL;
    const qz = Math.round(player.y / FARLOD_CELL) * FARLOD_CELL;
    if ((!farCenter || farCenter.x !== qx || farCenter.z !== qz) &&
        (!farJob || farJob.cx !== qx || farJob.cz !== qz)) {
      const _t0 = performance.now();
      startFarBuild(qx, qz);
      _sec("farStart", performance.now() - _t0);
    }
    if (farJob) stepFarBuild();
    // road cells the worker hadn't finished when the ribbons drew: redraw the
    // ROAD ribbon (rivers don't depend on the road cache) once the worker has
    // injected new cells, at most every couple of seconds, until none are
    // missing — never more than a handful of redraws per recentre
    else if (farCenter && farRibbonsMissing && now >= farRibbonRetryAt) {
      farRibbonRetryAt = now + 2000;
      const n = world._roadCacheSize ? world._roadCacheSize() : -1;
      if (n !== farRibbonCacheN) refreshFarRibbons(farCenter.x, farCenter.z, true);
    }
  }

  // sun glint on the sea backdrop: a long shimmering reflection path toward the
  // sun, strongest through the golden hour. Applied AFTER the fog include, so
  // the path shines through the haze at distance — which is exactly how a low
  // sun reads over water. Sparkle is a cheap per-cell hash twinkle, no noise tex.
  function seaGlintPatch(mat) {
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTint = tintUni;
      sh.uniforms.uSat = satUni;
      sh.uniforms.uGlint = glintUni;
      sh.uniforms.uGlintCam = glintCamUni;
      sh.uniforms.uHaze = seaHazeUni;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vGlintP;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlintP = (modelMatrix * vec4(position, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vGlintP;\nuniform vec4 uGlint;\nuniform vec3 uGlintCam;\nuniform vec2 uHaze;" + TINT_DECL)
        .replace("#include <dithering_fragment>", `#include <dithering_fragment>
      vec2 toFrag = normalize(vGlintP.xz - uGlintCam.xz);
      float align = max(0.0, dot(toFrag, uGlint.xy));
      float streak = pow(align, 42.0);
      vec2 gc = floor(vGlintP.xz * 3.0);
      float gh = fract(sin(dot(gc, vec2(127.1, 311.7))) * 43758.5453);
      float tw = 0.55 + 0.45 * sin(uGlint.w * 6.2832 * (0.35 + gh) + gh * 40.0);
      gl_FragColor.rgb += vec3(1.0, 0.82, 0.55) * streak * uGlint.z * tw;
      // HAZE alpha: the plane is a distant-sea backdrop, not a solid slab —
      // fade it from fully transparent up close (the real water tiles own the
      // near field) to opaque at the fog horizon, so it reads as atmospheric
      // haze thickening with distance instead of an opaque coloured wall.
      float hazeD = distance(vGlintP, uGlintCam);
      gl_FragColor.a *= smoothstep(uHaze.x, uHaze.y, hazeD);` + TINT_GLSL);
    };
  }

  // ---------- dynamic mesh helpers ----------
  function getMesh(id, key, opts = {}) {
    let m = meshes.get(id);
    if (m && m.userData.isObj) { scene.remove(m); if (m.userData.shadow) scene.remove(m.userData.shadow); meshes.delete(id); m = null; }
    if (!m) {
      m = new THREE.Mesh(geomFor(key), opts.ownMat ? sharedMat.clone() : sharedMat);
      m.userData.key = key;
      scene.add(m);
      if (opts.shadow && SHADOWS) {
        const s = new THREE.Mesh(m.geometry, shadowMatFor(sharedMat));
        s.renderOrder = 2;   // after the ground in the transparent pass, or the chunk mesh can overdraw it
        m.userData.shadow = s;
        scene.add(s);
      }
      meshes.set(id, m);
    }
    if (m.userData.key !== key) {
      m.geometry = geomFor(key);
      m.userData.key = key;
    }
    m.userData.seen = true;
    m.visible = true;
    return m;
  }
  const TILT = -0.42; // lean billboards toward the tilted camera (HD-2D look)

  // ---- stepped terrain altitude (retired prototype half-block style) ----
  // Elevation is quantized to half-block tiers using the same curve the LC
  // engine bridge used (round(pow(rel,1.15)*18) tiers). Water sits at a
  // per-body surface level (waterLevelAt): big bodies one half step below the
  // coast so rivers carve visible channels, small patches just below their own
  // banks. Terrain under a building footprint (+1 ring) is flattened to the
  // building's centre tier.
  const STEP_H = 0.5;
  const groundYCache = new Map();
  // per-section time accumulators for the fresh-tile groundY pass (perf triage)
  const gyPerf = { water: 0, bld: 0, bank: 0, terr: 0, gate: 0, n: 0 };
  // memoized: the elevation noise behind heightAt is the single hottest call
  // in a fresh chunk's groundY pass (bankStep alone samples 8 neighbours per
  // tile). Terrain is static per seed, so entries never invalidate.
  const rawStepCache = new Map();
  function rawStep(wx, wy) {
    const k = wx + "," + wy;
    let v = rawStepCache.get(k);
    if (v !== undefined) return v;
    const e = world.heightAt(wx, wy);
    const rel = Math.max(0, (e - world.LAND_ELEVATION) / (1 - world.LAND_ELEVATION));
    // one half-block tier per 2% of the displayed altitude (Alt% = rel*100)
    v = Math.round(rel * 50) * STEP_H;
    if (rawStepCache.size > 200000) rawStepCache.clear();
    rawStepCache.set(k, v);
    return v;
  }
  // memoized world.insideBuilding: bldAt walks a 3x3 chunk neighbourhood per
  // call, and groundY probes a 3x3 TILE ring per fresh tile — 81 chunk-map
  // walks a tile without this. Buildings are static per seed.
  const bldAtCache = new Map();
  function insideB(x, y) {
    const k = x + "," + y;
    let v = bldAtCache.get(k);
    if (v === undefined) {
      v = world.insideBuilding(x, y);
      if (bldAtCache.size > 200000) bldAtCache.clear();
      bldAtCache.set(k, v);
    }
    return v;
  }
  // buildings whose river-terracing / door forecourts can reach a 16x16-tile
  // cell — one allocation per cell instead of two per fresh tile. Superset of
  // the old per-tile buildingsNear queries; the distance checks in groundY do
  // the real filtering either way.
  const bldsCellCache = new Map();
  function buildingsNearCell(wx, wy) {
    const k = (wx >> 4) + "," + (wy >> 4);
    let v = bldsCellCache.get(k);
    if (v === undefined) {
      v = world.buildingsNear(((wx >> 4) << 4) + 8, ((wy >> 4) << 4) + 8, 24);
      if (bldsCellCache.size > 20000) bldsCellCache.clear();
      bldsCellCache.set(k, v);
    }
    return v;
  }

  // ---- shared-foundation tier for connected buildings --------------------
  // A building footprint flattens to ONE half-block tier so its floor slab and
  // walls sit on level ground. Buildings that SHARE A WALL (row houses, grown
  // settlement blocks) must flatten to the SAME tier, or the party wall they
  // share would straddle a terrain step and the two floors would detach.
  //
  // Two buildings count as connected when their bbox footprints overlap along
  // a line at least one tile long (a shared wall line — organic row-house
  // bboxes overlap by the 1-tile party wall; a single-tile corner touch does
  // NOT count). bldTier() floods the whole connected component and returns the
  // centre tier of the component's canonical member (smallest x0, then y0), so
  // every member resolves to the identical tier no matter which one asks.
  // Static per seed; result is memoised for every member of the component.
  const bldTierCache = new Map();
  function sharesWall(a, b) {
    const ox0 = Math.max(a.x0, b.x0), ox1 = Math.min(a.x0 + a.w - 1, b.x0 + b.w - 1);
    const oy0 = Math.max(a.y0, b.y0), oy1 = Math.min(a.y0 + a.h - 1, b.y0 + b.h - 1);
    // need overlap on both axes, spanning > a single tile (so a bare corner
    // touch, overlap 1x1, is excluded but a 1-tile-thick shared wall is kept)
    return ox0 <= ox1 && oy0 <= oy1 && (ox1 - ox0 + (oy1 - oy0)) >= 1;
  }
  function centreTier(b) { return rawStep(b.x0 + (b.w >> 1), b.y0 + (b.h >> 1)); }
  function bldTier(b) {
    const key = b.x0 + "," + b.y0;
    let v = bldTierCache.get(key);
    if (v !== undefined) return v;
    // flood the connected component by shared-wall adjacency
    const seen = new Map([[key, b]]);
    const stack = [b];
    let canon = b;
    while (stack.length) {
      const cur = stack.pop();
      const cx = cur.x0 + (cur.w >> 1), cy = cur.y0 + (cur.h >> 1);
      for (const nb of world.buildingsNear(cx, cy, Math.max(cur.w, cur.h) + 32)) {
        const nk = nb.x0 + "," + nb.y0;
        if (seen.has(nk) || !sharesWall(cur, nb)) continue;
        seen.set(nk, nb);
        stack.push(nb);
        if (nb.x0 < canon.x0 || (nb.x0 === canon.x0 && nb.y0 < canon.y0)) canon = nb;
      }
    }
    v = centreTier(canon);
    if (bldTierCache.size > 50000) bldTierCache.clear();
    for (const mk of seen.keys()) bldTierCache.set(mk, v);
    return v;
  }

  // per-chunk water mask for fast neighbourhood scans: 0 = land, 1 = water at
  // sea-level elevation (ocean/lakes), 2 = water carved through land (rivers
  // and erosion-basin ponds — raw elevation is above the coast line), 3 =
  // water under a stone_bridge deck (incl. "#p" piers), 4 = land under a
  // stone_bridge deck (the approach span over the bank slope)
  const waterBitsCache = new Map(); // "cx,cy" -> Uint8Array(CHUNK*CHUNK)
  function waterBitsFor(cx, cy) {
    const key = cx + "," + cy;
    let bits = waterBitsCache.get(key);
    if (!bits) {
      const CS = world.CHUNK;
      const ch = world.getChunk(cx, cy);
      bits = new Uint8Array(CS * CS);
      bits.br = false; // any bridge tile in this chunk (fast gate for scans)
      bits.cw = false; // any carved water (bits 2/3) — fast gate for bankStep
      bits.pure1 = true; // nothing but open sea-level water (fast waterLevelAt)
      for (let i = 0; i < CS * CS; i++) {
        const bridge = typeof ch.decor[i] === "string" && ch.decor[i].startsWith("stone_bridge");
        if (bridge) bits.br = true;
        if (isWaterKey(ch.ground[i])) {
          if (bridge) { bits[i] = 3; bits.cw = true; }
          else {
            const e = world.heightAt(cx * CS + (i % CS), cy * CS + (i / CS | 0));
            bits[i] = e >= world.LAND_ELEVATION ? 2 : 1;
            if (bits[i] === 2) bits.cw = true;
          }
        } else if (bridge) bits[i] = 4;
        if (bits[i] !== 1) bits.pure1 = false;
      }
      if (waterBitsCache.size > 256) waterBitsCache.clear();
      waterBitsCache.set(key, bits);
    }
    return bits;
  }
  function waterBit(wx, wy) {
    const CS = world.CHUNK, cx = Math.floor(wx / CS), cy = Math.floor(wy / CS);
    return waterBitsFor(cx, cy)[(wy - cy * CS) * CS + (wx - cx * CS)];
  }
  // any bridge decor within the 17x17 box around (wx,wy)? — cheap chunk-flag
  // gate so the terrace scan doesn't run for every land tile in the world
  function bridgeInBox(wx, wy) {
    const CS = world.CHUNK;
    const cx0 = Math.floor((wx - 8) / CS), cx1 = Math.floor((wx + 8) / CS);
    const cy0 = Math.floor((wy - 8) / CS), cy1 = Math.floor((wy + 8) / CS);
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++)
        if (waterBitsFor(cx, cy).br) return true;
    return false;
  }

  // Water surface level per connected body. Small patches (springs, puddles,
  // ponds — including inland erosion basins whose raw elevation is high) sit
  // one half step below the lowest land tile on their rim, so they no longer
  // plunge to sea level. Anything whose fill overruns the caps (ocean, lakes,
  // rivers) keeps the carved-channel level one half step below the coast.
  const POND_CAP = 400, POND_R = 24;
  const wlPerf = { fills: 0, crawlMs: 0, tiles: 0 }; // fill-cost triage
  const waterLevelCache = new Map(); // "x,y" -> surface y
  // ---- river flood (weather.js floodNow) ----
  // floodLvl is the QUANTIZED flood bucket the world is currently baked at:
  // carved water (rivers/ponds, waterBit 2/3) rides up to +FLOOD_AMP above
  // its resting surface — each 0.25 bucket is exactly one half-block terrain
  // step, so a rare MAXIMUM flood crests 4 full steps above the resting line.
  // The BANKS DO NOT MOVE (bankStep terraces from the resting level) —
  // instead the risen sheet spills over any bank tile that now sits below
  // the surface (floodSurfAt), so a big flood visibly WIDENS the river
  // across its drowned terraces while the water stays one even level.
  // Affected chunk meshes rebuild a couple per frame when the bucket moves
  // (see the frame() hook). The open sea never rises. (NOTE: weather.js has
  // an unrelated FLOOD_RISE — that one is the lag-kernel TIME constant.)
  const FLOOD_AMP = 4 * STEP_H; // full-flood rise: 4 terrain steps
  let floodLvl = 0;
  const _floodRebuild = [];
  // FIX A: budgeted drain queues for the sun-step shadow rebake (see frame()).
  // A sun step used to rebake EVERY chunk + struct shadow in one frame; these
  // spread that over a few frames instead, mirroring _floodRebuild.
  const _shadowChunkQ = [];
  const _shadowStructQ = [];
  function waterLevelAt(wx, wy) {
    const v = waterLevelBase(wx, wy);
    if (floodLvl > 0) {
      const b = waterBit(wx, wy);
      // only RIVERS flood: rain feeds a catchment, not a puddle. Standing
      // carved patches (city pools, springs, erosion-basin ponds) hold their
      // level — riverFlowAt is non-null across a river's stamped width
      // (centreline radius + 2 map units) and null everywhere else.
      if ((b === 2 || b === 3) && world.riverFlowAt && world.riverFlowAt(wx, wy))
        return v + floodLvl * FLOOD_AMP;
    }
    return v;
  }
  function waterLevelBase(wx, wy) {
    const key = wx + "," + wy;
    let v = waterLevelCache.get(key);
    if (v !== undefined) return v;
    // deep-sea shortcut: when the tile's 3x3 chunk neighbourhood is nothing
    // but open sea-level water, the flood fill below provably overruns the
    // pond cap with no carved tiles in reach — the level is exactly -½. Sea
    // chunks used to spend ~120ms re-crawling overlapping fills for this.
    {
      const CSc = world.CHUNK;
      const ccx = Math.floor(wx / CSc), ccy = Math.floor(wy / CSc);
      let pure = true;
      for (let dy = -1; dy <= 1 && pure; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (!waterBitsFor(ccx + dx, ccy + dy).pure1) { pure = false; break; }
      if (pure) {
        waterLevelCache.set(key, -STEP_H);
        return -STEP_H;
      }
    }
    const _w0 = performance.now(); wlPerf.fills++;
    // numeric visit keys: the crawl touches up to ~2000 tiles and string keys
    // dominated its cost in profiles (open-sea chunks were ~150ms each)
    const NK = (x, y) => x * 1048576 + y;
    const seen = new Set([NK(wx, wy)]);
    const queue = [[wx, wy]];
    const tiles = [[wx, wy]]; // water tiles only (queue also crawls bridge decks)
    let minLand = Infinity, big = false;
    let anyCarved = waterBit(wx, wy) >= 2;
    for (let i = 0; i < queue.length; i++) {
      const [tx, ty] = queue[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx, ny = ty + dy, nk = NK(nx, ny);
        if (seen.has(nk)) continue;
        const outside = Math.abs(nx - wx) > POND_R || Math.abs(ny - wy) > POND_R;
        const nb = waterBit(nx, ny);
        if (nb >= 1 && nb <= 3) {
          if (nb >= 2) anyCarved = true;
          if (tiles.length >= POND_CAP || outside) { big = true; continue; }
          seen.add(nk);
          queue.push([nx, ny]);
          tiles.push([nx, ny]);
        } else if (world.getGround(nx, ny) === "floor_wood") {
          // bridge deck / pier: water flows under it — crawl through so a
          // bridge doesn't split a river into two bodies, and don't let the
          // deck count as a rim land tile
          if (!outside) { seen.add(nk); queue.push([nx, ny]); }
        } else {
          const s = rawStep(nx, ny);
          if (s < minLand) minLand = s;
        }
      }
    }
    const base = big || minLand === Infinity ? -STEP_H : minLand - STEP_H;
    if (waterLevelCache.size > 50000) waterLevelCache.clear();
    // open sea / big natural lakes with no carved tiles in the batch: every
    // tile sits at exactly base (-½) — the source ramps, cache reconciliation
    // and relaxation below would all be no-ops, and they were the bulk of a
    // sea chunk's build time
    wlPerf.crawlMs += performance.now() - _w0;
    wlPerf.tiles += tiles.length;
    if (big && !anyCarved) {
      for (const [tx, ty] of tiles) waterLevelCache.set(tx + "," + ty, base);
      return base;
    }
    // Near a spring the water surface climbs back up to ground level: level
    // rises one half step per 2 tiles of arc distance from the source, capped
    // just below the spring's own ground tier. Adjacent water tiles then sit
    // on different half-block tiers, and the cliff-skirt pass draws the steps
    // between them in the water's own art — a stepped cascade.
    const lvl = new Map();
    for (const [tx, ty] of tiles) {
      let lv = base;
      if (waterBit(tx, ty) >= 2 && world.riverSourceAt) {
        const s = world.riverSourceAt(tx, ty);
        if (s) {
          const top = rawStep(s.sx, s.sy) - STEP_H;
          const ramp = top - Math.floor(s.d / 2) * STEP_H;
          if (ramp > lv) lv = ramp;
        }
      }
      lvl.set(tx + "," + ty, lv);
    }
    // Smooth the cascade: the surface never drops more than half a step
    // between adjacent tiles (arc-distance quirks in the source ramp could
    // jump a full tier where the polyline bends). Big bodies (rivers) also
    // reconcile against already-cached neighbouring fill batches of the same
    // river — first lift tiles to within half a step of a higher cached
    // neighbour, then cap everything downward. Small fills (ponds) never
    // consult the cache, so a pond stays perched above the channel it feeds.
    if (big)
      for (const [tx, ty] of tiles) {
        const k2 = tx + "," + ty;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nk = (tx + dx) + "," + (ty + dy);
          if (lvl.has(nk)) continue;
          const nl = waterLevelCache.get(nk);
          if (nl !== undefined && nl - STEP_H > lvl.get(k2)) lvl.set(k2, nl - STEP_H);
        }
      }
    for (let pass = 0; pass < 16; pass++) {
      let changed = false;
      for (const [tx, ty] of tiles) {
        const k2 = tx + "," + ty;
        let cap = Infinity;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nk = (tx + dx) + "," + (ty + dy);
          let nl = lvl.get(nk);
          if (nl === undefined && big) nl = waterLevelCache.get(nk);
          if (nl !== undefined && nl + STEP_H < cap) cap = nl + STEP_H;
        }
        if (cap < lvl.get(k2)) { lvl.set(k2, cap); changed = true; }
      }
      if (!changed) break;
    }
    for (const [k2, lv] of lvl) waterLevelCache.set(k2, lv);
    return waterLevelCache.get(key);
  }

  // River banks: land near water that was carved through the terrain steps
  // down toward the water surface over BANK_R tiles (a terraced slope) instead
  // of dropping in one sheer cliff skirt. Only carved water (bit 2) ramps —
  // coastal cliffs over the sea keep their sheer faces — and ponds sitting
  // just below their own banks barely move the terrain at all.
  const BANK_R = 6;
  function bankStep(wx, wy, raw) {
    // fast path: no carved water (bits 2/3) in any chunk overlapping the scan
    // box → the tile keeps its raw tier. The unconditional 13x13 waterBit
    // scan below was the single hottest loop in fresh-chunk building; away
    // from rivers (most of the world) it never needs to run at all.
    const CS = world.CHUNK;
    const cx0 = Math.floor((wx - BANK_R) / CS), cx1 = Math.floor((wx + BANK_R) / CS);
    const cy0 = Math.floor((wy - BANK_R) / CS), cy1 = Math.floor((wy + BANK_R) / CS);
    let near = false;
    for (let cy = cy0; cy <= cy1 && !near; cy++)
      for (let cx = cx0; cx <= cx1; cx++)
        if (waterBitsFor(cx, cy).cw) { near = true; break; }
    if (!near) return raw;
    let best = raw;
    for (let dy = -BANK_R; dy <= BANK_R; dy++)
      for (let dx = -BANK_R; dx <= BANK_R; dx++) {
        const wb2 = (dx || dy) ? waterBit(wx + dx, wy + dy) : 0;
        if (wb2 === 2 || wb2 === 3) {
          // resting level, NOT the flood-risen one: terrain must not move
          // when the river swells — the flood spills over the fixed banks
          // (floodSurfAt) instead of lifting them
          const wY = waterLevelBase(wx + dx, wy + dy);
          if (wY >= raw - STEP_H) continue; // already at bank level
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          const v2 = wY + (raw - wY) * d / (BANK_R + 1);
          if (v2 < best) best = v2;
        }
      }
    // quantize back onto half-block tiers, staying above the water surface
    return best === raw ? raw : Math.ceil(best / STEP_H - 1e-4) * STEP_H;
  }
  // Flood spill: during a flood the risen sheet overtops low bank tiles. A
  // LAND tile floods when a carved-water tile within FLOOD_R has its risen
  // surface above the tile's own tier; returns {y, key} for the spill sheet
  // (art borrowed from the source water tile) or null. Terrain is untouched —
  // this only drives extra water quads in the chunk ground mesh, so the
  // flooded margin reads as shallow standing water over the fixed bank (and
  // anyone walking it stands ankle-deep under the sheet for free). Paved
  // floors, decks and building interiors stay dry. The scan radius bounds
  // how far the sheet can spread from the channel — a 4-step maximum flood
  // drowns whole terraced aprons, so it reaches well past bankStep's ramp.
  const FLOOD_R = 9;
  function floodSurfAt(wx, wy, gy) {
    if (floodLvl <= 0) return null;
    const g0 = world.getGround(wx, wy);
    if (typeof g0 === "string" && g0.startsWith("floor")) return null;
    if (insideB(wx, wy)) return null;
    // same fast gate as bankStep: no carved water in reach, no spill
    const CS = world.CHUNK;
    const cx0 = Math.floor((wx - FLOOD_R) / CS), cx1 = Math.floor((wx + FLOOD_R) / CS);
    const cy0 = Math.floor((wy - FLOOD_R) / CS), cy1 = Math.floor((wy + FLOOD_R) / CS);
    let near = false;
    for (let cy = cy0; cy <= cy1 && !near; cy++)
      for (let cx = cx0; cx <= cx1; cx++)
        if (waterBitsFor(cx, cy).cw) { near = true; break; }
    if (!near) return null;
    let best = null, bkey = null;
    for (let dy = -FLOOD_R; dy <= FLOOD_R; dy++)
      for (let dx = -FLOOD_R; dx <= FLOOD_R; dx++) {
        if (!dx && !dy) continue;
        const b2 = waterBit(wx + dx, wy + dy);
        if (b2 !== 2 && b2 !== 3) continue;
        const s = waterLevelAt(wx + dx, wy + dy);
        if (s > gy + 0.02 && (best === null || s > best)) {
          best = s;
          bkey = world.getGround(wx + dx, wy + dy);
        }
      }
    return best === null ? null : { y: best, key: bkey };
  }
  // Deck altitude for a bridge tile: ONE flat level for the whole crossing —
  // the highest raw tier over the connected bridge component (water span AND
  // the bank-slope approaches), i.e. the higher bank top. Component-based →
  // deterministic across chunk borders (any seed floods the same component).
  // A span over SEA-level water (a strait/bay overpass) additionally gets a
  // clearance floor: open-sea shores sit at tier ~0 so bank-top alone would
  // lay the deck on the surface — the floor lifts it so boats sail under
  // (passable() needs > 1.01 world units of air over the water at -0.5).
  // The floor RISES WITH SPAN LENGTH: short hops stay a low footbridge, long
  // strait crossings arch up to SEA_DECK_MAX so tall ships (boatClearance —
  // a man-o'-war needs ~2.4 of air) pass beneath. Stepped every SEA_SPAN_STEP
  // sea tiles of the component (~30 tiles of crossing at the ~3-wide deck),
  // and capped so the shore terracing ramp (8 tiles, ½ block per tile) can
  // still climb the approaches.
  const SEA_DECK_MIN = 2 * STEP_H, SEA_DECK_MAX = 6 * STEP_H, SEA_SPAN_STEP = 90;
  const deckYCache = new Map();
  function bridgeDeckY(wx, wy) {
    const key = wx + "," + wy;
    let v = deckYCache.get(key);
    if (v !== undefined) return v;
    const seen = new Set([key]);
    const tiles = [[wx, wy]];
    v = rawStep(wx, wy);
    const overSea = (x, y) => waterBit(x, y) === 3 &&
      world.heightAt(x, y) < world.LAND_ELEVATION;
    let seaN = overSea(wx, wy) ? 1 : 0;
    // cap sized for long sea overpasses (a strait crossing is hundreds of
    // deck tiles); river crossings stay tiny so the old behaviour is intact
    for (let i = 0; i < tiles.length && tiles.length < 6000; i++) {
      const [tx, ty] = tiles[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx, ny = ty + dy, nk = nx + "," + ny;
        if (seen.has(nk)) continue;
        const b2 = waterBit(nx, ny);
        if (b2 !== 3 && b2 !== 4) continue;
        seen.add(nk);
        tiles.push([nx, ny]);
        const s = rawStep(nx, ny);
        if (s > v) v = s;
        if (b2 === 3 && overSea(nx, ny)) seaN++;
      }
    }
    if (seaN > 0) {
      const floor2 = Math.min(SEA_DECK_MAX,
        SEA_DECK_MIN + Math.floor(seaN / SEA_SPAN_STEP) * STEP_H);
      if (v < floor2) v = floor2;
    }
    if (deckYCache.size > 20000) deckYCache.clear();
    for (const [tx, ty] of tiles) deckYCache.set(tx + "," + ty, v);
    return v;
  }

  // city-gate positions that can affect terrain near a 16x16-tile cell —
  // cached so the per-tile groundY pass isn't paying a villagesNear walk for
  // every fresh tile (that showed up in chunk-build profiles)
  const gateCellCache = new Map();
  function gatesNearCell(wx, wy) {
    const key = (wx >> 4) + "," + (wy >> 4);
    let v = gateCellCache.get(key);
    if (v === undefined) {
      v = [];
      if (world.walledVillagesNear)
        for (const v2 of world.walledVillagesNear(wx, wy, 40)) {
          const R2 = v2.R;
          for (const g of [[v2.x - R2, v2.y], [v2.x + R2, v2.y], [v2.x, v2.y - R2], [v2.x, v2.y + R2]])
            if (Math.abs(g[0] - wx) < 40 && Math.abs(g[1] - wy) < 40) v.push(g);
        }
      if (gateCellCache.size > 4000) gateCellCache.clear();
      gateCellCache.set(key, v);
    }
    return v;
  }
  function groundY(wx, wy) {
    const key = wx + "," + wy;
    let v = groundYCache.get(key);
    if (v !== undefined) return v;
    const _t0 = performance.now(); gyPerf.n++;
    if (world.isWater(wx, wy)) { v = waterLevelAt(wx, wy); gyPerf.water += performance.now() - _t0; }
    else {
      let b = null;
      outer: for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          b = insideB(wx + dx, wy + dy);
          if (b) break outer;
        }
      // river-spanning buildings keep their hollow passage: the bank strip
      // inside the footprint (natural ground) and the water-adjacent ring
      // tiles at the passage mouths ramp like any river bank instead of
      // flattening to the building tier
      if (b) {
        const hollow =
          (insideB(wx, wy) &&
            !String(world.getGround(wx, wy)).startsWith("floor")) ||
          (b.river && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
            const wb3 = waterBit(wx + dx, wy + dy);
            return wb3 >= 1 && wb3 <= 3;
          }));
        if (hollow) b = null;
      }
      const _t1 = performance.now(); gyPerf.bld += _t1 - _t0;
      if (b) v = bldTier(b);
      else {
        const raw = rawStep(wx, wy);
        if (world.getGround(wx, wy) === "floor_wood") {
          // free-standing pier deck over the sea: ride one half step above
          // the water it crosses, not the raw tier. waterLevelAt's fill
          // crawls through deck tiles, so seeding it from the deck itself
          // finds the body's level even mid-deck.
          v = Math.min(raw, waterLevelAt(wx, wy) + STEP_H);
        } else {
          v = bankStep(wx, wy, raw);
          const _t2 = performance.now(); gyPerf.bank += _t2 - _t1;
          // Terrain near a crossing or a river building terraces UP toward the
          // deck/plinth level — flat beside the structure, then one half block
          // per tile down until it meets natural ground (no sheer causeway or
          // flatten walls). Exempt: any tile touching water (8-neighbour, so
          // the under-passage corridor never pinches on a diagonal channel
          // curve) and any tile INSIDE a footprint (the hollow strip itself).
          const inBldg = !!insideB(wx, wy);
          let waterAdj = false;
          for (let ay = -1; ay <= 1 && !waterAdj; ay++)
            for (let ax = -1; ax <= 1; ax++) {
              if (!ax && !ay) continue;
              const wb4 = waterBit(wx + ax, wy + ay);
              if (wb4 >= 1 && wb4 <= 3) { waterAdj = true; break; }
            }
          if (!waterAdj && !inBldg) {
            for (const rb of buildingsNearCell(wx, wy))
              if (rb.river) {
                const ddx = Math.max(rb.x0 - wx, 0, wx - (rb.x0 + rb.w - 1));
                const ddy = Math.max(rb.y0 - wy, 0, wy - (rb.y0 + rb.h - 1));
                const d = Math.max(ddx, ddy);
                if (d <= 8) {
                  const t = bldTier(rb) -
                    Math.max(0, d - 1) * STEP_H;
                  if (t > v) v = t;
                }
              }
            // ordinary land buildings flatten their footprint+1 ring to a single
            // bldTier; on sloped ground the natural terrain just beyond that ring
            // can sit MORE than a half step off that tier, and stepClimbOK (half
            // a step max) then refuses the step — an invisible wall ringing the
            // building that also blocks the door. Grade the approach: clamp the
            // natural tier to within (d-1) half-steps of bldTier, BOTH up and
            // down, so the ground terraces to the foundation half a step per tile
            // whichever way the slope runs. (River buildings handled above.)
            for (const rb of buildingsNearCell(wx, wy)) {
              if (rb.river) continue;
              const ddx = Math.max(rb.x0 - wx, 0, wx - (rb.x0 + rb.w - 1));
              const ddy = Math.max(rb.y0 - wy, 0, wy - (rb.y0 + rb.h - 1));
              const d = Math.max(ddx, ddy);
              if (d < 2 || d > 12) continue; // d<=1 is the flattened ring itself
              const bt = bldTier(rb), span = (d - 1) * STEP_H;
              if (v > bt + span) v = bt + span;
              else if (v < bt - span) v = bt - span;
            }
            if (bridgeInBox(wx, wy))
              for (let dy2 = -8; dy2 <= 8; dy2++)
                for (let dx2 = -8; dx2 <= 8; dx2++) {
                  const wb5 = waterBit(wx + dx2, wy + dy2);
                  if (wb5 !== 3 && wb5 !== 4) continue;
                  const dd = Math.max(Math.abs(dx2), Math.abs(dy2));
                  const t = bridgeDeckY(wx + dx2, wy + dy2) - Math.max(0, dd - 1) * STEP_H;
                  if (t > v) v = t;
                }
          }
          const _t3 = performance.now(); gyPerf.terr += _t3 - _t2;
          // door forecourts of river buildings stay flat at the plinth tier
          // even right beside the water — the doorstep never sits in a dip
          if (!inBldg)
            for (const rb of buildingsNearCell(wx, wy))
              if (rb.river) {
                const m2 = world.buildingMeta(rb);
                for (const d3 of [m2.door, m2.door2]) {
                  if (!d3) continue;
                  if (Math.max(Math.abs(wx - d3.x), Math.abs(wy - d3.y)) <= 2) {
                    const t = bldTier(rb);
                    if (t > v) v = t;
                  }
                }
              }
          // city gates stand at ground level on even ground: within the gate
          // apron the terrain snaps to the gate tile's own tier, then eases
          // back to natural ground at half a step per tile so the road
          // through the wall stays steppable and the leaves sit flush
          for (const [gx2, gz2] of gatesNearCell(wx, wy)) {
            const dd = Math.max(Math.abs(wx - gx2), Math.abs(wy - gz2));
            if (dd > 5 || world.isWater(gx2, gz2)) continue; // river gates ride the deck
            const t = rawStep(gx2, gz2);
            if (dd <= 2) v = t;
            else v = Math.max(t - (dd - 2) * STEP_H, Math.min(t + (dd - 2) * STEP_H, v));
          }
          gyPerf.gate += performance.now() - _t3;
        }
      }
    }
    if (groundYCache.size > 200000) groundYCache.clear();
    groundYCache.set(key, v);
    return v;
  }

  // entities stand on the terrain tier (plus the plinth slab inside
  // buildings); the player can additionally be a whole storey up (ladders —
  // playerLiftY, set per frame) or sunk below the water surface wading in
  // deep sea (playerSink, subtracted into playerLiftY; kept separately so
  // the overlay can find the surface again for the air bubbles)
  let playerLiftY = 0, playerSink = 0;
  // cursor level lock while under a span (pickTile): false = river level
  // (default when player.deck === false), true = deck unlocked by hovering land
  let pickHigh = false;
  // The walkable overhead level of a two-level tile: bridge deck height, or a
  // river-spanning building's floor slab; null for ordinary tiles.
  function deckAt(tx, tz) {
    // building first: piers inside a river building carry the building's own
    // floor slab, not a bridge deck of their own
    const b = insideB(tx, tz);
    if (b && (world.isWater(tx, tz) || !String(world.getGround(tx, tz)).startsWith("floor")))
      return bldTier(b) + FLOOR_T;
    if ((world.getDecor(tx, tz) || "").startsWith("stone_bridge"))
      return bridgeDeckY(tx, tz) + FLOOR_T;
    return null;
  }
  // memoized: liftAt runs per entity per frame (and twice more per shadow in
  // place()), and its deckAt/getGround probes walk the chunk map — uncached,
  // they were the render path that forced evicted chunks to REGENERATE for
  // far-away entities. Inputs are static per seed except the river-flood
  // level, so the frame() flood hook clears this alongside groundYCache.
  const liftCache = new Map();
  function liftAt(wx, wz) {
    const tx = Math.floor(wx), tz = Math.floor(wz);
    const k = tx + "," + tz;
    let v = liftCache.get(k);
    if (v !== undefined) return v;
    // two-level tiles: entities over WATER can only be standing on the deck;
    // on the land strip underneath they walk the bank (the player's own
    // deck/under choice is applied in playerLiftY, not here)
    const d = deckAt(tx, tz);
    if (d != null && world.isWater(tx, tz)) v = d;
    else {
      const g = world.getGround(tx, tz);
      const gy = groundY(tx, tz);
      v = g === "floor_wood" || g === "floor_stone" ? gy + FLOOR_T : gy;
    }
    if (liftCache.size > 200000) liftCache.clear();
    liftCache.set(k, v);
    return v;
  }
  // ground lift for overlay projections given interpolated pixel coordinates
  function liftPx(px, py) {
    return groundY(Math.floor(px / (TILE * SCALE)), Math.floor(py / (TILE * SCALE)));
  }
  // is an entity/item on storey `lvl` (of the building at tx,tz) visible to the
  // player? Ground level is always shown; an upper storey only when the player is
  // inside that same building and up on (or above) that floor — otherwise it'd
  // float above the ground-floor ceiling. Mirrors the NPC storey cull.
  function levelVisible(tx, tz, lvl) {
    lvl = lvl | 0;
    if (lvl <= 0) return true;
    if ((player.level | 0) < lvl) return false;
    const pb = world.insideBuilding && world.insideBuilding(player.x, player.y);
    const tb = world.insideBuilding && world.insideBuilding(tx, tz);
    return !!(pb && tb && pb === tb);
  }
  // ---- silhouette shadows (sun-driven) ----
  // Every shadowed billboard gets a sprite silhouette laid flat on the ground
  // along the SUN's current ground direction — the sun is world-anchored and
  // driven by the day/night clock (daynight.js), not the camera:
  //   · azimuth: the sun arcs east → south → west across the daylight window
  //     (continuous sunPhase when available), so shadows sweep west → north →
  //     east through the day and stay put as the camera orbits;
  //   · length: long at dawn/dusk, short at noon (sun elevation);
  //   · the silhouette is the 8-dir sprite frame for the side the sun SEES
  //     (facing minus the sun's octant), not the camera-facing frame;
  //   · shadows fade in/out through a few minutes around sunrise/sunset and
  //     are gone at night.
  const SHADOWS = true;
  const sunState = { up: false, dx: -0.7, dz: -0.55, len: 1, oct: 2, fade: 0, elev: 0, key: "down" };
  function updateSun() {
    if (typeof dayFraction !== "function" || typeof player === "undefined" || !player) return;
    const D = dayFraction(player.y);
    const ph = (typeof sunPhase === "function") ? sunPhase(player.x)
      : (typeof localPhase === "function") ? localPhase(player.x) : 0.5;
    if (D <= 0.001) { sunState.up = false; sunState.fade = 0; sunState.elev = 0; sunState.key = "down"; return; }
    const u = (ph - (0.5 - D / 2)) / D;               // 0 sunrise … 1 sunset
    if (D < 0.999 && (u <= 0 || u >= 1)) { sunState.up = false; sunState.fade = 0; sunState.elev = 0; sunState.key = "down"; return; }
    const uc = Math.min(1, Math.max(0, u));
    // AZIMUTH comes from the raw time of day, not the daylight window: the
    // sun rings the full compass once per cycle — east at ph .25, south at
    // local noon, west at .75, north at midnight. The daylight window then
    // decides which stretch of that circle the sun is visibly ABOVE the
    // horizon for, which is what gives each latitude its season:
    //   · temperate (D≈.5): the familiar east → south → west arc;
    //   · subarctic winter (D→0): a brief, narrow SE → SW skim;
    //   · high summer (D→1): rises NE, sets NW — and at the Fullday Pole the
    //     midnight sun circles the entire horizon, shadows wheeling 360°.
    const th = 2 * Math.PI * (ph - 0.25);
    const sx = Math.cos(th), sz = 0.55 * Math.sin(th); // ±0.55: flattened toward the S/N sky (HD-2D look)
    const n = Math.hypot(sx, sz) || 1;
    sunState.dx = -sx / n; sunState.dz = -sz / n;      // shadows fall opposite the sun
    // ELEVATION by season: noon height peaks at the equatorial day (sin²D)
    // and falls away toward BOTH poles — near the Fullnight Pole the winter
    // sun barely crests the horizon (long pale shadows all day); past D≈.85
    // a midnight-sun floor keeps the sun aloft around the whole circle, so
    // polar-summer shadows are always long and never fade out.
    const base = Math.max(0, (D - 0.85) / 0.15) * 0.12;
    const noonE = Math.max(Math.pow(Math.sin(Math.PI * D), 2), base + 0.08);
    const elev = base + (noonE - base) * Math.sin(Math.PI * uc);
    sunState.elev = elev;                              // 0 horizon … 1 zenith (readable meter)
    // shadow length: gentle growth through the afternoon plus a strong
    // stretch as the sun nears the horizon (up to ~4.3× at the very edge of
    // the day) — evening shadows visibly ELONGATE instead of staying stubby
    sunState.len = 0.35 + (1 - elev) * 0.9 + Math.pow(1 - elev, 6) * 3;
    // horizon fade: thin out gradually across the whole low-sun stretch
    // (last ~12% of the daylight window) WHILE the shadows lengthen, rather
    // than winking out minutes after the light starts to turn. The old
    // elev*5 window was ~2 minutes of real time at the equator — "they just
    // disappear". Same curve plays in reverse through sunrise.
    sunState.fade = Math.pow(Math.min(1, elev / 0.35), 0.8);
    // which 8-dir sprite side the sun sees: octant of the sun's position
    sunState.oct = Math.round((Math.PI / 2 - Math.atan2(sz, sx)) / (Math.PI / 4)) & 7;
    sunState.up = true;
    // bake key: rebuild the baked shadows when the sun has genuinely moved.
    // len is quantized on a sqrt scale — it races from ~1.9 to ~4.3 in the
    // final stretch of sunset, and a linear key would rebake every visible
    // chunk's shadows ten times in under a minute.
    sunState.key = Math.round(th / (Math.PI / 14)) + ":" + Math.round(Math.sqrt(sunState.len) * 5);
    updateSunQuat();
  }
  function sunDir() { return [sunState.dx, sunState.dz]; }
  // quaternion laying a billboard flat with +y (sprite up) along the sun's
  // ground direction and +x (sprite width) along the perpendicular
  const _sunQuat = new THREE.Quaternion();
  const _sunM4 = new THREE.Matrix4();
  function updateSunQuat() {
    // right-handed basis (x × y = +y-up normal) — a left-handed one is not a
    // rotation and setFromRotationMatrix turns it into an edge-on sliver
    _sunM4.makeBasis(
      new THREE.Vector3(-sunState.dz, 0, sunState.dx), // local +x (width) -> perpendicular
      new THREE.Vector3(sunState.dx, 0, sunState.dz),  // local +y (up)    -> sun ground dir
      new THREE.Vector3(0, 1, 0));                     // plane normal     -> world up
    _sunQuat.setFromRotationMatrix(_sunM4);
  }
  // per-frame opacity: all shadow materials share the horizon fade, and cloud
  // cover washes shadows out (an overcast sky casts none)
  function updateShadowFade() {
    const w = (typeof weatherNow === "function") ? weatherNow() : null;
    const clearK = 1 - (w ? w.cloud : 0) * 0.85;
    const op = 0.5 * sunState.fade * clearK;
    for (const m of _shadowMats.values()) m.opacity = op;
    if (shadowDirMat) shadowDirMat.opacity = sunState.fade * clearK;  // its texture bakes the 0.5 body alpha
  }
  const _qShTilt = new THREE.Quaternion();
  const _axisX = new THREE.Vector3(1, 0, 0);
  let sunBakeKey = "";   // sunState.key the baked shadows were last built for
  const _shadowMats = new Map();
  function shadowMatFor(src) {
    let m = _shadowMats.get(src);
    if (!m) {
      m = src.clone();
      m.color = new THREE.Color(0x000000);
      m.opacity = 0.5;
      m.transparent = true;
      m.depthWrite = false;
      m.alphaTest = 0.3;
      m.vertexColors = false;
      // the flatten quaternion leaves the plane's normal pointing down —
      // single-sided source materials would backface-cull the whole shadow
      m.side = THREE.DoubleSide;
      _shadowMats.set(src, m);
    }
    return m;
  }
  function place(m, wx, wz, h, scale = 1, flip = false, flat = false, baseY = 0) {
    m.position.set(wx, baseY + (flat ? 0.02 : (h * scale) / 2 + (m.userData.lift || 0)), wz);
    // flat decor lies down; upright billboards share one orientation that faces the
    // orbiting camera and leans by TILT about the camera-right axis (computed in frame()).
    if (flat) m.rotation.set(-Math.PI / 2, 0, 0);
    else m.quaternion.copy(_bbQuat);
    m.scale.set(flip ? -scale : scale, scale, scale);
    if (m.userData.shadow) {
      const sh = m.userData.shadow;
      if (!sunState.up) { sh.visible = false; return; }
      // the profile the sun sees (set by the caster from its 8-dir sheet and
      // the sun's octant) when it has one, otherwise the displayed sprite
      const sg = m.userData.shadowGeom || m.geometry;
      if (sh.geometry !== sg) sh.geometry = sg;
      // sprite height stretched by the sun's elevation (long at dawn/dusk,
      // short at noon), feet-anchored
      const len = h * scale * sunState.len;
      const [sdx, sdz] = sunDir();
      // ground the shadow on the terrain/water under the feet (not the boat
      // deck or an upper storey), and tilt it to drape over terrain steps
      let ax = wx, az = wz;
      let under = liftAt(wx, wz);
      if (m.userData.airShadow && baseY - under > 0.15) {
        // a flyer's shadow is cast down the sun ray onto the terrain: it
        // slides away from the sun as the bird climbs, by the same
        // horizontal-run-per-unit-height (sunState.len) every standing
        // shadow in the world uses. Iterate because the ground height at
        // the landing point feeds back into the offset on slopes.
        for (let i = 0; i < 3; i++) {
          const off = Math.max(0, baseY - under) * sunState.len;
          ax = wx + sdx * off; az = wz + sdz * off;
          const ng = liftAt(ax, az);
          const done = Math.abs(ng - under) < 0.05;
          under = ng;
          if (done) break;
        }
      }
      const feetY = (m.userData.airShadow || Math.abs(baseY - under) < 1.2) ? under : baseY;
      let tipY = feetY, tilt = 0;
      if (feetY === under) {
        tipY = liftAt(ax + sdx * len, az + sdz * len);
        if (Math.abs(tipY - feetY) > 2) tipY = feetY; // ignore canyon drops
        tilt = Math.atan2(tipY - feetY, len);
      }
      sh.quaternion.copy(_sunQuat);
      if (tilt) sh.quaternion.multiply(_qShTilt.setFromAxisAngle(_axisX, tilt));
      const mid = (len / 2) * Math.cos(tilt);
      sh.position.set(ax + sdx * mid, (feetY + tipY) / 2 + 0.03, az + sdz * mid);
      sh.scale.set(flip ? -scale : scale, len, 1);
      sh.visible = m.visible && !flat;
    }
  }
  const WX = px => px / (TILE * SCALE) + 0.5;

  // ---------- playable character sheet (data-URI texture, 8-dir frames) ----------
  let charTex = null, charMat = null, charImg = null, charW = 0, charH = 0, charMesh = null;
  let armourMesh = null;   // equipped metal armour, tailored + tinted, over the player
  let orbMesh = null;      // the unformed spark: pre-character-selection Tūhura form
  let _playerBB = null;    // billboard drawn for the player this frame — drawOverlay's head anchor
  const _vHead = new THREE.Vector3();
  const CHAR_SCALE = 1.85;
  // Player character-sheet frames sit in a 96px cell that the art fills only to
  // ~77% of its height (headroom above the head), feet ~4% up from the cell
  // bottom — whereas NPC frames are TIGHT crops that fill their plane fully. So
  // at the same scale a player renders ~23% shorter than an equivalent NPC. The
  // player billboard divides its scale by this fill ratio (and drops the feet to
  // the ground) so a player and an NPC of the same build match in world size.
  const CHAR_FILL_H = 0.774, CHAR_FEET_FRAC = 0.042;
  function ensureCharTex() {
    if (charTex || typeof CHAR_SHEET === "undefined") return;
    charImg = new Image();
    charImg.onload = () => {
      charW = charImg.naturalWidth; charH = charImg.naturalHeight; charTex.needsUpdate = true;
      _flushCharPatches();   // community overlay: patches queued before the sheet decoded
    };
    charTex = new THREE.Texture(charImg);
    charTex.magFilter = THREE.NearestFilter;
    charTex.minFilter = THREE.NearestFilter;
    charTex.generateMipmaps = false;
    charMat = new THREE.MeshBasicMaterial({ map: charTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
    tintPatch(charMat);   // the player stands in the same light as the world
    charImg.src = CHAR_SHEET;
  }
  function setCharUV(geom, frame) {
    if (!charW) return false;
    const col = frame % CHAR_COLS, row = Math.floor(frame / CHAR_COLS);
    // half-texel inset — anything smaller lets edge fragments round into the
    // neighbouring cell.
    const cx = col * CHAR_CELL, cy = row * CHAR_CELL, e = 0.5;
    const u0 = (cx + e) / charW, u1 = (cx + CHAR_CELL - e) / charW;
    const v1 = 1 - (cy + e) / charH, v0 = 1 - (cy + CHAR_CELL - e) / charH;
    const uv = geom.attributes.uv;
    uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
    uv.needsUpdate = true;
    return true;
  }
  function getCharMesh() {
    ensureCharTex();
    if (!charMesh) {
      charMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), charMat);
      if (SHADOWS) {
        const s = new THREE.Mesh(charMesh.geometry, shadowMatFor(charMat));
        s.renderOrder = 2;
        charMesh.userData.shadow = s;
        scene.add(s);
      }
      scene.add(charMesh);
    }
    return charMesh;
  }
  // Community overlay: bake a replacement 8-dir frame straight into the
  // player character sheet. The texture's .image starts life as the raw
  // HTMLImageElement (ensureCharTex above) — the FIRST patch hoists it onto a
  // canvas so it becomes drawable/mutable; later patches just draw into that
  // same canvas. Queues (per [charIndex,dirIndex,img]) until the sheet has
  // decoded (charW set), then _flushCharPatches drains it from the onload above.
  let _pendingCharPatches = [];
  function _flushCharPatches() {
    if (!_pendingCharPatches.length) return;
    const pending = _pendingCharPatches; _pendingCharPatches = [];
    for (const [ci, di, img] of pending) patchCharFrame(ci, di, img);
  }
  function patchCharFrame(charIndex, dirIndex, img) {
    if (!charTex || !charW) { _pendingCharPatches.push([charIndex, dirIndex, img]); return false; }
    if (!(charTex.image instanceof HTMLCanvasElement)) {
      const cv = document.createElement("canvas");
      cv.width = charW; cv.height = charH;
      const cx = cv.getContext("2d");
      cx.imageSmoothingEnabled = false;
      cx.drawImage(charTex.image, 0, 0);
      charTex.image = cv;
    }
    const frame = charIndex * 8 + dirIndex;
    const col = frame % CHAR_COLS, row = Math.floor(frame / CHAR_COLS);
    const cx2 = charTex.image.getContext("2d");
    cx2.imageSmoothingEnabled = false;
    cx2.clearRect(col * CHAR_CELL, row * CHAR_CELL, CHAR_CELL, CHAR_CELL);
    cx2.drawImage(img, col * CHAR_CELL, row * CHAR_CELL, CHAR_CELL, CHAR_CELL);
    charTex.needsUpdate = true;
    return true;
  }
  // set a quad's UVs to cell (col,row) of a cols-wide packed sheet (generic setCharUV)
  function setCellUV(geom, col, row, cell, texW, texH) {
    // half-texel inset — anything smaller lets edge fragments round into the
    // neighbouring cell (this also covers outfit sheets + the armour overlay).
    const e = 0.5, cx = col * cell, cy = row * cell;
    const u0 = (cx + e) / texW, u1 = (cx + cell - e) / texW;
    const v1 = 1 - (cy + e) / texH, v0 = 1 - (cy + cell - e) / texH;
    const uv = geom.attributes.uv;
    uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
    uv.needsUpdate = true; return true;
  }

  // ---------- alternate OUTFIT sheets (character-select "outfit" page) ----------
  // Idle is packed in CHAR_SHEET; every other outfit STATE (smallclothes, new_outfit,
  // new_hairstyle, armed, …) is packed into a few EMBEDDED data-URI sheets
  // (tools/build_outfit_sheet.py → OUTFIT_SHEETS[]) — embedded (not fetched) so it
  // works over file://, and split into several sheets because ~700 states in one
  // would exceed the GPU texture-size limit. OUTFIT_FRAME["folder|state"] = [sheetIdx,
  // baseFrame]; the 8 directions follow at base+dirIndex. Each sheet is loaded lazily
  // on first use (states are grouped per character, so normally only one is needed).
  const _outfitSheets = [];   // [sheetIdx] -> {img,tex,mat,shadowMat,w,h}
  function ensureOutfitSheet(si) {
    if (typeof OUTFIT_SHEETS === "undefined" || si == null || si < 0 || si >= OUTFIT_SHEETS.length) return null;
    let e = _outfitSheets[si];
    if (e) return e;
    e = { img: null, tex: null, mat: null, shadowMat: null, w: 0, h: 0 };
    _outfitSheets[si] = e;
    e.img = new Image();
    e.img.onload = () => {
      e.w = e.img.naturalWidth; e.h = e.img.naturalHeight; e.tex.needsUpdate = true;
      _flushOutfitPatches(si);   // community overlay: patches queued before THIS sheet decoded
    };
    e.tex = new THREE.Texture(e.img);
    e.tex.magFilter = THREE.NearestFilter; e.tex.minFilter = THREE.NearestFilter; e.tex.generateMipmaps = false;
    e.mat = new THREE.MeshBasicMaterial({ map: e.tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
    tintPatch(e.mat);   // NPCs share the world's light
    e.shadowMat = shadowMatFor(e.mat);
    e.img.src = OUTFIT_SHEETS[si];
    return e;
  }
  // UV for a frame index in a cols-wide, `cell`-px packed sheet
  function setSheetUV(geom, frame, cols, cell, texW, texH) {
    return setCellUV(geom, frame % cols, Math.floor(frame / cols), cell, texW, texH);
  }
  // Community overlay: bake a replacement costume/outfit frame into one of
  // the packed OUTFIT_SHEETS textures. Queued PER SHEET (a sheet not yet
  // touched this session has no _outfitSheets[si] entry at all — ensureOutfitSheet
  // lazy-creates it on first wear/preview) and flushed from that sheet's own
  // onload above.
  const _pendingOutfitPatches = [];   // [sheetIndex] -> [[frame, img], ...]
  function _flushOutfitPatches(si) {
    const pending = _pendingOutfitPatches[si];
    if (!pending || !pending.length) return;
    _pendingOutfitPatches[si] = [];
    for (const [frame, img] of pending) patchOutfitFrame(si, frame, img);
  }
  function patchOutfitFrame(sheetIndex, frame, img) {
    const e = _outfitSheets[sheetIndex];
    if (!e || !e.w) {
      (_pendingOutfitPatches[sheetIndex] || (_pendingOutfitPatches[sheetIndex] = [])).push([frame, img]);
      return false;
    }
    if (!(e.tex.image instanceof HTMLCanvasElement)) {
      const cv = document.createElement("canvas");
      cv.width = e.w; cv.height = e.h;
      const cx = cv.getContext("2d");
      cx.imageSmoothingEnabled = false;
      cx.drawImage(e.tex.image, 0, 0);
      e.tex.image = cv;
    }
    const col = frame % OUTFIT_SHEET_COLS, row = Math.floor(frame / OUTFIT_SHEET_COLS);
    const cx2 = e.tex.image.getContext("2d");
    cx2.imageSmoothingEnabled = false;
    cx2.clearRect(col * OUTFIT_SHEET_CELL, row * OUTFIT_SHEET_CELL, OUTFIT_SHEET_CELL, OUTFIT_SHEET_CELL);
    cx2.drawImage(img, col * OUTFIT_SHEET_CELL, row * OUTFIT_SHEET_CELL, OUTFIT_SHEET_CELL, OUTFIT_SHEET_CELL);
    e.tex.needsUpdate = true;
    return true;
  }
  // ---------- 8-directional world objects (trees, rocks, stations) ----------
  // Same idea as the character sheet: one packed data-URI texture, foot-anchored
  // 8-dir frames. Static objects show the frame matching the camera azimuth so
  // they present the correct face as the view orbits.
  let objTex = null, objMat = null, objImg = null, objW = 0, objH = 0;
  const objGeomCache = {};
  // rune altars get their own cloned material (never the shared objMat, or the
  // tint would bleed onto every tree/rock/station) so it can shimmer — the
  // stone altar otherwise reads as flat grey and gets lost among the other
  // Runecrafting-area stonework (user req 2026-09-16)
  let altarMat = null;
  function ensureAltarMat() {
    // clone() gives .color its own independent Color instance, but DROPS
    // onBeforeCompile (snow accumulation + world-light uTint) — must re-patch
    // the clone or the altar would render unlit/flat next to everything else
    if (!altarMat && objMat) { altarMat = objMat.clone(); snowPatchTop(altarMat); }
    return altarMat;
  }
  function tickAltarShimmer() {
    if (!altarMat) return;
    const hue = (now / 3400) % 1;
    const light = 0.55 + Math.sin(now / 900) * 0.12; // a slow pulse on top of the hue cycle
    altarMat.color.setHSL(hue, 0.65, light);
  }
  function ensureObjTex() {
    if (objTex || typeof OBJ_SHEET === "undefined") return;
    objImg = new Image();
    objImg.onload = () => {
      objW = objImg.naturalWidth; objH = objImg.naturalHeight; objTex.needsUpdate = true;
      _flushObjPatches();   // community overlay: patches queued before the sheet decoded
    };
    objTex = new THREE.Texture(objImg);
    objTex.magFilter = THREE.NearestFilter;
    objTex.minFilter = THREE.NearestFilter;
    objTex.generateMipmaps = false;
    objMat = new THREE.MeshBasicMaterial({ map: objTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
    snowPatchTop(objMat);   // trees/rocks/furniture whiten from the crown down
    objImg.src = OBJ_SHEET;
  }
  // Community overlay: bake a replacement 8-dir frame into the packed OBJ
  // sheet — same hoist-to-canvas-then-draw trick as patchCharFrame, above.
  let _pendingObjPatches = [];
  function _flushObjPatches() {
    if (!_pendingObjPatches.length) return;
    const pending = _pendingObjPatches; _pendingObjPatches = [];
    for (const [oi, di, img] of pending) patchObjFrame(oi, di, img);
  }
  function patchObjFrame(objIndex, dirIndex, img) {
    if (!objTex || !objW) { _pendingObjPatches.push([objIndex, dirIndex, img]); return false; }
    if (!(objTex.image instanceof HTMLCanvasElement)) {
      const cv = document.createElement("canvas");
      cv.width = objW; cv.height = objH;
      const cx = cv.getContext("2d");
      cx.imageSmoothingEnabled = false;
      cx.drawImage(objTex.image, 0, 0);
      objTex.image = cv;
    }
    const frame = objIndex * 8 + dirIndex;
    const col = frame % OBJ_COLS, row = Math.floor(frame / OBJ_COLS);
    const cx2 = objTex.image.getContext("2d");
    cx2.imageSmoothingEnabled = false;
    cx2.clearRect(col * OBJ_CELL, row * OBJ_CELL, OBJ_CELL, OBJ_CELL);
    cx2.drawImage(img, col * OBJ_CELL, row * OBJ_CELL, OBJ_CELL, OBJ_CELL);
    objTex.needsUpdate = true;
    return true;
  }
  function objGeomFor(gf) {
    if (!objGeomCache[gf]) {
      const g = new THREE.PlaneGeometry(1, 1);
      // half-texel inset — anything smaller lets edge fragments round into
      // the neighbouring cell.
      const col = gf % OBJ_COLS, row = Math.floor(gf / OBJ_COLS), e = 0.5;
      const cx = col * OBJ_CELL, cy = row * OBJ_CELL;
      const u0 = (cx + e) / objW, u1 = (cx + OBJ_CELL - e) / objW;
      const v1 = 1 - (cy + e) / objH, v0 = 1 - (cy + OBJ_CELL - e) / objH;
      const uv = g.attributes.uv;
      uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
      objGeomCache[gf] = g;
    }
    return objGeomCache[gf];
  }
  // which in-world atlas sprite keys are replaced by a directional object, and at
  // what world scale. Stations/rocks are 1:1; trees map the 4 base sprites (and the
  // tiered s_treeN variants, cycled) onto the four tree objects.
  const OBJ_STATION = { furnace: 1.5, anvil: 1.5, loom: 1.5, cauldron: 1.5, workbench: 1.5, tanrack: 1.5, mill: 1.5, altar: 1.5,
    // dedicated station objects (2026-09 art drop, market.js STATION_ART)
    sawmill: 1.5, cooperage: 1.5, malthouse: 1.5, fulling_mill: 1.5, masons_yard: 1.5,
    assay_furnace: 1.5, drawbench: 1.5, leather_bench: 1.5, cobblers_bench: 1.5,
    saddlers_bench: 1.5, toolsmith: 1.5, locksmith_bench: 1.5, paper_mill: 1.5,
    bindery: 1.5, soap_works: 1.5, seasoning_yard: 1.5, charcoal_clamp: 1.5,
    lime_kiln: 1.5, ropewalk: 1.5, shipyard: 1.5, barn: 1.5, creamery: 1.5,
    tailors_bench: 1.5, altar_rune: 1.5, bread_oven: 1.4, brewery_tun: 1.4,
    spinning_wheel: 1.4, dye_vat: 1.4, kiln: 1.4, jewelrytable: 1.4,
    sailmaker_spindle: 1.4, chandler_set: 1.4 };
  const OBJ_ROCK = { rock_copper: 1.2, rock_iron: 1.2, rock_gold: 1.2, rock_essence: 1.2 };
  const OBJ_TREEBASE = { tree: "tree_generic", tree_orange: "tree_maple", tree_pine: "tree_pine", tree_apple: "tree_cherry" };
  const OBJ_TREECYCLE = ["tree_oak", "tree_maple", "tree_pine", "tree_cherry"];
  // tiered mining rock (content.js s_rock<i>) -> dedicated ore object, by METAL_NAMES index
  const OBJ_ROCK_TIER = { 1: "rock_tin", 3: "rock_zinc", 4: "rock_lead", 5: "rock_silver",
    6: "rock_nickel", 7: "rock_cobalt", 9: "rock_platinum", 10: "rock_tungsten", 11: "rock_titanium",
    12: "rock_mithril", 13: "rock_orichalcum", 14: "rock_adamantite", 15: "rock_darksteel", 16: "rock_meteorite",
    17: "rock_runite", 18: "rock_dragonite", 19: "rock_voidsteel", 20: "rock_starmetal",
    21: "rock_bloodiron", 22: "rock_frostiron", 23: "rock_emberite", 24: "rock_stormsteel",
    25: "rock_duskmetal", 26: "rock_dawnmetal", 27: "rock_aetherium", 28: "rock_celestium",
    29: "rock_infernium", 30: "rock_chronite", 31: "rock_eternium" };
  // tiered gem vein (mining-split.js s_gem<i>) -> dedicated gem object, by GEM_NAMES index
  const OBJ_GEM_TIER = { 0: "gem_quartz", 1: "gem_agate", 2: "gem_jasper", 3: "gem_garnet",
    4: "gem_onyx", 5: "gem_amethyst", 6: "gem_topaz", 7: "gem_citrine", 8: "gem_peridot",
    9: "gem_zircon", 10: "gem_tourmaline", 11: "gem_beryl", 12: "gem_aquamarine", 13: "gem_turquoise",
    14: "gem_jade", 15: "gem_malachite", 16: "gem_lapis", 17: "gem_opal", 18: "gem_moonstone",
    19: "gem_sunstone", 20: "gem_bloodstone", 21: "gem_spinel", 22: "gem_ruby", 23: "gem_sapphire",
    24: "gem_emerald", 25: "gem_diamond", 26: "gem_amber", 27: "gem_star_sapphire", 28: "gem_fire_opal",
    29: "gem_voidgem", 30: "gem_aethergem", 31: "gem_worldheart" };
  // tiered tree (content.js s_tree<i>) -> dedicated species object, by TREE_NAMES index
  const OBJ_TREE_TIER = { 1: "tree_oak", 2: "tree_birch", 3: "tree_alder", 4: "tree_pine",
    5: "tree_willow", 6: "tree_cedar", 8: "tree_maple", 9: "tree_cherry",
    7: "tree_poplar", 10: "tree_ash", 11: "tree_beech", 12: "tree_walnut", 13: "tree_cypress",
    14: "tree_fir", 15: "tree_teak", 16: "tree_juniper", 17: "tree_hazel", 18: "tree_rowan",
    19: "tree_mahogany", 20: "tree_ebony", 21: "tree_yew", 22: "tree_redwood", 23: "tree_ironbark",
    24: "tree_frostbark", 25: "tree_silverleaf", 26: "tree_duskwood", 27: "tree_bloodwood",
    28: "tree_starwood", 29: "tree_magic", 30: "tree_elderwood", 31: "tree_worldtree" };
  // per-key world scale (in tiles) for generic decor/props/furniture that render 8-dir.
  // Packed objects are normalized to ~1 tile; these tune each to a natural footprint.
  const OBJ_SCALE = {
    fence_wood: 1.0, gate_wood: 1.0,   // farm-field enclosure fence + gate
    flower_white: 0.5, flower_blue: 0.5, flower_orange: 0.5, flower_purple: 0.5,
    mushroom: 0.45, mushroom_big: 2.2, mushroom_big2: 2.3, seashell: 0.4, leaflitter: 0.6,
    mush_brown: 2.2, mush_purple: 2.4, mush_amber: 2.2, mush_teal: 2.1,   // giant mushroom-forest canopy
    skull: 0.5, sprout: 0.4, wheat_plant: 0.5, coral_red: 0.7, bush: 0.85, bush2: 0.8,
    berrybush: 0.85, boulder: 1.0, moss_rock: 1.0, rock_dead: 1.0, gem_rock: 1.05, fallen_log: 0.9,
    crystal_shard: 0.7, crystal_cluster_blue: 0.9, crystal_cluster_purple: 0.9,
    crystal_cluster_green: 0.9, geode: 0.6, salt_crystal: 0.7, forage_starfruit: 1.2,
    torch: 0.9, barrel: 0.7, haybale: 0.8, crate: 0.7, sign: 0.8, scarecrow: 1.0, cart_gold: 1.05,
    campfire: 0.8, cooking_pot: 0.7, bankchest: 0.8, alchtable: 0.95, signpost_directions: 1.0,
    beehive: 0.75, crab_pot: 0.6, fishing_net: 1.0, hanging_carcass: 1.0, bedroll: 0.7,
    campfire_ring: 0.85, lamppost: 1.25, banner_pole: 1.7, stone_bridge: 1.4,
    city_fountain: 1.2, city_bench: 0.8, city_planter: 0.6, bed: 0.9, bookshelf: 1.0,
    dresser: 0.9, table2: 0.8, chair: 0.6, well: 1.1, tent: 1.2, tent2: 1.2, stall: 1.3,
    // ---- new pixellab objects (2026-08-30) ----
    altar_stone: 1.2, amphora: 0.5, amphora_ornate: 0.62, anvil2: 1.2, aqueduct: 1.55,
    archway_stone: 1.5, awning_rolled: 0.9, barrel_ale: 0.75, barrel_beer: 0.75,
    barrel_cargo: 0.75, barrel_export: 0.75, barrel_fish: 0.75, barrel_flour: 0.75,
    barrel_pickle: 0.75, barrel_scorched: 0.75, barrel_wine: 0.75, bed_fourposter: 1.15,
    bed_frame: 0.95, beehive_box: 0.7, bell_jar: 0.5, bell_rope: 1.0, bellows: 1.0,
    bench_trestle: 0.8, birdbath: 0.95, birdcage: 0.7, birdhouse: 0.7, boards_bundle: 0.7,
    boards_loose: 0.7, boards_stacked: 0.7, boat_barge: 1.25, boat_catboat: 1.25,
    boat_coracle: 1.25, boat_cover: 0.6, boat_dinghy: 1.25, boat_dory: 1.25,
    bookshelf_small: 0.95, brazier_bronze: 0.75, brazier_iron: 0.8, bread_oven: 1.25,
    brewery_tun: 1.35, brewery_tun_open: 1.35, bridge_arch: 1.45, brine_vat: 1.0, bucket: 0.5,
    burial_urn: 0.5, butter_churn: 0.8, cabinet: 0.9, candelabra: 0.6, candle_altar: 0.5,
    candle_bayberry: 0.5, candle_beeswax: 0.5, candle_carriage: 0.5, candle_cathedral: 0.5,
    candle_chime: 0.5, candle_church: 0.5, candle_colored: 0.5, candle_dinner: 0.5,
    candle_dripping: 0.5, candle_ember: 0.5, candle_floating: 0.5, candle_lantern: 0.8,
    candle_pillar: 0.5, candle_rushlight: 0.5, candle_scrying: 0.5, candle_ship: 0.5,
    candle_signal: 0.5, candle_storm: 0.5, candle_taper: 0.5, candle_threewick: 0.5,
    candle_votive: 0.5, candle_white: 0.5, carboy: 0.5, cargo_cover: 0.6, cargo_net: 0.7,
    cargo_sling: 0.6, cartwheel: 0.8, cask_ageing: 0.75, cask_ale: 0.75, cask_carved: 0.75,
    cask_chemical: 0.75, cask_cooper: 0.75, cask_export: 0.75, cask_oak: 0.75,
    cask_ships: 0.75, cask_silver: 0.75, cask_water: 0.75, cathedral_stone: 1.55,
    cauldron_iron: 0.9, censer: 0.5, chandelier_crystal: 0.9, chandelier_iron: 0.9,
    chandler_set: 0.8, chest_storage: 0.75, chest_warded: 0.75, chimney_pot: 0.7,
    chimney_stack: 1.4, cistern: 1.15, clay_bowl: 0.5, clay_cup: 0.5, clay_jug: 0.5,
    clay_plate: 0.5, clockwork: 0.5, cog: 0.5, coin_purse: 0.5, column_stone: 1.55,
    cradle: 0.95, crate_braced: 0.7, crowbar: 0.6, crucible: 0.6, cupboard: 1.05,
    decanter: 0.5, demijohn: 0.5, desk: 0.95, door_wood: 1.35, dresser_mirror: 0.95,
    dye_vat: 1.15, easel: 0.95, fence_wood: 1.4, fender: 0.5, fermentation_vat: 1.25,
    figurine: 0.5, filigree: 0.5, fireplace: 0.9, flask: 0.5, flowerpot: 0.5,
    fountain_small: 1.25, gargoyle: 0.95, gate_iron: 1.4, gate_wood: 1.4, glass_bottle: 0.5,
    glass_jar: 0.5, goblet: 0.5, gravestone3: 0.9, grille: 1.1, hammock: 1.0,
    hammock_canvas: 1.0, hand_mirror: 0.5, hasp: 0.5, hearthstone: 0.7, hinge: 0.5,
    iron_bell: 0.7, jar_storage: 0.5, jewelry_box: 0.5, kiln: 1.4, ladder: 1.0,
    ladder_tall: 1.3, latch: 0.5, lock_birdcage: 0.5, lock_chest: 0.5,
    lock_combination: 0.5, lock_enchanted: 0.5, lock_gate: 0.5, lock_padlock: 0.5,
    lock_plate: 0.5, lock_puzzle: 0.5, lock_tumbler: 0.5, lock_vault: 0.5, lockbox: 0.5,
    mantrap: 0.6, mead_bottle: 0.5, mechanism: 0.5, milk_bottle: 0.5, mug: 0.5,
    offcuts: 0.6, oil_jar: 0.5, oil_lamp: 0.5, pillar_stone: 1.45, pitch_pot: 0.5,
    pitcher: 0.5, planks_seasoned: 0.7, planter_box: 0.6, planter_ceramic: 0.6,
    portcullis_winch: 1.2, pot_lidded: 0.5, pouch: 0.5, powder_keg: 0.6, quiver: 0.6,
    raft_logs: 1.25, raft_planks: 1.25, rampart: 1.4, retort: 0.8, rigging: 0.8,
    roof_tiles_section: 0.7, roof_tiles_stack: 0.6, rope_ladder: 1.2, rope_mat: 0.6,
    sail_cream: 0.8, sail_foresail: 0.8, sail_fullrig: 0.8, sail_gaff: 0.8, sail_jib: 0.8,
    sail_lateen: 0.8, sail_lugsail: 0.8, sail_mainsail: 0.8, sail_masterwork: 0.8,
    sail_mizzen: 0.8, sail_royal: 0.8, sail_spanker: 0.8, sail_square: 0.8,
    sail_squarerig: 0.8, sail_staysail: 0.8, sail_stormjib: 0.8, sail_studding: 0.8,
    sail_topgallant: 0.8, sail_topsail: 0.8, sailmaker_spindle: 0.8, sea_sack: 0.5,
    shackles: 0.5, ship_barque: 1.25, ship_brig: 1.25, ship_brigantine: 1.25,
    ship_caravel: 1.25, ship_carrack: 1.25, ship_clipper: 1.25, ship_cutter: 1.25,
    ship_dhow: 1.25, ship_frigate: 1.25, ship_galleon: 1.25, ship_galley: 1.25,
    ship_junk: 1.25, ship_longship: 1.25, ship_manofwar: 1.25, ship_schooner: 1.25,
    ship_smack: 1.25, sideboard: 0.95, signpost_blank: 1.0, skiff: 1.25, snow_globe: 0.5,
    spinning_wheel: 1.2, stainedglass_blue: 1.0, stainedglass_green: 1.0,
    stainedglass_red: 1.0, statue_marble: 1.05, staves: 0.6, stool: 0.55, strongbox: 0.7,
    tanning_vat: 1.1, tarpaulin: 0.6, teapot: 0.5, tent_bundle: 0.65, terrarium: 0.5,
    timber_beam: 0.7, timber_seasoned: 0.7, toolbox: 0.5, treasure_chest: 0.7,
    tub_storage: 0.75, tumbler: 0.5, tureen: 0.5, urn_garden: 0.75, vase_glazed: 0.5,
    vase_masterwork: 0.58, vault_door: 1.5, vice: 0.6, wall_bracket: 0.6, wall_brick: 1.4,
    wall_keep: 1.4, wall_plaster: 1.4, wall_rubble: 1.4, wallshelf: 0.7, wardrobe: 1.1,
    wash_tub: 0.8, water_filter: 0.7, weathervane: 1.0, well_roofed: 1.35, whetstone: 0.6,
    window_frame: 1.0, window_pane: 1.0, wine_tun: 0.75, wire_frame: 0.6, wire_mesh: 0.6,
  };
  // Furnishing readability pass: the trade objects sized up into clear size
  // classes so interiors read at the HD-2D camera distance — barrels/casks
  // waist-high, vessels and candles small but visible, workshop fixtures
  // imposing. Overrides the base table above.
  Object.assign(OBJ_SCALE, {
    // storage: barrels, casks, crates, chests
    barrel_ale: 0.85, barrel_beer: 0.85, barrel_cargo: 0.85, barrel_export: 0.85,
    barrel_fish: 0.85, barrel_flour: 0.85, barrel_pickle: 0.85, barrel_scorched: 0.85,
    barrel_wine: 0.85, cask_ageing: 0.85, cask_ale: 0.85, cask_carved: 0.85,
    cask_chemical: 0.85, cask_cooper: 0.85, cask_export: 0.85, cask_oak: 0.85,
    cask_ships: 0.85, cask_silver: 0.85, cask_water: 0.85, wine_tun: 0.9,
    tub_storage: 0.85, crate_braced: 0.85, powder_keg: 0.7, chest_storage: 0.85,
    chest_warded: 0.85, treasure_chest: 0.85, strongbox: 0.85, lockbox: 0.62,
    // wood stock
    boards_bundle: 0.82, boards_loose: 0.82, boards_stacked: 0.82,
    planks_seasoned: 0.82, timber_beam: 0.82, timber_seasoned: 0.82,
    staves: 0.75, offcuts: 0.7,
    // sacks, canvas, cordage
    sea_sack: 0.65, pouch: 0.55, quiver: 0.7, cargo_net: 0.8, cargo_sling: 0.7,
    cargo_cover: 0.7, tarpaulin: 0.7, boat_cover: 0.7, awning_rolled: 0.95,
    rope_mat: 0.7, rope_ladder: 1.25, hammock: 1.05, hammock_canvas: 1.05,
    // vessels and tableware
    amphora: 0.6, amphora_ornate: 0.7, clay_bowl: 0.55, clay_cup: 0.55,
    clay_jug: 0.6, clay_plate: 0.55, glass_bottle: 0.55, glass_jar: 0.55,
    decanter: 0.55, tumbler: 0.55, goblet: 0.55, mug: 0.55, pitcher: 0.6,
    teapot: 0.6, tureen: 0.6, flask: 0.55, oil_jar: 0.6, oil_lamp: 0.6,
    bell_jar: 0.6, carboy: 0.62, demijohn: 0.62, jar_storage: 0.62,
    pot_lidded: 0.6, mead_bottle: 0.55, milk_bottle: 0.55, pitch_pot: 0.6,
    vase_glazed: 0.62, burial_urn: 0.62, terrarium: 0.6,
    // candles and lights
    candle_altar: 0.58, candle_bayberry: 0.58, candle_beeswax: 0.58,
    candle_carriage: 0.58, candle_cathedral: 0.58, candle_chime: 0.58,
    candle_church: 0.58, candle_colored: 0.58, candle_dinner: 0.58,
    candle_dripping: 0.58, candle_ember: 0.58, candle_floating: 0.58,
    candle_pillar: 0.58, candle_rushlight: 0.58, candle_scrying: 0.58,
    candle_ship: 0.58, candle_signal: 0.58, candle_storm: 0.58,
    candle_taper: 0.58, candle_threewick: 0.58, candle_votive: 0.58,
    candle_white: 0.58, candelabra: 0.72, chandler_set: 0.9, censer: 0.6,
    candle_lantern: 0.85, brazier_bronze: 0.85,
    // village street candle-stands (villagers set these out at dusk)
    candlestand_iron: 1.2, candlestand_wood: 1.15, candlestand_brass: 1.2,
    // locks and trinkets
    lock_birdcage: 0.55, lock_chest: 0.55, lock_combination: 0.55,
    lock_enchanted: 0.55, lock_gate: 0.55, lock_padlock: 0.55, lock_plate: 0.55,
    lock_puzzle: 0.55, lock_tumbler: 0.55, lock_vault: 0.55, hasp: 0.55,
    hinge: 0.55, latch: 0.55, figurine: 0.58, filigree: 0.58, coin_purse: 0.58,
    jewelry_box: 0.58, hand_mirror: 0.58, snow_globe: 0.58, clockwork: 0.6,
    cog: 0.6, mechanism: 0.6, birdcage: 0.8,
    // tools and small gear
    toolbox: 0.68, bucket: 0.62, crowbar: 0.7, vice: 0.75, whetstone: 0.7,
    crucible: 0.7, shackles: 0.6, mantrap: 0.7, wall_bracket: 0.7,
    water_filter: 0.8, hearthstone: 0.8, wire_frame: 0.75, wire_mesh: 0.75,
    fender: 0.6, cartwheel: 0.9,
    // furniture
    stool: 0.65, bench_trestle: 0.9, wallshelf: 0.9, sideboard: 1.0,
    cabinet: 1.0, cupboard: 1.1, desk: 1.0, easel: 1.0, dresser_mirror: 1.05,
    wardrobe: 1.2, bookshelf_small: 1.05, bed_frame: 1.0, bed_fourposter: 1.2,
    cradle: 1.0,
    // workshop fixtures
    bellows: 1.05, cauldron_iron: 1.05, retort: 0.85, brine_vat: 1.1,
    wash_tub: 0.95, butter_churn: 0.95, dye_vat: 1.2, tanning_vat: 1.2,
    spinning_wheel: 1.25, bread_oven: 1.3, brewery_tun: 1.4,
    brewery_tun_open: 1.4, fermentation_vat: 1.3, kiln: 1.45, cistern: 1.2,
    anvil2: 1.25, sailmaker_spindle: 0.95, rigging: 0.95, ladder: 1.1,
    ladder_tall: 1.35, iron_bell: 0.8, bell_rope: 1.1, portcullis_winch: 1.25,
    stainedglass_blue: 1.1, stainedglass_green: 1.1, stainedglass_red: 1.1,
    // sail loft stock
    sail_cream: 0.95, sail_foresail: 0.95, sail_fullrig: 0.95, sail_gaff: 0.95,
    sail_jib: 0.95, sail_lateen: 0.95, sail_lugsail: 0.95, sail_mainsail: 0.95,
    sail_masterwork: 0.95, sail_mizzen: 0.95, sail_royal: 0.95,
    sail_spanker: 0.95, sail_square: 0.95, sail_squarerig: 0.95,
    sail_staysail: 0.95, sail_stormjib: 0.95, sail_studding: 0.95,
    sail_topgallant: 0.95, sail_topsail: 0.95,
    // masonry stock
    roof_tiles_stack: 0.7, roof_tiles_section: 0.8, chimney_pot: 0.8,
    window_frame: 1.1, window_pane: 1.1, urn_garden: 0.85, planter_ceramic: 0.7,
  });
  // ---- Furniture proportion pass (2026-09-08) ----
  // Household furniture sized against the PEOPLE who use it (CHAR_SCALE 1.85,
  // storey band 1.8): beds long enough for a villager to lie on (renderMixNpc
  // lays sleepers flat on them), wardrobes person-height, chairs seat-height.
  // The earlier readability pass sized workshop stock; this fixes the bedroom
  // and parlour pieces that still read as dollhouse furniture next to a 1.85
  // villager. Ceiling cap ~1.65 (fourposter) keeps everything under the beam.
  Object.assign(OBJ_SCALE, {
    // beds & bedding
    bed: 1.45, bed_frame: 1.45, bed_fourposter: 1.62, bedroll: 1.0,
    hammock: 1.25, hammock_canvas: 1.25, cradle: 1.0,
    // tall casework
    wardrobe: 1.6, cupboard: 1.4, bookshelf: 1.4, bookshelf_small: 1.2,
    dresser_mirror: 1.35, cabinet: 1.25, fireplace: 1.3,
    // waist-height pieces
    dresser: 1.15, sideboard: 1.15, desk: 1.15, table2: 1.05, alchtable: 1.15,
    // seating & small stands
    chair: 0.85, stool: 0.7, bench_trestle: 1.0, city_bench: 0.95, easel: 1.2,
  });
  // ---- Per-species tree scale, proportional to real-world size (2026-09-05) ----
  // Every tree_ species previously fell back to a flat 2.2 (the tree_/nz_ default in
  // objScaleFor); this replaces that with a scale driven by the species' real mature
  // HEIGHT, with a small bonus for exceptionally stout/broad GIRTH (oak, baobab, yew,
  // beech, cedar…). Calibrated to the same curve the NZ natives already use
  // (NZ_TREE_SCALE: kauri 45m->4.0, kahikatea ~58m->3.8, rimu ~35m->3.4), so the whole
  // forest reads at one consistent real scale. Formula: 0.96*H_m^0.338 + girthBonus.
  // Scale is UNIFORM (place() multiplies width and height equally off a square
  // billboard) so nothing stretches; the max is held at ~4.2 — the existing kauri sits
  // at 4.0, so no species is enlarged past the already-shipped resolution ceiling and
  // nothing new pixelates. Small species (juniper, hazel, cherry, the worldtree
  // *sapling*) drop below 2.2 and actually render crisper than before.
  Object.assign(OBJ_SCALE, {
    tree_generic: 2.5,                                    // ~20m, generic broadleaf
    tree_oak: 3.25,     // ~25m, girth to 12m — broad & iconic
    tree_birch: 2.45,   // ~22m, slender
    tree_alder: 2.8,    // ~25m
    tree_pine: 3.1, tree_pine_snow: 3.1,                 // Scots pine ~30-35m
    tree_willow: 2.8,   // ~18m, broad weeping crown
    tree_cedar: 3.7,    // ~45m, massive spreading
    tree_poplar: 2.85,  // Lombardy ~30m, tall but columnar (narrowness is in the art)
    tree_maple: 2.8,    // ~22m, broad
    tree_cherry: 2.2,   // ~12m
    tree_ash: 2.9,      // ~28m, airy spreading
    tree_beech: 3.4,    // ~32m, big girth, broad dome
    tree_walnut: 3.05,  // ~25m, broad rounded
    tree_cypress: 2.8,  // ~30m, narrow
    tree_fir: 3.6,      // silver fir ~50m, tall conical
    tree_teak: 3.3,     // ~35m
    tree_juniper: 1.65, // ~6m, shrubby
    tree_hazel: 1.7,    // ~7m, coppice shrub
    tree_rowan: 2.2,    // ~12m
    tree_mahogany: 3.35,// ~35m
    tree_ebony: 2.7,    // ~20m, dense
    tree_yew: 2.75,     // ~15m but enormous ancient girth — squat, imposing
    tree_redwood: 4.2,  // coast redwood 100m+, tallest on Earth (held at the 4.2 cap)
    tree_ironbark: 3.15,// eucalypt ~30m, rugged
    tree_baobab: 3.05,  // ~18m but 5-11m trunk ⌀ — girth-boosted for presence
    tree_kauri: 4.0,    // ~45m, 15m girth (matches nz_kauri)
    tree_palm: 2.5,     // ~20m, slender trunk
    // fantasy species — scaled by their described form/lore
    tree_frostbark: 2.7,   // pale birch/beech-like, ~25m
    tree_silverleaf: 2.6,  // shimmering, graceful ~20m
    tree_duskwood: 2.9,    // dark, large ~28m
    tree_bloodwood: 3.1,   // crimson, lofty ~30m
    tree_starwood: 3.2,    // glowing, lofty ~32m
    tree_magic: 2.9,       // luminous teal crown, tall ~28m
    tree_elderwood: 3.65,  // ancient elder, huge ~40m + girth
    tree_dreamwood: 3.0,   // glowing blue, large ~30m
    tree_charred: 2.3,     // burnt bare tree, gaunt ~18m
    tree_worldtree: 4.6,   // a glowing golden SAPLING of the cosmic world-tree — even
                           // an infant of a heaven-reaching tree towers over every
                           // mortal species, so it's the single largest tree in the world

  });
  // ---- Per-hull vessel scale: REAL ship lengths (2026-09-11) ----
  // Hull billboards are sized in TILES from the Shipwrighting hull tier
  // (ITEMS[id].boat 1..32): length = the tier itself, clamped [2, 32] — a
  // raft spans a couple of tiles, a man-o'-war a full 32. Derived at first
  // use from ITEMS (shipwrighting.js sets .boat, furniture.js sets .place),
  // so new hulls pick up their size automatically; where several tiers share
  // one sprite (sloop+cutter → ship_cutter) the key takes its TOP tier via
  // max(). boatClearance() (state.js) has its own modest tier curve — bridge
  // rules are unchanged by the visual size.
  let _hullScaled = false;
  function ensureHullScales() {
    if (_hullScaled || typeof ITEMS === "undefined") return;
    _hullScaled = true;
    for (const id in ITEMS) {
      const d = ITEMS[id];
      if (d && d.boat && d.place)
        OBJ_SCALE[d.place] = Math.max(OBJ_SCALE[d.place] || 0, Math.min(32, Math.max(2, d.boat)));
    }
  }
  function objScaleFor(key) {
    ensureHullScales();
    if (OBJ_SCALE[key] != null) return OBJ_SCALE[key];
    // NZ species carry their real-scale size in NZ_TREE_SCALE (used both by the
    // tree billboards and the small-plant decorations placed by key "nz_*")
    if (typeof NZ_TREE_SCALE !== "undefined" && NZ_TREE_SCALE[key] != null) return NZ_TREE_SCALE[key];
    if (key.startsWith("tree_") || key.startsWith("nz_")) return 2.2;
    if (key.startsWith("rock_")) return 1.2;
    if (key.startsWith("forage_")) return 0.85;
    if (key.startsWith("herb_")) return 0.5;
    if (key.startsWith("crystal_")) return 0.9;
    if (key.startsWith("wall_") || key.startsWith("tower_") || key === "fence_broken" || key === "windmill_small") return 1.4;
    return 0.9;
  }
  function objForKey(key) {
    if (typeof OBJ_MAP === "undefined" || !key) return null;
    if (OBJ_STATION[key] != null && OBJ_MAP[key] != null) return { idx: OBJ_MAP[key], scale: OBJ_STATION[key] };
    if (OBJ_ROCK[key] != null && OBJ_MAP[key] != null) return { idx: OBJ_MAP[key], scale: OBJ_ROCK[key] };
    if (key === "stump" && OBJ_MAP.stump != null) return { idx: OBJ_MAP.stump, scale: 1.3 };
    if (key === "gravestone" && OBJ_MAP.gravestone2 != null) return { idx: OBJ_MAP.gravestone2, scale: 0.9 };
    if (OBJ_TREEBASE[key] && OBJ_MAP[OBJ_TREEBASE[key]] != null) return { idx: OBJ_MAP[OBJ_TREEBASE[key]], scale: objScaleFor(OBJ_TREEBASE[key]) };
    // tiered mining rock: dedicated ore object if generated, else fall back to the flat recolour
    if (key.startsWith("s_rock")) {
      const ok = OBJ_ROCK_TIER[parseInt(key.slice(6), 10)];
      return (ok && OBJ_MAP[ok] != null) ? { idx: OBJ_MAP[ok], scale: 1.2 } : null;
    }
    // tiered gem vein: dedicated gem object if generated, else fall back to the flat recolour
    if (key.startsWith("s_gem")) {
      const gk = OBJ_GEM_TIER[parseInt(key.slice(5), 10)];
      return (gk && OBJ_MAP[gk] != null) ? { idx: OBJ_MAP[gk], scale: 1.15 } : null;
    }
    if (key.startsWith("s_tree")) {
      const i = parseInt(key.slice(6), 10) || 0;
      const tk = OBJ_TREE_TIER[i];
      if (tk && OBJ_MAP[tk] != null) return { idx: OBJ_MAP[tk], scale: objScaleFor(tk) };
      const ok = OBJ_TREECYCLE[i % 4];
      if (OBJ_MAP[ok] != null) return { idx: OBJ_MAP[ok], scale: objScaleFor(ok) };
    }
    // NZ trees (js/nz-extra-trees.js): each species has its own dedicated
    // packed object and its own real-world-proportional scale.
    if (key.startsWith("nzf_") && typeof NZ_TREE_SCALE !== "undefined") {
      const treeKey = "nz_" + key.slice(4);
      if (OBJ_MAP[treeKey] != null) return { idx: OBJ_MAP[treeKey], scale: NZ_TREE_SCALE[treeKey] || 2.2 };
    }
    // generic: any decor/prop/furniture sprite key with a matching packed object
    // renders as an 8-directional billboard instead of the flat atlas sprite.
    if (OBJ_MAP[key] != null) return { idx: OBJ_MAP[key], scale: objScaleFor(key) };
    return null;
  }
  // returns a mesh showing object `objIdx` from the current camera azimuth, or null
  // if the object texture hasn't loaded yet (caller falls back to the atlas sprite).
  function getObjMesh(id, objIdx, forceFrame) {
    ensureObjTex();
    if (!objW) return null;
    let m = meshes.get(id);
    if (m && !m.userData.isObj) { scene.remove(m); if (m.userData.shadow) scene.remove(m.userData.shadow); meshes.delete(id); m = null; }
    // forceFrame pins a specific direction sprite (0 = south) regardless of the
    // camera angle — decor uses it so props always show their south frame.
    const frame = forceFrame != null ? (forceFrame & 7) : (8 - camDir) & 7; // else worldDir 0 seen from the eased camera angle
    const gf = objIdx * 8 + frame;
    const isAltar = typeof OBJ_MAP !== "undefined" && objIdx === OBJ_MAP.altar;
    const mat = isAltar ? (ensureAltarMat() || objMat) : objMat;
    if (!m) {
      m = new THREE.Mesh(objGeomFor(gf), mat);
      m.rotation.order = "YXZ";
      m.userData.isObj = true;
      if (SHADOWS) {
        const s = new THREE.Mesh(m.geometry, shadowMatFor(objMat));
        s.renderOrder = 2;
        m.userData.shadow = s;
        scene.add(s);
      }
      scene.add(m);
      meshes.set(id, m);
    }
    if (m.userData.objFrame !== gf) { m.geometry = objGeomFor(gf); m.userData.objFrame = gf; }
    // the shadow shows the side the SUN currently sees (a static object faces
    // "south", so its sun-side frame is just the negated sun octant),
    // independent of the camera-facing frame the mesh displays
    m.userData.shadowGeom = objGeomFor(objIdx * 8 + ((8 - sunState.oct) & 7));
    m.userData.seen = true;
    m.visible = true;
    return m;
  }

  // Boot preload (main.js awaits this before the loading overlay drops): force
  // the CHARACTER and OBJECT art sheets to decode BEFORE the first frame paints.
  // Otherwise the opening frames fall back to LEGACY art — getObjMesh returns
  // null while !objW, so every tree/rock/station/decor draws its flat atlas
  // sprite, and the player billboard is blank while !charW — and then visibly
  // pop to the real art a beat later once the webp finishes loading. Resolves on
  // load OR error (a bad sheet must never wedge boot) and instantly if already
  // decoded (warm boot / SW cache).
  function preloadArt() {
    ensureCharTex();
    ensureObjTex();
    const wait = im => new Promise(res => {
      if (!im || (im.complete && im.naturalWidth > 0)) return res();
      im.addEventListener("load", () => res(), { once: true });
      im.addEventListener("error", () => res(), { once: true });
    });
    return Promise.all([wait(charImg), wait(objImg)]).then(() => {});
  }

  // ---------- init ----------
  // Returns false if WebGL is unavailable or canvas data is blocked.
  function init() {
    const canvas = document.getElementById("game");
    try {
      if (typeof THREE === "undefined") return false;
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    } catch (e) {
      console.warn("WebGL unavailable:", e.message);
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    scene = new THREE.Scene();
    if (typeof window !== "undefined") window._R3DScene = scene; // headless-test hook
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 28, 52);
    camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1600);   // far covers the LOD horizon
    overlay = document.getElementById("overlay");
    octx = overlay.getContext("2d");

    const shadowCv = document.createElement("canvas");
    shadowCv.width = 32; shadowCv.height = 32;
    const sc = shadowCv.getContext("2d");
    const grad = sc.createRadialGradient(16, 16, 2, 16, 16, 14);
    grad.addColorStop(0, "rgba(0,0,0,0.35)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    sc.fillStyle = grad;
    sc.fillRect(0, 0, 32, 32);
    shadowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCv), transparent: true, depthWrite: false });
    shadowGeom = new THREE.PlaneGeometry(0.9, 0.6);

    try {
      if (!atlas) buildAtlas(); // boot pre-bakes it via buildAtlasAsync (main.js)
    } catch (e) {
      console.warn("Atlas build failed:", e.message);
      return false;
    }
    // structural billboards use DERIVED placeholder sprites (no retired prototype 2D art
    // exists — LC is voxel); track them so they can be swapped for bespoke art.
    if (typeof registerPlaceholder === "function")
      for (const [k, n] of [["door_wood", "Wooden door"], ["door_stone", "Castle door"],
        ["gate_leaf", "City gate leaf"], ["ladder", "Ladder"], ["stairs", "Staircase"]])
        registerPlaceholder("spr:" + k, n, "structural billboard — tinted placeholder sprite");
    initSea();
    initSkyDome();
    initClouds();
    syncChunks();
    try { performance.mark("ef:firstChunks"); } catch (e) { /* boot beacon */ }
    resize();
    camPos.set(WX(player.px), 9, WX(player.py) + 7);
    ready = true;
    return true;
  }

  // On a HiDPI/Retina display, a canvas whose backing store is sized in CSS
  // pixels gets upscaled by the browser to fill the same box at the real
  // (higher) device resolution — every 2D-canvas-drawn thing (floats, HP
  // bars, name labels; this is on TOP of the separately-DPR-aware WebGL
  // view, which is why only the overlaid TEXT looked soft/pixelated, not
  // the 3D scene under it) ends up blurry. Sizing the backing store by
  // devicePixelRatio and scaling the context to match fixes that while
  // every existing draw call keeps using plain CSS-pixel coordinates —
  // project() and the per-frame draw loop reference overlayCssW/H (the
  // logical size) rather than overlay.width/height (the scaled backing
  // store) for exactly that reason.
  function resize() {
    if (!renderer) return;
    const w = Math.max(320, gamecol.clientWidth), h = Math.max(240, gamecol.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    overlayCssW = w; overlayCssH = h;
    overlay.width = Math.round(w * dpr);
    overlay.height = Math.round(h * dpr);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------- projection / picking ----------
  function project(px, py, h = 0) {
    _v.set(WX(px), h, WX(py)).project(camera);
    return { x: (_v.x + 1) / 2 * overlayCssW, y: (1 - _v.y) / 2 * overlayCssH, behind: _v.z > 1 };
  }
  const raycaster = new THREE.Raycaster();
  const _pkP = new THREE.Vector3(), _pkC = new THREE.Vector3(); // pickTile bird-pick temps
  function pickTile(e) {
    const r = renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera({ x: nx, y: ny }, camera);
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    if (Math.abs(d.y) < 1e-6) return { x: -1, y: -1 };
    // flying/roosting birds hang above the terrain — the ground ray passes
    // underneath them, so pick them first by ray proximity to the billboard
    // centre; a hit maps to the bird's ground-projected tile, which is what
    // targetsAt() matches monsters by
    if (typeof monsters !== "undefined") {
      let bird = null, bt = Infinity;
      for (const mm of monsters) {
        if (!mm.alive || mm.flyAbs == null) continue;
        const sc = (MONSTERS[mm.kind].scale || 1) * (mm.giant ? 1.5 : 1);
        _pkP.set(WX(mm.px), mm.flyAbs + sc * 0.5, WX(mm.py));
        const t = _pkC.copy(_pkP).sub(o).dot(d);
        if (t <= 0 || t >= bt) continue;
        _pkC.copy(d).multiplyScalar(t).add(o);
        if (_pkC.distanceTo(_pkP) <= Math.max(0.45, sc * 0.55)) { bt = t; bird = mm; }
      }
      if (bird) return { x: bird.x, y: bird.y };
    }
    const lv = player.level | 0;
    if (lv > 0) {
      // upstairs: clicks land on the floor plane the player is standing on
      const planeY = groundY(player.x, player.y) + lv * STOREY_H + 0.02;
      const t = (planeY - o.y) / d.y;
      if (t < 0) return { x: -1, y: -1 };
      return { x: Math.floor(o.x + d.x * t), y: Math.floor(o.z + d.z * t) };
    }
    // inside a river-spanning building at floor level: clicks land on the
    // floor-slab plane (the terrain raycast would tunnel through the hollow
    // to the river below and select a parallax-shifted tile)
    if (!player.sailing && player.deck !== false) {
      const bIn = world.insideBuilding(player.x, player.y);
      if (bIn && bIn.river) {
        const planeY = bldTier(bIn) + FLOOR_T;
        const t2 = (planeY - o.y) / d.y;
        if (t2 > 0) {
          const hx = Math.floor(o.x + d.x * t2), hy = Math.floor(o.z + d.z * t2);
          if (hx >= bIn.x0 && hx < bIn.x0 + bIn.w && hy >= bIn.y0 && hy < bIn.y0 + bIn.h)
            return { x: hx, y: hy };
        }
      }
    }
    // ground level: raycast the stepped terrain meshes so clicks land on the
    // tile actually under the cursor, whatever its tier
    const targets = [];
    for (const g of chunkMeshes.values()) {
      if (g.userData.groundMesh) targets.push(g.userData.groundMesh);
      if (g.userData.skirtMesh) targets.push(g.userData.skirtMesh);
    }
    const hits = raycaster.intersectObjects(targets, false);
    let hx2, hy2;
    if (hits.length) {
      const p = hits[0].point;
      // nudge BACK toward the camera, not along the ray: pushing into the
      // terrain flips the pick to the higher tile behind a terrace crest,
      // which made the cursor pop uphill while panning over hills
      hx2 = Math.floor(p.x - d.x * 0.001); hy2 = Math.floor(p.z - d.z * 0.001);
    } else {
      const t = -o.y / d.y;
      if (t < 0) return { x: -1, y: -1 };
      hx2 = Math.floor(o.x + d.x * t); hy2 = Math.floor(o.z + d.z * t);
    }
    // travelling under a bridge/building (deck === false): the selector is
    // locked to the river level by default — a pick landing on the two-level
    // span overhead re-projects onto the player's water plane. Sweeping the
    // cursor over plain land clears the lock (pickHigh), so the deck can
    // still be selected by circling up out of the river and onto the bridge;
    // sweeping back over open water re-arms it.
    if (player.deck === false && !player.sailing) {
      if (!pickDual(hx2, hy2)) {
        const wb6 = waterBit(hx2, hy2);
        pickHigh = !(wb6 >= 1 && wb6 <= 3);
      } else if (!pickHigh) {
        const planeY = groundY(player.x, player.y) + 0.02;
        const t2 = (planeY - o.y) / d.y;
        if (t2 > 0) {
          const lx2 = Math.floor(o.x + d.x * t2), lz2 = Math.floor(o.z + d.z * t2);
          const wbL = waterBit(lx2, lz2);
          const bL = world.insideBuilding(lx2, lz2);
          if ((wbL >= 1 && wbL <= 3) ||
              (bL && !String(world.getGround(lx2, lz2)).startsWith("floor")))
            return { x: lx2, y: lz2 };
        }
      }
    } else pickHigh = false;
    return { x: hx2, y: hy2 };
  }
  // a two-level tile for picking purposes: bridge deck (incl. approach spans)
  // or the span/hollow of a river building
  function pickDual(tx, tz) {
    if ((world.getDecor(tx, tz) || "").startsWith("stone_bridge")) return true;
    const b = world.insideBuilding(tx, tz);
    return !!b && (world.isWater(tx, tz) || !String(world.getGround(tx, tz)).startsWith("floor"));
  }

  // ---------- per-frame sync ----------
  function syncNodes() {
    for (const n of (world.nodesNearLoaded || world.nodesNear)(player.x, player.y, viewRadius())) {
      const id = n._mid || (n._mid = "n" + n.id);   // FIX F: build the mesh id once, not every frame (n.id is stable)
      let key = null, scale = 1, flat = false, treeMul = 1;
      if (n.portal) { key = "archway_stone"; scale = 1.7; }
      else if (n.station) key = STATIONS[n.type].spr;
      else if (n.farm) {
        if (n.crop) {
          const crop = CROPS[n.crop.kind];
          const p = (now - n.crop.plantedAt) / (typeof cropGrowMs === "function" ? cropGrowMs(crop) : crop.time);
          if (crop.tree) {
            // Pomiculture: a barren fruit tree that grows from a sapling; the
            // crop's own fruit is hung on the canopy once ripe, and vanishes
            // once picked (leaving the bare tree to be chopped for logs).
            key = "tree_fruit";
            treeMul = p >= 1 ? 1 : 0.4 + 0.6 * Math.min(1, p);
            if (p >= 1 && !n.crop.picked) {
              const fspr = ITEMS[crop.item] && ITEMS[crop.item].icon;
              if (fspr && SPR[fspr]) {
                const base = objScaleFor("tree_fruit") * treeMul;
                const spots = [[-0.25, -0.05, 0.62], [0.28, 0.12, 0.55], [0.0, -0.22, 0.72]];
                for (let f = 0; f < spots.length; f++) {
                  const fm = getMesh("fr" + n.id + "_" + f, fspr, { shadow: false });
                  fm.userData.lift = base * spots[f][2];
                  place(fm, n.x + 0.5 + spots[f][0], n.y + 0.5 + spots[f][1], 1, 0.42, false, false, liftAt(n.x, n.y));
                }
              }
            }
          } else {
            // 4 real growth-stage sprites (Seedling/Growing/Mature/Ready to
            // Harvest); "Ready to Harvest" lands at p>=1. Defensive fallback to
            // the old single `crop.spr`/"sprout" if a stage sprite is missing.
            const stage = p < 0.25 ? 0 : p < 0.5 ? 1 : p < 1 ? 2 : 3;
            const staged = crop.sprStages && crop.sprStages[stage];
            key = (staged && SPR[staged]) ? staged : (p >= 1 ? crop.spr : "sprout");
            scale = [0.55, 0.7, 0.85, 1.0][stage];
          }
        } else if (n.tilled) {
          key = "tilled_soil"; flat = true; // hoed & ready for seed (untilled: bare earth)
        }
      } else {
        const nt = NODE_TYPES[n.type];
        if (n.alive) {
          if (n.type.startsWith("fishspot")) {
            key = RIPPLE_FRAMES[Math.floor(now / 420) % 4]; flat = true;
            // every ~15s the spot's own fish rises slowly out of the water and
            // sinks back — a separate billboard above the ripple
            const fishSpr = nt && ITEMS[nt.item] && ITEMS[nt.item].icon;
            if (fishSpr && SPR[fishSpr]) {
              const PERIOD = 15000, WIN = 3000;
              const off = ((n.x * 6151 + n.y * 3079) >>> 0) % PERIOD;
              const ph = (now + off) % PERIOD;
              if (ph < WIN) {
                const rise = Math.sin((ph / WIN) * Math.PI); // 0 → 1 → 0
                const fm = getMesh("fj" + n.id, fishSpr, { shadow: false });
                fm.userData.lift = -0.15 + rise * 0.85;
                place(fm, n.x + 0.5, n.y + 0.5, 1, 0.55, false, false, liftAt(n.x, n.y));
              }
            }
          }
          else { key = n.sprv || nt.spr; if (nt.skill === "Woodcutting") scale = 2.0; }
        } else if (nt.deadSpr && nt.deadSpr !== "stump" && nt.deadSpr !== "rock_dead") key = nt.deadSpr;
        // chopped trees ("stump") and mined rocks ("rock_dead") render nothing —
        // the node just vanishes until it respawns (no stumps / empty rocks left behind)
      }
      const existing = meshes.get(id);
      if (!key) { if (existing) { existing.visible = false; existing.userData.seen = true; if (existing.userData.shadow) existing.userData.shadow.visible = false; } continue; }
      // directional object billboard (trees, ore rocks, crafting stations) if one
      // maps to this sprite; falls back to the flat atlas sprite otherwise.
      const ov = flat ? null : objForKey(key);
      const ly = liftAt(n.x, n.y);
      if (ov) {
        const om = getObjMesh(id, ov.idx);
        if (om) { place(om, n.x + 0.5, n.y + 0.5, 1, ov.scale * treeMul, false, false, ly); continue; }
      }
      const m = getMesh(id, key, flat ? {} : { shadow: true });
      place(m, n.x + 0.5, n.y + 0.5, 1, scale, false, flat, ly);
    }
  }

  // Player-placed furniture & vessels (gameplay/placing.js): rendered as the
  // same 8-directional objects the world uses. The vessel being RIDDEN glides
  // at the player's interpolated position instead of its stored tile.
  function syncPlaced() {
    if (typeof placed === "undefined" || !placed.length) return;
    const rid = typeof ridingEnt === "function" ? ridingEnt() : null;
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      const _vr = viewRadius();
      if (Math.abs(p.x - player.x) > _vr || Math.abs(p.y - player.y) > _vr) continue;
      const d = ITEMS[p.id];
      const ov = d && d.place && objForKey(d.place);
      if (!ov) continue;
      const lv = p.level | 0;
      if (!levelVisible(p.x, p.y, lv)) continue;   // upstairs furniture hidden from other floors
      const riddenNow = p === rid;
      // vessels have a HEADING: show the 8-dir frame for it (live player.dir8
      // while ridden, the stored p.dir when parked) rotated by the orbiting
      // camera — the same (wi - camDir) convention the sailing hull uses.
      // Furniture keeps the default camera-facing south frame.
      let ff, wi = 0;
      if (d.ride) {
        wi = riddenNow ? Math.max(0, DIR8.indexOf(player.dir8 || "south")) : (p.dir | 0);
        ff = (wi - camDir + 8) & 7;
      }
      const om = getObjMesh("pl" + i, ov.idx, ff);
      if (!om) continue;
      // the shadow shows the side the SUN sees of the headed hull
      if (ff != null) om.userData.shadowGeom = objGeomFor(ov.idx * 8 + ((wi - sunState.oct + 8) & 7));
      const rx = riddenNow ? player.px / (TILE * SCALE) + 0.5 : p.x + 0.5;
      const ry = riddenNow ? player.py / (TILE * SCALE) + 0.5 : p.y + 0.5;
      // hulls sit IN the water with a little draft, not perched on it
      place(om, rx, ry, 1, ov.scale, false, false,
        liftAt(p.x, p.y) + lv * STOREY_H - (d.ride ? 0.15 : 0));
    }
  }

  // Dynamic 8-directional decor billboards (flowers, bushes, boulders, furniture,
  // camp/village props) diverted from the baked static chunk mesh in buildChunkMesh.
  // Culled to a radius around the player; sweep() removes ones that fall out of range.
  function syncDecor() {
    const _vr = viewRadius();
    const px = player.x + 0.5, py = player.y + 0.5, R2 = _vr * _vr;
    // in a bioluminescent biome (mushroom/dream forest), nothing lights the biome
    // as a whole — instead each decoration (mushroom/tree/rock) glows on its own.
    _bioLights.length = 0;
    const pBio = (typeof bioBiomeGlow === "function" && world.biomeNameAt)
      ? bioBiomeGlow(world.biomeNameAt(player.x, player.y)) : null;
    // FIX E: only visit the chunks whose tiles can hold a decor item inside the
    // view radius, instead of walking EVERY loaded chunk and distance-culling.
    // The chunk box is exactly the bounding box of the per-item cull circle (an
    // item draws iff (o.wx-px)^2+(o.wz-py)^2<=R2, so o.wx∈[px-_vr,px+_vr] → its
    // chunk index is in the floored range), i.e. a superset of every chunk that
    // draws decor — identical output, far fewer empty chunks touched. The
    // per-item cull below is unchanged.
    const _CS = world.CHUNK;
    const _cx0 = Math.floor((px - _vr) / _CS), _cx1 = Math.floor((px + _vr) / _CS);
    const _cy0 = Math.floor((py - _vr) / _CS), _cy1 = Math.floor((py + _vr) / _CS);
    for (let _cy = _cy0; _cy <= _cy1; _cy++)
      for (let _cx = _cx0; _cx <= _cx1; _cx++) {
      const group = chunkMeshes.get(_cx + "," + _cy);
      if (!group) continue;
      const list = group.userData.decorObjs;
      if (!list) continue;
      for (const o of list) {
        const dx = o.wx - px, dy = o.wz - py;
        if (dx * dx + dy * dy > R2) continue;
        if (pBio) {
          // cache each decor's biome glow once (static per position)
          if (o._bio === undefined) o._bio = bioBiomeGlow(world.biomeNameAt(Math.round(o.wx - 0.5), Math.round(o.wz - 0.5))) || null;
          if (o._bio) _bioLights.push({ wx: o.wx, wz: o.wz, col: o._bio });
        }
        // picked-up decorations are hidden (mesh left unplaced → sweep() removes
        // it) until they respawn; prune the entry once its timer has elapsed
        if (typeof pickedDecor !== "undefined" && pickedDecor.size) {
          const pk = (o.wx - 0.5) + "," + (o.wz - 0.5);
          const until = pickedDecor.get(pk);
          if (until != null) { if (now < until) continue; pickedDecor.delete(pk); }
        }
        // decor pins the south sprite — except fences/gates, which rotate
        // with the camera: screen facing = (fdir - camDir) like monsters/
        // hulls, then fr re-anchors it onto the mis-rotated sheet (fr is
        // the cell holding the true south view — see buildChunkMesh).
        const ff = o.fr !== undefined
          ? (o.fr + (((o.fdir || 0) - camDir + 8) & 7)) & 7
          : 0;
        const om = getObjMesh(o._mid || (o._mid = "dc" + o.wx + "_" + o.wz), o.idx, ff);   // FIX F: id built once
        if (om) place(om, o.wx, o.wz, 1, o.scale, false, false, liftAt(o.wx, o.wz));
      }
    }
    // upper-storey furniture (built per structure): hidden together with its
    // storey while the player is inside on a lower floor
    const lv = player.level | 0;
    for (const rec of structs.values()) {
      const list = rec.upperDecor;
      if (!list || !list.length) continue;
      // FIX E: skip a whole building whose upper furniture is entirely beyond the
      // cull radius. The bounding box is derived from the items THEMSELVES (cached
      // once — upperDecor is static), so the nearest-point test is an exact
      // superset: if the box's closest point is past R2, every item is too and
      // all would be culled anyway. Never skips a building the player is inside
      // (that box is within one building's span of the player, well under _vr).
      if (rec._udBox === undefined) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const o of list) {
          if (o.wx < x0) x0 = o.wx; if (o.wx > x1) x1 = o.wx;
          if (o.wz < z0) z0 = o.wz; if (o.wz > z1) z1 = o.wz;
        }
        rec._udBox = { x0, z0, x1, z1 };
      }
      const bb = rec._udBox;
      const nx = px < bb.x0 ? bb.x0 : px > bb.x1 ? bb.x1 : px;
      const nz = py < bb.z0 ? bb.z0 : py > bb.z1 ? bb.z1 : py;
      const bdx = nx - px, bdz = nz - py;
      if (bdx * bdx + bdz * bdz > R2) continue;
      const inside = rec.vols && rec.vols.some(vv =>
        player.x >= vv.x0 && player.x < vv.x1 && player.y >= vv.z0 && player.y < vv.z1);
      for (const o of list) {
        if (inside && o.s > lv) continue;
        const dx = o.wx - px, dy = o.wz - py;
        if (dx * dx + dy * dy > R2) continue;
        const om = getObjMesh(o._mid || (o._mid = "ud" + o.wx + "_" + o.wz + "_" + o.s), o.idx, 0); // FIX F: id once; south sprite only
        if (om) place(om, o.wx, o.wz, 1, o.scale, false, false, o.y);
      }
    }
  }

  // ---------- structural geometry (buildings, roofs, doors, city walls) ----
  // Real, tile-edge-aligned 3D architecture, built once per building/village
  // record and cached. Walls are 1-tile-thick boxes over the blocked perimeter
  // tiles, so what you see is exactly what collides; corners are where two
  // wall boxes meet flush. Roofs are hip roofs from a distance-field height
  // grid; towers get battlements, spires a steep pyramid, lighthouses taper to
  // a glowing lamp room. Doors/gates are hinged leaves eased open per frame.
  const structs = new Map();          // "bx0,y0" / "vx,y" -> built structure rec
  const badStructs = new Set();       // build threw once — skip, don't retry every frame
  const structMeta = new WeakMap();   // cache buildingMeta per building record
  function metaOf(b) {
    let m = structMeta.get(b);
    if (!m) { m = world.buildingMeta(b); structMeta.set(b, m); }
    return m;
  }
  const flatMats = {};
  function matFlat(color) {
    if (!flatMats[color]) {
      flatMats[color] = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, vertexColors: true });
      snowPatchUp(flatMats[color], true);   // roofs / up-facing structure faces frost
    }
    return flatMats[color];
  }
  let matLightRed = null, matLightWhite = null;
  function lighthouseMats() {
    if (!matLightRed) {
      matLightRed = sharedMat.clone(); matLightRed.color.set(0xd96a55); matLightRed.vertexColors = true;
      matLightWhite = sharedMat.clone(); matLightWhite.color.set(0xf2ece0); matLightWhite.vertexColors = true;
      snowPatchUp(matLightRed, true); snowPatchUp(matLightWhite, true);   // clones drop onBeforeCompile
    }
  }
  // building door leaves: the door texture multiplied toward blue, so every
  // doorway reads at a glance (user req 2026-09-30: doorways tinted blue)
  let _matDoorBlue = null;
  function matDoorBlue() {
    if (!_matDoorBlue) {
      _matDoorBlue = sharedMat.clone();
      _matDoorBlue.color.set(0x8fc2ff);
      _matDoorBlue.vertexColors = true;
      snowPatchUp(_matDoorBlue, true);
    }
    return _matDoorBlue;
  }
  // city walls in weathered grey (the raw wall_stone sprite reads too white
  // across a whole fortification)
  let _matCityWall = null;
  function matCityWall() {
    if (!_matCityWall) { _matCityWall = sharedMat.clone(); _matCityWall.color.set(0xb4bac2); _matCityWall.vertexColors = true; snowPatchUp(_matCityWall, true); }
    return _matCityWall;
  }
  // plain solid-color material for standard three.js geometries (telescope
  // parts) — those have no vertex-color attribute, so matFlat won't render them
  const plainMats = {};
  function matPlain(color) {
    if (!plainMats[color]) {
      plainMats[color] = new THREE.MeshBasicMaterial({ color });
      snowPatchUp(plainMats[color], true);
    }
    return plainMats[color];
  }

  // ---- west-pointing soft shadows ----
  // Every object casts a shadow toward the west (sun in the east) so nothing
  // reads as floating. Structures and baked decor use quads with this shared
  // linear-gradient texture (dark at the east base, fading to the west tip);
  // billboard entities reuse their blob shadow, offset west and stretched.
  let shadowDirMat = null;
  function shadowMatDir() {
    if (shadowDirMat) return shadowDirMat;
    const cv = document.createElement("canvas");
    cv.width = 64; cv.height = 32;
    const c2 = cv.getContext("2d");
    const id = c2.createImageData(64, 32);
    // solid dark body (matching the 0.5-alpha sprite silhouettes) with a soft
    // fade over the westmost third and soft north/south edges
    for (let py = 0; py < 32; py++)
      for (let px = 0; px < 64; px++) {
        const u = px / 63, v = Math.abs(py - 15.5) / 16;
        const a = Math.pow(Math.min(1, u * 2.6), 0.9) * Math.pow(Math.max(0, 1 - v * v * v), 0.8) * 0.5;
        id.data[(py * 64 + px) * 4 + 3] = Math.round(a * 255);
      }
    c2.putImageData(id, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    shadowDirMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: 0x000000 });
    return shadowDirMat;
  }
  function newSH() { return { pos: [], uv: [], idx: [], n: 0 }; }
  function shMesh(sh, rec, parent) {
    if (!sh.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(sh.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(sh.uv, 2));
    g.setIndex(sh.idx);
    const m = new THREE.Mesh(g, shadowMatDir());
    m.matrixAutoUpdate = false;
    if (rec) rec.geoms.push(g);
    parent.add(m);
    return m;
  }
  // gradient block shadow: a footprint rect [x0,z0]-[x1,z1] stretched by `len`
  // along the sun ground direction (sdx,sdz), tessellated per tile so it drapes
  // over terrain steps. u fades 1→0 from the object base to the far tip; v is a
  // soft edge across the strip width. yOf(tx,tz)->y.
  function bakeBlockShadow(sh, x0, z0, x1, z1, len, sdx, sdz, yOf) {
    let rx0 = x0, rz0 = z0, rx1 = x1, rz1 = z1;
    if (sdx < 0) rx0 = x0 - len; else if (sdx > 0) rx1 = x1 + len;
    if (sdz < 0) rz0 = z0 - len; else if (sdz > 0) rz1 = z1 + len;
    const uAt = (x, z) => {
      let d = 1;
      if (sdx < 0) d = (x - (x0 - len)) / len;
      else if (sdx > 0) d = ((x1 + len) - x) / len;
      else if (sdz < 0) d = (z - (z0 - len)) / len;
      else if (sdz > 0) d = ((z1 + len) - z) / len;
      return Math.max(0, Math.min(1, d));
    };
    const vAt = (x, z) => sdx ? (z - rz0) / (rz1 - rz0) : (x - rx0) / (rx1 - rx0);
    for (let tz = Math.floor(rz0); tz < rz1; tz++)
      for (let tx = Math.floor(rx0); tx < rx1; tx++) {
        const ax = Math.max(tx, rx0), az = Math.max(tz, rz0);
        const bx = Math.min(tx + 1, rx1), bz = Math.min(tz + 1, rz1);
        const y = yOf(tx, tz);
        sh.pos.push(ax, y, az, bx, y, az, bx, y, bz, ax, y, bz);
        sh.uv.push(uAt(ax, az), vAt(ax, az), uAt(bx, az), vAt(bx, az),
                   uAt(bx, bz), vAt(bx, bz), uAt(ax, bz), vAt(ax, bz));
        sh.idx.push(sh.n, sh.n + 1, sh.n + 2, sh.n, sh.n + 2, sh.n + 3);
        sh.n += 4;
      }
  }
  // textured silhouette shadow: the sprite `key` laid flat from foot (cx,cz)
  // out along the sun direction by `len` (half-width `hw`), tessellated so it
  // drapes over terrain steps. yOf(tx,tz)->y (world or group-relative).
  function bakeSil(sb, key, cx, cz, len, hw, sdx, sdz, yOf) {
    const px = sdz * hw, pz = -sdx * hw; // perpendicular half-width
    const steps = Math.max(1, Math.ceil(len));
    for (let i = 0; i < steps; i++) {
      const d0 = i / steps * len, d1 = (i + 1) / steps * len;
      const v0 = d0 / len, v1 = d1 / len;
      const fx0 = cx + sdx * d0, fz0 = cz + sdz * d0;
      const fx1 = cx + sdx * d1, fz1 = cz + sdz * d1;
      const y0 = yOf(Math.floor(fx0 + sdx * 0.02), Math.floor(fz0 + sdz * 0.02));
      const y1 = yOf(Math.floor(fx1 - sdx * 0.02), Math.floor(fz1 - sdz * 0.02));
      sbQuadUV(sb, key,
        [fx0 - px, y0, fz0 - pz], [fx0 + px, y0, fz0 + pz],
        [fx1 + px, y1, fz1 + pz], [fx1 - px, y1, fz1 - pz],
        [0, v0], [1, v0], [1, v1], [0, v1]);
    }
  }

  // small geometry accumulators: textured quads/tris share the atlas material,
  // flat ones a per-color unlit material; both are double-sided so winding is
  // irrelevant. Every vertex carries a grey "shade" (vertex color) so faces get
  // baked directional lighting — south faces bright, north dark, roofs sunlit.
  const SH_S = 1.0, SH_N = 0.6, SH_W = 0.72, SH_E = 0.86, SH_TOP = 0.93, SH_IN = 0.78;
  function newSB() { return { pos: [], uv: [], col: [], idx: [], n: 0 }; }
  function sbUV(key) {
    const cell = atlas.cells[key] || atlas.cells.wall_stone;
    const W = atlas.canvas.width, H = atlas.canvas.height;
    return [(cell.cx + 0.5) / W, 1 - (cell.cy + CSZ - 0.5) / H, (cell.cx + CSZ - 0.5) / W, 1 - (cell.cy + 0.5) / H];
  }
  // a,b,c,d = corner [x,y,z] in bottom-left, bottom-right, top-right, top-left
  // order (for vertical faces) or any planar winding (uv follows that order)
  function sbQuad(sb, key, a, b, c, d, shade = 1) {
    const [u0, v0, u1, v1] = sbUV(key);
    sb.pos.push(...a, ...b, ...c, ...d);
    sb.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    for (let i = 0; i < 4; i++) sb.col.push(shade, shade, shade);
    sb.idx.push(sb.n, sb.n + 1, sb.n + 2, sb.n, sb.n + 2, sb.n + 3);
    sb.n += 4;
  }
  // quad with per-corner uv given as fractions of the sprite's cell
  function sbQuadUV(sb, key, a, b, c, d, ua, ub, uc, ud, shade = 1) {
    const [u0, v0, u1, v1] = sbUV(key);
    const L = p => [u0 + (u1 - u0) * p[0], v0 + (v1 - v0) * p[1]];
    sb.pos.push(...a, ...b, ...c, ...d);
    sb.uv.push(...L(ua), ...L(ub), ...L(uc), ...L(ud));
    for (let i = 0; i < 4; i++) sb.col.push(shade, shade, shade);
    sb.idx.push(sb.n, sb.n + 1, sb.n + 2, sb.n, sb.n + 2, sb.n + 3);
    sb.n += 4;
  }
  function sbTri(sb, key, a, b, c, ua, ub, uc, shade = 1) {
    const [u0, v0, u1, v1] = sbUV(key);
    const lerp = (p) => [u0 + (u1 - u0) * p[0], v0 + (v1 - v0) * p[1]];
    sb.pos.push(...a, ...b, ...c);
    sb.uv.push(...lerp(ua), ...lerp(ub), ...lerp(uc));
    for (let i = 0; i < 3; i++) sb.col.push(shade, shade, shade);
    sb.idx.push(sb.n, sb.n + 1, sb.n + 2);
    sb.n += 3;
  }
  // shade for a sloped (roof) triangle from its upward normal and a SE sun
  function sunShade(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    return Math.min(1, Math.max(0.55, 0.6 + 0.4 * (nx * 0.26 + ny * 0.7 + nz * 0.56)));
  }
  let _texMatV = null;
  function texMatV() {
    // Material.clone() does NOT carry onBeforeCompile — re-apply the snow
    // patch or roofs/wall-tops (all structural atlas geometry) never frost
    if (!_texMatV) { _texMatV = sharedMat.clone(); _texMatV.vertexColors = true; snowPatchUp(_texMatV, true); }
    return _texMatV;
  }
  function sbMesh(sb, mat, rec, parent) {
    if (!sb.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(sb.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(sb.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(sb.col, 3));
    g.setIndex(sb.idx);
    const m = new THREE.Mesh(g, mat === sharedMat ? texMatV() : mat);
    m.matrixAutoUpdate = false;
    rec.geoms.push(g);
    parent.add(m);
    return m;
  }
  // vertical wall face from (ax,az) to (bx,bz), split into ~1-tile columns and
  // ~0.9-unit texture rows so the art tiles instead of stretching
  function sbWallFace(sb, key, ax, az, bx, bz, yB, yT, shade = 1) {
    const len = Math.hypot(bx - ax, bz - az);
    const nSeg = Math.max(1, Math.round(len));
    const nRow = Math.max(1, Math.round((yT - yB) / 0.9));
    for (let i = 0; i < nSeg; i++) {
      const t0 = i / nSeg, t1 = (i + 1) / nSeg;
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0;
      const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      for (let r = 0; r < nRow; r++) {
        const y0 = yB + (yT - yB) * r / nRow, y1 = yB + (yT - yB) * (r + 1) / nRow;
        sbQuad(sb, key, [x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], shade);
      }
    }
  }
  // horizontal quad (tops, slabs) over a rect; per-tile texture cells
  function sbFloor(sb, key, x0, z0, x1, z1, y, shade = SH_TOP) {
    for (let z = Math.floor(z0); z < z1; z++)
      for (let x = Math.floor(x0); x < x1; x++) {
        const ax = Math.max(x, x0), az = Math.max(z, z0);
        const bx2 = Math.min(x + 1, x1), bz2 = Math.min(z + 1, z1);
        sbQuad(sb, key, [ax, y, az], [bx2, y, az], [bx2, y, bz2], [ax, y, bz2], shade);
      }
  }
  // one horizontal flat-colored quad (no texture detail needed)
  function sbFlatRect(sb, x0, z0, x1, z1, y, shade = SH_TOP) {
    sbQuad(sb, "wall_stone", [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], shade);
  }
  // plank floor: long boards with alternating tones (no plank tile exists in
  // the sheets — the flat floor_wood tile reads as solid orange)
  function sbPlanks(sb, x0, z0, x1, z1, y) {
    for (let z = z0, k = 0; z < z1 - 1e-6; z += 0.45, k++) {
      const z2 = Math.min(z + 0.45, z1);
      sbQuad(sb, "wall_stone", [x0, y, z], [x1, y, z], [x1, y, z2], [x0, y, z2], [1.0, 0.84, 0.93][k % 3]);
    }
  }
  // small solid block (merlons, posts): 4 sides + top, direction-shaded
  function sbBlock(sb, x0, y0, z0, x1, y1, z1) {
    const k = "wall_stone";
    sbQuad(sb, k, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], SH_N);
    sbQuad(sb, k, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], SH_S);
    sbQuad(sb, k, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], SH_W);
    sbQuad(sb, k, [x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], SH_E);
    sbQuad(sb, k, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], SH_TOP);
  }
  // battlement merlons along the outer edge from (ax,az) to (bx,bz)
  function sbMerlons(sb, ax, az, bx, bz, y, inward) {
    const len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const n = Math.max(2, Math.floor(len / 0.62));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * (len / n);
      const cx2 = ax + dx * t, cz2 = az + dz * t;
      sbBlock(sb,
        cx2 - Math.abs(dx) * 0.15 - Math.abs(dz) * (inward ? 0.26 : 0), y,
        cz2 - Math.abs(dz) * 0.15 - Math.abs(dx) * (inward ? 0.26 : 0),
        cx2 + Math.abs(dx) * 0.15 + Math.abs(dz) * (inward ? 0 : 0.26), y + 0.42,
        cz2 + Math.abs(dz) * 0.15 + Math.abs(dx) * (inward ? 0 : 0.26));
    }
  }
  // hinged swinging leaf (door / gate). Returns the animation record.
  // (hx,hz)=hinge, (dx,dz)=unit direction the closed leaf extends along,
  // (owx,owz)=outward normal it swings toward when opening.
  function makeLeaf(rec, parent, key, hx, hy, hz, dx, dz, owx, owz, leafH, doorKey2) {
    const grp = new THREE.Group();
    grp.position.set(hx, hy, hz);
    const baseYaw = Math.atan2(-dz, dx);
    // rotating local +x by yaw t gives (cos t, 0, -sin t): pick the 90° swing
    // whose result points outward
    const dot = s => {
      const t = baseYaw + s * Math.PI / 2;
      return Math.cos(t) * owx - Math.sin(t) * owz;
    };
    const sign = dot(1) > dot(-1) ? 1 : -1;
    // building doors get a blue-tinted leaf so doorways pop against masonry;
    // city gates (village recs, rec.v) keep the plain castle ironwork
    const leaf = new THREE.Mesh(geomFor(key), rec.b ? matDoorBlue() : sharedMat);
    leaf.position.set(0.49, leafH / 2, 0);
    leaf.scale.set(0.97, leafH, 1);
    grp.add(leaf);
    grp.rotation.y = baseYaw;
    parent.add(grp);
    const d = { grp, baseYaw, sign, cur: 0, key: doorKey2 };
    rec.doors.push(d);
    return d;
  }

  // hip roof over [rx0..rx1]x[rz0..rz1] with a 1-tile eave overhang; corner
  // heights follow the capped distance-to-edge field, which produces authentic
  // hips, ridges and (on big footprints) a flat plateau. Shared by building
  // halls and mansion wings.
  function buildHipRoof(rec, parent, rx0, rz0, rx1, rz1, base, roofKey, spire) {
    const RISE = spire ? 1.15 : 0.62;
    const CAPD = spire ? 99 : Math.min(3, Math.max(1, Math.floor(Math.min(rx1 - rx0, rz1 - rz0) / 2)));
    const ex0 = rx0 - 1, ex1 = rx1 + 1, ez0 = rz0 - 1, ez1 = rz1 + 1;
    const chn = (cx2, cz2) => base - 0.38 +
      Math.min(cx2 - ex0, ex1 - cx2, cz2 - ez0, ez1 - cz2, CAPD) * RISE;
    const rb = newSB();
    for (let tz = ez0; tz < ez1; tz++)
      for (let tx = ex0; tx < ex1; tx++) {
        const h00 = chn(tx, tz), h10 = chn(tx + 1, tz), h11 = chn(tx + 1, tz + 1), h01 = chn(tx, tz + 1);
        const p00 = [tx, h00, tz], p10 = [tx + 1, h10, tz], p11 = [tx + 1, h11, tz + 1], p01 = [tx, h01, tz + 1];
        // split along the flatter diagonal so hip lines stay straight;
        // each slope gets sun-angle shading so the roof planes read as 3D
        if (Math.abs(h00 - h11) <= Math.abs(h10 - h01)) {
          sbTri(rb, roofKey, p00, p10, p11, [0, 0], [1, 0], [1, 1], sunShade(p00, p10, p11));
          sbTri(rb, roofKey, p00, p11, p01, [0, 0], [1, 1], [0, 1], sunShade(p00, p11, p01));
        } else {
          sbTri(rb, roofKey, p10, p11, p01, [1, 0], [1, 1], [0, 1], sunShade(p10, p11, p01));
          sbTri(rb, roofKey, p10, p01, p00, [1, 0], [0, 1], [0, 0], sunShade(p10, p01, p00));
        }
      }
    sbMesh(rb, sharedMat, rec, parent);
  }

  // --- organic multi-room building structure (citygrow.js records) ---
  // The record itself carries the plan: rooms (wall-inclusive rects sharing
  // 1-tile wall lines), one/two exterior doors, interior archways, ladder(s).
  // Walls are per-tile boxes over the plan's wall tiles (faces between two
  // adjacent wall tiles are skipped), so party walls between rooms and
  // between row-house neighbours emit once and collide exactly as stamped.
  // Also used by the Great Labyrinth (labgen.js): many cell-rooms, several
  // ladders, an entrance and an exit door.
  function buildOrganicStruct(b) {
    const m = metaOf(b);
    const rooms = m.rooms, storeys = m.storeys, stone = m.stone;
    const frontKey = stone ? "wall_stone" : "wall_wood";
    const sideKey = stone ? "wall_stone_side" : "wall_wood_side";
    const floorKey = stone ? "floor_interior" : "floor_wood";
    const topCol = stone ? 0x767a82 : 0x63482e;
    const group = new THREE.Group();
    const rec = { group, geoms: [], storeyGroups: [], slabs: [], roofGroup: null, doors: [], b, m,
      cx: b.x0 + b.w / 2, cz: b.y0 + b.h / 2 };

    // ---- the plan on a local tile grid over the bbox ----
    const W = b.w, H = b.h, ox = b.x0, oz = b.y0;
    const gi = (x, z) => (z - oz) * W + (x - ox);
    const inBB = (x, z) => x >= ox && z >= oz && x < ox + W && z < oz + H;
    const wallS = new Int8Array(W * H); // storeys of wall standing on tile
    const intS = new Int8Array(W * H);  // storeys of the room interior here
    for (const r of rooms)
      for (let z = r.y; z < r.y + r.h; z++)
        for (let x = r.x; x < r.x + r.w; x++) {
          const edge = x === r.x || x === r.x + r.w - 1 || z === r.y || z === r.y + r.h - 1;
          const k = gi(x, z);
          if (edge) wallS[k] = Math.max(wallS[k], r.s || 1);
          else intS[k] = r.s || 1;
        }
    const isWallTile = (x, z) => inBB(x, z) && wallS[gi(x, z)] > 0;
    const inBld = (x, z) => inBB(x, z) && (wallS[gi(x, z)] > 0 || intS[gi(x, z)] > 0);
    // party walls shared with NEIGHBOURING buildings: exactly ONE building may
    // emit the geometry for a shared wall tile — the one standing TALLEST
    // there (ties: smaller y0, then x0 wins) — otherwise two coplanar boxes
    // with different materials (stone vs wood row-houses) z-fight and shimmer
    const skipShared = new Set();
    // this building's own wall tiles that ALSO back a neighbour's wall (party
    // walls). They NEVER collapse to kerbs while the player is inside — the
    // boundary with a connected building always reads as a solid wall from
    // indoors (you see the neighbour's wall), and from outside the taller
    // owner's full wall shows via skipShared. Only a building's EXTERIOR
    // (non-party) walls drop away for the interior view.
    const partyTile = new Set();
    {
      const theirH = new Map(); // gi -> tallest neighbour wall height there
      const theirWin = new Map(); // gi -> that neighbour wins ties
      const list = (world.buildingsNearLoaded || world.buildingsNear)(
        b.x0 + (b.w >> 1), b.y0 + (b.h >> 1), Math.max(b.w, b.h) + 30);
      for (const ob of list) {
        if (ob === b || !ob.rooms) continue;
        if (ob.x0 + ob.w < b.x0 || b.x0 + b.w < ob.x0 ||
            ob.y0 + ob.h < b.y0 || b.y0 + b.h < ob.y0) continue;
        const tieWin = ob.y0 < b.y0 || (ob.y0 === b.y0 && ob.x0 < b.x0);
        for (const orr of ob.rooms)
          for (let z = orr.y; z < orr.y + orr.h; z++)
            for (let x = orr.x; x < orr.x + orr.w; x++) {
              const edge = x === orr.x || x === orr.x + orr.w - 1 || z === orr.y || z === orr.y + orr.h - 1;
              if (!edge || !inBB(x, z)) continue;
              const k = gi(x, z);
              if (!wallS[k]) continue;
              const h2 = orr.s || 1;
              if (h2 > (theirH.get(k) || 0)) { theirH.set(k, h2); theirWin.set(k, tieWin); }
            }
      }
      for (const [k, h2] of theirH) {
        partyTile.add(k); // a neighbour walls this tile too -> it's a party wall
        if (h2 > wallS[k] || (h2 === wallS[k] && theirWin.get(k))) skipShared.add(k);
      }
    }
    // openings: per-storey BITMASK of archway/door gaps through wall tiles
    // (a Great Labyrinth archway exists on exactly ONE floor — d.s)
    const openLv = new Map(); // gi -> storey bitmask
    const addOpen = (k, s) => openLv.set(k, (openLv.get(k) || 0) | (1 << s));
    const flankLv = (x, z) => {
      // an untagged interior archway spans every storey BOTH rooms share;
      // a door to the outside opens at ground level only
      const nzN = inBB(x, z - 1) ? intS[gi(x, z - 1)] : 0;
      const nzS = inBB(x, z + 1) ? intS[gi(x, z + 1)] : 0;
      const nxW = inBB(x - 1, z) ? intS[gi(x - 1, z)] : 0;
      const nxE = inBB(x + 1, z) ? intS[gi(x + 1, z)] : 0;
      if (nzN && nzS) return Math.min(nzN, nzS);
      if (nxW && nxE) return Math.min(nxW, nxE);
      return 1;
    };
    for (const d of (m.idoors || [])) if (inBB(d.x, d.y)) {
      const k = gi(d.x, d.y);
      if (d.s != null) addOpen(k, d.s);
      else for (let s = 0; s < flankLv(d.x, d.y); s++) addOpen(k, s);
    }
    const doorsArr = [m.door, m.door2].filter(Boolean);
    for (const d of doorsArr) if (inBB(d.x, d.y)) addOpen(gi(d.x, d.y), 0);

    // ---- plinth: one slab tile per plan tile + skirt on outside edges ----
    {
      const ft = newSB(), ff = newSB(), fp = newSB();
      for (let z = oz; z < oz + H; z++)
        for (let x = ox; x < ox + W; x++) {
          if (!inBld(x, z)) continue;
          if (stone) sbFloor(ft, floorKey, x, z, x + 1, z + 1, FLOOR_T);
          else sbPlanks(fp, x, z, x + 1, z + 1, FLOOR_T);
          if (!inBld(x, z - 1)) sbWallFace(ff, frontKey, x, z, x + 1, z, 0, FLOOR_T, SH_N);
          if (!inBld(x, z + 1)) sbWallFace(ff, frontKey, x, z + 1, x + 1, z + 1, 0, FLOOR_T, SH_S);
          if (!inBld(x - 1, z)) sbWallFace(ff, frontKey, x, z, x, z + 1, 0, FLOOR_T, SH_W);
          if (!inBld(x + 1, z)) sbWallFace(ff, frontKey, x + 1, z, x + 1, z + 1, 0, FLOOR_T, SH_E);
        }
      // doorstep outside each exterior door (half-tile pad past the wall)
      for (const d of doorsArr) {
        const step = d.angle === 3 ? [d.x + 0.08, d.y + 1, d.x + 0.92, d.y + 1.5]
          : d.angle === 1 ? [d.x + 0.08, d.y - 0.5, d.x + 0.92, d.y]
          : d.angle === 0 ? [d.x - 0.5, d.y + 0.08, d.x, d.y + 0.92]
          : [d.x + 1, d.y + 0.08, d.x + 1.5, d.y + 0.92];
        sbQuad(ft, floorKey, [step[0], 0.03, step[1]], [step[2], 0.03, step[1]],
          [step[2], 0.03, step[3]], [step[0], 0.03, step[3]]);
      }
      sbMesh(ft, sharedMat, rec, group);
      if (!stone) sbMesh(fp, matFlat(0x9a6b3a), rec, group);
      sbMesh(ff, matFlat(0x5c5f66), rec, group);
    }

    const ladders = m.ladders || (m.ladder ? [m.ladder] : []);

    // ---- wall storeys: per-tile boxes with door/arch openings ----
    for (let s = 0; s < storeys; s++) {
      const yB = s === 0 ? FLOOR_T : s * STOREY_H, yT = (s + 1) * STOREY_H;
      const sg = { group: new THREE.Group(), sides: {}, wallMeshes: [], flat: new THREE.Group() };
      sg.flat.visible = false;
      sg.group.add(sg.flat);
      for (const sd of ["n", "s", "e", "w"]) { sg.sides[sd] = new THREE.Group(); sg.group.add(sg.sides[sd]); }
      const sb = newSB(), fb = newSB(), ob = newSB();
      // party-wall geometry (walls shared with a connected neighbour) goes to
      // its own buffers: it is NOT added to wallMeshes, so it stays full height
      // for the interior view instead of collapsing to a kerb.
      const sbP = newSB(), fbP = newSB();
      const act = (x, z) => isWallTile(x, z) && wallS[gi(x, z)] > s;
      for (let z = oz; z < oz + H; z++)
        for (let x = ox; x < ox + W; x++) {
          if (!act(x, z)) continue;
          const k = gi(x, z);
          if (skipShared.has(k)) continue; // a taller neighbour draws this party wall
          const party = partyTile.has(k);  // a party wall this building owns
          const wb = party ? sbP : sb, tb = party ? fbP : fb;
          const open = !!((openLv.get(k) || 0) >> s & 1);
          // neighbour context: skip faces shared with another active wall tile
          const aN = act(x, z - 1), aS = act(x, z + 1), aW = act(x - 1, z), aE = act(x + 1, z);
          const shN = inBld(x, z - 1) ? SH_IN : SH_N, shS = inBld(x, z + 1) ? SH_IN : SH_S;
          const shW = inBld(x - 1, z) ? SH_IN : SH_W, shE = inBld(x + 1, z) ? SH_IN : SH_E;
          const yLo = open ? yB + DOOR_H : yB; // opening: only the lintel band
          if (yLo < yT) {
            if (!aN) sbWallFace(wb, frontKey, x, z, x + 1, z, yLo, yT, shN);
            if (!aS) sbWallFace(wb, frontKey, x, z + 1, x + 1, z + 1, yLo, yT, shS);
            if (!aW) sbWallFace(wb, sideKey, x, z, x, z + 1, yLo, yT, shW);
            if (!aE) sbWallFace(wb, sideKey, x + 1, z, x + 1, z + 1, yLo, yT, shE);
          }
          if (open) {
            // passage jambs + lintel underside. The walk-through axis is the
            // one whose BOTH flanking tiles are open floor (not wall): a door
            // in a south wall is walked N-S, so its jambs are the x-planes
            const zPass = !isWallTile(x, z - 1) && !isWallTile(x, z + 1);
            if (zPass) {
              sbQuad(wb, sideKey, [x, yB, z], [x, yB, z + 1], [x, yB + DOOR_H, z + 1], [x, yB + DOOR_H, z], SH_IN);
              sbQuad(wb, sideKey, [x + 1, yB, z], [x + 1, yB, z + 1], [x + 1, yB + DOOR_H, z + 1], [x + 1, yB + DOOR_H, z], SH_IN);
            } else {
              sbQuad(wb, frontKey, [x, yB, z], [x + 1, yB, z], [x + 1, yB + DOOR_H, z], [x, yB + DOOR_H, z], SH_IN);
              sbQuad(wb, frontKey, [x, yB, z + 1], [x + 1, yB, z + 1], [x + 1, yB + DOOR_H, z + 1], [x, yB + DOOR_H, z + 1], SH_IN);
            }
            sbQuad(tb, frontKey, [x, yB + DOOR_H, z], [x + 1, yB + DOOR_H, z], [x + 1, yB + DOOR_H, z + 1], [x, yB + DOOR_H, z + 1], 0.5);
          }
          // wall top cap on this wall's final storey
          if (wallS[k] === s + 1) sbQuad(tb, frontKey, [x, yT, z], [x + 1, yT, z], [x + 1, yT, z + 1], [x, yT, z + 1], SH_TOP);
          // collapsed stand-in kerb (jamb posts flank openings) — only for
          // EXTERIOR walls; party walls stay full height so they get no kerb
          if (party) { /* party walls never collapse — no kerb */ }
          else if (!open) sbBlock(ob, x, yB + 0.01, z, x + 1, yB + 0.08, z + 1);
          else if (!isWallTile(x, z - 1) && !isWallTile(x, z + 1)) {
            // walked N-S: jamb posts on the west/east edges of the gap
            sbBlock(ob, x - 0.05, yB + 0.01, z, x + 0.1, yB + DOOR_H, z + 1);
            sbBlock(ob, x + 0.9, yB + 0.01, z, x + 1.05, yB + DOOR_H, z + 1);
          } else {
            sbBlock(ob, x, yB + 0.01, z - 0.05, x + 1, yB + DOOR_H, z + 0.1);
            sbBlock(ob, x, yB + 0.01, z + 0.9, x + 1, yB + DOOR_H, z + 1.05);
          }
        }
      const m1 = sbMesh(sb, sharedMat, rec, sg.sides.s);
      const m2 = sbMesh(fb, matFlat(topCol), rec, sg.sides.s);
      if (m1) sg.wallMeshes.push(m1);
      if (m2) sg.wallMeshes.push(m2);
      // party walls: same materials, added to the storey group (so they hide
      // with upper storeys) but NOT to wallMeshes, so they never collapse to a
      // kerb when the player stands inside — the connected neighbour's wall
      // stays solid as the boundary.
      sbMesh(sbP, sharedMat, rec, sg.sides.s);
      sbMesh(fbP, matFlat(topCol), rec, sg.sides.s);
      sbMesh(ob, matFlat(topCol), rec, sg.flat);
      // ladder segments for every ladder climbing past this storey
      for (const ld of ladders) {
        const ldTop = ld.s != null ? ld.s + 1 : storeys - 1; // climbs INTO storey ldTop
        const ldFrom = ld.s != null ? ld.s : 0;
        if (s < ldFrom || s >= ldTop) continue;
        const lb = newSB();
        const lx = ld.x + 0.5, lz = ld.y + 0.28;
        const railTop = yT + 0.85, rungTop = yT + 0.55;
        for (const rx of [-0.26, 0.26])
          sbBlock(lb, lx + rx - 0.045, yB, lz - 0.045, lx + rx + 0.045, railTop, lz + 0.045);
        const nR = Math.max(4, Math.round((rungTop - yB) / 0.36));
        for (let r = 1; r <= nR; r++) {
          const ry = yB + (rungTop - yB) * r / (nR + 1);
          sbBlock(lb, lx - 0.26, ry - 0.04, lz - 0.03, lx + 0.26, ry + 0.04, lz + 0.03);
        }
        sbMesh(lb, matFlat(0x64a8f0), rec, sg.group); // blue-tinted rails: ladders must pop
      }
      rec.storeyGroups.push(sg);
      group.add(sg.group);
    }

    // ---- upper floor slabs: per room interior (interiors never overlap),
    // plus a plank lid over each archway tile that continues at that level
    for (let s = 1; s < storeys; s++) {
      const st = newSB(), su = newSB();
      let any = false;
      for (const r of rooms) {
        if ((r.s || 1) <= s) continue;
        any = true;
        sbPlanks(st, r.x + 1, r.y + 1, r.x + r.w - 1, r.y + r.h - 1, s * STOREY_H + 0.02);
        sbFlatRect(su, r.x + 1, r.y + 1, r.x + r.w - 1, r.y + r.h - 1, s * STOREY_H - 0.09);
      }
      for (const [k, mask] of openLv) if (mask >> s & 1) {
        const x = ox + (k % W), z = oz + ((k / W) | 0);
        sbPlanks(st, x, z, x + 1, z + 1, s * STOREY_H + 0.02);
      }
      const slabGrp = new THREE.Group();
      if (any) {
        sbMesh(st, matFlat(0x9a6b3a), rec, slabGrp);
        sbMesh(su, matFlat(0x3c352c), rec, slabGrp);
      }
      group.add(slabGrp);
      rec.slabs.push(slabGrp);
    }

    // ---- per-room hip roofs: the jumbled organic roofline ----
    const roofGroup = new THREE.Group();
    rec.roofGroup = roofGroup;
    group.add(roofGroup);
    const rk = atlas.cells[b.roof] ? b.roof : (stone ? "roof_gray" : "roof_brown");
    for (const r of rooms)
      buildHipRoof(rec, roofGroup, r.x, r.y, r.x + r.w, r.y + r.h, (r.s || 1) * STOREY_H, rk, false);

    // ---- interior volumes, shadows, door leaves ----
    rec.vols = rooms.map(r => ({ x0: r.x, z0: r.y, x1: r.x + r.w, z1: r.y + r.h }));
    rec.baseTier = bldTier(b);
    rec.shadowFeet = rooms.map(r => ({ x0: r.x, z0: r.y, x1: r.x + r.w, z1: r.y + r.h,
      len: (r.s || 1) * STOREY_H + 1.5 }));
    buildStructShadow(rec);
    const dKey = (stone && m.door.stone) ? "door_stone" : "door_wood";
    for (const d2 of doorsArr) {
      let leaf;
      if (d2.angle === 3)
        leaf = makeLeaf(rec, rec.storeyGroups[0].sides.s, dKey,
          d2.x, FLOOR_T, d2.y + 1 - 0.12, 1, 0, 0, 1, DOOR_H - 0.05, d2.x + "," + d2.y);
      else if (d2.angle === 1)
        leaf = makeLeaf(rec, rec.storeyGroups[0].sides.n, dKey,
          d2.x, FLOOR_T, d2.y + 0.12, 1, 0, 0, -1, DOOR_H - 0.05, d2.x + "," + d2.y);
      else if (d2.angle === 0)
        leaf = makeLeaf(rec, rec.storeyGroups[0].sides.w, dKey,
          d2.x + 0.12, FLOOR_T, d2.y, 0, 1, -1, 0, DOOR_H - 0.05, d2.x + "," + d2.y);
      else
        leaf = makeLeaf(rec, rec.storeyGroups[0].sides.e, dKey,
          d2.x + 1 - 0.12, FLOOR_T, d2.y, 0, 1, 1, 0, DOOR_H - 0.05, d2.x + "," + d2.y);
      leaf.side = ["w", "n", "e", "s"][d2.angle];
    }

    // ---- furniture: bedrooms upstairs (or the ground floor of a plain
    // one-storey house), laid out per ROOM so nothing lands on party walls
    rec.upperDecor = [];
    if (b.kind !== "greatlab") {
      const UP_STONE = ["bed_fourposter", "wardrobe", "bookshelf_small", "dresser_mirror", "candelabra", "desk", "chest_storage", "stool"];
      const UP_WOOD = ["bed_frame", "dresser", "chest_storage", "cupboard", "stool", "bookshelf_small", "bench_trestle", "bucket"];
      const HOUSE = stone ? ["bed_fourposter", "chest_storage", "dresser_mirror", "stool", "wardrobe"]
                          : ["bed_frame", "chest_storage", "dresser", "stool", "cupboard"];
      const isHouse = storeys === 1 && !b.job;
      const upList = isHouse ? HOUSE : stone ? UP_STONE : UP_WOOD;
      for (const r of rooms) {
        const sFrom = isHouse ? 0 : 1, sTo = isHouse ? 1 : (r.s || 1);
        for (let s = sFrom; s < sTo; s++) {
          const slots = [];
          const push3 = (tx2, tz2) => {
            if (tx2 <= r.x || tx2 >= r.x + r.w - 1 || tz2 <= r.y || tz2 >= r.y + r.h - 1) return;
            for (const ld of ladders)
              if (Math.abs(tx2 - ld.x) <= 1 && Math.abs(tz2 - ld.y) <= 1) return;
            // keep every doorway clear: exterior doors and archways alike
            for (const dt of doorsArr)
              if (Math.abs(tx2 - dt.x) <= 1 && Math.abs(tz2 - dt.y) <= 1) return;
            if ((m.idoors || []).some(d3 => Math.abs(tx2 - d3.x) <= 1 && Math.abs(tz2 - d3.y) <= 1)) return;
            if (slots.some(s3 => s3[0] === tx2 && s3[1] === tz2)) return;
            slots.push([tx2, tz2]);
          };
          push3(r.x + 1, r.y + 1); push3(r.x + r.w - 2, r.y + 1);
          push3(r.x + 1, r.y + r.h - 2); push3(r.x + r.w - 2, r.y + r.h - 2);
          const hh = Math.abs((r.x * 73856093) ^ (r.y * 19349663) ^ (s * 83492791));
          const count = Math.min(slots.length, 2 + (hh % 2));
          for (let i = 0; i < count; i++) {
            // the bedroom floor's first slot (room corner x+1,y+1) is always
            // the bed — residents' _bed tile points exactly there
            const bedFloor = isHouse || s === (r.s || 1) - 1;
            const key = i === 0 && bedFloor ? upList[0] : upList[(hh + i) % upList.length];
            const ov = objForKey(key);
            if (!ov) continue;
            rec.upperDecor.push({
              wx: slots[i][0] + 0.5, wz: slots[i][1] + 0.5,
              y: rec.baseTier + s * STOREY_H + FLOOR_T + 0.02,
              idx: ov.idx, scale: ov.scale, s,
            });
          }
        }
      }
    }

    group.position.y = rec.baseTier;
    rec.baseY = group.position.y;
    scene.add(group);
    return rec;
  }

  // --- building structure ---
  function buildBuildingStruct(b) {
    const m = metaOf(b);
    if (m.rooms) return buildOrganicStruct(b);
    const storeys = m.storeys, stone = m.stone, kind = m.kind;
    const x0 = b.x0, z0 = b.y0, w = b.w, h = b.h;
    const x1 = x0 + w, z1 = z0 + h; // outer bounds (walls sit ON the perimeter tiles)
    const frontKey = stone ? "wall_stone" : "wall_wood";
    const sideKey = stone ? "wall_stone_side" : "wall_wood_side";
    // interior slab uses the warm sandstone variant, NOT floor_stone — city
    // streets are paved floor_stone, so an identical interior read as bare
    // pavement inside stone buildings
    const floorKey = stone ? "floor_interior" : "floor_wood";
    const topCol = stone ? 0x767a82 : 0x63482e;
    const group = new THREE.Group();
    const rec = { group, geoms: [], storeyGroups: [], slabs: [], roofGroup: null, doors: [], b, m,
      cx: x0 + w / 2, cz: z0 + h / 2 };
    // doors by wall (LocAngle W=0 N=1 E=2 S=3) — river buildings may put them
    // on any wall, one per bank
    const doorsArr = [m.door, m.door2].filter(Boolean);
    const dS = doorsArr.find(d2 => d2.angle === 3) || null;
    const dN = doorsArr.find(d2 => d2.angle === 1) || null;
    const dW = doorsArr.find(d2 => d2.angle === 0) || null;
    const dE = doorsArr.find(d2 => d2.angle === 2) || null;
    const doorX = dS ? dS.x : m.door.x;
    const battl = kind === "tower" || kind === "keep";
    const light = kind === "lighthouse";
    if (light) lighthouseMats();
    // mansion: attached wings + the archways cut through the hall's shared
    // walls on the ground AND first floor (positions from buildingMeta)
    const wings = kind === "mansion" && m.wings ? m.wings : null;
    const wdW = wings ? m.wingDoors[0] : null;
    const wdE = wings ? m.wingDoors[1] : null;
    const wdN = wings ? m.wingDoors[2] : null;
    // vertical wall face along z at fixed x with an optional 1-tile archway
    const faceZ = (sb, key, fx, za, zb, yB, yT, shade, gz) => {
      if (gz == null || gz < za || gz + 1 > zb) { sbWallFace(sb, key, fx, za, fx, zb, yB, yT, shade); return; }
      if (gz > za) sbWallFace(sb, key, fx, za, fx, gz, yB, yT, shade);
      if (gz + 1 < zb) sbWallFace(sb, key, fx, gz + 1, fx, zb, yB, yT, shade);
      sbQuad(sb, key, [fx, yB + DOOR_H, gz], [fx, yB + DOOR_H, gz + 1], [fx, yT, gz + 1], [fx, yT, gz], shade);
    };
    const faceX = (sb, key, fz, xa, xb, yB, yT, shade, gx) => {
      if (gx == null || gx < xa || gx + 1 > xb) { sbWallFace(sb, key, xa, fz, xb, fz, yB, yT, shade); return; }
      if (gx > xa) sbWallFace(sb, key, xa, fz, gx, fz, yB, yT, shade);
      if (gx + 1 < xb) sbWallFace(sb, key, gx + 1, fz, xb, fz, yB, yT, shade);
      sbQuad(sb, key, [gx, yB + DOOR_H, fz], [gx + 1, yB + DOOR_H, fz], [gx + 1, yT, fz], [gx, yT, fz], shade);
    };
    // archway passage through a 1-tile-thick wall box: side walls + lintel underside
    const archZ = (sb, fb, key, xa, xb, gz, yB) => {
      sbQuad(sb, key, [xa, yB, gz], [xb, yB, gz], [xb, yB + DOOR_H, gz], [xa, yB + DOOR_H, gz], SH_IN);
      sbQuad(sb, key, [xa, yB, gz + 1], [xb, yB, gz + 1], [xb, yB + DOOR_H, gz + 1], [xa, yB + DOOR_H, gz + 1], SH_IN);
      sbQuad(fb, key, [xa, yB + DOOR_H, gz], [xb, yB + DOOR_H, gz], [xb, yB + DOOR_H, gz + 1], [xa, yB + DOOR_H, gz + 1], 0.5);
    };
    const archX = (sb, fb, key, za, zb, gx, yB) => {
      sbQuad(sb, key, [gx, yB, za], [gx, yB, zb], [gx, yB + DOOR_H, zb], [gx, yB + DOOR_H, za], SH_IN);
      sbQuad(sb, key, [gx + 1, yB, za], [gx + 1, yB, zb], [gx + 1, yB + DOOR_H, zb], [gx + 1, yB + DOOR_H, za], SH_IN);
      sbQuad(fb, key, [gx, yB + DOOR_H, za], [gx + 1, yB + DOOR_H, za], [gx + 1, yB + DOOR_H, zb], [gx, yB + DOOR_H, zb], 0.5);
    };

    // plinth: raised floor slab over the whole footprint + doorstep
    {
      const ft = newSB(), ff = newSB();
      if (stone) sbFloor(ft, floorKey, x0, z0, x1, z1, FLOOR_T);
      else {
        const fp = newSB();
        sbPlanks(fp, x0, z0, x1, z1, FLOOR_T);
        sbMesh(fp, matFlat(0x9a6b3a), rec, group);
      }
      sbWallFace(ff, frontKey, x0, z1, x1, z1, 0, FLOOR_T, SH_S);
      sbWallFace(ff, frontKey, x0, z0, x1, z0, 0, FLOOR_T, SH_N);
      sbWallFace(ff, frontKey, x0, z0, x0, z1, 0, FLOOR_T, SH_W);
      sbWallFace(ff, frontKey, x1, z0, x1, z1, 0, FLOOR_T, SH_E);
      // doorstep outside each door
      if (dS)
        sbQuad(ft, floorKey, [dS.x + 0.08, 0.03, z1], [dS.x + 0.92, 0.03, z1], [dS.x + 0.92, 0.03, z1 + 0.5], [dS.x + 0.08, 0.03, z1 + 0.5]);
      if (dN)
        sbQuad(ft, floorKey, [dN.x + 0.08, 0.03, z0 - 0.5], [dN.x + 0.92, 0.03, z0 - 0.5], [dN.x + 0.92, 0.03, z0], [dN.x + 0.08, 0.03, z0]);
      if (dW)
        sbQuad(ft, floorKey, [x0 - 0.5, 0.03, dW.y + 0.08], [x0, 0.03, dW.y + 0.08], [x0, 0.03, dW.y + 0.92], [x0 - 0.5, 0.03, dW.y + 0.92]);
      if (dE)
        sbQuad(ft, floorKey, [x1, 0.03, dE.y + 0.08], [x1 + 0.5, 0.03, dE.y + 0.08], [x1 + 0.5, 0.03, dE.y + 0.92], [x1, 0.03, dE.y + 0.92]);
      sbMesh(ft, sharedMat, rec, group);
      sbMesh(ff, matFlat(0x5c5f66), rec, group);
    }

    // wall storeys (the ground storey starts on the plinth top so the skirt
    // below it is never coplanar with the wall face)
    for (let s = 0; s < storeys; s++) {
      const yB = s === 0 ? FLOOR_T : s * STOREY_H, yT = (s + 1) * STOREY_H;
      // wallMeshes: everything that vanishes while the player stands on this
      // storey (wall boxes, trim, lighthouse drum) — doors, ladders and
      // furniture are NOT in it. flat: the collapsed stand-in, low kerbs
      // tracing the wall footprints at floor level (the wall tops "dropped
      // to the ground") with jamb posts marking the doorways.
      const sg = { group: new THREE.Group(), sides: {}, wallMeshes: [],
        flat: new THREE.Group() };
      sg.flat.visible = false;
      sg.group.add(sg.flat);
      for (const sd of ["n", "s", "e", "w"]) {
        sg.sides[sd] = new THREE.Group();
        sg.group.add(sg.sides[sd]);
      }
      if (light && s > 0) {
        // tapered lighthouse drum: thin banded walls, stepping in per storey
        const inset = [0, 0.4, 0.75, 1.0][s] ?? 1.0;
        const a = x0 + inset, bx2 = x1 - inset, c = z0 + inset, d = z1 - inset;
        const mat = (s & 1) ? matLightRed : matLightWhite;
        const mk = (sd, ax, az, bx3, bz3, shade) => {
          const sb = newSB();
          sbWallFace(sb, "wall_stone", ax, az, bx3, bz3, yB, yT, shade);
          const dm = sbMesh(sb, mat, rec, sg.sides[sd]);
          if (dm) sg.wallMeshes.push(dm);
        };
        mk("n", a, c, bx2, c, SH_N);
        mk("s", a, d, bx2, d, SH_S);
        mk("w", a, c, a, d, SH_W);
        mk("e", bx2, c, bx2, d, SH_E);
        // ledge ring where the drum steps in (lifted a hair off the band below)
        const lg = newSB(), ly = yB + 0.02;
        sbFlatRect(lg, a - 0.31, c - 0.31, bx2 + 0.31, c, ly);
        sbFlatRect(lg, a - 0.31, d, bx2 + 0.31, d + 0.31, ly);
        sbFlatRect(lg, a - 0.31, c, a, d, ly);
        sbFlatRect(lg, bx2, c, bx2 + 0.31, d, ly);
        const lm = sbMesh(lg, matFlat(0x8a8e96), rec, sg.group);
        if (lm) sg.wallMeshes.push(lm);
      } else {
        // 1-tile-thick wall boxes: west/east boxes run the full depth (they own
        // the corners), north/south boxes span between them — faces meet flush,
        // nothing overlaps, so corners are real corners.
        const mkSide = (sd, fn) => { const sb = newSB(), fb = newSB(); fn(sb, fb);
          const m1 = sbMesh(sb, sharedMat, rec, sg.sides[sd]);
          const m2 = sbMesh(fb, matFlat(topCol), rec, sg.sides[sd]);
          if (m1) sg.wallMeshes.push(m1);
          if (m2) sg.wallMeshes.push(m2); };
        const gzW = wings && s <= 1 ? wdW.y : (dW && s === 0 ? dW.y : null);
        const gzE = wings && s <= 1 ? wdE.y : (dE && s === 0 ? dE.y : null);
        // north opening: mansion wing archway, or a river building's 2nd door
        const gxN = wings && s <= 1 ? wdN.x : (dN && s === 0 ? dN.x : null);
        mkSide("w", (sb, fb) => {
          faceZ(sb, sideKey, x0, z0, z1, yB, yT, SH_W, gzW);            // outer
          faceZ(sb, sideKey, x0 + 1, z0 + 1, z1 - 1, yB, yT, SH_IN, gzW); // inner
          sbWallFace(sb, frontKey, x0, z0, x0 + 1, z0, yB, yT, SH_N);   // n end
          sbWallFace(sb, frontKey, x0, z1, x0 + 1, z1, yB, yT, SH_S);   // s end
          if (gzW != null) archZ(sb, fb, frontKey, x0, x0 + 1, gzW, yB);
          sbFlatRect(fb, x0, z0, x0 + 1, z1, yT);
        });
        mkSide("e", (sb, fb) => {
          faceZ(sb, sideKey, x1, z0, z1, yB, yT, SH_E, gzE);
          faceZ(sb, sideKey, x1 - 1, z0 + 1, z1 - 1, yB, yT, SH_IN, gzE);
          sbWallFace(sb, frontKey, x1 - 1, z0, x1, z0, yB, yT, SH_N);
          sbWallFace(sb, frontKey, x1 - 1, z1, x1, z1, yB, yT, SH_S);
          if (gzE != null) archZ(sb, fb, frontKey, x1 - 1, x1, gzE, yB);
          sbFlatRect(fb, x1 - 1, z0, x1, z1, yT);
        });
        mkSide("n", (sb, fb) => {
          faceX(sb, frontKey, z0, x0 + 1, x1 - 1, yB, yT, SH_N, gxN);
          faceX(sb, frontKey, z0 + 1, x0 + 1, x1 - 1, yB, yT, SH_IN, gxN);
          if (gxN != null) archX(sb, fb, frontKey, z0, z0 + 1, gxN, yB);
          sbFlatRect(fb, x0 + 1, z0, x1 - 1, z0 + 1, yT);
        });
        mkSide("s", (sb, fb) => {
          const za = z1 - 1;
          if (s === 0 && dS) {
            // door opening at doorX with a lintel band above it
            sbWallFace(sb, frontKey, x0 + 1, z1, doorX, z1, yB, yT, SH_S);
            sbWallFace(sb, frontKey, doorX + 1, z1, x1 - 1, z1, yB, yT, SH_S);
            sbWallFace(sb, frontKey, x0 + 1, za, doorX, za, yB, yT, SH_IN);
            sbWallFace(sb, frontKey, doorX + 1, za, x1 - 1, za, yB, yT, SH_IN);
            sbQuad(sb, frontKey, [doorX, yB + DOOR_H, z1], [doorX + 1, yB + DOOR_H, z1], [doorX + 1, yT, z1], [doorX, yT, z1], SH_S);
            sbQuad(sb, frontKey, [doorX, yB + DOOR_H, za], [doorX + 1, yB + DOOR_H, za], [doorX + 1, yT, za], [doorX, yT, za], SH_IN);
            // jambs + lintel underside
            sbQuad(sb, frontKey, [doorX, yB, za], [doorX, yB, z1], [doorX, yB + DOOR_H, z1], [doorX, yB + DOOR_H, za], SH_IN);
            sbQuad(sb, frontKey, [doorX + 1, yB, za], [doorX + 1, yB, z1], [doorX + 1, yB + DOOR_H, z1], [doorX + 1, yB + DOOR_H, za], SH_IN);
            sbQuad(fb, frontKey, [doorX, yB + DOOR_H, za], [doorX + 1, yB + DOOR_H, za], [doorX + 1, yB + DOOR_H, z1], [doorX, yB + DOOR_H, z1], 0.5);
          } else {
            sbWallFace(sb, frontKey, x0 + 1, z1, x1 - 1, z1, yB, yT, SH_S);
            sbWallFace(sb, frontKey, x0 + 1, za, x1 - 1, za, yB, yT, SH_IN);
          }
          sbFlatRect(fb, x0 + 1, za, x1 - 1, z1, yT);
        });
        // seam trim ring between storeys breaks up tall facades
        if (s > 0) {
          const tr = newSB(), o = 0.04, ty0 = yB - 0.06, ty1 = yB + 0.08;
          sbQuad(tr, "wall_stone", [x0 - o, ty0, z0 - o], [x1 + o, ty0, z0 - o], [x1 + o, ty1, z0 - o], [x0 - o, ty1, z0 - o], SH_N);
          sbQuad(tr, "wall_stone", [x0 - o, ty0, z1 + o], [x1 + o, ty0, z1 + o], [x1 + o, ty1, z1 + o], [x0 - o, ty1, z1 + o], SH_S);
          sbQuad(tr, "wall_stone", [x0 - o, ty0, z0 - o], [x0 - o, ty0, z1 + o], [x0 - o, ty1, z1 + o], [x0 - o, ty1, z0 - o], SH_W);
          sbQuad(tr, "wall_stone", [x1 + o, ty0, z0 - o], [x1 + o, ty0, z1 + o], [x1 + o, ty1, z1 + o], [x1 + o, ty1, z0 - o], SH_E);
          const tm = sbMesh(tr, matFlat(stone ? 0x5b5e66 : 0x4a3a28), rec, sg.group);
          if (tm) sg.wallMeshes.push(tm);
        }
        // collapsed stand-in for this storey: low kerbs over the wall
        // footprints (door/arch tiles stay open, flanked by jamb posts up to
        // lintel height so the way out still reads as a doorway)
        {
          const ob = newSB(), oy = yB + 0.01, OT = 0.07, JW = 0.1;
          const stripZ = (fx, za, zb, gz) => {
            if (gz == null || gz < za || gz + 1 > zb) { sbBlock(ob, fx, oy, za, fx + 1, oy + OT, zb); return; }
            if (gz > za) sbBlock(ob, fx, oy, za, fx + 1, oy + OT, gz);
            if (gz + 1 < zb) sbBlock(ob, fx, oy, gz + 1, fx + 1, oy + OT, zb);
            sbBlock(ob, fx, oy, gz - JW, fx + 1, oy + DOOR_H, gz);
            sbBlock(ob, fx, oy, gz + 1, fx + 1, oy + DOOR_H, gz + 1 + JW);
          };
          const stripX = (fz, xa, xb, gx) => {
            if (gx == null || gx < xa || gx + 1 > xb) { sbBlock(ob, xa, oy, fz, xb, oy + OT, fz + 1); return; }
            if (gx > xa) sbBlock(ob, xa, oy, fz, gx, oy + OT, fz + 1);
            if (gx + 1 < xb) sbBlock(ob, gx + 1, oy, fz, xb, oy + OT, fz + 1);
            sbBlock(ob, gx - JW, oy, fz, gx, oy + DOOR_H, fz + 1);
            sbBlock(ob, gx + 1, oy, fz, gx + 1 + JW, oy + DOOR_H, fz + 1);
          };
          stripZ(x0, z0, z1, gzW);
          stripZ(x1 - 1, z0, z1, gzE);
          stripX(z0, x0 + 1, x1 - 1, gxN);
          stripX(z1 - 1, x0 + 1, x1 - 1, s === 0 && dS ? doorX : null);
          sbMesh(ob, matFlat(topCol), rec, sg.flat);
        }
      }
      // ladder segments for this storey: two rails + rungs, leaning slightly
      // against the tile's north edge. The rails continue well above the floor
      // each climbs to (RS "laddertop") so the way down is obvious upstairs.
      // Per-pair shafts (ld.s) draw only on their own storey; a legacy
      // untagged ladder spans the full height.
      for (const ld of (m.ladders || (m.ladder ? [m.ladder] : []))) {
        const from = ld.s != null ? ld.s : 0, to = ld.s != null ? ld.s + 1 : storeys - 1;
        if (s < from || s >= to) continue;
        const lb = newSB();
        const lx = ld.x + 0.5, lz = ld.y + 0.28;
        const railTop = yT + 0.85, rungTop = yT + 0.55;
        for (const rx of [-0.26, 0.26])
          sbBlock(lb, lx + rx - 0.045, yB, lz - 0.045, lx + rx + 0.045, railTop, lz + 0.045);
        const nR = Math.max(4, Math.round((rungTop - yB) / 0.36));
        for (let r = 1; r <= nR; r++) {
          const ry = yB + (rungTop - yB) * r / (nR + 1);
          sbBlock(lb, lx - 0.26, ry - 0.04, lz - 0.03, lx + 0.26, ry + 0.04, lz + 0.03);
        }
        sbMesh(lb, matFlat(0x64a8f0), rec, sg.group); // blue-tinted rails: ladders must pop
      }
      rec.storeyGroups.push(sg);
      group.add(sg.group);
    }

    // upper floor slabs (interior only): plank top for contrast, dark underside
    for (let s = 1; s < storeys; s++) {
      const st = newSB(), su = newSB();
      sbPlanks(st, x0 + 1, z0 + 1, x1 - 1, z1 - 1, s * STOREY_H + 0.02);
      sbFlatRect(su, x0 + 1, z0 + 1, x1 - 1, z1 - 1, s * STOREY_H - 0.09);
      const slabGrp = new THREE.Group();
      sbMesh(st, matFlat(0x9a6b3a), rec, slabGrp);
      sbMesh(su, matFlat(0x3c352c), rec, slabGrp);
      group.add(slabGrp);
      rec.slabs.push(slabGrp);
    }

    // roof
    const roofGroup = new THREE.Group();
    rec.roofGroup = roofGroup;
    group.add(roofGroup);
    const roofTop = storeys * STOREY_H;
    if (light) {
      // gallery ledge, glowing lamp room and cap
      const inset = 1.0;
      const ga = x0 + inset - 0.45, gb = x1 - inset + 0.45;
      const gc = z0 + inset - 0.45, gd = z1 - inset + 0.45;
      const fb = newSB();
      sbBlock(fb, ga, roofTop, gc, gb, roofTop + 0.09, gd);
      sbMesh(fb, matFlat(0x4a4a52), rec, roofGroup);
      const cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2, lh = 0.85;
      const lb = newSB();
      sbQuad(lb, "wall_stone", [cxm - lh, roofTop + 0.09, czm - lh], [cxm + lh, roofTop + 0.09, czm - lh], [cxm + lh, roofTop + 0.95, czm - lh], [cxm - lh, roofTop + 0.95, czm - lh]);
      sbQuad(lb, "wall_stone", [cxm - lh, roofTop + 0.09, czm + lh], [cxm + lh, roofTop + 0.09, czm + lh], [cxm + lh, roofTop + 0.95, czm + lh], [cxm - lh, roofTop + 0.95, czm + lh]);
      sbQuad(lb, "wall_stone", [cxm - lh, roofTop + 0.09, czm - lh], [cxm - lh, roofTop + 0.09, czm + lh], [cxm - lh, roofTop + 0.95, czm + lh], [cxm - lh, roofTop + 0.95, czm - lh]);
      sbQuad(lb, "wall_stone", [cxm + lh, roofTop + 0.09, czm - lh], [cxm + lh, roofTop + 0.09, czm + lh], [cxm + lh, roofTop + 0.95, czm + lh], [cxm + lh, roofTop + 0.95, czm - lh]);
      sbMesh(lb, matFlat(0xffd76a), rec, roofGroup);
      const cap = newSB();
      const capY = roofTop + 0.95, apex = [cxm, roofTop + 1.75, czm];
      const ch2 = lh + 0.18;
      sbTri(cap, "roof_gray", [cxm - ch2, capY, czm - ch2], [cxm + ch2, capY, czm - ch2], apex, [0, 0], [1, 0], [0.5, 1], SH_N);
      sbTri(cap, "roof_gray", [cxm + ch2, capY, czm - ch2], [cxm + ch2, capY, czm + ch2], apex, [0, 0], [1, 0], [0.5, 1], SH_E);
      sbTri(cap, "roof_gray", [cxm + ch2, capY, czm + ch2], [cxm - ch2, capY, czm + ch2], apex, [0, 0], [1, 0], [0.5, 1], SH_S);
      sbTri(cap, "roof_gray", [cxm - ch2, capY, czm + ch2], [cxm - ch2, capY, czm - ch2], apex, [0, 0], [1, 0], [0.5, 1], SH_W);
      sbMesh(cap, sharedMat, rec, roofGroup);
    } else if (battl) {
      // flat stone roof deck + battlement ring
      const rt = newSB(), fb = newSB();
      sbFloor(rt, "floor_stone", x0 + 1, z0 + 1, x1 - 1, z1 - 1, roofTop + 0.02);
      sbMerlons(fb, x0, z0, x1, z0, roofTop, false);
      sbMerlons(fb, x0, z1, x1, z1, roofTop, true);
      sbMerlons(fb, x0, z0, x0, z1, roofTop, false);
      sbMerlons(fb, x1, z0, x1, z1, roofTop, true);
      sbMesh(rt, sharedMat, rec, roofGroup);
      sbMesh(fb, matFlat(0x767a82), rec, roofGroup);
    } else {
      buildHipRoof(rec, roofGroup, x0, z0, x1, z1, roofTop,
        atlas.cells[b.roof] ? b.roof : (stone ? "roof_gray" : "roof_brown"), kind === "spire");
    }

    // mansion wings: three attached 2-storey rooms sharing a wall with the
    // hall (the hall's wall face doubles as the wing's inner wall; flank boxes
    // stop at that plane with no end caps, so nothing is ever coplanar)
    if (wings) {
      const rk = atlas.cells[b.roof] ? b.roof : "roof_gray";
      for (const wg of wings) {
        const wx0 = wg.x0, wz0 = wg.y0, wx1 = wg.x0 + wg.w, wz1 = wg.y0 + wg.h;
        for (let s = 0; s < wg.storeys; s++) {
          const yB = s === 0 ? FLOOR_T : s * STOREY_H, yT = (s + 1) * STOREY_H;
          const sb = newSB(), fb = newSB();
          if (wg.shared === "e") {
            // west wing: far (west) box owns the corners
            sbWallFace(sb, sideKey, wx0, wz0, wx0, wz1, yB, yT, SH_W);
            sbWallFace(sb, sideKey, wx0 + 1, wz0 + 1, wx0 + 1, wz1 - 1, yB, yT, SH_IN);
            sbWallFace(sb, frontKey, wx0, wz0, wx0 + 1, wz0, yB, yT, SH_N);
            sbWallFace(sb, frontKey, wx0, wz1, wx0 + 1, wz1, yB, yT, SH_S);
            sbFlatRect(fb, wx0, wz0, wx0 + 1, wz1, yT);
            sbWallFace(sb, frontKey, wx0 + 1, wz0, x0, wz0, yB, yT, SH_N);
            sbWallFace(sb, frontKey, wx0 + 1, wz0 + 1, x0, wz0 + 1, yB, yT, SH_IN);
            sbFlatRect(fb, wx0 + 1, wz0, x0, wz0 + 1, yT);
            sbWallFace(sb, frontKey, wx0 + 1, wz1 - 1, x0, wz1 - 1, yB, yT, SH_IN);
            sbWallFace(sb, frontKey, wx0 + 1, wz1, x0, wz1, yB, yT, SH_S);
            sbFlatRect(fb, wx0 + 1, wz1 - 1, x0, wz1, yT);
          } else if (wg.shared === "w") {
            // east wing: far (east) box owns the corners
            sbWallFace(sb, sideKey, wx1, wz0, wx1, wz1, yB, yT, SH_E);
            sbWallFace(sb, sideKey, wx1 - 1, wz0 + 1, wx1 - 1, wz1 - 1, yB, yT, SH_IN);
            sbWallFace(sb, frontKey, wx1 - 1, wz0, wx1, wz0, yB, yT, SH_N);
            sbWallFace(sb, frontKey, wx1 - 1, wz1, wx1, wz1, yB, yT, SH_S);
            sbFlatRect(fb, wx1 - 1, wz0, wx1, wz1, yT);
            sbWallFace(sb, frontKey, x1, wz0, wx1 - 1, wz0, yB, yT, SH_N);
            sbWallFace(sb, frontKey, x1, wz0 + 1, wx1 - 1, wz0 + 1, yB, yT, SH_IN);
            sbFlatRect(fb, x1, wz0, wx1 - 1, wz0 + 1, yT);
            sbWallFace(sb, frontKey, x1, wz1 - 1, wx1 - 1, wz1 - 1, yB, yT, SH_IN);
            sbWallFace(sb, frontKey, x1, wz1, wx1 - 1, wz1, yB, yT, SH_S);
            sbFlatRect(fb, x1, wz1 - 1, wx1 - 1, wz1, yT);
          } else {
            // north wing: far (north) box owns the corners
            sbWallFace(sb, frontKey, wx0, wz0, wx1, wz0, yB, yT, SH_N);
            sbWallFace(sb, frontKey, wx0 + 1, wz0 + 1, wx1 - 1, wz0 + 1, yB, yT, SH_IN);
            sbWallFace(sb, sideKey, wx0, wz0, wx0, wz0 + 1, yB, yT, SH_W);
            sbWallFace(sb, sideKey, wx1, wz0, wx1, wz0 + 1, yB, yT, SH_E);
            sbFlatRect(fb, wx0, wz0, wx1, wz0 + 1, yT);
            sbWallFace(sb, sideKey, wx0, wz0 + 1, wx0, z0, yB, yT, SH_W);
            sbWallFace(sb, sideKey, wx0 + 1, wz0 + 1, wx0 + 1, z0, yB, yT, SH_IN);
            sbFlatRect(fb, wx0, wz0 + 1, wx0 + 1, z0, yT);
            sbWallFace(sb, sideKey, wx1 - 1, wz0 + 1, wx1 - 1, z0, yB, yT, SH_IN);
            sbWallFace(sb, sideKey, wx1, wz0 + 1, wx1, z0, yB, yT, SH_E);
            sbFlatRect(fb, wx1 - 1, wz0 + 1, wx1, z0, yT);
          }
          const wm1 = sbMesh(sb, sharedMat, rec, rec.storeyGroups[s].group);
          const wm2 = sbMesh(fb, matFlat(topCol), rec, rec.storeyGroups[s].group);
          if (wm1) rec.storeyGroups[s].wallMeshes.push(wm1);
          if (wm2) rec.storeyGroups[s].wallMeshes.push(wm2);
          // wing kerbs for the collapsed view (no openings in wing outer
          // walls — the archways cut the hall's own walls, gapped above)
          {
            const ob = newSB(), oy = yB + 0.01, OT = 0.07;
            const blk = (ax, az, bx3, bz3) => sbBlock(ob, ax, oy, az, bx3, oy + OT, bz3);
            if (wg.shared === "e") {
              blk(wx0, wz0, wx0 + 1, wz1);
              blk(wx0 + 1, wz0, x0, wz0 + 1);
              blk(wx0 + 1, wz1 - 1, x0, wz1);
            } else if (wg.shared === "w") {
              blk(wx1 - 1, wz0, wx1, wz1);
              blk(x1, wz0, wx1 - 1, wz0 + 1);
              blk(x1, wz1 - 1, wx1 - 1, wz1);
            } else {
              blk(wx0, wz0, wx1, wz0 + 1);
              blk(wx0, wz0 + 1, wx0 + 1, z0);
              blk(wx1 - 1, wz0 + 1, wx1, z0);
            }
            sbMesh(ob, matFlat(topCol), rec, rec.storeyGroups[s].flat);
          }
        }
        // wing first-floor slab (into the hall's level-1 slab group)
        {
          const st = newSB(), su = newSB();
          const ix0 = wg.shared === "w" ? x1 : wx0 + 1;
          const ix1 = wg.shared === "e" ? x0 : wx1 - 1;
          const iz0 = wz0 + 1, iz1 = wg.shared === "s" ? z0 : wz1 - 1;
          sbPlanks(st, ix0, iz0, ix1, iz1, STOREY_H + 0.02);
          sbFlatRect(su, ix0, iz0, ix1, iz1, STOREY_H - 0.09);
          sbMesh(st, matFlat(0x9a6b3a), rec, rec.slabs[0]);
          sbMesh(su, matFlat(0x3c352c), rec, rec.slabs[0]);
        }
        // wing plinth (stops at the hall's plinth edge; no skirt on the shared side)
        {
          const ft = newSB(), ff = newSB();
          const px0 = wg.shared === "w" ? x1 : wx0;
          const px1 = wg.shared === "e" ? x0 : wx1;
          const pz0 = wz0, pz1 = wg.shared === "s" ? z0 : wz1;
          sbFloor(ft, floorKey, px0, pz0, px1, pz1, FLOOR_T);
          if (wg.shared !== "w") sbWallFace(ff, frontKey, px0, pz0, px0, pz1, 0, FLOOR_T, SH_W);
          if (wg.shared !== "e") sbWallFace(ff, frontKey, px1, pz0, px1, pz1, 0, FLOOR_T, SH_E);
          sbWallFace(ff, frontKey, px0, pz0, px1, pz0, 0, FLOOR_T, SH_N);
          if (wg.shared !== "s") sbWallFace(ff, frontKey, px0, pz1, px1, pz1, 0, FLOOR_T, SH_S);
          sbMesh(ft, sharedMat, rec, group);
          sbMesh(ff, matFlat(0x5c5f66), rec, group);
        }
        // wing hip roof, dying into the hall wall
        if (wg.shared === "e") buildHipRoof(rec, roofGroup, wx0, wz0, x0, wz1, 2 * STOREY_H, rk, false);
        else if (wg.shared === "w") buildHipRoof(rec, roofGroup, x1, wz0, wx1, wz1, 2 * STOREY_H, rk, false);
        else buildHipRoof(rec, roofGroup, wx0, wz0, wx1, z0, 2 * STOREY_H, rk, false);
      }
      // archway crossing floors at first-floor level (through the shared walls)
      const af = newSB();
      for (const d of m.wingDoors) sbPlanks(af, d.x, d.y, d.x + 1, d.y + 1, STOREY_H + 0.02);
      sbMesh(af, matFlat(0x9a6b3a), rec, rec.slabs[0]);
    }

    // the great telescope of an observatory: mount + tube on the first floor,
    // wide objective end poking out through the roof toward the western sky
    if (kind === "observatory") {
      const cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2;
      const tilt = 0.38, ax = -Math.sin(tilt), ay = Math.cos(tilt);
      const mount = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 1.5), matPlain(0x454a55));
      mount.position.set(cxm, STOREY_H + 0.57, czm);
      rec.storeyGroups[1].group.add(mount);
      rec.geoms.push(mount.geometry);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.6, 3.8, 10), matPlain(0x3a5a8c));
      tube.rotation.z = tilt;
      tube.position.set(cxm + ax * 1.8, STOREY_H + 1.0 + ay * 1.8, czm);
      rec.storeyGroups[1].group.add(tube);
      rec.geoms.push(tube.geometry);
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.6, 1.1, 10), matPlain(0x2b4066));
      bell.rotation.z = tilt;
      bell.position.set(cxm + ax * 3.6, STOREY_H + 1.0 + ay * 3.6, czm);
      roofGroup.add(bell);
      rec.geoms.push(bell.geometry);
    }

    // interior volumes (for the roof/upper-storey hiding test) and the
    // west-heading ground shadow — its length tracks the volume's full height
    // (walls + roof), so towers/lighthouses throw long shadows and huts short
    rec.vols = [{ x0, z0, x1, z1 }];
    if (wings) for (const wg of wings)
      rec.vols.push({ x0: wg.x0, z0: wg.y0, x1: wg.x0 + wg.w, z1: wg.y0 + wg.h });
    {
      // shadow footprints stretched by the volume's full height (walls + roof)
      // — towers/lighthouses throw long shadows, huts short. Baked per sun
      // direction by buildStructShadow; heights are group-relative (group is
      // lifted by baseTier), sampled per tile so they drape over terrain steps.
      const roofExtra = light ? 2.8 : battl ? 0.6 : kind === "spire" ? 3.2 : 1.5;
      // bldTier (rawStep-based), not groundY: a river-spanning building's
      // centre tile can be water (groundY = water surface), but the structure
      // rides the shared bank tier of its connected block
      rec.baseTier = bldTier(b);
      rec.shadowFeet = [{ x0, z0, x1, z1, len: storeys * STOREY_H + roofExtra }];
      if (wings) for (const wg of wings)
        rec.shadowFeet.push({ x0: wg.x0, z0: wg.y0, x1: wg.x0 + wg.w, z1: wg.y0 + wg.h, len: 2 * STOREY_H + 1.5 });
      buildStructShadow(rec);
    }

    // door leaves (open outward over their doorsteps), one per door on
    // whichever wall it landed
    const dKey = (stone && m.door.stone) ? "door_stone" : "door_wood";
    for (const d2 of doorsArr) {
      let leaf;
      if (d2.angle === 3)
        leaf = makeLeaf(rec, rec.storeyGroups[0].sides.s, dKey,
          d2.x, FLOOR_T, z1 - 0.12, 1, 0, 0, 1, DOOR_H - 0.05, d2.x + "," + d2.y);
      else if (d2.angle === 1)
        leaf = makeLeaf(rec, rec.storeyGroups[0].sides.n, dKey,
          d2.x, FLOOR_T, z0 + 0.12, 1, 0, 0, -1, DOOR_H - 0.05, d2.x + "," + d2.y);
      else if (d2.angle === 0)
        leaf = makeLeaf(rec, rec.storeyGroups[0].sides.w, dKey,
          x0 + 0.12, FLOOR_T, d2.y, 0, 1, -1, 0, DOOR_H - 0.05, d2.x + "," + d2.y);
      else
        leaf = makeLeaf(rec, rec.storeyGroups[0].sides.e, dKey,
          x1 - 0.12, FLOOR_T, d2.y, 0, 1, 1, 0, DOOR_H - 0.05, d2.x + "," + d2.y);
      leaf.side = ["w", "n", "e", "s"][d2.angle];
    }

    // (the river channel under a spanning building is held up solely by the
    // thick 1-tile stone_bridge#p piers the chunk stamp plants — no extra
    // small posts)

    // ---- upper storeys: bedrooms, studies and stores so floors above the
    // ground aren't bare planks. Purely visual billboards, laid out with the
    // same back-wall/side-wall scheme as ground floors, avoiding the ladder
    // (and mansion archways); placed by syncDecor and hidden along with their
    // storey when the player is inside on a lower floor.
    rec.upperDecor = [];
    // a plain one-room house (no shop/station) is the owner's BEDROOM: furnish its
    // GROUND floor with a bed. Shop/station buildings are 2-storey (job → upstairs)
    // and get their bedroom on the upper floor via the normal loop below.
    const isHouse = storeys === 1 && !b.job;
    // Tūhura Isle's Harbour Village houses (kind "tut_house") get their own
    // exact per-resident bed placement instead of the generic randomised
    // furniture list, so each tutor's assigned bed (Tutorial.villageBed)
    // matches where the furniture actually renders (user req 2026-09-17)
    const tutDecor = (kind === "tut_house" && typeof Tutorial !== "undefined" && Tutorial.tutHouseUpperDecor)
      ? Tutorial.tutHouseUpperDecor(b) : null;
    if (tutDecor) {
      for (const d of tutDecor) {
        const ov = objForKey(d.key);
        if (!ov) continue;
        rec.upperDecor.push({
          wx: d.x + 0.5, wz: d.y + 0.5,
          y: rec.baseTier + d.level * STOREY_H + FLOOR_T + 0.02,
          idx: ov.idx, scale: ov.scale, s: d.level,
        });
      }
    } else if ((storeys > 1 || isHouse) && !light) {
      const UP_TOWER = ["bookshelf_small", "desk", "candle_scrying", "brazier_iron", "strongbox", "easel"];
      // main-branch bank hall: upper floors are the counting house + vault
      const UP_BANK = ["strongbox", "treasure_chest", "lockbox", "desk", "candelabra", "bookshelf_small", "chest_storage", "jewelry_box"];
      const UP_STONE = ["bed_fourposter", "wardrobe", "bookshelf_small", "dresser_mirror", "candelabra", "desk", "chest_storage", "stool"];
      const UP_WOOD = ["bed_frame", "dresser", "chest_storage", "cupboard", "stool", "bookshelf_small", "bench_trestle", "bucket"];
      const HOUSE = stone ? ["bed_fourposter", "chest_storage", "dresser_mirror", "stool", "wardrobe"]
                          : ["bed_frame", "chest_storage", "dresser", "stool", "cupboard"];
      const upList = isHouse ? HOUSE
        : kind === "mainbank" ? UP_BANK
        : (kind === "tower" || kind === "spire" || kind === "observatory" || kind === "keep")
        ? UP_TOWER : stone ? UP_STONE : UP_WOOD;
      const ldList = m.ladders || (m.ladder ? [m.ladder] : []);
      const sFrom = isHouse ? 0 : 1, sTo = isHouse ? 1 : storeys;
      for (let s = sFrom; s < sTo; s++) {
        const cx3 = x0 + (w >> 1);
        const slots = [];
        const push3 = (tx2, tz2) => {
          if (tx2 <= x0 || tx2 >= x1 - 1 || tz2 <= z0 || tz2 >= z1 - 1) return;
          for (const ld of ldList)
            if (Math.abs(tx2 - ld.x) <= 1 && Math.abs(tz2 - ld.y) <= 1) return; // ladder clearance
          for (const dt of doorsArr)
            if (Math.abs(tx2 - dt.x) <= 1 && Math.abs(tz2 - dt.y) <= 1) return; // doorway clearance
          if (wings && s === 1 && m.wingDoors &&
              m.wingDoors.some(d3 => d3.x === tx2 && d3.y === tz2)) return;
          if (slots.some(s3 => s3[0] === tx2 && s3[1] === tz2)) return;
          slots.push([tx2, tz2]);
        };
        push3(cx3 - 1, z0 + 1); push3(cx3 + 1, z0 + 1);
        push3(x0 + 1, z0 + 1); push3(x1 - 2, z0 + 1);
        push3(x0 + 1, z0 + 2); push3(x1 - 2, z0 + 2);
        push3(x0 + 1, z1 - 2); push3(x1 - 2, z1 - 2);
        const hh = Math.abs((x0 * 73856093) ^ (z0 * 19349663) ^ (s * 83492791));
        const count = Math.min(slots.length, 4 + (hh % 3));
        for (let i = 0; i < count; i++) {
          const key = upList[(isHouse ? i : (hh + i)) % upList.length];  // house: bed first
          const ov = objForKey(key);
          if (!ov) continue;
          rec.upperDecor.push({
            wx: slots[i][0] + 0.5, wz: slots[i][1] + 0.5,
            y: rec.baseTier + s * STOREY_H + FLOOR_T + 0.02,
            idx: ov.idx, scale: ov.scale, s,
          });
        }
      }
    }

    // the whole structure rides its (flattened) terrain tier
    group.position.y = rec.baseTier;
    rec.baseY = group.position.y;
    scene.add(group);
    return rec;
  }

  // --- walled city ring structure ---
  function buildVillageStruct(v) {
    const R = v.R, Ry = v.Ry != null ? v.Ry : v.R, cx = v.x, cz = v.y; // rectangular ring (Newhaven)
    const group = new THREE.Group();
    const rec = { group, geoms: [], storeyGroups: [], slabs: [], roofGroup: null, doors: [], v,
      vols: [], cx, cz };
    const H = CITYWALL_H;
    const wat = (x, y) => world.isWater(x, y);
    const sb = newSB(), fb = newSB();
    // shadow footprints (per wall segment / turret), baked per sun direction by
    // buildStructShadow; heights group-relative (ring rides the city tier)
    rec.baseTier = groundY(cx, cz);
    rec.shadowFeet = [];
    // a straight wall box over tiles [ax..bx]x[az..bz] (inclusive tile coords,
    // 1 tile thick), with walkway top and outer merlons. capA/capB draw the
    // end cross-sections: false = none (run abuts a corner turret whose own
    // face would z-fight in the same plane), true = full from yBot, a number
    // = only from that height up (the exposed step above a lower neighbour
    // sub-run, so coplanar caps never overlap).
    // stepped terrain: the ring rides the city centre's tier (group offset);
    // wall bottoms extend WB below it so slopes never show a gap underneath,
    // and the TOP rises with the local ground (lift2) so high terrain around
    // the city is still definitively walled off.
    const WB = -4;
    const lift = (x, y) => Math.max(0, Math.round((groundY(x, y) - rec.baseTier) / STEP_H) * STEP_H);
    const run = (tx0, tz0, tx1, tz1, horiz, capA = true, capB = true, lift2 = 0, yBot = WB) => {
      const ox0 = tx0, oz0 = tz0, ox1 = tx1 + 1, oz1 = tz1 + 1;
      const yT = H + lift2;
      sbWallFace(sb, "wall_stone", ox0, oz0, horiz ? ox1 : ox0, horiz ? oz0 : oz1, yBot, yT, horiz ? SH_N : SH_W);
      sbWallFace(sb, "wall_stone", horiz ? ox0 : ox1, horiz ? oz1 : oz0, ox1, oz1, yBot, yT, horiz ? SH_S : SH_E);
      const capY = c => c === true ? yBot : c;
      if (capA !== false) sbWallFace(sb, "wall_stone", ox0, oz0, horiz ? ox0 : ox1, horiz ? oz1 : oz0, capY(capA), yT, horiz ? SH_W : SH_N);
      if (capB !== false) sbWallFace(sb, "wall_stone", horiz ? ox1 : ox0, horiz ? oz0 : oz1, ox1, oz1, capY(capB), yT, horiz ? SH_E : SH_S);
      sbFloor(sb, "floor_stone", ox0, oz0, ox1, oz1, yT); // walkway deck
      if (horiz) {
        const outerN = tz0 === cz - Ry;
        sbMerlons(fb, ox0, outerN ? oz0 : oz1, ox1, outerN ? oz0 : oz1, yT, !outerN);
      } else {
        const outerW = tx0 === cx - R;
        sbMerlons(fb, outerW ? ox0 : ox1, oz0, outerW ? ox0 : ox1, oz1, yT, !outerW);
      }
      rec.shadowFeet.push({ x0: ox0, z0: oz0, x1: ox1, z1: oz1, len: (yT + 0.4) * 0.95 });
    };
    // collect contiguous land spans of each side's ring tiles (gate gap |d|<=2
    // is skipped, as are bridge decks — those get structural gates below;
    // corners are separate turrets). Each span is then split into sub-runs of
    // equal terrain lift so the walkway steps along like terraces.
    const bridged = (x, y) => (world.getDecor(x, y) || "").startsWith("stone_bridge");
    const turretAt = (sx, sz) => !wat(cx + sx * R, cz + sz * Ry);
    const spans = (fixed, isRow) => {
      let a = null;
      const lim = isRow ? R : Ry; // rows run the full width; columns span |dy| < Ry
      for (let d = -lim + 1; d <= lim - 1; d++) {
        const tx = isRow ? cx + d : fixed, tz = isRow ? fixed : cz + d;
        const wall = Math.abs(d) > 2 && !wat(tx, tz) && !bridged(tx, tz);
        if (wall && a === null) a = d;
        if ((!wall || d === lim - 1) && a !== null) {
          const b2 = wall && d === lim - 1 ? d : d - 1;
          const sFix = isRow ? Math.sign(fixed - cz) : Math.sign(fixed - cx);
          const capA = !(a === -lim + 1 && (isRow ? turretAt(-1, sFix) : turretAt(sFix, -1)));
          const capB = !(b2 === lim - 1 && (isRow ? turretAt(1, sFix) : turretAt(sFix, 1)));
          const lifts = [];
          for (let d2 = a; d2 <= b2; d2++)
            lifts.push(lift(isRow ? cx + d2 : fixed, isRow ? fixed : cz + d2));
          let s0 = 0;
          for (let i = 1; i <= lifts.length; i++) {
            if (i < lifts.length && lifts[i] === lifts[s0]) continue;
            const lv2 = lifts[s0];
            const prevL = s0 > 0 ? lifts[s0 - 1] : null;
            const nextL = i < lifts.length ? lifts[i] : null;
            const cA = s0 === 0 ? capA : (lv2 > prevL ? H + prevL : false);
            const cB = i === lifts.length ? capB : (lv2 > nextL ? H + nextL : false);
            const dA = a + s0, dB = a + i - 1;
            if (isRow) run(cx + dA, fixed, cx + dB, fixed, true, cA, cB, lv2);
            else run(fixed, cz + dA, fixed, cz + dB, false, cA, cB, lv2);
            s0 = i;
          }
          a = null;
        }
      }
    };
    spans(cz - Ry, true);
    spans(cz + Ry, true);
    spans(cx - R, false);
    spans(cx + R, false);
    // corner turrets (their tops ride the local terrain lift too)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const tx = cx + sx * R, tz = cz + sz * Ry;
      if (wat(tx, tz)) continue;
      const T = H + 0.7 + lift(tx, tz);
      sbWallFace(sb, "wall_stone", tx, tz, tx + 1, tz, WB, T, SH_N);
      sbWallFace(sb, "wall_stone", tx, tz + 1, tx + 1, tz + 1, WB, T, SH_S);
      sbWallFace(sb, "wall_stone", tx, tz, tx, tz + 1, WB, T, SH_W);
      sbWallFace(sb, "wall_stone", tx + 1, tz, tx + 1, tz + 1, WB, T, SH_E);
      sbFlatRect(fb, tx, tz, tx + 1, tz + 1, T);
      for (const mx of [0.08, 0.62]) for (const mz of [0.08, 0.62])
        sbBlock(fb, tx + mx, T, tz + mz, tx + mx + 0.3, T + 0.34, tz + mz + 0.3);
      rec.shadowFeet.push({ x0: tx, z0: tz, x1: tx + 1, z1: tz + 1, len: (T + 0.4) * 0.95 });
    }
    // gate plugs (fixed wall pieces narrowing the road gap) + swinging leaves.
    // Plugs on a bridge deck stand ON the deck (a wall gate over the crossing,
    // boat lane below stays clear); land plugs and leaves sit at local ground
    // level, which groundY flattens even across the gate apron.
    for (const g of world.gatesForVillage(v)) {
      const horiz = g.angle === 1 || g.angle === 3;
      for (const [px2, pz2] of g.plugs || []) {
        if (bridged(px2, pz2)) {
          const base = bridgeDeckY(px2, pz2) + FLOOR_T - rec.baseTier;
          run(px2, pz2, px2, pz2, horiz, true, true, base, base - 0.6);
        } else if (!wat(px2, pz2)) {
          run(px2, pz2, px2, pz2, horiz, true, true, lift(px2, pz2));
        }
      }
      const onDeck = bridged(g.x, g.y);
      if (!onDeck && wat(g.x, g.y)) continue; // open-water breach: no floating leaf
      const gy2 = (onDeck ? bridgeDeckY(g.x, g.y) + FLOOR_T : groundY(g.x, g.y)) - rec.baseTier;
      const owx = horiz ? 0 : Math.sign(g.x - cx), owz = horiz ? Math.sign(g.y - cz) : 0;
      if (horiz) {
        const hx = g.leaf === "l" ? g.x : g.x + 1;
        makeLeaf(rec, group, "gate_leaf", hx, gy2, g.y + 0.5, g.leaf === "l" ? 1 : -1, 0, owx, owz, 2.0, g.x + "," + g.y);
      } else {
        const hz = g.leaf === "l" ? g.y : g.y + 1;
        makeLeaf(rec, group, "gate_leaf", g.x + 0.5, gy2, hz, 0, g.leaf === "l" ? 1 : -1, owx, owz, 2.0, g.x + "," + g.y);
      }
    }
    sbMesh(sb, matCityWall(), rec, group);
    sbMesh(fb, matFlat(0x767a82), rec, group);
    buildStructShadow(rec);
    // the ring rides the city centre's terrain tier
    group.position.y = groundY(cx, cz);
    rec.baseY = group.position.y;
    scene.add(group);
    return rec;
  }

  // the building whose ROOM the player is standing in, or null. Bbox tests
  // aren't enough: organic bboxes contain courtyards/alleys, and row-house
  // bboxes overlap — "indoors" means an actual room interior (or a legacy
  // rect / mansion-wing interior). Shared by roof culling and drawNight.
  function playerIndoors() {
    const b = world.insideBuilding && world.insideBuilding(player.x, player.y);
    if (!b) return null;
    const m = metaOf(b);
    if (m.rooms)
      return m.rooms.some(r => player.x > r.x && player.x < r.x + r.w - 1 &&
        player.y > r.y && player.y < r.y + r.h - 1) ? b : null;
    if (player.x > b.x0 && player.x < b.x0 + b.w - 1 &&
        player.y > b.y0 && player.y < b.y0 + b.h - 1) return b;
    if (m.wings && m.wings.some(w2 => player.x > w2.x0 && player.x < w2.x0 + w2.w - 1 &&
        player.y > w2.y0 && player.y < w2.y0 + w2.h - 1)) return b;
    return null;
  }

  // roofs lift well before the walls: true when the player stands within
  // `range` tiles (Chebyshev) of any building footprint — room rects for
  // organic buildings, the rect + mansion wings for legacy ones
  function nearBuildingTile(range) {
    const list = (world.buildingsNearLoaded || world.buildingsNear)(player.x, player.y, 34);
    for (const b of list) {
      const m = metaOf(b);
      const rects = m.rooms ? m.rooms
        : [{ x: b.x0, y: b.y0, w: b.w, h: b.h },
           ...(m.wings || []).map(w2 => ({ x: w2.x0, y: w2.y0, w: w2.w, h: w2.h }))];
      for (const r of rects)
        if (player.x >= r.x - range && player.x < r.x + r.w + range &&
            player.y >= r.y - range && player.y < r.y + r.h + range) return true;
    }
    return false;
  }

  function syncStructures() {
    if (!world.buildingMeta || !world.structAt) return;
    const px = player.x, py = player.y;
    const roofsOff = !!playerIndoors() || nearBuildingTile(5);
    const seen = new Set();
    // new structures build at most one per frame (they enter view range well
    // before the camera reaches them, so spreading the builds out is
    // invisible — stacking a village's worth into one frame was a hitch)
    let buildBudget = 1;
    for (const b of (world.buildingsNearLoaded || world.buildingsNear)(px, py, 34)) {
      const key = "b" + b.x0 + "," + b.y0;
      if (seen.has(key)) continue;
      seen.add(key);
      let rec = structs.get(key);
      if (!rec) {
        if (badStructs.has(key) || buildBudget <= 0) continue;
        buildBudget--;
        try { rec = buildBuildingStruct(b); structs.set(key, rec); }
        catch (e) { badStructs.add(key); console.error("structure build failed at", key, e); continue; }
      }
      rec.unseen = 0;
      // interior visibility: while inside (hall or a mansion wing), the roof
      // and the storeys/floors ABOVE the player hide, and the current
      // storey's walls COLLAPSE — the wall boxes drop away and low kerbs (the
      // wall tops at floor level) trace the room instead, so the whole
      // interior is readable from any camera angle. Doors, ladders and
      // furniture stay up; the walls still collide exactly as before.
      const inside = rec.vols.some(vv => px >= vv.x0 && px < vv.x1 && py >= vv.z0 && py < vv.z1);
      const lv = inside ? Math.min(player.level | 0, rec.m.storeys - 1) : -1;
      // stepping inside any building — or onto a doorway/threshold, or
      // within one tile of a wall — lifts EVERY roof in view, so rooflines
      // never curtain the player from any camera angle
      rec.roofGroup.visible = !roofsOff && !inside;
      rec.storeyGroups.forEach((sg, s) => {
        sg.group.visible = !inside || s <= lv;
        const flat = inside && s === lv;
        if (sg.wallMeshes) for (const wm of sg.wallMeshes) wm.visible = !flat;
        if (sg.flat) sg.flat.visible = flat;
      });
      rec.slabs.forEach((slab, i) => { slab.visible = !inside || (i + 1) <= lv; });
    }
    if (world.walledVillagesNear) {
      for (const v of world.walledVillagesNear(px, py, 60)) {
        if (Math.abs(v.x - px) > v.R + 40 || Math.abs(v.y - py) > v.R + 40) continue;
        const key = "v" + v.x + "," + v.y;
        seen.add(key);
        let rec = structs.get(key);
        if (!rec) {
          if (badStructs.has(key) || buildBudget <= 0) continue;
          buildBudget--;
          try { rec = buildVillageStruct(v); structs.set(key, rec); }
          catch (e) { badStructs.add(key); console.error("city wall build failed at", key, e); continue; }
        }
        rec.unseen = 0;
      }
    }
    // door/gate leaves ease toward their open/closed state
    for (const rec of structs.values()) {
      for (const d of rec.doors) {
        const target = world.isDoorOpen(...d.key.split(",").map(Number)) ? d.sign * 1.9 : 0;
        if (Math.abs(target - d.cur) > 0.001) {
          d.cur += (target - d.cur) * 0.16;
          d.grp.rotation.y = d.baseYaw + d.cur;
        }
      }
    }
    // structures well out of range get disposed (with hysteresis so brief
    // radius jitter never thrashes a rebuild)
    for (const [key, rec] of structs) {
      if (seen.has(key)) continue;
      rec.unseen = (rec.unseen || 0) + 1;
      if (rec.unseen > 600) {
        scene.remove(rec.group);
        for (const g of rec.geoms) g.dispose();
        for (const sm of rec.shadowMeshes || []) sm.geometry.dispose();
        structs.delete(key);
      }
    }
  }

  // ---------- mix billboard NPCs (generated 8-direction characters) ----------
  // The generated mix characters ship as atlas sheets (MIX_SHEETS data-URIs)
  // + per-character frame placements (MIX_NPCS). Each NPC renders as a
  // directional billboard: the visible frame is the one whose world facing,
  // rotated into camera space, matches — same maths the 8-dir objects use.
  const MIXR = (function () {
    const ok = typeof MIX_NPCS !== "undefined" && MIX_NPCS && MIX_NPCS.list &&
      typeof MIX_SHEETS !== "undefined" && MIX_SHEETS.length;
    const list = ok ? MIX_NPCS.list : [];
    const order = ok ? MIX_NPCS.order : [];
    const S = ok ? MIX_NPCS.sheet : 2048;
    const byKey = new Map(list.map(d => [d.key, d]));
    const sheetRec = [];              // per-sheet {tex, mat, ready}
    const geomCache = new Map();      // "key:frame" -> PlaneGeometry (atlas UV)
    function ensureSheets() {
      if (!ok || sheetRec.length) return;
      for (let s = 0; s < MIX_SHEETS.length; s++) {
        const img = new Image();
        const tex = new THREE.Texture(img);
        tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
        tintPatch(mat);   // custom mobs share the world's light
        const rec = { tex, mat, ready: false };
        img.onload = () => { rec.ready = true; tex.needsUpdate = true; };
        img.src = MIX_SHEETS[s];
        sheetRec.push(rec);
      }
    }
    function matFor(def) { ensureSheets(); return sheetRec[def.sheet] ? sheetRec[def.sheet].mat : null; }
    function geomFor(def, frame) {
      const gk = def.key + ":" + frame;
      let g = geomCache.get(gk);
      if (!g) {
        g = new THREE.PlaneGeometry(def.fw / def.fh, 1);
        const px0 = def.ax + frame * def.fw, px1 = px0 + def.fw;
        const py0 = def.ay, py1 = def.ay + def.fh, e = 0.5;
        const u0 = (px0 + e) / S, u1 = (px1 - e) / S;
        const v1 = 1 - (py0 + e) / S, v0 = 1 - (py1 - e) / S; // atlas is top-down
        const uv = g.attributes.uv;
        uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
        geomCache.set(gk, g);
      }
      return g;
    }
    // strip frame for a facing dir8 name, rotated into the current camera view
    function frameFor(faceDir8) {
      const wi = Math.max(0, DIR8.indexOf(faceDir8));
      const disp = DIR8[(wi - camDir + 8) & 7];
      const f = order.indexOf(disp);
      return f < 0 ? 0 : f;
    }
    return { ok, list, order, byKey, matFor, geomFor, frameFor };
  })();
  const MIX_SCALE = CHAR_SCALE;     // unified with the player base scale so NPCs and
                                    // player characters share ONE size reference
                                    // (same h/w mins & maxs → identical world size)

  function renderMixNpc(id, npc, def) {
    const mat = MIXR.matFor(def);
    if (!mat) return;
    // a villager asleep on their OWN bed lies down on it (world-anchored flat
    // sprite, like flat decor) instead of standing on the mattress. Requires a
    // real _bed (or, for a stranded NPC, an away-bed found at bedtime).
    const lying = (!!npc._bed || !!npc._awayBed) && typeof npcAsleep === "function" && npcAsleep(npc);
    const frame = MIXR.frameFor(lying ? "south" : (npc.dir8 || "south"));
    const g = MIXR.geomFor(def, frame);
    let m = meshes.get(id);
    if (m && !m.userData.isMix) {
      scene.remove(m); if (m.userData.shadow) scene.remove(m.userData.shadow);
      meshes.delete(id); m = null;
    }
    if (!m) {
      m = new THREE.Mesh(g, mat); m.userData.isMix = true;
      if (SHADOWS) {
        const s = new THREE.Mesh(g, shadowMatFor(mat));
        s.renderOrder = 2;
        m.userData.shadow = s;
        scene.add(s);
      }
      scene.add(m); meshes.set(id, m);
    }
    if (m.material !== mat) {
      m.material = mat;
      if (m.userData.shadow) m.userData.shadow.material = shadowMatFor(mat);
    }
    if (m.geometry !== g) m.geometry = g;
    // the shadow silhouette is the 8-dir frame the SUN sees, not the camera's
    if (m.userData.shadow) {
      const fi = DIR8.indexOf(npc.dir8 || "south");
      m.userData.shadowGeom = MIXR.geomFor(def, MIXR.frameFor(DIR8[((fi < 0 ? 0 : fi) - sunState.oct + 8) & 7]));
    }
    m.userData.seen = true; m.visible = true;
    // an NPC on an upper storey is only visible when the player is inside the
    // same building AND up on that storey (otherwise it's behind a floor/roof).
    const lvl = npc.level | 0;
    if (lvl > 0) {
      const o = npc._owns;
      const canSee = o && (player.level | 0) >= lvl &&
        player.x >= o[0] && player.x < o[0] + o[2] && player.y >= o[1] && player.y < o[1] + o[3];
      if (!canSee) { m.visible = false; if (m.userData.shadow) m.userData.shadow.visible = false; return; }
    }
    // interpolated position when walking (fluid, like the player), else the tile centre
    const wx = npc.px != null ? WX(npc.px) : npc.x + 0.5;
    const wz = npc.py != null ? WX(npc.py) : npc.y + 0.5;
    // per-character build (character-stats.js): race/class-driven height & width
    // replace the old subtle fh-measured hs. The geom already carries the fw/fh
    // aspect, so scale.x multiplies width on top of that.
    const _mst = (typeof mixStatsFor === "function") ? mixStatsFor(def) : null;
    const _mh = _mst ? _mst.h : (def.hs || 1), _mw = _mst ? _mst.w : 1;
    if (lying) {
      // flat on the mattress: head to the pillow (beds stand against the north
      // wall, and rotating -90° about X points the sprite's head to -z), body
      // nudged toward the footboard so the headboard reads behind the head.
      // Slightly shortened so even tall folk fit the 1.45-long bed_frame.
      const baseY = liftAt(npc.x, npc.y) + lvl * STOREY_H + FLOOR_T;
      m.position.set(wx, baseY + BED_LIE_Y, wz + 0.32);
      m.rotation.set(-Math.PI / 2, 0, 0);
      const ls = MIX_SCALE * _mh * 0.8;
      m.scale.set(MIX_SCALE * _mw * 0.8, ls, 1);
      if (m.userData.shadow) m.userData.shadow.visible = false;
      return;
    }
    place(m, wx, wz, 1, MIX_SCALE * _mh, false, false, liftAt(npc.x, npc.y) + lvl * STOREY_H);
    m.scale.x = MIX_SCALE * _mw;
  }
  // height of a bed's mattress top above its floor — where sleepers lie
  // (bed_frame/bed_fourposter sprites at the furniture-pass scales)
  const BED_LIE_Y = 0.62;

  // ---- mix NPC population: reskin every shopkeeper as a mix character, and
  // scatter a few wandering mix townsfolk at each nearby village/city (more in
  // cities) plus one quest-giver at every quest-start map icon. Deterministic
  // per site, despawned when the site leaves range. NPCs walk fluidly (the
  // player's tile-to-tile interpolation) within a home radius. ------------------
  const mixKeyed = new Map();      // site key -> [npc,...]
  let mixMeshSeq = 0;
  const MIX_LINES = [
    "Well met, traveller.", "Fine day on the isle, isn't it?",
    "Mind how you go out there.", "New face around here?",
    "The roads have been quiet lately.", "Safe travels, friend.",
    "This world's a big place — easy to get lost.", "Trouble's always brewing somewhere.",
  ];
  const MIX_QUEST_LINES = [
    "You there — I could use some help.", "A word, adventurer? There's work to be done.",
    "You look capable. Perhaps you can aid me.", "Stranger! Fate may have sent you.",
  ];
  function mixHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // ── DETERMINISTIC unique villager characters ─────────────────────────────
  // Villagers are procedurally generated, not ephemeral — the SAME people always
  // live in a given town. So the character (roster index) must be a pure function
  // of a villager's stable identity (its SETTLEMENT + its BUILDING), never of load
  // order. Each settlement gets a contiguous BLOCK of the roster; the villager in
  // building #i takes `blockBase + i`, so every villager in a town is unique and
  // always the same. A bounded, order-free nudge keeps a settlement's block clear
  // of the blocks of EARLIER (canonically) nearby settlements, so two settlements
  // within 1000 tiles don't share a character. (599 chars ≫ villagers/1000-tiles.)
  const MIX_UNIQUE_R2 = 1000 * 1000;
  const _stlBaseCache = new Map();               // memo only — result is position-pure
  function settlementBlockBase(v) {
    const N = MIXR.list.length;
    if (!N) return 0;
    const key = v.x + "," + v.y;
    const memo = _stlBaseCache.get(key);
    if (memo != null) return memo;
    let base = mixHash("stl:" + key) % N;
    const myN = Math.min(N, (v.buildings ? v.buildings.length : 12) + 1);
    // earlier (row-major canonical order) settlements within 1000 tiles, by their
    // RAW hash block (position-pure so no load-order dependence / no recursion)
    const earlier = [];
    let near = [];
    try { near = (world.villagesNearPt && world.villagesNearPt(v.x, v.y, 1100)) || []; } catch (e) { }
    for (const u of near) {
      if (u.x === v.x && u.y === v.y) continue;
      const dx = u.x - v.x, dy = u.y - v.y;
      if (dx * dx + dy * dy > MIX_UNIQUE_R2) continue;
      if (u.y < v.y || (u.y === v.y && u.x < v.x))
        earlier.push([mixHash("stl:" + u.x + "," + u.y) % N, Math.min(N, (u.buildings ? u.buildings.length : 12) + 1)]);
    }
    if (earlier.length) {
      const clash = start => earlier.some(([ub, un]) => {
        for (let a = 0; a < myN; a++) { const d = (((start + a) - ub) % N + N) % N; if (d < un) return true; }
        return false;
      });
      for (let sh = 0; sh < N; sh++) { const s = (base + sh) % N; if (!clash(s)) { base = s; break; } }
    }
    _stlBaseCache.set(key, base);
    return base;
  }
  // Newhaven (and every other settlement) draws its residents/shopkeepers
  // from the SAME mix-roster the tutorial isle's fifteen keepers are pinned
  // to (TUT_TUTORS[].mix, gameplay/tutorial.js) — with no exclusion, a
  // townsfolk NPC could wear a keeper's exact face and name (Phase 7 item 4:
  // the keeper-face collision fix). TOWN_MIX is MIXR.list's indices with the
  // keeper set removed, built once lazily; if the isle module isn't loaded
  // (or the roster's empty), it falls back to the whole list unfiltered —
  // NPCs aren't persisted, so faces in already-generated towns may shift
  // once on next load, which is the bug fix taking effect.
  let _townMix = null;
  function townMixIdx() {
    if (_townMix) return _townMix;
    const N = MIXR.list.length;
    const keep = (typeof Tutorial !== "undefined" && Tutorial.keeperMixIdx) ? new Set(Tutorial.keeperMixIdx()) : null;
    const all = Array.from({ length: N }, (_, k) => k);
    _townMix = (keep && keep.size) ? all.filter(k => !keep.has(k)) : all;
    return _townMix;
  }
  // roster def for the occupant of building index i in settlement v
  function mixDefForBuilding(v, i) {
    const TM = townMixIdx();
    const N = TM.length;
    return MIXR.list[TM[(((settlementBlockBase(v) + i) % N) + N) % N]];
  }
  // find the settlement + building index owning tile (x,y) — for chunk shopkeepers,
  // so a shopkeeper shares the same per-building scheme as the residents around it
  function buildingSlotAt(x, y) {
    if (!world.villagesNearPt) return null;
    let near = [];
    try { near = world.villagesNearPt(x, y, 10) || []; } catch (e) { return null; }
    for (const v of near) {
      if (!v.buildings) continue;
      for (let i = 0; i < v.buildings.length; i++) {
        const b = v.buildings[i];
        if (x >= b.x0 && x < b.x0 + b.w && y >= b.y0 && y < b.y0 + b.h) return { v, i };
      }
    }
    return null;
  }
  function placeMixNpc(def, gx, gy, rng, maxR, radius, quest) {
    for (let a = 0; a < 40; a++) {
      const ang = rng() * Math.PI * 2, rad = 1 + rng() * maxR;
      const tx = Math.round(gx + Math.cos(ang) * rad), ty = Math.round(gy + Math.sin(ang) * rad);
      if (world.isBlocked(tx, ty) || world.isWater(tx, ty)) continue;
      if (world.npcAt && world.npcAt(tx, ty, 0)) continue;    // townsfolk are placed on the ground floor
      if (liftAt(tx, ty) > groundY(tx, ty) + 1.2) continue;   // no rooftops/upper storeys
      const npc = {
        // zone-unique name (world/npc-names.js): a duplicate of def.name in this
        // zone becomes a culturally-similar unused name. Quest-POI givers too.
        name: (typeof NpcNames !== "undefined") ? NpcNames.pick(tx, ty, "npc:" + tx + "," + ty, def.name, (def.key || "").split("__")[0]) : def.name,
        x: tx, y: ty, px: PX(tx), py: PX(ty), look: -1, trader: false,
        mix: def.key, mixTitle: def.title,
        line: quest ? MIX_QUEST_LINES[mixHash(def.key) % MIX_QUEST_LINES.length]
                    : MIX_LINES[mixHash(def.key + ":" + tx) % MIX_LINES.length],
        dir8: DIR8[mixHash(def.key) % 8], _mid: "mix" + (mixMeshSeq++),
        _home: [tx, ty], _r: radius, _wanderAt: performance.now() + 800 + rng() * 4000, _mt: performance.now(),
        _questGiver: !!quest,   // quest-POI NPCs offer quests (gameplay/quests.js)
      };
      world.npcs.push(npc);
      return npc;
    }
    return null;
  }
  // doors an NPC swung open (walking out of / into its building) -> close-time.
  // Closed again once the timer elapses AND no one is standing in the doorway.
  const NPC_DOOR_CLOSE = new Map();
  // one greedy step toward (gx,gy): pick the best of a few directions, swing any
  // door open on the way, and start the tile-to-tile glide. Returns true if a
  // step was taken. Shared by the bedtime walk (and mirrors the lamp task).
  function npcStepToward(npc, gx, gy, T) {
    const cur2 = (npc.x - gx) * (npc.x - gx) + (npc.y - gy) * (npc.y - gy);
    if (cur2 === 0) return false;
    // Only ever take a step that gets STRICTLY closer to the goal, best first.
    // Without a real pathfinder, an NPC that's walled off from its target used to
    // sidestep/backstep to "make progress" and ping-ponged forever (the glitch:
    // villagers pacing back and forth). Refusing non-progress steps means a
    // blocked NPC simply STOPS (return false) — its caller's stuck-counter then
    // abandons the target — instead of jittering. Diagonal steps that net-reduce
    // distance still let it drift around small obstacles.
    const cand = [];
    for (const d of DIR8_DELTA) {
      const dx = d[0], dy = d[1], nx = npc.x + dx, ny = npc.y + dy;
      const nd2 = (nx - gx) * (nx - gx) + (ny - gy) * (ny - gy);
      if (nd2 >= cur2) continue;
      cand.push([nd2, dx, dy]);
    }
    cand.sort((a, b) => a[0] - b[0]);   // closest-reducing step first
    for (const c of cand) {
      const dx = c[1], dy = c[2], tx = npc.x + dx, ty = npc.y + dy;
      if (world.isBlocked(tx, ty) || world.isWater(tx, ty)) continue;
      // upstairs there's no floor beyond the walls — keep to the building interior
      if ((npc.level | 0) > 0 && npc._owns &&
          !(tx > npc._owns[0] && tx < npc._owns[0] + npc._owns[2] - 1 &&
            ty > npc._owns[1] && ty < npc._owns[1] + npc._owns[3] - 1)) continue;
      if (liftAt(tx, ty) > groundY(tx, ty) + 1.2) continue;
      if ((tx === player.x && ty === player.y && (player.level | 0) === (npc.level | 0)) || (world.npcAt && world.npcAt(tx, ty, npc.level))) continue;
      const di = DIR8_DELTA.findIndex(([ex, ey]) => ex === dx && ey === dy);
      if (di >= 0) npc.dir8 = DIR8[di];
      const door = world.doorAt && (world.doorAt(tx, ty) || world.doorAt(npc.x, npc.y));
      if (door && world.isDoorOpen && !world.isDoorOpen(door.x, door.y)) {
        world.setDoorOpen(door.x, door.y, true); NPC_DOOR_CLOSE.set(door.x + "," + door.y, T + 4500);
      }
      npc._lastStep = [dx, dy];
      npc.moving = { fx: npc.x, fy: npc.y, tx, ty, t: 0, dur: 260 }; npc._mt = T;
      return true;
    }
    return false;
  }
  // static (wall/water/rooftop) passability for NPC pathing — same rules as
  // npcStepToward minus the dynamic entity-occupancy check (the pathfinder
  // plans over fixed geometry; live blockers are handled when following).
  function npcTilePassable(npc, tx, ty) {
    if (world.isBlocked(tx, ty) || world.isWater(tx, ty)) return false;
    if ((npc.level | 0) > 0 && npc._owns &&
        !(tx > npc._owns[0] && tx < npc._owns[0] + npc._owns[2] - 1 &&
          ty > npc._owns[1] && ty < npc._owns[1] + npc._owns[3] - 1)) return false;
    if (liftAt(tx, ty) > groundY(tx, ty) + 1.2) return false;
    return true;
  }
  // FIX D: cap how many NPCs run a fresh BFS replan in one frame. Dusk/doorway
  // rushes used to let dozens of NPCs each run a 1600-node BFS on the same frame
  // (the "replan storm"). _npcPathBudget is refilled each frame (top of
  // syncMixNpcs) and decremented per fresh npcPath; NPCs over budget keep their
  // existing path (or wait a tick) and retry next frame — a route computed a
  // frame later is invisible, and no NPC ever teleports or stops permanently.
  const NPC_PATH_BUDGET = 3;
  let _npcPathBudget = NPC_PATH_BUDGET;
  // bounded BFS pathfinder for town NPCs. Door/archway tiles are NOT blocked,
  // so the route naturally threads the one doorway gap in a wall — this is what
  // makes NPCs walk THROUGH doorways instead of the old greedy stepper giving
  // up and the stuck-snap teleporting them across the wall. Diagonals allowed
  // but never cut a wall corner. Returns the step list (excluding the start),
  // [] when already at/adjacent to a blocked goal, or null if unreachable
  // within the node budget. Capped so a walled-off goal can't stall a frame.
  function npcPath(npc, gx, gy) {
    const sx = npc.x, sy = npc.y;
    if (sx === gx && sy === gy) return [];
    const goalBlocked = !npcTilePassable(npc, gx, gy);
    const BUDGET = 1600;
    // FIX D: pack the visited/prev keys as integers RELATIVE to the start tile
    // instead of "x,y" strings — same BFS, no per-node string allocation. At
    // most BUDGET nodes are processed, so no explored tile is more than ~BUDGET+1
    // away from the start; OFF/STRIDE below cover a ±4095-tile window, so the key
    // can never collide regardless of the NPC's absolute world coordinates. prev
    // maps packedKey -> previous packedKey (-1 marks the start). Pathing result
    // is identical to the string-keyed version.
    const OFF = 4096, STRIDE = 16384;
    const packed = (x, y) => (x - sx + OFF) * STRIDE + (y - sy + OFF);
    const START = packed(sx, sy);
    const prev = new Map();
    prev.set(START, -1);
    const q = [[sx, sy]];
    let head = 0, found = null;   // found = [x,y] of the goal (or near-goal) tile
    while (head < q.length && head < BUDGET) {
      const cx = q[head][0], cy = q[head][1]; head++;
      if ((cx === gx && cy === gy) ||
          (goalBlocked && Math.max(Math.abs(cx - gx), Math.abs(cy - gy)) <= 1)) { found = [cx, cy]; break; }
      const ck = packed(cx, cy);
      for (const d of DIR8_DELTA) {
        const nx = cx + d[0], ny = cy + d[1], k = packed(nx, ny);
        if (prev.has(k)) continue;
        if (!npcTilePassable(npc, nx, ny)) continue;
        if (d[0] && d[1] && (!npcTilePassable(npc, cx + d[0], cy) || !npcTilePassable(npc, cx, cy + d[1]))) continue;
        prev.set(k, ck);
        q.push([nx, ny]);
      }
    }
    if (found == null) return null;
    const path = [];
    for (let k = packed(found[0], found[1]); k !== undefined && k !== START; k = prev.get(k)) {
      const a = Math.floor(k / STRIDE), b = k % STRIDE;   // decode packed → world tile
      path.push([a - OFF + sx, b - OFF + sy]);
    }
    path.reverse();
    return path;
  }
  // Walk an NPC to (tx,ty) along a cached BFS route, one animated tile at a
  // time, swinging doors open on the way. Recomputes when the goal changes, the
  // route is consumed, or the next tile is unreachable; waits (never teleports)
  // when a live blocker sits on the next tile, and only recomputes after a short
  // cooldown so a crowded doorway doesn't thrash the pathfinder. Returns true
  // while still en route, false once arrived (or the goal is truly unreachable).
  // Replaces the old greedy-step + wall-crossing snap used by every chokepoint
  // caller (bed / ladder / escort / away-bed).
  function stuckStepToward(npc, key, tx, ty, T) {
    if (npc.x === tx && npc.y === ty) return false;
    const gk = tx + "," + ty;
    let path = npc._path;
    if (!path || npc._pathGoal !== gk || npc._pathI >= path.length) {
      // recompute unless we recently failed to find a route to this same goal
      if (!(npc._pathGoal === gk && npc._pathFailAt && T < npc._pathFailAt)) {
        // FIX D: only a few NPCs replan per frame. Over budget this tick: if an
        // existing path still has steps left, follow it one more tile (identical
        // route, just a frame stale when the goal changed); otherwise wait a tick
        // and retry. Never teleports, never stops for good.
        const canFollowStale = path && npc._pathI < path.length;
        if (_npcPathBudget > 0 || !canFollowStale) {
          if (_npcPathBudget <= 0) return true;   // nothing to follow yet — wait a tick
          _npcPathBudget--;
          npc._path = npcPath(npc, tx, ty); npc._pathGoal = gk; npc._pathI = 0; npc._pathWait = 0;
          npc._pathFailAt = npc._path ? 0 : T + 1200;
        }
        // else: over budget but a usable stale path exists — fall through and follow it
      }
      path = npc._path;
      // no route within the BFS budget (goal far off, or genuinely walled off):
      // fall back to one greedy step so an open-terrain walk still progresses.
      // npcStepToward only ever animates onto a checked adjacent tile — it can
      // never teleport across a wall, so the old wall-snap bug stays gone.
      if (!path) return npcStepToward(npc, tx, ty, T);
      if (!path.length) return false; // already adjacent to a blocked goal
    }
    const step = path[npc._pathI];
    const nx = step[0], ny = step[1];
    // next tile blocked by a live entity? wait for it to clear; after a while
    // give up on this route and replan around the obstacle next tick.
    // FIX G: test the cheap CACHED terrain predicate (npcTilePassable) and the
    // player tile BEFORE the O(n) world.npcAt scan — same OR result, but most
    // tiles short-circuit out without the linear occupancy walk.
    if (!npcTilePassable(npc, nx, ny) ||
        (nx === player.x && ny === player.y && (player.level | 0) === (npc.level | 0)) ||
        (world.npcAt && world.npcAt(nx, ny, npc.level))) {
      if ((npc._pathWait = (npc._pathWait || 0) + 1) > 18) { npc._path = null; npc._pathWait = 0; }
      return true;
    }
    npc._pathWait = 0;
    const dx = nx - npc.x, dy = ny - npc.y;
    const di = DIR8_DELTA.findIndex(([ex, ey]) => ex === dx && ey === dy);
    if (di >= 0) npc.dir8 = DIR8[di];
    const door = world.doorAt && (world.doorAt(nx, ny) || world.doorAt(npc.x, npc.y));
    if (door && world.isDoorOpen && !world.isDoorOpen(door.x, door.y)) {
      world.setDoorOpen(door.x, door.y, true); NPC_DOOR_CLOSE.set(door.x + "," + door.y, T + 4500);
    }
    npc._lastStep = [dx, dy];
    npc.moving = { fx: npc.x, fy: npc.y, tx: nx, ty: ny, t: 0, dur: 260 }; npc._mt = T;
    npc._pathI++;
    return true;
  }
  // Route an NPC to its building's ladder and climb one storey at a time toward
  // targetLevel (the player's own useLadder, but autonomous). Returns true while
  // still busy climbing/walking to the ladder, so the caller skips its own move.
  function npcClimbToward(npc, targetLevel, T, ldsOverride) {
    const cur = npc.level | 0;
    if (cur === targetLevel) return false;
    // per-storey ladder shafts: the leg being climbed is (cur, cur+1) going
    // up or (cur-1, cur) going down — walk to THAT shaft's tile. A legacy
    // single ladder (no .s) serves every leg at one tile. ldsOverride lets a
    // stranded NPC climb an away-bed's ladders without borrowing its (own,
    // unrelated) npc._ladder/_ladders fields.
    const lds = ldsOverride || (npc._ladders && npc._ladders.length ? npc._ladders
      : npc._ladder ? [{ x: npc._ladder[0], y: npc._ladder[1] }] : []);
    if (!lds.length) return false;
    const pair = targetLevel > cur ? cur : cur - 1;
    const ld = lds.find(l => l.s == null || l.s === pair) || lds[0];
    if (npc.x === ld.x && npc.y === ld.y) {             // on the ladder — step a storey
      if (T < npc._wanderAt) return true;
      npc.level = cur + (targetLevel > cur ? 1 : -1);
      npc.px = PX(npc.x); npc.py = PX(npc.y);
      npc._wanderAt = T + 260 + Math.random() * 120;
      return true;
    }
    if (T < npc._wanderAt) return true;
    npc._wanderAt = T + 230 + Math.random() * 150;
    stuckStepToward(npc, "_climbStuck", ld.x, ld.y, T);
    return true;
  }

  // ---- stranded fallback: an NPC with no usable home (or dragged far
  // outside its own leash — the tight wander radius means this is normally
  // unreachable) finds a spare bed elsewhere instead of idling forever.
  // "Fastest route" = straight-line distance, the same proxy gameplay/
  // portals.js's own destination chooser uses — there's no pathfinder here.
  const awayBedClaims = new Map();  // "x,y" bed tile -> the npc that claimed it
  function releaseAwayBed(npc) {
    const ab = npc._awayBed; if (!ab) return;
    const k = ab.x + "," + ab.y;
    if (awayBedClaims.get(k) === npc) awayBedClaims.delete(k);
    npc._awayBed = null;
  }
  // first free, unclaimed bed in settlement v (resident bed formula), skipping
  // trader/bank buildings (owned by their own shopkeeper) and the seeker's
  // own bed. No "inn" building job exists in this engine (job buildings are
  // bank/trader/stations only — inn is a standalone wilderness POI), so
  // there's no inn-preference to apply; first match in building order wins.
  function awayBedInSettlement(v, forNpc) {
    if (!v.buildings) return null;
    for (const b of v.buildings) {
      if (b.job === "trader" || b.job === "bank") continue;
      const bed = b.rooms ? [b.rooms[0].x + 1, b.rooms[0].y + 1] : [b.x0 + (b.w >> 1) - 1, b.y0 + 1];
      if (forNpc._bed && bed[0] === forNpc._bed[0] && bed[1] === forNpc._bed[1]) continue;
      const claim = awayBedClaims.get(bed[0] + "," + bed[1]);
      if (claim && claim !== forNpc) continue;
      const bm = world.buildingMeta ? world.buildingMeta(b) : null;
      const storeys = (bm && bm.storeys) || 1;
      const ladders = storeys > 1 ? (bm.ladders && bm.ladders.length ? bm.ladders
        : bm.ladder ? [{ x: bm.ladder.x, y: bm.ladder.y }] : null) : null;
      return { x: bed[0], y: bed[1], level: storeys > 1 ? storeys - 1 : 0, ladders };
    }
    return null;
  }
  // poisNearForMap mixes two coordinate scales: wild lattice portals in MAP
  // units (need ×2) and each city's injected guaranteed portal already in
  // GAME units (features.js villageInfo's v.portal) — resolve by matching
  // against the known cities' own v.portal, falling back to ×2 otherwise.
  function portalGameXY(p, cities) {
    for (const v of cities) if (v.portal && v.portal.x === p.x && v.portal.y === p.y) return [v.portal.x, v.portal.y];
    return [p.x * 2, p.y * 2];
  }
  // free NPC-equivalent of gameplay/portals.js portalTravel: no rune cost, no
  // log/sfx/save (player-only), same ring-search for an open landing tile.
  function npcPortalJump(npc, px2, py2) {
    world.getChunk(Math.floor(px2 / world.CHUNK), Math.floor(py2 / world.CHUNK));
    let tx = px2, ty = py2 + 1;
    outer: for (let r = 1; r <= 4; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const ax = px2 + dx, ay = py2 + dy;
          if (!world.isBlocked(ax, ay) && !world.isWater(ax, ay)) { tx = ax; ty = ay; break outer; }
        }
    npc.x = tx; npc.y = ty; npc.px = PX(tx); npc.py = PX(ty);
    npc.level = 0; npc.moving = null;
  }
  // compares exactly two routes (walk vs portal), both straight-line-cost
  // proxies, and picks whichever resolves cheaper (or whichever resolves at
  // all). Portals are free for NPCs — only the two walking legs cost anything.
  function npcFindAwayBed(npc) {
    const near = (world.villagesNearPt && world.villagesNearPt(npc.x, npc.y, 2000)) || [];
    const cities = near.filter(v => v.kind === "city");
    let best = null, bestD = Infinity;
    for (const v of near) {
      if (v.kind !== "city" && v.kind !== "village") continue;
      const spare = awayBedInSettlement(v, npc);
      if (!spare) continue;
      const d = Math.hypot(npc.x - spare.x, npc.y - spare.y);
      if (d < bestD) { bestD = d; best = { ...spare, viaPortal: false }; }
    }
    let entry = null, entryD = Infinity;
    try {
      const mx = npc.x / 2, my = npc.y / 2, pad = 1000;
      for (const p of world.poisNearForMap(mx - pad, my - pad, mx + pad, my + pad, pad)) {
        if (p.type !== "portal") continue;
        const [gx, gy] = portalGameXY(p, cities);
        const d = Math.hypot(npc.x - gx, npc.y - gy);
        if (d < entryD) { entryD = d; entry = { x: gx, y: gy }; }
      }
    } catch (e) { /* feature queries must never break a frame */ }
    if (entry) {
      let exitSpare = null, exitPortal = null, exitD = Infinity;
      for (const v of cities) {
        if (!v.portal) continue;
        const spare = awayBedInSettlement(v, npc);
        if (!spare) continue;
        const d = Math.hypot(v.portal.x - spare.x, v.portal.y - spare.y);
        if (d < exitD) { exitD = d; exitSpare = spare; exitPortal = v.portal; }
      }
      const total = entryD + exitD;
      if (exitSpare && total < bestD) {
        best = { ...exitSpare, viaPortal: true, portalEntry: entry, portalExit: exitPortal };
        bestD = total;
      }
    }
    return best;
  }
  // bedtime routing for an NPC whose own bed/home isn't usable: walk (or
  // portal-hop) to npc._awayBed, computed once and cached — retried at most
  // every 8s on failure so an unreachable NPC doesn't re-scan every frame.
  function stepAwayBed(npc, T) {
    if (!npc._awayBed && (npc._awayBedAt == null || T > npc._awayBedAt + 8000)) {
      npc._awayBedAt = T;
      npc._awayBed = npcFindAwayBed(npc);
    }
    const ab = npc._awayBed;
    if (!ab) return;                                  // nothing in range — stand put
    const k = ab.x + "," + ab.y;
    if (!awayBedClaims.has(k)) awayBedClaims.set(k, npc);
    if (ab.viaPortal && !ab.jumped) {
      if ((npc.level | 0) > 0) { npcClimbToward(npc, 0, T); return; }
      if (Math.max(Math.abs(npc.x - ab.portalEntry.x), Math.abs(npc.y - ab.portalEntry.y)) <= 1) {
        npcPortalJump(npc, ab.portalExit.x, ab.portalExit.y);
        ab.jumped = true; return;
      }
      if (T < npc._wanderAt) return;
      npc._wanderAt = T + 240 + Math.random() * 140;
      stuckStepToward(npc, "_awayStuck", ab.portalEntry.x, ab.portalEntry.y, T);
      return;
    }
    if ((npc.level | 0) !== (ab.level | 0)) {
      if (npcClimbToward(npc, ab.level, T, ab.ladders)) return;
    }
    if (npc.x === ab.x && npc.y === ab.y) return;        // in bed — stand
    if (T < npc._wanderAt) return;
    npc._wanderAt = T + 240 + Math.random() * 140;
    stuckStepToward(npc, "_awayStuck", ab.x, ab.y, T);
  }
  function stepMixNpc(npc) {
    const T = performance.now();
    if (npc.moving) {
      const m = npc.moving;
      m.t += Math.min(200, T - (npc._mt || T)) / m.dur;
      npc._mt = T;
      if (m.t >= 1) {
        npc.x = m.tx; npc.y = m.ty; npc.px = PX(m.tx); npc.py = PX(m.ty); npc.moving = null;
      } else {
        npc.px = PX(m.fx) + (PX(m.tx) - PX(m.fx)) * m.t;
        npc.py = PX(m.fy) + (PX(m.ty) - PX(m.fy)) * m.t;
      }
      return;
    }
    // multiplayer (js/net/entsync.js): another client is this NPC's proximity
    // authority — it drives the wander; we only replay the synced steps above
    if (npc._remoteUntil && T < npc._remoteUntil) return;
    // chase: beeline toward the PLAYER's live tile (not a fixed spot) until
    // close enough to talk, then hand off to Tutorial — Tūhura Isle's Guide
    // walking up to a fresh spark the moment they wash ashore (user req),
    // rather than the old "pop the dialogue regardless of distance" welcome.
    if (npc._approachPlayer) {
      if (Math.hypot(player.x - npc.x, player.y - npc.y) <= 2.2) {
        npc._approachPlayer = false; npc._approachStuck = 0;
        if (typeof Tutorial !== "undefined" && Tutorial.onApproachArrive) Tutorial.onApproachArrive(npc);
        return;
      }
      if (T < npc._wanderAt) return;
      npc._wanderAt = T + 220 + Math.random() * 100;
      stuckStepToward(npc, "_approachStuck", player.x, player.y, T);
      return;
    }
    // escort: walk to an arbitrary tile/storey, highest priority (Tūhura
    // Isle's Sigrid sequence, gameplay/tutorial.js) — properly climbs via
    // npcClimbToward (unlike the lamp task below, which only ever targets
    // street level), and notifies Tutorial on arrival instead of just
    // clearing silently.
    if (npc._escortTarget) {
      const [gx0, gy0, glevel0] = npc._escortTarget;
      if ((npc.level | 0) !== (glevel0 | 0)) { npcClimbToward(npc, glevel0, T); return; }
      if (npc.x === gx0 && npc.y === gy0) {
        npc._escortTarget = null; npc._escortStuck = 0;
        // Lua routine NPCs (js/lua) use _escortTarget too; their arrival is
        // awaited by the coroutine (via the target clearing), so don't route
        // them through the tutorial's escort-arrival hook.
        if (!npc._luaRoutine && typeof Tutorial !== "undefined" && Tutorial.onEscortArrive) Tutorial.onEscortArrive(npc);
        return;
      }
      if (T < npc._wanderAt) return;
      npc._wanderAt = T + 220 + Math.random() * 100;
      stuckStepToward(npc, "_escortStuck", gx0, gy0, T);
      return;
    }
    // lamplighter task: stride toward a candle spot / the store, ignoring the
    // usual home-radius leash. Greedy step with fallbacks; abandons if stuck.
    if (npc._lampTarget) {
      if ((npc.level | 0) > 0) { npcClimbToward(npc, 0, T); return; } // candles are placed at street level
      const gx = npc._lampTarget[0], gy = npc._lampTarget[1];
      if (Math.abs(gx - npc.x) <= 1 && Math.abs(gy - npc.y) <= 1) {   // arrived
        npc._lampTarget = null; npc._lampArrived = true; npc._lampStuck = 0; npc._wanderAt = T + 300 + Math.random() * 600; return;
      }
      if (T < npc._wanderAt) return;
      npc._wanderAt = T + 230 + Math.random() * 150;                  // brisk pace
      // shared progress-scored stepper (no ping-pong); count stuck frames so an
      // unreachable candle spot is abandoned rather than paced against forever.
      if (npcStepToward(npc, gx, gy, T)) npc._lampStuck = 0;
      else { npc._lampStuck = (npc._lampStuck || 0) + 1; if (npc._lampStuck > 8) { npc._lampTarget = null; npc._lampStuck = 0; } }
      return;
    }
    // Lua routine NPCs (js/lua): their coroutine makes every decision below
    // (wander, bedtime, climb-down) by setting _escortTarget, handled by the
    // escort branch above. Skip the built-in JS wander/bedtime so the two don't
    // fight. Locomotion (moving/escort/lamp) above still runs.
    if (npc._luaRoutine) return;
    // bedtime (20:00–04:00): head home and stand on the bed (residents) or the
    // home post (shopkeepers), instead of wandering. Overrides the idle wander.
    if (typeof isBedtime === "function" && isBedtime(npc.x)) {   // NPC's own timezone
      // stranded (no home, or dragged outside its own leash — the tight
      // wander radius means this basically never fires today): find/walk a
      // spare bed elsewhere instead of falling through to the code below.
      if (!npc._home || Math.hypot(npc.x - npc._home[0], npc.y - npc._home[1]) > (npc._r || 6) * 4) {
        stepAwayBed(npc, T); return;
      }
      if (npc._awayBed) releaseAwayBed(npc);   // back within its own leash — drop the stale claim
      const bed = npc._bed || npc._home;
      const bedLv = npc._bedLevel | 0;
      if (bed) {
        const home = npc._owns;
        const inHome = home && npc.x >= home[0] && npc.x < home[0] + home[2] && npc.y >= home[1] && npc.y < home[1] + home[3];
        // the bedroom may be upstairs (2-storey shop/station homes): walk IN
        // through the doorway first, then climb to the bed's storey, then to the
        // bed. The BFS pathfinder threads the doorway on its own, so we route to
        // a real passable tile (the ladder base when there's an upstairs, else
        // the bed) rather than guessing a door-approach tile.
        if ((npc.level | 0) !== bedLv) {
          if ((npc.level | 0) === 0 && home && !inHome) {            // still outside — walk in to the ladder
            if (T >= npc._wanderAt) {
              npc._wanderAt = T + 240 + Math.random() * 140;
              const lad = npc._ladder || (npc._ladders && npc._ladders[0] && [npc._ladders[0].x, npc._ladders[0].y]);
              const into = lad || bed;
              stuckStepToward(npc, "_bedStuck", into[0], into[1], T);
            }
            return;
          }
          if (npcClimbToward(npc, bedLv, T)) return;                 // route to ladder & climb
        }
        if ((npc.level | 0) === bedLv && npc.x === bed[0] && npc.y === bed[1]) return; // in bed — stand
        if (T < npc._wanderAt) return;
        npc._wanderAt = T + 240 + Math.random() * 140;               // brisk walk home
        if (!stuckStepToward(npc, "_bedStuck", bed[0], bed[1], T)) {   // arrived, or unreachable this tick
          if (inHome || Math.max(Math.abs(npc.x - bed[0]), Math.abs(npc.y - bed[1])) <= 1) return; // settle at home
        }
        return;
      }
    }
    if (npc._awayBed) releaseAwayBed(npc);   // bedtime's over — free the bed for someone else
    // daytime: if we slept upstairs, climb back down before resuming the wander
    if ((npc.level | 0) > 0) { npcClimbToward(npc, 0, T); return; }
    if (T < npc._wanderAt) return;
    npc._wanderAt = T + 1600 + Math.random() * 5000;
    if (Math.random() < 0.5) return;                    // often just stand
    const dx = (Math.random() * 3 | 0) - 1, dy = (Math.random() * 3 | 0) - 1;
    if (!dx && !dy) return;
    const tx = npc.x + dx, ty = npc.y + dy;
    if (Math.abs(tx - npc._home[0]) > npc._r || Math.abs(ty - npc._home[1]) > npc._r) return;
    if (world.isBlocked(tx, ty) || world.isWater(tx, ty)) return;
    if (liftAt(tx, ty) > groundY(tx, ty) + 1.2) return;
    if ((tx === player.x && ty === player.y && (player.level | 0) === (npc.level | 0)) || (world.npcAt && world.npcAt(tx, ty, npc.level))) return;
    const di = DIR8_DELTA.findIndex(([ex, ey]) => ex === dx && ey === dy);
    if (di >= 0) npc.dir8 = DIR8[di];
    // swing open a door in the NPC's path — stepping onto it (or off it) as it
    // walks out of / back into the building it lives in. Auto-closed later.
    const door = world.doorAt && (world.doorAt(tx, ty) || world.doorAt(npc.x, npc.y));
    if (door && world.isDoorOpen && !world.isDoorOpen(door.x, door.y)) {
      world.setDoorOpen(door.x, door.y, true);
      NPC_DOOR_CLOSE.set(door.x + "," + door.y, T + 4500);
    }
    npc.moving = { fx: npc.x, fy: npc.y, tx, ty, t: 0, dur: 300 };
    npc._mt = T;
  }
  // close any NPC-opened doors whose timer has elapsed, unless someone is still
  // standing in the doorway (retry shortly).
  function tickNpcDoors(T) {
    if (!NPC_DOOR_CLOSE.size || !world.setDoorOpen) return;
    for (const [k, closeT] of NPC_DOOR_CLOSE) {
      if (T < closeT) continue;
      const c = k.indexOf(","), dx = +k.slice(0, c), dy = +k.slice(c + 1);
      if ((player.x === dx && player.y === dy) || (world.npcAt && world.npcAt(dx, dy, 0))) { NPC_DOOR_CLOSE.set(k, T + 1500); continue; }
      world.setDoorOpen(dx, dy, false);
      NPC_DOOR_CLOSE.delete(k);
    }
  }
  // hand out lamplighter jobs against the REAL candle spots. At dusk ("place")
  // a villager walks to the storage room, picks up a candle stand, carries it
  // to a specific unlit spot and SETS IT DOWN — the stand + its light appear at
  // that moment (lampSpotSet). At dawn ("collect") they walk out to a standing
  // stand, pick it up (it vanishes) and carry it back inside. Each villager
  // keeps a target until it arrives (cleared in stepMixNpc, which raises
  // _lampArrived), then gets its next leg here. `_lamp` = carried-flame glow;
  // `_lampCarry` = the stand object visibly in their hands.
  const _lampClaims = new Map();   // "x,y" → spot currently assigned to a villager
  function _lampReset(npc) {
    if (npc._lampClaimKey) { _lampClaims.delete(npc._lampClaimKey); npc._lampClaimKey = null; }
    npc._lamp = false; npc._lampTarget = null; npc._lampLeg = null;
    npc._lampCarry = null; npc._lampSpot = null; npc._lampArrived = false;
  }
  function assignLampTasks() {
    const mode = (typeof lampMode === "function") ? lampMode() : null;
    const setl = mode && (typeof currentSettlement === "function") ? currentSettlement() : null;
    if (!mode || !setl) {
      if (_lampClaims.size) _lampClaims.clear();
      for (const npc of world.npcs) if (npc._lamp || npc._lampLeg || npc._lampCarry) _lampReset(npc);
      return;
    }
    const v = setl.v, store = setl.store;
    // outdoor spots still needing work this twilight (unclaimed): at dusk the
    // not-yet-delivered ones, at dawn the ones still standing out
    const pending = [];
    if (typeof villageCandleSpots === "function" && typeof lampSpotPlaced === "function")
      for (const s of villageCandleSpots(v)) {
        if (s.inside) continue;                            // residents light their own homes
        const st = lampSpotPlaced(v, s.x, s.y);
        const done = mode === "place" ? st === true : st === false;
        if (!done && !_lampClaims.has(s.x + "," + s.y)) pending.push(s);
      }
    const claim = (npc) => {       // nearest pending spot to this villager
      let best = null, bd = Infinity;
      for (const s of pending) {
        if (_lampClaims.has(s.x + "," + s.y)) continue;
        const d = Math.abs(s.x - npc.x) + Math.abs(s.y - npc.y);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) { _lampClaims.set(best.x + "," + best.y, best); npc._lampClaimKey = best.x + "," + best.y; }
      return best;
    };
    for (const npc of world.npcs) {
      if (!npc._home) continue;
      // a villager already asleep in bed sleeps through the candle rounds —
      // whoever is still up works the streets (short summer nights can push
      // dusk past bedtime, and dawn gathering can start before 04:00)
      if (typeof npcAsleep === "function" && npcAsleep(npc)) {
        if (npc._lamp || npc._lampLeg || npc._lampCarry) _lampReset(npc);
        continue;
      }
      if (Math.hypot(npc.x - v.x, npc.y - v.y) > v.R + 6) { if (npc._lampLeg || npc._lamp) _lampReset(npc); continue; }
      // store legs land "close enough": the store tile is INSIDE a building, and
      // two dozen villagers can't all stand on it — reaching the yard will do
      if (npc._lampTarget && (npc._lampLeg === "restock" || npc._lampLeg === "return") &&
          Math.hypot(npc.x - store.x, npc.y - store.y) < 4) { npc._lampTarget = null; npc._lampArrived = true; }
      if (npc._lampTarget) continue;                       // still walking this leg
      const arrived = npc._lampArrived; npc._lampArrived = false;
      // finish the leg that just ended. Villagers work an ARMFUL at a time —
      // they leave the store with several stands and place them one after
      // another (and gather several before walking back) instead of a full
      // store round-trip per candle, or the big towns would never get lit.
      const ARMFUL = 6;
      if (npc._lampLeg === "deliver") {
        if (npc._lampClaimKey) { _lampClaims.delete(npc._lampClaimKey); npc._lampClaimKey = null; }
        if (arrived && npc._lampSpot && typeof lampSpotSet === "function") {
          // the stand is set down HERE — it pops into the world, lit
          lampSpotSet(v, npc._lampSpot[0], npc._lampSpot[1], true);
          npc._lampLoad = Math.max(0, (npc._lampLoad || 1) - 1);
        }
        npc._lampSpot = null;
        const next = npc._lampLoad > 0 ? claim(npc) : null;
        if (next) {                                        // still stands in the armful: straight on
          npc._lampSpot = [next.x, next.y, next.stand];
          npc._lampCarry = next.stand || npc._lampCarry;
          npc._lampTarget = [next.x, next.y];              // leg stays "deliver"
        } else {
          npc._lamp = false; npc._lampCarry = null; npc._lampLoad = 0;
          npc._lampTarget = [store.x, store.y]; npc._lampLeg = "restock";
        }
        continue;
      }
      if (npc._lampLeg === "goget") {
        if (npc._lampClaimKey) { _lampClaims.delete(npc._lampClaimKey); npc._lampClaimKey = null; }
        if (arrived && npc._lampSpot && typeof lampSpotSet === "function") {
          // picked up: the stand vanishes from the street and rides home in hand
          lampSpotSet(v, npc._lampSpot[0], npc._lampSpot[1], false);
          npc._lamp = true; npc._lampCarry = npc._lampSpot[2] || npc._lampCarry || null;
          npc._lampLoad = (npc._lampLoad || 0) + 1;
          npc._lampSpot = null;
          const next = npc._lampLoad < ARMFUL ? claim(npc) : null;
          if (next) { npc._lampSpot = [next.x, next.y, next.stand]; npc._lampTarget = [next.x, next.y]; }   // gather more
          else { npc._lampTarget = [store.x, store.y]; npc._lampLeg = "return"; }
          continue;
        }
        npc._lampSpot = null;                              // unreachable — try another below
      }
      if (npc._lampLeg === "return" || npc._lampLeg === "restock") {
        npc._lampLeg = null; npc._lamp = false; npc._lampCarry = null; npc._lampLoad = 0;
      }
      // idle: hand out the next job
      const nearStore = Math.hypot(npc.x - store.x, npc.y - store.y) < 5;
      const s = claim(npc);
      if (!s) { if (npc._lamp || npc._lampCarry) { npc._lamp = false; npc._lampCarry = null; } continue; }
      if (mode === "place") {
        if (!nearStore) {                                  // must fetch from the store first
          _lampClaims.delete(npc._lampClaimKey); npc._lampClaimKey = null;   // don't hold it while detouring
          npc._lampTarget = [store.x, store.y]; npc._lampLeg = "restock";
        } else {                                           // an armful of stands, off to the first spot
          npc._lampSpot = [s.x, s.y, s.stand];
          npc._lamp = true; npc._lampCarry = s.stand || null; npc._lampLoad = ARMFUL;
          npc._lampTarget = [s.x, s.y]; npc._lampLeg = "deliver";
        }
      } else {                                             // dawn: go gather them off the street
        npc._lampSpot = [s.x, s.y, s.stand];
        npc._lamp = false; npc._lampCarry = null; npc._lampLoad = 0;
        npc._lampTarget = [s.x, s.y]; npc._lampLeg = "goget";
      }
    }
  }
  // FIX C: throttle state for the settlement-membership management inside
  // syncMixNpcs. _mixMgmtCell starts null so the first call always runs.
  let _mixMgmtCell = null, _mixMgmtAt = 0;
  function syncMixNpcs() {
    if (!MIXR.ok || !MIXR.list.length) return;
    // FIX D: refill the per-frame BFS replan budget before any NPC steps below.
    _npcPathBudget = NPC_PATH_BUDGET;
    // FIX C: the settlement-membership management below (shop-tagging every
    // world.npc, the villagesNear/iconsNear spawn queries, and the O(n²) owner
    // reconciliation) only changes as the player crosses into new terrain or on
    // the order of seconds. Re-run it only when the player enters a new ~8-tile
    // cell, with a ~300ms safety net so a stationary player still picks up a
    // shopkeeper that just chunk-loaded. The first visit to a cell (and the very
    // first call — _mixMgmtCell starts null) runs immediately so NPCs populate
    // with no visible delay. Per-NPC movement (stepMixNpc) and door ticking run
    // EVERY frame below, unthrottled, so motion stays frame-smooth. (The gated
    // block keeps its original indentation to minimise the diff / regression risk.)
    const _mnow = performance.now();
    const _mcell = (player.x >> 3) + "," + (player.y >> 3);
    if (_mcell !== _mixMgmtCell || _mnow >= _mixMgmtAt) {
    _mixMgmtCell = _mcell;
    _mixMgmtAt = _mnow + 300;
    // 1) every shopkeeper (and main-branch banker) becomes a mix character
    //    (appearance only; keeps its trader/banker role, name and shop).
    //    These are placed/removed by the chunk system, so we just tag any we
    //    haven't yet.
    // the main bank hall seats up to 3 clerks in the ONE building — offset
    // each later clerk's bed off the first so they don't all claim one tile
    const shopBedOcc = new Map();
    for (const npc of world.npcs) {
      if ((npc.trader || npc.banker) && !npc.mix) {
        const h = mixHash("shop:" + npc.x + "," + npc.y);
        // share the residents' per-building scheme: the shopkeeper of building #i
        // in settlement v gets `blockBase(v)+i`, unique among that town's people
        const slot = buildingSlotAt(npc.x, npc.y);
        // bankers share a building, so the per-building def would clone them —
        // they draw from the plain position hash instead
        const def = slot && !npc.banker ? mixDefForBuilding(slot.v, slot.i) : MIXR.list[h % MIXR.list.length];
        npc.mix = def.key;
        npc._shopName = npc.name;          // keep original label for the shop/market
        // zone-unique name (world/npc-names.js), culturally-similar on collision
        npc.name = (typeof NpcNames !== "undefined") ? NpcNames.pick(npc.x, npc.y, "npc:" + npc.x + "," + npc.y, def.name, (def.key || "").split("__")[0]) : def.name;
        npc.mixTitle = npc.banker ? "banker" : def.title;
        npc.dir8 = DIR8[h % 8];
        npc.px = PX(npc.x); npc.py = PX(npc.y);
        npc._mid = "shopmix" + npc.x + "_" + npc.y;
        // shopkeepers now potter about their post too — a wide-enough radius to
        // reach the doorway and step outside (opening the door) and back in.
        // Bankers hold their counter instead of roaming the hall.
        npc._home = [npc.x, npc.y]; npc._r = npc.banker ? 2 : 6;
        npc._wanderAt = performance.now() + 1200 + (h % 4000); npc._mt = performance.now();
        // the owner's bedroom upstairs (buildingMeta forces storeys>=2 for any
        // job building) — same bed formula the resident loop below uses, so a
        // shopkeeper sleeping over the shop renders lying down like everyone else
        const b = slot && slot.v.buildings[slot.i];
        if (b) {
          const bm = world.buildingMeta ? world.buildingMeta(b) : null;
          const storeys = (bm && bm.storeys) || 1;
          const bkey = slot.v.x + "," + slot.v.y + ":" + slot.i;
          const occ = shopBedOcc.get(bkey) || 0; shopBedOcc.set(bkey, occ + 1);
          const base = b.rooms ? [b.rooms[0].x + 1, b.rooms[0].y + 1]
            : [b.x0 + (b.w >> 1) - 1, b.y0 + 1];
          npc._bed = [base[0] + occ, base[1]];
          npc._bedLevel = storeys > 1 ? storeys - 1 : 0;
          if (storeys > 1 && bm.ladder) npc._ladder = [bm.ladder.x, bm.ladder.y];
          if (storeys > 1 && bm.ladders) npc._ladders = bm.ladders;
        }
      }
    }
    // 2) ambient townsfolk + quest-givers at nearby sites (map coords)
    // map coords are half game-tile scale, so viewRadius/2 keeps townsfolk
    // populated out to the view edges when zoomed out near a settlement
    const mx = player.x / 2, my = player.y / 2, R = Math.max(26, Math.ceil(viewRadius() / 2));
    const wanted = new Map();
    try {
      for (const v of world.villagesNearForMap(mx - R, my - R, mx + R, my + R, 20))
        wanted.set("v:" + v.x + "," + v.y, { kind: "village", city: v.kind === "city",
          x: Math.round(v.x * 2), y: Math.round(v.y * 2) });
      if (world.iconsNearForMap)
        for (const ic of world.iconsNearForMap(mx - R, my - R, mx + R, my + R))
          if (ic.type === "quest")
            wanted.set("q:" + ic.x + "," + ic.y, { kind: "quest", x: Math.round(ic.x * 2), y: Math.round(ic.y * 2) });
    } catch (e) { /* feature queries must never break a frame */ }

    for (const [key, listc] of mixKeyed) {
      if (wanted.has(key)) continue;
      for (const npc of listc) {
        const i = world.npcs.indexOf(npc);
        if (i >= 0) world.npcs.splice(i, 1);
        const mm = meshes.get(npc._mid);
        if (mm) { scene.remove(mm); if (mm.userData.shadow) scene.remove(mm.userData.shadow); meshes.delete(npc._mid); }
      }
      mixKeyed.delete(key);
    }
    for (const [key, site] of wanted) {
      if (mixKeyed.has(key)) continue;
      const h = mixHash(key), rng = mulberry32(h), listc = [];
      if (site.kind === "village") {
        // ONE RESIDENT PER BUILDING — each villager owns & wanders their own
        // building. Trader/bank buildings are owned by their chunk shopkeeper;
        // every other building (stations + plain houses) gets a resident.
        let v = null;
        if (world.villagesNearPt) {
          const near = world.villagesNearPt(site.x, site.y, 6);
          v = near.find(vv => Math.abs(vv.x - site.x) <= 3 && Math.abs(vv.y - site.y) <= 3) || near[0];
        }
        const vbuild = (v && v.buildings) || [];
        // Hand-authored quest-givers (world/quest-anchors.js — Ranger Ash,
        // Cook Bess, Archivist Wren, etc.) are rooted extras pushed straight
        // into world.npcs by chunks.js deriveNpcs, not spawned by the
        // resident loop below, so they never got a `_bed` and stood frozen
        // at their plaza spot after dark. Claim each one its OWN nearest
        // non-trader/bank building in THIS village BEFORE the resident loop
        // runs (same exclusion as trader/bank, so no ambient resident also
        // gets spawned there and no bed is shared) — distance-capped so this
        // only ever matches a building in the giver's own settlement.
        const giverClaims = new Map(); // building -> giver npc
        if (typeof QUEST_GIVERS !== "undefined") {
          const claimedBuildings = new Set();
          for (const g of QUEST_GIVERS) {
            const gn = world.npcs.find(n => n._script === g.script);
            if (!gn || gn._owns) continue;
            let best = null, bestD = 30;
            for (const b of vbuild) {
              if (b.job === "trader" || b.job === "bank" || claimedBuildings.has(b)) continue;
              const d = Math.hypot((b.x0 + (b.w >> 1)) - gn.x, (b.y0 + (b.h >> 1)) - gn.y);
              if (d < bestD) { bestD = d; best = b; }
            }
            if (best) { claimedBuildings.add(best); giverClaims.set(best, gn); }
          }
        }
        for (let bIdx = 0; bIdx < vbuild.length; bIdx++) {
          const b = vbuild[bIdx];
          if (b.job === "trader" || b.job === "bank") continue;   // owned by the chunk shopkeeper/banker
          // owned by a hand-authored quest-giver (claimed just above) — same
          // bed/owns assignment as an ambient resident, but no resident is
          // spawned here; the giver itself moves in.
          const giver = giverClaims.get(b);
          if (giver) {
            giver._owns = [b.x0, b.y0, b.w, b.h];
            giver._ownsRooms = b.rooms || null;
            const bmg = world.buildingMeta ? world.buildingMeta(b) : null;
            const gstoreys = (bmg && bmg.storeys) || 1;
            giver._bed = b.rooms ? [b.rooms[0].x + 1, b.rooms[0].y + 1]
              : [b.x0 + (b.w >> 1) - 1, b.y0 + 1];
            giver._bedLevel = gstoreys > 1 ? gstoreys - 1 : 0;
            if (gstoreys > 1 && bmg.ladder) giver._ladder = [bmg.ladder.x, bmg.ladder.y];
            if (gstoreys > 1 && bmg.ladders) giver._ladders = bmg.ladders;
            continue;
          }
          // skip if an NPC (e.g. a station keeper) already stands inside this
          // footprint. Organic row-house BBOXES overlap on shared wall lines —
          // test the actual ROOMS, or a neighbour's keeper suppresses (and the
          // reconciliation below evicts) this building's rightful resident.
          const inFoot = (nx, ny) => b.rooms
            ? b.rooms.some(r => nx >= r.x && nx < r.x + r.w && ny >= r.y && ny < r.y + r.h)
            : nx >= b.x0 && nx < b.x0 + b.w && ny >= b.y0 && ny < b.y0 + b.h;
          if (world.npcs.some(n => inFoot(n.x, n.y))) continue;
          // just inside the door — organic multi-room records carry the door
          let cx, cy;
          if (b.rooms && b.door) {
            cx = b.door.x + (b.door.angle === 0 ? 1 : b.door.angle === 2 ? -1 : 0);
            cy = b.door.y + (b.door.angle === 1 ? 1 : b.door.angle === 3 ? -1 : 0);
          } else { cx = b.x0 + (b.w >> 1); cy = b.y0 + b.h - 2; }
          // per-building deterministic character: blockBase(v)+bIdx, unique within
          // the town and stable forever (the same person always lives here)
          const def = mixDefForBuilding(v, bIdx);
          const npc = placeMixNpc(def, cx, cy, rng, 2, Math.max(3, Math.max(b.w, b.h)), false);
          if (npc) {
            npc._owns = [b.x0, b.y0, b.w, b.h];
            npc._ownsRooms = b.rooms || null; // exact footprint (bboxes overlap between row-houses)
            npc._bjob = b.job || null;   // the building's trade — drives dialogue role (npc-chat.js)
            // the resident's bed tile (matches buildStruct's furnishing: slots[0]
            // = back-wall centre interior tile). They walk here and stand on it at
            // night (isBedtime). For 2-storey shop/station homes the bedroom is
            // UPSTAIRS, so the bed sits on the top storey and the resident climbs
            // the ladder to reach it (npcClimbToward).
            const bm = world.buildingMeta ? world.buildingMeta(b) : null;
            const storeys = (bm && bm.storeys) || 1;
            npc._bed = b.rooms ? [b.rooms[0].x + 1, b.rooms[0].y + 1]
              : [b.x0 + (b.w >> 1) - 1, b.y0 + 1];
            npc._bedLevel = storeys > 1 ? storeys - 1 : 0;
            if (storeys > 1 && bm.ladder) npc._ladder = [bm.ladder.x, bm.ladder.y];
            if (storeys > 1 && bm.ladders) npc._ladders = bm.ladders; // per-storey shafts
            listc.push(npc);
          }
        }
      } else {
        const def = MIXR.list[h % MIXR.list.length];               // quest-start icon: a single quest-giver (isolated POI — plain deterministic hash)
        const npc = placeMixNpc(def, site.x, site.y, rng, 3, 3, true);
        if (npc) listc.push(npc);
      }
      mixKeyed.set(key, listc);
    }
    // 2.4) one-owner-per-building: a resident may have spawned before its
    //    building's shopkeeper chunk-loaded. If a trader now stands in a
    //    resident's footprint, the shopkeeper owns it — retire the resident.
    for (const [, listc] of mixKeyed) {
      for (let i = listc.length - 1; i >= 0; i--) {
        const n = listc[i]; if (!n._owns) continue;
        const bx = n._owns[0], by = n._owns[1], bw = n._owns[2], bh = n._owns[3];
        const inOwned = (ox, oy) => n._ownsRooms
          ? n._ownsRooms.some(r => ox >= r.x && ox < r.x + r.w && oy >= r.y && oy < r.y + r.h)
          : ox >= bx && ox < bx + bw && oy >= by && oy < by + bh;
        if (world.npcs.some(o => o !== n && o.trader && inOwned(o.x, o.y))) {
          const gi = world.npcs.indexOf(n); if (gi >= 0) world.npcs.splice(gi, 1);
          const mm = meshes.get(n._mid); if (mm) { scene.remove(mm); if (mm.userData.shadow) scene.remove(mm.userData.shadow); meshes.delete(n._mid); }
          listc.splice(i, 1);
        }
      }
    }
    }   // FIX C: end throttled settlement-membership management (sections 1–2.4)
    // 2.5) lamplighters: at dusk the townsfolk carry candles out from the store
    //    and fan across the settlement; at dawn they gather back to it. Candle
    //    lighting itself is time-driven (daynight.settlementLights) so it stays
    //    consistent when you're away; this just animates the villagers doing it.
    // Lamplighting is now driven by the Lua villager routine
    // (scripts/routines/villager.lua + js/lua lamp verbs), so the built-in
    // dispatcher is disabled. Left defined for reference/fallback: if the Lua
    // runtime is somehow absent, re-enable this to keep towns lighting at dusk.
    if (typeof Lua === "undefined" || !Lua.ready) assignLampTasks();
    // 3) fluid wander for EVERY npc that has a home post — ambient townsfolk,
    //    quest-givers AND shopkeepers (who now step out of their shops too).
    for (const npc of world.npcs) if (npc._home) stepMixNpc(npc);
    tickNpcDoors(performance.now());
  }

  // Merge the two "second billboard over the player" overlays into the one
  // canvas armourMesh actually renders: equipped-metal armour (ArmourOverlay,
  // parked) and equip-triggered wardrobe parts (WardrobeParts, gameplay/
  // wardrobe-parts.js). Cheap in the common case (at most one active — most
  // of the time neither): only composites a fresh canvas when BOTH have art
  // this frame, cached by the joined sig so it doesn't redraw every call.
  let _overlayJoin = { sig: null, out: null };
  function _playerOverlayCanvas() {
    const a = (typeof ArmourOverlay !== "undefined") ? ArmourOverlay.playerCanvas() : null;
    const p = (typeof WardrobeParts !== "undefined") ? WardrobeParts.playerCanvas() : null;
    if (!a) return p;
    if (!p) return a;
    const sig = a.sig + "␟" + p.sig;
    if (_overlayJoin.sig === sig) return _overlayJoin.out;
    const cv = document.createElement("canvas");
    cv.width = a.w; cv.height = a.h;
    const ctx = cv.getContext("2d");
    ctx.drawImage(a.canvas, 0, 0);
    ctx.drawImage(p.canvas, 0, 0); // parts on top
    _overlayJoin = { sig, out: { canvas: cv, cols: a.cols, cell: a.cell, w: a.w, h: a.h, sig } };
    return _overlayJoin.out;
  }

  function syncEntities() {
    syncMixNpcs();
    const _vr = viewRadius();
    // monsters — dead or beyond the view radius render nothing, and their
    // mesh is left unmarked so sweep() reclaims it (the scene must not carry
    // a billboard per monster ever activated; that grew without bound and
    // every place() probed the far monster's chunk, pinning it in memory)
    monsters.forEach((mon, i) => {
      if (!mon.alive || mon.dormant) return; // dormant: a nocturnal bird sleeping out the day
      if (Math.abs(mon.x - player.x) > _vr || Math.abs(mon.y - player.y) > _vr) return;
      // FIX F: build the mesh id once when the monster has a stable uid (cached
      // on the monster). Without a uid we keep the live-index form (unchanged),
      // since the array index isn't a stable identity to cache.
      const id = mon._mid || (mon.uid ? (mon._mid = "mob" + mon.uid) : "mob" + i);
      const def = MONSTERS[mon.kind];
      let dispDir = mon.dir8 || "south";
      if (def.dirSpr && camDir) {
        const wi = Math.max(0, DIR8.indexOf(dispDir));
        dispDir = DIR8[(wi - camDir + 8) & 7];
      }
      let sprKey = def.dirSpr ? "mon_" + mon.kind + "_" + dispDir : "mon_" + mon.kind;
      // husbandry: a sheared/post-lay/milked animal shows its spent-state
      // sprite — the DIRECTIONAL spent frame when one exists (animal-spent-
      // dirs.js derives a full 8-dir set), so a recovering animal still faces
      // the way it walks; the single fixed pose made it look like it was
      // walking backwards half the time.
      if (typeof husbSpriteKey === "function") {
        const hk = husbSpriteKey(mon);
        if (hk) sprKey = (def.dirSpr && atlas && atlas.cells[hk + "_" + dispDir]) ? hk + "_" + dispDir : hk;
      }
      const m = getMesh(id, sprKey, { shadow: true });
      // directional monsters shadow the side the SUN currently sees (facing
      // minus the sun's octant), not the camera-facing frame
      m.userData.shadowGeom = def.dirSpr
        ? geomFor("mon_" + mon.kind + "_" + DIR8[(Math.max(0, DIR8.indexOf(mon.dir8 || "south")) - sunState.oct + 8) & 7])
        : null;
      let bob = mon.moving ? Math.abs(Math.sin(now / 90)) * 0.08 : 0;
      // swimmers ride a slow ocean swell instead of the walk-cycle hop, and
      // sit swimY below the surface: half-out on a surface cruise (the water
      // plane clips the body — shark-fin style), gone entirely on a deep dive
      const sink = mon.canSwim ? (mon.swimY || 0) : 0;
      if (mon.canSwim) bob = Math.sin(now / 420 + (mon.uid || i)) * 0.05;
      // flying birds (gameplay/birdflight.js) render at their absolute feet
      // height with a gentle wing-beat undulation; a perched bird sits still
      const air = mon.flyAbs != null;
      if (air) bob = (mon.flight && mon.flight.mode === "air") ? Math.sin(now / 130 + (mon.uid || i)) * 0.05 : 0;
      let lx = 0, lz = 0;
      if (now - (mon.lungeT || -9999) < 180) {
        const p = 1 - (now - mon.lungeT) / 180;
        lx = (WX(player.px) - WX(mon.px)) * 0.12 * p;
        lz = (WX(player.py) - WX(mon.py)) * 0.12 * p;
      }
      m.userData.lift = bob;
      m.userData.airShadow = air; // place(): sun-project a flyer's shadow to the ground
      const mScale = def.scale * (mon.giant ? 1.5 : 1);
      place(m, WX(mon.px) + lx, WX(mon.py) + lz, 1, mScale, !def.dirSpr && mon.facing < 0, false,
        air ? mon.flyAbs : liftAt(mon.x, mon.y) - sink);
      if (sink > 0.6) {
        // mostly under: no sun shadow (the body is below the surface) — show
        // a dark silhouette gliding flat just under the waterline instead, so
        // a diver reads as a shape in the water rather than vanishing outright
        if (m.userData.shadow) m.userData.shadow.visible = false;
        const sub = getMesh("mobsub" + (mon.uid || i), sprKey);
        sub.material = shadowMatFor(sharedMat);
        sub.renderOrder = 2;
        const shrink = Math.max(0.45, 1 - sink * 0.12); // deeper = smaller shape
        place(sub, WX(mon.px) + lx, WX(mon.py) + lz, 1, mScale * shrink,
          !def.dirSpr && mon.facing < 0, true, liftAt(mon.x, mon.y));
      }
    });
    // npcs
    world.npcs.forEach((npc, i) => {
      if (Math.abs(npc.x - player.x) > _vr || Math.abs(npc.y - player.y) > _vr) return;
      if (npc.mix && MIXR.ok) {
        const def = MIXR.byKey.get(npc.mix);
        if (def) { renderMixNpc(npc._mid || ("npc" + i), npc, def); return; }
      }
      const npcM = getMesh("npc" + i, npc.look >= 0 ? "vill" + npc.look : "npc0", { shadow: true });
      const lvl = npc.level | 0;
      if (lvl > 0) {
        const o = npc._owns;
        const canSee = o && (player.level | 0) >= lvl &&
          player.x >= o[0] && player.x < o[0] + o[2] && player.y >= o[1] && player.y < o[1] + o[3];
        if (!canSee) { npcM.visible = false; return; }
      }
      place(npcM, npc.x + 0.5, npc.y + 0.5, 1, 1, true, false, liftAt(npc.x, npc.y) + lvl * STOREY_H);
    });
    // lamplighters visibly CARRY the candle stand between the storage room and
    // its street spot (assignLampTasks sets _lampCarry to the stand object key)
    world.npcs.forEach((npc, i) => {
      if (!npc._lampCarry) return;
      if (Math.abs(npc.x - player.x) > _vr || Math.abs(npc.y - player.y) > _vr) return;
      const ov = objForKey(npc._lampCarry);
      if (!ov) return;
      const m = getObjMesh("lampc_" + (npc._mid || "npc" + i), ov.idx);
      if (!m) return;
      const bx = (npc.px != null) ? WX(npc.px) : npc.x + 0.5;
      const by = (npc.py != null) ? WX(npc.py) : npc.y + 0.5;
      place(m, bx + 0.26, by + 0.16, 1, ov.scale * 0.55, false, false,
        liftAt(npc.x, npc.y) + 0.35 + Math.sin(now / 210 + i) * 0.05);
    });
    // player (+ boat when sailing)
    const pm = getMesh("player", "ply", { shadow: true });
    const bm = meshes.get("pboat");
    if (player.sailing) {
      // the hull's OBJ_MAP key lives in ITEMS[id].place (furniture.js VESSELS
      // map, e.g. galleon → ship_galleon); looking up the raw item id only hit
      // the few hulls whose ids match an object, so most proper ships fell
      // back to the tiny flat icon below. ov.scale carries the per-hull size.
      const sit = ITEMS[player.sailing];
      const ov = objForKey((sit && sit.place) || player.sailing);
      let existing = meshes.get("pboat");
      if (ov) {
        // 8-directional hull, oriented to the player's heading and the orbiting camera
        const wi = Math.max(0, DIR8.indexOf(player.dir8 || "south"));
        const gf = ov.idx * 8 + ((wi - camDir + 8) & 7);
        if (existing && !existing.userData.isObj) {
          scene.remove(existing); if (existing.userData.shadow) scene.remove(existing.userData.shadow);
          meshes.delete("pboat"); existing = null;
        }
        let m = existing;
        if (!m) { m = new THREE.Mesh(objGeomFor(gf), objMat); m.userData.isObj = true; scene.add(m); meshes.set("pboat", m); }
        if (m.userData.objFrame !== gf) { m.geometry = objGeomFor(gf); m.userData.objFrame = gf; }
        m.userData.lift = 0;
        m.userData.seen = true; m.visible = true;
        place(m, WX(player.px), WX(player.py) + 0.12, 1, ov.scale || 1.5, false, false);
        // sit low on the water — groundY, not liftAt: under a bridge liftAt
        // is the deck, but the boat rides the surface beneath it. Anchor the
        // BOTTOM of the (tile-length-scaled) billboard just under the surface
        // — a fixed centre height would drown a 30-tile hull's art.
        m.position.y = groundY(player.x, player.y) + (ov.scale || 1.5) / 2 - 0.15 + Math.sin(now / 300) * 0.03;
      } else {
        const b = getMesh("pboat", ITEMS[player.sailing].icon);
        b.position.set(WX(player.px), groundY(player.x, player.y) + 0.66 + Math.sin(now / 300) * 0.03, WX(player.py) + 0.12);
        b.rotation.x = TILT;
        b.scale.set(player.facing < 0 ? -1.15 : 1.15, 1.15, 1.15);
      }
    } else if (bm) { bm.visible = false; bm.userData.seen = true; }
    let bob = player.moving || player.forced ? Math.abs(Math.sin(now / 90)) * 0.08 : 0;
    let lx = 0, lz = 0;
    if (now - player.lungeT < 200) {
      const p = 1 - (now - player.lungeT) / 200;
      lx = player.lungeDir[0] * 0.18 * p;
      lz = player.lungeDir[1] * 0.18 * p;
    }
    // riding a placed vessel: nudge the character north (into the hull) so they
    // stand in the middle of the deck rather than at the raft's front edge
    if (typeof ridingEnt === "function" && !player.sailing && ridingEnt()) lz -= 0.28;
    // playable character sprite (8-directional) overrides the default hero
    const usingChar = typeof CHAR_LIST !== "undefined" && player.character != null && CHAR_LIST[player.character];
    if (usingChar) {
      const cm = getCharMesh();
      // camera orbit: show the frame for the facing rotated by -camDir so the
      // character presents the correct side as the view turns around it.
      const wi = Math.max(0, CHAR_DIRS.indexOf(player.dir8 || "south"));
      const di = (wi - camDir + 8) & 7;
      const shDi = (wi - sunState.oct + 8) & 7;      // the frame the SUN sees, for the shadow
      if (!cm.userData.shadowGeomOwn) cm.userData.shadowGeomOwn = new THREE.PlaneGeometry(1, 1);
      // a non-Idle OUTFIT swaps the mesh onto its embedded outfit sheet at the
      // state's frame (base+dir); falls back to the Idle CHAR_SHEET until the
      // sheet image has loaded.
      const _folder = CHAR_LIST[player.character].folder;
      const _fr = (player.outfit && player.outfit !== "Idle" && typeof OUTFIT_FRAME !== "undefined")
        ? OUTFIT_FRAME[_folder + "|" + player.outfit] : null;
      const _os = _fr ? ensureOutfitSheet(_fr[0]) : null;
      if (_fr && _os && _os.w) {
        cm.material = _os.mat;
        if (cm.userData.shadow) cm.userData.shadow.material = _os.shadowMat;
        setSheetUV(cm.geometry, _fr[1] + di, OUTFIT_SHEET_COLS, OUTFIT_SHEET_CELL, _os.w, _os.h);
        cm.userData.shadowGeom = setSheetUV(cm.userData.shadowGeomOwn, _fr[1] + shDi, OUTFIT_SHEET_COLS, OUTFIT_SHEET_CELL, _os.w, _os.h) ? cm.userData.shadowGeomOwn : null;
      } else {
        cm.material = charMat;
        if (cm.userData.shadow) cm.userData.shadow.material = shadowMatFor(charMat);
        setCharUV(cm.geometry, player.character * CHAR_DIRS.length + di);
        cm.userData.shadowGeom = setCharUV(cm.userData.shadowGeomOwn, player.character * CHAR_DIRS.length + shDi)
          ? cm.userData.shadowGeomOwn : null;
      }
      cm.userData.lift = bob;
      cm.visible = true;
      // per-character build: height scales the billboard (feet stay grounded via
      // place()), width is applied on top independently so races read as taller/
      // shorter and wider/narrower (character-stats.js).
      const _cst = (typeof playerCharStats === "function") ? playerCharStats() : null;
      const _ch = _cst ? _cst.h : 1, _cw = _cst ? _cst.w : 1;
      // compensate for the cell headroom so visible height == CHAR_SCALE*_ch (the
      // same body height an NPC of build _ch renders at), then ground the feet
      const _ps = CHAR_SCALE / CHAR_FILL_H;
      place(cm, WX(player.px) + lx, WX(player.py) + lz, 1, _ps * _ch, false, false, playerLiftY - CHAR_FEET_FRAC * _ps * _ch);
      cm.scale.x = _ps * _cw;
      // equipped metal armour (tailored to this character's body + tinted to
      // its metal tier) merged with any equip-triggered wardrobe parts
      // (WardrobeParts), drawn as a second billboard exactly over the
      // character — see _playerOverlayCanvas() above.
      if (typeof ArmourOverlay !== "undefined" || typeof WardrobeParts !== "undefined") {
        const ov = _playerOverlayCanvas();
        if (!armourMesh) {
          armourMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, alphaTest: 0.02 }));
          armourMesh.renderOrder = 6;
          scene.add(armourMesh);
        }
        if (ov) {
          if (armourMesh.userData.sig !== ov.sig) {
            if (armourMesh.material.map) armourMesh.material.map.dispose();
            const t = new THREE.CanvasTexture(ov.canvas);
            t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
            armourMesh.material.map = t; armourMesh.material.needsUpdate = true;
            armourMesh.userData.sig = ov.sig;
          }
          setSheetUV(armourMesh.geometry, di, ov.cols, ov.cell, ov.w, ov.h);
          armourMesh.userData.lift = bob;
          place(armourMesh, WX(player.px) + lx, WX(player.py) + lz, 1, _ps * _ch, false, false, playerLiftY - CHAR_FEET_FRAC * _ps * _ch);
          armourMesh.scale.x = _ps * _cw;
          armourMesh.visible = true;
        } else armourMesh.visible = false;
      }
      pm.visible = false;
      if (pm.userData.shadow) pm.userData.shadow.visible = false;
      if (orbMesh) orbMesh.visible = false;
    } else if (typeof Tutorial !== "undefined" && Tutorial.active() && player.character == null) {
      // Tūhura Isle: until a body is chosen (via the Guide's CharSelect), the newcomer is
      // an unformed SPARK — a floating, softly pulsing orb of light. The
      // Guide's first lesson points at the character menu; picking any
      // character swaps this for the normal 8-direction billboard above.
      if (!orbMesh) {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 64;
        const g = cv.getContext("2d");
        const rg = g.createRadialGradient(32, 32, 2, 32, 32, 30);
        rg.addColorStop(0, "rgba(255,250,225,1)");
        rg.addColorStop(0.35, "rgba(255,232,160,0.9)");
        rg.addColorStop(0.7, "rgba(150,220,255,0.30)");
        rg.addColorStop(1, "rgba(120,200,255,0)");
        g.fillStyle = rg;
        g.fillRect(0, 0, 64, 64);
        const t = new THREE.CanvasTexture(cv);
        orbMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        orbMesh.renderOrder = 7;
        scene.add(orbMesh);
      }
      const pulse = 0.74 + Math.sin(now / 260) * 0.07;
      orbMesh.position.set(WX(player.px) + lx,
        playerLiftY + 0.55 + Math.sin(now / 430) * 0.1 + bob, WX(player.py) + lz);
      orbMesh.rotation.x = TILT;
      orbMesh.scale.set(pulse, pulse, 1);
      orbMesh.visible = true;
      pm.visible = false;
      if (pm.userData.shadow) pm.userData.shadow.visible = false;
      if (charMesh) { charMesh.visible = false; if (charMesh.userData.shadow) charMesh.userData.shadow.visible = false; }
      if (armourMesh) armourMesh.visible = false;
    } else {
      if (orbMesh) orbMesh.visible = false;
      pm.userData.lift = bob;
      place(pm, WX(player.px) + lx, WX(player.py) + lz, 1, 1, player.facing < 0, false, playerLiftY);
      pm.visible = true;
      if (charMesh) { charMesh.visible = false; if (charMesh.userData.shadow) charMesh.userData.shadow.visible = false; }
      if (armourMesh) armourMesh.visible = false;
    }
    _playerBB = (charMesh && charMesh.visible) ? charMesh
      : (orbMesh && orbMesh.visible) ? orbMesh : pm;
    // ---- split echoes (gameplay/split.js): the player's INACTIVE bodies ----
    // translucent copies of the character billboard, one per stored body; the
    // active body is the normal player draw above. Meshes ride the `meshes`
    // registry: mark seen while their body exists, let the sweep reap them
    // after a merge.
    {
      const sbodies = player.bodies || [];
      for (let i = 0; i < 4; i++) {
        const b = sbodies[i];
        const key = "splitb" + i;
        let m = meshes.get(key);
        const show = b && usingChar &&
          Math.abs(b.x - player.x) <= _vr && Math.abs(b.y - player.y) <= _vr;
        if (!show) { if (m && b) { m.visible = false; m.userData.seen = true; } continue; }
        if (!m) {
          const mat = charMat.clone();
          mat.transparent = true; mat.opacity = 0.72; mat.alphaTest = 0.3;
          m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
          m.renderOrder = 5;
          scene.add(m);
          meshes.set(key, m);
        }
        m.userData.seen = true; m.visible = true;
        const bwi = Math.max(0, CHAR_DIRS.indexOf(b.dir8 || "south"));
        setCharUV(m.geometry, player.character * CHAR_DIRS.length + ((bwi - camDir + 8) & 7));
        const bx = b.px != null ? WX(b.px) : b.x + 0.5;
        const by = b.py != null ? WX(b.py) : b.y + 0.5;
        m.userData.lift = (b.moving || b.forced) ? Math.abs(Math.sin(now / 90 + i * 1.7)) * 0.08 : 0;
        const _bst = (typeof playerCharStats === "function") ? playerCharStats() : null;
        const _bh = _bst ? _bst.h : 1, _bw = _bst ? _bst.w : 1;
        const _bs = CHAR_SCALE / CHAR_FILL_H;
        place(m, bx, by, 1, _bs * _bh, false, false,
          liftAt(b.x, b.y) + (b.level | 0) * STOREY_H - CHAR_FEET_FRAC * _bs * _bh);
        m.scale.x = _bs * _bw;
      }
    }
    // ---- live remote players (net/livesync.js): everyone else in the zone ----
    // full-opacity outfit-aware bodies, drawn exactly like the local player
    // (outfit sheet when their state has one, else the base char sheet), with
    // their own character's build scale. Meshes ride the `meshes` registry so
    // the sweep reaps a player who logs off or walks out of range.
    if (typeof Live !== "undefined" && Live.players.size) {
      ensureCharTex();
      for (const rp of Live.players.values()) {
        const key = "livep" + rp.id;
        let m = meshes.get(key);
        const rpShow = charMat && rp.character != null &&
          typeof CHAR_LIST !== "undefined" && CHAR_LIST[rp.character] &&
          Math.abs(rp.x - player.x) <= _vr && Math.abs(rp.y - player.y) <= _vr;
        if (!rpShow) { if (m) { m.visible = false; m.userData.seen = true; } continue; }
        if (!m) {
          m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), charMat);
          m.renderOrder = 5;
          scene.add(m);
          meshes.set(key, m);
        }
        m.userData.seen = true; m.visible = true;
        const rwi = Math.max(0, CHAR_DIRS.indexOf(rp.dir8 || "south"));
        const rdi = (rwi - camDir + 8) & 7;
        const rFolder = CHAR_LIST[rp.character].folder;
        const rFr = (rp.outfit && rp.outfit !== "Idle" && typeof OUTFIT_FRAME !== "undefined")
          ? OUTFIT_FRAME[rFolder + "|" + rp.outfit] : null;
        const rOs = rFr ? ensureOutfitSheet(rFr[0]) : null;
        if (rFr && rOs && rOs.w) {
          m.material = rOs.mat;
          setSheetUV(m.geometry, rFr[1] + rdi, OUTFIT_SHEET_COLS, OUTFIT_SHEET_CELL, rOs.w, rOs.h);
        } else {
          m.material = charMat;
          setCharUV(m.geometry, rp.character * CHAR_DIRS.length + rdi);
        }
        let rx = rp.px != null ? WX(rp.px) : rp.x + 0.5;
        let ry = rp.py != null ? WX(rp.py) : rp.y + 0.5;
        // their attack lunge (net fx): the same 200ms shove toward the target
        // the local player's body makes when it swings/shoots/casts
        if (now - (rp.lungeT || -9999) < 200 && rp.lungeDir) {
          const lp = 1 - (now - rp.lungeT) / 200;
          rx += rp.lungeDir[0] * 0.18 * lp;
          ry += rp.lungeDir[1] * 0.18 * lp;
        }
        m.userData.lift = rp.moving ? Math.abs(Math.sin(now / 90 + rp.id)) * 0.08 : 0;
        const rSt = (typeof CHAR_STATS !== "undefined" && CHAR_STATS[rp.character]) || null;
        const rH = rSt ? rSt.h : 1, rW = rSt ? rSt.w : 1;
        const rPs = CHAR_SCALE / CHAR_FILL_H;
        place(m, rx, ry, 1, rPs * rH, false, false,
          liftAt(rp.x, rp.y) + (rp.level | 0) * STOREY_H - CHAR_FEET_FRAC * rPs * rH);
        m.scale.x = rPs * rW;
        // their SPLIT SELVES (net/livesync.js rp.sp): translucent echoes in
        // their own character's body, exactly like the local player's inactive
        // bodies above. Count varies — the registry sweep reaps retired ones.
        if (rp.sp) for (let gi = 0; gi < rp.sp.length; gi++) {
          const b = rp.sp[gi];
          if (Math.abs(b.x - player.x) > _vr || Math.abs(b.y - player.y) > _vr) continue;
          const gkey = "livesp" + rp.id + "_" + gi;
          let gm = meshes.get(gkey);
          if (!gm) {
            const gmat = charMat.clone();
            gmat.transparent = true; gmat.opacity = 0.72; gmat.alphaTest = 0.3;
            gm = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), gmat);
            gm.renderOrder = 5;
            scene.add(gm);
            meshes.set(gkey, gm);
          }
          gm.userData.seen = true; gm.visible = true;
          const gwi = Math.max(0, CHAR_DIRS.indexOf(b.dir8 || "south"));
          setCharUV(gm.geometry, rp.character * CHAR_DIRS.length + ((gwi - camDir + 8) & 7));
          gm.userData.lift = 0;
          place(gm, WX(b.px), WX(b.py), 1, rPs * rH, false, false,
            liftAt(b.x, b.y) + (b.level | 0) * STOREY_H - CHAR_FEET_FRAC * rPs * rH);
          gm.scale.x = rPs * rW;
        }
      }
    }
    // held tool
    const act = player.act;
    let held = null;
    if (act && act.kind === "gather") {
      const tool = NODE_TYPES[act.node.type].tool;
      held = tool === "axe" ? "i_axe" : tool === "pickaxe" ? "i_pick" : tool === "rod" ? "i_rod" : null;
    } else if (act && act.kind === "combat" && player.equip.weapon) {
      held = ITEMS[player.equip.weapon].icon; // wands and staves show too
    }
    const hm = meshes.get("held");
    if (held) {
      const h = getMesh("held", held);
      h.position.set(WX(player.px) + lx + player.facing * 0.42, playerLiftY + 0.55 + bob, WX(player.py) + lz + 0.05);
      h.rotation.z = -player.facing * (0.5 + Math.sin(now / 160) * 0.7);
      h.scale.set(player.facing < 0 ? -0.7 : 0.7, 0.7, 0.7);
    } else if (hm) { hm.visible = false; hm.userData.seen = true; }
    // a candle equipped in the OFFHAND (shield slot) is visibly held in the
    // player's off hand the whole time — the light you carry has a source you
    // can see (its glow comes from candleInHand via collectNightLights)
    const offId = player.equip && player.equip.shield;
    const offDef = offId && ITEMS[offId];
    const ohm = meshes.get("heldOff");
    if (offDef && offDef.light && offDef.icon) {
      const h = getMesh("heldOff", offDef.icon);
      h.position.set(WX(player.px) + lx - player.facing * 0.36, playerLiftY + 0.5 + bob, WX(player.py) + lz + 0.06);
      h.rotation.z = Math.sin(now / 420) * 0.06;   // a gentle sway, no tool-swing
      h.scale.set(player.facing < 0 ? -0.55 : 0.55, 0.55, 0.55);
    } else if (ohm) { ohm.visible = false; ohm.userData.seen = true; }
    // dyn nodes (fires, carcasses)
    const fireTiles = new Set();   // campfire tiles already drawn, so the station-heat pass skips them
    for (const d of dynNodes) {
      const id = "d" + d.id;
      if (d.type === "campfire") {
        const m = getMesh(id, "campfire");
        // hotter fires burn BIGGER & brighter (heat drives scale + flicker amplitude)
        const hf = typeof stationHeatNow === "function" ? stationHeatNow(d) / (HEAT_MAX || 1000) : 0;
        const dying = typeof stationBurnLeft === "function" ? stationBurnLeft(d) < 8 : (d.expireAt - now < 8000);
        const s = (0.8 + hf * 1.0) * (1 + Math.sin(now / 120) * (0.05 + hf * 0.08)) - (dying ? 0.2 : 0);
        place(m, d.x + 0.5, d.y + 0.5, 1, Math.max(0.35, s), false, false, liftAt(d.x, d.y));
        fireTiles.add(d.x + "," + d.y);
      } else if (d.type === "unlit_fire") {
        // a laid-but-unlit pile of logs, awaiting a spark
        const m = getMesh(id, "campfire_ring");
        place(m, d.x + 0.5, d.y + 0.5, 1, 0.7, false, false, liftAt(d.x, d.y));
      } else {
        const m = getMesh(id, "mon_" + d.kind);
        place(m, d.x + 0.5, d.y + 0.5, 1, 0.9, false, true, liftAt(d.x, d.y));
        m.rotation.z = Math.PI / 2;
      }
    }
    // pilot fires under fixed heat stations (furnaces, kilns, cauldrons…): draw a
    // heat-scaled flame at each hot station on this floor (campfire tiles already
    // drew their own flame above)
    if (typeof stationHeat !== "undefined" && stationHeat.size) {
      const pl = player.level | 0;
      for (const [key, rec] of stationHeat) {
        const p = key.split(","); const sx = +p[0], sy = +p[1], sl = +p[2];
        if (sl !== pl || fireTiles.has(sx + "," + sy)) continue;
        const frac = 1 - (now - rec.stokedAt) / rec.burnMs;
        if (frac <= 0) continue;
        const hf = (rec.peak * frac) / (HEAT_MAX || 1000);
        const m = getMesh("sh" + key, "campfire");
        const s = (0.45 + hf * 0.75) * (1 + Math.sin(now / 120) * (0.06 + hf * 0.08));
        place(m, sx + 0.5, sy + 0.5, 1, Math.max(0.3, s), false, false, liftAt(sx, sy));
      }
    }
    // physical candles the villagers set out at dusk (inside buildings + all
    // around outside) and gather at dawn — lit ones only, drawn as upright candle
    // billboards (same path as dropped items: getMesh with the item icon).
    if (typeof settlementCandleObjects === "function") {
      if (_candleKey === undefined) _candleKey = ["candle", "rushlight", "taper", "beeswax_candle"].map(id => ITEMS[id] && ITEMS[id].icon).find(Boolean) || null;
      for (const s of settlementCandleObjects()) {
        const cx = Math.round(s.x), cy = Math.round(s.y);
        const fl = 1 + Math.sin(now / 130 + cx * 1.7 + cy) * 0.06;
        // outdoor candles ride a floor candle-stand (an 8-dir world object with
        // a lit candle + flame baked in); indoor ones are the small billboard.
        const ov = s.stand ? objForKey(s.stand) : null;
        if (ov) {
          const om = getObjMesh("cstand_" + cx + "_" + cy, ov.idx);
          if (om) { place(om, cx + 0.5, cy + 0.5, 1, ov.scale, false, false, liftAt(cx, cy)); continue; }
        }
        if (_candleKey) {
          const m = getMesh("cndl_" + cx + "_" + cy, _candleKey);
          place(m, cx + 0.5, cy + 0.5, 1, 0.5 * fl, false, false, liftAt(cx, cy));
        }
      }
    }
    // ground items (dropped on the player's storey; hidden from other floors)
    for (const gi of groundItems) {
      const lv = gi.level | 0;
      if (!levelVisible(gi.x, gi.y, lv)) continue;
      const m = getMesh("g" + gi.x + "_" + gi.y + "_" + gi.id, ITEMS[gi.id].icon);
      place(m, gi.x + 0.5, gi.y + 0.5, 1, 0.55, false, false, liftAt(gi.x, gi.y) + lv * STOREY_H);
    }
  }

  function sweep() {
    for (const [id, m] of meshes) {
      if (!m.userData.seen) {
        scene.remove(m);
        if (m.userData.shadow) scene.remove(m.userData.shadow);
        meshes.delete(id);
      } else m.userData.seen = false;
    }
  }

  // ---------- day/night light pass ----------
  // Darken the whole view by how far it is into night at the player's latitude,
  // then "punch" light back in around fires, carried candles, bioluminescent
  // monsters and glowing biomes. Runs on the 2D overlay (octx) — the 3D world
  // uses unlit materials, so this screen-space light-map is how night reads.
  function drawNight() {
    if (typeof nightState !== "function") return;
    const W = overlayCssW, H = overlayCssH;
    const ns = nightState();
    const dark = ns.dark;
    if (dark < 0.03) return;                    // broad daylight: nothing to draw
    const TILEPX = (typeof PX === "function") ? PX(1) : 48;

    // px-per-tile on screen, from two ground points one tile apart
    const p0 = project(player.px, player.py, 0.1);
    const p1 = project(player.px + TILEPX, player.py, 0.1);
    const pxTile = Math.max(6, Math.hypot(p1.x - p0.x, p1.y - p0.y));

    // project each world light to screen at GROUND level, so the glow is an even
    // circle centred on the source's footprint (not stretched by its height)
    const world_l = (typeof collectNightLights === "function") ? collectNightLights() : [];
    const lights = [];
    for (const L of world_l) {
      const tileX = Math.round(L.px / TILEPX - 0.5), tileY = Math.round(L.py / TILEPX - 0.5);
      const h = (typeof liftAt === "function") ? liftAt(tileX, tileY) + 0.05 : 0.1;
      const p = project(L.px, L.py, h);
      if (p.behind) continue;
      const r = L.r * pxTile;
      if (p.x < -r || p.x > W + r || p.y < -r || p.y > H + r) continue;
      lights.push({ x: p.x, y: p.y, r, s: L.s, col: L.col, gr: (L.gr != null ? L.gr * pxTile : null), gs: L.gs });
    }
    // indoors — or standing IN a doorway — the household lamps are lit:
    // punch a full-strength clear hole over every room of that building, so
    // the interior reads bright while the streets outside stay night-dark
    let inb = playerIndoors();
    if (!inb && world.doorAt) {
      const dd = world.doorAt(player.x, player.y);
      if (dd && dd.building) inb = dd.building;
    }
    if (inb) {
      const bm = world.buildingMeta(inb);
      const rects = bm.rooms
        ? bm.rooms.map(r => [r.x, r.y, r.w, r.h])
        : [[inb.x0, inb.y0, inb.w, inb.h],
           ...(bm.wings || []).map(w2 => [w2.x0, w2.y0, w2.w, w2.h])];
      for (const [rx, ry, rw, rh] of rects) {
        const p = project(PX(rx + rw / 2), PX(ry + rh / 2), 0.4);
        if (p.behind) continue;
        lights.push({ x: p.x, y: p.y, r: (Math.max(rw, rh) * 0.8 + 1.4) * pxTile, s: 1,
          col: [255, 208, 148], gr: Math.max(rw, rh) * 0.45 * pxTile, gs: 0.08 });
      }
    }
    // bioluminescent biome decor: each mushroom/tree/rock is its own soft glow
    for (const bl of _bioLights) {
      const p = project(PX(bl.wx), PX(bl.wz), (typeof liftAt === "function" ? liftAt(Math.round(bl.wx - 0.5), Math.round(bl.wz - 0.5)) : 0) + 0.35);
      if (p.behind) continue;
      const r = 1.5 * pxTile;   // tight: each object is its own glowing point, dark between them
      if (p.x < -r || p.x > W + r || p.y < -r || p.y > H + r) continue;
      lights.push({ x: p.x, y: p.y, r, s: 0.5, col: bl.col, gr: 0.9 * pxTile, gs: 0.32 });
    }

    // darkness with even circular holes (offscreen buffer → one clean composite)
    paintDarkness(octx, W, H, dark, lights, "rgb(4,6,16)");

    // additive warm/coloured glow (per light). Bio biomes are NOT washed as a
    // whole — the glow comes from the individual objects above.
    octx.save();
    octx.globalCompositeOperation = "lighter";
    if (ns.town) { octx.globalAlpha = dark * 0.03; octx.fillStyle = "rgb(255,190,120)"; octx.fillRect(0, 0, W, H); octx.globalAlpha = 1; }
    for (const li of lights) {
      if (!li.col) continue;
      // a light may carry a tight glow core (gr/gs) distinct from its wide
      // illumination radius — so many candles don't stack into a colour flare.
      const gr = (li.gr != null ? li.gr : li.r * 0.85);
      const ga = (li.gs != null ? li.gs : li.s * 0.26);
      const g = octx.createRadialGradient(li.x, li.y, 0, li.x, li.y, gr);
      g.addColorStop(0, `rgba(${li.col[0]},${li.col[1]},${li.col[2]},${ga})`);
      g.addColorStop(1, `rgba(${li.col[0]},${li.col[1]},${li.col[2]},0)`);
      octx.fillStyle = g;
      octx.beginPath(); octx.arc(li.x, li.y, gr, 0, Math.PI * 2); octx.fill();
    }
    octx.restore();
  }

  // ---------- night sky: stars, the moon, aurora ----------
  // The night look lives on the 2D overlay (drawNight blankets the whole
  // frame, sky included, in up-to-0.99 darkness), so the celestial layer
  // rides the overlay too, like the sun glow: everything here draws above
  // the projected horizon line, fades in with darkness and is smothered by
  // cloud. Costs nothing by day or at the default zoom — the horizon only
  // enters the frame once the zoom-tilt levels the camera.
  let stars = null;
  const _vCel = new THREE.Vector3(), _vCel2 = new THREE.Vector3();
  const _qCamInv = new THREE.Quaternion();
  function initStars() {
    stars = [];
    let seed = 421;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 520; i++) {
      const az = rnd() * Math.PI * 2;
      // elevation biased LOW: the zoom-tilt sky band only reaches ~6° above
      // the horizon, so the field concentrates where it can be seen
      const sy = 0.003 + 0.14 * rnd() * rnd();
      const r = Math.sqrt(1 - sy * sy);
      const mag = rnd() * rnd();                 // many dim, a few bright
      const c = rnd();
      stars.push({
        x: Math.cos(az) * r, y: sy, z: Math.sin(az) * r,
        s: mag > 0.6 ? 2 : 1,
        a: 0.3 + 0.7 * mag,
        tw: 1400 + rnd() * 2600, ph: rnd() * Math.PI * 2,
        col: c < 0.1 ? "255,224,186" : c < 0.22 ? "186,208,255" : "232,240,255",
      });
    }
    stars.sort((p, q) => (p.col < q.col ? -1 : p.col > q.col ? 1 : 0)); // batch fillStyle swaps
  }
  function drawNightSky() {
    if (typeof nightState !== "function") return;
    const W = overlayCssW, H = overlayCssH;
    const dark = nightState().dark;
    if (dark < 0.22) return;                      // dusk hasn't truly fallen yet
    // the horizon's screen line: a far point at eye height along the view.
    // The camera never rolls, so the horizon is level; pitched down at the
    // default zoom it sits above the top edge → no sky in frame, all skipped.
    _vCel.set(camera.position.x - Math.sin(camYaw) * 1200, camera.position.y,
              camera.position.z - Math.cos(camYaw) * 1200).project(camera);
    if (_vCel.z > 1) return;
    const horY = (1 - _vCel.y) / 2 * H;
    if (horY < 4) return;
    const skyH = Math.min(horY, H);
    const clearK = 1 - 0.92 * wxCloudNow;         // overcast smothers the whole sky
    const nightK = Math.max(0, Math.min(1, (dark - 0.3) / 0.5)) * clearK;
    if (nightK < 0.03) return;
    if (!stars) initStars();
    octx.save();
    // ---- stars: world-anchored directions, twinkling, thinning to nothing
    // right at the horizon (atmospheric extinction)
    let lastCol = "";
    for (const st of stars) {
      _vCel.set(camera.position.x + st.x * 1200, camera.position.y + st.y * 1200,
                camera.position.z + st.z * 1200).project(camera);
      if (_vCel.z > 1) continue;
      const sx = (_vCel.x + 1) / 2 * W, sy2 = (1 - _vCel.y) / 2 * H;
      if (sy2 > skyH - 3 || sy2 < -2 || sx < -2 || sx > W + 2) continue;
      const twk = 0.72 + 0.28 * Math.sin(now / st.tw + st.ph);
      octx.globalAlpha = st.a * twk * nightK *
        Math.min(1, (skyH - 3 - sy2) / (H * 0.05));
      if (st.col !== lastCol) { octx.fillStyle = "rgb(" + st.col + ")"; lastCol = st.col; }
      octx.fillRect(sx, sy2, st.s, st.s);
    }
    octx.globalAlpha = 1;
    // ---- aurora: slow-drifting additive curtains — green feet just above
    // the horizon shading violet up and off the top of the frame. auroraNow
    // (daynight.js) carries the oval-band membership and the event schedule;
    // reduced motion pins the drift and shimmer still.
    const au = (typeof auroraNow === "function") ? auroraNow(player.y) : 0;
    const A = au * nightK;
    if (A > 0.02) {
      const t = (typeof reducedMotion === "function" && reducedMotion()) ? 0 : now;
      octx.globalCompositeOperation = "lighter";
      // a broad airglow hugging the horizon ties the curtains together — it
      // bleeds a little BELOW the horizon line too (haze catches the glow),
      // so the display never ends on a hard cut against the fog band.
      const tail = H * 0.045;
      const gh = Math.min(skyH, H * 0.3);
      let g = octx.createLinearGradient(0, skyH + tail, 0, skyH - gh);
      g.addColorStop(0, "rgba(40,190,120,0)");
      g.addColorStop(0.2, "rgba(40,190,120," + (0.1 * A).toFixed(3) + ")");
      g.addColorStop(1, "rgba(40,190,120,0)");
      octx.fillStyle = g;
      octx.fillRect(0, skyH - gh, W, gh + tail);
      for (let i = 0; i < 9; i++) {
        const drift = Math.sin(t / 6800 + i * 2.11) * 0.045 + Math.sin(t / 21000 + i * 0.7) * 0.1;
        const cx = ((((i + 0.5) / 9 + drift) % 1 + 1) % 1) * W;
        const flick = 0.55 + 0.45 * Math.sin(t / 1900 + i * 1.63);
        const a = 0.08 * A * flick;   // ~3 soft strips overlap mid-curtain: ×3 there
        const cw = W * (0.03 + 0.05 * ((i * 733 % 97) / 97));
        const ch = Math.min(skyH, H * 0.55);
        octx.save();
        octx.translate(cx, skyH);
        octx.rotate(Math.sin(t / 9000 + i) * 0.12);
        g = octx.createLinearGradient(0, tail, 0, -ch);
        g.addColorStop(0, "rgba(60,255,160,0)");
        g.addColorStop(0.17, "rgba(60,255,160," + a.toFixed(3) + ")");
        g.addColorStop(0.6, "rgba(90,170,255," + (a * 0.35).toFixed(3) + ")");
        g.addColorStop(1, "rgba(150,80,255,0)");
        octx.fillStyle = g;
        // soft-edged curtain: overlapping strips under a smooth alpha window,
        // so the sides feather out instead of cutting off as a hard rectangle
        const NS = 5;
        for (let j = 0; j < NS; j++) {
          octx.globalAlpha = Math.sin(Math.PI * (j + 0.5) / NS);
          const sw = cw * (0.34 + 0.66 * (j / (NS - 1)));
          octx.fillRect(-sw / 2 + cw * 0.5 * (j / (NS - 1) - 0.5) * 0.6, -ch, sw, ch + tail);
        }
        octx.globalAlpha = 1;
        octx.restore();
      }
      octx.globalCompositeOperation = "source-over";
    }
    // ---- the moon: soft glow + a fake-sphere crescent whose lit limb faces
    // the (below-horizon) sun — phases fall out of the geometry for free.
    const ms = (typeof moonState === "function") ? moonState(player.x) : null;
    if (ms && ms.up && ms.illum > 0.02) {
      const eA = ms.elev * Math.PI / 2, cE = Math.cos(eA);
      _vCel.set(camera.position.x + ms.dx * cE * 1200,
                camera.position.y + Math.sin(eA) * 1200,
                camera.position.z + ms.dz * cE * 1200).project(camera);
      if (_vCel.z <= 1) {
        const mx = (_vCel.x + 1) / 2 * W, my = (1 - _vCel.y) / 2 * H;
        const R = Math.max(7, Math.min(16, H * 0.017));
        if (my < skyH + R && my > -3 * R && mx > -3 * R && mx < W + 3 * R) {
          // eases THROUGH the horizon line while rising/setting, never pops
          const horFade = Math.max(0, Math.min(1, (skyH + R * 0.5 - my) / (R * 1.4)));
          if (horFade > 0.01) {
            const ga = 0.3 * ms.illum * nightK * horFade;
            octx.globalCompositeOperation = "lighter";
            let mg = octx.createRadialGradient(mx, my, R * 0.4, mx, my, R * 3.4);
            mg.addColorStop(0, "rgba(210,225,255," + ga.toFixed(3) + ")");
            mg.addColorStop(1, "rgba(210,225,255,0)");
            octx.fillStyle = mg;
            octx.beginPath(); octx.arc(mx, my, R * 3.4, 0, Math.PI * 2); octx.fill();
            octx.globalCompositeOperation = "source-over";
            // screen angle from the moon toward the sun, both as camera-space
            // directions — at night the lit side correctly tips down toward
            // where the sun set
            const sph = (typeof sunPhase === "function") ? sunPhase(player.x) : 0.5;
            const thS = 2 * Math.PI * (sph - 0.25);
            _qCamInv.copy(camera.quaternion).invert();
            _vCel.set(Math.cos(thS), -0.5, 0.55 * Math.sin(thS)).normalize().applyQuaternion(_qCamInv);
            _vCel2.set(ms.dx * cE, Math.sin(eA), ms.dz * cE).applyQuaternion(_qCamInv);
            const la = Math.atan2(-(_vCel.y - _vCel2.y), _vCel.x - _vCel2.x);
            const k = Math.cos(2 * Math.PI * ms.age);   // +1 new … −1 full: terminator bulge
            octx.save();
            octx.translate(mx, my);
            octx.rotate(la);                            // lit limb along +x
            octx.globalAlpha = (0.8 + 0.2 * ms.illum) * nightK * horFade;
            octx.fillStyle = "rgb(228,231,224)";
            octx.beginPath();
            octx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2);
            octx.ellipse(0, 0, R * Math.max(0.02, Math.abs(k)), R, 0, Math.PI / 2, -Math.PI / 2, k > 0);
            octx.fill();
            octx.clip();                                // maria stay inside the lit shape
            octx.fillStyle = "rgba(176,182,178,0.5)";
            octx.beginPath();
            octx.arc(-R * 0.22, -R * 0.18, R * 0.34, 0, Math.PI * 2);
            octx.arc(R * 0.24, R * 0.3, R * 0.2, 0, Math.PI * 2);
            octx.fill();
            octx.restore();
          }
        }
      }
    }
    octx.restore();
  }

  // ---------- biome atmosphere ----------
  // The per-biome look layer (gameplay/biomeatmos.js): the player's biome is
  // sampled on a slow cadence and its colour grade, air colour, mist, ray
  // floor and particle signature ease in over ~2.5 s — walking from meadow
  // into swamp, the world's palette, haze and life cross-fade with you.
  const atmos = {
    biome: "", sampleT: -1e9,
    r: 1, g: 1, b: 1, sat: 1,             // eased material grade
    fogR: 0.5, fogG: 0.5, fogB: 0.5, fogW: 0,   // eased air colour (0..1) + pull
    mist: 0, rays: 0,
    dens: {},                              // eased particle density per type
  };
  const _atmosFog = new THREE.Color();
  function syncAtmos(dt) {
    if (now - atmos.sampleT > 1200) {
      atmos.sampleT = now;
      atmos.biome = (typeof world !== "undefined" && world && world.biomeNameAt)
        ? (world.biomeNameAt(player.x, player.y) || "") : "";
    }
    const a = (typeof biomeAtmos === "function") ? biomeAtmos(atmos.biome) : null;
    const k = Math.min(1, dt / 2500);
    const tt = (a && a.tint) || [1, 1, 1];
    atmos.r += (tt[0] - atmos.r) * k;
    atmos.g += (tt[1] - atmos.g) * k;
    atmos.b += (tt[2] - atmos.b) * k;
    atmos.sat += (((a && a.sat) || 1) - atmos.sat) * k;
    const f = (a && a.fog) || [128, 128, 128];
    atmos.fogW += (((a && a.fogW) || 0) - atmos.fogW) * k;
    atmos.fogR += (f[0] / 255 - atmos.fogR) * k;
    atmos.fogG += (f[1] / 255 - atmos.fogG) * k;
    atmos.fogB += (f[2] / 255 - atmos.fogB) * k;
    atmos.mist += (((a && a.mist) || 0) - atmos.mist) * k;
    atmos.rays += (((a && a.rays) || 0) - atmos.rays) * k;
    // particle cross-fade: the current biome's signatures ease up, every
    // other type eases down and is dropped once it's gone
    const want = {};
    if (a && a.part) want[a.part] = a.dens || 0;
    if (a && a.part2) want[a.part2] = (want[a.part2] || 0) + (a.dens2 || 0);
    for (const t in atmos.dens) if (!(t in want)) want[t] = 0;
    for (const t in want) {
      const cur = atmos.dens[t] || 0, nx = cur + (want[t] - cur) * k;
      if (nx < 0.005 && !want[t]) delete atmos.dens[t];
      else atmos.dens[t] = nx;
    }
  }

  // ---------- biome particles ----------
  // The overlay's living-air pass: each biome's signature drifts through the
  // frame — sakura petals, ash flakes, rising embers, glowing spores,
  // fireflies, butterflies, blowing snow, crystal sparkle, canyon dust,
  // steppe seeds, sun motes. Screen-space with pseudo-depth (like the rain),
  // two phases: normal particles draw BEFORE the night veil (so darkness
  // falls over them), light-emitting ones AFTER it (they punch through like
  // the fires do). Physics steps once per frame in the first phase.
  const AT_COLS = {
    petals: ["255,183,197", "255,160,180", "250,205,215"],
    ash: ["150,148,145", "122,120,118", "176,173,168"],
    embers: ["255,150,60", "255,110,40", "255,190,90"],
    spores: ["150,190,255", "190,150,255", "120,235,200", "255,180,240"],
    motes: ["255,230,170", "255,240,200"],
    fireflies: ["190,255,140", "255,240,150"],
    butterflies: ["255,200,80", "240,240,255", "255,140,120", "190,160,255"],
    sparkle: ["255,255,255", "200,225,255", "255,225,235", "215,255,235"],
    snowdust: ["240,245,255"],
    dust: ["214,184,134", "200,170,120"],
    seeds: ["230,215,170", "215,200,160"],
  };
  // particles per unit density — flocks of small things, a few big soft ones
  const AT_CAP = { butterflies: 16, dust: 26, sparkle: 55, snowdust: 80, fireflies: 30 };
  let atParts = [], _apT = 0;
  function _apGlow(t) { return typeof ATMOS_GLOW_PARTS !== "undefined" && ATMOS_GLOW_PARTS[t]; }
  function _apSpawn(t, W, H) {
    const col = Math.floor(Math.random() * AT_COLS[t].length);
    return {
      t, col,
      x: Math.random() * W,
      y: (t === "sparkle" ? 0.25 + Math.random() * 0.72 : Math.random()) * H,
      s: 0.55 + Math.random(),                    // pseudo-depth: size/speed/alpha
      ph: Math.random() * Math.PI * 2,
      die: now + (t === "sparkle" ? 450 + Math.random() * 600 : 6000 + Math.random() * 7000),
    };
  }
  function drawAtmosParticles(glowPhase) {
    let types = 0;
    for (const t in atmos.dens) types++;
    if (!types && !atParts.length) return;
    const W = overlayCssW, H = overlayCssH;
    const rm = (typeof reducedMotion === "function" && reducedMotion());
    const dark = (typeof nightState === "function") ? nightState().dark : 0;
    const w = (typeof weatherNow === "function") ? weatherNow() : null;
    const wv = (w && w.wind) || { x: 0.4, y: 0 };
    // wind projected onto the current camera heading, like the rain slant
    const wind = wv.x * Math.cos(camYaw) - wv.y * Math.sin(camYaw);
    if (!glowPhase) {
      // ---- physics + population (first phase only: one step per frame) ----
      const dts = Math.min(100, Math.max(0, now - _apT)) / 1000; _apT = now;
      const count = {};
      for (const p of atParts) count[p.t] = (count[p.t] || 0) + 1;
      for (const t in atmos.dens) {
        const wantN = Math.round(atmos.dens[t] * (AT_CAP[t] || 70) * (rm ? 0.5 : 1));
        for (let i = count[t] || 0; i < wantN; i++) atParts.push(_apSpawn(t, W, H));
        count[t] = Math.max(count[t] || 0, wantN);
      }
      const flut = rm ? 0 : 1;   // reduced motion: drift only, no flutter
      for (let i = atParts.length - 1; i >= 0; i--) {
        const p = atParts[i];
        const wantN = Math.round((atmos.dens[p.t] || 0) * (AT_CAP[p.t] || 70) * (rm ? 0.5 : 1));
        if (p.die <= now) {
          // expired: breathe back in only while its biome still wants it
          if ((count[p.t] || 0) <= wantN) atParts[i] = _apSpawn(p.t, W, H);
          else { count[p.t]--; atParts.splice(i, 1); }
          continue;
        }
        let vx = 0, vy = 0;
        switch (p.t) {
          case "petals":   vy = (26 + 20 * p.s); vx = wind * 22 + Math.sin(now / 900 + p.ph) * 24 * flut; break;
          case "ash":      vy = (13 + 12 * p.s); vx = wind * 14 + Math.sin(now / 1500 + p.ph) * 9 * flut; break;
          case "embers":   vy = -(18 + 22 * p.s); vx = wind * 10 + Math.sin(now / 500 + p.ph) * 15 * flut; break;
          case "spores":   vy = Math.sin(now / 2100 + p.ph) * 7 * flut - 3; vx = wind * 8 + Math.cos(now / 2600 + p.ph) * 6 * flut; break;
          case "motes":    vy = Math.sin(now / 1900 + p.ph) * 4 * flut; vx = wind * 7 + Math.sin(now / 1300 + p.ph) * 5 * flut; break;
          case "fireflies": vx = Math.sin(now / 800 + p.ph * 3) * 20 * flut + wind * 4; vy = Math.cos(now / 1100 + p.ph) * 14 * flut; break;
          case "butterflies": vx = wind * 10 + Math.sin(now / 620 + p.ph) * 32 * flut; vy = Math.sin(now / 430 + p.ph * 2) * 26 * flut - 4; break;
          case "snowdust": vx = (wind >= 0 ? 1 : -1) * (110 + 90 * p.s) + wind * 60; vy = 18 * p.s; break;
          case "dust":     vx = wind * 34 + 16 * p.s; vy = Math.sin(now / 1700 + p.ph) * 5 * flut; break;
          case "seeds":    vx = wind * 42 + 18 + Math.sin(now / 800 + p.ph) * 10 * flut; vy = 9 + Math.sin(now / 600 + p.ph) * 8 * flut; break;
          case "sparkle":  break;   // sparkles are stationary twinkles
        }
        p.x += vx * dts * p.s; p.y += vy * dts * p.s;
        if (p.x < -24) p.x += W + 48; else if (p.x > W + 24) p.x -= W + 48;
        if (p.y < -24) p.y += H + 48; else if (p.y > H + 24) p.y -= H + 48;
      }
    }
    // ---- draw this phase's particles ----
    octx.save();
    if (glowPhase) octx.globalCompositeOperation = "lighter";
    for (const p of atParts) {
      if (!!_apGlow(p.t) !== glowPhase) continue;
      const col = AT_COLS[p.t][p.col];
      let a = 0, sz = 2 * p.s;
      switch (p.t) {
        case "petals":   a = 0.8; break;
        case "ash":      a = 0.6; break;
        case "embers":   a = (0.45 + 0.5 * Math.sin(now / 120 + p.ph)) * (0.55 + 0.45 * dark); break;
        case "spores":   a = (0.5 + 0.35 * Math.sin(now / 1600 + p.ph)) * (0.45 + 0.55 * dark); sz = 2.6 * p.s; break;
        case "motes":    a = 0.38 * (0.6 + 0.4 * Math.sin(now / 1100 + p.ph)) * (1 - dark); sz = 1.8 * p.s; break;
        case "fireflies": {
          const pulse = Math.max(0, Math.sin(now / 1100 + p.ph));
          a = pulse * pulse * (0.12 + 0.88 * dark); sz = 2.2 * p.s; break;
        }
        case "butterflies": a = 0.85 * (1 - dark); break;
        case "sparkle": {
          const lf = 1 - Math.max(0, Math.min(1, (p.die - now) / 800));
          a = Math.sin(Math.PI * lf) * 0.9; break;
        }
        case "snowdust": a = 0.5; break;
        case "dust":     a = 0.18; sz = (6 + 4 * p.s); break;
        case "seeds":    a = 0.55; break;
      }
      if (a <= 0.02) continue;
      octx.globalAlpha = Math.min(1, a);
      octx.fillStyle = "rgb(" + col + ")";
      if (p.t === "butterflies") {
        // two wing dots flapping about a dark body speck
        const ws = 2 + 1.2 * p.s;
        const flap = Math.abs(Math.sin(now / 90 + p.ph)) * (ws + 1);
        octx.fillRect(p.x - ws - flap, p.y - ws / 2, ws, ws);
        octx.fillRect(p.x + flap, p.y - ws / 2, ws, ws);
        octx.fillStyle = "rgb(40,32,28)";
        octx.fillRect(p.x - 0.5, p.y - 1, 1, 3);
      } else if (p.t === "sparkle") {
        // 4-point star: a plus of thin rects
        const r = 2 + 2.5 * p.s;
        octx.fillRect(p.x - r, p.y - 0.5, r * 2, 1);
        octx.fillRect(p.x - 0.5, p.y - r, 1, r * 2);
      } else if (p.t === "snowdust") {
        octx.fillRect(p.x, p.y, 5 + 4 * p.s, 1.2);   // wind-stretched streak
      } else if (p.t === "fireflies") {
        octx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
        octx.globalAlpha = Math.min(1, a * 0.25);
        octx.fillRect(p.x - sz * 1.6, p.y - sz * 1.6, sz * 3.2, sz * 3.2);   // soft halo
      } else {
        octx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, Math.max(1, sz * (p.t === "petals" ? 0.75 : 1)));
      }
    }
    octx.restore();
    octx.globalAlpha = 1;
  }

  // ---------- god rays ----------
  // Low sun + forest canopy = shafts of light. Screen-space slanted bars
  // (additive, like the sun glow) that ease in when the player stands in a
  // forest biome through the golden hours, slanting away from the sun's
  // bearing and shimmering slowly. duskW carries the overcast cut, so grey
  // days have no shafts. Biomes with a ray floor (biomeatmos.js — jungle,
  // bamboo, ruins) keep dappled shafts through the whole day.
  let _grOn = 0, _grT = 0;
  function drawGodRays() {
    const d = Math.min(100, Math.max(0, now - _grT)); _grT = now;
    const forest = /forest|grove|woodland|jungle|taiga|ruins/i.test(atmos.biome);
    const effW = Math.max(duskW, sunState.up ? atmos.rays * (1 - 0.75 * wxCloudNow) : 0);
    const target = (sunState.up && effW > 0.05 && forest) ? 1 : 0;
    _grOn += (target - _grOn) * Math.min(1, d / 1500);
    if (_grOn < 0.03) return;
    const W = overlayCssW, H = overlayCssH;
    const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
    const rel = Math.atan2(fwdX * -sunState.dz - fwdZ * -sunState.dx,
      fwdX * -sunState.dx + fwdZ * -sunState.dz);
    const slant = Math.max(-0.5, Math.min(0.5, rel)) * 0.8;
    octx.save();
    octx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 6; i++) {
      const ph = ((i * 733) % 97) / 97;
      const x = (((i + 0.5) / 6) + Math.sin(now / 9000 + i * 2.1) * 0.02) * W;
      const flick = 0.6 + 0.4 * Math.sin(now / 2600 + i * 1.7);
      const a = 0.24 * _grOn * effW * flick * (0.45 + ph * 0.8);
      const w = (0.025 + ph * 0.05) * W;
      octx.save();
      octx.translate(x, -H * 0.05);
      octx.rotate(slant);
      const g = octx.createLinearGradient(0, 0, 0, H * 0.75);
      g.addColorStop(0, `rgba(255,232,170,${a.toFixed(3)})`);
      g.addColorStop(0.55, `rgba(255,210,130,${(a * 0.5).toFixed(3)})`);
      g.addColorStop(1, "rgba(255,200,120,0)");
      octx.fillStyle = g;
      octx.fillRect(-w / 2, 0, w, H * 0.8);
      octx.restore();
    }
    octx.restore();
  }

  // ---------- sun glow pass ----------
  // The camera never pitches above the horizon, so the sun itself is always
  // just off the top of the screen. Through the golden hour, when the view
  // faces sunward, its light bleeds down from the top edge — an additive glow
  // that reads as the low sun behind the world (and through the trees),
  // without needing a sky that is never in frame. duskW already carries the
  // low-sun curve AND the overcast cut, so heavy cloud smothers this too.
  function drawSunGlow() {
    if (!sunState.up || duskW < 0.03) return;
    const W = overlayCssW, H = overlayCssH;
    const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
    const sunX = -sunState.dx, sunZ = -sunState.dz;   // ground dir toward the sun
    const dot = fwdX * sunX + fwdZ * sunZ;
    const crs = fwdX * sunZ - fwdZ * sunX;
    const rel = Math.atan2(crs, dot);                 // sun bearing vs view, +ve = right
    const hFov = 2 * Math.atan(Math.tan(24 * Math.PI / 180) * (W / Math.max(1, H)));
    if (Math.abs(rel) > hFov * 0.85) return;          // facing away: no glow
    const cx = W / 2 + Math.tan(rel) / Math.tan(hFov / 2) * (W / 2);
    const cy = -H * 0.03;                             // centre just above the top edge
    const R = H * 0.55;
    // fade out as the zoom-tilt brings the REAL sun (sky dome disc) into frame
    const a = duskW * (1 - 0.5 * Math.abs(rel) / (hFov * 0.85)) * (1 - tiltK);
    if (a < 0.02) return;
    octx.save();
    octx.globalCompositeOperation = "lighter";
    // wide ellipse (sunset light hugs the horizon), hot near-white core
    octx.translate(cx, cy); octx.scale(1.9, 1);
    const g = octx.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, `rgba(255,244,214,${(0.85 * a).toFixed(3)})`);
    g.addColorStop(0.28, `rgba(255,196,120,${(0.42 * a).toFixed(3)})`);
    g.addColorStop(0.62, `rgba(255,158,84,${(0.16 * a).toFixed(3)})`);
    g.addColorStop(1, "rgba(255,150,70,0)");
    octx.fillStyle = g;
    octx.fillRect(-R, -R, 2 * R, 2 * R);
    octx.restore();
  }

  // ---------- weather pass ----------
  // Screen-space precipitation + overcast dimming from the deterministic
  // weather field (gameplay/weather.js). Particles live in screen space and
  // wrap — heaviness sets how many are alive, their speed and their alpha.
  const WX_MAX = 260;
  const wxDrops = [];
  let wxLastT = 0, wxFlash = 0;
  function drawWeather() {
    if (typeof weatherNow !== "function") return;
    const w = weatherNow();
    if (!w) return;
    const W = overlayCssW, H = overlayCssH;
    const dt = Math.min(100, Math.max(0, now - wxLastT)); wxLastT = now;
    // overcast flattens the daylight with a cool grey wash (day only — night
    // darkness is drawNight's job)
    const L = (typeof daylightNow === "function") ? daylightNow() : 1;
    const dim = (w.cloud * 0.22 + w.precip * 0.08) * L;
    if (dim > 0.01) {
      octx.globalAlpha = dim;
      octx.fillStyle = "rgb(88,96,112)";
      octx.fillRect(0, 0, W, H);
      octx.globalAlpha = 1;
    }
    if (w.precip <= 0.02) { wxDrops.length = 0; return; }
    const snow = w.kind === "snow";
    const want = Math.round(Math.pow(w.precip, 0.8) * WX_MAX * (snow ? 0.7 : 1));
    while (wxDrops.length < want) wxDrops.push({
      x: Math.random() * W, y: Math.random() * H,
      v: snow ? 45 + Math.random() * 55 : 620 + Math.random() * 420,   // px/s fall speed
      r: 1.0 + Math.random() * 1.6,                                     // flake radius (snow)
      ph: Math.random() * Math.PI * 2,                                  // flutter phase (snow)
    });
    if (wxDrops.length > want) wxDrops.length = want;
    // the LOCAL wind slants the fall (strong on a deep low's flank, calm under
    // a high) — projected onto the current camera heading so the slant swings
    // round as the view orbits
    const wv = w.wind || { x: 0.85, y: 0 };
    const slant = (wv.x * Math.cos(camYaw) - wv.y * Math.sin(camYaw)) * (snow ? 34 : 140);
    const fall = dt / 1000;
    octx.save();
    if (snow) {
      octx.fillStyle = "rgba(236,242,252,0.8)";
      octx.beginPath();
      for (const d of wxDrops) {
        d.y += d.v * fall;
        d.x += (slant + Math.sin(now / 700 + d.ph) * 24) * fall;
        if (d.y > H) { d.y -= H + 4; d.x = Math.random() * W; }
        if (d.x > W) d.x -= W; else if (d.x < 0) d.x += W;
        octx.moveTo(d.x + d.r, d.y);
        octx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      }
      octx.fill();
    } else {
      octx.strokeStyle = "rgba(178,198,228," + (0.2 + w.precip * 0.25).toFixed(2) + ")";
      octx.lineWidth = 1.1;
      const len = 9 + w.precip * 13;
      octx.beginPath();
      for (const d of wxDrops) {
        d.y += d.v * fall;
        d.x += slant * fall;
        if (d.y > H) { d.y -= H + 6; d.x = Math.random() * W; }
        if (d.x > W) d.x -= W; else if (d.x < 0) d.x += W;
        const k = len / d.v;
        octx.moveTo(d.x, d.y);
        octx.lineTo(d.x - slant * k, d.y - d.v * k);
      }
      octx.stroke();
      // thunderstorm: an occasional sheet-lightning flash across the sky —
      // a sudden full-screen strobe, so reduced motion suppresses it entirely
      if (w.precip > 0.85 && Math.random() < dt * 0.00035 &&
          !(typeof reducedMotion === "function" && reducedMotion())) wxFlash = now + 130;
      if (now < wxFlash) {
        octx.globalAlpha = 0.28 * ((wxFlash - now) / 130);
        octx.fillStyle = "#eaf2ff";
        octx.fillRect(0, 0, W, H);
        octx.globalAlpha = 1;
      }
    }
    octx.restore();
  }

  // ---------- overlay ----------
  function drawOverlay() {
    const W = overlayCssW, H = overlayCssH;
    octx.clearRect(0, 0, W, H);
    // overhead-UI scale: camera distance grows linearly with camZoom, so
    // sprites shrink ∝ 1/camZoom — bars/labels/badges multiply their pixel
    // sizes AND their above-the-head pixel offsets by this so they keep a
    // constant size and position relative to the character at any zoom
    // (1 at the default zoom; Dream Forest's magnifier counts as zooming in)
    const uiK = 1 / camZoom;
    const nameFont = `bold ${(11 * uiK).toFixed(1)}px OpenDyslexic, Verdana`;
    // the player's overhead anchors (hp bar, bubbles, speech, weave) were tuned
    // for a build-1.0 sprite — multiply by the character's height so they ride
    // just above the head of tall and short races alike (character-stats.js)
    const pch = (typeof charHeightMul === "function") ? charHeightMul() : 1;
    // exact screen-space head anchor for the player: the top of the billboard
    // actually rendered this frame (per-character build scale, walk bob and the
    // HD-2D camera lean all baked into its transform), pulled down by the char
    // sheet's empty cell headroom. A fixed world-height can't do this — the
    // lean shifts the projected head top by a camera-dependent amount, and
    // every character's build height differs (character-stats.js).
    let headPt = null;
    if (_playerBB && _playerBB.visible) {
      const frac = _playerBB === charMesh ? (CHAR_FEET_FRAC + CHAR_FILL_H - 0.5) : 0.5;
      _vHead.set(0, frac * Math.abs(_playerBB.scale.y), 0)
        .applyQuaternion(_playerBB.quaternion).add(_playerBB.position).project(camera);
      if (_vHead.z <= 1) headPt = { x: (_vHead.x + 1) / 2 * W, y: (1 - _vHead.y) / 2 * H };
    }
    // ---- action loading bar: any timed skill work (gather, craft, tend,
    // till, chop, alchemy…) draws its current tick's progress as a slim gold
    // bar riding just over the player's head (actions.js stamps _t0/_t1 each
    // time the act schedules a tick; combat is excluded — it has its own beat)
    if (headPt && player.act && player.act.kind !== "combat" &&
        player.act._t1 > player.act._t0) {
      const a = player.act;
      const fracA = Math.max(0, Math.min(1, (now - a._t0) / (a._t1 - a._t0)));
      const bw = 46 * uiK, bh = 5 * uiK;
      const bx = headPt.x - bw / 2, byy = headPt.y - 14 * uiK;
      octx.fillStyle = "rgba(8,12,18,0.78)";
      octx.fillRect(bx, byy, bw, bh);
      octx.fillStyle = "#ffd75e";
      octx.fillRect(bx + 1, byy + 1, Math.max(0, (bw - 2) * fracA), bh - 2);
    }
    // hover tile outline (projected quad, on the hovered tile's tier or the
    // player's current floor plane when upstairs)
    if (hover && hover.tileX !== undefined) {
      const hy = (player.level | 0) > 0
        ? groundY(player.x, player.y) + (player.level | 0) * STOREY_H + 0.04
        // locked to river level under a span: outline hugs the water surface,
        // not the deck overhead
        : (player.deck === false && !pickHigh && pickDual(hover.tileX, hover.tileY))
        ? groundY(hover.tileX, hover.tileY) + 0.02
        : liftAt(hover.tileX, hover.tileY) + 0.02; // liftAt: bridge decks sit above the water tier
      const c = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([ox, oz]) => {
        _v.set(hover.tileX + ox, hy, hover.tileY + oz).project(camera);
        return [(_v.x + 1) / 2 * W, (1 - _v.y) / 2 * H];
      });
      octx.strokeStyle = "#ffe97a";
      octx.lineWidth = 2;
      octx.beginPath();
      octx.moveTo(c[0][0], c[0][1]);
      for (let i = 1; i < 4; i++) octx.lineTo(c[i][0], c[i][1]);
      octx.closePath();
      octx.stroke();
    }
    // queued-task tiles (Option/Alt+click, gameplay/split.js): a WHITE
    // outline on every tile still waiting in a body's queue — and on the one
    // a body is walking to off its queue — so the work plan reads at a
    // glance; each outline drops the moment its body gets there.
    if (typeof Split !== "undefined" && Split.queuedTiles) {
      const qts = Split.queuedTiles();
      if (qts.length) {
        octx.strokeStyle = "rgba(255,255,255,0.9)";
        octx.lineWidth = 2;
        for (const q of qts) {
          if (Math.abs(q.x - player.x) > 48 || Math.abs(q.y - player.y) > 48) continue;
          const qy = liftAt(q.x, q.y) + 0.02;
          let behind = false;
          const qc = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([ox, oz]) => {
            _v.set(q.x + ox, qy, q.y + oz).project(camera);
            if (_v.z > 1) behind = true;
            return [(_v.x + 1) / 2 * W, (1 - _v.y) / 2 * H];
          });
          if (behind) continue;
          octx.beginPath();
          octx.moveTo(qc[0][0], qc[0][1]);
          for (let i = 1; i < 4; i++) octx.lineTo(qc[i][0], qc[i][1]);
          octx.closePath();
          octx.stroke();
        }
      }
    }
    // air bubbles while drowning: a shrinking row bobbing just above the
    // waterline over the player's head; each bubble ≈ one second of air
    if (typeof AIR_MAX !== "undefined" && player.air !== undefined && player.air < AIR_MAX) {
      const p = project(player.px, player.py, playerLiftY + playerSink + 1.5 * pch);
      if (!p.behind) {
        const n = Math.max(0, Math.ceil(player.air));
        octx.fillStyle = "rgba(190,230,255,0.85)";
        octx.strokeStyle = "rgba(255,255,255,0.9)";
        octx.lineWidth = 1;
        for (let i = 0; i < n; i++) {
          const bx = p.x + (i - (n - 1) / 2) * 11 * uiK;
          const byy = p.y + Math.sin(now / 260 + i * 1.7) * 2;
          octx.beginPath();
          octx.arc(bx, byy, 3.6 * uiK, 0, Math.PI * 2);
          octx.fill();
          octx.stroke();
        }
      }
    }
    // hp bars
    function barAt(x, y, frac) {
      const bw = 40 * uiK, bh = Math.max(1.5, 5 * uiK);
      octx.fillStyle = "#300";
      octx.fillRect(x - bw / 2, y, bw, bh);
      octx.fillStyle = "#3c3";
      octx.fillRect(x - bw / 2, y, bw * Math.max(0, frac), bh);
    }
    function bar(px, py, frac, h) {
      const p = project(px, py, h);
      if (!p.behind) barAt(p.x, p.y, frac);
    }
    // both monster overlay loops share the entity cull: beyond the view
    // radius the billboard isn't drawn (syncEntities), so no bar/label either
    const _ovr = viewRadius();
    for (const mon of monsters) {
      if (!mon.alive || mon.dormant) continue;
      if (Math.abs(mon.x - player.x) > _ovr || Math.abs(mon.y - player.y) > _ovr) continue;
      const def = MONSTERS[mon.kind];
      const mmh = monMaxHp(mon.kind);
      // swimmers' bars ride down with the body (same swimY sink the mesh uses);
      // a flying bird's bar rides up with it (flyAbs is the absolute feet height)
      const sink = mon.canSwim ? (mon.swimY || 0) : 0;
      const airH = mon.flyAbs != null ? Math.max(0, mon.flyAbs - liftPx(mon.px, mon.py)) : 0;
      if (mon.hp < mmh || mon.target) bar(mon.px, mon.py, mon.hp / mmh, def.scale * (mon.giant ? 1.5 : 1) * 1.35 + liftPx(mon.px, mon.py) - sink + airH);
    }
    // mob name / level labels — same projection as hp bar, fixed pixel size.
    // No extra letterSpacing — OpenDyslexic doesn't need artificial tracking
    // on top of its own already-wide letterforms (see the identical note on
    // the world map's settlement labels, gameplay/world.js).
    octx.font = nameFont;
    octx.textAlign = "center";
    // matches monsters.js's aggro gate: near a village/city or a road (or on
    // Tūhura Isle, permanently), a monster that would otherwise be dangerous
    // reads as calm instead
    const peaceful = (world.inPeacefulZone && world.inPeacefulZone(player.x, player.y)) ||
      (typeof onTutIsle === "function" && onTutIsle(player.x, player.y));
    for (const mon of monsters) {
      if (!mon.alive || mon.dormant) continue;
      if (Math.abs(mon.x - player.x) > _ovr || Math.abs(mon.y - player.y) > _ovr) continue;
      const def = MONSTERS[mon.kind];
      // labels submerge with a diving swimmer, tracking the body (swimY sink),
      // and climb with a flying bird (flyAbs)
      const sink = mon.canSwim ? (mon.swimY || 0) : 0;
      const airH = mon.flyAbs != null ? Math.max(0, mon.flyAbs - liftPx(mon.px, mon.py)) : 0;
      const p = project(mon.px, mon.py, def.scale * (mon.giant ? 1.5 : 1) * 1.35 + liftPx(mon.px, mon.py) - sink + airH);
      if (p.behind) continue;
      const danger = def.lvl > 2 * combatLevel() && !peaceful;
      octx.shadowColor = "rgba(0,0,0,0.9)";
      octx.shadowBlur = 3 * uiK;
      octx.fillStyle = danger ? "#ff4444" : "#ffd700";
      octx.fillText(`${(typeof monName === "function" ? monName(mon) : def.name)} (lvl ${def.lvl})`, p.x, p.y - 8 * uiK);
    }
    // mix NPC name labels + overhead speech — shown whenever the NPC is on
    // screen (in render range and not behind the camera)
    if (MIXR.ok) {
      const T = performance.now();
      octx.shadowColor = "rgba(0,0,0,0.9)"; octx.shadowBlur = 3 * uiK;
      for (const npc of world.npcs) {
        if (!npc.mix) continue;
        if (Math.abs(npc.x - player.x) > 40 || Math.abs(npc.y - player.y) > 40) continue;
        // hide the nameplate of an NPC that's on an upper storey the player can't
        // see into (matches the billboard cull in renderMixNpc)
        const lvl = npc.level | 0;
        if (lvl > 0) {
          const o = npc._owns;
          const canSee = o && (player.level | 0) >= lvl &&
            player.x >= o[0] && player.x < o[0] + o[2] && player.y >= o[1] && player.y < o[1] + o[3];
          if (!canSee) continue;
        }
        const def = MIXR.byKey.get(npc.mix);
        const px = npc.px != null ? npc.px : PX(npc.x), py = npc.py != null ? npc.py : PX(npc.y);
        // per-character build height — the same multiplier renderMixNpc scales
        // the billboard by, so the nameplate tracks tall/short NPCs' heads
        // (def.hs is the pre-build-system fallback)
        const _nh = (typeof mixStatsFor === "function" && def) ? mixStatsFor(def).h : ((def && def.hs) || 1);
        const hh = MIX_SCALE * _nh + liftPx(px, py) + lvl * STOREY_H + 0.15;
        const p = project(px, py, hh);
        if (p.behind) continue;
        octx.fillStyle = "#bfe6ff";
        octx.fillText(npc.name, p.x, p.y - 6 * uiK);
        // quest-giver badge: a ✦ floats above their name — gold when they have a
        // quest to offer, blue while you're mid-quest for them (quests.js)
        if (npc._questGiver && typeof Quests !== "undefined") {
          const qs = Quests.giverState(npc);
          octx.fillStyle = qs === "active" ? "#7fd0ff" : "#ffe14a";
          octx.font = `bold ${(15 * uiK).toFixed(1)}px OpenDyslexic, Verdana`;
          octx.fillText("✦", p.x, p.y - 20 * uiK);
          octx.font = nameFont;
        }
        // overhead speech bubble (set by talkTo), fades after a few seconds.
        // Word-wraps to a max width and grows the background to fit any text.
        if (npc._say && T < npc._say.until) {
          octx.font = "bold 12px OpenDyslexic, Verdana";
          const maxW = 240, padX = 9, padY = 6, lineH = 15;
          const words = String(npc._say.text).split(/\s+/);
          const lines = [];
          let cur = "";
          for (const word of words) {
            const trial = cur ? cur + " " + word : word;
            if (octx.measureText(trial).width + padX * 2 > maxW && cur) { lines.push(cur); cur = word; }
            else cur = trial;
          }
          if (cur) lines.push(cur);
          let tw = 0;
          for (const ln of lines) tw = Math.max(tw, octx.measureText(ln).width);
          const w = tw + padX * 2, h = lines.length * lineH + padY * 2;
          const bx = p.x - w / 2, by = p.y - 34 * uiK - h;
          octx.shadowBlur = 0;
          octx.fillStyle = "rgba(20,24,32,0.9)";
          if (octx.roundRect) { octx.beginPath(); octx.roundRect(bx, by, w, h, 6); octx.fill(); }
          else octx.fillRect(bx, by, w, h);
          octx.fillStyle = "#fff";
          for (let li = 0; li < lines.length; li++)
            octx.fillText(lines[li], p.x, by + padY + li * lineH + 11);
          octx.font = nameFont;
          octx.shadowColor = "rgba(0,0,0,0.9)"; octx.shadowBlur = 3 * uiK;
        }
      }
    }
    // live remote players (net/livesync.js): nameplate + action mark + chat
    // bubble — same projection discipline as the NPC labels above
    if (typeof Live !== "undefined" && Live.players.size) {
      const TL = performance.now();
      octx.font = nameFont;
      octx.textAlign = "center";
      octx.shadowColor = "rgba(0,0,0,0.9)"; octx.shadowBlur = 3 * uiK;
      for (const rp of Live.players.values()) {
        if (rp.character == null) continue;
        if (Math.abs(rp.x - player.x) > _ovr || Math.abs(rp.y - player.y) > _ovr) continue;
        const rSt = (typeof CHAR_STATS !== "undefined" && CHAR_STATS[rp.character]) || null;
        const rhh = CHAR_SCALE * (rSt ? rSt.h : 1) + liftPx(rp.px, rp.py) +
          (rp.level | 0) * STOREY_H + 0.15;
        const p = project(rp.px, rp.py, rhh);
        if (p.behind) continue;
        // their health bar — shown while hurt or fighting, like a monster's,
        // so a blow landing on them (net fx) reads at a glance
        if (rp.mhp && rp.hp != null && (rp.hp < rp.mhp || rp.act === "combat"))
          barAt(p.x, p.y - 2 * uiK, rp.hp / rp.mhp);
        octx.fillStyle = "#a8ffc9";                    // green = a fellow player
        octx.fillText(rp.name + (rp.clvl ? " (lvl " + rp.clvl + ")" : ""), p.x, p.y - 10 * uiK);
        // what they're doing right now, at a glance
        if (rp.act)
          octx.fillText(rp.act === "gather" ? "⛏" : rp.act === "combat" ? "⚔" : "🔨",
            p.x, p.y - 24 * uiK);
        // their SPLIT SELVES: each ghost carries OUR username and its own
        // combat level (split halves xp), plus its current-action indicator —
        // so every body of a split player is labelled on every screen
        if (rp.sp) for (const b of rp.sp) {
          if (Math.abs(b.x - player.x) > _ovr || Math.abs(b.y - player.y) > _ovr) continue;
          const ghh = CHAR_SCALE * (rSt ? rSt.h : 1) + liftPx(b.px, b.py) + (b.level | 0) * STOREY_H + 0.15;
          const gp = project(b.px, b.py, ghh);
          if (gp.behind) continue;
          octx.fillStyle = "#9fe6c0";
          octx.fillText(rp.name + (b.clvl ? " (lvl " + b.clvl + ")" : ""), gp.x, gp.y - 10 * uiK);
          if (b.act)
            octx.fillText(b.act === "gather" ? "⛏" : b.act === "combat" ? "⚔" : "🔨",
              gp.x, gp.y - 24 * uiK);
        }
        // their public-chat line as an overhead bubble (once chat is live)
        if (rp._say && TL < rp._say.until) {
          octx.font = "bold 12px OpenDyslexic, Verdana";
          const maxW = 240, padX = 9, padY = 6, lineH = 15;
          const words = String(rp._say.text).split(/\s+/);
          const lines = [];
          let cur = "";
          for (const word of words) {
            const trial = cur ? cur + " " + word : word;
            if (octx.measureText(trial).width + padX * 2 > maxW && cur) { lines.push(cur); cur = word; }
            else cur = trial;
          }
          if (cur) lines.push(cur);
          let tw = 0;
          for (const ln of lines) tw = Math.max(tw, octx.measureText(ln).width);
          const w = tw + padX * 2, h = lines.length * lineH + padY * 2;
          const bx = p.x - w / 2, by = p.y - 34 * uiK - h;
          octx.shadowBlur = 0;
          octx.fillStyle = "rgba(22,32,26,0.9)";       // green-dark = a player's voice
          if (octx.roundRect) { octx.beginPath(); octx.roundRect(bx, by, w, h, 6); octx.fill(); }
          else octx.fillRect(bx, by, w, h);
          octx.fillStyle = "#eaffea";
          for (let li = 0; li < lines.length; li++)
            octx.fillText(lines[li], p.x, by + padY + li * lineH + 11);
          octx.font = nameFont;
          octx.shadowColor = "rgba(0,0,0,0.9)"; octx.shadowBlur = 3 * uiK;
        }
      }
    }
    // the player's own speech bubble — mirrors the chat bar as you type, and
    // holds briefly once spoken (set by npc-chat.js playerSay)
    if (player._say && performance.now() < player._say.until) {
      const pp = headPt ? { x: headPt.x, y: headPt.y - 14 * uiK, behind: false }
        : project(player.px, player.py, 1.55 * pch + playerLiftY);
      if (!pp.behind) {
        octx.font = "bold 12px OpenDyslexic, Verdana";
        octx.shadowColor = "rgba(0,0,0,0.9)"; octx.shadowBlur = 3;
        const maxW = 240, padX = 9, padY = 6, lineH = 15;
        const words = String(player._say.text).split(/\s+/);
        const lines = [];
        let cur = "";
        for (const word of words) {
          const trial = cur ? cur + " " + word : word;
          if (octx.measureText(trial).width + padX * 2 > maxW && cur) { lines.push(cur); cur = word; }
          else cur = trial;
        }
        if (cur) lines.push(cur);
        let tw = 0;
        for (const ln of lines) tw = Math.max(tw, octx.measureText(ln).width);
        const w = tw + padX * 2, h = lines.length * lineH + padY * 2;
        const bx = pp.x - w / 2, by = pp.y - 34 * uiK - h;
        octx.shadowBlur = 0;
        octx.fillStyle = "rgba(26,34,26,0.9)";      // a green-tinged bubble = the player's voice
        if (octx.roundRect) { octx.beginPath(); octx.roundRect(bx, by, w, h, 6); octx.fill(); }
        else octx.fillRect(bx, by, w, h);
        octx.fillStyle = "#eaffea";
        octx.textAlign = "center";
        for (let li = 0; li < lines.length; li++)
          octx.fillText(lines[li], pp.x, by + padY + li * lineH + 11);
      }
    }
    octx.shadowBlur = 0;
    octx.letterSpacing = "0px";
    const inCombat = monsters.some(m => m.alive && m.target === player);
    if (inCombat || player.hp < maxHp()) {
      if (headPt) barAt(headPt.x, headPt.y - 9 * uiK, player.hp / maxHp());
      else bar(player.px, player.py, player.hp / maxHp(), 1.35 * pch + playerLiftY);
    }
    // your own nameplate — same green as the fellow players around you, so you
    // read as one of them. Only once you've an account and left the isle.
    {
      const onIsle = player.tutorial && typeof player.tutorial === "object" && !player.tutorial.graduated;
      if (!onIsle && typeof Server !== "undefined" && Server.enabled() && Server.logged() && Server.user) {
        const np = headPt ? { x: headPt.x, y: headPt.y - 20 * uiK, behind: false }
          : project(player.px, player.py, 1.75 * pch + playerLiftY);
        if (!np.behind) {
          octx.font = nameFont;
          octx.textAlign = "center";
          octx.shadowColor = "rgba(0,0,0,0.9)"; octx.shadowBlur = 3 * uiK;
          octx.fillStyle = "#a8ffc9";
          const cl = (typeof combatLevel === "function" ? combatLevel() : 0) | 0;
          octx.fillText(Server.user.username + (cl ? " (lvl " + cl + ")" : ""), np.x, np.y);
          octx.shadowBlur = 0;
        }
      }
    }
    // Vanished (veil+shadow technique): grey wisps mark the unseen caster
    if (player.unseenUntil && now < player.unseenUntil) {
      const pu = project(player.px, player.py, 1.1 * pch + playerLiftY);
      if (!pu.behind) {
        octx.globalAlpha = 0.5;
        octx.fillStyle = "#8a7aa8";
        for (let i = 0; i < 3; i++) {
          const a = now / 700 + i * (Math.PI * 2 / 3);
          octx.beginPath();
          octx.arc(pu.x + Math.cos(a) * 13, pu.y + Math.sin(a) * 9, 4.5, 0, 7);
          octx.fill();
        }
        octx.globalAlpha = 1;
      }
    }
    // the Weave: gathered rune words orbit the caster until the sentence casts
    if (player.weave && player.weave.asp.length) {
      const pw = headPt ? { x: headPt.x, y: headPt.y - 10 * uiK, behind: false }
        : project(player.px, player.py, 1.7 * pch + playerLiftY);
      if (!pw.behind) {
        player.weave.asp.forEach((wd, i) => {
          const a = now / 450 + i * (Math.PI * 2 / player.weave.asp.length);
          octx.globalAlpha = 0.9;
          octx.fillStyle = (wd && wd.col) || "#fff";
          octx.beginPath();
          octx.arc(pw.x + Math.cos(a) * 16, pw.y + Math.sin(a) * 6 - 4, 3.5, 0, 7);
          octx.fill();
          octx.globalAlpha = 1;
        });
      }
    }
    // projectiles
    for (const pr of projectiles) {
      const t = Math.min(1, (now - pr.t0) / pr.dur);
      if (pr.kind === "arrow" && pr.h0 !== undefined) {
        // ballistic arc (combat.js): linear ground track to the COMMITTED
        // landing tile with a parabolic lift in absolute world height — the
        // arrow was aimed at a predicted position and nothing steers it once
        // loosed. It rests at the landing point through its `stick` grace
        // (hitT < 1 = the arc dipped into something solid short of the aim).
        // Screen tilt comes from a trailing sample so it stays stable at rest.
        const arcH = tt => pr.h0 + (pr.h1 - pr.h0) * tt + 4 * pr.peak * tt * (1 - tt);
        const cap = pr.hitT !== undefined ? pr.hitT : 1;
        const tt = Math.min(cap, t);
        const tb = Math.max(0, tt - 0.05);
        const p = project(pr.x0 + (pr.x1 - pr.x0) * tt, pr.y0 + (pr.y1 - pr.y0) * tt, arcH(tt));
        const pb = project(pr.x0 + (pr.x1 - pr.x0) * tb, pr.y0 + (pr.y1 - pr.y0) * tb, arcH(tb));
        if (p.behind) continue;
        const ang = Math.atan2(p.y - pb.y, p.x - pb.x);
        octx.strokeStyle = "#c9a06a";
        octx.lineWidth = 3;
        octx.beginPath();
        octx.moveTo(p.x - Math.cos(ang) * 10, p.y - Math.sin(ang) * 10);
        octx.lineTo(p.x + Math.cos(ang) * 6, p.y + Math.sin(ang) * 6);
        octx.stroke();
        octx.fillStyle = "#ddd";
        octx.fillRect(p.x + Math.cos(ang) * 6 - 2, p.y + Math.sin(ang) * 6 - 2, 4, 4);
        continue;
      }
      const a = project(pr.x0, pr.y0, 0.55 + liftPx(pr.x0, pr.y0)), b = project(pr.x1, pr.y1, 0.55 + liftPx(pr.x1, pr.y1));
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      if (pr.kind === "arrow") {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        octx.strokeStyle = "#c9a06a";
        octx.lineWidth = 3;
        octx.beginPath();
        octx.moveTo(x - Math.cos(ang) * 10, y - Math.sin(ang) * 10);
        octx.lineTo(x + Math.cos(ang) * 6, y + Math.sin(ang) * 6);
        octx.stroke();
        octx.fillStyle = "#ddd";
        octx.fillRect(x + Math.cos(ang) * 6 - 2, y + Math.sin(ang) * 6 - 2, 4, 4);
      } else {
        // woven-spell bolts carry their dominant aspect's colour
        octx.fillStyle = pr.col ? pr.col : pr.kind === "fire" ? "#ff8030" : "#e8f4ff";
        octx.beginPath();
        octx.arc(x, y, 7 - t * 2, 0, 7);
        octx.fill();
      }
    }
    // splats
    for (const s of splats) {
      if (now < s.t) continue; // delayed splat: lands with its arrow (addSplat)
      const e = s.ent;
      const p = project(e === player ? player.px : e.px, e === player ? player.py : e.py,
        0.55 + (e === player ? playerLiftY : (e.flyAbs != null ? e.flyAbs : liftPx(e.px, e.py))));
      if (p.behind) continue;
      octx.globalAlpha = Math.max(0, 1 - (now - s.t) / 900);
      octx.fillStyle = s.val > 0 ? "#c22" : "#22a";
      octx.beginPath();
      octx.arc(p.x, p.y, 11, 0, 7);
      octx.fill();
      octx.fillStyle = "#fff";
      octx.font = "bold 13px OpenDyslexic, Verdana";
      octx.textAlign = "center";
      octx.fillText(String(s.val), p.x, p.y + 5);
      octx.globalAlpha = 1;
    }
    // floats
    for (const f of floats) {
      const prog = (now - f.t) / 1500;
      const p = project(f.x, f.y, 1.3 + prog * 0.9 + groundY(Math.floor(f.x), Math.floor(f.y)));
      if (p.behind) continue;
      octx.globalAlpha = 1 - prog;
      octx.fillStyle = f.color;
      octx.font = `bold ${f.size}px OpenDyslexic, Verdana`;
      octx.textAlign = "center";
      octx.fillText(f.text, p.x, p.y);
      octx.globalAlpha = 1;
    }
    // weather BEFORE night: precipitation + overcast dim first, then darkness
    // falls over the rain too — at night you only see rain where there's light.
    try { drawWeather(); } catch (e) { octx.globalAlpha = 1; }
    // biome particles UNDER the night veil: petals, ash, snow-dust,
    // butterflies, dust and seeds live in the world's light, so darkness
    // falls over them like everything else. (Physics steps here too.)
    try { drawAtmosParticles(false); } catch (e) { octx.globalCompositeOperation = "source-over"; octx.globalAlpha = 1; }
    // day/night LAST: darken the whole view (world + name labels + bars) with
    // circular light holes. Guarded so a light-pass edge case can't blank the game.
    try { drawNight(); } catch (e) { octx.globalCompositeOperation = "source-over"; octx.globalAlpha = 1; }
    // the night sky OVER the darkness veil: stars, the moon and any aurora
    // are light sources, so like the fire glows they punch through it.
    try { drawNightSky(); } catch (e) { octx.globalCompositeOperation = "source-over"; octx.globalAlpha = 1; }
    // glowing biome particles OVER the veil: embers, spores, fireflies and
    // crystal sparkle are light sources — they brighten as the dark deepens.
    try { drawAtmosParticles(true); } catch (e) { octx.globalCompositeOperation = "source-over"; octx.globalAlpha = 1; }
    // sun glow + god rays OVER the dusk veil — like the fire glows, the sun
    // is a light source, so its bloom punches through the ambient dim. duskW
    // carries the overcast cut, so heavy cloud still smothers both.
    try { drawGodRays(); } catch (e) { octx.globalCompositeOperation = "source-over"; octx.globalAlpha = 1; }
    try { drawSunGlow(); } catch (e) { octx.globalCompositeOperation = "source-over"; octx.globalAlpha = 1; }
    if (now < player.stunUntil) {
      octx.fillStyle = "rgba(255,80,80,0.12)";
      octx.fillRect(0, 0, W, H);
    }
  }

  // ---------- river current: drifting foam streaks ----------
  // A small pool of soft foam-glint streaks rides the rivers, each following
  // the local downstream direction from world.riverFlowAt — the water visibly
  // "flows". Streaks spawn on carved-water tiles near the player and die when
  // they run aground or time out.
  // 2026-10 redraw: the original streak was a flat opaque colour rectangle —
  // read as a frosted slab stuck to the water rather than current, so the
  // effect was retired. This version textures the streak with a soft
  // feathered gradient (faded at every edge, no hard rectangle silhouette) so
  // it reads as foam riding the surface rather than a decal, tints it with
  // the world's day/night colour grading (tintPatch) so it doesn't sit
  // outside the lighting, and scales each streak in/out over its lifetime
  // instead of popping visible.
  const FLOW_N = 48;
  const flowPool = [];
  let flowMat = null, flowGeom = null, flowLastT = 0;
  function flowTexture() {
    const cv = document.createElement("canvas");
    cv.width = 64; cv.height = 16;
    const cc = cv.getContext("2d");
    const hg = cc.createLinearGradient(0, 0, 64, 0);
    hg.addColorStop(0, "rgba(255,255,255,0)");
    hg.addColorStop(0.5, "rgba(255,255,255,1)");
    hg.addColorStop(1, "rgba(255,255,255,0)");
    cc.fillStyle = hg;
    cc.fillRect(0, 0, 64, 16);
    // feather the long edges too (destination-in a vertical falloff) so the
    // streak reads as an oval glint, not a rectangle with soft left/right caps
    cc.globalCompositeOperation = "destination-in";
    const vg = cc.createLinearGradient(0, 0, 0, 16);
    vg.addColorStop(0, "rgba(255,255,255,0)");
    vg.addColorStop(0.5, "rgba(255,255,255,1)");
    vg.addColorStop(1, "rgba(255,255,255,0)");
    cc.fillStyle = vg;
    cc.fillRect(0, 0, 64, 16);
    const tex = new THREE.CanvasTexture(cv);
    return tex;
  }
  function syncFlow() {
    if (!flowMat) {
      // normal alpha blend, not additive: additive barely brightens an
      // already-bright water tile (invisible in practice); plain alpha reads
      // as foam actually sitting on the surface. The soft feathered texture
      // (not opacity) is what keeps this from reading as a hard slab.
      flowMat = new THREE.MeshBasicMaterial({
        map: flowTexture(), color: 0xf4fbff, transparent: true, opacity: 0.85,
        depthWrite: false, side: THREE.DoubleSide,
      });
      tintPatch(flowMat);
      flowGeom = new THREE.PlaneGeometry(1.05, 0.22);
    }
    // flow at (wx,wy): the tutorial isle's RIVER animates via the Tutorial
    // hook (it isn't in world.riverFlowAt's registry). The SEA is still —
    // rivers are the only current in the world.
    const flowAt = (wx, wy) => {
      if (typeof Tutorial !== "undefined") {
        const r = Tutorial.riverFlow && Tutorial.riverFlow(wx, wy);
        if (r) return r;
      }
      return world.riverFlowAt ? world.riverFlowAt(wx, wy) : null;
    };
    const dt = Math.min(100, Math.max(0, now - flowLastT));
    flowLastT = now;
    for (let tries = 0; tries < 3; tries++) {
      let slot = flowPool.find(p => p.die <= now);
      if (!slot && flowPool.length < FLOW_N) {
        const m = new THREE.Mesh(flowGeom, flowMat);
        m.rotation.order = "YXZ";
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        scene.add(m);
        slot = { m, die: 0, born: 0, x: 0, y: 0, fx: 1, fy: 0 };
        flowPool.push(slot);
      }
      if (!slot) break;
      const wx = player.x + ((Math.random() * 29) | 0) - 14;
      const wy = player.y + ((Math.random() * 29) | 0) - 14;
      const wb = waterBit(wx, wy);
      if (wb < 1 || wb > 3) { slot.m.visible = false; continue; }   // any water (the isle river is sea-level → bit 1)
      const f = flowAt(wx, wy);        // null on still water → no foam there
      if (!f) { slot.m.visible = false; continue; }
      slot.x = wx + 0.15 + Math.random() * 0.7;
      slot.y = wy + 0.15 + Math.random() * 0.7;
      slot.fx = f[0]; slot.fy = f[1];
      slot.born = now;
      slot.die = now + 1600 + Math.random() * 1800;
      slot.m.visible = true;
    }
    // tiles per second of drift — a river in flood visibly races
    const sp = 1.35 * (1 + floodLvl * 1.6) * dt / 1000;
    const FADE = 260; // ms — streaks scale in/out instead of popping visible
    for (const p of flowPool) {
      if (p.die <= now) { p.m.visible = false; continue; }
      p.x += p.fx * sp; p.y += p.fy * sp;
      const tx = Math.floor(p.x), ty = Math.floor(p.y);
      const wb = waterBit(tx, ty);
      if (wb < 1 || wb > 3) { p.die = 0; p.m.visible = false; continue; }
      const f = flowAt(tx, ty);
      if (f) { p.fx = f[0]; p.fy = f[1]; } // bend with the river / rip
      p.m.position.set(p.x, waterLevelAt(tx, ty) + 0.05, p.y);
      p.m.rotation.y = -Math.atan2(p.fy, p.fx);
      const age = now - p.born, remain = p.die - now;
      const s = Math.max(0, Math.min(1, age / FADE, remain / FADE));
      p.m.scale.setScalar(0.4 + s * 0.6);
    }
  }

  // ---------- waterfalls ----------
  // Where a river's surface drops a half-tier or more into the next tile
  // downstream, hang a scrolling white fall over the edge with foam. Sites
  // are found by a slow ring scan around the player (waterBit/waterLevel are
  // chunk-cached, riverFlowAt is pure math) and expire once left behind. The
  // tutorial isle's sea-level river never qualifies (carved-water tiles only).
  const wfSites = new Map();   // "x,y" -> site
  let wfScanT = 0, wfMat = null, wfFoamGeom = null, wfGeom = null;
  function wfTexture() {
    const cv = document.createElement("canvas");
    cv.width = 32; cv.height = 64;
    const cc = cv.getContext("2d");
    let seed = 13;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 14; i++) {
      const x = rnd() * 32, w = 1 + rnd() * 2.5, a = 0.25 + rnd() * 0.45;
      cc.fillStyle = `rgba(240,250,255,${a.toFixed(2)})`;
      cc.fillRect(x, 0, w, 64);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }
  function syncWaterfalls() {
    if (!world.riverFlowAt) return;
    if (!wfMat) {
      wfMat = new THREE.MeshBasicMaterial({
        map: wfTexture(), transparent: true, opacity: 0.75,
        depthWrite: false, side: THREE.DoubleSide,
      });
      tintPatch(wfMat);
      wfGeom = new THREE.PlaneGeometry(1, 1);
      wfFoamGeom = new THREE.PlaneGeometry(1.05, 0.55);
    }
    if (now - wfScanT > 1500) {
      wfScanT = now;
      // The water surface NEVER drops more than half a step per tile (the
      // relaxation caps it) and the spring ramp descends one half-step per
      // 2 tiles — so the steepest water anywhere is the stepped cascade of a
      // mountain stream near its source. Dress those: a 4-tile downstream
      // walk that sheds ≥0.95 (~2 steps, the full nominal ramp rate) gets a
      // white cascade. Flat lowland rivers shed 0 and stay undressed;
      // proximity dedupe keeps it to one cascade per few tiles of ramp.
      const R = 22;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const wx = player.x + dx, wy = player.y + dy;
          if (wfSites.has(wx + "," + wy)) continue;
          const b = waterBit(wx, wy);
          if (b < 2 || b > 3) continue;                    // carved water only
          let f = world.riverFlowAt(wx, wy);
          if (!f) continue;
          let cx = wx, cy = wy, ok = true;
          const path = [[wx, wy]];
          for (let s = 0; s < 4; s++) {
            const ax = Math.abs(f[0]) >= Math.abs(f[1]) ? Math.sign(f[0]) : 0;
            const ay = ax === 0 ? Math.sign(f[1]) : 0;
            cx += ax; cy += ay;
            const nb = waterBit(cx, cy);
            if ((ax === 0 && ay === 0) || nb < 1 || nb > 3) { ok = false; break; }
            path.push([cx, cy]);
            f = world.riverFlowAt(cx, cy) || f;
          }
          if (!ok || path.some(([px, py]) => wfSites.has(px + "," + py))) continue;
          const top = waterLevelBase(wx, wy), bot = waterLevelBase(cx, cy);
          const drop = top - bot;
          if (drop < 0.95) continue;
          let crowded = false;
          for (const s2 of wfSites.values())
            if (Math.abs(s2.wx - wx) + Math.abs(s2.wy - wy) < 7) { crowded = true; break; }
          if (crowded) continue;
          const rx = cx - wx, ry = cy - wy;
          const ctrX = (wx + cx) / 2 + 0.5, ctrZ = (wy + cy) / 2 + 0.5;
          const fall = new THREE.Mesh(wfGeom, wfMat);
          fall.scale.set(1.15, drop + 0.3, 1);
          fall.position.set(ctrX, (top + bot) / 2 + 0.1, ctrZ);
          fall.rotation.y = Math.atan2(rx, ry);
          scene.add(fall);
          const foam = new THREE.Mesh(wfFoamGeom, flowMat || wfMat);
          foam.rotation.order = "YXZ";
          foam.rotation.x = -Math.PI / 2;
          foam.rotation.z = Math.atan2(rx, ry);
          foam.position.set(cx + 0.5, bot + 0.06, cy + 0.5);
          scene.add(foam);
          const site = { wx, wy, fall, foam, keys: path.map(([px, py]) => px + "," + py) };
          for (const k of site.keys) wfSites.set(k, site);
        }
      const dead = new Set();
      for (const s of wfSites.values())
        if (Math.max(Math.abs(s.wx - player.x), Math.abs(s.wy - player.y)) > 30) dead.add(s);
      for (const s of dead) {
        scene.remove(s.fall); scene.remove(s.foam);
        for (const k of s.keys) wfSites.delete(k);
      }
    }
    if (wfMat) wfMat.map.offset.y = -((now / 380) % 1);   // the water falls
  }

  // ---------- frame ----------
  let lastT = 0;
  // per-section frame cost accumulators (perf triage; read via R3D._diag().framePerf)
  const framePerf = {};
  function _sec(name, ms) {
    const s = framePerf[name] || (framePerf[name] = { ms: 0, n: 0, max: 0 });
    s.ms += ms; s.n++; if (ms > s.max) s.max = ms;
  }
  function frame() {
    if (!ready) return;
    const dt = Math.min(100, now - lastT);
    lastT = now;
    let _fpT = performance.now();
    const _fpMark = name => { const t = performance.now(); _sec(name, t - _fpT); _fpT = t; };
    // --- camera follow + orbit smoothing (must run before billboards are placed) ---
    const tx = WX(player.px), tz = WX(player.py);
    if (followX === null) { followX = tx; followZ = tz; followY = playerLiftY; }
    const kf = 1 - Math.exp(-dt * 0.006);
    followX += (tx - followX) * kf;
    followZ += (tz - followZ) * kf;
    followY += (playerLiftY - followY) * kf; // camera rides the terrain tiers smoothly
    // snap the view directly between the 4 cardinal angles (90° each) — never ease
    // through a diagonal, so the terrain grid is only ever shown axis-aligned and the
    // switch goes straight S→E→N→W (or reverse). Camera stays on its orbit circle, so
    // the snap doesn't dip toward the player.
    camYaw = (camStep & 3) * (Math.PI / 2);
    camDir = (camStep & 3) * 2; // matching cardinal sprite frame (S/E/N/W)
    // the sun is world-anchored and tracks the day/night clock: update its
    // azimuth/elevation each frame, and rebake the static shadows whenever it
    // has moved a real step (every few minutes of daylight — sunBakeKey
    // quantizes azimuth+length so this never churns per-frame)
    updateSun();
    updateShadowFade();
    _fpMark("sun");
    // FIX A: a sun step used to rebake EVERY chunk + struct shadow in a single
    // frame — a multi-hundred-ms burst on a dense city, on every (multi-minute)
    // sun step. Instead, a new step refills two persistent drain queues and we
    // rebake only a handful per frame. A fresh step REPLACES the queues, so the
    // shadows can never trail the sun by more than one quantized step; finishing
    // the rebake a few frames (~tens of ms) later is imperceptible. Stale queue
    // entries (chunk/struct unloaded before we got to it) are detached from the
    // scene — skip them, exactly as the original values()-walk never saw them.
    if (sunState.key !== sunBakeKey) {
      sunBakeKey = sunState.key;
      _shadowChunkQ.length = 0; _shadowStructQ.length = 0;
      for (const g of chunkMeshes.values()) if (g.userData.shSprites) _shadowChunkQ.push(g);
      for (const rec of structs.values()) if (rec.shadowFeet) _shadowStructQ.push(rec);
    }
    for (let i = 0; i < 4 && _shadowChunkQ.length; ) {
      const g = _shadowChunkQ.pop();
      if (!g.parent) continue;           // chunk was pruned since the step — skip (no count)
      buildChunkShadow(g); i++;
    }
    for (let i = 0; i < 2 && _shadowStructQ.length; ) {
      const rec = _shadowStructQ.pop();
      if (!rec.group || !rec.group.parent) continue;   // struct pruned since the step — skip
      buildStructShadow(rec); i++;
    }
    _fpMark("shadowBake");
    // snow cover: one uniform, all patched materials follow (no rebakes)
    if (typeof snowNow === "function") snowUni.value = snowNow();
    // colour temperature: neutral white under a high sun, golden as it sinks
    // (grazing light — permanent through subarctic winter days and under the
    // Fullday Pole's midnight sun), the cool blue hour once it's down. Eased
    // over ~2 s so sunset never pops; the sky and fog ride the same light.
    const wfog = (typeof weatherNow === "function") ? weatherNow() : null;
    wxCloudNow = wfog ? wfog.cloud : 0;
    syncAtmos(dt);   // per-biome grade/air/particles ease toward the local biome
    {
      let tr = 1, tg = 1, tb = 1, ts = 1, w = 0;
      if (sunState.up) {
        w = Math.pow(Math.max(0, Math.min(1, (0.45 - sunState.elev) / 0.4)), 1.3);
        w *= 1 - 0.65 * wxCloudNow;               // heavy overcast smothers the gold
        tr = 1 + 0.08 * w; tg = 1 - 0.20 * w; tb = 1 - 0.42 * w;
        ts = 1 + 0.32 * w;                        // golden hour pops, not just yellows
      } else { tr = 0.78; tg = 0.84; }
      duskW = w;
      // biome grade (biomeatmos.js): the concept-art colour signature rides
      // on top of the time-of-day light — swamp murk, red-desert heat, the
      // ashen forest's grey — eased by syncAtmos at biome borders.
      tr *= atmos.r; tg *= atmos.g; tb *= atmos.b; ts *= atmos.sat;
      const tc = tintUni.value, k = Math.min(1, dt / 1800);
      tc.r += (tr - tc.r) * k; tc.g += (tg - tc.g) * k; tc.b += (tb - tc.b) * k;
      satUni.value += (ts - satUni.value) * k;
      // sky/background: lerp toward the dusk apricot as the sun sinks — this
      // IS the fog colour, the only sky visible at low zoom. Sun down: the
      // old blue-hour tint of SKY (the darkness overlay does the actual
      // darkening).
      if (sunState.up) _skyTarget.setHex(SKY).lerp(SKY_DUSK, w);
      else _skyTarget.setHex(SKY).multiply(tc);
      // biome air: the haze pulls toward the biome's own colour (the
      // background IS the sky here) — pea-green over the swamp, rust over
      // the red desert, violet through the mushroom forest. Halved at night
      // so the dark stays cool rather than colour-washed.
      _atmosFog.setRGB(atmos.fogR, atmos.fogG, atmos.fogB);
      _skyTarget.lerp(_atmosFog, atmos.fogW * (sunState.up ? 1 : 0.5));
      if (scene.background) scene.background.lerp(_skyTarget, k);
      if (scene.fog) scene.fog.color.copy(scene.background);
      // sea glint: the sun's ground direction; strength peaks with the low sun
      glintUni.value.set(-sunState.dx, -sunState.dz, 0.9 * w, (now / 1000) % 3600);
      // sky dome: horizon rides the fog colour, zenith keeps its own blue
      // (dusty violet through the golden hour), and the sun sits at its true
      // azimuth/elevation — a disc you can actually watch set at max zoom
      if (skyMat) {
        const su = skyMat.uniforms;
        su.uHor.value.copy(scene.fog.color);
        if (sunState.up) _zenTarget.setHex(ZEN_DAY).lerp(ZEN_DUSK_C, w);
        else _zenTarget.setHex(ZEN_DAY).multiply(tc);
        // the zenith leans toward the biome air too, at half strength — the
        // red desert's sky reads orange overhead, not just at the horizon
        _zenTarget.lerp(_atmosFog, atmos.fogW * 0.5 * (sunState.up ? 1 : 0.5));
        su.uZen.value.lerp(_zenTarget, k);
        const eA = sunState.elev * Math.PI / 2, cE = Math.cos(eA);
        su.uSunDir.value.set(-sunState.dx * cE, Math.sin(eA), -sunState.dz * cE).normalize();
        su.uSunI.value = sunState.up ? (0.25 + 0.75 * w) * (1 - 0.85 * wxCloudNow) : 0;
      }
    }
    // river flood: when the flood integral (weather.js) has genuinely moved,
    // adopt the new quantized bucket, drop the level/ground caches and queue
    // the carved-water chunks for a rebake — worked off two per frame so a
    // rising river never stalls a frame. Hysteresis (0.18 vs 0.25 buckets)
    // stops the level see-sawing at a bucket boundary.
    if (typeof floodNow === "function") {
      const fl = floodNow();
      if (Math.abs(fl - floodLvl) > 0.18) {
        floodLvl = Math.round(fl * 4) / 4;
        waterLevelCache.clear();
        groundYCache.clear();
        liftCache.clear();   // liftAt caches flood-dependent water/deck levels
        _floodRebuild.length = 0;
        for (const key of chunkMeshes.keys()) {
          const p = key.split(",");
          if (waterBitsFor(+p[0], +p[1]).cw) _floodRebuild.push(key);
        }
      }
      for (let i = 0; i < 2 && _floodRebuild.length; i++) {
        const key = _floodRebuild.pop();
        const group = chunkMeshes.get(key);
        if (!group) continue;
        scene.remove(group);
        group.userData.groundGeom.dispose();
        if (group.userData.wallGeom) group.userData.wallGeom.dispose();
        for (const sm of group.userData.shadowMeshes || []) sm.geometry.dispose();
        for (const eg of group.userData.extraGeoms || []) eg.dispose();
        chunkMeshes.delete(key);   // syncChunks rebuilds it at the new level
      }
    }
    const sy = Math.sin(camYaw), cyw = Math.cos(camYaw);
    // shared billboard orientation: yaw to face the camera, then lean by TILT about
    // the camera-right axis (cos,0,-sin) so the lean stays screen-consistent at every
    // angle — Euler YXZ flipped the tilt sign on back-facing views (upside-down sprites).
    _qYaw.setFromAxisAngle(_up, camYaw);
    // the sprite lean eases off as the zoom-tilt levels the camera — a full
    // HD-2D lean against a near-horizontal view reads as sprites lying down
    tiltK = tiltKFor(camZoom);
    _qTilt.setFromAxisAngle(_tiltAxis.set(cyw, 0, -sy), TILT * (1 - 0.75 * tiltK));
    _bbQuat.multiplyQuaternions(_qTilt, _qYaw);
    // --- world + entities ---
    // wading in deep water sinks the body below the surface (playerSinkY:
    // quarter step per 1% of seabed altitude below the coast; 0 on land,
    // decks, boats and rivers)
    playerSink = typeof playerSinkY === "function" ? playerSinkY() : 0;
    playerLiftY = ((player.level | 0) > 0
      // upstairs: stack storeys from the ground-floor SLAB. A building spanning a
      // river carries its floor on piers at DECK height (deckAt), not the riverbed
      // groundY — using groundY dropped the player through the floor on the way up.
      ? ((() => { const d = deckAt(player.x, player.y);
          return (d != null ? d : groundY(player.x, player.y)); })()
          + (player.level | 0) * STOREY_H + 0.02)
      // sailing rides the water surface (groundY); on a two-level tile the
      // player's deck/under state picks the deck slab or the bank below it
      : player.sailing ? groundY(player.x, player.y) + 0.45
      : (() => {
          const d = deckAt(player.x, player.y);
          // under the span (deck === false) the player follows the bank or
          // water surface — groundY, never liftAt (liftAt returns the deck
          // for water tiles, which teleported under-walkers up on top)
          return d != null && player.deck !== false ? d
            : d != null ? groundY(player.x, player.y)
            : liftAt(player.x, player.y);
        })()) - playerSink;
    // riding a placed vessel (ridingEnt): raise the character onto the deck — the
    // hull stays at the water line in syncPlaced — so they stand ON the raft
    // instead of at its front edge / the water. (player.sailing has its own +0.45.)
    if (typeof ridingEnt === "function" && !player.sailing && ridingEnt()) playerLiftY += 0.4;
    _fpMark("pre");
    syncChunks(); _fpMark("syncChunks");
    syncNodes(); _fpMark("syncNodes");
    tickAltarShimmer();
    syncPlaced();
    syncDecor(); _fpMark("syncDecor");
    syncStructures(); _fpMark("syncStructures");
    syncEntities(); _fpMark("syncEntities");
    syncFlow(); _fpMark("syncFlow");
    syncFarLod(); _fpMark("syncFarLod");
    syncClouds(wfog, dt); _fpMark("syncClouds");
    syncWaterfalls();
    sweep(); _fpMark("sweep");
    // --- place the camera exactly on its orbit circle (no chord dip = no nausea) ---
    const _cz = camZoom;
    const dist = 9.6 * _cz, hgt = 9.2 * _cz, fb = 0.5 * _cz;
    camera.position.set(followX + sy * dist, hgt + followY, followZ + cyw * dist);
    camPos.copy(camera.position);
    // zoom-tilt: raising the aim point levels the view (~44° down at the
    // default zoom → ~21° at max), bringing the horizon and sky into frame
    camera.lookAt(followX + sy * fb, 0.4 + followY + 6.2 * _cz * tiltK, followZ + cyw * fb);
    // rain closes the fog in (a downpour swallows the horizon); overcast
    // alone hazes it only slightly. The tilt pushes the fog far out so the
    // far terrain ring reads as a vista instead of an abrupt backdrop.
    const fogK = wfog ? Math.max(0.45, 1 - wfog.precip * 0.4 - wfog.cloud * 0.08) : 1;
    scene.fog.near = 28 * _cz * fogK;
    scene.fog.far = (52 * _cz + 380 * tiltK) * fogK;
    seaHazeUni.value.set(scene.fog.near, scene.fog.far);
    glintCamUni.value.copy(camera.position);   // glint path radiates from the eye
    if (skyDome) skyDome.position.copy(camera.position);
    _fpMark("camera");
    renderer.render(scene, camera); _fpMark("glRender");
    drawOverlay(); _fpMark("overlay");
  }

  // lightweight runtime diagnostics (leak hunting / perf triage from the console)
  function _structDetail() {
    const out = [];
    for (const [key, r] of structs) {
      out.push({
        key, baseY: r.baseY, groupVisible: r.group.visible,
        roofVisible: r.roofGroup ? r.roofGroup.visible : null,
        vols: r.vols,
        storeys: r.storeyGroups.map(sg => ({
          groupVis: sg.group.visible,
          walls: sg.wallMeshes ? sg.wallMeshes.map(w => w.visible) : null,
          flatVis: sg.flat ? sg.flat.visible : null,
        })),
      });
    }
    return out;
  }
  function _diag() {
    let structGeoms = 0;
    for (const r of structs.values()) structGeoms += r.geoms.length;
    return {
      meshes: meshes.size,
      chunks: chunkMeshes.size,
      structs: structs.size,
      structGeoms,
      glGeoms: renderer ? renderer.info.memory.geometries : -1,
      glTex: renderer ? renderer.info.memory.textures : -1,
      calls: renderer ? renderer.info.render.calls : -1,
      gyPerf: { ...gyPerf },
      wlPerf: { ...wlPerf },
      framePerf: JSON.parse(JSON.stringify(framePerf)),
    };
  }

  // On-demand close-up snapshot of the live scene at a tile (the object
  // workshop's billboard for 3D-geometry objects: doors, gates, ladders,
  // portals, obstacles). Renders the retained scene once with a temporary
  // camera into a small offscreen render target and returns the pixels as a
  // canvas (or null off-ready). yaw (radians) picks which side the camera
  // shoots from — omit it for the live camera's orbit side; the workshop
  // sweeps 0..2π to build a full 8-direction billboard set.
  let _shotRT = null, _shotCam = null;
  function snapshotTile(tx, ty, px, yaw) {
    if (!ready || !renderer) return null;
    px = px || 144;
    if (!_shotRT || _shotRT.width !== px) {
      if (_shotRT) _shotRT.dispose();
      _shotRT = new THREE.WebGLRenderTarget(px, px);
    }
    if (!_shotCam) _shotCam = new THREE.PerspectiveCamera(38, 1, 0.1, 1600);
    const wx = tx + 0.5, wz = ty + 0.5;
    const base = liftAt(tx, ty);
    const a = yaw == null ? camYaw : yaw;
    const sy = Math.sin(a), cyw = Math.cos(a);
    const d = 3.4;
    _shotCam.position.set(wx + sy * d, base + 2.4, wz + cyw * d);
    _shotCam.lookAt(wx, base + 0.9, wz);
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(_shotRT);
    renderer.render(scene, _shotCam);
    const buf = new Uint8Array(px * px * 4);
    renderer.readRenderTargetPixels(_shotRT, 0, 0, px, px, buf);
    renderer.setRenderTarget(prevRT);
    // GL rows are bottom-up — flip into canvas order
    const cv = document.createElement("canvas");
    cv.width = px; cv.height = px;
    const c2 = cv.getContext("2d");
    const id = c2.createImageData(px, px);
    for (let row = 0; row < px; row++)
      id.data.set(buf.subarray(row * px * 4, (row + 1) * px * 4), (px - 1 - row) * px * 4);
    c2.putImageData(id, 0, 0);
    return cv;
  }

  // the renderer's key -> packed-object-art resolution, for the object
  // workshop: which 8-direction objects-sheet entry a prop actually renders
  // with ({idx, scale} or null). FLAT_DECOR keys draw as flat sprites
  // in-game, so they resolve to null here too.
  function objArtFor(key) {
    if (FLAT_DECOR.has(key)) return null;
    return objForKey(key);
  }

  return {
    init, frame, resize, pickTile, buildAtlasAsync, preloadArt, snapshotTile, objArtFor, _diag, _structDetail, _meshLog: meshLog,
    _atlasCells: () => atlas && atlas.cells, _atlasCanvas: () => atlas && atlas.canvas, // TEMP-VERIFY-REMOVE-ME
    _atmos: () => ({ biome: atmos.biome, dens: atmos.dens, parts: atParts.length, grOn: _grOn,
      fogW: +atmos.fogW.toFixed(3), r: +atmos.r.toFixed(3), sat: +atmos.sat.toFixed(3) }),
    _sunDebug: () => ({ ...sunState, bakeKey: sunBakeKey, mats: _shadowMats.size }),
    // altitude probes for gameplay (movement picks deck vs. under level when
    // stepping onto a two-level tile): walkable ground height / deck height
    groundLevel: (x, y) => groundY(x, y),
    deckLevel: (x, y) => deckAt(x, y),
    // community overlay (js/main/proposal-overlay.js): live-patch baked
    // textures with adopted/previewed art. Each queues internally when its
    // target isn't built yet and flushes itself once it is — see the
    // patch/flush/pending helpers next to _finishAtlas, ensureCharTex,
    // ensureObjTex and ensureOutfitSheet above.
    patchAtlasKey, patchCharFrame, patchObjFrame, patchOutfitFrame,
    get ready() { return ready; },
  };
})();
