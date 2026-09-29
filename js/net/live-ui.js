// ===== Taiao — live chat + player trading UI (built, gated) =====
// The user-facing half of livesync.js. BOTH features are fully wired here
// and on the server, but stay dormant until the server's LIVE_CHAT /
// LIVE_TRADE vars flip to "on" (they're advertised in the roster message —
// no client rebuild to launch). They ship dark because public chat and
// trading need a moderation story first; the code being done means flipping
// the switch is a policy decision, not an engineering project.
//
//   Chat:  "/" opens the box (Enter sends, Esc closes); lines land in the
//          box and as overhead bubbles (render3d.js draws them).
//   Trade: invite from the nearby-players strip → both offer items (bank
//          click grammar: click=1, Shift=5, Alt=all) → both Accept → swap.
//          The swap is SERVER-AUTHORITATIVE: the LiveZone DO holds both offers,
//          commits only when both sides have accepted the exact offers shown,
//          and hands each client a single idempotent `tcommit` to apply. A
//          drop mid-commit is re-delivered on reconnect. (The one residual gap
//          is that saves are opaque blobs, so the server can't prove a client
//          truly owns what it offers — fabrication by save-editing needs a
//          server-authoritative inventory, a larger project.)
"use strict";

(function () {
  const DEV = typeof DEV_MODE !== "undefined" && DEV_MODE;
  const URL_ = typeof SERVER_URL !== "undefined" ? SERVER_URL : "";
  if (DEV || !URL_) { window.LiveTrade = { invite: () => {} }; return; }

  // ---------- shared styles ----------
  const css = document.createElement("style");
  css.textContent = `
  #livechat { position:fixed; left:10px; bottom:86px; width:300px; z-index:40;
    font:12px OpenDyslexic, Verdana, sans-serif; display:none; pointer-events:none; }
  #livechat.on { display:block; }
  #livechat .lc-lines { max-height:150px; overflow-y:auto; display:flex;
    flex-direction:column; justify-content:flex-end; gap:2px; margin-bottom:4px; }
  #livechat .lc-line { background:rgba(14,18,24,0.72); border-radius:5px;
    padding:2px 7px; color:#dfe9f2; pointer-events:auto; word-wrap:break-word; }
  #livechat .lc-line b { color:#a8ffc9; font-weight:bold; }
  #livechat .lc-line.sys { color:#9fb7c9; font-style:italic; }
  #livechat input { width:100%; box-sizing:border-box; background:rgba(14,18,24,0.9);
    border:1px solid #3a4a5a; border-radius:6px; color:#fff; padding:5px 8px;
    font:inherit; outline:none; display:none; pointer-events:auto; }
  #livechat.typing input { display:block; }
  #livechat .lc-hint { color:rgba(210,225,235,0.55); font-size:11px;
    text-shadow:0 1px 2px #000; }
  #livechat.typing .lc-hint { display:none; }
  #livenear { position:fixed; left:10px; bottom:60px; z-index:40; display:none;
    gap:4px; font:11px OpenDyslexic, Verdana, sans-serif; pointer-events:auto; }
  #livenear.on { display:flex; }
  #livenear button { background:rgba(20,30,26,0.9); color:#a8ffc9;
    border:1px solid #3a5a4a; border-radius:5px; padding:2px 8px; cursor:pointer; font:inherit; }
  #livetrade { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
    width:460px; z-index:60; background:rgba(16,22,30,0.96); border:1px solid #46586a;
    border-radius:10px; padding:12px; color:#e6eef6; display:none;
    font:12px OpenDyslexic, Verdana, sans-serif; }
  #livetrade.on { display:block; }
  #livetrade h3 { margin:0 0 8px; font-size:14px; color:#a8ffc9; }
  #livetrade .lt-cols { display:flex; gap:10px; }
  #livetrade .lt-col { flex:1; min-width:0; }
  #livetrade .lt-box { background:rgba(10,14,20,0.8); border-radius:6px; padding:6px;
    min-height:70px; max-height:120px; overflow-y:auto; margin-bottom:6px; }
  #livetrade .lt-box.ok { outline:2px solid #58c98a; }
  #livetrade .lt-it { display:flex; justify-content:space-between; gap:6px; padding:1px 2px; }
  #livetrade .lt-it button { background:none; border:none; color:#ff9f8f; cursor:pointer; font:inherit; }
  #livetrade .lt-pack { max-height:110px; overflow-y:auto; }
  #livetrade .lt-pack .lt-it { cursor:pointer; }
  #livetrade .lt-pack .lt-it:hover { background:rgba(80,110,140,0.25); }
  #livetrade .lt-foot { display:flex; gap:8px; margin-top:8px; align-items:center; }
  #livetrade .lt-foot button { flex:0 0 auto; background:#24463a; color:#c9ffe0;
    border:1px solid #3a6a52; border-radius:6px; padding:5px 14px; cursor:pointer; font:inherit; }
  #livetrade .lt-foot button.cancel { background:#46282a; color:#ffd0c9; border-color:#6a3a3e; }
  #livetrade .lt-status { flex:1; color:#9fb7c9; font-size:11px; }
  #liveinvite { position:fixed; left:50%; bottom:120px; transform:translateX(-50%);
    z-index:60; background:rgba(16,22,30,0.96); border:1px solid #46586a; border-radius:8px;
    padding:8px 12px; color:#e6eef6; display:none; gap:8px; align-items:center;
    font:12px OpenDyslexic, Verdana, sans-serif; }
  #liveinvite.on { display:flex; }
  #liveinvite button { background:#24463a; color:#c9ffe0; border:1px solid #3a6a52;
    border-radius:5px; padding:3px 10px; cursor:pointer; font:inherit; }`;
  document.head.appendChild(css);

  // ---------- chat ----------
  const box = document.createElement("div");
  box.id = "livechat";
  box.innerHTML = `<div class="lc-lines"></div>
    <div class="lc-hint">/ to chat</div>
    <input maxlength="240" placeholder="Say something to those nearby… (Enter, or /w name msg)">`;
  document.body.appendChild(box);
  const linesEl = box.querySelector(".lc-lines");
  const inputEl = box.querySelector("input");
  const MAX_LINES = 60;

  function chatLine(html, sys) {
    const d = document.createElement("div");
    d.className = "lc-line" + (sys ? " sys" : "");
    d.innerHTML = html;
    linesEl.appendChild(d);
    while (linesEl.children.length > MAX_LINES) linesEl.removeChild(linesEl.firstChild);
    linesEl.scrollTop = linesEl.scrollHeight;
  }
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  document.addEventListener("keydown", e => {
    if (e.key !== "/" || !Live.chatOn()) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
    e.preventDefault();
    box.classList.add("typing");
    inputEl.focus();
  });
  inputEl.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") {
      const text = inputEl.value.trim();
      if (text) {
        // "/w <name> <message>" whispers a direct message via the global hub;
        // anything else is local (proximity) chat.
        const wm = text.match(/^\/w(?:hisper)?\s+(\S+)\s+([\s\S]+)$/i);
        if (wm && typeof Hub !== "undefined") {
          const id = Hub.idByName(wm[1]);
          if (id) Hub.sendDM(id, wm[2]);
          else if (typeof log === "function") log('No one online named "' + wm[1] + '".', "sys");
        } else {
          Live.sendChat(text);
        }
      }
      inputEl.value = "";
      box.classList.remove("typing");
      inputEl.blur();
    } else if (e.key === "Escape") {
      inputEl.value = "";
      box.classList.remove("typing");
      inputEl.blur();
    }
  });

  Live.onChat(m => {
    chatLine("<b>" + esc(m.name) + ":</b> " + esc(m.text));
    // your own line also floats over your head, like talking to an NPC
    if (m.id === Live.myId() && typeof playerSay === "function") playerSay(m.text, 6000);
  });

  let announcedChat = false;
  Live.onRoster(f => {
    if (f.chat && !announcedChat) {
      announcedChat = true;
      chatLine("Local chat is on — press / to talk to those around you. Be kind; this is our place.", true);
    }
  });

  // ---------- nearby-players strip (trade entry point) ----------
  const near = document.createElement("div");
  near.id = "livenear";
  document.body.appendChild(near);

  function refreshNear() {
    if (!Live.tradeOn() || typeof player === "undefined") { near.classList.remove("on"); return; }
    const close = [];
    for (const rp of Live.players.values())
      if (Math.abs(rp.x - player.x) <= 8 && Math.abs(rp.y - player.y) <= 8) close.push(rp);
    if (!close.length || (T && T.open)) { near.classList.remove("on"); return; }
    near.innerHTML = "";
    for (const rp of close.slice(0, 4)) {
      const b = document.createElement("button");
      b.textContent = "⇄ trade " + rp.name;
      b.onclick = () => LiveTrade.invite(rp.id);
      near.appendChild(b);
    }
    near.classList.add("on");
  }

  // ---------- trading ----------
  // Session state. `mine`/`theirs` are [[itemId, qty], ...]. Offers cross the
  // wire as full snapshots with a seq; an accept names the seq it saw, so a
  // late offer change always voids both accepts.
  let T = null;   // {peerId, peerName, invited, open, mine, theirs, mySeq, theirSeq, myAccept, theirAccept}

  const tw = document.createElement("div");
  tw.id = "livetrade";
  tw.innerHTML = `<h3></h3>
    <div class="lt-cols">
      <div class="lt-col"><div>You offer</div><div class="lt-box lt-mine"></div>
        <div>Your pack (click to offer; Shift=5, Alt=all)</div><div class="lt-box lt-pack"></div></div>
      <div class="lt-col"><div class="lt-peer-t">They offer</div><div class="lt-box lt-theirs"></div></div>
    </div>
    <div class="lt-foot"><button class="acc">Accept</button>
      <button class="cancel">Cancel</button><div class="lt-status"></div></div>`;
  document.body.appendChild(tw);
  const inv = document.createElement("div");
  inv.id = "liveinvite";
  document.body.appendChild(inv);

  tw.querySelector(".cancel").onclick = () => cancel(true);
  tw.querySelector(".acc").onclick = () => {
    if (!T || !T.open || T.myAccept) return;
    if (!haveAll(T.mine)) { note("You no longer have some offered items."); return; }
    T.myAccept = true;
    // the SERVER decides the swap: it commits only when both sides have accepted
    // the exact offers on the table, and hands each of us a single tcommit to
    // apply. We never touch inventories here.
    Live.sendTrade({ t: "ta", to: T.peerId });
    renderTrade();
  };

  const itemName = id => (typeof ITEMS !== "undefined" && ITEMS[id] && ITEMS[id].name) || id;
  const note = msg => { if (typeof log === "function") log(msg, "sys"); };

  function haveAll(list) {
    for (const [id, n] of list) if (countItem(id) < n) return false;
    return true;
  }
  function offered(id) {
    const e = T.mine.find(x => x[0] === id);
    return e ? e[1] : 0;
  }
  function changeOffer(id, delta) {
    if (!T || !T.open) return;
    let e = T.mine.find(x => x[0] === id);
    const have = countItem(id);
    const cur = e ? e[1] : 0;
    const next = Math.max(0, Math.min(have, cur + delta));
    if (next === cur) return;
    if (!e && next > 0) T.mine.push([id, next]);
    else if (e && next > 0) e[1] = next;
    else if (e) T.mine.splice(T.mine.indexOf(e), 1);
    T.myAccept = T.theirAccept = false;   // any change voids both accepts (server mirrors this)
    Live.sendTrade({ t: "to", to: T.peerId, items: T.mine });
    renderTrade();
  }

  function renderTrade() {
    if (!T || !T.open) { tw.classList.remove("on"); return; }
    tw.classList.add("on");
    tw.querySelector("h3").textContent = "Trading with " + T.peerName;
    tw.querySelector(".lt-peer-t").textContent = T.peerName + " offers";
    const mineEl = tw.querySelector(".lt-mine"), theirsEl = tw.querySelector(".lt-theirs"),
      packEl = tw.querySelector(".lt-pack");
    mineEl.classList.toggle("ok", T.myAccept);
    theirsEl.classList.toggle("ok", T.theirAccept);
    mineEl.innerHTML = theirsEl.innerHTML = packEl.innerHTML = "";
    for (const [id, n] of T.mine) {
      const d = document.createElement("div");
      d.className = "lt-it";
      d.innerHTML = `<span>${esc(itemName(id))} × ${n}</span>`;
      const b = document.createElement("button");
      b.textContent = "−";
      b.onclick = e => changeOffer(id, e.altKey ? -1e9 : e.shiftKey ? -5 : -1);
      d.appendChild(b);
      mineEl.appendChild(d);
    }
    for (const [id, n] of T.theirs) {
      const d = document.createElement("div");
      d.className = "lt-it";
      d.innerHTML = `<span>${esc(itemName(id))} × ${n}</span>`;
      theirsEl.appendChild(d);
    }
    // pack: whatever's left after the current offer, bank click grammar
    const counts = new Map();
    for (const s of player.inv) if (s && s.id) counts.set(s.id, (counts.get(s.id) || 0) + s.qty);
    for (const [id, n] of counts) {
      const left = n - offered(id);
      if (left <= 0) continue;
      const d = document.createElement("div");
      d.className = "lt-it";
      d.innerHTML = `<span>${esc(itemName(id))} × ${left}</span><span>+</span>`;
      d.onclick = e => changeOffer(id, e.altKey ? 1e9 : e.shiftKey ? 5 : 1);
      packEl.appendChild(d);
    }
    tw.querySelector(".lt-status").textContent =
      T.myAccept && T.theirAccept ? "Exchanging…" :
      T.myAccept ? "Waiting for " + T.peerName + "…" :
      T.theirAccept ? T.peerName + " has accepted." : "";
  }

  function openTradeWith(id, name) {
    T = { peerId: id, peerName: name, invited: false, open: true,
          mine: [], theirs: [], mySeq: 0, theirSeq: 0, myAccept: false, theirAccept: false };
    inv.classList.remove("on");
    renderTrade();
  }
  function cancel(tell) {
    if (T && tell) Live.sendTrade({ t: "tc", to: T.peerId });
    T = null;
    inv.classList.remove("on");
    renderTrade();
  }
  // The swap is applied ONCE, when the server hands us a `tcommit`, and never
  // before. tcommit is idempotent by trade id (a dropped-then-recovered commit
  // must not double-apply), tracked in a small localStorage set.
  const APPLIED_KEY = "taiao_trade_applied";
  function loadApplied() {
    try { return new Set(JSON.parse(localStorage.getItem(APPLIED_KEY) || "[]")); } catch (e) { return new Set(); }
  }
  function saveApplied(set) {
    try { localStorage.setItem(APPLIED_KEY, JSON.stringify([...set].slice(-200))); } catch (e) {}
  }
  function applyCommit(m) {
    const tid = m.tid;
    if (!tid) return;
    const applied = loadApplied();
    if (!applied.has(tid)) {
      for (const [id, n] of (m.give || [])) if (n > 0) removeItem(id, n);
      for (const [id, n] of (m.get || [])) if (n > 0 && typeof ITEMS !== "undefined" && ITEMS[id]) addItem(id, n);
      applied.add(tid); saveApplied(applied);
      const who = (T && T.peerId === m.peerId && T.peerName) ? T.peerName : "another player";
      note("Trade with " + who + " complete.");
      chatLine("Traded with <b>" + esc(who) + "</b>.", true);
    }
    // (re-)ack so the server can retire the escrow record, even if an earlier
    // ack was lost on a disconnect — harmless once it's already gone
    Live.sendTrade({ t: "tack", tid });
    if (T && T.peerId === m.peerId) { T = null; renderTrade(); }
  }

  window.LiveTrade = {
    invite(id) {
      const rp = Live.players.get(id);
      if (!rp || !Live.tradeOn()) return;
      T = { peerId: id, peerName: rp.name, invited: true, open: false,
            mine: [], theirs: [], mySeq: 0, theirSeq: 0, myAccept: false, theirAccept: false };
      Live.sendTrade({ t: "ti", to: id, seq: 1 });
      note("Trade offer sent to " + rp.name + ".");
    },
  };

  Live.onTrade(m => {
    if (!Live.tradeOn()) return;
    if (m.t === "ti") {
      if (T && T.invited && T.peerId === m.id) return openTradeWith(m.id, m.name); // they accepted ours
      if (T && T.open) return;                                       // busy — ignore
      inv.innerHTML = "";
      const span = document.createElement("span");
      span.textContent = esc(m.name) + " wants to trade.";
      const yes = document.createElement("button");
      yes.textContent = "Trade";
      yes.onclick = () => { openTradeWith(m.id, m.name); Live.sendTrade({ t: "ti", to: m.id, seq: 2 }); };
      const no = document.createElement("button");
      no.textContent = "Decline";
      no.onclick = () => { inv.classList.remove("on"); Live.sendTrade({ t: "tc", to: m.id }); };
      inv.append(span, yes, no);
      inv.classList.add("on");
      return;
    }
    // the server's committed swap — apply once, even if no window is open (it
    // can arrive on reconnect after a mid-trade drop). Handled before the
    // peer-match guard because tcommit carries peerId, not id.
    if (m.t === "tcommit") { applyCommit(m); return; }
    if (!T || m.id !== T.peerId) return;
    if (m.t === "to") {
      if (!T.open) openTradeWith(m.id, m.name || T.peerName);
      T.theirs = (m.items || []).filter(it => it && it[0]);
      T.myAccept = T.theirAccept = false;   // their change voids both accepts
      renderTrade();
    } else if (m.t === "ta") {
      T.theirAccept = true;
      renderTrade();
    } else if (m.t === "tc") {
      note(T.peerName + " cancelled the trade.");
      cancel(false);
    }
  });

  // ---------- visibility cadence ----------
  setInterval(() => {
    box.classList.toggle("on", Live.chatOn());
    if (!Live.chatOn()) box.classList.remove("typing");
    refreshNear();
    if (T && T.open && !Live.tradeOn()) cancel(false);
  }, 1000);
})();
