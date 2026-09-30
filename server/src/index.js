/* index.js — the Taiao Phase-1 worker: router, CORS, cron.
 * One Worker, three bindings (DB=D1, VAULT=R2, Turnstile via secret).
 * Everything the game needs when logged out is public GET; every write
 * needs a session. GPL-3.0-or-later, same repo as the game — the server
 * being open is part of the trust story. */

import { err, json, now } from "./util.js";
import * as auth from "./auth.js";
import * as passkeys from "./passkeys.js";
import * as link from "./link.js";
import * as saves from "./saves.js";
import * as xp from "./xp.js";
import * as workshop from "./workshop.js";
import * as gen from "./gen.js";
import * as profile from "./profile.js";
import * as koha from "./koha.js";
import * as admin from "./admin.js";
import { buildAndPostDigest } from "./digest.js";
import * as region from "./region.js";
import * as live from "./live.js";
import * as hub from "./hub.js";
import * as players from "./players.js";
import * as shops from "./shops.js";
import * as seeds from "./seeds.js";
import * as envelope from "./envelope.js";
import * as ranks from "./ranks.js";
import * as telemetry from "./telemetry.js";
import * as zones from "./zones.js";

export { RegionLedger } from "./region.js";
export { LiveZone } from "./live.js";
export { GlobalHub } from "./hub.js";

const ROUTES = {
  "POST /api/register":                 auth.register,
  "POST /api/login":                    auth.login,
  "POST /api/logout":                   auth.logout,
  "GET /api/me":                        auth.me,
  "POST /api/password":                 auth.changePassword,

  "POST /api/passkey/register/options": passkeys.registerOptions,
  "POST /api/passkey/register":         passkeys.registerFinish,
  "POST /api/passkey/login/options":    passkeys.loginOptions,
  "POST /api/passkey/login":            passkeys.loginFinish,
  "POST /api/passkey/remove":           passkeys.removePasskey,

  "POST /api/link/code":                link.makeCode,
  "POST /api/link/redeem":              link.redeemCode,

  "PUT /api/save":                      saves.putSave,
  "GET /api/save/list":                 saves.listSaves,
  "GET /api/save/blob":                 saves.getSaveBlob,

  "GET /api/xp/dist":                   xp.distribution,
  "GET /api/xp/leaderboard":            xp.leaderboard,

  "POST /api/workshop/votes":           workshop.pushVotes,
  "GET /api/workshop/tally":            workshop.tally,
  "POST /api/workshop/proposal":        workshop.submitProposal,
  "GET /api/workshop/proposals":        workshop.listProposals,
  "GET /api/workshop/proposal":         workshop.getProposal,
  "GET /api/workshop/mine":             workshop.mine,
  "POST /api/workshop/endorse":         workshop.endorse,
  "POST /api/workshop/flag":            workshop.flag,
  "GET /api/workshop/pending":          workshop.pendingQueue,
  "POST /api/workshop/review":          workshop.review,
  "GET /api/workshop/digest/latest":    workshop.latestDigest,
  "GET /api/workshop/gaps":             workshop.gaps,

  "POST /api/gen/start":                gen.start,
  "POST /api/gen/progress":             gen.progress,
  "POST /api/gen/complete":             gen.complete,
  "POST /api/gen/fail":                 gen.fail,
  "GET /api/gen/mine":                  gen.mine,
  "GET /api/gen/job":                   gen.getResult,
  "POST /api/gen/delete":               gen.remove,

  "POST /api/profile/gallery/add":      profile.add,
  "GET /api/profile/gallery":           profile.mine,
  "GET /api/profile/gallery/item":      profile.getItem,
  "POST /api/profile/gallery/delete":   profile.remove,

  "POST /api/sprites/publish":          profile.publish,
  "GET /api/sprites/published":         profile.publishedList,
  "GET /api/sprites/published/item":    profile.publishedItem,

  "GET /api/koha/transparency":         koha.transparency,

  "POST /api/region/push":              region.pushDeltas,
  "GET /api/region/pull":               region.pullDeltas,
  "GET /api/live/ws":                   live.connect,
  "GET /api/hub/ws":                    hub.connect,
  "GET /api/players/recent":            players.recent,
  "GET /api/shop/stock":                shops.stock,
  "POST /api/shop/trade":               shops.trade,
  "POST /api/seeds/next":               seeds.next,
  "GET /api/xp/validated":              envelope.mine,
  "GET /api/ranks/skill":               ranks.skillMeta,
  "GET /api/ranks/me":                  ranks.mine,

  "GET /api/zones/index":               zones.index,
  "GET /api/zones/state":               zones.state,
  "GET /api/zones/manifest":            zones.manifest,
  "GET /api/zones/map":                 zones.mapImage,
  "POST /api/zones/claim":              zones.claim,
  "POST /api/zones/progress":           zones.progress,
  "PUT /api/zones/checkpoint":          zones.putCheckpoint,
  "GET /api/zones/checkpoint":          zones.getCheckpoint,
  "POST /api/zones/publish":            zones.publish,

  "POST /api/telemetry":                telemetry.ingest,
  "GET /api/admin/telemetry":           telemetry.adminBrowse,

  "POST /api/admin/cost":               admin.setCost,
  "GET /api/admin/flagged":             admin.flaggedQueue,
  "POST /api/admin/proposal":           admin.setProposalStatus,
  "POST /api/admin/gaps":               admin.setGaps,
};

function corsHeaders(req, env) {
  const origin = req.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim());
  if (!allowed.includes(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    "vary": "origin",
  };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS")
      return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    // Same-origin tools (curl, health checks) carry no Origin header —
    // allowed. A browser origin outside the allowlist is refused.
    if (req.headers.get("origin") && !cors) return err("Origin not allowed.", 403);

    // Community-zone page shells: the wrangler.toml routes put this worker in
    // front of the static site for /workshop/zones/* and /workshop/npc/* —
    // static files pass through to Pages; 404s for live community zones get
    // their ~1 KB shell synthesized from the stored manifest (zones.js).
    if (url.pathname.startsWith("/workshop/"))
      return zones.pageShell(req, env, url);

    // health goes through the normal path so CORS headers attach — the
    // Phase-2 client reads it cross-origin to measure the clock offset
    const handler = url.pathname === "/api/health"
      ? () => json({ ok: true, t: now() })
      : ROUTES[`${req.method} ${url.pathname}`];
    if (!handler) return err("Not found.", 404);

    let res;
    try { res = await handler(req, env, url); }
    catch (e) {
      console.log("unhandled:", url.pathname, e && e.stack || e);
      res = err("Something broke on our side.", 500);
    }
    // a 101 (live-presence WebSocket upgrade) has immutable headers and
    // needs no CORS — the browser doesn't apply CORS to WebSockets
    if (cors && res.status !== 101)
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      if (event.cron === "30 14 * * *") {
        // Phase-2 daily tick (~2:30 am NZT): validate stray summaries,
        // recompute percentile standings, sweep stale shop stock.
        await envelope.sweep(env);
        await ranks.recomputeAll(env);
        await shops.sweepStale(env);
        await shops.dailyTick(env);
        return;
      }
      await buildAndPostDigest(env);
      // Housekeeping: expired sessions + challenges, stale rate windows.
      await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now()).run();
      await env.DB.prepare("DELETE FROM webauthn_challenges WHERE expires_at < ?").bind(now()).run();
      await env.DB.prepare("DELETE FROM link_codes WHERE expires_at < ?").bind(now()).run();
      await env.DB.prepare("DELETE FROM rate_limits WHERE win_start < ?").bind(now() - 864e5).run();
    })());
  },
};
