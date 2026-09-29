/* profile.js — the contributor's private PixelLab gallery (Phase 7, see
 * migrations/0005). The server never talks to PixelLab: the Workshop lists an
 * account's whole generation history with the player's own BYO key (PixelLab's
 * GET /v2/characters + /v2/objects), downloads the rotation art client-side, and
 * posts finished bundles here. This module is the private shelf — metadata + a
 * small thumbnail in D1, the full art bundle in R2 at profile/<id>.json (the
 * same split proposals and gen_jobs use). Nothing here is public and nothing
 * auto-enters the game; promoting an item is still the explicit workshop-proposal
 * flow. Every route requires the same Taiao session the rest of the API uses. */

import { json, err, readJson, now, authUser, rateLimit } from "./util.js";

const MAX_PAYLOAD = 512 * 1024;                    // rotation strips ride in as dataURLs, same cap as proposals/gen_jobs
const MAX_THUMB = 64 * 1024;                       // a single south-facing dataURL — kept small so `mine` stays a light list
const CATEGORIES = new Set(["character", "monster", "object", "item"]);
const KINDS = new Set(["character", "object"]);

/* Pin one PixelLab generation to the signed-in player's gallery. Idempotent per
 * (user, pixellab_id): re-adding an item they already kept just refreshes it. */
export async function add(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `gallery:${user.id}`, 300, 86400))
    return err("Gallery limit reached for today.", 429);
  const b = await readJson(req, MAX_PAYLOAD + 8192);
  if (!b) return err("Body too large or malformed.", 413);
  const category = CATEGORIES.has(b.category) ? b.category : null;
  const pixellabKind = KINDS.has(b.pixellabKind) ? b.pixellabKind : null;
  const pixellabId = String(b.pixellabId || "").slice(0, 200);
  if (!category || !pixellabKind || !pixellabId) return err("Bad request body.");
  if (!b.result || (!b.result.dirs && !b.result.image)) return err("No art in the payload.");
  const payload = JSON.stringify(b.result);
  if (payload.length > MAX_PAYLOAD) return err("Result too large.", 413);
  const name = String(b.name || "").slice(0, 120) || null;
  const prompt = String(b.prompt || "").slice(0, 2000) || null;
  const thumb = String(b.thumb || "").slice(0, MAX_THUMB) || null;
  const createdAt = Number(b.createdAt) || now();
  const t = now();

  // Upsert on (user_id, pixellab_id). We need the row id to key R2, so do it in
  // two steps: claim/refresh the row, then read back its id.
  await env.DB.prepare(
    `INSERT INTO profile_gallery (user_id, category, source, pixellab_kind, pixellab_id, name, prompt, thumb, created_at, added_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, pixellab_id) DO UPDATE SET
       category = excluded.category, name = excluded.name, prompt = excluded.prompt,
       thumb = excluded.thumb, created_at = excluded.created_at, added_at = excluded.added_at`
  ).bind(user.id, category, "pixellab", pixellabKind, pixellabId, name, prompt, thumb, createdAt, t).run();
  const row = await env.DB.prepare(
    "SELECT id FROM profile_gallery WHERE user_id = ? AND pixellab_id = ?"
  ).bind(user.id, pixellabId).first();
  if (!row) return err("Couldn't save to your gallery.", 500);
  await env.VAULT.put(`profile/${row.id}.json`, payload, { httpMetadata: { contentType: "application/json" } });
  return json({ ok: true, id: row.id });
}

/* Everything on this player's shelf — metadata + thumbnail only. The grid reads
 * this; the full art bundle is fetched per-item via /api/profile/gallery/item. */
export async function mine(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const rows = (await env.DB.prepare(
    `SELECT id, category, source, pixellab_kind, pixellab_id, name, prompt, thumb, created_at, added_at
     FROM profile_gallery WHERE user_id = ? ORDER BY created_at DESC LIMIT 500`
  ).bind(user.id).all()).results;
  return json({ ok: true, items: rows });
}

/* The full rotation art for one gallery item (from R2) — for previewing every
 * direction, exporting, or promoting it to a community proposal later. */
export async function getItem(req, env, url) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const id = Number(url.searchParams.get("id") || 0);
  const row = await env.DB.prepare("SELECT * FROM profile_gallery WHERE id = ? AND user_id = ?").bind(id, user.id).first();
  if (!row) return err("Not found.", 404);
  let result = null;
  const obj = await env.VAULT.get(`profile/${id}.json`);
  if (obj) result = JSON.parse(await obj.text());
  return json({ ok: true, item: { ...row, result } });
}

/* Unpin an item — drops the row and its R2 art. Hard delete: a private shelf
 * needs no audit trail, and the source art still lives on the player's PixelLab
 * account, so nothing is truly lost. */
export async function remove(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const b = await readJson(req);
  const id = Number(b?.id || 0);
  if (!id) return err("id required");
  const r = await env.DB.prepare(
    "DELETE FROM profile_gallery WHERE id = ? AND user_id = ?"
  ).bind(id, user.id).run();
  if (r.meta.changes) await env.VAULT.delete(`profile/${id}.json`);
  return json({ ok: true });
}
