/* bugs.js — player BUG REPORTS (the studio's "Bugs" tab).
 *
 * A player files a bug they hit (title + area + a write-up). Other players
 * confirm "I've experienced this too" (a switchable me-too vote, exactly like
 * endorsements / code-submission votes) and add specifics or further context as
 * comments. Everything here is small text, so — unlike code submissions — there
 * is NO R2 payload; the body and comments live in D1.
 *
 * Nothing is "applied": a bug stays confirm-and-comment-able until a curator
 * triages it (status → fixed / closed). The community can flag abuse, which
 * auto-hides a report pending review. Mirrors submissions.js conventions. */

import { json, err, readJson, now, authUser, rateLimit, isCurator } from "./util.js";

const MAX_TITLE = 140;
const MAX_BODY = 8 * 1024;       // the report write-up (steps / expected vs actual)
const MIN_BODY = 15;             // nudge toward something actionable
const MAX_COMMENT = 4 * 1024;    // one piece of added context
const FLAG_HIDE_AT = 3;          // distinct community flags before auto-hide
const CACHE = { "cache-control": "public, max-age=30" };

// Where in the project the bug lives. A loose, player-facing taxonomy (NOT the
// code-submission AREAS) — unknown areas fall back to "other" rather than being
// rejected, so reporting stays frictionless.
export const AREAS = new Set([
  "gameplay", "graphics", "world", "multiplayer",
  "account", "workshop", "audio", "performance", "other",
]);
const areaOf = a => AREAS.has(a) ? a : "other";

// Statuses a bug can still be confirmed / commented on. Once a curator marks it
// fixed or closed, the me-too + comment actions close (the verdict is in).
const ACTIVE = new Set(["open", "confirmed"]);
// Statuses the public may read without a token. 'flagged' and 'closed' hide from
// the public feed; the author and curators can still read them. 'fixed' stays
// public as a visible "this got sorted" record.
const PUBLIC_STATUS = new Set(["open", "confirmed", "fixed"]);

// Public projection of a metadata row — never leaks user_id.
function pub(r) {
  return {
    id: r.id, title: r.title, area: r.area, status: r.status,
    flags: r.flags, review_note: r.review_note || null, reviewed_at: r.reviewed_at || null,
    created_at: r.created_at, updated_at: r.updated_at, username: r.username,
    votes: Number(r.votes || 0), comments: Number(r.comments || 0),
  };
}

// ---- create ---------------------------------------------------------------

// POST /api/bugs/report {title, area, body}
export async function report(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Sign in to report a bug.", 401);
  if (!await rateLimit(env, `bugrep:${user.id}`, 20, 86400))
    return err("Bug-report limit reached for today.", 429);

  const b = await readJson(req, MAX_BODY + 8192);
  if (!b) return err("Bad request body (or too large).", 413);
  const title = String(b.title || "").trim().slice(0, MAX_TITLE);
  const area = areaOf(String(b.area || "").trim().toLowerCase());
  const body = String(b.body || "").trim();
  if (!title) return err("A short bug title is required.");
  if (body.length < MIN_BODY) return err("Please describe what happened in a little more detail.");
  if (body.length > MAX_BODY) return err("That description is too long.", 413);

  const t = now();
  const r = await env.DB.prepare(
    `INSERT INTO bug_reports (user_id, title, area, body, status, created_at, updated_at)
     VALUES (?,?,?,?,'open',?,?)`
  ).bind(user.id, title, area, body.slice(0, MAX_BODY), t, t).run();
  return json({ ok: true, id: r.meta.last_row_id, status: "open" });
}

// ---- public listings ------------------------------------------------------

// GET /api/bugs/list?area=&status=&sort=   (all optional)
//   area:   one of AREAS (else: all areas)
//   status: a public status (else: all public statuses)
//   sort:   'top' (most-confirmed, default) | 'new' (recent)
export async function list(req, env, url) {
  const area = String(url.searchParams.get("area") || "").toLowerCase();
  const statusParam = String(url.searchParams.get("status") || "").toLowerCase();
  const sort = url.searchParams.get("sort") === "new" ? "new" : "top";
  const order = sort === "new" ? "b.created_at DESC" : "votes DESC, b.created_at DESC";

  const clauses = [], binds = [];
  if (PUBLIC_STATUS.has(statusParam)) { clauses.push("b.status = ?"); binds.push(statusParam); }
  else clauses.push("b.status IN ('open','confirmed','fixed')");
  if (AREAS.has(area)) { clauses.push("b.area = ?"); binds.push(area); }

  const rows = await env.DB.prepare(
    `SELECT b.id, b.title, b.area, b.status, b.flags, b.review_note, b.reviewed_at,
            b.created_at, b.updated_at, u.username,
            (SELECT COUNT(*) FROM bug_votes v WHERE v.bug_id = b.id) AS votes,
            (SELECT COUNT(*) FROM bug_comments c WHERE c.bug_id = b.id) AS comments
     FROM bug_reports b JOIN users u ON u.id = b.user_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ${order} LIMIT 200`
  ).bind(...binds).all();
  return json({ ok: true, bugs: rows.results.map(pub) }, 200, CACHE);
}

// GET /api/bugs/item?id=  — one bug, its body, its comments, and (for a logged-in
// viewer) whether they've already confirmed it.
export async function item(req, env, url) {
  const id = Number(url.searchParams.get("id") || 0);
  const meta = await env.DB.prepare(
    `SELECT b.*, u.username,
            (SELECT COUNT(*) FROM bug_votes v WHERE v.bug_id = b.id) AS votes,
            (SELECT COUNT(*) FROM bug_comments c WHERE c.bug_id = b.id) AS comments
     FROM bug_reports b JOIN users u ON u.id = b.user_id
     WHERE b.id = ?`
  ).bind(id).first();
  if (!meta) return err("Not found.", 404);

  const publiclyVisible = PUBLIC_STATUS.has(meta.status);
  if (!publiclyVisible) {
    const user = await authUser(req, env);
    if (!user || (user.id !== meta.user_id && !isCurator(user))) return err("Not found.", 404);
  }

  // Whether the signed-in viewer has confirmed it, so the me-too button renders
  // correctly even though the public list is cached without per-user state.
  let viewerVoted = false;
  if (req.headers.get("authorization")) {
    const user = await authUser(req, env);
    if (user) {
      const v = await env.DB.prepare(
        "SELECT 1 FROM bug_votes WHERE bug_id = ? AND user_id = ?"
      ).bind(id, user.id).first();
      viewerVoted = !!v;
    }
  }

  const cRows = await env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, u.username
     FROM bug_comments c JOIN users u ON u.id = c.user_id
     WHERE c.bug_id = ? ORDER BY c.created_at ASC LIMIT 300`
  ).bind(id).all();
  const comments = cRows.results.map(c => ({ id: c.id, body: c.body, created_at: c.created_at, username: c.username }));

  return json({ ok: true, bug: { ...pub(meta), body: meta.body, viewerVoted, comments } });
}

// GET /api/bugs/mine  — the signed-in user's own reports, every status.
export async function mine(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const rows = await env.DB.prepare(
    `SELECT b.id, b.title, b.area, b.status, b.flags, b.review_note, b.reviewed_at,
            b.created_at, b.updated_at, u.username,
            (SELECT COUNT(*) FROM bug_votes v WHERE v.bug_id = b.id) AS votes,
            (SELECT COUNT(*) FROM bug_comments c WHERE c.bug_id = b.id) AS comments
     FROM bug_reports b JOIN users u ON u.id = b.user_id
     WHERE b.user_id = ? ORDER BY b.created_at DESC LIMIT 200`
  ).bind(user.id).all();
  return json({ ok: true, bugs: rows.results.map(pub) });
}

// ---- me-too, comments, flags ----------------------------------------------

// POST /api/bugs/vote {id}  — toggle "I've experienced this too" (switchable).
export async function vote(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Sign in to confirm a bug.", 401);
  if (!await rateLimit(env, `bugvote:${user.id}`, 400, 86400))
    return err("Confirmation limit reached for today.", 429);
  const b = await readJson(req);
  const id = Number(b?.id || 0);
  if (!id) return err("id required");
  const row = await env.DB.prepare("SELECT status FROM bug_reports WHERE id = ?").bind(id).first();
  if (!row || !ACTIVE.has(row.status)) return err("Not open for confirmation.", 404);

  const existing = await env.DB.prepare(
    "SELECT 1 FROM bug_votes WHERE bug_id = ? AND user_id = ?"
  ).bind(id, user.id).first();
  if (existing) {
    await env.DB.prepare("DELETE FROM bug_votes WHERE bug_id = ? AND user_id = ?").bind(id, user.id).run();
    return json({ ok: true, voted: false });
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO bug_votes (bug_id, user_id, created_at) VALUES (?,?,?)"
  ).bind(id, user.id, now()).run();
  // A fresh confirmation bumps the bug so 'new' sorting surfaces active reports.
  await env.DB.prepare("UPDATE bug_reports SET updated_at = ? WHERE id = ?").bind(now(), id).run();
  return json({ ok: true, voted: true });
}

// POST /api/bugs/comment {id, body}  — add specifics / further context.
export async function comment(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Sign in to comment.", 401);
  if (!await rateLimit(env, `bugcomment:${user.id}`, 60, 86400))
    return err("Comment limit reached for today.", 429);
  const b = await readJson(req, MAX_COMMENT + 4096);
  const id = Number(b?.id || 0);
  const body = String(b?.body || "").trim();
  if (!id) return err("id required");
  if (!body) return err("Write something first.");
  if (body.length > MAX_COMMENT) return err("That comment is too long.", 413);
  const row = await env.DB.prepare("SELECT status FROM bug_reports WHERE id = ?").bind(id).first();
  if (!row || !PUBLIC_STATUS.has(row.status)) return err("Not found.", 404);

  const r = await env.DB.prepare(
    "INSERT INTO bug_comments (bug_id, user_id, body, created_at) VALUES (?,?,?,?)"
  ).bind(id, user.id, body.slice(0, MAX_COMMENT), now()).run();
  await env.DB.prepare("UPDATE bug_reports SET updated_at = ? WHERE id = ?").bind(now(), id).run();
  return json({ ok: true, id: r.meta.last_row_id });
}

// POST /api/bugs/flag {id}  — community moderation. At FLAG_HIDE_AT distinct
// flaggers an open/confirmed bug auto-hides pending a curator.
export async function flag(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Sign in to flag.", 401);
  if (!await rateLimit(env, `bugflag:${user.id}`, 20, 86400)) return err("Flag limit reached.", 429);
  const b = await readJson(req);
  const id = Number(b?.id || 0);
  if (!id) return err("id required");
  const row = await env.DB.prepare("SELECT id FROM bug_reports WHERE id = ?").bind(id).first();
  if (!row) return err("Not found.", 404);
  const ins = await env.DB.prepare(
    "INSERT OR IGNORE INTO bug_flags (bug_id, user_id, created_at) VALUES (?,?,?)"
  ).bind(id, user.id, now()).run();
  if (ins.meta.changes) {
    await env.DB.prepare(
      "UPDATE bug_reports SET flags = (SELECT COUNT(*) FROM bug_flags WHERE bug_id = ?) WHERE id = ?"
    ).bind(id, id).run();
    await env.DB.prepare(
      "UPDATE bug_reports SET status = 'flagged' WHERE id = ? AND status IN ('open','confirmed') AND flags >= ?"
    ).bind(id, FLAG_HIDE_AT).run();
  }
  return json({ ok: true });
}

// ---- curator triage -------------------------------------------------------

// POST /api/bugs/review {id, status, note?}  — a curator sets the verdict.
export async function review(req, env) {
  const user = await authUser(req, env);
  if (!user || !isCurator(user)) return err("Curators only.", 403);
  const b = await readJson(req);
  const id = Number(b?.id || 0);
  const status = String(b?.status || "").toLowerCase();
  const note = b?.note != null ? String(b.note).slice(0, 2000) : null;
  if (!id) return err("id required");
  if (!["open", "confirmed", "fixed", "closed"].includes(status)) return err("Bad status.");
  const row = await env.DB.prepare("SELECT id FROM bug_reports WHERE id = ?").bind(id).first();
  if (!row) return err("Not found.", 404);
  await env.DB.prepare(
    "UPDATE bug_reports SET status = ?, review_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ?"
  ).bind(status, note, now(), now(), id).run();
  return json({ ok: true, status });
}
