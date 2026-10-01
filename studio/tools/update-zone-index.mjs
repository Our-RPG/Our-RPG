// ===== Taiao Workshop — zonenpc index producer =====
// items-index.json's `zonenpc` array is what gen_pages.mjs reads to emit one
// static page per baked NPC instance (npc/<spriteSnake>/<shire$zone>.html —
// see gen_pages.mjs:138-144). Nothing in the repo REGENERATES that array —
// it was hand-baked once and never had a producer script. This is that
// producer: scan every baked zone manifest (studio/assets/zones/zone_*.json)
// and reproduce each npcs[] entry's id exactly the way the game (and the
// studio's Roster catalog) derives it, so the static NPC pages stay in sync
// as new zones get baked.
//
//   node studio/tools/update-zone-index.mjs [--dry] [--force]
//
// --force   skip the sanity-check abort below (still prints the overlap
//           %) — for a deliberate, world-wide rename (e.g. the settlement
//           name-pool swap in js/world/features.js NAME_A/NAME_B), which
//           legitimately drops the overlap near zero on every affected zone.
//
// The id derivation MUST mirror js/sprites/... + roster.js's listNpcs()
// (roster.js:63-77) and util.js's slug() (util.js:125) EXACTLY, or the
// spriteSnake half of every id drifts from what gen_pages/page-shell already
// compute for the CHARACTER catalog's NPC entries — see the sanity check
// below, which is the thing that catches that drift before it ships.
//
// KEEP-IN-SYNC: studio/js/roster.js:63-77 (listNpcs' snake derivation) +
// studio/js/util.js:125 (slug). If either changes, mirror it here too.
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, "../../js");
const STU = path.resolve(HERE, "..");
const ZONES_DIR = path.join(STU, "assets/zones");
const IDX_PATH = path.join(STU, "tools/items-index.json");

// ---------- vm boot: just enough for the spriteSnake derivation ----------
// Modelled on gen_gaps.mjs's boot() (studio/tools/gen_gaps.mjs) — both files
// are standalone data literals with no dependencies, so this is a two-file
// load, no data.js/content.js needed (we don't touch ITEMS/MONSTERS here).
function boot() {
  const ctx = { console, Math, JSON, Array, Object, String, Number, Boolean };
  ctx.globalThis = ctx; ctx.self = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  const src = [
    fs.readFileSync(path.join(GAME, "sprites/characters-data.js"), "utf8"),
    fs.readFileSync(path.join(GAME, "sprites/mix-npc-data.js"), "utf8"),
  ].join("\n;\n");
  vm.runInContext(src, ctx, { timeout: 20000 });
  // top-level `const` isn't a sandbox property until re-exported (same
  // gotcha gen_gaps.mjs documents) — pull CHAR_LIST/MIX_NPCS onto globalThis.
  vm.runInContext(`
    globalThis.CHAR_LIST = (typeof CHAR_LIST !== 'undefined') ? CHAR_LIST : [];
    globalThis.MIX_NPCS = (typeof MIX_NPCS !== 'undefined') ? MIX_NPCS : { list: [] };
  `, ctx, { timeout: 5000 });
  return ctx;
}
const ctx = boot();
const CHAR_LIST = ctx.CHAR_LIST, MIX = ctx.MIX_NPCS.list || [];

// ---- exact mirrors of util.js:125 slug() and roster.js's prettyName/folderName ----
const slug = s => String(s || "").trim().toLowerCase().replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "untitled";
const prettyName = k => String(k).replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
const folderName = f => { const c = CHAR_LIST.find(x => x.folder === f); return c ? c.name : prettyName(f); };

// spriteSnake for one npcs[] entry (manifest npc record: {mixIndex, ...}).
// Fallbacks (never throw): mixIndex present but MIX[mixIndex] doesn't exist
// ("no raw") → "npc"+mixIndex; mixIndex missing entirely ("resolves to
// nothing") → caller skips the entry before this is even called.
function spriteSnakeFor(npc) {
  const raw = MIX[npc.mixIndex];
  if (!raw) return "npc" + npc.mixIndex;
  const parts = String(raw.key).split("__");
  const garbF = parts[0], bodyF = parts[parts.length - 1];   // roster.js:63-77
  const rootSeg = slug(folderName(bodyF)), garbSeg = slug(folderName(garbF));
  return rootSeg + "." + garbSeg;
}

// ---------- scan every baked zone manifest ----------
function zoneManifests() {
  let files;
  try { files = fs.readdirSync(ZONES_DIR); } catch (e) { console.error("no " + ZONES_DIR + ": " + e.message); process.exit(1); }
  return files
    .map(f => { const m = /^zone_(-?\d+)_(-?\d+)\.json$/.exec(f); return m ? { file: f, zx: Number(m[1]), zy: Number(m[2]) } : null; })
    .filter(Boolean)
    .sort((a, b) => a.zx - b.zx || a.zy - b.zy);   // deterministic order
}

function buildZonenpc() {
  const perZone = [];   // [{ zx, zy, count, skipped, entries }]
  const all = [];
  for (const z of zoneManifests()) {
    const manPath = path.join(ZONES_DIR, z.file);
    let man;
    try { man = JSON.parse(fs.readFileSync(manPath, "utf8")); }
    catch (e) { console.warn(`skipping ${z.file} — couldn't parse: ${e.message}`); continue; }
    const npcs = Array.isArray(man.npcs) ? man.npcs : [];
    const zoneDot = z.zx + "." + z.zy;
    let skipped = 0;
    const entries = [];
    for (const npc of npcs) {
      try {
        if (npc == null || npc.mixIndex == null) { skipped++; continue; }   // "resolves to nothing" — no mixIndex at all
        const spriteSnake = spriteSnakeFor(npc);
        const shire = String(npc.city || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
        const id = spriteSnake + "$" + shire + "$" + zoneDot;
        entries.push({ id, name: npc.name, role: npc.role, city: npc.city, lx: npc.lx, ly: npc.ly });
      } catch (e) {
        skipped++;
        console.warn(`  zone ${zoneDot}: entry failed (${e && e.message || e}) — skipped, never throw`);
      }
    }
    perZone.push({ zx: z.zx, zy: z.zy, count: entries.length, skipped, total: npcs.length });
    all.push(...entries);
  }
  return { all, perZone };
}

// ---------- sanity check: zone 0,0 must reproduce the existing ids ----------
function sanityCheck(newAll, oldZonenpc, force) {
  const newZ00 = new Set(newAll.filter(e => e.id.endsWith("$0.0")).map(e => e.id));
  const oldZ00 = new Set((oldZonenpc || []).filter(e => e && typeof e.id === "string" && e.id.endsWith("$0.0")).map(e => e.id));
  if (!oldZ00.size) {
    console.log("sanity check: no existing zone-0,0 zonenpc entries to compare against (first bake) — skipping.");
    return null;
  }
  let hit = 0;
  for (const id of oldZ00) if (newZ00.has(id)) hit++;
  const pct = (hit / oldZ00.size) * 100;
  console.log(`sanity check — zone 0,0 id overlap: ${hit}/${oldZ00.size} (${pct.toFixed(2)}%)`);
  if (pct < 99) {
    if (force) {
      console.warn(`WARNING: zone-0,0 id overlap ${pct.toFixed(2)}% is below the 99% correctness threshold — --force set, continuing anyway.`);
      return pct;
    }
    console.error(`ABORT: zone-0,0 id overlap ${pct.toFixed(2)}% is below the 99% correctness threshold —`);
    console.error("the spriteSnake derivation has drifted from what's currently shipped. Not writing items-index.json.");
    console.error("(pass --force to proceed anyway, e.g. after a deliberate world-wide rename)");
    process.exit(1);
  }
  return pct;
}

// ---------- main ----------
function main() {
  const dry = process.argv.slice(2).includes("--dry");
  const force = process.argv.slice(2).includes("--force");
  const raw = fs.readFileSync(IDX_PATH, "utf8");
  const idx = JSON.parse(raw);
  const oldZonenpc = Array.isArray(idx.zonenpc) ? idx.zonenpc : [];

  const { all, perZone } = buildZonenpc();

  console.log("per-zone NPC counts:");
  for (const z of perZone) console.log(`  zone ${z.zx},${z.zy}: ${z.count} emitted` + (z.skipped ? ` (${z.skipped} skipped)` : "") + ` / ${z.total} in manifest`);
  console.log(`total: ${all.length} zonenpc entr${all.length === 1 ? "y" : "ies"} across ${perZone.length} zone(s)`);

  const pct = sanityCheck(all, oldZonenpc, force);

  const oldIds = new Set(oldZonenpc.map(e => e && e.id).filter(Boolean));
  const newIds = new Set(all.map(e => e.id));
  const added = [...newIds].filter(id => !oldIds.has(id));
  const removed = [...oldIds].filter(id => !newIds.has(id));
  console.log(`diff vs previous zonenpc: +${added.length} added, -${removed.length} removed (${oldZonenpc.length} → ${all.length})`);
  if (added.length) console.log("  + " + added.slice(0, 8).join(", ") + (added.length > 8 ? ` … (+${added.length - 8} more)` : ""));
  if (removed.length) console.log("  - " + removed.slice(0, 8).join(", ") + (removed.length > 8 ? ` … (+${removed.length - 8} more)` : ""));

  if (dry) { console.log("(--dry: not writing items-index.json)"); return; }

  // Rewrite ONLY the zonenpc key, preserving every other key and the file's
  // existing minified (no-whitespace) formatting — parse, replace field,
  // stringify. zonenpc's position in the object stays where it already was
  // (last key) since we mutate the parsed object in place, not rebuild it.
  idx.zonenpc = all;
  fs.writeFileSync(IDX_PATH, JSON.stringify(idx));
  console.log(`wrote ${IDX_PATH} (zonenpc: ${oldZonenpc.length} → ${all.length} entries)` + (pct != null ? ` — zone 0,0 overlap ${pct.toFixed(2)}%` : ""));
}
main();
