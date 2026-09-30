// Taiao — service worker: cache-first for static game assets.
// Turns the one-time sprite/audio download into a load-once, offline-capable
// experience. Bump CACHE_VERSION whenever shipped assets change.
"use strict";

const CACHE_VERSION = "taiao-v17"; // v17: organic settlements + labyrinth overhaul

// ── Base-path independence ──────────────────────────────────────────────
// Every path below is written relative to the game's ROOT ("/assets/…"),
// but the game may be served from a subdirectory (itch.io serves uploads
// from a deep per-build path like /html/1234567/). The SW's registration
// scope IS that root (index.html registers "sw.js" relatively), so all
// matching converts the request's pathname to scope-relative form first.
// Cache keys keep the full pathname (unique per deployment); the CDN
// remote fallback builds its URL from the RELATIVE path, which is what
// the Taiao-cdn repo's tree is laid out as.
const SCOPE_PATH = new URL(self.registration.scope).pathname; // always ends with "/"
const relPath = pathname =>
  pathname.startsWith(SCOPE_PATH) ? "/" + pathname.slice(SCOPE_PATH.length) : pathname;

// Cache-first for large immutable assets (content-hashed sheets never change).
const CACHE_FIRST = [
  "/assets/sheets/",   // externalized sprite sheets (hashed .webp — immutable)
  "/assets/sfx/",      // sound effects
  "/assets/ambience/", // rain/wind/ocean loop beds
  "/assets/music/",    // cinematic themes (Bifrost)
  "/assets/birdsong/", // birdsong clips (remote-backed, see REMOTE below)
  "/assets/npc_dialogue/", // MiniLM dialogue bank (remote-backed)
  "/assets/models/",   // MiniLM model + tokenizer (remote-backed)
  "/fonts/",           // web fonts
  "/libs/",            // three.min.js, legacy-engine.js, npcml (remote-backed)
  "/js/sprites/paperdolls/", // 51M of per-character data files, script-injected
                             // on demand (paperdoll.js) — remote-backed below.
                             // Not content-hashed: bump CACHE_VERSION when they change.
];

// ── Remote fallback ─────────────────────────────────────────────────────
// The big optional layers (15M birdsong, ~150M dialogue bank + MiniLM +
// ONNX runtime) are NOT in this repo's tree — birdsong for license reasons
// (CC BY-NC-SA can't sit inside the repo's CC BY-SA grant), the ML stack
// for size. They live in the companion Taiao-cdn repo (published by
// tools/publish_cdn_assets.sh); a fresh clone 404s on them locally, and
// when that happens we lazily fetch the file from the CDN repo and cache
// it, so the served tree "fills itself in" per file, on demand. Game code
// keeps its plain same-origin URLs and never knows.
// (raw.githubusercontent.com sends Access-Control-Allow-Origin: * —
// GitHub RELEASE assets don't, which is why this isn't a release.)
const REMOTE_PREFIXES = [
  "/assets/birdsong/",
  "/assets/npc_dialogue/",
  "/assets/models/",
  "/libs/npcml/",
  // audio diet (2026-09-16): the web (itch) zip ships without sfx/ambience/
  // music — they stream from the CDN on first use and cache. A repo clone
  // still has them locally, so the local fetch wins and the CDN is never hit.
  "/assets/sfx/",
  "/assets/ambience/",
  "/assets/music/",
  "/js/sprites/paperdolls/",
];
const REMOTE_BASE = "https://raw.githubusercontent.com/dataversion5372/Taiao-cdn/main";
// Paths also published gzipped (big JSON compresses ~4×); preferred when
// the browser can stream-decompress.
const REMOTE_GZ = ["/assets/npc_dialogue/bank.meta.json"];
// raw.githubusercontent serves everything as text/plain or octet-stream,
// but module import() / wasm / JSON want honest content types.
const REMOTE_MIME = { ogg: "audio/ogg", mjs: "text/javascript", js: "text/javascript",
  wasm: "application/wasm", json: "application/json", txt: "text/plain; charset=utf-8" };

async function remoteFetch(path) {
  const gz = REMOTE_GZ.includes(path) && typeof DecompressionStream === "function";
  const res = await fetch(REMOTE_BASE + path + (gz ? ".gz" : ""), { mode: "cors" });
  if (!res.ok || !res.body) return null;
  const ext = path.slice(path.lastIndexOf(".") + 1);
  const body = gz ? res.body.pipeThrough(new DecompressionStream("gzip")) : res.body;
  return new Response(body, { status: 200,
    headers: { "Content-Type": REMOTE_MIME[ext] || "application/octet-stream" } });
}

// Network-first for code/markup so edits show up without a version bump,
// but still work offline from the last cached copy. "/dist/" carries the
// actual shipped bundle (index.html loads dist/bundle.js — "/js/" survives
// for dev setups serving unbundled sources).
const NETWORK_FIRST = ["/js/", "/dist/", "/css/", "/index.html", "/"];

function matchAny(path, list) {
  return list.some(p => p.endsWith("/") ? path.startsWith(p) : path === p);
}

self.addEventListener("install", e => self.skipWaiting());

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // same-origin only
  const path = relPath(url.pathname);                // scope-relative (see top)

  if (matchAny(path, CACHE_FIRST)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      // cache key = bare pathname: media elements attach Range headers,
      // and a Range-keyed entry would never match the plain request (nor
      // may cache.put store one). We serve full 200s; browsers cope for
      // these small files.
      const key = new Request(url.pathname);
      const hit = await cache.match(key);
      if (hit) return hit;
      // a dropped connection must surface as a normal failed response the
      // page's own onerror handling can absorb — a rejected respondWith
      // reads as "A ServiceWorker intercepted the request and encountered
      // an error" and the sheet stays missing for the whole session
      let res = null;
      try { res = await fetch(req); } catch (err) { /* remote may still work */ }
      if ((!res || !res.ok) && matchAny(path, REMOTE_PREFIXES)) {
        try {
          const remote = await remoteFetch(path);
          if (remote) res = remote;
        } catch (err) { /* fall through to whatever the local fetch said */ }
      }
      if (!res) return new Response("", { status: 504, statusText: "fetch failed" });
      if (res.ok) {
        const copy = res.clone();
        // out-of-band: a 46MB bank file streaming into Cache Storage must
        // not delay the page's copy of the body
        e.waitUntil(cache.put(key, copy).catch(() => {}));
      }
      return res;
    })());
    return;
  }

  if (matchAny(path, NETWORK_FIRST)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        // cache:"no-cache" forces revalidation with the server — without it the
        // browser's heuristic HTTP cache (python http.server sends no
        // Cache-Control) can hand back a STALE bundle.js for hours after a
        // rebuild, so "network-first" silently wasn't. Revalidation is a cheap
        // conditional GET (304 when unchanged).
        const res = await fetch(req, { cache: "no-cache" });
        // refresh the offline copy OUT-OF-BAND (waitUntil), and only when the
        // file actually changed: unconditionally re-putting the ~5MB bundle on
        // every reload was a Cache Storage write storm that dragged the next
        // navigation's start down by over a second.
        if (res.ok) {
          const resClone = res.clone();
          e.waitUntil((async () => {
            const hit = await cache.match(req);
            const same = hit &&
              hit.headers.get("last-modified") === resClone.headers.get("last-modified") &&
              hit.headers.get("content-length") === resClone.headers.get("content-length");
            if (!same) await cache.put(req, resClone);
          })().catch(() => { /* offline copy refresh is best-effort */ }));
        }
        return res;
      } catch (err) {
        const hit = await cache.match(req);
        if (hit) return hit;
        throw err;
      }
    })());
  }
});
