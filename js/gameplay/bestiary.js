// ===== Taiao — in-game bestiary =====
// A browsable catalogue of every creature: sprite, level, spawn biomes and drop
// table. Without cheat mode you only see creatures you've SLAIN (player.kills,
// recorded in combat.js killMonster). With DEV_MODE on, every creature shows.
// Opened from the sidebar "Bestiary" button or the B key.
"use strict";

(function () {
  // ---- pretty biome names (BIOME_MOB_NAMES keys are terrain codes) ----
  const BIOME_PRETTY = {
    DEEP: "Deep ocean", WATER: "Ocean", REEF: "Reef", SAND: "Beach", GRASS: "Grassland",
    FOREST: "Forest", SWAMP: "Swamp", DESERT: "Desert", ROCK: "Mountains", SNOW: "Snowfield",
    TUNDRA: "Tundra", FARM: "Farmland", BADLANDS: "Badlands", JUNGLE: "Jungle", MEADOW: "Meadow",
    SAVANNA: "Savanna", ROCKY: "Rocky hills", LABYRINTH: "Labyrinth", VOLCANO: "Volcano",
    WILD: "Wildlands", TAIGA: "Taiga", OASIS: "Oasis", RUINSB: "Ruins", SALT: "Salt flats",
    WETLAND: "Wetland", CANYON: "Canyon", STEPPE: "Steppe", REDDESERT: "Red desert",
    MUSHROOM: "Mushroom forest", BONE: "Bonelands", DREAM: "Dreamwood", ASH: "Ashlands",
    MOOR: "Moor", GLACIER: "Glacier", BAMBOO: "Bamboo grove", CHERRY: "Cherry grove",
    CRYSTAL: "Crystal caverns",
  };
  const prettyBiome = code => BIOME_PRETTY[code] || (code.charAt(0) + code.slice(1).toLowerCase());

  // ---- kind -> sorted list of spawn-biome names (built once) ----
  let _biomeIndex = null;
  function biomeIndex() {
    if (_biomeIndex) return _biomeIndex;
    const idx = {};
    if (typeof BIOME_MOB_NAMES !== "undefined" && typeof slugify === "function") {
      for (const code in BIOME_MOB_NAMES) {
        for (const disp of BIOME_MOB_NAMES[code]) {
          const k = slugify(disp);
          for (const key of [k, k + "_v"]) {
            if (typeof MONSTERS !== "undefined" && MONSTERS[key]) (idx[key] = idx[key] || new Set()).add(prettyBiome(code));
          }
        }
      }
    }
    _biomeIndex = idx;
    return idx;
  }

  // ---- a monster's drop table as {id, text} rows (icon + label per line) ----
  function dropList(def) {
    const out = [];
    const b = def.butcher;
    if (b) {
      if (b.meat) { const id = b.item || "raw_meat"; out.push({ id, text: `${b.meat}× ${itemName(id)}` }); }
      if (b.hide && b.hideItem) out.push({ id: b.hideItem, text: `${b.hide}× ${itemName(b.hideItem)}` });
    }
    for (const d of (def.drops || [])) {
      const qty = d.min === d.max ? `${d.min}` : `${d.min}-${d.max}`;
      const ch = d.ch != null ? ` (${Math.round(d.ch * 100)}%)` : "";
      out.push({ id: d.id, text: `${qty}× ${itemName(d.id)}${ch}` });
    }
    return out;
  }
  const itemName = id => (typeof ITEMS !== "undefined" && ITEMS[id] && ITEMS[id].name) || id;

  // ---- the first drawable sprite key for a monster ----
  function sprKeyOf(def) {
    const s = def.spr;
    if (Array.isArray(s) && Array.isArray(s[0]) && typeof s[0][0] === "string") return s[0][0];
    return null;
  }

  // ---- assemble every catalogued creature (excludes husbandry babies) ----
  function entries() {
    const rows = [];
    const idx = biomeIndex();
    for (const kind in MONSTERS) {
      if (/_baby$/.test(kind)) continue;            // young livestock, not huntable fauna
      const def = MONSTERS[kind];
      if (!def || !def.name) continue;
      rows.push({
        kind, name: def.name, lvl: def.lvl | 0,
        biomes: [...(idx[kind] || [])].sort(),
        drops: dropList(def),
        kills: (player.kills && player.kills[kind]) || 0,
      });
    }
    rows.sort((a, b) => (a.lvl - b.lvl) || a.name.localeCompare(b.name));
    return rows;
  }

  let _search = "", _biome = "";
  // fill the biome dropdown once, with every biome that has at least one creature
  function populateBiomes() {
    const sel = document.getElementById("bestiary-biome");
    if (!sel || sel.dataset.filled) return;
    const set = new Set();
    for (const e of entries()) for (const b of e.biomes) set.add(b);
    for (const name of [...set].sort()) {
      const o = document.createElement("option"); o.value = name; o.textContent = name; sel.appendChild(o);
    }
    sel.dataset.filled = "1";
  }

  function openBestiary() {
    const cheat = typeof DEV_MODE !== "undefined" && DEV_MODE;
    const body = document.getElementById("bestiary-body");
    populateBiomes();
    const all = entries();
    const total = all.length;
    const discovered = all.filter(e => e.kills > 0).length;
    const q = _search.trim().toLowerCase();
    // visible = killed ones (or all in cheat), then biome + search filters
    let vis = all.filter(e => cheat || e.kills > 0);
    if (_biome) vis = vis.filter(e => e.biomes.includes(_biome));
    if (q) vis = vis.filter(e => e.name.toLowerCase().includes(q) || e.biomes.some(b => b.toLowerCase().includes(q)));

    let html = `<div class="bintro">Discovered <b>${discovered}</b> of <b>${total}</b> creatures.` +
      (cheat ? ` <span style="color:#ffb0b0">[DEV] all creatures shown.</span>` : ` Slay a creature to add it to your bestiary.`) + `</div>`;
    if (!vis.length) {
      html += `<p class="bintro">${(q || _biome) ? "No creatures match this filter." : "You haven't slain any creatures yet — go hunting!"}</p>`;
      body.innerHTML = html;
      return;
    }
    html += `<table><thead><tr><th></th><th>Lvl</th><th>Name</th><th>Slain</th><th>Spawn biomes</th><th>Drops</th></tr></thead><tbody id="bestiary-rows"></tbody></table>`;
    body.innerHTML = html;
    const tb = document.getElementById("bestiary-rows");
    const mkIcon = (key, px) => { // small canvas for an SPR key, or null
      if (!key || typeof SPR === "undefined" || !SPR[key] || typeof icon !== "function") return null;
      const cv = document.createElement("canvas"); cv.width = px; cv.height = px;
      try { cv.getContext("2d").drawImage(icon(key), 0, 0, px, px); } catch (err) { return null; }
      return cv;
    };
    for (const e of vis) {
      const locked = cheat && e.kills === 0;
      const tr = document.createElement("tr");
      if (locked) tr.className = "locked";
      // sprite
      const tdS = document.createElement("td"); tdS.className = "bspr";
      const sc = mkIcon(sprKeyOf(MONSTERS[e.kind]), 40); if (sc) tdS.appendChild(sc);
      tr.appendChild(tdS);
      const tdL = document.createElement("td"); tdL.className = "blvl"; tdL.textContent = e.lvl || "—"; tr.appendChild(tdL);
      const tdN = document.createElement("td"); tdN.className = "bname"; tdN.textContent = e.name;
      // lore lines (the extinct birds carry them — see nz-extra-birds.js):
      // shown under the name once the creature is discovered; reading one
      // the first time quietly credits the bestiary_lore easter egg
      const lore = MONSTERS[e.kind] && MONSTERS[e.kind].lore;
      if (lore && e.kills > 0) {
        const lv = document.createElement("div");
        lv.style.cssText = "margin-top:2px;font-size:11px;font-style:italic;color:#8fa3c8;font-weight:normal;";
        lv.textContent = lore;
        tdN.appendChild(lv);
        if (typeof Eggs !== "undefined" && Eggs.found) Eggs.found("bestiary_lore", null);
      }
      if (typeof ProposalOverlay !== "undefined") {
        const u = ProposalOverlay.credit("monster:" + e.kind);
        const gap = !u && ProposalOverlay.isGapMonster(e.kind);
        if (u || gap) {
          const cv = document.createElement("div");
          cv.style.cssText = "margin-top:2px;font-size:11px;font-style:italic;color:#8fa3c8;font-weight:normal;";
          cv.textContent = u ? `art by @${u} · made in the Taiao Workshop` : "awaiting an artist — this could be your work";
          tdN.appendChild(cv);
        }
      }
      tr.appendChild(tdN);
      // slain count
      const tdK = document.createElement("td"); tdK.className = "bslain"; tdK.textContent = e.kills > 0 ? "×" + e.kills : "—"; tr.appendChild(tdK);
      const tdB = document.createElement("td"); tdB.className = "bbiome"; tdB.textContent = e.biomes.length ? e.biomes.join(", ") : "—"; tr.appendChild(tdB);
      // drops — one per line, each with its item icon
      const tdD = document.createElement("td"); tdD.className = "bdrop";
      if (!e.drops.length) tdD.textContent = "—";
      else for (const d of e.drops) {
        const line = document.createElement("div"); line.className = "bdropline";
        const di = mkIcon((ITEMS[d.id] && ITEMS[d.id].icon) || null, 20); if (di) line.appendChild(di);
        const sp = document.createElement("span"); sp.textContent = d.text; line.appendChild(sp);
        tdD.appendChild(line);
      }
      tr.appendChild(tdD);
      tb.appendChild(tr);
    }
  }
  function closeBestiary() { document.getElementById("bestiary").classList.remove("open"); }
  function isBestiaryOpen() { return document.getElementById("bestiary").classList.contains("open"); }
  function toggleBestiary() {
    const el = document.getElementById("bestiary");
    if (el.classList.contains("open")) { closeBestiary(); return; }
    el.classList.add("open");
    openBestiary();
  }

  if (typeof window !== "undefined") { window.openBestiary = openBestiary; window.closeBestiary = closeBestiary; window.toggleBestiary = toggleBestiary; }

  // ---- wiring (deferred so the DOM exists) ----
  function wire() {
    const btn = document.getElementById("bestiarybtn");
    if (btn) btn.onclick = () => toggleBestiary();
    const x = document.getElementById("bestiaryclose");
    if (x) x.onclick = () => closeBestiary();
    const s = document.getElementById("bestiary-search");
    if (s) s.oninput = e => { _search = e.target.value; openBestiary(); };
    const bs = document.getElementById("bestiary-biome");
    if (bs) bs.onchange = e => { _biome = e.target.value; openBestiary(); };
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && isBestiaryOpen()) { e.stopPropagation(); closeBestiary(); return; }
      // "B" toggles — but not while typing in an input (search boxes, etc.)
      const t = e.target;
      if ((e.key === "b" || e.key === "B") && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) {
        e.preventDefault(); toggleBestiary();
      }
    }, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
