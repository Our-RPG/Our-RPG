// ===== Our RPG Workshop — Bug reports =====
// A board where players report bugs they've hit. Other players confirm "I've
// experienced this too" (a switchable me-too vote) and add specifics / further
// context as comments. A curator triages status (confirmed / fixed / closed).
// Server: server/src/bugs.js (Taiao.reportBug / listBugs / bugItem / voteBug /
// commentBug / flagBug / reviewBug). Nothing here touches the game — it's a
// triage board, not a patch pipeline (that's the Code tab).
"use strict";

// Player-facing areas — MUST match server/src/bugs.js AREAS.
const BUG_AREAS = [
  { id: "gameplay",    label: "Gameplay" },
  { id: "graphics",    label: "Graphics / rendering" },
  { id: "world",       label: "World / worldgen" },
  { id: "multiplayer", label: "Multiplayer" },
  { id: "account",     label: "Account / sign-in" },
  { id: "workshop",    label: "Workshop site" },
  { id: "audio",       label: "Audio" },
  { id: "performance", label: "Performance" },
  { id: "other",       label: "Other" },
];
const bugAreaLabel = id => { const a = BUG_AREAS.find(x => x.id === id); return a ? a.label : (id || "—"); };

const BUG_STATUS = {
  open:      { label: "🐞 open",        cls: "" },
  confirmed: { label: "👀 confirmed",   cls: "info" },
  fixed:     { label: "✓ fixed",        cls: "ok" },
  closed:    { label: "✕ closed",       cls: "warn" },
  flagged:   { label: "⚑ flagged",      cls: "warn" },
};
const bugStatus = s => BUG_STATUS[s] || { label: s || "?", cls: "" };

// compact relative time (self-contained — no shared helper in the studio).
function bugAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - (Number(ts) || 0)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return m + "m ago";
  const h = Math.round(m / 60); if (h < 24) return h + "h ago";
  const d = Math.round(h / 24); if (d < 30) return d + "d ago";
  return Math.round(d / 30) + "mo ago";
}

function pageBugs(root) {
  clear(root);
  const page = el("div.page");

  let composerOpen = false;
  const composerHost = el("div");
  const boardHost = el("div");

  const closeComposer = () => { composerOpen = false; clear(composerHost); refreshBoard(); };
  page.appendChild(bugHeroCard(() => {
    composerOpen = !composerOpen;
    clear(composerHost);
    if (composerOpen) composerHost.appendChild(bugComposerCard(closeComposer));
  }));
  page.appendChild(composerHost);
  page.appendChild(boardHost);
  root.appendChild(page);

  const state = { area: "", status: "", sort: "top" };
  function refreshBoard() { renderBugBoard(boardHost, state); }

  if (typeof Taiao !== "undefined") Taiao.onAuth(() => { refreshBoard(); });
  refreshBoard();
}

function bugHeroCard(onNew) {
  const c = el("div.card");
  c.appendChild(el("h2", { text: "Bug reports" }));
  c.appendChild(el("p.tagline", { html:
    "Hit something that went wrong? Report it here. If you've run into a bug someone else already filed, " +
    "<b>confirm it</b> (“I've experienced this too”) so we can see how many players it affects — and " +
    "<b>add context</b> (your steps, platform, a workaround) in the comments." }));
  c.appendChild(el("div.banner.info", { style: "margin-top:.6rem", html:
    "The more confirmations and specifics a bug gathers, the easier it is to track down and fix. This is a triage board, " +
    "not a patch pipeline — to propose an actual fix, use the <a href='#/code'>Code</a> tab." }));
  c.appendChild(el("div.btn-row", { style: "margin-top:.7rem" }, [
    el("button.btn.primary", { text: "＋ Report a bug", onclick: () => {
      if (typeof Taiao !== "undefined" && !Taiao.logged()) { toast("Sign in (Settings) to report a bug.", "warn"); App.go("#/settings"); return; }
      onNew();
    } }),
  ]));
  return c;
}

function bugComposerCard(onDone) {
  const c = el("div.card", { style: "background:var(--bg-2)" });
  c.appendChild(el("div.sectitle", null, [el("h3", { text: "Report a bug" })]));

  const titleIn = el("input", { placeholder: "short title, e.g. “Fishing rod disappears after casting in the rain”", maxlength: "140" });
  const areaSel = el("select");
  BUG_AREAS.forEach(a => areaSel.appendChild(el("option", { value: a.id, text: a.label })));
  const bodyIn = el("textarea", { placeholder: "What happened? Steps to reproduce, what you expected vs. what you got, your platform (browser / itch / web), and anything else useful.", style: "min-height:9rem" });

  const note = el("div.tagline", { style: "min-height:1.2em" });
  const go = el("button.btn.primary", { text: "Submit bug report" });
  go.onclick = async () => {
    const title = titleIn.value.trim(), body = bodyIn.value.trim();
    if (!title) { note.textContent = "Give it a short title."; return; }
    if (body.length < 15) { note.textContent = "Describe what happened in a little more detail."; return; }
    go.disabled = true; note.textContent = "Submitting…";
    const r = await Taiao.reportBug({ title, area: areaSel.value, body });
    if (r && r.ok) { toast("Bug reported — thanks! Others can confirm it now.", "ok", 5000); onDone && onDone(); }
    else { go.disabled = false; note.textContent = (r && r.error) || "Couldn't submit the report."; }
  };

  c.appendChild(el("label.field", null, [el("span", { text: "Title" }), titleIn]));
  c.appendChild(el("label.field", null, [el("span", { text: "Area" }), areaSel]));
  c.appendChild(el("label.field", null, [el("span", { text: "What happened" }), bodyIn]));
  c.appendChild(el("div.btn-row", { style: "margin-top:.6rem" }, [go, el("button.btn.ghost", { text: "Cancel", onclick: () => onDone && onDone() }), note]));
  return c;
}

// filter bar + the list of bug cards
function renderBugBoard(host, state) {
  clear(host);
  const card = el("div.card");

  // filters
  const areaSel = el("select");
  areaSel.appendChild(el("option", { value: "", text: "All areas" }));
  BUG_AREAS.forEach(a => areaSel.appendChild(el("option", { value: a.id, text: a.label, selected: state.area === a.id })));
  areaSel.onchange = () => { state.area = areaSel.value; load(); };

  const statusSel = el("select");
  [["", "Open & fixed"], ["open", "Open"], ["confirmed", "Confirmed"], ["fixed", "Fixed"]].forEach(([v, l]) =>
    statusSel.appendChild(el("option", { value: v, text: l, selected: state.status === v })));
  statusSel.onchange = () => { state.status = statusSel.value; load(); };

  const sortSel = el("select");
  [["top", "Most confirmed"], ["new", "Newest"]].forEach(([v, l]) =>
    sortSel.appendChild(el("option", { value: v, text: l, selected: state.sort === v })));
  sortSel.onchange = () => { state.sort = sortSel.value; load(); };

  card.appendChild(el("div.sectitle", null, [
    el("h3", null, ["Reported bugs ", el("span.hint", { text: "confirm the ones you've hit; add context in the comments" })]),
    el("div.btn-row", { style: "gap:.5rem;flex-wrap:wrap" }, [areaSel, statusSel, sortSel]),
  ]));
  const listHost = el("div");
  card.appendChild(listHost);
  host.appendChild(card);

  async function load() {
    clear(listHost);
    listHost.appendChild(el("p.tagline", { text: "Loading…" }));
    const bugs = await Taiao.listBugs({ area: state.area, status: state.status, sort: state.sort });
    clear(listHost);
    if (bugs === null) { listHost.appendChild(el("div.empty", { text: "Couldn't reach the server — try again in a moment." })); return; }
    if (!bugs.length) { listHost.appendChild(el("p.tagline", { text: "No bugs here yet. If you've hit one, be the first to report it." })); return; }
    for (const b of bugs) listHost.appendChild(bugCard(b, load));
  }
  load();
}

// confirm ("me too") toggle — optimistic; viewerVoted is known only once a bug
// is expanded (the cached list doesn't carry per-user state).
function bugConfirmButton(b) {
  let voted = !!b.viewerVoted, count = Number(b.votes || 0);
  const locked = !(b.status === "open" || b.status === "confirmed");
  const btn = el("button.btn.sm" + (locked ? ".ghost" : ""), { title: "I've experienced this bug too" });
  const paint = () => {
    btn.textContent = (voted ? "✓ " : "▲ ") + count + " confirmed" + (voted ? " (incl. you)" : "");
    btn.classList.toggle("gold", voted);
  };
  if (locked) { btn.disabled = true; paint(); btn.title = "This bug is " + b.status; return btn; }
  btn.onclick = async () => {
    if (typeof Taiao === "undefined" || !Taiao.logged()) { toast("Sign in (Settings) to confirm a bug.", "warn"); App.go("#/settings"); return; }
    btn.disabled = true;
    const r = await Taiao.voteBug(b.id);
    btn.disabled = false;
    if (r && r.ok) { voted = r.voted; count = Math.max(0, count + (r.voted ? 1 : -1)); paint(); }
    else toast((r && r.error) || "Couldn't record that.", "err");
  };
  paint();
  return btn;
}

function bugCard(b, refreshBoard) {
  const card = el("div.card", { style: "margin-bottom:.7rem" });
  const st = bugStatus(b.status);

  const head = el("div.sectitle", null, [
    el("h3", { style: "font-size:1rem", text: b.title }),
    el("div.btn-row", { style: "gap:.4rem;flex-wrap:wrap" }, [
      el("span.badge", { text: bugAreaLabel(b.area) }),
      el("span.badge" + (st.cls ? "." + st.cls : ""), { text: st.label }),
    ]),
  ]);
  card.appendChild(head);

  const meta = el("div.btn-row", { style: "gap:.7rem;align-items:center;flex-wrap:wrap;margin:.2rem 0 .1rem" }, [
    bugConfirmButton(b),
    el("small.tagline", { text: "💬 " + Number(b.comments || 0) + (Number(b.comments || 0) === 1 ? " comment" : " comments") }),
    el("small.credit", null, ["by ", el("span.u", { text: "@" + (b.username || "someone") })]),
    el("small.tagline", { text: bugAgo(b.created_at) }),
    el("button.btn.sm.ghost", { text: "Details ▾", onclick: () => toggle() }),
  ]);
  card.appendChild(meta);

  const body = el("div", { style: "display:none;margin-top:.5rem;border-top:1px solid var(--line-2,#222);padding-top:.5rem" });
  card.appendChild(body);

  let open = false, loaded = false;
  function toggle() {
    open = !open;
    body.style.display = open ? "block" : "none";
    meta.querySelector("button:last-child").textContent = open ? "Details ▴" : "Details ▾";
    if (open && !loaded) { loaded = true; loadDetail(); }
  }

  async function loadDetail() {
    body.appendChild(el("p.tagline", { text: "Loading…" }));
    const full = await Taiao.bugItem(b.id);
    clear(body);
    if (!full || full.error) { body.appendChild(el("div.empty", { text: (full && full.error) || "Couldn't load this bug." })); return; }
    body.appendChild(el("div", { style: "white-space:pre-wrap;line-height:1.45", text: full.body || "" }));
    if (full.review_note)
      body.appendChild(el("div.banner.info", { style: "margin-top:.5rem", html: "<b>Curator note:</b> " + escapeHtml(full.review_note) }));

    // comments
    body.appendChild(el("h4", { style: "margin:.8rem 0 .3rem;font-size:.85rem;color:var(--ink-dim)", text: "Context & specifics" }));
    const clist = el("div", { style: "display:flex;flex-direction:column;gap:.45rem" });
    body.appendChild(clist);
    const paintComments = cs => {
      clear(clist);
      if (!cs.length) { clist.appendChild(el("p.tagline", { text: "No extra context yet — add what you know." })); return; }
      for (const c of cs) clist.appendChild(el("div.card", { style: "background:var(--bg-2);padding:.5rem .6rem;margin:0" }, [
        el("div", { style: "white-space:pre-wrap;line-height:1.4", text: c.body }),
        el("small.credit", null, ["— ", el("span.u", { text: "@" + (c.username || "someone") }), document.createTextNode(" · " + bugAgo(c.created_at))]),
      ]));
    };
    paintComments(full.comments || []);

    // add a comment
    const addBox = el("textarea", { placeholder: "Add context — repro steps, your platform, a workaround…", style: "min-height:4.5rem;margin-top:.5rem" });
    const addBtn = el("button.btn.sm.primary", { text: "Add context" });
    const addNote = el("small.tagline");
    addBtn.onclick = async () => {
      if (typeof Taiao === "undefined" || !Taiao.logged()) { toast("Sign in (Settings) to comment.", "warn"); App.go("#/settings"); return; }
      const text = addBox.value.trim();
      if (!text) { addNote.textContent = "Write something first."; return; }
      addBtn.disabled = true; addNote.textContent = "Posting…";
      const r = await Taiao.commentBug(b.id, text);
      addBtn.disabled = false;
      if (r && r.ok) {
        addBox.value = ""; addNote.textContent = "";
        const fresh = await Taiao.bugItem(b.id);
        if (fresh && fresh.comments) paintComments(fresh.comments);
      } else addNote.textContent = (r && r.error) || "Couldn't post that.";
    };
    body.appendChild(el("div", { style: "margin-top:.3rem" }, [addBox, el("div.btn-row", { style: "margin-top:.4rem" }, [addBtn, addNote])]));

    // footer: flag + curator triage
    const footer = el("div.btn-row", { style: "margin-top:.7rem;gap:.5rem;flex-wrap:wrap" }, [
      el("button.btn.sm.ghost", { text: "⚑ Flag", title: "Report this as spam / abuse / off-topic", onclick: async () => {
        if (typeof Taiao === "undefined" || !Taiao.logged()) { toast("Sign in to flag.", "warn"); return; }
        const r = await Taiao.flagBug(b.id);
        toast(r && r.ok ? "Flagged for a curator — thanks." : ((r && r.error) || "Couldn't flag."), r && r.ok ? "ok" : "err");
      } }),
    ]);
    if (typeof Taiao !== "undefined" && Taiao.logged() && Taiao.curator()) {
      const stSel = el("select");
      ["open", "confirmed", "fixed", "closed"].forEach(s => stSel.appendChild(el("option", { value: s, text: s, selected: s === b.status })));
      const noteIn = el("input", { placeholder: "triage note (optional)", style: "max-width:220px" });
      const applyBtn = el("button.btn.sm", { text: "Set status", onclick: async () => {
        applyBtn.disabled = true;
        const r = await Taiao.reviewBug(b.id, stSel.value, noteIn.value.trim() || null);
        applyBtn.disabled = false;
        if (r && r.ok) { toast("Status updated.", "ok"); refreshBoard && refreshBoard(); } else toast((r && r.error) || "Couldn't update.", "err");
      } });
      footer.appendChild(el("span.badge", { text: "curator" }));
      footer.appendChild(stSel); footer.appendChild(noteIn); footer.appendChild(applyBtn);
    }
    body.appendChild(footer);
  }

  return card;
}
