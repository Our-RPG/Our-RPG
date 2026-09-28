// ===== Taiao — Pottery · Glassblowing =====
// The clay-and-sand kiln branch, downstream of Mining and the stone trades.
//
//   Mining → clay → Pottery (fire in a kiln) → wares, crucibles, oil lamps
//   Mining → sand + wood ash (Charcoaling) + lime (Limeburning) → Glassblowing
//            → glass → bottles, panes, vials, lenses, mirrors, stained glass
//
// Glass makes the `vial` Potionmaking needs; stained glass consumes Dyeing's
// pigments; mirrors consume silver; glazes consume tin/lead and wood ash. Every
// commodity has a consumer. Loaded in the early data group after stonework.js.
"use strict";

(function () {
  const CATS = { Pottery: "Stone & Earth", Glassblowing: "Stone & Earth" };
  for (const s in CATS) if (!SKILLS.includes(s)) SKILLS.push(s);
  Object.assign(SKILL_CATEGORY, CATS);
  Object.assign(RECIPE_VERB, { Pottery: "Thrown", Glassblowing: "Blown" });
  const bar = nm => (typeof METALS !== "undefined" && (METALS.find(m => m.name === nm) || {}).bar) || null;
  const TIN = bar("Tin") || "bronze_bar", LEAD = bar("Lead") || "iron_bar", SILVER = bar("Silver") || "gold_bar";

  let pi = 300;
  const mk = (id, name, base, extra, props, note) => {
    if (ITEMS[id]) return;
    defineIcon("i_" + id, base, pi++, extra || "");
    ITEMS[id] = Object.assign({ name, icon: "i_" + id }, props);
    EXAMINE[id] = EXAMINE[id] || `${name}.`;
    registerPlaceholder(id, name, note || "kiln good — tinted placeholder");
  };

  // ====================================================================
  // POTTERY — clay fired in a kiln (passive) into wares; glazes from ash/metal
  // ====================================================================
  mk("glaze", "Glaze", "i_vial", " hue-rotate(80deg) saturate(1.4) brightness(1.1)", { stack: true, value: 12, prov: "batch" }, "glaze — tinted placeholder");
  RECIPES.pottery = [
    { id: "ash_glaze",  out: "glaze", qty: 2, name: "Mix ash glaze",  skill: "Pottery", req: 5,  xp: 30, in: { wood_ash: 2, sand: 1 }, tick: 1500, family: "glaze", stations: ["pottery_kiln", "furnace"] },
    { id: "tin_glaze",  out: "glaze", qty: 2, name: "Mix tin glaze",  skill: "Pottery", req: 12, xp: 55, in: { [TIN]: 1, wood_ash: 1 }, tick: 1600, family: "glaze", stations: ["pottery_kiln", "furnace"] },
    { id: "lead_glaze", out: "glaze", qty: 3, name: "Mix lead glaze", skill: "Pottery", req: 18, xp: 80, in: { [LEAD]: 1, sand: 1 }, tick: 1700, family: "glaze", stations: ["pottery_kiln", "furnace"] },
  ];
  // [id, name, req, glazed]  — all fired passively; clay scales with size
  const WARES = [
    ["flowerpot", "Flowerpot", 1, 0], ["clay_bowl", "Clay bowl", 2, 0], ["clay_plate", "Clay plate", 3, 0],
    ["clay_cup", "Clay cup", 4, 0], ["glazed_mug", "Glazed mug", 5, 1], ["clay_jug", "Clay jug", 6, 0],
    ["glazed_pitcher", "Glazed pitcher", 7, 1], ["cooking_pot", "Cooking pot", 8, 0], ["storage_jar", "Storage jar", 9, 0],
    ["glazed_vase", "Glazed vase", 10, 1], ["oil_jar", "Oil jar", 11, 1], ["teapot", "Teapot", 12, 1],
    ["burial_urn", "Burial urn", 13, 1], ["amphora", "Amphora", 14, 0], ["crucible", "Crucible", 15, 0],
    ["water_filter", "Water filter", 16, 0], ["brazier", "Ceramic brazier", 17, 0], ["censer", "Censer", 19, 1],
    ["planter", "Planter", 20, 0], ["birdbath", "Birdbath", 21, 0], ["chimney_pot", "Chimney pot", 22, 0],
    ["retort", "Retort", 23, 0], ["figurine", "Figurine", 24, 1], ["tureen", "Tureen", 25, 1],
    ["jardiniere", "Jardinière", 27, 1], ["garden_urn", "Garden urn", 28, 1],
    ["grand_amphora", "Grand amphora", 30, 1], ["master_vase", "Master's vase", 32, 1],
  ];
  for (const [id, name, req, glazed] of WARES) {
    mk(id, name, "i_vial", ` hue-rotate(${(req * 13) % 60 - 20}deg) sepia(0.4) brightness(${1 - req * 0.004})`, { value: 20 + req * 6, finished: true }, "pottery ware — tinted placeholder");
    const inp = { clay: 1 + Math.floor(req / 6) };
    if (glazed) inp.glaze = 1;
    RECIPES.pottery.push({ id: "throw_" + id, out: id, name: "Throw " + (/^[aeiou]/i.test(name) ? "an " : "a ") + name.toLowerCase(),
      skill: "Pottery", req, xp: 24 + req * 4, in: inp, passive: true, time: 10000 + req * 300, tick: 10000 + req * 300,
      family: glazed ? "glazed_ware" : "earthenware", stations: ["pottery_kiln", "furnace"] });
  }
  // oil lamp — a fired ware that also burns tallow for light
  mk("oil_lamp", "Oil lamp", "i_vial", " hue-rotate(30deg) brightness(1.3)", { stack: true, value: 24, light: true }, "oil lamp — tinted placeholder");
  RECIPES.pottery.push({ id: "throw_oil_lamp", out: "oil_lamp", name: "Throw an oil lamp", skill: "Pottery", req: 8, xp: 44,
    in: { clay: 2, tallow: 1 }, passive: true, time: 11000, tick: 11000, family: "earthenware", stations: ["pottery_kiln", "furnace"] });

  // ====================================================================
  // GLASSBLOWING — sand + ash (soda) + lime (flux) → glass → blown wares
  // ====================================================================
  mk("frit",  "Frit",  "i_vial", " saturate(0.25) brightness(1.15)", { stack: true, value: 8, prov: "batch" }, "frit — tinted placeholder");
  mk("glass", "Glass", "i_vial", " saturate(0.15) brightness(1.4)",  { stack: true, value: 14, prov: "batch" }, "glass — tinted placeholder");
  RECIPES.glassblowing = [
    { id: "mix_frit",  out: "frit", qty: 2, name: "Mix a glass frit",  skill: "Glassblowing", req: 1, xp: 20, in: { sand: 2, wood_ash: 1, slaked_lime: 1 }, tick: 1500, family: "frit", stations: ["glass_furnace", "furnace"] },
    { id: "fine_frit", out: "frit", qty: 3, name: "Mix a fine frit",   skill: "Glassblowing", req: 14, xp: 60, in: { sand: 2, wood_ash: 1, slaked_lime: 1, marble: 1 }, tick: 1600, family: "frit", stations: ["glass_furnace", "furnace"] },
    { id: "melt_glass",   out: "glass", qty: 2, name: "Melt glass",         skill: "Glassblowing", req: 3, xp: 34, in: { frit: 2, charcoal: 1 }, passive: true, time: 14000, tick: 14000, family: "glass", stations: ["glass_furnace", "furnace"] },
    { id: "melt_crystal", out: "glass", qty: 3, name: "Melt crystal glass", skill: "Glassblowing", req: 16, xp: 80, in: { frit: 3, charcoal: 2 }, passive: true, time: 18000, tick: 18000, family: "glass", stations: ["glass_furnace", "furnace"] },
  ];
  // [id, name, req, extraInputs, functional?]  (out `vial` reuses existing item)
  const GLASS = [
    ["vial", "Empty vial", 1, {}, 1], ["glass_bottle", "Glass bottle", 2, {}, 0], ["glass_jar", "Glass jar", 3, {}, 0],
    ["glass_flask", "Glass flask", 4, {}, 0], ["drinking_glass", "Drinking glass", 5, {}, 0], ["glass_bead", "Glass beads", 5, {}, 0],
    ["phial", "Phial", 6, {}, 0], ["marble_glass", "Glass marbles", 6, {}, 0], ["window_pane", "Window pane", 7, {}, 0],
    ["goblet", "Glass goblet", 8, {}, 0], ["bauble", "Glass bauble", 9, {}, 0], ["decanter", "Decanter", 10, {}, 0],
    ["carboy", "Carboy", 11, {}, 0], ["demijohn", "Demijohn", 12, {}, 0], ["bell_jar", "Bell jar", 13, {}, 0],
    ["glass_ornament", "Glass ornament", 14, {}, 0], ["prism", "Prism", 15, {}, 0], ["lens", "Lens", 16, {}, 0],
    ["stained_glass_blue", "Blue stained glass", 17, { woad_dye: 1 }, 0], ["magnifier", "Magnifier", 18, {}, 0],
    ["stained_glass_red", "Red stained glass", 19, { madder_dye: 1 }, 0], ["spectacles", "Spectacles", 20, {}, 0],
    ["mirror", "Mirror", 22, { [SILVER]: 1 }, 0], ["terrarium", "Terrarium", 24, {}, 0],
    ["chandelier_crystal", "Chandelier crystal", 26, {}, 0], ["snow_globe", "Snow globe", 28, {}, 0],
    ["crystal_goblet", "Crystal goblet", 30, {}, 0], ["grand_mirror", "Grand mirror", 32, { [SILVER]: 2 }, 0],
  ];
  for (const [id, name, req, extra, fn] of GLASS) {
    if (!fn) mk(id, name, "i_vial", ` hue-rotate(${(req * 29) % 360}deg) saturate(0.5) brightness(1.3)`, { value: 22 + req * 6, finished: true }, "glassware — tinted placeholder");
    const inp = Object.assign({ glass: 1 + Math.floor(req / 8) }, extra);
    RECIPES.glassblowing.push({ id: "blow_" + id, out: id, qty: id === "vial" ? 3 : 1, name: "Blow " + (/^[aeiou]/i.test(name) ? "an " : "a ") + name.toLowerCase(),
      skill: "Glassblowing", req, xp: 24 + req * 4, in: inp, tick: 1600 + req * 30,
      family: /stained/.test(id) ? "stained_glass" : fn ? "vessels" : "glassware", stations: ["glass_furnace", "furnace"] });
  }

  // glass beads (→ Jewelry) and lenses (→ Bookbinding/optics) are stackable components
  if (ITEMS.glass_bead) ITEMS.glass_bead.stack = true;
  if (ITEMS.lens) ITEMS.lens.stack = true;

  // snorkel — a blown breathing tube on a leather strap. Equipped on the face
  // it raises the drowning waterline (SNORKEL_REACH) and halves air drain
  // once even the tube is under — see tickAir in gameplay/movement.js.
  // wearReq pinned to 0: a snorkel is NOT armour — without this market.js
  // would stamp the recipe tier as a Defence gate (same trick as candles)
  mk("snorkel", "Snorkel", "i_vial", " hue-rotate(160deg) saturate(0.8) brightness(1.25)",
    { value: 96, equip: "face", finished: true, wearReq: 0 }, "snorkel — tinted placeholder");
  // diving bonuses read by movement.js tickAir/diveGear (generalised so rubber
  // diving gear can stack): the snorkel raises the waterline and halves drain —
  // exactly the old hard-coded snorkel behaviour, now data-driven. (0.4 is the
  // literal SNORKEL_REACH from main/state.js — hardcoded here because that const
  // loads AFTER this skill file, so referencing it would hit the TDZ.)
  if (ITEMS.snorkel) { ITEMS.snorkel.diveReach = 0.4; ITEMS.snorkel.diveDrain = 0.5; }
  EXAMINE.snorkel = "A blown-glass breathing tube on a leather strap, capped with a moulded rubber mouthpiece. Worn on the face, it keeps the air coming a while after the water closes over your head.";
  // needs a rubber snorkel_mouthpiece (Rubbermaking) alongside the blown glass
  // tube and leather strap — the rubber is what your teeth actually bite on.
  RECIPES.glassblowing.push({ id: "blow_snorkel", out: "snorkel", name: "Blow a snorkel",
    skill: "Glassblowing", req: 10, xp: 64, in: { glass: 2, leather: 1, snorkel_mouthpiece: 1 }, tick: 1900,
    family: "glassware", stations: ["glass_furnace", "furnace"] });

  // ---------- workstations ----------
  Object.assign(STATIONS, {
    pottery_kiln:  { name: "Pottery kiln",  spr: "furnace", action: "Throw pot", lists: ["pottery"], quality: 60 },
    glass_furnace: { name: "Glass furnace", spr: "furnace", action: "Blow glass", lists: ["glassblowing"], quality: 62 },
  });
  STATIONS.furnace.lists.push("pottery", "glassblowing");

  Object.assign(PROD_SKILL_INTRO, {
    Pottery: "Throw clay into wares and fire them in a kiln — flowerpots and bowls up through amphorae, oil jars, crucibles and a master's vase — finishing the finer pieces with ash, tin or lead glazes. Firing takes real time at the kiln.",
    Glassblowing: "Melt sand, soda-ash and lime into glass, then blow bottles, panes, drinking glasses, lenses, mirrors and stained glass. Blows the vials the apothecaries need; stains its finest work with the dyer's pigments.",
  });

  for (const cat in RECIPES) RECIPES[cat].forEach((r, i) => {
    if (!r.id) r.id = cat + ":" + (r.out || i) + ":" + i;
    if (!r.family) r.family = cat;
  });
})();
