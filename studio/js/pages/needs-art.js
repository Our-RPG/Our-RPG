// ===== Our RPG Workshop — "Needs art" hub =====
// The instant-ship lane, front and centre. studio/tools/gen_gaps.mjs audits
// the live game data for items with no icon and monsters stuck on one
// billboard sprite, and writes the result to WORKSHOP_GAPS (gaps-data.js,
// regenerated alongside every page rebuild). Any PixelLab-generated art ships
// straight into the game with NO vote and NO curator queue — server/src/
// workshop.js submitProposal routes an asset the client marks source:"pixellab"
// to 'accepted' at once (the maintainer trusts PixelLab's pre-filtered output).
// Hand-UPLOADED art still goes through the curator queue; pure data proposals
// still go through the ballot box.
//
// Two sections:
//   1. the flat WORKSHOP_GAPS manifest — gen_gaps.mjs, deliberately CURATED
//      down to the true placeholder-art cases (the single-sprite monsters:
//      Slime, Cave Troll, Bandit). The old "unpainted directions" audit
//      (DupeScan, studio/js/dupe-scan.js) is no longer surfaced here — it
//      flooded the hub with 200+ world objects; anything beyond the manifest
//      is now for PLAYERS to flag via 🏷 request art (section 2). dupe-scan.js
//      stays loaded for gen_gaps.mjs --scan (an opt-in audit tool).
//   2. "Requested by the crew" — player-tagged wishlist proposals (taiao-
//      needsart/1 data proposals, see detail.js openRequestArtDialog),
//      endorsable like any other proposal.
"use strict";

function pageNeedsArt(root) {
  clear(root);
  const page = el("div.page");
  page.appendChild(el("h2", { text: "Needs art" }));
  page.appendChild(el("div.card", null, [
    el("p.tagline", { html:
      "These assets ship with placeholder or missing art. Generate a replacement with PixelLab and it goes " +
      "<b>STRAIGHT into everyone's game</b> — no vote, no queue. You'll be credited forever." }),
  ]));
  root.appendChild(page);

  // Cross-check helper: a gap already filled by an accepted proposal (someone
  // beat you to it, or the manifest is a little stale) shows who instead of a
  // CTA. Shared by every section's table so the same convention applies to
  // the static manifest, the dupe-scan results, and (implicitly) anything
  // else that renders a {g, cell} row.
  async function applyCrossCheck(rows) {
    if (!rows.length) return;
    let filled = new Map();
    try {
      const r = await Taiao.listProposalsRaw("accepted");
      if (r && r.ok && Array.isArray(r.proposals))
        for (const p of r.proposals) if (!filled.has(p.subject)) filled.set(p.subject, p.username);
    } catch (_) { return; }   // offline — CTAs just stay up, worst case someone double-generates
    for (const row of rows) {
      const who = filled.get(row.g.subject);
      if (!who) continue;
      clear(row.cell);
      row.cell.appendChild(el("span.badge", { text: "✓ filled by @" + who }));
    }
  }

  const KIND_LABEL = { ui: "item icon", monster: "monster", object: "world object", character: "character/NPC" };
  function gapsTable(gaps) {
    const table = el("table.tf");
    table.appendChild(el("thead", null, [el("tr", null, [
      el("th", { text: "Name" }), el("th", { text: "Kind" }), el("th", { text: "Reason" }), el("th", { text: "" }),
    ])]));
    const tb = el("tbody");
    table.appendChild(tb);
    const rows = gaps.map(g => {
      const cell = el("td", null, [
        el("a.btn.sm.primary", { text: "Create →", href: "#/sprite?type=" + g.type + "&key=" + encodeURIComponent(g.key) }),
      ]);
      tb.appendChild(el("tr", null, [
        el("td", { text: g.name }),
        el("td", { text: KIND_LABEL[g.type] || g.type }),
        el("td", { text: g.reason }),
        cell,
      ]));
      return { g, cell };
    });
    return { table, rows };
  }

  // ---- section 1: the flat manifest (gen_gaps.mjs) ----
  const gaps = (typeof WORKSHOP_GAPS !== "undefined" && Array.isArray(WORKSHOP_GAPS.gaps)) ? WORKSHOP_GAPS.gaps : [];
  if (!gaps.length) {
    page.appendChild(el("div.empty", { html: "<div class='big'>🎨</div>No known gaps right now — the library is fully illustrated." }));
  } else {
    let when = "?";
    try { when = new Date(WORKSHOP_GAPS.generated).toLocaleString(); } catch (_) {}
    page.appendChild(el("p.tagline", { text: gaps.length + " open gap" + (gaps.length === 1 ? "" : "s") + " · manifest generated " + when }));
    const { table, rows } = gapsTable(gaps);
    page.appendChild(table);
    applyCrossCheck(rows);
  }

  // ---- section 2: "Requested by the crew" (player-tagged wishlist) ----
  const reqCard = el("div.card", { style: "margin-top:1.2rem" });
  reqCard.appendChild(el("div.sectitle", null, [el("h3", { text: "Requested by the crew" }), el("span.badge", { id: "reqart-count", text: "…" })]));
  reqCard.appendChild(el("p.tagline", { text:
    "States and animations players have flagged as wanted — tap 🏷 request art on any sprite page to add one. " +
    "Endorse the ones you'd love to see made." }));
  const reqBody = el("div", { text: "Loading…" });
  reqCard.appendChild(reqBody);
  page.appendChild(reqCard);

  async function loadRequests() {
    let r;
    try { r = await Taiao.listProposalsRaw(); } catch (_) { r = null; }   // default status "open"
    if (!r || !r.ok || !Array.isArray(r.proposals)) { clear(reqBody); reqBody.appendChild(el("div.empty", { text: "Couldn't load requests." })); return; }
    // The "— wants " title convention is set in detail.js's openRequestArtDialog
    // (3a) — a cheap client-side filter over the open-proposal feed we already
    // have. The payload (schema taiao-needsart/1) stays the source of truth for
    // curators; this is just how the hub finds the rows worth showing.
    const rows = r.proposals.filter(p => typeof p.title === "string" && p.title.includes("— wants "));
    const countBadge = document.getElementById("reqart-count");
    if (countBadge) countBadge.textContent = rows.length + " open";
    clear(reqBody);
    if (!rows.length) { reqBody.appendChild(el("div.empty", { text: "Nothing requested yet — be the first to flag something." })); return; }
    const table = el("table.tf");
    table.appendChild(el("thead", null, [el("tr", null, [
      el("th", { text: "Request" }), el("th", { text: "By" }), el("th", { text: "Votes" }), el("th", { text: "" }),
    ])]));
    const tb = el("tbody");
    table.appendChild(tb);
    for (const p of rows) {
      const voteBtn = el("button.btn.gold.sm", { text: "▲ Endorse", onclick: async () => {
        if (!Taiao.logged()) { toast("Sign in to endorse.", "warn"); return; }
        voteBtn.disabled = true;
        const rr = await Taiao.endorseCostume(p.id);
        if (rr && rr.ok) { toast("Endorsed!", "ok"); loadRequests(); }
        else { toast((rr && rr.error) || "Couldn't endorse.", "err"); voteBtn.disabled = false; }
      } });
      tb.appendChild(el("tr", null, [
        el("td", { text: p.title }),
        el("td", null, [el("span.u", { text: "@" + (p.username || "someone") })]),
        el("td", { text: String(p.endorsements || 0) }),
        el("td", null, [voteBtn]),
      ]));
    }
    reqBody.appendChild(table);
  }
  loadRequests();
}
