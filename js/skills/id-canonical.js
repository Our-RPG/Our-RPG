// ===== Taiao — canonical item ids ==========================================
// Many items are built with machine ids (forage_12, bar_14, seed_fibriculture_12,
// crop7, gem_3, hide_25, yarn_crop9, cloth_2, …). This one-time pass — run AFTER
// every item / recipe / node / crop / drop table is built, and BEFORE gameplay
// or the studio's providers read them — renames each to a category-prefixed,
// name-based id (bar_mithril, forage_sloes, seed_flax, crop_potato, gem_garnet,
// hide_rabbit, yarn_linen, …), then rewrites EVERY structured reference so
// nothing dangles.
//
// Safety net: the old id is kept on ITEMS as a NON-ENUMERABLE alias pointing at
// the same object, so any stray runtime lookup (quest scripts, odd literals,
// un-migrated saves) still resolves, while Object.keys(ITEMS) — used in-game and
// by the studio catalog — sees only the new ids. `window.ITEM_ALIAS = {old:new}`
// drives save migration in storage.js.
//
// Deterministic (sorted iteration, no randomness) so the game bundle and the
// studio compute identical ids.
"use strict";

(function () {
  if (typeof ITEMS === "undefined" || !ITEMS) return;
  if (typeof window !== "undefined" && window.ITEM_ALIAS) return;   // run once (idempotent)

  const slug = s => String(s || "").trim().toLowerCase().replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "");

  // ---- which ids are "generic" (machine-named) -----------------------------
  // Anything whose distinguishing part is a bare number: <type>_<n>, <type>_m<n>
  // (metal tier), <type>_f<n> (raw fish), cropN, yarn_cropN, culture crop tails…
  const GENERIC = [
    /_(?:m|f)?\d+$/,           // herb_1, potion_2, axe_m7, raw_f1, body_leather_0, seed_cereal…_0
    /^[a-z]+\d+$/,             // crop7
    /crop\d+$/,                // yarn_crop5
    /_crop_\d+$/,              // fibriculture_crop_12
  ];
  const isGeneric = id => GENERIC.some(re => re.test(id));

  // Prefix (kept) + how to derive the suffix from the NAME.
  //   "material" → first word of the name (Cobalt Axe → cobalt; Rabbit leather → rabbit)
  //   "drop"     → whole name minus category/quality nouns and prefix words
  function analyze(id) {
    if (/_m\d+$/.test(id)) return { prefix: id.replace(/_m\d+$/, ""), mode: "material" };
    if (/_leather_\d+$/.test(id)) return { prefix: id.replace(/_\d+$/, ""), mode: "material" };
    if (/_f\d+$/.test(id)) return { prefix: id.replace(/_f\d+$/, ""), mode: "drop" };
    if (/^crop\d+$/.test(id) || /^[a-z]+_crop_\d+$/.test(id)) return { prefix: "crop", mode: "drop" };
    if (/^seed_/.test(id)) return { prefix: "seed", mode: "drop" };
    if (/^cloth_yarn_/.test(id)) return { prefix: "cloth", mode: "drop" };
    if (/crop\d+$/.test(id) && /^yarn_/.test(id)) return { prefix: "yarn", mode: "drop" };
    if (/^yarn_/.test(id)) return { prefix: "yarn", mode: "drop" };
    return { prefix: id.replace(/_?\d+$/, ""), mode: "drop" };
  }

  // Category/quality nouns dropped from a name in "drop" mode (plus the prefix's
  // own words), so the suffix keeps only the distinguishing part.
  const STOP = new Set(("rough raw log logs ore ores bar bars ingot rune runes gem gems " +
    "pelt pelts fur furs skin skins hide hides leather leathers seed seeds crop crops " +
    "yarn yarns thread threads twine twines cloth cloths weave fabric flour malt malts " +
    "potion potions herb herbs grain grains fish sapling fibre fibres fiber arrow arrows").split(" "));

  function suffixFrom(name, prefix, mode) {
    const all = slug(name).split("_").filter(Boolean);
    if (mode === "material") return all[0] || "item";
    const prefixToks = new Set(prefix.split("_"));
    let toks = all.filter(t => !STOP.has(t) && !prefixToks.has(t));
    if (!toks.length) toks = all.filter(t => !prefixToks.has(t)); // keep quality words (e.g. "Rough bow" → rough)
    if (!toks.length) toks = all;                                 // never produce an empty suffix
    return toks.join("_") || "item";
  }

  // Legacy 2-letter item-id prefixes to strip. Excluded on purpose:
  //   • ga_/fo_/ic_/at_… are SPR icon atlas keys, NOT item ids.
  //   • nz_ is a shared namespace with OBJ_MAP object/decor keys (world-gen
  //     scatters nz_koru etc. and decor-pickup hands back the same-id item);
  //     renaming only the item side would decouple it from its world object.
  const STRIP_PREFIX = /^(?:wc|lp)_/;

  // The canonical id for an original id: first fix a machine-number suffix, then
  // drop a legacy 2-letter prefix. Either step may be a no-op.
  function canonical(id, name) {
    let out = id;
    if (isGeneric(id) && name) { const a = analyze(id); out = a.prefix + "_" + suffixFrom(name, a.prefix, a.mode); }
    out = out.replace(STRIP_PREFIX, "");
    return out || id;
  }

  // ---- build the rename map, collision-safe & deterministic -----------------
  const all = Object.keys(ITEMS).sort();
  const raw = {};                              // old -> desired (pre-dedup)
  for (const id of all) { const c = canonical(id, ITEMS[id] && ITEMS[id].name); if (c !== id) raw[id] = c; }
  const taken = new Set(all.filter(id => !(id in raw)));   // ids that keep their name
  const REN = {};                              // old -> final (deduped)
  for (const old of Object.keys(raw).sort()) {
    let cand = raw[old];
    if (taken.has(cand)) {
      // a pure prefix-strip that collides with a DISTINCT existing item (e.g. the
      // Limeburning variant lp_grout vs the base masonry `grout`) — keep the
      // prefixed id rather than mint an ugly `grout_2` or wrongly merge them.
      if (!isGeneric(old)) continue;
      let n = 2; const base = cand;
      while (taken.has(cand)) cand = base + "_" + (n++);
    }
    taken.add(cand);
    REN[old] = cand;
  }
  const renamedOld = Object.keys(REN);
  if (!renamedOld.length) { window.ITEM_ALIAS = {}; return; }
  const map = id => (REN[id] || id);

  // ---- 1) rename the ITEMS registry ----------------------------------------
  // new key (enumerable) → same object; old key kept NON-ENUMERABLE as an alias.
  for (const old of renamedOld) {
    const obj = ITEMS[old];
    delete ITEMS[old];
    ITEMS[REN[old]] = obj;
  }
  for (const old of renamedOld) {
    try { Object.defineProperty(ITEMS, old, { value: ITEMS[REN[old]], enumerable: false, writable: true, configurable: true }); } catch (_) {}
  }

  // ---- 2) EXAMINE keys ------------------------------------------------------
  if (typeof EXAMINE !== "undefined" && EXAMINE) {
    for (const old of renamedOld) if (old in EXAMINE) { EXAMINE[REN[old]] = EXAMINE[old]; delete EXAMINE[old]; }
  }

  // ---- 3) RECIPES: in (rekey), out, outputs[].id, byproducts[].id, burnt ----
  if (typeof RECIPES !== "undefined" && RECIPES) {
    for (const cat in RECIPES) {
      const list = RECIPES[cat]; if (!Array.isArray(list)) continue;
      for (const r of list) {
        if (!r) continue;
        if (r.in && typeof r.in === "object") {
          const ni = {}; for (const k in r.in) ni[map(k)] = r.in[k]; r.in = ni;
        }
        if (r.out && REN[r.out]) r.out = REN[r.out];
        if (r.burnt && REN[r.burnt]) r.burnt = REN[r.burnt];
        if (Array.isArray(r.outputs)) r.outputs.forEach(o => { if (o && REN[o.id]) o.id = REN[o.id]; });
        if (Array.isArray(r.byproducts)) r.byproducts.forEach(o => { if (o && REN[o.id]) o.id = REN[o.id]; });
      }
    }
  }

  // ---- 4) NODE_TYPES.item ---------------------------------------------------
  if (typeof NODE_TYPES !== "undefined" && NODE_TYPES) {
    for (const k in NODE_TYPES) { const n = NODE_TYPES[k]; if (n && n.item && REN[n.item]) n.item = REN[n.item]; }
  }

  // ---- 5) CROPS.seed / .item ------------------------------------------------
  if (typeof CROPS !== "undefined" && CROPS) {
    for (const k in CROPS) { const c = CROPS[k]; if (!c) continue; if (c.seed && REN[c.seed]) c.seed = REN[c.seed]; if (c.item && REN[c.item]) c.item = REN[c.item]; }
  }

  // ---- 6) MONSTERS: drops[].id, butcher.hideItem ----------------------------
  if (typeof MONSTERS !== "undefined" && MONSTERS) {
    for (const mk in MONSTERS) {
      const m = MONSTERS[mk]; if (!m) continue;
      if (Array.isArray(m.drops)) m.drops.forEach(d => { if (d && REN[d.id]) d.id = REN[d.id]; });
      if (m.butcher && m.butcher.hideItem && REN[m.butcher.hideItem]) m.butcher.hideItem = REN[m.butcher.hideItem];
    }
  }

  // ---- 7) SHOP_STOCK (array of ids) ----------------------------------------
  if (typeof SHOP_STOCK !== "undefined" && Array.isArray(SHOP_STOCK)) {
    for (let i = 0; i < SHOP_STOCK.length; i++) if (REN[SHOP_STOCK[i]]) SHOP_STOCK[i] = REN[SHOP_STOCK[i]];
  }

  // ---- 8) *_IDS arrays / sets of item ids (GEM_TIER_IDS, REAGENT_IDS, …) ----
  const remapArr = a => { for (let i = 0; i < a.length; i++) if (REN[a[i]]) a[i] = REN[a[i]]; };
  const remapSet = s => { const add = []; for (const v of s) if (REN[v]) { s.delete(v); add.push(REN[v]); } add.forEach(v => s.add(v)); };
  for (const key of Object.keys(window)) {
    if (!/_IDS$/.test(key)) continue;
    const v = window[key];
    if (Array.isArray(v)) remapArr(v);
    else if (v instanceof Set) remapSet(v);
  }

  // ---- publish the alias map for save migration (storage.js) ---------------
  window.ITEM_ALIAS = REN;
})();
