// ===== Taiao — NZ tree species (additive content) =====
// Adds 29 native NZ trees as new gatherable Woodcutting nodes alongside the
// existing 32-tier fantasy tree system (nothing removed). Each species gets
// its own dedicated 3D object (via render3d.js) at a real-world-proportional
// scale, and spawns in biome-appropriate locations blended into the normal
// vegetation scatter in world/chunks.js.
"use strict";

const NZ_TREE_SCALE = {
  nz_wheki: 1.9,
  nz_kawakawa: 0.9,
  nz_rewarewa: 2.7,
  nz_matai: 2.6,
  nz_kauri: 4.0,
  nz_kahikatea: 3.8,
  nz_rata_n: 2.8,
  nz_rangiora: 1.0,
  nz_houhere: 1.8,
  nz_koru: 0.45,
  nz_horoeka: 1.1,
  nz_hinau: 2.3,
  nz_tanekaha: 2.4,
  nz_karaka: 2.2,
  nz_kowhai: 2.0,
  nz_ponga: 2.0,
  nz_kamahi: 2.5,
  nz_tawa: 2.7,
  nz_kotukutuku: 1.9,
  nz_rimu: 3.4,
  nz_mamaku: 2.8,
  nz_tikouka: 2.0,
  nz_pohutukawa: 2.6,
  nz_karo: 1.5,
  nz_puriri: 2.5,
  nz_ngaio: 1.6,
  nz_toetoe: 0.7,
  nz_wharariki: 0.6,
  nz_manuka: 0.9,
  nz_akeake: 1.6,
  nz_pukatea: 2.6,
};

// [key, TeReoName, level, biomes[]]
// `level` is the DIRECT Woodcutting level to chop it (1..MAX_LEVEL), same scale
// as the base trees — NOT run through scaleLevel(). Levels are spread so at
// least one native sits in every tier from 1 up to 24 (Kauri, the giant, tops
// the natives at 24); the tall forest emergents double up the higher tiers.
// NOTE: koru, kawakawa, rangiora, horoeka, wharariki and toetoe are NOT trees —
// they're small native plants registered as pick-up-able world DECORATIONS below
// (and scattered via BIOME_VEG in world/features.js), not choppable Woodcutting
// nodes. The remaining species stay as the tiered woodcutting ladder.
const NZ_EXTRA_TREES = [
  ["manuka", "Mānuka", 3, [B.GRASS, B.MEADOW, B.MOOR, B.STEPPE]],
  ["akeake", "Akeake", 8, [B.FOREST, B.SAND, B.ROCKY]],
  ["karo", "Karo", 9, [B.SAND, B.ROCKY]],
  ["ngaio", "Ngaio", 10, [B.SAND, B.ROCKY]],
  ["houhere", "Houhere", 11, [B.FOREST]],
  ["kotukutuku", "Kōtukutuku", 12, [B.FOREST]],
  ["tikouka", "Tī Kōuka", 13, [B.FARM, B.GRASS, B.WETLAND, B.FOREST]],
  ["ponga", "Ponga", 14, [B.FOREST]],
  ["wheki", "Wheki", 15, [B.FOREST]],
  ["kowhai", "Kōwhai", 16, [B.FOREST, B.MEADOW, B.CHERRY]],
  ["pohutukawa", "Pōhutukawa", 17, [B.SAND, B.ROCKY, B.REEF]],
  ["karaka", "Karaka", 18, [B.FOREST, B.FARM]],
  ["rewarewa", "Rewarewa", 18, [B.FOREST]],
  ["kamahi", "Kāmahi", 19, [B.FOREST]],
  ["tawa", "Tawa", 19, [B.FOREST]],
  ["hinau", "Hīnau", 20, [B.FOREST]],
  ["matai", "Mataī", 20, [B.FOREST]],
  ["tanekaha", "Tānekaha", 21, [B.FOREST]],
  ["rata_n", "Rātā", 21, [B.FOREST]],
  ["puriri", "Pūriri", 22, [B.FOREST]],
  ["rimu", "Rimu", 22, [B.FOREST]],
  ["mamaku", "Mamaku", 23, [B.FOREST]],
  ["kahikatea", "Kahikatea", 23, [B.SWAMP, B.WETLAND, B.FOREST]],
  ["kauri", "Kauri", 24, [B.FOREST]],
  ["pukatea", "Pukatea", 22, [B.SWAMP, B.WETLAND, B.FOREST]],
];

const NZ_TREE_NODES = [];
for (let i = 0; i < NZ_EXTRA_TREES.length; i++) {
  const [key, name, level, biomes] = NZ_EXTRA_TREES[i];
  const node = "nzt_" + key;
  const log = "rakau_" + key;
  const flatSpr = "nzf_" + key;
  SPR[flatSpr] = ["t", 27, 9, { filter: hueF(i) }];
  SPR["i_" + log] = ["t", 27, 10, { rot: 90, filter: hueF(i) }];
  // XP ramps with the (direct) level, same feel as the base tree ladder
  const xp = (typeof tierXp === "function" ? tierXp(level - 1, 24) : 20 + level * 8);
  // logTier is 0-indexed (req - 1), matching the base tree ladder's convention,
  // so logHeat()/burnMsFor() in firemaking.js give heat/burn-time appropriate
  // to the Woodcutting level (e.g. Mānuka, level 3, burns at 94° heat).
  ITEMS[log] = { name: name + " logs", icon: "i_" + log, stack: true, value: 4 + level * 3, log: true, logTier: level - 1 };
  NODE_TYPES[node] = {
    name, spr: flatSpr, skill: "Woodcutting", req: level, xp, item: log,
    tool: "axe", tick: 1300 + level * 14, depleteCh: 0.35 + Math.min(0.35, level * 0.012),
    respawn: respawnFor(level), deadSpr: "stump", biomes,
  };
  NZ_TREE_NODES.push({ node, biomes });
}

// ---- small native plants → pick-up-able world DECORATIONS (not trees) ----
// Each is registered as a placeable decor item whose id == the packed object key
// ("nz_koru", …). gameplay/decor-pickup.js therefore hands back this exact item
// on a right-click "Take", and the generic placeable pass (skills/furniture.js)
// gives it a .place so it can be set back down. world/features.js scatters them
// into their biomes; render3d objScaleFor uses NZ_TREE_SCALE for their size.
const NZ_DECOR_PLANTS = [
  ["koru", "Koru"], ["kawakawa", "Kawakawa"], ["rangiora", "Rangiora"],
  ["horoeka", "Horoeka"], ["wharariki", "Wharariki"], ["toetoe", "Toetoe"],
];
for (const [key, name] of NZ_DECOR_PLANTS) {
  const ok = "nz_" + key;
  if (typeof OBJ_MAP === "undefined" || OBJ_MAP[ok] == null) continue;
  if (typeof OBJ_CELL !== "undefined" && typeof OBJ_COLS !== "undefined") {
    const f = OBJ_MAP[ok] * 8; // south frame off the "ob" object-icon sheet
    SPR["fo_" + ok] = ["ob", 0, 0, { sx: (f % OBJ_COLS) * OBJ_CELL, sy: Math.floor(f / OBJ_COLS) * OBJ_CELL, sw: OBJ_CELL, sh: OBJ_CELL }];
  }
  ITEMS[ok] = { name, icon: SPR["fo_" + ok] ? "fo_" + ok : "i_planks", stack: true, value: 5, decor: true, place: ok };
  if (typeof EXAMINE !== "undefined") EXAMINE[ok] = `${name} — a native plant; take it, or set it down where you like.`;
}
if (typeof window !== "undefined") window.NZ_DECOR_PLANTS = NZ_DECOR_PLANTS;

// Biome-blended tree picker used by world/chunks.js's vegetation scatter:
// with a biome-appropriate NZ species available, there's a 40% chance to
// grow one of those instead of the usual fantasy tier tree, so NZ flora is
// mixed into (not swapped for) the existing world.
function nzExtraTreeNode(biomeId, rng) {
  const matches = NZ_TREE_NODES.filter(t => t.biomes.includes(biomeId));
  if (!matches.length || rng() > 0.4) return null;
  return matches[Math.floor(rng() * matches.length)].node;
}
