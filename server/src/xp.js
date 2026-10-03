/* xp.js — provisional leaderboards + per-skill XP distributions.
 * The fixed curve still governs gameplay (audit §8); this only starts the
 * data flywheel percentiles need. Everything here is public + cacheable.
 * "Qualifying" filtering by the level-16 floor is a query param so the
 * client (which owns the XP curve) supplies the floor value.
 *
 * Source is validated_xp (envelope.js), like ranks.js — NEVER the raw opt-in
 * xp_snapshots, which are client-authoritative and forgeable by a single
 * upload. The public board and distribution must reflect envelope-validated
 * XP only; don't point these reads back at xp_snapshots. */

import { json, err, now } from "./util.js";

const QUALIFY_WINDOW = 90 * 864e5;    // validated play in the last 90 days
const PROVISIONAL_BELOW = 1000;       // audit §8 cold-start threshold
const PERCENTILES = [10, 25, 50, 75, 90, 95, 98, 99, 99.6, 99.9, 99.99];
const CACHE = { "cache-control": "public, max-age=300" };

export async function distribution(req, env, url) {
  const skill = String(url.searchParams.get("skill") || "").slice(0, 40);
  if (!skill) return err("skill required");
  const min = Math.max(0, Number(url.searchParams.get("min") || 0));
  const rows = await env.DB.prepare(
    `SELECT v.xp FROM validated_xp v JOIN users u ON u.id = v.user_id
     WHERE v.skill = ? AND v.xp >= ? AND v.updated_at >= ?
     AND u.flags NOT LIKE '%banned%' ORDER BY v.xp LIMIT 100000`
  ).bind(skill, min, now() - QUALIFY_WINDOW).all();
  const xs = rows.results.map(r => r.xp);
  const breakpoints = {};
  for (const p of PERCENTILES)
    breakpoints[p] = xs.length ? xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : 0;
  return json({
    ok: true, skill, qualifying: xs.length,
    provisional: xs.length < PROVISIONAL_BELOW,
    breakpoints,
  }, 200, CACHE);
}

export async function leaderboard(req, env, url) {
  const skill = String(url.searchParams.get("skill") || "").slice(0, 40);
  if (!skill) return err("skill required");
  const n = Math.min(100, Math.max(1, Number(url.searchParams.get("n") || 25)));
  const rows = await env.DB.prepare(
    `SELECT u.username, x.xp, x.updated_at FROM validated_xp x
     JOIN users u ON u.id = x.user_id
     WHERE x.skill = ? AND x.updated_at >= ? AND u.flags NOT LIKE '%banned%'
     ORDER BY x.xp DESC LIMIT ?`
  ).bind(skill, now() - QUALIFY_WINDOW, n).all();
  return json({ ok: true, skill, provisional: true, top: rows.results }, 200, CACHE);
}
