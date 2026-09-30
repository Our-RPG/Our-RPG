#!/usr/bin/env node
// ===== Taiao Workshop — zone bake CLI =====
// The one-command CLI twin of the Zones tab's "Generate zone" button
// (bake-server.mjs) — for baking from a terminal (or scripting a batch of
// zones) instead of clicking through the UI. Runs the exact same five passes
// in the exact same order — bake-common.mjs's PASSES is the one shared
// source of truth with the button, so the two can't drift apart — then
// leaves the WHOLE studio consistent in one shot: zone page, refreshed zone
// index, NPC pages, quest visibility (quests need no index work of their own
// — they're computed client-side from the zone JSON).
//
//   node studio/tools/bake-zone.mjs --zx 1 --zy 0 [--fast] [--min 4500000]
//
// --fast   appends --nopois to the cities pass — skips per-POI name
//          generation (much faster; the baked zone just has no POIs).
// --min N  the shire-merge tile threshold (prerender-zone.mjs --mergeshires;
//          default 4,500,000, same default prerender-zone.mjs itself uses).
//
// Wall-clock, roughly (a real multi-core machine): terrain+features a
// minute or two; NPCs is the big one — 15-40 minutes (the real world-gen NPC
// pipeline, see zone-npcs.mjs); cities/merge/biomes a few minutes
// each. Budget the better part of an hour per zone end to end.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { PASSES, runPass, zonePage, refreshZoneIndex, STU } from "./bake-common.mjs";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const num = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 && argv[i + 1] != null ? Number(argv[i + 1]) : d; };
  return { zx: num("zx", NaN), zy: num("zy", NaN), fast: argv.includes("--fast"), min: num("min", null) };
}

// run a node script to completion, streaming its own stdout/stderr straight
// through (so the NPC-pipeline's own progress lines are still visible) while
// also capturing it in case a caller wants it (unused here, but cheap).
function runNodeScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath, ...(args || [])], { cwd: STU, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", d => { const s = d.toString(); out += s; process.stdout.write(s); });
    child.stderr.on("data", d => { const s = d.toString(); err += s; process.stderr.write(s); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(out) : reject(new Error(err.trim().split("\n").pop() || (path.basename(scriptPath) + " failed (exit " + code + ")"))));
  });
}

// recursively count files under dir whose name ends with `suffix` — used to
// count the "$<zx>.<zy>.html" NPC-instance pages this bake just produced.
function countFilesMatching(dir, suffix) {
  let n = 0, ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return 0; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += countFilesMatching(p, suffix);
    else if (e.name.endsWith(suffix)) n++;
  }
  return n;
}

const fmtMB = bytes => (bytes / 1048576).toFixed(1) + " MB";

async function main() {
  const { zx, zy, fast, min } = parseArgs(process.argv.slice(2));
  if (!Number.isInteger(zx) || !Number.isInteger(zy)) {
    console.error("Usage: node studio/tools/bake-zone.mjs --zx <n> --zy <n> [--fast] [--min <n>]");
    process.exit(1);
  }
  console.log(`Baking zone ${zx},${zy}${fast ? " — --fast: cities pass will skip POI generation" : ""}${min != null ? ` — merge threshold ${min}` : ""}`);
  const t0 = Date.now();

  for (const pass of PASSES) {
    const extra = fast && pass.flag === "--citiesonly" ? ["--nopois"]
      : pass.flag === "--mergeshires" && min != null ? ["--min", String(min)]
      : undefined;
    process.stdout.write(`\n[${pass.band[0]}–${pass.band[1]}%] ${pass.msg}${extra ? " (" + extra.join(" ") + ")" : ""}…\n`);
    let last = -1;
    await runPass(pass, zx, zy, pct => {
      const r = Math.round(pct);
      if (r !== last) { last = r; process.stdout.write(`\r  ${pass.msg} — ${r}%   `); }
    }, extra);
    process.stdout.write("\n");
  }

  const zonesDir = path.join(STU, "zones");
  fs.mkdirSync(zonesDir, { recursive: true });
  fs.writeFileSync(path.join(zonesDir, zx + "." + zy + ".html"), zonePage(zx, zy));
  const zoneList = refreshZoneIndex();

  console.log("\nRegenerating NPC pages + page shell (update-zone-index.mjs, gen_pages.mjs)…");
  const npcSuffix = "$" + zx + "." + zy + ".html";
  const beforeNpcPages = countFilesMatching(path.join(STU, "npc"), npcSuffix);
  await runNodeScript(path.join(TOOLS, "update-zone-index.mjs"));
  await runNodeScript(path.join(TOOLS, "gen_pages.mjs"));
  const afterNpcPages = countFilesMatching(path.join(STU, "npc"), npcSuffix);

  const manPath = path.join(STU, "assets/zones", `zone_${zx}_${zy}.json`);
  const pngPath = path.join(STU, "assets/zones", `zone_${zx}_${zy}.png`);
  let manSize = "?", pngSize = "?", npcCount = "?", cityCount = "?", monsterCount = "?";
  try { manSize = fmtMB(fs.statSync(manPath).size); } catch (_) {}
  try { pngSize = fmtMB(fs.statSync(pngPath).size); } catch (_) {}
  try {
    const man = JSON.parse(fs.readFileSync(manPath, "utf8"));
    npcCount = Array.isArray(man.npcs) ? man.npcs.length : "?";
    cityCount = Array.isArray(man.cities) ? man.cities.length : "?";
    monsterCount = Array.isArray(man.monsters) ? man.monsters.length : "?";
  } catch (_) {}

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log("\n" + "─".repeat(64));
  console.log(`Zone ${zx},${zy} baked in ${mins} min.`);
  console.log(`  terrain PNG:      ${pngPath}  (${pngSize})`);
  console.log(`  manifest JSON:    ${manPath}  (${manSize})`);
  console.log(`  NPCs / shires: ${npcCount} / ${cityCount}`);
  console.log(`  zone index now has ${zoneList.length} zone(s): ${zoneList.join(", ")}`);
  console.log(`  new static NPC pages: ${afterNpcPages - beforeNpcPages}  (zone total: ${afterNpcPages})`);
  console.log(`  zone page: studio/zones/${zx}.${zy}.html`);
  console.log("─".repeat(64));
  console.log("The studio is fully consistent locally now — zone page, NPC pages, quests");
  console.log("(quests read the zone JSON directly, no index step needed).");
  console.log("");
  console.log("To publish for good: node studio/tools/build_site.mjs + wrangler pages deploy");
  console.log("(see studio/DEPLOY.md). Committing the baked JSON under studio/assets/zones/ is");
  console.log("optional — tiles stay CDN-served either way.");
}
main().catch(e => { console.error("\nbake-zone FAILED:", e && e.message || e); process.exit(1); });
