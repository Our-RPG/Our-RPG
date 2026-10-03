/* npc.js — proxy to the (closed-source) NPC dialogue engine.
 *
 * The engine itself lives off-Worker (see NPC_ENGINE_URL var + NPC_ENGINE_KEY
 * secret); this route is the only way players reach it: it authenticates the
 * account, rate-limits, normalizes the payload, and forwards. When the engine
 * is unreachable (or not configured) the client falls back to the canned bank
 * exactly as it does offline — a null reply here is a soft miss, never an
 * error the player sees.
 */
import { json, err, readJson, authUser, rateLimit, now } from "./util.js";

const MAX_TEXT = 300;

// Bounds on the free-form context a client forwards to the engine. The 16 KB
// body cap (readJson) limits the whole, but these keep any single field from
// being pathological — an unbounded blob of scene/fills/player is both a
// prompt-injection surface and a resource one. Anything over the bound is
// truncated/dropped rather than rejected (a soft miss is never player-facing).
const MAX_STR = 500;     // any one forwarded string value
const MAX_ARR = 32;      // entries kept per array
const MAX_KEYS = 32;     // keys kept per object
const MAX_DEPTH = 4;     // nesting descended before we drop the rest

// Recursively clamp a client-supplied value to the bounds above. Strings are
// truncated, arrays/objects capped in size, deep nesting dropped; non-JSON
// values become null.
function bound(v, depth = 0) {
  if (v == null) return null;
  if (typeof v === "string") return v.slice(0, MAX_STR);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(v)) return v.slice(0, MAX_ARR).map(x => bound(x, depth + 1));
  if (typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v).slice(0, MAX_KEYS))
      out[String(k).slice(0, 64)] = bound(val, depth + 1);
    return out;
  }
  return null;
}

// ---------- engine reachability (the top-right status dot) ----------
// Cached module-scope (a warm isolate keeps this between requests) so a
// roomful of clients polling every ~20s doesn't turn into a roomful of
// requests to the actual engine. No account/rate-limit needed — same
// treatment as /api/health, just a cheap "is it up" probe.
const STATUS_TTL = 10000;
let _statusCache = { at: 0, ok: false };
export async function status(req, env) {
  if (!env.NPC_ENGINE_URL || !env.NPC_ENGINE_KEY) return json({ ok: false });
  const t = now();
  if (t - _statusCache.at < STATUS_TTL) return json({ ok: _statusCache.ok });
  let ok = false;
  try {
    const res = await fetch(env.NPC_ENGINE_URL + "/health", {
      headers: { "x-engine-key": env.NPC_ENGINE_KEY },
      signal: AbortSignal.timeout(3000),
    });
    ok = res.ok;
  } catch (e) { ok = false; }
  _statusCache = { at: t, ok };
  return json({ ok });
}

export async function chat(req, env) {
  if (!env.NPC_ENGINE_URL || !env.NPC_ENGINE_KEY)
    return json({ reply: null, off: true });
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  // generous: chatting is the feature — but bounded per account
  if (!await rateLimit(env, `npcchat:${user.id}`, 40, 60))
    return err("Slow down a little.", 429);
  if (!await rateLimit(env, `npcchatd:${user.id}`, 3000, 86400))
    return err("That's enough chatting for one day.", 429);

  const b = await readJson(req, 16384);
  if (!b || !b.npc) return err("Bad request.", 400);
  const payload = {
    text: typeof b.text === "string" ? b.text.slice(0, MAX_TEXT) : null,
    npc: {
      name: String(b.npc.name || "villager").slice(0, 40),
      role: String(b.npc.role || "merchant").slice(0, 30),
      persona: String(b.npc.persona || "plain").slice(0, 60),
      mood: String(b.npc.mood || "calm").slice(0, 20),
    },
    scene: bound(b.scene && typeof b.scene === "object" ? b.scene : {}),
    // Server-derived name goes AFTER the client spread so it always wins — a
    // client-supplied player.name must never override the authenticated user.
    player: { ...bound(b.player && typeof b.player === "object" ? b.player : {}),
              name: String(user.username || "friend").slice(0, 24) },
    fills: bound(b.fills && typeof b.fills === "object" ? b.fills : {}),
  };

  try {
    const res = await fetch(env.NPC_ENGINE_URL + "/chat", {
      method: "POST",
      headers: { "content-type": "application/json",
                 "x-engine-key": env.NPC_ENGINE_KEY },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return json({ reply: null });
    const d = await res.json();
    // pass reply only — the debug trace stays server-side
    return json({ reply: typeof d.reply === "string" ? d.reply : null });
  } catch (e) {
    return json({ reply: null });
  }
}
