/* analytics.js — tutorial funnel + Play Pulse aggregates.
 *
 * Two public surfaces feed the Workshop's Statistics tab:
 *   POST /api/tutorial/summary  — the client posts a compact, growing summary of
 *       one tutorial attempt (checkpoints during play + a final flush). Upserted
 *       by session_id so a re-send OVERWRITES, never double-counts. The FULL body
 *       (incl. per-skill detail) is also stored verbatim in R2 at
 *       tutorial/<day>/<session>.json for maintainer-only deep analysis.
 *   GET  /api/tutorial/stats    — public aggregates: funnel, per-stage mean/stddev
 *       time, per-stage action means, graduation rate. Computed by SQL GROUP BY.
 *   POST /api/pulse/report      — the client posts its Play Pulse report (the I-key
 *       verdicts). Upserted per device.
 *   GET  /api/pulse/stats       — public: which activities players love/like/dislike.
 *
 * The EXTREMELY DETAILED per-player play-by-play is NOT here — it rides the
 * telemetry pipe (js/net/telemetry.js → /api/telemetry → R2 tele/, ADMIN_TOKEN
 * only). D1 holds only the aggregate-able numbers. Raw per-session summaries in
 * R2 and the telemetry stream are both reachable ONLY with ADMIN_TOKEN
 * (adminTutorial below + telemetry.adminBrowse) — nobody but the maintainer.
 */

import { json, err, readJson, now, authUser, rateLimit, clientIp, constantTimeEqual } from "./util.js";

const MAX_BODY = 256 * 1024;
const CACHE = { "cache-control": "public, max-age=60" };
const num = (v, d = 0) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : d);
const clampIdx = v => Math.max(0, Math.min(15, Math.floor(Number(v) || 0)));

async function isAdmin(req, env) {
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") || "");
  return !!(env.ADMIN_TOKEN && m && await constantTimeEqual(m[1], env.ADMIN_TOKEN));
}

// ---- tutorial summary ingest ----------------------------------------------

export async function tutorialSummary(req, env) {
  const user = await authUser(req, env);   // the silent guest; optional
  const b = await readJson(req, MAX_BODY);
  if (!b || typeof b.session !== "string" || !/^[\w.:-]{6,64}$/.test(b.session))
    return err("Bad request body.");
  // Throttle per session + per IP so checkpoints can't hammer D1/R2.
  if (!await rateLimit(env, `tutsum:${b.session}`, 500, 86400)) return err("Too many updates.", 429);
  if (!await rateLimit(env, `tutsum-ip:${clientIp(req)}`, 2000, 3600)) return err("Too many updates.", 429);

  const t = now();
  const sid = b.session;
  const sessRow = {
    uid: user ? user.id : null,
    is_guest: b.isGuest === false ? 0 : 1,
    build: typeof b.build === "string" ? b.build.slice(0, 24) : null,
    started_at: num(b.startedAt, t),
    graduated: b.graduated ? 1 : 0,
    final_idx: clampIdx(b.finalIdx),
    stages_reached: num(b.stagesReached),
    total_ms: num(b.totalMs),
    active_ms: num(b.activeMs),
    idle_ms: num(b.idleMs),
    walk_tiles: num(b.walkTiles),
    kills: num(b.kills),
    deaths: num(b.deaths),
    talks: num(b.talks),
  };
  await env.DB.prepare(
    `INSERT INTO tut_sessions
       (session_id, uid, is_guest, build, started_at, updated_at, graduated, final_idx,
        stages_reached, total_ms, active_ms, idle_ms, walk_tiles, kills, deaths, talks)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(session_id) DO UPDATE SET
       uid=COALESCE(excluded.uid, uid), is_guest=excluded.is_guest, build=COALESCE(excluded.build, build),
       updated_at=excluded.updated_at, graduated=excluded.graduated, final_idx=excluded.final_idx,
       stages_reached=excluded.stages_reached, total_ms=excluded.total_ms, active_ms=excluded.active_ms,
       idle_ms=excluded.idle_ms, walk_tiles=excluded.walk_tiles, kills=excluded.kills,
       deaths=excluded.deaths, talks=excluded.talks`
  ).bind(sid, sessRow.uid, sessRow.is_guest, sessRow.build, sessRow.started_at, t,
    sessRow.graduated, sessRow.final_idx, sessRow.stages_reached, sessRow.total_ms,
    sessRow.active_ms, sessRow.idle_ms, sessRow.walk_tiles, sessRow.kills, sessRow.deaths, sessRow.talks).run();

  // per-stage rows (upsert each; cap 20)
  const stages = Array.isArray(b.stages) ? b.stages.slice(0, 20) : [];
  for (const s of stages) {
    if (!s || typeof s !== "object") continue;
    const idx = clampIdx(s.idx);
    const stage = String(s.stage || ("stage" + idx)).slice(0, 24);
    await env.DB.prepare(
      `INSERT INTO tut_stage_stats
         (session_id, idx, stage, ms, active_ms, idle_ms, walk_tiles, gather, craft, kills, deaths, talks, enters, completed)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(session_id, idx) DO UPDATE SET
         stage=excluded.stage, ms=excluded.ms, active_ms=excluded.active_ms, idle_ms=excluded.idle_ms,
         walk_tiles=excluded.walk_tiles, gather=excluded.gather, craft=excluded.craft, kills=excluded.kills,
         deaths=excluded.deaths, talks=excluded.talks, enters=excluded.enters, completed=excluded.completed`
    ).bind(sid, idx, stage, num(s.ms), num(s.activeMs), num(s.idleMs), num(s.walkTiles),
      num(s.gather), num(s.craft), num(s.kills), num(s.deaths), num(s.talks),
      num(s.enters, 1), s.completed ? 1 : 0).run();
  }

  // Store the FULL body verbatim for maintainer-only deep analysis (per-skill
  // breakdowns, menu counts, etc. the client includes beyond the D1 columns).
  try {
    const day = new Date(t).toISOString().slice(0, 10);
    await env.VAULT.put(`tutorial/${day}/${sid}.json`,
      JSON.stringify({ ...b, uid: sessRow.uid, recvAt: t, country: (req.cf && req.cf.country) || null }),
      { httpMetadata: { contentType: "application/json" } });
  } catch (e) { /* R2 hiccup is non-fatal; D1 aggregate already landed */ }

  return json({ ok: true });
}

// ---- public tutorial aggregates -------------------------------------------

const STD = (mean, msq) => Math.sqrt(Math.max(0, (msq || 0) - mean * mean));

export async function tutorialStats(req, env) {
  // Overall (ignore <5s noise boots).
  const ov = await env.DB.prepare(
    `SELECT COUNT(*) n, SUM(graduated) grad, AVG(total_ms) mean_ms, AVG(total_ms*total_ms) msq_ms,
            AVG(active_ms) active_ms, AVG(idle_ms) idle_ms, AVG(stages_reached) reached,
            AVG(walk_tiles) walk, AVG(kills) kills, AVG(deaths) deaths, AVG(talks) talks
     FROM tut_sessions WHERE total_ms >= 5000`
  ).first();
  const sessions = num(ov && ov.n);
  const overall = {
    sessions,
    graduated: num(ov && ov.grad),
    gradRate: sessions ? (num(ov.grad) / sessions) : 0,
    meanMs: Math.round((ov && ov.mean_ms) || 0),
    stddevMs: Math.round(STD((ov && ov.mean_ms) || 0, (ov && ov.msq_ms) || 0)),
    meanActiveMs: Math.round((ov && ov.active_ms) || 0),
    meanIdleMs: Math.round((ov && ov.idle_ms) || 0),
    meanStagesReached: +(((ov && ov.reached) || 0).toFixed(2)),
    meanWalkTiles: Math.round((ov && ov.walk) || 0),
    meanKills: +(((ov && ov.kills) || 0).toFixed(2)),
    meanDeaths: +(((ov && ov.deaths) || 0).toFixed(2)),
    meanTalks: +(((ov && ov.talks) || 0).toFixed(2)),
  };

  // Per-stage.
  const rows = (await env.DB.prepare(
    `SELECT idx, stage, COUNT(*) n, SUM(completed) completed,
            AVG(ms) mean_ms, AVG(ms*ms) msq_ms, AVG(active_ms) active, AVG(idle_ms) idle,
            AVG(walk_tiles) walk, AVG(gather) gather, AVG(craft) craft,
            AVG(kills) kills, AVG(deaths) deaths, AVG(talks) talks
     FROM tut_stage_stats GROUP BY idx, stage ORDER BY idx`
  ).all()).results || [];
  const stages = rows.map(r => ({
    idx: r.idx, stage: r.stage,
    reached: num(r.n), completed: num(r.completed),
    meanMs: Math.round(r.mean_ms || 0),
    stddevMs: Math.round(STD(r.mean_ms || 0, r.msq_ms || 0)),
    meanActiveMs: Math.round(r.active || 0),
    meanIdleMs: Math.round(r.idle || 0),
    meanWalkTiles: Math.round(r.walk || 0),
    meanGather: +((r.gather || 0).toFixed(1)),
    meanCraft: +((r.craft || 0).toFixed(1)),
    meanKills: +((r.kills || 0).toFixed(2)),
    meanDeaths: +((r.deaths || 0).toFixed(2)),
    meanTalks: +((r.talks || 0).toFixed(2)),
  }));
  return json({ ok: true, overall, stages, generatedAt: now() }, 200, CACHE);
}

// ---- play pulse ------------------------------------------------------------

export async function pulseReport(req, env) {
  const user = await authUser(req, env);
  const b = await readJson(req, MAX_BODY);
  if (!b || typeof b.device !== "string" || !/^[\w-]{4,64}$/.test(b.device))
    return err("Bad request body.");
  if (!await rateLimit(env, `pulse:${b.device}`, 100, 3600)) return err("Too many reports.", 429);
  // Keep only the compact verdict list (bounded) — no need for the full report.
  const verdicts = Array.isArray(b.verdicts) ? b.verdicts.slice(0, 40).map(v => ({
    key: String(v.key || "").slice(0, 40),
    label: String(v.label || "").slice(0, 60),
    verdict: String(v.verdict || "").slice(0, 16),
    like: Number.isFinite(v.like) ? +v.like.toFixed(3) : 0,
    dislike: Number.isFinite(v.dislike) ? +v.dislike.toFixed(3) : 0,
  })).filter(v => v.key) : [];
  await env.DB.prepare(
    `INSERT INTO pulse_reports (device, uid, updated_at, sessions, total_sec, data_json)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(device) DO UPDATE SET uid=excluded.uid, updated_at=excluded.updated_at,
       sessions=excluded.sessions, total_sec=excluded.total_sec, data_json=excluded.data_json`
  ).bind(b.device, user ? user.id : null, now(), num(b.sessions), num(b.totalSec), JSON.stringify(verdicts)).run();
  return json({ ok: true });
}

export async function pulseStats(req, env) {
  const rows = (await env.DB.prepare(
    `SELECT data_json FROM pulse_reports ORDER BY updated_at DESC LIMIT 5000`
  ).all()).results || [];
  // Tally verdicts per activity key across all reporting devices.
  const agg = {};   // key -> { key, label, n, loved, liked, disliked, cooling, dropped, sampled, sumLike, sumDislike }
  let devices = 0;
  for (const r of rows) {
    let vs; try { vs = JSON.parse(r.data_json); } catch (e) { continue; }
    if (!Array.isArray(vs)) continue;
    devices++;
    for (const v of vs) {
      const a = (agg[v.key] = agg[v.key] || { key: v.key, label: v.label, n: 0, verdicts: {}, sumLike: 0, sumDislike: 0 });
      a.n++; a.label = v.label || a.label;
      a.verdicts[v.verdict] = (a.verdicts[v.verdict] || 0) + 1;
      a.sumLike += v.like || 0; a.sumDislike += v.dislike || 0;
    }
  }
  const activities = Object.values(agg).map(a => ({
    key: a.key, label: a.label, n: a.n, verdicts: a.verdicts,
    liked: (a.verdicts.loved || 0) + (a.verdicts.liked || 0),
    disliked: (a.verdicts.disliked || 0) + (a.verdicts.cooling || 0),
    meanLike: a.n ? +(a.sumLike / a.n).toFixed(3) : 0,
    meanDislike: a.n ? +(a.sumDislike / a.n).toFixed(3) : 0,
  })).sort((x, y) => y.n - x.n);
  return json({ ok: true, devices, activities, generatedAt: now() }, 200, { "cache-control": "public, max-age=120" });
}

// ---- maintainer-only raw tutorial access (ADMIN_TOKEN) ---------------------

/* GET /api/admin/tutorial?day=YYYY-MM-DD[&cursor=] — list a day's session summaries.
 * GET /api/admin/tutorial?key=tutorial/.../....json  — fetch one full summary. */
export async function adminTutorial(req, env, url) {
  if (!await isAdmin(req, env)) return err("Nope.", 403);
  const key = url.searchParams.get("key");
  if (key) {
    if (!key.startsWith("tutorial/")) return err("Tutorial keys only.");
    const obj = await env.VAULT.get(key);
    if (!obj) return err("Not found.", 404);
    return new Response(obj.body, { headers: { "content-type": "application/json" } });
  }
  const day = url.searchParams.get("day") || new Date(now()).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return err("Need day=YYYY-MM-DD or key=.");
  const list = await env.VAULT.list({
    prefix: `tutorial/${day}/`, limit: 500,
    cursor: url.searchParams.get("cursor") || undefined,
  });
  return json({
    ok: true, day,
    sessions: list.objects.map(o => ({ key: o.key, size: o.size })),
    cursor: list.truncated ? list.cursor : null,
  });
}
