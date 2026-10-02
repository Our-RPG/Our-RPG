// ===== Our RPG — player-to-player actions (follow / give / feed) =====
// The right-click half of multiplayer: input.js's context menu offers
// Follow / Trade / Give / Feed / Whisper on any remote player's tile, and
// this file supplies the machinery behind three of them:
//
//   Follow   client-side pathing: every ~400ms, path to one tile beside the
//            target (their livesync body keeps x/y fresh). Walking somewhere
//            yourself, starting any goal, or losing them (log-off, >80 tiles)
//            breaks the follow.
//   Give     a one-sided escrowed transfer: pick items (bank click grammar),
//            the items leave your pack the moment you send, and the server
//            (live.js gift escrow) re-delivers the gcommit on every hello
//            until the recipient acks — a mid-give disconnect can't eat them.
//            Applied idempotently by gift id, like trade commits.
//   Feed     one food item, eaten by THEM: you lose the food, their client
//            applies the heal/well-fed exactly as if they'd eaten it.
//
// Inert offline/in DEV (no Live socket).
"use strict";

(function () {
  const DEV = typeof DEV_MODE !== "undefined" && DEV_MODE;
  const URL_ = typeof SERVER_URL !== "undefined" ? SERVER_URL : "";
  if (DEV || !URL_ || typeof Live === "undefined") {
    window.Follow = { tick: () => {}, start: () => {}, stop: () => {}, target: () => null };
    window.PlayerActions = { give: () => {}, feed: () => {} };
    return;
  }

  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const say = (msg, cls) => { if (typeof log === "function") log(msg, cls || "sys"); };
  const itemName = id => (typeof ITEMS !== "undefined" && ITEMS[id] && ITEMS[id].name) || id;

  // ---------------- follow ----------------
  let fTarget = null;      // {id, name}
  let fAt = 0;

  function followStop(quiet) {
    if (fTarget && !quiet) say("You stop following " + fTarget.name + ".");
    fTarget = null;
  }
  function followStart(id) {
    const rp = Live.players.get(id);
    if (!rp) return;
    fTarget = { id, name: rp.name };
    say("You follow " + rp.name + ". (Walking somewhere yourself stops following.)");
  }
  function followTick() {
    if (!fTarget) return;
    const t = Date.now();
    if (t < fAt) return;
    fAt = t + 400;
    const rp = Live.players.get(fTarget.id);
    if (!rp || !Live.connected()) { say("You've lost " + fTarget.name + "."); followStop(true); return; }
    const d = Math.max(Math.abs(rp.x - player.x), Math.abs(rp.y - player.y));
    if (d > 80) { say(rp.name + " is too far away — you stop following."); followStop(true); return; }
    if (d <= 1) return;                       // right beside them — rest
    if (player.forced || player.dying) return;
    if (player.act) return;                   // mid-action: don't yank the body
    const p = findPath(rp.x, rp.y, 1);
    if (p) player.path = p;
  }
  // a deliberate walk or goal of your own breaks the follow (wrap-by-
  // reassignment — this file loads after input.js/pathing.js in the bundle)
  if (typeof walkTo === "function") {
    const oWalk = walkTo;
    walkTo = function (...a) { followStop(); return oWalk(...a); };
  }
  if (typeof setGoal === "function") {
    const oGoal = setGoal;
    setGoal = function (...a) { followStop(); return oGoal(...a); };
  }

  window.Follow = {
    tick: followTick,
    start: followStart,
    stop: followStop,
    target: () => fTarget,
  };

  // ---------------- shared picker panel ----------------
  const css = document.createElement("style");
  css.textContent = `
  #pgive { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
    width:380px; z-index:62; background:rgba(16,22,30,0.96); border:1px solid #46586a;
    border-radius:10px; padding:12px; color:#e6eef6; display:none;
    font:12px OpenDyslexic, Verdana, sans-serif; }
  #pgive.on { display:block; }
  #pgive h3 { margin:0 0 8px; font-size:14px; color:#a8ffc9; }
  #pgive .pg-box { background:rgba(10,14,20,0.8); border-radius:6px; padding:6px;
    min-height:40px; max-height:110px; overflow-y:auto; margin-bottom:6px; }
  #pgive .pg-it { display:flex; justify-content:space-between; gap:6px; padding:1px 2px; }
  #pgive .pg-pick .pg-it { cursor:pointer; }
  #pgive .pg-pick .pg-it:hover { background:rgba(80,110,140,0.25); }
  #pgive .pg-it button { background:none; border:none; color:#ff9f8f; cursor:pointer; font:inherit; }
  #pgive .pg-foot { display:flex; gap:8px; margin-top:8px; align-items:center; }
  #pgive .pg-foot button { background:#24463a; color:#c9ffe0; border:1px solid #3a6a52;
    border-radius:6px; padding:5px 14px; cursor:pointer; font:inherit; }
  #pgive .pg-foot button.cancel { background:#46282a; color:#ffd0c9; border-color:#6a3a3e; }
  #pgive .pg-hint { flex:1; color:#9fb7c9; font-size:11px; }`;
  document.head.appendChild(css);

  const panel = document.createElement("div");
  panel.id = "pgive";
  panel.innerHTML = `<h3></h3>
    <div class="pg-sel-t"></div><div class="pg-box pg-sel"></div>
    <div class="pg-pick-t"></div><div class="pg-box pg-pick"></div>
    <div class="pg-foot"><button class="go"></button>
      <button class="cancel">Cancel</button><div class="pg-hint"></div></div>`;
  document.body.appendChild(panel);

  // P: null | { mode:"give"|"feed", peerId, peerName, sel:[[id,qty],...] }
  let P = null;
  panel.querySelector(".cancel").onclick = () => { P = null; renderPanel(); };

  const countOf = id => (typeof countItem === "function") ? countItem(id) : 0;
  const selQty = id => { const e = P.sel.find(x => x[0] === id); return e ? e[1] : 0; };
  const isFood = def => def && !def.place && (def.heals > 0 || def.wellFed || def.drinkBuff ||
    (def.potion && def.potion.heal));

  function changeSel(id, delta) {
    if (!P) return;
    const have = countOf(id);
    let e = P.sel.find(x => x[0] === id);
    const cur = e ? e[1] : 0;
    const next = Math.max(0, Math.min(have, cur + delta));
    if (next === cur) return;
    if (!e && next > 0) P.sel.push([id, next]);
    else if (e && next > 0) e[1] = next;
    else if (e) P.sel.splice(P.sel.indexOf(e), 1);
    renderPanel();
  }

  function renderPanel() {
    if (!P) { panel.classList.remove("on"); return; }
    panel.classList.add("on");
    const feed = P.mode === "feed";
    panel.querySelector("h3").textContent = (feed ? "Feed " : "Give to ") + P.peerName;
    panel.querySelector(".pg-sel-t").textContent = feed ? "They will eat" : "You will give";
    panel.querySelector(".pg-pick-t").textContent =
      (feed ? "Your food" : "Your pack") + " (click to add; Shift=5, Alt=all)";
    const selEl = panel.querySelector(".pg-sel"), pickEl = panel.querySelector(".pg-pick");
    selEl.innerHTML = pickEl.innerHTML = "";
    for (const [id, n] of P.sel) {
      const d = document.createElement("div");
      d.className = "pg-it";
      d.innerHTML = `<span>${esc(itemName(id))} × ${n}</span>`;
      const b = document.createElement("button");
      b.textContent = "−";
      b.onclick = e => changeSel(id, e.altKey ? -1e9 : e.shiftKey ? -5 : -1);
      d.appendChild(b);
      selEl.appendChild(d);
    }
    const counts = new Map();
    for (const s of player.inv) if (s && s.id) counts.set(s.id, (counts.get(s.id) || 0) + s.qty);
    for (const [id, n] of counts) {
      if (feed && !isFood(ITEMS[id])) continue;
      const left = n - selQty(id);
      if (left <= 0) continue;
      const d = document.createElement("div");
      d.className = "pg-it";
      d.innerHTML = `<span>${esc(itemName(id))} × ${left}</span><span>+</span>`;
      d.onclick = e => changeSel(id, feed ? 1 : e.altKey ? 1e9 : e.shiftKey ? 5 : 1);
      pickEl.appendChild(d);
    }
    const total = P.sel.reduce((a, [, n]) => a + n, 0);
    const go = panel.querySelector(".go");
    go.textContent = feed ? "Feed" : "Give";
    go.disabled = !total;
    panel.querySelector(".pg-hint").textContent = feed
      ? "They eat it on the spot — heals them, not you."
      : total ? total + " item" + (total > 1 ? "s" : "") + " will leave your pack." : "";
  }

  panel.querySelector(".go").onclick = () => {
    if (!P || !P.sel.length) return;
    const peer = Live.players.get(P.peerId);
    if (!peer) { say("They're gone."); P = null; renderPanel(); return; }
    // the items leave the giver NOW; the server escrow guarantees delivery
    for (const [id, n] of P.sel) {
      if (countOf(id) < n) { say("You no longer have some of those items."); renderPanel(); return; }
    }
    if (P.mode === "feed") {
      const [id] = P.sel[0];
      removeItem(id, 1);
      Live.sendFeed(P.peerId, id);
      say("You feed " + P.peerName + " your " + itemName(id).toLowerCase() + ".");
    } else {
      for (const [id, n] of P.sel) removeItem(id, n);
      Live.sendGive(P.peerId, P.sel);
      say("You give " + P.peerName + " " +
        P.sel.map(([id, n]) => itemName(id) + (n > 1 ? " ×" + n : "")).join(", ") + ".");
    }
    if (typeof uiDirty !== "undefined") uiDirty = true;
    if (typeof saveGame === "function") saveGame();
    P = null;
    renderPanel();
  };

  function openPanel(mode, id) {
    const rp = Live.players.get(id);
    if (!rp) return;
    P = { mode, peerId: id, peerName: rp.name, sel: [] };
    renderPanel();
  }

  // ---------------- receiving: gifts ----------------
  const GIFT_KEY = "taiao_gifts_applied";
  const loadApplied = () => {
    try { return new Set(JSON.parse(localStorage.getItem(GIFT_KEY) || "[]")); } catch (e) { return new Set(); }
  };
  const saveApplied = set => {
    try { localStorage.setItem(GIFT_KEY, JSON.stringify([...set].slice(-200))); } catch (e) {}
  };
  Live.onGift(m => {
    if (!m.gid) return;
    const applied = loadApplied();
    if (!applied.has(m.gid)) {
      let got = 0;
      for (const [id, n] of (m.items || []))
        if (n > 0 && typeof ITEMS !== "undefined" && ITEMS[id]) { addItem(id, n); got += n; }
      applied.add(m.gid); saveApplied(applied);
      if (got) {
        const who = m.fromName || Live.nameOf(m.from) || "Someone";
        say(who + " gives you " +
          (m.items || []).map(([id, n]) => itemName(id) + (n > 1 ? " ×" + n : "")).join(", ") + ".", "gold");
        if (typeof sfx === "function") sfx("pickup", 0.6);
        if (typeof uiDirty !== "undefined") uiDirty = true;
        if (typeof saveGame === "function") saveGame();
      }
    }
    // (re-)ack so the escrow record retires — harmless if already gone
    Live.sendGiftAck(m.gid);
  });

  // ---------------- receiving: being fed ----------------
  Live.onFeed(m => {
    const def = typeof ITEMS !== "undefined" && ITEMS[m.item];
    if (!def) return;
    const who = m.name || Live.nameOf(m.id) || "Someone";
    let healed = 0;
    const ph = def.potion && def.potion.heal;
    const heals = def.heals || ph || 0;
    if (heals > 0) {
      healed = Math.min(heals, maxHp() - player.hp);
      if (healed > 0) player.hp += healed;
    }
    if (def.wellFed) player.wellFedUntil = Math.max(player.wellFedUntil || 0, now + def.wellFed);
    if (def.drinkBuff) player.buffs[def.drinkBuff.skill] = { amt: def.drinkBuff.amt, until: now + def.drinkBuff.dur };
    say(who + " feeds you " + itemName(m.item).toLowerCase() + "." +
      (healed ? " It heals " + healed + " HP." : "") +
      (def.wellFed ? " You feel well fed." : ""), "gold");
    if (typeof sfx === "function") sfx("eat", 0.7);
    if (typeof addFloat === "function" && healed)
      addFloat("+" + healed, player.px, player.py - 40, "#8fff9f", 14);
    if (typeof uiDirty !== "undefined") uiDirty = true;
  });

  window.PlayerActions = {
    give: id => openPanel("give", id),
    feed: id => openPanel("feed", id),
  };
})();
