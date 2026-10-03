// ===== Our RPG Workshop — multi-page shell =====
// The studio is a set of static HTML pages (one folder per tab, detail pages
// nested under their tab). Every content page loads js/page-loader.js (which
// pulls in the whole data layer + render code + this file) and declares what to
// render via `window.STUDIO_PAGE = { kind, tab, type?, roster?, title? }`.
//
// All the render code still emits the old hash-style targets ("#/detail?…",
// "#/sprite?…", "#/players"); Nav.url() translates those into real relative
// URLs, and App.go() / a global <a href="#/…"> click interceptor navigate to
// them — so the page functions need no changes.
"use strict";

// Folder names match the tab names exactly (slugified). Each is a folder holding
// an index.html hub; detail items are their own <key>.html pages inside it.
const STUDIO_TABS = [
  { folder: "", label: "Home" },
  { folder: "player", label: "Player" },
  { folder: "npc", label: "NPC" },
  { folder: "sprites", label: "Sprites" },
  { folder: "world-objects", label: "World Objects" },
  { folder: "monsters", label: "Monsters" },
  { folder: "biomes", label: "Biomes" },
  { folder: "items", label: "Items" },
  { folder: "procgen", label: "Procgen" },
  { folder: "zones", label: "Zones" },
  { folder: "quests", label: "Quests" },
  { folder: "ideas", label: "Ideas" },
  { folder: "code", label: "Code" },
  { folder: "bugs", label: "Bugs" },
  { folder: "stats", label: "Statistics" },
  { folder: "sounds", label: "Sounds" },
  { folder: "skills", label: "Skills" },
  { folder: "review", label: "Review", curatorOnly: true },
  { folder: "needs-art", label: "Needs art" },
  { folder: "settings", label: "Settings" },
];

// Player / NPC / World Objects / Monsters are folded under one "Entities" dropdown
// tab; everything else stays a top-level tab.
const ENTITY_FOLDERS = ["player", "npc", "world-objects", "monsters"];

// map a hash-style target ("#/…") to a real relative URL. Every content page is
// exactly one folder deep under studio/, so links are "../<folder>/…". Detail
// items resolve to their own per-item page "../<folder>/<slug(key)>.html".
const Nav = (function () {
  const ROUTE_FOLDER = { players: "player", npcs: "npc", sprites: "sprites", objects: "world-objects", monsters: "monsters", tiles: "biomes", ui: "items", map: "procgen", zones: "zones", quests: "quests", ideas: "ideas", code: "code", bugs: "bugs", stats: "stats", sounds: "sounds", skills: "skills", settings: "settings", profile: "profile" };
  const TYPE_FOLDER = { object: "world-objects", monster: "monsters", tile: "biomes", ui: "items", map: "procgen", sound: "sounds" };
  // filename slug + the item's id (name-based where available), so pages are
  // e.g. player/aeliana.html and items/bronze_sword.html — NOT the source art key.
  // slugKey + idOf MUST stay identical to tools/gen_pages.mjs.
  const slugKey = k => String(k == null ? "" : k).replace(/[^A-Za-z0-9._$-]/g, "_");
  const lookup = (type, key) => { try { return Providers.get(type).entry(key); } catch (_) { return null; } };
  const idOf = (e, key) => (e && (e.itemId || e.snake)) || key;
  function url(target) {
    target = String(target == null ? "" : target);
    if (target.slice(0, 2) !== "#/") return target;                 // already a real / external URL
    const body = target.slice(2);
    const q = body.indexOf("?");
    const path = q >= 0 ? body.slice(0, q) : body;
    const query = q >= 0 ? body.slice(q + 1) : "";
    const P = new URLSearchParams(query);
    // R = hop from THIS page to the studio root (baked per-page as STUDIO_ROOT).
    // Every target below is studio-root-relative, so it's prefixed with R rather
    // than a hardcoded "../" — pages nested deeper (npc/<snake>/…) still resolve.
    const R = (typeof window !== "undefined" && window.STUDIO_ROOT) || "../";
    if (path.slice(0, 5) === "edit/") return R + "edit/?id=" + encodeURIComponent(path.slice(5));   // drafts are dynamic
    if (path === "detail") {
      const type = P.get("type"), key = P.get("key") || "";
      // monster biome variants ("adder$desert") each get their own page.
      const e = lookup(type, key);
      // an NPC "template" character lives in its own per-sprite folder as template.html
      if (type === "character" && e && e.npc) return R + "npc/" + slugKey(idOf(e, key)) + "/template.html";
      const folder = type === "character" ? "player" : (TYPE_FOLDER[type] || "items");
      return R + folder + "/" + slugKey(idOf(e, key)) + ".html";
    }
    // a monster's art is shared across its biome variants → one sprite page per base.
    // item sprites are keyed by their icon (deduped; avoids clashing with object ids).
    if (path === "sprite") {
      const type = P.get("type"); let key = P.get("key") || "";
      if (type === "monster") key = key.split("$")[0];
      if (type === "ui") { const e = lookup("ui", key); return R + "sprites/" + slugKey((e && e.iconKey) || key) + ".html"; }
      return R + "sprites/" + slugKey(idOf(lookup(type, key), key)) + ".html";
    }
    if (path === "skill") {
      if (P.get("key") && !P.get("draft") && !P.get("pid")) return R + "skills/" + slugKey(P.get("key")) + ".html";
      return R + "skills/skill.html" + (query ? "?" + query : "");   // drafts / community proposals stay dynamic
    }
    // A baked NPC with a known id gets its own static page under its per-sprite folder
    // (npc/<spriteSnake>/<shire$zone>.html, emitted by gen_pages from items-index.zonenpc).
    // Positional (at) / name-only links with no id fall back to the dynamic npc/npc.html.
    if (path === "npc") {
      const id = P.get("id");
      if (id) {
        // id = spriteSnake$shire$zone → npc/<spriteSnake>/<shire$zone>.html
        const i = id.indexOf("$");
        if (i < 0) return R + "npc/" + slugKey(id) + "/template.html";
        // a COMMUNITY-baked zone's NPCs have no static pages in this build —
        // route them to the dynamic npc/npc.html (works on any static host;
        // the server also synthesizes the clean static-URL shell for sharing)
        const zp = id.slice(id.lastIndexOf("$") + 1).split(".");
        if (typeof ZoneStore !== "undefined" && zp.length === 2
            && ZoneStore.isStatic(Number(zp[0]), Number(zp[1])) === false)
          return R + "npc/npc.html?" + query;
        return R + "npc/" + slugKey(id.slice(0, i)) + "/" + slugKey(id.slice(i + 1)) + ".html";
      }
      return (P.get("at") || P.get("name")) ? R + "npc/npc.html?" + query : R + "npc/";
    }
    if (path === "home") return R;   // studio root (index.html)
    if (path === "quests") { return P.get("id") ? R + "quests/quest.html?" + query : R + "quests/"; }
    if (path === "zones") {
      if (P.get("special")) return R + "zones/?special=1";
      const zx = P.get("zx"), zy = P.get("zy");
      if (zx == null || zy == null) return R + "zones/";
      // community-baked zones have no static per-zone page in this build —
      // the zones hub renders them from ?zx&zy (server-synthesized shells
      // cover the clean static URL for sharing/deep links)
      if (typeof ZoneStore !== "undefined" && ZoneStore.isStatic(Number(zx), Number(zy)) === false)
        return R + "zones/?zx=" + encodeURIComponent(zx) + "&zy=" + encodeURIComponent(zy);
      return R + "zones/" + slugKey(zx + "." + zy) + ".html";   // per-zone static page
    }
    return R + (ROUTE_FOLDER[path] || path) + "/";              // a tab hub
  }
  return { url };
})();

const App = (function () {
  let chipsEl, view, navEl;
  // hop from this page to the studio root (baked per-page); nav-tab hrefs are
  // studio-root-relative so they resolve from any page depth (incl. npc/<snake>/…).
  const ROOT = (typeof window !== "undefined" && window.STUDIO_ROOT) || "../";

  function go(target) { window.location.href = Nav.url(target); }

  function buildShell() {
    const P = window.STUDIO_PAGE || {};
    const nav = el("nav.tabs");
    // Two decks: a hairline status strip (the workbench talking to itself) over
    // the main bar (wordmark + index tabs). The strip is the first thing every
    // page says: the build is open, and you're expected.
    const status = el("div.statusbar", null, [
      el("span.live", { text: "open build" }),
      el("span", { text: "the world is under construction" }),
      el("span.spacer"),
      el("span", { text: "crew access · all tools live" }),
    ]);
    const bar = el("header.topbar", null, [
      status,
      el("div.mainbar", null, [
        el("a.brand", { href: ROOT, style: "color:inherit;text-decoration:none;cursor:pointer" }, [
          el("span.word", { html: "Our&thinsp;RPG&thinsp;<span class='aur'>Workshop</span>" }),
        ]),
        nav,
        el("div.spacer"),
        (chipsEl = el("div.acct")),
      ]),
    ]);
    const tabByFolder = {}; STUDIO_TABS.forEach(t => (tabByFolder[t.folder] = t));
    // the "Entities" dropdown, folding Player / NPC / World Objects / Monsters
    const entityTabs = ENTITY_FOLDERS.map(f => tabByFolder[f]).filter(Boolean);
    if (entityTabs.length) {
      const group = el("div.tabgroup");
      const active = ENTITY_FOLDERS.indexOf(P.tab) >= 0;
      const btn = el("a.tab" + (active ? ".active" : ""), { text: "Entities ▾", href: ROOT + entityTabs[0].folder + "/" });
      const menu = el("div.tabmenu");
      entityTabs.forEach(t => menu.appendChild(el("a" + (P.tab === t.folder ? ".active" : ""), { text: t.label, href: ROOT + t.folder + "/" })));
      btn.addEventListener("click", e => { e.preventDefault(); group.classList.toggle("open"); });
      group.appendChild(btn); group.appendChild(menu);
      nav.appendChild(group);
    }
    for (const t of STUDIO_TABS) {
      if (ENTITY_FOLDERS.indexOf(t.folder) >= 0) continue;   // folded into the Entities dropdown
      if (t.curatorOnly) continue;                           // added later once we know the user is a curator
      const b = el("a.tab", { text: t.label, href: t.folder ? ROOT + t.folder + "/" : ROOT });
      const active = t.folder === "" ? P.kind === "home" : P.tab === t.folder;
      if (active) b.classList.add("active");
      nav.appendChild(b);
    }
    navEl = nav;
    // click outside an open dropdown closes it
    document.addEventListener("click", e => { qsa(".tabgroup.open").forEach(g => { if (!g.contains(e.target)) g.classList.remove("open"); }); });
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.appendChild((view = el("main#view")));
    refreshChips();
    refreshCuratorTabs();
    if (typeof Taiao !== "undefined") Taiao.onAuth(() => { refreshChips(); refreshCuratorTabs(); });
  }

  // Curator-only tabs (Review) appear only once the signed-in user is confirmed
  // a curator — which happens asynchronously after /api/me resolves, so this is
  // re-run on every auth change.
  function refreshCuratorTabs() {
    if (!navEl) return;
    const P = window.STUDIO_PAGE || {};
    const isCurator = typeof Taiao !== "undefined" && Taiao.curator && Taiao.curator();
    for (const t of STUDIO_TABS) {
      if (!t.curatorOnly) continue;
      const existing = navEl.querySelector('a.tab[data-folder="' + t.folder + '"]');
      if (isCurator && !existing) {
        const b = el("a.tab", { text: t.label, href: ROOT + t.folder + "/" });
        b.setAttribute("data-folder", t.folder);
        if (P.tab === t.folder) b.classList.add("active");
        navEl.appendChild(b);
      } else if (!isCurator && existing) {
        existing.remove();
      }
    }
  }

  function refreshChips() {
    if (!chipsEl) return;
    clear(chipsEl);
    chipsEl.appendChild(el("a.pill" + (PixelLab.hasKey() ? ".on" : ".off"), {
      text: PixelLab.hasKey() ? "PixelLab ✓" : "PixelLab key?",
      title: "PixelLab API key status", style: "cursor:pointer", href: "#/settings",
    }));
    if (Taiao.logged())
      chipsEl.appendChild(el("a.who", { href: "#/profile", title: "Your profile", style: "color:inherit;text-decoration:none;cursor:pointer" }, [el("span.u", { text: "@" + Taiao.username() })]));
    else
      chipsEl.appendChild(el("a.btn.sm", { text: "Sign in", href: "#/settings" }));
  }

  function render() {
    const P = window.STUDIO_PAGE || {};
    const params = new URLSearchParams(location.search);
    // per-item pages bake their type/key into STUDIO_PAGE; feed them to the render fns
    if (P.type && !params.get("type")) params.set("type", P.type);
    if (P.key != null && !params.get("key")) params.set("key", P.key);
    if (P.id != null && !params.get("id")) params.set("id", P.id);
    if (P.zone != null && !params.get("zone")) params.set("zone", P.zone);   // baked NPC page → its zone
    if (P.zx != null && !params.get("zx")) params.set("zx", P.zx);
    if (P.zy != null && !params.get("zy")) params.set("zy", P.zy);
    try {
      switch (P.kind) {
        case "home": pageHome(view); break;
        case "catalog": pageCatalog(view, P.type, { roster: P.roster, title: P.title }); break;
        case "sprites": pageSprites(view); break;
        case "npclist": pageNpcList(view); break;
        case "sprite": pageSpriteDetail(view, params); break;
        case "detail": pageDetail(view, params); break;
        case "skills": pageSkills(view); break;
        case "skill": pageSkillDetail(view, params); break;
        case "zones": pageZones(view, params); break;
        case "quests": pageQuests(view, params); break;
        case "ideas": pageIdeas(view); break;
        case "code": pageCode(view); break;
        case "bugs": pageBugs(view); break;
        case "stats": pageStats(view); break;
        case "npc": pageNpc(view, params); break;
        case "settings": pageSettings(view); break;
        case "profile": pageProfile(view); break;
        case "review": pageReview(view); break;
        case "needs-art": pageNeedsArt(view); break;
        case "editor": pageEditor(view, params.get("id")); break;
        default: view.appendChild(el("div.empty", { text: "Unknown page: " + (P.kind || "?") }));
      }
    } catch (e) {
      console.error(e);
      clear(view);
      view.appendChild(el("div.empty", { html: "<div class='big'>💥</div>Something broke rendering this page.<br><small>" + escapeHtml(e.message) + "</small>" }));
    }
  }

  // real <a href="#/…"> links (created by the render code) → route via Nav
  function onDocClick(e) {
    const a = e.target && e.target.closest && e.target.closest("a");
    if (!a) return;
    const h = a.getAttribute("href");
    if (h && h.slice(0, 2) === "#/") { e.preventDefault(); go(h); }
  }

  function warm() {
    const run = () => {
      try { Roster.preload && Roster.preload(); } catch (_) {}
      try { SprRender.preload && SprRender.preload(["md", "m", "c", "aa", "ab"]); } catch (_) {}
    };
    (window.requestIdleCallback || (cb => setTimeout(cb, 500)))(run);
  }

  function boot() {
    document.addEventListener("click", onDocClick, false);
    buildShell();
    render();
    warm();
  }

  return { go, refreshChips, boot };
})();

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", App.boot);
else App.boot();
