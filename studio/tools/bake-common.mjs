// ===== Our RPG Workshop — shared zone-bake pieces =====
// The pass list, per-pass runner, and per-zone page template shared by
// bake-server.mjs (the Zones tab's "Generate zone" button — a local HTTP
// server) and bake-zone.mjs (its CLI twin: `node studio/tools/bake-zone.mjs
// --zx --zy`). One source of truth so the button and the CLI can never drift
// out of sync with each other — importing bake-server.mjs directly isn't an
// option (it starts listening on its port as a side effect of being loaded).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
export const STU = path.resolve(TOOLS, "..");
export const PRERENDER = path.join(TOOLS, "prerender-zone.mjs");

// the passes that reproduce a zone[0,0]-parity manifest + overview, with a rough
// progress band each (heaviest first). null flag = the default terrain+features bake.
// Monster spawns are NOT baked (dropped 2026-09-30): the zone pages never render
// them, and the pass was the second-heaviest. prerender-zone.mjs keeps its
// --monstersonly flag for anyone who wants the data on a manifest by hand.
export const PASSES = [
  { flag: null, band: [0, 10], msg: "terrain & features" },
  { flag: "--npcsonly", band: [10, 60], msg: "NPCs" },
  { flag: "--citiesonly", band: [60, 88], msg: "shire dossiers & POIs" },
  { flag: "--mergeshires", band: [88, 92], msg: "merging shires" },
  { flag: "--biomesonly", band: [92, 100], msg: "biome tile histograms" },
];

// spawn one pass of prerender-zone.mjs, scraping its stdout "NN%" progress
// into the pass's [band0,band1] slice of overall progress. extraArgs (e.g.
// bake-zone.mjs --fast's "--nopois") rides along after the pass's own flag.
export function runPass(pass, zx, zy, onPct, extraArgs) {
  return new Promise((resolve, reject) => {
    const args = [PRERENDER, "--zx", String(zx), "--zy", String(zy)];
    if (pass.flag) args.push(pass.flag);
    if (extraArgs && extraArgs.length) args.push(...extraArgs);
    const child = spawn("node", args, { cwd: STU });
    const scan = buf => {
      const s = buf.toString();
      const matches = [...s.matchAll(/(\d+)%/g)];
      if (matches.length) {
        const inner = Math.max(0, Math.min(100, +matches[matches.length - 1][1]));
        onPct(pass.band[0] + (inner / 100) * (pass.band[1] - pass.band[0]));
      }
    };
    child.stdout.on("data", scan);
    let err = "";
    child.stderr.on("data", d => { err += d.toString(); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error((err.trim().split("\n").pop()) || (pass.msg + " failed (exit " + code + ")"))));
  });
}

// same shell template gen_pages.mjs writes, so a bake-written page is identical.
const ICON = "<link rel=\"icon\" href=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%237c9cff'/%3E%3C/svg%3E\">";
export const zonePage = (zx, zy) =>
`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Our RPG Workshop — Zone ${zx},${zy}</title>
  ${ICON}
  <link rel="stylesheet" href="../css/studio.css">
</head>
<body>
  <noscript><p style="padding:2rem">Our RPG Workshop needs JavaScript.</p></noscript>
  <script>window.STUDIO_PAGE = ${JSON.stringify({ kind: "zones", tab: "zones", zx, zy })};</script>
  <script src="../js/page-loader.js"></script>
</body>
</html>
`;

// refresh studio/assets/zones/index.json from whatever zone_*.json manifests
// exist on disk (the NPC & Quests tabs aggregate across every zone listed
// here) — both the button and the CLI need this after a bake.
export function refreshZoneIndex() {
  const zdir = path.join(STU, "assets/zones");
  const list = fs.readdirSync(zdir)
    .map(f => /^zone_(-?\d+)_(-?\d+)\.json$/.exec(f))
    .filter(Boolean)
    .map(mm => mm[1] + "," + mm[2]);
  fs.writeFileSync(path.join(zdir, "index.json"), JSON.stringify(list));
  return list;
}
