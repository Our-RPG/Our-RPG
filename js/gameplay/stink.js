// ===== Taiao — the STINK system =====
// Every scrap of skill work adds to your stink metre, and higher-tier work
// reeks exponentially more. Different work leaves a different FLAVOUR of stink
// (Husbandry = manure, farming = dirt, Fishing = fish, melee = blood & guts,
// fire trades = smoke, smelting = metal fumes; everything else = plain sweat).
// To wash it off you must stand in a body of water and use SOAP on yourself —
// pricier soaps scrub off more, and specialised soaps target certain flavours.
// Reek too much and shopkeepers bar their doors; reek far too much and even the
// city gates stay shut to you. Persisted in the save (storage.js).
"use strict";

// ---- tuning ----
var STINK_MAX = 3000;          // metre is clamped here
var STINK_SHOP_LOCK = 650;     // at/above this, NPC traders won't let you in
var STINK_CITY_LOCK = 1800;    // at/above this, city gates stay locked
var STINK_BASE = 0.2;          // stink from a level-0 action (low-level work barely reeks)
var STINK_GROWTH = 1.085;      // per skill tier -> exponential; steeper so late-game grinding still stinks
                               // (tier1 ~0.22 = half the old rate; tier50 ~unchanged)

// ---- flavours ----
var STINK_FLAVOURS = {
  manure: { name: "Manure",      emoji: "💩", col: "#7a5a2a" },
  dirt:   { name: "Dirt",        emoji: "🟫", col: "#8a6a3a" },
  fish:   { name: "Fish",        emoji: "🐟", col: "#5f93a6" },
  blood:  { name: "Blood & guts", emoji: "🩸", col: "#9a2f2f" },
  smoke:  { name: "Smoke",       emoji: "💨", col: "#8a8a8a" },
  fumes:  { name: "Metal fumes", emoji: "⚗️", col: "#8f9a7a" },
  sweat:  { name: "Sweat",       emoji: "💦", col: "#9a9a5f" },
};
// skill -> flavour (anything not listed => "sweat")
var STINK_SKILL_FLAVOUR = {
  Husbandry: "manure",
  Cerealiculture: "dirt", Olericulture: "dirt", Pomiculture: "dirt",
  Herbiculture: "dirt", Fibriculture: "dirt", Farming: "dirt",
  Mining: "dirt", "Ore-mining": "dirt", "Gem-mining": "dirt", "Stone-mining": "dirt",
  Fishing: "fish",
  Melee: "blood", Strength: "blood", Defence: "blood",
  Cooking: "smoke", Firemaking: "smoke", Baking: "smoke", Malting: "smoke",
  Brewing: "smoke", Pottery: "smoke", Glassmaking: "smoke",
  Weaponsmithing: "fumes", Armoursmithing: "fumes",
};

// ---- soap flavour PROFILES ----
// Every soap has its own ratio of scrubbing strength across the 7 flavours (a
// weight per flavour, multiplied by the soap's power). SPECIALISTS are heavily
// weighted: a soap pours 2-3x strength into its 1-2 thematic flavours and
// scrubs weakly (0.3-0.8) off-theme, so picking the right soap for your stink
// matters. The generalists (castile, marseille, luxury, royal, master) stay
// flat as the no-thought option — a matched specialist always out-scrubs them
// on its home flavour. Each row sums to roughly what it did before this
// sharpening, so a soap's TOTAL power per wash (and its price-worth) is
// unchanged — only the shape moved. Order matches STINK_ORDER:
//                 [manure, dirt, fish, blood, smoke, fumes, sweat]
var STINK_PROFILES = {
  lye_soap:       [1.7, 1.8, 0.5, 0.7, 0.8, 0.7, 1.1],   // harsh everyday: grime
  tallow_soap:    [0.9, 1.0, 0.7, 0.9, 0.9, 0.7, 2.1],   // plain body bar: sweat
  laundry_soap:   [2.1, 2.5, 0.4, 0.4, 0.5, 0.4, 0.8],   // washboard: dirt & manure
  bath_soap:      [0.6, 0.6, 0.6, 0.9, 0.7, 0.6, 3.1],   // the sweat specialist
  oatmeal_soap:   [2.0, 2.2, 0.4, 0.5, 0.5, 0.4, 0.7],   // gritty scrub: field grime
  castile_soap:   [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],   // the flat baseline
  rose_soap:      [1.0, 0.5, 0.4, 0.8, 0.5, 0.4, 2.7],   // perfume over sweat
  lavender_soap:  [0.5, 0.4, 0.4, 2.0, 0.6, 0.5, 2.1],   // calming: blood & sweat
  honey_soap:     [0.6, 0.6, 0.5, 1.0, 0.9, 0.5, 2.4],   // soothing: sweat
  milk_soap:      [0.6, 0.5, 0.9, 2.4, 0.5, 0.5, 1.1],   // gentle on gore: blood
  charcoal_soap:  [0.5, 0.8, 0.4, 0.4, 2.4, 2.0, 0.5],   // absorbs smoke & fumes
  clay_soap:      [2.5, 2.4, 0.3, 0.3, 0.4, 0.4, 0.3],   // the grime specialist
  green_soap:     [1.8, 2.6, 0.4, 0.4, 0.5, 0.6, 0.6],   // soft potash: dirt
  black_soap:     [0.6, 0.8, 0.4, 0.6, 2.6, 1.6, 0.5],   // hearth ash: smoke
  marseille_soap: [1.1, 1.1, 1.0, 1.1, 1.1, 1.1, 1.1],   // sturdy generalist
  perfumed_soap:  [1.0, 0.5, 2.1, 0.6, 0.4, 0.4, 1.9],   // masks fish & sweat
  glycerin_soap:  [0.4, 0.5, 0.6, 2.7, 0.6, 0.7, 1.3],   // clear & clinical: blood
  medicinal_soap: [0.4, 0.4, 0.5, 2.9, 0.6, 1.6, 0.7],   // antiseptic: blood & fumes
  saddle_soap:    [1.9, 1.2, 0.4, 1.9, 0.4, 0.4, 0.5],   // stable work: manure & blood
  scouring_soap:  [0.7, 1.5, 0.4, 0.4, 1.8, 2.1, 0.5],   // workshop: fumes & smoke
  cream_soap:     [0.5, 0.5, 0.5, 1.7, 0.6, 0.5, 2.4],   // rich lather: sweat & blood
  honeycomb_soap: [0.7, 0.6, 0.5, 0.8, 1.4, 0.5, 2.1],   // beeswax: sweat & smoke
  floral_soap:    [1.9, 0.5, 1.8, 0.5, 0.4, 0.4, 1.2],   // bouquet over the foulest reeks
  luxury_soap:    [1.1, 1.0, 1.1, 1.0, 1.1, 1.0, 1.1],   // fine generalist
  salt_soap:      [0.5, 0.5, 3.0, 0.7, 0.5, 0.6, 1.1],   // sea salt: fish
  ember_soap:     [0.5, 0.6, 0.4, 0.5, 2.7, 2.0, 0.5],   // the smoke & fumes specialist
  moon_soap:      [0.6, 0.5, 0.8, 2.2, 1.7, 0.7, 0.6],   // mystic: blood & smoke
  royal_soap:     [1.2, 1.1, 1.1, 1.2, 1.1, 1.1, 1.2],   // premium generalist
  ambergris_soap: [0.6, 0.5, 3.2, 0.7, 0.5, 0.5, 1.6],   // whale-perfume: fish
  master_soap:    [1.3, 1.3, 1.25, 1.3, 1.25, 1.3, 1.3], // the top generalist
  fishers_soap:   [0.3, 0.3, 3.2, 0.4, 0.3, 0.3, 0.7],   // the fish specialist
};
// deterministic unique-ish profile for any soap not in the table above —
// same sharpened shape as the hand-tuned rows: a weak 0.4-0.8 base with one
// hash-picked specialty flavour at 2.2-3.0 and a secondary at 1.1-1.6
function genSoapProfile(id) {
  var h = 2166136261;
  for (var i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = (h * 16777619) >>> 0; }
  var out = [];
  for (var f = 0; f < 7; f++) { h = (h * 1103515245 + 12345) >>> 0; out.push(+(0.4 + (h % 400) / 1000).toFixed(2)); }
  h = (h * 1103515245 + 12345) >>> 0; var spec = h % 7;
  h = (h * 1103515245 + 12345) >>> 0; var sec = (spec + 1 + (h % 6)) % 7;
  out[spec] = +(2.2 + (h % 800) / 1000).toFixed(2);
  h = (h * 1103515245 + 12345) >>> 0;
  out[sec] = +(1.1 + (h % 500) / 1000).toFixed(2);
  return out;
}
function soapProfile(soap) { return (soap && soap.profile) || null; }

function stinkState() {
  if (!player.stink || typeof player.stink !== "object") player.stink = { fl: {} };
  if (!player.stink.fl) player.stink.fl = {};
  return player.stink;
}
function stinkTotal() {
  var f = stinkState().fl, t = 0;
  for (var k in f) t += f[k];
  return Math.round(t);
}
// the loudest flavour (for the metre's icon / messages)
function stinkDominant() {
  var f = stinkState().fl, best = null, bv = 0;
  for (var k in f) if (f[k] > bv) { bv = f[k]; best = k; }
  return best;
}

// Not everything you kill leaves BLOOD & guts on you. A monster's kind/name
// picks the flavour melee fighting it leaves: gooey slimes and dry bones just
// leave you sweaty, stone/crystal constructs leave grit (dirt), plant-things
// leave sap (dirt), fiery things leave ash (smoke) — only fleshy beasts,
// humanoids, dragons and rotting undead give "blood & guts". Combat.js sets
// __combatStinkFlavour from this just before it awards melee XP.
var MOB_STINK_RULES = [
  [/slime|ooze|gel|jelly|pudding|blob|mucus/, "sweat"],
  [/skeleton|\bbone|lich|wight|skull|ghost|wraith|spectre|specter|phantom|spirit|shade|wisp|banshee|shadow|apparition|revenant/, "sweat"],
  [/golem|construct|statue|automaton|clockwork|gargoyle|crystal|prism|\brock\b|\bstone\b/, "dirt"],
  [/plant|treant|\bent\b|shrub|flower|vine|mushroom|fungal|myconid|spore|thorn|bramble|creeper|sapling|bloom/, "dirt"],
  [/magma|lava|ember|cinder|flame|phoenix|\bfire\b|inferno|molten|scorch/, "smoke"],
];
function monsterStinkFlavour(mon) {
  if (!mon) return "blood";
  var key = ((mon.kind || "") + " " + ((typeof MONSTERS !== "undefined" && MONSTERS[mon.kind] && MONSTERS[mon.kind].name) || "")).toLowerCase();
  // explicitly fleshy things bleed even if their name also says golem/etc. (Flesh Golem)
  if (/flesh|\bmeat\b|\bgore\b|carrion/.test(key)) return "blood";
  // elementals are bloodless — flavour by their element (never blood)
  if (/elemental/.test(key)) {
    if (/fire|magma|lava|ember|flame|inferno/.test(key)) return "smoke";
    if (/earth|sand|stone|rock|mud|clay|dust/.test(key)) return "dirt";
    return "sweat"; // water, ice, air, storm, lightning… leave you damp, not bloody
  }
  for (var i = 0; i < MOB_STINK_RULES.length; i++) if (MOB_STINK_RULES[i][0].test(key)) return MOB_STINK_RULES[i][1];
  return "blood"; // fleshy default
}

// hooked from moveTo (gameplay/movement.js): running (the sidebar Run
// toggle, window.runMode — character-stats.js charSpeedMul) works up a flat
// sweat gain per step, same for everyone — no skill tier to scale by, unlike
// addStink below.
var RUN_SWEAT_GAIN = 0.15;
function addMoveSweat() {
  var s = stinkState();
  s.fl.sweat = (s.fl.sweat || 0) + RUN_SWEAT_GAIN;
  var tot = stinkTotal();
  if (tot > STINK_MAX) { var sc = STINK_MAX / tot; for (var k in s.fl) s.fl[k] *= sc; }
  uiDirty = true;
}

// hooked from addXp (main/state.js): work reeks, higher tiers exponentially so.
function addStink(skill, xpAmt) {
  if (!xpAmt || xpAmt <= 0) return;
  var fl = STINK_SKILL_FLAVOUR[skill] || "sweat";
  // blood-flavoured combat XP is rerouted by WHAT you're fighting (set by combat.js)
  if (fl === "blood" && typeof window !== "undefined" && window.__combatStinkFlavour !== undefined && window.__combatStinkFlavour !== null)
    fl = window.__combatStinkFlavour;
  var tier = 1;
  if (typeof skillLvl === "function") tier = Math.max(1, skillLvl(skill));
  var gain = STINK_BASE * Math.pow(STINK_GROWTH, tier);
  var s = stinkState();
  s.fl[fl] = (s.fl[fl] || 0) + gain;
  var tot = stinkTotal();
  if (tot > STINK_MAX) { var sc = STINK_MAX / tot; for (var k in s.fl) s.fl[k] *= sc; }
  uiDirty = true;
}

// ---- washing ----
function nearWater() {
  if (typeof world === "undefined" || !world || !world.isWater) return false;
  var px = player.x, py = player.y;
  if (world.isWater(px, py)) return true;
  var d = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (var i = 0; i < d.length; i++) if (world.isWater(px + d[i][0], py + d[i][1])) return true;
  return false;
}
// use a soap item on yourself (called from the inventory click / menu)
function washWithSoap(i) {
  var s = player.inv[i]; if (!s) return;
  var def = ITEMS[s.id]; if (!def || !def.soap) return;
  if (!nearWater()) { log("You need to be in a body of water to wash — find a lake, river or the sea, then use the soap.", "warn"); return; }
  var soap = def.soap, st = stinkState(), before = stinkTotal();
  if (before <= 0) { log("You're already clean.", "sys"); if (typeof Tutorial !== "undefined" && Tutorial.onWash) Tutorial.onWash(); return; }
  for (var k in st.fl) {
    // each flavour is scrubbed by this soap's own per-flavour strength (profile)
    st.fl[k] = Math.max(0, st.fl[k] - soapStrength(soap, k));
    if (st.fl[k] <= 0.01) delete st.fl[k];
  }
  s.qty -= 1; if (s.qty <= 0) player.inv[i] = null;
  var removed = before - stinkTotal();
  log("You wade in and lather up with " + def.name.toLowerCase() + ". You scrub off " + removed + " stink.", "sys");
  if (typeof Tutorial !== "undefined" && Tutorial.onWash) Tutorial.onWash(); // isle stage task
  uiDirty = true;
}

// ---- gating helpers (called from talkTo / useDoor) ----
function stinkBlocksShops() { return stinkTotal() >= STINK_SHOP_LOCK; }
function stinkBlocksGates() { return stinkTotal() >= STINK_CITY_LOCK; }

// ---- UI metre (rendered by renderUI) ----
function renderStink() {
  var bar = document.getElementById("stinkbar"), txt = document.getElementById("stinktext"),
      line = document.getElementById("stinkline");
  if (!bar || !txt) return;
  var tot = stinkTotal();
  bar.style.width = Math.min(100, 100 * tot / STINK_MAX) + "%";
  var col = tot >= STINK_CITY_LOCK ? "#b03030" : tot >= STINK_SHOP_LOCK ? "#c07a2a" : "#6a9a4a";
  bar.style.background = col;
  var dom = stinkDominant(), emo = dom ? STINK_FLAVOURS[dom].emoji : "🌿";
  txt.textContent = emo + " " + tot;
  if (line) {
    line.classList.toggle("stink-shop", tot >= STINK_SHOP_LOCK && tot < STINK_CITY_LOCK);
    line.classList.toggle("stink-city", tot >= STINK_CITY_LOCK);
    var f = stinkState().fl, parts = [];
    for (var k in f) if (f[k] >= 1) parts.push(STINK_FLAVOURS[k].emoji + " " + STINK_FLAVOURS[k].name + " " + Math.round(f[k]));
    var note = tot >= STINK_CITY_LOCK ? " — city gates are barred to you!"
             : tot >= STINK_SHOP_LOCK ? " — shopkeepers won't let you in!" : "";
    line.title = "Stink: " + tot + "/" + STINK_MAX + note + (parts.length ? "\n" + parts.join("\n") : "\n(clean)")
               + "\nStand in water and use soap to wash it off.";
  }
}

// ---- turn the Chandlery/Soapmaking soaps (chandlery.js) into WASH items ----
// Rather than invent parallel soap items, we enrich the existing 32-tier soap
// progression: each soap scrubs off stink, higher-tier soaps scrub off more
// (power scales with the recipe's level), and thematically-named soaps target
// specific flavour combinations (a sea-salt soap for fish, a charcoal soap for
// smoke & metal fumes, a clay soap for dirt & manure, and so on). The plain
// "soaps" family is also stocked by the general store so basic soap is buyable;
// the finer scented soaps stay a Soapmaking reward.
// how much stink of a given flavour ONE wash with this soap scrubs off:
// power x the soap's per-flavour weight (its unique profile). Used by washWithSoap
// and the Soaps menu, so they always agree.
function soapStrength(soap, flavour) {
  if (!soap) return 0;
  var prof = soapProfile(soap), i = STINK_ORDER.indexOf(flavour);
  var w = prof && i >= 0 && prof[i] != null ? prof[i] : 1;
  return Math.round(soap.power * w);
}
function soapExamine(def) {
  return def.name + " — a bar of soap; stand in a body of water and use it to wash off stink. "
    + "Press P to compare soaps.";
}

(function () {
  if (typeof ITEMS === "undefined") return;

  // Fisher's soap is a proper Soapmaking tier now (chandlery.js — it replaced the
  // old shaving soap), but it stays FISHMONGER-ONLY: add it to the fishmonger's
  // shelf, and the enrichment loop below keeps it out of the general shared stock.
  if (typeof SHOP_TYPES !== "undefined" && SHOP_TYPES.fishmonger && ITEMS.fishers_soap) {
    var origFM = SHOP_TYPES.fishmonger.sells;
    SHOP_TYPES.fishmonger.sells = function () {
      var l = (typeof origFM === "function" ? origFM() : origFM || []).slice();
      if (l.indexOf("fishers_soap") < 0) l.push("fishers_soap");
      return l;
    };
  }

  // enrich the Chandlery/Soapmaking soaps (chandlery.js) into wash items
  if (typeof RECIPES !== "undefined" && RECIPES.soapmaking) {
    for (var i = 0; i < RECIPES.soapmaking.length; i++) {
      var r = RECIPES.soapmaking[i], id = r.out;
      if (id === "lye" || !ITEMS[id]) continue;
      var req = r.req || 1;
      ITEMS[id].soap = { power: Math.round(90 + req * 62), profile: STINK_PROFILES[id] || genSoapProfile(id) };
      if (typeof EXAMINE !== "undefined") EXAMINE[id] = soapExamine(ITEMS[id]);
      // stock the everyday LOW-TIER "soaps" at the general store so basic soap is
      // always buyable; the powerful high-tier & fine soaps stay a Soapmaking reward.
      // fishers_soap is fishmonger-only, so keep it out of the general shared stock
      if (r.family === "soaps" && req <= 14 && id !== "fishers_soap" && typeof SHOP_STOCK !== "undefined" && SHOP_STOCK.indexOf(id) < 0) SHOP_STOCK.push(id);
    }
  }
})();

// ============================================================================
// SOAPS MENU (P) — every soap with a bar broken into per-flavour
// strength numbers, so you can see at a glance which soap fights which stink.
// ============================================================================
var STINK_ORDER = ["manure", "dirt", "fish", "blood", "smoke", "fumes", "sweat"];
var SOAP_BAR_PX = 0.225;  // pixels of bar length per point of total scrubbing power
var _soapsMenuEl = null;

function _buildSoapsMenu() {
  var wrap = document.createElement("div");
  wrap.id = "soapsmenu";
  wrap.innerHTML =
    '<div class="soaps-panel">'
    + '<div class="soaps-head"><span>🧼 Soaps</span><button id="soapsclose" title="Close (Esc)">✕</button></div>'
    + '<div class="soaps-hint">Each bar shows how much of each stink flavour <b>one wash</b> scrubs off. '
    + 'Click a soap you own (while standing in water) to use it.</div>'
    + '<div class="soaps-body" id="soaps-body"></div>'
    + '</div>';
  (document.getElementById("gamecol") || document.body).appendChild(wrap);
  wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) closeSoapsMenu(); });
  wrap.querySelector("#soapsclose").addEventListener("click", closeSoapsMenu);
  // keep wheel/touchpad scrolling inside the list instead of zooming the game
  // (the #gamecol wheel handler zooms the camera — same guard the trade window uses)
  wrap.addEventListener("wheel", function (e) { e.stopPropagation(); }, { passive: true });
  return wrap;
}

function renderSoapsMenu() {
  var body = document.getElementById("soaps-body");
  if (!body) return;
  body.innerHTML = "";
  var ids = Object.keys(ITEMS).filter(function (id) { return ITEMS[id] && ITEMS[id].soap; });
  var owned = {};
  ids.forEach(function (id) { owned[id] = typeof countItem === "function" ? countItem(id) : 0; });
  // total scrubbing power per soap (sum across flavours) — drives bar LENGTH
  var total = {}, maxTotal = 1;
  ids.forEach(function (id) {
    var t = 0; STINK_ORDER.forEach(function (fl) { t += soapStrength(ITEMS[id].soap, fl); });
    total[id] = t; if (t > maxTotal) maxTotal = t;
  });
  // owned soaps first, then by total strength (basic -> strongest)
  ids.sort(function (a, b) {
    var o = (owned[b] > 0) - (owned[a] > 0);
    return o || (total[a] - total[b]);
  });
  ids.forEach(function (id) {
    var def = ITEMS[id], soap = def.soap, have = owned[id];
    var row = document.createElement("div");
    row.className = "soaprow" + (have > 0 ? " owned" : "");
    // icon
    var cv = document.createElement("canvas"); cv.width = 32; cv.height = 32; cv.className = "soap-ico";
    try { cv.getContext("2d").drawImage(icon(def.icon), 0, 0); } catch (e) {}
    row.appendChild(cv);
    // name + owned count
    var nm = document.createElement("div"); nm.className = "soap-name";
    // tag each soap with the flavour it fights best (its profile's strongest)
    var dom = null, dv = -1;
    STINK_ORDER.forEach(function (fl) { var v = soapStrength(soap, fl); if (v > dv) { dv = v; dom = fl; } });
    nm.innerHTML = def.name + (have > 0 ? ' <span class="soap-have">×' + have + '</span>' : '')
      + (dom ? ' <span class="soap-tag" title="' + STINK_FLAVOURS[dom].name + '">best vs ' + STINK_FLAVOURS[dom].emoji + '</span>' : '');
    row.appendChild(nm);
    // per-flavour strength bar — the bar's absolute LENGTH reflects the soap's
    // total scrubbing power (so the strong soaps run off the edge and you scroll
    // sideways to read them); segments within split that length by flavour.
    var bar = document.createElement("div"); bar.className = "soap-bar";
    bar.title = "Total scrubbing power: " + total[id] + " per wash";
    bar.style.width = Math.max(40, Math.round(total[id] * SOAP_BAR_PX)) + "px";
    STINK_ORDER.forEach(function (fl) {
      var v = soapStrength(soap, fl);
      var seg = document.createElement("span"); seg.className = "soap-seg";
      seg.style.flexGrow = String(Math.max(0.0001, v));
      seg.style.background = STINK_FLAVOURS[fl].col;
      seg.title = STINK_FLAVOURS[fl].name + ": " + v + " per wash";
      seg.textContent = STINK_FLAVOURS[fl].emoji + v;
      bar.appendChild(seg);
    });
    row.appendChild(bar);
    if (have > 0) {
      row.addEventListener("click", function () {
        var idx = player.inv.findIndex(function (s) { return s && s.id === id; });
        if (idx >= 0) { washWithSoap(idx); renderSoapsMenu(); }
      });
    }
    body.appendChild(row);
  });
}

function openSoapsMenu() {
  if (!_soapsMenuEl) _soapsMenuEl = _buildSoapsMenu();
  renderSoapsMenu();
  _soapsMenuEl.classList.add("open");
}
function closeSoapsMenu() { if (_soapsMenuEl) _soapsMenuEl.classList.remove("open"); }
function soapsMenuOpen() { return !!(_soapsMenuEl && _soapsMenuEl.classList.contains("open")); }
function toggleSoapsMenu() { soapsMenuOpen() ? closeSoapsMenu() : openSoapsMenu(); }
