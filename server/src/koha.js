/* koha.js — the transparency page's data (audit §9).
 * Real monthly costs, hand-entered via /api/admin/cost (or wrangler d1
 * execute), served publicly with a 30-day active-player count so the page
 * can show cost-per-player falling as the community grows. */

import { json, now } from "./util.js";

export async function transparency(req, env) {
  const [costs, players] = await Promise.all([
    env.DB.prepare("SELECT month, usd_cents, note FROM koha_costs ORDER BY month DESC LIMIT 24").all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE last_seen >= ?").bind(now() - 30 * 864e5).first(),
  ]);
  const history = costs.results;
  return json({
    ok: true,
    current: history[0] || null,      // newest entered month
    history,
    players30d: players?.n || 0,
    note: "Koha is welcome and never expected. Nothing in Our RPG is metered, gated, or worse without it.",
  }, 200, { "cache-control": "public, max-age=3600" });
}
