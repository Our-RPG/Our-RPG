/* telemetry.js — the gameplay event stream (design-insight analytics).
 * The client (js/net/telemetry.js) batches timestamped action events —
 * moves, clicks, gathers, fights, UI use, trades — and POSTs them here.
 * Batches land verbatim in R2 as one object each, partitioned by day and
 * sender, so analysis is a bucket scan (rclone/wrangler + a notebook), not
 * a database migration. D1 stays out of the hot path entirely except the
 * shared rate limiter.
 *
 * Login is OPTIONAL: logged-out players report under their anonymous device
 * id only; a Bearer session additionally stamps the batch with the user id.
 * The client exposes an in-game off switch ("Share gameplay data").
 *
 * R2 layout:  tele/<YYYY-MM-DD>/<u<id>|anon>-<device>/<recvMs>-<seq>.json
 * Envelope:   {v, user, username, device, char, dev, build, session, seq,
 *              sentAt, recvAt, country, dropped, events:[[t,type,...], ...]}
 */

import { json, err, readJson, now, authUser, rateLimit, clientIp, constantTimeEqual } from "./util.js";

const MAX_BODY = 1024 * 1024;   // a full batch of ~3000 compact events is ~100 KB
const MAX_EVENTS = 5000;        // per batch
const MAX_FIELDS = 8;           // per event
const MAX_STR = 80;             // per string field
const BATCHES_PER_HOUR = 300;       // per device — the client sends ~2/min at most
const BATCHES_PER_IP_HOUR = 600;    // per IP — several tabs/devices behind one NAT are fine; this is the real throttle (device id is client-chosen and freely rotated)
const ANON_GLOBAL_PER_DAY = 100000; // global ceiling on anonymous batches/day — bounds total unauthenticated R2 write volume even across a swarm of rotating IPs

function cleanEvents(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const e of raw.slice(0, MAX_EVENTS)) {
    if (!Array.isArray(e) || e.length < 2) continue;
    const [t, type] = e;
    if (!Number.isFinite(t) || typeof type !== "string" || type.length > 24) continue;
    const ev = [t, type];
    for (const f of e.slice(2, MAX_FIELDS)) {
      if (typeof f === "string") ev.push(f.slice(0, MAX_STR));
      else if (Number.isFinite(f)) ev.push(f);
      else if (f === null) ev.push(null);
    }
    out.push(ev);
  }
  return out;
}

export async function ingest(req, env) {
  const user = await authUser(req, env);   // optional — anonymous is welcome
  const b = await readJson(req, MAX_BODY);
  if (!b || typeof b.device !== "string" || !/^[\w-]{4,64}$/.test(b.device))
    return err("Bad request body.");
  // Three throttles, all single-row D1 upserts, so a rejected request never
  // reaches the 1 MB R2 put. The per-device key is trivially evaded (the client
  // chooses `device`), so the per-IP cap is the real throttle on write
  // amplification; the per-day global ceiling bounds total ANONYMOUS R2 write
  // volume even across many rotating IPs.
  if (!await rateLimit(env, `tele:${b.device}`, BATCHES_PER_HOUR, 3600))
    return err("Too many telemetry batches.", 429);
  if (!await rateLimit(env, `tele-ip:${clientIp(req)}`, BATCHES_PER_IP_HOUR, 3600))
    return err("Too many telemetry batches.", 429);
  if (!user) {
    const gday = new Date(now()).toISOString().slice(0, 10);
    if (!await rateLimit(env, `tele-global:${gday}`, ANON_GLOBAL_PER_DAY, 86400))
      return err("Anonymous telemetry is busy right now; sign in to keep sharing.", 429);
  }
  const events = cleanEvents(b.events);
  if (!events || !events.length) return err("No events.");

  const recvAt = now();
  const day = new Date(recvAt).toISOString().slice(0, 10);
  const sender = (user ? "u" + user.id : "anon") + "-" + b.device.slice(0, 24);
  const seq = Number.isFinite(b.seq) ? Math.floor(b.seq) : 0;
  const key = `tele/${day}/${sender}/${recvAt}-${seq}.json`;

  const envl = {
    v: 1,
    user: user ? user.id : null,
    username: user ? user.username : null,
    device: b.device,
    char: Number.isFinite(b.char) ? b.char : null,
    dev: b.dev ? 1 : 0,
    build: typeof b.build === "string" ? b.build.slice(0, 24) : null,
    session: typeof b.session === "string" ? b.session.slice(0, 40) : null,
    seq,
    sentAt: Number.isFinite(b.now) ? b.now : null,
    recvAt,
    country: (req.cf && req.cf.country) || null,
    dropped: Number.isFinite(b.dropped) ? b.dropped : 0,
    events,
  };
  await env.VAULT.put(key, JSON.stringify(envl),
    { httpMetadata: { contentType: "application/json" } });
  return json({ ok: true, stored: events.length });
}

// ---- maintainer analysis surface (ADMIN_TOKEN, curl-first like admin.js) ----

async function isAdmin(req, env) {
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") || "");
  return !!(env.ADMIN_TOKEN && m && await constantTimeEqual(m[1], env.ADMIN_TOKEN));
}

/* GET /api/admin/telemetry?day=YYYY-MM-DD[&cursor=...]  — list a day's batches.
 * GET /api/admin/telemetry?key=tele/.../....json         — fetch one batch. */
export async function adminBrowse(req, env, url) {
  if (!await isAdmin(req, env)) return err("Nope.", 403);
  const key = url.searchParams.get("key");
  if (key) {
    if (!key.startsWith("tele/")) return err("Telemetry keys only.");
    const obj = await env.VAULT.get(key);
    if (!obj) return err("Not found.", 404);
    return new Response(obj.body, { headers: { "content-type": "application/json" } });
  }
  const day = url.searchParams.get("day") || new Date(now()).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return err("Need day=YYYY-MM-DD or key=.");
  const list = await env.VAULT.list({
    prefix: `tele/${day}/`, limit: 500,
    cursor: url.searchParams.get("cursor") || undefined,
  });
  return json({
    ok: true, day,
    batches: list.objects.map(o => ({ key: o.key, size: o.size })),
    cursor: list.truncated ? list.cursor : null,
  });
}
