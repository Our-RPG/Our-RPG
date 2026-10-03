/* admin.js — tiny maintainer surface, guarded by the ADMIN_TOKEN secret.
 * Curl-first by design (no admin UI in Phase 1):
 *   curl -H "authorization: Bearer $ADMIN_TOKEN" .../api/admin/flagged
 *   curl -H "authorization: Bearer $ADMIN_TOKEN" -d '{"month":"2026-09","usd_cents":1100,"note":"Workers paid plan + R2"}' .../api/admin/cost
 */

import { json, err, readJson, constantTimeEqual } from "./util.js";
import { setShockEvent } from "./shops.js";

async function isAdmin(req, env) {
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") || "");
  return !!(env.ADMIN_TOKEN && m && await constantTimeEqual(m[1], env.ADMIN_TOKEN));
}

/* Supply-shock story events (docs/shopkeeper-economy.md §19):
 *   curl -H "authorization: Bearer $ADMIN_TOKEN" \
 *     -d '{"town":"12,-7","tag":"metal","kind":"mine_trouble","floor_mult":0.2,"demand_mult":1.5,"days":7}' \
 *     .../api/admin/shopevent          ({"clear":true} with town+tag removes) */
export async function setShopEvent(req, env) {
  if (!await isAdmin(req, env)) return err("Nope.", 403);
  const b = await readJson(req);
  if (!b) return err("Bad JSON.");
  const r = await setShockEvent(env, b);
  return r.error ? err(r.error) : json(r);
}

export async function setCost(req, env) {
  if (!await isAdmin(req, env)) return err("Nope.", 403);
  const b = await readJson(req);
  if (!b || !/^\d{4}-\d{2}$/.test(b.month || "") || !Number.isFinite(b.usd_cents))
    return err("Need {month: 'YYYY-MM', usd_cents, note?}.");
  await env.DB.prepare(
    "INSERT INTO koha_costs (month, usd_cents, note) VALUES (?,?,?) " +
    "ON CONFLICT(month) DO UPDATE SET usd_cents = ?, note = ?"
  ).bind(b.month, b.usd_cents, b.note || "", b.usd_cents, b.note || "").run();
  return json({ ok: true });
}

export async function flaggedQueue(req, env) {
  if (!await isAdmin(req, env)) return err("Nope.", 403);
  const rows = await env.DB.prepare(
    `SELECT p.id, p.subject, p.kind, p.title, p.flags, p.status, p.created_at, u.username
     FROM proposals p JOIN users u ON u.id = p.user_id
     WHERE p.status = 'flagged' OR p.flags > 0 ORDER BY p.flags DESC LIMIT 200`
  ).all();
  return json({ ok: true, queue: rows.results });
}

/* The gap manifest — studio/tools/gen_gaps.mjs pushes the list of subjects
 * ("gen:ui:<itemId>", "gen:monster:<key>", ...) whose art is missing or weak.
 * workshop.submitProposal consults it to decide whether a PixelLab proposal
 * fills a hole (auto-accept) or just adds another option to an already-
 * covered subject (normal voting lane). */
export async function setGaps(req, env) {
  if (!await isAdmin(req, env)) return err("Nope.", 403);
  const b = await readJson(req, 1024 * 1024);
  if (!b || !Array.isArray(b.subjects) || b.subjects.length > 5000)
    return err("Need {subjects: string[]} (max 5000).");
  const subjects = [];
  for (const s of b.subjects) {
    if (typeof s !== "string" || !s || s.length > 120) return err("Each subject must be a string ≤120 chars.");
    subjects.push(s);
  }
  await env.VAULT.put("workshop/gaps.json",
    JSON.stringify({ updated: Date.now(), subjects }),
    { httpMetadata: { contentType: "application/json" } });
  return json({ ok: true, count: subjects.length });
}

export async function setProposalStatus(req, env) {
  if (!await isAdmin(req, env)) return err("Nope.", 403);
  const b = await readJson(req);
  if (!b || !["open", "flagged", "accepted", "declined"].includes(b.status))
    return err("Need {id, status: open|flagged|accepted|declined}.");
  await env.DB.prepare("UPDATE proposals SET status = ? WHERE id = ?")
    .bind(b.status, Number(b.id || 0)).run();
  return json({ ok: true });
}
