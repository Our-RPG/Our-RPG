// ===== Recipe constraints pass: ≤3 inputs, ≤1 by-product, ≤1 station =====
// A load-time normalization that runs AFTER every skill module has populated
// RECIPES/ITEMS (and after id-canonical.js, so all ids are already canonical).
// Any recipe whose `in` has more than three ingredient types is split into
// hand-designed intermediate "sub-assembly" items — each itself capped at three
// inputs — that are then crafted together in a final ≤3-input stage. It then
// trims every recipe to a single by-product and a single (primary) station, and
// converts every "passive" recipe into an active "time to craft" one (there are
// no passive/offline jobs anymore). Tools are a SEPARATE concern: each craft
// skill maps to ≤1 tool via TOOL_SKILLS in js/skills/production.js (at source).
//
// Design doctrine (see the per-family BUCKETS below): every family maps to at
// most THREE semantic buckets (e.g. leather goods -> uppers / fasteners /
// finish; ships -> hull / rigging / cordage; soap -> base / additives /
// saponite). Each bucket holds at most three ingredient TYPES. A bucket with
// >=2 types becomes an intermediate item carrying the EXACT sub-quantities from
// the parent recipe (so raw-material totals and tier progression are conserved);
// a 1-type bucket stays loose. Bundles that come out identical within a skill
// are deduped into one shared component. A generic greedy fallback guarantees
// the <=3 cap even for families/recipes not explicitly modelled.
//
// Same file loads in the game bundle (tools/bundle.list) and the studio
// (studio/index.html), so the studio's recipe tables + saves get it for free.
// Idempotent: guarded so a double-include is harmless. It only ADDS items and
// recipes and REWRITES each oversized recipe's `.in` — it never renames an
// output id, so every cross-reference (ships using full_ship_rig, etc.) holds.
"use strict";

(function () {
  var G = (typeof window !== "undefined") ? window
        : (typeof globalThis !== "undefined") ? globalThis : this;
  if (G.RECIPE_SPLIT_DONE) return;
  if (typeof RECIPES === "undefined" || typeof ITEMS === "undefined") return;
  G.RECIPE_SPLIT_DONE = true;

  var MAX_IN = 3;

  // ---- helpers -----------------------------------------------------------
  function titleCase(s) {
    return String(s).replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function prettyOut(rec) {
    var it = ITEMS[rec.out];
    return (it && it.name) || titleCase(rec.out || rec.id || "item");
  }
  // pick an existing atlas icon from the bundle's ingredients (icons are just
  // references — reusing one means zero sprite work and never a broken sprite).
  function iconFor(entries) {
    var best = null, bestQty = -1;
    for (var i = 0; i < entries.length; i++) {
      var id = entries[i][0], qty = entries[i][1];
      var it = ITEMS[id];
      if (it && it.icon && qty > bestQty) { best = it.icon; bestQty = qty; }
    }
    if (best) return best;
    // fall back to any ingredient's icon, else a neutral crafted-goods icon
    for (var j = 0; j < entries.length; j++) { var d = ITEMS[entries[j][0]]; if (d && d.icon) return d.icon; }
    return (ITEMS.iron_bar && ITEMS.iron_bar.icon) || "i_iron_bar_mb";
  }
  function valueFor(entries) {
    var v = 0;
    for (var i = 0; i < entries.length; i++) { var it = ITEMS[entries[i][0]]; if (it && it.value) v += it.value * entries[i][1]; }
    return Math.max(1, Math.round(v * 1.05)); // slight value-add for the labour
  }
  function sig(cat, entries) {
    return cat + "|" + entries.map(function (e) { return e[0] + ":" + e[1]; }).sort().join(",");
  }
  // Always mint an id not already taken. Legitimate reuse of an identical
  // bundle is handled earlier by the bySig signature cache; by the time we get
  // here the signature is new, so it must NOT collide with any existing item
  // (including a same-named bundle that carries different quantities).
  function uniqueId(base) {
    if (!ITEMS[base]) return base;
    // Disambiguate with a letter (not a number) so no component id ever ends in
    // "_<digit>" — that pattern reads as a legacy machine id.
    var alph = "bcdefghijklmnopqrstuvwxyz";
    for (var i = 0; i < alph.length; i++) { var id = base + "_" + alph[i]; if (!ITEMS[id]) return id; }
    var n = 2; while (ITEMS[base + "_" + n]) n++; return base + "_" + n;
  }

  var madeItems = 0, madeRecipes = 0, splitCount = 0;
  var bySig = {}; // signature -> intermediate item id (dedup within category)

  // Create (or reuse) an intermediate item + its crafting recipe for a set of
  // ingredient entries ([[id,qty],...], length 1..3). Returns the item id.
  // A `label` marks a reusable, family-generic staple (e.g. "Soap base",
  // "Fletched shafts"): those are deduped by signature so many parents share
  // one component. Role-only bundles are named after THEIR OWN parent and are
  // never merged across parents, so each finished item's crafting tree reads
  // self-consistently (Master's boots <- Master's boots fasteners, not a
  // sibling's).
  function makeIntermediate(cat, parent, entries, label, roleWord) {
    entries = entries.slice().sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    var s = label ? sig(cat, entries) : null;
    if (s && bySig[s]) return bySig[s];

    var idBase;
    if (label) idBase = slugify(label);
    else idBase = slugify(prettyOut(parent) + " " + (roleWord || "parts"));
    var id = uniqueId(idBase);

    var inObj = {};
    for (var i = 0; i < entries.length; i++) inObj[entries[i][0]] = entries[i][1];

    ITEMS[id] = {
      name: label || (prettyOut(parent) + " " + (roleWord || "parts")),
      icon: iconFor(entries),
      stack: true,
      value: valueFor(entries),
      finished: true,
      _split_component: true
    };
    madeItems++;

    var rec = {
      id: "craft_" + id,
      out: id, qty: 1,
      name: "Assemble " + ITEMS[id].name.toLowerCase(),
      skill: parent.skill,
      req: Math.max(1, (parent.req | 0)),
      xp: Math.max(1, Math.round((parent.xp || 20) * 0.2)),
      tick: Math.max(600, Math.round((parent.tick || 2000) * 0.45)),
      family: (parent.family || "misc") + "_parts",
      stations: (parent.stations || []).slice(),
      in: inObj,
      _split_component: true
    };
    RECIPES[cat] = RECIPES[cat] || [];
    RECIPES[cat].push(rec);
    madeRecipes++;

    if (s) bySig[s] = id;
    return id;
  }
  function slugify(s) {
    return String(s).toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  // Reduce a bucket's entries to a SINGLE representative for the final recipe.
  //  - 1 entry            -> stays loose (original id + original qty)
  //  - 2..3 entries       -> one intermediate (qty 1)
  //  - >3 entries         -> nested intermediates (each <=3), collapsed to one
  function bundleToOne(cat, parent, entries, label, roleWord) {
    if (entries.length === 1) return { id: entries[0][0], qty: entries[0][1], loose: true };
    if (entries.length <= MAX_IN) {
      return { id: makeIntermediate(cat, parent, entries, label, roleWord), qty: 1 };
    }
    // >3: chunk into groups of <=3, bundle each group, then recurse on the reps
    var groups = [], i;
    for (i = 0; i < entries.length; i += MAX_IN) groups.push(entries.slice(i, i + MAX_IN));
    var reps = groups.map(function (g) {
      // nested sub-bundles get a distinct role word so they don't collide with
      // (or read identically to) the wrapping bundle.
      var r = bundleToOne(cat, parent, g, null, (roleWord || "parts") + " set");
      return [r.id, r.qty];
    });
    // reps carry qty already; recurse treating them as fresh entries
    return bundleToOne(cat, parent, reps, label, roleWord);
  }

  // ---- per-family bucket design -----------------------------------------
  // Each bucket: { role, name?, ids:[...], pre?:fn(id) }  (<=3 buckets).
  // `name` marks a reusable/shared component (used as-is regardless of parent).
  function bucketsFor(cat, family) {
    switch (cat) {
      case "baking":
        return [
          { role: "batter", name: "Cake batter", ids: ["flour", "egg", "butter"] },
          { role: "sweetener", ids: ["honey", "milk", "sugar"] }
        ];
      case "bookbinding":
        return [
          { role: "quires", ids: ["paper", "fine_paper", "cardstock", "parchment", "vellum", "waxed_thread", "hide_glue"] },
          { role: "cover set", ids: ["book_cover", "ink", "gold_ink", "iron_gall_ink"] },
          { role: "illumination", ids: ["lens", "cut_gem", "fine_gold", "wraith_ink", "phantom_ink"] }
        ];
      case "candlemaking":
        return [
          { role: "taper", ids: ["beeswax", "tallow", "wick"] },
          { role: "scent", name: "Candle scent blend", ids: ["herb", "madder_dye", "honey"] },
          { role: "wax", ids: ["corpse_wax", "barrow_wax"] }
        ];
      case "carpentry":
        return [
          { role: "frame", ids: ["planks", "boards"] },
          { role: "fittings", ids: ["cloth", "rope", "glass", "iron_bar", "gold_bar"] },
          { role: "glue", ids: ["master_joiners_glue", "hide_glue"] }
        ];
      case "coopering":
        return [
          { role: "body", ids: ["seasoned_staves", "iron_hoops", "staves"] },
          { role: "inlay", ids: ["gold_bar", "gem", "silver_bar"] },
          { role: "rivets", ids: ["riveted_hoopstock"] }
        ];
      case "cordwaining":
      case "saddlery":
      case "leatherworking":
        return [
          { role: "uppers", ids: ["leather", "dyed_leather", "fulled_felt"] },
          { role: "fasteners", ids: ["waxed_thread", "tacks", "iron_bar", "rope", "boards"] },
          { role: "finish", ids: ["cobbler_wax", "hard_cobbler_wax", "curing_oil", "rich_curing_oil",
              "rawhide_lace", "tough_rawhide_lace", "fine_gold", "cut_gem"] }
        ];
      case "fletching":
        return [
          { role: "fletched", name: "Fletched shafts", ids: ["arrow_shafts", "feathers"] },
          { role: "heads", pre: function (id) { return id.indexOf("arrowhead_") === 0; } },
          { role: "sinew", ids: ["sinew", "thick_sinew"] }
        ];
      case "glassblowing":
        if (family === "glassware") return [
          { role: "body", ids: ["glass", "leather"] },
          { role: "part", ids: ["snorkel_mouthpiece"] },
          { role: "mote", ids: ["elemental_mote"] }
        ];
        return [ // frit + generic glass batch
          { role: "batch", name: "Glass batch", ids: ["sand", "wood_ash", "slaked_lime", "soda_ash"] },
          { role: "flux", ids: ["marble", "lead_oxide", "cullet"] },
          { role: "mote", ids: ["elemental_mote"] }
        ];
      case "jewelry":
        return [
          { role: "metal", ids: ["fine_gold", "fine_silver", "fine_platinum", "electrum"] },
          { role: "gems", ids: ["cut_gem", "brilliant_gem", "diamond", "ruby", "sapphire", "gem"] },
          { role: "chain", ids: ["gold_chain", "silver_chain", "master_chain", "seraph_feather", "astral_shard"] }
        ];
      case "limeburning":
        return [
          { role: "binder", ids: ["hydraulic_lime", "slaked_lime", "clay"] },
          { role: "aggregate", name: "Mortar aggregate", ids: ["sand", "wood_ash"] },
          { role: "grit", ids: ["adamant_grit", "binding_grit"] }
        ];
      case "locksmithing":
        return [
          { role: "body", ids: ["boards", "leather", "iron_bar", "fine_gold", "cut_gem"] },
          { role: "movement", ids: ["mechanism", "fine_wire", "gold_wire", "spring", "cable"] },
          { role: "locking", ids: ["chest_lock", "warded_lock", "tumbler_lock", "vault_lock", "clockwork_cog", "master_cog"] }
        ];
      case "masonry":
        return [
          { role: "blocks", ids: ["dressed_stone", "dressed_marble", "bricks", "stone_wall"] },
          { role: "render", ids: ["mortar", "hydraulic_mortar", "lime_plaster", "whitewash", "pitch"] },
          { role: "core", ids: ["golem_core", "titan_core"] }
        ];
      case "rubbermaking":
        return [
          { role: "stock", ids: ["rubber", "hard_rubber"] },
          { role: "fittings", ids: ["rubber_tubing", "rubber_seal", "gasket_set"] },
          { role: "core", ids: ["glass", "rebreather"] }
        ];
      case "sailmaking":
        return [
          { role: "canvas", ids: ["mainsail", "foresail", "mizzen_sail", "cloth_canvas", "sail"] },
          { role: "rigging", name: "Rigging lines", ids: ["standing_rigging", "running_rigging"] },
          { role: "resin", ids: ["leviathan_resin"] }
        ];
      case "shipwrighting":
        return [
          { role: "hull", ids: ["planks", "boards", "oak_boards", "iron_bar"] },
          { role: "rigging", ids: ["sail", "rigged_mainsail", "full_ship_rig", "mooring_line", "anchor_cable"] },
          { role: "cordage", ids: ["rope", "cable", "tarred_rope", "dragon_pitch", "wyrm_pitch"] }
        ];
      case "smelt":
        return [
          { role: "charge", name: "Cupronickel ore charge", ids: ["copper_ore", "ore_zinc", "ore_nickel", "ore_copper", "tin_ore", "ore_tin"] },
          { role: "flux", ids: ["forge_ember", "flux", "limestone"] }
        ];
      case "soapmaking":
        return [
          { role: "base", name: "Soap base", ids: ["tallow", "lye"] },
          { role: "additive", ids: ["herb", "madder_dye", "honey", "milk", "charcoal", "clay"] },
          { role: "saponite", ids: ["saponite", "pure_saponite"] }
        ];
      case "tailoring":
        return [
          { role: "cloth", ids: ["dyed_silk_cloth", "fulled_of_gold", "silk_cloth", "cloth"] },
          { role: "gold", ids: ["fine_gold", "gold_thread"] },
          { role: "trim", ids: ["seraphic_lace", "lace", "seraph_feather"] }
        ];
      case "toolmaking":
        return [
          { role: "stock", ids: ["iron_bar", "boards", "bar_mithril", "fine_gold", "steel_bar"] },
          { role: "handle", ids: ["tool_handle", "iron_wire"] },
          { role: "grit", ids: ["tempering_grit", "hardening_grit"] }
        ];
    }
    return null; // -> generic greedy fallback
  }

  // Assign each ingredient to the first matching bucket; unmatched ingredients
  // become their own loose buckets. Returns array of {role,name,entries:[]}.
  function assign(rec, buckets) {
    var inObj = rec.in;
    var ids = Object.keys(inObj);
    var out = buckets ? buckets.map(function (b) { return { role: b.role, name: b.name, entries: [] }; }) : [];
    var extra = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], placed = false;
      if (buckets) for (var b = 0; b < buckets.length; b++) {
        var bk = buckets[b];
        if ((bk.ids && bk.ids.indexOf(id) >= 0) || (bk.pre && bk.pre(id))) {
          out[b].entries.push([id, inObj[id]]); placed = true; break;
        }
      }
      if (!placed) extra.push({ role: "misc", entries: [[id, inObj[id]]] });
    }
    out = out.filter(function (g) { return g.entries.length; }).concat(extra);
    return out;
  }

  // Generic greedy fallback: chunk all ingredients into groups of <=3 so the
  // final ends up with <=3 groups (logs nothing silently — this is expected
  // only for families not explicitly modelled above).
  function genericGroups(rec) {
    var entries = Object.keys(rec.in).map(function (k) { return [k, rec.in[k]]; });
    var groups = [];
    for (var i = 0; i < entries.length; i += MAX_IN) {
      groups.push({ role: "components", entries: entries.slice(i, i + MAX_IN) });
    }
    return groups;
  }

  // If a design somehow yields >3 groups, merge the smallest ones until <=3.
  function capGroups(cat, parent, groups) {
    while (groups.length > MAX_IN) {
      groups.sort(function (a, b) { return a.entries.length - b.entries.length; });
      var merged = { role: "components", entries: groups[0].entries.concat(groups[1].entries) };
      groups.splice(0, 2, merged);
    }
    return groups;
  }

  // ---- run ---------------------------------------------------------------
  var cats = Object.keys(RECIPES);
  for (var c = 0; c < cats.length; c++) {
    var cat = cats[c], arr = RECIPES[cat];
    if (!Array.isArray(arr)) continue;
    // snapshot the current length so we don't reprocess intermediates we add
    var n = arr.length;
    for (var r = 0; r < n; r++) {
      var rec = arr[r];
      if (!rec || typeof rec.in !== "object" || rec._split_component) continue;
      var keys = Object.keys(rec.in);
      if (keys.length <= MAX_IN) continue;

      var buckets = bucketsFor(cat, rec.family);
      var groups = buckets ? assign(rec, buckets) : genericGroups(rec);
      groups = capGroups(cat, rec, groups);

      var newIn = {};
      for (var g = 0; g < groups.length; g++) {
        var grp = groups[g];
        var role = (buckets ? grp.role : "components");
        var label = grp.name || null;
        var rep = bundleToOne(cat, rec, grp.entries, label, role);
        // merge (a loose ingredient could collide with an intermediate id — unlikely)
        newIn[rep.id] = (newIn[rep.id] || 0) + rep.qty;
      }
      rec.in = newIn;
      splitCount++;
    }
  }

  // ---- enforce single by-product + single station on EVERY recipe --------
  // A craft yields at most ONE by-product and is made at ONE station. Both are
  // stored as arrays; keep only the first entry (the primary/most-specific one,
  // e.g. ["jewelers_bench","furnace"] -> "jewelers_bench"). Runs over ALL
  // recipes, including the intermediates added above.
  // ...and CONVERT every passive ("set it and collect later") recipe into an
  // active "time to craft" recipe: its job time becomes the craft tick, and the
  // passive flag/timer are dropped so it crafts per-tick like any other recipe.
  var cappedByp = 0, cappedStn = 0, unpassived = 0;
  var allCats = Object.keys(RECIPES);
  for (var cc = 0; cc < allCats.length; cc++) {
    var arr2 = RECIPES[allCats[cc]];
    if (!Array.isArray(arr2)) continue;
    for (var rr = 0; rr < arr2.length; rr++) {
      var rec2 = arr2[rr];
      if (!rec2 || typeof rec2 !== "object") continue;
      if (Array.isArray(rec2.byproducts) && rec2.byproducts.length > 1) { rec2.byproducts = rec2.byproducts.slice(0, 1); cappedByp++; }
      if (Array.isArray(rec2.stations) && rec2.stations.length > 1) { rec2.stations = rec2.stations.slice(0, 1); cappedStn++; }
      if (rec2.passive) {
        rec2.tick = rec2.time || rec2.tick || 2000;   // preserve the job duration as the craft time
        delete rec2.passive;
        delete rec2.time;
        unpassived++;
      }
    }
  }

  G.__RECIPE_SPLIT_STATS = { splitRecipes: splitCount, intermediateItems: madeItems, intermediateRecipes: madeRecipes, cappedByproducts: cappedByp, cappedStations: cappedStn, unpassived: unpassived };
  if (typeof console !== "undefined" && console.log) {
    console.log("[recipe-split] capped " + splitCount + " recipes at " + MAX_IN +
      " inputs via " + madeItems + " intermediate items (" + madeRecipes + " new recipes); " +
      "trimmed " + cappedByp + " recipes to 1 by-product, " + cappedStn + " to 1 station; " +
      "converted " + unpassived + " passive recipes to active");
  }
})();
