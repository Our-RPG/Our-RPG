// ===== Taiao Workshop — local zone bake server =====
// A tiny Node server the studio's Zones tab talks to so "Generate zone" can bake
// a new zone (tables + overview) and persist its page — the static file server
// (python3 -m http.server) can't run the bake or write files itself.
//
//   Terminal 1:  python3 -m http.server 8899     (serve the game repo root)
//   Terminal 2:  node studio/tools/bake-server.mjs   (this — port 8898)
//
// The page opens an EventSource to  GET /bake?zx=<n>&zy=<n>  and receives SSE:
//   event: progress  data: {"pct":0-100,"msg":"…"}
//   event: warning   data: {"msg":"…"}   (non-fatal — bake still succeeded)
//   event: done      data: {}
//   event: error-msg data: {"msg":"…"}
// It runs prerender-zone.mjs's passes in sequence (terrain+features → NPCs →
// cities → monsters → merge shires → biomes), then writes studio/zones/<zx>.<zy>.html,
// refreshes the zone index, and regenerates the NPC pages (update-zone-index.mjs +
// gen_pages.mjs) — leaves the baked manifest/PNG in studio/assets/zones/. One
// bake at a time. Pass list + page template shared with bake-zone.mjs (the CLI
// twin) via bake-common.mjs.
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PASSES, runPass, zonePage, refreshZoneIndex, STU as STU_SHARED } from "./bake-common.mjs";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const STU = STU_SHARED;
const PORT = 8898;

let busy = false;   // one bake at a time

// run a node script to completion (no progress parsing — just pass/fail).
function runNodeScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath, ...(args || [])], { cwd: STU });
    let err = "";
    child.stderr.on("data", d => { err += d.toString(); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(err.trim().split("\n").pop() || (path.basename(scriptPath) + " failed (exit " + code + ")"))));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (url.pathname !== "/bake") { res.writeHead(404).end("not found"); return; }

  const zx = parseInt(url.searchParams.get("zx"), 10), zy = parseInt(url.searchParams.get("zy"), 10);
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
  const send = (event, data) => res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
  const fail = msg => { send("error-msg", { msg }); res.end(); };

  if (!Number.isInteger(zx) || !Number.isInteger(zy)) return fail("Bad zone coordinates.");
  if (busy) return fail("Another zone is already baking — one at a time.");
  busy = true;
  console.log(`[bake] zone ${zx},${zy} — starting`);
  let alive = true;
  req.on("close", () => { alive = false; });

  try {
    for (const pass of PASSES) {
      if (!alive) break;
      send("progress", { pct: pass.band[0], msg: pass.msg });
      await runPass(pass, zx, zy, pct => { if (alive) send("progress", { pct, msg: pass.msg }); });
    }
    if (!alive) { console.log(`[bake] zone ${zx},${zy} — client left; leaving manifest as-is`); return; }
    fs.mkdirSync(path.join(STU, "zones"), { recursive: true });
    fs.writeFileSync(path.join(STU, "zones", zx + "." + zy + ".html"), zonePage(zx, zy));
    // refresh the baked-zone index so the NPC & Quests tabs pick up the new zone's
    // NPCs/quests (they aggregate across every zone listed here).
    try { refreshZoneIndex(); } catch (_) {}
    send("progress", { pct: 100, msg: "wrote zones/" + zx + "." + zy + ".html" });
    // Also leave the NPC pages consistent: regenerate the zonenpc index (the
    // static npc/<snake>/<shire$zone>.html producer) and the page shell. Best-
    // effort — a failure here doesn't undo a perfectly good bake, it just means
    // the new zone's NPC pages need a manual `node studio/tools/update-zone-
    // index.mjs && node studio/tools/gen_pages.mjs` later, so it's a warning on
    // the stream rather than a fail() on the whole request.
    try {
      await runNodeScript(path.join(TOOLS, "update-zone-index.mjs"));
      await runNodeScript(path.join(TOOLS, "gen_pages.mjs"));
    } catch (e) {
      send("warning", { msg: "Bake succeeded, but NPC-page regen failed: " + (e && e.message || e) + " — run update-zone-index.mjs + gen_pages.mjs by hand." });
    }
    send("done", {});
    console.log(`[bake] zone ${zx},${zy} — done`);
  } catch (e) {
    console.error(`[bake] zone ${zx},${zy} — FAILED:`, e.message);
    fail(e.message || "Bake failed.");
  } finally {
    busy = false;
    if (alive) res.end();
  }
});

server.listen(PORT, () => console.log("Zone bake server on http://localhost:" + PORT + "  (POST/GET /bake?zx&zy)"));
