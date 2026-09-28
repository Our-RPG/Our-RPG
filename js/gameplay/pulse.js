// ===== Taiao — Player Pulse: passive like/dislike observation =====
// Quietly watches HOW the player plays and infers which parts of the game
// they enjoy and which they avoid. No gameplay changes, no prompts: it reads
// state the game already exposes (player.act, movement, open UI) once a
// second, wraps a handful of globals (addXp / killMonster / playerDie /
// openBank / openMarket / tradeBuy) purely to timestamp events, and keeps its
// own localStorage store — one per save mode, like storage.js SAVE_KEY.
//
// The model, in short:
//   SAMPLE   1 Hz: classify the current second into an activity key —
//            "skill:Fishing", "combat", "explore", "travel", "sailing",
//            "ui:map"/"ui:bank"/"ui:trade"/… — weighted down 0.3x when the
//            player is AFK-grinding (no input >90s but an action running),
//            zero when truly idle, so an overnight fishing tab can't fake
//            "loves fishing".
//   SEGMENT  contiguous same-key seconds form an ENGAGEMENT (travel/idle
//            gaps up to 12s don't break it). Each close records how it
//            ended: switched away, went idle, died, or quit the game.
//   SIGNAL   per activity: weighted seconds, engagements, abandons (<25s
//            then switched), longest sit, sessions touched, session-opener
//            count (what they rush to first), deaths + what they did after
//            a death (came back vs fled vs quit), quit-the-game-right-after
//            count, and fast/slow per-session EMAs of time share for trend.
//   INFER    heuristic scores. Like: big voluntary share, returns across
//            sessions, long sits, session-opener, rising trend. Dislike:
//            abandon rate, rage-quit correlation, death-then-avoid, falling
//            trend, "tried early, tiny total, never came back". Verdicts
//            (loved/liked/neutral/cooling/disliked/dropped) carry a
//            confidence from sample size and a human-readable evidence line.
//   LOG      a dated insight journal (verdict changes, session summaries,
//            rage-quit notes) persisted in the store, a console report via
//            Pulse.log(), and an in-game viewer on the I key.
//
// Cheat-mode caveat: addXp() no-ops under DEV_MODE, but it is still CALLED
// by the skill tick code, so the wrap sees the skill name either way — the
// observer works identically in both modes (each mode has its own store).
"use strict";

(function () {
  const VER = 1;
  const LS_KEY = (typeof DEV_MODE !== "undefined" && DEV_MODE)
    ? "taiao_pulse_cheat_v1" : "taiao_pulse_v1"; // migrated, see js/lskeys-migrate.js

  // resuming within this of the last persisted heartbeat = same session
  // (cheat-toggle and dev reloads must not inflate the session count)
  const RESUME_MS = 10 * 60 * 1000;
  const AFK_MS = 90 * 1000;        // no input this long -> idle / weighted grind
  const AFK_GRIND_W = 0.3;         // attribution weight while AFK but acting
  const GRACE_S = 12;              // travel/idle seconds an engagement survives
  const ABANDON_S = 25;            // engagements shorter than this that end in
                                   // a switch count as abandons
  const OPENER_S = 45;             // first engagement this long = session opener
  const CELL = 48;                 // explore-novelty cell size, in game tiles

  // ---------- store ----------
  function freshStore() {
    return {
      v: VER, sessions: 0, totalSec: 0, idleSec: 0, firstAt: Date.now(), lastAt: 0,
      act: {},          // key -> aggregate (see agg())
      kinds: {},        // monster kind -> kills (combat texture for evidence)
      deathsBy: {},     // killer name -> count
      events: { eat: 0, buys: 0, deposits: 0, questsDone: 0 },
      eggs: {},         // easter-egg id -> first-found ms (gameplay/eggs.js)
      cells: [],        // visited explore cells ("cx,cy")
      sessLog: [],      // finalized sessions: {at, dur, top:[[key,sec]..], note}
      insights: [],     // dated journal: {at, msg}
      verdicts: {},     // key -> last verdict (for change detection)
      cur: null,        // in-flight session snapshot (crash recovery / resume)
      hinted: false,    // one-time "press I" log line shown
    };
  }
  function agg(key) {
    let a = S.act[key];
    if (!a) a = S.act[key] = {
      t: 0, n: 0, ab: 0, lg: 0, sess: 0, lastSes: 0, starts: 0, quits: 0,
      deaths: 0, dflee: 0, dquit: 0, dback: 0, kills: 0,
      emaF: null, emaS: null, first: Date.now(), last: 0,
    };
    return a;
  }
  let S;
  try { S = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { S = null; }
  if (!S || S.v !== VER) S = freshStore();
  for (const k of Object.keys(freshStore())) if (S[k] === undefined) S[k] = freshStore()[k];
  const cellSet = new Set(S.cells);

  function persist(clean) {
    S.lastAt = Date.now();
    S.cells = cellSet.size > 30000 ? [...cellSet].slice(-30000) : [...cellSet];
    S.cur = { id: ses.id, startAt: ses.startAt, activeSec: ses.activeSec,
              share: ses.share, endAt: Date.now(), firstKey: ses.firstKey,
              clean: !!clean };
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {}
  }

  // ---------- key labels ----------
  // DECLARED ABOVE THE SESSION BLOCK on purpose: finalizeSnapshot runs at
  // IIFE EVAL time (the previous session's boot summary, just below) and
  // calls label() — with this `const` in its old spot ~250 lines further
  // down, any load after a ≥2-min unfinalized session threw "can't access
  // lexical declaration before initialization" and killed the whole bundle
  // eval. Functions hoist; consts don't.
  const LABELS = {
    combat: "Combat", explore: "Exploring", travel: "Travelling", sailing: "Sailing",
    "ui:map": "Map browsing", "ui:bank": "Banking", "ui:trade": "Shopping & trading",
    "ui:bestiary": "Bestiary reading", "ui:quests": "Quest journal", "ui:skills": "Skill guides",
    "act:gather": "Gathering (misc)", "act:craft": "Crafting (misc)", "act:harvest": "Farming (misc)",
    "act:till": "Farming (misc)", "act:chop": "Farming (misc)", "act:husb": "Husbandry (misc)",
    "act:alch": "Alchemy (misc)",
  };

  // ---------- session ----------
  // Finalize a session snapshot: EMA trend update + session journal entry.
  // Returns the built summary line (or undefined if the snapshot was too
  // short to score) so the boot-time call below can reuse it verbatim for
  // the "while you were away" toast instead of re-deriving it.
  function finalizeSnapshot(snap, note) {
    if (!snap || snap.activeSec < 120) return; // ignore sub-2-min blips
    const keys = new Set([...Object.keys(S.act), ...Object.keys(snap.share)]);
    for (const k of keys) {
      const a = agg(k);
      const sh = (snap.share[k] || 0) / snap.activeSec;
      a.emaF = a.emaF == null ? sh : 0.45 * sh + 0.55 * a.emaF;
      a.emaS = a.emaS == null ? sh : 0.15 * sh + 0.85 * a.emaS;
    }
    const top = Object.entries(snap.share).sort((x, y) => y[1] - x[1]).slice(0, 3)
      .map(([k, s]) => [k, Math.round(s)]);
    S.sessLog.push({ at: snap.startAt, dur: Math.round(snap.activeSec), top, note: note || "" });
    if (S.sessLog.length > 60) S.sessLog.splice(0, S.sessLog.length - 60);
    const parts = top.map(([k, s]) => `${label(k)} ${fmtDur(s)}`).join(", ");
    const msg = `Session ${snap.id} (${fmtDur(snap.activeSec)} attentive): ${parts || "mostly idle"}.${note ? " " + note : ""}`;
    insight(msg);
    return msg;
  }

  // the just-finalized previous session, for Pulse.awaySummary() — null
  // until a real (quick-reload-resumed or too-short) previous session exists
  let lastAway = null;

  let ses;
  {
    const prev = S.cur;
    if (prev && Date.now() - (prev.endAt || 0) < RESUME_MS) {
      // quick reload — continue the interrupted session
      ses = { id: prev.id, startAt: prev.startAt, activeSec: prev.activeSec || 0,
              share: prev.share || {}, firstKey: prev.firstKey || null };
    } else {
      if (prev) {
        const msg = finalizeSnapshot(prev, prev.clean ? "" : "(session ended without a clean quit)");
        if (msg) lastAway = { text: msg, awayMs: Math.max(0, Date.now() - (prev.endAt || Date.now())) };
      }
      S.sessions++;
      ses = { id: S.sessions, startAt: Date.now(), activeSec: 0, share: {}, firstKey: null };
    }
  }

  // ---------- journal ----------
  function insight(msg) {
    S.insights.push({ at: Date.now(), msg });
    if (S.insights.length > 300) S.insights.splice(0, S.insights.length - 300);
  }

  // ---------- live event state (set by wraps, read by the sampler) ----------
  let lastInputAt = Date.now();
  let lastXp = null;              // {skill, at}
  let lastDeath = null;           // {at, key, by, resolved}
  let uiCtx = null;               // {key, until} — bank/shop window context
  let questDoneCount = null;      // last observed player.quests.done size

  for (const ev of ["pointerdown", "keydown", "wheel"])
    window.addEventListener(ev, () => { lastInputAt = Date.now(); }, { capture: true, passive: true });

  // ---------- wraps: timestamp events, never alter behaviour ----------
  // Every wrapped call falls through to the original even if our bookkeeping
  // throws — the observer must be impossible to feel.
  if (typeof addXp === "function") {
    const orig = addXp;
    addXp = function (skill, amt, quiet) {
      try {
        lastXp = { skill, at: Date.now() };
        // name the running engagement after its skill (combat keeps "combat")
        if (player.act && player.act.kind !== "combat") player.act._pk = "skill:" + skill;
      } catch (e) {}
      return orig(skill, amt, quiet);
    };
  }
  if (typeof killMonster === "function") {
    const orig = killMonster;
    killMonster = function (mon) {
      try {
        agg("combat").kills++;
        if (mon && mon.kind) S.kinds[mon.kind] = (S.kinds[mon.kind] || 0) + 1;
      } catch (e) {}
      return orig(mon);
    };
  }
  if (typeof playerDie === "function") {
    const orig = playerDie;
    playerDie = function (by) {
      try {
        const key = cur ? cur.key : "combat";
        agg(key).deaths++;
        S.deathsBy[by] = (S.deathsBy[by] || 0) + 1;
        lastDeath = { at: Date.now(), key, by, resolved: false };
      } catch (e) {}
      return orig(by);
    };
  }
  if (typeof eatItem === "function") {
    const orig = eatItem;
    eatItem = function (i) { try { S.events.eat++; } catch (e) {} return orig(i); };
  }
  if (typeof tradeBuy === "function") {
    const orig = tradeBuy;
    tradeBuy = function (id, price, n) {
      try { S.events.buys++; uiCtx = { key: "ui:trade", until: Date.now() + 25000 }; } catch (e) {}
      return orig(id, price, n);
    };
  }
  if (typeof openMarket === "function") {
    const orig = openMarket;
    openMarket = function (npc) {
      try { uiCtx = { key: "ui:trade", until: Date.now() + 25000 }; } catch (e) {}
      return orig(npc);
    };
  }
  if (typeof openBank === "function") {
    const orig = openBank;
    openBank = function (node) {
      try { uiCtx = { key: "ui:bank", until: Date.now() + 25000 }; } catch (e) {}
      return orig(node);
    };
  }
  if (typeof depositToBank === "function") {
    const orig = depositToBank;
    depositToBank = function (i, n) {
      try { S.events.deposits++; uiCtx = { key: "ui:bank", until: Date.now() + 25000 }; } catch (e) {}
      return orig(i, n);
    };
  }

  // ---------- the 1 Hz sampler ----------
  const SUBSTANTIVE = k => !!k && k !== "travel" && k !== "idle";
  let cur = null;        // running engagement: {key, sec, graceS}
  let lastSub = null;    // {key, at} — last substantive second (quit attribution)
  let lastTick = Date.now();
  let lastPos = null;    // [x, y] at previous sample
  let persistAt = 0, verdictAt = 0;

  function domOpen(id) {
    const el = document.getElementById(id);
    return !!(el && (el.classList.contains("open") || el.classList.contains("show")));
  }

  // Classify what this second was spent on. null = nothing observable.
  function classifySecond(wallNow, moved, newCell) {
    if (player.dying) return "combat";
    const act = player.act;
    if (act) {
      if (act.kind === "combat") return "combat";
      if (act._pk) return act._pk;                 // named by its first XP tick
      if (lastXp && wallNow - lastXp.at < 6000) return "skill:" + lastXp.skill;
      return "act:" + act.kind;                    // pre-first-XP placeholder
    }
    if (typeof wm !== "undefined" && wm.open) return "ui:map";
    if (domOpen("bestiary")) return "ui:bestiary";
    if (domOpen("questlog")) return "ui:quests";
    if (domOpen("skillguide")) return "ui:skills";
    if (uiCtx && wallNow < uiCtx.until) return uiCtx.key;
    if (moved) {
      if (player.sailing) return "sailing";
      return newCell ? "explore" : "travel";
    }
    return null;
  }

  function closeEngagement(e, reason) {
    const a = agg(e.key);
    a.n++;
    if (e.sec > a.lg) a.lg = Math.round(e.sec);
    a.last = Date.now();
    if (e.sec < ABANDON_S && reason === "switch") a.ab++;
    // post-death behaviour: did they return to what killed them, or avoid it?
    if (lastDeath && !lastDeath.resolved && Date.now() - lastDeath.at < 240000 &&
        SUBSTANTIVE(e.key) && e.sec >= 5) {
      lastDeath.resolved = true;
      if (e.key === lastDeath.key) agg(lastDeath.key).dback++;
      else {
        agg(lastDeath.key).dflee++;
        insight(`Died to ${lastDeath.by} and switched straight to ${label(e.key)} — avoiding ${label(lastDeath.key)}?`);
      }
    }
  }

  function sample() {
    const wallNow = Date.now();
    const dtS = Math.min(5, Math.max(0, (wallNow - lastTick) / 1000));
    lastTick = wallNow;
    if (typeof gameReady === "undefined" || !gameReady || document.hidden || !dtS) return;
    if (typeof player === "undefined") return;

    const moved = lastPos && (Math.abs(player.x - lastPos[0]) + Math.abs(player.y - lastPos[1]) > 0.4);
    lastPos = [player.x, player.y];
    let newCell = false;
    if (moved) {
      const c = Math.floor(player.x / CELL) + "," + Math.floor(player.y / CELL);
      if (!cellSet.has(c)) { cellSet.add(c); newCell = true; }
    }

    const afk = wallNow - lastInputAt > AFK_MS;
    let key = classifySecond(wallNow, moved, newCell);
    // AFK with no action running is just an unattended tab
    if (afk && !player.act) key = null;
    const w = afk ? AFK_GRIND_W : 1;

    // ---- engagement segmentation (travel/idle grace keeps runs whole) ----
    if (cur) {
      if (key === cur.key) { cur.sec += dtS * w; cur.graceS = 0; }
      else if (!SUBSTANTIVE(key)) {
        cur.graceS += dtS;
        if (cur.graceS > GRACE_S) { closeEngagement(cur, key === "travel" ? "wander" : "idle"); cur = null; }
      } else if (cur.key.startsWith("act:") && key.startsWith("skill:")) {
        // the engagement just learned its real name — migrate in place
        const a = S.act[cur.key];
        if (a) { const b = agg(key); b.t += a.t; a.t = 0; }
        const sh = ses.share[cur.key] || 0;
        if (sh) { ses.share[key] = (ses.share[key] || 0) + sh; ses.share[cur.key] = 0; }
        cur.key = key; cur.sec += dtS * w; cur.graceS = 0;
      } else { closeEngagement(cur, "switch"); cur = { key, sec: dtS * w, graceS: 0 }; }
    } else if (SUBSTANTIVE(key)) cur = { key, sec: dtS * w, graceS: 0 };

    // ---- attribution ----
    if (key) {
      const sec = dtS * w;
      const a = agg(key);
      a.t += sec;
      if (a.lastSes !== ses.id) { a.sess++; a.lastSes = ses.id; }
      S.totalSec += sec;
      try { maybeWorkshopIntro(sec); } catch (e) {}
      ses.activeSec += sec;
      ses.share[key] = (ses.share[key] || 0) + sec;
      if (SUBSTANTIVE(key)) lastSub = { key, at: wallNow };
      if (!ses.firstKey && cur && cur.key === key && cur.sec >= OPENER_S && SUBSTANTIVE(key)) {
        ses.firstKey = key;
        agg(key).starts++;
      }
    } else if (!afk) S.idleSec += dtS;

    // an unanswered death that never led anywhere = they stopped playing on it
    if (lastDeath && !lastDeath.resolved && wallNow - lastDeath.at > 240000) lastDeath.resolved = true;

    // ---- quest completions (poll the saved quest state) ----
    try {
      const done = player.quests && player.quests.done ? Object.keys(player.quests.done).length : 0;
      if (questDoneCount != null && done > questDoneCount) S.events.questsDone += done - questDoneCount;
      questDoneCount = done;
    } catch (e) {}

    // ---- one-time discoverability hint, then periodic persistence ----
    if (!S.hinted && S.totalSec > 300 && typeof log === "function") {
      S.hinted = true;
      log("The game quietly keeps notes on what you enjoy — press I to read them.", "sys");
    }
    if (wallNow >= persistAt) { persistAt = wallNow + 30000; persist(); }
    if (wallNow >= verdictAt) { verdictAt = wallNow + 300000; noteVerdictChanges(); }
  }
  setInterval(() => { try { sample(); } catch (e) {} }, 1000);

  // ---------- quit / hide handling ----------
  let quitDone = false; // beforeunload AND pagehide both fire on a real close
  function onQuit() {
    if (quitDone) return;
    quitDone = true;
    try {
      const wallNow = Date.now();
      // a long final engagement is "played until done"; only a SHORT last
      // activity before closing the game reads as walking away from it
      const finalSec = cur ? cur.sec : null;
      if (cur) { closeEngagement(cur, "quit"); cur = null; }
      if (lastSub && wallNow - lastSub.at < 90000 && (finalSec == null || finalSec < 180))
        agg(lastSub.key).quits++;
      if (lastDeath && !lastDeath.resolved && wallNow - lastDeath.at < 120000) {
        lastDeath.resolved = true;
        agg(lastDeath.key).dquit++;
        insight(`Quit the game ${Math.round((wallNow - lastDeath.at) / 1000)}s after dying to ${lastDeath.by} — a frustration spike.`);
      }
      noteVerdictChanges();
      persist(true);
    } catch (e) {}
  }
  window.addEventListener("beforeunload", onQuit);
  window.addEventListener("pagehide", onQuit);
  window.addEventListener("pageshow", () => { quitDone = false; lastTick = Date.now(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { try { persist(); } catch (e) {} }
    else lastTick = Date.now(); // don't attribute the hidden gap to anything
  });

  // ---------- inference ----------
  // (LABELS lives above the session block — see the TDZ note there)
  function label(k) { return k.startsWith("skill:") ? k.slice(6) : (LABELS[k] || k); }
  function fmtDur(sec) {
    sec = Math.round(sec);
    if (sec < 90) return sec + "s";
    if (sec < 5400) return Math.round(sec / 60) + "m";
    return (sec / 3600).toFixed(1) + "h";
  }
  const clamp01 = v => Math.max(0, Math.min(1, v));

  // Score one activity. Returns null for keys with too little signal.
  function judge(key, a) {
    if (a.t < 45 && a.n < 2) return null;
    const conf = clamp01((a.t / 1800) * 0.6 + (Math.min(a.sess, 6) / 6) * 0.4);
    const share = S.totalSec ? a.t / S.totalSec : 0;
    const avgLen = a.t / Math.max(1, a.n);
    const abandonRate = a.ab / Math.max(1, a.n);
    const quitRate = a.quits / Math.max(1, a.sess);
    const trend = a.emaS != null && a.emaF != null
      ? Math.max(-1, Math.min(1, (a.emaF - a.emaS) / Math.max(a.emaS, 0.02))) : 0;
    const startRate = a.starts / Math.max(1, S.sessions);
    const deathPain = a.deaths ? (a.dflee * 2 + a.dquit * 3) / a.deaths : 0;
    const resilience = a.deaths ? a.dback / a.deaths : 0;

    const like = clamp01(
      0.36 * clamp01(share * 6) +
      0.22 * clamp01((a.sess - 1) / 5) +
      0.20 * clamp01(avgLen / 240) +
      0.12 * clamp01(startRate * 3) +
      0.06 * clamp01(trend) +
      0.04 * clamp01(resilience));
    const dislike = clamp01(
      0.40 * clamp01(abandonRate * 1.6) +
      0.25 * clamp01(-trend) +
      0.20 * clamp01(deathPain / 3) +
      0.15 * clamp01(quitRate * 2));

    // tried early, tiny total, then multiple sessions of silence
    const dropped = a.t < 240 && a.sess <= 2 && a.lastSes > 0 &&
      S.sessions - a.lastSes >= 3;

    let verdict = "neutral";
    if (conf < 0.2 && !dropped) verdict = "sampled";
    else if (dropped) verdict = "dropped";
    else if (dislike >= 0.5 && dislike > like + 0.1) verdict = "disliked";
    // a collapsing share outranks past fondness — "cooling" IS "used to love"
    else if ((a.emaS || 0) > 0.08 && trend < -0.5) verdict = "cooling";
    else if (like >= 0.62) verdict = "loved";
    else if (like >= 0.42) verdict = "liked";

    // ---- evidence sentence from the dominant factors ----
    const ev = [];
    ev.push(`${fmtDur(a.t)} over ${a.sess} session${a.sess === 1 ? "" : "s"}`);
    if (a.lg >= 300) ev.push(`longest sit ${fmtDur(a.lg)}`);
    if (startRate >= 0.3 && a.starts >= 2) ev.push(`often the first thing done on login`);
    if (trend > 0.4) ev.push("share of playtime rising");
    if (trend < -0.4) ev.push("share of playtime falling");
    if (abandonRate > 0.4 && a.n >= 3) ev.push(`${a.ab}/${a.n} tries abandoned inside ${ABANDON_S}s`);
    if (a.dquit) ev.push(`${a.dquit}× quit the game right after dying here`);
    if (a.dflee >= 2) ev.push(`usually avoids it after a death`);
    if (resilience > 0.6 && a.deaths >= 2) ev.push("comes straight back after deaths");
    if (dropped) ev.push(`untouched for ${S.sessions - a.lastSes} sessions`);
    if (key === "combat" && a.kills) ev.push(`${a.kills} kills`);

    return { key, label: label(key), verdict, like: +like.toFixed(2),
             dislike: +dislike.toFixed(2), conf: +conf.toFixed(2),
             evidence: ev.join("; "),
             stats: { t: Math.round(a.t), n: a.n, ab: a.ab, lg: a.lg, sess: a.sess,
                      starts: a.starts, quits: a.quits, deaths: a.deaths, trend: +trend.toFixed(2) } };
  }

  function report() {
    const rows = [];
    for (const key of Object.keys(S.act)) {
      if (key === "travel" || key === "idle" || key.startsWith("act:")) continue;
      const r = judge(key, S.act[key]);
      if (r) rows.push(r);
    }
    const rank = { loved: 0, liked: 1, cooling: 2, neutral: 3, sampled: 4, dropped: 5, disliked: 6 };
    rows.sort((a, b) => (rank[a.verdict] - rank[b.verdict]) || (b.like - a.like));
    // skills never tried despite real playtime: informational, not "disliked"
    let untouched = [];
    if (typeof SKILLS !== "undefined" && S.sessions >= 4 && S.totalSec > 7200) {
      untouched = SKILLS.filter(s => !S.act["skill:" + s] &&
        !(player.skills && player.skills[s] > 0));
    }
    return { sessions: S.sessions, totalSec: Math.round(S.totalSec),
             idleSec: Math.round(S.idleSec), cellsSeen: cellSet.size,
             verdicts: rows, untouched, insights: S.insights.slice(-40),
             sessLog: S.sessLog.slice(-10), events: S.events };
  }

  // Verdict-change detection -> journal entries ("Mining: neutral -> disliked")
  function noteVerdictChanges() {
    const rows = report().verdicts;
    for (const r of rows) {
      if (r.verdict === "sampled") continue;
      const old = S.verdicts[r.key];
      if (old !== r.verdict) {
        S.verdicts[r.key] = r.verdict;
        if (old || r.verdict !== "neutral")
          insight(`${r.label}: ${old || "unrated"} → ${r.verdict} (${r.evidence}).`);
      }
    }
  }

  function consoleLog() {
    const r = report();
    console.groupCollapsed(`[Pulse] ${r.sessions} sessions, ${fmtDur(r.totalSec)} attentive play`);
    console.table(r.verdicts.map(v => ({ activity: v.label, verdict: v.verdict,
      like: v.like, dislike: v.dislike, conf: v.conf, evidence: v.evidence })));
    if (r.untouched.length) console.info("Never tried:", r.untouched.join(", "));
    for (const i of r.insights.slice(-15))
      console.info(new Date(i.at).toLocaleString() + " — " + i.msg);
    console.groupEnd();
    return r;
  }

  // ---------- viewer (I key) ----------
  const V_META = {
    loved:    ["Loved",           "#7dff9a"],
    liked:    ["Enjoyed",         "#c6f07d"],
    cooling:  ["Cooling off",     "#ffd97d"],
    neutral:  ["Neutral",         "#a99cc4"],
    sampled:  ["Too early to say","#7d90a8"],
    dropped:  ["Tried & dropped", "#ff9d7d"],
    disliked: ["Disliked",        "#ff7d7d"],
  };
  let panelEl = null;
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

  function render() {
    const r = report();
    const groups = {};
    for (const v of r.verdicts) (groups[v.verdict] = groups[v.verdict] || []).push(v);
    let html = `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;color:#ffe97a;font-size:16px;font-weight:bold;border-bottom:1px solid #3a3050;letter-spacing:1px;">
      <span>Play Pulse — what the game thinks you enjoy</span>
      <span style="font-size:11px;font-weight:normal;color:#a99cc4;letter-spacing:0;">${r.sessions} sessions · ${fmtDur(r.totalSec)} attentive · ${r.cellsSeen} regions roamed</span>
      <button id="pulseexport" style="margin-left:auto;background:#2a2335;color:#a99cc4;border:1px solid #4c4160;cursor:pointer;font-size:11px;padding:6px 10px;" title="Save a card of what you love and dislike, as an image">Export card</button>
      <button id="pulseclose" style="width:32px;height:32px;background:#453a58;color:#fff;border:1px solid #6b5c8a;cursor:pointer;font-size:15px;">✕</button>
    </div><div style="flex:1;overflow:auto;padding:12px 16px;font-size:12px;color:#e8dcff;">`;
    if (!r.verdicts.length)
      html += `<div style="color:#a99cc4;padding:20px;">Not enough play observed yet — this fills in as you play.</div>`;
    for (const key of ["loved", "liked", "cooling", "disliked", "dropped", "neutral", "sampled"]) {
      const rows = groups[key];
      if (!rows || !rows.length) continue;
      const [title, colr] = V_META[key];
      html += `<div style="margin:10px 0 4px;color:${colr};font-weight:bold;font-size:13px;letter-spacing:1px;">${title}</div>`;
      for (const v of rows) {
        const bar = Math.round(v.conf * 100);
        html += `<div style="margin:3px 0 7px;padding:6px 8px;background:#1c1626;border:1px solid #3a3050;">
          <div style="display:flex;gap:8px;align-items:baseline;">
            <span style="color:#fff;font-weight:bold;">${esc(v.label)}</span>
            <span style="color:${colr};">${esc(key === "neutral" || key === "sampled" ? "" : title.toLowerCase())}</span>
            <span style="margin-left:auto;color:#7d90a8;font-size:10px;">confidence ${bar}%</span>
          </div>
          <div style="color:#a99cc4;margin-top:2px;">${esc(v.evidence)}</div>
        </div>`;
      }
    }
    if (r.untouched.length)
      html += `<div style="margin:10px 0 4px;color:#7d90a8;font-weight:bold;font-size:13px;letter-spacing:1px;">Never tried</div>
        <div style="color:#a99cc4;">${esc(r.untouched.join(", "))}</div>`;
    // easter eggs — found ones by name, the rest only as a count (no spoilers)
    {
      const eggIds = Object.keys(S.eggs || {});
      const tot = (typeof Eggs !== "undefined" && Eggs.total) ? Eggs.total() : null;
      if (eggIds.length || tot) {
        html += `<div style="margin:14px 0 4px;color:#7fe3c7;font-weight:bold;font-size:13px;letter-spacing:1px;">Secrets found${tot ? ` · ${eggIds.length}/${tot}` : ""}</div>`;
        html += eggIds.length
          ? `<div style="color:#a99cc4;">${esc(eggIds.sort().map(k => k.replace(/_/g, " ")).join(", "))}</div>`
          : `<div style="color:#7d90a8;">None yet — the world keeps its secrets until you trip over them.</div>`;
      }
    }
    const recent = r.insights.slice(-12).reverse();
    if (recent.length) {
      html += `<div style="margin:14px 0 4px;color:#ffe97a;font-weight:bold;font-size:13px;letter-spacing:1px;">Recent observations</div>`;
      for (const i of recent)
        html += `<div style="margin:2px 0;color:#a99cc4;"><span style="color:#7d90a8;">${new Date(i.at).toLocaleDateString()}</span> ${esc(i.msg)}</div>`;
    }
    html += `<div style="margin-top:14px;color:#5d5478;font-size:10px;">Observed passively from how you play. Stored only on this device — <code>Pulse.log()</code> in the console prints the raw numbers.</div></div>`;
    panelEl.innerHTML = html;
    panelEl.querySelector("#pulseclose").onclick = close;
    panelEl.querySelector("#pulseexport").onclick = () => {
      if (typeof Postcard !== "undefined" && Postcard.exportPulseCard) Postcard.exportPulseCard(r);
    };
  }

  function open() {
    if (!panelEl) {
      panelEl = document.createElement("div");
      panelEl.id = "pulsepanel";
      panelEl.style.cssText = "position:absolute;inset:0;z-index:64;background:rgba(16,12,22,0.96);display:flex;flex-direction:column;";
      (document.getElementById("gamecol") || document.body).appendChild(panelEl);
    }
    noteVerdictChanges();
    render();
    panelEl.style.display = "flex";
  }
  function close() { if (panelEl) panelEl.style.display = "none"; }
  const isOpen = () => !!(panelEl && panelEl.style.display !== "none");

  function wire() {
    const btn = document.getElementById("pulsebtn");
    if (btn) btn.onclick = () => (isOpen() ? close() : open());
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && isOpen()) { e.stopPropagation(); close(); return; }
      const t = e.target;
      if ((e.key === "i" || e.key === "I") && !e.altKey && !e.ctrlKey && !e.metaKey &&
          !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) {
        e.preventDefault();
        isOpen() ? close() : open();
      }
    }, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  // ---------- "while you were away" boot toast ----------
  // lastAway (set above, boot-eval time) already holds the previous
  // session's finalized summary line — this just surfaces it once, right
  // after boot, instead of leaving it buried in the I-key viewer.
  let toastEl = null, toastTimer = null;
  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement("div");
    toastEl.id = "pulse-away-toast";
    toastEl.style.cssText = "position:fixed;top:14px;left:50%;z-index:8000;max-width:min(480px,90vw);" +
      "background:#161a26;border:1px solid #3a4a6a;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.5);" +
      "padding:10px 12px 10px 16px;color:#dfe6f2;font:13px/1.4 inherit;display:flex;align-items:flex-start;gap:10px;" +
      "opacity:0;transform:translate(-50%,-8px);transition:opacity .3s ease, transform .3s ease;";
    const body = document.createElement("div");
    body.style.flex = "1";
    const title = document.createElement("div");
    title.style.cssText = "color:#ffd75e;font-weight:bold;";
    title.textContent = "While you were away";
    const line = document.createElement("div");
    line.style.cssText = "margin-top:3px;color:#b8c4dd;";
    const x = document.createElement("button");
    x.textContent = "✕";
    x.style.cssText = "background:none;border:none;color:#8fa3c8;cursor:pointer;font-size:15px;line-height:1;padding:0;";
    x.onclick = hideToast;
    body.appendChild(title); body.appendChild(line);
    toastEl.appendChild(body); toastEl.appendChild(x);
    toastEl._line = line;
    document.body.appendChild(toastEl);
    return toastEl;
  }
  function hideToast() {
    if (!toastEl) return;
    toastEl.style.opacity = "0";
    toastEl.style.transform = "translate(-50%,-8px)";
    clearTimeout(toastTimer);
  }
  function showToast(text) {
    const el = ensureToast();
    el._line.textContent = text;
    requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translate(-50%,0)"; });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 12000);
  }
  // only worth a toast for a real gap — back-to-back reloads/dev refreshes
  // shouldn't nag with "while you were away" every time
  const AWAY_TOAST_MIN_MS = 5 * 60 * 1000;
  function maybeAwayToast() {
    if (!lastAway || lastAway.awayMs < AWAY_TOAST_MIN_MS) return;
    const h = Math.floor(lastAway.awayMs / 3600000), m = Math.round((lastAway.awayMs % 3600000) / 60000) % 60;
    const dur = h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
    showToast(`Away ${dur} — ${lastAway.text}`);
  }

  // ---------- first-session Workshop nudge (Phase 6B) ----------
  // ~12 attentive minutes into a fresh install, a one-time toast: the whole
  // point being sold here is "this world is not finished, and there's a
  // bench with your name on it." Gated on a build actually carrying a
  // Workshop (TAIAO_WORKSHOP_URL, tools/build.mjs), a raw one-time LS flag
  // (idiom: proposal-overlay.js's FLAG_LS), and its own pre-threshold
  // accumulator — kept as plain localStorage rather than folded into S so it
  // survives independently of the Pulse store's own version/reset logic.
  // Driven straight off sample()'s existing weighted-attentive-second value
  // (the same `sec` that feeds S.totalSec below) — no separate timer.
  const WORKSHOP_INTRO_FLAG = "taiao_workshop_intro_v1";
  const WORKSHOP_INTRO_T = "taiao_workshop_intro_t";
  const WORKSHOP_INTRO_S = 12 * 60; // ~12 minutes of attentive play
  let workshopIntroT = 0, workshopIntroInit = false, workshopIntroDone = false, workshopIntroEl = null;
  function dismissWorkshopIntro() {
    if (!workshopIntroEl) return;
    const el = workshopIntroEl; workshopIntroEl = null;
    el.style.opacity = "0"; el.style.transform = "translate(-50%,-8px)";
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 350);
  }
  function showWorkshopIntroToast() {
    if (workshopIntroEl) return; // never stack two
    const el = document.createElement("div");
    el.id = "workshop-intro-toast";
    el.style.cssText = "position:fixed;top:14px;left:50%;z-index:8001;max-width:min(440px,90vw);" +
      "background:#161a26;border:1px solid #6a5a2a;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.5);" +
      "padding:12px 14px;color:#dfe6f2;font:13px/1.4 inherit;" +
      "opacity:0;transform:translate(-50%,-8px);transition:opacity .3s ease, transform .3s ease;";
    const title = document.createElement("div");
    title.style.cssText = "color:#ffd75e;font-weight:bold;margin-bottom:4px;";
    title.textContent = "This world is not finished.";
    const body = document.createElement("div");
    body.style.cssText = "color:#b8c4dd;margin-bottom:8px;";
    body.textContent = "Nearly everything you've met so far — the creatures, the songs, the quests — " +
      "was put here by players. The Workshop is where it happens, and there's a bench with your name on it.";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:center;";
    const openBtn = document.createElement("button");
    openBtn.textContent = "Open the Workshop ↗";
    openBtn.style.cssText = "background:#3a2f1a;border:1px solid #6a5a2a;color:#ffd75e;border-radius:4px;" +
      "cursor:pointer;font-size:12px;padding:4px 10px;";
    openBtn.onclick = () => { window.open(TAIAO_WORKSHOP_URL, "_blank"); dismissWorkshopIntro(); };
    const laterBtn = document.createElement("button");
    laterBtn.textContent = "Later";
    laterBtn.style.cssText = "background:none;border:1px solid #3a4a6a;color:#8fa3c8;border-radius:4px;" +
      "cursor:pointer;font-size:12px;padding:4px 10px;";
    laterBtn.onclick = dismissWorkshopIntro;
    row.appendChild(openBtn); row.appendChild(laterBtn);
    const foot = document.createElement("div");
    foot.style.cssText = "margin-top:6px;color:#6c7690;font-size:10px;";
    foot.textContent = "It lives in the Help tab whenever you want it.";
    el.appendChild(title); el.appendChild(body); el.appendChild(row); el.appendChild(foot);
    document.body.appendChild(el);
    workshopIntroEl = el;
    requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translate(-50%,0)"; });
    setTimeout(dismissWorkshopIntro, 30000);
  }
  // sec: this tick's weighted attentive seconds (same value just folded into
  // S.totalSec) — only substantive/attributed ticks call this at all.
  function maybeWorkshopIntro(sec) {
    if (workshopIntroDone) return;
    if (typeof TAIAO_WORKSHOP_URL === "undefined" || !TAIAO_WORKSHOP_URL) { workshopIntroDone = true; return; }
    // never during the Bifrost cinematic, and never stack over the I-key panel
    if (typeof Bifrost !== "undefined" && Bifrost.active && Bifrost.active()) return;
    if (isOpen()) return;
    try {
      if (!workshopIntroInit) {
        workshopIntroInit = true;
        if (localStorage.getItem(WORKSHOP_INTRO_FLAG)) { workshopIntroDone = true; return; }
        workshopIntroT = parseFloat(localStorage.getItem(WORKSHOP_INTRO_T)) || 0;
      }
      workshopIntroT += sec;
      if (workshopIntroT < WORKSHOP_INTRO_S) {
        localStorage.setItem(WORKSHOP_INTRO_T, String(Math.round(workshopIntroT)));
        return;
      }
      localStorage.setItem(WORKSHOP_INTRO_FLAG, "1");
    } catch (e) { workshopIntroDone = true; return; }
    workshopIntroDone = true;
    showWorkshopIntroToast();
  }

  // ---------- discrete-event intake (goals-arc.js, eggs.js) ----------
  // noteEvent bumps a named counter in S.events; noteEgg records an easter
  // egg's FIRST discovery (id -> ms) and drops an insight line so it shows
  // up in "Recent observations" too. Both persist on the normal cadence.
  function noteEvent(k) { S.events[k] = (S.events[k] || 0) + 1; }
  function noteEgg(id) {
    if (!S.eggs) S.eggs = {}; // stores from before the eggs field existed
    if (S.eggs[id]) return;
    S.eggs[id] = Date.now();
    insight(`Secret found: ${id.replace(/_/g, " ")}.`);
    persist();
  }

  window.Pulse = { report, log: consoleLog, open, close, toggle: () => (isOpen() ? close() : open()),
                   awaySummary: () => lastAway, maybeAwayToast, noteEvent, noteEgg,
                   _store: () => S, _session: () => ses, _sample: sample };
})();
