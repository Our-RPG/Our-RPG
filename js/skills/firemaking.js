// ===== Taiao — Firemaking & station heat =====
// Firemaking is now the FUEL skill for every heat trade. Each heat station
// (furnace, kiln, cauldron, campfire…) needs a PILOT FIRE burning under it; the
// fire carries a HEAT value (0..HEAT_MAX) that decays over wall-clock time. You
// keep it lit by STOKING it with logs — the log's tier and your Firemaking level
// together set how hot the fire gets and how long it burns. Higher-tier recipes
// in a heat skill demand more heat, so hotter fires (better logs + higher
// Firemaking) unlock hotter crafts. See beginCraft/tickCraft (crafting.js) for
// the gate, openCraft (ui.js) for the readout + Stoke button, render3d.js for
// the scaled flames, storage.js for persistence.
"use strict";

const HEAT_MAX = 1000;

// skills whose crafts are done over a fire — they require station heat
const HEAT_SKILLS = new Set([
  "Smelting", "Glassblowing", "Cooking", "Baking", "Brewing", "Potionmaking",
  "Soapmaking", "Pottery", "Charcoaling", "Limeburning", "Malting", "Cheesemaking",
  "Jewelry",
]);
function isHeatSkill(skill) { return HEAT_SKILLS.has(skill); }
// a station whose recipe list contains at least one heat-skill recipe is a heat
// station (needs & accepts a pilot fire)
function stationIsHeat(node) {
  if (!node || !STATIONS[node.type]) return node && node.dyn && node.type === "campfire";
  const lists = STATIONS[node.type].lists || [];
  for (const k of lists) for (const r of (RECIPES[k] || [])) if (HEAT_SKILLS.has(r.skill)) return true;
  return false;
}

// ---- heat curves (everything on the 1..MAX_LEVEL / 0..31 tier scale) ----
// how much heat a recipe demands (from its level requirement)
function reqHeat(recipe) {
  const req = Math.max(1, Math.min(MAX_LEVEL, recipe.req || 1));
  return Math.round(req / MAX_LEVEL * HEAT_MAX);
}
// peak heat a log of tier t can supply (tier 0..31)
function logHeat(tier) { return Math.round((Math.max(0, tier) + 1) / MAX_LEVEL * HEAT_MAX); }
// the ceiling your Firemaking level can coax out of any fire
function firemakingCap() { return Math.round(eff("Firemaking") / MAX_LEVEL * HEAT_MAX); }
// a single stoke's peak = the log's heat, capped by your Firemaking skill
function stokePeak(tier) { return Math.min(logHeat(tier), firemakingCap()); }
// how long a stoke burns (ms) — better logs & higher Firemaking burn longer
function burnMsFor(tier) { return 45000 + Math.max(0, tier) * 6000 + eff("Firemaking") * 3000; }

// ---- fuels: logs (raw) and premium fuels like charcoal ----------------------
// Anything with .log burns; items flagged .fuel={premium:true,…} are refined
// fuels that burn HOTTER (push past the Firemaking ceiling by capBonus) and far
// LONGER — charcoal is the flagship, made via Charcoaling. fuelStats gives the
// peak heat and burn time a single unit provides right now.
function isFuel(id) { const it = ITEMS[id]; return !!(it && (it.log || it.fuel)); }
function fuelStats(id) {
  const it = ITEMS[id];
  if (!it) return null;
  const fm = eff("Firemaking"), cap = firemakingCap();
  if (it.fuel && it.fuel.premium) {
    const bonus = it.fuel.capBonus != null ? it.fuel.capBonus : 200;   // hotter than any wood fire you could build
    return { peak: Math.min(HEAT_MAX + bonus, cap + bonus),
             burnMs: (it.fuel.burnBase != null ? it.fuel.burnBase : 180000) + fm * 4000,
             tier: Math.min(MAX_LEVEL - 1, it.logTier || (MAX_LEVEL - 1)), premium: true };
  }
  if (it.log) { const t = it.logTier || 0; return { peak: stokePeak(t), burnMs: burnMsFor(t), tier: t, premium: false }; }
  return null;
}

// ---- per-station heat store, keyed by tile + floor (persisted) ----
let stationHeat = new Map();
function heatKey(node) {
  const x = node.x != null ? node.x : player.x, y = node.y != null ? node.y : player.y;
  return x + "," + y + "," + (node.level != null ? node.level : player.level | 0);
}
// current heat at a station: the fire holds its peak for the first 60% of the
// burn (a hot working plateau), then ramps linearly to 0 over the last 40%. So a
// fire stoked to the required heat stays usable for a good while, not an instant.
const HEAT_HOLD = 0.6;
function stationHeatNow(node) {
  // Tūhura fuel rules (user req 2026-09-16): EVERY isle fire burns real fuel,
  // the Smith's furnace included — his always-roaring exemption is gone. He
  // now gifts an iron dagger ("my old belt knife") and a flint alongside the
  // pickaxe, so a fresh hand can strike the spark and stoke the furnace with
  // their own logs before their first blade is ever forged.
  const rec = stationHeat.get(heatKey(node));
  if (!rec) return 0;
  const t = (now - rec.stokedAt) / rec.burnMs;
  if (t >= 1) { stationHeat.delete(heatKey(node)); return 0; }
  const frac = t <= HEAT_HOLD ? 1 : 1 - (t - HEAT_HOLD) / (1 - HEAT_HOLD);
  return Math.round(rec.peak * frac);
}
// seconds left before the fire dies (for UI)
function stationBurnLeft(node) {
  const rec = stationHeat.get(heatKey(node));
  if (!rec) return 0;
  return Math.max(0, Math.ceil((rec.stokedAt + rec.burnMs - now) / 1000));
}

// the hottest heat a station can currently make use of = the max required heat
// among the heat recipes the player has UNLOCKED there. Stoking to this enables
// everything they're skilled to craft, and no hotter (so we don't over-fuel).
function stationTargetHeat(node) {
  const st = node && STATIONS[node.type];
  const lists = st ? st.lists || [] : [];
  let target = 0;
  for (const k of lists) for (const r of (RECIPES[k] || [])) {
    if (!isHeatSkill(r.skill) || skillLvl(r.skill) < (r.req || 1)) continue;
    const rh = reqHeat(r); if (rh > target) target = rh;
  }
  return target;
}

// index of the best fuel to stoke with, or -1. CONSERVES premium fuel: returns
// the CHEAPEST fuel that still reaches `targetHeat` (prefers plain logs, lowest
// tier, cheapest, shortest burn) so charcoal is spent only when no ordinary log
// is hot enough. Pass a huge targetHeat (Infinity) to force the hottest fuel.
function bestLogIndex(targetHeat) {
  targetHeat = targetHeat || 0;
  let cheap = -1, cheapRank = Infinity;      // cheapest fuel meeting the target
  let hot = -1, hotPeak = -1, hotBurn = -1;  // fallback: hottest fuel we have
  for (let i = 0; i < player.inv.length; i++) {
    const s = player.inv[i];
    if (!s || !isFuel(s.id)) continue;
    const f = fuelStats(s.id); if (!f) continue;
    if (f.peak > hotPeak || (f.peak === hotPeak && f.burnMs > hotBurn)) { hot = i; hotPeak = f.peak; hotBurn = f.burnMs; }
    if (f.peak >= targetHeat) {
      const it = ITEMS[s.id];
      // rank: plain logs before premium, then lowest peak, then cheapest, then shortest burn
      const rank = (f.premium ? 1e12 : 0) + f.peak * 1e6 + (it.value || 0) * 1e3 + Math.min(9999, Math.round(f.burnMs / 100));
      if (rank < cheapRank) { cheapRank = rank; cheap = i; }
    }
  }
  return cheap >= 0 ? cheap : hot;
}

// ---- flint & steel: strike a spark to light a fire ----
// You must WIELD a bladed weapon (mace/hammer/bow/wand won't do) and carry at
// least one flint; whether the spark catches rides on your Firemaking level.
const BLADED_RE = /dagger|sword|scimitar|dao|khopesh|kilij|shamshir|katana|tanto|kris|kukri|wakizashi|battleaxe|halberd|spear|glaive|machete|knife|sabre|saber|rapier|falchion|cutlass|cleaver|blade/i;
function hasBladedWeapon() {
  // a working KNIFE in the pack strikes sparks too (tool:"knife" — the
  // Smith's tutorial gift): no weapon needs wielding to light a fire
  if (typeof hasTool === "function" && hasTool("knife")) return true;
  const w = player.equip && player.equip.weapon; if (!w) return false;
  const id = w.id || w; const def = id && ITEMS[id]; if (!def) return false;
  if (def.bowPower || def.magicPower) return false;              // ranged/magic weapons aren't blades
  return BLADED_RE.test(id) || BLADED_RE.test(def.name || "");
}
function sparkChance() { return Math.min(0.95, 0.32 + eff("Firemaking") * 0.021); }
// try to strike a spark; logs the outcome. what: "fire" | "candle". Returns bool.
function strikeToLight(what) {
  if (!hasBladedWeapon()) { log("You need a knife in your pack (or a bladed weapon wielded) to strike a spark.", "warn"); return false; }
  if ((typeof countItem === "function" ? countItem("flint") : 0) < 1) { log("You need a piece of flint to strike your blade against.", "warn"); return false; }
  if (Math.random() >= sparkChance()) {
    log("You strike your blade against the flint, but the spark fizzles out.", "warn");
    addXp("Firemaking", 2);                                       // a little practice even on a miss
    return false;
  }
  log("You struck your blade against the flint and " + (what === "candle" ? "lit the wick." : "sparked a fire."), "sys");
  return true;
}

// Stoke a station's pilot fire with one unit of fuel. invIndex optional
// (defaults to the hottest fuel you carry). Returns true if it burned.
// Callers: ui.js (Stoke button), input.js (context menu), firemaking.js
function stokeFire(node, invIndex, alreadySparked) {
  if (invIndex == null || invIndex < 0) invIndex = bestLogIndex(stationTargetHeat(node));
  const s = invIndex >= 0 ? player.inv[invIndex] : null;
  if (!s || !isFuel(s.id)) { log("You need logs or charcoal to stoke the fire.", "warn"); return false; }
  // lighting a COLD fire/station needs a struck spark; feeding a lit one doesn't
  if (!alreadySparked && stationHeatNow(node) <= 0 && !strikeToLight("fire")) return false;
  const f = fuelStats(s.id);
  const key = heatKey(node);
  const cur = stationHeatNow(node);                  // don't let a weak stoke cool a hot fire
  stationHeat.set(key, { peak: Math.max(cur, f.peak), stokedAt: now, burnMs: f.burnMs, tier: f.tier });
  // Phase-2 shared world: a stoked forge stays hot for the next player (regionsync.js)
  if (typeof RegionSync !== "undefined") RegionSync.noteHeat(key);
  if (node.expireAt != null) node.expireAt = now + f.burnMs;   // keep a re-stoked campfire alive as long as it's hot
  s.qty -= 1;
  if (s.qty <= 0) player.inv[invIndex] = null;
  // base doubled from 30 (user req 2026-10-03): the smith stage's own smelt
  // plan only naturally stokes the furnace once or twice, nowhere near the
  // 1154 xp level 3 demands — and iron smelting is gated on exactly that
  // level (firemakingCap() at 3 == reqHeat(iron's req:3)), so the old rate
  // quietly asked for a lot of off-quest log-burning just to unlock iron.
  addXp("Firemaking", Math.round(60 * (1 + Math.min(MAX_LEVEL - 1, f.tier) * 0.55) * (f.premium ? 1.4 : 1)));
  // the Smith's stage counts the first furnace lit (gameplay/tutorial.js)
  if (typeof Tutorial !== "undefined" && Tutorial.onStoke) Tutorial.onStoke(node);
  const capped = !f.premium && logHeat(f.tier) > firemakingCap();
  log(`You stoke the fire with ${ITEMS[s.id].name}. Heat: ${stationHeatNow(node)}°`
    + (f.premium ? " — charcoal burns hot and long." : capped ? " — your Firemaking limits how hot it gets." : ""),
    capped ? "warn" : "info");
  uiDirty = true;
  return true;
}

// LAY a fire: stack logs on the ground as an UNLIT pile (wild cooking is now two
// steps — place the logs, then strike a spark to light them).
// Callers: main/ui.js (click logs in the pack)
function placeLogs(invIndex) {
  const s = player.inv[invIndex];
  if (!s || !ITEMS[s.id].log) return;
  const g = world.getGround(player.x, player.y);
  if (g === "stone" || g === "stone2" || g === "farm") { log("You can't lay a fire here.", "warn"); return; }
  if (dynNodes.some(f => f.x === player.x && f.y === player.y)) { log("There's already something here.", "warn"); return; }
  if (world.nodeAt(player.x, player.y)) { log("You can't lay a fire here.", "warn"); return; }
  const name = ITEMS[s.id].name.toLowerCase();
  dynNodes.push({ id: dynId++, type: "unlit_fire", x: player.x, y: player.y, level: player.level | 0,
    dyn: true, logId: s.id, logTier: ITEMS[s.id].logTier || 0, expireAt: now + 300000 });
  s.qty -= 1; if (s.qty <= 0) player.inv[invIndex] = null;
  log(`You lay the ${name} on the ground. Strike a spark (bladed weapon + flint) to light it.`);
  uiDirty = true;
}
// Undo a lay: hand the logs back and remove the unlit pile. Lets a player
// who laid a fire without a knife/flint (or just changed their mind) reclaim
// the logs instead of being stuck with an unlightable, unremovable pile.
// Callers: gameplay/pathing.js (executeGoal "pickupFire")
function pickUpUnlitFire(node) {
  if (!node || node.type !== "unlit_fire") return;
  if (!addItem(node.logId, 1)) { log("Your inventory is full.", "warn"); return; }
  dynNodes = dynNodes.filter(d => d !== node);
  log(`You gather up the ${ITEMS[node.logId].name.toLowerCase()}.`, "sys");
  uiDirty = true;
}
// Strike a laid unlit fire alight — blade + flint + a Firemaking-scaled roll.
// On a fizzle the pile stays put, so you can try again.
// Callers: gameplay/pathing.js (executeGoal "lightFire")
function lightPlacedFire(node) {
  if (!node || node.type !== "unlit_fire") return;
  if (!strikeToLight("fire")) return;
  const f = fuelStats(node.logId);
  node.type = "campfire"; node.station = true; node.dyn = true;
  node.expireAt = now + f.burnMs;
  stationHeat.set(heatKey(node), { peak: f.peak, stokedAt: now, burnMs: f.burnMs, tier: f.tier });
  if (typeof RegionSync !== "undefined") RegionSync.noteHeat(heatKey(node));
  // base doubled from 30 (user req 2026-10-03): the smith stage's own smelt
  // plan only naturally stokes the furnace once or twice, nowhere near the
  // 1154 xp level 3 demands — and iron smelting is gated on exactly that
  // level (firemakingCap() at 3 == reqHeat(iron's req:3)), so the old rate
  // quietly asked for a lot of off-quest log-burning just to unlock iron.
  addXp("Firemaking", Math.round(60 * (1 + Math.min(MAX_LEVEL - 1, f.tier) * 0.55) * (f.premium ? 1.4 : 1)));
  log("The fire catches and burns merrily.");
  uiDirty = true;
}
// Light a candle you're carrying — strike a spark to light the wick, then the
// lit candle goes straight into your OFF hand (shield slot): a lit candle is
// something you HOLD, it appears equipped there and glows for as long as you
// carry it (daynight.js candleInHand). Any previous offhand item returns to
// the pack (equipItem's normal swap).
// Callers: main/ui.js (click a candle in the pack)
function lightCandle(invIndex) {
  const s = player.inv[invIndex];
  const def = s && ITEMS[s.id];
  if (!def || !def.light) return;
  if (!strikeToLight("candle")) return;
  const bright = typeof def.light === "number" ? def.light : 1;
  if (typeof equipItem === "function") equipItem(invIndex);
  addXp("Firemaking", 8 + bright * 2);
  log(`You light the ${def.name.toLowerCase()} and hold it in your off-hand — it casts a warm glow.`);
  uiDirty = true;
}

// (top-level function/let/const are shared across classic <script> files, so
// stationHeat, stokeFire, reqHeat, lightFire… are visible to crafting.js, ui.js,
// render3d.js and storage.js directly.)
