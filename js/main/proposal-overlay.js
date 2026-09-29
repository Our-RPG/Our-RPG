// ===== Our RPG — community + "play with my changes" overlay =====
// Two flags, one pipeline. At boot the game can overlay workshop proposals
// onto the LIVE sprite/sound pipeline:
//   - Community layer (default ON, settings key taiao_community_layer_v1):
//     everything the curators/trust-model have marked `accepted` — the
//     server-wide changelog everyone gets, same origin or not.
//   - "Play with my changes" (opt-in, taiao_preview_proposals_v1, needs
//     login): additionally overlays the SIGNED-IN player's own proposals
//     (any status but declined) — including ones still just sitting in the
//     open voting lane, so a maker can see their own work before the
//     community ever votes on it. When the same subject has both a
//     community proposal AND one of the player's own, the player's own wins.
//
// Trust model (server/src/workshop.js submitProposal): a PixelLab generation
// that fills a declared gap (studio/tools/gen_gaps.mjs) skips voting and
// lands as `accepted` immediately — this overlay is the client half of that
// promise turning into pixels/sound without anyone reloading a build.
//
// Applies: item icons, object/monster/character sprite art (via render3d.js's
// patch* hooks — R3D.patchAtlasKey/patchCharFrame/patchObjFrame/
// patchOutfitFrame — and main/assets.js's patchSheetRects for the 2D IMGS
// sheets), sounds (audio.js SFX_OVERRIDE), and wardrobe parts — a carved
// costume difference with an equip-item trigger (studio Phase 3 "subtract")
// registers with WardrobeParts (gameplay/wardrobe-parts.js) instead of
// patching a sheet, and draws itself over the player the moment a matching
// item is equipped. Data proposals (recipes, quests, skills) are recognised
// and counted, not yet applied — a later phase.
"use strict";

const ProposalOverlay = (function () {
  const FLAG_LS = "taiao_preview_proposals_v1";       // mine; needs login
  const COMM_LS = "taiao_community_layer_v1";         // community layer; default ON
  const TOKEN_LS = "taiao_session_v1";                 // shared with serverapi.js + the studio
  const SERVER_LS = "taiao_server_url_v1";             // studio's overridable origin
  const SERVER_DEFAULT = "https://our-rpg.com";
  const MAX_PROPOSALS = 60;
  const MAX_BYTES = 12000000;

  const previewEnabled = () => { try { return localStorage.getItem(FLAG_LS) === "1"; } catch (_) { return false; } };
  const communityEnabled = () => { try { return localStorage.getItem(COMM_LS) !== "0"; } catch (_) { return true; } };
  const token = () => { try { return localStorage.getItem(TOKEN_LS) || ""; } catch (_) { return ""; } };
  const hasSession = () => !!token();
  const serverUrl = () => {
    try { return (localStorage.getItem(SERVER_LS) || "").replace(/\/+$/, "") || SERVER_DEFAULT; }
    catch (_) { return SERVER_DEFAULT; }
  };

  // No-auth-required: the community feed is public. A token rides along when
  // one exists (harmless either way) so "mine" calls reuse the same helper.
  async function api(path) {
    try {
      const res = await fetch(serverUrl() + path, { headers: token() ? { authorization: "Bearer " + token() } : {} });
      return await res.json();
    } catch (e) { return { error: "unreachable" }; }
  }

  // ---------- payload cache (IndexedDB) ----------
  // Payloads (the art/sound itself) are immutable once a proposal exists, so
  // this is cache-first forever — repeat boots don't re-download megabytes of
  // dataURLs for the same handful of accepted proposals. Any IDB failure
  // (private browsing, quota, an ancient browser) just falls back to a plain
  // fetch; never blocks the overlay. Promise-wrapped like the studio's
  // store.js, trimmed to the one get/put this needs.
  const _DB_NAME = "taiao_overlay", _DB_VER = 1, _STORE = "payloads";
  let _dbp = null;
  function _dbOpen() {
    if (_dbp) return _dbp;
    _dbp = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") { reject(new Error("no indexedDB")); return; }
      const req = indexedDB.open(_DB_NAME, _DB_VER);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(_STORE)) req.result.createObjectStore(_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbp;
  }
  async function _cacheGet(id) {
    try {
      const db = await _dbOpen();
      return await new Promise((res, rej) => {
        const r = db.transaction(_STORE, "readonly").objectStore(_STORE).get(id);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => rej(r.error);
      });
    } catch (_) { return null; }
  }
  async function _cachePut(id, payload) {
    try {
      const db = await _dbOpen();
      await new Promise((res, rej) => {
        const t = db.transaction(_STORE, "readwrite").objectStore(_STORE).put(payload, id);
        t.onsuccess = () => res(); t.onerror = () => rej(t.error);
      });
    } catch (_) { /* best-effort — a miss just means we fetch again next time */ }
  }
  async function getPayload(id) {
    const cached = await _cacheGet(id);
    if (cached) return cached;
    const full = await api("/api/workshop/proposal?id=" + id);
    const payload = full && full.proposal && full.proposal.payload;
    if (payload) await _cachePut(id, payload);
    return payload || null;
  }

  // ---------- shared helpers ----------
  // Load a data-URL (or CDN URL) image full-resolution — the shape every
  // patch* hook and patchSheetRects wants (they do their own scale-to-rect
  // drawImage), as opposed to dataUrlToIconCanvas below which pre-bakes the
  // fixed 32x32 the UI icon() cache expects.
  function loadImage(url) {
    return new Promise(resolve => {
      if (!url) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  // Load a data-URL image, draw it into a fresh 32×32 canvas (contain,
  // nearest-neighbour) — the shape icon() hands back to the UI.
  function dataUrlToIconCanvas(url) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = 32; cv.height = 32;
        const c = cv.getContext("2d");
        c.imageSmoothingEnabled = false;
        const s = Math.min(32 / img.width, 32 / img.height);
        const w = img.width * s, h = img.height * s;
        c.drawImage(img, (32 - w) / 2, (32 - h) / 2, w, h);
        resolve(cv);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  // payload dir names ("south", "south-east", …) -> CHAR_DIRS index. Verified
  // CHAR_DIRS (js/sprites/characters-data.js) holds exactly these 8 strings —
  // the same DIRS8 the studio's editor writes costume.dirs keys with.
  const dirIndex = name => (typeof CHAR_DIRS !== "undefined" ? CHAR_DIRS.indexOf(name) : -1);
  const firstDirUrl = dirs => dirs && (dirs.south || dirs.image || dirs[Object.keys(dirs)[0]]);
  // Sound proposals carry a free-typed trigger id; fall back to slugifying
  // the sound's display name (mirrors the studio's own slug() in util.js).
  const slugify = s => String(s || "").trim().toLowerCase().replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "");

  // Late sheets: patchSheetRects (main/assets.js) fails harmlessly when its
  // target IMGS[sheet] hasn't decoded yet — remember the rect and re-apply
  // the moment that sheet's "taiao-sheet-loaded" event fires. (render3d.js's
  // atlas/char/obj/outfit patches already self-queue this way internally —
  // this is the equivalent for the 2D IMGS-sheet path only.)
  const _pendingSheetPatches = {};   // sheet -> [{sx,sy,sw,sh,img}, ...]
  function patchSheetLive(sheet, rectPatch) {
    if (typeof patchSheetRects === "function" && patchSheetRects(sheet, [rectPatch])) return true;
    (_pendingSheetPatches[sheet] || (_pendingSheetPatches[sheet] = [])).push(rectPatch);
    return false;
  }
  if (typeof document !== "undefined") {
    document.addEventListener("taiao-sheet-loaded", e => {
      const sheet = e.detail && e.detail.sheet;
      const pending = sheet && _pendingSheetPatches[sheet];
      if (!pending || !pending.length) return;
      delete _pendingSheetPatches[sheet];
      if (typeof patchSheetRects === "function") patchSheetRects(sheet, pending);
    });
  }

  // ---------- appliers (each async; (meta, payload, stats, credits)) ----------
  // Item-icon proposal (payload.field==="icon" or object.type==="ui") →
  // replace that item's drawn icon everywhere: the UI icon() cache AND,
  // where the icon is also a drawn SPR sprite, the 2D sheet + 3D atlas cell.
  async function applyIcon(meta, payload, stats, credits) {
    const url = firstDirUrl(payload.costume && payload.costume.dirs);
    if (!url) return;
    const cv = await dataUrlToIconCanvas(url);
    if (!cv) return;
    const itemId = (payload.object && payload.object.key) || "";
    const sprKey = (typeof ITEMS !== "undefined" && ITEMS[itemId] && ITEMS[itemId].icon) || itemId;
    if (typeof ICON_OVERRIDE !== "undefined") {
      if (sprKey) ICON_OVERRIDE[sprKey] = cv;
      if (itemId && itemId !== sprKey) ICON_OVERRIDE[itemId] = cv;
    }
    if (sprKey && typeof sprRect === "function") {
      const rect = sprRect(sprKey);
      if (rect) {
        const img = await loadImage(url);
        if (img) {
          patchSheetLive(rect.sheet, { ...rect, img });
          if (typeof R3D !== "undefined" && R3D.patchAtlasKey) R3D.patchAtlasKey(sprKey, img);
        }
      }
    }
    stats.icons++;
    if (meta.username) credits.add(meta.username);
    const iconU = meta.username || "you";
    if (itemId) creditMap.set("item:" + itemId, iconU);
    if (sprKey && sprKey !== itemId) creditMap.set("item:" + sprKey, iconU);
  }

  // World object (object.type==="object" with costume.dirs): patch every
  // direction the 8-dir OBJ sheet frame the object actually renders with,
  // and — for the "flat decor" path (a plain SPR key drawn straight into the
  // atlas, no OBJ_MAP entry) — the sheet rect + atlas cell too.
  async function applyObject(meta, payload, stats, credits) {
    const key = payload.object && payload.object.key;
    const dirs = payload.costume && payload.costume.dirs;
    if (!key || !dirs) return;
    let touched = false;
    if (typeof OBJ_MAP !== "undefined" && OBJ_MAP[key] != null && typeof R3D !== "undefined" && R3D.patchObjFrame) {
      for (const dirName of CHAR_DIRS) {
        const url = dirs[dirName];
        if (!url) continue;
        const img = await loadImage(url);
        if (!img) continue;
        R3D.patchObjFrame(OBJ_MAP[key], dirIndex(dirName), img);
        touched = true;
      }
    }
    if (typeof SPR !== "undefined" && SPR[key]) {
      const url = firstDirUrl(dirs);
      const img = url ? await loadImage(url) : null;
      if (img) {
        if (typeof sprRect === "function") {
          const rect = sprRect(key);
          if (rect) patchSheetLive(rect.sheet, { ...rect, img });
        }
        if (typeof R3D !== "undefined" && R3D.patchAtlasKey) R3D.patchAtlasKey(key, img);
        touched = true;
      }
    }
    if (touched) {
      stats.sprites++;
      if (meta.username) credits.add(meta.username);
      creditMap.set("object:" + key, meta.username || "you");
    }
  }

  // Monster (object.type==="monster"): key may carry a "$biome" display
  // suffix (studio/js/providers-extra.js) — strip it back to the real
  // MONSTERS key. Patches the billboard cell always; if the monster has
  // directional art (MONSTERS[kind].dirSpr) also patches each "mon_<kind>_
  // <dir>" cell — the exact dir-suffix format render3d.js's draw loop uses.
  async function applyMonster(meta, payload, stats, credits) {
    const kind = ((payload.object && payload.object.key) || "").split("$")[0];
    if (!kind || typeof MONSTERS === "undefined" || !MONSTERS[kind]) return;
    if (typeof R3D === "undefined" || !R3D.patchAtlasKey) return;
    const dirs = payload.costume && payload.costume.dirs;
    const southUrl = firstDirUrl(dirs);
    if (!southUrl) return;
    const southImg = await loadImage(southUrl);
    if (!southImg) return;
    R3D.patchAtlasKey("mon_" + kind, southImg);
    if (MONSTERS[kind].dirSpr) {
      for (const dirName of CHAR_DIRS) {
        const url = dirs[dirName];
        if (!url) continue;
        const img = (dirName === "south" && dirs.south === southUrl) ? southImg : await loadImage(url);
        if (!img) continue;
        R3D.patchAtlasKey("mon_" + kind + "_" + dirName, img);
      }
    }
    stats.sprites++;
    if (meta.username) credits.add(meta.username);
    creditMap.set("monster:" + kind, meta.username || "you");
  }

  // Playable character (object.type==="character"): folder → CHAR_LIST
  // index. "full" (a whole-generation publish) and "Idle" (its equivalent
  // costume-state name) both mean the BASE character sheet; any other state
  // name is an alternate outfit/costume — looked up in OUTFIT_FRAME the same
  // way the objedit/charselect UIs do. An unrecognised state can't be placed
  // on a sheet yet, so it's counted rather than dropped silently.
  async function applyCharacter(meta, payload, stats, credits) {
    const folder = payload.object && payload.object.key;
    const dirs = payload.costume && payload.costume.dirs;
    if (!folder || !dirs || typeof CHAR_LIST === "undefined" || typeof R3D === "undefined") return;
    const index = CHAR_LIST.findIndex(c => c.folder === folder);
    if (index < 0) return;
    const state = (payload.costume && payload.costume.state) || "";
    if (state === "full" || state === "Idle") {
      if (!R3D.patchCharFrame) return;
      let any = false;
      for (const dirName of CHAR_DIRS) {
        const url = dirs[dirName]; if (!url) continue;
        const img = await loadImage(url); if (!img) continue;
        R3D.patchCharFrame(index, dirIndex(dirName), img); any = true;
      }
      if (any) { stats.sprites++; if (meta.username) credits.add(meta.username); creditMap.set("character:" + folder, meta.username || "you"); }
      return;
    }
    const fr = typeof OUTFIT_FRAME !== "undefined" && OUTFIT_FRAME[folder + "|" + state];
    if (!fr || !R3D.patchOutfitFrame) { stats.costumesPending++; return; }
    const [si, base] = fr;
    let any = false;
    for (const dirName of CHAR_DIRS) {
      const url = dirs[dirName]; if (!url) continue;
      const img = await loadImage(url); if (!img) continue;
      R3D.patchOutfitFrame(si, base + dirIndex(dirName), img); any = true;
    }
    if (any) { stats.sprites++; if (meta.username) credits.add(meta.username); creditMap.set("character:" + folder, meta.username || "you"); }
  }

  // Wardrobe part (object.type==="character" + costume.part): a carved-part
  // costume state (studio Phase 3 "subtract") with an equip-item TRIGGER —
  // it never touches the character sheet; it registers with WardrobeParts
  // (gameplay/wardrobe-parts.js), which draws it as a second billboard over
  // the player whenever one of costume.items is equipped (see render3d.js's
  // merge into the armour-overlay slot). A part published with no trigger
  // items can never activate in-game — counted as pending rather than
  // dropped silently, same treatment as an unrecognised costume state above.
  function applyPart(meta, payload, stats, credits) {
    const folder = payload.object && payload.object.key;
    const costume = payload.costume || {};
    const items = (costume.items || []).filter(Boolean);
    const dirs = costume.dirs;
    if (typeof WardrobeParts === "undefined" || !folder || !items.length || !dirs) {
      stats.costumesPending++;
      return;
    }
    WardrobeParts.register({ folder, items, slot: costume.slot || "", dirs, maker: meta.username || "" });
    stats.parts++;
    if (meta.username) credits.add(meta.username);
    creditMap.set("character:" + folder, meta.username || "you");
  }

  // Sound (payload.sound.src): may target an event id with NO built-in
  // SOUNDS entry at all (audio.js's SFX_OVERRIDE doesn't require one).
  function applySound(meta, payload, stats, credits) {
    const src = payload.sound && payload.sound.src;
    if (!src || typeof SFX_OVERRIDE === "undefined") return;
    const id = (payload.sound.trigger && String(payload.sound.trigger).trim()) || slugify(payload.sound.name);
    if (!id) return;
    SFX_OVERRIDE[id] = src;
    stats.sounds++;
    if (meta.username) credits.add(meta.username);
    creditMap.set("sound:" + id, meta.username || "you");
  }

  // Dispatch by payload shape (icon before object — an item icon carries
  // object.type==="ui", never "object"/"monster"/"character").
  async function applyProposal(meta, payload, stats, credits) {
    const obj = payload.object || {};
    if (payload.field === "icon" || obj.type === "ui") return applyIcon(meta, payload, stats, credits);
    if (obj.type === "object" && payload.costume && payload.costume.dirs) return applyObject(meta, payload, stats, credits);
    if (obj.type === "monster") return applyMonster(meta, payload, stats, credits);
    if (obj.type === "character" && payload.costume && payload.costume.part) return applyPart(meta, payload, stats, credits);
    if (obj.type === "character") return applyCharacter(meta, payload, stats, credits);
    if (payload.sound && payload.sound.src) return applySound(meta, payload, stats, credits);
    stats.dataPending++;   // recipes/quests/skills/rules — later phase
  }

  // ---------- credits ----------
  // subject -> username (or "you" for a "mine"-sourced proposal, which never
  // carries a username — the server only joins that in on the public list).
  // Kept independent of `credits` (the Set above, used only for the summary
  // line): this is a lookup any UI surface can query by normalized identity
  // ("item:<id>", "object:<key>", "monster:<kind>", "character:<folder>",
  // "sound:<id>") regardless of whether that proposal's meta carried a real
  // username.
  const creditMap = new Map();

  // ---------- gap manifest (unauthenticated) ----------
  // subjects the studio's gen_gaps tool flagged as missing/weak art (server
  // workshop.js `gaps`) — surfaced in-game as a quiet "this could be your
  // work" nudge (decor/item/monster examine, bestiary) even when neither
  // overlay layer is on, as long as there's a Workshop to send someone to.
  const gapMonsters = new Set(), gapItems = new Set();
  async function loadGaps() {
    const r = await api("/api/workshop/gaps");
    if (!r || !r.ok || !Array.isArray(r.subjects)) return;
    for (const s of r.subjects) {
      if (s.startsWith("gen:monster:")) gapMonsters.add(s.slice("gen:monster:".length));
      else if (s.startsWith("gen:ui:")) gapItems.add(s.slice("gen:ui:".length));
    }
  }
  const isGapMonster = kind => gapMonsters.has(kind);
  const isGapItem = id => gapItems.has(id);

  // ---------- run ----------
  let lastStats = null;
  // newest community-accepted proposal (the server lists accepted newest-
  // first) — the koha letter and the crew pulse both quote it, so "the
  // community is alive" is always said with a real name and a real work.
  let latestAccepted = null, acceptedCount = 0;
  async function run() {
    const commOn = communityEnabled();
    const mineOn = previewEnabled() && hasSession();
    if (!commOn && !mineOn) { lastStats = null; return { applied: false, reason: "disabled" }; }

    // subject -> {meta, mine}. Community listed first (server already orders
    // accepted newest-first) so a same-subject "mine" entry below overwrites
    // it in place without disturbing iteration order.
    const bySubject = new Map();
    if (commOn) {
      const comm = await api("/api/workshop/proposals?status=accepted");
      if (comm && comm.ok && Array.isArray(comm.proposals)) {
        for (const meta of comm.proposals) if (!bySubject.has(meta.subject)) bySubject.set(meta.subject, meta);
        latestAccepted = comm.proposals[0] || null;
        acceptedCount = comm.proposals.length;
      } else {
        console.info("[Our RPG] Community layer: couldn't load accepted proposals (" + ((comm && comm.error) || "?") + ").");
      }
    }
    if (mineOn) {
      const mine = await api("/api/workshop/mine");
      if (mine && mine.ok && Array.isArray(mine.proposals)) {
        for (const meta of mine.proposals) {
          if (meta.status === "declined") continue;   // your rejected ideas aren't "your changes"
          bySubject.set(meta.subject, meta);
        }
      } else {
        console.info("[Our RPG] Preview: couldn't load your proposals (" + ((mine && mine.error) || "?") + ").");
      }
    }

    const stats = { icons: 0, sprites: 0, sounds: 0, parts: 0, costumesPending: 0, dataPending: 0 };
    const credits = new Set();
    let applied = 0, sizeSum = 0, skipped = 0;
    for (const meta of bySubject.values()) {
      if (applied >= MAX_PROPOSALS || sizeSum > MAX_BYTES) { skipped++; continue; }
      applied++; sizeSum += meta.size || 0;
      const payload = await getPayload(meta.id);
      if (!payload) continue;
      await applyProposal(meta, payload, stats, credits);
    }
    if (skipped) console.info("[Our RPG] Community layer: skipped " + skipped + " proposal(s) past the local preview cap (" + MAX_PROPOSALS + " proposals / ~" + Math.round(MAX_BYTES / 1e6) + "MB).");

    if (stats.icons) {
      // Drop the icon cache and repaint so overridden icons show immediately.
      if (typeof ICONS !== "undefined") for (const k in ICONS) delete ICONS[k];
      if (typeof uiDirty !== "undefined") uiDirty = true;
    }

    const names = [...credits].sort((a, b) => a.localeCompare(b));
    const parts = [];
    if (stats.sprites) parts.push(stats.sprites + " sprite" + (stats.sprites === 1 ? "" : "s"));
    if (stats.parts) parts.push(stats.parts + " part" + (stats.parts === 1 ? "" : "s"));
    if (stats.sounds) parts.push(stats.sounds + " sound" + (stats.sounds === 1 ? "" : "s"));
    if (stats.icons) parts.push(stats.icons + " icon" + (stats.icons === 1 ? "" : "s"));
    const pending = stats.costumesPending + stats.dataPending;
    const summary = "Community layer: " + (parts.length ? parts.join(", ") : "nothing new") +
      (names.length ? " — art by " + names.map(n => "@" + n).join(", ") + "." : ".") +
      (pending ? " " + pending + " proposal(s) recognised but not appliable yet (costume state or data — a later phase)." : "");
    console.info("[Our RPG] " + summary);
    lastStats = { ...stats, credits: names, applied, skipped, summary };
    return { applied: true, ...lastStats };
  }

  // Gap manifest fetch: independent of the two overlay layers — it only needs
  // a Workshop to point players at. Skips only when nothing at all is on
  // (no community layer, no "mine" preview, no Workshop URL to send anyone
  // to), matching the outer kickoff's readiness dance below.
  if (typeof document !== "undefined" &&
      (communityEnabled() || (previewEnabled() && hasSession()) ||
       (typeof TAIAO_WORKSHOP_URL !== "undefined" && TAIAO_WORKSHOP_URL))) {
    const _kickGaps = () => { setTimeout(() => { loadGaps().catch(() => {}); }, 1200); };
    if (typeof window !== "undefined") {
      if (document.readyState === "complete") _kickGaps();
      else window.addEventListener("load", _kickGaps, { once: true });
    }
  }

  return {
    previewEnabled, communityEnabled, hasSession, run, stats: () => lastStats,
    credit: k => creditMap.get(k) || null,
    isGapMonster, isGapItem,
    latest: () => latestAccepted,
    acceptedCount: () => acceptedCount,
  };
})();

// The crew pulse: one line in the log when the shared world has visibly
// changed since this player's last boot. It only speaks when there is a real
// beat — a newly adopted work it can name, by a maker it can name — and says
// nothing at all on a quiet week, so it never becomes wallpaper.
function _crewPulse() {
  try {
    const latest = ProposalOverlay.latest();
    const st = ProposalOverlay.stats();
    if (!latest || !st || !st.applied) return;
    const KEY = "taiao_crewpulse_v1";
    let seen = null;
    try { seen = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
    if (seen && seen.id === latest.id) return;               // nothing new — stay quiet
    const who = latest.username ? "@" + latest.username : "one of us";
    const what = latest.title || String(latest.subject || "").split(":").pop().replace(/_/g, " ") || "new work";
    const wait = () => {
      if (typeof gameReady === "undefined" || !gameReady || typeof log !== "function") { setTimeout(wait, 1500); return; }
      if (seen) log(`While you were away, ${who}'s "${what}" was adopted into everyone's world.`, "gold");
      else log(`${st.applied} pieces of this world were made by players like you — the newest by ${who}.`, "sys");
      try { localStorage.setItem(KEY, JSON.stringify({ id: latest.id, t: Date.now() })); } catch (e) {}
    };
    wait();
  } catch (e) { /* the pulse is decoration — never let it break a boot */ }
}

// Kick off after boot without blocking it. icon()/SFX.play() consult their
// overrides first, so applied patches take effect the moment they land,
// regardless of timing relative to this.
if (typeof ProposalOverlay !== "undefined" &&
    (ProposalOverlay.communityEnabled() || (ProposalOverlay.previewEnabled() && ProposalOverlay.hasSession()))) {
  const _kick = () => { setTimeout(async () => {
    const r = await ProposalOverlay.run();
    const st = typeof document !== "undefined" && document.getElementById("community-status");
    if (st && r && r.summary) st.textContent = r.summary;
    _crewPulse();
  }, 1200); };
  if (typeof window !== "undefined") {
    if (document.readyState === "complete") _kick();
    else window.addEventListener("load", _kick, { once: true });
  }
}
