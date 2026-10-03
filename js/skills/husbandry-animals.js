// ===== Taiao — Husbandry as living, roaming animals (32-tier) =====
// You tend physical animals that roam the pastures. The 32 progression tiers map
// onto specific creatures; a species that appears at several tiers offers each
// unlocked action on its RIGHT-CLICK menu (left-click does the highest one).
//
// Rules (per design):
//  • NO tending yields meat / hide / tallow — those come only from KILLING the
//    animal (combat butcher). Tending yields eggs/feathers/fleece/milk/honey/
//    beeswax/scales, OR (for "Raise ___" tiers) spawns a physical BABY animal
//    that grows into the full-size adult after 300s.
//  • After ANY tend, the animal is "spent" and on a 300s cooldown; you must FEED
//    it (its tier's food) once the cooldown elapses to make it tendable again.
//  • GIANTS are the game's pre-existing "_v" elite creatures. They are NOT
//    separate tiers: EVERY "_v" giant simply offers its base species' own tiers
//    (husbActions falls back to ACTIONS[baseKind] with giant:true) at DOUBLE
//    feed → DOUBLE produce (harvest mult, world.js) / a giant baby. So a giant
//    sheep shears/raises exactly like a sheep, just 2x in and 2x out.
// Loaded after husbandry.js (before agriculture.js, which wipes CROPS — so the
// alfalfa crop is registered in a deferred hook).
"use strict";

(function () {
  const Cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  // ---- new-species MONSTERS (combat stats + 8-dir sprite) + their "_v" giants ----
  const NEW_MOBS = {
    // key:     [name,      lvl, hp, maxHit, def, atkTick, aggro, scale, meat, hide]
    quail:   ["Quail",     1,  3,  0, 0, 3000, false, 0.42, 1, 0],
    duck:    ["Duck",      4,  6,  0, 1, 3000, false, 0.55, 1, 0],
    rabbit:  ["Rabbit",    2,  4,  0, 0, 3000, false, 0.45, 1, 1],
    goat:    ["Goat",      8,  20, 1, 3, 2600, false, 0.80, 1, 1],
    pig:     ["Pig",       9,  30, 2, 4, 2400, false, 1.05, 2, 1],
    griffon: ["Griffon",   29, 95, 9, 18, 2000, true,  1.65, 2, 2],
    goose:   ["Goose",     8,  12, 1, 2, 2800, false, 0.62, 1, 0],
    turkey:  ["Turkey",    12, 18, 1, 3, 2600, false, 0.78, 2, 0],
    buffalo: ["Buffalo",   21, 60, 4, 12, 2400, false, 1.55, 3, 2],
    alpaca:  ["Alpaca",    23, 40, 2, 8, 2600, false, 0.98, 1, 1],
    aurochs: ["Aurochs",   27, 110, 8, 20, 2200, true, 1.75, 4, 3],
    wyrmling: ["Wyrmling", 31, 120, 11, 22, 1900, true, 1.15, 2, 4],
  };
  if (typeof MONSTERS !== "undefined")
    for (const k in NEW_MOBS) {
      const [name, lvl, hp, maxHit, def, atkTick, aggro, scale, meat, hide] = NEW_MOBS[k];
      if (MONSTERS[k]) { // goat/rabbit already exist from content.js — apply our size
        MONSTERS[k].scale = scale;
        if (MONSTERS[k + "_v"]) MONSTERS[k + "_v"].scale = scale * 1.5;
        continue;
      }
      MONSTERS[k] = {
        name, lvl: (typeof scaleLevel === "function" ? scaleLevel(lvl) : lvl),
        hp, maxHit, def, atkTick, aggro,
        spr: [["mcd_" + k + "_south"]], dirSpr: true, scale,
        butcher: { meat, hide, hideItem: "hide" },
        drops: k === "pig" ? [{ id: "tallow", min: 1, max: 2, ch: 0.6 }] : [],
        respawn: 16000, xp: 8 + lvl * 3,
      };
      MONSTERS[k + "_v"] = Object.assign({}, MONSTERS[k], {
        name: "Giant " + name, scale: scale * 1.5, hp: hp * 2,
        lvl: (typeof scaleLevel === "function" ? scaleLevel(Math.min(60, lvl * 2 + 4)) : lvl),
      });
    }

  // ---- spent-state sprites (baked into the composite atlas at boot) ----
  if (typeof SPR !== "undefined") {
    if (!SPR.m_chicken_spent) SPR.m_chicken_spent = ["m", 0, 15, { filter: "brightness(0.9) saturate(0.55)" }];
    if (!SPR.m_cow_spent) SPR.m_cow_spent = ["m", 1, 15, { filter: "brightness(0.92) saturate(0.6) hue-rotate(-8deg)" }];
    if (!SPR.bee_spent) SPR.bee_spent = ["md", 0, 38, { filter: "brightness(0.82) saturate(0.6)" }];
  }
  // which spent sprite an animal shows after a HARVEST (raise leaves it unchanged)
  const SPENT_SPR = {
    sheep: "m_sheep_shorn", chicken: "m_chicken_spent", cow: "m_cow_spent", bee: "bee_spent",
    quail: "quail_spent", duck: "duck_spent", goat: "goat_spent", goose: "goose_spent",
    turkey: "turkey_spent", buffalo: "buffalo_spent", alpaca: "alpaca_spent",
    griffon: "griffon_spent", wyrmling: "wyrmling_spent",
  };
  // exported for animal-spent-dirs.js (loads later, after animal-dir-fix.js):
  // it derives per-DIRECTION spent frames from the corrected mcd_ walk frames
  // so a recovering animal keeps facing the way it walks.
  window.HUSB_SPENT_SPR = SPENT_SPR;

  // ---- items: bucket, alfalfa (+seeds), scales, and the "giant" product line ----
  if (typeof ITEMS !== "undefined") {
    if (!ITEMS.bucket) {
      if (typeof SPR !== "undefined") SPR.i_bucket = ["t", 22, 0, { filter: "hue-rotate(20deg) brightness(1.08) saturate(0.65)" }];
      ITEMS.bucket = { name: "Bucket", icon: "i_bucket", stack: true, value: 6 };
      if (typeof EXAMINE !== "undefined") EXAMINE.bucket = "A sturdy wooden bucket — a general-purpose pail.";
      if (typeof RECIPES !== "undefined")
        // carpentry, NOT the orphaned "crafting" list — no station hosts
        // "crafting" (chandlery.js took the candles; nothing lists the rest),
        // so containers must live where the workbench actually looks.
        (RECIPES.carpentry = RECIPES.carpentry || []).push({
          id: "make_bucket", out: "bucket", name: "Make a bucket", skill: "Carpentry",
          req: 1, xp: 14, in: { planks: 1 }, tick: 1200, family: "containers",
        });
    }
    // empty pails — the milking container. Consumed when you milk an animal and
    // returned to you when the milk is curdled at a creamery (see cheesemaking.js).
    if (!ITEMS.pail) {
      if (typeof SPR !== "undefined") SPR.i_pail = ["t", 22, 0, { filter: "hue-rotate(-8deg) brightness(1.14) saturate(0.5)" }];
      ITEMS.pail = { name: "Empty pail", icon: "i_pail", stack: true, value: 6, tool: true };
      if (typeof EXAMINE !== "undefined") EXAMINE.pail = "An empty wooden pail — carry these to milk your animals.";
      if (typeof RECIPES !== "undefined")
        (RECIPES.carpentry = RECIPES.carpentry || []).push({
          id: "make_pail", out: "pail", name: "Make an empty pail", skill: "Carpentry",
          req: 1, xp: 14, in: { planks: 1 }, tick: 1200, family: "containers",
        });
      if (typeof SHOP_STOCK !== "undefined") SHOP_STOCK.push("pail");
    }
    const wheatIcon = (ITEMS.wheat && ITEMS.wheat.icon) || "i_wheat";
    const seedIcon = (ITEMS.wheat_seeds && ITEMS.wheat_seeds.icon) || "i_seeds_w";
    if (!ITEMS.alfalfa) {
      ITEMS.alfalfa = { name: "Alfalfa", icon: wheatIcon, stack: true, value: 4 };
      ITEMS.alfalfa_seeds = { name: "Alfalfa seeds", icon: seedIcon, stack: true, value: 3 };
      if (typeof EXAMINE !== "undefined") {
        EXAMINE.alfalfa = "Rich green fodder — camels thrive on it.";
        EXAMINE.alfalfa_seeds = "Seeds for growing alfalfa fodder.";
      }
      if (typeof SHOP_STOCK !== "undefined") SHOP_STOCK.push("alfalfa", "alfalfa_seeds");
    }
    if (!ITEMS.scales) {
      ITEMS.scales = { name: "Scales", icon: (ITEMS.hide && ITEMS.hide.icon) || "i_meat", stack: true, value: 22 };
      if (typeof EXAMINE !== "undefined") EXAMINE.scales = "Shed reptile scales — prized by armourers.";
      // ...and armourers really do prize them: wyrmling scales + leather → scale
      // armour (the Husbandry exotic line's dedicated Armoursmithing sink)
      if (typeof SPR !== "undefined" && SPR.i_body && !SPR.i_scale_hauberk)
        SPR.i_scale_hauberk = [SPR.i_body[0], SPR.i_body[1], SPR.i_body[2], { filter: "hue-rotate(95deg) saturate(1.2) brightness(0.9)" }];
      ITEMS.scale_hauberk = ITEMS.scale_hauberk || {
        name: "Scale hauberk", icon: SPR && SPR.i_scale_hauberk ? "i_scale_hauberk" : "i_body",
        value: 420, equip: ["torso", "pauldron1", "pauldron2", "left_arm", "right_arm"], block: 0.16,
      };
      if (typeof EXAMINE !== "undefined") EXAMINE.scale_hauberk = "Overlapping wyrmling scales stitched onto leather — light for the protection it gives.";
      if (typeof registerPlaceholder === "function") registerPlaceholder("scale_hauberk", "Scale hauberk", "scale armour — tinted body-icon placeholder");
      (RECIPES.armoursmithing = RECIPES.armoursmithing || []).push({
        id: "smith_scale_hauberk", out: "scale_hauberk", name: "Stitch a scale hauberk",
        skill: "Armoursmithing", req: 20, xp: 160, in: { scales: 6, leather: 2 },
        tick: 2400, family: "armour", stations: ["anvil"],
      });
    }
    // young-animal items — weaned young the roaming "Raise" tiers sometimes yield
    // alongside the physical baby (litters). Livestock trade goods: farm markets
    // buy them (finished => market.js tags them to Husbandry, excluded from the
    // dead-output check like other commissioned goods).
    const babyIcon = (ITEMS.egg && ITEMS.egg.icon) || "i_meat";
    const BABY_ITEMS = { kit: ["Kit", 20], piglet: ["Piglet", 35], poult: ["Poult", 30], kid: ["Kid", 40],
      lamb: ["Lamb", 45], calf: ["Calf", 70], camel_calf: ["Camel calf", 65], aurochs_calf: ["Aurochs calf", 110] };
    for (const id in BABY_ITEMS) {
      const [nm, val] = BABY_ITEMS[id];
      if (!ITEMS[id]) ITEMS[id] = { name: nm, icon: babyIcon, stack: true, value: val };
      ITEMS[id].finished = true; ITEMS[id].value = ITEMS[id].value || val;
      if (typeof EXAMINE !== "undefined") EXAMINE[id] = `A weaned young ${nm.toLowerCase()} — healthy stock fetches a good price at farm markets.`;
    }
    // (No "giant_<item>" product line: giant beasts simply yield 2x the ordinary item.)
  }
  // register alfalfa as a farmable crop AFTER agriculture.js has rebuilt CROPS
  if (typeof setTimeout === "function") setTimeout(() => {
    if (typeof CROPS !== "undefined" && !CROPS.alfalfa)
      CROPS.alfalfa = {
        name: "alfalfa", seed: "alfalfa_seeds", item: "alfalfa",
        req: (typeof scaleLevel === "function" ? scaleLevel(1) : 1), plantXp: 12, xp: 40,
        time: 60000, yield: [3, 5], spr: "wheat_plant", skill: "Farming", cat: "Cerealiculture",
      };
  }, 0);

  // ---- the 32 tiers: [id, name, kind, req, type, feed, out, xp, opts?] ----
  // type: collect | shear | milk | pluck | apiary | raise. out for harvest = item
  // map; for raise = {baby:"<kind>"}. opts.babyChance = ["<kind>", chance].
  const TIERS = [
    ["keep_quail",      "Tend quail",              "quail",     1,  "collect", { bran: 1 },            { quail_egg: 2, feathers: 1 }, 24],
    ["keep_hens",       "Tend hens",               "chicken",   2,  "collect", { bran: 2 },            { egg: 3, feathers: 1 }, 28],
    ["milk_cows",       "Milk cows",               "cow",       3,  "milk",    { bran: 3, wheat: 1 },  { milk: 3 },             30],
    ["raise_rabbits",   "Raise rabbits",           "rabbit",    4,  "raise",   { bran: 1 },            { baby: "rabbit" },      18],
    ["shear_sheep",     "Shear sheep",             "sheep",     5,  "shear",   { bran: 2 },            { fleece: 2 },           26],
    ["keep_ducks",      "Tend ducks",              "duck",      6,  "collect", { bran: 2, wheat: 1 },  { egg: 2, feathers: 2 }, 24],
    ["keep_bees",       "Tend bees",               "bee",       7,  "apiary",  { berries: 2 },         { honey: 2, beeswax: 1 }, 30],
    ["milk_camels",     "Milk camels",             "camel",     8,  "milk",    { alfalfa: 3 },         { milk: 2 },             24],
    ["keep_geese",      "Tend geese",              "goose",     9,  "collect", { bran: 3 },            { feathers: 3, egg: 1 }, 28],
    ["milk_goats",      "Milk goats",              "goat",      10, "milk",    { bran: 2 },            { milk: 2 },             24, { babyChance: ["goat", 0.3] }],
    ["raise_pigs",      "Raise pigs",              "pig",       11, "raise",   { bran: 3 },            { baby: "pig" },         30],
    ["raise_turkeys",   "Raise turkeys",           "turkey",    12, "raise",   { bran: 3, wheat: 1 },  { baby: "turkey" },      32],
    ["raise_goats",     "Raise goats",             "goat",      13, "raise",   { bran: 3 },            { baby: "goat" },        34],
    ["raise_sheep",     "Raise sheep",             "sheep",     14, "raise",   { bran: 3, wheat: 1 },  { baby: "sheep" },       34],
    ["apiary",          "Tend an apiary",          "bee",       15, "apiary",  { berries: 3 },         { honey: 4, beeswax: 2 }, 40],
    ["raise_camels",    "Raise camels",            "camel",     16, "raise",   { alfalfa: 6 },         { baby: "camel" },       46],
    ["raise_oxen",      "Raise oxen",              "cow",       17, "raise",   { bran: 4, wheat: 2 },  { baby: "cow" },         44],
    ["raise_cattle",    "Raise cattle",            "cow",       18, "raise",   { bran: 4, wheat: 2 },  { baby: "cow" },         44],
    ["raise_boar",      "Raise boar",              "pig",       19, "raise",   { bran: 4 },            { baby: "pig" },         42],
    ["fine_wool_flock", "Tend a fine-wool flock",  "sheep",     20, "shear",   { bran: 4 },            { fleece: 4 },           40],
    ["milk_buffalo",    "Milk buffalo",            "buffalo",   21, "milk",    { bran: 5 },            { milk: 4 },             46],
    ["raise_buffalo",   "Raise buffalo",           "buffalo",   22, "raise",   { bran: 5, wheat: 3 },  { baby: "buffalo" },     46],
    ["shear_alpaca",    "Shear alpaca",            "alpaca",    23, "shear",   { bran: 4 },            { fleece: 4 },           44],
    ["dairy_herd",      "Tend a dairy herd",       "cow",       24, "milk",    { bran: 5 },            { milk: 5 },             48],
    ["cashmere_goats",  "Comb cashmere goats",     "goat",      25, "shear",   { bran: 5 },            { fleece: 5 },           48],
    ["forest_hives",    "Tend forest hives",       "bee",       26, "apiary",  { berries: 4 },         { honey: 5, beeswax: 3 }, 50],
    ["raise_aurochs",   "Raise aurochs",           "aurochs",   27, "raise",   { bran: 6, wheat: 3 },  { baby: "aurochs" },     52],
    ["pedigree_wool",   "Raise pedigree wool sheep","sheep",    28, "shear",   { bran: 6 },            { fleece: 6 },           54],
    ["keep_griffons",   "Tend griffons",           "griffon",   29, "pluck",   { raw_meat: 3 },        { feathers: 6 },         55],
    ["prize_dairy",     "Tend prize dairy cattle", "cow",       30, "milk",    { bran: 6, wheat: 3 },  { milk: 6 },             56],
    ["tend_wyrmlings",  "Tend wyrmlings",          "wyrmling",  31, "collect", { raw_meat: 4 },        { scales: 2, egg: 1 },   60],
    ["royal_apiary",    "Tend the royal apiary",   "bee",       32, "apiary",  { berries: 5 },         { honey: 7, beeswax: 4 }, 60],
  ];
  const ACTIONS = {}; // kind -> [action, ...]
  for (const [id, name, kind, req, type, feed, out, xp, opts] of TIERS) {
    (ACTIONS[kind] = ACTIONS[kind] || []).push({
      id, name, kind, req, type, feed, out, xp,
      babyChance: (opts && opts.babyChance) || null,
    });
  }

  // ---- baby monsters: a small creature that grows into its adult after 300s ----
  const BABY_NAME = { rabbit: "Kit", pig: "Piglet", turkey: "Poult", goat: "Kid",
    sheep: "Lamb", camel: "Calf", cow: "Calf", aurochs: "Aurochs calf", buffalo: "Buffalo calf" };
  const BREED = new Set();               // adult kinds that babies grow into
  for (const t of TIERS) if (t[6] && t[6].baby) BREED.add(t[6].baby);
  for (const b of [...BREED]) if (typeof MONSTERS !== "undefined" && MONSTERS[b + "_v"]) BREED.add(b + "_v"); // giant fallback breeds giant babies
  if (typeof MONSTERS !== "undefined")
    for (const adult of BREED) {
      const base = MONSTERS[adult]; if (!base || MONSTERS[adult + "_baby"]) continue;
      const isG = /_v$/.test(adult), root = adult.replace(/_v$/, "");
      const nm = (isG ? "Giant " : "") + (BABY_NAME[adult] || BABY_NAME[root] || ("Baby " + base.name));
      MONSTERS[adult + "_baby"] = Object.assign({}, base, {
        name: nm, scale: (base.scale || 1) * 0.5, hp: Math.max(2, Math.round(base.hp / 3)),
        aggro: false, lvl: 1, growTo: adult,
        butcher: { meat: Math.max(1, Math.floor(((base.butcher && base.butcher.meat) || 1) / 2)), hide: 0, hideItem: "hide" },
        drops: [],
      });
    }

  // ---- helpers ----
  const COOLDOWN = 300000; // 300s after tending before you can feed again
  // PERF: soonest growAt among pending babies, so growBabies() (called every
  // frame) can early-return without scanning the whole monsters array until a
  // baby is actually due. Lowered when a baby is born (spawnBaby) and recomputed
  // during each real growBabies scan. 0 forces the first scan to initialise it.
  let _nextGrowAt = 0;
  const baseKind = k => (k || "").replace(/_v$/, "");
  const aniName = mon => (MONSTERS[mon.kind] && MONSTERS[mon.kind].name) || mon.kind;
  function husbActions(mon) {
    if (!mon) return null;
    if (ACTIONS[mon.kind]) return ACTIONS[mon.kind].map(a => Object.assign({ giant: false }, a));   // a normal-species tier
    if (/_v$/.test(mon.kind) && ACTIONS[baseKind(mon.kind)])                                         // EVERY "_v" giant: its base species' tiers, doubled
      return ACTIONS[baseKind(mon.kind)].map(a => Object.assign({ giant: true }, a));
    return null;
  }
  const feedStr = feed => Object.entries(feed).map(([id, q]) => `${q} ${(ITEMS[id] ? ITEMS[id].name : id).toLowerCase()}`).join(", ");
  const FEED_MULT = 5; // user request 2026-09-15: animals need 5x the food they used to
  const scaleFeed = (feed, giant) => { const f = {}; for (const k in feed) f[k] = feed[k] * (giant ? 2 : 1) * FEED_MULT; return f; };
  const secsLeft = mon => Math.max(0, Math.ceil((((mon.husbReadyAt || 0) - now)) / 1000));

  function spawnBaby(mon, adultKind) {
    if (!MONSTERS[adultKind + "_baby"]) adultKind = baseKind(adultKind); // safety
    if (!MONSTERS[adultKind + "_baby"]) return;
    let nx = mon.x, ny = mon.y;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]])
      if (world.inMap(mon.x + dx, mon.y + dy) && !world.isBlocked(mon.x + dx, mon.y + dy) && !world.isWater(mon.x + dx, mon.y + dy)) { nx = mon.x + dx; ny = mon.y + dy; break; }
    const bk = adultKind + "_baby";
    monsters.push({
      uid: ++_monUid,
      kind: bk, x: nx, y: ny, sx: nx, sy: ny, px: PX(nx), py: PX(ny),
      hp: monMaxHp(bk), alive: true, moving: null, target: null, nextAtkAt: 0,
      facing: 1, dir8: "south", spr: MONSTERS[bk].spr, lungeT: -9999,
      spawnBiome: world.biomeAt(nx, ny), growTo: adultKind, growAt: now + COOLDOWN,
    });
    // keep the soonest-maturation hint current so growBabies wakes in time
    if (now + COOLDOWN < _nextGrowAt) _nextGrowAt = now + COOLDOWN;
    return MONSTERS[bk].name;
  }
  // grow babies into adults once their timer elapses (called from updateWorldStuff)
  function growBabies() {
    // PERF: skip the full-array scan until the soonest baby is actually due.
    // _nextGrowAt is the min growAt over all pending babies, so `now < it` means
    // none can have matured yet — maturation still fires on the exact same frame
    // as before (when now >= that min, we fall through and scan).
    if (now < _nextGrowAt) return;
    let soonest = Infinity; // recompute the min over whatever babies remain
    for (const m of monsters) {
      if (!m.growTo) continue;                                   // not a maturing baby
      if (m.alive && now >= (m.growAt || 0)) {                   // due — mature it now
        const adult = MONSTERS[m.growTo]; if (!adult) { m.growTo = null; continue; }
        m.kind = m.growTo; m.spr = adult.spr; m.hp = adult.hp; m.growTo = null; m.growAt = 0;
        if (typeof uiDirty !== "undefined") uiDirty = true;
        continue;                                                // matured → no longer pending
      }
      // still pending (alive-but-early, or dead awaiting respawn): track soonest
      // so a dead-and-overdue baby keeps us scanning until it respawns & matures
      if ((m.growAt || 0) < soonest) soonest = (m.growAt || 0);
    }
    _nextGrowAt = soonest; // Infinity when no babies remain → cheap early-returns
  }

  // ---- perform a tier action ----
  // Returns true if a tend actually happened, false if it was blocked (spent,
  // level/tool/pail short) — tickHusb uses this to stop the continuous tending.
  function husbDoAction(mon, actId) {
    const acts = husbActions(mon); if (!acts) return false;
    const a = acts.find(x => x.id === actId) || acts[0]; if (!a) return false;
    if (mon.husbSpent) { log(`The ${aniName(mon).toLowerCase()} is resting — feed it first.`, "warn"); return false; }
    if (skillLvl("Husbandry") < a.req) { log(`You need Husbandry level ${a.req} for "${a.name}".`, "warn"); return false; }
    const tool = a.type === "shear" ? "shears" : null;
    if (tool && typeof hasTool === "function" && !hasTool(tool)) { log(`You need ${(ITEMS[tool] ? ITEMS[tool].name.toLowerCase() : tool)} to shear. Forge some with Toolmaking or buy them from the general store.`, "warn"); return false; }
    const g = a.giant;
    if (a.type === "raise") {
      const target = (g && MONSTERS[a.out.baby + "_v_baby"]) ? a.out.baby + "_v" : a.out.baby;
      const babyNm = spawnBaby(mon, target) || "young";
      log(`You raise the ${aniName(mon).toLowerCase()} — a ${babyNm.toLowerCase()} is born!`);
      // litters: sometimes a second young is weaned into your pack — livestock
      // you can sell on (farm-market demand good, see BABY_ITEMS above)
      const YOUNG_ITEM = { rabbit: "kit", pig: "piglet", turkey: "poult", goat: "kid",
        sheep: "lamb", camel: "camel_calf", cow: "calf", aurochs: "aurochs_calf", buffalo: "calf" };
      const yi = YOUNG_ITEM[a.out.baby];
      if (yi && ITEMS[yi] && Math.random() < 0.35) {
        addItem(yi, 1);
        log(`The litter runs to two — you take a weaned ${ITEMS[yi].name.toLowerCase()} for market.`);
      }
    } else {
      const outs = Object.entries(a.out);
      const mult = g ? 2 : 1;             // giants yield twice the ordinary item
      const milkNeed = (a.out.milk || 0) * mult; // one empty pail per unit of milk
      if (milkNeed > 0) {
        if (countItem("pail") < milkNeed) { log(`You need ${milkNeed} empty pail${milkNeed > 1 ? "s" : ""} to milk the ${aniName(mon).toLowerCase()}. Buy them from the general store, or curdle milk at a creamery to empty them.`, "warn"); return false; }
        removeItem("pail", milkNeed);
      }
      for (const [id, q] of outs) { addItem(id, q * mult); if (typeof Tutorial !== "undefined" && Tutorial.onTend) Tutorial.onTend(id, q * mult); }
      if (a.babyChance && Math.random() < a.babyChance[1]) {
        const bt = (g && MONSTERS[a.babyChance[0] + "_v_baby"]) ? a.babyChance[0] + "_v" : a.babyChance[0];
        spawnBaby(mon, bt);
      }
      log(harvestMsg(a, mon));
    }
    addXp("Husbandry", a.xp * (g ? 2 : 1));
    const key = (mon.sx ?? mon.x) + "," + (mon.sy ?? mon.y);
    // Batch model (user request 2026-09-15, mirrors wild gather nodes): a resource
    // animal gives 5-10 tends before it's spent, then a proportionally longer
    // recovery. "Raise" tiers birth young (not a resource batch) and stay single-
    // tend. Applies everywhere, tutorial included. Each tend's yield is unchanged
    // — milking still costs one pail per tend, no pail blowup.
    const charged = a.type !== "raise";
    if (charged) {
      if (mon.husbLeft == null) mon.husbMax = mon.husbLeft = 5 + Math.floor(Math.random() * 6); // 5-10 tends
      mon.husbLeft -= 1;
      if (mon.husbLeft > 0) {
        // still tendable — persist the batch progress (keyed by spawn tile, so a
        // reload can't reset the counter to dodge the recovery) and stay ready.
        if (typeof husbCooldowns !== "undefined")
          husbCooldowns.set(key, { spent: false, left: mon.husbLeft, leftMax: mon.husbMax });
        if (typeof uiDirty !== "undefined") uiDirty = true;
        return true;
      }
    }
    const cycle = charged ? (mon.husbMax || 1) : 1;   // recovery scales with the batch it gave
    mon.husbLeft = null; mon.husbMax = null;           // a fresh feed re-rolls the batch
    mon.husbSpent = true;
    // recovery is the standard tiered respawn time (data.js respawnFor), stretched
    // by the batch size: low-tier animals bounce back fast, high-tier ones slow.
    mon.husbReadyAt = now + (typeof respawnFor === "function" ? respawnFor(a.req) : COOLDOWN) * cycle;
    mon.husbFeed = scaleFeed(a.feed, g);
    mon.husbSpr = (a.type === "raise") ? null : (SPENT_SPR[baseKind(mon.kind)] || null);
    // persist the cooldown keyed by the animal's spawn tile so a refresh can't
    // reset it (the animal respawns spent, restored in world.js) — no cheating recovery.
    if (typeof husbCooldowns !== "undefined")
      husbCooldowns.set(key, { readyAt: mon.husbReadyAt, spent: true, feed: mon.husbFeed, spr: mon.husbSpr });
    if (typeof uiDirty !== "undefined") uiDirty = true;
    return true;
  }
  // Continuous tending (user request 2026-09-15): once you start tending an
  // animal you keep tending it, one tend per HUSB_TICK, until it's DEPLETED
  // (husbSpent) — the same feel as felling a tree or harvesting a crop. Stops on
  // a blocked tend (husbDoAction → false: no shears/pails/level), if the animal
  // dies, or if it wanders out of reach. Started from pathing.js executeGoal.
  const HUSB_TICK = 1400; // ms per tend
  function tickHusb(act) {
    const mon = act.mon;
    if (!mon || !mon.alive || mon.husbSpent) { player.act = null; return; }
    if (Math.max(Math.abs(mon.x - player.x), Math.abs(mon.y - player.y)) > 4) { player.act = null; return; } // wandered off
    const did = husbDoAction(mon, act.actId);
    if (!did || !mon.alive || mon.husbSpent) { player.act = null; return; }
    act.nextAt = now + HUSB_TICK;
  }
  function harvestMsg(a, mon) {
    const nm = aniName(mon).toLowerCase();
    if (a.type === "shear") return `You shear the ${nm} — a fine fleece.`;
    if (a.type === "milk") return `You milk the ${nm}.`;
    if (a.type === "apiary") return `You gather honey and wax from the ${nm}.`;
    if (a.type === "pluck") return `You carefully pluck feathers from the ${nm}.`;
    return `You collect from the ${nm}.`;
  }

  // ---- feed a spent animal (only after the 300s cooldown) ----
  function husbDoFeed(mon) {
    if (!husbActions(mon)) return;
    if (!mon.husbSpent) { log(`The ${aniName(mon).toLowerCase()} doesn't need feeding right now.`, "warn"); return; }
    if (now < (mon.husbReadyAt || 0)) { log(`The ${aniName(mon).toLowerCase()} is still recovering — ${secsLeft(mon)}s left.`, "warn"); return; }
    const feed = mon.husbFeed || {};
    for (const [id, q] of Object.entries(feed)) if (countItem(id) < q) { log(`You need ${feedStr(feed)} to feed the ${aniName(mon).toLowerCase()}.`, "warn"); return; }
    for (const [id, q] of Object.entries(feed)) removeItem(id, q);
    mon.husbSpent = false; mon.husbSpr = null; mon.husbReadyAt = 0;
    if (typeof husbCooldowns !== "undefined") husbCooldowns.delete((mon.sx ?? mon.x) + "," + (mon.sy ?? mon.y));
    log(`You feed the ${aniName(mon).toLowerCase()}; it's ready to tend again.`);
    if (typeof uiDirty !== "undefined") uiDirty = true;
  }

  // ---- menu the UI shows for an animal (first entry = left-click primary) ----
  function husbMenu(mon) {
    const acts = husbActions(mon); if (!acts) return [];
    const nm = aniName(mon);
    if (mon.husbSpent) {
      const ready = now >= (mon.husbReadyAt || 0);
      return [{ id: "__feed", label: ready ? `Feed ${nm}` : `${nm} — recovering (${secsLeft(mon)}s)` }];
    }
    const lvl = skillLvl("Husbandry");
    const un = acts.filter(a => lvl >= a.req).sort((x, y) => y.req - x.req);
    if (!un.length) {
      const need = Math.min(...acts.map(a => a.req));
      return [{ id: "__locked", label: `${nm} — needs Husbandry ${need}` }];
    }
    return un.map(a => ({ id: a.id, label: a.name + (a.giant ? " (giant)" : "") }));
  }

  // ---- globals ----
  const LIVESTOCK_SPAWN = ["chicken", "sheep", "cow", "quail", "duck", "goat", "rabbit", "pig", "goose", "turkey", "buffalo", "alpaca", "bee", "camel"];
  const EXOTIC_SPAWN = ["griffon", "aurochs", "wyrmling"];
  if (typeof window !== "undefined") {
    window.HUSB_ACTIONS = ACTIONS;
    window.LIVESTOCK_SPAWN = LIVESTOCK_SPAWN;
    window.EXOTIC_SPAWN = EXOTIC_SPAWN;
    window.isLivestock = mon => !!husbActions(mon);
    window.husbActions = husbActions;
    window.husbMenu = husbMenu;
    window.husbDoAction = husbDoAction;
    window.tickHusb = tickHusb;
    window.husbDoFeed = husbDoFeed;
    window.growBabies = growBabies;
    window.husbSpriteKey = mon => (mon && mon.husbSpent && mon.husbSpr) ? mon.husbSpr : null;
    window.husbLabel = mon => { const m = husbMenu(mon); return m.length ? m[0].label : ""; };
    window.husbExamine = mon => {
      if (!husbActions(mon)) return null;
      const nm = aniName(mon);
      if (mon.husbSpent) return now >= (mon.husbReadyAt || 0) ? `The ${nm.toLowerCase()} is spent — feed it to tend again.` : `The ${nm.toLowerCase()} is recovering (${secsLeft(mon)}s).`;
      return `A ${nm.toLowerCase()}. Ready to tend${mon.husbLeft > 0 ? ` (${mon.husbLeft} more before it needs rest)` : ""}.`;
    };
    // back-compat: old goal types still resolve
    window.husbGoalType = mon => (mon && mon.husbSpent) ? "husbFeed" : "husbAction";
    window.husbHarvest = mon => { const m = husbMenu(mon); husbDoAction(mon, m.length ? m[0].id : null); };
    window.husbFeed = husbDoFeed;
  }
})();
