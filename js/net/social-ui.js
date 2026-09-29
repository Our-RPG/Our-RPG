// ===== Our RPG — social UI: who's online + direct messages =====
// The user-facing half of hubsync.js. Two bottom-right widgets:
//   • an "online" button that opens the world roster (name, combat level, where)
//     with a Whisper button per player;
//   • a "messages" button that opens direct-message threads.
// Whispers also work by typing "/w <name> <message>" into the chat box
// (handled in live-ui.js). Inert in offline/dev builds (no Hub / no SERVER_URL).
"use strict";

(function () {
  const DEV = typeof DEV_MODE !== "undefined" && DEV_MODE;
  const URL_ = typeof SERVER_URL !== "undefined" ? SERVER_URL : "";
  if (DEV || !URL_ || typeof Hub === "undefined") { window.Social = { openDM: () => {} }; return; }

  const css = document.createElement("style");
  css.textContent = `
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
.social-panel { position:fixed; right:10px; bottom:92px; z-index:61; width:300px;
  max-height:52vh; background:rgba(16,22,30,0.97); border:1px solid #46586a; border-radius:10px;
  color:#e6eef6; font:12px OpenDyslexic, Verdana, sans-serif; display:none; flex-direction:column;
  box-shadow:0 8px 30px rgba(0,0,0,0.45); overflow:hidden; }
.social-panel.on { display:flex; }
.social-panel .sp-head { padding:8px 12px; border-bottom:1px solid #2d3a48; color:#a8ffc9;
  font-size:13px; display:flex; justify-content:space-between; align-items:center; }
.social-panel .sp-head .sp-x { cursor:pointer; color:#9fb7c9; padding:0 4px; }
.social-panel .sp-body { overflow-y:auto; padding:6px 8px; }
#online-panel .op-row { display:flex; justify-content:space-between; align-items:center;
  gap:8px; padding:4px 4px; border-bottom:1px solid rgba(255,255,255,0.05); }
#online-panel .op-name { color:#a8ffc9; }
#online-panel .op-where { color:#8fa6bd; font-size:10.5px; }
#online-panel .op-w { background:#24463a; color:#c9ffe0; border:1px solid #3a6a52;
  border-radius:5px; padding:2px 8px; cursor:pointer; font:inherit; flex:0 0 auto; }
#online-panel .op-empty { color:#8fa6bd; padding:10px 4px; }
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

  // ---------- bottom-right buttons ----------
  const bar = document.createElement("div");
  bar.id = "social-bar";
  bar.innerHTML =
    `<button id="btn-online">◉ <span id="online-n">0</span> online</button>
     <button id="btn-dm">✉ Messages<span class="badge" id="dm-badge">0</span></button>`;
  document.body.appendChild(bar);
  const onlineNEl = bar.querySelector("#online-n");
  const dmBadge = bar.querySelector("#dm-badge");

  // ---------- online panel ----------
  const opanel = document.createElement("div");
  opanel.id = "online-panel";
  opanel.className = "social-panel";
  opanel.innerHTML = `<div class="sp-head"><span>Online now</span><span class="sp-x">✕</span></div>
    <div class="sp-body"></div>`;
  document.body.appendChild(opanel);
  const opBody = opanel.querySelector(".sp-body");
  opanel.querySelector(".sp-x").onclick = () => opanel.classList.remove("on");

  function renderOnline() {
    const list = [...Hub.online.entries()];
    onlineNEl.textContent = list.length;
    if (!opanel.classList.contains("on")) return;
    if (!list.length) { opBody.innerHTML = `<div class="op-empty">No one else is online right now. The world is quiet — for a moment.</div>`; return; }
    list.sort((a, b) => (b[1].clvl | 0) - (a[1].clvl | 0));
    opBody.innerHTML = "";
    for (const [id, o] of list) {
      const row = document.createElement("div");
      row.className = "op-row";
      row.innerHTML = `<div><span class="op-name">${esc(o.name)}</span> <span class="op-where">lvl ${o.clvl | 0}${o.zone ? " · " + esc(o.zone) : ""}</span></div>`;
      const b = document.createElement("button");
      b.className = "op-w";
      b.textContent = "Whisper";
      b.onclick = () => { openDM(id, o.name); };
      row.appendChild(b);
      opBody.appendChild(row);
    }
  }

  bar.querySelector("#btn-online").onclick = () => {
    opanel.classList.toggle("on");
    if (opanel.classList.contains("on")) { dpanel.classList.remove("on"); renderOnline(); }
  };
  Hub.onRoster(renderOnline);

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
    dpanel.classList.add("on"); opanel.classList.remove("on");
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
      opanel.classList.remove("on");
      if (!curPeer && threads.size) selectPeer([...threads.keys()][0]);
      else { renderTabs(); renderLog(); }
    }
  };

  Hub.onDM(m => {
    const mine = m.from === Hub.myId();
    if (mine) {
      // echo of a message I sent — peer is m.to
      const t = thread(m.to);
      t.msgs.push({ me: true, text: m.text });
      if (m.delivered === false && typeof log === "function")
        log("They're offline — your message will not have reached " + (t.name || "them") + ".", "sys");
    } else {
      const t = thread(m.from, m.name);
      t.msgs.push({ me: false, text: m.text });
      if (m.from !== curPeer || !dpanel.classList.contains("on")) {
        t.unread++;
        if (typeof log === "function") log("✉ Whisper from " + esc(m.name) + " — open Messages to reply.", "sys");
      }
    }
    refreshBadge(); renderTabs();
    if ((mine ? m.to : m.from) === curPeer) renderLog();
  });

  // ---------- visibility: the bar shows only while the hub is connected ----------
  setInterval(() => {
    const on = Hub.connected();
    bar.classList.toggle("on", on);
    if (!on) { opanel.classList.remove("on"); dpanel.classList.remove("on"); }
    else if (opanel.classList.contains("on")) renderOnline();
  }, 1000);

  window.Social = { openDM };
})();
