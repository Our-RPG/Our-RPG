// ===== Taiao Workshop — Home: the atelier =====
// The front door of the room where the world is being made. This page has one
// job: make whoever walks in feel like they just found the dev team's own
// workbench with their name already on a badge. The order of the room:
//   the SKY (hero: the game's night over the wordmark, real sprites on the
//   horizon) → the PULSE (a live ticker of what the crew just shipped) →
//   YOUR BADGE (crew card with a real builder number) → the CENSUS (how much
//   world there already is — and the +1 that is you) → THE BOARD (open
//   proposals) → SHIPPED (the ledger, credited forever) → THE GAPS (holes in
//   the world that ship instantly when filled) → THE BENCHES (every door in)
//   → THE CHARTER (the promise that nobody can ever take this from you).
// Deliberately no heavy payload fetches — detail pages do the lifting.
"use strict";

function pageHome(root) {
  function render() {
    clear(root);
    const page = el("div.page");
    page.appendChild(heroBlock());
    page.appendChild(pulseTicker());
    page.appendChild(crewBlock());
    page.appendChild(censusBlock());
    page.appendChild(boardBlock());
    page.appendChild(shippedBlock());
    page.appendChild(gapsBlock());
    page.appendChild(benchesBlock());
    page.appendChild(charterBlock());
    root.appendChild(page);
    if (typeof FX !== "undefined") FX.reveal(root);
  }
  render();
  Taiao.onAuth(render);   // badge + curator door resolve after boot
}

// ---------- helpers ----------
function homeSectH(no, title, aside) {
  return el("div.sect-h.fxr", null, [
    el("span.no", { text: no }),
    el("span.t", { text: title }),
    el("span.rule"),
    aside ? el("span.aside", { text: aside }) : null,
  ].filter(Boolean));
}
function relTime(ts) {
  const d = Date.now() - Number(ts || 0);
  if (!ts || d < 0) return "";
  const m = Math.floor(d / 60000);
  if (m < 60) return (m || 1) + "m ago";
  const h = Math.floor(m / 60);
  if (h < 48) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}

// Where a proposal's subject goes when clicked (mirrors Nav's real routes —
// kinds with no single detail page land on their tab hub instead).
function subjectHref(p) {
  const s = p._subj || {}, folder = s.folder;
  switch (s.kind) {
    case "character": case "object": case "monster":
      return "#/detail?type=" + s.kind + "&key=" + encodeURIComponent(folder);
    case "ui": return "#/detail?type=ui&key=" + encodeURIComponent(folder);
    case "tile": return "#/tiles";
    case "sound": return "#/sounds";
    case "quest": return "#/quests";
    case "mechanic": return "#/ideas";
    case "skill": return "#/skill?key=" + encodeURIComponent(folder);
    case "zone": return "#/zones";
    case "mapgen": return "#/map";
    default: return "#/sprites";
  }
}

// ---------- the sky ----------
function heroBlock() {
  const skyCv = el("canvas.hero-sky");
  const frieze = el("div.frieze");
  const hero = el("section.hero", null, [
    skyCv,
    el("div.in", null, [
      el("div.over", { html: "you found it &nbsp;·&nbsp; <span class='k'>nau mai, kaihanga</span> — welcome, builder" }),
      el("h1.hero-word", { html: "This world is<br><span class='aur'>not finished.</span>" }),
      el("p.hero-manifesto", { html:
        "Taiao is a living RPG being built in the open — and this is the room it's built in. " +
        "Every sprite, sound, quest and mechanic in the game came through these benches. " +
        "<em>The next one is yours.</em>" }),
      el("div.hero-sub", { text: "real tools · real credit · shipped to every player" }),
      el("div.hero-cta", null, [
        Taiao.logged()
          ? el("a.btn.primary", { href: "#/needs-art", text: "▸ Pick up a commission" })
          : el("a.btn.primary", { href: "#/settings", text: "▸ Claim your builder number" }),
        el("a.btn.ghost", { href: "#/sprites", text: "Step into the workshop" }),
      ]),
    ]),
    frieze,
  ]);
  // paint the sky + stand the game's own creatures along the horizon
  setTimeout(() => {
    if (typeof FX !== "undefined") { FX.sky(skyCv); FX.frieze(frieze, 48); }
  }, 0);
  return hero;
}

// ---------- the pulse ----------
function pulseTicker() {
  const wrap = el("div.tickerwrap");
  const strip = el("div.ticker");
  wrap.appendChild(strip);
  (async () => {
    const items = [];
    try {
      const acc = await Taiao.listProposalsRaw("accepted");
      if (acc && acc.ok) for (const p of acc.proposals.slice(0, 8))
        items.push({ s: "SHIPPED", b: p.title || p.subject, u: p.username, t: relTime(p.created_at) });
      const open = await Taiao.listProposalsRaw();
      if (open && open.ok) for (const p of open.proposals.slice(0, 8))
        items.push({ s: "IN THE RING", b: p.title || p.subject, u: p.username, t: (p.endorsements || 0) + "▲" });
    } catch (_) {}
    if (!items.length) {
      items.push({ s: "OPEN BUILD", b: "the benches are live — first proposals land here", u: "", t: "" });
      items.push({ s: "STATUS", b: "every tool on this site changes the real game", u: "", t: "" });
    }
    const renderItems = () => items.map(i => el("span.tickitem", null, [
      el("span.s", { text: "● " + i.s }),
      el("b", { text: i.b }),
      i.u ? el("span", { text: " — " }) : null,
      i.u ? el("span.u", { text: "@" + i.u }) : null,
      i.t ? el("span", { text: "  ·  " + i.t }) : null,
    ].filter(Boolean)));
    // twice over for a seamless -50% loop
    renderItems().forEach(n => strip.appendChild(n));
    renderItems().forEach(n => strip.appendChild(n));
  })();
  return wrap;
}

// ---------- your badge ----------
function crewBlock() {
  const box = el("div", { style: "margin-top:1.6rem" });
  if (!Taiao.logged()) {
    box.appendChild(el("div.crew-card.fxr", null, [
      el("div.cc-top", null, [
        el("span", { text: "Taiao · worldbuilding crew" }),
        el("span", { text: "badge unclaimed" }),
      ]),
      el("h2.cc-name", { text: "This badge is blank." }),
      el("div.cc-role", { text: "one account · the game and the workshop · free forever" }),
      el("div.cc-stats", null, [
        el("div.cc-stat", null, [el("b", { text: "—" }), el("span", { text: "crew number" })]),
        el("div.cc-stat", null, [el("b", { text: "0" }), el("span", { text: "shipped works" })]),
        el("div", { style: "flex:1" }),
        el("div", { style: "align-self:center" }, [el("a.btn.primary", { href: "#/settings", text: "▸ Claim it" })]),
      ]),
    ]));
    return box;
  }
  const u = Taiao.user || {};
  const no = u.id != null ? String(u.id).padStart(4, "0") : "————";
  const statShipped = el("b", { text: "…" });
  const statOpen = el("b", { text: "…" });
  const statVotes = el("b", { text: "0" });
  try { statVotes.textContent = String(Object.keys(JSON.parse(localStorage.getItem("studio_myvotes_v1") || "{}")).length); } catch (_) {}
  box.appendChild(el("div.crew-card.fxr", null, [
    el("div.cc-top", null, [
      el("span", { text: "Taiao · worldbuilding crew" }),
      el("span", { text: u.curator ? "curator clearance" : "full bench access" }),
    ]),
    el("div", { style: "display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;flex-wrap:wrap" }, [
      el("div", null, [
        el("h2.cc-name", { text: "@" + Taiao.username() }),
        el("div.cc-role", { text: "worldbuilder — taiao dev crew" }),
      ]),
      el("div.cc-no", null, [el("small", { text: "crew nº" }), document.createTextNode(no)]),
    ]),
    el("div.cc-stats", null, [
      el("div.cc-stat", null, [statShipped, el("span", { text: "in the game" })]),
      el("div.cc-stat", null, [statOpen, el("span", { text: "in the ring" })]),
      el("div.cc-stat", null, [statVotes, el("span", { text: "votes cast" })]),
      el("div", { style: "flex:1" }),
      el("div", { style: "align-self:center" }, [el("a", { href: "#/profile", text: "full record →" })]),
    ]),
  ]));
  (async () => {
    const r = await Taiao.listMineRaw();
    if (!r || r.error || !Array.isArray(r.proposals)) { statShipped.textContent = "?"; statOpen.textContent = "?"; return; }
    statShipped.textContent = String(r.proposals.filter(p => p.status === "accepted").length);
    statOpen.textContent = String(r.proposals.filter(p => p.status === "open").length);
  })();
  return box;
}

// ---------- the census ----------
function censusBlock() {
  const counts = [];
  const add = (n, label) => { if (n > 0) counts.push([n, label]); };
  try { if (typeof CHAR_LIST !== "undefined") add(CHAR_LIST.length, "characters"); } catch (_) {}
  try { if (typeof MONSTERS !== "undefined") add(Object.keys(MONSTERS).length, "creatures"); } catch (_) {}
  try { if (typeof ITEMS !== "undefined") add(Object.keys(ITEMS).length, "items"); } catch (_) {}
  try { if (typeof SKILLS !== "undefined") add(Object.keys(SKILLS).length, "skills"); } catch (_) {}
  try { if (typeof BIOME_GROUND_VARIANTS !== "undefined") add(Object.keys(BIOME_GROUND_VARIANTS).length, "biomes"); } catch (_) {}
  const box = el("div");
  box.appendChild(homeSectH("00 /", "The world so far", "all of it editable"));
  const grid = el("div.census.card.fxr");
  counts.slice(0, 5).forEach(([n, label]) => {
    const num = el("div.n", { text: "0" });
    grid.appendChild(el("div", null, [num, el("div.l", { text: label })]));
    setTimeout(() => { if (typeof FX !== "undefined") FX.count(num, n); else num.textContent = String(n); }, 60);
  });
  grid.appendChild(el("div", null, [
    el("div.n", null, [el("span.plus", { text: "+1" })]),
    el("div.l", { text: "you" }),
  ]));
  box.appendChild(grid);
  return box;
}

// ---------- the board (open proposals) ----------
function boardBlock() {
  const box = el("div");
  box.appendChild(homeSectH("01 /", "The board", "open for votes now"));
  const card = el("div.card.fxr");
  const body = el("div.ledger", null, [el("div.tagline", { text: "Reading the board…" })]);
  card.appendChild(body);
  box.appendChild(card);
  (async () => {
    const r = await Taiao.listProposalsRaw();
    clear(body);
    if (!r || r.error || !Array.isArray(r.proposals)) {
      body.appendChild(el("div.banner.warn", { text: "Couldn't reach the Taiao server — the board will be back." }));
      return;
    }
    const rows = r.proposals.slice(0, 10);
    if (!rows.length) {
      body.appendChild(el("div.empty", { html: "<div class='big'>🗳</div>The board is clear. Pin the first proposal on it." }));
      return;
    }
    rows.forEach(p => body.appendChild(el("div.lrow", null, [
      el("span.when", { text: (p.endorsements || 0) + " ▲" }),
      el("span.what", null, [el("a", { text: p.title || "(untitled)", href: subjectHref(p) })]),
      el("span.by", { text: "@" + (p.username || "someone") }),
    ])));
  })();
  return box;
}

// ---------- shipped (the credited ledger) ----------
function shippedBlock() {
  const box = el("div");
  box.appendChild(homeSectH("02 /", "Shipped", "credited forever"));
  const card = el("div.card.fxr");
  const body = el("div.ledger", null, [el("div.tagline", { text: "Opening the ledger…" })]);
  card.appendChild(body);
  box.appendChild(card);
  (async () => {
    const r = await Taiao.listProposalsRaw("accepted");
    clear(body);
    if (!r || r.error || !Array.isArray(r.proposals)) {
      body.appendChild(el("div.banner.warn", { text: "Couldn't reach the Taiao server — the ledger will be back." }));
      return;
    }
    const rows = r.proposals.slice(0, 10);
    if (!rows.length) {
      body.appendChild(el("div.empty", { html: "<div class='big'>⚡</div>Nothing has crossed into the game yet.<br>The first name written in this ledger could be yours." }));
      return;
    }
    rows.forEach(p => body.appendChild(el("div.lrow", null, [
      el("span.when", { text: relTime(p.created_at) }),
      el("span.what", null, [
        el("span.stamp.live", { text: "in the game" }),
        document.createTextNode("  "),
        el("a", { text: p.title || "(untitled)", href: subjectHref(p) }),
      ]),
      el("span.by", { text: "@" + (p.username || "someone") }),
    ])));
  })();
  return box;
}

// ---------- the gaps ----------
function gapsBlock() {
  const gaps = (typeof WORKSHOP_GAPS !== "undefined" && WORKSHOP_GAPS.gaps) || [];
  const box = el("div");
  box.appendChild(homeSectH("03 /", "The gaps", gaps.length ? gaps.length + " holes in the world" : "surveyed"));
  const card = el("div.card.fxr");
  if (!gaps.length) {
    card.appendChild(el("p.tagline", { style: "margin:0", text: "Every surveyed gap is currently filled. New ones appear as the world grows — check back, or open a bench below." }));
  } else {
    card.appendChild(el("p", { style: "margin:0 0 .6rem", html:
      "<b>" + gaps.length + " assets</b> ship with placeholder or missing art. Fill one with a PixelLab generation and it goes " +
      "<b>straight into every player's game</b> — no vote, no queue, your name on it." }));
    const chips = el("div.chips");
    gaps.slice(0, 6).forEach(g => chips.appendChild(el("span.chip", { text: g.name || g.key })));
    card.appendChild(chips);
    card.appendChild(el("div.btn-row", { style: "margin-top:.8rem" }, [
      el("a.btn.primary", { href: "#/needs-art", text: "▸ Fill a gap" }),
    ]));
  }
  box.appendChild(card);
  return box;
}

// ---------- the benches ----------
function benchesBlock() {
  const box = el("div");
  box.appendChild(homeSectH("04 /", "The benches", "pick up a tool"));
  const grid = el("div.benches");
  const bench = (no, title, desc, href) => el("a.bench.fxr", { href }, [
    el("span.b-no", { text: no }),
    el("span.b-go", { text: "→" }),
    el("div.b-t", { text: title }),
    el("div.b-d", { text: desc }),
  ]);
  grid.appendChild(bench("BENCH A", "Sprite & art", "Generate 8-direction art with PixelLab, or carve wearable parts out of costumes. Trusted generations ship instantly.", "#/sprites"));
  grid.appendChild(bench("BENCH B", "Sound", "Give a silent moment its voice — every clip is wired to a real in-game trigger.", "#/sounds"));
  grid.appendChild(bench("BENCH C", "Quests", "Write multi-act quests for real NPCs in real shires, in the game's own Lua.", "#/quests"));
  grid.appendChild(bench("BENCH D", "Skills & recipes", "Tune the economy: recipes, milestones, gathering nodes, whole new crafts.", "#/skills"));
  grid.appendChild(bench("BENCH E", "Ideas", "Pitch a mechanic. Develop it with an AI copilot grounded in the actual codebase.", "#/ideas"));
  grid.appendChild(bench("BENCH F", "The world itself", "Vote on world generation down to individual biome thresholds — and roam the zone charts.", "#/map"));
  if (Taiao.curator && Taiao.curator()) {
    grid.appendChild(bench("THE DESK", "Curator review", "The moderation desk: approve uploads, adopt winners into everyone's game.", "#/review"));
  }
  box.appendChild(grid);
  return box;
}

// ---------- the charter ----------
function charterBlock() {
  return el("div.charter.fxr", null, [
    el("p.fig", { html:
      "This game is licensed so that <em>no one — including its maintainer — can ever close it or take it from you.</em> " +
      "What you build here is yours, credited forever, in a world the crew owns together." }),
    el("div.lic", { html: "GPL-3.0 &nbsp;+&nbsp; CC BY-SA 4.0 &nbsp;·&nbsp; fork it, forever &nbsp;·&nbsp; <a href='https://github.com/dataversion5372/Taiao' rel='noopener'>source</a>" }),
  ]);
}
