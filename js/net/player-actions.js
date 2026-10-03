// ===== Our RPG — player-to-player actions (follow / give / feed / commission)
// The right-click half of multiplayer: input.js's context menu offers
// Follow / Unfollow / Commission / Trade / Give / Feed / Whisper on any remote
// player's tile (any of their split bodies too), and this file drives them:
//
//   Follow   STICKY client-side pathing: every body you command (the active
//            one AND all your split selves) paths toward the leader and keeps
//            doing so until you log out, the LEADER logs out, you pick
//            "Unfollow", or you follow someone else. Your own walking does NOT
//            end it (the spec: follow persists). The leader is notified.
//   Commission  pay gold to be GUIDED somewhere: you escrow a travel price,
//            pick a destination, and follow the leader to it. Reach it together
//            and the whole price is released to the leader. Cancel partway
//            (either side unfollows or logs out) and the leader is paid for the
//            distance covered — refund = (remaining/original) × price, the rest
//            to the leader. Escrow + settlement live in the LiveZone DO.
//   Give     a one-sided escrowed transfer: pick items, they leave your pack at
//            once, the server re-delivers the gift until the recipient acks.
//   Feed     one food item, eaten by THEM (their client applies the heal).
//
// Inert offline/in DEV (no Live socket).
"use strict";

(function () {
  const DEV = typeof DEV_MODE !== "undefined" && DEV_MODE;
  const URL_ = typeof SERVER_URL !== "undefined" ? SERVER_URL : "";
  if (DEV || !URL_ || typeof Live === "undefined") {
    window.Follow = { tick: () => {}, start: () => {}, stop: () => {}, stepBody: () => {},
      active: () => false, following: () => 0, target: () => null };
    window.PlayerActions = { give: () => {}, feed: () => {}, commission: () => {}, pickUp: () => {} };
    window.Hitch = { toggle: () => {}, active: () => false, offerFor: () => null };
    return;
  }

  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const say = (msg, cls) => { if (typeof log === "function") log(msg, cls || "sys"); };
  const itemName = id => (typeof ITEMS !== "undefined" && ITEMS[id] && ITEMS[id].name) || id;
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

  // ---------------- follow ----------------
  // fTarget: { id, name, commission } — commission is null for a plain follow,
  // else the active commission record { cid, price, dest:{x,y}, origDist }.
  let fTarget = null;
  const fRepathAt = new Map();   // body number -> next A* time (throttle per body)

  const followingId = () => (fTarget ? fTarget.id : 0);
  const isFollowing = id => !!fTarget && fTarget.id === id;

  // reasons: "manual" (Unfollow), "switch" (followed another), "lost" (leader
  // gone/logged out), "died" (we were slain mid-trip), "arrived" (commission
  // delivered — no settlement here). Every reason but "arrived" is a BROKEN
  // contract: the escrow settles for the distance covered.
  function followStop(reason) {
    if (!fTarget) return;
    const prev = fTarget;
    fTarget = null;
    fRepathAt.clear();
    // a running commission settles (partial) on any ending that isn't delivery
    if (prev.commission && reason !== "arrived")
      Live.sendCommissionCancel(prev.commission.cid, commissionRemaining(prev));
    if (reason !== "switch" && reason !== "arrived") Live.sendFollowNote(prev.id, false);
    if (reason === "manual") say("You stop following " + prev.name + "." +
      (prev.commission ? " The commission settles for the distance covered." : ""));
    else if (reason === "lost") say(prev.name + " is gone — you stop following.", "warn");
    else if (reason === "died" && prev.commission) say("You were slain mid-journey — your commission settles for the distance covered.", "warn");
  }

  function followStart(id, commission) {
    const rp = Live.players.get(id);
    if (!rp) { say("They're not nearby."); return; }
    if (isFollowing(id) && !commission) { say("You're already following " + rp.name + "."); return; }
    if (fTarget) followStop("switch");      // following someone new ends (and settles) the old one
    fTarget = { id, name: rp.name, commission: commission || null };
    fRepathAt.clear();
    Live.sendFollowNote(id, true);
    if (!commission) say("You now follow " + rp.name + ". Right-click them → Unfollow to stop.");
  }

  // path the CURRENT global `player` (the active body, or a split self the
  // moment Split.tick swaps it in) one tile toward the leader. Throttled per
  // body so a pack of selves doesn't flood A*.
  function followStepBody() {
    if (!fTarget || player.dying || player.forced || player.act) return;
    if (player.queue && player.queue.length) return;          // its own queued work first
    if (player.goal && player.goal._fromQueue) return;
    const rp = Live.players.get(fTarget.id);
    if (!rp) return;                                          // leader out of zone — followTick decides
    const key = player.num || 1;
    const t = Date.now();
    const walking = player.path && player.path.length;
    if (t < (fRepathAt.get(key) || 0) && walking) return;
    fRepathAt.set(key, t + 350);
    if (cheb(rp.x, rp.y, player.x, player.y) <= 1) { if (walking) player.path = []; return; }
    const p = findPath(rp.x, rp.y, 1);
    if (p && p.length) player.path = p;
  }

  function followTick() {
    commissionsLeaderTick();              // guide side runs even when we follow no one
    hitchTick();                          // our own roadside offer, if any
    if (!fTarget) return;
    if (player.dying) { followStop("died"); return; }   // death breaks the contract + settles
    if (!Live.connected()) return;        // our own socket blip: pause, don't end
    const rp = Live.players.get(fTarget.id);
    if (!rp) {
      // leader not in our zone: still online (crossed a boundary) → pause and
      // wait for them to come back; truly offline → that's a logout, end+settle
      const online = typeof Hub !== "undefined" && Hub.online && Hub.online.has(fTarget.id);
      if (!online) followStop("lost");
      return;
    }
    followStepBody();                     // the active body (ghosts are driven by Split.tick)
    if (fTarget.commission) commissionTick(rp);
  }

  window.Follow = {
    tick: followTick,
    start: followStart,
    stop: () => followStop("manual"),
    stepBody: followStepBody,        // Split.tick calls this per swapped-in ghost
    active: () => !!fTarget,
    following: followingId,          // id of whoever we follow (0 = nobody)
    isFollowing,
    target: () => fTarget,
  };

  // ---------------- commission (pay-to-be-guided) ----------------
  // Two sides. The FOLLOWER (payer) carries the live commission inside
  // fTarget.commission and follows the guide. The GUIDE tracks each trip
  // they've agreed to guide in leaderComms, watching for arrival and for the
  // follower vanishing. Settlement is the LiveZone DO's: the follower escrowed
  // the fee, the DO pays it out (whole fee on a both-arrived delivery, split
  // by distance covered on a cancel) and re-delivers the coin payout until the
  // recipient acks it.
  const ARRIVE_R = 3;                  // "at the destination" tolerance (tiles)
  const leaderComms = new Map();       // cid -> { followerId, name, dest, price, orig, lastRem, arrSent, progAt }
  const genCid = () => (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID() : "c" + Date.now() + Math.floor(player.x) + "," + Math.floor(player.y);

  // the suggested travel fee: the zone's average market rate (coins/tile, from
  // the DO) across the Chebyshev distance, or the econ-core baseline when the
  // zone hasn't reported a rate yet. Null if the shared engine isn't loaded.
  function suggestFee(dest) {
    if (!dest || typeof EconCore === "undefined" || !EconCore.commissionSuggest) return null;
    const d = cheb(player.x, player.y, dest.x, dest.y);
    const rate = (Live.commRate && Live.commRate()) || 0;
    return EconCore.commissionSuggest(d, rate);
  }

  // open the escrow + start following: shared by an accepted direct offer
  // (cmok) and an accepted roadside pickup (hhpick). The fee leaves our purse
  // NOW into the joint escrow; the DO holds it until we arrive together or the
  // contract breaks. Returns false (and says why) if we can't afford it.
  function beginCommission(leaderId, leaderName, price, dest) {
    if (!dest) return false;
    price = Math.max(1, price | 0);
    if (countOf("coins") < price) { say("You can no longer afford the " + price + " gold fee — commission cancelled.", "warn"); return false; }
    removeItem("coins", price);                       // escrow the fee now
    if (typeof uiDirty !== "undefined") uiDirty = true;
    if (typeof saveGame === "function") saveGame();
    const cid = genCid();
    const orig = Math.max(1, cheb(player.x, player.y, dest.x, dest.y));
    _commArrSent = false; _commProgAt = 0;
    Live.sendCommissionStart(leaderId, cid, price, dest.x, dest.y, orig);
    followStart(leaderId, { cid, price, dest, origDist: orig });
    return true;
  }

  // follower's distance from the destination (we ARE the follower here)
  function commissionRemaining(ft) {
    const c = ft && ft.commission;
    return c ? cheb(player.x, player.y, c.dest.x, c.dest.y) : 0;
  }

  // follower-side per-tick (called from followTick while guiding us somewhere):
  // ping progress to the escrow and, once we AND the guide stand at the
  // destination, confirm arrival (the DO releases the fee once both confirm).
  let _commProgAt = 0, _commArrSent = false;
  function commissionTick(rp) {
    const c = fTarget.commission;
    const t = Date.now();
    const rem = commissionRemaining(fTarget);
    if (t >= _commProgAt) { _commProgAt = t + 2000; Live.sendCommissionProgress(c.cid, rem); }
    if (!_commArrSent && rem <= ARRIVE_R && cheb(rp.x, rp.y, c.dest.x, c.dest.y) <= ARRIVE_R) {
      _commArrSent = true;
      Live.sendCommissionArrive(c.cid);
      say("You've reached the destination with " + fTarget.name + " — the fee is released.", "gold");
    }
  }

  // guide-side per-tick: for each trip we've agreed to lead, confirm arrival
  // when both of us reach the spot, and cancel (settling our share) if the
  // follower logs out / vanishes for good.
  function commissionsLeaderTick() {
    if (!leaderComms.size) return;
    if (player.dying) {        // the guide fell — every trip they're leading breaks + settles
      for (const [cid, c] of leaderComms)
        Live.sendCommissionCancel(cid, c.lastRem != null ? c.lastRem : c.orig);
      leaderComms.clear();
      return;
    }
    const t = Date.now();
    for (const [cid, c] of leaderComms) {
      const rp = Live.players.get(c.followerId);
      if (!rp) {
        const online = typeof Hub !== "undefined" && Hub.online && Hub.online.has(c.followerId);
        if (!online) {        // follower gone for good — settle on the distance they'd covered
          Live.sendCommissionCancel(cid, c.lastRem != null ? c.lastRem : c.orig);
          leaderComms.delete(cid);
        }
        continue;
      }
      c.lastRem = cheb(rp.x, rp.y, c.dest.x, c.dest.y);
      if (t >= (c.progAt || 0)) { c.progAt = t + 2000; Live.sendCommissionProgress(cid, c.lastRem); }
      if (!c.arrSent && c.lastRem <= ARRIVE_R && cheb(player.x, player.y, c.dest.x, c.dest.y) <= ARRIVE_R) {
        c.arrSent = true;
        Live.sendCommissionArrive(cid);
      }
    }
  }

  // ---- commission UI: a small panel to set a fee + pick a destination ----
  let commDraft = null;   // { leaderId, leaderName, price, dest }  (being composed)

  const commCss = document.createElement("style");
  commCss.textContent = `
  #pcomm { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
    width:340px; z-index:63; background:rgba(16,22,30,0.97); border:1px solid #46586a;
    border-radius:10px; padding:14px; color:#e6eef6; display:none;
    font:12px OpenDyslexic, Verdana, sans-serif; }
  #pcomm.on { display:block; }
  #pcomm h3 { margin:0 0 10px; font-size:14px; color:#ffd75e; }
  #pcomm .pc-row { display:flex; justify-content:space-between; align-items:center; gap:8px; margin:7px 0; }
  #pcomm input { width:110px; box-sizing:border-box; background:rgba(10,14,20,0.8);
    border:1px solid #3a4a5a; border-radius:5px; color:#fff; padding:4px 7px; font:inherit; }
  #pcomm .pc-dest { color:#9fe6c0; }
  #pcomm .pc-btns { display:flex; gap:8px; margin-top:12px; }
  #pcomm button { flex:1; background:#24463a; color:#c9ffe0; border:1px solid #3a6a52;
    border-radius:6px; padding:6px; cursor:pointer; font:inherit; }
  #pcomm button.sec { background:#243246; border-color:#3a4a6a; color:#cfe0ff; }
  #pcomm button:disabled { opacity:0.5; cursor:default; }
  #pcomm .pc-note { color:#9fb7c9; font-size:11px; margin-top:6px; line-height:1.4; }`;
  document.head.appendChild(commCss);

  const commEl = document.createElement("div");
  commEl.id = "pcomm";
  commEl.innerHTML = `<h3></h3>
    <div class="pc-row"><span>Travel fee (gold)</span><input class="pc-price" type="number" min="1" value="50"></div>
    <div class="pc-row"><span>Suggested (market rate)</span><span class="pc-sug" title="Click to use">—</span></div>
    <div class="pc-row"><span>Destination</span><span class="pc-dest">— not set —</span></div>
    <div class="pc-row"><span>Distance</span><span class="pc-dist">—</span></div>
    <button class="sec pc-pick">Pick destination on the map</button>
    <div class="pc-btns"><button class="pc-send" disabled>Send offer</button>
      <button class="sec pc-cancel">Cancel</button></div>
    <div class="pc-note"></div>`;
  document.body.appendChild(commEl);
  const commPrice = commEl.querySelector(".pc-price");
  const commSugEl = commEl.querySelector(".pc-sug");
  const commDestEl = commEl.querySelector(".pc-dest");
  const commDistEl = commEl.querySelector(".pc-dist");
  const commSend = commEl.querySelector(".pc-send");
  commSugEl.style.cssText = "color:#ffd75e;cursor:pointer;text-decoration:underline dotted";
  commSugEl.onclick = () => { const s = commDraft && suggestFee(commDraft.dest); if (s) commPrice.value = s; };

  function commRender() {
    if (!commDraft) { commEl.classList.remove("on"); return; }
    const hitch = !!commDraft.hitch;
    commEl.classList.add("on");
    commEl.querySelector("h3").textContent = hitch
      ? "Hitchhike — post a public lift request"
      : "Commission " + commDraft.leaderName + " to guide you";
    if (commDraft.dest) {
      commDestEl.textContent = commDraft.dest.x + ", " + commDraft.dest.y;
      commDistEl.textContent = cheb(player.x, player.y, commDraft.dest.x, commDraft.dest.y) + " tiles";
      const s = suggestFee(commDraft.dest);
      commSugEl.textContent = s ? s + " g" : "—";
      commSend.disabled = false;
    } else {
      commDestEl.textContent = "— not set —";
      commDistEl.textContent = "—";
      commSugEl.textContent = "—";
      commSend.disabled = true;
    }
    commSend.textContent = hitch ? "Post offer" : "Send offer";
    commEl.querySelector(".pc-note").textContent = hitch
      ? "Stand by the road, thumb out — any passing traveller can pick you up. The fee is escrowed the moment a driver accepts."
      : "The fee is escrowed now. Reach the spot together and it's all theirs; cancel partway and they're paid for the distance covered.";
  }

  commEl.querySelector(".pc-cancel").onclick = () => { commDraft = null; commRender(); };
  commEl.querySelector(".pc-pick").onclick = () => {
    if (!commDraft) return;
    commEl.classList.remove("on");
    say("Click your destination on the map.", "sys");
    if (typeof openWorldMap === "function") openWorldMap();
    if (typeof WorldMapPick === "function")
      WorldMapPick(({ x, y }) => {
        commDraft.dest = { x, y };
        const s = suggestFee(commDraft.dest);   // pre-fill the market suggestion (revisable)
        if (s) commPrice.value = s;
        commRender();
      });
  };
  commSend.onclick = () => {
    if (!commDraft || !commDraft.dest) return;
    const price = Math.max(1, commPrice.value | 0);
    if (countOf("coins") < price) { say("You don't have " + price + " gold.", "warn"); return; }
    if (commDraft.hitch) {               // post a public roadside offer
      if (!nearRoad()) { say("You need to be on or beside a road to hitchhike.", "warn"); return; }
      startHitch(price, commDraft.dest);
      commDraft = null; commRender();
      return;
    }
    const rp = Live.players.get(commDraft.leaderId);
    if (!rp) { say("They're gone."); commDraft = null; commRender(); return; }
    commDraft.price = price;
    Live.sendCommissionOffer(commDraft.leaderId, price, commDraft.dest.x, commDraft.dest.y);
    say("You offer " + rp.name + " " + price + " gold to guide you to " +
      commDraft.dest.x + "," + commDraft.dest.y + ". Waiting for their answer…");
    commEl.classList.remove("on");   // keep commDraft until they answer
  };

  // ---- receiving: follow notes ----
  Live.onFollowNote(m => {
    const who = m.name || Live.nameOf(m.id) || "Someone";
    say(m.on ? who + " is now following you." : who + " has stopped following you.", "sys");
  });

  // ---- receiving: commission negotiation + payouts ----
  const commPaid = () => { try { return new Set(JSON.parse(localStorage.getItem("taiao_comm_paid") || "[]")); } catch (e) { return new Set(); } };
  const commPaidSave = s => { try { localStorage.setItem("taiao_comm_paid", JSON.stringify([...s].slice(-200))); } catch (e) {} };

  Live.onComm(m => {
    const who = m.name || Live.nameOf(m.id) || "Someone";
    if (m.t === "cm") {              // we were offered a guiding job
      commAskAccept(m);
      return;
    }
    if (m.t === "cmno") {            // our offer was declined
      say(who + " declined your travel offer.", "warn");
      commDraft = null; commRender();
      return;
    }
    if (m.t === "cmok") {            // our offer was accepted → escrow + start
      if (!commDraft || commDraft.leaderId !== m.id || !commDraft.dest) return;
      if (beginCommission(m.id, who, commDraft.price | 0, commDraft.dest))
        say("You pay " + (commDraft.price | 0) + " gold into escrow and set off after " + who + ".", "gold");
      commDraft = null; commRender();
      return;
    }
    if (m.t === "cmstart") {         // WE are the guide — record the trip
      leaderComms.set(m.cid, { followerId: m.id, name: who, dest: { x: m.dx | 0, y: m.dy | 0 },
        price: m.price | 0, orig: Math.max(1, m.dist | 0), lastRem: m.dist | 0, arrSent: false, progAt: 0 });
      say(who + " is paying " + (m.price | 0) + " gold for you to guide them to " + (m.dx | 0) + "," + (m.dy | 0) + ".", "gold");
      return;
    }
    if (m.t === "cmpay") {           // a settlement payout addressed to us
      const applied = commPaid();
      if (!applied.has(m.cid)) {
        const coins = Math.max(0, m.coins | 0);
        if (coins > 0) { addItem("coins", coins); if (typeof uiDirty !== "undefined") uiDirty = true; if (typeof saveGame === "function") saveGame(); }
        applied.add(m.cid); commPaidSave(applied);
        leaderComms.delete(m.cid);
        const other = m.other ? esc(String(m.other)) : "a traveller";
        if (m.why === "deliver" && coins > 0) say("Commission complete — you earned " + coins + " gold guiding " + other + ".", "gold");
        else if (m.why === "cancel" && coins > 0) say("Commission ended early — " + coins + " gold settled from your trip with " + other + ".", "sys");
      }
      Live.sendCommissionPayAck(m.cid);
      return;
    }
  });

  // a yes/no prompt for an incoming guiding offer (reuses the invite styling)
  function commAskAccept(m) {
    const who = m.name || "Someone";
    const price = m.price | 0, dx = m.dx | 0, dy = m.dy | 0;
    const near = (typeof world !== "undefined" && world.villagesNearPt) ? world.villagesNearPt(dx, dy, 60) : null;
    const place = (near && near[0] && near[0].name) ? near[0].name + " (" + dx + "," + dy + ")" : dx + "," + dy;
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:63;" +
      "background:rgba(16,22,30,0.97);border:1px solid #46586a;border-radius:8px;padding:9px 13px;" +
      "color:#e6eef6;display:flex;gap:10px;align-items:center;font:12px OpenDyslexic,Verdana,sans-serif";
    const span = document.createElement("span");
    span.textContent = `${who} offers ${price} gold to be guided to ${place}.`;
    const yes = document.createElement("button");
    yes.textContent = "Accept"; yes.style.cssText = "background:#24463a;color:#c9ffe0;border:1px solid #3a6a52;border-radius:5px;padding:3px 10px;cursor:pointer;font:inherit";
    yes.onclick = () => { Live.sendCommissionAccept(m.id); el.remove(); say("You agree to guide " + who + " for " + price + " gold.", "sys"); };
    const no = document.createElement("button");
    no.textContent = "Decline"; no.style.cssText = "background:#46282a;color:#ffd0c9;border:1px solid #6a3a3e;border-radius:5px;padding:3px 10px;cursor:pointer;font:inherit";
    no.onclick = () => { Live.sendCommissionDecline(m.id); el.remove(); };
    el.append(span, yes, no);
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) { el.remove(); Live.sendCommissionDecline(m.id); } }, 30000);
  }

  function openCommission(id) {
    const rp = Live.players.get(id);
    if (!rp) { say("They're not nearby."); return; }
    commDraft = { leaderId: id, leaderName: rp.name, price: 50, dest: null };
    commPrice.value = 50;
    commRender();
  }

  // ---------------- hitchhiking (public roadside lift requests) ----------------
  // Stand on or beside a road, post a PUBLIC lift offer (destination + fee),
  // and any passing player can pick you up. A pickup runs the very same escrow
  // as a direct commission — you (the hitchhiker) are the follower/payer, the
  // driver is the leader/guide. We re-broadcast the offer every few seconds so
  // newly-arrived drivers see it, and withdraw it the moment we step off the
  // road, get picked up, or die.
  let hitch = null;                       // { dx, dy, price, bcastAt }  (OUR offer)
  const hitchOffers = new Map();          // drivers' view: hitchhikerId -> { id, name, dx, dy, price, until }

  const onRoadTile = (x, y) => {
    if (typeof world === "undefined") return false;
    const g = String(world.getGround ? world.getGround(x, y) || "" : "");
    const d = String(world.getDecor ? world.getDecor(x, y) || "" : "");
    return g.startsWith("dirt#") || d.startsWith("stone_bridge");
  };
  const nearRoad = () => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (onRoadTile((player.x | 0) + dx, (player.y | 0) + dy)) return true;
    return false;
  };
  const placeLabel = (x, y) => {
    const near = (typeof world !== "undefined" && world.villagesNearPt) ? world.villagesNearPt(x, y, 60) : null;
    return (near && near[0] && near[0].name) ? near[0].name : x + "," + y;
  };

  function hitchBroadcast(force) {
    if (!hitch) return;
    const t = Date.now();
    if (!force && t < hitch.bcastAt) return;
    hitch.bcastAt = t + 4000;             // re-advertise roughly every 4s
    Live.sendHitch(hitch.price, hitch.dx, hitch.dy);
  }
  function startHitch(price, dest) {
    hitch = { dx: dest.x, dy: dest.y, price: Math.max(1, price | 0), bcastAt: 0 };
    say("You stand by the road, thumb out — bound for " + placeLabel(dest.x, dest.y) +
      " for " + hitch.price + " gold. Anyone passing can pick you up.", "sys");
    hitchBroadcast(true);
    renderMyHitch();
  }
  function stopHitch(silent) {
    if (!hitch) return;
    hitch = null;
    Live.sendHitchCancel();
    renderMyHitch();
    if (!silent) say("You lower your thumb and stop hitchhiking.", "sys");
  }
  function openHitch() {
    if (hitch) { stopHitch(false); return; }       // toggle off
    if (typeof Live === "undefined" || !Live.connected()) { say("You need to be online to hitchhike.", "warn"); return; }
    if (!nearRoad()) { say("Stand on or beside a road to hitchhike.", "warn"); return; }
    const base = (typeof EconCore !== "undefined" && EconCore.P) ? EconCore.P.commMin : 10;
    commDraft = { hitch: true, leaderId: null, leaderName: null, price: base, dest: null };
    commPrice.value = base;
    commRender();
  }

  function clearOffer(id) {
    hitchOffers.delete(id);
    const rp = Live.players.get(id);
    if (rp) rp._hitch = null;
    renderHitchPanel();
  }
  function pickUp(id) {
    const rp = Live.players.get(id), o = hitchOffers.get(id);
    if (!o && !(rp && rp._hitch)) { say("They're not hitchhiking."); return; }
    if (fTarget) { say("Stop what you're guiding first.", "warn"); return; }
    Live.sendHitchPick(id);
    say("You pull over for " + ((rp && rp.name) || (o && o.name) || "the traveller") +
      " — waiting for them to climb aboard.", "sys");
  }

  // driver-side per-tick housekeeping + our own re-broadcast (from followTick)
  function hitchTick() {
    if (hitchOffers.size) {
      const t = Date.now();
      let changed = false;
      for (const [id, o] of hitchOffers)
        if (o.until < t || !Live.players.get(id)) {
          hitchOffers.delete(id);
          const rp = Live.players.get(id); if (rp) rp._hitch = null;
          changed = true;
        }
      if (changed) renderHitchPanel();
    }
    if (!hitch) return;
    if (fTarget || player.dying) { stopHitch(true); return; }
    if (!nearRoad()) { say("You step away from the road — your lift request ends.", "warn"); stopHitch(true); return; }
    hitchBroadcast(false);
  }

  Live.onHitch(m => {
    const me = Live.myId ? Live.myId() : 0;
    if (m.t === "hh") {                   // a nearby player wants a lift
      if (m.id === me) return;
      const rp = Live.players.get(m.id);
      const name = m.name || (rp && rp.name) || "A traveller";
      const until = Date.now() + 9000;    // offers expire ~9s after the last ping (re-ping is ~4s)
      const o = { id: m.id, name, dx: m.dx | 0, dy: m.dy | 0, price: m.price | 0, until };
      if (rp) rp._hitch = { dx: o.dx, dy: o.dy, price: o.price, until };
      hitchOffers.set(m.id, o);
      renderHitchPanel();
      return;
    }
    if (m.t === "hhcancel") { clearOffer(m.id); return; }
    if (m.t === "hhpick") {               // a driver accepted OUR roadside offer
      if (!hitch || fTarget) return;      // not hitching, or already aboard
      const who = m.name || Live.nameOf(m.id) || "A traveller";
      const dest = { x: hitch.dx, y: hitch.dy }, price = hitch.price | 0;
      if (beginCommission(m.id, who, price, dest))
        say(who + " pulls over — you climb aboard, " + price + " gold into escrow, bound for " +
          placeLabel(dest.x, dest.y) + ".", "gold");
      stopHitch(true);                    // following now; drop the thumb silently
      return;
    }
  });

  // ---- hitch UI: a driver's "nearby hitchhikers" list + our own banner ----
  const hitchCss = document.createElement("style");
  hitchCss.textContent = `
  #phitch { position:fixed; right:12px; bottom:120px; z-index:61; width:240px;
    background:rgba(16,22,30,0.95); border:1px solid #46586a; border-radius:9px;
    padding:8px 10px; color:#e6eef6; display:none; font:12px OpenDyslexic, Verdana, sans-serif; }
  #phitch.on { display:block; }
  #phitch .hp-h { color:#ffd75e; font-size:12px; margin-bottom:6px; }
  #phitch .hp-row { display:flex; gap:8px; align-items:center; justify-content:space-between; margin:4px 0; }
  #phitch .hp-row span { flex:1; line-height:1.3; }
  #phitch .hp-row button { background:#24463a; color:#c9ffe0; border:1px solid #3a6a52;
    border-radius:5px; padding:3px 8px; cursor:pointer; font:inherit; white-space:nowrap; }
  #phmine { position:fixed; left:50%; bottom:92px; transform:translateX(-50%); z-index:61;
    background:rgba(28,34,22,0.95); border:1px solid #6a6a3a; border-radius:7px; padding:5px 12px;
    color:#f2ffcf; display:none; cursor:pointer; font:12px OpenDyslexic, Verdana, sans-serif; }
  #phmine.on { display:block; }`;
  document.head.appendChild(hitchCss);

  const hpanel = document.createElement("div");
  hpanel.id = "phitch";
  document.body.appendChild(hpanel);
  const mine = document.createElement("div");
  mine.id = "phmine";
  mine.onclick = () => stopHitch(false);
  document.body.appendChild(mine);

  function renderMyHitch() {
    if (!hitch) { mine.classList.remove("on"); return; }
    mine.textContent = "🫱 Hitchhiking → " + placeLabel(hitch.dx, hitch.dy) + " · " + hitch.price + "g  (click to stop)";
    mine.classList.add("on");
  }
  function renderHitchPanel() {
    const guiding = new Set([...leaderComms.values()].map(c => c.followerId));
    const list = [...hitchOffers.values()].filter(o => Live.players.get(o.id) && !guiding.has(o.id));
    if (!list.length || hitch) { hpanel.classList.remove("on"); hpanel.innerHTML = ""; return; }
    hpanel.innerHTML = `<div class="hp-h">🫱 Hitchhikers nearby</div>`;
    for (const o of list) {
      const row = document.createElement("div");
      row.className = "hp-row";
      const span = document.createElement("span");
      span.textContent = o.name + " → " + placeLabel(o.dx, o.dy) + " · " + o.price + "g";
      const b = document.createElement("button");
      b.textContent = "Pick up";
      b.onclick = () => pickUp(o.id);
      row.append(span, b);
      hpanel.appendChild(row);
    }
    hpanel.classList.add("on");
  }

  window.Hitch = {
    toggle: openHitch, start: openHitch, stop: () => stopHitch(false),
    active: () => !!hitch, tick: hitchTick,
    offerFor: id => hitchOffers.get(id) || null,
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
    if (def.drinkBuff) {
      // A FORCED feed must never downgrade a buff you already have: apply the
      // incoming drinkBuff only when nothing stronger-or-longer is active for
      // that skill. "Stronger" = higher amt, "longer" = later until (eff() in
      // main/state.js adds b.amt while now < b.until), so we overwrite only
      // when the new buff is at least as strong AND at least as long — a weaker
      // or shorter buff from a hostile peer is ignored.
      const b = def.drinkBuff;
      const nb = { amt: b.amt, until: now + b.dur };
      const cur = player.buffs[b.skill];
      if (!cur || now >= cur.until || (nb.amt >= cur.amt && nb.until >= cur.until))
        player.buffs[b.skill] = nb;
    }
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
    commission: id => openCommission(id),
    pickUp: id => pickUp(id),
  };
})();
