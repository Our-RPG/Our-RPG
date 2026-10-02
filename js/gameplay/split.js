// ===== Taiao — split selves & task queues =====
// The player can TEAR THEMSELF APART (X) into up to five bodies. Each body is
// a full snapshot of the player's "personal" fields (position, motion, action,
// hp, air, buffs — and its OWN skill xp); the pack, bank, equipment, quests
// and every other possession stay shared between all of them (one soul, many
// hands). Splitting halves the splitter's xp between the two bodies — levels
// genuinely drop — and merging (X beside another self) adds the xp back
// together. Tab hops between bodies.
//
// Idle bodies aren't statues: every body carries a TASK QUEUE (Option/Alt+click
// appends the clicked action — Blockheads-style). Each frame the inactive
// bodies are ticked through the REAL player systems by swapping their
// snapshot into the global `player`, running stepPlayer()/updateAction(),
// and swapping back out — so a queued "chop the tree" uses genuine pathing,
// tool checks, gather ticks, tutorial hooks and that body's own skill levels,
// with items landing in the shared pack. Hooks kept deliberately tiny:
//   input.js  — Tab / X keys, Option/Alt+click queue capture
//   pathing.js setGoal + input.js walkTo — Split.capture() intercept
//   movement.js — keyboard reads + footstep sfx gated while ghost-ticking
//   main.js   — Split.tick(dt) in the frame loop
//   storage.js — saveGame() deferred during ghost ticks; bodies persisted
//   render3d.js — translucent echo billboards for the inactive bodies
"use strict";

var Split = (() => {
  const MAX_BODIES = 5;

  // the fields that make a body a body — swapped between the global `player`
  // and a stored snapshot on every switch / ghost tick. Everything NOT listed
  // here (inv, equip, bank, quests, kills, tutorial, character, outfit …) is
  // shared by all bodies.
  const SWAP_FIELDS = [
    "x", "y", "px", "py", "level", "moving", "path", "goal", "forced", "act",
    "facing", "dir8", "hp", "air", "nextAtkAt", "lungeT", "lungeDir",
    "stunUntil", "buffs", "sailing", "deck", "driftAt", "_pullAcc",
    "dying", "regenAt", "skills", "queue", "num",
    "inv", // each self carries its OWN pack (user req 2026-09-15) — a ghost
           // gathering on a queue fills its own bags, not the active body's
    "equip", "equipOrder", // …and wears its OWN gear (user req): the share
           // window shows each self's worn items and can hand them across
  ];
  const take = () => { const s = {}; for (const f of SWAP_FIELDS) s[f] = player[f]; return s; };
  const put = s => { for (const f of SWAP_FIELDS) player[f] = s[f]; };

  const bodies = () => (player.bodies = player.bodies || []);
  const myNum = () => player.num || (player.num = 1);
  const count = () => 1 + bodies().length;
  const maxHpOf = sk => 10 + 3 * (levelFromXp((sk && sk.Health) || 0) - 1);

  // ---------- split / merge / switch ----------
  function freeTileBeside() {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = player.x + dx, ny = player.y + dy;
      if (!world.isWater(nx, ny) && passable(nx, ny) && stepClimbOK(player.x, player.y, nx, ny))
        return [nx, ny];
    }
    return null;
  }
  function nextNum() {
    const used = new Set([myNum(), ...bodies().map(b => b.num)]);
    for (let n = 1; n <= MAX_BODIES; n++) if (!used.has(n)) return n;
    return count() + 1;
  }
  function doSplit() {
    if (player.character == null) { log("You need a body before you can divide it — take a form first.", "warn"); return; }
    if (player.dying || player.forced) return;
    // the Dream Forest holds a soul singly (gameplay/dream.js): a second body
    // could stand on-screen at a waystone crossing and shatter the illusion
    if (typeof Dream !== "undefined" && Dream.blocksSplit && Dream.blocksSplit()) {
      log(Dream.blocksSplit(), "warn");
      return;
    }
    if (count() >= MAX_BODIES) { log(`Five of you is as thin as a self can be stretched.`, "warn"); return; }
    const spot = freeTileBeside();
    if (!spot) { log("No room beside you for another self to step out.", "warn"); return; }
    // halve every skill's xp between the two bodies (floor to the new self,
    // the remainder — the ceil half — stays with the splitter): total xp is
    // conserved exactly, and both bodies' LEVELS drop to match their share
    const mine = {}, theirs = {};
    for (const k in player.skills) {
      const xp = player.skills[k] | 0;
      theirs[k] = xp >> 1;
      mine[k] = xp - (xp >> 1);
    }
    const ratio = Math.max(0.05, player.hp / Math.max(1, maxHpOf(player.skills)));
    player.skills = mine;
    player.hp = Math.max(1, Math.min(maxHpOf(mine), Math.round(ratio * maxHpOf(mine))));
    const origNum = myNum();
    const copy = {
      num: nextNum(), x: spot[0], y: spot[1], px: PX(spot[0]), py: PX(spot[1]),
      level: player.level | 0, moving: null, path: [], goal: null, forced: null, act: null,
      facing: -player.facing, dir8: player.dir8 || "south",
      hp: Math.max(1, Math.min(maxHpOf(theirs), Math.round(ratio * maxHpOf(theirs)))),
      air: undefined, nextAtkAt: 0, lungeT: -9999, lungeDir: [0, 0], stunUntil: 0,
      buffs: {}, sailing: null, deck: true, driftAt: 0, _pullAcc: 0,
      dying: null, regenAt: 0, skills: theirs, queue: [],
      inv: player.inv.map(() => null), // the copy steps out empty-handed…
      equip: {}, equipOrder: [],       // …and bare — pass gear through the share window
    };
    bodies().push(copy);
    // control passes to the NEW self (user req): the splitter stays behind as
    // the echo, and you walk on in the copy that just stepped out —
    // empty-handed, so the share window opens to pass it what it needs
    cycleTo(copy.num);
    log(`You tear yourself in two — and step onward in the NEW self (№${myNum()} of ${count()}). Its pack is empty: pass what it needs through the share window. Tab switches; X merges; ⇧X re-opens sharing.`, "gold");
    shareOpen(bodies().find(b => b.num === origNum));
    if (typeof sfx === "function") sfx("levelup", 0.3);
    if (typeof Tele !== "undefined") Tele.ev("split", count());
    uiDirty = true;
    if (typeof saveGame === "function") saveGame();
    syncHud(true);
  }
  // fold a body's xp into the ACTIVE player's skill map (merge & death paths)
  function absorbSkills(b) {
    const sum = {};
    for (const k in player.skills) sum[k] = (player.skills[k] | 0) + ((b.skills && b.skills[k]) | 0);
    for (const k in b.skills) if (!(k in sum)) sum[k] = b.skills[k] | 0;
    player.skills = sum;
  }
  // ---------- per-self inventories ----------
  // addItem's semantics over an ARBITRARY inv array (stacking, meta q/prov
  // averaging). Returns how many units actually fit.
  function invAdd(inv, id, qty, meta) {
    const def = ITEMS[id];
    if (!def || qty <= 0) return 0;
    if (def.stack) {
      const s = inv.find(s2 => s2 && s2.id === id);
      if (s) {
        if (meta && meta.q != null) {
          const oq = s.q != null ? s.q : meta.q;
          s.q = Math.round((oq * s.qty + meta.q * qty) / (s.qty + qty));
          if (meta.prov != null) s.prov = meta.prov;
        }
        s.qty += qty;
        return qty;
      }
      const i = inv.findIndex(s2 => !s2);
      if (i < 0) return 0;
      inv[i] = { id, qty };
      if (meta) { if (meta.q != null) inv[i].q = meta.q; if (meta.prov != null) inv[i].prov = meta.prov; }
      return qty;
    }
    let added = 0;
    for (let n = 0; n < qty; n++) {
      const i = inv.findIndex(s2 => !s2);
      if (i < 0) break;
      inv[i] = { id, qty: 1 };
      if (meta) { if (meta.q != null) inv[i].q = meta.q; if (meta.prov != null) inv[i].prov = meta.prov; }
      added++;
    }
    return added;
  }
  // strip a body's WORN gear into a pack (merge/death): every distinct item
  // comes off — multi-slot pieces clear all their slots, the quiver keeps its
  // count — and whatever doesn't fit spills at (dropX, dropY).
  function pourEquip(eq, toInv, dropX, dropY) {
    let dropped = 0;
    if (!eq) return 0;
    for (const slot in eq) {
      const val = eq[slot];
      if (!val) continue;
      if (typeof val === "object") {           // stack slot (quiver {id, qty})
        const add = invAdd(toInv, val.id, val.qty, null);
        const left = val.qty - add;
        if (left > 0 && dropX != null && typeof dropOnGround === "function") { dropOnGround(val.id, left, dropX, dropY); dropped += left; }
        eq[slot] = null;
        continue;
      }
      const def = ITEMS[val];
      if (def && Array.isArray(def.equip)) {   // one item spanning several slots
        for (const sl of def.equip) if (eq[sl] === val) eq[sl] = null;
      } else eq[slot] = null;
      if (!invAdd(toInv, val, 1, null) && dropX != null && typeof dropOnGround === "function") {
        dropOnGround(val, 1, dropX, dropY); dropped += 1;
      }
    }
    return dropped;
  }
  // pour one pack into another; whatever doesn't fit spills onto the ground
  // at (dropX, dropY). Returns how many units were dropped.
  function pourInv(fromInv, toInv, dropX, dropY) {
    let dropped = 0;
    if (!fromInv) return 0;
    for (let i = 0; i < fromInv.length; i++) {
      const s = fromInv[i];
      if (!s) continue;
      const moved = invAdd(toInv, s.id, s.qty, s);
      const left = s.qty - moved;
      if (left > 0 && typeof dropOnGround === "function" && dropX != null) {
        dropOnGround(s.id, left, dropX, dropY);
        dropped += left;
      }
      fromInv[i] = null;
    }
    return dropped;
  }

  function doMerge(b) {
    absorbSkills(b);
    const sum = player.skills;
    player.hp = Math.min(maxHpOf(sum), Math.max(1, (player.hp | 0) + (b.hp | 0)));
    if (b.queue && b.queue.length) (player.queue = player.queue || []).push(...b.queue);
    // packs AND worn gear pour together; overflow spills at your feet (user req)
    const spilt = pourInv(b.inv, player.inv, player.x, player.y) +
                  pourEquip(b.equip, player.inv, player.x, player.y);
    if (spilt) log(`Your packs merge — ${spilt} item${spilt > 1 ? "s" : ""} spill to the ground at your feet.`, "warn");
    if (shareWith === b) shareClose();
    const arr = bodies();
    arr.splice(arr.indexOf(b), 1);
    log(`You are ${arr.length ? "fewer" : "whole"} again — what was divided flows back together (${count()}/${MAX_BODIES}).`, "gold");
    if (typeof sfx === "function") sfx("levelup", 0.3);
    // Torra's stage counts the reunion (gameplay/tutorial.js "merged" goal)
    if (typeof Tutorial !== "undefined" && Tutorial.onMerge) Tutorial.onMerge();
    if (typeof Tele !== "undefined") Tele.ev("merge", count());
    uiDirty = true;
    if (typeof saveGame === "function") saveGame();
    syncHud(true);
  }
  // the X key: merge with an adjacent self if one is in arm's reach, else split
  function splitOrMerge() {
    const near = bodies().find(b =>
      Math.max(Math.abs(b.x - player.x), Math.abs(b.y - player.y)) <= 1);
    if (near) doMerge(near);
    else doSplit();
  }
  // the ACTIVE body's death (combat.js playerDie): the whole split collapses.
  // Every echo dies with it — their xp (not their queues) crashes back into
  // the one body, which then respawns whole through the normal death flow.
  // A GHOST's own death never lands here (guarded); tick() absorbs it.
  function onDeath() {
    if (ghost) return;
    player.queue = [];               // death wipes the plan
    shareClose();
    const arr = bodies();
    if (!arr.length) return;
    for (const b of arr) {
      absorbSkills(b);
      pourInv(b.inv, player.inv, player.x, player.y);
      pourEquip(b.equip, player.inv, player.x, player.y);
    }
    arr.length = 0;
    log("As you fall, your scattered selves gutter out — what was divided crashes back into one.", "warn");
    uiDirty = true;
    syncHud(true);
  }
  // Collapse every echo back into ONE self, xp conserved — used by doReset and
  // any "start over" path so a split player never reloads as several bodies (or
  // several sparks of light, back on Tūhura). Silent: the caller owns messaging.
  function mergeAll() {
    if (ghost) return;                 // never run mid ghost-tick
    const arr = bodies();
    if (arr.length) {
      for (const b of arr) absorbSkills(b);
      player.hp = Math.min(maxHpOf(player.skills),
        arr.reduce((h, b) => h + (b.hp | 0), player.hp | 0));
      arr.length = 0;
    }
    player.queue = [];
    player.num = 1;
    syncHud(true);
  }
  function cycle(silent) {
    const arr = bodies();
    if (!arr.length) { if (!silent) log("You are only one — press X to split yourself.", "sys"); return; }
    if (player.dying) return;
    arr.push(take());
    put(arr.shift());
    if (!silent) log(`You slip into your other self (№${myNum()} of ${count()}).`, "sys");
    uiDirty = true;
    syncHud(true);
  }
  function cycleTo(num) {
    for (let i = 0; i < MAX_BODIES && myNum() !== num; i++) cycle(true);
    syncHud(true);
  }

  // ---------- task queue ----------
  // goal types that make sense done unattended; everything else (opening a
  // craft window, talking, portals, fights) needs the player present.
  const QUEUEABLE = new Set(["gather", "farm", "farmWater", "pickup", "pickupAll",
    "decorPick", "husbAction", "husbFeed", "stokeFire", "lightFire", "door",
    "obstacle", "placedPickup"]);
  let capturing = null; // { label } while an Option/Alt+click is being captured

  // called from setGoal()/walkTo(): swallow the call into the queue instead
  function capture(goal, tx, ty, reach) {
    if (!capturing) return false;
    const label = capturing.label;
    capturing = null; // one capture per click
    if (goal && !QUEUEABLE.has(goal.type)) {
      log(`"${label}" can't wait in a queue — do that one in person.`, "warn");
      return true; // swallowed anyway: a queue-click never acts immediately
    }
    const q = (player.queue = player.queue || []);
    if (q.length >= 20) { log("This self's queue is full (20 tasks).", "warn"); return true; }
    q.push({ goal: goal ? { ...goal } : null, tx, ty, reach, label });
    // the Bushman's stage counts queued felling jobs (gameplay/tutorial.js)
    if (typeof Tutorial !== "undefined" && Tutorial.onQueue) Tutorial.onQueue(goal);
    // solo play skips the split-selves jargon — the queue is just "yours"
    log(bodies().length
      ? `Queued for self №${myNum()}: ${label} (${q.length} waiting)`
      : `Queued: ${label} (${q.length} waiting)`, "sys");
    syncHud(true);
    return true;
  }
  // input.js Option/Alt+click: run the menu default under capture
  function tryQueueClick(item) {
    capturing = { label: item.label };
    try { item.fn(); } finally { capturing = null; }
    return true;
  }
  // start the next queued task using the real goal machinery (current body)
  function pursueTask(t) {
    // live world objects go stale across chunk evictions/reloads — re-resolve
    // node-backed goals at the target tile before executing
    if (t.goal && (t.goal.type === "gather" || t.goal.type === "farm" || t.goal.type === "farmWater" ||
                   t.goal.type === "stokeFire" || t.goal.type === "lightFire")) {
      const n = world.nodeAt(t.tx, t.ty) || dynNodes.find(d => d.x === t.tx && d.y === t.ty);
      if (!n) { log(`Self №${myNum()}: "${t.label}" is gone — skipped.`, "warn"); return; }
      t.goal.node = n;
    }
    const p = findPath(t.tx, t.ty, t.reach);
    if (p === null) { log(`Self №${myNum()} can't reach "${t.label}" — skipped.`, "warn"); return; }
    player.path = p;
    if (t.goal) {
      // _fromQueue keeps the white tile outline (render3d) on the target
      // until the body actually arrives and the goal executes
      player.goal = { ...t.goal, tx: t.tx, ty: t.ty, reach: t.reach, _fromQueue: true };
      if (p.length === 0) executeGoal();
    }
  }
  // tiles awaiting queued work, for the renderer's white outlines: every
  // body's queued targets, plus the tile a body is currently WALKING to off
  // its queue (the outline drops the moment the goal executes on arrival)
  function queuedTiles() {
    const out = [];
    const add = b => {
      if (b.queue) for (const t of b.queue) out.push({ x: t.tx, y: t.ty });
      if (b.goal && b.goal._fromQueue) out.push({ x: b.goal.tx, y: b.goal.ty });
    };
    if (typeof player !== "undefined" && player) add(player);
    for (const b of bodies()) add(b);
    return out;
  }
  const idleNow = () => !player.dying && !player.forced && !player.act && !player.goal &&
    !player.moving && !(player.path && player.path.length);

  // ---------- the share window (bank-like, between two selves' packs) ----------
  // Opens automatically on split (the copy steps out empty-handed) and via
  // ⇧X beside another self. Click moves 1, shift 5, alt the whole stack —
  // the bank's own conventions. Auto-closes when the pair drifts apart.
  let shareEl = null, shareWith = null, shareEscBound = false;
  function shareOpen(other) {
    if (!other) return;
    shareWith = other;
    if (!shareEscBound) {
      shareEscBound = true;
      document.addEventListener("keydown", e => {
        if (e.key === "Escape" && shareEl) { e.stopPropagation(); shareClose(); }
      }, true);
    }
    shareRender();
  }
  function shareClose() {
    if (shareEl) shareEl.remove();
    shareEl = null; shareWith = null;
  }
  function shareMove(from, to, idx, n) {
    const s = from[idx];
    if (!s) return;
    const want = Math.max(1, Math.min(n, s.qty));
    const moved = invAdd(to, s.id, want, s);
    if (!moved) { log("Their pack has no room for that.", "warn"); return; }
    s.qty -= moved;
    if (s.qty <= 0) from[idx] = null;
    uiDirty = true;
    shareRender();
  }
  // hand a WORN item across: it comes off this body (all its slots) and
  // lands in the other self's pack, ready to be equipped there
  function shareUnequip(eq, slot, toInv) {
    const val = eq[slot];
    if (!val) return;
    if (typeof val === "object") { // quiver stack
      const add = invAdd(toInv, val.id, val.qty, null);
      if (!add) { log("Their pack has no room for that.", "warn"); return; }
      if (add < val.qty) val.qty -= add;
      else eq[slot] = null;
    } else {
      if (!invAdd(toInv, val, 1, null)) { log("Their pack has no room for that.", "warn"); return; }
      const def = ITEMS[val];
      if (def && Array.isArray(def.equip)) {
        for (const sl of def.equip) if (eq[sl] === val) eq[sl] = null;
      } else eq[slot] = null;
    }
    if (eq === player.equip && typeof equipOrderDrop === "function") equipOrderDrop(slot);
    uiDirty = true;
    shareRender();
  }
  // one entry per physical worn item (a chestplate spans several slots but is
  // ONE item; two same-id rings in two slots are genuinely two)
  function wornEntries(eq) {
    const out = [], covered = new Set();
    const slots = (typeof EQUIP_SLOTS !== "undefined") ? EQUIP_SLOTS : Object.keys(eq || {});
    for (const slot of slots) {
      if (covered.has(slot)) continue;
      const val = eq && eq[slot];
      if (!val) continue;
      if (typeof val === "object") { out.push({ slot, id: val.id, qty: val.qty }); continue; }
      const def = ITEMS[val];
      if (def && Array.isArray(def.equip)) for (const sl of def.equip) if (eq[sl] === val) covered.add(sl);
      out.push({ slot, id: val, qty: 1 });
    }
    return out;
  }
  function shareRender() {
    if (!shareWith) return;
    if (!shareEl) {
      shareEl = document.createElement("div");
      shareEl.id = "sharewin";
      shareEl.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:70;" +
        "background:#121a28;border:1px solid #3a4a6a;border-radius:10px;padding:12px 14px;" +
        "box-shadow:0 6px 28px rgba(0,0,0,.6);color:#cdd7ea;font:12px/1.4 inherit;max-width:560px";
      document.body.appendChild(shareEl);
    }
    shareEl.innerHTML = "";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px";
    head.innerHTML = `<b style="color:#7fe3c7">Share between selves</b>` +
      `<span style="color:#8fa3c8">click 1 · shift 5 · alt all</span>`;
    const x = document.createElement("button");
    x.textContent = "×";
    x.style.cssText = "margin-left:10px;background:none;border:1px solid #3a4a6a;border-radius:6px;color:#cdd7ea;cursor:pointer";
    x.onclick = shareClose;
    head.appendChild(x);
    shareEl.appendChild(head);
    const cols = document.createElement("div");
    cols.style.cssText = "display:flex;gap:14px";
    const pane = (label, inv, otherInv, eq) => {
      const d = document.createElement("div");
      d.innerHTML = `<div style="margin-bottom:4px;color:#ffd75e">${label}</div>`;
      const g = document.createElement("div");
      g.style.cssText = "display:grid;grid-template-columns:repeat(6,36px);gap:3px";
      inv.forEach((s, i) => {
        const def = s && ITEMS[s.id];
        const el = (typeof slotEl === "function")
          ? slotEl(def ? def.icon : null, s ? s.qty : undefined, def ? `Pass ${def.name}` : "")
          : document.createElement("div");
        if (s && def) {
          el.style.cursor = "pointer";
          el.onclick = e => shareMove(inv, otherInv, i, e.altKey ? s.qty : e.shiftKey ? 5 : 1);
        }
        g.appendChild(el);
      });
      d.appendChild(g);
      // worn gear, below the pack: click hands the piece to the other self
      const worn = wornEntries(eq);
      const wl = document.createElement("div");
      wl.style.cssText = "margin:7px 0 4px;color:#8fa3c8";
      wl.textContent = worn.length ? "worn — click to hand across" : "worn — nothing";
      d.appendChild(wl);
      const wg = document.createElement("div");
      wg.style.cssText = "display:grid;grid-template-columns:repeat(6,36px);gap:3px;min-height:36px";
      for (const w of worn) {
        const def = ITEMS[w.id];
        const el = (typeof slotEl === "function")
          ? slotEl(def && def.icon, w.qty, def ? `Hand over ${def.name}` : "")
          : document.createElement("div");
        el.style.cssText += ";cursor:pointer;outline:1px solid rgba(127,227,199,.35)";
        el.onclick = () => shareUnequip(eq, w.slot, otherInv);
        wg.appendChild(el);
      }
      d.appendChild(wg);
      return d;
    };
    cols.appendChild(pane(`You (№${myNum()})`, player.inv, shareWith.inv, player.equip));
    cols.appendChild(pane(`Other self (№${shareWith.num})`, shareWith.inv, player.inv, shareWith.equip));
    shareEl.appendChild(cols);
  }
  function shareWithAdjacent() {
    const near = bodies().find(b =>
      Math.max(Math.abs(b.x - player.x), Math.abs(b.y - player.y)) <= 1);
    if (!near) { log("No other self within arm's reach to share with.", "warn"); return; }
    shareOpen(near);
  }

  // ---------- the frame tick ----------
  let ghost = false;              // true while an INACTIVE body is swapped in
  let pendingSave = false;        // saveGame() calls issued during a ghost tick
  const isGhost = () => ghost;
  // storage.js saveGame(): saving mid-ghost-tick would snapshot the wrong body
  function deferSave() { if (!ghost) return false; pendingSave = true; return true; }

  const needsTick = b => !!(b.dying || b.act || b.goal || b.moving || b.forced ||
    (b.path && b.path.length) || (b.queue && b.queue.length) || world.isWater(b.x, b.y));

  function tick(dt) {
    if (typeof player === "undefined" || !world) return;
    player.queue = player.queue || [];
    // the ACTIVE body pulls queued work whenever it's fully idle and unhandled
    if (idleNow() && player.queue.length &&
        !keys.w && !keys.a && !keys.s && !keys.d)
      pursueTask(player.queue.shift());
    // the INACTIVE bodies live too: swap each into the global player and run
    // one frame of the real systems, then swap back out
    const arr = bodies();
    if (arr.length) {
      const active = take();
      let fallen = null;
      ghost = true;
      // multiplayer follow (net/player-actions.js): while a follow is active
      // every self trails the leader too, so a split player moves as a group —
      // force-tick otherwise-idle bodies so Follow can give them a path
      const following = typeof Follow !== "undefined" && Follow.active && Follow.active();
      try {
        for (const b of arr) {
          if (!needsTick(b) && !following) continue;
          // a ghost that died last frame is ABSORBED, never respawned — catch
          // it here, before stepPlayer's dying branch would wake it in town
          if (b.dying) { (fallen = fallen || []).push(b); continue; }
          put(b);
          try {
            if (idleNow() && player.queue.length) pursueTask(player.queue.shift());
            else if (following) Follow.stepBody();   // trail the leader (throttled per body)
            stepPlayer(dt);
            updateAction();
          } finally {
            const after = take();
            for (const f of SWAP_FIELDS) b[f] = after[f];
          }
        }
      } finally {
        ghost = false;
        put(active);
      }
      // fallen echoes: their xp rushes back to the active body (queues die
      // with them); the count shrinks toward one
      if (fallen) for (const b of fallen) {
        const i = arr.indexOf(b);
        if (i >= 0) arr.splice(i, 1);
        absorbSkills(b);
        // the fallen echo's pack and gear rush to you too; overflow lies where it fell
        const spilt = pourInv(b.inv, player.inv, b.x, b.y) +
                      pourEquip(b.equip, player.inv, b.x, b.y);
        if (shareWith === b) shareClose();
        log(`Your other self (№${b.num}) perishes — its strength${spilt ? " and part of its pack" : " and pack"} rush back to you${spilt ? `; ${spilt} item${spilt > 1 ? "s" : ""} lie where it fell` : ""}.`, "warn");
        uiDirty = true;
        syncHud(true);
      }
      if (pendingSave) { pendingSave = false; if (typeof saveGame === "function") saveGame(); }
    }
    // share window upkeep: it closes when the pair drifts out of arm's reach
    // (or the other self is gone), and refreshes so a working ghost's pack
    // stays live on screen
    if (shareEl && shareWith) {
      const gone = bodies().indexOf(shareWith) < 0;
      const apart = !gone &&
        Math.max(Math.abs(shareWith.x - player.x), Math.abs(shareWith.y - player.y)) > 1;
      if (gone || apart || player.dying) shareClose();
      else if (!tick._shareAt || now - tick._shareAt > 900) { tick._shareAt = now; shareRender(); }
    }
    syncHud(false);
  }

  // ---------- save / load ----------
  // bodies persist position + their own xp; motion/action/queues are
  // session-only, exactly like the active player's act/path
  const serializeBody = b => ({ num: b.num, x: b.x, y: b.y, level: b.level | 0, hp: b.hp | 0, skills: b.skills || {},
    inv: (b.inv || []).map(s => (s ? { ...s } : null)),
    equip: Object.fromEntries(Object.entries(b.equip || {})
      .filter(([, v]) => v)
      .map(([k, v]) => [k, typeof v === "object" ? { ...v } : v])) });
  function reviveBody(raw) {
    const skills = { ...(typeof freshSkills === "function" ? freshSkills() : {}) };
    for (const k in raw.skills || {}) if (Number.isFinite(raw.skills[k])) skills[k] = raw.skills[k];
    return {
      num: raw.num || 2, x: raw.x, y: raw.y, px: PX(raw.x), py: PX(raw.y),
      level: raw.level | 0, moving: null, path: [], goal: null, forced: null, act: null,
      facing: 1, dir8: "south",
      hp: Math.max(1, Math.min(maxHpOf(skills), raw.hp | 0 || maxHpOf(skills))),
      air: undefined, nextAtkAt: 0, lungeT: -9999, lungeDir: [0, 0], stunUntil: 0,
      buffs: {}, sailing: null, deck: true, driftAt: 0, _pullAcc: 0,
      dying: null, regenAt: 0, skills, queue: [],
      // per-self pack, padded to the live inventory size (pre-split-inventory
      // saves revive empty-handed — their items stayed with the active body)
      inv: Array.from({ length: (player && player.inv && player.inv.length) || 30 },
        (_, i) => (raw.inv && raw.inv[i] ? { ...raw.inv[i] } : null)),
      equip: Object.fromEntries(Object.entries(raw.equip || {})
        .map(([k, v]) => [k, v && typeof v === "object" ? { ...v } : v])),
      equipOrder: [],
    };
  }

  // ---------- HUD: one chip per self, active highlighted, queue counts ----------
  let hudEl = null, hudSig = "";
  function syncHud(force) {
    const n = count();
    const show = n > 1 || (player.queue && player.queue.length);
    if (!show) { if (hudEl) { hudEl.remove(); hudEl = null; hudSig = ""; } return; }
    const parts = [{ num: myNum(), q: (player.queue || []).length, on: true }]
      .concat(bodies().map(b => ({ num: b.num, q: (b.queue || []).length, on: false, busy: needsTick(b) })))
      .sort((a, b2) => a.num - b2.num);
    const sig = parts.map(p => `${p.num}:${p.q}:${p.on ? 1 : 0}:${p.busy ? 1 : 0}`).join("|");
    if (!force && sig === hudSig && hudEl) return;
    hudSig = sig;
    if (!hudEl) {
      hudEl = document.createElement("div");
      hudEl.id = "splitbar";
      hudEl.style.cssText = "position:fixed;bottom:10px;left:50%;transform:translateX(-50%);z-index:800;" +
        "display:flex;gap:6px;align-items:center;background:rgba(14,18,28,.88);border:1px solid #3a4a6a;" +
        "border-radius:9px;padding:5px 10px;font:11px/1.3 inherit;color:#cdd7ea;";
      document.body.appendChild(hudEl);
    }
    hudEl.innerHTML = `<span style="color:#8fa3c8;margin-right:2px">selves</span>` + parts.map(p =>
      `<span data-num="${p.num}" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;` +
      `padding:2px 8px;border-radius:7px;border:1px solid ${p.on ? "#7fe3c7" : "#3a4a6a"};` +
      `background:${p.on ? "rgba(127,227,199,.16)" : "rgba(35,42,61,.6)"};color:${p.on ? "#7fe3c7" : "#b8c4dd"}">` +
      `№${p.num}${p.q ? `<span style="font-size:10px;background:rgba(255,215,94,.18);color:#ffd75e;border-radius:6px;padding:0 5px">${p.q}</span>` : ""}` +
      `${!p.on && p.busy ? `<span style="color:#7fe3c7">⚒</span>` : ""}</span>`).join("") +
      `<span style="color:#5a6a8a;margin-left:4px">Tab · X · ⇧X share</span>`;
    for (const el of hudEl.querySelectorAll("[data-num]"))
      el.onclick = () => cycleTo(+el.dataset.num);
  }

  return {
    MAX_BODIES,
    count, // live body count (gameplay/dream.js gates the dream on a whole soul)
    splitOrMerge, cycle, cycleTo, tick, onDeath, mergeAll, share: shareWithAdjacent,
    capture, tryQueueClick, queuedTiles,
    // is a SECOND self currently busy (acting / queued / walking)? — the
    // tutorial's "keep both selves working" check (gameplay/tutorial.js)
    twinBusy: () => bodies().some(b => b.act || b.goal ||
      (b.queue && b.queue.length) || (b.path && b.path.length)),
    isGhost, deferSave,
    serializeBody, reviveBody,
    syncHud,
  };
})();
if (typeof window !== "undefined") window.Split = Split;
