// ===== world chunk generation, settlement stamping, resources, and monster spawns =====
"use strict";

// Callers (1):
//  world.js:24
function createWorldChunks(ctx) {
  const {
    S, hash2i, rand2, fbm, elevation, humidity, temperature,
    farmField, civField, weirdField, classify, biomeAtTile,
    waterBody, riversNear, roadsNear, nearPoly, ROAD_W, villagesNear, roadNear, riverNear,
    solidDoorX, riverDoors,
    poiInfo, wildIcon, atlasVariantAt, biomeGround, BIOME_VEG,
    dreamGatesNear,
    bankNetAt, bankNetInfo, mainBranchFor,
    GRASS_LIKE_B, FOREST_LIKE_B, SWAMP_LIKE_B, WATER_LIKE_B, ROCK_LIKE_B,
    localTierCap, rollTier,
  } = ctx;
  // carved labyrinth hedges + Great Labyrinth plans (labgen.js) — map.js
  // builds its own instance from the same (hash2i, rand2, S), so the map
  // mirrors these walls exactly
  const labMaze = createLabMaze(hash2i, rand2, S);
  const chunks = new Map();
  const obstacles = [];
  const npcs = [];
  resolveBiomeMobs(B);

  // ---- trade-shop interior decoration ----
  // Each settlement building carries a job (a crafting-station key). We furnish
  // its interior with thematically matching props from the pixellab object set
  // (assets/new_objects), so a cooper's holds casks, a chandler's holds candles,
  // a locksmith's holds locks, a potter's holds clay, etc. Keys here must exist
  // in OBJ_MAP (they render 8-directional via render3d objForKey) and must NOT
  // start with "wall_" (those bake as flat blocks, not billboards). Up to 8 are
  // laid around the interior perimeter, skipping the central station tile.
  const TRADE_DECOR = {
    bank:            ["strongbox", "treasure_chest", "chest_warded", "lockbox", "chest_storage", "vault_door", "coin_purse", "jewelry_box"],
    trader:          ["crate_braced", "barrel_cargo", "barrel_export", "sea_sack", "awning_rolled", "cargo_cover", "signpost_blank", "coin_purse"],
    anvil:           ["anvil2", "bellows", "whetstone", "toolbox", "crucible", "tub_storage", "wall_bracket"],
    furnace:         ["bellows", "crucible", "cauldron_iron", "barrel_scorched", "pitch_pot", "tub_storage"],
    altar:           ["candle_altar", "candle_cathedral", "censer", "iron_bell", "bell_rope", "brazier_bronze", "candle_votive", "stainedglass_blue"],
    workbench:       ["boards_stacked", "timber_beam", "offcuts", "vice", "crowbar", "ladder", "door_wood"],
    loom:            ["spinning_wheel", "sea_sack", "tarpaulin", "wallshelf", "stool", "rope_mat"],
    tanrack:         ["tanning_vat", "brine_vat", "tub_storage", "hammock", "shackles", "hearthstone"],
    cauldron:        ["cauldron_iron", "retort", "flask", "carboy", "demijohn", "candle_scrying", "terrarium"],
    alchtable:       ["retort", "flask", "bell_jar", "oil_jar", "oil_lamp", "terrarium", "carboy"],
    campfire:        ["cauldron_iron", "teapot", "mug", "tureen", "barrel_ale", "pitcher", "goblet"],
    mill:            ["barrel_flour", "sea_sack", "cartwheel", "bucket", "sideboard"],
    sawmill:         ["boards_stacked", "boards_bundle", "boards_loose", "timber_seasoned", "offcuts", "ladder_tall", "planks_seasoned"],
    malthouse:       ["cask_ale", "barrel_beer", "brewery_tun", "mead_bottle", "jar_storage", "bucket"],
    brewery:         ["brewery_tun", "brewery_tun_open", "fermentation_vat", "cask_ale", "barrel_beer", "mead_bottle"],
    cooperage:       ["cask_oak", "cask_cooper", "cask_export", "cask_water", "staves", "boards_bundle", "cask_carved", "cask_ageing"],
    bakehouse:       ["bread_oven", "barrel_flour", "pot_lidded", "jar_storage", "barrel_pickle", "pitcher"],
    spinning_wheel:  ["spinning_wheel", "wallshelf", "rope_mat", "stool", "dresser_mirror", "sea_sack"],
    dyeworks:        ["dye_vat", "tub_storage", "carboy", "cask_chemical", "demijohn", "bucket"],
    fulling_mill:    ["tub_storage", "wash_tub", "tarpaulin", "cask_water", "bucket", "stool"],
    tailors_bench:   ["wardrobe", "dresser_mirror", "hand_mirror", "sideboard", "bench_trestle", "sail_cream"],
    barn:            ["haybale", "cartwheel", "butter_churn", "milk_bottle", "bucket", "fence_wood"],
    creamery:        ["butter_churn", "milk_bottle", "brine_vat", "tureen", "jar_storage", "teapot"],
    ropewalk:        ["rope_mat", "rope_ladder", "rigging", "cargo_net", "cargo_sling", "staves"],
    sail_loft:       ["sail_cream", "sail_mainsail", "sail_jib", "sailmaker_spindle", "tarpaulin", "rigging",
                      "sail_square", "sail_squarerig", "sail_lateen", "sail_gaff", "sail_lugsail", "sail_topsail",
                      "sail_topgallant", "sail_royal", "sail_staysail", "sail_foresail", "sail_mizzen", "sail_spanker",
                      "sail_jib", "sail_stormjib", "sail_studding", "sail_fullrig", "sail_masterwork"],
    shipyard:        ["timber_beam", "planks_seasoned", "cask_ships", "rigging", "boat_dinghy", "powder_keg", "fender", "boat_cover", "boards_stacked"],
    charcoal_clamp:  ["pitch_pot", "cask_chemical", "kiln", "barrel_scorched", "bucket", "crucible"],
    lime_kiln:       ["kiln", "pot_lidded", "cask_water", "hearthstone", "bucket", "cistern"],
    masons_yard:     ["roof_tiles_stack", "roof_tiles_section", "chimney_pot", "chimney_stack", "cistern", "grille",
                      "window_frame", "gate_wood", "wall_brick", "wall_rubble", "wall_plaster", "wall_keep", "figurine"],
    pottery_kiln:    ["clay_bowl", "clay_cup", "clay_jug", "clay_plate", "amphora", "amphora_ornate", "vase_glazed", "jar_storage", "urn_garden", "planter_ceramic", "pot_lidded", "kiln"],
    glass_furnace:   ["glass_bottle", "glass_jar", "bell_jar", "decanter", "carboy", "vase_masterwork", "stainedglass_green", "stainedglass_blue", "stainedglass_red", "window_pane", "tumbler", "demijohn"],
    assay_furnace:   ["crucible", "cask_silver", "strongbox", "bellows", "retort", "tub_storage"],
    drawbench:       ["wire_frame", "wire_mesh", "grille", "cog", "mechanism", "clockwork"],
    jewelers_bench:  ["jewelry_box", "filigree", "figurine", "snow_globe", "hand_mirror", "birdcage"],
    leather_bench:   ["tanning_vat", "quiver", "pouch", "hammock_canvas", "shackles", "mantrap"],
    cobblers_bench:  ["stool", "toolbox", "sideboard", "wallshelf", "hammock", "pouch"],
    saddlers_bench:  ["quiver", "pouch", "cargo_sling", "tarpaulin", "hammock_canvas", "staves"],
    toolsmith:       ["toolbox", "anvil2", "vice", "whetstone", "crowbar", "clockwork", "gate_iron", "portcullis_winch"],
    locksmith_bench: ["lock_padlock", "lock_chest", "lock_gate", "lock_tumbler", "lock_combination", "lock_puzzle", "lock_enchanted", "lock_birdcage", "lock_plate", "lock_vault", "hasp", "hinge", "latch", "lockbox"],
    paper_mill:      ["tub_storage", "boards_stacked", "cask_water", "rope_mat", "offcuts", "bucket"],
    bindery:         ["bookshelf_small", "wallshelf", "desk", "easel", "jewelry_box", "hand_mirror"],
    chandlery:       ["candle_pillar", "candle_taper", "candle_beeswax", "candle_white", "chandler_set", "candelabra",
                      "candle_threewick", "candle_dripping", "candle_votive", "candle_dinner", "candle_bayberry",
                      "candle_colored", "candle_chime", "candle_ember", "candle_floating", "candle_rushlight",
                      "candle_carriage", "candle_signal", "candle_storm", "candle_ship", "candle_lantern"],
    soap_works:      ["cauldron_iron", "tub_storage", "cask_chemical", "wash_tub", "pot_lidded", "water_filter", "bucket"],
    _default:        ["stool", "barrel_ale", "bucket", "wallshelf", "sideboard"],
  };
  // Every hull in the sailable fleet. Their primary role is the player's boat
  // (rendered via the sailing path) + inventory icon, but a shipyard also gets
  // one "on the stocks" as decor, rotated by position so all hulls surface.
  const SHIP_FLEET = [
    "ship_barque", "ship_brig", "ship_brigantine", "ship_caravel", "ship_carrack",
    "ship_clipper", "ship_cutter", "ship_dhow", "ship_frigate", "ship_galleon",
    "ship_galley", "ship_junk", "ship_longship", "ship_manofwar", "ship_schooner",
    "ship_smack", "boat_barge", "boat_catboat", "boat_coracle", "boat_dinghy",
    "boat_dory", "raft_logs", "raft_planks", "skiff",
  ];

  // --- IndexedDB chunk cache ---
  // Keyed by fixed world id + coords.
  // Writes are fire-and-forget; reads warm the in-memory chunks Map before the
  // game loop starts so synchronous getChunk() always finds a hot entry.
  // Bumped to v5: mansions are now a 3-storey hall with three ATTACHED
  // 2-storey wings (shared walls + archways), towers are 6x6, observatories
  // 9x9 — all stamped into tiles, so older cached chunks would disagree with
  // the renderer/collision. Chunk data is fully deterministic from the seed,
  // so old chunks simply regenerate.
  // Bumped to v6: settlement buildings are now furnished by trade (casks in the
  // cooper's, candles in the chandler's, locks in the locksmith's, pottery in the
  // potter's, sails in the sail loft, a hull on the shipyard stocks, etc.) and
  // POIs/civic rings gained more props, so cached chunks must regenerate.
  // Bumped to v8: bridges span bank-to-bank (stone_bridge decor over approach
  // roads, staggered 1-tile "#p" support piers), and river-spanning buildings
  // keep a hollow channel + bank strip with a second north door.
  // Bumped to v20: climate rework — triangle latitude + warmCurve makes the
  // warm:polar land ratio ~3:1 (was ~40:60), reshuffling biomes world-wide.
  // Bumped to v21: portals moved to a sparse dedicated lattice (>= 500 game
  // tiles apart, features.js portalSite) and three new POIs (runecircle,
  // banditcamp, huntercamp) replaced the tables' portal slots.
  // Bumped to v22: boulders, mossy boulders and wildflowers now generate as
  // mineable/pickable resource NODES instead of static decor (gather-decor.js).
  // Bumped to v23: pasture livestock (chicken/sheep/cow) scattered across
  // grass/farm/meadow biomes for the roaming-animal Husbandry rework.
  // Bumped to v24: fishing spots are now per-fish (procedural rarity) with a
  // 5-10 catch counter — node types/placement changed, so regenerate.
  // Bumped to v25: new husbandry animals (quail/duck/goat/rabbit/pig) scattered
  // in pastures + griffons in the crags.
  // Bumped to v26: batch 2 (goose/turkey/buffalo/alpaca pastures; aurochs/wyrmling crags).
  // Bumped to v28: fenced farm fields (per-skill soil + gate) generate in Farmland
  // biome; Newhaven's prototype seed patch removed — node/decor layout changed.
  // v36: bank chests added to POIs (manor/towers/lighthouse/fishvillage/
  // campsite) + wayside wild chests — cached chunks must regenerate to get them
  // v37: roads crossing shallow SEA now deck over as overpass bridges (sea
  // stone_bridge tiles + 4-lattice piles + coastal approach decking)
  // v38: fishing spots are WATER-TYPE aware — freshwater (rivers/lakes) holds a
  // new "river" band (kōura + shortfin eel, hīnaki-potted) and never sea fish;
  // sea shore/deep/abyss bands no longer leak inland. Cached spots regenerate.
  // v39: parallel roads merge — later road edges re-lane along the FINAL route
  // of earlier edges (admissible corridor A*), and road jitter uses a plateau
  // envelope, so two roads to the same destination share one drawn road.
  // v40: bank MAIN BRANCHES — one deterministic city per bank network hosts a
  // grand 3-storey bank hall (kind "mainbank", its own city block) with a row
  // of teller chests and banker staff; the city's bank job moved onto it.
  // v41: bank networks follow the ROAD WEB (features.js roadNetId), not the
  // terrain flood — road-isolated cities (Keolwulfduun) become their own
  // networks and gain their own main-branch hall, so city layouts change.
  // v42: WORLD name registry — settlement/landmark names are now allocated
  // per 15000²-tile world (unique within a world, disjoint from all 8
  // neighbours); nearly every name changed and labels embed names.
  // v43: bank networks span the WHOLE road web (features.js dropped the
  // trunk-length and sea-deck edge cutoffs) — cities that were their own
  // network's main branch (Hegestesduun, Easthuus…) lose their grand bank
  // hall to Newhaven's, so their city layouts change.
  // v44: gem-vein tiers are cubic-rarity-biased (mineExtraNode) — Quartz
  // boulders most abundant, high tiers rare — so wild node scatter changes.
  // v45: Tūhura Isle rework — erosion no longer mangles the hand carve
  // (erosion.js restores the analytic isle elevation), staged water art,
  // straight waist gate-fences + water-edge posts, clean flush bridge deck.
  // Persisted isle chunks hold the old ragged ground/decor.
  // v46: isle round 2 — private deepening OCEAN out to D<130 (no foreign
  // land in sight), waist/river fences march out to the D<14 line, whitebait
  // PEN fence + gate, forge terrace = 1 iron + 1 tin, undertow removed.
  // v47: the whitebait boundary moved to the NORTH WEIR (nGateRow now fences
  // the channel too, with a mid-channel ride-through water gate); the
  // south-of-bridge pen row is gone.
  // v48: the offshore RING — a fence boom circling the isle at D 6.8..7.8
  // closing every zone's water into a pen; waist columns/river rows now end
  // at the ring (D<7.8) instead of D<14.
  // v49: SQUARE pens — the organic D-band ring is replaced by one straight
  // rectangular frame (PENF) + full-height waist columns; weir rows span
  // column-to-column. Unique node ids (nodeSeq) also land here.
  // v50: Tūhura pod content round — bank camp gains trees (pail planks),
  // Farm Vale gains cows + extra quail/hens; persisted isle chunks lack the
  // new stamps.
  // v51: NZ native birds — TUT_TAME now keeps bird spawns on the isle and a
  // deterministic bird scatter seeds every isle land chunk; persisted chunks
  // hold spawnDefs from before the strip whitelist grew, i.e. bird-free.
  // v52: isle NATIVE BUSH — every pod thickets up with native-skinned treeT0
  // trees + undergrowth (sprv species skins), and the bird scatter grows to
  // ~8/chunk weighted toward fliers; persisted isle chunks lack all of it.
  // v53: keeper sightlines — no bush trees within 7 tiles of a tutor's post
  // (undergrowth to 3), so the orbiting camera can never lose an NPC behind
  // a crown; v52 isle chunks may have planted right up against them.
  // v54: truthful tree labels — the isle bush is REAL nzt_* natives (proper
  // names + Woodcutting reqs) instead of species-skinned "Tree" nodes, and
  // demoted trees shed their skins; v52/v53 chunks are full of mislabelled
  // treeT0+sprv plants.
  // v55: warden's pit loses its lion (the archery lesson is now the isle's
  // birds) and the Farm Vale loses its cows (milking moved wholly to the
  // Cook's herd); persisted chunks still hold both in their spawnDefs.
  // v56: the pit gains six stamped KOREKE (the slay-5-koreke archery lesson
  // needs guaranteed quail); v55 chunks lack them.
  // v57: bank chests in every second pod past the Banker's (7/9/11/13);
  // persisted chunks lack the new vault stamps.
  // v58: THE RINGED ISLE — Tūhura rebuilt as one circular island (ten outer
  // sectors, four middle chambers, the crown at the centre; radial river,
  // ring/spoke fences, weir arcs). Every old serpentine-chain chunk is void.
  // v59: SINGLE-FILE fences — the ring/spoke/weir lines are rasterized one
  // post wide (terrain.js _tutFenceBuild) instead of a distance band that
  // doubled tiles on diagonals; weir walking-lane moved to the camp bank.
  // v60: unique per-pod biomes, the RIVER GATE journey (gate 1 mid-channel,
  // weirs gone, bank-fenced upstream corridor, spokes into the surf), the
  // Harbour Village (pod 14 tents + evening keepers), the Smith's fuelled
  // furnace, and the Swim-Master's per-character ISLET (whose zone is never
  // persisted — see _persistChunk).
  //
  // AUTO-VERSIONED (2026-09-16, supersedes the hand-bumped -vNN scheme): the
  // store name carries WORLDGEN_SIG, a build-time hash of every world-gen
  // source (tools/build.mjs GEN_FILES — terrain/erosion/chunks/features/
  // world/tutorial/biome-tiles/nz-trees). ANY edit to the isle or to world
  // generation re-keys the cache on the next build, so persisted chunks can
  // never go stale against the code — no manual bump, ever. Stale
  // generations are swept below by enumeration.
  const _IDB_NAME = 'ioe-chunks-' + (typeof WORLDGEN_SIG !== 'undefined' ? WORLDGEN_SIG : 'dev');
  // Sweep persisted caches from PREVIOUS generations of this store: any DB
  // sharing the prefix under a different name is dead weight — enumeration
  // catches every past name, hashed and hand-versioned (-vNN) alike.
  function _sweepStaleIDB(prefix, keep) {
    try {
      if (indexedDB.databases)
        indexedDB.databases().then(dbs => {
          for (const d of dbs || [])
            if (d && d.name && d.name.startsWith(prefix) && d.name !== keep)
              try { indexedDB.deleteDatabase(d.name); } catch (e) { /* best effort */ }
        }).catch(() => { /* enumeration unsupported */ });
    } catch (e) { /* best effort */ }
  }
  _sweepStaleIDB('ioe-chunks-', _IDB_NAME);
  let _db = null;
  function _openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const r = indexedDB.open(_IDB_NAME, 1);
      r.onupgradeneeded = e => e.target.result.createObjectStore('c');
      r.onsuccess = e => { _db = e.target.result; res(_db); };
      r.onerror = e => rej(e.target.error);
    });
  }
  function _ck(cx, cy) { return `${S}/${cx},${cy}`; }
  // Does this chunk touch the Swim-Master's isletZone (terrain.js)? The
  // motu's seat is PER-CHARACTER, so its chunks are never persisted and
  // never worker-injected — they must always be computed fresh against the
  // live TUT_ISLE.islet on the main thread.
  function _inIsletZone(cx, cy) {
    if (typeof TUT_ISLE === "undefined" || !TUT_ISLE.isletZone) return false;
    const Z = TUT_ISLE.isletZone;
    const x0 = cx * CHUNK * 0.5, y0 = cy * CHUNK * 0.5;
    return x0 < Z.x1 && x0 + CHUNK * 0.5 > Z.x0 && y0 < Z.y1 && y0 + CHUNK * 0.5 > Z.y0;
  }
  // Drop every chunk whose bounds intersect the GAME-coord rect — live map,
  // warm worker fields and the IDB cache together. Used by the tutorial when
  // the islet re-seats for a newly chosen body (Tutorial.isletSync).
  function dropChunkRect(gx0, gy0, gx1, gy1) {
    const c0x = Math.floor(gx0 / CHUNK), c1x = Math.floor(gx1 / CHUNK);
    const c0y = Math.floor(gy0 / CHUNK), c1y = Math.floor(gy1 / CHUNK);
    const hit = [];
    for (let cy = c0y; cy <= c1y; cy++)
      for (let cx = c0x; cx <= c1x; cx++) hit.push(cx + "," + cy);
    for (const k of hit) { chunks.delete(k); pendingFields.delete(k); }
    _openDB().then(db => {
      const tx = db.transaction('c', 'readwrite');
      for (const k of hit) {
        const [cx, cy] = k.split(",");
        tx.objectStore('c').delete(_ck(+cx, +cy));
      }
    }).catch(() => { /* cache miss is fine */ });
  }
  function _persistChunk(cx, cy, ch) {
    if (_inIsletZone(cx, cy)) return; // character-dependent geometry — never cache
    _openDB().then(db => {
      const tx = db.transaction('c', 'readwrite');
      tx.objectStore('c').put({
        g: ch.ground, d: ch.decor, b: ch.blocked,
        n: ch.nodes, s: ch.spawnDefs, bl: ch.buildings, la: ch.labels,
      }, _ck(cx, cy));
    }).catch(() => {});
  }
  // Load a specific set of "cx,cy" chunk keys from IDB into the in-memory Map.
  // Called at startup with the full seenChunks set so synchronous getChunk()
  // always finds a hot entry for every previously-explored chunk.
  async function preloadSeen(keys) {
    let db;
    try { db = await _openDB(); } catch { return; }
    const todo = [...keys].filter(k => !chunks.has(k));
    if (!todo.length) return;
    // one shared transaction for the whole batch — a transaction per key made
    // a ~100-chunk boot hydration pay ~100x the IDB setup overhead
    const store = db.transaction('c', 'readonly').objectStore('c');
    let _hyd = 0; // loading-bar sub-progress (boot's "Restoring explored lands…")
    await Promise.all(todo.map(key => new Promise(res => {
      const [ccx, ccy] = key.split(',').map(Number);
      const r = store.get(_ck(ccx, ccy));
      r.onsuccess = e => {
        const dt = e.target.result;
        // never clobber a chunk that was generated (or hydrated) while this
        // async read was in flight — it may already hold live runtime state
        if (dt && !chunks.has(key)) {
          const hyd = {
            cx: ccx, cy: ccy,
            ground: dt.g, decor: dt.d, blocked: new Uint8Array(dt.b),
            nodes: dt.n, spawnDefs: dt.s, buildings: dt.bl, labels: dt.la,
            activated: false,
          };
          chunks.set(key, hyd);
          deriveNpcs(hyd); // shopkeepers exist for cached chunks too
        }
        _hyd++;
        if ((_hyd & 7) === 0 && typeof window !== "undefined" && window.__boot)
          __boot.sub("preloadSeen", _hyd / todo.length);
        res();
      };
      r.onerror = res;
    })));
  }
  // Persist a single explored chunk to IDB. Called from markSeen() in main.js
  // when the player first enters a chunk — not on every getChunk() call.
  function persistChunk(cx, cy) {
    const ch = chunks.get(`${cx},${cy}`);
    if (ch) _persistChunk(cx, cy, ch);
  }
  // Keep the in-memory chunk Map bounded: far-away chunks are persisted (so
  // crops/node state survive) and dropped; they re-hydrate from IDB or
  // regenerate deterministically when approached again. Without this, a long
  // session (or a big cheat-mode reveal radius) retains every chunk ever
  // touched and eventually OOM-crashes the tab.
  const CHUNK_MEM_CAP = 600;
  function pruneChunks(pcx, pcy) {
    if (chunks.size <= CHUNK_MEM_CAP) return;
    for (const [key, ch] of chunks) {
      if (Math.abs(ch.cx - pcx) > 10 || Math.abs(ch.cy - pcy) > 10) {
        _persistChunk(ch.cx, ch.cy, ch);
        chunks.delete(key);
        if (chunks.size <= CHUNK_MEM_CAP - 150) break;
      }
    }
  }

  // ---------- hydraulic erosion (SimpleHydrology port) ----------
  // runErosion + the pass-1/2 field build moved to world/erosion.js
  // (computeChunkFields), shared verbatim with the chunk-field warm worker so
  // worker-precomputed and synchronously-built terrain can never drift apart.
  // The terrain field functions it samples, bundled for the shared code:
  const _fieldCtx = { S, fbm, elevation, humidity, temperature, farmField, civField, weirdField, classify };

  // ---- worker-precomputed terrain fields (render3d syncChunkWorker) ----
  // The worker runs getChunk's passes 1-2 (eroded elevation grid + biome
  // classification — the expensive noise half of a chunk data build) off the
  // main thread ahead of the player and posts the grids back; getChunk then
  // consumes the pending entry instead of recomputing. Same shared code +
  // same seed = identical numbers, so either path yields the same chunk.
  const pendingFields = new Map(); // "cx,cy" -> { eG, bG, tfG }
  function _fieldInject(key, f) {
    if (chunks.has(key) || pendingFields.has(key)) return; // generated first / dupe
    // the islet zone is character-dependent — the worker computed it against
    // the DEFAULT seat, so its fields can't be trusted; compute locally
    { const [cx, cy] = key.split(",").map(Number); if (_inIsletZone(cx, cy)) return; }
    if (pendingFields.size > 256) pendingFields.clear();   // warmed but never visited
    pendingFields.set(key, {
      eG: new Float32Array(f.eG), bG: new Int16Array(f.bG), tfG: new Float32Array(f.tfG),
    });
  }

  // ---- shopkeeper NPCs, derived from persisted building records ----
  // Every trader building gets a shopkeeper, and station buildings roll a 35%
  // chance of one too; the shop TYPE (general store / woodcutter / armoury /
  // …, see market.js SHOP_TYPES) is hash-picked per building. Because this is
  // pure derivation from ch.buildings, it runs for chunks HYDRATED from the
  // cache as well as freshly generated ones — NPCs aren't persisted, and they
  // used to silently vanish from cached chunks after a reload.
  const npcDerived = new Set(); // building key -> already spawned this session
  function deriveNpcs(ch) {
    // zone-unique names for pooled townsfolk (world/npc-names.js): clerks &
    // shopkeepers draw from the flat "villager" pool; a duplicate within the
    // zone is swapped for another unused villager name. Named singletons (Sten,
    // Registrar, Weaver, quest givers) keep their curated-unique names.
    const npcName = (x, y, base, culture) =>
      (typeof NpcNames !== "undefined" ? NpcNames.pick(x, y, "npc:" + x + "," + y, base, culture || "villager") : base);
    // hand-authored Lua quest givers near the Newhaven plaza (world/
    // quest-anchors.js) — rooted, _script-tagged; each gated to its own chunk.
    if (typeof deriveQuestGivers === "function") deriveQuestGivers(ch, npcs, npcDerived, CHUNK, PX);
    // Tūhura Isle tutors (gameplay/tutorial.js): derived exactly like
    // shopkeepers — pure position data, so hydrated chunks get them too.
    // They stand still; ui.js talkTo routes npc.tutor to the Tutorial module.
    if (typeof TUT_ISLE !== "undefined" && typeof TUT_TUTORS !== "undefined") {
      for (let ti = 0; ti < TUT_TUTORS.length; ti++) {
        const tu = TUT_TUTORS[ti];
        const pod = TUT_ISLE.pods[tu.pod];
        // once the staged evening has fallen, a finished keeper's home is
        // their Harbour Village seat (Tutorial.villageHome) — so a chunk
        // hydrated at night derives them already settled in the village
        const vh = (typeof Tutorial !== "undefined" && Tutorial.villageHome)
          ? Tutorial.villageHome(tu.id) : null;
        // Sigrid's post moves with the story (pier / campfire / pier) —
        // Tutorial.ferryPost() mirrors _villageSync's same logic
        const post = (tu.id === "ferry" && typeof Tutorial !== "undefined" && Tutorial.ferryPost)
          ? Tutorial.ferryPost() : { dx: tu.dx, dy: tu.dy };
        const x = vh ? vh.x : pod.mx * 2 + post.dx;
        const y = vh ? vh.y : pod.my * 2 + post.dy;
        if (x < ch.cx * CHUNK || x >= (ch.cx + 1) * CHUNK ||
            y < ch.cy * CHUNK || y >= (ch.cy + 1) * CHUNK) continue;
        const tkey = "tut:" + tu.id;
        if (npcDerived.has(tkey)) continue;
        npcDerived.add(tkey);
        // defensive: never double-spawn a tutor even if npcDerived's guard
        // was somehow bypassed (e.g. a background/worker chunk-generation
        // pass with its own Set instance) — a duplicate standing right on
        // another tutor's bed tile permanently blocks the real one from
        // ever reaching it (user-reported: "stuck at the bottom of the
        // ladder", 2026-09-17)
        if (npcs.some(n => n.tutor === tu.id)) continue;
        // each tutor IS a real MIX roster character (TUT_MIX_DEF, shared with
        // the Tutorial module so dialogue/bar/gate messages agree) — the
        // nameplate shows their own name with the tutorial title appended.
        // Legacy spr layers + Māori names stay as the roster-less fallback.
        let mixKey, mixTitle, name = tu.name + " the " + tu.role;
        const def = (typeof TUT_MIX_DEF === "function") ? TUT_MIX_DEF(ti) : null;
        if (def && def.key) {
          mixKey = def.key;
          mixTitle = tu.role;
          if (def.name) name = def.name + " the " + tu.role;
        }
        // rooted at the lesson post (still teaching); un-rooted + bedded once
        // already settled into the village (vh truthy) — mirrors tutorial.js's
        // _villageSync/offDutyIfy for chunks hydrated after the fact
        const vb = (vh && typeof Tutorial !== "undefined" && Tutorial.villageBed) ? Tutorial.villageBed(tu.id) : null;
        npcs.push({
          name, x, y, px: PX(x), py: PX(y),
          look: mixKey ? -1 : tu.look % VILLAGER_LOOKS.length,
          spr: mixKey ? undefined : VILLAGER_LOOKS[tu.look % VILLAGER_LOOKS.length],
          mix: mixKey, mixTitle,
          dir8: "south",
          _mid: "tut" + tu.id, _home: [x, y],
          _r: vh ? 6 : 0,
          _wanderAt: (typeof performance !== "undefined" ? performance.now() : 0) + (vh ? 800 + Math.random() * 3000 : 9e9),
          _mt: 0, level: 0,
          tutor: tu.id,
          line: vh && typeof Tutorial !== "undefined" && Tutorial.offDutyLine
            ? Tutorial.offDutyLine(tu.id)
            : `"Haere mai! Come, let me show you something."`,
          ...(vb ? { _bed: [vb.x, vb.y], _bedLevel: vb.level, _ladder: vb.ladder, _owns: vb.owns } : {}),
        });
      }
    }
    // Newhaven's Registrar — the ONE keeper in the wide world (besides Tūhura
    // Isle's first keeper) who reopens the character/appearance chooser. Stands
    // in the plaza a step from where graduates arrive (playerStart 1,2; the
    // fountain seat is 0,0), rooted so newcomers always find them. Named after
    // their own sprite with the title appended, exactly like the isle keepers.
    if (typeof MIX_NPCS !== "undefined" && MIX_NPCS && MIX_NPCS.list && MIX_NPCS.list.length) {
      const RX = 2, RY = 2, rkey = "newhaven:registrar";
      if (RX >= ch.cx * CHUNK && RX < (ch.cx + 1) * CHUNK &&
          RY >= ch.cy * CHUNK && RY < (ch.cy + 1) * CHUNK && !npcDerived.has(rkey)) {
        npcDerived.add(rkey);
        const rdef = MIX_NPCS.list[0]; // a stable, scholarly roster face
        npcs.push({
          name: (rdef && rdef.name ? rdef.name : "The") + " the Registrar",
          x: RX, y: RY, px: PX(RX), py: PX(RY),
          look: -1, mix: rdef && rdef.key, mixTitle: "Registrar",
          dir8: "south",
          _mid: "newhavenReg", _home: [RX, RY], _r: 0, // rooted: always by the fountain
          _wanderAt: (typeof performance !== "undefined" ? performance.now() : 0) + 9e9,
          _mt: 0,
          charselect: true,
          line: `"New to Newhaven, or after a new face? I keep the register of forms — step up and choose."`,
        });
      }
    }
    // Te Kairaranga, the Weaver — the chant-magic teacher (gameplay/wizard.js).
    // Two rooted bodies, same soul: one across the plaza from the Registrar,
    // one inside their own tower (stamped by this file's POI pass at
    // Wizard.towerPos(), a cheap deterministic spot outside Newhaven).
    if (typeof MIX_NPCS !== "undefined" && MIX_NPCS && MIX_NPCS.list && MIX_NPCS.list.length) {
      const wdef = MIX_NPCS.list[7 % MIX_NPCS.list.length];
      const weaver = (x, y, mid, line) => ({
        name: (wdef && wdef.name ? wdef.name : "The") + " the Weaver",
        x, y, px: PX(x), py: PX(y),
        look: -1, mix: wdef && wdef.key, mixTitle: "Weaver",
        dir8: "south",
        _mid: mid, _home: [x, y], _r: 0, // rooted
        _wanderAt: (typeof performance !== "undefined" ? performance.now() : 0) + 9e9,
        _mt: 0,
        wizard: true,
        line,
      });
      const WX = -2, WY = 2, wkey = "newhaven:weaver";
      if (WX >= ch.cx * CHUNK && WX < (ch.cx + 1) * CHUNK &&
          WY >= ch.cy * CHUNK && WY < (ch.cy + 1) * CHUNK && !npcDerived.has(wkey)) {
        npcDerived.add(wkey);
        npcs.push(weaver(WX, WY, "newhavenWeaver",
          `"You hear the hum too, eh? Come — the weave wants speaking to."`));
      }
      const wt = (typeof Wizard !== "undefined" && Wizard.towerPos) ? Wizard.towerPos() : null;
      if (wt) {
        const tkey = "weaver:tower";
        if (wt.x >= ch.cx * CHUNK && wt.x < (ch.cx + 1) * CHUNK &&
            wt.y >= ch.cy * CHUNK && wt.y < (ch.cy + 1) * CHUNK && !npcDerived.has(tkey)) {
          npcDerived.add(tkey);
          npcs.push(weaver(wt.x, wt.y, "towerWeaver",
            `"Mind the bookshelves — some of them bite."`));
        }
      }
    }
    // Easter-egg dwellers (gameplay/eggs.js): every hermitage POI keeps its
    // Hermit (he names your split selves) and every graveyard POI its
    // gravedigger, Kurt, who ends every line the same way. Derived like the
    // Registrar — pure position data off the POI lattice, so hydrated chunks
    // keep them; npc-chat.js routes their Enter-chat through Eggs.npcReply.
    // PCELL is world.js's POI-grid const (initialized long before any chunk
    // derives); poiInfo seats are MAP coords, NPCs live in GAME coords (×2).
    {
      const mX0 = ch.cx * CHUNK / 2, mY0 = ch.cy * CHUNK / 2;
      for (let pcy = Math.floor(mY0 / PCELL); pcy * PCELL < mY0 + CHUNK / 2; pcy++)
        for (let pcx = Math.floor(mX0 / PCELL); pcx * PCELL < mX0 + CHUNK / 2; pcx++) {
          const p = poiInfo(pcx, pcy);
          if (!p || (p.type !== "hermitage" && p.type !== "graveyard")) continue;
          const gx = p.x * 2 + 2, gy = p.y * 2 + 2;
          if (gx < ch.cx * CHUNK || gx >= (ch.cx + 1) * CHUNK ||
              gy < ch.cy * CHUNK || gy >= (ch.cy + 1) * CHUNK) continue;
          const ekey = "egg:" + p.type + ":" + pcx + "," + pcy;
          if (npcDerived.has(ekey)) continue;
          npcDerived.add(ekey);
          const herm = p.type === "hermitage";
          const lk = hash2i(pcx, pcy, S ^ 0xe661) % VILLAGER_LOOKS.length;
          npcs.push({
            name: herm ? "the Hermit" : "Kurt the Gravedigger",
            x: gx, y: gy, px: PX(gx), py: PX(gy),
            look: lk, spr: VILLAGER_LOOKS[lk],
            dir8: "south",
            _mid: ekey, _home: [gx, gy], _r: herm ? 2 : 4,
            _mt: 0,
            _egg: herm ? "hermit" : "soitgoes",
            talksFirst: true,
            line: herm
              ? `"Come closer. I name things — it's the one habit the silence never asked me to give up."`
              : `"Busy trade, mine. So it goes."`,
          });
        }
    }
    // the Heart of the Dream's villagers (gameplay/dream.js): the Matron (a
    // one-time gift + the sung way home) and the Somnolent Pedlar (the dream
    // shop, npc.alwaysOpen — no closing hours at the bottom of a dream).
    // Derived like the Registrar: pure fixed positions off DREAM_WORLD, so
    // hydrated Heart chunks keep them.
    if (typeof DREAM_WORLD !== "undefined" && typeof MIX_NPCS !== "undefined" &&
        MIX_NPCS && MIX_NPCS.list && MIX_NPCS.list.length) {
      const HCx = Math.round(DREAM_WORLD.HEART.cx * 2), HCy = Math.round(DREAM_WORLD.HEART.cy * 2);
      const face = (want, fb) => MIX_NPCS.list.find(m => m.title && m.title.includes(want)) ||
        MIX_NPCS.list[fb % MIX_NPCS.list.length];
      const seatDream = (dx, dy, key, mid, def, name, title, extra, line) => {
        const x = HCx + dx, y = HCy + dy;
        if (x < ch.cx * CHUNK || x >= (ch.cx + 1) * CHUNK ||
            y < ch.cy * CHUNK || y >= (ch.cy + 1) * CHUNK || npcDerived.has(key)) return;
        npcDerived.add(key);
        npcs.push({
          name, x, y, px: PX(x), py: PX(y),
          look: -1, mix: def && def.key, mixTitle: title,
          dir8: "south",
          _mid: mid, _home: [x, y], _r: 0, // rooted — the Heart keeps its people
          _wanderAt: (typeof performance !== "undefined" ? performance.now() : 0) + 9e9,
          _mt: 0,
          ...extra,
          line,
        });
      };
      const mdef = face("Wisp Bard", 11);
      seatDream(1, -1, "dream:matron", "dreamMatron", mdef,
        "the Matron of the Heart", "Matron", { dreamNpc: "matron" },
        `"Welcome, walker. Few find the way down — fewer still by accident."`);
      const pdef = face("Owlin Wizard", 23);
      seatDream(7, 2, "dream:pedlar", "dreamPedlar", pdef,
        "the Somnolent Pedlar", "Pedlar", { dreamNpc: "pedlar", trader: true, shopType: "dream", alwaysOpen: true },
        `"Open at all hours. There is only one hour here, and it is always it."`);
    }
    for (const b of ch.buildings || []) {
      const bkey = b.x0 + "," + b.y0;
      if (npcDerived.has(bkey)) continue;
      // the MAIN BRANCH bank hall staffs a counter of BANKERS instead of a
      // lone keeper — talking to one opens/serves a bank account (ui.js)
      if (b.kind === "mainbank") {
        const lii2 = (x, y) => (y - ch.cy * CHUNK) * CHUNK + (x - ch.cx * CHUNK);
        const inThis2 = (x, y) => x >= ch.cx * CHUNK && x < (ch.cx + 1) * CHUNK &&
          y >= ch.cy * CHUNK && y < (ch.cy + 1) * CHUNK;
        const spots = [];
        // clerks stand one row in front of the teller chests (back wall + 2),
        // spaced along the counter; fall back to deeper rows if furnished over
        outer2: for (let dy = 2; dy <= b.h - 2 && spots.length < 3; dy++)
          for (let dx = 1; dx <= b.w - 2; dx += 3) {
            const x = b.x0 + dx, y = b.y0 + dy;
            if (!inThis2(x, y)) continue;
            if (!String(ch.ground[lii2(x, y)]).startsWith("floor")) continue;
            if (ch.blocked[lii2(x, y)] === 1 || ch.decor[lii2(x, y)]) continue;
            if (ch.nodes.some(n => n.x === x && n.y === y)) continue;
            if (npcs.some(n => n.x === x && n.y === y)) continue;
            spots.push({ x, y });
            if (spots.length >= 3) break outer2;
          }
        if (!spots.length) continue;
        npcDerived.add(bkey);
        spots.forEach((sp, i) => {
          const look = hash2i(b.x0 + i * 17, b.y0, S ^ 0xb4a2) % VILLAGER_LOOKS.length;
          npcs.push({
            name: npcName(sp.x, sp.y, VILLAGER_NAMES[hash2i(b.x0 + i * 13, b.y0, S ^ 0xb4a1) % VILLAGER_NAMES.length]),
            x: sp.x, y: sp.y, look, spr: VILLAGER_LOOKS[look],
            banker: true,
            line: `"Welcome to the bank. Might I interest you in an account?"`,
          });
        });
        continue;
      }
      // a village bank on a tiny CITY-LESS road web ("Bank of Braadford and
      // Hildford") is a staffed co-op counter: one clerk who can open the
      // account (ui.js bankerTalk) — there is no city main branch to sign at
      if (b.job === "bank" && typeof bankNetAt === "function") {
        const net = bankNetAt(b.x0, b.y0);
        const coop = net && typeof net === "string" && net.startsWith("roadnet:") &&
          !mainBranchFor(net) && bankNetInfo(net);
        if (coop) {
          const lii3 = (x, y) => (y - ch.cy * CHUNK) * CHUNK + (x - ch.cx * CHUNK);
          const inThis3 = (x, y) => x >= ch.cx * CHUNK && x < (ch.cx + 1) * CHUNK &&
            y >= ch.cy * CHUNK && y < (ch.cy + 1) * CHUNK;
          const inRooms3 = (x, y) => !b.rooms || b.rooms.some(r =>
            x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1);
          let spot = null;
          outer3: for (let dy = 2; dy <= b.h - 2; dy++)
            for (let dx = 1; dx <= b.w - 2; dx++) {
              const x = b.x0 + dx, y = b.y0 + dy;
              if (!inThis3(x, y) || !inRooms3(x, y)) continue;
              if (!String(ch.ground[lii3(x, y)]).startsWith("floor")) continue;
              if (ch.blocked[lii3(x, y)] === 1 || ch.decor[lii3(x, y)]) continue;
              if (ch.nodes.some(n => n.x === x && n.y === y)) continue;
              if (npcs.some(n => n.x === x && n.y === y)) continue;
              spot = { x, y }; break outer3;
            }
          if (spot) {
            npcDerived.add(bkey);
            const look = hash2i(b.x0, b.y0, S ^ 0xb4a2) % VILLAGER_LOOKS.length;
            npcs.push({
              name: npcName(spot.x, spot.y, VILLAGER_NAMES[hash2i(b.x0, b.y0, S ^ 0xb4a1) % VILLAGER_NAMES.length]),
              x: spot.x, y: spot.y, look, spr: VILLAGER_LOOKS[look],
              banker: true,
              line: `"Welcome to the ${coop.title}. Might I interest you in an account?"`,
            });
            continue;
          }
        }
      }
      const KEYS = (typeof SHOP_TYPE_KEYS !== "undefined") ? SHOP_TYPE_KEYS : ["general"];
      let type = null;
      if (b.job === "trader") {
        // the settlement's designated trader is USUALLY the general store;
        // the rest of the variety comes from station-building shopkeepers
        type = hash2i(b.x0, b.y0, S ^ 0x5107) % 3 !== 0 ? "general"
          : KEYS[hash2i(b.x0, b.y0, S ^ 0x5108) % KEYS.length];
      } else if (b.job && STATIONS[b.job] && hash2i(b.x0, b.y0, S ^ 0x5109) % 100 < 35) {
        type = KEYS[hash2i(b.x0, b.y0, S ^ 0x510a) % KEYS.length];
      }
      if (!type) continue;
      // the keeper stands on a free interior floor tile, preferring the front
      const lii = (x, y) => (y - ch.cy * CHUNK) * CHUNK + (x - ch.cx * CHUNK);
      const inThis = (x, y) => x >= ch.cx * CHUNK && x < (ch.cx + 1) * CHUNK &&
        y >= ch.cy * CHUNK && y < (ch.cy + 1) * CHUNK;
      const inRoomsK = (x, y) => !b.rooms || b.rooms.some(r =>
        x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1);
      let spot = null;
      outer: for (let dy = b.h - 2; dy >= 1; dy--)
        for (let dx = b.w - 2; dx >= 1; dx--) {
          const x = b.x0 + dx, y = b.y0 + dy;
          if (!inThis(x, y) || !inRoomsK(x, y)) continue;
          if (!String(ch.ground[lii(x, y)]).startsWith("floor")) continue;
          if (ch.blocked[lii(x, y)] === 1 || ch.decor[lii(x, y)]) continue;
          if (ch.nodes.some(n => n.x === x && n.y === y)) continue;
          if (npcs.some(n => n.x === x && n.y === y)) continue;
          spot = { x, y }; break outer;
        }
      if (!spot) continue;
      npcDerived.add(bkey);
      const origin = b.job === "trader" && Math.abs(b.x0) < 70 && Math.abs(b.y0) < 70;
      const st = (typeof SHOP_TYPES !== "undefined") ? SHOP_TYPES[origin ? "general" : type] : null;
      npcs.push({
        name: origin ? "Sten" : npcName(spot.x, spot.y, VILLAGER_NAMES[hash2i(b.x0, b.y0, S ^ 7) % VILLAGER_NAMES.length]),
        x: spot.x, y: spot.y,
        look: origin ? -1 : hash2i(b.x0, b.y0, S ^ 9) % VILLAGER_LOOKS.length,
        spr: origin ? [["body_npc"], ["shirt_orange"], ["hat_white"]] :
          VILLAGER_LOOKS[hash2i(b.x0, b.y0, S ^ 9) % VILLAGER_LOOKS.length],
        trader: true, shopType: origin ? "general" : type,
        line: (st && st.line) || `"Welcome! Buy tools, sell me your goods."`,
      });
    }
  }

  // rolling log of chunk generation times (perf triage; read via world._genLog)
  const genLog = [];
  function getChunk(ccx, ccy) {
    const key = ccx + "," + ccy;
    let ch = chunks.get(key);
    if (ch) return ch;
    const _t0 = performance.now();
    const rng = mulberry32((S ^ Math.imul(ccx, 0x9E3779B1) ^ Math.imul(ccy, 0x85EBCA77)) >>> 0);
    const bx = ccx * CHUNK, by = ccy * CHUNK;
    const N = CHUNK * CHUNK;
    const ground = new Array(N);
    const decor = new Array(N).fill(null);
    const blocked = new Uint8Array(N);
    const nodes = [];
    const spawnDefs = [];
    const buildings = [];
    // every footprint stamped into this chunk, even when the record's owner
    // (its centre) lives in a neighbouring chunk — used to keep fishing spots
    // and other water decor out of river-building undercrofts
    const stampedFeet = [];
    const labels = [];
    const li = (x, y) => (y - by) * CHUNK + (x - bx);
    const inCh = (x, y) => x >= bx && x < bx + CHUNK && y >= by && y < by + CHUNK;

    // --- field grids (chunk + 1 margin) ---
    // passes 1-2 (raw elevation, erosion, biome classify) live in
    // world/erosion.js computeChunkFields; a worker-warmed chunk finds its
    // grids pre-computed in pendingFields and skips straight to stamping
    const GS = CHUNK + 3;
    const pre = pendingFields.get(key);
    if (pre) pendingFields.delete(key);
    const { eG, bG, tfG } = pre || computeChunkFields(_fieldCtx, CHUNK, ccx, ccy);
    const G = (tx, ty) => (ty + 1) * GS + (tx + 1);

    // river and road detection via polyline proximity (map coords = game coords / 2)
    const bxM = bx * 0.5, byM = by * 0.5, csM = CHUNK * 0.5;
    const chRivs = riversNear(bxM - 12, byM - 12, bxM + csM + 12, byM + csM + 12);
    const chRoads = roadsNear(bxM - 8, byM - 8, bxM + csM + 8, byM + csM + 8);
    const riverAt = (wx, wy) => {
      const mx = wx * 0.5, my = wy * 0.5;
      // the Dream Forest interior is dry by carve (terrain.js DREAM_WORLD) —
      // a lattice river polyline crossing the region must not paint water
      // through a level disc or a waystone glade
      if (typeof dreamZoneAtMap === "function" && dreamZoneAtMap(mx, my)) return false;
      for (const rv of chRivs)
        for (const pts of rv.polys)
          if (nearPoly(pts, mx, my, 0)) return true;
      return false;
    };
    const roadAt = (wx, wy) => {
      const mx = wx * 0.5, my = wy * 0.5;
      for (const rp of chRoads)
        if (nearPoly(rp.pts, mx, my, ROAD_W)) return true;
      return false;
    };
    // river within r map units (2r game tiles) — the bridge deck spans the
    // whole bank slope, not just the water
    const riverNearAt = (wx, wy, r) => {
      const mx = wx * 0.5, my = wy * 0.5;
      for (const rv of chRivs)
        for (const pts of rv.polys)
          if (nearPoly(pts, mx, my, r)) return true;
      return false;
    };
    // water test usable slightly outside the chunk (for pier spacing): eroded
    // grid inside the margin, raw elevation beyond it
    const watAt = (wx, wy) => {
      const tx = wx - bx, ty = wy - by;
      const e = (tx >= -1 && tx <= CHUNK + 1 && ty >= -1 && ty <= CHUNK + 1)
        ? eG[G(tx, ty)] : elevation(wx * 0.5, wy * 0.5);
      return e < LAND_E || riverAt(wx, wy);
    };
    // sea only (no rivers) — same eroded-grid-then-raw fallback as watAt
    const seaAt = (wx, wy) => {
      const tx = wx - bx, ty = wy - by;
      const e = (tx >= -1 && tx <= CHUNK + 1 && ty >= -1 && ty <= CHUNK + 1)
        ? eG[G(tx, ty)] : elevation(wx * 0.5, wy * 0.5);
      return e < LAND_E;
    };
    // any sea tile within 6 game tiles (stride-2 scan — the coast is coarse):
    // the cheap gate before the road∧sea crossing scan, mirroring riverNearAt
    const seaNearAt = (wx, wy) => {
      for (let ay = -6; ay <= 6; ay += 2)
        for (let ax = -6; ax <= 6; ax += 2)
          if (seaAt(wx + ax, wy + ay)) return true;
      return false;
    };
    const landAdj = (wx, wy) =>
      !watAt(wx + 1, wy) || !watAt(wx - 1, wy) || !watAt(wx, wy + 1) || !watAt(wx, wy - 1);

    const villages = villagesNear(bx / 2, by / 2, (bx + CHUNK) / 2, (by + CHUNK) / 2, 40);
    const inVillage = (x, y) => villages.find(v => {
      const dx = x - v.x, dy = y - v.y;
      return dx * dx + dy * dy < (v.R + 2) * (v.R + 2);
    });

    // --- terrain ---
    for (let ty = 0; ty < CHUNK; ty++)
      for (let tx = 0; tx < CHUNK; tx++) {
        const wx = bx + tx, wy = by + ty;
        const i = G(tx, ty), li2 = ty * CHUNK + tx;
        const e = eG[i];
        const sea = e < LAND_E;
        const river = !sea && riverAt(wx, wy);
        const road = roadAt(wx, wy);
        const tf = Math.min(1, Math.max(0, (tfG[i] - 0.5) * 1.8 + 0.5));
        let g;
        if (sea || river) {
          const wb = bG[i] === B.DEEP ? B.DEEP : bG[i] === B.REEF ? B.REEF : B.WATER;
          g = biomeGround(wb, wx, wy);
          // Tūhura Isle: staged water art. atlasVariantAt dithers the four
          // colour variants per tile — fine as land texture, but on water it
          // reads as a checkerboard and the river/lagoon/sea all scramble
          // together. On the isle each water body gets ONE fixed variant:
          // the freshwater river + interior pools vs the coastal shallows vs
          // the deep ring — so the river reads as a river and the estuary
          // boundary is a visible seam.
          if (typeof tutIsleSD === "function") {
            const tq = tutIsleSD(wx * 0.5, wy * 0.5);
            if (tq && tq.D < 24) {
              const fresh = tq.D < 0 ||
                (tq.pRiver >= 0 && tq.riverLine < TUT_ISLE.river.waterR + 1);
              g = fresh ? "at_1_2_6" : wb === B.DEEP ? "at_0_1_2" : "at_1_0_6";
            }
          }
          // bridge: the road crosses ON TOP of the water — a river, or a
          // shallow sea strait the router paid WATER_COST to ford. The ground
          // stays water (the channel runs unbroken underneath — boats sail
          // through); the stone_bridge decor marks the walkable deck, which
          // the renderer builds as real geometry (bank-top tier over rivers,
          // an elevated overpass with boat clearance over the sea).
          // "stone_bridge#p" = a solid 1-tile support pier. Beside the banks:
          // only where a mid-channel tile exists next to it (so a boat always
          // has a clear lane), staggered so they read as spaced piles. Out on
          // the open sea: a sparse 4-tile lattice of piles carries the long
          // span — the gaps between them stay sailable.
          if (road) {
            const pier = (landAdj(wx, wy) && ((wx + wy) & 1) === 0 &&
              [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([px, py]) =>
                watAt(wx + px, wy + py) && !landAdj(wx + px, wy + py)))
              || (sea && !landAdj(wx, wy) && (wx & 3) === 0 && (wy & 3) === 0);
            decor[li2] = pier ? "stone_bridge#p" : "stone_bridge";
          }
        } else if (road) {
          g = "dirt#1";                                         // path
          // bridge approach: the deck starts at the top of the bank and spans
          // the whole slope down to the water — but only around an actual
          // crossing (a road∧water tile nearby), so roads running alongside a
          // river or the coast don't become endless elevated boardwalks
          if (riverNearAt(wx, wy, 3) || seaNearAt(wx, wy)) {
            let nearCrossing = false;
            scan: for (let ay = -6; ay <= 6; ay++)
              for (let ax = -6; ax <= 6; ax++)
                if ((seaAt(wx + ax, wy + ay) || riverAt(wx + ax, wy + ay)) &&
                    roadAt(wx + ax, wy + ay)) {
                  nearCrossing = true; break scan;
                }
            if (nearCrossing) decor[li2] = "stone_bridge";
          }
        } else {
          const b = bG[i];
          g = biomeGround(b === B.FARM && inVillage(wx, wy) ? B.GRASS : b, wx, wy);
          // hedge maze walls on the 4-lattice — a CARVED maze (labgen.js):
          // perfect backtracker per supercell, braided ~10%, one gate per
          // supercell border, so it's a real winding labyrinth yet always
          // fully traversable
          if (b === B.LABYRINTH && labMaze.hedgeWallAt(wx, wy)) {
            decor[li2] = "bush#1";
            blocked[li2] = 1;
          }
        }
        ground[li2] = g;
        if (isWaterKey(g)) blocked[li2] = 1;
      }

    const isW = (x, y) => inCh(x, y) && isWaterKey(ground[li(x, y)]);
    const openTile = (x, y) => inCh(x, y) && !blocked[li(x, y)] && !decor[li(x, y)] &&
      !nodes.some(n => n.x === x && n.y === y) && !isWaterKey(ground[li(x, y)]) &&
      ground[li(x, y)] !== "floor_wood" && ground[li(x, y)] !== "dirt#1";
    const deco = (x, y, d, blk) => {
      if (!inCh(x, y)) return;
      decor[li(x, y)] = d;
      if (blk) blocked[li(x, y)] = 1;
    };
    // node ids MUST be unique for the mesh cache ("n"+id in render3d) — a
    // monotone counter, NOT nodes.length: the isle stamp pass dropNodes-
    // splices entries out, and length-based ids then get REUSED by later
    // addNode calls, so two nodes fought over one mesh every frame and the
    // later-iterated one rendered while the other stayed invisible (the
    // vanishing-forge-furnace bug).
    let nodeSeq = 0;
    const addNode = (type, x, y, blk = true, extra = {}) => {
      if (!inCh(x, y)) return null;
      const n = { id: key + ":" + (nodeSeq++), type, x, y, alive: true, ...extra };
      nodes.push(n);
      if (blk) blocked[li(x, y)] = 1;
      return n;
    };
    // A fishing spot for a specific fish, procedurally chosen for its depth band
    // (rarer fish rarer) with a 5-10 catch counter before it depletes.
    const addFishNode = (x, y, band) => {
      // (fallback fish is the mullet, 1, NOT whitebait, 0 — whitebait is estuary-only)
      if (typeof fishForBand !== "function") return addNode("fishspot_1", x, y, false, { left: 8, leftMax: 8 });
      const idx = fishForBand(band, rng());
      const left = 5 + Math.floor(rng() * 6);   // 5-10 fish before depletion
      return addNode("fishspot_" + idx, x, y, false, { left, leftMax: left });
    };
    // Scatter non-blocking prop billboards inside a stamped building. Interior
    // floor tiles are walkable (blocked 0/2); we skip walls (blocked 1), the
    // door gap, already-decorated tiles and station nodes. Props never block
    // movement (deco() with no blk flag), so furnishing can't trap the player.
    const furnishInterior = (b, items) => {
      if (!b) return;
      for (const [spr, dx, dy] of items) {
        const fx = b.x0 + dx, fy = b.y0 + dy;
        if (!inCh(fx, fy) || decor[li(fx, fy)] || blocked[li(fx, fy)] === 1) continue;
        if (!String(ground[li(fx, fy)]).startsWith("floor")) continue; // hollow river passage
        if (nodes.some(n => n.x === fx && n.y === fy)) continue;
        deco(fx, fy, spr);
      }
    };
    // Furnish a settlement building from its trade. Interior anchor slots hug the
    // perimeter (skipping the central station tile placed by placeJob) and adapt
    // to the footprint, so this works for any building 5x5 or larger.
    // Strategic interior slots, shared by trade shops and POI buildings. The
    // job station (when any) sits against the back (north) wall centre, so:
    // slots 1-2 flank it, then back corners, extra back spots on wide rooms,
    // runs down both side walls, front-corner accents last. The tile just
    // inside every door stays clear (river buildings may have side doors).
    const strategicSlots = (b) => {
      const w = b.w, h = b.h, cx2 = w >> 1;
      const excl = new Set();
      let spansRiver = false;
      for (let y = b.y0; y < b.y0 + b.h && !spansRiver; y++)
        for (let x = b.x0; x < b.x0 + b.w && !spansRiver; x++)
          if (riverAt(x, y)) spansRiver = true;
      if (spansRiver)
        for (const d2 of riverDoors(b.x0, b.y0, b.w, b.h)) {
          const [ox, oy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][d2.angle]; // inward
          excl.add((d2.x - b.x0 + ox) + "," + (d2.y - b.y0 + oy));
        }
      else excl.add(cx2 + "," + (h - 2)); // inside the south door
      const slots = [];
      const push2 = (x, y) => {
        if (x >= 1 && x <= w - 2 && y >= 1 && y <= h - 2 && !excl.has(x + "," + y) &&
            !slots.some(s2 => s2[0] === x && s2[1] === y)) slots.push([x, y]);
      };
      push2(cx2 - 1, 1); push2(cx2 + 1, 1);          // flank the station
      push2(1, 1); push2(w - 2, 1);                  // back corners
      if (w >= 9) { push2(cx2 - 2, 1); push2(cx2 + 2, 1); }
      for (let y = 2; y <= h - 3; y++) { push2(1, y); push2(w - 2, y); } // side-wall runs
      push2(1, h - 2); push2(w - 2, h - 2);          // front-corner accents
      return slots;
    };
    const furnishTrade = (b) => {
      // multi-room organic shop: stock the FIRST room (behind the exterior
      // door, where placeJob put the station); bbox corners may be courtyard
      if (b.rooms) b = { ...b, x0: b.rooms[0].x, y0: b.rooms[0].y,
        w: b.rooms[0].w, h: b.rooms[0].h, rooms: undefined };
      const list = TRADE_DECOR[b.job] || TRADE_DECOR._default;
      if (!list || !list.length) return;
      const w = b.w, h = b.h;
      if (w < 5 || h < 5) return;
      // long stock lists — casks, candles, sails — repeat down the wall runs
      // like a real shop's inventory
      const slots = strategicSlots(b);
      // signature items keep their flagship spots; the rest of the list
      // rotates by building so every variant surfaces somewhere in the world
      const rest = Math.max(1, list.length - 2);
      const off = hash2i(b.x0, b.y0, S ^ 0x5d3c) % rest;
      const items = [];
      for (let i = 0; i < slots.length; i++) {
        const key = i < 2 ? list[Math.min(i, list.length - 1)]
          : list.length <= 2 ? list[list.length - 1]
          : list[2 + ((off + i - 2) % rest)];
        items.push([key, slots[i][0], slots[i][1]]);
      }
      furnishInterior(b, items);
      // a shipyard also holds one hull on the stocks (rotated so all hulls show)
      if (b.job === "shipyard") {
        const hk = SHIP_FLEET[hash2i(b.x0, b.y0, S ^ 0x51a7) % SHIP_FLEET.length];
        furnishInterior(b, [[hk, 2, h - 3]]);
      }
    };

    // --- settlement stamping ---
    // multi-room organic building (citygrow.js): rooms are wall-inclusive
    // rects sharing 1-tile wall lines; b.door is the exterior door, b.idoors
    // the interior archways cut through shared walls. A tile is FLOOR if it
    // is interior to any room, WALL if it lies only on perimeters. Row-house
    // neighbours may share wall tiles across building records — whichever
    // chunk/record stamps first wins; both write identical masonry.
    const stampRoomsBuilding = (b, roof) => {
      for (const r of b.rooms)
        for (let y = r.y; y < r.y + r.h; y++)
          for (let x = r.x; x < r.x + r.w; x++)
            if (elevation(x * 0.5, y * 0.5) < LAND_E) return false;
      stampedFeet.push({ x0: b.x0, y0: b.y0, w: b.w, h: b.h });
      // ground-floor archways only: an upper-storey passage (d2.s > 0, the
      // Great Labyrinth's 3-D maze) stays a BLOCKED wall tile down here —
      // passable() opens it per-storey from the building meta instead
      const isIdoor = (x, y) => b.idoors &&
        b.idoors.some(d2 => d2.x === x && d2.y === y && (d2.s == null || d2.s === 0));
      const isIntr = (x, y) => b.rooms.some(r =>
        x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1);
      const isBld = (x, y) => b.rooms.some(r =>
        x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
      for (const r of b.rooms)
        for (let y = r.y; y < r.y + r.h; y++)
          for (let x = r.x; x < r.x + r.w; x++) {
            if (!inCh(x, y)) continue;
            const edge = (x === r.x || x === r.x + r.w - 1 || y === r.y || y === r.y + r.h - 1)
              && !isIntr(x, y); // interior of a neighbouring room beats our wall — never true by construction
            ground[li(x, y)] = b.stone ? "floor_stone" : "floor_wood";
            decor[li(x, y)] = null;
            blocked[li(x, y)] = 0;
            if (!edge) continue;
            if ((b.door.x === x && b.door.y === y) ||
                (b.door2 && b.door2.x === x && b.door2.y === y) ||
                isIdoor(x, y)) continue; // door/exit/archway gap
            // side tag: prefer the 4-neighbour that is open ground (renderer
            // hangs the wall loc on the OUTSIDE edge); interior party walls
            // between rooms just need SOME tag — it marks them as structural
            // (the 3D chunk mesh skips #dir wall decor; geometry owns them)
            const openN = !isBld(x, y - 1), openS = !isBld(x, y + 1);
            const openW = !isBld(x - 1, y), openE = !isBld(x + 1, y);
            const isCorner = (openN || openS) && (openW || openE);
            const dir = isCorner ? (openN ? "n" : "s") + (openW ? "w" : "e")
              : openW ? "w" : openE ? "e" : openN ? "n" : openS ? "s" : "n";
            const isSide = !isCorner && (openW || openE);
            const mat = isCorner ? (b.stone ? "wall_stone_corner" : "wall_wood_corner")
              : isSide ? (b.stone ? "wall_stone_side" : "wall_wood_side")
              : b.stone ? "wall_stone" : "wall_wood";
            decor[li(x, y)] = mat + "#" + dir;
            blocked[li(x, y)] = 1;
          }
      // record owned by the chunk holding the bounding-box centre
      const cxr = b.x0 + (b.w >> 1), cyr = b.y0 + (b.h >> 1);
      if (inCh(cxr, cyr))
        buildings.push({ x0: b.x0, y0: b.y0, w: b.w, h: b.h, stone: !!b.stone,
          rooms: b.rooms, idoors: b.idoors, door: b.door, ladder: b.ladder,
          door2: b.door2 || undefined,       // Great Labyrinth exit
          ladders: b.ladders || undefined,   // one per vertical maze edge
          stoneDoor: !!b.stoneDoor || undefined,
          kind: b.kind || null, job: b.job || null, job2: b.job2 || null,
          roof: roof || b.roof || (b.stone ? ROOFS_STONE[hash2i(b.x0, b.y0, S) % ROOFS_STONE.length] : ROOFS[hash2i(b.x0, b.y0, S) % ROOFS.length]) });
      // clear + reserve the doorstep strips so vegetation never blocks a door
      for (const dr of [b.door, b.door2]) {
        if (!dr) continue;
        const dd = [[-1, 0], [0, -1], [1, 0], [0, 1]][dr.angle]; // W N E S outward
        const along = dr.angle % 2 ? [1, 0] : [0, 1];
        for (let t = -1; t <= 1; t++) {
          const fx = dr.x + dd[0] + along[0] * t, fy = dr.y + dd[1] + along[1] * t;
          if (inCh(fx, fy) && !blocked[li(fx, fy)]) blocked[li(fx, fy)] = 2;
        }
      }
      // vegetation margin: the ring just outside each room's walls (skip other
      // buildings' floors and anything already blocked/reserved)
      for (const r of b.rooms)
        for (let y = r.y - 1; y <= r.y + r.h; y++)
          for (let x = r.x - 1; x <= r.x + r.w; x++) {
            const ring = x === r.x - 1 || x === r.x + r.w || y === r.y - 1 || y === r.y + r.h;
            if (!ring || !inCh(x, y) || isBld(x, y)) continue;
            if (!blocked[li(x, y)] && !String(ground[li(x, y)]).startsWith("floor"))
              blocked[li(x, y)] = 2;
          }
      return true;
    };
    const stampBuilding = (b, roof) => {
      if (b.rooms) return stampRoomsBuilding(b, roof);
      let ok = true;
      for (let y = b.y0; y < b.y0 + b.h && ok; y++)
        for (let x = b.x0; x < b.x0 + b.w && ok; x++)
          if (elevation(x * 0.5, y * 0.5) < LAND_E) ok = false;
      if (!ok) return false;
      stampedFeet.push({ x0: b.x0, y0: b.y0, w: b.w, h: b.h });
      const doorX = b.x0 + (b.w >> 1);
      // river-spanning building: the channel plus a 1-tile bank strip stay
      // natural ("hollow") — the floor slab and walls span overhead in the
      // renderer, the river flows through underneath, and a second door opens
      // on the north side so both banks have a way in. riverAt is a pure
      // function of position, so every chunk stamping its slice of the
      // footprint derives the same hollow mask and the same river flag.
      let spansRiver = false;
      for (let y = b.y0; y < b.y0 + b.h && !spansRiver; y++)
        for (let x = b.x0; x < b.x0 + b.w && !spansRiver; x++)
          if (riverAt(x, y)) spansRiver = true;
      const hollowAt = (x, y) => spansRiver &&
        (riverAt(x, y) || riverAt(x + 1, y) || riverAt(x - 1, y) ||
         riverAt(x, y + 1) || riverAt(x, y - 1));
      // river buildings get one door per bank via riverDoors (west/east walls
      // when the channel runs north-south); positions shared with buildingMeta
      const rDoors = spansRiver ? riverDoors(b.x0, b.y0, b.w, b.h) : null;
      const doorGapAt = (x, y) => rDoors
        ? rDoors.some(d2 => d2.x === x && d2.y === y)
        : y === b.y0 + b.h - 1 && x === doorX;
      for (let y = b.y0; y < b.y0 + b.h; y++)
        for (let x = b.x0; x < b.x0 + b.w; x++) {
          if (!inCh(x, y)) continue;
          if (hollowAt(x, y)) {
            // hollow passage: keep the terrain (water blocked, bank walkable),
            // clear vegetation out of the undercroft, and plant the same
            // staggered 1-tile support piers bridges use (solid — boats and
            // under-walkers steer between them)
            decor[li(x, y)] = null;
            if (isWaterKey(ground[li(x, y)])) {
              blocked[li(x, y)] = 1;
              const pier = landAdj(x, y) && ((x + y) & 1) === 0 &&
                [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([px, py]) =>
                  watAt(x + px, y + py) && !landAdj(x + px, y + py));
              if (pier) decor[li(x, y)] = "stone_bridge#p";
            } else blocked[li(x, y)] = 0;
            continue;
          }
          ground[li(x, y)] = b.stone ? "floor_stone" : "floor_wood";
          decor[li(x, y)] = null;
          blocked[li(x, y)] = 0;
          const edge = x === b.x0 || x === b.x0 + b.w - 1 || y === b.y0 || y === b.y0 + b.h - 1;
          if (edge && doorGapAt(x, y)) continue; // door gap
          if (edge) {
            // encode which side of the footprint this tile is on (n/s/e/w, or a
            // corner pair like "nw") so the renderer can put the wall loc on the
            // OUTSIDE edge of the tile — north/west is world y0/x0 (low), south/east
            // is the high y0+h-1/x0+w-1 bound
            const westE = x === b.x0, eastE = x === b.x0 + b.w - 1;
            const northE = y === b.y0, southE = y === b.y0 + b.h - 1;
            const isSide = westE || eastE;
            const isYEdge = northE || southE;
            const isCorner = isSide && isYEdge;
            const dir = isCorner ? (northE ? "n" : "s") + (westE ? "w" : "e")
              : isSide ? (westE ? "w" : "e") : (northE ? "n" : "s");
            const mat = b.tall ? "wall_tower"
              : isCorner ? (b.stone ? "wall_stone_corner" : "wall_wood_corner")
              : isSide ? (b.stone ? "wall_stone_side" : "wall_wood_side")
              : b.stone ? "wall_stone" : "wall_wood";
            decor[li(x, y)] = mat + "#" + dir;
            blocked[li(x, y)] = 1;
          }
        }
      // roof owned by the chunk containing the building's centre
      const cxr = b.x0 + (b.w >> 1), cyr = b.y0 + (b.h >> 1);
      if (inCh(cxr, cyr))
        buildings.push({ x0: b.x0, y0: b.y0, w: b.w, h: b.h, tall: !!b.tall, stone: !!b.stone,
          kind: b.kind || null, storeys: b.storeys || undefined, stoneDoor: !!b.stoneDoor, river: spansRiver || undefined,
          job: b.job || null, job2: b.job2 || null, // deriveNpcs re-spawns shopkeepers from these
          roof: roof || b.roof || (b.stone ? ROOFS_STONE[hash2i(b.x0, b.y0, S) % ROOFS_STONE.length] : ROOFS[hash2i(b.x0, b.y0, S) % ROOFS.length]) });
      // sentinel 2: reserve tiles outside the building (door front + 1-tile margin)
      // so trees/rocks/decor can't grow right up against walls; cleared after vegetation
      // reserve the tiles just outside each door so vegetation can't block it
      const fronts = rDoors
        ? rDoors.map(d2 => {
            const [ox, oy] = [[-1, 0], [0, -1], [1, 0], [0, 1]][d2.angle]; // W N E S outward
            return { x: d2.x + ox, y: d2.y + oy, along: d2.angle % 2 ? [1, 0] : [0, 1] };
          })
        : [{ x: doorX, y: b.y0 + b.h, along: [1, 0] }];
      for (const f of fronts)
        for (let dd = -1; dd <= 1; dd++) {
          const fx = f.x + f.along[0] * dd, fy = f.y + f.along[1] * dd;
          if (inCh(fx, fy) && !blocked[li(fx, fy)]) blocked[li(fx, fy)] = 2;
        }
      for (let my = b.y0 - 1; my <= b.y0 + b.h; my++)
        for (let mx = b.x0 - 1; mx <= b.x0 + b.w; mx++)
          if (inCh(mx, my) && !blocked[li(mx, my)])
            blocked[li(mx, my)] = 2;
      return true;
    };
    // furnace/malthouse/bakehouse all render as the retired prototype "furnace1" loc,
    // a 3x3-tile model — one tile of clearance from the wall isn't enough
    // room for it and lets it clip into/through the wall behind it
    const WIDE_STATIONS = new Set(["furnace", "malthouse", "bakehouse"]);
    const placeJob = (b, v, alt) => {
      // multi-room buildings: the station lives in the FIRST room (the one
      // behind the exterior door); bbox corners may be courtyard paving
      const r0 = b.rooms ? b.rooms[0] : b;
      const rx0 = b.rooms ? r0.x : b.x0, ry0 = b.rooms ? r0.y : b.y0;
      const inRooms = (x, y) => !b.rooms || b.rooms.some(r =>
        x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1);
      // primary station: back-wall centre; a building's SECOND trade (large
      // city halls, b.job2) goes front-left so the two never collide
      let cx2 = alt ? rx0 + 2 + (WIDE_STATIONS.has(b.job) ? 1 : 0) : rx0 + (r0.w >> 1);
      let cy2 = alt ? ry0 + r0.h - 3 : ry0 + (WIDE_STATIONS.has(b.job) ? 2 : 1);
      if (!inCh(cx2, cy2)) return;
      if (!inRooms(cx2, cy2) || !String(ground[li(cx2, cy2)]).startsWith("floor") ||
          blocked[li(cx2, cy2)] === 1 || decor[li(cx2, cy2)]) {
        // the usual spot is over a river building's hollow channel: shift the
        // station (bank chest, anvil, trader…) to the nearest interior floor
        // tile instead of dropping it entirely
        let best = null;
        for (let yy = b.y0 + 1; yy < b.y0 + b.h - 1; yy++)
          for (let xx = b.x0 + 1; xx < b.x0 + b.w - 1; xx++) {
            if (!inCh(xx, yy) || !inRooms(xx, yy) || !String(ground[li(xx, yy)]).startsWith("floor")) continue;
            if (blocked[li(xx, yy)] === 1 || decor[li(xx, yy)]) continue;
            const dd = Math.abs(xx - cx2) + Math.abs(yy - cy2);
            if (!best || dd < best.d) best = { x: xx, y: yy, d: dd };
          }
        if (!best) return;
        cx2 = best.x; cy2 = best.y;
      }
      // (trader/shopkeeper NPCs are spawned by deriveNpcs — derivable from
      // the persisted building records, so they exist for HYDRATED chunks
      // too, not just freshly generated ones)
      if (STATIONS[b.job]) {
        const wide = WIDE_STATIONS.has(b.job) ? 1 : 0;
        addNode(b.job, cx2, cy2, true, wide ? { station: true, wide } : { station: true });
        // a bank network's MAIN BRANCH hall runs a whole teller row of chests
        // along the back wall, not a lone strongbox
        if (b.kind === "mainbank" && b.job === "bank") {
          for (const ox of [-3, 3, -6, 6]) {
            const fx = cx2 + ox;
            if (!inCh(fx, cy2) || !String(ground[li(fx, cy2)]).startsWith("floor")) continue;
            if (blocked[li(fx, cy2)] === 1 || decor[li(fx, cy2)]) continue;
            if (nodes.some(n => n.x === fx && n.y === cy2)) continue;
            addNode("bank", fx, cy2, true, { station: true });
          }
        }
        if (wide) {
          // the retired prototype model already occupies a 3x3 footprint (engine
          // collision blocks it automatically via LocType width/length) —
          // reserve the same area here so our own blocked-tile grid (spawn
          // placement, click-to-walk reachability) doesn't disagree with it
          for (let ddy = -wide; ddy <= wide; ddy++)
            for (let ddx = -wide; ddx <= wide; ddx++) {
              if (!ddx && !ddy) continue;
              const fx = cx2 + ddx, fy = cy2 + ddy;
              if (inCh(fx, fy) && !blocked[li(fx, fy)]) blocked[li(fx, fy)] = 1;
            }
        }
      }
    };
    for (const v of villages) {
      // city wall ring (stone) with gates on the cross roads
      if (v.wall) {
        const R = v.R;
        // pave the entire interior with stone flags, block vegetation
        for (let y = by; y < by + CHUNK; y++)
          for (let x = bx; x < bx + CHUNK; x++) {
            const dx = x - v.x, dy = y - v.y;
            if (Math.abs(dx) < R && Math.abs(dy) < R && !isW(x, y)) {
              ground[li(x, y)] = "floor_stone";
              if (!blocked[li(x, y)]) blocked[li(x, y)] = 2; // sentinel: no vegetation on paving
            }
          }
        // stone wall ring with gates where roads cross
        for (let y = by; y < by + CHUNK; y++)
          for (let x = bx; x < bx + CHUNK; x++) {
            const dx = x - v.x, dy = y - v.y;
            const onVert = Math.abs(dx) === R && Math.abs(dy) < R;
            const onHorz = Math.abs(dy) === R && Math.abs(dx) < R;
            const onCorner = Math.abs(dx) === R && Math.abs(dy) === R;
            // never wall over a bridge deck (the road bridging a river through
            // the ring) — gatesForVillage puts a gate on the crossing instead
            if ((onVert || onHorz || onCorner) && Math.abs(dx) > 2 && Math.abs(dy) > 2 && !isW(x, y) &&
                !String(decor[li(x, y)] || "").startsWith("stone_bridge")) {
              const dir = onCorner ? (dy < 0 ? "n" : "s") + (dx < 0 ? "w" : "e")
                : onVert ? (dx < 0 ? "w" : "e") : (dy < 0 ? "n" : "s");
              deco(x, y, (onCorner ? "wall_stone_corner" : onVert ? "wall_stone_side" : "wall_stone") + "#" + dir, true);
            }
          }
      }
      // plaza + cross roads (dirt paths for non-walled villages, already stone for walled)
      for (let y = by; y < by + CHUNK; y++)
        for (let x = bx; x < bx + CHUNK; x++) {
          const dx = x - v.x, dy = y - v.y;
          if (!v.wall) {
            if (Math.abs(dx) <= 1 || Math.abs(dy) <= 1) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) < v.R && !isW(x, y) && !decor[li(x, y)]) {
                ground[li(x, y)] = "dirt#1";
                blocked[li(x, y)] = 0;
              }
            }
            if (dx * dx + dy * dy < 9 && !isW(x, y)) {
              ground[li(x, y)] = "dirt#1";
              decor[li(x, y)] = null;
              blocked[li(x, y)] = 0;
            }
          } else {
            // walled city: clear the road corridor and plaza decor
            if ((Math.abs(dx) <= 1 || Math.abs(dy) <= 1 || dx * dx + dy * dy < 9) && !isW(x, y)) {
              decor[li(x, y)] = null;
              blocked[li(x, y)] = 2;
            }
          }
        }
      // Secondary city streets: paint the block-grid roads between buildings
      if (v.streets) {
        for (let ty = by; ty < by + CHUNK; ty++)
          for (let tx = bx; tx < bx + CHUNK; tx++) {
            if (isW(tx, ty)) continue;
            const dx = tx - v.x, dy = ty - v.y;
            const onSt = v.streets.some(st =>
              (st.ox !== undefined && Math.abs(dx - st.ox) <= 1 && Math.abs(dy) < v.R) ||
              (st.oy !== undefined && Math.abs(dy - st.oy) <= 1 && Math.abs(dx) < v.R));
            if (!onSt) continue;
            if (!v.wall) {
              if (!decor[li(tx, ty)]) { ground[li(tx, ty)] = "dirt#1"; blocked[li(tx, ty)] = 0; }
            } else {
              decor[li(tx, ty)] = null;
              if (!blocked[li(tx, ty)]) blocked[li(tx, ty)] = 2;
            }
          }
      }
      if (inCh(v.x, v.y)) deco(v.x, v.y, v.wall ? "city_fountain" : "well_roofed", true);
      // city-only plaza decorations: benches, planters, flower beds
      if (v.wall) {
        const flowers = ["flower_blue", "flower_purple", "flower_orange", "flower_white"];
        for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]])
          if (openTile(v.x + dx, v.y + dy)) deco(v.x + dx, v.y + dy, "city_bench");
        for (const [dx, dy] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
          if (openTile(v.x + dx, v.y + dy)) deco(v.x + dx, v.y + dy, flowers[((dx + dy) >> 1) & 3]);
        }
        for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4]])
          if (openTile(v.x + dx, v.y + dy)) deco(v.x + dx, v.y + dy, "city_planter");
        // grander civic props for walled cities
        for (const [dx, dy] of [[-4, -4], [4, -4], [-4, 4], [4, 4]])
          if (openTile(v.x + dx, v.y + dy)) deco(v.x + dx, v.y + dy, "brazier_iron");
        for (const [dx, dy, k, solid] of [[0, -5, "statue_marble", true], [0, 5, "birdbath", false],
          [-5, 0, "well_roofed", true], [5, 0, "urn_garden", false],
          [0, -6, "aqueduct", true], [0, 6, "planter_box", false]])
          if (openTile(v.x + dx, v.y + dy)) deco(v.x + dx, v.y + dy, k, solid);
      }
      for (const b of v.buildings) {
        if (b.x0 + b.w < bx - 2 || b.x0 > bx + CHUNK + 2 || b.y0 + b.h < by - 2 || b.y0 > by + CHUNK + 2) {
          // still stamp partial overlaps
        }
        if (b.x0 + b.w >= bx && b.x0 < bx + CHUNK && b.y0 + b.h >= by && b.y0 < by + CHUNK) {
          if (stampBuilding(b)) {
            if (b.job) placeJob(b, v);
            if (b.job2) placeJob({ ...b, job: b.job2 }, v, true);
            furnishTrade(b);
          }
        }
      }
      // Newhaven extras: market stall (the prototype seed patch was removed —
      // farm fields now generate naturally in Farmland biome, see stampFarmField)
      if (v.origin) {
        if (inCh(v.x - 4, v.y + 4)) {
          deco(v.x - 4, v.y + 4, "stall_awn", true);
        }
        // Lua on_loc quest objects near the plaza (world/quest-anchors.js)
        if (typeof paintQuestLocs === "function") paintQuestLocs(deco, inCh);
      }
      if (inCh(v.x, v.y - 2)) labels.push({ x: v.x, y: v.y - 2, label: v.name + (v.kind === "city" ? " (city)" : " (village)"), c: "#ffd75e" });
    }

    // --- POI stamps ---
    for (let pcy = Math.floor((by / 2 - PCELL) / PCELL); pcy <= Math.floor(((by + CHUNK) / 2 + PCELL) / PCELL); pcy++)
      for (let pcx = Math.floor((bx / 2 - PCELL) / PCELL); pcx <= Math.floor(((bx + CHUNK) / 2 + PCELL) / PCELL); pcx++) {
        const p0 = poiInfo(pcx, pcy);
        if (!p0) continue;
        const p = { ...p0, x: p0.x * 2, y: p0.y * 2 };
        // margin must cover the widest stamp (mansion wings reach 10 tiles from
        // the POI centre, fishvillage huts ~14) or border chunks lose tiles
        if (p.x < bx - 16 || p.x >= bx + CHUNK + 16 || p.y < by - 16 || p.y >= by + CHUNK + 16) continue;
        stampPoi(p);
      }
    // Te Kairaranga's own tower (gameplay/wizard.js): a dedicated spire at a
    // cheap deterministic spot outside Newhaven — pure elevation math, not
    // the POI lattice, so it costs nothing to locate and survives POI-table
    // changes. Same wide stamp margin as the loop above.
    if (typeof Wizard !== "undefined" && Wizard.towerPos) {
      const wt = Wizard.towerPos();
      if (wt && wt.x >= bx - 16 && wt.x < bx + CHUNK + 16 && wt.y >= by - 16 && wt.y < by + CHUNK + 16)
        stampPoi({ x: wt.x, y: wt.y, type: "wizardtower", name: "The Weaver's Tower" });
    }
    function stampPoi(p) {
      const { x, y, type } = p;
      if (inCh(x, y - 2)) labels.push({ x, y: y - 2, label: p.name, c: "#9ecbff" });
      const house = (w, h, job, opts = {}) => {
        const b = { x0: x - (w >> 1), y0: y - (h >> 1), w, h, stone: false, ...opts, job };
        if (stampBuilding(b)) { if (job) placeJob(b, { origin: false }); return b; }
        return null;
      };
      // scatter small furniture/decor inside a stamped building. Interior tiles
      // carry the blocked=2 "reserved" sentinel (and their floor ground), so
      // openTile() is always false indoors — place directly instead, skipping
      // anything already occupied (walls, door gap, stations).
      const furnish = (b, items) => {
        if (!b) return;
        for (const [spr, dx, dy] of items) {
          const fx = b.x0 + dx, fy = b.y0 + dy;
          if (!inCh(fx, fy) || decor[li(fx, fy)] || blocked[li(fx, fy)] === 1) continue;
          if (nodes.some(n => n.x === fx && n.y === fy)) continue;
          deco(fx, fy, spr);
        }
      };
      // POI buildings share the trade shops' strategic layout: the list is in
      // importance order (first two flank the station spot on the back wall),
      // and unlike shops the list does NOT repeat — homes get one bed, not a
      // wall of them.
      const furnishPoi = (b, list) => {
        if (!b) return;
        const slots = strategicSlots(b);
        const items = [];
        for (let i = 0; i < slots.length && i < list.length; i++)
          items.push([list[i], slots[i][0], slots[i][1]]);
        furnishInterior(b, items);
      };
      switch (type) {
        case "wizardtower": case "watchtower": {
          // real towers: 6x6 footprint, 4 stacked storeys; the wizard tower
          // gets a steep dark spire roof, the watchtower open battlements
          const b2 = house(6, 6, type === "wizardtower" ? "altar" : null,
            { stone: true, tall: true, stoneDoor: true,
              kind: type === "wizardtower" ? "spire" : "tower",
              roof: type === "wizardtower" ? "roof_tower" : undefined });
          furnishPoi(b2, ["bookshelf", "desk", "bookshelf", "candle_scrying", "brazier_iron", "dresser"]);
          // many towers keep a bank chest by the door (wired to the nearest
          // bank network — the landmass's road web — when opened)
          if (rand2(x, y, S ^ 0x9119) < (type === "wizardtower" ? 0.5 : 0.4) && openTile(x, y + 4))
            addNode("bank", x, y + 4, true, { station: true });
          break;
        }
        case "manor": {
          // mansion: a 3-storey 13x9 hall with three ATTACHED 2-storey wings
          // (west/east/north) that share a wall with the hall; 1-tile archways
          // cut through the shared walls connect them on the ground floor (and
          // the renderer/passable() mirror them on the first floor). Wing
          // rects and archway tiles MUST match buildingMeta's derivation.
          const main = house(13, 9, null, { stone: true, kind: "mansion", roof: "roof_tower" });
          if (!main) break;
          furnishPoi(main, ["candelabra", "statue_marble", "bookshelf", "dresser_mirror",
            "desk", "sideboard", "cupboard", "chair"]);
          const hx0 = x - 6, hy0 = y - 4, hx1 = hx0 + 13, hy1 = hy0 + 9;
          furnish(main, [["bed_fourposter", 1, 1], ["wardrobe", 3, 1], ["bookshelf", 5, 1], ["bookshelf", 7, 1],
            ["sideboard", 9, 1], ["dresser", 11, 1], ["table2", 5, 4], ["table2", 6, 4], ["chair", 4, 4], ["chair", 7, 4],
            ["candelabra", 5, 3], ["fireplace", 1, 7], ["statue_marble", 11, 7], ["chandelier_crystal", 6, 2], ["cabinet", 11, 4]]);
          const wingsW = [
            { x0: hx0 - 4, y0: hy0 + 1, w: 5, h: 7 },
            { x0: hx1 - 1, y0: hy0 + 1, w: 5, h: 7 },
            { x0: hx0 + 3, y0: hy0 - 4, w: 7, h: 5 },
          ];
          for (const wg of wingsW) {
            const wx1 = wg.x0 + wg.w, wy1 = wg.y0 + wg.h;
            for (let wy = wg.y0; wy < wy1; wy++)
              for (let wx = wg.x0; wx < wx1; wx++) {
                if (!inCh(wx, wy)) continue;
                if (wx >= hx0 && wx < hx1 && wy >= hy0 && wy < hy1) continue; // hall owns shared tiles
                ground[li(wx, wy)] = "floor_stone";
                decor[li(wx, wy)] = null;
                const dir = (wy === wg.y0 ? "n" : wy === wy1 - 1 ? "s" : "") +
                            (wx === wg.x0 ? "w" : wx === wx1 - 1 ? "e" : "");
                if (dir) {
                  decor[li(wx, wy)] = (dir.length === 2 ? "wall_stone_corner" : (dir === "w" || dir === "e") ? "wall_stone_side" : "wall_stone") + "#" + dir;
                  blocked[li(wx, wy)] = 1;
                } else blocked[li(wx, wy)] = 2; // interior: walkable, no vegetation
              }
            // vegetation margin around the wing
            for (let my = wg.y0 - 1; my <= wy1; my++)
              for (let mx = wg.x0 - 1; mx <= wx1; mx++)
                if (inCh(mx, my) && !blocked[li(mx, my)]) blocked[li(mx, my)] = 2;
            furnish(wg, [["bed", 1, 1], ["wardrobe", wg.w - 2, 1], ["cradle", 1, wg.h - 2], ["candle_dinner", 2, 1]]);
          }
          // archways through the hall's shared walls (ground floor)
          for (const [ax, ay] of [[hx0, hy0 + 4], [hx1 - 1, hy0 + 4], [hx0 + 6, hy0]])
            if (inCh(ax, ay)) { ground[li(ax, ay)] = "floor_stone"; decor[li(ax, ay)] = null; blocked[li(ax, ay)] = 2; }
          // formal garden along the approach
          for (const [dx, dy] of [[-3, 6], [-1, 6], [1, 6], [3, 6]])
            if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, ["flower_white", "flower_purple"][(dx >> 1) & 1]);
          // an estate always banks its wealth: a chest on the approach
          if (openTile(x, y + 7)) addNode("bank", x, y + 7, true, { station: true });
          else if (openTile(x + 2, y + 6)) addNode("bank", x + 2, y + 6, true, { station: true });
          break;
        }
        case "farmstead": case "inn": case "watermill": case "windmill": {
          const b2 = house(7, 7,
            type === "inn" ? "campfire" : type === "watermill" || type === "windmill" ? "mill" :
            type === "farmstead" ? "loom" : null,
            { stone: false });
          if (type === "inn") {
            if (rand2(x, y, S ^ 0x9118) < 0.4) addNode("bank", x + 3, y + 3, true, { station: true });
            furnishPoi(b2, ["barrel_ale", "fireplace", "bed", "bed_frame", "table2", "cupboard", "candelabra", "chair"]);
          } else if (type === "farmstead") {
            furnishPoi(b2, ["butter_churn", "wash_tub", "dresser", "cupboard", "chair"]);
          } else {
            furnishPoi(b2, ["table2", "sideboard", "barrel_flour", "chair"]);
          }
          if (type === "farmstead")
            for (let i = 0; i < 4; i++)
              if (openTile(x - 4 + i, y + 4)) { ground[li(x - 4 + i, y + 4)] = "farm"; addNode("farmplot", x - 4 + i, y + 4, false, { farm: true, crop: null }); }
          break;
        }
        case "graveyard": case "barrow": case "gallows": case "battlefield":
          for (const [dx, dy] of [[-3, -2], [-1, -3], [1, -2], [3, -3], [-2, 2], [2, 3], [0, 1], [3, 1]])
            if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, "gravestone", true);
          if (openTile(x - 1, y)) deco(x - 1, y, "skull");
          if (openTile(x + 1, y + 2)) deco(x + 1, y + 2, "burial_urn", true);
          if (openTile(x - 3, y + 1)) deco(x - 3, y + 1, "gravestone3", true);
          if (openTile(x + 2, y - 1)) deco(x + 2, y - 1, type === "battlefield" ? "gargoyle" : "statue_marble", true);
          // (essence-rock cluster removed — rune essence ore is deprecated)
          break;
        case "ruins": case "arena": case "obelisk": {
          const rk = type === "ruins"
            ? ["column_stone", "pillar_stone", "archway_stone", "rampart", "gargoyle"]
            : ["boulder", "column_stone", "boulder", "pillar_stone", "boulder"];
          [[-3, -1], [3, 1], [-1, 3], [2, -3], [-3, 2]].forEach(([dx, dy], i) => {
            if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, rk[i], true);
          });
          if (openTile(x, y)) deco(x, y, type === "obelisk" ? "cathedral_stone" : "gargoyle", true);
          break;
        }
        case "campsite":
          if (openTile(x - 1, y - 1)) deco(x - 1, y - 1, "tent_l", true);
          if (openTile(x, y - 1)) deco(x, y - 1, "tent_r", true);
          if (openTile(x, y + 1)) addNode("campfire", x, y + 1, true, { station: true });
          if (openTile(x + 2, y)) deco(x + 2, y, "tent_bundle", true);
          if (openTile(x - 2, y + 1)) deco(x - 2, y + 1, "bedroll");
          if (rand2(x, y, S ^ 0x9119) < 0.2 && openTile(x + 2, y + 2))
            addNode("bank", x + 2, y + 2, true, { station: true });
          break;
        case "pond": {
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -3; dx <= 3; dx++)
              if (inCh(x + dx, y + dy) && Math.hypot(dx / 1.6, dy) < 1.6 && !decor[li(x + dx, y + dy)]) {
                // sea-biome water art (isWaterKey), NOT the legacy flat-cyan
                // "water#N" sprite — ponds read as the same water as rivers
                ground[li(x + dx, y + dy)] = biomeGround(1, x + dx, y + dy);
                blocked[li(x + dx, y + dy)] = 1;
              }
          addFishNode(x, y, "shore");
          // agility crossing (Agility): the pond's location deterministically
          // picks an obstacle tier, so ponds across the world span the whole
          // level range — a wandering player meets ever-harder crossings.
          const otype = OBSTACLE_ORDER[hash2i(x, y, S ^ 0xA6111) % OBSTACLE_ORDER.length];
          const ot = OBSTACLE_TYPES[otype];
          const span = [];
          for (let dx = -1; dx <= 1; dx++)
            if (inCh(x + dx, y)) { decor[li(x + dx, y)] = ot.decor; span.push([x + dx, y]); }
          if (span.length === 3 && inCh(x - 2, y) && inCh(x + 2, y)) {
            const meta = { type: otype, req: ot.req, xp: ot.xp, name: ot.name, fail: ot.fail, dmg: ot.dmg };
            obstacles.push({ x: x - 1, y, path: [...span, [x + 2, y]], ...meta });
            obstacles.push({ x: x + 1, y, path: [...span.slice().reverse(), [x - 2, y]], ...meta });
          }
          break;
        }
        case "orchard":
          for (const [dx, dy] of [[-3, -2], [0, -3], [3, -2], [-3, 1], [3, 1], [0, 2], [-2, 3], [2, 3]])
            if (openTile(x + dx, y + dy)) addNode("treeT1", x + dx, y + dy, false);
          break;
        case "lumbercamp": {
          const cap = localTierCap(x, y, TREES.length);
          for (const [dx, dy] of [[-3, -1], [3, 1], [-1, 3], [2, -3], [-3, 2], [1, 1]])
            if (openTile(x + dx, y + dy)) addNode(TREES[rollTier(cap, rng)].node, x + dx, y + dy, false);
          if (openTile(x, y)) deco(x, y, "stump");
          break;
        }
        case "minecamp": case "crater": {
          const cap = localTierCap(x, y, METALS.length);
          for (const [dx, dy] of [[-2, -1], [2, 1], [-1, 2], [1, -2], [-3, 1], [3, -1]]) {
            const rockKind = (typeof mineExtraNode === "function" && mineExtraNode(rng)) || METALS[rollTier(cap, rng)].rock;
            if (openTile(x + dx, y + dy)) addNode(rockKind, x + dx, y + dy, rockKind === "essence");
          }
          if (openTile(x, y)) deco(x, y, "cart_gold", true);
          if (type === "minecamp" && rand2(x, y, S ^ 0x9118) < 0.3) addNode("bank", x + 3, y + 3, true, { station: true });
          break;
        }
        case "fishvillage": {
          // find coast direction in game-tile coordinates
          let dir = null;
          if (p.dir) dir = p.dir;
          else {
            outerDir: for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
              for (let d = 2; d <= 16; d += 2) {
                const ex = elevation((x + dx * d) / 2, (y + dy * d) / 2);
                if (ex < LAND_E) { dir = [dx, dy]; break outerDir; }
              }
            }
          }
          if (!dir) dir = [0, 1];
          const [cdx, cdy] = dir;
          // 3 huts arranged perpendicular to the pier
          for (let i = -1; i <= 1; i++) {
            const hx = x - cdy * i * 9 - cdx * 2;
            const hy = y + cdx * i * 9 - cdy * 2;
            const b2 = { x0: hx - 3, y0: hy - 3, w: 7, h: 7, stone: false,
              job: i === 0 ? "campfire" : null };
            if (b2.x0 + b2.w < bx - 2 || b2.x0 > bx + CHUNK + 2 ||
                b2.y0 + b2.h < by - 2 || b2.y0 > by + CHUNK + 2) continue;
            if (stampBuilding(b2) && b2.job) placeJob(b2, { origin: false });
          }
          // pier: floor_wood extending from village toward water
          for (let s = 0; s <= 10; s++) {
            const px2 = x + cdx * s, py2 = y + cdy * s;
            if (!inCh(px2, py2)) continue;
            const li2 = li(px2, py2);
            ground[li2] = "floor_wood";
            decor[li2] = null;
            blocked[li2] = 0;
          }
          // fishing props landward of the pier (incl. beached small craft)
          for (const [i, k] of [[-3, "barrel_fish"], [3, "crab_pot"], [-5, "skiff"], [5, "raft_logs"]]) {
            const fx = x - cdx * 2 - cdy * i, fy = y - cdy * 2 + cdx * i;
            if (inCh(fx, fy) && !isW(fx, fy) && !decor[li(fx, fy)] && !blocked[li(fx, fy)]) deco(fx, fy, k);
          }
          // most fishing villages keep a bank chest by the pier for the catch
          // money (it opens the vault of whatever network this shore belongs to)
          if (rand2(x, y, S ^ 0x9119) < 0.55 && openTile(x - cdx * 4, y - cdy * 4))
            addNode("bank", x - cdx * 4, y - cdy * 4, true, { station: true });
          // fishing spots at pier end (in water)
          for (let s = 8; s <= 13; s++) {
            for (const [ox2, oy2] of [[0,0],[cdy,-cdx],[-cdy,cdx]]) {
              const fx = x + cdx * s + ox2, fy = y + cdy * s + oy2;
              if (inCh(fx, fy) && isW(fx, fy)) addFishNode(fx, fy, "shore");
            }
          }
          break;
        }
        case "shrine": case "stonecircle":
          if (openTile(x, y)) addNode("altar", x, y, true, { station: true });
          for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]])
            if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, "boulder");
          if (openTile(x - 2, y - 2)) deco(x - 2, y - 2, "altar_stone", true);
          break;
        case "hotspring":
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]])
            if (inCh(x + dx, y + dy)) { ground[li(x + dx, y + dy)] = biomeGround(1, x + dx, y + dy); blocked[li(x + dx, y + dy)] = 1; }
          if (openTile(x + 2, y + 2)) deco(x + 2, y + 2, "boulder");
          break;
        case "shack": {
          const b2 = house(5, 4, null);
          furnishPoi(b2, ["crate_braced", "toolbox", "sign"]);
          break;
        }
        case "fairyring":
          for (const [dx, dy] of [[-2,0],[2,0],[0,-2],[0,2],[-1,-1],[1,-1],[-1,1],[1,1]])
            if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, "mushroom");
          break;
        case "standing":
          if (openTile(x, y)) deco(x, y, "boulder", true);
          break;
        case "hermitage": {
          const b2 = house(5, 4, "cauldron");
          furnishPoi(b2, ["bookshelf_small", "candle_church", "cauldron_iron"]);
          break;
        }
        case "totem":
          if (openTile(x, y)) deco(x, y, "boulder", true);
          for (const [dx, dy] of [[-1,0],[1,0]])
            if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, "skull");
          break;
        case "apiary":
          for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]])
            if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, "beehive_box");
          for (const [dx, dy] of [[-2,0],[2,0],[0,-2],[0,2]])
            if (openTile(x + dx, y + dy)) addNode("berrybush", x + dx, y + dy, false);
          break;
        case "statue":
          if (openTile(x, y)) deco(x, y, "statue_marble", true);
          for (const [dx, dy] of [[-1,0],[1,0]])
            if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, "urn_garden", true);
          break;
        case "portal":
          // a real, usable portal (gameplay/portals.js): step up to it to
          // attune it, use it again to travel to any other attuned portal
          if (openTile(x, y)) addNode("portal", x, y, true, { portal: true });
          for (const [dx, dy] of [[-1,-1],[1,-1],[-1,1],[1,1]])
            if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, "crystal_cluster_purple", true);
          for (const [dx, dy] of [[-2,0],[2,0]])
            if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, "pillar_stone", true);
          break;
        case "runecircle":
          // a wild runestone circle: craft runes far from town — the mage's
          // waystation, and fuel for the rune-priced portal network
          if (openTile(x, y)) addNode("altar", x, y, true, { station: true });
          for (const [dx, dy] of [[-2,-1],[2,-1],[-2,1],[2,1],[0,-2],[0,2]])
            if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, "boulder", true);
          for (const [dx, dy] of [[-3,0],[3,0]])
            // (essence-rock vein removed — rune essence ore is deprecated)
          break;
        case "banditcamp":
          // rough company: tents, a fire, and a stash worth stealing
          if (openTile(x - 1, y - 1)) deco(x - 1, y - 1, "tent2_l", true);
          if (openTile(x, y - 1)) deco(x, y - 1, "tent2_r", true);
          if (openTile(x + 2, y - 1)) deco(x + 2, y - 1, "tent_l", true);
          if (openTile(x + 3, y - 1)) deco(x + 3, y - 1, "tent_r", true);
          if (openTile(x, y + 1)) addNode("campfire", x, y + 1, true, { station: true });
          if (openTile(x + 1, y)) deco(x + 1, y, "crate", true);
          if (openTile(x - 2, y)) deco(x - 2, y, "goldpile");
          if (openTile(x - 2, y + 1)) deco(x - 2, y + 1, "skull");
          break;
        case "huntercamp": {
          // a hunting lodge: workbench inside, tanning rack and fire outside
          const b2 = house(5, 4, "workbench");
          furnishPoi(b2, ["bedroll", "chest_storage", "hearthstone"]);
          if (openTile(x + 3, y + 1)) addNode("tanrack", x + 3, y + 1, true, { station: true });
          if (openTile(x - 3, y + 1)) addNode("campfire", x - 3, y + 1, true, { station: true });
          if (openTile(x + 3, y - 1)) deco(x + 3, y - 1, "cart", true);
          break;
        }
        case "garden":
          for (const [dx, dy] of [[-2,-1],[-1,-2],[0,-2],[1,-1],[2,0],[1,2],[0,2],[-1,1],[-2,0]]) {
            const f = ["flower_blue","flower_orange","flower_purple","flower_white"][(Math.abs(dx)+Math.abs(dy))%4];
            if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, f);
          }
          for (const [dx, dy, k, solid] of [[0, 0, "birdbath", false], [-2, 2, "urn_garden", false],
            [2, -2, "planter_ceramic", false], [2, 2, "statue_marble", true],
            [3, 0, "birdhouse", false], [-3, 0, "flowerpot", false],
            [0, 3, "planter_box", false], [0, -3, "bridge_arch", false]])
            if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, k, solid);
          break;
        case "tarpit":
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++)
              if (inCh(x+dx,y+dy) && Math.hypot(dx,dy) < 2.5 && !decor[li(x+dx,y+dy)]) {
                ground[li(x+dx,y+dy)] = biomeGround(1, x+dx, y+dy); blocked[li(x+dx,y+dy)] = 1;
              }
          break;
        case "geyser":
          for (const [dx, dy] of [[0,0],[1,0],[0,1],[-1,0],[0,-1]])
            if (inCh(x+dx,y+dy)) { ground[li(x+dx,y+dy)] = biomeGround(1, x+dx, y+dy); blocked[li(x+dx,y+dy)] = 1; }
          if (openTile(x+2,y)) deco(x+2,y,"boulder");
          break;
        case "beacon":
          if (openTile(x, y)) addNode("campfire", x, y, true, { station: true });
          for (const [dx, dy] of [[-1,0],[1,0]])
            if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, "brazier_iron", true);
          if (openTile(x, y - 1)) deco(x, y - 1, "banner_pole", true);
          break;
        case "vineyard":
          for (let i = -2; i <= 2; i++)
            for (const dy of [-1, 1])
              if (inCh(x+i,y+dy)) { ground[li(x+i,y+dy)] = "farm"; addNode("farmplot",x+i,y+dy,false,{farm:true,crop:null}); }
          for (const [dx, dy, k] of [[-3,0,"barrel_wine"],[3,0,"wine_tun"]])
            if (openTile(x+dx,y+dy)) deco(x+dx,y+dy,k,true);
          break;
        case "observatory": {
          // broad 2-storey hall; the great telescope occupies the first floor
          // and pokes out through the roof (rendered by the structure system)
          const b2 = house(9, 9, "altar", { stone: true, stoneDoor: true, kind: "observatory", roof: "roof_tower" });
          furnishPoi(b2, ["bookshelf", "desk", "bookshelf", "candle_scrying", "dresser", "easel", "chair"]);
          break;
        }
        case "wishingwell":
          if (openTile(x, y)) deco(x, y, "fountain_small", true);
          for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]])
            if (openTile(x+dx,y+dy)) deco(x+dx,y+dy,"boulder");
          break;
        case "guild": {
          const b2 = house(9, 7, "bank", { stone: true });
          if (rand2(x,y,S^0x9118)<0.5) addNode("anvil",x+3,y+3,true,{station:true});
          furnishPoi(b2, ["bookshelf", "cabinet", "table2", "candelabra", "sign", "weathervane"]);
          break;
        }
        case "greatlab": {
          // the Great Labyrinth: a 3-storey stone maze building whose unique
          // entrance→exit path is forced over the top floor (labgen.js).
          // The plan is a pure function of the POI seat, so every chunk
          // stamping a slice derives the identical building record.
          stampBuilding(labMaze.greatLabBuilding(x / 2, y / 2));
          break;
        }
        case "maze":
          for (const [dx, dy] of [
            [-4,-3],[-3,-3],[-2,-3],[-1,-3],[0,-3],[1,-3],[2,-3],[3,-3],[4,-3],
            [-4,-2],[4,-2],[-4,-1],[-2,-1],[4,-1],
            [-4,0],[-2,0],[0,0],[2,0],[4,0],
            [-4,1],[2,1],[4,1],[-4,2],[4,2],
            [-4,3],[-3,3],[-2,3],[-1,3],[0,3],[1,3],[2,3],[3,3],[4,3]
          ])
            if (openTile(x+dx,y+dy)) deco(x+dx,y+dy,"wall_wood",true);
          break;
        case "lighthouse": {
          const b2 = house(5, 5, null, { stone: true, tall: true, stoneDoor: true, kind: "lighthouse" });
          if (openTile(x, y-3)) addNode("campfire", x, y-3, true, { station: true });
          if (rand2(x, y, S ^ 0x9119) < 0.45 && openTile(x + 2, y + 3))
            addNode("bank", x + 2, y + 3, true, { station: true });
          break;
        }
      }
    }

    // --- wayside bank chests: rare lone chests deep in the wild ---
    // One candidate spot per 192×192-tile lattice cell (hashed offset), ~30%
    // of which materialise — roughly one chest per few hundred tiles of
    // travel. Skipped in/near settlements (those have real banks). Like every
    // chest, it opens the vault of whichever bank network its ground belongs
    // to (world.bankNetId at open time), so a wayside chest on a lonely isle
    // banks into that isle's own vault.
    for (let wcy = Math.floor(by / 192); wcy <= Math.floor((by + CHUNK) / 192); wcy++)
      for (let wcx = Math.floor(bx / 192); wcx <= Math.floor((bx + CHUNK) / 192); wcx++) {
        if (rand2(wcx, wcy, S ^ 0xBA7C) > 0.3) continue;
        const wx2 = wcx * 192 + Math.floor(rand2(wcx * 3 + 1, wcy, S ^ 0xBA7D) * 192);
        const wy2 = wcy * 192 + Math.floor(rand2(wcy * 3 + 1, wcx, S ^ 0xBA7E) * 192);
        if (wx2 < bx || wx2 >= bx + CHUNK || wy2 < by || wy2 >= by + CHUNK) continue;
        let inTown = false;
        for (const v of villages) {
          const dx = wx2 / 2 - v.x, dy = wy2 / 2 - v.y;
          if (dx * dx + dy * dy < (v.R + 8) * (v.R + 8)) { inTown = true; break; }
        }
        if (inTown || !openTile(wx2, wy2)) continue;
        addNode("bank", wx2, wy2, true, { station: true });
      }

    // --- wilderness icons: resource clusters & camps ---
    for (let icy = Math.floor(by / 2 / ICELL) - 1; icy <= Math.floor((by + CHUNK) / 2 / ICELL) + 1; icy++)
      for (let icx = Math.floor(bx / 2 / ICELL) - 1; icx <= Math.floor((bx + CHUNK) / 2 / ICELL) + 1; icx++) {
        const ic0 = wildIcon(icx, icy);
        const ic = ic0 && { x: ic0.x * 2, y: ic0.y * 2, type: ic0.type };
        if (!ic || ic.x < bx - 6 || ic.x >= bx + CHUNK + 6 || ic.y < by - 6 || ic.y >= by + CHUNK + 6) continue;
        const { x, y, type } = ic;
        if (type === "fish") {
          for (const [dx, dy] of [[0, 0], [2, 1], [-2, -1]])
            if (isW(x + dx, y + dy)) {
              const deep = eG[G(x + dx - bx, y + dy - by)] < 0.44;
              addFishNode(x + dx, y + dy, deep ? "deep" : "shore");
            }
        } else if (type === "mine") {
          const cap = localTierCap(x, y, METALS.length);
          for (const [dx, dy] of [[0, 0], [2, 1], [-2, 0], [1, -2], [-1, 2]])
            if (openTile(x + dx, y + dy)) addNode((typeof mineExtraNode === "function" && mineExtraNode(rng)) || METALS[rollTier(cap, rng)].rock, x + dx, y + dy);
        } else if (type === "tree") {
          const cap = localTierCap(x, y, TREES.length);
          for (const [dx, dy] of [[0, 0], [3, 1], [-3, 0], [1, -3], [-1, 3]])
            if (openTile(x + dx, y + dy)) addNode(TREES[Math.min(TREES.length - 1, rollTier(cap, rng) + 3)].node, x + dx, y + dy);
        } else if (type === "camp") {
          // themed encampment garrisoned from the LOCAL biome's list
          const b = bG[G(Math.max(bx, Math.min(bx + CHUNK - 1, x)) - bx, Math.max(by, Math.min(by + CHUNK - 1, y)) - by)];
          const dist = Math.max(Math.abs(x), Math.abs(y)) / CHUNK;
          const cands = biomeMobsInBand(b, 1, (8 + dist * 7) * LEVEL_SCALE);
          if (cands.length) {
            const kind = cands[Math.floor(rng() * cands.length)].key;
            if (openTile(x, y)) deco(x, y, MONSTER_THEME[kind] === "h" ? "campfire" : "skull", MONSTER_THEME[kind] === "h");
            if (MONSTER_THEME[kind] === "h") {
              if (openTile(x - 1, y - 2)) deco(x - 1, y - 2, "tent_l", true);
              if (openTile(x, y - 2)) deco(x, y - 2, "tent_r", true);
              if (openTile(x + 2, y - 1)) deco(x + 2, y - 1, "crate", true);
            } else if (MONSTER_THEME[kind] === "u") {
              for (const [dx, dy] of [[-2, -1], [2, 1], [0, -2]])
                if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, "gravestone", true);
            } else {
              for (const [dx, dy] of [[-2, 0], [2, 1]])
                if (openTile(x + dx, y + dy)) deco(x + dx, y + dy, "boulder");
            }
            for (let i = 0; i < 3 + Math.floor(rng() * 3); i++)
              spawnDefs.push([kind, x - 3 + Math.floor(rng() * 7), y - 3 + Math.floor(rng() * 7)]);
          }
        }
      }

    // --- biome vegetation & resources ---
    const centerB = bG[G(CHUNK >> 1, CHUNK >> 1)];
    const veg = BIOME_VEG[centerB] || BIOME_VEG[B.GRASS];
    const [treeDens, treeSpr, rockDens, decoList] = veg;
    const treeCap = localTierCap(bx + 16, by + 16, TREES.length);
    const rockCap = localTierCap(bx + 16, by + 16, METALS.length);
    const nTiles = CHUNK * CHUNK;
    // Dream Forest runs LUSH (revived 2026-09-16 with the pocket-interior
    // rewrite, see gameplay/dream.js): dense enough that the sky is crowns and
    // any two places in it look like the same place — cover for the interior's
    // silent glade-to-glade relocations.
    const dreamLush = centerB === B.DREAM ? 2.6 : 1;
    let tTrees = Math.round(treeDens * nTiles * (0.7 + rng() * 0.6) * dreamLush);
    let tRocks = Math.round(rockDens * nTiles * (0.7 + rng() * 0.6));
    for (let t2 = 0; t2 < 300 && (tTrees > 0 || tRocks > 0); t2++) {
      const x = bx + 1 + Math.floor(rng() * (CHUNK - 2));
      const y = by + 1 + Math.floor(rng() * (CHUNK - 2));
      if (!openTile(x, y)) continue;
      const bHere = bG[G(x - bx, y - by)];
      if (WATER_LIKE_B.has(bHere)) continue;
      if (tTrees > 0) {
        const vg = BIOME_VEG[bHere] || veg;
        if ((vg[0] || 0) > 0) {
          const rubTree = typeof rubberTreeNode === "function" ? rubberTreeNode(bHere, rng) : null;
          const nzTree = typeof nzExtraTreeNode === "function" ? nzExtraTreeNode(bHere, rng) : null;
          const n = addNode(rubTree || nzTree || TREES[rollTier(treeCap, rng)].node, x, y, false);
          // sprite override: a string (single skin) or an array (pick one at
          // random per node — the Mushroom Forest's giant-mushroom canopy pool).
          // Never override the rubber tree: it carries its own dedicated sprite.
          const ov = vg[1] || treeSpr;
          if (n && ov && n.type !== "rubbertree") n.sprv = Array.isArray(ov) ? ov[Math.floor(rng() * ov.length)] : ov;
          tTrees--;
          continue;
        }
        tTrees--;
        continue;
      }
      if (tRocks > 0) {
        const rockKind = (typeof mineExtraNode === "function" && mineExtraNode(rng)) || METALS[rollTier(rockCap, rng)].rock;
        addNode(rockKind, x, y, rockKind === "essence");
        tRocks--;
      }
    }
    for (const [spr, dens, blk] of decoList) {
      let n2 = Math.round(dens * nTiles * dreamLush);
      for (let t2 = 0; t2 < 220 && n2 > 0; t2++) {
        const x = bx + Math.floor(rng() * CHUNK), y = by + Math.floor(rng() * CHUNK);
        if (!openTile(x, y)) continue;
        if (bG[G(x - bx, y - by)] !== centerB && rng() < 0.5) continue;
        // gatherable natural props (boulders, mossy boulders, wildflowers) are
        // placed as mine/pick NODES rather than static decor (gather-decor.js)
        if (typeof GATHER_NODE_DECOR !== "undefined" && Object.prototype.hasOwnProperty.call(GATHER_NODE_DECOR, spr)
          && typeof NODE_TYPES !== "undefined" && NODE_TYPES[spr])
          addNode(spr, x, y, GATHER_NODE_DECOR[spr]);
        else
          deco(x, y, spr, blk);
        n2--;
      }
    }
    // foraging: bushes and herbs in green biomes
    if (GRASS_LIKE_B.has(centerB) || FOREST_LIKE_B.has(centerB) || SWAMP_LIKE_B.has(centerB)) {
      for (let i = 0; i < 2; i++) {
        const x = bx + 2 + Math.floor(rng() * (CHUNK - 4)), y = by + 2 + Math.floor(rng() * (CHUNK - 4));
        if (openTile(x, y)) addNode(rng() < 0.5 ? "berrybush" : "herbpatch", x, y, rng() < 0.5);
      }
    }
    // water lilies: ONLY on water tiles in or adjacent to a WETLAND (marsh pools
    // and their fringing water) — nowhere else. Random among the three pads.
    {
      let hasWet = false;
      for (let ly = 0; ly < CHUNK && !hasWet; ly++)
        for (let lx = 0; lx < CHUNK; lx++)
          if (bG[G(lx, ly)] === B.WETLAND) { hasWet = true; break; }
      if (hasWet) {
        // a wetland LAND tile (marsh), not open water: this keeps lilies on
        // marsh pools and the water fringing wetlands, and off the open sea
        // (deep tiles can classify as WETLAND by climate but render as water).
        const wetLand = (lx, ly) => lx >= 0 && ly >= 0 && lx < CHUNK && ly < CHUNK &&
          bG[G(lx, ly)] === B.WETLAND && !isWaterKey(ground[ly * CHUNK + lx]);
        const nearWet = (lx, ly) => {
          for (let ay = -2; ay <= 2; ay++)
            for (let ax = -2; ax <= 2; ax++)
              if (wetLand(lx + ax, ly + ay)) return true;
          return false;
        };
        const PADS = ["lily", "lily2", "lily3"];
        for (let ly = 0; ly < CHUNK; ly++)
          for (let lx = 0; lx < CHUNK; lx++) {
            const x = bx + lx, y = by + ly;
            if (!isW(x, y) || decor[li(x, y)] || !nearWet(lx, ly)) continue;
            if (rng() < 0.12) deco(x, y, PADS[Math.floor(rng() * PADS.length)]);
          }
      }
    }
    // --- moa footprint trails (easter egg — eggs.js "moa_prints"): roughly
    // one open-grassland chunk in 150 carries a line of giant three-toed
    // prints striding across the field at a 2-tile gait… and then stopping,
    // mid-stride, with the grass beyond unbroken. Deterministic per chunk
    // (position hash, not the order-sensitive rng), rendered flat
    // (render3d FLAT_DECOR), non-pickable (no OBJ_MAP entry), examine text
    // in decor-examine.js. A trail that runs out of clean grass truncates —
    // trails shorter than 4 prints are dropped rather than half-laid.
    if (GRASS_LIKE_B.has(centerB) && hash2i(bx, by, S ^ 0x40a0) % 150 === 0) {
      const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
      const [fdx, fdy] = DIRS[hash2i(bx, by, S ^ 0x40a1) % 8];
      const steps = 5 + hash2i(bx, by, S ^ 0x40a2) % 4;
      let fx2 = bx + 2 + hash2i(bx, by, S ^ 0x40a3) % (CHUNK - 4);
      let fy2 = by + 2 + hash2i(bx, by, S ^ 0x40a4) % (CHUNK - 4);
      const trail = [];
      for (let i = 0; i < steps; i++) {
        if (!openTile(fx2, fy2) || !GRASS_LIKE_B.has(bG[G(fx2 - bx, fy2 - by)])) break;
        trail.push([fx2, fy2]);
        fx2 += fdx * 2; fy2 += fdy * 2;
      }
      if (trail.length >= 4) for (const [tx2, ty2] of trail) deco(tx2, ty2, "footprint_moa");
    }
    // --- naturally-generated farm fields: a fenced rectangle of plantable soil
    // in Farmland biome, one agriculture skill per field, a gate for access.
    // Never inside city/village limits. Soil starts UNTILLED (hoe it first).
    {
      const AGRI = ["Cerealiculture", "Olericulture", "Pomiculture", "Herbiculture", "Fibriculture"];
      const isFarmB = (x, y) => inCh(x, y) && bG[G(x - bx, y - by)] === B.FARM;
      // Anchor fields on real farmland tiles. A field tile just needs to be solid
      // land clear of water/road/building/village/other-nodes; scattered decor
      // (flowers etc.) is cleared as the field is stamped.
      const fieldTile = (x, y) => inCh(x, y) && !blocked[li(x, y)] && !isWaterKey(ground[li(x, y)])
        && !inVillage(x, y) && !nodes.some(n => n.x === x && n.y === y);
      // collect this chunk's open farmland tiles (away from the 2-tile border)
      const farmTiles = [];
      for (let ty = 2; ty < CHUNK - 2; ty++)
        for (let tx = 2; tx < CHUNK - 2; tx++) {
          const x = bx + tx, y = by + ty;
          if (isFarmB(x, y) && !inVillage(x, y) && !blocked[li(x, y)]) farmTiles.push(x + (y << 16));
        }
      if (farmTiles.length >= 30 && rng() < 0.7) {   // a genuinely farm-covered chunk
        for (let t = 0; t < 12; t++) {
          const enc = farmTiles[(rng() * farmTiles.length) | 0];
          const ax = enc & 0xffff, ay = enc >> 16;
          const W = 5 + ((rng() * 4) | 0), H = 5 + ((rng() * 4) | 0); // 5-8 per side
          const x0 = ax - (W >> 1), y0 = ay - (H >> 1);
          let ok = true, farmN = 0;
          for (let yy = y0; yy < y0 + H && ok; yy++)
            for (let xx = x0; xx < x0 + W; xx++) {
              if (!fieldTile(xx, yy)) { ok = false; break; }
              if (isFarmB(xx, yy)) farmN++;
            }
          if (!ok || farmN < W * H * 0.35) continue;  // predominantly farmland
          const skill = AGRI[hash2i(x0, y0, S ^ 0xfa12) % AGRI.length];
          const gateX = x0 + (W >> 1), gateY = y0 + H - 1; // gate mid-way along the south edge
          for (let yy = y0; yy < y0 + H; yy++)
            for (let xx = x0; xx < x0 + W; xx++) {
              decor[li(xx, yy)] = 0; // clear any scattered decor under the field
              const edge = xx === x0 || xx === x0 + W - 1 || yy === y0 || yy === y0 + H - 1;
              if (edge) {
                if (xx === gateX && yy === gateY) deco(xx, yy, "gate_wood", false); // passable gate
                else deco(xx, yy, "fence_wood", true);                              // blocking fence
              } else {
                ground[li(xx, yy)] = "dirt"; // bare untilled earth
                addNode("cropsoil", xx, yy, false, { farm: true, skill, tilled: false, crop: null });
              }
            }
          break; // one field per chunk is plenty
        }
      }
    }

    // shoreline fishing
    {
      let fish = 0;
      for (let i = 0; i < N; i++) if (isWaterKey(ground[i])) fish++;
      let want = fish > 15 ? 1 + Math.floor(rng() * 2) : 0;
      const deepWant = fish > 500 ? 1 : 0;
      for (let t2 = 0; t2 < 80 && want + deepWant > 0; t2++) {
        const x = bx + 2 + Math.floor(rng() * (CHUNK - 4)), y = by + 2 + Math.floor(rng() * (CHUNK - 4));
        if (!isW(x, y) || decor[li(x, y)] || nodes.some(n => Math.abs(n.x - x) + Math.abs(n.y - y) < 5)) continue;
        // not inside (or within a tile of) a building's undercroft — every
        // stamped footprint is checked, even ones owned by a neighbour chunk
        if (stampedFeet.some(b2 => x >= b2.x0 - 1 && x < b2.x0 + b2.w + 1 &&
                                   y >= b2.y0 - 1 && y < b2.y0 + b2.h + 1)) continue;
        const shoreAdj = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inCh(x + dx, y + dy) && !isW(x + dx, y + dy));
        // a river-mouth spot: a coastal fishing tile where a river reaches the
        // sea. Whitebait run only here; the open coast yields the shore band.
        // A TRUE mouth (Phase 7 item 9) — some river tile in the window is
        // directly (4-adjacent) beside open sea, not just "river somewhere
        // nearby, sea somewhere else nearby" (that loose pairing classified
        // plain riverside AND plain shoreline spots as river-mouths alike,
        // leaking whitebait everywhere). Bails the moment one qualifies.
        const riverMouth = shoreAdj && (() => {
          const seaAt = (ax, ay) => {
            const tx = ax - bx, ty = ay - by;
            const e = (tx >= 0 && tx < CHUNK && ty >= 0 && ty < CHUNK) ? eG[G(tx, ty)] : elevation(ax * 0.5, ay * 0.5);
            return e < LAND_E;
          };
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const rx = x + dx, ry = y + dy;
            if (!riverAt(rx, ry)) continue;
            if (seaAt(rx + 1, ry) || seaAt(rx - 1, ry) || seaAt(rx, ry + 1) || seaAt(rx, ry - 1)) return true;
          }
          return false;
        })();
        // FRESHWATER vs the sea: a carved river tile, or any water sitting on BASE
        // land terrain (pure elevation ≥ LAND_E — rivers & lakes are carved INTO
        // land; erosion can sink their beds in eG, so the eroded grid can't tell),
        // holds the freshwater band — kōura and eels live here, never the sea fish
        // (and vice versa). The open sea's base terrain is strictly below LAND_E.
        const fresh = riverAt(x, y) || elevation(x * 0.5, y * 0.5) >= LAND_E;
        if (shoreAdj && want > 0) {
          addFishNode(x, y, riverMouth ? "rivermouth" : fresh ? "river" : "shore");
          want--;
        } else if (!shoreAdj && deepWant > 0) {
          // open-water spots: freshwater interiors (wide rivers, lake middles) stay
          // the river band — hoki and tuna don't school in a lake.
          // (deepWant is deliberately not decremented — the spacing check caps
          // density; open sea keeps several deep spots per chunk, as shipped)
          addFishNode(x, y, fresh ? "river" : eG[G(x - bx, y - by)] < 0.36 ? "abyss" : "deep");
        }
      }
    }

    // clear door-front sentinels so those tiles remain walkable at runtime
    for (let i = 0; i < N; i++) if (blocked[i] === 2) blocked[i] = 0;

    // --- ambient monsters: strictly from the biome's own list ---
    if (!(ccx === 0 && ccy === 0)) {
      const dist = Math.max(Math.abs(ccx), Math.abs(ccy));
      const hiCap = (5 + dist * 6) * LEVEL_SCALE;
      const landB = WATER_LIKE_B.has(centerB) ? centerB : centerB;
      const pool = [];
      for (let i = 0; i < 3; i++) {
        const lvlTarget = 1 + Math.pow(rng(), 1.8) * (hiCap - 1);
        const band = 6 * LEVEL_SCALE;
        const cands = biomeMobsInBand(landB, Math.max(1, lvlTarget - band), lvlTarget + band);
        if (cands.length) pool.push(cands[Math.floor(rng() * cands.length)].key);
      }
      const count = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < count && pool.length; i++) {
        const kind = pool[Math.floor(rng() * pool.length)];
        spawnDefs.push([kind, bx + 2 + Math.floor(rng() * (CHUNK - 4)), by + 2 + Math.floor(rng() * (CHUNK - 4))]);
      }
    } else {
      spawnDefs.push(["chicken", 14, -10], ["chicken", 15, -8], ["cow", -14, 8], ["sheep", -13, 10], ["slime", 6, 12]);
    }

    // --- pasture livestock: physical farm animals to TEND for Husbandry ---
    // (grass/farmland/meadow/savanna etc. — see GRASS_LIKE_B). Wander like any
    // animal; the player tends them instead of visiting a barn station.
    // livestock only where they belong: the herd roll draws from the animals whose
    // ANIMAL_BIOME (features.js) includes THIS chunk's biome (camels→deserts,
    // alpacas→cold highlands, waterfowl→wetland, etc.), not every field.
    if (typeof ANIMAL_BIOME !== "undefined" && typeof LIVESTOCK_SPAWN !== "undefined") {
      const here = LIVESTOCK_SPAWN.filter(k => ANIMAL_BIOME[k] && ANIMAL_BIOME[k].has(centerB));
      if (here.length) {
        const herd = 2 + Math.floor(rng() * 4);
        for (let i = 0; i < herd; i++) {
          let kind = here[Math.floor(rng() * here.length)];
          // ~1 in 6 is the GIANT ("_v") variant — double tend/feed, 2x-value items
          if (rng() < 1 / 6 && MONSTERS[kind + "_v"]) kind += "_v";
          const x = bx + 2 + Math.floor(rng() * (CHUNK - 4)), y = by + 2 + Math.floor(rng() * (CHUNK - 4));
          if (openTile(x, y) && MONSTERS[kind]) spawnDefs.push([kind, x, y]);
        }
      }
    }
    // exotic husbandry: dangerous-but-tendable beasts (griffon/aurochs/wyrmling),
    // each kept to its own wilds by ANIMAL_BIOME — rarer than farm livestock.
    if (typeof ANIMAL_BIOME !== "undefined" && typeof EXOTIC_SPAWN !== "undefined") {
      const here = EXOTIC_SPAWN.filter(k => ANIMAL_BIOME[k] && ANIMAL_BIOME[k].has(centerB));
      if (here.length && rng() < 0.5) {
        let kind = here[Math.floor(rng() * here.length)];
        if (rng() < 1 / 6 && MONSTERS[kind + "_v"]) kind += "_v";
        const x = bx + 2 + Math.floor(rng() * (CHUNK - 4)), y = by + 2 + Math.floor(rng() * (CHUNK - 4));
        if (openTile(x, y) && MONSTERS[kind]) spawnDefs.push([kind, x, y]);
      }
    }

    // --- Tūhura Isle: the tutorial journey (gameplay/tutorial.js) ---
    // The island chain itself is carved by the terrain override (terrain.js
    // TUT_ISLE / tutIsleSD); this pass adds the deliberate parts: the dirt
    // path along the spine, the gate fences across every isthmus waist, the
    // camp stations / tier-1 resources / portal stone / pier / training
    // spawns / map label — and strips the biome's ambient hostiles so a
    // level-1 character can't get mauled between gates.
    if (typeof TUT_ISLE !== "undefined" && typeof TUT_CONTENT !== "undefined" &&
        typeof tutIsleSD === "function" &&
        bx * 0.5 < TUT_ISLE.bbox.x1 && (bx + CHUNK) * 0.5 > TUT_ISLE.bbox.x0 &&
        by * 0.5 < TUT_ISLE.bbox.y1 && (by + CHUNK) * 0.5 > TUT_ISLE.bbox.y0) {
      for (let i = spawnDefs.length - 1; i >= 0; i--) {
        const q = tutIsleSD(spawnDefs[i][1] * 0.5, spawnDefs[i][2] * 0.5);
        // strip band widened 20 → 60 (2026-09-16): the Swim-Master's islet
        // sits far offshore and must be just as safe as the isle proper
        if (q && q.D < 60 && !(typeof TUT_TAME !== "undefined" && TUT_TAME.has(spawnDefs[i][0])))
          spawnDefs.splice(i, 1);
      }
      // NATIVE BIRDS (nz-extra-birds.js + gameplay/birdflight.js): the strip
      // above keeps TUT_TAME rolls, but the ambient band at this distance
      // rarely rolls a bird at all — so seed a deterministic scatter of small
      // natives on every isle land chunk. Fliers give a fresh hand their
      // first sight of birds on the wing; the kiwi potters on foot.
      {
        // weighted toward the fliers (duplicates = weight) so the isle sky is
        // busy; ruru + kiwi are nocturnal (birdflight.js) and only show at night
        const ISLE_BIRDS = ["piwakawaka", "piwakawaka", "tui", "tui", "kereru",
          "kereru", "kotata", "tieke", "titipounamu", "koreke", "pukeko",
          "ruru", "kiwi"];
        let seeded = 0;
        for (let i = 0; i < 40 && seeded < 8; i++) {
          const x = bx + 2 + Math.floor(rng() * (CHUNK - 4));
          const y = by + 2 + Math.floor(rng() * (CHUNK - 4));
          const q = tutIsleSD(x * 0.5, y * 0.5);
          if (!q || q.D >= -1) continue; // land only, a step in from the surf
          const kind = ISLE_BIRDS[Math.floor(rng() * ISLE_BIRDS.length)];
          if (openTile(x, y) && MONSTERS[kind]) { spawnDefs.push([kind, x, y]); seeded++; }
        }
      }
      const dropNodes = (x, y) => {
        for (let i = nodes.length - 1; i >= 0; i--)
          if (nodes[i].x === x && nodes[i].y === y) nodes.splice(i, 1);
      };
      // LEVEL-1 ISLAND: the isle sits far enough out that localTierCap rolls
      // high-tier trees/rocks/fish a fresh hand can't touch — demote every
      // natural TIERED node inside the footprint to tier 1. Labels stay
      // truthful (user req): a demoted tree is a plain "Tree", so it sheds
      // any species skin and looks the part. Native nzt_* trees are NOT
      // demoted — a Rimu is labelled Rimu and needs Rimu's level.
      for (let ni = nodes.length - 1; ni >= 0; ni--) {
        const n = nodes[ni];
        const q = tutIsleSD(n.x * 0.5, n.y * 0.5);
        if (!q || q.D >= 60) continue; // 12 → 60: the islet's growth demotes too
        if (n.type.startsWith("treeT") && n.type !== "treeT0") { n.type = "treeT0"; delete n.sprv; }
        // NATURAL METAL ROCKS ARE STRIPPED OUTRIGHT (2026-09-16, user req):
        // the Smith's terrace is an EXACT ore ledger (tutorial.js pod-3
        // stamps, pinned yields) — a stray biome-rolled rock anywhere on the
        // isle would break the arithmetic. Stamps run after this pass, so
        // the terrace itself survives.
        else if (/^rockM\d+$/.test(n.type) || n.type === "iron" || n.type === "goldrock" ||
                 n.type === "copper") { nodes.splice(ni, 1); continue; }
        else {
          const fm = n.type.match(/^fishspot_(\d+)$/);
          // Whitebait (0) is ESTUARY-ONLY — never mint it here. Demote to the
          // two low-level open-water catches instead: shrimp (32, req 1) and
          // yellow-eyed mullet (1, req 2). The scripted rivermouth-run spots
          // (tutorial.js pod-2 stamps) are the isle's only whitebait.
          if (fm && +fm[1] > 1 && +fm[1] !== 32)
            n.type = "fishspot_" + (((n.x + n.y) & 1) ? 1 : 32);
        }
      }
      // RINGED-ISLE painting (user redesign 2026-09-16): terrain.js is the
      // single source of geometry truth — tutFenceAt() says what stands on
      // each tile (ring fences, sector spokes, chamber walls, weir arcs,
      // gate arches). Gate ENFORCEMENT is Tutorial.barred (chain s + river
      // position, movement.js); the decor here just makes the rules visible.
      const RIV = TUT_ISLE.river;
      for (let ly2 = 0; ly2 < CHUNK; ly2++)
        for (let lx2 = 0; lx2 < CHUNK; lx2++) {
          const x = bx + lx2, y = by + ly2;
          const q = tutIsleSD(x * 0.5, y * 0.5);
          if (!q) continue;
          const li2 = ly2 * CHUNK + lx2;
          // BRIDGE: a clean deck band where the journey path crosses the
          // river — ONLY the Cove→Forge crossing (s past 1.9): between the
          // Bush chamber and the Cove the path runs DOWN THE WATER itself
          // (the river-gate ride), and decking there would dry out the ride.
          if (q.d < 1.1 && q.s > 1.9 && q.pRiver >= 0 && q.riverLine < RIV.waterR + 2) {
            dropNodes(x, y); decor[li2] = "stone_bridge"; continue;
          }
          const f = (typeof tutFenceAt === "function") ? tutFenceAt(x * 0.5, y * 0.5) : null;
          if (f) {
            dropNodes(x, y);
            if (f.gate >= 0) {
              // a journey-gate arch (gate 1 stands mid-river): physically
              // open — barred() alone holds it shut
              decor[li2] = "gate_wood"; blocked[li2] = 0;
              if (!isWaterKey(ground[li2])) ground[li2] = "dirt#1";
            } else {
              decor[li2] = "fence_wood"; blocked[li2] = 1; // posts stand in water too (river banks, surf line)
            }
            continue;
          }
          if (q.D > -1.5) continue;                     // dry land only for the rest
          if (isWaterKey(ground[li2])) continue;        // river / pools — leave them
          if (q.d < 0.9) {                              // the walking path
            dropNodes(x, y);
            if (!String(decor[li2] || "").startsWith("stone_bridge")) decor[li2] = null;
            blocked[li2] = 0;
            ground[li2] = "dirt#1";
          }
        }
      // hand-placed stamps (absolute game coords, built in tutorial.js)
      for (const st of TUT_CONTENT.stamps) {
        const x = st.x, y = st.y;
        if (!inCh(x, y)) continue;
        if (st.mon) { if (MONSTERS[st.mon]) spawnDefs.push([st.mon, x, y]); continue; }
        if (st.label) { labels.push({ x, y, label: st.label, c: st.c || "#ffd75e" }); continue; }
        dropNodes(x, y);
        const wat = isWaterKey(ground[li(x, y)]);
        if (st.node) {
          if (st.water && !wat) continue; // fishing spots need surviving water
          // an erosion-carved pond under a land station: terraform it back —
          // hand-placed content beats a droplet walk
          if (!st.water && wat) ground[li(x, y)] = biomeGround(B.GRASS, x, y);
          decor[li(x, y)] = null;
          if (!st.water) blocked[li(x, y)] = 0;
          addNode(st.node, x, y, st.blk !== false, st.extra ? { ...st.extra } : {});
        } else if (st.decor) {
          // e.g. the pier: stone_bridge decking — over water the ground (and
          // its blocked flag) stays, exactly like generated bridges; the
          // passable() deck rule makes it walkable
          decor[li(x, y)] = st.decor;
          if (st.blk) blocked[li(x, y)] = 1;
        }
      }
      // the village's PROPER HOUSES (user req 2026-09-16): stamped through
      // the very same stampBuilding pipeline natural settlements use — real
      // floors, walls, roofs and a south door (render3d + structAt read
      // them from the wall decor + ch.buildings records). job stays null so
      // deriveNpcs spawns no shopkeepers — the keepers themselves are the
      // villagers. Footprints live in TUT_VILLAGE.houses (pods 0 + 14, clear
      // of path/pier/seats/lamps); a modest stool downstairs (real bedrooms
      // are upstairs — kind:"tut_house" gives each one a ladder + storeys,
      // user req 2026-09-17; see world.js buildingMeta and render3d.js's
      // tutHouseUpperDecor for the bedroom furnishing itself).
      if (typeof TUT_VILLAGE !== "undefined" && TUT_VILLAGE.houses)
        for (const hb of TUT_VILLAGE.houses) {
          const vp = TUT_ISLE.pods[hb.pod];
          const b = { x0: vp.mx * 2 + hb.x0, y0: vp.my * 2 + hb.y0, w: hb.w, h: hb.h,
            kind: hb.kind, storeys: hb.storeys };
          if (b.x0 + b.w < bx || b.x0 >= bx + CHUNK ||
              b.y0 + b.h < by || b.y0 >= by + CHUNK) continue;
          // row 2, not row 1: row 1 is directly beneath the UPPER floor's
          // bed-slot tiles (render3d.js tutHouseUpperDecor / TUT_VILLAGE.
          // bedTile both use x0+1/x0+w-2 at y0+1) — a ground-floor decor
          // prop sitting on that exact tile was silently blocking NPCs from
          // ever reaching their own bed above it (npcStepToward's lift/
          // height check reads the GROUND floor's decor at that (x,y) even
          // for an upstairs-walking NPC, since upper storeys have no collision
          // grid of their own). User-reported: "stuck at the bottom of the
          // ladder in every house", 2026-09-17.
          if (stampBuilding(b))
            furnishInterior(b, [["bed", 1, 2], ["stool", hb.w - 2, 2]]);
        }
      // the Swim-Master's ISLET (TUT_ISLE.islet, per-character seat — this
      // zone is never persisted/injected, see _inIsletZone): the weathered
      // sea chest with Vrixa's pearl, a shell or two, and a map label.
      if (TUT_ISLE.islet) {
        const I = TUT_ISLE.islet;
        const ix = Math.round(I.x * 2), iy = Math.round(I.y * 2);
        if (inCh(ix, iy) && !isWaterKey(ground[li(ix, iy)])) {
          dropNodes(ix, iy);
          decor[li(ix, iy)] = null; blocked[li(ix, iy)] = 0;
          addNode("tut_seachest", ix, iy, true);
          labels.push({ x: ix, y: iy - 4, label: "Te Motu", c: "#7fe3c7" });
        }
        for (const [sdx, sdy, dk] of [[-2, 2, "seashell"], [3, -1, "seashell"], [1, 3, "coral_red"]]) {
          const sx2 = ix + sdx, sy2 = iy + sdy;
          if (inCh(sx2, sy2) && !isWaterKey(ground[li(sx2, sy2)]) && !decor[li(sx2, sy2)] &&
              !nodes.some(n => n.x === sx2 && n.y === sy2)) decor[li(sx2, sy2)] = dk;
        }
      }
      // keep every tutor's tile clear of natural growth (the NPCs themselves
      // are derived in deriveNpcs so hydrated chunks get them too) — and the
      // Harbour Village seats they come home to at dusk (TUT_VILLAGE)
      if (typeof TUT_TUTORS !== "undefined") {
        const clearSpot = (x, y) => {
          if (!inCh(x, y)) return;
          if (isWaterKey(ground[li(x, y)])) ground[li(x, y)] = biomeGround(B.GRASS, x, y);
          dropNodes(x, y);
          if (decor[li(x, y)] !== "stone_bridge") decor[li(x, y)] = null;
          blocked[li(x, y)] = 0;
        };
        for (const tu of TUT_TUTORS) {
          const pod = TUT_ISLE.pods[tu.pod];
          clearSpot(pod.mx * 2 + tu.dx, pod.my * 2 + tu.dy);
        }
        if (typeof TUT_VILLAGE !== "undefined") {  // seats + lamps span pods 0 AND 14
          for (const id in TUT_VILLAGE.seats) {
            const s2 = TUT_VILLAGE.seats[id], vp = TUT_ISLE.pods[s2.pod];
            clearSpot(vp.mx * 2 + s2.dx, vp.my * 2 + s2.dy);
          }
          for (const L of TUT_VILLAGE.lamps) {
            if (L.inside) continue;   // indoor glows live on house floors — leave them be
            const vp = TUT_ISLE.pods[L.pod];
            const lx = vp.mx * 2 + L.dx, ly = vp.my * 2 + L.dy;
            // never terraform the surf for a lamp candidate — villageLamps
            // skips watery spots at emit time instead
            if (!inCh(lx, ly) || isWaterKey(ground[li(lx, ly)])) continue;
            dropNodes(lx, ly);
            if (decor[li(lx, ly)] !== "stone_bridge") decor[li(lx, ly)] = null;
            blocked[li(lx, ly)] = 0;
          }
        }
      }
      // NATIVE BUSH (user req): every pod gets the Bush-pod treatment — the
      // whole isle greens up with REAL native trees (nzt_* nodes: a Rimu is
      // labelled Rimu, needs Rimu's Woodcutting level and yields its own
      // rākau — user req: truthful labels + appropriate reqs) plus native
      // undergrowth, so the birds have crowns to roost in everywhere. The
      // low natives (mānuka 3, akeake 8, karo 9, ngaio 10…) keep early axes
      // busy beyond the Bushman's tier-1 thicket; the podocarp giants are
      // something to come back for. Thick inside the pods, thinning to open
      // ridge between them; the walking path keeps a clear verge, keepers
      // keep a 7-tile tree-free ring (sightlines), and this runs AFTER the
      // stamps so no station/resource tile is ever overplanted.
      {
        const CANOPY = ["nzt_rimu", "nzt_tawa", "nzt_kamahi", "nzt_puriri",
          "nzt_rewarewa", "nzt_kahikatea", "nzt_kauri"];
        const MID = ["nzt_ponga", "nzt_mamaku", "nzt_tikouka", "nzt_kowhai",
          "nzt_kotukutuku", "nzt_houhere", "nzt_wheki", "nzt_manuka", "nzt_akeake"];
        const COAST = ["nzt_pohutukawa", "nzt_ngaio", "nzt_karo"];
        const UNDER = ["nz_toetoe", "nz_rangiora", "nz_horoeka", "nz_wharariki",
          "nz_kawakawa", "nz_koru"];
        const podNear = (x, y, r) => TUT_ISLE.pods.some(p =>
          Math.abs(x - p.mx * 2) <= r && Math.abs(y - p.my * 2) <= r);
        const tutors = (typeof TUT_TUTORS !== "undefined")
          ? TUT_TUTORS.map(tu => ({ x: TUT_ISLE.pods[tu.pod].mx * 2 + tu.dx,
                                    y: TUT_ISLE.pods[tu.pod].my * 2 + tu.dy }))
          : [];
        if (typeof TUT_VILLAGE !== "undefined")  // the evening seats stay clear too
          for (const id in TUT_VILLAGE.seats) {
            const s2 = TUT_VILLAGE.seats[id], vp = TUT_ISLE.pods[s2.pod];
            tutors.push({ x: vp.mx * 2 + s2.dx, y: vp.my * 2 + s2.dy });
          }
        const tutorNear = (x, y, r) => tutors.some(t =>
          Math.abs(x - t.x) <= r && Math.abs(y - t.y) <= r);
        let trees = 0, plants = 0;
        for (let t2 = 0; t2 < 340 && (trees < 26 || plants < 16); t2++) {
          const x = bx + 1 + Math.floor(rng() * (CHUNK - 2));
          const y = by + 1 + Math.floor(rng() * (CHUNK - 2));
          const q = tutIsleSD(x * 0.5, y * 0.5);
          if (!q || q.D >= -1.5) continue;      // dry land, a step in from the surf
          if (q.d < 1.8) continue;              // clear verge along the spine path
          if (podNear(x, y, 4)) continue;       // keepers' dooryards stay open
          const idx = li(x, y);
          if (isWaterKey(ground[idx]) || blocked[idx] || decor[idx] ||
              nodes.some(n => n.x === x && n.y === y)) continue;
          if (!podNear(x, y, 15) && rng() < 0.5) continue; // ridges half as thick
          if (trees < 26 && rng() < 0.62 && !tutorNear(x, y, 7)) {
            // pōhutukawa/ngaio hold the coast line, podocarp giants the interior
            const pool = q.D >= -4 ? COAST : (rng() < 0.3 ? CANOPY : MID);
            const kind = pool[Math.floor(rng() * pool.length)];
            if (NODE_TYPES[kind]) { addNode(kind, x, y, false); trees++; }
          } else if (plants < 16 && !tutorNear(x, y, 3)) {
            decor[idx] = UNDER[Math.floor(rng() * UNDER.length)];
            plants++;
          }
        }
      }
      // KEEPER SIGHTLINES (user req): whatever planted a tree — the biome
      // scatter, the hand-stamped lesson thickets, the bush pass above — the
      // orbiting camera must never lose a tutor behind a crown. Within 3
      // tiles of a tutor's post trees go entirely; in the 3-7 band TALL
      // natives are removed (labels stay truthful — no re-skinning a Kauri
      // into a mānuka), while the modest generic "Tree" billboards (the
      // Bushman's lesson thicket) may stand.
      if (typeof TUT_TUTORS !== "undefined") {
        const tutors = TUT_TUTORS.map(tu => ({
          x: TUT_ISLE.pods[tu.pod].mx * 2 + tu.dx,
          y: TUT_ISLE.pods[tu.pod].my * 2 + tu.dy }));
        if (typeof TUT_VILLAGE !== "undefined")  // sightlines hold at the village seats too
          for (const id in TUT_VILLAGE.seats) {
            const s2 = TUT_VILLAGE.seats[id], vp = TUT_ISLE.pods[s2.pod];
            tutors.push({ x: vp.mx * 2 + s2.dx, y: vp.my * 2 + s2.dy });
          }
        for (let i = nodes.length - 1; i >= 0; i--) {
          const n = nodes[i];
          const nt2 = NODE_TYPES[n.type];
          if (!nt2 || nt2.skill !== "Woodcutting") continue;
          let d = Infinity;
          for (const t of tutors)
            d = Math.min(d, Math.max(Math.abs(n.x - t.x), Math.abs(n.y - t.y)));
          if (d > 7) continue;
          // drawn height: "nzf_*" species art carries its real scale;
          // generic tree billboards sit around 2.2-2.6
          const skin = n.sprv || nt2.spr || "";
          const h = (skin.startsWith("nzf_") && typeof NZ_TREE_SCALE !== "undefined")
            ? (NZ_TREE_SCALE["nz_" + skin.slice(4)] || 2.2) : 2.4;
          if (d > 3 && h <= 2.0) continue; // low native in the outer band: fine
          if (d > 3 && n.type.startsWith("treeT")) continue; // modest lesson tree
          nodes.splice(i, 1);
          if (inCh(n.x, n.y)) blocked[li(n.x, n.y)] = 0;
        }
      }
    }

    // --- The Dream Forest (gameplay/dream.js): waystone glades, the interior
    // levels' bramble rims, and the Heart village -----------------------------
    // Every glade — the door in each wild Dream Forest patch, each level's IN
    // and OUT, the Heart's arrival — is stamped from ONE deterministic local
    // pattern (hashes of the tile's OFFSET from the glade centre, never world
    // coords), so all of them are pixel-identical out to GLADE_RG tiles. That
    // identity is what makes dream.js's silent relocations invisible: at the
    // moment of a swap the whole screen (zoom is clamped inside the dream) is
    // stamp, and the stamp is the same on both sides. Stamp flora is DECOR,
    // never nodes — chopping/Taking would let two glades drift apart
    // (decor-pickup.js refuses inside a glade for the same reason).
    if (typeof DREAM_WORLD !== "undefined" && typeof dreamSD === "function") {
      const GLADE_RG = 52;
      const dropNodes2 = (x, y) => {
        for (let i = nodes.length - 1; i >= 0; i--)
          if (nodes[i].x === x && nodes[i].y === y) nodes.splice(i, 1);
      };
      const nearCh = (gx, gy, pad) => gx + pad >= bx && gx - pad < bx + CHUNK &&
                                      gy + pad >= by && gy - pad < by + CHUNK;
      // every glade whose stamp could touch this chunk
      const glades = [];
      for (const L of DREAM_WORLD.LVL)
        for (const g of [L.IN, L.OUT]) {
          const gx = Math.round(g.x * 2), gy = Math.round(g.y * 2);
          if (nearCh(gx, gy, GLADE_RG + 8)) glades.push({ x: gx, y: gy });
        }
      {
        const H = DREAM_WORLD.HEART.IN;
        const gx = Math.round(H.x * 2), gy = Math.round(H.y * 2);
        if (nearCh(gx, gy, GLADE_RG + 8)) glades.push({ x: gx, y: gy });
      }
      if (typeof dreamGatesNear === "function")
        for (const g of dreamGatesNear(bxM - 34, byM - 34, bxM + csM + 34, byM + csM + 34)) {
          const gx = Math.round(g.x * 2), gy = Math.round(g.y * 2);
          if (nearCh(gx, gy, GLADE_RG + 8)) glades.push({ x: gx, y: gy });
        }
      if (glades.length) {
        for (const g of glades) {
          for (let ty2 = 0; ty2 < CHUNK; ty2++)
            for (let tx2 = 0; tx2 < CHUNK; tx2++) {
              const x = bx + tx2, y = by + ty2;
              const dx = x - g.x, dy = y - g.y, d2 = dx * dx + dy * dy;
              if (d2 > GLADE_RG * GLADE_RG) continue;
              const idx = ty2 * CHUNK + tx2;
              // standardized floor: fixed dream atlas column, LOCAL-hash variant
              // (biomeGround's world-coord dither would differ between glades)
              ground[idx] = "at_30_" + (hash2i(dx + 97, dy + 97, 0xd0d0) % 4) + "_6";
              dropNodes2(x, y); decor[idx] = null; blocked[idx] = 0;
              if (d2 > 9.5 * 9.5) {   // forest ring; the clearing stays open
                const r = hash2i(dx + 97, dy + 97, 0xd0d1) % 1000;
                if (r < 170) { decor[idx] = "tree_dreamwood"; blocked[idx] = 1; }
                else if (r < 210) { decor[idx] = "tree_duskwood"; blocked[idx] = 1; }
                else if (r < 245) decor[idx] = "mushroom";
                else if (r < 268) decor[idx] = "flower_purple";
              }
            }
          // the clearing's fixed furniture — identical at every glade, and the
          // exact props the whispers talk about (dream.js): the waystone, and
          // the one twisted dreamwood you could swear you have passed before
          const put = (dx, dy, key, blk) => {
            const x = g.x + dx, y = g.y + dy;
            if (!inCh(x, y)) return;
            dropNodes2(x, y);
            decor[li(x, y)] = key;
            blocked[li(x, y)] = blk ? 1 : 0;
          };
          put(0, 0, "pillar_stone", true);
          put(3, -2, "tree_dreamwood", true);
          put(-4, 3, "mushroom_big2", false);
          put(2, 4, "flower_purple", false);
          put(-2, -3, "mushroom", false);
        }
        // no creature may stand in a stamp: a bird or beast visible at the
        // moment of a relocation would pop in or out of existence
        for (let i = spawnDefs.length - 1; i >= 0; i--) {
          const sx = spawnDefs[i][1], sy = spawnDefs[i][2];
          if (glades.some(g => Math.abs(sx - g.x) <= 60 && Math.abs(sy - g.y) <= 60))
            spawnDefs.splice(i, 1);
        }
      }
      // interior chunks: the bramble rim — a near-solid thicket band just
      // inside each level disc's edge. Dream.barred is the true wall; this
      // makes the wall READ as forest, not magic.
      if (dreamSD(bxM + csM / 2, byM + csM / 2)) {
        for (let ty2 = 0; ty2 < CHUNK; ty2++)
          for (let tx2 = 0; tx2 < CHUNK; tx2++) {
            const x = bx + tx2, y = by + ty2;
            const dq = dreamSD(x * 0.5, y * 0.5);
            if (!dq) continue;
            const over = dq.r - (dq.R - 4);      // map units into the rim band
            if (over <= 0 || over >= 14) continue;
            const idx = ty2 * CHUNK + tx2;
            if (String(decor[idx] || "").startsWith("stone_bridge")) continue;
            const r = hash2i(x, y, 0xd0d2) % 1000;
            if (r < 800) {
              dropNodes2(x, y);
              decor[idx] = r < 430 ? "tree_duskwood" : "bush#1";
              blocked[idx] = 1;
            }
          }
      }
      // the HEART: a lamp-lit glade village no map will ever hold — the reward
      // at the very centre of the dream. Houses go through the real settlement
      // pipeline (stampBuilding, job-less so deriveNpcs adds no shopkeeper);
      // the Matron and the Pedlar are derived in deriveNpcs like the Registrar.
      const HC = { x: Math.round(DREAM_WORLD.HEART.cx * 2), y: Math.round(DREAM_WORLD.HEART.cy * 2) };
      if (nearCh(HC.x, HC.y, 26)) {
        const clear = (x, y) => {
          if (!inCh(x, y)) return;
          dropNodes2(x, y); decor[li(x, y)] = null; blocked[li(x, y)] = 0;
        };
        for (let dy = -8; dy <= 11; dy++)
          for (let dx = -13; dx <= 13; dx++) {
            if (dx * dx * 0.6 + dy * dy > 118) continue;   // a soft meadow ellipse
            const x = HC.x + dx, y = HC.y + dy;
            if (!inCh(x, y)) continue;
            ground[li(x, y)] = "at_30_" + (hash2i(dx + 31, dy + 31, 0xd0d4) % 4) + "_6";
            clear(x, y);
          }
        for (const hb of [{ x0: HC.x - 10, y0: HC.y - 4, w: 6, h: 5 },
                          { x0: HC.x + 5, y0: HC.y - 5, w: 6, h: 5 }]) {
          if (hb.x0 + hb.w < bx || hb.x0 >= bx + CHUNK ||
              hb.y0 + hb.h < by || hb.y0 >= by + CHUNK) continue;
          if (stampBuilding(hb))
            furnishInterior(hb, [["bed", 1, 1], ["stool", hb.w - 2, 1]]);
        }
        const putH = (dx, dy, key, blk) => {
          const x = HC.x + dx, y = HC.y + dy;
          if (!inCh(x, y)) return;
          dropNodes2(x, y);
          decor[li(x, y)] = key;
          blocked[li(x, y)] = blk ? 1 : 0;
        };
        putH(0, 1, "well_roofed", true);
        putH(-3, 3, "candle_altar", true);
        putH(3, 4, "candle_altar", true);
        putH(-6, -1, "candle_altar", true);
        putH(8, 2, "candle_altar", true);
        // moonflax: the Heart's exclusive gatherable (NODE_TYPES.dream_moonflax,
        // registered by gameplay/dream.js)
        if (typeof NODE_TYPES !== "undefined" && NODE_TYPES.dream_moonflax)
          for (const [mdx, mdy] of [[-7, 6], [-4, 8], [0, 7], [4, 8], [7, 6], [2, 9]]) {
            const x = HC.x + mdx, y = HC.y + mdy;
            if (!inCh(x, y)) continue;
            clear(x, y);
            addNode("dream_moonflax", x, y, false);
          }
        if (inCh(HC.x, HC.y - 7))
          labels.push({ x: HC.x, y: HC.y - 7, label: "The Heart of the Dream", c: "#c9a7ff" });
      }
    }

    ch = { cx: ccx, cy: ccy, ground, decor, blocked, nodes, spawnDefs, buildings, labels, activated: false };
    chunks.set(key, ch);
    deriveNpcs(ch);
    genLog.push({ key, ms: Math.round(performance.now() - _t0) });
    if (genLog.length > 200) genLog.splice(0, 100);
    return ch;
  }

  // persist the chunk that owns tile (x,y) — call after a runtime mutation
  // (planting/harvesting a crop, depleting a node) so a browser refresh keeps it
  // even though the chunk is still in memory and hasn't been evicted.
  function persistAt(x, y) { persistChunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK)); }
  // write EVERY in-memory chunk back to IDB (called on save/autosave) so all
  // loaded crop/node state survives a reload without waiting for eviction —
  // batched into ONE transaction so a large loaded set stays cheap.
  function flushChunks() {
    const list = [...chunks.values()];
    if (!list.length) return;
    _openDB().then(db => {
      const store = db.transaction('c', 'readwrite').objectStore('c');
      for (const ch of list) store.put({
        g: ch.ground, d: ch.decor, b: ch.blocked,
        n: ch.nodes, s: ch.spawnDefs, bl: ch.buildings, la: ch.labels,
      }, _ck(ch.cx, ch.cy));
    }).catch(() => {});
  }
  return { chunks, obstacles, npcs, getChunk, preloadSeen, persistChunk, persistAt, flushChunks, pruneChunks, dropChunkRect, genLog, _fieldInject };
}
