// ===== Taiao — monster AI and movement =====
"use strict";

// ---------- swimming (aquatic monsters) ----------
// Aquatic monsters (canSwim) live IN the water, not on it: they hold a depth
// below the surface (m.swimY, world units) and cruise it vertically as well
// as roaming horizontally — dozing near the seabed, rising to a half-out
// surface swim, diving again. The swim tick eases swimY toward m.swimTgt and
// clamps it to the local water column (state.js waterDepthAt), so a swimmer
// gliding over a shallow bank is pushed up its slope automatically.
const SWIM_SURFACE_Y = 0.35;  // "surfaced": body half-out, shark-fin style
const SWIM_DIVE_MAX = 2.6;    // deepest wander dive (visually fully under)
const SWIM_RATE = 1.3;        // vertical units per second
const SWIM_ATK_Y = 1.0;       // must be at least this shallow to strike
function swimTick(m, dt) {
  const wd = typeof waterDepthAt === "function" ? waterDepthAt(m.x, m.y) : 0;
  if (m.swimY === undefined) m.swimY = m.swimTgt = Math.min(wd, SWIM_SURFACE_Y);
  // hunting or hurt: come up to striking depth. Fleeing: sound the deeps.
  if (m.fx && now < m.fx.fleeUntil) m.swimTgt = wd;
  else if (m.target || (m.hitAt && now - m.hitAt < 8000)) m.swimTgt = SWIM_SURFACE_Y;
  const want = Math.min(Math.max(m.swimTgt, 0), wd);
  const step = SWIM_RATE * dt / 1000;
  m.swimY += Math.max(-step, Math.min(step, want - m.swimY));
  if (m.swimY > wd) m.swimY = wd; // shoaling floor rises faster than the ease
}

// ---------- update: monsters ----------
// Callers (1):
//  main.js:41
function updateMonsters(dt) {
  // monsters keep their temper near a village/city or a road (see
  // world.inPeacefulZone), so travellers are safe in town and on the way
  // there — and on Tūhura Isle, permanently (terrain.js onTutIsle)
  const peaceful = (world.inPeacefulZone && world.inPeacefulZone(player.x, player.y)) ||
    (typeof onTutIsle === "function" && onTutIsle(player.x, player.y));
  // PERF: hoist the local player's combat level once per frame — it can't change
  // mid-updateMonsters, so monCandidates() reuses this instead of recomputing it
  // (5 skill lookups) on every aggro/attack-turn call. See monCandidates below.
  _frameClvl = combatLevel();
  for (const m of monsters) {
    const def = MONSTERS[m.kind];
    if (!m.alive) {
      if (now >= m.respawnAt) {
        m.alive = true; m.hp = monMaxHp(m.kind);
        m.x = m.sx; m.y = m.sy; m.px = PX(m.sx); m.py = PX(m.sy);
        m.moving = null;
        m.fx = null; // afflictions don't follow it through the grave
        if (m.canSwim) { m.swimY = undefined; m.swimTgt = undefined; } // swimTick re-seeds
        // a bird shot from the sky respawns back on its feet, not mid-flight
        m.flight = null; m.flyAbs = undefined; m.flyY = 0; m.takeoffAt = 0; m.dormant = false;
        // a slain FLIER doesn't pop back up on the same branch moments later
        // (a fresh full bar right where you're standing read as "its health
        // reset") — the replacement bird turns up elsewhere in the wood
        if (typeof birdCfg === "function" && birdCfg(m)) {
          for (let t2 = 0; t2 < 12; t2++) {
            const a = Math.random() * 2 * Math.PI, r = 12 + Math.random() * 14;
            const nx = Math.round(m.sx + Math.cos(a) * r), ny = Math.round(m.sy + Math.sin(a) * r);
            if (world.isWater(nx, ny) || world.isBlocked(nx, ny)) continue;
            m.sx = nx; m.sy = ny;
            m.x = nx; m.y = ny; m.px = PX(nx); m.py = PX(ny);
            m.spawnBiome = world.biomeAt(nx, ny);
            break;
          }
        }
      }
      continue;
    }
    // multiplayer (js/net/entsync.js): a monster another player's client is
    // simulating — the proximity AUTHORITY — only interpolates here. We still
    // resolve its swings at US (the victim's own client always rolls the
    // damage against itself), but no wander/chase/burn AI runs locally.
    const entRemote = m._remoteUntil && now < m._remoteUntil;
    const distP = Math.max(Math.abs(m.x - player.x), Math.abs(m.y - player.y));
    // swim even while a horizontal step is in flight, but let far-away
    // swimmers idle (waterDepthAt's bank scan could touch ungenerated chunks)
    if (m.canSwim && distP <= 48) swimTick(m, dt);
    // woven-spell afflictions (combat.js fusions): burning ticks damage on
    // a slow beat; chill and root act on movement below and in monMove.
    // A monster sealed in Stasis can't even burn.
    if (!entRemote && m.fx && m.fx.burnUntil && now < m.fx.burnUntil && now >= (m.fx.burnNextAt || 0) &&
        !(now < m.fx.stasisUntil)) {
      m.fx.burnNextAt = now + 1200;
      const bd = Math.min(m.fx.burnDmg || 1, Math.max(0, m.hp)); // don't overkill-splat
      m.hp -= bd;
      addSplat(m, bd);
      if (m.hp <= 0) { killMonster(m); continue; }
    }
    // NZ flying birds: the flight layer (gameplay/birdflight.js) owns any bird
    // that's on the wing or up a perch; a grounded flier falls through to the
    // ordinary wander AI below until its take-off timer comes due
    if (!entRemote && typeof birdFlightTick === "function" && birdFlightTick(m, def, dt, distP)) continue;
    if (m.moving) {
      const mv = m.moving;
      mv.t += dt / mv.dur;
      if (mv.t >= 1) { m.x = mv.tx; m.y = mv.ty; m.px = PX(mv.tx); m.py = PX(mv.ty); m.moving = null; }
      else {
        m.px = PX(mv.fx) + (PX(mv.tx) - PX(mv.fx)) * mv.t;
        m.py = PX(mv.fy) + (PX(mv.ty) - PX(mv.fy)) * mv.t;
      }
      continue;
    }
    if (entRemote) {
      // authority elsewhere drives movement/targeting; our only job is the
      // monster's attack ON US when it's adjacent and its swing timer is due
      if (m.target === player && distP <= 1 && now >= m.nextAtkAt &&
          (!m.canSwim || m.swimY <= SWIM_ATK_Y)) monsterAttack(m);
      continue;
    }
    if (distP > 48) continue; // far-away monsters idle until you return
    const distS = Math.max(Math.abs(m.x - m.sx), Math.abs(m.y - m.sy));
    // a remote target that logged off or left the zone evaporates — the chase
    // breaks exactly like a line-of-sight loss (full leash heal, below)
    if (m.target && m.target !== player &&
        !(typeof Live !== "undefined" && Live.players.get(m.target.id) === m.target)) {
      m.target = null; m.hp = monMaxHp(m.kind);
    }
    // aggro acquisition — every nearby player (the local one AND the remotes
    // sharing the zone) is a candidate; among the eligible, the HIGHEST combat
    // level draws its attention (ties break on id so every client agrees).
    if (def.aggro && !m.target && distS < 8) {
      let best = null;
      for (const c of monCandidates()) {
        if ((c.lvl | 0) > 0) continue;                       // upstairs is out of reach
        if (c.local && player.unseenUntil > now) continue;   // a Vanished player walks unseen
        if (Math.max(Math.abs(m.x - c.x), Math.abs(m.y - c.y)) > 4) continue;
        if (def.lvl <= 2 * c.clvl) continue;                 // too seasoned to bother
        if (c.local ? peaceful
          : (world.inPeacefulZone && world.inPeacefulZone(c.x, c.y))) continue;
        if (!best || c.clvl > best.clvl || (c.clvl === best.clvl && c.id < best.id)) best = c;
      }
      if (best) m.target = best.ent;
    }
    if (m.target) {
      const tgt = m.target;   // the local player, or a remote player's body
      const tdist = Math.max(Math.abs(m.x - tgt.x), Math.abs(m.y - tgt.y));
      // The chase leash is time-based, not just distance-based: a monster
      // that's still being hurt (hit within the last 8s — combat.js stamps
      // m.hitAt) stays on the hunt however far from home it is, so a
      // long-range arrow can never trigger a mid-charge reset+heal. Only
      // once it's had 8s clear of arrows does straying past 10 tiles from
      // its spawn break the chase (and heal it back up).
      const recentlyHit = m.hitAt && now - m.hitAt < 8000;
      if ((distS > 10 && !recentlyHit) || (tgt.level | 0) > 0) { m.target = null; m.hp = monMaxHp(m.kind); }
      else if (m.fx && now < m.fx.stunUntil) {
        // petrified / in stasis: no step, no swing
      }
      else if (m.fx && now < m.fx.fleeUntil) {
        // shadow-struck: it bolts away from its hunter instead of fighting
        monStepToward(m, m.x + Math.sign(m.x - tgt.x) * 8, m.y + Math.sign(m.y - tgt.y) * 8);
      }
      else if (tdist <= 1) {
        // a swimmer strikes from the surface: while it's still rising from the
        // deeps (swimTick pulls a hunter up) it holds its bite
        if (now >= m.nextAtkAt && (!m.canSwim || m.swimY <= SWIM_ATK_Y)) {
          // ATTACK TURN: of everyone in reach, the highest combat level takes
          // the blow (user rule). The victim's OWN client rolls the damage —
          // here we either strike the local player or just animate the swing
          // at a remote (their client resolves it against their armour).
          let best = null;
          for (const c of monCandidates()) {
            if ((c.lvl | 0) > 0) continue;
            if (Math.max(Math.abs(m.x - c.x), Math.abs(m.y - c.y)) > 1) continue;
            if (!best || c.clvl > best.clvl || (c.clvl === best.clvl && c.id < best.id)) best = c;
          }
          if (best && best.ent !== m.target) m.target = best.ent;
          if (m.target === player) monsterAttack(m);
          else {
            m.nextAtkAt = now + MONSTERS[m.kind].atkTick;
            m.lungeT = now;
          }
        }
      } else if (!(m.fx && now < m.fx.rootUntil)) { // rooted feet can't chase
        monStepToward(m, tgt.x, tgt.y);
      }
    } else if (m.fx && now < m.fx.fleeUntil) {
      // fleeing without a target (a flushed flightless bird, a routed calm
      // monster): bolt straight away from the player
      monStepToward(m, m.x + Math.sign(m.x - player.x || 1) * 8, m.y + Math.sign(m.y - player.y || 1) * 8);
    } else if (distS > 4) {
      // stranded far from home (a broken chase, a player-death reset): march
      // back toward spawn. The wander rule below only accepts steps landing
      // within 4 tiles of spawn — impossible from out here, which is how a
      // monster that gave up mid-charge froze in the open field. If the
      // greedy homeward step wedges on terrain, jiggle sideways to get free.
      monStepToward(m, m.sx, m.sy);
      if (!m.moving && now >= (m.wanderAt || 0)) {
        m.wanderAt = now + 600;
        const dx = Math.floor(Math.random() * 3) - 1, dy = Math.floor(Math.random() * 3) - 1;
        if ((dx || dy) && mobPassable(m, m.x + dx, m.y + dy)) monMove(m, m.x + dx, m.y + dy);
      }
    } else {
      if (now >= (m.wanderAt || 0)) {
        m.wanderAt = now + 2000 + Math.random() * 4000;
        // swimmers wander the water column too: sometimes a surface cruise,
        // sometimes a dive partway (or all the way) down the local column
        if (m.canSwim)
          m.swimTgt = Math.random() < 0.4 ? SWIM_SURFACE_Y
            : SWIM_SURFACE_Y + Math.random() * SWIM_DIVE_MAX;
        const dx = Math.floor(Math.random() * 3) - 1, dy = Math.floor(Math.random() * 3) - 1;
        const nx = m.x + dx, ny = m.y + dy;
        if ((dx || dy) && mobPassable(m, nx, ny) &&
            Math.abs(nx - m.sx) <= 4 && Math.abs(ny - m.sy) <= 4)
          monMove(m, nx, ny);
      }
    }
  }
  // ambient nature audio: nearby birds sing (inverse-square by distance to
  // the current body) and the rain/wind/sea beds track the live weather;
  // the generative music layer breathes off the same signals
  if (typeof birdsongTick === "function") birdsongTick();
  if (typeof ambienceTick === "function") ambienceTick();
  if (typeof musicTick === "function") musicTick();
}
// Callers (3):
//  gameplay/monsters.js:42,61,63
function mobPassable(m, nx, ny) {
  // PERF: cheap CACHED terrain rejections run FIRST; the linear monsterAt()
  // occupancy scan (O(|monsters|)) runs LAST — only on tiles the terrain hasn't
  // already walled off. mobPassable is called ~7x per stepping monster per
  // frame, so most candidate tiles now never pay for that scan. Behaviour is
  // UNCHANGED: every predicate here is side-effect-free, so reordering can't
  // alter the returned boolean — monsterAt remains the final gate immediately
  // before each passable (return-true) result, on BOTH the swim and land paths.
  if (m.canSwim) {
    // swimmers are water-locked but SWIM: underwater terraces and shelf drops
    // that wall a walker don't stop a body gliding over them (its depth just
    // follows the column — swimTick clamps to waterDepthAt on arrival)
    if (!(world.isWater(nx, ny) && world.getDecor(nx, ny) !== "stone_bridge#p")) return false;
    return !monsterAt(nx, ny);
  }
  // creatures can't scale terraces: no more than half a step up OR down
  if (typeof REN !== "undefined" && REN && REN.groundLevel &&
      Math.abs(REN.groundLevel(nx, ny) - REN.groundLevel(m.x, m.y)) > 0.51) return false;
  if (world.isWater(nx, ny)) return false; // land creatures never wade in
  if (world.isBlocked(nx, ny)) return false;
  // city-gate wall plugs (structural, not chunk-blocked) are wall to mobs too
  const s = world.structAt && world.structAt(nx, ny);
  if (s && s.plug) return false;
  if (m.spawnBiome !== undefined && world.biomeAt(nx, ny) !== m.spawnBiome) return false;
  if (monsterAt(nx, ny)) return false; // finally: never step onto another live body
  return true;
}
// Callers (1):
//  gameplay/monsters.js:35
function monStepToward(m, tx, ty) {
  const dx = Math.sign(tx - m.x), dy = Math.sign(ty - m.y);
  const ok = (cx2, cy2) => {
    if (!cx2 && !cy2) return false;
    const nx = m.x + cx2, ny = m.y + cy2;
    if (!mobPassable(m, nx, ny)) return false;
    if (nx === player.x && ny === player.y) return false;
    if (cx2 && cy2 && (!mobPassable(m, nx, m.y) || !mobPassable(m, m.x, ny))) return false;
    return true;
  };
  const go = (cx2, cy2, slide) => { m.slide = slide || null; monMove(m, m.x + cx2, m.y + cy2); };
  // Wall-following: a charger wedged against something it can't cross (a
  // terrace wall too tall for the half-step climb rule, a pond edge) slides
  // perpendicular along the obstacle hunting for a way around — and COMMITS
  // to that slide direction until the direct diagonal opens again. Without
  // the commitment, each fresh greedy pick reverses the previous sidestep
  // and the monster paces in place forever instead of rounding the obstacle.
  if (m.slide) {
    if (ok(dx, dy)) { m.slide = null; return go(dx, dy); } // the line's open again
    if (ok(m.slide[0], m.slide[1])) return go(m.slide[0], m.slide[1], m.slide);
    m.slide = null; // slide path pinched off too — repick below
  }
  for (const [cx2, cy2] of [[dx, dy], [dx, 0], [0, dy]])
    if (ok(cx2, cy2)) return go(cx2, cy2);
  const side = dx && dy ? [[dx, -dy], [-dx, dy]] : [[dy, dx], [-dy, -dx]];
  for (const [cx2, cy2] of side)
    if (ok(cx2, cy2)) return go(cx2, cy2, [cx2, cy2]);
}
// Callers (2):
//  gameplay/monsters.js:44,64
function monMove(m, nx, ny) {
  const diag = nx !== m.x && ny !== m.y;
  let dur = diag ? 400 : 285;
  // chilled limbs (water-aspect fusions) drag every step out
  if (m.fx && now < m.fx.chillUntil) dur = Math.round(dur * (1 + (m.fx.chillPct || 1)));
  m.moving = { fx: m.x, fy: m.y, tx: nx, ty: ny, t: 0, dur };
  if (nx !== m.x) m.facing = nx > m.x ? 1 : -1;
  m.dir8 = dir8From(nx - m.x, ny - m.y);
}
// dx/dy in {-1,0,1}; +x is east, +y is south (toward camera).
// Callers (1):
//  gameplay/monsters.js:80
function dir8From(dx, dy) {
  if (dx > 0) return dy > 0 ? "south-east" : dy < 0 ? "north-east" : "east";
  if (dx < 0) return dy > 0 ? "south-west" : dy < 0 ? "north-west" : "west";
  return dy < 0 ? "north" : "south";
}
// PERF: the LOCAL player's combat level can't change mid-frame, so
// updateMonsters hoists it into _frameClvl once per frame and monCandidates
// reuses it instead of re-running combatLevel() (5 skill lookups) on every call
// — monCandidates runs ~2x per eligible monster per frame. In single-player the
// one candidate (the local player) is a reused mutable scratch object+array, so
// the aggro/attack scans stop allocating fresh each call.
let _frameClvl = 0;
const _spCand = { ent: null, local: true, id: 0, clvl: 0, x: 0, y: 0, lvl: 0 };
const _spCandArr = [_spCand];
// Candidate victims for a monster: the local player plus (in multiplayer)
// every remote player sharing the zone (net/livesync.js keeps their position
// and combat level fresh). Offline / on Tūhura Isle this is just the player,
// so single-player aggro behaves exactly as it always has.
function monCandidates() {
  const mp = typeof Live !== "undefined" && Live.connected && Live.connected();
  if (!mp) {
    // single-player / Tūhura Isle: one candidate (the local player). Reuse the
    // scratch object+array rather than allocating per call — callers only ever
    // read `.ent` off the chosen winner, they never retain the array itself.
    _spCand.ent = player;
    _spCand.id = (typeof Live !== "undefined" && Live.myId && Live.myId()) || 0;
    _spCand.clvl = _frameClvl;
    _spCand.x = player.x; _spCand.y = player.y; _spCand.lvl = player.level | 0;
    return _spCandArr;
  }
  // multiplayer: positions/levels vary per remote player, so build a fresh list
  // (it must not alias shared scratch). Local player's combat level is hoisted.
  const out = [{ ent: player, local: true,
    id: (typeof Live !== "undefined" && Live.myId && Live.myId()) || 0,
    clvl: _frameClvl, x: player.x, y: player.y, lvl: player.level | 0 }];
  for (const rp of Live.players.values())
    out.push({ ent: rp, local: false, id: rp.id, clvl: rp.clvl | 0,
      x: rp.x, y: rp.y, lvl: rp.level | 0 });
  return out;
}

// Callers (1):
//  gameplay/monsters.js:50
// find a live monster on a tile. Monsters only ever live on the ground floor
// (level 0 — they can't climb ladders), so pass `level` to only match when it's
// 0: an upstairs player/entity can't touch a monster through the floor. Omit
// `level` for the old any-storey match (monster-vs-monster placement).
function monsterAt(x, y, level) {
  // dormant = a nocturnal bird hidden away for the day: no body to bump into
  return monsters.find(m => m.alive && !m.dormant && m.x === x && m.y === y && (level == null || (m.level | 0) === (level | 0)));
}
