/* profile.js — the contributor's PixelLab gallery + public sprite publishing
 * (Phase 7, see migrations/0005 + 0006). The server never talks to PixelLab: the
 * Workshop lists/downloads art client-side with the player's own BYO key and
 * posts finished bundles here.
 *
 * The gallery (profile_gallery) is the hub for every sprite a player generates
 * through the Workshop pipeline (auto-added client-side) plus anything they pin
 * from their PixelLab account history. Metadata + a thumbnail in D1, the full art
 * bundle in R2 at profile/<id>.json. From the gallery a player can delete,
 * regenerate (client-side; a fresh generation just adds another row), or PUBLISH.
 *
 * Publishing copies the item into published_sprites — the public catalogue behind
 * our-rpg.com/workshop/sprites — under a globally UNIQUE sprite_id (we append
 * -2, -3, … on collision) with the chosen tag. Art bundle → R2 published/<id>.json.
 * This is a direct publish, deliberately separate from the proposals ballot box.
 * Every write requires the same Taiao session; the published-catalogue reads are
 * public. */

import { json, err, readJson, now, authUser, rateLimit } from "./util.js";

const MAX_PAYLOAD = 512 * 1024;                    // rotation strips ride in as dataURLs, same cap as proposals/gen_jobs
const MAX_THUMB = 64 * 1024;                       // a single south-facing dataURL
const CATEGORIES = new Set(["character", "monster", "object", "item"]);
// character/object come from the PixelLab account lists; object8/object1/image
// are the pipeline generation kinds (create-8/1-direction-object, generate-image).
const KINDS = new Set(["character", "object", "object8", "object1", "image"]);

/* Add one item to the signed-in player's gallery — a pin from their PixelLab
 * account history, or (via the client's GenJobs hook) a sprite just generated in
 * the Workshop. Idempotent per (user, pixellab_id): pipeline items pass a unique
 * "job:<id>", so every generation (incl. regenerations) is its own row. */
export async function add(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `gallery:${user.id}`, 400, 86400))
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
  // A thumb is a small south-facing dataURL. Slicing it to fit would corrupt the
  // base64 mid-stream (a broken image), so an oversize one is dropped instead —
  // the client downscales before sending, so this is only a backstop.
  const thumbRaw = String(b.thumb || "");
  const thumb = (thumbRaw && thumbRaw.length <= MAX_THUMB) ? thumbRaw : null;
  const spriteId = String(b.spriteId || "").slice(0, 80) || null;
  const subject = b.subject ? String(b.subject).slice(0, 120) : null;
  const bodyType = b.bodyType ? String(b.bodyType).slice(0, 20) : null;
  const seed = b.seed != null && b.seed !== "" ? String(b.seed).slice(0, 20) : null;
  const createdAt = Number(b.createdAt) || now();
  const t = now();

  await env.DB.prepare(
    `INSERT INTO profile_gallery (user_id, category, source, pixellab_kind, pixellab_id, sprite_id, subject, body_type, seed, name, prompt, thumb, created_at, added_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, pixellab_id) DO UPDATE SET
       category = excluded.category, sprite_id = excluded.sprite_id, subject = excluded.subject,
       body_type = excluded.body_type, seed = excluded.seed, name = excluded.name,
       prompt = excluded.prompt, thumb = excluded.thumb, created_at = excluded.created_at, added_at = excluded.added_at`
  ).bind(user.id, category, "pixellab", pixellabKind, pixellabId, spriteId, subject, bodyType, seed, name, prompt, thumb, createdAt, t).run();
  const row = await env.DB.prepare(
    "SELECT id FROM profile_gallery WHERE user_id = ? AND pixellab_id = ?"
  ).bind(user.id, pixellabId).first();
  if (!row) return err("Couldn't save to your gallery.", 500);
  await env.VAULT.put(`profile/${row.id}.json`, payload, { httpMetadata: { contentType: "application/json" } });
  return json({ ok: true, id: row.id });
}

/* Everything on this player's shelf — metadata + thumbnail + the recipe fields
 * (so the client can regenerate / prefill a publish). Full art per item via
 * /api/profile/gallery/item. */
export async function mine(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const rows = (await env.DB.prepare(
    `SELECT id, category, source, pixellab_kind, pixellab_id, sprite_id, subject, body_type, seed,
            name, prompt, thumb, published_sprite_id, created_at, added_at
     FROM profile_gallery WHERE user_id = ? ORDER BY created_at DESC LIMIT 500`
  ).bind(user.id).all()).results;
  return json({ ok: true, items: rows });
}

/* The full rotation art for one gallery item (from R2). */
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

/* Unpin an item — drops the row and its R2 art (source art still lives on the
 * player's PixelLab account, so nothing is truly lost). Does NOT unpublish any
 * already-published copy — that's a separate public record. */
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

// ---- publishing to the public catalogue -----------------------------------

// A public sprite_id: lowercase snake, safe charset, non-empty.
function slugSpriteId(s) {
  const out = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return out.slice(0, 64) || "sprite";
}

/* Publish a gallery item to the public catalogue. Body: { galleryId, spriteId,
 * category, name }. The art is copied from the item's R2 bundle; the sprite_id is
 * made globally unique by appending -2, -3, … on collision. */
export async function publish(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `publish:${user.id}`, 60, 86400))
    return err("Publish limit reached for today.", 429);
  const b = await readJson(req);
  if (!b) return err("Bad request body.");
  const galleryId = Number(b.galleryId || 0);
  if (!galleryId) return err("galleryId required");
  const category = CATEGORIES.has(b.category) ? b.category : null;
  if (!category) return err("A valid tag (category) is required.");
  const row = await env.DB.prepare("SELECT * FROM profile_gallery WHERE id = ? AND user_id = ?").bind(galleryId, user.id).first();
  if (!row) return err("Gallery item not found.", 404);
  const art = await env.VAULT.get(`profile/${galleryId}.json`);
  if (!art) return err("The art for that item is missing.", 404);
  const artText = await art.text();

  const base = slugSpriteId(b.spriteId || row.sprite_id || row.name || "sprite");
  const name = String(b.name || row.name || "").slice(0, 120) || null;
  const t = now();

  // Claim a unique sprite_id. UNIQUE(sprite_id) is the real guard; we try the
  // bare id first, then -2, -3, … retrying past a lost race.
  let pubId = null, finalSpriteId = null;
  for (let n = 1; n <= 200 && !pubId; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const clash = await env.DB.prepare("SELECT id FROM published_sprites WHERE sprite_id = ?").bind(candidate).first();
    if (clash) continue;
    try {
      const r = await env.DB.prepare(
        `INSERT INTO published_sprites (sprite_id, user_id, category, name, prompt, thumb, created_at, published_at)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(candidate, user.id, category, name, row.prompt, row.thumb, row.created_at || t, t).run();
      pubId = r.meta.last_row_id; finalSpriteId = candidate;
    } catch (_) { /* lost the race on UNIQUE — try the next suffix */ }
  }
  if (!pubId) return err("Couldn't find a free sprite id — try a different one.", 409);

  await env.VAULT.put(`published/${pubId}.json`, artText, { httpMetadata: { contentType: "application/json" } });
  await env.DB.prepare("UPDATE profile_gallery SET published_sprite_id = ? WHERE id = ? AND user_id = ?")
    .bind(finalSpriteId, galleryId, user.id).run();
  return json({ ok: true, id: pubId, spriteId: finalSpriteId });
}

/* Public: the community sprite catalogue — metadata + thumbnail, newest first,
 * optionally filtered by tag. Full art per item via /api/sprites/published/item. */
export async function publishedList(req, env, url) {
  const category = url.searchParams.get("category");
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 200));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const where = CATEGORIES.has(category) ? "WHERE p.category = ?" : "";
  const binds = CATEGORIES.has(category) ? [category, limit, offset] : [limit, offset];
  const rows = (await env.DB.prepare(
    `SELECT p.id, p.sprite_id, p.category, p.name, p.prompt, p.thumb, p.published_at, u.username
     FROM published_sprites p JOIN users u ON u.id = p.user_id
     ${where} ORDER BY p.published_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds).all()).results;
  return json({ ok: true, items: rows });
}

/* Public: the full rotation art for one published sprite (by id or sprite_id). */
export async function publishedItem(req, env, url) {
  const id = Number(url.searchParams.get("id") || 0);
  const spriteId = url.searchParams.get("sprite_id");
  const row = id
    ? await env.DB.prepare(`SELECT p.*, u.username FROM published_sprites p JOIN users u ON u.id = p.user_id WHERE p.id = ?`).bind(id).first()
    : (spriteId ? await env.DB.prepare(`SELECT p.*, u.username FROM published_sprites p JOIN users u ON u.id = p.user_id WHERE p.sprite_id = ?`).bind(spriteId).first() : null);
  if (!row) return err("Not found.", 404);
  let result = null;
  const obj = await env.VAULT.get(`published/${row.id}.json`);
  if (obj) result = JSON.parse(await obj.text());
  return json({ ok: true, item: { ...row, result } });
}
