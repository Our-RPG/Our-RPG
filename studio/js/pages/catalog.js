// ===== Our RPG Workshop — generic asset catalog (any type) =====
// One page for every tab. Driven entirely by a provider (js/providers.js):
// lists every in-game asset of its type, shows the community's shared
// generations, and (where generation makes sense) a collapsible creator plus
// your local drafts. Everything is communal and public — no login to browse.
"use strict";

function selField(labelText, options, value) {
  const sel = el("select");
  for (const o of options) sel.appendChild(el("option", { value: String(o), text: String(o), selected: String(o) === String(value) }));
  return { field: el("label.field", null, [el("span", { text: labelText }), sel]), sel };
}
function chipGroup(options, value, onPick) {
  const wrap = el("div.chips"); let cur = value;
  options.forEach(o => { const c = el("span.chip" + (String(o) === String(value) ? ".on" : ""), { text: String(o), onclick: () => { cur = o; qsa(".chip", wrap).forEach(x => x.classList.remove("on")); c.classList.add("on"); onPick && onPick(o); } }); wrap.appendChild(c); });
  return { wrap, get: () => cur };
}
const firstVal = o => { for (const k in o) return o[k]; return null; };

// ===== Sprites tab — every drawable sprite (character/object/monster) as a table =====
// Each row: preview + name (links to the sprite art page), sprite id, category.
// Canonical sprite id for a (type,key) — matches the Sprites table & sprite page.
// Monsters use their shared layer-key id (e.g. mcd_cow); others use snake || key.
function spriteIdFor(type, key) {
  const p = (typeof Providers !== "undefined") ? Providers.get(type) : null;
  const e = (p && p.entry) ? p.entry(key) : null;
  if (type === "monster" && p && p.layerKeys) {
    const keys0 = (p.layerKeys(key, 0) || []).filter(Boolean);
    const sid = (p.isDir && p.isDir(e || { key })) ? String(keys0[0] || "").replace(/_south$/, "") : keys0.join("+");
    if (sid) return sid;
  }
  return (e && e.snake) || key;
}

// Item icons are deduped one-per-icon on the Sprites tab, and each row's sprite
// id is the ITEM it's assigned to — the shortest/first item id among the items
// sharing that icon. This map (iconKey → group) is the single source of truth, so
// the Sprites tab, the Items table and item pages all show the SAME sprite id.
// Memoised (the game's ITEMS/icons don't change at runtime).
let _uiIconGroups = null;
function uiIconGroups() {
  if (_uiIconGroups) return _uiIconGroups;
  _uiIconGroups = new Map();
  const p = (typeof Providers !== "undefined") ? Providers.get("ui") : null;
  if (!p || !p.list) return _uiIconGroups;
  const idOf = e => String(e.itemId || e.key);
  for (const e of p.list()) {
    const icon = e.iconKey || e.key;
    let g = _uiIconGroups.get(icon);
    if (!g) { g = { rep: e, members: [] }; _uiIconGroups.set(icon, g); }
    g.members.push(e);
    if (idOf(e).length < idOf(g.rep).length || (idOf(e).length === idOf(g.rep).length && idOf(e) < idOf(g.rep))) g.rep = e;
  }
  return _uiIconGroups;
}
// The sprite id shown for an item's icon on the Sprites tab (its group's rep id).
function uiSpriteId(iconKey) {
  const g = iconKey && uiIconGroups().get(iconKey);
  return g ? String(g.rep.itemId || g.rep.key) : (iconKey || "—");
}

// Native source dimensions [w, h] of an SPR-keyed sprite (icon / tile / map /
// monster layer). Falls back to the sheet's tile size when the key carries no
// explicit sub-rect. null if the key isn't in SPR.
function sprKeySize(key) {
  if (!key || typeof SPR === "undefined" || !SPR[key]) return null;
  const def = SPR[key], sheet = def[0], extra = def[3];
  const st = (typeof SHEET_TILE !== "undefined" && SHEET_TILE[sheet]) || 16;
  return [(extra && extra.sw) || st, (extra && extra.sh) || st];
}
// Native sprite frame size for a Sprites-tab row, per category. null if unknown.
function spriteRowSize(r) {
  const t = r.type, e = r.e, p = r.provider;
  if (t === "ui") return sprKeySize(e.iconKey);
  if (t === "tile" || t === "map") return sprKeySize(e.key);
  if (t === "monster") {
    const keys0 = (p.layerKeys ? p.layerKeys(e.key, 0) || [] : []).filter(Boolean);
    for (const k of keys0) { const s = sprKeySize(k); if (s) return s; }
    return null;
  }
  if (t === "object") return sprKeySize(e.key) || (typeof OBJ_CELL !== "undefined" ? [OBJ_CELL, OBJ_CELL] : null);
  if (t === "character") {
    if (e.npc && e.mix) return [e.mix.fw, e.mix.fh];        // NPC billboards are fw×fh
    return (typeof CHAR_CELL !== "undefined" ? [CHAR_CELL, CHAR_CELL] : null);
  }
  return null;
}
// How many facing directions the sprite has: 8 for rotation sprites (characters,
// objects, directional monsters), 1 for single-frame art (items, tiles, map icons,
// non-directional monsters that just mirror for west).
function spriteRowDirs(r) {
  const t = r.type, e = r.e, p = r.provider;
  if (t === "monster") return (p.isDir && p.isDir(e)) ? 8 : 1;
  if (t === "character" || t === "object") return 8;
  return 1;
}

// Player-published community sprites (server/src/profile.js published_sprites):
// direct-published from a profile gallery, live under each maker's chosen
// sprite_id + tag. They are folded straight into the "All sprites" table below
// (tagged "community" + @author) rather than a separate card, and the sprite_id
// is offered as a default sprite when creating a new character / monster / object.

// Cached once per page session — the published catalogue changes rarely and is
// read by the sprites table, the creators' id datalists and their id previews.
let _pubSpritesPromise = null;
function publishedSpritesCached(force) {
  if (force) _pubSpritesPromise = null;
  if (!_pubSpritesPromise) _pubSpritesPromise = (async () => {
    try { return (await Taiao.listPublishedSprites()) || []; } catch (_) { return []; }
  })();
  return _pubSpritesPromise;
}

// Published category → the "All sprites" table's type key (so a published sprite
// shares a row shape with the built-in catalogue). Items are single icons (ui).
function publishedRowType(category) {
  return category === "item" ? "ui" : (category === "monster" ? "monster" : (category === "character" ? "character" : "object"));
}
function publishedRowDirs(category) { return (category === "item") ? 1 : 8; }

// If `spriteId` names a published community sprite, fetch its full art so a new
// entity that points at it actually carries that sprite's art. Returns a base-
// art object ({south,…} or {image}) or null.
async function publishedBaseArtFor(spriteId) {
  if (!spriteId) return null;
  const want = String(spriteId).toLowerCase();
  try {
    const hit = (await publishedSpritesCached()).find(it => String(it.sprite_id).toLowerCase() === want);
    if (!hit) return null;
    const full = await Taiao.publishedSpriteItem(hit.id);
    const res = full && full.result;
    if (!res) return null;
    return res.dirs || (res.image ? { image: res.image } : null);
  } catch (_) { return null; }
}

// View a published sprite's every direction, with a one-click "copy id" so it
// can be pasted into a creator's Default sprite_id field.
function openPublishedView(it) {
  const bg = el("div.modal-bg", { onclick: e => { if (e.target === bg) bg.remove(); } });
  const box = el("div.modal", { style: "width:min(560px,94vw)" });
  box.appendChild(el("h3", { text: it.name || it.sprite_id }));
  box.appendChild(el("p.tagline", null, [el("span.mono", { text: it.sprite_id }), document.createTextNode(" · " + it.category + " · @" + (it.username || "someone"))]));
  const grid = el("div.dirgrid"); box.appendChild(grid);
  grid.appendChild(el("div", { text: "Loading…" }));
  const copyBtn = el("button.btn.sm.primary", { text: "⧉ Copy sprite_id", onclick: () => {
    try { navigator.clipboard.writeText(it.sprite_id); } catch (_) {}
    toast("Copied “" + it.sprite_id + "” — paste it into the Default sprite_id field when you create a character, monster or object.", "ok", 6000);
  } });
  box.appendChild(el("div.btn-row", { style: "margin-top:.6rem" }, [copyBtn, el("button.btn.ghost", { text: "Close", onclick: () => bg.remove() })]));
  bg.appendChild(box); document.body.appendChild(bg);
  (async () => {
    const full = await Taiao.publishedSpriteItem(it.id);
    clear(grid);
    const res = full && full.result;
    const dirs = res && (res.dirs || (res.image ? { image: res.image } : null));
    if (!dirs) { grid.appendChild(el("div.empty", { text: "Art unavailable." })); return; }
    for (const [dir, url] of Object.entries(dirs)) {
      const cv = el("canvas.spr", { width: 96, height: 96 });
      drawSprite(cv, url, 96);
      grid.appendChild(el("div.dircell", null, [cv, el("div.lbl", { text: dir })]));
    }
  })();
}

function pageSprites(root) {
  clear(root);
  const page = el("div.page");
  page.appendChild(el("div.banner.info", { html: "Every drawable sprite in the game — characters, world objects, monsters, item icons, biome tiles and map icons. Sprites are identified by <b>id</b> only (names belong to the instantiated Player / NPC / World Objects / Monsters / Items / Biomes, not the shared art). Click an id to open its sprite page (art, state tree &amp; animations)." }));
  page.appendChild(spriteCreateCard());
  const genBoard = el("div");
  GenJobs.mountBoard(genBoard, {});
  page.appendChild(genBoard);

  const CATS = [["character", "Character"], ["object", "Object"], ["monster", "Monster"], ["ui", "Item"], ["tile", "Biome"], ["map", "Map icon"]];
  const rows = [];
  for (const [t, label] of CATS) {
    const p = Providers.get(t); if (!p || !p.list) continue;
    if (t === "map") {
      // one row per map icon; sprite id = the POI type it marks (anvil, bank, quest…)
      for (const e of p.list()) rows.push({ e, provider: p, type: t, cat: label, id: e.poi || e.key, name: e.name });
    } else if (t === "ui") {
      // Items are single icons; many items share one icon → one sprite row per
      // icon key (uiIconGroups is the shared source of truth). The sprite id shown
      // is the ITEM the sprite is assigned to (its group's representative item id);
      // the rest of the items sharing the icon are listed as "also".
      const idOf = e => String(e.itemId || e.key);
      for (const g of uiIconGroups().values()) {
        const others = g.members.filter(m => m !== g.rep).map(idOf).sort();
        rows.push({ e: g.rep, provider: p, type: t, cat: label, id: idOf(g.rep), name: g.rep.name, also: others });
      }
    } else if (t === "monster" && p.layerKeys) {
      // dedupe monsters that share a sprite (base + giant/baby variants, and any
      // reskins pointing at the same art) → one row, one shared sprite id.
      const groups = new Map();
      for (const e of p.list()) {
        const keys0 = (p.layerKeys(e.key, 0) || []).filter(Boolean);    // south-facing layer keys = sprite identity
        let spriteId = (p.isDir && p.isDir(e)) ? String(keys0[0] || "").replace(/_south$/, "") : keys0.join("+");
        if (!spriteId) spriteId = e.key;                                // no resolvable sprite → keep it a distinct row
        let g = groups.get(spriteId);
        if (!g) { g = { rep: e, members: [], spriteId }; groups.set(spriteId, g); }
        g.members.push(e);
        // prefer a base key (no _v/_baby suffix), then the shortest, as the representative
        const isBase = x => !/(_v|_baby)$/.test(x.key);
        if ((isBase(e) && !isBase(g.rep)) || (isBase(e) === isBase(g.rep) && e.key.length < g.rep.key.length)) g.rep = e;
      }
      for (const g of groups.values()) {
        // biome variants share one sprite → collapse to the base monster for the
        // sprites tab (art view); the per-biome listings live in the Monsters tab.
        const baseNm = m => (m.baseKey && typeof MONSTERS !== "undefined" && MONSTERS[m.baseKey] && MONSTERS[m.baseKey].name) || m.name || Roster.prettyName(m.key);
        const repName = baseNm(g.rep);
        const others = [...new Set(g.members.map(baseNm))].filter(n => n !== repName);
        const repEntry = { ...g.rep, key: g.rep.baseKey || g.rep.key };   // navigate to the base sprite
        rows.push({ e: repEntry, provider: p, type: t, cat: label, id: g.spriteId, name: repName, also: others });
      }
    } else if (t === "tile") {
      // one row per BIOME (its ground tile is a single sprite with a 4-variant
      // deck on its page); flat/misc terrain tiles list individually.
      const groups = new Map(); const flats = [];
      for (const e of p.list()) {
        const m = /^bg_(\d+)_\d+$/.exec(e.key);
        if (!m) { flats.push(e); continue; }
        if (!groups.has(m[1])) groups.set(m[1], e);   // first variant = representative
      }
      for (const [b, e] of groups) rows.push({ e, provider: p, type: t, cat: label, id: e.snake || ("bg_" + b), name: String(e.name).replace(/\s*·.*$/, "") });
      // single-tile flat/misc terrain (grass, dirt, moa footprint…) aren't biomes → "Other"
      for (const e of flats) rows.push({ e, provider: p, type: t, cat: "Other", id: e.key, name: e.name });
    } else {
      for (const e of p.list()) rows.push({ e, provider: p, type: t, cat: label, id: e.snake || e.key, name: e.name || Roster.prettyName(e.key) });
    }
  }
  rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // No top search bar — the per-column TableFilter controls replace it.
  const catCard = el("div.card");
  const countBadge = el("span.badge", { id: "spr-count", text: "…" });
  catCard.appendChild(el("div.sectitle", null, [el("h3", null, ["All sprites ", el("span.hint", { text: "characters, objects, monsters, item icons & community-published sprites" })]), countBadge]));
  const holder = el("div"); catCard.appendChild(holder);
  page.appendChild(catCard);

  const th = "border-bottom:1px solid var(--line,#333);padding:.4rem .55rem;text-align:left;font-size:.7rem;letter-spacing:.02em;color:var(--ink-dim);white-space:nowrap;position:sticky;top:0;background:var(--bg-1,#111)";
  const td = CAT_TD;
  // Community-published sprites (loaded async below) are folded into this same
  // table as extra rows, tagged "community" + @author and clickable to view all
  // directions. Each carries a `community` flag so render() uses its thumbnail
  // and published-view modal instead of a game provider's draw().
  let pubRows = [];
  function render() {
    clear(holder);
    const shown = rows.concat(pubRows);
    countBadge.textContent = shown.length + " sprites" + (pubRows.length ? " · " + pubRows.length + " community" : "");
    if (!shown.length) { holder.appendChild(el("div.empty", { text: "No sprites in the game catalog." })); return; }
    const table = el("table", { style: "border-collapse:collapse;width:100%" });
    // TableFilter.enhance adds a filter field at the top of each column (incl.
    // Sprite size & Directions) — the cells stay plain text, not editable.
    table.appendChild(el("tr", null, ["Sprite id", "Category", "Sprite size", "Directions", "Human/AI", "Artist/Prompter"].map(h =>
      el("th", { style: th, text: h }))));
    for (const r of shown) {
      if (r.community) { table.appendChild(communitySpriteRow(r, td)); continue; }
      const cv = el("canvas", { width: 64, height: 64, style: CAT_ICON });
      try { r.provider.draw(cv, r.e, 0); } catch (_) {}
      const idLink = el("a", { style: "color:inherit;text-decoration:none;font-family:monospace;font-size:.78rem;font-weight:600;cursor:pointer", text: String(r.id), href: "#/sprite?type=" + r.type + "&key=" + encodeURIComponent(r.e.key) });
      // For item icons shared by several items, name the others so the row
      // corresponds to every item it's assigned to.
      const idBox = el("div", { style: "display:flex;flex-direction:column;gap:.1rem" }, [
        el("div", { style: "display:flex;align-items:center;gap:.6rem" }, [cv, idLink]),
        (r.type === "ui" && r.also && r.also.length)
          ? el("span.hint", { style: "font-size:.66rem;font-family:monospace;padding-left:calc(48px + .6rem);white-space:normal;max-width:20rem;word-break:break-word;line-height:1.3", text: "also: " + r.also.join(", ") }) : null,
      ]);
      const mk = spriteMakerCells(r.provider, r.e);
      const sz = spriteRowSize(r);
      table.appendChild(el("tr", null, [
        el("td", { style: td }, [idBox]),
        el("td", { style: td }, [el("span.badge", { text: r.cat })]),
        el("td", { style: td + ";font-family:monospace;color:var(--ink-dim)", text: sz ? sz[0] + "×" + sz[1] : "—" }),
        el("td", { style: td + ";color:var(--ink-dim)", text: String(spriteRowDirs(r)) }),
        el("td", { style: td }, [mk.originHost]),
        el("td", { style: td }, [mk.makerHost]),
      ]));
    }
    holder.appendChild(el("div", { style: "overflow-x:auto" }, [TableFilter.enhance(table)]));
  }
  render();
  // Fold in community-published sprites once they load, then repaint.
  (async () => {
    const items = await publishedSpritesCached();
    pubRows = items.map(it => ({
      community: true, pub: it, id: it.sprite_id, cat: "Community",
      type: publishedRowType(it.category), categoryRaw: it.category,
      name: it.name, thumb: it.thumb, username: it.username, dirs: publishedRowDirs(it.category),
    }));
    if (pubRows.length) render();
  })();
  root.appendChild(page);
}

// One "All sprites" row for a community-published sprite: thumbnail, mono
// sprite_id that opens the view-all-directions modal, a "community" origin tag
// and the maker's @handle.
function communitySpriteRow(r, td) {
  const icon = r.thumb
    ? el("img", { src: r.thumb, alt: r.id, style: CAT_ICON + ";object-fit:contain", loading: "lazy" })
    : el("div", { style: CAT_ICON + ";display:flex;align-items:center;justify-content:center;font-size:1.3rem", text: (typeof _catIcon === "function" ? _catIcon(r.categoryRaw) : "✨") });
  const idLink = el("a", { style: "color:inherit;text-decoration:none;font-family:monospace;font-size:.78rem;font-weight:600;cursor:pointer", text: String(r.id), href: "#", onclick: e => { e.preventDefault(); openPublishedView(r.pub); } });
  const idBox = el("div", { style: "display:flex;flex-direction:column;gap:.1rem" }, [
    el("div", { style: "display:flex;align-items:center;gap:.6rem" }, [icon, idLink]),
    el("span.hint", { style: "font-size:.66rem;padding-left:calc(48px + .6rem)", text: r.categoryRaw }),
  ]);
  return el("tr", null, [
    el("td", { style: td }, [idBox]),
    el("td", { style: td }, [el("span.badge", { text: r.cat })]),
    el("td", { style: td + ";font-family:monospace;color:var(--ink-dim)", text: "—" }),
    el("td", { style: td + ";color:var(--ink-dim)", text: String(r.dirs) }),
    el("td", { style: td }, [el("span.badge", { text: "community" })]),
    el("td", { style: td }, ["@" + (r.username || "someone")]),
  ]);
}

function pageCatalog(root, type, opts) {
  opts = opts || {};
  clear(root);
  const provider = Providers.get(type);
  if (!provider) { root.appendChild(el("div.empty", { text: "Unknown asset type." })); return; }
  const noun = provider.label.toLowerCase();
  const page = el("div.page");

  page.appendChild(el("div.banner.info", { html:
    "A communal, public catalog of every " + noun + " in the game. " +
    (provider.supportsGen ? (Taiao.logged() ? "" : '<a href="#/settings">Sign in</a> to create, publish and vote.') : "Browse the art and the raw in-game data.") }));

  // Character ENTITIES are created here (id + stats + a default sprite); their
  // ART is generated separately on the Sprites tab. Objects/monsters just point
  // to the Sprites tab for their art.
  if (type === "character") {
    const roster = opts.roster === "npc" ? "npc" : "player";
    const gen = el("details.card");
    gen.appendChild(el("summary", { style: "cursor:pointer;font-weight:650", text: "＋ Create a new " + (roster === "npc" ? "NPC" : "player character") }));
    const body = el("div", { style: "margin-top:.8rem" });
    body.appendChild(el("p.tagline", { html: 'Give it an id, stats and a default sprite. Generate the sprite art first on the <a href="#/sprites">Sprites tab</a>.' }));
    buildCharacterCreator(body, roster);
    gen.appendChild(body); page.appendChild(gen);
  } else if (type === "monster" || type === "object") {
    const noun2 = type === "monster" ? "monster" : "world object";
    const gen = el("details.card");
    gen.appendChild(el("summary", { style: "cursor:pointer;font-weight:650", text: "＋ Create a new " + noun2 }));
    const body = el("div", { style: "margin-top:.8rem" });
    body.appendChild(el("p.tagline", { html: 'Give it an id, a sprite, and its ' + (type === "monster" ? "stats, behaviour and biome" : "biome and properties") + '. Generate the sprite art first on the <a href="#/sprites">Sprites tab</a>.' }));
    buildEntityCreator(body, type);
    gen.appendChild(body); page.appendChild(gen);
  } else if (provider.supportsGen) {
    page.appendChild(el("div.banner.info", { html: 'Create new ' + noun + ' art on the <a href="#/sprites">Sprites tab</a> — generate with PixelLab or upload your own.' }));
  }

  // No top search bar — the per-column TableFilter controls replace it. The
  // roster split (players vs NPCs) is still pre-applied from the tab config.
  const rosterFilter = opts.roster || "all";

  // catalog table — skipped for the Map/Procgen tab, which now shows ONLY the
  // world-generation voting card below (map icons moved to the Sprites tab).
  if (type !== "map") {
    const countBadge = el("span.badge", { id: "cat-count", text: "…" });
    const headTitle = el("h3", null, [(opts.title || provider.catalogTitle || "All game " + provider.plural.toLowerCase()) + " ", el("span.hint", { text: "everything currently in the game" })]);
    const grid = el("div.grid-cards");
    if (type === "ui" || type === "monster" || type === "object" || type === "character" || type === "tile" || type === "sound") grid.style.display = "block";   // these render as tables, not cards
    const catCard = el("div.card");
    catCard.appendChild(el("div.sectitle", null, [headTitle, countBadge]));
    catCard.appendChild(grid);
    page.appendChild(catCard);

    const entries = provider.list();
    const render = () => {
      clear(grid);
      if (!entries.length) { qs("#cat-count", catCard).textContent = "0"; grid.appendChild(el("div.empty", { html: "<div class='big'>📭</div>" + (provider.note || "No game data for this type is reachable here.") + "<br><small>Serve the studio from the game repo root so <span class='mono'>../js</span> resolves.</small>" })); return; }
      let pool = entries;
      if (rosterFilter !== "all") pool = entries.filter(e => rosterFilter === "npc" ? e.npc : !e.npc);
      const shown = pool;
      // Biomes counts distinct biomes (= table rows), not every ground-tile entry.
      if (type === "tile") {
        const biomes = new Set(pool.map(e => (/^bg_(\d+)_\d+$/.exec(e.key) || [])[1]).filter(x => x != null));
        qs("#cat-count", catCard).textContent = biomes.size + (biomes.size === 1 ? " biome" : " biomes");
      } else qs("#cat-count", catCard).textContent = pool.length + " " + provider.plural.toLowerCase();
      if (!shown.length) { grid.appendChild(el("div.empty", { text: "No " + provider.plural.toLowerCase() + " match your filters." })); return; }
      // Every matching row is rendered — no cap. The per-column filter/sort
      // controls (TableFilter) then operate over the complete set.
      if (type === "ui") { grid.appendChild(itemsTable(shown, provider)); return; }
      if (type === "monster") { grid.appendChild(monsterCatalogTable(shown, provider)); return; }
      if (type === "object") { grid.appendChild(objectCatalogTable(shown, provider)); return; }
      if (type === "character") { grid.appendChild(playerCatalogTable(shown, provider)); return; }
      if (type === "tile") { grid.appendChild(biomeDataTable(shown, provider)); return; }
      if (type === "sound") { grid.appendChild(soundsTable(shown, provider)); return; }
      for (const e of shown) grid.appendChild(catalogTile(e, provider));
    };
    render();

    // community-shared generations are merged straight into this same listing card
    // (no separate "Community versions" section) — they sit below the in-game rows,
    // in their own container so re-rendering the grid above never clears them.
    if (provider.supportsGen) {
      const comHost = el("div"); catCard.appendChild(comHost);
      Taiao.listCommunity().then(all => {
        const mine = all.filter(p => p._subj.kind === type);
        clear(comHost);
        if (!mine.length) return;
        const g = el("div.grid-cards", { style: "margin-top:.7rem" });
        for (const p of mine) g.appendChild(communityTile(p, type));
        comHost.appendChild(g);
      }).catch(() => {});
    }
  }

  // your local drafts (only for generatable types)
  if (provider.supportsGen) {
    const draftCard = el("div.card");
    draftCard.appendChild(el("div.sectitle", null, [el("h3", null, ["Your drafts ", el("span.hint", { text: "local until you publish" })]), el("span.badge", { id: "draft-count", text: "…" })]));
    const draftGrid = el("div.grid-cards"); draftCard.appendChild(draftGrid);
    page.appendChild(draftCard);
    Store.all(type).then(rows => {
      qs("#draft-count", draftCard).textContent = rows.length + " saved";
      clear(draftGrid);
      if (!rows.length) { draftGrid.appendChild(el("div.empty", { html: "<div class='big'>📦</div>No drafts yet — create one above." })); return; }
      for (const p of rows) draftGrid.appendChild(projectTile(p));
    });
  }

  if (type === "map") page.appendChild(mapGenCard());

  root.appendChild(page);
}

// ---------- map generation: vote on the actual per-entity world-gen rules ----------
// Subject gen:mapgen:world. One tally fetch drives everything; heavy per-entity
// sections (POIs, biomes, name parts) render lazily when their <details> opens.
const FREQ = ["-50%", "-25%", "current", "+25%", "+50%"];  // percentage deltas around the present setting

function mapGenCard() {
  const card = el("div.card");
  card.appendChild(el("h3", null, ["World generation ", el("span.hint", { text: "vote on every world-generation rule" })]));
  card.appendChild(el("p.tagline", null, [Taiao.logged() ? "Vote on any rule — the community steers world generation. Each frequency shows the current setting with lower/higher options." : el("span", { html: '<a href="#/settings">Sign in</a> to vote on world-generation rules.' })]));

  const state = { tallies: {} };
  const refetch = async () => { try { state.tallies = await Taiao.tally("mapgen", "world"); } catch (_) {} };

  // one votable field → a row of choice chips (current choice marked)
  // Every map-gen rule now votes through the ubiquitous 🗳 symbol: a dropdown of
  // the preset choices, plus a free-text box (for the "±n%" custom deltas).
  function chips(field, choices, current, after, numeric) {
    return VoteWidget.symbol({
      kind: "mapgen", folder: "world", field,
      type: "select",
      choices: (choices || []).map(c => ({ value: c, label: String(c).replace(/_/g, " ") })),
      current, currentLabel: current != null ? String(current).replace(/_/g, " ") : null,
      custom: !!numeric, customPlaceholder: "+n% / -n%",
      label: String(field).replace(/[:_]/g, " "),
      getTallies: () => state.tallies,
      refetch: async () => { await refetch(); after(); },
    });
  }
  function row(host, field, label, choices, current, after) {
    const lbl = el("div.mglabel", null, [label]);
    const now = (typeof MAPGEN_CURRENT !== "undefined" && MAPGEN_CURRENT[field]) || null;
    if (now) lbl.appendChild(el("span.mono", { style: "color:var(--gold);margin-left:.4rem", text: "current: " + now }));
    host.appendChild(el("div.mgrow", null, [lbl, chips(field, choices, current, after, choices === FREQ)]));
  }

  // ---- world-gen parameters, each shown as its real equation (traced from
  //      js/world/terrain.js). The 🗳 at the end of an equation opens a dialog
  //      to vote on any float in that equation. ----
  const thc = t => el("th", { text: t, style: "text-align:left;padding:.3rem .6rem;border-bottom:1px solid var(--line,#333);color:var(--ink-dim);font-weight:600" });
  const tdc = content => el("td", { style: "padding:.3rem .6rem;border-bottom:1px solid var(--line,#2a2a2a);vertical-align:top" }, [content]);

  // A 🗳 whose popover lets you vote on EVERY float in one equation.
  function eqVote(name, floats) {
    return VoteWidget.symbol({
      kind: "mapgen", folder: "world", label: name, hideTally: true,
      render: (box, api) => {
        const body = el("div"); box.appendChild(body);
        const cast = async (field, v) => {
          v = String(v == null ? "" : v).trim(); if (!v) { toast("Enter a value first.", "warn"); return; }
          if (!Taiao.logged()) { toast("Sign in to vote.", "warn"); api.close(); App.go("#/settings"); return; }
          const r = await Taiao.castVote("mapgen", "world", field, v.slice(0, 60));
          if (r && r.error) { toast(r.error, "err"); return; }
          toast("Vote recorded.", "ok"); try { await refetch(); } catch (_) {} build();
        };
        function build() {
          clear(body);
          floats.forEach(fl => {
            const rowEl = el("div", { style: "margin:.45rem 0 0;padding-top:.4rem;border-top:1px solid var(--line,#2a2a2a)" });
            rowEl.appendChild(el("div.mono", { style: "font-size:.78rem", text: fl.label + "  ·  current " + fl.value }));
            const input = el("input.vote-input", { type: "number", step: "any", placeholder: String(fl.value), style: "width:120px" });
            input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); cast(fl.field, input.value); } });
            rowEl.appendChild(el("div", { style: "display:flex;align-items:center;gap:.4rem;margin-top:.25rem" }, [
              input, el("button.btn.sm.primary", { text: "Vote", onclick: () => cast(fl.field, input.value) }),
            ]));
            const t = (state.tallies || {})[fl.field] || {};
            const mine = (typeof Taiao !== "undefined" && Taiao.myVote) ? Taiao.myVote("mapgen", "world", fl.field) : null;
            const keys = Object.keys(t).sort((a, b) => t[b] - t[a]).slice(0, 6);
            if (keys.length) rowEl.appendChild(el("div", { style: "display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.25rem" },
              keys.map(k => el("span.chip.sm" + (mine === k ? ".on" : ""), { html: escapeHtml(k) + " <b>" + t[k] + "</b>", onclick: () => cast(fl.field, k) }))));
            body.appendChild(rowEl);
          });
        }
        build();
      },
    });
  }
  // one equation row: parameter name | <equation> 🗳
  function eqRow(p) {
    const eqCell = el("span", { style: "display:inline-flex;align-items:baseline;gap:.5rem;flex-wrap:wrap" }, [el("span.mono", { text: p.eq })]);
    if (p.floats && p.floats.length) eqCell.appendChild(eqVote(p.name, p.floats));
    return el("tr", null, [tdc(el("span.mono", { text: p.name })), tdc(eqCell)]);
  }
  function eqTable(host, list) {
    clear(host);
    const t = el("table", { style: "border-collapse:collapse;font-size:.82rem;width:100%" });
    t.appendChild(el("tr", null, [thc("Parameter"), thc("Equation")]));
    (list || []).forEach(p => t.appendChild(eqRow(p)));
    host.appendChild(t);
  }
  const arr = a => (Array.isArray(a) ? a : []);
  const wrap = el("div");
  const sysByTitle = t => (typeof MAPGEN_SYSTEMS !== "undefined" ? MAPGEN_SYSTEMS : []).find(s => s.title === t);
  const GAME_SYS = ["Celestial (moon & aurora)", "Fauna (bird flight)"];   // moved into Game Parameters
  const section = (host, title, note, rows) => {
    host.appendChild(el("h3", { style: "font-size:.92rem;margin-top:.9rem;color:var(--accent)", text: title }));
    if (note) host.appendChild(el("p.tagline", { style: "font-size:.72rem", text: note }));
    const h = el("div"); host.appendChild(h); eqTable(h, rows);
  };
  // ===== World generation (this card): world-gen params, derived fields, systems, biomes =====
  section(card, "World-Gen Parameters", "Every parameter of the terrain/field generation as its real equation (traced from terrain.js). 🗳 at the end of a row votes on any number in that equation.",
    [].concat(arr(typeof MAPGEN_PRIMITIVES !== "undefined" && MAPGEN_PRIMITIVES), arr(typeof MAPGEN_FIELD_PARAMS !== "undefined" && MAPGEN_FIELD_PARAMS), arr(typeof MAPGEN_SCALARS !== "undefined" && MAPGEN_SCALARS)));
  section(card, "Derived Fields & Systems", "Temperature & Humidity derive from Elevation + Latitude; rivers, roads, settlements & vegetation are stamped per chunk.",
    arr(typeof MAPGEN_DERIVED !== "undefined" && MAPGEN_DERIVED).filter(r => r.key !== "rain_shadow"));
  (typeof MAPGEN_SYSTEMS !== "undefined" ? MAPGEN_SYSTEMS : []).filter(s => GAME_SYS.indexOf(s.title) < 0).forEach(sec => section(card, sec.title, sec.note, sec.rows));

  // ---- per-biome rules (have/not, placement, frequency) ----
  const biomes = (typeof BIOME_NAMES !== "undefined" ? BIOME_NAMES : []);
  // spawn-range axes: elevation/temperature/humidity/weird/farm/civ, plus a
  // longitude column (biomes never gate on longitude, so it's always [0,1]).
  const BIOME_AXES = [
    ["e", "Elevation"], ["temp", "Temperature"], ["hum", "Humidity"],
    ["w", "Weird"], ["f", "Farm"], ["c", "Civ"], ["lon", "Longitude"],
  ];
  // The exact classify() decision tree (terrain.js). Each test's condition is a
  // list of TERMS (variable · comparator · threshold); every part is votable.
  const VARMAP = { e: "Elevation", temp: "Temperature", hum: "Humidity", w: "Weird", f: "Farm", c: "Civ", lon: "Longitude" };
  const VAR_NAMES = ["Elevation", "Temperature", "Humidity", "Weird", "Farm", "Civ", "Longitude"];
  const OPS = ["<", ">", "≤", "≥", "=", "≠"];
  const tm = (v, op, val, key) => ({ v, op, val, key });
  const REST = {
    q: "weird > 0.76", t: [tm("w", ">", "0.76", "classify.fantasy_w")],
    y: {
      q: "hum > 0.53", t: [tm("hum", ">", "0.53", "classify.fantasy_hum")],
      y: { q: "temp > 0.55", t: [tm("temp", ">", "0.55", "classify.mushroom_t")], y: { b: "Giant Mushroom Forest" },
           n: { q: "temp < 0.42", t: [tm("temp", "<", "0.42", "classify.ash_t")], y: { b: "Ashen Forest" }, n: { b: "Dream Forest" } } },
      n: { q: "temp > 0.64 & hum < 0.48", t: [tm("temp", ">", "0.64", "classify.salt_t"), tm("hum", "<", "0.48", "classify.salt_hum")], y: { b: "Salt Flats" },
           n: { q: "temp < 0.34", t: [tm("temp", "<", "0.34", "classify.crystal_t")], y: { b: "Crystal Fields" },
                n: { q: "temp > 0.55", t: [tm("temp", ">", "0.55", "classify.bone_t")], y: { b: "Bone Fields" }, n: { b: "Labyrinth" } } } },
    },
    n: {
      q: "weird < 0.24", t: [tm("w", "<", "0.24", "classify.lowmagic_w")],
      y: { q: "temp < 0.50", t: [tm("temp", "<", "0.50", "classify.wild_t")], y: { b: "Wilderness" }, n: { b: "Ruins" } },
      n: {
        q: "temp < 0.24", t: [tm("temp", "<", "0.24", "classify.cold_t")],
        y: { q: "elevation > 0.58", t: [tm("e", ">", "0.58", "classify.cold_glacier_e")], y: { b: "Glacier" }, n: { b: "Snowy Peaks" } },
        n: {
          q: "temp < 0.32", t: [tm("temp", "<", "0.32", "classify.boreal_t")],
          y: { q: "hum > 0.50", t: [tm("hum", ">", "0.50", "classify.taiga_hum")], y: { b: "Taiga" }, n: { b: "Tundra" } },
          n: {
            q: "temp < 0.42", t: [tm("temp", "<", "0.42", "classify.subpolar_t")],
            y: { q: "hum > 0.55", t: [tm("hum", ">", "0.55", "classify.taiga2_hum")], y: { b: "Taiga" },
                 n: { q: "hum > 0.35", t: [tm("hum", ">", "0.35", "classify.tundra_hum")], y: { b: "Tundra" }, n: { b: "Snowy Peaks" } } },
            n: {
              q: "temp > 0.65  (tropical)", t: [tm("temp", ">", "0.65", "classify.tropical_t")],
              y: { q: "hum < 0.26", t: [tm("hum", "<", "0.26", "classify.reddesert_hum")], y: { b: "Red Desert" },
                   n: { q: "hum < 0.44", t: [tm("hum", "<", "0.44", "classify.desert_hum")],
                        y: { q: "farm > 0.78", t: [tm("f", ">", "0.78", "classify.oasis_farm")], y: { b: "Oasis" }, n: { b: "Desert" } },
                        n: { q: "hum < 0.58", t: [tm("hum", "<", "0.58", "classify.savanna_hum")], y: { b: "Savanna" },
                             n: { q: "hum < 0.70", t: [tm("hum", "<", "0.70", "classify.jungle_hum")],
                                  y: { q: "farm > 0.64", t: [tm("f", ">", "0.64", "classify.bamboo_farm")], y: { b: "Bamboo Grove" }, n: { b: "Jungle" } },
                                  n: { b: "Wetlands" } } } } },
              n: {
                q: "temp > 0.56 & hum < 0.32", t: [tm("temp", ">", "0.56", "classify.badlands_t"), tm("hum", "<", "0.32", "classify.badlands_hum")],
                y: { b: "Badlands" },
                n: { q: "hum < 0.28", t: [tm("hum", "<", "0.28", "classify.steppe_hum")], y: { b: "Steppe" },
                     n: { q: "hum > 0.72", t: [tm("hum", ">", "0.72", "classify.swamp_hum")], y: { b: "Swamp" },
                          n: { q: "hum > 0.55", t: [tm("hum", ">", "0.55", "classify.forest_hum")],
                               y: { q: "farm > 0.70 & temp > 0.44", t: [tm("f", ">", "0.70", "classify.blossom_farm"), tm("temp", ">", "0.44", "classify.blossom_temp")], y: { b: "Blossom Grove" }, n: { b: "Forest" } },
                               n: { q: "farm > 0.62 & civ > 0.48", t: [tm("f", ">", "0.62", "classify.farm_farm"), tm("c", ">", "0.48", "classify.farm_civ")], y: { b: "Farmland" },
                                    n: { q: "hum > 0.46", t: [tm("hum", ">", "0.46", "classify.meadow_hum")], y: { b: "Meadow" }, n: { b: "Plains" } } } } } },
              },
            },
          },
        },
      },
    },
  };
  const CLS_TREE = {
    q: "elevation < 0.40", t: [tm("e", "<", "0.40", "classify.deep_e")],
    y: { b: "Deep Sea" },
    n: {
      q: "elevation < 0.483  (sea level)", t: [tm("e", "<", "0.483", "land_e")],
      y: { q: "temp > 0.68 & elevation > 0.44 & weird > 0.62", t: [tm("temp", ">", "0.68", "classify.reef_temp"), tm("e", ">", "0.44", "classify.reef_e"), tm("w", ">", "0.62", "classify.reef_w")], y: { b: "Coral Reef" }, n: { b: "Sea" } },
      n: {
        q: "elevation < 0.497  (beach)", t: [tm("e", "<", "0.497", "classify.beach_e")],
        y: { b: "Beach" },
        n: {
          q: "elevation > 0.655  (rock line)", t: [tm("e", ">", "0.655", "rock_e")],
          y: { q: "weird > 0.74", t: [tm("w", ">", "0.74", "classify.volcano_w")], y: { b: "Volcano" },
               n: { q: "temp < 0.22", t: [tm("temp", "<", "0.22", "classify.glacier_t")], y: { b: "Glacier" },
                    n: { q: "temp < 0.42", t: [tm("temp", "<", "0.42", "classify.snow_t")], y: { b: "Snowy Peaks" }, n: { b: "Mountains" } } } },
          n: {
            q: "elevation > 0.615  (highland)", t: [tm("e", ">", "0.615", "classify.highland_e")],
            y: { q: "temp < 0.22", t: [tm("temp", "<", "0.22", "classify.hi_glacier_t")], y: { b: "Glacier" },
                 n: { q: "temp < 0.38", t: [tm("temp", "<", "0.38", "classify.hi_snow_t")], y: { b: "Snowy Peaks" },
                      n: { q: "hum < 0.32 & temp > 0.55", t: [tm("hum", "<", "0.32", "classify.canyon_hum"), tm("temp", ">", "0.55", "classify.canyon_temp")], y: { b: "Canyon" },
                           n: { q: "hum > 0.58 & temp < 0.52", t: [tm("hum", ">", "0.58", "classify.moor_hum"), tm("temp", "<", "0.52", "classify.moor_temp")], y: { b: "Heather Moor" },
                                n: { q: "elevation > 0.64", t: [tm("e", ">", "0.64", "classify.rocky_e")], y: { b: "Rockyland" }, n: { c: "↓ else: falls through to the NO branch below" } } } } } },
            n: REST,
          },
        },
      },
    },
  };
  // path feasibility — each variable's allowed [lo,hi] given the branches taken.
  const NAME2KEY = { Elevation: "e", Temperature: "temp", Humidity: "hum", Weird: "w", Farm: "f", Civ: "c", Longitude: "lon" };
  const cloneCtx = ctx => { const o = {}; for (const k in ctx) o[k] = [ctx[k][0], ctx[k][1]]; return o; };
  const applyTerm = (ctx, vkey, op, val) => {
    val = parseFloat(val); if (isNaN(val) || !ctx[vkey]) return; const iv = ctx[vkey];
    if (op === "<" || op === "≤") iv[1] = Math.min(iv[1], val);
    else if (op === ">" || op === "≥") iv[0] = Math.max(iv[0], val);
    else if (op === "=") { iv[0] = Math.max(iv[0], val); iv[1] = Math.min(iv[1], val); }
    // "≠" can't constrain a continuous [lo,hi] interval (it removes a single
    // point), so it leaves the range unchanged.
  };
  const applyTerms = (ctx, terms) => { (terms || []).forEach(t => applyTerm(ctx, t.v, t.op, t.val)); return ctx; };
  const negOp = op => op === "<" ? "≥" : op === ">" ? "≤" : op === "≤" ? ">" : op === "≥" ? "<" : op === "≠" ? "=" : op === "=" ? "≠" : null;
  const applyNeg = (ctx, terms) => { if (terms && terms.length === 1) { const t = terms[0], no = negOp(t.op); if (no) applyTerm(ctx, t.v, no, t.val); } return ctx; };  // compound NO is a disjunction — left unconstrained
  const feasible = ctx => { for (const k in ctx) if (ctx[k][0] > ctx[k][1] + 1e-9) return false; return true; };
  // a biome fits a branch only if its known field ranges still overlap the ctx.
  const biomeAxes = ["e", "temp", "hum", "w", "f", "c"];
  const biomeFits = (name, ctx) => {
    const R = (typeof BIOME_RANGES !== "undefined" && BIOME_RANGES[name]) || null;
    if (!R) return true;   // unknown ranges → don't block
    for (const k of biomeAxes) { const br = R[k], cv = ctx[k]; if (!br || !cv) continue;
      if (Math.max(br[0], cv[0]) > Math.min(br[1], cv[1]) + 1e-9) return false; }
    return true;
  };
  const BIOME_LIST = () => (typeof BIOME_NAMES !== "undefined" && BIOME_NAMES.length) ? BIOME_NAMES.slice()
    : (typeof BIOME_RANGES !== "undefined") ? Object.keys(BIOME_RANGES) : [];
  // field thresholds are all in [0,1] — arrows step by 0.01; typed values clamp.
  const unitInput = value => {
    const inp = el("input.vote-input", { type: "number", min: "0", max: "1", step: "0.01", value: value, style: "width:90px" });
    inp.addEventListener("input", () => { const v = parseFloat(inp.value); if (!isNaN(v)) { if (v < 0) inp.value = "0"; else if (v > 1) inp.value = "1"; } });
    return inp;
  };

  // 🗳 dialog for a test: edit its variable/comparator/threshold term(s), then a
  // single button votes the whole composed condition. A test that can't be true
  // given the branches above (ctx) is blocked.
  function condVote(label, terms, ctx) {
    const testField = "test:" + terms[0].key;
    return VoteWidget.symbol({
      kind: "mapgen", folder: "world", label: label, hideTally: true,
      render: (box, api) => {
        const body = el("div"); box.appendChild(body);
        const cast = async v => {
          if (!Taiao.logged()) { toast("Sign in to vote.", "warn"); api.close(); App.go("#/settings"); return; }
          const r = await Taiao.castVote("mapgen", "world", testField, String(v).slice(0, 60));
          if (r && r.error) { toast(r.error, "err"); return; }
          toast("Vote recorded.", "ok"); try { await refetch(); } catch (_) {} render2();
        };
        const selCtrl = (choices, current) => { const s2 = el("select.vote-input", { style: "width:auto" }); choices.forEach(o => s2.appendChild(el("option", { value: o, text: o }))); s2.value = current; return s2; };
        function render2() {
          clear(body);
          body.appendChild(el("p.tagline", { style: "font-size:.72rem;margin:.1rem 0 .3rem", text: "Edit the test, then cast one vote for the whole condition." }));
          const rows = terms.map((t, i) => {
            const vSel = selCtrl(VAR_NAMES, VARMAP[t.v] || t.v), oSel = selCtrl(OPS, t.op);
            const nInp = unitInput(t.val);
            body.appendChild(el("div", { style: "display:flex;align-items:center;gap:.35rem;margin:.25rem 0" }, [
              el("span.mono", { style: "width:1ch;color:var(--ink-dim)", text: i ? "&" : "" }), vSel, oSel, nInp,
            ]));
            return { vSel, oSel, nInp };
          });
          const entered = () => rows.map(r => ({ vName: r.vSel.value, op: r.oSel.value, val: r.nInp.value }));
          const note = el("div", { style: "font-size:.72rem;margin-top:.35rem" });
          const voteBtn = el("button.btn.sm.primary", { text: "Vote on this test" });
          const check = () => {
            const c2 = cloneCtx(ctx); entered().forEach(e => applyTerm(c2, NAME2KEY[e.vName] || e.vName, e.op, e.val));
            const ok = feasible(c2);
            voteBtn.disabled = !ok;
            note.style.color = ok ? "var(--ink-dim)" : "#e06a6a";
            note.textContent = ok ? "→ " + entered().map(e => e.vName + " " + e.op + " " + e.val).join(" & ")
                                  : "✕ impossible here — earlier branches already rule this out.";
            return ok;
          };
          rows.forEach(r => { r.vSel.addEventListener("change", check); r.oSel.addEventListener("change", check); r.nInp.addEventListener("input", check); });
          voteBtn.onclick = () => { if (check()) cast(entered().map(e => e.vName + " " + e.op + " " + e.val).join(" & ")); };
          body.appendChild(note);
          body.appendChild(el("div", { style: "margin-top:.4rem" }, [voteBtn]));
          const tl = (state.tallies || {})[testField] || {};
          const mine = (typeof Taiao !== "undefined" && Taiao.myVote) ? Taiao.myVote("mapgen", "world", testField) : null;
          const keys = Object.keys(tl).sort((a, b) => tl[b] - tl[a]).slice(0, 8);
          if (keys.length) body.appendChild(el("div", { style: "display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.4rem" },
            keys.map(k => el("span.chip.sm" + (mine === k ? ".on" : ""), { html: escapeHtml(k) + " <b>" + tl[k] + "</b>", onclick: () => cast(k) }))));
          check();
        }
        render2();
      },
    });
  }
  // 🗳 dialog for a leaf: (A) re-assign the biome (blocked if it contradicts the
  // branch), or (B) split the leaf into a new test with a YES-biome & a NO-biome.
  function leafVote(biome, ctx, path) {
    return VoteWidget.symbol({
      kind: "mapgen", folder: "world", label: "Leaf: " + biome, hideTally: true,
      render: (box, api) => {
        const body = el("div"); box.appendChild(body);
        const cast = async (field, v) => {
          if (!Taiao.logged()) { toast("Sign in to vote.", "warn"); api.close(); App.go("#/settings"); return; }
          const r = await Taiao.castVote("mapgen", "world", field, String(v).slice(0, 120));
          if (r && r.error) { toast(r.error, "err"); return; }
          toast("Vote recorded.", "ok"); try { await refetch(); } catch (_) {} render2();
        };
        const sel = (choices, current) => { const s2 = el("select.vote-input", { style: "width:auto;max-width:15rem" }); choices.forEach(o => s2.appendChild(el("option", { value: o, text: o }))); s2.value = current; return s2; };
        const chips = field => {
          const tl = (state.tallies || {})[field] || {};
          const mine = (typeof Taiao !== "undefined" && Taiao.myVote) ? Taiao.myVote("mapgen", "world", field) : null;
          const keys = Object.keys(tl).sort((a, b) => tl[b] - tl[a]).slice(0, 8);
          return keys.length ? el("div", { style: "display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.35rem" },
            keys.map(k => el("span.chip.sm" + (mine === k ? ".on" : ""), { html: escapeHtml(k) + " <b>" + tl[k] + "</b>", onclick: () => cast(field, k) }))) : null;
        };
        function render2() {
          clear(body);
          const NAMES = BIOME_LIST();
          // ---- (A) change biome ----
          body.appendChild(el("div", { style: "font-weight:700;font-size:.8rem;color:var(--accent)", text: "Change biome" }));
          const bSel = sel(NAMES, biome), bNote = el("div", { style: "font-size:.72rem;margin-top:.2rem" });
          const bBtn = el("button.btn.sm.primary", { text: "Vote biome" });
          const chkA = () => { const ok = bSel.value === biome || biomeFits(bSel.value, ctx); bBtn.disabled = !ok;
            bNote.style.color = ok ? "var(--ink-dim)" : "#e06a6a";
            bNote.textContent = ok ? "→ " + bSel.value : "✕ " + bSel.value + " can't occur on this branch."; return ok; };
          bSel.onchange = chkA;
          bBtn.onclick = () => { if (chkA()) cast("leaf:" + path, bSel.value); };
          body.appendChild(el("div", { style: "display:flex;align-items:center;gap:.4rem;margin-top:.25rem" }, [bSel, bBtn]));
          body.appendChild(bNote);
          const cA = chips("leaf:" + path); if (cA) body.appendChild(cA);
          // ---- (B) split into a test ----
          body.appendChild(el("div", { style: "font-weight:700;font-size:.8rem;color:var(--accent);margin-top:.7rem;padding-top:.5rem;border-top:1px solid var(--line,#2a2a2a)", text: "Split into a test" }));
          const yBio = sel(NAMES, biome), nBio = sel(NAMES, biome);
          const sNote = el("div", { style: "font-size:.72rem;margin-top:.3rem" });
          const sBtn = el("button.btn.sm.primary", { text: "Vote split" });
          // The test can AND together any number of terms (variable · operator ·
          // value), each on its own line, joined by "&" — exactly like the
          // compound conditions in the tree (e.g. "temp > 0.64 & hum < 0.48").
          const termRows = [];   // { rowEl, vSel, oSel, nInp, pre, rm }
          const termsHost = el("div");
          const readTerms = () => termRows.map(e => ({ v: NAME2KEY[e.vSel.value] || e.vSel.value, op: e.oSel.value, val: e.nInp.value }));
          const condStr = () => termRows.map(e => e.vSel.value + " " + e.oSel.value + " " + e.nInp.value).join(" & ");
          const renumber = () => termRows.forEach((e, i) => { e.pre.textContent = i ? "&" : "if"; e.rm.style.display = termRows.length > 1 ? "" : "none"; });
          const chkB = () => {
            const terms = readTerms();
            const yc = applyTerms(cloneCtx(ctx), terms), nc = applyNeg(cloneCtx(ctx), terms);
            const yReach = feasible(yc), nReach = feasible(nc);
            let ok = true, msg = "";
            if (terms.some(t => isNaN(parseFloat(t.val)))) { ok = false; msg = "Enter a threshold for every test."; }
            else if (!yReach) { ok = false; msg = "✕ test is always false here — the YES branch is unreachable."; }
            else if (!nReach) { ok = false; msg = "✕ test is always true here — the NO branch is unreachable."; }
            else if (!biomeFits(yBio.value, yc)) { ok = false; msg = "✕ YES biome ‘" + yBio.value + "’ contradicts the YES branch."; }
            else if (!biomeFits(nBio.value, nc)) { ok = false; msg = "✕ NO biome ‘" + nBio.value + "’ contradicts the NO branch."; }
            else { msg = "→ if " + condStr() + " : " + yBio.value + " · else " + nBio.value; }
            sBtn.disabled = !ok; sNote.style.color = ok ? "var(--ink-dim)" : "#e06a6a"; sNote.textContent = msg; return ok;
          };
          const addTerm = init => {
            init = init || { v: "Elevation", op: "<", val: "0.5" };
            const vSel = sel(VAR_NAMES, init.v), oSel = sel(OPS, init.op), nInp = unitInput(init.val);
            const pre = el("span.mono", { style: "min-width:1.6ch;text-align:right;font-size:.72rem;color:var(--ink-dim)" });
            const rm = el("button.btn.sm.ghost", { text: "✕", title: "remove this test", style: "padding:.05rem .35rem;line-height:1" });
            const rowEl = el("div", { style: "display:flex;align-items:center;gap:.35rem;margin-top:.25rem;flex-wrap:wrap" }, [pre, vSel, oSel, nInp, rm]);
            const entry = { rowEl, vSel, oSel, nInp, pre, rm };
            rm.onclick = () => { const i = termRows.indexOf(entry); if (i < 0 || termRows.length <= 1) return; termRows.splice(i, 1); rowEl.remove(); renumber(); chkB(); };
            [vSel, oSel].forEach(s2 => s2.onchange = chkB); nInp.oninput = chkB;
            termRows.push(entry); termsHost.appendChild(rowEl); renumber();
            return entry;
          };
          const addBtn = el("button.btn.sm.ghost", { text: "+ Add test", style: "margin-top:.3rem", onclick: () => { addTerm(); chkB(); } });
          sBtn.onclick = () => { if (chkB()) cast("split:" + path, condStr() + " ? " + yBio.value + " : " + nBio.value); };
          body.appendChild(termsHost);
          body.appendChild(addBtn);
          body.appendChild(el("div", { style: "display:flex;align-items:center;gap:.35rem;margin-top:.35rem;flex-wrap:wrap" }, [el("span", { style: "font-size:.66rem;font-weight:700;color:#5bbd6b", text: "YES →" }), yBio, el("span", { style: "font-size:.66rem;font-weight:700;color:var(--ink-dim)", text: "NO →" }), nBio]));
          [yBio, nBio].forEach(s2 => s2.onchange = chkB);
          body.appendChild(el("div", { style: "margin-top:.4rem" }, [sBtn]));
          body.appendChild(sNote);
          const cB = chips("split:" + path); if (cB) body.appendChild(cB);
          addTerm();   // start with one test row
          chkA(); chkB();
        }
        render2();
      },
    });
  }
  function renderNode(nd, ctx, path) {
    if (nd.b != null) return el("span", { style: "display:inline-flex;align-items:center;gap:.35rem" }, [
      el("span.mono", { style: "display:inline-block;padding:.12rem .5rem;border-radius:.5rem;background:var(--bg-2);border:1px solid var(--gold);color:var(--gold);font-weight:650", text: "🌿 " + nd.b }),
      leafVote(nd.b, ctx, path),
    ]);
    if (nd.c != null) return el("span.tagline", { style: "font-style:italic;font-size:.72rem", text: nd.c });
    const cond = el("span", { style: "display:inline-flex;align-items:center;gap:.35rem" }, [
      el("span.mono", { style: "display:inline-block;padding:.12rem .5rem;border:1px solid var(--line,#444);border-radius:.4rem;background:var(--bg-1)", text: nd.q }),
    ]);
    if (nd.t && nd.t.length) cond.appendChild(condVote(nd.q, nd.t, ctx));
    const branch = (lab, color, child, cctx, seg) => el("div", { style: "margin:.25rem 0 .25rem 1.2rem;padding-left:.75rem;border-left:2px solid " + color }, [
      el("span", { style: "font-size:.66rem;font-weight:700;letter-spacing:.05em;color:" + color + ";margin-right:.45rem", text: lab }),
      renderNode(child, cctx, path + seg),
    ]);
    return el("div", { style: "margin:.12rem 0" }, [cond,
      branch("YES", "#5bbd6b", nd.y, applyTerms(cloneCtx(ctx), nd.t), "Y"),
      branch("NO", "var(--ink-dim,#8a8a8a)", nd.n, applyNeg(cloneCtx(ctx), nd.t), "N")]);
  }
  card.appendChild(el("h3", { style: "font-size:.92rem;margin-top:.9rem;color:var(--accent)", text: "Biomes" }));
  { const holder = card;
    if (typeof MAPGEN_BIOME_LEGEND !== "undefined") holder.appendChild(el("p.tagline", { style: "font-size:.72rem" }, [MAPGEN_BIOME_LEGEND]));
    holder.appendChild(el("p.tagline", { style: "font-size:.72rem", text: "The exact classify() decision tree — each test branches YES (a biome 🌿, or a deeper test) or NO (continue down). 🗳 on a test votes its threshold constants." }));
    holder.appendChild(el("div", { style: "overflow-x:auto;font-size:.82rem;padding:.3rem 0" }, [renderNode(CLS_TREE, { e: [0, 1], temp: [0, 1], hum: [0, 1], w: [0, 1], f: [0, 1], c: [0, 1], lon: [0, 1] }, "R")]));

    // ---- "what biome?" calculator — the game's exact classify(), ported ----
    const LE = (typeof MAPGEN_ELEV !== "undefined" ? MAPGEN_ELEV.LAND_E : 0.483);
    const RE = (typeof MAPGEN_ELEV !== "undefined" ? MAPGEN_ELEV.ROCK_E : 0.655);
    function classifyBiome(e, hum, temp, f, c, w) {
      const Bx = (typeof B !== "undefined") ? B : null; if (!Bx) return null;
      if (e < 0.40) return Bx.DEEP;
      if (e < LE) return (temp > 0.68 && e > 0.44 && w > 0.62) ? Bx.REEF : Bx.WATER;
      if (e < 0.497) return Bx.SAND;
      if (e > RE) { if (w > 0.74) return Bx.VOLCANO; if (temp < 0.22) return Bx.GLACIER; if (temp < 0.42) return Bx.SNOW; return Bx.ROCK; }
      if (e > 0.615) {
        if (temp < 0.22) return Bx.GLACIER;
        if (temp < 0.38) return Bx.SNOW;
        if (hum < 0.32 && temp > 0.55) return Bx.CANYON;
        if (hum > 0.58 && temp < 0.52) return Bx.MOOR;
        if (e > 0.64) return Bx.ROCKY;
      }
      if (w > 0.76) {
        if (hum > 0.53) return temp > 0.55 ? Bx.MUSHROOM : temp < 0.42 ? Bx.ASH : Bx.DREAM;
        if (temp > 0.64 && hum < 0.48) return Bx.SALT;
        if (temp < 0.34) return Bx.CRYSTAL;
        return temp > 0.55 ? Bx.BONE : Bx.LABYRINTH;
      }
      if (w < 0.24) return temp < 0.50 ? Bx.WILD : Bx.RUINSB;
      if (temp < 0.24) return e > 0.58 ? Bx.GLACIER : Bx.SNOW;
      if (temp < 0.32) return hum > 0.50 ? Bx.TAIGA : Bx.TUNDRA;
      if (temp < 0.42) return hum > 0.55 ? Bx.TAIGA : hum > 0.35 ? Bx.TUNDRA : Bx.SNOW;
      if (temp > 0.65) {
        if (hum < 0.26) return Bx.REDDESERT;
        if (hum < 0.44) return f > 0.78 ? Bx.OASIS : Bx.DESERT;
        if (hum < 0.58) return Bx.SAVANNA;
        if (hum < 0.70) return f > 0.64 ? Bx.BAMBOO : Bx.JUNGLE;
        return Bx.WETLAND;
      }
      if (temp > 0.56 && hum < 0.32) return Bx.BADLANDS;
      if (hum < 0.28) return Bx.STEPPE;
      if (hum > 0.72) return Bx.SWAMP;
      if (hum > 0.55) return (f > 0.70 && temp > 0.44) ? Bx.CHERRY : Bx.FOREST;
      if (f > 0.62 && c > 0.48) return Bx.FARM;
      if (hum > 0.46) return Bx.MEADOW;
      return Bx.GRASS;
    }
    const tool = el("div", { style: "margin-top:.9rem;padding-top:.6rem;border-top:1px solid var(--line,#333)" });
    tool.appendChild(el("h4", { style: "margin:.2rem 0", text: "Which biome? — enter the field values (0–1)" }));
    const inputs = {};
    const rowEls = BIOME_AXES.map(([k, lab]) => {
      const inp = el("input", { type: "number", step: "0.01", min: "0", max: "1", value: "0.50", style: "width:76px" });
      inputs[k] = inp;
      return el("label.field", { style: "margin:0" }, [el("span", { text: lab }), inp]);
    });
    const resultEl = el("div.mono", { style: "margin-top:.6rem;font-weight:650;font-size:1rem;color:var(--gold)" });
    const compute = () => {
      const v = k => Math.max(0, Math.min(1, parseFloat(inputs[k].value) || 0));
      const id = classifyBiome(v("e"), v("hum"), v("temp"), v("f"), v("c"), v("w"));   // longitude is not used by classify()
      const name = (id != null && typeof BIOME_NAMES !== "undefined") ? BIOME_NAMES[id] : null;
      resultEl.textContent = name ? "→ " + name : "→ (biome data not loaded)";
    };
    Object.values(inputs).forEach(inp => inp.addEventListener("input", compute));
    tool.appendChild(el("div", { style: "display:flex;flex-wrap:wrap;gap:.5rem;align-items:flex-end" }, rowEls.concat([el("button.btn.sm.primary", { text: "Compute", onclick: compute })])));
    tool.appendChild(el("small.tagline", { style: "display:block;margin-top:.3rem", text: "Runs the game's exact classify()." }));
    tool.appendChild(resultEl);
    holder.appendChild(tool);
    compute();
  }
  wrap.appendChild(card);

  // ===== Game Parameters (separate card): day/night, weather, rain-shadow, celestial, fauna =====
  const gameCard = el("div.card");
  gameCard.appendChild(el("h3", null, ["Game Parameters ", el("span.hint", { text: "time-of-day, weather & non-terrain dials" })]));
  const gh = el("div"); gameCard.appendChild(gh);
  eqTable(gh, arr(typeof MAPGEN_GAME !== "undefined" && MAPGEN_GAME).concat(arr(typeof MAPGEN_DERIVED !== "undefined" && MAPGEN_DERIVED).filter(r => r.key === "rain_shadow")));
  GAME_SYS.forEach(t => { const sec = sysByTitle(t); if (sec) section(gameCard, sec.title, sec.note, sec.rows); });
  wrap.appendChild(gameCard);

  // ===== Location names (separate card, expanded) =====
  const nameCard = el("div.card");
  nameCard.appendChild(el("h3", null, ["Location names ", el("span.hint", { text: "vote keep/remove, or propose new" })]));
  const prefixes = (typeof MAP_NAME_PREFIXES !== "undefined" ? MAP_NAME_PREFIXES : []);
  const suffixes = (typeof MAP_NAME_SUFFIXES !== "undefined" ? MAP_NAME_SUFFIXES : []);
  nameListExpanded(nameCard, "Prefixes (" + prefixes.length + ")", prefixes, "nameprefix", "name_prefix", "propose a new prefix…", state, refetch);
  nameListExpanded(nameCard, "Suffixes (" + suffixes.length + ")", suffixes, "namesuffix", "name_suffix", "propose a new suffix…", state, refetch);
  wrap.appendChild(nameCard);

  refetch();   // load tallies; each 🗳 popover reads them live when opened
  return wrap;
}

// renders a name-part list (prefixes/suffixes), expanded, into an existing host.
function nameListExpanded(host, title, parts, fieldPrefix, proposeField, placeholder, state, refetch) {
  host.appendChild(el("h3", { style: "font-size:.92rem;margin-top:.9rem;color:var(--accent)", text: title }));
  const holder = el("div", { style: "max-height:420px;overflow:auto" });
  host.appendChild(holder);
  const build = () => {
    clear(holder);
    const reload = async () => { await refetch(); build(); };
    // propose a new part — type it inline and hit Propose (no popover glyph).
    const proposeInput = el("input.vote-input", { placeholder, style: "flex:1" });
    const doPropose = async () => {
      const v = proposeInput.value.trim();
      if (!v) { toast("Enter a value first.", "warn"); return; }
      if (!Taiao.logged()) { toast("Sign in to vote.", "warn"); App.go("#/settings"); return; }
      const r = await Taiao.castVote("mapgen", "world", proposeField, v.slice(0, 60));
      if (r && r.error) { toast(r.error, "err"); return; }
      toast("Proposed.", "ok"); proposeInput.value = ""; await reload();
    };
    proposeInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doPropose(); } });
    holder.appendChild(el("div.mgrow", { style: "margin-bottom:.5rem" }, [
      el("div.mglabel", { text: placeholder.replace(/…\s*$/, "") }),
      el("div", { style: "display:flex;gap:.35rem;flex:1" }, [proposeInput, el("button.btn.sm.primary", { text: "Propose", onclick: doPropose })]),
    ]));
    // each part gets inline Keep / Remove vote buttons (no popover glyph).
    const keepRemove = part => {
      const field = fieldPrefix + ":" + part;
      const t = (state.tallies || {})[field] || {};
      const mine = (typeof Taiao !== "undefined" && Taiao.myVote) ? Taiao.myVote("mapgen", "world", field) : null;
      const vote = async choice => {
        if (!Taiao.logged()) { toast("Sign in to vote.", "warn"); App.go("#/settings"); return; }
        const r = await Taiao.castVote("mapgen", "world", field, choice);
        if (r && r.error) { toast(r.error, "err"); return; }
        toast("Vote recorded.", "ok"); await reload();
      };
      const btn = (choice, label) => el("button.btn.sm" + (mine === choice ? ".primary" : ".ghost"), {
        text: label + (t[choice] ? " · " + t[choice] : ""), onclick: () => vote(choice),
      });
      return el("div", { style: "display:flex;gap:.35rem" }, [btn("keep", "Keep"), btn("remove", "Remove")]);
    };
    const proposed = Object.keys(state.tallies[proposeField] || {});
    const all = [...new Set(parts.concat(proposed))].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base" }));
    for (const part of all) {
      holder.appendChild(el("div.mgrow", null, [
        el("div.mglabel.mono", { text: part }),
        keepRemove(part),
      ]));
    }
  };
  build();
}

function tileThumb(entry, provider) {
  const thumb = el("div.thumb");
  if (provider.isAudio) { thumb.appendChild(el("div", { style: "font-size:2rem", text: "🔊" })); return thumb; }
  const cv = el("canvas", { width: 128, height: 128 });
  thumb.appendChild(cv);
  const drew = provider.draw(cv, entry, 0);
  if (drew === false) { clear(thumb); thumb.appendChild(el("div", { style: "font-size:2rem;opacity:.5", text: provider.icon })); }
  return thumb;
}

// Items tab as a table: just icon+name and id — every field (name, icon, and the
// rest) is viewed & voted on the item page itself.
// Author / Artist cell for the catalog tables. A human-made entry carries its
// maker's username in e.artist / e.author; everything currently shipped is
// procedurally / AI made (no maker field), so it defaults to "🤖 AI".
function makerBadge(e) {
  const who = (e && (e.artist || e.author)) || "";
  const human = who && who !== "AI";
  return el("span.badge", { title: human ? "Made by " + who : "Procedurally / AI generated", text: human ? "👤 " + who : "🤖 AI" });
}
// True when a sprite has genuine 8-direction art (distinct per-direction frames),
// as opposed to a single sprite mirrored/reused for every facing. Kenney & Clint
// Bellanger art is single-frame; only PixelLab-generated sprites are drawn a full
// 8 ways — so this is the "8 directions, not all identical" signal. Monsters
// expose it via isDir (the game's dirSpr flag); playable characters are always
// fully 8-directional.
function has8Directions(provider, e) {
  if (!provider || !provider.dirs || !e) return false;
  if (typeof provider.isDir === "function") return !!provider.isDir(e);
  return provider.type === "character";
}
// For the art tables (Items / Sprites / Biomes) the maker is split across two
// columns. A genuinely 8-directional sprite is always PixelLab (see
// has8Directions); otherwise provenance comes from the provider's maker(entry) →
// { madeBy: "human"|"ai"|"pixellab", maker: username } (see AssetOrigin in
// providers-extra.js, which classifies by source spritesheet). Falls back to the
// entry's own madeBy/maker, then to PixelLab / "—" for anything unclassified.
function artMaker(provider, e) {
  // explicit per-asset AI overrides win over the 8-direction rule and the sheet map
  if (e && typeof AssetOrigin !== "undefined" && AssetOrigin.forcedAIEntry && AssetOrigin.forcedAIEntry(provider, e))
    return { madeBy: "ai", label: "AI", who: "admin" };
  if (has8Directions(provider, e)) return { madeBy: "pixellab", label: "PixelLab", who: "admin" };
  let m = (provider && typeof provider.maker === "function") ? provider.maker(e) : null;
  if (!m) m = { madeBy: (e && e.madeBy) || null, maker: (e && e.maker) || "" };
  const madeBy = m.madeBy || "pixellab";
  return { madeBy, label: madeBy === "human" ? "Human" : madeBy === "ai" ? "AI" : "PixelLab", who: m.maker || "" };
}
// badge builders from a resolved maker `m` (so cells can be repainted async)
function originBadge(m) {
  const ic = m.madeBy === "human" ? "👤" : m.madeBy === "ai" ? "🤖" : "🎨";
  return el("span.badge", { title: "Made by " + m.label, text: ic + " " + m.label });
}
function makerUserBadge(m) {
  return m.who
    ? el("span.badge", { title: (m.madeBy === "human" ? "Artist: " : "Prompter: ") + m.who, text: "👤 " + m.who })
    : el("span.hint", { text: "—" });
}
const PIXELLAB_MAKER = { madeBy: "pixellab", label: "PixelLab", who: "admin" };
// "Human/AI" column cell
function originCell(provider, e) { return originBadge(artMaker(provider, e)); }
// "Artist/Prompter" column cell — artist username (human) or prompter username (ai/pixellab)
function makerUserCell(provider, e) { return makerUserBadge(artMaker(provider, e)); }

// Render the sprite at three NON-MIRROR facings (south/east/north) and report
// whether it has genuinely distinct per-direction art — the "8 directions, not
// all identical" test. Using a non-mirror set means a single billboard (which
// the renderer only h-flips for west-side facings) reads as NOT directional,
// while real 8-way art (characters, directional monsters, directional objects)
// reads as directional. Sheets load lazily, so retry while every frame is blank.
// Resolves a boolean via the callback.
function probeDirectional(provider, e, cb) {
  if (!provider || !provider.dirs || !e || typeof provider.draw !== "function") return cb(false);
  const DIRS = [0, 2, 4], SZ = 24;
  const blank = d => { for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false; return true; };
  const same = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  let tries = 0;
  const probe = () => {
    const datas = DIRS.map(d => {
      const cv = el("canvas", { width: SZ, height: SZ });
      try { provider.draw(cv, e, d); } catch (_) {}
      try { return cv.getContext("2d").getImageData(0, 0, SZ, SZ).data; } catch (_) { return null; }
    });
    const good = datas.filter(d => d && !blank(d));
    if (!good.length && tries < 8) { tries++; return setTimeout(probe, 200); }
    if (good.length < 2) return cb(false);   // only one facing renders → not real 8-dir art
    cb(!good.every(d => same(d, good[0])));
  };
  probe();
}
// Origin + Artist/Prompter cells for the SPRITES tab: paint the sheet-based
// classification immediately, then upgrade to PixelLab once a render probe
// confirms the sprite is genuinely 8-directional (never downgrades).
function spriteMakerCells(provider, e) {
  const originHost = el("span"), makerHost = el("span");
  const paint = m => { clear(originHost); originHost.appendChild(originBadge(m)); clear(makerHost); makerHost.appendChild(makerUserBadge(m)); };
  const initial = artMaker(provider, e);
  paint(initial);
  // forced-AI assets must stay AI — don't let the 8-direction probe upgrade them
  const forced = typeof AssetOrigin !== "undefined" && AssetOrigin.forcedAIEntry && AssetOrigin.forcedAIEntry(provider, e);
  if (!forced && initial.madeBy !== "pixellab") probeDirectional(provider, e, dir => { if (dir) paint(PIXELLAB_MAKER); });
  return { originHost, makerHost };
}
// shared cell/canvas styling — taller rows + bigger icons across every catalog table
const CAT_TD = "border-bottom:1px solid var(--line,#222);padding:.55rem .55rem;font-size:.8rem;vertical-align:middle;white-space:nowrap";
const CAT_ICON = "width:48px;height:48px;image-rendering:pixelated;flex:0 0 auto";

// A votable "Map icon" row for the entity a map icon represents — a World Object,
// a Skill, or the Quests page. Picks which map-icon marks it on the world map;
// defaults to the game's current mapping (defaultMapIcon), community votes change
// it. `kind`/`folder` are the vote subject (e.g. "object"/objectKey), `subjectKey`
// resolves the default. Shared by detail.js, skills.js and quests.js.
function mapIconVoteRow(kind, folder, subjectKey, label) {
  const cur = (typeof defaultMapIcon === "function" ? defaultMapIcon(kind, subjectKey) : "") || "";
  const state = { t: {} };
  const load = async () => { try { state.t = (typeof Taiao !== "undefined" && Taiao.tally) ? (await Taiao.tally(kind, folder) || {}) : {}; } catch (_) {} };
  const glyph = VoteWidget.symbol({
    kind, folder, field: "map_icon", type: "select", choices: (typeof mapIconChoices === "function" ? mapIconChoices() : []),
    current: cur, currentLabel: cur || "—", label: "map icon", getTallies: () => state.t, refetch: load,
  });
  load();
  const iconCv = el("canvas", { width: 64, height: 64, style: "width:28px;height:28px;image-rendering:pixelated;flex:0 0 auto" });
  try { const mp = Providers.get("map"); if (mp && cur) mp.draw(iconCv, { type: "map", key: "i_mapicon_" + cur }, 0); } catch (_) {}
  return el("div.mgrow", { style: "grid-template-columns:auto 1fr" }, [
    el("div.mglabel", { style: "white-space:nowrap" }, [(label || "Map icon") + " ", el("span.mono", { style: "color:var(--gold)", text: "· " + (cur || "—") })]),
    el("div", { style: "display:flex;align-items:center;gap:.4rem" }, [cur ? iconCv : null, glyph].filter(Boolean)),
  ]);
}

// Items tab: item GAMEPLAY data (like World Objects shows object type, Monsters show
// level/biome). The art & provenance live on the Sprites tab; here a "Sprite" column
// just links across to it. Columns from each item's ITEMS entry.
function itemsTable(entries, provider) {
  const th = "border-bottom:1px solid var(--line,#333);padding:.4rem .55rem;text-align:left;font-size:.7rem;letter-spacing:.02em;color:var(--ink-dim);white-space:nowrap;position:sticky;top:0;background:var(--bg-1,#111)";
  const td = CAT_TD;
  const table = el("table", { style: "border-collapse:collapse;width:100%" });
  table.appendChild(el("tr", null, ["Item", "Item id", "Sprite"].map(h => el("th", { style: th, text: h }))));
  for (const e of entries) {
    const cv = el("canvas", { width: 64, height: 64, style: CAT_ICON });
    try { provider.draw(cv, e, 0); } catch (_) {}
    const nameLink = el("a", { style: "color:inherit;text-decoration:none;font-weight:600;cursor:pointer", text: e.name, href: "#/detail?type=ui&key=" + encodeURIComponent(e.key) });
    // Sprite id must match the Sprites tab (the item's icon-group representative id), not the raw icon key.
    const spriteLink = el("a", { style: "color:inherit;text-decoration:none;font-family:monospace;font-size:.72rem;cursor:pointer", text: uiSpriteId(e.iconKey), href: "#/sprite?type=ui&key=" + encodeURIComponent(e.key) });
    table.appendChild(el("tr", null, [
      el("td", { style: td }, [el("div", { style: "display:flex;align-items:center;gap:.5rem" }, [cv, nameLink])]),
      el("td", { style: td + ";font-family:monospace;font-size:.72rem;color:var(--ink-dim)", text: String(e.itemId) }),
      el("td", { style: td }, [spriteLink]),
    ]));
  }
  return el("div", { style: "overflow-x:auto" }, [TableFilter.enhance(table)]);
}

// Monsters tab as a table: Monster (icon + name), Monster id, Sprite (→ sprite page),
// Level, Biome (spawn biomes).
function monsterCatalogTable(entries, provider) {
  const th = "border-bottom:1px solid var(--line,#333);padding:.4rem .55rem;text-align:left;font-size:.7rem;letter-spacing:.02em;color:var(--ink-dim);white-space:nowrap;position:sticky;top:0;background:var(--bg-1,#111)";
  const td = CAT_TD;
  const tdWrap = "border-bottom:1px solid var(--line,#222);padding:.55rem .55rem;font-size:.78rem;vertical-align:middle;color:var(--ink-dim);white-space:normal;min-width:12rem";
  const spriteIdOf = e => {
    const keys0 = (provider.layerKeys ? provider.layerKeys(e.key, 0) || [] : []).filter(Boolean);
    return (provider.isDir && provider.isDir(e)) ? String(keys0[0] || "").replace(/_south$/, "") : keys0.join("+");
  };
  const table = el("table", { style: "border-collapse:collapse;width:100%" });
  table.appendChild(el("tr", null, ["Monster", "Monster id", "Sprite", "Level", "Biome", "Author"].map(h => el("th", { style: th, text: h }))));
  for (const e of entries) {
    // e.key is a biome-variant key ("adder$desert"); provider.data strips the
    // "$biome" to resolve the shared base def (level, etc.) — MONSTERS[e.key] wouldn't.
    const def = (provider.data && provider.data(e)) || (typeof MONSTERS !== "undefined" && MONSTERS[e.key]) || {};
    const cv = el("canvas", { width: 64, height: 64, style: CAT_ICON });
    try { provider.draw(cv, e, 0); } catch (_) {}
    const nameLink = el("a", { style: "color:inherit;text-decoration:none;font-weight:600;cursor:pointer", text: e.name, href: "#/detail?type=monster&key=" + encodeURIComponent(e.key) });
    const sid = spriteIdOf(e);
    const spriteLink = el("a", { style: "color:inherit;text-decoration:none;font-family:monospace;font-size:.72rem;cursor:pointer", text: sid || "—", href: "#/sprite?type=monster&key=" + encodeURIComponent(e.key) });
    const biomes = (provider.spawnBiomes ? provider.spawnBiomes(e.key) : []) || [];
    table.appendChild(el("tr", null, [
      el("td", { style: td }, [el("div", { style: "display:flex;align-items:center;gap:.5rem" }, [cv, nameLink])]),
      el("td", { style: td + ";font-family:monospace;font-size:.72rem;color:var(--ink-dim)", text: String(e.key) }),
      el("td", { style: td }, [spriteLink]),
      el("td", { style: td + ";color:var(--ink-dim)", text: def.lvl != null ? String(def.lvl) : "—" }),
      el("td", { style: tdWrap, text: biomes.length ? biomes.join(", ") : "—" }),
      el("td", { style: td }, [makerBadge(e)]),
    ]));
  }
  return el("div", { style: "overflow-x:auto" }, [TableFilter.enhance(table)]);
}

// World Objects tab as a table: Object (icon + name), Object id, Sprite (→ sprite
// page), Object type (Crafting Station / Resource / Structural / Decoration).
function objectCatalogTable(entries, provider) {
  const th = "border-bottom:1px solid var(--line,#333);padding:.4rem .55rem;text-align:left;font-size:.7rem;letter-spacing:.02em;color:var(--ink-dim);white-space:nowrap;position:sticky;top:0;background:var(--bg-1,#111)";
  const td = CAT_TD;
  // structural / non-pickable prefixes — mirrors DECOR_NOPICK_RE in gameplay/decor-pickup.js
  const STRUCT_RE = /^(wall_|tower_|fence_|gate_|door_|rampart|portcullis|stone_bridge|bridge_arch|aqueduct|grille)/;
  const objType = key => {
    if (typeof STATIONS !== "undefined" && STATIONS[key]) return "Crafting Station";
    if ((typeof NODE_TYPES !== "undefined" && NODE_TYPES[key]) || (typeof NODE_EXAMINE !== "undefined" && NODE_EXAMINE[key])) return "Resource";
    if (STRUCT_RE.test(key)) return "Structural";
    return "Decoration";
  };
  const table = el("table", { style: "border-collapse:collapse;width:100%" });
  table.appendChild(el("tr", null, ["Object", "Object id", "Sprite", "Object type", "Author"].map(h => el("th", { style: th, text: h }))));
  for (const e of entries) {
    const cv = el("canvas", { width: 64, height: 64, style: CAT_ICON });
    try { provider.draw(cv, e, 0); } catch (_) {}
    const nameLink = el("a", { style: "color:inherit;text-decoration:none;font-weight:600;cursor:pointer", text: e.name, href: "#/detail?type=object&key=" + encodeURIComponent(e.key) });
    const spriteLink = el("a", { style: "color:inherit;text-decoration:none;font-family:monospace;font-size:.72rem;cursor:pointer", text: spriteIdFor("object", e.key), href: "#/sprite?type=object&key=" + encodeURIComponent(e.key) });
    table.appendChild(el("tr", null, [
      el("td", { style: td }, [el("div", { style: "display:flex;align-items:center;gap:.5rem" }, [cv, nameLink])]),
      el("td", { style: td + ";font-family:monospace;font-size:.72rem;color:var(--ink-dim)", text: String(e.key) }),
      el("td", { style: td }, [spriteLink]),
      el("td", { style: td + ";color:var(--ink-dim)", text: objType(e.key) }),
      el("td", { style: td }, [makerBadge(e)]),
    ]));
  }
  return el("div", { style: "overflow-x:auto" }, [TableFilter.enhance(table)]);
}

// Player tab as a table: Name (icon + name), id, Sprite (→ sprite page), Height,
// Weight, Speed, Toughness, XP aptitudes — from Roster.stats(entry).
function playerCatalogTable(entries, provider) {
  const th = "border-bottom:1px solid var(--line,#333);padding:.4rem .55rem;text-align:left;font-size:.7rem;letter-spacing:.02em;color:var(--ink-dim);white-space:nowrap;position:sticky;top:0;background:var(--bg-1,#111)";
  const td = CAT_TD;
  const tdWrap = "border-bottom:1px solid var(--line,#222);padding:.55rem .55rem;font-size:.76rem;vertical-align:middle;color:var(--ink-dim);white-space:normal;min-width:12rem";
  const mul = v => v != null ? "×" + Number(v).toFixed(2) : "—";
  const table = el("table", { style: "border-collapse:collapse;width:100%" });
  // stat columns stay sortable but get no typable filter field (data-tf-nofilter)
  const NO_FILTER = new Set(["Height", "Weight", "Speed", "Toughness", "XP aptitudes"]);
  table.appendChild(el("tr", null, ["Name", "id", "Sprite", "Height", "Weight", "Speed", "Toughness", "XP aptitudes", "Author"]
    .map(h => el("th", NO_FILTER.has(h) ? { style: th, text: h, "data-tf-nofilter": "" } : { style: th, text: h }))));
  for (const e of entries) {
    const cv = el("canvas", { width: 64, height: 64, style: CAT_ICON });
    try { provider.draw(cv, e, 0); } catch (_) {}
    const nameLink = el("a", { style: "color:inherit;text-decoration:none;font-weight:600;cursor:pointer", text: e.name, href: "#/detail?type=character&key=" + encodeURIComponent(e.key) });
    const spriteLink = el("a", { style: "color:inherit;text-decoration:none;font-family:monospace;font-size:.72rem;cursor:pointer", text: spriteIdFor("character", e.key), href: "#/sprite?type=character&key=" + encodeURIComponent(e.key) });
    const s = ((typeof Roster !== "undefined" && Roster.stats) ? Roster.stats(e) : null) || {};
    const tough = s.tough != null ? (s.tough * 100).toFixed(0) + "%" : "—";
    const xpKeys = Object.keys(s.xp || {}).filter(k => Math.abs(s.xp[k] - 1) > 0.001);
    const xpText = xpKeys.length ? xpKeys.map(k => k + " ×" + s.xp[k].toFixed(2)).join(", ") : "—";
    table.appendChild(el("tr", null, [
      el("td", { style: td }, [el("div", { style: "display:flex;align-items:center;gap:.5rem" }, [cv, nameLink])]),
      el("td", { style: td + ";font-family:monospace;font-size:.72rem;color:var(--ink-dim)", text: e.snake || e.key }),
      el("td", { style: td }, [spriteLink]),
      el("td", { style: td + ";color:var(--ink-dim)", text: mul(s.h) }),
      el("td", { style: td + ";color:var(--ink-dim)", text: mul(s.weight) }),
      el("td", { style: td + ";color:var(--ink-dim)", text: mul(s.speed) }),
      el("td", { style: td + ";color:var(--ink-dim)", text: tough }),
      el("td", { style: tdWrap, text: xpText }),
      el("td", { style: td }, [makerBadge(e)]),
    ]));
  }
  return el("div", { style: "overflow-x:auto" }, [TableFilter.enhance(table)]);
}

// Biomes tab as a table: one biome per row, each ground variant (bg_<b>_<v>) a
// separate column. Only v1–v4 are shown — the baked `at_` atlas picks
// atlasVariantAt()%4, so v5/v6 exist as art but the renderer never selects them.
// Biomes tab: biome GAMEPLAY data (the tile art + provenance now live on the
// Sprites tab). One row per biome — name, biome id, how many ground-tile variants
// it has, how many monster species spawn there, and a Sprite link across to the
// tiles on the Sprites tab.
function biomeDataTable(entries, provider) {
  const th = "border-bottom:1px solid var(--line,#333);padding:.4rem .55rem;text-align:left;font-size:.7rem;letter-spacing:.02em;color:var(--ink-dim);white-space:nowrap;position:sticky;top:0;background:var(--bg-1,#111)";
  const td = CAT_TD;
  // group ground-tile variants (bg_<b>_<v>) by biome id
  const groups = new Map();
  for (const e of entries) {
    const m = /^bg_(\d+)_(\d+)$/.exec(e.key);
    if (!m) continue;
    const b = +m[1];
    let g = groups.get(b);
    if (!g) { g = { b, name: (typeof BIOME_NAMES !== "undefined" && BIOME_NAMES[b]) || String(e.name).replace(/\s*·.*$/, "") || ("Biome " + b), variants: [] }; groups.set(b, g); }
    g.variants.push(e.key);
  }
  const rows = [...groups.values()].sort((a, b) => a.b - b.b);
  rows.forEach(g => g.variants.sort());

  // biome name → count of monster species that spawn there (from the monster provider)
  const bio2mon = {};
  const mon = (typeof Providers !== "undefined") ? Providers.get("monster") : null;
  if (mon && mon.list && mon.spawnBiomes) {
    const seen = new Set();
    for (const e of mon.list()) {
      const bk = e.baseKey || e.key; if (seen.has(bk)) continue; seen.add(bk);
      for (const lbl of (mon.spawnBiomes(bk) || [])) (bio2mon[lbl] || (bio2mon[lbl] = new Set())).add(bk);
    }
  }

  const bslug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  // one shared ballot for the whole biomes table (subject gen:tile:all); fields
  // are name:<slug> (rename), tileset:<slug> (reassign the 4-tile art set) and
  // add_biome (propose a new biome). The 🗳 popovers read tallies live on open.
  const state = { tallies: {} };
  const refetch = async () => { try { state.tallies = (typeof Taiao !== "undefined" && Taiao.tally) ? (await Taiao.tally("tile", "all") || {}) : {}; } catch (_) {} };
  const tilesetChoices = rows.map(g => bslug(g.name));   // every biome IS a 4-tile set

  const table = el("table", { style: "border-collapse:collapse;width:100%" });
  table.appendChild(el("tr", null, ["Biome", "Biome id", "Spawn monsters", "Sprite (tile set)"].map(h => el("th", { style: th, text: h }))));
  for (const g of rows) {
    const first = g.variants[0];
    const mc = bio2mon[g.name] ? bio2mon[g.name].size : 0;
    const slug = bslug(g.name);   // biome snake_case sprite id
    const spriteLink = first
      ? el("a", { href: "#/sprite?type=tile&key=" + encodeURIComponent(first), style: "color:var(--gold);text-decoration:none;font-family:monospace;font-size:.72rem", text: slug })
      : el("span", { style: "color:var(--ink-dim)", text: "—" });
    // vote to reassign which 4-tile set represents this biome
    const tilesetVote = VoteWidget.symbol({ kind: "tile", folder: "all", field: "tileset:" + slug, type: "select", choices: tilesetChoices, current: slug, currentLabel: slug, label: "tile set for " + g.name, getTallies: () => state.tallies, refetch });
    // vote to change the biome name
    const nameVote = VoteWidget.symbol({ kind: "tile", folder: "all", field: "name:" + slug, type: "string", current: g.name, currentLabel: g.name, label: "biome name", getTallies: () => state.tallies, refetch });
    // the biome's first ground-tile variant (v1) as the row icon
    const cv = el("canvas", { width: 64, height: 64, style: CAT_ICON });
    if (first) { try { provider.draw(cv, { key: first }, 0); } catch (_) {} }
    table.appendChild(el("tr", null, [
      el("td", { style: td }, [el("div", { style: "display:flex;align-items:center;gap:.5rem" }, [cv, el("span", { style: "font-weight:600", text: g.name }), nameVote])]),
      el("td", { style: td + ";font-family:monospace;font-size:.72rem;color:var(--ink-dim)", text: "biome " + g.b }),
      el("td", { style: td + ";color:var(--ink-dim)", text: mc ? String(mc) : "—" }),
      el("td", { style: td }, [el("span", { style: "display:inline-flex;align-items:center;gap:.35rem" }, [spriteLink, tilesetVote])]),
    ]));
  }
  refetch();

  // propose a brand-new biome (name + the existing tile set it should reuse)
  const addCard = el("div.card", { style: "background:var(--bg-2);margin-top:.8rem" });
  addCard.appendChild(el("h3", { style: "font-size:.92rem", text: "Add a new biome" }));
  addCard.appendChild(el("p.tagline", { text: "Propose a biome the game should add. Give it a name and its biome sprite, and (optionally) which existing 4-tile set it should reuse until then." }));

  // Sprite id — restricted to sprites tagged "biome" on the Sprites page: the
  // existing biome tile sets, plus any biome-tagged sprites you've created.
  const DL_ID = "biome-sprite-datalist";
  let dl = document.getElementById(DL_ID);
  if (!dl) { dl = el("datalist", { id: DL_ID }); document.body.appendChild(dl); }
  let allowed = new Set();
  const fillDatalist = ids => { clear(dl); allowed = new Set(ids); ids.forEach(id => dl.appendChild(el("option", { value: id }))); };
  fillDatalist(tilesetChoices);
  // fold in the user's own biome-tagged sprites (studio drafts) once loaded
  (async () => {
    try {
      const all = (typeof Store !== "undefined" && Store.all) ? await Store.all() : [];
      const extra = all.filter(p => p && p.tag === "biome").map(p => p.spriteId || p.folder).filter(Boolean);
      if (extra.length) fillDatalist([...new Set(tilesetChoices.concat(extra))]);
    } catch (_) {}
  })();

  const nameInp = el("input.vote-input", { placeholder: "biome name, e.g. Mangrove" });
  const spriteInp = el("input.vote-input", { placeholder: "biome sprite_id (tagged “biome”)", list: DL_ID, autocomplete: "off" });
  const setSel = el("select.vote-input"); tilesetChoices.forEach(s => setSel.appendChild(el("option", { value: s, text: s })));
  const fld = (label, node) => el("label.field", { style: "margin:0;flex:1;min-width:9rem" }, [el("span", { text: label }), node]);
  addCard.appendChild(el("div", { style: "display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end" }, [fld("Biome name", nameInp), fld("Sprite id", spriteInp), fld("Reuse tile set", setSel)]));
  const addBtn = el("button.btn.primary.sm", { style: "margin-top:.5rem", text: "Propose biome" });
  addBtn.onclick = async () => {
    if (!Taiao.logged()) { toast("Sign in to propose a biome.", "warn"); App.go("#/settings"); return; }
    const nm = nameInp.value.trim(); if (!nm) { toast("Name the biome.", "warn"); return; }
    const sid = spriteInp.value.trim();
    if (sid && !allowed.has(sid)) { toast("That sprite_id isn’t tagged “biome”. Pick one from the list.", "warn"); return; }
    addBtn.disabled = true;
    try {
      const choice = (nm + " · " + setSel.value + (sid ? " · spr:" + sid : "")).slice(0, 120);
      const r = await Taiao.castVote("tile", "all", "add_biome", choice);
      if (r && r.error) { toast(r.error, "err"); return; }
      toast("Biome proposed!", "ok"); nameInp.value = ""; spriteInp.value = "";
    } finally { addBtn.disabled = false; }
  };
  addCard.appendChild(addBtn);

  return el("div", null, [el("div", { style: "overflow-x:auto" }, [TableFilter.enhance(table)]), addCard]);
}

// SFX + music provenance, mirrored from assets/sfx/CREDITS.txt & music/CREDITS.txt
// (and the js/audio.js header). The sfx are ALL CC0 — Kenney.nl audio packs plus
// two OpenGameArt CC0 packs; the one recorded music track is Kevin MacLeod (CC BY).
const SND_SRC = {
  kenney: { who: "Kenney.nl", license: "CC0", url: "https://kenney.nl/assets/category:Audio" },
  rubberduck: { who: "rubberduck · OpenGameArt", license: "CC0", url: "https://opengameart.org/content/40-cc0-water-splash-slime-sfx" },
  tito: { who: "tito · OpenGameArt", license: "CC0", url: "https://opengameart.org/content/7-eating-crunches" },
  macleod: { who: "Kevin MacLeod · incompetech", license: "CC BY 4.0", url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Frozen%20Star.mp3" },
  synth: { who: "Our RPG — synthesized (make_ambience.py)", license: "CC BY-SA 4.0", url: null },
};
// sfx event-id (base name) → source key. Kenney packs cover almost everything;
// the water/slime + eating sounds are the two OpenGameArt CC0 packs.
const SFX_CREDIT = (() => {
  const m = {};
  ["chop", "swing", "coins", "forage", "pickup", "equip", "dooropen", "doorclose", "gate", "latch", "book",
    "step_grass", "step_stone", "step_snow", "step_sand", "step_wood", "hit", "hurt", "kill", "arrowhit",
    "arrowmiss", "mine", "climb", "anvil", "click", "error", "craft", "bow", "spellword", "portal",
    "spellcast", "die", "attune", "levelup", "quest"].forEach(k => (m[k] = "kenney"));
  ["wade", "fish", "splash_big", "drink"].forEach(k => (m[k] = "rubberduck"));
  m.eat = "tito";
  return m;
})();
const MUSIC_CREDIT = { bifrost_theme: "macleod" };
// resolve a sound entry → its source (sfx/music); birdsong & ambience handled elsewhere / uncredited
function soundCredit(e) {
  if (!e) return null;
  const base = String(e.name || "").replace(/\d+$/, "");
  if (e.cat === "sfx") return SND_SRC[SFX_CREDIT[base]] || null;
  if (e.cat === "music") return SND_SRC[MUSIC_CREDIT[base]] || null;
  if (e.cat === "ambience") return SND_SRC.synth;   // rain/wind/ocean — original synthesized loops
  return null;
}

// Birdsong provenance: every clip is a xeno-canto recording credited (per bird
// sound id) in assets/birdsong/CREDITS.txt, CC BY-NC-SA. Parse it once (lazily,
// cached) into { soundId → {recordist, url, species, xc} } so the Sounds table
// can credit the proper recordist for each bird clip.
let _birdCreditsPromise = null;
function birdCredits() {
  if (_birdCreditsPromise) return _birdCreditsPromise;
  const base = (typeof ASSET_BASE !== "undefined" ? ASSET_BASE : "");
  _birdCreditsPromise = fetch(base + "assets/birdsong/CREDITS.txt")
    .then(r => r.ok ? r.text() : "")
    .then(txt => {
      const map = {};
      txt.split("\n").forEach(line => {
        const c = line.indexOf(":");
        if (c < 0) return;
        const key = line.slice(0, c).trim();
        if (!/^[a-z0-9_]+$/.test(key)) return;   // skip the prose header lines
        const rest = line.slice(c + 1);
        const rec = /recordist\s+(.+?)\s*,\s*https?:/i.exec(rest);
        const url = /(https:\/\/xeno-canto\.org\/\d+)/i.exec(rest);
        const sp = /^\s*(.+?)\s+—\s+(XC\d+)/.exec(rest);
        if (rec) map[key] = { recordist: rec[1].trim(), url: url ? url[1] : null, species: sp ? sp[1].trim() : null, xc: sp ? sp[2] : null };
      });
      return map;
    })
    .catch(() => ({}));
  return _birdCreditsPromise;
}

// Sounds tab as a table: each sound with a play button + name (→ detail page),
// its category, what triggers it in game, the recording's credit, and a
// keep/remove ballot (the main-page table convention). Community-uploaded sounds
// append below with the same vote.
// One shared ballot subject for the whole table: gen:sound:all, field = sound key.
function soundsTable(entries, provider) {
  const th = "border-bottom:1px solid var(--line,#333);padding:.4rem .55rem;text-align:left;font-size:.7rem;letter-spacing:.02em;color:var(--ink-dim);white-space:nowrap;position:sticky;top:0;background:var(--bg-1,#111)";
  const td = CAT_TD;
  const state = {
    folder: "all", tallies: {}, cells: [],
    refetch: async () => {
      try { state.tallies = (typeof Taiao !== "undefined" && Taiao.tally) ? (await Taiao.tally("sound", state.folder) || {}) : {}; } catch (_) {}
      state.cells.forEach(fn => { try { fn(); } catch (_) {} });
    },
  };

  const playBtn = srcFn => {
    const b = el("button.btn.sm.ghost", { type: "button", text: "▶", title: "Play", style: "line-height:1" });
    let a = null;
    b.onclick = () => { try { if (!a) a = new Audio(srcFn()); a.currentTime = 0; a.play().catch(() => {}); } catch (_) {} };
    return b;
  };
  const voteCell = (field, label) => VoteWidget.buttons({
    kind: "sound", folder: state.folder, field, label,
    getTallies: () => state.tallies, refetch: state.refetch, register: fn => state.cells.push(fn),
  });
  // birdsong clips credit their xeno-canto recordist (linked, CC BY-NC-SA); other
  // sounds have no per-clip recordist to name here.
  const creditCell = e => {
    // sfx (CC0 Kenney/OpenGameArt) & music (Kevin MacLeod) have a fixed source
    const src = soundCredit(e);
    if (src) {
      const lic = el("small", { style: "color:var(--ink-dim);margin-left:.35rem", text: src.license });
      return src.url
        ? el("a", { href: src.url, target: "_blank", rel: "noopener", title: src.who + " — " + src.license, style: "color:var(--gold);text-decoration:none" }, [el("span", { text: src.who }), lic])
        : el("span", { title: src.who + " — " + src.license }, [el("span", { text: src.who }), lic]);
    }
    if (!e || e.cat !== "birdsong") return el("span", { style: "color:var(--ink-dim)", text: "—" });
    const host = el("span", { style: "color:var(--ink-dim)", text: "…" });
    birdCredits().then(map => {
      const c = map[e.name];
      clear(host);
      if (!c) { host.textContent = "—"; return; }
      host.style.color = "";
      const title = (c.species ? c.species + " — " : "") + "xeno-canto, CC BY-NC-SA";
      host.appendChild(c.url
        ? el("a", { href: c.url, target: "_blank", rel: "noopener", title, style: "color:var(--gold);text-decoration:none", text: c.recordist })
        : el("span", { title, text: c.recordist }));
      if (c.xc) host.appendChild(el("small", { style: "color:var(--ink-dim);margin-left:.35rem;font-family:monospace", text: c.xc }));
    });
    return host;
  };

  const table = el("table", { style: "border-collapse:collapse;width:100%" });
  table.appendChild(el("tr", null, ["Sound", "Category", "Credit", "Vote"].map(h => el("th", { style: th, text: h }))));
  const bodyBuiltin = el("tbody"); table.appendChild(bodyBuiltin);
  const bodyProposed = el("tbody"); table.appendChild(bodyProposed);

  entries.forEach(e => {
    const name = el("div", { style: "display:flex;align-items:center;gap:.5rem" }, [
      playBtn(() => provider.audioSrc(e)),
      el("a", { style: "color:inherit;text-decoration:none;font-weight:600;cursor:pointer", text: e.name, href: "#/detail?type=sound&key=" + encodeURIComponent(e.key) }),
    ]);
    bodyBuiltin.appendChild(el("tr", null, [
      el("td", { style: td }, [name]),
      el("td", { style: td }, [el("span.badge", { text: e.cat })]),
      el("td", { style: td }, [creditCell(e)]),
      el("td", { style: td }, [voteCell(e.key, e.name)]),
    ]));
  });

  const renderProposed = props => {
    clear(bodyProposed);
    (props || []).forEach(p => {
      const s = p.sound || {};
      const name = el("div", { style: "display:flex;align-items:center;gap:.5rem" }, [
        s.src ? playBtn(() => s.src) : el("span", { text: "🔊" }),
        el("span", { style: "font-weight:600", text: s.name || p.title || "sound" }),
        el("small.credit", null, ["by ", el("span.u", { text: p.username || "someone" })]),
      ]);
      bodyProposed.appendChild(el("tr", null, [
        el("td", { style: td }, [name]),
        el("td", { style: td }, [el("span.badge", { text: (s.category || "sfx") + " · proposed" })]),
        el("td", { style: td }, [el("span", { text: p.username || "—" })]),
        el("td", { style: td }, [voteCell("proposed:" + p.id, s.name || p.title)]),
      ]));
    });
  };

  const loadProposed = async () => {
    try {
      const metas = (typeof Taiao !== "undefined" && Taiao.listCostumes) ? await Taiao.listCostumes("sound", state.folder) : [];
      const full = await Promise.all((metas || []).map(async m => { let f = null; try { f = await Taiao.getCostume(m.id); } catch (_) {} return { ...m, sound: (f && f.payload && f.payload.sound) || {} }; }));
      renderProposed(full);
      state.cells.forEach(fn => { try { fn(); } catch (_) {} });
    } catch (_) {}
  };

  state.refetch();      // load keep/remove tallies, then re-render vote buttons
  loadProposed();       // load community-submitted sounds

  return el("div", null, [el("div", { style: "overflow-x:auto" }, [TableFilter.enhance(table)]), soundAddForm(loadProposed)]);
}

// upload-your-own-sound form: audio file + name + category + trigger → a workshop
// proposal (subject gen:sound:all), which then appears as a votable row above.
function soundAddForm(onAdded) {
  const box = el("div.card", { style: "background:var(--bg-2);margin-top:.8rem" });
  box.appendChild(el("h3", { style: "font-size:.92rem", text: "Add your own sound" }));
  box.appendChild(el("p.tagline", { text: "Upload a short clip (ogg/mp3/wav, under 2 MB), name it, pick a category and give the in-game event id that should trigger it (e.g. levelup, chop). The community votes it keep/remove." }));
  box.appendChild(el("p.tagline", { style: "font-size:.72rem", text: "Upload your own work, or AI work you disclose as AI. Undisclosed AI art gets removed — honest credit is the whole game here." }));
  const nameInp = el("input.vote-input", { placeholder: "e.g. victory_fanfare" });
  const catSel = el("select.vote-input"); ["sfx", "birdsong", "ambience", "music"].forEach(c => catSel.appendChild(el("option", { value: c, text: c })));
  const trigInp = el("input.vote-input", { placeholder: "in-game event id, e.g. levelup", autocomplete: "off" });
  // suggest the real sfx event ids (js/audio.js SOUNDS, mirrored in providers-extra.js)
  if (typeof SFX_EVENT_IDS !== "undefined" && !document.getElementById("sfx-event-ids")) {
    const dl = el("datalist", { id: "sfx-event-ids" });
    [...SFX_EVENT_IDS].sort().forEach(id => dl.appendChild(el("option", { value: id })));
    document.body.appendChild(dl);
  }
  trigInp.setAttribute("list", "sfx-event-ids");
  const fileInp = el("input", { type: "file", accept: "audio/*" });
  const preview = el("div", { style: "margin-top:.35rem" });
  let dataUrl = null;
  const readAsDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Couldn't read that file.")); r.readAsDataURL(f); });
  fileInp.addEventListener("change", async () => {
    const f = fileInp.files && fileInp.files[0]; if (!f) return;
    if (f.size > 2000000) { toast("Please keep clips under 2 MB.", "warn"); fileInp.value = ""; return; }
    try { dataUrl = await readAsDataUrl(f); clear(preview); preview.appendChild(el("audio", { controls: true, src: dataUrl, style: "height:2.1rem" })); if (!nameInp.value) nameInp.value = f.name.replace(/\.[^.]+$/, ""); }
    catch (e) { toast(e.message || "Read failed.", "err"); }
  });
  const fld = (label, node) => el("label.field", { style: "margin:0;flex:1;min-width:9rem" }, [el("span", { text: label }), node]);
  box.appendChild(el("div", { style: "display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end" }, [
    fld("Name", nameInp), fld("Category", catSel), fld("Trigger", trigInp), fld("Audio file", fileInp),
  ]));
  box.appendChild(preview);
  const btn = el("button.btn.primary.sm", { style: "margin-top:.5rem", text: "Submit sound" });
  btn.onclick = async () => {
    if (!Taiao.logged()) { toast("Sign in to submit a sound.", "warn"); App.go("#/settings"); return; }
    const name = nameInp.value.trim();
    if (!name) { toast("Name your sound.", "warn"); return; }
    if (!dataUrl) { toast("Choose an audio file.", "warn"); return; }
    // A sound submission is always an upload — always ask.
    const provenance = await askProvenance("sound");
    if (!provenance) return;   // Cancel aborts the submit
    btn.disabled = true;
    try {
      const bundle = { schema: "taiao-sound/1", object: { type: "sound" }, sound: { name, category: catSel.value, trigger: trigInp.value.trim(), src: dataUrl } };
      // Uploaded audio is UGC → curator review before it appears for voting.
      const r = await Taiao.submitProposal("sound", "all", name, bundle, "upload", provenance);
      if (r && r.ok) {
        toast(r.status === "pending"
          ? "Submitted — a moderator will review your sound before it appears for voting."
          : "Sound submitted for voting!", "ok", 6000);
        nameInp.value = trigInp.value = fileInp.value = ""; dataUrl = null; clear(preview); onAdded && onAdded();
      } else toast((r && r.error) || "Couldn't submit.", "err", 6000);
    } finally { btn.disabled = false; }
  };
  box.appendChild(btn);
  return box;
}

function catalogTile(entry, provider) {
  const snake = entry.snake || entry.key;            // unique snake_case id
  const common = entry.common || entry.name;         // common (display) name
  const tag = provider.type === "character" ? (entry.npc ? "NPC" : "player") : "";
  return el("a.tile", { href: "#/detail?type=" + provider.type + "&key=" + encodeURIComponent(entry.key) }, [
    tileThumb(entry, provider),
    el("div.meta", null, [
      el("div.name", { text: common }),
      el("div.sub.mono", { title: entry.title || "", text: snake + (tag ? "  ·  " + tag : "") }),
    ]),
  ]);
}

function communityTile(p, type) {
  const thumb = el("div.thumb", { text: "…" });
  lazyThumb(thumb, p.id);
  return el("a.tile", { href: "#/detail?type=" + type + "&key=" + encodeURIComponent(p._subj.folder) }, [
    thumb,
    el("div.meta", null, [el("div.name", { text: p.title || Roster.prettyName(p._subj.folder) }), el("div.credit", null, ["by ", el("span.u", { text: p.username || "someone" }), "  ·  ", el("span.votes", { text: (p.endorsements || 0) + " ▲" })])]),
  ]);
}

function projectTile(p) {
  const thumbSrc = p.base && (p.base.south || p.base.image || firstVal(p.base));
  const thumb = el("div.thumb");
  if (thumbSrc) { const cv = el("canvas", { width: 128, height: 128 }); drawSprite(cv, thumbSrc, 128); thumb.appendChild(cv); }
  else thumb.appendChild(el("div", { style: "font-size:2rem;opacity:.5", text: "📦" }));
  const nStates = (p.states || []).length, nAnims = (p.anims || []).length;
  return el("a.tile", { href: "#/edit/" + p.id }, [
    thumb,
    el("div.meta", null, [el("div.name", { text: p.name }), el("div.sub", { text: [nStates ? nStates + " states" : "", nAnims ? nAnims + " anims" : "", fmtWhen(p.updatedAt)].filter(Boolean).join(" · ") })]),
  ]);
}

// ---------- reference ids (costume/style reference for generation) ----------
// A single shared <datalist> of every asset's snake_case id, and a resolver
// that renders one to a sprite the PixelLab call uses as its reference.
let _refDL = null;
function refDatalist() {
  if (_refDL) return _refDL;
  _refDL = el("datalist", { id: "ref-ids" });
  const add = (id, label) => { if (id) _refDL.appendChild(el("option", { value: id, label: label && label !== id ? label : undefined })); };
  try {
    Roster.characters().forEach(e => add(e.snake, e.common));
    const mon = Providers.get("monster"); if (mon) { const seen = new Set(); mon.list().forEach(e => { const b = e.baseKey || e.key; if (seen.has(b)) return; seen.add(b); const be = mon.entry(b); add(b, be ? be.name : b); }); }
    const obj = Providers.get("object"); if (obj) obj.list().forEach(e => add(e.key, e.name));
    const ui = Providers.get("ui"); if (ui) ui.list().forEach(e => add(e.itemId, e.name));
  } catch (_) {}
  document.body.appendChild(_refDL);
  return _refDL;
}
function refDrawer(id) {
  if (!id) return null;
  const ch = Roster.characters().find(e => e.snake === id);
  if (ch) return (cv, di) => Roster.drawEntry(cv, ch, di);
  const mon = Providers.get("monster"); if (mon) { const e = mon.entry(id); if (e) return (cv, di) => mon.draw(cv, e, di); }
  const obj = Providers.get("object"); if (obj) { const e = obj.entry(id); if (e) return (cv, di) => obj.draw(cv, e, di); }
  const ui = Providers.get("ui"); if (ui) { const e = ui.entry("item:" + id) || ui.entry(id); if (e) return cv => ui.draw(cv, e); }
  return null;
}
async function resolveReference(id) {
  const draw = refDrawer(id);
  if (!draw) return null;
  const cv = el("canvas", { width: 128, height: 128 });
  draw(cv, 0);
  await sleep(320);                       // let the atlas load + async redraw land
  try { const url = cv.toDataURL("image/png"); return (url && url.length > 300) ? url : null; } catch (_) { return null; }
}

// the sprite ids already taken across the studio (lowercased) — for the new-
// character sprite_id uniqueness check. Local drafts are merged in async.
function takenSpriteIds() {
  const set = new Set();
  const add = v => { if (v) set.add(String(v).toLowerCase()); };
  try { Roster.characters().forEach(e => { add(e.snake); add(e.key); }); } catch (_) {}
  try { if (typeof allStudioSpriteIds === "function") allStudioSpriteIds().forEach(add); } catch (_) {}
  try { Store.all("character").then(rows => rows.forEach(p => { add(p.folder); add(p.spriteId); })).catch(() => {}); } catch (_) {}
  return set;
}

// a snake_case id field → { field, input, validate }. Rejects malformed ids and
// (when `taken` is given) ids already in use.
function snakeIdField(labelText, placeholder, taken) {
  const input = el("input", { placeholder, autocomplete: "off" });
  const note = el("small", { style: "min-height:1em;display:block" });
  const validate = () => {
    const raw = input.value.trim(); let ok = true, msg = "", col = "#e06a6a";
    if (!raw) { ok = false; msg = ""; }
    else if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(raw)) { ok = false; msg = "Use lowercase snake_case (letters, numbers, underscores)."; }
    else if (taken && taken.has(raw.toLowerCase())) { ok = false; msg = "“" + raw + "” is already in use — pick another."; }
    else { msg = "✓ available"; col = "#5bbd6b"; }
    note.textContent = msg; note.style.color = col; return ok;
  };
  input.addEventListener("input", validate);
  return { field: el("label.field", null, [el("span", { text: labelText }), input, note]), input, validate };
}

// the point-budget character stat block → { nodes, readStats, balanceOK }. Two
// budgets: Height/Width/Speed (body) and Toughness + XP aptitudes (apt). Weight is
// derived (mass ∝ height × width²), not entered.
function buildStatBlock(opts) {
  // NPCs skip Toughness + XP aptitudes (opts.aptitudes === false); players keep them.
  const aptitudes = !opts || opts.aptitudes !== false;
  const ALL_SPECS = [
    { key: "h", label: "Height", min: 0.7, max: 1.3, def: 1, neutral: 1, group: "body" },
    { key: "w", label: "Width", min: 0.7, max: 1.3, def: 1, neutral: 1, group: "body" },
    { key: "speed", label: "Speed", min: 0.6, max: 1.45, def: 1, neutral: 1, group: "body" },
    { key: "tough", label: "Toughness", min: 0, max: 0.45, def: 0, neutral: 0, group: "apt" },
  ];
  const STAT_SPECS = ALL_SPECS.filter(s => aptitudes || s.group !== "apt");
  const GROUPS = aptitudes ? ["body", "apt"] : ["body"];
  const XP = { neutral: 1, min: 0.85, max: 1.6 };
  const BUDGETS = { body: 2.0, apt: 1.5 };
  const BUDGET_LABEL = { body: "Body (height / width / speed)", apt: "Toughness & aptitudes" };
  const costOf = (spec, v) => { const dev = Math.max(spec.neutral - spec.min, spec.max - spec.neutral) || 1; return Math.abs((isNaN(v) ? spec.neutral : v) - spec.neutral) / dev; };
  const statInputs = {}, xpRows = [];
  const meters = { body: el("div", { style: "font-size:.75rem;min-height:1em;margin-top:.3rem" }) };
  if (aptitudes) meters.apt = el("div", { style: "font-size:.75rem;min-height:1em" });
  const recalc = () => {
    const tot = { body: 0, apt: 0 };
    STAT_SPECS.forEach(s => { tot[s.group] += costOf(s, parseFloat(statInputs[s.key].value)); });
    xpRows.forEach(r => { if (r.sel.value) tot.apt += costOf(XP, parseFloat(r.inp.value)); });
    let allOk = true;
    GROUPS.forEach(g => {
      const ok = tot[g] <= BUDGETS[g] + 1e-9; allOk = allOk && ok;
      meters[g].textContent = BUDGET_LABEL[g] + " budget: " + tot[g].toFixed(2) + " / " + BUDGETS[g].toFixed(1) + (ok ? " ✓" : " — too high, spread the points out");
      meters[g].style.color = ok ? "var(--ink-dim)" : "#e06a6a";
    });
    return allOk;
  };
  const clampInput = (i, min, max) => i.addEventListener("input", () => { let v = parseFloat(i.value); if (!isNaN(v)) { if (v < min) i.value = String(min); else if (v > max) i.value = String(max); } recalc(); });
  const statCell = spec => {
    const i = el("input", { type: "number", min: String(spec.min), max: String(spec.max), step: "0.05", value: String(spec.def), style: "width:100%" });
    clampInput(i, spec.min, spec.max); statInputs[spec.key] = i;
    return el("label.field", { style: "margin:0;flex:1;min-width:6.5rem" }, [el("span", { text: spec.label }), i]);
  };
  const skills = (typeof SKILLS !== "undefined" && Array.isArray(SKILLS)) ? SKILLS.slice() : [];
  const xpHost = el("div", { style: "display:flex;flex-direction:column;gap:.35rem" });
  const addXpRow = () => {
    const sel = el("select"); sel.appendChild(el("option", { value: "", text: "— skill —" })); skills.forEach(s => sel.appendChild(el("option", { value: s, text: s })));
    const inp = el("input", { type: "number", min: String(XP.min), max: String(XP.max), step: "0.05", value: "1.0", style: "width:5rem" });
    const rm = el("button.btn.sm.ghost", { type: "button", text: "×", title: "remove" });
    const row = el("div.row", { style: "gap:.4rem;align-items:center" }, [sel, inp, rm]);
    const entry = { sel, inp };
    rm.onclick = () => { const k = xpRows.indexOf(entry); if (k >= 0) xpRows.splice(k, 1); row.remove(); recalc(); };
    sel.onchange = recalc; clampInput(inp, XP.min, XP.max);
    xpRows.push(entry); xpHost.appendChild(row); recalc();
  };
  const nodes = [
    el("div", { style: "font-size:.75rem;color:var(--ink-dim);margin-top:.5rem", text: aptitudes ? "Stats (× multipliers; toughness = damage-soak fraction)" : "Stats (× multipliers)" }),
    el("div", { style: "display:flex;gap:.5rem;flex-wrap:wrap" }, STAT_SPECS.map(statCell)),
    meters.body,
  ];
  if (aptitudes) {
    nodes.push(el("label.field", { style: "margin-top:.4rem" }, [el("span", { text: "XP aptitudes (per skill, ×)" }), xpHost,
      el("button.btn.sm", { type: "button", text: "＋ Add aptitude", style: "margin-top:.3rem", onclick: addXpRow })]));
    nodes.push(meters.apt);
  }
  recalc();
  const readStats = () => {
    const stats = { xp: {} };
    STAT_SPECS.forEach(s => { const v = parseFloat(statInputs[s.key].value); stats[s.key] = isNaN(v) ? s.neutral : v; });
    stats.weight = stats.h * stats.w * stats.w;
    xpRows.forEach(r => { if (r.sel.value) stats.xp[r.sel.value] = parseFloat(r.inp.value); });
    return stats;
  };
  return { nodes, readStats, balanceOK: recalc };
}

// shared datalist of character sprite ids (Roster + character drafts) for the
// "default sprite" picker.
function charSpriteDatalist() {
  const ID = "char-sprite-ids";
  if (document.getElementById(ID)) return ID;
  const dl = el("datalist", { id: ID });
  const add = v => { if (v) dl.appendChild(el("option", { value: v })); };
  try { Roster.characters().forEach(e => add(e.snake || e.key)); } catch (_) {}
  try { Store.all("character").then(rows => rows.forEach(p => add(p.spriteId || p.folder))).catch(() => {}); } catch (_) {}
  // community-published character sprites are selectable as a default sprite too
  try { publishedSpritesCached().then(items => items.filter(it => it.category === "character").forEach(it => add(it.sprite_id))).catch(() => {}); } catch (_) {}
  document.body.appendChild(dl);
  return ID;
}

// Live preview under a Default sprite_id input: when the typed id names a
// published community sprite, show its thumbnail + maker (so the player can see
// the real art they're about to reuse). Debounced; art is bound on submit.
function attachPublishedPreview(input, host) {
  let t = null;
  const update = () => {
    const want = input.value.trim().toLowerCase();
    clear(host);
    if (!want) return;
    publishedSpritesCached().then(items => {
      if (input.value.trim().toLowerCase() !== want) return;   // input moved on
      const hit = items.find(it => String(it.sprite_id).toLowerCase() === want);
      if (!hit) return;
      const cv = el("canvas", { width: 48, height: 48, style: "width:48px;height:48px;image-rendering:pixelated;flex:0 0 auto" });
      if (hit.thumb) drawSprite(cv, hit.thumb, 48);
      host.appendChild(el("div", { style: "display:flex;align-items:center;gap:.5rem;margin-top:.3rem" }, [
        cv, el("small", { style: "color:#5bbd6b", text: "✓ community sprite by @" + (hit.username || "someone") + " — its art will be used" }),
      ]));
    }).catch(() => {});
  };
  input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(update, 300); });
}

// ---------- create a character ENTITY (id + stats + a default sprite) ----------
// Lives on the Player / NPC pages, NOT the Sprites tab: sprites are just art; a
// character is an entity that points at a sprite by id. No art is generated here.
function buildCharacterCreator(host, roster) {
  const form = el("div");
  const cid = snakeIdField("character id", "", takenSpriteIds());
  form.appendChild(cid.field);
  const nameIn = el("input", { autocomplete: "off" });
  form.appendChild(el("label.field", null, [el("span", { text: "Name" }), nameIn]));
  const sprIn = el("input", { autocomplete: "off" });
  sprIn.setAttribute("list", charSpriteDatalist());
  const sprNote = el("small", { style: "min-height:1em;display:block" });
  const validateSpr = () => {
    const raw = sprIn.value.trim();
    if (raw && !/^[a-z0-9]+(_[a-z0-9]+)*$/.test(raw)) { sprNote.textContent = "Use lowercase snake_case."; sprNote.style.color = "#e06a6a"; return false; }
    sprNote.textContent = ""; return true;
  };
  sprIn.addEventListener("input", validateSpr);
  form.appendChild(el("label.field", null, [el("span", { text: "Default sprite_id" }), sprIn, sprNote]));
  const sprPrev = el("div"); form.appendChild(sprPrev); attachPublishedPreview(sprIn, sprPrev);
  const stat = buildStatBlock({ aptitudes: roster !== "npc" });
  stat.nodes.forEach(n => form.appendChild(n));
  const btn = el("button.btn.primary", { text: "Create " + (roster === "npc" ? "NPC" : "player character") });
  form.appendChild(el("div.btn-row", { style: "margin-top:.5rem" }, [btn]));
  btn.onclick = async () => {
    if (!cid.input.value.trim()) return toast("Enter a character id.", "warn");
    if (!cid.validate()) return toast("That character id is invalid or already in use.", "warn");
    if (!validateSpr()) return toast("That sprite id isn't valid snake_case.", "warn");
    if (!stat.balanceOK()) return toast("Stats are over budget — spread the points out.", "warn");
    const charId = cid.input.value.trim().toLowerCase();
    const p = Store.newProject("character", nameIn.value.trim() || charId);
    p.charId = charId; p.folder = charId; p.isEntity = true; p.roster = roster;
    if (sprIn.value.trim()) {
      p.spriteId = sprIn.value.trim().toLowerCase();
      // If the sprite_id names a published community sprite, seed this draft's
      // base art with it so the created character actually uses that sprite.
      const art = await publishedBaseArtFor(p.spriteId);
      if (art) { p.base = art; p.provenance = p.provenance || "pixellab"; }
    }
    p.stats = stat.readStats();
    await Store.save(p); toast("Character created — saved to your drafts.", "ok"); App.go("#/edit/" + p.id);
  };
  host.appendChild(form);
}

// ---------- create a monster / world-object ENTITY (id + sprite + props) ----------
// Mirrors buildCharacterCreator: sprites are just art; the entity points at one
// by id and carries its own data. Monsters get stats + behaviour + biome;
// world objects get a biome + a couple of object properties. Saved as a draft.
function biomeChoices() {
  const out = [], seen = new Set();
  try {
    const p = Providers.get("tile");
    if (p && p.list) {
      const groups = new Map();
      for (const e of p.list()) { const m = /^bg_(\d+)_\d+$/.exec(e.key); if (!m) continue; if (!groups.has(m[1])) groups.set(m[1], e); }
      for (const [b, e] of groups) { const nm = String(e.name || "").replace(/\s*·.*$/, "").trim() || ("biome " + b); if (!seen.has(nm)) { seen.add(nm); out.push(nm); } }
    }
  } catch (_) {}
  return out;
}
// Shared datalist of a type's sprite ids (game roster/providers + your drafts).
function entitySpriteDatalist(type) {
  const ID = "entity-sprite-ids-" + type;
  if (document.getElementById(ID)) return ID;
  const dl = el("datalist", { id: ID });
  const add = v => { if (v) dl.appendChild(el("option", { value: v })); };
  try { const p = Providers.get(type); if (p && p.list) p.list().forEach(e => add(e.snake || e.key)); } catch (_) {}
  try { Store.all(type).then(rows => rows.forEach(pr => add(pr.spriteId || pr.folder))).catch(() => {}); } catch (_) {}
  // community-published sprites of this type are selectable as a default sprite too
  try { publishedSpritesCached().then(items => items.filter(it => it.category === type).forEach(it => add(it.sprite_id))).catch(() => {}); } catch (_) {}
  document.body.appendChild(dl);
  return ID;
}
function itemIdDatalist() {
  const ID = "monster-drop-item-ids";
  if (document.getElementById(ID)) return ID;
  const dl = el("datalist", { id: ID });
  try { if (typeof ITEMS !== "undefined") Object.keys(ITEMS).forEach(k => dl.appendChild(el("option", { value: k }))); } catch (_) {}
  document.body.appendChild(dl);
  return ID;
}
// Reusable "estimated cost + your balance" block for any generate dialog (same
// behaviour as the sprite generator). getEstimate() → { gens, exact }. Returns
// { node, refresh } — call refresh() when the estimate inputs change.
function costEstimateBlock(getEstimate) {
  const RATE_USD_PER_GEN = 0.125 / 25;   // 25 subscription generations ≈ $0.125 in credits
  let balance = null;
  const costLine = el("div", { style: "font-size:.78rem;margin:.3rem 0 .1rem" });
  const balLine = el("div", { style: "font-size:.72rem;margin:0 0 .3rem;color:var(--ink-dim)" });
  const node = el("div", null, [costLine, balLine]);
  const refresh = () => {
    const est = getEstimate() || { gens: 0, exact: false };
    costLine.style.color = "var(--gold)";
    costLine.textContent = "Estimated cost: " + est.gens + " generation" + (est.gens === 1 ? "" : "s") + (est.exact ? "" : " (estimate)");
    if (!balance) { balLine.textContent = PixelLab.hasKey() ? "Checking your balance…" : ""; return; }
    const subGen = balance.gen | 0, usd = balance.usd || 0;
    if (est.gens <= subGen) {
      balLine.style.color = "var(--ink-dim)";
      balLine.textContent = "You have " + subGen + " subscription generation" + (subGen === 1 ? "" : "s") + " left ✓";
    } else {
      const costUsd = est.gens * RATE_USD_PER_GEN, ok = usd >= costUsd - 1e-9;
      balLine.style.color = ok ? "var(--ink-dim)" : "#e06a6a";
      balLine.textContent = "Only " + subGen + " subscription generation" + (subGen === 1 ? "" : "s") + " left — this bills to credits: ≈ $"
        + costUsd.toFixed(3) + " · Credit balance: $" + usd.toFixed(2) + (ok ? "" : " — not enough credits");
    }
  };
  refresh();
  if (PixelLab.hasKey()) PixelLab.balance()
    .then(b => { balance = { gen: (b && b.subscription && b.subscription.generations) || 0, usd: (b && b.credits && b.credits.usd) || 0 }; refresh(); })
    .catch(() => { balLine.textContent = ""; });
  return { node, refresh };
}
// Editable monster drop table → [{ id, min, max, ch }] (ch = 0–1 probability).
function dropTableEditor() {
  const rows = [];
  const listId = itemIdDatalist();
  const host = el("div", { style: "display:flex;flex-direction:column;gap:.3rem;margin-top:.25rem" });
  const addRow = d => {
    d = d || { id: "", min: 1, max: 1, ch: 1 };
    const item = el("input", { value: d.id, placeholder: "item_id", list: listId, style: "flex:2;min-width:8rem" });
    const min = el("input", { type: "number", value: String(d.min), min: "0", style: "width:4rem", title: "min qty" });
    const max = el("input", { type: "number", value: String(d.max), min: "0", style: "width:4rem", title: "max qty" });
    const ch = el("input", { type: "number", value: String(d.ch), min: "0", max: "1", step: "0.01", style: "width:5rem", title: "drop chance 0–1" });
    const rm = el("button.btn.sm.danger", { type: "button", text: "×", title: "remove" });
    const row = el("div.row", { style: "gap:.3rem;align-items:center" }, [item, min, max, ch, rm]);
    const entry = { item, min, max, ch };
    rm.onclick = () => { const k = rows.indexOf(entry); if (k >= 0) rows.splice(k, 1); row.remove(); };
    rows.push(entry); host.appendChild(row);
  };
  const node = el("div", { style: "margin-top:.4rem" }, [
    el("div", { style: "font-size:.75rem;color:var(--ink-dim)", text: "Drop table — item · min · max · chance (0–1)" }),
    host,
    el("button.btn.sm", { type: "button", text: "＋ Add drop", style: "margin-top:.3rem", onclick: () => addRow() }),
  ]);
  const read = () => rows.map(r => ({ id: r.item.value.trim(), min: parseInt(r.min.value, 10) || 0, max: parseInt(r.max.value, 10) || 0, ch: parseFloat(r.ch.value) || 0 })).filter(d => d.id);
  return { node, read };
}
function buildEntityCreator(host, type) {
  const isMon = type === "monster";
  const bsnake = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const form = el("div");
  const cid = snakeIdField(isMon ? "monster id" : "object id", "", takenSpriteIds());
  form.appendChild(cid.field);
  const nameIn = el("input", { autocomplete: "off" });
  form.appendChild(el("label.field", null, [el("span", { text: "Name" }), nameIn]));
  const sprIn = el("input", { autocomplete: "off" });
  sprIn.setAttribute("list", entitySpriteDatalist(type));
  const sprNote = el("small", { style: "min-height:1em;display:block" });
  const validateSpr = () => { const raw = sprIn.value.trim(); if (raw && !/^[a-z0-9]+(_[a-z0-9]+)*$/.test(raw)) { sprNote.textContent = "Use lowercase snake_case."; sprNote.style.color = "#e06a6a"; return false; } sprNote.textContent = ""; return true; };
  sprIn.addEventListener("input", validateSpr);
  form.appendChild(el("label.field", null, [el("span", { text: "Default sprite_id" }), sprIn, sprNote]));
  const sprPrev = el("div"); form.appendChild(sprPrev); attachPublishedPreview(sprIn, sprPrev);

  // Biome: monsters pick MANY (one monster is created per biome); objects pick one.
  let checkedBiomes = () => [], biomeSel = null;
  if (isMon) {
    const boxes = [];
    const choices = biomeChoices();
    const PER_ROW = 3;   // 3 biomes per row → 6 columns (checkbox + label, alternating)
    const tbl = el("table", { style: "border-collapse:collapse;margin-top:.3rem" });
    let bidx = 0;
    for (let i = 0; i < choices.length; i += PER_ROW) {
      const tr = el("tr");
      for (let j = 0; j < PER_ROW; j++) {
        const b = choices[i + j];
        if (!b) { tr.appendChild(el("td")); tr.appendChild(el("td")); continue; }
        const cbid = "biome_cb_" + (bidx++);
        const cbx = el("input", { type: "checkbox", id: cbid });
        boxes.push({ cbx, name: b });
        tr.appendChild(el("td", { style: "text-align:right;padding:.12rem .35rem" }, [cbx]));
        tr.appendChild(el("td", { style: "text-align:right;padding:.12rem 1rem .12rem 0;font-size:.82rem;white-space:nowrap" }, [
          el("label", { for: cbid, style: "cursor:pointer", text: b }),
        ]));
      }
      tbl.appendChild(tr);
    }
    form.appendChild(el("div", { style: "margin-top:.5rem" }, [
      el("div", { style: "font-size:.8rem;color:var(--ink-dim)", text: "Biomes — one monster is created per biome, named “Name (Biome)”" }),
      tbl,
    ]));
    checkedBiomes = () => boxes.filter(x => x.cbx.checked).map(x => x.name);
  } else {
    biomeSel = el("select");
    biomeSel.appendChild(el("option", { value: "", text: "— biome —" }));
    biomeChoices().forEach(b => biomeSel.appendChild(el("option", { value: b, text: b })));
    form.appendChild(el("label.field", null, [el("span", { text: "Biome" }), biomeSel]));
  }

  const num = (label, val, min, step) => {
    const i = el("input", { type: "number", value: String(val), step: step || "1", style: "width:100%" });
    if (min != null) i.min = String(min);
    return { i, node: el("label.field", { style: "margin:0;flex:1;min-width:6rem" }, [el("span", { text: label }), i]) };
  };
  let aggro = null, S = null, solid = null, drops = null, objProps = () => ({});
  if (isMon) {
    aggro = el("input", { type: "checkbox" });
    form.appendChild(el("label", { style: "display:inline-flex;align-items:center;gap:.4rem;margin-top:.5rem;font-size:.82rem;cursor:pointer" }, [aggro, el("span", { text: "Aggressive (attacks on sight)" })]));
    S = { lvl: num("Level", 1, 1), hp: num("HP", 10, 1), hit: num("Max hit", 1, 0), def: num("Defence", 1, 0), atk: num("Attack speed (ms)", 2000, 200, "100"), xp: num("XP", 20, 0) };
    form.appendChild(el("div", { style: "font-size:.75rem;color:var(--ink-dim);margin-top:.5rem", text: "Combat stats" }));
    form.appendChild(el("div", { style: "display:flex;gap:.5rem;flex-wrap:wrap" }, [S.lvl.node, S.hp.node, S.hit.node, S.def.node, S.atk.node, S.xp.node]));
    drops = dropTableEditor();
    form.appendChild(drops.node);
  } else {
    // ---- world-object gameplay properties: a 2-column grid — checkboxes in the
    //      left column, labels in the right column, both right-aligned. ----
    const propGrid = el("div", { style: "display:grid;grid-template-columns:auto auto;gap:.4rem .7rem;align-items:center;justify-content:start;margin-top:.5rem" });
    let uid = 0;
    // one checkbox row → [checkbox (col1, right-aligned)] [label (col2, right-aligned)]
    const gridToggle = (label, checked) => {
      const id = "objprop_" + (++uid);
      const cb = el("input", { type: "checkbox", id }); if (checked) cb.checked = true;
      const c1 = el("span", { style: "justify-self:end" }, [cb]);
      const c2 = el("label", { for: id, style: "justify-self:end;text-align:right;font-size:.85rem;cursor:pointer", text: label });
      propGrid.appendChild(c1); propGrid.appendChild(c2);
      return { cb, show: v => { c1.style.display = c2.style.display = v ? "" : "none"; } };
    };
    // a conditional sub-field spanning both columns, right-aligned
    const gridField = (labelText, control) => {
      const cell = el("div", { style: "grid-column:1 / -1;justify-self:end;display:flex;align-items:center;gap:.4rem;font-size:.82rem" }, [el("span", { text: labelText }), control]);
      propGrid.appendChild(cell);
      return { show: v => { cell.style.display = v ? "" : "none"; } };
    };
    // Resource? → yes reveals "Tool required" (→ tool item_id); no reveals
    // "Crafting station" (→ skill id).
    const resT = gridToggle("Resource (gatherable node)", false);
    const toolT = gridToggle("Tool required", false);
    const toolIn = el("input", { placeholder: "e.g. bronze_axe", autocomplete: "off", list: itemIdDatalist(), style: "width:12rem" });
    const toolF = gridField("Tool item_id", toolIn);
    const stationT = gridToggle("Crafting station", false);
    const skillSel = el("select"); skillSel.appendChild(el("option", { value: "", text: "— skill —" })); (typeof SKILLS !== "undefined" ? SKILLS : []).forEach(s => skillSel.appendChild(el("option", { value: s, text: s })));
    const skillF = gridField("Skill id", skillSel);
    const solidT = gridToggle("Solid (blocks movement)", false); solid = solidT.cb;
    const stairsT = gridToggle("Allows walking up / down stairs", false);
    const openT = gridToggle("Open / closeable", false);
    const lockT = gridToggle("Lockable / unlockable", false);

    toolT.cb.addEventListener("change", () => toolF.show(toolT.cb.checked));
    stationT.cb.addEventListener("change", () => skillF.show(stationT.cb.checked));
    const syncRes = () => {
      const r = resT.cb.checked;
      toolT.show(r); toolF.show(r && toolT.cb.checked);
      stationT.show(!r); skillF.show(!r && stationT.cb.checked);
    };
    resT.cb.addEventListener("change", syncRes); syncRes();
    form.appendChild(propGrid);

    objProps = () => {
      const resource = resT.cb.checked;
      const toolRequired = resource && toolT.cb.checked;
      const craftingStation = !resource && stationT.cb.checked;
      return {
        resource, toolRequired, tool: toolRequired ? toolIn.value.trim() : null,
        craftingStation, skill: craftingStation ? skillSel.value : null,
        solid: solidT.cb.checked, stairs: stairsT.cb.checked, openable: openT.cb.checked, lockable: lockT.cb.checked,
      };
    };
  }
  const notes = el("input", { autocomplete: "off" });
  form.appendChild(el("label.field", null, [el("span", { text: isMon ? "Behaviour notes" : "Notes" }), notes]));

  const btn = el("button.btn.primary", { text: "Create " + (isMon ? "monster" : "world object") });
  form.appendChild(el("div.btn-row", { style: "margin-top:.5rem" }, [btn]));
  btn.onclick = async () => {
    const baseId = cid.input.value.trim().toLowerCase();
    if (!baseId) return toast("Enter an id.", "warn");
    if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(baseId)) return toast("Use lowercase snake_case for the id.", "warn");
    if (!validateSpr()) return toast("That sprite id isn't valid snake_case.", "warn");
    const baseName = nameIn.value.trim() || baseId;
    const sprId = sprIn.value.trim().toLowerCase();
    // If the sprite_id names a published community sprite, its art seeds each
    // created draft's base so the entity actually uses that sprite.
    const sprArt = sprId ? await publishedBaseArtFor(sprId) : null;

    if (!isMon) {
      if (!cid.validate()) return toast("That id is invalid or already in use.", "warn");
      const props = objProps();
      if (props.toolRequired && !props.tool) return toast("Enter the tool item_id.", "warn");
      if (props.craftingStation && !props.skill) return toast("Pick the crafting station's skill.", "warn");
      const p = Store.newProject("object", baseName);
      p.folder = baseId; p.objectId = baseId; p.isEntity = true;
      if (sprId) p.spriteId = sprId;
      if (sprArt) { p.base = sprArt; p.provenance = p.provenance || "pixellab"; }
      if (biomeSel.value) p.biome = biomeSel.value;
      if (notes.value.trim()) p.notes = notes.value.trim();
      p.props = props; p.solid = props.solid;   // p.solid kept for back-compat
      await Store.save(p); toast("World object created — saved to your drafts.", "ok"); App.go("#/edit/" + p.id);
      return;
    }

    // Monster: one draft per selected biome (name/id suffixed only when >1).
    const biomes = checkedBiomes();
    const suffix = biomes.length > 1;
    const targets = biomes.length ? biomes : [null];
    const taken = takenSpriteIds();
    const specs = [], usedIds = new Set();
    for (const b of targets) {
      const id = (b && suffix) ? (baseId + "_" + bsnake(b)) : baseId;
      const name = (b && suffix) ? (baseName + " (" + b + ")") : baseName;
      if (taken.has(id) || usedIds.has(id)) return toast("“" + id + "” is already in use — pick another id.", "warn");
      usedIds.add(id); specs.push({ id, name, biome: b });
    }
    const stats = {
      lvl: parseInt(S.lvl.i.value, 10) || 1, hp: parseInt(S.hp.i.value, 10) || 1,
      maxHit: parseInt(S.hit.i.value, 10) || 0, def: parseInt(S.def.i.value, 10) || 0,
      atkTick: parseInt(S.atk.i.value, 10) || 2000, xp: parseInt(S.xp.i.value, 10) || 0,
    };
    const dropRows = drops.read();
    btn.disabled = true;
    let firstPid = null;
    try {
      for (const s of specs) {
        const p = Store.newProject("monster", s.name);
        p.folder = s.id; p.monsterId = s.id; p.isEntity = true;
        if (sprId) p.spriteId = sprId;
        if (sprArt) { p.base = sprArt; p.provenance = p.provenance || "pixellab"; }
        if (s.biome) p.biome = s.biome;
        if (notes.value.trim()) p.notes = notes.value.trim();
        p.aggro = aggro.checked;
        p.monsterStats = { ...stats };
        p.drops = dropRows.map(d => ({ ...d }));
        await Store.save(p);
        if (!firstPid) firstPid = p.id;
      }
    } finally { btn.disabled = false; }
    if (specs.length === 1) { toast("Monster created — saved to your drafts.", "ok"); App.go("#/edit/" + firstPid); }
    else { toast(specs.length + " monsters created (one per biome) — saved to your drafts.", "ok"); App.go("#/monsters"); }
  };
  host.appendChild(form);
}

// ---------- unified sprite creation (Sprites tab) ----------
// one generator dialog for all sprite types. Character/Monster/Object → 128px,
// high top-down, 8 directions; Item → 32px, high top-down, 1 direction. Monster
// picks humanoid (skeleton) vs quadruped (8-dir object). Users only ever see
// prompt / sprite_id / seed.
const GEN_TYPES = [
  { value: "character", label: "Character" },
  { value: "monster", label: "Monster" },
  { value: "object", label: "Object" },
  { value: "item", label: "Item" },
];
// upload categories: the 8-dir ones save a south/base frame; the flat ones (item,
// map_icon, biome, other) save a single image, tagged where relevant. Player &
// NPC both fall under "Character".
const UPLOAD_CATS = [
  { cat: "character", type: "character", dirs: true, label: "Character" },
  { cat: "monster", type: "monster", dirs: true, label: "Monster" },
  { cat: "object", type: "object", dirs: true, label: "Object" },
  { cat: "item", type: "ui", dirs: false, label: "Item" },
  { cat: "map_icon", type: "map", dirs: false, tag: "map_icon", label: "Map icon" },
  { cat: "biome", type: "tile", dirs: false, tag: "biome", label: "Biome" },
  { cat: "other", type: "object", dirs: false, tag: "other", label: "Other" },
];
function readImageFile(f) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Couldn't read that file.")); r.readAsDataURL(f); });
}
// PixelLab generation-cost estimate (from api.pixellab.ai/v2 cost formulas).
//  • Character / humanoid Monster → create-character-v3 (from scratch):
//      1 (pixen) + ceil(s²·8 / 65536)  → EXACT.
//  • Object / quadruped Monster / Item → create-{8,1}-direction-object ("Pro
//      Tools"): PixelLab publishes only "20–40 per call, by resulting size" with
//      no formula, so we map our fixed size into that band (128px→40, 32px→20).
function estimateGenerations(gtype, size, bodyType) {
  const s = size || 128;
  if (gtype === "character" || (gtype === "monster" && bodyType === "humanoid"))
    return { gens: 1 + Math.ceil(s * s * 8 / 65536), exact: true };
  const gens = Math.max(20, Math.min(40, Math.round(20 + (s - 32) / (128 - 32) * 20)));
  return { gens, exact: false };
}
function openUnifiedGenerateDialog() {
  const bg = el("div.modal-bg", { onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el("div.modal", { style: "width:min(720px,94vw);max-width:none" });
  m.appendChild(el("span.x", { text: "×", onclick: () => bg.remove() }));
  m.appendChild(el("h2", { text: "Generate new sprite with PixelLab" }));
  if (!PixelLab.hasKey()) m.appendChild(el("div.banner.warn", { html: 'Add your PixelLab API key in <a href="#/settings">Settings</a> to generate.' }));

  const typeSel = el("select"); GEN_TYPES.forEach(t => typeSel.appendChild(el("option", { value: t.value, text: t.label })));
  m.appendChild(el("label.field", null, [el("span", { text: "Type" }), typeSel]));
  // monster body type — revealed only when Monster is chosen
  let monsterBody = "humanoid";
  const bodyChip = chipGroup(["humanoid", "quadruped"], "humanoid", v => { monsterBody = v; updateCost(); });
  const bodyField = el("label.field", { style: "display:none" }, [el("span", { text: "Body type" }), bodyChip.wrap]);
  typeSel.onchange = () => { bodyField.style.display = typeSel.value === "monster" ? "" : "none"; updateCost(); };
  m.appendChild(bodyField);

  const prompt = el("textarea", { placeholder: "" });
  const taken = takenSpriteIds();
  const suggestKind = () => typeSel.value === "monster" ? "monster:" + monsterBody : typeSel.value;
  const suggestBtn = el("button.btn.sm.ghost", {
    text: "✨ Suggest a prompt", onclick: () => {
      const s = GenJobs.suggest(suggestKind(), { taken });
      prompt.value = s.prompt; sid.input.value = s.id; sid.validate();
      suggestBtn.textContent = "🔁 Another suggestion";
    },
  });
  m.appendChild(el("label.field", null, [el("span", { text: "Prompt" }), prompt]));
  m.appendChild(el("div.btn-row", { style: "margin:-.3rem 0 .4rem" }, [suggestBtn]));
  const sid = snakeIdField("sprite_id", "", taken);
  m.appendChild(sid.field);
  const seedIn = el("input", { type: "number", placeholder: "seed (optional)" });
  m.appendChild(el("label.field", null, [el("span", { text: "Seed" }), seedIn]));

  // live PixelLab cost estimate + your balance. If the cost exceeds your remaining
  // subscription generations, it's billed to USD credits — so we then also show the
  // credit cost (25 generations ≈ $0.125 → $0.005/gen) and your credit balance.
  const RATE_USD_PER_GEN = 0.125 / 25;
  let balance = null;   // { gen, usd } once /balance loads
  const costLine = el("div", { style: "font-size:.78rem;margin:.1rem 0 .2rem" });
  const balLine = el("div", { style: "font-size:.72rem;margin:0 0 .3rem;color:var(--ink-dim)" });
  const updateCost = () => {
    const gtype = typeSel.value, size = gtype === "item" ? 32 : 128;
    const est = estimateGenerations(gtype, size, monsterBody);
    costLine.style.color = "var(--gold)";
    costLine.textContent = "Estimated cost: " + est.gens + " generation" + (est.gens === 1 ? "" : "s")
      + " · " + size + "px" + (gtype === "item" ? " · 1 direction" : " · 8 directions") + (est.exact ? "" : " (size-based estimate)");
    if (!balance) { balLine.textContent = PixelLab.hasKey() ? "Checking your balance…" : ""; return; }
    const subGen = balance.gen | 0, usd = balance.usd || 0;
    if (est.gens <= subGen) {
      balLine.style.color = "var(--ink-dim)";
      balLine.textContent = "You have " + subGen + " subscription generation" + (subGen === 1 ? "" : "s") + " left ✓";
    } else {
      // not enough subscription generations → this call bills to USD credits
      const costUsd = est.gens * RATE_USD_PER_GEN;
      const enough = usd >= costUsd - 1e-9;
      balLine.style.color = enough ? "var(--ink-dim)" : "#e06a6a";
      balLine.textContent = "Only " + subGen + " subscription generation" + (subGen === 1 ? "" : "s") + " left — this bills to credits: ≈ $"
        + costUsd.toFixed(3) + " · Credit balance: $" + usd.toFixed(2) + (enough ? "" : " — not enough credits");
    }
  };
  m.appendChild(costLine); m.appendChild(balLine);
  updateCost();
  if (PixelLab.hasKey()) PixelLab.balance()
    .then(b => { balance = { gen: (b && b.subscription && b.subscription.generations) || 0, usd: (b && b.credits && b.credits.usd) || 0 }; updateCost(); })
    .catch(() => { balLine.textContent = ""; });

  m.appendChild(el("p.tagline", { style: "margin-top:.6rem", text: "Generate closes this dialog — a progress toast tracks it while PixelLab works, and the finished sprite lands in your profile gallery once it's done (even across a refresh)." }));
  const genBtn = el("button.btn.primary", { text: "Generate" });
  m.appendChild(el("div.btn-row", { style: "margin-top:.4rem" }, [genBtn, el("button.btn.ghost", { text: "Cancel", onclick: () => bg.remove() })]));

  genBtn.onclick = async () => {
    if (!Taiao.logged()) { toast("Sign in (Settings) to generate.", "warn"); return; }
    if (!PixelLab.hasKey()) { toast("Add your PixelLab key in Settings.", "warn"); return; }
    if (!prompt.value.trim()) { toast("Write a prompt first.", "warn"); return; }
    if (!sid.input.value.trim()) { toast("Enter a sprite_id.", "warn"); return; }
    if (!sid.validate()) { toast("That sprite_id is invalid or already in use.", "warn"); return; }
    const gtype = typeSel.value, desc = prompt.value.trim(), seed = seedIn.value, spriteId = sid.input.value.trim().toLowerCase();
    const isItem = gtype === "item";
    const saveType = gtype === "character" ? "character" : gtype === "monster" ? "monster" : gtype === "object" ? "object" : "ui";
    const pixellabKind = (gtype === "character" || (gtype === "monster" && monsterBody === "humanoid")) ? "character" : isItem ? "object1" : "object8";
    const view = "high top-down", size = isItem ? 32 : 128;
    bg.remove();
    const gt = toastLoading("Generating “" + spriteId + "”…");
    GenJobs.execute(
      { spriteType: saveType, spriteId, label: spriteId, prompt: desc, bodyType: gtype === "monster" ? monsterBody : undefined, seed: seed || undefined, pixellabKind, view, size, template: pixellabKind === "character" ? "mannequin" : undefined }
    ).then(() => gt.done("“" + spriteId + "” is ready.", 6000))
     .catch(e => gt.fail("Generation failed: " + (e && e.message || e)));
  };
  bg.appendChild(m); document.body.appendChild(bg);
}
async function handleSpriteUpload(cat, fileInp, idIn) {
  const spec = UPLOAD_CATS.find(c => c.cat === cat) || UPLOAD_CATS[0];
  const f = fileInp.files && fileInp.files[0];
  if (!f) { toast("Choose an image file.", "warn"); return; }
  const id = (idIn.value || "").trim().toLowerCase();
  if (!id || !/^[a-z0-9]+(_[a-z0-9]+)*$/.test(id)) { toast("Enter a snake_case sprite id.", "warn"); return; }
  if (takenSpriteIds().has(id)) { toast("“" + id + "” is already in use.", "warn"); return; }
  let dataUrl; try { dataUrl = await readImageFile(f); } catch (e) { toast(e.message || "Couldn't read that image.", "err"); return; }
  const p = Store.newProject(spec.type, id);
  p.folder = id; p.spriteId = id; p.uploaded = true;
  // publishProject's moderation-gate/disclosure-gate decision reads
  // p.baseUploaded (not p.uploaded) — set both so this quick-uploaded draft
  // is correctly treated as "upload" (curator review + askProvenance) rather
  // than silently defaulting to "pixellab" at publish time.
  p.baseUploaded = true;
  // Asked for real (own/AI) via askProvenance at publish time — this is just
  // a draft-time placeholder flagging that it needs asking.
  p.provenance = "unknown";
  if (spec.roster) p.roster = spec.roster;
  if (spec.tag) p.tag = spec.tag;
  p.base = spec.dirs ? { south: dataUrl } : { image: dataUrl };
  await Store.save(p);
  toast("Uploaded “" + id + "” — saved to your drafts.", "ok"); App.go("#/edit/" + p.id);
}
function spriteCreateCard() {
  const card = el("div.card");
  card.appendChild(el("div.sectitle", null, [el("h3", null, ["Create a sprite ", el("span.hint", { text: "generate with PixelLab, or upload your own" })])]));
  // The prompt to sign in / add a key re-evaluates whenever auth resolves — auth
  // lands ~300ms after boot, so a signed-in player must not be left staring at a
  // stale "Sign in to generate" banner.
  const notice = el("div");
  card.appendChild(notice);
  function refreshNotice() {
    clear(notice);
    if (!Taiao.logged())
      notice.appendChild(el("div.banner.info", { html: '<a href="#/settings">Sign in</a> to generate — it tracks your in-progress generations so they survive a refresh (uploads work without signing in).' }));
    else if (!PixelLab.hasKey())
      notice.appendChild(el("div.banner.warn", { html: 'Add your PixelLab API key in <a href="#/settings">Settings</a> to generate (uploads work without a key).' }));
  }
  refreshNotice();
  Taiao.onAuth(refreshNotice);
  card.appendChild(el("div.btn-row", { style: "flex-wrap:wrap;gap:.5rem" }, [
    el("button.btn.primary.sm", { text: "Generate new sprite with PixelLab", onclick: openUnifiedGenerateDialog }),
  ]));

  card.appendChild(el("h4", { style: "margin:.9rem 0 .3rem;font-size:.8rem;color:var(--accent)", text: "Or upload your own art" }));
  const catSel = el("select"); UPLOAD_CATS.forEach(c => catSel.appendChild(el("option", { value: c.cat, text: c.label })));
  const idIn = el("input", { placeholder: "snake_case sprite id", autocomplete: "off" });
  const fileInp = el("input", { type: "file", accept: "image/*" });
  const upBtn = el("button.btn.sm", { text: "Upload", onclick: () => handleSpriteUpload(catSel.value, fileInp, idIn) });
  card.appendChild(el("div.row", { style: "gap:.6rem;align-items:flex-end;flex-wrap:wrap" }, [
    el("label.field", { style: "margin:0" }, [el("span", { text: "Category" }), catSel]),
    el("label.field", { style: "margin:0;flex:1;min-width:10rem" }, [el("span", { text: "Sprite id" }), idIn]),
    el("label.field", { style: "margin:0" }, [el("span", { text: "Image" }), fileInp]),
    upBtn,
  ]));
  card.appendChild(el("p.tagline", { style: "font-size:.72rem;margin-top:.4rem", text: "8-direction kinds (character/monster/object) save your image as the south frame — add the other directions in the editor. Item, map icon, biome & other save a single image." }));
  card.appendChild(el("p.tagline", { style: "font-size:.72rem", text: "Upload your own work, or AI work you disclose as AI. Undisclosed AI art gets removed — honest credit is the whole game here." }));
  return card;
}
