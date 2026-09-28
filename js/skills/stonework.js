// ===== Taiao — Charcoaling · Limeburning · Masonry =====
// The stone-and-fuel branch of the economy, and the biggest consumer of Mining.
//
//   Woodcutting/Sawing → Charcoaling → charcoal (+ wood tar, wood ash)
//   Mining → limestone/stone/clay/sand/marble
//   limestone + charcoal → Limeburning → quicklime → slaked lime → mortar/plaster
//   stone/clay + mortar/bricks → Masonry → walls, ovens, statues, cathedrals
//
// Charcoal fuels the kilns and is burnable; wood tar → pitch (Masonry cisterns);
// wood ash → Limeburning mortars. Every commodity has a consumer. Stone is a
// Mining by-product (see gathering.js) and sold by Sten. Loaded in the early
// data group (before world/chunks.js) so its Mining node/item ids exist.
"use strict";

(function () {
  const CATS = { Charcoaling: "Woodworking", Limeburning: "Stone & Earth", Masonry: "Stone & Earth" };
  for (const s in CATS) if (!SKILLS.includes(s)) SKILLS.push(s);
  Object.assign(SKILL_CATEGORY, CATS);
  Object.assign(RECIPE_VERB, { Charcoaling: "Charred", Limeburning: "Burned", Masonry: "Built" });
  // insert a Stone & Earth category into the display order
  if (typeof SKILL_CATEGORY_ORDER !== "undefined" && !SKILL_CATEGORY_ORDER.includes("Stone & Earth")) {
    const at = SKILL_CATEGORY_ORDER.indexOf("Crafts & Arcana");
    SKILL_CATEGORY_ORDER.splice(at < 0 ? SKILL_CATEGORY_ORDER.length : at, 0, "Stone & Earth");
  }

  let pi = 250;
  const S = (id, name, base, extra, props, note) => {
    if (ITEMS[id]) return;
    defineIcon("i_" + id, base, pi++, extra || "");
    ITEMS[id] = Object.assign({ name, icon: "i_" + id }, props);
    EXAMINE[id] = EXAMINE[id] || `${name}.`;
    registerPlaceholder(id, name, note || "stonework good — tinted placeholder");
  };

  // ---------- raw materials (Mining by-product + Sten) ----------
  S("limestone",      "Limestone",      "i_iron", " brightness(1.25) saturate(0.2)", { stack: true, value: 4 }, "raw stone — tinted placeholder");
  S("building_stone", "Building stone", "i_iron", " brightness(1.05) saturate(0.15)", { stack: true, value: 5 }, "raw stone — tinted placeholder");
  S("marble",         "Marble",         "i_iron", " brightness(1.45) saturate(0.1)", { stack: true, value: 18 }, "raw stone — tinted placeholder");
  S("clay",           "Clay",           "i_copper", " hue-rotate(-15deg) brightness(0.85) saturate(0.7)", { stack: true, value: 4 }, "clay — tinted placeholder");
  S("sand",           "Sand",           "i_gold", " brightness(1.3) saturate(0.4)", { stack: true, value: 3 }, "sand — tinted placeholder");
  // Stone is dug as a Mining by-product (gathering.js consumes this) + shop-sold
  const STONE_DROPS = ["building_stone", "limestone", "clay", "sand", "sandstone",
    "gravel_stone", "granite", "slate", "flint", "chalk", "basalt", "marble"];
  if (typeof window !== "undefined") window.STONE_DROPS = STONE_DROPS;
  if (typeof SHOP_STOCK !== "undefined") SHOP_STOCK.push("limestone", "building_stone", "marble", "clay", "sand");

  // ====================================================================
  // CHARCOALING — char wood into charcoal (passive clamp) + tar/ash by-products
  // ====================================================================
  // Charcoal is PREMIUM fuel: it burns hotter than any wood fire (pushes ~200°
  // past your Firemaking ceiling) and far longer — the fuel of choice for hot,
  // long passive firings (glass, lime, pottery). See fuelStats() in firemaking.js.
  S("charcoal", "Charcoal", "i_logs", " brightness(0.35) saturate(0.4)", { stack: true, value: 8, log: true, logTier: 31, fuel: { premium: true, capBonus: 200, burnBase: 180000 }, prov: "batch" }, "charcoal — tinted placeholder");
  S("wood_tar", "Wood tar", "i_logs", " brightness(0.5) sepia(0.9)", { stack: true, value: 6, prov: "batch" }, "wood tar — tinted placeholder");
  S("wood_ash", "Wood ash", "i_flour", " brightness(0.8) saturate(0.1)", { stack: true, value: 3, prov: "batch" }, "wood ash — tinted placeholder");
  S("pitch",    "Pitch",    "i_logs", " brightness(0.3) sepia(1) saturate(1.4)", { stack: true, value: 12, prov: "batch" }, "pitch — tinted placeholder");
  EXAMINE.charcoal = "Slow-burnt wood — hot, clean kiln fuel.";
  EXAMINE.wood_ash = "Fine ash; a mason's mortars want it.";
  EXAMINE.pitch = "Black and waterproof; seals cisterns and hulls.";
  RECIPES.charcoaling = [];
  const woods = typeof TREES !== "undefined" ? TREES : [{ log: "logs", req: 1 }];
  for (let i = 0; i < 29 && i < woods.length; i++) {
    const log = woods[i].log, req = i + 1;
    RECIPES.charcoaling.push({
      id: "char_" + log, out: "charcoal", qty: 2, name: "Char " + (ITEMS[log] ? ITEMS[log].name.toLowerCase() : "wood"),
      skill: "Charcoaling", req, xp: 18 + req * 3, in: { [log]: 3 }, passive: true, time: 12000 + i * 400, tick: 12000 + i * 400,
      // parity matters: tier 1 ("logs", i=0) MUST land on wood_ash — it's the
      // only log on Tūhura Isle, and the Soapmaker's lye lesson needs ash
      byproducts: [{ id: i % 2 ? "wood_tar" : "wood_ash", qty: 1, chance: 0.7 }],
      family: "charcoal", stations: ["charcoal_clamp", "campfire", "furnace"],
    });
  }
  RECIPES.charcoaling.push(
    { id: "char_offcuts", out: "charcoal", qty: 1, name: "Char sawmill offcuts", skill: "Charcoaling", req: 1, xp: 16,
      in: { wood_offcuts: 4 }, passive: true, time: 10000, tick: 10000, family: "charcoal", stations: ["charcoal_clamp", "campfire"] },
    { id: "distill_pitch", out: "pitch", qty: 2, name: "Distil pitch from tar", skill: "Charcoaling", req: 8, xp: 40,
      in: { wood_tar: 2 }, tick: 1600, family: "pitch", stations: ["charcoal_clamp", "furnace"] },
    { id: "distill_pitch_fine", out: "pitch", qty: 3, name: "Distil fine pitch", skill: "Charcoaling", req: 20, xp: 90,
      in: { wood_tar: 3, charcoal: 1 }, tick: 1800, family: "pitch", stations: ["charcoal_clamp", "furnace"] },
  );

  // ====================================================================
  // LIMEBURNING — limestone + charcoal → quicklime → slaked lime → mortars
  // ====================================================================
  S("quicklime",       "Quicklime",       "i_flour", " brightness(1.2) saturate(0.15)", { stack: true, value: 8, prov: "batch" }, "quicklime — tinted placeholder");
  S("slaked_lime",     "Slaked lime",     "i_flour", " brightness(1.35) saturate(0.05)", { stack: true, value: 10, prov: "batch" }, "lime — tinted placeholder");
  S("hydraulic_lime",  "Hydraulic lime",  "i_flour", " brightness(1.1) sepia(0.2)", { stack: true, value: 16, prov: "batch" }, "lime — tinted placeholder");
  S("mortar",          "Mortar",          "i_flour", " brightness(0.85) saturate(0.1)", { stack: true, value: 12, prov: "batch" }, "mortar — tinted placeholder");
  S("hydraulic_mortar","Hydraulic mortar","i_flour", " brightness(0.75) sepia(0.25)", { stack: true, value: 20, prov: "batch" }, "mortar — tinted placeholder");
  S("lime_plaster",    "Lime plaster",    "i_flour", " brightness(1.15) saturate(0.08)", { stack: true, value: 14, prov: "batch" }, "plaster — tinted placeholder");
  S("whitewash",       "Whitewash",       "i_flour", " brightness(1.5) saturate(0.02)", { stack: true, value: 9, prov: "batch" }, "whitewash — tinted placeholder");
  S("grout",           "Grout",           "i_flour", " brightness(1.0) saturate(0.06)", { stack: true, value: 11, prov: "batch" }, "grout — tinted placeholder");
  // [id, out, name, req, inputs, passive?]
  const L = [
    ["burn_quicklime",      "quicklime", "Burn quicklime",         1,  { limestone: 2, charcoal: 1 }, 1],
    ["quick_whitewash",     "whitewash", "Slake a quick whitewash",2,  { quicklime: 1 }, 0],
    ["slake_lime",          "slaked_lime","Slake lime",            3,  { quicklime: 1 }, 0],
    ["mortar_sand",         "mortar",    "Mix sand mortar",        4,  { slaked_lime: 1, sand: 1 }, 0],
    ["whitewash",           "whitewash", "Make whitewash",         5,  { slaked_lime: 1 }, 0],
    ["mortar_coarse",       "mortar",    "Mix coarse mortar",      6,  { slaked_lime: 1, sand: 2 }, 0],
    ["lime_plaster",        "lime_plaster","Mix lime plaster",     7,  { slaked_lime: 1, sand: 1 }, 0],
    ["burn_quicklime_kiln", "quicklime", "Burn a lime-kiln batch", 8,  { limestone: 3, charcoal: 2 }, 1],
    ["daub",                "mortar",    "Mix daub",               8,  { slaked_lime: 1, clay: 1, sand: 1 }, 0],
    ["mortar_ash",          "mortar",    "Mix ash mortar",         9,  { slaked_lime: 1, sand: 1, wood_ash: 1 }, 0],
    ["grout",               "grout",     "Mix grout",              9,  { slaked_lime: 1, sand: 1 }, 0],
    ["cob",                 "mortar",    "Mix cob",                10, { slaked_lime: 1, clay: 2 }, 0],
    ["slake_lime_batch",    "slaked_lime","Slake a lime batch",    11, { quicklime: 2 }, 0],
    ["ash_plaster",         "lime_plaster","Mix ash plaster",      11, { slaked_lime: 1, sand: 1, wood_ash: 1 }, 0],
    ["mortar_fine",         "mortar",    "Mix fine mortar",        12, { slaked_lime: 2, sand: 1 }, 0],
    ["tinted_whitewash",    "whitewash", "Tint whitewash",         13, { slaked_lime: 1 }, 0],
    ["hydraulic_lime",      "hydraulic_lime","Burn hydraulic lime",14, { quicklime: 1, clay: 1 }, 0],
    ["burn_marble_lime",    "quicklime", "Burn fine marble lime",  14, { marble: 1, charcoal: 1 }, 1],
    ["fine_plaster",        "lime_plaster","Mix fine plaster",     15, { slaked_lime: 2, sand: 1 }, 0],
    ["hydraulic_mortar",    "hydraulic_mortar","Mix hydraulic mortar",16,{ hydraulic_lime: 1, sand: 1 }, 0],
    ["fine_grout",          "grout",     "Mix fine grout",         17, { slaked_lime: 2, sand: 1 }, 0],
    ["render",              "lime_plaster","Mix render",           18, { slaked_lime: 2, sand: 2 }, 0],
    ["lime_wash_fine",      "whitewash", "Make fine limewash",     19, { slaked_lime: 1 }, 0],
    ["marine_mortar",       "hydraulic_mortar","Mix marine mortar",20, { hydraulic_lime: 1, sand: 1, wood_ash: 1 }, 0],
    ["stucco",              "lime_plaster","Mix stucco",           21, { slaked_lime: 2, sand: 2 }, 0],
    ["tabby",               "hydraulic_mortar","Mix tabby",        22, { hydraulic_lime: 1, sand: 2 }, 0],
    ["pit_lime",            "slaked_lime","Pit-slake lime",        23, { quicklime: 2 }, 0],
    ["pozzolana",           "hydraulic_lime","Mix pozzolana",      24, { quicklime: 1, clay: 2 }, 0],
    ["quicklime_industrial","quicklime", "Fire an industrial kiln",26, { limestone: 4, charcoal: 3 }, 1],
    ["hydraulic_industrial","hydraulic_lime","Burn hydraulic (industrial)",28,{ quicklime: 2, clay: 2 }, 0],
    ["master_mortar",       "mortar",    "Mix master mortar",      30, { slaked_lime: 3, sand: 2 }, 0],
    ["cathedral_mortar",    "hydraulic_mortar","Mix cathedral mortar",32,{ hydraulic_lime: 2, sand: 2, wood_ash: 2 }, 0],
  ];
  // Each of the 32 limeburning recipes now yields its OWN distinct product item
  // ("lp_<recipeId>"), registered into ITEM_FAMILY under its base commodity (the old
  // shared out id) so any variant still satisfies a recipe/structure that asks for the
  // base — see the family shim in production.js. Icons default to the base's placeholder
  // until the authored "lb" sheet repoints each by id.
  const LIME_NAME = {
    burn_quicklime: "Quicklime", quick_whitewash: "Quick whitewash", slake_lime: "Slaked lime",
    mortar_sand: "Sand mortar", whitewash: "Whitewash", mortar_coarse: "Coarse mortar",
    lime_plaster: "Lime plaster", burn_quicklime_kiln: "Kiln quicklime", daub: "Daub",
    mortar_ash: "Ash mortar", grout: "Grout", cob: "Cob", slake_lime_batch: "Batch-slaked lime",
    ash_plaster: "Ash plaster", mortar_fine: "Fine mortar", tinted_whitewash: "Tinted whitewash",
    hydraulic_lime: "Hydraulic lime", burn_marble_lime: "Marble lime", fine_plaster: "Fine plaster",
    hydraulic_mortar: "Hydraulic mortar", fine_grout: "Fine grout", render: "Render",
    lime_wash_fine: "Fine limewash", marine_mortar: "Marine mortar", stucco: "Stucco",
    tabby: "Tabby mortar", pit_lime: "Pit-slaked lime", pozzolana: "Pozzolana",
    quicklime_industrial: "Industrial quicklime", hydraulic_industrial: "Industrial hydraulic lime",
    master_mortar: "Master mortar", cathedral_mortar: "Cathedral mortar",
  };
  RECIPES.limeburning = L.map(([id, out, name, req, inp, passive]) => {
    const vid = "lp_" + id;
    if (!ITEMS[vid]) {
      const vn = LIME_NAME[id] || name;
      ITEMS[vid] = { name: vn, icon: (ITEMS[out] && ITEMS[out].icon) || "i_flour", stack: true,
        value: ((ITEMS[out] && ITEMS[out].value) || 10) + req, prov: "batch" };
      if (typeof EXAMINE !== "undefined") EXAMINE[vid] = vn + ".";
    }
    if (typeof window !== "undefined") { window.ITEM_FAMILY = window.ITEM_FAMILY || {}; window.ITEM_FAMILY[vid] = out; }
    const r = { id, out: vid, name, skill: "Limeburning", req, xp: 18 + req * 3, in: inp, tick: passive ? (14000 + req * 300) : (1500 + req * 20),
      family: out, stations: ["lime_kiln", "furnace"] };
    if (passive) { r.passive = true; r.time = 14000 + req * 300; }
    return r;
  });

  // ====================================================================
  // MASONRY — dress stone, fire bricks/tiles, build structures with mortar
  // ====================================================================
  S("dressed_stone",  "Dressed stone",  "i_iron", " brightness(1.0) saturate(0.12)", { stack: true, value: 12, prov: "batch" }, "dressed stone — tinted placeholder");
  S("dressed_marble", "Dressed marble", "i_iron", " brightness(1.4) saturate(0.08)", { stack: true, value: 40, prov: "batch" }, "dressed marble — tinted placeholder");
  S("bricks",         "Bricks",         "i_copper", " hue-rotate(-8deg) saturate(1.1) brightness(0.85)", { stack: true, value: 8, prov: "batch" }, "bricks — tinted placeholder");
  S("roof_tiles",     "Roof tiles",     "i_copper", " hue-rotate(-14deg) saturate(1.2) brightness(0.8)", { stack: true, value: 9, prov: "batch" }, "roof tiles — tinted placeholder");
  S("floor_tiles",    "Floor tiles",    "i_copper", " hue-rotate(6deg) saturate(0.9) brightness(0.9)", { stack: true, value: 9, prov: "batch" }, "floor tiles — tinted placeholder");
  const STRUCT_NAMES = {
    cobblestone_paving: "Cobblestone paving", brick_wall: "Brick wall", stone_wall: "Stone wall",
    stone_pillar: "Stone pillar", stone_archway: "Stone archway", stone_column: "Stone column",
    fireplace: "Fireplace", chimney: "Chimney", bread_oven: "Bread oven", masonry_kiln: "Kiln",
    stone_well: "Stone well", cistern: "Cistern", fountain: "Fountain", marble_statue: "Marble statue",
    gargoyle: "Gargoyle", obelisk: "Obelisk", tombstone: "Tombstone", altar_stone: "Altar stone",
    hearthstone: "Hearthstone", aqueduct_arch: "Aqueduct arch", stone_bridge_span: "Stone bridge span",
    keep_wall: "Keep wall", rampart: "Rampart", plastered_wall: "Plastered wall",
    tiled_floor: "Tiled floor", tiled_roof: "Tiled roof", cathedral_masonry: "Cathedral masonry",
  };
  // [id, out, name, family, req, inputs, kind]  kind: c=commodity(stack) f=finished p=passive-fired
  const M = [
    ["dress_stone",   "dressed_stone",  "Dress a stone block", "dressing", 1,  { building_stone: 1 }, "c"],
    ["make_bricks",   "bricks",         "Fire bricks",         "brickwork", 3, { clay: 2, charcoal: 1 }, "p"],
    ["make_roof_tiles","roof_tiles",    "Fire roof tiles",     "brickwork", 6, { clay: 2, charcoal: 1 }, "p"],
    ["make_floor_tiles","floor_tiles",  "Fire floor tiles",    "brickwork", 7, { clay: 2, charcoal: 1 }, "p"],
    ["dress_marble",  "dressed_marble", "Dress marble",        "dressing", 12, { marble: 1 }, "c"],
    ["lay_cobbles",   "cobblestone_paving","Lay cobblestones", "structures", 2, { building_stone: 2, mortar: 1 }, "f"],
    ["build_tombstone","tombstone",     "Carve a tombstone",   "monuments", 5, { dressed_stone: 2 }, "f"],
    ["build_brick_wall","brick_wall",   "Build a brick wall",  "structures", 5, { bricks: 4, mortar: 2 }, "f"],
    ["build_hearth",  "hearthstone",    "Lay a hearthstone",   "structures", 6, { dressed_stone: 3, mortar: 1 }, "f"],
    ["build_stone_wall","stone_wall",   "Build a stone wall",  "structures", 8, { dressed_stone: 4, mortar: 2 }, "f"],
    ["build_well",    "stone_well",     "Build a stone well",  "structures", 8, { dressed_stone: 4, mortar: 2 }, "f"],
    ["build_fireplace","fireplace",     "Build a fireplace",   "structures", 9, { dressed_stone: 4, mortar: 2 }, "f"],
    ["build_pillar",  "stone_pillar",   "Raise a stone pillar","structures", 10, { dressed_stone: 3, mortar: 1 }, "f"],
    ["build_chimney", "chimney",        "Build a chimney",     "structures", 11, { bricks: 6, mortar: 2 }, "f"],
    ["build_oven",    "bread_oven",     "Build a bread oven",  "structures", 12, { bricks: 8, mortar: 3 }, "f"],
    ["build_archway", "stone_archway",  "Build an archway",    "structures", 13, { dressed_stone: 5, mortar: 2 }, "f"],
    ["build_kiln",    "masonry_kiln",   "Build a kiln",        "structures", 14, { bricks: 10, mortar: 3, hydraulic_mortar: 1 }, "f"],
    ["build_column",  "stone_column",   "Carve a stone column","structures", 15, { dressed_stone: 4, mortar: 2 }, "f"],
    ["build_altar",   "altar_stone",    "Build an altar stone","monuments", 16, { dressed_stone: 4, dressed_marble: 1, mortar: 1 }, "f"],
    ["build_plaster_wall","plastered_wall","Plaster a wall",   "finishing", 17, { stone_wall: 1, lime_plaster: 2, whitewash: 1 }, "f"],
    ["build_cistern", "cistern",        "Build a cistern",     "structures", 18, { dressed_stone: 6, hydraulic_mortar: 2, pitch: 1 }, "f"],
    ["build_tiled_floor","tiled_floor", "Lay a tiled floor",   "finishing", 19, { floor_tiles: 6, grout: 2 }, "f"],
    ["build_fountain","fountain",       "Build a fountain",    "monuments", 20, { dressed_marble: 3, dressed_stone: 4, mortar: 2 }, "f"],
    ["build_tiled_roof","tiled_roof",   "Tile a roof",         "finishing", 21, { roof_tiles: 8, mortar: 2 }, "f"],
    ["build_statue",  "marble_statue",  "Sculpt a marble statue","monuments", 22, { dressed_marble: 4, mortar: 1 }, "f"],
    ["build_gargoyle","gargoyle",       "Carve a gargoyle",    "monuments", 24, { dressed_marble: 3 }, "f"],
    ["build_bridge",  "stone_bridge_span","Build a bridge span","structures", 25, { dressed_stone: 10, mortar: 3 }, "f"],
    ["build_obelisk", "obelisk",        "Raise an obelisk",    "monuments", 26, { dressed_stone: 8, mortar: 3 }, "f"],
    ["build_rampart", "rampart",        "Build a rampart",     "structures", 27, { dressed_stone: 12, bricks: 6, mortar: 4 }, "f"],
    ["build_aqueduct","aqueduct_arch",  "Build an aqueduct arch","structures", 28, { dressed_stone: 12, hydraulic_mortar: 3 }, "f"],
    ["build_keep",    "keep_wall",      "Build a keep wall",   "structures", 30, { dressed_stone: 14, mortar: 4 }, "f"],
    ["build_cathedral","cathedral_masonry","Raise cathedral masonry","monuments", 32, { dressed_stone: 20, dressed_marble: 6, bricks: 10, hydraulic_mortar: 4, lime_plaster: 4, whitewash: 2 }, "f"],
  ];
  RECIPES.masonry = M.map(([id, out, name, family, req, inp, kind]) => {
    if (!ITEMS[out]) {
      if (kind === "f") {
        defineIcon("i_" + out, "i_planks", pi++, ` hue-rotate(${(req * 17) % 60 - 20}deg) saturate(0.5) brightness(${1 - req * 0.004})`);
        ITEMS[out] = { name: STRUCT_NAMES[out] || out, icon: "i_" + out, value: 40 + req * 20, finished: true };
      } else {
        // dressed_stone/marble/bricks/tiles created above via S(); nothing to do
      }
      EXAMINE[out] = EXAMINE[out] || `${STRUCT_NAMES[out] || out}.`;
      if (ITEMS[out]) registerPlaceholder(out, STRUCT_NAMES[out] || out, "masonry good — tinted placeholder");
    }
    const r = { id, out, name, skill: "Masonry", req, xp: 24 + req * 5, in: inp, tick: kind === "p" ? (10000 + req * 200) : (2000 + req * 40),
      family, stations: ["masons_yard", "workbench", "anvil"] };
    if (kind === "p") { r.passive = true; r.time = 10000 + req * 200; }
    return r;
  });

  // ---------- workstations ----------
  Object.assign(STATIONS, {
    charcoal_clamp: { name: "Charcoal clamp", spr: "campfire", action: "Char", lists: ["charcoaling"], quality: 55 },
    lime_kiln:      { name: "Lime kiln",      spr: "furnace",  action: "Burn lime", lists: ["limeburning"], quality: 60 },
    masons_yard:    { name: "Mason's yard",   spr: "anvil",    action: "Build",  lists: ["masonry"], quality: 60 },
  });
  STATIONS.furnace.lists.push("charcoaling", "limeburning");
  STATIONS.campfire.lists.push("charcoaling");
  STATIONS.workbench.lists.push("masonry");

  Object.assign(PROD_SKILL_INTRO, {
    Charcoaling: "Stack wood in a clamp and char it slowly into charcoal — the clean, hot fuel the kilns and forges want — collecting wood tar and ash as by-products, and distilling tar into waterproof pitch. Charring takes real time at the clamp.",
    Limeburning: "Burn limestone with charcoal in a kiln to make quicklime, slake it into lime, and mix the mortars, plasters, whitewashes and grouts every mason needs — including hydraulic lime that sets underwater.",
    Masonry: "Dress stone and marble, fire clay into bricks and tiles, and raise everything from cobbled roads and brick walls to bread ovens, fountains, marble statues and whole cathedrals — bound with the limeburner's mortar.",
  });

  for (const cat in RECIPES) RECIPES[cat].forEach((r, i) => {
    if (!r.id) r.id = cat + ":" + (r.out || i) + ":" + i;
    if (!r.family) r.family = cat;
  });
})();
