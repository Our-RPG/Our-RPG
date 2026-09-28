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
