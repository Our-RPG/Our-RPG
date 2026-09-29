// ===== Taiao Workshop — gap manifest generator =====
// Finds game assets whose art is missing or weak — the trust-model hook in
// server/src/workshop.js: a PixelLab generation that FILLS one of these
// subjects skips voting and ships straight into everyone's game (see
// server/src/workshop.js submitProposal's auto-accept lane). This script is
// the thing that decides what counts as a "gap" in the first place.
//
//   node studio/tools/gen_gaps.mjs           writes studio/js/gaps-data.js, reports counts
//   node studio/tools/gen_gaps.mjs --push     also POSTs the subject list to
//                                             POST /api/admin/gaps (needs $ADMIN_TOKEN)
//   node studio/tools/gen_gaps.mjs --scan     ALSO drives headless Firefox over
//                                             studio/js/dupe-scan.js (the "declares
//                                             8 directions, wears one sprite in all
//                                             of them" audit — needs a live DOM +
//                                             loaded sheets, so it can't run in this
//                                             script's own vm) and merges its gaps in
//
// The vm loader is modelled on zone-npcs.mjs's boot() (studio/tools/
// zone-npcs.mjs:53-103) — no worldgen, no NPC naming, just enough of the game
// to get an accurate ITEMS/SPR/MONSTERS. Same gotcha applies: a top-level
// `const` a loaded script declares is NOT a property of the vm's sandbox
// object (only var/globalThis/window are), so the final runInContext call
// re-exports the globals we need onto globalThis before we read them from
// the host side.
import vm from "node:vm";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, "../../js");
const STU = path.resolve(HERE, "..");
const readGame = f => fs.readFileSync(path.join(GAME, f), "utf8");

// Every js/sprites/*.js file, in tools/bundle.list's real load order (falling
// back to alphabetical for anything bundle.list doesn't mention, e.g. a file
// only used by the studio). These are almost all small guarded IIFEs that
// register a few more SPR entries and/or flip a MONSTERS[x].dirSpr flag once
// that creature's/item's PixelLab art shipped (wild-dir-data.js, sheep-dir-
// data.js, shrimp-icons-data.js, …) — data.js + content.js alone only get the
// item/monster roster to the state it's in BEFORE any of those later patches
// land, which false-positives as "missing"/"needs-directions" for anything
// those patches cover. Loading the whole layer (best-effort — see boot())
// closes that gap instead of hand-picking files one false positive at a time.
function spriteFileOrder() {
  const bundle = fs.readFileSync(path.join(HERE, "../../tools/bundle.list"), "utf8")
    .split("\n").map(l => l.trim()).filter(l => l.startsWith("js/sprites/"))
    .map(l => l.slice("js/".length));
  const onDisk = fs.readdirSync(path.join(GAME, "sprites"))
    .filter(f => f.endsWith(".js")).map(f => "sprites/" + f).sort();
  const seen = new Set(bundle);
  return [...bundle, ...onDisk.filter(f => !seen.has(f))];
}

function boot() {
  // data.js defines SPR/ITEMS; content.js mutates both and builds MONSTERS
  // from them — must load in this order, before any js/sprites/*.js patch.
  const base = ["data.js", "content.js"];
  const ctx = {
    console, Math, JSON, Map, Set, WeakMap, Array, Object, String, Number, Boolean,
    Float32Array, Float64Array, Uint8Array, Uint8ClampedArray, Int32Array, Uint32Array, Int8Array, Int16Array, Uint16Array,
    isNaN, parseInt, parseFloat, Date,
    performance: { now: () => Date.now() },
  };
  ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  // Pre-declare the sheet-registry globals main/assets.js normally owns.
  // Most sprite files self-init these behind a `typeof X === "undefined"`
  // guard, but a couple (gear-icons-data.js, object-icons-hook.js) assume
  // SHEET_KEYS/SHEET_TILE already exist — `var` here (not const) makes them
  // real, writable sandbox globals every file's `typeof` check finds present.
  vm.runInContext(`var ASSET_DATA = {}, SHEET_KEYS = [], SHEET_TILE = {}, SHEET_OFFSET = {}, IMGS = {};`, ctx);
  vm.runInContext(base.map(readGame).join("\n;\n"), ctx, { timeout: 60000 });
  // Best-effort: each sprite file runs in its OWN try/catch so one file that
  // needs machinery we didn't stub (rare — a couple reference things outside
  // SPR/ITEMS/MONSTERS/ASSET_DATA/SHEET_*) just gets skipped and reported,
  // rather than a single bad file blanking the whole manifest.
  const skipped = [];
  for (const f of spriteFileOrder()) {
    try { vm.runInContext(readGame(f), ctx, { timeout: 20000 }); }
    catch (e) { skipped.push(f + " (" + (e && e.message || e) + ")"); }
  }
  vm.runInContext(`
    globalThis.SPR = (typeof SPR !== 'undefined') ? SPR : {};
    globalThis.ITEMS = (typeof ITEMS !== 'undefined') ? ITEMS : {};
    globalThis.MONSTERS = (typeof MONSTERS !== 'undefined') ? MONSTERS : {};
  `, ctx, { timeout: 10000 });
  if (skipped.length) console.warn("gen_gaps: skipped " + skipped.length + " sprite file(s) that need browser globals we don't stub:\n  " + skipped.join("\n  "));
  return ctx;
}

const ctx = boot();
const { SPR, ITEMS, MONSTERS } = ctx;
const gaps = [];

// missing-icon: the SPR key an item actually draws with (its `.icon`, or the
// bare item id when it has none) doesn't exist in SPR at all — there's no art
// to even fall back to, just whatever icon()'s "sheet not ready" blank shows.
for (const id of Object.keys(ITEMS)) {
  const sprKey = ITEMS[id].icon || id;
  if (!SPR[sprKey]) {
    gaps.push({ subject: "gen:ui:" + id, type: "ui", key: id, name: ITEMS[id].name || id, reason: "missing icon art" });
  }
}

// needs-directions: a monster stuck on ONE billboard sprite mirrored across
// all 8 facings (render3d.js _drawAtlasCell composites "mon_<kind>" from a
// single sprite when !dirSpr) — an honest "needs 8-direction art" label, not
// "missing" (it does have art). "_v"/"_baby"/"_v_baby" suffixed keys are
// giant/young variants that reuse their base creature's directional art
// (husbandry-animals.js, content.js) — not separate gaps even when present.
for (const key of Object.keys(MONSTERS)) {
  if (/(_v|_baby|_v_baby)$/.test(key)) continue;
  if (!MONSTERS[key].dirSpr) {
    gaps.push({ subject: "gen:monster:" + key, type: "monster", key, name: MONSTERS[key].name || key, reason: "has one sprite, needs 8-direction art" });
  }
}

// --scan: drive real headless Firefox over studio/js/dupe-scan.js (DupeScan.run)
// so the SERVER manifest (the auto-accept lane, once pushed) also carries the
// "declares 8 directions, wears one sprite in all of them" case — the studio's
// Needs-art hub already runs this in-browser (needs-art.js), but gen_gaps.mjs's
// own vm sandbox has no DOM/canvas to render into, so this drives a real page
// instead. Best-effort: puppeteer-core missing, the browser failing to launch,
// or the scan erroring all just skip the merge with a warning — never fail the
// whole gap-manifest write over it.
if (process.argv.slice(2).includes("--scan")) {
  const REPO = path.resolve(STU, "..");
  const PPT_ENTRY = path.join(REPO, "scratchpad/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js");
  const FIREFOX = "/Applications/Firefox.app/Contents/MacOS/firefox";
  const withTimeout = (p, ms, label) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label + " timed out after " + ms + "ms")), ms)),
  ]);
  const findFreePort = () => new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });

  console.log("gen_gaps --scan: auditing the dupe-direction case via headless Firefox…");
  let puppeteer = null;
  try { puppeteer = (await import(PPT_ENTRY)).default; }
  catch (e) { console.warn(`gen_gaps --scan: puppeteer-core not found at ${PPT_ENTRY} — skipping dupe scan (${e && e.message || e})`); }

  if (puppeteer) {
    const port = await findFreePort();
    // python3 -m http.server at the repo root — the studio's pages need the
    // game's ../../js/ tree reachable, exactly like the dev workflow (python3
    // -m http.server 8899 at repo root, see README).
    const py = spawn("python3", ["-m", "http.server", String(port), "-d", REPO], { stdio: "ignore" });
    let browser = null;
    try {
      await new Promise(r => setTimeout(r, 500));   // give the server a moment to bind
      browser = await puppeteer.launch({
        browser: "firefox",
        executablePath: FIREFOX,
        headless: true,
        protocol: "webDriverBiDi",
        // clean rendering on this host — no dark-mode/backplate munging the canvases
        extraPrefsFirefox: { "browser.display.document_color_use": 1, "browser.display.permit_backplate": false },
      });
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/studio/needs-art/index.html`, { waitUntil: "load", timeout: 60000 });
      await page.waitForFunction(() => typeof DupeScan !== "undefined", { timeout: 60000 });
      const scanGaps = await withTimeout(page.evaluate(() => DupeScan.run({})), 10 * 60 * 1000, "DupeScan.run()");
      console.log(`gen_gaps --scan: found ${scanGaps.length} dupe-direction gap(s).`);
      gaps.push(...scanGaps);
    } catch (e) {
      console.warn("gen_gaps --scan: scan failed — " + (e && e.message || e));
    } finally {
      if (browser) await browser.close();   // NEVER pkill Firefox globally — browser.close() only
      py.kill();
    }
  }
}

const generated = new Date().toISOString();
const out = `// AUTO-GENERATED by tools/gen_gaps.mjs — do not edit by hand.
// Feeds the studio's "Needs art" hub (studio/js/pages/needs-art.js) and, once
// pushed with --push, server/src/workshop.js's PixelLab auto-accept lane —
// a generation that fills one of these subjects skips voting and ships
// straight into the community layer.
"use strict";
const WORKSHOP_GAPS = ${JSON.stringify({ generated, gaps })};
`;
fs.writeFileSync(path.join(STU, "js/gaps-data.js"), out);

const byType = gaps.reduce((m, g) => ((m[g.type] = (m[g.type] || 0) + 1), m), {});
console.log(`wrote studio/js/gaps-data.js — ${gaps.length} gap(s): ` + JSON.stringify(byType));

if (process.argv.slice(2).includes("--push")) {
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
  if (!ADMIN_TOKEN) { console.error("--push needs the ADMIN_TOKEN env var set."); process.exit(1); }
  const server = (process.env.TAIAO_SERVER_URL || "https://our-rpg.com").replace(/\/+$/, "");
  console.log(`pushing ${gaps.length} subject(s) to ${server}/api/admin/gaps …`);
  try {
    const res = await fetch(server + "/api/admin/gaps", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + ADMIN_TOKEN },
      body: JSON.stringify({ subjects: gaps.map(g => g.subject) }),
    });
    const body = await res.text();
    console.log("server response:", res.status, body);
    if (!res.ok) process.exit(1);
  } catch (e) {
    console.error("push failed:", e && e.message || e);
    process.exit(1);
  }
}
