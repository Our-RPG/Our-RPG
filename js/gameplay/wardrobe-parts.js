// ===== Taiao — wardrobe parts (equip-triggered part overlays) =====
// A "part" is a carved-out costume difference from the Taiao Workshop studio
// (aligned sprite subtraction, Phase 3) — a helm, a cloak, a pauldron — that
// ships with an equip-item TRIGGER instead of replacing a character's base
// art. Parts arrive one at a time through the Phase 2 community/preview
// overlay (js/main/proposal-overlay.js applyPart, which calls register()
// below) as proposals are accepted or previewed; there is no unregister — a
// stale part (its trigger item later removed from the game) just never
// matches activeRules() again.
//
// At render time (render3d.js), whenever the player's playable character
// matches a part's folder AND has one of its trigger items equipped, the
// part's art draws as a transparent overlay on the character billboard —
// the same "second billboard" slot armour-overlay.js already owns; the two
// are merged there (_playerOverlayCanvas()) rather than given a mesh each.
"use strict";

const WardrobeParts = (() => {
  const CELL = 96, COLS = 8;
  const rules = []; // {folder, items:[itemIds], slot, dirs:{dirName:dataURL}, imgs:{dirName:HTMLImage|null}, maker}
  let version = 0;  // bumped whenever a registered image finishes loading

  // register(rule): rule = {folder, items, slot, dirs, maker}. Kicks off one
  // async image load per direction; each landed (or failed) image bumps
  // `version` so playerCanvas()'s sig changes and the overlay canvas rebuilds
  // the next time it's actually asked for.
  function register(rule) {
    if (!rule || !rule.folder || !rule.dirs || !Object.keys(rule.dirs).length) return;
    const imgs = {};
    rules.push({
      folder: rule.folder,
      items: Array.isArray(rule.items) ? rule.items : [],
      slot: rule.slot || "",
      dirs: rule.dirs,
      imgs,
      maker: rule.maker || "",
    });
    for (const dirName in rule.dirs) {
      const url = rule.dirs[dirName];
      if (!url) continue;
      const img = new Image();
      img.onload = () => { imgs[dirName] = img; version++; };
      img.onerror = () => { imgs[dirName] = null; };
      img.src = url;
    }
  }

  // Equipped item-id set, built exactly like ArmourOverlay.equipSet() (fresh
  // scan every call — this needs to track live equip changes, not just at
  // register time): quiver/rune slots hold {id,qty} instead of a bare id.
  function equipSet() {
    const out = new Set();
    if (typeof player === "undefined" || !player.equip) return out;
    for (const slot in player.equip) {
      const v = player.equip[slot];
      if (!v) continue;
      out.add(typeof v === "object" ? v.id : v);
    }
    return out;
  }

  // Rules currently "on" the player: same folder as the playable character,
  // at least one of the rule's trigger items in the equipped set.
  function activeRules() {
    if (typeof CHAR_LIST === "undefined" || typeof player === "undefined" || player.character == null) return [];
    const folder = CHAR_LIST[player.character] && CHAR_LIST[player.character].folder;
    if (!folder || !rules.length) return [];
    const eq = equipSet();
    if (!eq.size) return [];
    return rules.filter(r => r.folder === folder && r.items.some(id => eq.has(id)));
  }

  let cache = { sig: null, out: null };
  // Per-frame, must be cheap: activeRules() is a cheap filter, and the sig
  // check below skips the actual canvas rebuild unless something changed
  // (an image landed, or the active set itself changed).
  function playerCanvas() {
    const active = activeRules();
    if (!active.length) { cache = { sig: "none", out: null }; return null; }
    const folder = CHAR_LIST[player.character].folder;
    const sig = folder + "|" + version + "|" + active.map(r => rules.indexOf(r)).join(",");
    if (cache.sig === sig) return cache.out;
    const cv = document.createElement("canvas");
    cv.width = COLS * CELL; cv.height = CELL;
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    // SAME direction->cell layout as ArmourOverlay.playerCanvas(): cell di
    // holds CHAR_DIRS[di], drawn left to right — the mesh's setSheetUV picks
    // cells with the same `di` it uses for the body, so this must match.
    for (let di = 0; di < COLS; di++) {
      const dname = CHAR_DIRS[di];
      for (const r of active) {
        const img = r.imgs[dname];
        if (!img) continue;
        // scaled-to-contain, centred in the cell — multiple active rules
        // layer in registration order (earliest-registered drawn first).
        const s = Math.min(CELL / img.width, CELL / img.height);
        const w = img.width * s, h = img.height * s;
        ctx.drawImage(img, di * CELL + (CELL - w) / 2, (CELL - h) / 2, w, h);
      }
    }
    cache = { sig, out: { canvas: cv, cols: COLS, cell: CELL, w: cv.width, h: cv.height, sig } };
    return cache.out;
  }

  return { register, playerCanvas };
})();
