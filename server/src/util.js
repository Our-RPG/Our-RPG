/* util.js — shared helpers for the Taiao worker.
 * Responses are always JSON ({ok:true,...} or {error}); times are unix ms,
 * matching the client's wall-clock convention. */

export const now = () => Date.now();

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}
export const err = (message, status = 400) => json({ error: message }, status);

/* Body parsing with a hard size cap — nothing on this API needs > 2.5 MB
 * (the save blob is the biggest payload). */
export async function readJson(req, maxBytes = 64 * 1024) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > maxBytes) return null;
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// ---- encoding -------------------------------------------------------------

export function b64uEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64uDecode(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256hex(str) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function randToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64uEncode(buf);
}

// ---- sessions -------------------------------------------------------------

export const SESSION_DAYS = 90;

export async function createSession(env, userId) {
  const token = randToken();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)"
  ).bind(await sha256hex(token), userId, now(), now() + SESSION_DAYS * 864e5).run();
  return token;
}

/* Resolve the Bearer token to a user row, or null. Sliding expiry: touching
 * a session in its back half renews it, so active players never re-login. */
export async function authUser(req, env) {
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") || "");
  if (!m) return null;
  return authToken(env, m[1]);
}

/* Same resolution from a bare token — for transports that can't carry an
 * Authorization header (the live-presence WebSocket smuggles the token in
 * its subprotocol list, live.js). */
export async function authToken(env, token) {
  if (!token) return null;
  const hash = await sha256hex(token);
  const row = await env.DB.prepare(
    `SELECT s.token_hash, s.expires_at, u.* FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
  ).bind(hash).first();
  if (!row || row.expires_at < now()) return null;
  if ((row.flags || "").split(" ").includes("banned")) return null;
  if (row.expires_at - now() < (SESSION_DAYS / 2) * 864e5) {
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
      .bind(now() + SESSION_DAYS * 864e5, row.token_hash).run();
  }
  // Keep last_seen tracking real activity (it otherwise only moves on login /
  // save). Throttled to ~once a minute so it costs little: this runs on every
  // authed request AND on each live/hub WebSocket connect, so the "seen in the
  // last 24h" roster stays meaningful.
  if (now() - (row.last_seen || 0) > 60e3) {
    await env.DB.prepare("UPDATE users SET last_seen = ? WHERE id = ?")
      .bind(now(), row.id).run();
    row.last_seen = now();
  }
  return row; // user columns + token_hash
}

/* True when a resolved user row carries the space-separated 'curator' flag.
 * Curators form the moderation team that reviews user-uploaded proposals. */
export const isCurator = user => !!user && (user.flags || "").split(" ").includes("curator");

// ---- rate limiting --------------------------------------------------------

/* Coarse fixed-window limiter backed by D1 — plenty at Phase-1 scale.
 * Returns true when the call is ALLOWED. */
export async function rateLimit(env, key, limit, windowSec) {
  const t = now(), winStart = t - (t % (windowSec * 1000));
  const row = await env.DB.prepare("SELECT win_start, count FROM rate_limits WHERE key = ?")
    .bind(key).first();
  if (!row || row.win_start !== winStart) {
    await env.DB.prepare(
      "INSERT INTO rate_limits (key, win_start, count) VALUES (?,?,1) " +
      "ON CONFLICT(key) DO UPDATE SET win_start = ?, count = 1"
    ).bind(key, winStart, winStart).run();
    return true;
  }
  if (row.count >= limit) return false;
  await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?")
    .bind(key).run();
  return true;
}

export const clientIp = req =>
  req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";

// ---- turnstile ------------------------------------------------------------

/* Verifies a Turnstile token. When TURNSTILE_SECRET isn't configured
 * (local dev), verification is skipped so the flow still works. */
export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
  });
  const data = await res.json().catch(() => ({}));
  return !!data.success;
}
