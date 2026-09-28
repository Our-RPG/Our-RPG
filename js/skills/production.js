// ===== Taiao — generic production engine =====
// Data-driven manufacturing shared by EVERY production profession. No skill is
// special-cased here: a profession is just data (a skill id + recipes tagged
// with that skill). This engine handles multi-output recipes, by-products,
// batches, passive timed jobs, item quality, provenance/maker history and
// recipe-family mastery. See economy.js for the recipe/item DATA it consumes.
"use strict";

// ---------- quality ----------
// Configurable weighting — deliberately NOT a hard-coded final formula. Tweak
// freely; the components are each normalised to 0..100 and blended below.
const QUALITY_MODEL = {
  input:   0.40, // average quality of the consumed ingredients (carries upstream work forward)
  skill:   0.20, // producer's effective skill level
  mastery: 0.20, // repeated practice within this recipe family
  station: 0.07, // workstation grade
  tool:    0.10, // whether you're carrying the right hand tool for the trade (see TOOL_SKILLS)
  random:  0.03, // small variance so two identical jobs still differ
};

// ---- per-tool craft quality: the right hand tool finally matters ----
// Each craft skill has AT MOST ONE hand-tool that improves it (design rule:
// max one tool per recipe). Carry that tool and the quality of what you make
// rises (the `tool` term above), scaled by the tool's tier; the Master's tool
// set is UNIVERSAL (a single special tool that lifts every craft). Bare-handed
// stays neutral — pure upside — and not every skill needs a tool at all. One
// tool may still serve several trades, but no trade lists more than one.
const TOOL_SKILLS = {
  hammer:  ["Weaponsmithing", "Armoursmithing"],
  tongs:   ["Smelting", "Glassblowing", "Assaying"],
  file:    ["Toolmaking"],
  vice:    ["Locksmithing"],
  pliers:  ["Jewelry", "Wire-drawing"],
  saw:     ["Carpentry", "Sawing", "Coopering"],
  adze:    ["Shipwrighting"],
  chisel:  ["Masonry"],
  trowel:  ["Limeburning"],
  shovel:  ["Charcoaling"],
  knife:   ["Cooking", "Baking", "Fletching"],
  awl:     ["Leatherworking", "Cordwaining", "Saddlery", "Bookbinding"],
  quill:   ["Papermaking"],
  needle:  ["Tailoring", "Sailmaking"], // the sewing tool
  shears:  ["Weaving", "Textiles", "Fulling", "Ropemaking"],
  pin:     ["Tanning"], // stretch/pin hides on the rack
};
const UNIVERSAL_TOOLS = ["master_tools"]; // the Master's tool set lifts every craft
// build skill -> [tool ids] once (invert TOOL_SKILLS)
let _skillTools = null;
function skillToolsFor(skill) {
  if (!_skillTools) {
    _skillTools = {};
    for (const id in TOOL_SKILLS) for (const s of TOOL_SKILLS[id]) (_skillTools[s] || (_skillTools[s] = [])).push(id);
  }
  return _skillTools[skill] || null;
}
// the tool component (0..100) for a craft: 50 = bare-handed (neutral), higher =
// carrying a better tool for this trade. Scan is cheap (a few countItem checks).
function toolQualityFor(recipe) {
  if (typeof countItem !== "function" || typeof ITEMS === "undefined") return 50;
  let bestTier = 0;
  const consider = id => { if (ITEMS[id] && countItem(id) > 0) bestTier = Math.max(bestTier, ITEMS[id].toolTier || 1); };
  for (const id of UNIVERSAL_TOOLS) consider(id);
  const list = skillToolsFor(recipe.skill);
  if (list) for (const id of list) consider(id);
  if (bestTier <= 0) return 50;                       // no tool → neutral, no penalty
  return Math.min(100, 64 + bestTier * 1.15);         // tier1 → 65, toolbox(20) → 87, master(32) → 100
}
// player-facing quality bands (internal scale is 0..100)
const QUALITY_LABELS = [[0, "Poor"], [20, "Common"], [40, "Good"], [60, "Fine"], [80, "Superior"], [95, "Masterwork"]];
function qualityLabel(q) {
  let name = "Poor";
  for (const [t, n] of QUALITY_LABELS) if (q >= t) name = n;
  return name;
}

// ---------- recipe-family mastery ----------
// player.mastery[skill][family] stores raw practice points; the 0..100 mastery
// LEVEL is a diminishing curve over that count. Two level-27 coopers with
// different family mastery are genuinely different craftspeople.
function masteryPoints(skill, fam) {
  return (player.mastery && player.mastery[skill] && player.mastery[skill][fam]) || 0;
}
function masteryLevel(skill, fam) {
  return Math.round(100 * (1 - Math.exp(-masteryPoints(skill, fam) / 180)));
}
function grantMastery(skill, fam, amt) {
  if (!player.mastery[skill]) player.mastery[skill] = {};
  player.mastery[skill][fam] = (player.mastery[skill][fam] || 0) + amt;
}

// ---------- provenance / maker identity ----------
// A production event is stored ONCE and referenced by id; finished items keep a
// reference (and references to their input events) rather than copying history.
// provMode: "none" | "batch" (commodities, summarised) | "individual" (finished goods).
let provRegistry = {};
let provSeq = 1;
function producerName() {
  if (player.character != null && typeof CHAR_LIST !== "undefined" && CHAR_LIST[player.character])
    return CHAR_LIST[player.character].name;
  return "You";
}
function provMode(recipe, def) {
  if (recipe && recipe.prov) return recipe.prov;
  if (def && def.prov) return def.prov;
  if (def && (def.equip || def.boat || def.finished)) return "individual";
  if (def && def.stack) return "batch";
  return "individual";
}
function recordProduction(recipe, quality, inputRefs, qty) {
  const id = "P" + (provSeq++);
  provRegistry[id] = {
    id, recipeId: recipe.id, skill: recipe.skill, family: recipe.family,
    producer: producerName(), ts: Date.now(), quality: Math.round(quality),
    qty: qty || 1, inputs: (inputRefs || []).slice(0, 8),
  };
  return id;
}
// Walk an item's provenance chain into a flat, human-readable maker list.
function provenanceStory(provId, depth = 0, out = [], seen = new Set()) {
  const ev = provRegistry[provId];
  if (!ev || seen.has(provId) || depth > 8) return out;
  seen.add(provId);
  const verb = (typeof RECIPE_VERB !== "undefined" && RECIPE_VERB[ev.skill]) || "Made";
  out.push({ depth, text: `${verb} by ${ev.producer}`, skill: ev.skill, quality: ev.quality });
  for (const inRef of ev.inputs || []) provenanceStory(inRef, depth + 1, out, seen);
  return out;
}

// ---------- recipe normalisation ----------
// Legacy recipes use {out, qty, scaleYield}; new recipes may use
// {outputs:[{id,qty}], byproducts:[{id,qty,chance}]}. This returns a unified
// output list. economy.js stamps every recipe with a stable .id and .family.
function recipeOutputs(recipe) {
  if (recipe.outputs && recipe.outputs.length)
    return recipe.outputs.map((o, i) => ({ id: o.id, qty: o.qty || 1, primary: i === 0 }));
  let qty = recipe.qty || 1;
  if (recipe.scaleYield) qty += Math.floor(eff(recipe.skill) / recipe.scaleYield);
  return [{ id: recipe.out, qty, primary: true }];
}
function recipeInputs(recipe) { return Object.entries(recipe.in || {}); }
// ---- ingredient families ----
// A recipe input written as a canonical BASE id (e.g. "gem", "mortar", "quicklime") is
// satisfiable by ANY registered variant of that family, with the cheapest (lowest item
// value) consumed first so players keep the rarer/finer ones. Variants register into the
// global ITEM_FAMILY map (variantId -> baseId) wherever they are minted (mining-split.js
// gem tiers, stonework.js lime products). An id that is not a family head behaves exactly
// like plain countItem / removeItem, so everything else is unchanged.
if (typeof window !== "undefined") window.ITEM_FAMILY = window.ITEM_FAMILY || {};
let _famHeads = null, _famN = -1;
function famHeads() {
  const n = Object.keys(ITEM_FAMILY).length;
  if (_famHeads === null || n !== _famN) { _famHeads = new Set(Object.values(ITEM_FAMILY)); _famN = n; }
  return _famHeads;
}
function famStacks(base) {
  return player.inv.filter(s => s && (s.id === base || ITEM_FAMILY[s.id] === base));
}
function countItemFam(id) {
  if (!famHeads().has(id)) return countItem(id);
  return famStacks(id).reduce((n, s) => n + s.qty, 0);
}
function removeItemFam(id, q) {
  if (!famHeads().has(id)) { removeItem(id, q); return; }
  const val = s => ((ITEMS[s.id] && ITEMS[s.id].value) || 0);
  const order = famStacks(id).sort((a, b) => val(a) - val(b));
  let need = q;
  for (const s of order) { if (need <= 0) break; const t = Math.min(need, s.qty); removeItem(s.id, t); need -= t; }
}
function hasInputs(recipe, mult = 1) {
  return recipeInputs(recipe).every(([id, q]) => countItemFam(id) >= q * mult);
}
function recipeById(id) {
  for (const cat in RECIPES) for (const r of RECIPES[cat]) if (r.id === id) return r;
  return null;
}
function recipeFamily(recipe) { return recipe.family || recipe.out || "general"; }

// ---------- quality computation ----------
// A family variant's tier (its trailing _N) grants an input-quality bonus, so
// crafting with celestial-quinoa flour or a fulled samite genuinely outdoes the
// base commodity — higher ladder rungs feed the quality model, not just value.
function famTierBonus(id) { const m = /_(\d+)$/.exec(id); return m ? Math.min(20, (+m[1]) * 0.65) : 0; }
function readInputMeta(recipe) {
  let qsum = 0, qn = 0; const refs = [];
  for (const [id, q] of recipeInputs(recipe)) {
    if (famHeads().has(id)) {
      // family-head input: read quality off the stacks removeItemFam will
      // actually consume (cheapest first), plus the variant's tier bonus
      const val = s => ((ITEMS[s.id] && ITEMS[s.id].value) || 0);
      const order = famStacks(id).sort((a, b) => val(a) - val(b));
      let need = q;
      for (const s of order) {
        if (need <= 0) break;
        const t = Math.min(need, s.qty);
        qsum += Math.min(100, (s.q != null ? s.q : 50) + famTierBonus(s.id)) * t; qn += t; need -= t;
        if (s.prov != null) refs.push(s.prov);
      }
      continue;
    }
    const s = player.inv.find(s => s && s.id === id);
    const qual = s && s.q != null ? s.q : 50; // un-tracked / bought goods are "average"
    qsum += qual * q; qn += q;
    if (s && s.prov != null) refs.push(s.prov);
  }
  return { avgQ: qn ? qsum / qn : 50, refs };
}
function computeQuality(recipe, station, inputAvgQ) {
  const M = QUALITY_MODEL;
  const skillC = Math.min(100, eff(recipe.skill) / MAX_LEVEL * 100);
  const masteryC = masteryLevel(recipe.skill, recipeFamily(recipe));
  const stDef = station && station.type && typeof STATIONS !== "undefined" ? STATIONS[station.type] : null;
  const stationC = (stDef && stDef.quality) || 50;
  const toolC = toolQualityFor(recipe);
  // quality is economy-bearing: seeded server-side when logged in (seedroll.js)
  const rnd = (typeof SeedRoll !== "undefined" ? SeedRoll.random() : Math.random()) * 100;
  const q = M.input * inputAvgQ + M.skill * skillC + M.mastery * masteryC +
            M.station * stationC + M.tool * toolC + M.random * rnd;
  return Math.max(0, Math.min(100, Math.round(q)));
}

// ---------- output placement (attaches quality + provenance to inventory) ----------
function addProduced(id, qty, quality, inputRefs, recipe) {
  const def = ITEMS[id];
  const mode = provMode(recipe, def);
  if (!def.stack) {
    // individual finished good: one slot each, its own event referencing inputs
    let ok = true;
    for (let k = 0; k < qty; k++) {
      const pid = mode === "none" ? null : recordProduction(recipe, quality, inputRefs, 1);
      if (!addItem(id, 1, { q: quality, prov: pid })) { ok = false; break; }
    }
    return ok;
  }
  if (mode === "none") return addItem(id, qty, { q: quality });
  // batch commodity: merge into the existing stack's batch event when the maker
  // and recipe match, otherwise open a fresh batch. Keeps the registry bounded.
  const s = player.inv.find(s => s && s.id === id);
  const ev = s && s.prov != null ? provRegistry[s.prov] : null;
  if (ev && ev.recipeId === recipe.id && ev.producer === producerName()) {
    const total = s.qty + qty;
    ev.quality = Math.round((ev.quality * s.qty + quality * qty) / total);
    ev.qty = (ev.qty || s.qty) + qty;
    return addItem(id, qty, { q: quality, prov: s.prov });
  }
  const pid = recordProduction(recipe, quality, inputRefs, qty);
  return addItem(id, qty, { q: quality, prov: pid });
}

// ---------- the ONE production step ----------
// Everything (instant crafting, batch crafting, passive-job collection) funnels
// through craftOnce so there is exactly one place that consumes inputs, rolls
// quality, spawns outputs + by-products, records provenance, grants XP + mastery.
function craftOnce(recipe, station) {
  if (skillLvl(recipe.skill) < recipe.req) return false;
  if (!hasInputs(recipe)) return false;
  const meta = readInputMeta(recipe);
  for (const [id, q] of recipeInputs(recipe)) removeItemFam(id, q);
  // legacy burn mechanic (cooking) — a spoiled output has no quality/provenance
  if (typeof recipeBurns === "function" && recipeBurns(recipe)) {
    addItem(recipe.burnt, 1);
    sfx("error", 0.5);
    log("You accidentally burn it.", "warn");
    return true;
  }
  const quality = computeQuality(recipe, station, meta.avgQ);
  const outs = recipeOutputs(recipe);
  const names = [];
  for (const o of outs) {
    if (!addProduced(o.id, o.qty, quality, meta.refs, recipe)) { log("Your inventory is full.", "warn"); return false; }
    names.push(ITEMS[o.id].name + (o.qty > 1 ? " x" + o.qty : ""));
  }
  for (const b of recipe.byproducts || []) {
    if (b.chance != null && (typeof SeedRoll !== "undefined" ? SeedRoll.random() : Math.random()) > b.chance) continue;
    if (addProduced(b.id, b.qty || 1, Math.round(quality * 0.85), meta.refs, recipe))
      names.push(ITEMS[b.id].name + (b.qty > 1 ? " x" + b.qty : ""));
  }
  addXp(recipe.skill, recipe.xp);
  grantMastery(recipe.skill, recipeFamily(recipe), 1);
  const showQ = !ITEMS[outs[0].id].tool && provMode(recipe, ITEMS[outs[0].id]) !== "none";
  sfxCraft(recipe.skill);
  log(`You make: ${names.join(", ")}${showQ ? ` [${qualityLabel(quality)}]` : ""}.`);
  // one-time nudge so the tool-quality bonus is discoverable in play
  if (!_toolHintShown && toolQualityFor(recipe) > 50) {
    _toolHintShown = true;
    log("The right tool in your pack steadies the work — better quality. (Toolmaking)", "sys");
  }
  return true;
}
let _toolHintShown = false;

// ---------- passive production jobs ----------
// Pattern: commit materials now, a wall-clock timer runs while you're away,
// collect the finished goods when you return to the station. Generic — malting,
// brewing, seasoning, cheese ageing etc. are all just recipes with passive:true.
function passiveTime(recipe) { return recipe.time || (recipe.tick || 2000) * 4; }
// Jobs at one station type run in SERIES (user req 2026-09-15): a fresh
// firing waits its turn behind whatever that station is already running —
// this is when the queue's last job clears.
function jobQueueEndAt(stationType) {
  let end = Date.now();
  for (const j of (player.jobs || []))
    if ((j.station || null) === (stationType || null)) end = Math.max(end, j.doneAt);
  return end;
}
function startJob(recipe, station, qty) {
  qty = Math.max(1, qty | 0);
  if (skillLvl(recipe.skill) < recipe.req) { log(`You need ${recipe.skill} level ${recipe.req} for that.`, "warn"); return false; }
  if (!hasInputs(recipe, qty)) { log("You don't have the materials for that batch.", "warn"); return false; }
  const meta = readInputMeta(recipe);
  for (const [id, q] of recipeInputs(recipe)) removeItemFam(id, q * qty);
  const dur = passiveTime(recipe) * qty;
  const t0 = jobQueueEndAt(station ? station.type : null);
  player.jobs.push({
    recipeId: recipe.id, station: station ? station.type : null, qty,
    startedAt: t0, doneAt: t0 + dur, inQ: meta.avgQ, inRefs: meta.refs,
  });
  const queued = t0 > Date.now() + 500;
  log(`You set ${recipe.name.toLowerCase()} going (x${qty}).${queued ? " It waits its turn behind the current job." : ""} Ready in ~${Math.ceil((t0 + dur - Date.now()) / 1000)}s — come back for it.`, "sys");
  uiDirty = true;
  return true;
}
function jobReady(job) { return Date.now() >= job.doneAt; }
function jobRecipe(job) { return recipeById(job.recipeId); }
// Collect every ready job matching this station type (null station = any).
function collectReadyJobs(stationType) {
  if (!player.jobs || !player.jobs.length) return 0;
  let collected = 0;
  for (let i = player.jobs.length - 1; i >= 0; i--) {
    const job = player.jobs[i];
    if (stationType != null && job.station != null && job.station !== stationType) continue;
    if (!jobReady(job)) continue;
    const r = jobRecipe(job);
    if (!r) { player.jobs.splice(i, 1); continue; }
    const quality = computeQuality(r, { type: job.station }, job.inQ);
    const outs = recipeOutputs(r);
    while (job.qty > 0) {
      if (invFull(outs[0].id)) break; // no room — leave the rest queued
      for (const o of outs) addProduced(o.id, o.qty, quality, job.inRefs, r);
      for (const b of r.byproducts || []) {
        if (b.chance != null && (typeof SeedRoll !== "undefined" ? SeedRoll.random() : Math.random()) > b.chance) continue;
        addProduced(b.id, b.qty || 1, Math.round(quality * 0.85), job.inRefs, r);
      }
      addXp(r.skill, r.xp, true);
      grantMastery(r.skill, recipeFamily(r), 1);
      job.qty--; collected++;
    }
    if (job.qty <= 0) player.jobs.splice(i, 1);
  }
  if (collected) { log(`You collect ${collected} finished item${collected > 1 ? "s" : ""} from your passive jobs.`, "gold"); uiDirty = true; }
  return collected;
}
function readyJobCount() { return (player.jobs || []).reduce((n, j) => n + (jobReady(j) ? 1 : 0), 0); }

// ---------- economy graph validator (dev utility) ----------
// Call validateEconomy() in the browser console. Flags missing sources, dead
// outputs, circular dependencies, over-long chains and self-isolated skills.
function validateEconomy() {
  const produced = {}, consumed = {}, skillOut = {}, skillIn = {};
  const note = (map, id) => { map[id] = (map[id] || 0) + 1; };
  // family-aware: a produced/sourced variant also satisfies its ITEM_FAMILY head
  // (a rough ruby sources "gem", lp_mortar_fine sources "mortar"), and an item
  // whose family HEAD is consumed counts as consumed (flour_9 lives because
  // recipes eat "flour"). Mirrors countItemFam/removeItemFam at craft time.
  const FAM = (typeof ITEM_FAMILY !== "undefined" && ITEM_FAMILY) || {};
  // gatherable / grown / dropped / butchered items count as "sourced"
  const sourced = new Set();
  const source = id => { sourced.add(id); if (FAM[id]) sourced.add(FAM[id]); };
  if (typeof NODE_TYPES !== "undefined") for (const k in NODE_TYPES) if (NODE_TYPES[k].item) source(NODE_TYPES[k].item);
  if (typeof CROPS !== "undefined") for (const k in CROPS) source(CROPS[k].item);
  if (typeof FORAGE !== "undefined") for (const f of FORAGE) source(f.id);
  if (typeof FISH !== "undefined") for (const f of FISH) source(f.raw);
  if (typeof SHOP_STOCK !== "undefined") for (const id of SHOP_STOCK) source(id);
  if (typeof MONSTERS !== "undefined") for (const k in MONSTERS) {
    for (const d of MONSTERS[k].drops || []) source(d.id);
    const b = MONSTERS[k].butcher; if (b) { source(b.item || "raw_meat"); if (b.hideItem) source(b.hideItem); }
  }
  const edges = {}; // skill -> Set(skill) it draws inputs from
  for (const cat in RECIPES) for (const r of RECIPES[cat]) {
    for (const o of recipeOutputs(r)) { note(produced, o.id); if (FAM[o.id]) note(produced, FAM[o.id]); (skillOut[r.skill] = skillOut[r.skill] || new Set()).add(o.id); }
    for (const b of r.byproducts || []) { note(produced, b.id); if (FAM[b.id]) note(produced, FAM[b.id]); }
    for (const [id] of recipeInputs(r)) { note(consumed, id); (skillIn[r.skill] = skillIn[r.skill] || new Set()).add(id); }
  }
  // which skill makes item X (for chain edges)
  const makerSkill = {};
  for (const cat in RECIPES) for (const r of RECIPES[cat]) for (const o of recipeOutputs(r)) { makerSkill[o.id] = r.skill; if (FAM[o.id] && !makerSkill[FAM[o.id]]) makerSkill[FAM[o.id]] = r.skill; }
  for (const cat in RECIPES) for (const r of RECIPES[cat]) for (const [id] of recipeInputs(r)) {
    const src = makerSkill[id];
    if (src && src !== r.skill) (edges[r.skill] = edges[r.skill] || new Set()).add(src);
  }
  const report = { missingSources: [], deadOutputs: [], isolatedSkills: [], cycles: [], longChains: [] };
  for (const id in consumed) if (!produced[id] && !sourced.has(id) && ITEMS[id]) report.missingSources.push(id);
  // place (furniture) and reveal (spyglass) items are used by gameplay, not recipes
  const usable = it => it && (it.equip || it.heals || it.potion || it.boat || it.tool || it.finished || it.log || it.light || it.place || it.reveal);
  const isConsumed = id => consumed[id] || (FAM[id] && consumed[FAM[id]]);
  for (const id in produced) if (!isConsumed(id) && !usable(ITEMS[id]))
    report.deadOutputs.push(id);
  // isolated skills: draw no external inputs AND feed no other skill
  const feedsOthers = (skill, outs) => {
    for (const cat in RECIPES) for (const r of RECIPES[cat]) if (r.skill !== skill)
      for (const [id] of recipeInputs(r)) if (outs.has(id)) return true;
    return false;
  };
  for (const skill in skillOut) {
    const outs = skillOut[skill], ins = skillIn[skill] || new Set();
    const drawsExternal = [...ins].some(id => (makerSkill[id] && makerSkill[id] !== skill) || sourced.has(id));
    if (!drawsExternal && !feedsOthers(skill, outs)) report.isolatedSkills.push(skill);
  }
  // cycles + longest chain over the item dependency graph
  const depth = {}; const stack = new Set();
  function chainDepth(id, path) {
    if (depth[id] != null) return depth[id];
    if (stack.has(id)) { report.cycles.push([...path, id].join(" → ")); return 0; }
    stack.add(id);
    let best = 0;
    const r = firstRecipeFor(id);
    if (r) for (const [inId] of recipeInputs(r)) best = Math.max(best, 1 + chainDepth(inId, [...path, id]));
    stack.delete(id);
    return depth[id] = best;
  }
  function firstRecipeFor(id) {
    for (const cat in RECIPES) for (const r of RECIPES[cat]) if (recipeOutputs(r).some(o => o.id === id)) return r;
    return null;
  }
  for (const id in produced) { const d = chainDepth(id, []); if (d > 8) report.longChains.push(`${id} (${d} stages)`); }
  console.log("%c Taiao economy report", "font-weight:bold");
  console.log("Missing sources (needed but nothing makes/gathers them):", report.missingSources);
  console.log("Dead outputs (made but never used):", report.deadOutputs);
  console.log("Isolated skills (only interact with themselves):", report.isolatedSkills);
  console.log("Circular dependencies:", report.cycles);
  console.log("Over-long chains (>8 stages):", report.longChains);
  return report;
}
if (typeof window !== "undefined") window.validateEconomy = validateEconomy;
