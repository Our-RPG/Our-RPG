// ===== Taiao — markets, NPC demand & contracts =====
// Turns the deep production graph into a living economy. Every settlement has an
// economic PROFILE derived from its biome (port / farm / mine / forest / city);
// each profile DEMANDS some kinds of goods (paying a premium to buy them from
// you) and has a SURPLUS of others (selling those cheaply). NPC traders also
// post CONTRACTS — "deliver 20 barrels", "the port needs 40 rope" — that pay
// coins and REPUTATION, which in turn lifts the prices you're offered.
//
// Goods are tagged by the trade that makes them, so a barrel reads as "cordage/
// wood", a cheese as "food", a crown as "luxury". Loaded after leathercraft.js
// (needs every recipe defined to tag items and stock contracts).
"use strict";

// ---------- item tagging (by producing trade) ----------
const MARKET_SKILL_TAG = {
  Shipwrighting: "ship", Sailmaking: "ship", Ropemaking: "cordage",
  Jewelry: "luxury", Assaying: "luxury", "Wire-drawing": "metal",
  Toolmaking: "tool", Locksmithing: "craft", Papermaking: "craft", Bookbinding: "luxury",
  Candlemaking: "craft", Soapmaking: "craft",
  Weaponsmithing: "metal", Armoursmithing: "metal", Smelting: "metal", Milling: "food", Malting: "food",
  Brewing: "drink", Baking: "food", Cooking: "food", Cheesemaking: "food",
  Husbandry: "food", Farming: "food",
  Spinning: "textile", Dyeing: "textile", Weaving: "textile", Fulling: "textile", Tailoring: "textile",
  Leatherworking: "leather", Cordwaining: "leather", Saddlery: "leather", Tanning: "leather",
  Sawing: "wood", Seasoning: "wood", Coopering: "cordage", Carpentry: "wood", Fletching: "arms",
  Charcoaling: "fuel", Limeburning: "stone", Masonry: "stone",
  Pottery: "pottery", Glassblowing: "glass",
  Potionmaking: "potion", Runecrafting: "arcane", Alchemy: "arcane", Crafting: "craft",
};
const MARKET_CAT_TAG = { "Food & Drink": "food", Woodworking: "wood", Metalworking: "metal",
  "Textiles & Leather": "textile", "Stone & Earth": "stone", "Crafts & Arcana": "craft",
  Combat: "arms", Gathering: "raw", Utility: "misc" };

let _makerSkill = null, _tagItems = null;
function marketMakerSkill(id) {
  if (!_makerSkill) {
    _makerSkill = {};
    for (const cat in RECIPES) for (const r of RECIPES[cat]) {
      const outs = typeof recipeOutputs === "function" ? recipeOutputs(r) : [{ id: r.out }];
      for (const o of outs) if (o.id && !_makerSkill[o.id]) _makerSkill[o.id] = r.skill;
    }
  }
  return _makerSkill[id];
}
// Pseudo equip-tags that aren't real slot names and aren't armour either —
// EQUIP_CHOICES jewelry (ring/bracelet/anklet — state.js), plus the
// stack-slot tags (quiver/rune) and weapon/neck, all with their own
// dedicated shop logic elsewhere.
const NON_ARMOR_EQUIP_TAGS = new Set(["weapon", "neck", "quiver", "rune", "ring", "bracelet", "anklet"]);
// True for any wearable body-armour/shield piece — single-slot ("torso",
// "shield") or multi-slot (a chestplate's array of anatomical slots) — but
// not the tags above. Replaces an old hardcoded
// ["armor","helm","chest","legs","boots","shield"] allowlist that assumed
// equip was always one of those 6 literal strings; the 30-slot anatomical
// redesign made that list both incomplete (dozens of new slot names) and
// wrong for multi-slot items (equip is an array there).
function isBodyArmor(equipVal) {
  return !!equipVal && !NON_ARMOR_EQUIP_TAGS.has(equipVal);
}
function itemTag(id) {
  const d = ITEMS[id];
  if (!d) return "misc";
  if (d.tool) return "tool";
  if (d.potion) return "potion";
  if (d.equip === "weapon" || d.equip === "shield") return "arms";
  if (d.boat) return "ship";
  const sk = marketMakerSkill(id);
  if (sk) return MARKET_SKILL_TAG[sk] || MARKET_CAT_TAG[typeof SKILL_CATEGORY !== "undefined" ? SKILL_CATEGORY[sk] : ""] || "misc";
  return "raw"; // gathered / bought raw materials
}
// representative producible goods per tag (for contracts)
function tagItems(tag) {
  if (!_tagItems) {
    _tagItems = {};
    for (const cat in RECIPES) for (const r of RECIPES[cat]) {
      const out = (r.outputs && r.outputs[0] && r.outputs[0].id) || r.out;
      if (!out || !ITEMS[out]) continue;
      const t = itemTag(out);
      (_tagItems[t] || (_tagItems[t] = [])).push({ id: out, value: ITEMS[out].value || 1 });
    }
    for (const t in _tagItems) { // dedupe, sort by value
      const seen = new Set();
      _tagItems[t] = _tagItems[t].filter(x => (seen.has(x.id) ? false : seen.add(x.id))).sort((a, b) => a.value - b.value);
    }
  }
  return _tagItems[tag] || [];
}

// ---------- town economic profiles ----------
// demand: tag → sell-price multiplier (>1 the town pays a premium for it).
// surplusTags: kinds it produces and stocks cheaply. stock: extra ids on sale.
const MARKET_PROFILES = {
  port:   { label: "Port", demand: { ship: 1.7, cordage: 1.6, textile: 1.35, food: 1.3, wood: 1.25, stone: 1.2, leather: 1.2 },
            surplusTags: ["food", "raw"], stock: ["raw_fish", "rope", "sail"] },
  farm:   { label: "Farming town", demand: { tool: 1.5, metal: 1.4, textile: 1.3, pottery: 1.3, glass: 1.25, luxury: 1.5, leather: 1.3 },
            surplusTags: ["food", "raw"], stock: ["wheat", "flour", "flatbread", "wool_yarn", "fleece"] },
  mine:   { label: "Mining town", demand: { food: 1.6, wood: 1.4, tool: 1.3, textile: 1.25, leather: 1.3, drink: 1.4 },
            surplusTags: ["metal", "stone", "raw"], stock: ["iron_bar", "charcoal", "building_stone", "limestone", "copper_ore"] },
  forest: { label: "Forest settlement", demand: { food: 1.4, metal: 1.45, tool: 1.35, pottery: 1.25, drink: 1.3 },
            surplusTags: ["wood", "fuel"], stock: ["logs", "planks", "charcoal", "boards"] },
  city:   { label: "City market", demand: { luxury: 1.7, glass: 1.35, pottery: 1.3, arms: 1.4, food: 1.2, textile: 1.2, leather: 1.25, ship: 1.2 },
            surplusTags: ["metal", "textile", "craft"], stock: ["cloth", "iron_bar", "candle", "vial"] },
};
// biome → profile key (uses the global B biome-id table)
function marketProfileForBiome(biome) {
  const b = typeof B !== "undefined" ? B : {};
  if ([b.SAND, b.REEF, b.OASIS, b.SALT].includes(biome)) return MARKET_PROFILES.port;
  if ([b.FARM, b.MEADOW, b.SAVANNA, b.STEPPE].includes(biome)) return MARKET_PROFILES.farm;
  if ([b.ROCK, b.ROCKY, b.SNOW, b.BADLANDS, b.CANYON, b.VOLCANO, b.TUNDRA, b.GLACIER].includes(biome)) return MARKET_PROFILES.mine;
  if ([b.FOREST, b.JUNGLE, b.TAIGA, b.SWAMP, b.WETLAND, b.BAMBOO, b.CHERRY].includes(biome)) return MARKET_PROFILES.forest;
  return MARKET_PROFILES.city;
}

// ---------- prices ----------
function reputation() { return (player.reputation | 0); }
// ---------- reputation tiers ----------
// Reputation used to be a self-referential number (a capped sell-price mult
// and nothing else). Tiers give it teeth: a standing title on the trade
// window, buy-price discounts, extra contract slots, and a higher sell-mult
// ceiling at the top. Crossing a threshold announces itself (addRep).
const REP_TIERS = [
  { at: 0,     title: "Stranger",            buyDisc: 0,    slots: 0, sellCap: 0.5 },
  { at: 150,   title: "Known face",          buyDisc: 0.03, slots: 0, sellCap: 0.5 },
  { at: 500,   title: "Trusted trader",      buyDisc: 0.06, slots: 1, sellCap: 0.5 },
  { at: 1500,  title: "Guild friend",        buyDisc: 0.10, slots: 2, sellCap: 0.6 },
  { at: 4000,  title: "Town patron",         buyDisc: 0.14, slots: 2, sellCap: 0.7 },
  { at: 10000, title: "Pillar of the realm", buyDisc: 0.18, slots: 3, sellCap: 0.8 },
];
function repTier() {
  const r = reputation();
  let t = REP_TIERS[0];
  for (const tier of REP_TIERS) if (r >= tier.at) t = tier;
  return t;
}
// every rep gain funnels through here so tier crossings get announced
function addRep(n) {
  const before = repTier();
  player.reputation = reputation() + n;
  const after = repTier();
  if (after !== before && after.at > before.at) {
    log(`Word of you spreads — the towns now know you as a ${after.title}.`, "gold");
    if (after.buyDisc > before.buyDisc) log(`Merchants shave ${Math.round(after.buyDisc * 100)}% off their prices for you.`, "sys");
    if (after.slots > before.slots) log(`Notice boards post more contracts for someone of your standing.`, "sys");
    if (typeof sfx === "function") sfx("quest", 0.6);
  }
}
function repMult() { return 1 + Math.min(repTier().sellCap, reputation() * 0.0008); }
function demandMult(profile, id) { return profile.demand[itemTag(id)] || 0.85; }
// ---- the living till (docs/shopkeeper-economy.md) ----
// Every quote flows through the shared EconCore engine over this town's
// synced state (shelf qty, demand beliefs, till cash — js/net/shopsync.js).
// Logged out or DEV the state is neutral and EconCore reproduces the legacy
// prices exactly: pays = value×0.5×demand, charges = value×(0.9|1.15).
function econViewFor(profile, id, stocked) {
  const town = activeMarket ? activeMarket.townKey : null;
  const synced = typeof ShopSync !== "undefined" && town;
  const f = synced ? ShopSync.flow(town, id) : null;
  // active supply shock for this item's tag (Phase 3): shrinks/gluts the
  // standing shelf and heats/cools believed demand — pricing emerges
  const mod = synced ? ShopSync.mods(town)[itemTag(id)] : null;
  return {
    value: ITEMS[id].value || 1,
    demandMult: demandMult(profile, id),
    surplusMult: (profile.surplusTags.includes(itemTag(id)) || (profile.stock || []).includes(id)) ? 0.9 : 1.15,
    stocked: stocked !== undefined ? stocked
      : !!(activeMarket && activeMarket.stockSet && activeMarket.stockSet.has(id)),
    playerQty: synced ? ShopSync.qty(town, id) : 0,
    emaOut: f ? f.out : 0,
    base: town ? EconCore.baselineDemand(town, id) : 1,
    floorMult: mod ? mod.floor : 1,
    baseMult: mod ? mod.demand : 1,
  };
}
function econTill() {
  return (typeof ShopSync !== "undefined" && activeMarket) ? ShopSync.till(activeMarket.townKey) : null;
}
// the town trader's hash-derived temperament (Phase 2) — bends only the
// dynamic parameters, so neutral prices stay exactly legacy
function econParams() {
  if (!activeMarket) return null;
  return activeMarket.params || (activeMarket.params = EconCore.shopParams(activeMarket.townKey));
}
// what the town pays you (per-player quality/rep/specialist factors ride on
// the shared quote; `lot` walks the bulk curve — the shelf fills and the
// till drains every 5 units, so dumping taper is priced before you commit).
// The charges×0.9 guard on quality-less goods kills sell-buy-back loops.
function marketSellQuote(profile, id, q, premium) {
  const mult = (q != null ? 0.6 + 0.8 * (q / 100) : 1) * (premium || 1) * repMult();
  const view = econViewFor(profile, id);
  const till = econTill();   // null until the town has synced (or offline/DEV)
  const params = econParams();
  const first = EconCore.quote(view, till, params);
  const maxUnit = q == null ? Math.max(1, Math.round(first.charges * 0.9)) : Infinity;
  const unit = Math.min(maxUnit, Math.max(1, Math.round(first.pays * mult)));
  return {
    // the taper/refusal economics only bite on a live shared market — with
    // no synced ledger there is nothing to saturate, so offline sells stay
    // flat-priced exactly like the legacy game
    refused: till ? first.refused || (first.pays < 1 && first.liquidity > 0.2) : false,
    broke: till ? !first.refused && first.pays < 1 && first.liquidity <= 0.2 : false,
    liquidity: first.liquidity,
    need: first.stockNeed,
    tapered: !!till,
    unit,
    lot: n => till
      ? EconCore.quoteSellLot(view, till, n, mult, maxUnit, params)
      : { accepted: n, paid: unit * n, unitFirst: unit, refused: false, tillShort: false },
  };
}
function marketSellPrice(profile, id, q) { return marketSellQuote(profile, id, q).unit; }
// One market-mood line per visit, once the shared state has arrived: the
// keeper names their hottest shortage, or their till state — the economy
// explaining itself in character (docs/shopkeeper-economy.md §11).
const SHOCK_TAG_WORDS = { metal: "metalwork", stone: "stone", food: "food", raw: "raw goods",
  wood: "timber", fuel: "fuel", textile: "cloth", tool: "tools", potion: "draughts" };
const SHOCK_LINES = {
  caravan_cut: w => `The caravans aren't getting through — ${w} is scarce until the roads clear.`,
  mine_trouble: w => `Trouble at the diggings — ${w} is dear while it lasts.`,
  blight: w => `A blight's been through the fields — ${w} is short everywhere.`,
  bumper: w => `A bumper season! ${w.charAt(0).toUpperCase() + w.slice(1)} is piled high and going cheap.`,
  surplus_barge: w => `A surplus barge came in — ${w} is going for a song.`,
};
function marketMoodLine(profile, shopkeeper) {
  if (!activeMarket || activeMarket.moodDone) return;
  const till = econTill();
  if (!till) return;
  activeMarket.moodDone = true;
  const params = econParams();
  // an active supply shock is the biggest news in town — speak it first
  const mods = typeof ShopSync !== "undefined" ? ShopSync.mods(activeMarket.townKey) : {};
  for (const [tag, m] of Object.entries(mods)) {
    const line = SHOCK_LINES[m.kind];
    if (line) { log(`${shopkeeper}: ${line(SHOCK_TAG_WORDS[tag] || tag)}`, "sys"); return; }
  }
  const res = EconCore.reserveOf(till.operating, params.reserveRatio);
  const liq = EconCore.clamp((till.cash - res) / Math.max(1, till.operating - res), 0.15, 1.25);
  let best = null;
  for (const id of activeMarket.stockSet) {
    const q = EconCore.quote(econViewFor(profile, id, true), till, params);
    if (q.stockNeed >= 1.3 && (!best || q.stockNeed > best.need)) best = { id, need: q.stockNeed };
  }
  if (best) log(`${shopkeeper}: Bring me ${ITEMS[best.id].name.toLowerCase()} if you find any — I can shift those.`, "sys");
  else if (liq <= 0.25) log(`${shopkeeper}: Coin's tight this week — I'll be paying low until the shelves move.`, "sys");
  else if (liq >= 1.1) log(`${shopkeeper}: Business is good — I'm buying, if you're selling.`, "sys");
}
// what the town charges you to buy one unit (cheaper if it's a local
// surplus, dearer as the shelf runs dry or demand runs hot)
function marketBuyPrice(profile, id, stocked) {
  const sq = EconCore.quote(econViewFor(profile, id, stocked), econTill(), econParams());
  return Math.max(1, Math.round(sq.charges * (1 - repTier().buyDisc)));
}
// trend glyph vs the neutral anchor — only meaningful on a live market
function priceTrend(profile, id, price) {
  if (!econTill()) return null;
  const surplus = profile.surplusTags.includes(itemTag(id)) || (profile.stock || []).includes(id);
  const neutral = Math.max(1, Math.round((ITEMS[id].value || 1) * (surplus ? 0.9 : 1.15) * (1 - repTier().buyDisc)));
  if (price > neutral * 1.04) return { glyph: "▲", note: "prices up — shelves short or demand hot" };
  if (price < neutral * 0.96) return { glyph: "▼", note: "prices down — well stocked" };
  return null;
}
// Merchants only stock the early seed tiers; higher-level seeds must be found
// or grown up to, not bought outright.
const MERCHANT_MAX_SEED_LEVEL = 4;
let _seedReq = null;
function seedReq(id) {
  if (!_seedReq) {
    _seedReq = {};
    for (const k in CROPS) { const c = CROPS[k]; if (c.seed) _seedReq[c.seed] = c.req; }
  }
  return _seedReq[id];
}
// Merchants sell seeds, not the crops grown from them — the harvest has to be
// grown or gathered, not bought outright.
let _cropHarvestItems = null;
function isCropHarvest(id) {
  if (!_cropHarvestItems) {
    _cropHarvestItems = new Set();
    for (const k in CROPS) { const c = CROPS[k]; if (c.item) _cropHarvestItems.add(c.item); }
  }
  return _cropHarvestItems.has(id);
}
function marketStock(profile) {
  const out = [];
  const push = id => {
    if (!ITEMS[id] || out.includes(id)) return;
    const req = seedReq(id);
    if (req != null && req > MERCHANT_MAX_SEED_LEVEL) return;
    if (isCropHarvest(id)) return;
    out.push(id);
  };
  (typeof SHOP_STOCK !== "undefined" ? SHOP_STOCK : []).forEach(push);
  (profile.stock || []).forEach(push);
  return out.filter(id => ITEMS[id]); // drop any placeholder ids that don't exist
}

// ---------- contracts (deterministic per town) ----------
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); }
function townKeyOf(x, y) { return Math.round(x / 8) + "," + Math.round(y / 8); }
function townContracts(townKey, profile) {
  const wanted = Object.keys(profile.demand).sort((a, b) => profile.demand[b] - profile.demand[a]);
  const out = [];
  for (let i = 0; i < 3 + repTier().slots; i++) {
    const h = hashStr(townKey + ":" + i);
    const tag = wanted[h % Math.min(wanted.length, 4)];
    const pool = tagItems(tag);
    if (!pool.length) continue;
    // unsigned shifts: h has its top bit set for some towns, and a SIGNED
    // shift there gave a negative index (crashed the market for those towns)
    const item = pool[(h >>> 4) % pool.length];
    const qty = 4 + ((h >>> 8) % 12);
    const premium = 1.6 + ((h >>> 12) % 90) / 100; // 1.6–2.5×
    const key = townKey + ":" + i;
    if (player.contractsDone && player.contractsDone.includes(key)) continue;
    out.push({ key, itemId: item.id, qty, reward: Math.max(qty, Math.round(item.value * qty * premium)), rep: 3 + Math.round(item.value * qty / 60) });
  }
  // Phase 2, contracts-from-shortage: when the live market genuinely wants
  // something (believed demand well past the shelf), the store posts an
  // URGENT notice for it. Needs are shared state, so every player sees the
  // same notice — and filling it removes the shortage that created it.
  if (typeof EconCore !== "undefined" && activeMarket && econTill()) {
    const till = econTill(), params = econParams();
    const wantedTags = Object.keys(profile.demand).sort((a, b) => profile.demand[b] - profile.demand[a]);
    // candidates: the store's own shelf plus the town's wanted-tag pools
    const ids = new Set(activeMarket.stockSet || []);
    for (const tag of wantedTags.slice(0, 3))
      for (const it of tagItems(tag).slice(0, 20)) ids.add(it.id);
    const cands = [];
    for (const id of ids) {
      if (!ITEMS[id]) continue;
      const q = EconCore.quote(econViewFor(profile, id,
        activeMarket.stockSet ? activeMarket.stockSet.has(id) : false), till, params);
      if (q.stockNeed >= 1.3) cands.push({ id, need: q.stockNeed, value: ITEMS[id].value || 1 });
    }
    cands.sort((a, b) => b.need - a.need);
    for (const c of cands.slice(0, 2)) {
      const key = townKey + ":sh:" + c.id;
      if (player.contractsDone && player.contractsDone.includes(key)) continue;
      const qty = 4 + Math.min(16, Math.round(c.need * 4));
      const premium = 1.5 + Math.min(1, c.need - 1);
      out.push({ key, itemId: c.id, qty, urgent: true,
        reward: Math.max(qty, Math.round(c.value * qty * premium)),
        rep: 4 + Math.round(c.value * qty / 50) });
    }
  }
  return out;
}
function fulfilContract(c) {
  if (countItem(c.itemId) < c.qty) { log("You don't have the goods for that contract.", "warn"); return false; }
  removeItem(c.itemId, c.qty);
  addItem("coins", c.reward);
  addRep(c.rep);
  (player.contractsDone || (player.contractsDone = [])).push(c.key);
  log(`Contract fulfilled: ${c.qty} × ${ITEMS[c.itemId].name} for ${c.reward} coins (+${c.rep} rep).`, "gold");
  uiDirty = true;
  return true;
}

// ---------- equip requirements for crafted gear ----------
// Any equippable produced by a recipe inherits its recipe tier as its
// wield/wear requirement (tailored garments, leather gear, carpentry staves…)
// unless the item already declared one (geartiers.js stamps its own). Runs
// here because market.js loads after every recipe-defining skill file.
for (const cat in RECIPES) for (const r of RECIPES[cat]) {
  const out = (r.outputs && r.outputs[0] && r.outputs[0].id) || r.out;
  const d = out && ITEMS[out];
  if (!d || !d.equip || !r.req) continue;
  if (d.equip === "weapon") {
    if (d.bowPower) { if (d.rangeReq == null) d.rangeReq = r.req; }        // ranged: Archery
    else if (d.magicPower) { if (d.magicReq == null) d.magicReq = r.req; } // wands/staves: Magic
    else if (d.wieldReq == null) d.wieldReq = r.req;                       // melee weapon: wieldReq gates the Melee skill
  } else if (isBodyArmor(d.equip) && d.wearReq == null)
    d.wearReq = r.req;
}

// ---------- station artwork (2026-09 art drop) ----------
// Every production station gets its own world object instead of the 8
// shared generics: either a NEW single-view object (objects-data.js,
// packed from assets/objects_source/station_*) or an existing unused
// object that already depicts it. The value pair is [newSprKey,
// oldSprFallback] — the fallback is aliased under the new key so the
// renderer's flat-atlas path never lacks a sprite while textures load.
(function () {
  const ART = {
    sawmill: ["sawmill", "workbench"], cooperage: ["cooperage", "workbench"],
    malthouse: ["malthouse", "furnace"], fulling_mill: ["fulling_mill", "tanrack"],
    masons_yard: ["masons_yard", "anvil"], assay_furnace: ["assay_furnace", "furnace"],
    drawbench: ["drawbench", "anvil"], leather_bench: ["leather_bench", "workbench"],
    cobblers_bench: ["cobblers_bench", "workbench"], saddlers_bench: ["saddlers_bench", "workbench"],
    toolsmith: ["toolsmith", "anvil"], locksmith_bench: ["locksmith_bench", "anvil"],
    paper_mill: ["paper_mill", "mill"], bindery: ["bindery", "workbench"],
    soap_works: ["soap_works", "cauldron"], seasoning_yard: ["seasoning_yard", "tanrack"],
    charcoal_clamp: ["charcoal_clamp", "campfire"], lime_kiln: ["lime_kiln", "furnace"],
    ropewalk: ["ropewalk", "workbench"], shipyard: ["shipyard", "workbench"],
    barn: ["barn", "crate"], creamery: ["creamery", "cauldron"],
    tailors_bench: ["tailors_bench", "workbench"], altar: ["altar_rune", "altar"],
    // repoints to objects that already existed unused in the pack
    bakehouse: ["bread_oven", "campfire"], brewery: ["brewery_tun", "cauldron"],
    spinning_wheel: ["spinning_wheel", "loom"], dyeworks: ["dye_vat", "cauldron"],
    pottery_kiln: ["kiln", "furnace"], jewelers_bench: ["jewelrytable", "workbench"],
    sail_loft: ["sailmaker_spindle", "loom"], chandlery: ["chandler_set", "workbench"],
  };
  for (const type in ART) {
    if (!STATIONS[type]) continue;
    const [key, fb] = ART[type];
    STATIONS[type].spr = key;
    if (typeof SPR !== "undefined" && !SPR[key] && SPR[fb]) SPR[key] = SPR[fb];
  }
})();

// ---------- shop types ----------
// Specialty shopkeepers (assigned per building by world/chunks.js
// deriveNpcs). Each type SELLS a themed stock list and only BUYS what its
// trade deals in — the general store buys a broad range of everyday goods
// but turns everything exotic away; specialists pay a 20% premium for the
// goods they want. `sells` is a lazy builder so tiered items defined by
// later-loading skill files are picked up.
// even value-spread sample: sort by coin value (value tracks tier/level) and
// pick n items spanning cheapest → most expensive, so a specialist's shelf
// covers the whole 1-32 progression instead of just the starter tiers
function shopSample(ids, n) {
  ids = [...new Set(ids.filter(id => ITEMS[id]))]
    .sort((a, b) => (ITEMS[a].value || 0) - (ITEMS[b].value || 0));
  if (ids.length <= n) return ids;
  const out = [];
  for (let i = 0; i < n; i++)
    out.push(ids[Math.min(ids.length - 1, Math.round(i * (ids.length - 1) / (n - 1)))]);
  return [...new Set(out)];
}
const _idsByTag = {};
function idsByTag(tag) {
  if (!_idsByTag[tag]) _idsByTag[tag] = Object.keys(ITEMS).filter(id => itemTag(id) === tag);
  return _idsByTag[tag];
}
const SHOP_TYPES = {
  general: {
    name: "General store", line: `"Welcome! Buy tools, sell me your goods."`,
    sells: null, // the town-market stock (profile surplus + basics + contracts)
    buys: (id, d) => !!(d.tool || d.heals || ["raw", "wood", "food", "drink", "fuel"].includes(itemTag(id))),
  },
  woodcutter: {
    name: "Woodcutter's shop", line: `"Finest axes for miles. I pay well for good timber."`,
    sells: () => shopSample(Object.keys(ITEMS).filter(id => ITEMS[id].tool === "axe"), 17),
    buys: (id, d) => d.tool === "axe" || !!d.log || itemTag(id) === "wood",
  },
  mining: {
    name: "Mining supplies", line: `"Picks, and coin for whatever you dig up."`,
    sells: () => shopSample(Object.keys(ITEMS).filter(id => ITEMS[id].tool === "pickaxe"), 17),
    buys: (id, d) => d.tool === "pickaxe" || (typeof bankCat === "function" && bankCat(id) === "ores"),
  },
  fishmonger: {
    name: "Fishmonger", line: `"Fresh off the boats! Rods and nets too."`,
    sells: () => Object.keys(ITEMS).filter(id => ["rod", "net", "big_net", "harpoon", "cage"].includes(ITEMS[id].tool)),
    buys: (id, d) => ["rod", "net", "big_net", "harpoon", "cage"].includes(d.tool) || /^raw_/.test(id) || /fish/.test(id),
  },
  armoury: {
    name: "Armoury", line: `"Steel between you and the wilds. Buying and selling."`,
    sells: () => shopSample(Object.keys(ITEMS).filter(id => isBodyArmor(ITEMS[id].equip)), 16),
    buys: (id, d) => isBodyArmor(d.equip),
  },
  weaponsmith: {
    name: "Weaponsmith", line: `"Sharp edges, fair prices."`,
    sells: () => shopSample(Object.keys(ITEMS).filter(id => ITEMS[id].equip === "weapon"), 15)
      .concat(ITEMS.arrow_iron ? ["arrow_iron"] : []),
    buys: (id, d) => d.equip === "weapon" || !!d.arrowPower || id === "arrows" || id === "arrow_shafts",
  },
  seedsman: {
    name: "Seed merchant", line: `"Everything grows from something. Buying produce too."`,
    // the SPECIALIST carries the whole seed ladder, level 1 right up to 32
    // (the general store's market stock keeps its low-tier-seeds-only gate)
    sells: () => shopSample(Object.values(CROPS).filter(c => c.seed && ITEMS[c.seed]).map(c => c.seed), 16),
    buys: (id, d) => (typeof bankCat === "function" && bankCat(id) === "seeds") || isCropHarvest(id),
  },
  herbalist: {
    name: "Herbalist", line: `"Herbs, tinctures and vials. Bring me what you forage."`,
    sells: () => ["vial"].filter(id => ITEMS[id])
      .concat(shopSample(Object.keys(ITEMS).filter(id => ITEMS[id].potion), 12)),
    buys: (id, d) => !!d.potion || id === "vial" || /^herb/.test(id),
  },
  jeweller: {
    name: "Jeweller", line: `"Gold, gems and fine things. I know worth when I see it."`,
    sells: () => ["gem"].filter(id => ITEMS[id]).concat(shopSample(idsByTag("luxury"), 12)),
    buys: (id, d) => itemTag(id) === "luxury" || id === "gem" || /gem|ring|amulet|necklace|bracelet|pendant|crown|tiara|diadem|circlet/.test(id),
  },
  clothier: {
    name: "Clothier", line: `"Cloth, thread and leathers — spun, woven or tanned."`,
    sells: () => shopSample(["cloth", "cotton", "leather", "robe"]
      .concat(idsByTag("textile"), idsByTag("leather")), 14),
    buys: (id, d) => ["textile", "leather"].includes(itemTag(id)) || ["cloth", "cotton", "leather", "hide"].includes(id),
  },
  provisioner: {
    name: "Provisioner", line: `"Hot bread, cured meat — and I'll buy your surplus."`,
    sells: () => shopSample(Object.keys(ITEMS).filter(id => ITEMS[id].heals), 14),
    buys: (id, d) => !!d.heals || ["food", "drink"].includes(itemTag(id)),
  },
  timberwright: {
    name: "Timber yard", line: `"Boards, beams and seasoned stock — buying and selling."`,
    sells: () => shopSample(["logs", "planks", "boards", "beam"]
      .concat(Object.keys(ITEMS).filter(id => ITEMS[id].log), idsByTag("wood")), 16),
    buys: (id, d) => !!d.log || itemTag(id) === "wood",
  },
};
const SHOP_TYPE_KEYS = Object.keys(SHOP_TYPES).filter(k => k !== "general");
// lazy stock cache (some sells-lists scan all ITEMS)
const _shopStock = {};
function shopStockFor(typeKey) {
  if (!_shopStock[typeKey]) {
    const t = SHOP_TYPES[typeKey];
    _shopStock[typeKey] = (typeof t.sells === "function" ? t.sells() : t.sells || [])
      .filter(id => ITEMS[id]).slice(0, 20);
  }
  return _shopStock[typeKey];
}

// ---------- UI ----------
let activeMarket = null;
function openMarket(npc) {
  const biome = (typeof world !== "undefined" && world.biomeAt) ? world.biomeAt(npc.x, npc.y) : -1;
  const profile = marketProfileForBiome(biome);
  const typeKey = SHOP_TYPES[npc.shopType] ? npc.shopType : "general";
  activeMarket = { profile, npc, townKey: townKeyOf(npc.x, npc.y), typeKey };
  // Phase 2: pull this town's player-stocked shelf (async; repaints on arrival)
  if (typeof ShopSync !== "undefined") ShopSync.ensureStock(activeMarket.townKey);
  const t = SHOP_TYPES[typeKey];
  log(`${npc.name}: ${npc.line || t.line}`, "sys");
  openTrade("shop", t.name, npc.x, npc.y);
  renderMarket();
}
function renderMarket() {
  if (!activeMarket) return;
  const { profile, townKey, typeKey } = activeMarket;
  const type = SHOP_TYPES[typeKey];
  const general = typeKey === "general";
  document.getElementById("trade-title").textContent = general
    ? `${profile.label} — trade & contracts (Rep ${reputation()} · ${repTier().title})`
    : `${type.name} (Rep ${reputation()} · ${repTier().title})`;
  // BUY
  const grid = document.getElementById("shopgrid");
  grid.innerHTML = "";
  const buyNote = (id, got, price) => {   // Phase-2 ledger: purchases decrement player stock
    if (got && typeof ShopSync !== "undefined") ShopSync.noteBuy(townKey, id, got, got * price);
  };
  const baseIds = general ? marketStock(profile) : shopStockFor(typeKey);
  activeMarket.stockSet = new Set(baseIds);   // standing-floor flag for quotes
  const shopkeeper = (activeMarket.npc && activeMarket.npc.name) || type.name;
  marketMoodLine(profile, shopkeeper);
  for (const id of baseIds) {
    const def = ITEMS[id], price = marketBuyPrice(profile, id, true);
    const reqNote = def.wieldReq ? ` (Melee ${def.wieldReq})`
      : def.wearReq ? ` (Defence ${def.wearReq})`
      : def.rangeReq ? ` (Archery ${def.rangeReq})` : "";
    // player-stocked units of a staple ride on top of the standing floor
    const ps = typeof ShopSync !== "undefined" ? ShopSync.qty(townKey, id) : 0;
    const psNote = ps ? ` — ${ps} restocked by players` : "";
    const tr = priceTrend(profile, id, price);
    const d = slotEl(def.icon, undefined, `${def.name}${reqNote} — ${price} coins${tr ? ` (${tr.note})` : ""}${psNote}`);
    const pr = document.createElement("span"); pr.className = "price"; pr.textContent = (tr ? tr.glyph : "") + price; d.appendChild(pr);
    d.onclick = e => { buyNote(id, tradeBuy(id, price, e.shiftKey ? 5 : 1), price); renderMarket(); };
    d.oncontextmenu = e => amountMenu(e, "Buy", "max", n => { buyNote(id, tradeBuy(id, price, n), price); renderMarket(); });
    grid.appendChild(d);
  }
  // Phase 2, the no-trading economy on the shelf: goods OTHER PLAYERS sold
  // here, beyond the computed base stock, buyable while they last — with the
  // maker's name attached. Only what this shop would deal in appears.
  if (typeof ShopSync !== "undefined") {
    const listed = new Set(baseIds);
    for (const [id, info] of Object.entries(ShopSync.items(townKey))) {
      const def = ITEMS[id];
      if (listed.has(id) || !def || !(info.qty > 0) || !type.buys(id, def)) continue;
      const price = marketBuyPrice(profile, id, false);
      const makers = (info.units || []).map(u => u.maker).filter(Boolean);
      const by = makers.length ? `stocked by ${makers[0]}${makers.length > 1 ? " and others" : ""}` : "player-stocked";
      const tr = priceTrend(profile, id, price);
      const d = slotEl(def.icon, info.qty, `${def.name} — ${price} coins${tr ? ` (${tr.note})` : ""} — ${by}, ${info.qty} left`);
      const pr = document.createElement("span"); pr.className = "price demand"; pr.textContent = (tr ? tr.glyph : "") + price; d.appendChild(pr);
      const buyLtd = n => { buyNote(id, tradeBuy(id, price, Math.min(n, info.qty)), price); renderMarket(); };
      d.onclick = e => buyLtd(e.shiftKey ? 5 : 1);
      d.oncontextmenu = e => amountMenu(e, "Buy", "max", buyLtd);
      grid.appendChild(d);
    }
  }
  // CONTRACTS — only the general store posts town contracts
  let cbox = document.getElementById("contractlist");
  if (!cbox) { cbox = document.createElement("div"); cbox.id = "contractlist"; grid.parentNode.insertBefore(cbox, document.getElementById("sellhdr")); }
  cbox.innerHTML = "";
  if (general) {
    const contracts = townContracts(townKey, profile);
    if (contracts.length) {
      const h = document.createElement("div"); h.className = "contracthdr"; h.textContent = "Contracts wanted here:"; cbox.appendChild(h);
      for (const c of contracts) {
        const have = countItem(c.itemId), ready = have >= c.qty;
        const row = document.createElement("div");
        row.className = "contract" + (ready ? " ready" : "");
        row.innerHTML = `<span>${c.urgent ? "⚡ " : ""}${c.qty}× <b>${ITEMS[c.itemId].name}</b> — ${c.reward}c (+${c.rep} rep) <i>(have ${have})</i></span>`;
        const btn = document.createElement("button"); btn.textContent = ready ? "Fulfil" : "Need more";
        btn.disabled = !ready; btn.onclick = () => { if (fulfilContract(c)) renderMarket(); };
        row.appendChild(btn); cbox.appendChild(row);
      }
    }
    // civic donations: the standing coin sink — surplus coins become standing.
    // 100 coins buys 1 reputation, in whatever slug the purse can manage.
    const dRow = document.createElement("div");
    dRow.className = "contract";
    const coins = countItem("coins");
    dRow.innerHTML = `<span>Civic fund — donate coins to the town (100c = 1 rep)</span>`;
    for (const amt of [100, 1000]) {
      const b = document.createElement("button");
      b.textContent = `Give ${amt}c`;
      b.disabled = coins < amt;
      b.onclick = () => {
        if (countItem("coins") < amt) return;
        removeItem("coins", amt);
        addRep(amt / 100);
        log(`You donate ${amt} coins to the civic fund (+${amt / 100} rep).`, "gold");
        uiDirty = true; renderMarket();
      };
      dRow.appendChild(b);
    }
    cbox.appendChild(dRow);
  }
  // SELL — only what THIS shop buys, from your inventory. Specialists pay a
  // 20% premium for their own trade's goods. Every offer is a living-till
  // quote: bulk lots walk down the curve as the shelf fills and the till
  // drains, a saturated shelf is refused outright, and a coin-short till
  // says so instead of paying (docs/shopkeeper-economy.md).
  const sell = document.getElementById("sellgrid");
  sell.innerHTML = "";
  let any = 0, tillLight = false;
  player.inv.forEach(s => {
    if (!s || s.id === "coins") return;
    const def = ITEMS[s.id];
    if (!def || !type.buys(s.id, def)) return;
    any++;
    const premium = general ? 1 : 1.2;
    const sq = marketSellQuote(profile, s.id, s.q, premium);
    if (sq.liquidity <= 0.3) tillLight = true;
    const wanted = sq.tapered && sq.need >= 1.25;   // a real, live shortage
    const demanded = (general && demandMult(profile, s.id) > 1) || wanted;
    const qNote = s.q != null ? ` [${qualityLabel(s.q)}]` : "";
    const noBuy = sq.refused || sq.broke;
    const d = noBuy
      ? slotEl(def.icon, s.qty, `${def.name}${qNote} — ${sq.broke
          ? shopkeeper + "'s till is empty; try again tomorrow"
          : shopkeeper + " has plenty already and isn't buying more"}`)
      : slotEl(def.icon, s.qty, `Sell ${def.name}${wanted ? " (they're short of these — good coin!)" : demanded ? " (in demand here!)" : ""}${qNote} — ${sq.unit} coins each${sq.tapered ? " (big lots taper)" : ""}`);
    const pr = document.createElement("span");
    pr.className = noBuy ? "price" : "price" + (demanded || !general ? " demand" : "");
    pr.textContent = noBuy ? "✕" : (wanted ? "▲" : "") + sq.unit;
    d.appendChild(pr);
    const doSell = n => {
      n = Math.min(n, s.qty);
      if (n <= 0) return;
      if (sq.broke) { log(`${shopkeeper}: Coin's short until I shift some stock — come back in a day or two.`, "warn"); return; }
      if (sq.refused) { log(`${shopkeeper}: I've got plenty of those gathering dust already.`, "warn"); return; }
      const lot = sq.lot(n);
      if (lot.accepted <= 0) {
        log(`${shopkeeper}: ${lot.bigTicket
          ? "I couldn't tie up that much coin in one line of stock."
          : "Coin's short until I shift some stock — come back in a day or two."}`, "warn");
        return;
      }
      removeItem(s.id, lot.accepted); addItem("coins", lot.paid);
      // Phase-2 ledger: the goods go onto this town's shelf, provenance
      // attached, for other players to find; `paid` drains the shared till
      // (js/net/shopsync.js)
      if (typeof ShopSync !== "undefined") {
        const ev = s.prov && typeof provRegistry !== "undefined" ? provRegistry[s.prov] : null;
        ShopSync.noteSell(townKey, s.id, lot.accepted, s.q != null ? s.q : null,
          ev && ev.producer || null, ev && ev.skill || null, lot.paid, itemTag(s.id));
      }
      sfx("coins", 0.7);
      if (typeof Tele !== "undefined") Tele.ev("sell", s.id, Math.round(lot.paid / lot.accepted), lot.accepted);
      log(`You sell ${lot.accepted} × ${def.name} for ${lot.paid} coins.`);
      if (lot.accepted < n)
        log(`${shopkeeper}: ${lot.bigTicket ? "I can't tie up more coin in one line of stock — that's my limit on these today."
          : lot.tillShort ? "That's all the coin I can spare for now."
          : "That's as many as I can shelve."}`, "sys");
      uiDirty = true;
      renderMarket();
    };
    d.onclick = e => doSell(e.altKey ? s.qty : e.shiftKey ? 5 : 1);
    d.oncontextmenu = e => amountMenu(e, "Sell", "all", doSell);
    sell.appendChild(d);
  });
  document.getElementById("sellhdr").textContent = (any
    ? `${general ? "This store buys everyday goods" : type.name + " buys"} — your matching items:`
    : `${general ? "This store buys everyday goods." : type.name + " only buys its own trade's goods."} You carry nothing it wants.`)
    + (tillLight ? " (The till is running light — offers are down.)" : "");
}
