// ===== Taiao — assets, canvas, and sprite drawing =====
"use strict";

// ---------- developer mode ----------
// Compile-time only, deliberately unreachable from a player's browser: no
// key toggle, no localStorage flag, no URL parameter. Community developers
// working from a fork of the code enable it by flipping the line below to
// `true` and rebuilding (node tools/build.mjs).
//
// DEV_MODE unlocks the development tools: skills pinned to max, XP off,
// open banks/locks, 1000 of every item, the full bestiary, and the Dev
// sidebar tab (time/weather/snow/flood overrides). It keeps its OWN save
// file (storage.js SAVE_KEY), so flipping it never touches a real save.
const DEV_MODE = false;

// ---------- assets ----------
// Callers (2):
//  main/assets.js:16,18
const SHEET_KEYS = ["t", "c", "x", "m", "b", "i", "n", "ta", "tb", "a", "md"];
// per-sheet tile size (grid pitch is size+1); sheets in SHEET_NOPAD have no inter-tile padding
// Callers (2):
//  main/assets.js:52 render3d.js:28
const SHEET_TILE = { t: 16, c: 16, x: 16, m: 16, b: 32, i: 32, n: 32, ta: 43, tb: 46, a: 64, md: 64 };
// Callers (7):
//  main/assets.js:9,53,54,62 render3d.js:36,37,40
// The six 64px icon sheets are gapless 8-col grids (width = cols*64 exactly, no
// 1px gutters) — reading them at the padded st+1 pitch drifts every cell 1px
// per column/row and clips column 7 outright.
const SHEET_NOPAD = new Set(["n", "ml", "fb", "fg", "sp", "tp", "rg"]);   // sheets with no inter-tile gap
// Callers (1):
//  render3d.js:41
const SHEET_COLORKEY = new Set(["n"]);     // sheets where solid-black means transparent
// Callers (2):
//  main/assets.js:16,25
const SHEET_OPTIONAL = new Set(["a"]);     // atlas taint-probe sheet; render3d falls back to bg_* tiles if absent
// Per-key pixel offset into a PACKED atlas image. Small icon sheets are packed
// whole (layout intact) into one shared webp by tools/pack_sheets.py, which
// generates js/sprites/sheet-pack-data.js to repoint ASSET_DATA[key] at the
// atlas and record each sheet's top-left corner here. Every consumer that
// resolves SPR coords (icon() below, render3d drawSprTo, the world.js map-icon
// blit) adds this offset AFTER the sx/sy math, so per-key tile size, padding
// and explicit rects all keep working unchanged.
// Callers (3):
//  main/assets.js:icon render3d.js:drawSprTo gameplay/world.js:overlayMapIcons
const SHEET_OFFSET = {};
// Callers (12):
//  main/assets.js:29,67,76 render3d.js:26,47,56,59,69,72,98 world/map.js:146,443
const IMGS = {};
// The core terrain/character/object atlases needed for the very first frame.
// Boot BLOCKS on these; every other sheet (inventory/UI icon atlases pushed
// into SHEET_KEYS by the js/sprites/*-data.js files) streams in AFTER boot so
// first paint isn't gated on ~49MB of icon art. Safe because sheets are now
// external URLs (async) and both in-world draws (render3d drawSprTo) and UI
// icons (icon(), below) guard against a not-yet-loaded sheet and self-heal.
// Callers (1):
//  main/assets.js:loadAssets
const CORE_SHEET_KEYS = new Set(SHEET_KEYS.slice());

// Load one sheet into IMGS. IMGS[k] is set immediately (before decode) — every
// consumer checks img.complete/naturalWidth first, so an in-flight image never
// draws garbage. `done` fires on load OR error (a single bad sheet must not
// wedge boot). Keys packed into a shared atlas share ONE Image per URL so the
// atlas is fetched and decoded once, not once per key.
const _sheetImgByUrl = {};
// Fired once a sheet finishes decoding, core or deferred. The community
// overlay (js/main/proposal-overlay.js) listens for this to patch sheets that
// stream in AFTER it already tried and found IMGS[sheet] not ready yet.
function _sheetReady(k) {
  if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent("taiao-sheet-loaded", { detail: { sheet: k } }));
}
function _loadSheet(k, done) {
  const url = ASSET_DATA[k];
  let im = _sheetImgByUrl[url];
  if (im) {
    IMGS[k] = im;
    if (im.complete) { if (done) done(); }
    else if (done) {
      im.addEventListener("load", () => { _sheetReady(k); done(); }, { once: true });
      im.addEventListener("error", () => done(), { once: true });
    }
    return;
  }
  im = new Image();
  _sheetImgByUrl[url] = im;
  im.addEventListener("load", () => { _sheetReady(k); if (done) done(); }, { once: true });
  im.addEventListener("error", () => {
    if (!SHEET_OPTIONAL.has(k)) console.error("Failed to load sprite sheet: " + k + " (" + url + ")");
    if (done) done();
  }, { once: true });
  im.src = url;
  IMGS[k] = im;
}

// Callers (1):
//  main.js:119
function loadAssets(cb) {
  const has = k => typeof ASSET_DATA !== "undefined" && !!ASSET_DATA[k];
  const missing = SHEET_KEYS.filter(k => CORE_SHEET_KEYS.has(k) && !SHEET_OPTIONAL.has(k) && !has(k));
  if (missing.length) throw new Error("Missing core sprite sheet(s): " + missing.join(", "));
  const core = SHEET_KEYS.filter(k => CORE_SHEET_KEYS.has(k) && has(k));
  const deferred = SHEET_KEYS.filter(k => !CORE_SHEET_KEYS.has(k) && has(k));
  let left = core.length;
  const total = core.length;
  const boot = () => {
    left--;
    // live loading-bar progress while the "Decoding sprites…" segment is up
    if (typeof window !== "undefined" && window.__boot) __boot.sub("assets", (total - left) / total);
    if (left > 0) return;
    try { performance.mark("ef:coreSheets"); } catch (e) { /* boot beacon */ }
    cb();   // first frame can render — core atlases are in
    // Stream the icon atlases in the background; as each arrives, drop the icon
    // cache so any placeholder icons rebuild with the real art on the next paint.
    for (const k of deferred) _loadSheet(k, () => {
      for (const key in ICONS) delete ICONS[key];
      if (typeof uiDirty !== "undefined") uiDirty = true;
    });
  };
  if (left === 0) { boot(); return; }   // (boot() calls cb once, then streams)
  for (const k of core) _loadSheet(k, boot);
}

// ---------- canvas ----------
// Callers (37):
//  biome-tiles.js:487 gameplay/input.js:66,73,76,110 gameplay/world.js:361,671
//  main/assets.js:1,33,47,63 main/ui.js:22,84,87,237
//  render3d.js:4,10,43,65,70,85,86,87,88,103,107,115,140,324,326,329,342
//  world/map.js:377,378,379,662,663
const canvas = document.getElementById("game");
// Callers (3):
//  gameplay/input.js:147 gameplay/world.js:600 render3d.js:369
const gamecol = document.getElementById("gamecol");
let REN = null; // set to R3D in init()
// Callers (1):
//  main/assets.js:40
function resizeCanvas() {
  if (REN) REN.resize();
}
window.addEventListener("resize", resizeCanvas);

// item icon cache
// Callers (2):
//  main/assets.js:45,79
const ICONS = {};
// Studio "play with my changes" preview: a player previewing their own icon
// proposals (js/main/proposal-overlay.js) drops replacement 32×32 canvases here
// keyed by SPR key. Checked before ICONS/SPR so it survives the icon-cache
// wipe that streaming sheets trigger. Empty (and untouched) in normal play.
const ICON_OVERRIDE = {};
// Callers (91):
//  content.js:36,37,60,86,90,103,131,132,152,165,182,208,229,247,248,562,563,564
//  data.js:294,295,296,297,298,299,300,301,302,303,304,305,306,307,308,309,310,311,312,313,314,315,316,317,318,319,320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,338,339,340,341,342,343,344,345,346
//  main/assets.js:42 main/ui.js:24,54,89,147,171,197,218,239,258,276,296 render3d.js:450,471,496
//  world.js:9 world/features.js:915,932,934,935
function icon(key) {
  if (ICON_OVERRIDE[key]) return ICON_OVERRIDE[key];
  if (ICONS[key]) return ICONS[key];
  const def = SPR[key];
  const [sheet, c, r, extra] = def;
  // Deferred (non-core) sheets stream in after boot — if this icon's sheet
  // isn't decoded yet, return an UN-cached blank so it rebuilds with real art
  // once the sheet arrives (loadAssets clears ICONS + sets uiDirty on load).
  const sheetImg = IMGS[sheet];
  if (!sheetImg || !sheetImg.complete || sheetImg.naturalWidth === 0) {
    const blank = document.createElement("canvas");
    blank.width = 32; blank.height = 32;
    return blank;
  }
  const cv = document.createElement("canvas");
  cv.width = 32; cv.height = 32;
  const c2 = cv.getContext("2d");
  c2.imageSmoothingEnabled = false;
  const st = SHEET_TILE[sheet] || 16;
  const off = SHEET_OFFSET[sheet];
  const sx = (extra && extra.sx != null ? extra.sx : c * (SHEET_NOPAD.has(sheet) ? st : st + 1)) + (off ? off.ox : 0);
  const sy = (extra && extra.sy != null ? extra.sy : r * (SHEET_NOPAD.has(sheet) ? st : st + 1)) + (off ? off.oy : 0);
  const sw = extra && extra.sw ? extra.sw : st;
  const sh = extra && extra.sh ? extra.sh : st;
  c2.save();
  if (extra && extra.filter) c2.filter = extra.filter;
  if (extra && extra.rot) {
    c2.translate(16, 16); c2.rotate(extra.rot * Math.PI / 180); c2.translate(-16, -16);
  }
  if (SHEET_COLORKEY.has(sheet)) {
    const tmp = document.createElement("canvas");
    tmp.width = 32; tmp.height = 32;
    const tc = tmp.getContext("2d");
    tc.imageSmoothingEnabled = false;
    tc.drawImage(IMGS[sheet], sx, sy, sw, sh, 0, 0, 32, 32);
    const id = tc.getImageData(0, 0, 32, 32);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 12 && d[i + 1] < 12 && d[i + 2] < 12) d[i + 3] = 0;
    }
    tc.putImageData(id, 0, 0);
    c2.drawImage(tmp, 0, 0, 32, 32);
  } else {
    c2.drawImage(IMGS[sheet], sx, sy, sw, sh, 0, 0, 32, 32);
  }
  c2.restore();
  ICONS[key] = cv;
  return cv;
}

// ---------- community overlay hooks ----------
// The rect math icon() (above) and render3d's drawSprTo both do independently
// — pulled out once so the proposal overlay can resolve a SPR key's exact
// sheet pixel rect without duplicating either of them a third time.
// Callers: js/main/proposal-overlay.js
function sprRect(key) {
  const def = SPR[key];
  if (!def) return null;
  const [sheet, c, r, extra] = def;
  const st = SHEET_TILE[sheet] || 16;
  const off = SHEET_OFFSET[sheet];
  const pitch = SHEET_NOPAD.has(sheet) ? st : st + 1;
  const sx = (extra && extra.sx != null ? extra.sx : c * pitch) + (off ? off.ox : 0);
  const sy = (extra && extra.sy != null ? extra.sy : r * pitch) + (off ? off.oy : 0);
  const sw = extra && extra.sw ? extra.sw : st;
  const sh = extra && extra.sh ? extra.sh : st;
  return { sheet, sx, sy, sw, sh };
}

// Bake community art into IMGS[sheet] at the given pixel rects, in place —
// every 2D consumer (map.js, world.js) reads IMGS directly each draw, so a
// swapped-in canvas propagates live with no further plumbing. Returns false
// when the sheet isn't decoded yet (caller should retry on the
// "taiao-sheet-loaded" event); true once patched. IMGS[sheet] may already be
// a patched canvas from an earlier call — drawImage happily takes a canvas
// source, so repeated patches accumulate rather than clobber each other.
// Callers: js/main/proposal-overlay.js
function patchSheetRects(sheet, patches) {
  const img = IMGS[sheet];
  if (!img || !img.complete || img.naturalWidth === 0) return false;
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const cx = cv.getContext("2d");
  cx.imageSmoothingEnabled = false;
  cx.drawImage(img, 0, 0);
  for (const p of patches) {
    cx.clearRect(p.sx, p.sy, p.sw, p.sh);
    cx.drawImage(p.img, p.sx, p.sy, p.sw, p.sh);
  }
  cv.complete = true;
  cv.naturalWidth = cv.width;
  cv.naturalHeight = cv.height;
  IMGS[sheet] = cv;
  for (const k in ICONS) delete ICONS[k];
  if (typeof uiDirty !== "undefined") uiDirty = true;
  return true;
}
