// ===== Taiao — Te Kairaranga, the Weaver of Newhaven =====
// Chant magic (gameplay/chant.js) was undiscoverable: nothing in the world
// ever explained that a wand turns typed/spoken rune sentences into spells
// (the isle deliberately teaches no magic). The Weaver fills that gap: a
// rooted plaza NPC (derived in world/chunks.js beside the Registrar) who
// folds you through the veil to their own wizard tower — stamped at a
// deterministic spot outside Newhaven — gifts a wand and a pouch of
// starter runes, and teaches the sentence grammar. A second body waits at
// the tower, so the lesson (and the ride home) is always re-readable.
// One-time gift persists as player.wizard {gift, tower} (storage.js).
"use strict";

const Wizard = (() => {
  let _tower = null; // cached {x,y} in game tiles
  let el = null, cur = null, page = 0;

  // The Weaver keeps their OWN tower — world/chunks.js stamps a wizardtower
  // structure at this spot (and derives the tower body there). The position
  // is pure elevation math on a golden-angle spiral out of Newhaven: the
  // first dry, river-free, non-mountain pad ~90+ tiles from the plaza.
  // Deterministic per world and costs milliseconds — deliberately NOT a
  // poiInfo scan: naming/demoting POI cells traces roads and takes ~seconds
  // PER CELL cold, which froze the game for minutes when this first shipped
  // as a "nearest wizardtower POI" search.
  function towerPos() {
    if (_tower) return _tower;
    if (typeof player !== "undefined" && player && player.wizard && player.wizard.tower)
      return (_tower = { x: player.wizard.tower[0], y: player.wizard.tower[1] });
    if (typeof world === "undefined" || !world || !world.heightAt) return null;
    const LE = world.LAND_ELEVATION, GA = 2.399963229728653; // golden angle
    for (let i = 0; i < 900; i++) {
      const r = 90 + i * 0.55, a = i * GA;
      const x = Math.round(Math.cos(a) * r), y = Math.round(Math.sin(a) * r);
      let dry = true; // the 6x6 footprint plus a step of approach must be land
      for (const d of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]])
        if (world.heightAt(x + d[0], y + d[1]) < LE + 0.02) { dry = false; break; }
      if (!dry) continue;
      if (world.heightAt(x, y) > 0.82) continue;                    // not a mountaintop
      if (world.riverFlowAt && world.riverFlowAt(x, y)) continue;   // not mid-river
      _tower = { x, y };
      break;
    }
    return _tower;
  }
  const atTower = () => {
    const t = towerPos();
    return t && Math.abs(player.x - t.x) < 24 && Math.abs(player.y - t.y) < 24;
  };

  // ---------- the lessons ----------
  const PLAZA = () => [{
    h: "Te Kairaranga — the Weaver",
    t: [`"You hear it too, eh? Underneath the gulls and the hammering — the world hums. Wind, water, stone: one long song."`,
        `"What towners call magic is just joining in. You speak a sentence INTO the weave — each word a rune, burnt from your pouch as it leaves your lips."`],
    act: [["Teach me the weave", "tower"], ["Another time", "close"]],
  }];
  const TOWER_FIRST = () => [{
    h: "The tower between",
    t: [`"Welcome to my tower. Every wizard keeps one, and every wizard's knees despise the stairs — so we came the other way."`,
        `"Now: a weave is a SUBSTANCE and a VERB, spoken in order. 'Air strike.' 'Fire strike.' A wand holds two words; a staff, three — and the grander runes make grander sentences."`],
    act: [["Continue", "next"]],
  }, {
    h: "Your first sentence",
    t: [`"Take this wand, and runes enough to be dangerous — mostly to yourself."`,
        `"Click each rune stack in your pack to POUCH it. Wield the wand. Then press Enter and type your sentence — or press V and speak it aloud, if your browser has ears."`,
        `"Find something that deserves an 'air strike' and give it one. When you can craft runes of your own at an altar, come back — I'll be here. Or there. Both."`],
    act: [["Send me home", "home"], ["I'll look around first", "close"]],
  }];
  const TOWER_AGAIN = () => [{
    h: "The Weaver, at the tower",
    t: [`"Substance, then verb: 'air strike', 'fire strike'. Pouch the runes, wield the wand, Enter to type or V to speak."`,
        `"The deeper runes — modifiers, wildcards — you'll meet as your Runecrafting grows. The weave rewards a wide vocabulary."`],
    act: [["Send me home", "home"], ["Thanks", "close"]],
  }];
  const PLAZA_AGAIN = () => [{
    h: "Te Kairaranga — the Weaver",
    t: [`"Sentence not landing? Substance then verb — 'air strike'. Runes pouched, wand in hand, Enter or V."`,
        `"Want the tower again? The veil remembers the way."`,
        `"The veil is not the only weaving here, kaihanga. The world itself is still on the loom — and the Workshop keeps a thread for you."`],
    act: [["To the tower", "tower"],
          ...(typeof TAIAO_WORKSHOP_URL !== "undefined" && TAIAO_WORKSHOP_URL ? [["The Workshop?", "workshop"]] : []),
          ["Just passing", "close"]],
  }];

  function gift() {
    if (player.wizard && player.wizard.gift) return;
    const t = towerPos();
    player.wizard = { gift: 1, tower: t ? [t.x, t.y] : null };
    addItem("wand", 1);
    addItem("air_rune", 30);
    addItem("rune_strike", 30);  // Strike — the first verb
    addItem("fire_rune", 12);
    log("Gift received: Wand, 30× Air rune, 30× Strike rune, 12× Fire rune.", "gold");
    sfx("coins", 0.5);
    saveGame();
  }

  // ---------- travel ----------
  function toTower() {
    const t = towerPos();
    if (!t) { log("The Weaver frowns. \"The veil is... misplaced. Come back shortly.\"", "warn"); return; }
    if (player.wizard) player.wizard.tower = [t.x, t.y];
    portalTravel(t.x, t.y);
    setTimeout(() => {
      gift();
      const first = !player.wizard.taught;
      player.wizard.taught = 1;
      open(first ? TOWER_FIRST() : TOWER_AGAIN());
      saveGame();
    }, 450);
  }
  function home() {
    portalTravel(world.playerStart.x, world.playerStart.y + 1);
  }

  // ---------- dialog panel ----------
  function ensureDom() {
    if (el) return el;
    el = document.createElement("div");
    el.id = "wizardlg";
    el.style.cssText = "position:fixed;inset:0;z-index:8600;display:none;align-items:center;justify-content:center;background:rgba(8,10,16,.55)";
    const box = document.createElement("div");
    box.style.cssText = "width:min(480px,92vw);background:#161a26;border:1px solid #3a4a6a;border-radius:10px;" +
      "box-shadow:0 12px 40px rgba(0,0,0,.6);padding:18px 20px;color:#dfe6f2;font-size:14px;line-height:1.5";
    el.appendChild(box);
    el._box = box;
    el.addEventListener("mousedown", e => { if (e.target === el) close(); });
    document.body.appendChild(el);
    return el;
  }
  function render() {
    const p = cur[page];
    const box = ensureDom()._box;
    box.innerHTML = "";
    const h = document.createElement("div");
    h.style.cssText = "color:#ffd75e;font-weight:bold;font-size:15px;margin-bottom:8px";
    h.textContent = p.h;
    box.appendChild(h);
    for (const t of p.t) {
      const d = document.createElement("div");
      d.style.cssText = "margin:7px 0;color:#c7d2e8";
      d.textContent = t;
      box.appendChild(d);
    }
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;margin-top:14px;justify-content:flex-end;flex-wrap:wrap";
    for (const [label, key] of p.act) {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = () => ACTS[key] && ACTS[key]();
      row.appendChild(b);
    }
    box.appendChild(row);
    el.style.display = "flex";
  }
  const ACTS = {
    close: () => close(),
    next: () => { page++; render(); },
    tower: () => { close(); toTower(); },
    home: () => { close(); home(); },
    workshop: () => { if (typeof TAIAO_WORKSHOP_URL !== "undefined" && TAIAO_WORKSHOP_URL) window.open(TAIAO_WORKSHOP_URL, "_blank"); },
  };
  function open(pages) { cur = pages; page = 0; render(); }
  function close() { if (el) el.style.display = "none"; cur = null; }
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && el && el.style.display !== "none") { e.stopPropagation(); close(); }
  }, true);

  // talkTo (main/ui.js) routes any npc.wizard body here
  function talk(npc) {
    if (npc) npc._say = { text: `"Kia ora."`, until: performance.now() + 2500 };
    sfx("book", 0.5);
    if (atTower()) open(player.wizard && player.wizard.gift ? TOWER_AGAIN() : TOWER_FIRST());
    else open(player.wizard && player.wizard.taught ? PLAZA_AGAIN() : PLAZA());
  }

  return { talk, towerPos };
})();
