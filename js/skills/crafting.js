// ===== Taiao — station crafting, cooking, alchemy, and production skills =====
"use strict";

// Callers (1):
//  gameplay/pathing.js:69
function openStation(node) {
  if (node.type === "bank") { openBank(node); return; }
  const st = STATIONS[node.type];
  if (st.alchemy) { openAlchemy(node); return; }
  // finished passive jobs now wait in the station's OUTPUT BOX (openCraft)
  // until the player collects them, instead of auto-dumping into the pack
  let recs = (st.lists || []).flatMap(k => RECIPES[k] || []);
  // Tūhura Isle: the tutorial anvil forges ONLY the four lesson pieces
  // (gameplay/tutorial.js) — the rest of the world's smithing waits offshore.
  if (typeof Tutorial !== "undefined" && Tutorial.anvilRecipes) {
    const allow = Tutorial.anvilRecipes(node);
    if (allow) recs = recs.filter(r => allow.has(r.id));
  }
  openCraft(node, recs);
}

// Callers (1):
//  main/ui.js:259
// qty: how many to make (batch). Passive recipes are queued as a timed job and
// collected later; active recipes craft one per tick up to `qty` (Infinity = run
// until out of materials, the classic behaviour).
function beginCraft(recipe, node, qty) {
  const have = Object.entries(recipe.in).every(([id, q]) => countItemFam(id) >= q);
  if (!have) { log("You don't have the materials.", "warn"); return; }
  if (skillLvl(recipe.skill) < recipe.req) {
    log(`You need ${recipe.skill} level ${recipe.req} for that.`, "warn");
    return;
  }
  // heat gate: fire trades need the station's pilot fire hot enough
  if (isHeatSkill(recipe.skill)) {
    const need = reqHeat(recipe), have = stationHeatNow(node);
    if (have < need) {
      log(`The fire isn't hot enough (${have}° / ${need}° needed). Stoke it with logs — hotter logs and higher Firemaking burn hotter.`, "warn");
      return;
    }
    // passive firings must stay hot for the WHOLE job — the fire has to outlast
    // it. Long jobs demand long-burning fuel (charcoal burns far longer).
    if (recipe.passive) {
      // fire must outlast the whole job INCLUDING its wait in the station's
      // queue (jobs at one station run in series — production.js startJob)
      const wait = (typeof jobQueueEndAt === "function" && node)
        ? Math.max(0, jobQueueEndAt(node.type) - Date.now()) : 0;
      const dur = (recipe.time || recipe.tick || 0) * (qty || 1) + wait;
      if (stationBurnLeft(node) * 1000 < dur) {
        log(`The fire won't stay hot long enough (~${Math.ceil(dur / 1000)}s needed, ~${stationBurnLeft(node)}s left). Stoke it with longer-burning fuel — charcoal burns far longer than raw logs.`, "warn");
        return;
      }
    }
  }
  if (recipe.passive) { startJob(recipe, node, qty || 1); return; }
  player.act = { kind: "craft", recipe, node, nextAt: now + 400, remaining: qty || Infinity };
  log(`You begin to work at the ${STATIONS[node.type].name.toLowerCase()}...`);
}

// Callers (1):
//  skills/crafting.js:45
function recipeBurns(recipe) {
  if (!recipe.burnUntil || !recipe.burnt) return false;
  const lvl = eff(recipe.skill);
  if (lvl >= recipe.burnUntil) return false;
  return Math.random() < Math.max(0.05, (recipe.burnUntil - lvl) / recipe.burnUntil * 0.45);
}

// Callers (1):
//  gameplay/actions.js:11
function tickCraft(act) {
  const r = act.recipe;
  if (skillLvl(r.skill) < r.req) { player.act = null; return; }
  if (isHeatSkill(r.skill) && stationHeatNow(act.node) < reqHeat(r)) {
    log("The fire has cooled too far — stoke it to keep working.", "warn"); player.act = null; return;
  }
  if (!hasInputs(r)) { log("You don't have the materials.", "warn"); player.act = null; return; }
  // craftOnce (production.js) is the single generic step: consume inputs, roll
  // quality, emit outputs + by-products, record provenance, grant XP + mastery.
  if (!craftOnce(r, act.node)) { player.act = null; return; }
  if (typeof Tutorial !== "undefined" && Tutorial.onCraft) Tutorial.onCraft(r.out); // Tūhura forge task
  if (act.remaining != null && act.remaining !== Infinity) {
    act.remaining--;
    if (act.remaining <= 0) { player.act = null; return; }
  }
  if (hasInputs(r)) act.nextAt = now + r.tick;
  else player.act = null;
}

// Callers (1):
//  gameplay/actions.js:15
function tickAlchemy(act) {
  const id = act.itemId;
  const def = ITEMS[id];
  if (!def || countItem(id) < 1) { player.act = null; return; }
  const rate = Math.min(0.8, 0.5 + eff("Alchemy") * 0.005);
  const coins = Math.max(1, Math.floor(def.value * rate));
  removeItem(id, 1);
  addItem("coins", coins);
  addXp("Alchemy", Math.max(4, Math.floor(def.value * 0.8)));
  log(`You transmute ${def.name.toLowerCase()} into ${coins} coins.`);
  act.nextAt = countItem(id) ? now + 1200 : 0;
  if (!countItem(id)) player.act = null;
}
