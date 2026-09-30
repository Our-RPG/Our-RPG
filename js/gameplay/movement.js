// ===== Taiao — player movement =====
"use strict";

// 8-way facing from a tile delta — dir8From() lives in gameplay/monsters.js
// (both files share the concatenated bundle scope; that single definition
// serves every caller here).

// The 8 unit tile deltas in CHAR_DIRS order (south, south-east, east, ... clockwise).
// Callers (1): gameplay/movement.js (camera-relative WASD)
const DIR8_DELTA = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
// Rotate a WASD input delta by the camera step so "up" is always away from the
// camera. Each 90° camera step = 2 positions on the 8-way grid. (If movement feels
// mirrored to the view, flip the sign on camStep here.)
function rotInputByCam(dx, dy) {
  if (!dx && !dy) return [0, 0];   // no input -> no move (don't depend on dir8From, which
  const i = DIR8_DELTA.findIndex(([a, b]) => a === Math.sign(dx) && b === Math.sign(dy));
  if (i < 0) return [dx, dy];      // is overridden elsewhere and returns non-null for (0,0))
  // free 360° camera (LC3D) rotates input by the nearest 45°; the fallback
  // renderer keeps its 90° camera steps.
  const steps = (typeof LC_CAM_ROT8 !== "undefined" && typeof LC3D !== "undefined" && REN === LC3D)
    ? LC_CAM_ROT8 : camStep * 2;
  return DIR8_DELTA[(i + steps) & 7];
}

// ---------- update: movement ----------
// Drowning: wading with the waterline past mouth and nose drains air (one
// bubble a second); at zero the deep takes all remaining HP. Surfacing —
// or cheat mode, which breathes underwater — refills instantly.
// Sums the diving bonuses of every equipped item so any gear can help:
//  diveReach — raises the drowning waterline (wade/dive deeper): summed
//  diveDrain — air-drain multiplier once under (lower = better): the best (min)
//  diveAir   — extra bubbles of reserve air: summed (see airMaxNow)
// The snorkel sets diveReach=SNORKEL_REACH, diveDrain=0.5 (potteryglass.js), so
// snorkel-only behaviour is byte-identical to before this refactor. The rubber
// rebreather/waders (skills/rubbermaking.js) stack on top.
function diveGear() {
  let reach = 0, drain = 1, air = 0;
  if (player.equip) for (const slot in player.equip) {
    const e = player.equip[slot]; if (!e) continue;
    const d = ITEMS[typeof e === "string" ? e : e.id]; if (!d) continue;
    if (d.diveReach) reach += d.diveReach;
    if (d.diveDrain != null) drain = Math.min(drain, d.diveDrain);
    if (d.diveAir) air += d.diveAir;
  }
  return { reach, drain, air };
}
function airMaxNow() { return AIR_MAX + diveGear().air; }
function tickAir(dt) {
  const g = diveGear();
  const amax = AIR_MAX + g.air;
  if (player.air === undefined || player.air > amax) player.air = amax;
  // a taller character's nose sits higher, so they wade deeper before the
  // waterline reaches it (character-stats.js height scales MOUTH_Y).
  const mouthY = MOUTH_Y * (typeof charHeightMul === "function" ? charHeightMul() : 1) + g.reach;
  if (!DEV_MODE && playerSinkY() > mouthY) {
    player.air -= dt / 1000 * g.drain;
    if (player.air <= 0) {
      player.air = amax;
      const dmg = player.hp;
      player.hp = 0;
      addSplat(player, dmg);
      playerDie("deep");
    }
  } else player.air = amax;
}
// Callers (1):
//  main.js:38
function stepPlayer(dt) {
  // ghost ticks (gameplay/split.js): while an INACTIVE split body is swapped
  // in, the live keyboard belongs to the active body only — read a dead map
  const K = (typeof Split !== "undefined" && Split.isGhost()) ? {} : keys;
  // dead but not yet respawned: hold everything still so the killing blow's
  // splat plays out, then tickPlayerDying teleports us back to town
  if (player.dying) { tickPlayerDying(); return; }
  tickAir(dt);
  if (player.forced) {
    const f = player.forced;
    if (!player.moving) {
      if (f.i >= f.tiles.length) {
        addXp("Agility", f.xp);
        player.forced = null;
        return;
      }
      // risky crossings: a per-tile chance to lose your footing (agility.js).
      // A slip scrambles you back to the bank you set off from — no XP, a short
      // stun and a little fall/splash damage.
      if (typeof obstacleSlipChance === "function" && Math.random() < obstacleSlipChance(f)) {
        player.x = f.fromX; player.y = f.fromY;
        player.px = PX(f.fromX); player.py = PX(f.fromY);
        player.stunUntil = now + 1400;
        if (f.dmg) {
          const fd = Math.min(f.dmg, Math.max(0, player.hp)); // fatal fall shows remaining HP, not overkill
          player.hp -= fd;
          if (typeof addSplat === "function") addSplat(player, fd);
          if (player.hp <= 0) { player.forced = null; playerDie(f.name); return; }
        }
        log(`You lose your footing on the ${f.name.toLowerCase()} and tumble back!`, "warn");
        player.forced = null;
        return;
      }
      const t = f.tiles[f.i++];
      const agi = (typeof charAgiSpeedMul === "function") ? charAgiSpeedMul() : 1;
      player.moving = { fx: player.x, fy: player.y, tx: t.x, ty: t.y, t: 0, dur: 260 / agi };
      if (t.x !== player.x) player.facing = t.x > player.x ? 1 : -1;
      const d8f = dir8From(t.x - player.x, t.y - player.y); if (d8f) player.dir8 = d8f;
    }
  }
  if (player.moving) {
    const m = player.moving;
    m.t += dt / m.dur;
    if (m.t >= 1) {
      player.x = m.tx; player.y = m.ty;
      player.px = PX(m.tx); player.py = PX(m.ty);
      player.moving = null;
      if (m.deck !== undefined) player.deck = m.deck; // deck/under applies on arrival
      if (typeof rideFollow === "function") rideFollow(); // ridden vessel keeps pace / stays at the bank
      if (!player.forced && player.goal && goalInReach()) { player.path = []; executeGoal(); }
    } else {
      player.px = PX(m.fx) + (PX(m.tx) - PX(m.fx)) * m.t;
      player.py = PX(m.fy) + (PX(m.ty) - PX(m.fy)) * m.t;
    }
    return;
  }
  if (now < player.stunUntil) return;
  // ---- river current ----
  // Flowing water pulls anyone on foot in it downstream at 0.75 walk speed.
  // Standing idle you drift; WALKING you still move where you steer at full
  // speed, but the current adds its component on top — cross a river and you
  // track a DIAGONAL (1 across : 0.75 down, via the accumulator below).
  // Holding SHIFT braces you: feet dug in, no pull at all — and working in
  // the flow NEEDS the brace: netting whitebait (or any action) mid-river
  // without Shift is torn up and you wash downstream. Standing up on a deck
  // is exempt; a river in flood runs faster; boats under way steer freely
  // (idle boats still drift).
  let pull = null;
  if (!player.forced &&
      world.isWater(player.x, player.y) &&
      (player.deck === false || !dualTileAt(player.x, player.y)) &&
      now >= (player.driftAt || 0)) {
    const trf = (typeof Tutorial !== "undefined") ? Tutorial.riverFlow(player.x, player.y) : null;
    const f = trf || (world.riverFlowAt && world.riverFlowAt(player.x, player.y));
    // the Fisher's first lesson: bracing against a current (Shift, feet dug in)
    if (f && K.Shift && typeof Tutorial !== "undefined" && Tutorial.onBrace) Tutorial.onBrace();
    if (f && !K.Shift) {
      if (player.act) {
        cancelAction();
        if (!player._braceLogAt || now - player._braceLogAt > 6000) {
          log("The current sweeps you off — hold Shift to brace while you work.", "warn");
          player._braceLogAt = now;
        }
      }
      const idle = !player.path.length && !player.goal &&
        !K.w && !K.a && !K.s && !K.d;
      if (idle) {
        // pure drift downstream at the current's own 0.75 walk speed.
        // Candidate steps are RANKED BY ALIGNMENT with the flow vector (the
        // old hardcoded axis-then-diagonal list assumed an axis-aligned
        // river — on Tūhura's -36° course its "slip past a snag" fallback
        // could bounce the swimmer up the WRONG diagonal). Best-aligned step
        // first, anything pointing meaningfully upstream never considered.
        const cand = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]]
          .map(d => ({ d, dot: (d[0] * f[0] + d[1] * f[1]) / Math.hypot(d[0], d[1]) }))
          .filter(c => c.dot > 0.35)
          .sort((a, b) => b.dot - a.dot)
          .map(c => c.d);
        for (const [dx, dy] of cand) {
          if (!dx && !dy) continue;
          const nx = player.x + dx, ny = player.y + dy;
          if (world.isWater(nx, ny) && passable(nx, ny) &&
              !(typeof ridingEnt === "function" && ridingEnt() &&
                typeof hullStepOK === "function" && !hullStepOK(ridingEnt(), nx, ny))) {
            moveTo(nx, ny);
            const fl = (typeof floodNow === "function") ? floodNow() : 0;
            if (player.moving) {
              player.moving.dur = 190 / (0.75 * (1 + fl * 1.4));
              if (trf) player.moving.deck = false;   // ride UNDER the bridge, not up onto it
            }
            break;
          }
        }
        return;
      }
      // steering: the pull rides along as a step modifier (below) — on foot only
      if (!player.sailing) pull = { px: Math.sign(f[0]), py: Math.sign(f[1]) };
    }
  }
  if (!pull) player._pullAcc = 0;
  // a step straight ACROSS the flow banks 0.75 tiles of downstream push;
  // each time a whole tile is owed the step goes out as the diagonal instead
  const pullStep = (sdx, sdy) => {
    if (!pull || (sdx * pull.px + sdy * pull.py) !== 0) return null;
    player._pullAcc = (player._pullAcc || 0) + 0.75;
    if (player._pullAcc < 1) return null;
    const ddx = Math.max(-1, Math.min(1, sdx + pull.px));
    const ddy = Math.max(-1, Math.min(1, sdy + pull.py));
    return [ddx, ddy];
  };
  const pullHint = () => {
    if (!player._braceLogAt || now - player._braceLogAt > 9000) {
      log("The current pulls you downstream — hold Shift to brace.", "warn");
      player._braceLogAt = now;
    }
  };
  let kdx = (K.d ? 1 : 0) - (K.a ? 1 : 0);
  let kdy = (K.s ? 1 : 0) - (K.w ? 1 : 0); // arrows: up/down zoom, left/right rotate view
  if (camStep || (typeof LC3D !== "undefined" && REN === LC3D)) { const r = rotInputByCam(kdx, kdy); kdx = r[0]; kdy = r[1]; }
  if (kdx || kdy) {
    // Shift+WASD: combat footwork — give ground (or circle) WITHOUT dropping
    // the fight. The archer keeps loosing at the target while retreating;
    // walking backwards with a drawn bow is slower than a monster's charge
    // (285ms/tile), so the gap still closes — retreat buys shots, not escape.
    const fighting = K.Shift && player.act && player.act.kind === "combat" &&
      player.act.mon && player.act.mon.alive;
    if (fighting) player.goal = null;
    else cancelAction();
    player.path = [];
    // pushing into a terrace too steep to climb (open ground, just over the
    // half-step limit): the diagonal axis-slide below still applies, but the
    // sidestep deflections don't — walking a different way read as the
    // character ignoring the player. Deflection stays for real 1-tile
    // obstacles (piers, boulders).
    const steep = !DEV_MODE && passable(player.x + kdx, player.y + kdy) &&
      !stepClimbOK(player.x, player.y, player.x + kdx, player.y + kdy);
    // unbraced river crossing: when a tile of downstream push is owed, this
    // step goes out as the diagonal (across + downstream) instead
    const ps = pullStep(kdx, kdy);
    if (ps) {
      if (tryStep(ps[0], ps[1])) { player._pullAcc -= 1; pullHint(); return; }
      player._pullAcc = 1;   // drift blocked by an obstacle — retry next step
    }
    tryStep(kdx, kdy) || tryStep(kdx, 0) || tryStep(0, kdy) ||
      // pushing a pure direction into a 1-tile obstacle (a bridge pier in the
      // channel, a boulder): deflect diagonally, else sidestep around it
      (!steep && !kdx && !!kdy && (tryStep(-1, kdy) || tryStep(1, kdy) || tryStep(-1, 0) || tryStep(1, 0))) ||
      (!steep && !kdy && !!kdx && (tryStep(kdx, -1) || tryStep(kdx, 1) || tryStep(0, -1) || tryStep(0, 1)));
    if (fighting && player.moving) {
      player.moving.dur *= 1.6; // the wary backwards shuffle of an archer mid-draw
      const mon = player.act.mon;
      player.facing = mon.px >= player.px ? 1 : -1; // eyes stay on the enemy
      const d8 = dir8From(mon.x - player.x, mon.y - player.y);
      if (d8) player.dir8 = d8;
    }
    return;
  }
  // ---- automatic combat kiting ----
  // A ranged fighter (bow / spell) that isn't being steered by hand keeps the
  // target at arm's length: if the enemy has closed inside the standoff, step
  // straight back — still locked facing it — to reopen the gap. Melee (range 1)
  // never kites; it must stay adjacent to strike. Backing away is slower than a
  // charge, so this buys shots, not a clean escape.
  if (player.act && player.act.kind === "combat" && player.act.mon && player.act.mon.alive &&
      typeof styleRange === "function" && styleRange() > 1) {
    const mon = player.act.mon;
    const dist = Math.max(Math.abs(mon.x - player.x), Math.abs(mon.y - player.y));
    const standoff = Math.min(styleRange(), 4);
    if (dist >= 1 && dist < standoff) {
      player.goal = null; player.path = [];
      const bx = Math.sign(player.x - mon.x), by = Math.sign(player.y - mon.y);
      // step straight away, then slide along an axis, then sidestep around a snag
      if (tryStep(bx, by) || tryStep(bx, 0) || tryStep(0, by) || tryStep(-by, bx) || tryStep(by, -bx)) {
        if (player.moving) player.moving.dur *= 1.6; // wary backwards shuffle mid-draw
      }
      player.facing = mon.px >= player.px ? 1 : -1; // eyes stay on the enemy
      const d8 = dir8From(mon.x - player.x, mon.y - player.y); if (d8) player.dir8 = d8;
      return;
    }
  }
  if (player.path.length) {
    const n = player.path[0];
    if (!passable(n.x, n.y) || !stepClimbOK(player.x, player.y, n.x, n.y)) {
      const goal = player.goal;
      if (goal) { const p = findPath(goal.tx, goal.ty, goal.reach); player.path = p || []; }
      else player.path = [];
      return;
    }
    // clicked across water while riding an oarless craft: can't steer there
    if (world.isWater(n.x, n.y) && typeof ridingEnt === "function") {
      const rid = ridingEnt();
      if (rid && !canRowBoat(ITEMS[rid.id])) {
        player.path = [];
        player.goal = null;
        if (!player._oarLogAt || now - player._oarLogAt > 3000) {
          log("No oars — the current decides where this goes.", "warn");
          player._oarLogAt = now;
        }
        return;
      }
      // the hull spans real tiles (placing.js footprints): the whole ship
      // must fit through on its new heading, not just the anchor tile
      if (rid && typeof hullStepOK === "function" && !hullStepOK(rid, n.x, n.y)) {
        player.path = [];
        player.goal = null;
        if (!player._hullLogAt || now - player._hullLogAt > 3000) {
          log(`The ${ITEMS[rid.id].name.toLowerCase()} won't fit through there.`, "warn");
          player._hullLogAt = now;
        }
        return;
      }
    }
    // unbraced river crossing by click: the current owes the same downstream
    // push; when a whole tile is due the step drifts diagonally off the path,
    // and the path is replanned from the new tile so it stays step-adjacent
    const pp = pullStep(n.x - player.x, n.y - player.y);
    if (pp) {
      const nx2 = player.x + pp[0], ny2 = player.y + pp[1];
      if (passable(nx2, ny2) && stepClimbOK(player.x, player.y, nx2, ny2)) {
        player._pullAcc -= 1;
        moveTo(nx2, ny2);
        const g = player.goal;
        player.path = (g && findPath(g.tx, g.ty, g.reach)) || [];
        if (!player.path.length) player.goal = null; // unroutable after the drift — let go
        pullHint();
        return;
      }
      player._pullAcc = 1;   // drift blocked — carry the debt to the next step
    }
    player.path.shift();
    moveTo(n.x, n.y);
    return;
  }
  // (idle drift + the walking pull accumulator live at the top of this
  // function; Shift braces both)
}
// Callers (1):
//  gameplay/movement.js:39
function tryStep(dx, dy) {
  if (!dx && !dy) return false; // the axis fallbacks can decompose to a zero step
  const nx = player.x + dx, ny = player.y + dy;
  if (!passable(nx, ny)) return false;
  // an oar-class vessel without oars aboard can't be steered — only the
  // river current moves it (the drift branch calls moveTo directly)
  if (world.isWater(nx, ny) && typeof ridingEnt === "function") {
    const rid = ridingEnt();
    if (rid && !canRowBoat(ITEMS[rid.id])) {
      if (!player._oarLogAt || now - player._oarLogAt > 3000) {
        log("No oars — the current decides where this goes.", "warn");
        player._oarLogAt = now;
      }
      return false;
    }
    // the whole hull must fit at the new anchor on its new heading
    if (rid && typeof hullStepOK === "function" && !hullStepOK(rid, nx, ny)) {
      if (!player._hullLogAt || now - player._hullLogAt > 3000) {
        log(`The ${ITEMS[rid.id].name.toLowerCase()} won't fit through there.`, "warn");
        player._hullLogAt = now;
      }
      return false;
    }
  }
  if (dx && dy && (!passable(nx, player.y) || !passable(player.x, ny))) return false;
  if (!stepClimbOK(player.x, player.y, nx, ny)) return false; // no climbing >½ step
  // retired prototype collision: cliffs (voxel step-walls) and loc walls block manual
  // steps just like they block the pathfinder
  if (typeof LC3D !== "undefined" && REN === LC3D && LC3D.stepBlocked(player.x, player.y, nx, ny)) return false;
  moveTo(nx, ny);
  return true;
}
// Callers (92):
//  gameplay/movement.js:51,58
//  gameplay/world.js:87,101,104,116,122,130,132,159,164,168,173,188,197,201,206,220,224,237,245,261,264,274,278,283,285,287,289,290,298,300,302,308,310,319,323,324,325,331,335,337,343,354,451,463
//  render3d.js:524,572
//  world/map.js:36,61,63,67,68,69,78,85,97,101,113,114,119,126,132,134,139,162,169,175,189,202,209,232,238,243,244,248,249,270,282,290,292,298,330,331,337,343,356,601,602,617,622,645
// barred() runs on every step (held-key movement, autopath, river drift can
// all retry the same blocked tile many times a second) — throttle identical
// repeats the same way the oar/hull warnings above do, so a standing block
// logs once per 3s instead of spamming the log.
function logBarred(msg) {
  if (player._barredMsg !== msg || !player._barredLogAt || now - player._barredLogAt > 3000) {
    log(msg, "sys");
    player._barredMsg = msg; player._barredLogAt = now;
  }
}
function moveTo(nx, ny) {
  // Tūhura Isle gates & seal (gameplay/tutorial.js): every step — walking,
  // wading or sailing — funnels through here. During the tutorial the gate
  // past the current keeper stays latched; after graduation the whole isle
  // is mist. barred() returns the message explaining which.
  if (typeof Tutorial !== "undefined") {
    const b = Tutorial.barred(nx, ny);
    if (b) {
      player.path = []; player.goal = null;
      logBarred(b);
      return;
    }
  }
  // Dream Forest interior (gameplay/dream.js): each level disc is ringed by
  // bramble — the painted thicket is the look, this is the wall
  if (typeof Dream !== "undefined") {
    const b = Dream.barred(nx, ny);
    if (b) {
      player.path = []; player.goal = null;
      logBarred(b);
      return;
    }
  }
  // stepping into a doorway swings the closed door/gate open on the way through
  if (world.structAt) {
    const s = world.structAt(nx, ny);
    if (s && s.door && !world.isDoorOpen(s.door.x, s.door.y)) {
      useDoor(s.door);
      // a locked door refuses to swing (gameplay/locks.js) — the step is off
      if (!world.isDoorOpen(s.door.x, s.door.y)) { player.path = []; player.goal = null; return; }
    }
  }
  const diag = nx !== player.x && ny !== player.y;
  // per-character move speed (character-stats.js): faster races cover a tile in
  // less time, slower ones take longer.
  let dur = (diag ? 270 : 190) / (typeof charSpeedMul === "function" ? charSpeedMul() : 1);
  // (the old Dream Forest per-tile slowdown is gone — the 2026-09-16 rewrite
  // keeps movement honest and does its magic off-screen, js/gameplay/dream.js)
  // deck/under bookkeeping for two-level tiles (bridge decks and river
  // buildings): stepping INTO the system picks a level by comparing the entry
  // tile's ground height with the deck height (enter from the bank top → on
  // the deck; enter low along the bank → underneath); the level then sticks
  // while moving inside, and resets on leaving. Sailing is always "under".
  let deckNext = player.deck;
  const dual = dualTileAt(nx, ny);
  if (dual && !dualTileAt(player.x, player.y)) {
    deckNext = !player.sailing;
    if (deckNext && typeof REN !== "undefined" && REN && REN.deckLevel && REN.groundLevel) {
      const dY = REN.deckLevel(nx, ny), gY = REN.groundLevel(player.x, player.y);
      if (dY != null && gY != null) deckNext = gY >= dY - 1.01;
    }
  } else if (!dual) deckNext = true;
  // a dual tile is water only for someone moving at water level: on foot at
  // deck level you cross on top (no boarding); sailing you pass underneath
  const water = world.isWater(nx, ny) &&
    !(dual && !player.sailing && deckNext !== false);
  if (water) {
    const rid = typeof ridingEnt === "function" && ridingEnt();
    if (rid) {
      // riding a placed vessel (gameplay/placing.js): it glides at its own
      // pace and follows on arrival (rideFollow); no wading, no pack-boat
      dur *= ITEMS[rid.id].rideDur || 0.8;
    } else {
    // under a bridge deck the hull must fit the air gap (boatClearance):
    // a tall ship can't follow — the biggest OWNED boat that fits ducks
    // through instead, and with none you slip over the side and wade.
    // Open water: no limit, the best boat sails.
    let airGap = null;
    if (dual && typeof REN !== "undefined" && REN && REN.deckLevel && REN.groundLevel) {
      const dY = REN.deckLevel(nx, ny), wY = REN.groundLevel(nx, ny);
      if (dY != null && wY != null) airGap = dY - wY;
    }
    const boat = !DEV_MODE && bestBoat(airGap);
    if (boat) {
      dur *= ITEMS[boat].sailSpeed;
      if (!player.sailing) { log(`You board your ${ITEMS[boat].name.toLowerCase()}.`, "sys"); sfx("splash_big", 0.5); }
      else if (player.sailing !== boat) log(
        ITEMS[boat].boat < ITEMS[player.sailing].boat
          ? `Your ${ITEMS[player.sailing].name.toLowerCase()} won't fit under the bridge — you duck through in your ${ITEMS[boat].name.toLowerCase()}.`
          : `You return to your ${ITEMS[boat].name.toLowerCase()}.`, "sys");
      player.sailing = boat;
      addXp("Sailing", 2 + ITEMS[boat].boat * 2, true);
    } else {
      // sailing with nothing that fits, and a deck really is the obstacle:
      // slip over the side and wade beneath (cheat mode keeps the old
      // no-boat behaviour untouched)
      if (player.sailing && airGap != null && !DEV_MODE) {
        log(`Your ${ITEMS[player.sailing].name.toLowerCase()} won't fit under the bridge — you slip over the side and wade beneath.`, "sys");
        player.sailing = null;
      }
      // wading in a current: with the flow you ride it (up to 1.75x walk
      // speed), against it you fight serious resistance (down to 0.25x) —
      // speed factor = 1 + 0.75 * (step direction · flow direction). The
      // current that matters is the water you're standing in (the target's
      // when stepping in from dry land). A river in FLOOD (weather.js) runs
      // stronger: the with/against factor grows with the flood level, so
      // fighting upstream through a swollen river is a real battle.
      const inW = world.isWater(player.x, player.y);
      const f = world.riverFlowAt &&
        world.riverFlowAt(inW ? player.x : nx, inW ? player.y : ny);
      if (f) {
        const fl = (typeof floodNow === "function") ? floodNow() : 0;
        const sl = Math.hypot(nx - player.x, ny - player.y) || 1;
        const dot = ((nx - player.x) * f[0] + (ny - player.y) * f[1]) / sl;
        // the upstream floor drops with the flood too — a swollen river is
        // nearly impassable against the current
        dur /= Math.max(0.25 - fl * 0.1, 1 + 0.75 * (1 + fl * 1.6) * dot);
      } else if (!DEV_MODE) dur *= 1.25; // still-water wade
    }
    }
  } else if (player.sailing && !water) {
    player.sailing = null;
    log("You step ashore.", "sys");
  }
  // apply the deck/under choice when the step COMPLETES (stepPlayer): the
  // player visually stands on the FROM tile for the whole animation, and
  // flipping deck early made them pop onto the deck for a beat when leaving
  // an under-passage (the "brief jump at the far end")
  // Agility passive: a nimble character covers dry ground a little quicker on
  // foot (character-stats.js). Land travel only — never boats or wading.
  if (!water && typeof charAgiSpeedMul === "function") dur /= charAgiSpeedMul();
  // Roads are FAST: on a laid path (the painter's dirt#1 — the road web and
  // every settlement cross) or a bridge deck, travel runs at 1.5x pace.
  // Both ends of the step must be on the going, so you don't surge while
  // merely clipping a corner of the road. Land travel only.
  if (!water) {
    const onRoad = (x, y) =>
      String(world.getGround(x, y) || "").startsWith("dirt#") ||
      String(world.getDecor(x, y) || "").startsWith("stone_bridge");
    if (onRoad(player.x, player.y) && onRoad(nx, ny)) dur /= 1.5;
  }
  // no footstep audio for a ghost-ticked split body (gameplay/split.js)
  if (!(typeof Split !== "undefined" && Split.isGhost())) sfxStep(nx, ny, water, !!player.sailing);
  player.moving = { fx: player.x, fy: player.y, tx: nx, ty: ny, t: 0, dur, deck: deckNext };
  if (nx !== player.x) player.facing = nx > player.x ? 1 : -1;
  const d8 = dir8From(nx - player.x, ny - player.y); if (d8) player.dir8 = d8;
}
