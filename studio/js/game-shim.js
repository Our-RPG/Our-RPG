// ===== Our RPG Workshop — game-data shim =====
// The studio loads a slice of the game's own data layer (data.js, content.js,
// biome-tiles.js, the icon atlases, …) so every in-game asset is browsable
// here. Those files normally sit after js/main/assets.js, which defines the
// per-sheet metadata they poke at (SHEET_KEYS/SHEET_TILE/…). We don't load
// assets.js (it wires the live game canvas), so we predefine that metadata as
// globals first — canonical values copied from js/main/assets.js. Set on the
// global object (not `const`) so the game files' bare references resolve here
// and our own renderer (providers-extra.js) reads the same tables.
"use strict";

window.SHEET_KEYS = window.SHEET_KEYS || ["t", "c", "x", "m", "b", "i", "n", "ta", "tb", "a", "md"];
window.SHEET_TILE = window.SHEET_TILE || { t: 16, c: 16, x: 16, m: 16, b: 32, i: 32, n: 32, ta: 43, tb: 46, a: 64, md: 64, wt: 64, mi: 64, mi2: 64, ga: 64 };
window.SHEET_NOPAD = window.SHEET_NOPAD || new Set(["n", "ml", "fb", "fg", "sp", "tp", "rg"]);
window.SHEET_COLORKEY = window.SHEET_COLORKEY || new Set(["n"]);
window.SHEET_OFFSET = window.SHEET_OFFSET || {};
window.IMGS = window.IMGS || {};

// Every studio page is one folder deep under studio/ (e.g. studio/monsters/cow.html).
// ASSET_BASE reaches the REPO root (repo-relative game assets: "assets/…", "js/…" —
// sprite atlases, sheets, audio). STUDIO_BASE reaches the STUDIO root (studio-relative
// assets: baked zone tiles under studio/assets/zones/, studio workers under studio/js/).
// STUDIO_ROOT (baked per-page by gen_pages) is the hop from this page to the
// studio root; the repo root is one level above that. Falls back to the depth-1
// defaults when a page didn't set it.
var _R = window.STUDIO_ROOT || "../";
window.STUDIO_BASE = window.STUDIO_BASE || _R;
window.ASSET_BASE = window.ASSET_BASE || (_R + "../");
