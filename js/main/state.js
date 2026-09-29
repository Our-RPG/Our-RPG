// ===== Taiao — runtime state, logs, XP, inventory, and passability =====
"use strict";

// ---------- state ----------
let world, now = Date.now(); // wall-clock epoch ms; kept live by the frame loop (main.js)
// Callers (1):
//  main/ui.js:82
// 31 anatomical/gear/rune slots. Gear items occupy one or more of these at
// once (def.equip is a single slot string, or an array for multi-slot items
// — e.g. a chestplate's equip is ["torso","pauldron1","pauldron2","left_arm",
// "right_arm"]); player.equip[slot] then holds the SAME item id repeated
// across every slot that item occupies. Paired slots run 1=right, 2=left
// (bracelet1/2, anklet1/2, pauldron1/2) — "1"/right is the preferred default
// for CHOICE items (see EQUIP_CHOICES, gameplay/items.js): a ring equips to
// right_hand if free, else left_hand, else displaces the right one; same
// pattern for bracelets (bracelet1/2) and anklets (anklet1/2). QUIVER_SLOTS
// hold a stack ({id,qty}) instead of a bare id — a quiver of arrows or a
// pouch of one rune type, depleted per-shot/per-cast — everything else is
// qty-less (bare id or null). See equipItem()/unequip() in gameplay/items.js.
const EQUIP_SLOTS = [
  "hair", "face", "back_of_head", "neck", "cape",
  "bracelet1", "bracelet2", "left_hand", "right_hand",
  "anklet1", "anklet2", "pauldron1", "pauldron2",
  "torso", "left_arm", "right_arm", "left_leg", "right_leg",
  "left_foot", "right_foot",
  "weapon", "shield", "quiver",
  "rune1", "rune2", "rune3", "rune4", "rune5", "rune6", "rune7", "rune8",
];
const RUNE_SLOTS = ["rune1", "rune2", "rune3", "rune4", "rune5", "rune6", "rune7", "rune8"];
const QUIVER_SLOTS = new Set(["quiver", ...RUNE_SLOTS]);
// Slots a "choice" item occupies exactly ONE of (never several at once) —
// preference order matters: first free candidate wins, else the first
// (default/"right") candidate's occupant is displaced back to inventory.
// def.equip for these items is the pseudo-tag key itself ("ring" etc), not
// a literal EQUIP_SLOTS name — see equipChoice()/EQUIP_CHOICES in items.js.
const EQUIP_CHOICES = {
  ring: ["right_hand", "left_hand"],
  bracelet: ["bracelet1", "bracelet2"],
  anklet: ["anklet1", "anklet2"],
};
// Callers (257):
//  content.js:359 gameplay/actions.js:5,7,16 gameplay/input.js:13,17,100,105
//  gameplay/items.js:17,23,24,27,29,32,37,38,40,45,50,52,53,59,62 gameplay/monsters.js:26,29,35,62
//  gameplay/movement.js:1,6,7,8,11,15,16,19,20,23,24,25,26,28,29,33,38,42,43,45,46,47,50,55,57,62,69,70,72,73,76,77
//  gameplay/pathing.js:7,9,11,12,45,48,53,54,59,60,64,65
//  gameplay/world.js:11,12,26,27,28,29,39,63,516,529,554,555,609,665,712 main.js:11,15,17,19,25,26
//  main/state.js:24,26,54,56,59,60,68,74,76,78,83,85,91,92,96,102,107,121,122
//  main/ui.js:38,39,50,53,73,74,85,97,111,114,167,195,207,212,215,221,223,225,291,298
//  render3d.js:222,253,269,272,273,274,275,362,397,434,435,442,446,447,449,450,451,453,455,457,458,459,460,463,465,470,471,476,477,478,560,561,587,612,628
//  skills/agility.js:7,8 skills/butchering.js:6,12,15,16,17,21
//  skills/combat.js:6,7,10,15,20,26,30,32,34,37,41,44,48,51,54,55,56,57,61,77,92,101,102,105,111,113,114,115,116,118,119,125,127,131
//  skills/crafting.js:19,38,41,52,59,65,73 skills/farming.js:11,26,28,30,34
//  skills/firemaking.js:5,7,9,10,13,14 skills/gathering.js:15,42,44,52
//  skills/thieving.js:8,15,34,36,37,38,41
//  storage.js:1,8,12,13,14,69,70,71,72,73,74,94,95,96,97,98,99,154,155 world/chunks.js:68
const player = {
  x: 0, y: 0, px: 0, py: 0, level: 0, moving: null, path: [], goal: null, forced: null,
  act: null, facing: 1, dir8: "south", character: null, outfit: "Idle", hp: 10, nextAtkAt: 0, lungeT: -9999, lungeDir: [0, 0],
  style: "melee", stunUntil: 0, buffs: {}, sailing: null,
  skills: {}, inv: new Array(48).fill(null),
  equip: Object.fromEntries(EQUIP_SLOTS.map(s => [s, null])),
  // primary-slot keys in the order items were equipped — drives the equipment
  // panel's dynamic grid (the anatomical slots above are still the "theoretical
  // space" used to resolve conflicts; this is just display order)
  equipOrder: [],
  bank: [], banks: null, bankNet: "main", bankAccounts: null, regenAt: 0,
  // production economy: recipe-family mastery + passive production jobs
  mastery: {}, jobs: [],
  // market economy: trade reputation + fulfilled contract keys
  reputation: 0, contractsDone: [],
  // ancient portal network: attuned portals, "x,y" -> display name
  portals: {},
  // bestiary: monster kind -> number slain (drives the in-game bestiary reveal)
  kills: {},
  // door/gate locks opened for good (gameplay/locks.js): canonical "x,y" -> 1
  unlocked: {},
  // stink metre (gameplay/stink.js): flavour -> accumulated points
  stink: { fl: {} },
  // chosen respawn city: { x, y, name } of its plaza fountain (right-click a
  // city fountain -> "Set respawn point"). null = Newhaven (world.playerStart).
  respawn: null,
  // persisted world-clock shift in ms (daynight.js dayPhase): graduation's
  // overnight crossing advances the world to the next Newhaven morning
  timeShiftMs: 0,
  // Tūhura Isle tutorial progress (gameplay/tutorial.js): { seen, given,
  // welcomed, graduated }. null on veteran saves that predate the isle.
  tutorial: null,
  // split selves (gameplay/split.js): the INACTIVE bodies' snapshots, this
  // body's number, and this body's task queue (queues swap with the body)
  bodies: [], num: 1, queue: [],
};
let monsters = [], groundItems = [], dynNodes = [], floats = [], splats = [], projectiles = [];
// per-session monster id counter: render meshes are keyed by uid, not array
// index, so retiring far monsters (updateWorldStuff) can compact the array
// without re-aliasing every monster's mesh onto its neighbour's sprite
let _monUid = 0;
let _monRetireAt = 0; // next far-monster retirement sweep (every ~2s)
// Cooperative boot yield for the sliced loading-bar loops (world naming,
// nearby chunk pre-gen, atlas bake): paint when visible, plain macrotask when
// the tab is hidden — rAF does NOT fire in hidden tabs and awaiting it would
// hang the whole boot — plus a 250ms watchdog for a stalled compositor.
function _bootYield() {
  return new Promise(r => {
    if (typeof document !== "undefined" && document.hidden) return setTimeout(r, 0);
    const t = setTimeout(r, 250);
    requestAnimationFrame(() => { clearTimeout(t); setTimeout(r, 0); });
  });
}
// Road worker started at the TOP of boot (main.js init) so the spawn region's
// road A* crunches in parallel with the naming pass; the loading bar's
// roadGen stage waits on it with real cells-done progress, and render3d's
// syncRoadWorker ADOPTS this worker afterwards instead of starting a second
// one. { w, done, total, finished, failed } or null where Workers don't run.
let _bootRoadWorker = null;
// decorations the player has picked up: "x,y" -> respawnAt(ms). Runtime-only;
// the decor billboard is hidden (render3d syncDecor skips it) until it returns.
let pickedDecor = new Map();
// husbandry cooldowns keyed by an animal's SPAWN tile "sx,sy" -> { readyAt, spent }.
// Persisted (storage.js) so a tended animal stays spent through a browser refresh —
// you can't reset its recovery by reloading. Restored onto the animal when it respawns.
let husbCooldowns = new Map();
let cam = { x: 0, y: 0 };
let camZoom = 1; // camera distance multiplier, ArrowUp/ArrowDown (0.35 close – 3.0 far)
// camera orbit: ArrowLeft/ArrowRight step the view around the player in 45° steps
// (aligned to the 8 sprite directions). camStep is the snapped 0..7 target;
// camYaw is the smoothly-interpolated angle the renderer actually uses.
let camStep = 0, camYaw = 0;
// Callers (2):
//  gameplay/world.js:597,602
// Max zoom is the point at which the R3D renderer's loaded world (chunk +
// entity radii scale with camZoom, see render3d viewRadius/chunkRadius) still
// fills the screen to the edges with no void.  Beyond ~3x the frustum reaches
// past what's affordable to load (reach ~= 18.4*camZoom+13 tiles; 3x -> ~69
// tiles -> a 7x7 chunk load).  The old 7.0 was an artifact of the disabled
// LC3D camera and showed a large unloaded void at full zoom-out.
const ZOOM_MIN = 0.35, ZOOM_MAX = 3.0;
let hover = null, uiDirty = true, saveAt = 0, dynId = 1000000;
// Callers (18):
//  content.js:416,438 data.js:160 gameplay/input.js:159,163 gameplay/movement.js:34,35
//  gameplay/pathing.js:4 gameplay/world.js:39,597,598 render3d.js:66,78,83 world/chunks.js:43,46,49
//  world/features.js:316
const keys = {};

// Callers (11):
//  gameplay/monsters.js:11,19,21,22 gameplay/movement.js:24,28,29 gameplay/world.js:18
//  main.js:25,26 skills/combat.js:118
const PX = t => t * TILE * SCALE;

// Callers (16):
//  main/state.js:27,29,31,32,53,55,110 main/ui.js:109,254,273 skills/agility.js:5
//  skills/crafting.js:15,38 skills/farming.js:16 skills/gathering.js:11 skills/thieving.js:7
// cheat mode: every skill is pinned at MAX_LEVEL (32) — there is no xp
function skillLvl(s) { return DEV_MODE ? MAX_LEVEL : levelFromXp(player.skills[s]); }
// Callers (15):
//  main/ui.js:119,289 skills/combat.js:22,40,47,52,58,99 skills/crafting.js:25,31,66
//  skills/gathering.js:23,28,32 skills/thieving.js:16
function eff(s) {
  const b = player.buffs[s];
  return skillLvl(s) + (b && now < b.until ? b.amt : 0);
}
// Callers (10):
//  gameplay/items.js:23,24,37,38 gameplay/world.js:26 main/state.js:60 main/ui.js:38,39
//  render3d.js:561 skills/combat.js:111
function maxHp() { return 10 + 3 * (skillLvl("Health") - 1); }
// Callers (4):
//  gameplay/monsters.js:29 main/ui.js:40,125 render3d.js:552
function combatLevel() {
  return Math.ceil(((skillLvl("Strength") + skillLvl("Archery") + skillLvl("Magic")) / 3
    + skillLvl("Melee") + skillLvl("Defence")) / 3 + 1);
}

// ---------- log / floats ----------
// Callers (2):
//  main/state.js:41,42
const logEl = document.getElementById("log");
// Callers (90):
//  content.js:50,60,62,63,65,69 gameplay/input.js:104,128
//  gameplay/items.js:6,8,23,25,28,37,41,55,61 gameplay/movement.js:69,74 gameplay/pathing.js:52
//  main.js:12,13,20 main/state.js:35,36,58
//  main/ui.js:60,61,70,71,98,132,135,155,156,160,180,205,260,261,278,279,299 skills/agility.js:5,9
//  skills/butchering.js:7,16,17,19 skills/combat.js:32,37,44,82,109,110
//  skills/crafting.js:14,16,20,40,47,51,56,71 skills/farming.js:8,12,16,17,21,30,32
//  skills/firemaking.js:6,8,9,10,16 skills/gathering.js:6,8,12,17,44,46,47
//  skills/thieving.js:6,7,9,23,27,33 storage.js:36,101
const LOG_MAX = 12;
function log(msg, cls = "") {
  const d = document.createElement("div");
  d.className = "msg " + cls;
  d.textContent = msg;
  logEl.appendChild(d);
  while (logEl.children.length > LOG_MAX) logEl.removeChild(logEl.firstChild);
}
// Same log, but the message is trusted HTML (for chat lines with a bold
// speaker name). Callers MUST escape any user text they interpolate.
function logHTML(html, cls = "") {
  const d = document.createElement("div");
  d.className = "msg " + cls;
  d.innerHTML = html;
  logEl.appendChild(d);
  while (logEl.children.length > LOG_MAX) logEl.removeChild(logEl.firstChild);
}
// Callers (3):
//  gameplay/items.js:29 main/state.js:56,59
function addFloat(text, x, y, color = "#8ff08f", size = 13) {
  floats.push({ text, x, y, t: now, color, size });
}
// Callers (3):
//  skills/combat.js:62,102 skills/thieving.js:37
// `delay` shifts the splat into the future (archery: it lands with the
// arrow, not with the fire-time damage roll) — renderers skip t > now.
function addSplat(ent, val, delay = 0) { splats.push({ ent, val, t: now + delay }); }

// ---------- xp ----------
// Callers (19):
//  gameplay/movement.js:10,71 skills/butchering.js:18 skills/combat.js:64,65,66,67,78,79,80,81,103
//  skills/crafting.js:55,70 skills/farming.js:20,31 skills/firemaking.js:15 skills/gathering.js:45
//  skills/thieving.js:28
// A single event often grants XP to several skills in one synchronous burst
// (combat.js's playerAttack: Melee+Strength+Health from one melee swing)
// — each addXp() call used to fire its float/log notification immediately,
// so same-tick notifications spawned at the identical timestamp AND the
// identical player position, rendering stacked and unreadable. State
// changes (skill XP, the level-up HP bump, uiDirty) stay synchronous —
// only the notification (the floating text + level-up log line) is
// staggered: an incrementing per-tick delay (same idea as lcTalk()'s
// sequenced setTimeout log lines, js/legacy3d.js) spaces the log lines out in
// TIME, and — this is the part that actually fixes the on-screen overlap,
// since a 220ms head start barely separates two floats that both rise at
// the same slow rate (render3d.js's `1.3 + prog*0.9` height curve) — an
// increasing Y offset per message in the same burst spaces them out in
// SPACE too, the same way the existing -30 (xp) vs -50 (level-up) offsets
// already keep those two text kinds apart.
let _xpNotifyBatch = 0, _xpNotifyBatchAt = -1;
function addXp(skill, amt, quiet) {
  if (DEV_MODE) return; // skills are pinned at max (skillLvl) — no xp exists to gain
  // per-character skill aptitude (character-stats.js): a race/class suited to a
  // skill trains it faster (missing skill = 1× = no change).
  amt = Math.round(amt * (typeof charXpMul === "function" ? charXpMul(skill) : 1));
  if (amt <= 0) return;
  if (typeof addStink === "function") addStink(skill, amt);   // skill work reeks (stink.js)
  const before = skillLvl(skill);
  player.skills[skill] += amt;
  const after = skillLvl(skill);
  const leveled = after > before;
  if (leveled) {
    if (skill === "Health") player.hp = Math.min(player.hp + 3 * (after - before), maxHp());
    uiDirty = true;
  }
  if (_xpNotifyBatchAt !== now) { _xpNotifyBatchAt = now; _xpNotifyBatch = 0; }
  const batchIndex = _xpNotifyBatch++;
  const delay = batchIndex * 220;
  const stackOffset = batchIndex * 22;
  // capture the position NOW, not inside the timeout: when a split self earns
  // xp during its ghost tick (split.js SWAP_FIELDS), `player` holds THAT
  // body's fields only for this instant — reading it 220ms later put one
  // division's xp floats over a different division's head
  const fpx = player.px, fpy = player.py;
  setTimeout(() => {
    if (!quiet) addFloat(`+${amt} ${skill} xp`, fpx, fpy - 30 - stackOffset);
    if (leveled) {
      log(`Congratulations! Your ${skill} level is now ${after}.`, "gold");
      addFloat(`${skill} level up! (${after})`, fpx, fpy - 50 - stackOffset, "#ffd75e", 16);
      if (typeof sfx === "function") sfx("levelup", 0.55);
    }
  }, delay);
}

// ---------- inventory ----------
// Callers (12):
//  main/ui.js:155,255,274,275 skills/combat.js:22 skills/crafting.js:13,39,58,65,72,73
//  skills/farming.js:17
function countItem(id) {
  let n = 0;
  for (const s of player.inv) if (s && s.id === id) n += s.qty;
  return n;
}
// Callers (21):
//  gameplay/items.js:6,54,61 main/ui.js:158,179,202 skills/butchering.js:16,17
//  skills/crafting.js:46,50,69 skills/farming.js:30 skills/gathering.js:44,47 skills/thieving.js:22
//  storage.js:156,157,158,159,160,161
// Optional `meta` = { q, prov } lets the production engine attach a quality
// (0..100) and a provenance/batch reference to the item. When a produced stack
// merges into an existing one, quality is combined as a quantity-weighted
// average (see production.js). Callers that pass no meta behave exactly as before.
function addItem(id, qty = 1, meta) {
  const def = ITEMS[id];
  if (def.stack) {
    const s = player.inv.find(s => s && s.id === id);
    if (s) {
      if (meta && meta.q != null) {
        const oq = s.q != null ? s.q : meta.q;
        s.q = Math.round((oq * s.qty + meta.q * qty) / (s.qty + qty));
        if (meta.prov != null) s.prov = meta.prov;
      }
      s.qty += qty; uiDirty = true; return true;
    }
    const i = player.inv.findIndex(s => !s);
    if (i < 0) return false;
    player.inv[i] = { id, qty };
    if (meta) { if (meta.q != null) player.inv[i].q = meta.q; if (meta.prov != null) player.inv[i].prov = meta.prov; }
    uiDirty = true;
    return true;
  }
  for (let n = 0; n < qty; n++) {
    const i = player.inv.findIndex(s => !s);
    if (i < 0) return n > 0;
    player.inv[i] = { id, qty: 1 };
    if (meta) { if (meta.q != null) player.inv[i].q = meta.q; if (meta.prov != null) player.inv[i].prov = meta.prov; }
  }
  uiDirty = true;
  return true;
}
// Callers (8):
//  main/ui.js:157,178 skills/combat.js:38,45 skills/crafting.js:44,68 skills/farming.js:18
//  storage.js:100
function removeItem(id, qty = 1) {
  for (let i = 0; i < player.inv.length && qty > 0; i++) {
    const s = player.inv[i];
    if (!s || s.id !== id) continue;
    const take = Math.min(s.qty, qty);
    s.qty -= take; qty -= take;
    if (s.qty <= 0) player.inv[i] = null;
  }
  uiDirty = true;
}
// Callers (1):
//  skills/gathering.js:7
function hasTool(tool) {
  if (!tool) return true;
  return player.inv.some(s => s && ITEMS[s.id].tool === tool);
}
// highest toolPower among held tools of this type (tiered pickaxe/axe/shovel/
// hammer/hoe/sickle, geartiers.js) — speeds up gathering, see tickGather
// Callers (1):
//  skills/gathering.js
function bestToolPower(tool) {
  let best = 0;
  for (const s of player.inv) {
    if (s && ITEMS[s.id].tool === tool && ITEMS[s.id].toolPower > best) best = ITEMS[s.id].toolPower;
  }
  return best;
}
// best boat in the pack that our Sailing level can handle
// Air a hull needs to pass UNDER a bridge deck (deck level − water level),
// on the same tier curve as the hull's visual scale (render3d OBJ_SCALE
// vessel block): low paddle craft slip beneath anything, tall ships need a
// proper overpass (man-o'-war ~2.4 — the long-span SEA_DECK_MAX decks give
// 3.5). Tier ≤ 8 (raft…dinghy) stays under the 1.01 deck/under threshold, so
// small-boat behaviour is exactly what it was.
function boatClearance(id) {
  const t = (ITEMS[id] && ITEMS[id].boat) || 1;
  return 0.55 + t * 0.058;
}
// Callers (3):
//  gameplay/movement.js:66 main.js:19 main/state.js:118
// `fit` (optional): only vessels needing ≤ that much air qualify — movement
// passes the air gap when the next step is under a bridge deck, so the
// biggest boat that FITS ducks through (the tall ship waits in open water).
function bestBoat(fit) {
  let best = null;
  for (const s of player.inv) {
    if (!s) continue;
    const d = ITEMS[s.id];
    if (!d.boat || skillLvl("Sailing") < d.sailReq) continue;
    if (fit != null && boatClearance(s.id) > fit) continue;
    if (!best || d.boat > ITEMS[best].boat) best = s.id;
  }
  return best;
}
// a tile is passable on foot, or by boat if it's water and we have one
// Callers (8):
//  gameplay/input.js:103 gameplay/movement.js:44,56,57 gameplay/pathing.js:23,24 main.js:15
//  main/state.js:114
function passable(x, y) {
  // upper storeys: only the interior of a building tall enough to have a
  // floor at this level is walkable (perimeter tiles are its walls). This is
  // checked BEFORE the cheat bypass — even with cheats on there is no floor
  // to stand on beyond the walls, so you can't step off onto the terrain.
  const lv = player.level | 0;
  if (lv > 0) {
    const b = world.insideBuilding(x, y);
    if (!b) return false;
    const m = world.buildingMeta(b);
    // mansion archways connect the hall's first floor to its wing rooms
    if (m.wingDoors && lv === 1 && m.wingDoors.some(d => d.x === x && d.y === y)) return true;
    if (x > b.x0 && x < b.x0 + b.w - 1 && y > b.y0 && y < b.y0 + b.h - 1) return lv < m.storeys;
    if (m.wings)
      for (const w of m.wings)
        if (x > w.x0 && x < w.x0 + w.w - 1 && y > w.y0 && y < w.y0 + w.h - 1) return lv < w.storeys;
    return false;
  }
  if (DEV_MODE) return true;
  // parked hulls span real tiles (gameplay/placing.js footprints): the water
  // they cover can't be walked or swum through — click the hull to board it.
  // The vessel being RIDDEN is exempt (it moves with the player).
  if (typeof vesselBlockAt === "function" && vesselBlockAt(x, y)) return false;
  // "under" = moving at water level (sailing, or on foot along the river bank
  // beneath a bridge/building deck — player.deck === false); everything else
  // moves at deck level. player.deck is maintained by moveTo(), but someone
  // standing LOW beside the structure counts as under too — otherwise the
  // perimeter wall rule would block them from ever entering the under-passage
  // (moveTo only flips player.deck once the step is allowed).
  let under = !!player.sailing || player.deck === false;
  if (!under && typeof REN !== "undefined" && REN && REN.deckLevel && REN.groundLevel) {
    const dY = REN.deckLevel(x, y);
    if (dY != null) {
      // the player's own standing height: the deck they're on if they're on a
      // dual tile at deck level, else the ground beneath them
      const md = REN.deckLevel(player.x, player.y);
      const myY = md != null ? md : REN.groundLevel(player.x, player.y);
      if (myY < dY - 1.01) under = true;
    }
  }
  if (!world.isBlocked(x, y)) {
    // the fixed wall "plugs" beside city gates are wall, just not chunk-blocked.
    // Door/gate tiles stay pathable — stepping onto one swings it open (moveTo).
    // A plug standing on a bridge deck (a wall gate over the crossing) only
    // blocks at deck level: below it the bank strip stays open.
    const s = world.structAt && world.structAt(x, y);
    if (s && s.plug && !(under && dualTileAt(x, y))) return false;
    // hollow bank strip inside a river-spanning building: open at water level,
    // but at deck level the perimeter wall line blocks except at the doors
    if (!under) {
      const b = world.insideBuilding(x, y);
      if (b && !String(world.getGround(x, y)).startsWith("floor") &&
          (x === b.x0 || x === b.x0 + b.w - 1 || y === b.y0 || y === b.y0 + b.h - 1)) {
        const m = world.buildingMeta(b);
        return (m.door.x === x && m.door.y === y) ||
               (!!m.door2 && m.door2.x === x && m.door2.y === y);
      }
    }
    return true;
  }
  if (!world.isWater(x, y)) return false;
  const dc = world.getDecor(x, y) || "";
  // fence posts standing IN water (the tutorial isle's weirs, waist columns
  // and the offshore ring) are real barriers — no wading or sailing through
  // a fence line; its gate_wood tiles stay open (barred() latches those).
  if (dc === "fence_wood") return false;
  // the player can always cross water — wading on foot or by boat (monsters
  // and NPCs cannot; their movement checks water itself).
  if (!under) {
    // a city-wall gate plug standing on the bridge deck blocks deck-level
    // movement (the swinging leaves beside it stay pathable and open on step)
    const sp = world.structAt && world.structAt(x, y);
    if (sp && sp.plug) return false;
    // moving at deck level: the slab rides ON the support piers, so pier
    // tiles are walkable from above; a river-building's perimeter wall line
    // blocks except at its doors (even where a pier stands under the wall)
    if (!dc.startsWith("stone_bridge") || dc === "stone_bridge#p") {
      const b = world.insideBuilding(x, y);
      if (b && (x === b.x0 || x === b.x0 + b.w - 1 || y === b.y0 || y === b.y0 + b.h - 1)) {
        const m = world.buildingMeta(b);
        return (m.door.x === x && m.door.y === y) ||
               (!!m.door2 && m.door2.x === x && m.door2.y === y);
      }
    }
    return true;
  }
  // moving at water level: the solid piers block, everything else is open
  return dc !== "stone_bridge#p";
}
// a tile with two traversable levels: a bridge deck / building floor slab
// above and the river passage below (water, or the hollow bank strip inside a
// river-spanning building)
// Callers (2):
//  gameplay/movement.js  main/state.js (passable)
function dualTileAt(x, y) {
  if ((world.getDecor(x, y) || "").startsWith("stone_bridge")) return true;
  const b = world.insideBuilding(x, y);
  return !!b && (world.isWater(x, y) || !String(world.getGround(x, y)).startsWith("floor"));
}
// Terrace rule for one step of PLAYER movement (from → to): dropping down any
// height is fine, but climbing is capped at half a step — including hauling
// out of water onto the bank (taller banks need a lower exit point). Used by
// the pathfinder's neighbour expansion and keyboard steps; monsters have
// their own stricter rule.
// Callers (3):
//  gameplay/movement.js (tryStep)  gameplay/pathing.js (findPath x2)
function stepClimbOK(fx, fy, tx, ty) {
  if (DEV_MODE) return true;
  if (typeof REN === "undefined" || !REN || !REN.groundLevel || !REN.deckLevel) return true;
  const under = !!player.sailing || player.deck === false;
  const fd = !under ? REN.deckLevel(fx, fy) : null;
  const hFrom = fd != null ? fd : REN.groundLevel(fx, fy);
  // the target's deck only counts if we'd actually step ONTO it — arriving
  // well below deck level means passing UNDERNEATH along the water/bank
  // (same rule passable() uses), so measure against the ground there
  const td = !under ? REN.deckLevel(tx, ty) : null;
  // stepping off dry land INTO water is always allowed — the water yields.
  // During a flood the risen surface can sit several steps above a drowned
  // bank; wading in is a plunge, not a climb. (Deck steps keep the normal
  // rule; water→water still can't climb a cascade.)
  if (world.isWater(tx, ty) && !world.isWater(fx, fy) &&
      (td == null || hFrom < td - 1.01)) return true;
  const hTo = td != null && hFrom >= td - 1.01 ? td : REN.groundLevel(tx, ty);
  return hTo - hFrom <= 0.51;
}
// How deep the wading player's body sits below the water surface. Open sea:
// a quarter step for every 1% the seabed's altitude lies below the coast
// line — it swallows you the further out you go. Rivers, lakes and ponds
// (carved through land, altitude >= 0) are NOT a constant wading depth any
// more: the bank edges and narrow fords stay shallow, but the middle of
// wider stretches deepens into deterministic POOLS — deep enough to put a
// short character's mouth and nose under (drowning), while tall folk can
// still wade the same water. 0 when not in the water (sailing, on a deck,
// on land). Capped just past the drowning line so the sprite floats under
// the surface instead of sinking to the sea floor.
// Callers: movement.js (tickAir), render3d.js (player Y + bubbles)
const AIR_MAX = 15;        // bubbles shown / seconds-ish of air (was 10 — 1.5x)
const MOUTH_Y = 1.1;       // waterline past this = mouth and nose under
// An equipped snorkel (Glassblowing, face slot) breathes through a tube that
// tops out this far above the mouth — the drowning waterline moves up by it.
// MOUTH_Y·h + SNORKEL_REACH MUST stay below playerSinkY's cap (1.85·h + 0.45,
// the full-body-submersion depth), or the capped sink could never pass the
// raised waterline and deep water couldn't drown a snorkeler at all.
const SNORKEL_REACH = 0.4;
// smooth deterministic 0..1 pool noise (bilinear value noise on a hash grid)
function _poolNoise(x, y) {
  const h = (ix, iy) => { const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453; return s - Math.floor(s); };
  const gx = Math.floor(x), gy = Math.floor(y), fx = x - gx, fy = y - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return (h(gx, gy) * (1 - sx) + h(gx + 1, gy) * sx) * (1 - sy)
       + (h(gx, gy + 1) * (1 - sx) + h(gx + 1, gy + 1) * sx) * sy;
}
// Full water-column depth at a tile — how far below the surface a body can
// sink there. 0 on dry land. Open sea: a quarter step for every 1% the
// seabed's altitude lies below the coast line. Inland water (carved through
// land, altitude >= 0): NOT a constant depth — the bank edges and narrow
// fords stay shallow, but the middle of wider stretches deepens into
// deterministic POOLS.
// Callers: playerSinkY (below), monsters.js (swimming depth clamp)
function waterDepthAt(x, y) {
  if (!world.isWater(x, y)) return 0;
  const alt = (world.heightAt(x, y) - world.LAND_ELEVATION) /
    (1 - world.LAND_ELEVATION) * 100;
  if (alt < 0) return -alt * 0.125;                       // open sea
  // inland water: depth = pool noise, halved along the bank edge. Tiles
  // TOUCHING dry land stay safe wading for even the shortest characters
  // (you can always enter and leave at the edge); one tile clear of every
  // bank — the middle of a 4-wide river, a lake — the pools run 0.35..1.3
  // deep: routine for the tall, mouth-and-nose-under for the short, and the
  // very deepest holes threaten anyone but the tallest.
  let edge = false;
  scan: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
    if ((dx || dy) && !world.isWater(x + dx, y + dy)) { edge = true; break scan; }
  // heavy rain swells the river (weather.js floodNow, 0..1): everything runs
  // deeper — even the bank shallows stop being safe for the short at the
  // height of a flood — then settles back as the flood integral drains
  // flood depth only in RIVERS (matches render3d waterLevelAt's gate —
  // standing pools/springs hold their level when rain swells the rivers)
  const fl = (typeof floodNow === "function") && world.riverFlowAt &&
    world.riverFlowAt(x, y) ? floodNow() : 0;
  return (0.35 + _poolNoise(x / 5, y / 5) * 0.95) * (edge ? 0.45 : 1)
    + fl * (edge ? 1.3 : 2.0); // matches render3d FLOOD_AMP — a max flood adds 4 half-steps of water (drowning-deep everywhere; playerSinkY's cap keeps the sprite at the surface)
}
function playerSinkY() {
  if (player.sailing || !world.isWater(player.x, player.y)) return 0;
  // standing on a ridden vessel (gameplay/placing.js): dry feet, full air
  if (typeof ridingEnt === "function" && ridingEnt()) return 0;
  if (player.deck !== false && dualTileAt(player.x, player.y)) return 0;
  // cap the sink just past this character's (height-scaled) FULL body height —
  // deep enough that the whole sprite, head included, disappears under the
  // surface (1.85 = render3d CHAR_SCALE, the visible body height in world
  // units) — while still keeping the body near the surface instead of
  // dropping it all the way to the sea floor
  const hm = typeof charHeightMul === "function" ? charHeightMul() : 1;
  const cap = 1.85 * hm + 0.45;
  return Math.min(waterDepthAt(player.x, player.y), cap);
}
// Callers (1):
//  main/ui.js:156
function invFull(id) {
  if (ITEMS[id] && ITEMS[id].stack && player.inv.some(s => s && s.id === id)) return false;
  return !player.inv.some(s => !s);
}
