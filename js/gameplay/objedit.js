// ===== Taiao — object workshop (right-click "Edit <thing>") =====
// A per-object community editor: every world object's context menu offers
// "Edit x" below "Examine x" (input.js editDescFor/pushEdit). The panel shows
// the object's CURRENT art — all 8 direction sprites where they exist (8-dir
// monsters, mix NPCs), plus extra variant sections for husbandry animals
// (tended/spent frames, baby form) — beside any proposed alternative sets, and
// lets the player vote for their favourite. Players can upload their own set
// of 8 sprites per variant (8 files, or one 8-frame horizontal strip); uploads
// live only in this panel — they NEVER change the in-game art.
//
// Below the art, votable polls:
//  • Scale (every object)
//  • Monsters: a per-item DROP TABLE — quantity + drop-chance chips on every
//    drop (0% = "shouldn't drop this"), suggest brand-new drop items;
//    aggression as a player-level threshold (1 = peaceful), temperament,
//    animations, husbandry behaviour for livestock
//  • Nodes: required level, deplete/gem chances, yield, respawn
//  • Doors/gates: open-close behaviour, lock/unlock schedule
//  • Generation (most types): spawn biomes, rarity, latitudes, proximity to
//    roads/settlements, time & weather rules
// Every poll offers "suggest your own". Votes + proposals persist in
// localStorage for now (no server); a vote toggles off when clicked again.
"use strict";

(function () {
  const LS_KEY = "taiao_objedit_v1"; // migrated from emberfall_objedit_v1, see js/lskeys-migrate.js
  const PX = 72;                       // on-screen sprite cell size
  const D8 = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"];
  const DSHORT = { south: "S", "south-east": "SE", east: "E", "north-east": "NE", north: "N", "north-west": "NW", west: "W", "south-west": "SW" };

  // ---- local persistence:
  // { "<type>:<key>": { votes:{pollId:optId}, props:{pollId:[{id,label}]},
  //                     sprites:[{id,label,variant,imgs:[dataURL…]}] } }
  function loadStore() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; } }
  const store = loadStore();
  function saveStore() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { if (typeof log === "function") log("Couldn't save your workshop votes (storage full?).", "warn"); }
    // ballot box (net/worksync.js): when logged in, this object's votes sync
    // to the community tally a few seconds after the last change
    if (cur && typeof WorkSync !== "undefined") WorkSync.noteChange(cur.type + ":" + cur.key);
  }
  function recFor(desc) {
    const k = desc.type + ":" + desc.key;
    return store[k] || (store[k] = { votes: {}, props: {}, sprites: [] });
  }

  // ---- curator pipeline: "Export my proposal" bundles this object's votes,
  // suggested properties and any uploaded art into one file a player can
  // attach to a submission (see CONTRIBUTING.md — the workshop's exit path).
  // Nothing here reaches a server; it's a local download, same as a save file.
  function exportProposal() {
    if (!cur) return;
    const rec = recFor(cur);
    const n = Object.keys(rec.votes).length + Object.keys(rec.props).length + rec.sprites.length;
    if (!n) { if (typeof log === "function") log("Nothing to export yet — vote, suggest, or upload something first.", "warn"); return; }
    const bundle = {
      schema: "taiao-workshop-proposal/1",
      object: { type: cur.type, key: cur.key, name: cur.name },
      votes: rec.votes,
      props: rec.props,
      sprites: rec.sprites,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `taiao-proposal-${cur.type}-${cur.key}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (typeof log === "function")
      log("Proposal saved — see CONTRIBUTING.md for how to submit it.", "gold");
  }

  // Build the same bundle exportProposal downloads. Shared by both exit paths.
  function proposalBundle() {
    if (!cur) return null;
    const rec = recFor(cur);
    const n = Object.keys(rec.votes).length + Object.keys(rec.props).length + rec.sprites.length;
    if (!n) { if (typeof log === "function") log("Nothing to submit yet — vote, suggest, or upload something first.", "warn"); return null; }
    return {
      schema: "taiao-workshop-proposal/1",
      object: { type: cur.type, key: cur.key, name: cur.name },
      votes: rec.votes, props: rec.props, sprites: rec.sprites,
      exportedAt: new Date().toISOString(),
    };
  }

  // ---- "Submit proposal" — the logged-in exit path (audit §10 rung 1):
  // same bundle as the export, sent straight to the curator queue with an
  // explicit licence grant. The grant sentence is what makes accepted work
  // belong to everyone forever (CONTRIBUTING.md).
  async function submitProposal() {
    const bundle = proposalBundle();
    if (!bundle) return;
    if (!confirm(
      "Submit this proposal to the community workshop?\n\n" +
      "By submitting, you licence your suggested values and any uploaded art " +
      "under CC BY-SA 4.0 (the game's asset licence) — if accepted, it belongs " +
      "to everyone, forever, with your name on it.")) return;
    const r = await WorkSync.submit(bundle, "CC-BY-SA-4.0");
    if (typeof log === "function") {
      if (r.ok) log("Proposal submitted — a curator reads every one (GOVERNANCE.md). Kia ora!", "gold");
      else log("Couldn't submit: " + (r.error || "server error") + " (Export still works.)", "warn");
    }
  }

  // ---- sprite drawing (same sheet math as icon() in main/assets.js, at panel size) ----
  // frac shrinks the art inside its cell (babies draw at half size); flip
  // mirrors it horizontally (the in-game west-facing flip of billboard sprites).
  function drawKeys(cv, keys, px, frac, flip) {
    cv.width = px; cv.height = px;
    const c2 = cv.getContext("2d");
    c2.imageSmoothingEnabled = false;
    const dsz = px * (frac || 1), d0 = (px - dsz) / 2;
    let drew = false;
    for (const key of keys) {
      const def = typeof SPR !== "undefined" && SPR[key];
      if (!def) continue;
      const [sheet, c, r, extra] = def;
      const img = IMGS[sheet];
      if (!img || !img.complete || img.naturalWidth === 0) {
        // deferred sheet still streaming in — redraw this cell when it lands
        if (img) img.addEventListener("load", () => drawKeys(cv, keys, px, frac, flip), { once: true });
        continue;
      }
      const st = SHEET_TILE[sheet] || 16;
      const off = SHEET_OFFSET[sheet] || { ox: 0, oy: 0 };
      const pitch = SHEET_NOPAD.has(sheet) ? st : st + 1;
      const sx = (extra && extra.sx != null ? extra.sx : c * pitch) + off.ox;
      const sy = (extra && extra.sy != null ? extra.sy : r * pitch) + off.oy;
      const sw = (extra && extra.sw) || st, sh = (extra && extra.sh) || st;
      c2.save();
      if (flip) { c2.translate(px, 0); c2.scale(-1, 1); }
      if (extra && extra.filter) c2.filter = extra.filter;   // spent recolours etc.
      if (SHEET_COLORKEY.has(sheet)) {
        const tmp = document.createElement("canvas");
        tmp.width = px; tmp.height = px;
        const tc = tmp.getContext("2d");
        tc.imageSmoothingEnabled = false;
        tc.drawImage(img, sx, sy, sw, sh, 0, 0, px, px);
        const id = tc.getImageData(0, 0, px, px), d = id.data;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 12 && d[i + 1] < 12 && d[i + 2] < 12) d[i + 3] = 0;
        tc.putImageData(id, 0, 0);
        c2.drawImage(tmp, d0, d0, dsz, dsz);
      } else {
        c2.drawImage(img, sx, sy, sw, sh, d0, d0, dsz, dsz);
      }
      c2.restore();
      drew = true;
    }
    return drew;
  }

  // mix-NPC atlas frames (frame i sits at ax + i*fw on the def's sheet)
  const _mixImgs = {};
  function drawMixFrame(cv, def, i, px) {
    cv.width = px; cv.height = px;
    let img = _mixImgs[def.sheet];
    if (!img) { img = new Image(); img.src = MIX_SHEETS[def.sheet]; _mixImgs[def.sheet] = img; }
    const c2 = cv.getContext("2d");
    c2.imageSmoothingEnabled = false;
    if (!img.complete || img.naturalWidth === 0) {
      img.addEventListener("load", () => drawMixFrame(cv, def, i, px), { once: true });
      return;
    }
    // keep the frame's aspect, centred in the square cell
    const s = Math.min(px / def.fw, px / def.fh);
    const dw = def.fw * s, dh = def.fh * s;
    c2.drawImage(img, def.ax + i * def.fw, def.ay, def.fw, def.fh, (px - dw) / 2, (px - dh) / 2, dw, dh);
  }

  // the player's 8-direction art: current outfit state from its embedded
  // outfit sheet, else the Idle frames from the packed CHAR_SHEET
  let _charImg = null;
  const _outfitImgs = {};
  function drawPlayerFrame(cv, di, px) {
    cv.width = px; cv.height = px;
    const c2 = cv.getContext("2d");
    c2.imageSmoothingEnabled = false;
    if (typeof CHAR_LIST === "undefined" || player.character == null || !CHAR_LIST[player.character]) return;
    const folder = CHAR_LIST[player.character].folder;
    const fr = (player.outfit && player.outfit !== "Idle" && typeof OUTFIT_FRAME !== "undefined")
      ? OUTFIT_FRAME[folder + "|" + player.outfit] : null;
    const retry = img => img.addEventListener("load", () => drawPlayerFrame(cv, di, px), { once: true });
    if (fr && typeof OUTFIT_SHEETS !== "undefined" && OUTFIT_SHEETS[fr[0]] != null) {
      let img = _outfitImgs[fr[0]];
      if (!img) { img = new Image(); img.src = OUTFIT_SHEETS[fr[0]]; _outfitImgs[fr[0]] = img; }
      if (!img.complete || img.naturalWidth === 0) return retry(img);
      const frame = fr[1] + di, cell = OUTFIT_SHEET_CELL, cols = OUTFIT_SHEET_COLS;
      c2.drawImage(img, (frame % cols) * cell, Math.floor(frame / cols) * cell, cell, cell, 0, 0, px, px);
      return;
    }
    if (typeof CHAR_SHEET === "undefined") return;
    if (!_charImg) { _charImg = new Image(); _charImg.src = CHAR_SHEET; }
    if (!_charImg.complete || _charImg.naturalWidth === 0) return retry(_charImg);
    const frame = player.character * CHAR_DIRS.length + di;
    c2.drawImage(_charImg, (frame % CHAR_COLS) * CHAR_CELL, Math.floor(frame / CHAR_COLS) * CHAR_CELL,
      CHAR_CELL, CHAR_CELL, 0, 0, px, px);
  }

  // ---- packed 8-direction OBJECT sheet (objects-data.js) ----
  // Most world props (decor, stations, tiered trees/rocks/gems) actually
  // render with this sheet via render3d's objForKey — their flat SPR keys are
  // old fallbacks and can look completely different (e.g. seashell was a
  // recoloured flower). Draw frames straight off the sheet so the panel shows
  // the same art the game does.
  let _objImg = null;
  function drawObjFrame(cv, idx, dir, px) {
    cv.width = px; cv.height = px;
    if (typeof OBJ_SHEET === "undefined" || typeof OBJ_CELL === "undefined") return;
    if (!_objImg) { _objImg = new Image(); _objImg.src = OBJ_SHEET; }
    const c2 = cv.getContext("2d");
    c2.imageSmoothingEnabled = false;
    if (!_objImg.complete || _objImg.naturalWidth === 0) {
      _objImg.addEventListener("load", () => drawObjFrame(cv, idx, dir, px), { once: true });
      return;
    }
    const gf = idx * 8 + dir;
    c2.drawImage(_objImg, (gf % OBJ_COLS) * OBJ_CELL, Math.floor(gf / OBJ_COLS) * OBJ_CELL,
      OBJ_CELL, OBJ_CELL, 0, 0, px, px);
  }
  // the renderer's own resolution of which packed object (if any) a key draws with
  function objArt(key) {
    const ren = (typeof R3D !== "undefined" && R3D.objArtFor) ? R3D : null;
    if (!ren || !key) return null;
    try { return ren.objArtFor(key); } catch (e) { return null; }
  }
  // the desc's in-game packed-object art as an 8-direction frame set, or null
  function objArtSet(desc) {
    const cands = [];
    if (desc.type === "decor") cands.push(desc.key);
    else if (desc.type === "station") {
      cands.push(desc.key);
      const s = typeof STATIONS !== "undefined" && STATIONS[desc.key];
      if (s && s.spr) cands.push(s.spr);
    } else if (desc.type === "node") {
      const n = typeof NODE_TYPES !== "undefined" && NODE_TYPES[desc.key];
      if (n) { if (n.spr) cands.push(n.spr); if (n.deadSpr) cands.push(n.deadSpr); }
    } else if (desc.type === "crop") {
      const c = typeof CROPS !== "undefined" && CROPS[desc.key];
      if (c && c.spr) cands.push(c.spr);
    }
    for (const k of cands) {
      const ov = objArt(k);
      if (ov && ov.idx != null) return {
        labels: D8.map(d => DSHORT[d]),
        draw: D8.map((_, i) => cv => drawObjFrame(cv, ov.idx, i, PX)),
        note: "The packed 8-direction object art this prop renders with in-game.",
      };
    }
    return null;
  }

  // the single SPR key a non-directional object is drawn with, or null
  function singleSprKeyFor(desc) {
    const has = k => k && typeof SPR !== "undefined" && SPR[k] && k;
    if (desc.type === "item") return has(typeof ITEMS !== "undefined" && ITEMS[desc.key] && ITEMS[desc.key].icon);
    if (desc.type === "node") { const n = typeof NODE_TYPES !== "undefined" && NODE_TYPES[desc.key]; return n && (has(n.spr) || has(n.deadSpr)); }
    if (desc.type === "station") { const s = typeof STATIONS !== "undefined" && STATIONS[desc.key]; return s && has(s.spr); }
    if (desc.type === "crop") { const c = typeof CROPS !== "undefined" && CROPS[desc.key]; return c && has(c.spr); }
    if (desc.type === "decor") return has(desc.key);
    if (desc.type === "structure") {
      const cand = { door: ["door_wood", "door"], gate: ["gate_wood", "gate"], ladder: ["ladder"], portal: ["portal"], farm_plot: ["tilled_soil"] }[desc.key] || [desc.key];
      for (const k of cand) if (has(k)) return k;
    }
    return null;
  }

  // one sprite for every direction: repeat it across all 8 compass cells.
  // mirror flips the west-side cells (the in-game facing<0 billboard flip).
  function eightCells(drawOne, mirror) {
    return { labels: D8.map(d => DSHORT[d]),
      draw: D8.map(d => cv => drawOne(cv, !!mirror && /west/.test(d))) };
  }

  // 3D-geometry objects (doors, gates, ladders, portals, obstacles, anything
  // without sheet art): convert the live 3D geometry into an 8-sprite
  // billboard set — one snapshot per compass direction, the camera orbiting
  // the object's tile in 45° steps (S = seen from the south, etc.). Cached on
  // the descriptor so re-renders of the panel don't re-shoot.
  function snapshotFor(desc) {
    if (desc._shots !== undefined) return desc._shots;
    const ren = (typeof REN !== "undefined" && REN && REN.snapshotTile) ? REN
      : (typeof R3D !== "undefined" && R3D.snapshotTile) ? R3D : null;
    let shots = null;
    if (ren && desc.x != null && desc.y != null) {
      try {
        shots = D8.map((_, i) => ren.snapshotTile(desc.x, desc.y, 144, i * Math.PI / 4));
        if (shots.some(s => !s)) shots = null;
      } catch (e) { shots = null; }
    }
    return (desc._shots = shots);
  }
  function snapshotSet(desc) {
    const shots = snapshotFor(desc);
    if (!shots) return null;
    return {
      labels: D8.map(d => DSHORT[d]),
      draw: shots.map(shot => cv => {
        cv.width = PX; cv.height = PX;
        const c2 = cv.getContext("2d");
        c2.imageSmoothingEnabled = false;
        c2.drawImage(shot, 0, 0, PX, PX);
      }),
      note: "Built from 3D geometry in-game — converted to a billboard set by snapshotting the live object from each of the 8 sides.",
    };
  }

  // the object's current art as labelled draw callbacks (up to 8 direction cells)
  function frameSet(desc, frac) {
    if (desc.type === "monster" && typeof MONSTERS !== "undefined") {
      const def = MONSTERS[desc.key];
      if (def && def.dirSpr) {
        const base = desc.key.replace(/(_v)?(_baby)?$/, "");
        return { labels: D8.map(d => DSHORT[d]), draw: D8.map(d => cv => drawKeys(cv, ["mcd_" + base + "_" + d], PX, frac)) };
      }
      if (def) {
        const layers = Array.isArray(def.spr) ? def.spr.map(l => (Array.isArray(l) ? l[0] : l)) : [def.spr];
        const fs = eightCells((cv, fl) => drawKeys(cv, layers, PX, frac, fl), true);
        fs.note = "This creature uses one sprite for every direction (mirrored when it faces west) — a proposed set can give it a real frame for each.";
        return fs;
      }
    }
    if (desc.type === "npc" && typeof MIX_NPCS !== "undefined") {
      const def = MIX_NPCS.list.find(d => d.key === desc.key);
      if (def) return { labels: MIX_NPCS.order.map(d => DSHORT[d]), draw: MIX_NPCS.order.map((_, i) => cv => drawMixFrame(cv, def, i, PX)) };
    }
    if (desc.type === "player") {
      if (typeof CHAR_LIST !== "undefined" && player.character != null && CHAR_LIST[player.character] && typeof CHAR_DIRS !== "undefined")
        return { labels: CHAR_DIRS.map(d => DSHORT[d] || d), draw: CHAR_DIRS.map((_, i) => cv => drawPlayerFrame(cv, i, PX)),
          note: player.outfit && player.outfit !== "Idle" ? "Your character in their current outfit (" + player.outfit + ")." : "Your character's Idle walk frames." };
      return { labels: [], draw: [], note: "No playable character selected — pick one with C first." };
    }
    if (desc.type === "roof") {
      // roof-tile texture variants for this building family (wood vs stone),
      // with the clicked building's roof marked — no direction cells
      const fam = desc.key === "roof_stone"
        ? (typeof ROOFS_STONE !== "undefined" ? ROOFS_STONE : ["roof_gray", "roof_tower"])
        : (typeof ROOFS !== "undefined" ? ROOFS : ["roof_brown", "roof_gray", "roof_red", "roof_teal"]);
      const keys = fam.slice();
      if (desc.spr && !keys.includes(desc.spr)) keys.push(desc.spr);
      return {
        labels: keys.map((k, i) => "#" + (i + 1) + (k === desc.spr ? " ◂ this building" : "")),
        draw: keys.map(k => cv => drawKeys(cv, [k], PX)),
        note: "The roof-tile textures " + (desc.key === "roof_stone" ? "stone" : "timber") +
          " buildings draw from — this building uses the marked one.",
      };
    }
    if (desc.type === "terrain") {
      // terrain is flat, so no direction cells — show the art VARIANTS this
      // ground family cycles through across the map, marking this tile's one
      const cur = desc.spr || desc.key;
      const keys = [];
      const m = /^bg_(\d+)/.exec(desc.key);
      if (m && typeof BIOME_GROUND_VARIANTS !== "undefined" && BIOME_GROUND_VARIANTS[+m[1]]) {
        keys.push(...BIOME_GROUND_VARIANTS[+m[1]]);
      } else if (typeof SPR !== "undefined") {
        const base = desc.key === "road" ? "dirt" : desc.key.split("#")[0];
        for (let i = 0; SPR[base + "#" + i]; i++) keys.push(base + "#" + i);
        if (!keys.length && SPR[base]) keys.push(base);
      }
      if (!keys.length) return { labels: [], draw: [], note: "No tile art found for this ground." };
      return {
        labels: keys.map((k, i) => (keys.length > 1 ? "#" + (i + 1) : "tile") + (k === cur && keys.length > 1 ? " ◂ this tile" : "")),
        draw: keys.map(k => cv => drawKeys(cv, [k], PX)),
        note: keys.length > 1
          ? "All " + keys.length + " art variants this terrain cycles through across the map — this tile uses the marked one."
          : "The ground texture for this tile.",
      };
    }
    // props that render with the packed 8-direction objects sheet in-game
    // (decor, stations, tiered trees/rocks/gems, crops): show THAT art, not
    // the old flat SPR fallback key
    {
      const fs = objArtSet(desc);
      if (fs) return fs;
    }
    // objects built from live 3D geometry: an 8-direction billboard set
    if (desc.type === "structure" || desc.type === "obstacle") {
      const fs = snapshotSet(desc);
      if (fs) return fs;
    }
    const key = singleSprKeyFor(desc);
    if (key) {
      if (desc.type === "item")
        return { labels: ["icon"], draw: [cv => drawKeys(cv, [key], PX, frac)], note: "The item's inventory icon." };
      const fs = eightCells(cv => drawKeys(cv, [key], PX, frac));
      fs.note = "Drawn with this single billboard sprite from every side in-game — a proposed set can give it all 8 directions.";
      return fs;
    }
    // no sheet art at all: whatever it is, convert its 3D geometry to a
    // billboard set rather than showing nothing
    {
      const fs = snapshotSet(desc);
      if (fs) return fs;
    }
    return { labels: [], draw: [], note: "This object is built from 3D geometry, so there's no sprite-sheet art to show — but proposed sets can still be browsed and voted on." };
  }

  // walk-cycle matrices are 8 direction columns × ANIM_ROWS frame rows
  const ANIM_ROWS = 6;

  // sprite variant sections: standard, plus a walk-cycle animation matrix for
  // characters & monsters, plus tended/spent + baby for husbandry beasts
  function variantsFor(desc) {
    const std = { vid: "std", title: desc.type === "item" ? "Icon" : "Sprites", voteId: "sprite_set", fs: frameSet(desc) };
    const out = [std];
    if ((desc.type === "monster" || desc.type === "npc" || desc.type === "player") && std.fs.draw.length === 8)
      out.push({ vid: "anim", title: "Animation frames (walk cycle)", voteId: "sprite_set_anim",
        matrix: true, fs: std.fs,
        blurb: "A " + ANIM_ROWS + "-frame walk cycle per direction: 8 columns (S…SW) × " + ANIM_ROWS +
          " frame rows. Vote on a matrix, or upload your own." });
    // walls build to VARIABLE HEIGHTS from stacked block tiles, with merlon
    // parapets on top (city walls, towers) — show the component art too
    const wallKind = /^wall_(stone|wood|tower)/.exec(desc.key || "");
    if (wallKind && (desc.type === "decor" || desc.type === "obstacle" || desc.type === "structure") && typeof SPR !== "undefined") {
      const stone = wallKind[1] !== "wood";
      const parts = (stone
        ? [["wall_stone", "front/back block"], ["wall_stone_side", "side block"]]
        : [["wall_wood", "facade plank"], ["wall_wood_side", "side panel"]]).filter(p => SPR[p[0]]);
      if (desc.key === "wall_tower" && SPR.wall_tower) parts.push(["wall_tower", "tower course"]);
      const mk = ps => ({ labels: ps.map(p => p[1]), draw: ps.map(p => cv => drawKeys(cv, [p[0]], PX)) });
      if (parts.length) {
        const bfs = mk(parts);
        bfs.note = "The block tiles the wall is built from — repeated up the face to whatever height the wall reaches" +
          (desc.key === "wall_tower" ? " (towers run three storeys of courses)" : "") + ".";
        out.push({ vid: "blocks", title: "Building blocks", voteId: "sprite_set_blocks", fs: bfs,
          blurb: "Walls have variable heights: these tiles stack up the wall face." });
      }
      if (stone && SPR.wall_stone) {
        const pfs = mk([["wall_stone", "merlon block"]]);
        pfs.note = "Where the wall carries battlements (city walls, tower tops), the merlons are small 3D blocks textured with this same tile — there's no dedicated parapet art yet, so a proposed set could give it its own.";
        out.push({ vid: "parapet", title: "Parapet (top)", voteId: "sprite_set_parapet", fs: pfs,
          blurb: "The crenellated parapet running along the top of the wall." });
      }
    }
    // ---- worn looks: the community path that replaces the parked auto-warp ----
    // armour-overlay.js is parked because one generic decal, affine-warped to
    // 180 different bodies, reads as a smear. The replacement is voted,
    // per-character worn art: every equipped piece (and any equippable item's
    // own Edit panel) gets a "worn look" section — upload 8-direction art of
    // a character WEARING the piece, vote on the looks you like, and export
    // the winning proposal like any other workshop change.
    if (desc.type === "player" && typeof ITEMS !== "undefined" && player.equip && std.fs.draw.length === 8) {
      // render the parked auto-warp ONCE as a reference card: proposals
      // should know the look they're beating
      let overlayCard = null;
      if (typeof ArmourOverlay !== "undefined") {
        const was = window.__armourOverlay;
        window.__armourOverlay = true;
        let ov = null;
        try { ov = ArmourOverlay.playerCanvas(); } catch (e) {}
        window.__armourOverlay = was;
        if (ov) overlayCard = {
          id: "autowarp", title: "Auto-warped overlay (parked)", tag: "the look to beat",
          fs: { labels: std.fs.labels,
            draw: CHAR_DIRS.map((_, di) => cv => {
              drawPlayerFrame(cv, di, PX);
              const c2 = cv.getContext("2d");
              c2.imageSmoothingEnabled = false;
              c2.drawImage(ov.canvas, di * ov.cell, 0, ov.cell, ov.cell, 0, 0, PX, PX);
            }),
            note: "The parked generic-decal warp over your current body — judged too rough to ship, kept here so worn-look proposals have something to beat." },
        };
      }
      const seenIds = new Set();
      for (const sl in player.equip) {
        const s = player.equip[sl];
        // regular slots hold a plain item-id string; only the rune pouch and
        // quiver hold {id, qty} stacks
        const id = typeof s === "string" ? s : s && s.id;
        if (!id || seenIds.has(id)) continue;
        const def = ITEMS[id];
        if (!def || !def.equip || def.equip === "rune" || def.equip === "quiver") continue;
        seenIds.add(id);
        const warped = /^(helm|chest|legs|chainbody|gloves|boots)_/.test(id);
        out.push({
          vid: "worn_" + id, voteId: "worn:" + id,
          title: "Worn look — " + def.name,
          fs: { labels: std.fs.labels, draw: std.fs.draw,
            note: "No worn art exists for this piece yet — the body is drawn bare of it. Upload an 8-direction set of THIS character wearing the " +
              def.name.toLowerCase() + " (put the character's name in the label) and vote on the looks you like." },
          canonTitle: "Current in-game look (piece not drawn)",
          altCards: warped && overlayCard ? [overlayCard] : [],
          blurb: "You have the " + def.name + " equipped: how should it look on the body? " +
            "Community-voted worn art is the path that replaces the parked auto-warp overlay.",
        });
      }
    }
    if (desc.type === "item" && typeof ITEMS !== "undefined") {
      const idef = ITEMS[desc.key];
      if (idef && idef.equip && idef.equip !== "rune" && idef.equip !== "quiver") {
        const bodyFs = frameSet({ type: "player" });
        if (bodyFs.draw.length === 8) {
          bodyFs.note = "Your current character, drawn without the piece — the blank canvas. " +
            "Upload an 8-direction set of a character wearing the " + idef.name.toLowerCase() +
            " (name the character in the label); per-character sets are welcome.";
          out.push({
            vid: "worn", voteId: "worn",
            title: "Worn look — on the body",
            fs: bodyFs,
            canonTitle: "Current in-game look (piece not drawn)",
            blurb: "How the " + idef.name + " should look when worn. Community-voted worn art replaces the parked auto-warp overlay.",
          });
        }
      }
    }
    if (desc.type !== "monster" || typeof MONSTERS === "undefined") return out;
    const base = desc.key.replace(/(_v)?(_baby)?$/, "");
    const spentKey = typeof HUSB_SPENT_SPR !== "undefined" && HUSB_SPENT_SPR[base];
    if (spentKey && typeof SPR !== "undefined") {
      // the hand-made spent art (shorn sheep, laid quail…): real dedicated
      // frames, not just a recolour (no filter in the def)
      const single = SPR[spentKey];
      const dedicated = single && !(single[3] && single[3].filter);
      const dirFs = SPR[spentKey + "_south"]
        ? { labels: D8.map(d => DSHORT[d]), draw: D8.map(d => cv => drawKeys(cv, [spentKey + "_" + d], PX)) }
        : null;
      let fs = null;
      const v = { vid: "spent", title: "Tended (spent) sprites", voteId: "sprite_set_spent",
        blurb: "How the animal looks after tending, while it recovers." };
      if (dedicated) {
        // the CORRECT tended look (shorn sheep, laid quail…) leads the section,
        // one pose repeated across the 8 sides (mirrored west, like in-game)
        fs = eightCells((cv, fl) => drawKeys(cv, [spentKey], PX, null, fl), true);
        fs.note = "The dedicated tended artwork — one pose, shown here for each of the 8 sides.";
        v.canonTitle = "Tended look (hand-made art)";
        if (dirFs) {
          dirFs.note = "The regular walk frames with a drained tint — what the game shows while a recovering animal wanders, so it keeps facing the way it walks.";
          v.altCards = [{ id: "tinted", title: "Tinted walk frames", tag: "shown in-world", fs: dirFs }];
        }
      } else if (dirFs) {
        dirFs.note = "The walk frames with a drained tint — this is what the game shows in-world, so a recovering animal keeps facing the way it walks.";
        fs = dirFs;
      } else if (single) {
        fs = eightCells((cv, fl) => drawKeys(cv, [spentKey], PX, null, fl), true);
        fs.note = "One spent pose, shown for every direction.";
      }
      if (fs) { v.fs = fs; out.push(v); }
    }
    if (!/_baby$/.test(desc.key)) {
      const babyKey = MONSTERS[desc.key + "_baby"] ? desc.key + "_baby" : MONSTERS[base + "_baby"] ? base + "_baby" : null;
      if (babyKey) out.push({ vid: "baby", title: "Baby sprites (" + MONSTERS[babyKey].name + ")",
        voteId: "sprite_set_baby", fs: frameSet({ type: "monster", key: babyKey }, 0.5),
        blurb: "The young animal raised by tending — currently the adult art at half scale." });
    }
    return out;
  }

  // ---- poll option assembly: canon first, presets deduped against it & each other ----
  function mkOpts(canonLabel, presets, mine) {
    const seen = new Set(), out = [];
    const norm = s => String(s).trim().toLowerCase();
    if (canonLabel != null) { out.push({ id: "canon", label: String(canonLabel), canon: true }); seen.add(norm(canonLabel)); }
    (presets || []).forEach((p, i) => {
      if (p == null || seen.has(norm(p))) return;
      seen.add(norm(p));
      out.push({ id: "x" + i, label: String(p) });
    });
    for (const p of mine || []) {
      if (seen.has(norm(p.label))) continue;
      seen.add(norm(p.label));
      out.push({ id: p.id, label: p.label, mine: true });
    }
    return out;
  }

  // ---- constrained vocabularies: some suggest-fields must name EXISTING game
  // things (drop items -> real item names, spawn biomes -> real biome names).
  // Each vocab feeds a shared <datalist> for native autocomplete, and submits
  // are validated against it (case-insensitive; biomes accept a comma list).
  const _pretty = code => code.charAt(0) + code.slice(1).toLowerCase();
  const VOCAB = {
    items: () => {
      const s = new Set();
      if (typeof ITEMS !== "undefined") for (const id in ITEMS) if (ITEMS[id].name) s.add(ITEMS[id].name);
      return [...s].sort();
    },
    biomes: () => (typeof BIOME_MOB_NAMES !== "undefined" ? Object.keys(BIOME_MOB_NAMES).map(_pretty).sort() : []),
  };
  function datalistFor(kind) {
    const id = "oe-dl-" + kind;
    if (!document.getElementById(id)) {
      const dl = document.createElement("datalist");
      dl.id = id;
      for (const n of VOCAB[kind]()) {
        const o = document.createElement("option");
        o.value = n;
        dl.appendChild(o);
      }
      document.body.appendChild(dl);
    }
    return id;
  }
  // -> canonical string (proper casing), or null when the text names nothing real
  function vocabMatch(kind, text) {
    const names = VOCAB[kind]();
    const find = t => names.find(n => n.toLowerCase() === t.toLowerCase()) || null;
    if (kind === "biomes") {
      const parts = text.split(",").map(s => s.trim()).filter(Boolean).map(find);
      return parts.length && parts.every(Boolean) ? parts.join(", ") : null;
    }
    return find(text.trim());
  }
  const VOCAB_WARN = {
    items: "Suggestions must name an existing item — start typing for matches.",
    biomes: "Suggestions must name existing biomes (comma-separate several) — start typing for matches.",
  };

  // ---- numeric custom-chip formats: parse the typed value (symbols like ×/%
  // tolerated and stripped), reject non-numbers, emit a canonical label ----
  const _num = v => { const n = parseFloat(String(v).replace(/[^0-9.]/g, "")); return isNaN(n) ? null : n; };
  const _int = v => { const n = _num(v); return n == null ? null : Math.round(n); };
  const NUM = {
    scale: v => { const n = _num(v); return n > 0 && n <= 20 ? "×" + +n.toFixed(2) : null; },
    level: v => { const n = _int(v); return n >= 1 ? "Level " + n : null; },
    coins: v => { const n = _int(v); return n >= 0 ? n + " coins" : null; },
    pct: v => { const n = _num(v); return n >= 0 && n <= 100 ? +n.toFixed(1) + "%" : null; },
    qty: v => {   // "2", "2-4", "2-4×" — a count or a min-max range
      const m = String(v).replace(/[×x\s]/gi, "").match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return null;
      const a = +m[1], b = m[2] != null ? +m[2] : null;
      if (a < 1 || (b != null && b < a)) return null;
      return b != null ? a + "-" + b + "×" : a + "×";
    },
    stack: v => { const n = _int(v); return n === 1 ? "No stacking — 1 per slot" : n > 1 ? "Stacks to " + n : null; },
    heals: v => { const n = _int(v); return n === 0 ? "Not edible" : n > 0 ? "Edible — heals " + n : null; },
    power: v => { const n = _int(v); return n >= 1 ? "Soap — power " + n : null; },
    secs: v => { const n = _num(v); return n > 0 ? fmtSecs(n * 1000) : null; },  // typed in seconds
  };
  // qty range formatter with a trailing unit ("2-4× per gather" etc.)
  const numQty = suffix => v => { const q = NUM.qty(v); return q ? q + " " + suffix : null; };

  const fmtSecs = ms => (ms >= 60000 ? Math.round(ms / 60000) + " min" : Math.round(ms / 1000) + " s");
  const pc = ch => Math.round((ch != null ? ch : 1) * 100) + "%";

  // ---- the monster's drop table as votable rows ----
  function dropRowsFor(def, rec) {
    const rows = [];
    const nm = id => (typeof ITEMS !== "undefined" && ITEMS[id] && ITEMS[id].name) || id;
    const b = def.butcher;
    if (b && b.meat) rows.push({ rid: b.item || "raw_meat", name: nm(b.item || "raw_meat"), qty: String(b.meat), ch: 100 });
    if (b && b.hide && b.hideItem) rows.push({ rid: b.hideItem, name: nm(b.hideItem), qty: String(b.hide), ch: 100 });
    for (const d of def.drops || [])
      rows.push({ rid: d.id, name: nm(d.id), qty: d.min === d.max ? String(d.min) : d.min + "-" + d.max, ch: Math.round((d.ch != null ? d.ch : 1) * 100) });
    for (const p of rec.props.drop_new || []) {
      // suggested items: match a real item by name for its icon, else plain text
      let itemId = null;
      if (typeof ITEMS !== "undefined")
        for (const id in ITEMS) if (ITEMS[id].name && ITEMS[id].name.toLowerCase() === p.label.toLowerCase()) { itemId = id; break; }
      rows.push({ rid: p.rid || p.id, name: p.label, qty: "1", ch: 0, suggested: true, pid: p.id, itemId });
    }
    return rows;
  }

  // spawn-biome list for a monster kind (mirrors bestiary's BIOME_MOB_NAMES scan)
  function monsterBiomes(kind) {
    if (typeof BIOME_MOB_NAMES === "undefined" || typeof slugify !== "function") return null;
    const base = kind.replace(/(_v)?(_baby)?$/, "");
    const out = new Set();
    for (const code in BIOME_MOB_NAMES)
      for (const disp of BIOME_MOB_NAMES[code]) {
        const k = slugify(disp);
        if (k === kind || k === base || k + "_v" === kind) out.add(code.charAt(0) + code.slice(1).toLowerCase());
      }
    return out.size ? [...out].sort() : null;
  }

  // canon display scale for the object, or 1 when unknown
  function scaleFor(desc) {
    if (desc.type === "monster" && typeof MONSTERS !== "undefined" && MONSTERS[desc.key] && MONSTERS[desc.key].scale) return MONSTERS[desc.key].scale;
    if (typeof OBJ_SCALE !== "undefined" && OBJ_SCALE && OBJ_SCALE[desc.key]) return OBJ_SCALE[desc.key];
    return 1;
  }

  // ---- attribute polls per object type ----
  // Each: { id, title, canon, extra:[presets], chips:bool, ph:custom-placeholder }
  function pollsFor(desc) {
    const P = [];
    const add = (id, title, canon, extra, opts) =>
      { if (canon != null) P.push(Object.assign({ id, title, canon: String(canon), extra: extra || [] }, opts || {})); };

    // scale — every object votes on how big it should be (terrain is flat, the
    // player has height/width polls instead, a roof is sized by its building)
    if (desc.type !== "terrain" && desc.type !== "player" && desc.type !== "roof") {
      // display-round the canon scale: float noise like 1.4649999999999999
      // (giant scales are products of two floats) must read as ×1.465
      const sc = +scaleFor(desc).toFixed(3);
      add("scale", "Scale", "×" + sc + (sc === 1 ? " (as generated)" : ""),
        [0.5, 0.75, 1, 1.25, 1.5, 2].filter(v => v !== sc).map(v => "×" + v),
        { chips: true, ph: "×…", num: NUM.scale });
    }

    if (desc.type === "monster") {
      const def = (typeof MONSTERS !== "undefined" && MONSTERS[desc.key]) || {};
      const lvl = def.lvl | 0;
      add("name", "Name", def.name || desc.name);
      // presets that collide with the current level are dropped (mkOpts dedupes
      // too, but these keep their (easier)/(tougher) tags honest)
      const easier = Math.max(1, Math.min(lvl - 1, Math.round(lvl * 0.75)));
      const tougher = Math.max(lvl + 1, Math.round(lvl * 1.25));
      add("level", "Level", "Level " + lvl,
        (easier < lvl ? ["Level " + easier + " (easier)"] : []).concat(["Level " + tougher + " (tougher)"]),
        { chips: true, ph: "level…", num: NUM.level });
      // aggression as a player-level threshold: attacks players BELOW the
      // threshold, so 1 = never (peaceful) and "any" = always aggressive
      add("aggression", "Aggression (attacks players below level…)",
        def.aggro ? "Any level — always aggressive" : "Level 1 — peaceful",
        ["Level 1 — peaceful", "Level " + Math.max(2, lvl * 2), "Level " + (lvl + 10), "Any level — always aggressive"],
        { chips: true, ph: "level…", num: NUM.level });
      add("temperament", "Temperament", "No special temperament",
        ["Skittish — flees when approached", "Territorial — attacks only if you linger",
         "Nocturnal — aggressive after dark", "Pack — calls nearby kin to help"]);
      add("animations", "Animations", def.dirSpr ? "8-direction walk cycle" : "Static billboard sprite",
        ["Add an idle animation", "Add an attack lunge", "Add a death animation"]);
      // husbandry behaviour for livestock species
      const base = desc.key.replace(/(_v)?(_baby)?$/, "");
      const acts = typeof HUSB_ACTIONS !== "undefined" && HUSB_ACTIONS[base];
      if (acts && acts.length)
        add("husbandry", "Husbandry behaviour",
          acts.map(a => a.name + " (Husbandry " + a.req + ")").join("; "),
          ["Produces more but recovers slower", "Needs feeding more often", "Roams further from its pasture",
           "Follows you after being fed", "Can be led home and penned"]);
    } else if (desc.type === "npc") {
      const def = typeof MIX_NPCS !== "undefined" && MIX_NPCS.list.find(d => d.key === desc.key);
      add("name", "Name", desc.name);
      if (def) add("title", "Title", def.title);
      if (def) add("dialogue", "Dialogue style", def.dlg, ["citizen", "warrior", "smith", "priest", "bard"].filter(o => o !== def.dlg));
      add("animations", "Animations", "8-direction walk cycle", ["Add an idle animation", "Add a work animation"]);
    } else if (desc.type === "item") {
      const it = (typeof ITEMS !== "undefined" && ITEMS[desc.key]) || {};
      add("name", "Name", it.name || desc.name);
      add("examine", "Examine text", (typeof EXAMINE !== "undefined" && EXAMINE[desc.key]) || it.name || desc.name);
      if (it.value != null) add("value", "Value", it.value + " coins",
        [Math.max(1, Math.round(it.value * 0.5)) + " coins (cheaper)", Math.round(it.value * 2) + " coins (pricier)"], { chips: true, ph: "coins…", num: NUM.coins });
      // equippable + which anatomical slot(s) (EQUIP_SLOTS roster, state.js);
      // paired/pouch slots are offered as one chip, exotic combos via custom
      const slots = it.equip ? (Array.isArray(it.equip) ? it.equip : [it.equip]) : null;
      const prettySlot = s => s === "rune" ? "rune pouch" : s.replace(/_/g, " ").replace(/[0-9]+$/, "").trim();
      // paired slots (pauldron1+pauldron2, bracelet1+2…) read as "both pauldrons"
      const slotText = ss => {
        const n = {};
        for (const s of ss.map(prettySlot)) n[s] = (n[s] || 0) + 1;
        return Object.keys(n).map(k => n[k] > 1 ? "both " + k + "s" : k).join(" + ");
      };
      add("equip", "Equippable (which slots)",
        slots ? slotText(slots) : "Not equippable",
        ["Not equippable", "weapon", "shield", "hair (headwear)", "face", "back of head", "neck", "cape",
         "torso", "arms (both)", "legs (both)", "feet (both)", "hands (both)", "bracelet", "anklet",
         "pauldrons (both)", "quiver", "rune pouch"], { chips: true, ph: "slot(s)…" });
      add("edible", "Edible",
        it.potion ? "Drinkable potion" + (it.potion.heal ? " — heals " + it.potion.heal : " — " + ((it.potion.buff || []).join("/") || "buff"))
          : it.heals ? "Edible — heals " + it.heals + (it.wellFed ? ", leaves you well fed" : "")
          : it.drinkBuff ? "Drinkable — " + it.drinkBuff.skill + " buff"
          : "Not edible",
        ["Not edible", "Edible — heals 3", "Edible — heals 10", "Edible — heals 25",
         "Edible — well-fed regen buff", "Drinkable — skill buff"], { chips: true, ph: "heals…", num: NUM.heals });
      add("soap", "Soap",
        it.soap ? "Yes — washes off stink" + (it.soap.power ? " (power " + it.soap.power + ")" : "") : "Not a soap",
        ["Not a soap", "Basic soap — washes off stink", "Strong soap",
         "Specialised — targets one stink flavour", "Perfumed — leaves a fragrance"], { chips: true, ph: "power…", num: NUM.power });
      add("stack", "Stack limit",
        it.stack ? "Stacks — no limit" : "No stacking — 1 per slot",
        ["No stacking — 1 per slot", "Stacks to 5", "Stacks to 20", "Stacks to 100", "Stacks — no limit"],
        { chips: true, ph: "limit…", num: NUM.stack });
    } else if (desc.type === "node") {
      const n = (typeof NODE_TYPES !== "undefined" && NODE_TYPES[desc.key]) || {};
      add("name", "Name", n.name || desc.name);
      if (n.req != null) add("req", "Required level", (n.skill || "Skill") + " " + n.req,
        [(n.skill || "Skill") + " " + Math.max(1, Math.round(n.req * 0.75)), (n.skill || "Skill") + " " + Math.round(n.req * 1.25 || 1)],
        { chips: true, ph: "level…", num: v => { const k = _int(v); return k >= 1 ? (n.skill || "Skill") + " " + k : null; } });
      if (n.item) add("yield", "Yield (per gather)", "1× " + ((typeof ITEMS !== "undefined" && ITEMS[n.item] && ITEMS[n.item].name) || n.item) + " per gather",
        ["1-2× per gather", "2-4× per gather", "5-10× per gather"],
        { chips: true, ph: "e.g. 2-4", num: numQty("per gather") });
      if (n.depleteCh != null) add("depletech", "Chance to deplete per gather", pc(n.depleteCh),
        ["0% (never depletes)", "25%", "50%", "100% (one gather each)"], { chips: true, ph: "%…", num: NUM.pct });
      add("gemch", "Bonus find chance (gems etc.)", n.gemCh != null ? pc(n.gemCh) : "0% (no bonus finds)",
        ["0% (no bonus finds)", "1%", "3%", "8%", "15%"], { chips: true, ph: "%…", num: NUM.pct });
      if (n.respawn) add("respawn", "Respawn time", fmtSecs(n.respawn),
        [fmtSecs(n.respawn / 2) + " (faster)", fmtSecs(n.respawn * 2) + " (slower)"],
        { chips: true, ph: "seconds…", num: NUM.secs });
    } else if (desc.type === "station") {
      const s = (typeof STATIONS !== "undefined" && STATIONS[desc.key]) || {};
      add("name", "Name", s.name || desc.name);
      if (s.action) add("action", "Action verb", s.action);
    } else if (desc.type === "crop") {
      const c = (typeof CROPS !== "undefined" && CROPS[desc.key]) || {};
      add("name", "Name", c.name || desc.name);
      if (c.time) add("time", "Growth time", fmtSecs(c.time),
        [fmtSecs(c.time / 2) + " (faster)", fmtSecs(c.time * 2) + " (slower)"],
        { chips: true, ph: "seconds…", num: NUM.secs });
      if (c.yield) add("yield", "Yield (per harvest)", c.yield[0] + "-" + c.yield[1] + "× per harvest",
        ["1× per harvest", "2-4× per harvest", "5-10× per harvest"],
        { chips: true, ph: "e.g. 2-4", num: numQty("per harvest") });
    } else if (desc.type === "decor") {
      add("name", "Name", (typeof decorName === "function" && decorName(desc.key)) || desc.name);
      add("examine", "Examine text", (typeof decorExamine === "function" && decorExamine(desc.key)) || "—");
    } else if (desc.type === "player") {
      const st = (typeof playerCharStats === "function" && playerCharStats()) || { h: 1, w: 1, speed: 1, tough: 0 };
      const mul = n => "×" + +(+n).toFixed(2);
      add("name", "Name", desc.name);
      add("height", "Height (build)", mul(st.h), ["×0.85", "×1", "×1.15"].filter(v => v !== mul(st.h)),
        { chips: true, ph: "×…", num: NUM.scale });
      add("width", "Width (build)", mul(st.w), ["×0.85", "×1", "×1.15"].filter(v => v !== mul(st.w)),
        { chips: true, ph: "×…", num: NUM.scale });
      add("speed", "Walk speed", mul(st.speed), ["×0.75", "×1", "×1.25", "×1.5"].filter(v => v !== mul(st.speed)),
        { chips: true, ph: "×…", num: NUM.scale });
      add("tough", "Toughness (damage shrug)", Math.round(st.tough * 100) + "%",
        ["0%", "10%", "25%"], { chips: true, ph: "%…", num: NUM.pct });
      add("animations", "Animations", "8-direction walk cycle",
        ["Add an idle animation", "Add a work animation", "Add a sit/rest pose"]);
    } else if (desc.type === "roof") {
      const nice = k => String(k).replace(/^roof_/, "").replace(/_/g, " ");
      const all = ["roof_brown", "roof_gray", "roof_red", "roof_teal", "roof_tower"];
      const cur = desc.spr || "roof_brown";
      add("name", "Name", desc.name);
      add("tiles", "Roof tiles", nice(cur), all.filter(k => k !== cur).map(nice),
        { chips: true, ph: "style…" });
      add("shape", "Roof shape", desc.spire ? "Tower spire" : "Gabled ridge",
        ["Gabled ridge", "Flat terrace", "Tower spire", "Hipped (sloped ends)"]);
      add("overhang", "Eaves overhang", "0 tiles (flush)",
        ["0 tiles (flush)", "0.5 tiles", "1 tile"], { chips: true, ph: "tiles…",
          num: v => { const n = _num(v); return n >= 0 && n <= 3 ? +n.toFixed(1) + (n === 1 ? " tile" : " tiles") : null; } });
    } else if (desc.type === "terrain") {
      const water = desc.x != null && typeof world !== "undefined" && world.isWater && world.isWater(desc.x, desc.y);
      add("name", "Name", desc.name);
      add("walkspeed", "Walk speed on this ground",
        water ? "Wading — slowed by water depth" : "100% (normal)",
        ["100% (normal)", "75% (heavy going)", "50% (mire)", "125% (springy turf)"],
        { chips: true, ph: "%…", num: NUM.pct });
      // how many art variants this ground family cycles through
      const m = /^bg_(\d+)/.exec(desc.key);
      let nv = m && typeof BIOME_GROUND_VARIANTS !== "undefined" && BIOME_GROUND_VARIANTS[+m[1]]
        ? BIOME_GROUND_VARIANTS[+m[1]].length : null;
      if (nv == null && typeof SPR !== "undefined") {
        const base = desc.key === "road" ? "dirt" : desc.key.split("#")[0];
        let c = 0;
        while (SPR[base + "#" + c]) c++;
        nv = c || null;
      }
      if (nv) add("variants", "Tile art variants", nv + " variants",
        [3, 6, 12].filter(v => v !== nv).map(v => v + " variants"),
        { chips: true, ph: "count…", num: v => { const k = _int(v); return k >= 1 ? k + " variants" : null; } });
    } else {  // structure / obstacle / anything else
      add("name", "Name", desc.name);
      add("examine", "Examine text", desc.exam || "—");
    }

    // doors & gates: opening + locking schedules
    if (desc.type === "structure" && (desc.key === "door" || desc.key === "gate")) {
      add("openclose", "Opens & closes",
        "Player-operated; NPCs shut it behind themselves",
        ["Stays exactly as left", "Auto-closes a few seconds after anyone passes",
         "Swings shut at dusk, opens at dawn", "Blows open in storms"]);
      add("locks", "Locks & unlocks",
        "Shop doors lock for the night; some doors need keys or ward-dispelling runes",
        ["Never locks", "Always locked — key holders only", "Locks whenever the owner is asleep",
         "Lockpickable at high Agility", "Unlocks for anyone the owner has traded with"]);
    }
    return P;
  }

  // generation polls (spawn rules) — for the types the world generator places.
  // Numeric wherever a number can carry the rule: rarity as a per-tile density,
  // latitude as %-of-the-way-to-the-pole bands (matching the sidebar's Lat %),
  // road/settlement proximity as tile distances.
  const GEN_TYPES = new Set(["monster", "node", "decor", "station", "crop", "obstacle"]);
  // "20-45" (± % signs/spaces) -> a latitude band label; the world's latitude
  // scale runs 0% = Fullnight Pole, 50% = equator, 100% = Fullday Pole
  const latBand = v => {
    const m = String(v).replace(/[%\s]/g, "").match(/^(\d{1,3})-(\d{1,3})$/);
    if (!m) return null;
    const a = +m[1], b = +m[2];
    return a < b && b <= 100 ? a + "-" + b + "% latitude" : null;
  };
  const perTiles = v => { const n = _int(v); return n >= 1 ? "1 per " + n + " tiles" : null; };
  function genPollsFor(desc) {
    if (!GEN_TYPES.has(desc.type)) return [];
    const P = [];
    const add = (id, title, canon, extra, opts) =>
      P.push(Object.assign({ id, title, canon: String(canon), extra }, opts || {}));
    const biomes = desc.type === "monster" ? monsterBiomes(desc.key) : null;
    add("gen_biomes", "Spawn biomes", biomes ? biomes.join(", ") : "As currently generated",
      ["Spread into neighbouring biomes", "Restrict to fewer biomes"]);
    P[P.length - 1].vocab = "biomes";   // suggestions must name real biomes
    add("gen_rarity", "Rarity (spawn density)", "As currently generated",
      ["1 per 25 tiles (very common)", "1 per 100 tiles (common)", "1 per 500 tiles (uncommon)",
       "1 per 2500 tiles (rare)", "1 per 10000 tiles (legendary)"],
      { chips: true, ph: "tiles…", num: perTiles });
    add("gen_lat", "Latitudes (0% = Fullnight Pole, 50% = equator, 100% = Fullday Pole)",
      "0-100% latitude (everywhere)",
      ["35-65% latitude (equatorial)", "0-25% latitude (near the Fullnight Pole)",
       "75-100% latitude (near the Fullday Pole)", "25-75% latitude (away from both poles)"],
      { chips: true, ph: "e.g. 20-45", num: latBand });
    add("gen_prox", "Roads & settlements",
      desc.type === "monster"
        ? "Any distance; peaceful within 6 tiles of a road or settlement edge"
        : "No distance rule",
      ["No distance rule — spawns anywhere",
       "Within 10 tiles of a road", "At least 30 tiles from any road",
       "Within 20 tiles of a settlement", "At least 50 tiles from any settlement"]);
    add("gen_weather", "Time & weather rules", "No special rules",
      ["Appears only at night", "Appears only by day", "More common in rain", "Hides away in rain",
       "Only in snow or winter cold", "Vanishes during storms"]);
    return P;
  }

  // ---- panel DOM (self-contained: injected styles + lazily-built overlay) ----
  const CSS = `
#objedit { position: absolute; inset: 0; display: none; z-index: 64; background: rgba(16,12,22,0.96); flex-direction: column; color: #d8d2e8; }
#objedit.open { display: flex; }
#objedit-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; color: #ffe97a; font-size: 16px; font-weight: bold; border-bottom: 1px solid #3a3050; letter-spacing: 1px; }
#objedit-head .oe-type { font-size: 11px; font-weight: normal; letter-spacing: 0; color: #a99ec9; border: 1px solid #3a3050; border-radius: 9px; padding: 1px 8px; text-transform: capitalize; margin-right: auto; }
#objedit-head button { background: none; border: 1px solid #3a3050; color: #d8d2e8; border-radius: 4px; cursor: pointer; font-size: 14px; padding: 2px 8px; }
#objedit-export { font-size: 11px !important; color: #a99cc4 !important; white-space: nowrap; }
#objedit-export:hover { background: #453a58 !important; color: #fff !important; }
#objedit-submit { font-size: 11px !important; color: #ffd75e !important; border-color: #6a5a2a !important; white-space: nowrap; }
#objedit-submit:hover { background: #4a3f22 !important; color: #fff !important; }
.oe-count { font-size: 9px; color: #100c18; background: #8fd18f; border-radius: 8px; padding: 0 5px; margin-left: 5px; font-weight: bold; vertical-align: 1px; }
#objedit-body { overflow-y: auto; padding: 12px 16px 24px; flex: 1; }
#objedit-body h3 { color: #ffe97a; font-size: 13px; letter-spacing: 1px; margin: 18px 0 8px; text-transform: uppercase; }
#objedit-body .oe-intro { color: #a99ec9; font-size: 12px; margin: 2px 0 6px; }
.oe-card { border: 1px solid #3a3050; border-radius: 6px; padding: 8px 10px; margin: 8px 0; background: rgba(255,255,255,0.02); }
.oe-card.voted { border-color: #ffe97a; box-shadow: 0 0 6px rgba(255,233,122,0.25); }
.oe-card-top { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 6px; }
.oe-card-top .oe-tag { font-size: 10px; color: #8fd18f; border: 1px solid #2e4a2e; border-radius: 8px; padding: 0 6px; }
.oe-card-top .oe-del { margin-left: auto; background: none; border: none; color: #c98c8c; cursor: pointer; font-size: 13px; }
.oe-strip { display: flex; gap: 6px; flex-wrap: wrap; }
.oe-cell { text-align: center; }
.oe-cell canvas, .oe-cell img { width: ${PX}px; height: ${PX}px; image-rendering: pixelated; background: rgba(255,255,255,0.04); border: 1px solid #2a2340; border-radius: 4px; display: block; }
.oe-cell span { font-size: 10px; color: #a99ec9; }
.oe-matrix { display: flex; flex-direction: column; gap: 3px; }
.oe-matrix .oe-strip { flex-wrap: nowrap; gap: 3px; }
.oe-matrix .oe-cell canvas, .oe-matrix .oe-cell img { width: 44px; height: 44px; }
.oe-rowlab { font-size: 10px; color: #a99ec9; width: 48px; flex: none; align-self: center; }
.oe-note { font-size: 11px; color: #a99ec9; font-style: italic; margin-top: 4px; }
.oe-votebtn { margin-top: 8px; background: #241d38; border: 1px solid #3a3050; color: #d8d2e8; border-radius: 4px; padding: 3px 12px; cursor: pointer; font-size: 12px; }
.oe-votebtn.on { background: #3d3418; border-color: #ffe97a; color: #ffe97a; }
.oe-poll { margin: 10px 0 14px; }
.oe-poll .oe-ptitle { font-size: 13px; color: #e8e2f8; font-weight: bold; margin-bottom: 4px; }
.oe-opt { display: flex; align-items: center; gap: 8px; padding: 4px 8px; margin: 3px 0; border: 1px solid #2a2340; border-radius: 4px; cursor: pointer; font-size: 12px; }
.oe-opt:hover { border-color: #4a4066; }
.oe-opt.voted { border-color: #ffe97a; background: rgba(255,233,122,0.07); }
.oe-opt .oe-radio { width: 12px; height: 12px; border: 1px solid #6a6088; border-radius: 50%; flex: none; }
.oe-opt.voted .oe-radio { background: #ffe97a; border-color: #ffe97a; }
.oe-opt .oe-cur { font-size: 10px; color: #8fd18f; }
.oe-opt .oe-del { margin-left: auto; background: none; border: none; color: #c98c8c; cursor: pointer; }
.oe-chips { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.oe-chip { border: 1px solid #2a2340; border-radius: 10px; padding: 1px 9px; cursor: pointer; font-size: 11px; color: #d8d2e8; background: rgba(255,255,255,0.02); white-space: nowrap; }
.oe-chip:hover { border-color: #4a4066; }
.oe-chip.voted { border-color: #ffe97a; background: rgba(255,233,122,0.12); color: #ffe97a; }
.oe-chip .oe-cur { font-size: 9px; color: #8fd18f; margin-left: 3px; }
.oe-chip .oe-x { color: #c98c8c; margin-left: 4px; }
.oe-chipin { width: 64px; background: #171226; border: 1px solid #3a3050; color: #d8d2e8; border-radius: 10px; padding: 1px 8px; font-size: 11px; }
.oe-chipin.oe-bad { border-color: #c95c5c; box-shadow: 0 0 4px rgba(201,92,92,0.4); }
.oe-droprow { display: flex; align-items: center; gap: 8px; padding: 6px 8px; margin: 4px 0; border: 1px solid #2a2340; border-radius: 5px; flex-wrap: wrap; }
.oe-droprow canvas { width: 24px; height: 24px; image-rendering: pixelated; flex: none; }
.oe-droprow .oe-dname { font-size: 12px; min-width: 110px; font-weight: bold; }
.oe-droprow .oe-dgrp { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.oe-droprow .oe-dlab { font-size: 10px; color: #a99ec9; }
.oe-droprow .oe-del { background: none; border: none; color: #c98c8c; cursor: pointer; margin-left: auto; }
.oe-suggest { display: flex; gap: 6px; margin-top: 4px; }
.oe-suggest input[type=text] { flex: 1; background: #171226; border: 1px solid #3a3050; color: #d8d2e8; border-radius: 4px; padding: 3px 8px; font-size: 12px; }
.oe-suggest input.oe-bad { border-color: #c95c5c; box-shadow: 0 0 4px rgba(201,92,92,0.4); }
.oe-suggest button, .oe-upload button { background: #241d38; border: 1px solid #3a3050; color: #d8d2e8; border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
.oe-upload { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
.oe-upload input[type=text] { background: #171226; border: 1px solid #3a3050; color: #d8d2e8; border-radius: 4px; padding: 3px 8px; font-size: 12px; width: 140px; }
`;

  let panel = null, cur = null;
  function build() {
    if (panel) return;
    const st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);
    panel = document.createElement("div");
    panel.id = "objedit";
    panel.innerHTML = `<div id="objedit-head"><span id="objedit-title"></span><span class="oe-type" id="objedit-type"></span><button id="objedit-submit" style="display:none" title="Send your votes, suggestions and art for this object straight to the community workshop (CC BY-SA 4.0)">Submit proposal</button><button id="objedit-export" title="Bundle your votes and proposals for this object into a file you can submit">Export my proposal</button><button id="objedit-close" title="Close (Esc)">✕</button></div><div id="objedit-body"></div>`;
    (document.getElementById("gamecol") || document.body).appendChild(panel);
    panel.querySelector("#objedit-close").onclick = close;
    panel.querySelector("#objedit-export").onclick = exportProposal;
    panel.querySelector("#objedit-submit").onclick = submitProposal;
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && isOpen()) {
        // Escape while typing in one of the panel's fields cancels that edit —
        // let the event continue to the field's own handler (no stopPropagation,
        // which would block the target phase too), just don't close the panel
        if (e.target && e.target.tagName === "INPUT" && panel.contains(e.target)) return;
        e.stopPropagation(); close();
      }
    }, true);
  }

  const el = (tag, cls, text) => { const d = document.createElement(tag); if (cls) d.className = cls; if (text != null) d.textContent = text; return d; };

  // toggle-vote + persist + re-render (keeping scroll position)
  function vote(rec, pid, optId) {
    if (rec.votes[pid] === optId) delete rec.votes[pid];
    else rec.votes[pid] = optId;
    saveStore(); render();
  }
  function addProp(rec, pid, label) {
    (rec.props[pid] = rec.props[pid] || []).push({ id: "p" + Date.now() + Math.floor(Math.random() * 1e3), label });
    saveStore(); render();
  }
  // submit helper for suggest inputs: vocab-constrained fields only accept (and
  // canonicalise the casing of) existing game names; anything else flags the
  // input red and warns instead of adding
  function suggestSubmit(inp, vocab, commit) {
    const v = inp.value.trim();
    if (!v) return;
    if (vocab) {
      const canon = vocabMatch(vocab, v);
      if (!canon) {
        inp.classList.add("oe-bad");
        if (typeof log === "function") log(VOCAB_WARN[vocab], "warn");
        return;
      }
      commit(canon);
    } else commit(v);
  }
  function wireVocab(inp, vocab) {
    if (!vocab) return;
    inp.setAttribute("list", datalistFor(vocab));
    inp.addEventListener("input", () => inp.classList.remove("oe-bad"));
  }
  function delProp(rec, pid, propId) {
    rec.props[pid] = (rec.props[pid] || []).filter(p => p.id !== propId);
    if (rec.votes[pid] === propId) delete rec.votes[pid];
    saveStore(); render();
  }

  // compact chip strip for one poll: click to vote/unvote, "+" for a custom
  // value. `num` (a NUM formatter) makes the custom input numbers-only: typing
  // is live-filtered to digits, invalid values flag red instead of adding, and
  // accepted values are rewritten to the poll's canonical label form.
  function chipStrip(rec, pid, opts, ph, num) {
    const wrap = el("div", "oe-chips");
    // community tally for this object (net/worksync.js): player-made options
    // count under "custom:<label>" so identical suggestions pool together
    const tallied = cur && typeof WorkSync !== "undefined"
      ? WorkSync.getCached(cur.type + ":" + cur.key) : null;
    const fieldTally = tallied && tallied[pid];
    for (const o of opts) {
      const voted = rec.votes[pid] === o.id;
      const c = el("span", "oe-chip" + (voted ? " voted" : ""), o.label);
      const nVotes = fieldTally && fieldTally[o.mine ? "custom:" + o.label : o.id];
      if (nVotes) {
        const badge = el("span", "oe-count", String(nVotes));
        badge.title = nVotes + (nVotes === 1 ? " community vote" : " community votes");
        c.appendChild(badge);
      }
      if (o.canon) c.appendChild(el("span", "oe-cur", "current"));
      if (o.mine) {
        const x = el("span", "oe-x", "✕");
        x.onclick = e => { e.stopPropagation(); delProp(rec, pid, o.id); };
        c.appendChild(x);
      }
      c.onclick = () => vote(rec, pid, o.id);
      wrap.appendChild(c);
    }
    const plus = el("span", "oe-chip", "+");
    plus.title = "Suggest your own";
    plus.onclick = () => {
      const inp = document.createElement("input");
      inp.type = "text"; inp.className = "oe-chipin"; inp.placeholder = ph || "…";
      if (num) inp.inputMode = "decimal";
      const commit = () => {
        const v = inp.value.trim();
        if (!v) { render(); return; }
        if (num) {
          const lab = num(v);
          if (lab == null) { inp.classList.add("oe-bad"); return; }
          addProp(rec, pid, lab);
        } else addProp(rec, pid, v);
      };
      inp.oninput = () => {
        // numeric fields: live-strip anything that isn't part of a number
        if (num) inp.value = inp.value.replace(/[^0-9.\-\sx×%]/gi, "");
        inp.classList.remove("oe-bad");
      };
      inp.onkeydown = e => { e.stopPropagation(); if (e.key === "Enter") commit(); if (e.key === "Escape") render(); };
      inp.onblur = commit;
      wrap.replaceChild(inp, plus);
      inp.focus();
    };
    wrap.appendChild(plus);
    return wrap;
  }

  function render() {
    if (!cur) return;   // a stray re-render after close must not throw
    const desc = cur, rec = recFor(desc);
    panel.querySelector("#objedit-title").textContent = "Edit — " + desc.name;
    panel.querySelector("#objedit-type").textContent = desc.type;
    const body = panel.querySelector("#objedit-body");
    const keepScroll = body.scrollTop;
    body.innerHTML = "";
    const logged = typeof Server !== "undefined" && Server.logged();
    panel.querySelector("#objedit-submit").style.display = logged ? "" : "none";
    body.appendChild(el("div", "oe-intro",
      "The community workshop: vote on how this object should look, behave and generate, or propose your own take. " +
      (logged
        ? "Your votes count into the community tally — the small numbers are everyone's votes so far. Votes can be changed at any time."
        : typeof Server !== "undefined" && Server.enabled()
          ? "Votes are saved on this device; log in on the Account tab to have them counted with everyone else's."
          : "Votes are saved on this device and can be changed at any time.") +
      " Proposed art shows only here — the in-game sprites don't change."));
    if (typeof ProposalOverlay !== "undefined") {
      const cu = ProposalOverlay.credit(desc.type + ":" + desc.key);
      if (cu) body.appendChild(el("div", "oe-intro", `Community art by @${cu} — made in the Taiao Workshop.`));
    }

    // ---- sprite variant sections (standard / tended / baby) ----
    for (const variant of variantsFor(desc)) {
      body.appendChild(el("h3", null, variant.title));
      if (variant.blurb) body.appendChild(el("div", "oe-intro", variant.blurb));
      const vId = variant.voteId;
      const spriteCard = (id, title, tag, fill, removable) => {
        const card = el("div", "oe-card" + (rec.votes[vId] === id ? " voted" : ""));
        const top = el("div", "oe-card-top");
        top.appendChild(el("b", null, title));
        const tallied = typeof WorkSync !== "undefined" ? WorkSync.getCached(desc.type + ":" + desc.key) : null;
        const nVotes = tallied && tallied[vId] && tallied[vId][removable ? "upload:" + title : id];
        if (nVotes) {
          const badge = el("span", "oe-count", String(nVotes));
          badge.title = nVotes + (nVotes === 1 ? " community vote" : " community votes");
          top.appendChild(badge);
        }
        if (tag) top.appendChild(el("span", "oe-tag", tag));
        if (removable) {
          const del = el("button", "oe-del", "✕ remove");
          del.onclick = () => {
            rec.sprites = rec.sprites.filter(s => s.id !== id);
            if (rec.votes[vId] === id) delete rec.votes[vId];
            saveStore(); render();
          };
          top.appendChild(del);
        }
        card.appendChild(top);
        fill(card);
        const vb = el("button", "oe-votebtn" + (rec.votes[vId] === id ? " on" : ""),
          rec.votes[vId] === id ? "✓ Your pick — click to clear" : "Vote for this set");
        vb.onclick = () => vote(rec, vId, id);
        card.appendChild(vb);
        body.appendChild(card);
      };

      // current in-game art (+ any alternative canon-art cards, e.g. the
      // hand-made spent pose the tinted dir frames replaced)
      const fillFrames = (card, fs) => {
        if (fs.draw.length) {
          const strip = el("div", "oe-strip");
          fs.draw.forEach((drawFn, i) => {
            const cell = el("div", "oe-cell");
            const cv = document.createElement("canvas");
            drawFn(cv);
            cell.appendChild(cv);
            cell.appendChild(el("span", null, fs.labels[i]));
            strip.appendChild(cell);
          });
          card.appendChild(strip);
        }
        if (fs.note) card.appendChild(el("div", "oe-note", fs.note));
      };
      // walk-cycle matrix: 8 direction columns × ANIM_ROWS frame rows. The
      // canon matrix repeats the current 8-sprite set on every row.
      const matrixRow = (wrap, r, cellFor) => {
        const strip = el("div", "oe-strip");
        strip.appendChild(el("span", "oe-rowlab", "frame " + (r + 1)));
        for (let i = 0; i < 8; i++) {
          const cell = cellFor(i);
          if (!cell) break;
          if (r === 0) cell.appendChild(el("span", null, DSHORT[D8[i]]));
          strip.appendChild(cell);
        }
        wrap.appendChild(strip);
      };
      const fillMatrix = (card, fs) => {
        const wrap = el("div", "oe-matrix");
        for (let r = 0; r < ANIM_ROWS; r++)
          matrixRow(wrap, r, i => {
            const cell = el("div", "oe-cell");
            const cv = document.createElement("canvas");
            fs.draw[i](cv);
            cell.appendChild(cv);
            return cell;
          });
        card.appendChild(wrap);
        card.appendChild(el("div", "oe-note", "Currently every frame row repeats the same standing sprite — there are no in-between walk frames yet."));
      };
      const fillMatrixImgs = (card, imgs) => {
        const wrap = el("div", "oe-matrix");
        for (let r = 0; r * 8 < imgs.length; r++)
          matrixRow(wrap, r, i => {
            if (r * 8 + i >= imgs.length) return null;
            const cell = el("div", "oe-cell");
            const img = document.createElement("img");
            img.src = imgs[r * 8 + i];
            cell.appendChild(img);
            return cell;
          });
        card.appendChild(wrap);
      };
      spriteCard("canon", variant.canonTitle || "Current in-game art", "current",
        card => variant.matrix ? fillMatrix(card, variant.fs) : fillFrames(card, variant.fs));
      for (const alt of variant.altCards || [])
        spriteCard(alt.id, alt.title, alt.tag, card => fillFrames(card, alt.fs));

      // proposed / uploaded sets for this variant (older saves had no variant → std)
      for (const set of rec.sprites.filter(s => (s.variant || "std") === variant.vid)) {
        spriteCard(set.id, set.label || "Proposed set", "proposed", card => {
          if (variant.matrix) { fillMatrixImgs(card, set.imgs); return; }
          const strip = el("div", "oe-strip");
          set.imgs.forEach((src, i) => {
            const cell = el("div", "oe-cell");
            const img = document.createElement("img");
            img.src = src;
            cell.appendChild(img);
            cell.appendChild(el("span", null, set.imgs.length === 8 && desc.type !== "terrain" && desc.type !== "roof" ? DSHORT[D8[i]] : "#" + (i + 1)));
            strip.appendChild(cell);
          });
          card.appendChild(strip);
        }, true);
      }

      // upload a new set into this variant
      const up = el("div", "oe-card");
      up.appendChild(el("div", "oe-card-top")).appendChild(el("b", null, desc.type === "item" ? "Upload your own icon" : "Upload your own set"));
      up.appendChild(el("div", "oe-note", variant.matrix
        ? "Pick one sheet image laid out 8 columns (S…SW) × " + ANIM_ROWS + " frame rows, or up to " + ANIM_ROWS * 8 + " frame images row by row. Shown here only — never changes in-game art."
        : desc.type === "item"
        ? "Pick an icon image (up to 8 variants). Shown here only — never changes in-game art."
        : desc.type === "terrain" || desc.type === "roof" || variant.vid === "blocks" || variant.vid === "parapet"
        ? "Pick up to 8 tile-variant images. Shown here only — never changes in-game art."
        : "Pick 8 images (S, SE, E, NE, N, NW, W, SW), or one horizontal 8-frame strip. Shown here only — never changes in-game art."));
      const row = el("div", "oe-upload");
      const nameIn = document.createElement("input");
      nameIn.type = "text"; nameIn.placeholder = "Set name (optional)";
      const fileIn = document.createElement("input");
      fileIn.type = "file"; fileIn.accept = "image/*"; fileIn.multiple = true; fileIn.style.display = "none";
      const pick = el("button", null, "Choose images…");
      pick.onclick = () => fileIn.click();
      fileIn.onchange = () => importFiles([...fileIn.files], nameIn.value.trim(), rec, variant.vid, variant.matrix);
      row.appendChild(nameIn); row.appendChild(pick); row.appendChild(fileIn);
      up.appendChild(row);
      body.appendChild(up);
    }

    // ---- monster drop table: per-item quantity + chance votes ----
    if (desc.type === "monster" && typeof MONSTERS !== "undefined" && MONSTERS[desc.key]) {
      body.appendChild(el("h3", null, "Drop table"));
      body.appendChild(el("div", "oe-intro", "Vote per item: how many should drop, and how often. 0% means it shouldn't drop at all. Suggest new drops below."));
      for (const drow of dropRowsFor(MONSTERS[desc.key], rec)) {
        const r = el("div", "oe-droprow");
        const iconKey = drow.itemId != null
          ? (ITEMS[drow.itemId] && ITEMS[drow.itemId].icon)
          : (typeof ITEMS !== "undefined" && ITEMS[drow.rid] && ITEMS[drow.rid].icon);
        if (iconKey && typeof SPR !== "undefined" && SPR[iconKey]) {
          const cv = document.createElement("canvas");
          drawKeys(cv, [iconKey], 24);
          r.appendChild(cv);
        }
        r.appendChild(el("span", "oe-dname", drow.name + (drow.suggested ? " (suggested)" : "")));
        const qg = el("span", "oe-dgrp");
        qg.appendChild(el("span", "oe-dlab", "Qty:"));
        qg.appendChild(chipStrip(rec, "dropq:" + drow.rid,
          mkOpts(drow.qty + "×", ["1×", "1-2×", "2-4×", "5-10×"], rec.props["dropq:" + drow.rid]), "e.g. 2-3×", NUM.qty));
        r.appendChild(qg);
        const fg = el("span", "oe-dgrp");
        fg.appendChild(el("span", "oe-dlab", "Chance:"));
        fg.appendChild(chipStrip(rec, "dropf:" + drow.rid,
          mkOpts(drow.ch + "%", ["0% (never)", "5%", "25%", "50%", "100%"], rec.props["dropf:" + drow.rid]), "e.g. 15%", NUM.pct));
        r.appendChild(fg);
        if (drow.suggested) {
          const del = el("button", "oe-del", "✕");
          del.title = "Withdraw suggestion";
          del.onclick = () => delProp(rec, "drop_new", drow.pid);
          r.appendChild(del);
        }
        body.appendChild(r);
      }
      const sug = el("div", "oe-suggest");
      const inp = document.createElement("input");
      inp.type = "text"; inp.placeholder = "Suggest a new drop item (existing items only — start typing)…";
      wireVocab(inp, "items");
      const btn = el("button", null, "Add");
      const submit = () => suggestSubmit(inp, "items", v => addProp(rec, "drop_new", v));
      btn.onclick = submit;
      inp.onkeydown = e => { e.stopPropagation(); if (e.key === "Enter") submit(); };
      sug.appendChild(inp); sug.appendChild(btn);
      body.appendChild(sug);
    }

    // ---- attribute + generation polls ----
    const renderPolls = (title, polls) => {
      if (!polls.length) return;
      body.appendChild(el("h3", null, title));
      for (const poll of polls) {
        const wrap = el("div", "oe-poll");
        wrap.appendChild(el("div", "oe-ptitle", poll.title));
        const opts = mkOpts(poll.canon, poll.extra, rec.props[poll.id]);
        if (poll.chips) {
          wrap.appendChild(chipStrip(rec, poll.id, opts, poll.ph, poll.num));
        } else {
          for (const o of opts) {
            const voted = rec.votes[poll.id] === o.id;
            const r = el("div", "oe-opt" + (voted ? " voted" : ""));
            r.appendChild(el("span", "oe-radio"));
            r.appendChild(el("span", null, o.label));
            if (o.canon) r.appendChild(el("span", "oe-cur", "(current)"));
            if (o.mine) {
              const del = el("button", "oe-del", "✕");
              del.onclick = e => { e.stopPropagation(); delProp(rec, poll.id, o.id); };
              r.appendChild(del);
            }
            r.onclick = () => vote(rec, poll.id, o.id);
            wrap.appendChild(r);
          }
          const sug = el("div", "oe-suggest");
          const inp = document.createElement("input");
          inp.type = "text";
          inp.placeholder = poll.vocab === "biomes"
            ? "Suggest biomes (existing only, comma-separate several)…"
            : "Suggest your own " + poll.title.toLowerCase() + "…";
          wireVocab(inp, poll.vocab);
          const btn = el("button", null, "Add");
          const submit = () => suggestSubmit(inp, poll.vocab, v => addProp(rec, poll.id, v));
          btn.onclick = submit;
          inp.onkeydown = e => { e.stopPropagation(); if (e.key === "Enter") submit(); };
          sug.appendChild(inp); sug.appendChild(btn);
          wrap.appendChild(sug);
        }
        body.appendChild(wrap);
      }
    };
    renderPolls("Attributes", pollsFor(desc));
    renderPolls("Generation", genPollsFor(desc));

    body.scrollTop = keepScroll;
  }

  // ---- uploads: image files -> 64px dataURL frames ----
  // Plain sets: 1-8 files, or one image at least 8x wider than tall (an
  // 8-frame strip). Matrix sets (walk-cycle animation): one sheet sliced as
  // an 8-column x ANIM_ROWS-row grid, or up to 48 frame files in row order.
  function importFiles(files, label, rec, variant, matrix) {
    if (!files.length) return;
    files = files.slice(0, matrix ? ANIM_ROWS * 8 : 8);
    const loadImg = file => new Promise(res => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = url;
    });
    const toFrame = (img, sx, sy, sw, sh) => {
      const cv = document.createElement("canvas");
      cv.width = 64; cv.height = 64;
      const c2 = cv.getContext("2d");
      c2.imageSmoothingEnabled = false;
      c2.drawImage(img, sx, sy, sw, sh, 0, 0, 64, 64);
      return cv.toDataURL("image/png");
    };
    Promise.all(files.map(loadImg)).then(imgs => {
      imgs = imgs.filter(Boolean);
      if (!imgs.length) { if (typeof log === "function") log("Couldn't read those image files.", "warn"); return; }
      let frames;
      if (matrix && imgs.length === 1) {
        // one sheet: slice the 8-wide x ANIM_ROWS-tall grid, row-major
        const img = imgs[0];
        const fw = Math.floor(img.naturalWidth / 8), fh = Math.floor(img.naturalHeight / ANIM_ROWS);
        if (!fw || !fh) { if (typeof log === "function") log("That sheet is too small to slice into an 8×" + ANIM_ROWS + " grid.", "warn"); return; }
        frames = [];
        for (let r = 0; r < ANIM_ROWS; r++)
          for (let c = 0; c < 8; c++) frames.push(toFrame(img, c * fw, r * fh, fw, fh));
      } else if (!matrix && imgs.length === 1 && imgs[0].naturalWidth >= imgs[0].naturalHeight * 8) {
        const fw = Math.floor(imgs[0].naturalWidth / 8);
        frames = D8.map((_, i) => toFrame(imgs[0], i * fw, 0, fw, imgs[0].naturalHeight));
      } else {
        frames = imgs.map(img => toFrame(img, 0, 0, img.naturalWidth, img.naturalHeight));
      }
      rec.sprites.push({ id: "u" + Date.now(), label: label || (matrix ? "My matrix" : "My set"), variant: variant || "std", imgs: frames });
      saveStore(); render();
      if (typeof log === "function") log((matrix ? "Animation matrix" : "Sprite set") + " added to the workshop (display-only).", "sys");
    });
  }

  // ---- public API ----
  function open(desc) {
    build();
    cur = desc;
    panel.classList.add("open");
    panel.querySelector("#objedit-body").scrollTop = 0;
    render();
    // fetch the community tally in the background; re-render when it lands
    if (typeof WorkSync !== "undefined")
      WorkSync.ensure(desc.type + ":" + desc.key, () => { if (isOpen() && cur === desc) render(); });
  }
  function close() { if (panel) panel.classList.remove("open"); cur = null; }
  function isOpen() { return !!panel && panel.classList.contains("open"); }

  window.ObjEdit = { open, close, isOpen };
  // reused by the Bifrost graduation cinematic (gameplay/bifrost.js) to draw
  // the player's own character sprite floating centre-screen
  window.drawPlayerFrame = drawPlayerFrame;
})();
