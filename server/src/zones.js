/* zones.js — community-baked zones (migrations/0008).
 *
 * The Workshop's Zones tab can now GENERATE an unbaked zone in the player's
 * own browser (studio/js/zone-bake.js runs the real world engine in web
 * workers) and publish the result here, so the whole community views that
 * zone for good without regenerating. The server never runs world-gen — it
 * is a durable status board + artifact store:
 *
 *   claim      → take (or resume) the bake lease for a zone
 *   progress   → heartbeat: stage/pct/msg, renews the lease. Anyone can WATCH
 *                a bake via state/index; a stale lease (tab closed) lets any
 *                other signed-in player pick up where it left off — the bake
 *                checkpoints below are the resume state.
 *   checkpoint → PUT/GET partial artifacts in R2 (zonebake/<zx>_<zy>/<kind>):
 *                manifest.json (patched after each pass, exactly like the
 *                node pipeline patches its on-disk manifest), map.png,
 *                npcs.json + monsters.json (mid-pass partials for the two
 *                long passes), pages.json (npc id→name index).
 *   publish    → light-validate + move artifacts to zones/<zx>_<zy>/*,
 *                flip the row live, drop the checkpoints.
 *   index/state/manifest/map → public reads the Zones/NPC/Quests tabs use.
 *
 * "NPC & quest pages stored efficiently": no HTML is ever stored. A zone's
 * NPC pages and quest pages are all derived views over the ONE manifest —
 * pageShell() below synthesizes the tiny static-page shell on request (same
 * template gen_pages.mjs writes) for /workshop/zones/<x>.<y>.html and
 * /workshop/npc/<snake>/<shire>$<x>.<y>.html, using pages.json only for the
 * page title + 404 correctness. Quest pages need no shells at all (quest
 * detail is the dynamic quests/quest.html?id= page, reading the manifest).
 * Requires the wrangler.toml routes our-rpg.com/workshop/zones/* and
 * our-rpg.com/workshop/npc/* — static files pass straight through to Pages;
 * only 404s for live community zones get a synthesized shell. */

import { json, err, readJson, now, authUser, rateLimit } from "./util.js";

const LEASE_MS = 3 * 60 * 1000;          // heartbeat every ~30s; 3 min silence = abandoned
const COORD_MAX = 100;                    // |zx|,|zy| cap — plenty of world, bounds the keyspace
const KINDS = {                           // checkpoint kinds → R2 filename + size cap
  manifest: { file: "manifest.json", type: "application/json", max: 16 * 1024 * 1024 },
  map:      { file: "map.png",       type: "image/png",        max: 12 * 1024 * 1024 },
  npcs:     { file: "npcs.json",     type: "application/json", max: 10 * 1024 * 1024 },
  monsters: { file: "monsters.json", type: "application/json", max: 10 * 1024 * 1024 },
  pages:    { file: "pages.json",    type: "application/json", max: 2 * 1024 * 1024 },
};

const zoneOk = v => Number.isInteger(v) && Math.abs(v) <= COORD_MAX;
const bakeKey = (zx, zy, file) => `zonebake/${zx}_${zy}/${file}`;
const liveKey = (zx, zy, file) => `zones/${zx}_${zy}/${file}`;
const getRow = (env, zx, zy) =>
  env.DB.prepare("SELECT * FROM community_zones WHERE zx = ? AND zy = ?").bind(zx, zy).first();

function coords(url) {
  const zx = Number(url.searchParams.get("zx")), zy = Number(url.searchParams.get("zy"));
  return (zoneOk(zx) && zoneOk(zy)) ? { zx, zy } : null;
}
// public projection of a row (never leak user ids)
function pub(r) {
  return {
    zx: r.zx, zy: r.zy, status: r.status, stage: r.stage, pct: r.pct, msg: r.msg || "",
    by: r.holder_name || null, leaseActive: r.lease_until > now(),
    contributors: safeParse(r.contributors) || [],
    npcs: r.npc_count, cities: r.city_count, monsters: r.monster_count, quests: r.quest_count,
    updatedAt: r.updated_at, publishedAt: r.published_at,
  };
}
const safeParse = s => { try { return JSON.parse(s); } catch { return null; } };

/* ---- public reads ------------------------------------------------------- */

// Every community zone — live ones (the NPC/Quests tabs aggregate across
// these) and in-flight bakes (the Zones tab shows their live progress).
export async function index(req, env) {
  const rows = (await env.DB.prepare(
    "SELECT * FROM community_zones ORDER BY (status = 'live') DESC, updated_at DESC LIMIT 200"
  ).all()).results;
  return json({ ok: true, zones: rows.map(pub) }, 200, { "cache-control": "no-store" });
}

export async function state(req, env, url) {
  const c = coords(url); if (!c) return err("Bad zone coordinates.");
  const row = await getRow(env, c.zx, c.zy);
  return json({ ok: true, zone: row ? pub(row) : null }, 200, { "cache-control": "no-store" });
}

// The published manifest / map image. Immutable once live, so cache hard.
export async function manifest(req, env, url) {
  const c = coords(url); if (!c) return err("Bad zone coordinates.");
  const obj = await env.VAULT.get(liveKey(c.zx, c.zy, "manifest.json"));
  if (!obj) return err("Zone not baked.", 404);
  return new Response(obj.body, { headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=86400",
  } });
}
export async function mapImage(req, env, url) {
  const c = coords(url); if (!c) return err("Bad zone coordinates.");
  const obj = await env.VAULT.get(liveKey(c.zx, c.zy, "map.png"));
  if (!obj) return err("Zone not baked.", 404);
  return new Response(obj.body, { headers: {
    "content-type": "image/png",
    "cache-control": "public, max-age=86400",
  } });
}

/* ---- the bake lease ----------------------------------------------------- */

// Take (or resume) the bake for a zone. Succeeds when the zone is unbaked, or
// its bake lease is stale (holder's tab closed), or the caller already holds
// it. Returns the resume state: stage/pct + which checkpoints exist in R2.
export async function claim(req, env) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `zoneclaim:${user.id}`, 30, 86400))
    return err("Too many bake claims today.", 429);
  const b = await readJson(req);
  const zx = Number(b?.zx), zy = Number(b?.zy);
  if (!zoneOk(zx) || !zoneOk(zy)) return err("Bad zone coordinates.");
  const t = now();
  const row = await getRow(env, zx, zy);
  if (row && row.status === "live") return err("Zone already baked.", 409);
  if (row && row.lease_until > t && row.holder_user_id !== user.id)
    return json({ error: "held", zone: pub(row) }, 409);
  if (!row) {
    await env.DB.prepare(
      `INSERT INTO community_zones (zx, zy, status, stage, pct, msg, holder_user_id, holder_name, lease_until, contributors, created_at, updated_at)
       VALUES (?,?,'baking',0,0,'claimed',?,?,?,?,?,?)`
    ).bind(zx, zy, user.id, user.username, t + LEASE_MS, JSON.stringify([user.username]), t, t).run();
  } else {
    const contrib = safeParse(row.contributors) || [];
    if (!contrib.includes(user.username)) contrib.push(user.username);
    // guarded update: don't steal a lease renewed between our read and write
    const r = await env.DB.prepare(
      `UPDATE community_zones SET holder_user_id = ?, holder_name = ?, lease_until = ?, contributors = ?, updated_at = ?
       WHERE zx = ? AND zy = ? AND status = 'baking' AND (lease_until <= ? OR holder_user_id = ?)`
    ).bind(user.id, user.username, t + LEASE_MS, JSON.stringify(contrib), t, zx, zy, t, user.id).run();
    if (!r.meta.changes) {
      const cur = await getRow(env, zx, zy);
      return json({ error: "held", zone: cur ? pub(cur) : null }, 409);
    }
  }
  // which checkpoints already exist (a resumed bake downloads these)
  const have = {};
  for (const kind of Object.keys(KINDS))
    have[kind] = !!(await env.VAULT.head(bakeKey(zx, zy, KINDS[kind].file)));
  const cur = await getRow(env, zx, zy);
  return json({ ok: true, zone: pub(cur), checkpoints: have });
}

// resolve the caller as the CURRENT lease holder of a baking zone (or null)
async function heldRow(req, env, zx, zy) {
  const user = await authUser(req, env);
  if (!user) return { fail: err("Not logged in.", 401) };
  if (!zoneOk(zx) || !zoneOk(zy)) return { fail: err("Bad zone coordinates.") };
  const row = await getRow(env, zx, zy);
  if (!row || row.status !== "baking") return { fail: err("No bake in progress for this zone.", 409) };
  if (row.holder_user_id !== user.id) return { fail: err("Another player holds this bake now.", 409) };
  return { user, row };
}

// Heartbeat: live stage/pct/msg for everyone watching, and the lease renewal.
export async function progress(req, env) {
  const b = await readJson(req);
  const zx = Number(b?.zx), zy = Number(b?.zy);
  const h = await heldRow(req, env, zx, zy);
  if (h.fail) return h.fail;
  const stage = Math.max(0, Math.min(6, Number(b?.stage) || 0));
  const pct = Math.max(0, Math.min(100, Number(b?.pct) || 0));
  const msg = String(b?.msg || "").slice(0, 200);
  const t = now();
  await env.DB.prepare(
    "UPDATE community_zones SET stage = ?, pct = ?, msg = ?, lease_until = ?, updated_at = ? WHERE zx = ? AND zy = ?"
  ).bind(stage, pct, msg, t + LEASE_MS, t, zx, zy).run();
  return json({ ok: true });
}

/* ---- checkpoints (R2 partial artifacts) --------------------------------- */

export async function putCheckpoint(req, env, url) {
  const c = coords(url); if (!c) return err("Bad zone coordinates.");
  const kind = KINDS[url.searchParams.get("kind")];
  if (!kind) return err("Bad checkpoint kind.");
  const h = await heldRow(req, env, c.zx, c.zy);
  if (h.fail) return h.fail;
  const len = Number(req.headers.get("content-length") || 0);
  if (!len || len > kind.max) return err("Checkpoint too large.", 413);
  const body = await req.arrayBuffer();
  if (body.byteLength > kind.max) return err("Checkpoint too large.", 413);
  await env.VAULT.put(bakeKey(c.zx, c.zy, kind.file), body, { httpMetadata: { contentType: kind.type } });
  const t = now();   // an upload is as good as a heartbeat
  await env.DB.prepare(
    "UPDATE community_zones SET lease_until = ?, updated_at = ? WHERE zx = ? AND zy = ?"
  ).bind(t + LEASE_MS, t, c.zx, c.zy).run();
  return json({ ok: true, bytes: body.byteLength });
}

// Resume download — the holder pulling its own (or a predecessor's) partials.
export async function getCheckpoint(req, env, url) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const c = coords(url); if (!c) return err("Bad zone coordinates.");
  const kind = KINDS[url.searchParams.get("kind")];
  if (!kind) return err("Bad checkpoint kind.");
  const obj = await env.VAULT.get(bakeKey(c.zx, c.zy, kind.file));
  if (!obj) return err("No such checkpoint.", 404);
  return new Response(obj.body, { headers: { "content-type": kind.type, "cache-control": "no-store" } });
}

/* ---- publish ------------------------------------------------------------ */

export async function publish(req, env) {
  const b = await readJson(req);
  const zx = Number(b?.zx), zy = Number(b?.zy);
  const h = await heldRow(req, env, zx, zy);
  if (h.fail) return h.fail;
  const manObj = await env.VAULT.get(bakeKey(zx, zy, "manifest.json"));
  if (!manObj) return err("No manifest checkpoint to publish.", 409);
  let man;
  try { man = JSON.parse(await manObj.text()); } catch { return err("Manifest checkpoint is not valid JSON.", 422); }
  // light structural validation — same shape the static zone_<x>_<y>.json bakes have
  if (!man || !man.meta || man.meta.zx !== zx || man.meta.zy !== zy)
    return err("Manifest meta does not match this zone.", 422);
  for (const k of ["npcs", "cities", "monsters"])
    if (!Array.isArray(man[k])) return err("Manifest is missing its " + k + " pass.", 422);
  if (!man.feat || !Array.isArray(man.feat.villages)) return err("Manifest is missing its features pass.", 422);
  const mapObj = await env.VAULT.get(bakeKey(zx, zy, "map.png"));
  if (!mapObj) return err("No map image checkpoint to publish.", 409);
  const pagesObj = await env.VAULT.get(bakeKey(zx, zy, "pages.json"));

  await env.VAULT.put(liveKey(zx, zy, "manifest.json"), JSON.stringify(man), { httpMetadata: { contentType: "application/json" } });
  await env.VAULT.put(liveKey(zx, zy, "map.png"), await mapObj.arrayBuffer(), { httpMetadata: { contentType: "image/png" } });
  if (pagesObj) await env.VAULT.put(liveKey(zx, zy, "pages.json"), await pagesObj.arrayBuffer(), { httpMetadata: { contentType: "application/json" } });

  const quests = Number(b?.quests) || (man.npcs.filter(n => n.role === "quest-giver" || n.role === "quest-anchor").length);
  const t = now();
  await env.DB.prepare(
    `UPDATE community_zones SET status = 'live', stage = 6, pct = 100, msg = 'published',
       npc_count = ?, city_count = ?, monster_count = ?, quest_count = ?, published_at = ?, updated_at = ?
     WHERE zx = ? AND zy = ?`
  ).bind(man.npcs.length, man.cities.length, man.monsters.length, quests, t, t, zx, zy).run();
  for (const kind of Object.values(KINDS)) await env.VAULT.delete(bakeKey(zx, zy, kind.file));
  return json({ ok: true, npcs: man.npcs.length, cities: man.cities.length, monsters: man.monsters.length });
}

/* ---- synthesized page shells -------------------------------------------- */
/* The same shell template tools/gen_pages.mjs writes (site mode: one prebuilt
 * dist/workshop-bundle.js), so a community zone's pages are byte-equivalent in
 * behaviour to a statically baked zone's. Nothing is stored — the shell is
 * ~1 KB derived from the request path + the zone's pages.json. */

const ICON = "<link rel=\"icon\" href=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%23060a08'/%3E%3Cpath d='M20 44 Q42 20 60 30 T92 22' stroke='%238f7ef0' stroke-width='5' fill='none' opacity='.55' stroke-linecap='round'/%3E%3Cpath d='M10 62 Q34 34 54 46 T94 38' stroke='%2356e39f' stroke-width='8' fill='none' stroke-linecap='round'/%3E%3Cpath d='M6 80 Q36 54 60 64 T96 58' stroke='%233ec6c0' stroke-width='5' fill='none' opacity='.75' stroke-linecap='round'/%3E%3Crect x='74' y='10' width='6' height='6' fill='%23eae4d2'/%3E%3Crect x='24' y='16' width='4' height='4' fill='%23eae4d2' opacity='.7'/%3E%3C/svg%3E\">";

function shellHtml(title, root, cfg) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title ? "Our RPG Workshop — " + title : "Our RPG Workshop"}</title>
  ${ICON}
  <link rel="stylesheet" href="${root}css/studio.css">
</head>
<body>
  <noscript><p style="padding:2rem">Our RPG Workshop needs JavaScript.</p></noscript>
  <script>window.STUDIO_ROOT = ${JSON.stringify(root)}; window.STUDIO_PAGE = ${JSON.stringify(cfg)};</script>
  <script src="${root}dist/workshop-bundle.js"></script>
</body>
</html>
`;
}
const htmlResp = html => new Response(html, { headers: {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=3600",
} });

// zone must be published for its shells to exist
async function liveZoneRow(env, zx, zy) {
  if (!zoneOk(zx) || !zoneOk(zy)) return null;
  const row = await getRow(env, zx, zy);
  return row && row.status === "live" ? row : null;
}

/* Route handler for our-rpg.com/workshop/zones/* and /workshop/npc/* : static
 * assets pass through to Pages untouched; a 404 that names a live community
 * zone gets its shell synthesized. Never touches /api/*. */
export async function pageShell(req, env, url) {
  // pass through to the static site first (the worker route sits IN FRONT of
  // Pages; a same-zone subrequest goes to the origin, not back to this worker)
  if (req.method !== "GET" && req.method !== "HEAD") return fetch(req);
  if (req.headers.get("x-ourrpg-shell")) return err("Not found.", 404);   // belt: never recurse
  const fwd = new Request(req, { headers: new Headers(req.headers) });
  fwd.headers.set("x-ourrpg-shell", "1");
  let origin;
  try { origin = await fetch(fwd); } catch { origin = null; }
  if (origin && origin.status !== 404) return origin;

  // /workshop/zones/<zx>.<zy>.html → the per-zone page
  let m = /^\/workshop\/zones\/(-?\d+)\.(-?\d+)\.html$/.exec(url.pathname);
  if (m) {
    const zx = Number(m[1]), zy = Number(m[2]);
    if (await liveZoneRow(env, zx, zy))
      return htmlResp(shellHtml(`Zone ${zx},${zy}`, "../", { kind: "zones", tab: "zones", zx, zy }));
    return origin || err("Not found.", 404);
  }

  // /workshop/npc/<spriteSnake>/<shire>$<zx>.<zy>.html → a baked NPC's page
  m = /^\/workshop\/npc\/([^/]+)\/([^/]+)\$(-?\d+)\.(-?\d+)\.html$/.exec(url.pathname);
  if (m) {
    const zx = Number(m[3]), zy = Number(m[4]);
    const id = `${m[1]}$${m[2]}$${m[3]}.${m[4]}`;
    if (await liveZoneRow(env, zx, zy)) {
      // pages.json: [{id, name}] — the page title + proof the NPC exists
      let name = null;
      const pagesObj = await env.VAULT.get(liveKey(zx, zy, "pages.json"));
      if (pagesObj) {
        const pages = safeParse(await pagesObj.text());
        const hit = pages && Array.isArray(pages.npcs) && pages.npcs.find(p => p && p.id === id);
        if (hit) name = hit.name || null;
      }
      if (name != null || !pagesObj)   // no pages.json at all → serve anyway (page 404s client-side if bogus)
        return htmlResp(shellHtml(name || `Zone ${zx},${zy} NPC`, "../../",
          { kind: "npc", tab: "npc", zone: `${zx},${zy}`, id }));
    }
    return origin || err("Not found.", 404);
  }
  return origin || err("Not found.", 404);
}
