/* saves.js — the save vault (versioned blobs in R2) plus the two piggyback
 * payloads that ride along with a save upload: opt-in XP snapshots and
 * §6.1-B offline action summaries (stored unvalidated in Phase 1). */

import { json, err, readJson, now, authUser, rateLimit } from "./util.js";
import { processUser } from "./envelope.js";

const MAX_BLOB = 2 * 1024 * 1024;     // the whole character is ~100 KB today
const KEEP_VERSIONS = 15;             // per (user, slot)
const MAX_SUMMARIES = 20;             // per upload
const MAX_SUMMARY_BYTES = 32 * 1024;

const r2Key = (uid, slot, ver) => `saves/${uid}/${slot}/${ver}.json`;

export async function putSave(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `save:${user.id}`, 40, 3600))
    return err("Too many uploads — the vault keeps one every couple of minutes at most.", 429);
  const b = await readJson(req, MAX_BLOB + 256 * 1024);
  if (!b || typeof b.blob !== "string") return err("Bad request body.");
  const slot = (String(b.slot || "main").replace(/[^A-Za-z0-9_-]/g, "") || "main").slice(0, 40);
  if (b.blob.length > MAX_BLOB) return err("Save too large.", 413);
  try { JSON.parse(b.blob); } catch { return err("Save blob is not valid JSON."); }

  const prev = await env.DB.prepare(
    "SELECT MAX(version) AS v FROM saves WHERE user_id = ? AND slot = ?"
  ).bind(user.id, slot).first();
  const version = (prev?.v || 0) + 1;

  await env.VAULT.put(r2Key(user.id, slot, version), b.blob,
    { httpMetadata: { contentType: "application/json" } });
  await env.DB.prepare(
    "INSERT INTO saves (user_id, slot, version, size, created_at) VALUES (?,?,?,?,?)"
  ).bind(user.id, slot, version, b.blob.length, now()).run();
  await env.DB.prepare("UPDATE users SET last_seen = ? WHERE id = ?").bind(now(), user.id).run();

  // Prune old versions past the retention window.
  const old = await env.DB.prepare(
    "SELECT version FROM saves WHERE user_id = ? AND slot = ? ORDER BY version DESC LIMIT -1 OFFSET ?"
  ).bind(user.id, slot, KEEP_VERSIONS).all();
  for (const row of old.results) {
    await env.VAULT.delete(r2Key(user.id, slot, row.version));
    await env.DB.prepare("DELETE FROM saves WHERE user_id = ? AND slot = ? AND version = ?")
      .bind(user.id, slot, row.version).run();
  }

  // Opt-in XP snapshot: {skill: xp}. Absent = not opted in; never inferred
  // from the blob — the client only sends this when the player said yes.
  if (b.xp && typeof b.xp === "object") {
    const rows = Object.entries(b.xp)
      .filter(([k, v]) => typeof k === "string" && k.length <= 40 && Number.isFinite(v) && v >= 0)
      .slice(0, 100);
    for (const [skill, xp] of rows) {
      await env.DB.prepare(
        "INSERT INTO xp_snapshots (user_id, skill, xp, updated_at) VALUES (?,?,?,?) " +
        "ON CONFLICT(user_id, skill) DO UPDATE SET xp = ?, updated_at = ?"
      ).bind(user.id, skill, Math.floor(xp), now(), Math.floor(xp), now()).run();
    }
  }

  // §6.1-B action summaries — stored, then envelope-validated (Phase 2).
  let stored = 0;
  if (Array.isArray(b.summaries)) {
    for (const s of b.summaries.slice(0, MAX_SUMMARIES)) {
      const text = JSON.stringify(s);
      if (text.length > MAX_SUMMARY_BYTES) continue;
      if (!Number.isFinite(s?.start) || !Number.isFinite(s?.end) || s.end < s.start) continue;
      await env.DB.prepare(
        "INSERT INTO action_summaries (user_id, started_at, ended_at, payload, created_at) VALUES (?,?,?,?,?)"
      ).bind(user.id, s.start, s.end, text, now()).run();
      stored++;
    }
  }

  if (stored) await processUser(env, user.id);

  return json({ ok: true, slot, version, summariesStored: stored });
}

export async function listSaves(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const rows = await env.DB.prepare(
    "SELECT slot, version, size, created_at FROM saves WHERE user_id = ? ORDER BY slot, version DESC"
  ).bind(user.id).all();
  return json({ ok: true, saves: rows.results });
}

export async function getSaveBlob(req, env, url) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const slot = (String(url.searchParams.get("slot") || "main").replace(/[^A-Za-z0-9_-]/g, "") || "main").slice(0, 40);
  let version = Number(url.searchParams.get("version") || 0);
  if (!version) {
    const latest = await env.DB.prepare(
      "SELECT MAX(version) AS v FROM saves WHERE user_id = ? AND slot = ?"
    ).bind(user.id, slot).first();
    version = latest?.v || 0;
  }
  if (!version) return err("No save in the vault for that slot.", 404);
  const obj = await env.VAULT.get(r2Key(user.id, slot, version));
  if (!obj) return err("Save blob missing.", 404);
  return new Response(obj.body, {
    headers: { "content-type": "application/json", "x-save-version": String(version) },
  });
}
