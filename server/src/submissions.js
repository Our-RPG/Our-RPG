/* submissions.js — community CODE submissions (the studio's "Code" tab).
 *
 * A contributor uploads a git diff + an extensive write-up + optional
 * screenshots proposing a change to ANY part of the project — the game,
 * worldgen, the Workshop site, the server, account handling, multiplayer, the
 * build tooling, docs — EXCEPT the NPC engine, admin controls, and koha (those
 * areas are refused outright, see AREAS/FORBIDDEN_AREAS). The community votes;
 * a human reviews every one. Nothing here is ever applied automatically: a
 * submission stays voteable until a curator moves it to 'merged' or 'declined'
 * by hand. This is a proposal board, not a deploy pipeline.
 *
 * Mirrors workshop.js: metadata + the vote tally in D1, the heavy bits (diff +
 * description JSON, screenshot binaries) in R2 under submissions/{id}. */

import { json, err, readJson, now, authUser, rateLimit, isCurator } from "./util.js";

// The diff + the write-up ride up together as one JSON body. Git diffs for a
// real change can be large, so this cap is generous (well above workshop's
// 512 KB sprite-strip payloads) but still bounds the keyspace.
const MAX_PAYLOAD = 3 * 1024 * 1024;
const MAX_NAME = 120;
const MAX_SUMMARY = 200;
const MAX_DESC = 60 * 1024;           // the "extensive description" — generous, but bounded
const MAX_DIFF = MAX_PAYLOAD;         // the diff itself may use most of the payload budget
const MAX_SHOTS = 6;                  // screenshots per submission
const FLAG_HIDE_AT = 3;               // distinct community flags before auto-hide
const CACHE = { "cache-control": "public, max-age=60" };

// Screenshot kinds the uploader may PUT. One cap per content type; the filename
// extension is derived from the type so reads can serve it back correctly.
const SHOT_TYPES = {
  "image/png":  { ext: "png",  max: 6 * 1024 * 1024 },
  "image/jpeg": { ext: "jpg",  max: 6 * 1024 * 1024 },
  "image/webp": { ext: "webp", max: 6 * 1024 * 1024 },
  "image/gif":  { ext: "gif",  max: 8 * 1024 * 1024 },
};

// The areas a submission may target. Deliberately EXCLUDES the NPC engine,
// admin controls, and koha — those are not community-patchable here. An
// unknown or forbidden area is rejected (see FORBIDDEN_AREAS for the explicit
// belt-and-braces refusal, so a renamed label can't accidentally let one in).
export const AREAS = new Set([
  "game",        // game client / gameplay (js/, dist/bundle.js)
  "worldgen",    // worldgen & world content (js/world/, skills/, data)
  "workshop",    // the Workshop companion site (studio/)
  "server",      // server / backend worker (server/, excluding npc/admin/koha)
  "accounts",    // account handling, auth, passkeys, sessions
  "multiplayer", // multiplayer / networking / live presence
  "tools",       // build & tooling (tools/, studio/tools/)
  "docs",        // docs, README, governance, other
  "other",       // anything else in scope
]);
const FORBIDDEN_AREAS = new Set(["npc", "npc-engine", "npcengine", "admin", "koha"]);

// Statuses a submission can be voted on in. Once a human merges or declines it,
// voting closes (the verdict is in).
const VOTEABLE = new Set(["open", "reviewing"]);
// Statuses the public may read without a token. 'flagged' and 'declined' hide
// from the public feed; the author and curators can still read them.
const PUBLIC_STATUS = new Set(["open", "reviewing", "merged"]);

const subKey = id => `submissions/${id}.json`;
const shotKey = (id, n, ext) => `submissions/${id}/shot${n}.${ext}`;

// Public projection of a metadata row — never leaks user_id.
function pub(r) {
  return {
    id: r.id, name: r.name, summary: r.summary, area: r.area,
    size: r.size, diff_lines: r.diff_lines, shots: r.shots,
    status: r.status, flags: r.flags, review_note: r.review_note || null,
    reviewed_at: r.reviewed_at || null, created_at: r.created_at,
    username: r.username, votes: Number(r.votes || 0),
  };
}

// ---- create ---------------------------------------------------------------

export async function create(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Sign in to submit.", 401);
  if (!await rateLimit(env, `codesub:${user.id}`, 10, 86400))
    return err("Submission limit reached for today.", 429);

  const b = await readJson(req, MAX_PAYLOAD + 8192);
  if (!b) return err("Bad request body (or too large).", 413);

  const name = String(b.name || "").trim().slice(0, MAX_NAME);
  const summary = String(b.summary || "").trim().slice(0, MAX_SUMMARY);
  const area = String(b.area || "").trim().toLowerCase();
  const description = String(b.description || "").trim();
  const diff = String(b.diff || "");

  if (!name) return err("A submission name is required.");
  if (!summary) return err("A one-line summary is required.");
  if (FORBIDDEN_AREAS.has(area))
    return err("The NPC engine, admin controls, and koha aren't open for community submissions.");
  if (!AREAS.has(area)) return err("Pick a valid area for this submission.");
  if (description.length < 40) return err("Please describe the proposed changes in more detail.");
  if (description.length > MAX_DESC) return err("That description is too long.", 413);
  if (!diff.trim()) return err("Attach your git diff.");
  if (diff.length > MAX_DIFF) return err("That diff is too large.", 413);
  // A quick sanity check that it looks like a unified diff, so the board stays
  // patches rather than freeform text. Not a security control — just a nudge.
  if (!/^(diff --git |--- |\+\+\+ |@@ |Index: )/m.test(diff))
    return err("That doesn't look like a git diff (no diff/--- /@@ headers found).");

  const diffLines = diff.split("\n").length;
  const payload = JSON.stringify({
    schema: "code-submission/1",
    name, summary, area, description, diff,
    provenance: b.provenance === "ai" ? "ai" : (b.provenance === "own" ? "own" : null),
  });
  if (payload.length > MAX_PAYLOAD) return err("Submission too large.", 413);

  const r = await env.DB.prepare(
    `INSERT INTO code_submissions
       (user_id, name, summary, area, size, diff_lines, shots, status, created_at)
     VALUES (?,?,?,?,?,?,0,'open',?)`
  ).bind(user.id, name, summary, area, payload.length, diffLines, now()).run();
  const id = r.meta.last_row_id;
  await env.VAULT.put(subKey(id), payload, { httpMetadata: { contentType: "application/json" } });
  return json({ ok: true, id, status: "open", maxShots: MAX_SHOTS });
}

// ---- screenshots (optional, uploaded after create) ------------------------

// PUT /api/code/shot?id=&n=  — binary body, author-only, right after create.
// Screenshots are optional; a failed upload just leaves shots unchanged.
export async function uploadShot(req, env, url) {
  const user = await authUser(req, env);
  if (!user) return err("Sign in to upload.", 401);
  const id = Number(url.searchParams.get("id") || 0);
  const n = Number(url.searchParams.get("n") || -1);
  if (!id || !Number.isInteger(n) || n < 0 || n >= MAX_SHOTS) return err("Bad screenshot slot.");
  const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const kind = SHOT_TYPES[type];
  if (!kind) return err("Screenshots must be PNG, JPEG, WebP, or GIF.", 415);

  const row = await env.DB.prepare("SELECT user_id, shots FROM code_submissions WHERE id = ?").bind(id).first();
  if (!row) return err("Not found.", 404);
  if (row.user_id !== user.id) return err("Only the author can add screenshots.", 403);

  const len = Number(req.headers.get("content-length") || 0);
  if (!len || len > kind.max) return err("Screenshot too large.", 413);
  const body = await req.arrayBuffer();
  if (body.byteLength > kind.max) return err("Screenshot too large.", 413);

  await env.VAULT.put(shotKey(id, n, kind.ext), body, { httpMetadata: { contentType: type } });
  // shots = the highest contiguous slot filled + 1; recompute from n so retries
  // and out-of-order uploads converge to the true count.
  if (n + 1 > (row.shots || 0))
    await env.DB.prepare("UPDATE code_submissions SET shots = ? WHERE id = ?").bind(n + 1, id).run();
  return json({ ok: true, n, bytes: body.byteLength });
}

// GET /api/code/shot?id=&n=  — serve a screenshot binary. Public for visible
// submissions; author/curator for hidden ones.
export async function getShot(req, env, url) {
  const id = Number(url.searchParams.get("id") || 0);
  const n = Number(url.searchParams.get("n") || -1);
  if (!id || !Number.isInteger(n) || n < 0 || n >= MAX_SHOTS) return err("Bad screenshot slot.");
  const row = await env.DB.prepare("SELECT user_id, status FROM code_submissions WHERE id = ?").bind(id).first();
  if (!row) return err("Not found.", 404);
  if (!PUBLIC_STATUS.has(row.status)) {
    const user = await authUser(req, env);
    if (!user || (user.id !== row.user_id && !isCurator(user))) return err("Not found.", 404);
  }
  // Try the known extensions in turn (we didn't store the ext in D1).
  for (const kind of Object.values(SHOT_TYPES)) {
    const obj = await env.VAULT.get(shotKey(id, n, kind.ext));
    if (obj) return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType || "image/" + kind.ext, "cache-control": "public, max-age=86400" } });
  }
  return err("No such screenshot.", 404);
}

// ---- public listings ------------------------------------------------------

// GET /api/code/list?area=&status=&sort=   (all optional)
//   area:   one of AREAS (else: all areas)
//   status: 'open'|'reviewing'|'merged' (else: the three public statuses)
//   sort:   'top' (votes, default) | 'new' (recent)
export async function list(req, env, url) {
  const area = String(url.searchParams.get("area") || "").toLowerCase();
  const statusParam = String(url.searchParams.get("status") || "").toLowerCase();
  const sort = url.searchParams.get("sort") === "new" ? "new" : "top";
  const order = sort === "new" ? "s.created_at DESC" : "votes DESC, s.created_at DESC";

  const clauses = [];
  const binds = [];
  if (PUBLIC_STATUS.has(statusParam)) { clauses.push("s.status = ?"); binds.push(statusParam); }
  else clauses.push("s.status IN ('open','reviewing','merged')");
  if (AREAS.has(area)) { clauses.push("s.area = ?"); binds.push(area); }

  const rows = await env.DB.prepare(
    `SELECT s.id, s.name, s.summary, s.area, s.size, s.diff_lines, s.shots,
            s.status, s.flags, s.review_note, s.reviewed_at, s.created_at,
            u.username, COUNT(v.user_id) AS votes
     FROM code_submissions s JOIN users u ON u.id = s.user_id
     LEFT JOIN submission_votes v ON v.submission_id = s.id
     WHERE ${clauses.join(" AND ")}
     GROUP BY s.id ORDER BY ${order} LIMIT 200`
  ).bind(...binds).all();
  return json({ ok: true, submissions: rows.results.map(pub) }, 200, CACHE);
}

// GET /api/code/item?id=  — one submission with its full payload (diff + write-up).
export async function item(req, env, url) {
  const id = Number(url.searchParams.get("id") || 0);
  const meta = await env.DB.prepare(
    `SELECT s.*, u.username, COUNT(v.user_id) AS votes
     FROM code_submissions s JOIN users u ON u.id = s.user_id
     LEFT JOIN submission_votes v ON v.submission_id = s.id
     WHERE s.id = ? GROUP BY s.id`
  ).bind(id).first();
  if (!meta) return err("Not found.", 404);

  let viewerVoted = false;
  const publiclyVisible = PUBLIC_STATUS.has(meta.status);
  if (!publiclyVisible) {
    const user = await authUser(req, env);
    if (!user || (user.id !== meta.user_id && !isCurator(user))) return err("Not found.", 404);
  }
  // Tell a logged-in viewer whether they've already voted, so the button renders
  // right even though the public list is cached without per-user state.
  const authHdr = req.headers.get("authorization");
  if (authHdr) {
    const user = await authUser(req, env);
    if (user) {
      const v = await env.DB.prepare(
        "SELECT 1 FROM submission_votes WHERE submission_id = ? AND user_id = ?"
      ).bind(id, user.id).first();
      viewerVoted = !!v;
    }
  }

  const obj = await env.VAULT.get(subKey(id));
  const payload = obj ? JSON.parse(await obj.text()) : null;
  return json({
    ok: true,
    submission: { ...pub(meta), payload, viewerVoted },
  }, 200, publiclyVisible ? {} : {});
}

// GET /api/code/mine  — the signed-in user's own submissions, every status.
export async function mine(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const rows = await env.DB.prepare(
    `SELECT s.id, s.name, s.summary, s.area, s.size, s.diff_lines, s.shots,
            s.status, s.flags, s.review_note, s.reviewed_at, s.created_at,
            u.username, COUNT(v.user_id) AS votes
     FROM code_submissions s JOIN users u ON u.id = s.user_id
     LEFT JOIN submission_votes v ON v.submission_id = s.id
     WHERE s.user_id = ? GROUP BY s.id ORDER BY s.created_at DESC LIMIT 200`
  ).bind(user.id).all();
  return json({ ok: true, submissions: rows.results.map(pub) });
}

// ---- votes & flags --------------------------------------------------------

// POST /api/code/vote {id}  — toggle your vote (switchable, like castVote).
export async function vote(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Sign in to vote.", 401);
  if (!await rateLimit(env, `codevote:${user.id}`, 300, 86400))
    return err("Vote limit reached for today.", 429);
  const b = await readJson(req);
  const id = Number(b?.id || 0);
  if (!id) return err("id required");
  const row = await env.DB.prepare("SELECT status FROM code_submissions WHERE id = ?").bind(id).first();
  if (!row || !VOTEABLE.has(row.status)) return err("Not open for voting.", 404);

  const existing = await env.DB.prepare(
    "SELECT 1 FROM submission_votes WHERE submission_id = ? AND user_id = ?"
  ).bind(id, user.id).first();
  if (existing) {
    await env.DB.prepare(
      "DELETE FROM submission_votes WHERE submission_id = ? AND user_id = ?"
    ).bind(id, user.id).run();
    return json({ ok: true, voted: false });
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO submission_votes (submission_id, user_id, created_at) VALUES (?,?,?)"
  ).bind(id, user.id, now()).run();
  return json({ ok: true, voted: true });
}

// POST /api/code/flag {id}  — community moderation. At FLAG_HIDE_AT distinct
// flaggers an open submission auto-hides pending curator review.
export async function flag(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Sign in to flag.", 401);
  if (!await rateLimit(env, `codeflag:${user.id}`, 20, 86400)) return err("Flag limit reached.", 429);
  const b = await readJson(req);
  const id = Number(b?.id || 0);
  if (!id) return err("id required");
  const row = await env.DB.prepare("SELECT id FROM code_submissions WHERE id = ?").bind(id).first();
  if (!row) return err("Not found.", 404);
  const ins = await env.DB.prepare(
    "INSERT OR IGNORE INTO submission_flags (submission_id, user_id, created_at) VALUES (?,?,?)"
  ).bind(id, user.id, now()).run();
  if (ins.meta.changes) {
    await env.DB.prepare(
      "UPDATE code_submissions SET flags = (SELECT COUNT(*) FROM submission_flags WHERE submission_id = ?) WHERE id = ?"
    ).bind(id, id).run();
    await env.DB.prepare(
      "UPDATE code_submissions SET status = 'flagged' WHERE id = ? AND status = 'open' AND flags >= ?"
    ).bind(id, FLAG_HIDE_AT).run();
  }
  return json({ ok: true });
}

// ---- curator review (human-in-the-loop; nothing auto-applies) --------------

// GET /api/code/pending  — the curator's attention queue: flagged submissions
// first, then everything still awaiting a verdict (open/reviewing), hottest
// (most-voted) first. Curator-only.
export async function pending(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!isCurator(user)) return err("Curators only.", 403);
  const rows = await env.DB.prepare(
    `SELECT s.id, s.name, s.summary, s.area, s.size, s.diff_lines, s.shots,
            s.status, s.flags, s.review_note, s.reviewed_at, s.created_at,
            u.username, COUNT(v.user_id) AS votes
     FROM code_submissions s JOIN users u ON u.id = s.user_id
     LEFT JOIN submission_votes v ON v.submission_id = s.id
     WHERE s.status IN ('flagged','open','reviewing')
     GROUP BY s.id
     ORDER BY (s.status = 'flagged') DESC, s.flags DESC, votes DESC, s.created_at DESC
     LIMIT 200`
  ).all();
  return json({ ok: true, queue: rows.results.map(pub) });
}

// POST /api/code/review {id, status, note?}  — a curator's verdict. The valid
// targets are: 'reviewing' (a human has picked it up), 'merged' (applied by
// hand — the only way code lands), 'declined' (rejected), 'open' (reinstated
// from flagged/declined back into the vote). Curator-only.
export async function review(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!isCurator(user)) return err("Curators only.", 403);
  const b = await readJson(req);
  const id = Number(b?.id || 0);
  const status = String(b?.status || "").toLowerCase();
  const note = b?.note == null ? null : String(b.note).slice(0, 2000);
  if (!id || !["reviewing", "merged", "declined", "open"].includes(status))
    return err("Need {id, status: reviewing|merged|declined|open}.");
  const row = await env.DB.prepare("SELECT id FROM code_submissions WHERE id = ?").bind(id).first();
  if (!row) return err("Not found.", 404);
  await env.DB.prepare(
    "UPDATE code_submissions SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ?"
  ).bind(status, note, now(), id).run();
  return json({ ok: true, id, status });
}

// POST /api/code/delete {id}  — the author retires their own submission (or a
// curator removes one). Drops the D1 rows and the R2 payload + screenshots.
export async function remove(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const b = await readJson(req);
  const id = Number(b?.id || 0);
  if (!id) return err("id required");
  const row = await env.DB.prepare("SELECT user_id, shots FROM code_submissions WHERE id = ?").bind(id).first();
  if (!row) return err("Not found.", 404);
  if (row.user_id !== user.id && !isCurator(user)) return err("Not yours to remove.", 403);
  await env.DB.prepare("DELETE FROM submission_votes WHERE submission_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM submission_flags WHERE submission_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM code_submissions WHERE id = ?").bind(id).run();
  await env.VAULT.delete(subKey(id));
  for (let n = 0; n < Math.max(row.shots || 0, MAX_SHOTS); n++)
    for (const kind of Object.values(SHOT_TYPES)) await env.VAULT.delete(shotKey(id, n, kind.ext));
  return json({ ok: true });
}
