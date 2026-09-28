// ===== Taiao — combat skills =====
"use strict";

// Callers (1):
//  gameplay/pathing.js:68
function startCombat(mon) {
  if (!mon.alive) return;
  player.act = { kind: "combat", mon };
  // no pre-aggro here: the monster reacts when the first blow/arrow LANDS
  // (playerAttack for melee/magic, tickArrows for archery) — an archer's
  // opening shot strikes an unaware target, and only then does it charge
}
// Callers (3):
//  skills/combat.js:40,47,52
function amuletBonus() {
  return player.equip.neck ? (ITEMS[player.equip.neck].hitBonus || 0) : 0;
}
// Callers (1):
//  skills/combat.js:99
// Sums .block across every occupied gear slot except weapon/quiver/runes —
// dedupes by item id first, since a multi-slot item (e.g. a chestplate
// spanning torso+both shoulders+both arms) repeats the SAME id across
// several EQUIP_SLOTS entries and must only count its .block once.
function blockTotal() {
  const seen = new Set();
  let b = 0;
  for (const slot of EQUIP_SLOTS) {
    if (slot === "weapon" || QUIVER_SLOTS.has(slot)) continue;
    const id = player.equip[slot];
    if (id && !seen.has(id)) { seen.add(id); b += ITEMS[id].block || 0; }
  }
  return b;
}
// Combat style follows the hands, not a UI toggle: a bow in the main hand
// shoots, a wand or staff weaves, anything else (or nothing) swings.
// player.style (saved, and read by the renderers for the held-item stance)
// is kept in sync with the derived value here.
// Callers (4):
//  skills/combat.js (styleRange, playerAttack, tickCombat)
function combatStyle() {
  const w = player.equip.weapon;
  let s = "melee";
  if (w && ITEMS[w].bowPower) s = "archery";
  else if (w && ITEMS[w].magicPower) s = "magic";
  if (player.style !== s) { player.style = s; uiDirty = true; }
  return s;
}
// Callers (2):
//  gameplay/input.js:87 skills/combat.js:126
function styleRange() {
  const s = combatStyle();
  if (s === "melee") return 1;
  return ITEMS[player.equip.weapon].range || (s === "archery" ? 8 : 5);
}
// The sidearm in the shield slot (an offhand dagger — ITEMS[].offhand gear
// equipped there via equipItem): archery switches to it automatically when
// the enemy is adjacent, since you can't draw a bow with a wolf on your toes.
function offhandWeapon() {
  const id = player.equip.shield;
  return id && ITEMS[id].power ? id : null;
}

// ---------- archery ballistics ----------
// A shot flies a parabolic arc from the shooter's bow height to the target,
// lofting higher the longer the shot. The arc is sampled against the terrain
// and every structure it crosses (building walls up over their roofs, city
// wall rings, closed doors and gates); the first sample that dips into
// something solid kills the shot. Using real heights makes the up/downhill
// cases fall out naturally: shooting uphill the rising ground eats the arc's
// clearance, shooting downhill the extra drop is free.
function groundH(x, y) {
  return (typeof REN !== "undefined" && REN && REN.groundLevel) ? REN.groundLevel(x, y) : 0;
}
// solid obstruction at tile (x,y) for a shot passing at absolute height h
function shotBlockedAt(x, y, h) {
  if (h <= groundH(x, y) + 0.05) return true; // hillside, terrace bank, crest
  const b = world.insideBuilding && world.insideBuilding(x, y);
  if (b) {
    // groundH on a building tile is already its flattened plinth tier
    const base = groundH(x, y);
    // an open door lets a flat shot through the doorway below the lintel
    const s = world.structAt && world.structAt(x, y);
    if (s && s.door && world.isDoorOpen(s.door.x, s.door.y)) return h > base + 1.25 && h <= base + world.buildingMeta(b).storeys * 1.8 + 0.8;
    return h <= base + world.buildingMeta(b).storeys * 1.8 + 0.8; // walls + roof ridge
  }
  const s = world.structAt && world.structAt(x, y);
  if (s && s.plug) return h <= groundH(x, y) + 2.4; // city-gate wall plugs
  if (s && s.door) return !world.isDoorOpen(s.door.x, s.door.y) && h <= groundH(x, y) + 1.6;
  // walled-city ring: wall tiles sit at Chebyshev distance R from the centre,
  // except the gate gap (|along| <= 2 mid-side) and water/bridge channels
  if (world.walledVillagesNear)
    for (const v of world.walledVillagesNear(x, y, 2)) {
      const dx = x - v.x, dy = y - v.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== v.R) continue;
      const corner = Math.abs(dx) === v.R && Math.abs(dy) === v.R;
      const along = Math.abs(dx) === v.R ? dy : dx;
      if (!corner && Math.abs(along) <= 2) continue;
      if (world.isWater(x, y)) continue;
      return h <= Math.max(groundH(v.x, v.y), groundH(x, y)) + 2.4;
    }
  return false;
}
// Flight profile for an arrow from the player to tile (tx,ty): absolute
// launch and impact heights (targetH above the landing tile's ground — body
// height for a strike, near-zero for an arrow thudding into the dirt), the
// parabola's mid-arc lift, and hitT — how far along (0..1) it gets before
// something solid stops it (1 = a clean line).
// Callers (2):
//  skills/combat.js (playerAttack, clearShot)
function arrowFlight(tx, ty, targetH = 0.7) {
  const fx = player.x, fy = player.y;
  const D = Math.hypot(tx - fx, ty - fy);
  const h0 = groundH(fx, fy) + (player.level | 0) * 1.8 + 1.1; // bow at shoulder height
  const h1 = groundH(tx, ty) + targetH;
  const peak = Math.max(0.3, D * 0.11); // longer shots loft higher
  const n = Math.max(2, Math.ceil(D * 3));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = Math.round(fx + (tx - fx) * t), y = Math.round(fy + (ty - fy) * t);
    if ((x === fx && y === fy) || (x === tx && y === ty)) continue;
    const h = h0 + (h1 - h0) * t + 4 * peak * t * (1 - t);
    if (shotBlockedAt(x, y, h)) return { h0, h1, peak, hitT: t };
  }
  return { h0, h1, peak, hitT: 1 };
}
function clearShot(mon) {
  // a flying bird is aimed at its altitude, not the ground under it
  return arrowFlight(mon.x, mon.y, 0.7 + (typeof birdAirY === "function" ? birdAirY(mon) : 0)).hitT >= 1;
}
// Where the monster will be when an arrow loosed now lands: replay its chase
// stepper (monStepToward's preference order and speeds, honouring
// mobPassable) for the flight's duration. A monster that isn't chasing is
// treated as standing still — the archer aims at what they can see.
// Callers (1):
//  skills/combat.js (playerAttack)
function predictMonPos(mon, flightMs) {
  // a bird on the wing flies a smooth continuous line, not tile steps: lead
  // it along its current air velocity (birdflight.js keeps vx/vy in tiles/s)
  if (mon.flight && mon.flight.mode === "air") {
    const t = flightMs / 1000;
    return { x: Math.round(mon.flight.fx + (mon.flight.vx || 0) * t),
             y: Math.round(mon.flight.fy + (mon.flight.vy || 0) * t) };
  }
  // a wanderer mid-step is led to where the stroll is taking it
  if (!mon.target || !mon.alive)
    return mon.moving ? { x: mon.moving.tx, y: mon.moving.ty } : { x: mon.x, y: mon.y };
  let x = mon.x, y = mon.y, ms = flightMs;
  if (mon.moving) { x = mon.moving.tx; y = mon.moving.ty; ms -= mon.moving.dur * (1 - mon.moving.t); }
  for (let step = 0; step < 24 && ms > 0; step++) {
    if (Math.max(Math.abs(x - player.x), Math.abs(y - player.y)) <= 1) break; // reaches melee, stops
    const dx = Math.sign(player.x - x), dy = Math.sign(player.y - y);
    let sx = 0, sy = 0;
    const ghost = { ...mon, x, y }; // mobPassable's climb check measures from the mob's tile
    for (const [cx2, cy2] of [[dx, dy], [dx, 0], [0, dy]]) {
      if (!cx2 && !cy2) continue;
      if (!mobPassable(ghost, x + cx2, y + cy2)) continue;
      if (cx2 && cy2 && (!mobPassable(ghost, x + cx2, y) || !mobPassable(ghost, x, y + cy2))) continue;
      sx = cx2; sy = cy2; break;
    }
    if (!sx && !sy) break; // stuck against terrain/water — it'll still be here
    const stepMs = sx && sy ? 400 : 285; // monMove speeds
    if (ms < stepMs * 0.5) break;        // barely into the next step by impact
    x += sx; y += sy; ms -= stepMs;
  }
  return { x, y };
}
// How many of a given rune id are currently loaded in the rune pouch
// (rune1..8 — see state.js's RUNE_SLOTS), 0 if none.
// Callers (2):
//  skills/combat.js:32,57
function runeSlotQty(id) {
  for (const sl of RUNE_SLOTS) if (player.equip[sl] && player.equip[sl].id === id) return player.equip[sl].qty;
  return 0;
}
// Callers (1):
//  skills/combat.js:57
function consumeRune(id) {
  for (const sl of RUNE_SLOTS) {
    if (player.equip[sl] && player.equip[sl].id === id) {
      player.equip[sl].qty -= 1;
      if (player.equip[sl].qty <= 0) player.equip[sl] = null;
      uiDirty = true;
      return;
    }
  }
}
// ---------- the Weave (magic combat) ----------
// Spells are SENTENCES. Every rune in the 32-tier ladder is a word with a
// grammatical role: a SUBSTANCE (what the spell is made of — each leaves
// its own mark on a landed hit), a VERB (how it's delivered — a distinct
// mechanic), a MODIFIER (an adverb that warps the whole cast) or a
// WILDCARD (becomes whatever the sentence lacks). Each cast beat draws the
// next rune from the pouch in slot order; at the weapon's `weave` capacity
// (wand 2, staff 3) the gathered words fuse and the sentence casts —
// "Fire Strike", "Frost Bind", "Twin Storm Burst". A sentence with no verb
// collapses into a weak raw surge: the mage's craft is loading a pouch
// that speaks well. Potency scales with rune tier, so the high ladder
// deepens the SAME vocabulary rather than replacing it.
const RUNE_MAGIC = [
  { k: "air",     role: "sub",  col: "#cfe8ff" }, // Air — shoves the target back
  { k: "strike",  role: "verb", col: "#f0e6ff" }, // Strike — hits harder
  { k: "water",   role: "sub",  col: "#4aa3ff" }, // Water — chills the limbs
  { k: "bind",    role: "verb", col: "#b9c8ff" }, // Bind — roots in place
  { k: "fire",    role: "sub",  col: "#ff8030" }, // Fire — sets burning
  { k: "stone",   role: "sub",  col: "#b58a4e" }, // Stone — staggers its next blow
  { k: "rend",    role: "verb", col: "#e0c8a0" }, // Rend — shreds armour
  { k: "veil",    role: "sub",  col: "#9fb4c8" }, // Veil — blinds (its blows go wide)
  { k: "drain",   role: "verb", col: "#d06080" }, // Drain — the damage heals you
  { k: "burst",   role: "verb", col: "#ffd75e" }, // Burst — spreads to nearby foes
  { k: "frost",   role: "sub",  col: "#bfeaff" }, // Frost — deep chill; holds a Bind longer
  { k: "lava",    role: "sub",  col: "#ff5a20" }, // Lava — burns AND staggers
  { k: "twin",    role: "mod",  col: "#ffe9a0" }, // Twin — the sentence casts twice
  { k: "storm",   role: "sub",  col: "#9fd0ff" }, // Storm — arcs to a second target
  { k: "echo",    role: "verb", col: "#c8b4ff" }, // Echo — it strikes again a beat later
  { k: "chaos",   role: "verb", col: "#ff70e0" }, // Chaos — wild power, wild mark
  { k: "bone",    role: "sub",  col: "#efe6d0" }, // Bone — brittles (takes more from everyone)
  { k: "law",     role: "verb", col: "#fff3c0" }, // Law — forbids retaliation
  { k: "light",   role: "sub",  col: "#ffffd0" }, // Light — exposes (you hit truer)
  { k: "shadow",  role: "verb", col: "#8a7aa8" }, // Shadow — the target flees
  { k: "death",   role: "verb", col: "#a0a8b0" }, // Death — executes the wounded
  { k: "blood",   role: "sub",  col: "#c03040" }, // Blood — a taste of it heals you
  { k: "soul",    role: "mod",  col: "#d0f0e8" }, // Soul — marks linger twice as long
  { k: "ward",    role: "verb", col: "#a8e0c0" }, // Ward — shields the caster
  { k: "spirit",  role: "sub",  col: "#e8f4ff" }, // Spirit — passes through armour
  { k: "war",     role: "mod",  col: "#ff9a60" }, // War — hastens the weave
  { k: "time",    role: "mod",  col: "#c0d8d0" }, // Time — the sentence recurs in full
  { k: "void",    role: "verb", col: "#605878" }, // Void — banishes it toward its spawn
  { k: "astral",  role: "mod",  col: "#e0d0ff" }, // Astral — cannot miss
  { k: "wrath",   role: "mod",  col: "#ff4030" }, // Wrath — half again as much power
  { k: "genesis", role: "wild", col: "#b0ffd0" }, // Genesis — becomes what the weave lacks
  { k: "eternity", role: "wild", col: "#f0f0ff" }, // Eternity — becomes what the weave lacks
];
let RUNE_TIER = null; // rune item id -> ladder index, built lazily from RUNES
function runeWord(id) {
  if (!RUNE_TIER) { RUNE_TIER = {}; RUNES.forEach((r, i) => { RUNE_TIER[r.id] = i; }); }
  const i = RUNE_TIER[id];
  return i === undefined ? null : { tier: i, name: RUNES[i].name, ...RUNE_MAGIC[i] };
}
// next occupied pouch slot after the last one drawn (cycling): the SLOT
// ORDER of the loadout defines the casting rotation
function drawWeaveRune() {
  const st = player.weave || (player.weave = { asp: [], pot: 0, slot: -1, hasteUntil: 0 });
  for (let k = 1; k <= RUNE_SLOTS.length; k++) {
    const idx = (st.slot + k) % RUNE_SLOTS.length;
    const s = player.equip[RUNE_SLOTS[idx]];
    if (s && runeWord(s.id)) { st.slot = idx; return s.id; }
  }
  return null;
}
// deferred spell effects — Echo re-strikes and Time recurrences, resolved
// alongside arrow impacts in tickArrows()
const spellEchoes = [];
// A completed sentence casts. Modifiers shape the whole thing (Twin doubles
// it, Time schedules a full recurrence); castOnce does one delivery.
// attacking gives a Vanished caster away (called by every style's strike;
// gather beats stay quiet, so a mage can weave the next sentence unseen)
function breakVanish() {
  if (player.unseenUntil && now < player.unseenUntil) player.unseenUntil = 0;
}
function castSentence(mon, w, words, pot) {
  sfx("spellcast", 0.6);
  const subs = words.filter(x => x.role === "sub");
  const verbs = words.filter(x => x.role === "verb");
  const mods = words.filter(x => x.role === "mod");
  for (const x of words.filter(x2 => x2.role === "wild")) {
    if (!verbs.length) verbs.push({ ...x, k: "strike" });      // it becomes the missing verb
    else if (!subs.length) subs.push({ ...x, k: "raw" });      // …or the missing substance
    else pot *= 1.5;                                           // …or pure amplification
  }
  const mod = k => mods.some(m2 => m2.k === k);
  if (!verbs.length) pot *= 0.7; // verbless: the weave collapses into a raw surge
  const durMult = mod("soul") ? 2 : 1;
  if (mod("wrath")) pot *= 1.6;
  if (mod("war")) player.weave.hasteUntil = now + 7000;
  // SECRET TECHNIQUES: certain word pairs transcend their parts entirely —
  // the sentence becomes a pure technique instead of an attack (no damage
  // roll; Soul still stretches durations, Wrath still feeds potency)
  const allW = [...subs, ...verbs, ...mods];
  const haveK = k => allW.some(x => x.k === k);
  for (const t of WEAVE_TECHNIQUES)
    if (haveK(t.a) && haveK(t.b)) {
      log(`${t.name}!`, "gold");
      if (t.name !== "Vanish") breakVanish(); // Vanishing is the one quiet cast
      castTechnique(t.name, mon, pot, durMult);
      return;
    }
  breakVanish();
  const casts = mod("twin") ? 2 : 1;
  const potEach = mod("twin") ? pot * 0.7 : pot;
  log(`${verbs.length ? [...mods, ...subs, ...verbs].map(x => x.name).join(" ") : "Raw Surge"}!`, "sys");
  for (let c = 0; c < casts; c++) castOnce(mon, w, subs, verbs, mods, potEach, durMult);
  if (mod("time"))
    spellEchoes.push({ at: now + 3000, mon, w, subs, verbs,
      mods: mods.filter(m2 => m2.k !== "time" && m2.k !== "twin" && m2.k !== "war"),
      pot: potEach, durMult, full: true });
}
function castOnce(mon, w, subs, verbs, mods, pot, durMult) {
  const has = k => verbs.some(v => v.k === k);
  if (has("chaos")) pot *= 0.5 + Math.random() * 2; // wild power
  if (has("ward")) {
    player.ward = { hp: 4 + Math.round(pot * 0.8), until: now + 12000 * durMult };
    addFloat("Warded", player.px, player.py - 44, "#a8e0c0", 13);
  }
  // a CHANTED sentence (gameplay/chant.js) can be spoken into empty air —
  // only its self-effects land; the rotation always has a target
  if (!mon || !mon.alive) return;
  const pierce = subs.some(s2 => s2.k === "spirit");
  const expose = mon.fx && now < mon.fx.exposeUntil ? 0.12 : 0;
  const mb = (ITEMS[w].magicPower || 0) + amuletBonus();
  // Spirit pierces armour: the target defends as if its def were 0
  const chance = mods.some(m2 => m2.k === "astral") ? 1 :
    Math.min(0.99, hitChance(combatRoll(eff("Magic"), mb),
      pierce ? combatRoll(0, 0) : monDefRoll(mon)) + expose);
  let mh = maxHitFor(eff("Magic"), mb) + Math.round(pot);
  if (has("strike")) mh = Math.round(mh * (1 + 0.3 * verbs.filter(v => v.k === "strike").length));
  if (has("bind")) mh = Math.round(mh * 0.8);
  if (has("ward")) mh = Math.round(mh * 0.5);
  if (has("void")) mh = Math.round(mh * 0.7);
  let dmg = Math.random() < chance ? Math.floor(Math.random() * (mh + 1)) : 0;
  if (has("death")) dmg = Math.round(dmg * (1 + Math.max(0, 1 - mon.hp / monMaxHp(mon.kind))));
  const landed = dmg > 0 || chance === 1;
  if (landed) {
    const fx = monFx(mon);
    if (has("bind")) fx.rootUntil = now + 2200 * durMult * (subs.some(s2 => s2.k === "frost") ? 1.5 : 1);
    if (has("rend")) { fx.sunderAmt = 3; fx.sunderUntil = now + 9000 * durMult; }
    if (has("law")) fx.pacifyUntil = now + 3500 * durMult;
    if (has("shadow")) fx.fleeUntil = now + 2500 * durMult;
    if (has("void")) monBanish(mon);
    for (const s2 of subs) applyRider(mon, fx, s2.k, dmg, durMult);
    if (has("chaos")) applyRider(mon, fx, ["air", "fire", "water", "stone"][Math.floor(Math.random() * 4)], dmg, durMult);
  }
  if (has("drain") && dmg > 0) healPlayer(Math.ceil(dmg * 0.5));
  if (has("echo") && dmg > 0) spellEchoes.push({ at: now + 1600, mon, dmgOnly: Math.ceil(dmg * 0.55) });
  if (has("burst"))
    for (const m2 of monsters) {
      if (m2 === mon || !m2.alive) continue;
      if (Math.max(Math.abs(m2.x - mon.x), Math.abs(m2.y - mon.y)) > 2) continue;
      dealSpellDamage(m2, Math.ceil(dmg * 0.6));
    }
  projectiles.push({ x0: player.px, y0: player.py, x1: mon.px, y1: mon.py, t0: now, dur: 260,
    kind: "spell", col: subs[0] ? subs[0].col : verbs[0] ? verbs[0].col : "#e8f4ff" });
  dealSpellDamage(mon, dmg);
}
// each substance leaves its own mark on a landed hit
function applyRider(mon, fx, k, dmg, durMult) {
  if (k === "air") monKnockback(mon, 2);
  else if (k === "water") { fx.chillUntil = now + 6000 * durMult; fx.chillPct = Math.max(fx.chillPct || 0, 1.0); }
  else if (k === "frost") { fx.chillUntil = now + 6000 * durMult; fx.chillPct = 1.8; }
  else if (k === "fire") { fx.burnDmg = Math.max(fx.burnDmg || 0, 1); fx.burnUntil = now + 4200 * durMult; fx.burnNextAt = fx.burnNextAt || now + 1000; }
  else if (k === "lava") { fx.burnDmg = Math.max(fx.burnDmg || 0, 2); fx.burnUntil = now + 4200 * durMult; fx.burnNextAt = fx.burnNextAt || now + 1000; mon.nextAtkAt = Math.max(mon.nextAtkAt || 0, now + 1000); }
  else if (k === "stone") mon.nextAtkAt = Math.max(mon.nextAtkAt || 0, now + 1800);
  else if (k === "veil") fx.blindUntil = now + 4500 * durMult;
  else if (k === "bone") fx.brittleUntil = now + 6000 * durMult;
  else if (k === "light") fx.exposeUntil = now + 6000 * durMult;
  else if (k === "blood") { if (dmg > 0) healPlayer(Math.ceil(dmg * 0.25)); }
  else if (k === "storm") {
    let best = null, bd = 9;
    for (const m2 of monsters) {
      if (m2 === mon || !m2.alive) continue;
      const d = Math.max(Math.abs(m2.x - mon.x), Math.abs(m2.y - mon.y));
      if (d <= 3 && d < bd) { bd = d; best = m2; }
    }
    if (best) {
      projectiles.push({ x0: mon.px, y0: mon.py, x1: best.px, y1: best.py, t0: now, dur: 180, kind: "spell", col: "#9fd0ff" });
      dealSpellDamage(best, Math.ceil(dmg * 0.5));
    }
  }
  // "spirit" pierces in the chance roll; "raw" (a wildcard substance) marks nothing
}
function dealSpellDamage(mon, dmg) {
  if (monInvuln(mon)) { addSplat(mon, 0); return; } // sealed in Stasis
  if (mon.fx && now < mon.fx.brittleUntil) dmg = Math.round(dmg * 1.25);
  dmg = Math.min(dmg, Math.max(0, mon.hp)); // fatal blow shows what was left, not overkill
  mon.hp -= dmg;
  mon.target = player;
  mon.hitAt = now;
  addSplat(mon, dmg);
  if (dmg > 0) { addXp("Magic", dmg * 4); addXp("Health", dmg * 1.3); }
  if (mon.hp <= 0) killMonster(mon);
}
function healPlayer(n) {
  if (player.hp >= maxHp()) return;
  player.hp = Math.min(maxHp(), player.hp + n);
  addFloat("+" + n, player.px, player.py - 40, "#8ff08f", 12);
  uiDirty = true;
}
// ---------- secret techniques ----------
// Word pairs that resolve as pure techniques, not attacks. Kept as an
// unordered-pair table so new discoveries slot in one line each. First
// match wins; modifiers can be half of a pair too (Soul, Time).
const WEAVE_TECHNIQUES = [
  { a: "air",    b: "void",   name: "Rift Hurl" },     // the target reappears ~10 tiles away
  { a: "stone",  b: "bind",   name: "Petrify" },       // full stun: no moving AND no striking
  { a: "veil",   b: "shadow", name: "Vanish" },        // the caster becomes unseen
  { a: "spirit", b: "air",    name: "Transposition" }, // you and the target swap places
  { a: "water",  b: "drain",  name: "Undertow" },      // the current drags it to your feet
  { a: "law",    b: "ward",   name: "Sanctum" },       // everything hunting you is forbidden to strike
  { a: "shadow", b: "burst",  name: "Rout" },          // the target and its packmates flee
  { a: "blood",  b: "soul",   name: "Soul Tithe" },    // slow self-regeneration
  { a: "storm",  b: "echo",   name: "Thunderhead" },   // a storm gathers; later it breaks over them all
  { a: "time",   b: "bind",   name: "Stasis" },        // frozen outside time: can't act, can't be hurt
];
function castTechnique(name, mon, pot, durMult) {
  if (name === "Rift Hurl") {
    // tear a rift: the target vanishes and reappears ~10 tiles from the
    // caster, on ground it could actually stand on (its own biome, its own
    // element, no walls/buildings/other monsters). No clean rift → the old
    // Void hurl as a fallback.
    for (let i = 0; i < 40; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = 9 + Math.floor(Math.random() * 4);
      const x = player.x + Math.round(Math.cos(ang) * rr), y = player.y + Math.round(Math.sin(ang) * rr);
      if (world.isBlocked(x, y)) continue;
      if (world.isWater(x, y) !== !!mon.canSwim) continue;
      if (world.insideBuilding && world.insideBuilding(x, y)) continue;
      const s = world.structAt && world.structAt(x, y);
      if (s && (s.plug || s.door)) continue;
      if (mon.spawnBiome !== undefined && world.biomeAt(x, y) !== mon.spawnBiome) continue;
      if (monsterAt(x, y)) continue;
      mon.x = x; mon.y = y; mon.px = PX(x); mon.py = PX(y);
      mon.moving = null;
      mon.target = player; mon.hitAt = now;
      addFloat("Rifted", mon.px, mon.py - 30, "#605878", 13);
      return;
    }
    monBanish(mon);
  } else if (name === "Petrify") {
    const fx = monFx(mon);
    fx.stunUntil = now + Math.round((1800 + pot * 120) * durMult);
    mon.target = player; mon.hitAt = now;
    addFloat("Petrified", mon.px, mon.py - 30, "#b58a4e", 13);
  } else if (name === "Vanish") {
    // unseen: every hunter loses you, and nothing re-acquires you until it
    // wears off — or until your next attack gives you away (breakVanish)
    player.unseenUntil = now + Math.round(5000 * durMult);
    for (const m2 of monsters) if (m2.target === player) m2.target = null;
    addFloat("Vanished", player.px, player.py - 44, "#8a7aa8", 13);
  } else if (name === "Transposition") {
    // you and the target trade places — escape a corner, or feed a melee
    // monster to the far side of a river. Only if each can stand where the
    // other was (a land monster can't take your place in the shallows).
    if (world.isWater(player.x, player.y) === !!mon.canSwim && !mon.moving) {
      const mx = mon.x, my = mon.y;
      mon.x = player.x; mon.y = player.y; mon.px = PX(mon.x); mon.py = PX(mon.y);
      player.x = mx; player.y = my; player.px = PX(mx); player.py = PX(my);
      player.moving = null; player.path = [];
      mon.target = player; mon.hitAt = now;
      addFloat("Transposed", player.px, player.py - 44, "#e8f4ff", 13);
    } else addFloat("...fizzle", player.px, player.py - 44, "#9fb4c8", 12);
  } else if (name === "Undertow") {
    // the current drags the target to your feet (the dagger-mage's friend)
    let x = mon.x, y = mon.y;
    for (let i = 0; i < 12; i++) {
      const dx = Math.sign(player.x - x), dy = Math.sign(player.y - y);
      if (Math.max(Math.abs(x - player.x), Math.abs(y - player.y)) <= 1) break;
      const nx = x + dx, ny = y + dy;
      if ((nx === player.x && ny === player.y) || !mobPassable({ ...mon, x, y }, nx, ny)) break;
      x = nx; y = ny;
    }
    if (x !== mon.x || y !== mon.y)
      mon.moving = { fx: mon.x, fy: mon.y, tx: x, ty: y, t: 0, dur: 80 * Math.max(Math.abs(x - mon.x), Math.abs(y - mon.y)) };
    const fx = monFx(mon);
    fx.chillUntil = now + 5000 * durMult; fx.chillPct = Math.max(fx.chillPct || 0, 1.0);
    mon.target = player; mon.hitAt = now;
  } else if (name === "Sanctum") {
    // Law spread wide: everything hunting you within reach is forbidden to
    // strike — they can surround you, but no blow may land
    for (const m2 of monsters) {
      if (!m2.alive || m2.target !== player) continue;
      if (Math.max(Math.abs(m2.x - player.x), Math.abs(m2.y - player.y)) > 6) continue;
      monFx(m2).pacifyUntil = now + 5000 * durMult;
    }
    addFloat("Sanctum", player.px, player.py - 44, "#fff3c0", 13);
  } else if (name === "Rout") {
    // dread spreads through the pack: the target and everything near it runs
    for (const m2 of monsters) {
      if (!m2.alive) continue;
      if (m2 !== mon && Math.max(Math.abs(m2.x - mon.x), Math.abs(m2.y - mon.y)) > 3) continue;
      monFx(m2).fleeUntil = now + 2800 * durMult;
      m2.target = player; m2.hitAt = now;
    }
  } else if (name === "Soul Tithe") {
    // a slow tithe of vitality: regeneration, no target required to profit
    player.titheUntil = now + Math.round(9000 * durMult);
    player.titheNextAt = now + 1500;
    addFloat("Soul Tithe", player.px, player.py - 44, "#d0f0e8", 13);
  } else if (name === "Thunderhead") {
    // a storm gathers over the target; when it breaks, everything near it
    // is struck at once — a placeable, delayed bomb
    spellEchoes.push({ at: now + 2500, mon, kind: "thunderhead",
      pot: Math.round(3 + pot + eff("Magic") / 4) });
    addFloat("A storm gathers…", mon.px, mon.py - 30, "#9fd0ff", 12);
  } else if (name === "Stasis") {
    // sealed outside time: it cannot act — and cannot be touched
    const fx = monFx(mon);
    fx.stunUntil = now + Math.round(4000 * durMult);
    fx.stasisUntil = fx.stunUntil;
    mon.target = player; mon.hitAt = now;
    addFloat("Stasis", mon.px, mon.py - 30, "#c0d8d0", 13);
  }
}
// a monster sealed in Stasis can't be hurt by anything
function monInvuln(mon) { return !!(mon.fx && now < mon.fx.stasisUntil); }
// Void: hurled back toward its home, shaken loose of the fight
function monBanish(mon) {
  let x = mon.x, y = mon.y;
  for (let i = 0; i < 10; i++) {
    const nx = x + Math.sign(mon.sx - x), ny = y + Math.sign(mon.sy - y);
    if (nx === x && ny === y) break;
    if (!mobPassable({ ...mon, x, y }, nx, ny)) break;
    x = nx; y = ny;
  }
  if (x === mon.x && y === mon.y) return;
  mon.moving = { fx: mon.x, fy: mon.y, tx: x, ty: y, t: 0, dur: 90 * Math.max(Math.abs(x - mon.x), Math.abs(y - mon.y)) };
  mon.target = null;
}
// the monster's defence after any active sunder (earth aspect) — used by
// EVERY combat style, so a mage shredding armour helps the whole fight.
// Authored def values live on the OLD 1-99 stat scale (def ≈ 0.8×oldLvl, up
// to ~76) while player skills cap at MAX_LEVEL (32) — compare them raw and
// every monster past mid-tier pins the hit-chance clamp's floor, so a level
// 13 and a level 32 fighter land blows at the same rate. Scale def onto the
// player's ladder here, at the one choke point all three styles share.
// Callers: monDefRoll (the defence roll every style's accuracy opposes)
function monDef(mon) {
  const base = Math.round(MONSTERS[mon.kind].def * LEVEL_SCALE);
  const fx = mon.fx;
  return Math.max(0, base - (fx && now < fx.sunderUntil ? fx.sunderAmt : 0));
}
// ---------- RuneScape-style combat rolls, rescaled to the 32 ladder ----------
// RS: effective level = lvl+8; attack/defence roll = effLvl*(bonus+64);
// max hit = floor(0.5 + effStr*(strBonus+64)/640); hit chance =
// atk>def ? 1-(def+2)/(2*(atk+1)) : atk/(2*(def+1)). Rescaled ×32/99:
// the +8 effective-level bump → +3; the 64 equipment pivot → 16 (Taiao
// gear bonuses run 0..~30 where RS's run 0..~120); the 640 max-hit divisor
// → 40, tuned so a maxed fighter's ~35 max hit suits monster hp (which stays
// authored on the old 1-99 stat scale). Melee is this game's Attack: it
// drives the roll to LAND a blow; Strength drives the max hit. Archery and
// Magic each play both roles for their own style, as in RS.
function combatRoll(lvl, bonus) { return (lvl + 3) * (bonus + 16); }
function monDefRoll(mon) { return combatRoll(monDef(mon), 0); }
function hitChance(atk, def) {
  return atk > def ? 1 - (def + 2) / (2 * (atk + 1)) : atk / (2 * (def + 1));
}
function maxHitFor(lvl, bonus) { return Math.max(1, Math.floor(0.5 + combatRoll(lvl, bonus) / 40)); }
function monFx(mon) { return mon.fx || (mon.fx = {}); }
// shove the monster directly away from the player, stopping at anything it
// couldn't legally walk through (its own passability rules)
function monKnockback(mon, tiles) {
  const dx = Math.sign(mon.x - player.x), dy = Math.sign(mon.y - player.y);
  if (!dx && !dy) return;
  let x = mon.x, y = mon.y;
  for (let i = 0; i < tiles; i++) {
    const nx = x + dx, ny = y + dy;
    if (!mobPassable({ ...mon, x, y }, nx, ny)) break;
    x = nx; y = ny;
  }
  if (x === mon.x && y === mon.y) return;
  const d = Math.max(Math.abs(x - mon.x), Math.abs(y - mon.y));
  mon.moving = { fx: mon.x, fy: mon.y, tx: x, ty: y, t: 0, dur: 110 * d }; // a fast shove, not a walk
}

// Callers (1):
//  skills/combat.js:131
function playerAttack(mon) {
  let style = combatStyle();
  const def = MONSTERS[mon.kind];
  const dist = Math.max(Math.abs(mon.x - player.x), Math.abs(mon.y - player.y));
  // an adjacent enemy forces the archer or mage onto their sidearm: with an
  // offhand dagger ready the attack drops the bow/wand for the blade this
  // swing (a mage without one weaves on regardless — Gale Slams answer
  // crowding their own way)
  // a bird on the wing (or up a roof/canopy) is beyond any blade — only a
  // shot can reach it, so the crowded-archer sidearm switch stays holstered
  const airborne = typeof birdAirborne === "function" && birdAirborne(mon);
  let offhand = null;
  if (style !== "melee" && dist <= 1 && !airborne && (offhand = offhandWeapon())) style = "melee";
  let maxHit, chance, atkMs;
  if (style === "archery") {
    const w = player.equip.weapon;
    const bp = w ? (ITEMS[w].bowPower || 0) : 0;
    if (!w || !ITEMS[w].bowPower) { log("You need a bow equipped to use archery.", "warn"); player.act = null; return; }
    const quiver = player.equip.quiver;
    if (!quiver) {
      // Yuki's koreke lesson (gameplay/tutorial.js): running dry mid-hunt
      // shouldn't stall the goal — she resupplies instead of a hard stop
      if (typeof Tutorial !== "undefined" && Tutorial.onOutOfArrows && Tutorial.onOutOfArrows()) return;
      log("You're out of arrows! Load some into your quiver.", "warn"); player.act = null; return;
    }
    const arrow = quiver.id;
    quiver.qty -= 1;
    if (quiver.qty <= 0) player.equip.quiver = null;
    uiDirty = true;
    atkMs = ITEMS[w].atkTick || 1700;
    // The archer aims at where the target WILL be, not where it is: predict
    // the monster's chase path over the arrow's flight time and loose at
    // that tile (two passes, since the aim point changes the flight time).
    // The arrow is committed once loosed — nothing steers it in the air.
    let flight = 100 + dist * 35;
    let aim = predictMonPos(mon, flight);
    let aimDist = Math.max(1, Math.max(Math.abs(aim.x - player.x), Math.abs(aim.y - player.y)));
    flight = 100 + aimDist * 35;
    aim = predictMonPos(mon, flight);
    aimDist = Math.max(1, Math.max(Math.abs(aim.x - player.x), Math.abs(aim.y - player.y)));
    // Inside the bow's sweet spot (half its range) a shot flies flat and
    // hard; past it the arc steepens and the arrow sheds speed, so both the
    // chance to hit and the damage bleed off toward maximum reach. The
    // monster's toughness (def) opposes the bow's roll RS-style (monDefRoll).
    // Leading a MOVING target is its own skill: an extra penalty that
    // Archery level trains away (~25% at level 1, gone by the high 20s).
    const range = ITEMS[w].range || 8;
    const sweet = Math.ceil(range / 2);
    const far = Math.max(0, aimDist - sweet);
    const leading = aim.x !== mon.x || aim.y !== mon.y;
    const leadPen = leading ? Math.max(0, 0.25 - eff("Archery") * 0.008) : 0;
    // RS ranged split: the bow is the accuracy bonus, the arrow the ranged-
    // strength bonus (it rides the max hit, with the bow's power on top)
    chance = Math.min(0.99, Math.max(0.05,
      hitChance(combatRoll(eff("Archery"), bp + amuletBonus()), monDefRoll(mon))
      - far * 0.05 - leadPen
      + (mon.fx && now < mon.fx.exposeUntil ? 0.12 : 0))); // Light-exposed
    maxHit = maxHitFor(eff("Archery"), bp + ITEMS[arrow].arrowPower + amuletBonus());
    maxHit = Math.max(1, Math.round(maxHit * (1 - 0.45 * far / Math.max(1, range - sweet))));
    const hit = Math.random() < chance;
    const dmg = hit ? Math.floor(Math.random() * (maxHit + 1)) : 0;
    // A successful shot flies to the predicted tile (body height); a failed
    // prediction visibly lands SHORT — in the dirt where the target was when
    // the string was loosed (under-led), or scattered beside a standing one.
    let land = aim;
    if (!hit) {
      if (leading) land = { x: mon.x, y: mon.y };
      else {
        const sc = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]][Math.floor(Math.random() * 8)];
        land = { x: mon.x + sc[0], y: mon.y + sc[1] };
      }
    }
    const fl = arrowFlight(land.x, land.y,
      hit ? 0.7 + (typeof birdAirY === "function" ? birdAirY(mon) : 0) : 0.15);
    flight = 100 + Math.max(1, Math.max(Math.abs(land.x - player.x), Math.abs(land.y - player.y))) * 35;
    // damage, aggro, XP and the kill all resolve when the arrow LANDS
    // (tickArrows) — an arc into a wall (hitT < 1) hurts nothing
    breakVanish(); // loosing an arrow gives a Vanished archer away
    sfx("bow", 0.7);
    projectiles.push({ x0: player.px, y0: player.py, x1: PX(land.x), y1: PX(land.y), t0: now,
      dur: flight, stick: 900, kind: "arrow", mon, dmg: fl.hitT < 1 ? 0 : dmg,
      lx: land.x, ly: land.y, h0: fl.h0, h1: fl.h1, peak: fl.peak, hitT: fl.hitT });
    player.nextAtkAt = now + atkMs;
    player.lungeT = now;
    player.lungeDir = [Math.sign(land.x - player.x), Math.sign(land.y - player.y)];
    player.facing = PX(land.x) >= player.px ? 1 : -1;
    return;
  } else if (style === "magic") {
    const w = player.equip.weapon;
    const rid = drawWeaveRune();
    if (!rid) { log("Your rune pouch is empty — the weave falters.", "warn"); player.act = null; return; }
    const word = runeWord(rid);
    consumeRune(rid);
    const st = player.weave;
    st.asp.push(word);
    st.pot += 1 + word.tier * 0.4; // higher-tier words carry more potency
    // War-hastened weaves gather and cast at half again the pace
    const haste = st.hasteUntil && now < st.hasteUntil ? 0.6 : 1;
    const castMs = Math.round((ITEMS[w].atkTick || 1700) * haste);
    const cap = ITEMS[w].weave || 2;
    if (st.asp.length < cap) {
      // a GATHERING beat: the word joins the orbit, no strike yet
      sfx("spellword", 0.5);
      addFloat("+ " + word.name, player.px, player.py - 34, word.col, 12);
      player.nextAtkAt = now + Math.round(castMs * 0.55); // gathering is quicker than loosing
      player.lungeT = now;
      player.facing = mon.px >= player.px ? 1 : -1;
      uiDirty = true;
      return;
    }
    // the sentence is complete — cast it
    const words = st.asp, pot = st.pot;
    st.asp = []; st.pot = 0;
    castSentence(mon, w, words, pot);
    player.nextAtkAt = now + castMs;
    player.lungeT = now;
    player.lungeDir = [Math.sign(mon.x - player.x), Math.sign(mon.y - player.y)];
    player.facing = mon.px >= player.px ? 1 : -1;
    uiDirty = true;
    return;
  } else {
    if (airborne) {
      log(`The ${def.name} is on the wing — only an arrow can reach it.`, "warn");
      player.act = null;
      return;
    }
    // the offhand dagger strikes when an archer is crowded; otherwise the
    // main-hand weapon (or bare fists) as always
    const wid = offhand || player.equip.weapon;
    const wp = wid ? (ITEMS[wid].power || 0) : 0;
    // RS split: Melee (this game's Attack) rolls to land the blow against
    // the monster's defence roll; Strength alone sets how hard it can land
    chance = hitChance(combatRoll(eff("Melee"), wp + amuletBonus()), monDefRoll(mon));
    maxHit = maxHitFor(eff("Strength"), wp + amuletBonus());
    // the weapon sets the swing cadence (geartiers atkTick: light blades
    // fast, heavy iron slow); bare fists and un-ticked relics swing at 1500
    atkMs = (wid && ITEMS[wid].atkTick) || 1500;
  }
  // melee resolves instantly (archery and magic returned above — an arrow's
  // damage lands with the arrow, in tickArrows)
  player.nextAtkAt = now + atkMs;
  player.lungeT = now;
  player.lungeDir = [Math.sign(mon.x - player.x), Math.sign(mon.y - player.y)];
  player.facing = mon.px >= player.px ? 1 : -1;
  // Light-exposed targets are easier to hit truly; Bone-brittled take more
  const xpo = mon.fx && now < mon.fx.exposeUntil ? 0.12 : 0;
  chance = Math.min(0.99, chance + xpo);
  let dmg = Math.random() < chance ? Math.floor(Math.random() * (maxHit + 1)) : 0;
  if (dmg > 0 && mon.fx && now < mon.fx.brittleUntil) dmg = Math.round(dmg * 1.25);
  if (monInvuln(mon)) dmg = 0; // sealed in Stasis
  dmg = Math.min(dmg, Math.max(0, mon.hp)); // fatal blow shows what was left, not overkill
  breakVanish();
  mon.hp -= dmg;
  mon.target = player;
  mon.hitAt = now; // refreshes the chase leash (monsters.js): a hunted monster keeps hunting
  addSplat(mon, dmg);
  sfx(dmg > 0 ? "hit" : "swing", dmg > 0 ? 0.7 : 0.5);
  if (dmg > 0) {
    if (typeof monsterStinkFlavour === "function") window.__combatStinkFlavour = monsterStinkFlavour(mon);
    if (style === "melee") { addXp("Melee", dmg * 2); addXp("Strength", dmg * 2); }
    else addXp("Magic", dmg * 4);
    addXp("Health", dmg * 1.3);
  }
  if (mon.hp <= 0) killMonster(mon);
}

// Arrow impacts: called every frame (gameplay/world.js, just before the
// projectile prune). A shot resolves when its arc completes — damage, the
// splat, aggro and the kill all land WITH the arrow, so the first shot at a
// grazing monster strikes before it ever knows an archer exists, and only
// then does it charge. Even a near miss (thudding into the dirt beside it)
// tells the monster where the archer stands — and keeps the chase leash
// fresh while it's under fire.
// Callers (1):
//  gameplay/world.js
function tickArrows() {
  for (const p of projectiles) {
    if (p.kind !== "arrow" || p.done || p.dmg === undefined) continue;
    if (now - p.t0 < p.dur * (p.hitT !== undefined ? p.hitT : 1)) continue;
    p.done = true;
    const mon = p.mon;
    if (!mon || !mon.alive) continue; // target died to an earlier arrow
    const near = Math.max(Math.abs(p.lx - mon.x), Math.abs(p.ly - mon.y)) <= 4;
    // A flying bird must NOT be scared off by a MISS: birdflight.js flushes any
    // flier that holds a target, so a near-miss used to send the bird flapping
    // away even though the arrow landed in the dirt beside it (the reported bug).
    // Only a real HIT sets a flier's target now. Ground monsters keep the old
    // behaviour: a calm one is alerted by a hit or a close near-miss, and one
    // already in the chase (mon.target === player) stays alerted by any arrow.
    const flier = typeof birdCfg === "function" && !!birdCfg(mon);
    if (p.dmg > 0 || (!flier && (near || mon.target === player))) { mon.target = player; mon.hitAt = now; }
    if (p.dmg <= 0) sfx("arrowmiss", 0.45);
    if (p.dmg > 0 && monInvuln(mon)) { addSplat(mon, 0); sfx("arrowmiss", 0.45); continue; } // arrows shatter on Stasis
    if (p.dmg > 0) {
      let ad = p.dmg;
      if (mon.fx && now < mon.fx.brittleUntil) ad = Math.round(ad * 1.25); // Bone-brittled
      ad = Math.min(ad, Math.max(0, mon.hp)); // fatal arrow shows what was left, not overkill
      mon.hp -= ad;
      addSplat(mon, ad);
      sfx("arrowhit", 0.6);
      addXp("Archery", ad * 4);
      addXp("Health", ad * 1.3);
      if (mon.hp <= 0) killMonster(mon);
    }
  }
  // deferred spellwork: Echo re-strikes, Time recurrences, Thunderheads
  for (let i = spellEchoes.length - 1; i >= 0; i--) {
    const e = spellEchoes[i];
    if (now < e.at) continue;
    spellEchoes.splice(i, 1);
    if (!e.mon || !e.mon.alive) continue;
    if (e.kind === "thunderhead") {
      // the storm breaks over wherever the target now stands
      for (const m2 of monsters) {
        if (!m2.alive) continue;
        if (m2 !== e.mon && Math.max(Math.abs(m2.x - e.mon.x), Math.abs(m2.y - e.mon.y)) > 3) continue;
        projectiles.push({ x0: m2.px, y0: m2.py - 90, x1: m2.px, y1: m2.py, t0: now, dur: 160, kind: "spell", col: "#9fd0ff" });
        dealSpellDamage(m2, e.pot);
      }
    }
    else if (e.full) castOnce(e.mon, e.w, e.subs, e.verbs, e.mods, e.pot, e.durMult);
    else dealSpellDamage(e.mon, e.dmgOnly);
  }
  // Soul Tithe: a slow trickle of vitality back to the caster
  if (player.titheUntil && now < player.titheUntil && now >= (player.titheNextAt || 0)) {
    player.titheNextAt = now + 1500;
    healPlayer(1);
  }
}

// Callers (1):
//  skills/combat.js:69
function killMonster(mon) {
  const def = MONSTERS[mon.kind];
  mon.alive = false;
  sfx("kill", 0.8);
  mon.target = null;
  // bestiary: record the slaying so this creature is revealed in the bestiary
  if (!player.kills) player.kills = {};
  const firstOfKind = !player.kills[mon.kind];
  player.kills[mon.kind] = (player.kills[mon.kind] || 0) + 1;
  // a species' first fall is a discovery, not just a kill — the bestiary
  // used to unlock silently; now the moment is named while it's happening
  if (firstOfKind) {
    const seen = Object.keys(player.kills).length;
    log(`First ${(typeof monName === "function" ? monName(mon) : def.name)} — bestiary page ${seen} (press B).`, "gold");
    sfx("quest", 0.35);
  }
  if (typeof Quests !== "undefined") Quests.onKill(mon.kind);   // quest slay objectives
  if (typeof Lua !== "undefined" && Lua.ready) Lua.onKill(mon.kind); // Lua on_kill event triggers (js/lua)
  if (typeof Tutorial !== "undefined" && Tutorial.onKill) Tutorial.onKill(mon.kind); // isle stage task
  // Monsters respawn on the same level-based curve as resource nodes
  // (data.js respawnFor): lvl1 ~7s … lvl32 5min, keyed on the monster's
  // combat level. Falls back to the def's own respawn if the curve or level
  // is unavailable. This supersedes every per-monster `respawn` value.
  mon.respawnAt = now + ((typeof respawnFor === "function" && def.lvl != null) ? respawnFor(def.lvl) : def.respawn);
  const style = player.style;
  if (typeof monsterStinkFlavour === "function") window.__combatStinkFlavour = monsterStinkFlavour(mon);
  if (style === "melee") { addXp("Melee", def.xp * 0.35); addXp("Strength", def.xp * 0.35); }
  else if (style === "archery") addXp("Archery", def.xp * 0.7);
  else addXp("Magic", def.xp * 0.7);
  addXp("Health", def.xp * 0.3);
  log(`You have defeated the ${(typeof monName === "function" ? monName(mon) : def.name)}!`, "sys");
  // Butcher yield drops automatically now (no carcass / Butchering skill):
  // the beast's meat plus its OWN specific hide type (never a generic hide).
  const b = def.butcher;
  const gm = /_v$/.test(mon.kind) ? 2 : 1; // a giant ("_v") beast yields double when butchered
  if (b) {
    if (b.meat) dropOnGround(b.item || "raw_meat", b.meat * gm, mon.x, mon.y);
    if (b.hide && b.hideItem) dropOnGround(b.hideItem, b.hide * gm, mon.x, mon.y);
  }
  // rank-bearing rolls come from server-issued seeds when logged in
  // (js/net/seedroll.js) — a drop-in Math.random elsewhere
  const roll = typeof SeedRoll !== "undefined" ? SeedRoll.random : Math.random;
  for (const d of def.drops) {
    if (roll() < d.ch) {
      const q = (d.min + Math.floor(roll() * (d.max - d.min + 1))) * gm;
      // the plain `gem` drop is folded into the tiered system → a rough gem
      const id = (d.id === "gem" && typeof rollGemId === "function") ? rollGemId() : d.id;
      dropOnGround(id, q, mon.x, mon.y);
    }
  }
  if (player.act && player.act.kind === "combat" && player.act.mon === mon) player.act = null;
}

// Callers (1):
//  gameplay/monsters.js:33
function monsterAttack(mon) {
  if (player.dying) return; // no beating the corpse during the death linger
  const def = MONSTERS[mon.kind];
  const mfx = mon.fx;
  // Law forbids the blow; Petrify freezes it mid-swing
  if (mfx && (now < mfx.pacifyUntil || now < mfx.stunUntil)) { mon.nextAtkAt = now + 700; return; }
  mon.nextAtkAt = now + def.atkTick;
  mon.lungeT = now;
  // RS-style contest: the monster's (scaled) level is its Attack; the
  // player's defence roll is Defence level × armour, RS-fashion. The armour
  // block fraction (0..~0.8 across every worn piece + shield) maps onto the
  // equipment-pivot scale ×64: a full set of your own tier (~0.4 block)
  // roughly triples the naked roll, a top plate-and-tower loadout (~0.8 →
  // +51 vs the 16 pivot) quintuples it — the same way rune-through-godwars
  // gear scales defence rolls in RS. Armour works ONLY through this roll
  // (you get hit LESS, not softer): the old flat soak existed to keep plate
  // relevant past the old dodge floor, which no longer exists. The monster's
  // max hit is compressed to the 32 ladder (monMaxHit) like its hp/def.
  let chance = Math.max(0.05, hitChance(combatRoll(def.lvl, 0),
    combatRoll(eff("Defence"), Math.round(blockTotal() * 64))));
  if (mfx && now < mfx.blindUntil) chance *= 0.4; // veiled eyes swing wide
  let dmg = Math.random() < chance ? Math.floor(Math.random() * (monMaxHit(mon.kind) + 1)) : 0;
  // an active Ward (magic verb) soaks the hit before flesh does
  if (dmg > 0 && player.ward && now < player.ward.until && player.ward.hp > 0) {
    const ab = Math.min(dmg, player.ward.hp);
    player.ward.hp -= ab;
    dmg -= ab;
  }
  // per-character toughness (character-stats.js): stouter/armoured races soak a
  // fraction of the damage that gets through armour and wards.
  if (dmg > 0 && typeof charToughness === "function") dmg = Math.max(0, Math.round(dmg * (1 - charToughness())));
  dmg = Math.min(dmg, Math.max(0, player.hp)); // fatal blow shows the HP you had left, not overkill
  player.hp -= dmg;
  addSplat(player, dmg);
  sfx(dmg > 0 ? "hurt" : "swing", dmg > 0 ? 0.7 : 0.3);
  // Defence stink (blood) also depends on what's hitting you — a slime's blow
  // leaves you slimed/sweaty, not bloodied.
  if (typeof monsterStinkFlavour === "function") window.__combatStinkFlavour = monsterStinkFlavour(mon);
  addXp("Defence", dmg * 3 + 1);
  uiDirty = true;
  if (player.hp <= 0) playerDie(def.name);
}

// How long the corpse (and the killing blow's hitsplat, which fades over
// 900ms) stays on screen before the respawn teleport to town.
const DEATH_LINGER = 1200;

// Callers (3):
//  skills/combat.js:843 gameplay/movement.js:52,78
// Two-phase death: this freezes the player at 0 HP so the killing blow is
// actually seen landing; tickPlayerDying (stepPlayer) does the respawn after
// DEATH_LINGER ms.
function playerDie(by) {
  if (player.dying) return; // already down — don't restart the linger
  // split selves (gameplay/split.js): the ACTIVE body's death collapses the
  // whole split — every echo dies with it, and the one who wakes carries the
  // recombined xp. (A ghost's own death is absorbed by Split.tick instead.)
  if (typeof Split !== "undefined") Split.onDeath();
  player.dying = { at: now, by };
  player.hp = 0;
  sfx("die", 0.8);
  log(`Oh dear, you were slain by the ${by}!`, "warn");
  cancelAction();
  player.path = [];
  player.forced = null;
  player.sailing = null;
  player.moving = null;
  for (const m of monsters) if (m.target === player) { m.target = null; m.hp = monMaxHp(m.kind); }
  uiDirty = true;
}

// Callers (1):
//  gameplay/movement.js (stepPlayer, every frame while player.dying)
function tickPlayerDying() {
  if (now - player.dying.at < DEATH_LINGER) return;
  player.dying = null;
  player.hp = maxHp();
  player.act = null; // drop anything clicked mid-linger
  player.path = [];
  player.goal = null;
  const s = respawnTile();
  log(player.respawn ? `You wake up by the fountain in ${player.respawn.name}.` : "You wake up back in town.", "sys");
  player.x = s.x; player.y = s.y; player.px = PX(s.x); player.py = PX(s.y);
  player.moving = null;
  uiDirty = true;
}

// Where death sends the player: the chosen respawn city's fountain (nearest
// open tile beside it — the fountain tile itself is blocked decor), or
// Newhaven's playerStart when none is set. Forces the chunk in first so
// passable() reads real collision, not void.
function respawnTile() {
  const r = player.respawn;
  if (!r || typeof r.x !== "number") return world.playerStart;
  world.getChunk(Math.floor(r.x / world.CHUNK), Math.floor(r.y / world.CHUNK));
  for (let d = 1; d <= 4; d++)
    for (let dy = -d; dy <= d; dy++)
      for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue; // ring only
        if (passable(r.x + dx, r.y + dy)) return { x: r.x + dx, y: r.y + dy };
      }
  return world.playerStart; // fountain somehow walled in — fall back safe
}

// Right-click "Set respawn point" on a city plaza fountain (input.js decor
// menu). The fountain sits at the walled city's exact centre, so the nearest
// walled village names the city.
function setRespawnAt(x, y) {
  let best = null, bd = Infinity;
  for (const v of (world.walledVillagesNear ? world.walledVillagesNear(x, y, 40) : [])) {
    const d = (v.x - x) * (v.x - x) + (v.y - y) * (v.y - y);
    if (d < bd) { bd = d; best = v; }
  }
  const name = (best && best.name) || "this city";
  player.respawn = { x, y, name };
  log(`Respawn point set — when slain, you'll wake by the fountain in ${name}.`, "sys");
  saveGame();
}

// Callers (1):
//  gameplay/actions.js:8
function tickCombat(act) {
  const mon = act.mon;
  if (!mon || !mon.alive) { player.act = null; return; }
  // stay locked facing the target while fighting (automatic kiting keeps the
  // archer/mage backing away from it — see movement.js)
  player.facing = mon.px >= player.px ? 1 : -1;
  if (typeof dir8From === "function") { const d8 = dir8From(mon.x - player.x, mon.y - player.y); if (d8) player.dir8 = d8; }
  const style = combatStyle();
  const range = styleRange();
  const dist = Math.max(Math.abs(mon.x - player.x), Math.abs(mon.y - player.y));
  // a flying bird can't be chased down on foot: don't march under it forever
  if (style === "melee" && typeof birdAirborne === "function" && birdAirborne(mon)) {
    if (!player._airLogAt || now - player._airLogAt > 3000) {
      log(`The ${MONSTERS[mon.kind].name} is on the wing — you'll need a bow to bring it down.`, "warn");
      player._airLogAt = now;
    }
    player.act = null;
    return;
  }
  // Shift+WASD combat footwork (movement.js) suspends the auto-pathing:
  // while the player is stepping manually, hold fire out of range or without
  // a clear arc instead of marching them back toward the target.
  const kiting = keys.Shift && (keys.w || keys.a || keys.s || keys.d);
  if (dist > range) {
    if (!kiting) setGoal({ type: "combat", mon }, mon.x, mon.y, range);
    return;
  }
  // ranged with no clear arc (a wall, a roof, the brow of a hill between):
  // step in until the shot opens up — adjacent fighting needs no line check
  if (style === "archery" && dist > 1 && !clearShot(mon)) {
    if (!kiting) {
      if (!player._losLogAt || now - player._losLogAt > 3000) {
        log("You can't get a clear shot — moving closer.", "warn");
        player._losLogAt = now;
      }
      setGoal({ type: "combat", mon }, mon.x, mon.y, Math.max(1, dist - 1));
    }
    return;
  }
  if (now >= player.nextAtkAt) playerAttack(mon);
}
