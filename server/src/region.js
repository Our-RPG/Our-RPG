/* region.js — the Phase-2 region mutation ledger (audit §4, §7 Phase 2).
 * One Durable Object per world region holds the SHARED delta types:
 *
 *   node:x,y   resource node depletion/respawn
 *   decor:x,y  picked decoration
 *   heat:x,y   station heat
 *
 * Crops, placed furniture and door unlocks are PERSONAL by the Phase-2
 * sharing policy (griefing / no land claims yet) and never reach here.
 *
 * The ledger is latest-wins per record — exactly right for these types: a
 * node harvested twice is still one depleted node with the later respawn.
 * Server time is canonical for every shared timer: the DO stamps each
 * record with its own clock (`t`) and clamps the client-proposed expiry
 * (`e`, the respawn/cool-down horizon) into a sane window. Clients adopt
 * the returned records verbatim, so two players always agree on when a
 * tree grows back.
 *
 * The worker (index.js) authenticates the session and forwards to the DO
 * with a trusted x-taiao-user header; the DO itself trusts its caller.
 * Records are opaque small JSON values — the server enforces shape and
 * size, the client owns meaning. That keeps this file stable while the
 * game evolves. */

const TYPES = /^(node|decor):-?\d{1,7},-?\d{1,7}$|^heat:-?\d{1,7},-?\d{1,7},\d{1,2}$/;
const MAX_DELTAS_PER_PUSH = 200;
const MAX_VALUE_CHARS = 300;
const MAX_RECORDS = 8000;             // per region — a bound, not a target
const PER_USER_RECORDS = 1500;        // one account's share of that budget (anti-flood/grief)
const MAX_EXPIRY_AHEAD = 48 * 3600e3; // nothing shared outlives 48 h
const COMPACT_EVERY = 3600e3;
// Changelog: every push also writes a `c:<pad(seq)>` → tile-key entry so an
// incremental pull can read ONLY the records that changed after the client's
// cursor instead of scanning the whole region. Keys are zero-padded to sort
// lexicographically by seq; 16 digits covers the full safe-integer range.
const SEQ_PAD = 16;
const pad = n => String(n).padStart(SEQ_PAD, "0");

export class RegionLedger {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/push") return this.push(req);
    if (req.method === "GET" && url.pathname === "/pull") return this.pull(url);
    return new Response(JSON.stringify({ error: "Not found." }), { status: 404 });
  }

  /* Body: {deltas:[{k,v,e}]} — k typed tile key, v opaque JSON value,
   * e proposed expiry (unix ms). Returns the authoritative records so the
   * client adopts server time. A delta with v === null deletes the record
   * (node respawned early, heat died). */
  async push(req) {
    let body;
    try { body = await req.json(); } catch { return bad("Bad JSON."); }
    if (!body || !Array.isArray(body.deltas)) return bad("deltas required.");
    const by = Number(req.headers.get("x-taiao-user") || 0) || 0;
    const now = Date.now();

    const stored = [];
    await this.ctx.storage.transaction(async txn => {
      let seq = (await txn.get("seq")) || 0;
      let count = (await txn.get("count")) || 0;
      // Per-user share of this region's record budget (anti-flood): every delta
      // in a push carries the same authenticated `by`, so one counter suffices.
      // Reconciled hourly in alarm() so expiry can't drift it upward and wrongly
      // lock a user out.
      let myCount = by ? ((await txn.get("uc:" + by)) || 0) : 0;
      // clogFrom: the first seq ever covered by the changelog (undefined on
      // regions whose last write predates this change — those keep full-scanning
      // until a push starts their changelog). firstClog is the first seq we
      // write a c: entry for in THIS push.
      let clogFrom = await txn.get("clogFrom");
      let firstClog = null;
      for (const d of body.deltas.slice(0, MAX_DELTAS_PER_PUSH)) {
        const k = String(d?.k || "");
        if (!TYPES.test(k)) continue;
        const key = "r:" + k;
        if (d.v === null) {                       // explicit clear
          const had = await txn.get(key);
          // Anti-grief: one account can't wipe another's still-live record
          // (mass-clearing / clearing others' depletions to re-farm). Your own
          // records, ownerless legacy ones, and already-healed ones stay clearable.
          if (had && had.by && by && had.by !== by && (had.e || 0) > now) continue;
          if (had) {
            count--;
            if (had.by === by && myCount > 0) myCount--;
            await txn.delete(key);
          }
          seq++;
          const rec = { k, seq, t: now, e: now, v: null };
          await txn.put("t:" + k, rec);           // tombstone so pulls see it
          await txn.put("c:" + pad(seq), k);      // changelog: this seq changed k
          if (firstClog === null) firstClog = seq;
          stored.push(rec);
          continue;
        }
        let v;
        try { v = JSON.stringify(d.v); } catch { continue; }
        if (v.length > MAX_VALUE_CHARS) continue;
        const had = await txn.get(key);
        if (!had && count >= MAX_RECORDS) continue;
        if (!had && by && myCount >= PER_USER_RECORDS) continue;   // per-user share cap (anti-flood)
        if (!had) { count++; if (by) myCount++; }
        seq++;
        const e = Math.min(Math.max(Number(d.e) || now, now), now + MAX_EXPIRY_AHEAD);
        const rec = { k, seq, t: now, e, v: d.v, by };
        await txn.put(key, rec);
        await txn.delete("t:" + k);
        await txn.put("c:" + pad(seq), k);        // changelog: this seq changed k
        if (firstClog === null) firstClog = seq;
        stored.push(rec);
      }
      await txn.put("seq", seq);
      await txn.put("count", count);
      if (by) await txn.put("uc:" + by, Math.max(0, myCount));
      // stamp where this region's changelog began, once, so pulls know the
      // lower bound of the fast path (older cursors fall back to the full scan)
      if (clogFrom == null && firstClog != null) await txn.put("clogFrom", firstClog);
    });

    if (!(await this.ctx.storage.getAlarm()))
      await this.ctx.storage.setAlarm(now + COMPACT_EVERY);
    return ok({ ok: true, now, records: stored });
  }

  /* /pull?since=N — every record (and tombstone) with seq > since, plus the
   * region's cursor. since=0 is the login full-state pull; expired records
   * are skipped there (the world already healed). */
  async pull(url) {
    const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
    const now = Date.now();
    const seq = (await this.ctx.storage.get("seq")) || 0;
    const deltas = [];
    if (seq > since) {
      // Fast incremental path: when the client's cursor is within the changelog's
      // coverage, read only the c: entries after it and resolve each to its
      // CURRENT record (r:/t:) — identical to what the scan would return (latest
      // per key), but O(changes) instead of O(region). The since===0 login pull
      // and any cursor predating the changelog (old regions, or a pre-change
      // last write) fall back to the full r:/t: scan, so no migration is needed.
      let clogFrom = null;
      if (since > 0) clogFrom = await this.ctx.storage.get("clogFrom");
      if (clogFrom != null && since + 1 >= clogFrom) {
        const clog = await this.ctx.storage.list({ prefix: "c:", start: "c:" + pad(since + 1) });
        const seen = new Set();
        for (const k of clog.values()) {           // values are the changed tile keys
          if (seen.has(k)) continue;               // one current record per key (latest-wins)
          seen.add(k);
          // resolve to the key's current state; a key compacted away (both gone)
          // simply isn't returned, matching the scan path
          const rec = (await this.ctx.storage.get("r:" + k)) ||
                      (await this.ctx.storage.get("t:" + k));
          if (rec && rec.seq > since) deltas.push(rec);
        }
      } else {
        for (const prefix of ["r:", "t:"]) {
          const map = await this.ctx.storage.list({ prefix });
          for (const rec of map.values()) {
            if (rec.seq <= since) continue;
            if (since === 0 && rec.e <= now) continue;   // healed — irrelevant on a fresh pull
            deltas.push(rec);
          }
        }
      }
      deltas.sort((a, b) => a.seq - b.seq);
    }
    return ok({ ok: true, now, seq, deltas });
  }

  /* Hourly compaction: drop records past their expiry (the world healed —
   * absence of a record IS the default state) and stale tombstones. */
  async alarm() {
    const now = Date.now();
    let removed = 0, remaining = 0;
    const byCount = new Map();                     // live r: records per owner
    for (const prefix of ["r:", "t:"]) {
      const map = await this.ctx.storage.list({ prefix });
      for (const [key, rec] of map) {
        if (rec.e <= now - 60e3) { await this.ctx.storage.delete(key); removed++; }
        else if (prefix === "r:") {
          remaining++;
          if (rec.by) byCount.set(rec.by, (byCount.get(rec.by) || 0) + 1);
        }
      }
    }
    const count = (await this.ctx.storage.get("count")) || 0;
    if (count !== remaining) await this.ctx.storage.put("count", remaining);
    // Reconcile the per-user share counters (uc:<id>) against reality so expiry
    // can't drift them upward — a stale over-count would wrongly lock a user out.
    const ucMap = await this.ctx.storage.list({ prefix: "uc:" });
    for (const [key, val] of ucMap) {
      const uid = Number(key.slice(3)) || 0;
      const real = byCount.get(uid) || 0;
      byCount.delete(uid);
      if (real === 0) await this.ctx.storage.delete(key);
      else if (real !== val) await this.ctx.storage.put(key, real);
    }
    for (const [uid, real] of byCount)             // owners without an existing uc: key
      await this.ctx.storage.put("uc:" + uid, real);
    if (remaining || removed === 0)
      await this.ctx.storage.setAlarm(now + COMPACT_EVERY);
  }
}

const ok = data => new Response(JSON.stringify(data),
  { headers: { "content-type": "application/json; charset=utf-8" } });
const bad = m => new Response(JSON.stringify({ error: m }), { status: 400,
  headers: { "content-type": "application/json; charset=utf-8" } });

// ---- worker-side routes (run in index.js, not in the DO) ------------------

import { err, authUser, rateLimit } from "./util.js";

const REGION_KEY = /^-?\d{1,5},-?\d{1,5}$/;
const MAX_REGIONS_PER_PULL = 9;       // the 3×3 around the player

function stub(env, key) {
  return env.REGION.get(env.REGION.idFromName(key));
}

export async function pushDeltas(req, env, url) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  const region = String(url.searchParams.get("r") || "");
  if (!REGION_KEY.test(region)) return err("Bad region key.");
  if (!await rateLimit(env, `region-push:${user.id}`, 240, 3600))
    return err("Syncing too fast — the ledger is async by design.", 429);
  const res = await stub(env, region).fetch("https://region/push", {
    method: "POST",
    headers: { "x-taiao-user": String(user.id) },
    body: req.body,
  });
  return new Response(res.body, res);
}

/* /api/region/pull?rs=x1,y1:since1;x2,y2:since2 — batched nearby regions. */
export async function pullDeltas(req, env, url) {
  const user = await authUser(req, env);
  if (!user) return err("Not logged in.", 401);
  if (!await rateLimit(env, `region-pull:${user.id}`, 360, 3600))
    return err("Syncing too fast — the ledger is async by design.", 429);
  const parts = String(url.searchParams.get("rs") || "").split(";").filter(Boolean);
  if (!parts.length || parts.length > MAX_REGIONS_PER_PULL) return err("1-9 regions per pull.");
  const regions = {};
  await Promise.all(parts.map(async part => {
    const [key, since] = part.split(":");
    if (!REGION_KEY.test(key || "")) return;
    const res = await stub(env, key).fetch(
      "https://region/pull?since=" + (Number(since) || 0));
    regions[key] = await res.json();
  }));
  return new Response(JSON.stringify({ ok: true, regions }),
    { headers: { "content-type": "application/json; charset=utf-8" } });
}
