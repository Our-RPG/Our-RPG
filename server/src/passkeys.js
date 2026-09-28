/* passkeys.js — optional WebAuthn (ES256 only, "none" attestation).
 * Enough for real passkey login on every mainstream authenticator without
 * pulling in a dependency: a ~40-line CBOR reader for the attestation object
 * and WebCrypto for the P-256 verify. RP id is per-origin (see rpIdFor
 * below), falling back to env.RP_ID (the domain the GAME is served from). */

import {
  json, err, readJson, now, b64uEncode, b64uDecode, randToken,
  createSession, authUser, rateLimit, clientIp,
} from "./util.js";

const CHALLENGE_TTL = 5 * 60 * 1000;

// ---- minimal CBOR (uints, negints, bytes, text, arrays, maps) -------------

function cborDecode(bytes) {
  let pos = 0;
  function read() {
    const first = bytes[pos++], major = first >> 5, info = first & 31;
    let len = info;
    if (info === 24) len = bytes[pos++];
    else if (info === 25) { len = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; }
    else if (info === 26) { len = (bytes[pos] << 24 | bytes[pos + 1] << 16 | bytes[pos + 2] << 8 | bytes[pos + 3]) >>> 0; pos += 4; }
    else if (info > 26) throw new Error("cbor: unsupported length");
    switch (major) {
      case 0: return len;
      case 1: return -1 - len;
      case 2: { const v = bytes.slice(pos, pos + len); pos += len; return v; }
      case 3: { const v = new TextDecoder().decode(bytes.slice(pos, pos + len)); pos += len; return v; }
      case 4: { const arr = []; for (let i = 0; i < len; i++) arr.push(read()); return arr; }
      case 5: { const map = new Map(); for (let i = 0; i < len; i++) { const k = read(); map.set(k, read()); } return map; }
      default: throw new Error("cbor: unsupported major " + major);
    }
  }
  return read();
}

// ---- helpers --------------------------------------------------------------

async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256",
    typeof data === "string" ? new TextEncoder().encode(data) : data));
}

function bytesEq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/* WebAuthn signatures are ASN.1 DER; WebCrypto wants raw r||s (64 bytes). */
function derToRaw(der) {
  let pos = 2; // 0x30, seq len (assumes short form; ES256 sigs always are)
  function readInt() {
    if (der[pos++] !== 0x02) throw new Error("bad DER");
    let len = der[pos++];
    let val = der.slice(pos, pos + len); pos += len;
    while (val.length > 32) val = val.slice(1);          // strip leading zero
    const out = new Uint8Array(32);
    out.set(val, 32 - val.length);
    return out;
  }
  const r = readInt(), s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r, 0); raw.set(s, 32);
  return raw;
}

function originAllowed(env, origin) {
  return (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).includes(origin);
}

/* WebAuthn scopes a credential to the serving domain, so rp.id has to match
 * wherever the page actually is — the game (itch) or the Workshop site are
 * different origins. Trust the request's Origin header when it's on the
 * allowlist and use its hostname; otherwise fall back to env.RP_ID. This
 * means credentials stay per-domain: an itch passkey keeps working on itch,
 * and a Workshop-domain passkey is a separate credential — that's WebAuthn
 * working as intended, not a bug. Existing itch users see no change (their
 * origin's hostname IS env.RP_ID). */
function rpIdFor(req, env) {
  const origin = req.headers.get("origin") || "";
  if (originAllowed(env, origin)) {
    try { return new URL(origin).hostname; } catch { /* malformed origin, fall through */ }
  }
  return env.RP_ID;
}

async function makeChallenge(env, userId, kind) {
  const challenge = randToken(32);
  await env.DB.prepare(
    "INSERT INTO webauthn_challenges (challenge, user_id, kind, expires_at) VALUES (?,?,?,?)"
  ).bind(challenge, userId, kind, now() + CHALLENGE_TTL).run();
  return challenge;
}

async function takeChallenge(env, challenge, kind) {
  const row = await env.DB.prepare(
    "SELECT * FROM webauthn_challenges WHERE challenge = ? AND kind = ?"
  ).bind(challenge || "", kind).first();
  if (row) await env.DB.prepare("DELETE FROM webauthn_challenges WHERE challenge = ?")
    .bind(challenge).run();
  return row && row.expires_at > now() ? row : null;
}

/* Parses clientDataJSON (base64url) and checks type + origin; returns the
 * parsed object or null. */
function checkClientData(env, b64, expectType) {
  try {
    const cd = JSON.parse(new TextDecoder().decode(b64uDecode(b64)));
    if (cd.type !== expectType) return null;
    if (!originAllowed(env, cd.origin)) return null;
    return cd;
  } catch { return null; }
}

// ---- registration ---------------------------------------------------------

export async function registerOptions(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const challenge = await makeChallenge(env, user.id, "reg");
  return json({
    ok: true,
    publicKey: {
      challenge,
      rp: { id: rpIdFor(req, env), name: "Our RPG" },
      user: { id: b64uEncode(new TextEncoder().encode("u" + user.id)), name: user.username, displayName: user.username },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      attestation: "none",
      timeout: 120000,
    },
  });
}

export async function registerFinish(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const b = await readJson(req, 128 * 1024);
  if (!b || !b.response) return err("Bad request body.");
  const cd = checkClientData(env, b.response.clientDataJSON, "webauthn.create");
  if (!cd) return err("Bad client data.", 403);
  if (!await takeChallenge(env, cd.challenge, "reg")) return err("Challenge expired — try again.", 403);

  let att;
  try { att = cborDecode(b64uDecode(b.response.attestationObject)); }
  catch { return err("Unreadable attestation."); }
  const authData = att.get("authData");
  if (!(authData instanceof Uint8Array) || authData.length < 55) return err("Bad authData.");
  if (!bytesEq(authData.slice(0, 32), await sha256(rpIdFor(req, env)))) return err("RP id mismatch.", 403);
  if (!(authData[32] & 0x40)) return err("No credential in authData.");

  // authData: rpIdHash(32) flags(1) counter(4) aaguid(16) credIdLen(2) credId cosePubkey
  const credIdLen = (authData[53] << 8) | authData[54];
  const credId = authData.slice(55, 55 + credIdLen);
  const cose = cborDecode(authData.slice(55 + credIdLen));
  if (cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1)
    return err("Only ES256/P-256 passkeys are supported.");
  const jwk = { kty: "EC", crv: "P-256", x: b64uEncode(cose.get(-2)), y: b64uEncode(cose.get(-3)) };

  await env.DB.prepare(
    "INSERT OR REPLACE INTO passkeys (cred_id, user_id, pubkey_jwk, counter, label, created_at) VALUES (?,?,?,?,?,?)"
  ).bind(b64uEncode(credId), user.id, JSON.stringify(jwk), 0,
         String(b.label || "").slice(0, 40), now()).run();
  return json({ ok: true });
}

// ---- login ----------------------------------------------------------------

export async function loginOptions(req, env) {
  const b = await readJson(req);
  const challenge = await makeChallenge(env, null, "auth");
  let allowCredentials;
  if (b && b.username) {
    const rows = await env.DB.prepare(
      `SELECT p.cred_id FROM passkeys p JOIN users u ON u.id = p.user_id WHERE u.username = ?`
    ).bind(b.username).all();
    allowCredentials = rows.results.map(r => ({ type: "public-key", id: r.cred_id }));
  }
  return json({
    ok: true,
    publicKey: { challenge, rpId: rpIdFor(req, env), userVerification: "preferred",
                 timeout: 120000, ...(allowCredentials ? { allowCredentials } : {}) },
  });
}

export async function loginFinish(req, env) {
  const ip = clientIp(req);
  if (!await rateLimit(env, `pklogin:${ip}`, 30, 3600)) return err("Too many attempts — try later.", 429);
  const b = await readJson(req, 64 * 1024);
  if (!b || !b.response) return err("Bad request body.");
  const cd = checkClientData(env, b.response.clientDataJSON, "webauthn.get");
  if (!cd) return err("Bad client data.", 403);
  if (!await takeChallenge(env, cd.challenge, "auth")) return err("Challenge expired — try again.", 403);

  const cred = await env.DB.prepare("SELECT * FROM passkeys WHERE cred_id = ?").bind(b.id || "").first();
  if (!cred) return err("Unknown passkey.", 401);

  const authData = b64uDecode(b.response.authenticatorData);
  if (!bytesEq(authData.slice(0, 32), await sha256(rpIdFor(req, env)))) return err("RP id mismatch.", 403);
  if (!(authData[32] & 0x01)) return err("User presence flag missing.", 403);

  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData, 0);
  signed.set(await sha256(b64uDecode(b.response.clientDataJSON)), authData.length);

  const key = await crypto.subtle.importKey("jwk", JSON.parse(cred.pubkey_jwk),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  let ok = false;
  try {
    ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
      derToRaw(b64uDecode(b.response.signature)), signed);
  } catch { ok = false; }
  if (!ok) return err("Signature check failed.", 401);

  const counter = (authData[33] << 24 | authData[34] << 16 | authData[35] << 8 | authData[36]) >>> 0;
  if (counter && cred.counter && counter <= cred.counter)
    return err("Stale authenticator counter.", 401); // possible cloned key
  await env.DB.prepare("UPDATE passkeys SET counter = ? WHERE cred_id = ?").bind(counter, cred.cred_id).run();

  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(cred.user_id).first();
  if (!user || (user.flags || "").split(" ").includes("banned")) return err("Account unavailable.", 403);
  await env.DB.prepare("UPDATE users SET last_seen = ? WHERE id = ?").bind(now(), user.id).run();
  const token = await createSession(env, user.id);
  return json({ ok: true, token, username: user.username });
}

export async function removePasskey(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const b = await readJson(req);
  if (!b || !b.id) return err("Bad request body.");
  await env.DB.prepare("DELETE FROM passkeys WHERE cred_id = ? AND user_id = ?")
    .bind(b.id, user.id).run();
  return json({ ok: true });
}
