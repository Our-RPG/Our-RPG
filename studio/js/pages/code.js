// ===== Our RPG Workshop — Code submissions =====
// A board for community CODE: a contributor uploads a git diff, an extensive
// write-up of the proposed changes, and optional screenshots, for ANY part of
// the project — the game, worldgen, the Workshop site, the server, account
// handling, multiplayer, tooling, docs — EXCEPT the NPC engine, admin controls,
// and koha (those aren't open for submissions; the server refuses them too).
//
// The community votes on submissions, but NOTHING is applied automatically: a
// human reviews every one. A curator moves a submission to "merged" (applied by
// hand — the only way code lands) or "declined". Server: server/src/submissions.js
// (Taiao.submitCode / listCode / codeItem / voteCode / reviewCode …).
"use strict";

const CODE_STATUS = {
  open:      { label: "🗳 open",       cls: "" },
  reviewing: { label: "👀 in review",  cls: "info" },
  merged:    { label: "✓ merged",      cls: "ok" },
  declined:  { label: "✕ declined",    cls: "warn" },
  flagged:   { label: "⚑ flagged",     cls: "warn" },
  pending:   { label: "pending",       cls: "" },
};
const codeStatus = s => CODE_STATUS[s] || { label: s || "?", cls: "" };
const areaLabel = id => { const a = (typeof CODE_AREAS !== "undefined" ? CODE_AREAS : []).find(x => x.id === id); return a ? a.label : (id || "—"); };

function pageCode(root) {
  clear(root);
  const page = el("div.page");

  let composerOpen = false;
  const composerHost = el("div");
  const curatorHost = el("div");
  const boardHost = el("div");

  const closeComposer = () => { composerOpen = false; clear(composerHost); refreshBoard(); };
  page.appendChild(codeHeroCard(() => {
    composerOpen = !composerOpen;
    clear(composerHost);
    if (composerOpen) composerHost.appendChild(codeComposerCard(closeComposer));
  }));
  page.appendChild(composerHost);
  page.appendChild(curatorHost);
  page.appendChild(boardHost);
  root.appendChild(page);

  const state = { area: "", sort: "top" };
  function refreshBoard() { renderCodeBoard(boardHost, state); }

  function refreshCurator() {
    clear(curatorHost);
    if (typeof Taiao !== "undefined" && Taiao.logged() && Taiao.curator())
      curatorHost.appendChild(codeCuratorQueue(refreshBoard));
  }

  // Auth resolves a beat after boot; re-render the curator queue + chips then.
  if (typeof Taiao !== "undefined") Taiao.onAuth(() => { refreshCurator(); });
  refreshCurator();
  refreshBoard();
}

function codeHeroCard(onNew) {
  const c = el("div.card");
  c.appendChild(el("h2", { text: "Code submissions" }));
  c.appendChild(el("p.tagline", { html:
    "Propose a change to Our RPG with a real patch. Attach your <b>git diff</b>, write an extensive description of " +
    "what it changes and why, and add screenshots if they help. Submissions cover the game, worldgen, this Workshop " +
    "site, the server, account handling, multiplayer, tooling, and docs." }));
  c.appendChild(el("div.banner.info", { style: "margin-top:.6rem", html:
    "The community votes, but <b>nothing is applied automatically — every submission is reviewed by a human</b> before " +
    "anything lands. The NPC engine, admin controls, and koha aren't open for submissions." }));
  c.appendChild(el("div.btn-row", { style: "margin-top:.7rem" }, [
    el("button.btn.primary", { text: "＋ Submit code", onclick: onNew }),
    el("a.btn.ghost.sm", { text: "Contributing guide", href: "https://github.com/dataversion5372/Taiao/blob/main/CONTRIBUTING.md", target: "_blank", rel: "noopener" }),
  ]));
  return c;
}

// ---------------- composer: name + area + description + diff + screenshots ----------------

function codeComposerCard(onDone) {
  const c = el("div.card");
  c.appendChild(el("h3", { text: "Submit code" }));

  if (typeof Taiao === "undefined" || !Taiao.logged()) {
    c.appendChild(el("div.banner.warn", null, [
      "Sign in (", el("a", { text: "Settings", href: "#/settings" }), ") to submit code.",
    ]));
    return c;
  }

  const nameIn = el("input", { placeholder: "A short name, e.g. Fix river flooding overshoot", maxlength: "120" });
  const summaryIn = el("input", { placeholder: "One-line summary shown in the list", maxlength: "200" });

  const areaSel = el("select");
  areaSel.appendChild(el("option", { value: "", text: "Choose an area…" }));
  (typeof CODE_AREAS !== "undefined" ? CODE_AREAS : []).forEach(a =>
    areaSel.appendChild(el("option", { value: a.id, text: a.label })));
  const areaHint = el("small.tagline", { style: "display:block;margin-top:.2rem" });
  areaSel.addEventListener("change", () => {
    const a = (typeof CODE_AREAS !== "undefined" ? CODE_AREAS : []).find(x => x.id === areaSel.value);
    areaHint.textContent = a ? a.hint : "";
  });

  const descIn = el("textarea", { placeholder:
    "Describe the proposed changes in detail: what problem it solves, the approach, which files/systems it touches, " +
    "how you tested it, and anything a reviewer should know. Markdown is fine.", style: "min-height:11rem" });

  const diffIn = el("textarea", { placeholder: "Paste your git diff here, or choose a .diff / .patch file above.", style: "min-height:9rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem;white-space:pre" });
  const diffFile = el("input", { type: "file", accept: ".diff,.patch,.txt,text/plain" });
  const diffInfo = el("small.tagline", { style: "margin-left:.5rem" });
  diffFile.addEventListener("change", async () => {
    const f = diffFile.files && diffFile.files[0];
    if (!f) return;
    try { diffIn.value = await f.text(); diffInfo.textContent = f.name + " loaded (" + Math.round(f.size / 1024) + " KB)"; }
    catch (_) { toast("Couldn't read that file.", "err"); }
  });

  // screenshots (optional) — up to 6 image files, previewed before submit
  const MAXSHOTS = 6;
  let shots = [];
  const shotGrid = el("div", { style: "display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.4rem" });
  const shotFile = el("input", { type: "file", accept: "image/*", multiple: "multiple" });
  function renderShots() {
    clear(shotGrid);
    shots.forEach((f, i) => {
      const cell = el("div", { style: "position:relative" });
      const img = el("img", { style: "width:84px;height:84px;object-fit:cover;border-radius:8px;background:#0003" });
      try { img.src = URL.createObjectURL(f); img.onload = () => URL.revokeObjectURL(img.src); } catch (_) {}
      const x = el("button.btn.ghost.sm", { text: "×", title: "Remove", style: "position:absolute;top:-6px;right:-6px;padding:0 .4rem;line-height:1.4", onclick: () => { shots.splice(i, 1); renderShots(); } });
      cell.appendChild(img); cell.appendChild(x);
      shotGrid.appendChild(cell);
    });
  }
  shotFile.addEventListener("change", () => {
    for (const f of Array.from(shotFile.files || [])) { if (shots.length >= MAXSHOTS) break; shots.push(f); }
    shotFile.value = "";
    renderShots();
  });

  c.appendChild(el("label.field", null, [el("span", { text: "Name" }), nameIn]));
  c.appendChild(el("label.field", null, [el("span", { text: "One-line summary" }), summaryIn]));
  c.appendChild(el("label.field", null, [el("span", { text: "Area" }), areaSel, areaHint]));
  c.appendChild(el("label.field", { style: "margin-top:.4rem" }, [el("span", { text: "Description of the proposed changes" }), descIn]));
  c.appendChild(el("label.field", { style: "margin-top:.4rem" }, [el("span", { text: "Git diff" })]));
  c.appendChild(el("div.btn-row", { style: "align-items:center" }, [diffFile, diffInfo]));
  c.appendChild(diffIn);
  c.appendChild(el("label.field", { style: "margin-top:.4rem" }, [el("span", { text: "Screenshots (optional, up to 6)" }), shotFile]));
  c.appendChild(shotGrid);

  const status = el("div.tagline", { style: "min-height:1.2em;margin-top:.5rem" });
  const submitBtn = el("button.btn.primary", { text: "Submit for review" });
  submitBtn.addEventListener("click", async () => {
    const name = nameIn.value.trim(), summary = summaryIn.value.trim(), area = areaSel.value;
    const description = descIn.value.trim(), diff = diffIn.value;
    if (!name) { toast("Give your submission a name.", "warn"); return; }
    if (!summary) { toast("Add a one-line summary.", "warn"); return; }
    if (!area) { toast("Pick an area.", "warn"); return; }
    if (description.length < 40) { toast("Please describe the changes in more detail.", "warn"); return; }
    if (!diff.trim()) { toast("Attach your git diff.", "warn"); return; }

    // Authorship disclosure (shared util), same honest question the art flow asks.
    const prov = await askProvenance("code");
    if (prov == null) return;   // cancelled

    submitBtn.disabled = true;
    const load = toastLoading("Submitting…");
    try {
      const r = await Taiao.submitCode({ name, summary, area, description, diff, provenance: prov });
      if (!r || r.error) { load.fail((r && r.error) || "Submit failed."); submitBtn.disabled = false; return; }
      // Upload screenshots now that we have the id (best-effort; optional).
      for (let i = 0; i < shots.length; i++) {
        load.update("Uploading screenshot " + (i + 1) + " of " + shots.length + "…");
        const up = await Taiao.uploadCodeShot(r.id, i, shots[i]);
        if (up && up.error) { toast("Screenshot " + (i + 1) + ": " + up.error, "warn"); }
      }
      load.done("Submitted — it's on the board for review.");
      onDone && onDone();
    } catch (e) {
      load.fail((e && e.message) || "Submit failed.");
      submitBtn.disabled = false;
    }
  });
  c.appendChild(status);
  c.appendChild(el("div.btn-row", { style: "margin-top:.4rem" }, [submitBtn]));
  return c;
}

// ---------------- the board ----------------

async function renderCodeBoard(host, state) {
  clear(host);
  const card = el("div.card");

  // filters
  const areaFilter = el("select");
  areaFilter.appendChild(el("option", { value: "", text: "All areas" }));
  (typeof CODE_AREAS !== "undefined" ? CODE_AREAS : []).forEach(a => areaFilter.appendChild(el("option", { value: a.id, text: a.label })));
  areaFilter.value = state.area || "";
  areaFilter.addEventListener("change", () => { state.area = areaFilter.value; renderCodeBoard(host, state); });

  const sortSel = el("select");
  sortSel.appendChild(el("option", { value: "top", text: "Most votes" }));
  sortSel.appendChild(el("option", { value: "new", text: "Newest" }));
  sortSel.value = state.sort || "top";
  sortSel.addEventListener("change", () => { state.sort = sortSel.value; renderCodeBoard(host, state); });

  card.appendChild(el("div.sectitle", null, [
    el("h3", { text: "Submissions" }),
    el("div.btn-row", { style: "align-items:center;gap:.5rem" }, [areaFilter, sortSel]),
  ]));

  const body = el("div", null, [el("p.tagline", { text: "Loading…" })]);
  card.appendChild(body);
  host.appendChild(card);

  let rows;
  try { rows = await Taiao.listCode({ area: state.area, sort: state.sort }); }
  catch (_) { rows = null; }
  clear(body);
  if (!Array.isArray(rows)) { body.appendChild(el("div.banner.warn", { text: "Couldn't reach the server — the board will be back." })); return; }
  if (!rows.length) { body.appendChild(el("p.tagline", { text: "No submissions yet — be the first to send a patch." })); return; }

  const table = el("table.tf", null, [el("thead", null, [el("tr", null, [
    el("th", { text: "Submission" }), el("th", { text: "Area" }), el("th", { text: "By" }),
    el("th", { text: "Status" }), el("th", { text: "Votes" }),
  ])])]);
  const tb = el("tbody");
  rows.forEach(r => tb.appendChild(codeBoardRow(r, () => renderCodeBoard(host, state))));
  table.appendChild(tb);
  body.appendChild(table);
}

function codeBoardRow(r, refresh) {
  const st = codeStatus(r.status);
  const voteBtn = el("button.btn.sm" + (Taiao.myCodeVoted(r.id) ? ".primary" : ".ghost"), {
    text: "▲ " + (r.votes || 0),
    title: "Vote for this submission",
    onclick: async e => {
      e.stopPropagation();
      if (!Taiao.logged()) { toast("Sign in to vote.", "warn"); return; }
      voteBtn.disabled = true;
      const res = await Taiao.voteCode(r.id);
      voteBtn.disabled = false;
      if (!res || res.error) { toast((res && res.error) || "Couldn't vote.", "err"); return; }
      r.votes = (r.votes || 0) + (res.voted ? 1 : -1);
      voteBtn.textContent = "▲ " + r.votes;
      voteBtn.className = "btn sm " + (res.voted ? "primary" : "ghost");
    },
  });
  const nameCell = el("td", null, [
    el("div", { style: "font-weight:600", text: r.name || "(untitled)" }),
    el("small.tagline", { text: r.summary || "" }),
  ]);
  return el("tr", { style: "cursor:pointer", onclick: () => openCodeDetail(r, refresh) }, [
    nameCell,
    el("td", null, [el("span.badge", { text: areaLabel(r.area) })]),
    el("td", null, [el("span.u", { text: "@" + (r.username || "someone") })]),
    el("td", null, [el("span.badge" + (st.cls ? "." + st.cls : ""), { text: st.label })]),
    el("td", null, [voteBtn]),
  ]);
}

// ---------------- detail modal ----------------

async function openCodeDetail(row, refresh) {
  const bg = el("div.modal-bg", { onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el("div.modal", { style: "width:min(880px,96vw)" });
  m.appendChild(el("span.x", { text: "×", onclick: () => bg.remove() }));
  m.appendChild(el("h2", { text: row.name || "(untitled)" }));
  const st = codeStatus(row.status);
  m.appendChild(el("p.credit", null, [
    "by ", el("span.u", { text: "@" + (row.username || "someone") }),
    " · ", el("span.badge", { text: areaLabel(row.area) }),
    " · ", el("span.badge" + (st.cls ? "." + st.cls : ""), { text: st.label }),
  ]));

  const body = el("div", null, [el("p.tagline", { text: "Loading…" })]);
  m.appendChild(body);

  // actions row: vote + flag + close (curator + author controls added after load)
  const voteBtn = el("button.btn" + (Taiao.myCodeVoted(row.id) ? ".primary" : ".gold"), {
    text: "▲ Vote (" + (row.votes || 0) + ")",
    onclick: async () => {
      if (!Taiao.logged()) { toast("Sign in to vote.", "warn"); return; }
      voteBtn.disabled = true;
      const res = await Taiao.voteCode(row.id);
      voteBtn.disabled = false;
      if (!res || res.error) { toast((res && res.error) || "Couldn't vote.", "err"); return; }
      row.votes = (row.votes || 0) + (res.voted ? 1 : -1);
      voteBtn.textContent = "▲ Vote (" + row.votes + ")";
      voteBtn.className = "btn " + (res.voted ? "primary" : "gold");
      refresh && refresh();
    },
  });
  const flagBtn = el("button.btn.ghost.sm", { text: "⚑ Flag", onclick: async () => {
    if (!Taiao.logged()) { toast("Sign in to flag.", "warn"); return; }
    const res = await Taiao.flagCode(row.id);
    toast(res && res.ok ? "Flagged for review." : ((res && res.error) || "Couldn't flag."), res && res.ok ? "ok" : "err");
  } });
  const actions = el("div.btn-row", { style: "margin-top:.8rem;flex-wrap:wrap" }, [voteBtn, flagBtn, el("button.btn.ghost", { text: "Close", onclick: () => bg.remove() })]);
  m.appendChild(actions);

  bg.appendChild(m); document.body.appendChild(bg);

  const full = await Taiao.codeItem(row.id);
  clear(body);
  if (!full || full.error) { body.appendChild(el("div.banner.warn", { text: (full && full.error) || "Couldn't load this submission." })); return; }

  // reconcile the authoritative vote state the server returned
  if (typeof full.viewerVoted === "boolean") {
    voteBtn.textContent = "▲ Vote (" + (full.votes != null ? full.votes : row.votes || 0) + ")";
    voteBtn.className = "btn " + (full.viewerVoted ? "primary" : "gold");
  }

  const payload = full.payload || {};

  // Every field below is UNTRUSTED contributor text — rendered only via el()'s
  // `text` (textContent), never innerHTML.
  const sectionPre = (label, text, mono) => {
    if (!text) return;
    body.appendChild(el("h3", { style: "font-size:.85rem;margin:.9rem 0 .3rem", text: label }));
    body.appendChild(el("pre", {
      style: "white-space:pre-wrap;" + (mono ? "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow-x:auto;" : "font-family:inherit;") +
        "font-size:.84rem;background:var(--bg-2);padding:.7rem .8rem;border-radius:8px;margin:0;max-height:" + (mono ? "440px" : "320px") + ";overflow-y:auto",
      text,
    }));
  };

  if (payload.provenance)
    body.appendChild(el("p.tagline", { text: payload.provenance === "ai" ? "Disclosed as AI-assisted." : "Disclosed as the author's own work." }));

  sectionPre("Description", payload.description);

  // screenshots
  if (row.shots || (full.shots)) {
    const n = Number(full.shots || row.shots || 0);
    if (n > 0) {
      body.appendChild(el("h3", { style: "font-size:.85rem;margin:.9rem 0 .3rem", text: "Screenshots" }));
      const grid = el("div", { style: "display:flex;gap:.5rem;flex-wrap:wrap" });
      for (let i = 0; i < n; i++) {
        const a = el("a", { href: Taiao.codeShotUrl(row.id, i), target: "_blank", rel: "noopener" });
        a.appendChild(el("img", { src: Taiao.codeShotUrl(row.id, i), style: "max-width:220px;max-height:220px;border-radius:8px;background:#0003", loading: "lazy" }));
        grid.appendChild(a);
      }
      body.appendChild(grid);
    }
  }

  // the diff
  const dl = full.diff_lines || row.diff_lines || 0;
  sectionPre("Git diff" + (dl ? " (" + dl + " lines)" : ""), payload.diff, true);
  if (payload.diff) {
    const copyBtn = el("button.btn.ghost.sm", { text: "⧉ Copy diff", onclick: async () => {
      try { await navigator.clipboard.writeText(payload.diff); toast("Diff copied.", "ok"); }
      catch (_) { toast("Couldn't copy — select and copy manually.", "warn"); }
    } });
    const dlBtn = el("button.btn.ghost.sm", { text: "⭳ Download .diff", onclick: () => {
      const blob = new Blob([payload.diff], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: (slug(row.name) || "submission") + ".diff" });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } });
    body.appendChild(el("div.btn-row", { style: "margin-top:.4rem" }, [copyBtn, dlBtn]));
  }

  // curator verdict note, if any
  if (full.review_note)
    body.appendChild(el("div.banner.info", { style: "margin-top:.8rem", text: "Reviewer note: " + full.review_note }));

  // author: remove own submission
  const me = Taiao.logged() && ("@" + Taiao.username() === "@" + (row.username || ""));
  const isCur = Taiao.logged() && Taiao.curator();
  if (me && !isCur) {
    actions.appendChild(el("button.btn.danger.sm", { text: "Delete", onclick: async () => {
      if (!confirm("Remove this submission? This can't be undone.")) return;
      const res = await Taiao.deleteCode(row.id);
      if (res && res.ok) { toast("Removed.", "ok"); bg.remove(); refresh && refresh(); }
      else toast((res && res.error) || "Couldn't remove.", "err");
    } }));
  }

  // curator review controls
  if (isCur) body.appendChild(codeCuratorControls(row, () => { bg.remove(); refresh && refresh(); }));
}

// ---------------- curator controls ----------------

function codeCuratorControls(row, onActed) {
  const box = el("div", { style: "margin-top:1rem;padding-top:.8rem;border-top:1px solid var(--line-2)" });
  box.appendChild(el("h3", { style: "font-size:.85rem;margin:0 0 .3rem", text: "Curator review" }));
  box.appendChild(el("p.tagline", { text: "Nothing applies automatically. Merge means you've applied the patch by hand; decline hides it from the public feed." }));
  const note = el("input", { placeholder: "Optional note shown to the author…", maxlength: "2000" });
  box.appendChild(el("label.field", null, [el("span", { text: "Reviewer note" }), note]));
  const status = el("small.tagline", { style: "margin-left:.5rem" });

  const act = async (st, label) => {
    const res = await Taiao.reviewCode(row.id, st, note.value.trim() || null);
    if (res && res.ok) { toast(label, "ok"); onActed && onActed(); }
    else { status.textContent = (res && res.error) || "Failed."; }
  };
  box.appendChild(el("div.btn-row", { style: "margin-top:.4rem;flex-wrap:wrap" }, [
    el("button.btn.sm", { text: "👀 Mark in review", onclick: () => act("reviewing", "Marked in review.") }),
    el("button.btn.primary.sm", { text: "✓ Merged", onclick: () => act("merged", "Marked merged.") }),
    el("button.btn.danger.sm", { text: "✕ Decline", onclick: () => act("declined", "Declined.") }),
    el("button.btn.ghost.sm", { text: "↺ Reopen", onclick: () => act("open", "Reopened for voting.") }),
    status,
  ]));
  return box;
}

// Curator attention queue, shown above the public board for curators only.
async function codeCuratorQueue(refreshBoard) {
  const card = el("div.card", { style: "border-color:var(--accent,#8f7ef0)" });
  card.appendChild(el("div.sectitle", null, [
    el("h3", { text: "Review queue" }),
    el("span.badge", { text: "curator" }),
  ]));
  card.appendChild(el("p.tagline", { text: "Flagged submissions first, then everything still awaiting a human verdict — most-voted first." }));
  const body = el("div", null, [el("p.tagline", { text: "Loading…" })]);
  card.appendChild(body);

  const refresh = async () => {
    clear(body);
    const q = await Taiao.codePending();
    clear(body);
    if (q && q.error) { body.appendChild(el("div.banner.warn", { text: q.error })); return; }
    const rows = Array.isArray(q) ? q : [];
    if (!rows.length) { body.appendChild(el("p.tagline", { text: "Queue clear — nothing waiting." })); return; }
    const table = el("table.tf", null, [el("thead", null, [el("tr", null, [
      el("th", { text: "Submission" }), el("th", { text: "Area" }), el("th", { text: "By" }),
      el("th", { text: "Status" }), el("th", { text: "⚑" }), el("th", { text: "Votes" }),
    ])])]);
    const tb = el("tbody");
    rows.forEach(r => {
      const st = codeStatus(r.status);
      tb.appendChild(el("tr", { style: "cursor:pointer", onclick: () => openCodeDetail(r, () => { refresh(); refreshBoard && refreshBoard(); }) }, [
        el("td", null, [el("div", { style: "font-weight:600", text: r.name || "(untitled)" }), el("small.tagline", { text: r.summary || "" })]),
        el("td", null, [el("span.badge", { text: areaLabel(r.area) })]),
        el("td", null, [el("span.u", { text: "@" + (r.username || "someone") })]),
        el("td", null, [el("span.badge" + (st.cls ? "." + st.cls : ""), { text: st.label })]),
        el("td", { text: String(r.flags || 0) }),
        el("td", { text: String(r.votes || 0) }),
      ]));
    });
    table.appendChild(tb);
    body.appendChild(table);
  };
  refresh();
  return card;
}
