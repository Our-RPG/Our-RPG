// ===== Our RPG Workshop — zone data resolver =====
// One place that answers "which zones are baked, and where does zone X,Y's
// data live?". Two sources, merged:
//   • STATIC bakes — shipped with the site: assets/zones/index.json +
//     assets/zones/zone_<zx>_<zy>.{json,png} (the node bake-zone.mjs path)
//   • COMMUNITY bakes — generated in a player's browser (zone-bake.js) and
//     published to the server: GET /api/zones/{index,manifest,map}
// The Zones/NPC/Quests tabs and Nav routing all resolve through here, so a
// community-baked zone behaves exactly like a shipped one.
"use strict";

const ZoneStore = (function () {
  const key = (zx, zy) => zx + "," + zy;
  let _staticSet = null;      // Set("0,0",…) once assets/zones/index.json loads
  let _community = null;      // Map(key → server row) once /api/zones/index loads
  let _staticP = null, _communityP = null, _communityAt = 0;
  const _manifests = new Map();   // key → Promise<manifest|null>
  const _manifestFrom = new Map(); // key → "static" | "server" (which source answered)
  const COMMUNITY_TTL = 60 * 1000;

  const apiBase = () => { try { return (typeof Taiao !== "undefined" && Taiao.getServerUrl()) || ""; } catch (_) { return ""; } };

  function staticIndex() {
    if (!_staticP) _staticP = fetch(STUDIO_BASE + "assets/zones/index.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : null)
      .then(list => { _staticSet = new Set((Array.isArray(list) && list.length) ? list.map(String) : ["0,0"]); return _staticSet; })
      .catch(() => (_staticSet = new Set(["0,0"])));
    return _staticP;
  }
  function communityIndex() {
    const base = apiBase();
    if (!base) { _community = _community || new Map(); return Promise.resolve(_community); }
    if (!_communityP || Date.now() - _communityAt > COMMUNITY_TTL) {
      _communityAt = Date.now();
      _communityP = fetch(base + "/api/zones/index")
        .then(r => r.ok ? r.json() : null)
        .then(r => {
          _community = new Map();
          if (r && r.ok && Array.isArray(r.zones)) for (const z of r.zones) _community.set(key(z.zx, z.zy), z);
          return _community;
        })
        .catch(() => (_community = _community || new Map()));
    }
    return _communityP;
  }
  // warm both indexes as soon as the data layer is up, so the sync accessors
  // below (Nav routing) have answers by the time anyone clicks a link
  setTimeout(() => { staticIndex(); communityIndex(); }, 0);

  // ---- sync accessors (null/undefined = index not loaded yet) ----
  // isStatic: true/false once known, null before the index arrives
  const isStatic = (zx, zy) => _staticSet ? _staticSet.has(key(zx, zy)) : null;
  // the server's row for a community zone (status live|baking), if any
  const communityInfo = (zx, zy) => _community ? (_community.get(key(zx, zy)) || null) : null;

  // every VIEWABLE zone key — static ∪ community-live (the NPC & Quests tabs
  // aggregate across these). Replaces the old bakedZones().
  async function zones() {
    const [st, cm] = await Promise.all([staticIndex(), communityIndex()]);
    const out = new Set(st);
    for (const [k, z] of cm) if (z.status === "live") out.add(k);
    return [...out];
  }

  // the zone manifest — static file first (ONLY if index.json actually lists
  // it: a zone dropped from the static build can leave a stale, long-cached
  // (s-maxage=604800) copy of its old zone_<x>_<y>.json sitting on the CDN —
  // fetching it unconditionally would resurrect that stale file even though
  // index.json (never observed stale) correctly says it's gone), then the
  // server copy.
  function manifest(zx, zy) {
    const k = key(zx, zy);
    if (!_manifests.has(k)) {
      _manifests.set(k, staticIndex().then(st => {
        if (!st.has(k)) return null;
        return fetch(STUDIO_BASE + "assets/zones/zone_" + zx + "_" + zy + ".json", { cache: "force-cache" })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null);
      }).then(m => {
          if (m) { _manifestFrom.set(k, "static"); return m; }
          const base = apiBase();
          if (!base) return null;
          // v= keys the URL by publish time, so a re-published (or deleted +
          // re-baked) zone never collides with a stale CDN/browser cache entry
          return communityIndex().then(() => {
            const info = communityInfo(zx, zy);
            const v = info && info.publishedAt ? "&v=" + info.publishedAt : "";
            return fetch(base + "/api/zones/manifest?zx=" + zx + "&zy=" + zy + v, { cache: "force-cache" })
              .then(r => r.ok ? r.json() : null)
              .then(m2 => { if (m2) _manifestFrom.set(k, "server"); return m2; })
              .catch(() => null);
          });
        }));
    }
    return _manifests.get(k);
  }

  // where this zone's rendered map PNG lives (static asset vs server copy).
  // Callers should have resolved the manifest first (so the index is warm).
  function mapUrl(zx, zy, meta) {
    const from = _manifestFrom.get(key(zx, zy));
    const serverSide = from ? from === "server" : isStatic(zx, zy) === false;
    if (serverSide) {
      const info = communityInfo(zx, zy);
      const v = info && info.publishedAt ? "&v=" + info.publishedAt : "";
      return apiBase() + "/api/zones/map?zx=" + zx + "&zy=" + zy + v;
    }
    return STUDIO_BASE + "assets/zones/" + ((meta && meta.image) || ("zone_" + zx + "_" + zy + ".png"));
  }

  // live bake status straight from the server (never cached — powers the
  // Zones tab's watch-someone-else-bake progress bar)
  async function state(zx, zy) {
    const base = apiBase();
    if (!base) return null;
    try {
      const r = await fetch(base + "/api/zones/state?zx=" + zx + "&zy=" + zy, { cache: "no-store" }).then(x => x.json());
      return (r && r.ok) ? r.zone : null;
    } catch (_) { return null; }
  }

  // drop caches (after a publish, so the fresh zone shows up immediately)
  function invalidate() {
    _communityP = null; _communityAt = 0;
    _manifests.clear();
  }

  return { zones, manifest, mapUrl, state, isStatic, communityInfo, invalidate, refreshCommunity: communityIndex };
})();
