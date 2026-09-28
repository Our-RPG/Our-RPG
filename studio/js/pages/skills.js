// ===== Taiao Workshop — Skills catalog + detail =====
// A communal, public browser of every SKILL in the game and the recipes that
// train it. Each skill shows its milestones (level → unlock, from recipes) and,
// per recipe, the required level, exp, crafting station, tool, craft time,
// inputs and outputs — all read straight from the game's own data (SKILLS,
// RECIPES, STATIONS, ITEMS, loaded by index.html). Players sign in with the
// same Taiao account they use in game to VOTE on required levels (and the other
// specs) via the existing workshop ballot (js/taiao.js), and to ADD their own
// skills — kept local until published as a community proposal. Nothing here
// auto-applies to the game: custom skills are reference/proposal entries only.
//
// All studio scripts share one global scope, so every helper here is either
// nested in a page function or prefixed `sk`/`Skillpedia` to avoid colliding
// with catalog.js / detail.js globals.
"use strict";

// ---------------------------------------------------------------------------
// Skillpedia — a thin read model over the game's skill + recipe globals.
// ---------------------------------------------------------------------------
const Skillpedia = (function () {
  const MAX = (typeof MAX_LEVEL !== "undefined" ? MAX_LEVEL : 32);

  // Every recipe for a skill, walking RECIPES and tagging each with its
  // category key (the RECIPES bucket) so we can reverse-map its station.
  function recipesFor(id) {
    const out = [];
    if (typeof RECIPES === "undefined") return out;
    for (const cat in RECIPES) {
      const list = RECIPES[cat];
      if (!Array.isArray(list)) continue;
      for (const r of list) if (r && r.skill === id) out.push(Object.assign({ _cat: cat }, r));
    }
    return out;
  }

  // The list of skills, grouped by SKILL_CATEGORY in SKILL_CATEGORY_ORDER.
  function skills() {
    const ids = (typeof SKILLS !== "undefined" ? SKILLS.slice() : []);
    return ids.map(id => ({ id, category: categoryOf(id), recipes: recipesFor(id) }));
  }
  function categoryOf(id) {
    return (typeof SKILL_CATEGORY !== "undefined" && SKILL_CATEGORY[id]) || "Other";
  }
  function categoryOrder() {
    return (typeof SKILL_CATEGORY_ORDER !== "undefined" ? SKILL_CATEGORY_ORDER.slice() : ["Other"]);
  }

  const recipeId = r => r.id || slug(r.name || (r.out || "recipe"));

  // A recipe's crafting station: its own `stations` list if present, else the
  // stations whose `lists` include this recipe's category bucket.
  function stationsOf(r) {
    if (Array.isArray(r.stations) && r.stations.length) return r.stations.map(stationName);
    const found = [];
    if (typeof STATIONS !== "undefined") {
      for (const key in STATIONS) {
        const st = STATIONS[key];
        if (st && Array.isArray(st.lists) && st.lists.includes(r._cat)) found.push(st.name || key);
      }
    }
    return found;
  }
  const stationName = key => (typeof STATIONS !== "undefined" && STATIONS[key] && STATIONS[key].name) || key;

  // Tool required. The game derives this from TOOL_SKILLS (js/skills/
  // production.js) which the studio doesn't load — so guard, and degrade
  // gracefully when it isn't reachable.
  function toolsFor(skillId) {
    if (typeof TOOL_SKILLS === "undefined") return [];
    const out = [];
    for (const toolId in TOOL_SKILLS) {
      const skillsForTool = TOOL_SKILLS[toolId];
      if (Array.isArray(skillsForTool) && skillsForTool.includes(skillId)) out.push(itemName(toolId));
    }
    return out;
  }

  // Craft time in ms — every recipe is an active "time to craft" now.
  const craftMs = r => r.tick || r.time || 0;

  // Outputs: the primary out×qty (or an explicit outputs[]), plus byproducts.
  function outputsOf(r) {
    const main = [];
    if (Array.isArray(r.outputs)) r.outputs.forEach(o => main.push({ id: o.id, qty: o.qty || 1 }));
    else if (r.out) main.push({ id: r.out, qty: r.qty || 1 });
    const by = Array.isArray(r.byproducts) ? r.byproducts.map(b => ({ id: b.id, qty: b.qty || 1 })) : [];
    return { main, by };
  }
  const inputsOf = r => Object.entries(r.in || {}).map(([id, qty]) => ({ id, qty }));

  const itemName = id => (typeof ITEMS !== "undefined" && ITEMS[id] && ITEMS[id].name) || Roster.prettyName(id);

  // Each skill's map icon (js/sprites/map-icon-atlas-data.js → SPR key
  // "i_mapicon_<name>"). Explicit per skill, else by category, else a generic
  // quest marker. The caller falls back to an emoji if the SPR key is missing.
  const SKILL_ICON = {
    Woodcutting: "tree", Fishing: "fish", Mining: "mine", "Ore-mining": "mine", "Gem-mining": "gemshop", "Stone-mining": "mine",
    Foraging: "garden", Farming: "orchard",
    Cooking: "range", Baking: "range", Milling: "windmill", Malting: "seasoning_yard", Brewing: "cauldron",
    Smelting: "furnace", Weaponsmithing: "anvil", Armoursmithing: "anvil", Jewelry: "gemshop",
    Carpentry: "workbench", Fletching: "bowshop", Sawing: "seasoning_yard", Seasoning: "seasoning_yard", Coopering: "workbench",
    Textiles: "loom", Tanning: "tanning",
    Crafting: "workbench", Potionmaking: "cauldron", Alchemy: "alchemy", Runecrafting: "altar",
    Melee: "swordshop", Strength: "swordshop", Defence: "swordshop", Archery: "bowshop", Magic: "magicshop", Health: "foodshop",
    Agility: "camp", Sailing: "water",
  };
  const CATEGORY_ICON = {
    Combat: "swordshop", Gathering: "mine", "Food & Drink": "range", Woodworking: "workbench",
    Metalworking: "anvil", "Textiles & Leather": "loom", "Crafts & Arcana": "altar", Utility: "camp", Other: "quest",
  };
  const mapIconName = (id, cat) => SKILL_ICON[id] || CATEGORY_ICON[cat || categoryOf(id)] || "quest";

  // The resources a gathering skill yields, per level — NODE_TYPES entries for
  // this skill (trees, rocks, herbs, per-fish fishing spots) plus, for Farming,
  // the CROPS harvests. Deduped by (item, level, tool) and sorted by level.
  function nodesFor(id) {
    const out = [];
    if (typeof NODE_TYPES !== "undefined") {
      for (const k in NODE_TYPES) {
        const n = NODE_TYPES[k];
        if (n && n.skill === id && n.item) out.push({ name: n.name, item: n.item, req: Number(n.req) || 1, xp: n.xp || 0, tool: n.tool || null, spr: n.spr });
      }
    }
    if (id === "Farming" && typeof CROPS !== "undefined") {
      for (const k in CROPS) {
        const c = CROPS[k];
        if (c && c.item) out.push({ name: c.name, item: c.item, req: Number(c.req) || 1, xp: c.xp || 0, tool: null, spr: c.spr });
      }
    }
    const seen = new Set(), dedup = [];
    for (const g of out.sort((a, b) => a.req - b.req || String(a.item).localeCompare(String(b.item)))) {
      const key = g.item + "|" + g.req + "|" + (g.tool || "");
      if (seen.has(key)) continue; seen.add(key); dedup.push(g);
    }
    return dedup;
  }

  // The full skill TREE — one {lvl,label,xp,icon} line per unlock a skill grants,
  // for EVERY skill (combat = weapon/armour/spell tiers, gathering = nodes/fish/
  // forage/crops, production = its recipes). A faithful port of the game's
  // js/main/ui.js:guideTiers, so the studio counts match the game's progression.
  // All globals are typeof-guarded so a data file the studio doesn't load just
  // degrades that branch instead of throwing.
  function treeFor(skill) {
    const ITEMS_OK = typeof ITEMS !== "undefined";
    const iconFor = id => (id && ITEMS_OK && ITEMS[id] && ITEMS[id].icon) || null;
    const fromRecipes = () => {
      const o = [];
      if (typeof RECIPES !== "undefined") for (const cat in RECIPES) for (const r of RECIPES[cat]) if (r.skill === skill) {
        const oid = (r.outputs && r.outputs[0] && r.outputs[0].id) || r.out;
        o.push({ lvl: r.req, label: r.name, xp: r.xp, icon: iconFor(oid) });
      }
      return o;
    };
    const GUIDE_HIDE_NODES = new Set(["tree", "tree_or", "tree_ap", "pine"]);
    const fromNodes = () => {
      const o = [];
      if (typeof NODE_TYPES !== "undefined") for (const k in NODE_TYPES) { if (GUIDE_HIDE_NODES.has(k)) continue; const nt = NODE_TYPES[k]; if (nt.skill === skill) o.push({ lvl: nt.req, label: nt.name, xp: nt.xp, icon: iconFor(nt.item) }); }
      return o;
    };
    // Collapse tiered gear so garments/weapons of the SAME material fold into one
    // line. Material = the item id after its kind prefix (helm_bronze → "bronze",
    // coif_leather_0 → "leather_0"); the display name is the shared word-prefix of
    // the group's item names ("Bronze", "Rabbit leather"). A material that spans
    // two requirement tiers (metal lesser/greater) splits into Light + Heavy;
    // one-tier materials (leather, cloth) stay a single bare-material line.
    const commonWordPrefix = names => {
      if (!names.length) return "";
      const rows = names.map(n => n.split(/\s+/)); let k = 0;
      for (; k < rows[0].length; k++) { const w = rows[0][k]; if (!rows.every(r => r[k] === w)) break; }
      return rows[0].slice(0, k).join(" ");
    };
    const groupGear = (items, verb, unit) => {
      const byMat = new Map();
      for (const it of items) { const u = it.id.indexOf("_"); const mat = u >= 0 ? it.id.slice(u + 1) : it.id; if (!byMat.has(mat)) byMat.set(mat, []); byMat.get(mat).push(it); }
      const out = [];
      for (const list of byMat.values()) {
        const matName = commonWordPrefix(list.map(x => x.name));
        const reqs = [...new Set(list.map(x => x.req))].sort((a, b) => a - b);
        if (!matName) { for (const it of list) out.push({ lvl: it.req, label: `${verb} ${it.name}`, xp: 0, icon: it.icon }); continue; }
        if (reqs.length <= 1) { out.push({ lvl: reqs[0], label: `${verb} ${matName}`, xp: 0, icon: list[0].icon }); continue; }
        const wt = reqs.length === 2 ? ["Light", "Heavy"] : reqs.map((_, i) => "Tier " + (i + 1));
        reqs.forEach((r, i) => { const rep = list.find(x => x.req === r) || list[0]; out.push({ lvl: r, label: `${verb} ${wt[i]} ${matName} ${unit}`, xp: 0, icon: rep.icon }); });
      }
      return out.sort((a, b) => a.lvl - b.lvl);
    };
    switch (skill) {
      case "Woodcutting": case "Mining": case "Ore-mining": case "Gem-mining": case "Stone-mining": return fromNodes();
      case "Fishing":
        if (typeof FISH !== "undefined") return FISH.map(f => ({ lvl: f.req, label: `${f.name} — ${f.toolName}, ${f.spotName}`, xp: f.xp, icon: iconFor(f.raw) })).sort((a, b) => a.lvl - b.lvl);
        return fromNodes();
      case "Foraging": { const o = fromNodes(); if (typeof FORAGE !== "undefined") for (const f of FORAGE) o.push({ lvl: f.req, label: "Forage " + f.name.toLowerCase(), xp: f.xp, icon: iconFor(f.id) }); return o; }
      case "Farming": { const o = []; if (typeof CROPS !== "undefined") for (const k in CROPS) { const c = CROPS[k]; o.push({ lvl: c.req, label: "Grow " + c.name + (c.cat ? " (" + c.cat + ")" : ""), xp: c.xp, icon: iconFor(c.item) }); } return o; }
      case "Melee": { const w = []; if (ITEMS_OK) for (const id in ITEMS) { const d = ITEMS[id]; if (!d.wieldReq || d.equip !== "weapon") continue; w.push({ id, name: d.name, req: d.wieldReq, icon: d.icon }); } return groupGear(w, "Wield", "Weapons"); }
      case "Defence": { const a = []; if (ITEMS_OK) for (const id in ITEMS) { const d = ITEMS[id]; if (!d.wearReq) continue; a.push({ id, name: d.name, req: d.wearReq, icon: d.icon }); } return groupGear(a, "Wear", "Armour"); }
      case "Strength": { const o = [{ lvl: 1, label: "Base max hit 2 (plus weapon power)", xp: 0 }]; for (let l = 4; l <= MAX; l += 4) o.push({ lvl: l, label: `Base max hit reaches ${2 + Math.floor(l / 4)} (plus weapon power)`, xp: 0 }); return o; }
      case "Health": { const o = [{ lvl: 1, label: "Max HP 10 — trains passively from combat", xp: 0 }]; for (let l = 4; l <= MAX; l += 4) o.push({ lvl: l, label: `Max HP reaches ${10 + 3 * (l - 1)}`, xp: 0 }); return o; }
      case "Archery": {
        const o = [], byReq = new Map(), reqIcon = new Map();
        if (ITEMS_OK) for (const id in ITEMS) { const d = ITEMS[id]; if (!d.rangeReq) continue; if (!byReq.has(d.rangeReq)) byReq.set(d.rangeReq, []); byReq.get(d.rangeReq).push(d.name); if (!reqIcon.has(d.rangeReq)) reqIcon.set(d.rangeReq, d.icon); }
        for (const [req, names] of byReq) { names.sort(); o.push({ lvl: req, label: `Wield: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3} more` : ""}`, xp: 0, icon: reqIcon.get(req) }); }
        return o;
      }
      case "Magic": {
        const o = [
          { lvl: 1, label: "The Weave: spells are sentences — each cast draws the next rune from your pouch; at your weapon's capacity the sentence casts", xp: 0 },
          { lvl: 1, label: "Substances mark the target (Fire, Water/Frost, Stone, Veil, Bone, Light, Blood, Storm, Spirit)", xp: 0 },
          { lvl: 2, label: "Verbs deliver (Strike, Bind, Rend, Drain, Burst, Echo, Chaos, Law, Shadow, Death, Ward, Void)", xp: 0 },
          { lvl: 13, label: "Modifiers warp the cast (Twin, Soul, War, Time, Astral, Wrath — Genesis/Eternity fill what the weave lacks)", xp: 0 },
          { lvl: 8, label: "Secret techniques: certain word pairs transcend their parts (Petrify, Vanish, Rift Hurl, Sanctum, Stasis…)", xp: 0 },
        ];
        if (ITEMS_OK) for (const id of ["wand", "staff", "pine_wand", "pine_staff"]) { const d = ITEMS[id]; if (d) o.push({ lvl: d.magicReq, label: `Wield the ${d.name.toLowerCase()} (${d.weave}-word sentences, range ${d.range})`, xp: 0, icon: d.icon }); }
        for (let l = 4; l <= MAX; l += 4) o.push({ lvl: l, label: `Spell damage bonus +${Math.floor(l / 4)}`, xp: 0 });
        return o;
      }
      case "Sailing": { const o = []; const ids = (typeof BOAT_ORDER !== "undefined") ? BOAT_ORDER : ["canoe", "sailboat", "ship"]; if (ITEMS_OK) for (const id of ids) if (ITEMS[id]) o.push({ lvl: ITEMS[id].sailReq, label: "Sail a " + ITEMS[id].name.toLowerCase(), xp: 2 + ITEMS[id].boat * 2, icon: ITEMS[id].icon }); return o; }
      case "Agility": return (typeof OBSTACLE_ORDER !== "undefined" && typeof OBSTACLE_TYPES !== "undefined" ? OBSTACLE_ORDER : []).map(k => { const ot = OBSTACLE_TYPES[k]; return { lvl: ot.req, label: "Cross " + ot.name.toLowerCase() + (ot.fail ? " (slip risk)" : ""), xp: ot.xp }; });
      case "Alchemy": return [
        { lvl: 1, label: "Transmute any item into coins at an alchemy table", xp: 0 },
        { lvl: 16, label: "Improved yield — ~58% of the item's value", xp: 0 },
        { lvl: 32, label: "Master yield — ~66% of the item's value", xp: 0 },
      ];
      default: return fromRecipes();
    }
  }

  return { MAX, skills, recipesFor, categoryOf, categoryOrder, recipeId, stationsOf, toolsFor, craftMs, outputsOf, inputsOf, itemName, mapIconName, nodesFor, treeFor };
})();

// A skill's map icon as a canvas (from the game's map-icon atlas), falling back
// to a category emoji when the sprite isn't reachable.
function skSkillIcon(skillId, category, px) {
  px = px || 44;
  const name = Skillpedia.mapIconName(skillId, category);
  const key = "i_mapicon_" + name;
  if (name && typeof SprRender !== "undefined" && typeof SPR !== "undefined" && SPR[key]) {
    const cv = el("canvas", { width: px, height: px, style: "width:" + px + "px;height:" + px + "px;image-rendering:pixelated" });
    try { SprRender.drawKeys(cv, [key], px, false); } catch (_) {}
    return cv;
  }
  return el("div", { style: "font-size:2rem", text: skCategoryIcon(category) });
}

// A small item swatch: the game icon (via the Icons provider) + name + qty.
// Falls back to a mono id chip when the icon isn't resolvable.
function skItemSwatch(id, qty) {
  const label = Skillpedia.itemName(id) + (qty && qty !== 1 ? " ×" + qty : "");
  const wrap = el("span.sk-item", { title: id, style: "display:inline-flex;align-items:center;gap:.35rem;margin:.15rem .4rem .15rem 0" });
  const ui = Providers.get("ui");
  const entry = ui && (ui.entry("item:" + id) || ui.entry(id));
  if (entry && ui.draw) {
    const cv = el("canvas", { width: 32, height: 32, style: "width:24px;height:24px;image-rendering:pixelated" });
    try { ui.draw(cv, entry, 0); } catch (_) {}
    wrap.appendChild(cv);
  }
  wrap.appendChild(el("span", { text: label }));
  return wrap;
}

// An item's icon + its name as a link to that item's page (for recipe tables).
function skItemCell(id) {
  const wrap = el("span", { style: "display:inline-flex;align-items:center;gap:.35rem", title: id });
  const ui = Providers.get("ui");
  const entry = ui && (ui.entry("item:" + id) || ui.entry(id));
  if (entry && ui.draw) {
    const cv = el("canvas", { width: 32, height: 32, style: "width:20px;height:20px;image-rendering:pixelated;flex:0 0 auto" });
    try { ui.draw(cv, entry, 0); } catch (_) {}
    wrap.appendChild(cv);
  }
  wrap.appendChild(el("a", { text: Skillpedia.itemName(id), style: "color:inherit;cursor:pointer;text-decoration:none",
    href: "#/detail?type=ui&key=" + encodeURIComponent("item:" + id) }));
  return wrap;
}

const skCraftTimeText = ms => !ms ? "—" : (ms >= 60000 ? (ms / 60000).toFixed(ms % 60000 ? 1 : 0) + " min" : (ms / 1000).toFixed(ms % 1000 ? 1 : 0) + " s");

// ===========================================================================
// PAGE: the Skills catalog (#/skills)
// ===========================================================================
function pageSkills(root) {
  clear(root);
  const page = el("div.page");

  page.appendChild(el("div.banner.info", { html:
    "A communal, public catalog of every <b>skill</b> in the game — its milestones and the recipes that train it. " +
    (Taiao.logged() ? "Vote on required levels and specs, or add your own skill." : '<a href="#/settings">Sign in</a> to vote and add your own skills.') }));

  // ---- add your own skill -------------------------------------------------
  const add = el("details.card");
  add.appendChild(el("summary", { style: "cursor:pointer;font-weight:650", text: "＋ Add your own skill" }));
  const addBody = el("div", { style: "margin-top:.8rem" });
  add.appendChild(addBody);
  skAddSkillForm(addBody);
  page.appendChild(add);

  // No top search bar — the per-column TableFilter controls replace it.
  // ---- the catalog, grouped by category ----------------------------------
  const all = Skillpedia.skills();
  const catCard = el("div.card");
  const countBadge = el("span.badge", { id: "sk-count", text: all.length + " skills" });
  catCard.appendChild(el("div.sectitle", null, [el("h3", null, ["All game skills ", el("span.hint", { text: "name, id, category & milestones" })]), countBadge]));
  const groupsHost = el("div"); catCard.appendChild(groupsHost);
  page.appendChild(catCard);

  const th = "border-bottom:1px solid var(--line,#333);padding:.4rem .55rem;text-align:left;font-size:.7rem;letter-spacing:.02em;color:var(--ink-dim);white-space:nowrap;position:sticky;top:0;background:var(--bg-1,#111)";
  const td = "border-bottom:1px solid var(--line,#222);padding:.35rem .55rem;font-size:.8rem;vertical-align:middle;white-space:nowrap";
  function render() {
    clear(groupsHost);
    const shown = all;
    qs("#sk-count", catCard).textContent = all.length + " skills";
    if (!shown.length) { groupsHost.appendChild(el("div.empty", { text: "No skills in the game catalog." })); return; }
    const order = Skillpedia.categoryOrder();
    shown.sort((a, b) => ((order.indexOf(a.category) + 1 || 99) - (order.indexOf(b.category) + 1 || 99)) || a.id.localeCompare(b.id));
    const table = el("table", { style: "border-collapse:collapse;width:100%" });
    table.appendChild(el("tr", null, ["Skill name", "Skill id", "Skill category", "Number of milestones", "Propose"].map(h => el("th", { style: th, text: h }))));
    for (const s of shown) {
      const nameLink = el("a", { style: "color:inherit;text-decoration:none;font-weight:600;cursor:pointer", text: s.id, href: "#/skill?key=" + encodeURIComponent(s.id) });
      let n = 0; try { n = Skillpedia.treeFor(s.id).length; } catch (_) {}
      const splitBtn = el("button.btn.sm.ghost", { text: "Split skill", onclick: () => skSplitDialog(s.id) });
      const mergeBtn = el("button.btn.sm.ghost", { text: "Merge skill", onclick: () => skMergeDialog(s.id, all) });
      table.appendChild(el("tr", null, [
        el("td", { style: td }, [el("div", { style: "display:flex;align-items:center;gap:.5rem" }, [skSkillIcon(s.id, s.category, 30), nameLink])]),
        el("td", { style: td + ";font-family:monospace;font-size:.72rem;color:var(--ink-dim)", text: s.id }),
        el("td", { style: td + ";color:var(--ink-dim)", text: s.category }),
        el("td", { style: td + ";color:var(--ink-dim)", text: String(n) }),
        el("td", { style: td }, [el("div", { style: "display:flex;flex-direction:column;gap:.3rem" }, [splitBtn, mergeBtn])]),
      ]));
    }
    groupsHost.appendChild(el("div", { style: "overflow-x:auto" }, [TableFilter.enhance(table)]));
  }
  render();

  // community-shared skills merge into the main listing card (no separate section)
  const skComHost = el("div"); catCard.appendChild(skComHost);
  Taiao.listCommunity().then(all2 => {
    const skillsShared = all2.filter(p => p._subj && p._subj.kind === "skill");
    clear(skComHost);
    if (!skillsShared.length) return;
    const g = el("div.grid-cards", { style: "margin-top:.7rem" });
    for (const p of skillsShared) g.appendChild(skCommunityTile(p));
    skComHost.appendChild(g);
  }).catch(() => {});

  // ---- your drafts --------------------------------------------------------
  const draftCard = el("div.card");
  draftCard.appendChild(el("div.sectitle", null, [el("h3", null, ["Your draft skills ", el("span.hint", { text: "local until you publish" })]), el("span.badge", { id: "sk-draft-count", text: "…" })]));
  const draftGrid = el("div.grid-cards"); draftCard.appendChild(draftGrid);
  page.appendChild(draftCard);
  Store.all("skill").then(rows => {
    qs("#sk-draft-count", draftCard).textContent = rows.length + " saved";
    clear(draftGrid);
    if (!rows.length) { draftGrid.appendChild(el("div.empty", { html: "<div class='big'>📦</div>No draft skills yet — create one above." })); return; }
    for (const p of rows) draftGrid.appendChild(skDraftTile(p));
  });

  root.appendChild(page);
}

// ---- split / merge proposal dialogs (votes on subject gen:skill:<id>) -------
// A simple centred modal; click the backdrop or ✕ to close.
function skModal(title, bodyEls) {
  const overlay = el("div", { style: "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem" });
  const box = el("div.card", { style: "max-width:480px;width:100%;max-height:82vh;overflow:auto;margin:0" });
  const close = () => overlay.remove();
  box.appendChild(el("div.sectitle", null, [el("h3", { text: title }), el("button.btn.sm.ghost", { text: "✕", onclick: close })]));
  bodyEls.forEach(e => box.appendChild(e));
  overlay.appendChild(box);
  overlay.addEventListener("mousedown", e => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", function esc(ev) { if (ev.key === "Escape") { close(); document.removeEventListener("keydown", esc); } });
  document.body.appendChild(overlay);
  return { close };
}

// live tally of existing proposals for a field; clicking a chip (re)casts it.
async function skProposalChips(skillId, field, host, onPick) {
  let t = {};
  try { t = (await Taiao.tally("skill", skillId))[field] || {}; } catch (_) {}
  const mine = Taiao.myVote ? Taiao.myVote("skill", skillId, field) : null;
  const keys = Object.keys(t).sort((a, b) => t[b] - t[a]).slice(0, 12);
  clear(host);
  if (!keys.length) { host.appendChild(el("small.tagline", { text: "No proposals yet — be the first." })); return; }
  host.appendChild(el("div.tagline", { style: "font-size:.7rem;margin-bottom:.2rem", text: "existing proposals (click to add your vote):" }));
  const chips = el("div", { style: "display:flex;flex-wrap:wrap;gap:.3rem" });
  keys.forEach(k => chips.appendChild(el("span.chip.sm" + (mine === k ? ".on" : ""), { html: escapeHtml(k) + " <b>" + t[k] + "</b>", onclick: () => onPick(k) })));
  host.appendChild(chips);
}

async function skCastSkillVote(skillId, field, value) {
  value = String(value == null ? "" : value).trim();
  if (!value) { toast("Enter a value first.", "warn"); return false; }
  if (!Taiao.logged()) { toast("Sign in to vote.", "warn"); App.go("#/settings"); return false; }
  const r = await Taiao.castVote("skill", skillId, field, value.slice(0, 60));
  if (r && r.error) { toast(r.error, "err"); return false; }
  toast("Proposal recorded.", "ok"); return true;
}

function skSplitDialog(skillId) {
  const ta = el("textarea.vote-input", { placeholder: "e.g. Split into Ore-mining and Gem-mining", style: "width:100%;min-height:5rem;margin-top:.4rem" });
  const chipsHost = el("div", { style: "margin-top:.6rem" });
  const btn = el("button.btn.sm.primary", { text: "Propose split" });
  const m = skModal("Split “" + skillId + "”", [
    el("p.tagline", { style: "font-size:.75rem", text: "Describe how " + skillId + " should be split into separate skills." }),
    ta, el("div", { style: "margin-top:.5rem" }, [btn]), chipsHost,
  ]);
  const reload = () => skProposalChips(skillId, "split", chipsHost, async v => { if (await skCastSkillVote(skillId, "split", v)) m.close(); });
  btn.onclick = async () => { if (await skCastSkillVote(skillId, "split", ta.value)) m.close(); };
  reload();
}

function skMergeDialog(skillId, allSkills) {
  const others = (allSkills || []).map(x => x.id).filter(id => id !== skillId).sort();
  // 2-column grid: names in col 1, checkboxes in col 2 → all checkboxes aligned.
  const listWrap = el("div", { style: "max-height:12rem;overflow:auto;border:1px solid var(--line,#333);border-radius:.4rem;padding:.4rem .6rem;margin:.4rem 0;display:grid;grid-template-columns:1fr auto;align-items:center;row-gap:.15rem;column-gap:.6rem" });
  const boxes = [];
  others.forEach(id => {
    const cb = el("input", { type: "checkbox", value: id, style: "justify-self:end" });
    boxes.push(cb);
    listWrap.appendChild(el("label", { style: "display:contents;cursor:pointer" }, [el("span", { style: "font-size:.8rem", text: id }), cb]));
  });
  const nameInp = el("input.vote-input", { placeholder: "Name for the merged skill…", style: "width:100%" });
  const chipsHost = el("div", { style: "margin-top:.6rem" });
  const btn = el("button.btn.sm.primary", { text: "Propose merge" });
  const m = skModal("Merge “" + skillId + "”", [
    el("p.tagline", { style: "font-size:.75rem", text: "Select the skill(s) " + skillId + " should merge with, and name the merged skill." }),
    listWrap,
    el("label.field", { style: "margin:0" }, [el("span", { text: "Merged skill name" }), nameInp]),
    el("div", { style: "margin-top:.5rem" }, [btn]), chipsHost,
  ]);
  btn.onclick = async () => {
    const sel = boxes.filter(b => b.checked).map(b => b.value);
    if (!sel.length) { toast("Pick at least one skill to merge with.", "warn"); return; }
    if (!nameInp.value.trim()) { toast("Name the merged skill.", "warn"); return; }
    const value = [skillId].concat(sel).join(" + ") + " → " + nameInp.value.trim();
    if (await skCastSkillVote(skillId, "merge", value)) m.close();
  };
  skProposalChips(skillId, "merge", chipsHost, async v => { if (await skCastSkillVote(skillId, "merge", v)) m.close(); });
}

function skSkillTile(s) {
  // Each category counts a different kind of skill-tree line: Gathering skills
  // count their gatherable resources, Combat skills their progression milestones,
  // everything else its crafting recipes.
  let count, unit;
  if (s.category === "Gathering") { count = Skillpedia.nodesFor(s.id).length; unit = count === 1 ? "gatherable resource" : "gatherable resources"; }
  else if (s.category === "Combat") { count = Skillpedia.treeFor(s.id).length; unit = count === 1 ? "milestone" : "milestones"; }
  else { count = s.recipes.length; unit = count === 1 ? "recipe" : "recipes"; }
  return el("a.tile", { href: "#/skill?key=" + encodeURIComponent(s.id) }, [
    el("div.thumb", null, [skSkillIcon(s.id, s.category, 56)]),
    el("div.meta", null, [
      el("div.name", { text: s.id }),
      el("div.sub.mono", { text: s.category + "  ·  " + count + " " + unit }),
    ]),
  ]);
}
function skCommunityTile(p) {
  return el("a.tile", { href: "#/skill?pid=" + p.id + "&key=" + encodeURIComponent(p._subj.folder) }, [
    el("div.thumb", null, [el("div", { style: "font-size:2rem", text: "✨" })]),
    el("div.meta", null, [
      el("div.name", { text: p.title || p._subj.folder }),
      el("div.credit", null, ["by ", el("span.u", { text: p.username || "someone" }), "  ·  ", el("span.votes", { text: (p.endorsements || 0) + " ▲" })]),
    ]),
  ]);
}
function skDraftTile(p) {
  const n = (p.recipes || []).length;
  return el("a.tile", { href: "#/skill?draft=" + p.id }, [
    el("div.thumb", null, [el("div", { style: "font-size:2rem", text: "📦" })]),
    el("div.meta", null, [
      el("div.name", { text: p.name }),
      el("div.sub", { text: [(p.category || "Other"), n + (n === 1 ? " recipe" : " recipes"), fmtWhen(p.updatedAt)].filter(Boolean).join(" · ") }),
    ]),
  ]);
}
const skCategoryIcon = cat => ({ "Combat": "⚔️", "Gathering": "⛏️", "Food & Drink": "🍲", "Woodworking": "🪵", "Metalworking": "🔨", "Textiles & Leather": "🧵", "Crafts & Arcana": "✨", "Utility": "🧭" }[cat] || "📘");

// The add-a-skill form: saves a local draft, optionally publishes as a proposal.
function skAddSkillForm(host) {
  const nameIn = el("input", { placeholder: "Skill name, e.g. Beekeeping" });
  host.appendChild(el("label.field", null, [el("span", { text: "Name" }), nameIn]));
  const catSel = el("select");
  Skillpedia.categoryOrder().forEach(c => catSel.appendChild(el("option", { value: c, text: c })));
  host.appendChild(el("label.field", null, [el("span", { text: "Category" }), catSel]));
  const descIn = el("textarea", { placeholder: "What does this skill let you do? How is it trained?" });
  host.appendChild(el("label.field", null, [el("span", { text: "Description" }), descIn]));

  const saveBtn = el("button.btn.primary", { text: "Save draft →", onclick: async () => {
    const name = nameIn.value.trim(); if (!name) return toast("Name the skill.", "warn");
    const p = Store.newProject("skill", name);
    p.category = catSel.value; p.description = descIn.value.trim(); p.recipes = [];
    await Store.save(p);
    toast("Saved to your draft skills.", "ok"); App.go("#/skill?draft=" + p.id);
  } });
  host.appendChild(el("div.btn-row", { style: "margin-top:.4rem" }, [saveBtn,
    el("small.tagline", { text: "Add recipes & specs on the next screen, then publish to the community." })]));
}

// ===========================================================================
// PAGE: one skill (#/skill?key= | ?draft= | ?pid=)
// ===========================================================================
async function pageSkillDetail(root, params) {
  clear(root);
  const page = el("div.page");
  const draftId = params.get("draft");
  const pid = params.get("pid");
  const key = params.get("key");

  // Resolve the source: a local draft, a community proposal, or a game skill.
  let source = "game", skillId = key, name = key, category = key ? Skillpedia.categoryOf(key) : "Other";
  let recipes = [], draft = null, description = "";
  if (draftId) {
    draft = await Store.get(draftId);
    if (!draft) { root.appendChild(el("div.empty", { html: "<div class='big'>🤷</div>Draft not found. <a href='#/skills'>Back</a>." })); return; }
    source = "draft"; skillId = draft.folder || slug(draft.name); name = draft.name; category = draft.category || "Other";
    recipes = draft.recipes || []; description = draft.description || "";
  } else if (pid) {
    const prop = await Taiao.getCostume(pid).catch(() => null);
    const pl = prop && prop.payload; const sk = pl && pl.skill;
    source = "community"; name = (prop && prop.title) || key || "Skill";
    skillId = key || (sk && slug(sk.name)) || "skill"; category = (sk && sk.category) || "Other";
    recipes = (pl && pl.recipes) || (sk && sk.recipes) || []; description = (sk && sk.description) || "";
  } else if (key && typeof SKILLS !== "undefined" && SKILLS.includes(key)) {
    source = "game"; recipes = Skillpedia.recipesFor(key);
  } else if (key) {
    source = "game"; recipes = Skillpedia.recipesFor(key);   // unknown but tolerate
  } else {
    root.appendChild(el("div.empty", { html: "<div class='big'>🤷</div>No skill. <a href='#/skills'>Back</a>." })); return;
  }

  // One tally fetch drives every vote symbol on this skill (header + gather + recipes).
  const voteState = { tallies: {} };
  const votable = source !== "community";   // don't vote on unaccepted community drafts
  const refetch = async () => { try { voteState.tallies = await Taiao.tally("skill", skillId); } catch (_) {} };
  if (votable) refetch();   // fire early so counts are ready when a popover opens

  // header — the skill's category is itself votable
  const head = el("div.card");
  const catBadge = el("span.badge", { text: category });
  const iconName = Skillpedia.mapIconName(skillId, category);
  head.appendChild(el("div.sectitle", null, [
    el("div", { style: "display:flex;align-items:center;gap:.7rem" }, [
      el("div", { style: "display:flex;align-items:center;gap:.3rem" }, [
        skSkillIcon(skillId, category, 48),
        votable ? VoteWidget.symbol({ kind: "skill", folder: skillId, field: "icon", type: "select", choices: [...new Set([iconName].concat(typeof mapIconChoices === "function" ? mapIconChoices() : []).filter(Boolean))], current: iconName, currentLabel: iconName, label: "map icon", getTallies: () => voteState.tallies, refetch }) : null,
      ].filter(Boolean)),
      el("div", null, [el("h2", { text: name }), el("div.mono", { style: "color:var(--ink-dim);margin-top:-.2rem", text: skillId })]),
    ]),
    el("div.btn-row", { style: "align-items:center" }, [catBadge,
      votable ? VoteWidget.symbol({ kind: "skill", folder: skillId, field: "category", type: "select", choices: Skillpedia.categoryOrder(), current: category, currentLabel: category, label: "skill category", getTallies: () => voteState.tallies, refetch }) : null,
      el("span.badge", { text: source === "game" ? "in game" : source === "draft" ? "draft" : "community" })].filter(Boolean)),
  ]));
  const hb = [el("a.btn.ghost.sm", { text: "← Skills", href: "#/skills" })];
  head.appendChild(el("div.btn-row", null, hb));
  if (description) head.appendChild(el("p", { style: "margin-top:.4rem", text: description }));
  page.appendChild(head);

  // gatherable resources (trees/rocks/herbs/fishing spots/crops) for game skills
  const nodes = source === "game" ? Skillpedia.nodesFor(skillId) : [];
  // gathering skills yield resources via NODE_TYPES, not recipes — so their page
  // shows the resources table (not a Recipes card) and proposes RESOURCES.
  const isGather = category === "Gathering" || (!!nodes.length && !recipes.length);
  // combat skills train through combat, not a workbench — they show a milestone
  // (skill-tree) card, never a Recipes card, and propose milestones (not recipes).
  const isCombat = category === "Combat";

  // ---- milestones ---------------------------------------------------------
  // For a game skill this is the real skill tree (treeFor) — so combat skills
  // list their weapon/armour/spell milestones instead of appearing empty.
  // Custom/community skills fall back to their own recipes.
  const milestones = source === "game"
    ? Skillpedia.treeFor(skillId).map(t => ({ lvl: Number(t.lvl) || 1, name: t.label, xp: t.xp || 0 })).sort((a, b) => a.lvl - b.lvl)
    : recipes.filter(r => r && (r.name || r.out))
      .map(r => ({ lvl: Number(r.req) || 1, name: r.name || Skillpedia.itemName(r.out), xp: r.xp || 0 }))
      .concat(nodes.map(n => ({ lvl: n.req, name: "Gather " + Skillpedia.itemName(n.item), xp: n.xp })))
      .sort((a, b) => a.lvl - b.lvl);
  // Show the skill-tree card ONLY for skills that are neither gathered nor
  // crafted — i.e. combat and other non-recipe skills. Gathering skills show
  // their gatherable-resources table; crafting skills show just their recipe
  // tabs (the tree would only duplicate the recipe list).
  if (!nodes.length && !recipes.length) {
  const mCard = el("div.card");
  mCard.appendChild(el("h3", null, ["Skill tree ", el("span.hint", { text: "what each level unlocks" })]));
  if (!milestones.length) {
    mCard.appendChild(el("p.tagline", { text: source === "game" ? "This skill has no crafting recipes (it's trained through combat, gathering or questing rather than a workbench)." : "No recipes yet — add some below." }));
  } else {
    // The complete progression, one unlock per line — the div grows with the
    // number of unlocks (no sampling, no scroll cap).
    mCard.appendChild(el("p.tagline", { text: milestones.length + (milestones.length === 1 ? " unlock." : " unlocks.") }));
    const table = el("table.sk-miles", { style: "width:100%;border-collapse:collapse;font-size:.85rem" });
    // Combat skills train through combat, not XP-per-unlock — omit the XP column.
    const noXp = category === "Combat";
    table.appendChild(el("tr", null, noXp ? [th("Lvl"), th("Unlocks")] : [th("Lvl"), th("Unlocks"), th("XP")]));
    milestones.forEach(m => table.appendChild(el("tr", null, noXp
      ? [td(el("b", { text: "L" + m.lvl })), td(m.name)]
      : [td(el("b", { text: "L" + m.lvl })), td(m.name), td(el("span.mono", { text: m.xp ? "+" + m.xp : "—" }))])));
    mCard.appendChild(table);
  }
  page.appendChild(mCard);
  }

  // ---- gatherable resources (gathering skills) ----------------------------
  if (nodes.length) {
    const gCard = el("div.card");
    gCard.appendChild(el("div.sectitle", null, [el("h3", null, ["Gatherable resources ", el("span.hint", { text: "what you can gather, and the level for each" })]), el("span.badge", { text: nodes.length + (nodes.length === 1 ? " resource" : " resources") })]));
    const gt = el("table.sk-gather", { style: "width:100%;border-collapse:collapse;font-size:.85rem" });
    gt.appendChild(el("tr", null, [th("Lvl"), th("Gather"), th("From"), th("Tool"), th("XP")]));
    // a table cell with its value + (when votable) a vote symbol beside it
    const gcell = (content, id, field, type, current, currentLabel, label) => {
      const inner = typeof content === "string" ? el("span", { text: content }) : content;
      if (!votable) return td(inner);
      return td(el("span", { style: "display:inline-flex;align-items:center;gap:.3rem" }, [inner,
        VoteWidget.symbol({ kind: "skill", folder: skillId, field: "gnode:" + id + ":" + field, type, current, currentLabel, label, getTallies: () => voteState.tallies, refetch })]));
    };
    nodes.forEach(n => {
      const id = slug(n.item) + "_" + n.req;
      gt.appendChild(el("tr", null, [
        gcell(el("b", { text: "L" + n.req }), id, "level", "number", n.req, "L" + n.req, "required level"),
        gcell(skItemSwatch(n.item, 1), id, "item", "item", n.item, Skillpedia.itemName(n.item), "gathered item"),
        td(n.name || "—"),
        gcell(el("span.mono", { text: n.tool ? Skillpedia.itemName(n.tool) : "—" }), id, "tool", "item", n.tool || "", n.tool ? Skillpedia.itemName(n.tool) : "none", "tool required"),
        gcell(el("span.mono", { text: n.xp ? "+" + n.xp : "—" }), id, "xp", "number", n.xp, String(n.xp || 0), "XP per gather"),
      ]));
    });
    gCard.appendChild(gt);
    page.appendChild(gCard);
  }

  // ---- recipes (with per-recipe specs + voting) ---------------------------
  // gathering skills have no recipes card — they present gatherable resources;
  // combat skills have none either — they present their milestone skill tree.
  if (!isGather && !isCombat) {
  const rCard = el("div.card");
  rCard.appendChild(el("div.sectitle", null, [el("h3", null, ["Recipes ", el("span.hint", { text: "specs — expand to see details & vote" })]), el("span.badge", { text: recipes.length + (recipes.length === 1 ? " recipe" : " recipes") })]));
  // No search bar — the per-column TableFilter controls replace it.
  const rHost = el("div"); rCard.appendChild(rHost);

  function renderRecipes() {
    clear(rHost);
    const shown = recipes.filter(r => r)
      .sort((a, b) => (Number(a.req) || 0) - (Number(b.req) || 0) || String(a.name || "").localeCompare(String(b.name || "")));   // by required level
    if (!shown.length) { rHost.appendChild(el("div.empty", { text: "No recipes yet." })); return; }

    // Column counts come from the widest recipe in the skill so the table shape
    // is stable.
    const tools = Skillpedia.toolsFor(skillId);   // ≤1 tool per skill (design rule)
    const hasTool = tools.length > 0;
    let maxIn = 1, maxMain = 1, maxBy = 0, hasStation = false;
    for (const r of recipes) {
      const o = Skillpedia.outputsOf(r);
      maxIn = Math.max(maxIn, Skillpedia.inputsOf(r).length);
      maxMain = Math.max(maxMain, o.main.length);
      maxBy = Math.max(maxBy, o.by.length);       // ≤1 by-product per recipe (design rule)
      if (Skillpedia.stationsOf(r).length) hasStation = true;
    }
    const head = ["Lvl", "Recipe"];
    for (let i = 1; i <= maxIn; i++) head.push("Input " + i + " name", "Input " + i + " qty");
    if (maxMain <= 1) head.push("Output name", "Output qty");
    else for (let i = 1; i <= maxMain; i++) head.push("Output " + i + " name", "Output " + i + " qty");
    if (maxBy >= 1) head.push("Byproduct name", "Byproduct qty");   // at most one
    if (hasTool) head.push("Tool required");
    if (hasStation) head.push("Station");
    const noXp = category === "Combat";   // combat skills omit the XP column
    if (!noXp) head.push("XP");
    head.push("Time to craft");

    const table = el("table.sk-recipes", { style: "border-collapse:collapse;font-size:.82rem;white-space:nowrap" });
    table.appendChild(el("tr", null, head.map(h => th(h))));
    const dash = () => el("span.tagline", { text: "—" });
    shown.forEach(r => {
      const ins = Skillpedia.inputsOf(r), o = Skillpedia.outputsOf(r), st = Skillpedia.stationsOf(r);
      const cells = [td(el("b", { text: "L" + (Number(r.req) || 1) })), td(r.name || Skillpedia.itemName(r.out))];
      for (let i = 0; i < maxIn; i++) { const it = ins[i]; cells.push(td(it ? skItemCell(it.id) : dash()), td(it ? String(it.qty) : "—")); }
      for (let i = 0; i < maxMain; i++) { const it = o.main[i]; cells.push(td(it ? skItemCell(it.id) : dash()), td(it ? String(it.qty) : "—")); }
      for (let i = 0; i < maxBy; i++) { const it = o.by[i]; cells.push(td(it ? skItemCell(it.id) : dash()), td(it ? String(it.qty) : "—")); }
      if (hasTool) cells.push(td(tools[0] || "—"));
      if (hasStation) cells.push(td(st[0] || "—"));
      if (!noXp) cells.push(td(el("span.mono", { text: r.xp ? "+" + r.xp : "—" })));
      cells.push(td(skCraftTimeText(Skillpedia.craftMs(r))));
      table.appendChild(el("tr", null, cells));
    });
    rHost.appendChild(el("div", { style: "overflow-x:auto" }, [TableFilter.enhance(table)]));
  }
  renderRecipes();
  if (votable) refetch().then(renderRecipes);
  page.appendChild(rCard);
  }   // end !isGather recipes card

  // ---- add / propose recipes ---------------------------------------------
  if (source === "draft") {
    const dc = el("div.card");
    dc.appendChild(el("h3", { text: "Add a recipe to this skill" }));
    skRecipeForm(dc, category, async recipe => {
      draft.recipes = draft.recipes || []; draft.recipes.push(recipe);
      await Store.save(draft); toast("Recipe added.", "ok"); App.go("#/skill?draft=" + draft.id + "&_=" + Date.now());
    });
    page.appendChild(dc);

    const pubCard = el("div.card");
    pubCard.appendChild(el("h3", { text: "Publish to the community" }));
    pubCard.appendChild(el("p.tagline", { text: "Share this skill and its recipes as a workshop proposal (CC BY-SA 4.0). A curator reviews every accepted proposal — nothing auto-applies to the game." }));
    pubCard.appendChild(el("div.btn-row", null, [el("button.btn.primary", { text: "Publish skill →", onclick: async () => {
      if (!Taiao.logged()) { toast("Sign in to publish.", "warn"); App.go("#/settings"); return; }
      const bundle = { schema: "taiao-skill/1", skill: { name: draft.name, category: draft.category, description: draft.description }, recipes: draft.recipes || [] };
      const r = await Taiao.submitProposal("skill", skillId, draft.name, bundle, "data");
      if (r.ok) toast("Published to the community!", "ok", 5000); else toast(r.error || "Couldn't publish.", "err", 5000);
    } })]));
    page.appendChild(pubCard);
  } else if (source === "game" && isCombat) {
    const pc = el("div.card");
    pc.appendChild(el("h3", { text: "Propose a new milestone for " + name }));
    pc.appendChild(el("p.tagline", { text: "Suggest a new progression milestone this combat skill should unlock — the level it's reached at and what it grants. Submitted as a workshop proposal for a curator to review." }));
    skMilestoneForm(pc, async milestone => {
      if (!Taiao.logged()) { toast("Sign in to propose.", "warn"); App.go("#/settings"); return; }
      const title = "Milestone: L" + milestone.level + " — " + milestone.label;
      const r = await Taiao.submitProposal("skill", skillId, title, { schema: "taiao-milestone/1", skill: skillId, milestone }, "data");
      if (r.ok) toast("Milestone proposed!", "ok"); else toast(r.error || "Couldn't propose.", "err", 5000);
    });
    page.appendChild(pc);
  } else if (source === "game" && isGather) {
    const pc = el("div.card");
    pc.appendChild(el("h3", { text: "Propose a new resource for " + name }));
    pc.appendChild(el("p.tagline", { text: "Suggest a gatherable resource the game should add to this skill — the item it yields, the node it comes from, the level required, the tool needed and the XP per gather. Submitted as a workshop proposal for a curator to review." }));
    skResourceForm(pc, async resource => {
      if (!Taiao.logged()) { toast("Sign in to propose.", "warn"); App.go("#/settings"); return; }
      const title = "Resource: " + (Skillpedia.itemName(resource.item) || resource.item);
      const r = await Taiao.submitProposal("skill", skillId, title, { schema: "taiao-resource/1", skill: skillId, resource }, "data");
      if (r.ok) toast("Resource proposed!", "ok"); else toast(r.error || "Couldn't propose.", "err", 5000);
    });
    page.appendChild(pc);
  } else if (source === "game") {
    const pc = el("div.card");
    pc.appendChild(el("h3", { text: "Propose a new recipe for " + name }));
    pc.appendChild(el("p.tagline", { text: "Suggest a recipe the game should add to this skill. Submitted as a workshop proposal for a curator to review." }));
    skRecipeForm(pc, category, async recipe => {
      if (!Taiao.logged()) { toast("Sign in to propose.", "warn"); App.go("#/settings"); return; }
      const title = "Recipe: " + (recipe.name || recipe.out);
      const r = await Taiao.submitProposal("skill", skillId, title, { schema: "taiao-recipe/1", skill: skillId, recipe }, "data");
      if (r.ok) toast("Recipe proposed!", "ok"); else toast(r.error || "Couldn't propose.", "err", 5000);
    });
    page.appendChild(pc);
  } else if (source === "community") {
    const ec = el("div.card");
    ec.appendChild(el("h3", { text: "Support this skill" }));
    ec.appendChild(el("div.btn-row", null, [el("button.btn.primary", { text: "▲ Endorse", onclick: async () => {
      const r = await Taiao.endorseCostume(pid); if (r.ok) toast("Endorsed!", "ok"); else toast(r.error || "Couldn't endorse.", "err");
    } })]));
    page.appendChild(ec);
  }

  // ---- raw in-game data ---------------------------------------------------
  if (source === "game" && recipes.length) {
    const dc = el("div.card");
    dc.appendChild(el("h3", null, ["In-game data ", el("span.hint", { text: "this skill's raw recipe objects" })]));
    const raw = recipes.map(r => { const c = Object.assign({}, r); delete c._cat; return c; });
    dc.appendChild(el("pre.mono", { style: "overflow:auto;max-height:420px;white-space:pre;background:var(--bg-2);padding:.8rem;border-radius:8px", text: safeJson(raw) }));
    page.appendChild(dc);
  }

  root.appendChild(page);
}

const th = t => el("th", { style: "text-align:left;padding:.25rem .5rem;border-bottom:1px solid var(--line,#333);color:var(--ink-dim)", text: typeof t === "string" ? t : undefined }, typeof t === "string" ? null : [t]);
const td = c => el("td", { style: "padding:.25rem .5rem;border-bottom:1px solid var(--line,#2a2a2a)" }, typeof c === "string" ? [c] : [c]);


// One recipe as a lazy <details>: header line + (on open) full spec + votes.
function skRecipeDetails(r, skillId, voteState, refetch, votable) {
  const rid2 = Skillpedia.recipeId(r);
  const d = el("details.card", { style: "background:var(--bg-2);margin-bottom:.5rem" });
  const req = Number(r.req) || 1;
  d.appendChild(el("summary", { style: "cursor:pointer" }, [
    el("span", { style: "font-weight:650", text: r.name || Skillpedia.itemName(r.out) }),
    el("span.badge", { style: "margin-left:.5rem", text: "L" + req }),
    r.xp ? el("span.mono", { style: "margin-left:.5rem;color:var(--ink-dim)", text: "+" + r.xp + " xp" }) : null,
  ].filter(Boolean)));
  const body = el("div", { style: "margin-top:.6rem" });
  let built = false;
  d.addEventListener("toggle", () => { if (d.open && !built) { built = true; skRecipeBody(body, r, rid2, skillId, req, voteState, refetch, votable); } });
  d.appendChild(body);
  return d;
}

function skRecipeBody(host, r, rid2, skillId, req, voteState, refetch, votable) {
  clear(host);
  const ins = Skillpedia.inputsOf(r);
  const { main, by } = Skillpedia.outputsOf(r);
  const stations = Skillpedia.stationsOf(r);
  const tools = Skillpedia.toolsFor(skillId);
  const ms = Skillpedia.craftMs(r);
  const stationChoices = (typeof STATIONS !== "undefined" ? [...new Set(Object.keys(STATIONS).map(k => STATIONS[k].name || k))] : []);
  stationChoices.push("none");

  // a vote symbol for one recipe field (null when this source isn't votable)
  const V = (field, type, current, currentLabel, label, extra) => votable
    ? VoteWidget.symbol(Object.assign({ kind: "skill", folder: skillId, field: field + ":" + rid2, type, current, currentLabel, label, getTallies: () => voteState.tallies, refetch }, extra))
    : null;

  // spec grid — every value carries a 🗳 vote symbol
  const spec = el("dl.kv", { style: "margin:.2rem 0 0" });
  const kv = (k, valueEls, sym) => {
    spec.appendChild(el("dt", { text: k }));
    spec.appendChild(el("dd", { style: "display:flex;align-items:center;gap:.4rem;flex-wrap:wrap" }, [].concat(valueEls, sym || []).filter(Boolean)));
  };
  kv("Inputs", ins.length ? ins.map(i => skItemSwatch(i.id, i.qty)) : [el("span.tagline", { text: "none" })],
    V("inputs", "string", ins.map(i => i.id + "×" + i.qty).join(", "), null, "recipe inputs", { placeholder: "item×qty, item×qty…" }));
  kv("Output", main.length ? main.map(o => skItemSwatch(o.id, o.qty)) : [el("span.tagline", { text: "—" })],
    V("out", "item", main[0] && main[0].id, main[0] && Skillpedia.itemName(main[0].id), "output"));
  if (by.length) kv("By-product", by.slice(0, 1).map(o => skItemSwatch(o.id, o.qty)));
  kv("Required level", [el("b", { text: "L" + req })], V("req", "number", req, "L" + req, "required level", { min: 1, max: Skillpedia.MAX }));
  kv("Exp given", [el("span.mono", { text: r.xp ? "+" + r.xp : "—" })], V("xp", "number", r.xp || 0, r.xp ? "+" + r.xp : "—", "XP given", { min: 0 }));
  kv("Station", [el("span", { text: stations.length ? stations[0] : "—" })],
    V("station", "select", stations[0] || "none", stations[0] || "none", "crafting station", { choices: stationChoices }));
  kv("Tool required", [el("span", { text: tools.length ? tools.join(", ") : "—" })],
    V("tool", "item", tools[0] || "", tools.join(", ") || "none", "tool required"));
  kv("Time to craft", [el("span", { text: skCraftTimeText(ms) })],
    V("time", "number", ms ? Math.round(ms / 1000) : "", skCraftTimeText(ms), "craft time (seconds)", { min: 0 }));
  host.appendChild(spec);
  if (votable) host.appendChild(el("small.tagline", { style: "display:block;margin-top:.5rem", html: Taiao.logged() ? "🗳 vote on any spec above." : '🗳 <a href="#/settings">sign in</a> to vote on these specs.' }));
}

// A reusable recipe-spec form (used for draft "Add recipe" and game "Propose").
// `onSubmit(recipe)` receives a plain recipe object mirroring the game's shape.
function skRecipeForm(host, category, onSubmit) {
  const name = el("input", { placeholder: "Recipe name, e.g. Craft honey candle" });
  const out = el("input", { placeholder: "Output item id, e.g. honey_candle" });
  const qty = el("input", { type: "number", value: "1", min: "1", style: "width:80px" });
  const req = el("input", { type: "number", value: "1", min: "1", max: String(Skillpedia.MAX), style: "width:80px" });
  const xp = el("input", { type: "number", value: "10", min: "0", style: "width:90px" });
  const time = el("input", { type: "number", value: "3", min: "0", step: "0.5", style: "width:90px" });
  const inputs = el("input", { placeholder: "inputs: item_id×qty, comma-separated — e.g. wax×2, wick×1" });
  const station = el("input", { placeholder: "station, e.g. Chandler's bench" });
  const tool = el("input", { placeholder: "tool required (optional), e.g. hammer" });

  host.appendChild(el("label.field", null, [el("span", { text: "Recipe name" }), name]));
  host.appendChild(el("div.row", null, [
    el("label.field", { style: "flex:2" }, [el("span", { text: "Output item id" }), out]),
    el("label.field", { style: "flex:0 0 90px" }, [el("span", { text: "Qty" }), qty]),
  ]));
  host.appendChild(el("div.row", null, [
    el("label.field", { style: "flex:0 0 110px" }, [el("span", { text: "Req level" }), req]),
    el("label.field", { style: "flex:0 0 110px" }, [el("span", { text: "Exp" }), xp]),
    el("label.field", { style: "flex:0 0 130px" }, [el("span", { text: "Time (s)" }), time]),
  ]));
  host.appendChild(el("label.field", null, [el("span", { text: "Inputs" }), inputs]));
  host.appendChild(el("div.row", null, [
    el("label.field", { style: "flex:1" }, [el("span", { text: "Station" }), station]),
    el("label.field", { style: "flex:1" }, [el("span", { text: "Tool required" }), tool]),
  ]));

  host.appendChild(el("div.btn-row", { style: "margin-top:.4rem" }, [el("button.btn.primary", { text: "Add recipe", onclick: async () => {
    const nm = name.value.trim(), o = slug(out.value.trim());
    if (!nm) return toast("Name the recipe.", "warn");
    if (!out.value.trim()) return toast("Give it an output item id.", "warn");
    const inMap = {};
    inputs.value.split(",").map(s => s.trim()).filter(Boolean).forEach(part => {
      const m = /^(.+?)\s*[x×*]\s*(\d+)$/i.exec(part) || [null, part, "1"];
      const id = slug(m[1]); if (id) inMap[id] = (inMap[id] || 0) + (parseInt(m[2], 10) || 1);
    });
    const recipe = {
      id: o + "_" + slug(nm), name: nm, out: o, qty: Math.max(1, parseInt(qty.value, 10) || 1),
      skill: undefined, req: Math.max(1, parseInt(req.value, 10) || 1), xp: Math.max(0, parseInt(xp.value, 10) || 0),
      in: inMap, tick: Math.max(0, Math.round((parseFloat(time.value) || 0) * 1000)),
      stations: station.value.trim() ? [station.value.trim()] : undefined,
      tool: tool.value.trim() ? slug(tool.value.trim()) : undefined,
    };
    await onSubmit(recipe);
    [name, out, inputs, station, tool].forEach(i => i.value = ""); qty.value = "1"; req.value = "1"; xp.value = "10"; time.value = "3";
  } })]));
}

// A gatherable-resource form for gathering skills (matches the "Gatherable
// resources" table columns: item / node name / level / tool / XP).
// `onSubmit(resource)` receives { item, name, req, tool, xp }.
function skResourceForm(host, onSubmit) {
  const item = el("input", { placeholder: "gathered item id, e.g. logs" });
  const node = el("input", { placeholder: "node name, e.g. Oak tree" });
  const req = el("input", { type: "number", value: "1", min: "1", max: String(Skillpedia.MAX), style: "width:80px" });
  const tool = el("input", { placeholder: "tool item id (optional), e.g. bronze_axe" });
  const xp = el("input", { type: "number", value: "10", min: "0", style: "width:90px" });

  host.appendChild(el("div.row", null, [
    el("label.field", { style: "flex:1" }, [el("span", { text: "Gathered item id" }), item]),
    el("label.field", { style: "flex:1" }, [el("span", { text: "Node name" }), node]),
  ]));
  host.appendChild(el("div.row", null, [
    el("label.field", { style: "flex:0 0 110px" }, [el("span", { text: "Req level" }), req]),
    el("label.field", { style: "flex:1" }, [el("span", { text: "Tool required" }), tool]),
    el("label.field", { style: "flex:0 0 110px" }, [el("span", { text: "XP per gather" }), xp]),
  ]));

  host.appendChild(el("div.btn-row", { style: "margin-top:.4rem" }, [el("button.btn.primary", { text: "Propose resource", onclick: async () => {
    const it = slug(item.value.trim());
    if (!it) return toast("Give the gathered item id.", "warn");
    const resource = {
      item: it, name: node.value.trim(), req: Math.max(1, parseInt(req.value, 10) || 1),
      tool: tool.value.trim() ? slug(tool.value.trim()) : null, xp: Math.max(0, parseInt(xp.value, 10) || 0),
    };
    await onSubmit(resource);
    [item, node, tool].forEach(i => i.value = ""); req.value = "1"; xp.value = "10";
  } })]));
}

// Propose a combat-skill milestone: a level + what it unlocks (combat skills
// train through combat, so no XP field — matches the milestone table).
function skMilestoneForm(host, onSubmit) {
  const lvl = el("input", { type: "number", value: "1", min: "1", max: String(Skillpedia.MAX), style: "width:90px" });
  const label = el("input", { placeholder: "what unlocks at this level, e.g. Wield the steel longsword" });
  host.appendChild(el("div.row", null, [
    el("label.field", { style: "flex:0 0 120px" }, [el("span", { text: "Level" }), lvl]),
    el("label.field", { style: "flex:1" }, [el("span", { text: "Unlock" }), label]),
  ]));
  host.appendChild(el("div.btn-row", { style: "margin-top:.4rem" }, [el("button.btn.primary", { text: "Propose milestone", onclick: async () => {
    const text = label.value.trim();
    if (!text) return toast("Describe what unlocks at this level.", "warn");
    const milestone = { level: Math.max(1, Math.min(Skillpedia.MAX, parseInt(lvl.value, 10) || 1)), label: text };
    await onSubmit(milestone);
    label.value = ""; lvl.value = "1";
  } })]));
}
