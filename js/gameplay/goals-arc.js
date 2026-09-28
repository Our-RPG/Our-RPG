// First days in Newhaven — the authored post-graduation goal arc.
//
// The Bifrost crossing used to be a cliff: goalState() returns cur:null the
// moment t.graduated flips, the Goals tab collapses to "no goals remain",
// and a fresh graduate stands in Newhaven with a full pack and no thread to
// pull. This module hands them four first days' worth of thread:
//
//   1. bank the isle goods       (the pack is full — teach the shared vault)
//   2. take a ✦ quest            (the loop that replaces the keepers)
//   3. attune a portal           (the travel unlock that makes 4 painless)
//   4. set foot in a new biome   (the world is bigger than these plains)
//
// Steps are POLLED, not evented — quests/portals/biome are all cheap global
// reads, so a player who does them out of order (or did them before this
// module shipped) gets instant credit. Only bank deposits need a wire: we
// wrap depositToBank the same way pulse.js does (shared-global bundle scope,
// wrap-by-reassignment; this file loads after both ui.js and pulse.js).
//
// State nests under player.tutorial.arc — player.tutorial round-trips whole
// through storage.js, so no save-schema change. Veterans whose saves carry
// player.tutorial === null (pre-isle era) never see the arc; graduates from
// BEFORE this module get it seeded on their next boot, with any already-done
// steps checking off at once.
//
// main.js calls GoalsArc.tick() beside Tutorial.tick() (same !cine gate, so
// the arc stays silent until the Bifrost cinematic has let go of the sky);
// main/ui.js renderGoals() consults GoalsArc.state() for the graduated view.
var GoalsArc = (() => {
  "use strict";

  const NEED_DEPOSITS = 3; // "goods", plural — three stacks vaulted

  function arc() {
    const t = typeof player !== "undefined" && player.tutorial;
    if (!t || typeof t !== "object" || !t.graduated) return null;
    return t.arc || null;
  }

  // seeded on the first post-cinematic tick after graduation (also catches
  // pre-module graduates mid-world: their "home" biome is wherever they
  // stand, which keeps step 4 honest — somewhere they haven't been settling)
  function seed() {
    const t = player.tutorial;
    t.arc = {
      start: typeof world !== "undefined" && world.biomeAt ? world.biomeAt(player.x, player.y) : -1,
      dep: 0,          // deposits made since graduation
      s: {},           // stepId -> 1 once credited (shared across all chapters)
      bio: {},         // biomeId -> 1 ledger for the stand-in-N-biomes steps
      done: 0,         // 1 once EVERY chapter is closed
    };
    if (typeof log === "function")
      log("Newhaven, then. Your first days begin — the Goals tab holds the thread.", "gold");
    if (typeof saveGame === "function") saveGame();
    return t.arc;
  }

  // GRASS and MEADOW interleave across the whole Newhaven lowland (and FARM
  // rings every settlement), so from a plains start they count as one home
  // turf — otherwise step 4 pops on the first field boundary. Water and
  // beach never count: wading a river isn't "sampling a biome".
  const HOME_LOWLAND = () => new Set([B.GRASS, B.MEADOW, B.FARM]);
  const NEVER_NEW = () => new Set([B.DEEP, B.WATER, B.SAND]);
  function inNewBiome(a) {
    const b = world.biomeAt(player.x, player.y);
    if (b == null || NEVER_NEW().has(b)) return false;
    const home = HOME_LOWLAND();
    if (home.has(a.start)) return !home.has(b);
    return b !== a.start;
  }

  // ---------- the chapters ----------
  // The arc no longer ends after four steps: it runs in CHAPTERS, each a set
  // of polled goals with a coin reward on completion, stretching from the
  // first hour in Newhaven to a realm-spanning capstone. check() runs at
  // 1 Hz; label/need/num feed renderGoals' pill rows. Step ids are unique
  // across chapters (they share one a.s flag map — old saves' bank/quest/
  // portal/biome flags ARE chapter one, so veterans resume mid-arc).
  const questTaken = () => {
    const q = player.quests;
    return !!q && (Object.keys(q.active || {}).length > 0 || Object.keys(q.done || {}).length > 0);
  };
  const questsDone = () => Object.keys((player.quests && player.quests.done) || {}).length;
  const portalCount = () => Object.keys(player.portals || {}).length;
  const skillsAt = n => { let c = 0; for (const s of SKILLS) if (skillLvl(s) >= n) c++; return c; };
  const maxSkill = () => { let m = 0; for (const s of SKILLS) m = Math.max(m, skillLvl(s)); return m; };
  const respawnSet = () => !!(player.respawn && player.respawn.name !== "Tūhura Isle");
  const contractsDone = () => (player.contractsDone || []).length;
  const bioCount = a => Object.keys(a.bio || {}).length;

  const CHAPTERS = [
    { id: "days", title: "First days in Newhaven", reward: 0, steps: [
      { id: "bank", label: "Bank your isle goods", need: NEED_DEPOSITS,
        num: a => Math.min(a.dep, NEED_DEPOSITS),
        check: a => a.dep >= NEED_DEPOSITS,
        hint: () => "Newhaven keeps a bank — and every road-linked town shares the same vault, so nothing you deposit is ever far away.",
        doneLine: "Your isle goods are vaulted. Any road-linked bank hands them back." },
      { id: "quest", label: "Take a quest from a ✦ villager", need: 1,
        num: a => questTaken() ? 1 : 0,
        check: () => questTaken(),
        hint: hintQuest,
        doneLine: "First quest taken — the journal (J) keeps the thread from here." },
      { id: "portal", label: "Attune your first portal", need: 1,
        num: () => portalCount() ? 1 : 0,
        check: () => portalCount() >= 1,
        hint: hintPortal,
        doneLine: "Portal attuned. Every portal you touch joins the same web — distance is now a choice." },
      { id: "biome", label: "Set foot in a neighbouring biome", need: 1,
        num: a => a.s.biome ? 1 : 0,
        check: a => inNewBiome(a),
        hint: () => "Plains and meadow are home turf. Pick a direction and walk until the land itself changes — the map (M) shows where the colours turn.",
        doneLine: "New ground underfoot — and the world holds thirty-seven kinds of it." },
    ]},
    { id: "roots", title: "Putting down roots", reward: 400, steps: [
      { id: "r_q3", label: "Complete 3 quests", need: 3,
        num: () => Math.min(3, questsDone()), check: () => questsDone() >= 3,
        hint: hintQuest,
        doneLine: "Three favours done — the towns are starting to talk about you." },
      { id: "r_s5", label: "Raise 3 skills to level 5", need: 3,
        num: () => Math.min(3, skillsAt(5)), check: () => skillsAt(5) >= 3,
        hint: () => "Any three trades will do — the Skills tab shows every ladder, and the guide inside each one shows what trains it.",
        doneLine: "Three trades at level 5 — hands that know more than one kind of work." },
      { id: "r_p3", label: "Attune 3 portals", need: 3,
        num: () => Math.min(3, portalCount()), check: () => portalCount() >= 3,
        hint: hintPortal,
        doneLine: "Three portals in your web. The realm is folding up small." },
      { id: "r_home", label: "Set your respawn at a city fountain", need: 1,
        num: () => respawnSet() ? 1 : 0, check: () => respawnSet(),
        hint: () => "Right-click any city fountain and choose to make it home — that's where you'll wake if the worst happens.",
        doneLine: "Home is chosen. The fountain will be waiting if the worst happens." },
    ]},
    { id: "craft", title: "A craft of your own", reward: 1200, steps: [
      { id: "c_s10", label: "Raise a skill to level 10", need: 1,
        num: () => maxSkill() >= 10 ? 1 : 0, check: () => maxSkill() >= 10,
        hint: () => "Pick the trade that's pulled at you most and lean in — level 10 is where its middle tiers open up.",
        doneLine: "Level 10 — apprentice no longer." },
      { id: "c_q10", label: "Complete 10 quests", need: 10,
        num: () => Math.min(10, questsDone()), check: () => questsDone() >= 10,
        hint: () => "Every ✦ giver offers a series that grows with you — and scouting quests pay in revealed places worth visiting.",
        doneLine: "Ten quests closed. Givers keep harder, richer work for the proven." },
      { id: "c_con", label: "Fulfil a town contract", need: 1,
        num: () => contractsDone() ? 1 : 0, check: () => contractsDone() >= 1,
        hint: () => "General stores post contracts — bulk orders at a premium, paid in coins and reputation. Craft or gather what's wanted and press Fulfil.",
        doneLine: "First contract filled — reputation is a currency now." },
      { id: "c_b5", label: "Stand in 5 different biomes", need: 5,
        num: a => Math.min(5, bioCount(a)), check: a => bioCount(a) >= 5,
        hint: () => "The map (M) shows the land changing colour. Forests, mountains, swamps, sands — each is its own biome, and the arc counts every new one you set foot in.",
        doneLine: "Five lands underfoot. Thirty-two more kinds are out there." },
    ]},
    { id: "standing", title: "Standing in the world", reward: 4000, steps: [
      { id: "t_s20", label: "Raise a skill to level 20", need: 1,
        num: () => maxSkill() >= 20 ? 1 : 0, check: () => maxSkill() >= 20,
        hint: () => "Past level 20 the rarest recipes open — reagents from the bestiary's stranger monsters start to matter.",
        doneLine: "Level 20. Masters are made of exactly this." },
      { id: "t_q25", label: "Complete 25 quests", need: 25,
        num: () => Math.min(25, questsDone()), check: () => questsDone() >= 25,
        hint: () => "Quest series escalate the longer you stick with one giver — deep series pay far better than first favours.",
        doneLine: "Twenty-five quests. The journal reads like a career." },
      { id: "t_rep", label: "Become a Trusted trader (500 reputation)", need: 1,
        num: () => (player.reputation | 0) >= 500 ? 1 : 0, check: () => (player.reputation | 0) >= 500,
        hint: () => "Contracts and civic-fund donations both raise reputation — and each tier of standing cuts shop prices and posts extra contracts.",
        doneLine: "Trusted trader — merchants greet you by name now." },
      { id: "t_b12", label: "Stand in 12 different biomes", need: 12,
        num: a => Math.min(12, bioCount(a)), check: a => bioCount(a) >= 12,
        hint: () => "Twelve different lands means real travel — glaciers, jungles, crystal fields. Portals make the far ones a step away.",
        doneLine: "Twelve lands know your footprints." },
    ]},
  ];
  const ALL_STEPS = CHAPTERS.flatMap(c => c.steps);
  // the first chapter with an unfinished step; CHAPTERS.length = arc complete
  function chapterIx(a) {
    for (let i = 0; i < CHAPTERS.length; i++)
      if (!CHAPTERS[i].steps.every(st => a.s[st.id])) return i;
    return CHAPTERS.length;
  }

  // ---------- nearest-✦ / nearest-portal hints ----------
  // Icon/POI scans cost real work, so hints memoize for 5 s and only run
  // while the Goals panel is actually open (state() is render-driven).
  const DIR8 = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  function bearing(dx, dy) { // map-space; -y is north
    const a = Math.atan2(dx, -dy);
    return DIR8[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  }
  let hintAt = 0, hintFor = "", hintTxt = "";
  function memoHint(id, build) {
    const now = performance.now();
    if (id === hintFor && now - hintAt < 5000) return hintTxt;
    hintFor = id; hintAt = now;
    try { hintTxt = build(); } catch (e) { hintTxt = ""; }
    return hintTxt;
  }
  function nearest(list, mx, my) {
    let best = null, bd = Infinity;
    for (const p of list) {
      const d = (p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my);
      if (d < bd) { bd = d; best = p; }
    }
    return best && { p: best, d: Math.sqrt(bd) };
  }
  function hintQuest() {
    return memoHint("quest", () => {
      const mx = player.x / 2, my = player.y / 2, R = 150;
      const icons = world.iconsNearForMap(mx - R, my - R, mx + R, my + R)
        .filter(ic => ic.type === "quest");
      const n = nearest(icons, mx, my);
      if (!n) return "Villagers with a gold ✦ overhead have work for you — every settlement keeps a few.";
      return `Look for the gold ✦ over a villager's head — the nearest is ~${Math.round(n.d * 2)} tiles ${bearing(n.p.x - mx, n.p.y - my)} of you.`;
    });
  }
  function hintPortal() {
    return memoHint("portal", () => {
      const mx = player.x / 2, my = player.y / 2, R = 400;
      const pois = world.poisNearForMap(mx - R, my - R, mx + R, my + R, 26)
        .filter(p => p && p.type === "portal");
      const n = nearest(pois, mx, my);
      if (!n) return "Standing stones with a humming ring dot the wilds — walk up to one and it attunes to you.";
      return `The ${n.p.name} stands ~${Math.round(n.d * 2)} tiles ${bearing(n.p.x - mx, n.p.y - my)} of you. Walk up to it and it attunes.`;
    });
  }

  // ---------- progress ----------
  function pulseNote(k) {
    try { if (typeof Pulse !== "undefined" && Pulse.noteEvent) Pulse.noteEvent(k); } catch (e) {}
  }
  let accum = 0;
  function tick(dt) {
    if (typeof player === "undefined" || !player.tutorial || typeof player.tutorial !== "object"
        || !player.tutorial.graduated) return;
    accum += dt || 0.016;
    if (accum < 1) return; // 1 Hz is plenty for polled steps
    accum = 0;
    const a = arc() || seed();
    // distinct-biome ledger (pure noise query, no chunk gen) — feeds the
    // stand-in-N-biomes steps whether or not their chapter is open yet
    try {
      const b = world.biomeAt(player.x, player.y);
      if (b != null && !NEVER_NEW().has(b)) {
        if (!a.bio) a.bio = {};
        if (!a.bio[b]) {
          a.bio[b] = 1;
          // first footfall in a biome beyond the home lowland: name the
          // moment — the endless map is the game's best surprise, so say so
          // (once ever per biome; the ledger persists in the save)
          const n = Object.keys(a.bio).length;
          if (n > 1 && !HOME_LOWLAND().has(b)) {
            const nm = (world.BIOME_NAMES && world.BIOME_NAMES[b]) || null;
            if (nm && typeof log === "function") {
              const ord = k => k + (k % 10 === 1 && k % 100 !== 11 ? "st" : k % 10 === 2 && k % 100 !== 12 ? "nd" : k % 10 === 3 && k % 100 !== 13 ? "rd" : "th");
              log(`New country: ${nm} — the ${ord(n)} biome you've stood in.`, "gold");
              if (typeof sfx === "function") sfx("quest", 0.35);
            }
          }
        }
      }
    } catch (e) {}
    const chBefore = chapterIx(a);
    if (chBefore >= CHAPTERS.length) return;
    let changed = false;
    for (const st of CHAPTERS[chBefore].steps) {
      if (a.s[st.id]) continue;
      let ok = false;
      try { ok = st.check(a); } catch (e) {}
      if (!ok) continue;
      a.s[st.id] = 1; changed = true;
      if (typeof log === "function") log(st.doneLine, "gold");
      if (typeof sfx === "function") sfx("quest", 0.5);
      pulseNote("arc:" + st.id);
    }
    if (changed) {
      const chAfter = chapterIx(a);
      if (chAfter > chBefore) {
        const c = CHAPTERS[chBefore];
        if (typeof log === "function") log(`Chapter closed: ${c.title}.`, "gold");
        if (c.reward && typeof addItem === "function") {
          addItem("coins", c.reward);
          if (typeof log === "function") log(`The realm takes note — a purse of ${c.reward} coins finds its way to you.`, "gold");
        }
        pulseNote("arc:ch:" + c.id);
        if (chAfter < CHAPTERS.length) {
          if (typeof log === "function")
            log(`A new chapter opens: ${CHAPTERS[chAfter].title}. The Goals tab holds the thread.`, "gold");
        } else {
          a.done = 1;
          if (typeof log === "function")
            log("The long arc is complete. Every road, trade and town knows your name — what you do with the realm now is entirely up to you.", "gold");
          pulseNote("arc:done");
        }
      }
      if (typeof uiDirty !== "undefined") uiDirty = true;
      if (typeof saveGame === "function") saveGame();
    }
  }

  // ---------- bank-deposit wire (pulse.js wrap pattern) ----------
  if (typeof depositToBank === "function") {
    const orig = depositToBank;
    depositToBank = function (i, n) {
      try {
        const a = arc();
        if (a && !a.s.bank) { a.dep++; if (typeof uiDirty !== "undefined") uiDirty = true; }
      } catch (e) {}
      return orig(i, n);
    };
  }

  // ---------- render snapshot for main/ui.js renderGoals ----------
  function state() {
    const a = arc();
    if (!a) return null;
    const ci = chapterIx(a);
    if (ci >= CHAPTERS.length) {
      return { done: true, title: "The long arc — complete", doneN: 1, total: 1, cur: null, rows: [],
        doneLine: "✦ Every chapter is closed. The realm is yours — quests, contracts and thirty-seven biomes without end." };
    }
    const c = CHAPTERS[ci];
    const rows = c.steps.map(st => ({
      on: !!a.s[st.id], label: st.label, num: a.s[st.id] ? st.need : st.num(a), need: st.need,
    }));
    const doneN = rows.filter(r => r.on).length;
    const cur = c.steps.find(st => !a.s[st.id]);
    return {
      done: false, title: `Chapter ${ci + 1} of ${CHAPTERS.length}: ${c.title}`,
      doneN, total: c.steps.length,
      cur: cur ? { label: cur.label, hint: cur.hint() } : null,
      rows,
    };
  }

  return { tick, state };
})();
window.GoalsArc = GoalsArc;
