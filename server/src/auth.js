/* auth.js — username+password accounts (argon2id), sessions, Turnstile.
 * Design (audit §Phase 1): no email required to play — email is optional and
 * only ever used for recovery. Privacy is part of wholesome. */

import { argon2id } from "@noble/hashes/argon2";
import {
  json, err, readJson, now, b64uEncode, b64uDecode, randToken,
  createSession, authUser, rateLimit, clientIp, verifyTurnstile, sha256hex,
} from "./util.js";

/* OWASP-recommended interactive params. Pure-JS argon2 costs ~100-200 ms of
 * CPU on a Worker — fine on the paid plan, and only paid on register/login. */
const ARGON = { m: 19456, t: 2, p: 1, dkLen: 32 };

function hashPassword(password, saltBytes) {
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const hash = argon2id(new TextEncoder().encode(password), salt, ARGON);
  return `argon2id$v1$m=${ARGON.m},t=${ARGON.t},p=${ARGON.p}$${b64uEncode(salt)}$${b64uEncode(hash)}`;
}

function verifyPassword(password, stored) {
  const parts = (stored || "").split("$");
  if (parts.length !== 5 || parts[0] !== "argon2id") return false;
  const recomputed = hashPassword(password, b64uDecode(parts[3]));
  // Constant-time-ish compare; both strings are same-format hashes.
  if (recomputed.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < stored.length; i++) diff |= stored.charCodeAt(i) ^ recomputed.charCodeAt(i);
  return diff === 0;
}

const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const RESERVED = new Set(["admin", "taiao", "moderator", "curator", "system", "keeper"]);

export async function register(req, env) {
  const ip = clientIp(req);
  if (!await rateLimit(env, `reg:${ip}`, 5, 3600)) return err("Too many signups from this address — try later.", 429);
  const b = await readJson(req);
  if (!b) return err("Bad request body.");
  const { username, password, email, turnstile } = b;
  if (!USERNAME_RE.test(username || "")) return err("Username must be 3-20 characters: letters, digits, _ or -.");
  if (RESERVED.has(username.toLowerCase())) return err("That name is reserved.");
  if (typeof password !== "string" || password.length < 8 || password.length > 200)
    return err("Password must be at least 8 characters.");
  if (email != null && (typeof email !== "string" || email.length > 200 || (email && !email.includes("@"))))
    return err("That email doesn't look right (it's optional — leave it blank).");
  if (!await verifyTurnstile(env, turnstile, ip)) return err("Bot check failed — reload and try again.", 403);

  const passHash = hashPassword(password);
  try {
    const r = await env.DB.prepare(
      "INSERT INTO users (username, pass_hash, email, created_at, last_seen) VALUES (?,?,?,?,?)"
    ).bind(username, passHash, email || null, now(), now()).run();
    const token = await createSession(env, r.meta.last_row_id);
    return json({ ok: true, token, username });
  } catch (e) {
    if (String(e).includes("UNIQUE")) return err("That name is taken.", 409);
    throw e;
  }
}

export async function login(req, env) {
  const ip = clientIp(req);
  if (!await rateLimit(env, `login:${ip}`, 20, 3600)) return err("Too many attempts — try later.", 429);
  const b = await readJson(req);
  if (!b) return err("Bad request body.");
  const { username, password, turnstile } = b;
  if (!await rateLimit(env, `login-u:${String(username).toLowerCase()}`, 10, 900))
    return err("Too many attempts for this account — try later.", 429);
  if (!await verifyTurnstile(env, turnstile, ip)) return err("Bot check failed — reload and try again.", 403);

  const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username || "").first();
  if (!user || !verifyPassword(password || "", user.pass_hash)) return err("Wrong name or password.", 401);
  if ((user.flags || "").split(" ").includes("banned")) return err("This account is suspended.", 403);
  await env.DB.prepare("UPDATE users SET last_seen = ? WHERE id = ?").bind(now(), user.id).run();
  const token = await createSession(env, user.id);
  return json({ ok: true, token, username: user.username });
}

export async function logout(req, env) {
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") || "");
  if (m) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(await sha256hex(m[1])).run();
  return json({ ok: true });
}

export async function me(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const [keys, saves] = await Promise.all([
    env.DB.prepare("SELECT cred_id, label, created_at FROM passkeys WHERE user_id = ?").bind(user.id).all(),
    env.DB.prepare(
      `SELECT slot, MAX(version) AS version, MAX(created_at) AS created_at, size
       FROM saves WHERE user_id = ? GROUP BY slot`).bind(user.id).all(),
  ]);
  return json({
    ok: true,
    id: user.id,                 // the Workshop wears this as your crew number
    username: user.username,
    created_at: user.created_at,
    hasEmail: !!user.email,
    curator: (user.flags || "").split(" ").includes("curator"),
    passkeys: keys.results.map(k => ({ id: k.cred_id, label: k.label, created_at: k.created_at })),
    saves: saves.results,
  });
}

/* Optional-email recovery is deliberately NOT self-serve in Phase 1 (no email
 * sender configured yet). Password change for a logged-in user: */
export async function changePassword(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const b = await readJson(req);
  if (!b) return err("Bad request body.");
  if (!verifyPassword(b.oldPassword || "", user.pass_hash)) return err("Wrong current password.", 401);
  if (typeof b.newPassword !== "string" || b.newPassword.length < 8) return err("New password too short.");
  await env.DB.prepare("UPDATE users SET pass_hash = ? WHERE id = ?")
    .bind(hashPassword(b.newPassword), user.id).run();
  // Invalidate every other session for safety.
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
    .bind(user.id, user.token_hash).run();
  return json({ ok: true });
}
