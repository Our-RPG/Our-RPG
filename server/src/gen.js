/* gen.js — PixelLab generation-job tracking (Phase 6, see migrations/0004).
 * The server never talks to PixelLab — the studio calls PixelLab directly
 * with the player's own BYO key, exactly as before. This is just a durable
 * status board: start (before the PixelLab call), progress (the async job/
 * character id once known, so a hard refresh can resume polling), then
 * complete (result payload, mirrors workshop.js's proposal-in-R2 pattern) or
 * fail. Every route requires the same Taiao session the workshop uses. */

import { json, err, readJson, now, authUser, rateLimit } from "./util.js";
import * as PL from "./pixellab.js";
import { pixellabKeyFor } from "./secrets.js";

const MAX_REQUEST = 256 * 1024;          // room for an optional reference image (base64)
const MAX_THUMB = 64 * 1024;
const POLL_TIMEOUT_MS = 12 * 60 * 1000;  // give up on a stuck server job after this

const MAX_PAYLOAD = 512 * 1024;          // sprite strips ride in as dataURLs, same cap as proposals
const SPRITE_TYPES = new Set(["character", "monster", "object", "ui"]);
const PIXELLAB_KINDS = new Set(["character", "object8", "object1", "image"]);
// A "generating" row with no resumable pixellab_ref that's outlived a normal
// single-image generation window was abandoned mid-flight (tab closed before
// the synchronous PixelLab call returned) — nothing left to resume, so `mine`
// flips it to failed instead of showing a spinner forever.
const STALE_MS = 3 * 60 * 1000;

export async function start(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `genjob:${user.id}`, 40, 86400))
    return err("Generation limit reached for today.", 429);
  const b = await readJson(req);
  const spriteType = SPRITE_TYPES.has(b?.spriteType) ? b.spriteType : null;
  const pixellabKind = PIXELLAB_KINDS.has(b?.pixellabKind) ? b.pixellabKind : null;
  const spriteId = String(b?.spriteId || "").slice(0, 80);
  const prompt = String(b?.prompt || "").slice(0, 2000);
  if (!spriteType || !pixellabKind || !spriteId || !prompt) return err("Bad request body.");
  const label = String(b?.label || spriteId).slice(0, 120);
  const subject = b?.subject ? String(b.subject).slice(0, 120) : null;
  const bodyType = b?.bodyType ? String(b.bodyType).slice(0, 20) : null;
  const seed = b?.seed != null && b.seed !== "" ? String(b.seed).slice(0, 20) : null;
  const t = now();
  const r = await env.DB.prepare(
    `INSERT INTO gen_jobs (user_id, sprite_type, sprite_id, label, subject, prompt, body_type, seed, pixellab_kind, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'generating', ?, ?)`
  ).bind(user.id, spriteType, spriteId, label, subject, prompt, bodyType, seed, pixellabKind, t, t).run();
  return json({ ok: true, id: r.meta.last_row_id });
}

/* The async job/character id, once PixelLab hands it back — recorded so a
 * hard refresh can resume polling instead of losing the job. */
export async function progress(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const b = await readJson(req);
  const id = Number(b?.id || 0);
  const ref = String(b?.pixellabRef || "").slice(0, 200);
  if (!id || !ref) return err("Bad request body.");
  await env.DB.prepare(
    "UPDATE gen_jobs SET pixellab_ref = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'generating'"
  ).bind(ref, now(), id, user.id).run();
  return json({ ok: true });
}

export async function complete(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const b = await readJson(req, MAX_PAYLOAD + 4096);
  const id = Number(b?.id || 0);
  if (!id || !b?.result) return err("Bad request body.");
  const payload = JSON.stringify(b.result);
  if (payload.length > MAX_PAYLOAD) return err("Result too large.", 413);
  const row = await env.DB.prepare("SELECT id FROM gen_jobs WHERE id = ? AND user_id = ?").bind(id, user.id).first();
  if (!row) return err("Not found.", 404);
  await env.VAULT.put(`genjobs/${id}.json`, payload, { httpMetadata: { contentType: "application/json" } });
  await env.DB.prepare("UPDATE gen_jobs SET status = 'completed', error = NULL, updated_at = ? WHERE id = ?").bind(now(), id).run();
  return json({ ok: true });
}

export async function fail(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const b = await readJson(req);
  const id = Number(b?.id || 0);
  if (!id) return err("id required");
  const error = String(b?.error || "Generation failed.").slice(0, 300);
  await env.DB.prepare(
    "UPDATE gen_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  ).bind(error, now(), id, user.id).run();
  return json({ ok: true });
}

/* Everything this user has in flight or recently finished — the board reads
 * this on mount and while polling. Metadata only; fetch /api/gen/job?id= for
 * the actual result once a row shows 'completed'. */
export async function mine(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const rows = (await env.DB.prepare(
    `SELECT id, sprite_type, sprite_id, label, subject, prompt, body_type, seed,
            pixellab_kind, pixellab_ref, status, error, driver, created_at, updated_at
     FROM gen_jobs WHERE user_id = ? AND status != 'deleted' ORDER BY created_at DESC LIMIT 60`
  ).bind(user.id).all()).results;
  const t = now();
  for (const r of rows) {
    // Server-driven jobs are advanced by the cron poller (with its own timeout);
    // only sweep abandoned CLIENT jobs that never got a resumable ref here.
    if (r.driver !== "server" && r.status === "generating" && !r.pixellab_ref && (t - r.updated_at) > STALE_MS) {
      r.status = "failed";
      r.error = "Interrupted — the tab closed or refreshed mid-generation.";
      await env.DB.prepare(
        "UPDATE gen_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'generating'"
      ).bind(r.error, t, r.id).run();
    }
  }
  return json({ ok: true, jobs: rows });
}

export async function getResult(req, env, url) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const id = Number(url.searchParams.get("id") || 0);
  const row = await env.DB.prepare("SELECT * FROM gen_jobs WHERE id = ? AND user_id = ?").bind(id, user.id).first();
  if (!row) return err("Not found.", 404);
  let result = null;
  if (row.status === "completed") {
    const obj = await env.VAULT.get(`genjobs/${id}.json`);
    if (obj) result = JSON.parse(await obj.text());
  }
  return json({ ok: true, job: { ...row, result } });
}

/* Soft-delete: keeps the row (and audit trail) out of `mine`'s listing, and
 * drops the R2 payload since nothing will read it again. */
export async function remove(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const b = await readJson(req);
  const id = Number(b?.id || 0);
  if (!id) return err("id required");
  const r = await env.DB.prepare(
    "UPDATE gen_jobs SET status = 'deleted', updated_at = ? WHERE id = ? AND user_id = ?"
  ).bind(now(), id, user.id).run();
  if (r.meta.changes) await env.VAULT.delete(`genjobs/${id}.json`);
  return json({ ok: true });
}

// ===== Phase 8: server-driven generation =====================================
// The client no longer runs PixelLab itself. It POSTs a recipe here; the server
// creates the generation with the player's STORED key (secrets.js), then the
// every-minute cron (pollPending) advances it to completion — so a sprite
// finishes and lands in the gallery even with the browser closed, and syncs to
// wherever the player next logs in.

/* Kick off a server-side generation. Synchronous kinds (item icons) finish in
 * this request; async kinds (characters/objects) get a pixellab_ref and are
 * carried to completion by the cron poller. Returns the job id immediately so
 * the "Generating…" card can appear at once. */
export async function request(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `genjob:${user.id}`, 40, 86400))
    return err("Generation limit reached for today.", 429);
  const b = await readJson(req, MAX_REQUEST);
  const spriteType = SPRITE_TYPES.has(b?.spriteType) ? b.spriteType : null;
  const pixellabKind = PIXELLAB_KINDS.has(b?.pixellabKind) ? b.pixellabKind : null;
  const spriteId = String(b?.spriteId || "").slice(0, 80);
  const prompt = String(b?.prompt || "").slice(0, 2000);
  if (!spriteType || !pixellabKind || !spriteId || !prompt) return err("Bad request body.");
  const key = await pixellabKeyFor(env, user.id).catch(() => null);
  if (!key) return err("Add your PixelLab key in Settings first — it's stored securely so the server can generate for you.", 400);

  const label = String(b?.label || spriteId).slice(0, 120);
  const subject = b?.subject ? String(b.subject).slice(0, 120) : null;
  const bodyType = b?.bodyType ? String(b.bodyType).slice(0, 20) : null;
  const seed = b?.seed != null && b.seed !== "" ? String(b.seed).slice(0, 20) : null;
  const t = now();
  const ins = await env.DB.prepare(
    `INSERT INTO gen_jobs (user_id, sprite_type, sprite_id, label, subject, prompt, body_type, seed, pixellab_kind, status, driver, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'generating', 'server', ?, ?)`
  ).bind(user.id, spriteType, spriteId, label, subject, prompt, bodyType, seed, pixellabKind, t, t).run();
  const id = ins.meta.last_row_id;
  const jobRow = { id, user_id: user.id, sprite_type: spriteType, sprite_id: spriteId, label, subject, prompt, body_type: bodyType, seed, pixellab_kind: pixellabKind, created_at: t };

  const recipe = { pixellab_kind: pixellabKind, prompt, view: b?.view, size: b?.size, seed, bodyType, template: b?.template, reference: b?.reference, negative: b?.negative };
  try {
    const started = await PL.create(key, recipe);
    if (started.refKind === "inline") {
      await finishJob(env, jobRow, started.done);
    } else {
      await env.DB.prepare("UPDATE gen_jobs SET pixellab_ref = ?, updated_at = ? WHERE id = ?").bind(started.ref, now(), id).run();
    }
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 300);
    await env.DB.prepare("UPDATE gen_jobs SET status='failed', error=?, updated_at=? WHERE id=?").bind(msg, now(), id).run();
    return json({ ok: true, id, status: "failed", error: msg });
  }
  return json({ ok: true, id });
}

/* Store the finished art, mark the job completed, and auto-add it to the player's
 * profile gallery (Phase 7). Idempotent-ish: the gallery upsert keys on
 * "job:<id>", so re-running never duplicates. */
async function finishJob(env, job, result) {
  await env.VAULT.put(`genjobs/${job.id}.json`, JSON.stringify(result), { httpMetadata: { contentType: "application/json" } });
  await env.DB.prepare("UPDATE gen_jobs SET status='completed', error=NULL, updated_at=? WHERE id=?").bind(now(), job.id).run();
  try { await addGalleryRow(env, job, result); } catch (_) {}
}

async function addGalleryRow(env, job, result) {
  const dirs = result && result.dirs, image = result && result.image;
  let thumb = image || (dirs && (dirs.south || Object.values(dirs)[0])) || "";
  if (!thumb) return;
  if (thumb.length > MAX_THUMB) thumb = "";   // oversized thumb → grid falls back to an icon; full art still in R2
  const category = job.sprite_type === "ui" ? "item" : job.sprite_type;
  const pixellabId = "job:" + job.id;
  const t = now();
  await env.DB.prepare(
    `INSERT INTO profile_gallery (user_id, category, source, pixellab_kind, pixellab_id, sprite_id, subject, body_type, seed, name, prompt, thumb, created_at, added_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, pixellab_id) DO UPDATE SET
       thumb = excluded.thumb, name = excluded.name, created_at = excluded.created_at, added_at = excluded.added_at`
  ).bind(job.user_id, category, "pixellab", job.pixellab_kind, pixellabId, job.sprite_id, job.subject, job.body_type, job.seed, job.label, job.prompt, thumb, job.created_at || t, t).run();
  const row = await env.DB.prepare("SELECT id FROM profile_gallery WHERE user_id = ? AND pixellab_id = ?").bind(job.user_id, pixellabId).first();
  if (row) await env.VAULT.put(`profile/${row.id}.json`, JSON.stringify(result), { httpMetadata: { contentType: "application/json" } });
}

/* Every-minute cron: advance every in-flight server job one step. Poll PixelLab
 * with the owner's stored key; complete, fail, or leave it for the next tick. */
export async function pollPending(env) {
  const rows = (await env.DB.prepare(
    `SELECT id, user_id, sprite_type, sprite_id, label, subject, prompt, body_type, seed, pixellab_kind, pixellab_ref, created_at
     FROM gen_jobs WHERE status='generating' AND driver='server' AND pixellab_ref IS NOT NULL ORDER BY created_at LIMIT 40`
  ).all()).results;
  if (!rows.length) return;
  const keyCache = new Map();
  const t = now();
  for (const r of rows) {
    if (t - r.created_at > POLL_TIMEOUT_MS) {
      await env.DB.prepare("UPDATE gen_jobs SET status='failed', error='Timed out.', updated_at=? WHERE id=? AND status='generating'").bind(t, r.id).run();
      continue;
    }
    let key = keyCache.get(r.user_id);
    if (key === undefined) { key = await pixellabKeyFor(env, r.user_id).catch(() => null); keyCache.set(r.user_id, key); }
    if (!key) continue;   // key was removed — leave it until the timeout sweeps it
    const refKind = r.pixellab_kind === "character" ? "character" : "job";
    try {
      const res = await PL.poll(key, refKind, r.pixellab_ref);
      if (res.status === "completed") await finishJob(env, r, res.result);
      else if (res.status === "failed") await env.DB.prepare("UPDATE gen_jobs SET status='failed', error=?, updated_at=? WHERE id=? AND status='generating'").bind(String(res.error || "failed").slice(0, 300), t, r.id).run();
      // else still generating — next tick
    } catch (_) { /* transient poll error — leave for the next tick / timeout */ }
  }
}
