// ===== Taiao — specialised production economy (data) =====
// Loaded after content.js. This is DATA only — the generic engine in
// production.js runs it. It adds narrow artisan professions (recognisable
// trades, one stage of manufacture each) and the interconnected chains that
// link them, using the existing 1..99-authored / scaleLevel() convention.
//
//   Farming → barley ─┐
//   Malting → malt ───┴→ Milling → malt grist → Brewing → ale ─┐
//   Woodcutting → oak logs → Sawing → oak staves → Seasoning →  │→ Coopering
//   Mining → iron → Smelting → iron bar → Smithing → iron hoops ┘   → barrel
//   ale + barrel → Brewing (barrel the ale) → Barrel of Ale
//
// The Barrel of Ale is an individual finished good that remembers its whole
// production history (every producer and input) through provenance references.
"use strict";

// ---- resolve a couple of existing generated ids we build on top of ----
const OAK_LOG = (typeof TREES !== "undefined" && (TREES.find(t => t.name === "Oak") || {}).log) || "log_1";
const BARLEY = (typeof GRAINS !== "undefined" && (GRAINS.find(g => g.name === "Barley") || {}).grain) || "grain_1";

// ---- placeholder-sprite registry ----
// Many new production goods don't have bespoke pixel art yet — they reuse a
// tinted copy of an existing sprite as a stand-in. Every such item is recorded
// here so real art can be commissioned later. Inspect in the console with
// listPlaceholderSprites(), or see docs/placeholder-sprites.md.
const PLACEHOLDER_SPRITES = [];
function registerPlaceholder(id, name, note) { PLACEHOLDER_SPRITES.push({ id, name, note }); }
if (typeof window !== "undefined") {
  window.PLACEHOLDER_SPRITES = PLACEHOLDER_SPRITES;
  window.listPlaceholderSprites = () => { console.table(PLACEHOLDER_SPRITES); return PLACEHOLDER_SPRITES; };
}

// ---------- new professions + a clean category for every skill ----------
// The Skills UI groups by category (see main/ui.js) and MUST tolerate a dynamic
// skill count — nothing is hard-coded to 29 any more.
const NEW_SKILLS = ["Sawing", "Seasoning", "Coopering", "Malting", "Brewing", "Baking"];
for (const s of NEW_SKILLS) if (!SKILLS.includes(s)) SKILLS.push(s);

const SKILL_CATEGORY = {
  Melee: "Combat", Strength: "Combat", Defence: "Combat", Archery: "Combat", Magic: "Combat", Health: "Combat",
  Woodcutting: "Gathering", Mining: "Gathering", Fishing: "Gathering", Foraging: "Gathering", Farming: "Gathering",
  Milling: "Food & Drink", Malting: "Food & Drink", Brewing: "Food & Drink", Baking: "Food & Drink",
  Cooking: "Food & Drink",
  Sawing: "Woodworking", Seasoning: "Woodworking", Coopering: "Woodworking", Carpentry: "Woodworking", Fletching: "Woodworking",
  Smelting: "Metalworking", Weaponsmithing: "Metalworking", Armoursmithing: "Metalworking", Jewelry: "Metalworking",
  Textiles: "Textiles & Leather", Tanning: "Textiles & Leather",
  Crafting: "Crafts & Arcana", Potionmaking: "Crafts & Arcana", Alchemy: "Crafts & Arcana", Runecrafting: "Crafts & Arcana",
  Agility: "Utility", Sailing: "Utility",
};
const SKILL_CATEGORY_ORDER = ["Combat", "Gathering", "Food & Drink", "Woodworking",
  "Metalworking", "Textiles & Leather", "Crafts & Arcana", "Utility", "Other"];

// verbs used to phrase provenance ("Coopered by Rowan", "Milled by Mira")
const RECIPE_VERB = {
  Milling: "Milled", Malting: "Malted", Brewing: "Brewed", Baking: "Baked",
  Coopering: "Coopered", Sawing: "Sawn", Seasoning: "Seasoned", Weaponsmithing: "Forged", Armoursmithing: "Forged",
  Smelting: "Smelted", Cooking: "Cooked", Tanning: "Tanned", Textiles: "Woven",
  Carpentry: "Built", Fletching: "Fletched", Jewelry: "Crafted", Crafting: "Crafted",
  Potionmaking: "Brewed", Runecrafting: "Bound",
};

// ---------- intermediate & finished goods ----------
// Intermediate goods are REAL, tradeable items — the economy depends on them
// having value. defineIcon() (from content.js) makes tinted sprite variants.
defineIcon("i_boards", "i_planks", 6, " brightness(1.05)");
defineIcon("i_oakboards", "i_planks", 3, " sepia(0.35) brightness(0.92)");
defineIcon("i_staves", "i_planks", 9, " brightness(0.98)");
defineIcon("i_seasoned", "i_planks", 3, " sepia(0.5) brightness(0.8)");
defineIcon("i_offcuts", "i_logs", 5, " brightness(1.1)");
defineIcon("i_hoops", "i_bar_fe", 8, " brightness(0.95)");
defineIcon("i_malt", "i_wheat", 7, " sepia(0.6) brightness(0.72)");
defineIcon("i_darkmalt", "i_wheat", 14, " sepia(0.9) brightness(0.5)");
defineIcon("i_grist", "i_flour", 6, " sepia(0.4) brightness(0.85)");
defineIcon("i_darkgrist", "i_flour", 13, " sepia(0.7) brightness(0.6)");
defineIcon("i_bran", "i_flour", 2, " sepia(0.3) brightness(1.12)");
defineIcon("i_ale", "i_pot_hp", 9, " hue-rotate(18deg) saturate(1.6) brightness(0.95)");
defineIcon("i_darkale", "i_pot_hp", 9, " hue-rotate(-18deg) saturate(1.7) brightness(0.55)");
// barrel-of-ale: a tinted copy of the world "barrel" sprite (placeholder)
const _bl = SPR.barrel;
SPR.i_barrel_ale = [_bl[0], _bl[1], _bl[2], { filter: "hue-rotate(-18deg) saturate(1.4) brightness(0.85)" }];

Object.assign(ITEMS, {
  // wood processing
  boards:          { name: "Wooden boards",   icon: "i_boards",   stack: true, value: 8, prov: "batch" },
  oak_boards:      { name: "Oak boards",       icon: "i_oakboards", stack: true, value: 14, prov: "batch" },
  oak_staves:      { name: "Oak staves",       icon: "i_staves",   stack: true, value: 20, prov: "batch" },
  seasoned_staves: { name: "Seasoned oak staves", icon: "i_seasoned", stack: true, value: 34, prov: "batch" },
  wood_offcuts:    { name: "Wood offcuts",     icon: "i_offcuts",  stack: true, value: 2, log: true, logTier: 0 },
  // metal fittings
  iron_hoops:      { name: "Iron hoops",       icon: "i_hoops",    stack: true, value: 22, prov: "batch" },
  // grain processing
  malt:            { name: "Pale malt",        icon: "i_malt",     stack: true, value: 12, prov: "batch" },
  dark_malt:       { name: "Dark malt",        icon: "i_darkmalt", stack: true, value: 20, prov: "batch" },
  malt_grist:      { name: "Malt grist",       icon: "i_grist",    stack: true, value: 15, prov: "batch" },
  dark_grist:      { name: "Dark grist",       icon: "i_darkgrist", stack: true, value: 24, prov: "batch" },
  bran:            { name: "Bran",             icon: "i_bran",     stack: true, value: 3 },
  // brewing
  ale:             { name: "Ale",              icon: "i_ale",      stack: true, value: 26, heals: 4, prov: "batch" },
  dark_ale:        { name: "Dark ale",         icon: "i_darkale",  stack: true, value: 40, heals: 6, prov: "batch" },
  // cooperage vessels are generated below (COOPER_VESSELS). This is the one
  // finished brewing good that isn't a bare vessel:
  barrel_of_ale:   { name: "Barrel of ale",    icon: "i_barrel_ale", value: 320, finished: true },
});
Object.assign(EXAMINE, {
  boards: "Rough-sawn planks, straight from the sawmill.",
  oak_boards: "Close-grained oak, ready to be cut into staves.",
  oak_staves: "Curved staves — a cooper's raw material.",
  seasoned_staves: "Air-dried until stable. Won't warp in a finished cask.",
  wood_offcuts: "Sawmill scraps. Good kindling, or feed a charcoal clamp.",
  iron_hoops: "Forged bands that bind a barrel together.",
  malt: "Kilned barley, sweet and biscuity. The soul of good ale.",
  dark_malt: "Roasted dark — for stouts and porters.",
  malt_grist: "Cracked malt, ready for the mash.",
  dark_grist: "Coarse-milled dark malt.",
  bran: "The husk left after milling. Livestock love it.",
  ale: "A honest pint. Heals a little.",
  dark_ale: "Rich and roasty. Heals a bit more.",
  barrel_of_ale: "A full barrel of ale. Ask the innkeep who made it — it remembers.",
});

// Register the intermediate goods above as placeholders (they reuse tinted
// copies of existing sprites until bespoke art exists).
[["boards", "Wooden boards"], ["oak_boards", "Oak boards"], ["oak_staves", "Oak staves"],
 ["seasoned_staves", "Seasoned oak staves"], ["wood_offcuts", "Wood offcuts"], ["iron_hoops", "Iron hoops"],
 ["malt", "Pale malt"], ["dark_malt", "Dark malt"], ["malt_grist", "Malt grist"], ["dark_grist", "Dark grist"],
 ["bran", "Bran"], ["ale", "Ale"], ["dark_ale", "Dark ale"], ["barrel_of_ale", "Barrel of ale"],
].forEach(([id, name]) => registerPlaceholder(id, name, "reused tinted sprite of an existing item"));

// ---------- new workstations (data-driven; grade drives quality) ----------
// Recipes list valid workstationTypes via .stations. For immediate playability
// the new recipes are ALSO hosted on existing town stations (see below), so you
// don't need a dedicated sawmill to start — but the graded stations exist for
// world-gen to place later, and higher-grade stations make better goods.
Object.assign(STATIONS, {
  sawmill:      { name: "Sawmill",      spr: "workbench", action: "Saw",     lists: ["sawing"], quality: 60 },
  seasoning_yard:{ name: "Seasoning yard", spr: "tanrack", action: "Season", lists: ["seasoning"], quality: 55 },
  cooperage:    { name: "Cooperage",    spr: "workbench", action: "Cooper",  lists: ["coopering"], quality: 65 },
  malthouse:    { name: "Malthouse",    spr: "furnace",   action: "Malt",    lists: ["malting"], quality: 60 },
  brewery:      { name: "Brewery",      spr: "cauldron",  action: "Brew",    lists: ["brewing"], quality: 65 },
  bakehouse:    { name: "Bakehouse",    spr: "campfire",  action: "Bake",    lists: ["baking"], quality: 60 },
});
// grade the existing stations too, so quality has something to read
STATIONS.workbench.quality = 45; STATIONS.mill.quality = 50; STATIONS.cauldron.quality = 50;
STATIONS.tanrack.quality = 50; STATIONS.furnace.quality = 55; STATIONS.anvil.quality = 55; STATIONS.campfire.quality = 40;
// host the new trades on existing town stations for reachability
STATIONS.workbench.lists.push("sawing", "seasoning", "coopering");
STATIONS.mill.lists.push("malting");            // hand-mill can also malt-kiln in a pinch
STATIONS.cauldron.lists.push("brewing");
STATIONS.furnace.lists.push("malting", "baking");
STATIONS.campfire.lists.push("baking");
STATIONS.tanrack.lists.push("seasoning");

// ---------- recipes (the specialised production chains) ----------
// helper: xp on the existing RuneScape-scale, req authored 1..99 via scaleLevel
const P = (o) => o; // identity, just documents "production recipe" intent
RECIPES.sawing = [
  { id: "saw_boards", out: "boards", qty: 3, byproducts: [{ id: "wood_offcuts", qty: 1 }],
    name: "Saw planks into boards", skill: "Sawing", req: scaleLevel(1), xp: 24,
    in: { logs: 1 }, tick: 1300, family: "boards", stations: ["sawmill", "workbench"] },
  { id: "saw_oak_boards", out: "oak_boards", qty: 3, byproducts: [{ id: "wood_offcuts", qty: 1 }],
    name: "Saw oak boards", skill: "Sawing", req: scaleLevel(12), xp: 55,
    in: { [OAK_LOG]: 1 }, tick: 1500, family: "boards", stations: ["sawmill", "workbench"] },
  { id: "saw_oak_staves", out: "oak_staves", qty: 4,
    name: "Cut barrel staves", skill: "Sawing", req: scaleLevel(18), xp: 70,
    in: { oak_boards: 2 }, tick: 1600, family: "staves", stations: ["sawmill", "workbench"] },
];
RECIPES.seasoning = [
  // passive: green staves must dry before a cooper can trust them
  { id: "season_staves", out: "seasoned_staves", qty: 4,
    name: "Season oak staves", skill: "Seasoning", req: scaleLevel(20), xp: 90,
    in: { oak_staves: 4 }, passive: true, time: 20000, tick: 20000,
    family: "seasoning", stations: ["seasoning_yard", "tanrack", "workbench"] },
];
(RECIPES.armoursmithing = RECIPES.armoursmithing || []).push(
  { id: "smith_iron_hoops", out: "iron_hoops", qty: 4,
    name: "Forge iron hoops", skill: "Armoursmithing", req: scaleLevel(14), xp: 60,
    in: { iron_bar: 1 }, tick: 1800, family: "fittings", stations: ["anvil"] },
);
// ---------- Coopering: 32 vessels across seven trade families ----------
// Breadth over power-creep. One recognisable vessel unlocks per level (1..32),
// grouped into families so two level-32 coopers can specialise differently
// (mastery is tracked per family). Inputs interconnect the wood + metal chains:
// domestic tubs use cheap boards; food/transport use oak staves; brewing, wine,
// industrial and luxury vessels demand SEASONED staves; luxury adds precious
// metal/gems. Every vessel is an individual finished good with maker provenance.
// Sprites are placeholder tinted barrels (registered for later real art).
const VESSEL_FAM_TINT = {
  domestic:        { h: 28,  s: 1.0, b: 1.00 },
  food_storage:    { h: 88,  s: 0.8, b: 0.95 },
  brewing_vessels: { h: -8,  s: 1.5, b: 0.90 },
  wine_casks:      { h: -32, s: 1.4, b: 0.80 },
  transport:       { h: 200, s: 0.7, b: 0.95 },
  industrial:      { h: 135, s: 0.9, b: 0.85 },
  luxury:          { h: 45,  s: 1.7, b: 1.12 },
};
const VESSEL_FLAVOR = {
  domestic: "A sturdy household vessel.",
  food_storage: "Keeps provisions sound through the winter.",
  brewing_vessels: "For fermenting and holding ale.",
  wine_casks: "For maturing wine.",
  transport: "Built to survive the road and the waves.",
  industrial: "A workshop vessel for the messier trades.",
  luxury: "A cooper's showpiece.",
};
// [id, name, family, level(1..32), value, [staveItem, staveQty], hoops, extraInputs?]
const COOPER_VESSELS = [
  ["bucket",             "Bucket",              "domestic",        1,  36,  ["boards", 2], 1],
  ["oak_bucket",         "Oak bucket",          "domestic",        2,  46,  ["boards", 2], 1],
  ["butter_churn",       "Butter churn",        "domestic",        3,  58,  ["boards", 3], 1],
  ["wash_tub",           "Wash tub",            "domestic",        4,  64,  ["boards", 4], 1],
  ["storage_tub",        "Storage tub",         "domestic",        5,  78,  ["boards", 4], 2],
  ["water_cask",         "Water cask",          "transport",       6,  92,  ["oak_staves", 4], 2],
  ["ale_cask",           "Ale cask",            "brewing_vessels", 7,  100, ["seasoned_staves", 4], 2],
  ["flour_barrel",       "Flour barrel",        "food_storage",    8,  104, ["oak_staves", 4], 2],
  ["pickle_barrel",      "Pickle barrel",       "food_storage",    9,  112, ["oak_staves", 4], 2],
  ["beer_barrel",        "Beer barrel",         "brewing_vessels", 10, 130, ["seasoned_staves", 6], 2],
  ["salt_meat_barrel",   "Salted meat barrel",  "food_storage",    11, 138, ["oak_staves", 5], 2],
  ["fish_barrel",        "Fish barrel",         "food_storage",    12, 142, ["oak_staves", 5], 2],
  ["wine_barrel",        "Wine barrel",         "wine_casks",      13, 156, ["seasoned_staves", 6], 3],
  ["cargo_barrel",       "Reinforced cargo barrel", "transport",   14, 168, ["oak_staves", 6], 3],
  ["charred_wine_barrel","Charred wine barrel", "wine_casks",      15, 182, ["seasoned_staves", 6], 3],
  ["export_cask",        "Sealed export cask",  "transport",       16, 176, ["oak_staves", 6], 3],
  ["fermentation_vat",   "Fermentation vat",    "brewing_vessels", 17, 228, ["seasoned_staves", 8], 4],
  ["tanning_vat",        "Tanning vat",         "industrial",      18, 214, ["seasoned_staves", 8], 4],
  ["ageing_cask",        "Ageing cask",         "wine_casks",      19, 208, ["seasoned_staves", 6], 3],
  ["dye_vat",            "Dye vat",             "industrial",      20, 218, ["seasoned_staves", 8], 4],
  ["ships_cask",         "Ship's cask",         "transport",       21, 200, ["seasoned_staves", 6], 4],
  ["brine_vat",          "Brine vat",           "industrial",      22, 224, ["seasoned_staves", 8], 4],
  ["chemical_cask",      "Chemical cask",       "industrial",      23, 244, ["seasoned_staves", 6], 4],
  ["brewery_tun",        "Brewery tun",         "brewing_vessels", 24, 340, ["seasoned_staves", 12], 6],
  ["polished_oak_cask",  "Polished oak cask",   "luxury",          25, 320, ["seasoned_staves", 6], 3],
  ["wine_tun",           "Large wine tun",      "wine_casks",      26, 356, ["seasoned_staves", 12], 6],
  ["export_barrel",      "Sealed export barrel","transport",       27, 276, ["seasoned_staves", 8], 4],
  ["carved_cask",        "Carved cask",         "luxury",          28, 380, ["seasoned_staves", 6], 3],
  ["powder_keg",         "Powder keg",          "industrial",      29, 300, ["seasoned_staves", 6], 4],
  ["silver_hooped_cask", "Silver-hooped cask",  "luxury",          30, 520, ["seasoned_staves", 6], 2, { gold_bar: 1 }],
  ["grand_tun",          "Grand brewery tun",   "brewing_vessels", 31, 640, ["seasoned_staves", 16], 8],
  ["master_cooper_cask", "Master cooper's cask","luxury",          32, 780, ["seasoned_staves", 8], 4, { gold_bar: 1, gem: 1 }],
];
const article = w => (/^[aeiou]/i.test(w) ? "an " : "a ");
RECIPES.coopering = COOPER_VESSELS.map(([id, name, fam, req, value, stave, hoops, extra]) => {
  if (!ITEMS[id]) {
    const t = VESSEL_FAM_TINT[fam] || { h: 20, s: 1, b: 1 };
    SPR["i_vessel_" + id] = [SPR.barrel[0], SPR.barrel[1], SPR.barrel[2],
      { filter: `hue-rotate(${t.h}deg) saturate(${t.s}) brightness(${t.b})` }];
    ITEMS[id] = { name, icon: "i_vessel_" + id, value, finished: true };
    EXAMINE[id] = `${name}. ${VESSEL_FLAVOR[fam] || ""}`.trim();
    registerPlaceholder(id, name, `cooperage ${fam.replace(/_/g, " ")} — tinted barrel placeholder`);
  }
  const [sItem, sQty] = stave;
  return {
    id: "cooper_" + id, out: id, name: "Cooper " + article(name) + name.toLowerCase(),
    skill: "Coopering", req, xp: 40 + req * 8, tick: 1800 + req * 40,
    in: Object.assign({ [sItem]: sQty, iron_hoops: hoops }, extra || {}),
    byproducts: [{ id: "wood_offcuts", qty: 1, chance: 0.3 }],
    family: fam, stations: ["cooperage", "workbench"],
  };
});
RECIPES.malting = [
  // passive: grain steeps, germinates and is kilned into malt
  { id: "malt_pale", out: "malt", qty: 2,
    name: "Malt pale barley", skill: "Malting", req: scaleLevel(1), xp: 26,
    in: { [BARLEY]: 2 }, passive: true, time: 15000, tick: 15000,
    family: "pale_malt", stations: ["malthouse", "furnace", "mill"] },
  { id: "malt_dark", out: "dark_malt", qty: 2,
    name: "Roast dark malt", skill: "Malting", req: scaleLevel(16), xp: 70,
    in: { [BARLEY]: 3 }, passive: true, time: 18000, tick: 18000,
    family: "dark_malt", stations: ["malthouse", "furnace"] },
];
// Milling already exists (grains → flour). Add grist milling + a bran by-product
// on the base wheat-flour recipe so it feeds livestock/other trades. Bran is
// GUARANTEED (every grain has a husk) so animal feed is never an RNG grind —
// the Tūhura farm's 10-flour goal must reliably feed its birds to Husbandry 3.
if (RECIPES.milling[0] && RECIPES.milling[0].out === "flour")
  RECIPES.milling[0].byproducts = [{ id: "bran", qty: 1, chance: 1 }];
RECIPES.milling.push(
  { id: "mill_grist", out: "malt_grist", qty: 1,
    name: "Mill malt grist", skill: "Milling", req: scaleLevel(4), xp: 30,
    in: { malt: 1 }, tick: 1200, family: "grist", stations: ["mill"] },
  { id: "mill_dark_grist", out: "dark_grist", qty: 1,
    name: "Mill dark grist", skill: "Milling", req: scaleLevel(16), xp: 60,
    in: { dark_malt: 1 }, tick: 1300, family: "grist", stations: ["mill"] },
);
RECIPES.brewing = [
  // passive: the mash ferments into ale
  { id: "brew_ale", out: "ale", qty: 2,
    name: "Brew ale", skill: "Brewing", req: scaleLevel(1), xp: 34,
    in: { malt_grist: 2 }, passive: true, time: 22000, tick: 22000,
    family: "ales", stations: ["brewery", "cauldron"] },
  { id: "brew_dark_ale", out: "dark_ale", qty: 2,
    name: "Brew dark ale", skill: "Brewing", req: scaleLevel(16), xp: 80,
    in: { dark_grist: 2 }, passive: true, time: 26000, tick: 26000,
    family: "ales", stations: ["brewery", "cauldron"] },
  // assembly (not passive): pour finished ale into a cooper's barrel. The output
  // is an individual finished good — its provenance references BOTH the ale and
  // the barrel, so it can recite the whole chain of makers.
  { id: "barrel_the_ale", out: "barrel_of_ale",
    name: "Barrel the ale", skill: "Brewing", req: scaleLevel(20), xp: 140,
    in: { ale: 8, beer_barrel: 1 }, tick: 2000, family: "kegging",
    stations: ["brewery", "cauldron"] },
];
// ---------- Baking: migrated out of Cooking (Cooking keeps fish/meat) ----------
const _bread = (RECIPES.cook || []).findIndex(r => r.out === "bread");
if (_bread >= 0) RECIPES.cook.splice(_bread, 1);
// (legacy "Bake bread" → "bread" removed; the tiered breads — flatbread, rye_bread, … —
//  are the current Baking outputs and are added to RECIPES.baking below.)
RECIPES.baking = RECIPES.baking || [];

// ---------- Skills tab intros for the new professions ----------
// (merged into ui.js's SKILL_INTRO at render time — ui.js loads later)
const PROD_SKILL_INTRO = {
  Sawing: "Saw logs into boards and cut barrel staves at a sawmill or workbench. The wood economy's first stage after felling — sells offcuts as kindling.",
  Seasoning: "Air-dry green staves and timber so they won't warp — a slow craft that takes real time to season at the seasoning yard.",
  Coopering: "Assemble staves and iron hoops into 32 vessels across seven families — domestic tubs, food-storage barrels, brewing casks, wine casks, transport barrels, industrial vats and luxury casks. Cheap boards for tubs, seasoned oak for fine casks. Mastery is per-family, so two coopers of the same level can specialise in wholly different niches.",
  Malting: "Steep, germinate and kiln barley into malt at a malthouse — a slow craft that takes real time to work. Dark malt makes richer ales.",
  Brewing: "Ferment malt grist into ale — a slow craft — then barrel finished ale into kegs. The barrel remembers everyone who made it.",
  Baking: "Bake flour into bread and pastries at a bakehouse. Split out of Cooking so a baker can specialise.",
};

// ---------- normalise EVERY recipe: stable id + mastery family + verb ----------
// Legacy recipes (cook/smelt/smith/…) get ids/families too, so the engine treats
// them uniformly and passive/batch/quality all "just work".
for (const cat in RECIPES) RECIPES[cat].forEach((r, i) => {
  if (!r.id) r.id = cat + ":" + (r.out || i) + ":" + i;
  if (!r.family) r.family = cat;
});
