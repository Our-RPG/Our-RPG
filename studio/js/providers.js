// ===== Taiao Workshop — asset-type providers =====
// One registry, one entry per in-game asset type. Each provider knows how to
// LIST every asset of its type (straight from the game's own data), draw a
// thumbnail, and hand back the raw in-game DATA for that asset — so every
// asset's code data is viewable on the site. The catalog and detail pages are
// generic over these providers.
//
// provider = {
//   type, label, plural, icon,
//   supportsGen,          // can players generate & publish art for this type?
//   dirs,                 // has 8-direction sprites?
//   list(),               // [entry]; entry = {type, key, name, index?, states?}
//   entry(key),           // one entry by key
//   draw(canvas, entry, dirIndex),   // thumbnail (no-op if unrenderable)
//   data(entry),          // raw in-game data object (shown as code)
//   note,                 // optional caveat when a data source isn't reachable
// }
"use strict";

const Providers = (function () {
  const def = typeof OBJ_MAP !== "undefined";

  // ---------------- characters ----------------
  const character = {
    type: "character", label: "Character", plural: "Characters", icon: "🧝",
    supportsGen: true, dirs: true,
    list: () => Roster.characters(),               // playable characters + world NPCs
    entry: key => Roster.charEntry(key),
    draw: (cv, e, di) => Roster.drawEntry(cv, e, di),
    // the playable-character atlas (characters.webp) is PixelLab-generated
    maker: () => (typeof AssetOrigin !== "undefined" ? AssetOrigin.PIXELLAB : { madeBy: "pixellab", maker: "admin" }),
    data: e => ({
      id: e.snake,
      commonName: e.common || e.name,
      sourceKey: e.folder,
      title: e.title || undefined,
      prompt: e.npc ? (e.title || Roster.prettyName(e.folder)) : Roster.prettyName(e.folder),
      classification: Roster.classOf(e),
      states: e.states,
      stats: Roster.stats(e),
    }),
  };

  // ---------------- objects ----------------
  const object = {
    type: "object", label: "Object", plural: "Objects", icon: "🗿",
    catalogTitle: "All world objects",
    supportsGen: true, dirs: true,
    list: () => Roster.listObjs(),
    entry: key => Roster.listObjs().find(e => e.key === key) || null,
    draw: (cv, e, di) => Roster.drawObjThumb(cv, e.key, di),
    // node objects (tree/rock/…) have an SPR key → classify by its sheet; packed
    // objects live on the generated objects.webp atlas → default PixelLab.
    maker: e => (typeof AssetOrigin !== "undefined" ? AssetOrigin.forSprKey(e && e.key) : { madeBy: "pixellab", maker: "admin" }),
    data: e => {
      const d = { key: e.key, name: e.name, frame: (typeof OBJ_MAP !== "undefined" ? OBJ_MAP[e.key] : undefined) };
      if (typeof OBJ_SCALE !== "undefined" && OBJ_SCALE && OBJ_SCALE[e.key] != null) d.scale = OBJ_SCALE[e.key];
      if (typeof SPR !== "undefined" && SPR && SPR[e.key]) d.spr = SPR[e.key];
      return d;
    },
  };

  // ---------------- monsters / tiles / ui / sounds ----------------
  // Filled by js/providers-extra.js once the game data those need is wired in.
  // Until then they list nothing (the tab shows a friendly "not loaded" note)
  // rather than guessing at sheet math.
  const stub = (type, label, plural, icon) => ({
    type, label, plural, icon, supportsGen: false, dirs: false,
    list: () => [], entry: () => null, draw: () => {}, data: () => null,
    note: "This catalog's game data isn't wired in yet.",
  });

  const registry = {
    character, object,
    monster: stub("monster", "Monster", "Monsters", "🐉"),
    tile: stub("tile", "Biome", "Biomes", "🌿"),
    ui: stub("ui", "Icon", "Icons", "🖱️"),
    map: stub("map", "Map icon", "Map", "🗺️"),
    sound: stub("sound", "Sound", "Sounds", "🔊"),
  };

  return {
    get: t => registry[t] || null,
    set: (t, p) => { registry[t] = p; },     // providers-extra.js overrides stubs
    types: () => ["character", "object", "monster", "tile", "ui", "map", "sound"],
    all: () => registry,
  };
})();
