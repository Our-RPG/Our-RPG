// ===== Taiao — woodcraft: every log & rākau → a tiered product =====
// Each of the tree logs and every native rākau is now an intermediate crafting
// ingredient for a TIERED finished item in another skill, so higher-tier wood
// maps to higher-tier gear (before this, only plain `logs`/oak fed other skills —
// the rest just became generic boards or charcoal). Base logs rotate through
// Fletching bows, Fletching staves, Carpentry bucklers and Toolmaking mallets;
// rākau rotate through Carpentry taiaha & patu and Fletching kōpere (native bows).
// Loads after content.js / geartiers.js / toolcraft.js / nz-extra-trees.js, so the
// logs, rākau and RECIPES.{fletching,carpentry,toolmaking} already exist.
"use strict";
(function () {
  if (typeof ITEMS === "undefined" || typeof RECIPES === "undefined" || typeof defineIcon !== "function") return;
  const TV = typeof tierVal === "function" ? tierVal : (i => 5 + i * 5);
  const TX = typeof tierXp === "function" ? tierXp : (i, b) => Math.round(b * (1 + i * 0.5));
  const woodName = d => (d.name.replace(/\s*logs$/i, "").trim() || "Rough");
  const a = w => (/^[aeiou]/i.test(w) ? "an" : "a"); // article
  const cat = c => (RECIPES[c] = RECIPES[c] || []);
  const ST_FL = ["fletchers_bench", "workbench"], ST_CP = ["workbench"], ST_TM = ["toolsmith", "anvil", "workbench"];

  // Register a tiered item (tinted per-tier icon) + the recipe that carves it from
  // `qty` of `wood`. req = the crafting-skill level (tier+1); XP/value scale with tier.
  function make(id, name, iconBase, tier, props, skill, catName, stations, recipeName, wood, qty, xpBase) {
    if (ITEMS[id]) return;
    defineIcon("i_" + id, iconBase, tier);
    ITEMS[id] = Object.assign({ name, icon: "i_" + id }, props);
    if (typeof EXAMINE !== "undefined" && !EXAMINE[id]) EXAMINE[id] = name + ".";
    cat(catName).push({
      id: "wc_" + id, out: id, name: recipeName, skill,
      req: Math.max(1, tier + 1), xp: TX(tier, xpBase), in: { [wood]: qty },
      tick: 1600 + tier * 22, family: "woodcraft", stations,
    });
  }

  // collect every log / rākau, ordered by tier
  const logs = [], rakau = [];
  for (const id in ITEMS) {
    const d = ITEMS[id];
    if (!d.log) continue;
    const e = { id, tier: d.logTier | 0, s: woodName(d) };
    if (/^rakau_/.test(id)) rakau.push(e);
    else if (id === "logs" || id === "pine_logs" || /^log_\d+$/.test(id)) logs.push(e);
  }
  logs.sort((a, b) => a.tier - b.tier);
  rakau.sort((a, b) => a.tier - b.tier);

  // ---- base logs → bow / staff / buckler / mallet (4-way rotation) ----
  for (const w of logs) {
    const T = w.tier, S = w.s, v = Math.round(TV(T) * 3.5), lc = S.toLowerCase();
    if (T % 4 === 0) make("wc_bow_" + T, `${S} bow`, "i_bow", T,
      { value: v, equip: "weapon", bowPower: 1 + Math.floor(T / 3), rangeReq: T + 1, range: T >= 7 ? 40 : 20, atkTick: 1500 + T * 8 },
      "Fletching", "fletching", ST_FL, `Carve ${a(lc)} ${lc} bow`, w.id, 2, 60);
    else if (T % 4 === 1) make("wc_staff_" + T, `${S} staff`, "i_staff", T,
      { value: v, equip: "weapon", magicPower: 1 + Math.floor(T / 3), magicReq: T + 1, weave: T >= 12 ? 3 : 2, range: 7 + Math.floor(T / 8), atkTick: 1700 + T * 8 },
      "Fletching", "fletching", ST_FL, `Carve ${a(lc)} ${lc} staff`, w.id, 2, 65);
    else if (T % 4 === 2) make("wc_buckler_" + T, `${S} buckler`, "i_shield", T,
      { value: v, equip: "shield", block: Math.min(0.3, 0.05 + T * 0.006), wearReq: T + 1 },
      "Carpentry", "carpentry", ST_CP, `Build ${a(lc)} ${lc} buckler`, w.id, 3, 60);
    else make("wc_mallet_" + T, `${S} mallet`, "i_sw_fe", T,
      { value: v, equip: "weapon", power: 1 + Math.floor(T / 4), wieldReq: T + 1, atkTick: 1600 + T * 6 },
      "Toolmaking", "toolmaking", ST_TM, `Shape ${a(lc)} ${lc} mallet`, w.id, 2, 60);
  }

  // ---- rākau → taiaha / patu / kōpere (3-way rotation, native arms) ----
  for (const w of rakau) {
    const T = w.tier, S = w.s, v = Math.round(TV(T) * 4.5), lc = S.toLowerCase(), suf = w.id.replace(/^rakau_/, "");
    if (T % 3 === 0) make("wc_taiaha_" + suf, `${S} taiaha`, "i_staff", T,
      { value: v, equip: "weapon", power: 2 + Math.floor(T / 4), wieldReq: T + 1, atkTick: 1800 + T * 6 },
      "Carpentry", "carpentry", ST_CP, `Carve ${a(lc)} ${lc} taiaha`, w.id, 2, 70);
    else if (T % 3 === 1) make("wc_patu_" + suf, `${S} patu`, "i_sw_fe", T,
      { value: v, equip: "weapon", power: 2 + Math.floor(T / 4), wieldReq: T + 1, atkTick: 1300 + T * 4 },
      "Carpentry", "carpentry", ST_CP, `Carve ${a(lc)} ${lc} patu`, w.id, 2, 70);
    else make("wc_kopere_" + suf, `${S} kōpere`, "i_bow", T,
      { value: v, equip: "weapon", bowPower: 2 + Math.floor(T / 3), rangeReq: T + 1, range: 40, atkTick: 1600 + T * 6 },
      "Fletching", "fletching", ST_FL, `Bind ${a(lc)} ${lc} kōpere`, w.id, 2, 70);
  }
})();
