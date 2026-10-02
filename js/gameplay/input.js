// ===== Our RPG — mouse, keyboard, target picking, and context menus =====
"use strict";

// ---------- input ----------
// Callers (3):
//  gameplay/input.js:67,79,113
function canvasTile(e) {
  return REN.pickTile(e);
}

// Callers (1):
//  gameplay/input.js:31
function obstaclesAt(x, y) {
  return world.obstacles.filter(o => o.x === x && o.y === y);
}
// Callers (1):
//  gameplay/input.js:32
function pickObstacle(obs) {
  // choose the crossing that leads away from the player
  let best = obs[0], bd = -1;
  for (const o of obs) {
    const end = o.path[o.path.length - 1];
    const d = Math.hypot(end[0] - player.x, end[1] - player.y);
    if (d > bd) { bd = d; best = o; }
  }
  return best;
}

// Callers (3):
//  gameplay/input.js:69,81,115
function targetsAt(x, y) {
  const out = [];
  // doors, gates & ladders (multi-storey buildings — retired prototype port)
  const door = world.doorAt && world.doorAt(x, y);
  if (door) out.push({ kind: "door", door });
  const bld = world.insideBuilding && world.insideBuilding(x, y);
  if (bld) {
    const bm = world.buildingMeta(bld);
    // a building may carry several ladders (Great Labyrinth: one per vertical
    // maze edge, each spanning ONE storey pair ld.s -> ld.s+1); ordinary
    // houses have a single ladder running the full height
    const lds = bm.ladders || (bm.ladder ? [bm.ladder] : []);
    const lv = player.level | 0;
    for (const ld of lds) {
      if (ld.x !== x || ld.y !== y) continue;
      const s0 = ld.s != null ? ld.s : 0;
      const s1 = ld.s != null ? ld.s + 1 : bm.storeys - 1;
      if (lv >= s0 && lv < s1) out.push({ kind: "ladder", b: bld, m: bm, ld, dir: 1 });
      if (lv > s0 && lv <= s1) out.push({ kind: "ladder", b: bld, m: bm, ld, dir: -1 });
    }
  }
  // Sigrid's spare bed (Tūhura Isle finale, gameplay/tutorial.js) — a
  // narrowly-scoped one-off "Sleep" interaction, not a general bed feature
  if (typeof Tutorial !== "undefined" && Tutorial.sigridSpareBedAt && Tutorial.sigridSpareBedAt(x, y, player.level | 0))
    out.push({ kind: "sigridBed", x, y });
  // monsters live on the ground floor; an upstairs player can't target one below
  let m = monsters.find(m => m.alive && !m.dormant && (m.level | 0) === (player.level | 0) &&
    ((m.moving && m.moving.tx === x && m.moving.ty === y) || (m.x === x && m.y === y)));
  // a bird perched/flying above a tree can't be melee'd anyway (combat.js
  // refuses it), so without a bow equipped it shouldn't eclipse the tree
  // it's sitting in as the click target — chop/examine the tree instead
  // (user req 2026-09-16)
  if (m && typeof birdAirborne === "function" && birdAirborne(m)) {
    const w = player.equip.weapon;
    if (!(w && ITEMS[w].bowPower)) m = null;
  }
  if (m) {
    // domestic livestock offers BOTH Tend/Feed (Husbandry) and Attack (Combat).
    // The interaction-mode toggle (sidebar) decides which is listed first — i.e.
    // which sits at the top of the right-click menu AND is the left-click default.
    // Non-livestock monsters only ever offer Attack, so the toggle is a no-op there.
    const live = (typeof isLivestock === "function" && isLivestock(m)) ? { kind: "livestock", mon: m } : null;
    const mon = { kind: "monster", mon: m };
    if (live && window.interactMode === "combat") { out.push(mon); out.push(live); }
    else if (live) { out.push(live); out.push(mon); }
    else out.push(mon);
  }
  // remote players (multiplayer, net/livesync.js): right-click a fellow
  // traveller for Follow / Trade / Give / Feed / Whisper (menu in
  // buildTileMenu). Their current tile or the tile they're stepping onto.
  const rpl = remotePlayerAt(x, y);
  if (rpl) out.push({ kind: "rplayer", rp: rpl });
  // placed furniture & vessels (gameplay/placing.js). The vessel you're RIDING
  // becomes a "riding" target (click it to disembark) rather than being hidden.
  const pl = typeof placedAt === "function" && placedAt(x, y, player.level | 0);
  if (pl) {
    const riding = typeof ridingEnt === "function" && ridingEnt();
    out.push({ kind: pl === riding ? "riding" : "placed", ent: pl });
  }
  const npc = world.npcAt(x, y, player.level | 0);   // only NPCs on the player's storey
  if (npc) out.push({ kind: "npc", npc });
  const d = dynNodes.find(d => d.x === x && d.y === y);
  if (d) out.push({ kind: d.type === "unlit_fire" ? "unlitfire" : "dynstation", node: d });
  const obs = obstaclesAt(x, y);
  if (obs.length) out.push({ kind: "obstacle", ob: pickObstacle(obs), obs });
  const n0 = world.nodeAt(x, y);
  const n = n0 && (n0.station || n0.farm || n0.portal || n0.alive !== false) ? n0 : null;
  if (n) out.push({ kind: n.portal ? "portal" : n.station ? "station" : n.farm ? "farm" : "node", node: n });
  const gi = groundItems.find(g => g.x === x && g.y === y && (g.level | 0) === (player.level | 0));
  if (gi) out.push({ kind: "ground", item: gi });
  return out;
}

// a remote player standing on (or mid-step onto) this tile, on our storey
function remotePlayerAt(x, y) {
  if (typeof Live === "undefined" || !Live.players || !Live.players.size) return null;
  for (const rp of Live.players.values()) {
    if ((rp.level | 0) !== (player.level | 0)) continue;
    if ((rp.x === x && rp.y === y) || (rp.moving && rp.moving.tx === x && rp.moving.ty === y)) return rp;
  }
  return null;
}

// Callers (2):
//  gameplay/input.js:71,118
function hoverLabel(tg) {
  if (tg.kind === "rplayer") return `Follow ${tg.rp.name} (lvl ${tg.rp.clvl || "?"})`;
  if (tg.kind === "livestock") return (typeof husbLabel === "function" && husbLabel(tg.mon)) || `Tend ${MONSTERS[tg.mon.kind].name}`;
  if (tg.kind === "monster") {
    const def = MONSTERS[tg.mon.kind];
    const nm = (typeof monName === "function") ? monName(tg.mon) : def.name;
    return `Attack ${nm} (level ${def.lvl})`;
  }
  if (tg.kind === "npc") {
    if (tg.npc.trader && typeof shopClosed === "function" && shopClosed(tg.npc)) return `${tg.npc.name} (shop closed)`;
    if (!tg.npc.trader && typeof npcAsleep === "function" && npcAsleep(tg.npc)) return `${tg.npc.name} (asleep)`;
    if (tg.npc._questGiver) return `✦ Talk to ${tg.npc.name} (quest)`;
    return `${tg.npc.trader ? "Trade with" : "Talk to"} ${tg.npc.name}`;
  }
  if (tg.kind === "door") {
    const what = tg.door.kind === "gate" ? "gate" : "door";
    if (world.isDoorOpen(tg.door.x, tg.door.y)) return `Close ${what}`;
    return `${typeof doorLocked === "function" && doorLocked(tg.door) ? "Unlock" : "Open"} ${what}`;
  }
  if (tg.kind === "ladder") return tg.dir > 0 ? "Climb-up ladder" : "Climb-down ladder";
  if (tg.kind === "sigridBed") return "Sleep";
  if (tg.kind === "riding") return `Disembark ${ITEMS[tg.ent.id].name}`;
  if (tg.kind === "placed")
    return ITEMS[tg.ent.id].ride ? `Board ${ITEMS[tg.ent.id].name}` : `Pick up ${ITEMS[tg.ent.id].name}`;
  if (tg.kind === "unlitfire") return "Light fire";
  if (tg.kind === "dynstation") return "Cook at fire";
  if (tg.kind === "obstacle") return `Cross ${tg.ob.name} (Agility ${tg.ob.req})`;
  if (tg.kind === "portal") return portalAttuned(tg.node) ? "Enter Ancient portal" : "Attune Ancient portal";
  if (tg.kind === "station") return `${STATIONS[tg.node.type].action} at ${STATIONS[tg.node.type].name}`;
  if (tg.kind === "farm") {
    const n = tg.node;
    if (!n.crop) return n.tilled === false ? "Till soil" : `Plant ${n.skill ? n.skill + " " : ""}seeds`;
    const crop = CROPS[n.crop.kind];
    const mature = now >= n.crop.plantedAt + crop.time;
    if (crop.tree) return !mature ? "Inspect fruit tree"
      : n.crop.picked ? ((typeof hasTool === "function" && hasTool("watering_can")) ? "Water tree" : "Chop tree")
      : `Harvest ${crop.name}`;
    return mature ? `Harvest ${crop.name}` : `Inspect crop`;
  }
  if (tg.kind === "node") {
    const nt = NODE_TYPES[tg.node.type];
    // Without the tool the node's craft needs (axe/pickaxe/rod…) there's no
    // gather action — hover just names the tree/rock, matching the right-click
    // menu, which omits Chop/Mine too (buildTileMenu). Foraging needs no tool.
    if (typeof hasTool === "function" && !hasTool(nt.tool)) return nt.name;
    const verbs = { Woodcutting: "Chop", Mining: "Mine", "Ore-mining": "Mine",
      "Gem-mining": "Mine", "Stone-mining": "Mine", Fishing: "Fish at", Foraging: "Forage" };
    return `${nt.gatherVerb || verbs[nt.skill] || "Gather"} ${nt.name}`;
  }
  if (tg.kind === "ground") return `Take ${ITEMS[tg.item.id].name}`;
  return "";
}

// Short object name for the "Examine <name>" context-menu label.
function targetName(tg) {
  if (tg.kind === "livestock" || tg.kind === "monster") return (typeof monName === "function") ? monName(tg.mon) : MONSTERS[tg.mon.kind].name;
  if (tg.kind === "npc") return tg.npc.name;
  if (tg.kind === "door") return tg.door.kind === "gate" ? "gate" : "door";
  if (tg.kind === "ladder") return "ladder";
  if (tg.kind === "riding" || tg.kind === "placed") return ITEMS[tg.ent.id].name;
  if (tg.kind === "obstacle") return tg.ob.name;
  if (tg.kind === "ground") return ITEMS[tg.item.id].name;
  if (tg.kind === "portal") return "Ancient portal";
  if (tg.kind === "station") return (typeof STATIONS !== "undefined" && STATIONS[tg.node.type] && STATIONS[tg.node.type].name) || "station";
  if (tg.kind === "farm") { const c = tg.node.crop && CROPS[tg.node.crop.kind]; return c ? c.name : "crop plot"; }
  if (tg.kind === "unlitfire" || tg.kind === "dynstation") return "fire";
  if (tg.node) { const nt = NODE_TYPES[tg.node.type]; return nt ? nt.name : "it"; }
  return "it";
}

canvas.addEventListener("mousemove", e => {
  const t = canvasTile(e);
  if (!world || !world.inMap(t.x, t.y)) { hover = null; setHoverText(""); return; }
  const targets = targetsAt(t.x, t.y);
  hover = { tileX: t.x, tileY: t.y };
  setHoverText(targets.length ? hoverLabel(targets[0]) : "");
});
canvas.addEventListener("mouseleave", () => { hover = null; setHoverText(""); });
// Callers (3):
//  gameplay/input.js:68,71,73
function setHoverText(t) { document.getElementById("hovertext").textContent = t; }

canvas.addEventListener("click", e => {
  hideCtx();
  if (!world) return;
  const t = canvasTile(e);
  if (!world.inMap(t.x, t.y)) return;
  // left-click runs the DEFAULT (first) action of the tile's action menu — the
  // same thing that sits at the top of the right-click menu (Attack / Talk /
  // Gather / Take / …). buildTileMenu always ends with "Walk here", so on empty
  // ground items[0] is that fallback. OPTION/ALT+click QUEUES the action onto
  // this body's task list instead (gameplay/split.js): while felling one tree,
  // option-click the next few and they're chopped in turn the moment the hands
  // go idle — same for harvest rows, rocks, pickups… Queued tiles show a white
  // outline (render3d overlay) until the body gets to them. Option ONLY (user
  // req): Shift is the river brace, never a queue key.
  const items = buildTileMenu(t);
  if (!items.length) return;
  if (e.altKey && typeof Split !== "undefined") { Split.tryQueueClick(items[0]); return; }
  items[0].fn();
});

// Callers (2):
//  gameplay/input.js:82,118
function doTarget(tg) {
  if (tg.kind === "door") setGoal({ type: "door", door: tg.door }, tg.door.x, tg.door.y, 1);
  else if (tg.kind === "ladder") setGoal({ type: "ladder", b: tg.b, m: tg.m, dir: tg.dir },
    (tg.ld || tg.m.ladder).x, (tg.ld || tg.m.ladder).y, 1);
  else if (tg.kind === "sigridBed") setGoal({ type: "sigridSleep" }, tg.x, tg.y, 1);
  else if (tg.kind === "livestock") setGoal({ type: (typeof husbGoalType === "function" ? husbGoalType(tg.mon) : (tg.mon.husbSpent ? "husbFeed" : "husbHarvest")), mon: tg.mon }, tg.mon.x, tg.mon.y, 1);
  else if (tg.kind === "monster") setGoal({ type: "combat", mon: tg.mon }, tg.mon.x, tg.mon.y, styleRange());
  else if (tg.kind === "riding") { if (typeof disembark === "function") disembark(); }
  else if (tg.kind === "placed") {
    const t2 = ITEMS[tg.ent.id].ride ? "board" : "placedPickup";
    // a big hull's anchor sits far out on the water — path to the hull tile
    // nearest the player instead (boarding then teleports aboard)
    const [gx, gy] = ITEMS[tg.ent.id].ride && typeof nearestHullTile === "function"
      ? nearestHullTile(tg.ent, player.x, player.y) : [tg.ent.x, tg.ent.y];
    setGoal({ type: t2, ent: tg.ent }, gx, gy, 1);
  }
  else if (tg.kind === "npc") setGoal({ type: "npc", npc: tg.npc }, tg.npc.x, tg.npc.y, 1);
  else if (tg.kind === "unlitfire") setGoal({ type: "lightFire", node: tg.node }, tg.node.x, tg.node.y, 1);
  else if (tg.kind === "dynstation") setGoal({ type: "station", node: tg.node }, tg.node.x, tg.node.y, (tg.node.wide || 0) + 1);
  else if (tg.kind === "obstacle") setGoal({ type: "obstacle", ob: tg.ob }, tg.ob.x, tg.ob.y, 1);
  // wide stations (3x3 models like the furnace) have their whole footprint
  // blocked, so reach=1 (immediately adjacent) is never satisfiable — widen
  // the reach radius past the footprint instead
  else if (tg.kind === "portal") setGoal({ type: "portal", node: tg.node }, tg.node.x, tg.node.y, 1);
  else if (tg.kind === "station") setGoal({ type: "station", node: tg.node }, tg.node.x, tg.node.y, (tg.node.wide || 0) + 1);
  else if (tg.kind === "farm") setGoal({ type: "farm", node: tg.node }, tg.node.x, tg.node.y, 1);
  else if (tg.kind === "node") setGoal({ type: "gather", node: tg.node }, tg.node.x, tg.node.y, 1);
  else if (tg.kind === "ground") setGoal({ type: "pickup", item: tg.item }, tg.item.x, tg.item.y, 1);
}

// Callers (2):
//  gameplay/input.js:83,130
function walkTo(x, y) {
  // Option/Alt+click queue capture (gameplay/split.js): a bare walk queues too
  if (typeof Split !== "undefined" && Split.capture(null, x, y, passable(x, y) ? 0 : 1)) return;
  if (player.forced) return;
  cancelAction();
  closeModals();
  const p = findPath(x, y, passable(x, y) ? 0 : 1);
  if (p === null) { log("You can't reach that.", "warn"); return; }
  player.path = p;
}

// context menu
// Callers (8):
//  gameplay/input.js:135,139,145,148,149,150,152,153
// ---- interaction-mode toggle (sidebar button): "husbandry" lists Tend/Feed
// first on animals, "combat" lists Attack first. targetsAt() reads it to order
// the livestock/monster targets (menu top + left-click default). Persisted as a
// client preference in localStorage; default husbandry (the old behaviour). ----
window.interactMode = (() => { try { return localStorage.getItem("taiao_interactmode") === "combat" ? "combat" : "husbandry"; } catch (e) { return "husbandry"; } })();
const interactModeBtn = document.getElementById("interactmodebtn");
function syncInteractModeBtn() {
  if (!interactModeBtn) return;
  const combat = window.interactMode === "combat";
  interactModeBtn.textContent = combat ? "Mode: ⚔ Combat" : "Mode: 🌾 Husbandry";
  interactModeBtn.classList.toggle("combat", combat);
  interactModeBtn.classList.toggle("husbandry", !combat);
}
if (interactModeBtn) {
  interactModeBtn.addEventListener("click", () => {
    window.interactMode = window.interactMode === "combat" ? "husbandry" : "combat";
    try { localStorage.setItem("taiao_interactmode", window.interactMode); } catch (e) {}
    syncInteractModeBtn();
    if (typeof log === "function") log(window.interactMode === "combat"
      ? "Interaction mode: Combat — Attack is now the default action on animals."
      : "Interaction mode: Husbandry — Tend/Feed is now the default action on animals.", "sys");
  });
  syncInteractModeBtn();
}

// (The sidebar Character button was removed — the character/appearance chooser
// is reachable only from the isle's first keeper or Newhaven's Registrar now.)
// sidebar Soap button — same as Left-Shift+S (the soaps comparison menu).
{
  const soapBtn = document.getElementById("soapbtn");
  if (soapBtn) soapBtn.addEventListener("click", () => { if (typeof toggleSoapsMenu === "function") toggleSoapsMenu(); });
}

const ctxEl = document.getElementById("ctxmenu");
canvas.addEventListener("contextmenu", e => {
  e.preventDefault();
  if (!world) return;
  const t = canvasTile(e);
  if (!world.inMap(t.x, t.y)) return;
  showCtx(buildTileMenu(t), e.clientX, e.clientY);
});

// The ordered action list for a tile: every interactive target's primary action
// (+ an Examine), then a decoration's Take/Examine, then "Walk here". The FIRST
// entry is the default action — used by both left-click and the right-click menu.
// Callers (2): the click + contextmenu handlers above.
function buildTileMenu(t) {
  const targets = targetsAt(t.x, t.y);
  const items = [];
  const groundHere = groundItems.filter(g => g.x === t.x && g.y === t.y && (g.level | 0) === (player.level | 0));
  for (const tg of targets) {
    if (tg.kind === "ground") continue;   // handled together below (Take All + per-item)
    // a fellow player: the full multiplayer menu. Follow is the default
    // (left-click) action; trading is right-click driven (user req 2026-10-02
    // — invites come from this menu, not a chat-side strip).
    if (tg.kind === "rplayer") {
      const rp = tg.rp;
      items.push({ label: `Follow ${rp.name}`, fn: () => { if (window.Follow) Follow.start(rp.id); } });
      if (typeof Live !== "undefined" && Live.tradeOn())
        items.push({ label: `Trade with ${rp.name}`, fn: () => { if (window.LiveTrade) LiveTrade.invite(rp.id); } });
      items.push({ label: `Give items to ${rp.name}…`, fn: () => { if (window.PlayerActions) PlayerActions.give(rp.id); } });
      items.push({ label: `Feed ${rp.name}…`, fn: () => { if (window.PlayerActions) PlayerActions.feed(rp.id); } });
      items.push({ label: `Whisper ${rp.name}`, fn: () => { if (window.LiveChat) LiveChat.compose("/w " + rp.name + " "); } });
      items.push({ label: `Examine ${rp.name}`, fn: () => log(`${rp.name} — a fellow traveller, combat level ${rp.clvl || "?"}.`, "sys") });
      continue;
    }
    // livestock: one menu entry per unlocked husbandry action (or Feed when spent);
    // left-click runs the first entry. Then an Examine for the animal.
    if (tg.kind === "livestock" && typeof husbMenu === "function") {
      for (const act of husbMenu(tg.mon)) {
        const id = act.id;
        items.push({
          label: act.label, fn: () => {
            if (id === "__feed") setGoal({ type: "husbFeed", mon: tg.mon }, tg.mon.x, tg.mon.y, 1);
            else if (id && id[0] !== "_") setGoal({ type: "husbAction", mon: tg.mon, act: id }, tg.mon.x, tg.mon.y, 1);
            else if (typeof log === "function") log(act.label, "warn");
          },
        });
      }
      const lex = typeof husbExamine === "function" && husbExamine(tg.mon);
      if (lex) items.push({ label: `Examine ${targetName(tg)}`, fn: () => log(lex, "sys") });
      continue;
    }
    // picked-bare Pomiculture fruit tree: WATER it (regrow the fruit) or CHOP it.
    // With a watering can, Water is the default (left-click) so you never fell a
    // tree you're tending by accident; chopping is then a right-click choice.
    if (tg.kind === "farm" && tg.node.crop && CROPS[tg.node.crop.kind] && CROPS[tg.node.crop.kind].tree) {
      const node = tg.node, crop = CROPS[node.crop.kind];
      if (now >= node.crop.plantedAt + crop.time && node.crop.picked) {
        const hasCan = typeof hasTool === "function" && hasTool("watering_can");
        const ready = now >= (node.crop.pickedAt || 0) + respawnFor(crop.req);
        const water = { label: ready ? "Water tree" : "Water tree — resting", fn: () => setGoal({ type: "farmWater", node }, node.x, node.y, 1) };
        const chop = { label: "Chop tree", fn: () => doTarget(tg) };
        if (hasCan) { items.push(water, chop); } else { items.push(chop); }
        items.push({ label: `Examine ${targetName(tg)}`, fn: () => log("A bare fruit tree — water it to regrow the fruit once it's rested, or fell it for logs.", "sys") });
        continue;
      }
    }
    // Skill nodes only offer their gather action when the required tool is
    // carried — no axe hides "Chop", no pickaxe hides "Mine", no rod hides
    // "Fish at" (Foraging has no tool, so berries/herbs stay bare-handed). The
    // Examine line below still shows, so you can always inspect the tree/rock.
    const nodeType = tg.kind === "node" ? NODE_TYPES[tg.node.type] : null;
    if (!(nodeType && typeof hasTool === "function" && !hasTool(nodeType.tool)))
      items.push({ label: hoverLabel(tg), fn: () => doTarget(tg) });
    // heat stations can be stoked with logs (fuels the pilot fire)
    if (tg.kind === "station" && typeof stationIsHeat === "function" && stationIsHeat(tg.node)) {
      const bi = typeof bestLogIndex === "function" ? bestLogIndex() : -1;
      items.push({
        label: bi >= 0 ? `Stoke fire (${stationHeatNow(tg.node)}°)` : "Stoke fire — no logs",
        fn: () => setGoal({ type: "stokeFire", node: tg.node }, tg.node.x, tg.node.y, (tg.node.wide || 0) + 1),
      });
    }
    let exam = null;
    if (tg.kind === "monster") {
      const mkind = tg.mon.kind;
      exam = `It's a ${MONSTERS[mkind].name}, level ${MONSTERS[mkind].lvl}.`;
      if (typeof ProposalOverlay !== "undefined") {
        const u = ProposalOverlay.credit("monster:" + mkind);
        if (u) exam += " Art by @" + u + ".";
        else if (ProposalOverlay.isGapMonster(mkind))
          exam += " Its true form is still unpainted — the Workshop seeks an artist.";
      }
    }
    else if (tg.kind === "npc") exam = (typeof npcAsleep === "function" && npcAsleep(tg.npc)) ? `${tg.npc.name} is fast asleep.`
      : tg.npc.trader ? (typeof shopClosed === "function" && shopClosed(tg.npc) ? "A merchant — shop's shut for the night." : "A merchant. Fair prices, mostly.")
      : `${tg.npc.name}, a villager.`;
    else if (tg.kind === "door") exam = (typeof lockExamine === "function" && lockExamine(tg.door))
      || (tg.door.kind === "gate" ? "Sturdy gates keep the wilds out." : "The door is " + (world.isDoorOpen(tg.door.x, tg.door.y) ? "open." : "closed."));
    else if (tg.kind === "ladder") exam = tg.dir > 0 ? "It leads to the floor above." : "It leads back down.";
    else if (tg.kind === "riding") exam = "You're aboard. Click to step ashore.";
    else if (tg.kind === "unlitfire") {
      exam = "A stack of logs laid ready to burn — strike a spark (bladed weapon + flint) to light it.";
      items.push({ label: `Take back ${ITEMS[tg.node.logId].name.toLowerCase()}`,
        fn: () => setGoal({ type: "pickupFire", node: tg.node }, tg.node.x, tg.node.y, 1) });
    }
    else if (tg.kind === "farm") exam = tg.node.crop ? "Something is growing here."
      : tg.node.tilled === false ? `Untilled ${tg.node.skill || "farm"} soil — break it with a hoe.`
      : `Tilled ${tg.node.skill || "farm"} soil, ready for ${tg.node.skill || "any"} seed.`;
    else if (tg.kind === "placed") {
      exam = EXAMINE[tg.ent.id] || ITEMS[tg.ent.id].name;
      if (typeof ProposalOverlay !== "undefined") {
        const u = ProposalOverlay.credit("item:" + tg.ent.id);
        if (u) exam += " Made by @" + u + " — Our RPG Workshop.";
      }
      if (ITEMS[tg.ent.id].ride)
        items.push({ label: `Pick up ${ITEMS[tg.ent.id].name}`,
          fn: () => {
            const [gx, gy] = typeof nearestHullTile === "function"
              ? nearestHullTile(tg.ent, player.x, player.y) : [tg.ent.x, tg.ent.y];
            setGoal({ type: "placedPickup", ent: tg.ent }, gx, gy, 1);
          } });
    }
    else if (tg.kind === "obstacle") exam = `${tg.ob.name} — a shortcut for the nimble.${tg.ob.fail ? " Lose your footing and you'll take a tumble." : ""} Agility ${tg.ob.req}.`;
    else if (tg.node) {
      const nt2 = NODE_TYPES[tg.node.type];
      exam = NODE_EXAMINE[tg.node.type] || (nt2 ? `${nt2.name}. (${nt2.skill} ${nt2.req})` : null);
    }
    if (exam) items.push({ label: `Examine ${targetName(tg)}`, fn: () => log(exam, "sys") });
  }
  // items lying on the tile: "Take All" first (so left-click grabs everything),
  // then a "Take <item>" line per stack — placed at the FRONT of the menu.
  if (groundHere.length) {
    const g0 = [];
    if (groundHere.length > 1)
      g0.push({ label: `Take All (${groundHere.length} items)`, fn: () => setGoal({ type: "pickupAll", x: t.x, y: t.y }, t.x, t.y, 1) });
    for (const g of groundHere) {
      const nm = (ITEMS[g.id] && ITEMS[g.id].name) || g.id;
      g0.push({ label: `Take ${nm}${g.qty > 1 ? ` (x${g.qty})` : ""}`, fn: () => setGoal({ type: "pickup", item: g }, g.x, g.y, 1) });
    }
    items.unshift(...g0);
  }
  // decorations aren't interactive targets, so they're not in targetsAt — offer
  // Take (pick it up; respawns after 300s) + Examine for whatever decoration
  // sits on this tile. Skipped while the decor is picked (hidden, awaiting return).
  if (world.getDecor && typeof decorExamine === "function") {
    const dk = world.getDecor(t.x, t.y);
    const picked = typeof decorPicked === "function" && decorPicked(t.x, t.y);
    if (dk && !picked) {
      // Lua loc handler (js/lua on_loc) for this world object? Its scripted
      // interaction replaces the default Take and becomes the left-click
      // default (unshifted to the front of the menu).
      if (typeof Lua !== "undefined" && Lua.ready && Lua.hasLoc(dk))
        items.unshift({ label: `Take ${decorName(dk)}`, fn: () => setGoal({ type: "scriptLoc", key: dk.split("#")[0], x: t.x, y: t.y }, t.x, t.y, 1) });
      else if (typeof decorPickable === "function" && decorPickable(dk)) {
        // crowbar-gated salvage (Phase 7 item 5): world decor is fixed in
        // place without one — every "Take <thing>" now runs through a
        // Toolmaking sink instead of a free grab. Same suppression pattern
        // as the hasTool gate on skill-node gather actions above (input.js
        // :362): no tool, no menu entry at all — not even a disabled one.
        // Universal — no tutorial-isle exemption (a fresh, ungraduated
        // character has hasTool("crowbar") === false just like anyone else,
        // so this alone is enough to gate every decoration everywhere).
        const noCrowbar = typeof hasTool === "function" && !hasTool("crowbar");
        if (!noCrowbar)
          items.push({ label: `Take ${decorName(dk)}`, fn: () => setGoal({ type: "decorPick", x: t.x, y: t.y, key: dk }, t.x, t.y, 1) });
      }
      // city plaza fountains double as respawn anchors: "Set respawn point"
      // stores this city; death returns the player here instead of Newhaven
      if (dk.split("#")[0] === "city_fountain") {
        const here = player.respawn && player.respawn.x === t.x && player.respawn.y === t.y;
        if (!here) items.push({ label: "Set respawn point", fn: () => setRespawnAt(t.x, t.y) });
        else items.push({ label: "Clear respawn point (back to Newhaven)", fn: () => { player.respawn = null; log("Respawn point cleared — you'll wake in Newhaven again.", "sys"); saveGame(); } });
      }
      // wells & fountains take wishes — one coin a real day, and they
      // remember (gameplay/eggs.js owns the tally + the responses)
      if (typeof Eggs !== "undefined" && Eggs.wellMenu) {
        const wm = Eggs.wellMenu(dk, t.x, t.y);
        if (wm) items.push(wm);
      }
      if (!items.some(it => it.label.startsWith("Examine "))) {
        // a handful of hashed tiles carry secret examine texts (eggs.js);
        // Eggs.onExamine credits the discovery on the actual click
        const dex = (typeof Eggs !== "undefined" && Eggs.examineOverride && Eggs.examineOverride(dk, t.x, t.y))
          || decorExamine(dk);
        if (dex) items.push({ label: `Examine ${decorName(dk)}`, fn: () => {
          log(dex, "sys");
          if (typeof Eggs !== "undefined" && Eggs.onExamine) Eggs.onExamine(dk, t.x, t.y);
          if (typeof ProposalOverlay !== "undefined") {
            const u = ProposalOverlay.credit("object:" + dk.split("#")[0]);
            if (u) log("Made by @" + u + " — Our RPG Workshop.", "sys");
          }
        } });
      }
    }
  }
  // village lamplighter candles aren't decor tiles (they're conjured per frame
  // from the candle-spot list, daynight.js), but they still Examine: a burning
  // stand in the street, or a household candle glowing indoors.
  if (typeof candleSpotAt === "function" && !items.some(it => it.label.startsWith("Examine "))) {
    const cs = candleSpotAt(t.x, t.y);
    if (cs) {
      const standName = { candlestand_iron: "wrought-iron", candlestand_wood: "turned-wood", candlestand_brass: "polished brass" }[cs.stand];
      const dex = cs.inside
        ? "A household candle burns within, its glow seeping out through shutters and thatch."
        : `A fine wax candle burns atop a ${standName || "sturdy"} stand — set out by the lamplighters at dusk and gathered in again at dawn.`;
      items.push({ label: `Examine ${cs.inside ? "candle" : "candle stand"}`, fn: () => log(dex, "sys") });
    }
  }
  items.push({ label: "Walk here", fn: () => walkTo(t.x, t.y) });
  return items;
}

// Callers (3):
//  gameplay/input.js:131 main/ui.js:77 storage.js:137
function showCtx(items, x, y) {
  ctxEl.innerHTML = "";
  const title = document.createElement("div");
  title.className = "ctxtitle";
  title.textContent = "Choose option";
  ctxEl.appendChild(title);
  for (const it of items) {
    const d = document.createElement("div");
    d.className = "ctxitem";
    d.textContent = it.label;
    d.onclick = () => { hideCtx(); it.fn(); };
    ctxEl.appendChild(d);
  }
  // fixed positioning in viewport coords: show first so offsetWidth/Height
  // are real, then clamp the menu fully on-screen at the pointer
  ctxEl.style.display = "block";
  const mw = ctxEl.offsetWidth || 180, mh = ctxEl.offsetHeight || items.length * 26 + 30;
  ctxEl.style.left = Math.max(0, Math.min(x, window.innerWidth - mw - 2)) + "px";
  ctxEl.style.top = Math.max(0, Math.min(y, window.innerHeight - mh - 2)) + "px";
}
// Callers (3):
//  gameplay/input.js:77,144,153
function hideCtx() { ctxEl.style.display = "none"; }
document.addEventListener("click", e => { if (!ctxEl.contains(e.target)) hideCtx(); });

window.addEventListener("keydown", e => {
  // typing in a text field (e.g. the bank search) must never move the player
  // or trigger hotkeys
  const ae = document.activeElement;
  if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
  if (e.code === "ShiftLeft") keys.ShiftLeft = true;
  // Left-Shift+S opens the Soaps comparison menu (gameplay/stink.js)
  // P toggles the soaps menu. (Was Left-Shift+S — Shift now BRACES against a
  // river current while wading, movement.js, so the chord kept firing mid-river.)
  if ((e.key === "p" || e.key === "P") && typeof toggleSoapsMenu === "function" &&
      !(e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA"))) {
    toggleSoapsMenu(); e.preventDefault(); return;
  }
  if (e.key === "Escape" && typeof soapsMenuOpen === "function" && soapsMenuOpen()) { closeSoapsMenu(); return; }
  // split selves (gameplay/split.js): Tab hops to the next body, X splits
  // (or merges, when standing beside another self)
  if (e.key === "Tab") {
    if (typeof Split !== "undefined") Split.cycle();
    e.preventDefault();
    return;
  }
  if ((e.key === "x" || e.key === "X") && !e.altKey && !e.ctrlKey && !e.metaKey) {
    // ⇧X opens the pack-share window with an adjacent self; plain X splits/merges
    if (typeof Split !== "undefined") { if (e.shiftKey) Split.share(); else Split.splitOrMerge(); }
    e.preventDefault();
    return;
  }
  if (e.key === "m" || e.key === "M") { wm.open ? closeWorldMap() : openWorldMap(); return; }
  // K saves a postcard: a framed snapshot with the place, coordinates and
  // world seed baked in (gameplay/postcard.js). One shared seed means every
  // postcard is a working set of directions for a friend.
  if ((e.key === "k" || e.key === "K") && !e.altKey && !e.ctrlKey && !e.metaKey) {
    if (typeof Postcard !== "undefined") Postcard.captureWorld();
    e.preventDefault();
    return;
  }
  // N notes an odd sound in the bird recordings (a voice, a siren) — logs the
  // playing clips + offsets for the clean-up tool (gameplay/birdsong.js)
  if ((e.key === "n" || e.key === "N") && !e.altKey && !e.ctrlKey && !e.metaKey) {
    if (typeof flagOddSound === "function") flagOddSound();
    e.preventDefault(); // the "n" must not type itself into the note field
    return;
  }
  // C no longer opens the character/appearance chooser at will — you take (or
  // change) a form only by talking to the isle's first keeper or, out in the
  // wide world, Newhaven's Registrar. C still closes the menu if it's open.
  if (e.key === "c" || e.key === "C") {
    if (CharSelect.isOpen) { CharSelect.close(); return; }
    const onIsle = typeof Tutorial !== "undefined" && Tutorial.active && Tutorial.active();
    if (typeof log === "function")
      log(onIsle ? "Speak to the keeper who greets you on the isle to choose your form."
                 : "Seek the Registrar in Newhaven's plaza to take a new form.", "sys");
    return;
  }
  if (e.key === "Escape" && CharSelect.isOpen) { CharSelect.close(); return; }
  if (e.key === "Escape" && wm.open) { closeWorldMap(); return; }
  // retired prototype renderer: hold ←/→ to rotate the camera smoothly through 360°
  // (and ↑/↓ tilt it — handled in LC3D.frame). Fallback renderer keeps the
  // original 90°-step snaps.
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    if (typeof LC3D !== "undefined" && REN === LC3D) keys[e.key] = true;
    else if (!e.repeat) camStep = (camStep + (e.key === "ArrowRight" ? 1 : 3)) & 3;
    e.preventDefault();
    return;
  }
  if (["w", "a", "s", "d", "ArrowUp", "ArrowDown"].includes(e.key)) {
    keys[e.key] = true;
    e.preventDefault();
  }
  // Shift+WASD = combat footwork: back away without dropping the fight
  // (movement.js stepPlayer / combat.js tickCombat)
  if (e.key === "Shift") keys.Shift = true;
});
window.addEventListener("keyup", e => { keys[e.key] = false; if (e.code === "ShiftLeft") keys.ShiftLeft = false; });
