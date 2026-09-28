// ===== Taiao — Cheesemaking =====
// Dairy processing split out of Cooking into its own trade (the way Baking was).
// Milk (from Husbandry) is curdled into CURDS (+ a WHEY by-product), then turned
// into fresh cheeses (active) or AGED cheeses (passive — the prompt's "cheese
// ageing" pattern, using the production-job queue). Cheeses are food, so they
// need no downstream consumer; curds feed the cheeses and whey feeds ricotta,
// so the graph stays clean. Interconnects milk (Husbandry), herbs/truffles
// (Foraging) and beeswax (Husbandry bees, for waxed rinds).
// Loaded after husbandry.js. New items use placeholder tinted sprites.
"use strict";

(function () {
  if (!SKILLS.includes("Cheesemaking")) SKILLS.push("Cheesemaking");
  SKILL_CATEGORY.Cheesemaking = "Food & Drink";
  RECIPE_VERB.Cheesemaking = "Made";

  // migrate the stop-gap cheese recipe out of Cooking (Cooking keeps butter/eggs)
  if (RECIPES.cook) RECIPES.cook = RECIPES.cook.filter(r => r.out !== "cheese");

  let ci = 90; // placeholder hue seed
  const ico = (key, base, extra) => defineIcon(key, base, ci++, extra || "");
  const mk = (id, name, base, extra, props, note) => {
    if (ITEMS[id]) return; // reuse existing (e.g. `cheese`)
    ico("i_" + id, base, extra);
    ITEMS[id] = Object.assign({ name, icon: "i_" + id }, props);
    EXAMINE[id] = EXAMINE[id] || `${name}.`;
    registerPlaceholder(id, name, note || "cheesemaking good — tinted placeholder");
  };

  // ---------- intermediates ----------
  mk("curds", "Curds", "i_cotton", " brightness(1.3) saturate(0.25) sepia(0.15)", { stack: true, value: 8, prov: "batch" }, "curds — tinted placeholder");
  mk("whey",  "Whey",  "i_cotton", " brightness(1.45) saturate(0.1)",             { stack: true, value: 2, prov: "batch" }, "whey — tinted placeholder");

  RECIPES.cheesemaking = [];
  // curdling (active): milk → curds, with a whey by-product that feeds ricotta
  RECIPES.cheesemaking.push(
    // curdling empties the milk pails, so each returns an empty `pail`. Milk
    // cost halved and xp per batch raised (user req 2026-09-16: L1->L2 was
    // too grindy) — milk sits behind a slow Husbandry/feed/milling supply
    // chain, so the fix targets milk EFFICIENCY here rather than the milk
    // supply itself: 25 crafts (25 milk) now reaches level 2, vs. 30 crafts
    // (60 milk) before.
    { id: "curdle_milk", out: "curds", qty: 2, name: "Curdle milk", skill: "Cheesemaking",
      req: 1, xp: 26, in: { milk: 1 }, tick: 1500, family: "curds",
      byproducts: [{ id: "whey", qty: 1 }, { id: "pail", qty: 1 }], stations: ["creamery", "cauldron", "barn"] },
    { id: "rich_curds", out: "curds", qty: 4, name: "Set rich curds", skill: "Cheesemaking",
      req: 8, xp: 44, in: { milk: 3 }, tick: 1600, family: "curds",
      byproducts: [{ id: "whey", qty: 2 }, { id: "pail", qty: 3 }], stations: ["creamery", "cauldron", "barn"] },
  );

  // ---------- cheeses (30) — [id, displayName, family, req, inputs, ageSec(0=active)] ----------
  // Fresh cheeses press quickly; aged cheeses take a much longer craft time.
  // Reuses the existing `cheese` item as basic "Farmhouse cheese".
  const CHEESES = [
    ["cottage_cheese",  "Cottage cheese",    "fresh_cheese", 2,  { curds: 2 }, 0],
    ["ricotta",         "Ricotta",           "fresh_cheese", 3,  { whey: 3 }, 0],
    ["cheese",          "Farmhouse cheese",  "fresh_cheese", 4,  { curds: 2 }, 0],
    ["paneer",          "Paneer",            "fresh_cheese", 5,  { curds: 2 }, 0],
    ["quark",           "Quark",             "fresh_cheese", 6,  { curds: 2 }, 0],
    ["herb_cheese",     "Herb cheese",       "flavoured",    7,  { curds: 2, herb: 1 }, 0],
    ["mozzarella",      "Mozzarella",        "fresh_cheese", 8,  { curds: 3 }, 0],
    ["feta",            "Feta",              "fresh_cheese", 9,  { curds: 3 }, 0],
    ["cheddar",         "Cheddar",           "aged_cheese",  10, { curds: 3 }, 25],
    ["chevre",          "Chèvre",            "fresh_cheese", 11, { curds: 3 }, 0],
    ["gouda",           "Gouda",             "aged_cheese",  12, { curds: 3 }, 28],
    ["mascarpone",      "Mascarpone",        "fresh_cheese", 13, { curds: 2 }, 0],
    ["edam",            "Edam",              "aged_cheese",  14, { curds: 3 }, 28],
    ["halloumi",        "Halloumi",          "fresh_cheese", 15, { curds: 3 }, 0],
    ["waxed_gouda",     "Waxed gouda",       "waxed_cheese", 16, { curds: 3, beeswax: 1 }, 30],
    ["emmental",        "Emmental",          "aged_cheese",  17, { curds: 4 }, 32],
    ["gruyere",         "Gruyère",           "aged_cheese",  18, { curds: 4 }, 34],
    ["brie",            "Brie",              "aged_cheese",  19, { curds: 3 }, 30],
    ["camembert",       "Camembert",         "aged_cheese",  20, { curds: 3 }, 32],
    ["gorgonzola",      "Gorgonzola",        "blue_cheese",  21, { curds: 4 }, 34],
    ["stilton",         "Stilton",           "blue_cheese",  22, { curds: 4 }, 36],
    ["roquefort",       "Roquefort",         "blue_cheese",  23, { curds: 4 }, 36],
    ["parmesan",        "Parmesan",          "aged_cheese",  24, { curds: 5 }, 45],
    ["smoked_cheese",   "Smoked cheese",     "waxed_cheese", 25, { curds: 3, beeswax: 1 }, 32],
    ["cave_aged",       "Cave cheese",       "waxed_cheese", 26, { curds: 5, beeswax: 1 }, 50],
    ["manchego",        "Manchego",          "aged_cheese",  27, { curds: 4 }, 40],
    ["aged_gruyere",    "Reserve gruyère",   "aged_cheese",  28, { curds: 6 }, 55],
    ["truffle_cheese",  "Truffle cheese",    "luxury",       29, { curds: 4, forage_11: 1 }, 20],
    ["moon_brie",       "Moonlight brie",    "luxury",       30, { curds: 5, forage_11: 1 }, 40],
    ["kings_cheese",    "King's reserve cheese", "luxury",   32, { curds: 8, beeswax: 2 }, 60],
  ];
  for (const [id, name, family, req, inp, ageSec] of CHEESES) {
    mk(id, name, "i_bread", ` hue-rotate(${(req * 11) % 40 - 8}deg) saturate(1.4) brightness(${1 - req * 0.005})`,
      { stack: true, value: 20 + req * 4, heals: 4 + Math.floor(req / 3), prov: "batch" }, "cheese — tinted bread-icon placeholder");
    // active cheeses are pressed ("Make"), passive ones matured ("Age"); use
    // "Mature" if the name itself already says aged, so we never get "Age aged…"
    const verb = ageSec ? (/aged/i.test(name) ? "Mature" : "Age") : "Make";
    const rec = { id: "cheese_" + id, out: id, name: verb + " " + name.toLowerCase(),
      skill: "Cheesemaking", req, xp: 24 + req * 4, in: inp, tick: ageSec ? ageSec * 1000 : 1500,
      family, stations: ["creamery", "cauldron"] };
    if (ageSec) { rec.passive = true; rec.time = ageSec * 1000; }
    RECIPES.cheesemaking.push(rec);
  }

  // ---------- workstation ----------
  STATIONS.creamery = { name: "Creamery", spr: "cauldron", action: "Make cheese", lists: ["cheesemaking"], quality: 60 };
  STATIONS.cauldron.lists.push("cheesemaking"); // reachable now
  // (the barn station was removed — cheesemaking lives at the creamery/cauldron)

  Object.assign(PROD_SKILL_INTRO, {
    Cheesemaking: "Curdle milk into curds (and whey), then press fresh cheeses quickly or age the finer ones over a long craft — cottage, feta and mozzarella up through cheddar, gruyère, blue stiltons and long cave-aged wheels. Split out of Cooking; the biggest buyer of a dairy farm's milk.",
  });

  for (const cat in RECIPES) RECIPES[cat].forEach((r, i) => {
    if (!r.id) r.id = cat + ":" + (r.out || i) + ":" + i;
    if (!r.family) r.family = cat;
  });
})();
