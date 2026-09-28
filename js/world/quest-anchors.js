// ===== Taiao — Lua quest anchors for zone[0,0] (Newhaven) =====
// Hand-authored quest givers + world objects, anchored at deterministic walkable
// plaza tiles near the origin. Givers are ROOTED (_r:0) and carry a `_script` id
// (Lua matches _script before name — js/lua/lua-engine.js npcSubject), so they
// are immune to the zone NPC-name churn and never touched by the mix-NPC culler
// (they're pushed in deriveNpcs, not tracked in render3d's mixKeyed). Quest
// objects use a UNIQUE decor key aliased into OBJ_MAP to an existing prop sprite,
// so they render like that prop but their on_loc trigger can't collide with real
// civic decor. Tiles verified walkable (chunks scan around origin).
"use strict";

const QUEST_GIVERS = [
  { script: "nh_quartermaster", x: 3, y: 2, mix: 20, name: "Quartermaster Yorick", title: "Quartermaster",
    line: `"Newhaven's walls are only as good as the folk who mind the wilds beyond them."` },
  { script: "nh_herbalist", x: -3, y: 2, mix: 44, name: "Herbalist Maeve", title: "Herbalist",
    line: `"The meadow gives freely, if you know where to look."` },
  { script: "nh_dockmaster", x: 3, y: -2, mix: 71, name: "Dockmaster Pell", title: "Dockmaster",
    line: `"Cargo doesn't count itself, and the ledger's gone crooked."` },
  { script: "nh_ranger", x: -3, y: -2, mix: 96, name: "Ranger Ash", title: "Ranger",
    line: `"The road out of Newhaven isn't as safe as the maps pretend."` },
  { script: "nh_urchin", x: 0, y: 3, mix: 130, name: "Sparrow the Urchin", title: "Street urchin",
    line: `"Psst. You look like someone who can keep a secret — and find things."` },
  { script: "nh_archivist", x: 0, y: -3, mix: 158, name: "Archivist Wren", title: "Archivist",
    line: `"Every name in this zone is written down somewhere. Most of them, anyway."` },
  { script: "nh_cook", x: 2, y: 4, mix: 187, name: "Cook Bess", title: "Cook",
    line: `"A city marches on its stomach, and mine's near empty."` },
];

// world objects for on_loc retrieve quests. `alias` = an existing OBJ_MAP prop to
// borrow the sprite from; `key` is the unique trigger key painted at (x,y).
const QUEST_LOCS = [
  { script: "qloc_locket", alias: "city_planter", x: 5, y: -4 },
  { script: "qloc_cache", alias: "brazier_iron", x: -5, y: -2 },
];

// Called from chunks.js deriveNpcs: spawn any giver whose tile is in this chunk.
function deriveQuestGivers(ch, npcs, npcDerived, CHUNK, PX) {
  if (typeof QUEST_GIVERS === "undefined") return;
  for (const g of QUEST_GIVERS) {
    const key = "qgiver:" + g.script;
    if (g.x >= ch.cx * CHUNK && g.x < (ch.cx + 1) * CHUNK &&
        g.y >= ch.cy * CHUNK && g.y < (ch.cy + 1) * CHUNK && !npcDerived.has(key)) {
      npcDerived.add(key);
      const def = (typeof MIX_NPCS !== "undefined" && MIX_NPCS.list && MIX_NPCS.list[g.mix % MIX_NPCS.list.length]) || { key: "", title: "" };
      npcs.push({
        name: g.name, x: g.x, y: g.y, px: PX(g.x), py: PX(g.y), look: -1,
        mix: def.key, mixTitle: g.title || def.title, dir8: "south",
        _mid: "qg_" + g.script, _home: [g.x, g.y], _r: 0,
        _wanderAt: (typeof performance !== "undefined" ? performance.now() : 0) + 9e9, _mt: 0,
        _script: g.script, line: g.line,
      });
    }
  }
}

// Called from chunks.js origin-extras (v.origin) block: paint any quest object
// whose tile is in this chunk. Aliases its key into OBJ_MAP first so it renders.
function paintQuestLocs(deco, inCh) {
  if (typeof QUEST_LOCS === "undefined") return;
  for (const q of QUEST_LOCS) {
    if (typeof OBJ_MAP !== "undefined" && OBJ_MAP[q.alias] != null && OBJ_MAP[q.script] == null) OBJ_MAP[q.script] = OBJ_MAP[q.alias];
    if (inCh(q.x, q.y)) deco(q.x, q.y, q.script, false);
  }
}
