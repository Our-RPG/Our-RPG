// ===== Taiao — Tūhura Isle, the tutorial island =====
// New characters wake on Tūhura Isle ("tūhura" — to explore, to discover): a
// long serpentine island carved into the terrain (world/terrain.js TUT_ISLE),
// a chain of fifteen zone pods walked IN ORDER along a dirt path — Landing,
// the Bush, the Cove, the Forge, the Springs, the Lagoon, the Bank, the Farm
// Vale, the Woodcrafting camp, the Cooking camp, the Warden's Pit, the Sky
// Knoll, the Candle Hollow, the Portal Crown and the Harbour, where the
// Navigator ferries the graduate to Newhaven. Every isthmus
// between pods carries a fence wall and a gate that only unbars when the
// previous tutor's lesson is done. There are NO invisible walls: the fences
// run coast to coast and out to an offshore RING of stakes (chunks.js), so
// every zone's water is a closed pen; barred() only latches the gate tiles.
//
// The isle is an INSTANCED POCKET: it keeps a staged sky (always dawn at
// first — each islander met rolls time and weather forward one notch), and
// after graduation the mist takes it back — barred everywhere, scrubbed from
// the explored map, its portal attunement dissolved.
//
// Wiring: chunks.js stamps TUT_CONTENT + the path/fences and derives
// TUT_TUTORS as mix-sprite NPCs (generated AND hydrated chunks); ui.js
// talkTo() routes npc.tutor here; daynight/weather/world.latitudeAt consult
// the sky hooks; movement.js moveTo + portals.js portalTravel consult
// barred(); main.js spawns fresh saves at Tutorial.START; storage.js
// persists player.tutorial.
"use strict";

// ---------- dev: walk the isle without doing the work ----------
// COMPILE-TIME flag (edit + rebuild, like DEV_MODE): with STAGE_SKIP true,
// every journey gate stands open — stepping through one AUTO-COMPLETES all
// stages up to it: keepers marked met (the staged sky rolls), every goal
// and flag credited, keeper gifts granted, and a catch-up bundle of the
// items those stages would have put in your pack (logs, whitebait, forged
// kit, pails, flour, arrows…) appears in your inventory. Ship FALSE.
const STAGE_SKIP = false;

// ---------- data consumed by world/chunks.js ----------
// Ambient monster kinds allowed to keep their spawns on the isle — everything
// else the biome rolls is stripped (the isle must be safe for a level-1 hand).
const TUT_TAME = new Set(["chicken", "sheep", "cow", "slime", "rabbit", "duck", "quail", "goat",
  // NZ native birds (nz-extra-birds.js): every non-aggressive small/medium
  // species is welcome on the isle — the fliers (birdflight.js) give fresh
  // hands their first sight of birds on the wing. The aggressive weka and the
  // giants (hakawai, pouākai, moa) stay off the tutorial isle's AMBIENT rolls
  // — but ONE Kuranui is hand-stamped in the Farm Vale (TUT_CONTENT pod 6, a
  // stamp bypasses this allowlist): the pods 5-8 stretch is the isle's
  // flattest beat, and she is its one spectacle — the giant Kenji's dialogue
  // promises, met in the flesh. Non-aggressive (all NZ birds are), so the
  // level-1-safe rule holds.
  "tui", "piwakawaka", "kereru", "kiwi", "kaka", "kea", "ruru", "tieke", "kotata",
  "titipounamu", "koreke", "pukeko", "whio", "putangitangi", "huia", "karearea", "takapu"]);

// The fifteen tutors, in CHAIN ORDER — index i lives in pod i and keeps gate i
// (between pod i and i+1) latched until their lesson is done. dx/dy are GAME
// tiles from their pod's centre; look indexes VILLAGER_LOOKS as the fallback
// skin if the mix roster is absent. `mix` pins the keeper to a specific
// mix-roster character (index into MIX_NPCS.list) so names/sprites match the
// designed cast regardless of chain length — see TUT_MIX_DEF.
const TUT_TUTORS = [
  { id: "guide",  name: "Kwame",     role: "Guide",       pod: 0,  dx: 0,  dy: 6,  look: 1, mix: 214 },
  { id: "bush",   name: "Pallo",     role: "Bushman",     pod: 1,  dx: 0,  dy: -4, look: 3, mix: 221 },
  { id: "fish",   name: "Amenhotep", role: "Fisher",      pod: 2,  dx: -9, dy: 3,  look: 0, mix: 228 },
  { id: "smith",  name: "Menkaure",  role: "Smith",       pod: 3,  dx: 0,  dy: 3,  look: 5, mix: 235 },
  { id: "swim",   name: "Vrixa",     role: "Swim-Master", pod: 4,  dx: 10, dy: -4, look: 0, mix: 298 },
  { id: "bank",   name: "Torvak",    role: "Banker",      pod: 5,  dx: 0,  dy: -3, look: 2, mix: 305 },
  { id: "farm",   name: "Kenji",     role: "Farmhand",    pod: 6,  dx: 6,  dy: 2,  look: 3, mix: 263 },
  { id: "wood",   name: "Torra",     role: "Carpenter",   pod: 7,  dx: 0,  dy: 3,  look: 5, mix: 249 },
  { id: "cook",   name: "Aldric",    role: "Cook",        pod: 8,  dx: 0,  dy: 3,  look: 4, mix: 256 },
  { id: "war",    name: "Yuki",      role: "Warden",      pod: 9,  dx: 0,  dy: 6,  look: 2, mix: 270 },
  { id: "soap",   name: "Nala",      role: "Soapmaker",   pod: 10, dx: 7,  dy: 4,  look: 4, mix: 242 },
  { id: "sky",    name: "Ravenna",   role: "Skywatcher",  pod: 11, dx: 0,  dy: -2, look: 1, mix: 312 },
  { id: "candle", name: "Miles",     role: "Candlemaker", pod: 12, dx: 3,  dy: -3, look: 4, mix: 277 },
  { id: "lore",   name: "Runa",      role: "Loremaster",  pod: 13, dx: 3,  dy: -3, look: 4, mix: 284 },
  // Sigrid stands at the PIER'S BASE (the deck runs seaward along pod 14's
  // -108° radial from k=12) — her old (0,+26) seat was a stale serpentine-
  // era offset that landed her INSIDE the middle ring, behind the fence
  { id: "ferry",  name: "Sigrid",    role: "Navigator",   pod: 14, dx: -3, dy: -10, look: 5, mix: 291 },
];

// The ROSTER CHARACTER behind tutor i — shared by chunks.js (NPC derivation)
// and the Tutorial module (dialogue header, journey bar, gate messages), so
// the isle's cast is one consistent set of real characters: each tutor IS an
// actual mix-roster person, with their tutorial title appended ("… the
// Guide"). Deterministic stride walk of the roster; null if roster absent
// (the Māori fallback names in TUT_TUTORS then apply).
function TUT_MIX_DEF(i) {
  if (typeof MIX_NPCS === "undefined" || !MIX_NPCS || !MIX_NPCS.list || !MIX_NPCS.list.length) return null;
  const N = MIX_NPCS.list.length;
  // an explicit pin wins (keeps the designed cast stable); else the legacy
  // deterministic stride walk from the isle's spawn-tile hash
  const tu = TUT_TUTORS[i];
  if (tu && tu.mix != null) return MIX_NPCS.list[(((tu.mix % N) + N) % N)];
  const base = (Math.abs((TUT_ISLE.gx * 31 + TUT_ISLE.gy * 17) | 0)) % N;
  return MIX_NPCS.list[(((base + i * 7) % N) + N) % N];
}

// The village layout — shared with chunks.js. The village SPANS BOTH SHORE
// PODS (user req 2026-09-16): the Landing (pod 0) and the Harbour (pod 14)
// are one open plains shore with no fence between them (terrain.js skips
// the -90° spoke), tents scattered through both. `seats` is where each
// keeper stands once they've come home for the evening (early keepers camp
// by the Landing, later ones round the Harbour green; the Navigator keeps
// her own post by the waka), `lamps` the stands lit at dusk — every entry
// carries its `pod` (0 or 14) plus game-tile offsets from that pod's centre.
var TUT_VILLAGE = (() => {
  const seats = {};
  const homing = TUT_TUTORS.filter(tu => tu.id !== "ferry");
  homing.forEach((tu, i) => {
    const pod = i < 7 ? 0 : 14;
    const ring = i < 7 ? i : i - 7, n = i < 7 ? 7 : homing.length - 7;
    const a = (ring / n) * Math.PI * 2 - Math.PI / 2;
    seats[tu.id] = { pod, dx: Math.round(Math.cos(a) * 5.5), dy: Math.round(Math.sin(a) * 5.5) };
  });
  // LAMP COVERAGE LIKE A REAL SETTLEMENT (user req 2026-09-16: the village
  // must read WELL LIT at night, not a few lonely stands): mirroring
  // daynight.js villageCandleSpots — a stand by every house door, an indoor
  // glow per house, a lit ring around each green, and a jittered coverage
  // grid every 8 tiles across both pods so the pools overlap street-wide.
  // (~55 spots across the two pods — city-grade density. Water/decor tiles
  // are skipped at emit time in villageLamps, and `inside` spots are left
  // alone by the chunks.js tile-clearing pass so house floors stay intact.)
  const lamps = [];
  const lampSeen = new Set();
  const lampAdd = (pod, dx, dy, inside) => {
    const k = pod + ":" + dx + "," + dy;
    if (lampSeen.has(k)) return;
    lampSeen.add(k);
    lamps.push({ pod, dx, dy, inside: !!inside });
  };
  // PROPER HOUSES (user req 2026-09-16): real village buildings — chunks.js
  // stamps these through the same stampBuilding pipeline natural settlements
  // use (floors, walls, roof, a south door). x0/y0 are game-tile offsets of
  // the footprint's NW corner from the pod centre; placed clear of the path,
  // pier, seats, lamps and stamps.
  // MULTI-STOREY (user req 2026-09-17): kind "tut_house" (world.js
  // buildingMeta) gives each one a real upstairs reached by a ladder — a
  // hallway floor split into two bedroom alcoves, one per resident. The 14
  // "homing" tutors round-robin across the 7 houses, 2 each (divides evenly).
  const houses = [
    { pod: 0,  x0: -13, y0: -6,  w: 5, h: 5 },
    { pod: 0,  x0: 7,   y0: -9,  w: 5, h: 6 },
    { pod: 0,  x0: 8,   y0: 5,   w: 5, h: 5 },
    { pod: 14, x0: -12, y0: -12, w: 5, h: 5 },
    { pod: 14, x0: 6,   y0: -12, w: 6, h: 5 },
    { pod: 14, x0: -14, y0: -3,  w: 5, h: 5 },
    { pod: 14, x0: 9,   y0: 3,   w: 5, h: 5 },   // index 6 — closest to the green; also Sigrid's house
  ];
  // Sigrid's bedroom + the graduate's spare room live on a THIRD storey of
  // the house closest to the green, rather than a dedicated 8th building —
  // there's already ample bedroom capacity in the 7 houses, no need to add
  // more (user req 2026-09-17). Reached by climbing the same shared ladder
  // twice: floor 1 is its two regular tutors' hallway (unchanged), floor 2
  // is Sigrid's own bed (slot 0) + the spare bed (slot 1).
  const SIGRID_HOUSE_IDX = 6;
  houses.forEach((hb, i) => {
    hb.kind = "tut_house";
    hb.storeys = i === SIGRID_HOUSE_IDX ? 3 : 2;
    hb.residents = homing.filter((tu, ti) => ti % houses.length === i).map(tu => tu.id);
  });
  // deterministic bed tile: floor 1 = the hallway's two alcoves (NW/NE
  // corners) for the house's regular tutor residents; floor 2 (only
  // SIGRID_HOUSE_IDX has one) reuses the same NW/NE alcove positions one
  // storey up, for Sigrid (slot 0) and the spare room (slot 1)
  const bedTile = (hb, slot, floor) => ({
    x: slot === 1 ? hb.x0 + hb.w - 2 : hb.x0 + 1,
    y: hb.y0 + 1,
    level: floor || 1,
  });
  // build the lamp field (needs the house list above): door stands + indoor glows…
  for (const hb of houses) {
    lampAdd(hb.pod, hb.x0 + (hb.w >> 1) + 1, hb.y0 + hb.h, false);       // beside the door, not in it
    lampAdd(hb.pod, hb.x0 + (hb.w >> 1), hb.y0 + (hb.h >> 1), true);     // through-roof window glow
  }
  // …a lit ring around each green…
  for (const [pod, n] of [[0, 6], [14, 8]])
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.PI / n;
      lampAdd(pod, Math.round(Math.cos(a) * 7.5), Math.round(Math.sin(a) * 7.5), false);
    }
  // …and a jittered coverage grid so no street corner stays dark
  for (const pod of [0, 14])
    for (let gx = -16; gx <= 16; gx += 8)
      for (let gy = -16; gy <= 16; gy += 8) {
        if (Math.hypot(gx, gy) < 6) continue;                            // the ring owns the green
        const jx = gx + (((gx * 7 + gy * 13 + pod) % 3 + 3) % 3) - 1;
        const jy = gy + (((gx * 5 + gy * 11 + pod) % 3 + 3) % 3) - 1;
        if (houses.some(hb => hb.pod === pod && jx >= hb.x0 - 1 && jx < hb.x0 + hb.w + 1 &&
                              jy >= hb.y0 - 1 && jy < hb.y0 + hb.h + 1)) continue;
        lampAdd(pod, jx, jy, false);
      }
  return { seats, lamps, houses, sigridHouseIdx: SIGRID_HOUSE_IDX, bedTile };
})();

// (The Smith's KNIFE gift is the existing `knife` TOOL item (tool:"knife",
// toolcraft) — firemaking.js hasBladedWeapon now accepts a CARRIED knife as
// a spark striker, so no weapon needs wielding to light the furnace.)

// The Swim-Master's islet prize: a barnacled sea chest holding a pearl —
// the fetch-and-return that proves the snorkel lesson (REQS.swim below).
// The node itself is stamped by chunks.js at TUT_ISLE.islet's live seat.
if (typeof NODE_TYPES !== "undefined" && !NODE_TYPES.tut_seachest)
  NODE_TYPES.tut_seachest = {
    name: "Weathered sea chest", spr: "treasure_chest", skill: "Foraging",
    req: 1, xp: 40, item: "pearl", tool: null, tick: 1500, depleteCh: 1,
    respawn: 600000, deadSpr: null, gatherVerb: "Open",
  };

// Hand-placed content in ABSOLUTE game coords (built from the pod centres).
// { node } → resource/station · { decor } → decoration · { mon } → monster
// spawn · { label } → world-map label. The path, fences and gates are stamped
// procedurally in chunks.js from the chain geometry, not listed here.
const TUT_CONTENT = (() => {
  const P = TUT_ISLE.pods;
  const at = (i, dx, dy, rest) => ({ x: P[i].mx * 2 + dx, y: P[i].my * 2 + dy, ...rest });
  const stamps = [
    // pod 0 — the Landing
    at(0, 0, -8, { label: "Tūhura Isle", c: "#7fe3c7" }),
    at(0, 5, 3, { node: "berrybush", blk: false }),
    at(0, -5, 4, { node: "herbpatch", blk: false }),
    // the village's LANDING half (user req 2026-09-16: one open plains shore
    // across pods 0 and 14, no fence between them). PROPER HOUSES come from
    // TUT_VILLAGE.houses (chunks.js stampBuilding, the real settlement
    // pipeline) — only a tent and the odd camp fixture remain for flavour.
    at(0, -9, 7, { decor: "tent", blk: true }),
    at(0, -4, -7, { decor: "well_roofed", blk: true }),
    at(0, 5, 9, { decor: "stall", blk: true }),
    // pod 1 — the Bush: a THICKET of tier-1 trees + foraging (natural higher-
    // tier growth across the whole isle is also demoted to tier 1 — chunks.js)
    at(1, -5, -7, { node: "treeT0", blk: false }),
    at(1, -8, -3, { node: "treeT0", blk: false }),
    at(1, 5, -6, { node: "treeT0", blk: false }),
    at(1, -7, 4, { node: "treeT0", blk: false }),
    at(1, -10, -8, { node: "treeT0", blk: false }),
    at(1, -12, 1, { node: "treeT0", blk: false }),
    at(1, 8, -8, { node: "treeT0", blk: false }),
    at(1, 9, 2, { node: "treeT0", blk: false }),
    at(1, -3, 7, { node: "treeT0", blk: false }),
    at(1, 4, 8, { node: "treeT0", blk: false }),
    at(1, -11, -12, { node: "treeT0", blk: false }),
    at(1, 12, -4, { node: "treeT0", blk: false }),
    at(1, 6, 4, { node: "berrybush", blk: false }),
    at(1, -9, 7, { node: "berrybush", blk: false }),
    at(1, 3, -8, { node: "herbpatch", blk: false }),
    at(1, -4, -12, { node: "herbpatch", blk: false }),
    // pod 2 — the Cove: the radial RIVER runs through this sector (carved in
    // terrain.js; spring near the centre wall, mouth OPEN to the sea — the
    // weirs are gone, 2026-09-16: you ARRIVE by riding the current through
    // the river gate). Amenhotep + cookfire camp on the west bank; whitebait
    // (fishspot_0) run the stretch below the gate, netted from the banks.
    // The bridge is stamped by chunks.js where the path crosses to the Forge.
    at(2, -8, 3, { node: "campfire", extra: { station: true } }),
    // fishspots ALONG the river ray, downstream of the bridge (absolute
    // game coords computed from the ray)
    ...(() => {
      const Rv = TUT_ISLE.river, T = TUT_ISLE;
      const spot = (t, side) => ({
        x: Math.round((T.CX + Rv.ux * t - Rv.uy * side) * 2),
        y: Math.round((T.CY + Rv.uy * t + Rv.ux * side) * 2),
        node: "fishspot_0", blk: false, water: true, extra: { left: 16, leftMax: 16 },
      });
      const out = [];
      for (let k = 0; k < 6; k++) out.push(spot(Rv.rCross + 2.2 + k * 1.1, (k % 2 ? 0.7 : -0.7)));
      return out;
    })(),
    // the river's SOURCE, up by the centre wall (Vrixa's swim-up destination)
    { x: Math.round(TUT_ISLE.river.src.x * 2), y: Math.round(TUT_ISLE.river.src.y * 2) + 2, label: "River Source", c: "#8fd8ff" },
    // pod 3 — the Forge: anvil + furnace, a soft-copper terrace, one iron rock
    // and TWO tin rocks (copper+tin smelt to bronze, iron to iron; the extra
    // tin lets you carry a SPARE bronze bar to the woodcraft camp for arrows).
    // Nodes respawn. (Stamped AFTER the level-1 demotion pass, so the iron/tin
    // survive — everything natural on the isle is copper.)
    at(3, 4, 0, { node: "anvil", extra: { station: true } }),
    at(3, 7, -2, { node: "furnace", extra: { station: true } }),
    // THE TERRACE IS A LEDGER — HALVED, WITH SLACK (softened 2026-09-16):
    // every rock's yield is PINNED (extra.left skips gathering.js's 5-10
    // roll), and the isle-wide strip in chunks.js deletes every NATURAL
    // metal rock, so this is all the ore there is (per respawn cycle).
    // SMELTING WORKS IN SIX-ITEM FURNACE LOADS (bestiary-drops.js
    // normalizes every smelt recipe: inputs sum to 6, out 6 bars, xp ×6 —
    // copper 6→6 @120xp, bronze 4 copper + 2 tin → 6 @150xp, iron 6→6
    // @360xp). The old exact plan (8 copper + 2 bronze firings, no slack)
    // meant one wrong-order firing = wait out the respawn curve — the
    // harshest spike on the isle. Now Menkaure's keeper gift front-loads
    // demonstration xp (Smelting 550, Ore-mining 400 — see DLG.smith
    // reward) and the ledger runs at HALF the firings with spare stone:
    //  · smelt plan → Smelting 3 (1154 xp, required before ANY iron_bar
    //    can be smelted): gift 550 + FOUR copper firings (24 ore → 24
    //    bars, 480 xp; Smelting 2 = 650 falls after the first) + ONE
    //    bronze firing (4 copper + 2 tin → 6 bars, 150 xp) = 1180 ≥ 1154.
    //  · copper ore: 24 + 4 = 28 needed → FIVE rocks × 7 = 35 (7 spare)
    //  · tin: 2 needed → TWO rocks × 2 = 4 (2 spare). The spares absorb
    //    one whole stray firing (an extra copper load or an extra bronze)
    //    — a mis-ordered plan no longer strands anyone.
    //  · iron: ONE rock × 6 → one firing → 6 bars; the forge spends 4
    //    (2-bar sword + two 15-arrowhead batches at 1 bar), 2 spare.
    //  · mining xp (30/ore + the 400 gift): tin (Ore-mining 2 = 650)
    //    yields after ~9 copper ores, iron (3 = 1154) after ~26 — both
    //    inside the 35-copper run, so the ladder still unlocks itself.
    //  · PERFECT FIRING (optional, replaces the old required exactness):
    //    onCraft counts furnace loads in prog.firings; finish the whole
    //    kit in ≤6 firings (4 copper + 1 bronze + 1 iron, nothing stray)
    //    and Menkaure pays a 150-coin mastersmith's bonus.
    at(3, -5, -4, { node: "copper", extra: { left: 7, leftMax: 7 } }),
    at(3, -7, -7, { node: "copper", extra: { left: 7, leftMax: 7 } }),
    at(3, -9, -3, { node: "copper", extra: { left: 7, leftMax: 7 } }),
    at(3, -3, -11, { node: "copper", extra: { left: 7, leftMax: 7 } }),
    at(3, -10, -10, { node: "copper", extra: { left: 7, leftMax: 7 } }),
    at(3, -7, -10, { node: "rockM1", extra: { left: 2, leftMax: 2 } }),   // tin
    at(3, -9, -12, { node: "rockM1", extra: { left: 2, leftMax: 2 } }),   // tin
    at(3, -4, -8, { node: "iron", extra: { left: 6, leftMax: 6 } }),
    // pod 4 — the Lagoon (Swim-Master): the deep pool is carved in terrain; no
    // hand-placed content — Vrixa gifts the raft + snorkel.
    // pod 5 — the Bank camp: the vault, plus a carpenter's bench and a stand
    // of trees — saw planks and MAKE TEN EMPTY PAILS here (the milk chain
    // ahead runs on them; Torvak's stage requires the ten).
    at(5, 2, -2, { node: "bank", extra: { station: true } }),
    at(5, -4, 2, { node: "workbench", extra: { station: true } }),
    at(5, -9, -6, { node: "treeT0", blk: false }),
    at(5, 8, 5, { node: "treeT0", blk: false }),
    at(5, -8, 7, { node: "treeT0", blk: false }),
    // pod 6 — the Farm Vale: a millstone + livestock. QUAIL (keep_quail req 1)
    // and HENS (keep_hens req 2) earn Husbandry XP + the eggs; a sheep to
    // shear. (No cows here — milking waits for the Cook's herd, user req.)
    // Pre-grown crop rows are appended below.
    at(6, 12, -8, { node: "mill", extra: { station: true } }),
    at(6, -9, 9, { mon: "quail" }),
    at(6, -6, 10, { mon: "quail" }),
    at(6, -3, 9, { mon: "quail" }),
    at(6, -11, 11, { mon: "quail" }),
    at(6, -5, 13, { mon: "quail" }),
    at(6, 3, 9, { mon: "chicken" }),
    at(6, 6, 10, { mon: "chicken" }),
    at(6, 9, 9, { mon: "chicken" }),
    at(6, 11, 12, { mon: "chicken" }),
    at(6, 0, 11, { mon: "sheep" }),
    // THE SPECTACLE BEAT (2026-09-16): pods 5-8 are four gather-and-craft
    // lessons back to back — the isle's flattest stretch. One hand-stamped
    // Kuranui (moanui — the giant moa, SIZE 2.8, lvl 16, never aggressive)
    // grazing the open pasture breaks it: the first GIANT animal any fresh
    // hand meets, paying off Kenji's "one in six is born big" line and the
    // Farmhand stage note. Stamps bypass the TUT_TAME ambient strip.
    at(6, -8, 5, { mon: "moanui" }),
    // pod 7 — the Woodcrafting camp (Carpenter): fletcher's bench, sawmill,
    // carpenter's workbench (planks + PAILS for milking), and a stand of
    // logs. (The wand — and its essence rock — are GONE: no magic taught on
    // the isle, user req 2026-09-16. State runes still come off the pit's
    // rocks for the Warden's reagent lesson.)
    at(7, 5, -3, { node: "fletchers_bench", extra: { station: true } }),
    at(7, 8, 0, { node: "sawmill", extra: { station: true } }),
    at(7, 6, 3, { node: "workbench", extra: { station: true } }),
    at(7, -5, -3, { node: "treeT0", blk: false }),
    at(7, -8, 1, { node: "treeT0", blk: false }),
    at(7, -6, 4, { node: "treeT0", blk: false }),
    at(7, -10, -4, { node: "treeT0", blk: false }),
    // BANK CHESTS every second pod past Torvak's camp (user req 2026-09-15):
    // pods 7, 9, 11 and 13 each get a vault chest — same shared vault, so
    // the fletching arrows, pit loot and knoll gear can bank on the spot.
    at(7, 0, -7, { node: "bank", extra: { station: true } }),
    // pod 8 — the Cooking camp (Cook): cookfire (fritters), bakehouse
    // (flatbread), creamery (curds→cheese) and two COWS — milk them with your
    // pails (Husbandry 3, milk_cows) for the cheese.
    at(8, -7, 2, { node: "campfire", extra: { station: true } }),
    at(8, 3, -3, { node: "bakehouse", extra: { station: true } }),
    at(8, 7, 2, { node: "creamery", extra: { station: true } }),
    at(8, -5, 7, { mon: "cow" }),
    at(8, -2, 8, { mon: "cow" }),
    // pod 9 — the Warden's Pit: slimes (kill + action-rune drops) and boars
    // (tallow + hide) on the walkable SOUTH bank; the archery lesson is the
    // isle's BIRDS (slay five on the wing); two essence rocks (state runes).
    at(9, -3, 5, { mon: "slime" }),
    at(9, -6, 4, { mon: "slime" }),
    at(9, -4, 8, { mon: "slime" }),
    at(9, 2, 7, { mon: "slime" }),
    at(9, 5, 5, { mon: "boar" }),
    at(9, 7, 3, { mon: "boar" }),
    at(9, 4, 9, { mon: "boar" }),
    // the archery lesson's koreke — quail that flush and fly when startled,
    // so every kill is a real shot on the wing
    at(9, -10, -6, { mon: "koreke" }),
    at(9, -5, -9, { mon: "koreke" }),
    at(9, 1, -11, { mon: "koreke" }),
    at(9, 7, -8, { mon: "koreke" }),
    at(9, 11, -4, { mon: "koreke" }),
    at(9, 12, 6, { mon: "koreke" }),
    at(9, -8, 3, { node: "essence" }),
    at(9, 8, 4, { node: "essence" }),
    at(9, -3, -4, { node: "bank", extra: { station: true } }),
    at(11, 3, 2, { node: "bank", extra: { station: true } }),
    at(13, 5, 3, { node: "bank", extra: { station: true } }),
    // pod 10 — the Springs (Soapmaker), NOW AFTER combat: a charcoal clamp (char
    // your logs → wood ash), a soap works (leach lye, boil it with your warden's
    // tallow into soap) beside the waist-deep wash pool. Scrub off all your stink.
    at(10, -7, 3, { node: "charcoal_clamp", extra: { station: true } }),
    at(10, -3, 4, { node: "soap_works", extra: { station: true } }),
    // pod 11 — the Sky Knoll (Skywatcher): the crest is a terrain bump; no
    // content — climb it for the weather/time lesson.
    // pod 12 — the Candle Hollow (Candlemaker): a spinning wheel (spin your
    // harvested flax into linen thread) and a chandlery (spin wicks + dip a
    // tallow candle from your warden's-pit tallow).
    at(12, -5, 2, { node: "spinning_wheel", extra: { station: true } }),
    at(12, 5, -2, { node: "chandlery", extra: { station: true } }),
    // pod 13 — the Portal Crown: the ancient portal + a RUNESTONE ALTAR —
    // Runa's lesson is RUNECRAFTING (her 50 gifted state runes become 50
    // air runes here; no spellcasting is taught on the isle, user req)
    at(13, 0, -6, { node: "portal", extra: { portal: true } }),
    at(13, -4, 2, { node: "altar", extra: { station: true } }),
    // pod 14 — the HARBOUR half of the village (user req 2026-09-16): the
    // keepers' own kāinga — PROPER HOUSES (TUT_VILLAGE.houses, stamped by
    // chunks.js through the real settlement building pipeline) about a green
    // with a well, a fire ring, benches and a couple of tents. As dusk
    // settles the keepers met through the day come home to their seats here
    // (TUT_VILLAGE + Tutorial.villageHome) and the lamp stands glow alight
    // one by one (Tutorial.villageLamps → daynight.js).
    at(14, 1, 9, { decor: "tent", blk: true }),
    at(14, -6, 7, { decor: "tent2", blk: true }),
    at(14, 3, 2, { decor: "well", blk: true }),
    at(14, -1, 4, { decor: "campfire_ring" }),
    at(14, -2, -3, { decor: "bench_trestle" }),
    at(14, 2, 5, { decor: "city_bench" }),
    at(14, 0, 13, { label: "Harbour Village", c: "#ffd75e" }),
  ];
  // THE FARM (user req 2026-09-16, replaces the old 50-plot open rows): ONE
  // fenced 5×5 plot square at the crown's exact centre — five rows, one crop
  // per row, five RIPE plots each (plantedAt 0) — ringed by a fence with a
  // single gate mid-east, facing the path (whose crown vertex is nudged SE
  // in terrain.js so the dirt dog-leg skirts the fence past the gate). The
  // stage asks for FIFTY of each crop (FARM_GOALS): a full first harvest
  // averages ~37 per crop (5 plots × 5-10), so at least one replant-and-
  // regrow cycle (~3 min for tier-0 crops) is deliberately part of the
  // lesson; Kenji's gift carries 10 seeds of each to keep replanting
  // solvent (sowing costs 5, each harvested crop returns one 60% of the
  // time — the maths hold but don't drown the player in spares).
  const CROP_ROWS = [
    ["farm_cerealiculture_0", -2],  // wheat
    ["farm_olericulture_0",   -1],  // potato
    ["farm_pomiculture_0",     0],  // apple (tree crop)
    ["farm_herbiculture_0",    1],  // sageleaf
    ["farm_fibriculture_0",    2],  // flax
  ];
  for (const [kind, dyRow] of CROP_ROWS)
    for (let k = -2; k <= 2; k++)
      stamps.push(at(6, k, dyRow, { node: "farmplot", blk: false,
        extra: { farm: true, tilled: true, crop: { kind, plantedAt: 0 } } }));
  {
    const ring = new Set();
    for (let d = -3; d <= 3; d++)
      for (const [fx, fy] of [[d, -3], [d, 3], [-3, d], [3, d]]) ring.add(fx + "," + fy);
    ring.delete("3,0"); // the gate
    for (const k of ring) {
      const [fx, fy] = k.split(",").map(Number);
      stamps.push(at(6, fx, fy, { decor: "fence_wood", blk: true }));
    }
    stamps.push(at(6, 3, 0, { decor: "gate_wood" }));
  }
  // pod 14 — the Harbour pier: a decked walk out over the water to the waka
  // the Harbour PIER: decking from pod 14's camp straight out to sea, along
  // its outward radial (the coast lies RO - podRadius ≈ 11 map units out)
  {
    const a = TUT_ISLE.pods[14].ang * Math.PI / 180;
    for (let k = 12; k <= 30; k++)
      stamps.push(at(14, Math.round(Math.cos(a) * k), Math.round(Math.sin(a) * k), { decor: "stone_bridge" }));
  }
  return { stamps };
})();

// ---------- the tutorial module ----------
const Tutorial = (() => {
  const pods = () => TUT_ISLE.pods;
  const podXY = i => [pods()[i].mx * 2, pods()[i].my * 2];
  // fresh spawns wake on the Landing's BEACH — outward of pod 0, toward the coast
  const START = {
    get x() { return podXY(0)[0] + Math.round(Math.cos(pods()[0].ang * Math.PI / 180) * 10); },
    get y() { return podXY(0)[1] + Math.round(Math.sin(pods()[0].ang * Math.PI / 180) * 10); },
  };

  // real roster names (TUT_MIX_DEF above); {id} tokens in dialogue text and
  // stage notes resolve to them so the copy always matches the actual cast
  const tutorName = tu => { const d = TUT_MIX_DEF(TUT_TUTORS.indexOf(tu)); return d && d.name ? d.name : tu.name; };
  const tutorFull = tu => `${tutorName(tu)} the ${tu.role}`;
  const subst = s => s.replace(/\{(\w+)\}/g, (_, id) => {
    const tu = TUT_TUTORS.find(t2 => t2.id === id);
    return tu ? tutorName(tu) : id;
  });

  let _seenCount = 0;
  let _offStreak = 0; // consecutive tick()s spent reading as "off the isle"
  function state() {
    if (typeof player === "undefined") return null;
    // A character standing OFF the isle can only be a graduate: veteran saves
    // carry tutorial:null (storage.js) and are never re-schooled, and a live
    // tutorial cannot leave the isle (gates, fences, mist). So a missing
    // record seeds as already-completed off the isle, and a "live" record
    // found off the isle (saves poisoned by the old resurrection bug, cheat
    // teleports) graduates on the spot — the journey bar comes down with it.
    // Fresh spawns and character resets seed standing at Tutorial.START, so
    // they still get the live journey.
    const off = !onIsle();
    if (!player.tutorial || typeof player.tutorial !== "object")
      player.tutorial = { seen: {}, given: {}, welcomed: off ? 1 : 0, graduated: off ? 1 : 0 };
    const t = player.tutorial;
    // this graduation is irreversible, so require a few consecutive off-isle
    // ticks before latching it — a single stray frame (e.g. right at the
    // islet-channel's geometry edge, mid-swim) must not permanently end a
    // live tutorial; a real off-isle character (teleport, poisoned save)
    // stays off for many ticks in a row regardless
    _offStreak = off ? _offStreak + 1 : 0;
    if (_offStreak > 20 && !t.graduated) {
      t.graduated = 1; t.welcomed = 1;
      if (barEl) { barEl.remove(); barEl = null; }
    }
    if (!t.seen) t.seen = {};
    if (!t.given) t.given = {};
    // MIGRATIONS (table): stages have gained goals / raised counts over the
    // 2026-09 rounds. A save that has already MET a LATER keeper can only
    // have passed the earlier gate under the old rules — credit the current
    // goals so no gate re-latches behind a mid-journey character. Keyed by
    // the NEXT keeper's seen flag; credits never lower an existing count.
    {
      const MIG = [
        ["fish",  { queuedTrees: 5, trees: 5 }],                   // bush: queue+fell
        ["smith", { braced: 1, whitebait: 5 }],                    // fish: brace goal + whitebait
        ["swim",  { furnaceLit: 1, arrowheads: 30 }],              // smith: furnace + head counters
        ["bank",  { isletPearl: 1, isletReturn: 1 }],              // swim: the motu errand
        ["farm",  { deposits: 1, pails: 9 }],                      // bank: the pails goal
        ["wood",  { cropWheat: 20, cropPotato: 20, cropApple: 20, cropSage: 20, cropFlax: 20,
                    flour: 10, eggs: 10, feathers: 10, twinned: 1 }],  // farm goals + the split lesson
        ["cook",  { shafts: 300, arrow_iron: 30, merged: 1 }],     // wood: the shaft ladder + the reunion
        ["candle", { chatted: 1 }],                                // sky: Ravenna's chat
        ["ferry", { airRunes: 50, rushlightEquipped: 1 }],         // lore: altar runecrafting + rushlight
      ];
      for (const [k, credit] of MIG) {
        if (!t.seen[k]) continue;
        t.prog = t.prog || {};
        for (const c in credit) if ((t.prog[c] || 0) < credit[c]) t.prog[c] = credit[c];
      }
    }
    _seenCount = Object.keys(t.seen).length;
    return t;
  }
  const sd = () => (typeof player !== "undefined" && typeof tutIsleSD === "function")
    ? tutIsleSD(player.x / 2, player.y / 2) : null;
  // inside the Swim-Master's islet wedge (channel + motu, MAP coords)? Part
  // of the isle for onIsle() — a swimmer mid-crossing (or resting on the
  // motu) is emphatically NOT "off the isle", or state() would graduate
  // them mid-stroke — and the hull-bar / mist region for barred().
  function inIsletRegion(mx, my) {
    const I = (typeof TUT_ISLE !== "undefined") ? TUT_ISLE.islet : null;
    if (!I) return false;
    const dx = mx - TUT_ISLE.CX, dy = my - TUT_ISLE.CY;
    const iux = Math.cos(TUT_ISLE.IA), iuy = Math.sin(TUT_ISLE.IA);
    const it = dx * iux + dy * iuy, is = -dx * iuy + dy * iux;
    const isletR = Math.hypot(I.x - TUT_ISLE.CX, I.y - TUT_ISLE.CY);
    // cross-track tolerance must match (or stay inside) terrain.js's isletZone
    // reservation (s in [-12, 12]) — a swimmer drifting with the chop on the
    // return leg was falling outside a narrower ±10 band for a single frame,
    // wrongly reading as "off the isle" (see inIsletRegion callers below)
    return it > TUT_ISLE.RO - 2 && it < isletR + 6 && Math.abs(is) < 12;
  }
  const onIsle = () => {
    const q = sd();
    return !!q && (q.D < 16 || inIsletRegion(player.x / 2, player.y / 2));
  };
  // tutorial "instance" is live: a not-yet-graduated tutorial character
  const active = () => typeof player !== "undefined" && player.tutorial &&
    typeof player.tutorial === "object" && !player.tutorial.graduated;
  // ---------- the Smith's forge task ----------
  // The Smith stage isn't cleared by talk alone: the player must LIGHT THE
  // FURNACE (knife + flint + logs — onStoke) and FORGE the four lesson
  // pieces with their own skill (two iron on Weaponsmithing, two bronze on
  // Armoursmithing). Equipping them is advice, not a gate (user req
  // 2026-09-16). No tutor grants XP (experience comes solely from working
  // the isle's resources) — and none is needed: all four forge recipes are
  // req 1; the real ladder is Ore-mining/Smelting 1→3 (copper swings and
  // copper/bronze bars) to reach the iron rock and bar.
  const SMITH_ITEMS = ["shortsword_iron", "chainbody_bronze", "targe_bronze"];
  const SMITH_HEADS = 30; // iron arrowheads to smith (2 anvil batches of 15 — user cut 300 → 30)
  const SMITH_RECIPES = new Set(["smith_shortsword_iron", "smith_arrowhead_iron", "smith_chainbody_bronze", "smith_targe_bronze"]);
  const smithForged = () => { const t = state(); const m = (t && t.smithMade) || {}; return SMITH_ITEMS.every(id => m[id]); };
  // a tutor's stage counts as cleared only when its dialogue is seen AND its
  // hands-on task is finished
  const hasBody = () => typeof player !== "undefined" && player && player.character != null;

  // ---------- stage requirements ----------
  // EVERY stage has a hands-on task beyond meeting its keeper (user req); the
  // gate only unbars when BOTH are done, and the journey bar shows the pair
  // as checkboxes. Counter-based tasks store progress in player.tutorial.prog
  // (persisted); the counters are fed by small hooks in gameplay code:
  //   onGather (skills/gathering.js tickGather — trees, whitebait, state runes)
  //   · onQueue (split.js capture — the Bushman's queued felling jobs)
  //   · onBrace (movement.js — Shift held in a current, the Fisher's stance)
  //   · onStoke (firemaking.js — the Smith's furnace lit)
  //   · onCraft (skills/crafting.js — smith pieces, flour, shafts/arrows/bow,
  //     air runes, fritters, cheese, flatbread, candle) · onHarvest
  //     (skills/farming.js — the five crops) · onTend (husbandry-animals.js —
  //     eggs + feathers) · onWash (stink.js — scrub clean) · onBank (ui.js) ·
  //     onKill (combat.js — slimes, the warden's birds) · onPickup (items.js —
  //     tallow/hide/action-rune kill drops) · onEquip (items.js — the candle)
  //     · tick() below (the pearl back to Vrixa / the Sky Knoll crest).
  // Counters pre-accumulate happily and stop at `need`.
  const cnt = (t, c) => (t.prog && t.prog[c]) || 0;
  const allGoals = (t, arr) => arr.every(([c, n]) => cnt(t, c) >= n);
  const numGoals = (t, arr) => arr.filter(([c, n]) => cnt(t, c) >= n).length;
  // multi-part stage goal sets: [counter, need, label] triples — the label is
  // the single source for both the task-log lines (bumpGoal) and the journey
  // bar's itemised requirement rows (goalItems), so the two can't drift.
  // the Bushman also TEACHES the Option+click queue: queue ten felling jobs,
  // then let the hands work the list (split.js capture → onQueue below)
  const BUSH_GOALS = [["queuedTrees", 5, "queue up 5 trees for felling (Option+click)"], ["trees", 5, "fell 5 trees"]];
  // the Fisher's first lesson is the BRACE (hold Shift in a current) — the
  // net is useless until your feet are dug in (movement.js → onBrace)
  const FISH_GOALS = [["braced", 1, "brace yourself in the water (hold Shift)"], ["whitebait", 5, "catch 5 whitebait"]];
  const BANK_GOALS = [["deposits", 1, "deposit an item"], ["pails", 9, "make 9 empty pails"]];
  // 50 of EACH crop (user req 2026-09-16) off the fenced 5×5: a first full
  // harvest averages ~37 per crop, so replanting-and-regrowing is required.
  // The 10 feathers are Torra's exact arrow budget (2 batches × 5).
  // …and the SPLIT-SELVES lesson lives here (user req 2026-09-16): the regrow
  // waits make the farm the natural place to learn X — one self reaps and
  // replants while the other works elsewhere (tick() detects both busy at
  // once). The reunion is Torra's goal, via Kenji's shortcut gate.
  const FARM_GOALS = [["cropWheat", 20, "harvest 20 wheat"], ["cropPotato", 20, "harvest 20 potatoes"], ["cropApple", 20, "harvest 20 apples"], ["cropSage", 20, "harvest 20 sageleaves"], ["cropFlax", 20, "harvest 20 flax"], ["flour", 10, "mill 10 flour"], ["eggs", 10, "collect 10 eggs"], ["feathers", 10, "collect 10 feathers"], ["twinned", 1, "split in two (press X) & keep both selves working"]];
  // 300 shafts (20 cuts × 35 xp = 700) land Fletching 2 — exactly the level
  // iron arrows demand (the shortbow is req 2 as well — data.js); the wand
  // is GONE (no magic on the isle, user req)
  const WOOD_GOALS = [["merged", 1, "merge your selves back into one (X, side by side)"], ["shafts", 300, "cut 300 arrow shafts"], ["arrow_iron", 30, "fletch 30 iron arrows"], ["shortbow", 1, "carve a shortbow"]];
  const COOK_GOALS = [["fritters", 5, "cook 5 whitebait fritters"], ["cheese", 1, "make cottage cheese"], ["flatbread", 5, "bake 5 flatbread"]];
  const WAR_GOALS  = [["slimes", 3, "slay 3 slimes"], ["tallow", 1, "gather 1 tallow"], ["actionRune", 3, "gather 3 action runes"], ["stateRune", 3, "gather 3 state runes"], ["hide", 3, "gather 3 hide"], ["koreke", 1, "slay 1 koreke"]];
  // the Swim-Master's islet errand (user req 2026-09-16): snorkel out past
  // bare-lungs range, lift the sea chest's pearl, and swim it back to HER
  const SWIM_GOALS = [["isletPearl", 1, "open the islet's sea chest"], ["isletReturn", 1, "bring the pearl back to Vrixa"]];
  // the Loremaster's lesson is RUNECRAFTING, not spellcasting: her 50 gifted
  // state runes become 50 air runes at the crown's altar (no magic taught).
  // Second goal (user req 2026-09-16): equip a rushlight — the isle's sky
  // holds at dusk until BOTH goals are done (skyIdx/maybeLoreNight below),
  // so the player always has light to work the altar by.
  const LORE_GOALS = [["airRunes", 50, "craft 50 air runes at the altar"], ["rushlightEquipped", 1, "equip a rushlight"]];
  const GOALS = {}; // counter -> [cap, label]
  for (const arr of [BUSH_GOALS, FISH_GOALS, BANK_GOALS, FARM_GOALS, WOOD_GOALS, COOK_GOALS, WAR_GOALS, SWIM_GOALS, LORE_GOALS])
    for (const [c, n, label] of arr) GOALS[c] = [n, label];
  GOALS.arrowheads = [SMITH_HEADS, `smith ${SMITH_HEADS} iron arrowheads`]; // smith stage counter (15/batch)
  GOALS.furnaceLit = [1, "light the furnace"];                              // smith stage counter (onStoke)
  GOALS.chatted = [1, "say something to Ravenna & hear her answer"];        // sky stage counter (onChatReply)
  // journey-bar itemisation: one {on, num, need, label} row per goal
  const goalItems = arr => t => arr.map(([c, n, label]) =>
    ({ on: cnt(t, c) >= n, num: Math.min(n, cnt(t, c)), need: n, label }));
  const REQS = {
    guide: { task: "take a form",              done: () => hasBody() },
    bush:  { task: "queue 5 trees & fell 5 trees", need: BUSH_GOALS.length, done: t => allGoals(t, BUSH_GOALS), num: t => numGoals(t, BUSH_GOALS), items: goalItems(BUSH_GOALS) },
    fish:  { task: "brace in the current & catch 5 whitebait", need: FISH_GOALS.length, done: t => allGoals(t, FISH_GOALS), num: t => numGoals(t, FISH_GOALS), items: goalItems(FISH_GOALS) },
    // forge the four pieces + LIGHT THE FURNACE — equipping is advice now,
    // not a gate (user req 2026-09-16)
    smith: { task: "light the furnace & forge your kit", need: SMITH_ITEMS.length + 2,
             done: t => smithForged() && cnt(t, "arrowheads") >= SMITH_HEADS && cnt(t, "furnaceLit") >= 1,
             num: t => SMITH_ITEMS.filter(id => t.smithMade && t.smithMade[id]).length + (cnt(t, "arrowheads") >= SMITH_HEADS ? 1 : 0) + (cnt(t, "furnaceLit") >= 1 ? 1 : 0),
             items: t => {
               const made = (t && t.smithMade) || {};
               const nm = id => (typeof ITEMS !== "undefined" && ITEMS[id]) ? ITEMS[id].name.toLowerCase() : id;
               const heads = cnt(t, "arrowheads"), lit = cnt(t, "furnaceLit");
               return [{ on: lit >= 1, num: Math.min(1, lit), need: 1, label: "light the furnace" }]
                 .concat(SMITH_ITEMS.map(id => ({ on: !!made[id], num: made[id] ? 1 : 0, need: 1, label: "forge " + nm(id) })))
                 .concat([{ on: heads >= SMITH_HEADS, num: Math.min(SMITH_HEADS, heads), need: SMITH_HEADS, label: `smith ${SMITH_HEADS} iron arrowheads` }]);
             } },
    soap:  { task: "wash off all your stink",  done: t => !!t.washedClean },
    swim:  { task: "fetch the islet's pearl & swim it home", need: SWIM_GOALS.length, done: t => allGoals(t, SWIM_GOALS), num: t => numGoals(t, SWIM_GOALS), items: goalItems(SWIM_GOALS) },
    bank:  { task: "deposit an item & make 9 pails", need: BANK_GOALS.length, done: t => allGoals(t, BANK_GOALS), num: t => numGoals(t, BANK_GOALS), items: goalItems(BANK_GOALS) },
    farm:  { task: "harvest 20 of each crop, mill flour, gather eggs & feathers", need: FARM_GOALS.length, done: t => allGoals(t, FARM_GOALS), num: t => numGoals(t, FARM_GOALS), items: goalItems(FARM_GOALS) },
    wood:  { task: "cut 300 shafts, fletch 30 arrows, carve a bow", need: WOOD_GOALS.length, done: t => allGoals(t, WOOD_GOALS), num: t => numGoals(t, WOOD_GOALS), items: goalItems(WOOD_GOALS) },
    cook:  { task: "cook fritters, cheese & flatbread", need: COOK_GOALS.length, done: t => allGoals(t, COOK_GOALS), num: t => numGoals(t, COOK_GOALS), items: goalItems(COOK_GOALS) },
    war:   { task: "clear the pit & slay 1 koreke", need: WAR_GOALS.length, done: t => allGoals(t, WAR_GOALS), num: t => numGoals(t, WAR_GOALS), items: goalItems(WAR_GOALS) },
    // the Skywatcher's stage also SHOWCASES the semantic chat (user req):
    // say anything to her (Enter) and hear a real, un-canned answer
    sky:   { task: "climb the Sky Knoll & really talk to Ravenna", need: 2,
             done: t => !!t.reachedKnoll && cnt(t, "chatted") >= 1,
             num: t => (t.reachedKnoll ? 1 : 0) + (cnt(t, "chatted") >= 1 ? 1 : 0),
             items: t => [
               { on: !!t.reachedKnoll, num: t.reachedKnoll ? 1 : 0, need: 1, label: "climb the Sky Knoll" },
               { on: cnt(t, "chatted") >= 1, num: Math.min(1, cnt(t, "chatted")), need: 1, label: "say something to Ravenna (Enter) & hear her answer" },
             ] },
    candle:{ task: "dip a rushlight",          done: t => !!t.candleMade,
             items: t => [
               { on: !!(t && t.candleMade), num: (t && t.candleMade) ? 1 : 0, need: 1, label: "dip a rushlight" },
             ] },
    lore:  { task: "craft 50 air runes at the altar & equip a rushlight", need: LORE_GOALS.length, done: t => allGoals(t, LORE_GOALS), num: t => numGoals(t, LORE_GOALS), items: goalItems(LORE_GOALS) },
    // sleep at Sigrid's before the crossing (user req 2026-09-17) — a real
    // task now, so it shows in the journey/goals panel like every other stage
    ferry: { task: "sleep at Sigrid's spare room, then find her again", done: t => !!(t && t.sleptAtSigrids) },
  };
  function reqDone(id) {
    const r = REQS[id]; if (!r) return true;
    const t = state(); if (!t) return true;
    if (r.done) return !!r.done(t);
    return ((t.prog && t.prog[r.n]) || 0) >= r.need;
  }
  function reqNum(id) {
    const r = REQS[id]; const t = state();
    if (!r || !t) return 0;
    if (r.num) return r.num(t);
    if (r.done) return r.done(t) ? 1 : 0;
    return Math.min(r.need, (t.prog && t.prog[r.n]) || 0);
  }
  const reqNeed = id => { const r = REQS[id]; return r ? (r.need || 1) : 0; };
  // bump counter `c` toward cap `cap` by `inc` (default 1); logs + refreshes.
  // Generic — works for both single-stage `.n` counters and the multi-part
  // goal counters (FARM_GOALS etc.), which don't map 1:1 to a REQS entry.
  function bumpProg(c, cap, label, inc) {
    if (!active()) return;
    const t = state(); if (!t) return;
    const p = t.prog || (t.prog = {});
    if ((p[c] || 0) >= cap) return;
    p[c] = Math.min(cap, (p[c] || 0) + (inc || 1));
    if (typeof log === "function")
      log(`Task — ${label}: ${p[c]}/${cap}${p[c] >= cap ? " ✓" : ""}`, "gold");
    if (p[c] >= cap && typeof sfx === "function") sfx("quest", 0.4);
    refreshBar();
    if (typeof saveGame === "function") saveGame();
  }
  // bump a single-stage `.n` counter (looks up its cap + label from REQS)
  function reqBump(counter) {
    const id = Object.keys(REQS).find(k => REQS[k] && REQS[k].n === counter);
    if (!id) return;
    bumpProg(counter, REQS[id].need, REQS[id].task);
  }
  // bump a multi-part goal counter (cap + label from the GOALS table)
  function bumpGoal(counter, inc) {
    const g = GOALS[counter]; if (!g) return;
    bumpProg(counter, g[0], g[1], inc);
  }
  // gameplay hooks (see REQS above). onGather fires once per successful gather
  // tick with `depleted` true when the node just gave out.
  function onGather(node, nt, item, depleted) {
    if (!active() || !nt) return;
    if (depleted && nt.skill === "Woodcutting") bumpGoal("trees");
    if (item === "raw_fish") bumpGoal("whitebait");
    if (item === "state_rune") bumpGoal("stateRune");
    if (item === "pearl" && node && node.type === "tut_seachest") {
      bumpGoal("isletPearl");
      if (typeof log === "function")
        log("The pearl is yours — now swim it home to the lagoon shore. Mind your air!", "sys");
    }
  }
  // queue-capture hook (split.js capture): the Bushman's stage counts
  // felling jobs queued with Option+click — the mechanic IS the lesson
  function onQueue(goal) {
    if (!active() || !goal || goal.type !== "gather" || !goal.node) return;
    const nt = (typeof NODE_TYPES !== "undefined") ? NODE_TYPES[goal.node.type] : null;
    if (nt && nt.skill === "Woodcutting") bumpGoal("queuedTrees");
  }
  // brace hook (movement.js, every frame Shift is held in a current): the
  // Fisher's first checkbox — one-shot, so the per-frame call stays cheap
  function onBrace() {
    if (!active()) return;
    const t = state();
    if (!t || (t.prog && t.prog.braced)) return;
    bumpGoal("braced");
  }
  // stoke hook (firemaking.js stokeFire, after a successful stoke): the
  // Smith's "light the furnace" checkbox
  function onStoke(node) {
    if (!active() || !node || node.type !== "furnace") return;
    bumpGoal("furnaceLit");
  }
  // merge hook (split.js doMerge): Torra's "back into one" checkbox
  function onMerge() {
    if (!active()) return;
    bumpGoal("merged");
  }
  // semantic-chat hook (npc-chat.js, fired when a retrieval reply is actually
  // SAID): Ravenna's "hear her answer" checkbox — hers alone, so the wow
  // moment happens where her dialogue set it up
  function onChatReply(npc) {
    if (!active() || !npc || npc.tutor !== "sky") return;
    bumpGoal("chatted");
  }
  // farm crop key → goal counter (caps + labels live in FARM_GOALS)
  const CROP_TASK = {
    farm_cerealiculture_0: "cropWheat",
    farm_olericulture_0:   "cropPotato",
    farm_pomiculture_0:    "cropApple",
    farm_herbiculture_0:   "cropSage",
    farm_fibriculture_0:   "cropFlax",
  };
  function onHarvest(cropKey) {
    if (!active()) return;
    bumpGoal(CROP_TASK[cropKey]);
  }
  // husbandry tend — fired once per output item produced (id, qty)
  function onTend(itemId, qty) {
    if (!active()) return;
    // quail eggs are a DIFFERENT item — only NORMAL eggs (from the hens) count
    // toward the farm pod's eggs goal, not quail eggs (user request)
    if (itemId === "egg") bumpGoal("eggs", qty || 1);
    // feathers off the quail and hens — Torra's exact arrow budget ahead
    if (itemId === "feathers") bumpGoal("feathers", qty || 1);
  }
  // washing at the springs: cleared once soap has scrubbed you fully clean
  // (stinkTotal 0). stink.js fires this on every wash — including a wash while
  // already clean — so the stage can't wedge if a fresh hand reaches the pool
  // with no stink to speak of.
  function onWash() {
    if (!active()) return;
    const t = state(); if (!t || t.washedClean) return;
    const tot = (typeof stinkTotal === "function") ? stinkTotal() : 0;
    if (tot <= 0) {
      t.washedClean = 1;
      if (typeof log === "function") log("Task — wash off all your stink: clean ✓", "gold");
      if (typeof sfx === "function") sfx("quest", 0.4);
      refreshBar();
      if (typeof saveGame === "function") saveGame();
    }
  }
  const onBank = () => bumpGoal("deposits");
  // out-of-arrows hook (combat.js archery, the quiver-empty branch): Yuki
  // keeps the koreke hunt from stalling on a bad quiver count — she runs up
  // with 30 more iron arrows, every time, until the koreke goal is met
  // (user req 2026-09-16). Returns true if she resupplied, so combat.js can
  // skip its own "out of arrows" warning that round.
  function onOutOfArrows() {
    if (!active()) return false;
    const t = state();
    if (!t || !t.seen.war || cnt(t, "koreke") >= (GOALS.koreke ? GOALS.koreke[0] : 1)) return false;
    player.equip.quiver = { id: "arrow_iron", qty: 30 }; // straight into the slot — no re-equip friction mid-hunt
    if (typeof log === "function") log('Yuki comes running up to you: "Here, have some more arrows."', "sys");
    uiDirty = true;
    return true;
  }
  // kill hook — combat.js passes the monster kind
  function onKill(kind) {
    if (!active()) return;
    if (kind === "slime") bumpGoal("slimes");
    else if (String(kind).replace(/_v$/, "") === "koreke")
      bumpGoal("koreke"); // the warden's archery lesson: the pit's quail
  }
  // ground-loot pickup hook (items.js pickUp): the warden-pit reagents
  function onPickup(id, qty) {
    if (!active()) return;
    if (id === "tallow") bumpGoal("tallow", qty || 1);
    else if (id === "hide") bumpGoal("hide", qty || 1);
    else if (id === "action_rune") bumpGoal("actionRune", qty || 1);
    else if (id === "state_rune") bumpGoal("stateRune", qty || 1);
  }
  // equip hook (items.js equipItem): the smith's worn pieces + the candle
  function onEquip(id) {
    if (!active()) return;
    const t = state(); if (!t) return;
    // (the smith's equip requirement is gone — only the candle is tracked)
    if (typeof ITEMS !== "undefined" && ITEMS[id] && ITEMS[id].light && !t.candleEquipped) {
      t.candleEquipped = 1; // tracked but not a stage requirement
      refreshBar(); if (typeof saveGame === "function") saveGame();
    }
    // the Loremaster's second goal (LORE_GOALS): equip a rushlight —
    // whichever of her two goals lands last is the moment night falls
    if (id === "rushlight") {
      const wasDone = reqDone("lore");
      bumpGoal("rushlightEquipped");
      maybeLoreNight(wasDone);
    }
  }
  const onChant = () => reqBump("chants");

  function tutorComplete(id) {
    const t = state(); if (!t || !t.seen[id]) return false;
    return reqDone(id);
  }
  // index of the first tutor whose stage is NOT complete — the player may roam
  // pods 0..frontier; gate `frontier` (at chain s = frontier + 0.5) is shut
  function frontier() {
    const t = state();
    if (!t) return 0;
    for (let i = 0; i < TUT_TUTORS.length; i++) if (!tutorComplete(TUT_TUTORS[i].id)) return i;
    return TUT_TUTORS.length;
  }
  // craft-completion hook (skills/crafting.js tickCraft, passes the OUTPUT item
  // id): milling, the woodcraft pieces, the cook's dishes, the candle, and the
  // smith's forged four (forging also needs the pieces EQUIPPED — see onEquip —
  // before the forge stage clears).
  function onCraft(itemId) {
    if (!active()) return;
    switch (itemId) {
      case "flour":          return bumpGoal("flour");
      case "pail":           return bumpGoal("pails");
      case "arrowhead_iron": { // one anvil batch = 15 heads
        bumpGoal("arrowheads", 15);
        maybePerfectFiring(state()); // heads can be the ledger's last stroke
        return;
      }
      case "copper_bar": case "bronze_bar": case "iron_bar": {
        // count furnace loads for the optional PERFECT FIRING bonus (see the
        // terrace-ledger comment in TUT_CONTENT) — no announcement, no goal
        // row: exactness is a flourish now, not a requirement
        const t = state();
        if (t) t.prog.firings = (t.prog.firings || 0) + 1;
        return;
      }
      case "arrow_shafts":   return bumpGoal("shafts", 15);     // one cut = 15 shafts
      case "arrow_iron":     return bumpGoal("arrow_iron", 15); // one fletch = 15 arrows
      case "shortbow":       return bumpGoal("shortbow");
      case "air_rune": { // the Loremaster's altar lesson — yield mirrors
        // craftOnce's scaleYield formula (base 1 + level/8 bonus runes)
        const wasDone = reqDone("lore");
        bumpGoal("airRunes", 1 + Math.floor(((typeof eff === "function") ? eff("Runecrafting") : 1) / 8));
        maybeLoreNight(wasDone);
        return;
      }
      case "cooked_fish":    return bumpGoal("fritters");
      case "cottage_cheese": return bumpGoal("cheese");
      case "flatbread":      return bumpGoal("flatbread");
      case "rushlight":  // Miles's goal (user req): dip the humble rushlight —
      case "candle": {   // a full candle counts too, for the keen ones
        const t = state();
        if (t && !t.candleMade) {
          t.candleMade = 1;
          if (typeof log === "function") log("Task — dip a rushlight: dipped ✓", "gold");
          refreshBar(); if (typeof saveGame === "function") saveGame();
        }
        return;
      }
    }
    if (SMITH_ITEMS.indexOf(itemId) < 0) return;
    const t = state(); if (!t) return;
    if (!t.smithMade) t.smithMade = {};
    if (t.smithMade[itemId]) return;
    t.smithMade[itemId] = 1;
    const made = SMITH_ITEMS.filter(id => t.smithMade[id]).length;
    if (typeof log === "function") {
      const nm = (typeof ITEMS !== "undefined" && ITEMS[itemId]) ? ITEMS[itemId].name : itemId;
      log(`Forged: ${nm}. (${made}/${SMITH_ITEMS.length} pieces)`, "gold");
      if (made >= SMITH_ITEMS.length) log("All the wearable pieces forged — keep the arrowhead batches coming. (Wearing your work is wise, but the forge gate only asks that you MAKE it.)", "gold");
    }
    if (made >= SMITH_ITEMS.length && typeof sfx === "function") sfx("quest", 0.5);
    maybePerfectFiring(t); // a kit piece can be the ledger's last stroke too
    refreshBar();
    if (typeof saveGame === "function") saveGame();
  }
  // the optional PERFECT FIRING bonus: the whole forge lesson in the minimum
  // SIX furnace loads (4 copper + 1 bronze + 1 iron, nothing stray). Checked
  // on both onCraft exit paths because the smith stage's last credit is
  // always a craft (bars precede kit, the furnace precedes bars). Missing it
  // is SILENT — the terrace slack exists to be used without shame.
  function maybePerfectFiring(t) {
    if (!t || t.perfectPaid || !reqDone("smith")) return;
    t.perfectPaid = 1;
    if ((t.prog.firings || 0) <= 6 && typeof addItem === "function") {
      addItem("coins", 150);
      if (typeof log === "function")
        log("Menkaure turns your last piece over and whistles — SIX firings, nothing stray. A perfect ledger! He presses his mastersmith's koha into your hand: 150 coins.", "gold");
      if (typeof sfx === "function") sfx("quest", 0.6);
    }
  }
  // the tutorial anvil forges ONLY the four lesson pieces (skills/crafting.js
  // openStation filters its recipe list through this). null = no restriction.
  function anvilRecipes(node) {
    if (!active() || typeof tutIsleSD !== "function" || !node || node.type !== "anvil" || node.x == null) return null;
    const q = tutIsleSD(node.x / 2, node.y / 2);   // the furnace stays unrestricted (smelt any bar)
    return (q && q.D < 12) ? SMITH_RECIPES : null;
  }

  // ---------- the staged sky ----------
  // The isle is a pocket outside the world's clock: it always wakes at the
  // start of the day under clear skies at a flat 50% latitude, and the sky
  // only turns when the TUTORIAL turns — each islander met rolls time (and
  // eventually the weather) forward one notch, morning → noon → a passing
  // shower on the lagoon-and-bank leg → golden hour on the Sky Knoll → dusk
  // at the Portal Crown → the farewell under stars. daynight.js (dayPhase/
  // dayFraction), weather.js (weatherAt) and world.latitudeAt consult these
  // hooks; they return null/false the instant the character graduates or
  // strays off the isle, and the real sky snaps back.
  const TUT_WX = { // weatherAt override objects (shape mirrors cheats.js presets)
    clear:   { anom: 0.7,  front: 0,   storm: 0,    cloud: 0.04, precip: 0,    kind: null,   wind: { x: 0.4, y: 0 } },
    cloudy:  { anom: 0.2,  front: 0,   storm: 0.25, cloud: 0.55, precip: 0,    kind: null,   wind: { x: 0.7, y: 0.1 } },
    rain:    { anom: -0.5, front: 0.4, storm: 0.7,  cloud: 0.95, precip: 0.45, kind: "rain", wind: { x: 1.3, y: 0.3 } },
    drizzle: { anom: -0.3, front: 0.2, storm: 0.55, cloud: 0.9,  precip: 0.18, kind: "rain", wind: { x: 1.0, y: 0.2 } },
  };
  // one stop per keeper met (index = _seenCount): dawn → night across the
  // fifteen keepers, keeping the rain / golden-hour / stars beats.
  const STAGES = [
    { h: 7.5,   wx: "clear",   note: null }, // the isle always wakes just after dawn
    { h: 8.5,   wx: "clear",   note: "The morning sun climbs a little higher." },      // Guide met
    { h: 9.5,   wx: "clear",   note: "Mid-morning light spills across the isle." },    // Bushman
    { h: 10.5,  wx: "clear",   note: "The sun swings toward its peak." },              // Fisher
    { h: 12,    wx: "clear",   note: "High noon — shadows shrink to nothing under your feet." }, // Smith
    { h: 13,    wx: "clear",   note: "Early-afternoon warmth lies over the isle." },   // Soapmaker
    { h: 13.75, wx: "cloudy",  note: "Clouds drift in off the sea. {sky} would tell you the pressure is falling." }, // Swim-Master
    { h: 14.5,  wx: "rain",    note: "Rain sweeps the isle! Feel it — every storm in this world is real, and rivers swell with it." }, // Banker
    { h: 15.5,  wx: "drizzle", note: "The downpour softens to drizzle. Petrichor rises off the fields — and something VAST moves through it: a Kuranui, the giant of giants, grazing the pasture bold as morning." }, // Farmhand
    { h: 16.25, wx: "clear",   note: "The front passes — sunlight breaks through washed-clean air." }, // Carpenter
    { h: 17,    wx: "clear",   note: "Late-afternoon light lengthens every shadow." }, // Cook
    // sunset on the flat-latitude isle is 18:00 — the candle STAGE (index 13,
    // active while the dip-and-equip task is under way) must sit BEFORE it
    // (user req): you make your light while you can still see, and night
    // proper only falls once the Loremaster is met, candle already burning.
    { h: 17.4,  wx: "clear",   note: "Golden hour. The whole isle glows like embers." }, // Warden
    { h: 17.75, wx: "clear",   note: "The sun leans low over the sea — the last long light of the day." }, // Skywatcher
    { h: 17.95, wx: "clear",   note: "The sun touches the horizon — dip your rushlight by the last of the light; night is minutes away." }, // Candlemaker
    { h: 20,    wx: "clear",   note: "Night gathers; the portal ring glimmers on its crown." }, // Loremaster
    { h: 21,    wx: "clear",   note: "Night proper — the stars wheel above the isle. Time to think about the crossing." }, // Navigator
  ];
  // the sky holds at dusk through the Loremaster's runecrafting lesson —
  // night proper falls only once BOTH her goals (LORE_GOALS: 50 air runes +
  // equip a rushlight) are done, not the moment you meet her (user req
  // 2026-09-16; see maybeLoreNight below, called from onCraft's "air_rune"
  // case and onEquip — whichever goal is completed last triggers it)
  const LORE_STAGE_IDX = TUT_TUTORS.findIndex(t2 => t2.id === "lore") + 1;
  function skyIdx(n) {
    const i = Math.min(n, STAGES.length - 1);
    return (i === LORE_STAGE_IDX && !reqDone("lore")) ? i - 1 : i;
  }
  // fires the "Night gathers..." narration the instant BOTH of Runa's goals
  // are done, whichever lands last — the 50th air rune or equipping the
  // rushlight (onCraft's "air_rune" case and onEquip both call this)
  function maybeLoreNight(wasDone) {
    if (!wasDone && reqDone("lore") && skyActive() && typeof log === "function") {
      log(subst(STAGES[LORE_STAGE_IDX].note), "gold");
      if (typeof sfx === "function") sfx("quest", 0.35);
    }
  }
  // the morning after sleeping at Sigrid's — a fresh 6am, snapped to
  // instantly (the whole staged sky already works this way: every other
  // stage transition is an instant snap too, never real elapsed time) —
  // player.timeShiftMs (graduateCore's mechanism) is irrelevant here since
  // it only matters once graduated, when the staged sky stops overriding
  // dayPhase() entirely (user req 2026-09-17)
  const MORNING_STAGE = { h: 6, wx: "clear", note: null };
  const stage = () => {
    const t = state();
    if (t && t.sleptAtSigrids) return MORNING_STAGE;
    return STAGES[skyIdx(_seenCount)];
  };
  const skyActive = () => active() && onIsle();
  // dayPhase 0..1 such that the LOCAL clock where the player stands reads h
  function phaseOverride() {
    if (!skyActive()) return null;
    const tz = (typeof tzZone === "function") ? tzZone(player.x) : 0;
    const p = stage().h / 24 - tz / 24;
    return p - Math.floor(p);
  }
  const weatherOverride = () => skyActive() ? TUT_WX[stage().wx] : null;
  const flatSky = () => skyActive(); // daynight dayFraction + world.latitudeAt → 0.5
  function advanceStage(prevCount) {
    const prev = skyIdx(prevCount);
    const cur = skyIdx(_seenCount);
    if (cur === prev || !skyActive()) return;
    const s = STAGES[cur];
    if (s.note && typeof log === "function") log(subst(s.note), "gold");
    if (typeof sfx === "function") sfx("quest", 0.35);
    // warm the semantic-chat bank a couple of keepers ahead of Ravenna's
    // talk-to-me lesson, so her first answer is the real thing, not the
    // "bank still loading" canned fallback (idempotent; deliberately NOT
    // at boot — the MiniLM load would lean on the perf-sensitive boot path)
    if (_seenCount >= 10 && typeof npcRetrievalWarm === "function")
      try { npcRetrievalWarm(); } catch (e) { /* offline build */ }
  }

  // ---------- the river ----------
  // Geometry is in terrain.js (TUT_ISLE.river / tutIsleSD → pRiver 0=source …
  // 1=mouth, riverLine = distance to the water course). The journey ITSELF
  // rides the river now (2026-09-16): the upstream corridor is open from the
  // Bush chamber's wall gap, gate 1 stands mid-channel on the middle ring,
  // and below it the course runs fence-free to the sea. The path crosses
  // back over on the Cove→Forge bridge.
  const RV = () => TUT_ISLE.river;
  const isRiverWater = q => !!q && q.pRiver >= 0 && q.riverLine < RV().waterR + 0.6;
  // downstream current (source→mouth = outward along the river ray): the
  // rideable drift (movement.js river-pull — hold Shift to brace against
  // it). Only on the water course itself; the sea has no current.
  function riverFlow(x, y) {
    if (!active() || typeof tutIsleSD !== "function") return null;
    return isRiverWater(tutIsleSD(x / 2, y / 2)) ? [RV().ux, RV().uy] : null;
  }

  // ---------- the Swim-Master's islet seat ----------
  // The motu's distance is PER-CHARACTER (terrain.js tutIsletFor): re-seat it
  // whenever the worn body changes — at boot for a loaded save, and the
  // moment the Guide's chooser (or a later re-choosing) commits. Because the
  // islet is carved into the analytic terrain, every live chunk in its zone
  // is dropped so ground, stamps and the explored map regenerate at the new
  // seat (chunks.js never persists nor worker-injects isletZone chunks, so
  // that's the whole cleanup).
  let _isletChar;
  function isletSync() {
    if (!active() || typeof tutIsletFor !== "function" || typeof TUT_ISLE === "undefined") return;
    const key = (typeof player !== "undefined" && player && player.character != null) ? String(player.character) : "";
    if (key === _isletChar) return;
    _isletChar = key;
    const next = tutIsletFor(
      (typeof charSpeedMul === "function") ? charSpeedMul() : 1,
      (typeof charHeightMul === "function") ? charHeightMul() : 1);
    const cur = TUT_ISLE.islet;
    if (cur && Math.abs(cur.x - next.x) < 0.5 && Math.abs(cur.y - next.y) < 0.5) return;
    TUT_ISLE.islet = next;
    const Z = TUT_ISLE.isletZone;
    if (typeof world !== "undefined" && world && world.dropChunkRect)
      world.dropChunkRect(Z.x0 * 2, Z.y0 * 2, Z.x1 * 2, Z.y1 * 2);
    // the world map + minimap composite cached bake images — drop the zone's
    // chunk bakes/mips/macros too so the motu redraws at its new seat
    // (map.js never persists zone artefacts, so in-memory is the whole job)
    if (typeof world !== "undefined" && world && world.mapDropRect)
      world.mapDropRect(Z.x0, Z.y0, Z.x1, Z.y1);
    if (typeof seenChunks !== "undefined" && typeof world !== "undefined" && world && world.CHUNK)
      for (const k of [...seenChunks]) {
        const [cx, cy] = k.split(",").map(Number);
        const mx = (cx * world.CHUNK + world.CHUNK / 2) / 2, my = (cy * world.CHUNK + world.CHUNK / 2) / 2;
        if (mx >= Z.x0 && mx <= Z.x1 && my >= Z.y0 && my <= Z.y1) seenChunks.delete(k);
      }
  }

  // ---------- the Harbour Village evening ----------
  // Once the staged day reaches dusk (the Skywatcher met — h 17.75), every
  // keeper whose stage is DONE walks home to their seat in pod 14's village
  // (TUT_VILLAGE.seats); the frontier keeper and those ahead hold their
  // posts, and the Navigator never leaves her waka. deriveNpcs (chunks.js)
  // asks villageHome() so freshly hydrated chunks seat them right, and
  // _villageSync moves the LIVE npc objects when the state flips mid-session
  // (hooked into refreshBar, so any progress event settles them).
  // Retired keepers say plain ambient lines instead of their old lesson
  // invite (user req 2026-09-17) — chunks.js's deriveNpcs mirrors this same
  // handful of lines for chunks hydrated after they've already settled in.
  const OFFDUTY_LINES = [
    "Evening's mine now — the lesson's done.",
    "Fine night for the village to settle in.",
    "My work's done for the day. Rest well yourself.",
    "The isle's quiet once the teaching's through.",
    "Off duty now — go on and enjoy the evening.",
    "A good day's work behind me.",
  ];
  // un-root a keeper who's settled into the village — the generic wander/
  // door system (render3d.js stepMixNpc) picks them up automatically once
  // _r/_wanderAt look like any other ambient villager's
  function offDutyLine(id) {
    const i = TUT_TUTORS.findIndex(t2 => t2.id === id);
    return `"${OFFDUTY_LINES[(i < 0 ? 0 : i) % OFFDUTY_LINES.length]}"`;
  }
  function offDutyIfy(n, tu) {
    n._r = 6;
    n._wanderAt = (typeof performance !== "undefined" ? performance.now() : 0) + 800 + Math.random() * 3000;
    n.line = offDutyLine(tu.id);
    // a real bed (distinct from _home) so npcAsleep()/the lying-down render
    // and the generic bedtime walk/climb routine (render3d.js stepMixNpc)
    // all work correctly instead of falsely reading "asleep" at their post
    const vb = villageBed(tu.id);
    if (vb) {
      n._bed = [vb.x, vb.y]; n._bedLevel = vb.level; n._ladder = vb.ladder; n._owns = vb.owns;
      n.level = n.level || 0;
    }
  }
  function villageAt() {
    const t = state();
    return !!(t && !t.graduated && stage().h >= 17.5);
  }
  function villageHome(id) {
    if (typeof TUT_VILLAGE === "undefined" || !villageAt()) return null;
    const seat = TUT_VILLAGE.seats[id];
    if (!seat) return null;
    const i = TUT_TUTORS.findIndex(tu => tu.id === id);
    if (i < 0 || i >= frontier()) return null;
    const [px, py] = podXY(seat.pod); // the village spans BOTH shore pods (0 + 14)
    return { x: px + seat.dx, y: py + seat.dy };
  }
  // which TUT_VILLAGE house a tutor is a resident of, their bed slot, and
  // storey — used to assign _bed/_bedLevel/_ladder/_owns (chunks.js
  // deriveNpcs, _villageSync) and to furnish the right bedroom (render3d.js
  // tutHouseUpperDecor, via Tutorial.villageBed). Sigrid ("ferry") isn't in
  // any house's `residents` list (she's excluded from the general
  // village/seats system) — she gets the sigridHouseIdx house's floor-2
  // slot 0 instead.
  function residentHouse(id) {
    if (typeof TUT_VILLAGE === "undefined") return null;
    for (const hb of TUT_VILLAGE.houses) {
      const slot = hb.residents.indexOf(id);
      if (slot >= 0) return { house: hb, slot, floor: 1 };
    }
    if (id === "ferry") return { house: TUT_VILLAGE.houses[TUT_VILLAGE.sigridHouseIdx], slot: 0, floor: 2 };
    return null;
  }
  function villageBed(id) {
    const r = residentHouse(id);
    if (!r) return null;
    const [px, py] = podXY(r.house.pod);
    const bt = TUT_VILLAGE.bedTile(r.house, r.slot, r.floor);
    return {
      x: px + bt.x, y: py + bt.y, level: bt.level,
      ladder: [px + r.house.x0 + 1, py + r.house.y0 + r.house.h - 2],
      owns: [px + r.house.x0, py + r.house.y0, r.house.w, r.house.h],
    };
  }
  // bedroom furniture for a "tut_house" building record (render3d.js
  // buildBuildingStruct): one bed per resident, at the exact tile
  // villageBed() assigns them, so the NPC always "sleeps" where the
  // furniture actually is. Matched to its TUT_VILLAGE entry by world-space
  // x0/y0 (ch.buildings records don't carry a back-reference).
  function tutHouseUpperDecor(b) {
    if (typeof TUT_VILLAGE === "undefined" || b.kind !== "tut_house") return null;
    const hb = TUT_VILLAGE.houses.find(h => { const [px, py] = podXY(h.pod); return px + h.x0 === b.x0 && py + h.y0 === b.y0; });
    if (!hb) return null;
    const out = [];
    for (const id of hb.residents) {
      const vb = villageBed(id);
      if (vb) out.push({ x: vb.x, y: vb.y, level: vb.level, key: "bed_frame" });
    }
    // this house alone also gets Sigrid's own bed + the spare room, one
    // floor up (user req 2026-09-17: fold both into an existing house
    // instead of a dedicated 8th building)
    if (hb === TUT_VILLAGE.houses[TUT_VILLAGE.sigridHouseIdx]) {
      const fb = villageBed("ferry");
      if (fb) out.push({ x: fb.x, y: fb.y, level: fb.level, key: "bed_frame" });
      const sb = spareBedTile();
      out.push({ x: sb.x, y: sb.y, level: sb.level, key: "bed_frame" });
    }
    return out;
  }
  // the spare room's bed tile — the sigridHouseIdx house, floor 2 slot 1
  // (Sigrid's own bed is slot 0 of the same floor)
  function spareBedTile() {
    const hb = TUT_VILLAGE.houses[TUT_VILLAGE.sigridHouseIdx];
    const [px, py] = podXY(hb.pod);
    const bt = TUT_VILLAGE.bedTile(hb, 1, 2);
    return { x: px + bt.x, y: py + bt.y, level: bt.level };
  }
  // is (x,y,level) the spare bed, and is it still meaningful to click
  // (hasn't been slept in yet)? Drives input.js's narrowly-scoped "Sleep"
  // menu entry — not a general bed-sleeping feature.
  function sigridSpareBedAt(x, y, level) {
    const t = state();
    if (!t || t.sleptAtSigrids) return false;
    const b = spareBedTile();
    return b.x === x && b.y === y && b.level === level;
  }
  // Sigrid leads the way for real: marks her stage seen (the staged sky
  // rolls to night, same as every other keeper) and drops a real goal in
  // the journey panel, then walks herself to the SPARE bed with the player
  // automatically following (Tutorial.tickEscort, below) — once she
  // arrives (onEscortArrive) she peels off alone to her own bed, second
  // leg unaccompanied (user req 2026-09-17).
  function inviteSigridSleep() {
    const t = state();
    if (!t) return;
    const prev = _seenCount;
    t.seen.ferry = 1;
    _seenCount = Object.keys(t.seen).length;
    advanceStage(prev);
    if (typeof log === "function") {
      log("Sigrid leads you down the lane toward her house — follow her.", "gold");
      log(`Sigrid's task: ${REQS.ferry.task}.`, "gold");
    }
    refreshBar();
    if (typeof saveGame === "function") saveGame();
    const list = (typeof world !== "undefined" && world && world.npcs) || (typeof npcs !== "undefined" ? npcs : null);
    const sn = list && list.find(n => n.tutor === "ferry");
    if (!sn) return;
    const T = typeof performance !== "undefined" ? performance.now() : 0;
    sn._r = 6; sn._wanderAt = T + 300; // same off-duty flavor as every housed keeper
    sn.line = offDutyLine("ferry");
    const vb = villageBed("ferry");     // her own house's ladder/footprint (shared with the spare room)
    if (!vb) return;
    // set her real bed now (not just the escort target) so that once she's
    // settled at the end of leg 2, the generic bedtime routine recognises
    // she's already home and stands still, instead of tugging her back
    // toward a stale _home
    sn._ladder = vb.ladder; sn._owns = vb.owns; sn._bed = [vb.x, vb.y]; sn._bedLevel = vb.level;
    sn.level = sn.level || 0;
    const spare = spareBedTile();
    sn._escortTarget = [spare.x, spare.y, spare.level];
    t.escorting = true;
  }
  // fires from render3d.js's stepMixNpc the instant an NPC's _escortTarget
  // is reached. Sigrid's walk has two legs: leg 1 (the spare room) PARKS
  // her there — re-targeting her own current tile so she just stands,
  // rather than falling through to the (unconfigured) bedtime/wander
  // branches — and waits for tickEscort() to see the PLAYER catch up
  // before starting leg 2 (her own bed, unaccompanied this time).
  function onEscortArrive(npc) {
    if (npc.tutor !== "ferry") return;
    const t = state();
    if (!t) return;
    if (!t.sigridAtSpare) { t.sigridAtSpare = 1; npc._escortTarget = [npc.x, npc.y, npc.level]; return; }
    t.sigridSettled = 1; // leg 2 done — home for the night, until morning
    if (typeof saveGame === "function") saveGame();
  }
  // per-frame: gently walk the player toward Sigrid while t.escorting is
  // set, auto-climbing the shared ladder one storey at a time when standing
  // on it (walkTo alone can't cross storeys — that's an explicit ladder
  // action normally). Throttled so it doesn't recompute a path every frame;
  // never disables manual input, so a stray click/WASD just gets gently
  // overridden again shortly rather than truly locking the player. Once the
  // PLAYER (not just Sigrid) reaches the spare bed, hands off leg 2 and
  // releases control.
  function tickEscort() {
    const t = state();
    if (!t || !t.escorting || typeof player === "undefined") return;
    const list = (typeof world !== "undefined" && world && world.npcs) || (typeof npcs !== "undefined" ? npcs : null);
    const sn = list && list.find(n => n.tutor === "ferry");
    const vb = villageBed("ferry");
    if (!sn || !vb) { t.escorting = false; return; }
    const T = typeof performance !== "undefined" ? performance.now() : 0;
    const ladder = vb.ladder;
    const spare = spareBedTile();
    if (t.sigridAtSpare && player.x === spare.x && player.y === spare.y && (player.level | 0) === spare.level) {
      t.escorting = false;
      if (typeof log === "function")
        log("Sigrid shows you to your bed for the night. \"Sleep whenever you're ready.\"", "gold");
      if (typeof saveGame === "function") saveGame();
      sn._escortTarget = [vb.x, vb.y, vb.level]; // leg 2: her own bed, unaccompanied
      return;
    }
    // climb one storey per stand-on-the-ladder tick, mirroring npcClimbToward
    if (player.x === ladder[0] && player.y === ladder[1] && (player.level | 0) < spare.level) {
      if (T < (player._escortClimbAt || 0)) return;
      player._escortClimbAt = T + 500;
      player.level = (player.level | 0) + 1;
      if (typeof uiDirty !== "undefined") uiDirty = true;
      return;
    }
    if (T < (player._escortWalkAt || 0)) return;
    player._escortWalkAt = T + 900;
    // on the spare room's floor, walk straight to the (fixed) spare bed
    // tile rather than chasing Sigrid's own live position — she's headed
    // toward a DIFFERENT tile (her own bed) once she arrives, and chasing
    // her tile-by-tile crowded her final approach in testing. On the
    // ground floor, still head for the ladder she's also making for.
    const upstairs = (player.level | 0) === spare.level;
    const [tx, ty] = upstairs ? [spare.x, spare.y] : ladder;
    if (Math.max(Math.abs(player.x - tx), Math.abs(player.y - ty)) <= (upstairs ? 1 : 0))
      return; // already close enough
    if (typeof walkTo === "function") walkTo(tx, ty);
  }
  // wake up: reused everywhere the SAME as clicking the spare bed. One-off
  // morning flourish (not a persistent system — see project notes) sends a
  // couple of nearby housed keepers to gather their door lamp, and the
  // staged sky snaps straight to a fresh 6am morning (skyIdx/stage below).
  function sleepAtSigrids() {
    const t = state();
    if (!t || t.sleptAtSigrids) return;
    t.sleptAtSigrids = 1;
    if (typeof log === "function")
      log("Exhausted from the whole long day, you sleep like the dead — ten hours, maybe more.", "gold");
    refreshBar();
    if (typeof saveGame === "function") saveGame();
    morningLampFlourish();
    if (typeof log === "function")
      log("You wake to a grey hush over the village — go find Sigrid; she's waiting to open the crossing.", "sys");
  }
  function morningLampFlourish() {
    const list = (typeof world !== "undefined" && world && world.npcs) || (typeof npcs !== "undefined" ? npcs : null);
    if (!list) return;
    const housed = list.filter(n => n.tutor && n.tutor !== "ferry" && n._bed).slice(0, 3);
    for (const n of housed) {
      const r = residentHouse(n.tutor);
      if (!r) continue;
      const [px, py] = podXY(r.house.pod);
      n._lampTarget = [px + r.house.x0 + (r.house.w >> 1) + 1, py + r.house.y0 + r.house.h];
      n._wanderAt = typeof performance !== "undefined" ? performance.now() : 0;
    }
  }
  // Sigrid's post moves with the story (user req 2026-09-17): her fixed
  // day/early-game/post-sleep spot is by the pier (her own dx/dy), but for
  // the one evening stretch where the journey is otherwise done and she
  // hasn't sent the player to bed yet, she's mingling by the Harbour
  // green's campfire instead (tutorial.js:415's campfire_ring decor).
  function ferryPost() {
    const tu = TUT_TUTORS.find(t2 => t2.id === "ferry");
    const t = state();
    const atCampfire = frontier() >= TUT_TUTORS.length - 1 && !(t && t.sleptAtSigrids);
    return atCampfire ? { dx: -1, dy: 5 } : { dx: tu.dx, dy: tu.dy };
  }
  function _villageSync() {
    if (typeof TUT_ISLE === "undefined") return;
    const list = (typeof world !== "undefined" && world && world.npcs) ||
      (typeof npcs !== "undefined" ? npcs : null);
    if (!list) return;
    const t = state();
    let moved = 0;
    for (const n of list) {
      if (!n.tutor) continue;
      // mid-escort, walking her own two legs home, or already settled in
      // her own bed for the night — don't let a routine refreshBar() call
      // yank her back to a "post" position. Once sleptAtSigrids flips
      // (morning), this no longer applies and she relocates to the pier.
      if (n.tutor === "ferry" && (n._escortTarget || (t && t.escorting) ||
          (t && t.sigridSettled && !t.sleptAtSigrids))) continue;
      const tu = TUT_TUTORS.find(t2 => t2.id === n.tutor);
      if (!tu) continue;
      const vh = villageHome(n.tutor);
      const pod = TUT_ISLE.pods[tu.pod];
      const post = n.tutor === "ferry" ? ferryPost() : { dx: tu.dx, dy: tu.dy };
      const hx = vh ? vh.x : pod.mx * 2 + post.dx;
      const hy = vh ? vh.y : pod.my * 2 + post.dy;
      if (n._home && n._home[0] === hx && n._home[1] === hy) continue;
      n.x = hx; n.y = hy; n.px = PX(hx); n.py = PX(hy);
      n._home = [hx, hy]; n._mt = 0;
      if (vh) {
        moved++;
        offDutyIfy(n, tu);
      }
    }
    if (moved && villageAt()) {
      const t = state();
      if (t && !t.villageAnnounced) {
        t.villageAnnounced = 1;
        if (typeof log === "function")
          log("As the light lowers, the keepers you've met walk the shore road home to the Harbour Village — lamplight blooms among the tents.", "gold");
      }
    }
  }
  // the village lamp stands, for daynight.js litCandlesNear: lit one by one
  // as the staged dusk deepens (thr staggering, same as settlement stands)
  function villageLamps() {
    if (!villageAt() || typeof TUT_VILLAGE === "undefined") return [];
    const out = [];
    TUT_VILLAGE.lamps.forEach((L, i) => {
      const [px, py] = podXY(L.pod);   // stands light both halves of the shore
      const x = px + L.dx, y = py + L.dy;
      // outdoor stands never sit in the surf or on top of a tent/well —
      // grid candidates near the coast or a stamp are simply skipped
      if (!L.inside && typeof world !== "undefined" && world &&
          (world.isWater(x, y) || world.getDecor(x, y))) return;
      out.push({
        x, y, inside: !!L.inside, tier: 15 + (i % 5),
        thr: 0.08 + (i / TUT_VILLAGE.lamps.length) * 0.35,
        stand: L.inside ? null : ["candlestand_wood", "candlestand_iron", "candlestand_brass"][i % 3],
      });
    });
    return out;
  }

  // ---------- STAGE_SKIP: auto-complete stages at the gate ----------
  // With the compile-time STAGE_SKIP flag on (top of file), stepping through
  // journey arch i completes every stage up to i: seen (the sky rolls),
  // goals/flags credited, keeper gifts granted, and a CATCH-UP bundle of the
  // items those stages would have banked in your pack. Idempotent per stage.
  const SKIP_PROG = {   // per-stage goal counters/flags a completion sets
    bush:  t => Object.assign(t.prog, { queuedTrees: 5, trees: 5 }),
    fish:  t => Object.assign(t.prog, { braced: 1, whitebait: 5 }),
    smith: t => { Object.assign(t.prog, { furnaceLit: 1, arrowheads: SMITH_HEADS });
                  t.smithMade = { shortsword_iron: 1, chainbody_bronze: 1, targe_bronze: 1 }; },
    swim:  t => Object.assign(t.prog, { isletPearl: 1, isletReturn: 1 }),
    bank:  t => Object.assign(t.prog, { deposits: 1, pails: 9 }),
    farm:  t => Object.assign(t.prog, { cropWheat: 20, cropPotato: 20, cropApple: 20,
                  cropSage: 20, cropFlax: 20, flour: 10, eggs: 10, feathers: 10, twinned: 1 }),
    wood:  t => Object.assign(t.prog, { merged: 1, shafts: 300, arrow_iron: 30, shortbow: 1 }),
    cook:  t => Object.assign(t.prog, { fritters: 5, cheese: 1, flatbread: 5 }),
    war:   t => Object.assign(t.prog, { slimes: 3, tallow: 1, actionRune: 3, stateRune: 3, hide: 3, koreke: 1 }),
    soap:  t => { t.washedClean = 1; },
    sky:   t => { t.reachedKnoll = 1; t.prog.chatted = 1; },
    candle: t => { t.candleMade = 1; },
    lore:  t => Object.assign(t.prog, { airRunes: 50, rushlightEquipped: 1 }),
    ferry: t => { t.sleptAtSigrids = 1; },
  };
  const SKIP_ITEMS = {  // what the stage's WORK would have left in the pack
    bush:  [["logs", 30]],
    fish:  [["raw_fish", 5]],
    smith: [["shortsword_iron", 1], ["chainbody_bronze", 1], ["targe_bronze", 1],
            ["arrowhead_iron", 30], ["iron_bar", 6]],
    swim:  [["pearl", 1]],
    bank:  [["pail", 9]],
    farm:  [["flour", 10], ["egg", 10], ["feathers", 10], ["wheat", 10]],
    wood:  [["arrow_iron", 30], ["shortbow", 1]],
    cook:  [["cooked_fish", 5], ["cottage_cheese", 1], ["flatbread", 5]],
    war:   [["tallow", 1], ["hide", 3], ["action_rune", 3], ["state_rune", 3]],
    candle: [["rushlight", 1]],
    lore:  [["air_rune", 50]],
  };
  function skipStagesThrough(gi) {
    const t = state(); if (!t) return;
    t.prog = t.prog || {};
    t.skipGiven = t.skipGiven || {};
    // no body yet? STAGE_SKIP picks one at RANDOM (user req) so the guide
    // stage can complete and the world renders a walker, not a spark
    if (!hasBody() && typeof CHAR_LIST !== "undefined" && CHAR_LIST.length)
      player.character = Math.floor(Math.random() * CHAR_LIST.length);
    const prev = _seenCount;
    for (let i = 0; i <= gi && i < TUT_TUTORS.length; i++) {
      const id = TUT_TUTORS[i].id;
      if (t.skipGiven[id]) continue;
      t.skipGiven[id] = 1;
      t.seen[id] = 1;
      if (SKIP_PROG[id]) SKIP_PROG[id](t);
      if (DLG[id] && DLG[id].reward) grant(id, DLG[id].reward);
      for (const [iid, qty] of SKIP_ITEMS[id] || [])
        if (typeof ITEMS !== "undefined" && ITEMS[iid] && typeof addItem === "function") addItem(iid, qty);
    }
    _seenCount = Object.keys(t.seen).length;
    if (_seenCount !== prev) {
      if (typeof log === "function")
        log(`STAGE_SKIP: stages through ${tutorName(TUT_TUTORS[Math.min(gi, TUT_TUTORS.length - 1)])} auto-completed — gifts and goods added to your pack.`, "warn");
      advanceStage(prev);
      refreshBar();
      if (typeof saveGame === "function") saveGame();
    }
  }

  // ---------- the gates & the seal ----------
  // Returns a message string when (x,y) is off limits, false when clear.
  // NO INVISIBLE WALLS (user req): every tutorial boundary is a physical
  // fence — the waist columns, the river weirs and the offshore ring
  // (chunks.js) — and this function only latches the walkable GATE tiles in
  // them:
  //  · waist gate column i stays latched until keeper i has sent you on
  //  · the Swim-Master's islet channel bars HULLS while the tutorial lives
  //    (the crossing must be swum — that's the lesson) and mists over with
  //    the rest once the isle is sealed
  //  · outside a live tutorial the whole footprint is mist (the SEAL — a
  //    different mode, not a tutorial boundary)
  function barred(x, y) {
    if (typeof tutIsleSD !== "function") return false;
    const q = tutIsleSD(x / 2, y / 2);
    if (!q) return false;
    // the islet channel (pod 4's outward ray, coast → islet): far outside
    // the D<14 isle band, so it's handled before the early-out below
    if (inIsletRegion(x / 2, y / 2)) {
      if (!active())
        return "A wall of pearly mist churns ahead. Nothing you do finds a way through.";
      if (player.sailing || (typeof ridingEnt === "function" && ridingEnt()))
        return "The chop over the drowned shelf would swamp any hull — this crossing must be SWUM.";
    }
    // graduated: the mist takes back the WHOLE sealed disc (TUT_ISLE.SEAL_D,
    // rad 560 game tiles) — the isle is a separate map now, unreachable and,
    // because the carved moat outruns render range from here, invisible too
    if (!active())
      return q.D < TUT_ISLE.SEAL_D ? "A wall of pearly mist churns ahead. Nothing you do finds a way through." : false;
    if (q.D >= 14) return false;
    // journey-gate arches (ring/spoke crossings, terrain.js tutGateArchAt):
    // latch ONLY the arch tiles — every other fence tile is physically
    // blocked, so no rule needs to live there
    const gi = (typeof tutGateArchAt === "function") ? tutGateArchAt(x / 2, y / 2) : -1;
    if (gi >= 0) {
      const f = frontier();
      if (f >= gi + 1) return false;                         // keeper gi done — gate open
      if (STAGE_SKIP) { skipStagesThrough(gi); return false; } // dev walk-through: auto-complete + catch-up items
      const keeper = TUT_TUTORS[Math.min(f, TUT_TUTORS.length - 1)];
      // the very first gate won't open until you've taken a form
      if (keeper.id === "guide" && !hasBody())
        return `You are still a spark of light. ${tutorName(keeper)} must give you a form before you may go on.`;
      const t2 = state();
      if (t2 && t2.seen[keeper.id] && !reqDone(keeper.id))
        return `The gate stays latched until you ${REQS[keeper.id].task} — ${tutorName(keeper)} will send you on then.`;
      return `The gate is latched. ${tutorFull(keeper)} must send you onward first.`;
    }
    return false;
  }

  // ---------- staged skill reveal ----------
  // During the tutorial the Skills tab only lists what the keepers have
  // introduced so far — whole categories for broad lessons (so dynamically
  // added professions ride along), single skills for pointed ones. Anything
  // the player somehow earns XP in shows regardless, and graduation (or a
  // veteran save) reveals everything.
  const TUT_SKILL_INTRO = {
    bush:  { skills: ["Woodcutting"] },
    fish:  { skills: ["Fishing"] },
    smith: { skills: ["Stone-mining", "Ore-mining", "Gem-mining", "Smelting", "Weaponsmithing", "Armoursmithing", "Firemaking"] },
    soap:  { skills: ["Charcoaling", "Soapmaking"] },
    swim:  { skills: ["Sailing", "Shipwrighting", "Agility"] },
    bank:  { skills: ["Carpentry"] },                           // pails at Torvak's bench
    farm:  { skills: ["Farming", "Milling", "Husbandry"] },
    wood:  { skills: ["Sawing", "Fletching", "Carpentry"] },   // the full wood trades (Carpentry met at the bank camp)
    cook:  { skills: ["Cheesemaking", "Baking", "Cooking"] },
    war:   { skills: ["Melee", "Strength", "Defence", "Health", "Archery"] },
    candle:{ skills: ["Candlemaking", "Spinning"] },            // Spinning turns harvested flax into wick-linen
    lore:  { skills: ["Runecrafting"] },
  };
  function skillVisible(s) {
    if (!active()) return true;                        // graduated / veteran: everything
    if (typeof player !== "undefined" && player.skills && (player.skills[s] || 0) > 0) return true;
    const t = state();
    if (!t) return true;
    const cat = (typeof SKILL_CATEGORY !== "undefined" && SKILL_CATEGORY[s]) || "Other";
    for (const id in t.seen) {
      const m = TUT_SKILL_INTRO[id];
      if (!m) continue;
      if (m.skills && m.skills.includes(s)) return true;
      if (m.cats && m.cats.includes(cat)) return true;
    }
    return false;
  }

  // ---------- rewards ----------
  // Item grants are existence-guarded so a renamed id degrades to coins
  // instead of silently vanishing.
  function grant(tid, reward) {
    const t = state();
    if (!t || t.given[tid] || !reward) return;
    t.given[tid] = 1;
    const parts = [];
    for (const [id, qty] of reward.items || []) {
      if (typeof ITEMS !== "undefined" && ITEMS[id] && typeof addItem === "function") {
        addItem(id, qty);
        parts.push(`${qty > 1 ? qty + "× " : ""}${ITEMS[id].name}`);
      } else if (typeof addItem === "function") {
        addItem("coins", 15 * qty);
        parts.push(`${15 * qty} coins`);
      }
    }
    if (reward.coins && typeof addItem === "function") { addItem("coins", reward.coins); parts.push(`${reward.coins} coins`); }
    for (const sk in reward.xp || {})
      if (typeof addXp === "function" && typeof SKILLS !== "undefined" && SKILLS.includes(sk)) {
        addXp(sk, reward.xp[sk]);
        parts.push(`${reward.xp[sk]} ${sk} xp`);
      }
    if (parts.length && typeof log === "function") log(`Gift received: ${parts.join(", ")}.`, "gold");
    if (typeof sfx === "function") sfx("coins", 0.5);
    if (typeof saveGame === "function") saveGame();
  }

  // ---------- dialogue content ----------
  // Each tutor is a CONVERSATION, not a wall of text: `convo` is a list of
  // BEATS, each a single spoken NPC line (said aloud as an overhead bubble AND
  // in the conversation bar) followed by the player's `r` responses. A response
  // is a plain string (the player says it and the talk advances to the next
  // beat; on the LAST beat it finishes — granting the reward and unbarring the
  // next gate), or an object { t, act?, goto?, finish?, end? }:
  //   act    — open the real UI (charselect/bestiary/questlog/graduate/…)
  //   goto   — jump to beat index N (branches)
  //   finish — grant + mark seen + advance the staged sky, then close
  //   end    — just close, marking nothing (decline paths)
  // Keep every NPC line QUOTE-FREE: the bubble renders it verbatim over the
  // keeper's head, and bubbles must never show quotation marks.
  const DLG = {
    guide: {
      reward: { coins: 25 },
      convo: [
        { npc: "Haere mai, traveller — welcome to Tūhura Isle, the Isle of Discovery. Everyone arrives the same way: washed up on the sand with empty hands.",
          r: ["What am I, exactly?"] },
        { npc: "Look at yourself, e hoa — still a spark of unformed light. Before anything else you must take a BODY. Dozens of folk to choose from, each with their own build, pace and wardrobe.",
          r: [{ t: "Let me choose a body now", act: "charselect" }, "First — how do I get around?"] },
        { npc: "Click the ground to walk; click a tree, rock, fire or person to use it. RIGHT-click anything for more choices, and press ENTER near anyone to talk in your own words — we truly answer.",
          r: ["And where am I headed?"] },
        { npc: "Follow the dirt path east. {bush} the Bushman is expecting you, and every keeper after equips you for their lesson — tool by tool — until you walk off my isle fully kitted. The ? tab holds a full guide; the Goals tab tracks your journey.",
          r: [{ t: "I'm ready — let me choose a body", act: "charselect" }] },
      ],
    },
    bush: {
      reward: { items: [["axe_iron", 1]] },
      openGrant: true,
      convo: [
        { npc: "Kia ora! Take my spare iron axe — it's yours. See all these young trees? With an axe in your pack, click one and you'll fell it for logs.",
          r: ["What else can I gather?"] },
        { npc: "Berry bushes, herb patches, wildflowers, even boulders — nearly everything growing or lying about can be gathered, and it all grows back in time. Over thirty-five skills in this world, and every one starts just like this: click, gather, learn.",
          r: ["Are all trees the same?"] },
        { npc: "Out in the wide world the forests fill with kauri, rimu, kahikatea, tōtara — real giants. Higher-tier trees want a higher Woodcutting level and a better axe, but their timber is worth it. Listen in the deep bush and you'll meet tūī, kererū, kea, even kiwi scratching about at night.",
          r: ["So what's my lesson?"] },
        { npc: "The woodsman's real trick: PLANNING the day's felling. Hold OPTION and CLICK a tree and the job joins your QUEUE — a white ring marks each tree waiting its turn, and your hands move to the next the moment a stump settles.",
          r: ["How many should I queue?"] },
        { npc: "QUEUE FIVE FELLING JOBS, and FELL FIVE TREES — that's my lesson, both halves. It works for nearly everything: harvest rows, ore terraces, pickups. Queue the work, then let yourself get on with it.",
          r: ["Does a better axe help?"] },
        { npc: "A better axe fells faster — true everywhere: good field tools speed your gathering, fine workshop tools raise the quality of what you craft. And KEEP those logs; you'll saw, fletch and carpenter with them up the path.",
          r: ["How do I reach the next keeper?"] },
        { npc: "Here's the fun of it — there's NO dry road to the cove. Follow my path to where the stream slips through the chamber wall, wade in, and let the current CARRY you. The RIVER GATE swings open the moment your fifth tree falls, and the water itself sets you on {fish}'s bank. Hold SHIFT any time you'd rather stand than drift.",
          r: ["Off I go, then."] },
      ],
    },
    fish: {
      reward: { items: [["small_net", 1], ["fishing_rod", 1]] },
      convo: [
        { npc: "Kia ora — and what an entrance, riding the gate down like a whitebait yourself! See where my stream meets the sea? That's a RIVERMOUTH, and every spring the whitebait — īnanga — run up it in silver clouds. Take my scoop-net and my old rod; the net's the tool for whitebait.",
          r: ["How do I fish a current?"] },
        { npc: "First lesson before any net touches water: wade in and BRACE — hold SHIFT with your feet dug against the current. Feel it stop pulling? That's the stance you fish from; let go and the river tears you off the spot.",
          r: ["Does it matter where I fish?"] },
        { npc: "Every fishing spot in the world holds ONE kind of fish — shallow shore, deep sea and fresh water each carry their own, and rarer waters mean rarer fish. Hoki and snapper offshore, tuna — that's our eel — and kōura in the fresh, whitebait right here at the mouth.",
          r: ["How many do I need?"] },
        { npc: "Net FIVE, braced the whole while — you'll want every one, for the fritters ahead ask for all five. Raw kai does you no good; cooked, it heals you, and the finest dishes grant buffs — faster gathering, harder hitting, tougher skin.",
          r: ["Fritters?"] },
        { npc: "Here's a secret worth the whole isle: HOLD ONTO your raw whitebait. Up the path {farm} keeps the fowl for eggs, and {cook} will show you how to bind whitebait and egg into golden WHITEBAIT FRITTERS — best kai on Tūhura.",
          r: ["Where to after I've netted five?"] },
        { npc: "CROSS THE BRIDGE over the river and carry on to {smith}'s forge through the next gate.",
          r: ["Thank you — I'll get netting."] },
      ],
    },
    smith: {
      // the xp is Menkaure's DEMONSTRATION — he works a load in front of you
      // (beat 1) so the ledger below runs at half the firings it used to.
      // Numbers are load-bearing: the terrace-ledger comment in TUT_CONTENT
      // derives the whole smelt plan from Smelting 550 / Ore-mining 400.
      reward: { items: [["pickaxe_iron", 1], ["knife", 1], ["flint", 1]],
                xp: { Smelting: 550, "Ore-mining": 400 } },
      convo: [
        { npc: "This pickaxe is yours — and the first lesson's free: watch my hands. One load drawn, raked and fired true. That's the knack, and I've just put it in your arms — take the experience; the rest you earn stroke by stroke.",
          r: ["What ore have I got to work?"] },
        { npc: "My terrace is a MEASURED LEDGER — the only ore on this whole isle: FIVE copper rocks at seven ore each, TWO pale tin rocks at two each, ONE dark iron rock at six. Copper first — your arms harden on it. Tin yields at Ore-mining TWO, iron at THREE, and the copper carries you there.",
          r: ["And the smelting plan?"] },
        { npc: "My furnace smelts in LOADS OF SIX. FOUR firings of COPPER — twenty-four bars — then ONE firing of BRONZE, which drinks four copper and two tin. That lands your Smelting at THREE: enough for ONE firing of IRON, six bars, plenty for the kit. I've left SPARE STONE, so a stray firing strands no one.",
          r: ["Is there a harder way?"] },
        { npc: "A MASTER runs the whole ledger in SIX firings flat, nothing wasted. Do that and I'll pay you a mastersmith's koha of 150 coins. But first — a cold furnace smelts nothing. Every fire on this isle burns REAL fuel.",
          r: ["How do I light it?"] },
        { npc: "Take my working KNIFE and this piece of FLINT — keep both in your pack. Stand at the furnace, STRIKE a spark, then STOKE the fire with logs. Lighting my furnace is the first mark of your lesson, and every stoke feeds your FIREMAKING — even a fizzled spark is practice. The flint never wears out.",
          r: ["Will plain logs smelt everything?"] },
        { npc: "Plain logs burn hot enough for copper and bronze — but IRON wants a fiercer fire. Fell a MĀNUKA once your Woodcutting reaches 3, stoke with its logs, and keep striking until your Firemaking can hold that heat.",
          r: ["What am I forging?"] },
        { npc: "No hand-outs at the anvil — you earn your gear. Forge all FOUR: an IRON SHORTSWORD and thirty IRON ARROWHEADS — two anvil batches, Weaponsmithing — plus a BRONZE CHAINBODY and a BRONZE TARGE, Armoursmithing. The forge gate opens when the furnace has ROARED and all four are MADE.",
          r: ["Why does all this matter?"] },
        { npc: "This is the whole economy in miniature: miner feeds smelter, smelter feeds smith, smith arms the fighter, whose drops feed thirty-five other trades. THIRTY-TWO tiers of metal out there, humble copper to Eternium. Master a craft and your quality climbs above other makers' — your goods even carry your name.",
          r: ["Where next, once I'm kitted?"] },
        { npc: "To the terrace, the furnace, the anvil. Forge your four and wear them, then on to {swim} at the lagoon.",
          r: ["I'll get to work."] },
      ],
    },
    soap: {
      convo: [
        { npc: "Look at the state of you — fish guts, forge smoke, monster ichor, honest sweat. Your stink metre climbs as you work and fight, and after that pit you're RIPE.",
          r: ["Does it matter if I'm rank?"] },
        { npc: "Let it climb too high out in the world and shopkeepers bar their doors until you wash! And no bars handed out here — you'll MAKE your soap from what you carry.",
          r: ["How do I make soap?"] },
        { npc: "Char some of your LOGS at my clamp — a slow fire turns wood to charcoal and WOOD ASH. Leach the ash into LYE at the soap works, then boil the lye with the TALLOW you rendered off the warden's beasts. That's a bar of soap. Two crafts in it: Charcoaling for the ash, Soapmaking for the lye and the bar.",
          r: ["Then how do I actually wash?"] },
        { npc: "Wade into my spring pool behind me — waist deep, safe — and SCRUB with your soap until every trace of stink is gone. Different soaps target different reeks; fancier bars scrub harder. Clean at last? Then climb on — {sky} keeps the knoll just past the gate.",
          r: ["I'll get scrubbing."] },
      ],
    },
    swim: {
      reward: { items: [["log_raft", 1], ["snorkel", 1]] },
      convo: [
        { npc: "You can wade and swim — but watch the depth. Once the waterline passes your nose your AIR drains; run out and you'll black out and wash ashore, lighter in the pockets. My lagoon here shelves off fast into deep blue.",
          r: ["How far can I swim?"] },
        { npc: "This snorkel I'm giving you buys you nearly double the distance — glassblowers make them. Now for MY lesson. Out past the lagoon, south-east, a lone MOTU rides the swell, and on its sand sits an old sea chest with a PEARL in it.",
          r: ["You want me to fetch it?"] },
        { npc: "Fetch it and swim it home — that's the whole task, and the whole trick. The crossing is measured against YOUR body, e hoa: exactly one breath too wide. Strike out with bare lungs and the deep takes you a few strokes short of the sand.",
          r: ["So how do I make it?"] },
        { npc: "EQUIP THE SNORKEL — it halves the thirst of your lungs, and the crossing becomes yours with air to spare. Rest on the motu, then swim the pearl back and put it in MY hand. And don't dream of paddling it — the chop over the drowned shelf would swamp any hull. This one is swum, out and back.",
          r: ["What about the open sea?"] },
        { npc: "The open sea past the fences is no road. The fence lines run off the beaches into the surf, and beyond them the water only gets DEEPER, with nowhere to land. Don't go hunting a way round a gate by sea; there isn't one worth your life. The path is the only way on.",
          r: ["You mentioned rivers carry you?"] },
        { npc: "You've felt it already — that ride down through the gate. Wade a river unbraced and the current bears you downstream; BRACE with SHIFT and your line is your own. Storms swell a river into flood — deeper, colder, far stronger. The corridor above the river gate even climbs to the SOURCE, marked on your map, if you want the full run.",
          r: ["And the raft you packed?"] },
        { npc: "Stand at the water's edge, place it, and paddle — anywhere but my motu channel! Shipwrights build proper hulls up to great sailing ships; bigger hulls draw more water. Where roads meet water the world builds stone bridges, and over shallow seas whole causeways on piles — you'll sail under some, and tall hulls must duck the low ones.",
          r: ["The pearl's waiting — I'm off."] },
      ],
    },
    bank: {
      reward: { coins: 100 },
      convo: [
        { npc: "That chest by my tent is a BANK. Anything you store is safe forever — death can't touch it. Out here on a lonely isle the vault is free and private.",
          r: ["Is it the same on the mainland?"] },
        { npc: "Grander: every road-connected settlement shares one network. Stash your ore in one town, withdraw it in the next — the Bank of Newhaven's web spans nearly the whole known world.",
          r: ["How do I join a network?"] },
        { npc: "Big city networks want a signature at their main branch — a grand three-storey hall with a row of tellers. Village co-ops will sign you at the counter. Here — a hundred coins of seed money. Put something in the vault before you walk on, just to feel it.",
          r: ["Anything else before I go?"] },
        { npc: "See my CARPENTER'S BENCH? The camps ahead run on MILK, and milk needs pails. Fell a tree here, saw your logs into PLANKS at the bench, and MAKE NINE EMPTY PAILS.",
          r: ["Nine's a lot to carry."] },
        { npc: "That's the lesson, e hoa — stash the spares in the vault. It carries what your pack can't, and they'll be waiting at any bank you find. {farm}'s fields are through the gate.",
          r: ["Good to know — thank you."] },
      ],
    },
    farm: {
      reward: { items: [["hoe", 1], ["seed_wheat", 10], ["seed_potato", 10], ["seed_apple", 10], ["seed_sageleaf", 10], ["seed_flax", 10]] },
      convo: [
        { npc: "Welcome to the heart of the isle! My farm behind the fence has FIVE ROWS, five plots each — one row per crop: wheat, potatoes, apples, sageleaves, flax, all ripe and waiting. Take this hoe and TEN SEEDS of each, and step through the gate.",
          r: ["What do you need picked?"] },
        { npc: "Bring in TWENTY of each crop — a good picking of every row. And learn the marvel: crops grow in REAL time. REPLANT a row after you clear it — sowing takes five seeds, and most harvested crops drop one back — and it ripens again in minutes, whether you watch or wander.",
          r: ["Is there more than crops here?"] },
        { npc: "Grain becomes food at the MILLSTONE — mill TEN wheat into flour, bran and all, for baking up the path. Keep your flax too; it spins into linen for candle wicks. And livestock roam the pasture: TEND them for wool, milk, feathers and eggs.",
          r: ["What should I tend?"] },
        { npc: "Tend my QUAIL and hens for TEN eggs — save some for the fritters! — and TEN FEATHERS, the exact fletching budget for {wood}'s thirty arrows, so every feather counts. Watch for GIANT animals: one in six is born big and gives double. And that grey mountain in the pasture is a KURANUI, the biggest bird that ever walked — she minds her own business; you mind yours around her feet.",
          r: ["This'll take a while to grow out."] },
        { npc: "Here's the vale's deepest secret, and my favourite: while the rows regrow, DON'T stand waiting. Press X and SPLIT into TWO SELVES — each with hands, a pack, a will. Leave one to reap, replant and mill, and walk the other wherever it's needed. Tab hops between them; your strength divides apart and flows back whole when you rejoin. Keep BOTH busy — that's my mark.",
          r: ["Where would I send the other self?"] },
        { npc: "My gift for the road: the little gate NE through my east arch is MY SHORTCUT, a straight lane from the bank chamber into {wood}'s camp. It unbars when my stage is done. Send your free self to wait there; when the last crop falls, both roads open — one self through the crown's south gate, one through the shortcut — and you meet at Torra's benches.",
          r: ["Remind me of the whole list?"] },
        { npc: "Twenty of each crop, ten flour milled, ten eggs and ten feathers, and both selves at work. Keep those pails handy — {cook} up the path keeps COWS, and once your Husbandry reaches THREE they'll fill every pail you carry. At dusk in a real town you'll see lamplighters set glowing candle-stands, gathered again by dawn. This world lives its own life.",
          r: ["Two of me — let's get to it."] },
      ],
    },
    wood: {
      convo: [
        { npc: "Kia ora — both of you, if Kenji taught you right! First things first: stand your two selves SIDE BY SIDE and press X to MERGE back into one. Divided hands are grand for waiting on crops; fletching three hundred arrows wants your whole strength in one pair of arms.",
          r: ["One of me again. What's here?"] },
        { npc: "The woodcrafting camp — everything begins with LOGS, the ones you felled in the bush. At the sawmill you SAW logs into boards; at my bench you shape them further. Three skills live here: Sawing, Fletching and Carpentry. No gifts from me — you make your own kit from wood you cut.",
          r: ["Walk me through the ladder."] },
        { npc: "FIRST: cut THREE HUNDRED ARROW SHAFTS at my bench — twenty logs, fifteen shafts a cut. By the last bundle your Fletching reaches LEVEL TWO, exactly what iron arrows demand. SECOND: bind THIRTY IRON ARROWS — two batches, each fifteen shafts, five of the vale's feathers and fifteen of {smith}'s iron heads. Your feathers and heads are the exact budget: nothing wasted.",
          r: ["And the bow?"] },
        { npc: "THIRD: carve a SHORTBOW from a couple of logs. That bow and those arrows are how you'll bring down the warden's koreke later, so make them well. Those pails you sawed back at {bank}'s camp will earn their keep soon — {cook} keeps cows, cows mean milk, milk means cheese. On you go!",
          r: ["To the bench, then."] },
      ],
    },
    cook: {
      convo: [
        { npc: "Welcome to my kitchen! Cooking heals you, and the finest dishes grant buffs. Three trades here: Cooking, Baking and Cheesemaking. My fires are yours to light — you've carried flint since {smith}'s forge, so strike your blade and stoke with logs, same as he taught.",
          r: ["Where do I start?"] },
        { npc: "The FRITTERS first: bind raw whitebait with an egg at my cookfire and fry it — cook FIVE golden whitebait fritters.",
          r: ["And the cheese?"] },
        { npc: "You'll need MILK. Take your empty PAILS to my COWS and milk them — a little Husbandry does it; tend the vale's flocks if yours isn't there yet. Curdle the milk at my creamery into curds, then press ONE COTTAGE CHEESE.",
          r: ["Is there bread too?"] },
        { npc: "That flour you milled bakes into FLATBREAD at my bakehouse — bake FIVE. Five fritters, a cottage cheese, five flatbread, and {war} waits at the pit past the gate. Go well fed!",
          r: ["Smells good already — thanks."] },
      ],
    },
    war: {
      reward: { items: [["potion_health", 2]] },
      convo: [
        { npc: "Draw that iron shortsword you forged — and take these two health draughts. The SLIMES in the pit are yours: click one and go.",
          r: ["How does fighting work?"] },
        { npc: "Two ways. MELEE is sword and shield up close; ARCHERY looses real arrows that arc through the air — you can kite, but you need line of sight. There are stranger arts out in the wide world — woven magic, spoken spells — but those are lessons for beyond the mist, not for my pit.",
          r: ["What do you want me to prove?"] },
        { npc: "Slay THREE SLIMES, and gather ONE TALLOW and THREE HIDE from the pit's beasts, THREE ACTION RUNES off the slimes, and THREE STATE RUNES — mine the essence rocks for those. Monsters drop coins and rare REAGENTS that gate whole crafting skills; hunters feed the whole economy.",
          r: ["Anything I should keep track of?"] },
        { npc: "Every kill fills your BESTIARY — press B to read it. And mind this: the wilds get harder the further you roam from Newhaven, but near towns and roads there are PEACE ZONES, so nothing jumps you on Main Street.",
          r: [{ t: "Open the bestiary (B)", act: "bestiary" }, "What about that bird?"] },
        { npc: "The KOREKE — the little quail about the pit? Startle one and it takes to the air, and a bird on the wing is beyond any blade; this is what your bow is for. Nock an arrow, lead the flight, and bring ONE down. That's archery. Run dry and I'll come running with more — don't fret the count.",
          r: ["Where to when the pit's done?"] },
        { npc: "Slimes slain, reagents gathered, a koreke down — then wash up with {soap} at the springs past the gate. You've earned a scrub.",
          r: ["Time to fight."] },
      ],
    },
    sky: {
      reward: { coins: 30 },
      convo: [
        { npc: "Before the sky, a wonder closer to hand. Everyone you've met on this isle — everyone in this whole world — can be SPOKEN WITH. Not clicked. Spoken with. Press ENTER, say anything in your own words, and we answer.",
          r: ["What should I ask you?"] },
        { npc: "Ask me what I love about my knoll. Ask about the rain that soaked you at the bank camp, or what I make of the Warden's slimes, or whether the stars go out. And understand what you hear: no script, no wheel of stock phrases, and no dream-machine inventing words nobody meant. Every answer is a thing a real soul once truly said, found because it fits YOUR words. Say something to me — and hear for yourself.",
          r: ["Tell me about this sky, then."] },
        { npc: "Look up! Out in the wide world, day and night roll on REAL time — and the world's so wide it has TIMEZONES: every 256 tiles east is an hour ahead. Newhaven's clocks already read three hours ahead of ours.",
          r: ["Does the whole world share one day?"] },
        { npc: "This isle sits at an even 50% latitude — half day, half night. Sail far enough north or south and latitude changes the days themselves: polar summers where the sun never sets, winters where it barely rises. Here on Tūhura the sky turns as YOU learn — each keeper finished rolls the day forward. Stay the course and you'll earn the stars.",
          r: ["What about the weather?"] },
        { npc: "Weather fronts drift across the world like the real thing — watch the pressure fall before a storm on a barometer. Rain swells the rivers into flood; in the cold lands, snow settles white on every roof, then melts away. The wide chart is kept in Newhaven: press M once you've crossed for day/night bands and a synoptic chart. Until then, read the sky itself — it never lies for long. {candle} keeps the hollow just past my knoll.",
          r: ["I'll go and really talk to you now."] },
      ],
    },
    candle: {
      convo: [
        { npc: "Evening's coming on — feel how the isle dims? Out in the world, night is DARK, and a carried light is worth more than gold in a dungeon or on a midnight road. That's my craft: Candlemaking.",
          r: ["What do I need to make one?"] },
        { npc: "No gift — you've already gathered the makings. Remember the flax you reaped in the vale, and the tallow off the warden's beasts? Those become a candle. We start with the humblest light there is: the RUSHLIGHT. No wick to spin — just tallow, dipped at my chandlery until it holds a flame. DIP ONE and the gate opens.",
          r: ["How do I use it?"] },
        { npc: "Carry it lit in your off-hand — click it in your pack — and its glow walks with you; you'll want that tonight. When your Candlemaking grows, come back for wicks and tapers, scented and cathedral candles beyond. {lore} waits at the portal crown.",
          r: ["I'll dip one now."] },
      ],
    },
    lore: {
      reward: { items: [["state_rune", 50]] },
      convo: [
        { npc: "Take these — FIFTY raw STATE RUNES, humming with unshaped intent. Raw, they're just cold stones; shaped at a RUNESTONE ALTAR they become true runes. That's my craft: RUNECRAFTING.",
          r: ["What do I do with them?"] },
        { npc: "My altar stands beside the portal. Work all fifty into AIR RUNES — the lightest, kindest shaping there is — and feel the craft settle into your hands. As your Runecrafting deepens, each raw stone yields more. And keep Miles's rushlight EQUIPPED in your off-hand — night won't fall proper till it's burning at your side and the altar's done.",
          r: ["Why air runes, though?"] },
        { npc: "Look at that stone ring on the crown: an ANCIENT PORTAL, one of a network scattered across the endless world. Step up and it ATTUNES to you. Attune every portal you find and you can leap between them — FOR A PRICE IN RUNES. The further the jump, the finer the rune the veil demands; your fifty air runes are short-hop fare. This one the mist reclaims when you sail, but out there every portal you wake is yours for good.",
          r: ["Anything else I should know out there?"] },
        { npc: "Folk marked with a ✦ have WORK for you — letters to carry, roads to clear, sealed rooms to open. Finish one and they trust you with something bigger. Press J for your journal, M for the world map, which zooms from your street to the whole world. And right-click a city fountain to set your RESPAWN there, so death returns you somewhere friendly. The harbour waits below — {ferry} will open the way.",
          r: [{ t: "Open the quest journal (J)", act: "questlog" }, "Thank you — I'm set."] },
      ],
    },
    // shown once the player has slept at Sigrid's spare room (t.sleptAtSigrids)
    // — the "Ready for the wide world?" intro already ran in FERRY_INVITE
    // the night before, so this picks straight up the next morning
    ferry: {
      convo: [
        { npc: "Slept well? Good — a clear head for a strange road. You'll climb until the isle is a coin on the sea, fall between worlds the whole night through, and drop out of a MORNING sky over Newhaven — the grand bank, the markets, the quest-givers and the thousand roads all waking beneath you.",
          r: ["Then I'm ready. Sing it."] },
        { npc: "Stand ready, and I'll sing the light down.",
          r: [{ t: "Sing the song — send me up!", act: "graduate" }, { t: "I'll explore a little longer", act: "close" }] },
      ],
    },
  };

  // action buttons → real UI
  const ACTS = {
    charselect: () => { close(); if (typeof CharSelect !== "undefined") CharSelect.open(); },
    bestiary: () => { close(); if (typeof openBestiary === "function") openBestiary(); },
    map: () => { close(); if (typeof openWorldMap === "function") openWorldMap(); },
    questlog: () => { close(); if (typeof Quests !== "undefined") Quests.openLog(); },
    graduate: () => { close(); graduate(); },
    sigridBed: () => { close(); inviteSigridSleep(); },
    // (the Cook's pail-for-milk barter was removed 2026-09-15, user req —
    // milk is earned at her cows with your own Husbandry, no shortcut)
    close: () => close(),
  };

  // ---------- journey progress ----------
  // The old top-of-screen journey BAR (#tutbar) was RETIRED (2026-09-15, user
  // req): its live, itemised stage checklist now lives in the sidebar Goals tab
  // (main/ui.js renderGoals, fed by goalState()). refreshBar survives as the one
  // call every progress hook (bumpProg, talk, graduate, charselect, …) already
  // makes — it just tears down any stray bar element (defensive: legacy saves /
  // hot reload) and flags the UI dirty so an open Goals tab repaints at once.
  let barEl = null;
  // per-pod respawn (softened 2026-09-16): dying anywhere on a live isle used
  // to send you clear back to wherever player.respawn was last set (pod 0,
  // effectively) — the harshest death penalty landing in the first 15
  // minutes. Every progress event funnels through refreshBar(), so this
  // keeps player.respawn pinned to the CURRENT pod's keeper (frontier()'s
  // tutor — the pod you're free to roam but haven't cleared yet) without
  // needing its own hook on every individual req/finish call site.
  let _respawnFrontier = -1;
  function _respawnSync() {
    if (!active()) return;
    const f = Math.min(frontier(), TUT_TUTORS.length - 1);
    if (f === _respawnFrontier) return;
    _respawnFrontier = f;
    const tu = TUT_TUTORS[f];
    const [px, py] = podXY(tu.pod);
    // "name" feeds combat.js's generic "wake up by the fountain in {name}"
    // wake message — a place-flavoured phrase reads fine there, a person's
    // full name+title wouldn't
    player.respawn = { x: px + tu.dx, y: py + tu.dy, name: tu.role + "'s camp" };
  }
  function refreshBar() {
    if (barEl) { barEl.remove(); barEl = null; }
    if (typeof uiDirty !== "undefined") uiDirty = true;
    _respawnSync();
    // every progress event funnels through here — settle the keepers' evening
    // village move whenever the frontier or the staged clock has advanced
    _villageSync();
  }

  // Structured snapshot of the CURRENT stage's goals for the sidebar Goals tab
  // (js/main/ui.js renderGoals). Reuses the very same REQS/reqNum/items machinery
  // the journey bar itemises, so the tab and the bar can never drift. Returns
  // null off-tutorial; {graduated:true, cur:null} once the whole isle is walked.
  function goalState() {
    const t = state();
    if (!t) return null;
    const total = TUT_TUTORS.length;
    const doneN = TUT_TUTORS.filter(tu => tutorComplete(tu.id)).length;
    const pct = Math.round(doneN / total * 100);
    const f = frontier();
    if (t.graduated || f >= total)
      return { graduated: true, doneN, total, pct, cur: null };
    const tu = TUT_TUTORS[f];
    const met = !!(t.seen && t.seen[tu.id]);
    const rows = [{ on: met, label: "meet " + tutorName(tu), num: met ? 1 : 0, need: 1 }];
    const r = REQS[tu.id];
    if (r) {
      if (r.items) {
        for (const it of r.items(t)) rows.push({ on: it.on, label: it.label, num: it.num, need: it.need });
      } else {
        rows.push({ on: reqDone(tu.id), label: r.task, num: reqNum(tu.id), need: reqNeed(tu.id) });
      }
    }
    return { graduated: false, doneN, total, pct,
      cur: { id: tu.id, name: tutorName(tu), role: tu.role, full: tutorFull(tu), met, rows } };
  }

  // ---------- dialogue UI ----------
  // A bottom CONVERSATION BAR, not a screen-blanking modal: the keeper's one
  // spoken line (said aloud over their head as a bubble too) and the player's
  // response buttons. Clicking a response advances the talk; a plain response
  // on the last beat finishes (grant + staged-sky roll). See the DLG note.
  let el = null, cur = null, curNpc = null, beat = 0;
  function liveNpc(id) {
    const list = (typeof world !== "undefined" && world && world.npcs) ||
      (typeof npcs !== "undefined" ? npcs : null);
    return list ? list.find(n => n && n.tutor === id) : null;
  }
  function ensureDom() {
    if (el) return;
    el = document.createElement("div");
    el.id = "tutdlg";
    // a full-screen catcher (so a stray click can't walk the player off
    // mid-talk) but TRANSPARENT — the scene, and the keeper's overhead speech
    // bubble, stay in full view behind the bar
    el.style.cssText = "display:none;position:fixed;inset:0;z-index:9000;pointer-events:auto;" +
      "align-items:flex-end;justify-content:center;font:16px OpenDyslexic, Verdana, sans-serif;";
    el.innerHTML =
      `<div id="tutdlg-card" style="width:min(640px,94vw);margin:0 0 8vh;background:rgba(20,24,32,.96);` +
      `border:1px solid rgba(90,120,180,.5);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.6);` +
      `padding:16px 20px;color:#dfe6f2;">` +
      `<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:8px;">` +
      `<div id="tutdlg-name" style="font-size:17px;font-weight:bold;color:#ffd75e;"></div>` +
      `<div id="tutdlg-role" style="font-size:12px;color:#8fa3c8;"></div>` +
      `<button id="tutdlg-x" style="margin-left:auto;background:none;border:none;color:#8fa3c8;font-size:18px;cursor:pointer;line-height:1;">✕</button></div>` +
      `<div id="tutdlg-line" style="margin:2px 0 12px;color:#eaf1ff;line-height:1.5;"></div>` +
      `<div id="tutdlg-extra"></div>` +
      `<div id="tutdlg-r" style="display:flex;flex-direction:column;gap:8px;"></div>` +
      `</div>`;
    document.body.appendChild(el);
    // clicks on the transparent catcher do nothing (no accidental close); the
    // card swallows its own clicks
    el.addEventListener("mousedown", e => e.stopPropagation());
    el.addEventListener("click", e => e.stopPropagation());
    document.getElementById("tutdlg-x").onclick = close;
    document.addEventListener("keydown", e => {
      if (!isOpen()) return;
      // never steal keystrokes while the player is typing (chat bar, notes)
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") { e.stopPropagation(); close(); return; }
      const b = curBeat(), rs = (b && b.r) || [];
      // Enter / Space take the first response; number keys pick that response
      if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); if (rs[0] != null) pick(rs[0]); return; }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= rs.length) { e.stopPropagation(); e.preventDefault(); pick(rs[n - 1]); }
    }, true);
  }
  const isOpen = () => el && el.style.display === "flex";
  function close() { if (el) el.style.display = "none"; cur = null; curNpc = null; }
  // one-beat nudge shown when the Guide is re-visited while you're still a
  // spark of light (the C key is disabled — the Guide is the only chooser)
  const GUIDE_REMIND = [
    { npc: "You're still a spark of unformed light, e hoa — the path east won't open until you've taken a body.",
      r: ["How do I choose one?"] },
    { npc: "Choose one now and become someone. You can always come back to me and pick a different form later.",
      r: [{ t: "Choose my character", act: "charselect" }] },
  ];
  // With no fence between the Landing and the Harbour (one open village
  // shore), a fresh hand can stroll up to Sigrid on DAY ONE — she plays
  // village host, but also offers the crossing early (user req): the
  // "graduate" act works unchanged for an early Sigrid (finishSilent() no-ops
  // on cur._early, so no stage/reward bookkeeping fires — graduate() itself
  // doesn't care how far the journey got). Declining (the close act) marks
  // NOTHING seen (the staged sky doesn't turn).
  const FERRY_EARLY = [
    { npc: "Haere mai to the village, traveller! This shore is where the keepers lay their heads when the day's teaching is done — walk among the tents; you're welcome here any hour.",
      r: ["When does your waka sail?"] },
    { npc: "She properly sails for Newhaven once every keeper on the path has sent you on — their lessons, tools and gifts yours along the way. But if you'd rather not wait, say the word and I'll sing you there right now: you'll land with empty hands, nothing learned, and no going back to finish what you skipped.",
      r: [{ t: "Skip ahead — sing me up now", act: "graduate" }, { t: "I'll earn it properly", act: "close" }] },
  ];
  // journey's done, night's fallen — Sigrid invites the player to rest before
  // the crossing (user req 2026-09-17). The sigridBed act (inviteSigridSleep)
  // is what marks her "seen" and rolls the staged sky to night, then starts
  // the walk-to-bed escort — so this convo ENDS on that act and never calls
  // finish() (which would double-advance the stage).
  const FERRY_INVITE = [
    { npc: "I'm {ferry}. I have sailed every sea you can dream of, and here's a navigator's secret: no hull sails OUT of Tūhura. For that there's my wayfinding song — a pillar of light to lift you over the roof of the sky and set you down in Newhaven, the great city at the centre of everything.",
      r: ["What becomes of the isle?"] },
    { npc: "Tūhura exists between the tides. The moment you rise, the mist takes it back — no chart, ship or portal will ever find it again. So take your time, and take every gift.",
      r: ["I think I'm ready."] },
    { npc: "Not tonight, e hoa — a tired body has no business singing itself across the sky. I keep a spare room off my own; sleep there, and we'll talk come morning, clear-headed and ready for the crossing. Go on — I'll walk you down myself.",
      r: [{ t: "Follow Sigrid to her spare room", act: "sigridBed" }] },
  ];
  const curConvo = () => (cur && cur._remind) ? GUIDE_REMIND
    : (cur && cur._early) ? FERRY_EARLY
    : (cur && cur._preSleep) ? FERRY_INVITE
    : (cur ? DLG[cur.id].convo : []);
  const curBeat = () => { const c = curConvo(); return c && c[beat]; };
  // the player picks a response: echo it, run its directive, then advance
  function pick(r) {
    if (!cur) return;
    const label = subst(typeof r === "string" ? r : r.t);
    if (typeof log === "function") log(`You: ${label}`, "sys");
    if (r && typeof r === "object") {
      if (r.end) { close(); return; }
      if (r.finish) { finish(); return; }
      if (r.act) {
        // charselect/graduate/close complete the stage silently as they close
        // (matches the old page-act rule); bestiary/questlog/sigridBed don't
        if (r.act === "graduate" || r.act === "close" || r.act === "charselect") finishSilent();
        if (ACTS[r.act]) ACTS[r.act]();
        return;
      }
      if (r.goto != null) { beat = r.goto; render(); return; }
    }
    // a plain response advances; the last beat finishes (grant + sky roll)
    const convo = curConvo();
    if (beat < convo.length - 1) { beat++; render(); }
    else finish();
  }
  function finish() {
    if (!cur) return;
    // the Navigator's early village-host chat leaves no trace: her stage
    // isn't "met" and the staged sky holds still
    if (cur._early) { close(); return; }
    const t = state();
    if (t) {
      const prev = _seenCount;
      t.seen[cur.id] = 1;
      _seenCount = Object.keys(t.seen).length;
      grant(cur.id, DLG[cur.id].reward);
      advanceStage(prev); // the staged sky rolls forward with each keeper met
      // announce the keeper's hands-on task (the gate stays shut until it's done)
      if (REQS[cur.id] && !reqDone(cur.id) && typeof log === "function")
        log(`${tutorName(cur)}'s task: ${REQS[cur.id].task} — then the gate opens.`, "gold");
      refreshBar();
      if (typeof saveGame === "function") saveGame();
      if (typeof uiDirty !== "undefined") uiDirty = true;
    }
    close();
  }
  // mark seen + grant without closing twice (action buttons close themselves)
  function finishSilent() {
    if (cur && cur._early) return;
    const t = state();
    if (t && cur) {
      const prev = _seenCount;
      t.seen[cur.id] = 1;
      _seenCount = Object.keys(t.seen).length;
      grant(cur.id, DLG[cur.id].reward);
      advanceStage(prev);
      refreshBar();
    }
  }
  function render() {
    const b = curBeat();
    if (!b) { close(); return; }
    const line = subst(b.npc);
    document.getElementById("tutdlg-name").textContent = tutorName(cur);
    document.getElementById("tutdlg-role").textContent = "· " + cur.role + " of Tūhura Isle";
    document.getElementById("tutdlg-line").textContent = line;
    // say it aloud over the keeper's head too — quote-free, by design (the
    // bubble renders the line verbatim, so it must never carry quote marks)
    if (curNpc && typeof npcSay === "function") { try { npcSay(curNpc, line); } catch (e) { /* no live npc */ } }
    const extra = document.getElementById("tutdlg-extra");
    extra.innerHTML = "";
    // the Guide's first beat appends the live itinerary (not on the reminder)
    if (cur.id === "guide" && !cur._remind && beat === 0) extra.appendChild(progressList());
    const row = document.getElementById("tutdlg-r");
    row.innerHTML = "";
    (b.r || []).forEach((r, i) => {
      const label = subst(typeof r === "string" ? r : r.t);
      const isAct = !!(r && typeof r === "object" && r.act);
      const btn = document.createElement("button");
      btn.textContent = `${i + 1}. ${label}`;
      btn.style.cssText = "text-align:left;padding:10px 14px;cursor:pointer;font:inherit;border-radius:8px;" +
        (isAct ? "background:rgba(60,140,90,.22);color:#9fe8c0;border:1px solid rgba(90,170,120,.55);"
               : "background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.18);");
      btn.onmouseenter = () => (btn.style.background = isAct ? "rgba(90,200,130,.3)" : "rgba(127,208,255,.22)");
      btn.onmouseleave = () => (btn.style.background = isAct ? "rgba(60,140,90,.22)" : "rgba(255,255,255,.06)");
      btn.onclick = e => { e.stopPropagation(); pick(r); };
      row.appendChild(btn);
    });
  }
  function progressList() {
    const t = state();
    const f = frontier();
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-top:10px;padding:10px 12px;background:#121623;border:1px solid #2a3550;border-radius:6px;";
    const head = document.createElement("div");
    head.style.cssText = "color:#8fa3c8;font-size:13px;margin-bottom:6px;";
    head.textContent = `The journey east — ${_seenCount} / ${TUT_TUTORS.length} keepers met`;
    wrap.appendChild(head);
    TUT_TUTORS.forEach((tu, i) => {
      const row = document.createElement("div");
      const done = tutorComplete(tu.id);
      const lockd = i > f;
      row.style.cssText = `font-size:13px;color:${done ? "#6fae8a" : lockd ? "#4a5670" : "#7fe3c7"};`;
      const r = REQS[tu.id];
      const suffix = (r && t && t.seen[tu.id] && !done)
        ? ` — ${r.task}${reqNeed(tu.id) > 1 ? ` (${reqNum(tu.id)}/${reqNeed(tu.id)})` : ""}`
        : i === f ? " — " + dirFrom(tu) : "";
      row.textContent = `${done ? "✦" : lockd ? "🔒" : "◈"} ${tutorFull(tu)}${suffix}`;
      wrap.appendChild(row);
    });
    return wrap;
  }
  function dirFrom(tu) {
    const [px, py] = podXY(tu.pod);
    const dx = px + tu.dx - player.x, dy = py + tu.dy - player.y;
    const d = Math.round(Math.hypot(dx, dy));
    if (d < 6) return "right here";
    const dirs = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
    return `${d} tiles ${dirs[Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) & 7]}`;
  }

  // ---------- entry points ----------
  function talk(npc) {
    const def = TUT_TUTORS.find(x => x.id === npc.tutor);
    if (!def || !DLG[def.id]) return false;
    // once a keeper has settled into the Harbour Village for the night, their
    // scripted lesson is done for good — fall through to ui.js's normal NPC
    // chat (the speech-bubble line, and the semantic Enter-key chat, which
    // was never gated on npc.tutor in the first place) instead of replaying
    // the intro forever (user req 2026-09-17). Sigrid never gets a village
    // seat (villageHome always returns null for "ferry" — she never leaves
    // her waka), so this never retires her — her own dialogue tree handles
    // its own phases (early/invite/graduate) via curConvo() below.
    if (villageHome(def.id) != null) return false;
    ensureDom();
    cur = def;
    // the live keeper object (for the overhead speech bubble) — maybeWelcome
    // passes a bare { tutor } stub, so resolve the real npc from the world
    curNpc = liveNpc(def.id) || npc;
    // Guide re-visited while still a spark → jump straight to the "take a form"
    // nudge instead of replaying the whole intro
    const t = state();
    cur._remind = def.id === "guide" && !!(t && t.seen.guide) && !hasBody();
    // Sigrid reached ahead of the journey's end (the open village shore
    // makes that a one-minute stroll from the Landing): host, don't ferry
    cur._early = def.id === "ferry" && frontier() < TUT_TUTORS.length - 1;
    // Sigrid, journey done, but hasn't slept yet — show the invite instead
    // of "sing the song" (user req 2026-09-17: sleep till morning first)
    cur._preSleep = def.id === "ferry" && !cur._early && !(t && t.sleptAtSigrids);
    // openGrant tutors (the Bushman's axe) hand their tool over the instant
    // the dialogue opens, not after every page is read — grant() is
    // idempotent (t.given[tid]), so finish()'s later call is a no-op
    if (!cur._remind && !cur._early && DLG[def.id].openGrant) grant(def.id, DLG[def.id].reward);
    beat = 0;
    el.style.display = "flex";
    render();
    refreshBar();
    return true;
  }

  // the one-time welcome popup, a few beats after a fresh character boots in
  // (also re-hangs the journey bar on every boot of a live tutorial save)
  function maybeWelcome() {
    const t = state();
    refreshBar();
    if (!t || t.welcomed || t.graduated || !onIsle()) return;
    t.welcomed = 1;
    if (typeof log === "function") {
      log("A nameless spark of light washes ashore on Tūhura Isle — the Isle of Discovery.", "gold");
      log(`Talk to ${tutorFull(TUT_TUTORS[0])} (just north of you), then follow the path east.`, "sys");
    }
    setTimeout(() => { talk({ tutor: "guide" }); if (typeof saveGame === "function") saveGame(); }, 1200);
  }

  // the Navigator's crossing: teleport to Newhaven, then SEAL the isle —
  // it exists only inside the tutorial, so the mist takes back every trace.
  // graduateCore() is the silent mechanics (teleport + seal + overnight
  // clock shift + save); graduate() wraps it in the Bifrost light-pillar
  // cinematic (gameplay/bifrost.js) when available, falling back to the
  // old instant crossing if the cinematic module is missing.
  function graduateCore() {
    const t = state();
    const s = world.playerStart;
    world.getChunk(Math.floor(s.x / world.CHUNK), Math.floor(s.y / world.CHUNK));
    if (typeof cancelAction === "function") cancelAction();
    player.x = s.x; player.y = s.y;
    player.px = PX(s.x); player.py = PX(s.y);
    player.moving = null; player.path = []; player.forced = null;
    player.level = 0; player.deck = undefined; player.sailing = null;
    player.respawn = null; // wake in Newhaven from here on
    if (t) t.graduated = 1;
    // scrub the isle from the world: explored-map marks, hot chunk data and
    // any attuned isle portal all dissolve (barred() keeps feet and hulls out)
    const B = TUT_ISLE.bbox, CS = world.CHUNK;
    const x0 = B.x0 * 2 - 48, x1 = B.x1 * 2 + 48, y0 = B.y0 * 2 - 48, y1 = B.y1 * 2 + 48;
    const inRect = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    if (typeof seenChunks !== "undefined")
      for (const k of [...seenChunks]) {
        const [cx, cy] = k.split(",").map(Number);
        if (inRect(cx * CS + CS / 2, cy * CS + CS / 2)) seenChunks.delete(k);
      }
    if (world.chunks)
      for (const k of [...world.chunks.keys()]) {
        const [cx, cy] = k.split(",").map(Number);
        if (inRect(cx * CS + CS / 2, cy * CS + CS / 2)) world.chunks.delete(k);
      }
    for (const k of Object.keys(player.portals || {})) {
      const [px, py] = k.split(",").map(Number);
      if (inRect(px, py)) delete player.portals[k];
    }
    // …and the in-memory map artefacts (chunk bakes, mip tiles, macro tiles
    // — the minimap composites the same bakes). map.js never PERSISTS any
    // artefact touching the isle footprint (the _isleSealHit guards, same
    // scheme as the per-character islet zone), so in-memory is the whole
    // job: after this, no rendering of the isle survives graduation at all.
    if (typeof world !== "undefined" && world && world.mapDropRect)
      world.mapDropRect(B.x0 - 24, B.y0 - 24, B.x1 + 24, B.y1 + 24);
    // (The crossing used to shift player.timeShiftMs so graduation always
    // landed in a Newhaven morning — removed: the shared world keeps ONE
    // clock, a pure function of unix time, so every player sees the same
    // sun. Graduates now arrive in whatever hour the world is actually in.)
    player.timeShiftMs = 0;
    refreshBar(); // graduated → the journey bar comes down
    if (typeof saveGame === "function") saveGame();
    if (typeof uiDirty !== "undefined") uiDirty = true;
  }
  function graduateLogs() {
    if (typeof log !== "function") return;
    log("You fall out of a bright morning sky — welcome to NEWHAVEN, heart of the endless world. Your story starts now.", "gold");
    log("The crossing took the night. Far behind, the mist has closed over Tūhura Isle — no chart, ship or portal will ever find it again.", "sys");
  }
  function graduate() {
    // The crossing leads into the shared, live world — so on server builds it
    // requires an account. AccountGate.require blocks with a create/login modal
    // and re-enters graduate() once there's a session (a no-op, immediate
    // pass-through in offline/dev builds). Guard against re-showing mid-wait.
    if (typeof AccountGate !== "undefined" &&
        typeof Server !== "undefined" && Server.enabled() && !Server.logged()) {
      AccountGate.require(() => graduate());
      return;
    }
    if (typeof log === "function")
      log("Sigrid's wayfinding song rises — and the sky answers with a pillar of light.", "gold");
    if (typeof Bifrost !== "undefined" && Bifrost.start) {
      Bifrost.start({ onTeleport: graduateCore, onDone: graduateLogs });
    } else {
      graduateCore();
      graduateLogs();
      if (typeof sfx === "function") sfx("portal", 0.7);
    }
  }

  // ---------- per-frame tick (main.js) ----------
  // Reaching the river source (once the swim lesson opened it) rewards the
  // climb and cues the ride down. Cheap: only checks when a live tutorial
  // character is actually on the isle.
  // one-shot after load: an isle-geometry change (e.g. the 2026-09-16 ringed
  // rebuild) leaves relics in an older save — a mid-journey character whose
  // saved position is now open private ocean, and explored-map chunks that
  // now hold nothing but that ocean. Wash the character ashore at their
  // frontier keeper's camp and prune the drowned exploration so the world
  // map/minimap read clean.
  let _shoreChecked = false;
  function _shoreWash(t) {
    _shoreChecked = true;
    if (typeof tutIsleSD !== "function" || typeof world === "undefined" || !world) return;
    // prune runs for EVERY save (graduates carry the old explored band too)
    if (typeof seenChunks !== "undefined" && world.CHUNK) {
      for (const k of [...seenChunks]) {
        const [cx, cy] = k.split(",").map(Number);
        const q2 = tutIsleSD((cx * world.CHUNK + world.CHUNK / 2) / 2,
                             (cy * world.CHUNK + world.CHUNK / 2) / 2);
        if (q2 && q2.D > 12) seenChunks.delete(k); // whole chunk = private ocean now
      }
    }
    if (!t || t.graduated) return;
    const q = tutIsleSD(player.x / 2, player.y / 2);
    // a character saved standing on (or swimming for) the Swim-Master's
    // islet is exactly where they mean to be — no tide-rescue for them
    if (inIsletRegion(player.x / 2, player.y / 2)) return;
    // adrift: outside the coast, or bobbing in the coastal shallows — a
    // legitimate lagoon/river swimmer sits well inland (D < -3) and is left be
    if (q && q.D < 60 && (q.D > 1 || (q.D > -3 && world.isWater(player.x, player.y)))) {
      const f = Math.min(frontier(), TUT_TUTORS.length - 1);
      const [px, py] = podXY(TUT_TUTORS[f].pod);
      let tx = px, ty = py;
      ring: for (let d = 0; d <= 6; d++)
        for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          if (typeof passable === "function" && passable(px + dx, py + dy)) { tx = px + dx; ty = py + dy; break ring; }
        }
      player.x = tx; player.y = ty; player.px = PX(tx); player.py = PX(ty);
      player.path = []; player.goal = null; player.moving = null; player.sailing = null;
      if (typeof log === "function")
        log("The isle has shifted in the mists — the tide sets you ashore by your keeper's camp.", "gold");
      if (typeof saveGame === "function") saveGame();
    }
  }
  function tick() {
    const t = state();
    isletSync(); // re-seat the motu the moment the worn body changes (also at boot, BEFORE the shore-wash looks around)
    if (!_shoreChecked && typeof gameReady !== "undefined" && gameReady) _shoreWash(t);
    if (!t || t.graduated) return;
    tickEscort();
    // the split-selves lesson: BOTH selves working at once (the farm's
    // regrow waits are the natural moment — Kenji's page teaches X)
    if ((!t.prog || !t.prog.twinned) && typeof Split !== "undefined" && Split.twinBusy &&
        (player.act || player.goal || (player.path && player.path.length)) && Split.twinBusy())
      bumpGoal("twinned");
    // the Swim-Master's errand, leg two: pearl in hand, back TO VRIXA — the
    // fetch completes at her side (user req), not just any dry shore
    if (t.prog && t.prog.isletPearl && !t.prog.isletReturn) {
      const sw = TUT_TUTORS.find(t2 => t2.id === "swim");
      if (sw) {
        const [vx, vy] = podXY(sw.pod);
        if ((player.x - (vx + sw.dx)) ** 2 + (player.y - (vy + sw.dy)) ** 2 < 64)
          bumpGoal("isletReturn");
      }
    }
    // the Swim-Master's task: reach the River Source (opened by the swim lesson)
    if (!t.reachedSource && t.seen.swim) {
      const R = RV();
      const sx = R.src.x * 2, sy = R.src.y * 2;
      if ((player.x - sx) ** 2 + (player.y - sy) ** 2 < 100) {
        t.reachedSource = 1;
        if (typeof log === "function") {
          log("You reach the river's source — a cold spring bubbling from the rocks. ✓", "gold");
          log("Wade in and let the current carry you down. Ride it all the way to the sea!", "sys");
        }
        if (typeof sfx === "function") sfx("quest", 0.5);
        refreshBar();
        if (typeof saveGame === "function") saveGame();
      }
    }
    // the Skywatcher's task: climb to the Sky Knoll's crest (pod 11's bump top)
    if (!t.reachedKnoll) {
      const kp = TUT_ISLE.pods[11];
      if ((player.x - kp.mx * 2) ** 2 + (player.y - kp.my * 2) ** 2 < 36) {
        t.reachedKnoll = 1;
        if (typeof log === "function")
          log("You crest the Sky Knoll — the whole isle spread beneath you. ✓", "gold");
        if (typeof sfx === "function") sfx("quest", 0.4);
        refreshBar();
        if (typeof saveGame === "function") saveGame();
      }
    }
  }

  // The roster indices (into MIX_NPCS.list) the fifteen keepers use — same
  // resolution TUT_MIX_DEF applies (tu.mix modulo the live roster length) —
  // so Newhaven's townsfolk (render3d.js mixDefForBuilding) can exclude
  // them and never draw a duplicate keeper's face for a shopkeeper or
  // resident (Phase 7 item 4: the keeper-face collision fix).
  function keeperMixIdx() {
    if (typeof MIX_NPCS === "undefined" || !MIX_NPCS || !MIX_NPCS.list || !MIX_NPCS.list.length) return [];
    const N = MIX_NPCS.list.length;
    return TUT_TUTORS.filter(tu => tu.mix != null).map(tu => ((tu.mix % N) + N) % N);
  }

  return { START, talk, maybeWelcome, graduate, state, onIsle, active,
    phaseOverride, weatherOverride, flatSky, barred, frontier, refreshBar, goalState,
    skillVisible, riverFlow, tick, onCraft, anvilRecipes,
    villageHome, villageLamps, offDutyLine, villageBed, tutHouseUpperDecor,
    sigridSpareBedAt, sleepAtSigrids, ferryPost, onEscortArrive, tickEscort,
    onGather, onWash, onBank, onKill, onChant,
    onQueue, onBrace, onStoke, onMerge, onChatReply,
    onHarvest, onTend, onEquip, onPickup, onOutOfArrows, keeperMixIdx };
})();
if (typeof window !== "undefined") window.Tutorial = Tutorial;
