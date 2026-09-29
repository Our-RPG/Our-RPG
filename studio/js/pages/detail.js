// ===== Our RPG Workshop — asset detail page (all types) =====
// The communal page for one asset. Shows the game's own art, the raw in-game
// data, type-specific votes, and every generation the community has shared —
// with voting. Characters get the full treatment: original prompt, all 8
// directions for every state, in-game stats + votes, player/NPC vote,
// animations and triggers.
"use strict";

const TAB_HASH = { character: "#/npcs", object: "#/objects", monster: "#/monsters", tile: "#/tiles", ui: "#/ui", map: "#/map", sound: "#/sounds" };
// numeric stat votes use percentage deltas around the current value
const STAT_DELTAS = ["-25%", "-10%", "current", "+10%", "+25%"];

// The gameplay/instance page. Art (sprite & animation trees) lives on the
// sprite page (#/sprite); this page carries the instantiated version's gameplay
// panels — stats/details, drops, spawns, votes, triggers/events and actions.
const SPLIT_TYPES = { character: 1, monster: 1, object: 1 };
async function pageDetail(root, params) {
  clear(root);
  const type = params.get("type") || "character";
  const key = params.get("key") || params.get("folder");
  const provider = Providers.get(type);
  const page = el("div.page");
  if (!provider || !key) { root.appendChild(el("div.empty", { html: "<div class='big'>🤷</div>No asset. <a href='#/players'>Back</a>." })); return; }
  const entry = provider.entry(key) || { type, key, name: Roster.prettyName(key) };
  const inGame = !!provider.entry(key);
  const split = !!SPLIT_TYPES[type] && inGame;

  // header: common name + unique snake_case id
  const snakeId = entry.snake || entry.key;
  const commonName = entry.common || entry.name;
  const head = el("div.card");
  head.appendChild(el("div.sectitle", null, [
    el("div", null, [el("h2", { text: commonName }), el("div.mono", { style: "color:var(--ink-dim);margin-top:-.2rem", text: snakeId })]),
    el("div.btn-row", null, [el("span.badge", { text: type }), inGame ? el("span.badge", { text: "in game" }) : el("span.badge", { text: "community" })]),
  ]));
  const backHash = type === "character" ? (entry.npc ? "#/npcs" : "#/players") : (TAB_HASH[type] || "#/players");
  const backLabel = type === "character" ? (entry.npc ? "NPCs" : "Players") : provider.plural;
  const hb = [el("a.btn.ghost.sm", { text: "← " + backLabel, href: backHash })];
  // art generation lives on the sprite page for split types
  if (provider.supportsGen && !split) hb.push(el("button.btn.primary.sm", { text: "🎨 Make your own version", onclick: () => startDraftFor(type, key, entry.name) }));
  head.appendChild(el("div.btn-row", null, hb));
  page.appendChild(head);

  if (split) {
    if (type === "character") renderCharacterInstance(page, provider, entry);
    else if (type === "monster") renderMonsterInstance(page, provider, entry);
    else renderObjectInstance(page, provider, entry);
    root.appendChild(page);
    return;   // split types show no code dump and no gallery here (gallery is on the sprite page)
  }

  if (type === "ui") renderItemDetail(page, provider, entry);
  else renderGenericPreview(page, provider, entry);

  // raw in-game data — "all in-game code data viewable" (items surface their
  // fields as vote rows instead, so they skip this dump)
  const data = type === "ui" ? null : provider.data(entry);
  if (data != null) {
    const dc = el("div.card");
    dc.appendChild(el("h3", null, ["In-game data ", el("span.hint", { text: "the asset's code data" })]));
    dc.appendChild(el("pre.mono", { style: "overflow:auto;max-height:420px;white-space:pre;background:var(--bg-2);padding:.8rem;border-radius:8px", text: safeJson(data) }));
    page.appendChild(dc);
  }

  // community versions + voting (generatable types)
  const gallery = el("div"); page.appendChild(gallery);
  root.appendChild(page);
  if (provider.supportsGen) await renderGallery(gallery, type, key, entry.name);
}

// canonical representative monster key for a shared sprite (mirrors the Sprites
// table dedup) so every monster on a shared sprite links to the same page.
function monsterSpriteRep(provider, key) {
  const sig = k => (provider && provider.layerKeys ? (provider.layerKeys(k, 0) || []) : []).filter(Boolean).join("+");
  const mySig = sig(key);
  if (!mySig || typeof MONSTERS === "undefined") return key;
  let rep = key;
  const isBase = x => !/(_v|_baby)$/.test(x);
  for (const k of Object.keys(MONSTERS)) {
    if (sig(k) !== mySig) continue;
    if ((isBase(k) && !isBase(rep)) || (isBase(k) === isBase(rep) && k.length < rep.length)) rep = k;
  }
  return rep;
}
// a gold "Sprite source" link for an instance's details panel → the sprite page
function spriteSourceLink(type, entry, provider) {
  const key = (type === "monster") ? monsterSpriteRep(provider, entry.key) : entry.key;
  const label = (typeof spriteIdFor === "function") ? spriteIdFor(type, key) : key;
  return el("a", { href: "#/sprite?type=" + type + "&key=" + encodeURIComponent(key), style: "color:var(--gold);text-decoration:none;font-family:monospace", text: label });
}

// The sprite (art) page — reached from the Sprites tab. State/animation trees +
// community versions. Gameplay lives on the instance page (#/detail).
async function pageSpriteDetail(root, params) {
  clear(root);
  const type = params.get("type") || "character";
  const key = params.get("key");
  const provider = Providers.get(type);
  if (!provider || !key) { root.appendChild(el("div.empty", { html: "<div class='big'>🤷</div>No sprite. <a href='#/sprites'>Back</a>." })); return; }
  const entry = provider.entry(key) || { type, key, name: Roster.prettyName(key) };
  const page = el("div.page");
  const CATLABEL = { character: "Character", object: "Object", monster: "Monster", ui: "Item", tile: "Biome", map: "Map icon" };
  // sprites are identified by id, not name (matches the Sprites table); monsters
  // use their shared layer-key sprite id; items use the item they're assigned to
  // (their icon group's representative id, via uiSpriteId — same as the Sprites
  // tab & Items table); map icons show the POI type they mark.
  let spriteId = entry.snake || entry.key;
  if (type === "ui" && entry.iconKey) spriteId = (typeof uiSpriteId === "function") ? uiSpriteId(entry.iconKey) : entry.iconKey;
  if (type === "map" && entry.poi) spriteId = entry.poi;
  if (type === "monster" && provider.layerKeys) {
    const keys0 = (provider.layerKeys(entry.key, 0) || []).filter(Boolean);
    const sid = (provider.isDir && provider.isDir(entry)) ? String(keys0[0] || "").replace(/_south$/, "") : keys0.join("+");
    if (sid) spriteId = sid;
  }

  const head = el("div.card");
  head.appendChild(el("div.sectitle", null, [
    el("div", null, [el("h2.mono", { style: "word-break:break-all", text: spriteId })]),
    el("div.btn-row", null, [el("span.badge", { text: "sprite" }), el("span.badge", { text: CATLABEL[type] || type })]),
  ]));
  head.appendChild(el("div.btn-row", null, [el("a.btn.ghost.sm", { text: "← Sprites", href: "#/sprites" })]));
  page.appendChild(head);

  // child sprites (dotted ids like "aeliana.ankhotep") link back to their parent
  if (spriteId.indexOf(".") >= 0) {
    const parent = spriteId.split(".")[0];
    const pc = el("div.card");
    pc.appendChild(el("div", { style: "display:flex;align-items:center;gap:.5rem" }, [
      el("span.tagline", { text: "Parent sprite:" }),
      el("a", { href: "#/sprite?type=" + type + "&key=" + encodeURIComponent(parent), style: "color:var(--gold);text-decoration:none;font-family:monospace", text: parent }),
    ]));
    page.appendChild(pc);
  }

  if (type === "character") renderCharacterArt(page, provider, entry);
  else if (type === "monster") renderMonsterArt(page, provider, entry);
  else if (type === "object") renderObjectArt(page, provider, entry);
  else if (type === "tile") renderTileArt(page, provider, entry);
  else if (type === "ui" || type === "map") renderIconArt(page, provider, entry);
  else renderGenericPreview(page, provider, entry);
  // supportsGen types (character/object/monster) merge their shared versions into
  // their own Sprites card — handled inside the art renderers, not here.
  root.appendChild(page);
}
// append the shared-versions gallery inside a sprite page's "Sprites" card so
// community uploads sit in the same list as the in-game sprite (no separate card).
function mergeSharedVersions(card, type, folder, title) {
  if (!card) return;
  const gallery = el("div"); card.appendChild(gallery);
  try { renderGallery(gallery, type, folder, title); } catch (_) {}
}

function safeJson(o) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(o, (k, v) => {
      if (typeof v === "object" && v !== null) { if (seen.has(v)) return "[circular]"; seen.add(v); }
      if (typeof v === "function") return "ƒ";
      return v;
    }, 2);
  } catch (_) { return String(o); }
}

// ---------------- state deck + tree ----------------
// Horizontal tree: the root deck on the LEFT, states branching to the RIGHT
// (one accent "→ generates" arrow per branch). Animations branch DOWN from a
// state (gold "↓ animates" arrows). Every node carries a dashed "Create New
// State" slot and (non-root) an always-visible yes/no "valid branch?" vote.
// Every asset keeps all 8 directions (the extra frames are useful for shadows,
// even on objects that don't turn).
// frame indices a deck fans out, by asset type: biome tiles = 4 variants,
// single-frame icons (items / map icons) = 1, everything else = 8 directions.
const dirIdxsFor = type => type === "tile" ? [0, 1, 2, 3] : (type === "ui" || type === "map") ? [0] : [0, 1, 2, 3, 4, 5, 6, 7];
// a deck frame's label: tiles show v1..v4, single-frame icons show nothing,
// directional sprites show the compass short label.
const frameLabelFor = type => type === "tile" ? (i => "v" + (i + 1)) : (type === "ui" || type === "map") ? (() => "") : (i => DIR_SHORT[DIRS8[i]]);

function stateDeck(node, dirIdxs, frameLabel) {
  dirIdxs = node.dirIdxs || dirIdxs || [0, 1, 2, 3, 4, 5, 6, 7];
  const lbl = i => (frameLabel ? frameLabel(i) : DIR_SHORT[DIRS8[i]]) || "";
  const single = dirIdxs.length === 1;
  const wrap = el("div.deck-wrap");
  function drawInto(cv, di) { try { node.draw(cv, di); } catch (_) {} }
  function deckLabel() {
    const txt = node.path || node.name;
    if (node.goTo) return el("a.deck-label.mono", { href: node.goTo, title: node.name, text: txt });
    return el("div.deck-label.mono", { title: node.name || "", text: txt });
  }
  function collapsed() {
    clear(wrap);
    const deck = el("div.deck", { title: single ? node.name || "" : "Click to expand all " + dirIdxs.length + " frames", onclick: single ? null : expanded });
    for (let p = dirIdxs.length - 1; p >= 0; p--) {   // p = display position (0 = top card)
      const idx = dirIdxs[p];
      const cv = el("canvas.deck-card", { width: 144, height: 144 });
      cv.style.zIndex = String(10 + (dirIdxs.length - p));
      cv.style.transform = "translate(" + (p * 3) + "px," + (p * 11) + "px)";
      cv.style.opacity = p === 0 ? "1" : (1 - p * 0.045).toFixed(2);
      drawInto(cv, idx);
      deck.appendChild(cv);
    }
    wrap.appendChild(deck);
    wrap.appendChild(deckLabel());
  }
  function expanded() {
    clear(wrap);
    const box = el("div.deck-expanded.deck-open");
    box.appendChild(deckLabel());
    const grid = el("div.dirgrid", { style: "width:100%" });
    dirIdxs.forEach(idx => { const cv = el("canvas.spr"); drawInto(cv, idx); grid.appendChild(el("div.dircell", null, [cv, el("div.lbl", { text: lbl(idx) })])); });
    box.appendChild(grid);
    box.appendChild(el("button.btn.sm.ghost", { text: "▲ collapse", onclick: collapsed }));
    wrap.appendChild(box);
    if (node._extra) wrap.appendChild(node._extra);
  }
  collapsed();
  return wrap;
}

// a small looping animation node (rendered on a vertical, gold branch)
// ---------------- animations: a state × animation matrix ----------------
// User-extendable snake_case animation columns, stored per asset type.
const AnimCols = {
  _read() { try { return JSON.parse(localStorage.getItem("studio_anim_cols_v1") || "{}"); } catch (_) { return {}; } },
  get(type) { const base = (typeof GameTriggers !== "undefined") ? GameTriggers.animColumns(type) : ["idle", "walk", "attack"]; return [...new Set(base.concat(this._read()[type] || []))]; },
  add(type, name) { name = slug(name); if (!name) return false; const s = this._read(); s[type] = [...new Set((s[type] || []).concat(name))]; try { localStorage.setItem("studio_anim_cols_v1", JSON.stringify(s)); } catch (_) {} return true; },
};

// frames for one direction of an animation (per-direction dirs map, or a flat
// frames array treated as the south-facing pose).
function animFramesForDir(anim, dir) {
  if (!anim) return [];
  if (anim.dirs && anim.dirs[dir]) return anim.dirs[dir];
  return dir === "south" ? (anim.frames || []) : [];
}

// One animation as a deck — same fanned-card look as a state deck, but each
// card loops its direction's WebP frames. Expands to a frames × directions
// matrix. `cell.anim` may be null (an empty cell → offer to generate one).
function animDeck(cell, ctx) {
  const wrap = el("div.deck-wrap");
  const anim = cell.anim;
  const has = anim && (anim.frames && anim.frames.length || anim.dirs);
  function loop(cv, frames) { if (!frames || !frames.length) return; let f = 0; drawSprite(cv, frames[0], cv.width); cv._t = setInterval(() => { drawSprite(cv, frames[f % frames.length], cv.width); f++; }, 140); }
  function collapsed() {
    clear(wrap);
    const deck = el("div.deck" + (has ? "" : ".create-slot"), { title: has ? "Click to expand frames × directions" : "Generate this animation", onclick: has ? expanded : create });
    for (let i = DIRS8.length - 1; i >= 0; i--) {
      const frames = animFramesForDir(anim, DIRS8[i]);
      const card = el("canvas.deck-card" + (has && frames.length ? "" : ".blank"), { width: 144, height: 144 });
      card.style.zIndex = String(10 + (DIRS8.length - i));
      card.style.transform = "translate(" + (i * 3) + "px," + (i * 11) + "px)";
      if (frames.length) loop(card, frames);
      deck.appendChild(card);
    }
    if (!has) deck.appendChild(el("div.create-plus", { text: "＋" }));
    wrap.appendChild(deck);
    wrap.appendChild(el("div.deck-label.mono", { text: "anim:" + slug(cell.action) }));
    if (anim && anim.by) wrap.appendChild(el("div.credit", null, ["by ", el("span.u", { text: anim.by })]));
  }
  function expanded() {
    clear(wrap);
    const box = el("div.deck-expanded.deck-open");
    box.appendChild(el("div.deck-label.mono", { text: "anim:" + slug(cell.action) + " — frames × directions" }));
    const nF = Math.max(1, ...DIRS8.map(d => animFramesForDir(anim, d).length));
    const mtx = el("div.frame-matrix");
    mtx.style.gridTemplateColumns = "auto repeat(" + nF + ", 1fr)";
    mtx.appendChild(el("div.fm-corner", { text: "dir ╲ f" }));
    for (let f = 0; f < nF; f++) mtx.appendChild(el("div.fm-colhead.mono", { text: "f" + f }));
    for (const d of DIRS8) {
      mtx.appendChild(el("div.fm-rowhead.mono", { text: DIR_SHORT[d] }));
      const frames = animFramesForDir(anim, d);
      for (let f = 0; f < nF; f++) { const cv = el("canvas.spr", { width: 64, height: 64, style: "width:64px" }); if (frames[f]) drawSprite(cv, frames[f], 64); mtx.appendChild(cv); }
    }
    box.appendChild(mtx);
    box.appendChild(el("button.btn.sm.ghost", { text: "▲ collapse", onclick: collapsed }));
    wrap.appendChild(box);
  }
  function create() { if (ctx) openCreateAnimationDialog(ctx.type, ctx.key, ctx.stateNode, cell.action, ctx.onCreated); }
  collapsed();
  return wrap;
}

// "🏷 request art" — a tiny data proposal (schema taiao-needsart/1) flagging a
// state/animation/other art someone wants for this subject, so it joins the
// wishlist on the Needs-art hub ("Requested by the crew") for the crew to
// endorse and eventually fill. The "— wants " title substring is the cheap
// client-side filter that section uses to find these among the open feed
// (see needs-art.js) — the payload stays the real source of truth.
function openRequestArtDialog(type, key) {
  if (!Taiao.logged()) { toast("Sign in to request art.", "warn"); App.go("#/settings"); return; }
  const entry = (Providers.get(type) && Providers.get(type).entry(key)) || {};
  const name = entry.name || key;
  const bg = el("div.modal-bg", { onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el("div.modal", { style: "width:min(440px,94vw)" });
  m.appendChild(el("span.x", { text: "×", onclick: () => bg.remove() }));
  m.appendChild(el("h2", { text: "Request art" }));
  m.appendChild(el("p.tagline", { text: "Flag a state or animation you'd like to see for " + name + " — it joins the crew's wishlist on the Needs art hub, endorsable like any proposal." }));
  const whatSel = el("select");
  [["state", "a state / costume"], ["animation", "an animation"], ["art", "other art"]].forEach(([v, l]) => whatSel.appendChild(el("option", { value: v, text: l })));
  const dlId = "studio-common-states";
  if (!document.getElementById(dlId)) {
    const dl = el("datalist", { id: dlId });
    (typeof COMMON_STATES !== "undefined" ? COMMON_STATES : []).forEach(s => dl.appendChild(el("option", { value: s })));
    document.body.appendChild(dl);
  }
  const nameIn = el("input", { placeholder: "name, e.g. winter_cloak / dodge" });
  const syncList = () => { if (whatSel.value === "state") nameIn.setAttribute("list", dlId); else nameIn.removeAttribute("list"); };
  whatSel.onchange = syncList; syncList();
  const noteIn = el("textarea", { placeholder: "note (optional) — what should it look like?" });
  m.appendChild(el("label.field", null, [el("span", { text: "What" }), whatSel]));
  m.appendChild(el("label.field", null, [el("span", { text: "Name" }), nameIn]));
  m.appendChild(el("label.field", null, [el("span", { text: "Note (optional)" }), noteIn]));
  const go = el("button.btn.primary", { text: "Request", onclick: async () => {
    const rname = nameIn.value.trim();
    if (!rname) return toast("Name what you want.", "warn");
    go.disabled = true;
    const bundle = { schema: "taiao-needsart/1", object: { type, key, name }, request: { what: whatSel.value, name: rname, note: noteIn.value.trim() } };
    const title = name + " — wants " + whatSel.value + ": " + rname;
    const r = await Taiao.submitProposal(type, key, title, bundle, "data");
    if (r && r.ok) { toast("Requested — thanks for flagging it.", "ok"); bg.remove(); }
    else { toast((r && r.error) || "Couldn't submit.", "err", 6000); go.disabled = false; }
  } });
  m.appendChild(el("div.btn-row", { style: "margin-top:.7rem" }, [go, el("button.btn.ghost.sm", { text: "Cancel", onclick: () => bg.remove() })]));
  bg.appendChild(m); document.body.appendChild(bg);
}

// The animations box: rows = states, columns = snake_case animation names
// (per-type defaults + user-added). Each cell is an animation deck.
function animationsGridCard(type, key, stateRows, animMap, refresh) {
  const card = el("div.card");
  const cols = [...new Set(AnimCols.get(type).concat(
    // include any community animation actions not already a column
    Object.values(animMap || {}).flatMap(m => Object.keys(m || {}))
  ))];
  card.appendChild(el("div.sectitle", null, [
    el("h3", null, ["Animations ", el("span.hint", { text: "state × animation — click a cell to see frames & directions" })]),
    el("div.btn-row", { style: "gap:.5rem" }, [
      el("span.badge", { text: cols.length + " × " + stateRows.length }),
      el("button.btn.ghost.sm", { text: "🏷 request art", onclick: () => openRequestArtDialog(type, key) }),
    ]),
  ]));

  const grid = el("div.anim-grid");
  grid.style.gridTemplateColumns = "minmax(120px,auto) repeat(" + cols.length + ", auto)";
  grid.appendChild(el("div.anim-corner.mono", { text: "state ╲ anim" }));
  cols.forEach(c => grid.appendChild(el("div.anim-colhead.mono", { text: c })));
  for (const row of stateRows) {
    grid.appendChild(el("div.anim-rowhead.mono", { text: row.path }));
    for (const c of cols) {
      const cell = el("div.anim-cell");
      cell.appendChild(animDeck({ anim: (animMap[row.id] || {})[c] || null, action: c }, { type, key, stateNode: row.node, onCreated: refresh }));
      grid.appendChild(cell);
    }
  }
  card.appendChild(el("div.anim-scroll", null, [grid]));

  // add a new animation column
  const nameIn = el("input", { placeholder: "new animation name (snake_case), e.g. dodge", style: "max-width:260px" });
  const addBtn = el("button.btn.sm", { text: "＋ Add animation", onclick: () => { if (AnimCols.add(type, nameIn.value)) { nameIn.value = ""; refresh && refresh(); } else toast("Enter a name.", "warn"); } });
  card.appendChild(el("div.btn-row", { style: "margin-top:.7rem" }, [nameIn, addBtn]));
  return card;
}

// mount the animations matrix for a set of state nodes (monster/object).
function animationsSection(page, type, key, nodes) {
  const rows = nodes.filter(n => !n.goTo).map(n => ({ id: n.id, path: n.path, node: n }));
  const host = el("div"); page.appendChild(host);
  let am = {};
  const render = () => { clear(host); host.appendChild(animationsGridCard(type, key, rows, am, render)); };
  render();
}

// generate an animation for one (state, action) using the state's south sprite
async function openCreateAnimationDialog(type, key, stateNode, action, onCreated) {
  if (!PixelLab.hasKey()) { toast("Add your PixelLab key in Settings.", "warn"); App.go("#/settings"); return; }
  toast("Animating “" + action + "”…");
  try {
    const cv = el("canvas", { width: 128, height: 128 }); stateNode.draw(cv, 0); await sleep(320);
    const url = cv.toDataURL("image/png");
    const first = { type: "base64", base64: dataUrlToB64(url), format: "png" };
    const frames = await PixelLab.animate(first, action, 8);
    const drafts = await Store.all(type);
    let p = drafts.find(x => x.folder === key);
    if (!p) { p = Store.newProject(type, (Providers.get(type).entry(key) || {}).name || key); p.folder = key; }
    (p.anims || (p.anims = [])).push({ id: rid(), action, state: stateNode.path, frames });
    await Store.save(p);
    toast("Animation added to a draft.", "ok"); App.go("#/edit/" + p.id);
  } catch (e) { toast(e.message, "err", 6000); }
}

// nodes: [{ id, seg, name, parent, draw, goTo? }]; voteCtx = { type, key };
// animMap (optional): { nodeId|nodePath → [ {action, frames, by} ] }.
function stateTreeCard(title, hint, nodes, voteCtx, animMap) {
  const card = el("div.card");
  card.appendChild(el("div.sectitle", null, [
    el("h3", null, [title + " ", el("span.hint", { text: hint })]),
    el("div.btn-row", { style: "gap:.5rem" }, [
      el("span.badge", { text: nodes.length + (nodes.length === 1 ? " state" : " states") }),
      voteCtx ? el("button.btn.ghost.sm", { text: "🏷 request art", onclick: () => openRequestArtDialog(voteCtx.type, voteCtx.key) }) : null,
    ].filter(Boolean)),
  ]));
  if (voteCtx) {
    const genBoard = el("div");
    GenJobs.mountBoard(genBoard, { subject: Taiao.subjectFor(voteCtx.type, voteCtx.key) });
    card.appendChild(genBoard);
  }
  const byId = {}; nodes.forEach(n => byId[n.id] = n);
  const kids = {}; nodes.forEach(n => { const p = (n.parent && byId[n.parent]) ? n.parent : "__root"; (kids[p] || (kids[p] = [])).push(n); });
  const pathOf = n => { const segs = []; let cur = n, g = 0; while (cur && g++ < 24) { segs.unshift(cur.seg || slug(cur.name)); cur = (cur.parent && byId[cur.parent]) ? byId[cur.parent] : null; } return segs.join("."); };
  nodes.forEach(n => n.path = pathOf(n));

  const validNodes = [];   // non-root nodes needing a yes/no validity vote
  const dirIdxs = dirIdxsFor(voteCtx && voteCtx.type);   // 8 dirs / 4 tile variants / 1 icon
  const frameLabel = frameLabelFor(voteCtx && voteCtx.type);

  function branch(kind, childEl) {
    const arrow = kind === "anim"
      ? el("div.branch-arrow.anim", null, [el("div.a", { text: "↓" }), el("small", { text: "animates" })])
      : el("div.branch-arrow.state", null, [el("div.a", { text: "→" }), el("small", { text: "generates" })]);
    return el("div.tree-branch" + (kind === "anim" ? ".vert" : ""), null, [arrow, childEl]);
  }
  function createSlot(parentNode) {
    const wrap = el("div.deck-wrap");
    const slot = el("div.deck.create-slot", { title: "Create a new state from " + parentNode.path, onclick: () => openCreateStateDialog(voteCtx, parentNode) });
    // a deck of blank cards, fanned exactly like a real state deck so it lines
    // up with its siblings in the column (matches the node's frame count)
    const nIdx = (parentNode.dirIdxs || dirIdxs);
    for (let p = nIdx.length - 1; p >= 0; p--) {
      const card = el("div.deck-card.blank");
      card.style.zIndex = String(10 + (nIdx.length - p));
      card.style.transform = "translate(" + (p * 3) + "px," + (p * 11) + "px)";
      slot.appendChild(card);
    }
    slot.appendChild(el("div.create-plus", { text: "＋" }));
    wrap.appendChild(slot);
    wrap.appendChild(el("button.btn.sm.primary", { text: "Create New State", onclick: () => openCreateStateDialog(voteCtx, parentNode) }));
    return wrap;
  }
  function nodeEl(n) {
    if (n.parent) { n._extra = el("div.valid-vote"); validNodes.push(n); }
    const box = el("div.tree-node");
    const mainRow = el("div.node-main");
    mainRow.appendChild(stateDeck(n, n.dirIdxs || dirIdxs, frameLabel));
    const col = el("div.state-children");
    (kids[n.id] || []).forEach(c => col.appendChild(branch("state", nodeEl(c))));
    if (voteCtx) col.appendChild(branch("state", createSlot(n)));   // always offer a new state
    if (col.childNodes.length) mainRow.appendChild(col);
    box.appendChild(mainRow);
    return box;   // animations live in their own matrix now, not on the tree
  }

  const tree = el("div.tree");
  (kids.__root || []).forEach(r => tree.appendChild(nodeEl(r)));
  card.appendChild(tree);

  let defaultHost = null;
  if (voteCtx && nodes.length > 1) {
    card.appendChild(el("hr"));
    card.appendChild(el("h3", { style: "font-size:.9rem", text: "Default state" }));
    card.appendChild(el("p.tagline", { text: "Vote for the state the game should show by default." }));
    defaultHost = el("div"); card.appendChild(defaultHost);
  }

  async function loadVotes() {
    if (!voteCtx) return;
    let tally = {}; try { tally = await Taiao.tally(voteCtx.type, voteCtx.key); } catch (_) {}
    if (defaultHost) renderVotes(defaultHost, voteCtx.type, voteCtx.key, [{ field: "default_state", label: "Default deck", current: (nodes.find(n => !n.parent) || {}).path, choices: nodes.map(n => ({ value: n.path, label: n.path })) }]);
    for (const n of validNodes) {
      const field = "valid:" + n.path, parent = byId[n.parent] ? byId[n.parent].path : "parent";
      miniVote(n._extra, voteCtx.type, voteCtx.key, field, ["yes", "no"], (tally && tally[field]) || {}, "valid branch of " + parent + "?", loadVotes);
    }
  }
  if (voteCtx) loadVotes();
  return card;
}

function miniVote(host, type, key, field, choices, counts, label, onVoted) {
  clear(host);
  host.appendChild(el("span.vv-label", { style: "margin-right:.4rem", text: label }));
  host.appendChild(VoteWidget.symbol({
    kind: type, folder: key, field, type: "select", choices,
    label, tallies: { [field]: counts || {} }, refetch: onVoted,
  }));
}

// A per-type datalist + resolver of snake_case ids for "Use outfit": character
// state ids (dot notation) for characters, monster ids for monsters, object
// ids for objects — you can only pick an outfit of the SAME type. Options
// carry ONLY the id (no nicknames/labels).
const _outfitIdx = {};
function outfitIndex(type) {
  if (_outfitIdx[type]) return _outfitIdx[type];
  const map = new Map();
  const dlId = "outfit-ids-" + type;
  const dl = el("datalist", { id: dlId });
  const add = (id, draw) => { if (id && !map.has(id)) { map.set(id, { draw }); dl.appendChild(el("option", { value: id })); } };
  try {
    if (type === "character") {
      for (const e of Roster.listChars()) {
        add(e.snake, (cv, di) => Roster.drawState(cv, e, "Idle", di));
        (e.states || []).filter(s => s !== "Idle").forEach(s => add(e.snake + "." + slug(s), (cv, di) => Roster.drawState(cv, e, s, di)));
      }
      for (const e of Roster.listNpcs()) add(e.snake, (cv, di) => Roster.drawNpc(cv, e.mix, di));
    } else {
      const prov = Providers.get(type);
      if (prov) for (const e of prov.list()) add(e.key, (cv, di) => prov.draw(cv, e, di));
    }
  } catch (_) {}
  document.body.appendChild(dl);
  _outfitIdx[type] = { map, dlId };
  return _outfitIdx[type];
}
async function resolveOutfitSprite(type, id) {
  const rec = outfitIndex(type).map.get(id);
  if (!rec) return null;
  const cv = el("canvas", { width: 128, height: 128 });
  rec.draw(cv, 0);
  await sleep(320);
  try { const url = cv.toDataURL("image/png"); return (url && url.length > 300) ? url : null; } catch (_) { return null; }
}

// dialogue: create a new state from a parent state (uses it as the reference,
// or an "outfit" — any character state id in the system — when chosen)
async function openCreateStateDialog(voteCtx, parentNode) {
  const type = voteCtx.type, folder = voteCtx.key;
  const outfitDl = outfitIndex(type);   // ids of the SAME type only
  const bg = el("div.modal-bg", { onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el("div.modal");
  m.appendChild(el("span.x", { text: "×", onclick: () => bg.remove() }));
  m.appendChild(el("h2", { text: "New state" }));
  m.appendChild(el("p.tagline", { html: "Based on <span class='mono'>" + escapeHtml(parentNode.path) + "</span> — its sprite is the style reference, unless you pick an outfit below." }));
  const nameIn = el("input", { placeholder: "new state name (e.g. armed, cloak, winter)" });
  const promptIn = el("textarea", { placeholder: "describe the change… e.g. wearing heavy plate armour" });
  m.appendChild(el("label.field", null, [el("span", { text: "State name" }), nameIn]));
  m.appendChild(el("label.field", null, [el("span", { text: "Prompt" }), promptIn]));
  const suggestBtn = el("button.btn.sm.ghost", {
    text: "✨ Suggest a prompt", onclick: () => {
      const s = GenJobs.suggest("state", { baseName: parentNode.name || parentNode.path });
      promptIn.value = s.prompt; nameIn.value = s.id;
      suggestBtn.textContent = "🔁 Another suggestion";
    },
  });
  m.appendChild(el("div.btn-row", { style: "margin:-.3rem 0 .4rem" }, [suggestBtn]));

  // "Use outfit" — reveal a combobox of ids of the SAME type
  const ph = type === "monster" ? "monster id, e.g. goblin · brown_bear" : type === "object" ? "object id, e.g. anvil · barrel" : "state id, e.g. cathal.armed · idir";
  const outfitIn = el("input", { placeholder: ph });
  outfitIn.setAttribute("list", outfitDl.dlId);
  const outfitField = el("label.field", { style: "display:none" }, [el("span", { text: "Outfit — a " + type + " id whose look to apply" }), outfitIn]);
  const useOutfitBtn = el("button.btn.sm", { text: "👕 Use outfit", onclick: () => { const show = outfitField.style.display === "none"; outfitField.style.display = show ? "block" : "none"; useOutfitBtn.classList.toggle("primary", show); if (show) outfitIn.focus(); else outfitIn.value = ""; } });
  m.appendChild(el("div.btn-row", { style: "margin:.2rem 0 .4rem" }, [useOutfitBtn]));
  m.appendChild(outfitField);

  // estimated cost + balance (like the sprite generator). A new state is one
  // reference-guided generation: 8-dir character/monster ≈ 2 gens, 8-dir object
  // ≈ 20 gens, single-frame types ≈ 1 (estimates — no exact formula published).
  if (typeof costEstimateBlock === "function") {
    m.appendChild(costEstimateBlock(() => {
      const single = !(type === "character" || type === "monster" || type === "object");
      const gens = single ? 1 : (type === "object" ? 20 : 2);
      return { gens, exact: false };
    }).node);
  }
  const status = el("div.tagline", { style: "min-height:1.2em" });
  const go = el("button.btn.primary", { text: "Generate & add", onclick: async () => {
    const name = nameIn.value.trim(); if (!name) return toast("Name the state.", "warn");
    if (!Taiao.logged()) { toast("Sign in (Settings) to generate.", "warn"); return; }
    if (!PixelLab.hasKey()) { toast("Add your PixelLab key in Settings.", "warn"); return; }
    const outfitId = outfitField.style.display !== "none" ? outfitIn.value.trim() : "";
    go.disabled = true;
    // reference: the chosen outfit if set (and resolvable), else the parent state
    let reference = null;
    if (outfitId) {
      status.textContent = "Resolving outfit " + outfitId + "…";
      const url = await resolveOutfitSprite(type, outfitId);
      if (url) reference = { type: "base64", base64: dataUrlToB64(url), format: "png" };
      else toast("Couldn't resolve outfit “" + outfitId + "” — using the parent state.", "warn", 5000);
    }
    if (!reference) {
      status.textContent = "Resolving reference sprite…";
      try { const cv = el("canvas", { width: 128, height: 128 }); parentNode.draw(cv, 0); await sleep(320); const url = cv.toDataURL("image/png"); if (url && url.length > 300) reference = { type: "base64", base64: dataUrlToB64(url), format: "png" }; } catch (_) {}
    }
    const desc = (promptIn.value.trim() || name) + (outfitId ? (", wearing the outfit of " + outfitId) : "");
    // Only characters, monsters and world objects are directional (8-way).
    // Anything else (items / biome tiles / map icons / any future single-frame
    // type) goes through the PixelLab pipeline as ONE image, not an 8-dir set.
    const single = !(type === "character" || type === "monster" || type === "object");
    const pixellabKind = single ? "image" : (type === "object" ? "object8" : "character");
    const subject = Taiao.subjectFor(type, folder);
    bg.remove();
    GenJobs.execute(
      { spriteType: type, spriteId: folder, label: name, subject, prompt: desc, pixellabKind },
      async onRef => {
        if (single) { const img = await PixelLab.generateImage({ description: desc, reference }); return { dirs: { south: img } }; }
        if (type === "object") { const r = await PixelLab.createObject8({ description: desc, reference, onRef }); return { dirs: r.dirs }; }
        const r = await PixelLab.createCharacter({ description: desc, reference, onRef }); return { dirs: r.dirs };
      }
    ).then(jobId => { if (reference) GenJobs.setReference(jobId, reference); })
     .catch(e => toast("Generation failed: " + (e && e.message || e), "err", 7000));
    toast("Generating “" + name + "” — watch it in the card above the state tree.", "ok");
  } });
  m.appendChild(status);
  m.appendChild(el("div.btn-row", { style: "margin-top:.6rem" }, [go, el("button.btn.ghost", { text: "Cancel", onclick: () => bg.remove() })]));
  bg.appendChild(m); document.body.appendChild(bg);
}

// ---------------- character detail ----------------
// ---- character: ART (sprite page) — state tree + animations ----
function renderCharacterArt(page, provider, entry) {
  const pc = el("div.card");
  pc.appendChild(el("h3", { text: entry.npc ? "Description" : "Original prompt" }));
  pc.appendChild(el("p", { text: entry.npc ? (entry.title || entry.name) : Roster.prettyName(entry.folder) }));
  pc.appendChild(el("p.tagline", { html: "Source art key: <span class='mono'>" + escapeHtml(entry.folder) + "</span>" + (entry.npc ? " — a world NPC (drawn from the mix-NPC atlas)." : " — the truncated PixelLab prompt this character was generated from.") }));
  page.appendChild(pc);

  // state tree of card-decks. Root = the character's own snake_case id (the
  // renamed "idle"); outfit states + NPC combinations hang off it.
  const nodes = [];
  const rootId = entry.npc ? entry.key : "__root__";
  if (entry.npc) {
    nodes.push({ id: entry.key, seg: entry.snake, name: entry.common, parent: null, draw: (cv, di) => Roster.drawState(cv, entry, "Idle", di) });
  } else {
    nodes.push({ id: rootId, seg: entry.snake, name: entry.common, parent: null, draw: (cv, di) => Roster.drawState(cv, entry, "Idle", di) });
    (entry.states || []).filter(s => s !== "Idle").forEach(s => nodes.push({ id: "state:" + s, seg: slug(s), name: s, parent: rootId, draw: (cv, di) => Roster.drawState(cv, entry, s, di) }));
    Roster.npcsForRoot(entry.folder).forEach(npc => nodes.push({ id: npc.key, seg: npc.garbSeg, name: npc.common + " — " + npc.title, parent: rootId, draw: (cv, di) => Roster.drawNpc(cv, npc.mix, di), goTo: "#/sprite?type=character&key=" + encodeURIComponent(npc.key) }));
  }
  const hint = "→ states & NPCs · ＋ create new state · click a deck to expand";
  const treeCard = stateTreeCard("State tree", hint, nodes, { type: "character", key: entry.folder });
  page.appendChild(treeCard);
  if (provider.supportsGen) mergeSharedVersions(treeCard, "character", entry.folder, entry.common || entry.name);

  // animations matrix (rows = states, columns = animation names). Community
  // animations for this subject load into their cells.
  const stateRows = nodes.filter(n => !n.goTo).map(n => ({ id: n.id, path: n.path, node: n }));
  const animHost = el("div"); page.appendChild(animHost);
  let lastAnimMap = {};
  const renderAnims = () => { clear(animHost); animHost.appendChild(animationsGridCard("character", entry.folder, stateRows, lastAnimMap, renderAnims)); };
  renderAnims();
  (async () => {
    const ex = await fetchSubjectExtras("character", entry.folder);
    lastAnimMap = {};
    for (const a of ex.anims) {
      const match = stateRows.find(r => r.path === a.state || r.id === a.state);
      const rid2 = match ? match.id : rootId;
      (lastAnimMap[rid2] = lastAnimMap[rid2] || {})[slug(a.action || "animation")] = a;
    }
    renderAnims();
  })();
}

// ===== Sounds card — the real in-game clips an entity's actions play =====
// No sound↔entity link is stored anywhere; it's derived from the entity's true
// in-game actions (the same source of truth the Action menu uses). Each moment
// maps to a sfx event id; the clips for that id come from the sound provider.

// Every sfx clip, grouped by its trigger id (soundTrigger): chop → [chop0, chop1…].
let _soundsByTrigger = null;
function soundsByTrigger() {
  if (_soundsByTrigger) return _soundsByTrigger;
  _soundsByTrigger = new Map();
  const prov = (typeof Providers !== "undefined") ? Providers.get("sound") : null;
  if (prov && prov.list) for (const e of prov.list()) {
    if (e.cat !== "sfx" || !prov.trigger) continue;
    const id = prov.trigger(e); if (!id || id === "—") continue;
    (_soundsByTrigger.get(id) || _soundsByTrigger.set(id, []).get(id)).push(e);
  }
  return _soundsByTrigger;
}
// human label for each moment we surface (what the player is doing when it fires)
const SOUND_MOMENTS = {
  chop: "Chopping it", mine: "Mining it", fish: "Fishing here", forage: "Foraging here",
  craft: "Crafting here", anvil: "Smithing here", coins: "Banking",
  dooropen: "Opening it", doorclose: "Closing it", gate: "Opening the gate",
  latch: "Unlocking it", climb: "Climbing it", portal: "Travelling through", attune: "Attuning to it",
  swing: "You attack and miss", hit: "You land a hit", hurt: "It hits you", kill: "It dies",
};
// the gather sfx event id for a node's skill
const GATHER_TRIGGER = { Woodcutting: "chop", Mining: "mine", "Ore-mining": "mine", "Gem-mining": "mine", "Stone-mining": "mine", Fishing: "fish", Foraging: "forage" };

// Derive the ordered [{ trigger, when }] an entity's actions fire in game.
function soundTriggersForEntity(type, key, menuKind) {
  const out = [];   // { trigger, when }
  const add = (trigger, when) => { if (trigger && !out.some(o => o.trigger === trigger)) out.push({ trigger, when: when || SOUND_MOMENTS[trigger] || trigger }); };
  if (menuKind === "monster") {
    ["swing", "hit", "hurt", "kill"].forEach(t => add(t));
    return out;
  }
  if (menuKind === "npc") return out;   // generic NPC talk has no sfx clip
  // ---- world object ----
  if (typeof NODE_TYPES !== "undefined") {
    const nt = Object.values(NODE_TYPES).find(n => n && n.spr === key);
    if (nt) add(GATHER_TRIGGER[nt.skill]);
  }
  if (typeof STATIONS !== "undefined" && STATIONS[key]) {
    const metal = /anvil|furnace|forge|smith|smelt|assay/.test(key) || (STATIONS[key].lists || []).some(s => /smith|smelt/i.test(s));
    add(metal ? "anvil" : "craft");
  }
  if (/portal|waystone/.test(key)) { add("portal"); add("attune"); }
  if (/gate/.test(key)) add("gate");
  if (/door/.test(key)) { add("dooropen"); add("doorclose"); }
  if (/lock/.test(key)) add("latch");
  if (/ladder/.test(key)) add("climb");
  if (/bank|chest/.test(key)) add("coins");
  return out;
}

// A single ▶ play button for a sound clip.
function soundPlayBtn(provider, e) {
  const b = el("button.btn.sm.ghost", { type: "button", text: "▶", title: "Play", style: "line-height:1" });
  let a = null;
  b.onclick = () => { try { if (!a) a = new Audio(provider.audioSrc(e)); a.currentTime = 0; a.play().catch(() => {}); } catch (_) {} };
  return b;
}

// The "Sounds" card: each moment this entity's actions fire, with the real clips
// (▶ play + link to the sound page). Omitted entirely when nothing fires.
function soundsSection(page, type, key, menuKind) {
  const provider = (typeof Providers !== "undefined") ? Providers.get("sound") : null;
  if (!provider) return;
  const byTrig = soundsByTrigger();
  const rows = soundTriggersForEntity(type, key, menuKind)
    .map(m => ({ ...m, clips: byTrig.get(m.trigger) || [] }))
    .filter(m => m.clips.length);
  if (!rows.length) return;
  const card = el("div.card");
  card.appendChild(el("div.sectitle", null, [el("h3", null, ["Sounds ", el("span.hint", { text: "the clips these actions play in game" })])]));
  const th = "border-bottom:1px solid var(--line,#333);padding:.4rem .55rem;text-align:left;font-size:.7rem;letter-spacing:.02em;color:var(--ink-dim);white-space:nowrap";
  const td = "border-bottom:1px solid var(--line,#222);padding:.5rem .55rem;font-size:.82rem;vertical-align:top";
  const table = el("table", { style: "border-collapse:collapse;width:100%" });
  table.appendChild(el("tr", null, ["When", "Trigger", "Clips"].map(h => el("th", { style: th, text: h }))));
  rows.forEach(r => {
    const clips = el("div", { style: "display:flex;flex-wrap:wrap;gap:.5rem 1rem" });
    r.clips.forEach(c => clips.appendChild(el("span", { style: "display:inline-flex;align-items:center;gap:.35rem" }, [
      soundPlayBtn(provider, c),
      el("a", { style: "color:inherit;text-decoration:none;font-family:monospace;font-size:.76rem", text: c.name, href: "#/detail?type=sound&key=" + encodeURIComponent(c.key) }),
    ])));
    table.appendChild(el("tr", null, [
      el("td", { style: td }, [r.when]),
      el("td", { style: td }, [el("span.mono", { style: "color:var(--gold);font-size:.76rem", text: r.trigger })]),
      el("td", { style: td }, [clips]),
    ]));
  });
  card.appendChild(el("div", { style: "overflow-x:auto" }, [table]));
  page.appendChild(card);
}

// ===== Sprite & animation rules card — votable + community-proposable =====
// A rule is WHEN <condition> THEN <change sprite | play animation>. Conditions
// include the game's state/lifecycle/movement plus item events (equip / wear /
// remove / eat / drink / use an item_id). Animations are ALWAYS namespaced by a
// sprite id: "<sprite id>:<animation>" (e.g. "dune.hooth:idle"), and any sprite
// id in the whole studio may be called — not just this entity's own.
//   • auto-derived DEFAULT rules seed the list, each with a keep/remove vote;
//   • the community can add their own rules (keep/remove voted the same way),
//     calling in any studio sprite id via the add-a-rule form's autocomplete.

// what fires each animation id (the animation-matrix columns), by ordinary meaning
const ANIM_WHEN = {
  idle: "At rest — the default loop", walk: "Moving to a tile", run: "Moving quickly",
  attack: "Attacking a target", swing: "A melee swing (hit or miss)", shoot: "Loosing an arrow",
  cast: "Weaving a spell", block: "Blocking an incoming hit", special: "Using a special ability",
  hurt: "Taking damage", die: "On death",
  open: "When opened", close: "When closed", use: "When used / activated", break: "When destroyed or depleted",
};
// the animation ids for a type + the condition that plays each
function animRulesForType(type) {
  const cols = (typeof GameTriggers !== "undefined") ? GameTriggers.animColumns(type) : ["idle", "walk", "attack"];
  return cols.map(a => ({ anim: a, when: ANIM_WHEN[a] || ("On " + a) }));
}
// the sprite ids for an entity + the condition that selects each (default first).
// whenKey is a stable machine slug for the condition (used as the vote-field id).
function spriteRulesForEntity(type, entry, menuKind) {
  const out = [];   // { sprite, when, whenKey, isDefault }
  if (type === "character") {
    const base = entry.snake || entry.key;
    if (menuKind === "npc" || entry.npc) { out.push({ sprite: base, when: "Fixed — a world NPC draws one mix-atlas sprite (no state swaps)", whenKey: "default", isDefault: true }); return out; }
    // outfit looks all animate under the one character sprite id (base); the state
    // just changes the drawn frames, so the default row carries the real sprite id.
    const states = (entry.states && entry.states.length) ? entry.states : ["Idle"];
    states.forEach(s => {
      const low = String(s).toLowerCase(), isIdle = /^idle$/i.test(s);
      const armed = /arm|weapon|holding/.test(low);
      const when = isIdle ? "Default — unarmed / at rest"
        : armed ? "When a weapon is drawn / in combat (look: " + s + ")"
        : "Selected by the player's outfit — look: " + s;
      out.push({ sprite: base, when, whenKey: isIdle ? "default" : armed ? "in_combat" : "outfit:" + slug(s), isDefault: isIdle });
    });
    return out;
  }
  if (type === "monster") {
    const { base, keys } = monsterFamilyKeys(entry);
    keys.forEach(k => out.push({
      sprite: monSpriteId(k), isDefault: k === base,
      whenKey: k === base ? "default" : /_v$/.test(k) ? "giant" : /_baby$/.test(k) ? "juvenile" : "variant",
      when: k === base ? "Default spawn" : /_v$/.test(k) ? "Giant variant — rare oversized spawn" : /_baby$/.test(k) ? "Juvenile — before it grows to an adult (~300 s)" : "Variant",
    }));
    return out;
  }
  // object: one base sprite, plus real runtime visual states for doors & nodes
  const key = entry.key, baseId = entry.snake || key;
  out.push({ sprite: baseId, when: "Default", whenKey: "default", isDefault: true });
  if (/door|gate/.test(key)) out.push({ sprite: baseId + " · open", when: "While open (after the Open action; closes again on Close)", whenKey: "open", isDefault: false });
  if (typeof NODE_TYPES !== "undefined" && Object.values(NODE_TYPES).some(n => n && n.spr === key))
    out.push({ sprite: baseId + " · depleted", when: "After it's gathered — until it respawns", whenKey: "depleted", isDefault: false });
  return out;
}

// a monster KEY → its studio sprite id (the same id the Sprites tab & registry
// use, e.g. "adder" → "mcd_adder"), so rule sprite ids resolve to drawable decks.
function monSpriteId(k) { return (typeof spriteIdFor === "function") ? spriteIdFor("monster", k) : k; }
// the monster's genuinely-distinct family KEYS (base + giant/baby that don't just
// reuse the base art), computed by key (not sprite id).
function monsterFamilyKeys(entry) {
  const prov = (typeof Providers !== "undefined") ? Providers.get("monster") : null;
  const base = (entry.baseKey || entry.key).replace(/(_v)?(_baby)?$/, "");
  const sigOf = k => (prov && prov.layerKeys ? (prov.layerKeys(k, 0) || []) : []).filter(Boolean).join("+");
  const baseSig = sigOf(base);
  const keys = [base, base + "_v", base + "_baby"]
    .filter(k => typeof MONSTERS !== "undefined" && MONSTERS[k])
    .filter(k => k === base || sigOf(k) !== baseSig);
  return { base, keys };
}
// The canonical sprite id an entity animates under (its own studio sprite id).
// Animations are ALWAYS called as "<sprite id>:<animation>".
function entitySpriteId(type, entry) {
  if (type === "monster") return monSpriteId(monsterFamilyKeys(entry).base);
  return entry.snake || entry.key;
}
// The sprite ids this entity's own animations are called on. One for characters
// and objects; monsters also animate their genuinely-distinct giant/baby sprites.
function animSpriteIds(type, entry) {
  if (type === "monster") return [...new Set(monsterFamilyKeys(entry).keys.map(monSpriteId))].filter(Boolean);
  return [entitySpriteId(type, entry)];
}

// ===== studio-wide sprite & animation registries =====
// An entity may call ANY sprite id in the studio (not only its own), and any
// "<sprite id>:<animation>". These enumerate the full call vocabulary.
// registry: sprite id → { id, type, e (provider entry), provider }. The id is
// computed the same way as the Sprites tab, so any id can be resolved back to a
// drawable entry. Memoised.
let _spriteReg = null;
function studioSpriteRegistry() {
  if (_spriteReg) return _spriteReg;
  const reg = new Map();
  const idOf = (t, e) => {
    if (t === "ui") return typeof uiSpriteId === "function" ? uiSpriteId(e.iconKey || e.key) : (e.itemId || e.key);
    if (t === "monster") return typeof spriteIdFor === "function" ? spriteIdFor("monster", e.key) : e.key;
    if (t === "map") return e.poi || e.key;
    return e.snake || e.key;
  };
  for (const t of ["character", "object", "monster", "ui", "tile", "map"]) {
    const p = (typeof Providers !== "undefined") ? Providers.get(t) : null;
    if (!p || !p.list) continue;
    for (const e of p.list()) {
      try { const id = idOf(t, e); if (id && !reg.has(String(id))) reg.set(String(id), { id: String(id), type: t, e, provider: p }); } catch (_) {}
    }
  }
  return _spriteReg = reg;
}
let _allSpriteIds = null;
function allStudioSpriteIds() {
  if (_allSpriteIds) return _allSpriteIds;
  _allSpriteIds = [...studioSpriteRegistry().keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
  return _allSpriteIds;
}
let _allAnimNames = null;
function allAnimNames() {
  if (_allAnimNames) return _allAnimNames;
  const s = new Set();
  if (typeof GameTriggers !== "undefined") {
    ["character", "monster", "object"].forEach(t => (GameTriggers.animColumns(t) || []).forEach(a => s.add(a)));
    (GameTriggers.animations ? GameTriggers.animations() : []).forEach(a => s.add(a));
  }
  _allAnimNames = [...s].filter(Boolean).sort((a, b) => a.localeCompare(b));
  return _allAnimNames;
}
// shared datalists (built once) so the call-builder inputs can autocomplete every
// studio sprite id / animation name.
function studioSpriteDatalist() {
  if (document.getElementById("studio-sprite-ids")) return "studio-sprite-ids";
  const dl = el("datalist", { id: "studio-sprite-ids" });
  allStudioSpriteIds().forEach(id => dl.appendChild(el("option", { value: id })));
  document.body.appendChild(dl); return "studio-sprite-ids";
}
function studioAnimDatalist() {
  if (document.getElementById("studio-anim-names")) return "studio-anim-names";
  const dl = el("datalist", { id: "studio-anim-names" });
  allAnimNames().forEach(a => dl.appendChild(el("option", { value: a })));
  document.body.appendChild(dl); return "studio-anim-names";
}

// ---- the entity's "Sprites" section: a deck per rule-referenced sprite ----
// A stateDeck node for a studio sprite id (its 8-direction fanned deck), or null
// if the id isn't a known studio sprite.
function spriteDeckNode(spriteId) {
  const reg = studioSpriteRegistry().get(String(spriteId));
  if (!reg) return null;
  const p = reg.provider, e = reg.e, t = reg.type;
  const name = e.name || (typeof Roster !== "undefined" && Roster.prettyName ? Roster.prettyName(e.key) : e.key);
  // animDirs = the sprite's GENUINELY distinct facings — so a batch animation
  // spends one PixelLab call per real direction, not 8 on a mirrored billboard
  // or a single-frame icon. (dirIdxs still fans all 8 in the deck for display.)
  const directional = (t === "character" || t === "object") || (t === "monster" && p.isDir && p.isDir(e));
  const animDirs = directional ? [0, 1, 2, 3, 4, 5, 6, 7] : [0];
  return {
    id: spriteId, name, path: spriteId, _type: t, key: e.key,
    dirIdxs: dirIdxsFor(t), animDirs,
    draw: (cv, di) => { try { p.draw(cv, e, di); } catch (_) {} },
    goTo: "#/sprite?type=" + t + "&key=" + encodeURIComponent(e.key),
  };
}
// One 8-direction deck (expandable, exactly like the Sprites page) for every
// sprite id this entity's rules reference — its own defaults plus any studio
// sprite pulled in by a community rule. Each deck carries a state label above it,
// and a "Generate animation" button batch-animates any chosen sprites at once.
function entitySpritesSection(page, type, entry, menuKind) {
  const card = el("div.card");
  const deckSprites = [];   // { id, node } for every deck shown — feeds the batch dialog
  const genBtn = el("button.btn.sm.primary", { text: "🎬 Generate animation", onclick: () => {
    if (!deckSprites.length) { toast("No sprites to animate yet.", "warn"); return; }
    openBatchAnimateDialog(deckSprites);
  } });
  card.appendChild(el("div.sectitle", null, [el("h3", null, ["Sprites ", el("span.hint", { text: "every sprite these rules use — click a deck to expand its 8 directions" })]), genBtn]));
  const grid = el("div", { style: "display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-start" });
  const emptyNote = el("p.tagline", { text: "No studio sprites resolved for this entity's rules yet." });
  card.appendChild(grid); card.appendChild(emptyNote); page.appendChild(card);

  const shown = new Set();
  const addDeck = spriteId => {
    if (!spriteId || shown.has(spriteId)) return;
    const node = spriteDeckNode(spriteId);
    if (!node) return;
    shown.add(spriteId);
    try { emptyNote.remove(); } catch (_) {}
    deckSprites.push({ id: spriteId, node });
    // state label ABOVE the deck (links to its sprite page); the deck's own bottom
    // label is suppressed so the state id isn't shown twice.
    const label = el("a", { href: node.goTo, style: "font-family:monospace;font-size:.75rem;color:var(--gold);text-decoration:none;font-weight:600;text-align:center;max-width:9rem;word-break:break-all", text: spriteId });
    const deckNode = Object.assign({}, node, { path: "", name: "", goTo: null });
    grid.appendChild(el("div", { style: "display:flex;flex-direction:column;align-items:center;gap:.35rem" }, [label, stateDeck(deckNode, node.dirIdxs, frameLabelFor(node._type))]));
  };
  // the sprite id behind a rule: anim rules → the "<sprite>" before ":"; sprite
  // rules → the target minus any " · look" decoration.
  const baseOf = r => r.action === "anim" ? String(r.target).split(":")[0] : String(r.target).split(" ·")[0];
  defaultRules(type, entry, menuKind).forEach(r => addDeck(baseOf(r)));
  // community-referenced sprites (async — appended when they load)
  loadCommunityRules(type, entry.folder || entry.key)
    .then(rules => rules.forEach(r => addDeck(r.sprite || (r.target ? String(r.target).split(":")[0] : null))))
    .catch(() => {});
}

// existing animation names per sprite id — used to block a duplicate
// "<sprite>:<name>". Covers BOTH local drafts (all animatable types) AND every
// community-published animation on the given sprites' owning subjects.
async function existingAnimNamesBySprite(sprites) {
  const map = {};
  const add = (state, action) => { if (!state || !action) return; (map[state] || (map[state] = new Set())).add(slug(action)); };
  // local drafts
  for (const t of ["character", "object", "monster"]) {
    let drafts = []; try { drafts = await Store.all(t); } catch (_) {}
    for (const p of drafts) for (const a of (p.anims || [])) add(a.state, a.action);
  }
  // community-published animations, fetched once per unique owning subject
  const subjects = new Map();   // "type|folder" → { type, folder }
  for (const s of (sprites || [])) {
    const reg = studioSpriteRegistry().get(String(s && s.id != null ? s.id : s));
    if (!reg || !reg.e) continue;
    subjects.set(reg.type + "|" + reg.e.key, { type: reg.type, folder: reg.e.key });
  }
  await Promise.all([...subjects.values()].map(async sub => {
    try { const ex = await fetchSubjectExtras(sub.type, sub.folder); (ex.anims || []).forEach(a => add(a.state, a.action)); } catch (_) {}
  }));
  return map;
}
// save one generated animation under its sprite's source (a draft project keyed
// by the sprite's owning entity), tagged state=<sprite id>, action=<name>.
// `art` is { dirs: {dir: frames[]} } (8-direction) or { frames: [] } (south only).
async function saveSpriteAnim(spriteId, name, art) {
  const reg = studioSpriteRegistry().get(String(spriteId));
  const t = (reg && reg.type) || "character";
  const folder = (reg && reg.e && reg.e.key) || spriteId;
  const drafts = await Store.all(t);
  let p = drafts.find(x => x.folder === folder);
  if (!p) { p = Store.newProject(t, (reg && reg.e && reg.e.name) || folder); p.folder = folder; }
  (p.anims || (p.anims = [])).push(Object.assign({ id: rid(), action: name, state: spriteId }, art || {}));
  await Store.save(p);
}
// dialog: pick sprites (checkboxes) + a name + a prompt → PixelLab animates each
// checked sprite, saving "<sprite>:<name>" under that sprite. Blocks if the name
// already exists on any checked sprite.
async function openBatchAnimateDialog(sprites) {
  if (!PixelLab.hasKey()) { toast("Add your PixelLab key in Settings.", "warn"); App.go("#/settings"); return; }
  const existing = await existingAnimNamesBySprite(sprites);
  const bg = el("div.modal-bg", { onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el("div.modal");
  m.appendChild(el("span.x", { text: "×", onclick: () => bg.remove() }));
  m.appendChild(el("h2", { text: "Generate animation" }));
  m.appendChild(el("p.tagline", { text: "Check the sprites to animate, name the animation (the part after the “:”), and describe it. PixelLab animates every distinct facing (8 for directional sprites, 1 for mirrored/flat ones) and saves it under that sprite." }));
  const nameIn = el("input", { placeholder: "animation name, e.g. attack", autocomplete: "off" });
  const promptIn = el("textarea", { placeholder: "describe the animation… e.g. swings a sword overhead" });
  m.appendChild(el("label.field", null, [el("span", { text: "Animation name (after the “:”)" }), nameIn]));
  m.appendChild(el("label.field", null, [el("span", { text: "Prompt" }), promptIn]));
  m.appendChild(el("div.tagline", { style: "font-size:.75rem;margin-top:.4rem", text: "Sprites to animate" }));
  const listHost = el("div", { style: "display:flex;flex-direction:column;gap:.3rem;max-height:15rem;overflow:auto;margin:.3rem 0 .5rem;padding:.2rem;border:1px solid var(--line,#333);border-radius:8px" });
  const rows = sprites.map(s => {
    const cb = el("input", { type: "checkbox" }); cb.checked = true;
    const cv = el("canvas", { width: 40, height: 40, style: "width:40px;height:40px;flex:none" });
    try { s.node.draw(cv, 0); } catch (_) {}
    const has = existing[s.id] || new Set();
    const rowEl = el("label", { style: "display:flex;align-items:center;gap:.5rem;cursor:pointer" }, [
      cb, cv, el("span.mono", { style: "font-size:.78rem", text: s.id }),
      has.size ? el("span.mono", { style: "font-size:.66rem;color:var(--ink-dim)", text: "has: " + [...has].join(", ") }) : null,
    ]);
    listHost.appendChild(rowEl);
    return { s, cb, has };
  });
  m.appendChild(listHost);

  // estimated cost + balance (like the sprite generator). Each checked sprite is
  // animated once per distinct facing; animate-with-text-v3 (128px × 8 frames) is
  // ~2 generations per facing (estimate — the v3 endpoint publishes no formula).
  const AN_GENS_PER_DIR = 2;
  const cost = (typeof costEstimateBlock === "function") ? costEstimateBlock(() => {
    let gens = 0; rows.forEach(r => { if (r.cb.checked) gens += (((r.s.node.animDirs && r.s.node.animDirs.length) || 1) * AN_GENS_PER_DIR); });
    return { gens, exact: false };
  }) : null;
  if (cost) { rows.forEach(r => r.cb.addEventListener("change", cost.refresh)); m.appendChild(cost.node); }

  const status = el("div.tagline", { style: "min-height:1.2em" });
  const go = el("button.btn.primary", { text: "Generate", onclick: async () => {
    const name = slug(nameIn.value.trim()); if (!name) return toast("Name the animation.", "warn");
    const prompt = promptIn.value.trim(); if (!prompt) return toast("Enter an animation prompt.", "warn");
    const chosen = rows.filter(r => r.cb.checked); if (!chosen.length) return toast("Check at least one sprite.", "warn");
    const clash = chosen.filter(r => r.has.has(name)).map(r => r.s.id);
    if (clash.length) return toast("“" + name + "” already exists on: " + clash.join(", "), "err", 6000);
    go.disabled = true;
    let ok = 0, fail = 0;
    for (const r of chosen) {
      // animate only the sprite's genuinely distinct facings (8 for a directional
      // sprite, 1 for a mirrored billboard / single-frame icon) — no wasted calls.
      const idxs = (r.s.node.animDirs && r.s.node.animDirs.length) ? r.s.node.animDirs : [0];
      try {
        const dirs = {};
        for (let j = 0; j < idxs.length; j++) {
          const idx = idxs[j];
          status.textContent = "Animating " + r.s.id + " · " + (DIR_SHORT[DIRS8[idx]] || ("f" + idx)) + " (" + (ok + fail + 1) + "/" + chosen.length + ")…";
          const cv = el("canvas", { width: 128, height: 128 }); r.s.node.draw(cv, idx); await sleep(120);
          const first = { type: "base64", base64: dataUrlToB64(cv.toDataURL("image/png")), format: "png" };
          dirs[DIRS8[idx] || ("f" + idx)] = await PixelLab.animate(first, prompt, 8);
        }
        await saveSpriteAnim(r.s.id, name, { dirs });
        r.has.add(name); ok++;
      } catch (_) { fail++; }
    }
    go.disabled = false;
    status.textContent = "";
    toast("Generated “:" + name + "” for " + ok + " sprite" + (ok === 1 ? "" : "s") + (fail ? " · " + fail + " failed" : "") + " — saved to drafts.", ok ? "ok" : "err", 6000);
    if (ok && !fail) bg.remove();
  } });
  m.appendChild(el("div.btn-row", { style: "margin-top:.4rem" }, [go, status]));
  bg.appendChild(m); document.body.appendChild(bg);
}

// ---- rule vocabulary + serialization (votable + community-proposable) ----
// Item conditions take an item_id instance; the rest are the game's real
// state / lifecycle / movement conditions (GameTriggers.conditions()).
const RULE_ITEM_CONDS = [
  { v: "equip_item", label: "Equips / wears item", item: true },
  { v: "unequip_item", label: "Removes / unequips item", item: true },
  { v: "eat_food", label: "Eats food", item: true },
  { v: "drink_potion", label: "Drinks a potion / drink", item: true },
  { v: "use_item", label: "Uses item", item: true },
  { v: "pick_up_item", label: "Picks up item", item: true },
];
const RULE_WHEN_VERB = { equip_item: "Equips / wears", unequip_item: "Removes", eat_food: "Eats", drink_potion: "Drinks", use_item: "Uses", pick_up_item: "Picks up" };
function ruleConditions(type) {
  const base = (typeof GameTriggers !== "undefined") ? GameTriggers.conditions() : ["idle", "in_combat", "on_death"];
  const stateConds = base.map(c => ({ v: c, label: c.replace(/_/g, " "), item: false }));
  return type === "character" ? RULE_ITEM_CONDS.concat(stateConds) : stateConds;   // item conds are a character/player thing
}
// human WHEN label (folds the item_id into item conditions)
function ruleWhenText(rule) {
  if (rule.whenText) return rule.whenText;
  if (rule.item && RULE_WHEN_VERB[rule.when]) return RULE_WHEN_VERB[rule.when] + " " + rule.item;
  return String(rule.when || "").replace(/_/g, " ");
}
// stable vote-field id — proposal-id based for community rules, canonical for defaults
function ruleField(rule) {
  if (rule.proposalId) return "rule:proposed:" + rule.proposalId;
  const then = (rule.action === "anim" ? "anim:" : "sprite:") + rule.target;
  return ("rule:" + (rule.whenKey || rule.when || "") + ":" + then).replace(/\s+/g, "_");
}
// the entity's auto-derived DEFAULT rules (sprite-change + animation), unified
function defaultRules(type, entry, menuKind) {
  const rules = [];
  spriteRulesForEntity(type, entry, menuKind).forEach(r => rules.push({
    action: "sprite", whenKey: r.whenKey, whenText: r.when, target: r.sprite, isDefaultSprite: r.isDefault, source: "default",
  }));
  const sids = animSpriteIds(type, entry);
  animRulesForType(type).forEach(a => sids.forEach(sid => rules.push({
    action: "anim", whenKey: a.anim, whenText: a.when, target: sid + ":" + a.anim, source: "default",
  })));
  return rules;
}
// community-proposed rules for this subject (schema taiao-sprite-rule/1)
async function loadCommunityRules(type, key) {
  let metas = []; try { metas = (typeof Taiao !== "undefined" && Taiao.listCostumes) ? await Taiao.listCostumes(type, key) : []; } catch (_) {}
  const full = await Promise.all((metas || []).map(async m => {
    let f = null; try { f = await Taiao.getCostume(m.id); } catch (_) {}
    const pl = f && f.payload, rule = (pl && pl.schema === "taiao-sprite-rule/1") ? pl.rule : null;
    return rule ? { action: rule.action, when: rule.when, item: rule.item, target: rule.target, sprite: rule.sprite, anim: rule.anim, proposalId: m.id, username: m.username, source: "community" } : null;
  }));
  return full.filter(Boolean);
}
// the "add a rule" form → submits a taiao-sprite-rule/1 proposal for keep/remove voting
function proposeRuleForm(type, key, defId, onAdded) {
  const box = el("div.card", { style: "background:var(--bg-2);margin-top:.8rem" });
  box.appendChild(el("h3", { style: "font-size:.92rem", text: "Add a rule" }));
  box.appendChild(el("p.tagline", { text: "WHEN a condition fires, THEN change the sprite or play an animation. Any studio sprite id / animation works. The community votes it keep/remove." }));
  const fld = (label, node) => el("label.field", { style: "margin:0;flex:1;min-width:13rem" }, [el("span", { text: label }), node]);
  // WHEN
  const conds = ruleConditions(type);
  const whenSel = el("select"); conds.forEach(c => whenSel.appendChild(el("option", { value: c.v, text: c.label })));
  const itemWrap = el("span"); let itemInp = null;
  function buildItem() {
    clear(itemWrap); const c = conds.find(x => x.v === whenSel.value);
    if (c && c.item) { itemDatalist(); itemInp = el("input.vote-input", { placeholder: "item id", style: "width:12rem", autocomplete: "off" }); itemInp.setAttribute("list", "action-item-ids"); itemWrap.appendChild(itemInp); }
    else itemInp = null;
  }
  whenSel.onchange = buildItem; buildItem();
  // THEN
  const actSel = el("select"); [["sprite", "change sprite → sprite id"], ["anim", "play animation → sprite id:anim"]].forEach(([v, l]) => actSel.appendChild(el("option", { value: v, text: l })));
  const spInp = el("input.vote-input", { placeholder: "sprite id", style: "width:12rem", autocomplete: "off", value: defId || "" }); spInp.setAttribute("list", studioSpriteDatalist());
  const anWrap = el("span"); let anInp = null;
  function buildAnim() {
    clear(anWrap);
    if (actSel.value === "anim") { anInp = el("input.vote-input", { placeholder: "animation", style: "width:9rem", autocomplete: "off", value: "idle" }); anInp.setAttribute("list", studioAnimDatalist()); anWrap.appendChild(el("span.mono", { style: "font-weight:700", text: ":" })); anWrap.appendChild(anInp); }
    else anInp = null;
  }
  actSel.onchange = buildAnim; buildAnim();
  box.appendChild(el("div", { style: "display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end" }, [
    fld("When", el("span", { style: "display:inline-flex;gap:.3rem;flex-wrap:wrap;align-items:center" }, [whenSel, itemWrap])),
    fld("Then", el("span", { style: "display:inline-flex;gap:.3rem;flex-wrap:wrap;align-items:center" }, [actSel, spInp, anWrap])),
  ]));
  const btn = el("button.btn.primary.sm", { style: "margin-top:.5rem", text: "Add rule" });
  btn.onclick = async () => {
    if (!Taiao.logged()) { toast("Sign in to add a rule.", "warn"); App.go("#/settings"); return; }
    const c = conds.find(x => x.v === whenSel.value);
    const item = (c && c.item && itemInp) ? itemInp.value.trim() : null;
    if (c && c.item && !item) { toast("Enter an item id.", "warn"); return; }
    const sprite = spInp.value.trim(); if (!sprite) { toast("Enter a sprite id.", "warn"); return; }
    const action = actSel.value; let target = sprite, anim = null;
    if (action === "anim") { anim = anInp ? anInp.value.trim() : ""; if (!anim) { toast("Enter an animation.", "warn"); return; } target = sprite + ":" + anim; }
    const rule = { when: whenSel.value, item, action, target, sprite, anim };
    const title = "Rule: " + (item ? whenSel.value + "(" + item + ")" : whenSel.value) + " → " + (action === "anim" ? "anim " + target : "sprite " + target);
    btn.disabled = true;
    const r = await Taiao.submitProposal(type, key, title, { schema: "taiao-sprite-rule/1", object: { type, key }, rule }, "data");
    btn.disabled = false;
    if (r && r.ok) {
      toast(r.status === "pending"
        ? "Submitted — a moderator will review it before it appears for voting."
        : "Rule added for voting!", "ok");
      if (itemInp) itemInp.value = ""; onAdded && onAdded();
    } else toast((r && r.error) || "Couldn't add the rule.", "err", 5000);
  };
  box.appendChild(btn);
  return box;
}

// The card: every rule (auto-derived defaults + community-proposed) with a
// keep/remove vote, plus an "add a rule" form (which can call in any studio
// sprite id). Always rendered for the four entity types.
function spriteAnimRulesSection(page, type, entry, menuKind) {
  const subjectKey = entry.folder || entry.key;
  const card = el("div.card");
  card.appendChild(el("div.sectitle", null, [el("h3", null, ["Sprite & animation rules ", el("span.hint", { text: "vote keep/remove · add your own" })])]));
  const th = "border-bottom:1px solid var(--line,#333);padding:.4rem .55rem;text-align:left;font-size:.7rem;letter-spacing:.02em;color:var(--ink-dim);white-space:nowrap";
  const td = "border-bottom:1px solid var(--line,#222);padding:.5rem .55rem;font-size:.82rem;vertical-align:top";
  const mono = (txt, gold) => el("span.mono", { style: "font-size:.76rem" + (gold ? ";color:var(--gold)" : ""), text: txt });
  const defId = entitySpriteId(type, entry);
  card.appendChild(el("p.tagline", { style: "font-size:.74rem;margin:.1rem 0 .5rem" }, [
    "Default sprite: ", mono(String(defId || "—"), true),
    ". Animations are called ", mono("<sprite id>:<animation>", true), " — e.g. ", mono(defId + ":idle"),
    ". Any studio sprite id works, not just this entity's own. Vote keep/remove on any rule, or add your own below.",
  ]));

  // shared keep/remove ballot for the whole subject (fields are namespaced "rule:…")
  const state = {
    tallies: {}, cells: [],
    refetch: async () => {
      try { state.tallies = (typeof Taiao !== "undefined" && Taiao.tally) ? (await Taiao.tally(type, subjectKey) || {}) : {}; } catch (_) {}
      state.cells.forEach(fn => { try { fn(); } catch (_) {} });
    },
  };
  const voteCell = rule => VoteWidget.buttons({ kind: type, folder: subjectKey, field: ruleField(rule), label: "rule", getTallies: () => state.tallies, refetch: state.refetch, register: fn => state.cells.push(fn) });
  const thenCell = rule => el("span", { style: "display:inline-flex;align-items:center;gap:.35rem" }, [
    el("span.badge", { text: rule.action === "anim" ? "anim" : "sprite" }),
    mono(rule.target, rule.action === "sprite" && rule.isDefaultSprite),
  ]);
  const sourceCell = rule => rule.source === "default"
    ? el("span.badge", { text: "default" })
    : el("small.credit", null, ["by ", el("span.u", { text: rule.username || "someone" })]);
  const addRow = (body, rule) => body.appendChild(el("tr", null, [
    el("td", { style: td, text: ruleWhenText(rule) }),
    el("td", { style: td }, [thenCell(rule)]),
    el("td", { style: td }, [sourceCell(rule)]),
    el("td", { style: td }, [voteCell(rule)]),
  ]));

  const table = el("table", { style: "border-collapse:collapse;width:100%" });
  table.appendChild(el("tr", null, ["When", "Then", "Source", "Vote"].map(h => el("th", { style: th, text: h }))));
  const bodyDefault = el("tbody"); const bodyCommunity = el("tbody");
  table.appendChild(bodyDefault); table.appendChild(bodyCommunity);
  defaultRules(type, entry, menuKind).forEach(r => addRow(bodyDefault, r));
  card.appendChild(el("div", { style: "overflow-x:auto" }, [table]));

  // load community rules, then (re)load the ballot tallies
  const reload = async () => {
    const rules = await loadCommunityRules(type, subjectKey);
    clear(bodyCommunity); rules.forEach(r => addRow(bodyCommunity, r));
    await state.refetch();
  };
  card.appendChild(proposeRuleForm(type, subjectKey, defId, reload));
  state.refetch(); reload();

  page.appendChild(card);
}

// ---- character: INSTANCE (gameplay page) — classification/stats, triggers, actions ----
function renderCharacterInstance(page, provider, entry) {
  const vc = el("div.card");
  vc.appendChild(el("h3", null, ["Classification & stats ", el("span.hint", { text: "vote on what it should be" })]));
  vc.appendChild(el("p.tagline", null, ["Sprite source: ", spriteSourceLink("character", entry, provider)]));
  vc.appendChild(el("p.tagline", null, ["Currently tagged ", el("b", { text: Roster.classOf(entry) }), ". Vote if you think a stat should change."]));
  const stats = Roster.stats(entry);
  const specs = [];
  if (stats) {
    const statLine = el("dl.kv", { style: "margin:.6rem 0" }, [
      el("dt", { text: "Height" }), el("dd", { text: "×" + stats.h.toFixed(2) }),
      el("dt", { text: "Width" }), el("dd", { text: "×" + stats.w.toFixed(2) }),
      el("dt", { text: "Weight" }), el("dd", { text: "×" + stats.weight.toFixed(2) }),
      el("dt", { text: "Speed" }), el("dd", { text: "×" + stats.speed.toFixed(2) }),
      el("dt", { text: "Toughness" }), el("dd", { text: (stats.tough * 100).toFixed(0) + "% dmg soak" }),
    ]);
    const xpKeys = Object.keys(stats.xp || {}).filter(k => Math.abs(stats.xp[k] - 1) > 0.001);
    if (xpKeys.length) statLine.appendChild(el("dt", { text: "XP aptitudes" })), statLine.appendChild(el("dd", { text: xpKeys.map(k => k + " ×" + stats.xp[k].toFixed(2)).join(", ") }));
    vc.appendChild(statLine);
    const statNow = { height: "×" + stats.h.toFixed(2), weight: "×" + stats.weight.toFixed(2), speed: "×" + stats.speed.toFixed(2), toughness: (stats.tough * 100).toFixed(0) + "%" };
    ["height", "weight", "speed", "toughness"].forEach(s => specs.push({ field: "stat:" + s, label: s[0].toUpperCase() + s.slice(1), currentValue: statNow[s], current: "current", choices: STAT_DELTAS, numeric: true }));
  }
  const votesHost = el("div"); vc.appendChild(votesHost);
  renderVotes(votesHost, entry.type, entry.key, specs);
  page.appendChild(vc);

  // triggers/events + (NPCs only) a right-click Action menu
  entitySpritesSection(page, "character", entry, entry.npc ? "npc" : "player");
  spriteAnimRulesSection(page, "character", entry, entry.npc ? "npc" : "player");
  soundsSection(page, "character", entry.folder, entry.npc ? "npc" : "player");
  triggersSection(page, "character", entry.folder);
  if (entry.npc) actionMenuSection(page, "character", entry.folder, "npc");
}

const TRIG_CAT_TITLES = { animation: "Animation triggers", state: "State-change triggers", lifecycle: "Despawn / respawn triggers", sound: "Sound-effect triggers", movement: "Movement triggers" };

// The concrete target a chosen game event acts on (the third dropdown). All
// drawn from real game data; events without a natural target return null.
function eventInstances(type, event) {
  if (event === "play_sound") return (typeof GameTriggers !== "undefined") ? GameTriggers.sounds() : [];
  if (event === "spawn") { const m = Providers.get("monster"); return m ? [...new Set(m.list().map(e => e.baseKey || e.key))] : []; }
  if (event === "give_item" || event === "drop_loot") return (typeof ITEMS !== "undefined") ? Object.keys(ITEMS) : [];
  if (event === "reward_xp") return (typeof SKILLS !== "undefined") ? SKILLS.slice() : [];
  if (event === "give_quest" || event === "advance_quest") return null;   // no quest registry here
  return null;   // aggro / flee / heal / open / close / teleport … — no instance
}

// Fetch every shared proposal for a subject and pull out the pieces the
// triggers/animations views need.
async function fetchSubjectExtras(type, key) {
  let props = []; try { props = await Taiao.listCostumes(type, key); } catch (_) {}
  const payloads = await Promise.all(props.map(p => Taiao.getCostume(p.id).catch(() => null)));
  const anims = [], trigsE = [], trigsS = [], cats = {}, rules = [];
  for (const pr of payloads) {
    const pl = pr && pr.payload; if (!pl) continue;
    (pl.anims || []).forEach(a => anims.push({ ...a, by: pr.username }));
    const d = pl.design || {};
    (d.eventTriggers || []).forEach(t => { if (t && (t.a || t.b)) trigsE.push({ ...t, by: pr.username }); });
    (d.stateTriggers || []).forEach(t => { if (t && (t.a || t.b)) trigsS.push({ ...t, by: pr.username }); });
    const tg = d.triggers || {}; for (const k in tg) (cats[k] = cats[k] || []).push(...(tg[k] || []).map(x => ({ ...x, by: pr.username })));
    if (pl.rule && pl.rule.trigger) rules.push({ ...pl.rule, by: pr.username });
  }
  return { anims, trigsE, trigsS, cats, rules };
}

function renderTriggers(host, ex) {
  ex = ex || {}; clear(host);
  let any = false;
  const rules = ex.rules || [];
  if (rules.length) {
    any = true;
    host.appendChild(el("h3", { style: "font-size:.9rem;margin-top:.4rem", text: "Proposed triggers" }));
    const list = el("div.triglist");
    rules.forEach(r => list.appendChild(el("div.rule", null, [
      el("span.mono", { text: r.trigger }), el("span.rule-arrow", { text: "→" }),
      el("span.mono", { text: r.event + (r.instance ? "(" + r.instance + ")" : "") }),
      el("small.credit", null, ["by ", el("span.u", { text: r.by || "?" })]),
    ])));
    host.appendChild(list);
  }
  for (const key of ["animation", "state", "lifecycle", "sound", "movement"]) {
    const arr = (ex.cats && ex.cats[key]) || []; if (!arr.length) continue; any = true;
    host.appendChild(el("h3", { style: "font-size:.9rem;margin-top:.4rem", text: TRIG_CAT_TITLES[key] }));
    const list = el("div.triglist");
    arr.forEach(t => list.appendChild(el("div.trig", null, [el("div.mono", { text: t.t || "—" }), el("div", { text: t.cond || "" }), el("small.credit", null, ["by ", el("span.u", { text: t.by || "?" })])])));
    host.appendChild(list);
  }
  const legacy = (title, arr) => { if (!arr || !arr.length) return; any = true; host.appendChild(el("h3", { style: "font-size:.9rem;margin-top:.4rem", text: title })); const l = el("div.triglist"); arr.forEach(t => l.appendChild(el("div.trig", null, [el("div", { text: t.a || "—" }), el("div", { text: t.b || "—" }), el("small.credit", null, ["by ", el("span.u", { text: t.by || "?" })])]))); host.appendChild(l); };
  legacy("Animation-event triggers", ex.trigsE);
  legacy("State-change triggers", ex.trigsS);
  if (!any) host.appendChild(el("p.tagline", { text: "No triggers proposed yet — propose one below." }));
}

// The propose-a-trigger form: Trigger → Event → Instance (instance dropdown
// rebuilds when the event changes, type-scoped).
function proposeTriggerForm(host, type, key, onProposed) {
  const box = el("div.card", { style: "background:var(--bg-2);margin-top:.8rem" });
  box.appendChild(el("h3", { style: "font-size:.92rem", text: "Propose a trigger" }));
  box.appendChild(el("p.tagline", { text: "WHEN a condition fires, THEN an event happens. Pick each from the dropdowns." }));
  const sel = opts => { const s = el("select"); (opts || []).slice(0, 4000).forEach(o => s.appendChild(el("option", { value: o, text: o }))); return s; };
  const trigSel = sel(typeof GameTriggers !== "undefined" ? GameTriggers.conditions() : []);
  const evSel = sel(typeof GameTriggers !== "undefined" ? GameTriggers.events(type) : []);
  const instWrap = el("div"); let instSel = null;
  function buildInstance() {
    clear(instWrap);
    const opts = eventInstances(type, evSel.value);
    if (!opts || !opts.length) { instSel = null; instWrap.appendChild(el("small.tagline", { text: "— no instance —" })); return; }
    instSel = sel(opts); instWrap.appendChild(instSel);
  }
  evSel.onchange = buildInstance; buildInstance();
  box.appendChild(el("div.trig", null, [
    el("label.field", { style: "margin:0" }, [el("span", { text: "Trigger (when)" }), trigSel]),
    el("label.field", { style: "margin:0" }, [el("span", { text: "Event" }), evSel]),
    el("label.field", { style: "margin:0" }, [el("span", { text: "Instance" }), instWrap]),
  ]));
  const btn = el("button.btn.primary.sm", { style: "margin-top:.5rem", text: "Propose", onclick: async () => {
    if (!Taiao.logged()) { toast("Sign in to propose a trigger.", "warn"); App.go("#/settings"); return; }
    const rule = { trigger: trigSel.value, event: evSel.value, instance: instSel ? instSel.value : null };
    btn.disabled = true;
    const title = "Trigger: " + rule.trigger + " → " + rule.event + (rule.instance ? "(" + rule.instance + ")" : "");
    const r = await Taiao.submitProposal(type, key, title, { schema: "taiao-trigger/1", object: { type, key }, rule }, "data");
    btn.disabled = false;
    if (r.ok) {
      toast(r.status === "pending"
        ? "Submitted — a moderator will review it before it appears for voting."
        : "Trigger proposed!", "ok");
      onProposed && onProposed();
    } else toast(r.error || "Couldn't propose.", "err", 5000);
  } });
  box.appendChild(btn);
  host.appendChild(box);
}

// Reusable Triggers & events section (list of proposed triggers + propose form).
function triggersSection(page, type, key) {
  const card = el("div.card");
  card.appendChild(el("h3", null, ["Triggers & events ", el("span.hint", { text: "propose conditions → events" })]));
  const body = el("div", null, [el("div.center-col", null, [el("div.spinner"), el("small", { text: "Loading…" })])]);
  const formHost = el("div");
  card.appendChild(body); card.appendChild(formHost); page.appendChild(card);
  const refresh = async () => { renderTriggers(body, await fetchSubjectExtras(type, key)); };
  refresh();
  proposeTriggerForm(formHost, type, key, refresh);
  return { body, refresh };
}

// ---------------- Action menu (the right-click menu) ----------------
const ACTION_EVENTS = ["start_combat", "start_dialogue", "open_shop", "open_bank", "gather", "pick_up", "open", "close", "enter", "use", "examine_text", "start_animation", "play_sound", "change_state", "none"];
const GATHER_VERBS = { Woodcutting: "Chop", Mining: "Mine", "Ore-mining": "Mine", "Gem-mining": "Mine", "Stone-mining": "Mine", Fishing: "Fish at", Foraging: "Forage" };

// Real right-click actions for an asset, sourced from the game's data
// (NODE_TYPES gather nodes, STATIONS craft stations, MONSTERS, MIX NPCs), each
// with its actual visibility gate (tool in inventory / skill level).
function gameActionsFor(type, key, menuKind) {
  const A = [];   // { name, event, gate: {kind,item?,skill?,lvl?} | null }
  const itemName = id => (typeof ITEMS !== "undefined" && ITEMS[id] && ITEMS[id].name) || id;
  if (menuKind === "monster") {
    A.push({ name: "Attack", event: "start_combat", gate: null });
    A.push({ name: "Examine", event: "examine_text", gate: null });
  } else if (menuKind === "npc") {
    A.push({ name: "Talk-to", event: "start_dialogue", gate: null });
    A.push({ name: "Trade-with", event: "open_shop", gate: { kind: "trader" } });
    A.push({ name: "Examine", event: "examine_text", gate: null });
  } else {
    // gatherable node? (a NODE_TYPES entry whose sprite key IS this object) → action #1
    if (typeof NODE_TYPES !== "undefined") {
      const nt = Object.values(NODE_TYPES).find(n => n && n.spr === key);
      if (nt) A.push({ name: (GATHER_VERBS[nt.skill] || nt.gatherVerb || "Gather") + " " + nt.name, event: "gather", gate: { kind: "node", item: nt.tool || null, itemLabel: nt.tool ? itemName(nt.tool) : null, skill: nt.skill, lvl: nt.req } });
    }
    // craft station?
    if (typeof STATIONS !== "undefined" && STATIONS[key]) {
      const st = STATIONS[key];
      A.push({ name: st.action || "Use", event: "open_station", gate: (st.lists && st.lists.length) ? { kind: "station", skills: st.lists } : (st.alchemy ? { kind: "station", skills: ["Alchemy"] } : null) });
    }
    if (/bank|chest/.test(key)) A.push({ name: "Bank", event: "open_bank", gate: null });
    if (/door|gate/.test(key)) { A.push({ name: "Open", event: "open", gate: null }); A.push({ name: "Close", event: "close", gate: null }); }
    A.push({ name: "Examine", event: "examine_text", gate: null });
  }
  A.push({ name: "Walk here", event: "none", gate: null });
  A.push({ name: "Cancel", event: "none", gate: null });
  return A;
}
function gateText(g) {
  if (!g) return "always visible";
  if (typeof g === "string") {   // a community-proposed serialized gate
    const [k, a, b] = g.split(":");
    if (k === "has_item") return "if " + ((typeof ITEMS !== "undefined" && ITEMS[a] && ITEMS[a].name) || a) + " in inventory";
    if (k === "skill") return "if " + a + " ≥ " + (b || 1);
    if (k === "quest") return "if quest done: " + a;
    return g;
  }
  if (g.kind === "node") return [g.item ? "has " + (g.itemLabel || g.item) + " in inventory" : "", g.skill ? (g.skill + " ≥ " + g.lvl) : ""].filter(Boolean).join(" · ") || "always";
  if (g.kind === "station") return "needs " + (g.skills || []).map(Roster.prettyName).join(" / ");
  if (g.kind === "trader") return "if the NPC is a trader";
  return "always";
}
// one shared datalist of item ids for the "has item" gate
let _itemDL = null;
function itemDatalist() {
  if (_itemDL) return _itemDL;
  _itemDL = el("datalist", { id: "action-item-ids" });
  try { if (typeof ITEMS !== "undefined") Object.keys(ITEMS).forEach(id => _itemDL.appendChild(el("option", { value: id }))); } catch (_) {}
  document.body.appendChild(_itemDL);
  return _itemDL;
}
// suggestions for the "add your own event" combobox
let _eventDL = null;
function eventDatalist() {
  if (_eventDL) return _eventDL;
  _eventDL = el("datalist", { id: "action-events" });
  ACTION_EVENTS.forEach(ev => _eventDL.appendChild(el("option", { value: ev })));
  document.body.appendChild(_eventDL);
  return _eventDL;
}

function actionMenuSection(page, type, key, menuKind) {
  itemDatalist();
  const card = el("div.card");
  card.appendChild(el("div.sectitle", null, [el("h3", null, ["Action menu ", el("span.hint", { text: "the real right-click menu — vote, reorder, gate & add actions" })])]));
  const body = el("div", null, [el("div.center-col", null, [el("div.spinner"), el("small", { text: "Loading…" })])]);
  card.appendChild(body); page.appendChild(card);
  const state = { t: {} };
  const load = async () => { try { state.t = await Taiao.tally(type, key); } catch (_) {} render(); };
  const gameActs = gameActionsFor(type, key, menuKind);
  const defaults = gameActs.map(a => a.name);
  const byName = Object.fromEntries(gameActs.map(a => [a.name, a]));

  const orderScore = (s, defIdx) => {
    const t = state.t["action:" + s + ":order"]; if (!t) return defIdx;
    let sum = 0, n = 0; for (const k in t) { const v = parseFloat(k); if (!isNaN(v)) { sum += v * t[k]; n += t[k]; } }
    return n ? sum / n : defIdx;
  };
  const aVote = o => VoteWidget.symbol(Object.assign({ kind: type, folder: key, getTallies: () => state.t, refetch: load }, o));
  // per-action visibility gate: current gate + a 🗳 hosting the gate builder
  // (has-item / skill-level / quest) and the community-proposed gates.
  function gateEditor(block, s, action) {
    const gfield = "action:" + s + ":gate";
    block.appendChild(el("div.mgrow", null, [el("div.mglabel", { text: "visible when" }), el("span", { style: "display:inline-flex;align-items:center;gap:.4rem" }, [
      el("div.mono", { style: "color:var(--gold)", text: gateText(action ? action.gate : null) }),
      aVote({ field: gfield, label: "visibility gate", hideTally: true, render: (pop, api) => buildGateBody(pop, api, gfield) }),
    ])]));
  }
  function buildGateBody(pop, api, gfield) {
    const gcounts = state.t[gfield] || {}, gmine = Taiao.myVote(type, key, gfield);
    const keys = Object.keys(gcounts).sort((a, b) => gcounts[b] - gcounts[a]);
    if (keys.length) {
      const gchips = el("div.vote-pop-tally");
      keys.forEach(g => gchips.appendChild(el("span.chip.sm" + (gmine === g ? ".on" : ""), { html: escapeHtml(gateText(g)) + " <b>" + gcounts[g] + "</b>", onclick: () => api.submit(g) })));
      pop.appendChild(gchips);
    }
    const tSel = el("select"); [["", "— add a gate —"], ["has_item", "has item"], ["skill", "skill level"], ["quest", "quest done"]].forEach(([v, l]) => tSel.appendChild(el("option", { value: v, text: l })));
    const valHost = el("span", { style: "display:inline-flex;gap:3px;flex-wrap:wrap" });
    function buildVal() {
      clear(valHost); valHost._get = () => "";
      if (tSel.value === "has_item") { itemDatalist(); const i = el("input.chip-input", { placeholder: "item id", style: "width:130px" }); i.setAttribute("list", "action-item-ids"); valHost._get = () => i.value.trim() ? "has_item:" + i.value.trim() : ""; valHost.appendChild(i); }
      else if (tSel.value === "skill") { const sk = el("select"); (typeof SKILLS !== "undefined" ? SKILLS : []).forEach(k => sk.appendChild(el("option", { value: k, text: k }))); const lv = el("input.chip-input", { type: "number", placeholder: "lvl", style: "width:56px" }); valHost._get = () => sk.value ? "skill:" + sk.value + ":" + (lv.value || 1) : ""; valHost.appendChild(sk); valHost.appendChild(lv); }
      else if (tSel.value === "quest") { const q = el("input.chip-input", { placeholder: "quest", style: "width:130px" }); valHost._get = () => q.value.trim() ? "quest:" + q.value.trim() : ""; valHost.appendChild(q); }
    }
    tSel.onchange = buildVal; buildVal();
    const gAdd = el("button.btn.sm.primary", { text: "Propose gate", onclick: () => { const g = (valHost._get && valHost._get()) || ""; if (!g) return toast("Pick a condition.", "warn"); api.submit(g); } });
    pop.appendChild(el("div", { style: "margin-top:.4rem" }, [tSel, valHost, el("div.btn-row", { style: "margin-top:.4rem" }, [gAdd])]));
  }
  function render() {
    clear(body);
    const custom = Object.keys(state.t["action_custom"] || {});
    const actions = [...new Set(defaults.concat(custom))];
    const defIdx = a => { const i = defaults.indexOf(a); return i < 0 ? 100 + custom.indexOf(a) : i; };
    actions.sort((a, b) => orderScore(slug(a), defIdx(a)) - orderScore(slug(b), defIdx(b)));
    const evChoices = (typeof ACTION_EVENTS !== "undefined" ? ACTION_EVENTS : []);
    actions.forEach((a, idx) => {
      const s = slug(a), action = byName[a], isCustom = !action;
      const block = el("div.card", { style: "background:var(--bg-2);margin-bottom:.5rem;padding:.6rem .8rem" });
      block.appendChild(el("h3", { style: "font-size:.9rem;margin-bottom:.3rem" }, [(idx + 1) + ". " + a, isCustom ? el("span.badge", { style: "margin-left:.4rem", text: "custom" }) : null].filter(Boolean)));
      block.appendChild(el("div.mgrow", null, [el("div.mglabel", { text: "keep this action?" }),
        aVote({ field: "action:" + s + ":keep", type: "select", choices: ["keep", "remove"], current: "keep", currentLabel: "keep", label: "keep this action?" })]));
      block.appendChild(el("div.mgrow", null, [el("div.mglabel", { text: "triggers event" }),
        aVote({ field: "action:" + s + ":event", type: "select", choices: evChoices, current: action ? action.event : undefined, currentLabel: action ? action.event : "—", custom: true, customPlaceholder: "type an event…", label: "triggers event" })]));
      gateEditor(block, s, action);
      block.appendChild(el("div.mgrow", null, [el("div.mglabel", { text: "display order (now #" + (idx + 1) + ")" }),
        aVote({ field: "action:" + s + ":order", type: "number", min: 1, current: idx + 1, currentLabel: "#" + (idx + 1), label: "display order" })]));
      body.appendChild(block);
    });
    body.appendChild(el("div.mgrow", { style: "margin-top:.6rem" }, [el("div.mglabel", { text: "add an action" }),
      aVote({ field: "action_custom", type: "string", placeholder: "new action, e.g. Pickpocket", label: "add an action" })]));
  }
  load();
}

// ---------------- generic preview (object/monster/tile/ui/sound) ----------------
function renderGenericPreview(page, provider, entry) {
  const pc = el("div.card");
  pc.appendChild(el("h3", { text: "Preview" }));
  if (provider.isAudio) {
    const audio = el("audio", { controls: true, src: provider.audioSrc(entry), style: "width:100%" });
    pc.appendChild(el("div.center-col", null, [el("div", { style: "font-size:3rem", text: "🔊" }), audio]));
    pc.appendChild(el("p.tagline", { html: "File: <span class='mono'>" + escapeHtml(entry.file) + "</span>" }));
  } else if (provider.dirs && (!provider.isDir || provider.isDir(entry))) {
    const grid = el("div.dirgrid");
    DIRS8.forEach((d, di) => { const cv = el("canvas.spr"); provider.draw(cv, entry, di); grid.appendChild(el("div.dircell", null, [cv, el("div.lbl", { text: DIR_SHORT[d] })])); });
    pc.appendChild(grid);
  } else {
    const cv = el("canvas.spr", { style: "width:220px;height:220px" });
    provider.draw(cv, entry, 0);
    pc.appendChild(el("div.center-col", null, [cv]));
  }
  page.appendChild(pc);
}

// ---------------- item preview: icon + icon voting / add-your-own ----------------
// The item's icon lives here (not in Properties). Three ways to change it:
// vote to reuse another item's icon, upload your own, or generate one with
// PixelLab — the latter two publish as community proposals people can vote on.
function renderItemPreview(page, provider, entry, ctx) {
  const { id, name, type, key } = ctx;
  const pc = el("div.card");
  pc.appendChild(el("div.sectitle", null, [el("h3", { text: "Preview" }), el("span.hint", { text: "vote on the icon, or add your own" })]));

  const cv = el("canvas.spr", { style: "width:160px;height:160px" });
  try { provider.draw(cv, entry, 0); } catch (_) {}
  pc.appendChild(el("div.center-col", null, [cv]));

  const curIcon = (typeof ITEMS !== "undefined" && ITEMS[id] && ITEMS[id].icon) || "";
  const reuseVote = VoteWidget.symbol({
    kind: type, folder: key, field: "icon", type: "item",
    current: "", currentLabel: curIcon || "—", label: "icon — reuse another item's icon",
    placeholder: "item id whose icon to use…", getTallies: ctx.getTallies, refetch: ctx.refetch,
  });

  const fileInp = el("input", { type: "file", accept: "image/*", style: "display:none" });
  const uploadBtn = el("button.btn.sm.ghost", { text: "⬆ Upload your own", onclick: () => fileInp.click() });
  const genBtn = el("button.btn.sm.ghost", { text: "🎨 Generate with PixelLab", onclick: () => openGenerateIconDialog() });
  const staging = el("div");
  const galleryHost = el("div");

  pc.appendChild(el("div", { style: "display:flex;flex-direction:column;gap:.55rem;align-items:center;margin-top:.7rem" }, [
    el("div", { style: "display:inline-flex;align-items:center;gap:.35rem;font-size:.82rem;color:var(--ink-dim)" }, [el("span", { text: "Vote to reuse another item's icon" }), reuseVote]),
    el("div.btn-row", null, [uploadBtn, genBtn]),
    fileInp, staging,
  ]));
  const genBoard = el("div");
  GenJobs.mountBoard(genBoard, { subject: Taiao.subjectFor("ui", key) });
  pc.appendChild(genBoard);
  pc.appendChild(galleryHost);
  page.appendChild(pc);

  function readFile(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Couldn't read that file.")); r.readAsDataURL(file); });
  }
  let stagedSource = "upload";   // provenance of the staged icon; drives moderation
  function stage(dataUrl, sourceLabel, source) {
    stagedSource = source === "pixellab" ? "pixellab" : "upload";
    clear(staging);
    if (!dataUrl) return;
    const prev = el("canvas", { width: 96, height: 96, style: "width:72px;height:72px;image-rendering:pixelated" });
    drawSprite(prev, dataUrl, 96);
    staging.appendChild(el("div", { style: "display:flex;flex-direction:column;align-items:center;gap:.4rem;margin-top:.2rem;padding:.55rem;border:1px dashed var(--line,#333);border-radius:8px" }, [
      el("small.tagline", { text: sourceLabel }), prev,
      el("div.btn-row", null, [
        el("button.btn.sm.primary", { text: "Publish for voting", onclick: () => publish(dataUrl) }),
        el("button.btn.sm.ghost", { text: "Discard", onclick: () => clear(staging) }),
      ]),
    ]));
  }
  fileInp.addEventListener("change", async () => {
    const f = fileInp.files && fileInp.files[0]; if (!f) return;
    try { stage(await readFile(f), "Your uploaded icon", "upload"); } catch (e) { toast(e.message || "Upload failed.", "err"); }
    fileInp.value = "";
  });
  function openGenerateIconDialog() {
    const bg = el("div.modal-bg", { onclick: e => { if (e.target === bg) bg.remove(); } });
    const m = el("div.modal");
    m.appendChild(el("span.x", { text: "×", onclick: () => bg.remove() }));
    m.appendChild(el("h2", { text: "Generate icon with PixelLab" }));
    const promptIn = el("textarea", { placeholder: "describe the icon…" });
    promptIn.value = name + ", a single game item icon";
    m.appendChild(el("label.field", null, [el("span", { text: "Prompt" }), promptIn]));
    const suggestBtn = el("button.btn.sm.ghost", {
      text: "✨ Suggest a prompt", onclick: () => {
        const s = GenJobs.suggest("item", { baseName: name });
        promptIn.value = s.prompt;
        suggestBtn.textContent = "🔁 Another suggestion";
      },
    });
    m.appendChild(el("div.btn-row", { style: "margin:-.3rem 0 .4rem" }, [suggestBtn]));
    const go = el("button.btn.primary", { text: "Generate" });
    m.appendChild(el("div.btn-row", { style: "margin-top:.4rem" }, [go, el("button.btn.ghost", { text: "Cancel", onclick: () => bg.remove() })]));
    go.onclick = () => {
      if (!Taiao.logged()) { toast("Sign in (Settings) to generate.", "warn"); return; }
      if (!PixelLab.hasKey()) { toast("Add your PixelLab key in Settings.", "warn"); return; }
      const desc = promptIn.value.trim() || (name + ", a single game item icon");
      bg.remove();
      GenJobs.execute(
        { spriteType: "ui", spriteId: id, label: name, subject: Taiao.subjectFor("ui", key), prompt: desc, pixellabKind: "image" },
        async () => { const url = await PixelLab.generateImage({ description: desc, size: 64, view: "high top-down" }); return { image: url }; }
      ).catch(e => toast("Generation failed: " + (e && e.message || e), "err", 7000));
      toast("Generating an icon — watch it in the card above.", "ok");
    };
    bg.appendChild(m); document.body.appendChild(bg);
  }
  async function publish(dataUrl) {
    if (!Taiao.logged()) { toast("Sign in to share.", "warn"); App.go("#/settings"); return; }
    const bundle = {
      schema: "taiao-costume/1", object: { type: "ui", key: id, name }, field: "icon",
      costume: { state: "icon", slot: "", item: "", note: "", dirs: { south: dataUrl } },
      exportedAt: new Date().toISOString(),
    };
    let provenance;
    if (stagedSource === "upload") {
      provenance = await askProvenance("icon");
      if (!provenance) return;   // Cancel aborts the publish
    }
    toast("Publishing…");
    const r = await Taiao.submitProposal("ui", id, name + " — icon", bundle, stagedSource, provenance);
    if (r && r.ok) {
      toast(r.status === "accepted"
        ? "⚡ Straight into the game — this filled a gap! It's now live for everyone, credited to you."
        : r.status === "pending"
        ? "Submitted — a moderator will review your uploaded icon before it appears for voting."
        : "Shared! The community can vote on it now.", "ok", 6000);
      clear(staging); renderGallery(galleryHost, "ui", id, name + " icon");
    } else toast((r && r.error) || "Couldn't publish.", "err", 6000);
  }

  renderGallery(galleryHost, "ui", id, name + " icon");
}

// ---------------- item page: every in-game field, viewable & votable ----------------
// Replaces the raw code-data dump for items. The six headline concepts (stack,
// consumable, wield/wear, drop, sell, place) plus name, and then every other
// field on the item's ITEMS entry, each as a vote row (subject gen:ui:<id>).
function renderItemDetail(page, provider, entry) {
  const id = entry.itemId || String(entry.key).replace(/^item:/, "");
  const it = (typeof ITEMS !== "undefined" && ITEMS[id]) || {};
  const type = "ui", key = id;
  const name = it.name || entry.name || Roster.prettyName(id);

  const state = { t: {} };
  const load = async () => { try { state.t = await Taiao.tally(type, key); } catch (_) {} render(); };

  // icon lives in the Preview section: vote to reuse another item's icon, upload
  // your own, or generate one with PixelLab — then publish it for community voting.
  renderItemPreview(page, provider, entry, { id, name, type, key, getTallies: () => state.t, refetch: load });

  const card = el("div.card");
  card.appendChild(el("div.sectitle", null, [el("h3", null, ["Properties ", el("span.hint", { text: "vote on every in-game field" })])]));
  const body = el("div", null, [el("div.center-col", null, [el("div.spinner"), el("small", { text: "Loading votes…" })])]);
  card.appendChild(body); page.appendChild(card);

  const avg = field => { const t = state.t[field]; if (!t) return null; let s = 0, n = 0; for (const k in t) { const v = parseFloat(k); if (!isNaN(v)) { s += v * t[k]; n += t[k]; } } return n ? s / n : null; };
  const prettifyKey = k => k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
  const prettySlot = s => s === "rune" ? "rune pouch" : String(s).replace(/_/g, " ").replace(/[0-9]+$/, "").trim();
  const slotText = ss => { const n = {}; ss.map(prettySlot).forEach(s => { n[s] = (n[s] || 0) + 1; }); return Object.keys(n).map(k => n[k] > 1 ? "both " + k + "s" : k).join(" + "); };

  // Each field is THREE grid cells — label, current value, and the 🗳 widget —
  // so every glyph lines up in its own right-aligned column across all rows.
  const glyphCell = w => el("div", { style: "justify-self:end" }, [w]);
  const rowCells = (label, current) => [
    el("div.mglabel", { style: "white-space:nowrap;overflow:hidden;text-overflow:ellipsis" }, [label]),
    el("span.mono", { style: "color:var(--gold);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text: (current != null && current !== "") ? String(current) : "—" }),
  ];
  const selectRow = (label, field, choices, current) =>
    rowCells(label, current).concat([glyphCell(VoteWidget.symbol({ kind: type, folder: key, field, type: "select", choices, current, currentLabel: current, label, getTallies: () => state.t, refetch: load }))]);
  const textRow = (label, field, current) =>
    rowCells(label, current).concat([glyphCell(VoteWidget.symbol({ kind: type, folder: key, field, type: "string", current: current != null ? String(current) : "", currentLabel: current != null ? String(current) : "—", label, getTallies: () => state.t, refetch: load }))]);
  const numRow = (label, field, current, unit) => {
    const a = avg(field), fmt = v => v != null ? (unit ? v + " " + unit : String(v)) : "—";
    return rowCells(label, fmt(current)).concat([glyphCell(VoteWidget.symbol({ kind: type, folder: key, field, type: "number", current: current != null ? current : "", currentLabel: fmt(current), note: a != null ? "community " + fmt(+a.toFixed(2)) : null, label, getTallies: () => state.t, refetch: load }))]);
  };

  // A 🗳 for an on/off field that carries a number when "on": pick off or on, and
  // an integer input appears only when "on". Votes cast the plain off-word or the
  // number, so tallies stay simple (e.g. "not edible" vs "12").
  const modeNumRow = (label, field, opts) => {
    const widget = VoteWidget.symbol({
      kind: type, folder: key, field, label, hideTally: true, getTallies: () => state.t, refetch: load,
      render: (box, api) => {
        const sel = el("select.vote-input", null, [
          el("option", { value: "off", text: opts.offLabel }),
          el("option", { value: "on", text: opts.onLabel }),
        ]);
        sel.value = opts.on ? "on" : "off";
        const numWrap = el("div", { style: "margin-top:.4rem" });
        const num = el("input.vote-input", { type: "number", min: "1", step: "1", placeholder: opts.numPlaceholder || "amount", value: opts.on && opts.n != null ? String(opts.n) : "" });
        numWrap.appendChild(el("label.mglabel", { style: "display:block;margin-bottom:.15rem", text: opts.numLabel }));
        numWrap.appendChild(num);
        const sync = () => { numWrap.style.display = sel.value === "on" ? "" : "none"; };
        sel.addEventListener("change", sync); sync();
        box.appendChild(sel); box.appendChild(numWrap);
        num.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); go(); } });
        function go() {
          if (sel.value === "off") return api.submit(opts.offValue);
          const n = parseInt(num.value, 10);
          if (!(n > 0)) { toast("Enter a whole number greater than 0.", "warn"); return; }
          api.submit(opts.onValue(n));
        }
        box.appendChild(el("div.btn-row", { style: "margin-top:.5rem" }, [
          el("button.btn.sm.primary", { text: "Vote", onclick: go }),
          el("button.btn.sm.ghost", { text: "Cancel", onclick: api.close }),
        ]));
      },
    });
    return rowCells(label, opts.currentLabel).concat([glyphCell(widget)]);
  };

  function render() {
    clear(body);
    const grid = el("div", { style: "display:grid;grid-template-columns:max-content 1fr max-content;gap:.45rem .8rem;align-items:center" });
    const add = cells => cells.forEach(c => grid.appendChild(c));
    add(textRow("Name", "name", it.name || entry.name));
    add(modeNumRow("Stack limit", "stack", {
      on: !!it.stack, n: typeof it.stack === "number" ? it.stack : null,
      offLabel: "No limit — 1 per slot", onLabel: "Limit stack size",
      numLabel: "Max per slot", numPlaceholder: "e.g. 100",
      offValue: "no limit", onValue: n => "stacks to " + n,
      currentLabel: it.stack ? (typeof it.stack === "number" ? "Stacks to " + it.stack : "Stacks — no limit") : "No limit — 1 per slot",
    }));
    add(modeNumRow("Consumable", "edible", {
      on: !!it.heals, n: typeof it.heals === "number" ? it.heals : null,
      offLabel: "Not edible", onLabel: "Edible",
      numLabel: "Hitpoints healed", numPlaceholder: "e.g. 10",
      offValue: "not edible", onValue: n => "heals " + n,
      currentLabel: it.heals ? "Edible — heals " + it.heals : "Not edible",
    }));
    add(selectRow("Wieldable / wearable", "equip",
      ["Not equippable", "weapon", "shield", "hair (headwear)", "face", "neck", "cape", "torso", "arms (both)", "legs (both)", "feet (both)", "hands (both)", "bracelet", "anklet", "pauldrons (both)", "quiver", "rune pouch"],
      it.equip ? slotText(Array.isArray(it.equip) ? it.equip : [it.equip]) : "Not equippable"));
    add(selectRow("Dropable", "drop", ["Droppable", "Cannot be dropped"], "Droppable"));
    add(numRow("Value (sell price)", "value", it.value, "coins"));
    add(selectRow("Placable", "place", ["Placeable", "Not placeable"], it.place ? "Placeable" : "Not placeable"));

    // every remaining own field on the item (skip internal underscore keys & icon)
    const COVERED = new Set(["name", "icon", "stack", "equip", "heals", "potion", "drinkBuff", "wellFed", "value", "place"]);
    const extra = Object.keys(it).filter(k => !COVERED.has(k) && k[0] !== "_").sort();
    if (extra.length) {
      grid.appendChild(el("h4", { style: "grid-column:1 / -1;margin:.9rem 0 .1rem;font-size:.82rem;color:var(--accent)", text: "Other in-game fields" }));
      for (const k of extra) {
        const v = it[k], label = prettifyKey(k);
        if (typeof v === "number") add(numRow(label, k, v));
        else if (typeof v === "boolean") add(selectRow(label, k, ["yes", "no"], v ? "yes" : "no"));
        else if (v && typeof v === "object") add(textRow(label, k, JSON.stringify(v)));
        else add(textRow(label, k, v));
      }
    }
    body.appendChild(grid);
  }
  load();
}

// ---------------- votable drop table ----------------
// Each dropped item's min qty, max qty and drop chance are community-votable by
// typing a number; players can also propose new items for the table. Numeric
// votes tally as a community average shown beside the game's current value.
function dropTableSection(page, type, key, def) {
  itemDatalist();
  const card = el("div.card");
  card.appendChild(el("div.sectitle", null, [el("h3", null, ["Drop table ", el("span.hint", { text: "vote min/max quantity & drop chance, or add an item" })])]));
  const body = el("div", null, [el("div.center-col", null, [el("div.spinner"), el("small", { text: "Loading…" })])]);
  card.appendChild(body); page.appendChild(card);
  const state = { t: {} };
  const load = async () => { try { state.t = await Taiao.tally(type, key); } catch (_) {} render(); };
  const itemName = id => (typeof ITEMS !== "undefined" && ITEMS[id] && ITEMS[id].name) || Roster.prettyName(id);
  // community average of the typed numeric votes on a field
  const avg = field => { const t = state.t[field]; if (!t) return null; let s = 0, n = 0; for (const k in t) { const v = parseFloat(k); if (!isNaN(v)) { s += v * t[k]; n += t[k]; } } return n ? s / n : null; };

  // one editable numeric field: shows the current value + community average and
  // lets you type your own number to vote. `fmt` renders a value for display.
  function numCell(field, current, fmt) {
    const a = avg(field);
    const wrap = el("div", { style: "display:flex;align-items:center;gap:.35rem" });
    wrap.appendChild(el("small.mono", { style: "color:var(--gold)", text: current != null ? fmt(current) : "—" }));
    wrap.appendChild(VoteWidget.symbol({
      kind: type, folder: key, field, type: "number",
      current: current != null ? current : "", currentLabel: current != null ? fmt(current) : "—",
      note: a != null ? "community " + fmt(a) : null,
      label: "value", getTallies: () => state.t, refetch: load,
    }));
    return wrap;
  }

  function render() {
    clear(body);
    const rows = (def.drops || []).map(d => ({ id: d.id, min: d.min, max: d.max, ch: d.ch }));
    const known = new Set(rows.map(d => d.id));
    Object.keys(state.t["drop_custom"] || {}).forEach(id => { if (!known.has(id)) { rows.push({ id, min: null, max: null, ch: null, custom: true }); known.add(id); } });

    body.appendChild(el("div.droprow.drophead", null, [el("small", { text: "Item" }), el("small", { text: "Min qty" }), el("small", { text: "Max qty" }), el("small", { text: "Drop chance" })]));
    if (!rows.length) body.appendChild(el("p.tagline", { text: "No item drops yet — add one below." }));
    rows.forEach(d => {
      const row = el("div.droprow");
      row.appendChild(el("div", null, [el("div", { text: itemName(d.id) }), el("small.mono", { style: "color:var(--ink-dim)", text: d.id + (d.custom ? " · proposed" : "") })]));
      row.appendChild(numCell("drop:" + d.id + ":min", d.min, v => String(Math.round(v))));
      row.appendChild(numCell("drop:" + d.id + ":max", d.max, v => String(Math.round(v))));
      row.appendChild(numCell("drop:" + d.id + ":chance", d.ch != null ? Math.round(d.ch * 1000) / 10 : null, v => (Math.round(v * 10) / 10) + "%"));
      body.appendChild(row);
    });

    // add a whole drop row at once — item id + min qty + max qty + drop chance
    const addWrap = el("div", { style: "margin-top:.7rem;border-top:1px solid var(--line);padding-top:.6rem" });
    addWrap.appendChild(el("h4", { style: "margin:0 0 .4rem;font-size:.82rem;color:var(--accent)", text: "Add an item to the drop table" }));
    const idInp = el("input.vote-input", { placeholder: "item id", autocomplete: "off" });
    idInp.setAttribute("list", "action-item-ids");
    const minInp = el("input.vote-input", { type: "number", min: "0", step: "1", placeholder: "e.g. 1" });
    const maxInp = el("input.vote-input", { type: "number", min: "0", step: "1", placeholder: "e.g. 3" });
    const chInp = el("input.vote-input", { type: "number", min: "0", max: "100", step: "any", placeholder: "e.g. 12.5" });
    const fld = (label, inp) => el("label.field", { style: "margin:0;flex:1;min-width:7rem" }, [el("span", { text: label }), inp]);
    addWrap.appendChild(el("div", { style: "display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end" }, [
      fld("Item id", idInp), fld("Min qty", minInp), fld("Max qty", maxInp), fld("Drop chance %", chInp),
    ]));
    const addBtn = el("button.btn.primary.sm", { style: "margin-top:.5rem", text: "Add drop" });
    addBtn.onclick = async () => {
      if (!Taiao.logged()) { toast("Sign in to propose a drop.", "warn"); App.go("#/settings"); return; }
      const id = idInp.value.trim();
      if (!id) { toast("Enter an item id.", "warn"); return; }
      const min = minInp.value.trim(), max = maxInp.value.trim(), ch = chInp.value.trim();
      addBtn.disabled = true;
      try {
        const r = await Taiao.castVote(type, key, "drop_custom", id.slice(0, 60));
        if (r && r.error) { toast(r.error, "err"); return; }
        if (min !== "") await Taiao.castVote(type, key, "drop:" + id + ":min", min);
        if (max !== "") await Taiao.castVote(type, key, "drop:" + id + ":max", max);
        if (ch !== "") await Taiao.castVote(type, key, "drop:" + id + ":chance", ch);
        toast("Drop proposed!", "ok");
        idInp.value = minInp.value = maxInp.value = chInp.value = "";
        await load();
      } finally { addBtn.disabled = false; }
    };
    addWrap.appendChild(addBtn);
    body.appendChild(addWrap);
  }
  load();
}

// ---------------- monster detail ----------------
// ---- monster: ART (sprite page) — sprites/variants tree + animations ----
function renderMonsterArt(page, provider, entry) {
  const def = provider.data(entry) || {};
  const base = (entry.baseKey || entry.key).replace(/(_v)?(_baby)?$/, "");
  // only show variants that are a genuinely different sprite — a giant/baby that
  // just reuses the base art (same layer keys) isn't a distinct sprite state.
  const sigOf = k => (provider.layerKeys ? (provider.layerKeys(k, 0) || []) : []).filter(Boolean).join("+");
  const baseSig = sigOf(base);
  const family = [base, base + "_v", base + "_baby"]
    .filter(k => typeof MONSTERS !== "undefined" && MONSTERS[k])
    .filter(k => k === base || sigOf(k) !== baseSig);
  const segOf = k => k === base ? base : (/_v$/.test(k) ? "giant" : /_baby$/.test(k) ? "baby" : slug(k.slice(base.length + 1)) || "variant");
  const mnodes = family.map(k => ({ id: k, seg: segOf(k), name: (MONSTERS[k] && MONSTERS[k].name) || Roster.prettyName(k), parent: k === base ? null : base, draw: (cv, di) => provider.draw(cv, { type: "monster", key: k }, di) }));
  const title = family.length > 1 ? "Sprites & variants" : "Sprite";
  const treeCard = stateTreeCard(title, def.dirSpr ? "unique per direction — click to expand" : "one sprite shown for all 8 directions — click to expand", mnodes, { type: "monster", key: entry.key });
  page.appendChild(treeCard);
  if (provider.supportsGen) mergeSharedVersions(treeCard, "monster", entry.key, entry.name);
  animationsSection(page, "monster", entry.key, mnodes);
}

// ---- monster: INSTANCE (gameplay page) — stats, drops, spawns, votes, triggers, actions ----
function renderMonsterInstance(page, provider, entry) {
  const def = provider.data(entry) || {};
  // billboard scale is a uniform size multiplier — fold it straight into the
  // height/width so those are the real on-screen dimensions (no separate stat).
  const scale = def.scale != null ? def.scale : 1;

  // stats & behaviour
  const stats = (typeof deriveCharStats !== "undefined") ? deriveCharStats(def.name || entry.key) : null;
  const sc = el("div.card");
  sc.appendChild(el("h3", { text: "Stats & behaviour" }));
  if (entry.biome) sc.appendChild(el("p.tagline", { style: "margin:-.2rem 0 .5rem", html: "The <b>" + escapeHtml(entry.biome) + "</b> variant of <b>" + escapeHtml(def.name || provider.baseKey) + "</b> — it appears in game simply as <b>" + escapeHtml(def.name || "") + "</b>. The stats shown are the shared defaults; use the 🗳 beside a line to enter a value or view proposals." }));

  // votable stat specs → an inline 🗳 glyph on each line (replaces the old Vote card).
  // Casting/viewing happens in the glyph's popover: enter your own value or pick a proposal.
  const voteState = { tallies: {} };
  const loadTallies = async () => { try { voteState.tallies = (typeof Taiao !== "undefined" && Taiao.tally) ? (await Taiao.tally("monster", entry.key) || {}) : {}; } catch (_) {} };
  const numStats = [
    ["stat:level", "Level", def.lvl],
    ["stat:hp", "Hit points", def.hp],
    ["stat:maxhit", "Max hit", def.maxHit],
    ["stat:defence", "Defence", def.def],
    ["stat:atktick", "Attack speed", def.atkTick != null ? def.atkTick + "ms" : null],
    ["stat:xp", "XP on kill", def.xp],
    ["stat:height", "Height", stats ? "×" + (stats.h * scale).toFixed(2) : null],
    ["stat:width", "Width", stats ? "×" + (stats.w * scale).toFixed(2) : null],
    ["stat:speed", "Speed", stats ? "×" + stats.speed.toFixed(2) : null],
  ];
  const specs = provider.votes().concat(numStats.filter(x => x[2] != null).map(([f, l, v]) => ({ field: f, label: l, currentValue: String(v), current: "current", choices: STAT_DELTAS, numeric: true })));
  const specByLabel = {}; specs.forEach(s => { specByLabel[s.label] = s; });
  specByLabel["Aggression"] = specByLabel["Temperament"];   // the temperament ballot sits on the Aggression line
  const voteGlyph = spec => VoteWidget.symbol({
    kind: "monster", folder: entry.key, field: spec.field, type: "select",
    choices: (spec.choices || []).map(ch => (ch && ch.value != null) ? { value: ch.value, label: ch.label != null ? ch.label : ch.value } : ch),
    current: spec.current, currentLabel: spec.currentValue != null ? spec.currentValue : spec.current,
    custom: !!spec.numeric, customPlaceholder: spec.numeric ? "+n% / -n%" : "your own value",
    label: typeof spec.label === "string" ? spec.label : spec.field,
    getTallies: () => voteState.tallies, refetch: loadTallies,
  });

  const kv = el("dl.kv");
  const add = (k, v) => {
    if (v === undefined || v === null || v === "") return;
    kv.appendChild(el("dt", { text: k }));
    const dd = el("dd", null, [String(v)]);
    const spec = specByLabel[k];
    if (spec) dd.appendChild(el("span", { style: "margin-left:.45rem" }, [voteGlyph(spec)]));
    kv.appendChild(dd);
  };
  add("Name", def.name);
  add("Level", def.lvl);
  if (stats) { add("Height", "×" + (stats.h * scale).toFixed(2)); add("Width", "×" + (stats.w * scale).toFixed(2)); add("Speed", "×" + stats.speed.toFixed(2)); }
  add("Hit points", def.hp);
  add("Max hit", def.maxHit);
  add("Defence", def.def);
  add("Attack speed", def.atkTick != null ? def.atkTick + " ms" : null);
  add("XP on kill", def.xp);
  add("Aggression", def.aggro ? "aggressive" : "passive");
  add("Flight", "— (vote to set)");
  add("Directional sprites", def.dirSpr ? "yes — unique per direction" : "no — one billboard, mirrored");
  add("Respawn delay", def.respawn != null ? (def.respawn / 1000) + " s" : null);
  const vars = provider.variants(entry.key);
  add("Variants", vars.length ? vars.map(k => (MONSTERS[k] && MONSTERS[k].name) || k).join(", ") : null);
  kv.appendChild(el("dt", { text: "Sprite source" }));
  kv.appendChild(el("dd", null, [spriteSourceLink("monster", entry, provider)]));
  sc.appendChild(kv);
  if (def.butcher) sc.appendChild(el("p.tagline", { style: "margin-top:.5rem", html: "<b>Husbandry / harvest yield</b> (dropped on death — butchering is no longer a skill): " + [def.butcher.meat ? def.butcher.meat + "× meat" : "", def.butcher.hide ? def.butcher.hide + "× " + (def.butcher.hideItem || "hide") : ""].filter(Boolean).join(", ") }));
  page.appendChild(sc);
  loadTallies();   // background-load proposals so the glyph popovers show them

  // drop table — votable min/max/chance per item + add-your-own
  dropTableSection(page, "monster", entry.key, def);

  entitySpritesSection(page, "monster", entry, "monster");
  spriteAnimRulesSection(page, "monster", entry, "monster");
  soundsSection(page, "monster", entry.key, "monster");
  triggersSection(page, "monster", entry.key);
  actionMenuSection(page, "monster", entry.key, "monster");
}

// ---------------- object: ART (sprite page) — sprites tree + animations ----------------
function renderObjectArt(page, provider, entry) {
  const key = entry.key;
  const onodes = [{ id: key, seg: entry.snake || key, name: entry.name, parent: null, draw: (cv, di) => provider.draw(cv, entry, di) }];
  const treeCard = stateTreeCard("Sprites", "click the deck to expand all 8 directions", onodes, { type: "object", key });
  page.appendChild(treeCard);
  if (provider.supportsGen) mergeSharedVersions(treeCard, "object", key, entry.name);
  animationsSection(page, "object", key, onodes);
}

// ---------------- biome tile: ART (sprite page) — a deck of 4 variants + tree ----------------
// One biome = one sprite with a 4-frame deck (its ground-tile variants), like the
// 8-direction sprites, plus a state tree for branching new variations.
function renderTileArt(page, provider, entry) {
  const m = /^(bg_\d+)_(\d+)$/.exec(entry.key);
  if (m) {
    const base = m[1];
    const variants = [];
    for (let v = 0; v < 4; v++) if (typeof SPR !== "undefined" && SPR[base + "_" + v]) variants.push(v);
    if (!variants.length) variants.push(0);
    const name = String(entry.name || base).replace(/\s*·.*$/, "");
    const node = { id: base, seg: base, name, parent: null, dirIdxs: variants.map((_, i) => i),
      draw: (cv, i) => { try { SprRender.drawKeys(cv, [base + "_" + (variants[i] != null ? variants[i] : 0)], cv.width, false); } catch (_) {} } };
    page.appendChild(stateTreeCard("Tile variants", "click the deck to expand all " + variants.length + " variants", [node], { type: "tile", key: base }));
  } else {
    // flat / misc terrain tile — a single frame
    const node = { id: entry.key, seg: entry.key, name: entry.name, parent: null, dirIdxs: [0], draw: cv => { try { provider.draw(cv, entry, 0); } catch (_) {} } };
    page.appendChild(stateTreeCard("Sprite", "single tile", [node], { type: "tile", key: entry.key }));
  }
}

// ---------------- item / map icon: ART (sprite page) — single frame + tree ----------------
function renderIconArt(page, provider, entry) {
  const key = entry.key;
  const node = { id: key, seg: entry.poi || entry.iconKey || key, name: entry.name, parent: null, dirIdxs: [0], draw: cv => { try { provider.draw(cv, entry, 0); } catch (_) {} } };
  page.appendChild(stateTreeCard("Sprite", "the single-frame icon — branch a variation with ＋", [node], { type: entry.type || provider.type, key }));
}

// ---------------- object: INSTANCE (gameplay page) — details, triggers, actions ----------------
function renderObjectInstance(page, provider, entry) {
  const key = entry.key;
  // relevant details
  const dc = el("div.card");
  dc.appendChild(el("h3", { text: "Details" }));
  const kv = el("dl.kv");
  const add = (k, v) => { if (v !== undefined && v !== null && v !== "") { kv.appendChild(el("dt", { text: k })); kv.appendChild(el("dd", { text: String(v) })); } };
  add("Name", (typeof decorName !== "undefined" ? decorName(key) : null) || entry.name);
  add("Examine", (typeof decorExamine !== "undefined" ? decorExamine(key) : null) || (typeof EXAMINE !== "undefined" && EXAMINE[key]) || null);
  add("Sheet frame", (typeof OBJ_MAP !== "undefined") ? OBJ_MAP[key] : null);
  if (typeof STATIONS !== "undefined" && STATIONS[key]) {
    const st = STATIONS[key];
    add("Crafting station", st.action || "yes");
    add("Station skills", (st.lists || []).map(Roster.prettyName).join(", ") || (st.alchemy ? "Alchemy" : ""));
  }
  if (typeof NODE_EXAMINE !== "undefined" && NODE_EXAMINE[key]) add("Resource node", NODE_EXAMINE[key]);
  kv.appendChild(el("dt", { text: "8-directional" })); kv.appendChild(el("dd", { text: "yes — packed object sheet" }));
  kv.appendChild(el("dt", { text: "Sprite source" }));
  kv.appendChild(el("dd", null, [spriteSourceLink("object", entry, provider)]));
  dc.appendChild(kv);
  page.appendChild(dc);

  // which map icon marks this object on the world map (votable; art on Sprites tab)
  if (typeof mapIconVoteRow === "function") {
    const mc = el("div.card");
    mc.appendChild(el("div.sectitle", null, [el("h3", null, ["Map icon ", el("span.hint", { text: "how it's marked on the map — vote to change" })])]));
    mc.appendChild(mapIconVoteRow("object", key, key));
    page.appendChild(mc);
  }

  entitySpritesSection(page, "object", entry, "object");
  spriteAnimRulesSection(page, "object", entry, "object");
  soundsSection(page, "object", key, "object");
  triggersSection(page, "object", key);
  actionMenuSection(page, "object", key, "object");
}

// ---------------- categorical votes ----------------
// Exclusive per-field ballots (workshop_votes): player/NPC and per-stat
// higher/lower/keep. Re-picking clears your vote; the whole block reloads with
// fresh public tallies after each cast.
async function renderVotes(host, type, key, specs) {
  host._specs = specs;
  clear(host);
  host.appendChild(el("small", { text: "Loading votes…" }));
  let tallies = {};
  try { tallies = await Taiao.tally(type, key); } catch (_) {}
  clear(host);
  // One shared 3-column grid (label · current value · 🗳) so every glyph lines
  // up in its own right-aligned column across all rows.
  host.style.display = "grid";
  host.style.gridTemplateColumns = "max-content 1fr max-content";
  host.style.gap = ".5rem .8rem";
  host.style.alignItems = "center";
  for (const spec of specs) voteRow(host, type, key, spec, tallies);
}
function voteRow(host, type, key, spec, tallies) {
  host.appendChild(el("div", { style: "font-size:.82rem;color:var(--ink-dim);white-space:nowrap" }, [spec.label]));
  host.appendChild(el("span.mono", { style: "color:var(--gold);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text: spec.currentValue != null ? String(spec.currentValue) : "" }));
  host.appendChild(el("div", { style: "justify-self:end" }, [VoteWidget.symbol({
    kind: type, folder: key, field: spec.field,
    type: "select",
    choices: spec.choices.map(ch => (ch && ch.value != null) ? { value: ch.value, label: ch.label != null ? ch.label : ch.value } : ch),
    current: spec.current, currentLabel: spec.currentValue != null ? spec.currentValue : spec.current,
    custom: !!spec.numeric, customPlaceholder: "+n% / -n%",
    label: typeof spec.label === "string" ? spec.label : spec.field,
    tallies, refetch: () => renderVotes(host, type, key, host._specs),
  })]));
}

// create a local draft tied to this subject so publishing lands on it
async function startDraftFor(type, key, name) {
  const p = Store.newProject(type, "My " + name);
  p.folder = key; p.prompt = name;
  await Store.save(p);
  toast("Draft created — generate art, then publish it here.", "ok", 5000);
  App.go("#/edit/" + p.id);
}

// ---------------- shared versions, merged inline ----------------
// Renders the community-shared versions directly into `host` (which lives inside
// the sprite/state "Sprites" card) — NO separate "Community versions of X" card.
// Empty → renders nothing. Each shared version keeps its slot grouping + vote.
async function renderGallery(host, type, folder, title) {
  clear(host);
  const spin = el("div.center-col", null, [el("div.spinner"), el("small", { text: "Loading shared versions…" })]);
  host.appendChild(spin);
  let props; try { props = await Taiao.listCostumes(type, folder); } catch (_) { props = []; }
  clear(host);
  if (!props.length) return;   // nothing shared → show nothing (no empty section)
  const details = await Promise.all(props.map(async pr => { let full = null; try { full = await Taiao.getCostume(pr.id); } catch (_) {} return { meta: pr, payload: full && full.payload }; }));
  const groups = new Map();
  for (const d of details) { const field = (d.payload && d.payload.field) || "state:" + slug(d.meta.title); if (!groups.has(field)) groups.set(field, []); groups.get(field).push(d); }
  host.appendChild(el("hr"));
  for (const [field, items] of groups) {
    items.sort((a, b) => (b.meta.endorsements || 0) - (a.meta.endorsements || 0));
    host.appendChild(el("h3", { style: "margin-top:.6rem;font-size:.9rem", text: "Shared — " + prettyField(field) }));
    const grid = el("div.grid-cards");
    items.forEach((d, idx) => grid.appendChild(costumeCard(type, folder, d, idx === 0 && (d.meta.endorsements || 0) > 0, () => renderGallery(host, type, folder, title))));
    host.appendChild(grid);
  }
}

// Small AI-disclosure badge from a payload's `provenance` (see taiao.js
// submitProposal's 6th arg) — "ai" is the maker saying so up front,  "own" is
// hand-made. Undeclared/older proposals show nothing (not every proposal was
// asked). The existing Human/AI provenance column on the Sprites tab is a
// DIFFERENT thing (classifies already-SHIPPED art by its spritesheet) and
// stays as-is.
function provenanceBadge(payload) {
  const p = payload && payload.provenance;
  if (p === "ai") return el("span.badge", { title: "The maker disclosed this as AI-made", text: "🤖 AI-made · disclosed" });
  if (p === "own") return el("span.badge", { title: "The maker's own work", text: "✋ hand-made" });
  return null;
}

function costumeCard(type, folder, d, isWinner, refresh) {
  const { meta, payload } = d;
  const dirs = payload && payload.costume && payload.costume.dirs || {};
  const tile = el("div.tile" + (isWinner ? ".winner" : ""), { style: "cursor:default" });
  const thumb = el("div.thumb", { style: "cursor:pointer", onclick: () => openCostume(d, refresh) });
  const src = dirs.south || firstVal(dirs);
  if (src) { const cv = el("canvas", { width: 128, height: 128 }); drawSprite(cv, src, 128); thumb.appendChild(cv); } else thumb.appendChild(el("div", { style: "font-size:2rem;opacity:.5", text: "👕" }));
  tile.appendChild(thumb);
  const isPart = !!(payload && payload.costume && payload.costume.part);
  const m = el("div.meta");
  m.appendChild(el("div.name", null, [isWinner ? el("span.crown", { text: "♛ " }) : null, meta.title,
    isPart ? el("span.badge", { style: "margin-left:.3rem;font-size:.6rem", text: "➖ part" }) : null].filter(Boolean)));
  m.appendChild(el("div.credit", null, ["by ", el("span.u", { text: meta.username || "someone" })]));
  const pBadge = provenanceBadge(payload);
  if (pBadge) m.appendChild(pBadge);
  const voteBtn = el("button.btn.gold.sm", { text: "▲ Vote", onclick: async () => {
    if (!Taiao.logged()) { toast("Sign in to vote.", "warn"); App.go("#/settings"); return; }
    voteBtn.disabled = true; const r = await Taiao.endorseCostume(meta.id);
    if (r.ok) { toast("Vote counted!", "ok"); refresh(); } else { toast(r.error || "Couldn't vote.", "err"); voteBtn.disabled = false; }
  } });
  m.appendChild(el("div.votebar", null, [voteBtn, el("span.votes", { text: (meta.endorsements || 0) + " ▲" })]));
  tile.appendChild(m);
  return tile;
}

function openCostume(d, refresh) {
  const { meta, payload } = d;
  const c = payload && payload.costume || {};
  const bg = el("div.modal-bg", { onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el("div.modal");
  m.appendChild(el("span.x", { text: "×", onclick: () => bg.remove() }));
  m.appendChild(el("h2", null, [meta.title, c.part ? el("span.badge", { style: "margin-left:.4rem;font-size:.6rem;vertical-align:middle", text: "➖ part" }) : null].filter(Boolean)));
  m.appendChild(el("p.credit", null, ["Shared by ", el("span.u", { text: meta.username || "someone" }), " · ", (meta.endorsements || 0) + " votes", meta.licence ? " · " + meta.licence : ""]));
  const pBadge = provenanceBadge(payload);
  if (pBadge) m.appendChild(pBadge);
  const dirs = c.dirs || {};
  const grid = el("div.dirgrid", { style: "margin:.6rem 0" });
  for (const dir of DIRS8) { const cv = el("canvas.spr"); if (dirs[dir]) drawSprite(cv, dirs[dir], 96); grid.appendChild(el("div.dircell", null, [cv, el("div.lbl", { text: DIR_SHORT[dir] })])); }
  m.appendChild(grid);
  const kv = el("dl.kv"); const add = (k, v) => { if (v) { kv.appendChild(el("dt", { text: k })); kv.appendChild(el("dd", { text: v })); } };
  add("state", c.state); add("slot", c.slot); add("item", c.item); add("notes", c.note);
  if (c.part) add("worn when", (c.items || []).filter(Boolean).join(", ") || "no trigger item set yet");
  if (payload && payload.design && payload.design.bio) add("bio", payload.design.bio);
  m.appendChild(kv);
  const vote = el("button.btn.gold", { text: "▲ Vote for this version", onclick: async () => {
    if (!Taiao.logged()) { toast("Sign in to vote.", "warn"); return; }
    const r = await Taiao.endorseCostume(meta.id);
    if (r.ok) { toast("Vote counted!", "ok"); bg.remove(); refresh(); } else toast(r.error || "Couldn't vote.", "err");
  } });
  const flag = el("button.btn.ghost.sm", { text: "⚑ Flag", onclick: async () => { const r = await Taiao.flagCostume(meta.id); toast(r.ok ? "Flagged for review." : (r.error || "Couldn't flag."), r.ok ? "ok" : "err"); } });
  m.appendChild(el("div.btn-row", { style: "margin-top:.8rem" }, [vote, flag]));
  bg.appendChild(m); document.body.appendChild(bg);
}

function prettyField(f) {
  if (f.startsWith("item:")) return f.slice(5).replace(/:/g, " · ").replace(/_/g, " ") + " (worn item)";
  if (f.startsWith("state:")) return f.slice(6).replace(/_/g, " ");
  if (f.startsWith("full")) return "whole " + f.replace(/^full:?/, "").replace(/_/g, " ");
  return f.replace(/_/g, " ");
}
