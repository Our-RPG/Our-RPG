/* players.js — the world roster.
 *
 * "Online now" is served live from the GlobalHub Durable Object (in memory,
 * accurate) — the client already has it. This endpoint answers the other half:
 * everyone SEEN in the last 24 hours, newest first, so the roster dialogue can
 * show "last online N ago". last_seen is kept fresh by authToken (util.js), so
 * it tracks real activity, not just the last login/save. */

import { json } from "./util.js";

const DAY_MS = 864e5;

export async function recent(req, env) {
  const cutoff = Date.now() - DAY_MS;
  const rows = await env.DB.prepare(
    `SELECT username, last_seen FROM users
     WHERE last_seen >= ? AND flags NOT LIKE '%banned%'
       AND username NOT LIKE 'guest\\_%' ESCAPE '\\'
     ORDER BY last_seen DESC LIMIT 500`
  ).bind(cutoff).all();
  // send the server clock too, so the client shows "N ago" against our time,
  // not a skewed local one
  return json({ ok: true, now: Date.now(),
    players: (rows.results || []).map(r => ({ username: r.username, lastSeen: r.last_seen })) },
    200, { "cache-control": "public, max-age=30" });
}
