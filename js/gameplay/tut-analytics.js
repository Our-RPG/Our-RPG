// ===== Tutorial analytics — thorough per-player capture of the Tūhura Isle run =====
// Two channels, both honouring the "Share gameplay data" opt-out (Tele.optedOut):
//   1. A DETAILED raw play-by-play via the existing telemetry pipe (Tele.ev) —
//      every stage change, gather/craft/kill/death/talk/panel, and periodic
//      position + goal-progress samples. Rides the keepalive flush on quit, lands
//      in R2 tele/ (ADMIN_TOKEN only). This is the "exactly what the player did"
//      stream for the private admin analysis.
//   2. A COMPACT per-attempt SUMMARY (per-stage time/active/idle + action counts)
//      POSTed to /api/tutorial/summary as periodic checkpoints + a final flush.
//      Upserted by session id server-side, so it powers the public aggregate
//      Statistics page without ever double-counting a re-send.
// Also ships the Play Pulse report (the I-key verdicts) to /api/pulse/report.
//
// Loaded LAST (after telemetry.js in bundle.list): every global it wraps/reads —
// Tutorial, Tele, Server, Pulse, killMonster, playerDie, talkTo, showPanel,
// addXp — already exists, so its wraps sit outermost and chain through.
"use strict";

(function () {
  // Never record dev plays (keeps the real funnel clean), and only where the
  // telemetry module is live (it's a stub without a SERVER_URL).
  const DEV = (typeof DEV_MODE !== "undefined" && DEV_MODE);
  const hasTele = () => typeof Tele !== "undefined" && Tele && typeof Tele.ev === "function";
  const optedOut = () => !hasTele() || (Tele.optedOut && Tele.optedOut());
  const srvOn = () => typeof Server !== "undefined" && Server && Server.enabled && Server.enabled();

  // skill → coarse action category, for per-stage gather/craft counts (combat
  // is counted via killMonster). Anything unlisted still rides the raw stream.
  const GATHER = new Set(["Woodcutting", "Mining", "Ore-mining", "Stone-mining", "Gem-mining",
    "Fishing", "Foraging", "Farming", "Agriculture", "Husbandry", "Rubbermaking"]);
  const CRAFT = new Set(["Smelting", "Smithing", "Weaponsmithing", "Armoursmithing", "Cooking",
    "Baking", "Cheesemaking", "Candlemaking", "Carpentry", "Woodcraft", "Fletching", "Milling",
    "Spinning", "Weaving", "Tailoring", "Tanning", "Leathercraft", "Firemaking", "Pottery", "Toolcraft"]);

  const CHECKPOINT_MS = 45000;   // POST a summary this often while in the tutorial
  const PULSE_MS = 150000;       // POST the pulse report this often
  const POS_MS = 10000;          // raw position sample cadence
  const IDLE_MS = 90000;         // no-input threshold = AFK

  let rec = null;                // the active attempt record, or null
  let curIdx = 0, maxIdx = 0;
  let lastPos = null;
  let lastInput = Date.now();
  let lastGoalSum = 0;
  let lastCheckpoint = 0, lastPulse = 0, lastPos_t = 0;
  let actedThisSec = false;

  // last-input clock (capture phase so it always sees the event)
  ["pointerdown", "keydown", "wheel", "touchstart"].forEach(ev =>
    window.addEventListener(ev, () => { lastInput = Date.now(); }, true));

  function active() { try { return typeof Tutorial !== "undefined" && Tutorial.active && Tutorial.active(); } catch (e) { return false; } }
  function frontier() { try { return Tutorial.frontier ? Tutorial.frontier() : 0; } catch (e) { return 0; } }
  function goalState() { try { return Tutorial.goalState ? Tutorial.goalState() : null; } catch (e) { return null; } }
  function stageIdOf(i) { const gs = goalState(); return (gs && gs.cur && gs.cur.id) || ("stage" + i); }

  function ident() {
    const T = hasTele() && Tele.report ? Tele.report() : null;
    const S = (typeof Server !== "undefined") ? Server : null;
    return {
      session: (T && T.session) || ("tut" + Date.now()),
      device: (T && T.device) || null,
      uid: (S && S.user && S.user.id) || null,
      isGuest: !!(S && S.isGuest && S.isGuest()),
      build: (typeof WORLDGEN_SIG !== "undefined" && WORLDGEN_SIG) || null,
    };
  }

  function bucket(i) {
    if (!rec) return null;
    if (!rec.stages[i]) rec.stages[i] = { idx: i, stage: stageIdOf(i), ms: 0, activeMs: 0, idleMs: 0,
      walkTiles: 0, gather: 0, craft: 0, kills: 0, deaths: 0, talks: 0, enters: 1, completed: 0 };
    return rec.stages[i];
  }

  function start() {
    if (rec || DEV || optedOut()) return;
    const id = ident();
    rec = { ...id, startedAt: Date.now(), graduated: false, finalIdx: frontier(), stages: {} };
    curIdx = maxIdx = frontier();
    bucket(curIdx);
    lastPos = null; lastGoalSum = sumGoals(); lastCheckpoint = Date.now();
    if (hasTele()) Tele.ev("tut_start", curIdx, rec.isGuest ? 1 : 0);
  }

  function sumGoals() {
    const gs = goalState();
    if (!gs || !gs.cur || !Array.isArray(gs.cur.rows)) return 0;
    return gs.cur.rows.reduce((s, r) => s + (Number(r.num) || 0), 0);
  }

  function markCompleted(i) { const b = rec && rec.stages[i]; if (b) b.completed = 1; }

  // ---- the 1 Hz sampler ----
  function tick() {
    try {
      const isActive = active();
      if (!rec) { if (isActive) start(); if (!rec) return; }

      // graduation / leaving the isle → finalize once
      const grad = (typeof player !== "undefined" && player && player.tutorial && player.tutorial.graduated) ? true : false;
      if (grad && !rec.graduated) { rec.graduated = true; rec.finalIdx = frontier(); if (hasTele()) Tele.ev("tut_graduate", rec.finalIdx); finalize(); return; }
      if (!isActive) { if (!rec.graduated) finalize(); return; }

      const now = Date.now();
      const f = frontier();
      if (f !== curIdx) {
        // frontier advanced — everything strictly below f is now completed
        for (let i = curIdx; i < f; i++) markCompleted(i);
        curIdx = f;
        const b = bucket(curIdx); if (b) b.enters++;
        if (f > maxIdx) maxIdx = f;
        rec.finalIdx = f;
        if (hasTele()) Tele.ev("tut_stage", f, stageIdOf(f));
      }
      const b = bucket(curIdx);
      if (!b) return;
      b.ms += 1000;

      // movement
      let moved = false;
      if (typeof player !== "undefined" && player && player.px !== undefined) {
        if (lastPos) {
          const tiles = Math.abs(player.x - lastPos.x) + Math.abs(player.y - lastPos.y);
          if (tiles > 0.4 && tiles < 12) { b.walkTiles += Math.round(tiles); moved = true; }
        }
        lastPos = { x: player.x, y: player.y };
        if (now - lastPos_t >= POS_MS) { lastPos_t = now; if (hasTele()) Tele.ev("tut_pos", curIdx, Math.round(player.x), Math.round(player.y)); }
      }

      // goal progress → active + raw event
      const gsum = sumGoals();
      let progressed = false;
      if (gsum > lastGoalSum) { progressed = true; if (hasTele()) Tele.ev("tut_goal", curIdx, gsum - lastGoalSum); }
      lastGoalSum = gsum;

      // active vs idle classification for the second
      const acting = (typeof player !== "undefined" && player && player.act) ? true : false;
      if (moved || acting || progressed || actedThisSec) b.activeMs += 1000;
      else if (now - lastInput > IDLE_MS) b.idleMs += 1000;
      actedThisSec = false;

      if (now - lastCheckpoint >= CHECKPOINT_MS) { lastCheckpoint = now; sendSummary(false); }
      if (now - lastPulse >= PULSE_MS) { lastPulse = now; sendPulse(); }
    } catch (e) { /* analytics must never break the game */ }
  }

  // ---- summary build + send ----
  function buildBody() {
    if (!rec) return null;
    const stages = Object.values(rec.stages).sort((a, b) => a.idx - b.idx);
    const tot = stages.reduce((o, s) => {
      o.totalMs += s.ms; o.activeMs += s.activeMs; o.idleMs += s.idleMs; o.walkTiles += s.walkTiles;
      o.kills += s.kills; o.deaths += s.deaths; o.talks += s.talks; return o;
    }, { totalMs: 0, activeMs: 0, idleMs: 0, walkTiles: 0, kills: 0, deaths: 0, talks: 0 });
    return {
      session: rec.session, device: rec.device, uid: rec.uid, isGuest: rec.isGuest, build: rec.build,
      startedAt: rec.startedAt, graduated: rec.graduated ? 1 : 0,
      finalIdx: rec.finalIdx, stagesReached: Object.keys(rec.stages).length,
      ...tot, stages,
    };
  }

  function sendSummary(final) {
    if (!rec || DEV || optedOut() || !srvOn()) return;
    const body = buildBody();
    if (!body) return;
    // Server.call keeps the auth header (so the guest uid is recorded) and sets
    // keepalive on the final flush so it survives a page unload. sendBeacon is
    // avoided precisely because it can't carry the Bearer token.
    try { if (Server.call) Server.call("/api/tutorial/summary", { body, keepalive: !!final }).catch(() => {}); } catch (e) {}
  }

  function finalize() {
    if (!rec) return;
    if (hasTele()) { Tele.ev("tut_summary", rec.finalIdx, rec.graduated ? 1 : 0); Tele.flush && Tele.flush(); }
    sendSummary(true);
    sendPulse(true);
    rec = null;   // one record per attempt; a later tutorial run starts fresh
  }

  // ---- play pulse report ----
  function sendPulse(final) {
    if (DEV || optedOut() || !srvOn()) return;
    try {
      if (typeof Pulse === "undefined" || !Pulse.report) return;
      const r = Pulse.report();
      if (!r) return;
      const id = ident();
      const body = {
        device: id.device, sessions: r.sessions || 0, totalSec: r.totalSec || 0,
        verdicts: (r.verdicts || []).slice(0, 40).map(v => ({ key: v.key, label: v.label, verdict: v.verdict, like: v.like, dislike: v.dislike })),
      };
      if (!body.device || !body.verdicts.length) return;
      if (Server.call) Server.call("/api/pulse/report", { body, keepalive: !!final }).catch(() => {});
    } catch (e) {}
  }

  // ---- wrap action globals (direct name reassignment — same shared-scope trick
  // pulse.js uses; these are bundle-scope function declarations, NOT window.*).
  // Each wrap records only during a live tutorial attempt, then chains through to
  // whatever telemetry/pulse already wrapped. Guarded so bookkeeping never throws
  // out of the real call. ----
  const note = fn => { try { if (rec && active()) fn(); } catch (e) {} };

  if (typeof addXp === "function") {
    const g = addXp;
    addXp = function (skill, amt) {
      note(() => { const b = bucket(curIdx); if (!b) return; actedThisSec = true;
        if (GATHER.has(skill)) b.gather++; else if (CRAFT.has(skill)) b.craft++;
        if (hasTele()) Tele.ev("tut_xp", curIdx, String(skill || "?"), Math.round(amt || 0)); });
      return g.apply(this, arguments);
    };
  }
  if (typeof killMonster === "function") {
    const g = killMonster;
    killMonster = function (mon) {
      note(() => { const b = bucket(curIdx); if (b) { b.kills++; actedThisSec = true; } if (hasTele()) Tele.ev("tut_kill", curIdx, (mon && mon.kind) || "?"); });
      return g.apply(this, arguments);
    };
  }
  if (typeof playerDie === "function") {
    const g = playerDie;
    playerDie = function (by) {
      note(() => { const b = bucket(curIdx); if (b) b.deaths++; if (hasTele()) Tele.ev("tut_die", curIdx, String(by || "?")); });
      return g.apply(this, arguments);
    };
  }
  if (typeof talkTo === "function") {
    const g = talkTo;
    talkTo = function (npc) {
      note(() => { const b = bucket(curIdx); if (b) { b.talks++; actedThisSec = true; } if (hasTele()) Tele.ev("tut_talk", curIdx, (npc && (npc.tutor || npc.name)) || "?"); });
      return g.apply(this, arguments);
    };
  }
  if (typeof showPanel === "function") {
    const g = showPanel;
    showPanel = function (p) {
      note(() => { if (hasTele()) Tele.ev("tut_panel", curIdx, String(p || "?")); });
      return g.apply(this, arguments);
    };
  }
  if (typeof tickGather === "function") {
    const g = tickGather;
    tickGather = function (act) {
      note(() => { actedThisSec = true; const nt = act && act.node; if (hasTele() && nt) Tele.ev("tut_gathertick", curIdx, String(nt.type != null ? nt.type : "?")); });
      return g.apply(this, arguments);
    };
  }

  // the keeper-intro funnel: mark the stage's intro as seen (completion still
  // needs its task, tracked by frontier advancing).
  if (typeof Tutorial !== "undefined" && Tutorial && typeof Tutorial.complete === "function") {
    const oc = Tutorial.complete;
    Tutorial.complete = function (id) {
      try { if (rec && active() && hasTele()) Tele.ev("tut_keeper", curIdx, String(id || "?")); } catch (e) {}
      return oc.apply(this, arguments);
    };
  }

  // flush on quit — the raw stream rides Tele's own keepalive; this adds the
  // final summary + pulse beacon.
  const onEnd = () => { try { if (rec) finalize(); else sendPulse(true); } catch (e) {} };
  window.addEventListener("pagehide", onEnd, true);
  window.addEventListener("beforeunload", onEnd, true);

  // start the sampler once the game is up
  function boot() { setInterval(tick, 1000); }
  if (typeof window !== "undefined") {
    if (document.readyState === "complete") setTimeout(boot, 3000);
    else window.addEventListener("load", () => setTimeout(boot, 3000));
  }

  window.TutAnalytics = { _rec: () => rec, _flush: () => sendSummary(true), report: buildBody };
})();
