/* secrets.js — the player's stored PixelLab key (Phase 8, see migrations/0008).
 * Server-side generation needs the player's PixelLab key, so we store it here —
 * AES-GCM encrypted at rest with the PIXELLAB_ENC_KEY worker secret. The
 * plaintext key is never persisted and never returned to the client: the client
 * only ever learns whether a key is set and a masked hint. This deliberately
 * changes the old "the key never leaves the browser" promise — server-side
 * generation was chosen precisely so a sprite finishes even with the tab closed. */

import { json, err, readJson, now, authUser } from "./util.js";

// Import the raw PIXELLAB_ENC_KEY secret (base64 of 32 bytes) as an AES-GCM key.
async function encKey(env) {
  if (!env.PIXELLAB_ENC_KEY) throw new Error("PIXELLAB_ENC_KEY is not configured on the server.");
  // Accept standard or url-safe base64.
  const b = env.PIXELLAB_ENC_KEY.replace(/-/g, "+").replace(/_/g, "/");
  const raw = Uint8Array.from(atob(b), c => c.charCodeAt(0));
  // AES-GCM needs exactly 16/24/32 bytes. A longer secret is truncated to 32;
  // anything shorter than 16 is a misconfiguration.
  if (raw.length < 16) throw new Error("PIXELLAB_ENC_KEY is too short (need >=16 bytes base64).");
  const material = raw.length >= 32 ? raw.slice(0, 32) : (raw.length >= 24 ? raw.slice(0, 24) : raw.slice(0, 16));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function encrypt(env, plaintext) {
  const key = await encKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return toB64(iv) + ":" + toB64(ct);
}
export async function decrypt(env, stored) {
  if (!stored || stored.indexOf(":") < 0) return null;
  const key = await encKey(env);
  const [ivB64, ctB64] = stored.split(":");
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivB64) }, key, fromB64(ctB64));
    return new TextDecoder().decode(pt);
  } catch (_) { return null; }
}

const mask = k => k && k.length > 8 ? k.slice(0, 4) + "…" + k.slice(-4) : "set";

/* The user's decrypted PixelLab key, or null. Used by the generation pipeline
 * (gen.js). Never exposed over the wire. */
export async function pixellabKeyFor(env, userId) {
  const row = await env.DB.prepare("SELECT pixellab_key_enc FROM user_secrets WHERE user_id = ?").bind(userId).first();
  if (!row || !row.pixellab_key_enc) return null;
  return decrypt(env, row.pixellab_key_enc);
}

// ---- endpoints ------------------------------------------------------------

export async function setKey(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!env.PIXELLAB_ENC_KEY) return err("This server isn't configured to store keys yet.", 501);
  const b = await readJson(req, 8192);
  const key = String(b?.key || "").trim();
  if (!key) return err("Paste a key first.");
  if (key.length > 400) return err("That doesn't look like a key.");
  const enc = await encrypt(env, key);
  await env.DB.prepare(
    `INSERT INTO user_secrets (user_id, pixellab_key_enc, updated_at) VALUES (?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET pixellab_key_enc = excluded.pixellab_key_enc, updated_at = excluded.updated_at`
  ).bind(user.id, enc, now()).run();
  return json({ ok: true, set: true, masked: mask(key) });
}

export async function keyStatus(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const key = await pixellabKeyFor(env, user.id).catch(() => null);
  return json({ ok: true, set: !!key, masked: key ? mask(key) : "", configured: !!env.PIXELLAB_ENC_KEY });
}

export async function deleteKey(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  await env.DB.prepare("DELETE FROM user_secrets WHERE user_id = ?").bind(user.id).run();
  return json({ ok: true, set: false });
}
