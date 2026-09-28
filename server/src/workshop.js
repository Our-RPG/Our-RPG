/* workshop.js — the ballot-box round (audit §3/§10 rung 1-2).
 * The client keeps voting locally exactly as today; when logged in it syncs
 * votes up and pulls community tallies down. "Export JSON" becomes "Submit
 * proposal": same payload, now landing in a curator queue with an explicit
 * licence grant. Nothing auto-applies — GOVERNANCE.md still means a human
 * reads every proposal; the server only counts. */

import { json, err, readJson, now, authUser, rateLimit, isCurator } from "./util.js";

const MAX_VOTES_BATCH = 500;
const MAX_PAYLOAD = 512 * 1024;       // sprite strips ride in as dataURLs
const FLAG_HIDE_AT = 3;               // community flags before auto-hide
const LICENCES = new Set(["CC-BY-SA-4.0", "GPL-3.0-or-later"]);
const CACHE = { "cache-control": "public, max-age=120" };
const CACHE_GAPS = { "cache-control": "public, max-age=300" };

// ---- votes ----------------------------------------------------------------

export async function pushVotes(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `votes:${user.id}`, 60, 3600)) return err("Slow down a little.", 429);
  const b = await readJson(req, 256 * 1024);
  if (!b || !Array.isArray(b.votes)) return err("Bad request body.");
  let applied = 0;
  for (const v of b.votes.slice(0, MAX_VOTES_BATCH)) {
    const subject = String(v?.subject || "").slice(0, 120);
    const field = String(v?.field || "").slice(0, 120);
    if (!subject || !field) continue;
    if (v.choice == null) {                                  // un-vote
      await env.DB.prepare(
        "DELETE FROM workshop_votes WHERE user_id = ? AND subject = ? AND field = ?"
      ).bind(user.id, subject, field).run();
    } else {
      const choice = String(v.choice).slice(0, 400);
      await env.DB.prepare(
        "INSERT INTO workshop_votes (user_id, subject, field, choice, updated_at) VALUES (?,?,?,?,?) " +
        "ON CONFLICT(user_id, subject, field) DO UPDATE SET choice = ?, updated_at = ?"
      ).bind(user.id, subject, field, choice, now(), choice, now()).run();
    }
    applied++;
  }
  return json({ ok: true, applied });
}

/* Public tally for one subject: {fields: {field: {choice: count}}}. */
export async function tally(req, env, url) {
  const subject = String(url.searchParams.get("subject") || "").slice(0, 120);
  if (!subject) return err("subject required");
  const rows = await env.DB.prepare(
    "SELECT field, choice, COUNT(*) AS n FROM workshop_votes WHERE subject = ? GROUP BY field, choice"
  ).bind(subject).all();
  const fields = {};
  for (const r of rows.results) (fields[r.field] ||= {})[r.choice] = r.n;
  return json({ ok: true, subject, fields }, 200, CACHE);
}

// ---- proposals ------------------------------------------------------------

export async function submitProposal(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `prop:${user.id}`, 10, 86400))
    return err("Proposal limit reached for today.", 429);
  const b = await readJson(req, MAX_PAYLOAD + 4096);
  if (!b || !b.payload) return err("Bad request body.");
  const payload = JSON.stringify(b.payload);
  if (payload.length > MAX_PAYLOAD) return err("Proposal too large.", 413);
  if (!LICENCES.has(b.licence)) return err("Licence grant missing.");
  const subject = String(b.subject || "").slice(0, 120);
  const kind = ["values", "sprites", "mixed"].includes(b.kind) ? b.kind : "mixed";
  const title = String(b.title || subject).slice(0, 120);
  if (!subject) return err("subject required");

  // Provenance decides the moderation path. Only user-UPLOADED binary assets
  // wait at 'pending' for a curator; PixelLab-generated art (licensed by
  // generation) and pure data/value proposals ('data' — quests, recipes,
  // rules, votes: no uploaded binary) auto-publish for voting, as before.
  const source = ["pixellab", "data", "upload"].includes(b.source) ? b.source : "upload";
  let status = source === "upload" ? "pending" : "open";

  // Trust model, rung 3: a PixelLab generation that FILLS A GAP (the studio's
  // gen_gaps manifest — art that's missing or weak today) skips voting
  // entirely and ships straight into the community layer. Nothing to
  // moderate: it's trusted generation closing a hole nobody had opinions
  // about yet. If the gap already got filled by someone else since the
  // manifest was last regenerated, it's not a gap anymore — fall back to
  // the normal 'open' voting lane instead of accepting a duplicate.
  if (source === "pixellab") {
    const gapsObj = await env.VAULT.get("workshop/gaps.json");
    const subjects = gapsObj ? (JSON.parse(await gapsObj.text()).subjects || []) : [];
    if (subjects.includes(subject)) {
      const already = await env.DB.prepare(
        "SELECT id FROM proposals WHERE subject = ? AND status = 'accepted' LIMIT 1"
      ).bind(subject).first();
      if (!already) status = "accepted";
    }
  }

  const r = await env.DB.prepare(
    "INSERT INTO proposals (user_id, subject, kind, title, licence, size, status, source, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(user.id, subject, kind, title, b.licence, payload.length, status, source, now()).run();
  const id = r.meta.last_row_id;
  await env.VAULT.put(`proposals/${id}.json`, payload,
    { httpMetadata: { contentType: "application/json" } });
  return json({ ok: true, id, status, source });
}

/* A player's own proposals across EVERY status — including 'pending' (awaiting
 * moderation) and 'declined' — so the studio can show them their submissions
 * and the game/export can replay their proposed changes. Requires login. */
export async function mine(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const rows = await env.DB.prepare(
    `SELECT p.id, p.subject, p.kind, p.title, p.licence, p.size, p.status, p.source,
            p.created_at, COUNT(e.user_id) AS endorsements
     FROM proposals p LEFT JOIN endorsements e ON e.proposal_id = p.id
     WHERE p.user_id = ?
     GROUP BY p.id ORDER BY p.created_at DESC LIMIT 500`
  ).bind(user.id).all();
  return json({ ok: true, proposals: rows.results });
}

/* Public listings. Only the two public statuses are reachable: 'open' (the
 * default — the voteable feed) and 'accepted' (the adopted-changes changelog,
 * newest first, so the community sees contributions actually landing). */
export async function listProposals(req, env, url) {
  const subject = String(url.searchParams.get("subject") || "").slice(0, 120);
  const status = url.searchParams.get("status") === "accepted" ? "accepted" : "open";
  const where = subject ? "AND p.subject = ?" : "";
  const order = status === "accepted" ? "p.created_at DESC" : "endorsements DESC, p.created_at DESC";
  const stmt = env.DB.prepare(
    `SELECT p.id, p.subject, p.kind, p.title, p.licence, p.size, p.status, p.source,
            p.created_at, u.username, COUNT(e.user_id) AS endorsements
     FROM proposals p JOIN users u ON u.id = p.user_id
     LEFT JOIN endorsements e ON e.proposal_id = p.id
     WHERE p.status = ? ${where}
     GROUP BY p.id ORDER BY ${order} LIMIT 100`);
  const rows = await (subject ? stmt.bind(status, subject) : stmt.bind(status)).all();
  return json({ ok: true, proposals: rows.results }, 200, CACHE);
}

export async function getProposal(req, env, url) {
  const id = Number(url.searchParams.get("id") || 0);
  const meta = await env.DB.prepare(
    `SELECT p.*, u.username FROM proposals p JOIN users u ON u.id = p.user_id WHERE p.id = ?`
  ).bind(id).first();
  if (!meta) return err("Not found.", 404);
  // Public may read published proposals; the author and curators may also read
  // their own pending/declined ones (for the "my proposals" export and the
  // moderation queue). Only touch auth when the public gate would say no.
  const publiclyVisible = meta.status === "open" || meta.status === "accepted";
  let privateOk = false;
  if (!publiclyVisible) {
    const user = await authUser(req, env);
    privateOk = !!user && (user.id === meta.user_id || isCurator(user));
  }
  if (!publiclyVisible && !privateOk) return err("Not found.", 404);
  const obj = await env.VAULT.get(`proposals/${id}.json`);
  if (!obj) return err("Payload missing.", 404);
  const payload = JSON.parse(await obj.text());
  return json({
    ok: true,
    proposal: {
      id: meta.id, subject: meta.subject, kind: meta.kind, title: meta.title,
      licence: meta.licence, status: meta.status, source: meta.source,
      username: meta.username, created_at: meta.created_at, payload,
    },
  }, 200, publiclyVisible ? CACHE : {});
}

export async function endorse(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `endorse:${user.id}`, 200, 86400))
    return err("Endorsement limit reached for today.", 429);
  const b = await readJson(req);
  const id = Number(b?.id || 0);
  if (!id) return err("id required");
  // Only live, publicly-voteable proposals can gather endorsements — endorsing
  // pending/declined/nonexistent ids would inflate the public feed's ordering.
  const row = await env.DB.prepare("SELECT status FROM proposals WHERE id = ?").bind(id).first();
  if (!row || row.status !== "open") return err("Not open for endorsement.", 404);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO endorsements (proposal_id, user_id, created_at) VALUES (?,?,?)"
  ).bind(id, user.id, now()).run();
  return json({ ok: true });
}

/* Community flagging — uploads are UGC, so the curator queue exists from
 * day one (audit §10 rung 2). At FLAG_HIDE_AT flags a proposal auto-hides
 * pending curator review. */
export async function flag(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `flag:${user.id}`, 20, 86400)) return err("Flag limit reached.", 429);
  const b = await readJson(req);
  const id = Number(b?.id || 0);
  if (!id) return err("id required");
  const row = await env.DB.prepare("SELECT id FROM proposals WHERE id = ?").bind(id).first();
  if (!row) return err("Not found.", 404);
  // One flag per user per proposal (proposal_flags), so auto-hide needs
  // FLAG_HIDE_AT *distinct* flaggers — one account can no longer hide a
  // proposal alone by flagging repeatedly. proposals.flags stays the cached
  // distinct count (the pending queue orders by it).
  const ins = await env.DB.prepare(
    "INSERT OR IGNORE INTO proposal_flags (proposal_id, user_id, created_at) VALUES (?,?,?)"
  ).bind(id, user.id, now()).run();
  if (ins.meta.changes) {
    await env.DB.prepare(
      "UPDATE proposals SET flags = (SELECT COUNT(*) FROM proposal_flags WHERE proposal_id = ?) WHERE id = ?"
    ).bind(id, id).run();
    await env.DB.prepare(
      "UPDATE proposals SET status = 'flagged' WHERE id = ? AND status = 'open' AND flags >= ?"
    ).bind(id, FLAG_HIDE_AT).run();
  }
  return json({ ok: true });
}

// ---- curator moderation ---------------------------------------------------
// The moderation team is any user carrying the 'curator' flag (util.isCurator).
// Unlike the ADMIN_TOKEN surface in admin.js, these are reachable from the
// studio itself so curators can review in-app.

/* The pending queue: user-uploaded proposals awaiting a first review, plus
 * anything the community auto-hid at FLAG_HIDE_AT flags. Curator-only. */
export async function pendingQueue(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!isCurator(user)) return err("Curators only.", 403);
  const rows = await env.DB.prepare(
    `SELECT p.id, p.subject, p.kind, p.title, p.licence, p.size, p.status,
            p.source, p.flags, p.created_at, u.username
     FROM proposals p JOIN users u ON u.id = p.user_id
     WHERE p.status = 'pending' OR p.status = 'flagged'
     ORDER BY (p.status = 'flagged') DESC, p.flags DESC, p.created_at ASC LIMIT 200`
  ).all();
  return json({ ok: true, queue: rows.results });
}

/* A curator's verdict on a pending/flagged proposal, OR on an already-open
 * one:
 *   approve → 'open'      (pending/flagged → now voteable in the 🗳 dialogues)
 *   decline → 'declined'  (pending/flagged → hidden; author still sees it
 *                          under "my proposals")
 *   adopt   → 'accepted'  (open → skips the rest of the vote and ships into
 *                          the community layer immediately, same destination
 *                          as the PixelLab auto-accept lane in submitProposal)
 * Curator-only. */
export async function review(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!isCurator(user)) return err("Curators only.", 403);
  const b = await readJson(req);
  const id = Number(b?.id || 0);
  const decision = b?.decision;
  if (!id || !["approve", "decline", "adopt"].includes(decision))
    return err("Need {id, decision: approve|decline|adopt}.");
  if (decision === "adopt") {
    await env.DB.prepare(
      "UPDATE proposals SET status = 'accepted' WHERE id = ? AND status = 'open'"
    ).bind(id).run();
    return json({ ok: true, id, status: "accepted" });
  }
  const status = decision === "approve" ? "open" : "declined";
  await env.DB.prepare(
    "UPDATE proposals SET status = ? WHERE id = ? AND status IN ('pending', 'flagged')"
  ).bind(status, id).run();
  return json({ ok: true, id, status });
}

/* The gap manifest — subjects the studio's gen_gaps tool flagged as missing
 * or weak art (studio/tools/gen_gaps.mjs writes it via admin.setGaps). Public
 * GET so both the studio's "Needs art" hub and submitProposal's auto-accept
 * check can read it without a token. Missing R2 object just means nobody has
 * pushed a manifest yet — an empty list, not an error. */
export async function gaps(req, env) {
  const obj = await env.VAULT.get("workshop/gaps.json");
  if (!obj) return json({ ok: true, updated: 0, subjects: [] }, 200, CACHE_GAPS);
  const data = JSON.parse(await obj.text());
  return json({ ok: true, updated: data.updated || 0, subjects: data.subjects || [] }, 200, CACHE_GAPS);
}

export async function latestDigest(req, env) {
  const row = await env.DB.prepare(
    "SELECT created_at, markdown, posted_url FROM digests ORDER BY id DESC LIMIT 1"
  ).first();
  return json({ ok: true, digest: row || null }, 200, CACHE);
}
