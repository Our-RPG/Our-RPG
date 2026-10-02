// ===== Our RPG — shared monsters & NPCs (multiplayer entity sync) =====
// Every client simulates its own world — that stays true. But when two
// players share a patch of ground, the creatures on it must be ONE story,
// not two: the same wolf in the same place, fighting whoever it's fighting,
// on every screen. This file makes that happen with a PROXIMITY AUTHORITY:
//
//   • For each entity (monster, or wandering town NPC), the connected player
//     with the LOWEST id among those within simulation range (48 tiles) is
//     its authority. The authority simulates it exactly as single-player
//     always has and broadcasts position/target snapshots through the zone
//     socket ({t:"E"} batches, relayed by server/src/live.js to everyone
//     within ENT_RADIUS of the sender).
//   • Everyone else marks the entity remote-controlled (m._remoteUntil /
//     npc._remoteUntil): their local AI skips it (monsters.js, render3d's
//     stepMixNpc) and they replay the authority's steps instead. The flag
//     EXPIRES (3s) — if the authority tabs out or leaves, whoever's next in
//     line simply resumes simulating from the last synced state. Liveness
//     rides the batches themselves: a remote only counts as an authority
//     candidate while its batches keep arriving.
//   • Combat is shared: ANY player's hits apply to the one shared health bar
//     (the hitter broadcasts each hit via the addSplat wrap below; everyone
//     applies it). The kill is broadcast too, but drops/xp stay with the
//     client that landed the killing blow. The monster's own attacks always
//     resolve on the VICTIM's client against its own armour (monsters.js);
//     the authority only decides who it's attacking — the highest combat
//     level in reach.
//
// Entity identity across clients: monsters are kind + their immutable
// spawn-def tile (m.kx,ky — gameplay/world.js); NPCs are _mid or
// name@home-tile (both deterministic worldgen products).
//
// Cross-client POSITION identity only needs to hold while players actually
// share the ground: entities nobody else is near are never broadcast at all,
// and the first snapshot when players meet snaps any solo drift away.
// Same liveness rules as livesync: inert offline, in DEV_MODE, mid-tutorial.
"use strict";

(function () {
  const DEV = typeof DEV_MODE !== "undefined" && DEV_MODE;
  const URL_ = typeof SERVER_URL !== "undefined" ? SERVER_URL : "";
  if (DEV || !URL_ || typeof Live === "undefined") {
    window.EntSync = { tick: () => {}, active: () => false };
    return;
  }

  const SIM_R = 48;        // matches monsters.js's "far monsters idle" radius
  const NPC_R = 40;        // NPCs sync a little tighter (there are many)
  const NEAR_R = 64;       // only narrate entities some REMOTE could see
  const BATCH_MS = 350;    // authority broadcast cadence
  const SNAP_MS = 1500;    // periodic full snapshot even when standing still
  const HOLD_MS = 3000;    // remote-control flag lifetime past the last update
  const EAGER_MS = 5000;   // a remote stays an authority candidate this long
                           //   past its last E batch (liveness window)
  const MAX_OPS = 72;      // per batch (server relays up to 96)

  let pend = [];                 // ops queued for the next batch (hits, kills)
  const sent = new Map();        // entity key -> last narrated state
  let batchAt = 0, applying = false;

  const active = () => Live.connected() && Live.players.size > 0;
  const monKey = m => m._ekey || (m._ekey = m.kind + ":" + m.kx + "," + m.ky);
  const npcKey = n => n._ekey ||
    (n._ekey = "N" + (n._mid ? "#" + n._mid : n.name + "@" + n._home[0] + "," + n._home[1]));
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

  // ---------- authority ----------
  // the lowest id within SIM_R wins; remotes only count while their batches
  // keep arriving (rp._eAt — a tabbed-out or lagged-off authority ages out and
  // the next in line takes over within EAGER_MS)
  function iAmAuthority(x, y, r, tNow) {
    if (cheb(x, y, player.x, player.y) > r) return false;
    const myId = Live.myId();
    for (const rp of Live.players.values()) {
      if (rp.id >= myId) continue;
      if (cheb(x, y, rp.x, rp.y) > r) continue;
      if (rp._eAt) { if (tNow - rp._eAt < EAGER_MS) return false; continue; }
      // never seen a batch from them: give them one EAGER window to start
      // narrating (they outrank us), then stop deferring — an older client
      // or a stalled tab must not freeze the world for everyone else
      if (!rp._metAt) rp._metAt = tNow;
      if (tNow - rp._metAt < EAGER_MS) return false;
    }
    return true;
  }
  const nearAnyRemote = (x, y, r) => {
    for (const rp of Live.players.values())
      if (cheb(x, y, rp.x, rp.y) <= r) return true;
    return false;
  };

  // ---------- outgoing (authority side) ----------
  function narrate(tNow) {
    const ops = pend;
    pend = [];
    // monsters
    for (const m of monsters) {
      if (ops.length >= MAX_OPS) break;
      if (m.kx === undefined) continue;                    // player-made (husbandry babies…)
      if (!nearAnyRemote(m.x, m.y, NEAR_R)) continue;      // nobody else can see it
      if (!iAmAuthority(m.x, m.y, SIM_R, tNow)) continue;
      m._remoteUntil = 0;                                  // mine to drive
      const key = monKey(m);
      let s = sent.get(key);
      if (!s) { s = { x: null, y: null, hp: null, tid: null, at: 0 }; sent.set(key, s); }
      if (!m.alive) { s.x = s.y = null; continue; }        // the kill op already told the tale
      const tid = m.target === player ? Live.myId() : (m.target && m.target.id) | 0;
      if (tid !== s.tid) { s.tid = tid; ops.push(["t", key, tid]); }
      if (m.x !== s.x || m.y !== s.y || m.hp !== s.hp || tNow - s.at >= SNAP_MS) {
        s.x = m.x; s.y = m.y; s.hp = m.hp; s.at = tNow;
        ops.push(["p", key, m.x, m.y, m.dir8 || "south", m.hp]);
      }
    }
    // wandering town NPCs (cosmetic, so position-only and a touch lazier)
    if (world && world.npcs) for (const n of world.npcs) {
      if (ops.length >= MAX_OPS) break;
      if (!n._home) continue;
      if (!nearAnyRemote(n.x, n.y, NEAR_R)) continue;
      if (!iAmAuthority(n.x, n.y, NPC_R, tNow)) continue;
      n._remoteUntil = 0;
      const key = npcKey(n);
      let s = sent.get(key);
      if (!s) { s = { x: null, y: null, lv: null, at: 0 }; sent.set(key, s); }
      if (n.x !== s.x || n.y !== s.y || (n.level | 0) !== s.lv || tNow - s.at >= SNAP_MS * 2) {
        s.x = n.x; s.y = n.y; s.lv = n.level | 0; s.at = tNow;
        ops.push(["np", key, n.x, n.y, n.dir8 || "south", n.level | 0]);
      }
    }
    if (ops.length) Live.sendE(ops.slice(0, MAX_OPS));
  }

  // ---------- incoming ----------
  let _monIdx = null, _monIdxAt = -1, _monIdxLen = -1;
  function monIndex() {
    if (_monIdx && _monIdxLen === monsters.length && now - _monIdxAt < 1000) return _monIdx;
    _monIdx = new Map();
    for (const m of monsters) if (m.kx !== undefined) _monIdx.set(monKey(m), m);
    _monIdxAt = now; _monIdxLen = monsters.length;
    return _monIdx;
  }
  let _npcIdx = null, _npcIdxAt = -1, _npcIdxLen = -1;
  function npcIndex() {
    const list = (world && world.npcs) || [];
    if (_npcIdx && _npcIdxLen === list.length && now - _npcIdxAt < 1000) return _npcIdx;
    _npcIdx = new Map();
    for (const n of list) if (n._home) _npcIdx.set(npcKey(n), n);
    _npcIdxAt = now; _npcIdxLen = list.length;
    return _npcIdx;
  }

  function glideMon(m, x, y, d8) {
    if (m.moving) {   // finalize any in-flight step before redirecting
      m.x = m.moving.tx; m.y = m.moving.ty;
      m.px = PX(m.x); m.py = PX(m.y); m.moving = null;
    }
    if (x > m.x) m.facing = 1; else if (x < m.x) m.facing = -1;
    const d = cheb(m.x, m.y, x, y);
    if (d > 0 && d <= 3 && m.alive)
      m.moving = { fx: m.x, fy: m.y, tx: x, ty: y, t: 0, dur: Math.min(420, 120 * d + 140) };
    else if (d > 0) { m.x = x; m.y = y; m.px = PX(x); m.py = PX(y); }
    if (d8) m.dir8 = d8;
  }

  function applyOps(senderId, ops) {
    const myId = Live.myId();
    const mi = monIndex();
    for (const op of ops) {
      if (!Array.isArray(op) || op.length < 2) continue;
      const kind = op[0], key = String(op[1]);
      if (kind === "np") {
        const n = npcIndex().get(key);
        if (!n) continue;
        // positional authority: lower id outranks us; otherwise only accept
        // for entities we aren't simulating ourselves
        if (senderId > myId && cheb(n.x, n.y, player.x, player.y) <= NPC_R) continue;
        const T = performance.now();
        n._remoteUntil = T + HOLD_MS;
        const x = op[2] | 0, y = op[3] | 0, lv = op[5] | 0;
        if (n.moving) { n.x = n.moving.tx; n.y = n.moving.ty; n.px = PX(n.x); n.py = PX(n.y); n.moving = null; }
        const d = cheb(n.x, n.y, x, y);
        if (d > 0 && d <= 3 && (n.level | 0) === lv) {
          n.moving = { fx: n.x, fy: n.y, tx: x, ty: y, t: 0, dur: Math.min(420, 120 * d + 140) };
          n._mt = T;
        } else if (d > 0 || (n.level | 0) !== lv) {
          n.x = x; n.y = y; n.px = PX(x); n.py = PX(y);
        }
        n.level = lv;
        if (op[4]) n.dir8 = String(op[4]);
        continue;
      }
      const m = mi.get(key);
      if (!m) continue;
      if (kind === "h") {           // anyone's hit lands on the shared bar
        const dmg = Math.max(0, op[2] | 0), hp = Math.max(0, op[3] | 0);
        applying = true;
        try {
          m.hp = Math.min(m.hp, Math.min(hp, monMaxHp(m.kind)));
          m.hitAt = now;
          if (dmg > 0 && m.alive) addSplat(m, dmg);
        } finally { applying = false; }
        continue;
      }
      if (kind === "k") {           // someone landed the killing blow
        if (!m.alive) continue;
        applying = true;
        try {
          m.alive = false; m.target = null; m.hp = 0; m.moving = null;
          m.respawnAt = now + Math.min(600e3, Math.max(1000, op[2] | 0));
          if (cheb(m.x, m.y, player.x, player.y) <= 24) sfx("kill", 0.4);
          if (player.act && player.act.kind === "combat" && player.act.mon === m) player.act = null;
        } finally { applying = false; }
        continue;
      }
      // "p" / "t": positional authority — see the np rule above
      if (senderId > myId && cheb(m.x, m.y, player.x, player.y) <= SIM_R) continue;
      m._remoteUntil = now + HOLD_MS;
      if (kind === "p") {
        const x = op[2] | 0, y = op[3] | 0, hp = op[5];
        if (!m.alive && hp > 0) { m.alive = true; m.fx = null; m.flight = null; }
        if (hp != null) m.hp = Math.max(0, Math.min(hp | 0, monMaxHp(m.kind)));
        glideMon(m, x, y, op[4] ? String(op[4]) : null);
      } else if (kind === "t") {
        const tid = op[2] | 0;
        m.target = tid === myId ? player : (tid ? Live.players.get(tid) || null : null);
      }
    }
  }

  Live.onE(m => {
    const rp = Live.players.get(m.id);
    if (rp) rp._eAt = Date.now();
    if (!m.a) return;
    try { applyOps(m.id, m.a); } catch (e) { /* one bad batch must not kill the frame */ }
  });

  // ---------- combat taps (wrap-by-reassignment; this file loads after
  // combat.js + livesync.js in the bundle, so the chains stack) ----------
  if (typeof addSplat === "function") {
    const oSplat = addSplat;
    // every damage path to a monster ends in addSplat right after hp was
    // decremented (melee, arrows, spells, burns) — one tap catches them all
    addSplat = function (ent, dmg) {
      try {
        if (!applying && dmg > 0 && ent && ent.kind && ent.kx !== undefined && active())
          pend.push(["h", monKey(ent), dmg | 0, Math.max(0, ent.hp | 0)]);
      } catch (e) {}
      return oSplat(ent, dmg);
    };
  }
  if (typeof killMonster === "function") {
    const oKill = killMonster;
    killMonster = function (mon) {
      const wasAlive = mon && mon.alive;
      const r = oKill(mon);
      try {
        if (wasAlive && !applying && mon.kx !== undefined && active())
          pend.push(["k", monKey(mon), Math.max(1000, (mon.respawnAt || now + 7000) - now)]);
      } catch (e) {}
      return r;
    };
  }

  // ---------- per-frame tick (rides Live.tick's caller, main.js) ----------
  function tick() {
    const t = Date.now();
    if (t < batchAt) return;
    batchAt = t + BATCH_MS;
    if (!active()) {
      if (sent.size) sent.clear();
      if (pend.length) pend = [];
      return;
    }
    narrate(t);
    // forget narration state for entities that despawned (retired chunks)
    if (sent.size > 600) {
      const mi = monIndex(), ni = npcIndex();
      for (const k of sent.keys()) if (!mi.has(k) && !ni.has(k)) sent.delete(k);
    }
  }

  window.EntSync = { tick, active,
    status: () => ({ active: active(), narrated: sent.size, pending: pend.length }) };
})();
