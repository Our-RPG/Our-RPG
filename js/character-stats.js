// ===== Taiao — per-character physical build & aptitudes =====
// Every playable character (CHAR_LIST) and world NPC (MIX_NPCS) is a different
// race/build, so each gets a UNIQUE stat block derived from its own art-prompt
// description (the folder / title / key strings). We read the race, class/role
// and any size adjectives out of that text and blend them, then add a tiny
// deterministic per-name jitter so no two characters are identical.
//
// Stats produced (multipliers on a neutral 1.0 baseline unless noted):
//   h      billboard height   (taller / shorter)   0.70 .. 1.30  (Trilla the faerie
//                                                   → 0.7, Tembo the loxodon → 1.3;
//                                                   SAME scale for players & NPCs)
//   w      billboard width     (wider / narrower)  0.70 .. 1.30  (= h × build factor)
//   weight relative mass                           ∝ h × w²  (a faerie ~0.34, human
//                                                   ~1, loxodon ~2.2) — deduced, then
//                                                   feeds speed (heavier slower) & tough
//   speed  move speed          (faster / slower)   0.60 .. 1.45 for NPCs (race/class/
//                                                   size derived, as below) — but EVERY
//                                                   playable character is pinned to a
//                                                   uniform ×1.45 (user request 2026-10-03):
//                                                   see the CHAR_STATS override below.
//   tough  incoming-damage soak (0 = none)         0.00 .. 0.45  → takes (1-tough)× dmg
//   xp     per-skill xp multipliers                0.85 .. 1.60  (missing skill = 1)
//
// h also raises/lowers the character's nose, so a taller race wades DEEPER
// before drowning (movement.js tickAir / state.js playerSinkY scale MOUTH_Y by h).
"use strict";
(function () {
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // Archetype deltas: [dH, dW, dSpeed, dTough, {SkillName: dXp, ...}] — ADDED to
  // the baseline. Skill names must match real SKILLS (mining is split into
  // "Ore-mining"/"Gem-mining"; "Mining" is legacy and inert).
  const RACE = {
    // tall, slender, quick, arcane / archery
    "high elf": [0.12, -0.07, 0.08, -0.03, { Magic: 0.22, Archery: 0.12, Agility: 0.10 }],
    "wood elf": [0.08, -0.07, 0.12, -0.03, { Archery: 0.22, Agility: 0.16, Foraging: 0.12 }],
    "sea elf": [0.06, -0.05, 0.08, -0.02, { Fishing: 0.16, Sailing: 0.12, Archery: 0.10 }],
    "half-elf": [0.05, -0.03, 0.05, 0, { Magic: 0.10, Archery: 0.10 }],
    "half elf": [0.05, -0.03, 0.05, 0, { Magic: 0.10, Archery: 0.10 }],
    drow: [0.06, -0.07, 0.12, -0.02, { Magic: 0.16, Archery: 0.12 }],
    eladrin: [0.10, -0.06, 0.09, -0.03, { Magic: 0.20, Agility: 0.10 }],
    elf: [0.10, -0.06, 0.09, -0.03, { Archery: 0.16, Magic: 0.14, Agility: 0.12 }],
    elven: [0.10, -0.06, 0.09, -0.03, { Archery: 0.16, Magic: 0.14, Agility: 0.12 }],
    // short, stout, tough, crafters
    dwarf: [-0.17, 0.13, -0.08, 0.13, { Weaponsmithing: 0.22, Armoursmithing: 0.22, Smelting: 0.18, "Ore-mining": 0.18, Defence: 0.10 }],
    dwarven: [-0.17, 0.13, -0.08, 0.13, { Weaponsmithing: 0.22, Armoursmithing: 0.22, Smelting: 0.18, "Ore-mining": 0.18, Defence: 0.10 }],
    duergar: [-0.16, 0.14, -0.08, 0.14, { Weaponsmithing: 0.18, Armoursmithing: 0.18, "Ore-mining": 0.18, Magic: 0.08 }],
    // tiny, clever, nimble
    gnome: [-0.24, -0.03, 0.05, -0.05, { Alchemy: 0.20, Runecrafting: 0.16, Jewelry: 0.14 }],
    halfling: [-0.20, -0.02, 0.10, -0.05, { Agility: 0.15, Cooking: 0.12 }],
    hobbit: [-0.20, -0.02, 0.10, -0.05, { Agility: 0.14, Cooking: 0.12 }],
    kobold: [-0.22, -0.04, 0.12, -0.06, { "Ore-mining": 0.14, "Gem-mining": 0.12 }],
    goblin: [-0.16, -0.02, 0.12, -0.04, { Agility: 0.12 }],
    fairy: [-0.34, -0.10, 0.18, -0.10, { Magic: 0.24, Agility: 0.14 }],
    faerie: [-0.34, -0.10, 0.18, -0.10, { Magic: 0.24, Agility: 0.14 }],
    pixie: [-0.34, -0.10, 0.18, -0.10, { Magic: 0.24, Agility: 0.14 }],
    sprite: [-0.30, -0.10, 0.18, -0.10, { Magic: 0.22 }],
    // big, strong, tough
    goliath: [0.24, 0.13, -0.05, 0.16, { Strength: 0.22, Melee: 0.12, "Ore-mining": 0.10 }],
    "half-orc": [0.12, 0.10, 0, 0.12, { Strength: 0.20, Melee: 0.16 }],
    "half orc": [0.12, 0.10, 0, 0.12, { Strength: 0.20, Melee: 0.16 }],
    orc: [0.12, 0.12, -0.02, 0.14, { Strength: 0.22, Melee: 0.16 }],
    orcish: [0.12, 0.12, -0.02, 0.14, { Strength: 0.22, Melee: 0.16 }],
    ogre: [0.28, 0.20, -0.10, 0.22, { Strength: 0.28, Melee: 0.12 }],
    troll: [0.30, 0.18, -0.10, 0.22, { Strength: 0.26 }],
    giant: [0.30, 0.18, -0.08, 0.22, { Strength: 0.28 }],
    firbolg: [0.24, 0.12, -0.05, 0.14, { Foraging: 0.16, Magic: 0.10, Strength: 0.12 }],
    minotaur: [0.20, 0.14, -0.04, 0.16, { Strength: 0.22, Melee: 0.14 }],
    // loxodon / elephant-folk — the largest, heaviest race (Tembo)
    loxodon: [0.52, 0.34, -0.10, 0.18, { Strength: 0.22, Melee: 0.10, Defence: 0.10 }],
    elephant: [0.52, 0.34, -0.10, 0.18, { Strength: 0.22, Melee: 0.10 }],
    "half-giant": [0.40, 0.24, -0.08, 0.18, { Strength: 0.24, Melee: 0.10 }],
    "half giant": [0.40, 0.24, -0.08, 0.18, { Strength: 0.24, Melee: 0.10 }],
    dragonborn: [0.12, 0.08, -0.02, 0.10, { Strength: 0.14, Magic: 0.12, Melee: 0.10 }],
    draconic: [0.10, 0.07, 0, 0.08, { Magic: 0.14, Strength: 0.10 }],
    // average / arcane-leaning
    human: [0, 0, 0, 0, {}],
    tiefling: [0.03, 0, 0.02, 0, { Magic: 0.16 }],
    aasimar: [0.05, 0, 0.02, 0.03, { Magic: 0.16 }],
    genasi: [0.04, 0, 0.04, 0.02, { Magic: 0.16 }],
    changeling: [0, 0, 0.06, 0, {  }],
    // beastfolk / exotic — agile
    tabaxi: [0.03, -0.03, 0.16, -0.02, { Agility: 0.20, Archery: 0.10 }],
    catfolk: [0.03, -0.03, 0.16, -0.02, { Agility: 0.20 }],
    kenku: [-0.04, -0.03, 0.12, -0.03, { Archery: 0.10 }],
    aarakocra: [-0.02, -0.08, 0.18, -0.06, { Agility: 0.18, Archery: 0.14 }],
    lizardfolk: [0.04, 0.06, 0.02, 0.10, { Fishing: 0.16, Foraging: 0.12, Melee: 0.10 }],
    tortle: [-0.05, 0.14, -0.12, 0.20, { Defence: 0.16, Fishing: 0.12 }],
    "thri-kreen": [0.08, -0.06, 0.16, 0.04, { Agility: 0.20, Melee: 0.10 }],
    centaur: [0.18, 0.16, 0.12, 0.08, { Archery: 0.14, Agility: 0.10 }],
    satyr: [0, -0.02, 0.12, -0.02, { Magic: 0.12, Agility: 0.10 }],
    triton: [0.05, 0, 0.06, 0.04, { Fishing: 0.18, Sailing: 0.12, Magic: 0.08 }],
    merfolk: [0, 0, 0, 0.02, { Fishing: 0.20, Sailing: 0.14 }],
    // constructed / undead
    warforged: [0.08, 0.10, -0.08, 0.22, { Defence: 0.18, Weaponsmithing: 0.12, Armoursmithing: 0.12 }],
    golem: [0.14, 0.16, -0.14, 0.26, { Defence: 0.20 }],
    lich: [0.04, -0.08, -0.04, 0.06, { Magic: 0.26, Runecrafting: 0.16 }],
    skeleton: [0.02, -0.10, 0.04, -0.05, { Magic: 0.10 }],
    vampire: [0.05, -0.04, 0.10, 0.06, { Magic: 0.16 }],
    undead: [0.02, -0.06, -0.02, 0.06, { Magic: 0.10 }],
  };

  // Class / profession deltas.
  const ROLE = {
    fighter: [0.02, 0.05, 0, 0.06, { Melee: 0.18, Strength: 0.14, Defence: 0.08 }],
    warrior: [0.02, 0.05, 0, 0.06, { Melee: 0.18, Strength: 0.14, Defence: 0.08 }],
    knight: [0.02, 0.06, -0.02, 0.10, { Defence: 0.16, Melee: 0.12 }],
    soldier: [0.02, 0.04, 0, 0.06, { Melee: 0.14, Defence: 0.08 }],
    "man-at-arms": [0.02, 0.05, 0, 0.07, { Melee: 0.14, Defence: 0.10 }],
    barbarian: [0.06, 0.08, 0.02, 0.10, { Strength: 0.22, Melee: 0.12 }],
    berserker: [0.06, 0.08, 0.04, 0.08, { Strength: 0.22, Melee: 0.14 }],
    paladin: [0.04, 0.05, -0.02, 0.10, { Defence: 0.14, Melee: 0.10, Magic: 0.10 }],
    guard: [0.02, 0.05, 0, 0.08, { Defence: 0.14, Melee: 0.10 }],
    gladiator: [0.04, 0.06, 0.02, 0.08, { Melee: 0.16, Strength: 0.12 }],
    champion: [0.04, 0.06, 0, 0.08, { Melee: 0.16, Strength: 0.12, Defence: 0.08 }],
    ranger: [0.03, -0.02, 0.10, 0, { Archery: 0.20, Agility: 0.12, Foraging: 0.10 }],
    hunter: [0.02, 0, 0.08, 0, { Archery: 0.16, Foraging: 0.12 }],
    archer: [0.02, -0.03, 0.08, 0, { Archery: 0.24, Agility: 0.10 }],
    scout: [0, -0.03, 0.14, -0.02, { Agility: 0.16, Archery: 0.10 }],
    rogue: [-0.02, -0.03, 0.14, -0.02, { Agility: 0.14 }],
    thief: [-0.02, -0.03, 0.14, -0.02, { Agility: 0.12 }],
    assassin: [0, -0.04, 0.14, -0.02, { Agility: 0.14, Archery: 0.08 }],
    bandit: [0, 0, 0.08, 0.02, { Melee: 0.08 }],
    outlaw: [0, 0, 0.08, 0.02, { Melee: 0.08 }],
    monk: [0, -0.03, 0.12, 0.04, { Agility: 0.20, Melee: 0.10, Health: 0.08 }],
    wizard: [0.02, -0.05, -0.02, -0.02, { Magic: 0.26, Runecrafting: 0.12, Alchemy: 0.10 }],
    sorcerer: [0.02, -0.05, 0, -0.02, { Magic: 0.26, Runecrafting: 0.10 }],
    sorceress: [0.01, -0.06, 0, -0.02, { Magic: 0.26, Runecrafting: 0.10 }],
    mage: [0.02, -0.05, -0.02, -0.02, { Magic: 0.24, Alchemy: 0.10 }],
    warlock: [0.02, -0.03, 0, 0, { Magic: 0.22, Runecrafting: 0.10 }],
    witch: [0, -0.04, 0.02, 0, { Magic: 0.20, Alchemy: 0.16, Potionmaking: 0.14 }],
    arcanist: [0.02, -0.05, -0.02, -0.02, { Magic: 0.24, Runecrafting: 0.14 }],
    enchanter: [0.02, -0.04, 0, -0.02, { Magic: 0.20, Jewelry: 0.12, Runecrafting: 0.12 }],
    necromancer: [0.02, -0.05, -0.02, 0, { Magic: 0.24, Runecrafting: 0.12 }],
    druid: [0.02, 0, 0.04, 0.02, { Magic: 0.16, Foraging: 0.18, Potionmaking: 0.10 }],
    cleric: [0.02, 0, 0, 0.04, { Magic: 0.18, Health: 0.10 }],
    priest: [0.02, 0, 0, 0.03, { Magic: 0.16, Health: 0.10 }],
    priestess: [0.01, -0.02, 0.02, 0.02, { Magic: 0.18, Health: 0.08 }],
    shaman: [0.02, 0, 0.04, 0.03, { Magic: 0.16, Foraging: 0.12 }],
    bard: [0.02, -0.02, 0.06, 0, { Magic: 0.12, Agility: 0.08 }],
    scholar: [0, -0.03, -0.02, -0.02, { Magic: 0.14, Alchemy: 0.14, Runecrafting: 0.12 }],
    sage: [0, -0.03, -0.04, -0.02, { Magic: 0.14, Alchemy: 0.14 }],
    alchemist: [0, -0.02, 0, 0, { Alchemy: 0.22, Potionmaking: 0.18 }],
    apothecary: [0, -0.02, 0, 0, { Potionmaking: 0.22, Alchemy: 0.14 }],
    smith: [0, 0.06, -0.04, 0.08, { Weaponsmithing: 0.24, Armoursmithing: 0.24, Smelting: 0.16 }],
    blacksmith: [0, 0.07, -0.04, 0.08, { Weaponsmithing: 0.24, Armoursmithing: 0.24, Smelting: 0.18 }],
    tinkerer: [-0.02, 0, 0, 0, { Weaponsmithing: 0.14, Armoursmithing: 0.14, Jewelry: 0.14, Alchemy: 0.10 }],
    artificer: [-0.01, 0, 0, 0.02, { Weaponsmithing: 0.16, Armoursmithing: 0.16, Runecrafting: 0.12, Jewelry: 0.10 }],
    miner: [-0.02, 0.06, -0.04, 0.06, { "Ore-mining": 0.24, "Gem-mining": 0.12, Smelting: 0.10 }],
    fisher: [0, 0, 0, 0, { Fishing: 0.24, Sailing: 0.10 }],
    fisherman: [0, 0.02, 0, 0.02, { Fishing: 0.24, Sailing: 0.10 }],
    sailor: [0, 0.02, 0.02, 0.04, { Sailing: 0.24, Fishing: 0.10 }],
    pirate: [0.02, 0.03, 0.04, 0.04, { Sailing: 0.18, Melee: 0.10 }],
    corsair: [0.02, 0.03, 0.04, 0.04, { Sailing: 0.18, Archery: 0.10 }],
    farmer: [0, 0.04, -0.02, 0.04, { Foraging: 0.16, Cooking: 0.10 }],
    cook: [0, 0.03, 0, 0.02, { Cooking: 0.24 }],
    chef: [0, 0.03, 0, 0.02, { Cooking: 0.24 }],
    baker: [0, 0.03, 0, 0.02, { Cooking: 0.20, Milling: 0.14 }],
    lumberjack: [0.02, 0.06, -0.02, 0.06, { Woodcutting: 0.24, Firemaking: 0.10 }],
    woodcutter: [0.02, 0.06, -0.02, 0.06, { Woodcutting: 0.24, Firemaking: 0.10 }],
    carpenter: [0, 0.03, -0.02, 0.03, { Carpentry: 0.24 }],
    tanner: [0, 0.02, 0, 0.02, { Tanning: 0.22 }],
    hunter2: [0, 0, 0, 0, {}],
    butcher: [0, 0.04, -0.02, 0.04, { Cooking: 0.24 }],
    jeweler: [-0.02, -0.02, 0, 0, { Jewelry: 0.24 }],
    jeweller: [-0.02, -0.02, 0, 0, { Jewelry: 0.24 }],
    fletcher: [0, -0.02, 0.02, 0, { Fletching: 0.24, Archery: 0.10 }],
    merchant: [0, 0.02, 0, 0, {  }],
    trader: [0, 0.02, 0, 0, {  }],
    noble: [0.02, 0, -0.02, 0, { Magic: 0.06 }],
    cleric2: [0, 0, 0, 0, {}],
  };

  // Size / build adjectives.
  const SIZE = {
    towering: [0.16, 0.02, 0, 0.02, {}], tall: [0.10, 0, 0, 0, {}], statuesque: [0.10, 0, 0, 0, {}],
    "long-limbed": [0.10, -0.04, 0.04, 0, {}], lanky: [0.10, -0.06, 0.02, -0.02, {}],
    gangly: [0.10, -0.07, 0, -0.03, {}], willowy: [0.08, -0.08, 0.04, -0.03, {}],
    short: [-0.12, 0.02, 0, 0.02, {}], petite: [-0.14, -0.04, 0.04, -0.03, {}],
    tiny: [-0.22, -0.04, 0.06, -0.05, {}], diminutive: [-0.20, -0.04, 0.06, -0.05, {}],
    small: [-0.10, -0.02, 0.02, -0.02, {}], little: [-0.10, -0.02, 0.02, -0.02, {}],
    broad: [0, 0.10, -0.02, 0.06, {}], "broad-shouldered": [0.02, 0.12, -0.02, 0.08, {}],
    burly: [0.03, 0.12, -0.03, 0.10, {}], muscular: [0.03, 0.08, 0, 0.08, { Strength: 0.08 }],
    brawny: [0.03, 0.10, -0.02, 0.08, { Strength: 0.08 }], stocky: [-0.06, 0.10, -0.03, 0.08, {}],
    heavyset: [-0.02, 0.14, -0.05, 0.08, {}], hulking: [0.14, 0.14, -0.06, 0.14, {}],
    portly: [-0.02, 0.14, -0.06, 0.04, {}], stout: [-0.06, 0.10, -0.03, 0.08, {}],
    massive: [0.16, 0.14, -0.06, 0.14, {}], huge: [0.16, 0.12, -0.05, 0.12, {}],
    slender: [0.04, -0.08, 0.04, -0.03, {}], slim: [0.02, -0.08, 0.04, -0.03, {}],
    lithe: [0.02, -0.06, 0.08, -0.02, {}], wiry: [-0.02, -0.06, 0.08, 0, {}],
    thin: [0.02, -0.08, 0.02, -0.03, {}], gaunt: [0.02, -0.09, 0, -0.03, {}],
    lean: [0.02, -0.05, 0.06, -0.01, {}], svelte: [0.02, -0.07, 0.05, -0.02, {}],
    elderly: [-0.05, -0.02, -0.10, -0.02, { Magic: 0.08 }], aged: [-0.04, -0.02, -0.08, 0, {}],
    old: [-0.03, -0.02, -0.06, -0.02, { Magic: 0.06 }], young: [-0.05, -0.03, 0.06, -0.03, {}],
    child: [-0.24, -0.06, 0.08, -0.08, {}], youthful: [-0.05, -0.03, 0.05, -0.03, {}],
  };

  // deterministic 32-bit hash of a string → used for per-character jitter
  function hash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // find the FIRST table key that appears as a whole word in the text (longest
  // keys first so "high elf"/"broad-shouldered" beat "elf"/"broad")
  function pickAll(text, table) {
    const keys = Object.keys(table).sort((a, b) => b.length - a.length);
    const hits = [];
    const used = [];
    for (const k of keys) {
      const kk = k.replace(/[0-9]$/, ""); // strip disambiguating suffixes (hunter2)
      if (!kk) continue;
      const re = new RegExp("(^|[^a-z])" + kk.replace(/[-]/g, "[- ]") + "([^a-z]|$)");
      if (re.test(text)) {
        // don't double-count overlapping keys (e.g. "elf" inside "half-elf")
        if (used.some(u => u.includes(kk) || kk.includes(u))) continue;
        hits.push(table[k]); used.push(kk);
      }
    }
    return hits;
  }

  // Raw (pre-remap) keyword scores: rawH = height signal, buildF = width RELATIVE
  // to height (broad>1, slender<1), plus speed/tough/xp. Same jittered signal for
  // players and NPCs so the two share one scale.
  function rawScores(desc) {
    const text = " " + String(desc || "").toLowerCase().replace(/_/g, " ").replace(/[^a-z0-9 -]/g, " ") + " ";
    let rawH = 1, buildF = 1, speed = 1, tough = 0;
    const xp = {};
    const apply = (d, weight) => {
      if (!d) return;
      rawH += d[0] * weight; buildF += d[1] * weight; speed += d[2] * weight; tough += d[3] * weight;
      for (const s in d[4]) xp[s] = (xp[s] || 0) + d[4][s] * weight;
    };
    const races = pickAll(text, RACE);
    if (races.length) apply(races[0], 1); else apply(RACE.human, 1);
    const roles = pickAll(text, ROLE);
    const rw = roles.length > 1 ? 0.7 : 1;
    for (const r of roles) apply(r, rw);
    for (const s of pickAll(text, SIZE)) apply(s, 1);
    // per-character jitter (±) so identical archetypes still differ slightly
    const seed = hash(String(desc || ""));
    rawH += (((seed & 255) / 255) - 0.5) * 0.10;
    buildF += ((((seed >> 8) & 255) / 255) - 0.5) * 0.10;
    speed += ((((seed >> 16) & 255) / 255) - 0.5) * 0.08;
    return { rawH, buildF, speed, tough, xp };
  }

  // Height scale range and its anchors: Trilla (a faerie — the smallest) maps to
  // H_MIN, Tembo (a loxodon — the largest) maps to H_MAX. The SAME remap and the
  // SAME [H_MIN,H_MAX] bounds are used for every player AND NPC, so identical
  // descriptions render at identical world size. Width shares the same bounds but
  // stays proportional to height (build factor) so nothing stretches grotesquely.
  const H_MIN = 0.7, H_MAX = 1.3;
  function anchorText(name, fallback) {
    if (typeof CHAR_LIST !== "undefined") {
      const c = CHAR_LIST.find(c => c.name === name);
      if (c) return (c.folder || "") + " " + (c.name || "");
    }
    return fallback;
  }
  const _loRaw = rawScores(anchorText("Trilla", "faerie bard short")).rawH;
  const _hiRaw = rawScores(anchorText("Tembo", "loxodon paladin")).rawH;
  const _span = (_hiRaw - _loRaw) || 1;
  const remapH = (rawH) => clamp(H_MIN + ((rawH - _loRaw) / _span) * (H_MAX - H_MIN), H_MIN, H_MAX);

  function finalize(raw) {
    const h = remapH(raw.rawH);
    const w = clamp(h * raw.buildF, H_MIN, H_MAX);   // width tracks height × build
    const weight = h * w * w;                         // mass ∝ height × cross-section
    // heavier => slower & sturdier, lighter => quicker & frailer (log so the wide
    // weight range — a loxodon is ~90× a faerie's mass — stays sane)
    const speed = clamp(raw.speed * Math.pow(weight, -0.16), 0.6, 1.45);
    const tough = clamp(raw.tough + 0.06 * Math.log(weight), 0, 0.45);
    const out = { h, w, weight, speed, tough, xp: {} };
    for (const s in raw.xp) out.xp[s] = clamp(1 + raw.xp[s], 0.85, 1.60);
    return out;
  }
  function deriveStats(desc) { return finalize(rawScores(desc)); }

  const PLAYER_SPEED = 1.45; // every playable character moves at the same speed (user request 2026-10-03)
  const NEUTRAL = { h: 1, w: 1, weight: 1, speed: PLAYER_SPEED, tough: 0, xp: {} };

  // Player characters: one stat block per CHAR_LIST entry (folder + name).
  // Race/class/size still shape height, width, toughness and xp aptitude —
  // only speed is flattened to a single uniform value across the whole roster.
  const CHAR_STATS = (typeof CHAR_LIST !== "undefined" ? CHAR_LIST : [])
    .map(c => deriveStats((c.folder || "") + " " + (c.name || "")));
  for (const s of CHAR_STATS) s.speed = PLAYER_SPEED;

  // NPC stats are cached per MIX def. We derive from the `title` ONLY ("Race
  // Class in X garb") — NOT the `key`, which is a COMPOSITE of two art prompts
  // (a garb-style donor + the real character), e.g. "...tiefling_scholar_tall__
  // ...dwarf_warrior_short", so parsing the key would read the wrong race/size.
  // Fall back to the key only when a def has no title.
  const _mixCache = new Map();
  function mixStatsFor(def) {
    if (!def) return NEUTRAL;
    const key = def.key || def.title || def.name || "";
    let s = _mixCache.get(key);
    if (!s) { s = deriveStats(def.title || def.key || ""); _mixCache.set(key, s); }
    return s;
  }

  // ---- player-convenience globals (read the currently-selected character) ----
  function playerStats() {
    return (typeof player !== "undefined" && player && player.character != null && CHAR_STATS[player.character])
      || NEUTRAL;
  }
  if (typeof window !== "undefined") {
    window.CHAR_STATS = CHAR_STATS;
    window.deriveCharStats = deriveStats;
    window.mixStatsFor = mixStatsFor;
    window.playerCharStats = playerStats;
    window.charHeightMul = () => playerStats().h;
    window.charWidthMul = () => playerStats().w;
    window.charSpeedMul = () => playerStats().speed;
    window.charToughness = () => playerStats().tough;
    window.charWeight = () => playerStats().weight;
    window.charXpMul = (skill) => { const x = playerStats().xp; return (x && x[skill]) || 1; };
    // Agility passives (skill-level driven, not character-derived): training
    // Agility makes you quicker on foot and surer-footed on risky crossings.
    window.charAgiSpeedMul = () => {
      const lvl = (typeof skillLvl === "function") ? skillLvl("Agility") : 0;
      return 1 + Math.min(0.15, lvl * 0.005); // up to ~15% faster on land at the cap
    };
    window.charAgiSlipMul = () => {
      const lvl = (typeof skillLvl === "function") ? skillLvl("Agility") : 0;
      return Math.max(0.4, 1 - lvl * 0.02); // steadier footing, down to 0.4x slip risk
    };
  }
})();
