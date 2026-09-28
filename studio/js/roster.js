// ===== Taiao Workshop — the game's existing characters & objects =====
// index.html pulls in the game's generated data as plain scripts:
//   ../js/sprites/characters-data.js → CHAR_LIST, CHAR_CELL, CHAR_COLS,
//                                      CHAR_DIRS, CHAR_SHEET
//   ../js/sprites/outfit-manifest.js → OUTFIT_STATES  (folder → [state…])
//   ../js/sprites/objects-data.js    → OBJ_MAP, OBJ_CELL, OBJ_COLS, OBJ_SHEET
// so the studio can present a communal catalog of EVERY character and object
// the game currently ships, drawn straight from the game's own sprite atlases
// (frame math verified against render3d.js / objedit.js). All optional — if a
// file isn't reachable that catalog is simply empty.
"use strict";

const Roster = (function () {
  // ---- characters ----
  const hasChars = typeof CHAR_LIST !== "undefined" && Array.isArray(CHAR_LIST);
  const states = typeof OUTFIT_STATES !== "undefined" ? OUTFIT_STATES : {};
  // States hidden from the studio (placeholder outfits we don't surface). The
  // "armorless_robeless"/"armorless*" undressed states are excluded entirely.
  const HIDDEN_STATES = new Set(["new_hairstyle", "new_outfit", "smallclothes"]);
  const isHiddenState = s => HIDDEN_STATES.has(s) || /^armorless/.test(s);
  const visibleStates = folder => (states[folder] || []).filter(s => !isHiddenState(s));
  const cDirs = typeof CHAR_DIRS !== "undefined" ? CHAR_DIRS : DIRS8;
  const cCell = typeof CHAR_CELL !== "undefined" ? CHAR_CELL : 96;
  const cCols = typeof CHAR_COLS !== "undefined" ? CHAR_COLS : 24;
  const charSheetUrl = typeof CHAR_SHEET !== "undefined" ? (ASSET_BASE + CHAR_SHEET) : "";

  // ---- objects ----
  const hasObjs = typeof OBJ_MAP !== "undefined" && OBJ_MAP && typeof OBJ_MAP === "object";
  const oCell = typeof OBJ_CELL !== "undefined" ? OBJ_CELL : 96;
  const oCols = typeof OBJ_COLS !== "undefined" ? OBJ_COLS : 64;
  const objSheetUrl = typeof OBJ_SHEET !== "undefined" ? (ASSET_BASE + OBJ_SHEET) : "";

  const atlases = {};   // url → {img, ok}
  function atlas(url, priority) {
    if (!url) return null;
    let a = atlases[url];
    if (a) return a;
    a = { img: new Image(), ok: false };
    try { if (priority) a.img.fetchPriority = priority; } catch (_) {}
    // Per-URL event so only tiles that need THIS atlas redraw when it lands —
    // a single global event made every character/NPC tile redraw on every
    // atlas load (a storm that made the gallery crawl). decode() readies the
    // bitmap so the redraw paints instantly.
    const done = () => { a.ok = true; document.dispatchEvent(new CustomEvent("roster-atlas:" + url)); };
    a.img.onload = () => { if (a.img.decode) a.img.decode().then(done, done); else done(); };
    a.img.onerror = () => { a.ok = false; document.dispatchEvent(new CustomEvent("roster-atlas:" + url)); };
    a.img.src = url;
    atlases[url] = a;
    return a;
  }
  // the default tab is Characters, so fetch its atlases first at high priority
  if (hasChars) atlas(charSheetUrl, "high");
  if (hasObjs) atlas(objSheetUrl, "high");

  // ---- world NPCs (mix-npc-data.js): a separate billboard atlas ----
  const npcData = (typeof MIX_NPCS !== "undefined" && MIX_NPCS && Array.isArray(MIX_NPCS.list)) ? MIX_NPCS : null;
  const mixSheets = typeof MIX_SHEETS !== "undefined" ? MIX_SHEETS : [];
  const mixOrder = npcData && npcData.order ? npcData.order : DIRS8;
  // NPCs are combinations of two player characters: key = "<garb>__<body>".
  // The BODY (part 2) is the root character; the GARB (part 1) is the style
  // donor. So an NPC's snake id is dot notation: "<bodyName>.<garbName>".
  let _npcs = null, _npcByRoot = null;
  function listNpcs() {
    if (_npcs) return _npcs;
    if (!npcData) { _npcs = []; _npcByRoot = {}; return _npcs; }
    _npcs = npcData.list.map((n, idx) => {
      const parts = String(n.key).split("__");
      const garbF = parts[0], bodyF = parts[parts.length - 1];
      const rootSeg = slug(folderName(bodyF)), garbSeg = slug(folderName(garbF));
      return {
        kind: "character", npc: true, mix: n, index: idx,
        name: n.name || prettyName(n.key), common: n.name || prettyName(n.key), title: n.title || "",
        folder: n.key, key: n.key, states: [], cls: "NPC",
        rootFolder: bodyF, garbFolder: garbF, rootSeg, garbSeg,
        snake: rootSeg + "." + garbSeg,
      };
    });
    // MIX_NPCS ships many NPCs sharing a first name (the game gives them unique
    // names per zone at runtime). This is the global roster CATALOG (every mix
    // def, not a zone), so disambiguate for display by appending the role/garb
    // title to a repeat, then a counter if even that collides. baseName keeps
    // the original. (The Zones tab shows the real per-zone population with the
    // game's culturally-similar name swapping — see studio/tools/zone-npcs.mjs.)
    const firstSeen = {}, usedNames = new Set();
    for (const e of _npcs) {
      const base = e.name;
      firstSeen[base] = (firstSeen[base] || 0) + 1;
      let nm = base;
      if (firstSeen[base] > 1) {
        const role = (e.title || "").split(/\s+in\s+/)[0].trim();   // "Human Druid"
        nm = role ? base + " the " + role : base;
        let k = 2, cand = nm;
        while (usedNames.has(cand)) cand = nm + " " + (k++);
        nm = cand;
      }
      usedNames.add(nm);
      e.baseName = base; e.name = nm; e.common = nm;
    }
    _npcByRoot = {};
    for (const e of _npcs) (_npcByRoot[e.rootFolder] = _npcByRoot[e.rootFolder] || []).push(e);
    return _npcs;
  }
  const npcsForRoot = folder => { listNpcs(); return _npcByRoot[folder] || []; };
  // NPC frames aren't square (fw×fh) and use MIX_NPCS.order for direction.
  function drawNpc(canvas, npc, dirIndex) {
    const px = canvas.width || 72; canvas.width = px; canvas.height = px;
    const ctx = canvas.getContext("2d"); ctx.imageSmoothingEnabled = false;
    if (!npc || !mixSheets.length) return;
    const npcUrl = ASSET_BASE + mixSheets[npc.sheet];
    const a = atlas(npcUrl, "high");   // on screen now — fetch ahead of the background warm
    if (!a || !a.ok) { document.addEventListener("roster-atlas:" + npcUrl, () => drawNpc(canvas, npc, dirIndex), { once: true }); return; }
    let i = mixOrder.indexOf(cDirs[dirIndex || 0]); if (i < 0) i = 0;
    const s = Math.min(px / npc.fw, px / npc.fh), dw = npc.fw * s, dh = npc.fh * s;
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(a.img, npc.ax + i * npc.fw, npc.ay, npc.fw, npc.fh, (px - dw) / 2, (px - dh) / 2, dw, dh);
  }

  function listChars() {
    if (!hasChars) return [];
    return CHAR_LIST.map((c, i) => ({ kind: "character", index: i, name: c.name, common: c.name, snake: slug(c.name), folder: c.folder, key: c.folder, states: visibleStates(c.folder) }));
  }
  const folderName = f => { const c = hasChars && CHAR_LIST.find(x => x.folder === f); return c ? c.name : prettyName(f); };
  function listObjs() {
    if (!hasObjs) return [];
    return Object.keys(OBJ_MAP).map(k => ({ kind: "object", index: OBJ_MAP[k], name: prettyName(k), folder: k, key: k, states: [] }));
  }
  const list = () => listChars();                // back-compat: characters
  const statesOf = folder => visibleStates(folder);
  const isGameChar = folder => hasChars && CHAR_LIST.some(c => c.folder === folder);
  const isGameObj = key => hasObjs && (key in OBJ_MAP);

  function prettyName(k) {
    return String(k).replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
  }

  // Draw one atlas cell into a canvas. Character frame = index*8 + dir
  // (render3d.js); object frame = OBJ_MAP[key]*8 + dir (objedit.js).
  function drawCell(canvas, url, cell, cols, frame) {
    const px = canvas.width || 72;
    canvas.width = px; canvas.height = px;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const a = atlas(url, "high");   // on screen now — fetch ahead of the background warm
    if (!a || !a.ok) {
      document.addEventListener("roster-atlas:" + url, () => drawCell(canvas, url, cell, cols, frame), { once: true });
      return;
    }
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(a.img, (frame % cols) * cell, Math.floor(frame / cols) * cell, cell, cell, 0, 0, px, px);
  }
  const drawThumb = (canvas, index, dirIndex) => drawCell(canvas, charSheetUrl, cCell, cCols, index * cDirs.length + (dirIndex || 0));
  const drawObjThumb = (canvas, key, dirIndex) => { if (!(key in (typeof OBJ_MAP !== "undefined" ? OBJ_MAP : {}))) return; drawCell(canvas, objSheetUrl, oCell, oCols, OBJ_MAP[key] * 8 + (dirIndex || 0)); };

  // ---- outfit STATES: draw any state × any direction (outfit-sheet-data.js) ----
  const hasOutfitSheets = typeof OUTFIT_FRAME !== "undefined" && typeof OUTFIT_SHEETS !== "undefined";
  const osCell = typeof OUTFIT_SHEET_CELL !== "undefined" ? OUTFIT_SHEET_CELL : 96;
  const osCols = typeof OUTFIT_SHEET_COLS !== "undefined" ? OUTFIT_SHEET_COLS : 24;
  function drawState(canvas, entry, state, dirIndex) {
    const di = dirIndex || 0;
    if (entry.npc) return drawNpc(canvas, entry.mix, di);                        // NPCs: mix atlas, no outfit states
    if (!state || state === "Idle") return drawThumb(canvas, entry.index, di);   // Idle lives on CHAR_SHEET
    if (!hasOutfitSheets) return drawThumb(canvas, entry.index, di);
    const fr = OUTFIT_FRAME[entry.folder + "|" + state];
    if (!fr) return drawThumb(canvas, entry.index, di);
    const url = ASSET_BASE + OUTFIT_SHEETS[fr[0]];
    drawCell(canvas, url, osCell, osCols, fr[1] + di);
  }

  // Promise-based twin of drawState() for the studio's subtract dialog (Phase
  // 3 aligned diffing): resolves a FRESH canvas holding one game-art cell at
  // its sheet's native size (96×96), instead of drawing straight into a
  // shared on-screen <canvas> and retrying later via the roster-atlas event
  // like drawState does. NPC entries (npc.mix billboards) aren't part-
  // carving targets — a mix NPC has no guaranteed per-direction alignment
  // against the character it's built from — so those resolve null.
  function stateFrameAsync(entry, state, dirIndex) {
    return new Promise(resolve => {
      if (!entry || entry.npc) { resolve(null); return; }
      const di = dirIndex || 0;
      const fr = (state && state !== "Idle" && hasOutfitSheets) ? OUTFIT_FRAME[entry.folder + "|" + state] : null;
      const url = fr ? (ASSET_BASE + OUTFIT_SHEETS[fr[0]]) : charSheetUrl;
      const cell = fr ? osCell : cCell;
      const cols = fr ? osCols : cCols;
      const frame = fr ? (fr[1] + di) : (entry.index * cDirs.length + di);
      if (!url) { resolve(null); return; }
      const cellFrom = a => {
        const cv = document.createElement("canvas");
        cv.width = cell; cv.height = cell;
        const ctx = cv.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(a.img, (frame % cols) * cell, Math.floor(frame / cols) * cell, cell, cell, 0, 0, cell, cell);
        return cv;
      };
      const a = atlas(url, "high");
      if (a.ok) { resolve(cellFrom(a)); return; }
      let settled = false;
      const onReady = () => {
        if (settled) return; settled = true;
        const aa = atlases[url];
        resolve(aa && aa.ok ? cellFrom(aa) : null);
      };
      document.addEventListener("roster-atlas:" + url, onReady, { once: true });
      setTimeout(() => {
        if (settled) return; settled = true;
        document.removeEventListener("roster-atlas:" + url, onReady);
        resolve(null);
      }, 8000);
    });
  }

  // ---- real in-game stats ----
  // Playable characters read CHAR_STATS[index]; NPCs derive from their title
  // ("Race Class in X garb"), the same source the game uses (mixStatsFor).
  function stats(entry) {
    if (entry.kind !== "character") return null;
    if (entry.npc) return (typeof deriveCharStats !== "undefined") ? deriveCharStats(entry.title || entry.name || entry.key) : null;
    return (typeof CHAR_STATS !== "undefined" && CHAR_STATS[entry.index]) || null;
  }
  // Playable roster → "player"; world NPCs (mix registry) → "NPC". The
  // community can still vote to reclassify any of them.
  const classOf = entry => entry && entry.npc ? "NPC" : "player";
  const defaultClass = classOf;   // back-compat

  // Every playable character + every world NPC — the full Characters roster.
  const characters = () => listChars().concat(listNpcs());
  const charEntry = key => listChars().find(e => e.folder === key) || listNpcs().find(e => e.key === key) || null;

  // Draw a catalog entry (character / NPC / object) by its roster row.
  function drawEntry(canvas, entry, dirIndex) {
    if (entry.npc) drawNpc(canvas, entry.mix, dirIndex);
    else if (entry.kind === "object") drawObjThumb(canvas, entry.key, dirIndex);
    else drawThumb(canvas, entry.index, dirIndex);
  }

  // Background-warm the atlases (character, object, NPC billboard sheets) at LOW
  // priority, at most a couple in flight, so revisiting a tab is instant without
  // stealing bandwidth from whatever tab is loading at high priority right now.
  function preload() {
    const urls = [];
    if (hasChars) urls.push(charSheetUrl);
    if (hasObjs) urls.push(objSheetUrl);
    for (const s of mixSheets) urls.push(ASSET_BASE + s);
    const queue = urls.filter(u => !atlases[u]);
    let i = 0, active = 0;
    const MAX = 2;
    function pump() {
      while (active < MAX && i < queue.length) {
        const url = queue[i++];
        if (atlases[url]) continue;
        active++;
        document.addEventListener("roster-atlas:" + url, () => { active--; pump(); }, { once: true });
        atlas(url, "low");
      }
    }
    pump();
  }
  return {
    has: hasChars, hasChars, hasObjs, hasOutfitSheets, preload,
    list, listChars, listObjs, listNpcs, npcsForRoot, characters, charEntry, statesOf, isGameChar, isGameObj,
    drawThumb, drawObjThumb, drawNpc, drawEntry, drawState, stateFrameAsync, stats, classOf, defaultClass, prettyName,
    dirs: cDirs, gameArtPath: GAME_ART_PATH,
    entriesFor: kind => kind === "object" ? listObjs() : characters(),
  };
})();
