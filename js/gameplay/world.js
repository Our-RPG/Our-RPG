// ===== Taiao — world ticking, exploration, maps, minimap, camera, and render =====
"use strict";

// ---------- doors, gates & ladders (multi-storey buildings, retired prototype port) ----------
// Callers (1): gameplay/pathing.js (executeGoal "door")
function useDoor(d) {
  const open = world.isDoorOpen(d.x, d.y);
  // city gates stay shut to the truly foul (gameplay/stink.js) — only blocks
  // OPENING a closed gate; you can always close one behind you.
  if (!open && d.kind === "gate" && typeof stinkBlocksGates === "function" && stinkBlocksGates()) {
    log("The gate guard blocks your way, gagging: \"No chance — you reek to high heaven. Wash first.\"", "warn");
    return;
  }
  // quest "sealed room" doors: need the ornate key (gameplay/quests.js)
  if (!open && typeof Quests !== "undefined") {
    const qr = Quests.tryDoor(d);
    if (qr === "blocked") { log("The door is sealed — you'll need the ornate key from the quest-giver.", "warn"); return; }
    // qr === "open": the key turned; fall through and swing it open
  }
  // fitted locks (gameplay/locks.js): a locked door must be opened first —
  // with the matching Locksmithing key, or (warded locks) dispelled by magic
  if (!open) {
    const L = typeof doorLocked === "function" && doorLocked(d);
    if (L && !tryUnlockDoor(d, L)) return;
  }
  world.setDoorOpen(d.x, d.y, !open);
  if (d.kind === "gate") {
    // double gates: both leaves swing together (classic doubledoors.rs2)
    // north/south wall gates (LocAngle NORTH=1/SOUTH=3) have their two leaves
    // offset in x; east/west wall gates (WEST=0/EAST=2) offset in y
    const sib = (d.angle === 1 || d.angle === 3)
      ? [world.doorAt(d.x - 1, d.y), world.doorAt(d.x + 1, d.y)]
      : [world.doorAt(d.x, d.y - 1), world.doorAt(d.x, d.y + 1)];
    for (const s of sib)
      if (s && s.kind === "gate" && s.angle === d.angle) world.setDoorOpen(s.x, s.y, !open);
  }
  log(open ? `You close the ${d.kind === "gate" ? "gate" : "door"}.`
           : `You open the ${d.kind === "gate" ? "gate" : "door"}.`, "sys");
  sfx(d.kind === "gate" ? "gate" : open ? "doorclose" : "dooropen", 0.7);
  if (typeof LC3D !== "undefined" && REN === LC3D && LC3D.ready) LC3D.syncDoors();
}

// Callers (1): gameplay/pathing.js (executeGoal "ladder")
function useLadder(b, m, dir) {
  const lv = player.level | 0;
  const nl = Math.max(0, Math.min(m.storeys - 1, lv + (dir > 0 ? 1 : -1)));
  if (nl === lv) return;
  player.level = nl;
  log(dir > 0 ? "You climb up the ladder." : "You climb down the ladder.", "sys");
  sfx("climb", 0.6);
}

// ---------- update: world ----------
let depletedNodes = []; // nodes waiting to respawn (infinite world: no global node list)
// Callers (2):
//  main.js:7,42
function updateWorldStuff() {
  depletedNodes = depletedNodes.filter(n => {
    if (now >= n.respawnAt) { n.alive = true; if (n.leftMax != null) n.left = n.leftMax; return false; }
    return true;
  });
  if (typeof growBabies === "function") growBabies(); // husbandry: babies mature into adults
  if (typeof Dream !== "undefined") Dream.update(); // Dream Forest pocket interior (gameplay/dream.js)
  // activate monster spawns of chunks near the player — radius grows with
  // zoom-out (matching render3d viewRadius) so far chunks that come into view
  // when zoomed out get their monsters activated instead of standing empty.
  // collectSpawns activates each chunk once, so this only front-loads work.
  const _spawnR = Math.max(40, Math.round(19 * camZoom + 20));
  for (const [kind, x, y] of world.collectSpawns(player.x, player.y, _spawnR)) {
    if (!MONSTERS[kind]) continue;
    // only genuinely aquatic creatures live in water; a land monster whose
    // random spawn point lands on a river is nudged to the nearest dry tile,
    // and an aquatic one whose point lands on a bank is nudged INTO the water
    // — aquatic creatures are water-locked (mobPassable) and never walk ashore
    const aquatic = typeof MONSTER_THEME !== "undefined" && MONSTER_THEME[kind] === "q";
    let sx2 = x, sy2 = y;
    if (aquatic !== world.isWater(sx2, sy2)) {
      let found = false;
      fix: for (let r = 1; r <= 4; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++)
            if (world.isWater(x + dx, y + dy) === aquatic &&
                (aquatic || !world.isBlocked(x + dx, y + dy))) {
              sx2 = x + dx; sy2 = y + dy; found = true; break fix;
            }
      if (!found) continue;
    }
    const isWaterSpawn = world.isWater(sx2, sy2);
    if (world.isBlocked(sx2, sy2) && !isWaterSpawn) continue;
    if (world.insideBuilding(sx2, sy2)) continue;
    const _m = {
      uid: ++_monUid,
      kind, x: sx2, y: sy2, sx: sx2, sy: sy2, px: PX(sx2), py: PX(sy2),
      hp: monMaxHp(kind), alive: true, moving: null, target: null,
      nextAtkAt: 0, facing: 1, dir8: "south", spr: MONSTERS[kind].spr, lungeT: -9999,
      spawnBiome: world.biomeAt(sx2, sy2), canSwim: aquatic,
    };
    // swimmers spawn at a random depth in the local water column and cruise
    // vertically from there (monsters.js swim tick)
    if (aquatic && typeof waterDepthAt === "function") {
      const wd = waterDepthAt(sx2, sy2);
      _m.swimY = _m.swimTgt = Math.min(wd, SWIM_SURFACE_Y + Math.random() * SWIM_DIVE_MAX);
    }
    // restore a persisted husbandry cooldown so a tended animal respawns STILL
    // spent (you can't reset its recovery by reloading — the timer is wall-clock)
    if (typeof husbCooldowns !== "undefined") {
      const hc = husbCooldowns.get(sx2 + "," + sy2);
      if (hc) { _m.husbSpent = !!hc.spent; _m.husbReadyAt = hc.readyAt || 0; _m.husbFeed = hc.feed; _m.husbSpr = hc.spr || null; if (hc.left != null) { _m.husbLeft = hc.left; _m.husbMax = hc.leftMax; } }
    }
    monsters.push(_m);
  }
  // retire far-away monsters: every render/AI loop iterates the whole array,
  // so a long session must not keep every monster ever activated (they also
  // pin their spawn chunks in memory via per-frame liftAt probes). Retiring
  // clears the spawn CHUNK's activated flag, so collectSpawns re-populates it
  // from the same deterministic spawnDefs when the player next comes near;
  // husbandry spent-state survives via husbCooldowns (keyed by spawn tile).
  // The decision is per-chunk (spawn chunk centre beyond RETIRE_R) so a
  // chunk's monsters retire together and re-activation can't duplicate a
  // straggler. Husbandry babies (growTo) are player-made, not in spawnDefs —
  // they'd be lost, so they stay.
  if (now >= _monRetireAt) {
    _monRetireAt = now + 2000;
    const CS = world.CHUNK, RETIRE_R = 160, H = CS / 2;
    let w = 0;
    for (let i = 0; i < monsters.length; i++) {
      const m = monsters[i];
      const ccx = Math.floor(m.sx / CS), ccy = Math.floor(m.sy / CS);
      if (m.target !== player && !m.growTo &&
          Math.max(Math.abs(ccx * CS + H - player.x), Math.abs(ccy * CS + H - player.y)) > RETIRE_R) {
        const ch = world.chunks && world.chunks.get(ccx + "," + ccy);
        if (ch) ch.activated = false;
        continue;
      }
      monsters[w++] = m;
    }
    monsters.length = w;
  }
  dynNodes = dynNodes.filter(d => now < d.expireAt);
  groundItems = groundItems.filter(g => now < g.expireAt);
  // Don't regenerate a corpse: this runs AFTER stepPlayer (drowning/combat) in
  // the same frame, so without the dying guard a killing blow that zeroed HP is
  // immediately bumped back to 1 — making drowning read as "all but 1, then 1"
  // instead of one clean full-HP hit. A dying player heals nothing until respawn.
  if (player.hp < maxHp() && !player.dying && now >= player.regenAt) {
    const inCombat = monsters.some(m => m.alive && m.target === player) || (player.act && player.act.kind === "combat");
    if (!inCombat) { player.hp++; uiDirty = true; }
    // hearty crafted food (Cheesemaking/Baking) leaves you WELL FED — HP recovers
    // roughly 3x faster while it lasts (gameplay/items.js sets wellFedUntil).
    const wellFed = player.wellFedUntil && now < player.wellFedUntil;
    player.regenAt = now + (wellFed ? 2200 : 6000);
  }
  floats = floats.filter(f => now - f.t < 1500);
  splats = splats.filter(s => now - s.t < 900);
  tickArrows(); // resolve arrows whose arc just completed (combat.js)
  // `stick` keeps a landed arrow visible in the ground/wall a beat longer
  projectiles = projectiles.filter(p => now - p.t0 < p.dur + (p.stick || 0));
  markSeen();
  if (now >= saveAt) { saveGame(); saveAt = now + 15000; }
}

// ---------- world map ----------
// Callers (13):
//  gameplay/world.js:42,44,59,68,69,428,522,523,720 main.js:24 storage.js:15,75 world/chunks.js:44
const seenChunks = new Set(); // chunk keys the player has been near
// Callers (1):
//  gameplay/world.js:53
function seenBounds() {
  // Returns game-tile bounding box of all explored chunks, or null if nothing explored.
  if (!seenChunks.size) return null;
  const CS = world.CHUNK;
  // the sealed tutorial isle is a SEPARATE map (terrain.js inTutSeal): the
  // pannable view is bounded by ONE side's chunks at a time — on the isle,
  // only isle chunks; in the wide world, never an isle chunk — so panning
  // can no more reach the isle from Newhaven than a reset character's kept
  // mainland map can be reached from mid-tutorial. Same rule as inSeen.
  const isleSide = typeof inTutSeal === "function" && inTutSeal(player.x, player.y);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const k of seenChunks) {
    const [cx, cy] = k.split(',').map(Number);
    const gcx = cx * CS + CS / 2, gcy = cy * CS + CS / 2;
    // the Dream Forest interior never counts as explored world — the frozen
    // in-dream map (wmDraw) must not let the pannable view reach the far-off
    // region and give the trick away (gameplay/dream.js)
    if (typeof dreamZoneAtMap === "function" && dreamZoneAtMap(gcx * 0.5, gcy * 0.5)) continue;
    if (typeof inTutSeal === "function" && inTutSeal(gcx, gcy) !== isleSide) continue;
    if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
    if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
  }
  if (x0 === Infinity) return null;
  return { x0: x0 * CS, y0: y0 * CS, x1: (x1 + 1) * CS, y1: (y1 + 1) * CS };
}
// Callers (2):
//  gameplay/world.js:545,567
function clampWmView() {
  if (DEV_MODE) return; // full-world view — nothing to clamp to, like Map.html
  const b = seenBounds();
  if (!b) return;
  wm.cx = Math.max(b.x0, Math.min(b.x1, wm.cx));
  wm.cy = Math.max(b.y0, Math.min(b.y1, wm.cy));
}
// Callers (5):
//  gameplay/world.js:477,489,504,575,743
function inSeen(gx, gy) { // game-tile coords
  // the sealed tutorial isle is a SEPARATE map (terrain.js inTutSeal): a
  // point inside the seal only counts as seen while the player is also
  // inside it, and a wide-world point only while they're outside — so the
  // world map's chunk bakes, macro/mip fog and every icon/river/road pass
  // render exactly one of the two maps, never both. Other-side keys may
  // well sit in seenChunks (a character reset keeps the mainland's explored
  // map through the tutorial); they're just invisible until the player is
  // back on that side.
  if (typeof inTutSeal === "function" && inTutSeal(gx, gy) !== inTutSeal(player.x, player.y)) return false;
  return seenChunks.has(`${Math.floor(gx / world.CHUNK)},${Math.floor(gy / world.CHUNK)}`);
}
// Callers (2):
//  gameplay/world.js:34 world/chunks.js:67
function markSeen() {
  const CS = world.CHUNK;
  const pcx = Math.floor(player.x / CS), pcy = Math.floor(player.y / CS);
  // Cheat mode still reveals a wide ring on the map, but only the hot core is
  // persisted/prewarmed. The old R=10 version queued a map render (= full
  // chunk generation) for up to 441 chunks per step and let the in-memory
  // chunk cache grow without bound — a long session OOM-crashed the tab.
  const R = DEV_MODE ? 4 : 1;
  let crossed = false;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const key = (pcx + dx) + "," + (pcy + dy);
      if (!seenChunks.has(key)) {
        seenChunks.add(key);
        crossed = true;
        if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) {
          world.persistChunk(pcx + dx, pcy + dy);
          // render this chunk's world-map image in idle time so the map is
          // always ready the moment it's opened (these chunks are already
          // generated by the renderer's 5x5 neighborhood, so it's cheap)
          world.prewarmMapChunk(pcx + dx, pcy + dy);
        }
      }
    }
  if (crossed) {
    // hydrate nearby previously-persisted chunks in the background (so crop /
    // node state comes back before the player reaches them) and keep the
    // in-memory chunk cache bounded
    const near = new Set();
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        const k = (pcx + dx) + "," + (pcy + dy);
        if (seenChunks.has(k)) near.add(k);
      }
    world.preloadSeen(near);
    if (world.pruneChunks) world.pruneChunks(pcx, pcy);
  }
}

// Callers (28):
//  gameplay/input.js:156,157
//  gameplay/world.js:55,56,415,419,422,423,528,529,532,535,538,541,544,548,550,552,553,559,562,563,564,565,566,573,574,579
const wm = { open: false, zoom: 2, cx: 0, cy: 0, drag: null, timer: null, tz: false, dn: false, wx: false };
// Callers (7):
//  gameplay/world.js:413,414,530,536,542,548,561
const wmEl = document.getElementById("worldmap");
// Callers (9):
//  gameplay/world.js:78,413,414,551,552,553,572,573,574
const wmCanvas = document.getElementById("wmcanvas");
// Callers (39):
//  
//  gameplay/world.js:416,417,418,431,438,439,440,441,444,445,446,451,452,456,457,458,463,464,467,480,486,487,492,493,494,495,496,500,501,506,507,508,509,514,517,518,519,520,524
const wmCtx = wmCanvas.getContext("2d");
// low-res sampling buffer for the day/night overlay (rebuilt on resize)
let wmDnBuf = null;
// weather overlay: sampling buffer + a world-anchored lattice cache of the
// (time-invariant) climate fields — panning reuses sampled points, so each
// redraw only re-samples the cheap drifting anomaly
let wmWxBuf = null, wmWxClim = null;
// per-road cache of which polyline segments run over sea (static terrain)
const wmSeaSegCache = new Map();
// Callers (6):
//  gameplay/world.js:537,575,589,590,591,592
const wmTip = document.getElementById("wmtip");
const wmCoords = document.getElementById("wmcoords");

// ---- map icons identical to Map.html ----
// Callers (3):
//  gameplay/world.js:148,154,312
function star4(g, cx, cy, ro, ri) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    g[i === 0 ? "moveTo" : "lineTo"](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
}
// Callers (2):
//  gameplay/world.js:360,582
const ICON_TYPES = {
  bank: { name: "Bank", draw: g => {
    g.font = "bold 14px OpenDyslexic, Arial"; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 3; g.lineJoin = "round"; g.strokeStyle = "#000";
    g.strokeText("$", 9, 10);
    g.fillStyle = "#ffd23a"; g.fillText("$", 9, 10);
  }},
  store: { name: "General Store", draw: g => {
    g.fillStyle = "#9550c8"; g.strokeStyle = "#000"; g.lineWidth = 1.4;
    g.beginPath(); g.arc(9, 11, 5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(7, 6.5); g.lineTo(11, 6.5); g.lineTo(10.4, 4); g.lineTo(7.6, 4);
    g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = "#ffd23a"; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(6.8, 7); g.lineTo(11.2, 7); g.stroke();
  }},
  anvil: { name: "Anvil", draw: g => {
    g.fillStyle = "#c8c8c8"; g.strokeStyle = "#000"; g.lineWidth = 1.3;
    g.fillRect(3, 5.5, 12, 3.5); g.strokeRect(3, 5.5, 12, 3.5);
    g.fillRect(7, 9, 4, 4);      g.strokeRect(7, 9, 4, 4);
    g.fillRect(5, 13, 8, 2.5);   g.strokeRect(5, 13, 8, 2.5);
  }},
  furnace: { name: "Furnace", draw: g => {
    g.fillStyle = "#9a9a9a"; g.strokeStyle = "#000"; g.lineWidth = 1.3;
    g.fillRect(4, 3.5, 10, 12); g.strokeRect(4, 3.5, 10, 12);
    g.fillStyle = "#ff8c1a";
    g.beginPath(); g.moveTo(6, 15.5); g.lineTo(6, 12); g.arc(9, 12, 3, Math.PI, 0);
    g.lineTo(12, 15.5); g.closePath(); g.fill(); g.stroke();
  }},
  fish: { name: "Fishing Spot", draw: g => {
    g.fillStyle = "#5fb8e8"; g.strokeStyle = "#000"; g.lineWidth = 1.3;
    g.beginPath(); g.ellipse(8, 9, 5, 3.2, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(12, 9); g.lineTo(16, 5.8); g.lineTo(16, 12.2);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = "#000";
    g.beginPath(); g.arc(5.6, 8.4, 0.9, 0, Math.PI * 2); g.fill();
  }},
  mine: { name: "Mining Site", draw: g => {
    g.lineCap = "round";
    g.strokeStyle = "#000"; g.lineWidth = 4;
    g.beginPath(); g.moveTo(5, 14.5); g.lineTo(13, 6.5); g.stroke();
    g.strokeStyle = "#8a5a2a"; g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(5, 14.5); g.lineTo(13, 6.5); g.stroke();
    g.strokeStyle = "#000"; g.lineWidth = 4.4;
    g.beginPath(); g.arc(9, 13, 9, -2.35, -0.75); g.stroke();
    g.strokeStyle = "#c0c0c8"; g.lineWidth = 2.4;
    g.beginPath(); g.arc(9, 13, 9, -2.35, -0.75); g.stroke();
  }},
  tree: { name: "Rare Trees", draw: g => {
    g.fillStyle = "#8a5a2a"; g.strokeStyle = "#000"; g.lineWidth = 1.2;
    g.fillRect(8, 10.5, 2, 4.5); g.strokeRect(8, 10.5, 2, 4.5);
    g.fillStyle = "#2e8b2e";
    g.beginPath(); g.arc(9, 7.5, 5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = "#48ab42";
    g.beginPath(); g.arc(7.6, 6.2, 2.4, 0, Math.PI * 2); g.fill();
  }},
  altar: { name: "Altar", draw: g => {
    g.fillStyle = "#ffd23a"; g.strokeStyle = "#000"; g.lineWidth = 1.3;
    star4(g, 9, 9, 7.5, 2.8); g.fill(); g.stroke();
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(9, 9, 1.6, 0, Math.PI * 2); g.fill();
  }},
  quest: { name: "Quest Start", draw: g => {
    g.fillStyle = "#48c0e8"; g.strokeStyle = "#000"; g.lineWidth = 1.3;
    star4(g, 9, 9, 7.5, 2.8); g.fill(); g.stroke();
  }},
  windmill: { name: "Windmill", draw: g => {
    g.fillStyle = "#9a8a6a"; g.strokeStyle = "#000"; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(6.5, 15.5); g.lineTo(7.5, 7.5); g.lineTo(10.5, 7.5); g.lineTo(11.5, 15.5);
    g.closePath(); g.fill(); g.stroke();
    g.lineCap = "round";
    g.strokeStyle = "#000"; g.lineWidth = 3;
    g.beginPath();
    g.moveTo(4.5, 3); g.lineTo(13.5, 12); g.moveTo(13.5, 3); g.lineTo(4.5, 12);
    g.stroke();
    g.strokeStyle = "#e8ddc0"; g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(4.5, 3); g.lineTo(13.5, 12); g.moveTo(13.5, 3); g.lineTo(4.5, 12);
    g.stroke();
  }},
  water: { name: "Water Source", draw: g => {
    g.fillStyle = "#4a90d8"; g.strokeStyle = "#000"; g.lineWidth = 1.3;
    g.beginPath(); g.moveTo(9, 2.5);
    g.bezierCurveTo(13.5, 8, 13.5, 12, 9, 15);
    g.bezierCurveTo(4.5, 12, 4.5, 8, 9, 2.5);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.beginPath(); g.arc(7.4, 9.5, 1.2, 0, Math.PI * 2); g.fill();
  }},
  pier: { name: "Pier", draw: g => {
    g.fillStyle = "#3d6fa8"; g.strokeStyle = "#000"; g.lineWidth = 1.2;
    g.fillRect(2, 10, 14, 5); g.strokeRect(2, 10, 14, 5);
    g.fillStyle = "#8a6238";
    g.fillRect(3, 6.5, 12, 3.5); g.strokeRect(3, 6.5, 12, 3.5);
    g.fillRect(4.5, 10, 2, 4.5); g.strokeRect(4.5, 10, 2, 4.5);
    g.fillRect(11.5, 10, 2, 4.5); g.strokeRect(11.5, 10, 2, 4.5);
  }},
  workbench: { name: "Workbench", draw: g => {
    g.fillStyle = "#8a6a3a"; g.strokeStyle = "#000"; g.lineWidth = 1.2;
    g.fillRect(3, 7.5, 12, 3); g.strokeRect(3, 7.5, 12, 3);
    g.fillRect(4.5, 10.5, 2, 5); g.strokeRect(4.5, 10.5, 2, 5);
    g.fillRect(11.5, 10.5, 2, 5); g.strokeRect(11.5, 10.5, 2, 5);
    g.fillStyle = "#c8c8c8";
    g.fillRect(6.5, 2.8, 5, 2.4); g.strokeRect(6.5, 2.8, 5, 2.4);
    g.strokeStyle = "#8a5a2a"; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(9, 5.2); g.lineTo(9, 7.5); g.stroke();
  }},
  loom: { name: "Loom", draw: g => {
    g.strokeStyle = "#000"; g.lineWidth = 1.1; g.fillStyle = "#8a6a3a";
    g.fillRect(3, 3.5, 2, 12); g.strokeRect(3, 3.5, 2, 12);
    g.fillRect(13, 3.5, 2, 12); g.strokeRect(13, 3.5, 2, 12);
    g.fillRect(3, 3.5, 12, 2); g.strokeRect(3, 3.5, 12, 2);
    g.strokeStyle = "#e8ddc0"; g.lineWidth = 1;
    g.beginPath();
    for (const dx of [6.5, 9, 11.5]) { g.moveTo(dx, 5.5); g.lineTo(dx, 15); }
    g.stroke();
    g.strokeStyle = "#c04848";
    g.beginPath();
    g.moveTo(5, 9); g.lineTo(13, 9); g.moveTo(5, 11.5); g.lineTo(13, 11.5);
    g.stroke();
  }},
  garden: { name: "Garden", draw: g => {
    g.strokeStyle = "#2e8b2e"; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(9, 10.5); g.lineTo(9, 15.5); g.stroke();
    g.fillStyle = "#e85878"; g.strokeStyle = "#000"; g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 - Math.PI / 2;
      g.beginPath();
      g.arc(9 + Math.cos(a) * 3.4, 7 + Math.sin(a) * 3.4, 2.3, 0, Math.PI * 2);
      g.fill(); g.stroke();
    }
    g.fillStyle = "#ffd23a";
    g.beginPath(); g.arc(9, 7, 2.1, 0, Math.PI * 2); g.fill(); g.stroke();
  }},
  alchemy: { name: "Alchemy Table", draw: g => {
    g.fillStyle = "#c8e8f4"; g.strokeStyle = "#000"; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(7.5, 2.5); g.lineTo(7.5, 7); g.lineTo(4, 14.8); g.lineTo(14, 14.8);
    g.lineTo(10.5, 7); g.lineTo(10.5, 2.5); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = "#48c858";
    g.beginPath();
    g.moveTo(5.9, 10.8); g.lineTo(4.4, 14); g.lineTo(13.6, 14); g.lineTo(12.1, 10.8);
    g.closePath(); g.fill();
    g.fillStyle = "#a8e8b0";
    g.beginPath(); g.arc(8, 12.6, 0.8, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(10.6, 13.2, 0.6, 0, Math.PI * 2); g.fill();
  }},
  tanning: { name: "Tanning Rack", draw: g => {
    g.strokeStyle = "#000"; g.lineWidth = 1.1; g.fillStyle = "#6a4a26";
    g.fillRect(3, 2.8, 12, 2); g.strokeRect(3, 2.8, 12, 2);
    g.fillRect(3.5, 4.8, 1.7, 11); g.strokeRect(3.5, 4.8, 1.7, 11);
    g.fillRect(12.8, 4.8, 1.7, 11); g.strokeRect(12.8, 4.8, 1.7, 11);
    g.fillStyle = "#d8a860";
    g.beginPath();
    g.moveTo(6.2, 5.8); g.lineTo(11.8, 5.8); g.lineTo(12.4, 13); g.lineTo(5.6, 13);
    g.closePath(); g.fill(); g.stroke();
  }},
  cauldron: { name: "Cauldron", draw: g => {
    g.fillStyle = "#2e2e34"; g.strokeStyle = "#000"; g.lineWidth = 1.2;
    g.beginPath(); g.arc(9, 8.5, 6, 0, Math.PI); g.closePath(); g.fill(); g.stroke();
    g.fillRect(3.4, 6.4, 11.2, 2.2); g.strokeRect(3.4, 6.4, 11.2, 2.2);
    g.beginPath();
    g.moveTo(6, 14.2); g.lineTo(5, 16); g.moveTo(12, 14.2); g.lineTo(13, 16);
    g.stroke();
    g.fillStyle = "#48c858";
    g.beginPath(); g.ellipse(9, 6.4, 4.4, 1.1, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(7.4, 4.4, 0.9, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(10.4, 3.2, 0.6, 0, Math.PI * 2); g.fill();
  }},
  butcher: { name: "Butcher's Bench", draw: g => {
    g.fillStyle = "#a8734a"; g.strokeStyle = "#000"; g.lineWidth = 1.2;
    g.fillRect(3, 9.5, 12, 3); g.strokeRect(3, 9.5, 12, 3);
    g.fillRect(4.5, 12.5, 2, 3.5); g.strokeRect(4.5, 12.5, 2, 3.5);
    g.fillRect(11.5, 12.5, 2, 3.5); g.strokeRect(11.5, 12.5, 2, 3.5);
    g.fillStyle = "#d84848";
    g.beginPath(); g.ellipse(6.6, 8, 2.6, 1.8, -0.3, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = "#d0d0d8";
    g.beginPath();
    g.moveTo(10.5, 5); g.lineTo(15, 5); g.lineTo(15, 8.5); g.lineTo(11.5, 8.5);
    g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = "#6a4a1a"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(10.5, 4.6); g.lineTo(8.5, 2.6); g.stroke();
  }},
  range: { name: "Cooking Range", draw: g => {
    g.fillStyle = "#8a8a8a"; g.strokeStyle = "#000"; g.lineWidth = 1.2;
    g.fillRect(11, 2, 3, 4); g.strokeRect(11, 2, 3, 4);
    g.fillRect(3.5, 5.5, 11, 10); g.strokeRect(3.5, 5.5, 11, 10);
    g.fillStyle = "#151210";
    g.fillRect(5.5, 8.5, 7, 5.5);
    g.fillStyle = "#ff8c1a";
    g.beginPath();
    g.moveTo(6.5, 14); g.quadraticCurveTo(7, 10.5, 9, 9.5);
    g.quadraticCurveTo(11, 10.5, 11.5, 14); g.closePath(); g.fill();
    g.fillStyle = "#ffd23a";
    g.beginPath();
    g.moveTo(8, 14); g.quadraticCurveTo(9, 11.5, 10, 14); g.closePath(); g.fill();
  }},
  swordshop: { name: "Sword Shop", draw: g => {
    g.lineCap = "round";
    g.strokeStyle = "#000"; g.lineWidth = 3.6;
    g.beginPath(); g.moveTo(5.5, 12.5); g.lineTo(13.5, 4.5); g.stroke();
    g.strokeStyle = "#d0d0d8"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(5.5, 12.5); g.lineTo(13.5, 4.5); g.stroke();
    g.strokeStyle = "#000"; g.lineWidth = 3.4;
    g.beginPath(); g.moveTo(4.2, 9.8); g.lineTo(8.2, 13.8); g.stroke();
    g.strokeStyle = "#c8a028"; g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(4.2, 9.8); g.lineTo(8.2, 13.8); g.stroke();
    g.beginPath(); g.moveTo(4.8, 13.2); g.lineTo(3.2, 14.8); g.stroke();
  }},
  bowshop: { name: "Archery Shop", draw: g => {
    g.strokeStyle = "#000"; g.lineWidth = 3.2;
    g.beginPath(); g.arc(5.5, 9, 7, -1.05, 1.05); g.stroke();
    g.strokeStyle = "#8a5a2a"; g.lineWidth = 1.7;
    g.beginPath(); g.arc(5.5, 9, 7, -1.05, 1.05); g.stroke();
    g.strokeStyle = "#e8e0d0"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(9, 2.9); g.lineTo(9, 15.1); g.stroke();
    g.strokeStyle = "#000"; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(4.5, 9); g.lineTo(14, 9); g.stroke();
    g.fillStyle = "#d0d0d8";
    g.beginPath(); g.moveTo(16, 9); g.lineTo(13, 7.4); g.lineTo(13, 10.6);
    g.closePath(); g.fill();
  }},
  magicshop: { name: "Magic Shop", draw: g => {
    g.lineCap = "round";
    g.strokeStyle = "#000"; g.lineWidth = 3.4;
    g.beginPath(); g.moveTo(4.5, 15); g.lineTo(10.5, 9); g.stroke();
    g.strokeStyle = "#7a4a22"; g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(4.5, 15); g.lineTo(10.5, 9); g.stroke();
    g.fillStyle = "#b060e0"; g.strokeStyle = "#000"; g.lineWidth = 1.2;
    star4(g, 12.5, 6.5, 5, 1.9); g.fill(); g.stroke();
    g.fillStyle = "#e8c8ff";
    g.beginPath(); g.arc(12.5, 6.5, 1.1, 0, Math.PI * 2); g.fill();
  }},
  gemshop: { name: "Gem Shop", draw: g => {
    g.fillStyle = "#e03848"; g.strokeStyle = "#000"; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(5.5, 4.5); g.lineTo(12.5, 4.5); g.lineTo(15.5, 8); g.lineTo(9, 15.5);
    g.lineTo(2.5, 8); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.75)"; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(2.5, 8); g.lineTo(15.5, 8);
    g.moveTo(5.5, 4.5); g.lineTo(6.8, 8); g.lineTo(9, 15.5);
    g.moveTo(12.5, 4.5); g.lineTo(11.2, 8); g.lineTo(9, 15.5);
    g.stroke();
  }},
  herbshop: { name: "Herbalist", draw: g => {
    g.fillStyle = "#48a838"; g.strokeStyle = "#000"; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(9, 2.5); g.quadraticCurveTo(16, 7, 9, 15.5);
    g.quadraticCurveTo(2, 7, 9, 2.5);
    g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = "#1e5c1e"; g.lineWidth = 1.1;
    g.beginPath(); g.moveTo(9, 4.5); g.lineTo(9, 14); g.stroke();
    g.beginPath();
    g.moveTo(9, 7); g.lineTo(11.6, 6); g.moveTo(9, 9.5); g.lineTo(6.4, 8.5);
    g.stroke();
  }},
  clothesshop: { name: "Clothes Shop", draw: g => {
    g.fillStyle = "#4878d8"; g.strokeStyle = "#000"; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(6.2, 3.5); g.lineTo(11.8, 3.5); g.lineTo(15.5, 6.8); g.lineTo(13.6, 9.4);
    g.lineTo(12.4, 8.4); g.lineTo(12.4, 15); g.lineTo(5.6, 15); g.lineTo(5.6, 8.4);
    g.lineTo(4.4, 9.4); g.lineTo(2.5, 6.8);
    g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = "#2a4a9a"; g.lineWidth = 1;
    g.beginPath(); g.arc(9, 3.8, 1.7, 0, Math.PI); g.stroke();
  }},
  foodshop: { name: "Food Shop", draw: g => {
    g.fillStyle = "#d83838"; g.strokeStyle = "#000"; g.lineWidth = 1.2;
    g.beginPath(); g.arc(9, 10, 5.4, 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = "#6a4a1a"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(9, 4.9); g.quadraticCurveTo(9.4, 3.2, 11, 2.5); g.stroke();
    g.fillStyle = "#48a838"; g.strokeStyle = "#000"; g.lineWidth = 1;
    g.beginPath(); g.ellipse(11.2, 4, 2, 1.1, 0.5, 0, Math.PI * 2); g.fill(); g.stroke();
  }},
};
// Callers (2):
//  gameplay/world.js:366,480
const iconImgs = {};
for (const [type, def] of Object.entries(ICON_TYPES)) {
  const c = document.createElement("canvas");
  c.width = 36; c.height = 36;
  const g = c.getContext("2d");
  g.scale(2, 2);
  def.draw(g);
  iconImgs[type] = c;
}

// Callers (1):
//  gameplay/world.js:383
const STATION_ICON = {
  furnace: "furnace", anvil: "anvil", campfire: "range", bank: "bank",
  workbench: "workbench", loom: "loom", tanrack: "tanning", mill: "windmill",
  cauldron: "cauldron", alchtable: "alchemy", altar: "altar",
  // specialised production stations — each has its own icon on the "mi2" sheet
  // (js/sprites/map-icon-atlas-2-data.js); the few without dedicated art still
  // reuse the nearest existing icon (bakehouse->range, bindery->workbench).
  fletchers_bench: "fletchers_bench",
  sawmill: "sawmill", cooperage: "cooperage", bakehouse: "range",
  malthouse: "malthouse", brewery: "brewery",
  spinning_wheel: "spinning_wheel", dyeworks: "dyeworks", fulling_mill: "fulling_mill", tailors_bench: "tailors_bench",
  barn: "barn", creamery: "creamery", ropewalk: "ropewalk", sail_loft: "sail_loft", shipyard: "shipyard",
  charcoal_clamp: "charcoal_clamp", lime_kiln: "lime_kiln", masons_yard: "masons_yard",
  pottery_kiln: "pottery_kiln", glass_furnace: "glass_furnace",
  assay_furnace: "assay_furnace", drawbench: "drawbench", jewelers_bench: "jewelers_bench",
  leather_bench: "leather_bench", cobblers_bench: "cobblers_bench", saddlers_bench: "saddlers_bench",
  toolsmith: "toolsmith", locksmith_bench: "locksmith_bench",
  paper_mill: "paper_mill", bindery: "workbench",
  chandlery: "chandlery", soap_works: "soap_works",
  seasoning_yard: "seasoning_yard",
  curing_shed: "tanning", // Rubbermaking — reuses the tanning-rack marker
};
// named-shop map icons ("mi2" sheet); shops not listed fall back to "store".
// The other trades already have near-enough art on the first "mi" sheet
// (weaponsmith->swordshop, herbalist->herbshop, jeweller->gemshop,
//  clothier->clothesshop, provisioner->foodshop, general->store).
const SHOP_ICON = {
  woodcutter: "woodcutter", mining: "mining", fishmonger: "fishmonger",
  armoury: "armoury", seedsman: "seedsman", timberwright: "timberwright",
  weaponsmith: "swordshop", herbalist: "herbshop", jeweller: "gemshop",
  clothier: "clothesshop", provisioner: "foodshop",
};

// Callers (1):
//  gameplay/world.js:503
const WM_LABELED_POI = new Set(["guild","manor","fishvillage","lighthouse","inn","wizardtower","arena","battlefield","maze","portal","observatory","shipwreck"]);

// station key -> the skills trained there (from its recipe lists), for the
// world-map hover tooltip; computed once on first hover
let _wmStSkills = null;
function wmStationSkills(job) {
  if (!_wmStSkills) {
    _wmStSkills = {};
    for (const k in STATIONS) {
      const set = new Set();
      for (const l of (STATIONS[k].lists || []))
        for (const r of (RECIPES[l] || [])) set.add(r.skill);
      if (STATIONS[k].alchemy) set.add("Alchemy");
      _wmStSkills[k] = [...set];
    }
  }
  return _wmStSkills[job] || [];
}

// Progressive road/river/settlement query for the zoomed-out vector overlay.
// A cold session's first deep-zoom draw used to run the FULL viewport's
// road/river worldgen synchronously (multi-second freeze on a big save).
// Now the viewport is split into fixed cells; the expensive river/road
// polylines for missing cells are computed in the ROAD WORKER (its own full
// features instance, same seed = identical routes) and posted back as plain
// data, so every draw stays instant and the overlay streams in over the
// map's 900ms refresh ticks. Villages/POIs are cheap and queried on-thread.
// If workers are unavailable, cells fall back to synchronous queries under a
// per-draw time budget. Results merge with per-kind dedupe (roads/rivers
// span multiple cells).
const _wmRegCells = new Map();      // "cx,cy" → {rivs, roads, villages, pois}
const _wmRegPending = new Set();
const WM_REG_CELL = 768;            // map units per cell
let _wmRegWorker = null;            // null = not started, false = unavailable
function _wmRegCellFinish(id, rivs, roads) {
  const c = id.indexOf(",");
  const cx = +id.slice(0, c), cy = +id.slice(c + 1);
  const x0 = cx * WM_REG_CELL, y0 = cy * WM_REG_CELL;
  if (_wmRegCells.size > 300) _wmRegCells.clear();
  _wmRegCells.set(id, {
    rivs, roads,
    villages: world.villagesNearForMap(x0, y0, x0 + WM_REG_CELL, y0 + WM_REG_CELL, 42),
    pois: world.poisNearForMap(x0, y0, x0 + WM_REG_CELL, y0 + WM_REG_CELL, 26),
  });
  _wmRegPending.delete(id);
}
function _wmRegWorkerEnsure() {
  if (_wmRegWorker !== null) return _wmRegWorker;
  if (typeof Worker === "undefined" || !world._workerInit) return (_wmRegWorker = false);
  try {
    _wmRegWorker = new Worker("js/world/roadworker.js");
    _wmRegWorker.postMessage({ type: "init", ...world._workerInit });
    _wmRegWorker.onmessage = e => { const d = e.data; if (d && d.region) _wmRegCellFinish(d.region, d.rivs, d.roads); };
    _wmRegWorker.onerror = () => { try { _wmRegWorker.terminate(); } catch (e2) { /* dead */ } _wmRegWorker = false; };
  } catch (e) { _wmRegWorker = false; }
  return _wmRegWorker;
}
function wmRegionProgressive(x0, y0, x1, y1) {
  const t0 = performance.now();
  const rivs = [], roads = [], villages = [], pois = [];
  const sRv = new Set(), sRd = new Set(), sV = new Set(), sP = new Set();
  const missing = [];
  for (let cy = Math.floor(y0 / WM_REG_CELL); cy <= Math.floor(y1 / WM_REG_CELL); cy++)
    for (let cx = Math.floor(x0 / WM_REG_CELL); cx <= Math.floor(x1 / WM_REG_CELL); cx++) {
      const k = cx + "," + cy;
      let cell = _wmRegCells.get(k);
      if (!cell) {
        const w = _wmRegWorkerEnsure();
        if (w) {
          if (!_wmRegPending.has(k)) {
            _wmRegPending.add(k);
            missing.push({ id: k, x0: cx * WM_REG_CELL, y0: cy * WM_REG_CELL,
              x1: (cx + 1) * WM_REG_CELL, y1: (cy + 1) * WM_REG_CELL });
          }
          continue;                                       // arrives via worker
        }
        if (performance.now() - t0 > 120) continue;       // no worker: budgeted sync
        cell = world.mapRegionQuery(cx * WM_REG_CELL, cy * WM_REG_CELL,
          (cx + 1) * WM_REG_CELL, (cy + 1) * WM_REG_CELL);
        if (_wmRegCells.size > 300) _wmRegCells.clear();
        _wmRegCells.set(k, cell);
      }
      for (const r of cell.rivs) if (!sRv.has(r)) { sRv.add(r); rivs.push(r); }
      for (const r of cell.roads) if (!sRd.has(r.key)) { sRd.add(r.key); roads.push(r); }
      for (const v of cell.villages) { const vk = v.x + "," + v.y; if (!sV.has(vk)) { sV.add(vk); villages.push(v); } }
      for (const p of cell.pois) { const pk = p.x + "," + p.y; if (!sP.has(pk)) { sP.add(pk); pois.push(p); } }
    }
  if (missing.length && _wmRegWorker) _wmRegWorker.postMessage({ type: "region", cells: missing });
  return { rivs, roads, villages, pois };
}

// Coalesce interactive redraws: wheel/drag events fire far faster than frames
// render, and each wmDraw is a full synchronous repaint (with the weather /
// day-night overlays on, an expensive one) — so queue at most one repaint per
// animation frame and let intervening events just update wm.cx/cy/zoom.
let wmRafPending = false;
function wmScheduleDraw() {
  if (wmRafPending) return;
  wmRafPending = true;
  requestAnimationFrame(() => { wmRafPending = false; if (wm.open) wmDraw(); });
}

// Cached day/night + weather overlay composite (see wmDraw): the rendered
// fields plus the view (cx/cy/z/size/toggles) they were rendered at, and when.
let wmOvCache = null;
const WM_OV_TTL = 4000;           // idle refresh cadence — the fields drift slowly
let wmWheelT = 0;                 // last wheel-zoom timestamp (performance.now)
let wmOvSettleTimer = 0;
// after pan/zoom stops, repaint the overlay composite crisp at the new view
function wmOverlaySettleSoon() {
  clearTimeout(wmOvSettleTimer);
  wmOvSettleTimer = setTimeout(() => { if (wm.open) wmScheduleDraw(); }, 170);
}

// Callers (4):
//  gameplay/world.js:531,532,546,568
function wmDraw() {
  // Backing store sized for the real device pixel ratio (HiDPI/Retina
  // displays otherwise upscale a CSS-pixel-sized canvas, softening every
  // label/name on the map) — every draw call below still uses plain
  // CSS-pixel coordinates via W/H, mapped to physical pixels by the
  // setTransform below, same convention as render3d.js's #overlay canvas.
  const W = wmEl.clientWidth, H = wmEl.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  wmCanvas.width = Math.round(W * dpr);
  wmCanvas.height = Math.round(H * dpr);
  wmCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const z = wm.zoom, CS = world.CHUNK;
  wmCtx.fillStyle = "#000";
  wmCtx.fillRect(0, 0, W, H);
  wmCtx.imageSmoothingEnabled = z < 2;
  const toScreen = (x, y) => [(x - wm.cx) * z + W / 2, (y - wm.cy) * z + H / 2];

  // Render all chunks in viewport using Map.html-quality renderer
  const gtx0 = wm.cx - W / 2 / z, gtx1 = wm.cx + W / 2 / z;
  const gty0 = wm.cy - H / 2 / z, gty1 = wm.cy + H / 2 / z;
  // DEV_MODE shows any chunk in the viewport, like Map.html (no "explored"
  // concept at all); normal mode keeps the fog-of-war restriction.
  const revealAll = DEV_MODE;

  if (z < world.OVERVIEW_Z) {
    // Zoomed out, two layers:
    //  A) a zoom-matched MACRO UNDERLAY — smooth generalized terrain at ~1
    //     macro px per screen px, streamed through the async pump (IDB-
    //     persisted; a missing tile borrows a cached coarser step scaled up
    //     smoothly, and only the very first frames fall back to one flat
    //     biome colour per cell). Never blocky, never a synchronous bake.
    //  B) the REAL tile art on top — finished mip-pyramid tiles (pure
    //     downscaled chunk bakes with transparent holes; js/world/map.js
    //     mipTile), or a finished coarser mip's sub-rect while a level is
    //     still assembling. Explored ground therefore looks exactly like the
    //     tiles you saw up close, just smaller.
    const mtx0 = gtx0 / 2, mtx1 = gtx1 / 2, mty0 = gty0 / 2, mty1 = gty1 / 2; // map coords (overlay below)
    wmCtx.imageSmoothingEnabled = true;
    world.mipBudget(2, 2);
    const seenAny = (x0, y0, s) => revealAll ||
      inSeen(x0, y0) || inSeen(x0 + s, y0) || inSeen(x0, y0 + s) ||
      inSeen(x0 + s, y0 + s) || inSeen(x0 + s / 2, y0 + s / 2);
    // ---- pass A: macro underlay ----
    {
      const STEPS = [0.25, 0.5, 1, 2, 4, 8, 16];
      const step = world.overviewStep(z);
      const MT = world.MACRO_PX * step;              // map units per macro tile
      const m0x = Math.floor(mtx0 / MT), m1x = Math.floor(mtx1 / MT);
      const m0y = Math.floor(mty0 / MT), m1y = Math.floor(mty1 / MT);
      for (let my = m0y; my <= m1y; my++)
        for (let mx = m0x; mx <= m1x; mx++) {
          if (!seenAny(mx * MT * 2, my * MT * 2, MT * 2)) continue;
          const [sx, sy] = toScreen(mx * MT * 2, my * MT * 2);
          const px = MT * 2 * z;
          let img = world.macroCache.get(step + ":" + mx + "," + my);
          if (!img) world.requestMacro(step, mx, my);       // hydrate / paced render
          if (img) { wmCtx.drawImage(img, sx, sy, px, px); continue; }
          let drawn = false;
          for (const s2 of STEPS) {                         // coarser cached step: blur beats blocks
            if (s2 <= step) continue;
            const f = s2 / step;
            const ax = Math.floor(mx / f), ay = Math.floor(my / f);
            const big = world.macroCache.get(s2 + ":" + ax + "," + ay);
            if (!big) continue;
            const sub = world.MACRO_PX / f;
            wmCtx.drawImage(big, (mx - ax * f) * sub, (my - ay * f) * sub, sub, sub, sx, sy, px, px);
            drawn = true; break;
          }
          if (!drawn) { wmCtx.fillStyle = world.macroFlat(step, mx, my); wmCtx.fillRect(sx, sy, px, px); }
        }
    }
    // ---- pass B: real tile art on top ----
    const L = Math.max(0, Math.min(world.MIP_MAX, Math.floor(Math.log2(256 / (CS * z)))));
    const span = CS * (1 << L);                      // game tiles per drawn tile
    const t0x = Math.floor(gtx0 / span), t1x = Math.floor(gtx1 / span);
    const t0y = Math.floor(gty0 / span), t1y = Math.floor(gty1 / span);
    const drawFromAncestor = (Lw, tx2, ty2, sx, sy, px) => {
      for (let A = Lw + 1; A <= world.MIP_MAX; A++) {
        const ax = tx2 >> (A - Lw), ay = ty2 >> (A - Lw);
        const rec = world.mipPeek(A, ax, ay);
        if (rec && rec.done) {
          const f = 1 << (A - Lw), sub = 256 / f;
          wmCtx.drawImage(rec.cv, (tx2 - ax * f) * sub, (ty2 - ay * f) * sub, sub, sub, sx, sy, px, px);
          return true;
        }
      }
      return false;
    };
    for (let ty2 = t0y; ty2 <= t1y; ty2++)
      for (let tx2 = t0x; tx2 <= t1x; tx2++) {
        if (!seenAny(tx2 * span, ty2 * span, span)) continue;
        const [sx, sy] = toScreen(tx2 * span, ty2 * span);
        const px = span * z;
        if (L === 0) {
          // bake only chunks the player has actually explored — a cheat-mode
          // reveal of fresh terrain keeps the macro underlay instead of
          // forcing full chunk generation for the whole viewport. Routed
          // through inSeen so the sealed-isle map partition applies here too.
          const img = inSeen(tx2 * CS + CS / 2, ty2 * CS + CS / 2) ? world.renderMapChunkCached(tx2, ty2) : null;
          if (img) wmCtx.drawImage(img, sx, sy, px, px);
          else drawFromAncestor(0, tx2, ty2, sx, sy, px);
        } else {
          world.mipTile(L, tx2, ty2);                // build/refine (budgeted)
          const rec = world.mipPeek(L, tx2, ty2);
          if (rec && rec.done) wmCtx.drawImage(rec.cv, sx, sy, px, px);
          else drawFromAncestor(L, tx2, ty2, sx, sy, px);
        }
      }

    // Roads/rivers/village buildings aren't baked into macro tiles (they're
    // subpixel noise at the coarsest zooms and would cost as much as a full
    // chunk bake to render per-tile) — draw them as a cheap VECTOR overlay
    // instead, straight from the same lightweight regional queries the full-
    // detail renderer uses, so they stay visible all the way down to the
    // zoom floor instead of disappearing the moment macro tiles take over.
    // One query for the whole viewport (mirrors mapRegionQuery's own "ask
    // once, not once per chunk" fix) — negligible cost next to a chunk bake.
    {
      const ov = wmRegionProgressive(mtx0, mty0, mtx1, mty1);
      const toS = (mx2, my2) => toScreen(mx2 * 2, my2 * 2); // map-coords -> screen
      // px per map-coord unit — the vector-overlay analogue of the baked
      // full-detail renderer's TILE=16 constant (js/world/map.js), used to
      // scale every settlement-drawing formula ported from there below.
      const zz = 2 * z;
      const pathCss = `rgb(${world.MAP_PATH.join(",")})`;
      wmCtx.lineCap = "round"; wmCtx.lineJoin = "round";

      wmCtx.strokeStyle = `rgb(${world.MAP_WATER[1].join(",")})`;
      wmCtx.lineWidth = Math.max(1, 1.6 * z);
      for (const rv of ov.rivs) for (const pts of rv.polys) {
        const [mx0, my0] = pts[Math.floor(pts.length / 2)];
        if (!revealAll && !inSeen(mx0 * 2, my0 * 2)) continue; // fog-of-war: unseen rivers stay hidden
        wmCtx.beginPath();
        pts.forEach(([px, py], i) => { const [sx, sy] = toS(px, py); i ? wmCtx.lineTo(sx, sy) : wmCtx.moveTo(sx, sy); });
        wmCtx.stroke();
      }
      wmCtx.strokeStyle = pathCss;
      wmCtx.lineWidth = Math.max(1, 1.1 * z);
      for (const rp of ov.roads) {
        const [mx0, my0] = rp.pts[Math.floor(rp.pts.length / 2)];
        if (!revealAll && !inSeen(mx0 * 2, my0 * 2)) continue; // fog-of-war: unseen roads stay hidden
        wmCtx.beginPath();
        rp.pts.forEach(([px, py], i) => { const [sx, sy] = toS(px, py); i ? wmCtx.lineTo(sx, sy) : wmCtx.moveTo(sx, sy); });
        wmCtx.stroke();
      }

      // Bridges: there's no baked per-tile bridge list at this LOD — per
      // features.js, "every road∧river tile becomes a bridge" is computed
      // geometrically at render time, so find actual road/river polyline
      // crossings (bbox-filtered first; real overlaps are rare per viewport).
      {
        const segX = (x1, y1, x2, y2, x3, y3, x4, y4) => {
          const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
          if (Math.abs(d) < 1e-9) return null;
          const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
          const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
          if (t < 0 || t > 1 || u < 0 || u > 1) return null;
          return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
        };
        const bboxOverlap = (a, b) => a && b && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
        wmCtx.strokeStyle = `rgb(${world.MAP_BRIDGE.join(",")})`;
        wmCtx.lineWidth = Math.max(1.5, 1.6 * z);
        for (const rp of ov.roads) {
          for (const rv of ov.rivs) {
            if (!bboxOverlap(rp.bbox, rv.bbox)) continue;
            for (let i = 1; i < rp.pts.length; i++) {
              const [x1, y1] = rp.pts[i - 1], [x2, y2] = rp.pts[i];
              for (const pts of rv.polys) for (let j = 1; j < pts.length; j++) {
                const hit = segX(x1, y1, x2, y2, pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1]);
                if (!hit) continue;
                if (!revealAll && !inSeen(hit[0] * 2, hit[1] * 2)) continue;
                const [sx, sy] = toS(hit[0], hit[1]);
                const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
                const ex = dx / len, ey = dy / len, half = Math.max(2, zz * 1.2);
                wmCtx.beginPath();
                wmCtx.moveTo(sx - ex * half, sy - ey * half);
                wmCtx.lineTo(sx + ex * half, sy + ey * half);
                wmCtx.stroke();
              }
            }
          }
        }
      }

      // Sea overpasses: a road stretch running out over sea-level water is an
      // overpass bridge — re-stroke those segments in the bridge colour. The
      // polyline points sit 12 game tiles apart, so segment midpoints are
      // sampled too or a narrow strait could slip between points. Terrain is
      // static per seed: classify each road once and cache by its key.
      {
        const overSea = (mx2, my2) => world.heightAt(mx2 * 2, my2 * 2) < world.LAND_ELEVATION;
        wmCtx.strokeStyle = `rgb(${world.MAP_BRIDGE.join(",")})`;
        wmCtx.lineWidth = Math.max(1.5, 1.6 * z);
        for (const rp of ov.roads) {
          let segs = wmSeaSegCache.get(rp.key);
          if (segs === undefined) {
            segs = [];
            const on = rp.pts.map(([px, py]) => overSea(px, py));
            for (let i = 1; i < rp.pts.length; i++)
              if (on[i - 1] || on[i] ||
                  overSea((rp.pts[i - 1][0] + rp.pts[i][0]) / 2, (rp.pts[i - 1][1] + rp.pts[i][1]) / 2))
                segs.push(i);
            if (wmSeaSegCache.size > 1500) wmSeaSegCache.clear();
            wmSeaSegCache.set(rp.key, segs);
          }
          if (!segs.length) continue;
          const [mx0, my0] = rp.pts[Math.floor(rp.pts.length / 2)];
          if (!revealAll && !inSeen(mx0 * 2, my0 * 2)) continue; // same fog rule as the road stroke
          wmCtx.beginPath();
          for (const i of segs) {
            const [ax, ay] = toS(rp.pts[i - 1][0], rp.pts[i - 1][1]);
            const [bx2, by2] = toS(rp.pts[i][0], rp.pts[i][1]);
            wmCtx.moveTo(ax, ay); wmCtx.lineTo(bx2, by2);
          }
          wmCtx.stroke();
        }
      }

      // Settlements: internal road pattern (city plaza cross/X/tri-band, or
      // village hub-and-spoke lines to each building), building footprints,
      // and city walls — ported from renderMapChunk's baked settlement draw
      // (js/world/map.js ~880-958), scaled by zz instead of TILE so it works
      // in live screen-space at any zoom instead of a fixed-resolution bake.
      for (const v of ov.villages) {
        if (!revealAll && !inSeen(v.x * 2, v.y * 2)) continue;
        const [ox, oy] = toS(v.x, v.y);
        if (v.kind === "city") {
          const Rpx = v.R * zz;
          wmCtx.fillStyle = pathCss;
          if (v.layout === 1) {
            wmCtx.strokeStyle = pathCss; wmCtx.lineWidth = Math.max(1, zz * 2);
            wmCtx.beginPath();
            wmCtx.moveTo(ox - Rpx * 0.75, oy - Rpx * 0.75); wmCtx.lineTo(ox + Rpx * 0.75, oy + Rpx * 0.75);
            wmCtx.moveTo(ox - Rpx * 0.75, oy + Rpx * 0.75); wmCtx.lineTo(ox + Rpx * 0.75, oy - Rpx * 0.75);
            wmCtx.stroke();
          } else if (v.layout === 2) {
            const off = Math.floor(v.R * 0.55) * zz;
            for (const dx of [-off, 0, off]) wmCtx.fillRect(ox + dx - zz, oy - Rpx, zz * 2, Rpx * 2);
            wmCtx.fillRect(ox - Rpx, oy - zz, Rpx * 2, zz * 2);
          } else {
            wmCtx.fillRect(ox - zz, oy - Rpx, zz * 2, Rpx * 2);
            wmCtx.fillRect(ox - Rpx, oy - zz, Rpx * 2, zz * 2);
          }
          if (!v.keep) wmCtx.fillRect(ox - zz * 4, oy - zz * 4, zz * 8, zz * 8);
        } else {
          wmCtx.strokeStyle = pathCss; wmCtx.lineWidth = Math.max(1, zz * 0.9);
          if (v.layout === 1 && v.buildings.length > 1) {
            const a = v.buildings[0], b2 = v.buildings[v.buildings.length - 1];
            const [ax, ay] = toS(a.x + a.w / 2, a.y + a.h / 2), [bx2, by3] = toS(b2.x + b2.w / 2, b2.y + b2.h / 2);
            wmCtx.beginPath(); wmCtx.moveTo(ax, ay); wmCtx.lineTo(bx2, by3); wmCtx.stroke();
          } else {
            for (const bd of v.buildings) {
              const [bcx, bcy] = toS(bd.x + bd.w / 2, bd.y + bd.h / 2);
              wmCtx.beginPath(); wmCtx.moveTo(ox, oy); wmCtx.lineTo(bcx, bcy); wmCtx.stroke();
            }
            wmCtx.fillStyle = pathCss;
            wmCtx.beginPath(); wmCtx.arc(ox, oy, Math.max(1.5, zz * 2.4), 0, Math.PI * 2); wmCtx.fill();
          }
        }
        for (const bd of v.buildings) {
          const [bx, by2] = toS(bd.x, bd.y);
          const bw = bd.w * zz, bh = bd.h * zz;
          // interior CUTAWAY footprint (matches renderMapChunk's baked style):
          // wall band around the wood-plank ground floor — every house shows
          // the same boards downstairs as up, and shops read as their inside.
          wmCtx.fillStyle = bd.stone ? "#8a8a80" : "#5a4632";
          wmCtx.fillRect(bx, by2, bw, bh);
          if (bw > 4 && bh > 4) {
            const ww = Math.max(1, Math.min(bw, bh) * 0.14);
            wmCtx.fillStyle = "#b0854f";
            wmCtx.fillRect(bx + ww, by2 + ww, bw - 2 * ww, bh - 2 * ww);
          }
          if (bw > 3 && bh > 3) {
            wmCtx.strokeStyle = "#3a352a"; wmCtx.lineWidth = 1;
            wmCtx.strokeRect(bx + 0.5, by2 + 0.5, bw - 1, bh - 1);
          }
        }
        if (v.kind === "city" && v.wall) {
          const Rpx = v.R * zz, gate = zz * 2.5;
          const segs = [];
          for (const s of [-1, 1]) {
            segs.push([ox - Rpx, oy + s * Rpx, ox - gate, oy + s * Rpx], [ox + gate, oy + s * Rpx, ox + Rpx, oy + s * Rpx]);
            segs.push([ox + s * Rpx, oy - Rpx, ox + s * Rpx, oy - gate], [ox + s * Rpx, oy + gate, ox + s * Rpx, oy + Rpx]);
          }
          wmCtx.lineCap = "butt";
          for (const [w, c] of [[Math.max(1, zz * 1.5), "#35322a"], [Math.max(0.6, zz * 0.8), "#85816f"]]) {
            wmCtx.strokeStyle = c; wmCtx.lineWidth = w;
            wmCtx.beginPath(); for (const [x1, y1, x2, y2] of segs) { wmCtx.moveTo(x1, y1); wmCtx.lineTo(x2, y2); } wmCtx.stroke();
          }
          wmCtx.lineCap = "round";
          wmCtx.fillStyle = "#85816f"; wmCtx.strokeStyle = "#35322a"; wmCtx.lineWidth = 1.5;
          for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
            wmCtx.fillRect(ox + sx * Rpx - zz * 1.5, oy + sy * Rpx - zz * 1.5, zz * 3, zz * 3);
            wmCtx.strokeRect(ox + sx * Rpx - zz * 1.5, oy + sy * Rpx - zz * 1.5, zz * 3, zz * 3);
          }
        }
      }

      // Fishing piers: fishing villages are a wilderness POI, not a settlement
      // — their hut/pier tiles are baked straight into chunk generation with
      // no lightweight polygon record (chunks.js "fishvillage" case), so
      // approximate with a short pier line out from the POI along its
      // coast-facing direction, the same vector this LOD already has (p.dir).
      wmCtx.strokeStyle = "#8a7250";
      wmCtx.lineWidth = Math.max(1.5, zz * 0.9);
      for (const p of ov.pois) {
        if (p.type !== "fishvillage" || !p.dir) continue;
        if (!revealAll && !inSeen(p.x * 2, p.y * 2)) continue;
        const [dx, dy] = p.dir;
        const [sx1, sy1] = toS(p.x, p.y);
        const [sx2, sy2] = toS(p.x + dx * 5, p.y + dy * 5);
        wmCtx.beginPath(); wmCtx.moveTo(sx1, sy1); wmCtx.lineTo(sx2, sy2); wmCtx.stroke();
      }
    }
  } else {
    const c0x = Math.floor(gtx0 / CS) - 1, c1x = Math.floor(gtx1 / CS) + 1;
    const c0y = Math.floor(gty0 / CS) - 1, c1y = Math.floor(gty1 / CS) + 1;
    // riversNear/roadsNear/villages/POIs each search a radius far wider than
    // one chunk, so N adjacent chunks re-running that search independently is
    // almost all redundant cache-hit overhead — query the WHOLE viewport once
    // and hand every chunk below the same shared lists instead of having each
    // one re-derive them (this was ~99% of a fresh viewport's draw cost).
    // Computed lazily, only if some chunk actually needs it: a redraw of an
    // already-fully-cached viewport (e.g. the 900ms map-open refresh timer,
    // or panning within already-viewed territory) should stay a pure cache
    // read, not pay for a region query nothing will use.
    let shared = null;
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        // unexplored = dark background; inSeen also applies the sealed-isle
        // map partition, so full-detail zoom can't cross it either
        if (!revealAll && !inSeen(cx * CS + CS / 2, cy * CS + CS / 2)) continue;
        if (!shared && !world.mapChunkCache.has(`${cx},${cy}`))
          // mapRegionQuery/renderMapChunk work in MAP-COORD units, where one
          // chunk is CS/2 wide (js/world/map.js's own local CS=16, "Map.html
          // tiles per game chunk") — NOT this file's CS=world.CHUNK=32 game
          // tiles. Multiplying chunk indices by the wrong CS here silently
          // queried a region at 2x the correct coordinate, so villages/roads
          // near (but not literally atop) the world origin would resolve to
          // the wrong, distant settlement — rendering as missing structures
          // or roads that cut off mid-tile once you zoomed into fresh chunks.
          shared = world.mapRegionQuery(c0x * CS / 2, c0y * CS / 2, (c1x + 1) * CS / 2, (c1y + 1) * CS / 2);
        // Synchronous, on purpose: the whole viewport must be complete on the
        // FIRST draw after any pan/zoom/open — no queue, no placeholder that
        // pops in later. renderMapChunk caches, so re-visiting the same area
        // is instant; only genuinely new territory pays the render cost, and
        // the macro tier above exists specifically so a huge zoomed-out
        // viewport never needs many of these expensive full bakes at once.
        const img = world.renderMapChunk(cx, cy, shared);
        const [sx, sy] = toScreen(cx * CS, cy * CS);
        wmCtx.drawImage(img, sx, sy, CS * z, CS * z);
      }
  }

  // Equator and pole lines
  {
    const LAT_CYCLE = 15000; // game tiles equator-to-equator  (LAT_PERIOD × 2)
    const LAT_HALF  =  7500; // game tiles equator-to-pole
    wmCtx.save();
    wmCtx.lineWidth = Math.max(1, z * 0.6);
    wmCtx.font = `bold ${Math.round(10 + z)}px OpenDyslexic, Arial, sans-serif`;
    wmCtx.textAlign = "left";

    // Equators — gold dashed
    wmCtx.strokeStyle = "rgba(255,210,70,0.55)";
    wmCtx.fillStyle   = "rgba(255,210,70,0.9)";
    wmCtx.setLineDash([6 * z, 4 * z]);
    const eq0 = Math.ceil(gty0 / LAT_CYCLE) * LAT_CYCLE;
    for (let ey = eq0; ey <= gty1 + LAT_CYCLE; ey += LAT_CYCLE) {
      const [, sy] = toScreen(0, ey);
      if (sy < -2 || sy > H + 2) continue;
      wmCtx.beginPath(); wmCtx.moveTo(0, sy); wmCtx.lineTo(W, sy); wmCtx.stroke();
      wmCtx.fillText("Equator", 6, sy - 3);
    }

    // Poles — ice-blue dashed; the LABEL names the kind (fullday = endless day,
    // fullnight = endless night), decided per-pole by dayFraction (1 vs 0).
    wmCtx.strokeStyle = "rgba(130,195,240,0.55)";
    wmCtx.fillStyle   = "rgba(130,195,240,0.9)";
    wmCtx.setLineDash([4 * z, 5 * z]);
    const pl0 = Math.ceil((gty0 - LAT_HALF) / LAT_CYCLE) * LAT_CYCLE + LAT_HALF;
    for (let py2 = pl0; py2 <= gty1 + LAT_CYCLE; py2 += LAT_CYCLE) {
      const [, sy] = toScreen(0, py2);
      if (sy < -2 || sy > H + 2) continue;
      const fullday = (typeof dayFraction === "function") ? dayFraction(py2) > 0.5 : false;
      wmCtx.beginPath(); wmCtx.moveTo(0, sy); wmCtx.lineTo(W, sy); wmCtx.stroke();
      wmCtx.fillText(fullday ? "Fullday Pole" : "Fullnight Pole", 6, sy - 3);
    }

    wmCtx.restore();
  }

  // Map.html tile bounds of viewport (map coords = game coords / 2)
  const mtx0 = gtx0 / 2, mtx1 = gtx1 / 2;
  const mty0 = gty0 / 2, mty1 = gty1 / 2;

  // Map icons at Map.html scale, like the OSRS interactive map. Matches the
  // POI-landmark-label threshold below, not the settlement-name one — icons
  // should disappear at the same point their POI names do, not linger alone.
  if (z >= 0.8) {
    // Icons are flat bitmap art, not pixel-art tiles — always smooth their
    // downscale to 18px regardless of the terrain's zoom-dependent setting
    // above (wmCtx.imageSmoothingEnabled = z < 2), or they alias at z >= 2.
    wmCtx.imageSmoothingEnabled = true;
    for (const ic of world.iconsNearForMap(mtx0, mty0, mtx1, mty1)) {
      if (!revealAll && !inSeen(ic.x * 2, ic.y * 2)) continue;
      const [sx, sy] = toScreen(ic.x * 2, ic.y * 2);
      if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
      if (iconImgs[ic.type]) wmCtx.drawImage(iconImgs[ic.type], sx - 9, sy - 9, 18, 18);
    }
    wmCtx.imageSmoothingEnabled = z < 2;
  }

  // Settlement name labels — same reasoning as the icon threshold above.
  // No extra letterSpacing: that was tuned to keep tightly-set Arial from
  // reading as a mushy blob at small sizes with a stroke outline —
  // OpenDyslexic's letterforms are already wide/distinct on their own, and
  // stacking artificial tracking on top of that just spread words out
  // unevenly (this was very likely part of the reported "hard to read").
  if (z >= 0.2) {
    wmCtx.textAlign = "center"; wmCtx.lineJoin = "round";
    for (const v of world.villagesNearForMap(mtx0, mty0, mtx1, mty1, 42)) {
      if (!revealAll && !inSeen(v.x * 2, v.y * 2)) continue;
      const [sx, sy] = toScreen(v.x * 2, v.y * 2);
      const ly = sy - (v.kind === "city" ? v.R * 2 * z + 8 : 14 * z + 6);
      wmCtx.font = v.kind === "city" ? "bold 15px OpenDyslexic, Arial, sans-serif" : "bold 12px OpenDyslexic, Arial, sans-serif";
      wmCtx.strokeStyle = "rgba(0,0,0,0.85)"; wmCtx.lineWidth = 3;
      wmCtx.strokeText(v.name, sx, ly);
      wmCtx.fillStyle = "#fff";
      wmCtx.fillText(v.name, sx, ly);
    }
    // POI landmark labels — deliberately a much higher threshold than the
    // settlement-name block above: only city/village names should crowd the
    // widest zoom levels, individual landmark names stay reserved for closer
    // zoom so the map doesn't turn into wall-to-wall overlapping text.
    if (z >= 0.8) {
      wmCtx.font = "bold 11px OpenDyslexic, Arial, sans-serif";
      for (const p of world.poisNearForMap(mtx0, mty0, mtx1, mty1, 14)) {
        if (!WM_LABELED_POI.has(p.type) || !p.name) continue;
        if (!revealAll && !inSeen(p.x * 2, p.y * 2)) continue;
        const [sx, sy] = toScreen(p.x * 2, p.y * 2);
        wmCtx.strokeStyle = "rgba(0,0,0,0.85)"; wmCtx.lineWidth = 3;
        wmCtx.strokeText(p.name, sx, sy - 12 * z - 5);
        wmCtx.fillStyle = "#ffe98a";
        wmCtx.fillText(p.name, sx, sy - 12 * z - 5);
      }
    }
  }

  wmCtx.letterSpacing = "0px";
  // ---- day/night + weather overlays: cached composite ----
  // Both field overlays cost tens of ms to compute at map size — far too slow
  // to rebuild on every drag/zoom event. They render into an offscreen
  // composite tagged with the view that produced it; while the view is moving
  // the stale composite is blitted shifted/scaled (edges go briefly bare) and
  // a settle timer repaints it crisp shortly after the last interaction. On
  // an idle map the 900ms tick refreshes it every WM_OV_TTL ms so the fields
  // still drift with game time.
  const wantDn = wm.dn && typeof dayFraction === "function" && typeof sunPhase === "function";
  const wantWx = wm.wx && typeof wxAnomaly === "function" && typeof wxDerive === "function"
    && typeof windAt === "function" && !!world;
  let ovG = null;                 // non-null → recompute the composite this draw
  if (wantDn || wantWx) {
    const nowMs = Date.now();
    const compat = wmOvCache && wmOvCache.W === W && wmOvCache.H === H && wmOvCache.dpr === dpr
      && wmOvCache.dn === wantDn && wmOvCache.wx === wantWx;
    const sameView = compat && wmOvCache.cx === wm.cx && wmOvCache.cy === wm.cy && wmOvCache.z === z;
    const interacting = !!wm.drag || (performance.now() - wmWheelT) < 160;
    if (!compat || (!interacting && (!sameView || nowMs - wmOvCache.t >= WM_OV_TTL))) {
      if (!compat) {
        const cv = document.createElement("canvas");
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        wmOvCache = { cv, g: cv.getContext("2d"), W, H, dpr, dn: wantDn, wx: wantWx, cx: 0, cy: 0, z: 1, t: 0 };
      }
      ovG = wmOvCache.g;
      ovG.setTransform(dpr, 0, 0, dpr, 0, 0);
      ovG.clearRect(0, 0, W, H);
      wmOvCache.cx = wm.cx; wmOvCache.cy = wm.cy; wmOvCache.z = z; wmOvCache.t = nowMs;
    } else if (!sameView || nowMs - wmOvCache.t >= WM_OV_TTL) {
      wmOverlaySettleSoon();      // repaint crisp once the interaction stops
    }
  }
  // ---- day/night overlay (toggled by the #wm-dn checkbox) ----
  // Tint every part of the map by its DAYLIGHT right now: daylight varies with
  // LATITUDE (dayFraction triangle wave) and LONGITUDE (continuous sunPhase),
  // so the terminator runs as a smooth CURVE through the timezones rather than
  // stepping band by band. Sampled per pixel on a quarter-resolution buffer
  // (colours blended night → dusk → day on the daylight value) and scaled up
  // with smoothing. Endless-day/night poles read fully lit / fully dark.
  if (ovG && wantDn) {
    const g = ovG;
    g.save();
    const DS = 4;                                       // screen px per sample
    const bw2 = Math.max(1, Math.ceil(W / DS)), bh2 = Math.max(1, Math.ceil(H / DS));
    if (!wmDnBuf || wmDnBuf.cv.width !== bw2 || wmDnBuf.cv.height !== bh2) {
      const cv = document.createElement("canvas"); cv.width = bw2; cv.height = bh2;
      const bctx = cv.getContext("2d");
      wmDnBuf = { cv, ctx: bctx, img: bctx.createImageData(bw2, bh2) };
    }
    // band colours (alpha pre-scaled to 0..255), blended smoothly on L
    const CN = [12, 22, 66, 158], CT = [255, 120, 45, 87], CD = [255, 235, 150, 26];
    // the sun term only depends on the COLUMN and the latitude terms only on
    // the ROW, so precompute each once and combine per pixel (daylightAt math
    // inlined: L = smoothstep(thr−tw, thr+tw, sun)).
    const tw = 0.14;
    const sunC = new Float64Array(bw2);
    for (let c = 0; c < bw2; c++) {
      const wx = wm.cx + ((c + 0.5) * DS - W / 2) / z;
      sunC[c] = Math.cos(2 * Math.PI * (sunPhase(wx) - 0.5));
    }
    const data = wmDnBuf.img.data;
    for (let r = 0; r < bh2; r++) {
      const wy = wm.cy + ((r + 0.5) * DS - H / 2) / z;
      const D = dayFraction(wy);
      const thr = Math.cos(Math.PI * D);
      for (let c = 0; c < bw2; c++) {
        let L;
        if (D >= 0.999) L = 1;
        else if (D <= 0.001) L = 0;
        else {
          const t = Math.max(0, Math.min(1, (sunC[c] - thr + tw) / (2 * tw)));
          L = t * t * (3 - 2 * t);
        }
        // unrolled two-band lerp (a .map() here allocates two arrays per
        // pixel — ~180k throwaway objects per redraw, pure GC churn)
        let R2, G2, B2, A2;
        if (L < 0.5) {
          const t2 = L * 2;
          R2 = CN[0] + (CT[0] - CN[0]) * t2; G2 = CN[1] + (CT[1] - CN[1]) * t2;
          B2 = CN[2] + (CT[2] - CN[2]) * t2; A2 = CN[3] + (CT[3] - CN[3]) * t2;
        } else {
          const t2 = (L - 0.5) * 2;
          R2 = CT[0] + (CD[0] - CT[0]) * t2; G2 = CT[1] + (CD[1] - CT[1]) * t2;
          B2 = CT[2] + (CD[2] - CT[2]) * t2; A2 = CT[3] + (CD[3] - CT[3]) * t2;
        }
        const i4 = (r * bw2 + c) * 4;
        data[i4] = R2; data[i4 + 1] = G2; data[i4 + 2] = B2; data[i4 + 3] = A2;
      }
    }
    wmDnBuf.ctx.putImageData(wmDnBuf.img, 0, 0);
    const sm = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = true;
    g.drawImage(wmDnBuf.cv, 0, 0, bw2, bh2, 0, 0, bw2 * DS, bh2 * DS);
    g.imageSmoothingEnabled = sm;
    g.restore();
  }
  // ---- weather overlay: SYNOPTIC CHART (toggled by the #wm-wx checkbox) ----
  // A proper weather chart from the deterministic field the world renders
  // (gameplay/weather.js): sea-level ISOBARS every 4 hPa with pressure labels,
  // H / L centres at the pressure extrema, FRONTS as classified lines (blue
  // triangles = cold front, red half-discs = warm, purple alternating =
  // occluded; symbols sit on the side the front is advancing), WIND BARBS
  // showing the geostrophic flow along the isobars, and a soft precipitation
  // shade (blue rain / pale snow) underneath. A light paper wash keeps the
  // linework readable over the terrain art. The drifting anomaly is resampled
  // per redraw; the heavy climate fields (humidity/temperature/altitude) are
  // time-invariant, cached per view, recomputed only on pan/zoom/resize.
  if (ovG && wantWx) {
    const g = ovG;
    g.save();
    const DS = 8;                                       // screen px per sample
    const bw2 = Math.max(1, Math.ceil(W / DS)), bh2 = Math.max(1, Math.ceil(H / DS));
    if (!wmWxBuf || wmWxBuf.cv.width !== bw2 || wmWxBuf.cv.height !== bh2) {
      const cv = document.createElement("canvas"); cv.width = bw2; cv.height = bh2;
      const bctx = cv.getContext("2d");
      wmWxBuf = { cv, ctx: bctx, img: bctx.createImageData(bw2, bh2) };
    }
    const wxAtCol = c => wm.cx + ((c + 0.5) * DS - W / 2) / z;
    const wyAtRow = r => wm.cy + ((r + 0.5) * DS - H / 2) / z;
    const sxC = c => (c + 0.5) * DS, syR = r => (r + 0.5) * DS;
    const wxOfPx = px => wm.cx + (px - W / 2) / z, wyOfPx = py => wm.cy + (py - H / 2) / z;
    // climate fields are smooth continental-scale signals but EXPENSIVE to
    // sample (humidityAt alone runs five elevation() evaluations). Two fixes
    // vs the old per-cell, per-view sampling that made every pan/zoom hitch:
    //  1) sample on a 4×-coarser lattice and bilinearly interpolate per cell
    //     (~16× fewer terrain samples, no visible change in the precip shade
    //     they gate);
    //  2) anchor the lattice to WORLD coordinates and cache points in a Map,
    //     so panning reuses everything already sampled — only newly-exposed
    //     edge points hit the terrain fields. Zoom changes the lattice step,
    //     which resets the cache (one ~coarse refill per wheel tick).
    const CGS = 4;                                      // sample cells per clim-lattice step
    const latStep = (DS / z) * CGS;                     // tiles per lattice step
    if (!wmWxClim || wmWxClim.step !== latStep) wmWxClim = { step: latStep, map: new Map() };
    const u0f = wxAtCol(0) / latStep, v0f = wyAtRow(0) / latStep;
    const g0x = Math.floor(u0f), g0y = Math.floor(v0f);
    const uOff = u0f - g0x, vOff = v0f - g0y;           // first cell's fractional lattice coord
    const cgw = Math.floor(bw2 / CGS) + 3, cgh = Math.floor(bh2 / CGS) + 3;
    const clim = new Float32Array(cgw * cgh * 3);       // hum, temp, altFrac per lattice point
    {
      const LE = world.LAND_ELEVATION, m = wmWxClim.map;
      if (m.size > 30000) m.clear();                    // bound long pans' memory
      for (let r = 0; r < cgh; r++) for (let c = 0; c < cgw; c++) {
        const key = (g0x + c) + "," + (g0y + r);
        let p = m.get(key);
        if (!p) {
          const wx = (g0x + c) * latStep, wy = (g0y + r) * latStep;
          p = [world.humidityAt(wx, wy), world.temperatureAt(wx, wy),
               Math.max(0, (world.heightAt(wx, wy) - LE) / (1 - LE))];
          m.set(key, p);
        }
        const i3 = (r * cgw + c) * 3;
        clim[i3] = p[0]; clim[i3 + 1] = p[1]; clim[i3 + 2] = p[2];
      }
    }
    const tNow = (typeof now !== "undefined") ? now : Date.now();
    const data = wmWxBuf.img.data;
    // gradient arm: weatherCore's 28 tiles when zoomed in (matches what the
    // player experiences on the ground), widening to the sample spacing when
    // zoomed out so the chart draws the big sweeping fronts, not micro-speckle
    const ARM = Math.max(28, DS / z);
    // sample the anomaly ONCE per cell, then finite-difference the sampled
    // grid for the gradient (arm snapped to a whole number of cells): same
    // math as resampling ±ARM at a fifth of the wxAnomaly calls, and exactly
    // identical when zoomed out (there ARM = the sample spacing = one cell)
    const an = new Float64Array(bw2 * bh2);             // anomaly per cell (isobars, H/L, fronts)
    const nightRow = new Float64Array(bh2);
    for (let r = 0; r < bh2; r++) {
      const wy = wyAtRow(r);
      nightRow[r] = (typeof daylightAt === "function" && typeof sunPhase === "function")
        ? 1 - daylightAt(wy, sunPhase(wm.cx)) : 0;      // per-row: latitude dominates day length
      for (let c = 0; c < bw2; c++) an[r * bw2 + c] = wxAnomaly(wxAtCol(c), wy, tNow);
    }
    const spacing = DS / z;                             // tiles per cell
    const K = Math.max(1, Math.round(ARM / spacing));   // gradient arm in cells
    for (let r = 0; r < bh2; r++) {
      const rt = Math.max(0, r - K), rb = Math.min(bh2 - 1, r + K);
      for (let c = 0; c < bw2; c++) {
        const i = r * bw2 + c;
        const cl = Math.max(0, c - K), cr = Math.min(bw2 - 1, c + K);
        const gx = (an[r * bw2 + cr] - an[r * bw2 + cl]) / ((cr - cl) * spacing);
        const gy = (an[rb * bw2 + c] - an[rt * bw2 + c]) / ((rb - rt) * spacing);
        const grad = Math.hypot(gx, gy);
        // bilinear clim fetch from the coarse lattice
        const fc = uOff + c / CGS, fr = vOff + r / CGS;
        const c0 = fc | 0, r0 = fr | 0, tx = fc - c0, ty = fr - r0;
        const i00 = (r0 * cgw + c0) * 3, i10 = i00 + 3, i01 = i00 + cgw * 3, i11 = i01 + 3;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const hum  = clim[i00] * w00 + clim[i10] * w10 + clim[i01] * w01 + clim[i11] * w11;
        const temp = clim[i00 + 1] * w00 + clim[i10 + 1] * w10 + clim[i01 + 1] * w01 + clim[i11 + 1] * w11;
        const alt  = clim[i00 + 2] * w00 + clim[i10 + 2] * w10 + clim[i01 + 2] * w01 + clim[i11 + 2] * w11;
        const w = wxDerive(an[i], grad, hum, temp, alt, nightRow[r]);
        // precipitation shade only — the synoptic story is told by the linework
        let R = 0, G = 0, B = 0, A = 0;
        if (w.precip > 0) {
          if (w.kind === "snow") { R = 225; G = 235; B = 250; } else { R = 70; G = 130; B = 235; }
          A = 40 + w.precip * 110;
        }
        const i4 = i * 4;
        data[i4] = R; data[i4 + 1] = G; data[i4 + 2] = B; data[i4 + 3] = A;
      }
    }
    // paper wash so the chart reads over the terrain art, then the precip shade
    g.fillStyle = "rgba(233,236,242,0.35)"; g.fillRect(0, 0, W, H);
    wmWxBuf.ctx.putImageData(wmWxBuf.img, 0, 0);
    const sm2 = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = true;
    g.drawImage(wmWxBuf.cv, 0, 0, bw2, bh2, 0, 0, bw2 * DS, bh2 * DS);
    g.imageSmoothingEnabled = sm2;

    // marching squares over a 2×-COARSENED anomaly grid (16 px segments — the
    // fine grid quadruples the squares and doubles the stroked segments for no
    // visible gain, and stroking tens of thousands of segments is what blows
    // the frame budget). Corner values are the 4 neighbouring coarse centres.
    const MS = z < 0.15 ? 3 : 2, DSS = DS * MS;   // coarser still at continental zoom
    const gw = Math.floor((bw2 + MS - 1) / MS), gh = Math.floor((bh2 + MS - 1) / MS);
    const anC = new Float64Array(gw * gh);
    for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++)
      anC[r * gw + c] = an[Math.min(r * MS, bh2 - 1) * bw2 + Math.min(c * MS, bw2 - 1)];
    // low-pass the CHART field: at wide zooms the fine (280-tile) noise layer
    // aliases at the sample spacing and crinkles every isobar into scribble —
    // a couple of 3×3 box blurs leave only the synoptic sweep a real chart
    // draws (the in-game weather field itself is untouched)
    {
      const tmpA = new Float64Array(gw * gh);
      const passes = z < 0.4 ? 2 : 1;
      for (let p = 0; p < passes; p++) {
        for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
          let s = 0, n = 0;
          for (let dr = -1; dr <= 1; dr++) {
            const rr = r + dr; if (rr < 0 || rr >= gh) continue;
            for (let dc = -1; dc <= 1; dc++) {
              const cc = c + dc; if (cc < 0 || cc >= gw) continue;
              s += anC[rr * gw + cc]; n++;
            }
          }
          tmpA[r * gw + c] = s / n;
        }
        anC.set(tmpA);
      }
    }
    const csx = c => (c * MS + 0.5) * DS, csy = r => (r * MS + 0.5) * DS;
    const march = (level, cb) => {
      for (let r = 0; r < gh - 1; r++) for (let c = 0; c < gw - 1; c++) {
        const i = r * gw + c;
        const v0 = anC[i], v1 = anC[i + 1], v2 = anC[i + gw + 1], v3 = anC[i + gw];   // TL TR BR BL
        let p0 = null, p1 = null, p2 = null, p3 = null;
        if ((v0 < level) !== (v1 < level)) p0 = [csx(c) + DSS * (level - v0) / (v1 - v0), csy(r)];
        if ((v1 < level) !== (v2 < level)) p1 = [csx(c + 1), csy(r) + DSS * (level - v1) / (v2 - v1)];
        if ((v3 < level) !== (v2 < level)) p2 = [csx(c) + DSS * (level - v3) / (v2 - v3), csy(r + 1)];
        if ((v0 < level) !== (v3 < level)) p3 = [csx(c), csy(r) + DSS * (level - v0) / (v3 - v0)];
        const a1 = p0 || p1 || p2, b1 = p3 || p2 || p1;
        if (!a1 || !b1 || a1 === b1) continue;
        if (p0 && p1 && p2 && p3) { cb(p0, p1, i); cb(p2, p3, i); }   // saddle: arbitrary pairing
        else cb(a1, b1, i);
      }
    };

    // -- isobars in the GAME's pressure scale (the Prs meter: 100% = 1 atm at
    // sea level, sea-level pressure = 100 × (1 + anom × 0.045)); 1% contour
    // interval, halving to 0.5% when the view spans only a narrow range --
    let aMin = Infinity, aMax = -Infinity;
    for (let i = 0; i < anC.length; i++) { if (anC[i] < aMin) aMin = anC[i]; if (anC[i] > aMax) aMax = anC[i]; }
    const PCT = a => 100 * (1 + a * 0.045);
    const STEP = (PCT(aMax) - PCT(aMin)) > 2.5 ? 0.5 : 0.25;
    const isoLabels = [];
    g.strokeStyle = "rgba(44,46,62,0.72)"; g.lineWidth = 1.2;
    g.beginPath();
    for (let k = Math.ceil(PCT(aMin) / STEP); k * STEP <= PCT(aMax); k++) {
      const pc = k * STEP;
      const lv = (pc / 100 - 1) / 0.045;
      const lbl = (+pc.toFixed(2)) + "%";   // strip trailing zeros: "99%", "99.5%", "99.25%"
      let n = 0;
      march(lv, (p, q) => {
        g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]);
        if ((n++ % 56) === 28) isoLabels.push([p[0], p[1], lbl]);
      });
    }
    g.stroke();

    // -- fronts: the anom = −0.15 isoline (the working edge of each low),
    // keeping only the ACTIVE stretches — gated by the LOCAL 28-tile pressure
    // gradient at each segment (frontal sharpness is a local property; the
    // chart grid's wide-arm gradient washes it out at continental zoom) — and
    // classified by what the wind is advecting across the line: colder air
    // advancing = cold front, warmer = warm front, neither = occluded --
    const cold = [], warm = [], occl = [];
    march(-0.15, (p, q) => {
      const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      const wxp = wxOfPx(mx), wyp = wyOfPx(my);
      const g28 = Math.hypot(
        wxAnomaly(wxp + 28, wyp, tNow) - wxAnomaly(wxp - 28, wyp, tNow),
        wxAnomaly(wxp, wyp + 28, tNow) - wxAnomaly(wxp, wyp - 28, tNow)) / 56;
      if (g28 < 0.0025) return;   // wxDerive's front-gate p80 — keep in sync
      const v = windAt(wxp, wyp, tNow);
      const sp = Math.hypot(v.x, v.y) || 1;
      const ux = v.x / sp, uy = v.y / sp;
      const dT = world.temperatureAt(wxp - ux * 150, wyp - uy * 150)   // behind (upwind)
               - world.temperatureAt(wxp + ux * 150, wyp + uy * 150);  // ahead
      // advance side: the segment normal the wind blows toward (map = world axes)
      let nx = -(q[1] - p[1]), ny = q[0] - p[0];
      const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      if (nx * v.x + ny * v.y < 0) { nx = -nx; ny = -ny; }
      (dT < -0.008 ? cold : dT > 0.008 ? warm : occl).push({ p, q, mx, my, nx, ny });
    });
    const drawFront = (segs, col, sym) => {
      if (!segs.length) return;
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2.2;
      g.beginPath();
      for (const s of segs) { g.moveTo(s.p[0], s.p[1]); g.lineTo(s.q[0], s.q[1]); }
      g.stroke();
      let n = 0;
      for (const s of segs) {
        if ((n++ % 3) !== 1) continue;
        const kind = sym === "alt" ? (n % 2 ? "tri" : "arc") : sym;
        const angN = Math.atan2(s.ny, s.nx);
        if (kind === "tri") {
          const tx = -s.ny, ty = s.nx;   // segment tangent
          g.beginPath();
          g.moveTo(s.mx + tx * 5, s.my + ty * 5);
          g.lineTo(s.mx - tx * 5, s.my - ty * 5);
          g.lineTo(s.mx + s.nx * 7, s.my + s.ny * 7);
          g.closePath(); g.fill();
        } else {
          g.beginPath();
          g.arc(s.mx, s.my, 5, angN - Math.PI / 2, angN + Math.PI / 2);
          g.closePath(); g.fill();
        }
      }
    };
    drawFront(cold, "#2050c8", "tri");
    drawFront(warm, "#c8283c", "arc");
    drawFront(occl, "#8a30b0", "alt");

    // -- H / L pressure centres: collect the strict extrema of the coarse
    // field, then greedily dedupe — the anomaly CLAMPS at ±1, so a deep low is
    // a plateau of tied cells that would each print their own L; keep only the
    // deepest/highest centre within any 120-px neighbourhood of its own sign --
    const NB = Math.max(3, Math.round(7 / MS) + 2);     // extremum neighbourhood radius, coarse cells
    const centres = [];
    for (let r = 1; r < gh - 1; r++) for (let c = 1; c < gw - 1; c++) {
      const a = anC[r * gw + c];
      if (a < 0.28 && a > -0.28) continue;
      const hi = a > 0;
      let ok = true;
      for (let dr = -NB; dr <= NB && ok; dr++) for (let dc = -NB; dc <= NB; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= gh || cc < 0 || cc >= gw) continue;
        const b = anC[rr * gw + cc];
        if (hi ? b > a : b < a) { ok = false; break; }
      }
      if (ok) centres.push({ x: csx(c), y: csy(r), a, hi });
    }
    centres.sort((p, q) => Math.abs(q.a) - Math.abs(p.a));
    const kept = [];
    g.textAlign = "center";
    for (const e of centres) {
      if (kept.some(k => k.hi === e.hi && Math.hypot(k.x - e.x, k.y - e.y) < 120)) continue;
      kept.push(e);
      const pcs = PCT(e.a).toFixed(1) + "%";
      g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 3;
      g.font = "bold 20px OpenDyslexic, Verdana";
      g.strokeText(e.hi ? "H" : "L", e.x, e.y + 7);
      g.fillStyle = e.hi ? "#2050c8" : "#c8283c";
      g.fillText(e.hi ? "H" : "L", e.x, e.y + 7);
      g.font = "bold 10px OpenDyslexic, Verdana";
      g.strokeText(pcs, e.x, e.y + 19);
      g.fillText(pcs, e.x, e.y + 19);
    }

    // -- wind barbs on a coarse grid: the staff points INTO the wind (the
    // from-direction, like a station plot); feathers count speed — full barb
    // 10 kn, half barb 5, a bare circle for near-calm --
    g.strokeStyle = "rgba(24,28,44,0.85)"; g.lineWidth = 1.4;
    const BSP = 9;                                      // cells between barbs
    for (let r = 4; r < bh2; r += BSP) for (let c = 4; c < bw2; c += BSP) {
      const px2 = sxC(c), py2 = syR(r);
      const v = windAt(wxAtCol(c), wyAtRow(r), tNow);
      const sp = Math.hypot(v.x, v.y), kn = sp * 10;
      if (kn < 2.5) { g.beginPath(); g.arc(px2, py2, 2.5, 0, 7); g.stroke(); continue; }
      const ux = -v.x / sp, uy = -v.y / sp;             // from-direction unit
      const ex = px2 + ux * 24, ey = py2 + uy * 24;
      g.beginPath(); g.moveTo(px2, py2); g.lineTo(ex, ey);
      const fx = uy, fy = -ux;                          // feather side
      let rem = Math.round(kn / 5) * 5, k = 0;
      while (rem >= 10) {
        const bx0 = ex - ux * k * 4.5, by0 = ey - uy * k * 4.5;
        g.moveTo(bx0, by0); g.lineTo(bx0 + fx * 8 + ux * 3, by0 + fy * 8 + uy * 3);
        rem -= 10; k++;
      }
      if (rem >= 5) {                                   // half barb never sits at the very tip
        const kk = k || 1;
        const bx0 = ex - ux * kk * 4.5, by0 = ey - uy * kk * 4.5;
        g.moveTo(bx0, by0); g.lineTo(bx0 + fx * 4.5 + ux * 1.7, by0 + fy * 4.5 + uy * 1.7);
      }
      g.stroke();
    }

    // -- isobar labels last (white pills so they read over everything) --
    g.font = "bold 9px OpenDyslexic, Verdana"; g.textAlign = "center";
    for (const [lx, ly, lbl] of isoLabels) {
      const tw = g.measureText(lbl).width;
      g.fillStyle = "rgba(240,242,248,0.92)";
      g.fillRect(lx - tw / 2 - 3, ly - 6, tw + 6, 12);
      g.fillStyle = "#2a2c3c";
      g.fillText(lbl, lx, ly + 3.5);
    }

    g.restore();
  }
  if (wantDn || wantWx) {
    // blit the composite mapped from its captured view onto the current one
    const oc = wmOvCache, k = z / oc.z;
    const bx0 = (oc.cx - (oc.W / 2) / oc.z - wm.cx) * z + W / 2;
    const by0 = (oc.cy - (oc.H / 2) / oc.z - wm.cy) * z + H / 2;
    const smB = wmCtx.imageSmoothingEnabled;
    wmCtx.imageSmoothingEnabled = true;
    wmCtx.drawImage(oc.cv, bx0, by0, oc.W * k, oc.H * k);
    wmCtx.imageSmoothingEnabled = smB;
    // legends drawn LIVE on the map canvas (not into the composite) so a
    // stale shifted blit never slides them around
    if (wantDn) {
      const rows = [["Day", "rgba(255,235,150,0.9)"], ["Dusk / Dawn", "rgba(255,120,45,0.95)"], ["Night", "rgba(30,45,110,0.98)"]];
      const lw = 118, lh = 8 + rows.length * 18, lx = 10, ly = H - 40 - lh;
      wmCtx.fillStyle = "rgba(0,0,0,0.6)"; wmCtx.fillRect(lx, ly, lw, lh);
      wmCtx.font = "12px OpenDyslexic, Verdana"; wmCtx.textAlign = "left";
      rows.forEach(([label, col], i) => {
        const ry = ly + 6 + i * 18;
        wmCtx.fillStyle = col; wmCtx.fillRect(lx + 8, ry, 14, 12);
        wmCtx.strokeStyle = "rgba(255,255,255,0.45)"; wmCtx.lineWidth = 1; wmCtx.strokeRect(lx + 8.5, ry + 0.5, 13, 11);
        wmCtx.fillStyle = "#fff"; wmCtx.fillText(label, lx + 28, ry + 11);
      });
    }
    if (wantWx) {
      // sits beside the day/night legend when both are on
      const rows2 = [
        ["Cold front", "#2050c8", "line"], ["Warm front", "#c8283c", "line"], ["Occluded", "#8a30b0", "line"],
        ["Rain", "rgba(70,130,235,0.9)", "fill"], ["Snow", "rgba(225,235,250,0.95)", "fill"],
        ["Isobars (Prs %)", "rgba(44,46,62,0.85)", "line"], ["Wind barb 10 kn", "rgba(24,28,44,0.9)", "barb"],
      ];
      const lw = 134, lh = 8 + rows2.length * 18, lx = wantDn ? 136 : 10, ly = H - 40 - lh;
      wmCtx.fillStyle = "rgba(0,0,0,0.62)"; wmCtx.fillRect(lx, ly, lw, lh);
      wmCtx.font = "11px OpenDyslexic, Verdana"; wmCtx.textAlign = "left";
      rows2.forEach(([label, col, kind], i) => {
        const ry = ly + 6 + i * 18;
        if (kind === "fill") {
          wmCtx.fillStyle = col; wmCtx.fillRect(lx + 8, ry, 14, 12);
          wmCtx.strokeStyle = "rgba(255,255,255,0.45)"; wmCtx.lineWidth = 1; wmCtx.strokeRect(lx + 8.5, ry + 0.5, 13, 11);
        } else {
          wmCtx.strokeStyle = col; wmCtx.lineWidth = kind === "barb" ? 1.4 : 2.2;
          wmCtx.beginPath(); wmCtx.moveTo(lx + 8, ry + 6); wmCtx.lineTo(lx + 22, ry + 6);
          if (kind === "barb") { wmCtx.moveTo(lx + 22, ry + 6); wmCtx.lineTo(lx + 26, ry - 1); }
          wmCtx.stroke();
        }
        wmCtx.fillStyle = "#fff"; wmCtx.fillText(label, lx + 30, ry + 11);
      });
    }
  }
  // ---- timezone overlay (toggled by the #wm-tz checkbox) ----
  // One band is TZ_TILES wide = 1 hour; zone n is centred on x = n*TZ and its
  // clock runs n hours ahead of Newhaven (0,0). Bands are drawn as alternating
  // translucent stripes with the hour offset labelled at each band's centre.
  if (wm.tz) {
    const TZ = (typeof TZ_TILES !== "undefined") ? TZ_TILES : 256;
    const n0 = Math.round(gtx0 / TZ) - 1, n1 = Math.round(gtx1 / TZ) + 1;
    wmCtx.save();
    wmCtx.textAlign = "center";
    for (let n = n0; n <= n1; n++) {
      const lx = toScreen(n * TZ - TZ / 2, wm.cy)[0];
      const rx = toScreen(n * TZ + TZ / 2, wm.cy)[0];
      wmCtx.fillStyle = (n & 1) ? "rgba(90,160,255,0.13)" : "rgba(255,205,90,0.10)";
      wmCtx.fillRect(lx, 0, rx - lx, H);
      wmCtx.strokeStyle = "rgba(190,215,255,0.6)"; wmCtx.lineWidth = 1;
      wmCtx.beginPath(); wmCtx.moveTo(lx + 0.5, 0); wmCtx.lineTo(lx + 0.5, H); wmCtx.stroke();
      const cx = (lx + rx) / 2;
      if (cx > -60 && cx < W + 60) {
        // wrap the hour offset into [-11, +12] so the clock rolls over past the
        // date line: the band right of +12h reads -11h, the band left of -11h reads +12h
        const off = ((n + 11) % 24 + 24) % 24 - 11;
        const label = off === 0 ? "Newhaven ±0h" : off === 12 ? "±12h" : (off > 0 ? "+" + off + "h" : off + "h");
        wmCtx.font = "bold 12px OpenDyslexic, Verdana";
        wmCtx.fillStyle = "rgba(0,0,0,0.85)"; wmCtx.fillText(label, cx + 1, 67);
        wmCtx.fillStyle = "#dbeaff"; wmCtx.fillText(label, cx, 66);
      }
    }
    wmCtx.restore();
  }
  wmCtx.textAlign = "left";
  // ---- quest markers (objective / giver / newly-revealed place) ----
  if (typeof Quests !== "undefined") {
    let qm = [];
    try { qm = Quests.activeMarkers() || []; } catch (e) { }
    wmCtx.textAlign = "center";
    wmCtx.font = "bold 12px OpenDyslexic, Arial, sans-serif";
    for (const m of qm) {
      const [sx, sy] = toScreen(m.x, m.y);
      if (sx < -30 || sx > W + 30 || sy < -20 || sy > H + 30) continue;
      const col = m.kind === "objective" ? "#ffe14a" : m.kind === "giver" ? "#7fd0ff" : "#8fe08f";
      // a diamond ✦ marker
      wmCtx.fillStyle = col; wmCtx.strokeStyle = "rgba(0,0,0,0.85)"; wmCtx.lineWidth = 2;
      wmCtx.beginPath();
      wmCtx.moveTo(sx, sy - 7); wmCtx.lineTo(sx + 6, sy); wmCtx.lineTo(sx, sy + 7); wmCtx.lineTo(sx - 6, sy); wmCtx.closePath();
      wmCtx.stroke(); wmCtx.fill();
      if (m.label) {
        wmCtx.fillStyle = "rgba(0,0,0,0.85)"; wmCtx.fillText(m.label, sx + 1, sy - 11);
        wmCtx.fillStyle = col; wmCtx.fillText(m.label, sx, sy - 12);
      }
    }
    wmCtx.textAlign = "left";
  }
  // Player marker — while dreaming, the map swears you are still standing at
  // the door you entered by. It barely moves for as long as you walk. That is
  // the point (gameplay/dream.js: the picture looks normal, and it is wrong).
  const _wmP = (typeof Dream !== "undefined" && Dream.mapPos && Dream.mapPos()) || player;
  const [px2, py2] = toScreen(_wmP.x, _wmP.y);
  wmCtx.strokeStyle = "#fff"; wmCtx.lineWidth = 2;
  wmCtx.beginPath(); wmCtx.arc(px2, py2, 6, 0, 7); wmCtx.stroke();
  wmCtx.fillStyle = "#fff";
  wmCtx.font = "11px OpenDyslexic, Verdana"; wmCtx.textAlign = "left";
  const tip = DEV_MODE
    ? `[CHEAT] Double-click to teleport — ${seenChunks.size} areas explored — scroll to zoom, drag to pan, M/Esc to close`
    : `${seenChunks.size} areas explored — scroll to zoom, drag to pan, M/Esc to close`;
  wmCtx.fillText(tip, 10, H - 10);
  // current zoom level, top-left (black shadow so it reads over any terrain)
  const zlabel = `Zoom ${wm.zoom >= 1 ? wm.zoom.toFixed(1) : wm.zoom.toFixed(2)}×`;
  wmCtx.font = "bold 13px OpenDyslexic, Verdana"; wmCtx.textAlign = "left";
  wmCtx.fillStyle = "#000"; wmCtx.fillText(zlabel, 11, 21);
  wmCtx.fillStyle = "#ffe97a"; wmCtx.fillText(zlabel, 10, 20);
}

// One-time upgrade from the hand-drawn Canvas2D vector glyphs to the real
// bitmap art in map-icon-atlas-data.js, once that sheet has finished
// decoding. Deferred to first map open (rather than run at iconImgs'
// module-load time above) because IMGS["mi"] isn't populated until
// loadAssets() runs during boot — well after this file has already
// executed — but is always ready by the time a player can open the map.
// Draws straight from the 64x64 atlas tile into a 40x40 canvas WITH
// smoothing on, bypassing the shared icon() helper (main/assets.js) which
// hardcodes imageSmoothingEnabled=false and a 32x32 target — correct for
// crisp pixel-art tile/item sprites, but it bakes a nearest-neighbor 64->32
// downscale into these flat bitmap icons before they're ever drawn at their
// final 10-18px map/minimap size, which is what actually caused the
// pixelation (smoothing the LATER draw call couldn't undo that first step).
let _mapIconArtApplied = false;
function applyMapIconArt() {
  if (_mapIconArtApplied) return;
  if (typeof MAP_ICON_TYPES === "undefined" || typeof IMGS === "undefined" || !IMGS["mi"] || !IMGS["mi"].complete) return;
  if (!IMGS["mi2"] || !IMGS["mi2"].complete) return; // second sheet must be decoded too
  _mapIconArtApplied = true;
  for (const type of MAP_ICON_TYPES) {
    const [sheet, , , extra] = SPR["i_mapicon_" + type];
    const c = document.createElement("canvas");
    c.width = 40; c.height = 40;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = true;
    if (g.imageSmoothingQuality) g.imageSmoothingQuality = "high";
    const off = (typeof SHEET_OFFSET !== "undefined" && SHEET_OFFSET[sheet]) || { ox: 0, oy: 0 };
    g.drawImage(IMGS[sheet], extra.sx + off.ox, extra.sy + off.oy, extra.sw, extra.sh, 0, 0, 40, 40);
    iconImgs[type] = c;
  }
}
// Callers (2):
//  gameplay/input.js:156 gameplay/world.js:541
function openWorldMap() {
  // world map locked until Newhaven (Phase 7 item 6): all entry points (M
  // key input.js, #mapbtn below) funnel through here, so one guard covers
  // them all.
  if (typeof Tutorial !== "undefined" && Tutorial.active()) {
    log("The wider world will open to you in Newhaven.", "warn");
    return;
  }
  applyMapIconArt();
  populateBiomeDropdown();
  wm.open = true;
  wmSyncOverlayToggles();   // browser form-state restore doesn't fire change
  // while dreaming, the map opens on the door you entered by (dream.js)
  const _wmC = (typeof Dream !== "undefined" && Dream.mapPos && Dream.mapPos()) || player;
  wm.cx = _wmC.x; wm.cy = _wmC.y;
  wmEl.style.display = "block";
  if (world.prewarmMacros) world.prewarmMacros();   // top up the zoomed-out macro set
  wmDraw();
  wm.timer = setInterval(wmDraw, 900);
}
// fill the "Nearest biome…" dropdown once, from the map's biome-name list
function populateBiomeDropdown() {
  const sel = document.getElementById("wm-biome");
  if (!sel || sel.dataset.filled || typeof world === "undefined" || !world.BIOME_NAMES) return;
  for (const name of [...new Set(world.BIOME_NAMES)].sort()) {
    const o = document.createElement("option"); o.value = name; o.textContent = name; sel.appendChild(o);
  }
  sel.dataset.filled = "1";
}
// nearest tile (game-tile coords) whose biome matches `name`, searched outward
// from the player in expanding rings (biomeNameAt is pure noise math — cheap).
function nearestBiomeTile(name) {
  const px = Math.round(player.x), py = Math.round(player.y);
  const stride = 14, maxR = 3000;
  let best = null, bestD = Infinity;
  for (let r = 0; r <= maxR && r < bestD + stride; r += stride) {
    const n = Math.max(1, Math.round(2 * Math.PI * r / stride));
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * i / n;
      const x = Math.round(px + Math.cos(a) * r), y = Math.round(py + Math.sin(a) * r);
      if (world.biomeNameAt(x, y) === name) {
        const d = Math.hypot(x - px, y - py);
        if (d < bestD) { bestD = d; best = [x, y]; }
      }
    }
  }
  return best;
}
// Callers (5):
//  gameplay/input.js:156,157 gameplay/world.js:540,541,556
function closeWorldMap() {
  wm.open = false;
  wmEl.style.display = "none";
  wmTip.style.display = "none";
  clearInterval(wm.timer);
}
document.getElementById("wmclose").onclick = closeWorldMap;
document.getElementById("mapbtn").onclick = () => (wm.open ? closeWorldMap() : openWorldMap());
// recenter buttons — Newhaven sits at the world origin (0,0). stopPropagation on
// mousedown keeps wmEl from starting a drag (which, in cheat mode, would teleport
// on mouseup); then recenter and redraw.
function wmCenterOn(x, y) { wm.cx = x; wm.cy = y; clampWmView(); wmDraw(); }
for (const [id, at] of [["wm-newhaven", () => [0, 0]], ["wm-player", () => [player.x, player.y]]]) {
  const b = document.getElementById(id);
  if (!b) continue;
  b.addEventListener("mousedown", e => e.stopPropagation());
  b.addEventListener("click", e => { e.stopPropagation(); const [x, y] = at(); wmCenterOn(x, y); });
}
// overlay toggles — stopPropagation on mousedown so ticking one doesn't
// start a map drag (which, in cheat mode, would teleport on release).
// State persists in localStorage, and openWorldMap re-syncs wm.* from the
// checkboxes every open: browsers restore checkbox state across a reload
// WITHOUT firing change, so the box could look ticked while the overlay
// flag was still false and nothing drew.
const WM_OVERLAY_LS = "taiao_wm_overlays"; // migrated from emberfall_wm_overlays, see js/lskeys-migrate.js
const wmOverlayCbs = [];   // [checkbox element, wm key] pairs
function wmSyncOverlayToggles() { for (const [cb, key] of wmOverlayCbs) wm[key] = cb.checked; }
{
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(WM_OVERLAY_LS)) || {}; } catch (e) { /* fresh */ }
  for (const [cbId, lblId, key] of [["wm-tz", "wm-tz-label", "tz"], ["wm-dn", "wm-dn-label", "dn"], ["wm-wx", "wm-wx-label", "wx"]]) {
    const cb = document.getElementById(cbId);
    if (!cb) continue;
    if (saved[key] != null) cb.checked = !!saved[key];
    wm[key] = cb.checked;
    wmOverlayCbs.push([cb, key]);
    cb.addEventListener("mousedown", e => e.stopPropagation());
    cb.addEventListener("change", e => {
      e.stopPropagation();
      wm[key] = cb.checked;
      const st = {};
      for (const [c, k] of wmOverlayCbs) st[k] = c.checked;
      try { localStorage.setItem(WM_OVERLAY_LS, JSON.stringify(st)); } catch (err) { /* private mode */ }
      wmDraw();
    });
    const lbl = document.getElementById(lblId);
    if (lbl) lbl.addEventListener("mousedown", e => e.stopPropagation());
  }
}
// "Nearest biome…" dropdown — scroll the map to the closest biome of that type
{
  const sel = document.getElementById("wm-biome");
  if (sel) {
    sel.addEventListener("mousedown", e => e.stopPropagation()); // don't start a map drag
    sel.addEventListener("change", e => {
      e.stopPropagation();
      const name = sel.value;
      sel.value = ""; // reset to the "Nearest biome…" label
      if (!name) return;
      const tile = nearestBiomeTile(name);
      if (tile) { wmCenterOn(tile[0], tile[1]); log(`Nearest ${name}: ${tile[0]}, ${tile[1]}.`, "sys"); }
      else log(`No ${name} found within range.`, "warn");
    });
  }
}
wmEl.addEventListener("wheel", e => {
  e.preventDefault();
  // floor matches Map.html's own zoom range (0.05) so cheat mode can actually
  // zoom out far enough to see a huge swath of the world at once
  // 0.2 is the zoom floor, not 0.05: below it roads/buildings/POIs/villages
  // (drawn as a vector overlay on top of the macro terrain, see wmDraw) are
  // still visible but panning is the same view just smaller — there's no
  // additional simplification tier past this, so "zoomed all the way out"
  // never looks different in kind from any other zoom, only in scale.
  wm.zoom = Math.min(20, Math.max(0.2, wm.zoom * (e.deltaY > 0 ? 0.85 : 1.18)));
  clampWmView();
  wmWheelT = performance.now();   // defer the overlay-composite repaint (wmDraw)
  wmScheduleDraw();
}, { passive: false });
wmEl.addEventListener("mousedown", e => { wm.drag = { x: e.clientX, y: e.clientY, cx: wm.cx, cy: wm.cy, moved: false }; });
window.addEventListener("mouseup", () => { wm.drag = null; });
// cheat-mode teleport is DOUBLE-click on the map (single click / drag just pans),
// so an accidental click never yanks you across the world
wmCanvas.addEventListener("dblclick", e => {
  if (!DEV_MODE) return;
  const r = wmCanvas.getBoundingClientRect();
  const wx = Math.round((e.clientX - r.left - wmCanvas.clientWidth / 2) / wm.zoom + wm.cx);
  const wy = Math.round((e.clientY - r.top - wmCanvas.clientHeight / 2) / wm.zoom + wm.cy);
  player.x = wx; player.y = wy;
  player.moving = null; player.act = null;
  closeWorldMap();
  world.getChunk(Math.floor(wx / world.CHUNK), Math.floor(wy / world.CHUNK));
});
wmEl.addEventListener("mousemove", e => {
  // live cursor coordinate readout (game-tile coords), shown for any position
  if (wmCoords) {
    const rc = wmCanvas.getBoundingClientRect();
    const cxp = Math.round((e.clientX - rc.left - wmCanvas.clientWidth / 2) / wm.zoom + wm.cx);
    const cyp = Math.round((e.clientY - rc.top - wmCanvas.clientHeight / 2) / wm.zoom + wm.cy);
    wmCoords.textContent = `${cxp}, ${cyp}`;
  }
  if (wm.drag) {
    const dx = e.clientX - wm.drag.x, dy = e.clientY - wm.drag.y;
    if (Math.hypot(dx, dy) > 4) wm.drag.moved = true;
    wm.cx = wm.drag.cx - dx / wm.zoom;
    wm.cy = wm.drag.cy - dy / wm.zoom;
    clampWmView();
    wmScheduleDraw();
    return;
  }
  // hover tooltips — show biome, nearby settlements, icons (explored only)
  const r = wmCanvas.getBoundingClientRect();
  const wx = (e.clientX - r.left - wmCanvas.clientWidth / 2) / wm.zoom + wm.cx;
  const wy = (e.clientY - r.top - wmCanvas.clientHeight / 2) / wm.zoom + wm.cy;
  if (!DEV_MODE && !inSeen(wx, wy)) { wmTip.style.display = "none"; return; }
  // wx/wy in game tiles; Map.html coords = /2
  const mx = wx / 2, my = wy / 2;
  const labels = [world.biomeNameAt(wx, wy)];
  const rad = Math.max(4, 12 / wm.zoom);
  for (const ic of world.iconsNearForMap(mx - rad / 2, my - rad / 2, mx + rad / 2, my + rad / 2)) {
    if (Math.hypot(ic.x * 2 - wx, ic.y * 2 - wy) < rad) {
      const nm = ICON_TYPES[ic.type]?.name;
      if (nm) labels.push(nm);
    }
  }
  for (const v of world.villagesNearForMap(mx - rad * 3, my - rad * 3, mx + rad * 3, my + rad * 3, 0)) {
    if (Math.hypot(v.x * 2 - wx, v.y * 2 - wy) < rad * 3 + (v.R || 0) * 2) labels.push(v.name);
    // station buildings under the cursor: name the trade and its skills (the
    // gold diamonds / coin / blue dot painted on the chunk map images)
    for (const bd of v.buildings || []) {
      if (!bd.job) continue;
      if (wx >= bd.x * 2 - 1 && wx <= (bd.x + bd.w) * 2 + 1 &&
          wy >= bd.y * 2 - 1 && wy <= (bd.y + bd.h) * 2 + 1) {
        for (const j of [bd.job, bd.job2]) {
          if (!j) continue;
          const st = typeof STATIONS !== "undefined" && STATIONS[j];
          const nm = st ? st.name : j === "trader" ? "Trader" : j;
          const sk = st ? wmStationSkills(j) : [];
          labels.push(nm + (sk.length ? " — " + sk.join(", ") : ""));
        }
      }
    }
  }
  wmTip.style.display = "block";
  wmTip.style.left = (e.clientX - r.left + 14) + "px";
  wmTip.style.top = (e.clientY - r.top + 8) + "px";
  wmTip.textContent = [...new Set(labels)].join(" · ");
});

// ---------- camera zoom ----------
// Callers (1):
//  main.js:39
function updateZoom(dt) {
  // retired prototype renderer: ↑/↓ tilt the camera (see LC3D.frame); zoom is wheel-only.
  if (typeof LC3D !== "undefined" && REN === LC3D) return;
  if (keys.ArrowUp) camZoom = Math.max(ZOOM_MIN, camZoom - dt * 0.0012);
  if (keys.ArrowDown) camZoom = Math.min(ZOOM_MAX, camZoom + dt * 0.0012);
  // Dream Forest pins the camera from pulling back: the interior's silent
  // glade swaps are invisible only while the identical stamp covers the whole
  // screen (gameplay/dream.js — the invisibility contract).
  if (typeof Dream !== "undefined" && Dream.inside() != null && camZoom > Dream.zoomMax) camZoom = Dream.zoomMax;
}
gamecol.addEventListener("wheel", e => {
  // let the character selector, skill guide and trade window scroll natively
  // instead of zooming the camera
  if (typeof CharSelect !== "undefined" && CharSelect.isOpen) return;
  if (document.getElementById("skillguide")?.classList.contains("open")) return;
  if (document.getElementById("trade")?.classList.contains("open")) return;
  if (document.getElementById("bestiary")?.classList.contains("open")) return;
  if (typeof ObjEdit !== "undefined" && ObjEdit.isOpen()) return;
  e.preventDefault();
  // smooth trackpad-friendly zoom: proportional to scroll delta
  camZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, camZoom + Math.max(-0.25, Math.min(0.25, e.deltaY * 0.0025))));
}, { passive: false });

// ---------- terrain info bar ----------
let _tbPx = null, _tbPy = null, _tbTmp = 0, _tbBiome = "";
// Callers (1):
//  gameplay/world.js:641
function updateTerrainBar() {
  if (!world) return;
  const px = player.x, py = player.y;
  // POSITION fields (terrain/biome/lat) only change when you step to a new tile,
  // so they stay gated; the TIME fields (clock/sky/temp/zone) below update EVERY
  // frame so the clock keeps ticking while you stand still.
  if (px !== _tbPx || py !== _tbPy) {
    _tbPx = px; _tbPy = py;
    const h   = world.heightAt(px, py);
    const hum = world.humidityAt(px, py);
    _tbTmp = world.temperatureAt(px, py);
    _tbBiome = world.biomeNameAt(px, py);
    // while dreaming, X,Y reports the position the world BELIEVES you're at
    // (near the door you entered by — gameplay/dream.js mapPos); the raw
    // interior coordinates would give the whole trick away in one glance
    const _ap = (typeof Dream !== "undefined" && Dream.mapPos && Dream.mapPos()) || null;
    document.getElementById('t-xy').textContent    = _ap ? `${_ap.x}, ${_ap.y}` : `${px}, ${py}`;
    document.getElementById('t-biome').textContent = _tbBiome;
    // Altitude: 0% at sea level (LAND_E), +100% at max peak; negative = depth
    const LE = world.LAND_ELEVATION;
    const altPct = h < LE
      ? -Math.round((LE - h) / LE * 100)
      : Math.round((h - LE) / (1 - LE) * 100);
    document.getElementById('t-alt').textContent   = (altPct > 0 ? '+' : '') + altPct + '%';
    // Latitude as a DAYLIGHT percentage: 100% = fullday pole, 50% = equator,
    // 0% = fullnight pole (dayFraction is exactly this — the daytime fraction).
    const latEl = document.getElementById('t-lat');
    latEl.textContent = ((typeof dayFraction === 'function') ? Math.round(dayFraction(py) * 100) : 50) + '%';
    latEl.title = '100% = fullday pole · 50% = equator · 0% = fullnight pole';
    document.getElementById('t-hum').textContent   = Math.round(hum * 100) + '%';
  }

  // ---- time-dependent fields: refresh every frame (clock ticks when idle) ----
  const L = (typeof daylightNow === 'function') ? daylightNow() : 1;
  // FELT temperature: every biome cools at night (base drop); arid lands shed
  // heat far faster, deserts most of all. base temperature (world-gen) unchanged.
  const DROP = { "Desert": 0.5, "Red Desert": 0.5, "Salt Flats": 0.42, "Badlands": 0.36, "Canyon": 0.32, "Savanna": 0.3, "Steppe": 0.26, "Oasis": 0.32 };
  const felt = Math.max(0, (_tbTmp || 0) - (1 - L) * (DROP[_tbBiome] || 0.16));
  document.getElementById('t-tmp').textContent   = Math.round(felt * 100) + '%';
  // Pressure ticks with the WEATHER: altitude baseline (50% = 1 atm at sea
  // level, thins going up, builds below) × the passing synoptic anomaly — a
  // falling needle means a front/low is rolling in.
  const wNow = (typeof weatherNow === 'function') ? weatherNow() : null;
  const prsEl = document.getElementById('t-prs');
  if (prsEl && typeof pressureAtmAt === 'function') {
    prsEl.textContent = Math.round(pressureAtmAt(px, py) * 100) + '%';
    prsEl.title = '100% = 1 atm at sea level · thins with altitude, builds below sea level · falls as a storm approaches';
  }
  const skyEl = document.getElementById('t-sky');
  if (skyEl && typeof skyLabel === 'function') {
    const icon = L > 0.85 ? '☀️' : L > 0.25 ? '🌅' : '🌙';
    skyEl.textContent = `${icon} ${skyLabel(py)} (${Math.round(L * 100)}%)`;
  }
  const wxEl = document.getElementById('t-wx');
  if (wxEl) wxEl.textContent = ((typeof weatherLabel === 'function') && weatherLabel(wNow)) || 'Clear';
  // wind: meteorological FROM-direction + speed (a "W 9 kn" is a westerly)
  const wnEl = document.getElementById('t-wnd');
  if (wnEl && wNow && wNow.wind && typeof windKn === 'function') {
    const DIRS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];   // toward-octants, y = south
    const oct = Math.round(Math.atan2(wNow.wind.y, wNow.wind.x) / (Math.PI / 4)) & 7;
    wnEl.textContent = DIRS[(oct + 4) & 7] + ' ' + Math.round(windKn(wNow.wind)) + ' kn';
    wnEl.title = 'Wind: direction it blows FROM, speed in knots. Circles anticlockwise round lows, clockwise round highs, over a prevailing westerly.';
  }
  const timeEl = document.getElementById('t-time');
  if (timeEl && typeof clockTime === 'function') timeEl.textContent = clockTime();
  const tzEl = document.getElementById('t-tz');
  if (tzEl && typeof tzZone === 'function') {
    // dreaming: the zone follows the door, agreeing with the held clock (dream.js)
    let _tzx = player.x;
    if (typeof Dream !== "undefined" && Dream.fxX) { const fx = Dream.fxX(_tzx); if (fx != null) _tzx = fx; }
    // wrap the zone into [-11, +12] hours (past the date line +12 rolls to -11)
    const wz = ((tzZone(_tzx) + 11) % 24 + 24) % 24 - 11;
    const sign = (wz > 0 && wz < 12) ? '+' : wz < 0 ? '−' : '±';   // ±12 at the date line, ±0 at Newhaven
    const offStr = `${sign}${Math.abs(wz)}:00`;   // offset vs Newhaven, whole hours
    tzEl.textContent = offStr;
    tzEl.title = wz === 0
      ? 'Origin (Newhaven) timezone. Every 256 tiles east is 1 hour ahead, west 1 hour behind.'
      : `Timezone ${offStr} vs Newhaven (256 tiles E/W = 1 hour).`;
  }
}

// ---------- render ----------
// Callers (4):
//  gameplay/world.js:1,637 main.js:43 render3d.js:638
function render() {
  REN.frame();
  renderMinimap();
  renderCompass();
  updateTerrainBar();
  if (uiDirty) { renderUI(); uiDirty = false; }
}

// ---------- minimap ----------
// Callers (4):
//  gameplay/world.js:647,714,745,750
const mmCanvas = document.getElementById("minimap");
// Callers (12):
//  gameplay/world.js:713,714,715,721,736,737,740,745,747,750,752,753
const mmCtx = mmCanvas.getContext("2d");
// Separate, non-pixelated overlay for icon glyphs only — #minimap is CSS-
// upscaled 1.25x with image-rendering:pixelated (intentional for the crisp
// terrain look), which re-pixelates any flat bitmap art drawn into the same
// buffer no matter how smoothly it's drawn there. This canvas's buffer
// matches its CSS box 1:1, so the browser's normal smooth scaling is all
// that ever touches these icons.
const mmIconCanvas = document.getElementById("minimap-icons");
const mmIconCtx = mmIconCanvas.getContext("2d");
let mmBase = null;

// ---------- compass ----------
// camYaw (radians, global from main/state.js, kept live by both renderers)
// is the camera's rotation around the player; a dial drawn with N at the top
// in its rest pose and rotated by exactly camYaw radians (canvas rotate() is
// clockwise for +angle, matching how ArrowRight turns the camera) lands each
// letter at the compass direction currently shown at the top of the screen.
const compassCanvas = document.getElementById("compass");
const compassCtx = compassCanvas && compassCanvas.getContext("2d");
function renderCompass() {
  if (!compassCtx) return;
  // HiDPI backing store (see wmDraw()'s identical comment) — only resized
  // when it's actually stale, since a canvas resize forces a full context
  // reset even at this tiny 44x44 size, and this runs every frame.
  const w = compassCanvas.clientWidth, h = compassCanvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (compassCanvas.width !== bw || compassCanvas.height !== bh) {
    compassCanvas.width = bw; compassCanvas.height = bh;
  }
  compassCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 3;
  compassCtx.clearRect(0, 0, w, h);
  compassCtx.save();
  compassCtx.translate(cx, cy);
  // the Dream Forest's quarter-turn lie rides on top of the camera yaw — the
  // dial still looks perfectly ordinary, it just isn't telling the truth
  // (gameplay/dream.js; eased so slowly the turn itself is unwatchable)
  compassCtx.rotate((camYaw || 0) + ((typeof Dream !== "undefined" && Dream.yawLie) ? Dream.yawLie() : 0));
  compassCtx.font = "bold 11px OpenDyslexic, Arial, sans-serif";
  compassCtx.textAlign = "center";
  compassCtx.textBaseline = "middle";
  for (const [label, ang, col] of [["N", 0, "#ff5e5e"], ["E", Math.PI / 2, "#cfc7dd"],
                                    ["S", Math.PI, "#cfc7dd"], ["W", -Math.PI / 2, "#cfc7dd"]]) {
    compassCtx.fillStyle = col;
    compassCtx.fillText(label, Math.sin(ang) * (r - 7), -Math.cos(ang) * (r - 7));
  }
  compassCtx.restore();
}
// Callers (1):
//  gameplay/world.js:677
const MM_COLORS = {
  water: "#3c7c9e", water2: "#3c7c9e", grass: "#5f9e3c", grass2: "#569233",
  sand: "#d8c88f", sand2: "#d0c087", dirt: "#a3773f", dirt2: "#997038",
  stone: "#8f8f9c", stone2: "#86868f", gravel: "#7c7c88", farm: "#b06a2c",
  floor_wood: "#8a6a48", floor_stone: "#8a8a96",
  g_snow: "#e8eaec", g_glacier: "#b0c8dc", g_volcano: "#c04010", g_ash: "#484848",
  g_crystal: "#7040a8", g_canyon: "#904028",
  // biome grounds (colors from the Endless Scape map palette)
  g_snow: "#dee1e4", g_glacier: "#cadae6", g_tundra: "#969f8a", g_taiga: "#587058",
  g_ash: "#5e5a56", g_moor: "#76666c", g_salt: "#dcdace", g_reddes: "#ba6a3c",
  g_canyon: "#aa6c44", g_mush: "#706278", g_bone: "#b6ae98", g_dream: "#5c7c74",
  g_crystal: "#988eaa", g_volcano: "#383230", g_wild: "#60584c", g_jungle: "#2c5a28",
  g_swamp: "#5e6a48", g_ruins: "#888270",
  g_forest: "#2a5218", g_forest2: "#3a6825", g_moss: "#263e1e",
  g_sand_wet: "#b0a070", g_croprow: "#7a4018",
};
// dynamic minimap: a window of the infinite world centered on the player,
// composed from per-chunk mini-canvases cached on the chunk objects
// Callers (3):
//  gameplay/world.js:712,716,753
// SQUARE window (2px per tile) so the minimap can rotate with the camera and
// always cover the 4:3 viewport under the camera's 90° steps. The wrap crops it
// to the visible 240x180 box; the extra rows top/bottom are the rotation margin.
const MM_TILES_W = 112, MM_TILES_H = 112; // window size in tiles (2px per tile)
// px per tile in the icon layer (vs. 2px/tile on the terrain layer). Recomputed
// each rebuild from the icon canvas's live CSS width so icons stay aligned with
// the terrain at any minimap size (see renderMinimap).
let MM_ICON_SCALE = mmIconCanvas.width / MM_TILES_W;
// Callers (1):
//  gameplay/world.js:640
// Static minimap layers (chunk map images + node dots/icons) composited onto
// an offscreen base canvas, rebuilt only when the view scrolls (player tile
// change) or every 800ms (to pick up freshly cached chunk images and node
// respawns). Per-frame work is then one drawImage + the moving dots.
// Uses renderMapChunkCached — the SYNCHRONOUS renderMapChunk here used to
// paint city chunks inline on cache misses (up to ~200ms a frame: the "bank
// is laggy" freeze, since banks sit in the most map-expensive tiles).
let _mmBase = null, _mmBaseCtx = null, _mmBaseKey = "", _mmBaseAt = 0;
function renderMinimap() {
  const CS = world.CHUNK;
  const ox = player.x - MM_TILES_W / 2, oy = player.y - MM_TILES_H / 2; // top-left tile
  if (!_mmBase) {
    _mmBase = document.createElement("canvas");
    _mmBase.width = mmCanvas.width; _mmBase.height = mmCanvas.height;
    _mmBaseCtx = _mmBase.getContext("2d");
  }
  const baseKey = player.x + "," + player.y;
  if (baseKey !== _mmBaseKey || now - _mmBaseAt > 800) {
    _mmBaseKey = baseKey; _mmBaseAt = now;
    const b = _mmBaseCtx;
    b.fillStyle = "#000";
    b.fillRect(0, 0, _mmBase.width, _mmBase.height);
    b.imageSmoothingEnabled = false;
    // HiDPI backing store for the icon overlay (same treatment as wmDraw and
    // renderCompass): without it, a Retina display upscales the 1:1 buffer
    // 2x and re-pixelates the smooth icon art. Drawing happens in CSS-pixel
    // coordinates via the dpr transform. Recompute MM_ICON_SCALE from the live
    // CSS width so icons stay aligned with the terrain at any minimap size.
    const mmw = mmIconCanvas.clientWidth || 364, mmh = mmIconCanvas.clientHeight || 364;
    MM_ICON_SCALE = mmw / MM_TILES_W;
    const mdpr = Math.min(window.devicePixelRatio || 1, 2);
    const mbw = Math.round(mmw * mdpr), mbh = Math.round(mmh * mdpr);
    if (mmIconCanvas.width !== mbw || mmIconCanvas.height !== mbh) {
      mmIconCanvas.style.width = mmw + "px";
      mmIconCanvas.style.height = mmh + "px";
      mmIconCanvas.width = mbw;
      mmIconCanvas.height = mbh;
    }
    mmIconCtx.setTransform(mdpr, 0, 0, mdpr, 0, 0);
    mmIconCtx.imageSmoothingEnabled = true;
    if (mmIconCtx.imageSmoothingQuality) mmIconCtx.imageSmoothingQuality = "high";
    mmIconCtx.clearRect(0, 0, mmw, mmh);
    const c0x = Math.floor(ox / CS), c1x = Math.floor((ox + MM_TILES_W) / CS);
    const c0y = Math.floor(oy / CS), c1y = Math.floor((oy + MM_TILES_H) / CS);
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        if (!seenChunks.has(`${cx},${cy}`)) continue;
        const img = world.renderMapChunkCached(cx, cy); // null = still rendering in the background
        if (img) b.drawImage(img, (cx * CS - ox) * 2, (cy * CS - oy) * 2, CS * 2, CS * 2);
      }
    // resource nodes from loaded chunks
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) {
        if (!world.chunks.has(`${cx},${cy}`)) continue;
        const ch = world.getChunk(cx, cy);
        for (const n of ch.nodes) {
          const nx = (n.x - ox) * 2, ny = (n.y - oy) * 2;
          // banks/shops/stations get the same small icon glyph as the world map,
          // instead of a plain dot, so they're actually identifiable at a glance.
          // Drawn on the separate mmIconCtx overlay (see its declaration above) —
          // not `b` — so the icon art isn't subject to #minimap's pixelated CSS upscale.
          const iconType = n.type === "bank" ? "bank" : n.type === "altar" ? "altar"
            : n.station ? (STATION_ICON[n.type] || null) : null;
          if (iconType && iconImgs[iconType]) {
            const ix = (n.x - ox) * MM_ICON_SCALE, iy = (n.y - oy) * MM_ICON_SCALE, isz = 5 * MM_ICON_SCALE;
            mmIconCtx.drawImage(iconImgs[iconType], ix - isz / 2, iy - isz / 2, isz, isz);
            continue;
          }
          let col;
          if (n.station) col = "#ffd75e";
          else if (!NODE_TYPES[n.type]) continue;
          else if (NODE_TYPES[n.type].skill === "Woodcutting") col = "#1d4d12";
          else if ((/mining$/.test(NODE_TYPES[n.type].skill))) col = "#555";
          else if (NODE_TYPES[n.type].skill === "Foraging") col = "#7a3a8a";
          else col = "#7fd4ff";
          b.fillStyle = col;
          b.fillRect(nx, ny, 2, 2);
        }
      }
    // shopkeepers: a store glyph instead of a plain npc dot, so the shops
    // in a settlement are findable at a glance
    for (const n of world.npcs) {
      if (!n.trader) continue;
      const nx = (n.x - ox) * 2, ny = (n.y - oy) * 2;
      if (nx < -10 || ny < -10 || nx > _mmBase.width + 10 || ny > _mmBase.height + 10) continue;
      if (iconImgs.store) {
        const ix = (n.x - ox) * MM_ICON_SCALE, iy = (n.y - oy) * MM_ICON_SCALE, isz = 5 * MM_ICON_SCALE;
        mmIconCtx.drawImage(iconImgs.store, ix - isz / 2, iy - isz / 2, isz, isz);
      }
    }
  }
  mmCtx.imageSmoothingEnabled = false;
  mmCtx.drawImage(_mmBase, 0, 0);
  mmCtx.fillStyle = "#f00";
  for (const m of monsters) {
    if (!m.alive) continue;
    // window-bounds first: it's pure arithmetic, while inSeen allocates a
    // chunk-key string — with the whole monster array walked every frame,
    // the off-window majority must exit before the allocation
    const mx = (m.x - ox) * 2, my = (m.y - oy) * 2;
    if (mx < 0 || my < 0 || mx >= mmCanvas.width || my >= mmCanvas.height) continue;
    if (!inSeen(m.x, m.y)) continue;
    mmCtx.fillRect(mx, my, 2, 2);
  }
  mmCtx.fillStyle = "#ff0";
  for (const n of world.npcs) {
    if (n.trader) continue; // shopkeepers get a store glyph in the base layer
    const nx = (n.x - ox) * 2, ny = (n.y - oy) * 2;
    if (nx >= 0 && ny >= 0 && nx < mmCanvas.width && ny < mmCanvas.height) mmCtx.fillRect(nx, ny, 2, 2);
  }
  // day/night: darken the minimap too, lit only where there are light sources.
  if (typeof nightState === "function") {
    const ns = nightState();
    if (ns.dark >= 0.03) {
      const mmL = [];
      if (typeof collectNightLights === "function") for (const Lt of collectNightLights()) {
        const tx = Lt.px / (TILE * SCALE), ty = Lt.py / (TILE * SCALE);
        mmL.push({ x: (tx - ox) * 2, y: (ty - oy) * 2, r: Math.max(4, Lt.r * 2), s: Lt.s });
      }
      paintDarkness(mmCtx, mmCanvas.width, mmCanvas.height, ns.dark, mmL, "rgb(2,4,12)");
      // fade the station/store glyph overlay at night too (it's a separate canvas)
      if (mmIconCanvas) mmIconCanvas.style.opacity = String(Math.max(0.12, 1 - ns.dark));
    } else if (mmIconCanvas) {
      mmIconCanvas.style.opacity = "1";
    }
  }
  // player marker stays visible on top of the darkness (you-are-here). It sits
  // at the window centre, so the map's rotation pivots around it.
  mmCtx.fillStyle = "#fff";
  mmCtx.fillRect(MM_TILES_W - 1, MM_TILES_H - 1, 4, 4);
  // Rotate the whole minimap with the camera: both layers spin by camYaw around
  // their shared centre (the player). The camera only snaps to 90° steps, so a
  // square layer always covers the cropped viewport — no empty corners. Kept in
  // sync with the compass, which rotates its dial by the same camYaw.
  // (+ the Dream Forest's compass lie, so minimap and dial agree on the fib)
  const yaw = ((typeof camYaw === "number") ? camYaw : 0) +
    ((typeof Dream !== "undefined" && Dream.yawLie) ? Dream.yawLie() : 0);
  if (_mmYaw !== yaw) {
    _mmYaw = yaw;
    const tf = `translate(-50%,-50%) rotate(${yaw}rad)`;
    mmCanvas.style.transform = tf;
    mmIconCanvas.style.transform = tf;
  }
}
let _mmYaw = null;
