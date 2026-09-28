// ===== Taiao Workshop — codebase context-pack generator =====
// Walks the repo's real ENGINE source (not the generated sprite/data blobs) and
// distils every file's own narrated header comment into one markdown digest.
// This is what grounds the Ideas tab's AI copilot (js/llm.js + pages/ideas.js)
// in what the game ACTUALLY is — the codebase's headers are already rich
// narrated orientation, written for exactly this kind of skim-read, so we lean
// on them instead of shipping full source (which would blow any context
// budget and drown the model in implementation noise).
//
//   node studio/tools/gen_context.mjs
//
// Output: studio/js/context-pack.js — `const CODEBASE_CONTEXT = "<markdown>"`,
// loaded by the Ideas page as the copilot's system-prompt grounding.
//
// Regenerate this whenever new files/systems land with real header comments —
// stale context makes the copilot cite files or systems that no longer exist.
// (Re-run studio/tools/gen_pages.mjs too if you add/remove a studio page.)
import fs from "fs";
import path from "path";

const STU = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ROOT = path.resolve(STU, "..");

const MAX_CHARS = 120000;
const DEFAULT_CAP = 12;     // header lines kept per file, most trees
const SERVER_CAP = 30;      // server/src + schema.sql get more room (spec)

// ---------------- header extraction, one per comment dialect ----------------

// JS/MJS: consecutive "//" lines (blank "//" lines kept as blank) from the
// very first line, OR a single leading /* … */ block. Markers stripped.
function leadingCommentJs(src, cap) {
  const lines = src.split(/\r?\n/);
  let out = [];
  if (lines[0] && /^\s*\/\*/.test(lines[0])) {
    const from = src.slice(src.indexOf("/*") + 2);
    const end = from.indexOf("*/");
    const body = end >= 0 ? from.slice(0, end) : from;
    out = body.split(/\r?\n/).map(l => l.replace(/^\s*\*\s?/, "").trimEnd());
  } else {
    for (const raw of lines) {
      const l = raw.trim();
      if (l === "//") { out.push(""); continue; }
      if (l.startsWith("//")) { out.push(l.replace(/^\/\/\s?/, "")); continue; }
      break;
    }
  }
  return capLines(out, cap);
}

// Python: consecutive "#" lines (a leading shebang is skipped, not content).
function leadingCommentPy(src, cap) {
  let lines = src.split(/\r?\n/);
  if (lines[0] && lines[0].startsWith("#!")) lines = lines.slice(1);
  const out = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (l === "#") { out.push(""); continue; }
    if (l.startsWith("#")) { out.push(l.replace(/^#\s?/, "")); continue; }
    break;
  }
  return capLines(out, cap);
}

// SQL: consecutive "--" lines.
function leadingCommentSql(src, cap) {
  const out = [];
  for (const raw of src.split(/\r?\n/)) {
    const l = raw.trim();
    if (l === "--") { out.push(""); continue; }
    if (l.startsWith("--")) { out.push(l.replace(/^--\s?/, "")); continue; }
    break;
  }
  return capLines(out, cap);
}

function capLines(out, cap) {
  while (out.length && out[out.length - 1] === "") out.pop();
  if (out.length > cap) out = out.slice(0, cap);
  return out.join("\n");
}

const relOf = p => path.relative(ROOT, p).split(path.sep).join("/");
const kbOf = size => Math.max(1, Math.round(size / 1024));

function listDir(dir, exts) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
  return entries.filter(e => e.isFile() && exts.some(ext => e.name.endsWith(ext))).map(e => path.join(dir, e.name)).sort();
}
function walkRec(dir, exts, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) { walkRec(fp, exts, out); continue; }
    if (exts.some(ext => e.name.endsWith(ext))) out.push(fp);
  }
}

function fileEntry(fp, headerFn, cap) {
  const size = fs.statSync(fp).size;
  const src = fs.readFileSync(fp, "utf8");
  return { path: relOf(fp), kb: kbOf(size), header: headerFn(src, cap) };
}

// ---------------- gather the five trees ----------------

// js/**/*.js — exclude packed sprite data (js/sprites/ over 100KB) and the
// build-time-inlined Lua source blob.
const jsPaths = [];
walkRec(path.join(ROOT, "js"), [".js"], jsPaths);
const jsFiles = jsPaths
  .filter(fp => {
    const rel = relOf(fp);
    if (rel === "js/lua/lua-src-gen.js") return false;
    if (rel.startsWith("js/sprites/") && fs.statSync(fp).size > 100 * 1024) return false;
    return true;
  })
  .map(fp => fileEntry(fp, leadingCommentJs, DEFAULT_CAP));

// server/src/*.js + server/schema.sql — more header room (the server is small
// and every file here matters to a mechanic idea that touches persistence).
const serverFiles = listDir(path.join(ROOT, "server/src"), [".js"]).map(fp => fileEntry(fp, leadingCommentJs, SERVER_CAP));
const schemaPath = path.join(ROOT, "server/schema.sql");
if (fs.existsSync(schemaPath)) serverFiles.push(fileEntry(schemaPath, leadingCommentSql, SERVER_CAP));

// studio/js/*.js + studio/js/pages/*.js — the Workshop app itself.
const studioFiles = [
  ...listDir(path.join(STU, "js"), [".js"]),
  ...listDir(path.join(STU, "js/pages"), [".js"]),
].map(fp => fileEntry(fp, leadingCommentJs, DEFAULT_CAP));

// tools/*.mjs + tools/*.py — header comments only (top-level tools/, not
// studio/tools/ — this generator's own siblings aren't part of the game).
const toolsFiles = [
  ...listDir(path.join(ROOT, "tools"), [".mjs"]).map(fp => fileEntry(fp, leadingCommentJs, DEFAULT_CAP)),
  ...listDir(path.join(ROOT, "tools"), [".py"]).map(fp => fileEntry(fp, leadingCommentPy, DEFAULT_CAP)),
];

// scripts/**/*.lua — path list only. These are game CONTENT (quests, NPC
// dialogue, routines) scripted in Lua, not engine — the copilot should know
// they exist and where, not read them as design guidance.
const scriptPaths = [];
walkRec(path.join(ROOT, "scripts"), [".lua"], scriptPaths);
const scriptFiles = scriptPaths.map(fp => ({ path: relOf(fp) }));

const DIRS = [
  ["js", jsFiles],
  ["server", serverFiles],
  ["studio", studioFiles],
  ["tools", toolsFiles],
  ["scripts", scriptFiles],
];

// ---------------- architecture preamble (verbatim per spec) ----------------

const PREAMBLE = `# Taiao — codebase orientation
Taiao is an open-source (GPL-3.0 + CC BY-SA) cozy multiplayer browser RPG. Plain-JS, no
framework: every file in tools/bundle.list is concatenated + minified by tools/build.mjs
into dist/bundle.js, which index.html loads. Rendering is js/render3d.js — a three.js
scene of billboard sprites over generated terrain, with structural 3D walls/roofs.
World generation is deterministic (js/world/chunks.js, features.js, biomes via classify()).
Core data lives in js/data.js (SPR sprite atlas map, ITEMS, MONSTERS) and js/content.js;
the ~35 skills each have a file under js/skills/ defining SKILLS/RECIPES/STATIONS.
Quests, NPC dialogue, routines, items, encounters and cutscenes are scripted in Lua 5.4
(scripts/**/*.lua, run in-browser via wasmoon; bridge in js/lua/).
The server is a Cloudflare Worker (server/src/, D1 + R2): accounts (password + passkeys),
cloud saves, shared-world region ledger, and the community WORKSHOP: proposals (art/data/
sounds/quests/skills/mechanics) with votes, endorsements, curator review, and an
auto-accept lane for PixelLab art that fills declared asset gaps. Accepted proposals are
applied into running games by js/main/proposal-overlay.js (community layer). The Workshop
website itself is studio/ (this app).
When designing a new mechanic: name the real files/systems it touches, reuse existing
currencies (items, XP, quest points, reputation), and prefer data-driven additions
(new recipes/items/quests) over engine changes where possible.`;

// ---------------- render + hard cap ----------------

// `dropped` is a Set of "dir::path" keys whose header body is omitted (the
// "#### path (nKB)" line always stays — only the narrated body is cut).
function renderMarkdown(dropped) {
  let md = PREAMBLE + "\n\n## File map\n";
  for (const [dir, files] of DIRS) {
    if (!files.length) continue;
    md += "\n### " + dir + "/\n\n";
    if (dir === "scripts") {
      for (const f of files) md += "- " + f.path + "\n";
      continue;
    }
    for (const f of files) {
      md += "#### " + f.path + " (" + f.kb + "KB)\n";
      if (!dropped.has(dir + "::" + f.path) && f.header) md += f.header + "\n";
      md += "\n";
    }
  }
  return md;
}

// If the full digest is over budget, drop header BODIES (never the path+size
// lines) starting with the largest dir's total, and within it the largest
// individual headers first — that frees the most characters per file dropped,
// so as few files as possible lose their body before we're back under cap.
let md = renderMarkdown(new Set());
const dropped = new Set();
const truncatedFiles = [];
if (md.length > MAX_CHARS) {
  const dirOrder = DIRS
    .filter(([dir, files]) => dir !== "scripts" && files.length)
    .map(([dir, files]) => [dir, files.reduce((n, f) => n + (f.header ? f.header.length : 0), 0)])
    .sort((a, b) => b[1] - a[1])
    .map(([dir]) => dir);
  for (const dir of dirOrder) {
    const files = DIRS.find(([d]) => d === dir)[1];
    const bySize = [...files].filter(f => f.header).sort((a, b) => b.header.length - a.header.length);
    for (const f of bySize) {
      if (md.length <= MAX_CHARS) break;
      dropped.add(dir + "::" + f.path);
      truncatedFiles.push(dir + "/" + f.path);
      md = renderMarkdown(dropped);
    }
    if (md.length <= MAX_CHARS) break;
  }
}
const truncatedDirs = [...new Set(truncatedFiles.map(p => p.split("/")[0]))];

// ---------------- write studio/js/context-pack.js ----------------

const out = `// AUTO-GENERATED by tools/gen_context.mjs — codebase digest for the Ideas copilot.
const CODEBASE_CONTEXT = ${JSON.stringify(md)};
`;
fs.writeFileSync(path.join(STU, "js/context-pack.js"), out);

console.log("gen_context: " + DIRS.map(([d, f]) => d + "=" + f.length).join(" ") + " files");
console.log("gen_context: CODEBASE_CONTEXT size = " + md.length + " chars (cap " + MAX_CHARS + ")");
if (truncatedFiles.length) console.log("gen_context: TRUNCATED " + truncatedFiles.length + " header bod" + (truncatedFiles.length === 1 ? "y" : "ies") + " (kept path+size lines), largest-first, from: " + truncatedDirs.join(", "));
else console.log("gen_context: no truncation needed.");
