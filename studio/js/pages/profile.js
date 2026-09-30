// ===== Our RPG Workshop — Profile page =====
// The signed-in contributor's own corner: who they are, the impact they've had
// (proposals by status + endorsements received + votes cast), every proposal
// they've ever submitted, a "export as a git-apply script" tool for taking their
// changes to a local checkout, and the "play with my changes" local-preview
// toggle. Reached from the "@username" chip in the top bar — Profile is
// deliberately NOT a top-level tab (see STUDIO_TABS in page-shell.js).
"use strict";

function pageProfile(root) {
  function render() {
    clear(root);
    if (!Taiao.logged()) {
      const page = el("div.page", null, [el("div.card", null, [
        el("div.empty", { html: "<div class='big'>👤</div>Sign in to see your proposals, your impact, and your local preview." }),
        el("div", { style: "text-align:center;margin-top:.6rem" }, [
          el("a.btn.primary", { text: "Sign in", href: "#/settings" }),
        ]),
      ])]);
      root.appendChild(page);
      return;
    }
    const page = el("div.page");
    page.appendChild(profileHeaderCard());
    page.appendChild(profileImpactCard());
    const galleryCard = myGalleryCard();
    page.appendChild(pixellabLibraryCard(galleryCard));
    page.appendChild(galleryCard);
    page.appendChild(myProposalsCard());
    page.appendChild(playLocallyCard());
    root.appendChild(page);
  }
  render();
  Taiao.onAuth(render);   // auth resolves ~300ms after boot — this is what re-renders past the sign-in gate
}

function profileHeaderCard() {
  // The profile IS the badge: same bone crew card the Home page deals out,
  // with the member-since line as the "issued" stamp.
  const u = Taiao.user || {};
  const no = u.id != null ? String(u.id).padStart(4, "0") : "————";
  let issued = "";
  if (u.created_at) {
    try { issued = new Date(u.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch (_) { issued = String(u.created_at); }
  }
  return el("div.crew-card", null, [
    el("div.cc-top", null, [
      el("span", { text: "Our RPG · worldbuilding crew" }),
      el("span", { text: Taiao.curator() ? "curator clearance" : "full bench access" }),
    ]),
    el("div", { style: "display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;flex-wrap:wrap" }, [
      el("div", null, [
        el("h2.cc-name", { text: "@" + Taiao.username() }),
        el("div.cc-role", { text: "worldbuilder — our dev crew" + (issued ? " · issued " + issued : "") }),
      ]),
      el("div.cc-no", null, [el("small", { text: "crew nº" }), document.createTextNode(no)]),
    ]),
  ]);
}

// Tally this player's proposals by status + endorsements received + votes cast.
// Shared shape with the Home page's smaller "Your impact" card (duplicated
// rather than shared, since the two pages load independently).
function profileImpactCard() {
  const c = el("div.card");
  c.appendChild(el("h3", { text: "Your impact" }));
  const body = el("div", null, [el("p.tagline", { text: "Loading…" })]);
  c.appendChild(body);
  (async () => {
    const r = await Taiao.listMineRaw();
    clear(body);
    if (!r || r.error || !Array.isArray(r.proposals)) {
      body.appendChild(el("div.banner.warn", { text: "Couldn't load your impact: " + ((r && r.error) || "unknown error") }));
      return;
    }
    const counts = { open: 0, pending: 0, accepted: 0, declined: 0 };
    let endorsements = 0;
    r.proposals.forEach(p => { if (counts[p.status] != null) counts[p.status]++; endorsements += p.endorsements || 0; });
    let votesCast = 0;
    try { votesCast = Object.keys(JSON.parse(localStorage.getItem("studio_myvotes_v1") || "{}")).length; } catch (_) {}
    const kv = el("dl.kv");
    const add = (k, v) => { kv.appendChild(el("dt", { text: k })); kv.appendChild(el("dd", { text: String(v) })); };
    add("Open for voting", counts.open);
    add("Awaiting review", counts.pending);
    add("In the game", counts.accepted);
    add("Declined", counts.declined);
    add("Endorsements received", endorsements);
    add("Votes cast", votesCast);
    body.appendChild(kv);
  })();
  return c;
}

function myProposalsCard() {
  const c = el("div.card");
  c.appendChild(el("h3", null, ["My proposals ", el("span.hint", { text: "everything you've submitted" })]));
  const body = el("div");
  c.appendChild(body);

  const exportRow = el("div.btn-row", { style: "margin-top:.6rem" });
  const exportBtn = el("button.btn.primary", { text: "⬇ Export my changes (git-apply script)" });
  const exportNote = el("small.tagline", { style: "margin-left:.5rem" });
  exportRow.appendChild(exportBtn); exportRow.appendChild(exportNote);
  c.appendChild(exportRow);
  c.appendChild(el("p.tagline", { style: "margin-top:.5rem", html:
    "The export is a self-contained <span class='mono'>our-rpg-apply.sh</span>: run it from the root of a game checkout and it does <span class='mono'>git pull</span>, then drops every asset you proposed into its proper place (and stages data proposals under <span class='mono'>proposed-changes/</span>). Your changes never touch the public server — this is your personal copy." }));

  async function render() {
    clear(body);
    if (typeof Taiao === "undefined" || !Taiao.logged()) {
      body.appendChild(el("p.tagline", { text: "Sign in above to see and export your proposals." }));
      exportBtn.disabled = true;
      return;
    }
    exportBtn.disabled = false;
    body.appendChild(el("p.tagline", { text: "Loading…" }));
    const r = await Taiao.listMineRaw();
    clear(body);
    if (!r || r.error) { body.appendChild(el("div.banner.warn", { text: "Couldn't load your proposals: " + ((r && r.error) || "unknown error") })); return; }
    const mine = Array.isArray(r.proposals) ? r.proposals : [];
    if (!mine.length) { body.appendChild(el("p.tagline", { text: "You haven't proposed anything yet. Generate art or propose changes, then share them." })); return; }
    const STATUS = { pending: "⏳ awaiting review", open: "🗳 open for voting", accepted: "✓ in the game", declined: "✕ declined", flagged: "⚑ hidden pending review" };
    const table = el("table.tf", null, [el("thead", null, [el("tr", null, [
      el("th", { text: "Proposal" }), el("th", { text: "Subject" }), el("th", { text: "Status" }), el("th", { text: "Votes" }),
    ])])]);
    const tb = el("tbody");
    mine.forEach(p => tb.appendChild(el("tr", null, [
      el("td", { text: p.title || "(untitled)" }),
      el("td", null, [el("span.mono", { style: "font-size:.8rem", text: p.subject })]),
      el("td", { text: STATUS[p.status] || p.status }),
      el("td", { text: String(p.endorsements || 0) }),
    ])));
    table.appendChild(tb);
    body.appendChild(table);
  }

  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true; exportNote.textContent = "Gathering your proposals…";
    try {
      const script = await buildApplyScript(m => { exportNote.textContent = m; });
      const blob = new Blob([script], { type: "text/x-shellscript" });
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: "our-rpg-apply.sh" });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      exportNote.textContent = "Downloaded our-rpg-apply.sh — run: bash our-rpg-apply.sh";
      toast("Export ready.", "ok", 5000);
    } catch (e) {
      exportNote.textContent = (e && e.message) || "Export failed.";
      toast(exportNote.textContent, "err", 6000);
    } finally { exportBtn.disabled = false; }
  });

  render();
  Taiao.onAuth(() => render());
  return c;
}

// Split a data URL into { mime, b64 }. The studio stores art/audio as base64
// data URLs, so this is straightforward.
function dataUrlB64(u) {
  const i = String(u || "").indexOf(",");
  if (i < 0) return null;
  const head = u.slice(5, i);            // e.g. "image/png;base64"
  const mime = head.split(";")[0] || "";
  return { mime, b64: u.slice(i + 1) };
}
const _extForMime = m => ({ "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav" }[m] || (m.split("/")[1] || "bin"));
const _slug = s => String(s || "x").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";

// Turn the signed-in user's proposals into a self-contained apply script:
// files[path] = base64 payload, plus a README + data proposals staged under
// proposed-changes/. Assets land where the game's build tools expect them.
async function buildApplyScript(progress) {
  if (!Taiao.logged()) throw new Error("Sign in first.");
  const mine = (await Taiao.listMine()).filter(p => p.status !== "declined");
  if (!mine.length) throw new Error("Nothing to export yet.");
  const files = {};          // repo-relative path -> base64
  const notes = [];
  let n = 0;
  for (const meta of mine) {
    progress && progress("Fetching " + (++n) + "/" + mine.length + "…");
    let full;
    try { full = await Taiao.getCostume(meta.id); } catch (_) { full = null; }
    const payload = full && full.payload;
    if (!payload) { notes.push("#" + meta.id + " " + (meta.title || "") + " — payload unavailable"); continue; }
    collectFiles(meta, payload, files, notes);
  }
  if (!Object.keys(files).length && !notes.length) throw new Error("No exportable content found.");
  // stage the human-readable notes
  files["proposed-changes/README.txt"] = btoa(unescape(encodeURIComponent(
    "Our RPG — your proposed changes, applied on top of a fresh pull.\n" +
    "Generated by the studio Profile page. Nothing here is on the public server;\n" +
    "these are your own proposals for local play / a pull request.\n\n" +
    notes.join("\n") + "\n"
  )));
  return renderApplyScript(files);
}

// Map one proposal payload to concrete repo files.
function collectFiles(meta, payload, files, notes) {
  const obj = payload.object || {};
  const folder = obj.key || (meta.subject || "").split(":").pop() || "unknown";
  const dirs = payload.costume && payload.costume.dirs;
  // costume / character / object rotation art → families_source (build input)
  if (dirs && Object.keys(dirs).length) {
    if (payload.field === "icon" || obj.type === "ui") {
      // single item icon — no canonical per-icon source path; stage it.
      const one = dirs.south || dirs.image || dirs[Object.keys(dirs)[0]];
      const p = dataUrlB64(one);
      if (p) files["proposed-changes/icons/" + _slug(folder) + "." + _extForMime(p.mime)] = p.b64;
      notes.push("#" + meta.id + " icon for '" + folder + "' → proposed-changes/icons/ (a curator packs icons into an atlas)");
      return;
    }
    const rawState = (payload.costume && payload.costume.state) || "Idle";
    const state = rawState === "full" ? "Idle" : rawState;   // base generation → the Idle state the build expects
    let wrote = 0;
    for (const [dir, url] of Object.entries(dirs)) {
      const p = dataUrlB64(url);
      if (!p) continue;
      files["assets/families_source/" + folder + "/" + state + "/rotations/" + dir + ".png"] = p.b64;
      wrote++;
    }
    notes.push("#" + meta.id + " " + (meta.title || folder) + " → assets/families_source/" + folder + "/" + state + "/rotations/ (" + wrote + " frames; rebuild sheets with tools/build_*.py)");
    return;
  }
  // uploaded sound → assets/sfx/proposed/
  if (payload.sound && payload.sound.src) {
    const p = dataUrlB64(payload.sound.src);
    if (p) {
      const name = _slug(payload.sound.name || meta.title || "sound");
      files["assets/sfx/proposed/" + name + "." + _extForMime(p.mime)] = p.b64;
      notes.push("#" + meta.id + " sound '" + name + "' → assets/sfx/proposed/");
    }
    return;
  }
  // data / quest / rule proposals → stage the JSON for a curator to fold in
  files["proposed-changes/data/" + _slug((payload.schema || "data")) + "-" + meta.id + ".json"] =
    btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));
  notes.push("#" + meta.id + " " + (meta.title || "") + " (" + (payload.schema || "data") + ") → proposed-changes/data/");
}

// A self-contained bash script: sanity-check the checkout, git pull, then a
// Python block decodes every embedded file to its path. Python is used for
// decoding because it's already required to serve the game and is portable.
function renderApplyScript(files) {
  const manifest = JSON.stringify(files);
  return [
    "#!/usr/bin/env bash",
    "# our-rpg-apply.sh — apply YOUR proposed Our RPG changes on top of a fresh pull.",
    "# Generated by the Our RPG Workshop Profile page. Run from a game checkout:",
    "#   bash our-rpg-apply.sh",
    "set -euo pipefail",
    "",
    'if [ ! -f "index.html" ] || [ ! -f "js/data.js" ]; then',
    '  echo "Run this from the root of an Our RPG game checkout (where index.html lives)." >&2',
    "  exit 1",
    "fi",
    "",
    'if [ -d .git ]; then',
    '  echo "→ git pull (fast-forward only)…"',
    '  git pull --ff-only || echo "  (skipped: resolve your working tree first, then re-run)"',
    "else",
    '  echo "→ not a git repo; skipping git pull."',
    "fi",
    "",
    'echo "→ writing your proposed assets…"',
    "python3 - <<'PYEOF'",
    "import json, base64, os",
    "files = json.loads(r'''" + manifest.replace(/'/g, "\\u0027") + "''')",
    "for path, b64 in files.items():",
    "    d = os.path.dirname(path)",
    "    if d: os.makedirs(d, exist_ok=True)",
    "    with open(path, 'wb') as f: f.write(base64.b64decode(b64))",
    "    print('  wrote', path)",
    "print('Done. %d file(s) written.' % len(files))",
    "PYEOF",
    "",
    'echo "→ if you changed character/costume art, rebuild the sheets:"',
    'echo "    python3 tools/build_character_sheet.py && python3 tools/build_outfit_sheet.py"',
    'echo "Then play: open http://localhost:8899/ (python3 tools/serve.py 8899)."',
    "",
  ].join("\n");
}

// localStorage flag the GAME reads at boot to overlay this player's own
// proposals when they play at the same origin (localhost:8899). Kept in sync
// here; consumed by js/main/proposal-overlay.js in the game.
const PREVIEW_LS = "taiao_preview_proposals_v1";
const previewOn = () => { try { return localStorage.getItem(PREVIEW_LS) === "1"; } catch (_) { return false; } };
const setPreview = on => { try { on ? localStorage.setItem(PREVIEW_LS, "1") : localStorage.removeItem(PREVIEW_LS); } catch (_) {} };

// Community layer — applies to EVERY player, signed in or not (js/main/
// proposal-overlay.js checks it independent of the preview flag above).
// Absent/"1" = on (default ON); "0" = off.
const COMMUNITY_LS = "taiao_community_layer_v1";
const communityOn = () => { try { return localStorage.getItem(COMMUNITY_LS) !== "0"; } catch (_) { return true; } };
const setCommunity = on => { try { localStorage.setItem(COMMUNITY_LS, on ? "1" : "0"); } catch (_) {} };

// ===== PixelLab library → private profile gallery ==========================
// Once a PixelLab API key is signed in (js/pixellab.js), the Workshop can list
// EVERYTHING that PixelLab account has ever generated — PixelLab keeps two
// listable collections, characters (create-character) and objects
// (create-*-direction-object). We pull both, sort them into the four buckets the
// game thinks in (character / monster / object / item), and let the player pin
// the keepers to their own private gallery (server/src/profile.js). PixelLab has
// no notion of "monster" vs "character" or "item" vs "object", so the split
// below is a keyword heuristic over the prompt — it'll sometimes guess wrong,
// and the item bucket only ever fills from objects, since single-image icon
// generations aren't in any PixelLab list. Nothing here is public: a gallery
// item enters the game only if the player later submits it as a proposal.

const GALLERY_CATS = [
  { key: "character", label: "Character sprites", icon: "🧑" },
  { key: "monster",   label: "Monster sprites",   icon: "👹" },
  { key: "object",    label: "Object sprites",    icon: "📦" },
  { key: "item",      label: "Item sprites",      icon: "🏷" },
];
const _catLabel = k => (GALLERY_CATS.find(c => c.key === k) || {}).label || k;
const _catIcon = k => (GALLERY_CATS.find(c => c.key === k) || {}).icon || "✨";

// Words that read as a creature rather than a townsperson / a wieldable item
// rather than a world prop. Mirrors the taxonomy in js/prompt-bank.js.
const _MONSTER_RE = /\b(monster|beast|creature|goblin|orc|troll|ogre|zombie|undead|skeleton|skele|ghost|ghoul|wraith|golem|demon|devil|dragon|wyrm|wyvern|drake|serpent|snake|slime|ooze|spider|scorpion|dire|wolf|boar|bear|spirit|fiend|imp|witch|brute|stalker|lurker|horror|mutant|elemental|hydra|kraken|banshee|spectre|specter|vampire|werewolf|lizardman|naga|harpy|gargoyle|minotaur|cyclops|wendigo|taniwha|abomination|behemoth|chimera|manticore|basilisk|cultist|marauder|raider|bandit)\b/i;
const _ITEM_RE = /\b(sword|blade|axe|dagger|mace|club|spear|lance|bow|crossbow|staff|wand|shield|helmet|helm|armou?r|breastplate|gauntlet|boots|potion|flask|vial|elixir|ring|amulet|necklace|pendant|brooch|gem|crystal|coin|gold|scroll|book|tome|map|key|torch|lantern|candle|food|bread|loaf|fruit|apple|berry|meat|steak|fish|herb|flower|mushroom|ore|ingot|bar|nugget|log|plank|rope|cloth|fabric|leather|hide|pelt|tool|pickaxe|hammer|hoe|sickle|scythe|\brod\b|net|bucket|barrel|pot|pan|cup|mug|bottle|jar|bag|pouch|sack|basket|arrow|quiver|rune|icon|trinket|charm)\b/i;

// kind: "character" | "object" (which PixelLab list it came from). Returns one
// of the four gallery categories.
function classifyPixellab(kind, prompt) {
  const p = String(prompt || "");
  if (kind === "character") return _MONSTER_RE.test(p) ? "monster" : "character";
  return _ITEM_RE.test(p) ? "item" : "object";
}

// Normalise a PixelLab list row (fields differ a little across API revisions)
// into { kind, id, name, prompt, preview, createdAt, category }.
function normalizePixellabRow(kind, it) {
  const id = String(it.id || it.character_id || it.object_id || "");
  const prompt = it.prompt || it.description || "";
  const created = typeof it.created_at === "number" ? it.created_at : (Date.parse(it.created_at || "") || Date.now());
  return {
    kind, id,
    name: it.name || "",
    prompt,
    preview: it.preview_url || it.preview || it.image_url || it.thumbnail_url || "",
    createdAt: created,
    category: classifyPixellab(kind, prompt),
  };
}

function pixellabLibraryCard(galleryCard) {
  const c = el("div.card");
  const LIB_LSK = "studio_lib_collapsed_v1";
  let libCollapsed; try { libCollapsed = localStorage.getItem(LIB_LSK) === "1"; } catch (_) { libCollapsed = false; }
  const caret = el("span", { style: "font-size:.8rem;color:var(--ink-faint)", text: libCollapsed ? "▸" : "▾" });
  const head = el("h3", { style: "cursor:pointer;user-select:none;display:flex;align-items:center;gap:.45rem", title: "Collapse / expand" }, [
    caret, el("span", { text: "Your PixelLab library " }), el("span.hint", { text: "everything this account has generated" }),
  ]);
  c.appendChild(head);
  const content = el("div", libCollapsed ? { style: "display:none" } : null);
  c.appendChild(content);
  content.appendChild(el("p.tagline", { html:
    "This pulls in every character and object your signed-in PixelLab account has ever generated — sorted into buckets — so you can pick which ones live on your profile. " +
    "PixelLab doesn't tag a sprite as a monster or an item, so the sort is a best guess from the prompt; move on regardless. " +
    "<b>Single-image item icons aren't kept by PixelLab</b>, so the Item bucket only fills from objects that look like gear." }));

  let loadedOnce = false;
  head.addEventListener("click", () => {
    libCollapsed = !libCollapsed;
    caret.textContent = libCollapsed ? "▸" : "▾";
    content.style.display = libCollapsed ? "none" : "";
    try { localStorage.setItem(LIB_LSK, libCollapsed ? "1" : "0"); } catch (_) {}
    if (!libCollapsed && !loadedOnce && PixelLab.hasKey() && Taiao.logged()) load();
  });

  const bar = el("div.btn-row", { style: "margin:.5rem 0" });
  const loadBtn = el("button.btn.primary", { text: "↻ Load my PixelLab generations" });
  const addBtn = el("button.btn.primary", { text: "＋ Add selected to my profile", style: "display:none" });
  const note = el("small.tagline", { style: "margin-left:.5rem;align-self:center" });
  bar.appendChild(loadBtn); bar.appendChild(addBtn); bar.appendChild(note);
  content.appendChild(bar);

  const body = el("div");
  content.appendChild(body);

  const selected = new Map();   // pixellab id -> normalized entry
  let savedIds = new Set();     // ids already pinned to the gallery

  function refreshAddBtn() {
    if (selected.size) { addBtn.style.display = ""; addBtn.textContent = "＋ Add " + selected.size + " to my profile"; }
    else addBtn.style.display = "none";
  }

  function tile(entry) {
    const already = savedIds.has(entry.id);
    const t = el("label.tile", { style: "cursor:" + (already ? "default" : "pointer") + ";display:block;position:relative" });
    const thumb = el("div.thumb");
    if (entry.preview) thumb.appendChild(el("img", { src: entry.preview, alt: entry.name || entry.prompt, loading: "lazy" }));
    else thumb.appendChild(el("div.empty", { style: "font-size:1.6rem", text: _catIcon(entry.category) }));
    t.appendChild(thumb);
    t.appendChild(el("div.meta", null, [
      el("div.name", { style: "font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text: entry.name || (entry.prompt || "").slice(0, 40) || entry.id }),
      el("div.sub", { text: entry.kind === "character" ? "character" : "object" }),
    ]));
    if (already) {
      t.appendChild(el("span", { style: "position:absolute;top:.4rem;right:.4rem;background:var(--accent,#56e39f);color:#062;border-radius:4px;padding:.05rem .35rem;font-size:.66rem;font-weight:700", text: "✓ saved" }));
      return t;
    }
    const cb = el("input", { type: "checkbox", style: "position:absolute;top:.4rem;left:.4rem;width:18px;height:18px;cursor:pointer" });
    cb.addEventListener("change", () => {
      if (cb.checked) { selected.set(entry.id, entry); t.style.outline = "2px solid var(--accent,#56e39f)"; }
      else { selected.delete(entry.id); t.style.outline = ""; }
      refreshAddBtn();
    });
    t.appendChild(cb);
    return t;
  }

  function renderBuckets(entries) {
    clear(body);
    if (!entries.length) { body.appendChild(el("p.tagline", { text: "No characters or objects found on this PixelLab account yet — generate some, then load again." })); return; }
    for (const cat of GALLERY_CATS) {
      const inCat = entries.filter(e => e.category === cat.key);
      if (!inCat.length) continue;
      body.appendChild(el("h4", { style: "margin:.9rem 0 .4rem", text: cat.icon + " " + cat.label + " (" + inCat.length + ")" }));
      const grid = el("div.grid-cards");
      inCat.forEach(e => grid.appendChild(tile(e)));
      body.appendChild(grid);
    }
  }

  async function load() {
    loadedOnce = true;
    if (!PixelLab.hasKey()) { clear(body); body.appendChild(el("div.banner.warn", { html: "Add your PixelLab API key in <a href='#/settings'>Settings</a> first — then load your generations here." })); return; }
    if (!Taiao.logged()) { clear(body); body.appendChild(el("p.tagline", { text: "Sign in to save generations to your profile." })); return; }
    loadBtn.disabled = true; note.textContent = "Reading your PixelLab account…";
    clear(body); body.appendChild(el("div.center-col", { style: "padding:1rem" }, [el("div.spinner")]));
    try {
      const [chars, objs, mine] = await Promise.all([
        PixelLab.listCharacters(), PixelLab.listObjects(), Taiao.galleryMine(),
      ]);
      savedIds = new Set((mine || []).map(m => String(m.pixellab_id)));
      selected.clear(); refreshAddBtn();
      const entries = [
        ...(chars.items || []).map(it => normalizePixellabRow("character", it)),
        ...(objs.items || []).map(it => normalizePixellabRow("object", it)),
      ].filter(e => e.id).sort((a, b) => b.createdAt - a.createdAt);
      renderBuckets(entries);
      const trunc = (chars.truncated || objs.truncated) ? " (showing the most recent — you have more on PixelLab)" : "";
      note.textContent = entries.length + " generation" + (entries.length === 1 ? "" : "s") + " found" + trunc + ".";
    } catch (e) {
      clear(body);
      body.appendChild(el("div.banner.warn", { text: (e && e.message) || "Couldn't read your PixelLab library." }));
      note.textContent = "";
    } finally { loadBtn.disabled = false; }
  }

  async function addSelected() {
    const picks = [...selected.values()];
    if (!picks.length) return;
    addBtn.disabled = true; loadBtn.disabled = true;
    let ok = 0, fail = 0;
    for (let i = 0; i < picks.length; i++) {
      const e = picks[i];
      note.textContent = "Fetching art " + (i + 1) + "/" + picks.length + " — " + (e.name || e.id) + "…";
      try {
        const dirs = e.kind === "character" ? await PixelLab.characterArt(e.id) : await PixelLab.objectArt(e.id);
        if (!dirs || !Object.keys(dirs).length) throw new Error("no art returned");
        const thumb = dirs.south || Object.values(dirs)[0] || "";
        const r = await Taiao.galleryAdd({
          category: e.category, pixellabKind: e.kind, pixellabId: e.id,
          name: e.name || (e.prompt || "").slice(0, 80), prompt: e.prompt,
          createdAt: e.createdAt, thumb, result: { dirs },
        });
        if (r && r.ok) { ok++; savedIds.add(e.id); } else { fail++; }
      } catch (_) { fail++; }
    }
    note.textContent = "Added " + ok + " to your profile" + (fail ? " · " + fail + " failed" : "") + ".";
    toast(ok ? "Saved " + ok + " to your profile." : "Nothing saved.", ok ? "ok" : "err", 5000);
    selected.clear(); refreshAddBtn();
    addBtn.disabled = false; loadBtn.disabled = false;
    // reflect the new "✓ saved" badges + refresh the gallery below
    load();
    if (galleryCard && galleryCard._refresh) galleryCard._refresh();
  }

  loadBtn.addEventListener("click", load);
  addBtn.addEventListener("click", addSelected);
  // auto-load once the account + key are both present (unless collapsed — then
  // we defer until the card is first expanded, to save the list calls)
  if (!libCollapsed && PixelLab.hasKey() && Taiao.logged()) load();
  else { clear(body); body.appendChild(el("p.tagline", { text: PixelLab.hasKey() ? "Sign in to save generations to your profile." : "Add your PixelLab API key in Settings, then load your generations here." })); }
  Taiao.onAuth(() => { if (!libCollapsed && PixelLab.hasKey() && Taiao.logged()) load(); });
  return c;
}

function myGalleryCard() {
  const c = el("div.card");
  c.appendChild(el("h3", null, ["My profile gallery ", el("span.hint", { text: "every sprite you've generated" })]));
  c.appendChild(el("p.tagline", { html:
    "Every sprite you generate in the Workshop lands here automatically, tagged with a proposed <b>sprite id</b> and category. This also keeps itself in step with your <b>PixelLab library</b>: when a generation you started in the Workshop finishes on PixelLab — even if you'd closed the tab or it was re-run there — it's pulled in here on its own. From here you can <b>regenerate</b> it (the old one stays, a fresh take appears alongside it), <b>delete</b> it, or <b>publish</b> it to the public catalogue at <span class='mono'>/workshop/sprites/</span> — where it goes live under your sprite id and tag." }));
  const body = el("div");
  c.appendChild(body);

  async function refresh() {
    if (!Taiao.logged()) { clear(body); body.appendChild(el("p.tagline", { text: "Sign in to build your gallery." })); return; }
    clear(body); body.appendChild(el("p.tagline", { text: "Loading…" }));
    let items = [];
    try { items = await Taiao.galleryMine(); } catch (_) {}
    clear(body);
    if (!items.length) { body.appendChild(el("p.tagline", { text: "Nothing here yet — generate a sprite in the Sprites tab, or pick from your PixelLab library above." })); return; }
    for (const cat of GALLERY_CATS) {
      const inCat = items.filter(m => m.category === cat.key);
      if (!inCat.length) continue;
      body.appendChild(el("h4", { style: "margin:.9rem 0 .4rem", text: cat.icon + " " + cat.label + " (" + inCat.length + ")" }));
      const grid = el("div.grid-cards");
      for (const m of inCat) grid.appendChild(galleryTile(m));
      body.appendChild(grid);
    }
  }

  function galleryTile(m) {
    const t = el("div.tile", { style: "position:relative" });
    const thumb = el("div.thumb");
    if (m.thumb) thumb.appendChild(el("img", { src: m.thumb, alt: m.name || "", loading: "lazy" }));
    else thumb.appendChild(el("div.empty", { style: "font-size:1.6rem", text: _catIcon(m.category) }));
    t.appendChild(thumb);
    t.appendChild(el("div.meta", null, [
      el("div.name", { style: "font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text: m.name || m.sprite_id || m.pixellab_id }),
      el("div.sub", { text: m.sprite_id ? ("id: " + m.sprite_id) : (m.pixellab_kind === "character" ? "character" : "object") }),
      m.published_sprite_id
        ? el("div.sub", { style: "color:var(--accent,#56e39f)", text: "✓ published as " + m.published_sprite_id })
        : null,
    ]));
    const btns = el("div.btn-row", { style: "flex-wrap:wrap;padding:.4rem .55rem .55rem;gap:.3rem" }, [
      el("button.btn.sm.primary", { text: m.published_sprite_id ? "Publish again" : "⬆ Publish", onclick: () => openPublishDialog(m) }),
      el("button.btn.sm.ghost", { text: "🔁 Regenerate", title: "Generate a fresh take — the original stays", onclick: () => regen(m, t) }),
      el("button.btn.sm.ghost", { text: "🗑", title: "Delete from gallery", onclick: () => del(m) }),
    ]);
    t.appendChild(btns);
    return t;

    async function del(item) {
      const r = await Taiao.galleryDelete(item.id);
      if (r && r.ok) refresh(); else toast((r && r.error) || "Couldn't remove.", "err");
    }
    async function regen(item, tileEl) {
      if (!item.prompt) { toast("This item has no prompt to regenerate from.", "warn"); return; }
      const overlay = el("div", { style: "position:absolute;inset:0;background:rgba(6,10,8,.72);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.4rem;border-radius:var(--radius)" }, [
        el("div.spinner"), el("small", { text: "Regenerating…" }),
      ]);
      tileEl.appendChild(overlay);
      try {
        await GenJobs.regenerateFromGallery(item);   // new take auto-adds to the gallery on completion
        toast("Fresh take added to your gallery.", "ok", 4000);
        refresh();
      } catch (e) {
        overlay.remove();
        toast((e && e.message) || "Regenerate failed.", "err", 6000);
      }
    }
  }

  // Publish dialog: confirm the sprite id + tag, then push to the public catalogue.
  function openPublishDialog(m) {
    const bg = el("div.modal-bg", { onclick: e => { if (e.target === bg) bg.remove(); } });
    const box = el("div.modal", { style: "width:min(460px,94vw)" });
    box.appendChild(el("h3", { text: "Publish to the public catalogue" }));
    box.appendChild(el("p.tagline", { html: "This goes live for everyone at <span class='mono'>/workshop/sprites/</span> under the sprite id and tag below. If the id is already taken, a number is appended to keep it unique." }));

    const idInput = el("input", { type: "text", value: m.sprite_id || "", placeholder: "sprite_id", style: "width:100%" });
    const tagSel = el("select", { style: "width:100%" });
    GALLERY_CATS.forEach(cat => { const o = el("option", { value: cat.key, text: cat.icon + " " + cat.label }); if (cat.key === m.category) o.selected = true; tagSel.appendChild(o); });
    const nameInput = el("input", { type: "text", value: m.name || "", placeholder: "display name (optional)", style: "width:100%" });

    box.appendChild(el("label.field", null, [el("span", { text: "Sprite id" }), idInput]));
    box.appendChild(el("label.field", null, [el("span", { text: "Tag" }), tagSel]));
    box.appendChild(el("label.field", null, [el("span", { text: "Name" }), nameInput]));

    const note = el("small.tagline");
    const doBtn = el("button.btn.primary", { text: "Publish" });
    doBtn.addEventListener("click", async () => {
      doBtn.disabled = true; note.textContent = "Publishing…";
      const r = await Taiao.publishSprite(m.id, idInput.value.trim(), tagSel.value, nameInput.value.trim());
      if (r && r.ok) {
        toast("Published as " + r.spriteId + " — live at /workshop/sprites/", "ok", 6000);
        bg.remove(); refresh();
      } else { doBtn.disabled = false; note.textContent = (r && r.error) || "Couldn't publish."; }
    });
    box.appendChild(el("div.btn-row", { style: "margin-top:.6rem" }, [doBtn, el("button.btn.ghost", { text: "Cancel", onclick: () => bg.remove() }), note]));
    bg.appendChild(box);
    document.body.appendChild(bg);
    idInput.focus();
  }

  // Automatic PixelLab-library → gallery sync. Runs once when the page opens
  // (key present + signed in), then on a light poll while the page stays open,
  // so library additions matching a Workshop-activated generation appear on
  // their own. GenJobs.syncLibraryToGallery self-throttles; the interval clears
  // itself once this card is no longer in the DOM (a re-render replaces it).
  let syncTimer = null;
  async function autoSync() {
    if (!document.body.contains(c)) { if (syncTimer) { clearInterval(syncTimer); syncTimer = null; } return; }
    if (!Taiao.logged() || !PixelLab.hasKey()) return;
    let added = 0;
    try { added = await GenJobs.syncLibraryToGallery(); } catch (_) {}
    if (added) {
      toast("Pulled " + added + " sprite" + (added === 1 ? "" : "s") + " from your PixelLab library.", "ok", 5000);
      refresh();
    }
  }

  c._refresh = refresh;
  refresh();
  // Defer the first sync to a macrotask so the caller has appended this card to
  // the DOM (autoSync's contains-check would otherwise skip the on-load run).
  setTimeout(autoSync, 0);
  syncTimer = setInterval(autoSync, 45000);
  Taiao.onAuth(() => refresh());
  return c;
}

function playLocallyCard() {
  const c = el("div.card");
  c.appendChild(el("h3", null, ["Play with my changes ", el("span.hint", { text: "preview in the game" })]));
  c.appendChild(el("p.tagline", { html:
    "When this is on, the game — served from the same address as this studio (<span class='mono'>http://localhost:8899</span>) — overlays <b>your own proposals</b> so you can play with them applied. " +
    "It changes nothing for anyone else: the public server only updates when a proposal is voted in and a curator brings it across." }));
  const cb = el("input", { type: "checkbox", checked: previewOn() });
  const label = el("label.field", { style: "flex-direction:row;align-items:center;gap:.5rem;cursor:pointer" }, [
    cb, el("span", { text: "Overlay my proposed changes when I play locally" }),
  ]);
  cb.addEventListener("change", () => {
    setPreview(cb.checked);
    toast(cb.checked ? "On — reload the game to see your changes." : "Off — reload the game to revert.", "ok", 4000);
  });
  c.appendChild(label);
  c.appendChild(el("p.tagline", { style: "margin-top:.4rem", html:
    "Art overlays apply first (costumes, sprites, icons); data proposals (recipes, quests, skills) follow as they're supported. Reload the game after changing this." }));

  const cb2 = el("input", { type: "checkbox", checked: communityOn() });
  const label2 = el("label.field", { style: "flex-direction:row;align-items:center;gap:.5rem;cursor:pointer;margin-top:.6rem" }, [
    cb2, el("span", { text: "Show everyone's adopted community content in my game" }),
  ]);
  cb2.addEventListener("change", () => {
    setCommunity(cb2.checked);
    toast(cb2.checked ? "On — reload the game to see community content." : "Off — reload the game to revert.", "ok", 4000);
  });
  c.appendChild(label2);
  c.appendChild(el("p.tagline", { style: "margin-top:.4rem", html:
    "This one's on by default and applies to every player, not just you — it's the accepted proposals a curator (or the auto-accept lane) has already put in front of the whole community. Turning it off plays with the stock art/sounds only." }));
  return c;
}
