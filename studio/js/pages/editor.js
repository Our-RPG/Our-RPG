// ===== Our RPG Workshop — project editor =====
// One character or object, fully dressed: its base art, its design data
// (name, bio, spawning rules, animation-event triggers, state-change
// triggers), its variant states / costumes, its animations, and its
// direction sets. From here a player can generate more art, download the set
// for a pull request, or share a costume to the community workshop for a vote.
"use strict";

let _editState = { p: null };

// Human name for an item id (for generation prompts & badges).
const _itemLabel = id => (typeof ITEMS !== "undefined" && ITEMS[id] && ITEMS[id].name) || String(id || "").replace(/_/g, " ");

// One shared <datalist> of every item id (id + name), so the state item fields
// autocomplete. Built once, lazily.
function ensureItemDatalist() {
  const ID = "studio-item-ids";
  if (document.getElementById(ID)) return ID;
  const dl = el("datalist", { id: ID });
  if (typeof ITEMS !== "undefined") {
    for (const id of Object.keys(ITEMS)) {
      const nm = ITEMS[id] && ITEMS[id].name;
      dl.appendChild(el("option", { value: id, label: nm && nm !== id ? nm : undefined }));
    }
  }
  document.body.appendChild(dl);
  return ID;
}

// Turn a state's item ids into a generation-prompt suffix so PixelLab draws the
// character actually holding / wearing / equipping them.
function itemPromptSuffix(items) {
  const names = (items || []).map(s => String(s || "").trim()).filter(Boolean).map(_itemLabel);
  if (!names.length) return "";
  return ", wearing and holding " + names.join(" and ");
}

// ---------- image helpers ----------
// Load a data-URL into an Image (resolves null on failure, never rejects).
function loadImg(url) {
  return new Promise(res => { if (!url) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
}

async function pageEditor(root, id) {
  clear(root);
  const p = await Store.get(id);
  if (!p) { root.appendChild(el("div.empty", { html: "<div class='big'>🤷</div>That project is gone. <a href='#/players'>Back to library</a>." })); return; }
  _editState.p = p;
  const isChar = p.kind !== "object";      // characters & monsters share the humanoid/creature editor
  window._editType = p.kind;
  const backHash = { character: "#/players", object: "#/objects", monster: "#/monsters" }[p.kind] || "#/players";
  const page = el("div.page");

  // ---- header ----
  const head = el("div.card");
  const title = el("input", { value: p.name, style: "font-size:1.2rem;font-weight:700", onchange: async () => { p.name = title.value.trim() || p.name; p.folder = slug(p.name); await Store.save(p); toast("Renamed.", "ok"); } });
  head.appendChild(el("div.sectitle", null, [
    el("div", { style: "flex:1" }, [title]),
    el("span.badge", { text: p.kind }),
  ]));
  head.appendChild(el("div.kv", { style: "margin-top:.4rem" }, [
    el("dt", { text: "folder" }), el("dd.mono", { text: p.folder }),
    el("dt", { text: "prompt" }), el("dd", { text: p.prompt || "—" }),
    el("dt", { text: "in-game path" }), el("dd.mono", { text: GAME_ART_PATH.replace("<folder>", p.folder) }),
  ]));
  const back = el("a.btn.ghost.sm", { text: "← Library", href: backHash });
  const del = el("button.btn.danger.sm", { text: "Delete", onclick: async () => { if (confirm("Delete this draft? (Local only — nothing already published is removed.)")) { await Store.remove(p.id); toast("Deleted.", "ok"); App.go(backHash); } } });
  const dl = el("button.btn.sm", { text: "⬇ Download set", onclick: () => downloadProject(p) });
  const pub = el("button.btn.gold.sm", { text: "🌐 Publish to community", onclick: () => publishProject(p) });
  head.appendChild(el("div.btn-row", { style: "margin-top:.6rem" }, [back, pub, dl, del]));
  page.appendChild(head);

  // ---- base art ----
  const baseCard = el("div.card");
  baseCard.appendChild(el("h3", { text: "Base art" }));
  baseCard.appendChild(dirGridEditor(p, p.base || (p.base = {}), { isChar, label: "base", onchange: () => Store.save(p), setUploaded: v => { p.baseUploaded = v; } }));
  page.appendChild(baseCard);

  // ---- design (character) / notes (object) ----
  page.appendChild(isChar ? designCard(p) : notesCard(p));

  // ---- variant states / costumes ----
  page.appendChild(statesCard(p, isChar));

  // ---- animations ----
  page.appendChild(animsCard(p, isChar));

  root.appendChild(page);
}

// ---------- an editable 8-direction grid (generate / upload / rotate) ----------
function dirGridEditor(p, store, opts) {
  const wrap = el("div");
  const single = !opts.isChar && ("image" in store) && !DIRS8.some(d => store[d]);
  const grid = el("div.dirgrid");
  function redraw() {
    clear(grid);
    if (single) {
      const cv = el("canvas.spr");
      if (store.image) drawSprite(cv, store.image, 96);
      const cell = el("div.dircell", null, [cv, el("div.lbl", { text: "icon" })]);
      cell.onclick = () => uploadInto(store, "image");
      grid.appendChild(cell);
      return;
    }
    for (const d of DIRS8) {
      const cv = el("canvas.spr");
      if (store[d]) drawSprite(cv, store[d], 96);
      const cell = el("div.dircell", null, [cv, el("div.lbl", { text: DIR_SHORT[d] })]);
      cell.title = "Click to upload " + d;
      cell.onclick = () => uploadInto(store, d);
      grid.appendChild(cell);
    }
  }
  function uploadInto(obj, key) {
    const inp = el("input", { type: "file", accept: "image/*", style: "display:none" });
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const img = await fileToB64Image(f);
      obj[key] = b64ToDataUrl(img);
      // Human-uploaded art → this store carries UGC, so its proposal must go
      // through curator moderation (setUploaded true). A later clean full
      // generation clears the flag again. Provenance stamped "unknown" here —
      // the real disclosure question (askProvenance) is asked at publish time.
      opts.setUploaded && opts.setUploaded(true);
      p.provenance = "unknown";
      redraw(); opts.onchange && opts.onchange();
      toast("Frame set.", "ok");
    };
    document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 1000);
  }
  redraw();
  wrap.appendChild(grid);

  // action row: regenerate all 8 / rotate south→8
  const desc = el("input", { placeholder: "describe the art for regeneration / rotation…", value: p.prompt || "" });
  const genAll = el("button.btn.sm", { text: opts.isChar ? "Generate 8 directions" : "Generate 8-dir", onclick: async () => {
    if (!PixelLab.hasKey()) return toast("Add your PixelLab key in Settings.", "warn");
    if (!desc.value.trim()) return toast("Describe the art first.", "warn");
    genAll.disabled = true; toast("Generating full set…");
    try {
      const gen = p.gen || {};
      // States can carry item ids the character should be shown holding/wearing.
      const description = desc.value.trim() + (opts.getItems ? itemPromptSuffix(opts.getItems()) : "");
      const r = opts.isChar
        ? await PixelLab.createCharacter({ description, view: gen.view, size: gen.size, template: gen.template, outline: gen.outline, detail: gen.detail })
        : await PixelLab.createObject8({ description, view: gen.view, size: gen.size });
      Object.keys(store).forEach(k => delete store[k]);
      Object.assign(store, r.dirs);
      // A full clean PixelLab generation replaces any uploaded frames, so this
      // store is once again pure generated art.
      opts.setUploaded && opts.setUploaded(false);
      p.provenance = "pixellab";
      redraw(); opts.onchange && opts.onchange();
      toast("Set generated.", "ok");
    } catch (e) { toast(e.message, "err", 6000); }
    genAll.disabled = false;
  } });
  const rotate = el("button.btn.sm", { text: "Rotate south → 8", onclick: async () => {
    if (!PixelLab.hasKey()) return toast("Add your PixelLab key in Settings.", "warn");
    const src = store.south || store.image || firstVal(store);
    if (!src) return toast("Upload or generate a south-facing frame first.", "warn");
    rotate.disabled = true; toast("Rotating into 8 directions…");
    try {
      const first = { type: "base64", base64: dataUrlToB64(src), format: "png" };
      const dirs = await PixelLab.rotate8(first, desc.value.trim() + (opts.getItems ? itemPromptSuffix(opts.getItems()) : ""));
      Object.assign(store, dirs); delete store.image; redraw(); opts.onchange && opts.onchange();
      toast("Rotated.", "ok");
    } catch (e) { toast(e.message, "err", 6000); }
    rotate.disabled = false;
  } });
  wrap.appendChild(el("label.field", { style: "margin-top:.6rem" }, [el("span", { text: "Art description (for generate / rotate)" }), desc]));
  wrap.appendChild(el("div.btn-row", null, [genAll, rotate, el("small", { text: "…or click any cell to upload your own PNG." })]));
  return wrap;
}

// ---------- character design ----------
function designCard(p) {
  const c = el("div.card");
  c.appendChild(el("h3", null, ["Character design ", el("span.hint", { text: "name · bio · spawning · triggers" })]));
  const bio = el("textarea", { placeholder: "Who is this character? Their story, role, voice…", value: p.bio || "" });
  bio.onchange = () => { p.bio = bio.value; Store.save(p); };
  c.appendChild(el("label.field", null, [el("span", { text: "Bio" }), bio]));

  const sp = p.spawn || (p.spawn = { biomes: "", rarity: "", notes: "" });
  const biomes = el("input", { value: sp.biomes, placeholder: "forest, coast, alpine…" });
  const rarity = el("input", { value: sp.rarity, placeholder: "common / rare / unique" });
  const spNotes = el("input", { value: sp.notes, placeholder: "near roads, night only, after quest X…" });
  [["biomes", biomes], ["rarity", rarity], ["notes", spNotes]].forEach(([k, i]) => i.onchange = () => { sp[k] = i.value; Store.save(p); });
  c.appendChild(el("h3", { style: "margin-top:.8rem;font-size:.92rem", text: "Spawning rules" }));
  c.appendChild(el("div.row", null, [
    el("label.field", null, [el("span", { text: "Biomes" }), biomes]),
    el("label.field", null, [el("span", { text: "Rarity" }), rarity]),
  ]));
  c.appendChild(el("label.field", null, [el("span", { text: "Spawn conditions" }), spNotes]));

  // trigger categories with real in-game dropdowns
  c.appendChild(triggerCategories(p));
  return c;
}

function notesCard(p) {
  const c = el("div.card");
  c.appendChild(el("h3", { text: "Object notes" }));
  const bio = el("textarea", { placeholder: "What is this item? How is it used, worn or equipped?", value: p.bio || "" });
  bio.onchange = () => { p.bio = bio.value; Store.save(p); };
  c.appendChild(el("label.field", null, [el("span", { text: "Description" }), bio]));
  c.appendChild(triggerCategories(p));
  return c;
}

// Five trigger categories, each a list of rows: [real-vocab dropdown] + [when/
// condition] + [delete]. Stored on p.trig = { animation, state, lifecycle,
// sound, movement: [{t, cond}] }.
function triggerCategories(p) {
  p.trig = p.trig || {};
  const box = el("div", { style: "margin-top:.6rem" });
  box.appendChild(el("h3", { style: "font-size:.95rem", text: "Triggers" }));
  box.appendChild(el("p.tagline", { text: "Pick from the game's real triggers — the dropdowns list the actual sounds, animations, states, lifecycle and movement events." }));
  (typeof GameTriggers !== "undefined" ? GameTriggers.categories() : []).forEach(cat => box.appendChild(triggerCategory(p, cat)));
  return box;
}
function triggerCategory(p, cat) {
  const arr = p.trig[cat.key] = p.trig[cat.key] || [];
  const box = el("div", { style: "margin-top:.6rem" });
  box.appendChild(el("h3", { style: "font-size:.86rem", text: cat.title }));
  const list = el("div.triglist");
  function redraw() {
    clear(list);
    arr.forEach((row, i) => {
      const sel = el("select");
      cat.opts.forEach(o => sel.appendChild(el("option", { value: o, text: o, selected: o === row.t })));
      sel.onchange = () => { row.t = sel.value; Store.save(p); };
      const cond = el("input", { value: row.cond || "", placeholder: cat.cond, onchange: () => { row.cond = cond.value; Store.save(p); } });
      const del = el("button.btn.sm.danger", { text: "✕", onclick: () => { arr.splice(i, 1); Store.save(p); redraw(); } });
      list.appendChild(el("div.trig", null, [sel, cond, del]));
    });
    if (!arr.length) list.appendChild(el("small", { text: "None." }));
  }
  redraw();
  box.appendChild(list);
  box.appendChild(el("button.btn.sm.ghost", { style: "margin-top:.3rem", text: "+ Add " + cat.title.replace(/ triggers?$/i, "").toLowerCase(), onclick: () => { arr.push({ t: cat.opts[0], cond: "" }); Store.save(p); redraw(); } }));
  return box;
}

// Generic two-column trigger list stored on p[key] = [{a,b}].
function triggerEditor(p, key, heading, aLabel, aPh, bLabel, bPh) {
  const arr = p[key] || (p[key] = []);
  const box = el("div", { style: "margin-top:.8rem" });
  box.appendChild(el("h3", { style: "font-size:.92rem", text: heading }));
  const list = el("div.triglist");
  function redraw() {
    clear(list);
    arr.forEach((t, i) => {
      const a = el("input", { value: t.a, placeholder: aPh, onchange: () => { t.a = a.value; Store.save(p); } });
      const b = el("input", { value: t.b, placeholder: bPh, onchange: () => { t.b = b.value; Store.save(p); } });
      const x = el("button.btn.sm.danger", { text: "✕", onclick: () => { arr.splice(i, 1); Store.save(p); redraw(); } });
      list.appendChild(el("div.trig", null, [a, b, x]));
    });
    if (!arr.length) list.appendChild(el("small", { text: "None yet." }));
  }
  redraw();
  box.appendChild(el("div.trig", { style: "margin-bottom:.3rem" }, [el("small", { text: aLabel }), el("small", { text: bLabel }), el("span")]));
  box.appendChild(list);
  box.appendChild(el("button.btn.sm.ghost", { style: "margin-top:.4rem", text: "+ Add trigger", onclick: () => { arr.push({ a: "", b: "" }); Store.save(p); redraw(); } }));
  return box;
}

// ---------- states / costumes (a tree) ----------
// States nest: a "subtract" parts-state is a child of the state it was carved
// from. "New state" first asks HOW — generate through PixelLab, or subtract a
// game sprite from the parent to leave a transparent parts-state (no PixelLab).
function statesCard(p, isChar) {
  p.states = p.states || [];
  const c = el("div.card");
  c.appendChild(el("div.sectitle", null, [
    el("h3", null, ["Variant states & costumes ", el("span.hint", { text: "tree · costumes & carved parts" })]),
    el("span.badge", { text: p.states.length + "" }),
  ]));
  c.appendChild(el("p.tagline", { text: isChar
    ? "Each state is an alternative look — a costume, armour, or a part carved out of another state. Use ＋ on a state to add a child: generate a new look, or subtract one look from another to carve just a part."
    : "Each state is an alternative depiction — a variant material, a worn/used form, an alternative style." }));

  const list = el("div", { style: "margin-top:.6rem" });
  function renderTree(host, parentId, depth) {
    p.states.filter(s => (s.parent || null) === (parentId || null)).forEach(st => {
      const wrap = el("div", depth ? { style: "margin-left:" + (depth * 1.1) + "rem;border-left:2px solid var(--line,#333);padding-left:.6rem" } : null);
      wrap.appendChild(stateRow(p, st, isChar, redraw));
      host.appendChild(wrap);
      renderTree(host, st.id, depth + 1);
    });
  }
  function redraw() {
    clear(list);
    renderTree(list, null, 0);
    if (!p.states.length) list.appendChild(el("div.empty", { html: "<div class='big'>👕</div>No states yet — add one below." }));
  }

  redraw();
  c.appendChild(list);
  c.appendChild(el("div.btn-row", { style: "margin-top:.6rem" }, [
    el("button.btn.primary.sm", { text: "＋ New state", onclick: () => openStateChooser(p, null, redraw) }),
  ]));
  return c;
}

const stateById = (p, id) => (p.states || []).find(s => s.id === id) || null;

// Remove a state and every descendant beneath it.
function deleteStateTree(p, id) {
  const kill = new Set([id]);
  let changed = true;
  while (changed) { changed = false; for (const s of p.states) if (s.parent && kill.has(s.parent) && !kill.has(s.id)) { kill.add(s.id); changed = true; } }
  p.states = p.states.filter(s => !kill.has(s.id));
}

// Editable list of item ids a state should be generated holding / wearing —
// or, for a part state, the in-game equip TRIGGER (WardrobeParts): the same
// list, different meaning, so the label is swappable per caller.
// A "+" spawns another field; each field autocompletes against every game item.
function stateItemsEditor(p, st, label) {
  st.items = st.items || [];
  const listId = ensureItemDatalist();
  const box = el("div", { style: "margin-top:.5rem" });
  box.appendChild(el("span", { class: "lbl", style: "font-size:.82rem;color:var(--ink-dim)", text: label || "Items held / worn (generated onto the character)" }));
  const rows = el("div", { style: "display:flex;flex-direction:column;gap:.3rem;margin-top:.25rem" });
  function redraw() {
    clear(rows);
    st.items.forEach((val, idx) => {
      const inp = el("input", { value: val, placeholder: "item_id (e.g. bronze_sword)", list: listId, style: "flex:1" });
      inp.oninput = () => { st.items[idx] = inp.value.trim(); Store.save(p); };
      const rm = el("button.btn.sm.danger", { text: "✕", title: "Remove item", onclick: () => { st.items.splice(idx, 1); Store.save(p); redraw(); } });
      rows.appendChild(el("div", { style: "display:flex;gap:.3rem;align-items:center" }, [inp, rm]));
    });
    if (!st.items.length) rows.appendChild(el("small.tagline", { text: label
      ? "No trigger item yet — this part won't activate in-game until you add one."
      : "No items — the state generates as-is. Add an item to have the character hold/wear it." }));
  }
  redraw();
  box.appendChild(rows);
  box.appendChild(el("button.btn.sm.ghost", { style: "margin-top:.35rem", text: "+ Add item", onclick: () => { st.items.push(""); Store.save(p); redraw(); } }));
  return box;
}

function stateRow(p, st, isChar, redrawAll) {
  // Migrate the legacy single `item` field into the multi-item list.
  if (!st.items) st.items = st.item ? [st.item] : [];
  const row = el("div.card", { style: "background:var(--bg-2);margin-bottom:.7rem" });
  const head = el("div.sectitle", null, [
    el("h3", { style: "font-size:.95rem", text: st.name }),
    el("div.btn-row", null, [
      st.part ? el("span.badge", { title: "carved: kept what's new in '" + (st.fromState || "?") + "' versus '" + (st.baseState || st.fromSprite || "?") + "'", text: "➖ part ⟵ " + (st.baseState || st.fromSprite || "?") }) : null,
      el("span.badge", { text: st.slot || "no slot" }),
      st.items.filter(Boolean).length ? el("span.badge", { text: (st.part ? "🔑 " : "👕 ") + st.items.filter(Boolean).length + " item" + (st.items.filter(Boolean).length === 1 ? "" : "s") }) : null,
      el("button.btn.sm.ghost", { text: "＋", title: "Add a child state (generate or subtract)", onclick: () => openStateChooser(p, st.id, redrawAll) }),
    ].filter(Boolean)),
  ]);
  row.appendChild(head);

  if (st.part) {
    row.appendChild(el("p.tagline", { text: "Carved: kept what's new in '" + (st.fromState || "?") + "' versus '" + (st.baseState || st.fromSprite || "?") + "'. Touch up the frames below, or re-subtract." }));
    // Items become the in-game TRIGGER for a part (WardrobeParts, gameplay/
    // wardrobe-parts.js) — the overlay draws the moment one is equipped.
    row.appendChild(stateItemsEditor(p, st, "Worn when these items are equipped (the in-game trigger)"));
  } else if (isChar) {
    // Items feed the generation prompt in the grid below.
    row.appendChild(stateItemsEditor(p, st));
  }

  st.dirs = st.dirs || {};
  row.appendChild(dirGridEditor(p, st.dirs, { isChar, label: st.name, onchange: () => Store.save(p), setUploaded: v => { st.uploaded = v; }, getItems: () => st.items || [] }));

  const note = el("input", { placeholder: "costume description / notes", value: st.note || "", onchange: () => { st.note = note.value; Store.save(p); } });
  row.appendChild(el("label.field", { style: "margin-top:.5rem" }, [el("span", { text: "Notes" }), note]));

  const share = el("button.btn.gold.sm", { text: "🗳 Share costume for a vote", onclick: () => shareCostume(p, st) });
  const resub = st.part ? el("button.btn.sm", { text: "Re-subtract", onclick: () => openSubtractForm(p, st.parent || null, redrawAll, st) }) : null;
  const rm = el("button.btn.danger.sm", { text: "Delete state", onclick: async () => { deleteStateTree(p, st.id); await Store.save(p); redrawAll(); } });
  row.appendChild(el("div.btn-row", { style: "margin-top:.4rem" }, [share, resub, rm].filter(Boolean)));
  return row;
}

// ---------- new-state chooser: generate vs subtract ----------
function openStateChooser(p, parentId, onDone) {
  const bg = el("div.modal-bg", { onclick: e => { if (e.target === bg) bg.remove(); } });
  const parent = parentId ? stateById(p, parentId) : null;
  const canSubtract = parentId ? !!(parent && Object.keys(parent.dirs || {}).length)
    : (Object.keys(p.base || {}).length > 0 || p.states.some(s => Object.keys(s.dirs || {}).length) || (typeof Roster !== "undefined" && Roster.isGameChar(p.folder)));
  const m = el("div.card", { style: "max-width:460px;width:100%" }, [
    el("h3", { text: "New state" }),
    el("p.tagline", { text: parent ? "Add a child of “" + parent.name + "”." : "Add a top-level state." }),
    el("div.btn-row", { style: "margin-top:.6rem;flex-direction:column;gap:.5rem;align-items:stretch" }, [
      el("button.btn.primary", { text: "🎨 Generate state through PixelLab", onclick: () => { bg.remove(); openGenerateForm(p, parentId, onDone); } }),
      el("button.btn", { text: "➖ Subtract → carve a part", disabled: !canSubtract, onclick: () => { bg.remove(); openSubtractForm(p, parentId, onDone); } }),
    ]),
    el("p.tagline", { text: "Subtract one look from another → carve a part (a helm, a cloak…) that the game can put ON when its item is equipped." }),
    !canSubtract ? el("p.tagline", { text: "Subtract needs at least one state (or the base art) that already has art to diff against." }) : null,
    el("div.btn-row", { style: "margin-top:.6rem" }, [el("button.btn.ghost.sm", { text: "Cancel", onclick: () => bg.remove() })]),
  ].filter(Boolean));
  bg.appendChild(m); document.body.appendChild(bg);
}

// "Generate through PixelLab" → the normal state form; the created state shows
// its 8-direction grid (generate / upload / rotate) as before.
function openGenerateForm(p, parentId, onDone) {
  const bg = el("div.modal-bg", { onclick: e => { if (e.target === bg) bg.remove(); } });
  const nameIn = el("input", { placeholder: "state name (e.g. new_outfit, armed, cloak)" });
  const slotSel = el("select");
  ["(no slot)"].concat(EQUIP_SLOTS).forEach(s => slotSel.appendChild(el("option", { value: s === "(no slot)" ? "" : s, text: s })));
  const itemIn = el("input", { placeholder: "item worn / equipped (optional)", list: ensureItemDatalist() });
  const suggest = el("div.chips", { style: "margin:.2rem 0" });
  COMMON_STATES.forEach(s => suggest.appendChild(el("span.chip", { text: s, onclick: () => { nameIn.value = s; } })));
  const create = el("button.btn.primary", { text: "Create state", onclick: async () => {
    const name = nameIn.value.trim(); if (!name) return toast("Name the state.", "warn");
    const it = itemIn.value.trim();
    p.states.push({ id: rid(), name, slot: slotSel.value, item: it, items: it ? [it] : [], note: "", dirs: {}, parent: parentId || null });
    await Store.save(p); bg.remove(); onDone && onDone(); toast("State added — generate or upload its art.", "ok");
  } });
  const m = el("div.card", { style: "max-width:520px;width:100%" }, [
    el("h3", { text: "Generate a state through PixelLab" }),
    el("p.tagline", { text: "Name the state, then use its 8-direction grid to generate or upload the art." }),
    el("label.field", null, [el("span", { text: "State name" }), nameIn]),
    suggest,
    el("div.row", null, [el("label.field", null, [el("span", { text: "Equip slot" }), slotSel]), el("label.field", null, [el("span", { text: "Item" }), itemIn])]),
    el("div.btn-row", { style: "margin-top:.6rem" }, [create, el("button.btn.ghost.sm", { text: "Cancel", onclick: () => bg.remove() })]),
  ]);
  bg.appendChild(m); document.body.appendChild(bg);
}

// "Subtract" → carve a transparent parts-state by diffing two ALIGNED looks
// of the SAME character: operand A ("costume") keeps whatever's new in it;
// operand B ("base") is subtracted away. Both operands are picked per-
// direction from the project's own states/base art OR — when this project's
// folder matches a game character (Roster.isGameChar) — the game's own Idle
// and outfit states, which are pixel-aligned per direction (unlike a single
// game SPR sprite, which is a same-frame-for-every-direction approximation
// kept below as B's legacy fallback for characters the studio doesn't know).
function openSubtractForm(p, parentId, onDone, existing) {
  const bg = el("div.modal-bg", { onclick: e => { if (e.target === bg) bg.remove(); } });
  // Adding a child of a SPECIFIC state (the "＋" on a state row, or re-
  // subtracting a part that already has a project-state parent) locks
  // operand A to that state — the result stays that state's child in the
  // tree. Otherwise (top-level "＋ New state", or a part with no project-
  // state parent) operand A is fully pickable, and the created/edited part's
  // tree parent follows wherever A points (see the create handler below).
  const lockedStateId = parentId || (existing && existing.parent) || null;
  const aPickable = !lockedStateId;
  const lockedState = lockedStateId ? stateById(p, lockedStateId) : null;

  const aOptions = _operandOptions(p);
  const bOptions = aOptions.concat([{ value: "spr", label: "Game sprite (single frame)" }]);
  const initA = existing ? (existing.fromOp || (existing.parent ? "state:" + existing.parent : "base")) : (lockedStateId ? "state:" + lockedStateId : (aOptions[0] && aOptions[0].value) || "base");
  const initB = existing ? (existing.baseOp || "spr") : "spr";
  const initSprText = existing ? (existing.baseSpr || existing.fromSprite || "") : "";

  const nameIn = el("input", { value: existing ? existing.name : "", placeholder: "part name (e.g. helm)" });
  const slotSel = el("select");
  ["(no slot)"].concat(EQUIP_SLOTS).forEach(s => slotSel.appendChild(el("option", { value: s === "(no slot)" ? "" : s, text: s, selected: (existing ? existing.slot || "" : "") === (s === "(no slot)" ? "" : s) })));

  let aSel = null, aFixed = null;
  if (aPickable) {
    aSel = el("select");
    aOptions.forEach(o => aSel.appendChild(el("option", { value: o.value, text: o.label, selected: o.value === initA })));
  } else {
    aFixed = el("div.mono", { style: "padding:.35rem 0", text: lockedState ? lockedState.name : "?" });
  }
  const bSel = el("select");
  bOptions.forEach(o => bSel.appendChild(el("option", { value: o.value, text: o.label, selected: o.value === initB })));

  const sprIn = el("input", { value: initSprText, placeholder: "sprite_id to subtract (e.g. body_player)", list: ensureSpriteDatalist() });
  const sprField = el("label.field", null, [el("span", { text: "Sprite id to subtract" }), sprIn]);
  const sprWarn = el("p.tagline", { text: "A single sprite frame is subtracted from EVERY direction — game sprites aren't guaranteed aligned to your character, so tune the tolerance and touch up frames afterward." });
  const syncSprVisibility = () => { const show = bSel.value === "spr"; sprField.style.display = show ? "" : "none"; sprWarn.style.display = show ? "" : "none"; };

  const dirSel = el("select");
  DIRS8.forEach(d => dirSel.appendChild(el("option", { value: d, text: DIR_SHORT[d] || d, selected: d === "south" })));

  const tol = el("input", { type: "range", min: 0, max: 200, value: existing && Number.isFinite(existing.tol) ? existing.tol : 48, style: "flex:1" });
  const tolNum = el("input", { type: "number", min: 0, max: 200, value: tol.value, style: "width:4.5rem" });
  const cleanChk = el("input", { type: "checkbox", checked: existing ? existing.cleaned !== false : true });
  const previewHost = el("div", { style: "margin:.5rem 0;display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;min-height:80px" });
  const status = el("small.tagline");

  async function refreshPreview() {
    status.textContent = ""; clear(previewHost);
    const aVal = aSel ? aSel.value : ("state:" + lockedStateId);
    const bVal = bSel.value;
    const dirName = dirSel.value, di = DIRS8.indexOf(dirName);
    let sprKey = "";
    if (bVal === "spr") {
      const raw = sprIn.value.trim();
      if (!raw) { status.textContent = "Enter a sprite id to subtract."; return; }
      sprKey = resolveSpriteKey(raw);
      if (typeof SPR === "undefined" || !SPR[sprKey]) { status.textContent = "Unknown sprite id: " + raw; return; }
    }
    try {
      const r = await _diffOneDir(p, aVal, bVal, sprKey, dirName, di, Number(tol.value) || 0, cleanChk.checked);
      if (!r) { status.textContent = "No frame for " + dirName + " on one side — try another direction."; return; }
      previewHost.appendChild(_subLabelled("A · " + dirName, _subThumb(r.aImg, 72)));
      previewHost.appendChild(el("div", { style: "font-size:1.3rem" }, ["➖"]));
      previewHost.appendChild(_subLabelled("B · " + dirName, _subThumb(r.bDraw, 72)));
      previewHost.appendChild(el("div", { style: "font-size:1.3rem" }, ["="]));
      previewHost.appendChild(_subLabelled("part", _subThumb(r.url, 72)));
    } catch (e) { status.textContent = (e && e.message) || "Preview failed."; }
  }
  let dt; const deb = () => { clearTimeout(dt); dt = setTimeout(refreshPreview, 200); };
  if (aSel) aSel.onchange = deb;
  bSel.onchange = () => { syncSprVisibility(); deb(); };
  sprIn.oninput = deb;
  dirSel.onchange = deb;
  tol.oninput = () => { tolNum.value = tol.value; deb(); };
  tolNum.onchange = () => { tol.value = tolNum.value; deb(); };
  cleanChk.onchange = deb;
  syncSprVisibility();

  const create = el("button.btn.primary", { text: existing ? "Re-subtract" : "Create part", onclick: async () => {
    const aVal = aSel ? aSel.value : ("state:" + lockedStateId);
    const bVal = bSel.value;
    const rawSpr = sprIn.value.trim();
    const sprKey = bVal === "spr" ? resolveSpriteKey(rawSpr) : "";
    if (bVal === "spr" && (!rawSpr || typeof SPR === "undefined" || !SPR[sprKey])) return toast("Enter a valid sprite id.", "warn");
    create.disabled = true; status.textContent = "Subtracting…";
    try {
      const t = Number(tol.value) || 0, clean = cleanChk.checked;
      const dirs = await _buildDirs(p, aVal, bVal, sprKey, t, clean);
      if (!Object.keys(dirs).length) { status.textContent = "No overlapping directions between the two — nothing to carve."; create.disabled = false; return; }
      const fromLabel = _operandLabel(p, aVal, rawSpr);
      const baseLabel = _operandLabel(p, bVal, rawSpr);
      const treeParent = aVal.startsWith("state:") ? aVal.slice(6) : null;
      if (existing) {
        existing.dirs = dirs; existing.fromState = fromLabel; existing.baseState = baseLabel;
        existing.fromOp = aVal; existing.baseOp = bVal; existing.baseSpr = bVal === "spr" ? rawSpr : "";
        existing.tol = t; existing.cleaned = clean;
        existing.name = nameIn.value.trim() || existing.name;
        existing.slot = slotSel.value;
      } else {
        p.states.push({
          id: rid(), name: nameIn.value.trim() || (fromLabel + " part"), slot: slotSel.value, items: [], note: "",
          part: true, fromState: fromLabel, baseState: baseLabel, fromOp: aVal, baseOp: bVal,
          baseSpr: bVal === "spr" ? rawSpr : "", tol: t, cleaned: clean, dirs, parent: treeParent,
        });
      }
      await Store.save(p); bg.remove(); onDone && onDone(); toast("Part carved.", "ok");
    } catch (e) { status.textContent = (e && e.message) || "Subtract failed."; create.disabled = false; }
  } });

  const m = el("div.card", { style: "max-width:640px;width:100%" }, [
    el("h3", { text: existing ? "Re-subtract part" : "Subtract → carve a part" }),
    el("p.tagline", { text: "Keeps the pixels that are NEW in the costume (A) versus the base (B) — transparent where the two agree. Both sides are drawn from the SAME character, aligned per direction, so the diff lines up far better than a single game sprite ever could." }),
    el("label.field", null, [el("span", { text: "Part name" }), nameIn]),
    el("label.field", null, [el("span", { text: "Equip slot" }), slotSel]),
    el("label.field", null, [el("span", { text: "Costume — keep what's new in…" }), aPickable ? aSel : aFixed]),
    el("label.field", null, [el("span", { text: "Base — subtract away…" }), bSel]),
    sprField, sprWarn,
    el("label.field", null, [el("span", { text: "Match tolerance" }), el("div.row", { style: "align-items:center;gap:.5rem" }, [tol, tolNum])]),
    el("label.field", { style: "flex-direction:row;align-items:center;gap:.5rem;cursor:pointer" }, [cleanChk, el("span", { text: "Clean up speckles" })]),
    el("label.field", null, [el("span", { text: "Preview direction" }), dirSel]),
    previewHost, status,
    el("div.btn-row", { style: "margin-top:.6rem" }, [create, el("button.btn.ghost.sm", { text: "Cancel", onclick: () => bg.remove() })]),
  ]);
  bg.appendChild(m); document.body.appendChild(bg);
  refreshPreview();
}

// ---------- subtract helpers ----------
// A game "sprite_id" is an SPR key; forgive an item id by falling back to its icon.
function resolveSpriteKey(input) {
  if (typeof SPR === "undefined") return input;
  if (SPR[input]) return input;
  if (typeof ITEMS !== "undefined" && ITEMS[input] && ITEMS[input].icon && SPR[ITEMS[input].icon]) return ITEMS[input].icon;
  return input;
}
function ensureSpriteDatalist() {
  const ID = "studio-sprite-ids";
  if (document.getElementById(ID)) return ID;
  const dl = el("datalist", { id: ID });
  if (typeof SPR !== "undefined") for (const k of Object.keys(SPR)) dl.appendChild(el("option", { value: k }));
  document.body.appendChild(dl);
  return ID;
}
// Resolve once the sprite's sheet has decoded (SprRender fires studio-sheet:<sheet>).
function ensureSheetLoaded(spriteKey) {
  if (typeof SPR === "undefined" || !SPR[spriteKey]) return Promise.reject(new Error("Unknown sprite id: " + spriteKey));
  const sheet = SPR[spriteKey][0];
  const img = SprRender.sheetImg(sheet, "high");
  if (!img) return Promise.reject(new Error("No art available for sprite: " + spriteKey));
  if (img.complete && img.naturalWidth) return Promise.resolve();
  return new Promise(res => { const done = () => res(); document.addEventListener("studio-sheet:" + sheet, done, { once: true }); setTimeout(done, 4000); });
}
// Render a game sprite into a WxH canvas (square-rendered, centre-contained).
// The SAME frame is used for every direction — this is the un-aligned legacy
// path, kept for characters the studio doesn't have game-state art for.
async function renderSpriteToCanvas(spriteKey, W, H) {
  await ensureSheetLoaded(spriteKey);
  const S = Math.max(W, H);
  const sq = document.createElement("canvas"); sq.width = S; sq.height = S;
  SprRender.drawKeys(sq, [spriteKey], S);
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const ctx = out.getContext("2d"); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sq, (W - S) / 2, (H - S) / 2);
  return out;
}

// ---- operand pickers: every project state with art, "Base art", and — for a
// project whose folder matches a real game character — that character's own
// Idle + outfit states (pixel-aligned per direction, unlike a lone SPR sprite).
function _operandOptions(p) {
  const opts = [{ value: "base", label: "Base art" }];
  for (const st of p.states) if (Object.keys(st.dirs || {}).length) opts.push({ value: "state:" + st.id, label: st.name });
  if (typeof Roster !== "undefined" && Roster.isGameChar(p.folder)) {
    opts.push({ value: "game:Idle", label: "Game: Idle" });
    for (const s of Roster.statesOf(p.folder)) opts.push({ value: "game:" + s, label: "Game: " + s });
  }
  return opts;
}
// Human label for an operand value — stored on the created part as
// fromState/baseState so the tree, the badge and the published bundle can
// show WHAT was diffed without needing the raw operand code.
function _operandLabel(p, val, sprRaw) {
  if (val === "base") return "Base art";
  if (val === "spr") return "Game sprite: " + (sprRaw || "?");
  if (val.startsWith("game:")) return "Game: " + val.slice(5);
  if (val.startsWith("state:")) { const st = stateById(p, val.slice(6)); return st ? st.name : "?"; }
  return "?";
}
// The raw {dir: dataURL} map behind a project-state/base-art operand (null
// for "game:"/"spr" — those fetch per direction instead, see _fetchOperand).
function _operandDirsObject(p, val) {
  if (val === "base") return p.base || {};
  if (val.startsWith("state:")) { const st = stateById(p, val.slice(6)); return (st && st.dirs) || {}; }
  return null;
}
// Which direction keys operand A actually has art for — drives which
// directions the batch subtract (create/re-subtract) produces. Falls back to
// a single "image" cell for object projects that only have one frame.
function _aDirKeys(p, aVal) {
  const dirsObj = _operandDirsObject(p, aVal);
  if (!dirsObj) return DIRS8.slice(); // "game:" — the game's own states are always full 8-dir
  const keys = DIRS8.filter(d => dirsObj[d]);
  if (!keys.length && dirsObj.image) keys.push("image");
  return keys;
}
// Fetch one operand's frame for one direction, at its OWN native size — an
// Image (project state / base art), a canvas (a game state, via Roster.
// stateFrameAsync), or null if that side has no frame there. "spr" isn't
// handled here — it needs the OTHER side's size first (see _diffOneDir).
async function _fetchOperand(p, val, dirName, dirIndex) {
  if (val === "base") return await loadImg(p.base && p.base[dirName]);
  if (val.startsWith("state:")) { const st = stateById(p, val.slice(6)); return await loadImg(st && st.dirs && st.dirs[dirName]); }
  if (val.startsWith("game:")) return (typeof Roster !== "undefined") ? await Roster.stateFrameAsync(Roster.charEntry(p.folder), val.slice(5), dirIndex) : null;
  return null;
}
// Fetch both sides for one direction, normalize B to A's dimensions (game
// cells are 96px while generated art is often 64), and diff. Returns
// {url, aImg, bDraw, W, H} for the preview, or null if either side is
// missing this direction (the caller skips it).
async function _diffOneDir(p, aVal, bVal, sprKey, dirName, dirIndex, tol, clean) {
  const aImg = await _fetchOperand(p, aVal, dirName, dirIndex);
  if (!aImg) return null;
  const W = aImg.naturalWidth || aImg.width || 0, H = aImg.naturalHeight || aImg.height || 0;
  if (!W || !H) return null;
  const bDraw = (bVal === "spr") ? await renderSpriteToCanvas(sprKey, W, H) : await _fetchOperand(p, bVal, dirName, dirIndex);
  if (!bDraw) return null;
  return { url: diffFrame(aImg, bDraw, W, H, tol, clean), aImg, bDraw, W, H };
}
// Batch version of _diffOneDir across every direction operand A has art for.
async function _buildDirs(p, aVal, bVal, sprKey, tol, clean) {
  const out = {};
  for (const d of _aDirKeys(p, aVal)) {
    const di = DIRS8.indexOf(d);
    const r = await _diffOneDir(p, aVal, bVal, sprKey, d, di < 0 ? 0 : di, tol, clean);
    if (r) out[d] = r.url;
  }
  return out;
}
// Keep A's pixels that DIFFER from B (Chebyshev RGB distance > tol); blank
// the pixels that match. Both drawables are re-rendered into fresh W×H
// canvases first (B may be a different native size — this is also where B
// gets scaled to match, smoothing off so the carve stays crisp). Optionally
// runs one despeckle pass after. Returns a PNG data URL.
function diffFrame(aDrawable, bDrawable, W, H, tol, clean) {
  const ac = document.createElement("canvas"); ac.width = W; ac.height = H;
  const actx = ac.getContext("2d"); actx.imageSmoothingEnabled = false; actx.drawImage(aDrawable, 0, 0, W, H);
  const bc = document.createElement("canvas"); bc.width = W; bc.height = H;
  const bctx = bc.getContext("2d"); bctx.imageSmoothingEnabled = false; bctx.drawImage(bDrawable, 0, 0, W, H);
  const ad = actx.getImageData(0, 0, W, H), bd = bctx.getImageData(0, 0, W, H);
  const A = ad.data, B = bd.data;
  for (let i = 0; i < A.length; i += 4) {
    if (A[i + 3] < 16) { A[i + 3] = 0; continue; }          // A transparent → stays transparent
    if (B[i + 3] > 16) {                                     // B covers this pixel
      const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
      if (d <= tol) { A[i] = A[i + 1] = A[i + 2] = A[i + 3] = 0; }   // matches → subtract away
    }
  }
  actx.putImageData(ad, 0, 0);
  if (clean) despeckle(actx, W, H);
  return ac.toDataURL("image/png");
}
// "Clean up speckles": the diff often leaves a handful of stray opaque pixels
// where the two (rarely pixel-perfect) source frames' anti-aliased edges
// didn't quite line up. One pass: clear any opaque pixel (alpha>16) with
// fewer than 2 opaque neighbours in its 8-neighbourhood.
function despeckle(ctx, W, H) {
  const id = ctx.getImageData(0, 0, W, H), d = id.data;
  const opaque = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 16) opaque[y * W + x] = 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!opaque[y * W + x]) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && opaque[yy * W + xx]) n++;
    }
    if (n < 2) d[(y * W + x) * 4 + 3] = 0;
  }
  ctx.putImageData(id, 0, 0);
}
function _subLabelled(text, node) {
  return el("div", { style: "text-align:center" }, [node, el("div", { style: "font-size:.62rem;color:var(--ink-dim);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text: text })]);
}
// Thumbnail from whatever a preview step has on hand: a data-URL string (the
// diffed result), or an already-decoded Image/canvas (either operand side).
function _subThumb(source, size) {
  const cv = el("canvas", { width: size, height: size, style: "image-rendering:pixelated;background:#00000018;border-radius:6px;width:" + size + "px;height:" + size + "px" });
  if (typeof source === "string") { drawSprite(cv, source, size); return cv; }
  const w = source && (source.naturalWidth || source.width), h = source && (source.naturalHeight || source.height);
  if (source && w && h) {
    const ctx = cv.getContext("2d"); ctx.imageSmoothingEnabled = false;
    const s = Math.min(size / w, size / h);
    ctx.drawImage(source, (size - w * s) / 2, (size - h * s) / 2, w * s, h * s);
  }
  return cv;
}

// ---------- animations ----------
function animsCard(p, isChar) {
  const c = el("div.card");
  c.appendChild(el("div.sectitle", null, [el("h3", null, ["Animations ", el("span.hint", { text: "text → frames" })]), el("span.badge", { text: (p.anims || []).length + "" })]));

  const list = el("div");
  function redraw() {
    clear(list);
    (p.anims || []).forEach((an, i) => list.appendChild(animRow(p, an, i, redraw)));
    if (!(p.anims || []).length) list.appendChild(el("div.empty", { html: "<div class='big'>🎞️</div>No animations yet." }));
  }

  // source frame picker: base south, or any state's south/first
  const srcSel = el("select");
  const sources = [];
  const baseSrc = p.base && (p.base.south || p.base.image || firstVal(p.base));
  if (baseSrc) { sources.push({ label: "Base (south)", src: baseSrc }); }
  (p.states || []).forEach(st => { const s = st.dirs && (st.dirs.south || firstVal(st.dirs)); if (s) sources.push({ label: st.name, src: s }); });
  sources.forEach((s, i) => srcSel.appendChild(el("option", { value: i, text: s.label })));
  const action = el("input", { placeholder: "action (e.g. walking, attacking, casting)" });
  const frames = el("select");
  [4, 6, 8, 10, 12, 16].forEach(n => frames.appendChild(el("option", { value: n, text: n + " frames", selected: n === 8 })));
  const go = el("button.btn.primary.sm", { text: "Generate animation", onclick: async () => {
    if (!PixelLab.hasKey()) return toast("Add your PixelLab key in Settings.", "warn");
    if (!sources.length) return toast("Generate or upload some base art first.", "warn");
    if (!action.value.trim()) return toast("Name the action.", "warn");
    go.disabled = true; toast("Animating…");
    try {
      const src = sources[Number(srcSel.value)].src;
      const first = { type: "base64", base64: dataUrlToB64(src), format: "png" };
      const fr = await PixelLab.animate(first, action.value.trim(), Number(frames.value));
      (p.anims || (p.anims = [])).push({ id: rid(), action: action.value.trim(), frames: fr });
      await Store.save(p); action.value = ""; redraw(); toast("Animation ready.", "ok");
    } catch (e) { toast(e.message, "err", 6000); }
    go.disabled = false;
  } });

  const adder = el("div.card", { style: "background:var(--bg-2);margin-top:.6rem" }, [
    el("h3", { style: "font-size:.92rem", text: "New animation" }),
    el("div.row", null, [
      el("label.field", null, [el("span", { text: "Source frame" }), srcSel]),
      el("label.field", null, [el("span", { text: "Frames" }), frames]),
    ]),
    el("label.field", null, [el("span", { text: "Action" }), action]),
    go,
  ]);

  redraw();
  c.appendChild(list);
  c.appendChild(adder);
  return c;
}

function animRow(p, an, i, redrawAll) {
  const row = el("div.card", { style: "background:var(--bg-2);margin-bottom:.6rem" });
  const cv = el("canvas.spr", { width: 96, height: 96, style: "width:96px" });
  let f = 0;
  const play = () => { if (!an.frames || !an.frames.length) return; drawSprite(cv, an.frames[f % an.frames.length], 96); f++; };
  play();
  const timer = setInterval(play, 140);
  cv.dataset.timer = timer;
  row.appendChild(el("div.sectitle", null, [
    el("h3", { style: "font-size:.95rem", text: an.action }),
    el("span.badge", { text: (an.frames || []).length + " frames" }),
  ]));
  // attach this animation to a state (so it publishes with that costume)
  const attach = el("select");
  attach.appendChild(el("option", { value: "", text: "— attach to a state —", selected: !an.state }));
  (p.states || []).forEach(st => attach.appendChild(el("option", { value: st.id, text: st.name, selected: an.state === st.id })));
  attach.onchange = () => { an.state = attach.value || null; Store.save(p); toast(an.state ? "Attached to state." : "Detached.", "ok"); };
  row.appendChild(el("div.btn-row", null, [
    el("div", { style: "flex:0 0 auto" }, [cv]),
    el("label.field", { style: "flex:1;margin:0" }, [el("span", { text: "Attached state" }), attach]),
    el("button.btn.danger.sm", { text: "Delete", onclick: async () => { clearInterval(timer); p.anims.splice(i, 1); await Store.save(p); redrawAll(); } }),
  ]));
  return row;
}

// ---------- download the whole project as a JSON bundle ----------
function downloadProject(p) {
  const bundle = { schema: "pixellab-studio-project/1", exportedAt: new Date().toISOString(), project: p };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: "studio-" + p.folder + ".json" });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast("Downloaded. Art lives inside as data URLs — drop the PNGs into " + GAME_ART_PATH.replace("<folder>", p.folder) + " for a PR.", "ok", 6000);
}

// ---------- publish the whole generation to the community ----------
async function publishProject(p) {
  if (!Taiao.logged()) { toast("Sign in (Settings) to publish to the community.", "warn"); App.go("#/settings"); return; }
  const dirs = p.base || {};
  if (!Object.keys(dirs).length) return toast("Generate or upload the base art first.", "warn");
  if (!confirm(
    "Publish \"" + p.name + "\" to the communal workshop?\n\n" +
    "You licence the art under CC BY-SA 4.0, credited to you forever. PixelLab-generated art goes live in the game right away; hand-uploaded art is checked by a curator first.")) return;
  const bundle = {
    schema: "taiao-costume/1",
    object: { type: p.kind, key: p.folder, name: p.name },
    field: "full",
    costume: { state: "full", slot: "", item: "", note: p.bio || "", dirs },
    design: p.kind === "object" ? { notes: p.bio, triggers: p.trig } : { bio: p.bio, spawn: p.spawn, triggers: p.trig, eventTriggers: p.eventTriggers, stateTriggers: p.stateTriggers },
    anims: p.anims || [],
    gen: p.gen || {},
    exportedAt: new Date().toISOString(),
  };
  // Provenance drives the moderation gate: uploaded base art waits for a
  // curator; a pure PixelLab generation is voteable at once.
  const source = p.baseUploaded ? "upload" : "pixellab";
  // Uploaded art gets the honest-disclosure question right before it leaves
  // the browser; a pure PixelLab generation already knows its own provenance.
  let provenance;
  if (source === "upload") {
    provenance = await askProvenance("art");
    if (!provenance) return;   // Cancel aborts the publish
  }
  toast("Publishing…");
  const r = await Taiao.submitProposal(p.kind, p.folder, p.name, bundle, source, provenance);
  if (r.ok) {
    toast(r.status === "accepted"
      ? "⚡ Straight into the game — it's now live for everyone, credited to you."
      : r.status === "pending"
      ? "Submitted — a moderator will review your uploaded art before it appears for voting."
      : "Published! Everyone can see it now.", "ok", 6000);
    App.go("#/detail?type=" + p.kind + "&key=" + encodeURIComponent(p.folder));
  } else toast(r.error || "Couldn't publish.", "err", 6000);
}

// ---------- share a costume/state to the workshop ----------
async function shareCostume(p, st) {
  if (!Taiao.logged()) { toast("Sign in (Settings) to share a costume for voting.", "warn"); App.go("#/settings"); return; }
  const hasArt = st.dirs && Object.keys(st.dirs).length;
  if (!hasArt) return toast("Give this costume some art first (generate, rotate, or upload).", "warn");
  // The voting "slot" this costume competes in: its equip slot if set,
  // otherwise its state name. Alternatives sharing a slot are voted head-to-head.
  const field = st.slot ? ("item:" + slug(st.slot) + (st.item ? ":" + slug(st.item) : "")) : ("state:" + slug(st.name));
  // A part with no trigger item can never activate in-game (WardrobeParts
  // has nothing to match against) — warn, but don't block the share; the
  // maker (or a later editor) can add items and re-share.
  const noTrigger = st.part && !(st.items || []).filter(Boolean).length;
  if (!confirm(
    "Share \"" + st.name + "\" for " + p.name + " to the community workshop?\n\n" +
    "By submitting you licence the art under CC BY-SA 4.0, credited to you forever. PixelLab-generated art goes live in the game right away; hand-uploaded art is checked by a curator first." +
    (noTrigger ? "\n\nThis part has no trigger items set — it won't activate in-game until you add at least one." : "")
  )) return;
  const costume = { state: st.name, slot: st.slot || "", item: st.item || "", items: (st.items || []).filter(Boolean), note: st.note || "", dirs: st.dirs };
  if (st.part) { costume.part = true; costume.fromState = st.fromState || ""; costume.baseState = st.baseState || ""; }
  const bundle = {
    schema: "taiao-costume/1",
    object: { type: p.kind, key: p.folder, name: p.name },
    field,
    costume,
    design: p.kind === "object" ? { notes: p.bio, triggers: p.trig } : { bio: p.bio, spawn: p.spawn, triggers: p.trig, eventTriggers: p.eventTriggers, stateTriggers: p.stateTriggers },
    anims: (p.anims || []).filter(a => a.state === st.id || a.state === st.name),
    gen: p.gen || {},
    exportedAt: new Date().toISOString(),
  };
  // Provenance drives the moderation gate (same rule as publishProject
  // above): uploaded art waits for a curator, a pure PixelLab generation is
  // voteable at once. A part carved purely from two GAME states used neither
  // — it's existing in-game art recombined, so it lands as "data" (like a
  // recipe/quest proposal) rather than claiming new art was made.
  const bothGameStates = st.part && typeof st.fromOp === "string" && st.fromOp.startsWith("game:") &&
    typeof st.baseOp === "string" && st.baseOp.startsWith("game:");
  const source = bothGameStates ? "data" : (st.uploaded ? "upload" : "pixellab");
  let provenance;
  if (source === "upload") {
    provenance = await askProvenance("art");
    if (!provenance) return;   // Cancel aborts the share
  }
  toast("Sharing costume…");
  const r = await Taiao.submitCostume(p.kind, p.folder, p.name + " — " + st.name, bundle, source, provenance);
  if (r.ok) {
    toast(r.status === "accepted"
      ? "⚡ Straight into the game — it's now live for everyone, credited to you."
      : r.status === "pending"
      ? "Submitted — a moderator will review your uploaded art before it appears for voting."
      : "Shared! Find it in the character/asset page for voting.", "ok", 6000);
    App.go("#/detail?type=" + p.kind + "&key=" + encodeURIComponent(p.folder));
  } else toast(r.error || "Couldn't share (are you signed in?).", "err", 6000);
}
