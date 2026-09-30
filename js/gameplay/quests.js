// ===== Taiao — QUEST system =====
// Multi-step quests that send the player around the world: TALK to villagers in
// distant towns, carry LETTERS, SLAY specific monsters, COLLECT & DELIVER goods,
// UNLOCK sealed rooms and RETRIEVE what's hidden inside — rewarding coins, skill
// XP, items and passage to newly-revealed places. Quests are DETERMINISTIC (a
// given quest-giver always offers the same quest, anchored to real nearby
// settlements/monsters) and come in a SERIES: finish one and the giver offers
// the next, with rewards that grow. Offered by the ✦ quest-giver NPCs at the
// quest markers on the world map. Progress is saved (storage.js player.quests).
"use strict";

(function () {
  // ---- quest items (all PLACEHOLDER icons: defineIcon hue-tints of existing
  // sprites, registered in the art audit so real art can replace them later) ----
  let _itemsReady = false;
  function ensureItems() {
    if (_itemsReady || typeof ITEMS === "undefined" || typeof SPR === "undefined") return;
    const mk = (id, name, base, tint, examine) => {
      if (ITEMS[id]) return;
      let icon = base;
      if (SPR["iq_" + id]) icon = "iq_" + id;   // bespoke art (quest-icons-data.js)
      else if (typeof defineIcon === "function" && SPR[base]) { defineIcon("iq_" + id, base, tint, ""); icon = "iq_" + id; }
      ITEMS[id] = { name, icon, value: 0, questItem: true, stack: true };
      if (typeof EXAMINE !== "undefined") EXAMINE[id] = examine;
      if (typeof registerPlaceholder === "function") registerPlaceholder(id, name, "quest item — tinted placeholder");
    };
    mk("quest_key",    "Ornate key",     "i_ring",   431, "A heavy ornate key — it opens a door sealed for a quest.");
    mk("quest_letter", "Sealed letter",  "i_shafts", 227, "A wax-sealed letter entrusted to you — deliver it unopened.");
    mk("quest_relic",  "Ancient relic",  "i_amulet", 341, "A relic recovered from a sealed room. Someone wants this back badly.");
    mk("quest_parcel", "Wrapped parcel", "i_vial",   118, "A tightly-wrapped parcel. Best not to ask what's inside.");
    mk("quest_charm",  "Old charm",      "i_gem",    509, "A worn lucky charm — a token of gratitude from someone you helped.");
    _itemsReady = true;
  }
  if (typeof ITEMS !== "undefined") ensureItems();

  // ---- deterministic RNG from a string ----
  function qhash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rngFrom(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6D2B79F5) >>> 0; s = (s + Math.imul(s ^ (s >>> 7), 61 | s)) >>> 0; return ((s ^ (s >>> 14)) >>> 0) / 4294967296; }; }
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

  // ---- content pools (filtered to what actually exists at gen time) ----
  const HUNT = ["goblin", "boar", "deer", "slime", "zombie", "skeleton", "wolf", "bear", "ogre", "troll", "bandit", "orc"];
  const GATHER = ["logs", "copper_ore", "iron_ore", "raw_fish", "berries", "wheat", "cotton", "herb", "leather"];
  const REWARD_ITEMS = ["potion_health", "cooked_meat", "iron_bar", "leather", "planks", "bronze_bar", "quest_charm"];
  const REWARD_SKILLS = ["Melee", "Defence", "Woodcutting", "Fishing", "Cooking", "Foraging", "Weaponsmithing", "Armoursmithing", "Mining", "Ore-mining", "Agility", "Carpentry", "Tanning"];
  const exists = id => typeof ITEMS !== "undefined" && !!ITEMS[id];
  const monExists = k => typeof MONSTERS !== "undefined" && !!MONSTERS[k];

  // ---- state ----
  // player.quests = { active: {qid: quest}, done: {qid:1}, flags: {name:1}, revealed: [{x,y,name}] }
  function state() {
    if (typeof player === "undefined" || !player) return null;
    if (!player.quests || typeof player.quests !== "object") player.quests = {};
    const q = player.quests;
    if (!q.active) q.active = {};
    if (!q.done) q.done = {};
    if (!q.flags) q.flags = {};
    if (!q.revealed) q.revealed = [];
    if (!_namesMigrated && migrateQuestNames(q)) _namesMigrated = true;
    return q;
  }

  // an ACCEPTED quest's name/intro/step text was baked with whatever
  // settlement/POI names were live when it was offered (js/world/features.js
  // NAME_A/NAME_B) — if that pool changes later the text goes stale forever
  // unless repaired. Re-running genQuest() for the same giver+series is
  // deterministic and reproduces the identical template/steps/reward (every
  // rng() draw is driven by WORLD POSITIONS, which the name pool never
  // touches) — only the embedded names differ — so we discard the old text
  // wholesale and carry the mutable progress (current step, slain counts)
  // across onto the freshly-generated quest. One attempt per boot: retries
  // next call if `world` isn't ready yet, otherwise never revisited.
  let _namesMigrated = false;
  function migrateQuestNames(q) {
    if (!(typeof world !== "undefined" && world.villagesNearPt)) return false;
    let changed = false;
    for (const qid in q.active) {
      const old = q.active[qid];
      const m = /^q:(-?\d+),(-?\d+)(?:#(\d+))?$/.exec(qid);
      if (!old || !m) continue;
      try {
        const proxy = { x: +m[1], y: +m[2], name: old.giver && old.giver.name };
        const fresh = genQuest(proxy, m[3] ? +m[3] : 0);
        if (!fresh || fresh.tpl !== old.tpl || fresh.steps.length !== old.steps.length) continue;
        fresh.step = old.step;
        for (let i = 0; i < fresh.steps.length; i++) {
          const os = old.steps[i], ns = fresh.steps[i];
          if (os.done) ns.done = true;
          if (typeof os.got === "number") ns.got = os.got;
        }
        q.active[qid] = fresh;
        changed = true;
      } catch (e) { /* leave this one alone on any mismatch */ }
    }
    if (changed && typeof saveGame === "function") saveGame();
    return true;
  }

  // giver identity + quest SERIES: the qid encodes how many quests this giver has
  // already seen completed, so each finished quest unlocks the next in the line.
  function giverKey(npc) { const gx = npc._home ? npc._home[0] : npc.x, gy = npc._home ? npc._home[1] : npc.y; return gx + "," + gy; }
  function seriesN(st, gkey) { let n = 0; for (const id in st.done) if (id === "q:" + gkey || id.startsWith("q:" + gkey + "#")) n++; return n; }
  function qidFor(gkey, n) { return "q:" + gkey + (n ? "#" + n : ""); }
  function activeFor(st, gkey) { for (const id in st.active) if (id === "q:" + gkey || id.startsWith("q:" + gkey + "#")) return st.active[id]; return null; }

  // nearest village that is NOT the giver's own, else the giver's own
  function pickTargetVillage(gx, gy) {
    if (!(typeof world !== "undefined" && world.villagesNearPt)) return null;
    let near = [];
    try { near = world.villagesNearPt(gx, gy, 2000) || []; } catch (e) { return null; }
    if (!near.length) return null;
    near.sort((a, b) => ((a.x - gx) ** 2 + (a.y - gy) ** 2) - ((b.x - gx) ** 2 + (b.y - gy) ** 2));
    const other = near.find(v => Math.hypot(v.x - gx, v.y - gy) > 40);
    return other || near[0];
  }
  // a building (index) in v that can host a contact / sealed room
  function pickBuilding(v, rng) {
    if (!v || !v.buildings || !v.buildings.length) return null;
    const i = Math.floor(rng() * v.buildings.length);
    const b = v.buildings[i];
    let door = null;
    try { door = world.buildingMeta ? world.buildingMeta(b).door : null; } catch (e) { }
    return { b, i, cx: b.x0 + (b.w >> 1), cy: b.y0 + (b.h >> 1), door };
  }

  const greet = rng => pick(rng, ["Well met, traveller.", "Ah, a brave face at last.", "You there — yes, you.", "Fortune sends you my way."]);
  // fallback fantasy names (used only when no real POI is in range), flavoured
  // by the biome the invented spot actually lands in
  const PLACE_POOLS = {
    forest: ["Whisperwood", "the Hollow Oak", "the Mossgrave Clearing", "Thornreach", "the Wardens' Bough"],
    cold: ["the Gloaming Stair", "Frostwatch Cairn", "the White Fell", "Winterhollow"],
    dry: ["the Amber Vale", "Sunbleach Flats", "the Cracked Basin", "Old Kiln Waste"],
    wet: ["Saltmere", "Greywater Hollow", "the Sunken Shrine", "Eelrun Marsh"],
    rock: ["the Broken Tower", "the Old Mine Road", "Gullscar Bluff", "the Toppled Gate"],
    plain: ["the Wanderer's Milestone", "Longgrass Barrow", "the Shepherd's Ring", "Cartwheel Rise"],
  };
  function placeName(rng, x, y) {
    let pool = PLACE_POOLS.plain;
    try {
      const b = (typeof world !== "undefined" && world.biomeNameAt) ? (world.biomeNameAt(x, y) || "") : "";
      const s = b.toLowerCase();
      pool = /forest|wood|jungle|grove|mushroom/.test(s) ? PLACE_POOLS.forest :
        /snow|tundra|glacier|frost|ice/.test(s) ? PLACE_POOLS.cold :
        /desert|savanna|bone|ash|volcan|waste/.test(s) ? PLACE_POOLS.dry :
        /swamp|marsh|bog|lake|coast|beach|sea|river/.test(s) ? PLACE_POOLS.wet :
        /mountain|rock|crag|hill|crystal|ruin/.test(s) ? PLACE_POOLS.rock : PLACE_POOLS.plain;
    } catch (e) { /* pure-noise query only; fall through */ }
    return pick(rng, pool);
  }
  // a REAL point of interest rMin..rMax game tiles from (gx,gy) — quests send
  // the player to places that actually exist (POI coords are map-scale, ×2)
  function pickPoi(gx, gy, rng, rMin, rMax) {
    if (!(typeof world !== "undefined" && world.poisNearForMap)) return null;
    let pois = [];
    try {
      const mr = rMax / 2;
      pois = world.poisNearForMap(gx / 2 - mr, gy / 2 - mr, gx / 2 + mr, gy / 2 + mr, 0) || [];
    } catch (e) { return null; }
    const good = pois
      .map(p => ({ type: p.type, name: p.name, tx: Math.round(p.x * 2), ty: Math.round(p.y * 2), d: Math.hypot(p.x * 2 - gx, p.y * 2 - gy) }))
      .filter(p => p.name && p.d >= rMin && p.d <= rMax);
    if (!good.length) return null;
    return good[Math.floor(rng() * good.length)];
  }

  // ---- generate the quest a giver offers (deterministic per giver + series) ----
  function genQuest(giver, series) {
    ensureItems();
    const gkey = giverKey(giver);
    const gx = +gkey.split(",")[0], gy = +gkey.split(",")[1];
    const qid = qidFor(gkey, series || 0);
    const rng = rngFrom(qhash(qid));
    const tier = 1 + (series || 0);                       // series escalates difficulty + reward

    const monK = pick(rng, HUNT.filter(monExists)) || "goblin";
    const monName = (MONSTERS[monK] && MONSTERS[monK].name) || monK;
    const nSlay = Math.min(24, 2 + tier + Math.floor(rng() * (3 + tier)));
    const gid = pick(rng, GATHER.filter(exists)) || "logs";
    const gName = (ITEMS[gid] && ITEMS[gid].name) || gid;
    const nGet = Math.min(20, 3 + Math.floor(rng() * (3 + tier * 2)));
    const tv = pickTargetVillage(gx, gy);
    const tvName = (tv && tv.name) || "a nearby hamlet";
    const contact = tv ? pickBuilding(tv, rng) : null;
    const roomB = tv ? pickBuilding(tv, rng) : null;
    const room = (roomB && roomB.door) ? roomB : null;
    const gname = giver.name || "the quest-giver";
    const dist = tv ? Math.round(Math.hypot(tv.x - gx, tv.y - gy)) : 120;

    // ---- pick a TEMPLATE ----
    const poi = pickPoi(gx, gy, rng, 200, 900);
    const templates = ["relic", "courier", "hunt", "provisions", "expedition", "patrol"];
    const tpl = pick(rng, templates.filter(t =>
      ((t !== "relic" && t !== "courier") || contact) &&
      (t !== "expedition" || poi) && (t !== "patrol" || tv))) || "hunt";

    const steps = [];
    let name, intro, giveAtStart = null;
    if (tpl === "expedition" && poi) {
      name = pick(rng, [`The road to ${poi.name}`, `What stirs at ${poi.name}`, `An eye on ${poi.name}`]);
      intro = `"${greet(rng)} Travellers whisper of trouble out by ${poi.name}. Go and see it with your own eyes — and thin out whatever ${monName.toLowerCase()}s you find on the way."`;
      steps.push({ type: "reach", x: poi.tx, y: poi.ty, r: 10, desc: `Scout ${poi.name}.` });
      steps.push({ type: "slay", mon: monK, n: nSlay, got: 0, desc: `Put down ${nSlay} ${monName}${nSlay > 1 ? "s" : ""} while you're out there.` });
      steps.push({ type: "talk", x: gx, y: gy, r: 6, giver: true, desc: `Bring word back to ${gname}.` });
    } else if (tpl === "patrol" && tv) {
      const wp = k => ({
        x: Math.round(gx + (tv.x - gx) * k + (rng() - 0.5) * 40),
        y: Math.round(gy + (tv.y - gy) * k + (rng() - 0.5) * 40),
      });
      const w1 = wp(0.4), w2 = wp(0.75);
      name = pick(rng, [`The ${tvName} patrol`, `Walking the ${tvName} road`, `Eyes on the road`]);
      intro = `"${greet(rng)} The road to ${tvName} has gone quiet — too quiet. Walk it end to end, deal with any ${monName.toLowerCase()}s, and report what you see."`;
      steps.push({ type: "reach", x: w1.x, y: w1.y, r: 12, desc: `Patrol the first stretch of the ${tvName} road.` });
      steps.push({ type: "reach", x: w2.x, y: w2.y, r: 12, desc: `Push on along the road toward ${tvName}.` });
      steps.push({ type: "slay", mon: monK, n: Math.max(2, Math.floor(nSlay * 0.75)), got: 0, desc: `Deal with the ${monName.toLowerCase()}s you flush out: slay ${Math.max(2, Math.floor(nSlay * 0.75))}.` });
      steps.push({ type: "talk", x: gx, y: gy, r: 6, giver: true, desc: `Report back to ${gname}.` });
    } else if (tpl === "relic" && contact && room) {
      name = pick(rng, [`The sealed room of ${tvName}`, `What lies locked away`, `The ${tvName} vault`]);
      intro = `"${greet(rng)} Something of mine is locked away in ${tvName}, and the road there has grown dangerous. Help me get it back."`;
      steps.push({ type: "talk", x: contact.cx, y: contact.cy, r: 6, town: tvName, desc: `Speak with my old friend in ${tvName}.` });
      steps.push({ type: "slay", mon: monK, n: nSlay, got: 0, desc: `Clear the roads: slay ${nSlay} ${monName}${nSlay > 1 ? "s" : ""}.` });
      steps.push({ type: "collect", item: gid, n: nGet, desc: `Gather ${nGet} ${gName} to pay the locksmith.` });
      steps.push({ type: "deliver", item: gid, n: nGet, x: gx, y: gy, r: 6, giver: true, giveKey: true, desc: `Bring the ${gName} back to ${gname} for the key.` });
      steps.push({ type: "unlock", x: room.door.x, y: room.door.y, town: tvName, find: "quest_relic", desc: `Open the sealed room in ${tvName} with the ornate key.` });
      steps.push({ type: "deliver", item: "quest_relic", n: 1, x: gx, y: gy, r: 6, giver: true, desc: `Return the ancient relic to ${gname}.` });
    } else if (tpl === "courier" && contact) {
      name = pick(rng, [`A letter for ${tvName}`, `Words that must not wait`, `The ${tvName} dispatch`]);
      intro = `"${greet(rng)} This letter must reach ${tvName} — and the wilds between us crawl with ${monName.toLowerCase()}s. Deliver it, deal with them, and come back whole."`;
      giveAtStart = "quest_letter";
      steps.push({ type: "talk", x: contact.cx, y: contact.cy, r: 6, town: tvName, give: "quest_letter", desc: `Deliver the sealed letter to ${tvName}.` });
      steps.push({ type: "slay", mon: monK, n: nSlay, got: 0, desc: `Drive off the ${monName.toLowerCase()}s plaguing the road: slay ${nSlay}.` });
      steps.push({ type: "talk", x: gx, y: gy, r: 6, giver: true, desc: `Report back to ${gname}.` });
    } else if (tpl === "provisions") {
      name = pick(rng, [`Provisions for ${tvName}`, `The empty larder`, `Stores for the season`]);
      intro = `"${greet(rng)} Our stores run thin. Bring me what we need and you'll not find me ungrateful."`;
      if (contact) steps.push({ type: "talk", x: contact.cx, y: contact.cy, r: 6, town: tvName, desc: `Ask in ${tvName} what's needed most.` });
      steps.push({ type: "collect", item: gid, n: nGet, desc: `Gather ${nGet} ${gName}.` });
      steps.push({ type: "deliver", item: gid, n: nGet, x: gx, y: gy, r: 6, giver: true, desc: `Bring the ${gName} back to ${gname}.` });
    } else { // hunt
      const nBig = Math.min(30, nSlay + 2 + tier);
      name = pick(rng, [`The ${monName.toLowerCase()} menace`, `A bounty on ${monName.toLowerCase()}s`, `Cull of the wilds`]);
      intro = `"${greet(rng)} The ${monName.toLowerCase()}s grow bold — too bold. Thin their numbers and bring me proof in ${gName.toLowerCase()}s you scavenge along the way."`;
      steps.push({ type: "slay", mon: monK, n: nBig, got: 0, desc: `Slay ${nBig} ${monName}${nBig > 1 ? "s" : ""}.` });
      steps.push({ type: "collect", item: gid, n: Math.max(2, Math.floor(nGet / 2)), desc: `Scavenge ${Math.max(2, Math.floor(nGet / 2))} ${gName}.` });
      steps.push({ type: "deliver", item: gid, n: Math.max(2, Math.floor(nGet / 2)), x: gx, y: gy, r: 6, giver: true, desc: `Report your kills to ${gname}.` });
    }

    // ---- rewards scale with steps, slaying and distance travelled ----
    const effort = steps.length + nSlay * 0.5 + dist / 150;
    const coins = Math.round((30 + rng() * 60 + effort * 22) * tier);
    const sk1 = pick(rng, REWARD_SKILLS.filter(s => typeof SKILLS === "undefined" || SKILLS.includes(s))) || "Melee";
    const xp = { [sk1]: Math.round((150 + rng() * 350 + effort * 60) * tier) };
    if (rng() < 0.4) { const sk2 = pick(rng, REWARD_SKILLS.filter(s => s !== sk1 && (typeof SKILLS === "undefined" || SKILLS.includes(s)))); if (sk2) xp[sk2] = Math.round(xp[sk1] * 0.4); }
    const rewItem = pick(rng, REWARD_ITEMS.filter(exists)) || "potion_health";
    // revealed places point at REAL landmarks when one is in range (the marker
    // leads to an actual shrine/ruin/camp, and a first-visit cache waits there
    // — see tick()); the invented-name fallback still gets its cache
    let reveal = null;
    if (rng() < 0.75) {
      const rp = pickPoi(gx, gy, rng, 500, 1600);
      if (rp) reveal = { x: rp.tx, y: rp.ty, name: rp.name };
      else {
        const rx = gx + (rng() < 0.5 ? 1 : -1) * (500 + Math.floor(rng() * 1100));
        const ry = gy + (rng() < 0.5 ? 1 : -1) * (500 + Math.floor(rng() * 1100));
        reveal = { x: rx, y: ry, name: placeName(rng, rx, ry) };
      }
    }

    return {
      id: qid, tpl, tier, name, intro, giveAtStart,
      giver: { x: gx, y: gy, name: gname },
      step: 0, steps,
      reward: { coins, xp, items: [{ id: rewItem, qty: 1 + Math.floor(rng() * 2) }], reveal },
    };
  }

  // ---- helpers on an active quest ----
  function curStep(q) { return q && q.steps[q.step]; }
  function questLine(q) { const s = curStep(q); return s ? s.desc : "Return for your reward."; }

  function advance(q) {
    q.step++;
    if (q.step >= q.steps.length) return; // completion handled by caller
    const s = curStep(q);
    if (typeof log === "function") log(`Quest updated — ${s.desc}`, "gold");
    if (typeof uiDirty !== "undefined") uiDirty = true;
    refreshLog();
  }

  function complete(q) {
    const st = state(); if (!st) return;
    delete st.active[q.id];
    st.done[q.id] = 1;
    const r = q.reward || {};
    const parts = [];
    if (r.coins && typeof addItem === "function") { addItem("coins", r.coins); parts.push(`${r.coins} coins`); }
    if (r.xp) for (const sk in r.xp) if (typeof addXp === "function") { addXp(sk, r.xp[sk]); parts.push(`${r.xp[sk]} ${sk} xp`); }
    if (r.items) for (const it of r.items) if (exists(it.id) && typeof addItem === "function") { addItem(it.id, it.qty); parts.push(`${it.qty}× ${ITEMS[it.id].name}`); }
    if (r.reveal) { st.revealed.push({ x: Math.round(r.reveal.x), y: Math.round(r.reveal.y), name: r.reveal.name });
      st.flags["reveal:" + r.reveal.name] = 1; parts.push(`passage to ${r.reveal.name}`); }
    if (typeof log === "function") {
      log(`Quest complete: ${q.name}!`, "gold");
      if (typeof sfx === "function") sfx("quest", 0.7);
      log(`Reward: ${parts.join(", ")}.`, "gold");
      if (r.reveal) log(`A new place is marked on your map: ${r.reveal.name}.`, "sys");
      log(`${q.giver.name} may have more work for you in time.`, "sys");
    }
    if (typeof saveGame === "function") saveGame();
    if (typeof uiDirty !== "undefined") uiDirty = true;
    refreshLog();
  }

  // how a quest-giver stands with the player: "new" (has a quest to offer),
  // "active" (mid-quest) — drives the ✦ badge colour over their head
  function giverState(npc) {
    const st = state(); if (!st) return "new";
    return activeFor(st, giverKey(npc)) ? "active" : "new";
  }

  // ---- quest-giver interaction (called from ui.js talkTo) ----
  function talkGiver(npc) {
    const st = state(); if (!st) return;
    ensureItems();
    const gkey = giverKey(npc);
    let q = activeFor(st, gkey);
    if (!q) {                                   // offer the next quest in the series
      const n = seriesN(st, gkey);
      q = genQuest(npc, n);
      if (!q.steps.length) { say(npc, "All's quiet for now. Come back another day."); return; }
      st.active[q.id] = q;
      say(npc, q.intro);
      if (q.giveAtStart && typeof addItem === "function") {
        addItem(q.giveAtStart, 1);
        if (typeof log === "function") log(`You receive: ${ITEMS[q.giveAtStart].name}.`, "sys");
      }
      if (typeof log === "function") { log(`New quest${n ? ` (№${n + 1} for ${q.giver.name})` : ""}: ${q.name}`, "gold"); log(questLine(q), "sys"); }
      if (typeof saveGame === "function") saveGame();
      refreshLog();
      return;
    }
    const s = curStep(q);
    // lost the letter mid-courier-run? the giver writes another
    if (s && s.type === "talk" && s.give && !s.giver && typeof countItem === "function" && countItem(s.give) < 1) {
      addItem(s.give, 1);
      say(npc, "Lost it already? Sigh. Here — another copy. Guard this one.");
      return;
    }
    if (s && (s.giver || (s.type === "talk" && near(s, q.giver.x, q.giver.y)))) { handleReturn(q, s, npc); return; }
    say(npc, `You're not done yet. ${questLine(q)}`);
  }

  function handleReturn(q, s, npc) {
    if (s.type === "deliver") {
      if (typeof countItem === "function" && countItem(s.item) < s.n) {
        say(npc, `You still owe me ${s.n} ${(ITEMS[s.item] && ITEMS[s.item].name) || s.item}. Off you go.`);
        return;
      }
      if (typeof removeItem === "function") removeItem(s.item, s.n);
      if (s.giveKey) {
        say(npc, "Good work. Here — take this ornate key; it opens the sealed room. Bring back what you find inside.");
        if (typeof addItem === "function") addItem("quest_key", 1);
      } else if (s.item === "quest_relic") {
        say(npc, "You found it… after all these years. I am in your debt, truly.");
      } else {
        say(npc, "Fine work, that. Here's your due.");
      }
      s.done = true; advance(q);
    } else { // a "report back" talk step at the giver
      say(npc, "So it's done? You have my thanks — and your pay.");
      s.done = true; advance(q);
    }
    if (q.step >= q.steps.length) complete(q);
    if (typeof saveGame === "function") saveGame();
  }

  function say(npc, text) {
    if (npc) { npc._say = { text, until: (typeof performance !== "undefined" ? performance.now() : Date.now()) + 5000 }; }
    if (typeof log === "function") log(`${(npc && npc.name) || "Quest-giver"}: ${text}`, "sys");
  }
  function near(s, x, y) { return Math.abs(x - s.x) <= (s.r || 6) && Math.abs(y - s.y) <= (s.r || 6); }

  // ---- world-event hooks ----
  function onKill(kind) {
    const st = state(); if (!st) return;
    for (const id in st.active) { const q = st.active[id], s = curStep(q);
      if (s && s.type === "slay" && (kind === s.mon || kind === s.mon + "_v")) {
        s.got = (s.got || 0) + (kind === s.mon + "_v" ? 2 : 1);   // a giant counts double
        if (typeof log === "function" && s.got <= s.n) log(`Quest: ${Math.min(s.got, s.n)}/${s.n} ${(MONSTERS[s.mon] && MONSTERS[s.mon].name) || s.mon} slain.`, "gold");
        if (s.got >= s.n) { s.done = true; advance(q); if (q.step >= q.steps.length) complete(q); if (typeof saveGame === "function") saveGame(); }
      }
    }
  }
  // periodic (main loop): checks COLLECT steps against the pack, and REACH.
  function tick() {
    const st = state(); if (!st) return;
    for (const id in st.active) { const q = st.active[id], s = curStep(q);
      if (!s) continue;
      if (s.type === "collect" && typeof countItem === "function" && countItem(s.item) >= s.n) {
        s.done = true; advance(q); if (q.step >= q.steps.length) complete(q); if (typeof saveGame === "function") saveGame();
      } else if (s.type === "reach" && typeof player !== "undefined" && near(s, player.x, player.y)) {
        s.done = true; advance(q); if (q.step >= q.steps.length) complete(q); if (typeof saveGame === "function") saveGame();
      }
    }
    // first visit to a revealed place: a traveller's cache waits there, so the
    // map marker a quest granted is a real payoff, not just a label
    if (st.revealed.length && typeof player !== "undefined") {
      for (const rv of st.revealed) {
        const fk = "cache:" + rv.x + "," + rv.y;
        if (st.flags[fk]) continue;
        if (Math.abs(player.x - rv.x) > 10 || Math.abs(player.y - rv.y) > 10) continue;
        st.flags[fk] = 1;
        const rng = rngFrom(qhash(fk));
        const coins = 60 + Math.floor(rng() * 120);
        if (typeof addItem === "function") addItem("coins", coins);
        let extraStr = "";
        const extra = pick(rng, REWARD_ITEMS.filter(exists));
        if (extra && rng() < 0.8 && typeof addItem === "function") { addItem(extra, 1); extraStr = ` and ${(ITEMS[extra] || {}).name || extra}`; }
        if (typeof log === "function") log(`You arrive at ${rv.name}. Tucked out of the weather you find a traveller's cache: ${coins} coins${extraStr}.`, "gold");
        if (typeof sfx === "function") sfx("quest", 0.6);
        if (typeof saveGame === "function") saveGame();
      }
    }
  }
  // called from talkTo for ANY npc — completes a "talk to a contact" step
  function onTalk(npc) {
    const st = state(); if (!st) return false;
    for (const id in st.active) { const q = st.active[id], s = curStep(q);
      if (s && s.type === "talk" && !s.giver && near(s, npc.x, npc.y)) {
        if (s.give) {                             // courier: hand over the letter
          if (typeof countItem === "function" && countItem(s.give) < 1) {
            say(npc, `A letter for me? You don't seem to have it… go back to ${q.giver.name} for another.`);
            return true;
          }
          if (typeof removeItem === "function") removeItem(s.give, 1);
          say(npc, "Ah, at last — I've been waiting on this. My thanks; tell them it arrived safe.");
        } else {
          say(npc, "Ah, you're the one sent to help. Bless you — now, about that trouble…");
        }
        s.done = true; advance(q); if (q.step >= q.steps.length) complete(q);
        if (typeof saveGame === "function") saveGame();
        return true;
      }
    }
    return false;
  }
  // called from world.js useDoor — a quest "unlock" step door.
  // returns "blocked" (no key), "open" (unlocked + advanced), or null (not a quest door).
  function tryDoor(d) {
    const st = state(); if (!st) return null;
    for (const id in st.active) { const q = st.active[id], s = curStep(q);
      if (s && s.type === "unlock" && s.x === d.x && s.y === d.y) {
        if (typeof countItem === "function" && countItem("quest_key") < 1) return "blocked";
        if (typeof removeItem === "function") removeItem("quest_key", 1);
        if (typeof log === "function") log("The ornate key turns — the sealed room swings open.", "gold");
        if (s.find && typeof addItem === "function" && exists(s.find)) {
          addItem(s.find, 1);
          if (typeof log === "function") log(`Inside, hidden under dust and years, you find: ${ITEMS[s.find].name}!`, "gold");
        }
        s.done = true; advance(q); if (q.step >= q.steps.length) complete(q);
        if (typeof saveGame === "function") saveGame();
        return "open";
      }
    }
    return null;
  }

  // ---- world-map markers (drawn by world.js wmDraw) ----
  function activeMarkers() {
    const st = state(); if (!st) return [];
    const out = [];
    for (const id in st.active) { const q = st.active[id], s = curStep(q);
      if (s && s.x != null && s.y != null) out.push({ x: s.x, y: s.y, kind: "objective", label: q.name });
      if (q.giver) out.push({ x: q.giver.x, y: q.giver.y, kind: "giver", label: q.giver.name });
    }
    for (const rv of st.revealed) out.push({ x: rv.x, y: rv.y, kind: "revealed", label: rv.name });
    return out;
  }

  // "412 tiles NE" hint from the player to a step's coordinates
  function dirHint(s) {
    if (typeof player === "undefined" || s.x == null || s.y == null) return "";
    const dx = s.x - player.x, dy = s.y - player.y;
    const d = Math.round(Math.hypot(dx, dy));
    if (d < 10) return " (here)";
    const dirs = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) & 7;
    return ` — ${d} tiles ${dirs[a]}`;
  }

  // ---- quest-log UI (modal, mirrors bestiary; J key) ----
  function refreshLog() { const el = document.getElementById("questlog"); if (el && el.classList.contains("open")) renderLog(); }
  function renderLog() {
    const body = document.getElementById("questlog-body"); if (!body) return;
    const st = state(); const act = st ? Object.values(st.active) : [];
    let html = "";
    if (!act.length) html += `<p class="ql-empty">No active quests. Seek out a ✦ quest-giver in a town or at a landmark on your map (M).</p>`;
    for (const q of act) {
      html += `<div class="ql-quest"><div class="ql-title">${q.name}${q.tier > 1 ? ` <span class="ql-tier">(№${q.tier} for ${q.giver.name})</span>` : ""}</div><ol class="ql-steps">`;
      q.steps.forEach((s, i) => {
        const st2 = i < q.step ? "done" : i === q.step ? "cur" : "todo";
        let extra = "";
        if (i === q.step) {
          if (s.type === "slay") extra = ` (${Math.min(s.got || 0, s.n)}/${s.n})`;
          if ((s.type === "collect" || s.type === "deliver") && typeof countItem === "function") extra = ` (${Math.min(s.n, countItem(s.item))}/${s.n})`;
          extra += dirHint(s);
        }
        html += `<li class="ql-${st2}">${i < q.step ? "✓ " : ""}${s.desc}${extra}</li>`;
      });
      const xpStr = Object.entries(q.reward.xp || {}).map(([k, v]) => `${v} ${k} xp`).join(", ");
      html += `</ol><div class="ql-reward">Reward: ${q.reward.coins} coins${xpStr ? `, ${xpStr}` : ""}${q.reward.items && q.reward.items[0] ? `, ${q.reward.items[0].qty}× ${(ITEMS[q.reward.items[0].id] || {}).name || q.reward.items[0].id}` : ""}${q.reward.reveal ? `, passage to ${q.reward.reveal.name}` : ""}</div></div>`;
    }
    const done = st ? Object.keys(st.done).length : 0;
    if (st && st.revealed.length) {
      html += `<div class="ql-quest"><div class="ql-title">Places revealed</div><ol class="ql-steps">`;
      for (const rv of st.revealed) html += `<li class="ql-done">✓ ${rv.name}${dirHint(rv)}</li>`;
      html += `</ol></div>`;
    }
    html += `<p class="ql-done">Quests completed: ${done}</p>`;
    body.innerHTML = html;
  }
  function openLog() { const el = document.getElementById("questlog"); if (!el) return; el.classList.add("open"); renderLog(); }
  function closeLog() { const el = document.getElementById("questlog"); if (el) el.classList.remove("open"); }
  function isLogOpen() { const el = document.getElementById("questlog"); return el && el.classList.contains("open"); }
  function toggleLog() { isLogOpen() ? closeLog() : openLog(); }

  function wire() {
    const btn = document.getElementById("questbtn"); if (btn) btn.onclick = toggleLog;
    const x = document.getElementById("questlogclose"); if (x) x.onclick = closeLog;
    document.addEventListener("keydown", e => {
      const t = e.target;
      if (e.key === "Escape" && isLogOpen()) { e.stopPropagation(); closeLog(); return; }
      if ((e.key === "j" || e.key === "J") && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) { e.preventDefault(); toggleLog(); }
    }, true);
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
    else wire();
  }

  window.Quests = { talkGiver, onKill, onTalk, tryDoor, tick, activeMarkers, giverState, openLog, closeLog, toggleLog, genQuest };
})();
