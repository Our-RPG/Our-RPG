// ===== Taiao — pathfinding and queued goals =====
"use strict";

// ---------- pathfinding (infinite grid; keys are "x,y" strings) ----------
// Callers (3):
//  gameplay/input.js:103 gameplay/movement.js:46 gameplay/pathing.js:51
function findPath(tx, ty, reach) {
  const K = (x, y) => x + "," + y;
  const start = K(player.x, player.y);
  const goalOk = (x, y) => Math.max(Math.abs(x - tx), Math.abs(y - ty)) <= reach;
  if (goalOk(player.x, player.y)) return [];
  // don't explore absurd distances in one click
  if (Math.max(Math.abs(tx - player.x), Math.abs(ty - player.y)) > 80) return null;
  const open = [[0, player.x, player.y]], came = new Map(), g = new Map([[start, 0]]);
  const h = (x, y) => Math.max(Math.abs(x - tx), Math.abs(y - ty));
  let found = null, iter = 0;
  while (open.length && iter++ < 9000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, cx, cy] = open.splice(bi, 1)[0];
    if (goalOk(cx, cy)) { found = K(cx, cy); break; }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (!passable(nx, ny)) continue;
      if (dx && dy && (!passable(nx, cy) || !passable(cx, ny))) continue;
      if (!stepClimbOK(cx, cy, nx, ny)) continue; // terraces: no climbing >½ step
      const nk = K(nx, ny);
      const ng = g.get(K(cx, cy)) + (dx && dy ? 1.42 : 1);
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng); came.set(nk, K(cx, cy) + ";" + cx + ";" + cy);
        open.push([ng + h(nx, ny), nx, ny]);
      }
    }
  }
  if (found === null) return null;
  const path = [];
  let cur = found;
  while (cur !== start) {
    const [x, y] = cur.split(",").map(Number);
    path.unshift({ x, y });
    cur = came.get(cur).split(";")[0];
  }
  return path;
}

// ---------- goals ----------
// Callers (5):
//  gameplay/input.js:101 gameplay/movement.js:37 gameplay/pathing.js:49 skills/agility.js:6
//  skills/combat.js:112
function cancelAction() { player.act = null; player.goal = null; }

// Callers (11):
//  gameplay/input.js:87,88,89,90,91,92,93,94,95,96 skills/combat.js:128
function setGoal(goal, tx, ty, reach) {
  // Shift+click queue capture (gameplay/split.js): the goal is appended to
  // the current body's task queue instead of being pursued now
  if (typeof Split !== "undefined" && Split.capture(goal, tx, ty, reach)) return;
  if (player.forced) return;
  cancelAction();
  closeModals();
  const path = findPath(tx, ty, reach);
  if (path === null) { log("You can't reach that.", "warn"); return; }
  player.path = path;
  player.goal = { ...goal, tx, ty, reach };
  if (path.length === 0) executeGoal();
}

// Callers (1):
//  gameplay/movement.js:26
function goalInReach() {
  const g = player.goal;
  return g && Math.max(Math.abs(player.x - g.tx), Math.abs(player.y - g.ty)) <= g.reach;
}

// Callers (2):
//  gameplay/movement.js:26 gameplay/pathing.js:55
function executeGoal() {
  const goal = player.goal;
  player.goal = null;
  if (!goal) return;
  if (goal.type === "gather") startGather(goal.node);
  else if (goal.type === "combat") startCombat(goal.mon);
  else if (goal.type === "station") openStation(goal.node);
  else if (goal.type === "stokeFire") stokeFire(goal.node);
  else if (goal.type === "npc") talkTo(goal.npc || world.npcs[0]);
  else if (goal.type === "pickup") pickUp(goal.item);
  else if (goal.type === "pickupAll") pickUpAll(goal.x, goal.y);
  else if (goal.type === "farm") useFarmPlot(goal.node);
  else if (goal.type === "farmWater") waterFruitTree(goal.node);
  else if (goal.type === "lightFire") lightPlacedFire(goal.node);
  else if (goal.type === "pickupFire") pickUpUnlitFire(goal.node);
  else if (goal.type === "sigridSleep") { if (typeof Tutorial !== "undefined" && Tutorial.sleepAtSigrids) Tutorial.sleepAtSigrids(); }
  else if (goal.type === "obstacle") useObstacle(goal.ob);
  else if (goal.type === "door") useDoor(goal.door);
  else if (goal.type === "ladder") useLadder(goal.b, goal.m, goal.dir);
  else if (goal.type === "portal") usePortal(goal.node);
  else if (goal.type === "placedPickup") pickUpPlaced(goal.ent);
  else if (goal.type === "board") boardVessel(goal.ent);
  else if (goal.type === "decorPick") {
    // crowbar-gated salvage (Phase 7 item 5), belt-and-braces: the menu
    // entry already hides "Take" when ungated, but check again here too
    // (the tool could be dropped mid-walk) before the pickup actually
    // fires. Universal — no tutorial-isle exemption.
    const noCrowbar = typeof hasTool === "function" && !hasTool("crowbar");
    if (noCrowbar) log("It's fixed in place. A crowbar would pry it loose — forge one at an anvil (Toolmaking 15).", "warn");
    else pickUpDecor(goal.x, goal.y, goal.key);
  }
  else if (goal.type === "scriptLoc") { if (typeof Lua !== "undefined" && Lua.ready) Lua.runLoc(goal.key, goal.x, goal.y); }
  // start CONTINUOUS tending — tickHusb keeps tending each tick until the animal
  // is depleted (husbSpent), then stops. nextAt:now → first tend fires at once.
  else if (goal.type === "husbAction") player.act = { kind: "husb", mon: goal.mon, actId: goal.act, nextAt: now };
  else if (goal.type === "husbFeed") husbDoFeed(goal.mon);
  else if (goal.type === "husbHarvest") husbHarvest(goal.mon); // back-compat
}
