// ===== Our RPG Workshop — Quests =====
// Every quest in the game (currently everything loaded from zone[0,0]). Two kinds:
//   • hand-authored quests (Newhaven givers + world objects) — the real Lua,
//     inlined by tools/build.mjs into js/lua/lua-src-gen.js as LUA_SRC["quests/<id>"].
//   • procedural wilderness encounters (the mix quest-givers the world engine
//     scatters at quest icons) — each gets a complete, DETERMINISTIC Lua script
//     built from its position + the local bestiary, with a quality little story,
//     using only items/mobs the game already ships (nothing new to register).
// Every quest has a UNIQUE name and a UNIQUE snake_case id. allQuests() is the one
// canonical source shared by this page and the Zones tab, so links always match.
"use strict";

const _snake = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "quest";
function _qhash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const _mobName = key => (typeof MONSTERS !== "undefined" && MONSTERS[key] && MONSTERS[key].name) || String(key).replace(/_v$/, "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());

// nice names for the hand-authored Newhaven quests (their .lua hold the stories)
const AUTHORED_NAMES = {
  nh_quartermaster: "Keeping the Wilds Honest", nh_herbalist: "Simples and Sweet Remedies",
  nh_dockmaster: "The Harbour Ledger", nh_ranger: "The Road and the Cache",
  nh_urchin: "A Street Rat's Bargains", nh_archivist: "Room to Read", nh_cook: "The Bakehouse Rounds",
};

// ---------- procedural encounter generation ----------
// Each encounter is a PROPER multi-act quest (accept → objective → complication →
// branching choice → endings), built deterministically from the giver's tile and
// the local bestiary, using only items/mobs the game ships. Three story
// frameworks keep them varied; flavour lines are hash-picked from pools.
const _GATHER = [["logs", "Woodcutting", "seasoned timber"], ["herb", "Foraging", "sprigs of herb"], ["wheat", "Farming", "sheaves of wheat"], ["berries", "Foraging", "ripe berries"]];
const _RETRIEVE = [["iron_bar", "a bar of worked iron"], ["gem", "an uncut gem"], ["logs", "a bundle of rare heartwood"]];
const _FALLBACK_MOBS = ["goblin", "wolf", "bandit", "boar", "rat"];
const _pick = (arr, seed) => arr[(seed % arr.length + arr.length) % arr.length];
function _qcap(s) { return String(s).replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase()); }

// gate lines injected at a quest's accept branch, one blocking check per
// prerequisite (sequential, so no reliance on and / or). Each uses a real Lua
// reader: quest.<prevId> (>=4 == completed), skill_lvl(), qp().
function _gateMsg(p) {
  if (p.type === "quest") return `You'll want to finish ${p.name} before I trust you with this.`;
  if (p.type === "skill") return `Come back when your ${p.skill} is level ${p.level} or better.`;
  return `Earn your stripes first — I only deal with those who've won ${p.n} quest point${p.n > 1 ? "s" : ""}.`;
}
function _gateCond(p) {
  if (p.type === "quest") return `quest.${p.id} < 4`;
  if (p.type === "skill") return `skill_lvl("${p.skill}") < ${p.level}`;
  return `qp() < ${p.n}`;
}
function _gateLines(prereqs) {
  if (!prereqs || !prereqs.length) return "";
  return prereqs.map(p =>
`    if ${_gateCond(p)} then
      chatnpc("${_gateMsg(p)}")
      return
    end`).join("\n") + "\n";
}

function genQuestFor(giver, monsterKinds, variant) {
  const gx = giver.gx, gy = giver.gy, npc = giver.name, shire = giver.city || "the shire";
  const salt = n => _qhash("q:" + gx + "," + gy + ":" + (variant || 0) + ":" + n);
  const pool = (monsterKinds && monsterKinds.length) ? monsterKinds : _FALLBACK_MOBS;
  const mob = _pick(pool, salt("m")), mn = _mobName(mob), mnl = mn.toLowerCase();
  const mob2 = _pick(pool, salt("m2")), mn2 = _mobName(mob2), mnl2 = mn2.toLowerCase();
  const g1 = _pick(_GATHER, salt("g")), g2 = _pick(_GATHER, salt("g2"));
  const rr = _pick(_RETRIEVE, salt("r")), ritem = rr[0], rdesc = rr[1];
  const n1 = 3 + salt("n") % 5, n2 = 4 + salt("n2") % 6, gn = 8 + salt("gn") % 10;
  const rw = base => base + salt("rw") % 6 * 45, xp = 120 + salt("x") % 6 * 40;
  const fw = salt("fw") % 3;
  // this quest's OWN prerequisites (a skill-level and/or quest-point gate);
  // the series link (a prior quest) is added by allQuests where ids are known.
  const mainSkill = fw === 1 ? g1[1] : "Melee";
  const ownPrereqs = [];
  if (salt("pk") % 3 === 0) ownPrereqs.push({ type: "skill", skill: mainSkill, level: 4 + salt("pkl") % 16 });
  if (salt("pq") % 4 === 0) ownPrereqs.push({ type: "questpoints", n: 1 + salt("pqn") % 4 });
  const meta = { giver: npc, gx, gy, lx: giver.lx, ly: giver.ly, shire, ownPrereqs };

  if (fw === 0) {   // ===== the raiders' trail: hunt → recover → who owns the spoils =====
    const names = ["The " + mn + " Raiders", "Blood on the " + shire + " Road", "What the " + mn + "s Took", "The " + mn + " Reavers", "Cache of the " + mn + "s"];
    return Object.assign(meta, { kind: "raiders", baseName: _pick(names, salt("nm")), build: (name, id, prereqs) =>
`-- ${name} — a three-act encounter from ${npc}.
-- Act 1 break the ${mnl} raiders; Act 2 recover the cache they hoarded; Act 3
-- decide whether it goes back to ${shire} or into your own purse.
on_npc("${npc}", function()
  if quest.${id} == 0 then
${_gateLines(prereqs)}    chatnpc("${_pick(["The " + mnl + " have been raiding our carts for a month. Break " + n1 + " of them and follow their trail — I'll make it worth your while.", "Every week the " + mnl + " take a little more of " + shire + ". Cut down " + n1 + " and find where they den.", "Travellers won't come through for the " + mnl + ". Thin them — " + n1 + " should do — and see what they're hoarding."], salt("h"))}")
    if choice("I'll take the trail.", "Find another sword.") == 1 then
      quest.${id}_kills = kills("${mob}")
      quest.${id} = 1
      mes("${name} (1/3): break the ${mnl} raiders (0/${n1}).")
    else
      chatnpc("Then pray they tire of us first.")
    end
    return
  end
  if quest.${id} == 1 then
    if kills("${mob}") - quest.${id}_kills >= ${n1} then
      quest.${id} = 2
      chatnpc("${_pick(["That's their teeth pulled. Now — their camp's off the road, past the treeline. Bring back whatever they've stashed.", "Well struck. They den in the scrub beyond the bend; search it for the cache they've been filling."], salt("a"))}")
      mes("${name} (2/3): recover the raiders' cache from the wilds.")
    else
      chatnpc("${n1} ${mnl}. The trail's still warm — don't let it cool.")
    end
    return
  end
  if quest.${id} == 2 then
    if has_item("${ritem}") then
      del_item("${ritem}", 1)
      quest.${id} = 3
      chatnpc("You found ${rdesc}! ...but this bears ${shire}'s own mark. This was taken from honest folk.")
      mes("${name} (3/3): decide what becomes of the cache.")
    else
      chatnpc("Their camp's past the treeline where the road bends. ${_qcap(rdesc)} should be among the loot.")
    end
    return
  end
  if quest.${id} == 3 then
    if choice("Return it to ${shire} — it's theirs.", "Keep it. Spoils are spoils.") == 1 then
      quest.${id} = 4
      add_item("coins", ${rw(220)})
      give_xp("Melee", ${xp})
      quest_point(2)
      chatnpc("You honest soul. ${shire} won't forget it — and neither will I. Here, from the grateful.")
      mes("${name} complete — the cache came home.")
    else
      quest.${id} = 5
      add_item("coins", ${rw(420)})
      quest_point(1)
      chatnpc("...quietly, then. Your risk, your reward. We never had this talk.")
      mes("${name} complete — richer, and no one the wiser.")
    end
    return
  end
  chatnpc("The road's ours again. Watch yourself past the walls.")
end)
` });
  }

  if (fw === 1) {   // ===== winter stores: gather → gather harder → give or sell =====
    const names = ["Winter Stores for " + shire, "The " + _qcap(g1[0]) + " Run", "A " + _qcap(g2[0]) + " Harvest", shire + "'s Larder", "Laying in " + _qcap(g1[0])];
    return Object.assign(meta, { kind: "stores", baseName: _pick(names, salt("nm")), build: (name, id, prereqs) =>
`-- ${name} — a two-part provisioning quest from ${npc}, ending in a
-- choice: give the surplus to the ward's poor, or sell it for a fatter purse.
on_npc("${npc}", function()
  if quest.${id} == 0 then
${_gateLines(prereqs)}    chatnpc("${_pick(["The lean season's coming and " + shire + "'s stores are near bare. Start me with " + gn + " " + g1[2] + "?", "If we don't lay in supplies now, folk go hungry by midwinter. " + gn + " " + g1[2] + " — will you gather it?"], salt("h"))}")
    if choice("I'll gather them.", "No time.") == 1 then
      quest.${id} = 1
      mes("${name} (1/3): bring ${gn} ${g1[0]}.")
    else
      chatnpc("The cold doesn't wait, friend.")
    end
    return
  end
  if quest.${id} == 1 then
    if count_item("${g1[0]}") >= ${gn} then
      del_item("${g1[0]}", ${gn})
      quest.${id} = 2
      give_xp("${g1[1]}", ${xp})
      chatnpc("Bless you. It's a start — but the pantry needs more than one thing. Could you bring ${n2 + 4} ${g2[2]} as well?")
      mes("${name} (2/3): bring ${n2 + 4} ${g2[0]}.")
    else
      chatnpc("${gn} ${g1[2]}, mind. Every little helps.")
    end
    return
  end
  if quest.${id} == 2 then
    if count_item("${g2[0]}") >= ${n2 + 4} then
      del_item("${g2[0]}", ${n2 + 4})
      quest.${id} = 3
      give_xp("${g2[1]}", ${xp})
      chatnpc("The larder's full at last. There's surplus, even — and here's the question. Do we hand it to the ward's poor, or sell it and keep the coin?")
      mes("${name} (3/3): decide what to do with the surplus.")
    else
      chatnpc("${n2 + 4} ${g2[2]}. The shelves are still half-empty.")
    end
    return
  end
  if quest.${id} == 3 then
    if choice("Give it to the poor.", "Sell it — coin keeps too.") == 1 then
      quest.${id} = 4
      add_item("coins", ${rw(120)})
      quest_point(2)
      chatnpc("You've a good heart. The ward will eat, and word of it will travel. Take this, small as it is.")
      mes("${name} complete — ${shire} will remember the kindness.")
    else
      quest.${id} = 5
      add_item("coins", ${rw(300)})
      quest_point(1)
      chatnpc("Practical. The market paid well — here's your share of it.")
      mes("${name} complete — the coffers over the kitchens.")
    end
    return
  end
  chatnpc("Stores are full and the cold holds no fear. My thanks again.")
end)
` });
  }

  // ===== the beast of the shire: find the sign → hunt the beast → trophy or hide =====
  const names = ["The Beast of " + shire, "Something in the " + _qcap(g1[0]), "The " + mn2 + " That Won't Die", "Hunt for the " + mn2, "The " + mn2 + " Killings"];
  return Object.assign(meta, { kind: "beast", baseName: _pick(names, salt("nm")), build: (name, id, prereqs) =>
`-- ${name} — an investigate-then-hunt encounter from ${npc}. Find the
-- sign it left, run the beast down, then choose the trophy or the trader's coin.
on_npc("${npc}", function()
  if quest.${id} == 0 then
${_gateLines(prereqs)}    chatnpc("${_pick(["Something's been killing our stock by night and leaving no tracks a man can read. Find what it dropped out past the fields — then we'll talk.", "Folk whisper of a beast in the dark beyond " + shire + ". I don't hold with whispers, but the sheep are gone. Find its sign."], salt("h"))}")
    if choice("I'll look into it.", "Sounds like a tale.") == 1 then
      quest.${id} = 1
      mes("${name} (1/3): find the beast's sign in the wilds.")
    else
      chatnpc("Tell that to the shepherds.")
    end
    return
  end
  if quest.${id} == 1 then
    if has_item("${ritem}") then
      del_item("${ritem}", 1)
      quest.${id} = 2
      quest.${id}_kills = kills("${mob2}")
      chatnpc("${_qcap(rdesc)}, dragged from a kill... it's ${mnl2}, and more than one. Put down ${n2} of them and the killing stops.")
      mes("${name} (2/3): hunt the ${mnl2} (0/${n2}).")
    else
      chatnpc("Out past the fields, where the grass goes flat. It left something — bring it to me.")
    end
    return
  end
  if quest.${id} == 2 then
    if kills("${mob2}") - quest.${id}_kills >= ${n2} then
      quest.${id} = 3
      chatnpc("It's done — I can see it in your face. There's a fine hide on the biggest of them. Mount it for the hall, or sell it to a trader?")
      mes("${name} (3/3): the trophy, or the trader's coin?")
    else
      chatnpc("${n2} ${mnl2}. Finish what you started.")
    end
    return
  end
  if quest.${id} == 3 then
    if choice("Mount it in the hall.", "Sell the hide.") == 1 then
      quest.${id} = 4
      add_item("coins", ${rw(160)})
      give_xp("Melee", ${xp})
      quest_point(2)
      chatnpc("It'll hang over the hearth for a hundred years, and your name with it. ${shire}'s in your debt.")
      mes("${name} complete — a legend for the hall.")
    else
      quest.${id} = 5
      add_item("coins", ${rw(340)})
      quest_point(1)
      chatnpc("The trader paid handsomely — here's the better part of it. Warm coin beats a dusty trophy.")
      mes("${name} complete — the hide sold, the purse full.")
    end
    return
  end
  chatnpc("The nights are quiet again. The stock sleep easy, and so do I.")
end)
` });
}

// A giver may hand out a short SERIES (deterministic length). Each later quest
// is a different story (its own variant salt) and requires the previous one.
function genQuestChain(giver, monsterKinds) {
  const cs = _qhash("chain:" + giver.gx + "," + giver.gy);
  const len = (cs % 6 === 0) ? 3 : (cs % 5 < 2) ? 2 : 1;   // ~40% series, ~17% of those 3-long
  const out = [];
  for (let i = 0; i < len; i++) out.push(genQuestFor(giver, monsterKinds, i));
  return out;
}

function monsterKindsForCity(manifest, city) {
  const out = [], seen = new Set();
  for (const m of (manifest && manifest.monsters) || []) if (m.city === city && !seen.has(m.key)) { seen.add(m.key); out.push(m.key); }
  return out;
}

// ---------- the one canonical quest list (cached per manifest) ----------
const _allQuestsCache = new WeakMap();
function allQuests(manifest) {
  if (!manifest) return { list: [], byGiver: new Map(), byId: new Map() };
  if (_allQuestsCache.has(manifest)) return _allQuestsCache.get(manifest);
  const npcs = manifest.npcs || [], list = [], byGiver = new Map(), byId = new Map();
  const usedName = new Set(), usedId = new Set();
  const uniqName = base => { let nm = base, k = 2; while (usedName.has(nm)) nm = base + " " + (k++); usedName.add(nm); return nm; };
  const uniqId = base => { let id = _snake(base), k = 2, o = id; while (usedId.has(id)) id = o + "_" + (k++); usedId.add(id); return id; };
  // byGiver maps a giver tile → its FIRST quest (the series entry point), so the
  // Zones tab still resolves one quest per giver row even when it's a series.
  const add = q => { list.push(q); byId.set(q.id, q); if (q.gx != null && !byGiver.has(q.gx + "," + q.gy)) byGiver.set(q.gx + "," + q.gy, q); };

  // 1) hand-authored anchors — one questline per Newhaven giver
  for (const g of (typeof QUEST_GIVERS !== "undefined" ? QUEST_GIVERS : [])) {
    const n = npcs.find(x => x.role === "quest-anchor" && x.name === g.name);
    if (!n) continue;
    const name = uniqName(AUTHORED_NAMES[g.script] || questDisplayName(g.script));
    add({ id: uniqId(g.script), name, kind: "authored", giver: g.name + " (" + g.title + ")", giverNpc: { name: n.name, mixIndex: n.mixIndex, lx: n.lx, ly: n.ly, city: n.city }, shire: n.city, gx: n.gx, gy: n.gy, lx: n.lx, ly: n.ly, line: g.line, code: (typeof LUA_SRC !== "undefined" && LUA_SRC["quests/" + g.script]) || null });
  }
  // 2) the Newhaven plaza quest objects (qloc.lua)
  if (typeof QUEST_LOCS !== "undefined" && QUEST_LOCS.length && npcs.some(n => n.role === "quest-anchor"))
    add({ id: uniqId("Newhaven Plaza Caches"), name: uniqName("The Plaza Caches"), kind: "objects", giver: "world objects (retrieve targets)", shire: "Newhaven", code: (typeof LUA_SRC !== "undefined" && LUA_SRC["quests/qloc"]) || null });
  // 3) procedural encounters — deterministic order by tile
  const givers = npcs.filter(n => n.role === "quest-giver").sort((a, b) => a.gx - b.gx || a.gy - b.gy);
  for (const g of givers) {
    const chain = genQuestChain(g, monsterKindsForCity(manifest, g.city));
    const giverNpc = { name: g.name, mixIndex: g.mixIndex, lx: g.lx, ly: g.ly, city: g.city };
    let prev = null;
    chain.forEach(base => {
      const name = uniqName(base.baseName), id = uniqId(name);
      const prereqs = (base.ownPrereqs || []).slice();
      if (prev) prereqs.push({ type: "quest", id: prev.id, name: prev.name });   // series link
      add({ id, name, kind: base.kind, giver: base.giver, giverNpc, shire: base.shire, gx: base.gx, gy: base.gy, lx: base.lx, ly: base.ly, prereqs, code: base.build(name, id, prereqs) });
      prev = { id, name };
    });
  }
  const out = { list, byGiver, byId };
  _allQuestsCache.set(manifest, out);
  return out;
}
function questDisplayName(id) { id = String(id).replace(/^quests\//, ""); if (id === "qloc") return "Quest Objects"; return id.replace(/^nh_/, "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase()); }

// ---------- reward / prerequisite extraction from Lua ----------
const _itemName = id => (typeof ITEMS !== "undefined" && ITEMS[id] && ITEMS[id].name) || String(id).replace(/_/g, " ");
// ONE reward per item type (coins / each item / each skill's XP / quest points),
// with an ABSOLUTE quantity — where choice-based endings pay different amounts,
// the largest is shown. Never a range, never a duplicated line. Parses the Lua
// verbs: add_item("id", n), give_xp("Skill", n), quest_point(n).
function questRewards(code) {
  if (!code) return [];
  const by = new Map();   // type:key → entry (max qty wins)
  const bump = (type, key, qty) => { const k = type + ":" + (key || ""); const e = by.get(k); if (!e || qty > e.qty) by.set(k, { type, key, qty }); };
  for (const m of code.matchAll(/add_item\(\s*"([A-Za-z_]\w*)"\s*,\s*(\d+)\s*\)/g))
    m[1] === "coins" ? bump("coins", "", +m[2]) : bump("item", m[1], +m[2]);
  for (const m of code.matchAll(/give_xp\(\s*"([A-Za-z_]\w*)"\s*,\s*(\d+)\s*\)/g)) bump("xp", m[1], +m[2]);
  for (const m of code.matchAll(/quest_point\(\s*(\d+)\s*\)/g)) bump("qp", "", +m[1]);
  const rank = { coins: 0, item: 1, xp: 2, qp: 3 };
  return [...by.values()].map(e => Object.assign(e, {
    label: e.type === "coins" ? e.qty.toLocaleString() + " coins"
      : e.type === "item" ? e.qty + " " + _itemName(e.key)
      : e.type === "xp" ? e.qty + " " + e.key + " XP"
      : e.qty + " quest point" + (e.qty > 1 ? "s" : ""),
  })).sort((a, b) => (rank[a.type] - rank[b.type]) || String(a.key).localeCompare(String(b.key)));
}
// the game icon for one reward: real item icon (coins/items via the Icons
// provider), real skill icon (XP, from the Skills tab), emoji for quest points.
function _rewardItemIcon(id, px) {
  const ui = (typeof Providers !== "undefined") && Providers.get("ui");
  const entry = ui && (ui.entry("item:" + id) || ui.entry(id));
  if (entry && ui.draw) {
    const cv = el("canvas", { width: 32, height: 32, style: "width:" + px + "px;height:" + px + "px;image-rendering:pixelated;flex:none" });
    try { ui.draw(cv, entry, 0); return cv; } catch (_) {}
  }
  return null;
}
function rewardIcon(e, px) {
  px = px || 22;
  if (e.type === "qp") return el("span", { style: "flex:none;font-size:" + px + "px;line-height:1", text: "⭐" });
  if (e.type === "xp") { if (typeof skSkillIcon === "function") { try { return skSkillIcon(e.key, null, px); } catch (_) {} } return el("span", { style: "flex:none", text: "✨" }); }
  const cv = _rewardItemIcon(e.type === "coins" ? "coins" : e.key, px);
  return cv || el("span", { style: "flex:none", text: e.type === "coins" ? "🪙" : "📦" });
}
// prerequisites: quests reference other quest ids only via quests[<id>]; a
// generated/authored quest that gates on ANOTHER quest names it here. Its own
// progress var (id / id_kills) is not a prerequisite.
// Typed prerequisites for a quest. Generated quests carry them structured on
// q.prereqs; for anything else (authored) we read the gate lines back from its
// Lua: skill_lvl("S") < N, qp() < N, quest.other < N.
function questPrereqs(q, Q) {
  if (q.prereqs && q.prereqs.length) return q.prereqs;
  const code = q.code; if (!code) return [];
  const byId = Q && Q.byId, out = [], seen = new Set();
  const push = e => { const k = JSON.stringify(e); if (seen.has(k)) return; seen.add(k); out.push(e); };
  for (const m of code.matchAll(/skill_lvl\(\s*"([A-Za-z_]\w*)"\s*\)\s*<\s*(\d+)/g)) push({ type: "skill", skill: m[1], level: +m[2] });
  for (const m of code.matchAll(/qp\(\)\s*<\s*(\d+)/g)) push({ type: "questpoints", n: +m[1] });
  for (const m of code.matchAll(/quest\.([A-Za-z_]\w*)\s*<\s*(\d+)/g)) {
    const v = m[1];
    if (v === q.id || v.startsWith(q.id + "_")) continue;
    if (byId && byId.has(v)) push({ type: "quest", id: v, name: byId.get(v).name });
  }
  return out;
}
// one prerequisite → a display line (quest link · skill icon+level · quest points)
function prereqLine(p, Q) {
  if (p.type === "quest") {
    const t = Q && Q.byId.get(p.id);
    return el("div", { style: "display:flex;align-items:center;gap:.35rem;white-space:nowrap" }, [
      el("span", { style: "flex:none", text: "📜" }),
      el("a", { href: "#/quests?id=" + encodeURIComponent(p.id), style: "color:var(--gold);text-decoration:none", text: t ? t.name : (p.name || p.id) }),
    ]);
  }
  if (p.type === "skill") {
    const icon = (typeof skSkillIcon === "function") ? (() => { try { return skSkillIcon(p.skill, null, 20); } catch (_) { return el("span", { text: "✨" }); } })() : el("span", { text: "✨" });
    return el("div", { style: "display:flex;align-items:center;gap:.35rem;white-space:nowrap" }, [icon, el("span", { text: p.skill + " Lvl " + p.level })]);
  }
  return el("div", { style: "display:flex;align-items:center;gap:.35rem;white-space:nowrap" }, [
    el("span", { style: "flex:none", text: "⭐" }), el("span", { text: p.n + " quest point" + (p.n > 1 ? "s" : "") }),
  ]);
}

// ---------- page ----------
function pageQuests(root, params) {
  clear(root);
  const page = el("div.page");
  page.appendChild(el("div.banner.info", { html: "Every quest baked into the world — hand-authored quest lines and procedural wilderness encounters, each with a unique name, id and full <b>Lua</b> source, across all baked zones." }));
  const host = el("div", null, [el("div.center-col", null, [el("div.spinner"), el("small", { text: "Loading quests…" })])]);
  page.appendChild(host);
  root.appendChild(page);
  const id = params && params.get("id");
  const zonesP = (typeof bakedZones === "function") ? bakedZones() : Promise.resolve(["0,0"]);
  zonesP.then(zones => Promise.all(zones.map(z => {
    const p = z.split(",").map(s => parseInt(s, 10));
    return fetch(STUDIO_BASE + "assets/zones/zone_" + p[0] + "_" + p[1] + ".json", { cache: "force-cache" })
      .then(r => r.ok ? r.json() : null).then(m => ({ z, m })).catch(() => ({ z, m: null }));
  }))).then(results => {
    clear(host);
    // combine quests across every baked zone (ids are globally unique); tag each
    // with its zone so links / votes / the zone column resolve per-quest.
    const list = [], byId = new Map(), zoneSet = [];
    for (const { z, m } of results) {
      if (!m) continue;
      const Q = allQuests(m); zoneSet.push(z);
      for (const q of Q.list) { q._zone = z; list.push(q); byId.set(q.id, q); }
    }
    const combined = { list, byId };
    // keep/remove tallies merged across zones (field = quest id); casts go to each
    // quest's own zone subject (questVoteCell uses q._zone).
    const voteState = {
      folder: "0,0", tallies: {}, cells: [],
      refetch: async () => {
        const merged = {};
        await Promise.all(zoneSet.map(async z => { try { if (typeof Taiao !== "undefined" && Taiao.tally) Object.assign(merged, (await Taiao.tally("quest", z)) || {}); } catch (_) {} }));
        voteState.tallies = merged; voteState.cells.forEach(fn => { try { fn(); } catch (_) {} });
      },
    };
    // the map icon quest markers use on the world map (game-wide; votable)
    if (typeof mapIconVoteRow === "function") {
      const mc = el("div.card");
      mc.appendChild(el("div.sectitle", null, [el("h3", null, ["Quest map icon ", el("span.hint", { text: "how quests are marked on the map — vote to change" })])]));
      mc.appendChild(mapIconVoteRow("quest", "all", "quest"));
      host.appendChild(mc);
    }
    if (id && byId.has(id)) { const q = byId.get(id); host.appendChild(questDetailCard(q, combined, q._zone, voteState)); }
    host.appendChild(questsTableCard(combined, null, id, voteState));
    voteState.refetch();
  }).catch(() => { clear(host); host.appendChild(el("div.empty", { text: "Couldn't load quests." })); });
}

// the quest-start NPC cell: sprite + name, linking to that NPC's own page.
function questGiverCell(q, zone) {
  const g = q.giverNpc;
  if (!g) return el("span.hint", { text: q.giver || "—" });
  const idPart = (typeof npcId === "function") ? "&id=" + encodeURIComponent(npcId(g, zone)) : "";
  const href = "#/npc?zone=" + encodeURIComponent(zone) + "&at=" + g.lx + "," + g.ly + idPart;
  const thumb = (typeof npcThumb === "function") ? npcThumb(g.mixIndex, 40) : el("span");
  return el("div", { style: "display:flex;align-items:center;gap:.5rem" }, [
    el("a", { href, title: g.name, style: "flex:none;line-height:0" }, [thumb]),
    el("a", { href, style: "color:var(--gold);text-decoration:none;font-weight:600", text: g.name }),
  ]);
}
function questNameCell(q) {
  const zq = q._zone ? "&zone=" + encodeURIComponent(q._zone) : "";
  return el("a", { href: "#/quests?id=" + encodeURIComponent(q.id) + zq, style: "color:var(--gold);text-decoration:none;font-weight:600", text: q.name });
}
// rewards, one per line, each with its real game icon
function rewardsCell(q) {
  const r = questRewards(q.code);
  if (!r.length) return el("span.hint", { text: "—" });
  return el("div", { style: "display:flex;flex-direction:column;gap:.25rem" },
    r.map(x => el("div", { style: "display:flex;align-items:center;gap:.4rem;white-space:nowrap" }, [
      rewardIcon(x, 22), el("span", { text: x.label }),
    ])));
}
function prereqsCell(q, Q) {
  const pr = questPrereqs(q, Q);
  if (!pr.length) return el("span.hint", { text: "None" });
  return el("div", { style: "display:flex;flex-direction:column;gap:.25rem" }, pr.map(p => prereqLine(p, Q)));
}
// author cell: a human-submitted quest carries its author's username in
// q.author; everything currently in the game is procedurally/AI authored (no
// q.author), so it just reads "AI".
function authorCell(q) {
  const human = q.author && q.author !== "AI";
  return el("span.badge", { title: human ? "Submitted by " + q.author : "Procedurally / AI authored",
    text: human ? "👤 " + q.author : "🤖 AI" });
}
// keep/remove vote for a quest — inline buttons (the main-page-table convention);
// the detail card uses the 🗳 glyph instead. One ballot field per quest id.
function questVoteCell(state, q) {
  return VoteWidget.buttons({
    kind: "quest", folder: q._zone || state.folder, field: q.id, label: q.name,
    getTallies: () => state.tallies, refetch: state.refetch,
    register: fn => state.cells.push(fn),
  });
}

function questDetailCard(q, Q, zone, voteState) {
  const card = el("div.card");
  // individual/detail pages vote via the 🗳 glyph (keep/remove), not buttons
  const glyph = voteState ? VoteWidget.symbol({
    kind: "quest", folder: q._zone || zone || voteState.folder, field: q.id, type: "select",
    choices: ["keep", "remove"], current: "keep", currentLabel: "keep", label: q.name,
    getTallies: () => voteState.tallies, refetch: voteState.refetch,
  }) : null;
  card.appendChild(el("div.sectitle", null, [el("h3", null, [q.name, " ", el("span.hint", { text: q.id })]),
    el("span", { style: "display:inline-flex;align-items:center;gap:.5rem" }, [
      el("span.badge", { text: q.code ? (q.code.split("\n").length + " lines") : "no script" }), glyph,
    ].filter(Boolean))]));
  const kv = el("dl.kv");
  const add = (k, v) => { kv.appendChild(el("dt", { text: k })); kv.appendChild(el("dd", null, [].concat(typeof v === "string" ? el("span", { text: v }) : v))); };
  add("Quest id", q.id);
  if (zone) add("Zone", "(" + zone + ")");
  if (q.giver) add("Quest start", q.giver);
  if (q.shire) add("Shire", q.shire);
  if (q.lx != null) add("Location", "(" + q.lx + ", " + q.ly + ")");
  add("Prerequisites", prereqsCell(q, Q));
  add("Rewards", rewardsCell(q));
  card.appendChild(kv);
  if (q.line) card.appendChild(el("p.tagline", { style: "font-style:italic;margin:.2rem 0 .5rem", text: q.line }));
  if (q.code) {
    card.appendChild(el("h3", { style: "font-size:.9rem;margin-top:.6rem", text: "Lua source" }));
    card.appendChild(el("pre", { style: "margin:.2rem 0;padding:.7rem .9rem;background:#0b0d10;border-radius:8px;overflow-x:auto;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;color:#d8e0ea;white-space:pre", text: q.code }));
  } else card.appendChild(el("div.empty", { text: "No Lua source." }));
  return card;
}
function questsTableCard(Q, zone, activeId, voteState) {
  const quests = Q.list;
  const card = el("div.card");
  const submitBtn = el("button.btn.sm.primary", { type: "button", text: "＋ Submit quest", onclick: () => openSubmitQuestDialog(zone || "0,0", Q) });
  card.appendChild(el("div.sectitle", null, [el("h3", null, ["All quests ", el("span.hint", { text: "hand-authored + procedural" })]),
    el("span", { style: "display:inline-flex;align-items:center;gap:.5rem" }, [el("span.badge", { text: String(quests.length) }), submitBtn])]));
  if (!quests.length) { card.appendChild(el("div.empty", { html: "<div class='big'>📜</div>No quests loaded." })); return card; }
  const order = { authored: 0, objects: 1, raiders: 2, stores: 3, beast: 4 };
  const rows = quests.slice().sort((a, b) => ((order[a.kind] ?? 9) - (order[b.kind] ?? 9)) || a.name.localeCompare(b.name)).map(q => ({
    cells: [
      questNameCell(q),
      questGiverCell(q, q._zone || zone),
      el("span.mono", { text: q.lx != null ? "(" + q.lx + ", " + q.ly + ")" : "—" }),
      el("span.mono", { text: q._zone || zone }),
      authorCell(q),
      prereqsCell(q, Q),
      rewardsCell(q),
      questVoteCell(voteState, q),
    ],
  }));
  card.appendChild(ztable(["Quest name", "quest start", "start coordinates", "zone", "author",
    { label: "prerequisites", nofilter: true }, { label: "rewards", nofilter: true }, { label: "vote", nofilter: true }], rows));
  return card;
}

// ---------- "Submit quest" dialog ----------
// shared datalist for the id fields: abstract ids first (coins / quest points /
// per-skill XP), then every real item id — so a row's id field is a typed
// item_id OR a pick from the abstract dropdown, as one combobox.
function questIdDatalist() {
  const ID = "quest-reward-ids";
  if (document.getElementById(ID)) return ID;
  const dl = el("datalist", { id: ID });
  dl.appendChild(el("option", { value: "coins", label: "Coins" }));
  dl.appendChild(el("option", { value: "quest_points", label: "Quest points" }));
  try {   // one "<skill>_xp" abstract id per skill (SKILLS is an id array), if loaded
    const ids = (typeof SKILLS !== "undefined" && Array.isArray(SKILLS)) ? SKILLS : null;
    if (ids && ids.length) ids.forEach(k => dl.appendChild(el("option", { value: k + "_xp", label: _qcap(k) + " XP" })));
    else dl.appendChild(el("option", { value: "xp", label: "XP (skill experience)" }));
  } catch (_) { dl.appendChild(el("option", { value: "xp", label: "XP" })); }
  try { if (typeof ITEMS !== "undefined") Object.keys(ITEMS).forEach(id => dl.appendChild(el("option", { value: id, label: (ITEMS[id] && ITEMS[id].name) || id }))); } catch (_) {}
  document.body.appendChild(dl);
  return ID;
}
// a repeatable group of "{quantity} + {id}" rows with an "＋ Add" button; used
// for both Prerequisites and Rewards. Exposes ._rows() → [{ qty, id }, …].
function questRowGroup(labelSingular) {
  const host = el("div", { style: "display:flex;flex-direction:column;gap:.4rem" });
  const rowsHost = el("div", { style: "display:flex;flex-direction:column;gap:.35rem" });
  host.appendChild(rowsHost);
  function addRow() {
    const qtyIn = el("input", { type: "number", min: "1", value: "1" });
    const idIn = el("input", { placeholder: "item id — or coins / quest_points / <skill>_xp", autocomplete: "off" });
    idIn.setAttribute("list", questIdDatalist());
    const rm = el("button.btn.sm.ghost", { type: "button", text: "×", title: "remove this row" });
    const row = el("div.row", { style: "gap:.4rem;align-items:flex-end" }, [
      el("label.field", { style: "flex:0 0 90px;margin:0" }, [el("span", { text: "Qty" }), qtyIn]),
      el("label.field", { style: "flex:1;margin:0" }, [el("span", { text: labelSingular + " id" }), idIn]),
      rm,
    ]);
    rm.onclick = () => row.remove();
    row._get = () => { const id = idIn.value.trim(); return id ? { qty: Math.max(1, parseInt(qtyIn.value, 10) || 1), id } : null; };
    rowsHost.appendChild(row);
  }
  host.appendChild(el("button.btn.sm", { type: "button", text: "＋ Add " + labelSingular.toLowerCase(), onclick: addRow }));
  addRow();   // start with one blank row
  host._rows = () => [...rowsHost.children].map(r => r._get && r._get()).filter(Boolean);
  return host;
}
function openSubmitQuestDialog(zone, Q) {
  const bg = el("div.modal-bg", { onclick: e => { if (e.target === bg) bg.remove(); } });
  const m = el("div.modal");
  m.appendChild(el("span.x", { text: "×", onclick: () => bg.remove() }));
  m.appendChild(el("h2", { text: "Submit a quest" }));
  m.appendChild(el("p.tagline", { text: "Propose a new quest for the community to vote on." }));

  const nameIn = el("input", { placeholder: "Quest name, e.g. The Harbour Ledger" });
  const idIn = el("input", { placeholder: "quest_id, e.g. the_harbour_ledger", autocomplete: "off" });
  const zoneIn = el("input", { value: zone || "0,0", placeholder: "zone, e.g. 0,0" });
  const shireIn = el("input", { placeholder: "shire, e.g. Newhaven" });
  const npcIn = el("input", { placeholder: "quest start NPC id, e.g. nh_dockmaster" });
  const locIn = el("input", { placeholder: "e.g. 42, 17" });
  const me = (typeof Taiao !== "undefined" && Taiao.username && Taiao.username()) || "";
  const authorIn = el("select");
  [["self", me ? "👤 " + me + " (me)" : "👤 Me"], ["ai", "🤖 AI"]].forEach(([v, l]) => authorIn.appendChild(el("option", { value: v, text: l })));

  // quest id auto-derives from the name until the user edits it by hand
  let idTouched = false;
  nameIn.oninput = () => { if (!idTouched) idIn.value = _snake(nameIn.value); };
  idIn.oninput = () => { idTouched = true; };

  m.appendChild(el("div.row", null, [
    el("label.field", { style: "flex:2" }, [el("span", { text: "Quest name" }), nameIn]),
    el("label.field", { style: "flex:2" }, [el("span", { text: "Quest id" }), idIn]),
  ]));
  m.appendChild(el("div.row", null, [
    el("label.field", { style: "flex:1" }, [el("span", { text: "Zone" }), zoneIn]),
    el("label.field", { style: "flex:1" }, [el("span", { text: "Shire" }), shireIn]),
    el("label.field", { style: "flex:1;min-width:150px" }, [el("span", { text: "Author" }), authorIn]),
  ]));
  m.appendChild(el("div.row", null, [
    el("label.field", { style: "flex:2" }, [el("span", { text: "Quest start NPC (id)" }), npcIn]),
    el("label.field", { style: "flex:1" }, [el("span", { text: "Start NPC location" }), locIn]),
  ]));

  m.appendChild(el("h3", { style: "font-size:.9rem;margin:.7rem 0 .2rem", text: "Prerequisites" }));
  const prereqs = questRowGroup("Prerequisite");
  m.appendChild(prereqs);

  m.appendChild(el("h3", { style: "font-size:.9rem;margin:.7rem 0 .2rem", text: "Rewards" }));
  const rewards = questRowGroup("Reward");
  m.appendChild(rewards);

  // load a Lua script file — its text rides along with the proposal
  let scriptText = null;
  const fileStatus = el("span.tagline", { text: "No Lua file loaded." });
  const fileInput = el("input", {
    type: "file", accept: ".lua,.txt,text/plain", style: "display:none",
    onchange: e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { scriptText = String(rd.result || ""); fileStatus.textContent = "Loaded " + f.name + " (" + scriptText.split("\n").length + " lines)."; };
      rd.onerror = () => toast("Couldn't read that file.", "err");
      rd.readAsText(f);
    },
  });
  m.appendChild(el("h3", { style: "font-size:.9rem;margin:.7rem 0 .2rem", text: "Lua script" }));
  m.appendChild(el("div.btn-row", { style: "align-items:center;gap:.5rem" }, [
    el("button.btn.sm", { type: "button", text: "📄 Load Lua file", onclick: () => fileInput.click() }),
    fileInput, fileStatus,
  ]));

  const status = el("div.tagline", { style: "min-height:1.2em" });
  const submit = el("button.btn.primary", { text: "Submit quest", onclick: async () => {
    const name = nameIn.value.trim(); if (!name) return toast("Name the quest.", "warn");
    if (typeof Taiao === "undefined" || !Taiao.logged || !Taiao.logged()) { toast("Sign in to submit.", "warn"); bg.remove(); App.go("#/settings"); return; }
    const quest = {
      name, id: _snake(idIn.value.trim() || name),
      author: authorIn.value === "ai" ? "AI" : ((Taiao.username && Taiao.username()) || "unknown"),
      zone: zoneIn.value.trim() || zone || "0,0",
      shire: shireIn.value.trim() || undefined,
      startNpc: npcIn.value.trim() || undefined,
      startLoc: locIn.value.trim() || undefined,
      prereqs: prereqs._rows(),
      rewards: rewards._rows(),
      lua: scriptText || undefined,
    };
    submit.disabled = true; status.textContent = "Submitting…";
    try {
      // An uploaded Lua script is user-supplied content → curator review;
      // a quest built purely from the form fields is auto-voteable data.
      const src = scriptText ? "upload" : "data";
      const r = await Taiao.submitProposal("quest", quest.id, name, { schema: "taiao-quest/1", quest }, src);
      if (r && r.error) { status.textContent = ""; toast(r.error, "err"); submit.disabled = false; return; }
      toast("Quest submitted.", "ok"); bg.remove();
    } catch (e) { status.textContent = ""; toast((e && e.message) || "Submit failed.", "err", 6000); submit.disabled = false; }
  } });
  m.appendChild(status);
  m.appendChild(el("div.btn-row", { style: "margin-top:.6rem" }, [submit, el("button.btn.ghost", { text: "Cancel", onclick: () => bg.remove() })]));
  bg.appendChild(m); document.body.appendChild(bg);
}
