// ===== Our RPG — social UI: who's in the world + direct messages =====
// The user-facing half of hubsync.js.
//   • A top-right button (just left of the sidebar) shows how many players are
//     online; clicking it opens the world roster — everyone online NOW (with a
//     portrait of their character, you included), and a table of everyone seen
//     in the last 24 hours with how long ago.
//   • A bottom-right "Messages" button opens direct-message threads.
// Whispers also work by typing "/w <name> <message>" into the chat box.
// Inert in offline/dev builds (no Hub / no SERVER_URL).
"use strict";

(function () {
  const DEV = typeof DEV_MODE !== "undefined" && DEV_MODE;
  const URL_ = typeof SERVER_URL !== "undefined" ? SERVER_URL : "";
  if (DEV || !URL_ || typeof Hub === "undefined") { window.Social = { openDM: () => {} }; return; }

  const css = document.createElement("style");
  css.textContent = `
#online-top { position:fixed; top:8px; right:340px; z-index:50; display:none;
  align-items:center; gap:6px; background:rgba(20,26,34,0.92); color:#cfe4ff;
  border:1px solid #3a4a5a; border-radius:8px; padding:5px 11px; cursor:pointer;
  font:12px OpenDyslexic, Verdana, sans-serif; }
#online-top.on { display:inline-flex; }
#online-top:hover { background:rgba(40,52,66,0.96); color:#fff; }
#online-top .ot-dot { width:8px; height:8px; border-radius:50%; background:#58c98a;
  box-shadow:0 0 6px #58c98a; }
#online-top .ot-pin { background:#2a6a4a; color:#d9ffe9; border-radius:9px;
  min-width:18px; height:18px; line-height:18px; text-align:center; font-size:11px;
  padding:0 5px; font-weight:bold; }
#social-bar { position:fixed; right:10px; bottom:60px; z-index:41; display:none;
  gap:6px; font:11px OpenDyslexic, Verdana, sans-serif; }
#social-bar.on { display:flex; }
#social-bar button { position:relative; background:rgba(20,26,34,0.9); color:#cfe4ff;
  border:1px solid #3a4a5a; border-radius:6px; padding:4px 10px; cursor:pointer; font:inherit; }
#social-bar button:hover { background:rgba(40,52,66,0.95); color:#fff; }
#social-bar .badge { position:absolute; top:-6px; right:-6px; background:#d9534f; color:#fff;
  border-radius:9px; min-width:16px; height:16px; line-height:16px; text-align:center;
  font-size:10px; padding:0 4px; display:none; }
#social-bar .badge.on { display:block; }

/* roster dialogue */
#online-dialog { position:fixed; inset:0; z-index:70; display:none;
  background:rgba(6,5,12,0.72); align-items:center; justify-content:center;
  font:13px OpenDyslexic, Verdana, sans-serif; }
#online-dialog.on { display:flex; }
#online-dialog .od-card { width:min(640px,92vw); max-height:84vh; overflow:hidden;
  display:flex; flex-direction:column; background:#150f26; border:1px solid #46586a;
  border-radius:12px; box-shadow:0 12px 44px rgba(0,0,0,0.55); color:#e6eef6; }
#online-dialog .od-head { padding:12px 16px; border-bottom:1px solid #2d3a48;
  display:flex; justify-content:space-between; align-items:center; }
#online-dialog .od-head h2 { margin:0; font-size:16px; color:#a8ffc9; }
#online-dialog .od-x { cursor:pointer; color:#9fb7c9; font-size:16px; padding:0 4px; }
#online-dialog .od-body { overflow-y:auto; padding:12px 16px 16px; }
#online-dialog h3 { margin:14px 0 8px; color:#ffe97a; font-size:13px; letter-spacing:0.5px; }
#online-dialog h3:first-child { margin-top:0; }
#online-dialog .od-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; }
#online-dialog .od-card2 { background:rgba(30,40,52,0.55); border:1px solid #2d3a48;
  border-radius:8px; padding:8px; display:flex; gap:9px; align-items:center; }
#online-dialog .od-card2.me { border-color:#3a6a52; background:rgba(30,52,44,0.55); }
#online-dialog .od-por { width:48px; height:48px; flex:0 0 auto; border-radius:6px;
  background:#0d0b16; image-rendering:pixelated; }
#online-dialog .od-meta { min-width:0; flex:1; }
#online-dialog .od-nm { color:#a8ffc9; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#online-dialog .od-nm .od-you { color:#ffe97a; font-weight:normal; font-size:11px; }
#online-dialog .od-sub { color:#8fa6bd; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#online-dialog .od-w { margin-top:3px; background:#24463a; color:#c9ffe0; border:1px solid #3a6a52;
  border-radius:5px; padding:2px 8px; cursor:pointer; font:inherit; font-size:11px; }
#online-dialog .od-empty { color:#8fa6bd; padding:6px 2px; }
#online-dialog table { width:100%; border-collapse:collapse; }
#online-dialog td { padding:5px 4px; border-bottom:1px solid rgba(255,255,255,0.06); font-size:12px; }
#online-dialog td.od-when { color:#8fa6bd; text-align:right; white-space:nowrap; }
#online-dialog td .od-livedot { display:inline-block; width:7px; height:7px; border-radius:50%;
  background:#58c98a; margin-right:6px; box-shadow:0 0 5px #58c98a; }

/* DM panel */
.social-panel { position:fixed; right:10px; bottom:92px; z-index:61; width:300px;
  max-height:52vh; background:rgba(16,22,30,0.97); border:1px solid #46586a; border-radius:10px;
  color:#e6eef6; font:12px OpenDyslexic, Verdana, sans-serif; display:none; flex-direction:column;
  box-shadow:0 8px 30px rgba(0,0,0,0.45); overflow:hidden; }
.social-panel.on { display:flex; }
.social-panel .sp-head { padding:8px 12px; border-bottom:1px solid #2d3a48; color:#a8ffc9;
  font-size:13px; display:flex; justify-content:space-between; align-items:center; }
.social-panel .sp-head .sp-x { cursor:pointer; color:#9fb7c9; padding:0 4px; }
#dm-panel .dm-tabs { display:flex; flex-wrap:wrap; gap:4px; padding:6px 8px 0; }
#dm-panel .dm-tab { background:rgba(30,40,52,0.9); color:#cfe4ff; border:1px solid #3a4a5a;
  border-radius:12px; padding:2px 9px; cursor:pointer; font:inherit; font-size:11px; }
#dm-panel .dm-tab.sel { background:#24463a; color:#c9ffe0; border-color:#3a6a52; }
#dm-panel .dm-tab .dm-unread { color:#ffd75e; }
#dm-panel .dm-log { flex:1; overflow-y:auto; padding:8px; display:flex; flex-direction:column; gap:3px; }
#dm-panel .dm-msg { max-width:82%; padding:3px 8px; border-radius:8px; word-wrap:break-word; }
#dm-panel .dm-msg.me { align-self:flex-end; background:#24463a; color:#eaffea; }
#dm-panel .dm-msg.them { align-self:flex-start; background:rgba(30,40,52,0.95); color:#dfe9f2; }
#dm-panel .dm-none { color:#8fa6bd; padding:12px; text-align:center; }
#dm-panel .dm-foot { display:flex; gap:6px; padding:8px; border-top:1px solid #2d3a48; }
#dm-panel .dm-foot input { flex:1; background:rgba(10,14,20,0.9); border:1px solid #3a4a5a;
  border-radius:6px; color:#fff; padding:6px 8px; font:inherit; outline:none; }
#dm-panel .dm-foot button { background:#24463a; color:#c9ffe0; border:1px solid #3a6a52;
  border-radius:6px; padding:6px 12px; cursor:pointer; font:inherit; }`;
  document.head.appendChild(css);

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- character portraits ----------
  // Load the shared character atlas once and blit the south-facing frame — the
  // same art the world draws (js/sprites/characters-data.js globals).
  let charSheet = null, charSheetOk = false;
  if (typeof CHAR_SHEET !== "undefined") {
    charSheet = new Image();
    charSheet.onload = () => { charSheetOk = true; if (dialog.classList.contains("on")) renderNow(); };
    charSheet.src = CHAR_SHEET;
  }
  function paintPortrait(cv, charId) {
    const px = cv.width;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, px, px);
    if (charSheetOk && charId != null && typeof CHAR_CELL !== "undefined") {
      const frame = (charId | 0) * CHAR_DIRS.length + 0; // 0 = south
      const sx = (frame % CHAR_COLS) * CHAR_CELL, sy = Math.floor(frame / CHAR_COLS) * CHAR_CELL;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(charSheet, sx, sy, CHAR_CELL, CHAR_CELL, 0, 0, px, px);
    } else {
      ctx.fillStyle = "#241c38"; ctx.fillRect(0, 0, px, px);
      ctx.fillStyle = "#6a5a8a"; ctx.font = "bold " + Math.round(px * 0.5) + "px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("?", px / 2, px / 2 + 1);
    }
  }
  function portraitEl(charId) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 48; cv.className = "od-por";
    paintPortrait(cv, charId);
    return cv;
  }

  const ago = ms => {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 45) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return m + " min ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + " hr" + (h > 1 ? "s" : "") + " ago";
    const d = Math.floor(h / 24);
    return d + " day" + (d > 1 ? "s" : "") + " ago";
  };

  // ---------- top-right online button ----------
  const topBtn = document.createElement("div");
  topBtn.id = "online-top";
  topBtn.innerHTML = `<span class="ot-dot"></span><span>Online</span><span class="ot-pin">0</span>`;
  document.body.appendChild(topBtn);
  const pinEl = topBtn.querySelector(".ot-pin");
  topBtn.onclick = () => { dialog.classList.add("on"); renderNow(); fetchRecent(); };

  // ---------- the roster dialogue ----------
  const dialog = document.createElement("div");
  dialog.id = "online-dialog";
  dialog.innerHTML = `<div class="od-card">
    <div class="od-head"><h2>Players in the world</h2><span class="od-x">✕</span></div>
    <div class="od-body">
      <h3 class="od-now-h">Online now</h3>
      <div class="od-grid od-now"></div>
      <h3>Seen in the last 24 hours</h3>
      <div class="od-recent"></div>
    </div></div>`;
  document.body.appendChild(dialog);
  dialog.querySelector(".od-x").onclick = () => dialog.classList.remove("on");
  dialog.onclick = e => { if (e.target === dialog) dialog.classList.remove("on"); };
  const nowGrid = dialog.querySelector(".od-now");
  const nowHead = dialog.querySelector(".od-now-h");
  const recentBox = dialog.querySelector(".od-recent");

  // everyone online right now — the hub roster plus YOU
  function onlineList() {
    const list = [];
    if (Hub.connected()) {
      list.push({ id: Hub.myId(), name: Hub.myName() || "You",
        clvl: (typeof combatLevel === "function" ? combatLevel() : 0) | 0,
        zone: Hub.myZone(),
        character: (typeof player !== "undefined" && player) ? player.character : null, me: true });
      for (const [id, o] of Hub.online)
        list.push({ id, name: o.name, clvl: o.clvl | 0, zone: o.zone, character: o.character });
    }
    return list;
  }

  function renderNow() {
    const list = onlineList();
    updatePin(list.length);
    nowHead.textContent = "Online now (" + list.length + ")";
    if (!list.length) { nowGrid.innerHTML = `<div class="od-empty">No one is online — including you. Once you're connected you'll appear here.</div>`; return; }
    nowGrid.innerHTML = "";
    for (const p of list) {
      const card = document.createElement("div");
      card.className = "od-card2" + (p.me ? " me" : "");
      card.appendChild(portraitEl(p.character));
      const meta = document.createElement("div");
      meta.className = "od-meta";
      meta.innerHTML = `<div class="od-nm">${esc(p.name)}${p.me ? ' <span class="od-you">(you)</span>' : ""}</div>
        <div class="od-sub">lvl ${p.clvl}${p.zone ? " · " + esc(p.zone) : ""}</div>`;
      if (!p.me) {
        const w = document.createElement("button");
        w.className = "od-w"; w.textContent = "Whisper";
        w.onclick = () => { openDM(p.id, p.name); dialog.classList.remove("on"); };
        meta.appendChild(w);
      }
      card.appendChild(meta);
      nowGrid.appendChild(card);
    }
  }

  async function fetchRecent() {
    recentBox.innerHTML = `<div class="od-empty">Loading…</div>`;
    const r = await Server.call("/api/players/recent");
    if (!r || !r.ok) { recentBox.innerHTML = `<div class="od-empty">Couldn't load the roster right now.</div>`; return; }
    const nowSrv = r.now || Date.now();
    // who is online RIGHT NOW, by name, so we can flag them in the table
    const liveNames = new Set(onlineList().map(p => String(p.name).toLowerCase()));
    const rows = r.players || [];
    if (!rows.length) { recentBox.innerHTML = `<div class="od-empty">No one has been seen in the last day.</div>`; return; }
    const t = document.createElement("table");
    for (const p of rows) {
      const live = liveNames.has(String(p.username).toLowerCase());
      const tr = document.createElement("tr");
      const tdN = document.createElement("td");
      tdN.innerHTML = (live ? '<span class="od-livedot"></span>' : "") + esc(p.username);
      const tdW = document.createElement("td");
      tdW.className = "od-when";
      tdW.textContent = live ? "online now" : ago(nowSrv - (p.lastSeen || 0));
      tr.appendChild(tdN); tr.appendChild(tdW);
      t.appendChild(tr);
    }
    recentBox.innerHTML = "";
    recentBox.appendChild(t);
  }

  function updatePin(n) {
    pinEl.textContent = n;
    topBtn.classList.toggle("on", Hub.connected());
  }

  // ---------- bottom-right Messages button ----------
  const bar = document.createElement("div");
  bar.id = "social-bar";
  bar.innerHTML = `<button id="btn-dm">✉ Messages<span class="badge" id="dm-badge">0</span></button>`;
  document.body.appendChild(bar);
  const dmBadge = bar.querySelector("#dm-badge");

  // ---------- DM threads ----------
  const threads = new Map();   // peerId -> { name, msgs:[{me,text}], unread }
  let curPeer = 0;

  const dpanel = document.createElement("div");
  dpanel.id = "dm-panel";
  dpanel.className = "social-panel";
  dpanel.innerHTML = `<div class="sp-head"><span>Messages</span><span class="sp-x">✕</span></div>
    <div class="dm-tabs"></div>
    <div class="dm-log"></div>
    <div class="dm-foot"><input maxlength="500" placeholder="Write a message… (Enter)"><button>Send</button></div>`;
  document.body.appendChild(dpanel);
  const dmTabs = dpanel.querySelector(".dm-tabs");
  const dmLog = dpanel.querySelector(".dm-log");
  const dmInput = dpanel.querySelector(".dm-foot input");
  dpanel.querySelector(".sp-x").onclick = () => dpanel.classList.remove("on");

  function totalUnread() { let n = 0; for (const t of threads.values()) n += t.unread; return n; }
  function refreshBadge() {
    const n = totalUnread();
    dmBadge.textContent = n;
    dmBadge.classList.toggle("on", n > 0);
  }
  function thread(peerId, name) {
    let t = threads.get(peerId);
    if (!t) { t = { name: name || ("player" + peerId), msgs: [], unread: 0 }; threads.set(peerId, t); }
    if (name) t.name = name;
    return t;
  }
  function renderTabs() {
    dmTabs.innerHTML = "";
    for (const [id, t] of threads) {
      const b = document.createElement("div");
      b.className = "dm-tab" + (id === curPeer ? " sel" : "");
      b.innerHTML = esc(t.name) + (t.unread ? ` <span class="dm-unread">(${t.unread})</span>` : "");
      b.onclick = () => selectPeer(id);
      dmTabs.appendChild(b);
    }
  }
  function renderLog() {
    const t = threads.get(curPeer);
    if (!t) { dmLog.innerHTML = `<div class="dm-none">Pick a conversation, or whisper someone from the online list.</div>`; return; }
    dmLog.innerHTML = "";
    for (const msg of t.msgs) {
      const d = document.createElement("div");
      d.className = "dm-msg " + (msg.me ? "me" : "them");
      d.textContent = msg.text;
      dmLog.appendChild(d);
    }
    dmLog.scrollTop = dmLog.scrollHeight;
  }
  function selectPeer(id) {
    curPeer = id;
    const t = threads.get(id);
    if (t) t.unread = 0;
    refreshBadge(); renderTabs(); renderLog();
    dmInput.focus();
  }
  function openDM(peerId, name) {
    thread(peerId, name);
    dpanel.classList.add("on");
    selectPeer(peerId);
  }
  function sendCurrent() {
    const text = dmInput.value.trim();
    if (!text || !curPeer) return;
    if (Hub.sendDM(curPeer, text)) dmInput.value = "";
    // the sent line is appended when the hub echoes it back (onDM, from===myId)
  }
  dpanel.querySelector(".dm-foot button").onclick = sendCurrent;
  dmInput.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") sendCurrent();
    else if (e.key === "Escape") { dpanel.classList.remove("on"); dmInput.blur(); }
  });
  bar.querySelector("#btn-dm").onclick = () => {
    dpanel.classList.toggle("on");
    if (dpanel.classList.contains("on")) {
      if (!curPeer && threads.size) selectPeer([...threads.keys()][0]);
      else { renderTabs(); renderLog(); }
    }
  };

  Hub.onDM(m => {
    const mine = m.from === Hub.myId();
    if (mine) {
      const t = thread(m.to);
      t.msgs.push({ me: true, text: m.text });
      if (m.delivered === false && typeof log === "function")
        log("They're offline — your message won't have reached " + (t.name || "them") + ".", "sys");
    } else {
      const t = thread(m.from, m.name);
      t.msgs.push({ me: false, text: m.text });
      // surface it in the message log too, then badge/notify if not looking
      if (typeof logHTML === "function")
        logHTML("✉ <b>" + esc(m.name) + "</b> whispers: " + esc(m.text), "whisper");
      if (m.from !== curPeer || !dpanel.classList.contains("on")) t.unread++;
    }
    refreshBadge(); renderTabs();
    if ((mine ? m.to : m.from) === curPeer) renderLog();
  });

  // ---------- roster refresh cadence ----------
  Hub.onRoster(() => {
    updatePin(onlineList().length);
    if (dialog.classList.contains("on")) renderNow();
  });
  setInterval(() => {
    const on = Hub.connected();
    bar.classList.toggle("on", on);
    updatePin(onlineList().length);
    if (!on) { dialog.classList.remove("on"); dpanel.classList.remove("on"); }
  }, 1000);

  window.Social = { openDM, openRoster: () => { dialog.classList.add("on"); renderNow(); fetchRecent(); } };
})();
