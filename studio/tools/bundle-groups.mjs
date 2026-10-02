// ===== Our RPG Workshop — bundle group split (single source of truth) =====
// The Workshop is a multi-page static site where every page USED to load one
// monolithic script list (studio/js/page-loader.js's `S`) — the full game data
// layer (~1MB) + every page renderer — even the Home landing page, which needs
// almost none of it. This module is the one place that decides which scripts a
// given page KIND actually needs, so the dev page-loader (gen_pages.mjs bakes it
// in) and the site build (build_site.mjs emits the chunk bundles) stay in sync.
//
// Groups are derived FROM the full list `S` so they never drift as files are
// added/removed:
//   • HOME     — the slim set the Home page boots with (no game data, no heavy
//                content renderers). Home degrades gracefully without the rest:
//                the census counts + sprite frieze are typeof-guarded and get
//                lit up later by the lazy GAMEDATA load (see js/pages/home.js).
//   • GAMEDATA — the game's own data layer (every "../../js/…" entry) plus
//                providers-extra.js (defines SprRender, needs that data). Home
//                pulls this in the BACKGROUND after first paint.
//   • full     — `S` verbatim, for every content page (unchanged — zero risk).

// Studio-root-relative files the Home page loads up front. Order within the
// bundle follows `S`; this set just selects. Every entry here must be free of
// unguarded references to the game data layer (verified: config.js owns CFG +
// DIRS8, game-shim.js owns ASSET_BASE/SHEET_*, and roster/providers degrade via
// typeof guards when the game data globals are absent).
export const HOME_FILES = new Set([
  "../js/game-shim.js",   // ASSET_BASE/STUDIO_BASE + SHEET_* globals (roster reads these)
  "../js/gaps-data.js",   // WORKSHOP_GAPS (the Home "gaps" block)
  "../js/config.js",      // CFG (taiao.js) + DIRS8 (roster.js fallback)
  "../js/util.js",        // el / clear / qsa / escapeHtml
  "../js/store.js",       // local project library (self-contained)
  "../js/pixellab.js",    // PixelLab.hasKey (the account chip in page-shell)
  "../js/taiao.js",       // the account + proposals API (needs CFG)
  "../js/roster.js",      // nav lookups + the frieze; degrades without game data
  "../js/providers.js",   // Nav.lookup → Providers.get; stubs until providers-extra
  "../js/fx.js",          // the hero sky + reveals + count-up + frieze
  "../js/page-shell.js",  // the nav shell + page dispatch
  "../js/pages/home.js",  // the Home renderer itself
]);

// True for the game's own data files (repo js/, loaded as "../../js/…").
export const isGameData = entry => entry.startsWith("../../js/");

// providers-extra.js (SprRender + the monster/tile/ui catalog providers) reads
// the game data layer, so it rides along with the lazy GAMEDATA load.
const GAMEDATA_EXTRA = ["../js/providers-extra.js"];

// Split the full script list `S` into the three groups, preserving S's order.
export function splitGroups(S) {
  const home = S.filter(e => HOME_FILES.has(e));
  const gamedata = S.filter(isGameData).concat(GAMEDATA_EXTRA.filter(e => S.includes(e)));
  return { full: S.slice(), home, gamedata };
}
