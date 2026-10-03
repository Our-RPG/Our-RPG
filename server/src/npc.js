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
    scene: b.scene && typeof b.scene === "object" ? b.scene : {},
    player: { name: String(user.username || "friend").slice(0, 24),
              ...(b.player && typeof b.player === "object" ? b.player : {}) },
    fills: b.fills && typeof b.fills === "object" ? b.fills : {},
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
