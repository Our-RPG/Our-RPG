/* link.js — one-time "Workshop sign-in code" flow (Phase 5).
 * Itch runs the game in an iframe on a different origin than the Workshop
 * site, so localStorage session tokens can't cross over. A logged-in player
 * mints a short code in-game; pasting it into the Workshop's sign-in form
 * redeems it for a real session there — no password needed. Single-use,
 * 10-minute TTL, one live code per account (minting a new one invalidates
 * any old one, same spirit as takeChallenge in passkeys.js). */

import {
  json, err, readJson, now, sha256hex, randToken,
  createSession, authUser, rateLimit, clientIp,
} from "./util.js";

const CODE_TTL = 10 * 60 * 1000;

export async function makeCode(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `linkcode:${user.id}`, 10, 3600))
    return err("Too many codes requested — try later.", 429);

  const code = randToken(6).replace(/[-_]/g, "x").slice(0, 8).toUpperCase();
  await env.DB.prepare("DELETE FROM link_codes WHERE user_id = ?").bind(user.id).run();
  await env.DB.prepare(
    "INSERT INTO link_codes (code_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)"
  ).bind(await sha256hex(code), user.id, now(), now() + CODE_TTL).run();
  return json({ ok: true, code, expiresInSec: CODE_TTL / 1000 });
}

export async function redeemCode(req, env) {
  if (!await rateLimit(env, `linkredeem:${clientIp(req)}`, 10, 3600))
    return err("Too many attempts — try later.", 429);
  const b = await readJson(req);
  if (!b || !b.code) return err("Bad request body.");
  const normalized = String(b.code).trim().toUpperCase().replace(/[\s-]+/g, "");
  const hash = await sha256hex(normalized);

  const row = await env.DB.prepare("SELECT * FROM link_codes WHERE code_hash = ?").bind(hash).first();
  if (row) await env.DB.prepare("DELETE FROM link_codes WHERE code_hash = ?").bind(hash).run();
  if (!row || row.expires_at < now()) return err("Code invalid or expired.", 403);

  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(row.user_id).first();
  if (!user || (user.flags || "").split(" ").includes("banned")) return err("Account unavailable.", 403);
  const token = await createSession(env, user.id);
  return json({ ok: true, token, username: user.username });
}
