// ===== Taiao — door & gate locks =====
// Locksmithing's catalogue (skills/toolcraft.js) stops being shelf decoration:
// a deterministic subset of doors and gates in the world are fitted with real
// locks that must be opened before the door will swing.
//
//  - KEY locks come in three grades, each turned by an existing Locksmithing
//    item kept in the pack (keys are not consumed): bolt lock → Key,
//    tumbler lock → Skeleton key, vault lock → Master key.
//  - MAGIC locks ("warded locks") can't be touched by hand: with a wand or
//    staff wielded, the counter-sign is traced by spending runes — same
//    payment system the ancient portals use (portals.js payRunes), tiered so
//    stronger wards want scarcer words of power. Dispelling trains Magic.
//
// Which door has which lock is a pure hash of the door's position (gates: of
// the leaf-run's canonical corner, so both leaves share one lock) — no state
// is generated or stored for locked doors. Banks and artisan-station
// buildings are never locked so crafting and vaults stay open; SHOP (trader)
// buildings lock up outside trading hours only (see lockAt); grand POI
// buildings (mansions, keeps, lighthouses, observatories) are always locked,
// and it's the fancy end of the catalogue. A turned lock stays open forever
// (player.unlocked["x,y"] = 1, persisted in the save) — except shop locks,
// which the keeper bolts afresh every dusk.
"use strict";

const LOCK_TIERS = {
  1: { item: "bolt_lock",    keyId: "key" },
  2: { item: "tumbler_lock", keyId: "skeleton_key" },
  3: { item: "vault_lock",   keyId: "masterkey" },
};
// warded (magic) locks: rune payment per tier — count and minimum word tier
const WARD_TIERS = {
  1: { n: 1, minTier: 0 },
  2: { n: 2, minTier: 8 },
  3: { n: 3, minTier: 16 },
};

function lockHash(x, y, salt) {
  let h = (x * 374761393 + y * 668265263 + (salt | 0) * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// gates: both/all leaves of a run share one lock, keyed on the lowest leaf
function lockCanon(d) {
  let x = d.x, y = d.y;
  if (d.kind === "gate") {
    const dx = (d.angle === 1 || d.angle === 3) ? 1 : 0, dy = dx ? 0 : 1;
    for (let i = 1; i <= 3; i++) {
      const s = world.doorAt(d.x - dx * i, d.y - dy * i);
      if (s && s.kind === "gate" && s.angle === d.angle) { x = d.x - dx * i; y = d.y - dy * i; }
      else break;
    }
  }
  return x + "," + y;
}

// the lock fitted to this door leaf, or null. { magic, tier, item, keyId }
// — magic locks have magic:tier and item:"warded_lock"; key locks carry the
// lock item named in messages plus the key that turns it.
function lockAt(d) {
  // Tūhura Isle: the keepers' village houses (and any isle gate) are never
  // locked — a fresh hand carries no keys and the isle has no locksmith
  if (typeof tutIsleSD === "function") {
    const q = tutIsleSD(d.x / 2, d.y / 2);
    if (q && q.D < 16) return null;
  }
  const canon = lockCanon(d);
  const cx = +canon.split(",")[0], cy = +canon.split(",")[1];
  const r = lockHash(cx, cy, 0x10cc), r2 = lockHash(cx, cy, 0xf00d);
  if (d.kind === "gate") {
    // village/city gates: ~30% locked — mostly simple gate locks a store-bought
    // key turns, sometimes better ironwork, occasionally an arcane seal
    if (r >= 0.30) return null;
    if (r2 < 0.65) return { magic: 0, tier: 1, item: "gate_lock", keyId: "key" };
    if (r2 < 0.90) return { magic: 0, tier: 2, item: "gate_lock", keyId: "skeleton_key" };
    return { magic: 1, tier: 1, item: "warded_lock" };
  }
  const b = world.insideBuilding && world.insideBuilding(d.x, d.y);
  if (b && (b.job || b.job2)) {
    // SHOP buildings lock up outside trading hours (same isBedtime clock that
    // shuts the trade window): the shopkeeper bolts the door at dusk and opens
    // again at dawn. This lock is TRANSIENT — never written to player.unlocked
    // — so a key only lets you in for the night; come next dusk it's bolted
    // again. Banks and artisan-station buildings stay open round the clock.
    const shop = b.job === "trader" || b.job2 === "trader";
    if (!shop || typeof isBedtime !== "function" || !isBedtime(d.x)) return null;
    const t = r2 < 0.6 ? 1 : 2;
    return { shop: 1, magic: 0, tier: t, ...LOCK_TIERS[t] };
  }
  if (b && b.kind === "greatlab") {
    // the Great Labyrinth: the south face welcomes anyone in; the north EXIT
    // bears a grand arcane seal. The latch rule below (doorLocked: a door
    // always opens from the INSIDE) means solving the maze IS the key — you
    // walk out through the seal, but you can't walk in through it (short of
    // dispelling a grand ward, the top of the Magic catalogue).
    if (d.y === b.y0) return { magic: 3, tier: 3, item: "warded_lock" };
    return null;
  }
  if (b && /mansion|keep|lighthouse|observatory|tower/.test(b.kind || "")) {
    // the grand houses guard their vault chests behind serious lockwork
    if (r2 < 0.25) return { magic: 3, tier: 3, item: "warded_lock" };
    if (r2 < 0.50) return { magic: 2, tier: 2, item: "warded_lock" };
    const t = r2 < 0.80 ? 3 : 2;
    return { magic: 0, tier: t, ...LOCK_TIERS[t] };
  }
  // plain village/city houses: ~25% locked, weighted to the cheap end
  if (r >= 0.25) return null;
  if (r2 < 0.55) return { magic: 0, tier: 1, ...LOCK_TIERS[1] };
  if (r2 < 0.75) return { magic: 0, tier: 2, ...LOCK_TIERS[2] };
  if (r2 < 0.80) return { magic: 0, tier: 3, ...LOCK_TIERS[3] };
  return r2 < 0.90 ? { magic: 1, tier: 1, item: "warded_lock" }
                   : { magic: 2, tier: 2, item: "warded_lock" };
}

// the lock still barring this door, or null if unfitted / already opened
function doorLocked(d) {
  if (DEV_MODE) return null; // cheat mode: every lock in the world stands open
  const L = lockAt(d);
  if (!L) return null;
  // the latch always turns from the INSIDE — a dusk lock-up can't trap
  // whoever is standing in the shop when the bolt goes across
  const b = world.insideBuilding && world.insideBuilding(d.x, d.y);
  if (b && world.insideBuilding(player.x, player.y) === b) return null;
  if (!L.shop && player.unlocked && player.unlocked[lockCanon(d)]) return null;
  return L;
}

function lockName(L) {
  const base = ITEMS[L.item] ? ITEMS[L.item].name.toLowerCase() : "lock";
  if (!L.magic) return base;
  return ["", "warded lock", "greater warded lock", "grand warded lock"][L.magic] || base;
}

// try to open the lock on door d. True = opened (caller swings the door);
// false = still locked (a message explains what's needed).
function tryUnlockDoor(d, L) {
  const what = d.kind === "gate" ? "gate" : "door";
  if (!L.magic) {
    const key = ITEMS[L.keyId];
    if (countItem(L.keyId) > 0) {
      if (L.shop) {
        // a shop lock is never recorded as opened — it re-bolts each dusk
        log(`Your ${key.name.toLowerCase()} slips the ${lockName(L)} and you let yourself in. The shop stands dark and silent.`, "sys");
      } else {
        player.unlocked = player.unlocked || {};
        player.unlocked[lockCanon(d)] = 1;
        log(`Your ${key.name.toLowerCase()} turns in the ${lockName(L)} — click.`, "sys");
        saveGame();
      }
      sfx("latch", 0.8);
      return true;
    }
    log(L.shop
      ? `The shop is locked up for the night — trading resumes at dawn. (A ${key.name.toLowerCase()} would slip the ${lockName(L)}.)`
      : `The ${what} is held fast by a ${lockName(L)}. A ${key.name.toLowerCase()} would turn it.`, "warn");
    sfx("latch", 0.5);
    return false;
  }
  // warded lock: wand/staff in hand, pay the rune cost, break the seal
  const w = player.equip.weapon && ITEMS[player.equip.weapon];
  const cost = WARD_TIERS[L.magic];
  if (!w || !(w.weave || w.magicPower)) {
    log(`A ${lockName(L)} shimmers across the ${what} — no key fits a ward. It must be dispelled, wand or staff in hand.`, "warn");
    return false;
  }
  if (!payRunes(cost.n, cost.minTier)) {
    log(`The ward wants words of power to break: ${cost.n} rune${cost.n > 1 ? "s" : ""}${cost.minTier ? ` of tier ${cost.minTier}+` : ""}. You don't carry them.`, "warn");
    return false;
  }
  player.unlocked = player.unlocked || {};
  player.unlocked[lockCanon(d)] = 1;
  log(`You trace the counter-sign — the ${lockName(L)} flares, and dies.`, "gold");
  addXp("Magic", 25 * L.magic);
  sfx("spellcast", 0.7);
  saveGame();
  return true;
}

// examine flavour for a still-locked door (input.js context menu)
function lockExamine(d) {
  const L = doorLocked(d);
  if (!L) return null;
  if (L.shop) return `Locked while the shopkeeper's abed — trading resumes at dawn. A ${ITEMS[L.keyId].name.toLowerCase()} would let you in early.`;
  if (L.magic) {
    const cost = WARD_TIERS[L.magic];
    return `A ${lockName(L)} shimmers across it — dispel it wand-in-hand with ${cost.n} rune${cost.n > 1 ? "s" : ""}${cost.minTier ? ` of tier ${cost.minTier} or better` : ""}.`;
  }
  return `It's locked — a ${lockName(L)}. A ${ITEMS[L.keyId].name.toLowerCase()} would open it.`;
}
