// ===== Taiao Workshop — curator moderation queue =====
// The moderation team (users carrying the 'curator' flag) reviews here.
// Two things land in the queue, both hidden from the public vote dialogues
// until a curator acts (server: workshop.pendingQueue / review):
//   • user-UPLOADED assets awaiting a first review (status 'pending')
//   • anything the community auto-hid at FLAG_HIDE_AT flags (status 'flagged')
// PixelLab-generated art and pure data proposals never appear here — they go
// straight to voting.  Approve → the proposal becomes voteable; Decline → it's
// hidden (the author still sees it under Settings → "My proposals").
"use strict";

function pageReview(root) {
  clear(root);
  const page = el("div.page");
  page.appendChild(el("h2", { text: "Moderation queue" }));
  page.appendChild(el("p.tagline", { html:
    "User-uploaded art and community-flagged proposals wait here until a curator reviews them. " +
    "<b>Approve</b> makes a proposal voteable in the 🗳 dialogues; <b>Decline</b> hides it. " +
    "PixelLab-generated art and data proposals skip this queue. Undisclosed AI → decline." }));

  const gate = el("div.banner");
  page.appendChild(gate);
  const list = el("div", { style: "margin-top:1rem" });
  page.appendChild(list);
  const adopt = el("div", { style: "margin-top:1.4rem" });
  page.appendChild(adopt);
  root.appendChild(page);

  function gateMessage(text, cls) {
    gate.className = "banner " + (cls || "warn");
    gate.textContent = text;
    clear(list);
  }

  async function load() {
    if (typeof Taiao === "undefined" || !Taiao.logged()) {
      gateMessage("Sign in with a curator account (Settings) to review proposals.");
      return;
    }
    if (!Taiao.curator()) {
      gateMessage("This queue is for curators only. Ask an admin to grant your account the curator role.");
      return;
    }
    gate.className = "banner info";
    gate.textContent = "Loading the queue…";
    const queue = await Taiao.pendingQueue();
    if (queue && queue.error) { gateMessage(queue.error); return; }
    const rows = Array.isArray(queue) ? queue : [];
    if (!rows.length) {
      gate.className = "banner ok";
      gate.textContent = "Nothing waiting — the queue is clear. Ka pai!";
      clear(list);
      return;
    }
    gate.className = "banner info";
    gate.textContent = rows.length + " proposal" + (rows.length === 1 ? "" : "s") + " awaiting review.";
    clear(list);
    rows.forEach(r => list.appendChild(reviewCard(r, load)));
  }

  async function loadAdopt() {
    clear(adopt);
    if (typeof Taiao === "undefined" || !Taiao.logged() || !Taiao.curator()) return;   // moderation-queue gate above explains why
    adopt.appendChild(el("h3", { text: "Adopt into the game" }));
    adopt.appendChild(el("p.tagline", { text:
      "Open proposals, already voted on by the community. Adopting one skips the rest of the vote and ships it " +
      "straight into everyone's game via the community layer — the same destination a PixelLab generation that " +
      "fills a declared gap reaches automatically." }));
    const body = el("div", null, [el("p.tagline", { text: "Loading…" })]);
    adopt.appendChild(body);
    const r = await Taiao.listProposalsRaw();   // default status "open", already endorsements DESC
    clear(body);
    if (!r || r.error || !Array.isArray(r.proposals)) {
      body.appendChild(el("div.banner.warn", { text: "Couldn't load open proposals: " + ((r && r.error) || "unknown error") }));
      return;
    }
    if (!r.proposals.length) { body.appendChild(el("p.tagline", { text: "Nothing open right now." })); return; }
    r.proposals.forEach(p => body.appendChild(adoptCard(p)));
  }

  // Auth resolves a beat after boot; re-load when it settles.
  Taiao.onAuth(() => { load(); loadAdopt(); });
  load();
  loadAdopt();
}

function adoptCard(p) {
  const card = el("div.card", { style: "margin-bottom:.6rem" });
  card.appendChild(el("div.sectitle", null, [
    el("h3", { style: "font-size:.95rem", text: p.title || p.subject }),
    el("span.badge", { text: (p.endorsements || 0) + " ▲" }),
  ]));
  card.appendChild(el("p.tagline", { html: "by <b>@" + escapeHtml(p.username || "?") + "</b> · " + escapeHtml(p.subject || "") }));
  const btn = el("button.btn.primary.sm", { text: "Adopt into the game" });
  const status = el("small.tagline", { style: "margin-left:.5rem" });
  btn.onclick = async () => {
    btn.disabled = true; status.textContent = "Adopting…";
    const res = await Taiao.review(p.id, "adopt");
    if (res && res.ok) { toast("Adopted — it's in everyone's game via the community layer.", "ok"); card.remove(); }
    else { status.textContent = (res && res.error) || "Failed."; btn.disabled = false; }
  };
  card.appendChild(el("div.btn-row", { style: "margin-top:.4rem" }, [btn, status]));
  return card;
}

function reviewCard(r, reload) {
  const card = el("div.card", { style: "margin-bottom:.8rem" });
  const statusPill = el("span.badge", { text: r.status === "flagged" ? "⚑ flagged ×" + (r.flags || 0) : "pending" });
  const srcPill = el("span.badge", { text: r.source === "upload" ? "⬆ upload" : (r.source || "?") });
  const provHost = el("span");   // filled once the payload loads (see below) — provenance disclosure
  card.appendChild(el("div.sectitle", null, [
    el("h3", { style: "font-size:.98rem", text: r.title || r.subject }),
    el("div.btn-row", null, [statusPill, srcPill, provHost]),
  ]));
  card.appendChild(el("p.tagline", { html:
    "by <b>@" + escapeHtml(r.username || "?") + "</b> · " + escapeHtml(r.subject || "") +
    " · " + escapeHtml(r.licence || "") }));

  const artHost = el("div", { style: "margin:.5rem 0" });
  artHost.appendChild(el("small.tagline", { text: "Loading preview…" }));
  card.appendChild(artHost);

  const actions = el("div.btn-row", { style: "margin-top:.5rem" });
  const approve = el("button.btn.primary.sm", { text: "✓ Approve" });
  const decline = el("button.btn.danger.sm", { text: "✕ Decline" });
  const status = el("small.tagline", { style: "margin-left:.5rem" });
  approve.onclick = () => decide("approve");
  decline.onclick = () => decide("decline");
  actions.appendChild(approve); actions.appendChild(decline); actions.appendChild(status);
  card.appendChild(actions);

  async function decide(decision) {
    approve.disabled = decline.disabled = true;
    status.textContent = decision === "approve" ? "Approving…" : "Declining…";
    const res = await Taiao.review(r.id, decision);
    if (res && res.ok) { toast(decision === "approve" ? "Approved — now voteable." : "Declined.", "ok"); reload && reload(); }
    else { status.textContent = (res && res.error) || "Failed."; approve.disabled = decline.disabled = false; }
  }

  // Fetch the full payload (art rides as data URLs) to preview what we're judging.
  (async () => {
    const p = await Taiao.getCostume(r.id);
    clear(artHost);
    const payload = p && p.payload;
    if (!payload) { artHost.appendChild(el("small.tagline", { text: "No preview available." })); return; }
    // provenanceBadge is defined in detail.js — every studio page shares one
    // global scope (classic <script> tags, no modules).
    const pBadge = typeof provenanceBadge === "function" ? provenanceBadge(payload) : null;
    if (pBadge) provHost.appendChild(pBadge);
    renderPayloadPreview(artHost, payload);
  })();

  return card;
}

// Best-effort preview of any proposal payload: costume/icon art, a sound, or a
// compact JSON summary for data proposals that reached the queue via flagging.
function renderPayloadPreview(host, payload) {
  const dirs = payload.costume && payload.costume.dirs;
  if (dirs && Object.keys(dirs).length) {
    const grid = el("div", { style: "display:flex;gap:.4rem;flex-wrap:wrap" });
    const order = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west", "image"];
    const keys = order.filter(k => dirs[k]).concat(Object.keys(dirs).filter(k => order.indexOf(k) < 0));
    keys.forEach(k => {
      const cv = el("canvas.spr", { width: 96, height: 96, style: "width:64px;height:64px;image-rendering:pixelated;background:#0003;border-radius:6px" });
      try { drawSprite(cv, dirs[k], 96); } catch (_) {}
      grid.appendChild(el("div", { style: "text-align:center" }, [cv, el("div", { style: "font-size:.65rem;color:var(--ink-dim)", text: k })]));
    });
    host.appendChild(grid);
    return;
  }
  if (payload.sound && payload.sound.src) {
    const au = el("audio", { controls: "controls", src: payload.sound.src, style: "max-width:100%" });
    host.appendChild(au);
    return;
  }
  // data / quest proposals: show a trimmed JSON summary
  let text;
  try { text = JSON.stringify(payload, (k, v) => (typeof v === "string" && v.length > 200 ? v.slice(0, 200) + "…" : v), 2); }
  catch (_) { text = "(unpreviewable payload)"; }
  host.appendChild(el("pre", { style: "max-height:220px;overflow:auto;background:var(--bg-2);padding:.6rem;border-radius:6px;font-size:.75rem", text: text }));
}
