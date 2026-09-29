// ===== generated content: item tiers, big bestiary, villagers =====
// Everything here is produced programmatically from compact tier tables:
// 32 kinds each of fish, trees/logs, ores, metal bars, crops, herbs, runes,
// textiles, forageables, hides/leathers and arrows, plus a 300+ creature
// bestiary built from the tiny-creatures sheet with tinted "Dire" variants.
// Loaded after data.js (mutates SPR/ITEMS/NODE_TYPES/RECIPES/CROPS/SPELLS/
// MONSTERS) and before world.js.
"use strict";

// req levels spread 1..93 across 32 tiers
// Callers (14):
//  content.js:38,40,65,69,91,96,104,108,136,154,184,210,231,250
const tierReq = i => Math.max(1, Math.round(i * 93 / 31) + (i ? 1 : 0));
// Callers (14):
//  content.js:36,37,60,86,90,103,131,132,152,182,208,229,247,248
const tierVal = i => Math.max(1, Math.round(4 * Math.pow(1.16, i)));
// Callers (13):
//  content.js:38,40,65,91,96,104,136,154,170,188,214,231,254
const tierXp = (i, base) => Math.round(base * (1 + i * 0.55));
// Callers (6):
//  content.js:20,34,35,55,59,94
const hueF = (i, extra = "") =>
  (i % 12 === 0 && !extra ? "brightness(1.0)" : `hue-rotate(${(i * 97) % 360}deg)`) +
  ` saturate(${[1, 1.25, 0.75][i % 3]}) brightness(${[1, 0.88, 1.1][Math.floor(i / 3) % 3]})` + extra;

// Callers (12):
//  content.js:85,89,102,129,130,151,162,181,207,228,245,246
function defineIcon(key, base, i, extra = "") {
  const [sheet, c, r, ex] = SPR[base];
  SPR[key] = [sheet, c, r, { ...(ex || {}), filter: hueF(i, extra) + (ex && ex.filter ? " " + ex.filter : ""), ...(ex && ex.rot ? { rot: ex.rot } : {}) }];
}

// ---------- 32 fish ----------
// Callers (1):
//  content.js:29
// Levels 1-24 (indices 0-23) are Aotearoa / New Zealand catches, ordered
// river-mouth/estuary -> open ocean by tier; levels 25-32 stay the fantastical
// fish. Gear + spawn band per species is set in FISH_GEAR below.
const FISH_NAMES = ["Whitebait", "Yellow-eyed mullet", "Flounder", "Kōura", "Shortfin eel", "Kahawai",
  "Blue mackerel", "Red gurnard", "Trevally", "Tarakihi", "Snapper", "Blue cod", "John dory",
  "Barracouta", "Hoki", "Ling", "Gemfish", "Silver warehou", "Kingfish", "Hāpuku", "Bluenose",
  "Albacore tuna", "Southern bluefin tuna", "Broadbill swordfish",
  "Lanternfish", "Icefish", "Sunfish", "Moonfish", "Voidfish", "Stormfish", "Goldfish royal", "Leviathan fry"];
// Callers (1):
//  content.js:33
const FISH_SPRS = [[0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [0, 7], [1, 7], [2, 7], [3, 7], [4, 7]];
// Callers (2):
//  skills/gathering.js:21,23
// Per-fish gear: [tool id, spot key]. Tools progress net -> rod -> big net ->
// cage/harpoon; spots deepen with tier (shore 1-10, deep 11-24, abyss 25-32).
const FISH_GEAR = [
  // NZ catches (0-23): shore band 0-9 (river-mouth/estuary/coast), deep band
  // 10-23 (reefs/offshore/open ocean). Tool matches how each is taken — shoaling
  // & estuary fish in nets, the freshwater crayfish and eel in pots (hīnaki),
  // reef & bottom fish on the rod, deep-water trawl species in the big net, and
  // the big pelagic tuna/billfish by harpoon.
  ["net", "shore"],     // 0  Whitebait — īnanga, scoop-netted at river mouths (moved to its own band below)
  ["net", "shore"],     // 1  Yellow-eyed mullet (aua)
  ["net", "shore"],     // 2  Flounder (pātiki)
  ["cage", "river"],    // 3  Kōura — FRESHWATER crayfish, potted in streams & lakes
  ["cage", "river"],    // 4  Shortfin eel (tuna) — hīnaki eel trap, rivers & lakes
  ["rod", "shore"],     // 5  Kahawai
  ["net", "shore"],     // 6  Blue mackerel
  ["rod", "shore"],     // 7  Red gurnard (kumukumu)
  ["rod", "shore"],     // 8  Trevally (araara)
  ["rod", "shore"],     // 9  Tarakihi
  ["rod", "deep"],      // 10 Snapper (tāmure)
  ["rod", "deep"],      // 11 Blue cod (rāwaru)
  ["rod", "deep"],      // 12 John dory (kuparu)
  ["rod", "deep"],      // 13 Barracouta (manga)
  ["big_net", "deep"],  // 14 Hoki — deep-water trawl
  ["big_net", "deep"],  // 15 Ling (hoka)
  ["big_net", "deep"],  // 16 Gemfish
  ["big_net", "deep"],  // 17 Silver warehou
  ["rod", "deep"],      // 18 Kingfish (haku)
  ["rod", "deep"],      // 19 Hāpuku — dropline for the big groper
  ["rod", "deep"],      // 20 Bluenose
  ["harpoon", "deep"],  // 21 Albacore tuna
  ["harpoon", "deep"],  // 22 Southern bluefin tuna
  ["harpoon", "deep"],  // 23 Broadbill swordfish
  // fantastical fish (24-31): abyssal band, unchanged
  ["net", "abyss"], ["rod", "abyss"], ["big_net", "abyss"], ["big_net", "abyss"],
  ["harpoon", "abyss"], ["harpoon", "abyss"], ["cage", "abyss"], ["harpoon", "abyss"],
];
const FISH_TOOL_NAME = { rod: "Fishing rod", net: "Small fishing net", big_net: "Big fishing net", harpoon: "Harpoon", cage: "Lobster cage" };
const FISH_SPOT_NAME = { shore: "Fishing spot", river: "River fishing spot", deep: "Deep fishing spot", abyss: "Abyssal fishing spot" };
const FISH = FISH_NAMES.map((name, i) => {
  const raw = i === 0 ? "raw_fish" : "raw_f" + i;
  const cooked = i === 0 ? "cooked_fish" : "fish_" + i;
  if (i > 0) {
    const [c, r] = FISH_SPRS[i % 10];
    SPR["i_rawf" + i] = ["m", c, r, { filter: hueF(i) }];
    SPR["i_ckdf" + i] = ["m", c, r, { filter: hueF(i, " sepia(0.6) brightness(0.85)") }];
    ITEMS[raw] = { name: "Raw " + name.toLowerCase(), icon: "i_rawf" + i, stack: true, value: tierVal(i) };
    ITEMS[cooked] = { name: name, icon: "i_ckdf" + i, stack: true, value: tierVal(i) * 2, heals: 4 + Math.round(i * 0.85) };
    RECIPES.cook.push({ out: cooked, name: "Cook " + name.toLowerCase(), skill: "Cooking", req: i + 1, xp: tierXp(i, 42), in: { [raw]: 1 }, tick: 1400, burnUntil: Math.min(97, tierReq(i) + 13), burnt: "burnt_fish" });
  }
  const [tool, spotKey] = FISH_GEAR[i];
  return { name, raw, cooked, req: i + 1, xp: tierXp(i, 35),
    tool, toolName: FISH_TOOL_NAME[tool], spotKey, spotName: FISH_SPOT_NAME[spotKey] };
});

// ---------- per-fish fishing spots ----------
// Every fishing spot in the world is a SPECIFIC fish ("Cod fishing spot" …),
// procedurally chosen at map-gen. Fish are grouped into depth bands by their
// gear tier (shore/deep/abyss); within a band the rarer (higher-tier) fish are
// exponentially rarer. Each spot node also carries a `left` catch counter
// (5-10, set at placement) and respawns on the tiered curve after depletion.
// shore = open sea coast · river = FRESHWATER (streams/lakes — kōura, eels) ·
// rivermouth = where a river meets the sea (the whitebait run) · deep/abyss = open ocean
const FISH_BANDS = { shore: [], river: [], rivermouth: [], deep: [], abyss: [] };
FISH.forEach((f, i) => { (FISH_BANDS[f.spotKey] || FISH_BANDS.shore).push(i); });
// Whitebait (īnanga, index 0) are an estuary run — scoop-netted only where a
// river meets the sea. Pull them out of the general shore pool into their own
// river-mouth band; shrimp (added below) becomes the common open-coast catch.
FISH_BANDS.shore = FISH_BANDS.shore.filter(i => i !== 0);
FISH_BANDS.rivermouth.push(0);
FISH[0].spotKey = "rivermouth";
FISH[0].spotName = "River-mouth spot";
// r in [0,1) -> a fish INDEX within the band, weighted toward the common end
function fishForBand(band, r) {
  const arr = (FISH_BANDS[band] && FISH_BANDS[band].length) ? FISH_BANDS[band] : FISH_BANDS.shore;
  const DECAY = 0.6;
  let total = 0;
  for (let k = 0; k < arr.length; k++) total += Math.pow(DECAY, k);
  let t = r * total;
  for (let k = 0; k < arr.length; k++) { t -= Math.pow(DECAY, k); if (t < 0) return arr[k]; }
  return arr[arr.length - 1];
}
// one NODE_TYPE per fish, named for its catch; gather/render/map all key off
// NODE_TYPES[type] and the shared "fishspot" type prefix
FISH.forEach((f, i) => {
  NODE_TYPES["fishspot_" + i] = {
    name: f.name + " fishing spot", spr: "ripple", skill: "Fishing",
    req: f.req, xp: f.xp, item: f.raw, tool: f.tool, spotKey: f.spotKey,
    tick: 1500 + i * 15, fish: i,
    depleteCh: 0,                       // depletion is count-based (node.left)
    respawn: respawnFor(f.req),         // tiered: common fish return fast, rare slow
  };
  if (typeof EXAMINE !== "undefined") EXAMINE["fishspot_" + i] = f.name + " are rising here.";
});

// ---------- Shrimp: the classic level-1 starter catch ----------
// Restored from the old fish ladder. The 32-tier ladder above is index-driven
// (item ids, node types and req all key off a fish's position), so shrimp is
// injected here as a bespoke shore fish at a STABLE trailing index rather than
// renumbering the ladder. It joins the shore band as the most common catch, so
// a Fishing-level-1 player nets shrimp alongside whitebait.
(function addShrimp() {
  const SHRIMP_IDX = FISH.length;               // stable trailing index (kept out of the 32-tier stats)
  // Icons (i_rawshrimp / i_ckdshrimp) are supplied by js/sprites/shrimp-icons-data.js
  // (sheet "sk"). They used to point at the old monster sheet "m", which was
  // removed in the NZ-fish icon rework — leaving the shrimp icons blank.
  ITEMS.raw_shrimp = { name: "Raw shrimp", icon: "i_rawshrimp", stack: true, value: 2 };
  ITEMS.shrimp     = { name: "Shrimp",     icon: "i_ckdshrimp", stack: true, value: 4, heals: 3 };
  if (typeof EXAMINE !== "undefined") {
    EXAMINE.raw_shrimp = "A netful of raw shrimp.";
    EXAMINE.shrimp = "Cooked shrimp — a humble first catch.";
  }
  RECIPES.cook.push({ out: "shrimp", name: "Cook shrimp", skill: "Cooking", req: 1, xp: 30,
    in: { raw_shrimp: 1 }, tick: 1300, burnUntil: 34, burnt: "burnt_fish" });
  FISH.push({ name: "Shrimp", raw: "raw_shrimp", cooked: "shrimp", req: 1, xp: 30,
    tool: "net", toolName: FISH_TOOL_NAME.net, spotKey: "shore", spotName: FISH_SPOT_NAME.shore });
  NODE_TYPES["fishspot_" + SHRIMP_IDX] = {
    name: "Shrimp fishing spot", spr: "ripple", skill: "Fishing",
    req: 1, xp: 30, item: "raw_shrimp", tool: "net", spotKey: "shore",
    tick: 1400, fish: SHRIMP_IDX, depleteCh: 0, respawn: respawnFor(1),
  };
  if (typeof EXAMINE !== "undefined") EXAMINE["fishspot_" + SHRIMP_IDX] = "Shrimp are rising here.";
  FISH_BANDS.shore.unshift(SHRIMP_IDX);         // most-common shore catch at level 1
})();

// ---------- 32 millable grains (Milling) ----------
// Buy grain from Sten, mill it at a millstone into flour. Real grains at the
// low/mid tiers, fantasy grains at the high end.
const GRAIN_NAMES = ["Wheat", "Barley", "Rye", "Oats", "Corn", "Rice", "Millet",
  "Buckwheat", "Chickpeas", "Sorghum", "Spelt", "Quinoa", "Amaranth", "Teff",
  "Emmer", "Farro", "Fonio", "Triticale", "Durum", "Kamut", "Freekeh",
  "Moonwheat", "Sunmillet", "Frostbarley", "Emberrye", "Voidcorn", "Starrice",
  "Dreamoats", "Aethergrain", "Bloodmaize", "Shadowspelt", "Celestial quinoa"];
const GRAINS = GRAIN_NAMES.map((name, i) => {
  const grain = i === 0 ? "wheat" : "grain_" + i;   // wheat already exists
  const flour = i === 0 ? "flour" : "flour_" + i;
  const lname = name.toLowerCase();
  if (i > 0) {
    defineIcon("i_grain" + i, "i_wheat", i);
    defineIcon("i_gflour" + i, "i_flour", i);
    ITEMS[grain] = { name, icon: "i_grain" + i, stack: true, value: tierVal(i) + 3 };
    ITEMS[flour] = { name: name + " flour", icon: "i_gflour" + i, stack: true, value: (tierVal(i) + 3) * 2 };
    RECIPES.milling.push({ out: flour, name: "Mill " + lname, skill: "Milling", req: i + 1, xp: tierXp(i, 26), in: { [grain]: 1 }, tick: 1200 });
    // any grain flour bakes where a recipe asks for plain wheat "flour"
    if (typeof window !== "undefined") (window.ITEM_FAMILY = window.ITEM_FAMILY || {})[flour] = "flour";
    if (typeof SHOP_STOCK !== "undefined") SHOP_STOCK.push(grain);
  }
  return { name, grain, flour, req: i + 1 };
});

// ---------- 32 trees / logs ----------
// Callers (1):
//  content.js:49
const TREE_NAMES = ["Tree", "Oak", "Birch", "Alder", "Pine", "Willow", "Cedar", "Poplar", "Maple",
  "Cherry", "Ash", "Beech", "Walnut", "Cypress", "Fir", "Teak", "Juniper", "Hazel", "Rowan",
  "Mahogany", "Ebony", "Yew", "Redwood", "Ironbark", "Frostbark", "Silverleaf", "Duskwood",
  "Bloodwood", "Starwood", "Magic tree", "Elderwood", "Worldtree sapling"];
// Callers (1):
//  content.js:52
const TREE_BASES = ["tree", "tree_orange", "tree_pine", "tree_apple"];
// Callers (6):
//  world/chunks.js:526,528,714,716,746,760
const TREES = TREE_NAMES.map((name, i) => {
  const log = i === 0 ? "logs" : i === 4 ? "pine_logs" : "log_" + i;
  const node = "treeT" + i;
  const sprBase = TREE_BASES[i % 4];
  let spr = sprBase;
  if (i > 0) {
    SPR["s_tree" + i] = [SPR[sprBase][0], SPR[sprBase][1], SPR[sprBase][2], { filter: hueF(i) }];
    spr = "s_tree" + i;
  }
  if (i > 0 && i !== 4) {
    SPR["i_log" + i] = ["i", i % 16, 8 + (i >> 4)];   // items32 rows 8-9, tier by column
    ITEMS[log] = { name: name + " logs", icon: "i_log" + i, stack: true, value: tierVal(i), log: true, logTier: i };
  }
  ITEMS.logs.log = true; ITEMS.logs.logTier = 0;
  ITEMS.pine_logs.log = true; ITEMS.pine_logs.logTier = 4;
  NODE_TYPES[node] = {
    name, spr, skill: "Woodcutting", req: i + 1, xp: tierXp(i, 25), item: log,
    tool: "axe", tick: 1300 + i * 14, depleteCh: 0.35 + Math.min(0.35, i * 0.012),
    respawn: respawnFor(i + 1), deadSpr: "stump",
  };
  return { name, log, node, req: i + 1 };
});

// ---------- 32 metals: ores, bars, rocks, arrows ----------
// Callers (1):
//  content.js:78
const METAL_NAMES = ["Copper", "Tin", "Iron", "Zinc", "Lead", "Silver", "Nickel", "Cobalt", "Gold",
  "Platinum", "Tungsten", "Titanium", "Mithril", "Orichalcum", "Adamantite", "Darksteel",
  "Meteorite", "Runite", "Dragonite", "Voidsteel", "Starmetal", "Bloodiron", "Frostiron",
  "Emberite", "Stormsteel", "Duskmetal", "Dawnmetal", "Aetherium", "Celestium", "Infernium",
  "Chronite", "Eternium"];
// Callers (11):
//  content.js:335,338,341 custom-mobs.js:75,84 world/chunks.js:533,535,710,712,747,769
const METALS = METAL_NAMES.map((name, i) => {
  const ore = i === 0 ? "copper_ore" : i === 2 ? "iron_ore" : i === 8 ? "gold_ore" : "ore_" + i;
  const bar = i === 0 ? "bronze_bar" : i === 2 ? "iron_bar" : i === 8 ? "gold_bar" : "bar_" + i;
  const rock = i === 0 ? "copper" : i === 2 ? "iron" : i === 8 ? "goldrock" : "rockM" + i;
  const lname = name.toLowerCase();
  if (!ITEMS[ore]) {
    SPR["i_ore" + i] = ["i", i % 16, 4 + (i >> 4)];   // items32 rows 4-5, tier by column
    ITEMS[ore] = { name: name + " ore", icon: "i_ore" + i, stack: true, value: tierVal(i) + 2 };
  }
  if (!ITEMS[bar]) {
    defineIcon("i_bar" + i, "i_bar_au", i);
    ITEMS[bar] = { name: name + " bar", icon: "i_bar" + i, stack: true, value: (tierVal(i) + 2) * 2 };
    RECIPES.smelt.push({ out: bar, name: "Smelt " + lname + " bar", skill: "Smelting", req: i + 1, xp: tierXp(i, 25), in: { [ore]: 1 }, tick: 1600 + i * 12 });
  }
  if (!NODE_TYPES[rock]) {
    SPR["s_rock" + i] = ["t", 54, 19, { filter: hueF(i) }];
    NODE_TYPES[rock] = {
      name: name + " rock", spr: "s_rock" + i, skill: "Mining", req: i + 1, xp: tierXp(i, 30),
      item: ore, tool: "pickaxe", tick: 1500 + i * 16, depleteCh: 1, respawn: respawnFor(i + 1),
      deadSpr: "rock_dead", gemCh: 0.03 + i * 0.002,
    };
  }
  // (the simple one-step 32-tier `arrows`/`arrows_i` ladder was REMOVED — arrows
  // are now ONLY the two-step arrowhead+shafts+feathers chain in geartiers.js,
  // floored at iron. See that file's ARROWHEADS & ARROWS block.)
  return { name, ore, bar, rock, req: i + 1 };
});

// ---------- 32 crops (food + fibers) ----------
// Callers (1):
//  content.js:124
const CROP_DEFS = [
  // [name, kind: food|fiber, existing?]
  ["Wheat", "food", "wheat"], ["Potato", "food"], ["Cabbage", "food"], ["Onion", "food"],
  ["Carrot", "food"], ["Flax", "fiber"], ["Cotton", "fiber", "cotton"], ["Tomato", "food"],
  ["Barley", "food"], ["Hemp", "fiber"], ["Corn", "food"], ["Pumpkin", "food"],
  ["Jute", "fiber"], ["Strawberry", "food"], ["Oat", "food"], ["Sisal", "fiber"],
  ["Melon", "food"], ["Rye", "food"], ["Ramie", "fiber"], ["Pepper", "food"],
  ["Beetroot", "food"], ["Kenaf", "fiber"], ["Leek", "food"], ["Garlic", "food"],
  ["Silkgrass", "fiber"], ["Artichoke", "food"], ["Yam", "food"], ["Spidersilk vine", "fiber"],
  ["Dragonfruit", "food"], ["Moonwheat", "food"], ["Aetherbloom", "fiber"], ["Sunmelon", "food"],
];
// Callers (2):
//  content.js:134,205
const FIBERS = [];
CROP_DEFS.forEach(([name, kind, existing], i) => {
  const key = existing || "crop" + i;
  const seed = existing ? (existing === "wheat" ? "wheat_seeds" : "cotton_seeds") : "seed_" + i;
  const lname = name.toLowerCase();
  if (!existing) {
    defineIcon("i_crop" + i, kind === "fiber" ? "i_cotton" : "i_wheat", i);
    ITEMS[key] = { name, icon: "i_crop" + i, stack: true, value: tierVal(i), ...(kind === "food" ? { heals: 2 + Math.round(i * 0.5) } : {}) };
    // (no generic "seed_"+i item: agriculture.js wipes CROPS.c_i and rebuilds farming
    // around the per-skill seed_<agri>_<i> system, so these were orphaned. Old saves
    // fold seed_1..31 onto the matching current seed via DEPRECATED_MIGRATE in storage.js.)
  }
  if (kind === "fiber") FIBERS.push(key);
  CROPS["c" + i] = {
    name: lname, seed, item: key, req: i + 1, plantXp: 10 + i * 2, xp: tierXp(i, 45),
    time: 60000 + i * 4500, yield: [2, 4], spr: kind === "fiber" ? "flower_white" : "wheat_plant",
  };
});
delete CROPS.wheat; delete CROPS.cotton; delete CROPS.herb; // superseded by c0/c6 + herb list below

// ---------- 32 herbs ----------
// Callers (1):
//  content.js:148
const HERB_NAMES = ["Sageleaf", "Bitterroot", "Marshweed", "Tanglefern", "Yarrow", "Feverbalm",
  "Nightcap", "Silverthorn", "Kingsfoil", "Wolfsbane", "Sunpetal", "Mooncress", "Bloodthistle",
  "Frostmint", "Emberleaf", "Stormnettle", "Gloomshade", "Dreamfoil", "Ghostflower", "Ironweed",
  "Dawnrose", "Duskvine", "Starbud", "Voidmoss", "Wyrmgrass", "Angelica", "Demonfern",
  "Runeblossom", "Spiritsage", "Timewort", "Aethergrass", "Worldroot"];
// Callers (5):
//  content.js:159,343 custom-mobs.js:82 skills/gathering.js:27,28
const HERBS = HERB_NAMES.map((name, i) => {
  const id = i === 0 ? "herb" : "herb_" + i;
  if (i > 0) {
    defineIcon("i_herb" + i, "i_herb", i);
    ITEMS[id] = { name, icon: "i_herb" + i, stack: true, value: tierVal(i) + 4 };
  }
  return { name, id, req: i + 1, xp: tierXp(i, 55) };
});
// ---------- 32 potions (Potionmaking) ----------
// One potion per herb tier: brew HERBS[i] + a vial at a cauldron. Effect is a
// heal or a timed skill buff; potency scales with tier, fantasy elixirs at top.
const POTION_DEFS = [
  ["Health", "heal"], ["Attack", "atk"], ["Strength", "str"], ["Defence", "def"],
  ["Energy", "heal"], ["Antipoison", "heal"], ["Ranging", "range"], ["Magic", "magic"],
  ["Greater health", "heal"], ["Fishing", "gather:Fishing"], ["Mining", "gather:Ore-mining"], ["Woodcutting", "gather:Woodcutting"],
  ["Greater combat", "combat"], ["Greater defence", "def"], ["Stamina", "heal"], ["Foraging", "gather:Foraging"],
  ["Super health", "heal"], ["Super attack", "atk"], ["Super strength", "str"], ["Super defence", "def"],
  ["Super combat", "combat"], ["Elixir of vigor", "heal"], ["Moonbrew", "magic"], ["Emberdraught", "str"],
  ["Frostbrew", "def"], ["Dreamtonic", "heal"], ["Voidbrew", "combat"], ["Starbrew", "all"],
  ["Ambrosia", "heal"], ["Aether elixir", "all"], ["Godly elixir", "all"], ["Worldroot elixir", "all"],
];
const POT_BUFF = {
  atk: ["Melee", "Strength"], str: ["Strength"], def: ["Defence"],
  range: ["Archery"], magic: ["Magic"],
  combat: ["Melee", "Strength", "Archery", "Magic"],
  all: ["Melee", "Strength", "Defence", "Archery", "Magic"],
};
RECIPES.herblore.length = 0;
const POTIONS = POTION_DEFS.map(([label, type], i) => {
  const id = i === 0 ? "potion_health" : label === "Attack" ? "potion_attack" : label === "Defence" ? "potion_defence" : "potion_" + i;
  const herb = HERBS[i].id;
  let effect;
  if (type === "heal") effect = { heal: 8 + i * 3 };
  else if (type.startsWith("gather:")) effect = { buff: [type.slice(7)], amt: 2 + Math.floor(i / 6), dur: 90000 + i * 8000 };
  else effect = { buff: POT_BUFF[type], amt: 2 + Math.floor(i / 4), dur: 90000 + i * 8000 };
  if (!ITEMS[id]) {
    defineIcon("i_pot" + i, "i_pot_hp", i);
    ITEMS[id] = { name: label + " potion", icon: "i_pot" + i, stack: true, value: 25 + i * 20, potion: effect };
  }
  RECIPES.herblore.push({ out: id, name: "Brew " + label.toLowerCase() + " potion", skill: "Potionmaking", req: i + 1, xp: tierXp(i, 45), in: { [herb]: 1, vial: 1 }, tick: 1600 + i * 12 });
  return { id, name: label + " potion", req: i + 1 };
});

// ---------- 32 runes + spells ----------
// Callers (1):
//  content.js:178
// The rune ladder is the mage's VOCABULARY (see skills/combat.js RUNE_MAGIC):
// substances (stuff a spell is made of), verbs (how it's delivered),
// modifiers (adverbs that warp the cast), and two wildcards. Order = tier =
// Runecrafting level; early tiers hand out a working sentence fast
// (Air + Strike by level 2). Ids are unchanged (air_rune, fire_rune, rune_N).
const RUNE_NAMES = ["Air", "Strike", "Water", "Bind", "Fire", "Stone", "Rend", "Veil", "Drain", "Burst",
  "Frost", "Lava", "Twin", "Storm", "Echo", "Chaos", "Bone", "Law", "Light", "Shadow",
  "Death", "Blood", "Soul", "Ward", "Spirit", "War", "Time", "Void", "Astral", "Wrath",
  "Genesis", "Eternity"];
// Callers (4):
//  content.js:187,192,333 custom-mobs.js:80
const RUNES = RUNE_NAMES.map((name, i) => {
  const id = i === 0 ? "air_rune" : i === 4 ? "fire_rune" : "rune_" + i;
  if (!ITEMS[id]) {
    defineIcon("i_rune" + i, i % 2 ? "i_rune_fire" : "i_rune_air", i);
    // equip:"rune" is a pseudo-slot, not a literal EQUIP_SLOTS name — it
    // means "any of the 8 rune-pouch slots" (32 rune types, 8 slots: a real
    // choice of which to carry). See depositStack()/gameplay/items.js.
    ITEMS[id] = { name: name + " rune", icon: "i_rune" + i, stack: true, value: tierVal(i) + 2, equip: "rune" };
  }
  return { name, id, req: i + 1 };
});
RECIPES.runecraft.length = 0;
// VERB runes (the "action" words — how a spell is delivered) are inscribed from an
// Action Rune; every other rune (substances/modifiers/wildcards — the "state" of the
// spell) from a State Rune. Indices MUST match the role table in skills/combat.js
// (RUNE_MAGIC): verbs = Strike, Bind, Rend, Drain, Burst, Echo, Chaos, Law, Shadow,
// Death, Ward, Void. Both raw runes are monster-drop only.
const VERB_RUNE_IDX = new Set([1, 3, 6, 8, 9, 14, 15, 17, 19, 20, 23, 27]);
RUNES.forEach((r, i) => {
  const raw = VERB_RUNE_IDX.has(i) ? "action_rune" : "state_rune";
  RECIPES.runecraft.push({ out: r.id, name: "Craft " + r.name.toLowerCase() + " runes", skill: "Runecrafting", req: r.req, xp: tierXp(i, 14), in: { [raw]: 1 }, tick: 1300, scaleYield: 8 });
});
SPELLS.length = 0;
// Callers (1):
//  content.js:193
const SPELL_VERBS = ["strike", "bolt", "blast", "wave", "surge", "burst", "storm", "fury"];
RUNES.forEach((r, i) => {
  SPELLS.push({ name: r.name + " " + SPELL_VERBS[i % 8], req: r.req, base: 3 + Math.round(i * 0.8), rune: r.id });
});
SPELLS.sort((a, b) => b.req - a.req); // legacy list — combat now weaves rune ASPECTS (skills/combat.js)

// ---------- 32 textiles ----------
// Callers (1):
//  content.js:203
const TEXTILE_NAMES = ["Cotton cloth", "Rough burlap", "Linen", "Wool cloth", "Hempcloth", "Canvas",
  "Jute weave", "Twill", "Felt", "Gauze", "Sisal mat", "Damask", "Velvet", "Ramie cloth",
  "Brocade", "Satin", "Kenaf weave", "Lace", "Tweed", "Chiffon", "Silkgrass weave", "Taffeta",
  "Samite", "Spidersilk", "Cloth-of-silver", "Cloth-of-gold", "Shadowweave", "Frostlinen",
  "Emberweave", "Aethercloth", "Moonshroud", "Worldweave"];
// Callers (1):
//  content.js:213
const TEXTILES = TEXTILE_NAMES.map((name, i) => {
  const id = i === 0 ? "cloth" : "cloth_" + i;
  const fiber = FIBERS[i % FIBERS.length];
  if (i > 0) {
    defineIcon("i_cloth" + i, "i_cloth", i);
    ITEMS[id] = { name, icon: "i_cloth" + i, stack: true, value: (tierVal(i) + 3) * 2 };
  }
  return { name, id, fiber, req: i + 1 };
});
RECIPES.textiles.length = 0;
TEXTILES.forEach((t, i) => {
  RECIPES.textiles.push({ out: t.id, name: "Weave " + t.name.toLowerCase(), skill: "Textiles", req: t.req, xp: tierXp(i, 32), in: { [t.fiber]: 2 }, tick: 1500 });
});
RECIPES.textiles.push({ out: "robe", name: "Weave robe", skill: "Textiles", req: scaleLevel(8), xp: 85, in: { cloth: 3 }, tick: 2100 });

// ---------- 32 forageables ----------
// Callers (1):
//  content.js:225
const FORAGE_NAMES = ["Berries", "Blackberries", "Elderberries", "Hazelnuts", "Wild garlic",
  "Chestnuts", "Gooseberries", "Morel", "Wild leek", "Chanterelle", "Truffle", "Sloes",
  "Acorn flour nuts", "Rosehips", "Walnuts", "Porcini", "Cloudberries", "Juniper berries",
  "King bolete", "Winterberries", "Firecap", "Frostcap", "Glowcap", "Duskberries",
  "Sunberries", "Moonberries", "Spirit morel", "Voidtruffle", "Starfruit", "Dragonberries",
  "Aethercap", "Ambrosia berries"];
// Callers (2):
//  skills/gathering.js:31,32
const FORAGE = FORAGE_NAMES.map((name, i) => {
  const id = i === 0 ? "berries" : "forage_" + i;
  if (i > 0) {
    defineIcon("i_for" + i, i % 3 === 2 ? "mushroom" : "i_berries", i);
    ITEMS[id] = { name, icon: "i_for" + i, stack: true, value: tierVal(i), heals: 2 + Math.round(i * 0.6) };
  }
  return { name, id, req: i + 1, xp: tierXp(i, 30) };
});

// ---------- 32 hides + leathers ----------
// Callers (1):
//  content.js:241
const HIDE_NAMES = ["Rabbit fur", "Rat hide", "Cat pelt", "Fox fur", "Boar hide", "Goat hide",
  "Deer hide", "Sheep fleece", "Cow hide", "Badger pelt", "Wolf pelt", "Elk hide", "Zebra hide",
  "Hyena pelt", "Camel hide", "Croc leatherhide", "Ape hide", "Bear pelt", "Lion pelt",
  "Tiger pelt", "Polar bear pelt", "Rhino hide", "Hippo hide", "Werewolf pelt", "Yeti fur",
  "Owlbear pelt", "Chimera hide", "Manticore hide", "Hydra scalehide", "Wyrmhide",
  "Dragonhide", "Leviathan hide"];
// Callers (2):
//  content.js:253,383
const HIDES = HIDE_NAMES.map((name, i) => {
  const id = i === 4 ? "hide" : "hide_" + i;
  const leather = i === 4 ? "leather" : "leather_" + i;
  if (i !== 4) {
    defineIcon("i_hide" + i, "i_hide", i);
    defineIcon("i_lth" + i, "i_leather", i);
    ITEMS[id] = { name, icon: "i_hide" + i, stack: true, value: tierVal(i) + 2 };
    ITEMS[leather] = { name: name.replace(/ (hide|fur|pelt|fleece|leatherhide|scalehide|hide)$/i, "") + " leather", icon: "i_lth" + i, stack: true, value: (tierVal(i) + 2) * 2 };
  }
  return { name, id, leather, req: i + 1 };
});
RECIPES.tanning.length = 0;
HIDES.forEach((h, i) => {
  RECIPES.tanning.push({ out: h.leather, name: "Tan " + h.name.toLowerCase(), skill: "Tanning", req: h.req, xp: tierXp(i, 26), in: { [h.id]: 1 }, tick: 1400 });
});

// ---------- bestiary (300+) ----------
// [name, col, row, level, theme]; themes: u undead, h humanoid, b beast(butcherable),
// d dragon, c celestial, e elemental, m magical, g golem, q aquatic
// Callers (2):
//  content.js:417 custom-mobs.js:96
const CREATURES = [
  ["Zombie", 0, 0, 5, "u"], ["Skeleton", 1, 0, 7, "u"], ["Vampire", 2, 0, 38, "u"],
  ["Flameskull", 3, 0, 22, "u"], ["Wraith", 4, 0, 30, "u"], ["Floating Eye", 5, 0, 14, "m"],
  ["Wallmaster", 6, 0, 10, "m"], ["Medusa", 7, 0, 42, "m"], ["Maneater Plant", 8, 0, 16, "m"],
  ["Leprechaun", 9, 0, 12, "h"],
  ["Goblin", 0, 1, 2, "h"], ["Orc", 1, 1, 13, "h"], ["Faerie", 2, 1, 9, "m"],
  ["Funguy", 3, 1, 6, "m"], ["Ogre", 4, 1, 17, "h"], ["Wendigo", 5, 1, 35, "u"],
  ["Green Knight", 6, 1, 25, "h"], ["Blue Knight", 7, 1, 32, "h"], ["Red Knight", 8, 1, 40, "h"],
  ["Wight", 9, 1, 28, "u"],
  ["Minotaur", 0, 2, 34, "h"], ["Centaur", 1, 2, 26, "h"], ["Centaurette", 2, 2, 24, "h"],
  ["Wolf", 3, 2, 9, "b10"], ["Werewolf", 4, 2, 33, "b23"], ["Dryad", 5, 2, 18, "m"],
  ["Siren", 6, 2, 27, "q"], ["Mermaid", 7, 2, 20, "q"], ["Arachni", 8, 2, 29, "m"],
  ["Succubus", 9, 2, 44, "m"],
  ["Mist Dragon", 0, 3, 55, "d"], ["Blue Dragon", 1, 3, 60, "d"], ["Black Dragon", 2, 3, 70, "d"],
  ["Red Dragon", 3, 3, 75, "d"], ["Green Dragon", 4, 3, 32, "d"], ["Angel", 5, 3, 65, "c"],
  ["Cherub", 6, 3, 45, "c"], ["Godling", 7, 3, 97, "c"], ["Archdevil", 8, 3, 93, "c"],
  ["Imp", 9, 3, 13, "m"],
  ["Asp", 0, 4, 8, "b2"], ["Adder", 1, 4, 11, "b3"], ["Cave Troll", 2, 4, 22, "h"],
  ["Yeti", 3, 4, 38, "b24"], ["Sasquatch", 4, 4, 30, "b24"], ["Fire Elemental", 5, 4, 36, "e"],
  ["Water Elemental", 6, 4, 34, "e"], ["Earth Elemental", 7, 4, 33, "e"],
  ["Air Elemental", 8, 4, 32, "e"], ["Ice Elemental", 9, 4, 37, "e"],
  ["Horse", 0, 5, 6, "b6"], ["Unicorn", 1, 5, 30, "m"], ["Pegasus", 2, 5, 28, "m"],
  ["Hippocampus", 3, 5, 18, "q"], ["Nightmare", 4, 5, 40, "m"], ["Fire Sprite", 5, 5, 10, "e"],
  ["Water Sprite", 6, 5, 9, "e"], ["Earth Sprite", 7, 5, 9, "e"], ["Air Sprite", 8, 5, 8, "e"],
  ["Ice Sprite", 9, 5, 11, "e"],
  ["Dark Wizard", 5, 6, 35, "m"], ["Risen Wizard", 6, 6, 15, "u"], ["Harpy", 7, 6, 21, "b12"],
  ["Flesh Golem", 8, 6, 39, "g"], ["Gargoyle", 9, 6, 31, "g"],
  ["Purple Worm", 5, 7, 52, "m"], ["Naga", 6, 7, 36, "m"], ["Lizardman", 7, 7, 17, "h"],
  ["Dragonkin", 8, 7, 46, "d"], ["Kobold", 9, 7, 4, "h"],
  ["Gelatinous Cube Sr.", 0, 8, 24, "m"], ["Gelatinous Cube", 1, 8, 15, "m"],
  ["Gelatinous Cube Jr.", 2, 8, 7, "m"], ["Queen Slime", 3, 8, 19, "m"], ["Slime", 4, 8, 1, "m"],
  ["Slime Gobbet", 5, 8, 1, "m"], ["King Muck", 6, 8, 21, "m"], ["Muck", 7, 8, 9, "m"],
  ["Muck Gobbet", 8, 8, 2, "m"], ["Will-O-Wisp", 9, 8, 23, "m"],
  ["Gnoll", 0, 9, 16, "h"], ["Gnoll Hyena", 1, 9, 14, "b13"], ["Wererat", 2, 9, 12, "h"],
  ["Catfolk", 3, 9, 10, "h"], ["Cat", 4, 9, 2, "b2"], ["Mummy", 5, 9, 26, "u"],
  ["Lich", 6, 9, 58, "u"], ["Death Knight", 7, 9, 48, "u"], ["Banshee", 8, 9, 41, "u"],
  ["Ghoul", 9, 9, 13, "u"],
  ["Witch", 0, 10, 27, "m"], ["Satyr", 1, 10, 15, "h"], ["Hellhound", 2, 10, 29, "b18"],
  ["Cockatrice", 3, 10, 22, "b15"], ["Gryphon", 4, 10, 37, "b25"], ["Hippogryph", 5, 10, 33, "b25"],
  ["Manticore", 6, 10, 43, "b27"], ["Chimera", 7, 10, 49, "b26"], ["Sphinx", 8, 10, 54, "m"],
  ["Genie", 9, 10, 47, "m"],
  ["Hydra", 0, 11, 62, "d"], ["Kraken", 1, 11, 68, "q"], ["Kraken Tentacle", 2, 11, 35, "q"],
  ["Treant", 3, 11, 39, "m"], ["Shrubnt", 4, 11, 12, "m"], ["Elder Treant", 5, 11, 30, "m"],
  ["Dendroid", 6, 11, 9, "m"], ["Owlbear", 7, 11, 31, "b25"], ["Brownie", 8, 11, 3, "h"],
  ["Pixie", 9, 11, 7, "m"],
  ["Eye Of Odin", 0, 12, 18, "m"], ["Deep Kraken", 1, 12, 66, "q"], ["Severed Tentacle", 2, 12, 25, "q"],
  ["Demon", 3, 12, 57, "c"], ["Hobgoblin", 4, 12, 19, "h"], ["Bugbear", 5, 12, 23, "h"],
  ["Clay Golem", 6, 12, 28, "g"], ["Stone Golem", 7, 12, 42, "g"], ["Iron Golem", 8, 12, 56, "g"],
  ["Camel", 9, 12, 5, "b14"],
  ["Owl", 0, 13, 3, "b0"], ["Hawk", 2, 13, 4, "b0"], ["Eagle", 4, 13, 6, "b0"],
  ["Raven", 6, 13, 5, "b0"], ["Bat", 8, 13, 4, "b0"],
  ["Bee", 0, 14, 2, "m"], ["Hornet", 1, 14, 5, "m"], ["Giant Ant", 2, 14, 1, "m"],
  ["Beetle", 3, 14, 2, "m"], ["Centipede", 4, 14, 6, "m"], ["Scorpion", 5, 14, 9, "m"],
  ["Lizard", 6, 14, 2, "b1"], ["Frog", 7, 14, 1, "b0"], ["Crocodile", 8, 14, 12, "b15"],
  ["Turtle", 9, 14, 8, "b8"],
  ["Chicken", 0, 15, 1, "b0"], ["Cow", 1, 15, 2, "b8"], ["Goat", 2, 15, 2, "b5"],
  ["Sheep", 3, 15, 2, "b7"], ["Ostrich", 4, 15, 4, "b3"], ["Zebra", 5, 15, 4, "b12"],
  ["Lion", 6, 15, 15, "b18"], ["Tiger", 7, 15, 16, "b19"], ["Elephant", 8, 15, 18, "b21"],
  ["Giraffe", 9, 15, 8, "b12"],
  ["Boar", 0, 16, 3, "b4"], ["Deer", 1, 16, 3, "b6"], ["Elk", 2, 16, 6, "b11"],
  ["Brown Bear", 3, 16, 14, "b17"], ["Polar Bear", 4, 16, 17, "b20"], ["Black Bear", 5, 16, 13, "b17"],
  ["Gorilla", 6, 16, 14, "b16"], ["Ape", 7, 16, 9, "b16"], ["Monkey", 8, 16, 3, "b2"],
  ["Dog", 9, 16, 3, "b2"],
  ["Rhinoceros", 0, 17, 20, "b21"], ["Hippopotamus", 1, 17, 19, "b22"], ["Shark", 2, 17, 24, "q"],
  ["Whale", 3, 17, 30, "q"], ["Dolphin", 4, 17, 12, "q"], ["Squirrel", 5, 17, 1, "b0"],
  ["Weasel", 6, 17, 2, "b0"], ["Rabbit", 7, 17, 1, "b0"], ["Raccoon", 8, 17, 2, "b1"],
  ["Badger", 9, 17, 5, "b9"],
];

// Callers (1):
//  content.js:401
function creatureDrops(lvl, theme) {
  const drops = [{ id: "coins", min: Math.max(1, lvl), max: lvl * 4 + 4, ch: theme[0] === "b" ? 0 : 1 }];
  const runeTier = Math.min(31, Math.floor(lvl / 3));
  if ("uecm".includes(theme[0]))
    drops.push({ id: RUNES[runeTier].id, min: 1, max: 4, ch: 0.25 });
  if (theme[0] === "g")
    drops.push({ id: METALS[Math.min(31, Math.floor(lvl / 3))].ore, min: 1, max: 2, ch: 0.35 });
  if (theme[0] === "d" || theme[0] === "c") {
    drops.push({ id: "gem", min: 1, max: 3, ch: 0.4 });
    drops.push({ id: METALS[Math.min(31, Math.floor(lvl / 3))].bar, min: 1, max: 2, ch: 0.3 });
  }
  // (humanoid arrow drops are added TIER-APPROPRIATELY in bestiary-drops.js,
  // which runs after geartiers defines the arrow ladder — see WEAPON_ARROW_IDS)
  if (theme[0] === "m" && lvl > 20)
    drops.push({ id: HERBS[Math.min(31, Math.floor(lvl / 3))].id, min: 1, max: 2, ch: 0.2 });
  return drops;
}

// visual size by species (tile multiples); anything unlisted gets ~1.0
// with a whisper of level growth. Big animals read BIG on screen.
// Callers (1):
//  content.js:398
const SIZE = {
  // tiny critters
  Bee: 0.5, Hornet: 0.55, "Giant Ant": 0.65, Beetle: 0.55, Centipede: 0.7, Scorpion: 0.7,
  Lizard: 0.55, Frog: 0.5, Squirrel: 0.5, Weasel: 0.55, Rabbit: 0.55, Raccoon: 0.6,
  Cat: 0.6, Monkey: 0.65, Bat: 0.55, Owl: 0.6, Hawk: 0.6, Raven: 0.6,
  Chicken: 0.6, Pixie: 0.55, Brownie: 0.6, "Slime Gobbet": 0.5, "Muck Gobbet": 0.5,
  "Fire Sprite": 0.6, "Water Sprite": 0.6, "Earth Sprite": 0.6, "Air Sprite": 0.6,
  "Ice Sprite": 0.6, Faerie: 0.65, Imp: 0.7, Kobold: 0.75, Asp: 0.7, Adder: 0.75,
  Goat: 1.2, Sheep: 1.15, Dog: 1.1, Badger: 0.7, Turtle: 0.7, Eagle: 0.7, Leprechaun: 0.75,
  Funguy: 0.8, "Gelatinous Cube Jr.": 0.7, Dendroid: 0.75, Shrubnt: 0.8, Wererat: 0.85,
  // large beasts & brutes — clearly bigger than the player
  Cow: 1.4, Horse: 1.45, Zebra: 1.4, Camel: 1.5, Elk: 1.45, Ostrich: 1.35,
  Lion: 1.45, Tiger: 1.5, "Brown Bear": 1.6, "Polar Bear": 1.7, "Black Bear": 1.55,
  Gorilla: 1.45, Crocodile: 1.45, Minotaur: 1.7, Centaur: 1.6, Centaurette: 1.5,
  Yeti: 1.85, Sasquatch: 1.8, Wendigo: 1.7, Owlbear: 1.7, Gryphon: 1.75,
  Hippogryph: 1.7, Manticore: 1.9, Unicorn: 1.5, Pegasus: 1.55, Nightmare: 1.6,
  Hellhound: 1.4, "Gelatinous Cube Sr.": 1.7, Treant: 2.1, "Elder Treant": 1.9,
  "Fire Elemental": 1.6, "Water Elemental": 1.6, "Earth Elemental": 1.7,
  "Air Elemental": 1.55, "Ice Elemental": 1.6, "Clay Golem": 1.7, Shark: 1.7,
  Medusa: 1.3, Naga: 1.5, Dragonkin: 2.4, Wight: 1.5,
  // the properly huge — multiple tiles tall
  Giraffe: 2.8, Elephant: 2.6, Rhinoceros: 2.2, Hippopotamus: 2.2,
  Hydra: 2.8, Chimera: 2.1, Sphinx: 2.3, "Purple Worm": 2.8, Whale: 3.0,
  Kraken: 3.0, "Deep Kraken": 3.0, "Stone Golem": 1.9, "Iron Golem": 2.2,
  "Flesh Golem": 1.8, Demon: 2.2, Angel: 2.0, Godling: 3.0, Archdevil: 3.0,
  "Mist Dragon": 2.4, "Blue Dragon": 2.5, "Black Dragon": 2.7, "Red Dragon": 2.9,
  "Green Dragon": 2.3,
};

// Callers (2):
//  content.js:420,426
// 8-directional mob sprites: hand-drawn rotation sets for a subset of the
// bestiary, addressed via the "md" atlas sheet (assets/mobs_directional.png).
// Order matches the sheet's 8 columns; keys match generated creature keys.
// Callers (2):
//  content.js:445 gameplay/monsters.js:79
const DIR8 = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"];
// Callers (1):
//  content.js:445
const MOB_DIR_ROWS = {
  brown_bear: 0, brownie: 1, bugbear: 2, camel: 3, cat: 4, centaur: 5,
  centaurette: 6, faerie: 7, flameskull: 8, floating_eye: 9, funguy: 10,
  goblin: 11, green_knight: 12, leprechaun: 13, maneater_plant: 14,
  medusa: 15, minotaur: 16, ogre: 17, orc: 18, skeleton: 19, vampire: 20,
  wallmaster: 21, wendigo: 22, wight: 23, wraith: 24, zombie: 25,
  adder: 26, air_elemental: 27, air_sprite: 28, angel: 29, giant_ant: 30,
  ape: 31, arachni: 32, archdevil: 33, asp: 34, badger: 35, banshee: 36,
  bat: 37, bee: 38, beetle: 39, black_bear: 40, boar: 41, catfolk: 42,
  cave_troll: 43, centipede: 44, cherub: 45, chicken: 46, chimera: 47,
  clay_golem: 48, cockatrice: 49, cow: 50,
  crocodile: 51, dark_wizard: 52, death_knight: 53, deep_kraken: 54, deer: 55,
  demon: 56, dendroid: 57, dog: 58, dolphin: 59, dragonkin: 60, dryad: 61,
  eagle: 62, earth_elemental: 63, earth_sprite: 64,
  elder_treant: 65, elephant: 66, elk: 67, eye_of_odin: 68, fire_elemental: 69,
  flesh_golem: 70, frog: 71, gargoyle: 72, genie: 73, ghoul: 74, giraffe: 75,
  gnoll: 76, gnoll_hyena: 77, goat: 78,
  godling: 79, gorilla: 80, gryphon: 81, harpy: 82, hawk: 83, hellhound: 84,
  hippocampus: 85, hippogryph: 86, hippopotamus: 87, hobgoblin: 88, hornet: 89,
  horse: 90, hydra: 91, ice_elemental: 92, imp: 93, iron_golem: 94,
  blue_knight: 95, red_knight: 96, werewolf: 97, siren: 98, mermaid: 99,
  succubus: 100, mist_dragon: 101, blue_dragon: 102, black_dragon: 103,
  red_dragon: 104, green_dragon: 105, yeti: 106, sasquatch: 107,
  water_elemental: 108, unicorn: 109, pegasus: 110, nightmare: 111,
  fire_sprite: 112, water_sprite: 113, ice_sprite: 114, risen_wizard: 115,
  purple_worm: 116, naga: 117, lizardman: 118, kobold: 119,
  gelatinous_cube_sr_: 120, gelatinous_cube: 121, gelatinous_cube_jr_: 122,
  queen_slime: 123, slime_gobbet: 124, king_muck: 125, muck: 126,
  muck_gobbet: 127, will_o_wisp: 128, wererat: 129, mummy: 130, lich: 131,
  witch: 132, satyr: 133, manticore: 134, sphinx: 135, kraken: 136,
  kraken_tentacle: 137, treant: 138, shrubnt: 139, owlbear: 140, pixie: 141,
  severed_tentacle: 142, stone_golem: 143, owl: 144, raven: 145,
  scorpion: 146, lizard: 147, turtle: 148, ostrich: 149, zebra: 150,
  lion: 151, tiger: 152, polar_bear: 153, monkey: 154, rhinoceros: 155,
  shark: 156, whale: 157, squirrel: 158, weasel: 159, rabbit: 160,
  raccoon: 161,
  // NZ bird rows appended to the "md" atlas (rows 162-186)
  tui: 162, kea: 163, kakapo: 164, takapu: 165, piwakawaka: 166, ruru: 167,
  moanui: 168, tieke: 169, kiwi: 170, weka: 171, hakawai: 172, pukeko: 173,
  putangitangi: 174, moauta: 175, moaiti: 176, kuihinui: 177, pouakai: 178,
  titipounamu: 179, kotata: 180, whio: 181, koreke: 182, karearea: 183,
  kaka: 184, kereru: 185, huia: 186,
};
// Callers (2):
//  content.js:420,426
function defineCreature(key, name, col, row, lvl, theme, filter) {
  const dirRow = MOB_DIR_ROWS[key.replace(/_v$/, "")];
  const hasDir = dirRow !== undefined;
  let sprKey;
  if (hasDir) {
    // The "md" sheet's 8-frame rows start on the SOUTH-EAST pose, not south:
    // column c depicts DIR8[c+1], so the frame for DIR8[i] is column (i+7)%8
    // (verified frame-by-frame on the horse/camel/chicken/cow/boar/zebra/lion/
    // bee rows — all rows share this order).
    DIR8.forEach((d, i) => {
      SPR["mcd_" + key + "_" + d] = ["md", (i + 7) % 8, dirRow, filter ? { filter } : undefined];
    });
    sprKey = "mcd_" + key + "_south";
  } else {
    sprKey = "mc_" + key;
    SPR[sprKey] = ["m", col, row, filter ? { filter } : undefined];
  }
  const butcher = theme[0] === "b" ? {
    meat: 1 + Math.floor(lvl / 6),
    hideItem: HIDES[Math.min(31, parseInt(theme.slice(1) || "0", 10))].id,
    hide: lvl >= 3 ? 1 + Math.floor(lvl / 25) : 0,
  } : null;
  MONSTERS[key] = {
    name, lvl: scaleLevel(lvl),
    hp: Math.round(4 + lvl * 3.1),
    maxHit: Math.max(0, Math.round(lvl * 0.35)),
    def: Math.round(lvl * 0.8),
    atkTick: 2400 - Math.min(600, lvl * 8),
    aggro: lvl >= 10 && theme[0] !== "b",
    spr: [[sprKey]],
    dirSpr: hasDir,
    scale: (() => {
      const isGiant = /^Giant /i.test(name);
      const base = name.replace(/^(Giant|Feral|Elder|Ancient) /i, "");
      const proper = base.charAt(0).toUpperCase() + base.slice(1);
      const baseScale = SIZE[proper] ?? (0.95 + Math.min(0.25, lvl / 150));
      return baseScale * (filter ? (isGiant ? 1.5 : 1.15) : 1);
    })(),
    drops: creatureDrops(lvl, theme),
    // butcher yield (meat + the beast's own specific hide) is dropped
    // automatically on death now — no carcass to butcher (Butchering removed)
    ...(butcher && butcher.meat ? { butcher } : {}),
    respawn: 10000 + lvl * 700,
    xp: Math.max(10, lvl * 13),
  };
}

// theme letters: u undead, h humanoid, b beast, d dragon, c celestial,
// e elemental, m magical, g golem, q aquatic
// Callers (6):
//  content.js:421,428,433 world/chunks.js:724,725,729
const MONSTER_THEME = {
  goblin: "h", bandit: "h", orc: "h", ogre: "h", troll: "h",
  dragon: "d", zombie: "u", skeleton: "u",
  wolf: "b", bear: "b", boar: "b", deer: "b", chicken: "b", cow: "b", sheep: "b",
  slime: "m",
};
// Callers (1):
//  content.js:419
const HANDMADE = new Set(Object.keys(MONSTERS));
for (const [name, col, row, lvl, theme] of CREATURES) {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (!HANDMADE.has(key) && !MONSTERS[key]) {
    defineCreature(key, name, col, row, lvl, theme);
    MONSTER_THEME[key] = theme[0];
  }
  // tinted elite variant
  const prefix = lvl < 8 ? "Giant" : lvl < 25 ? "Feral" : lvl < 55 ? "Elder" : "Ancient";
  const vlvl = Math.min(99, Math.round(lvl * 1.6) + 2);
  defineCreature(key + "_v", prefix + " " + name, col, row, vlvl, theme,
    `hue-rotate(${(row * 47 + col * 31) % 360}deg) saturate(1.35) brightness(0.82)`);
  MONSTER_THEME[key + "_v"] = theme[0];
}
// The base ant was mislabelled "Giant Ant" — so its elite variant then read
// "Giant Giant Ant". Relabel the DISPLAY names to "Ant" / "Giant Ant". Keys stay
// giant_ant / giant_ant_v (spawn tables slugify "Giant ant" → giant_ant, and
// the directional sprite + saved kill counts key off giant_ant), so only the
// on-screen labels change.
if (MONSTERS.giant_ant) MONSTERS.giant_ant.name = "Ant";
if (MONSTERS.giant_ant_v) MONSTERS.giant_ant_v.name = "Giant Ant";

// Some bestiary entries (e.g. Goblin, Orc, Skeleton, Zombie, Ogre) are hand-
// crafted with composite body art and bypass defineCreature above, so they
// never picked up directional sprites. Patch them in here.
for (const key in MOB_DIR_ROWS) {
  const def = MONSTERS[key];
  if (!def || def.dirSpr) continue;
  const dirRow = MOB_DIR_ROWS[key];
  DIR8.forEach((d, i) => { SPR["mcd_" + key + "_" + d] = ["md", (i + 7) % 8, dirRow]; });
  def.spr = [["mcd_" + key + "_south"]];
  def.dirSpr = true;
}

// registry sorted by level for distance-based spawning
// Callers (3):
//  content.js:501,502,503
const BESTIARY = Object.entries(MONSTERS)
  .map(([key, def]) => ({ key, lvl: def.lvl, theme: MONSTER_THEME[key] || "m" }))
  .sort((a, b) => a.lvl - b.lvl);
// ---------- per-biome spawn lists ----------
// Each biome only ever spawns creatures from its own list (elites of a
// listed species are allowed too). Written with display names, resolved
// to bestiary keys at load.
// Callers (1):
//  content.js:485
const slugify = n => n.toLowerCase().replace(/[^a-z0-9]+/g, "_");
// Callers (5):
//  content.js:481,484 custom-mobs.js:3,304,306
const BIOME_MOB_NAMES = {
  DEEP: ["Shark", "Whale", "Kraken", "Deep kraken", "Kraken tentacle", "Severed tentacle", "Water elemental"],
  WATER: ["Shark", "Dolphin", "Turtle", "Mermaid", "Siren", "Hippocampus", "Water sprite"],
  REEF: ["Dolphin", "Turtle", "Mermaid", "Siren", "Hippocampus", "Water sprite", "Crocodile"],
  SAND: ["Turtle", "Crocodile", "Lizard", "Frog", "Siren", "Mermaid"],
  GRASS: ["Chicken", "Cow", "Sheep", "Goat", "Horse", "Rabbit", "Squirrel", "Dog", "Bee", "Slime", "Goblin", "Deer", "Boar", "Bandit", "Leprechaun", "Giant ant"],
  FOREST: ["Wolf", "Boar", "Deer", "Elk", "Brown bear", "Black bear", "Owl", "Raven", "Squirrel", "Badger", "Dryad", "Treant", "Shrubnt", "Dendroid", "Centaur", "Centaurette", "Faerie", "Pixie", "Brownie", "Owlbear", "Satyr", "Werewolf"],
  SWAMP: ["Frog", "Adder", "Asp", "Zombie", "Ghoul", "Will-o-wisp", "Muck", "Muck gobbet", "King muck", "Witch", "Lizardman", "Naga", "Crocodile", "Wraith", "Maneater plant"],
  DESERT: ["Scorpion", "Asp", "Adder", "Camel", "Genie", "Mummy", "Imp", "Kobold", "Ostrich", "Lion", "Sphinx"],
  ROCK: ["Eagle", "Goat", "Cave troll", "Ogre", "Stone golem", "Gargoyle", "Gryphon", "Dragonkin", "Hawk", "Wallmaster"],
  SNOW: ["Yeti", "Polar bear", "Ice elemental", "Ice sprite", "Wolf", "Wendigo"],
  TUNDRA: ["Polar bear", "Wolf", "Elk", "Wendigo", "Ice sprite", "Sasquatch", "Owl"],
  FARM: ["Chicken", "Cow", "Sheep", "Goat", "Horse", "Dog", "Cat", "Bee", "Giant ant", "Wererat"],
  BADLANDS: ["Gnoll", "Gnoll hyena", "Hawk", "Lizard", "Bandit", "Kobold", "Hellhound", "Manticore", "Vampire"],
  JUNGLE: ["Monkey", "Ape", "Gorilla", "Tiger", "Asp", "Lizardman", "Naga", "Arachni", "Harpy", "Centipede", "Frog"],
  MEADOW: ["Rabbit", "Deer", "Bee", "Sheep", "Unicorn", "Faerie", "Pixie", "Horse", "Squirrel"],
  SAVANNA: ["Lion", "Zebra", "Giraffe", "Elephant", "Ostrich", "Gnoll hyena", "Rhinoceros", "Cheetah", "Tiger"],
  ROCKY: ["Goat", "Eagle", "Kobold", "Cave troll", "Ogre", "Boar", "Hawk", "Gargoyle"],
  LABYRINTH: ["Minotaur", "Medusa", "Gelatinous cube", "Gelatinous cube sr.", "Gelatinous cube jr.", "Mummy", "Wallmaster"],
  VOLCANO: ["Fire elemental", "Fire sprite", "Imp", "Hellhound", "Demon", "Red dragon", "Flameskull"],
  WILD: ["Bandit", "Death knight", "Ghoul", "Hellhound", "Demon", "Dark wizard", "Wight", "Werewolf", "Wraith", "Archdevil"],
  TAIGA: ["Wolf", "Elk", "Brown bear", "Owl", "Wendigo", "Sasquatch", "Raven"],
  OASIS: ["Camel", "Asp", "Genie", "Ostrich", "Frog", "Faerie"],
  RUINSB: ["Skeleton", "Zombie", "Ghoul", "Wight", "Gargoyle", "Mummy", "Risen wizard", "Banshee", "Clay golem"],
  SALT: ["Lizard", "Scorpion", "Wight", "Genie", "Mummy", "Will-o-wisp"],
  WETLAND: ["Frog", "Crocodile", "Hippopotamus", "Adder", "Will-o-wisp", "Siren", "Maneater plant"],
  CANYON: ["Kobold", "Gnoll", "Hawk", "Manticore", "Dragonkin", "Purple worm", "Eagle"],
  STEPPE: ["Horse", "Centaur", "Centaurette", "Gnoll", "Bandit", "Harpy", "Elk", "Nightmare"],
  REDDESERT: ["Scorpion", "Hellhound", "Fire sprite", "Manticore", "Purple worm", "Imp"],
  MUSHROOM: ["Funguy", "Gelatinous cube", "Gelatinous cube jr.", "Slime", "Queen slime", "Slime gobbet", "Giant ant", "Pixie"],
  BONE: ["Skeleton", "Ghoul", "Banshee", "Lich", "Death knight", "Wight", "Flameskull"],
  DREAM: ["Faerie", "Pixie", "Unicorn", "Dryad", "Will-o-wisp", "Nightmare", "Sphinx", "Eye of Odin"],
  ASH: ["Wraith", "Flameskull", "Imp", "Hellhound", "Zombie", "Demon", "Raven", "Flesh golem"],
  MOOR: ["Banshee", "Will-o-wisp", "Black bear", "Wolf", "Wight", "Witch", "Raven"],
  GLACIER: ["Ice elemental", "Ice sprite", "Yeti", "Polar bear", "Wendigo", "Mist dragon"],
  BAMBOO: ["Monkey", "Ape", "Tiger", "Faerie", "Lizard", "Bee"],
  CHERRY: ["Deer", "Faerie", "Pixie", "Unicorn", "Satyr", "Monkey", "Rabbit"],
  CRYSTAL: ["Gelatinous cube", "Genie", "Air elemental", "Will-o-wisp", "Eye of Odin", "Floating eye", "Air sprite"],
};
// Callers (2):
//  content.js:489,493
const BIOME_MOBS = {}; // biome id -> [{key,lvl}], includes elite variants
// Callers (2):
//  custom-mobs.js:4 world/chunks.js:16
function resolveBiomeMobs(Bref) {
  for (const bname in BIOME_MOB_NAMES) {
    const id = Bref[bname];
    const out = [];
    for (const disp of BIOME_MOB_NAMES[bname]) {
      const k = slugify(disp);
      if (MONSTERS[k]) out.push({ key: k, lvl: MONSTERS[k].lvl });
      if (MONSTERS[k + "_v"]) out.push({ key: k + "_v", lvl: MONSTERS[k + "_v"].lvl });
    }
    BIOME_MOBS[id] = out.sort((x, y) => x.lvl - y.lvl);
  }
}
// Callers (2):
//  world/chunks.js:721,819
function biomeMobsInBand(biomeId, lo, hi) {
  const list = BIOME_MOBS[biomeId] || [];
  const out = list.filter(b => b.lvl >= lo && b.lvl <= hi);
  if (out.length) return out;
  const under = list.filter(b => b.lvl <= hi);
  return under.length ? under : list.slice(0, 3);
}

// ---------- villagers ----------
// Callers (3):
//  render3d.js:80 world/chunks.js:319,321
const VILLAGER_LOOKS = [
  [["body_player"], ["shirt_orange"], ["hair_brown"]],
  [["body_npc"], ["shirt_green"], ["hat_white"]],
  [["body_player"], ["armor_orange"], ["hair_brown"]],
  [["body_npc"], ["shirt_orange"], ["hair_brown"]],
  [["body_player"], ["shirt_green"], ["hat_white"]],
  [["body_npc"], ["armor_dark"], ["hair_brown"]],
];
// Callers (1):
//  world/chunks.js:318
const VILLAGER_NAMES = ["Alda", "Brom", "Cerys", "Doran", "Elna", "Falk", "Greta", "Hedwig",
  "Ivar", "Jorunn", "Kel", "Lina", "Marek", "Nessa", "Oswin", "Petra", "Quill", "Runa",
  "Soren", "Tilda", "Ulf", "Vika", "Wren", "Ysolt"];
// Callers (0):
//  none found
const VILLAGER_LINES = [
  "Lovely weather for the crops, isn't it?",
  "Watch yourself past the treeline. Things bite out there.",
  "I hear the dragons hoard more gold the further out you go.",
  "The general store's prices are daylight robbery, but it's the only game in town.",
  "My grandmother wove cloth-of-gold once. Took her a lifetime of practice.",
  "They say the runestone circles hum louder at night.",
  "A trader came through last week with meteorite ore. Never seen the like.",
  "The mill's been in the family for four generations.",
  "Don't eat the glowing mushrooms. Trust me.",
  "If you see a stone golem, run. If you see an iron one, pray.",
  "The fish bite better at the far ponds, mark my words.",
  "Once saw a wisp lead a man straight into a bog.",
];

// building tile sprites
SPR.wall_wood       = ["n", 17, 14];  // golden wood building facade (n-sheet 32px, front/back)
SPR.wall_wood_side  = ["t", 34, 15];  // solid wood panel for left/right side walls
SPR.wall_stone      = ["t", 26, 12];  // gray stone block (front/back)
SPR.wall_stone_side = ["t", 27, 12];  // adjacent stone tile for side walls
SPR.wall_tower      = ["t", 26, 12];  // same stone; rendered 3× taller in render3d
SPR.floor_wood    = ["t", 1, 26];
SPR.floor_stone   = ["ta", 3, 1];  // grey cobblestone paving from terrain_a
SPR.floor_stone2  = ["ta", 3, 2];  // flat grey stone variant
SPR.floor_interior = ["ta", 3, 2, { filter: "sepia(0.6) saturate(1.25) brightness(1.04)" }]; // warm sandstone flags — stone-building interiors (distinct from street paving)
SPR.city_fountain = ["t", 22, 0, { filter: "hue-rotate(193deg) saturate(2.5) brightness(1.1)" }]; // blue-tinted barrel = fountain basin
SPR.city_bench    = ["t", 20, 2, { filter: "sepia(0.8) brightness(0.62)" }]; // dark worn bench
SPR.city_planter  = ["t", 22, 0, { filter: "hue-rotate(-58deg) saturate(1.8) brightness(0.80)" }]; // green planter box
SPR.bookshelf   = ["t", 43, 12];  // wooden shelf loaded with coloured books
SPR.bed    = ["t", 14, 2];
SPR.table2 = ["t", 26, 3];
SPR.chair  = ["t", 20, 2];
SPR.dresser = ["t", 23, 5];
SPR.roof_brown = ["t", 25, 21];
SPR.roof_gray  = ["t", 28, 22];
SPR.roof_red   = ["t", 25, 21, { filter: "hue-rotate(-25deg) saturate(1.5) brightness(0.9)" }];
SPR.roof_teal  = ["t", 25, 21, { filter: "hue-rotate(140deg) saturate(0.8)" }];
SPR.roof_tower = ["t", 28, 22,   { filter: "brightness(0.58)" }];  // dark slate for towers
// --- structural billboards (doors / gates / ladders / stairs) ---------------
// Tinted wall/floor-tile FALLBACKS only: js/sprites/structure-sprites-data.js
// overrides all five keys with bespoke PixelLab art (the "sb" sheet) at load.
// These stay as the safety net if that data file is ever dropped.
SPR.door_wood  = ["n", 17, 14, { filter: "brightness(0.5) saturate(1.35) contrast(1.1)" }];  // dark recessed wood door
SPR.door_stone = ["t", 26, 12, { filter: "brightness(0.46) sepia(0.55) saturate(1.5)" }];   // heavy studded castle door
SPR.gate_leaf  = ["n", 17, 14, { filter: "brightness(0.62) sepia(0.4) saturate(0.7) contrast(1.25)" }]; // iron-banded wood gate leaf
SPR.ladder     = ["t", 1, 26,  { filter: "brightness(0.6) sepia(0.55) saturate(1.3)" }];    // wooden rungs (from plank floor tile)
SPR.stairs     = ["t", 1, 26,  { filter: "brightness(0.78) contrast(1.2)" }];               // wooden staircase
// Callers (1):
//  world/chunks.js:298
const ROOFS = ["roof_brown", "roof_gray", "roof_red", "roof_teal"];
// Callers (1):
//  world/chunks.js:298
const ROOFS_STONE = ["roof_gray", "roof_tower"];

// ---------- boats & Sailing ----------
SPR.i_canoe = ["x", 13, 0];
SPR.i_sailboat = ["x", 14, 0];
SPR.i_ship = ["x", 15, 0];
// Sailable hulls. The full 32-vessel fleet is built by SHIPWRIGHTING (shipwrighting.js),
// which mints each vessel and (as of the boat consolidation) assigns its `boat` tier +
// sailReq + sailSpeed so bestBoat() can click-to-sail it. Only skiff/canoe/sailboat/ship
// are declared here because they carry dedicated icons and are REUSED by Shipwrighting
// (mkVessel skips an id that already exists); their sailing props are overridden there so
// the whole fleet shares one tier scale. The 23 old boat_/raft_/ship_* items were removed
// — old saves swap to the Shipwrighting equivalent via BOAT_MIGRATE (storage.js), and the
// legacy ids live on only as OBJ_MAP 3D-model / decor keys.
ITEMS.skiff = { name: "Skiff", icon: "i_skiff", value: 140, boat: 4, sailReq: scaleLevel(8), sailSpeed: 0.9 };
ITEMS.canoe = { name: "Canoe", icon: "i_canoe", value: 120, boat: 5, sailReq: scaleLevel(1), sailSpeed: 0.95 };
ITEMS.sailboat = { name: "Sailboat", icon: "i_sailboat", value: 600, boat: 10, sailReq: scaleLevel(20), sailSpeed: 0.75 };
ITEMS.ship = { name: "Ship", icon: "i_ship", value: 2500, boat: 18, sailReq: scaleLevel(45), sailSpeed: 0.58 };
EXAMINE.boat_coracle = "A woven bowl that floats. Mostly.";
EXAMINE.raft_logs = "Lashed logs and a prayer.";
EXAMINE.raft_planks = "Flat, slow, and reliably damp.";
EXAMINE.skiff = "A light little rowboat.";
EXAMINE.canoe = "A humble dugout. Keeps most of the water out.";
EXAMINE.boat_dinghy = "A tidy tender for calm water.";
EXAMINE.boat_dory = "High sides for a rough chop.";
EXAMINE.boat_catboat = "One mast, one broad sail, no fuss.";
EXAMINE.boat_barge = "Broad of beam, heavy of cargo.";
EXAMINE.sailboat = "Wind in your hair, fish under your keel.";
EXAMINE.ship_smack = "Tan sails and a hold that reeks of herring.";
EXAMINE.ship_cutter = "Fast, single-masted, nimble.";
EXAMINE.ship_dhow = "Lateen-rigged for warm trade winds.";
EXAMINE.ship_schooner = "Two masts of fore-and-aft grace.";
EXAMINE.ship_longship = "A dragon prow and forty oars.";
EXAMINE.ship_junk = "Battened sails and a curved red hull.";
EXAMINE.ship_caravel = "The explorer's faithful little ship.";
EXAMINE.ship = "The open sea is yours.";
EXAMINE.ship_brig = "Two masts of square-rigged muscle.";
EXAMINE.ship_brigantine = "Half square, half fore-aft, all business.";
EXAMINE.ship_galley = "Oars for when the wind won't.";
EXAMINE.ship_barque = "Three masts, tall and proud.";
EXAMINE.ship_carrack = "Towering castles fore and aft.";
EXAMINE.ship_clipper = "Built for one thing: speed.";
EXAMINE.ship_frigate = "Three masts, a row of gunports.";
EXAMINE.ship_galleon = "A floating treasury of the high seas.";
EXAMINE.ship_manofwar = "The mightiest hull ever to take the water.";
// (The legacy Carpentry boat-building recipes were removed — boats are built by
//  SHIPWRIGHTING now (shipwrighting.js). shipwrighting.js also filtered these out of
//  RECIPES.carpentry at runtime via BOAT_ORDER, so removing them here just cleans source.)
const BOAT_ORDER = ["boat_coracle", "raft_logs", "raft_planks", "skiff", "canoe", "boat_dinghy", "boat_dory", "boat_catboat", "boat_barge", "sailboat", "ship_smack", "ship_cutter", "ship_dhow", "ship_schooner", "ship_longship", "ship_junk", "ship_caravel", "ship", "ship_brig", "ship_brigantine", "ship_galley", "ship_barque", "ship_carrack", "ship_clipper", "ship_frigate", "ship_galleon", "ship_manofwar"];

// ---------- terrain_a / terrain_b biome ground overrides ----------
// Direct tiles from terrain_a.png (ta, 43px tiles, pitch=44) and terrain_b.png (tb, 46px tiles, pitch=47)
// These override the CSS-filtered fallbacks set by BIOME_TILES in data.js
SPR.g_snow    = ["ta", 3, 5];  // heavy white snow
SPR.g_glacier = ["ta", 3, 6];  // cracked blue ice
SPR.g_volcano = ["ta", 4, 5];  // bright flowing orange lava
SPR.g_ash     = ["ta", 4, 2];  // dark stone circles (volcanic ash ground)
SPR.g_crystal = ["tb", 0, 5];  // purple amethyst crystal ground
SPR.g_canyon  = ["tb", 6, 4];  // red terracotta cobblestone

// biome decoration sprites from terrain_b.png
SPR.coral_blue = ["tb", 0, 2];  // blue coral formation
SPR.coral_red  = ["tb", 1, 2];  // red/pink coral formation
