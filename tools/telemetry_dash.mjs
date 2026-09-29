// Taiao — telemetry insights dashboard generator.
//
//   node tools/telemetry_dash.mjs [--days 30] [--include-dev] [--demo] [--serve]
//
// Pulls gameplay-telemetry batches from the worker's admin API (see
// docs/telemetry.md), caches them under analytics/cache/ (immutable objects —
// refetches only what's new), reconstructs play sessions, computes insight
// aggregates (session lengths, quit context, time-to-first milestones, stall
// detection, activity share, combat/economy tables) and writes a fully
// self-contained analytics/dashboard.html — just open it in a browser.
//
// ADMIN token: ~/keys/taiao-admin-token.txt or $TAIAO_ADMIN_TOKEN.
// --demo skips the network and renders synthetic data (template testing).
// analytics/ is gitignored: batch payloads are player data and the repo is
// public — never commit them.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTDIR = path.join(ROOT, "analytics");
const CACHE = path.join(OUTDIR, "cache");
const SERVER = process.env.TAIAO_SERVER_URL_ADMIN || "https://our-rpg.com";

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DAYS = Math.max(1, parseInt(opt("--days", "30"), 10) || 30);
const INCLUDE_DEV = flag("--include-dev");
const DEMO = flag("--demo");

const RESUME_MS = 10 * 60 * 1000;   // refresh gap that still counts as one sitting
const STALL_MS = 180 * 1000;        // no progress this long while active = a stall
const QUIT_WINDOW_MS = 180 * 1000;  // "what were they doing when they quit"
const CELL = 32;                    // world-coordinate bucket for locations

// ---------------------------------------------------------------------------
// fetch layer
// ---------------------------------------------------------------------------
function adminToken() {
  if (process.env.TAIAO_ADMIN_TOKEN) return process.env.TAIAO_ADMIN_TOKEN.trim();
  const p = path.join(os.homedir(), "keys", "taiao-admin-token.txt");
  try { return readFileSync(p, "utf8").trim(); } catch (e) {
    console.error(`No admin token: set TAIAO_ADMIN_TOKEN or create ${p}`);
    process.exit(1);
  }
}

async function api(pathq, token) {
  const res = await fetch(SERVER + pathq, { headers: { authorization: "Bearer " + token } });
  if (!res.ok) throw new Error(`${pathq} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchBatches() {
  const token = adminToken();
  mkdirSync(CACHE, { recursive: true });
  const batches = [];
  const dayList = [];
  for (let i = 0; i < DAYS; i++)
    dayList.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));

  for (const day of dayList) {
    let cursor = null, keys = [];
    do {
      const q = `/api/admin/telemetry?day=${day}` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
      const r = await api(q, token);
      keys.push(...r.batches.map(b => b.key));
      cursor = r.cursor;
    } while (cursor);
    if (keys.length) console.log(`${day}: ${keys.length} batches`);

    // batches are immutable once written — the cache never needs invalidating
    let fetched = 0;
    const queue = [...keys];
    await Promise.all(Array.from({ length: 8 }, async () => {
      for (;;) {
        const key = queue.shift();
        if (!key) return;
        const cpath = path.join(CACHE, key.replace(/\//g, "__"));
        let text;
        if (existsSync(cpath)) text = readFileSync(cpath, "utf8");
        else {
          const res = await fetch(`${SERVER}/api/admin/telemetry?key=${encodeURIComponent(key)}`,
            { headers: { authorization: "Bearer " + token } });
          if (!res.ok) { console.error(`skip ${key}: ${res.status}`); continue; }
          text = await res.text();
          writeFileSync(cpath, text);
          fetched++;
        }
        try { batches.push(JSON.parse(text)); } catch (e) { console.error("bad json", key); }
      }
    }));
    if (fetched) console.log(`  fetched ${fetched} new`);
  }
  return batches;
}

// ---------------------------------------------------------------------------
// demo data (template testing without real players)
// ---------------------------------------------------------------------------
function demoBatches() {
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const SKILLS = ["Fishing", "Woodcutting", "Mining", "Cooking", "Smithing", "Farming", "Archery"];
  const MONS = ["rat", "kiwi_hunter", "boar", "cave_weta", "harrier"];
  const out = [];
  const N_DEV = 46;
  for (let d = 0; d < N_DEV; d++) {
    const device = "demo" + d;
    const nSes = 1 + Math.floor(rnd() * rnd() * 6);
    let base = Date.now() - Math.floor(rnd() * 12) * 864e5 - 6 * 3600e3;
    for (let s = 0; s < nSes; s++) {
      const ses = device + "-s" + s;
      const durMin = 2 + rnd() * rnd() * 110;
      const ev = [];
      let t = base, x = 4210 + Math.floor(rnd() * 60), y = -1290 + Math.floor(rnd() * 60);
      ev.push([t, "session", "start", "gdemo", 0]);
      const endT = t + durMin * 60e3;
      let lastProg = t;
      while (t < endT) {
        t += (2 + rnd() * 20) * 1000;
        const r = rnd();
        if (r < 0.45) { x += Math.round(rnd() * 3 - 1.5); y += Math.round(rnd() * 3 - 1.5); ev.push([t, "move", x, y, 0]); }
        else if (r < 0.6) { const sk = pick(SKILLS); ev.push([t, "xp", sk, 5 + rnd() * 30]); lastProg = t; }
        else if (r < 0.68) ev.push([t, "click", pick(["Walk here", "Chop", "Examine", "Take flax", "Attack rat", "Talk to Keeper"]), x, y]);
        else if (r < 0.74) ev.push([t, "goal", pick(["gather", "combat", "npc", "station", "pickup"]), pick(["tree_totara", "rat", "Keeper", "furnace", "flax"]), x, y]);
        else if (r < 0.79) { ev.push([t, "act", "skill:" + pick(SKILLS), Math.round(10 + rnd() * 200)]); }
        else if (r < 0.84) ev.push([t, "ui", pick(["map", "bestiary", "quests", "bank", "trade", "panel:skills"]), rnd() < 0.5 ? 1 : 0]);
        else if (r < 0.88) { ev.push([t, "kill", pick(MONS)]); lastProg = t; }
        else if (r < 0.9 && rnd() < 0.3) ev.push([t, "die", pick(MONS)]);
        else if (r < 0.93) { ev.push([t, "gain", pick(["logs", "flax", "raw_fish", "coins"]), 1 + Math.floor(rnd() * 3)]); lastProg = t; }
        else if (r < 0.95) ev.push([t, "talk", pick(["Keeper Torra", "Sigrid", "Aldric"]), "keeper"]);
        else if (r < 0.965) ev.push([t, pick(["buy", "sell"]), pick(["bread", "axe", "hide"]), 12, 1]);
        else if (r < 0.975) ev.push([t, "bank", pick(["dep", "wd"]), "logs", 5]);
        else if (r < 0.985) ev.push([t, "split", 2]);
        else ev.push([t, "cam", 1.6, 0]);
      }
      if (rnd() < 0.2) ev.push([endT, "die", pick(MONS)]);
      ev.push([endT + 1000, "session", "end"]);
      out.push({
        v: 1, user: null, username: null, device, char: 0, dev: 0, build: "gdemo",
        session: ses, seq: 1, sentAt: endT, recvAt: endT, country: "NZ", dropped: 0, events: ev,
      });
      base = endT + (4 + rnd() * 40) * 3600e3;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// aggregation
// ---------------------------------------------------------------------------
const dayOf = t => new Date(t).toISOString().slice(0, 10);
const cellOf = (x, y) => `${Math.round(x / CELL) * CELL},${Math.round(y / CELL) * CELL}`;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const pctl = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const PROGRESS = new Set(["xp", "gain", "kill", "buy", "sell", "bank", "split", "merge"]);
const ACTIVITY = new Set(["move", "click", "goal", "ui", "examine", "talk", "equip", "eat", "cam", "door", "ladder", "queue"]);

// human labels for quit/stall contexts
function ctxLabel(e) {
  const [, type, a, b] = e;
  if (type === "act") return a.startsWith("skill:") ? a.slice(6) : a === "combat" ? "Combat" : "Working (" + a.replace(/^act:/, "") + ")";
  if (type === "goal") return b ? `Heading to ${b}` : `Heading (${a})`;
  if (type === "ui") return "UI: " + a;
  if (type === "click") return "Clicking: " + a;
  if (type === "talk") return "Talking to " + a;
  if (type === "die") return "Died to " + a;
  if (type === "examine") return "Examining things";
  if (type === "move") return "Wandering";
  return type;
}

function aggregate(batches) {
  if (!INCLUDE_DEV) batches = batches.filter(b => !b.dev);
  // stitch batches into client sessions, then client sessions into sittings
  const byKey = new Map();
  for (const b of batches) {
    const k = b.device + "|" + (b.session || "?");
    let g = byKey.get(k);
    if (!g) byKey.set(k, g = { device: b.device, user: b.username || null, country: b.country, events: [] });
    g.events.push(...b.events.filter(e => Array.isArray(e) && Number.isFinite(e[0])));
  }
  const parts = [...byKey.values()].filter(g => g.events.length);
  for (const g of parts) {
    g.events.sort((a, b) => a[0] - b[0]);
    g.start = g.events[0][0];
    g.end = g.events[g.events.length - 1][0];
  }
  // merge same-device parts whose gap is a quick refresh
  const byDev = new Map();
  for (const p of parts) (byDev.get(p.device) || byDev.set(p.device, []).get(p.device)).push(p);
  const sittings = [];
  for (const [device, list] of byDev) {
    list.sort((a, b) => a.start - b.start);
    let cur = null;
    for (const p of list) {
      if (cur && p.start - cur.end < RESUME_MS) {
        cur.events.push(...p.events);
        cur.end = Math.max(cur.end, p.end);
        cur.user = cur.user || p.user;
      } else {
        if (cur) sittings.push(cur);
        cur = { device, user: p.user, country: p.country, events: [...p.events], start: p.start, end: p.end };
      }
    }
    if (cur) sittings.push(cur);
  }

  // per-sitting metrics
  const sessions = [];
  const acts = {};        // day -> kind -> sec
  const kills = {};       // day -> kind -> n
  const deaths = {};      // day -> by -> n
  const xpBy = {};        // day -> skill -> amt
  const trades = {};      // day -> "buy|id"/"sell|id" -> {n, coins}
  const stallRows = [];
  const dayBump = (obj, day, key, n) => {
    const d = obj[day] || (obj[day] = {});
    d[key] = (d[key] || 0) + n;
  };

  const devInfo = new Map(); // device -> {sittings:[], firstSeen}
  for (const s of sittings) {
    s.events.sort((a, b) => a[0] - b[0]);
    const day = dayOf(s.start);
    const min = Math.max(0.2, (s.end - s.start) / 60000);
    let xp = 0, nkill = 0, ndeath = 0, moves = 0, lastX = null, lastY = null, lastDie = null;
    let lastProg = s.start, stallStart = null, stallEvents = 0, stallCtx = null;

    for (const e of s.events) {
      const [t, type] = e;
      if (type === "xp") { xp += e[3] || 0; dayBump(xpBy, day, e[2], e[3] || 0); }
      else if (type === "kill") { nkill++; dayBump(kills, day, e[2] || "?", 1); }
      else if (type === "die") { ndeath++; lastDie = e; dayBump(deaths, day, e[2] || "?", 1); }
      else if (type === "move") { moves++; lastX = e[2]; lastY = e[3]; }
      else if (type === "act" && typeof e[2] === "string" && Number.isFinite(e[3]))
        dayBump(acts, day, e[2], e[3]);
      else if (type === "buy" || type === "sell") {
        const d = trades[day] || (trades[day] = {});
        const k = type + "|" + e[2];
        const rec = d[k] || (d[k] = { n: 0, coins: 0 });
        rec.n += e[4] || 1;
        rec.coins += (e[3] || 0) * (e[4] || 1);
      }

      // stall detection: activity continuing with no progress for STALL_MS
      if (PROGRESS.has(type)) {
        if (stallStart && stallEvents >= 5)
          stallRows.push({ day, ctx: stallCtx || "Wandering", cell: lastX != null ? cellOf(lastX, lastY) : null,
                           sec: Math.round((t - stallStart) / 1000) });
        lastProg = t; stallStart = null; stallEvents = 0; stallCtx = null;
      } else if (ACTIVITY.has(type)) {
        if (t - lastProg > STALL_MS) {
          if (!stallStart) { stallStart = lastProg; stallEvents = 0; }
          stallEvents++;
          if (type !== "move" && type !== "cam") stallCtx = ctxLabel(e);
        }
      }
    }
    if (stallStart && stallEvents >= 5)
      stallRows.push({ day, ctx: stallCtx || "Wandering", cell: lastX != null ? cellOf(lastX, lastY) : null,
                       sec: Math.round((s.end - stallStart) / 1000) });

    // quit context: the most telling event in the final window
    let quit = "Idle", qRank = -1;
    const RANK = { die: 6, act: 5, goal: 4, talk: 4, ui: 3, click: 2, examine: 2, move: 1 };
    for (const e of s.events) {
      if (s.end - e[0] > QUIT_WINDOW_MS) continue;
      const r = RANK[e[1]] || 0;
      if (r >= qRank && r > 0) { qRank = r; quit = ctxLabel(e); }
    }
    const diedBeforeQuit = lastDie && (s.end - lastDie[0]) < 120000;

    sessions.push({
      device: s.device, user: s.user, day, start: s.start,
      min: +min.toFixed(1), events: s.events.length, xp: Math.round(xp),
      kills: nkill, deaths: ndeath, moves,
      quit, dq: diedBeforeQuit ? 1 : 0,
      cell: lastX != null ? cellOf(lastX, lastY) : null,
    });
    let di = devInfo.get(s.device);
    if (!di) devInfo.set(s.device, di = { sittings: [] });
    di.sittings.push(s);
  }

  // per-device milestones: cumulative minutes of play until first <thing>
  const MS_DEFS = [
    ["first_xp", e => e[1] === "xp"],
    ["first_kill", e => e[1] === "kill"],
    ["first_talk", e => e[1] === "talk"],
    ["first_station", e => e[1] === "goal" && e[2] === "station"],
    ["first_equip", e => e[1] === "equip"],
    ["first_map", e => e[1] === "ui" && e[2] === "map" && e[3] === 1],
    ["first_bank", e => (e[1] === "ui" && e[2] === "bank") || e[1] === "bank"],
    ["first_trade", e => e[1] === "buy" || e[1] === "sell"],
    ["first_split", e => e[1] === "split"],
    ["first_queue", e => e[1] === "queue"],
    ["first_boat", e => e[1] === "goal" && e[2] === "board"],
  ];
  const devices = [];
  for (const [device, di] of devInfo) {
    di.sittings.sort((a, b) => a.start - b.start);
    const ms = {};
    let cum = 0;
    for (const s of di.sittings) {
      for (const e of s.events) {
        for (const [name, test] of MS_DEFS) {
          if (ms[name] == null && test(e)) ms[name] = +(cum + (e[0] - s.start) / 60000).toFixed(1);
        }
      }
      cum += (s.end - s.start) / 60000;
    }
    const days = [...new Set(di.sittings.map(s => dayOf(s.start)))];
    devices.push({ device, totalMin: +cum.toFixed(1), sessions: di.sittings.length,
                   days: days.length, firstDay: days.sort()[0], ms });
  }

  // first-session funnel
  const funnelDefs = [
    ["Started playing", () => true],
    ["Played ≥ 2 min", s => (s.end - s.start) >= 120000],
    ["Talked to an NPC", s => s.events.some(e => e[1] === "talk")],
    ["Earned any XP", s => s.events.some(e => e[1] === "xp")],
    ["Killed a monster", s => s.events.some(e => e[1] === "kill")],
    ["Played ≥ 15 min", s => (s.end - s.start) >= 900000],
    ["Came back later", null], // filled below
  ];
  const funnel = funnelDefs.map(([label]) => ({ label, n: 0 }));
  for (const [device, di] of devInfo) {
    const first = di.sittings[0];
    funnelDefs.forEach(([label, test], i) => {
      if (test ? test(first) : di.sittings.length > 1) funnel[i].n++;
    });
  }

  const msStats = MS_DEFS.map(([name]) => {
    const vals = devices.map(d => d.ms[name]).filter(v => v != null);
    return { name, reached: vals.length, of: devices.length,
             median: median(vals), p75: pctl(vals, 0.75) };
  });

  return {
    generatedAt: Date.now(), days: DAYS, includeDev: INCLUDE_DEV, demo: DEMO,
    sessions, devices: devices.map(({ device, ...rest }) => rest), // device ids stay out of the html
    msStats, funnel, acts, kills, deaths, xpBy, trades, stallRows,
  };
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------
async function main() {
  const batches = DEMO ? demoBatches() : await fetchBatches();
  console.log(`${batches.length} batches`);
  const data = aggregate(batches);
  console.log(`${data.sessions.length} sessions from ${data.devices.length} players`);
  const template = readFileSync(path.join(ROOT, "tools/telemetry_dash_template.html"), "utf8");
  const html = template.replace("/*__DATA__*/null", () => JSON.stringify(data));
  mkdirSync(OUTDIR, { recursive: true });
  const out = path.join(OUTDIR, "dashboard.html");
  writeFileSync(out, html);
  console.log(`wrote ${out}`);
}
main().catch(e => { console.error(e); process.exit(1); });
